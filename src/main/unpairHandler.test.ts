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

  it('logs nothing on the ok, the error, or the throwing-callback path', async () => {
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

    // The dropped onUnpaired throw must not break log-free-by-construction either (#504): its
    // caught object could carry internal state or a path, so it is dropped, not reported.
    const throwTarget = fakeTarget()
    registerUnpairHandler(throwTarget, {
      store: storeWithClear(vi.fn(async () => {})),
      onUnpaired: () => {
        throw new Error(`teardown failed: ${SECRET_PATH}`)
      }
    })
    await listenerOf(throwTarget)({})

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // --- onUnpaired: the teardown-on-unpair trigger (#504) -------------------------------------
  describe('onUnpaired', () => {
    it('fires exactly once, with no arguments, after a successful clear()', async () => {
      const target = fakeTarget()
      const onUnpaired = vi.fn()
      registerUnpairHandler(target, {
        store: storeWithClear(vi.fn(async () => {})),
        onUnpaired
      })

      expect(await listenerOf(target)({})).toEqual({ result: 'ok' })

      expect(onUnpaired).toHaveBeenCalledTimes(1)
      // Value-free: a bare signal, so no record/token/key field can cross to the callback.
      expect(onUnpaired).toHaveBeenCalledWith()
    })

    it('never fires when clear() throws, and the fail-closed error result is unchanged', async () => {
      const target = fakeTarget()
      const onUnpaired = vi.fn()
      registerUnpairHandler(target, {
        store: storeWithClear(
          vi.fn(async () => {
            throw new Error(`delete failed: ${SECRET_PATH}`)
          })
        ),
        onUnpaired
      })

      await expect(listenerOf(target)({})).resolves.toEqual({ result: 'error' })
      expect(onUnpaired).not.toHaveBeenCalled()
    })

    // Pins the deliberate deviation from onPaired (pairingHandler.ts:103, inside the try): a throw
    // here must NOT downgrade an already-completed erase to `error`. runUnpair coerces `error` and a
    // rejected invoke to the same outcome — stay on the conversation screen — which would leave a
    // paired-looking UI over an erased record. A future "tidy-up" back to onPaired's shape fails here.
    it('still resolves ok (never rejects) when the callback throws — the erase already completed', async () => {
      const target = fakeTarget()
      const clear = vi.fn(async () => {})
      registerUnpairHandler(target, {
        store: storeWithClear(clear),
        onUnpaired: () => {
          throw new Error(`teardown failed: ${SECRET_PATH}`)
        }
      })

      const response = await listenerOf(target)({})
      expect(response).toEqual({ result: 'ok' })
      expect(clear).toHaveBeenCalledTimes(1)
      // The dropped object never reaches the renderer.
      expect(JSON.stringify(response)).not.toContain(SECRET_PATH)
    })
  })
})
