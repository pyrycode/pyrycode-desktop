// The renderer data path feeding the background-task store: it observes THREE typed daemon events — the
// `backgroundTaskRoster` aggregate (#566's transport half decodes the `background_task_roster`
// snapshot: `conversationId` plus the live rows and the drop count), the `backgroundTaskStarted`
// scalar (#564: the six fields that open one task, `toolCallId` among them) and the
// `backgroundTaskUpdated` scalar (#565: four fields — the latest patch and its own cut report) — and
// lands each in the app-singleton `backgroundTaskRosterStore` the panel slice (#568) will read, where
// they are JOINED on `conversationId` + `taskId`. Reactive-only — like queueBridge and sessionIdBridge,
// the daemon PUSHES all three unsolicited, so there is NO request half: no command sent, no
// connected-edge fetch. The helpers are React-free and injected, so the whole path is unit-testable
// with plain spies; `BackgroundTaskRosterData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches an already-typed event.
//
// SECURITY: two arms carry untrusted, model-influenced `description` text — for `local_bash` the
// literal command line claude ran — and the third carries a `patch` whose keys may carry the same class
// of text under a structured-looking shape. This path has no DOM sink and runs no JSON.parse; it copies
// named fields and never interprets them. The inert-plain-text obligation binds #568.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import {
  backgroundTaskRosterStore,
  type BackgroundTaskRosterSnapshot,
  type BackgroundTaskStartedSnapshot,
  type BackgroundTaskUpdatedSnapshot
} from './backgroundTaskRosterStore'

/**
 * The roster filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal (the modalBridge / queueBridge idiom — never `return event`, never a spread),
 * which is load-bearing rather than stylistic: a spread would carry the arm's `type` tag, and any field
 * a later arm gains, into a write unit that never agreed to hold it. `tasks` passes through by
 * reference (roster order, identity and snake_case preserved) — the row → held-record mapping happens
 * inside `setRoster`, which is where the prior state the join needs lives, so this translator is
 * behaviourally unchanged by the join.
 *
 * UNCONDITIONAL — there is deliberately no `if (event.tasks.length === 0) return null`. An empty
 * roster is a positive statement that nothing is alive (AC5), never "no news", so it maps to a
 * snapshot like any other; see the `!== null` guard in `subscribeBackgroundTaskRoster`.
 *
 * `default: null` — not an `assertNever` — because ignoring the rest is this path's intended,
 * permanent behavior: it is an independent subscriber in the queueBridge / sessionIdBridge posture,
 * not one of the three typecheck-gating exhaustive bridges (which already no-op these arms from #566).
 * A SIBLING translator owns `backgroundTaskStarted` rather than this one widening its return type into
 * a tagged union: keeping each a pure single-arm filter is the property that kept the `connected` reset
 * out of a translator in #573, and two small filters cost the same executable lines.
 * React-free → unit-testable without a DOM.
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
 * The started filter — the sibling of the translator above, same posture in every respect: one owned
 * arm, a fresh named-field literal, `default: null`, React-free. It copies all six fields the arm
 * carries; `truncatedFields` passes through untouched, so `null` ("nothing was cut") reaches the store
 * as `null` and is never collapsed into `[]` (AC3).
 *
 * `backgroundTaskUpdated` belongs to the THIRD translator below rather than to this one: one owned arm
 * per translator is the posture this bridge keeps, so neither sibling's assertions move when another
 * arm lands.
 */
export function translateBackgroundTaskStarted(
  event: DaemonEvent
): BackgroundTaskStartedSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskStarted':
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
        toolCallId: event.toolCallId,
        taskType: event.taskType,
        description: event.description,
        truncatedFields: event.truncatedFields
      }
    default:
      return null
  }
}

/**
 * The updated filter — the third sibling, same posture again: one owned arm, a fresh named-field
 * literal, `default: null`, React-free. FOUR fields, not six: the arm carries no `toolCallId`, no
 * `description` and no `taskType`, and it gains `patch`.
 *
 * `patch` is copied VERBATIM and never parsed, key-enumerated, or inspected here — it is opaque text
 * that is not guaranteed to be valid JSON (the daemon truncates it at construction). `patch: ''` is a
 * value meaning "claude sent no change" and always arrives, so there is deliberately no
 * `if (event.patch)` anywhere on this path. `truncatedFields` passes through untouched, so `null`
 * ("nothing was cut") reaches the store as `null` and is never collapsed into `[]` (AC3).
 */
export function translateBackgroundTaskUpdated(
  event: DaemonEvent
): BackgroundTaskUpdatedSnapshot | null {
  switch (event.type) {
    case 'backgroundTaskUpdated':
      return {
        conversationId: event.conversationId,
        taskId: event.taskId,
        patch: event.patch,
        truncatedFields: event.truncatedFields
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
 * Both `!== null` guards (never `if (snapshot)`) are deliberate, and the hazard they institutionalise is
 * filtering rather than truthiness — a snapshot object is truthy even when its `tasks` are empty, so the
 * way an empty roster gets dropped is a `length === 0` check at the translator, not here. Keeping the
 * guards on `!== null` and the translators unconditional is what makes the observed-empty case survive
 * the whole path. The three arms are mutually exclusive, so branch ORDER is a readability choice rather
 * than a correctness one and each matched branch returns. Injected `onDaemonEvent` + the four writers
 * keep this React-free and unit-testable with plain spies. The listener only translates + dispatches —
 * it never throws into React.
 */
export function subscribeBackgroundTaskRoster(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void,
  resetRosters: () => void,
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void,
  setUpdatedTask: (snapshot: BackgroundTaskUpdatedSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'connected') {
      resetRosters()
      return
    }
    const snapshot = translateBackgroundTaskRoster(event)
    if (snapshot !== null) {
      setRoster(snapshot)
      return
    }
    const started = translateBackgroundTaskStarted(event)
    if (started !== null) {
      setStartedTask(started)
      return
    }
    const updated = translateBackgroundTaskUpdated(event)
    if (updated !== null) setUpdatedTask(updated)
  })
}

/**
 * The background-task data-path binding — a headless component mounted app-level in App.tsx, alongside
 * QueueData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route flips,
 * because either frame can arrive at any time — including before the #568 panel is ever mounted, and
 * including for a conversation the user is not looking at — so the set must be retained regardless of
 * which screen is shown. A component (not a hook) isolates the subscription in its own leaf so it never
 * cascades a re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the
 * effect, never during render, so it server-renders to `''` without a bridge mock (the QueueData
 * invariant, which App.test's no-window-stub <App/> render depends on). Reactive-only: one subscribe
 * effect, no request effect, no useState/useRef/useSessionStore. Its name and props are unchanged by
 * the join, which is why App.tsx is untouched by this slice.
 */
export function BackgroundTaskRosterData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the queueBridge idiom). Each roster replaces its conversation's
    // held membership; each started frame upserts one task into it; each update records one task's
    // latest patch, or is dropped when it matches none; a connected edge clears every one of them
    // (AC5). All four write paths ride this one listener, dispatched synchronously in arrival order,
    // so there is no gap between reading and writing the store that a concurrent handler could
    // interleave into.
    return subscribeBackgroundTaskRoster(
      window.pyry.onDaemonEvent,
      (snapshot) => backgroundTaskRosterStore.getState().setRoster(snapshot),
      () => backgroundTaskRosterStore.getState().resetRosters(),
      (snapshot) => backgroundTaskRosterStore.getState().setStartedTask(snapshot),
      (snapshot) => backgroundTaskRosterStore.getState().setUpdatedTask(snapshot)
    )
  }, [])

  return null
}
