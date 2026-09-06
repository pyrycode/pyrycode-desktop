import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerServerInfoHandler, type ServerInfoHandleTarget } from './serverInfoHandler'
import { SERVER_INFO_CHANNEL } from '../shared/ipc/serverInfo'
import {
  MalformedPairedServerRecordError,
  type MultiPairedServerStore,
  type PairedServerRecord
} from './pairedServerStore'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain (the
// pairingStatusHandler.test idiom).
function fakeTarget(): ServerInfoHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The invoke listener the handler registers, pulled from the fake target and typed for direct
// driving (extract target.handle.mock.calls[0][1] and call it — no request arg, the query has no body).
function listenerOf(
  target: ReturnType<typeof fakeTarget>
): (event: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A fake store exercising only list() — the sole method the handler calls, and the only one its
// Pick<MultiPairedServerStore, 'list'> dep type exposes. save/load/clear/loadById/clearServer are
// absent from the TYPE, so this module cannot reach a mutator or the newest-only read even by
// accident (the hostLabelHandler.test storeWithLoad idiom). No keychain, no filesystem.
function storeWithList(
  list: MultiPairedServerStore['list']
): Pick<MultiPairedServerStore, 'list'> {
  return { list }
}

// Two representative records with DISTINCT, non-overlapping sentinel values in EVERY field, so the
// "secret never crosses" substring assertions cannot false-pass by collision: no token or key is a
// substring of any `server`/`relay`, nor of the other record's credentials. Two records, not one:
// the whole point of this slice is that the answer is a collection, and a one-record fixture would
// let a still-single-valued handler pass every assertion below.
const SECRET_TOKEN_A = 'super-secret-bearer-token-alpha'
const SECRET_KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const SECRET_TOKEN_B = 'super-secret-bearer-token-bravo'
const SECRET_KEY_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='

const RECORD_A: PairedServerRecord = {
  server: 'srv-alpha',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: SECRET_TOKEN_A,
  server_static_pubkey: SECRET_KEY_A
}
const RECORD_B: PairedServerRecord = {
  server: 'srv-bravo',
  relay: 'wss://second-relay.example/v1/client',
  token: SECRET_TOKEN_B,
  server_static_pubkey: SECRET_KEY_B
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerServerInfoHandler', () => {
  it('registers exactly one handler on the server-info channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerServerInfoHandler(target, {
      store: storeWithList(vi.fn())
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(SERVER_INFO_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(SERVER_INFO_CHANNEL)
  })

  it('two records → available carrying BOTH, each with its own id and relay, in list() order (AC1)', async () => {
    const target = fakeTarget()
    const list = vi.fn(async () => [RECORD_A, RECORD_B])
    registerServerInfoHandler(target, { store: storeWithList(list) })
    const listener = listenerOf(target)

    // Deep-equal pins the whole response: exactly two entries, exactly these fields, in the order
    // list() reported them (oldest-saved first) — the handler must not re-sort. serverId ← record.server,
    // relayUrl ← record.relay, per entry (the at-rest record, never a live hello_ack value).
    expect(await listener({})).toEqual({
      status: 'available',
      servers: [
        { serverId: RECORD_A.server, relayUrl: RECORD_A.relay },
        { serverId: RECORD_B.server, relayUrl: RECORD_B.relay }
      ]
    })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('preserves list() order rather than any sort of its own (AC1)', async () => {
    const target = fakeTarget()
    // Reverse-alphabetical by server id: a client-side sort would reorder these, a pass-through won't.
    registerServerInfoHandler(target, { store: storeWithList(vi.fn(async () => [RECORD_B, RECORD_A])) })

    const response = (await listenerOf(target)({})) as { servers: Array<{ serverId: string }> }
    expect(response.servers.map((entry) => entry.serverId)).toEqual([
      RECORD_B.server,
      RECORD_A.server
    ])
  })

  it('crosses exactly serverId + relayUrl PER ENTRY and no other record field (value-free, relaxed) (AC4)', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithList(vi.fn(async () => [RECORD_A, RECORD_B])) })

    const response = (await listenerOf(target)({})) as {
      servers: Array<Record<string, unknown>>
    }
    const serialized = JSON.stringify(response)
    // Both entries' non-secret fields DO cross...
    expect(serialized).toContain(RECORD_A.server)
    expect(serialized).toContain(RECORD_A.relay)
    expect(serialized).toContain(RECORD_B.server)
    expect(serialized).toContain(RECORD_B.relay)
    // ...and NEITHER record's credentials ever do. A `...record` spread inside the map would now leak
    // one token per paired server; these four assertions are what redden on it.
    expect(serialized).not.toContain(SECRET_TOKEN_A)
    expect(serialized).not.toContain(SECRET_KEY_A)
    expect(serialized).not.toContain(SECRET_TOKEN_B)
    expect(serialized).not.toContain(SECRET_KEY_B)
    // Structural pin, top level: the available arm carries exactly status + the list, nothing else.
    expect(Object.keys(response).sort()).toEqual(['servers', 'status'])
    // Structural pin, PER ENTRY — the load-bearing half now that the fields live one level down. The
    // top-level pin alone would pass while a credential rode along inside an entry.
    for (const entry of response.servers) {
      expect(Object.keys(entry).sort()).toEqual(['relayUrl', 'serverId'])
    }
  })

  it('a single record still answers with a one-entry list', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithList(vi.fn(async () => [RECORD_A])) })

    expect(await listenerOf(target)({})).toEqual({
      status: 'available',
      servers: [{ serverId: RECORD_A.server, relayUrl: RECORD_A.relay }]
    })
  })

  it('empty collection → unavailable, never an available arm with an empty list (AC3)', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithList(vi.fn(async () => [])) })

    // Nothing paired collapses to the SAME absent outcome as unreadable — no third arm.
    expect(await listenerOf(target)({})).toEqual({ status: 'unavailable' })
  })

  it('malformed-record throw → unavailable (resolves, never rejects) (AC5)', async () => {
    const target = fakeTarget()
    const list = vi.fn(async (): Promise<PairedServerRecord[]> => {
      throw new MalformedPairedServerRecordError()
    })
    registerServerInfoHandler(target, { store: storeWithList(list) })

    // resolves, never rejects — handle must produce a value.
    await expect(listenerOf(target)({})).resolves.toEqual({ status: 'unavailable' })
  })

  it('propagated decrypt failure (a plain Error, NOT MalformedPairedServerRecordError) → unavailable, no detail crosses (AC5)', async () => {
    const target = fakeTarget()
    // A generic Error simulates the decrypt failure propagating out of secureStore.get, carrying a
    // secret-shaped keychain path in its message. Asserting a plain Error proves the handler maps
    // EVERY throw to unavailable without branching on the type.
    const KEYCHAIN_PATH = '/Users/x/Library/Keychains/login.keychain-db'
    const list = vi.fn(async (): Promise<PairedServerRecord[]> => {
      throw new Error(`decrypt failed: ${KEYCHAIN_PATH}`)
    })
    registerServerInfoHandler(target, { store: storeWithList(list) })

    const response = await listenerOf(target)({})
    expect(response).toEqual({ status: 'unavailable' })
    // The caught error is dropped, not surfaced — no path detail rides out on the absent arm.
    expect(JSON.stringify(response)).not.toContain(KEYCHAIN_PATH)
  })

  it('is log-free on every path (populated, empty, malformed, decrypt-failure) — the caught error is dropped, never logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const lists: Array<MultiPairedServerStore['list']> = [
      vi.fn(async () => [RECORD_A, RECORD_B]),
      vi.fn(async () => []),
      vi.fn(async (): Promise<PairedServerRecord[]> => {
        throw new MalformedPairedServerRecordError()
      }),
      vi.fn(async (): Promise<PairedServerRecord[]> => {
        throw new Error('decrypt failed: /Users/x/Library/Keychains/login.keychain-db')
      })
    ]
    for (const list of lists) {
      const target = fakeTarget()
      registerServerInfoHandler(target, { store: storeWithList(list) })
      await listenerOf(target)({})
    }

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
