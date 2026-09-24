// The workspace-file-READ channel pair between the renderer window and the background process
// (#1626): two channel constants, the request shape plus its boundary guard, and one sealed outcome
// union, imported by both process sides. The window names a conversation and a path in its
// workspace; the background process asks the host for the file as it is right now, verifies the
// answering stream, decodes it as UTF-8 and pushes back exactly one terminal. Nothing is stored.
//
// ITS OWN CHANNEL PAIR, NOT A MEMBER ON events.ts, for attachmentRetrieval.ts's reason: four renderer
// bridges end their DaemonEvent switch in assertNever, and an outcome here must never reach them.
// TWO CHANNELS, NOT AN INVOKE, for the same reason again: the terminal arrives long after the ask.
//
// CORRELATION IS A WINDOW-MINTED REQUEST KEY, where a retrieval correlates on its attachment id. The
// reader asks for the same path again on Refresh, so the path cannot tell two asks apart; the key can.
// It is a client-internal token, echoed back and never sent to the daemon.
//
// Channel constants + discriminated unions + one pure guard; no I/O, no state, nothing from src/main.
// Relative imports only: src/main and src/preload have no @shared alias.
import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalFailure
} from './attachmentRetrieval'

/** The ASK, renderer → main. Fire-and-forget (ipcRenderer.send / ipcMain.on), carrying one
 *  WorkspaceFileReadRequest. */
export const WORKSPACE_FILE_READ_CHANNEL = 'pyry:workspace-file-read' as const

/** The OUTCOME, main → renderer. Pushed (webContents.send / ipcRenderer.on), separate from the ask
 *  channel and from DAEMON_EVENT_CHANNEL. */
export const WORKSPACE_FILE_READ_EVENT_CHANNEL = 'pyry:workspace-file-read-event' as const

/**
 * Upper bound on the path, in UTF-16 code units, enforced at the guard. PATH_MAX's order (4096), so a
 * real workspace path always fits, and small enough that the envelope provably stays under the wire's
 * MAX_PLAINTEXT_BYTES (65519): JSON's worst escaping is six bytes per code unit, so the path costs at
 * most 24576 bytes and the conversation id at most 1536. readWorkspaceFileEnvelope.test.ts builds that
 * worst case and asserts it encodes.
 */
export const MAX_WORKSPACE_FILE_PATH_LENGTH = 4096

/**
 * What the window asks for. camelCase because this is a client-internal IPC contract; the background
 * process rebuilds the wire payload as a fresh literal from `conversationId` and `path` only, so the
 * request key and any smuggled key never reach the envelope.
 */
export interface WorkspaceFileReadRequest {
  /** Window-minted, echoed on the outcome, never sent to the daemon. */
  requestKey: string
  /** The conversation whose workspace holds the file. A lookup key the daemon validates. */
  conversationId: string
  /** The file, as the assistant's link named it. UNTRUSTED: sent to the daemon unchanged, which
   *  confines it. Never resolved, used as a local path or logged on this machine. */
  path: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer → main boundary. A failing ask
 * is DROPPED: no frame, no event.
 *
 * Shape and size only. The path gets no canonicity check because nothing on this side resolves it; the
 * daemon's confinement is the one gate. Non-empty is part of the shape: an empty path names nothing.
 * The `in` checks run on a narrowed object, so a `__proto__`-smuggled field is not an own property and
 * is refused on its own merits.
 */
export function isWorkspaceFileReadRequest(value: unknown): value is WorkspaceFileReadRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('requestKey' in value) || !('conversationId' in value) || !('path' in value)) return false
  const { requestKey, conversationId, path } = value as Record<string, unknown>
  return (
    isBoundedString(requestKey, MAX_RETRIEVAL_IDENTIFIER_LENGTH) &&
    isBoundedString(conversationId, MAX_RETRIEVAL_IDENTIFIER_LENGTH) &&
    isBoundedString(path, MAX_WORKSPACE_FILE_PATH_LENGTH)
  )
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * Why one read ended without the text, as a closed set of CLIENT-OWNED literals: the retrieval leg's
 * vocabulary (documented at AttachmentRetrievalFailure) minus `store-failed`, because nothing is stored
 * here, plus `not-text`.
 */
export type WorkspaceFileReadFailure =
  | Exclude<AttachmentRetrievalFailure, 'store-failed'>
  /** Everything arrived and verified, and the bytes are not valid UTF-8. */
  | 'not-text'

/**
 * The terminal outcomes of one ask, discriminated on `type`. EXACTLY ONE is pushed per ask that
 * passed the guard, on that ask's `requestKey`. No member carries the path, a filename or daemon text.
 * `text` is the file's content as the host holds it: daemon-supplied text that may be rendered,
 * escaped and length-bounded, and never put in a raw-markup sink or a log.
 */
export type WorkspaceFileReadEvent =
  | { type: 'loaded'; requestKey: string; text: string }
  | { type: 'failed'; requestKey: string; reason: WorkspaceFileReadFailure }
