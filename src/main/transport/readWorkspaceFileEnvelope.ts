// The `read_workspace_file` builder (#1626): it serializes one ReadWorkspaceFilePayload into the
// envelope bytes the Noise session carries — the ask that makes the daemon read one markdown file live
// from a conversation's workspace and stream it back as `attachment_chunk` frames. A sibling to
// requestAttachmentEnvelope.ts in shape and posture: the envelope id and the timestamp are explicit
// inputs, and nothing here validates.
//
// MAIN-PROCESS ONLY. It imports codec.ts (Node `Buffer`). It makes no log call of any kind: the path
// names host layout and must never reach a log.
import { encodeEnvelope } from './codec'
import type { Envelope, ReadWorkspaceFilePayload } from '../../shared/wire/types'

/** The consumer's envelope id counter, clock and the ask itself — explicit so the builder is pure. */
interface ReadWorkspaceFileInput {
  /** The envelope id. The daemon's answering chunks and its reject name it in `in_reply_to`. */
  id: number
  /** RFC3339 timestamp from the consumer's clock. */
  ts: string
  /** The conversation and path, serialized verbatim. */
  payload: ReadWorkspaceFilePayload
}

/**
 * Build one `read_workspace_file` envelope's bytes. Same field order as every sibling builder.
 *
 * MAY throw WireEncodeError (encodeEnvelope's contract) for an over-cap envelope. The IPC guard's
 * bounds keep a window-supplied ask provably under MAX_PLAINTEXT_BYTES; a main-side caller passing
 * more gets the transport's `send-failed`, never a truncated path.
 */
export function buildReadWorkspaceFile(input: ReadWorkspaceFileInput): Uint8Array {
  const envelope: Envelope = {
    id: input.id,
    type: 'read_workspace_file',
    ts: input.ts,
    payload: input.payload
  }
  return encodeEnvelope(envelope)
}
