// The renderer data path feeding the conversation-list store: it observes the typed
// `conversationsReceived` daemon event (#139's transport half already decodes the `conversations`
// reply and emits it) and lands its rows in the app-singleton `conversationListStore` the Channel
// List screen (#141) reads, and it drives the initial `list_conversations` request so the slice
// fills. The three helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the runConfigSnapshot idiom); `ConversationListData` is the thin React glue over them.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the
// preload bridge and dispatches an already-typed event, and sends an existing host-addressed command.
import { useEffect } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'
import { conversationListStore, type ConversationListOrigin } from './conversationListStore'
import { sessionStore, type SessionState } from './sessionStore'

/**
 * Read the server this event came from (#1086), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * listener's parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so at a
 * bare-`DaemonEvent`-typed hole it arrives structurally while the static type stays silent about it.
 * `ServerOrigin.serverId` is required, so a bare `DaemonEvent` is not assignable to a
 * `StampedDaemonEvent` — widening the parameter would fail this module's own tests, which build bare
 * event literals and a fake bridge typed on the bare union. `relayLinkBridge.ts`'s `originOf` is the
 * same idiom for the relay leg, `daemonEventBridge.ts`'s for the daemon leg and `liveWindow.ts`'s is
 * its main-side original; a copy rather than an import, because `daemonEventBridge`'s is
 * module-private and returns `sessionStore`'s key type, and taking it would couple two deliberately
 * independent single-arm subscribers and drag this store's key domain onto the session store.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload — the same rule `stampRows` enforces
 * one layer down. The reply's rows carry an `id` and a `cwd` the daemon chose; none of them names a
 * server, and if one did it would be a daemon claiming a slot. The stamp is bound main-side at
 * construction from a paired record this client holds, so a hostile or confused daemon cannot make its
 * events file rows under another server and have them render as that machine's conversations.
 */
function originOf(event: DaemonEvent): ConversationListOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null files under the unstamped slot: no producer
  // can emit one (`bindServerOrigin` takes a `string | null` scalar), and answering with a slot
  // rather than throwing is what keeps this total.
  return typeof serverId === 'string' ? serverId : undefined
}

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
 * The refresh trigger (#275, #376, #515, #1288): should this event re-request the list? True for the arms
 * that signal a daemon-side change the list reflects — the unsolicited `conversationUpdated` BROADCAST
 * (promote / rename / archive), the CORRELATED `conversationDeleted` reply (a permanent delete confirmed
 * with a distinct `{ id }` and no broadcast, pyrycode #822), and the CORRELATED `conversationCreated`
 * reply (#515: the daemon sends no broadcast on a plain create, so without this arm a FAB-created
 * discussion stayed absent from the Channel List until a reconnect or an unrelated mutation), and the
 * `workspaceUpdated` frame (#1288: a WORKSPACE rename from any client, correlated to the asker and
 * unsolicited to everyone else — `conversation_updated` fans out on a CONVERSATION mutation, so a bare
 * workspace rename produces no such frame and the sidebar kept the old name until a reconnect).
 *
 * Deliberately a plain boolean, NOT a type guard that narrows to the payload. Read marks are patched
 * separately from validated update fields; metadata still arrives through the refreshed list. The `name` /
 * `cwd`, and `workspaceUpdated`'s `path` / `label`, are never consulted by this trigger. On the workspace arm that is
 * a SECURITY property and not only a shape preference: patching a row from the frame's `label` would put
 * untrusted daemon text on screen bypassing the `conversations` decode path, which is where the label the
 * sidebar renders is actually validated. We react to the OCCURRENCE of a change, then let the daemon's
 * authoritative reply
 * land the new rows via the existing `conversationsReceived → setConversations` seam: a delete drops the
 * row because the fresh `list_conversations` reply omits it, and a create gains a COMPLETE row rather than
 * one fabricated from the 5-field created payload (which carries no `is_archived` / `last_message_ts`) —
 * no local array surgery either way. Creator-only by construction: `conversation_created` is a correlated
 * reply, so a second client's list stays stale until its own next mutation — unfixable renderer-side, out
 * of scope. Kept separate from `translateConversationsEvent` so that pure `event → rows | null` filter
 * stays single-purpose (the ticket's "don't overload that filter"). Total over the sealed union — no
 * failure mode.
 */
export function shouldRefreshList(event: DaemonEvent): boolean {
  return (
    event.type === 'conversationUpdated' ||
    event.type === 'conversationDeleted' ||
    event.type === 'conversationCreated' ||
    event.type === 'workspaceUpdated'
  )
}

/** Send only to an explicit host; no payload fields participate in routing. */
export function requestConversationList(
  sendCommand: (command: RendererCommand) => void,
  serverId: string
): void {
  logListLifecycle('requested')
  sendCommand({ type: 'requestConversations', serverId })
}

function logListLifecycle(code: 'requested' | 'invalid-origin'): void {
  if (typeof window !== 'undefined') {
    window.pyry?.sendDiagnostic?.({ event: 'conversation-list', code })
  }
}

/** Observe every store transition, including edges React could batch into one render. */
export function subscribeConnectedConversationLists(
  store: Pick<typeof sessionStore, 'getState' | 'subscribe'>,
  sendCommand: (command: RendererCommand) => void
): () => void {
  let connected = new Set<string>()
  const observe = ({ statuses }: SessionState): void => {
    const next = new Set<string>()
    for (const [serverId, status] of statuses) {
      if (typeof serverId === 'string' && serverId.length > 0 && status.type === 'connected') {
        next.add(serverId)
      }
    }
    const newlyConnected = [...next].filter((serverId) => !connected.has(serverId))
    // Commit before sending: a synchronous reply must not request the same edge again.
    connected = next
    for (const serverId of newlyConnected) requestConversationList(sendCommand, serverId)
  }
  const off = store.subscribe(observe)
  observe(store.getState())
  return off
}

/**
 * Subscribe via the injected `onDaemonEvent` with a SINGLE listener that has two independent reactions
 * (a single event is never both a `conversationsReceived` and a refresh-trigger event, so they never
 * cross-fire): each `conversationsReceived` writes its rows verbatim into the store via
 * `setConversations`; each refresh-trigger event — a `conversationUpdated` broadcast (#275), a
 * `conversationDeleted` reply (#376), a `conversationCreated` reply (#515), or a `workspaceUpdated`
 * frame (#1288) — fires `refreshOnChange` to re-request the authoritative list, keeping the Channel List
 * live on a create/promote/rename/archive/delete, and on a WORKSPACE rename from any client, without a
 * reconnect. A create fires exactly one re-request: `conversationCreatedBridge` consumes
 * the same event on an INDEPENDENT subscription but only navigates, it sends no command. Every unrelated
 * event no-ops. Still exactly one subscription (AC4). Returns the
 * unsubscribe handle (the daemonEventBridge off-handle idiom) so the React binding can use it as its
 * effect cleanup. The `list !== null` guard (not `if (list)`) is deliberate: an empty array is truthy
 * either way, but the explicit `!== null` makes "an empty list still writes — loaded-zero, not
 * not-loaded" unmistakable. `refreshOnChange` is required — the listener always needs to know what to
 * do on an update, so the contract forces every call site to opt in explicitly. The listener only
 * dispatches — it never throws into React.
 *
 * Since #1086 each write also carries the server the reply came from, so it replaces only that
 * server's rows. `translateConversationsEvent` is left alone by the keying: the origin rides beside
 * the union rather than inside the arm, so it is read here at the event, not folded into a filter
 * whose whole job is selecting one named field. Mutation refreshes use only a nonempty
 * main-stamped identity, so they cannot fall back to another saved host.
 */
export function subscribeConversations(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setConversations: (
    conversations: readonly ConversationSummary[],
    serverId?: string | null
  ) => void,
  refreshOnChange: (serverId: string) => void,
  advanceReadMark?: (serverId: string, conversationId: string, readUpTo: number) => void
): () => void {
  return onDaemonEvent((event) => {
    const list = translateConversationsEvent(event)
    if (list !== null) setConversations(list, originOf(event))
    if (shouldRefreshList(event)) {
      const serverId = originOf(event)
      if (typeof serverId === 'string' && serverId.length > 0) {
        if (event.type === 'conversationUpdated' && event.conversation.read_up_to !== undefined) {
          advanceReadMark?.(serverId, event.conversation.id, event.conversation.read_up_to)
        }
        refreshOnChange(serverId)
      }
      else logListLifecycle('invalid-origin')
    }
  })
}

/** App-lifetime data binding: subscribe to replies before requesting connected hosts. */
export function ConversationListData(): null {
  useEffect(() => {
    const offEvents = subscribeConversations(
      window.pyry.onDaemonEvent,
      (list, serverId) => conversationListStore.getState().setConversations(list, serverId),
      (serverId) => requestConversationList(window.pyry.sendCommand, serverId),
      (serverId, id, read) => conversationListStore.getState().advanceReadMark(serverId, id, read)
    )
    const offStatuses = subscribeConnectedConversationLists(sessionStore, window.pyry.sendCommand)
    return () => {
      offStatuses()
      offEvents()
    }
  }, [])
  return null
}
