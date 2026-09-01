// The outstanding question batches as one unidirectional source of truth: a Zustand container over the
// pure `reduceQuestionBatches` (#898), so a stream of `QuestionBatchEvent`s folds into `{ outstanding }`.
// Pure renderer state — no IPC, no preload bridge, no transport. The question bridge (#900) dispatches
// translated daemon events in; the panel slices read via the selectors — #906's frame first, then #907's
// option rows and #908 / #853's answer path. Nothing mounts it here.
//
// A dedicated store, orthogonal to `sessionStore` / `timelineStore` / `runConfigStore` (Strangler Fig,
// ADR 0009), cloning `modalStore.ts`'s DI-factory → singleton → hook → selectors structure. The
// container adds NO per-arm handling: all three `QuestionBatchEvent` arms fold through the single
// `reduceQuestionBatches` call, so a fourth arm needs no change here.
//
// NO `observe?` DIAGNOSTICS PARAM, and that absence is load-bearing rather than an oversight. The #134
// instrumentation seam is session-only, so an observer would defend an unobserved need (the call #202
// made and #223 repeated) — and it is the single easiest way to break this family's never-log rule:
// `questionBatchId` is a one-time unguessable nonce, the four claude-authored strings must not reach a
// sink either, and one observer hands an arbitrary consumer both in one line. There is no logger import
// and no `console.*` call in this module.
//
// UNTRUSTED TEXT, HELD OPAQUELY — RESTATED HERE ON PURPOSE. `Question.question`, `Question.header`, and
// every option's `label` and `description` are CLAUDE-AUTHORED: they crossed the subprocess trust
// boundary and the daemon NEITHER BOUNDS NOR SANITIZES them. `questionBatches.ts` says this too, but
// this file is the one a panel author imports, and they may never open that one. The RENDER slice owes
// the escaping: plain text only, never HTML (no innerHTML / dangerouslySetInnerHTML), never into an
// attribute, a URL, a filename, a cache key, a lookup path, or a log. The last three are the ones a
// paraphrase drops and the ones a question panel reaches for first, by keying a tab on `header` or
// memoising on `label`.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  reduceQuestionBatches,
  initialQuestionBatchState,
  type QuestionBatchState,
  type QuestionBatchEvent
} from './questionBatches'

/** Store shape = question-batch state + the single mutation entry point. `dispatch` is the sole write
 *  path; the only read surface is the re-exported `selectOutstandingBatches` / `selectBatchFor`. No
 *  exposed setter, no two-way binding — unidirectional, per CLAUDE.md. */
export type QuestionBatchStore = QuestionBatchState & {
  dispatch: (event: QuestionBatchEvent) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `dispatch` threads the pure
 * `reduceQuestionBatches`, mirroring `createModalStore`'s `set((s) => reduce(s, ...))` body.
 *
 * THE `init` SEAM IS LOAD-BEARING, NOT TEST SUGAR. Seeding the singleton below is invisible to
 * `renderToStaticMarkup`: the server renderer reads `getServerSnapshot()`, which zustand wires to
 * `getInitialState()` — the state captured at store CREATION — so a seed-then-render test silently
 * asserts against the initial cell. Renderer tests in this repo are static server renders
 * (`environment: 'node'`, no jsdom, no @testing-library), so the panel slices need a per-file instance
 * to seed and to override onto the hook below.
 *
 * `dispatch` is synchronous with no `await`, so two dispatches cannot interleave and there is no
 * check-then-act race. The one hazard is RE-ENTRANCY: zustand notifies subscribers synchronously
 * inside `setState`, so a subscriber that dispatched during a notify would recurse unbounded. Nothing
 * does — #900 dispatches from the preload event callback and the panel slices only read — and a later
 * store-subscription-driven dispatch should be a considered choice rather than an accident.
 */
export function createQuestionBatchStore(init: QuestionBatchState = initialQuestionBatchState) {
  return createStore<QuestionBatchStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceQuestionBatches(s, event))
  }))
}

/** App-wide singleton — the one source of truth the question bridge (#900) dispatches into and the
 *  panel slices (#906, #907, #908 / #853) read.
 *
 *  NEVER ATTACH THIS TO `window` as a debug handle. `dispatch` is otherwise reachable only from module
 *  importers; a global would hand any injected script a live write path into renderer state. */
export const questionBatchStore = createQuestionBatchStore()

/**
 * Narrow-slice React binding for the panel slices. Selecting a single slice avoids cross-facet
 * re-renders.
 *
 * `selectBatchFor(id)` IS SAFE TO CALL INLINE here — no `useMemo`, and no per-conversation selector
 * cache. It is a selector factory, so a fresh function identity is produced per render, but `useStore`
 * compares the selector's RESULT under `Object.is`, not the selector's identity, and `find` returns the
 * held batch by reference, stable while nothing changed. A memo table keyed by conversation id would be
 * merely redundant; keyed by anything claude-authored it would put untrusted text in a lookup path,
 * which is this family's named failure mode.
 */
export function useQuestionBatchStore<T>(selector: (s: QuestionBatchStore) => T): T {
  return useStore(questionBatchStore, selector)
}

// Re-export the read surface so consumers import the selectors from one site. Both already exist on the
// pure model (#898) — re-exported, never redefined. No third selector is minted: `selectBatchFor`
// answers both panel-facing reads, since #898 holds the full ordered question list ON the batch it
// returns.
export { selectOutstandingBatches, selectBatchFor } from './questionBatches'
