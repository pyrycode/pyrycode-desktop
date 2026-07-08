import { describe, it, expect, vi } from 'vitest'
import { parseInboundMessage } from './inboundMessage'
import { encodeEnvelope, WireDecodeError } from './codec'
import { createDiagnosticLog, type DiagnosticLog } from '../diagnosticLog'
import { MAX_PLAINTEXT_BYTES, type MessagePayload } from '../../shared/wire/types'

// parseInboundMessage sits on the untrusted→trusted boundary, mirroring parseHelloAck: it is fed
// bytes a malicious relay peer could shape. Inputs are built with the REAL codec (encodeEnvelope) so
// the assertions pin actual wire bytes, exactly like daemonConnection.test.ts's validHelloAck().
const FIXED_TS = '2026-07-04T12:00:00.000Z'

const MSG: MessagePayload = {
  conversation_id: 'c1',
  message_id: 'm1',
  role: 'assistant',
  text: 'hi there'
}
const MSG_A: MessagePayload = { conversation_id: 'c1', message_id: 'm1', role: 'user', text: 'one' }
const MSG_B: MessagePayload = {
  conversation_id: 'c1',
  message_id: 'm2',
  role: 'assistant',
  text: 'two'
}

/** A `message` envelope's plaintext bytes, wrapping an arbitrary (possibly malformed) payload. */
function encodeMessage(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 5, type: 'message', ts: FIXED_TS, payload })
}

/** A `message_chunk` envelope's plaintext bytes, wrapping an arbitrary (possibly malformed) payload. */
function encodeChunk(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 6, type: 'message_chunk', ts: FIXED_TS, payload })
}

describe('parseInboundMessage — happy', () => {
  it('narrows a valid message envelope into a message result', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })

  it('drops unknown payload keys, keeping only the four known fields', () => {
    const withExtras = encodeMessage({ ...MSG, extra: 'ignore-me', event_ptr: 99 })
    expect(parseInboundMessage(withExtras)).toEqual({ kind: 'message', message: MSG })
  })

  it('accepts both user and assistant roles', () => {
    const user: MessagePayload = { ...MSG, role: 'user' }
    expect(parseInboundMessage(encodeMessage(user))).toEqual({ kind: 'message', message: user })
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })

  it('narrows a message_chunk into an ordered batch', () => {
    const result = parseInboundMessage(encodeChunk({ messages: [MSG_A, MSG_B] }))
    expect(result).toEqual({ kind: 'chunk', messages: [MSG_A, MSG_B] })
  })

  it('treats an empty message_chunk as a valid zero-length batch', () => {
    expect(parseInboundMessage(encodeChunk({ messages: [] }))).toEqual({ kind: 'chunk', messages: [] })
  })
})

describe('parseInboundMessage — ignored envelope types (AC5)', () => {
  it('returns null for envelope types other than message / message_chunk, without throwing', () => {
    for (const type of ['ack', 'error', 'hello_ack', 'something-else']) {
      const bytes = encodeEnvelope({ id: 1, type, ts: FIXED_TS, payload: {} })
      expect(parseInboundMessage(bytes)).toBeNull()
    }
  })
})

describe('parseInboundMessage — fail-closed (AC4)', () => {
  it('throws WireDecodeError on decode-level failures inherited from the codec', () => {
    const cases: Uint8Array[] = [
      new Uint8Array([0xff, 0xfe, 0xfd]), // invalid UTF-8
      new TextEncoder().encode('{not json'), // malformed JSON
      new TextEncoder().encode('[]'), // non-object top-level
      new TextEncoder().encode(JSON.stringify({ id: 1, ts: FIXED_TS, payload: {} })), // missing type
      new TextEncoder().encode(JSON.stringify({ id: 1, type: 'message', ts: FIXED_TS })) // missing payload
    ]
    for (const bytes of cases) {
      expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
    }
  })

  it('throws when a message payload is not an object', () => {
    expect(() => parseInboundMessage(encodeMessage('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeMessage(['a']))).toThrow(WireDecodeError)
  })

  it('throws on a missing or non-string conversation_id / message_id / text', () => {
    const bad: unknown[] = [
      { ...MSG, conversation_id: undefined },
      { ...MSG, message_id: 42 },
      { ...MSG, text: undefined }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeMessage(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when role is missing, non-string, or an unknown string', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', message_id: 'm1', text: 't' }, // role absent
      { ...MSG, role: 5 }, // non-string
      { ...MSG, role: 'system' } // unknown string
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeMessage(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a message_chunk payload is not an object', () => {
    expect(() => parseInboundMessage(encodeChunk('nope'))).toThrow(WireDecodeError)
  })

  it('throws when messages is missing or not an array', () => {
    const bad: unknown[] = [{}, { messages: {} }, { messages: 'x' }, { messages: 3 }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the whole chunk closed when any single element is invalid', () => {
    const bad: unknown[] = [
      { messages: [MSG_A, 'not-an-object'] },
      { messages: [MSG_A, { ...MSG_B, text: undefined }] },
      { messages: [{ ...MSG_A, role: 'system' }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized plaintext even when the JSON would be a valid message envelope', () => {
    // Built with a raw encoder (not encodeEnvelope, which caps on encode) so the bytes ARE a valid
    // message envelope — proving the size guard, not JSON validity, is what rejects it.
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 1,
        type: 'message',
        ts: FIXED_TS,
        payload: { ...MSG, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

// A real content-free logger (#126) over a capture array — the assertions see the exact serialized
// JSON line the logger produces, so AC4 (no secret byte in the serialized line) is checked at the
// true boundary. `now` is pinned so the record is deterministic.
function captureLog(): { log: DiagnosticLog; lines: string[] } {
  const lines: string[] = []
  const log = createDiagnosticLog({ sink: { write: (line) => lines.push(line) }, now: () => FIXED_TS })
  return { log, lines }
}

const HEX64 = /^[0-9a-f]{64}$/

describe('parseInboundMessage — content-free diagnostic log (#130)', () => {
  it('logs a modeled message content-free, never a payload value (AC1, AC4)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'super-secret-conversation-text'
    const SECRET_CONV = 'secret-conversation-id'
    const payload = { conversation_id: SECRET_CONV, message_id: 'm1', role: 'user', text: SECRET_TEXT }
    const plaintext = encodeMessage(payload)

    const result = parseInboundMessage(plaintext, log)

    expect(result).toEqual({ kind: 'message', message: payload })
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('message')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(typeof record.seq).toBe('number')
    // The AC4 guarantee at the serialized boundary: the hash is there, the plaintext is not.
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain(SECRET_CONV)
  })

  it('logs a modeled message_chunk with its batch count (AC1)', () => {
    const { log, lines } = captureLog()
    const plaintext = encodeChunk({ messages: [MSG_A, MSG_B] })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('message_chunk')
    expect(record.count).toBe(2)
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
  })

  it('logs an empty message_chunk as a zero-count content-free record', () => {
    const { log, lines } = captureLog()

    parseInboundMessage(encodeChunk({ messages: [] }), log)

    const record = JSON.parse(lines[0])
    expect(record.code).toBe('message_chunk')
    expect(record.count).toBe(0)
    expect(record.hash).toMatch(HEX64)
  })

  it('logs an unmodeled envelope by type instead of silently dropping it (AC2)', () => {
    const { log, lines } = captureLog()
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })

    const result = parseInboundMessage(bytes, log)

    // The "not modeled here" behavior is unchanged: still returns null.
    expect(result).toBeNull()
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-unmodeled')
    expect(record.code).toBe('ack')
    expect(record.bytes).toBe(bytes.length)
    expect(record.hash).toMatch(HEX64)
  })

  it('caps a hostile long unmodeled type at 64 chars, one record, still null (security)', () => {
    const { log, lines } = captureLog()
    const bytes = encodeEnvelope({ id: 1, type: 'x'.repeat(200), ts: FIXED_TS, payload: {} })

    const result = parseInboundMessage(bytes, log)

    expect(result).toBeNull()
    expect(lines).toHaveLength(1) // JSON-escape holds: no split across lines.
    const record = JSON.parse(lines[0])
    expect(record.code).toBe('x'.repeat(64))
    expect(record.code.length).toBe(64)
  })

  it('hashes identical plaintext identically and different plaintext differently (recurrence signal)', () => {
    const { log, lines } = captureLog()
    const same = encodeMessage(MSG)
    const other = encodeMessage({ ...MSG, text: 'a different body' })

    parseInboundMessage(same, log)
    parseInboundMessage(same, log)
    parseInboundMessage(other, log)

    const [r0, r1, r2] = lines.map((line) => JSON.parse(line))
    expect(r0.hash).toBe(r1.hash)
    expect(r0.hash).not.toBe(r2.hash)
  })

  it('does NOT log on the throw path — a modeled message that fails to narrow', () => {
    const { log, lines } = captureLog()

    expect(() => parseInboundMessage(encodeMessage({ ...MSG, text: undefined }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('does NOT log on an oversized plaintext throw', () => {
    const { log, lines } = captureLog()
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 1,
        type: 'message',
        ts: FIXED_TS,
        payload: { ...MSG, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )

    expect(() => parseInboundMessage(bytes, log)).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does not log and does not throw when no logger is injected (AC5)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
    expect(parseInboundMessage(encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} }))).toBeNull()
    expect(() => parseInboundMessage(encodeMessage({ ...MSG, text: undefined }))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — secret-safety / log-free', () => {
  it('never logs and never echoes a payload value in a thrown error message', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const SECRET_TEXT = 'super-secret-conversation-text'
    const SECRET_CONV = 'secret-conversation-id'
    try {
      // Happy path.
      parseInboundMessage(
        encodeMessage({ conversation_id: SECRET_CONV, message_id: 'm1', role: 'user', text: SECRET_TEXT })
      )
      // Failing path: an unknown role, with the secret text/conv present as valid strings — this is
      // where a naive impl would interpolate the offending role value into the error message.
      let thrown: unknown = null
      try {
        parseInboundMessage(
          encodeMessage({
            conversation_id: SECRET_CONV,
            message_id: 'm1',
            role: 'system',
            text: SECRET_TEXT
          })
        )
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(WireDecodeError)
      const message = (thrown as Error).message
      expect(message).not.toContain('system')
      expect(message).not.toContain(SECRET_TEXT)
      expect(message).not.toContain(SECRET_CONV)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
