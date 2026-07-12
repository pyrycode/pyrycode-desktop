// The renderer translation half feeding the conversation-timeline store: it turns the two v2
// interactive-stream daemon events (#199) into the matching `ThreadEvent`s (#121) and dispatches
// them into the app-singleton `timelineStore` the render slice (#203) reads. `translateTimelineEvent`
// is the pure choke point; `useTimelineBridge` is its only production caller, wiring the channel into
// React's lifecycle. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches typed events.
//
// The mirror-image of `daemonEventBridge`: that bridge returns `null` for these two stream arms and
// owns the rest; this one owns exactly the two stream arms and returns `null` for everything else —
// two independent subscribers on the same channel.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { timelineStore } from './timelineStore'
import type { ThreadEvent } from './threadTimeline'

/** Compile-time exhaustiveness guard: a new DaemonEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled daemon event: ${JSON.stringify(event)}`)
}

/**
 * Map one typed daemon event to the `ThreadEvent` it produces, or `null` when the event drives no
 * timeline state. Owns exactly the seven timeline arms (`assistantDelta` / `turnEnd` / `turnState` /
 * `toolUse` #217 / `toolResult` #229 / `sessionTransition`→`sessionBoundary` #286 / `stallDetected` #317);
 * each is reconstructed
 * as a fresh literal with named fields — not `return event`, not a spread
 * — so the translator stays immune to a `DaemonEvent` arm gaining an unrelated field later, matching
 * the transport emit's fresh-literal discipline (`daemonConnection.ts:289`). This is a filter, not a
 * rename: the owned arms are field-for-field identical to their `ThreadEvent` counterparts, so there
 * is no field-mapping — just arm selection + fresh copy.
 *
 * Every other arm returns `null` via explicit fall-through cases, then `assertNever` — deliberately
 * NOT a catch-all `default: return null`, which would silently swallow a future arm. The guard is
 * load-bearing: a new `DaemonEvent` arm is then a compile error in both this bridge and
 * `daemonEventBridge` until each decides its mapping.
 */
export function translateTimelineEvent(event: DaemonEvent): ThreadEvent | null {
  switch (event.type) {
    case 'assistantDelta':
      return { type: 'assistantDelta', turnId: event.turnId, seq: event.seq, text: event.text }
    case 'turnEnd':
      return { type: 'turnEnd', turnId: event.turnId, stopReason: event.stopReason }
    case 'turnState':
      // `event.state` is WireTurnState; the ThreadEvent arm expects TurnPhase — the same literal union,
      // so this assigns with no cast and no import of TurnPhase (a rename, not a re-validation).
      return { type: 'turnState', state: event.state }
    case 'toolUse':
      // The tool-call arm (#217). The DaemonEvent and ThreadEvent `toolUse` shapes are field-for-field
      // identical, so this is a filter + fresh copy (arm selection), not a field remap. reduceTimeline
      // folds it into a pending `toolCall` item (result: null) in arrival order (#121).
      return {
        type: 'toolUse',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        name: event.name,
        inputSummary: event.inputSummary
      }
    case 'toolResult':
      // The tool-result arm (#229). Field-for-field identical to its ThreadEvent counterpart, so this is
      // a filter + fresh copy (arm selection), not a field remap. reduceTimeline folds it through
      // `fillResult`, RESOLVING the correlated `toolCall`'s result in place (by toolUseId); an orphan or
      // duplicate is a deterministic same-reference no-op (#121).
      return {
        type: 'toolResult',
        turnId: event.turnId,
        toolUseId: event.toolUseId,
        isError: event.isError,
        resultSummary: event.resultSummary
      }
    case 'sessionTransition':
      // The session-boundary arm (#285 widened it, #286 renders it). The DaemonEvent carries
      // `newSessionId` (the #259 holder's addressing key) beside the three render fields; this drops
      // `newSessionId` and copies the rest into a fresh `sessionBoundary` ThreadEvent — a filter + fresh
      // copy (arm selection), not a field remap, since the render fields are field-for-field identical.
      // `event.reason` is WireSessionTransitionReason; the ThreadEvent arm expects SessionBoundaryReason —
      // the same literal union, so this assigns with no cast (the `turnState` precedent). `workspaceCwd`
      // nullability is preserved verbatim. reduceTimeline folds it into a fresh `sessionBoundary` item in
      // arrival order (#121). The #259 holder is a SEPARATE subscriber on the same channel and still sees
      // this event unchanged — moving it out of the no-op group here does not affect it.
      return {
        type: 'sessionBoundary',
        reason: event.reason,
        workspaceCwd: event.workspaceCwd,
        occurredAt: event.occurredAt
      }
    case 'stallDetected':
      // #317: the stall-onset arm (#315 decodes it nullary). Both the DaemonEvent and the ThreadEvent
      // are `{ type: 'stallDetected' }` — no payload — so this is a filter + fresh literal (arm
      // selection), never a pass-through of the DaemonEvent object. reduceTimeline sets the `stalled`
      // scalar; the render slice's self-clear is derived there on the next turn activity.
      return { type: 'stallDetected' }
    case 'connecting':
    case 'connected':
    case 'disconnected':
    case 'failed':
    case 'messageReceived':
    case 'messagesReceived':
    case 'debugBundleProgress':
    case 'debugBundleSaved':
    case 'debugBundleFailed':
    case 'snapshotReceived':
    case 'conversationsReceived':
    case 'conversationCreated':
    case 'conversationUpdated':
    case 'modalShown':
    case 'modalDismissed':
    case 'sessionSettingsUpdated':
    case 'sessionSettingsRejected':
    case 'modalAnswerRejected':
    case 'queueState':
    case 'screenSnapshotReceived':
      // No timeline event: the session store (#19), download UI (#72), Run configuration bridge
      // (#181), conversation-list store (#208), modal store + bridge (#223, and the #249 rejection
      // render), the create render slice (#242), the #261 / #256 session-settings consumers
      // (confirmed + rejected #269), and the #293 queue store (queueState) consume these — not the
      // timeline store. sessionSettingsUpdated, sessionSettingsRejected, and modalAnswerRejected are
      // NOT timeline items — unlike turnState and, since #286, sessionTransition, none drives a timeline
      // row. queueState is deliberately in this null group: `queue_state` is daemon STATE, not a
      // turn-stream item (#720), so it is NOT folded into reduceTimeline — the load-bearing #720 decision.
      // (stallDetected #315 is now an owned arm — #317 wired its `stalled` scalar above.)
      // screenSnapshotReceived (#316) still ships dormant — its consumer is the display slice #318 (the
      // live-screen view), not the timeline store; it is not a turn-stream `ThreadItem` either.
      return null
    default:
      return assertNever(event)
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each owned arm translates to a `ThreadEvent` and is
 * dispatched, every other arm no-ops. Returns the exact unsubscribe handle from `onDaemonEvent` (the
 * `subscribeRunConfig` idiom) so the React binding can use it as its effect cleanup. Injecting
 * `onDaemonEvent` + `dispatch` keeps it React-free and unit-testable with plain spies. The listener
 * only translates + dispatches — it never throws into React.
 */
export function subscribeTimeline(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: ThreadEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const threadEvent = translateTimelineEvent(event)
    if (threadEvent) dispatch(threadEvent)
  })
}

/**
 * Wire the daemon-event channel into the app-singleton timeline store for the lifetime of the
 * mounting component (#203 mounts it). Subscribes on mount and returns `subscribeTimeline`'s off
 * handle as the effect cleanup, so a StrictMode double-mount runs mount → cleanup → mount and nets
 * exactly one live listener — mirroring `useDaemonEventBridge`. `window.pyry` is dereferenced only
 * inside the effect, never during render.
 */
export function useTimelineBridge(): void {
  useEffect(
    () =>
      subscribeTimeline(window.pyry.onDaemonEvent, (event) =>
        timelineStore.getState().dispatch(event)
      ),
    []
  )
}
