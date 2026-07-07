import { describe, it, expect, vi } from 'vitest'
import type { QrPayload } from '../shared/wire/types'
import {
  parsePairingPayload,
  RELAY_ALLOWLIST,
  type ParsePairingResult,
  type RelayPolicy
} from './pairingPayload'

// Pure function — no fake, no keychain, no filesystem, no network (mirrors pairedServerStore.test.ts's
// AC5 posture, minus the injected seam this module doesn't have). The paste is untrusted text, so the
// matrix injects every malformed shape and every relay-rejection mode directly as strings.

/** base64url-encode raw UTF-8 (no padding — the daemon's RawURLEncoding). */
const b64url = (raw: string): string => Buffer.from(raw, 'utf-8').toString('base64url')

/** Build a valid pasted string from an object: JSON → base64url. Used to construct the happy case
 *  and to mutate single fields for the malformed cases (never hand-transcribe base64). */
const encode = (obj: unknown): string => b64url(JSON.stringify(obj))

const VALID: QrPayload = {
  server: 'pyrybox-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: 'tok_abc123',
  server_static_pubkey: 'c2VydmVyLXN0YXRpYy1rZXk='
}

describe('parsePairingPayload', () => {
  it('parses a well-formed payload with an allowed relay into the four fields (AC1)', () => {
    const res = parsePairingPayload(encode(VALID))
    expect(res).toEqual({ ok: true, payload: VALID })
  })

  it('drops stray keys — the payload carries exactly the four fields (AC1)', () => {
    const res = parsePairingPayload(encode({ ...VALID, extra: 'leak-me', another: 42 }))
    expect(res).toEqual({ ok: true, payload: VALID })
    if (res.ok) expect(Object.keys(res.payload).sort()).toEqual(FIELD_NAMES)
  })

  it('accepts an allowed host with or without a path, case-insensitively (AC3)', () => {
    const accepted = [
      'wss://pyrycode-relay.pyryco.de/v1/client',
      'wss://pyrycode-relay.pyryco.de',
      'wss://PYRYCODE-RELAY.PYRYCO.DE/v1/client'
    ]
    for (const relay of accepted) {
      const res = parsePairingPayload(encode({ ...VALID, relay }))
      expect(res.ok, relay).toBe(true)
    }
  })

  it('tolerates surrounding whitespace and a trailing newline (normalization)', () => {
    const res = parsePairingPayload(`  ${encode(VALID)}\n`)
    expect(res).toEqual({ ok: true, payload: VALID })
  })

  it('rejects a non-base64url outer string (AC2)', () => {
    const cases = ['!!!', 'has spaces', 'YWJj==', '']
    for (const input of cases) {
      expect(parsePairingPayload(input), input).toEqual({ ok: false, reason: 'not-base64url' })
    }
  })

  it('rejects decoded bytes that are not valid JSON, including trailing garbage (AC2)', () => {
    const cases = [
      b64url('not json'),
      b64url('{"server":"a"'), // truncated
      b64url(JSON.stringify(VALID) + 'x') // valid object then trailing garbage
    ]
    for (const input of cases) {
      expect(parsePairingPayload(input)).toEqual({ ok: false, reason: 'not-json' })
    }
  })

  it('rejects JSON that is null, a number, a string, or an array (AC2)', () => {
    for (const value of [null, 42, 'a string', []]) {
      expect(parsePairingPayload(encode(value)), JSON.stringify(value)).toEqual({
        ok: false,
        reason: 'not-object'
      })
    }
  })

  it('rejects a missing, non-string, or empty field for each of the four fields (AC2)', () => {
    for (const field of FIELD_NAMES) {
      const omitted = { ...VALID }
      delete (omitted as Record<string, unknown>)[field]
      const badShapes: unknown[] = [omitted]
      for (const bad of [42, null, {}, '']) {
        badShapes.push({ ...VALID, [field]: bad })
      }
      for (const shape of badShapes) {
        const res = parsePairingPayload(encode(shape))
        expect(res, `${field}: ${JSON.stringify(shape)}`).toEqual({
          ok: false,
          reason: 'malformed-field'
        })
      }
    }
  })

  it('rejects a relay that does not parse as a URL (AC3)', () => {
    for (const relay of ['not a url', 'wss://']) {
      expect(parsePairingPayload(encode({ ...VALID, relay })), relay).toEqual({
        ok: false,
        reason: 'relay-not-url'
      })
    }
  })

  it('rejects a relay whose scheme is not wss: (AC3)', () => {
    const host = 'pyrycode-relay.pyryco.de'
    for (const relay of [`ws://${host}/v1/client`, `https://${host}/`, `pyry://${host}/`]) {
      expect(parsePairingPayload(encode({ ...VALID, relay })), relay).toEqual({
        ok: false,
        reason: 'relay-scheme-not-wss'
      })
    }
  })

  it('rejects a relay carrying embedded credentials, even on the allowed host (AC3, security)', () => {
    const relays = [
      'wss://user:pass@pyrycode-relay.pyryco.de/v1/client',
      'wss://token@pyrycode-relay.pyryco.de/'
    ]
    for (const relay of relays) {
      expect(parsePairingPayload(encode({ ...VALID, relay })), relay).toEqual({
        ok: false,
        reason: 'relay-has-credentials'
      })
    }
  })

  it('rejects a relay whose host is not in the allowlist (AC3)', () => {
    const relays = [
      'wss://evil.example/v1/client',
      'wss://pyrycode-relay.pyryco.de.evil.example/',
      'wss://evil@pyrycode-relay.pyryco.de.evil.example/'
    ]
    for (const relay of relays) {
      expect(parsePairingPayload(encode({ ...VALID, relay })), relay).toEqual({
        ok: false,
        reason: 'relay-host-not-allowed'
      })
    }
  })

  it('single-sources the allowlist to the canonical relay host (AC4)', () => {
    expect(RELAY_ALLOWLIST.has('pyrycode-relay.pyryco.de')).toBe(true)
    expect(RELAY_ALLOWLIST.size).toBe(1)
  })

  // --- The injected relay policy (the #97 seam) ---
  // The scheme+host decision becomes a RelayPolicy injected into the 2nd param, defaulting to
  // production strictness. These cases prove the seam without importing the dev policy: the
  // URL-parse and credentials checks stay in parsePairingPayload and apply under ANY policy.

  it('defaults to the production policy — a loopback ws:// relay is rejected with no 2nd arg (#97 AC4a)', () => {
    const res = parsePairingPayload(encode({ ...VALID, relay: 'ws://127.0.0.1:5555/v1/client' }))
    expect(res).toEqual({ ok: false, reason: 'relay-scheme-not-wss' })
  })

  it('honors an injected accepting policy — a loopback ws:// relay parses into the four fields', () => {
    const relay = 'ws://127.0.0.1:5555/v1/client'
    const acceptAll: RelayPolicy = () => ({ ok: true })
    expect(parsePairingPayload(encode({ ...VALID, relay }), acceptAll)).toEqual({
      ok: true,
      payload: { ...VALID, relay }
    })
  })

  it('honors an injected rejecting policy — surfaces the policy-chosen scheme/host reason', () => {
    const rejectHost: RelayPolicy = () => ({ ok: false, reason: 'relay-host-not-allowed' })
    expect(
      parsePairingPayload(encode({ ...VALID, relay: 'wss://pyrycode-relay.pyryco.de/' }), rejectHost)
    ).toEqual({ ok: false, reason: 'relay-host-not-allowed' })
  })

  it('applies the URL-parse check before any policy — a non-URL relay is rejected under accept-all', () => {
    const acceptAll: RelayPolicy = () => ({ ok: true })
    expect(parsePairingPayload(encode({ ...VALID, relay: 'not a url' }), acceptAll)).toEqual({
      ok: false,
      reason: 'relay-not-url'
    })
  })

  it('applies the credentials check after an accepting policy — embedded userinfo still rejected (#97 AC2)', () => {
    const acceptLoopback: RelayPolicy = () => ({ ok: true })
    expect(
      parsePairingPayload(encode({ ...VALID, relay: 'ws://u:p@127.0.0.1:5555/' }), acceptLoopback)
    ).toEqual({ ok: false, reason: 'relay-has-credentials' })
  })

  it('is log-free across the happy path and every reject branch (AC5)', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    try {
      const inputs = [
        encode(VALID), // ok
        '!!!', // not-base64url
        b64url('not json'), // not-json
        encode(null), // not-object
        encode({ ...VALID, token: 42 }), // malformed-field
        encode({ ...VALID, relay: 'not a url' }), // relay-not-url
        encode({ ...VALID, relay: 'ws://pyrycode-relay.pyryco.de/' }), // relay-scheme-not-wss
        encode({ ...VALID, relay: 'wss://u:p@pyrycode-relay.pyryco.de/' }), // relay-has-credentials
        encode({ ...VALID, relay: 'wss://evil.example/' }) // relay-host-not-allowed
      ]
      for (const input of inputs) parsePairingPayload(input)
      // ...and the injected-policy path is equally log-free (the #97 seam).
      parsePairingPayload(encode({ ...VALID, relay: 'ws://127.0.0.1:5555/' }), () => ({ ok: true }))
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

const FIELD_NAMES = ['relay', 'server', 'server_static_pubkey', 'token'] as const

// Type-level: the reject arm exposes `reason`, never `payload`; the success arm exposes a QrPayload.
function _typeCheck(res: ParsePairingResult): void {
  if (res.ok) {
    const _payload: QrPayload = res.payload
    void _payload
  } else {
    const _reason: string = res.reason
    void _reason
  }
}
void _typeCheck
