import { describe, it, expect } from 'vitest'
import { buildSetConversationMuted } from './setConversationMutedEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildSetSystemPrompt and uses the REAL codec, so the assertions pin wire bytes.
describe('buildSetConversationMuted', () => {
  const FIXED_TS = '2026-09-24T12:00:00.000Z'

  it('round-trips to a set_conversation_muted envelope carrying the exact id and ts', () => {
    const envelope = decodeEnvelope(
      buildSetConversationMuted({ id: 7, ts: FIXED_TS, payload: { conversation_id: 'conv-42', muted: true } })
    )
    expect(envelope.type).toBe('set_conversation_muted')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries exactly the two modeled keys for both a mute and an unmute', () => {
    // The unmute arm is the one that matters: the daemon requires `muted`, so `false` must reach the
    // wire as a PRESENT key rather than vanish the way an `undefined` would under JSON.stringify.
    for (const muted of [true, false]) {
      const payload = decodeEnvelope(
        buildSetConversationMuted({ id: 1, ts: FIXED_TS, payload: { conversation_id: 'conv-9', muted } })
      ).payload as Record<string, unknown>

      expect(Object.keys(payload)).toEqual(['conversation_id', 'muted'])
      expect(payload).toEqual({ conversation_id: 'conv-9', muted })
    }
  })
})
