import { describe, it, expect } from 'vitest'
import { buildRequestSessionSettings } from './requestSessionSettingsEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildDequeueMessage: (id, ts, optional conversationId) → serialized
// request_session_settings bytes, no clock/counter/side-effects. It uses the REAL codec so the
// assertion pins actual wire bytes, exactly like requestDebugBundleEnvelope.test.ts.
describe('buildRequestSessionSettings', () => {
  const FIXED_TS = '2026-07-27T12:00:00.000Z'

  it('round-trips to a request_session_settings envelope carrying the exact id and ts', () => {
    const bytes = buildRequestSessionSettings({ id: 7, ts: FIXED_TS })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('request_session_settings')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
    // A caller that names no conversation still emits the key, holding ''. The daemon's field has no
    // `omitempty`, so absent and empty are the same case for it — and '' is the case this client sent
    // before #945 in a different dress (a request that addresses nothing → the zero reply).
    expect(envelope.payload).toEqual({ conversation_id: '' })
  })

  it('carries the named conversation id verbatim', () => {
    // The id is CLIENT-OWNED — it comes from the renderer's own conversation state, never off the
    // network — and it is asserted distinct from every other string field on the envelope so a
    // transposition against `ts` cannot pass. It travels as a JSON string field into encodeEnvelope
    // and reaches no log line, no path, no attribute and no cache key, on either side of the wire:
    // upstream (internal/protocol/settings.go) uses it for exactly one in-memory resolution through
    // the handler's conversation-keyed run-configuration seam. An id the daemon cannot resolve is
    // answered with a zero-valued SessionSettingsPayload — never an error frame, and never another
    // session's values — so a wrong id degrades to the pre-#945 behaviour rather than leaking.
    const envelope = decodeEnvelope(
      buildRequestSessionSettings({ id: 1, ts: FIXED_TS, conversationId: 'conv-42' })
    )
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('emits conversation_id as its only key, in both shapes', () => {
    // The surviving half of the pre-#945 "no selector" assertion: exactly one field reaches the wire,
    // always present and always a string — never omitted, never null. A second selector appearing
    // here would be a new way to address someone else's data, and would fail this.
    for (const input of [
      { id: 1, ts: FIXED_TS },
      { id: 2, ts: FIXED_TS, conversationId: 'conv-42' }
    ]) {
      const payload = decodeEnvelope(buildRequestSessionSettings(input)).payload as Record<
        string,
        unknown
      >
      expect(Object.keys(payload)).toEqual(['conversation_id'])
      expect(typeof payload.conversation_id).toBe('string')
    }
  })
})
