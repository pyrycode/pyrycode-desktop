// The workspace-file-read flow (#1626) — the composition-root consumer that turns one renderer ask
// into a `read_workspace_file` frame, receives the verified bytes the transport reassembles, decodes
// them as UTF-8 and pushes exactly one terminal to the window that asked. attachmentRetrieval.ts is the
// structural model: a process-lifetime driver, a per-ask emit, a concurrency cap answered `busy`.
//
// Two deliberate departures. NO COALESCING: every ask sends a fresh frame, because the reader's
// Refresh asks for the same path again to see the file as it is now, and nothing is cached between
// asks. And NOTHING IS STORED: the bytes are decoded in memory and the text goes only to `emit`.
//
// INFORMATION-MINIMISING BOUNDARY. The path is untrusted (an assistant-written link target) and names
// host layout. It goes only into the wire payload: never resolved, never a local path, never logged,
// never on an event. The log carries a static event name and a static code; the events carry the
// window's own request key, and the text or a client-owned failure literal.
//
// MAIN-PROCESS ONLY, Electron-free and unit-testable: the composition root injects the transport call
// and a sender-closed emit. NEVER THROWS OR REJECTS.
//
// Imported by relative path: src/main has no @shared alias (tsconfig.node.json).
import { ATTACHMENT_MAX_CONCURRENT_RETRIEVALS } from './attachmentRetrieval'
import type { AttachmentRetrievalConsumer } from './daemonConnection'
import type { DiagnosticLog } from './diagnosticLog'
import type {
  WorkspaceFileReadEvent,
  WorkspaceFileReadRequest
} from '../shared/ipc/workspaceFileRead'
import type { ReadWorkspaceFilePayload } from '../shared/wire/types'

/** The static event name every record from this module carries. */
const LOG_EVENT = 'workspace-file-read'

/**
 * Build the read driver: one function the composition root's channel listener calls with an
 * already-guarded ask and the way back to the window that sent it.
 *
 * The cap is the retrieval leg's figure, counted separately: a read holds the same per-transfer
 * accumulation bound, and the window is untrusted, so without a count it could open unbounded reads.
 */
export function createWorkspaceFileRead(deps: {
  /** daemonConnection.readWorkspaceFile, routed by conversation. Never throws; settles once. */
  readWorkspaceFile: (payload: ReadWorkspaceFilePayload, consumer: AttachmentRetrievalConsumer) => void
  /** The one content-free logger. Optional: the flow is correct without it. */
  diagnosticLog?: DiagnosticLog
}): (ask: WorkspaceFileReadRequest, emit: (event: WorkspaceFileReadEvent) => void) => void {
  const { readWorkspaceFile, diagnosticLog } = deps
  let inFlight = 0

  return function read(ask, emit): void {
    const { requestKey } = ask
    if (inFlight >= ATTACHMENT_MAX_CONCURRENT_RETRIEVALS) {
      diagnosticLog?.event({ event: LOG_EVENT, code: 'busy' })
      emit({ type: 'failed', requestKey, reason: 'busy' })
      return
    }
    inFlight += 1
    diagnosticLog?.event({ event: LOG_EVENT, code: 'started' })

    // Per-ask, so a transport that settled twice could not release a second slot or push a second
    // terminal. The transport promises one terminal; this makes the count's soundness local.
    let settled = false
    function settle(event: WorkspaceFileReadEvent): void {
      if (settled) return
      settled = true
      // Released BEFORE the emit, so a synchronous re-ask from a listener finds the slot free.
      inFlight -= 1
      diagnosticLog?.event({
        event: LOG_EVENT,
        code: event.type === 'loaded' ? 'loaded' : event.reason
      })
      emit(event)
    }

    readWorkspaceFile(
      // A fresh literal in the wire's field names: the request key and any smuggled key stay here.
      { conversation_id: ask.conversationId, path: ask.path },
      {
        complete: (bytes) => {
          let text: string
          try {
            // `fatal` makes invalid UTF-8 throw rather than decode to U+FFFD. The caught object is
            // dropped: nothing in it is worth reporting, and the reason says what happened.
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          } catch {
            settle({ type: 'failed', requestKey, reason: 'not-text' })
            return
          }
          settle({ type: 'loaded', requestKey, text })
        },
        fail: (reason) =>
          settle({
            type: 'failed',
            requestKey,
            // The transport never produces `store-failed` on this leg (it comes only from the
            // retrieval flow's own write). Collapsed rather than forwarded, so the event type stays
            // honest about a leg that writes nothing.
            reason: reason === 'store-failed' ? 'daemon-error' : reason
          })
      }
    )
  }
}
