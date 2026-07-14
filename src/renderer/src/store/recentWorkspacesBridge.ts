// The renderer data path feeding the recent-workspaces store: it observes the typed
// `recentWorkspacesReceived` daemon event (#380's transport half already decodes the
// `recent_workspaces_list` reply and emits it) and lands its rows in the app-singleton
// `recentWorkspacesStore` the Workspace Picker (#157) reads, and it drives a single on-demand
// `requestRecentWorkspaces` request so the slice fills when the picker mounts this binding. The three
// helpers are React-free and injected, so the whole path is unit-testable with plain spies (the
// conversationListBridge idiom); `RecentWorkspacesData` is the thin React glue over them. Nothing here
// touches keys, sockets, ipcRenderer, or raw frames — it only subscribes through the preload bridge,
// dispatches an already-typed event, and sends an existing bare command (#380).
import { useEffect, useRef } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { DaemonEvent } from '@shared/ipc/events'
import type { RecentWorkspace } from '@shared/wire/types'
import { recentWorkspacesStore } from './recentWorkspacesStore'

/**
 * The filter: map the one owned arm to its rows, every other DaemonEvent to `null`. `default: null`
 * — not an `assertNever` — because ignoring the rest is the intended, permanent behavior here (this
 * path deliberately consumes only `recentWorkspacesReceived`), mirroring `translateConversationsEvent`.
 * Returns `event.recentWorkspaces` directly: selecting a single named field is a filter, not a
 * field-remap, so there is no fresh-literal reconstruction to do — a rename of the arm is still caught
 * (a `case` label that no longer overlaps the union is a type error).
 */
export function translateRecentWorkspacesEvent(
  event: DaemonEvent
): readonly RecentWorkspace[] | null {
  switch (event.type) {
    case 'recentWorkspacesReceived':
      return event.recentWorkspaces
    default:
      return null
  }
}

/**
 * Fire the existing bare `requestRecentWorkspaces` command (#380 wired the main side through to the
 * daemon; the daemon returns every recent workspace, so there is no payload). An inline literal typed
 * as RendererCommand — no constructor added, keeping the change renderer-contained. Fire-and-forget,
 * like the composer's send: `sendCommand` is `void`, so there is no result to await. This dispatches
 * the EXISTING #380 command — it does not add one.
 */
export function requestRecentWorkspaces(sendCommand: (command: RendererCommand) => void): void {
  sendCommand({ type: 'requestRecentWorkspaces' })
}

/**
 * Subscribe via the injected `onDaemonEvent` with a single listener: each `recentWorkspacesReceived`
 * writes its rows verbatim into the store via `setRecentWorkspaces`; every other event no-ops. Unlike
 * `subscribeConversations` there is no `refreshOnChange` half — recent-workspaces has no
 * `conversationUpdated`-style broadcast that re-requests the list; the picker re-fetches by remounting
 * the trigger, not via an unsolicited daemon event. Returns the unsubscribe handle (the
 * daemonEventBridge off-handle idiom) so the React binding can use it as its effect cleanup. The
 * `list !== null` guard (not `if (list)`) is deliberate: an empty array is truthy either way, but the
 * explicit `!== null` makes "an empty list still writes — loaded-zero, not not-loaded" unmistakable.
 * The listener only dispatches — it never throws into React.
 */
export function subscribeRecentWorkspaces(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRecentWorkspaces: (recentWorkspaces: readonly RecentWorkspace[]) => void
): () => void {
  return onDaemonEvent((event) => {
    const list = translateRecentWorkspacesEvent(event)
    if (list !== null) setRecentWorkspaces(list)
  })
}

/**
 * The recent-workspaces data-path binding — a headless leaf (renders null) mounted by the Workspace
 * Picker (#157), NOT app-level: the list is a paired-only, picker-scoped surface, so it fetches fresh
 * every time the picker opens (the serverInfoLoader "mounted on demand, not app-level" shape). Ships
 * DORMANT here — no consumer mounts it in this ticket (the picker wires the mount point). `window.pyry`
 * is dereferenced only inside the effects, never during render, so it server-renders to empty markup
 * without a bridge mock (the ServerInfoData invariant).
 */
export function RecentWorkspacesData(): null {
  // Subscribe first (declared before the request effect, so it runs first on mount): the listener is
  // live before the request goes out. The returned off handle is the effect cleanup, so a StrictMode
  // double-mount nets exactly one live listener (the daemonEventBridge idiom). Each
  // recentWorkspacesReceived writes its rows verbatim into the app-singleton store via its setter.
  useEffect(() => {
    return subscribeRecentWorkspaces(window.pyry.onDaemonEvent, (list) =>
      recentWorkspacesStore.getState().setRecentWorkspaces(list)
    )
  }, [])

  // A single on-demand request per mount. The ref flag makes the StrictMode dev double-invoke fire
  // exactly one request: it persists across the simulated unmount/remount (same fiber), so exactly one
  // request goes out. A real unmount/remount (picker closed and reopened) is a fresh instance → fresh
  // ref → a fresh fetch — the intended on-demand behavior. No connection-lifecycle gate and no ref
  // reset: this is a pure on-mount one-shot (the serverInfoLoader shape), not a per-connection re-arm.
  const requested = useRef(false)
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    requestRecentWorkspaces(window.pyry.sendCommand)
  }, [])

  return null
}
