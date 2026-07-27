// The open conversation's current daemon session id, kept live as one unidirectional source of truth
// for the interactive Run configuration controls (#257, later): they read it to un-inert themselves
// and to address a `set_session_settings` write to the session that is actually running. Pure
// renderer state — no IPC, no preload bridge, no transport. The data path (sessionIdBridge.ts)
// observes the `sessionTransition` daemon event (#254 decodes the marker) and writes the arriving
// `newSessionId` here via the single setter; #257 reads it through the selector.
//
// A dedicated store (the conversationListStore precedent, #208), NOT a runConfigStore facet: the
// parent split floated folding session_id into runConfigStore, but two facts argue against it — (a)
// runConfigStore's subscriber is sheet-scoped, whereas this holder must be App-level always-listening
// (a marker can arrive before the Run config sheet is ever opened), and (b) session_id is a routing
// id orthogonal to runConfigStore's { model, effort, yolo, usedTokens, windowTokens } snapshot. It
// mirrors conversationListStore's DI-factory → singleton → hook → selector structure, but holds a
// bare `string` (no wire type, no camelCase remap — the value is a routing id, not a wire row). Named
// setters rather than a reducer: the two mutations ("record the latest id" and, since #529, "clear
// when the pairing context ends") are independent whole-value writes — neither reads prior state and
// neither constrains the other's ordering — so there is no state machine for a discriminated-union
// action set to model; it would still be ceremony without benefit. Unidirectional is preserved:
// read-only selector, store-owned write paths, and both mutations are invoked only by wiring, never
// two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The whole session-id state. `sessionId: null` is the distinct "no marker seen yet" state (AC1); a
 *  received `''` is a real (if degenerate) id the daemon emitted, held verbatim, NOT null — the holder
 *  records the daemon's value as-is (AC4), matching how runConfigStore holds empty model/effort. */
export interface SessionIdState {
  sessionId: string | null
}

/** Store shape = state + the two mutation entry points. The mutations live here and NOT on
 *  `SessionIdState`, so the selector — typed against the state-only interface — cannot see them and
 *  `initialSessionIdState` stays assignable. */
export type SessionIdStore = SessionIdState & {
  setSessionId: (id: string) => void
  clearSessionId: () => void
}

export const initialSessionIdState: SessionIdState = { sessionId: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setSessionId` replaces the whole
 * `sessionId` unconditionally (AC2 "most recent value wins" — no merge, no coercion, no validation).
 * The stored value is the daemon's, as-is (AC4). `clearSessionId` (#529) returns the state to
 * `initialSessionIdState` for when the pairing context that scoped the id ends — sourced from that
 * exported constant rather than a fresh literal, so it keeps resetting everything if the state ever
 * gains a second field. It is unconditional, which is what makes clearing an already-clear store a
 * no-op by construction rather than by a guard.
 *
 * TWO writers, both landing the daemon's value verbatim (#491): sessionIdBridge, from the unsolicited
 * session_transition marker, and runConfigSnapshot, from the sheet's own request_session_settings
 * reply. Neither is preferred — arrival order wins — because neither dominates. Preferring the
 * marker is wrong after an eviction, where the wire mirrors the PREVIOUS id onto it so the next read
 * is the only correct value; preferring the read is wrong after a /clear, where the marker carries
 * the genuinely newer id while an open sheet holds a stale one.
 *
 * Arrival order also governs the interaction with `clearSessionId`: a reply that lands after a clear
 * repopulates the id, because every write here is unconditional and last-write-wins. That is not new
 * with #491 — the marker writer has always had the same property — but #491 adds a second source, so
 * the window widens from "a marker arrives after unpair" to "either source does". Left as-is
 * deliberately: guarding it belongs with the pairing lifecycle that owns the clear, not in a store
 * whose whole contract is to record what it was told.
 *
 * A held `''` is a real value meaning "the daemon has no session to address", NOT an absence. Whether
 * that value can be written to is a separate question, answered in one place by
 * isAddressableSessionId (runSettingsControls) — this store only records what it was told.
 */
export function createSessionIdStore(init: SessionIdState = initialSessionIdState) {
  return createStore<SessionIdStore>((set) => ({
    ...init,
    setSessionId: (sessionId) => set({ sessionId }),
    clearSessionId: () => set(initialSessionIdState)
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #257 reads. */
export const sessionIdStore = createSessionIdStore()

/** Narrow-slice React binding for #257. Selecting a single slice avoids cross-facet re-renders. */
export function useSessionIdStore<T>(selector: (s: SessionIdStore) => T): T {
  return useStore(sessionIdStore, selector)
}

/** The only read surface. The exposed mutations are exactly `setSessionId` and `clearSessionId`; both
 *  are invoked only by wiring, never two-way-bound from a component. */
export const selectSessionId = (s: SessionIdState): string | null => s.sessionId
