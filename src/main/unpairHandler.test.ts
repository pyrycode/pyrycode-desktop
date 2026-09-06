import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerUnpairServerHandler,
  type UnpairServerHandleTarget
} from './unpairHandler'
import { UNPAIR_SERVER_CHANNEL, MAX_SERVER_ID_LENGTH } from '../shared/ipc/unpair'
import type { MultiPairedServerStore } from './pairedServerStore'
import type { MultiHostLabelStore } from './hostLabelStore'

// The handler's label handle since #1156 — Pick<MultiHostLabelStore, 'clearFor'>. It erases exactly
// one named server's label and carries no reader, so this module cannot materialise any label text.
// (Until #1163 a whole-collection arm sat beside it with a `clear`-only handle, deleting the one blob
// the keyed collection lives in; that arm and its handle went with the channel.)
function labelWithClearFor(
  clearFor: MultiHostLabelStore['clearFor']
): Pick<MultiHostLabelStore, 'clearFor'> {
  return { clearFor }
}

// A keychain/filesystem-shaped path a propagated secureStore.delete error could carry — the exact
// substring "no detail crosses back" asserts never appears in the value-free response.
const SECRET_PATH = '/Users/x/Library/Keychains/login.keychain-db'

// A label-shaped string a failing label erase could name in its message. Asserted never to reach the
// response either: the result reports on the record and carries no payload field at all.
const LABEL_TEXT = 'Pyrybox'

// --- the per-server arm (#1149) ----------------------------------------------------------------

// The ipcMain stand-in: only handle/removeHandler, spied. No Electron harness needed — the handler is
// typed against the minimal two-argument target, not ipcMain (the pairingStatusHandler.test idiom).
function fakeServerTarget(): UnpairServerHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The two-argument invoke listener the handler registers. It takes a REQUEST — the first untrusted
// field this module ever had — so it is driven as (event, request) and every malformed shape below is
// a real invoke a hostile renderer can make.
function serverListenerOf(
  target: ReturnType<typeof fakeServerTarget>
): (event: unknown, request: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

/** The per-server handler's dep bag, minus the store — the varying half of the log-free sweep. */
type ExtraServerDeps = Omit<Parameters<typeof registerUnpairServerHandler>[1], 'store'>

// A fake store carrying the FULL MultiPairedServerStore surface, deliberately wider than the dep
// type. The production dep is Pick<MultiPairedServerStore, 'clearServer'>, so `clear`, `save`,
// `load`, `loadById` and `list` are not merely unused — the compiler denies the module their names.
// They are spied here anyway so the tests below can assert it, keeping "erases, never reads"
// observable and adding "never erases the whole collection" alongside it — the latter outliving the
// whole-collection arm #1163 deleted, since a re-added `clear` caller would have to widen the dep.
function storeWithClearServer(
  clearServer: MultiPairedServerStore['clearServer']
): MultiPairedServerStore & {
  clear: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  loadById: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  clearServer: MultiPairedServerStore['clearServer']
} {
  return {
    clear: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    loadById: vi.fn(async () => null),
    list: vi.fn(async () => []),
    clearServer
  }
}

/** Assert the handler neither read the collection nor reached the whole-collection erase. */
function expectNoReadAndNoWholeErase(store: ReturnType<typeof storeWithClearServer>): void {
  expect(store.clear).not.toHaveBeenCalled()
  expect(store.load).not.toHaveBeenCalled()
  expect(store.loadById).not.toHaveBeenCalled()
  expect(store.list).not.toHaveBeenCalled()
  expect(store.save).not.toHaveBeenCalled()
}

// A recognisable id, used both as the request field and as the substring asserted never to reach a
// log call — this module stays log-free by construction, and the untrusted id must not be what ends
// that.
const SERVER_ID = 'pyrybox-alpha'

// Every request shape the guard must refuse. `{ serverId: undefined }` is reachable rather than
// hypothetical: Electron's IPC uses the structured clone algorithm, which PRESERVES an own property
// whose value is undefined. Each must be refused WITHOUT erasing anything, and — the property AC2
// states — without reaching the whole-collection erase on ANY of them.
const MALFORMED_REQUESTS: readonly unknown[] = [
  undefined,
  null,
  'pyrybox-alpha',
  42,
  {},
  { serverId: undefined },
  { serverId: 42 },
  { serverId: null },
  { server: 'pyrybox-alpha' },
  ['pyrybox-alpha'],
  { serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1) }
]

describe('registerUnpairServerHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers exactly one handler on the per-server channel and unregisters that exact channel', () => {
    const target = fakeServerTarget()

    const unregister = registerUnpairServerHandler(target, {
      store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 1 })))
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // The per-server channel, and NOT the whole-collection one #1163 deleted. The literal rather than
    // a constant, deliberately: `UNPAIR_CHANNEL` no longer exists, and this is the pin that the app
    // registers no whole-collection erase — it would redden if a later edit re-registered 'pyry:unpair'
    // here, whatever the constant naming it were called.
    expect(target.handle).toHaveBeenCalledWith(UNPAIR_SERVER_CHANNEL, expect.any(Function))
    expect(target.handle).not.toHaveBeenCalledWith('pyry:unpair', expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(UNPAIR_SERVER_CHANNEL)
  })

  it('erases the named server and reports ok, passing the id through verbatim', async () => {
    const target = fakeServerTarget()
    const clearServer = vi.fn(async () => ({ matched: true, remaining: 1 }))
    const store = storeWithClearServer(clearServer)
    registerUnpairServerHandler(target, { store })

    expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })

    expect(clearServer).toHaveBeenCalledTimes(1)
    // Exactly one argument, the id as supplied — no id-derived name, path, or key is constructed.
    expect(clearServer).toHaveBeenCalledWith(SERVER_ID)
    expectNoReadAndNoWholeErase(store)
  })

  it('accepts a request carrying an extra field (structural minimum, as the guard promises)', async () => {
    const target = fakeServerTarget()
    const clearServer = vi.fn(async () => ({ matched: true, remaining: 1 }))
    registerUnpairServerHandler(target, { store: storeWithClearServer(clearServer) })

    expect(
      await serverListenerOf(target)({}, { serverId: SERVER_ID, extra: 'ignored' })
    ).toEqual({ result: 'ok' })
    expect(clearServer).toHaveBeenCalledWith(SERVER_ID)
  })

  // AC2 as a PROPERTY, not as a guard unit test: for every malformed input, nothing is erased at
  // all — and in particular the whole-collection erase is never reached, which is what would turn
  // this ticket's own fix into the wipe it exists to prevent.
  it('refuses every malformed request without erasing anything (AC2)', async () => {
    for (const request of MALFORMED_REQUESTS) {
      const target = fakeServerTarget()
      const clearServer = vi.fn(async () => ({ matched: true, remaining: 0 }))
      const store = storeWithClearServer(clearServer)
      const onUnpaired = vi.fn()
      const clearLabel = vi.fn(async () => {})
      registerUnpairServerHandler(target, {
        store,
        onUnpaired,
        hostLabel: labelWithClearFor(clearLabel)
      })

      await expect(serverListenerOf(target)({}, request)).resolves.toEqual({ result: 'error' })

      expect(clearServer).not.toHaveBeenCalled()
      expectNoReadAndNoWholeErase(store)
      expect(clearLabel).not.toHaveBeenCalled()
      expect(onUnpaired).not.toHaveBeenCalled()
    }
  })

  it('refuses an id that names no held record, erasing nothing (AC2)', async () => {
    const target = fakeServerTarget()
    const clearServer = vi.fn(async () => ({ matched: false, remaining: 2 }))
    const store = storeWithClearServer(clearServer)
    const onUnpaired = vi.fn()
    const clearLabel = vi.fn(async () => {})
    registerUnpairServerHandler(target, {
      store,
      onUnpaired,
      hostLabel: labelWithClearFor(clearLabel)
    })

    await expect(
      serverListenerOf(target)({}, { serverId: 'never-paired' })
    ).resolves.toEqual({ result: 'error' })

    // clearServer writes nothing when nothing matched, so "erasing nothing" is already true — what
    // must not follow is the label erase or the teardown trigger.
    expect(clearLabel).not.toHaveBeenCalled()
    expect(onUnpaired).not.toHaveBeenCalled()
    expectNoReadAndNoWholeErase(store)
  })

  it('clearServer throws → value-free error (resolves, never rejects), nothing follows', async () => {
    const target = fakeServerTarget()
    const onUnpaired = vi.fn()
    const clearLabel = vi.fn(async () => {})
    registerUnpairServerHandler(target, {
      store: storeWithClearServer(
        vi.fn(async () => {
          throw new Error(`delete failed: ${SECRET_PATH}`)
        })
      ),
      onUnpaired,
      hostLabel: labelWithClearFor(clearLabel)
    })

    const response = await serverListenerOf(target)({}, { serverId: SERVER_ID })
    expect(response).toEqual({ result: 'error' })
    // Fail-closed: nothing was erased, so nothing must be torn down or cleaned up after it.
    expect(clearLabel).not.toHaveBeenCalled()
    expect(onUnpaired).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).not.toContain(SECRET_PATH)
  })

  it('never leaks the request id or a thrown detail into the response (value-free)', async () => {
    const target = fakeServerTarget()
    registerUnpairServerHandler(target, {
      store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 0 })))
    })

    const serialized = JSON.stringify(await serverListenerOf(target)({}, { serverId: SERVER_ID }))
    // The response has no payload field for the id — or anything else — to ride out on.
    expect(serialized).toBe('{"result":"ok"}')
    expect(serialized).not.toContain(SERVER_ID)
  })

  // --- the host label, erased for the named server and no other (#1156, AC2) -------------------
  describe('hostLabel', () => {
    it('erases the NAMED server’s label while other records remain (#1156)', async () => {
      const target = fakeServerTarget()
      const clearLabel = vi.fn(async () => {})
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 1 }))),
        hostLabel: labelWithClearFor(clearLabel)
      })

      expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })

      // The inverse of the rule #1149 shipped and #1156 retires. While the label was a single
      // un-keyed slot this erase had to be withheld whenever anything stayed paired, or it would
      // wipe the name a STILL-PAIRED server is displayed under. Keyed, it erases exactly the one
      // server named and leaves every survivor's label stored — so withholding it is now the bug.
      expect(clearLabel).toHaveBeenCalledTimes(1)
      expect(clearLabel).toHaveBeenCalledWith(SERVER_ID)
    })

    it('erases the named server’s label when it was the LAST record too', async () => {
      const target = fakeServerTarget()
      const clearLabel = vi.fn(async () => {})
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 0 }))),
        hostLabel: labelWithClearFor(clearLabel)
      })

      expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })

      // No gate on `remaining` at all any more: the erase is unconditional on a matched unpair, so
      // both counts take the identical path and the store deletes the blob once the last entry goes.
      expect(clearLabel).toHaveBeenCalledTimes(1)
      expect(clearLabel).toHaveBeenCalledWith(SERVER_ID)
    })

    it('names the SAME id the record erase used, for any id including a hostile one', async () => {
      for (const serverId of ['srv-1', '__proto__', 'constructor', '', '../pyrycode.paired_server']) {
        const target = fakeServerTarget()
        const clearServer = vi.fn(async () => ({ matched: true, remaining: 1 }))
        const clearLabel = vi.fn(async () => {})
        registerUnpairServerHandler(target, {
          store: storeWithClearServer(clearServer),
          hostLabel: labelWithClearFor(clearLabel)
        })

        expect(await serverListenerOf(target)({}, { serverId })).toEqual({ result: 'ok' })

        // One already-guarded id, passed verbatim to both erases — never re-derived, never
        // transformed. The store matches it with === against a decoded entry's own field, so it
        // stays a JSON value and a comparand and never becomes a persistence name or object key.
        expect(clearServer).toHaveBeenCalledWith(serverId)
        expect(clearLabel).toHaveBeenCalledWith(serverId)
      }
    })

    it('still resolves ok (never rejects) when the label erase throws — the record is already gone', async () => {
      const target = fakeServerTarget()
      const onUnpaired = vi.fn()
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 0 }))),
        hostLabel: labelWithClearFor(
          vi.fn(async () => {
            throw new Error(`delete ${LABEL_TEXT} failed: ${SECRET_PATH}`)
          })
        ),
        onUnpaired
      })

      const serialized = JSON.stringify(
        await serverListenerOf(target)({}, { serverId: SERVER_ID })
      )
      expect(serialized).toBe('{"result":"ok"}')
      expect(serialized).not.toContain(SECRET_PATH)
      expect(serialized).not.toContain(LABEL_TEXT)
      // The teardown trigger still fires: the record is gone either way, so the live session must
      // not outlive it just because a nickname survived.
      expect(onUnpaired).toHaveBeenCalledTimes(1)
    })

    it('resolves ok when no hostLabel dep is wired (the optional-dep path)', async () => {
      const target = fakeServerTarget()
      const onUnpaired = vi.fn()
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 0 }))),
        onUnpaired
      })

      expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })
      expect(onUnpaired).toHaveBeenCalledTimes(1)
    })
  })

  // --- the teardown trigger, on the successful named erase and nowhere else (AC4) ---------------
  describe('onUnpaired', () => {
    it('fires exactly once, with no arguments, after a successful named erase', async () => {
      const target = fakeServerTarget()
      const onUnpaired = vi.fn()
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(vi.fn(async () => ({ matched: true, remaining: 1 }))),
        onUnpaired
      })

      expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })

      expect(onUnpaired).toHaveBeenCalledTimes(1)
      // Value-free: a bare signal, so neither the id nor any record field crosses to the callback.
      expect(onUnpaired).toHaveBeenCalledWith()
    })

    it('still resolves ok (never rejects) when the callback throws — the erase already completed', async () => {
      const target = fakeServerTarget()
      const clearServer = vi.fn(async () => ({ matched: true, remaining: 1 }))
      registerUnpairServerHandler(target, {
        store: storeWithClearServer(clearServer),
        onUnpaired: () => {
          throw new Error(`teardown failed: ${SECRET_PATH}`)
        }
      })

      const response = await serverListenerOf(target)({}, { serverId: SERVER_ID })
      expect(response).toEqual({ result: 'ok' })
      expect(clearServer).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(response)).not.toContain(SECRET_PATH)
    })
  })

  // Pins the erase ORDER on this arm as the legacy one pins its own: record first (a label-first
  // erase that threw would abort with a live token still on disk), then the label, then the trigger
  // — all at-rest erasure completes before anything observable is signalled.
  it('erases the record, then the label, then fires the teardown callback', async () => {
    const target = fakeServerTarget()
    const order: string[] = []
    registerUnpairServerHandler(target, {
      store: storeWithClearServer(
        vi.fn(async () => {
          order.push('record')
          return { matched: true, remaining: 0 }
        })
      ),
      hostLabel: labelWithClearFor(
        vi.fn(async () => {
          order.push('label')
        })
      ),
      onUnpaired: () => {
        order.push('teardown')
      }
    })

    expect(await serverListenerOf(target)({}, { serverId: SERVER_ID })).toEqual({ result: 'ok' })
    expect(order).toEqual(['record', 'label', 'teardown'])
  })

  it('logs nothing on the ok, refusal, unknown-id, throwing-erase, label or callback paths', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const drive = async (
      clearServer: MultiPairedServerStore['clearServer'],
      extra: ExtraServerDeps,
      request: unknown = { serverId: SERVER_ID }
    ): Promise<void> => {
      const target = fakeServerTarget()
      registerUnpairServerHandler(target, { store: storeWithClearServer(clearServer), ...extra })
      await serverListenerOf(target)({}, request)
    }

    await drive(vi.fn(async () => ({ matched: true, remaining: 0 })), {})
    // A refusal must not log either — the id is untrusted renderer input, and logging it is exactly
    // how a module stops being log-free by construction.
    await drive(vi.fn(async () => ({ matched: true, remaining: 0 })), {}, { serverId: 42 })
    await drive(vi.fn(async () => ({ matched: false, remaining: 1 })), {})
    await drive(
      vi.fn(async () => {
        throw new Error(`delete failed: ${SECRET_PATH}`)
      }),
      {}
    )
    await drive(vi.fn(async () => ({ matched: true, remaining: 0 })), {
      hostLabel: labelWithClearFor(
        vi.fn(async () => {
          throw new Error(`delete ${LABEL_TEXT} failed: ${SECRET_PATH}`)
        })
      )
    })
    await drive(vi.fn(async () => ({ matched: true, remaining: 0 })), {
      onUnpaired: () => {
        throw new Error(`teardown failed: ${SECRET_PATH}`)
      }
    })

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
