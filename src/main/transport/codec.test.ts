import { describe, it, expect } from 'vitest'
import {
  base64StdEncode,
  base64StdDecode,
  encodeInnerFrame,
  decodeInnerFrame,
  encodeEnvelope,
  decodeEnvelope,
  makeHelloClientPayload,
  WireDecodeError
} from './codec'
import type {
  Envelope,
  InnerFrameV2,
  HelloAckPayload,
  MessagePayload,
  MessageChunkPayload,
  SendMessagePayload,
  BackfillSincePayload,
  ErrorPayload,
  QrPayload
} from '../../shared/wire/types'

// Fixtures are byte-derived from the mobile Kotlin wire models (MobileWireModels.kt /
// MessagePayload.kt): snake_case field names, base64-std alphabet, defaults always emitted,
// absent optionals omitted (never null). Round-tripping every payload type is AC #5.

const utf8 = new TextDecoder('utf-8')
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('base64StdEncode / base64StdDecode', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0x7f, 0x80, 0x2b, 0x2f])
    expect(base64StdDecode(base64StdEncode(bytes))).toEqual(bytes)
  })

  it('uses the standard alphabet (+ / and = padding), not url-safe', () => {
    // 0xFB 0xFF encodes to "+/8=" — exercises the two alphabet-distinguishing chars.
    const encoded = base64StdEncode(new Uint8Array([0xfb, 0xff]))
    expect(encoded).toBe('+/8=')
    expect(encoded).toContain('+')
    expect(encoded).toContain('/')
    expect(encoded.length % 4).toBe(0)
    expect(encoded).not.toMatch(/[-_]/)
  })

  it('strict-decodes: rejects trailing garbage instead of truncating (Node lenience defeated)', () => {
    // Node's Buffer.from(...,'base64') would silently decode only "YQ==" here.
    expect(() => base64StdDecode('YQ==garbage')).toThrow(WireDecodeError)
  })

  it('rejects non-alphabet characters', () => {
    expect(() => base64StdDecode('YQ=@')).toThrow(WireDecodeError)
  })

  it('rejects url-safe characters', () => {
    expect(() => base64StdDecode('ab-_')).toThrow(WireDecodeError)
  })

  it('rejects a length that is not a multiple of 4', () => {
    expect(() => base64StdDecode('abc')).toThrow(WireDecodeError)
  })

  it('rejects malformed padding (= not in trailing position)', () => {
    expect(() => base64StdDecode('a=bc')).toThrow(WireDecodeError)
  })

  it('rejects a non-canonical two-char final quantum (Node would leniently accept)', () => {
    // "YR==" carries non-zero bits in the positions padding says are unused; Go's
    // base64.StdEncoding rejects it. Node decodes it to the same byte as canonical "YQ==".
    expect(() => base64StdDecode('YR==')).toThrow(WireDecodeError)
    expect(base64StdDecode('YQ==')).toEqual(new Uint8Array([0x61]))
  })

  it('rejects a non-canonical three-char final quantum (Node would leniently accept)', () => {
    // "YWJ=" is non-canonical; canonical "YWI=" decodes to the two bytes 0x61 0x62.
    expect(() => base64StdDecode('YWJ=')).toThrow(WireDecodeError)
    expect(base64StdDecode('YWI=')).toEqual(new Uint8Array([0x61, 0x62]))
  })

  it('decodes the empty string to zero bytes', () => {
    expect(base64StdDecode('')).toEqual(new Uint8Array([]))
  })
})

describe('encodeInnerFrame / decodeInnerFrame', () => {
  it('round-trips and carries v, type, data in the daemon shape', () => {
    const frame: InnerFrameV2 = { v: 2, type: 'noise_init', data: base64StdEncode(new Uint8Array([1, 2, 3])) }
    const text = encodeInnerFrame(frame)
    expect(text).toContain('"v":2')
    expect(text).toContain('"type"')
    expect(text).toContain('"data"')
    expect(decodeInnerFrame(bytesOf(text))).toEqual(frame)
  })

  it('tolerates unknown / server-added top-level keys (forward-compat)', () => {
    const bytes = bytesOf('{"v":2,"type":"noise_msg","data":"AAAA","future_field":true}')
    expect(decodeInnerFrame(bytes)).toEqual({ v: 2, type: 'noise_msg', data: 'AAAA' })
  })

  it('throws on a frame missing the required type / data fields', () => {
    expect(() => decodeInnerFrame(bytesOf('{"v":2}'))).toThrow(WireDecodeError)
    expect(() => decodeInnerFrame(bytesOf('{"v":2,"type":"x","data":1}'))).toThrow(WireDecodeError)
  })
})

describe('encodeEnvelope / decodeEnvelope round-trips every payload type (AC #5)', () => {
  const wrap = (type: string, payload: unknown, extra: Partial<Envelope> = {}): Envelope => ({
    id: 7,
    type,
    ts: '2026-07-03T12:00:00Z',
    payload,
    ...extra
  })

  const roundTrip = (env: Envelope): Envelope => decodeEnvelope(encodeEnvelope(env))

  it('hello (HelloClientPayload, defaults injected)', () => {
    const payload = makeHelloClientPayload({
      deviceName: 'desktop-1',
      clientVersion: '0.1.0',
      token: 'secret-token'
    })
    const env = wrap('hello', payload)
    const decoded = roundTrip(env)
    expect(decoded).toEqual(env)
    expect(decoded.payload).toEqual(payload)
  })

  it('hello_ack (HelloAckPayload)', () => {
    const payload: HelloAckPayload = {
      protocol_version: 'v2',
      server_id: 'srv-1',
      conn_id: 'conn-1',
      capabilities: ['interactive']
    }
    expect(roundTrip(wrap('hello_ack', payload)).payload).toEqual(payload)
  })

  it('message (MessagePayload)', () => {
    const payload: MessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      role: 'assistant',
      text: 'hello from claude'
    }
    expect(roundTrip(wrap('message', payload)).payload).toEqual(payload)
  })

  it('message_chunk (MessageChunkPayload)', () => {
    const payload: MessageChunkPayload = {
      messages: [
        { conversation_id: 'c1', message_id: 'm1', role: 'user', text: 'hi' },
        { conversation_id: 'c1', message_id: 'm2', role: 'assistant', text: 'yo' }
      ]
    }
    expect(roundTrip(wrap('message_chunk', payload)).payload).toEqual(payload)
  })

  it('send_message (SendMessagePayload)', () => {
    const payload: SendMessagePayload = { conversation_id: 'c1', message_id: 'm1', text: 'go' }
    expect(roundTrip(wrap('send_message', payload)).payload).toEqual(payload)
  })

  it('backfill_since (BackfillSincePayload)', () => {
    const payload: BackfillSincePayload = {
      since_ts: '2026-07-01T00:00:00Z',
      conversation_id: 'c1',
      max_messages: 50
    }
    expect(roundTrip(wrap('backfill_since', payload)).payload).toEqual(payload)
  })

  it('error (ErrorPayload)', () => {
    const payload: ErrorPayload = { code: 'rate_limited', message: 'slow down', retryable: true }
    expect(roundTrip(wrap('error', payload)).payload).toEqual(payload)
  })

  it('ack (empty {} payload)', () => {
    const env = wrap('ack', {})
    expect(roundTrip(env)).toEqual(env)
  })

  it('preserves in_reply_to / event_id when present', () => {
    const env = wrap('ack', {}, { in_reply_to: 3, event_id: 99 })
    expect(roundTrip(env)).toEqual(env)
  })

  it('keeps payload opaque (returns the same plain object, not narrowed)', () => {
    const payload = { conversation_id: 'c1', message_id: 'm1', role: 'user', text: 'hi' }
    expect(roundTrip(wrap('message', payload)).payload).toEqual(payload)
  })
})

describe('default injection (AC #3)', () => {
  it('emits role, protocol_versions, capabilities defaults and frame v:2', () => {
    const payload = makeHelloClientPayload({
      deviceName: 'desktop-1',
      clientVersion: '0.1.0',
      token: 'tok'
    })
    const json = utf8.decode(encodeEnvelope({ id: 1, type: 'hello', ts: 't', payload }))
    expect(json).toContain('"role":"client"')
    expect(json).toContain('"protocol_versions":["v2"]')
    expect(json).toContain('"capabilities":["interactive"]')
    expect(encodeInnerFrame({ v: 2, type: 'noise_init', data: 'AA==' })).toContain('"v":2')
  })

  it('injects last_event_id only when provided', () => {
    const withLast = makeHelloClientPayload({
      deviceName: 'd',
      clientVersion: 'v',
      token: 't',
      lastEventId: 42
    })
    expect(withLast.last_event_id).toBe(42)
    const withoutLast = makeHelloClientPayload({ deviceName: 'd', clientVersion: 'v', token: 't' })
    expect('last_event_id' in withoutLast).toBe(false)
  })
})

describe('absent optionals are omitted, never serialized as null (AC #3)', () => {
  it('omits in_reply_to / event_id entirely when absent', () => {
    const json = utf8.decode(encodeEnvelope({ id: 1, type: 'ack', ts: 't', payload: {} }))
    expect(json).not.toContain('in_reply_to')
    expect(json).not.toContain('event_id')
    expect(json).not.toContain('null')
  })

  it('omits last_event_id from a hello without one', () => {
    const payload = makeHelloClientPayload({ deviceName: 'd', clientVersion: 'v', token: 't' })
    const json = utf8.decode(encodeEnvelope({ id: 1, type: 'hello', ts: 't', payload }))
    expect(json).not.toContain('last_event_id')
    expect(json).not.toContain('null')
  })
})

describe('forward-compat decode tolerates unknown / server-added fields (AC #4)', () => {
  it('does not throw on unknown top-level and payload keys; keeps known fields intact', () => {
    // Unknown top-level key + an ErrorPayload with the unmodeled retry_after_s field.
    const bytes = bytesOf(
      '{"id":9,"type":"error","ts":"t","payload":{"code":"x","message":"m","retryable":false,"retry_after_s":5},"payload_encrypted":true}'
    )
    const decoded = decodeEnvelope(bytes)
    expect(decoded.id).toBe(9)
    expect(decoded.type).toBe('error')
    expect(decoded.ts).toBe('t')
    expect(decoded.payload).toEqual({
      code: 'x',
      message: 'm',
      retryable: false,
      retry_after_s: 5
    })
  })
})

describe('decode fails closed on malformed input (AC #4)', () => {
  it('throws WireDecodeError on malformed JSON', () => {
    expect(() => decodeEnvelope(bytesOf('{not json'))).toThrow(WireDecodeError)
    expect(() => decodeInnerFrame(bytesOf('{not json'))).toThrow(WireDecodeError)
  })

  it('throws WireDecodeError on invalid UTF-8 bytes', () => {
    const invalid = new Uint8Array([0xff, 0xfe, 0xfd])
    expect(() => decodeEnvelope(invalid)).toThrow(WireDecodeError)
    expect(() => decodeInnerFrame(invalid)).toThrow(WireDecodeError)
  })

  it('throws WireDecodeError when the JSON is not an object', () => {
    expect(() => decodeEnvelope(bytesOf('[1,2,3]'))).toThrow(WireDecodeError)
  })

  it('throws WireDecodeError on an envelope missing a required field', () => {
    expect(() => decodeEnvelope(bytesOf('{"type":"message","ts":"t","payload":{}}'))).toThrow(
      WireDecodeError
    )
    expect(() => decodeEnvelope(bytesOf('{"id":1,"ts":"t","payload":{}}'))).toThrow(WireDecodeError)
  })

  it('does not echo raw input or field values in the error message (secret-safety)', () => {
    let caught: unknown
    try {
      decodeEnvelope(bytesOf('{"id":1,"type":"hello","ts":"t"}'))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(WireDecodeError)
    // Category-only message: names the missing field, never echoes bytes/token/plaintext.
    expect((caught as WireDecodeError).message).toContain('payload')
    expect((caught as WireDecodeError).message).not.toContain('hello')
  })
})

describe('QrPayload round-trip (JSON only; 32-byte key decode deferred to the pairing ticket)', () => {
  it('survives a plain JSON round-trip with every string field equal', () => {
    // server_static_pubkey stays a base64-std string here; its validated-32-raw-bytes decode
    // is a pairing concern owned by the QR/pairing ticket, out of scope for this codec.
    const qr: QrPayload = {
      server: 'srv-1',
      relay: 'wss://relay.example/v2/client',
      token: 'pair-token',
      server_static_pubkey: base64StdEncode(new Uint8Array(32).fill(7))
    }
    expect(JSON.parse(JSON.stringify(qr))).toEqual(qr)
  })
})

describe('round-trip stability (no null-injection / default-drop drift)', () => {
  it('decode-then-re-encode of a canonical envelope yields byte-equal output', () => {
    const canonical =
      '{"id":7,"type":"message","ts":"2026-07-03T00:00:00Z","payload":{"conversation_id":"c1","message_id":"m1","role":"assistant","text":"hi"}}'
    const reEncoded = encodeEnvelope(decodeEnvelope(bytesOf(canonical)))
    expect(utf8.decode(reEncoded)).toBe(canonical)
  })

  it('decode-then-re-encode of a canonical inner frame yields byte-equal output', () => {
    const canonical = '{"v":2,"type":"noise_msg","data":"AAAA"}'
    expect(encodeInnerFrame(decodeInnerFrame(bytesOf(canonical)))).toBe(canonical)
  })
})
