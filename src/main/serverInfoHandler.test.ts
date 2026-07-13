import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerServerInfoHandler, type ServerInfoHandleTarget } from './serverInfoHandler'
import { SERVER_INFO_CHANNEL } from '../shared/ipc/serverInfo'
import {
  MalformedPairedServerRecordError,
  type PairedServerRecord,
  type PairedServerStore
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

// A fake store exercising only load() — the sole method the handler calls. save() is present to
// satisfy the interface but never invoked; no keychain, no filesystem.
function storeWithLoad(load: PairedServerStore['load']): PairedServerStore {
  return { save: vi.fn(async () => {}), load }
}

// A representative record with DISTINCT, non-overlapping sentinel values per field, so the
// "secret never crosses" substring assertions cannot false-pass by collision: SECRET_TOKEN and
// SECRET_KEY are not substrings of `server`/`relay`, nor of each other.
const SECRET_TOKEN = 'super-secret-bearer-token'
const SECRET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const RECORD: PairedServerRecord = {
  server: 'srv-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: SECRET_TOKEN,
  server_static_pubkey: SECRET_KEY
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerServerInfoHandler', () => {
  it('registers exactly one handler on the server-info channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerServerInfoHandler(target, {
      store: storeWithLoad(vi.fn())
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(SERVER_INFO_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(SERVER_INFO_CHANNEL)
  })

  it('present record → available, sourced from server/relay (the disconnected-safe fields)', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithLoad(vi.fn(async () => RECORD)) })
    const listener = listenerOf(target)

    // Deep-equal pins EXACTLY these keys — a stray token/server_static_pubkey field would fail.
    // serverId ← record.server, relayUrl ← record.relay (the at-rest record, not any live value).
    expect(await listener({})).toEqual({
      status: 'available',
      serverId: RECORD.server,
      relayUrl: RECORD.relay
    })
  })

  it('crosses exactly serverId + relayUrl and NO other record field (value-free, relaxed)', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithLoad(vi.fn(async () => RECORD)) })
    const listener = listenerOf(target)

    const response = await listener({})
    const serialized = JSON.stringify(response)
    // The two non-secret fields DO cross...
    expect(serialized).toContain(RECORD.server)
    expect(serialized).toContain(RECORD.relay)
    // ...the two credentials never do (the inverse of pairingStatus, which asserts none of the four).
    expect(serialized).not.toContain(SECRET_TOKEN)
    expect(serialized).not.toContain(SECRET_KEY)
    // Structural pin: the available arm carries exactly status + the two data fields, nothing else.
    expect(Object.keys(response as object).sort()).toEqual(['relayUrl', 'serverId', 'status'])
  })

  it('absent record (null) → unavailable', async () => {
    const target = fakeTarget()
    registerServerInfoHandler(target, { store: storeWithLoad(vi.fn(async () => null)) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ status: 'unavailable' })
  })

  it('malformed-record throw → unavailable (resolves, never rejects)', async () => {
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new MalformedPairedServerRecordError()
    })
    registerServerInfoHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    // resolves, never rejects — handle must produce a value.
    await expect(listener({})).resolves.toEqual({ status: 'unavailable' })
  })

  it('propagated decrypt failure (a plain Error, NOT MalformedPairedServerRecordError) → unavailable, no detail crosses', async () => {
    const target = fakeTarget()
    // A generic Error simulates the decrypt failure propagating out of secureStore.get, carrying a
    // secret-shaped keychain path in its message. Asserting a plain Error proves the handler maps
    // EVERY throw to unavailable without branching on the type.
    const KEYCHAIN_PATH = '/Users/x/Library/Keychains/login.keychain-db'
    const load = vi.fn(async () => {
      throw new Error(`decrypt failed: ${KEYCHAIN_PATH}`)
    })
    registerServerInfoHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    const response = await listener({})
    expect(response).toEqual({ status: 'unavailable' })
    // The caught error is dropped, not surfaced — no path detail rides out on the absent arm.
    expect(JSON.stringify(response)).not.toContain(KEYCHAIN_PATH)
  })

  it('is log-free on every path (present, null, malformed, decrypt-failure) — the caught error is dropped, never logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const loads: Array<PairedServerStore['load']> = [
      vi.fn(async () => RECORD),
      vi.fn(async () => null),
      vi.fn(async () => {
        throw new MalformedPairedServerRecordError()
      }),
      vi.fn(async () => {
        throw new Error('decrypt failed: /Users/x/Library/Keychains/login.keychain-db')
      })
    ]
    for (const load of loads) {
      const target = fakeTarget()
      registerServerInfoHandler(target, { store: storeWithLoad(load) })
      await listenerOf(target)({})
    }

    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
