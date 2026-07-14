// The daemon's recent-workspaces list, kept live as one unidirectional source of truth for the
// Workspace Picker (#157, a later ticket). Pure renderer state — no IPC, no preload bridge, no
// transport. The data path (recentWorkspacesBridge.ts) requests the list once its headless binding
// mounts and writes the arriving `recentWorkspacesReceived` rows here via the single setter; the
// picker reads them through the selector.
//
// A dedicated store (the conversationListStore precedent, #208), NOT a session-store facet: a
// recent-workspaces update never touches connection/messages state and vice versa, so the two stores
// stay orthogonal and a list arrival re-renders only components selecting this slice. It mirrors
// conversationListStore's DI-factory → singleton → hook → selector structure, holding the wire
// RecentWorkspace rows VERBATIM in snake_case — no parallel camelCase renderer type, no per-field
// remap — so the slice stays drift-free against the mobile wire contract. `last_used_at` stays the
// opaque wire string; relative-time formatting is a deferred picker concern. A single setter rather
// than a reducer: there is exactly one mutation ("record the latest list"), so a discriminated-union
// action set would be a one-member union — ceremony without benefit. Unidirectional is preserved:
// read-only selector, one write path, and `setRecentWorkspaces` is invoked only by the subscription
// wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { RecentWorkspace } from '@shared/wire/types'

/** The whole recent-workspaces state. `recentWorkspaces: null` is the distinct "not yet loaded" state;
 *  a received `[]` is a real loaded "zero workspaces" state, NOT null (the picker tells the two apart
 *  to choose between a loading affordance and an empty-state, the #141 / #324 null-vs-empty precedent).
 *  Rows are held as the wire emits them — snake_case RecentWorkspace, most-recent-first, no derivations
 *  (relative-time formatting of `last_used_at` derives at the picker's read boundary). */
export interface RecentWorkspacesState {
  recentWorkspaces: readonly RecentWorkspace[] | null
}

/** Store shape = state + the single mutation entry point. */
export type RecentWorkspacesStore = RecentWorkspacesState & {
  setRecentWorkspaces: (recentWorkspaces: readonly RecentWorkspace[]) => void
}

export const initialRecentWorkspacesState: RecentWorkspacesState = { recentWorkspaces: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setRecentWorkspaces` replaces the
 * whole array unconditionally (whole-list replacement — no merge, no dedupe) and never coerces or
 * validates the rows. The stored value is the daemon's, as-is.
 */
export function createRecentWorkspacesStore(
  init: RecentWorkspacesState = initialRecentWorkspacesState
) {
  return createStore<RecentWorkspacesStore>((set) => ({
    ...init,
    setRecentWorkspaces: (recentWorkspaces) => set({ recentWorkspaces })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and the picker reads. */
export const recentWorkspacesStore = createRecentWorkspacesStore()

/** Narrow-slice React binding for the picker. Selecting a single slice avoids cross-facet re-renders. */
export function useRecentWorkspacesStore<T>(selector: (s: RecentWorkspacesStore) => T): T {
  return useStore(recentWorkspacesStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setRecentWorkspaces`; it is the sole
 *  mutation path and is invoked only by the subscription wiring, never two-way-bound from a component. */
export const selectRecentWorkspaces = (
  s: RecentWorkspacesState
): readonly RecentWorkspace[] | null => s.recentWorkspaces
