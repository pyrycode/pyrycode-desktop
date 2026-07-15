// The renderer data path feeding the session-id store: it observes the typed `sessionTransition`
// daemon event (#254's transport half already decodes the `session_transition` marker and emits it,
// renaming `new_session_id` → `newSessionId`) and lands its id in the app-singleton `sessionIdStore`
// the Run configuration controls (#257) read. Reactive-only — unlike conversationListBridge (#208)
// and runConfigSnapshot (#187), the daemon *pushes* markers unsolicited, so there is NO request half:
// no command sent, no connected-edge trigger, no snapshot request. The two helpers
// are React-free and injected, so the whole path is unit-testable with plain spies (the
// conversationListBridge idiom); `SessionIdData` is the thin React glue over them. Nothing here
// touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge
// and dispatches an already-typed event, retaining a routing id, never a secret (AC4).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { sessionIdStore } from './sessionIdStore'

/**
 * The filter: map the one owned arm to its id, every other DaemonEvent to `null`. `default: null` —
 * not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this
 * path deliberately consumes only `sessionTransition`), mirroring `translateConversationsEvent` /
 * `toRunConfigSnapshot`. Returns `event.newSessionId` directly: selecting a single named field is a
 * filter, not a field-remap, so there is no fresh-literal reconstruction to do — a rename of the arm
 * is still caught (a `case` label that no longer overlaps the union is a type error). React-free →
 * unit-testable without a DOM (AC2 last-write-wins and AC3 ignore-unrelated).
 */
export function translateSessionTransition(event: DaemonEvent): string | null {
  switch (event.type) {
    case 'sessionTransition':
      return event.newSessionId
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `sessionTransition` writes its id verbatim into
 * the store via `setSessionId`; every unrelated event no-ops. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup. The
 * `id !== null` guard (not `if (id)`) is deliberate: it mirrors conversationListBridge's `list !==
 * null` — here `if (id)` would silently drop an empty-string session_id, but the holder holds the
 * daemon's value verbatim (AC4, no coercion), so an empty `newSessionId` is still recorded. The
 * listener only dispatches — it never throws into React.
 */
export function subscribeSessionId(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSessionId: (id: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const id = translateSessionTransition(event)
    if (id !== null) setSessionId(id)
  })
}

/**
 * The session-id data-path binding — a headless component mounted app-level in App.tsx, alongside
 * ConversationListData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the
 * route flips, because a `session_transition` marker can arrive at any time — including before the Run
 * config sheet (#257) is ever mounted — so the id must be retained regardless of which screen is
 * shown. A component (not a hook) isolates the subscription in its own leaf so it never cascades a
 * re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never
 * during render, so it server-renders to `''` without a bridge mock (the ConversationListData
 * invariant). Reactive-only: one subscribe effect, no request effect, no useState/useRef/useSessionStore.
 */
export function SessionIdData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the daemonEventBridge idiom). Each sessionTransition writes its
    // id into the app-singleton store via its setter.
    return subscribeSessionId(window.pyry.onDaemonEvent, (id) =>
      sessionIdStore.getState().setSessionId(id)
    )
  }, [])

  return null
}
