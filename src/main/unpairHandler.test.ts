import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerUnpairHandler, type UnpairHandleTarget } from './unpairHandler'
import { UNPAIR_CHANNEL } from '../shared/ipc/unpair'
import type { ClearablePairedServerStore } from './pairedServerStore'
import type { HostLabelStore } from './hostLabelStore'

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

// A clear-only host-label handle (#827) — exactly the surface the handler is typed against,
// Pick<HostLabelStore, 'clear'>. `save`/`load` are absent from the TYPE, so this module cannot read
// the label back and there is no label text here to leak. No keychain, no filesystem.
function labelWithClear(clear: HostLabelStore['clear']): Pick<HostLabelStore, 'clear'> {
  return { clear }
}

// A keychain/filesystem-shaped path a propagated secureStore.delete error could carry — the exact
// substring "no detail crosses back" asserts never appears in the value-free response.
const SECRET_PATH = '/Users/x/Library/Keychains/login.keychain-db'

// A label-shaped string a failing label erase could name in its message. Asserted never to reach the
// response either: the result reports on the record and carries no payload field at all.
const LABEL_TEXT = 'Pyrybox'

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

  it('logs nothing on the ok, the error, the throwing-label-erase, or the throwing-callback path', async () => {
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

    // The dropped label-erase throw must not break log-free-by-construction either (#827): a
    // secureStore.delete failure can carry an OS-keychain or filesystem path, so it is dropped too.
    const labelTarget = fakeTarget()
    registerUnpairHandler(labelTarget, {
      store: storeWithClear(vi.fn(async () => {})),
      hostLabel: labelWithClear(
        vi.fn(async () => {
          throw new Error(`delete ${LABEL_TEXT} failed: ${SECRET_PATH}`)
        })
      )
    })
    await listenerOf(labelTarget)({})

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

  // --- hostLabel: the label erased alongside the record (#827) --------------------------------
  describe('hostLabel', () => {
    it('erases the label exactly once, with no arguments, after a successful clear()', async () => {
      const target = fakeTarget()
      const clearLabel = vi.fn(async () => {})
      registerUnpairHandler(target, {
        store: storeWithClear(vi.fn(async () => {})),
        hostLabel: labelWithClear(clearLabel)
      })

      expect(await listenerOf(target)({})).toEqual({ result: 'ok' })

      expect(clearLabel).toHaveBeenCalledTimes(1)
      // No argument: the store erases by its OWN name, so no caller-supplied string can reach a
      // persistence key. Also covers "unpair when no label was ever stored" — the shipped clear() is
      // idempotent on an absent name, so never-stored is the same code path and needs no guard.
      expect(clearLabel).toHaveBeenCalledWith()
    })

    it('never erases the label when the record erase throws, and the error result is unchanged', async () => {
      const target = fakeTarget()
      const clearLabel = vi.fn(async () => {})
      registerUnpairHandler(target, {
        store: storeWithClear(
          vi.fn(async () => {
            throw new Error(`delete failed: ${SECRET_PATH}`)
          })
        ),
        hostLabel: labelWithClear(clearLabel)
      })

      await expect(listenerOf(target)({})).resolves.toEqual({ result: 'error' })
      // Nothing was erased, so nothing must follow up — the label still describes a live record.
      expect(clearLabel).not.toHaveBeenCalled()
    })

    // The mirror of the onUnpaired case above, under the same rule: the result reports on the
    // RECORD. By this point the record is gone, so `error` would leave a paired-looking UI over an
    // erased record — the inverse half-state runUnpair's coercion exists to prevent. A lost label is
    // stale display text, overwritten by the next pairing that carries one.
    it('still resolves ok (never rejects) when the label erase throws — the record is already gone', async () => {
      const target = fakeTarget()
      const clear = vi.fn(async () => {})
      const onUnpaired = vi.fn()
      registerUnpairHandler(target, {
        store: storeWithClear(clear),
        hostLabel: labelWithClear(
          vi.fn(async () => {
            throw new Error(`delete ${LABEL_TEXT} failed: ${SECRET_PATH}`)
          })
        ),
        onUnpaired
      })

      await expect(listenerOf(target)({})).resolves.toEqual({ result: 'ok' })
      expect(clear).toHaveBeenCalledTimes(1)
      // The teardown trigger still fires: the record is gone either way, so the live daemon session
      // must not outlive it just because a nickname survived.
      expect(onUnpaired).toHaveBeenCalledTimes(1)
    })

    it('never leaks the label erase failure detail into the response (value-free)', async () => {
      const target = fakeTarget()
      registerUnpairHandler(target, {
        store: storeWithClear(vi.fn(async () => {})),
        hostLabel: labelWithClear(
          vi.fn(async () => {
            throw new Error(`delete ${LABEL_TEXT} failed: ${SECRET_PATH}`)
          })
        )
      })

      const serialized = JSON.stringify(await listenerOf(target)({}))
      expect(serialized).not.toContain(SECRET_PATH)
      expect(serialized).not.toContain(LABEL_TEXT)
      // Exactly the discriminant — the response has no payload field for anything to ride out on.
      expect(serialized).toBe('{"result":"ok"}')
    })

    // Pins the erase ORDER, so a reorder is a test failure rather than a silent regression. Record
    // first: a label-first erase that threw would either abort with a live token still on disk, or
    // continue and gain nothing from having gone first. Label before the teardown trigger: all
    // at-rest erasure completes before anything observable is signalled.
    it('erases the record, then the label, then fires the teardown callback', async () => {
      const target = fakeTarget()
      const order: string[] = []
      registerUnpairHandler(target, {
        store: storeWithClear(
          vi.fn(async () => {
            order.push('record')
          })
        ),
        hostLabel: labelWithClear(
          vi.fn(async () => {
            order.push('label')
          })
        ),
        onUnpaired: () => {
          order.push('teardown')
        }
      })

      expect(await listenerOf(target)({})).toEqual({ result: 'ok' })
      expect(order).toEqual(['record', 'label', 'teardown'])
    })

    it('resolves ok when no hostLabel dep is wired (the optional-dep path)', async () => {
      const target = fakeTarget()
      const onUnpaired = vi.fn()
      registerUnpairHandler(target, {
        store: storeWithClear(vi.fn(async () => {})),
        onUnpaired
      })

      expect(await listenerOf(target)({})).toEqual({ result: 'ok' })
      expect(onUnpaired).toHaveBeenCalledTimes(1)
    })
  })
})
