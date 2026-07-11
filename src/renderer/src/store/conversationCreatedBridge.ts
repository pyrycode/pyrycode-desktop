// The renderer create/created feature bridge (#242) — the twin of conversationListBridge. It sends the
// FAB's `createConversation` command and subscribes to the daemon's `conversationCreated` confirmation,
// invoking a caller-supplied `onCreated` (in PairedShell, that dispatches the list→thread `open` nav).
// The three data-path helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the conversationListBridge idiom); `useConversationCreatedNav` is the thin React glue over them.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload
// bridge and dispatches an already-typed command, and consumes an already-typed event.
import { useEffect, useRef } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload } from '@shared/wire/types'

/**
 * Fire the `createConversation` command (#241 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained,
 * exactly as `requestConversationList` inlines `{ type: 'requestConversations' }`. The payload requests
 * a fresh ad-hoc discussion: `is_promoted: false`, and `name`/`cwd` `null` — the nullable-and-PRESENT
 * "take the daemon default" signal (CreateConversationPayload's contract; a `null` is on the wire, not an
 * omission). Fire-and-forget, like the composer's send: `sendCommand` is `void`, no result to await.
 */
export function requestNewConversation(sendCommand: (command: RendererCommand) => void): void {
  sendCommand({ type: 'createConversation', payload: { is_promoted: false, name: null, cwd: null } })
}

/**
 * The filter: map the one owned arm to its payload, every other DaemonEvent to `null`. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this path
 * deliberately consumes only `conversationCreated`), mirroring `translateConversationsEvent`. Returns
 * `event.conversation` directly: selecting a single named field is a filter, not a field-remap, so there
 * is no fresh-literal reconstruction to do — a rename of the arm is still caught (a `case` label that no
 * longer overlaps the union is a type error).
 */
export function translateConversationCreated(
  event: DaemonEvent
): ConversationCreatedPayload | null {
  switch (event.type) {
    case 'conversationCreated':
      return event.conversation
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `conversationCreated` invokes `onCreated` with the
 * decoded payload; every unrelated event no-ops. Returns the unsubscribe handle (the subscribeConversations
 * off-handle idiom) so the React binding can use it as its effect cleanup. The current nav consumer
 * ignores the payload — navigation is conversation-agnostic (a select-and-load transport does not exist
 * yet, the same interim as the row's `onClick={onOpen}`) — but the created `id` is passed here so the
 * future select-and-load ticket changes only the consumer, not this seam. The listener only invokes the
 * callback — it never throws into React.
 */
export function subscribeConversationCreated(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onCreated: (created: ConversationCreatedPayload) => void
): () => void {
  return onDaemonEvent((event) => {
    const created = translateConversationCreated(event)
    if (created !== null) onCreated(created)
  })
}

/**
 * Wire the created-event channel to a caller callback for the mounting component's lifetime — mounted in
 * PairedShell, so the subscription lives only while the paired shell is on screen (unpair unmounts it →
 * the off handle tears it down; re-pair mounts a fresh one). Subscribes exactly once (empty-dep effect,
 * off-handle as cleanup — a StrictMode double-mount nets exactly one live listener, the useDaemonEventBridge
 * guarantee). The caller passes a fresh inline arrow each render, so the latest `onCreated` is held in a
 * ref and invoked from the listener; the subscription is established once and never re-subscribes on
 * PairedShell's route-flip re-renders. `window.pyry` is dereferenced only inside the effect, so PairedShell
 * stays server-renderable.
 */
export function useConversationCreatedNav(
  onCreated: (created: ConversationCreatedPayload) => void
): void {
  const onCreatedRef = useRef(onCreated)
  useEffect(() => {
    onCreatedRef.current = onCreated
  })
  useEffect(
    () =>
      subscribeConversationCreated(window.pyry.onDaemonEvent, (created) =>
        onCreatedRef.current(created)
      ),
    []
  )
}
