// The post-handshake payload-carrying `rename_workspace` builder: it serializes a caller-supplied
// RenameWorkspacePayload into the `rename_workspace` early-data bytes the Noise session (#7) / relay
// driver (#50) carry as an opaque Uint8Array — the outbound "ask" that changes a WORKSPACE's stored
// label (a literal `null` clears it). The daemon polices the whole contract server-side (the `path`
// must equal a stored conversation's `cwd` byte for byte, the label must be non-empty after trimming
// and at most 128 characters) and confirms by REPLYING to the requesting client with a
// `workspace_updated` record; the desktop does not correlate that reply here — #1288's inbound path
// re-lists and the sidebar reads the new label off the authoritative `conversations` reply. A sibling
// to renameConversationEnvelope.ts / createWorkspaceFolderEnvelope.ts, following the same
// one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, RenameWorkspacePayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.renameWorkspace) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildRenameConversation.
 */
export interface RenameWorkspaceInput {
  /** The rename_workspace Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its two modeled fields), serialized verbatim. */
  payload: RenameWorkspacePayload
}

/**
 * Build the `rename_workspace` early-data bytes: a `rename_workspace` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildRenameConversation, with ONE contract
 * difference worth naming: `label` is nullable, and a literal `null` must SURVIVE onto the wire rather
 * than be dropped to an absent key — the daemon reads `null` as "clear the label" and an absent key as
 * malformed. `JSON.stringify` preserves a null-valued property, so serializing the payload verbatim is
 * what makes that hold; the fresh literal that names the key unconditionally (and bounds the field set)
 * lives in the connection method (renameWorkspace).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.renameWorkspace) catches it and drops the send.
 */
export function buildRenameWorkspace(input: RenameWorkspaceInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'rename_workspace',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
