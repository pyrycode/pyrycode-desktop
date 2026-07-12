// The daemon's latest rendered-screen text, kept live as one unidirectional source of truth for the
// live-screen display slice (#324). Pure renderer state — no IPC, no preload bridge, no transport. The
// data path (screenSnapshotBridge.ts) observes each arriving `screenSnapshotReceived` daemon event
// (#316) and writes its `text`/`ts` here via the single setter; #324 reads them through the selector.
//
// A dedicated store (the runConfigStore / conversationListStore precedent, #187 / #208), NOT a
// session-store facet: a screen-snapshot arrival never touches connection/messages state and vice
// versa, so the two stores stay orthogonal and a snapshot arrival re-renders only components selecting
// this slice. It mirrors runConfigStore's DI-factory → singleton → hook → selector structure, but
// holds a two-field snapshot instead of five, with a single setter rather than a reducer: there is
// exactly one mutation ("record the latest screen"), so a discriminated-union action set would be a
// one-member union — ceremony without benefit. Unidirectional is preserved: read-only selector, one
// write path, and `setSnapshot` is invoked only by the subscription wiring, never two-way-bound from a
// component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The held rendered-screen value. `text`/`ts` are held VERBATIM — never parsed, coerced, or validated
 *  (untrusted daemon-relayed content; the plain-text-never-HTML rendering discipline belongs to #324,
 *  which has the DOM sink — this slice does not). An empty `text` ("") is a real held value: a screen
 *  the daemon rendered as blank, NOT the "no screen yet" state. Mirrors the `screenSnapshotReceived`
 *  event shape. */
export interface ScreenSnapshot {
  text: string
  ts: string
}

/** The whole screen-snapshot state. `snapshot: null` is the distinct "no screen received yet" state;
 *  a received `{ text: '', ts }` is a real held empty-screen snapshot, NOT null (#324 tells the two
 *  apart). Mirrors runConfig's `snapshot: null`. */
export interface ScreenSnapshotState {
  snapshot: ScreenSnapshot | null
}

/** Store shape = state + the single mutation entry point. */
export type ScreenSnapshotStore = ScreenSnapshotState & {
  setSnapshot: (snapshot: ScreenSnapshot) => void
}

export const initialScreenSnapshotState: ScreenSnapshotState = { snapshot: null }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setSnapshot` replaces the whole
 * `snapshot` object unconditionally (AC1 "most recent wins" — no merge, no accumulation) and never
 * coerces or validates the fields; `{ text: '', ts }` is stored as-is (AC1 empty-`text`-held-as-`""`).
 * The stored value is the daemon's, as-is.
 */
export function createScreenSnapshotStore(
  init: ScreenSnapshotState = initialScreenSnapshotState
) {
  return createStore<ScreenSnapshotStore>((set) => ({
    ...init,
    setSnapshot: (snapshot) => set({ snapshot })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #324 reads. */
export const screenSnapshotStore = createScreenSnapshotStore()

/** Narrow-slice React binding for #324. Selecting a single slice avoids cross-facet re-renders. */
export function useScreenSnapshotStore<T>(selector: (s: ScreenSnapshotStore) => T): T {
  return useStore(screenSnapshotStore, selector)
}

/** The only read surface. There is no exposed setter beyond `setSnapshot`; it is the sole mutation
 *  path and is invoked only by the subscription wiring, never two-way-bound from a component. */
export const selectScreenSnapshot = (s: ScreenSnapshotState): ScreenSnapshot | null => s.snapshot
