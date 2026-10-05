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
import { conversationTimelineStore } from './conversationTimelineStore'
import {
  conversationListStore,
  selectConversationIdsFor,
  type ConversationListOrigin
} from './conversationListStore'

/**
 * Read the server this event came from (#1138), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * listener's parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so at a
 * bare-`DaemonEvent`-typed hole it arrives structurally while the static type stays silent about it.
 * `relayLinkBridge.ts`'s `originOf` is the same idiom for the relay leg, `conversationListBridge.ts`'s
 * for the list leg and `daemonEventBridge.ts`'s for the daemon leg — a copy rather than an import, for
 * the reason each of those three states: taking another's would couple two deliberately independent
 * single-arm subscribers and drag this path's key domain onto that store's.
 *
 * The origin is read ONLY from the stamp, NEVER from the payload. The `connected` arm carries the
 * daemon's own `ack.server_id`, which is a DISTINCT value the daemon chose; the stamp is bound
 * main-side at construction from a paired record this client holds, so a hostile or confused daemon
 * cannot make its reconnect clear another server's queued backlogs.
 */
function originOf(event: DaemonEvent): ConversationListOrigin {
  if (!('serverId' in event)) return undefined
  const { serverId } = event
  if (serverId === null) return null
  // The `in` guard narrows the property to `unknown`, so the type is re-established here rather than
  // asserted. A value that is neither a string nor null selects the unstamped slot: no producer can
  // emit one (`bindServerOrigin` takes a `string | null` scalar), and answering with a slot rather
  // than throwing is what keeps this total.
  return typeof serverId === 'string' ? serverId : undefined
}

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
 * Subscribe via the injected `onDaemonEvent`. A `connected` event is the reconnect edge (#197): it
 * resets and returns — the relay re-emits `connected` on every (re)handshake (v2 has no session
 * resume), and the daemon then re-sends one queue_state per non-empty conversation, so the reset drops
 * that server's held backlogs before those re-sends repopulate them through `setBacklog` unchanged.
 * Every other `queueState` writes its snapshot via `setBacklog`; unrelated events no-op.
 * Reset-before-repopulate needs no ordering logic here: the transport emits `connected` before any
 * re-sent queue_state and the single daemon-event channel delivers in arrival order, dispatched
 * synchronously per event.
 *
 * SCOPED TO THE RECONNECTING SERVER (#1138). Since #1117 the background process holds one live
 * connection per paired server, so `connected` means "THIS server's connection came back" and the reset
 * carries the origin `originOf` read off the stamp. The branch reads the discriminant and the stamp,
 * never `event.ack` — the daemon's own `server_id` must not steer whose backlogs survive. Turning the
 * origin into the conversations to drop is the CALLER's job (`QueueData` below), so this bridge stays
 * store-free and drivable with a plain spy.
 *
 * The `snapshot !== null` guard (not `if (snapshot)`) is deliberate: an empty `queued: []` snapshot is a
 * real REPLACEMENT (the AC2 clear case), never dropped. The reset is a separate branch, not folded into
 * `translateQueueState`, so that translator stays the pure `queueState`→snapshot filter. Injected
 * `onDaemonEvent` + `setBacklog` + `resetBacklogsForServer` keep it React-free and unit-testable with
 * plain spies. The listener only translates + dispatches — it never throws into React.
 */
export function subscribeQueue(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setBacklog: (snapshot: QueueSnapshot) => void,
  resetBacklogsForServer: (origin: ConversationListOrigin) => void
): () => void {
  return onDaemonEvent((event) => {
    if (event.type === 'connected') {
      resetBacklogsForServer(originOf(event))
      return
    }
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
    // into the app-singleton store via its setter; a connected edge resets it (#197). Both write paths
    // ride this one listener, so the reset lands before the connect-time re-sends on the same channel.
    //
    // THE COMPOSITION ROOT for #1138's scoping, and the only place the two singletons meet: the origin
    // the bridge read off the stamp resolves to that server's conversation ids through #1086's shared
    // resolution, and only those keys are dropped. The list is read HERE, at reset time, not at
    // subscribe time — on a first connect the server's slot holds no list yet (the list request rides
    // the same edge) so nothing is dropped and nothing is held either; on a reconnect the slot still
    // holds the previous episode's rows, since only `clearAllConversations` at a pairing boundary
    // empties it, so the reconnecting server's conversations are known before its re-sends arrive.
    // Nothing can interleave between the read and the write: both stores are written from this one
    // synchronous dispatch, with no await between them.
    return subscribeQueue(
      window.pyry.onDaemonEvent,
      (snapshot) => {
        queueStore.getState().setBacklog(snapshot)
        // #1725: the same snapshot tells the open send window the daemon now holds the message.
        conversationTimelineStore.getState().markLocalSendQueued(snapshot.conversationId, snapshot.queued)
      },
      (origin) =>
        queueStore
          .getState()
          .resetBacklogsFor(selectConversationIdsFor(origin)(conversationListStore.getState()))
    )
  }, [])

  return null
}
