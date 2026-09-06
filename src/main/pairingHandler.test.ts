import { describe, it, expect, vi } from 'vitest'
import { registerPairingHandler, type PairingHandleTarget } from './pairingHandler'
import { PAIRING_CHANNEL, MAX_HOST_LABEL_LENGTH } from '../shared/ipc/pairing'
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

// The minimal host-label surface the handler declares — only `saveFor` since #1156 (only `save`
// before it). A spy, so "the label reaches the store under the right id and nothing else" is
// asserted on the call, not on a keychain or the filesystem. A `saveFor`-only handle still cannot
// read any label back, so the string is never materialised in the handler under test.
function fakeHostLabel(saveFor = vi.fn(async () => {})): { saveFor: ReturnType<typeof vi.fn> } {
  return { saveFor }
}

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

  it('fires onPaired once after a successful confirm, never on submit (connect-on-pair #82)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa', confirm }))
    const onPaired = vi.fn()
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare), onPaired })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    expect(onPaired).not.toHaveBeenCalled() // submit alone does not trigger a connect

    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: true })
    expect(onPaired).toHaveBeenCalledTimes(1)
    expect(onPaired).toHaveBeenCalledWith() // a bare signal — no record field crosses (AC5)
  })

  it('does NOT fire onPaired when the persist fails (AC4)', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {
      throw new Error('secret encryption is not available')
    })
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa', confirm }))
    const onPaired = vi.fn()
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare), onPaired })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: false, reason: 'persist-failed' })
    expect(onPaired).not.toHaveBeenCalled()
  })

  it('works without onPaired: a full submit→confirm resolves and does not throw', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const parse = vi.fn(parseOk)
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa', confirm }))
    registerPairingHandler(target, { parse, confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    await expect(listener({}, { type: 'confirm' })).resolves.toEqual({ ok: true })
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

// The operator-typed host label riding the confirm (#823). It reaches exactly one sink —
// hostLabel.saveFor — and only after the RECORD itself has persisted; it never enters prepare's frozen
// snapshot, never crosses back in a response, and never reaches a log.
describe('registerPairingHandler — host label on confirm (#823)', () => {
  const LABEL = 'Pyrybox'

  // A registered handler driven through a successful submit, with the spies the label tests assert on.
  function paired(
    overrides: {
      confirm?: ReturnType<typeof vi.fn>
      hostLabel?: { saveFor: ReturnType<typeof vi.fn> }
      onPaired?: ReturnType<typeof vi.fn>
    } = {}
  ): {
    listener: (event: unknown, request: unknown) => Promise<unknown>
    confirm: ReturnType<typeof vi.fn>
    hostLabel: { saveFor: ReturnType<typeof vi.fn> }
    onPaired: ReturnType<typeof vi.fn>
  } {
    const target = fakeTarget()
    const confirm = overrides.confirm ?? vi.fn(async () => {})
    const hostLabel = overrides.hostLabel ?? fakeHostLabel()
    const onPaired = overrides.onPaired ?? vi.fn()
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb', confirm }))
    registerPairingHandler(target, {
      parse: vi.fn(parseOk),
      confirmation: confirmationOf(prepare),
      hostLabel,
      onPaired
    })
    return { listener: listenerOf(target), confirm, hostLabel, onPaired }
  }

  it('persists the label through the store exactly once, verbatim, UNDER THE PAIRED SERVER’S ID (#1156)', async () => {
    const { listener, hostLabel } = paired()

    await listener({}, { type: 'submit', paste: 'good' })

    expect(await listener({}, { type: 'confirm', label: LABEL })).toEqual({ ok: true })
    expect(hostLabel.saveFor).toHaveBeenCalledTimes(1)
    // The id is the `server` off the payload the submit parsed — the same object `prepare` froze —
    // so the label is stored under exactly the record this confirm persisted.
    expect(hostLabel.saveFor).toHaveBeenCalledWith(PAYLOAD.server, LABEL)
  })

  it('stores each pairing under its OWN id, so a second machine does not overwrite the first (AC1)', async () => {
    const target = fakeTarget()
    const hostLabel = fakeHostLabel()
    const second: QrPayload = { ...PAYLOAD, server: 'srv-2' }
    const parse = vi
      .fn<(pasted: string) => ParsePairingResult>()
      .mockReturnValueOnce({ ok: true, payload: PAYLOAD })
      .mockReturnValueOnce({ ok: true, payload: second })
    registerPairingHandler(target, {
      parse,
      confirmation: confirmationOf(
        vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb', confirm: vi.fn(async () => {}) }))
      ),
      hostLabel
    })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'first' })
    await listener({}, { type: 'confirm', label: 'Pyrybox' })
    await listener({}, { type: 'submit', paste: 'second' })
    await listener({}, { type: 'confirm', label: 'Pyrybox II' })

    // Two distinct ids, in order. Before #1156 both writes landed in one un-keyed slot and the
    // second silently replaced the first machine's name.
    expect(hostLabel.saveFor.mock.calls).toEqual([
      ['srv-1', 'Pyrybox'],
      ['srv-2', 'Pyrybox II']
    ])
  })

  it('carries the id of the pairing being confirmed, not of a later submit that superseded it', async () => {
    const target = fakeTarget()
    const hostLabel = fakeHostLabel()
    const parse = vi
      .fn<(pasted: string) => ParsePairingResult>()
      .mockReturnValueOnce({ ok: true, payload: PAYLOAD })
      .mockReturnValueOnce({ ok: true, payload: { ...PAYLOAD, server: 'srv-2' } })
    registerPairingHandler(target, {
      parse,
      confirmation: confirmationOf(
        vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa:bb', confirm: vi.fn(async () => {}) }))
      ),
      hostLabel
    })
    const listener = listenerOf(target)

    // A second submit supersedes the first prepared pairing, and the id must be superseded WITH it:
    // the confirm handle and the id it belongs to are one slot, so they cannot come apart and label
    // the wrong machine — this ticket's own defect, arriving from the other direction.
    await listener({}, { type: 'submit', paste: 'first' })
    await listener({}, { type: 'submit', paste: 'second' })
    await listener({}, { type: 'confirm', label: LABEL })

    expect(hostLabel.saveFor).toHaveBeenCalledWith('srv-2', LABEL)
  })

  it('writes nothing to the label store when no label is supplied (AC2)', async () => {
    const { listener, hostLabel } = paired()

    await listener({}, { type: 'submit', paste: 'good' })

    expect(await listener({}, { type: 'confirm' })).toEqual({ ok: true })
    expect(hostLabel.saveFor).not.toHaveBeenCalled()
  })

  it('saves an empty label — a supplied value, not absence', async () => {
    const { listener, hostLabel } = paired()

    await listener({}, { type: 'submit', paste: 'good' })

    expect(await listener({}, { type: 'confirm', label: '' })).toEqual({ ok: true })
    expect(hostLabel.saveFor).toHaveBeenCalledWith(PAYLOAD.server, '')
  })

  it('rejects a non-string label at the guard; the pairing does not proceed (AC3)', async () => {
    const { listener, confirm, hostLabel } = paired()

    await listener({}, { type: 'submit', paste: 'good' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await listener({}, { type: 'confirm', label: 42 })).toEqual({
      ok: false,
      reason: 'malformed-request'
    })
    expect(hostLabel.saveFor).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled() // the record was not persisted either

    // The rejection leaves the prepared pairing intact: a malformed request must not burn a
    // fingerprint the operator already verified, so retrying with a valid label still works.
    expect(await listener({}, { type: 'confirm', label: LABEL })).toEqual({ ok: true })
    expect(confirm).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('rejects a label one over MAX_HOST_LABEL_LENGTH identically (AC3)', async () => {
    const { listener, confirm, hostLabel } = paired()

    await listener({}, { type: 'submit', paste: 'good' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(
      await listener({}, { type: 'confirm', label: 'a'.repeat(MAX_HOST_LABEL_LENGTH + 1) })
    ).toEqual({ ok: false, reason: 'malformed-request' })
    expect(hostLabel.saveFor).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a labelled confirm with nothing pending saves no label', async () => {
    const { listener, hostLabel } = paired()

    expect(await listener({}, { type: 'confirm', label: LABEL })).toEqual({
      ok: false,
      reason: 'no-pending-pairing'
    })
    expect(hostLabel.saveFor).not.toHaveBeenCalled()
  })

  it('saves no label when the RECORD persist fails (a label for an unpersisted pairing)', async () => {
    const { listener, hostLabel } = paired({
      confirm: vi.fn(async () => {
        throw new Error('secret encryption is not available')
      })
    })

    await listener({}, { type: 'submit', paste: 'good' })

    expect(await listener({}, { type: 'confirm', label: LABEL })).toEqual({
      ok: false,
      reason: 'persist-failed'
    })
    expect(hostLabel.saveFor).not.toHaveBeenCalled()
  })

  it('a failed LABEL persist still reports the pairing as succeeded, and still connects (AC5)', async () => {
    const { listener, hostLabel, onPaired } = paired({
      hostLabel: fakeHostLabel(
        vi.fn(async () => {
          throw new Error('/Users/someone/Library/Application Support/pyry: keychain unavailable')
        })
      )
    })

    await listener({}, { type: 'submit', paste: 'good' })

    // The response reports on the RECORD, which persisted. A lost nickname is not a failed pairing.
    await expect(listener({}, { type: 'confirm', label: LABEL })).resolves.toEqual({ ok: true })
    expect(hostLabel.saveFor).toHaveBeenCalledTimes(1)
    expect(onPaired).toHaveBeenCalledTimes(1)
  })

  it('persists the label BEFORE firing onPaired', async () => {
    // onPaired dials the relay and flips the renderer to the paired UI; persisting first means the
    // label is already durable when the read path (#824/#826) first asks for it.
    const order: string[] = []
    const { listener } = paired({
      hostLabel: fakeHostLabel(
        vi.fn(async () => {
          order.push('save')
        })
      ),
      onPaired: vi.fn(() => {
        order.push('paired')
      })
    })

    await listener({}, { type: 'submit', paste: 'good' })
    await listener({}, { type: 'confirm', label: LABEL })

    expect(order).toEqual(['save', 'paired'])
  })

  it('works without the hostLabel dep: a labelled confirm resolves and does not throw', async () => {
    const target = fakeTarget()
    const confirm = vi.fn(async () => {})
    const prepare = vi.fn((): PreparedPairing => ({ ok: true, fingerprint: 'aa', confirm }))
    registerPairingHandler(target, { parse: vi.fn(parseOk), confirmation: confirmationOf(prepare) })
    const listener = listenerOf(target)

    await listener({}, { type: 'submit', paste: 'good' })
    await expect(listener({}, { type: 'confirm', label: LABEL })).resolves.toEqual({ ok: true })
  })

  it('never logs on the label path — not on success, not on a failed save (AC4)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const ok = paired()
    await ok.listener({}, { type: 'submit', paste: 'good' })
    await ok.listener({}, { type: 'confirm', label: LABEL })

    const failing = paired({
      hostLabel: fakeHostLabel(
        vi.fn(async () => {
          throw new Error('keychain unavailable')
        })
      )
    })
    await failing.listener({}, { type: 'submit', paste: 'good' })
    await failing.listener({}, { type: 'confirm', label: LABEL })

    for (const spy of [warn, error, log]) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('never echoes the label back in any response (AC4)', async () => {
    const { listener } = paired()

    const submitRes = await listener({}, { type: 'submit', paste: 'good' })
    const confirmRes = await listener({}, { type: 'confirm', label: LABEL })

    for (const res of [submitRes, confirmRes]) {
      expect(JSON.stringify(res)).not.toContain(LABEL)
    }
  })
})
