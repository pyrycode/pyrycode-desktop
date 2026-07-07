import { describe, it, expect } from 'vitest'
import type { QrPayload } from '../shared/wire/types'
import { parsePairingPayload } from './pairingPayload'
import { selectRelayPolicy, LOOPBACK_RELAY_ENV_FLAG } from './relayPolicy'

// The dev affordance is exercised through its real entry point — selectRelayPolicy — never by
// importing the module-private loopbackDevRelayPolicy. Policies are applied to `new URL(relay)`
// inputs for the scheme/host verdict, or fed through parsePairingPayload for end-to-end reasons
// (the URL-parse and credentials checks live there and apply on both paths).

const b64url = (raw: string): string => Buffer.from(raw, 'utf-8').toString('base64url')
const encode = (obj: unknown): string => b64url(JSON.stringify(obj))

const VALID: QrPayload = {
  server: 'pyrybox-1',
  relay: 'wss://pyrycode-relay.pyryco.de/v1/client',
  token: 'tok_abc123',
  server_static_pubkey: 'c2VydmVyLXN0YXRpYy1rZXk='
}

const PROD_RELAY = 'wss://pyrycode-relay.pyryco.de/v1/client'

describe('selectRelayPolicy', () => {
  it('returns the production policy by default — unpackaged, no flag — rejects loopback ws:// (AC4a)', () => {
    const policy = selectRelayPolicy({ isPackaged: false, env: {} })
    expect(policy(new URL('ws://127.0.0.1:5555/'))).toEqual({
      ok: false,
      reason: 'relay-scheme-not-wss'
    })
    expect(policy(new URL(PROD_RELAY))).toEqual({ ok: true })
  })

  it('accepts a loopback ws:// relay on any port when unpackaged AND opted in (AC4b)', () => {
    const policy = selectRelayPolicy({
      isPackaged: false,
      env: { [LOOPBACK_RELAY_ENV_FLAG]: '1' }
    })
    for (const relay of ['ws://127.0.0.1:5555/', 'ws://127.0.0.1:1/', 'ws://127.0.0.1:65535/v1/client']) {
      expect(policy(new URL(relay)), relay).toEqual({ ok: true })
    }
    // the production wss:// host still passes on the dev path
    expect(policy(new URL(PROD_RELAY))).toEqual({ ok: true })
  })

  it('accepts an IPv4-canonicalized loopback host but rejects localhost, ::1, and other hosts (AC2)', () => {
    const policy = selectRelayPolicy({
      isPackaged: false,
      env: { [LOOPBACK_RELAY_ENV_FLAG]: '1' }
    })
    // WHATWG URL canonicalizes numeric IPv4 to 127.0.0.1 — genuinely loopback, so accepted.
    expect(policy(new URL('ws://2130706433/'))).toEqual({ ok: true })
    // a name and a different address are NOT normalized to 127.0.0.1 — rejected, scheme-first.
    for (const relay of ['ws://localhost/', 'ws://[::1]/', 'ws://evil.example/']) {
      expect(policy(new URL(relay)), relay).toEqual({ ok: false, reason: 'relay-scheme-not-wss' })
    }
    // a wss:// non-allowlisted host is rejected host-first, exactly as production.
    expect(policy(new URL('wss://evil.example/'))).toEqual({
      ok: false,
      reason: 'relay-host-not-allowed'
    })
  })

  it('still applies the credentials and URL-parse checks on the dev path via parsePairingPayload (AC2)', () => {
    const devPolicy = selectRelayPolicy({
      isPackaged: false,
      env: { [LOOPBACK_RELAY_ENV_FLAG]: '1' }
    })
    expect(
      parsePairingPayload(encode({ ...VALID, relay: 'ws://u:p@127.0.0.1:5555/' }), devPolicy)
    ).toEqual({ ok: false, reason: 'relay-has-credentials' })
    expect(parsePairingPayload(encode({ ...VALID, relay: 'not a url' }), devPolicy)).toEqual({
      ok: false,
      reason: 'relay-not-url'
    })
    // and a clean loopback ws:// relay parses through end-to-end on the dev path (AC4b)
    const relay = 'ws://127.0.0.1:5555/v1/client'
    expect(parsePairingPayload(encode({ ...VALID, relay }), devPolicy)).toEqual({
      ok: true,
      payload: { ...VALID, relay }
    })
  })

  it('short-circuits on isPackaged before the flag — a packaged build rejects loopback ws:// (AC4c)', () => {
    const policy = selectRelayPolicy({
      isPackaged: true,
      env: { [LOOPBACK_RELAY_ENV_FLAG]: '1' }
    })
    expect(policy(new URL('ws://127.0.0.1:5555/'))).toEqual({
      ok: false,
      reason: 'relay-scheme-not-wss'
    })
    // byte-identical to production: the allowlisted wss:// host is still accepted
    expect(policy(new URL(PROD_RELAY))).toEqual({ ok: true })
  })

  it('opts in only on the exact string "1" — every other value falls back to production', () => {
    for (const value of ['0', '', 'true', 'yes', ' 1', '1 ']) {
      const policy = selectRelayPolicy({
        isPackaged: false,
        env: { [LOOPBACK_RELAY_ENV_FLAG]: value }
      })
      expect(policy(new URL('ws://127.0.0.1:5555/')), `flag=${JSON.stringify(value)}`).toEqual({
        ok: false,
        reason: 'relay-scheme-not-wss'
      })
    }
    // unset (undefined) also falls back to production
    const unset = selectRelayPolicy({ isPackaged: false, env: {} })
    expect(unset(new URL('ws://127.0.0.1:5555/'))).toEqual({
      ok: false,
      reason: 'relay-scheme-not-wss'
    })
  })
})
