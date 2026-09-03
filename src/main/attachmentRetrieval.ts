// The attachment-retrieval orchestrator (#996) — the composition-root consumer that turns one
// renderer ask into a request frame, routes the answering stream into #995's reassembler, puts the
// verified file on this machine, and reports exactly one terminal to the window. It is the slice that
// joins the retrieval leg together: the wire contract (#993), the recognition layer (#998/#999) and
// the reassemble-and-store path (#995) all landed unwired, and nothing asked the host for anything
// until this module existed.
//
// debugBundleDownload.ts IS THE STRUCTURAL MODEL, with two deliberate departures. Copied: the
// per-request consumer, `complete` routed to persistence with the SAVE's settlement as the terminal,
// `fail` collapsed onto one event, an injected `emit` as the only IPC touch. NOT copied: it is
// single-in-flight and this is not (two attachments can be fetched at once), and its terminal
// `debugBundleSaved` CARRIES A PATH where this one must not — attachmentStore.ts's docblock is
// explicit that the path it returns is a return value for #814/#866/#867 to consume, not something
// to forward or log.
//
// INFORMATION-MINIMISING BOUNDARY. The renderer is untrusted and the retrieved file is a user's
// content. The only fields that ever reach `emit` are the CLIENT-OWNED failure literal and the
// `attachmentId` THE WINDOW ITSELF NAMED — never a filename, a media type, a digest, a host path, the
// local path, a byte count, or daemon message text. `complete`'s bytes go only to `store` (disk).
//
// MAIN-PROCESS ONLY, but Electron-free and unit-testable: the composition root injects the three live
// deps (daemonConnection.requestAttachment, a baseDir-closed storeAttachment, a sender-closed push on
// ATTACHMENT_RETRIEVAL_EVENT_CHANNEL). It holds a user's decrypted file bytes for the length of one
// `store` call, so it must never be re-exported through a renderer barrel.
//
// NEVER REJECTS. Every path resolves, which is what licenses the composition root's bare `void` call
// — a property of this module rather than of a `.catch()` anyone must remember.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import type { AttachmentRetrievalConsumer } from './daemonConnection'
import type {
  AttachmentRetrievalEvent,
  AttachmentRetrievalRequest
} from '../shared/ipc/attachmentRetrieval'
import type { StoreAttachmentResult } from './attachmentStore'
import type { DiagnosticLog } from './diagnosticLog'
import type { RequestAttachmentPayload } from '../shared/wire/types'

/**
 * How many retrievals this client will run at once. The window is UNTRUSTED, and without a cap it
 * could open an unbounded number of concurrent retrievals simply by naming distinct identifiers —
 * which voids the per-transfer memory bound `createAttachmentReassembler` exists to enforce, since
 * that bound only bounds anything multiplied by a bounded count.
 *
 * Four holds the peak accumulated footprint to 4 × ATTACHMENT_MAX_RETRIEVAL_BYTES (~92 MB; ~132 MB
 * against a host that ignores its own declared `size`, per #995's aggregate-footprint note) while
 * staying far above the realistic use, which is one file at a time because a person clicked it.
 * Raising it raises that ceiling proportionally; that is the trade it encodes.
 */
export const ATTACHMENT_MAX_CONCURRENT_RETRIEVALS = 4

/** The static event name every record from this module carries. */
const LOG_EVENT = 'attachment-fetch'

/** The injected collaborators, all Electron-free so the flow unit-tests without a window. */
export interface AttachmentRetrievalDeps {
  /** Ask the host and arm the reassembler — daemonConnection.requestAttachment. Never throws, and
   *  settles the consumer exactly once. */
  requestAttachment: (
    payload: RequestAttachmentPayload,
    consumer: AttachmentRetrievalConsumer
  ) => void
  /** Put the verified file on this machine — a `baseDir`-closed storeAttachment. Documented never to
   *  throw; the rejection path here is a backstop, not a live branch. */
  store: (attachmentId: string, bytes: Uint8Array) => Promise<StoreAttachmentResult>
  /** The one content-free logger (#126). Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}

/** The one path back to the window that asked: a `sender`-closed push on
 *  ATTACHMENT_RETRIEVAL_EVENT_CHANNEL. */
export type AttachmentRetrievalEmit = (event: AttachmentRetrievalEvent) => void

/**
 * Build the retrieval driver: a single function the composition root's channel listener calls with an
 * already-guarded ask and the way back to the window that sent it.
 *
 * THE DRIVER IS PROCESS-LIFETIME AND THE `emit` IS PER-ASK, which is the one structural difference
 * from `createDebugBundleDownload`. Its state — the concurrency cap and the coalescing — is only
 * meaningful across asks, so it cannot be rebuilt per ask; and the answer must go back to the window
 * that asked, so `event.sender` cannot be closed in at construction. Carrying the emit per ask is
 * what reconciles the two, and it keeps that routing inside the module a test can drive rather than
 * as a correlation map in the untested composition root.
 *
 * State is one `Map<string, AttachmentRetrievalEmit>` keyed by attachment id, and it does four jobs at
 * once. It bounds concurrency (above). It coalesces a duplicate ask for an id already in flight —
 * which starts nothing and reports nothing, because the live retrieval's terminal names that same id
 * and therefore answers both asks, and because a second concurrent write of one content-addressed
 * file is pointless work. It is what makes `attachmentId` a sound correlation key for the window: at
 * most one retrieval per id is live, so an event naming one is unambiguous. And it holds the asker's
 * emit, so a terminal reaches the window that started the retrieval rather than whichever asked last.
 *
 * The entry is held ACROSS the asynchronous store and released only at the terminal —
 * debugBundleDownload's "holding the flag across the save" argument, which is what closes the window
 * in which a duplicate ask would race the first one's write.
 */
export function createAttachmentRetrieval(
  deps: AttachmentRetrievalDeps
): (request: AttachmentRetrievalRequest, emit: AttachmentRetrievalEmit) => void {
  const { requestAttachment, store, diagnosticLog } = deps
  const inFlight = new Map<string, AttachmentRetrievalEmit>()

  /** The one exit: release the slot, log the static code, push the terminal to the ORIGINAL asker. */
  function settle(attachmentId: string, event: AttachmentRetrievalEvent): void {
    const emit = inFlight.get(attachmentId)
    // Released BEFORE the emit, so a synchronous re-ask from a listener finds a free slot rather than
    // one held by a retrieval that has already finished (failBundleStream's release-then-fail order).
    inFlight.delete(attachmentId)
    diagnosticLog?.event({
      event: LOG_EVENT,
      code: event.type === 'completed' ? 'completed' : event.reason
    })
    emit?.(event)
  }

  return function request(ask: AttachmentRetrievalRequest, emit: AttachmentRetrievalEmit): void {
    const { attachmentId } = ask
    // A duplicate ask is a TOTAL no-op: nothing sent, no outcome reported, and the ORIGINAL asker's
    // emit is left in place. Checked before the cap so a re-ask for a live retrieval is never
    // mistaken for pressure on the limit.
    if (inFlight.has(attachmentId)) return
    if (inFlight.size >= ATTACHMENT_MAX_CONCURRENT_RETRIEVALS) {
      // Refused before the transport is touched, so no reassembler is armed and nothing accumulates.
      // Answered on the REFUSED ask's own emit — there is no entry to look one up from.
      diagnosticLog?.event({ event: LOG_EVENT, code: 'busy' })
      emit({ type: 'failed', attachmentId, reason: 'busy' })
      return
    }
    inFlight.set(attachmentId, emit)
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })

    requestAttachment(
      // A fresh literal in the wire's own field names. The ask's two fields are camelCase because it
      // is a client-internal IPC contract; rebuilding rather than remapping in place is what keeps a
      // smuggled renderer key off the envelope (createConversation's posture).
      { conversation_id: ask.conversationId, attachment_id: attachmentId },
      {
        // Synchronous, but the terminal is the STORE's outcome, not this call: the window must not be
        // told the file is on this machine before it is. Holding the slot across the store is what
        // closes that async window.
        complete: (bytes) => {
          void store(attachmentId, bytes).then(
            (result: StoreAttachmentResult) => {
              settle(
                attachmentId,
                result.ok
                  ? { type: 'completed', attachmentId }
                  : { type: 'failed', attachmentId, reason: 'store-failed' }
              )
            },
            () => {
              // storeAttachment is documented never to throw, so this is a backstop rather than a
              // live branch — but a contract is not a guarantee and an unhandled main-process
              // rejection is exactly what must not happen here. The caught object is DROPPED: an fs
              // ErrnoException carries the offending path in its own message.
              settle(attachmentId, { type: 'failed', attachmentId, reason: 'store-failed' })
            }
          )
        },
        // Forwarded verbatim — no second mapping layer. The transport already produced a client-owned
        // literal, and collapsing it further here would erase the distinction AC3 asks for between
        // the two published reject codes.
        fail: (reason) => settle(attachmentId, { type: 'failed', attachmentId, reason })
      }
    )
  }
}
