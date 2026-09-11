// The renderer data path for the Run configuration write machine — framework-free helpers plus one
// headless App-level component, mirroring sessionIdBridge.ts. It is bidirectional: an OUTBOUND submit
// helper (mint a correlation id → dispatch the optimistic change → send the `setSessionSettings`
// command) and an INBOUND path (observe the two correlated daemon replies, plus the reconnect edge that
// strands them, and fold them back into the store). The three helpers are React-free and injected, so
// the whole path is unit-testable with plain spies (the sessionIdBridge idiom); `RunSettingsWriteData`
// is the thin React glue over the inbound half.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it subscribes through the
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
import { lastEffortStore } from './lastEffortStore'
import type { StoreApi } from 'zustand/vanilla'
import type { RunSettingsWriteStore } from './runSettingsWriteStore'
import { conversationTimelineStore, type ConversationTimelineStore } from './conversationTimelineStore'
import { activeConversationStore } from './activeConversationStore'

/** Compile-time exhaustiveness guard: a new SettingsChange field without a case is a type error. */
function assertNever(x: never): never {
  throw new Error(`Unhandled settings change: ${JSON.stringify(x)}`)
}

/**
 * The inbound filter: map each owned daemon event to its store event, every other DaemonEvent to
 * `null`. `default: null` — not an `assertNever` — because ignoring the rest is the intended,
 * permanent behavior (this path consumes three of them: the two correlated write replies plus the
 * connection edge), mirroring `translateSessionTransition`. Each returns a fresh event; the two replies
 * carry only the `changeId` correlation key and the connection edge carries nothing at all. A rename of
 * any arm is still caught (a `case` label that no longer overlaps the union is a type error).
 * React-free → unit-testable without a DOM.
 */
export function translateWriteEvent(event: DaemonEvent): RunSettingsWriteEvent | null {
  switch (event.type) {
    case 'sessionSettingsUpdated':
      return { type: 'settingsConfirmed', changeId: event.changeId }
    case 'sessionSettingsRejected':
      return { type: 'settingsRejected', changeId: event.changeId }
    case 'connected':
      // #539: main abandons its envelope-id → changeId correlation on every re-dial and emits no
      // rejections, so an in-flight change's reply can never arrive. Flip the (re)handshake edge to the
      // payload-free clear that drops the stranded pending markers before they outlive a later confirmed
      // change. Ignores `event.ack` (HelloAckPayload) — the clear needs no field off it. `connected` and
      // not `disconnected`, which is emitted nowhere in src/main (the modalBridge.ts:61 precedent).
      return { type: 'reconnected' }
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
 *
 * The single-key shape is also what keeps `permission_mode` and `yolo` off one frame (#1021), which the
 * daemon refuses as malformed since they are two spellings of one posture. Nothing enforces that here
 * because nothing has to: a switch returning one literal per arm cannot emit both. Nothing may be added
 * that would.
 *
 * This is also the ONE place the camelCase renderer/IPC spelling (`permissionMode`, the #1020 seam)
 * becomes the snake_case wire key (`permission_mode`). The value crosses VERBATIM — no allowlist, no
 * normalisation, no repair, and no mapping onto the `yolo` bit; `validPermissionMode` is the daemon's.
 */
function buildSettingsPayload(sessionId: string, change: SettingsChange): SetSessionSettingsPayload {
  switch (change.field) {
    case 'model':
      return { session_id: sessionId, model: change.value }
    case 'effort':
      return { session_id: sessionId, effort: change.value }
    case 'yolo':
      return { session_id: sessionId, yolo: change.value }
    case 'permissionMode':
      return { session_id: sessionId, permission_mode: change.value }
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
 * #1169 — the level to REMEMBER, or `null`. Non-null only when the event is a `settingsConfirmed` whose
 * `changeId` matches a pending record for the `effort` field carrying a non-empty value.
 *
 * REMEMBER ON CONFIRM, NOT ON PICK: a rejected level is not a level that was used. And this is the ONLY
 * seam where the confirmed VALUE is recoverable at all — `sessionSettingsUpdated` carries only the
 * correlation key (the daemon's ack names no field), and `reduceRunSettingsWrite` deletes the pending
 * record in the same step as it commits, so after the dispatch there is nothing left to read. Hence the
 * pending map is a parameter here and `foldWriteEvent` below reads it first.
 *
 * The no-match arm is the store's own fail-closed rule reused rather than restated: an uncorrelated
 * confirm commits nothing there, so it remembers nothing here. That is also what closes a REPLAYED ack
 * from the content-blind relay — the second copy matches no pending record.
 *
 * `''` is refused: it is the wire's absence of a level (`SessionSettingsPayload.effort`, the inherited
 * daemon default), never a level, so a confirm carrying it is not a level that was used. No path in this
 * app submits one; this guards the shape rather than an observed frame.
 */
export function confirmedEffortLevel(
  pending: ReadonlyMap<string, SettingsChange>,
  event: RunSettingsWriteEvent
): string | null {
  if (event.type !== 'settingsConfirmed') return null
  const change = pending.get(event.changeId)
  if (change === undefined || change.field !== 'effort' || change.value === '') return null
  return change.value
}

/**
 * The effects `foldWriteEvent` performs, injected so the helper stays pure and deterministic in tests.
 * `getPending` is `runSettingsWriteStore.getState().pending`, `dispatch` is that store's `dispatch`, and
 * `rememberEffort` is `lastEffortStore`'s `setLastEffort`.
 *
 * `getPending` is a GETTER rather than a threaded value for the reason the ordering below states: it must
 * be sampled at fold time, immediately before the dispatch that empties it.
 */
export interface FoldWriteEventDeps {
  getPending: () => ReadonlyMap<string, SettingsChange>
  dispatch: (event: RunSettingsWriteEvent) => void
  rememberEffort: (level: string) => void
}

/**
 * Fold one store event in: resolve what would be remembered, dispatch, then remember it.
 *
 * THE ORDER IS THE WHOLE HELPER, and it is pinned by a named test. `settingsConfirmed` deletes the
 * pending record as it commits, so a read placed after the dispatch would find an emptied map and
 * remember nothing — a change that compiles, dispatches the same events the same number of times, passes
 * every count assertion, and silently persists nothing at all.
 *
 * Remembering AFTER the dispatch rather than before is deliberate too, though it is not load-bearing:
 * the store is the app's source of truth for the change, and the preference is a consequence of it, so
 * the writes run in the order a reader expects. Both are synchronous, so no observer sees between them.
 */
export function foldWriteEvent(deps: FoldWriteEventDeps, event: RunSettingsWriteEvent): void {
  const level = confirmedEffortLevel(deps.getPending(), event)
  deps.dispatch(event)
  if (level !== null) deps.rememberEffort(level)
}

/** Observe live edges, never held model readings or history. Both subscriptions share app lifetime. */
export function subscribeRefusalRecovery(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  writes: StoreApi<RunSettingsWriteStore>,
  timelines: StoreApi<ConversationTimelineStore>,
  getOpenId: () => string | null,
  log?: (code: string) => void
): () => void {
  const offWrites = writes.subscribe((next, previous) => {
    const id = getOpenId()
    if (id === null) return
    for (const [changeId, change] of next.pending) {
      if (change.field === 'model' && !previous.pending.has(changeId)) {
        timelines.getState().dispatchFor(id, { type: 'refusalModelSelected', changeId })
      }
    }
  })
  const offEvents = onDaemonEvent(event => {
    const state = timelines.getState()
    if (event.type === 'modelAnnounced' || event.type === 'sessionTransition') {
      if (!state.timelines.get(event.conversationId)?.timeline.refusalOffer) return
      state.dispatchFor(event.conversationId, event.type === 'modelAnnounced'
        ? { type: 'refusalModelAnnounced', model: event.model } : { type: 'refusalSessionReplaced' })
    } else if (event.type === 'sessionSettingsUpdated' || event.type === 'sessionSettingsRejected' || event.type === 'connected') {
      for (const [id, slice] of state.timelines) {
        if (slice.timeline.refusalOffer === undefined) continue
        if (event.type !== 'connected' && slice.timeline.refusalOffer.changeId === event.changeId) {
          log?.(event.type === 'sessionSettingsUpdated' ? 'confirmed' : 'rejected')
        }
        state.dispatchFor(id, event.type === 'connected' ? { type: 'refusalWriteAbandoned' }
          : { type: 'refusalWriteSettled', changeId: event.changeId, confirmed: event.type === 'sessionSettingsUpdated' })
      }
    }
  })
  return () => { offWrites(); offEvents() }
}

/**
 * The write-machine's inbound data-path binding — a headless component mounted app-level in App.tsx,
 * alongside SessionIdData: one stable, app-lifetime listener, because a confirm/reject reply can arrive
 * AFTER the Run config sheet (#257) closes — a sheet-scoped listener would miss it and strand the
 * pending marker. That rationale now covers the `connected` clear (#539) for free: the reconnect edge
 * fires whether or not the sheet is open. A component (not a hook) isolates the subscription so it never
 * cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the
 * effect, never during render, so it server-renders to `''` without a bridge mock (the SessionIdData
 * invariant). The returned off handle is the effect cleanup, so a StrictMode double-mount nets exactly
 * one live listener (the daemonEventBridge idiom).
 */
export function RunSettingsWriteData(): null {
  useEffect(() => subscribeRefusalRecovery(
    window.pyry.onDaemonEvent, runSettingsWriteStore, conversationTimelineStore,
    () => activeConversationStore.getState().activeConversation?.id ?? null,
    code => window.pyry.sendDiagnostic({ event: 'refusal-recovery', code })
  ), [])
  useEffect(() => {
    // #1169: the fold, not a bare dispatch. Every reply still reaches the store exactly as before; the
    // one addition is that an effort confirm also writes the level to the renderer-local preference.
    // `getState()` PER EVENT, never captured at subscription: this listener is app-lifetime, so a
    // snapshot of `pending` taken here would freeze at whatever was in flight when App mounted.
    return subscribeRunSettingsWrite(window.pyry.onDaemonEvent, (event) =>
      foldWriteEvent(
        {
          getPending: () => runSettingsWriteStore.getState().pending,
          dispatch: runSettingsWriteStore.getState().dispatch,
          rememberEffort: lastEffortStore.getState().setLastEffort
        },
        event
      )
    )
  }, [])

  return null
}
