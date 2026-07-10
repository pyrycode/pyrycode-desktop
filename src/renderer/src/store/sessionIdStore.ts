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
// bare `string` (no wire type, no camelCase remap — the value is a routing id, not a wire row). A
// single setter rather than a reducer: there is exactly one mutation ("record the latest id"), so a
// discriminated-union action set would be a one-member union — ceremony without benefit.
// Unidirectional is preserved: read-only selector, one write path, and `setSessionId` is invoked only
// by the subscription wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The whole session-id state. `sessionId: null` is the distinct "no marker seen yet" state (AC1); a
 *  received `''` is a real (if degenerate) id the daemon emitted, held verbatim, NOT null — the holder
 *  records the daemon's value as-is (AC4), matching how runConfigStore holds empty model/effort. */
export interface SessionIdState {
  sessionId: string | null
}

/** Store shape = state + the single mutation entry point. */
export type SessionIdStore = SessionIdState & {
  setSessionId: (id: string) => void
}

export const initialSessionIdState: SessionIdState = { sessionId: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setSessionId` replaces the whole
 * `sessionId` unconditionally (AC2 "most recent marker wins" — no merge, no coercion, no validation).
 * The stored value is the daemon's, as-is (AC4).
 */
export function createSessionIdStore(init: SessionIdState = initialSessionIdState) {
  return createStore<SessionIdStore>((set) => ({
    ...init,
    setSessionId: (sessionId) => set({ sessionId })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #257 reads. */
export const sessionIdStore = createSessionIdStore()

/** Narrow-slice React binding for #257. Selecting a single slice avoids cross-facet re-renders. */
export function useSessionIdStore<T>(selector: (s: SessionIdStore) => T): T {
  return useStore(sessionIdStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setSessionId`; it is the sole mutation
 *  path and is invoked only by the subscription wiring, never two-way-bound from a component. */
export const selectSessionId = (s: SessionIdState): string | null => s.sessionId
