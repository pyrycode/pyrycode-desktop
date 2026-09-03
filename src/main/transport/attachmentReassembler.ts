// Turns the retrieval leg's stream of `attachment_chunk` frames (#998) into one whole, verified file,
// or fails the transfer cleanly. It is a pure, stateful, SYNCHRONOUS accumulator: given the chunks
// the recognition layer (inboundMessage.ts) narrows, it enforces the checks a single frame cannot
// answer and delivers the assembled bytes — or one static failure reason — to an INJECTED consumer.
// The consumer receives EXACTLY ONE terminal (complete XOR fail); a `settled` flag makes any stray
// post-terminal frame inert, which is what makes "an abandoned transfer leaves nothing behind" true
// rather than intended.
//
// bundleReassembler.ts IS THE STRUCTURAL MODEL AND NOT THE ARITHMETIC MODEL, and the distinction is
// the whole point. Copied: the settle-once discipline, the injected consumer, the closed set of
// static reasons, the silence. NOT copied: contiguous ascending `seq` appended in arrival order.
// Attachment chunks are INDEX-ADDRESSED and may arrive in ANY ORDER, `total_chunks` rides every
// chunk so there is no completion frame at all, and completion is a count of DISTINCT INDICES rather
// than of frames received. AttachmentChunkPayload's own docblock says the neighbouring rule is the
// obvious one to copy and the wrong one here.
//
// THE ORACLE IS `ReassembleAttachment` in `internal/relay/v2attachmentstream.go` (`pyrycode`), written
// for exactly this leg and exported for a client that has no Go, with `CheckDeclaration` in
// `internal/attachments/admission.go` supplying the cross-check. Check order, duplicate refusal,
// size-from-what-arrived assembly and exact-hex digest comparison all mirror it, so a client that
// diverges here cannot be differentially tested against it.
//
// WHAT IT DELIBERATELY DOES NOT CHECK, because a neighbour already does:
//   - `index` inside [0, total_chunks): parseAttachmentChunkPayload refuses it per frame, and the
//     declaration-agreement branch below pins `total_chunks` for the whole transfer, so every
//     accepted chunk's index is in range for the transfer's own total. A re-check would be dead code
//     that reads as diligence.
//   - `total_chunks` being an integer >= 1, `attachment_id` being non-empty, `data` being strict
//     base64: all three are that same boundary's, and re-running them would fork a check.
//   - `filename` and `mime_type`, in either direction. They are display strings with no addressing
//     or verification role, this module never READS them at all, and the oracle does not compare
//     them either. Never reading them is the never-into-a-path rule made structural.
//
// MAIN-PROCESS ONLY. It holds a user's decrypted file bytes for the life of a transfer; never
// re-export it through a renderer barrel (CLAUDE.md "keep the transport out of the window"). It
// stays IPC-free like the rest of transport/ — #996 owns the IPC boundary and composes this module
// with attachmentStore.
//
// LOG-FREE by construction, the posture bundleReassembler and attachmentPath both take: it never
// logs, because it holds content-bearing bytes and a diagnostic could echo them. Every failure is a
// static string; no size, index, filename, digest or path is ever interpolated into one.
import { createHash } from 'node:crypto'
import { ATTACHMENT_CHUNK_DATA_BYTES } from '../../shared/wire/types'
import type { RetrievedAttachmentChunk } from './inboundMessage'

/**
 * The closed set of reasons a retrieval can fail. Each is a static enum string — no wire value,
 * byte, filename, digest or daemon message is ever interpolated into one.
 * - `stream-contradiction`: the stream contradicts itself or the transfer it claims to be — a
 *   declaration that cannot be true, a later chunk describing a different transfer, a chunk naming
 *   another `attachment_id`, or a repeated index. Merged behind one reason the way
 *   `bundleReassembler`'s `seq-mismatch` merges reorder, gap and duplicate: a consumer's answer to
 *   all of them is the same, and the finer distinction is only useful to an attacker probing which
 *   check it tripped.
 * - `too-large`: the declared size exceeds ATTACHMENT_MAX_RETRIEVAL_BYTES. Its own member rather
 *   than a contradiction, because the transfer may be perfectly well-formed and simply bigger than
 *   this client will fetch — the send leg draws the same line between `refused` and `failed`.
 * - `verification-failed`: everything arrived, and the assembled length or digest disagrees with the
 *   declaration. The realistic failure with no completion frame in the protocol.
 * - `stream-aborted`: the host abandoned the retrieval mid-stream (#999's `attachment-stream-aborted`,
 *   whose member doc assigns the discard-the-partial obligation here). Pushed in by #996.
 * - `connection-lost`: the connection dropped mid-stream. Pushed in by #996's teardown net.
 */
export type AttachmentFailReason =
  | 'stream-contradiction'
  | 'too-large'
  | 'verification-failed'
  | 'stream-aborted'
  | 'connection-lost'

/**
 * The injected sink for one retrieval. The reassembler calls EXACTLY ONE of `complete` / `fail`,
 * once. Both are SYNCHRONOUS: #996 composes this with the asynchronous `storeAttachment` and owns
 * the window-visible terminal, which must not fire before the file exists.
 *
 * There is deliberately no `progress` callback, unlike BundleConsumer. #996 feeds every chunk in, so
 * it can count them itself without this module growing a second output; adding one here would be an
 * unevidenced addition to a contract three other tickets read.
 */
export interface AttachmentConsumer {
  /** The one success terminal: the whole file, verified against its declared length and digest. */
  complete(bytes: Uint8Array): void
  /** The one failure terminal: a static reason, never a wire value. */
  fail(reason: AttachmentFailReason): void
}

/** The per-transfer handle: #996 routes frames to it by `inReplyTo` and it settles the consumer. */
export interface AttachmentReassembler {
  /** Accept one decoded chunk. Settles on the completing chunk, or on a refusal. */
  chunk(chunk: RetrievedAttachmentChunk): void
  /**
   * The pass-through door for externally-signalled abandonment — a host-signalled abort or a lost
   * connection. It takes only those two reasons: every other member of the union is a verdict this
   * module reaches on its own, and a driver must not be able to assert one.
   */
  fail(reason: 'stream-aborted' | 'connection-lost'): void
}

/**
 * This client's own bound on one RETRIEVAL, expressed in chunks because chunks are what cost time —
 * ATTACHMENT_MAX_UPLOAD_CHUNKS' figure and argument, restated for the leg that runs the other way.
 * 512 chunks at the mandated 45000-raw-byte stride is 23,040,000 bytes, ~30 seconds at a 1 MB/s
 * effective relay uplink, and a peak main-process footprint of the accumulated chunks plus the
 * assembled copy. Doubling the figure doubles both; that is the trade it encodes.
 *
 * IT IS MINTED HERE RATHER THAN IMPORTED, and that is a module-graph decision, not a disagreement.
 * `ATTACHMENT_MAX_UPLOAD_BYTES` lives in `attachmentUpload`, which pulls node:fs, the IPC event types
 * and DiagnosticLog; importing it would invert this repo's main/ → transport/ direction and drag that
 * graph into a module whose whole value is being small. The two figures are instead pinned EQUAL by a
 * test, so a later divergence reddens deterministically rather than drifting into two ceilings nobody
 * reconciles.
 *
 * IT IS NOT A PREDICTION OF THE HOST'S LIMIT. The daemon's own default per-upload bound is 16 MiB,
 * which sits BELOW this figure, so nothing a default host could have stored is fail-closed here.
 */
export const ATTACHMENT_MAX_RETRIEVAL_CHUNKS = 512
export const ATTACHMENT_MAX_RETRIEVAL_BYTES =
  ATTACHMENT_MAX_RETRIEVAL_CHUNKS * ATTACHMENT_CHUNK_DATA_BYTES

/**
 * Build a reassembler for the transfer `attachmentId`, streaming its one terminal to `consumer`.
 *
 * `attachmentId` is the identifier THIS CLIENT ASKED FOR, and it is the second half of a correlation
 * that is checked twice on purpose. #996 routes a frame to this transfer by `inReplyTo`, which says
 * WHICH REQUEST the frame answers; the payload `attachment_id` says WHICH TRANSFER it belongs to.
 * The failure only the payload id catches is the host answering the right ask with the wrong bytes,
 * which is what makes the two non-redundant rather than belt-and-braces.
 *
 * State is a `Map<number, Uint8Array>` keyed by index, plus the declaration captured from the first
 * accepted chunk and two flags. A Map rather than a pre-sized array so that literally nothing is
 * allocated or reserved from either declared number, and so the plain-object `__proto__` hazard does
 * not arise at all — the keys are numbers.
 */
export function createAttachmentReassembler(
  attachmentId: string,
  consumer: AttachmentConsumer
): AttachmentReassembler {
  const arrived = new Map<number, Uint8Array>()
  let settled = false
  let started = false
  let total = 0
  let size = 0
  let digest = ''

  /** Settle once, with a static reason. Every method is inert afterwards. */
  function settle(reason: AttachmentFailReason): void {
    settled = true
    consumer.fail(reason)
  }

  /**
   * The first chunk's declaration gate, run before anything is sized. Returns the reason to settle
   * on, or null to admit. THE ORDER CARRIES THE SOUNDNESS ARGUMENT and is not interchangeable.
   */
  function refuseDeclaration(chunk: RetrievedAttachmentChunk): AttachmentFailReason | null {
    // parseAttachmentChunkPayload gives `size` only a requireNumber — no integer check, deliberately
    // — so NaN, +/-Infinity and a fractional value all reach here. Number.isInteger is false for all
    // three, so this one predicate covers them; a separate isFinite would be dead code.
    if (!Number.isInteger(chunk.size) || chunk.size < 0) return 'stream-contradiction'

    // MAGNITUDE BEFORE THE CROSS-CHECK, and that ordering is the reason this bound is not merely a
    // memory-footprint nicety. Upstream bans the (size + bound - 1) / bound ceiling form because its
    // numerator wraps int64 and launders the largest declaration on the wire back into a count of 1;
    // THAT mechanism does not transfer, since a JavaScript number is a double and does not wrap. Its
    // cousin does: above Number.MAX_SAFE_INTEGER a declared size is no longer an exact integer, so
    // any equality derived from it is unsound. Refusing on magnitude first puts `size` far below
    // 2^53 — the bound is 23,040,000 — which is what keeps the arithmetic below exact.
    if (chunk.size > ATTACHMENT_MAX_RETRIEVAL_BYTES) return 'too-large'

    // The daemon-published invariant (attachments.CheckDeclaration), which is what makes
    // `total_chunks` trustworthy relative to `size`. NO CLIENT-INVENTED CHUNK-COUNT CEILING is added
    // on top: this equality plus the bound above already put `total_chunks` at 512 or below, and an
    // invented ceiling would fail-close a large valid transfer. The max(1, ...) is reachable only at
    // size 0 and is the whole definition of the zero-byte file — one chunk carrying zero bytes,
    // against a bare ceiling's 0 and the documented total_chunks >= 1.
    const published = Math.max(1, Math.ceil(chunk.size / ATTACHMENT_CHUNK_DATA_BYTES))
    if (chunk.total_chunks !== published) return 'stream-contradiction'

    return null
  }

  /** Concatenate indices 0..total-1, then verify length and digest before handing anything on. */
  function finish(): void {
    const parts: Uint8Array[] = []
    for (let index = 0; index < total; index += 1) {
      // Non-null by construction: the map holds exactly `total` distinct keys, every one of them an
      // integer inside [0, total_chunks) that the decode boundary already narrowed. The fallback is
      // the null path handled rather than asserted away — it can only widen the assembled length,
      // which the very next check refuses.
      parts.push(arrived.get(index) ?? new Uint8Array(0))
    }
    // Sized from the lengths that ACTUALLY ARRIVED, never from the declaration, which has been
    // cross-checked but not counted. Plain Uint8Array arithmetic rather than Buffer.concat: the
    // consumer contract says Uint8Array, and handing back a Buffer would be a subtype leak a
    // consumer could accidentally depend on (it serialises differently, for one).
    let assembledLength = 0
    for (const part of parts) assembledLength += part.length
    const bytes = new Uint8Array(assembledLength)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.length
    }

    if (bytes.length !== size) {
      settle('verification-failed')
      return
    }
    // INTEGRITY, NOT AUTHENTICITY: the same party supplies the bytes and the digest, so a match
    // proves the stream arrived intact and nothing about who sent it. It is checked because a
    // truncated or reordered stream is the realistic failure and, with no completion frame on this
    // leg, the count is the only other signal there is. Exact equality on lowercase hex over the
    // WHOLE file — digest('hex') is lowercase, and the decode layer deliberately does not
    // length-check `sha256`, so a prefix or case-insensitive comparison would be a hole. No
    // constant-time primitive: neither side is a secret.
    if (createHash('sha256').update(bytes).digest('hex') !== digest) {
      settle('verification-failed')
      return
    }

    settled = true
    consumer.complete(bytes)
  }

  return {
    chunk(chunk: RetrievedAttachmentChunk): void {
      if (settled) return

      // Checked on EVERY chunk, the first included: a frame answering this request while naming
      // another transfer is the host answering the right ask with the wrong bytes.
      if (chunk.attachment_id !== attachmentId) {
        settle('stream-contradiction')
        return
      }

      if (!started) {
        const refusal = refuseDeclaration(chunk)
        if (refusal !== null) {
          settle(refusal)
          return
        }
        total = chunk.total_chunks
        size = chunk.size
        digest = chunk.sha256
        started = true
      } else if (
        chunk.total_chunks !== total ||
        chunk.size !== size ||
        chunk.sha256 !== digest
      ) {
        // A later chunk describing a different transfer. Pinning `total_chunks` here is also what
        // makes the omitted index-range re-check sound for the whole stream.
        settle('stream-contradiction')
        return
      }

      // A repeat is REFUSED, not absorbed. Absorbing would have to either compare the two copies —
      // a second and weaker digest check — or silently keep one of them; and this transport is
      // ordered and reliable, so a repeat is not a retransmit, it is a stream that is not the one
      // the daemon publishes.
      if (arrived.has(chunk.index)) {
        settle('stream-contradiction')
        return
      }
      arrived.set(chunk.index, chunk.data)

      // Completion is a count of DISTINCT INDICES, never of frames received. A zero-byte file is one
      // chunk carrying zero bytes with a declared total of 1, so "no bytes" and "no chunks" are
      // different things and only the second is an incomplete transfer.
      if (arrived.size === total) finish()
    },

    fail(reason: 'stream-aborted' | 'connection-lost'): void {
      if (settled) return
      settle(reason)
    }
  }
}
