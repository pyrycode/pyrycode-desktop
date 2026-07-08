import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerUnpairHandler, type UnpairHandleTarget } from './unpairHandler'
import { UNPAIR_CHANNEL } from '../shared/ipc/unpair'
import type { ClearablePairedServerStore } from './pairedServerStore'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain (the
// pairingStatusHandler.test idiom).
function fakeTarget(): UnpairHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The invoke listener the handler registers, pulled from the fake target and typed for direct
// driving (extract target.handle.mock.calls[0][1] and call it — no request arg, the request has no body).
function listenerOf(
  target: ReturnType<typeof fakeTarget>
): (event: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A fake store exercising only clear() — the sole method the handler calls. save()/load() are
// present to satisfy ClearablePairedServerStore but never invoked; no keychain, no filesystem. Their
// spies double as the "the handler erases, it does not read" assertion surface.
function storeWithClear(clear: ClearablePairedServerStore['clear']): ClearablePairedServerStore & {
  save: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  clear: ClearablePairedServerStore['clear']
} {
  return { save: vi.fn(async () => {}), load: vi.fn(async () => null), clear }
}

// A keychain/filesystem-shaped path a propagated secureStore.delete error could carry — the exact
// substring "no detail crosses back" asserts never appears in the value-free response.
const SECRET_PATH = '/Users/x/Library/Keychains/login.keychain-db'

describe('registerUnpairHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers exactly one handler on the unpair channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerUnpairHandler(target, {
      store: storeWithClear(vi.fn(async () => {}))
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(UNPAIR_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(UNPAIR_CHANNEL)
  })

  it('clear() succeeds → ok', async () => {
    const target = fakeTarget()
    registerUnpairHandler(target, { store: storeWithClear(vi.fn(async () => {})) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ result: 'ok' })
  })

  it('erases exactly once and never reads (clear() only, no load/save)', async () => {
    const target = fakeTarget()
    const store = storeWithClear(vi.fn(async () => {}))
    registerUnpairHandler(target, { store })
    const listener = listenerOf(target)

    await listener({})

    expect(store.clear).toHaveBeenCalledTimes(1)
    expect(store.load).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('clear() throws → value-free error (resolves, never rejects)', async () => {
    const target = fakeTarget()
    const clear = vi.fn(async () => {
      throw new Error(`delete failed: ${SECRET_PATH}`)
    })
    registerUnpairHandler(target, { store: storeWithClear(clear) })
    const listener = listenerOf(target)

    // resolves, never rejects — handle must produce a value.
    await expect(listener({})).resolves.toEqual({ result: 'error' })
  })

  it('never leaks the thrown error detail into the response (value-free)', async () => {
    const target = fakeTarget()
    const clear = vi.fn(async () => {
      throw new Error(`delete failed: ${SECRET_PATH}`)
    })
    registerUnpairHandler(target, { store: storeWithClear(clear) })
    const listener = listenerOf(target)

    const serialized = JSON.stringify(await listener({}))
    expect(serialized).not.toContain(SECRET_PATH)
    // The ok path stringifies to exactly the discriminant — no extra field.
    const okTarget = fakeTarget()
    registerUnpairHandler(okTarget, { store: storeWithClear(vi.fn(async () => {})) })
    expect(JSON.stringify(await listenerOf(okTarget)({}))).toBe('{"result":"ok"}')
  })

  it('logs nothing on either the ok or the error path', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const okTarget = fakeTarget()
    registerUnpairHandler(okTarget, { store: storeWithClear(vi.fn(async () => {})) })
    await listenerOf(okTarget)({})

    const errTarget = fakeTarget()
    registerUnpairHandler(errTarget, {
      store: storeWithClear(
        vi.fn(async () => {
          throw new Error(`delete failed: ${SECRET_PATH}`)
        })
      )
    })
    await listenerOf(errTarget)({})

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
