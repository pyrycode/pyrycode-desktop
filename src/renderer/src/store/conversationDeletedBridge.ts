// The renderer delete-confirmation bridge (#652) — the twin of conversationCreatedBridge, and strictly
// narrower: it subscribes to the daemon's `conversationDeleted` reply and invokes a caller-supplied
// `onDeleted` (in PairedShell, that runs the exitActiveConversation decision). It SENDS NOTHING — the
// delete command itself is fired by the Channel Info sheet's confirm (ConversationScreen.tsx:1699), so
// there is no request half here. The two data-path helpers are React-free and injected, so the whole path
// is unit-testable with plain spies (the conversationCreatedBridge idiom); `useConversationDeletedExit` is
// the thin React glue over them. Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only
// subscribes through the preload bridge and consumes an already-typed event.
import { useEffect, useRef } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'

/**
 * The filter: map the one owned arm to its id, every other DaemonEvent to `null`. `default: null` — not
 * an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this path
 * deliberately consumes only `conversationDeleted`), mirroring `translateConversationCreated`. Returns
 * `event.id` directly: the arm carries a BARE string id, not a payload object (events.ts:413-424), and
 * selecting a single named field is a filter, not a field-remap — a rename of the arm is still caught (a
 * `case` label that no longer overlaps the union is a type error).
 */
export function translateConversationDeleted(event: DaemonEvent): string | null {
  switch (event.type) {
    case 'conversationDeleted':
      return event.id
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `conversationDeleted` invokes `onDeleted` with the
 * deleted id; every unrelated event no-ops. Returns the unsubscribe handle (the subscribeConversations
 * off-handle idiom) so the React binding can use it as its effect cleanup. The `!== null` guard, not a
 * truthiness check, is the conversationListBridge.ts:82-84 doctrine — here it also matters materially,
 * because a degenerate `''` id is falsy but is still a real value the daemon emitted. The listener only
 * invokes the callback — it never throws into React.
 *
 * A SECOND subscription on this event is correct, not a duplicate: `conversationListBridge` already
 * consumes `conversationDeleted` app-level to re-request the list. That listener sends a command; this one
 * does not — so a delete still fires exactly one re-list. It is the arrangement
 * conversationListBridge.ts:78-79 already documents for `conversationCreated`. The two listeners touch
 * disjoint state (conversationListStore vs. the timeline / active conversation / session id), so their
 * delivery order is irrelevant and neither needs to know about the other.
 */
export function subscribeConversationDeleted(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onDeleted: (conversationId: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const deletedId = translateConversationDeleted(event)
    if (deletedId !== null) onDeleted(deletedId)
  })
}

/**
 * Wire the delete-confirmation channel to a caller callback for the mounting component's lifetime —
 * mounted in PairedShell, so the subscription lives only while the paired shell is on screen (unpair
 * unmounts it → the off handle tears it down; re-pair mounts a fresh one). A confirmation arriving while
 * unmounted reaches no listener, which is right: `clearPairingScopedState` has already cleared everything
 * the exit would clear. Subscribes exactly once (empty-dep effect, off-handle as cleanup — a StrictMode
 * double-mount nets exactly one live listener, the useDaemonEventBridge guarantee). The caller passes a
 * fresh inline arrow each render, so the latest `onDeleted` is held in a ref and invoked from the
 * listener; the subscription is established once and never re-subscribes on PairedShell's route-flip
 * re-renders. `window.pyry` is dereferenced only inside the effect, so PairedShell stays
 * server-renderable.
 */
export function useConversationDeletedExit(onDeleted: (conversationId: string) => void): void {
  const onDeletedRef = useRef(onDeleted)
  useEffect(() => {
    onDeletedRef.current = onDeleted
  })
  useEffect(
    () =>
      subscribeConversationDeleted(window.pyry.onDaemonEvent, (conversationId) =>
        onDeletedRef.current(conversationId)
      ),
    []
  )
}
