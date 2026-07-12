// The conversation the thread is currently showing, captured when a new discussion is created (#278):
// the empty-thread workspace chip reads its `cwd` to show which workspace the discussion will run in
// before the first message. Pure renderer state — no IPC, no preload bridge, no transport. The write
// path is PairedShell's existing `conversation_created` nav callback (conversationCreatedBridge, #242),
// which already receives the decoded payload and previously dropped it; it now records it here via the
// single setter, and ConversationScreen reads it through the selector.
//
// A dedicated store (the sessionIdStore / conversationListStore precedent, #208), mirroring the
// DI-factory → singleton → hook → selector structure. It holds the daemon's ConversationCreatedPayload
// VERBATIM (snake_case, no camelCase remap — the conversationListStore doctrine): the chip derives
// `cwd` + `is_promoted` at the read boundary, so the store never drifts from the wire shape. A single
// setter rather than a reducer: there is exactly one mutation ("record the created conversation"), so a
// discriminated-union action set would be a one-member union — ceremony without benefit. Unidirectional
// is preserved: read-only selector, one write path, and `setActiveConversation` is invoked only by the
// nav callback, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { ConversationCreatedPayload } from '@shared/wire/types'

/** The whole active-conversation state. `activeConversation: null` is the distinct "no conversation
 *  created/opened this session yet" state — no chip renders. A received payload is held verbatim. */
export interface ActiveConversationState {
  activeConversation: ConversationCreatedPayload | null
}

/** Store shape = state + the single mutation entry point. */
export type ActiveConversationStore = ActiveConversationState & {
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
}

export const initialActiveConversationState: ActiveConversationState = {
  activeConversation: null
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `setActiveConversation` replaces the
 * whole `activeConversation` unconditionally (most-recent-wins — no merge, no coercion, no validation).
 * The stored value is the daemon's payload, as-is.
 */
export function createActiveConversationStore(
  init: ActiveConversationState = initialActiveConversationState
) {
  return createStore<ActiveConversationStore>((set) => ({
    ...init,
    setActiveConversation: (activeConversation) => set({ activeConversation })
  }))
}

/** App-wide singleton — the one source of truth the nav callback writes and the chip reads. */
export const activeConversationStore = createActiveConversationStore()

/** Narrow-slice React binding. Selecting a single slice avoids cross-facet re-renders. */
export function useActiveConversationStore<T>(selector: (s: ActiveConversationStore) => T): T {
  return useStore(activeConversationStore, selector)
}

/** The only read surface. `setActiveConversation` is the sole mutation path, invoked only by the nav
 *  callback wiring, never two-way-bound from a component. */
export const selectActiveConversation = (
  s: ActiveConversationState
): ConversationCreatedPayload | null => s.activeConversation
