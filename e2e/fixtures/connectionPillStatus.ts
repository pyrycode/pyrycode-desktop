import type { ElectronApplication, Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../../src/shared/ipc/events'
import { isTransientContextLoss, NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

type Receipt = { expected: string; count: number; off: () => void }
type RendererProbe = typeof globalThis & { __connectionPillReceipts?: Map<string, Receipt> }
type MainProbe = typeof globalThis & { __connectionPillSends?: Set<string> }

export async function confirmConnectionPillStatus(
  app: Pick<ElectronApplication, 'evaluate'>,
  page: Pick<Page, 'evaluate'>,
  event: StampedDaemonEvent
): Promise<void> {
  const token = randomUUID(), deadline = Date.now() + 5_000
  // Metadata is confined to this test's IPC injection, never the daemon wire.
  const marked = { ...event, __connectionPillDelivery: token }
  const expired = () => new Error('Connection-pill receipt was not confirmed within five seconds')
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw expired()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(expired()), remaining)
      })])
    } finally { clearTimeout(timer) }
  }
  async function available<T>(operation: () => Promise<T>): Promise<T | typeof NOT_YET_AVAILABLE> {
    try { return await bounded(operation()) }
    catch (error) {
      if (isTransientContextLoss(error)) return NOT_YET_AVAILABLE
      throw error
    }
  }
  try {
    await bounded(page.evaluate(({ token, event }) => {
      const target = globalThis as RendererProbe
      const receipts = target.__connectionPillReceipts ??= new Map()
      const receipt: Receipt = { expected: JSON.stringify(event), count: 0, off: () => {} }
      receipt.off = window.pyry.onDaemonEvent(value => {
        if (JSON.stringify(value) === receipt.expected) receipt.count++
      })
      receipts.set(token, receipt)
    }, { phase: 'install', token, event: marked }))
    let attempts = 0, ambiguous = false
    async function send(): Promise<void> {
      attempts++
      ambiguous = false
      try {
        await bounded(app.evaluate(({ BrowserWindow }, { channel, event, token, deadline }) => {
          const target = globalThis as MainProbe
          const sent = target.__connectionPillSends ??= new Set()
          if (sent.has(token) || Date.now() >= deadline) return
          const window = BrowserWindow.getAllWindows()[0]
          if (!window) throw new Error('Connection-pill window missing')
          // Synchronous claim fences both recovery and late original execution.
          sent.add(token)
          window.webContents.send(channel, event)
        }, { channel: DAEMON_EVENT_CHANNEL, event: marked, token, deadline }))
      } catch (error) {
        if (!isTransientContextLoss(error)) throw error
        ambiguous = true
      }
    }
    await send()
    while (Date.now() < deadline) {
      const count = await available(() => page.evaluate(({ token }) => {
        const receipt = (globalThis as RendererProbe).__connectionPillReceipts?.get(token)
        if (!receipt) throw new Error('Connection-pill observer missing')
        return receipt.count
      }, { phase: 'read', token }))
      if (count === 1) return
      if (count !== NOT_YET_AVAILABLE && count > 1) throw new Error('Duplicate connection-pill receipt')
      if (count === 0 && ambiguous && attempts < 2) {
        const sent = await bounded(readMainProcess<string[]>(app, () =>
          [...((globalThis as MainProbe).__connectionPillSends ?? [])]))
        // Only conclusive absence authorizes recovery. A queued IPC is awaited.
        if (sent !== NOT_YET_AVAILABLE && !sent.includes(token)) await send()
      }
      await bounded(new Promise<void>(resolve => setTimeout(resolve, 100)))
    }
    throw expired()
  } finally {
    // A single cleanup, including after lost observer-install acknowledgement.
    await page.evaluate(({ token }) => {
      const receipts = (globalThis as RendererProbe).__connectionPillReceipts
      receipts?.get(token)?.off()
      receipts?.delete(token)
    }, { phase: 'dispose', token })
  }
}
