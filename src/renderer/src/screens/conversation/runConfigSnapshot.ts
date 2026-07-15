// The Run configuration sheet's data path — framework-free and React-free, co-located with the
// screen and mirroring composerSend.ts / logDataDownload.ts: the effects are injected so the whole
// path is unit-testable with plain spies (no React, no store, no Electron). The React container
// (RunConfigData) is thin glue over these three helpers.
//
// This is the consumer #180 reserved: `translateDaemonEvent` maps `snapshotReceived` to `null`
// (the session store does not hold it), leaving it for the Run configuration render bridge. This
// module (a) requests a fresh snapshot when the sheet opens and (b) writes the arriving fields into
// the run-config store.
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RunConfigSnapshot } from '../../store/runConfigStore'

/**
 * The toDownloadAction analogue: map a `snapshotReceived` event to the three fields, and every other
 * DaemonEvent member to `null` (the filter). Pure, so the "ignores unrelated events" behavior is
 * unit-testable without React. A `default: null` — not an assertNever — because ignoring the rest is
 * the intended, permanent behavior here (this path deliberately consumes only `snapshotReceived`).
 *
 * The fields are copied explicitly (not spread) so the store shape stays immune to `DaemonEvent`
 * gaining an unrelated field later, and the copy is unconditional so empty strings, `yolo: false`,
 * and the `window_tokens: 0` "usage unavailable" signal flow through verbatim — no coercion, no
 * validation, no dropped event (AC5). The two usage figures (#192) map the wire snake_case
 * (`used_tokens` / `window_tokens`) to the store's camelCase.
 */
export function toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null {
  switch (event.type) {
    case 'snapshotReceived':
      return {
        model: event.model,
        effort: event.effort,
        yolo: event.yolo,
        usedTokens: event.used_tokens,
        windowTokens: event.window_tokens
      }
    default:
      return null
  }
}

/**
 * Fire exactly one `requestSnapshot` for the ACTIVE conversation (#448). `conversationId` is the
 * activeConversationStore's id at the container; a null id is a no-op — the daemon validates
 * `conversation_id` (KnownConversation) and replies conversation_not_found for an unknown one, so
 * the readout keeps its "inherited daemon default" placeholders instead of firing a doomed request.
 * The command is an inline literal typed as RendererCommand (no constructor added — keeps the change
 * renderer-contained, per the ticket's "no main-process or IPC change here").
 * Fire-and-forget, like the composer's send: `sendCommand` is `void`, so there is no result to await.
 */
export function requestRunConfigSnapshot(
  conversationId: string | null,
  sendCommand: (command: RendererCommand) => void
): void {
  if (conversationId === null) return
  sendCommand({
    type: 'requestSnapshot',
    payload: { conversation_id: conversationId }
  })
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `snapshotReceived` writes verbatim into the store
 * via `setSnapshot`; every unrelated event no-ops. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup. The
 * listener only dispatches — it never throws into React.
 */
export function subscribeRunConfig(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSnapshot: (snapshot: RunConfigSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = toRunConfigSnapshot(event)
    if (snapshot) setSnapshot(snapshot)
  })
}
