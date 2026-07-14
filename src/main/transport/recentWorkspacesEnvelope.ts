// The post-handshake bare control-frame builder: it produces the serialized `recent_workspaces`
// envelope bytes the Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the
// outbound "ask" that makes the daemon reply with the recent-workspaces list. A sibling to
// listConversationsEnvelope.ts, following the same one-concern-per-file split the module already
// uses. Like list_conversations it is a BARE control frame — no payload struct, no selector (the
// request selects nothing; the daemon returns the distinct recent workspace paths, most-recent-first).
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.requestRecentWorkspaces) supplies — the envelope id
 * counter and the wall clock. No payload arg: this is a bare control frame. Kept explicit (not read
 * from globals) so the builder is pure and trivially unit-testable, exactly like
 * buildListConversations.
 */
export interface RecentWorkspacesInput {
  /** The recent_workspaces Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
}

/**
 * Build the `recent_workspaces` early-data bytes: a bare `recent_workspaces` Envelope, serialized to
 * UTF-8 via encodeEnvelope. Same shape as buildListConversations.
 *
 * The daemon's RecentWorkspacesPayload request is empty (pyrycode #888) — it never reads a payload for
 * this type, so it tolerates an absent, `{}`, or `null` payload. The binding constraint is the
 * desktop's OWN decodeEnvelope, which requires a present `payload` (codec.ts throws otherwise), and
 * Envelope.payload is required — not relaxed to optional (that would be a wire-type drift touching
 * every consumer; CLAUDE.md no-drift). So we emit a present-but-empty `payload: {}`, NOT an omission —
 * `{}` (not `null`) upholds the module's "never emit null on the wire" posture. Do not "fix" this to
 * an omission.
 *
 * MAY throw WireEncodeError in principle (encodeEnvelope's contract), but a fixed-shape ~80-byte
 * empty-payload envelope can never exceed MAX_PLAINTEXT_BYTES; the sole caller catches anyway.
 */
export function buildRecentWorkspaces(input: RecentWorkspacesInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'recent_workspaces',
    ts: input.ts,
    payload: {}
  }
  return encodeEnvelope(envelope)
}
