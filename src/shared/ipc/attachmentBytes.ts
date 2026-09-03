// The attachment-BYTES channel pair between the renderer window and the background process (#866):
// two channel constants, the request shape plus its boundary guard, and one sealed outcome union,
// imported by both process sides. The window names an attachment; the background process resolves
// that identifier inside the app's own attachment directory, reads the file, and answers exactly one
// terminal — the bytes, or a client-owned failure literal.
//
// THE WINDOW CANNOT BE HANDED A PATH, which is what this channel exists to work around.
// `setWindowOpenHandler` drops every `file:` URL and every custom-protocol URL precisely so a hostile
// link cannot open a local file, and that block stays untouched. A PROTOCOL HANDLER WAS THE REJECTED
// ALTERNATIVE: it would cost a privileged-scheme registration and, decisively, cannot express the
// distinction below — its only failure surface is a response status, so a refusal and a missing file
// would both reach the window as one indistinguishable image error.
//
// A SIBLING TO attachmentSave.ts, NOT A MEMBER ON events.ts, for that module's recorded reason: four
// renderer bridges — timelineBridge, questionBridge, modalBridge, daemonEventBridge — end their
// DaemonEvent switch in assertNever, so a member there is a compile error in four files that have
// nothing to do with attachments, for four no-op arms.
//
// TWO CHANNELS, NOT AN INVOKE, matching all three attachment legs: a separate answer channel keeps
// the two directions unconfusable, and keeps an outcome away from the daemon-event bridges.
//
// THIS IS THE FIRST ATTACHMENT EVENT THAT IS NOT CONTENT-FREE, and that is the point of the ticket
// rather than a lapse. The three siblings each declare that no member can hold the file's bytes; this
// one declares exactly that field and nothing else. Everything AROUND the bytes is unchanged: NO
// PATH, NO DIRECTORY AND NO URL is declarable in either direction, and the attachment directory is
// computed at the composition root from Electron's per-user app-data location, never from anything
// the window sent.
//
// THE CHANNEL CARRIES BYTES AND NOTHING ELSE — no filename, no media type. The retrieval leg
// deliberately never kept either (attachmentReassembler reads neither `filename` nor `mime_type`, and
// the stored file is extension-less on purpose), so there is nothing main-side to read one back from.
// Whether a consumer needs a type at all is #868's question.
//
// This module is channel constants + a discriminated union + one pure guard, with no I/O and no
// state. It imports nothing from src/main (layering: shared is loaded by preload and renderer and
// must not pull main-only code) — notably not resolveAttachmentPath, which the renderer must not be
// able to reach. Relative imports only: src/main and src/preload have no @shared alias.

/** The channel the BYTES ASK travels on, renderer → main. Fire-and-forget (ipcRenderer.send /
 *  ipcMain.on), carrying one AttachmentBytesRequest. Single source of truth: the preload sender ships
 *  on it, the composition root registers on it. */
export const ATTACHMENT_BYTES_CHANNEL = 'pyry:attachment-bytes' as const

/** The channel the OUTCOME travels on, main → renderer. Pushed (webContents.send / ipcRenderer.on),
 *  deliberately separate from ATTACHMENT_BYTES_CHANNEL so the two directions cannot be confused, and
 *  separate from DAEMON_EVENT_CHANNEL so an outcome never reaches the daemon-event bridges. */
export const ATTACHMENT_BYTES_EVENT_CHANNEL = 'pyry:attachment-bytes-event' as const

/**
 * Upper bound on the accepted identifier, in UTF-16 code units, enforced at the guard —
 * MAX_SAVE_IDENTIFIER_LENGTH's argument, restated for the one attachment ask that never reaches the
 * wire. What is left once the envelope clause is removed is boundary hygiene: the value the renderer
 * supplies is bounded before the background process does anything with it, exactly as
 * MAX_PASTE_LENGTH bounds a paste before main runs a regex over it.
 *
 * It is a SIZE bound, not a shape or canonicity one, so it leaves the single-gate argument intact: a
 * `../..` identifier still passes here and is still refused by `resolveAttachmentPath`, which is also
 * where the real ceiling lives — a 64-character alphabet, two orders of magnitude below this.
 */
export const MAX_BYTES_IDENTIFIER_LENGTH = 256

/**
 * What the window asks for: an attachment, AND NOTHING ELSE. One field, because the bytes are
 * addressed by the identifier alone — there is no name to supply (unlike the save leg, where the
 * window owns the display name) and nothing else this side needs.
 *
 * camelCase, not the wire's snake_case, because this is a client-internal IPC contract rather than a
 * wire type. Nothing downstream rebuilds a value from this object's other keys, so an ask carrying
 * extra ones is accepted and its extras are simply never read — a smuggled `path` or `directory`
 * reaches nothing.
 */
export interface AttachmentBytesRequest {
  /** The attachment to read. Untrusted in the same way a wire field is: it may carry `..`, a
   *  separator or an absolute path. `resolveAttachmentPath` is the sole gate that refuses a
   *  non-canonical one, before any filesystem call. */
  attachmentId: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer→main boundary —
 * isAttachmentSaveRequest's role for this channel. A failing ask is DROPPED: no filesystem call, no
 * event. There is no identifier to address an answer to, and a conforming renderer never sends one.
 *
 * SHAPE ONLY, NOT CANONICITY, and deliberately so. `resolveAttachmentPath` already refuses a
 * non-canonical identifier before any filesystem call, and its header argues the general case: two
 * divergent checks on one directory is exactly the shape that ends with one of them being weaker than
 * the other. A `../..` identifier therefore passes here and is refused there.
 *
 * The field read is an `in`-guarded property access on a narrowed `object`, so a hostile ask built
 * with a `__proto__` key is refused on its own merits: the polluting object has no OWN
 * `attachmentId`, and reading one inherited from Object.prototype is not possible here because the
 * typeof test runs on the value actually found.
 */
export function isAttachmentBytesRequest(value: unknown): value is AttachmentBytesRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('attachmentId' in value)) return false
  const { attachmentId } = value as Record<string, unknown>
  return (
    typeof attachmentId === 'string' &&
    attachmentId.length > 0 &&
    attachmentId.length <= MAX_BYTES_IDENTIFIER_LENGTH
  )
}

/**
 * Why one read ended without bytes, as a closed set of CLIENT-OWNED literals. Every inhabitant is a
 * string written in this repo, so a value of this type provably carries no path, no errno, no
 * filename and no part of the identifier.
 *
 * THREE MEMBERS, AND THE LINE BETWEEN THEM IS WHAT A CONSUMER CAN DO NEXT — `storeAttachment`'s test,
 * applied where this ticket draws the line. Note that this is the one place this leg parts from
 * `AttachmentSaveFailure`, which MERGES a refusal and an absent file: that channel's consumer answers
 * both with the same retry, and this channel's consumer does not.
 */
export type AttachmentBytesFailure =
  /** The identifier never named a file here: `resolveAttachmentPath` rejected it before any
   *  filesystem call. A consumer must NOT retry — fetching cannot make a non-canonical identifier
   *  resolvable, and no amount of waiting will change the answer. */
  | 'refused'
  /** The identifier resolved and nothing readable is at that path — absent, unreadable, or not a
   *  file. THE ONE A CONSUMER CAN ACT ON: fetch the attachment (#996) and ask again. The causes are
   *  merged because a consumer's answer to all of them is that same fetch. */
  | 'unavailable'
  /** More reads are already in flight than this client will run at once. A CLIENT-OWNED refusal, not
   *  a host answer: it states a limit the caller can act on by waiting, and it is what keeps the
   *  accumulated-bytes bound meaningful, since the window is untrusted.
   *  AttachmentRetrievalFailure's member of the same name and the same meaning. */
  | 'busy'

/**
 * The terminal outcomes of one read, discriminated on `type`. EXACTLY ONE is answered per ask that
 * passed the guard, which is structural rather than an invariant to maintain: the driver answers with
 * a promise, and a promise settles once.
 *
 * `attachmentId` is the correlation key, and it is the window's OWN value coming back — never a
 * wire-supplied one — so two concurrent asks are tellable apart. It is echoed even on a refused
 * identifier: the window named it and can match on it.
 *
 * `bytes` is the ONLY field that carries content, and it carries it whole and unchanged. Everything
 * the three sibling events refuse to declare is still absent here: no path, no directory, no URL, no
 * filename, no media type, no digest, no errno.
 */
export type AttachmentBytesEvent =
  /** The file was read. `bytes` spans its own ArrayBuffer exactly — see `createAttachmentBytes`, where
   *  that is enforced, and why it must be. */
  | { type: 'delivered'; attachmentId: string; bytes: Uint8Array }
  /** The read ended with no bytes. */
  | { type: 'failed'; attachmentId: string; reason: AttachmentBytesFailure }
