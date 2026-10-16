import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import type { ElectronApplication } from '@playwright/test'
import { installHeldThreadRead } from './heldThreadRead'

const channel = 'pyry:chat-history'
const release = 'test:release-thread-read'
const state = globalThis as any
const transient = () => new Error('Execution context was destroyed: private inspection detail')
type Outcome = 'before' | 'after' | 'remove' | Error | number | undefined

// Run the serialized callbacks, including real registration identity and release listeners.
function harness(outcomes: Outcome[] = []) {
  const calls: unknown[] = []
  const original = (event: unknown, request: unknown) => { calls.push([event, request]); return { status: 'stored' } }
  const handlers = new Map<string, Function>([[channel, original]])
  const ipcMain = Object.assign(new EventEmitter(), {
    _invokeHandlers: handlers,
    removeHandler: (name: string) => { handlers.delete(name) },
    handle: (name: string, handler: Function) => { registrations++; handlers.set(name, handler) }
  })
  let registrations = 0, evaluations = 0
  const callbacks: Array<(electron: any) => unknown> = []
  const electron = { ipcMain }
  const app = { evaluate: async (callback: (electron: any) => unknown) => {
    callbacks.push(callback)
    const outcome = outcomes[evaluations++]
    if (outcome === 'before') throw transient()
    if (outcome instanceof Error || typeof outcome === 'number') throw outcome
    if (outcome === 'remove') { handlers.set(channel, original); delete state.__heldThreadRead }
    const result = await callback(electron)
    if (outcome === 'after') throw transient()
    return result
  } } as Pick<ElectronApplication, 'evaluate'>
  return { app, electron, handlers, original, calls, callbacks,
    get registrations() { return registrations }, get evaluations() { return evaluations } }
}

afterEach(() => { delete state.__heldThreadRead; delete state.heldThreadReads })

describe('installHeldThreadRead', () => {
  it('confirms registration, delegates other operations and restores before returning the held result', async () => {
    const h = harness()
    expect(await installHeldThreadRead(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 0 })
    const handler = h.handlers.get(channel)!
    expect(await handler('event', { operation: 'readList' })).toEqual({ status: 'stored' })
    const pending = handler('held', { operation: 'readThread' })
    await Promise.resolve()
    expect(state.heldThreadReads).toBe(1)
    expect(h.electron.ipcMain.listenerCount(release)).toBe(1)
    // A concurrent read delegates, rather than installing a second release listener.
    expect(await handler('next', { operation: 'readThread' })).toEqual({ status: 'stored' })
    expect(state.heldThreadReads).toBe(1)
    h.electron.ipcMain.emit(release)
    expect(await pending).toEqual({ status: 'stored' })
    expect(h.handlers.get(channel)).toBe(h.original)
    expect(h.electron.ipcMain.listenerCount(release)).toBe(0)
    expect(h.calls).toEqual([['event', { operation: 'readList' }], ['held', { operation: 'readThread' }], ['next', { operation: 'readThread' }]])
  })

  it('confirms absence before retrying loss before effect', async () => {
    const h = harness(['before'])
    expect(await installHeldThreadRead(h.app)).toEqual({ installationAttempts: 2, inspectionAttempts: 2, contextLosses: 1 })
    expect(h.registrations).toBe(1)
    expect(h.evaluations).toBe(4)
  })

  it('confirms loss after effect without reinstalling', async () => {
    const h = harness(['after'])
    expect(await installHeldThreadRead(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 1 })
    expect(h.registrations).toBe(1)
  })

  it('retries lost confirmation reads without replaying installation', async () => {
    const h = harness(['after', 'before', 'after'])
    expect(await installHeldThreadRead(h.app)).toEqual({ installationAttempts: 1, inspectionAttempts: 3, contextLosses: 3 })
    expect(h.registrations).toBe(1)
  })

  it.each(['before', 'after'] as const)('fails inconclusive confirmation after loss %s effect without replay', async loss => {
    const h = harness([loss, 'before', 'after', 'before'])
    await expect(installHeldThreadRead(h.app)).rejects.toThrow('Could not inspect held thread read handler')
    expect(h.evaluations).toBe(4)
    expect(h.registrations).toBe(loss === 'after' ? 1 : 0)
  })

  it('bounds repeated confirmed absence', async () => {
    const h = harness(['before', undefined, 'before'])
    await expect(installHeldThreadRead(h.app)).rejects.toThrow('Could not install held thread read handler')
    expect(h.evaluations).toBe(4)
    expect(h.registrations).toBe(0)
  })

  it('rejects acknowledged installation followed by absence without replay', async () => {
    const h = harness([undefined, 'remove'])
    await expect(installHeldThreadRead(h.app)).rejects.toThrow('Held thread read handler missing after installation')
    expect(h.evaluations).toBe(2)
  })

  it('late original execution preserves state while held and cannot rearm after restoration', async () => {
    const h = harness(['before'])
    await installHeldThreadRead(h.app)
    const wrapper = h.handlers.get(channel)!
    const pending = wrapper({}, { operation: 'readThread' })
    await Promise.resolve()
    await h.callbacks[0](h.electron)
    expect(h.handlers.get(channel)).toBe(wrapper)
    expect(h.registrations).toBe(1)
    expect(state.heldThreadReads).toBe(1)
    expect(h.electron.ipcMain.listenerCount(release)).toBe(1)
    h.electron.ipcMain.emit(release)
    await pending
    await h.callbacks[0](h.electron)
    expect(h.handlers.get(channel)).toBe(h.original)
    expect(h.registrations).toBe(2) // wrapper installation, then original restoration
    expect(state.heldThreadReads).toBe(1)
    expect(h.electron.ipcMain.listenerCount(release)).toBe(0)
  })

  it.each([0, 1])('classifies fatal evaluation %s without leaking arbitrary detail', async index => {
    const h = harness(index === 0 ? [new Error('private payload')] : ['after', new Error('private payload')])
    await expect(installHeldThreadRead(h.app)).rejects.toThrow(index === 0 ? 'Held thread read installation failed' : 'Held thread read inspection failed')
    expect(h.evaluations).toBe(index + 1)
  })

  it('rejects non-Error failures without recovery', async () => {
    const h = harness([42])
    await expect(installHeldThreadRead(h.app)).rejects.toThrow('Held thread read installation failed')
    expect(h.evaluations).toBe(1)
  })

  it('rejects missing or replaced registration', async () => {
    const missing = harness()
    missing.handlers.clear()
    await expect(installHeldThreadRead(missing.app)).rejects.toThrow('Held thread read installation failed')
    const changed = harness()
    await installHeldThreadRead(changed.app)
    changed.handlers.set(channel, changed.original)
    await expect(installHeldThreadRead(changed.app)).rejects.toThrow('Held thread read installation failed')
    expect(changed.registrations).toBe(1)
  })
})
