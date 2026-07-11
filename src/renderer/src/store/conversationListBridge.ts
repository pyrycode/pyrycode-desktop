// The renderer data path feeding the conversation-list store: it observes the typed
// `conversationsReceived` daemon event (#139's transport half already decodes the `conversations`
// reply and emits it) and lands its rows in the app-singleton `conversationListStore` the Channel
// List screen (#141) reads, and it drives the initial `list_conversations` request so the slice
// fills. The three helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the runConfigSnapshot idiom); `ConversationListData` is the thin React glue over them.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the
// preload bridge and dispatches an already-typed event, and sends an existing bare command.
import { useEffect, useRef } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'
import { conversationListStore } from './conversationListStore'
import { useSessionStore } from './sessionStore'

/**
 * The filter: map the one owned arm to its rows, every other DaemonEvent to `null`. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this
 * path deliberately consumes only `conversationsReceived`), mirroring `toRunConfigSnapshot`. Unlike
 * `translateTimelineEvent`, this returns `event.conversations` directly: selecting a single named
 * field is a filter, not a field-remap, so there is no fresh-literal reconstruction to do — a rename
 * of the arm is still caught (a `case` label that no longer overlaps the union is a type error).
 */
export function translateConversationsEvent(
  event: DaemonEvent
): readonly ConversationSummary[] | null {
  switch (event.type) {
    case 'conversationsReceived':
      return event.conversations
    default:
      return null
  }
}

/**
 * The refresh trigger (#275): should this event re-request the list? True only for the unsolicited
 * `conversationUpdated` broadcast. Deliberately a plain boolean, NOT a type guard that narrows to the
 * payload — the event's `id` / `name` / `cwd` are never consulted (AC3). We react to the OCCURRENCE of
 * a daemon-side conversation change, then let the daemon's authoritative reply land the new rows via
 * the existing `conversationsReceived → setConversations` seam. Kept separate from
 * `translateConversationsEvent` so that pure `event → rows | null` filter stays single-purpose (the
 * ticket's "don't overload that filter"). Total over the sealed union — no failure mode.
 */
export function isConversationUpdated(event: DaemonEvent): boolean {
  return event.type === 'conversationUpdated'
}

/**
 * Fire the existing bare `requestConversations` command (#139 wired the main side through to
 * `buildListConversations`; the daemon returns every conversation, so there is no payload). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained.
 * Fire-and-forget, like the composer's send: `sendCommand` is `void`, so there is no result to await.
 */
export function requestConversationList(sendCommand: (command: RendererCommand) => void): void {
  sendCommand({ type: 'requestConversations' })
}

/**
 * Subscribe via the injected `onDaemonEvent` with a SINGLE listener that has two independent reactions
 * (a single event is never both a `conversationsReceived` and a `conversationUpdated`, so they never
 * cross-fire): each `conversationsReceived` writes its rows verbatim into the store via
 * `setConversations`; each `conversationUpdated` broadcast (#275) fires `refreshOnChange` to re-request
 * the authoritative list, keeping the Channel List live on a promote/rename/archive without a
 * reconnect. Every unrelated event no-ops. Still exactly one subscription (AC4). Returns the
 * unsubscribe handle (the daemonEventBridge off-handle idiom) so the React binding can use it as its
 * effect cleanup. The `list !== null` guard (not `if (list)`) is deliberate: an empty array is truthy
 * either way, but the explicit `!== null` makes "an empty list still writes — loaded-zero, not
 * not-loaded" unmistakable. `refreshOnChange` is required — the listener always needs to know what to
 * do on an update, so the contract forces every call site to opt in explicitly. The listener only
 * dispatches — it never throws into React.
 */
export function subscribeConversations(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setConversations: (conversations: readonly ConversationSummary[]) => void,
  refreshOnChange: () => void
): () => void {
  return onDaemonEvent((event) => {
    const list = translateConversationsEvent(event)
    if (list !== null) setConversations(list)
    if (isConversationUpdated(event)) refreshOnChange()
  })
}

/**
 * The conversation-list data-path binding — a headless component mounted app-level in App.tsx,
 * alongside useDaemonEventBridge: one stable, app-lifetime listener with no subscribe/unsubscribe
 * churn as the route flips, because the list must stay live for #141's Channel List regardless of
 * which screen is shown. It owns the two lifecycle effects and renders nothing. `window.pyry` is
 * dereferenced only inside effects, never during render, so it server-renders without a bridge mock.
 *
 * Trigger: the request fires once per connection episode — on each rising edge to `connected` — the
 * minimal reading of AC4 ("issued at least once, without user action, after connected") plus natural
 * robustness (a reconnect gets a fresh list; a request lost to a mid-flight disconnect recovers on
 * the next connect). This is NOT the deferred "richer refresh policy" (intra-connection re-requests
 * on archive change / focus / a future `conversation_updated`) — it is the list following the
 * connection lifecycle. The whole-list-replace setter makes each re-request's arrival idempotent.
 */
export function ConversationListData(): null {
  useEffect(() => {
    // Subscribe first (declared before the request effect, so it runs first on mount): the listener
    // is live before any request goes out. The returned off handle is the effect cleanup, so a
    // StrictMode double-mount nets exactly one live listener (the daemonEventBridge idiom). Each
    // conversationsReceived writes its rows verbatim into the app-singleton store via its setter; a
    // conversationUpdated broadcast (#275) re-requests the list so the flipped row lands without a
    // reconnect. `window.pyry.sendCommand` is dereferenced only when the arrow runs (an update fires),
    // never during render — so the server-render-to-empty-markup invariant is unaffected.
    return subscribeConversations(
      window.pyry.onDaemonEvent,
      (list) => conversationListStore.getState().setConversations(list),
      () => requestConversationList(window.pyry.sendCommand)
    )
  }, [])

  // Read the derived boolean (not the whole status object) so the binding only re-renders on a
  // connected-edge flip, not on every status change.
  const isConnected = useSessionStore((s) => s.status.type === 'connected')
  // One request per connection episode. The ref flag makes the StrictMode dev double-invoke fire
  // exactly one request per rising edge; resetting it while disconnected re-arms the next connect.
  const requested = useRef(false)

  useEffect(() => {
    if (!isConnected) {
      requested.current = false
      return
    }
    if (requested.current) return
    requested.current = true
    requestConversationList(window.pyry.sendCommand)
  }, [isConnected])

  return null
}
