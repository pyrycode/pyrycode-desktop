import { describe, it, expect, vi } from 'vitest'
import { parseInboundMessage } from './inboundMessage'
import { encodeEnvelope, base64StdEncode, WireDecodeError } from './codec'
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

/** A `debug_bundle_chunk` envelope's plaintext bytes, wrapping an arbitrary payload (#116). */
function encodeBundleChunk(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 7, type: 'debug_bundle_chunk', ts: FIXED_TS, payload })
}

/** A `debug_bundle_done` envelope's plaintext bytes, wrapping an arbitrary payload (#116). */
function encodeBundleDone(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 8, type: 'debug_bundle_done', ts: FIXED_TS, payload })
}

/** A `screen_snapshot` envelope's plaintext bytes, wrapping an arbitrary payload (#180). */
function encodeSnapshot(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 9, type: 'screen_snapshot', ts: FIXED_TS, payload })
}

/** An `assistant_delta` envelope's plaintext bytes, wrapping an arbitrary payload (#199). */
function encodeAssistantDelta(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 10, type: 'assistant_delta', ts: FIXED_TS, payload })
}

/** A `turn_end` envelope's plaintext bytes, wrapping an arbitrary payload (#199). */
function encodeTurnEnd(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 11, type: 'turn_end', ts: FIXED_TS, payload })
}

/** A `conversations` envelope's plaintext bytes, wrapping an arbitrary payload (#139). */
function encodeConversations(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 12, type: 'conversations', ts: FIXED_TS, payload })
}

/** A `turn_state` envelope's plaintext bytes, wrapping an arbitrary payload (#214). */
function encodeTurnState(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 13, type: 'turn_state', ts: FIXED_TS, payload })
}

/** A `tool_use` envelope's plaintext bytes, wrapping an arbitrary payload (#217). */
function encodeToolUse(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 14, type: 'tool_use', ts: FIXED_TS, payload })
}

/** A `tool_result` envelope's plaintext bytes, wrapping an arbitrary payload (#229). */
function encodeToolResult(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 17, type: 'tool_result', ts: FIXED_TS, payload })
}

/** A `modal_shown` envelope's plaintext bytes, wrapping an arbitrary payload (#201). */
function encodeModalShown(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 15, type: 'modal_shown', ts: FIXED_TS, payload })
}

/** A `modal_dismissed` envelope's plaintext bytes, wrapping an arbitrary payload (#201). */
function encodeModalDismissed(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 16, type: 'modal_dismissed', ts: FIXED_TS, payload })
}

/** A `conversation_created` envelope's plaintext bytes, wrapping an arbitrary payload (#241). */
function encodeConversationCreated(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 18, type: 'conversation_created', ts: FIXED_TS, payload })
}

/** A `session_transition` envelope's plaintext bytes, wrapping an arbitrary payload (#254). */
function encodeSessionTransition(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 19, type: 'session_transition', ts: FIXED_TS, payload })
}

/** A `session_settings_updated` envelope's plaintext bytes, wrapping an arbitrary payload (#264). The
 *  optional `inReplyTo` rides the ENVELOPE (not the payload) — the #261 request↔reply correlation id. */
function encodeSessionSettingsUpdated(payload: unknown, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 20,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    payload,
    ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})
  })
}

/** A fully-populated, well-formed screen_snapshot payload. */
const SNAPSHOT = {
  conversation_id: 'conv-1',
  text: 'rendered screen contents',
  ts: '2026-07-08T00:00:00Z',
  model: 'claude-opus-4-8',
  effort: 'high',
  yolo: true,
  used_tokens: 45000,
  window_tokens: 200000
}

/** A fully-populated, well-formed assistant_delta payload (#199). */
const DELTA = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  seq: 3,
  text: 'one incremental slice'
}

/** A fully-populated, well-formed turn_end payload (#199). */
const TURN_END = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  stop_reason: 'end_turn'
}

/** A fully-populated, well-formed turn_state payload (#214). */
const TURN_STATE = {
  conversation_id: 'conv-1',
  state: 'thinking'
}

/** A fully-populated, well-formed tool_use payload (#217). */
const TOOL_USE = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  tool_use_id: 'tu-1',
  name: 'Read',
  input_summary: 'reads /etc/hosts'
}

/** A fully-populated, well-formed tool_result payload — a success (#229). */
const TOOL_RESULT = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  tool_use_id: 'tu-1',
  is_error: false,
  result_summary: 'read 12 lines'
}

/** A fully-populated, well-formed modal_shown payload with two ordered options (#201). */
const MODAL_SHOWN = {
  modal_id: 'mdl-7f3a',
  class: 'permission',
  title: 'Allow Bash?',
  prompt: 'claude wants to run: rm -rf build/',
  options: [
    { id: 'allow', label: 'Allow' },
    { id: 'deny', label: 'Deny' }
  ],
  default_option_id: 'deny'
}

/** A fully-populated, well-formed modal_dismissed payload (#201). */
const MODAL_DISMISSED = {
  modal_id: 'mdl-7f3a',
  outcome: 'allow',
  source: 'remote'
}

/** A well-formed conversation summary with a string name — a saved channel (#139). */
const CONV_NAMED = {
  id: 'conv-1',
  name: 'My channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/home/user/project',
  last_message_ts: '2026-07-08T00:00:00Z',
  last_used_at: '2026-07-09T00:00:00Z'
}

/** A well-formed conversation summary with a null name — an unnamed, archived scratch discussion (#139). */
const CONV_UNNAMED = {
  id: 'conv-2',
  name: null,
  is_promoted: false,
  is_archived: true,
  cwd: '/tmp/scratch',
  last_message_ts: '2026-07-07T00:00:00Z',
  last_used_at: '2026-07-07T12:00:00Z'
}

/** A well-formed conversation_created reply with a string name — its OWN 5-field shape (#241). */
const CREATED_NAMED = {
  id: 'conv-9',
  is_promoted: true,
  cwd: '/home/user/project',
  name: 'design review',
  last_used_at: '2026-07-10T00:00:00Z'
}

/** A well-formed conversation_created reply with a null name — an unnamed scratch conversation (#241). */
const CREATED_UNNAMED = {
  id: 'conv-10',
  is_promoted: false,
  cwd: '/tmp/scratch',
  name: null,
  last_used_at: '2026-07-10T01:00:00Z'
}

/** A fully-populated, well-formed session_transition payload — a /clear rotation, workspace_cwd null (#254). */
const SESSION_TRANSITION = {
  previous_session_id: 'sess-1',
  new_session_id: 'sess-2',
  reason: 'clear',
  occurred_at: '2026-07-10T00:00:00.000000000Z',
  workspace_cwd: null
}

/** A well-formed session_settings_updated reply — its one field, the addressing key (#264). */
const SESSION_SETTINGS_UPDATED = {
  session_id: 'sess-2'
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
  it('returns null for envelope types other than the modeled set, without throwing', () => {
    // `error` is now modeled (→ daemon-error) so it is no longer in this ignored set (#116).
    for (const type of ['ack', 'hello_ack', 'something-else']) {
      const bytes = encodeEnvelope({ id: 1, type, ts: FIXED_TS, payload: {} })
      expect(parseInboundMessage(bytes)).toBeNull()
    }
  })
})

describe('parseInboundMessage — debug-bundle recognition (#116, additive)', () => {
  it('narrows a debug_bundle_chunk into { kind, seq, data } with base64-decoded bytes', () => {
    const raw = new Uint8Array([1, 2, 3, 250])
    const result = parseInboundMessage(encodeBundleChunk({ seq: 0, data: base64StdEncode(raw) }))
    expect(result).toEqual({ kind: 'bundle-chunk', seq: 0, data: raw })
  })

  it('preserves a non-zero seq and decodes an empty-data chunk to zero bytes', () => {
    const result = parseInboundMessage(encodeBundleChunk({ seq: 5, data: '' }))
    expect(result).toEqual({ kind: 'bundle-chunk', seq: 5, data: new Uint8Array(0) })
  })

  it('narrows a debug_bundle_done into { kind, total }', () => {
    expect(parseInboundMessage(encodeBundleDone({ total: 3 }))).toEqual({
      kind: 'bundle-done',
      total: 3
    })
  })

  it('narrows a daemon error into a content-free { kind: daemon-error }', () => {
    // The ErrorPayload fields are present on the wire but must NOT be surfaced.
    const bytes = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      payload: { code: 'server.binary_offline', message: 'secret daemon detail', retryable: true }
    })
    expect(parseInboundMessage(bytes)).toEqual({ kind: 'daemon-error' })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
    expect(parseInboundMessage(encodeChunk({ messages: [MSG_A] }))).toEqual({
      kind: 'chunk',
      messages: [MSG_A]
    })
  })
})

describe('parseInboundMessage — debug-bundle fail-closed (#116, AC3/AC4)', () => {
  it('throws on non-canonical / malformed base64 chunk data', () => {
    const bad = ['not valid base64 !!!', 'YQ==garbage', 'YR==']
    for (const data of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk({ seq: 0, data }))).toThrow(WireDecodeError)
    }
  })

  it('throws on a missing or non-string chunk data', () => {
    const bad: unknown[] = [{ seq: 0 }, { seq: 0, data: 5 }, { seq: 0, data: null }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on a missing or non-number chunk seq', () => {
    const bad: unknown[] = [{ data: '' }, { seq: '0', data: '' }, { seq: null, data: '' }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a debug_bundle_chunk payload is not an object', () => {
    expect(() => parseInboundMessage(encodeBundleChunk('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeBundleChunk(['a']))).toThrow(WireDecodeError)
  })

  it('throws on a missing or non-number done total', () => {
    const bad: unknown[] = [{}, { total: '3' }, { total: null }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleDone(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a debug_bundle_done payload is not an object', () => {
    expect(() => parseInboundMessage(encodeBundleDone('nope'))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — screen_snapshot recognition (#180, additive)', () => {
  it('narrows a full screen_snapshot into { kind: snapshot } with all eight fields', () => {
    expect(parseInboundMessage(encodeSnapshot(SNAPSHOT))).toEqual({
      kind: 'snapshot',
      snapshot: SNAPSHOT
    })
  })

  it('decodes empty model/effort and yolo:false as those values, never as absent (AC3)', () => {
    const defaults = { ...SNAPSHOT, model: '', effort: '', yolo: false }
    expect(parseInboundMessage(encodeSnapshot(defaults))).toEqual({
      kind: 'snapshot',
      snapshot: defaults
    })
  })

  it('decodes used_tokens:0 / window_tokens:0 as those values, never as absent (#191, AC3)', () => {
    const zeros = { ...SNAPSHOT, used_tokens: 0, window_tokens: 0 }
    expect(parseInboundMessage(encodeSnapshot(zeros))).toEqual({
      kind: 'snapshot',
      snapshot: zeros
    })
  })

  it('drops unknown server keys, keeping only the eight known fields (forward-compat)', () => {
    const withExtras = { ...SNAPSHOT, tokens_used: 512, extra: 'ignore-me' }
    expect(parseInboundMessage(encodeSnapshot(withExtras))).toEqual({
      kind: 'snapshot',
      snapshot: SNAPSHOT
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — screen_snapshot fail-closed (#180, AC2/AC3)', () => {
  it('throws when any of the five string fields is missing or non-string', () => {
    const bad: unknown[] = [
      { ...SNAPSHOT, conversation_id: undefined },
      { ...SNAPSHOT, text: undefined },
      { ...SNAPSHOT, ts: 42 },
      { ...SNAPSHOT, model: undefined },
      { ...SNAPSHOT, effort: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSnapshot(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when yolo is missing or non-boolean (a string/number is not a valid value)', () => {
    const bad: unknown[] = [
      { conversation_id: 'c', text: 't', ts: 's', model: 'm', effort: 'e' }, // yolo absent
      { ...SNAPSHOT, yolo: 'true' },
      { ...SNAPSHOT, yolo: 1 },
      { ...SNAPSHOT, yolo: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSnapshot(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when used_tokens or window_tokens is missing or non-number (#191, AC2)', () => {
    const bad: unknown[] = [
      { ...SNAPSHOT, used_tokens: undefined }, // used_tokens absent
      { ...SNAPSHOT, window_tokens: undefined }, // window_tokens absent
      { ...SNAPSHOT, used_tokens: '45000' }, // stringified number
      { ...SNAPSHOT, window_tokens: null }, // JSON null (never a valid value)
      { ...SNAPSHOT, used_tokens: true } // boolean is not a number
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSnapshot(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a screen_snapshot payload is not an object', () => {
    expect(() => parseInboundMessage(encodeSnapshot('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSnapshot(['a']))).toThrow(WireDecodeError)
  })

  it('throws on an oversized snapshot plaintext even when the JSON is a valid snapshot', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 9,
        type: 'screen_snapshot',
        ts: FIXED_TS,
        payload: { ...SNAPSHOT, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — assistant_delta / turn_end recognition (#199, additive)', () => {
  it('narrows a full assistant_delta into { kind: assistant-delta } with all four fields', () => {
    expect(parseInboundMessage(encodeAssistantDelta(DELTA))).toEqual({
      kind: 'assistant-delta',
      delta: DELTA
    })
  })

  it('decodes seq:0 as the value 0, never as absent (requireNumber is type-not-truthiness)', () => {
    const first = { ...DELTA, seq: 0 }
    expect(parseInboundMessage(encodeAssistantDelta(first))).toEqual({
      kind: 'assistant-delta',
      delta: first
    })
  })

  it('decodes an empty-text delta as the value "", never as absent', () => {
    const empty = { ...DELTA, text: '' }
    expect(parseInboundMessage(encodeAssistantDelta(empty))).toEqual({
      kind: 'assistant-delta',
      delta: empty
    })
  })

  it('drops unknown server keys, keeping only the four known delta fields (forward-compat)', () => {
    const withExtras = { ...DELTA, model: 'claude', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeAssistantDelta(withExtras))).toEqual({
      kind: 'assistant-delta',
      delta: DELTA
    })
  })

  it('narrows a full turn_end into { kind: turn-end } with all three fields', () => {
    expect(parseInboundMessage(encodeTurnEnd(TURN_END))).toEqual({
      kind: 'turn-end',
      turnEnd: TURN_END
    })
  })

  it('drops unknown server keys, keeping only the three known turn_end fields (forward-compat)', () => {
    const withExtras = { ...TURN_END, usage: 42, extra: 'ignore-me' }
    expect(parseInboundMessage(encodeTurnEnd(withExtras))).toEqual({
      kind: 'turn-end',
      turnEnd: TURN_END
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — assistant_delta / turn_end fail-closed (#199)', () => {
  it('throws when any assistant_delta field is missing or wrong type', () => {
    const bad: unknown[] = [
      { ...DELTA, conversation_id: undefined },
      { ...DELTA, turn_id: 42 },
      { ...DELTA, seq: '3' }, // stringified number is not a valid seq
      { ...DELTA, seq: null },
      { ...DELTA, text: undefined }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeAssistantDelta(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when an assistant_delta payload is not an object', () => {
    expect(() => parseInboundMessage(encodeAssistantDelta('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeAssistantDelta(['a']))).toThrow(WireDecodeError)
  })

  it('throws when any turn_end field is missing or wrong type', () => {
    const bad: unknown[] = [
      { ...TURN_END, conversation_id: undefined },
      { ...TURN_END, turn_id: null },
      { ...TURN_END, stop_reason: 42 } // a number is not a valid stop_reason
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnEnd(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a turn_end payload is not an object', () => {
    expect(() => parseInboundMessage(encodeTurnEnd('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeTurnEnd(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversations recognition (#139, additive)', () => {
  it('narrows a conversations reply into an ordered { kind: conversations } list', () => {
    const result = parseInboundMessage(
      encodeConversations({ conversations: [CONV_NAMED, CONV_UNNAMED] })
    )
    expect(result).toEqual({ kind: 'conversations', conversations: [CONV_NAMED, CONV_UNNAMED] })
  })

  it('decodes a null name as null (a distinct unnamed value, never "" or absent — AC2)', () => {
    const result = parseInboundMessage(encodeConversations({ conversations: [CONV_UNNAMED] }))
    expect(result).toEqual({ kind: 'conversations', conversations: [CONV_UNNAMED] })
    // Pin the null specifically: an unnamed scratch conversation stays distinguishable downstream.
    if (result?.kind === 'conversations') {
      expect(result.conversations[0].name).toBeNull()
    }
  })

  it('decodes is_promoted / is_archived false as those values, never as absent', () => {
    // CONV_UNNAMED has is_promoted:false; assert both booleans survive both truth values.
    const result = parseInboundMessage(
      encodeConversations({ conversations: [CONV_NAMED, CONV_UNNAMED] })
    )
    if (result?.kind === 'conversations') {
      expect(result.conversations[0].is_promoted).toBe(true)
      expect(result.conversations[0].is_archived).toBe(false)
      expect(result.conversations[1].is_promoted).toBe(false)
      expect(result.conversations[1].is_archived).toBe(true)
    }
  })

  it('treats an empty conversations array as a valid zero-length list', () => {
    expect(parseInboundMessage(encodeConversations({ conversations: [] }))).toEqual({
      kind: 'conversations',
      conversations: []
    })
  })

  it('drops unknown server keys per row, keeping only the seven known fields (forward-compat)', () => {
    const withExtras = { ...CONV_NAMED, preview: 'ignore-me', unread: 3 }
    expect(parseInboundMessage(encodeConversations({ conversations: [withExtras] }))).toEqual({
      kind: 'conversations',
      conversations: [CONV_NAMED]
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversations fail-closed (#139, AC2/AC4)', () => {
  it('throws when a conversations payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversations('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversations(['a']))).toThrow(WireDecodeError)
  })

  it('throws when conversations is missing or not an array', () => {
    const bad: unknown[] = [{}, { conversations: {} }, { conversations: 'x' }, { conversations: 3 }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversations(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is missing or non-string', () => {
    const bad: unknown[] = [
      { ...CONV_NAMED, id: undefined },
      { ...CONV_NAMED, cwd: 42 },
      { ...CONV_NAMED, last_message_ts: undefined },
      { ...CONV_NAMED, last_used_at: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when name is absent/undefined (never omitted on the wire) or a non-string non-null', () => {
    const bad: unknown[] = [
      { id: 'c', is_promoted: true, is_archived: false, cwd: '/', last_message_ts: 't', last_used_at: 'u' }, // name absent
      { ...CONV_NAMED, name: 42 }, // a number is not a valid name
      { ...CONV_NAMED, name: {} } // an object is not a valid name
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when is_promoted or is_archived is missing or non-boolean', () => {
    const bad: unknown[] = [
      { ...CONV_NAMED, is_promoted: 'true' },
      { ...CONV_NAMED, is_promoted: 1 },
      { ...CONV_NAMED, is_archived: undefined },
      { ...CONV_NAMED, is_archived: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('fails the whole reply closed when any single row is invalid', () => {
    const bad: unknown[] = [
      { conversations: [CONV_NAMED, 'not-an-object'] },
      { conversations: [CONV_NAMED, { ...CONV_UNNAMED, id: undefined }] },
      { conversations: [{ ...CONV_NAMED, is_promoted: 'nope' }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversations(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversations plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 12,
        type: 'conversations',
        ts: FIXED_TS,
        payload: { conversations: [{ ...CONV_NAMED, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) }] }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversation_created recognition (#241, additive)', () => {
  it('narrows a conversation_created reply into { kind: conversation-created } with the five fields', () => {
    expect(parseInboundMessage(encodeConversationCreated(CREATED_NAMED))).toEqual({
      kind: 'conversation-created',
      conversationCreated: CREATED_NAMED
    })
  })

  it('decodes a null name as null (a distinct unnamed value, never "" or absent — AC5)', () => {
    const result = parseInboundMessage(encodeConversationCreated(CREATED_UNNAMED))
    expect(result).toEqual({ kind: 'conversation-created', conversationCreated: CREATED_UNNAMED })
    // Pin the null specifically: an unnamed scratch conversation stays distinguishable downstream.
    if (result?.kind === 'conversation-created') {
      expect(result.conversationCreated.name).toBeNull()
    }
  })

  it('decodes is_promoted false as the value false, never as absent', () => {
    const result = parseInboundMessage(encodeConversationCreated(CREATED_UNNAMED))
    if (result?.kind === 'conversation-created') {
      expect(result.conversationCreated.is_promoted).toBe(false)
    }
  })

  it('drops unknown server keys, keeping only the five known fields (forward-compat)', () => {
    // The daemon's ConversationSummary carries is_archived + last_message_ts; a create reply must not,
    // and even if a server sends extras they are tolerated but NOT copied through (spec #274).
    const withExtras = { ...CREATED_NAMED, is_archived: false, last_message_ts: 'x', preview: 'ignore' }
    expect(parseInboundMessage(encodeConversationCreated(withExtras))).toEqual({
      kind: 'conversation-created',
      conversationCreated: CREATED_NAMED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversation_created fail-closed (#241, AC5)', () => {
  it('throws when the payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversationCreated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversationCreated(['a']))).toThrow(WireDecodeError)
  })

  it('throws when any string field is missing or non-string', () => {
    const bad: unknown[] = [
      { ...CREATED_NAMED, id: undefined },
      { ...CREATED_NAMED, id: 42 },
      { ...CREATED_NAMED, cwd: undefined },
      { ...CREATED_NAMED, cwd: 42 },
      { ...CREATED_NAMED, last_used_at: undefined },
      { ...CREATED_NAMED, last_used_at: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when name is absent/undefined (never omitted) or a non-string non-null', () => {
    const bad: unknown[] = [
      { id: 'c', is_promoted: true, cwd: '/', last_used_at: 'u' }, // name absent
      { ...CREATED_NAMED, name: 42 },
      { ...CREATED_NAMED, name: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when is_promoted is missing or non-boolean', () => {
    const bad: unknown[] = [
      { ...CREATED_NAMED, is_promoted: 'true' },
      { ...CREATED_NAMED, is_promoted: 1 },
      { ...CREATED_NAMED, is_promoted: undefined },
      { ...CREATED_NAMED, is_promoted: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversation_created plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 18,
        type: 'conversation_created',
        ts: FIXED_TS,
        payload: { ...CREATED_NAMED, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — session_transition recognition (#254, additive)', () => {
  it('narrows a full session_transition into { kind: session-transition } for each reason', () => {
    // clear / idle_evict carry workspace_cwd:null; workspace_change carries a non-null path.
    const cases = [
      { ...SESSION_TRANSITION, reason: 'clear', workspace_cwd: null },
      { ...SESSION_TRANSITION, reason: 'idle_evict', workspace_cwd: null },
      { ...SESSION_TRANSITION, reason: 'workspace_change', workspace_cwd: '/home/user/other' }
    ]
    for (const payload of cases) {
      expect(parseInboundMessage(encodeSessionTransition(payload))).toEqual({
        kind: 'session-transition',
        sessionTransition: payload
      })
    }
  })

  it('decodes workspace_cwd:null as null (a valid clear/idle_evict value, never absent — AC2)', () => {
    const result = parseInboundMessage(encodeSessionTransition(SESSION_TRANSITION))
    expect(result).toEqual({ kind: 'session-transition', sessionTransition: SESSION_TRANSITION })
    // Pin the null specifically — a clear/idle_evict frame stays distinguishable from workspace_change.
    if (result?.kind === 'session-transition') {
      expect(result.sessionTransition.workspace_cwd).toBeNull()
    }
  })

  it('drops unknown server keys (incl. a spurious conversation_id), keeping only the five known fields', () => {
    const withExtras = { ...SESSION_TRANSITION, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeSessionTransition(withExtras))).toEqual({
      kind: 'session-transition',
      sessionTransition: SESSION_TRANSITION
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — session_transition fail-closed (#254)', () => {
  it('throws when reason is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      (() => {
        const { reason: _dropped, ...missing } = SESSION_TRANSITION
        return missing
      })(), // reason absent
      { ...SESSION_TRANSITION, reason: 42 }, // non-string
      { ...SESSION_TRANSITION, reason: null },
      { ...SESSION_TRANSITION, reason: {} },
      { ...SESSION_TRANSITION, reason: 'evicted' }, // a string outside the closed enum
      { ...SESSION_TRANSITION, reason: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when previous_session_id / new_session_id / occurred_at is absent or non-string', () => {
    const bad: unknown[] = [
      { ...SESSION_TRANSITION, previous_session_id: undefined },
      { ...SESSION_TRANSITION, new_session_id: 42 },
      { ...SESSION_TRANSITION, occurred_at: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when workspace_cwd is absent/undefined (must be present, even as null) or non-string-non-null', () => {
    const bad: unknown[] = [
      (() => {
        const { workspace_cwd: _dropped, ...missing } = SESSION_TRANSITION
        return missing
      })(), // workspace_cwd absent
      { ...SESSION_TRANSITION, workspace_cwd: 42 }, // a number is not a valid value
      { ...SESSION_TRANSITION, workspace_cwd: {} } // an object is not a valid value
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a session_transition payload is not an object', () => {
    expect(() => parseInboundMessage(encodeSessionTransition('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSessionTransition(['a']))).toThrow(WireDecodeError)
  })

  it('names the failure category only for a bad reason — never echoes the value or a workspace path', () => {
    // reason out-of-enum, with a secret workspace_cwd present as a valid string: a naive impl would
    // interpolate the offending reason value (and the path) into the error message.
    let thrown: unknown = null
    try {
      parseInboundMessage(
        encodeSessionTransition({
          ...SESSION_TRANSITION,
          reason: 'evicted',
          workspace_cwd: '/home/secret/workspace'
        })
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(WireDecodeError)
    const message = (thrown as Error).message
    expect(message).not.toContain('evicted')
    expect(message).not.toContain('/home/secret/workspace')
  })

  it('throws on an oversized session_transition plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 19,
        type: 'session_transition',
        ts: FIXED_TS,
        payload: { ...SESSION_TRANSITION, new_session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — session_settings_updated recognition (#264, additive)', () => {
  it('narrows a full session_settings_updated into { kind: session-settings-updated }', () => {
    expect(parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
  })

  it('drops unknown server keys (incl. a spurious echoed model/reason), keeping only session_id', () => {
    const withExtras = { ...SESSION_SETTINGS_UPDATED, model: 'claude-opus-4-8', reason: 'clear' }
    expect(parseInboundMessage(encodeSessionSettingsUpdated(withExtras))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
  })

  it('carries the Envelope in_reply_to onto the kind as inReplyTo (#261 correlation id)', () => {
    expect(parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED, 7))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED,
      inReplyTo: 7
    })
  })

  it('leaves inReplyTo undefined when the frame omits in_reply_to (correlation fails closed downstream)', () => {
    const result = parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED))
    expect(result).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
    // Explicit: the carrier is present-but-undefined, so daemonConnection's lookup short-circuits.
    expect(result?.kind === 'session-settings-updated' && result.inReplyTo).toBeUndefined()
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — session_settings_updated fail-closed (#264)', () => {
  it('throws when session_id is absent or a non-string', () => {
    const bad: unknown[] = [
      {}, // session_id absent
      { session_id: 42 }, // a number is not a valid value
      { session_id: null }, // a null is not a valid value (session_id is never nullable)
      { session_id: {} } // an object is not a valid value
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionSettingsUpdated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a session_settings_updated payload is not an object', () => {
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated(['a']))).toThrow(WireDecodeError)
  })

  it('names the failure category only for a missing session_id — never echoes the value', () => {
    // session_id present as an object carrying a secret string: a naive impl might interpolate it.
    let thrown: unknown = null
    try {
      parseInboundMessage(encodeSessionSettingsUpdated({ session_id: { secret: 'sess-secret-value' } }))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(WireDecodeError)
    expect((thrown as Error).message).not.toContain('sess-secret-value')
  })

  it('throws on an oversized session_settings_updated plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 20,
        type: 'session_settings_updated',
        ts: FIXED_TS,
        payload: { session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — turn_state recognition (#214, additive)', () => {
  it('narrows a full turn_state into { kind: turn-state } for each of the three states', () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const payload = { conversation_id: 'conv-1', state }
      expect(parseInboundMessage(encodeTurnState(payload))).toEqual({
        kind: 'turn-state',
        turnState: payload
      })
    }
  })

  it('drops unknown server keys, keeping only the two known turn_state fields (forward-compat)', () => {
    const withExtras = { ...TURN_STATE, phase: 'legacy', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeTurnState(withExtras))).toEqual({
      kind: 'turn-state',
      turnState: TURN_STATE
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — turn_state fail-closed (#214)', () => {
  it('throws when state is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      { conversation_id: 'conv-1' }, // state absent
      { ...TURN_STATE, state: 42 }, // non-string
      { ...TURN_STATE, state: null },
      { ...TURN_STATE, state: {} },
      { ...TURN_STATE, state: 'done' }, // a string outside the closed enum
      { ...TURN_STATE, state: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent or a non-string', () => {
    const bad: unknown[] = [
      { state: 'thinking' }, // conversation_id absent
      { ...TURN_STATE, conversation_id: 42 },
      { ...TURN_STATE, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a turn_state payload is not an object', () => {
    expect(() => parseInboundMessage(encodeTurnState('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeTurnState(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — tool_use recognition (#217, additive)', () => {
  it('narrows a full tool_use into { kind: tool-use } carrying all five fields verbatim', () => {
    expect(parseInboundMessage(encodeToolUse(TOOL_USE))).toEqual({
      kind: 'tool-use',
      toolUse: TOOL_USE
    })
  })

  it('drops unknown server keys, keeping only the five known tool_use fields (forward-compat)', () => {
    const withExtras = { ...TOOL_USE, raw_input: '{"path":"/etc/hosts"}', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeToolUse(withExtras))).toEqual({
      kind: 'tool-use',
      toolUse: TOOL_USE
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — tool_use fail-closed (#217)', () => {
  it('throws when any single field is absent (never a partial)', () => {
    for (const field of ['conversation_id', 'turn_id', 'tool_use_id', 'name', 'input_summary'] as const) {
      const { [field]: _dropped, ...missing } = TOOL_USE
      expect(() => parseInboundMessage(encodeToolUse(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any single field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...TOOL_USE, name: 42 },
      { ...TOOL_USE, input_summary: {} },
      { ...TOOL_USE, tool_use_id: null },
      { ...TOOL_USE, turn_id: ['a'] },
      { ...TOOL_USE, conversation_id: 7 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolUse(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a tool_use payload is not an object', () => {
    expect(() => parseInboundMessage(encodeToolUse('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeToolUse(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — tool_result recognition (#229, additive)', () => {
  it('narrows a full tool_result into { kind: tool-result } carrying all five fields verbatim', () => {
    expect(parseInboundMessage(encodeToolResult(TOOL_RESULT))).toEqual({
      kind: 'tool-result',
      toolResult: TOOL_RESULT
    })
  })

  it('decodes is_error:false as the value false, never as absent (the yolo #180 idiom)', () => {
    const success = { ...TOOL_RESULT, is_error: false }
    expect(parseInboundMessage(encodeToolResult(success))).toEqual({
      kind: 'tool-result',
      toolResult: success
    })
  })

  it('decodes is_error:true as the value true (an errored tool)', () => {
    const failed = { ...TOOL_RESULT, is_error: true, result_summary: 'permission denied' }
    expect(parseInboundMessage(encodeToolResult(failed))).toEqual({
      kind: 'tool-result',
      toolResult: failed
    })
  })

  it('decodes an empty result_summary as the value "", never as absent', () => {
    const empty = { ...TOOL_RESULT, result_summary: '' }
    expect(parseInboundMessage(encodeToolResult(empty))).toEqual({
      kind: 'tool-result',
      toolResult: empty
    })
  })

  it('drops unknown server keys, keeping only the five known tool_result fields (forward-compat)', () => {
    const withExtras = { ...TOOL_RESULT, raw_output: '{"lines":12}', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeToolResult(withExtras))).toEqual({
      kind: 'tool-result',
      toolResult: TOOL_RESULT
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — tool_result fail-closed (#229)', () => {
  it('throws when any single field is absent (never a partial)', () => {
    for (const field of ['conversation_id', 'turn_id', 'tool_use_id', 'is_error', 'result_summary'] as const) {
      const { [field]: _dropped, ...missing } = TOOL_RESULT
      expect(() => parseInboundMessage(encodeToolResult(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...TOOL_RESULT, conversation_id: 7 },
      { ...TOOL_RESULT, turn_id: ['a'] },
      { ...TOOL_RESULT, tool_use_id: null },
      { ...TOOL_RESULT, result_summary: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolResult(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when is_error is a non-boolean (a "true"/"false" string, number, null, object)', () => {
    const bad: unknown[] = [
      { ...TOOL_RESULT, is_error: 'true' }, // the string, not the boolean — a truthiness check would accept it
      { ...TOOL_RESULT, is_error: 'false' },
      { ...TOOL_RESULT, is_error: 1 },
      { ...TOOL_RESULT, is_error: 0 },
      { ...TOOL_RESULT, is_error: null },
      { ...TOOL_RESULT, is_error: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolResult(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a tool_result payload is not an object', () => {
    expect(() => parseInboundMessage(encodeToolResult('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeToolResult(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — modal_shown recognition (#201, additive)', () => {
  it('narrows a full modal_shown into { kind: modal-shown } carrying all six fields verbatim', () => {
    expect(parseInboundMessage(encodeModalShown(MODAL_SHOWN))).toEqual({
      kind: 'modal-shown',
      modalShown: MODAL_SHOWN
    })
  })

  it('preserves option order — options[0] before options[1] (array order is selection order)', () => {
    const result = parseInboundMessage(encodeModalShown(MODAL_SHOWN))
    if (result?.kind === 'modal-shown') {
      expect(result.modalShown.options.map((o) => o.id)).toEqual(['allow', 'deny'])
      expect(result.modalShown.options[0]).toEqual({ id: 'allow', label: 'Allow' })
      expect(result.modalShown.options[1]).toEqual({ id: 'deny', label: 'Deny' })
    }
  })

  it('narrows a full modal_shown for the trust class too', () => {
    const trust = { ...MODAL_SHOWN, class: 'trust' }
    expect(parseInboundMessage(encodeModalShown(trust))).toEqual({
      kind: 'modal-shown',
      modalShown: trust
    })
  })

  it('treats an empty options array as a valid zero-option modal (structural)', () => {
    const empty = { ...MODAL_SHOWN, options: [] }
    expect(parseInboundMessage(encodeModalShown(empty))).toEqual({
      kind: 'modal-shown',
      modalShown: empty
    })
  })

  it('drops unknown server keys, keeping only the six known fields (forward-compat)', () => {
    const withExtras = { ...MODAL_SHOWN, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeModalShown(withExtras))).toEqual({
      kind: 'modal-shown',
      modalShown: MODAL_SHOWN
    })
  })

  it('drops unknown keys per option, keeping only { id, label } (forward-compat)', () => {
    const withExtras = {
      ...MODAL_SHOWN,
      options: [{ id: 'allow', label: 'Allow', keystroke: '1' }]
    }
    expect(parseInboundMessage(encodeModalShown(withExtras))).toEqual({
      kind: 'modal-shown',
      modalShown: { ...MODAL_SHOWN, options: [{ id: 'allow', label: 'Allow' }] }
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — modal_shown fail-closed (#201)', () => {
  it('throws when class is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      (() => {
        const { class: _dropped, ...missing } = MODAL_SHOWN
        return missing
      })(), // class absent
      { ...MODAL_SHOWN, class: 42 }, // non-string
      { ...MODAL_SHOWN, class: null },
      { ...MODAL_SHOWN, class: {} },
      { ...MODAL_SHOWN, class: 'destructive' }, // a string outside the closed enum (no destructive class)
      { ...MODAL_SHOWN, class: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is absent (never a partial)', () => {
    for (const field of ['modal_id', 'title', 'prompt', 'default_option_id'] as const) {
      const { [field]: _dropped, ...missing } = MODAL_SHOWN
      expect(() => parseInboundMessage(encodeModalShown(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...MODAL_SHOWN, modal_id: 42 },
      { ...MODAL_SHOWN, title: {} },
      { ...MODAL_SHOWN, prompt: null },
      { ...MODAL_SHOWN, default_option_id: ['a'] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when options is absent or not an array', () => {
    const bad: unknown[] = [
      (() => {
        const { options: _dropped, ...missing } = MODAL_SHOWN
        return missing
      })(), // options absent
      { ...MODAL_SHOWN, options: {} },
      { ...MODAL_SHOWN, options: 'x' },
      { ...MODAL_SHOWN, options: 3 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the whole modal closed when any single option is invalid', () => {
    const bad: unknown[] = [
      { ...MODAL_SHOWN, options: [{ id: 'allow', label: 'Allow' }, 'not-an-object'] },
      { ...MODAL_SHOWN, options: [{ id: 'allow' }] }, // label missing
      { ...MODAL_SHOWN, options: [{ label: 'Allow' }] }, // id missing
      { ...MODAL_SHOWN, options: [{ id: 42, label: 'Allow' }] }, // id non-string
      { ...MODAL_SHOWN, options: [{ id: 'allow', label: 7 }] } // label non-string
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a modal_shown payload is not an object', () => {
    expect(() => parseInboundMessage(encodeModalShown('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModalShown(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — modal_dismissed recognition (#201, additive)', () => {
  it('narrows a full modal_dismissed into { kind: modal-dismissed } for each of the three sources', () => {
    for (const source of ['remote', 'local', 'timeout'] as const) {
      const payload = { ...MODAL_DISMISSED, source }
      expect(parseInboundMessage(encodeModalDismissed(payload))).toEqual({
        kind: 'modal-dismissed',
        modalDismissed: payload
      })
    }
  })

  it('carries an opaque outcome (an option id or a sentinel) verbatim, never enum-checked', () => {
    const sentinel = { ...MODAL_DISMISSED, outcome: '__timeout__' }
    expect(parseInboundMessage(encodeModalDismissed(sentinel))).toEqual({
      kind: 'modal-dismissed',
      modalDismissed: sentinel
    })
  })

  it('drops unknown server keys, keeping only the three known fields (forward-compat)', () => {
    const withExtras = { ...MODAL_DISMISSED, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeModalDismissed(withExtras))).toEqual({
      kind: 'modal-dismissed',
      modalDismissed: MODAL_DISMISSED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — modal_dismissed fail-closed (#201)', () => {
  it('throws when source is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      { modal_id: 'mdl-7f3a', outcome: 'allow' }, // source absent
      { ...MODAL_DISMISSED, source: 42 }, // non-string
      { ...MODAL_DISMISSED, source: null },
      { ...MODAL_DISMISSED, source: {} },
      { ...MODAL_DISMISSED, source: 'admin' }, // a string outside the closed enum
      { ...MODAL_DISMISSED, source: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when modal_id or outcome is absent or a non-string', () => {
    const bad: unknown[] = [
      { outcome: 'allow', source: 'remote' }, // modal_id absent
      { ...MODAL_DISMISSED, modal_id: 42 },
      { modal_id: 'mdl-7f3a', source: 'remote' }, // outcome absent
      { ...MODAL_DISMISSED, outcome: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a modal_dismissed payload is not an object', () => {
    expect(() => parseInboundMessage(encodeModalDismissed('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModalDismissed(['a']))).toThrow(WireDecodeError)
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

  it('logs a debug_bundle_chunk content-free, never seq or data (#116)', () => {
    const { log, lines } = captureLog()
    const raw = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const plaintext = encodeBundleChunk({ seq: 42, data: base64StdEncode(raw) })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('debug_bundle_chunk')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no chunk seq, no data. `seq`/`ts` here are the logger's own
    // record stamps (diagnosticLog.ts), NOT the bundle chunk's seq (which was 42, not 0).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(record.seq).toBe(0) // the log sequence counter, not the chunk's seq:42
    expect(lines[0]).not.toContain(base64StdEncode(raw))
  })

  it('logs a debug_bundle_done content-free, never total (#116)', () => {
    const { log, lines } = captureLog()
    const plaintext = encodeBundleDone({ total: 7 })

    parseInboundMessage(plaintext, log)

    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('debug_bundle_done')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no `total`.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
  })

  it('logs a screen_snapshot content-free, never text / model / effort (#180)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'secret-rendered-terminal-output'
    const plaintext = encodeSnapshot({ ...SNAPSHOT, text: SECRET_TEXT })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('screen_snapshot')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no snapshot field of any kind reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain('claude-opus-4-8')
  })

  it('does NOT log on a malformed screen_snapshot throw path (#180)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeSnapshot({ ...SNAPSHOT, yolo: 'nope' }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs an assistant_delta content-free, never the delta text / turn_id / seq (#199)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'super-secret-assistant-reply-slice'
    const SECRET_TURN = 'secret-turn-id'
    const plaintext = encodeAssistantDelta({
      ...DELTA,
      turn_id: SECRET_TURN,
      seq: 987654,
      text: SECRET_TEXT
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('assistant_delta')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no delta field of any kind reaches the log. `seq`/`ts`
    // here are the logger's own record stamps (diagnosticLog.ts), NOT the delta's seq (987654).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(record.seq).toBe(0) // the log sequence counter, not the delta's seq
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain(SECRET_TURN)
    expect(lines[0]).not.toContain('987654')
  })

  it('does NOT log on a malformed assistant_delta throw path (#199)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeAssistantDelta({ ...DELTA, seq: 'nope' }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a turn_end content-free, never the turn_id / stop_reason (#199)', () => {
    const { log, lines } = captureLog()
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_REASON = 'secret-stop-reason'
    const plaintext = encodeTurnEnd({ ...TURN_END, turn_id: SECRET_TURN, stop_reason: SECRET_REASON })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('turn_end')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_TURN)
    expect(lines[0]).not.toContain(SECRET_REASON)
  })

  it('does NOT log on a malformed turn_end throw path (#199)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeTurnEnd({ ...TURN_END, stop_reason: 42 }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a turn_state content-free, never the state / conversation_id (#214)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const plaintext = encodeTurnState({ conversation_id: SECRET_CONV, state: 'responding' })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('turn_state')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (state / conversation_id) reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain('responding')
  })

  it('does NOT log on a malformed turn_state throw path (#214)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeTurnState({ ...TURN_STATE, state: 'done' }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a tool_use content-free, never a decoded field (#217)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_TU = 'secret-tool-use-id'
    const SECRET_NAME = 'secret-tool-name'
    const SECRET_SUMMARY = 'secret-input-summary'
    const plaintext = encodeToolUse({
      conversation_id: SECRET_CONV,
      turn_id: SECRET_TURN,
      tool_use_id: SECRET_TU,
      name: SECRET_NAME,
      input_summary: SECRET_SUMMARY
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('tool_use')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_CONV, SECRET_TURN, SECRET_TU, SECRET_NAME, SECRET_SUMMARY]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed tool_use throw path (#217)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeToolUse({ ...TOOL_USE, name: 42 }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a tool_result content-free, never a decoded field (#229)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_TU = 'secret-tool-use-id'
    const SECRET_SUMMARY = 'secret-result-summary'
    const plaintext = encodeToolResult({
      conversation_id: SECRET_CONV,
      turn_id: SECRET_TURN,
      tool_use_id: SECRET_TU,
      is_error: true,
      result_summary: SECRET_SUMMARY
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('tool_result')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_CONV, SECRET_TURN, SECRET_TU, SECRET_SUMMARY]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed tool_result throw path (#229)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeToolResult({ ...TOOL_RESULT, is_error: 'nope' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a modal_shown content-free, never a title / prompt / option label / modal_id (#201)', () => {
    const { log, lines } = captureLog()
    const SECRET_MODAL = 'secret-modal-id'
    const SECRET_TITLE = 'secret-modal-title'
    const SECRET_PROMPT = 'secret-modal-prompt'
    const SECRET_LABEL = 'secret-option-label'
    const plaintext = encodeModalShown({
      ...MODAL_SHOWN,
      modal_id: SECRET_MODAL,
      title: SECRET_TITLE,
      prompt: SECRET_PROMPT,
      options: [{ id: 'allow', label: SECRET_LABEL }]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('modal_shown')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_MODAL, SECRET_TITLE, SECRET_PROMPT, SECRET_LABEL]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('logs a modal_dismissed content-free, never the modal_id / outcome / source (#201)', () => {
    const { log, lines } = captureLog()
    const SECRET_MODAL = 'secret-modal-id'
    const SECRET_OUTCOME = 'secret-outcome-value'
    const plaintext = encodeModalDismissed({
      modal_id: SECRET_MODAL,
      outcome: SECRET_OUTCOME,
      source: 'remote'
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('modal_dismissed')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_MODAL, SECRET_OUTCOME]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed modal_shown throw path (#201)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeModalShown({ ...MODAL_SHOWN, class: 'destructive' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does NOT log on a malformed modal_dismissed throw path (#201)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeModalDismissed({ ...MODAL_DISMISSED, source: 'admin' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversations reply content-free, never a name / cwd / id, and no count (#139)', () => {
    const { log, lines } = captureLog()
    const SECRET_NAME = 'secret-conversation-title'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeConversations({
      conversations: [
        { ...CONV_NAMED, name: SECRET_NAME, cwd: SECRET_CWD },
        CONV_UNNAMED
      ]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversations')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (unlike message_chunk): a
    // conversation-count is more identifying than a message-batch size (AC7 restricts to type/bytes/hash).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_NAME)
    expect(lines[0]).not.toContain(SECRET_CWD)
    expect(lines[0]).not.toContain('conv-1')
  })

  it('does NOT log on a malformed conversations throw path (#139)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeConversations({ conversations: [{ ...CONV_NAMED, name: 42 }] }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversation_created reply content-free, never a name / cwd / id, and no count (#241)', () => {
    const { log, lines } = captureLog()
    const SECRET_NAME = 'secret-conversation-title'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeConversationCreated({
      ...CREATED_NAMED,
      id: 'secret-conv-id',
      name: SECRET_NAME,
      cwd: SECRET_CWD
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversation_created')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (the conversations #139 posture).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_NAME)
    expect(lines[0]).not.toContain(SECRET_CWD)
    expect(lines[0]).not.toContain('secret-conv-id')
  })

  it('does NOT log on a malformed conversation_created throw path (#241)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeConversationCreated({ ...CREATED_NAMED, is_promoted: 'nope' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a session_transition content-free, never a decoded field (#254)', () => {
    const { log, lines } = captureLog()
    const SECRET_PREV = 'secret-previous-session-id'
    const SECRET_NEW = 'secret-new-session-id'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeSessionTransition({
      previous_session_id: SECRET_PREV,
      new_session_id: SECRET_NEW,
      reason: 'workspace_change',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: SECRET_CWD
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('session_transition')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (session ids / reason / occurred_at /
    // workspace_cwd) reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_PREV, SECRET_NEW, SECRET_CWD, 'workspace_change']) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed session_transition throw path (#254)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeSessionTransition({ ...SESSION_TRANSITION, reason: 'evicted' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a session_settings_updated content-free, never the session_id (#264)', () => {
    const { log, lines } = captureLog()
    const SECRET_ID = 'secret-session-id-value'
    const plaintext = encodeSessionSettingsUpdated({ session_id: SECRET_ID })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('session_settings_updated')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — the decoded session_id never reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_ID)
  })

  it('does NOT log on a malformed session_settings_updated throw path (#264)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated({}), log)).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a modeled error as inbound-decoded(error), never the ErrorPayload text (#116)', () => {
    const { log, lines } = captureLog()
    const SECRET_ERR = 'secret-daemon-error-detail'
    const plaintext = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      payload: { code: 'server.binary_offline', message: SECRET_ERR, retryable: true }
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    // Now modeled: it moves from inbound-unmodeled to inbound-decoded(error).
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('error')
    expect(record.hash).toMatch(HEX64)
    expect(lines[0]).not.toContain(SECRET_ERR)
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

  it('names the failure category only for a bad modal class / source — never echoes the value (#201, AC3)', () => {
    // A modal_shown whose class is out-of-enum, with the secret title/prompt present as valid strings.
    let shownErr: unknown = null
    try {
      parseInboundMessage(
        encodeModalShown({
          ...MODAL_SHOWN,
          class: 'destructive',
          title: 'secret-title',
          prompt: 'secret-prompt'
        })
      )
    } catch (e) {
      shownErr = e
    }
    expect(shownErr).toBeInstanceOf(WireDecodeError)
    const shownMsg = (shownErr as Error).message
    for (const leak of ['destructive', 'secret-title', 'secret-prompt']) {
      expect(shownMsg).not.toContain(leak)
    }

    // A modal_dismissed whose source is out-of-enum, with the secret outcome present.
    let dismissedErr: unknown = null
    try {
      parseInboundMessage(
        encodeModalDismissed({ modal_id: 'mdl', outcome: 'secret-outcome', source: 'admin' })
      )
    } catch (e) {
      dismissedErr = e
    }
    expect(dismissedErr).toBeInstanceOf(WireDecodeError)
    const dismissedMsg = (dismissedErr as Error).message
    for (const leak of ['admin', 'secret-outcome']) {
      expect(dismissedMsg).not.toContain(leak)
    }
  })
})
