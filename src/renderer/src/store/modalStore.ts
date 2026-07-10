// The outstanding modal prompts as one unidirectional source of truth: a Zustand store wrapping the
// pure `reduceModal` (#122) so a stream of `ModalEvent`s folds into `{ outstanding }`. Pure renderer
// state — no IPC, no preload bridge, no transport. The modal bridge (#223) dispatches translated
// daemon events in; the interactive render slice (#224) reads via the selector.
//
// A dedicated store, orthogonal to `sessionStore` / `timelineStore` / `runConfigStore` (Strangler
// Fig, ADR 0009): nothing else reads it, so a modal arrival re-renders only components selecting the
// outstanding slice. It mirrors `timelineStore`'s DI-factory → singleton → hook → selector structure
// — wrapping the real `reduceModal` + `dispatch`. No diagnostics observer: the `#134` instrumentation
// seam is session-only, and a speculative observer would defend an unobserved need (the #202 call).
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { reduceModal, initialModalState, type ModalState, type ModalEvent } from './modalPrompts'

/** Store shape = modal state + the single mutation entry point. `dispatch` is the sole write path;
 *  the only read surface is the re-exported `selectOutstanding`. No exposed setter, no two-way
 *  binding — unidirectional, per CLAUDE.md. */
export type ModalStore = ModalState & {
  dispatch: (event: ModalEvent) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `dispatch` threads the pure
 * `reduceModal`, mirroring `createTimelineStore`'s `set((s) => reduce(s, ...))` body, with no
 * observer param (the modal store is not instrumented).
 */
export function createModalStore(init: ModalState = initialModalState) {
  return createStore<ModalStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceModal(s, event))
  }))
}

/** App-wide singleton — the one source of truth the modal bridge (#223) dispatches into and the
 *  render slice (#224) reads. */
export const modalStore = createModalStore()

/** Narrow-slice React binding for #224. Selecting a single slice avoids cross-facet re-renders. */
export function useModalStore<T>(selector: (s: ModalStore) => T): T {
  return useStore(modalStore, selector)
}

// Re-export the read surface so #224 imports the outstanding selector from one site. It already
// exists on the pure reducer module (#122) — re-exported, never redefined.
export { selectOutstanding } from './modalPrompts'
