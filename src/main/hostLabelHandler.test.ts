import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  registerHostLabelHandler,
  registerHostLabelServerHandler,
  registerHostLabelSetHandler,
  type HostLabelHandleTarget,
  type HostLabelServerHandleTarget,
  type HostLabelSetHandleTarget
} from './hostLabelHandler'
import {
  HOST_LABEL_CHANNEL,
  HOST_LABEL_SERVER_CHANNEL,
  HOST_LABEL_SET_CHANNEL
} from '../shared/ipc/hostLabel'
import type {
  MultiPairedServerStore,
  PairedServerRecord
} from './pairedServerStore'
import { MAX_SERVER_ID_LENGTH } from '../shared/ipc/unpair'
import { MAX_HOST_LABEL_LENGTH } from '../shared/ipc/pairing'
import {
  createHostLabelStore,
  HOST_LABEL_FORMAT_VERSION,
  HOST_LABEL_NAME,
  MalformedHostLabelError,
  type HostLabelStore,
  type MultiHostLabelStore
} from './hostLabelStore'
import type { SecureStore } from './secureStore'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain (the
// serverInfoHandler.test idiom).
function fakeTarget(): HostLabelHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The invoke listener the handler registers, pulled from the fake target and typed for direct
// driving (extract target.handle.mock.calls[0][1] and call it — no request arg, the query has no body).
function listenerOf(target: ReturnType<typeof fakeTarget>): (event: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A fake store exercising only load() — the sole method the handler is even typed to reach.
function storeWithLoad(load: HostLabelStore['load']): Pick<HostLabelStore, 'load'> {
  return { load }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerHostLabelHandler', () => {
  it('registers exactly one handler on the host-label channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerHostLabelHandler(target, { store: storeWithLoad(vi.fn()) })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(HOST_LABEL_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(HOST_LABEL_CHANNEL)
  })

  it('a stored label crosses verbatim on the stored arm', async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => 'Pyrybox')) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'stored', label: 'Pyrybox' })
    // Structural pin: the stored arm carries exactly status + label, nothing else.
    expect(Object.keys(response as object).sort()).toEqual(['label', 'status'])
  })

  it('an awkward-but-valid label crosses byte-identically — no trim, no normalize, no fallback', async () => {
    // Leading/trailing whitespace, a leading BOM (hostLabelStore decodes with ignoreBOM so it
    // survives the store), and an emoji. Each would be lost by a "helpful" transformation.
    const AWKWARD = '﻿  pyrybox — office 🛰  '
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => AWKWARD)) })

    expect(await listenerOf(target)({})).toEqual({ status: 'stored', label: AWKWARD })
  })

  it("stored empty is STORED, not absent — a truthiness check must fail here and nowhere else", async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => '')) })

    // `''` is falsy: `if (!label) return { status: 'not-stored' }` type-checks, reads naturally, and
    // silently collapses a stored empty label into absence at the LAST boundary where #822/#823's
    // never-stored vs stored-empty distinction still exists. This test is that line's regression pin.
    expect(await listenerOf(target)({})).toEqual({ status: 'stored', label: '' })
  })

  it('null is absent, and the not-stored arm carries no label key at all', async () => {
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => null)) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'not-stored' })
    // NOT `label === undefined`: Electron's IPC uses structured clone, which PRESERVES an own
    // property whose value is undefined, so `{ status: 'not-stored', label: undefined }` would arrive
    // with `'label' in response` true and a renderer's `in` test would misread absence.
    expect('label' in (response as object)).toBe(false)
    expect(Object.keys(response as object)).toEqual(['status'])
  })

  it('the read bound agrees with the write guard: exactly MAX_HOST_LABEL_LENGTH crosses, one over does not', async () => {
    const atBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH)
    const overBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)

    const atTarget = fakeTarget()
    registerHostLabelHandler(atTarget, { store: storeWithLoad(vi.fn(async () => atBound)) })
    expect(await listenerOf(atTarget)({})).toEqual({ status: 'stored', label: atBound })

    const overTarget = fakeTarget()
    registerHostLabelHandler(overTarget, { store: storeWithLoad(vi.fn(async () => overBound)) })
    expect(await listenerOf(overTarget)({})).toEqual({ status: 'error' })
  })

  it('an over-long label leaves no residue — never a truncated value', async () => {
    // A distinctive sentinel, so a truncated prefix riding out on the response would be visible.
    const SENTINEL = 'LEAKME-host-label-'.repeat(20)
    expect(SENTINEL.length).toBeGreaterThan(MAX_HOST_LABEL_LENGTH)
    const target = fakeTarget()
    registerHostLabelHandler(target, { store: storeWithLoad(vi.fn(async () => SENTINEL)) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'error' })
    expect(JSON.stringify(response)).not.toContain(SENTINEL.slice(0, 16))
    expect('label' in (response as object)).toBe(false)
  })

  it('MalformedHostLabelError → error (resolves, never rejects)', async () => {
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new MalformedHostLabelError()
    })
    registerHostLabelHandler(target, { store: storeWithLoad(load) })

    // resolves, never rejects — handle must produce a value.
    await expect(listenerOf(target)({})).resolves.toEqual({ status: 'error' })
  })

  it('propagated decrypt failure (a plain Error, NOT MalformedHostLabelError) → error, no detail crosses', async () => {
    // A generic Error simulates the decrypt failure propagating out of secureStore.get, carrying a
    // secret-shaped keychain path in its message. Asserting a plain Error proves the handler maps
    // EVERY throw to `error` without branching on the type.
    const KEYCHAIN_PATH = '/Users/x/Library/Keychains/login.keychain-db'
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new Error(`decrypt failed: ${KEYCHAIN_PATH}`)
    })
    registerHostLabelHandler(target, { store: storeWithLoad(load) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'error' })
    // The caught error is dropped, not surfaced — no path detail rides out on the error arm.
    expect(JSON.stringify(response)).not.toContain(KEYCHAIN_PATH)
  })

  it('is log-free on every branch, including every error branch', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loads: Array<HostLabelStore['load']> = [
      vi.fn(async () => null),
      vi.fn(async () => ''),
      vi.fn(async () => 'Pyrybox'),
      vi.fn(async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)),
      vi.fn(async () => {
        throw new MalformedHostLabelError()
      }),
      vi.fn(async () => {
        throw new Error('decrypt failed: /Users/x/Library/Keychains/login.keychain-db')
      })
    ]
    for (const load of loads) {
      const target = fakeTarget()
      registerHostLabelHandler(target, { store: storeWithLoad(load) })
      await listenerOf(target)({})
    }

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('never writes: neither save nor clear is called on any branch', async () => {
    // The Pick<HostLabelStore, 'load'> dep type already makes this unrepresentable; this pins it at
    // runtime against a future widening of the dep type — a read channel must never mutate at-rest state.
    const save = vi.fn(async () => {})
    const clear = vi.fn(async () => {})
    const loads: Array<HostLabelStore['load']> = [
      vi.fn(async () => null),
      vi.fn(async () => ''),
      vi.fn(async () => 'Pyrybox'),
      vi.fn(async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)),
      vi.fn(async () => {
        throw new MalformedHostLabelError()
      })
    ]
    for (const load of loads) {
      const target = fakeTarget()
      const store: HostLabelStore = { save, load, clear }
      registerHostLabelHandler(target, { store })
      await listenerOf(target)({})
    }

    expect(save).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('reads through on every invoke — no cache', async () => {
    const target = fakeTarget()
    const load = vi
      .fn<HostLabelStore['load']>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    registerHostLabelHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ status: 'stored', label: 'first' })
    expect(await listener({})).toEqual({ status: 'stored', label: 'second' })
    expect(load).toHaveBeenCalledTimes(2)
  })
})

// ── The KEYED arm (#1157) ────────────────────────────────────────────────────────────────────────
// A second channel beside the one above, carrying an untrusted `serverId`. Same fake-target idiom;
// the listener takes TWO arguments (the stripped event, then the request), which is the whole
// difference in shape.

function fakeServerTarget(): HostLabelServerHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

function serverListenerOf(
  target: ReturnType<typeof fakeServerTarget>
): (event: unknown, request: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A fake store exercising only loadFor — the sole method the keyed handler is even typed to reach.
function storeWithLoadFor(
  loadFor: MultiHostLabelStore['loadFor']
): Pick<MultiHostLabelStore, 'loadFor'> {
  return { loadFor }
}

// Every shape the guard must refuse. Two of these — null and undefined — are the reason the
// malformed tests below assert that loadFor was NEVER CALLED rather than only that the outcome is
// `error`: with the guard deleted, `request.serverId` THROWS on those two, the classify-don't-
// forward catch turns the throw into `error`, and an outcome-only assertion would pass green over a
// removed guard. The others do redden on the outcome alone, which is exactly what makes the gap
// easy to miss.
const MALFORMED_REQUESTS: readonly unknown[] = [
  null,
  undefined,
  'pyrybox',
  42,
  {},
  { server: 'pyrybox' },
  { serverId: 42 },
  { serverId: null },
  { serverId: undefined },
  { serverId: ['pyrybox'] },
  ['pyrybox'],
  { serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1) }
]

// A Map-backed SecureStore, for the one test that drives BOTH channels over a REAL store. No
// keychain, no filesystem (the hostLabelStore.test.ts idiom, trimmed to the two members used here).
function fakeSecureStore(): { secureStore: SecureStore; store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>()
  return {
    store,
    secureStore: {
      async set(name, value) {
        store.set(name, value)
      },
      async get(name) {
        return store.get(name) ?? null
      },
      async delete(name) {
        store.delete(name)
      }
    }
  }
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('registerHostLabelServerHandler', () => {
  it('registers exactly one handler on the KEYED channel and unregisters that exact channel', () => {
    const target = fakeServerTarget()

    const unregister = registerHostLabelServerHandler(target, {
      store: storeWithLoadFor(vi.fn())
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // The keyed constant, never the zero-argument one: collapsing the two onto one registration
    // would put a request-taking listener on the body-free channel the current renderer caller uses.
    expect(target.handle).toHaveBeenCalledWith(HOST_LABEL_SERVER_CHANNEL, expect.any(Function))
    expect(target.handle).not.toHaveBeenCalledWith(HOST_LABEL_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(HOST_LABEL_SERVER_CHANNEL)
  })

  it('returns the label stored for the NAMED server, and a different label for a different id (AC1)', async () => {
    const labels = new Map([
      ['server-a', 'Pyrybox'],
      ['server-b', 'Pyrybox II']
    ])
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, {
      store: storeWithLoadFor(vi.fn(async (id: string) => labels.get(id) ?? null))
    })
    const listener = serverListenerOf(target)

    expect(await listener({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: 'Pyrybox'
    })
    expect(await listener({}, { serverId: 'server-b' })).toEqual({
      status: 'stored',
      label: 'Pyrybox II'
    })
    // The whole point of the ticket: one name does not answer for both machines.
    expect(await listener({}, { serverId: 'server-c' })).toEqual({ status: 'not-stored' })
  })

  it('passes the id through VERBATIM, including a prototype-shaped one (AC2)', async () => {
    const loadFor = vi.fn<MultiHostLabelStore['loadFor']>().mockResolvedValue(null)
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })
    const listener = serverListenerOf(target)

    // No normalization, no prefixing, no re-derivation: the store matches with === against each
    // decoded entry's own `server` field, so these are inert strings rather than paths or keys.
    for (const id of ['__proto__', 'constructor', '../../pyrycode.paired_server', '', 'Pyrybox']) {
      await listener({}, { serverId: id })
      expect(loadFor).toHaveBeenLastCalledWith(id)
    }
    expect(loadFor).toHaveBeenCalledTimes(5)
  })

  it('refuses every malformed request BEFORE any store call, indistinguishably (AC2)', async () => {
    for (const request of MALFORMED_REQUESTS) {
      const loadFor = vi.fn<MultiHostLabelStore['loadFor']>().mockResolvedValue('Pyrybox')
      const target = fakeServerTarget()
      registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })

      const response = await serverListenerOf(target)({}, request)
      // Indistinguishable from every other failure: the SAME value-free error arm, so a compromised
      // renderer cannot learn which of its guesses was well-formed.
      expect(response, JSON.stringify(request)).toEqual({ status: 'error' })
      expect(Object.keys(response as object), JSON.stringify(request)).toEqual(['status'])
      // "before any store call" — the half that actually detects a deleted guard. See
      // MALFORMED_REQUESTS.
      expect(loadFor, JSON.stringify(request)).not.toHaveBeenCalled()
    }
  })

  it('accepts an empty serverId at the guard and lets the STORE answer it (AC2)', async () => {
    const loadFor = vi.fn<MultiHostLabelStore['loadFor']>().mockResolvedValue(null)
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })

    // Accepted at the boundary — an empty id is storable, so refusing it here would make such a
    // record's label unreadable — and answered one step later as any unheld id is.
    expect(await serverListenerOf(target)({}, { serverId: '' })).toEqual({ status: 'not-stored' })
    expect(loadFor).toHaveBeenCalledWith('')
  })

  it('keeps stored-empty STORED per server — a truthiness check must fail here (AC3)', async () => {
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(vi.fn(async () => '')) })

    // `''` is falsy, so `if (!label) return { status: 'not-stored' }` type-checks, reads naturally,
    // and silently collapses a stored empty label into absence. This is that line's regression pin
    // on the keyed arm, mirroring the zero-argument arm's.
    expect(await serverListenerOf(target)({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: ''
    })
  })

  it('null is absent per server, and the not-stored arm carries no label key at all (AC3)', async () => {
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(vi.fn(async () => null)) })

    const response = await serverListenerOf(target)({}, { serverId: 'server-a' })
    expect(response).toEqual({ status: 'not-stored' })
    // NOT `label: undefined`: structured clone PRESERVES an own undefined-valued property, so a
    // renderer's `in` test would misread absence.
    expect('label' in (response as object)).toBe(false)
    expect(Object.keys(response as object)).toEqual(['status'])
  })

  it('re-applies the read bound per server: exactly MAX crosses, one over does not (AC3)', async () => {
    const atBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH)
    const overBound = 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1)

    const atTarget = fakeServerTarget()
    registerHostLabelServerHandler(atTarget, { store: storeWithLoadFor(vi.fn(async () => atBound)) })
    expect(await serverListenerOf(atTarget)({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: atBound
    })

    // The exact negation of isPairingRequest's write-side bound, against the SAME constant and the
    // same unit (UTF-16 code units) — a byte length or a code-point count would disagree for any
    // non-ASCII label. An over-long STORED label is never reported as never-stored.
    const overTarget = fakeServerTarget()
    registerHostLabelServerHandler(overTarget, {
      store: storeWithLoadFor(vi.fn(async () => overBound))
    })
    expect(await serverListenerOf(overTarget)({}, { serverId: 'server-a' })).toEqual({
      status: 'error'
    })
  })

  it('an over-long stored label leaves no residue — never a truncated value (AC3, AC5)', async () => {
    const SENTINEL = 'LEAKME-host-label-'.repeat(20)
    expect(SENTINEL.length).toBeGreaterThan(MAX_HOST_LABEL_LENGTH)
    const target = fakeServerTarget()
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(vi.fn(async () => SENTINEL)) })

    const response = await serverListenerOf(target)({}, { serverId: 'server-a' })
    expect(response).toEqual({ status: 'error' })
    // Dropped WHOLE: no truncation, no prefix, no length reported.
    expect(JSON.stringify(response)).not.toContain(SENTINEL.slice(0, 16))
    expect('label' in (response as object)).toBe(false)
  })

  it('every throw collapses to error, resolving rather than rejecting, with no detail (AC3, AC5)', async () => {
    const KEYCHAIN_PATH = '/Users/x/Library/Keychains/login.keychain-db'
    // A drifted envelope and invalid UTF-8 both raise MalformedHostLabelError through loadFor; a
    // decrypt failure propagates as a plain Error. Asserting BOTH proves the handler maps every
    // throw without branching on the error type.
    const throwers: Array<MultiHostLabelStore['loadFor']> = [
      async () => {
        throw new MalformedHostLabelError()
      },
      async () => {
        throw new Error(`decrypt failed: ${KEYCHAIN_PATH}`)
      }
    ]

    for (const loadFor of throwers) {
      const target = fakeServerTarget()
      registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })

      // resolves, never rejects — a rejection would cross as an Electron-serialized error carrying
      // a main-process stack trace.
      const response = await serverListenerOf(target)({}, { serverId: 'server-a' })
      expect(response).toEqual({ status: 'error' })
      expect(JSON.stringify(response)).not.toContain(KEYCHAIN_PATH)
    }
  })

  it('never rides the request id back on any non-stored outcome (AC5)', async () => {
    const HOSTILE_ID = 'LEAKME-server-id-0123456789'
    const outcomes: Array<Pick<MultiHostLabelStore, 'loadFor'>> = [
      storeWithLoadFor(vi.fn(async () => null)),
      storeWithLoadFor(vi.fn(async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1))),
      storeWithLoadFor(
        vi.fn(async () => {
          throw new MalformedHostLabelError()
        })
      )
    ]

    for (const store of outcomes) {
      const target = fakeServerTarget()
      registerHostLabelServerHandler(target, { store })
      const response = await serverListenerOf(target)({}, { serverId: HOSTILE_ID })
      expect(JSON.stringify(response)).not.toContain(HOSTILE_ID)
    }

    // The guard-refusal arm too — the id is present on the request but must not echo back.
    const refusedTarget = fakeServerTarget()
    registerHostLabelServerHandler(refusedTarget, { store: storeWithLoadFor(vi.fn()) })
    const refused = await serverListenerOf(refusedTarget)(
      {},
      { serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1) }
    )
    expect(JSON.stringify(refused)).not.toContain('a'.repeat(64))
  })

  it('is log-free on every branch, including the guard refusal (AC5)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loads: Array<MultiHostLabelStore['loadFor']> = [
      async () => null,
      async () => '',
      async () => 'Pyrybox',
      async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1),
      async () => {
        throw new MalformedHostLabelError()
      },
      async () => {
        throw new Error('decrypt failed: /Users/x/Library/Keychains/login.keychain-db')
      }
    ]
    for (const loadFor of loads) {
      const target = fakeServerTarget()
      registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })
      await serverListenerOf(target)({}, { serverId: 'server-a' })
    }
    // The refusal path is the branch this module did not have before it took a request at all, and
    // the one whose input is fully attacker-chosen.
    for (const request of MALFORMED_REQUESTS) {
      const target = fakeServerTarget()
      registerHostLabelServerHandler(target, { store: storeWithLoadFor(vi.fn()) })
      await serverListenerOf(target)({}, request)
    }

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('never writes and never erases: no save/saveFor/clear/clearFor on any branch', async () => {
    // The Pick<MultiHostLabelStore, 'loadFor'> dep type already makes this unrepresentable — the
    // listener has no NAME for any write verb. This pins it at runtime against a future widening of
    // the dep type: a read channel must never mutate at-rest state, and this arm is what a
    // compromised renderer can drive with an id of its own choosing.
    const save = vi.fn(async () => {})
    const saveFor = vi.fn(async () => {})
    const clear = vi.fn(async () => {})
    const clearFor = vi.fn(async () => {})
    const loads: Array<MultiHostLabelStore['loadFor']> = [
      async () => null,
      async () => '',
      async () => 'Pyrybox',
      async () => 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1),
      async () => {
        throw new MalformedHostLabelError()
      }
    ]

    for (const loadFor of loads) {
      const target = fakeServerTarget()
      const store: MultiHostLabelStore = { save, load: vi.fn(), clear, saveFor, loadFor, clearFor }
      registerHostLabelServerHandler(target, { store })
      await serverListenerOf(target)({}, { serverId: 'server-a' })
    }
    for (const request of MALFORMED_REQUESTS) {
      const target = fakeServerTarget()
      const store: MultiHostLabelStore = {
        save,
        load: vi.fn(),
        clear,
        saveFor,
        loadFor: vi.fn(),
        clearFor
      }
      registerHostLabelServerHandler(target, { store })
      await serverListenerOf(target)({}, request)
    }

    expect(save).not.toHaveBeenCalled()
    expect(saveFor).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(clearFor).not.toHaveBeenCalled()
  })

  it('reads through on every invoke — no cache', async () => {
    const target = fakeServerTarget()
    const loadFor = vi
      .fn<MultiHostLabelStore['loadFor']>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    registerHostLabelServerHandler(target, { store: storeWithLoadFor(loadFor) })
    const listener = serverListenerOf(target)

    expect(await listener({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: 'first'
    })
    expect(await listener({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: 'second'
    })
    expect(loadFor).toHaveBeenCalledTimes(2)
  })
})

// ── The two channels over ONE REAL store ─────────────────────────────────────────────────────────
// The only tests here that do not fake the store. Both AC3's legacy clause and AC4 are claims about
// how the two channels DISAGREE on the same bytes, and that disagreement lives in the store's two
// read paths (`load` recognises both at-rest shapes, `loadFor` reads only the keyed one) — a fake
// store cannot pin it, because faking it is assuming it.
describe('the keyed and zero-argument host-label channels over one real store', () => {
  // Two listeners over ONE store instance, exactly as the composition root wires them.
  function bothChannels(secureStore: SecureStore): {
    keyed: (event: unknown, request: unknown) => Promise<unknown>
    bodyFree: (event: unknown) => Promise<unknown>
  } {
    const store = createHostLabelStore({ secureStore })
    const keyedTarget = fakeServerTarget()
    registerHostLabelServerHandler(keyedTarget, { store })
    const bodyFreeTarget = fakeTarget()
    registerHostLabelHandler(bodyFreeTarget, { store })
    return {
      keyed: serverListenerOf(keyedTarget),
      bodyFree: listenerOf(bodyFreeTarget)
    }
  }

  it('a pre-#1156 bare blob: never-stored for EVERY id, verbatim on the body-free query (AC3, AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // What an app installed before #1156 holds: a bare operator-typed string, no envelope.
    store.set(HOST_LABEL_NAME, encode('Pyrybox'))
    const { keyed, bodyFree } = bothChannels(secureStore)

    // The documented ONE-WAY LOSS, and deliberately not "fixed" here: the store has no view of the
    // paired records, so it cannot name the server a bare string belonged to. Adopting it for one
    // server — or showing it on every host row — would recreate the bug #1155 exists to fix.
    // never-stored, NOT error, and never the bare text itself.
    for (const id of ['server-a', 'server-b', '', '__proto__']) {
      expect(await keyed({}, { serverId: id }), id).toEqual({ status: 'not-stored' })
    }
    // AC4: the current renderer caller is unaffected — the same bytes still read back verbatim.
    expect(await bodyFree({})).toEqual({ status: 'stored', label: 'Pyrybox' })
  })

  it('a keyed envelope: per-id on the keyed query, most-recent on the body-free one (AC1, AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // What an app that has paired since #1156 holds. Saved order is what "most recently stored"
    // reads from, so server-b is the last entry.
    store.set(
      HOST_LABEL_NAME,
      encode(
        JSON.stringify({
          v: HOST_LABEL_FORMAT_VERSION,
          labels: [
            { server: 'server-a', label: 'Pyrybox' },
            { server: 'server-b', label: 'Pyrybox II' }
          ]
        })
      )
    )
    const { keyed, bodyFree } = bothChannels(secureStore)

    expect(await keyed({}, { serverId: 'server-a' })).toEqual({
      status: 'stored',
      label: 'Pyrybox'
    })
    expect(await keyed({}, { serverId: 'server-b' })).toEqual({
      status: 'stored',
      label: 'Pyrybox II'
    })
    expect(await keyed({}, { serverId: 'server-c' })).toEqual({ status: 'not-stored' })
    // AC4: unchanged as #1156 left it — the most recently stored entry, never the envelope text,
    // never a list, never a count. This is the assertion that would redden if the keyed work
    // regressed `load` back to a raw passthrough.
    expect(await bodyFree({})).toEqual({ status: 'stored', label: 'Pyrybox II' })
  })

  it('a drifted envelope is error on BOTH channels — never never-stored (AC3, AC4)', async () => {
    const { secureStore, store } = fakeSecureStore()
    // Past the version marker, so this is unambiguously OUR format and a broken one is drift rather
    // than legacy: an entry missing its `label` raises rather than silently dropping a server.
    store.set(
      HOST_LABEL_NAME,
      encode(
        JSON.stringify({
          v: HOST_LABEL_FORMAT_VERSION,
          labels: [{ server: 'server-a' }]
        })
      )
    )
    const { keyed, bodyFree } = bothChannels(secureStore)

    // ADR 0005 forbids masking an unreadable record as never-stored: a consumer must be able to
    // branch to a re-enter-the-label recovery rather than treat corruption as absence.
    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'error' })
    expect(await bodyFree({})).toEqual({ status: 'error' })
  })

  it('an absent blob is never-stored on both — the only null path (AC3, AC4)', async () => {
    const { secureStore } = fakeSecureStore()
    const { keyed, bodyFree } = bothChannels(secureStore)

    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'not-stored' })
    expect(await bodyFree({})).toEqual({ status: 'not-stored' })
  })
})

// ── The KEYED SET arm (#1186) ────────────────────────────────────────────────────────────────────
// Same helper idiom as the two arms above, with two differences that are the whole shape of this
// arm: the store fake carries the two MUTATORS rather than a read, and there is a second store — the
// paired-server existence check, the first thing in this module that can materialise a record.

function fakeSetTarget(): HostLabelSetHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

function setListenerOf(
  target: ReturnType<typeof fakeSetTarget>
): (event: unknown, request: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A record whose two SECRET fields are recognisable strings. The existence check materialises one of
// these, so every assertion that "no field of the record rides back" is meaningful only against a
// record that actually holds something worth finding.
const SECRET_RECORD: PairedServerRecord = {
  server: 'server-a',
  relay: 'wss://relay.example/v1/client',
  token: 'TOKEN-b3ar3r-must-never-cross',
  server_static_pubkey: 'PUBKEY-static-must-never-cross'
}

// A paired-server handle answering from a fixed set of ids — the narrowest surface the handler is
// typed to reach, so nothing else on MultiPairedServerStore is even nameable here.
function pairedWith(...ids: readonly string[]): Pick<MultiPairedServerStore, 'loadById'> {
  return {
    loadById: vi.fn(async (id: string) => (ids.includes(id) ? { ...SECRET_RECORD, server: id } : null))
  }
}

// Both mutators spied, and neither read nameable: the Pick already makes save/load/loadFor/clear
// unreachable, and these pin which of the two the handler chose.
function setStore(overrides?: Partial<Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>>): {
  store: Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>
  saveFor: ReturnType<typeof vi.fn>
  clearFor: ReturnType<typeof vi.fn>
} {
  const saveFor = vi.fn<MultiHostLabelStore['saveFor']>().mockResolvedValue(undefined)
  const clearFor = vi.fn<MultiHostLabelStore['clearFor']>().mockResolvedValue(undefined)
  return {
    saveFor,
    clearFor,
    store: { saveFor: overrides?.saveFor ?? saveFor, clearFor: overrides?.clearFor ?? clearFor }
  }
}

// Every shape the SET guard must refuse. As on the keyed read, `null` and `undefined` are the reason
// the malformed test asserts that NO store method was reached rather than only that the outcome is
// `error`: with the guard deleted, `request.label` THROWS on those two and the catch turns the throw
// into `error`, so an outcome-only assertion would pass green over a removed guard.
const MALFORMED_SET_REQUESTS: readonly unknown[] = [
  null,
  undefined,
  'pyrybox',
  42,
  {},
  ['pyrybox'],
  { serverId: 'server-a' },
  { label: 'Pyrybox' },
  { server: 'server-a', label: 'Pyrybox' },
  { serverId: 42, label: 'Pyrybox' },
  { serverId: 'server-a', label: 42 },
  { serverId: null, label: 'Pyrybox' },
  { serverId: 'server-a', label: null },
  { serverId: undefined, label: 'Pyrybox' },
  { serverId: 'server-a', label: undefined },
  { serverId: ['server-a'], label: 'Pyrybox' },
  { serverId: 'server-a', label: ['Pyrybox'] },
  { serverId: 'a'.repeat(MAX_SERVER_ID_LENGTH + 1), label: 'Pyrybox' },
  { serverId: 'server-a', label: 'b'.repeat(MAX_HOST_LABEL_LENGTH + 1) }
]

describe('registerHostLabelSetHandler', () => {
  it('registers exactly one handler on the SET channel and unregisters that exact channel', () => {
    const target = fakeSetTarget()

    const unregister = registerHostLabelSetHandler(target, {
      store: setStore().store,
      pairedServers: pairedWith('server-a')
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // The SET constant, never either read channel: collapsing them would put a WRITE-capable
    // listener on a channel whose callers expect a structurally read-only one.
    expect(target.handle).toHaveBeenCalledWith(HOST_LABEL_SET_CHANNEL, expect.any(Function))
    expect(target.handle).not.toHaveBeenCalledWith(HOST_LABEL_CHANNEL, expect.any(Function))
    expect(target.handle).not.toHaveBeenCalledWith(HOST_LABEL_SERVER_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(HOST_LABEL_SET_CHANNEL)
  })

  it('stores a non-blank label TRIMMED for the named server, and answers with it (AC1)', async () => {
    const { store, saveFor, clearFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })

    const response = await setListenerOf(target)({}, { serverId: 'server-a', label: '  Pyrybox  ' })

    // The response describes the label as NOW HELD, so it must be the trimmed value — echoing the
    // raw request back would let the caller feed untrimmed text into the mapper the reads feed.
    expect(response).toEqual({ status: 'stored', label: 'Pyrybox' })
    expect(saveFor).toHaveBeenCalledTimes(1)
    expect(saveFor).toHaveBeenCalledWith('server-a', 'Pyrybox')
    expect(clearFor).not.toHaveBeenCalled()
  })

  it('trims only the SURROUNDING whitespace — interior text is untouched (AC1)', async () => {
    const { store, saveFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })
    const listener = setListenerOf(target)

    // No normalize, no case fold, no collapse of runs, no escape: this is `hostLabelToSend`'s rule
    // relocated to the boundary, and it only ever strips the ends.
    for (const [raw, trimmed] of [
      ['\t\n  Pyry  box \r\n', 'Pyry  box'],
      ['Pyrýbox', 'Pyrýbox'],
      ['  <b>Pyrybox</b>  ', '<b>Pyrybox</b>'],
      ['pyrybox II', 'pyrybox II']
    ]) {
      expect(await listener({}, { serverId: 'server-a', label: raw })).toEqual({
        status: 'stored',
        label: trimmed
      })
      expect(saveFor).toHaveBeenLastCalledWith('server-a', trimmed)
    }
  })

  it('a label blank after trimming CLEARS rather than storing an empty name (AC2)', async () => {
    const { store, saveFor, clearFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })
    const listener = setListenerOf(target)

    // The one place that decides whether a label EXISTS. Without the collapse, clearing the dialog's
    // field would store an empty NAME — which the read channels faithfully report as `stored: ''`,
    // since '' is a stored value there and not absence.
    for (const blank of ['', '   ', '\t\n', ' ']) {
      const response = await listener({}, { serverId: 'server-a', label: blank })
      expect(response, JSON.stringify(blank)).toEqual({ status: 'not-stored' })
      // Value-free by the type; this pins that no `label` key rides along on the clear outcome.
      expect(Object.keys(response as object), JSON.stringify(blank)).toEqual(['status'])
    }
    expect(clearFor).toHaveBeenCalledTimes(4)
    expect(clearFor).toHaveBeenLastCalledWith('server-a')
    expect(saveFor).not.toHaveBeenCalled()
  })

  it('refuses every malformed request BEFORE any store call, indistinguishably (AC3)', async () => {
    for (const request of MALFORMED_SET_REQUESTS) {
      const { store, saveFor, clearFor } = setStore()
      const pairedServers = pairedWith('server-a')
      const target = fakeSetTarget()
      registerHostLabelSetHandler(target, { store, pairedServers })

      const response = await setListenerOf(target)({}, request)
      expect(response, JSON.stringify(request)).toEqual({ status: 'error' })
      expect(Object.keys(response as object), JSON.stringify(request)).toEqual(['status'])
      // "reaches no store method at all" — the half that detects a deleted guard, and the half that
      // proves a malformed request cannot write. See MALFORMED_SET_REQUESTS.
      expect(saveFor, JSON.stringify(request)).not.toHaveBeenCalled()
      expect(clearFor, JSON.stringify(request)).not.toHaveBeenCalled()
      expect(pairedServers.loadById, JSON.stringify(request)).not.toHaveBeenCalled()
    }
  })

  it('refuses an id naming no paired server, writing nothing (AC3)', async () => {
    const { store, saveFor, clearFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })
    const listener = setListenerOf(target)

    // Without this check `saveFor` would park an orphan label on disk for an id naming nothing —
    // which the still-live un-keyed `load` would then answer with, since it returns the most
    // recently stored entry — and would let a caller append one entry per guessed id, growing the
    // at-rest blob without bound. Both halves are refused here, on the save AND the clear path.
    for (const label of ['Pyrybox', '']) {
      expect(await listener({}, { serverId: 'server-b', label })).toEqual({ status: 'error' })
    }
    expect(saveFor).not.toHaveBeenCalled()
    expect(clearFor).not.toHaveBeenCalled()
  })

  it('passes the id and the trimmed label through VERBATIM, prototype-shaped ids included (AC1)', async () => {
    const ids = ['__proto__', 'constructor', '../../pyrycode.paired_server', '']
    const { store, saveFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith(...ids) })
    const listener = setListenerOf(target)

    // No normalization, no prefixing: `saveFor` drops any entry whose own `server` field is === this
    // id and appends, so these are inert strings rather than paths or object keys.
    for (const id of ids) {
      await listener({}, { serverId: id, label: ' Pyrybox ' })
      expect(saveFor).toHaveBeenLastCalledWith(id, 'Pyrybox')
    }
    expect(saveFor).toHaveBeenCalledTimes(ids.length)
  })

  it('every throw collapses to error, resolving rather than rejecting, with no detail (AC3)', async () => {
    const boom = new Error('/Users/someone/Library/pyrycode.host_label: keychain locked')
    const cases: Array<{
      why: string
      store: Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>
      pairedServers: Pick<MultiPairedServerStore, 'loadById'>
      label: string
    }> = [
      {
        why: 'loadById throws (propagated decrypt failure / malformed record)',
        store: setStore().store,
        pairedServers: { loadById: vi.fn().mockRejectedValue(boom) },
        label: 'Pyrybox'
      },
      {
        why: 'saveFor throws (EncryptionUnavailableError / drifted envelope)',
        store: setStore({ saveFor: vi.fn().mockRejectedValue(boom) }).store,
        pairedServers: pairedWith('server-a'),
        label: 'Pyrybox'
      },
      {
        why: 'clearFor throws',
        store: setStore({ clearFor: vi.fn().mockRejectedValue(boom) }).store,
        pairedServers: pairedWith('server-a'),
        label: '   '
      },
      {
        why: 'MalformedHostLabelError from saveFor',
        store: setStore({ saveFor: vi.fn().mockRejectedValue(new MalformedHostLabelError()) }).store,
        pairedServers: pairedWith('server-a'),
        label: 'Pyrybox'
      }
    ]

    for (const { why, store, pairedServers, label } of cases) {
      const target = fakeSetTarget()
      registerHostLabelSetHandler(target, { store, pairedServers })

      // Resolves, never rejects: a rejection would cross as an Electron-serialized error carrying a
      // main-process stack trace. And the caught object is DROPPED — the message above holds a
      // filesystem path precisely so a leak of it would be visible.
      const response = await setListenerOf(target)({}, { serverId: 'server-a', label })
      expect(response, why).toEqual({ status: 'error' })
      expect(JSON.stringify(response), why).not.toContain('keychain')
      expect(JSON.stringify(response), why).not.toContain('/Users/')
    }
  })

  it('nothing is written when the existence check throws (AC3)', async () => {
    const { store, saveFor, clearFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, {
      store,
      pairedServers: { loadById: vi.fn().mockRejectedValue(new Error('decrypt failed')) }
    })

    expect(await setListenerOf(target)({}, { serverId: 'server-a', label: 'Pyrybox' })).toEqual({
      status: 'error'
    })
    expect(saveFor).not.toHaveBeenCalled()
    expect(clearFor).not.toHaveBeenCalled()
  })

  it('no field of the paired record ever rides back (AC5)', async () => {
    const { store } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })
    const listener = setListenerOf(target)

    // The existence check materialises a PairedServerRecord — a type alias of QrPayload, so a bearer
    // token and a server static key — for the first time in this module. It is reduced to a boolean
    // in the call expression itself and never bound to a name, and this is what pins that: the
    // record holds recognisable secrets and none of them may appear in any outcome.
    for (const label of ['Pyrybox', '  ']) {
      const response = await listener({}, { serverId: 'server-a', label })
      const serialized = JSON.stringify(response)
      expect(serialized, label).not.toContain('TOKEN-')
      expect(serialized, label).not.toContain('PUBKEY-')
      expect(serialized, label).not.toContain('wss://')
      // Exactly the union's own keys — never the id echoed back, never a relay URL, never a reason.
      expect(Object.keys(response as object).sort(), label).toEqual(
        label.trim() === '' ? ['status'] : ['label', 'status']
      )
    }
  })

  it('is log-free on every branch, including the guard refusal (AC5)', async () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {})
    }

    // Every branch: save, clear, guard refusal, unknown id, existence-check throw, mutator throw.
    const drives: Array<[Parameters<typeof registerHostLabelSetHandler>[1], unknown]> = [
      [{ store: setStore().store, pairedServers: pairedWith('server-a') }, { serverId: 'server-a', label: 'Pyrybox' }],
      [{ store: setStore().store, pairedServers: pairedWith('server-a') }, { serverId: 'server-a', label: ' ' }],
      [{ store: setStore().store, pairedServers: pairedWith('server-a') }, { serverId: 42 }],
      [{ store: setStore().store, pairedServers: pairedWith('server-a') }, { serverId: 'nope', label: 'x' }],
      [
        {
          store: setStore().store,
          pairedServers: { loadById: vi.fn().mockRejectedValue(new Error('boom')) }
        },
        { serverId: 'server-a', label: 'x' }
      ],
      [
        {
          store: setStore({ saveFor: vi.fn().mockRejectedValue(new Error('boom')) }).store,
          pairedServers: pairedWith('server-a')
        },
        { serverId: 'server-a', label: 'x' }
      ]
    ]

    for (const [deps, request] of drives) {
      const target = fakeSetTarget()
      registerHostLabelSetHandler(target, deps)
      await setListenerOf(target)({}, request)
    }

    // Log-free BY CONSTRUCTION: the id and the label are opaque locals, and a caught error could
    // echo a filesystem path or keychain detail.
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
  })

  it('writes through on every invoke — no cache, no coalescing', async () => {
    const { store, saveFor } = setStore()
    const target = fakeSetTarget()
    registerHostLabelSetHandler(target, { store, pairedServers: pairedWith('server-a') })
    const listener = setListenerOf(target)

    await listener({}, { serverId: 'server-a', label: 'Pyrybox' })
    await listener({}, { serverId: 'server-a', label: 'Pyrybox' })

    // Two identical sets are two writes. Suppressing the second would need a read this arm's dep
    // type cannot name, and would be wrong the moment another writer moved the label in between.
    expect(saveFor).toHaveBeenCalledTimes(2)
  })
})

describe('the SET arm against a real host-label store', () => {
  function allThree(secureStore: SecureStore): {
    set: (event: unknown, request: unknown) => Promise<unknown>
    keyed: (event: unknown, request: unknown) => Promise<unknown>
    bodyFree: (event: unknown) => Promise<unknown>
  } {
    const store = createHostLabelStore({ secureStore })
    const setTarget = fakeSetTarget()
    const keyedTarget = fakeServerTarget()
    const bodyFreeTarget = fakeTarget()
    // The composition root's rule, exercised: ONE store instance behind all three arms, so a write
    // here is visible to both reads on the very next invoke with no invalidation step.
    registerHostLabelSetHandler(setTarget, {
      store,
      pairedServers: pairedWith('server-a', 'server-b')
    })
    registerHostLabelServerHandler(keyedTarget, { store })
    registerHostLabelHandler(bodyFreeTarget, { store })
    return {
      set: setListenerOf(setTarget),
      keyed: serverListenerOf(keyedTarget),
      bodyFree: listenerOf(bodyFreeTarget)
    }
  }

  it('a stored label is readable back per server, and no other server moves (AC1)', async () => {
    const { secureStore } = fakeSecureStore()
    const { set, keyed } = allThree(secureStore)

    await set({}, { serverId: 'server-a', label: 'Pyrybox' })
    await set({}, { serverId: 'server-b', label: '  Pyrybox II  ' })
    // Renaming A must leave B alone — the whole point of the keyed envelope.
    await set({}, { serverId: 'server-a', label: 'Renamed' })

    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'stored', label: 'Renamed' })
    expect(await keyed({}, { serverId: 'server-b' })).toEqual({
      status: 'stored',
      label: 'Pyrybox II'
    })
  })

  it('a clear erases exactly that server, leaving the other stored (AC2)', async () => {
    const { secureStore } = fakeSecureStore()
    const { set, keyed } = allThree(secureStore)

    await set({}, { serverId: 'server-a', label: 'Pyrybox' })
    await set({}, { serverId: 'server-b', label: 'Pyrybox II' })

    expect(await set({}, { serverId: 'server-a', label: '   ' })).toEqual({ status: 'not-stored' })
    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'not-stored' })
    expect(await keyed({}, { serverId: 'server-b' })).toEqual({
      status: 'stored',
      label: 'Pyrybox II'
    })
  })

  it('a refused set leaves the collection byte-for-byte as it was (AC3)', async () => {
    const { secureStore, store: blobs } = fakeSecureStore()
    const { set, keyed } = allThree(secureStore)

    await set({}, { serverId: 'server-a', label: 'Pyrybox' })
    const before = blobs.get(HOST_LABEL_NAME)

    // A malformed request, an unpaired id, and an over-long label: none may touch the blob.
    await set({}, { serverId: 'server-a' })
    await set({}, { serverId: 'server-zzz', label: 'Intruder' })
    await set({}, { serverId: 'server-a', label: 'b'.repeat(MAX_HOST_LABEL_LENGTH + 1) })

    expect(blobs.get(HOST_LABEL_NAME)).toEqual(before)
    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'stored', label: 'Pyrybox' })
  })

  it('the un-keyed read answers with the most recently SET label (AC4)', async () => {
    const { secureStore } = fakeSecureStore()
    const { set, bodyFree } = allThree(secureStore)

    await set({}, { serverId: 'server-a', label: 'Pyrybox' })
    await set({}, { serverId: 'server-b', label: 'Pyrybox II' })

    // Last-writer-wins is the un-keyed query's own documented semantics, and a set moves it exactly
    // as the pairing confirm's write does — never the envelope text, never a list, never a count.
    expect(await bodyFree({})).toEqual({ status: 'stored', label: 'Pyrybox II' })
  })

  it('a set at exactly MAX_HOST_LABEL_LENGTH round-trips through both reads (AC1, AC4)', async () => {
    const { secureStore } = fakeSecureStore()
    const { set, keyed } = allThree(secureStore)
    const label = 'b'.repeat(MAX_HOST_LABEL_LENGTH)

    // The write guard and the read bound are the same constant in the same unit, so the widest label
    // this channel accepts is exactly the widest the reads will hand back — never a value stored
    // here that a read would then refuse as over-long.
    expect(await set({}, { serverId: 'server-a', label })).toEqual({ status: 'stored', label })
    expect(await keyed({}, { serverId: 'server-a' })).toEqual({ status: 'stored', label })
  })
})
