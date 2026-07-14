// The renderer data path feeding the create-folder round-trip store: it observes the two typed daemon
// replies — `workspaceFolderCreated { path }` (#381) and the bare `workspaceFolderRejected` (#396) —
// and folds each into the app-singleton `newFolderStore` the Create-folder dialog (#398) reads. The
// helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// recentWorkspacesBridge idiom); `NewFolderData` is the thin React glue over them. Nothing here touches
// keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge and
// dispatches already-typed store events.
//
// INBOUND-ONLY — unlike recentWorkspacesBridge there is no request/outbound half: the outbound
// `createWorkspaceFolder` command (#381) belongs to #398, which sends it after dispatching
// `createRequested`. This bridge forwards both daemon events UNCONDITIONALLY; the store's reducer, not
// this bridge, applies the in-flight gate (AC3).
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import { newFolderStore, type NewFolderEvent } from './newFolderStore'

/**
 * The filter: map the two owned arms to their store events, every other DaemonEvent to `null`.
 * `default: null` — not an `assertNever` — because ignoring the rest is the intended, permanent
 * behavior here (this path deliberately consumes only the two create-folder replies), mirroring
 * `translateWriteEvent` / `translateRecentWorkspacesEvent`. Each returns a fresh store event; a rename
 * of either arm is still caught (a `case` label that no longer overlaps the union is a type error).
 * React-free → unit-testable without a DOM.
 */
export function translateNewFolderEvent(event: DaemonEvent): NewFolderEvent | null {
  switch (event.type) {
    case 'workspaceFolderCreated':
      return { type: 'folderCreated', path: event.path }
    case 'workspaceFolderRejected':
      return { type: 'folderRejected' }
    default:
      return null
  }
}

/**
 * Subscribe via the injected `onDaemonEvent` with a single listener: each owned reply runs through
 * `translateNewFolderEvent` and a non-null result is dispatched into the store UNCONDITIONALLY — the
 * store's reducer applies the in-flight gate (AC3), not this bridge. Every unrelated event no-ops.
 * Returns the unsubscribe handle (the daemonEventBridge off-handle idiom) so the React binding can use
 * it as its effect cleanup. The listener only dispatches — it never throws into React.
 */
export function subscribeNewFolder(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  dispatch: (event: NewFolderEvent) => void
): () => void {
  return onDaemonEvent((event) => {
    const folderEvent = translateNewFolderEvent(event)
    if (folderEvent !== null) dispatch(folderEvent)
  })
}

/**
 * The round-trip data-path binding — a headless leaf (renders null) mounted by the Create-folder dialog
 * (#398), NOT app-level: the dialog is the sole consumer and stays mounted for the whole round-trip, so
 * the listener lives exactly while the dialog is open (the RecentWorkspacesData picker-scoped shape, not
 * the RunSettingsWriteData app-level one). Ships DORMANT here — no consumer mounts it in this ticket.
 * `window.pyry` is dereferenced only inside the effect, never during render, so it server-renders to
 * empty markup without a bridge mock (the RecentWorkspacesData invariant). The returned off handle is
 * the effect cleanup, so a StrictMode double-mount nets exactly one live listener (the daemonEventBridge
 * idiom).
 */
export function NewFolderData(): null {
  useEffect(() => {
    return subscribeNewFolder(window.pyry.onDaemonEvent, (event) =>
      newFolderStore.getState().dispatch(event)
    )
  }, [])

  return null
}
