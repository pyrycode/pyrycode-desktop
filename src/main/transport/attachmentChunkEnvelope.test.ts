import { describe, it, expect } from 'vitest'
import { buildAttachmentChunk } from './attachmentChunkEnvelope'
import { decodeEnvelope, base64StdEncode, WireEncodeError } from './codec'
import {
  MAX_PLAINTEXT_BYTES,
  ATTACHMENT_CHUNK_DATA_BYTES,
  ATTACHMENT_ID_MAX_BYTES,
  ATTACHMENT_FILENAME_MAX_BYTES,
  ATTACHMENT_MIME_TYPE_MAX_BYTES,
  type AttachmentChunkPayload
} from '../../shared/wire/types'

// The pure builder mirrors buildDequeueMessage: (id, ts, payload) → serialized attachment_chunk
// bytes, no clock/counter/side-effects. One envelope per chunk — each gets its own id and ts from
// the consumer (#861), which is what iterating a plan means. It uses the REAL codec so the
// assertions pin actual wire bytes, including the MAX_PLAINTEXT_BYTES cap encodeEnvelope enforces.
describe('buildAttachmentChunk', () => {
  const FIXED_TS = '2026-09-01T12:00:00.000Z'
  const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const PAYLOAD: AttachmentChunkPayload = {
    conversation_id: 'conv-1',
    attachment_id: 'att-1',
    index: 0,
    total_chunks: 2,
    filename: 'notes.txt',
    mime_type: 'text/plain',
    size: 45001,
    sha256: SHA256,
    data: 'aGVsbG8='
  }

  it('round-trips to an attachment_chunk envelope carrying the exact id, ts, and payload', () => {
    const bytes = buildAttachmentChunk({ id: 3, ts: FIXED_TS, payload: PAYLOAD })

    const envelope = decodeEnvelope(bytes)
    expect(envelope.type).toBe('attachment_chunk')
    expect(envelope.id).toBe(3)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('carries all nine fields, conversation_id among them — the daemon requires it (#1205)', () => {
    // The frame USED to carry no conversation_id, and this test pinned the omission as a security
    // property: the daemon filed an upload under its follow-active cursor, so a client could not
    // steer bytes by naming a conversation. pyrycode #2143 retired that cursor and now REFUSES a chunk
    // without the field, validating the one it gets against the daemon's registry instead. Pinned so a
    // "tidy" removal of the field reddens here rather than in the operator's composer.
    const envelope = decodeEnvelope(buildAttachmentChunk({ id: 1, ts: FIXED_TS, payload: PAYLOAD }))
    const payload = envelope.payload as Record<string, unknown>

    expect(Object.keys(payload).sort()).toEqual([
      'attachment_id',
      'conversation_id',
      'data',
      'filename',
      'index',
      'mime_type',
      'sha256',
      'size',
      'total_chunks'
    ])
  })

  it('keeps a maximal chunk inside MAX_PLAINTEXT_BYTES — 45000 raw bytes plus every ceiling', () => {
    // AC 3, and the arithmetic justification for the number 45000: base64 of 45000 raw bytes is
    // exactly 60000 characters (45000 divides by 3, so no padding), leaving room for every metadata
    // field at its byte ceiling. Measured against the imported constant, never a literal 65519.
    const maximal: AttachmentChunkPayload = {
      conversation_id: 'c'.repeat(ATTACHMENT_ID_MAX_BYTES),
      attachment_id: 'a'.repeat(ATTACHMENT_ID_MAX_BYTES),
      index: 0,
      total_chunks: 1000,
      filename: 'f'.repeat(ATTACHMENT_FILENAME_MAX_BYTES),
      mime_type: 'm'.repeat(ATTACHMENT_MIME_TYPE_MAX_BYTES),
      size: 45_000_000,
      sha256: SHA256,
      data: base64StdEncode(new Uint8Array(ATTACHMENT_CHUNK_DATA_BYTES))
    }

    expect(maximal.data).toHaveLength(60000)
    expect(() => buildAttachmentChunk({ id: 1, ts: FIXED_TS, payload: maximal })).not.toThrow()
    expect(buildAttachmentChunk({ id: 1, ts: FIXED_TS, payload: maximal }).length).toBeLessThanOrEqual(
      MAX_PLAINTEXT_BYTES
    )
  })

  it('keeps a maximal chunk inside the cap when the ceilings are spent on multi-byte text', () => {
    // The byte-vs-rune trap: the three ceilings count encoded UTF-8 bytes, so an 'f'.repeat(255)
    // fixture is 255 bytes only because it is ASCII. These two are built to 255 BYTES — 127 and 63
    // characters respectively — which is what the daemon's bound actually admits.
    const twoByte = 'é'.repeat(127) + 'a' // 127 * 2 + 1 = 255 bytes
    const fourByte = '🙂'.repeat(63) + 'abc' // 63 * 4 + 3 = 255 bytes
    expect(Buffer.byteLength(twoByte, 'utf8')).toBe(ATTACHMENT_FILENAME_MAX_BYTES)
    expect(Buffer.byteLength(fourByte, 'utf8')).toBe(ATTACHMENT_MIME_TYPE_MAX_BYTES)

    const maximal: AttachmentChunkPayload = {
      conversation_id: 'ö'.repeat(ATTACHMENT_ID_MAX_BYTES / 2),
      attachment_id: 'ä'.repeat(ATTACHMENT_ID_MAX_BYTES / 2),
      index: 999,
      total_chunks: 1000,
      filename: twoByte,
      mime_type: fourByte,
      size: 45_000_000,
      sha256: SHA256,
      data: base64StdEncode(new Uint8Array(ATTACHMENT_CHUNK_DATA_BYTES))
    }

    const bytes = buildAttachmentChunk({ id: 1, ts: FIXED_TS, payload: maximal })
    expect(bytes.length).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES)
    expect(decodeEnvelope(bytes).payload).toEqual(maximal)
  })

  it('throws WireEncodeError when the envelope exceeds the plaintext cap', () => {
    // The inherited backstop, asserted so it is a tested guarantee rather than an assumed one: an
    // over-cap envelope never reaches the wire and is never silently truncated. #861 catches this
    // and drops the send; this module adds no validator of its own.
    const overCap: AttachmentChunkPayload = {
      ...PAYLOAD,
      filename: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }

    expect(() => buildAttachmentChunk({ id: 3, ts: FIXED_TS, payload: overCap })).toThrow(
      WireEncodeError
    )
  })
})
