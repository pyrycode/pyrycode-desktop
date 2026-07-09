import { describe, it, expect } from 'vitest'
import { buildListConversations } from './listConversationsEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestDebugBundle: (id, ts) → serialized list_conversations bytes,
// no clock/counter/side-effects. list_conversations is a BARE control frame (empty payload), so there
// is no caller-supplied payload. It uses the REAL codec so the assertion pins actual wire bytes,
// exactly like requestDebugBundleEnvelope.test.ts.
describe('buildListConversations', () => {
  const FIXED_TS = '2026-07-10T12:00:00.000Z'

  it('round-trips to a bare list_conversations envelope carrying the exact id and ts', () => {
    const bytes = buildListConversations({ id: 2, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('list_conversations')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Present-but-empty payload: `{}` proves decodeEnvelope did not throw on an absent payload
    // (the "no payload" requirement is a present-but-empty value on the desktop side, never `null`).
    expect(envelope.payload).toEqual({})
  })
})
