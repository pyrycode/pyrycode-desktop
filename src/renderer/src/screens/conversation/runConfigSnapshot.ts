// The Run configuration sheet's data path — framework-free and React-free, co-located with the
// screen and mirroring composerSend.ts / logDataDownload.ts: the effects are injected so the whole
// path is unit-testable with plain spies (no React, no store, no Electron). The React container
// (RunConfigData) is thin glue over these three helpers.
//
// It (a) asks for the run configuration when the sheet opens and (b) writes the arriving fields
// into the run-config store AND the session-id store.
//
// #491 moved it off `screen_snapshot`. That reply is a picture of the terminal and carried the run
// configuration as a side-load, so a daemon with no terminal to photograph — which is every daemon
// on the stream-json interactive runner — refused the whole reply and the sheet got nothing. It
// also never carried a session id at all, so even on the terminal runner the controls had no
// address to write to and stayed permanently inert. `request_session_settings` answers both, on
// both runners. The live-screen view that also read it was itself removed (#618-#622).
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RunConfigSnapshot } from '../../store/runConfigStore'

/**
 * The toDownloadAction analogue: map a `runConfigReceived` event to the five display fields, and
 * every other DaemonEvent member to `null` (the filter). Pure, so the "ignores unrelated events"
 * behavior is unit-testable without React. A `default: null` — not an assertNever — because ignoring
 * the rest is the intended, permanent behavior here.
 *
 * The fields are copied explicitly (not spread) so the store shape stays immune to `DaemonEvent`
 * gaining an unrelated field later, and the copy is unconditional so empty strings, `yolo: false`,
 * and the `windowTokens: 0` "usage unavailable" signal flow through verbatim — no coercion, no
 * validation, no dropped event. The two usage figures map the wire snake_case
 * (`used_tokens` / `window_tokens`) to the store's camelCase.
 */
export function toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null {
  switch (event.type) {
    case 'runConfigReceived':
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
 * Fire exactly one `requestSessionSettings` naming `conversationId` — or, when there is no
 * addressable conversation, fire NOTHING (#946).
 *
 * The daemon has answered only the conversation a request names since 2026-08-20
 * (pyrycode#1586/#1610), and it answers an unnamed one with a zero-valued reply rather than an error
 * frame — silently, which is how the sheet spent two weeks inert (#941). #945 gave the frame the
 * field; this supplies it.
 *
 * `conversationId` is REQUIRED, not optional, and that is the point: a caller that forgets to resolve
 * an id must be a compile error, never a silent unnamed request. The two parameters cannot be
 * cross-wired — a function is not assignable to `string | null` — so no named-deps object is needed.
 *
 * NOT SENDING is the whole of the no-conversation branch. An unresolvable request draws the zero
 * reply, and `setSnapshot` replaces the WHOLE snapshot, so a refresh edge that could never have
 * improved the held values would instead wipe them and blank the session id the write controls
 * address. `''` takes the same branch as `null` under one falsy check: it serialises to the identical
 * frame and draws the identical reply, so it is the same failure spelled differently, not a second
 * case. The IPC-boundary guard (`isRequestSessionSettingsPayload`) deliberately still ACCEPTS `''` —
 * it is a structural type check, while refusing to send an unaddressable id is a behavioural
 * decision that belongs here, where a spy can reach it. No renderer spec in this repo can run an
 * effect, so this helper is the only place either mount site's decision is provable.
 *
 * Fire-and-forget, like the composer's send: `sendCommand` is `void`, so there is no result to await.
 */
export function requestRunConfigSnapshot(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string | null
): void {
  if (!conversationId) return
  sendCommand({ type: 'requestSessionSettings', payload: { conversation_id: conversationId } })
}

/**
 * Map a `runConfigReceived` event to its session id, and every other DaemonEvent member to `null`.
 *
 * The `!== null` discipline is deliberate and matches sessionIdBridge's: `''` is a real value the
 * daemon emitted, meaning "I have no session to address", and it is held VERBATIM rather than
 * dropped. A truthiness check here would silently swallow it and leave a stale id in the store, so
 * the sheet would stay operable and address a session the daemon just said it cannot resolve. The
 * gate — isAddressableSessionId, in runSettingsControls — is what turns '' into an inert sheet.
 */
export function toSnapshotSessionId(event: DaemonEvent): string | null {
  switch (event.type) {
    case 'runConfigReceived':
      return event.sessionId
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `runConfigReceived` writes verbatim into BOTH the
 * run-config store and the session-id store; every unrelated event no-ops. Returns the unsubscribe
 * handle (the daemonEventBridge off-handle idiom) so the React binding can use it as its effect
 * cleanup. The listener only dispatches — it never throws into React.
 *
 * One listener feeds both setters, deliberately. The two values arrive on the SAME frame and are
 * only meaningful together: the values describe the session the id names. Splitting them across two
 * subscriptions would allow a state where the sheet shows one session's values while addressing
 * another.
 *
 * This is the SECOND ingress into the session-id store. The first, sessionIdBridge, consumes the
 * unsolicited session_transition marker and remains reactive-only. Neither source is preferred:
 * arrival order wins, which is the store's existing contract. Preferring the marker would be wrong
 * after an eviction (it mirrors the PREVIOUS id, so the next read here is the only correct value);
 * preferring this route would be wrong after a /clear (the marker carries the genuinely newer id
 * while this sheet sits open with a stale one).
 */
export function subscribeRunConfig(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSnapshot: (snapshot: RunConfigSnapshot) => void,
  setSessionId: (sessionId: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = toRunConfigSnapshot(event)
    if (snapshot) setSnapshot(snapshot)
    const sessionId = toSnapshotSessionId(event)
    if (sessionId !== null) setSessionId(sessionId)
  })
}
