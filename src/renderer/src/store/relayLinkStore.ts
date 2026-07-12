// The relay-socket leg's current link status, kept live as one unidirectional source of truth for
// the two-dot connection indicator (#330, later): it reads this leg independently of the daemon
// session status (which lives in sessionStore's ConnectionStatus). Pure renderer state — no IPC, no
// preload bridge, no transport. The data path (relayLinkBridge.ts) observes the content-free
// `relayLinkChanged` daemon event (#328's transport half decodes it — no token, key, raw frame, or
// close code) and writes the arriving `status` here via the single setter; #330 reads it through the
// selector.
//
// A dedicated store (the sessionIdStore/conversationListStore precedent, #208), NOT a sessionStore
// facet: the daemon-session leg already lives in sessionStore's ConnectionStatus, and this leg is
// orthogonal — it must be App-level always-listening (a relay-link change can arrive at any time,
// including before #330 exists), and it holds a single closed category, not the session reducer's
// six-arm state. It mirrors sessionIdStore's DI-factory → singleton → hook → selector structure, but
// holds the wire-owned RelayLinkStatus (no camelCase remap — the arm carries the FINAL category). A
// single setter rather than a reducer: there is exactly one mutation ("record the latest status"),
// so a discriminated-union action set would be a one-member union — ceremony without benefit.
// Unidirectional is preserved: read-only selector, one write path, and `setRelayLinkStatus` is
// invoked only by the subscription wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { RelayLinkStatus } from '@shared/ipc/events'

/** The whole relay-link state. `status: null` is the distinct initial "not-connected" state (AC1) —
 *  definitionally none of the three categories the arm delivers, and the same not-yet-arrived
 *  sentinel every sibling store uses (sessionIdStore, conversationListStore, queueStore, …). It keeps
 *  the stored domain identical to the wire's RelayLinkStatus — no invented category. */
export interface RelayLinkState {
  status: RelayLinkStatus | null
}

/** Store shape = state + the single mutation entry point. */
export type RelayLinkStore = RelayLinkState & {
  setRelayLinkStatus: (status: RelayLinkStatus) => void
}

export const initialRelayLinkState: RelayLinkState = { status: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setRelayLinkStatus` replaces the
 * whole `status` unconditionally (most-recent category wins — no merge, no coercion, no validation;
 * the arm carries the final category, #328).
 */
export function createRelayLinkStore(init: RelayLinkState = initialRelayLinkState) {
  return createStore<RelayLinkStore>((set) => ({
    ...init,
    setRelayLinkStatus: (status) => set({ status })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #330 reads. */
export const relayLinkStore = createRelayLinkStore()

/** Narrow-slice React binding for #330. Selecting a single slice avoids cross-facet re-renders. */
export function useRelayLinkStore<T>(selector: (s: RelayLinkStore) => T): T {
  return useStore(relayLinkStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setRelayLinkStatus`; it is the sole
 *  mutation path and is invoked only by the subscription wiring, never two-way-bound from a
 *  component. */
export const selectRelayLinkStatus = (s: RelayLinkState): RelayLinkStatus | null => s.status
