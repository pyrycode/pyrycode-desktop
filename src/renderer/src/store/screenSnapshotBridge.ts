// The renderer data path feeding the screen-snapshot store: it observes the typed
// `screenSnapshotReceived` daemon event (#316's transport half decodes the rendered-screen `text` and
// its `ts` and emits it) and lands each snapshot in the app-singleton `screenSnapshotStore` the
// live-screen display slice (#324) reads. Reactive-only — like sessionIdBridge (#259) / queueBridge
// (#293) and unlike conversationListBridge (#208) / runConfigSnapshot (#187), the daemon PUSHES the
// snapshot unsolicited, so there is NO request half: no command sent, no connected-edge trigger (the
// trigger is #324). The two helpers are React-free and injected, so the whole path is unit-testable
// with plain spies (the sessionIdBridge idiom); `ScreenSnapshotData` is the thin React glue over them.
// Nothing here touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the
// preload bridge and dispatches an already-typed event; `text` is UNTRUSTED daemon-relayed content held
// verbatim, and this slice has no DOM sink (the plain-text-never-HTML discipline is inherited by #324).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { screenSnapshotStore, type ScreenSnapshot } from './screenSnapshotStore'

/**
 * The filter: map the one owned arm to its snapshot, every other DaemonEvent to `null`. A FRESH
 * named-field literal `{ text: event.text, ts: event.ts }` (the queueBridge idiom — never `return
 * event`, never a spread) so the store shape stays immune to the `screenSnapshotReceived` arm gaining
 * an unrelated field later. `default: null` — not an `assertNever` — because ignoring the rest is this
 * path's intended, permanent behavior (AC3): it is an independent subscriber (the sessionIdBridge /
 * queueBridge posture), not one of the three typecheck-gating exhaustive bridges (which already no-op
 * `screenSnapshotReceived` from #316). React-free → unit-testable without a DOM.
 */
export function translateScreenSnapshot(event: DaemonEvent): ScreenSnapshot | null {
  switch (event.type) {
    case 'screenSnapshotReceived':
      return { text: event.text, ts: event.ts }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `screenSnapshotReceived` writes its snapshot into
 * the store via `setSnapshot`; every unrelated event no-ops. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup. The
 * `snapshot !== null` guard (not `if (snapshot)`) is deliberate: it mirrors queueBridge's / sessionId
 * Bridge's explicit-presence check — the guard is on the snapshot object's presence, never on the
 * `text` content, so an empty-`text` snapshot `{ text: '', ts }` still writes (AC1/AC5). The listener
 * only translates + dispatches — it never throws into React.
 */
export function subscribeScreenSnapshot(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setSnapshot: (snapshot: ScreenSnapshot) => void
): () => void {
  return onDaemonEvent((event) => {
    const snapshot = translateScreenSnapshot(event)
    if (snapshot !== null) setSnapshot(snapshot)
  })
}

/**
 * The screen-snapshot data-path binding — a headless component mounted app-level in App.tsx, alongside
 * QueueData: one stable, app-lifetime listener with no subscribe/unsubscribe churn as the route flips,
 * because a `screenSnapshotReceived` marker can arrive at any time — including before the #324 display
 * slice is ever mounted — so the latest screen must be retained regardless of which screen is shown. A
 * component (not a hook) isolates the subscription in its own leaf so it never cascades a re-render
 * into App; it renders nothing. `window.pyry` is dereferenced only inside the effect, never during
 * render, so it server-renders to `''` without a bridge mock (the QueueData invariant). Reactive-only:
 * one subscribe effect, no request effect, no useState/useRef/useSessionStore. Ships dormant — it
 * populates the store, but nothing renders it yet (#324).
 */
export function ScreenSnapshotData(): null {
  useEffect(() => {
    // Subscribe on mount; the returned off handle is the effect cleanup, so a StrictMode double-mount
    // nets exactly one live listener (the sessionIdBridge idiom). Each screenSnapshotReceived writes its
    // snapshot into the app-singleton store via its setter.
    return subscribeScreenSnapshot(window.pyry.onDaemonEvent, (snapshot) =>
      screenSnapshotStore.getState().setSnapshot(snapshot)
    )
  }, [])

  return null
}
