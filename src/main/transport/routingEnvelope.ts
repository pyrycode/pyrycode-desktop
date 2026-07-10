// The JSON routing-envelope codec — the daemon-side wrapper the fake routing relay (#251) speaks
// on its /v1/server leg. It is the TypeScript port of Go's `protocol.RoutingEnvelope`
// (../../pyrycode/internal/protocol/envelope.go:42-77): the relay prepends a `conn_id` per phone,
// carries the phone's pairing `token` on the FIRST phone→binary frame only, and honours a
// `close_code` on binary→phone frames. This module is the /v1/server-leg wire; the /v1/client leg
// stays RAW and needs no wire types.
//
// TEST-ONLY. It is a distinct, independently-testable concern (wrap/unwrap has no I/O), co-located
// in its own module per the codebase's `*Envelope.ts` convention. It MUST NOT import ./codec, the
// Noise modules, or any @shared wire type: the inner application `frame` is opaque bytes the relay
// never parses — content-blindness is a structural property, enforced by keeping this file's
// import surface empty.
//
// SECURITY: `token` is plaintext credential material. This module never logs it (it never logs at
// all) and never reads it back off the wire — `decodeRoutingEnvelope` reads only conn_id / frame /
// close_code, so a hostile server-leg envelope's injected `token` is dropped, never echoed to a
// client (mirrors the MUST-NOT-log flag at envelope.go:65-67).

/** The decoded server→client routing envelope, mapped to camelCase at the wire boundary. */
export interface DecodedRoutingEnvelope {
  /** The relay-assigned per-connection id the frame is addressed to. */
  connId: string
  /** The opaque inner frame re-serialised to text, or `null` for a close-only envelope (`frame`
   *  absent or JSON `null` — Go's `if string(frame) == "null"` case). */
  frameText: string | null
  /** The WS close code to apply after forwarding `frame`; `0` when `close_code` is absent or
   *  non-numeric (no close requested). */
  closeCode: number
}

/** True iff `value` is a non-null, non-array object — the structural minimum for a wire envelope.
 *  Mirrors codec.ts's `isRecord`; kept local so this module imports nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build one client→server wire frame: `{"conn_id":…,"frame":<frameText verbatim>[,"token":…]}`.
 *
 * `frameText` is the client's opaque frame (already-valid JSON — the app sends InnerFrameV2 text)
 * spliced VERBATIM as the JSON `frame` value, the direct port of Go's `json.RawMessage(data)`; it
 * is never parsed or re-serialised, so the relay stays content-blind. `conn_id` and `token` go
 * through `JSON.stringify` for correct escaping (a value with quotes/backslashes cannot break out
 * of the JSON string). `token` is emitted only when provided AND non-empty (Go `omitempty`);
 * `close_code` is never emitted here (it is always zero on client→server).
 */
export function encodeRoutingEnvelope(connId: string, frameText: string, token?: string): string {
  const parts = [`"conn_id":${JSON.stringify(connId)}`, `"frame":${frameText}`]
  if (token !== undefined && token !== '') {
    parts.push(`"token":${JSON.stringify(token)}`)
  }
  return `{${parts.join(',')}}`
}

/**
 * Parse one server→client wire frame. Reading `conn_id`/`close_code` requires parsing the wrapper,
 * but the inner `frame` payload is never inspected — its `v`/`type`/`data` are never read; it is
 * re-serialised back to text (value-identical; the client's tolerant `decodeInnerFrame` accepts
 * it, codec.ts:94-101).
 *
 * FAIL-CLOSED: returns `null` on malformed JSON, a non-object top level, or a missing/mistyped
 * `conn_id` — the relay drops the frame and keeps serving. NEVER throws. Extra keys are tolerated
 * (forward-compat). It reads no `token` (the server never sends one), so a hostile envelope cannot
 * smuggle credential material back to a client.
 */
export function decodeRoutingEnvelope(text: string): DecodedRoutingEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const connId = parsed.conn_id
  if (typeof connId !== 'string') return null

  const frame = parsed.frame
  // `frame` absent or JSON `null` → close-only envelope (no frame to forward).
  const frameText = frame === undefined || frame === null ? null : JSON.stringify(frame)

  const closeCodeRaw = parsed.close_code
  const closeCode = typeof closeCodeRaw === 'number' ? closeCodeRaw : 0

  return { connId, frameText, closeCode }
}
