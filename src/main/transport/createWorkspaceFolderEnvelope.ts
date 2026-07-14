// The post-handshake payload-carrying `create_workspace_folder` builder: it serializes a
// caller-supplied CreateWorkspaceFolderPayload into the `create_workspace_folder` early-data bytes the
// Noise session (#7) / relay driver (#50) carry as an opaque Uint8Array — the outbound "ask" that makes
// the daemon create a fresh workspace folder (confined to the operator's $HOME) and reply with one
// `workspace_folder_created` frame carrying the created path. A sibling to createConversationEnvelope.ts
// / sendMessageEnvelope.ts, following the same one-concern-per-file split.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). Never re-export it through any renderer
// barrel — the raw bytes must stay out of the web layer.
import { encodeEnvelope } from './codec'
import type { Envelope, CreateWorkspaceFolderPayload } from '../../shared/wire/types'

/**
 * Inputs the consumer (createDaemonConnection.createWorkspaceFolder) supplies — the envelope id
 * counter, the wall clock, and the already-validated payload. Kept explicit (not read from globals) so
 * the builder is pure and trivially unit-testable, exactly like buildCreateConversation.
 */
export interface CreateWorkspaceFolderInput {
  /** The create_workspace_folder Envelope's numeric id (the consumer's id counter). */
  id: number
  /** RFC3339 timestamp (the consumer's clock) — never read from the wall clock here. */
  ts: string
  /** The payload the consumer builds as a fresh literal (its two required strings), serialized verbatim. */
  payload: CreateWorkspaceFolderPayload
}

/**
 * Build the `create_workspace_folder` early-data bytes: a `create_workspace_folder` Envelope wrapping
 * the payload, serialized to UTF-8 via encodeEnvelope. Same shape as buildCreateConversation. The fresh
 * literal that bounds the field set to exactly `parent` / `name` lives in the connection method
 * (createWorkspaceFolder).
 *
 * MAY throw WireEncodeError when the serialized envelope exceeds MAX_PLAINTEXT_BYTES; the sole caller
 * (connection.createWorkspaceFolder) catches it and drops the send.
 */
export function buildCreateWorkspaceFolder(input: CreateWorkspaceFolderInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'create_workspace_folder',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
