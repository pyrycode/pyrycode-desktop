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
// `cwd` + `is_promoted` at the read boundary, so the store never drifts from the wire shape. Named
// setters rather than a reducer: the two mutations ("record the created conversation" and, since #529,
// "clear when the conversation context ends") are independent whole-value writes — neither reads prior
// state and neither constrains the other's ordering — so there is no state machine for a
// discriminated-union action set to model; it would still be ceremony without benefit. Unidirectional
// is preserved: read-only selector, store-owned write paths, and both mutations are invoked only by
// wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { ConversationCreatedPayload } from '@shared/wire/types'

/** The whole active-conversation state. `activeConversation: null` is the distinct "no conversation
 *  created/opened this session yet" state — no chip renders. A received payload is held verbatim. */
export interface ActiveConversationState {
  activeConversation: ConversationCreatedPayload | null
}

/** Store shape = state + the two mutation entry points. The mutations live here and NOT on
 *  `ActiveConversationState`, so the selector — typed against the state-only interface — cannot see
 *  them and `initialActiveConversationState` stays assignable. */
export type ActiveConversationStore = ActiveConversationState & {
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
  clearActiveConversation: () => void
}

export const initialActiveConversationState: ActiveConversationState = {
  activeConversation: null
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `setActiveConversation` replaces the
 * whole `activeConversation` unconditionally (most-recent-wins — no merge, no coercion, no validation).
 * The stored value is the daemon's payload, as-is. `clearActiveConversation` (#529) returns the state
 * to `initialActiveConversationState` for when the conversation context that scoped the payload ends —
 * sourced from that exported constant rather than a fresh literal, so it keeps resetting everything if
 * the state ever gains a second field. It is unconditional, which is what makes clearing an
 * already-clear store a no-op by construction rather than by a guard.
 */
export function createActiveConversationStore(
  init: ActiveConversationState = initialActiveConversationState
) {
  return createStore<ActiveConversationStore>((set) => ({
    ...init,
    setActiveConversation: (activeConversation) => set({ activeConversation }),
    clearActiveConversation: () => set(initialActiveConversationState)
  }))
}

/** App-wide singleton — the one source of truth the nav callback writes and the chip reads. */
export const activeConversationStore = createActiveConversationStore()

/** Narrow-slice React binding. Selecting a single slice avoids cross-facet re-renders. */
export function useActiveConversationStore<T>(selector: (s: ActiveConversationStore) => T): T {
  return useStore(activeConversationStore, selector)
}

/** The only read surface. The mutation paths are exactly `setActiveConversation` and
 *  `clearActiveConversation`; both are invoked only by wiring, never two-way-bound from a component. */
export const selectActiveConversation = (
  s: ActiveConversationState
): ConversationCreatedPayload | null => s.activeConversation
