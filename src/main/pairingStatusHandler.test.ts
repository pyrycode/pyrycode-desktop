import { describe, it, expect, vi } from 'vitest'
import { registerPairingStatusHandler, type PairingStatusHandleTarget } from './pairingStatusHandler'
import { PAIRING_STATUS_CHANNEL } from '../shared/ipc/pairingStatus'
import {
  MalformedPairedServerRecordError,
  type PairedServerRecord,
  type PairedServerStore
} from './pairedServerStore'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain (the
// pairingHandler.test idiom).
function fakeTarget(): PairingStatusHandleTarget & {
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

// A representative record carrying secret-shaped values, so "no secret crosses back" can assert
// these exact strings never appear in the paired response.
const SECRET_TOKEN = 'super-secret-bearer-token'
const SECRET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const RECORD: PairedServerRecord = {
  server: 'srv-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: SECRET_TOKEN,
  server_static_pubkey: SECRET_KEY
}

describe('registerPairingStatusHandler', () => {
  it('registers exactly one handler on the status channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerPairingStatusHandler(target, {
      store: storeWithLoad(vi.fn())
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(PAIRING_STATUS_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(PAIRING_STATUS_CHANNEL)
  })

  it('present/valid record → paired', async () => {
    const target = fakeTarget()
    registerPairingStatusHandler(target, { store: storeWithLoad(vi.fn(async () => RECORD)) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ status: 'paired' })
  })

  it('absent record (null) → not-paired', async () => {
    const target = fakeTarget()
    registerPairingStatusHandler(target, { store: storeWithLoad(vi.fn(async () => null)) })
    const listener = listenerOf(target)

    expect(await listener({})).toEqual({ status: 'not-paired' })
  })

  it('malformed-record throw → error (never collapsed into not-paired)', async () => {
    const target = fakeTarget()
    const load = vi.fn(async () => {
      throw new MalformedPairedServerRecordError()
    })
    registerPairingStatusHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    // resolves, never rejects — handle must produce a value.
    await expect(listener({})).resolves.toEqual({ status: 'error' })
  })

  it('propagated decrypt failure (a plain Error, NOT MalformedPairedServerRecordError) → error', async () => {
    const target = fakeTarget()
    // A generic Error simulates the decrypt failure propagating out of secureStore.get. Asserting a
    // plain Error here proves the handler maps EVERY throw to error without branching on the type.
    const load = vi.fn(async () => {
      throw new Error('decrypt failed: /Users/x/Library/keychain detail')
    })
    registerPairingStatusHandler(target, { store: storeWithLoad(load) })
    const listener = listenerOf(target)

    await expect(listener({})).resolves.toEqual({ status: 'error' })
  })

  it('never returns any record field in the paired response (value-free)', async () => {
    const target = fakeTarget()
    registerPairingStatusHandler(target, { store: storeWithLoad(vi.fn(async () => RECORD)) })
    const listener = listenerOf(target)

    const serialized = JSON.stringify(await listener({}))
    expect(serialized).not.toContain(SECRET_TOKEN)
    expect(serialized).not.toContain(SECRET_KEY)
    expect(serialized).not.toContain(RECORD.server)
    expect(serialized).not.toContain(RECORD.relay)
  })
})
