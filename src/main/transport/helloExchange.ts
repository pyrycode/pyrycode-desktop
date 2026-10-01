// The application-handshake envelope layer that sits on top of the #5 wire codec: it turns the
// device identity + stored token into the client `hello` early-data bytes, and turns the daemon's
// `hello_ack` early-data bytes back into a validated, typed HelloAckPayload. The Noise session (#7)
// and relay driver (#50) carry both as opaque Uint8Arrays and defer the envelope semantics here.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`) and the `hello` it builds carries the
// device token as Noise early-data. Never re-export it through any renderer barrel — the token and
// the raw ack bytes must stay out of the web layer.
//
// parseHelloAck sits on the untrusted→trusted boundary: it layers the semantic narrowing the codec
// deliberately defers (Envelope.payload stays `unknown`) onto decodeEnvelope's structural boundary.
// It FAILS CLOSED — throws WireDecodeError, never returns a partial value — and its error messages
// name the failure CATEGORY only, never echoing the token, the ack values, or the raw bytes. This
// module performs no logging.
import { encodeEnvelope, decodeEnvelope, makeHelloClientPayload, WireDecodeError } from './codec'
import type { Envelope, HelloAckPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (#62) sources — the stored token, app identity, an id counter, and the wall
 * clock. Kept explicit (not read from globals) so buildClientHello is deterministic and trivially
 * unit-testable: no clock read, no storage, no side effects.
 */
export interface ClientHelloInput {
  /** The hello Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  deviceName: string
  clientVersion: string
  /** The stored device token, serialized onto the wire as Noise early-data. */
  token: string
  /**
   * OPTIONAL advertised capabilities. Omitted → the codec's default `[]`. Never hardcoded to
   * `interactive` here: the desktop event pipeline models only the coarse message types, so
   * advertising interactive would make the daemon fan out envelopes this client cannot render. A
   * caller that has modeled the structured stream passes them in explicitly.
   */
  capabilities?: readonly string[]
  /** Legacy timestamp field, unused by the daemon. */
  lastSeenTs?: string
  /** Latest admitted event position for bounded replay on reconnect. */
  lastEventId?: number
}

/**
 * Build the client `hello` early-data bytes: a `hello` Envelope wrapping a defaults-injected
 * HelloClientPayload, serialized to UTF-8 via encodeEnvelope. Total on well-typed input.
 *
 * The payload is built via makeHelloClientPayload (never hand-rolled) so the injected
 * `role:'client'` / `protocol_versions:['v2']` defaults and the `capabilities` / `last_seen_ts`
 * omitempty handling stay in one place — the one thing that constructor exists to prevent dropping.
 */
export function buildClientHello(input: ClientHelloInput): Uint8Array {
  const payload = makeHelloClientPayload({
    deviceName: input.deviceName,
    clientVersion: input.clientVersion,
    token: input.token,
    capabilities: input.capabilities,
    lastSeenTs: input.lastSeenTs,
    lastEventId: input.lastEventId
  })
  const envelope: Envelope = { id: input.id, type: 'hello', ts: input.ts, payload }
  return encodeEnvelope(envelope)
}

/** True iff `value` is a non-null, non-array object — the structural minimum for a wire payload.
 *  A small local copy: codec's `isRecord` is not exported, and duplicating it keeps this the edge
 *  that validates the opaque payload. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one required string field off the payload, or fail closed with a category-only message. */
function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string') {
    throw new WireDecodeError(`missing required field: ${field}`)
  }
  return value
}

/**
 * Parse `hello_ack` early-data bytes into a typed HelloAckPayload. Fail-closed: throws
 * WireDecodeError (never a partial value) on any structural or semantic mismatch, so #62 catches a
 * single type for both. The returned value carries only the four known fields; unknown server-added
 * keys are tolerated (forward-compat, matching the codec) but not copied through.
 *
 * `capabilities` is OPTIONAL, not required: the daemon marshals hello_ack with it omitempty, so a
 * legitimate ack usually omits it. Treating it as required would fail-closed on a real response and
 * silently break the handshake — the exact failure this layer exists to prevent. Absent → `[]`.
 */
export function parseHelloAck(bytes: Uint8Array): HelloAckPayload {
  const envelope = decodeEnvelope(bytes)
  if (envelope.type !== 'hello_ack') {
    throw new WireDecodeError('unexpected envelope type')
  }
  const payload = envelope.payload
  if (!isRecord(payload)) {
    throw new WireDecodeError('malformed hello_ack payload')
  }

  const protocol_version = requireString(payload, 'protocol_version')
  const server_id = requireString(payload, 'server_id')
  const conn_id = requireString(payload, 'conn_id')

  let capabilities: string[] = []
  if ('capabilities' in payload) {
    const raw = payload.capabilities
    if (!Array.isArray(raw) || !raw.every((c) => typeof c === 'string')) {
      throw new WireDecodeError('malformed hello_ack capabilities')
    }
    capabilities = [...raw]
  }

  return {
    protocol_version, server_id, conn_id, capabilities,
    ...('workspace_root' in payload ? { workspace_root: requireString(payload, 'workspace_root') } : {})
  }
}
