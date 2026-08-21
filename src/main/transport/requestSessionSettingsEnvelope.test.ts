import { describe, it, expect } from 'vitest'
import { buildRequestSessionSettings } from './requestSessionSettingsEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestDebugBundle: (id, ts) → serialized
// request_session_settings bytes, no clock/counter/side-effects. It is a BARE control frame, so
// there is no caller-supplied payload. It uses the REAL codec so the assertion pins actual wire
// bytes, exactly like requestDebugBundleEnvelope.test.ts.
describe('buildRequestSessionSettings', () => {
  const FIXED_TS = '2026-07-27T12:00:00.000Z'

  it('round-trips to a bare request_session_settings envelope carrying the exact id and ts', () => {
    const bytes = buildRequestSessionSettings({ id: 7, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_session_settings')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
    // Present-but-empty payload: `{}` proves decodeEnvelope did not throw on an absent payload
    // (the "no payload" requirement is a present-but-empty value on the desktop side).
    expect(envelope.payload).toEqual({})
  })

  it('carries no conversation id or any other selector', () => {
    // The reply is daemon-wide. If a selector ever appears here, the daemon handler's "no
    // attacker-controlled field selects another session's data" reasoning stops holding, and the
    // request becomes rejectable for an id the daemon cannot resolve. This verb carries no selector
    // at all: an empty payload leaves nothing for the daemon to resolve, and nothing to reject.
    const envelope = decodeEnvelope(buildRequestSessionSettings({ id: 1, ts: FIXED_TS }))
    expect(Object.keys(envelope.payload as Record<string, unknown>)).toHaveLength(0)
  })
})
