// The renderer data path feeding the session-id store: it observes the typed `sessionTransition`
// daemon event (#254's transport half already decodes the `session_transition` marker and emits it,
// renaming `new_session_id` → `newSessionId`) and lands its id in the app-singleton `sessionIdStore`
// the Run configuration controls (#257) read. Reactive-only — unlike conversationListBridge (#208),
// the daemon *pushes* markers unsolicited, so THIS path has NO request half: no command sent, no
// connected-edge trigger, no snapshot request. That is still true and is the whole shape of this
// module.
//
// What is NOT true, and used to be: that this is the ONLY way a session id reaches the store. It was,
// and that was the defect (#491) — the daemon fires the marker only on a clear or an idle eviction,
// never on session creation, so a fresh conversation never yielded an id and the Run configuration
// controls stayed permanently inert. runConfigSnapshot is now a second, request-driven ingress,
// scoped to the open sheet. Both land the daemon's value verbatim and neither is preferred: arrival
// order wins, which is the store's existing contract. Preferring this marker would be wrong after an
// eviction, since the wire mirrors the PREVIOUS id onto it and the next read is the only correct
// value.
//
// Since #1192 both ingresses are also SCOPED TO THE OPEN CHAT. That the marker carried no attribution
// used to be true of this port and was never true of the daemon: `conversation_id` has been on the
// wire since upstream #740/#741, and this repo's copy was simply stale. Reading it is what lets the
// gate below refuse a marker describing a chat the operator is not looking at — the second half of the
// misattribution #1176 closed on the request-driven side. The two helpers
// are React-free and injected, so the whole path is unit-testable with plain spies (the
// conversationListBridge idiom); `SessionIdData` is the thin React glue over them. Nothing here
// touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge
// and dispatches an already-typed event, retaining a routing id, never a secret (AC4).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { activeConversationStore } from './activeConversationStore'
import { sessionIdStore } from './sessionIdStore'

/**
 * The filter: map the one owned arm to its id, every other DaemonEvent to `null`. `default: null` —
 * not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this
 * path deliberately consumes only `sessionTransition`), mirroring `translateConversationsEvent` /
 * `toRunConfigSnapshot`. Returns `event.newSessionId` directly: selecting a single named field is a
 * filter, not a field-remap, so there is no fresh-literal reconstruction to do — a rename of the arm
 * is still caught (a `case` label that no longer overlaps the union is a type error). React-free →
 * unit-testable without a DOM (AC2 last-write-wins and AC3 ignore-unrelated).
 *
 * Deliberately BLIND to the marker's `conversationId` (#1192), and not widened to take the open
 * conversation: this stays a pure function OF THE EVENT, and attribution is one decision that belongs
 * in one place — `subscribeSessionId` below. Widening this translator would give that decision two
 * implementations, which is the reason `runConfigSnapshot` leaves its own translators alone.
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
 * Subscribe via the injected `onDaemonEvent`; each `sessionTransition` DESCRIBING THE OPEN CHAT writes
 * its id verbatim into the store via `setSessionId`; every unrelated event, and every marker naming
 * another chat, no-ops. Returns the unsubscribe handle (the daemonEventBridge off-handle idiom) so the
 * React binding can use it as its effect cleanup. The `id !== null` guard (not `if (id)`) is
 * deliberate: it mirrors conversationListBridge's `list !== null` — here `if (id)` would silently drop
 * an empty-string session_id, but the holder holds the daemon's value verbatim (AC4, no coercion), so
 * an empty `newSessionId` is still recorded. The listener only dispatches — it never throws into React.
 *
 * THE GATE (#1192) is `subscribeRunConfig`'s, copied rather than invented: one early return, before
 * the pure translator, comparing the event's own routing key against the injected
 * `getOpenConversationId`. It closes the second of this store's two ingresses. #1176 closed the first
 * by correlating a reply against the envelope id of the request that named a conversation; that is
 * unavailable here, because the daemon PUSHES this marker unsolicited and there is no request to
 * correlate against — so it reads the routing key the daemon is already sending. Without it, a marker
 * for a chat left idle in the background landed in the app-singleton store while another chat was open,
 * and every footer control reading `selectSessionId` then addressed — and wrote to — the wrong session.
 *
 * It is a NARROWING filter and must stay one. `!==` and an early return, never `===`, and no
 * accept-anyway branch for the no-conversation-open case: `getOpenConversationId()` returns `null`
 * there, no daemon-supplied conversation id is `null`, so the marker is dropped rather than latched
 * until a conversation opens. Fail-closed, the direction `runConfigLive`'s `?? null` was chosen for.
 * The `event.type ===` conjunct is what narrows `event` so `conversationId` resolves with no cast.
 *
 * The routing key is COMPARED AND DISCARDED — never held, never rendered, and deliberately never
 * logged: a per-drop log line would put a conversation-correlating id in the renderer console, which
 * anything that can open DevTools reads, to defend a failure nobody has observed (ADR 0007).
 *
 * `getOpenConversationId` is called PER EVENT, inside the listener, never captured at subscribe time —
 * this listener is app-lifetime, so an id read once would freeze at whatever was open when the leaf
 * mounted. That version compiles and passes every single-event test, which is why the test file drives
 * a getter whose answer changes between emits.
 */
export function subscribeSessionId(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSessionId: (id: string) => void,
  getOpenConversationId: () => string | null
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'sessionTransition' && event.conversationId !== getOpenConversationId()) return
    const id = translateSessionTransition(event)
    if (id !== null) setSessionId(id)
  })
}

/**
 * The session-id data-path binding — a headless component mounted app-level in App.tsx, alongside
 * ConversationListData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the
 * route flips, because a `session_transition` marker can arrive at any time — including before the Run
 * config sheet (#257) is ever mounted — so the LISTENER must be live regardless of which screen is
 * shown. What that no longer means, since #1192, is that the id is retained regardless of which screen
 * is shown: the listener is always on, and each marker is kept only if it names the open chat. The two
 * are independent, and it is the app-level mount that makes the per-event read below load-bearing.
 * A component (not a hook) isolates the subscription in its own leaf so it never cascades a
 * re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never
 * during render, so it server-renders to `''` without a bridge mock (the ConversationListData
 * invariant). Reactive-only: one subscribe effect, no request effect, no useState/useRef/useSessionStore.
 */
export function SessionIdData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the daemonEventBridge idiom). Each sessionTransition naming the
    // open chat writes its id into the app-singleton store via its setter.
    //
    // The open conversation is read non-reactively, at call time, through the injected getter —
    // RunConfigLiveData's wiring verbatim, down to the `?? null` spelling — so this leaf still
    // subscribes to nothing and the store is touched only when a marker arrives, never during render.
    return subscribeSessionId(
      window.pyry.onDaemonEvent,
      (id) => sessionIdStore.getState().setSessionId(id),
      () => activeConversationStore.getState().activeConversation?.id ?? null
    )
  }, [])

  return null
}
