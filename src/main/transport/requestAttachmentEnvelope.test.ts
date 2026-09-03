import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildRequestAttachment } from './requestAttachmentEnvelope'
import { decodeEnvelope } from './codec'
import type { RequestAttachmentPayload } from '../../shared/wire/types'

// The pure builder mirrors buildAttachmentChunk: (id, ts, payload) → serialized request_attachment
// bytes, no clock/counter/side-effects. It uses the REAL codec so the assertions pin actual wire
// bytes rather than a stub's idea of them.
describe('buildRequestAttachment', () => {
  // Lifted VERBATIM from the daemon's committed fixture
  // (pyrycode internal/protocol/testdata/request_attachment.json at f1e0a583), so a contract change
  // shows up here as a fixture diff rather than as a disagreement between two hand-written guesses.
  const FIXTURE =
    '{"id":91,"type":"request_attachment","ts":"2026-08-25T09:14:05Z","payload":' +
    '{"conversation_id":"9d4e7a21-8c05-4f3b-b6e2-1a7c9e30d5f4",' +
    '"attachment_id":"7c1d5e92-4a30-4b8f-9e21-6d4c3b0a8f55"}}'

  const PAYLOAD: RequestAttachmentPayload = {
    conversation_id: '9d4e7a21-8c05-4f3b-b6e2-1a7c9e30d5f4',
    attachment_id: '7c1d5e92-4a30-4b8f-9e21-6d4c3b0a8f55'
  }

  it('encodes the daemon fixture byte for byte', () => {
    // AC 3, and the strongest form of it available: encodeEnvelope is JSON.stringify over a
    // {id, type, ts, payload} object literal, so insertion order IS wire order and it matches the
    // daemon's fixture key for key. Comparing the decoded UTF-8 to the fixture string therefore
    // pins the type string, both key orders, and every value at once — strictly more than a
    // field-by-field round-trip, which would pass while emitting the keys in the wrong order or
    // under a misspelled type.
    //
    // The ids are placeholders upstream; neither their value nor their length is a contract. The
    // `91` is load-bearing in the daemon's own fixture PAIR only — its retrieval chunk fixture
    // rides in_reply_to 91 so the two describe one retrieval.
    const bytes = buildRequestAttachment({ id: 91, ts: '2026-08-25T09:14:05Z', payload: PAYLOAD })

    expect(new TextDecoder().decode(bytes)).toBe(FIXTURE)
  })

  it('round-trips to a request_attachment envelope carrying the exact id, ts, and payload', () => {
    const envelope = decodeEnvelope(
      buildRequestAttachment({ id: 7, ts: '2026-09-01T12:00:00.000Z', payload: PAYLOAD })
    )

    expect(envelope.type).toBe('request_attachment')
    expect(envelope.id).toBe(7)
    expect(envelope.ts).toBe('2026-09-01T12:00:00.000Z')
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('carries exactly two payload keys, and no request id of any kind', () => {
    // AC 1 and AC 2. Correlation rides the ENVELOPE, not the payload: the daemon's answering chunks
    // and its reject both name this frame through Envelope.in_reply_to. A request-id key invented
    // here would put this client at odds with fixtures the daemon has already committed.
    const envelope = decodeEnvelope(
      buildRequestAttachment({ id: 1, ts: '2026-09-01T12:00:00.000Z', payload: PAYLOAD })
    )
    const payload = envelope.payload as Record<string, unknown>

    expect(Object.keys(payload)).toEqual(['conversation_id', 'attachment_id'])
    expect(payload).not.toHaveProperty('request_id')
    expect(payload).not.toHaveProperty('requestId')
  })

  it('emits both keys when both values are empty — nothing is elided and nothing is defaulted', () => {
    // AC 2's second half. The daemon's struct has no omitempty, so both keys are always present in
    // the one direction this frame travels. The builder does NOT normalise an absent id into `''`
    // the way buildRequestSessionSettings does: a zero value can only arrive because a caller
    // passed one, never because this module minted it. That matters because a zero-valued request
    // addresses a conversation directory root rather than erroring on the far side.
    const bytes = buildRequestAttachment({
      id: 2,
      ts: '2026-09-01T12:00:00.000Z',
      payload: { conversation_id: '', attachment_id: '' }
    })

    expect(new TextDecoder().decode(bytes)).toContain('"conversation_id":"","attachment_id":""')
    expect(decodeEnvelope(bytes).payload).toEqual({ conversation_id: '', attachment_id: '' })
  })

  it('sets no in_reply_to and no event_id — this is the frame others reply to', () => {
    const envelope = decodeEnvelope(
      buildRequestAttachment({ id: 3, ts: '2026-09-01T12:00:00.000Z', payload: PAYLOAD })
    )

    expect(envelope.in_reply_to).toBeUndefined()
    expect(envelope.event_id).toBeUndefined()
  })

  it('imports only the codec and the wire types, and reaches no log line', () => {
    // AC 5's never-log half, plus the main-process-only placement. Source text, not runtime: the
    // property is about the module graph, and asserting the EXACT set fires on a `node:fs` read, an
    // `electron` import or a renderer import.
    //
    // The log grep is why the module header is worded around the literal it searches for rather
    // than quoting it — a header explaining that a module does not call something matches a test
    // looking for that same something.
    const source = readFileSync(
      resolve('src/main/transport/requestAttachmentEnvelope.ts'),
      'utf-8'
    )
    const specifiers = [...source.matchAll(/(?:\bfrom|\brequire\()\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    )

    expect([...new Set(specifiers)].sort()).toEqual(['../../shared/wire/types', './codec'])
    expect(source).not.toContain('console.')
  })
})
