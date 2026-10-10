// The attachment-RETRIEVAL channel pair between the renderer window and the background process (#996):
// two channel constants, the request shape plus its boundary guard, and one sealed outcome union,
// imported by both process sides. The window names a conversation and an attachment; the background
// process asks the host for it, reassembles the answering stream, puts the file on this machine, and
// pushes back exactly one terminal.
//
// A SIBLING TO attachmentUpload.ts, NOT A MEMBER ON events.ts, and that is what decides this feature's
// file count. Four renderer bridges — timelineBridge, questionBridge, modalBridge, daemonEventBridge —
// end their DaemonEvent switch in assertNever, so a member there is a compile error in four files that
// have nothing to do with attachments, for four no-op arms. This module restates the upload leg's own
// ruling: its event channel is separate from DAEMON_EVENT_CHANNEL so an outcome never reaches the
// daemon-event bridges, and the same holds here.
//
// TWO CHANNELS, NOT AN INVOKE, for the upload leg's reason: an invoke reply carries exactly one message
// per call, and the terminal here arrives long after the ask — after a request frame, a stream of
// chunks, a digest check and a disk write.
//
// THE INTENT CARRIES A REQUEST BODY, which is where it parts from `requestAttachmentUpload`. That one
// is bare because the picker runs in the background process, so there is no untrusted request field at
// all; this one carries two identifiers from an untrusted renderer, so it ships the guard below — the
// obligation attachmentUpload.ts's header records as owed by whichever slice first widens the door.
//
// This module is channel constants + a discriminated union + one pure guard, with no I/O and no state.
// It imports nothing from src/main (layering: shared is loaded by preload and renderer and must not
// pull main-only code) — the correspondence with the transport's closed reason set is kept by the
// COMPILER at the main-side forwarding call, not by an import. Relative imports only: src/main and
// src/preload have no @shared alias.

/** The channel the RETRIEVAL ASK travels on, renderer → main. Fire-and-forget (ipcRenderer.send /
 *  ipcMain.on), carrying one AttachmentRetrievalRequest. Single source of truth: the preload sender
 *  ships on it, the composition root registers on it. */
export const ATTACHMENT_RETRIEVAL_CHANNEL = 'pyry:attachment-retrieval' as const

/** The channel the OUTCOME travels on, main → renderer. Pushed (webContents.send / ipcRenderer.on),
 *  deliberately separate from ATTACHMENT_RETRIEVAL_CHANNEL so the two directions cannot be confused,
 *  and separate from DAEMON_EVENT_CHANNEL so a retrieval outcome never reaches the daemon-event
 *  bridges. */
export const ATTACHMENT_RETRIEVAL_EVENT_CHANNEL = 'pyry:attachment-retrieval-event' as const

/**
 * Upper bound on each accepted identifier, in UTF-16 code units, enforced at the guard —
 * MAX_PASTE_LENGTH's role for this channel (`pairing.ts`), applied to the two values an untrusted
 * renderer supplies here.
 *
 * Generous by two orders of magnitude for what either field legitimately holds: the only attachment
 * identifiers this client knows are the lowercase UUIDv4s it minted itself when uploading (36), and a
 * conversation id is an opaque daemon-issued handle of the same order. 256 is comfortably above both
 * while keeping the ask small.
 *
 * It is a SIZE bound, not a shape or canonicity one, so it leaves the argument below intact — a
 * `../..` identifier still passes here and is still refused by `resolveAttachmentPath`, the single
 * gate. What it buys is that the fixed-shape `request_attachment` envelope built from these two
 * values provably stays under the wire's MAX_PLAINTEXT_BYTES (65519), which is what makes
 * `buildRequestAttachment`'s "can never approach the cap" statement true of a renderer-supplied ask
 * rather than only of a conforming one.
 */
export const MAX_RETRIEVAL_IDENTIFIER_LENGTH = 256

/**
 * What the window asks for: a conversation, an attachment and optional client-local host scope.
 * No path, directory or filename crosses in either direction — the attachment directory is computed at the
 * composition root from Electron's per-user app-data location, never from anything the window sent.
 *
 * camelCase, not the wire's snake_case, because this is a client-internal IPC contract rather than a
 * wire type. `daemonConnection` rebuilds the `request_attachment` payload as a FRESH LITERAL from
 * these two fields (createConversation's posture), so no renderer-supplied key can reach the envelope
 * even when the ask carries extra ones.
 */
export interface AttachmentRetrievalRequest {
  /** Optional paired host; never forwarded onto the wire. */
  serverId?: string
  /** The conversation whose attachment is wanted. A LOOKUP KEY the daemon validates against its own
   *  registry, never authorization — authorization on this wire is pairing, enforced structurally at
   *  the Noise handshake. It goes to the daemon and NEVER touches a local path on this side, which is
   *  why there is no conversation-id validator here and none is owed. */
  conversationId: string
  /** The attachment wanted. Untrusted in the same way a wire field is: it may carry `..`, a separator
   *  or an absolute path. It is the one value here that eventually becomes a path COMPONENT, and
   *  `resolveAttachmentPath` (via storeAttachment) is the sole gate that refuses a non-canonical one,
   *  before any filesystem call. */
  attachmentId: string
}

/**
 * The runtime guard the main receiver applies at the untrusted renderer→main boundary — isRendererCommand's
 * role for this channel. A failing ask is DROPPED: no request frame, no filesystem call, no event.
 * There is no identifier to address an answer to, and a conforming renderer never sends one.
 *
 * SHAPE ONLY, NOT CANONICITY, and that is deliberate rather than an omission. `resolveAttachmentPath`
 * already refuses a non-canonical identifier before `storeAttachment` writes, and that module's header
 * argues the general case: two divergent checks on one directory is exactly the shape that ends with
 * one of them being weaker than the other. A `../..` identifier therefore passes here, goes to the
 * daemon, and comes back refused — no local path is ever built from it.
 *
 * NON-EMPTY IS PART OF THE SHAPE. buildRequestAttachment's docblock names the zero-valued request as
 * the contract's specific silent failure: joining the empty string onto a directory yields that
 * directory, so a receiver that skips its own shape check addresses the conversation directory root
 * rather than erroring. Refusing it here costs one comparison and never mints a value.
 *
 * SO IS BEING BOUNDED (#1003 review). An unbounded identifier is not merely absurd input: at ~66 KB it
 * pushes the `request_attachment` envelope over MAX_PLAINTEXT_BYTES, so the builder throws and the ask
 * fails on this side having never reached the wire. The transport settles that honestly on its own
 * (`send-failed`), but bounding the value HERE is what keeps the whole class out of the background
 * process, which is this boundary's job — the same reason MAX_PASTE_LENGTH bounds a paste before main
 * runs a regex over it.
 *
 * The two field reads are `in`-guarded property accesses on a narrowed `object`, so a hostile ask
 * built with a `__proto__` key is refused on its own merits: the polluting object has no OWN
 * `attachmentId`, and reading one inherited from Object.prototype is not possible here because the
 * typeof test runs on the value actually found.
 */
export function isAttachmentRetrievalRequest(value: unknown): value is AttachmentRetrievalRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('conversationId' in value) || !('attachmentId' in value)) return false
  const { conversationId, attachmentId } = value
  const serverId = 'serverId' in value ? value.serverId : undefined
  return (
    (serverId === undefined || (typeof serverId === 'string' && serverId.length > 0 &&
      serverId.length <= MAX_RETRIEVAL_IDENTIFIER_LENGTH)) &&
    typeof conversationId === 'string' &&
    conversationId.length > 0 &&
    conversationId.length <= MAX_RETRIEVAL_IDENTIFIER_LENGTH &&
    typeof attachmentId === 'string' &&
    attachmentId.length > 0 &&
    attachmentId.length <= MAX_RETRIEVAL_IDENTIFIER_LENGTH
  )
}

/**
 * Why one retrieval ended without the file being on this machine, as a closed set of CLIENT-OWNED
 * literals. Every inhabitant is a string written in this repo, so a value of this type provably
 * carries no daemon text, no filename, no media type, no digest, no host path and no local path.
 *
 * DECLARED ONCE AND IMPORTED BY MAIN, which is where this parts from AttachmentUploadFailure's
 * mechanical re-declaration. That union re-declares because `AttachmentTransferFailure` lives in
 * src/main and shared must not import main; here the type flows the other way — the transport hands
 * the CALLER's consumer this type — so src/main importing it from shared is the ordinary direction and
 * one declaration means there is no mirror to keep in step.
 *
 * The correspondence with the transport's own closed set is kept by the COMPILER rather than by
 * discipline: `daemonConnection.requestAttachment` forwards an `AttachmentFailReason` straight into a
 * call typed by this union, so a sixth reason added upstream reddens that line instead of silently
 * becoming unrepresentable. That is AttachmentUploadFailure's `reason: result.outcome` mechanism,
 * restated for the leg that runs the other way.
 *
 * THE DAEMON'S CODE VOCABULARY IS DELIBERATELY NOT INHERITED. `DaemonErrorOutcome`'s members collapse
 * to `not-found` (its `attachment-not-found`, the one code the retrieval verb publishes) and a
 * `daemon-error` catch-all. Riding all of them through — the upload leg's shape — would put seven
 * codes on this union that cannot conformingly answer a `request_attachment`; that leg already spends
 * a paragraph explaining why TWO of its inherited members are unreachable, and repeating the exercise
 * sevenfold buys nothing a consumer can act on. The catch-all is total by construction, so a tenth
 * outcome added upstream lands on `daemon-error` with no edit and no unrepresentable value.
 */
export type AttachmentRetrievalFailure =
  /** More retrievals are already in flight than this client will run at once. A CLIENT-OWNED refusal,
   *  not a host answer: it states a limit the caller can act on by waiting, and it is what keeps the
   *  per-transfer memory bound meaningful — that bound only bounds anything multiplied by a bounded
   *  count, and the window is untrusted. */
  | 'busy'
  /** The ask arrived with no live session, so nothing was sent. Resolved immediately rather than left
   *  hanging (`requestDebugBundle`'s posture for a call that owns a waiting caller). */
  | 'not-connected'
  /** There WAS a live session and this client still could not put the ask on the wire: an over-cap
   *  envelope (WireEncodeError) or a driver throw. `AttachmentTransferFailure`'s member of the same
   *  name and the same meaning, mirrored onto the leg that runs the other way, and the two causes
   *  collapse to one outcome for its reason — the caught object is DROPPED, never inspected, because
   *  its message could echo an identifier. Distinct from `not-connected` (no session at all) and from
   *  `connection-lost` (a session that went away with the ask already sent): here the daemon never saw
   *  the request, so nothing on the host is in flight and an immediate retry is sound. */
  | 'send-failed'
  /** The host refused the ask: `attachment.not_found`. ONE code for every request that yields no
   *  bytes — an unknown attachment, an unknown or unnamed conversation, an identifier whose shape is
   *  invalid, one resolving outside the named conversation's directory, and a file that resolves but
   *  cannot be read. The host makes these DELIBERATELY INDISTINGUISHABLE, because two answers would
   *  turn the asking verb into a path-existence oracle. Do not present a reason implying more. */
  | 'not-found'
  /** The host answered this request with some other error code. A catch-all for a code that does not
   *  conformingly answer this verb — reported honestly rather than coerced into a failure that did not
   *  happen. */
  | 'daemon-error'
  /** The stream stopped with no terminal frame at all, and this client's own idle deadline fired. The
   *  protocol offers nothing for a session that simply dies mid-stream and says so; this is the only
   *  thing that detects it. */
  | 'timed-out'
  /** Everything arrived and verified, and the file could not be put on this machine — a refused
   *  identifier or a failed write, merged behind one reason because a consumer's answer to both is
   *  identical (storeAttachment's own argument). Never carries the errno or the path. */
  | 'store-failed'
  // — from AttachmentFailReason (src/main/transport/attachmentReassembler.ts), documented at its
  //   source. `stream-aborted` is the host abandoning the retrieval mid-stream, and everything
  //   accumulated is discarded rather than presented as the file; retry is allowed only after a
  //   backoff, and no automatic one is built here. —
  | 'stream-contradiction'
  | 'too-large'
  | 'verification-failed'
  | 'stream-aborted'
  | 'connection-lost'

/**
 * The terminal outcomes of one retrieval, discriminated on `type`. EXACTLY ONE is pushed per ask that
 * started a retrieval; a duplicate ask for an attachment already in flight starts nothing and is
 * answered by the live retrieval's own terminal, which names the same identifier.
 *
 * CONTENT-FREE BY CONSTRUCTION: no member declares a field that can hold the file's bytes, its name,
 * its media type, its digest, the host's path or THE LOCAL PATH THE STORE RETURNED. That last one is
 * the field `debugBundleSaved` carries and this event must not — `attachmentStore`'s docblock is
 * explicit that the path is a return value for #814/#866/#867 to consume, not something to forward.
 *
 * Conversation, attachment and optional requested server scope are the caller's own values echoed
 * for terminal matching. They carry no daemon response text. Production always emits conversationId;
 * its optional type retains legacy unscoped event compatibility for unscoped consumers.
 */
export type AttachmentRetrievalEvent =
  /** The file is on this machine. Where it lives is deliberately not said. */
  | { type: 'completed'; attachmentId: string; conversationId?: string; serverId?: string }
  /** The retrieval ended without the file. */
  | { type: 'failed'; attachmentId: string; conversationId?: string; serverId?: string; reason: AttachmentRetrievalFailure }

/** Match captured caller scope; legacy fixtures without conversation scope serve only legacy asks. */
export function matchesAttachmentRetrieval(event: AttachmentRetrievalEvent, ask: AttachmentRetrievalRequest): boolean {
  return event.attachmentId === ask.attachmentId && event.serverId === ask.serverId &&
    (event.conversationId === ask.conversationId || (ask.serverId === undefined && event.conversationId === undefined))
}
