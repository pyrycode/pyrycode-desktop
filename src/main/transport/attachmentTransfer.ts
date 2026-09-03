// The attachment upload driver: one file's whole bytes in, one terminal out. It is the stateful
// middle of an assembled chain — planAttachmentChunks (#860) splits the file above it,
// parseInboundMessage (#961/#964) narrows the daemon's two terminal answers below it, and this module
// does the drive: put every chunk on the live session, watch for the one answer, settle exactly once.
//
// TWO CORRELATION KEYS, AND THE OBVIOUS PRECEDENT USES ONLY ONE. daemonConnection's pendingSettings /
// pendingCreateFolders both match a reply by Envelope.in_reply_to, and the rejects on this leg do fit
// that shape — a reject answers a chunk THIS transfer sent, and `sentEnvelope` is the membership test
// over those ids. The success reply does NOT fit it: its in_reply_to names the chunk whose ARRIVAL
// COMPLETED the transfer, and since chunks are index-addressed and may be reassembled in any order, a
// sender cannot predict which of its ids that will be. That is why InboundDaemonMessage's
// `attachment-stored` member carries no inReplyTo at all — the mistake is structurally unavailable
// rather than merely warned against — and why the success key here is `attachmentId`.
//
// EXACTLY ONE TERMINAL, by construction rather than by a guard at each call site: a `settled` flag
// makes every method inert after the first settle, the bundleReassembler.ts posture. The send loop
// re-reads that flag before each chunk, so a settle from any source — a correlated reject, the
// connection teardown net, a local send throw — stops the remaining chunks. It never RETRIES: every
// reject on this leg is either permanent for the file or carries a MUST-back-off obligation with no
// retry_after_s on the wire to derive a delay from (see DaemonErrorOutcome), and the user can attach
// again. A retry loop defends a failure mode nobody has observed on this client.
//
// NO PER-TRANSFER DEADLINE, deliberately. A transfer whose chunks all went out waits indefinitely for
// its answer. The deterministic backstop is in different fabric one layer down —
// relayConnection.ts's WIRE_PONG_TIMEOUT_MS self-terminates a dead socket, and daemonConnection's
// teardown net fails every live transfer on that terminal — so only a LIVE session whose daemon
// accepts every chunk and never answers reaches the residual. That hang has not been observed; a
// timeout constant invented for it here would be an unevidenced defence. Recorded so a future ticket
// that does observe one knows where the gap is.
//
// MAIN-PROCESS ONLY, and this is the strictest instance of it in the attachment family: it holds the
// file's raw bytes AND its base64 for the whole round trip. Never re-export it through a renderer
// barrel (CLAUDE.md "keep the transport out of the window"). It stays IPC-free like the rest of
// transport/ — daemonConnection owns the IPC boundary, and this slice ships no IPC at all.
//
// CONTENT-FREE LOG. It is the first module in this family that logs anything, and the guarantee is
// STRUCTURAL: DiagnosticEvent has no field shaped to carry a filename, a path, or payload bytes, so
// the file's name and contents are unrepresentable in a record. What it writes is a static event
// name, a client-owned outcome code, the chunk count and the file's byte length. It deliberately does
// NOT log `attachment_id`, which would be a convenient correlation handle and is explicitly not a
// capability: the id is minted by this module's caller from material it cannot see, so an id ever
// derived from the filename would leak the filename through a field that looks safe.
import { planAttachmentChunks } from './attachmentChunkPlan'
import type { AttachmentChunkPlanInput } from './attachmentChunkPlan'
import type { DaemonErrorOutcome } from './inboundMessage'
import type { AttachmentChunkPayload } from '../../shared/wire/types'
import type { DiagnosticLog } from '../diagnosticLog'

/**
 * The closed set of ways a transfer can fail, as CLIENT-OWNED values. The seven DaemonErrorOutcome
 * members are the daemon's verdicts, already mapped off its untrusted `code` string at the decode
 * boundary (#965); the three below are this client's own. Every inhabitant is a literal written in
 * this repo, so a value of this type provably holds no daemon text — the same trust signal
 * DaemonErrorOutcome carries, extended over the three failures the daemon never gets to state.
 */
export type AttachmentTransferFailure =
  | DaemonErrorOutcome
  /** No live session when the upload was requested. The requestDebugBundle posture rather than
   *  send's silent no-op: this call has a caller awaiting a terminal, so silence would hang it. */
  | 'not-connected'
  /** The session went away mid-transfer — a socket drop, a relay close, a driver error, or a
   *  re-dial. All four are transfer-fatal for one reason: the daemon-side transfer does not survive
   *  a fresh Noise session, so no answer to the chunks already sent will ever arrive. */
  | 'connection-lost'
  /** This client could not put a chunk on the wire: an over-cap envelope (WireEncodeError) or a
   *  driver throw. The caught object is DROPPED, never inspected — its message could echo the file's
   *  base64 (classify-don't-forward, inherited #62) — so the two causes collapse to one outcome. */
  | 'send-failed'

/**
 * The one terminal, as a discriminated result rather than a throw. Success carries nothing: the
 * `attachment_id` the daemon named is the caller's own value, so echoing it back would tell the
 * caller only what it already supplied.
 */
export type AttachmentTransferResult =
  | { ok: true }
  | { ok: false; outcome: AttachmentTransferFailure }

/** Injected dependencies — the send seam, the yield seam, and the log. */
export interface AttachmentTransferDeps {
  /**
   * Put ONE chunk on the wire and return the envelope id it went out under. That id is the reject
   * correlation key, which is why it is returned rather than minted here: envelope ids come from
   * daemonConnection's single monotonic counter, and transport/ must not reach into it.
   *
   * MAY throw — an over-cap envelope or a driver refusal — which the loop turns into `send-failed`.
   */
  sendChunk: (payload: AttachmentChunkPayload) => number
  /**
   * Yield to the event loop between chunks so an inbound terminal can land mid-transfer. Default: a
   * `setImmediate` macrotask, NOT a microtask — socket reads are macrotasks, so a microtask yield
   * would let the whole plan drain before any reject could be observed and "no further chunks go
   * out" would be unenforceable. A DI seam like daemonConnection's `now`; tests pin it.
   */
  yieldToEventLoop?: () => Promise<void>
  /** The content-free diagnostic log. Optional — absent under test and before the composition root. */
  diagnosticLog?: DiagnosticLog
}

/** The per-transfer handle: daemonConnection drives it and correlates the daemon's answers to it. */
export interface AttachmentTransfer {
  /**
   * The id this transfer's success reply must name — the SUCCESS correlation key. Its uniqueness
   * across concurrently live transfers is the caller's contract: two transfers sharing an id would
   * let one reply resolve whichever the caller's scan reaches first.
   */
  readonly attachmentId: string
  /** Begin the send loop. Idempotent — a second call sends nothing further. */
  start(): void
  /** True iff `envelopeId` names a chunk this transfer put on the wire — the REJECT correlation key. */
  sentEnvelope(envelopeId: number): boolean
  /** The daemon stored the transfer. Settles ok; inert once settled. */
  stored(): void
  /** A terminal failure. Settles failed; inert once settled. */
  fail(outcome: AttachmentTransferFailure): void
  /** Resolves EXACTLY ONCE with the single terminal. NEVER rejects — every failure is a value. */
  readonly result: Promise<AttachmentTransferResult>
}

/** The event name every record from this module carries; the outcome lives in `code`. */
const UPLOAD_EVENT = 'attachment-upload'

/**
 * Build a transfer over one file's bytes. The plan is materialised here — for an N-byte file that is
 * N bytes of input plus ~1.33N of base64, held for the whole round trip. planAttachmentChunks offers
 * a signature-compatible generator conversion for that profile and this slice DECLINES it: the saving
 * is only the base64 (`size` and `sha256` are over the whole file, so the input must be resident
 * regardless), the client-side size bound that decides how large N gets is #862's, and nothing has
 * been observed to strain on it.
 *
 * ARMED, NOT DRIVING. The factory sends nothing; `start()` is a separate call. Not ceremony: an async
 * body runs synchronously to its first await, so a factory that also drove would put chunk 0 on the
 * wire BEFORE its caller could record the handle in its correlation slot, and a fast reply would race
 * an unarmed slot. requestDebugBundle solves the same problem by arming the reassembler before
 * building its request frame; here the send is a loop, so the seam is an explicit start().
 */
export function createAttachmentTransfer(
  input: AttachmentChunkPlanInput,
  deps: AttachmentTransferDeps
): AttachmentTransfer {
  const chunks = planAttachmentChunks(input)
  const yieldToEventLoop =
    deps.yieldToEventLoop ?? ((): Promise<void> => new Promise((resolve) => setImmediate(resolve)))

  // Envelope ids this transfer minted, in send order. A Set because membership is the only query —
  // the reject correlation asks "is this one of mine?", never "which index was it?".
  const sentEnvelopes = new Set<number>()
  let settled = false
  let started = false
  // Initialised to a no-op rather than left definitely-unassigned: the executor below runs
  // synchronously, so the real resolver always lands before anything can settle, and the no-op keeps
  // the declaration honest without an assertion.
  let deliver: (value: AttachmentTransferResult) => void = () => {}
  const result = new Promise<AttachmentTransferResult>((resolve) => {
    deliver = resolve
  })

  function settle(value: AttachmentTransferResult): void {
    if (settled) return
    settled = true
    // The single terminal choke point, so every outcome is logged the same way and none can be
    // logged twice. `count` is the number of chunks that actually reached the wire — on a failure
    // that is how far the transfer got, which is the diagnostic; the code is client-owned either way.
    deps.diagnosticLog?.event({
      event: UPLOAD_EVENT,
      code: value.ok ? 'stored' : value.outcome,
      count: sentEnvelopes.size
    })
    deliver(value)
  }

  async function drive(): Promise<void> {
    for (const chunk of chunks) {
      // Re-read on every iteration, never cached across the await below: the settle that stops this
      // loop arrives from another turn of the event loop, which is precisely the gap a cached flag
      // would miss (AC3 — no further chunks go out).
      if (settled) return
      let envelopeId: number
      try {
        envelopeId = deps.sendChunk(chunk)
      } catch {
        // The caught object is DROPPED, never inspected or forwarded: a WireEncodeError's message
        // could echo the envelope's base64 (classify-don't-forward, inherited #62).
        settle({ ok: false, outcome: 'send-failed' })
        return
      }
      sentEnvelopes.add(envelopeId)
      await yieldToEventLoop()
    }
  }

  return {
    attachmentId: input.attachment_id,
    start(): void {
      if (started) return
      started = true
      // `bytes` is the file's length and `count` its chunk count — both explicitly allowlisted
      // content-free fields, and the relay already observes per-chunk ciphertext lengths, so neither
      // is a new disclosure. No id, no filename, no mime type.
      deps.diagnosticLog?.event({
        event: UPLOAD_EVENT,
        code: 'started',
        count: chunks.length,
        bytes: input.bytes.length
      })
      // Explicitly voided: drive() never rejects — its only throwing call is inside the try above,
      // and every exit path settles or has already been settled by someone else.
      void drive()
    },
    sentEnvelope(envelopeId: number): boolean {
      return sentEnvelopes.has(envelopeId)
    },
    stored(): void {
      settle({ ok: true })
    },
    fail(outcome: AttachmentTransferFailure): void {
      settle({ ok: false, outcome })
    },
    result
  }
}
