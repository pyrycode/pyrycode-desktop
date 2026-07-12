// The renderer data path feeding the queue store: it observes the typed `queueState` daemon event
// (#292's transport half decodes the `queue_state` snapshot and emits it, carrying `conversationId`
// plus the enqueue-ordered backlog) and lands each snapshot in the app-singleton `queueStore` the queue
// render slice (#294) reads. Reactive-only — like sessionIdBridge (#259) and unlike conversationListBridge
// (#208), the daemon PUSHES queue_state unsolicited, so there is NO request half: no command sent, no
// connected-edge trigger. (The connect-time snapshot is #197's concern, not this slice's.) The two
// helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// sessionIdBridge idiom); `QueueData` is the thin React glue over them. Nothing here touches keys,
// sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and dispatches an
// already-typed event; the backlog carries only a numeric counter, opaque text, and a timestamp
// (AC5-by-construction).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { queueStore, type QueueSnapshot } from './queueStore'

/**
 * The filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the modalBridge idiom — never `return event`, never a spread) so the path stays
 * immune to the `queueState` arm gaining an unrelated field later; `queued` passes through by reference
 * (enqueue order and identity preserved). `default: null` — not an `assertNever` — because ignoring the
 * rest is this path's intended, permanent behavior: it is the FOURTH independent subscriber (the
 * sessionIdBridge / conversationListBridge posture), not one of the three typecheck-gating exhaustive
 * bridges (which already no-op `queueState` from #292). React-free → unit-testable without a DOM.
 */
export function translateQueueState(event: DaemonEvent): QueueSnapshot | null {
  switch (event.type) {
    case 'queueState':
      return { conversationId: event.conversationId, queued: event.queued }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `queueState` writes its snapshot into the store via
 * `setBacklog`; every unrelated event no-ops. Returns the unsubscribe handle (the daemonEventBridge
 * off-handle idiom) so the React binding can use it as its effect cleanup. The `snapshot !== null`
 * guard (not `if (snapshot)`) is deliberate: an empty `queued: []` snapshot is a real REPLACEMENT (the
 * AC2 clear case), never dropped. Injected `onDaemonEvent` + `setBacklog` keep it React-free and
 * unit-testable with plain spies. The listener only translates + dispatches — it never throws into React.
 */
export function subscribeQueue(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setBacklog: (snapshot: QueueSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = translateQueueState(event)
    if (snapshot !== null) setBacklog(snapshot)
  })
}

/**
 * The queue data-path binding — a headless component mounted app-level in App.tsx, alongside
 * SessionIdData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
 * flips, because a `queue_state` marker can arrive at any time — including before the #294 render slice
 * is ever mounted — so the backlog must be retained regardless of which screen is shown. A component
 * (not a hook) isolates the subscription in its own leaf so it never cascades a re-render into App; it
 * renders nothing. `window.pyry` is dereferenced only inside the effect, never during render, so it
 * server-renders to `''` without a bridge mock (the SessionIdData invariant). Reactive-only: one
 * subscribe effect, no request effect, no useState/useRef/useSessionStore.
 */
export function QueueData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the sessionIdBridge idiom). Each queueState writes its snapshot
    // into the app-singleton store via its setter.
    return subscribeQueue(window.pyry.onDaemonEvent, (snapshot) =>
      queueStore.getState().setBacklog(snapshot)
    )
  }, [])

  return null
}
