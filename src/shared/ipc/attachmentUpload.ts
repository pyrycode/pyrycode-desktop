// The attachment-upload channel pair between the renderer window and the background process (#862):
// two channel constants plus one sealed outcome union, imported by both process sides. The renderer
// names an INTENT ("let me attach a file"); the background process opens the picker, guards and reads
// the choice, drives #861's upload driver, and pushes back exactly one terminal.
//
// This module is channel constants + a discriminated union with NO runtime logic — the same shape as
// pairingStatus.ts and events.ts.
//
// TWO CHANNELS, NOT AN INVOKE. The outcome comes back with ipcRenderer.on rather than as an
// invoke reply because the channel must carry MORE THAN ONE MESSAGE per intent: #864 puts in-flight
// progress on it BEFORE the terminal. A request/response reply cannot express that, and the
// alternative — a new DaemonEvent union member — is a compile-forced edit in four renderer bridges
// that each end their switch in assertNever, which is over this slice's file boundary.
//
// THE INTENT CARRIES NO REQUEST BODY, and that is the design's central security property rather than
// a convenience. The renderer sends with no argument, so there is no untrusted request field to
// validate at the boundary and NO renderer-supplied string can reach a host path, a declared
// filename, or the wire. A fully compromised renderer can make a picker appear; it cannot choose what
// that picker opens. This is why the module ships no isAttachmentUploadRequest guard (pairingStatus's
// argument, restated). #890 will widen the intent to carry a dropped path — THAT widening owes a
// request guard, and the door is left value-free today so the obligation is visible when it arrives.
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
 * The terminal outcomes of one attach intent, discriminated on `type`. Exactly one is pushed per
 * intent that got as far as a chosen file — a CANCELLED picker emits NOTHING at all, which is what
 * makes cancellation a true no-op rather than a fourth outcome the renderer must learn to ignore.
 *
 * CONTENT-FREE BY CONSTRUCTION: no member declares a field that can hold the file's bytes, its host
 * path, or its name. `uploadId` is a randomUUID minted per intent and derived from nothing about the
 * file; `reason` is a client-owned literal; `limitBytes` is a client-owned constant. That is what
 * makes "neither the bytes nor the path crosses the bridge" a property of this type rather than a
 * promise about the sender — the same argument PairingStatus makes about the paired-server record.
 *
 * ADDITIVE ROOM IS DELIBERATE. #864 adds an in-flight progress member alongside these three, and
 * #890/#891 report their own terminals through the same channel; `uploadId` is what lets a renderer
 * tell two concurrent uploads apart, and what a later progress member correlates on.
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
