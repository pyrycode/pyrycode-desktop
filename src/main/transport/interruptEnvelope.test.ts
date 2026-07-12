import { describe, it, expect } from 'vitest'
import { buildInterrupt } from './interruptEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestDebugBundle: (id, ts) → serialized interrupt bytes, no
// clock/counter/side-effects. interrupt is a BARE control frame, so there is no caller-supplied
// payload. It uses the REAL codec so the assertion pins actual wire bytes, exactly like
// requestDebugBundleEnvelope.test.ts.
describe('buildInterrupt', () => {
  const FIXED_TS = '2026-07-04T12:00:00.000Z'

  it('round-trips to a bare interrupt envelope carrying the exact id and ts', () => {
    const bytes = buildInterrupt({ id: 7, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('interrupt')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
    // Present-but-empty payload: `{}` proves decodeEnvelope did not throw on an absent payload —
    // the "no payload" requirement is a present-but-empty value on the desktop side (codec.ts:133).
    expect(envelope.payload).toEqual({})
  })
})
