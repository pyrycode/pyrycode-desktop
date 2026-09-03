// The attachment-SAVE channel pair between the renderer window and the background process (#814): two
// channel constants, the request shape plus its boundary guard, and one sealed outcome union, imported
// by both process sides. The window names an attachment and the name it draws for it; the background
// process resolves that identifier inside the app's own attachment directory, copies the file into the
// operating system's Downloads folder with no save dialog, reveals it with the file selected, and pushes
// back exactly one terminal.
//
// A SIBLING TO attachmentRetrieval.ts, NOT A MEMBER ON events.ts, for that module's recorded reason:
// four renderer bridges — timelineBridge, questionBridge, modalBridge, daemonEventBridge — end their
// DaemonEvent switch in assertNever, so a member there is a compile error in four files that have
// nothing to do with attachments, for four no-op arms.
//
// TWO CHANNELS, NOT AN INVOKE, matching both attachment legs: the terminal arrives after a resolve, a
// sanitise, a bounded copy loop and a reveal, and a separate answer channel keeps the two directions
// unconfusable.
//
// NO PATH AND NO DIRECTORY CROSSES IN EITHER DIRECTION (AC 1). The ask carries an identifier and a
// DISPLAY-DERIVED name; the event carries that identifier back and a client-owned literal. Both
// directories — the app-private attachment store and Downloads — are computed at the composition root
// from Electron, never from anything the window sent.
//
// WHY THE NAME COMES FROM THE RENDERER AT ALL. Main does not have it: the retrieval leg deliberately
// never keeps it (attachmentReassembler.ts never reads `filename` or `mime_type`, the stored file is
// extension-less on purpose, and AttachmentRetrievalEvent is content-free by construction), so there is
// no store, map or sidecar to read one back from. The renderer does have it, from the settled attachment
// in the timeline. It therefore crosses as UNTRUSTED renderer-supplied text and main re-runs
// sanitizeAttachmentFilename on the value it actually builds the path from — the crossing that module's
// own header anticipates. The name is DISPLAY-DERIVED, NOT ADDRESSING: it selects nothing, because the
// bytes are addressed by the identifier alone, so a wrong or hostile name saves the right file under a
// poor name, never a different file.
//
// This module is channel constants + a discriminated union + one pure guard, with no I/O and no state.
// It imports nothing from src/main (layering: shared is loaded by preload and renderer and must not pull
// main-only code) — notably not sanitizeAttachmentFilename, which the renderer must not be able to reach.
// Relative imports only: src/main and src/preload have no @shared alias.

/** The channel the SAVE ASK travels on, renderer → main. Fire-and-forget (ipcRenderer.send /
 *  ipcMain.on), carrying one AttachmentSaveRequest. Single source of truth: the preload sender ships on
 *  it, the composition root registers on it. */
export const ATTACHMENT_SAVE_CHANNEL = 'pyry:attachment-save' as const

/** The channel the OUTCOME travels on, main → renderer. Pushed (webContents.send / ipcRenderer.on),
 *  deliberately separate from ATTACHMENT_SAVE_CHANNEL so the two directions cannot be confused, and
 *  separate from DAEMON_EVENT_CHANNEL so a save outcome never reaches the daemon-event bridges. */
export const ATTACHMENT_SAVE_EVENT_CHANNEL = 'pyry:attachment-save-event' as const

/**
 * Upper bound on the accepted identifier, in UTF-16 code units, enforced at the guard —
 * MAX_RETRIEVAL_IDENTIFIER_LENGTH's argument minus its envelope clause, because this ask never reaches
 * the wire. What is left is boundary hygiene: the value the renderer supplies here is bounded before the
 * background process does anything with it, exactly as MAX_PASTE_LENGTH bounds a paste before main runs
 * a regex over it.
 *
 * It is a SIZE bound, not a shape or canonicity one, so it leaves the single-gate argument intact: a
 * `../..` identifier still passes here and is still refused by `resolveAttachmentPath`, which is also
 * where the real ceiling lives — a 64-character alphabet, two orders of magnitude below this.
 */
export const MAX_SAVE_IDENTIFIER_LENGTH = 256

/**
 * Upper bound on the accepted file name, in UTF-16 code units, enforced at the guard.
 *
 * THIS IS A DROP BOUND, NOT THE TRUNCATION attachmentFilename.ts's non-goals forbid. Nothing here or
 * downstream shortens the name that becomes the path component; an ask over this bound is refused whole
 * at the boundary and never reaches the sanitiser. The reason it exists is that
 * `sanitizeAttachmentFilename` walks its input CODE POINT BY CODE POINT, so an unbounded string from a
 * compromised window is a main-process stall — the hazard MAX_PASTE_LENGTH closes one channel over.
 *
 * 4096 IS CHOSEN TO KEEP AC 5's ENAMETOOLONG OUTCOME REACHABLE. The largest NAME_MAX in play is 255
 * bytes (APFS, ext4, NTFS), so every name a filesystem could plausibly reject still passes this guard
 * and surfaces as a failed copy, which is where that outcome is specified to come from. Lowering this
 * below 255 would silently convert an ENAMETOOLONG failure into a dropped ask with no answer at all.
 */
export const MAX_SAVE_FILENAME_LENGTH = 4096

/**
 * What the window asks for: an attachment and the name it draws for it, AND NOTHING ELSE. No path and no
 * directory crosses in either direction.
 *
 * camelCase, not the wire's snake_case, because this is a client-internal IPC contract rather than a
 * wire type. Nothing downstream rebuilds a value from this object's other keys, so an ask carrying extra
 * ones is accepted and its extras are simply never read.
 */
export interface AttachmentSaveRequest {
  /** The attachment to save. Untrusted in the same way a wire field is: it may carry `..`, a separator
   *  or an absolute path. `resolveAttachmentPath` is the sole gate that refuses a non-canonical one,
   *  before any filesystem call. */
  attachmentId: string
  /** The name to save it under, as the window draws it. UNTRUSTED and MODEL-CHOSEN — the assistant
   *  generated the file and named it — so it may carry `/`, `..`, a leading dot, a Windows reserved
   *  device name or a control character. It is reduced to one safe path component by
   *  `sanitizeAttachmentFilename` IN THE BACKGROUND PROCESS, on the value the path is actually built
   *  from; this declared type is only the compile-time half. It is DISPLAY-DERIVED, not addressing. */
  filename: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer→main boundary —
 * isAttachmentRetrievalRequest's role for this channel. A failing ask is DROPPED: no filesystem call, no
 * folder opened, no event (AC 1). There is no identifier to address an answer to, and a conforming
 * renderer never sends one.
 *
 * SHAPE ONLY, NOT CANONICITY, and deliberately so. `resolveAttachmentPath` already refuses a
 * non-canonical identifier before any filesystem call, and its header argues the general case: two
 * divergent checks on one directory is exactly the shape that ends with one of them being weaker than
 * the other. A `../..` identifier therefore passes here and is refused there.
 *
 * NOR IS IT A NAME CHECK. There is nothing to check — `sanitizeAttachmentFilename` is total, every input
 * has a safe answer, and refusing a name here would have nothing better to offer than the rewrite
 * already gives. Non-empty is still part of the SHAPE: an empty name is a malformed ask rather than a
 * request for the fallback.
 *
 * The field reads are `in`-guarded property accesses on a narrowed `object`, so a hostile ask built with
 * a `__proto__` key is refused on its own merits: the polluting object has no OWN `attachmentId`, and
 * reading one inherited from Object.prototype is not possible here because the typeof test runs on the
 * value actually found.
 */
export function isAttachmentSaveRequest(value: unknown): value is AttachmentSaveRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('attachmentId' in value) || !('filename' in value)) return false
  const { attachmentId, filename } = value as Record<string, unknown>
  return (
    typeof attachmentId === 'string' &&
    attachmentId.length > 0 &&
    attachmentId.length <= MAX_SAVE_IDENTIFIER_LENGTH &&
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename.length <= MAX_SAVE_FILENAME_LENGTH
  )
}

/**
 * Why one save ended without the file in Downloads, as a closed set of CLIENT-OWNED literals. Every
 * inhabitant is a string written in this repo, so a value of this type provably carries no path, no
 * errno, no file name and no daemon text (AC 5).
 *
 * TWO MEMBERS, AND THE LINE BETWEEN THEM IS WHAT A CONSUMER CAN DO NEXT. That is the same test
 * `storeAttachment` applies when it merges a refused identifier and a failed write behind one reason:
 * split a failure only where the answer to the two halves differs.
 */
export type AttachmentSaveFailure =
  /** No readable source file could be addressed by this identifier — it was refused by
   *  `resolveAttachmentPath`, or nothing is at the resolved path, or it could not be read. THE ONE A
   *  CONSUMER CAN ACT ON: fetch the attachment (#996) and ask again. The three causes are merged
   *  because a consumer's answer to all of them is that same retry. */
  | 'source-unavailable'
  /** Everything else: an over-long name (ENAMETOOLONG), a permission or space failure, an exhausted
   *  candidate count. ENAMETOOLONG gets no member of its own on purpose — it is the same errno shape as
   *  any other failed copy, so it is a test case rather than new behaviour. Nothing partial is left in
   *  Downloads when this is reported. */
  | 'save-failed'

/**
 * The terminal outcomes of one save, discriminated on `type`. EXACTLY ONE is answered per ask that
 * passed the guard, which is structural rather than an invariant to maintain: the driver answers with a
 * promise, and a promise settles once.
 *
 * CONTENT-FREE BY CONSTRUCTION: no member declares a field that can hold the saved path, the Downloads
 * directory, the file name, an errno or the file's bytes. `debugBundleSaved` carries a path and this
 * event must not — attachmentStore.ts's docblock is explicit that the path is a return value for this
 * ticket to consume, not something to forward.
 *
 * `attachmentId` is the correlation key, and it is the window's OWN value coming back — never a
 * wire-supplied one — so a window can tell two concurrent saves apart. It is echoed even on a refused
 * identifier: the window named it and can match on it.
 */
export type AttachmentSaveEvent =
  /** The file is in the user's Downloads folder and has been revealed there. Under WHAT NAME is
   *  deliberately not said: it is derived from the ask's own name, and a collision suffix is the
   *  window's business only to the extent it can see the folder that just opened. */
  | { type: 'saved'; attachmentId: string }
  /** The save ended with nothing in Downloads. */
  | { type: 'failed'; attachmentId: string; reason: AttachmentSaveFailure }
