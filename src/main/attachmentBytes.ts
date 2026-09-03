// Reads one attachment that is ALREADY ON THIS MACHINE out of the app's private attachment directory
// and answers its bytes to the window that asked (#866). It does not fetch: #996 owns that, and a
// file that is not there is a failure to REPORT rather than a trigger to go and get it —
// attachmentSave.ts draws the same boundary for the Downloads copy, in those words.
//
// THE UNTRUSTED IDENTIFIER HAS ONE GATE, PRE-EXISTING AND CONSUMED VERBATIM. `resolveAttachmentPath`
// (#818) REFUSES a non-canonical identifier before any filesystem call — there is deliberately no
// second escape check here, because two divergent checks on one directory ends with one of them being
// weaker than the other.
//
// `attachmentDir` IS A PARAMETER, so this module carries no `electron` import and unit-tests against
// a temp directory — attachmentSave's and attachmentStore's composition-root seam. The root joins
// ATTACHMENT_DIR_NAME onto `app.getPath('userData')` exactly once and closes the result in here; this
// is that value's third reader, not a fourth join.
//
// THERE IS NO SIZE CEILING ON A READ, and that is a ruling rather than an omission: the bytes are
// already bounded at the only writer into that directory, where `createAttachmentReassembler` refuses
// a declared size over ATTACHMENT_MAX_RETRIEVAL_BYTES and `storeAttachment` is the sole path in. A
// second ceiling on one quantity is the same anti-pattern as a second escape check.
//
// THERE IS A CONCURRENCY CAP, and unlike attachmentSave's that is not optional. Save declines one
// because its copy is kernel-side and accumulates nothing in this process; THESE BYTES DO ENTER THIS
// PROCESS, so save's reasoning does not transfer and createAttachmentRetrieval's does.
//
// IT NEVER REJECTS AND NEVER THROWS. Every path resolves to one terminal, which is what licenses the
// composition root's bare `void` — a property of this module rather than of a `.catch()` anyone must
// remember. No string carrying a path is constructed here at all, and the caught read error is never
// inspected: a node:fs ErrnoException carries the offending path in its own message.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { readFile } from 'node:fs/promises'
import { resolveAttachmentPath } from './attachmentPath'
import type { DiagnosticLog } from './diagnosticLog'
import type { AttachmentBytesEvent, AttachmentBytesRequest } from '../shared/ipc/attachmentBytes'

/**
 * How many attachment reads this client will run at once. The window is UNTRUSTED, and without a cap
 * it could open an unbounded number of concurrent reads simply by asking repeatedly — each holding a
 * whole file in this process until it has crossed the bridge.
 *
 * Four is ATTACHMENT_MAX_CONCURRENT_RETRIEVALS and its ceiling argument exactly: it holds the peak
 * accumulated footprint to 4 × ATTACHMENT_MAX_RETRIEVAL_BYTES (~92 MB) while staying far above the
 * realistic use, which is a handful of images a person is looking at. Raising it raises that ceiling
 * proportionally; that is the trade it encodes.
 */
export const ATTACHMENT_MAX_CONCURRENT_READS = 4

/** The static event name every record from this module carries. */
const LOG_EVENT = 'attachment-bytes'

/** The injected collaborators. `attachmentDir` is a TRUSTED value from the composition root; the
 *  request's one field is UNTRUSTED. Same type, different trust levels, so the distinction can only
 *  be said here. */
export interface AttachmentBytesDeps {
  /** The app-private attachment directory — `join(app.getPath('userData'), ATTACHMENT_DIR_NAME)`,
   *  computed at the root and never derived from anything the window sent. */
  attachmentDir: string
  /** The one content-free logger (#126). Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}

/**
 * Build the read driver: one function the composition root's channel listener calls with an
 * already-guarded ask, answering the terminal outcome.
 *
 * CONSTRUCT IT ONCE FOR THE APP LIFETIME, not per ask. The in-flight count is the only state here and
 * it is only meaningful ACROSS asks, so a per-ask closure would reset it to zero every time and
 * disable the cap silently — createAttachmentRetrieval's own recorded trap.
 *
 * THE TERMINAL IS THE RESOLVED VALUE, not a pushed event, which is createAttachmentSave's shape
 * rather than createAttachmentRetrieval's: "exactly one answer per ask" is then bought by a promise
 * settling once rather than by an invariant to maintain.
 *
 * THERE IS NO COALESCING, and that is the departure from createAttachmentRetrieval. That driver drops
 * a duplicate ask for an id already in flight because the live retrieval's PUSHED terminal names the
 * same id and therefore answers both asks, and because a second concurrent write of one
 * content-addressed file is pointless. Neither holds here: the terminal is a promise returned to one
 * caller, so a dropped duplicate would leave its caller with no answer at all. The state is therefore
 * a plain COUNT, not a map keyed by identifier.
 */
export function createAttachmentBytes(
  deps: AttachmentBytesDeps
): (request: AttachmentBytesRequest) => Promise<AttachmentBytesEvent> {
  const { attachmentDir, diagnosticLog } = deps
  let inFlight = 0

  /** The one exit: log the static code, answer the terminal. */
  function settle(event: AttachmentBytesEvent): AttachmentBytesEvent {
    diagnosticLog?.event({
      event: LOG_EVENT,
      code: event.type === 'delivered' ? 'delivered' : event.reason
    })
    return event
  }

  return async function read(request: AttachmentBytesRequest): Promise<AttachmentBytesEvent> {
    const { attachmentId } = request
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })

    // The identifier gate, BEFORE any filesystem call and BEFORE a slot is taken. Refusing ahead of
    // the cap is deliberate: a refusal costs no memory, so it is answered honestly under pressure
    // rather than reported as `busy`, and a caller spraying malformed identifiers cannot displace a
    // real read. It is also the distinction the window acts on — a refusal is permanent where an
    // absent file is fetched and asked for again.
    const resolved = resolveAttachmentPath(attachmentDir, attachmentId)
    if (!resolved.ok) {
      return settle({ type: 'failed', attachmentId, reason: 'refused' })
    }

    // THE CHECK AND THE INCREMENT MUST STAY IN ONE SYNCHRONOUS BLOCK. Both run before the first
    // suspension point below, so two asks arriving in one tick cannot both observe a free slot —
    // run-to-completion is what makes the bound sound. Moving the increment after the `await` turns
    // this into a check-then-act across a suspension point and the cap silently stops binding.
    if (inFlight >= ATTACHMENT_MAX_CONCURRENT_READS) {
      return settle({ type: 'failed', attachmentId, reason: 'busy' })
    }
    inFlight += 1

    try {
      const contents = await readFile(resolved.path)
      return settle({ type: 'delivered', attachmentId, bytes: exactBytes(contents) })
    } catch {
      // Absent, unreadable, or not a file at all — one reason, because a consumer's answer to every
      // one of them is to fetch the attachment and ask again. The caught object is DROPPED WITHOUT
      // BEING INSPECTED, one step past attachmentSave which still reads its errno: there is nothing
      // to read off it here, and a node:fs ErrnoException carries the offending path in its message.
      //
      // The successful return sits INSIDE this try on purpose: it puts the copy under the same catch,
      // so an allocation failure answers a terminal like any other rather than escaping as a rejected
      // promise and breaking the never-rejects property the composition root's bare `void` rests on.
      return settle({ type: 'failed', attachmentId, reason: 'unavailable' })
    } finally {
      // In a `finally` so the slot is returned on the failure path too — a throwing read must not
      // leak one, or the cap degrades to a permanent `busy` after four bad asks.
      inFlight -= 1
    }
  }
}

/**
 * Copy `view` into a Uint8Array that spans its own ArrayBuffer exactly, and answer that.
 *
 * THIS COPY IS LOAD-BEARING, not tidiness. `fs.readFile` serves any file under 4096 bytes from Node's
 * shared 8 KB buffer pool, so the view it returns is a window into memory holding OTHER, UNRELATED
 * allocations. Structured clone — what carries this value over the IPC bridge — serializes a typed
 * array as its whole backing ArrayBuffer plus an offset and a length, so handing that view straight
 * to the window would copy the entire pool across: up to 8 KB of adjacent main-process heap, in a
 * process that also holds decrypted daemon plaintext. Allocating a fresh buffer of exactly this
 * length is what closes that, and no type and no other assertion would catch its removal — the test
 * that pins `byteOffset === 0` and `buffer.byteLength === length` on a sub-4096-byte file is the only
 * thing standing between here and that leak.
 *
 * Unconditional, rather than copying only in the pooled case. The conditional version is correct —
 * every file at or above 4096 bytes already owns its buffer whole — but it trades a branch whose
 * unsafe arm is the rare one for a memcpy that is negligible against the copy the IPC layer performs
 * on these same bytes regardless.
 */
function exactBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view)
}
