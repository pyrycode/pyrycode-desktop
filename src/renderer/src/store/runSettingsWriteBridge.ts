// The renderer data path for the Run configuration write machine — framework-free helpers plus one
// headless App-level component, mirroring sessionIdBridge.ts. It is bidirectional: an OUTBOUND submit
// helper (mint a correlation id → dispatch the optimistic change → send the `setSessionSettings`
// command) and an INBOUND path (observe the two correlated daemon replies and fold them back into the
// store). The three helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the sessionIdBridge idiom); `RunSettingsWriteData` is the thin React glue over the inbound
// half. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it subscribes through the
// preload bridge and sends one already-typed command; `changeId` is a client-minted, IPC-internal
// correlation key, never a secret and never serialized onto the wire.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RendererCommand } from '@shared/ipc/commands'
import type { SetSessionSettingsPayload } from '@shared/wire/types'
import {
  runSettingsWriteStore,
  type RunSettingsWriteEvent,
  type SettingsChange
} from './runSettingsWriteStore'

/** Compile-time exhaustiveness guard: a new SettingsChange field without a case is a type error. */
function assertNever(x: never): never {
  throw new Error(`Unhandled settings change: ${JSON.stringify(x)}`)
}

/**
 * The inbound filter: map each owned daemon reply to its store event, every other DaemonEvent to
 * `null`. `default: null` — not an `assertNever` — because ignoring the rest is the intended,
 * permanent behavior (this path consumes only the two correlated write replies), mirroring
 * `translateSessionTransition`. Each returns a fresh event carrying only the `changeId` correlation
 * key; a rename of either arm is still caught (a `case` label that no longer overlaps the union is a
 * type error). React-free → unit-testable without a DOM.
 */
export function translateWriteEvent(event: DaemonEvent): RunSettingsWriteEvent | null {
  switch (event.type) {
    case 'sessionSettingsUpdated':
      return { type: 'settingsConfirmed', changeId: event.changeId }
    case 'sessionSettingsRejected':
      return { type: 'settingsRejected', changeId: event.changeId }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned reply runs through `translateWriteEvent` and a
 * non-null result is dispatched into the store; every unrelated event no-ops. Returns the unsubscribe
 * handle (the daemonEventBridge off-handle idiom) so the React binding can use it as its effect
 * cleanup. The listener only dispatches — it never throws into React.
 */
export function subscribeRunSettingsWrite(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: RunSettingsWriteEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const writeEvent = translateWriteEvent(event)
    if (writeEvent !== null) dispatch(writeEvent)
  })
}

/**
 * The effects `submitSettingsChange` performs, injected so the helper stays pure and deterministic in
 * tests. `sessionId` is typed non-null: #257 gates the controls on a present session id (`sessionIdStore`,
 * #259), so there is no null case to guard — the type enforces it. `mintChangeId` defaults to
 * `crypto.randomUUID()` in the app; tests inject a stub (the composerSend `newMessageId` / #236
 * token-mint DI precedent).
 */
export interface SubmitSettingsChangeDeps {
  sessionId: string
  sendCommand: (command: RendererCommand) => void
  dispatch: (event: RunSettingsWriteEvent) => void
  mintChangeId?: () => string
}

/**
 * Build the outbound wire payload for one field change: a FRESH literal with `session_id` plus the
 * SINGLE changed key. A per-field switch narrows `value` to the right type per arm, and only the
 * changed field is present — so the omitempty presence contract (absent = leave unchanged) is honored
 * by construction, and the main-side builder (#263) has nothing extra to drop.
 */
function buildSettingsPayload(sessionId: string, change: SettingsChange): SetSessionSettingsPayload {
  switch (change.field) {
    case 'model':
      return { session_id: sessionId, model: change.value }
    case 'effort':
      return { session_id: sessionId, effort: change.value }
    case 'yolo':
      return { session_id: sessionId, yolo: change.value }
    default:
      return assertNever(change)
  }
}

/**
 * Submit one Model / Effort / YOLO change (#257 calls this). It (1) mints a `changeId`; (2) dispatches
 * `changeDispatched` — RECORD-BEFORE-SEND, so the pending marker + optimistic overlay exist before the
 * reply can race back; (3) sends exactly one `setSessionSettings` command carrying the SAME `changeId`
 * as a top-level sibling of the payload. That shared `changeId` on the store record and the command is
 * the correlation invariant the confirm/reject matches on (pinned by a test). Fire-and-forget like the
 * composer's send: `sendCommand` is `void`, so there is nothing to await.
 */
export function submitSettingsChange(deps: SubmitSettingsChangeDeps, change: SettingsChange): void {
  const changeId = (deps.mintChangeId ?? (() => crypto.randomUUID()))()
  deps.dispatch({ type: 'changeDispatched', changeId, change })
  deps.sendCommand({
    type: 'setSessionSettings',
    payload: buildSettingsPayload(deps.sessionId, change),
    changeId
  })
}

/**
 * The write-machine's inbound data-path binding — a headless component mounted app-level in App.tsx,
 * alongside SessionIdData: one stable, app-lifetime listener, because a confirm/reject reply can arrive
 * AFTER the Run config sheet (#257) closes — a sheet-scoped listener would miss it and strand the
 * pending marker. A component (not a hook) isolates the subscription in its own leaf so it never
 * cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the
 * effect, never during render, so it server-renders to `''` without a bridge mock (the SessionIdData
 * invariant). The returned off handle is the effect cleanup, so a StrictMode double-mount nets exactly
 * one live listener (the daemonEventBridge idiom).
 */
export function RunSettingsWriteData(): null {
  useEffect(() => {
    return subscribeRunSettingsWrite(window.pyry.onDaemonEvent, (event) =>
      runSettingsWriteStore.getState().dispatch(event)
    )
  }, [])

  return null
}
