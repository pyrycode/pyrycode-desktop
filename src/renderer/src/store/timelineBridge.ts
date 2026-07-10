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
 * timeline state. Owns exactly the four v2 stream arms (`assistantDelta` / `turnEnd` / `turnState` /
 * `toolUse`, #217); each is reconstructed as a fresh literal with named fields — not `return event`, not a spread
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
    case 'modalShown':
    case 'modalDismissed':
      // No timeline event: the session store (#19), download UI (#72), Run configuration bridge
      // (#181), conversation-list store (#208), and modal store + bridge (#223) consume these — not
      // the timeline store.
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
