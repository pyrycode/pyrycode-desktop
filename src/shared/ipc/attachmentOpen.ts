// The attachment-OPEN channel pair between the renderer window and the background process (#867):
// two channel constants, the request shape plus its boundary guard, and one sealed outcome union,
// imported by both process sides. The window names an attachment; the background process resolves
// that identifier inside the app's own attachment directory, decides the file's type from its own
// leading bytes, materialises a suffixed copy in a second app-owned directory, hands THAT path to
// the operating system's default handler, and answers exactly one terminal.
//
// THE WINDOW CANNOT BE HANDED A PATH, which is what this channel exists to work around, and it
// matters more here than on any sibling. `setWindowOpenHandler` drops every `file:` URL and every
// custom-protocol URL precisely so a hostile link cannot open a local file or launch a registered
// handler, and that block stays untouched. A PROTOCOL HANDLER WAS THE REJECTED ALTERNATIVE, on
// attachmentBytes.ts's recorded reasoning: it would cost a privileged-scheme registration and cannot
// express the four-way distinction below, since its only failure surface is a response status.
//
// A SIBLING TO attachmentBytes.ts, NOT A MEMBER ON events.ts, for that module's recorded reason:
// four renderer bridges — timelineBridge, questionBridge, modalBridge, daemonEventBridge — end their
// DaemonEvent switch in assertNever, so a member there is a compile error in four files that have
// nothing to do with attachments, for four no-op arms.
//
// TWO CHANNELS, NOT AN INVOKE, matching all four attachment legs: a separate answer channel keeps
// the two directions unconfusable, and keeps an outcome away from the daemon-event bridges.
//
// NO PATH, DIRECTORY OR URL IS DECLARABLE IN EITHER DIRECTION (AC 1). The ask carries an identifier
// and nothing else; the event carries that identifier back and a client-owned literal. Both
// directories the flow spans are computed at the composition root from Electron's per-user app-data
// location, never from anything the window sent, and the suffix the opened path carries is chosen
// from a closed set by the file's own bytes — never by a `mime_type`, a file name, or any other
// daemon-supplied value.
//
// This module is channel constants + a discriminated union + one pure guard, with no I/O and no
// state. It imports nothing from src/main (layering: shared is loaded by preload and renderer and
// must not pull main-only code) — notably not resolveAttachmentPath or matchImageSignature, which
// the renderer must not be able to reach. Relative imports only: src/main and src/preload have no
// @shared alias.

/** The channel the OPEN ASK travels on, renderer → main. Fire-and-forget (ipcRenderer.send /
 *  ipcMain.on), carrying one AttachmentOpenRequest. Single source of truth: the preload sender ships
 *  on it, the composition root registers on it. */
export const ATTACHMENT_OPEN_CHANNEL = 'pyry:attachment-open' as const

/** The channel the OUTCOME travels on, main → renderer. Pushed (webContents.send / ipcRenderer.on),
 *  deliberately separate from ATTACHMENT_OPEN_CHANNEL so the two directions cannot be confused, and
 *  separate from DAEMON_EVENT_CHANNEL so an outcome never reaches the daemon-event bridges. */
export const ATTACHMENT_OPEN_EVENT_CHANNEL = 'pyry:attachment-open-event' as const

/**
 * Upper bound on the accepted identifier, in UTF-16 code units, enforced at the guard —
 * MAX_BYTES_IDENTIFIER_LENGTH's argument restated for the second attachment ask that never reaches
 * the wire. What is left once the envelope clause is removed is boundary hygiene: the value the
 * renderer supplies is bounded before the background process does anything with it, exactly as
 * MAX_PASTE_LENGTH bounds a paste before main runs a regex over it.
 *
 * It is a SIZE bound, not a shape or canonicity one, so it leaves the single-gate argument intact: a
 * `../..` identifier still passes here and is still refused by `resolveAttachmentPath`, which is also
 * where the real ceiling lives — a 64-character alphabet, two orders of magnitude below this.
 */
export const MAX_OPEN_IDENTIFIER_LENGTH = 256

/**
 * What the window asks for: an attachment, AND NOTHING ELSE. One field, because the file is
 * addressed by the identifier alone — attachmentBytes.ts's shape rather than the save leg's, since
 * there is no display name to supply and nothing else this side needs.
 *
 * In particular there is no declared type, no suffix and no file name. That is not an omission: the
 * type the operating system is told about is decided by the file's own leading bytes in the
 * background process, and a field here would be a second, weaker source for the same decision.
 *
 * camelCase, not the wire's snake_case, because this is a client-internal IPC contract rather than a
 * wire type. Nothing downstream rebuilds a value from this object's other keys, so an ask carrying
 * extra ones is accepted and its extras are simply never read — a smuggled `path`, `directory` or
 * `mime_type` reaches nothing.
 */
export interface AttachmentOpenRequest {
  /** The attachment to open. Untrusted in the same way a wire field is: it may carry `..`, a
   *  separator or an absolute path. `resolveAttachmentPath` is the sole gate that refuses a
   *  non-canonical one, before any filesystem call. */
  attachmentId: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer→main boundary —
 * isAttachmentBytesRequest's role for this channel, and its body verbatim, since the shapes are
 * identical. A failing ask is DROPPED: no filesystem call, no file opened, no event. There is no
 * identifier to address an answer to, and a conforming renderer never sends one.
 *
 * SHAPE ONLY, NOT CANONICITY, and deliberately so. `resolveAttachmentPath` already refuses a
 * non-canonical identifier before any filesystem call, and its header argues the general case: two
 * divergent checks on one directory is exactly the shape that ends with one of them being weaker
 * than the other. A `../..` identifier therefore passes here and is refused there.
 *
 * The field read is an `in`-guarded property access on a narrowed `object`, so a hostile ask built
 * with a `__proto__` key is refused on its own merits: the polluting object has no OWN
 * `attachmentId`, and reading one inherited from Object.prototype is not possible here because the
 * typeof test runs on the value actually found.
 */
export function isAttachmentOpenRequest(value: unknown): value is AttachmentOpenRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('attachmentId' in value)) return false
  const { attachmentId } = value as Record<string, unknown>
  return (
    typeof attachmentId === 'string' &&
    attachmentId.length > 0 &&
    attachmentId.length <= MAX_OPEN_IDENTIFIER_LENGTH
  )
}

/**
 * Why one open ended without the file in a viewer, as a closed set of CLIENT-OWNED literals. Every
 * inhabitant is a string written in this repo, so a value of this type provably carries no path, no
 * derived file name, no matched type, no errno, no `mime_type` and no operating-system message
 * (AC 5).
 *
 * FOUR MEMBERS, AND THE LINE BETWEEN THEM IS WHAT A CONSUMER CAN DO NEXT — `storeAttachment`'s test,
 * applied where this ticket draws the line. #869 needs them apart for the same reason
 * AttachmentBytesFailure separates `refused` from `unavailable`: a refusal is permanent, where an
 * absent file is fetched and asked for again.
 */
export type AttachmentOpenFailure =
  /** The identifier never named a file here: `resolveAttachmentPath` rejected it before any
   *  filesystem call. A consumer must NOT retry — fetching cannot make a non-canonical identifier
   *  resolvable, and no amount of waiting will change the answer. */
  | 'refused'
  /** The identifier resolved and nothing readable is at that path — absent, unreadable, or not a
   *  file. THE ONE A CONSUMER FETCHES FOR: get the attachment (#996) and ask again. The causes are
   *  merged because a consumer's answer to all of them is that same fetch.
   *  AttachmentBytesFailure's member of the same name and the same meaning. */
  | 'unavailable'
  /** The file's leading bytes matched no member of the closed raster set, so nothing was derived and
   *  the operating system was told nothing. PERMANENT, AND DISTINCT FROM `refused`: the identifier
   *  was fine and the file is present, so fetching again changes nothing — a consumer's move is to
   *  offer the save leg (#814) instead of the open leg. Note this is also the answer for a file the
   *  wire declared as an image: a declared type takes no part in the decision. */
  | 'unsupported-type'
  /** The derived copy could not be made, or the operating system declined the hand-off. The only
   *  member a plain retry can resolve, which is why it is not merged into `unavailable`: that one
   *  asks the consumer to fetch first, and fetching here would be wasted work. */
  | 'open-failed'

/**
 * The terminal outcomes of one open, discriminated on `type`. EXACTLY ONE is answered per ask that
 * passed the guard (AC 5), which is structural rather than an invariant to maintain: the driver
 * answers with a promise, and a promise settles once.
 *
 * CONTENT-FREE BY CONSTRUCTION: no member declares a field that can hold a path, the derived file's
 * name, the matched type, an errno, or the string `shell.openPath` resolves with — that string is
 * the operating system's error MESSAGE and it carries the path, so it is narrowed to a boolean at
 * the composition root and never reaches the module that builds these events.
 *
 * `attachmentId` is the correlation key, and it is the window's OWN value coming back — never a
 * wire-supplied one and never a value this process derived — so two concurrent asks are tellable
 * apart. It is echoed even on a refused identifier: the window named it and can match on it. AC 5's
 * ban is on identifier-DERIVED strings, which is the suffixed file name, not on this key.
 */
export type AttachmentOpenEvent =
  /** The operating system accepted the hand-off for its default handler for the matched type. That
   *  the handler then rendered anything is outside this app's knowledge. */
  | { type: 'opened'; attachmentId: string }
  /** The open ended with nothing in a viewer. */
  | { type: 'failed'; attachmentId: string; reason: AttachmentOpenFailure }
