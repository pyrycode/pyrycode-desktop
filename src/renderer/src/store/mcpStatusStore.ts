import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DaemonEvent } from '@shared/ipc/events'

type Snapshot = Extract<DaemonEvent, { type: 'mcpStatus' }>
export type McpStatusReport = Pick<Snapshot, 'servers' | 'droppedServers'>
type State = {
  reports: ReadonlyMap<string, McpStatusReport>
  // Conversations whose latest ask the daemon refused as unavailable. A mark never touches `reports`: the
  // daemon sends no empty or stale report with a refusal, so rows already held stay on screen.
  unavailable: ReadonlySet<string>
  // Conversations with a Reconnect outstanding, and those whose latest Reconnect the daemon refused. An
  // accepted reconnect answers with a report, not an acknowledgement, so a report ends both.
  reconnecting: ReadonlySet<string>
  reconnectRefused: ReadonlySet<string>
  // The same pair for an on/off toggle, kept apart so the sheet can say which action was refused.
  toggling: ReadonlySet<string>
  toggleRefused: ReadonlySet<string>
  setMcpStatus: (snapshot: Omit<Snapshot, 'type'>) => void
  markMcpStatusUnavailable: (conversationId: string) => void
  beginMcpReconnect: (conversationId: string) => void
  // The section's unmount: a daemon that never answers cannot leave the control stuck past a reopen.
  endMcpReconnectWait: (conversationId: string) => void
  markMcpReconnectRefused: (conversationId: string) => void
  beginMcpToggle: (conversationId: string) => void
  endMcpToggleWait: (conversationId: string) => void
  markMcpToggleRefused: (conversationId: string) => void
  clearMcpStatus: () => void
}

// Keyed by the daemon's conversation routing id only. A server `name` is never a key here: row strings
// are untrusted claude text for display. A held `servers: []` is claude's report of no servers, and a
// missing entry is no report at all; the selector keeps the two apart as `[]` versus `null`.
function without(set: ReadonlySet<string>, conversationId: string): ReadonlySet<string> {
  if (!set.has(conversationId)) return set
  const next = new Set(set)
  next.delete(conversationId)
  return next
}

function adding(set: ReadonlySet<string>, conversationId: string): ReadonlySet<string> {
  return set.has(conversationId) ? set : new Set(set).add(conversationId)
}

export function createMcpStatusStore() {
  return createStore<State>((set) => ({
    reports: new Map(),
    unavailable: new Set(),
    reconnecting: new Set(),
    reconnectRefused: new Set(),
    toggling: new Set(),
    toggleRefused: new Set(),
    // Any report, published or answered, is current again, so it lifts that conversation's marks and ends
    // its reconnect wait, whatever the rows read (a just-reconnected server often reads `pending`).
    setMcpStatus: (snapshot) => set((state) => {
      const reports = new Map(state.reports)
      reports.set(snapshot.conversationId, {
        servers: snapshot.servers.map(({ name, status, error, scope, version }) => ({ name, status, error, scope, version })),
        droppedServers: snapshot.droppedServers
      })
      return {
        reports,
        unavailable: without(state.unavailable, snapshot.conversationId),
        reconnecting: without(state.reconnecting, snapshot.conversationId),
        reconnectRefused: without(state.reconnectRefused, snapshot.conversationId),
        toggling: without(state.toggling, snapshot.conversationId),
        toggleRefused: without(state.toggleRefused, snapshot.conversationId)
      }
    }),
    markMcpStatusUnavailable: (conversationId) => set((state) =>
      state.unavailable.has(conversationId) ? {} : { unavailable: new Set(state.unavailable).add(conversationId) }
    ),
    beginMcpReconnect: (conversationId) => set((state) =>
      state.reconnecting.has(conversationId) ? {} : { reconnecting: adding(state.reconnecting, conversationId) }
    ),
    endMcpReconnectWait: (conversationId) => set((state) =>
      state.reconnecting.has(conversationId) ? { reconnecting: without(state.reconnecting, conversationId) } : {}
    ),
    // The refusal is one merged outcome with no cause; held reports stay, as with the unavailable mark.
    markMcpReconnectRefused: (conversationId) => set((state) => ({
      reconnecting: without(state.reconnecting, conversationId),
      reconnectRefused: adding(state.reconnectRefused, conversationId)
    })),
    beginMcpToggle: (conversationId) => set((state) =>
      state.toggling.has(conversationId) ? {} : { toggling: adding(state.toggling, conversationId) }
    ),
    endMcpToggleWait: (conversationId) => set((state) =>
      state.toggling.has(conversationId) ? { toggling: without(state.toggling, conversationId) } : {}
    ),
    markMcpToggleRefused: (conversationId) => set((state) => ({
      toggling: without(state.toggling, conversationId),
      toggleRefused: adding(state.toggleRefused, conversationId)
    })),
    clearMcpStatus: () => set({
      reports: new Map(),
      unavailable: new Set(),
      reconnecting: new Set(),
      reconnectRefused: new Set(),
      toggling: new Set(),
      toggleRefused: new Set()
    })
  }))
}

export const mcpStatusStore = createMcpStatusStore()
export const selectMcpStatusFor = (conversationId: string | null) => (state: State): McpStatusReport | null =>
  conversationId === null ? null : state.reports.get(conversationId) ?? null
export const selectMcpStatusUnavailableFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.unavailable.has(conversationId)

export const selectMcpReconnectingFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.reconnecting.has(conversationId)
export const selectMcpReconnectRefusedFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.reconnectRefused.has(conversationId)
export const selectMcpTogglingFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.toggling.has(conversationId)
export const selectMcpToggleRefusedFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.toggleRefused.has(conversationId)

export function useMcpStatusStore<T>(selector: (state: State) => T): T {
  return useStore(mcpStatusStore, selector)
}
