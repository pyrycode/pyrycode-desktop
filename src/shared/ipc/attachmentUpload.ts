// The attachment-upload channel pair between the renderer window and the background process (#862,
// widened by #890 and again by #1032): two channel constants, two optional request shapes each with its
// boundary guard, and one sealed outcome union, imported by both process sides. The renderer names one
// of THREE asks — a bare INTENT ("let me attach a file", and the background process opens the picker and
// reads the choice), a DROPPED PATH, or a PASTE ("attach the image on the clipboard", carrying nothing
// about the image). Whichever it is, the background process guards, drives #861's upload driver, and
// pushes back exactly one terminal.
//
// This module is channel constants + a discriminated union + pure guards, with no I/O and no state —
// attachmentBytes.ts's shape. It was constants and a union alone until #890 added the first door below.
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
// PRESENCE ALONE NO LONGER TELLS THE ASKS APART (#1032). A pasted image has no path anywhere — it is a
// bitmap the OS holds — so its ask cannot be a path, and it cannot be argument-free either, because that
// shape is the picker's and the shipped sender cannot be given a discriminator without changing what a
// conforming renderer puts on the wire. So the THIRD ask names itself: one client-owned literal, matched
// against a constant by isAttachmentPasteRequest below, carrying nothing else about the image. It is
// the NARROWEST of the three — the picker's ask has no field, this one has a field a renderer cannot
// vary, and only the drop's carries a value main must ACT on. The reverse cut #862 wanted is available
// for a paste and is taken: the window asks, and the background process reads the clipboard itself.
//
// BOTH GUARDED ASKS NOW NAME A SERVER (#1129), and it is the LAST entry point to do so. The optional
// `serverId` is what makes a dropped or pasted file land on the host whose chat is open rather than on
// whichever was paired most recently, and it retired `registry.active` (src/main/index.ts) outright.
// It is the one field on either ask that main neither acts on nor forwards: it is resolved against the
// connection registry's held entry set and discarded. `hasValidServerId` below is the whole of its
// rule and states where it does and does not reach; AttachmentPasteRequest amends its own "and nothing
// else" paragraph, since that ask's emptiness was its central security property.
//
// EVERY ASK NOW NAMES A CONVERSATION, AND THE PICKER'S ASK EXISTS (#1205). pyrycode #2143 made the
// daemon file an upload under the conversation the chunk names and refuse a chunk naming none, so the
// destination has to travel from the window, which is the only side that knows which chat is open.
// `conversationId` is REQUIRED on all three asks and checked by one rule, `hasValidConversationId`: a
// non-empty string within a bound. Unlike `serverId` it is a value main ACTS on — it rides every chunk
// as the daemon's lookup key — but like every other id this window sends it is a CLAIM, never a
// capability: the daemon validates it against its own registry before it becomes a path component, and
// naming a conversation the operator has not opened buys a refusal, not a file. The argument-free
// picker intent is RETIRED by this: an ask has to carry the id, so the picker names itself with a
// second client-owned literal the way the paste does, and a bare send now matches no guard and is
// dropped. See `AttachmentPickRequest`.
//
// THE TWO GUARDS ARE TRIED PATH-FIRST in the main listener, and that ordering is load-bearing rather
// than stylistic: an ask carrying a valid `path` reaches the drop arm exactly as it does today, extra
// keys included, so nothing an operator can produce changes arm. See src/main/index.ts.
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
  /** Which paired server this file is for (#1129). See `hasValidServerId` in this module — one field,
   *  one rule, three asks. */
  serverId?: string
  /** The conversation the file is for (#1205). See `hasValidConversationId` — one field, one rule,
   *  three asks, and REQUIRED on each. */
  conversationId: string
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
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_UPLOAD_PATH_LENGTH) {
    return false
  }
  return hasValidServerId(value) && hasValidConversationId(value)
}

/**
 * Upper bound on `conversationId`, in UTF-16 code units — MAX_RETRIEVAL_IDENTIFIER_LENGTH's figure
 * (src/shared/ipc/attachmentRetrieval.ts), restated rather than imported for the no-sibling-import rule
 * `hasValidServerId` records. A daemon-minted id is a 36-character UUID; this bound is boundary hygiene
 * against a hostile window, and the daemon's own 64-byte budget is the one that decides.
 */
export const MAX_UPLOAD_CONVERSATION_ID_LENGTH = 256

/**
 * The REQUIRED destination on every ask (#1205), and the one rule all three guards check it against.
 * Required rather than optional because there is no unnamed path for it: `serverId` falls back to the
 * sole connection, but the daemon has no fallback for a chunk's conversation since pyrycode #2143 — an
 * absent id is refused on the first chunk, so accepting one here would only move the refusal from a
 * dropped ask to the operator's composer. A non-empty string within the bound; shape and canonicity are
 * the daemon's, which validates the id against its registry and answers a foreign or unknown one with
 * the same `attachment.invalid_chunk` a malformed one gets. `in`-guarded like its sibling, so a
 * `__proto__`-carrying ask with no OWN key is refused on its own merits.
 */
function hasValidConversationId(value: object): boolean {
  if (!('conversationId' in value)) return false
  const { conversationId } = value as Record<string, unknown>
  return (
    typeof conversationId === 'string' &&
    conversationId.length > 0 &&
    conversationId.length <= MAX_UPLOAD_CONVERSATION_ID_LENGTH
  )
}

/**
 * The optional routing key both asks above carry (#1129), and the one rule both guards
 * check it against, so the two entries cannot drift into subtly different acceptance.
 *
 * WHAT IT IS: the id of a server the operator has ALREADY PAIRED, naming which host this file
 * belongs on. #1117 made the number of live connections follow the number of stored paired records,
 * and #1118/#1119/#1120 then moved every command carrying an id of its own onto the server it is
 * actually about. This channel is the last entry point, and it is the one that retires
 * `registry.active`.
 *
 * WHAT IT IS NOT, and this is what makes it acceptable on the paste ask (see
 * AttachmentPasteRequest): it is a ROUTING KEY, never a capability, a token, a path selector or a
 * log field. `serverRouter.ts` resolves it against the connection registry's held entry set and
 * hands back a connection or refuses — the window can NAME a server, it cannot conjure one — and
 * then discards it. It reaches no filename (`driveUpload` names the file from `basename` or from
 * `clipboardImageFilename`), no byte, no filesystem path, no wire field and no diagnostic
 * (`DiagnosticEvent` is `{ event, code? }` and has no identifier-shaped member, so a server id is
 * structurally unrepresentable in a log line from there).
 *
 * OPTIONAL, and it will stay unfilled for a while. No renderer sender has a per-server surface to
 * source an id from until #1086 lands, so both shipped senders emit the bare ask and every upload
 * takes the resolver's unnamed path — the sole connection when the registry holds exactly one
 * entry, a refusal when it holds more. That is the bridge `serverRouter.ts`'s header describes:
 * bounded and observable, today's single-server behaviour preserved, no fallback to "the first" or
 * "the most recent" connection anywhere.
 *
 * ABSENT-OR-`undefined`-OR-STRING, and every word is load-bearing. `hasValidServerId` in
 * `commands.ts` states the same rule for the six server-scoped commands, and this is a deliberate
 * second copy rather than an import: no PRODUCTION module under src/shared/ipc imports from a
 * sibling — each channel states its own boundary rules in full, which is why both guards above
 * already re-implement the object/null/`in` checks every sibling guard also has. The two are kept
 * honest by `attachmentUpload.test.ts`'s routing-key describe, which is written against the rule
 * rather than against either helper. This is NOT the divergent-checks shape attachmentBytes.ts
 * argues against: that is two gates on ONE value, where one can end up weaker; this is one gate
 * each on two different values on two different channels.
 *
 * - `'serverId' in value` alone is wrong in BOTH directions. Structured clone PRESERVES an own property
 *   whose value is `undefined` across the IPC bridge, so a present-key CHECK would read
 *   `{ serverId: undefined }` as a supplied value, and a present-key REJECTION would refuse the
 *   ordinary bare ask both current senders emit.
 * - TYPE, NOT EMPTINESS, and not canonical shape. `''` is accepted here and refused one layer later:
 *   it is a present string, so the resolver takes its NAMED branch, and no held entry's id is empty.
 *   A shape check here would buy nothing the resolution does not already buy, at a boundary that is not
 *   the one holding the entry set.
 * - NO LENGTH BOUND, unlike `path` above, and the asymmetry is deliberate. The id is looked up and
 *   discarded: it reaches no map key (this channel holds no per-server state; the debug bundle's memo,
 *   the one place a server id IS a key, is keyed by the RESOLVED id for exactly this reason), no log
 *   line, no path and no wire, so an oversized value costs one transient allocation the structured
 *   clone has already paid for — and both guards accept unbounded UNREAD extra keys today regardless.
 *   A bound here that `commands.ts` lacks would be the divergent-rule shape rather than depth.
 * - `in` RATHER THAN AN OWN-PROPERTY TEST, matching its sibling. An ask whose prototype carries a
 *   non-string `serverId` is REFUSED by this rule and would be ACCEPTED (as unnamed) by a
 *   `hasOwnProperty` one, so `in` is the stricter of the two here. An inherited *string* is accepted and
 *   costs nothing: a renderer that can set a prototype can set an own key, and the value is looked up
 *   against the registry either way.
 */
function hasValidServerId(value: object): boolean {
  if (!('serverId' in value)) return true
  return value.serverId === undefined || typeof value.serverId === 'string'
}

/**
 * The one value a PASTE ask carries (#1032), and it is a name for the entry rather than information
 * about the image: the bytes are read in the background process, from the clipboard, after this ask
 * arrives. A renderer cannot vary it — the guard below compares against this constant — so the accepted
 * set on this shape is exactly one string.
 *
 * Deliberately not path-shaped and not empty: it must not be confusable with an
 * AttachmentUploadRequest at a glance in a review, and an ask of `{}` would be indistinguishable from a
 * malformed one, which would make the guard BLUNTER rather than sharper by turning "object-shaped but
 * not a path" into an upload trigger.
 */
export const ATTACHMENT_PASTE_SOURCE = 'clipboard-image' as const

/**
 * What a PASTED image asks for (#1032): the entry's own name, AND NOTHING ELSE — no path, no bytes, no
 * type, no dimensions. That emptiness is this entry's central security property, and it is stronger
 * than either sibling's: the drop had to admit a host path because the OS hands a drop to the WINDOW,
 * whereas a clipboard is readable from the background process, so nothing renderer-supplied reaches a
 * filename, a byte or the wire on this path at all.
 *
 * camelCase and client-internal, like its sibling. Extra keys are accepted and never read — and here
 * that costs even less, because `uploadClipboardImage` (src/main/attachmentUpload.ts) takes no field off
 * this object whatsoever; the ask's only job is to select an arm.
 *
 * ⭐ #1129 AMENDS "AND NOTHING ELSE" TO NAME ONE EXCEPTION, AND EXTENDS THE REASONING RATHER THAN
 * DROPPING IT. The ask now admits an optional `serverId`, so the sentence above is no longer
 * literally true of the shape. What the property actually asserted — and what remains true — is
 * that nothing renderer-supplied reaches A FILENAME, A BYTE OR THE WIRE on this path. A routing key
 * is none of the three: it is resolved against the registry's held entry set and discarded
 * (`hasValidServerId`'s docblock below spells out where it does and does not reach), while the
 * IMAGE is still read in the background process, from the clipboard, after this ask arrives, and
 * `uploadClipboardImage` still takes no field off this object whatsoever. The field that SELECTS
 * THE ARM is still one client-owned literal a renderer cannot vary, so this ask is still a
 * selection rather than a value.
 *
 * WHAT THE AMENDMENT DOES CONCEDE, stated plainly rather than buried: a compromised renderer can
 * now choose WHICH ALREADY-PAIRED server receives a pasted image, where before it got whichever
 * host was paired most recently. It cannot reach a server the operator has not paired —
 * `connectionFor` is the boundary. That is the same choice #1118 gave every conversation-scoped
 * command and #1120 gave the six server-scoped ones, so it is not a new capability class; and the
 * mitigation that would matter, the operator seeing the destination, is #1086's composer surface
 * rather than anything expressible here.
 *
 * THIS ENTRY IS STILL THE NARROWEST OF THE THREE. The picker's ask has no object at all; this one
 * has a discriminator a renderer cannot vary plus a key that is looked up and thrown away; only the
 * drop's carries a value main must ACT on. The amendment is made in all three places the old
 * sentence was asserted — here, `pasteAttachmentImage` (src/preload/index.ts) and `pasteImage`
 * (src/renderer/src/screens/conversation/ComposerAttach.tsx) — so the repo does not end up
 * contradicting itself in two files out of three.
 */
export interface AttachmentPasteRequest {
  source: typeof ATTACHMENT_PASTE_SOURCE
  /** Which paired server this image is for (#1129). See `hasValidServerId` in this module — one field,
   *  one rule, three asks. */
  serverId?: string
  /** The conversation the image is for (#1205). See `hasValidConversationId`. */
  conversationId: string
}

/**
 * The runtime guard for the paste ask at the untrusted renderer→main boundary (#1032), in
 * isAttachmentUploadRequest's shape above and for its reasons. A failing ask is DROPPED: no clipboard
 * read, no event. There is no identifier to address an answer to, and nothing an operator can physically
 * do produces one, so a malformed ask means a compromised renderer and is owed no sentence.
 *
 * THE COMPARISON AGAINST A CONSTANT IS THE LOAD-BEARING LINE, the way the empty-string refusal is for
 * the path guard. A typeof-string check alone would accept any string a renderer invented and leave the
 * arm selected by something the window controls; matching one client-owned literal is what makes this
 * ask a selection rather than a value.
 *
 * The field read is an `in`-guarded property access on a narrowed `object`, so a hostile ask built with
 * a `__proto__` key is refused on its own merits: the polluting object has no OWN `source`.
 */
export function isAttachmentPasteRequest(value: unknown): value is AttachmentPasteRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('source' in value)) return false
  const { source } = value as Record<string, unknown>
  if (source !== ATTACHMENT_PASTE_SOURCE) return false
  return hasValidServerId(value) && hasValidConversationId(value)
}

/** The literal a PICKER ask names itself with (#1205) — `ATTACHMENT_PASTE_SOURCE`'s shape and reason. */
export const ATTACHMENT_PICK_SOURCE = 'file-picker' as const

/**
 * What the PICKER asks for (#1205): its own name, the destination, and optionally a server. Until #1205
 * this entry sent NO ARGUMENT — presence told the picker from the drop — and that was the channel's
 * original security property: no request field at all. The destination has to ride the ask now, so the
 * picker takes the paste's shape: a client-owned literal selects the arm, and the two ids are the only
 * other fields. Nothing about a FILE is here or can be — the picker still opens in the background
 * process and main still reads the operator's choice itself, so the drop stays the only ask that names
 * a path.
 */
export interface AttachmentPickRequest {
  source: typeof ATTACHMENT_PICK_SOURCE
  /** See `hasValidServerId`. */
  serverId?: string
  /** See `hasValidConversationId`. */
  conversationId: string
}

/** The picker ask's guard — `isAttachmentPasteRequest` verbatim, against the other literal. */
export function isAttachmentPickRequest(value: unknown): value is AttachmentPickRequest {
  if (typeof value !== 'object' || value === null) return false
  if (!('source' in value)) return false
  const { source } = value as Record<string, unknown>
  if (source !== ATTACHMENT_PICK_SOURCE) return false
  return hasValidServerId(value) && hasValidConversationId(value)
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
 * NEITHER THE BYTES NOR THE HOST PATH CROSSES, and that is still a property of this TYPE rather than a
 * promise about the sender — the same argument PairingStatus makes about the paired-server record. No
 * member declares a field that can hold a file byte or a path. `uploadId` is a randomUUID minted per
 * intent and derived from nothing about the file; `reason` is a client-owned literal; `limitBytes` is a
 * client-owned constant; the progress counts are counts of FRAMES.
 *
 * WHAT THIS UNION NO LONGER CLAIMS is that no member can hold the file's NAME. Exactly one does, on the
 * `completed` arm alone (#1038), and it is documented there. The paragraph below is the qualification
 * that member owes.
 *
 * ⭐ ONE QUALIFICATION #862'S CONTAINMENT ARGUMENT DID NOT CARRY, added when #864 landed and answered
 * when #1038 landed.
 * #862's property is that a compromised renderer "can make a picker appear; it cannot choose what that
 * picker opens, and it cannot read back what was sent". `totalChunks` was the first field here derived
 * from the CHOSEN FILE rather than from a client-owned constant: it states the file's size to within
 * ATTACHMENT_CHUNK_DATA_BYTES. Shipping a bare percentage instead would withhold nothing — at one
 * event per chunk a renderer counts the events and derives the same number, so the disclosure is the
 * emission CADENCE, not the field, and stating it outright is the honest form of it. It is accepted on
 * its size: a window that already holds the whole conversation timeline learning the approximate size
 * of a file its own user just picked is far inside the blast radius #862 already accepts. A member
 * that ever wanted to carry more than a count owed this paragraph a re-read.
 *
 * ⭐ #1038 IS THAT MEMBER, AND THIS IS THE RE-READ. `completed.filename` is the second field derived
 * from the chosen file, and unlike `totalChunks` it is not a number — so the size argument above does
 * not simply extend to it and is not what licenses it. Three things do.
 *
 * FIRST, THE DIRECTION. #862's containment governs renderer→main: a compromised window cannot choose
 * what is opened, cannot name a file, cannot reach the wire. Nothing here moves that — the two guards
 * above are untouched. What moves is what main tells a window about a transfer that window's own
 * operator started, which is a DISCLOSURE question, not a validation one.
 *
 * SECOND, THE PROVENANCE, WHICH DIFFERS BY ENTRY AND IS WHY THIS IS NOT ONE ARGUMENT BUT TWO. A picked
 * or dropped file is named `basename(path)` — the operator's own filename, one path component, never a
 * directory. A PASTED image is named by `clipboardImageFilename` (src/main/attachmentUpload.ts): a
 * client-owned stem, a UTC stamp and `.png`, so that entry discloses nothing whatsoever about what the
 * clipboard held. The strongest entry stays exactly as strong as it was.
 *
 * THIRD, THE SIZE OF WHAT IS DISCLOSED. A compromised renderer learns what its own operator called a
 * file that operator just attached, in a window that already holds the entire conversation timeline. No
 * host path, no directory, no byte. That is the same blast radius #862 accepts and #864 widened once.
 *
 * WHY IT IS SUPPLIED AT ALL rather than withheld: the merged save leg cannot be driven without it.
 * `AttachmentSaveRequest` (attachmentSave.ts) is `{ attachmentId, filename }` and that module's header
 * states outright that main does not have the name and the renderer does. This is that supply.
 *
 * ADDITIVE ROOM IS DELIBERATE. #890/#891 report their own terminals through the same channel;
 * `uploadId` is what lets a renderer tell two concurrent uploads apart. Nothing in this window can
 * correlate on it today — `requestAttachmentUpload()` returns void, so a window never learns the id
 * its own click minted (see useAttachmentUpload).
 */
export type AttachmentUploadEvent =
  /** This client declined to attempt the file ON ITS SIZE. `limitBytes` is carried so the composer can
   *  state the limit WITHOUT inventing one — and it is the client's own bound, not the daemon's: a file
   *  under it may still come back `attachment-too-large`, which is a `failed`, not a `refused`.
   *
   *  SCOPED TO THIS VARIANT BY #1032, and the scoping is the point rather than housekeeping: `refused`
   *  now has a second member, and `limitBytes` belongs to this one alone. */
  | { type: 'refused'; uploadId: string; reason: 'too-large'; limitBytes: number }
  /**
   * This client declined because there was nothing to attach: the clipboard held no image when the
   * background process read it (#1032). A REFUSAL, not a failure — nothing was attempted and nothing
   * went wrong; the operator pasted at a moment when the clipboard held text, or an image that was
   * gone by the time the ask arrived.
   *
   * A SEPARATE MEMBER RATHER THAN A SECOND `reason` ON THE ONE ABOVE, and that shape is forced rather
   * than chosen. Widening the shipped member's `reason` in place TYPECHECKS — `attachmentUploadCopy`'s
   * `case 'refused'` arm reads `limitBytes` and never branches on `reason` — and would then have
   * rendered the too-large sentence, limit figure and all, for a paste that found nothing. Declaring
   * the variant WITHOUT `limitBytes` is what turns that silent mis-rendering into a compile error, and
   * absent rather than optional for the same reason: an optional field renders `undefined` into a
   * sentence instead of refusing to build.
   *
   * It carries no figure of its own because there is none to carry. What it deliberately does NOT
   * carry is anything about the clipboard — not its flavour, not a length, not a dimension — which is
   * what keeps the union's content-free argument true of this member as well.
   */
  | { type: 'refused'; uploadId: string; reason: 'no-image' }
  /** The attempt was made and did not store the file. */
  | { type: 'failed'; uploadId: string; reason: AttachmentUploadFailure }
  /**
   * The daemon stored the file, and this is what it is called (#1038).
   *
   * `filename` IS THE SAME VALUE THAT RODE THE WIRE — not a second copy of it, and not a differently
   * bounded one. `driveUpload` (src/main/attachmentUpload.ts) trims the name to
   * ATTACHMENT_FILENAME_MAX_BYTES ONCE, into a const, and reads that const twice: the chunk envelope's
   * `filename` and this field. So the window is told what the daemon was told, and the two cannot drift
   * — a second `trimToBytes` call would agree for a short name and diverge at 255 bytes, which is
   * exactly where a display name matters.
   *
   * DISPLAY TEXT, AND ITS ONWARD USE IS THE SAVE LEG. It is not a path and not a capability: a consumer
   * hands it back as `AttachmentSaveRequest.filename`, where main treats it as untrusted renderer text
   * and re-runs `sanitizeAttachmentFilename` on the value it actually builds a path from. That is why
   * nothing is stripped here — a second sanitiser on this side would be the divergent-checks shape
   * attachmentBytes.ts already argues against. 255 bytes is well inside MAX_SAVE_FILENAME_LENGTH.
   *
   * A SINGLE PATH COMPONENT BY CONSTRUCTION: `basename` returns one, and a trim that cuts only between
   * code points can introduce no separator. NOT the same as "carries no separator character" — `\` is a
   * legal filename character on macOS and Linux, so a file genuinely named `a\b.txt` produces a name
   * containing one, and the save leg rewrites it to `_` regardless.
   *
   * REQUIRED, NEVER OPTIONAL, for the reason the `no-image` refusal records above: an optional field
   * renders `undefined` into a sentence instead of refusing to build, and makes every construction
   * site's omission silent. Empty is representable and unreachable — `basename` answers '' only for a
   * path the read guard already refuses — so a consumer should not assume non-empty without checking.
   *
   * WHAT IT IS NOT: the only member that carries a name. The three other arms and the in-flight one
   * carry no string but their own `uploadId` and their client-owned `reason`.
   */
  | { type: 'completed'; uploadId: string; filename: string }
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
