// The conversation timeline as one unidirectional source of truth: a Zustand store wrapping the
// pure `reduceTimeline` (#121) so a stream of `ThreadEvent`s folds into `{ items, phase }`. Pure
// renderer state — no IPC, no preload bridge, no transport. The timeline bridge (#202) dispatches
// translated daemon events in; the render slice (#203) reads via the selectors.
//
// A dedicated store, orthogonal to `sessionStore` and `runConfigStore` (Strangler Fig, ADR 0008):
// nothing in the coarse `message` path reads it yet, so a stream arrival re-renders only components
// selecting a timeline slice. It mirrors `sessionStore`'s DI-factory → singleton → hook → selectors
// structure — wrapping a real reducer + `dispatch` rather than `runConfigStore`'s single setter,
// because there is a real event set (`ThreadEvent`) to reduce. No diagnostics observer: the `#134`
// instrumentation seam is session-only, and a speculative observer would defend an unobserved need.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  reduceTimeline,
  initialTimelineState,
  type TimelineState,
  type ThreadEvent
} from './threadTimeline'

/** Store shape = timeline state + the single mutation entry point. `dispatch` is the sole write
 *  path; the only read surface is the re-exported selectors. No exposed setter, no two-way binding
 *  — unidirectional, per CLAUDE.md. */
export type TimelineStore = TimelineState & {
  dispatch: (event: ThreadEvent) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `dispatch` threads the pure
 * `reduceTimeline`, mirroring `createSessionStore`'s `set((s) => reduce(s, ...))` body, with no
 * observer param (the timeline store is not instrumented).
 */
export function createTimelineStore(init: TimelineState = initialTimelineState) {
  return createStore<TimelineStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceTimeline(s, event))
  }))
}

/** App-wide singleton — the one source of truth the timeline bridge (#202) dispatches into and the
 *  render slice (#203) reads. */
export const timelineStore = createTimelineStore()

/** Narrow-slice React binding for #203. Selecting a single slice avoids cross-facet re-renders. */
export function useTimelineStore<T>(selector: (s: TimelineStore) => T): T {
  return useStore(timelineStore, selector)
}

// Re-export the read surface so #203 imports items/phase selectors from one site. They already exist
// on the pure reducer module (#121) — re-exported, never redefined.
export {
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry,
  selectCompacting,
  selectLocalSendPending,
  selectThinkingTokens
} from './threadTimeline'
