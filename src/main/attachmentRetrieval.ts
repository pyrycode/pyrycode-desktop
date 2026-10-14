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
// content. The only fields that ever reach `emit` are the CLIENT-OWNED failure literal and
// scope identifiers THE WINDOW ITSELF NAMED — never a filename, a media type, a digest, a host path, the
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
import type { DaemonConnection } from './daemonConnection'
import type { ServerTarget } from './serverRouter'
import type {
  AttachmentRetrievalEvent,
  AttachmentRetrievalRequest
} from '../shared/ipc/attachmentRetrieval'
import type { StoreAttachmentResult } from './attachmentStore'
import type { DiagnosticLog } from './diagnosticLog'

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

/** Resolved connections are captured before admission; renderer hints never choose a wire directly. */
export interface AttachmentRetrievalDeps {
  resolve: (ask: AttachmentRetrievalRequest) => ServerTarget<Pick<DaemonConnection, 'requestAttachment'>> | null
  store: (attachmentId: string, bytes: Uint8Array) => Promise<StoreAttachmentResult>
  diagnosticLog?: DiagnosticLog
}

export type AttachmentRetrievalEmit = (event: AttachmentRetrievalEvent) => void

/** One process-lifetime cap; a slot owns its transport, storage and original requesting windows. */
export function createAttachmentRetrieval(
  deps: AttachmentRetrievalDeps
): (request: AttachmentRetrievalRequest, emit: AttachmentRetrievalEmit) => void {
  const { resolve, store, diagnosticLog } = deps
  const inFlight = new Map<string, Array<{
    emit: AttachmentRetrievalEmit
    serverId: string | undefined
    reply: AttachmentRetrievalEmit
  }>>()

  return (ask, emit): void => {
    // Only caller-supplied scope is echoed. Resolved ownership stays in the live entry's key.
    const scope = { conversationId: ask.conversationId, attachmentId: ask.attachmentId,
      ...(ask.serverId === undefined ? {} : { serverId: ask.serverId }) }
    const reply = (event: AttachmentRetrievalEvent): void => emit({ ...event, ...scope })
    const refuse = (reason: 'not-connected' | 'busy'): void => {
      diagnosticLog?.event({ event: LOG_EVENT, code: reason })
      reply({ type: 'failed', attachmentId: ask.attachmentId, reason })
    }
    const target = resolve(ask)
    if (target === null) { refuse('not-connected'); return }
    const key = JSON.stringify([target.serverId, ask.conversationId, ask.attachmentId])
    const existing = inFlight.get(key)
    if (existing !== undefined) {
      if (!existing.some(recipient => recipient.emit === emit && recipient.serverId === ask.serverId)) {
        existing.push({ emit, serverId: ask.serverId, reply })
      }
      return
    }
    if (inFlight.size >= ATTACHMENT_MAX_CONCURRENT_RETRIEVALS) { refuse('busy'); return }
    const replies = [{ emit, serverId: ask.serverId, reply }]
    inFlight.set(key, replies)
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })
    let transportSettled = false
    const settle = (event: AttachmentRetrievalEvent): void => {
      inFlight.delete(key)
      diagnosticLog?.event({ event: LOG_EVENT, code: event.type === 'completed' ? 'completed' : event.reason })
      for (const recipient of replies) recipient.reply(event)
    }
    target.connection.requestAttachment(
      { conversation_id: ask.conversationId, attachment_id: ask.attachmentId },
      {
        complete: bytes => {
          if (transportSettled) return
          transportSettled = true
          // Hold the slot through persistence. Rejected errors are dropped because they can carry paths.
          void store(ask.attachmentId, bytes).then(result => settle(result.ok
            ? { type: 'completed', attachmentId: ask.attachmentId }
            : { type: 'failed', attachmentId: ask.attachmentId, reason: 'store-failed' }),
          () => settle({ type: 'failed', attachmentId: ask.attachmentId, reason: 'store-failed' }))
        },
        fail: reason => {
          if (transportSettled) return
          transportSettled = true
          settle({ type: 'failed', attachmentId: ask.attachmentId, reason })
        }
      }
    )
  }
}
