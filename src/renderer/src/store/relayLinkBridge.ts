// The renderer data path feeding the relay-link store: it observes the typed, content-free
// `relayLinkChanged` daemon event (#328's transport half decodes the relay-socket leg's category and
// emits it — no token, key, raw frame, or close code) and lands its `status` in the app-singleton
// `relayLinkStore` the two-dot indicator (#330) reads. Reactive-only — unlike conversationListBridge
// (#208) and runConfigSnapshot (#187), the daemon *pushes* the relay status unsolicited, so there is
// NO request half: no command sent, no connected-edge trigger. The two helpers are React-free and
// injected, so the whole path is unit-testable with plain spies (the sessionIdBridge idiom);
// `RelayLinkData` is the thin React glue over them. Nothing here touches keys, sockets, ipcRenderer,
// or raw frames — it only subscribes through the preload bridge and dispatches an already-typed
// event, retaining a closed display category, never a secret.
import { useEffect } from 'react'
import type { DaemonEvent, RelayLinkStatus } from '@shared/ipc/events'
import { relayLinkStore, type RelayLinkOrigin } from './relayLinkStore'

/**
 * Read the server this event came from (#1134), off #1068's stamp.
 *
 * An `in`-guarded, `typeof`-checked access rather than a cast, and rather than re-declaring the
 * listener's parameter as `StampedDaemonEvent`: the stamp rides BESIDE the union, so at a
 * bare-`DaemonEvent`-typed hole it arrives structurally while the static type stays silent about it.
 * `ServerOrigin.serverId` is required, so a bare `DaemonEvent` is not assignable to a
 * `StampedDaemonEvent` — widening the parameter would fail this module's own tests, which build bare
 * event literals and a fake bridge typed on the bare union. `daemonEventBridge.ts`'s `originOf` is
 * the same idiom for the daemon leg and `liveWindow.ts`'s is its main-side original; a fifth copy
 * rather than an import, because `daemonEventBridge`'s is module-private and returns `sessionStore`'s
 * key type, and taking it would couple two deliberately independent single-arm subscribers and drag
 * this leg's key domain back onto the session store (`correlationRouter.ts`'s header makes the same
 * call for the same reason).
 *
 * The origin is read ONLY from the stamp, NEVER from the payload. On this arm that is not merely the
 * preferred source but the only one: `relayLinkChanged` carries the closed `RelayLinkStatus` category
 * and nothing else, so there is no `ack.server_id`-shaped field to be tempted by, unlike the daemon
 * leg's. The stamp is bound main-side at construction from a paired record this client holds, so a
 * hostile or confused daemon cannot make its events claim another server's slot and overwrite that
 * server's link status; a wire-sourced id would hand it exactly that.
 */
function originOf(event: DaemonEvent): RelayLinkOrigin {
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
 * The filter: map the one owned arm to its status, every other DaemonEvent to `null`. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this
 * path is a 4th independent subscriber that deliberately consumes only `relayLinkChanged`), mirroring
 * `translateSessionTransition` / `translateQueueEvent`. Returns `event.status` directly: selecting a
 * single named field is a filter, not a field-remap, so there is no fresh-literal reconstruction to
 * do — a rename of the arm is still caught (a `case` label that no longer overlaps the union is a
 * type error). React-free → unit-testable without a DOM (AC5 transitions, AC3 ignore-unrelated).
 */
export function translateRelayLink(event: DaemonEvent): RelayLinkStatus | null {
  switch (event.type) {
    case 'relayLinkChanged':
      return event.status
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `relayLinkChanged` writes its status verbatim into
 * the store via `setRelayLinkStatus`, under the server the event came from (#1134); every unrelated
 * event no-ops. Returns the unsubscribe handle (the daemonEventBridge off-handle idiom) so the React
 * binding can use it as its effect cleanup. The `status !== null` guard (not `if (status)`) mirrors
 * the sibling idiom and documents "the sentinel is `null`, not falsiness" — all three RelayLinkStatus
 * values are truthy, so the two behave identically today, but `!== null` is the drift-safe form. The
 * listener only dispatches — it never throws into React.
 *
 * `translateRelayLink` is left alone by the keying: the origin rides beside the union rather than
 * inside the arm, so it is read here at the event, not folded into a filter whose whole job is
 * selecting one named field.
 */
export function subscribeRelayLink(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRelayLinkStatus: (status: RelayLinkStatus, serverId?: string | null) => void
): () => void {
  return onDaemonEvent((event) => {
    const status = translateRelayLink(event)
    if (status !== null) setRelayLinkStatus(status, originOf(event))
  })
}

/**
 * The relay-link data-path binding — a headless component mounted app-level in App.tsx, alongside
 * SessionIdData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route
 * flips, because a `relayLinkChanged` event can arrive at any time — including before the two-dot
 * indicator (#330) is ever mounted — so the status must be retained regardless of which screen is
 * shown. A component (not a hook) isolates the subscription in its own leaf so it never cascades a
 * re-render into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never
 * during render, so it server-renders to `''` without a bridge mock (the SessionIdData invariant).
 * Reactive-only: one subscribe effect, no request effect, no useState/useRef/useSessionStore.
 */
export function RelayLinkData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the daemonEventBridge idiom). Each relayLinkChanged writes its
    // status into the app-singleton store via its setter, under the server it came from (#1134).
    return subscribeRelayLink(window.pyry.onDaemonEvent, (status, serverId) =>
      relayLinkStore.getState().setRelayLinkStatus(status, serverId)
    )
  }, [])

  return null
}
