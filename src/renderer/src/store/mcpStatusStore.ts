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
  setMcpStatus: (snapshot: Omit<Snapshot, 'type'>) => void
  markMcpStatusUnavailable: (conversationId: string) => void
  clearMcpStatus: () => void
}

// Keyed by the daemon's conversation routing id only. A server `name` is never a key here: row strings
// are untrusted claude text for display. A held `servers: []` is claude's report of no servers, and a
// missing entry is no report at all; the selector keeps the two apart as `[]` versus `null`.
export function createMcpStatusStore() {
  return createStore<State>((set) => ({
    reports: new Map(),
    unavailable: new Set(),
    // Any report, published or answered, is current again, so it lifts that conversation's mark.
    setMcpStatus: (snapshot) => set((state) => {
      const reports = new Map(state.reports)
      reports.set(snapshot.conversationId, {
        servers: snapshot.servers.map(({ name, status, error, scope, version }) => ({ name, status, error, scope, version })),
        droppedServers: snapshot.droppedServers
      })
      if (!state.unavailable.has(snapshot.conversationId)) return { reports }
      const unavailable = new Set(state.unavailable)
      unavailable.delete(snapshot.conversationId)
      return { reports, unavailable }
    }),
    markMcpStatusUnavailable: (conversationId) => set((state) =>
      state.unavailable.has(conversationId) ? {} : { unavailable: new Set(state.unavailable).add(conversationId) }
    ),
    clearMcpStatus: () => set({ reports: new Map(), unavailable: new Set() })
  }))
}

export const mcpStatusStore = createMcpStatusStore()
export const selectMcpStatusFor = (conversationId: string | null) => (state: State): McpStatusReport | null =>
  conversationId === null ? null : state.reports.get(conversationId) ?? null
export const selectMcpStatusUnavailableFor = (conversationId: string | null) => (state: State): boolean =>
  conversationId !== null && state.unavailable.has(conversationId)

export function useMcpStatusStore<T>(selector: (state: State) => T): T {
  return useStore(mcpStatusStore, selector)
}
