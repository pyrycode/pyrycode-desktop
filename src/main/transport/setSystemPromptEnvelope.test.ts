import { describe, it, expect } from 'vitest'
import { buildSetSystemPrompt } from './setSystemPromptEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildChangeWorkspace: (id, ts, payload) → serialized set_system_prompt
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire
// bytes, exactly like its neighbours. What is unlike every neighbour is the TRI-STATE second field:
// three distinct wire shapes have to survive JSON serialization, and the `null` one is the whole
// clear path.
describe('buildSetSystemPrompt', () => {
  const FIXED_TS = '2026-09-07T12:00:00.000Z'

  it('round-trips to a set_system_prompt envelope carrying the exact id and ts', () => {
    const bytes = buildSetSystemPrompt({
      id: 7,
      ts: FIXED_TS,
      payload: { conversation_id: 'conv-42', system_prompt: 'be terse' }
    })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('set_system_prompt')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries a text prompt verbatim beside the named conversation id', () => {
    // Both fields are asserted distinct from every other string on the envelope so a transposition
    // against `ts` — or between the two payload fields — cannot pass. The prompt travels as a JSON
    // string field into encodeEnvelope and reaches no log line, no path and no cache key on the way.
    const envelope = decodeEnvelope(
      buildSetSystemPrompt({
        id: 1,
        ts: FIXED_TS,
        payload: { conversation_id: 'conv-42', system_prompt: 'answer in Finnish' }
      })
    )

    expect(envelope.payload).toEqual({
      conversation_id: 'conv-42',
      system_prompt: 'answer in Finnish'
    })
  })

  it('sends an explicitly empty prompt as "" rather than as a clear', () => {
    // The middle state. `''` is a DISTINCT stored state daemon-side — it spawns identically to
    // cleared, but it is stored, and a client that read it back must be able to write it back
    // unchanged. A `|| null` or a truthiness read anywhere on this path collapses it into the arm
    // below and this reddens.
    const payload = decodeEnvelope(
      buildSetSystemPrompt({
        id: 2,
        ts: FIXED_TS,
        payload: { conversation_id: 'conv-7', system_prompt: '' }
      })
    ).payload as Record<string, unknown>

    expect(payload.system_prompt).toBe('')
  })

  it('sends a clear as a PRESENT key holding a literal null, never an absent key', () => {
    // The clear path, and the assertion that pins it is `'system_prompt' in payload` rather than a
    // bare equality: JSON.stringify DROPS a key whose value is `undefined`, so a builder that reached
    // for `?? undefined` — or that typed the field optional and let a caller omit it — would emit a
    // two-field envelope minus one field and still satisfy a `toBe(null)`-shaped check against
    // `payload.system_prompt`, which reads `undefined` off a missing key. The daemon decodes an absent
    // key and an explicit null identically, so this is a mirroring rule rather than a behavioural one:
    // the field is `*string` with no `omitempty`, so nil serializes as `null`.
    const payload = decodeEnvelope(
      buildSetSystemPrompt({
        id: 3,
        ts: FIXED_TS,
        payload: { conversation_id: 'conv-7', system_prompt: null }
      })
    ).payload as Record<string, unknown>

    expect('system_prompt' in payload).toBe(true)
    expect(payload.system_prompt).toBeNull()
  })

  it('emits exactly the two modeled keys on every arm of the tri-state', () => {
    // Exactly two fields reach the wire. A third appearing here would be a new way to address someone
    // else's data, and would fail this — the assertion is the fresh-literal construction's detector,
    // so a later `...spread` of a caller's object reddens here. Checked on all three arms because the
    // key SET is what a spread would widen, and the clear arm is the one whose key could also vanish.
    for (const systemPrompt of ['be terse', '', null]) {
      const payload = decodeEnvelope(
        buildSetSystemPrompt({
          id: 4,
          ts: FIXED_TS,
          payload: { conversation_id: 'conv-9', system_prompt: systemPrompt }
        })
      ).payload as Record<string, unknown>

      expect(Object.keys(payload)).toEqual(['conversation_id', 'system_prompt'])
      expect(typeof payload.conversation_id).toBe('string')
    }
  })

  it('applies no length bound of its own — the refusal that reports lives one layer up', () => {
    // NOT an endorsement of building an over-length frame. The builder cannot emit an outcome, and a
    // bound that fails silently here is exactly the "thrown away" refusal AC2 forbids; the bound that
    // reports is in the connection method, which emits systemPromptWriteRejected('prompt-too-long')
    // and never reaches this function. What this pins is that the builder invents no second, weaker
    // policy that would have to be kept in agreement with that one.
    const oversized = 'x'.repeat(9000)
    const payload = decodeEnvelope(
      buildSetSystemPrompt({
        id: 5,
        ts: FIXED_TS,
        payload: { conversation_id: 'conv-9', system_prompt: oversized }
      })
    ).payload as Record<string, unknown>

    expect(payload.system_prompt).toBe(oversized)
  })

  it('sends an empty conversation id as written, with no normalisation of its own', () => {
    // The sibling builders' rule: no `?? ''` and no emptiness check that would duplicate a bound one
    // layer up. Keeping an unroutable id off the wire is the IPC arm's routing lookup, and a builder
    // that silently substituted a fallback would address a conversation the caller never named.
    const payload = decodeEnvelope(
      buildSetSystemPrompt({
        id: 6,
        ts: FIXED_TS,
        payload: { conversation_id: '', system_prompt: 'be terse' }
      })
    ).payload as Record<string, unknown>

    expect(payload.conversation_id).toBe('')
  })
})
