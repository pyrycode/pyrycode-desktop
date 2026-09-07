import { describe, it, expect } from 'vitest'
import { buildRequestHistory } from './requestHistoryEnvelope'
import { decodeEnvelope } from './codec'

// The pure builder mirrors buildRequestModelList: (id, ts, conversationId, cursor, limit) →
// serialized request_history bytes, no clock/counter/side-effects. It uses the REAL codec so every
// assertion pins actual wire bytes.
//
// TWO PROPERTIES HERE ARE CONTRACT RATHER THAN STYLE, and both are absent from that neighbour. The
// three keys are ALWAYS present (the daemon declares no `omitempty` on any of them), which is what
// the key-set assertions pin; and `limit` normalises to the published "daemon chooses" value rather
// than ever going out negative, which is what the table-driven case below pins.
describe('buildRequestHistory', () => {
  const FIXED_TS = '2026-09-07T12:00:00.000Z'
  const BASE = { id: 7, ts: FIXED_TS, conversationId: 'conv-42', cursor: '', limit: 50 }

  it('round-trips to a request_history envelope carrying the exact id and ts', () => {
    const envelope = decodeEnvelope(buildRequestHistory(BASE))

    expect(envelope.type).toBe('request_history')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('emits all three keys, and only those three', () => {
    // ALL THREE ALWAYS PRESENT is the daemon's published contract, not an incidental shape: it
    // declares no `omitempty`, so a decoder on either side may rely on all three. The exact key set
    // is also the fresh-literal construction's detector — a later `...spread` of a caller's object
    // would let a fourth field through and redden here, and a fourth field would be a second way to
    // address someone else's data.
    const payload = decodeEnvelope(buildRequestHistory(BASE)).payload as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual(['conversation_id', 'cursor', 'limit'])
    expect(typeof payload.conversation_id).toBe('string')
    expect(typeof payload.cursor).toBe('string')
    expect(typeof payload.limit).toBe('number')
  })

  it('drops a field smuggled past the boundary guard', () => {
    // The structural-minimum guard in commands.ts accepts extra properties; this rebuild is what
    // bounds the outbound wire to the three published keys BY CONSTRUCTION rather than by
    // discipline. The cast is the point of the test — it simulates the untrusted extra field.
    const smuggled = { ...BASE, session_id: 'not-a-field-of-this-frame' } as Parameters<
      typeof buildRequestHistory
    >[0]

    const payload = decodeEnvelope(buildRequestHistory(smuggled)).payload as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual(['conversation_id', 'cursor', 'limit'])
  })

  it('carries the conversation id verbatim', () => {
    // CLIENT-OWNED — from this app's own conversation state, never off the network — and asserted
    // distinct from every other string on the envelope so a transposition against `ts` or `cursor`
    // cannot pass. An id the daemon cannot resolve draws `conversation.not_found`, never another
    // conversation's log.
    const payload = decodeEnvelope(buildRequestHistory(BASE)).payload as Record<string, unknown>

    expect(payload.conversation_id).toBe('conv-42')
  })

  it('emits an empty opening cursor rather than omitting the key', () => {
    // `''` MEANS "START AT THE NEWEST" and is the normal opening value of every walk, not a missing
    // one. Omitting the key — or normalising the value to anything else — would break the first ask
    // of every walk, which is the whole reason this case is pinned separately from the key-set test.
    const payload = decodeEnvelope(buildRequestHistory({ ...BASE, cursor: '' }))
      .payload as Record<string, unknown>

    expect(payload).toHaveProperty('cursor')
    expect(payload.cursor).toBe('')
  })

  it('echoes an opaque cursor byte for byte, never parsing or rewriting it', () => {
    // A CLIENT MUST NOT PARSE A CURSOR. The daemon mints it, this client stores it and hands it back
    // unexamined; the daemon's own parseCursor is the only thing anywhere that reads one. The value
    // below is the daemon's committed example — base64-shaped, with the padding and the case mix
    // that a "tidying" normalisation would disturb.
    const opaque = 'MS4zZjhiMWMwNC05ZDI3LTRlNWEtYjZjMS0yZTlmNzBkOGE0MTMuNy40MDk2'

    const payload = decodeEnvelope(buildRequestHistory({ ...BASE, cursor: opaque }))
      .payload as Record<string, unknown>

    expect(payload.cursor).toBe(opaque)
  })

  it.each([
    ['a positive ask, passed through unclamped', 4096, 4096],
    ['a positive ask far above the daemon ceiling, still unclamped', 999_999, 999_999],
    ['an omitted ask', undefined, 0],
    ['an explicit zero', 0, 0],
    ['a negative ask', -1, 0],
    ['a large negative ask', -4096, 0],
    ['a non-finite ask', Number.NaN, 0],
    ['an infinite ask', Number.POSITIVE_INFINITY, 0]
  ])('normalises %s', (_label, limit, expected) => {
    // `0` is the daemon's published "you choose" value and NEVER means zero entries, so an absent or
    // non-positive ask becomes `0` rather than going out as a reject (`history.invalid_page_size`)
    // or as a `null` (JSON.stringify's rendering of NaN/Infinity, which would break the
    // always-a-number contract). There is NO upper clamp: the daemon clamps at history.MaxPageEntries
    // and re-asks a too-large page at a smaller size, so a client-invented ceiling would be a second
    // bound to keep in agreement — and one below 4096 would drop valid pages.
    const payload = decodeEnvelope(buildRequestHistory({ ...BASE, limit })).payload as Record<
      string,
      unknown
    >

    expect(payload.limit).toBe(expected)
  })
})
