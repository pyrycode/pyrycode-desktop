import { describe, it, expect } from 'vitest'
import { buildSetSessionSettings } from './setSessionSettingsEnvelope'
import { decodeEnvelope, WireEncodeError } from './codec'
import { MAX_PLAINTEXT_BYTES, type SetSessionSettingsPayload } from '../../shared/wire/types'

// The pure builder mirrors buildSendMessage: (id, ts, payload) → serialized set_session_settings
// bytes, no clock/counter/side-effects, over the REAL codec so the assertions pin actual wire bytes.
// UNLIKE buildSendMessage it is more than a mechanical clone: it enforces the omitempty PRESENCE
// CONTRACT (pyrycode #844/#845) — a field present at its zero value ('' / false) crosses the wire; an
// unset (`undefined`) field is ABSENT from the payload (not null, not a coerced zero). That present-zero
// vs omitted matrix is the heart of this slice, so it is exercised exhaustively below.
describe('buildSetSessionSettings', () => {
  const FIXED_TS = '2026-07-11T12:00:00.000Z'

  it('round-trips to a set_session_settings envelope carrying the exact id, ts, and payload', () => {
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a', model: 'opus', yolo: true }
    const bytes = buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('set_session_settings')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('keeps a present zero-value yolo (false) while OMITTING the unset model/effort keys', () => {
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a', yolo: false }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    // Present-at-zero survives (a truthiness test `if (payload.yolo)` would wrongly drop it).
    expect(decoded).toHaveProperty('yolo', false)
    // Unset optionals are ABSENT — not null, not a coerced default.
    expect(decoded).not.toHaveProperty('model')
    expect(decoded).not.toHaveProperty('effort')
    expect(decoded).toEqual({ session_id: 'sess-a', yolo: false })
  })

  it('keeps a present empty-string model ("") while OMITTING the unset effort/yolo keys', () => {
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a', model: '' }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    // '' is the daemon's clear-to-default signal — a truthiness test `if (payload.model)` would drop it.
    expect(decoded).toHaveProperty('model', '')
    expect(decoded).not.toHaveProperty('effort')
    expect(decoded).not.toHaveProperty('yolo')
    expect(decoded).toEqual({ session_id: 'sess-a', model: '' })
  })

  it('carries all five keys with exact values when every optional is present', () => {
    const payload: SetSessionSettingsPayload = {
      session_id: 'sess-a',
      model: 'opus',
      effort: 'high',
      yolo: true,
      permission_mode: 'plan'
    }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    expect(decoded).toEqual(payload)
  })

  it('carries a lone permission_mode with NO yolo key (#1021)', () => {
    // The two fields are two spellings of one posture and the daemon refuses a frame carrying both,
    // checked before the mode's value so the refusal is unconditional. Asserted on the BUILT payload
    // rather than on the type, because the type permits both and only construction keeps them apart.
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a', permission_mode: 'acceptEdits' }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    expect(decoded).toEqual({ session_id: 'sess-a', permission_mode: 'acceptEdits' })
    expect(decoded).not.toHaveProperty('yolo')
    expect(decoded).not.toHaveProperty('model')
    expect(decoded).not.toHaveProperty('effort')
  })

  it('keeps a present empty-string permission_mode — the builder tests presence, not value (#1021)', () => {
    // The daemon REFUSES permission_mode at '' (unlike model/effort, where '' clears to claude's own
    // default). That is the daemon's value policy and the builder must not pre-empt it: its contract is
    // `!== undefined`, so a truthiness test here would be wrong for the same reason it is wrong on
    // model/yolo — it would collapse the present-vs-omitted distinction the presence contract exists for.
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a', permission_mode: '' }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    expect(decoded).toHaveProperty('permission_mode', '')
    expect(decoded).toEqual({ session_id: 'sess-a', permission_mode: '' })
  })

  it('sends only session_id when all four optionals are omitted', () => {
    const payload: SetSessionSettingsPayload = { session_id: 'sess-a' }
    const decoded = decodeEnvelope(buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload })).payload

    expect(decoded).toEqual({ session_id: 'sess-a' })
    expect(decoded).not.toHaveProperty('model')
    expect(decoded).not.toHaveProperty('effort')
    expect(decoded).not.toHaveProperty('yolo')
    expect(decoded).not.toHaveProperty('permission_mode')
  })

  it('strips a smuggled extra field — the fresh literal names only the five modeled keys', () => {
    // A compromised renderer could smuggle a key past the structural-minimum guard. The builder's
    // fresh, conditionally-keyed literal must bound the wire to exactly the modeled keys.
    const decoded = decodeEnvelope(
      buildSetSessionSettings({
        id: 2,
        ts: FIXED_TS,
        payload: {
          session_id: 'sess-a',
          yolo: false,
          extra: 'smuggled'
        } as unknown as SetSessionSettingsPayload
      })
    ).payload

    expect(decoded).toEqual({ session_id: 'sess-a', yolo: false })
    expect(JSON.stringify(decoded)).not.toContain('smuggled')
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    const overCap: SetSessionSettingsPayload = { session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) }

    expect(() => buildSetSessionSettings({ id: 2, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
