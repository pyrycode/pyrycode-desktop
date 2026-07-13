// The daemon's conversation list, kept live as one unidirectional source of truth for the Channel
// List screen (#141), the create-discussion affordance (#142), and every future list / navigation /
// archive feature. Pure renderer state — no IPC, no preload bridge, no transport. The data path
// (conversationListBridge.ts) requests the list once the connection reaches `connected` and writes
// the arriving `conversationsReceived` rows here via the single setter; #141 reads them through the
// selector.
//
// A dedicated store (the runConfigStore precedent, #187), NOT a session-store facet: a conversation-
// list update never touches connection/messages state and vice versa, so the two stores stay
// orthogonal and a list arrival re-renders only components selecting this slice. It mirrors
// runConfigStore's DI-factory → singleton → hook → selector structure, but holds the wire
// ConversationSummary rows VERBATIM in snake_case — no parallel camelCase renderer type, no per-field
// remap (unlike runConfigSnapshot's used_tokens → usedTokens) — so the slice stays drift-free against
// the mobile wire contract. A single setter rather than a reducer: there is exactly one mutation
// ("record the latest list"), so a discriminated-union action set would be a one-member union —
// ceremony without benefit. Unidirectional is preserved: read-only selector, one write path, and
// `setConversations` is invoked only by the subscription wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { ConversationSummary } from '@shared/wire/types'

/** The whole conversation-list state. `conversations: null` is the distinct "not yet loaded" state;
 *  a received `[]` is a real loaded "zero conversations" state, NOT null (#141 tells the two apart to
 *  choose between a loading affordance and an empty-state). Rows are held as the wire emits them —
 *  snake_case ConversationSummary, no derivations: "unnamed" is the literal `name === null` and
 *  "discussion vs channel" derives from the raw `is_promoted` flag, both at #141's read boundary. */
export interface ConversationListState {
  conversations: readonly ConversationSummary[] | null
}

/** Store shape = state + the single mutation entry point. */
export type ConversationListStore = ConversationListState & {
  setConversations: (conversations: readonly ConversationSummary[]) => void
}

export const initialConversationListState: ConversationListState = { conversations: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setConversations` replaces the
 * whole array unconditionally (AC2 "most recent list wins" — no merge, no dedupe) and never coerces
 * or validates the rows (AC3). The stored value is the daemon's, as-is.
 */
export function createConversationListStore(
  init: ConversationListState = initialConversationListState
) {
  return createStore<ConversationListStore>((set) => ({
    ...init,
    setConversations: (conversations) => set({ conversations })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #141 reads. */
export const conversationListStore = createConversationListStore()

/** Narrow-slice React binding for #141. Selecting a single slice avoids cross-facet re-renders. */
export function useConversationListStore<T>(selector: (s: ConversationListStore) => T): T {
  return useStore(conversationListStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setConversations`; it is the sole
 *  mutation path and is invoked only by the subscription wiring, never two-way-bound from a component. */
export const selectConversations = (
  s: ConversationListState
): readonly ConversationSummary[] | null => s.conversations

/** The archived-conversation count for the Settings Storage row (#351). Passes `null` (not yet loaded)
 *  through as `null` so the row shows a neutral placeholder rather than a spurious "0 archived"; a loaded
 *  list — including `[]` — resolves to the count of `is_archived === true` rows. A primitive return means
 *  zustand's `Object.is` equality re-renders the row only when the count itself changes, not on every list
 *  replacement. */
export const selectArchivedCount = (s: ConversationListState): number | null =>
  s.conversations === null ? null : s.conversations.filter((c) => c.is_archived).length
