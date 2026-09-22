import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DaemonEvent } from '@shared/ipc/events'

type Snapshot = Extract<DaemonEvent, { type: 'mcpStatus' }>
export type McpStatusReport = Pick<Snapshot, 'servers' | 'droppedServers'>
type State = {
  reports: ReadonlyMap<string, McpStatusReport>
  setMcpStatus: (snapshot: Omit<Snapshot, 'type'>) => void
  clearMcpStatus: () => void
}

// Keyed by the daemon's conversation routing id only. A server `name` is never a key here: row strings
// are untrusted claude text for display. A held `servers: []` is claude's report of no servers, and a
// missing entry is no report at all; the selector keeps the two apart as `[]` versus `null`.
export function createMcpStatusStore() {
  return createStore<State>((set) => ({
    reports: new Map(),
    setMcpStatus: (snapshot) => set((state) => {
      const reports = new Map(state.reports)
      reports.set(snapshot.conversationId, {
        servers: snapshot.servers.map(({ name, status, error, scope, version }) => ({ name, status, error, scope, version })),
        droppedServers: snapshot.droppedServers
      })
      return { reports }
    }),
    clearMcpStatus: () => set({ reports: new Map() })
  }))
}

export const mcpStatusStore = createMcpStatusStore()
export const selectMcpStatusFor = (conversationId: string | null) => (state: State): McpStatusReport | null =>
  conversationId === null ? null : state.reports.get(conversationId) ?? null

export function useMcpStatusStore<T>(selector: (state: State) => T): T {
  return useStore(mcpStatusStore, selector)
}
