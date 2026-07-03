// The wire codec: turns the shared wire types (../../shared/wire/types) into — and back from — the daemon's
// on-the-wire bytes, byte-identical to what pyrycode-mobile sends. It is the serialization
// foundation for the connect–send–stream round-trip; #7 (the Noise session) encrypts the bytes
// this module produces and base64-wraps the resulting Noise bytes into an InnerFrameV2.data.
//
// Ported field-for-field from the mobile Kotlin codec (MobileWireCodec.kt: the MobileJson
// config + base64Std* helpers; MobileWireModels.kt / MessagePayload.kt: field names + defaults).
// The daemon does not care which client speaks it, so a byte mismatch — a dropped default, an
// emitted null, the wrong base64 alphabet, or a silently-truncated decode — breaks the contract
// silently (CLAUDE.md; ADR 0002). Do not drift the encoded form without a matching daemon change.
//
// MAIN-PROCESS ONLY. This file uses Node `Buffer` and handles secret material (device tokens in
// hello/QR payloads) and message plaintext, all of which must stay out of the renderer. It is
// imported by src/main consumers (#7, the relay wiring) by relative path and MUST NOT be
// re-exported through any barrel the renderer imports. `../../shared/wire/types` (which the
// renderer does import) stays Buffer-free — keep the split.
//
// The decode* functions sit on the untrusted→trusted network boundary: they parse bytes a
// malicious relay peer could shape. They FAIL CLOSED — throw WireDecodeError, never return a
// partial or silently-truncated value — and their error messages name the failure CATEGORY only,
// never echoing the raw bytes or decoded field values (they carry the device token and message
// plaintext). This module performs no logging.
import { PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from '../../shared/wire/types'
import type { Envelope, InnerFrameV2, HelloClientPayload } from '../../shared/wire/types'

/** Deterministic, catchable decode-failure signal at the network trust boundary. Its message
 *  names the failure category only — never the raw input or decoded values (secret-safety). */
export class WireDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WireDecodeError'
  }
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

/** base64-std encode (A–Za–z0–9+/, padded) — Go base64.StdEncoding. Total on any input. */
export function base64StdEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * STRICT base64-std decode. Node's `Buffer.from(s, 'base64')` is lenient — it strips non-alphabet
 * chars, accepts url-safe `-`/`_`, and tolerates non-canonical final quanta (e.g. `'YQ==garbage'`
 * → only `'YQ=='`; `'YR=='` → the same byte as `'YQ=='`, no error). That would let a malformed
 * frame decode to a silently-truncated or off-contract value. Go's `base64.StdEncoding` and
 * mobile's `Base64.getDecoder()` are strict. Replicate that by the canonical-form test: lenient-
 * decode, then require the input to be the exact base64-std re-encoding of those bytes. Node's
 * encoder emits only canonical output, so any garbage-bearing, url-safe, wrong-length, or
 * non-canonical-quantum input fails the equality and throws WireDecodeError — no truncation. The
 * empty string re-encodes to itself and stays valid.
 */
export function base64StdDecode(data: string): Uint8Array {
  const decoded = new Uint8Array(Buffer.from(data, 'base64'))
  if (base64StdEncode(decoded) !== data) {
    throw new WireDecodeError('malformed base64')
  }
  return decoded
}

/** Serialize an InnerFrameV2 to WS text (a string). `v:2` is a literal type, so it is always
 *  emitted. `data` carries base64-std of the Noise bytes — those bytes are #7's, not this codec's. */
export function encodeInnerFrame(frame: InnerFrameV2): string {
  return JSON.stringify(frame)
}

/**
 * Parse inbound frame bytes (as delivered by `ws`) into an InnerFrameV2. Requires string `type`
 * and `data`; tolerates any `v` (do not hard-reject a future version) and any extra server-added
 * keys (forward-compat). Throws WireDecodeError on malformed UTF-8/JSON or a missing/mistyped
 * required field.
 */
export function decodeInnerFrame(bytes: Uint8Array): InnerFrameV2 {
  const obj = parseJsonObject(bytes)
  const { type, data } = obj
  if (typeof type !== 'string') throw new WireDecodeError('missing required field: type')
  if (typeof data !== 'string') throw new WireDecodeError('missing required field: data')
  return { v: 2, type, data }
}

/**
 * Serialize an Envelope to UTF-8 plaintext bytes — the Noise plaintext #7 encrypts (or handshake
 * early-data). The Envelope is NOT itself base64-encoded; base64-std wraps the Noise bytes that
 * ride in InnerFrameV2.data. Envelope has no defaulted fields, so callers build it directly and
 * omit absent optionals; JSON.stringify drops `undefined` keys and never emits `null` (the
 * tightened types forbid `null` optionals). Cannot fail on well-typed input.
 */
export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

/**
 * Parse plaintext Envelope bytes. Requires numeric `id`, string `type`, string `ts`, and a
 * present `payload`; tolerates extra server-added keys (forward-compat). `payload` stays an
 * OPAQUE carrier (typed unknown) — decoded but never narrowed to a concrete payload type here;
 * consumers (#7 and later) validate it at their own edge. Throws WireDecodeError on malformed
 * UTF-8/JSON or a missing/mistyped required field.
 */
export function decodeEnvelope(bytes: Uint8Array): Envelope {
  const obj = parseJsonObject(bytes)
  const { id, type, ts } = obj
  if (typeof id !== 'number') throw new WireDecodeError('missing required field: id')
  if (typeof type !== 'string') throw new WireDecodeError('missing required field: type')
  if (typeof ts !== 'string') throw new WireDecodeError('missing required field: ts')
  if (!('payload' in obj)) throw new WireDecodeError('missing required field: payload')
  const envelope: Envelope = { id, type, ts, payload: obj.payload }
  if (typeof obj.in_reply_to === 'number') envelope.in_reply_to = obj.in_reply_to
  if (typeof obj.event_id === 'number') envelope.event_id = obj.event_id
  return envelope
}

/**
 * The one default-injecting constructor. TS interfaces carry no runtime defaults, so the
 * non-literal defaults `protocol_versions` (["v2"]) and `capabilities` (["interactive"]) must be
 * injected here (mobile's `encodeDefaults = true`). `role: 'client'` is a literal type and needs
 * no injection. `last_event_id` is emitted only when provided (omitted, never null, otherwise).
 * HelloClientPayload is the ONLY encode-side payload with non-literal defaults — hence one
 * constructor, not a per-payload wrapper.
 */
export function makeHelloClientPayload(input: {
  deviceName: string
  clientVersion: string
  token: string
  lastEventId?: number
}): HelloClientPayload {
  const payload: HelloClientPayload = {
    role: 'client',
    device_name: input.deviceName,
    client_version: input.clientVersion,
    protocol_versions: [PROTOCOL_VERSION],
    token: input.token,
    capabilities: [CAPABILITY_INTERACTIVE]
  }
  if (input.lastEventId !== undefined) payload.last_event_id = input.lastEventId
  return payload
}

/** True iff `value` is a non-null, non-array object — the structural minimum for a wire message. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Shared decode front-half: untrusted bytes → JSON object. Decodes UTF-8 with `fatal: true` so
 * invalid byte sequences throw (not silently replaced with U+FFFD), catches every JSON.parse
 * throw (SyntaxError and RangeError from deep nesting), and requires an object at the top level.
 * Every failure becomes a category-only WireDecodeError.
 */
function parseJsonObject(bytes: Uint8Array): Record<string, unknown> {
  let text: string
  try {
    text = utf8Decoder.decode(bytes)
  } catch {
    throw new WireDecodeError('invalid UTF-8')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new WireDecodeError('malformed JSON')
  }
  if (!isRecord(parsed)) throw new WireDecodeError('malformed JSON: not an object')
  return parsed
}
