// The Run configuration sheet's held snapshot: the session's current model / reasoning effort /
// YOLO state, as one unidirectional source of truth. Pure renderer state — no IPC, no preload
// bridge, no transport. The data path (runConfigSnapshot.ts) requests a fresh snapshot on sheet
// open and writes the arriving `snapshotReceived` fields here via the single setter; #188's sections
// read the held values through the selectors.
//
// A dedicated store (a separate consumer, per #180's landed comments), NOT a session-store facet: a
// snapshot never touches connection/messages state and vice versa, so the two stores stay orthogonal
// and a snapshot arrival re-renders only components selecting this slice. It mirrors sessionStore's
// DI-factory → singleton → hook → selectors structure, but with a single setter rather than a
// reducer: there is exactly one mutation ("record the latest snapshot"), so a discriminated-union
// action set would be a one-member union — ceremony without benefit. Unidirectional is preserved:
// read-only selectors, one write path, and `setSnapshot` is invoked only by the subscription wiring,
// never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The three session-settings fields the sheet displays. Fields are plain `string`/`boolean`, so an
 *  empty model, an empty effort (inherited default), or `yolo: false` (permissions enforced) are
 *  held verbatim by construction — never coerced (AC5). Mirrors the `snapshotReceived` event shape. */
export interface RunConfigSnapshot {
  model: string
  effort: string
  yolo: boolean
}

/** The whole run-config state. `snapshot: null` is the distinct "not yet loaded" state; a received
 *  `{ model: '', effort: '', yolo: false }` is a real snapshot of inherited-defaults, NOT null (#188
 *  distinguishes the two). */
export interface RunConfigState {
  snapshot: RunConfigSnapshot | null
}

/** Store shape = state + the single mutation entry point. */
export type RunConfigStore = RunConfigState & {
  setSnapshot: (snapshot: RunConfigSnapshot) => void
}

export const initialRunConfigState: RunConfigState = { snapshot: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setSnapshot` replaces the whole
 * `snapshot` object unconditionally (AC4 "most recent snapshot wins" — no merge, no dedupe) and
 * never coerces or validates the fields (AC5). The stored value is the daemon's, as-is.
 */
export function createRunConfigStore(init: RunConfigState = initialRunConfigState) {
  return createStore<RunConfigStore>((set) => ({
    ...init,
    setSnapshot: (snapshot) => set({ snapshot })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #188's sections read. */
export const runConfigStore = createRunConfigStore()

/** Narrow-slice React binding for #188. Selecting a single slice avoids cross-facet re-renders. */
export function useRunConfigStore<T>(selector: (s: RunConfigStore) => T): T {
  return useStore(runConfigStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setSnapshot`; it is the sole mutation
 *  path and is invoked only by the subscription wiring, never two-way-bound from a component. */
export const selectSnapshot = (s: RunConfigState): RunConfigSnapshot | null => s.snapshot
