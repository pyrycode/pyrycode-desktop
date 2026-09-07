// The attach flow between an operator's gesture and #861's upload driver (#862): guard the chosen
// file, read it, declare it, drive the upload, and report exactly one terminal to the window. THREE
// ENTRIES join it — a picked file (#862), a dropped one (#890), and a pasted image (#1032) — and each
// converges on one guard and one terminal rather than copying either.
//
// NO ELECTRON CALL IS HERE, on purpose and for all three. The `dialog` call, `webUtils`, and
// `clipboard.readImage()` all stay at the composition-root edge and reach this module as a PARAMETER —
// a path, or a reader function. That is what keeps the guard and the drive unit-testable either side
// of them, makes cancellation provable without a real dialog, and lets the no-image branch be tested
// without touching the operator's real clipboard.
//
// MAIN-PROCESS ONLY: `node:fs/promises`, `node:path` and `node:crypto` only, the saveDebugBundle
// posture. It holds the file's whole bytes, so it must never be re-exported through any renderer barrel
// (CLAUDE.md "Keep the transport out of the window").
//
// WHAT THE WINDOW MAY NAME, ENTRY BY ENTRY — the containment a renderer compromise runs into, and it is
// narrower than "nothing", which is what this paragraph used to claim for the whole module. The picker
// entry: an intent and nothing else, so a compromised renderer can make a picker appear but cannot
// choose what it opens. The paste entry: an intent and nothing else again — the bytes come from the
// clipboard, read HERE rather than claimed by the window, and the name, the type and the id are all
// constants or randomUUID. The drop entry alone admits a renderer-supplied value, a host path, and it
// is a CLAIM rather than a capability: `isAttachmentUploadRequest` shapes it at the boundary and
// `readChosenFile` refuses anything that is not a regular file.
//
// WHAT A WINDOW CAN READ BACK is one thing and no longer nothing (#1038): the completed terminal names
// the file, so a window learns the DISPLAY NAME of an upload that succeeded — `basename(path)` for the
// first two entries, and for the paste entry a name minted here from constants, which discloses nothing
// about the clipboard at all. It never learns a host path, a directory or a byte, and the three
// paragraphs above are unaffected: this is the main→window direction, and nothing a compromised
// renderer may NAME has changed.
//
// NO ENTRY EVER REJECTS. #861's `uploadAttachment` already never rejects, so the `fs` read and the
// injected clipboard reader are the only other rejection surfaces on the chain and both are caught;
// every entry resolves `void` on every path, which is what licenses the composition root's bare `void`.
//
// LOG DISCIPLINE. `DiagnosticEvent` has no field shaped to hold a filename or a path, and this module
// logs only a static event name, a client-owned stage `code`, and the file's `bytes` length — the
// allowlisted content-free field #861 already logs. The path, the basename, the derived `mime_type`
// and the `uploadId` are all deliberately absent (the last for the reason attachmentTransfer.ts's
// header records: an id that ever came to be derived from the filename would leak it through a field
// that looks safe). The caught `fs` error is DROPPED UNEXAMINED — Node's ErrnoException carries
// `.path`, so classify-don't-forward (inherited #62) is load-bearing here, not stylistic, and the
// caught clipboard-reader error is dropped for the same reason.
// NOTHING ABOUT THE CLIPBOARD IS LOGGED AT ALL (#1032): the no-image refusal records a static code with
// NO `bytes` figure, so no length, dimension or flavour of what the operator was holding is written
// down even in the branch that read it.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ATTACHMENT_CHUNK_DATA_BYTES, ATTACHMENT_FILENAME_MAX_BYTES } from '../shared/wire/types'
import type { AttachmentUploadEvent } from '../shared/ipc/attachmentUpload'
import type { AttachmentChunkPlanInput } from './transport/attachmentChunkPlan'
import type {
  AttachmentTransferProgress,
  AttachmentTransferResult
} from './transport/attachmentTransfer'
import type { DiagnosticLog } from './diagnosticLog'

/**
 * The client's own bound on one upload, expressed in CHUNKS because chunks are what cost time. The
 * receiver's stride is a mandated 45000 raw bytes (ATTACHMENT_CHUNK_DATA_BYTES), so 512 chunks is
 * ~30.7 MB of base64 on the wire — 45000 raw bytes encode to exactly 60000 characters — which at a
 * 1 MB/s effective relay uplink is a ~30 second transfer, and a peak main-process footprint of the
 * file plus its base64, ~54 MB. Doubling the figure doubles both; that is the trade it encodes.
 *
 * IT DOES NOT PREDICT THE DAEMON'S ANSWER. The receiver's per-upload byte bound is receiver-
 * configured and unpublished (`pyrycode` docs/protocol-mobile.md § Attachments says outright that a
 * client learns it by being rejected), so a file under this bound may still come back
 * `attachment-too-large`. That is the driver's terminal — a `failed` — not this guard's `refused`.
 * The only thing this bound buys is not spending minutes streaming something with no chance.
 */
export const ATTACHMENT_MAX_UPLOAD_CHUNKS = 512
export const ATTACHMENT_MAX_UPLOAD_BYTES = ATTACHMENT_MAX_UPLOAD_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

/**
 * The plan size at which one upload starts saying how far it has got (#864) — the whole of "whether
 * progress is reported at all", in one constant, expressed in CHUNKS and never in a clock.
 *
 * Eight chunks is 360000 raw bytes and ~480000 base64 characters on the wire: about half a second at
 * the 1 MB/s effective uplink ATTACHMENT_MAX_UPLOAD_CHUNKS above reasons in. Below that a progress
 * line appears and vanishes inside one blink, which reads as a glitch rather than as reassurance —
 * worse than the silence it replaces. Above it, a transfer is long enough that silence reads as a
 * hang, which is the problem the feature exists for.
 *
 * A CHUNK COUNT RATHER THAN A DURATION, deliberately, and that is what makes the decision the same on
 * a fast link and a slow one: a clock would report on a small file over a bad connection and stay
 * silent on a large one over a good one, which is the opposite of what either user needs. It also
 * means the decision can be made HERE, in the background process, before any message crosses — so a
 * small upload costs no IPC at all rather than costing some and being filtered in the window.
 */
export const ATTACHMENT_PROGRESS_MIN_CHUNKS = 8

/** The static event name every record from this module carries. */
const LOG_EVENT = 'attachment-pick'

/**
 * The whole `mime_type` obligation: a hint the daemon does not verify, with an
 * `application/octet-stream` fallback. Deliberately NOT a comprehensive extension table — the daemon
 * re-derives what it needs and a wrong hint costs nothing on the wire.
 *
 * A Map rather than an object literal so a lookup key can never reach `Object.prototype`; every
 * value is a short literal written here, which is also why `mime_type` needs no runtime length trim
 * against ATTACHMENT_MIME_TYPE_MAX_BYTES — it is bounded by construction.
 */
const MIME_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.json', 'application/json'],
  ['.csv', 'text/csv'],
  ['.html', 'text/html'],
  ['.zip', 'application/zip']
])

/** The injected collaborators, all Electron-free so the flow unit-tests without a window. */
export interface AttachmentUploadDeps {
  /**
   * #861's send driver — `connection.uploadAttachment`. Documented never to reject.
   *
   * `onProgress` is handed down to the transfer, which calls it after each chunk reaches the wire
   * (#864). It is optional on the driver's own signature, so a caller here always passes one and a
   * driver is free to ignore it.
   */
  upload: (
    input: AttachmentChunkPlanInput,
    onProgress?: AttachmentTransferProgress
  ) => Promise<AttachmentTransferResult>
  /** The one path to the window: a `sender`-closed push on ATTACHMENT_UPLOAD_EVENT_CHANNEL. */
  emit: (event: AttachmentUploadEvent) => void
  /**
   * The conversation the upload is filed under (#1205) — the open chat's daemon-minted id, as the ask
   * carried it. REQUIRED, unlike the routing key the ask also carries: the daemon refuses a chunk
   * without one (pyrycode #2143), so there is no unnamed path for this value the way there is for a
   * server. It is READ ONCE, when `driveUpload` builds the plan input, and the plan spreads it onto
   * every chunk — which is what keeps a transfer's destination fixed for its whole life. The daemon
   * fixes it on the first chunk and refuses a later chunk naming another conversation (pyrycode #2146),
   * so an upload that read the id live from a store the operator can switch mid-transfer would be
   * killed by the switch. Per ask rather than per file, so all three entries name the same one.
   *
   * WHERE IT REACHES: the wire, on every chunk, as the daemon's lookup key. Nowhere else — not a
   * filename, not a path, not a log line (`DiagnosticEvent` has no identifier-shaped field).
   */
  conversationId: string
  /** The one content-free logger (#126). Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}

/** A file this flow is prepared to declare: the bytes plus the two strings that describe them.
 *  Exported because it is `uploadAttachmentBytes`'s parameter — the seam #891 enters at. */
export interface AttachmentUploadFile {
  bytes: Uint8Array
  filename: string
  mimeType: string
}

/** What reading the chosen path produced. Emits and logs NOTHING — the decision is returned so the
 *  fs try/catch stays sealed around fs calls alone and a throwing `emit` cannot be misread as an
 *  unreadable file. The refusal carries the stat's size so the log records the real figure. */
type ReadOutcome =
  | { kind: 'file'; file: AttachmentUploadFile }
  | { kind: 'refused'; size: number }
  | { kind: 'unreadable' }

/**
 * Trim `value` to at most `maxBytes` of UTF-8, cutting only BETWEEN code points.
 *
 * The bound counts BYTES, not characters (ATTACHMENT_FILENAME_MAX_BYTES is documented, not validated,
 * so staying inside it is this side's job) — a macOS name of 255 non-ASCII characters is far over
 * 255 bytes, which is exactly what a `.slice(0, 255)` gets wrong. Iterating with `for...of` walks
 * CODE POINTS, so a surrogate pair is never split in half and a multi-byte sequence is never cut
 * mid-way into a U+FFFD. Total: an already-short name comes back byte-identical.
 */
function trimToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let trimmed = ''
  let used = 0
  for (const codePoint of value) {
    const size = Buffer.byteLength(codePoint, 'utf8')
    if (used + size > maxBytes) break
    trimmed += codePoint
    used += size
  }
  return trimmed
}

/** The declared media type for a name, or the octet-stream fallback. Case-insensitive on the
 *  extension, since a picker returns whatever the filesystem stored. */
function mimeTypeFor(filename: string): string {
  return MIME_TYPES.get(extname(filename).toLowerCase()) ?? 'application/octet-stream'
}

/**
 * Open the path, decide on it, and read it — in that order, through ONE handle.
 *
 * OPEN-THEN-STAT, NEVER STAT-THEN-OPEN. Checking a path and then opening it leaves a swap-in-the-gap
 * window in which the bound is not the bound; the handle names one inode for the whole sequence.
 * That ordering is also what makes the bound a real memory bound rather than a report after the
 * fact — an oversized file is never read.
 *
 * `isFile()` IS CHECKED BEFORE THE LENGTH, and that ordering is load-bearing too: `open` follows
 * symlinks, and a character device or a FIFO stats at size 0, so a size-only guard waves `/dev/zero`
 * through to a read that never returns and never stops growing. It also gives the chosen-a-directory
 * case a decided answer instead of leaving it to whichever errno the platform's read happens to
 * raise. Everything that is not a regular file is `unreadable`.
 */
async function readChosenFile(path: string): Promise<ReadOutcome> {
  try {
    const handle = await open(path, 'r')
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) return { kind: 'unreadable' }
      if (stats.size > ATTACHMENT_MAX_UPLOAD_BYTES) return { kind: 'refused', size: stats.size }
      const read = await handle.readFile()
      const filename = basename(path)
      return {
        kind: 'file',
        file: {
          // A true Uint8Array view over the read, honouring offset and length. Not the Buffer
          // itself: the plan's `Buffer.from(view)` is correct either way, but the value crosses two
          // module boundaries typed as Uint8Array and a view keeps that honest with no copy.
          bytes: new Uint8Array(read.buffer, read.byteOffset, read.byteLength),
          filename,
          mimeType: mimeTypeFor(filename)
        }
      }
    } finally {
      // Runs on every path — the two returns above, the read's throw, and a throw from `stat`.
      await handle.close()
    }
  } catch {
    // DROPPED, never inspected or forwarded: an fs ErrnoException carries the host path in `.path`
    // and its message. ENOENT, EACCES, EISDIR and a close failure all collapse to one outcome, which
    // is all the window is told and all it can act on.
    return { kind: 'unreadable' }
  }
}

/** Emit the one refusal, from either entry's guard. */
function reportRefused(uploadId: string, bytes: number, deps: AttachmentUploadDeps): void {
  deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'too-large', bytes })
  deps.emit({
    type: 'refused',
    uploadId,
    reason: 'too-large',
    limitBytes: ATTACHMENT_MAX_UPLOAD_BYTES
  })
}

/**
 * The flow from the size guard on: guard, declare, drive, say how far it got, report exactly one
 * terminal. Progress (#864) is optional and comes first; the terminal is neither.
 *
 * The `reason: result.outcome` assignment is the COMPILE-FORCED check that AttachmentUploadFailure
 * still covers every AttachmentTransferFailure — shared cannot import the transport's union, so a
 * twelfth outcome added upstream reddens this line rather than silently becoming unrepresentable.
 */
async function driveUpload(
  uploadId: string,
  file: AttachmentUploadFile,
  deps: AttachmentUploadDeps
): Promise<void> {
  if (file.bytes.length > ATTACHMENT_MAX_UPLOAD_BYTES) {
    reportRefused(uploadId, file.bytes.length, deps)
    return
  }

  deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'started', bytes: file.bytes.length })

  // #864's two guards, both read on every report and neither derived from a clock.
  //
  // THE THRESHOLD IS EVALUATED PER REPORT rather than once, because the total is not known until the
  // driver has built the plan and this module never builds one. It is a comparison of two integers;
  // what matters is that it is answered here, before anything crosses, so a small upload costs no IPC.
  //
  // `terminal` IS A SECOND GUARD OVER THE TRANSFER'S OWN, in a different module and over different
  // state, and it is this module's established posture rather than an invented defence: the catch
  // below already backstops `upload`'s documented never-rejects on the explicit grounds that a
  // contract is not a guarantee for an INJECTED seam. A report arriving after the answer is exactly
  // the shape that would leave a stale percentage on screen with no terminal left to replace it.
  let terminal = false
  const onProgress: AttachmentTransferProgress = (sentChunks, totalChunks) => {
    if (terminal || totalChunks < ATTACHMENT_PROGRESS_MIN_CHUNKS) return
    deps.emit({ type: 'progress', uploadId, sentChunks, totalChunks })
  }

  // ⭐ TRIMMED ONCE, READ TWICE — the wire envelope below and the completed terminal at the bottom of
  // this function (#1038). Hoisting this out of the envelope literal is the whole of "the window is
  // told the same bounded value the daemon was told": a second trimToBytes call would agree for every
  // short name and diverge at exactly 255 bytes, which is where a display name is worth having. One
  // const read twice makes it a fact rather than a convention two call sites happen to share.
  const declaredFilename = trimToBytes(file.filename, ATTACHMENT_FILENAME_MAX_BYTES)

  let result: AttachmentTransferResult
  try {
    result = await deps.upload(
      {
        // Read ONCE, here, and spread onto every chunk by the plan — see `AttachmentUploadDeps`.
        conversation_id: deps.conversationId,
        attachment_id: uploadId,
        filename: declaredFilename,
        mime_type: file.mimeType,
        bytes: file.bytes
      },
      onProgress
    )
  } catch {
    // uploadAttachment is documented never to reject, so this is a backstop rather than a live
    // branch — but AC4 is that NO path here leaves an unhandled rejection, and a contract is not a
    // guarantee. The caught object is dropped: it could echo the file's base64.
    result = { ok: false, outcome: 'send-failed' }
  }

  // Set before either arm emits and with no await in between, so there is no gap in which a late
  // report could reach the window between the answer and the terminal that replaces it.
  terminal = true

  if (result.ok) {
    // The LOG is unchanged and stays content-free: a static event name and a client-owned stage code,
    // no name, no path, no separator. Only the EVENT carries the display name (#1038), and the two
    // sinks are deliberately not symmetrical — a log file under userData is readable by anything
    // running as the user, whereas the window already holds the timeline the file was attached to.
    deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'completed' })
    deps.emit({ type: 'completed', uploadId, filename: declaredFilename })
    return
  }
  deps.diagnosticLog?.event({ event: LOG_EVENT, code: result.outcome })
  deps.emit({ type: 'failed', uploadId, reason: result.outcome })
}

/**
 * Upload the file at `path`, or say why not. The entry for a picked file (#862) and for a dropped
 * one (#890), which resolves its path in the preload and joins here.
 *
 * Exactly one TERMINAL is emitted per call — preceded, for a transfer over
 * ATTACHMENT_PROGRESS_MIN_CHUNKS, by a report per chunk that reached the wire (#864). Every event of
 * one call carries the same id, and that id is minted here — `randomUUID`, so it
 * is derived from nothing about the file and is unique across concurrently live transfers, which is
 * `uploadAttachment`'s stated precondition rather than something it enforces. Never rejects.
 */
export async function uploadAttachmentFile(
  path: string,
  deps: AttachmentUploadDeps
): Promise<void> {
  const uploadId = randomUUID()
  const outcome = await readChosenFile(path)
  if (outcome.kind === 'refused') {
    // The length logged is the STAT's, not the bytes' — the file was deliberately never read.
    reportRefused(uploadId, outcome.size, deps)
    return
  }
  if (outcome.kind === 'unreadable') {
    deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'unreadable' })
    deps.emit({ type: 'failed', uploadId, reason: 'unreadable' })
    return
  }
  await driveUpload(uploadId, outcome.file, deps)
}

/**
 * Upload bytes already in memory, or say why not. The entry for a pasted image (#891), which reads
 * the clipboard in main and joins the flow at the size guard rather than copying it.
 *
 * `filename` is trimmed to the wire bound like any other, so a caller owes a display name, not a
 * bounded one. Never rejects.
 */
export async function uploadAttachmentBytes(
  file: AttachmentUploadFile,
  deps: AttachmentUploadDeps
): Promise<void> {
  await driveUpload(randomUUID(), file, deps)
}

/**
 * The clipboard's image as PNG bytes, or `null` when it holds none (#1032).
 *
 * A PARAMETER RATHER THAN A MEMBER OF AttachmentUploadDeps, and that is the header's Electron-free
 * commitment being kept rather than a style choice: `clipboard.readImage()` is Electron, so the call
 * stays at the composition root — `uploadAttachmentFile`'s path parameter and `saveDebugBundle`'s
 * `save` seam, in the same shape — and this module's test graph never loads `electron`. It also keeps
 * the shared deps object free of a collaborator the other two entries cannot use.
 */
export type ClipboardImageReader = () => Uint8Array | null

/** What a pasted image is DECLARED as, always. Not sniffed from the bytes: the background process asks
 *  the clipboard for PNG and encodes PNG, so the hint is a fact about what it did rather than a guess
 *  about what it holds. Absent from MIME_TYPES on purpose — nothing here has a filename to look up. */
export const CLIPBOARD_IMAGE_MIME_TYPE = 'image/png'

/** The client-owned stem every pasted image is named with. The whole display name is minted here, so
 *  no part of it can come from the clipboard, from the window, or from the host. */
export const CLIPBOARD_IMAGE_FILENAME_PREFIX = 'clipboard-image'

/**
 * A display name for one pasted image: the constant stem, a UTC timestamp, and `.png`.
 *
 * UTC AND NEVER A LOCAL GETTER. No time zone is pinned anywhere in this repo, so a local stamp would
 * name the same paste differently on two machines; the one existing formatter in this codebase uses UTC
 * getters for that reason. `toISOString` with the separators stripped is filename-safe on every
 * platform, which a raw ISO string is not (`:` is illegal on Windows).
 *
 * TWO PASTES INSIDE ONE SECOND MINT THE SAME NAME, and that is accepted: the daemon keys on
 * `attachment_id`, which is a fresh randomUUID per call, so the collision is cosmetic. Adding the id to
 * the name would fix nothing and would put a correlator in a string the operator reads.
 */
function clipboardImageFilename(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')
  return `${CLIPBOARD_IMAGE_FILENAME_PREFIX}-${stamp}.png`
}

/**
 * Upload the image on the clipboard, or say why not. The entry for a pasted image (#1032), which reads
 * the clipboard in the background process — never in the window — and joins the flow at the size guard.
 *
 * THE ASK CARRIES NOTHING, so nothing renderer-supplied reaches this function: the bytes come from the
 * reader, the id from randomUUID, the name and the declared type from constants written here. That is
 * a stronger containment than either shipped entry has — the picker's path comes from the OS dialog and
 * the drop's is a claim main must open to test, while here there is no untrusted value at all.
 *
 * THE NO-IMAGE CASE IS A REFUSAL, NOT A FAILURE: nothing was attempted and nothing went wrong. It is
 * emitted here rather than through `uploadAttachmentBytes` because a terminal that precedes any bytes
 * has no upload to borrow an id from — and because routing an empty array through the driver is not
 * merely inelegant: zero bytes PASSES the size guard and would attempt a real upload of an empty file.
 *
 * Never rejects, like its two siblings — which is what licenses the composition root's bare `void`.
 */
export async function uploadClipboardImage(
  readClipboardImage: ClipboardImageReader,
  deps: AttachmentUploadDeps
): Promise<void> {
  let bytes: Uint8Array | null
  try {
    bytes = readClipboardImage()
  } catch {
    // An INJECTED seam, and a contract is not a guarantee for one — driveUpload's catch below makes the
    // same argument about `upload`. The caught object is dropped unexamined, matching readChosenFile:
    // it is the only thing on this path that could carry anything about the clipboard. A throw and an
    // empty clipboard are one fact from the composer's seat, so they report one refusal rather than
    // minting a union member for a branch a conforming Electron never takes.
    bytes = null
  }

  if (bytes === null || bytes.length === 0) {
    // No `bytes` field: DiagnosticEvent's is optional, so a refusal with nothing to count omits it
    // rather than reporting a zero that would read as a measurement of the clipboard.
    deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'no-image' })
    deps.emit({ type: 'refused', uploadId: randomUUID(), reason: 'no-image' })
    return
  }

  await driveUpload(
    randomUUID(),
    { bytes, filename: clipboardImageFilename(), mimeType: CLIPBOARD_IMAGE_MIME_TYPE },
    deps
  )
}
