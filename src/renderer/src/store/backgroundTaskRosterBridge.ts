// The renderer data path feeding the background-task roster store: it observes the typed
// `backgroundTaskRoster` daemon event (#566's transport half decodes the `background_task_roster`
// snapshot and emits it, carrying `conversationId` plus the live rows and the drop count) and lands
// each roster in the app-singleton `backgroundTaskRosterStore` the panel slice (#568) will read.
// Reactive-only — like queueBridge and sessionIdBridge, the daemon PUSHES the roster unsolicited, so
// there is NO request half: no command sent, no connected-edge fetch. The two helpers are React-free
// and injected, so the whole path is unit-testable with plain spies; `BackgroundTaskRosterData` is the
// thin React glue over them. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and dispatches an already-typed event.
//
// SECURITY: the rows carry untrusted, model-influenced `description` text — for
// `task_type: local_bash` the literal command line claude ran. This path has no DOM sink and runs no
// JSON.parse; it passes the rows through by reference and never interprets them. The inert-plain-text
// obligation binds #568.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import {
  backgroundTaskRosterStore,
  type BackgroundTaskRosterSnapshot
} from './backgroundTaskRosterStore'

/**
 * The filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the modalBridge / queueBridge idiom — never `return event`, never a spread),
 * which is load-bearing rather than stylistic here: #574 WIDENS the held entry with the scalar arms'
 * `toolCallId` / `patch`, and a spread would silently start carrying fields this slice never agreed to
 * hold. `tasks` passes through by reference (roster order, identity and snake_case preserved).
 *
 * UNCONDITIONAL — there is deliberately no `if (event.tasks.length === 0) return null`. An empty
 * roster is a positive statement that nothing is alive (AC4), never "no news", so it maps to a
 * snapshot like any other; see the `!== null` guard in `subscribeBackgroundTaskRoster`.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended,
 * permanent behavior: it is an independent subscriber in the queueBridge / sessionIdBridge posture,
 * not one of the three typecheck-gating exhaustive bridges (which already no-op this arm from #566).
 * That includes the two scalar siblings `backgroundTaskStarted` / `backgroundTaskUpdated`, which stay
 * dormant here — they are #574's. React-free → unit-testable without a DOM.
 */
export function translateBackgroundTaskRoster(
  event: DaemonEvent
): BackgroundTaskRosterSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskRoster':
      return {
        conversationId: event.conversationId,
        tasks: event.tasks,
        droppedTasks: event.droppedTasks
      }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`. A `connected` event is the (re)handshake edge (AC5): it
 * `resetRosters()` and returns, so tasks from a previous connection — or a previous PAIRING, since a
 * new pairing always re-handshakes — never appear. THIS BRANCH IS THE SOLE ENFORCEMENT OF AC5: it is
 * why the store is deliberately NOT added to `clearPairingScopedState` (whose docstring excludes stores
 * the `connected` edge already clears), so folding it into the translator or gating it behind a
 * condition would kill the security property silently. The reset reads only the discriminant — it
 * ignores `event.ack`. Nothing repopulates afterwards: rosters are not in the daemon's
 * reconcile-on-connect set and this app advertises no `last_event_id` (#569 owns that gap), so there is
 * no re-send ordering to reason about here.
 *
 * The reset is a separate branch rather than a translator mapping, unlike modalBridge's `reconnected`
 * action: that translator returns members of an ACTION union, where a payload-free member is natural,
 * while this one returns a VALUE (a snapshot). Folding the reset in would force the return type to
 * `Snapshot | 'reset' | null` and destroy the property that the translator is a pure
 * `backgroundTaskRoster`→snapshot filter.
 *
 * The `snapshot !== null` guard (not `if (snapshot)`) is deliberate, and the hazard it institutionalises
 * is filtering rather than truthiness — a snapshot object is truthy even when its `tasks` are empty, so
 * the way an empty roster gets dropped is a `length === 0` check at the translator, not here. Keeping
 * the guard on `!== null` and the translator unconditional is what makes the AC4 clear case survive the
 * whole path. Injected `onDaemonEvent` + `setRoster` + `resetRosters` keep this React-free and
 * unit-testable with plain spies. The listener only translates + dispatches — it never throws into React.
 */
export function subscribeBackgroundTaskRoster(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void,
  resetRosters: () => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'connected') {
      resetRosters()
      return
    }
    const snapshot = translateBackgroundTaskRoster(event)
    if (snapshot !== null) setRoster(snapshot)
  })
}

/**
 * The roster data-path binding — a headless component mounted app-level in App.tsx, alongside
 * QueueData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route flips,
 * because a roster can arrive at any time — including before the #568 panel is ever mounted, and
 * including for a conversation the user is not looking at — so the set must be retained regardless of
 * which screen is shown. A component (not a hook) isolates the subscription in its own leaf so it never
 * cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the
 * effect, never during render, so it server-renders to `''` without a bridge mock (the QueueData
 * invariant, which App.test's no-window-stub <App/> render depends on). Reactive-only: one subscribe
 * effect, no request effect, no useState/useRef/useSessionStore.
 */
export function BackgroundTaskRosterData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the queueBridge idiom). Each roster replaces its conversation's
    // held set via the setter; a connected edge clears every one of them (AC5). Both write paths ride
    // this one listener, dispatched synchronously in arrival order.
    return subscribeBackgroundTaskRoster(
      window.pyry.onDaemonEvent,
      (snapshot) => backgroundTaskRosterStore.getState().setRoster(snapshot),
      () => backgroundTaskRosterStore.getState().resetRosters()
    )
  }, [])

  return null
}
