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
import { relayLinkStore } from './relayLinkStore'

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
 * the store via `setRelayLinkStatus`; every unrelated event no-ops. Returns the unsubscribe handle
 * (the daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup. The
 * `status !== null` guard (not `if (status)`) mirrors the sibling idiom and documents "the sentinel
 * is `null`, not falsiness" — all three RelayLinkStatus values are truthy, so the two behave
 * identically today, but `!== null` is the drift-safe form. The listener only dispatches — it never
 * throws into React.
 */
export function subscribeRelayLink(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRelayLinkStatus: (status: RelayLinkStatus) => void
): () => void {
  return onDaemonEvent((event) => {
    const status = translateRelayLink(event)
    if (status !== null) setRelayLinkStatus(status)
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
    // status into the app-singleton store via its setter.
    return subscribeRelayLink(window.pyry.onDaemonEvent, (status) =>
      relayLinkStore.getState().setRelayLinkStatus(status)
    )
  }, [])

  return null
}
