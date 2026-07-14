// The post-handshake payload-carrying `change_workspace` builder: it serializes a caller-supplied
// ChangeWorkspacePayload into the `change_workspace` early-data bytes the Noise session (#7) / relay
// driver (#50) carry as an opaque Uint8Array — the outbound "ask" that moves a conversation's recorded
// workspace to a different folder. The daemon updates the recorded workspace (`cwd`) and confirms by
// REPLYING to the requesting client with the existing `conversation_updated` record; the desktop does not
// correlate that reply here (the Workspace Picker reads the new workspace from the re-list). A sibling to
// renameConversationEnvelope.ts / promoteConversationEnvelope.ts, following the same
// one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, ChangeWorkspacePayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.changeWorkspace) supplies — the envelope id counter,
 * the wall clock, and the already-validated payload. Kept explicit (not read from globals) so the
 * builder is pure and trivially unit-testable, exactly like buildRenameConversation.
 */
export interface ChangeWorkspaceInput {
  /** The change_workspace Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its two required-string fields), serialized verbatim. */
  payload: ChangeWorkspacePayload
}

/**
 * Build the `change_workspace` early-data bytes: a `change_workspace` Envelope wrapping the payload,
 * serialized to UTF-8 via encodeEnvelope. Same shape as buildRenameConversation, but with the second
 * field renamed `cwd` (the target workspace path): both are required strings, so there is no
 * explicit-`null` preservation concern — the payload serializes verbatim. The fresh literal that bounds
 * the field set lives in the connection method (changeWorkspace).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.changeWorkspace) catches it and drops the send.
 */
export function buildChangeWorkspace(input: ChangeWorkspaceInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'change_workspace',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
