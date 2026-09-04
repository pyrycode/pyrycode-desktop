// The attachment-upload channel pair between the renderer window and the background process (#862,
// widened by #890): two channel constants, one optional request shape plus its boundary guard, and one
// sealed outcome union, imported by both process sides. The renderer either names a bare INTENT ("let
// me attach a file", and the background process opens the picker and reads the choice) or names a
// DROPPED PATH. Either way the background process guards, drives #861's upload driver, and pushes back
// exactly one terminal.
//
// This module is channel constants + a discriminated union + one pure guard, with no I/O and no state —
// attachmentBytes.ts's shape. It was constants and a union alone until #890 added the door below.
//
// TWO CHANNELS, NOT AN INVOKE. The outcome comes back with ipcRenderer.on rather than as an
// invoke reply because the channel must carry MORE THAN ONE MESSAGE per intent: #864 puts in-flight
// progress on it BEFORE the terminal. A request/response reply cannot express that, and the
// alternative — a new DaemonEvent union member — is a compile-forced edit in four renderer bridges
// that each end their switch in assertNever, which is over this slice's file boundary.
//
// THE REQUEST BODY IS OPTIONAL, AND THAT SHAPE IS THE DESIGN'S CENTRAL SECURITY PROPERTY. #862 shipped
// this channel value-free: the renderer sent with no argument, so there was no untrusted request field
// at the boundary at all and no renderer-supplied string could reach a host path, a declared filename or
// the wire — a fully compromised renderer could make a picker appear, but not choose what it opened.
// That door was left value-free deliberately, so that the obligation would be VISIBLE the day something
// wanted to widen it. #890 is that day, and it pays the debt in the shape the header named: an
// argument-free send still means "open the picker" and reaches no request field; a send carrying a
// request means "upload this path" and is refused outright by isAttachmentUploadRequest below unless it
// is well-formed. There is still exactly ONE place a path enters main from the window.
//
// WHAT REPLACES "NOTHING CROSSES" IS NOT A WEAKER CLAIM, IT IS A DIFFERENT ONE. The path is resolved in
// the preload by `webUtils.getPathForFile`, which answers the EMPTY STRING for a File the page
// constructed itself — only a file an operator gesture delivered is backed by a path. So a compromised
// renderer still cannot name an arbitrary file on disk and have it streamed to the host; it can only
// forward a path-backed File it holds. That property survives only while the preload is the sole
// resolver AND main refuses an empty or non-string path outright, which is what the guard is for.
//
// `RendererCommand` stays the wrong home for this, for the reason the original filing gave: a path is
// not a renderer-owned value. Keeping it here keeps it out of there.
//
// Imports nothing from src/main (layering: shared is loaded by preload and renderer and must not pull
// main-only code). Relative imports only — src/main and src/preload have no @shared alias.

/** The channel the attach INTENT travels on, renderer → main. Fire-and-forget (ipcRenderer.send /
 *  ipcMain.on), carrying no argument. Single source of truth: the preload sender ships on it, the
 *  composition root registers on it. */
export const ATTACHMENT_UPLOAD_CHANNEL = 'pyry:attachment-upload' as const

/** The channel the OUTCOME travels on, main → renderer. Pushed (webContents.send / ipcRenderer.on),
 *  deliberately separate from ATTACHMENT_UPLOAD_CHANNEL so the two directions cannot be confused, and
 *  separate from DAEMON_EVENT_CHANNEL so an upload outcome never reaches the daemon-event bridges. */
export const ATTACHMENT_UPLOAD_EVENT_CHANNEL = 'pyry:attachment-upload-event' as const

/**
 * Upper bound on the accepted path, in UTF-16 code units, enforced at the guard (#890) —
 * MAX_SAVE_FILENAME_LENGTH's figure and MAX_BYTES_IDENTIFIER_LENGTH's argument, applied to the one
 * attachment ask whose untrusted value is a host path. It is boundary hygiene: the value the window
 * supplies is bounded before the background process does anything with it, exactly as MAX_PASTE_LENGTH
 * bounds a paste before main runs a regex over it.
 *
 * 4096 is the platform ceiling for a path a real drop can produce (PATH_MAX is 1024 on macOS and 4096
 * on Linux; a Windows path is far shorter in practice), so it refuses nothing an operator can do.
 *
 * A SIZE bound, not a shape or canonicity one, which is what leaves the single-gate argument intact:
 * `readChosenFile` (src/main/attachmentUpload.ts) stays the sole thing that decides whether a path names
 * a readable regular file, and it decides it by OPENING the path rather than by inspecting the string.
 * Confining the path to a root would be the wrong check to add here and not merely a redundant one —
 * dropping a file from anywhere on the operator's own disk is the whole feature.
 */
export const MAX_UPLOAD_PATH_LENGTH = 4096

/**
 * What a DROPPED file asks for (#890): a path, AND NOTHING ELSE. One field, because everything else the
 * flow needs is derived in the background process from the file itself — `readChosenFile` takes the
 * display name from `basename` and the type from the name, so a window that supplied either could
 * mislabel a file it did not choose.
 *
 * camelCase, not the wire's snake_case, because this is a client-internal IPC contract rather than a
 * wire type. Nothing downstream rebuilds a value from this object's other keys, so an ask carrying extra
 * ones is accepted and its extras are simply never read.
 *
 * OPTIONAL ON THE CHANNEL: a send with no argument at all is the picker intent #862 shipped and is not
 * an ill-formed request. The two are told apart by presence, not by a discriminator field, because the
 * shipped sender cannot be given one without changing what a conforming renderer puts on the wire.
 */
export interface AttachmentUploadRequest {
  /** The host path of the dropped file, resolved in the preload by `webUtils.getPathForFile`.
   *  Untrusted in the same way a wire field is: it may be empty, absurd, or name a file the operator
   *  never dropped. It is a CLAIM, not a capability — main opens it and refuses anything that is not a
   *  regular file, and drops the errno unexamined because it carries this same path. */
  path: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer→main boundary (#890) —
 * isAttachmentBytesRequest's role for this channel, in its shape. A failing ask is DROPPED: no
 * filesystem call, no event. There is no identifier to address an answer to, and nothing an operator can
 * physically do produces one — a real drop always carries a real path, so an empty or malformed request
 * means a page-constructed `File` or a compromised renderer, and neither is owed a sentence in the
 * composer.
 *
 * THE EMPTY-STRING REFUSAL IS THE LOAD-BEARING LINE, not the length bound above it.
 * `webUtils.getPathForFile` answers '' for a `File` the page built itself, so this is where "only a file
 * an operator gesture delivered is backed by a path" stops being a property the preload observes and
 * becomes a refusal main performs.
 *
 * SHAPE ONLY, NOT CANONICITY, deliberately, and for attachmentBytes.ts's recorded reason: two divergent
 * checks on one value is the shape that ends with one of them being weaker than the other. There is no
 * root to be canonical against here in any case — see MAX_UPLOAD_PATH_LENGTH.
 *
 * The field read is an `in`-guarded property access on a narrowed `object`, so a hostile ask built with
 * a `__proto__` key is refused on its own merits: the polluting object has no OWN `path`, and reading
 * one inherited from Object.prototype is not possible here because the typeof test runs on the value
 * actually found.
 */
export function isAttachmentUploadRequest(value: unknown): value is AttachmentUploadRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('path' in value)) return false
  const { path } = value as Record<string, unknown>
  return typeof path === 'string' && path.length > 0 && path.length <= MAX_UPLOAD_PATH_LENGTH
}

/**
 * Why one upload ended without the file being stored, as a closed set of CLIENT-OWNED literals.
 * Every inhabitant is a string written in this repo, so a value of this type provably carries no
 * daemon text, no filesystem error, and nothing derived from the file.
 *
 * It is a RE-DECLARATION of `AttachmentTransferFailure` (src/main/transport/attachmentTransfer.ts)
 * widened by one, because shared must not import from src/main. The correspondence is kept by the
 * COMPILER, not by discipline: the main-side module assigns an `AttachmentTransferFailure` straight
 * into `reason`, so an outcome added upstream fails to typecheck there rather than silently becoming
 * unrepresentable here. That check has fired for real — #999's two retrieval codes reached this union
 * through it, not through anyone remembering to look.
 *
 * The inherited members are documented at their source — the daemon-mapped verdicts on
 * `DaemonErrorOutcome` (src/main/transport/inboundMessage.ts) and the transport-local ones on
 * `AttachmentTransferFailure`. Only the member declared for this channel is documented here. No count is
 * given: the numbers here went stale the moment the union upstream grew, and the lists below are
 * self-describing.
 */
export type AttachmentUploadFailure =
  /** The chosen file could not be read: it does not exist, permission was denied, or it is not a
   *  regular file at all. DISTINCT from a `refused`, which is this client declining a readable file
   *  on its size — a refusal states a limit the user can act on, this states that the choice itself
   *  did not survive. The underlying errno is DROPPED, never carried: it holds the host path. */
  | 'unreadable'
  // — from AttachmentTransferFailure —
  | 'not-connected'
  | 'connection-lost'
  | 'send-failed'
  // — from DaemonErrorOutcome, the upload leg's —
  | 'attachment-invalid-chunk'
  | 'attachment-integrity-failed'
  | 'attachment-too-large'
  | 'attachment-too-many-uploads'
  | 'attachment-storage-failed'
  | 'message-too-long'
  // — from DaemonErrorOutcome, the RETRIEVAL leg's (#999): REPRESENTABLE HERE, BUT NOT REACHABLE FROM A
  //   CONFORMING DAEMON. Both answer a `request_attachment`, never an `attachment_chunk`, so no upload
  //   ends this way and no composer copy should be written for them. They are present because this union
  //   mirrors AttachmentTransferFailure mechanically and DaemonErrorOutcome is now the vocabulary of BOTH
  //   legs. Not reachable is not the same as impossible: a HOSTILE daemon can put either code in an
  //   `error` frame correlated to a pending chunk, and the value then does cross this bridge. What
  //   crosses is still a client-owned literal — no daemon text, no path — so the blast radius is an odd
  //   reason string. Keeping them representable is deliberate: excluding them would make a value a
  //   hostile daemon can still cause UNREPRESENTABLE, forcing the main side to coerce it into some other
  //   outcome and report a failure that did not happen.
  | 'attachment-not-found'
  | 'attachment-stream-aborted'
  | 'unclassified'

/**
 * What one attach intent reports, discriminated on `type`. Exactly one TERMINAL — `refused`, `failed`
 * or `completed` — is pushed per intent that got as far as a chosen file, optionally preceded by any
 * number of `progress` (#864). A CANCELLED picker emits NOTHING at all, which is what makes
 * cancellation a true no-op rather than an outcome the renderer must learn to ignore.
 *
 * CONTENT-FREE BY CONSTRUCTION: no member declares a field that can hold the file's bytes, its host
 * path, or its name. `uploadId` is a randomUUID minted per intent and derived from nothing about the
 * file; `reason` is a client-owned literal; `limitBytes` is a client-owned constant; the progress
 * counts are counts of FRAMES. That is what makes "neither the bytes nor the path crosses the bridge"
 * a property of this type rather than a promise about the sender — the same argument PairingStatus
 * makes about the paired-server record.
 *
 * ⭐ ONE QUALIFICATION #862'S CONTAINMENT ARGUMENT DID NOT CARRY, added when #864 landed.
 * #862's property is that a compromised renderer "can make a picker appear; it cannot choose what that
 * picker opens, and it cannot read back what was sent". `totalChunks` is the first field here derived
 * from the CHOSEN FILE rather than from a client-owned constant: it states the file's size to within
 * ATTACHMENT_CHUNK_DATA_BYTES. Shipping a bare percentage instead would withhold nothing — at one
 * event per chunk a renderer counts the events and derives the same number, so the disclosure is the
 * emission CADENCE, not the field, and stating it outright is the honest form of it. It is accepted on
 * its size: a window that already holds the whole conversation timeline learning the approximate size
 * of a file its own user just picked is far inside the blast radius #862 already accepts. A member
 * that ever wanted to carry more than a count owes this paragraph a re-read.
 *
 * ADDITIVE ROOM IS DELIBERATE. #890/#891 report their own terminals through the same channel;
 * `uploadId` is what lets a renderer tell two concurrent uploads apart. Nothing in this window can
 * correlate on it today — `requestAttachmentUpload()` returns void, so a window never learns the id
 * its own click minted (see useAttachmentUpload).
 */
export type AttachmentUploadEvent =
  /** This client declined to attempt the file. `limitBytes` is carried so the composer can state the
   *  limit WITHOUT inventing one — and it is the client's own bound, not the daemon's: a file under
   *  it may still come back `attachment-too-large`, which is a `failed`, not a `refused`. */
  | { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
  /** The attempt was made and did not store the file. */
  | { type: 'failed'; uploadId: string; reason: AttachmentUploadFailure }
  /** The daemon stored the file. */
  | { type: 'completed'; uploadId: string }
  /**
   * The transfer is in flight: `sentChunks` of `totalChunks` chunk envelopes have reached the wire
   * (#864). NOT a terminal — zero or more of these precede exactly one of the three above, and none
   * follows one.
   *
   * BOTH FIELDS ARE FRAME COUNTS, which is the whole of the content-free argument for this member:
   * a count cannot hold a byte, a path segment or a name, and the relay observes the same frame count
   * on the wire in front of it. `sentChunks === totalChunks` means every chunk is out and the host's
   * answer is still outstanding — the terminal is what says the file was stored.
   *
   * WHETHER THIS MEMBER IS EMITTED AT ALL is decided in the background process against one named
   * chunk threshold (ATTACHMENT_PROGRESS_MIN_CHUNKS, src/main/attachmentUpload.ts), never against a
   * clock: a small upload costs no IPC at all.
   */
  | { type: 'progress'; uploadId: string; sentChunks: number; totalChunks: number }
