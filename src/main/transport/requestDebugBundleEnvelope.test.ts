import { describe, it, expect } from 'vitest'
import { buildRequestDebugBundle } from './requestDebugBundleEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildSendMessage: (id, ts) → serialized request_debug_bundle bytes, no
// clock/counter/side-effects. Thinner than buildSendMessage — request_debug_bundle is a BARE
// control frame, so there is no caller-supplied payload. It uses the REAL codec so the assertion
// pins actual wire bytes, exactly like sendMessageEnvelope.test.ts.
describe('buildRequestDebugBundle', () => {
  const FIXED_TS = '2026-07-04T12:00:00.000Z'

  it('round-trips to a bare request_debug_bundle envelope carrying the exact id and ts', () => {
    const bytes = buildRequestDebugBundle({ id: 2, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_debug_bundle')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Present-but-empty payload: `{}` proves decodeEnvelope did not throw on an absent payload
    // (the "no payload" requirement is a present-but-empty value on the desktop side).
    expect(envelope.payload).toEqual({})
  })
})
