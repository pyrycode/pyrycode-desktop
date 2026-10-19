import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ElectronApplication, Page } from '@playwright/test'
import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import { confirmConnectionPillStatus } from './connectionPillStatus'

const state = globalThis as any
const loss = () => new Error('Execution context was destroyed')
const disconnected: StampedDaemonEvent = { type: 'disconnected', serverId: 'host-a' }
type Fault = 'before' | 'after' | 'late' | 'hang' | Error | number | undefined

// Execute the real serialized callbacks. Delivery passes through the renderer's
// onDaemonEvent listeners, including an independent application consumer.
function harness(options: { send?: Fault[]; read?: Fault[]; mainRead?: Fault[]; deliveryDelay?: number; drop?: boolean } = {}) {
  const listeners = new Set<(event: StampedDaemonEvent) => void>()
  const consumed: StampedDaemonEvent[] = []
  listeners.add(event => consumed.push(event))
  const emit = (event: StampedDaemonEvent) => { for (const listener of listeners) listener(structuredClone(event)) }
  state.window = { pyry: { onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  } } }
  let sends = 0, reads = 0, mainReads = 0
  const late: Array<() => unknown> = []
  const electron = { BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_channel: string, event: StampedDaemonEvent) => {
    if (options.drop) return
    if (options.deliveryDelay) setTimeout(() => emit(event), options.deliveryDelay)
    else emit(event)
  } } }] } }
  async function evaluate(callback: Function, argument: any, fault: Fault, target: unknown) {
    if (fault === 'before') throw loss()
    if (fault === 'late') { late.push(() => callback(target, argument)); throw loss() }
    if (fault === 'hang') return new Promise(() => {})
    if (fault instanceof Error || typeof fault === 'number') throw fault
    const result = await callback(target, argument)
    if (fault === 'after') throw loss()
    return result
  }
  const app = { evaluate: (callback: Function, argument: any) => {
    const index = argument ? sends++ : mainReads++
    return evaluate(callback, argument, argument ? options.send?.[index] : options.mainRead?.[index], electron)
  } } as Pick<ElectronApplication, 'evaluate'>
  const page = { evaluate: (callback: Function, argument: any) => {
    const index = argument?.phase === 'read' ? reads++ : -1
    return evaluate((_: unknown, value: unknown) => callback(value), argument,
      index < 0 ? undefined : options.read?.[index], undefined)
  } } as Pick<Page, 'evaluate'>
  return { app, page, consumed, emit, late, listeners, get sends() { return sends }, get reads() { return reads } }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  delete state.window
  delete state.__connectionPillReceipts
  delete state.__connectionPillSends
})

async function run(h: ReturnType<typeof harness>, event = disconnected) {
  const result = confirmConnectionPillStatus(h.app, h.page, event)
  const settled = result.then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  await vi.runAllTimersAsync()
  return settled
}

it('waits for consuming receipt even after an acknowledged send', async () => {
  const h = harness({ deliveryDelay: 200 })
  const pending = confirmConnectionPillStatus(h.app, h.page, disconnected)
  let done = false
  void pending.then(() => { done = true })
  await vi.advanceTimersByTimeAsync(100)
  expect(done).toBe(false)
  expect(h.consumed).toHaveLength(0)
  await vi.runAllTimersAsync()
  await pending
  expect(h.consumed).toHaveLength(1)
  expect(h.listeners.size).toBe(1)
})

it.each(['before', 'after'] as const)('recovers acknowledgement loss %s effect exactly once', async fault => {
  const h = harness({ send: [fault] })
  expect(await run(h)).toEqual({ ok: true })
  expect(h.consumed).toHaveLength(1)
  expect(h.sends).toBe(fault === 'before' ? 2 : 1)
  expect(h.listeners.size).toBe(1)
})

it('guards delayed first execution after recovery and preserves prior tokens', async () => {
  const h = harness({ send: ['late'] })
  expect(await run(h)).toEqual({ ok: true })
  expect(await run(h)).toEqual({ ok: true })
  await h.late[0]()
  expect(h.consumed).toHaveLength(2)
  expect(h.listeners.size).toBe(1)
})

it('confirms a delayed first execution before recovery without another delivery', async () => {
  const h = harness({ send: ['late'], mainRead: ['before'] })
  setTimeout(() => h.late[0](), 50)
  expect(await run(h)).toEqual({ ok: true })
  expect(h.consumed).toHaveLength(1)
  expect(h.sends).toBe(1)
})

it('requires fresh exact receipt for consecutive same-copy states and repeated events', async () => {
  const h = harness({ deliveryDelay: 100 })
  const connecting: StampedDaemonEvent = { type: 'connecting', serverId: 'host-a' }
  for (const event of [disconnected, connecting, connecting]) expect(await run(h, event)).toEqual({ ok: true })
  expect(h.consumed.map(event => event.type)).toEqual(['disconnected', 'connecting', 'connecting'])
  expect(h.sends).toBe(3)
  expect(h.reads).toBeGreaterThan(3)
})

it.each([
  { type: 'connecting', serverId: 'host-a' },
  { type: 'disconnected', serverId: 'host-b' },
  { type: 'failed', serverId: 'host-a', error: { code: 'other', message: 'other', retryable: false } }
] as StampedDaemonEvent[])('rejects a receipt with wrong host/type/payload: %j', async wrong => {
  const h = harness({ drop: true })
  setTimeout(() => {
    // Retain this invocation's marker but corrupt the intended event.
    const receipts = [...state.__connectionPillReceipts.values()]
    const marked = JSON.parse(receipts[0].expected)
    h.emit({ ...marked, ...wrong })
  }, 10)
  expect((await run(h)).ok).toBe(false)
  expect(h.sends).toBe(1)
  expect(h.listeners.size).toBe(1)
})

it('distinguishes failed-event payloads under the same host and event type', async () => {
  const h = harness({ drop: true })
  setTimeout(() => {
    const receipt = [...state.__connectionPillReceipts.values()][0] as any
    const marked = JSON.parse(receipt.expected)
    h.emit({ ...marked, error: { ...marked.error, code: 'transport' } })
  }, 10)
  expect((await run(h, { type: 'failed', serverId: 'host-a', error: { code: 'update-required', message: 'PRIVATE', retryable: true } })).ok).toBe(false)
})

it('recovers transient renderer confirmation unavailability', async () => {
  const h = harness({ send: ['after'], read: ['before', 'before'] })
  expect(await run(h)).toEqual({ ok: true })
  expect(h.consumed).toHaveLength(1)
  expect(h.sends).toBe(1)
})

it('waits for queued IPC after lost acknowledgement without resending', async () => {
  const h = harness({ send: ['after'], deliveryDelay: 200 })
  expect(await run(h)).toEqual({ ok: true })
  expect(h.consumed).toHaveLength(1)
  expect(h.sends).toBe(1)
})

it.each(['send', 'read'] as const)('bounds a non-settling %s evaluation', async boundary => {
  const h = harness({ [boundary]: ['hang'] })
  const start = Date.now()
  expect((await run(h)).ok).toBe(false)
  expect(Date.now() - start).toBe(5_000)
  expect(h.sends).toBe(1)
  expect(h.listeners.size).toBe(1)
})

it.each(['read', 'mainRead'] as const)('exhausted %s confirmation never authorizes resend', async boundary => {
  const h = harness({ send: ['before'], [boundary]: Array(100).fill('before') })
  const start = Date.now()
  expect((await run(h)).ok).toBe(false)
  expect(h.sends).toBe(1)
  expect(h.consumed).toHaveLength(0)
  expect(h.listeners.size).toBe(1)
  expect(Date.now() - start).toBe(5_000)
})

it('bounds recovery to two attempts and five seconds', async () => {
  const h = harness({ send: ['before', 'before', 'before'] })
  const start = Date.now()
  expect((await run(h)).ok).toBe(false)
  expect(h.sends).toBe(2)
  expect(h.consumed).toHaveLength(0)
  expect(Date.now() - start).toBe(5_000)
})

it.each(['send', 'read', 'mainRead'] as const)('propagates unrelated %s errors and non-Error throws', async boundary => {
  for (const error of [new Error('unrelated'), 17]) {
    const h = harness({ send: boundary === 'mainRead' ? ['before'] : [], [boundary]: [error] })
    expect(await run(h)).toEqual({ ok: false, error })
    expect(h.sends).toBe(1)
    expect(h.listeners.size).toBe(1)
  }
})

it('expires a still-delayed send and disposes observers on failure', async () => {
  const h = harness({ send: ['late'], read: Array(100).fill('before') })
  expect((await run(h)).ok).toBe(false)
  await h.late[0]()
  expect(h.consumed).toHaveLength(0)
  expect(h.listeners.size).toBe(1)
})
