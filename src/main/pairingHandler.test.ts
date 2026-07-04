import { describe, it, expect, vi } from 'vitest'
import { registerPairingHandler, type PairingHandleTarget } from './pairingHandler'
import { PAIRING_CHANNEL } from '../shared/ipc/pairing'
import type { ParsePairingResult } from './pairingPayload'
import type { PairingConfirmation, PreparedPairing } from './pairingConfirmation'
import type { QrPayload } from '../shared/wire/types'

// A structural stand-in for Electron's ipcMain: only handle/removeHandler, spied. No Electron
// harness needed — the handler is typed against the minimal target, not ipcMain.
function fakeTarget(): PairingHandleTarget & {
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  return { handle: vi.fn(), removeHandler: vi.fn() }
}

// The invoke listener the handler registers, pulled from the fake target and typed for direct
// driving (the receiveCommand.test idiom: extract source.on.mock.calls[0][1] and call it).
function listenerOf(
  target: ReturnType<typeof fakeTarget>
): (event: unknown, request: unknown) => Promise<unknown> {
  return target.handle.mock.calls[0][1]
}

// A representative validated record carrying secret-shaped values, so "no secret crosses back"
// (AC4) can assert these exact strings never appear in any response.
const SECRET_TOKEN = 'super-secret-bearer-token'
const SECRET_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const PAYLOAD: QrPayload = {
  server: 'srv-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: SECRET_TOKEN,
  server_static_pubkey: SECRET_KEY
}

const parseOk = (): ParsePairingResult => ({ ok: true, payload: PAYLOAD })
const confirmationOf = (prepare: PairingConfirmation['prepare']): PairingConfirmation => ({ prepare })

describe('registerPairingHandler', () => {
  it('registers exactly one handler on the pairing channel and unregisters that exact channel', () => {
    const target = fakeTarget()

    const unregister = registerPairingHandler(target, {
      parse: vi.fn(),
      confirmation: confirmationOf(vi.fn())
    })

    expect(target.handle).toHaveBeenCalledTimes(1)
    // Channel comes from the exported constant, not a literal — a rename can't silently pass.
    expect(target.handle).toHaveBeenCalledWith(PAIRING_CHANNEL, expect.any(Function))

    unregister()
    expect(target.removeHandler).toHaveBeenCalledTimes(1)
    expect(target.removeHandler).toHaveBeenCalledWith(PAIRING_CHANNEL)
  })

  it('resolves a malformed request (and a non-string paste) to malformed-request, untouched upstream', async () => {
    const target = fakeTarget()
    const parse = vi.fn()
    const prepare = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    expect(await listener({}, { type: 'connect' })).toEqual({ ok: false, reason: 'malformed-request' })
    expect(await listener({}, { type: 'submit', paste: 42 })).toEqual({
      ok: false,
      reason: 'malformed-request'
    })
    expect(parse).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('submit-valid returns the fingerprint and persists nothing (AC2)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb:cc', confirm }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    const res = await listener({}, { type: 'submit', paste: 'good' })

    expect(res).toEqual({ ok: true, fingerprint: 'aa:bb:cc' })
    expect(parse).toHaveBeenCalledWith('good')
    expect(prepare).toHaveBeenCalledWith(PAYLOAD)
    expect(confirm).not.toHaveBeenCalled() // nothing persisted on submit
  })

  it('submit invalid at parse stage returns invalid-paste, nothing prepared or persisted (AC2)', async () => {
    const target = fakeTarget()
    const parse = vi.fn((): ParsePairingResult => ({ ok: false, reason: 'not-base64url' }))
    const prepare = vi.fn()
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    expect(await listener({}, { type: 'submit', paste: 'bad' })).toEqual({
      ok: false,
      reason: 'invalid-paste'
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('submit invalid at key stage returns invalid-key, nothing persisted (AC2)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn()
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: false, reason: 'pubkey-wrong-length' }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    expect(await listener({}, { type: 'submit', paste: 'good-parse-bad-key' })).toEqual({
      ok: false,
      reason: 'invalid-key'
    })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirm with no prior submit returns no-pending-pairing and persists nothing (AC3)', async () => {
    const target = fakeTarget()
    registerPairingHandler(target, { parse: vi.fn(), confirmation: confirmationOf(vi.fn()) })
    const listener = listenerOf(target)

    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: false, reason: 'no-pending-pairing' })
  })

  it('confirm persists exactly once; a second confirm finds nothing pending (AC3)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb', confirm }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: true })
    expect(confirm).toHaveBeenCalledTimes(1)

    // Consume-on-confirm: the second confirm sees nothing pending, the spy stays at one call.
    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: false, reason: 'no-pending-pairing' })
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('a new submit supersedes the prior pairing; confirm persists only the newest (AC4)', async () => {
    const target = fakeTarget()
    const confirmA = vi.fn(async () => {})
    const confirmB = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi
      .fn()
      .mockReturnValueOnce({ ok: true, fingerprint: 'A', confirm: confirmA })
      .mockReturnValueOnce({ ok: true, fingerprint: 'B', confirm: confirmB })
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'first' })
    await listener({}, { type: 'submit', paste: 'second' })
    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: true })

    expect(confirmB).toHaveBeenCalledTimes(1)
    expect(confirmA).not.toHaveBeenCalled() // the superseded record is unpersistable
  })

  it('a new submit that fails also drops the prior pairing, leaving nothing to confirm (AC4)', async () => {
    const target = fakeTarget()
    const confirmA = vi.fn(async () => {})
    const parse = vi
      .fn()
      .mockReturnValueOnce({ ok: true, payload: PAYLOAD })
      .mockReturnValueOnce({ ok: false, reason: 'not-base64url' })
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'A', confirm: confirmA }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'first-good' })
    expect(await listener({}, { type: 'submit', paste: 'second-bad' })).toEqual({
      ok: false,
      reason: 'invalid-paste'
    })
    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: false, reason: 'no-pending-pairing' })
    expect(confirmA).not.toHaveBeenCalled()
  })

  it('maps a confirm() throw to persist-failed and still resolves (never rejects)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {
      throw new Error('secret encryption is not available')
    })
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa', confirm }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    await expect(listener({}, { type: 'confirm' })).resolves.toEqual({
      ok: false,
      reason: 'persist-failed'
    })
  })

  it('never returns the token or server key in any response (AC4)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb:cc', confirm }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    const submitRes = await listener({}, { type: 'submit', paste: 'good' })
    const confirmRes = await listener({}, { type: 'confirm' })

    for (const res of [submitRes, confirmRes]) {
      const serialized = JSON.stringify(res)
      expect(serialized).not.toContain(SECRET_TOKEN)
      expect(serialized).not.toContain(SECRET_KEY)
      expect(serialized).not.toContain(PAYLOAD.server)
      expect(serialized).not.toContain(PAYLOAD.relay)
    }
  })
})
