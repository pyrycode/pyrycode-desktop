import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { installSavedTraversalReads } from './savedTraversalReads'

const state = globalThis as any
const channel = 'pyry:diagnostic'
type Outcome = 'before' | 'after' | 'remove' | 'forget' | Error | number | undefined
const transient = () => new Error('Execution context was destroyed: synthetic inspection loss')

function harness(outcomes: Outcome[] = []) {
  const ipcMain = new EventEmitter()
  let evaluations = 0
  const callbacks: Array<(electron: any) => unknown> = []
  const app = { evaluate: async (callback: (electron: any) => unknown) => {
    callbacks.push(callback)
    const outcome = outcomes[evaluations++]
    if (outcome === 'before') throw transient()
    if (outcome instanceof Error || typeof outcome === 'number') throw outcome
    if (outcome === 'remove') ipcMain.removeAllListeners(channel)
    if (outcome === 'forget') { ipcMain.removeAllListeners(channel); delete state.__savedTraversalReads }
    const result = await callback({ ipcMain })
    if (outcome === 'after') throw transient()
    return result
  } } as Pick<ElectronApplication, 'evaluate'>
  const stored = () => ipcMain.emit(channel, {}, { event: 'history-timeline-restore', code: 'stored' })
  return { app, ipcMain, stored, callbacks, get evaluations() { return evaluations } }
}

afterEach(() => { delete state.savedReads; delete state.__savedTraversalReads })

describe('installSavedTraversalReads', () => {
  it('confirms one listener and counts only stored restoration events', async () => {
    const h = harness()
    expect(await installSavedTraversalReads(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 0 })
    h.ipcMain.emit(channel, {}, { event: 'history-timeline-restore', code: 'missing' })
    h.ipcMain.emit(channel, {}, { event: 'other-event', code: 'stored' })
    expect(state.savedReads).toBe(0)
    h.stored(); h.stored()
    expect(state.savedReads).toBe(2)
    expect(h.ipcMain.listenerCount(channel)).toBe(1)
  })

  it.each(['before', 'after'] as const)('recovers acknowledgement loss %s effect without duplicate counting', async loss => {
    const h = harness([loss])
    expect(await installSavedTraversalReads(h.app)).toEqual({
      installationAttempts: loss === 'before' ? 2 : 1,
      inspectionAttempts: loss === 'before' ? 2 : 1, contextLosses: 1
    })
    h.stored()
    // A late original evaluation and repeated setup must retain both count and identity.
    await h.callbacks[0]({ ipcMain: h.ipcMain })
    await installSavedTraversalReads(h.app)
    expect(state.savedReads).toBe(1)
    h.stored()
    expect(state.savedReads).toBe(2)
    expect(h.ipcMain.listenerCount(channel)).toBe(1)
  })

  it('retries only unavailable confirmation reads', async () => {
    const h = harness(['after', 'before', 'after'])
    expect(await installSavedTraversalReads(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 3, contextLosses: 3 })
    expect(h.ipcMain.listenerCount(channel)).toBe(1)
  })

  it.each(['before', 'after'] as const)('rejects exhausted confirmation after %s effect without replay', async loss => {
    const h = harness([loss, 'before', 'after', 'before'])
    await expect(installSavedTraversalReads(h.app)).rejects.toThrow('Could not inspect saved traversal listener')
    expect(h.evaluations).toBe(4)
    expect(h.ipcMain.listenerCount(channel)).toBe(loss === 'after' ? 1 : 0)
  })

  it('bounds repeated confirmed absence', async () => {
    const h = harness(['before', undefined, 'before'])
    await expect(installSavedTraversalReads(h.app)).rejects.toThrow('Could not install saved traversal listener')
    expect(h.evaluations).toBe(4)
    expect(h.ipcMain.listenerCount(channel)).toBe(0)
  })

  it('rejects a missing listener even when the installation marker survives', async () => {
    const h = harness([undefined, 'remove'])
    await expect(installSavedTraversalReads(h.app)).rejects.toThrow('Saved traversal listener changed')
    expect(h.evaluations).toBe(2)
  })

  it('rejects acknowledged installation followed by absence without reinstalling', async () => {
    const h = harness([undefined, 'forget'])
    await expect(installSavedTraversalReads(h.app)).rejects.toThrow('Saved traversal listener missing after installation')
    expect(h.evaluations).toBe(2)
    expect(h.ipcMain.listenerCount(channel)).toBe(0)
  })

  it.each([
    ['Error', new Error('unrelated evaluation failure')], ['non-Error', 42]
  ] as const)('propagates fatal %s installation failures without replay', async (_kind, failure) => {
    const h = harness([failure])
    await expect(installSavedTraversalReads(h.app)).rejects.toBe(failure)
    expect(h.evaluations).toBe(1)
  })

  it('propagates fatal confirmation failures without reinstalling', async () => {
    const failure = new Error('unrelated inspection failure'), h = harness(['after', failure])
    await expect(installSavedTraversalReads(h.app)).rejects.toBe(failure)
    expect(h.evaluations).toBe(2)
    expect(h.ipcMain.listenerCount(channel)).toBe(1)
  })
})
