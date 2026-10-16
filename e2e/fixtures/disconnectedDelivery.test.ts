import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDeliveryInterception, readDeliveryObservation, withDeliveryCleanup } from './disconnectedDelivery'

const transient = () => new Error('electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.')
type Fault = 'before' | 'after' | 'omit' | { error: unknown } | undefined

function harness(installed = true) {
  const ipcMain = new EventEmitter()
  const listeners = [vi.fn(), vi.fn()]
  for (const listener of listeners) ipcMain.on('pyry:command', listener)
  const originalRead = vi.fn(async (_file: unknown, _options?: unknown) => Buffer.from('paired'))
  const originalSend = vi.fn()
  const fs = { readFile: originalRead }
  class WebSocket { send = originalSend }
  WebSocket.prototype.send = originalSend
  const builtin = process.getBuiltinModule.bind(process)
  vi.spyOn(process, 'getBuiltinModule').mockImplementation((name: string) => {
    if (name === 'fs/promises') return fs
    if (name === 'module') return { createRequire: () => () => ({ WebSocket }) }
    return builtin(name)
  })
  const electron = { ipcMain, app: { getAppPath: () => '/fake' } }
  const faults: Fault[] = []
  const callbacks: Function[] = []
  const app = { evaluate: async (callback: Function) => {
    callbacks.push(callback)
    const fault = faults.shift()
    if (fault === 'before') throw transient()
    if (typeof fault === 'object') throw fault.error
    if (fault === 'omit') return undefined
    const result = await callback(electron)
    if (fault === 'after') throw transient()
    return result
  } }
  if (installed) installDeliveryInterception(electron as any)
  const marker = () => (globalThis as any).__delivery1853
  const restored = () => {
    expect(fs.readFile).toBe(originalRead)
    expect(WebSocket.prototype.send).toBe(originalSend)
    expect(ipcMain.listeners('pyry:command')).toEqual(listeners)
  }
  return { app: app as any, callbacks, faults, ipcMain, listeners, fs, originalRead, marker, restored }
}

afterEach(() => {
  delete (globalThis as any).__delivery1853
  vi.restoreAllMocks()
})

describe('disconnected delivery cleanup', () => {
  it('restores hooks, releases a held read and never forwards pending messages', async () => {
    const h = harness()
    const removeListeners = vi.spyOn(h.ipcMain, 'removeAllListeners')
    // Use the actual base64url storage filename that installation intercepts.
    const heldPairing = h.fs.readFile(`/fake/${Buffer.from('pyrycode.paired_server').toString('base64url')}.bin`)
    expect(h.originalRead).not.toHaveBeenCalled()
    const command = { type: 'sendMessage', payload: { text: 'held' } }
    h.ipcMain.emit('pyry:command', {}, command)
    await withDeliveryCleanup(h.app, async () => {})
    h.restored()
    await expect(heldPairing).resolves.toEqual(Buffer.from('paired'))
    expect(h.marker().pending).toHaveLength(1)
    for (const listener of h.listeners) expect(listener).not.toHaveBeenCalled()
    // Execute the actual original callback late, twice: it must remain a no-op.
    await h.callbacks[0]({})
    await h.callbacks[0]({})
    h.restored()
    expect(removeListeners).toHaveBeenCalledTimes(1)
    h.ipcMain.emit('pyry:command', {}, { type: 'other' })
    for (const listener of h.listeners) expect(listener).toHaveBeenCalledTimes(1)
  })

  it.each(['before', 'after'] as const)('recovers a lost restoration acknowledgement %s the effect', async fault => {
    const h = harness()
    h.faults.push(fault)
    await withDeliveryCleanup(h.app, async () => {})
    h.restored()
    expect(h.callbacks).toHaveLength(fault === 'before' ? 4 : 2)
  })

  it('recovers a transient confirmation-read loss without another mutation', async () => {
    const h = harness()
    const restore = vi.spyOn(h.marker(), 'restore')
    h.faults.push('after', 'before')
    await withDeliveryCleanup(h.app, async () => {})
    h.restored()
    expect(h.callbacks).toHaveLength(3)
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('fails exhausted confirmation without replaying a possibly completed mutation', async () => {
    const h = harness()
    h.faults.push('after', 'before', 'before', 'before')
    await expect(withDeliveryCleanup(h.app, async () => {})).rejects.toThrow('Could not confirm delivery cleanup')
    h.restored()
    expect(h.callbacks).toHaveLength(4)
  })

  it('bounds recovery when both restoration attempts are lost before effect', async () => {
    const h = harness()
    h.faults.push('before', undefined, 'before')
    await expect(withDeliveryCleanup(h.app, async () => {})).rejects.toThrow('Delivery cleanup did not restore interception')
    expect(h.callbacks).toHaveLength(4)
  })

  it('rejects acknowledged restoration with mismatching state without replay', async () => {
    const h = harness()
    h.faults.push('omit')
    await expect(withDeliveryCleanup(h.app, async () => {})).rejects.toThrow('Delivery cleanup did not restore interception')
    expect(h.callbacks).toHaveLength(2)
  })

  it.each([new Error('closed inspector'), 'non-Error failure'])('preserves unrelated errors: %s', async error => {
    for (const readFailure of [false, true]) {
      const h = harness()
      if (readFailure) h.faults.push(undefined)
      h.faults.push({ error })
      await expect(withDeliveryCleanup(h.app, async () => {})).rejects.toBe(error)
      expect(h.callbacks).toHaveLength(readFailure ? 2 : 1)
      vi.restoreAllMocks()
    }
  })

  it('keeps the original assertion visible alongside cleanup failure', async () => {
    const h = harness()
    const primary = new Error('original delivery assertion failed')
    const cleanup = new Error('cleanup failed')
    h.faults.push({ error: cleanup })
    const result = await withDeliveryCleanup(h.app, async () => { throw primary }).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toEqual([primary, cleanup])
    // Playwright serializes message/stack, rather than AggregateError.errors.
    expect((result as AggregateError).message).toContain(primary.message)
    expect((result as AggregateError).message).toContain(cleanup.message)
  })

  it('preserves the exact primary failure when cleanup succeeds', async () => {
    const h = harness()
    await expect(withDeliveryCleanup(h.app, async () => { throw undefined })).rejects.toBeUndefined()
    h.restored()
  })

  it.each(['before', 'after'] as const)('cleans up failed installation %s effect without reinstalling', async fault => {
    const h = harness(false)
    h.faults.push(fault)
    await expect(withDeliveryCleanup(h.app, () => h.app.evaluate(installDeliveryInterception))).rejects.toThrow('Execution context was destroyed')
    h.restored()
    expect(h.callbacks.filter(callback => callback === installDeliveryInterception)).toHaveLength(1)
  })

  it.each([false, true])('restores after resume (failure=%s) without replaying held commands', async fail => {
    const h = harness()
    const held = h.fs.readFile(`/fake/${Buffer.from('pyrycode.paired_server').toString('base64url')}.bin`)
    const outcome = held.catch(error => error)
    h.ipcMain.emit('pyry:command', {}, { type: 'sendMessage' })
    h.marker().resume(fail)
    await withDeliveryCleanup(h.app, async () => {})
    h.restored()
    if (fail) expect(await outcome).toEqual(new Error('synthetic pairing read failure'))
    else expect(await outcome).toEqual(Buffer.from('paired'))
    for (const listener of h.listeners) expect(listener).not.toHaveBeenCalled()
  })
})

describe('delivery observations', () => {
  it.each([0, [], null])('retains a successful value after transient loss: %j', async value => {
    const h = harness()
    h.faults.push('before')
    expect(await readDeliveryObservation(h.app, () => value)).toBe(value)
    expect(h.callbacks).toHaveLength(2)
  })

  it('fails unavailable reads at three attempts rather than returning a default', async () => {
    const h = harness()
    h.faults.push('before', 'before', 'before')
    await expect(readDeliveryObservation(h.app, () => 0)).rejects.toThrow('Could not inspect delivery observation')
    expect(h.callbacks).toHaveLength(3)
  })

  it('does not tolerate an unrelated observation error', async () => {
    const h = harness()
    const fatal = new Error('read failed')
    h.faults.push({ error: fatal })
    await expect(readDeliveryObservation(h.app, () => 0)).rejects.toBe(fatal)
    expect(h.callbacks).toHaveLength(1)
  })
})
