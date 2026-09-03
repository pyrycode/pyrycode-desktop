// The attach flow between the file picker and #861's upload driver (#862): guard the chosen file,
// read it, declare it, drive the upload, and report exactly one terminal to the window. The picker
// itself is NOT here — the Electron `dialog` call cannot be Electron-free, so it stays at the
// composition-root edge and hands this module a path, which is what keeps the guard and the drive
// unit-testable either side of it and makes cancellation provable without a real dialog.
//
// MAIN-PROCESS ONLY, and Electron-free: `node:fs/promises`, `node:path` and `node:crypto` only, the
// saveDebugBundle posture — the Electron-derived input (the path) is a PARAMETER, so the test module
// graph never touches `electron`. It holds the file's whole bytes, so it must never be re-exported
// through any renderer barrel (CLAUDE.md "Keep the transport out of the window").
//
// THE RENDERER NAMES AN INTENT, NEVER A FILE. Nothing renderer-supplied reaches this module: the path
// comes from the OS picker, the id from randomUUID, the bound and the mime table from constants
// written here. That is the containment a renderer compromise runs into — it can make a picker
// appear; it cannot choose what the picker opens, and it cannot read back what was sent.
//
// NEITHER FUNCTION EVER REJECTS. #861's `uploadAttachment` already never rejects, so the `fs` read
// this slice adds was the last unhandled-main-process-rejection surface on the chain; both entries
// resolve `void` on every path, which is what licenses the composition root's bare `void` call.
//
// LOG DISCIPLINE. `DiagnosticEvent` has no field shaped to hold a filename or a path, and this module
// logs only a static event name, a client-owned stage `code`, and the file's `bytes` length — the
// allowlisted content-free field #861 already logs. The path, the basename, the derived `mime_type`
// and the `uploadId` are all deliberately absent (the last for the reason attachmentTransfer.ts's
// header records: an id that ever came to be derived from the filename would leak it through a field
// that looks safe). The caught `fs` error is DROPPED UNEXAMINED — Node's ErrnoException carries
// `.path`, so classify-don't-forward (inherited #62) is load-bearing here, not stylistic.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ATTACHMENT_CHUNK_DATA_BYTES, ATTACHMENT_FILENAME_MAX_BYTES } from '../shared/wire/types'
import type { AttachmentUploadEvent } from '../shared/ipc/attachmentUpload'
import type { AttachmentChunkPlanInput } from './transport/attachmentChunkPlan'
import type { AttachmentTransferResult } from './transport/attachmentTransfer'
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
  /** #861's send driver — `connection.uploadAttachment`. Documented never to reject. */
  upload: (input: AttachmentChunkPlanInput) => Promise<AttachmentTransferResult>
  /** The one path to the window: a `sender`-closed push on ATTACHMENT_UPLOAD_EVENT_CHANNEL. */
  emit: (event: AttachmentUploadEvent) => void
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
 * The flow from the size guard on: guard, declare, drive, report exactly one terminal.
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

  let result: AttachmentTransferResult
  try {
    result = await deps.upload({
      attachment_id: uploadId,
      filename: trimToBytes(file.filename, ATTACHMENT_FILENAME_MAX_BYTES),
      mime_type: file.mimeType,
      bytes: file.bytes
    })
  } catch {
    // uploadAttachment is documented never to reject, so this is a backstop rather than a live
    // branch — but AC4 is that NO path here leaves an unhandled rejection, and a contract is not a
    // guarantee. The caught object is dropped: it could echo the file's base64.
    result = { ok: false, outcome: 'send-failed' }
  }

  if (result.ok) {
    deps.diagnosticLog?.event({ event: LOG_EVENT, code: 'completed' })
    deps.emit({ type: 'completed', uploadId })
    return
  }
  deps.diagnosticLog?.event({ event: LOG_EVENT, code: result.outcome })
  deps.emit({ type: 'failed', uploadId, reason: result.outcome })
}

/**
 * Upload the file at `path`, or say why not. The entry for a picked file (#862) and for a dropped
 * one (#890), which resolves its path in the preload and joins here.
 *
 * Exactly one event is emitted per call, and the id it carries is minted here — `randomUUID`, so it
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
