// WHAT THE OPERATOR HAS PICKED SO FAR in an open question batch (#911, split from #908), held per
// question and by the option's POSITION — so nothing already chosen is lost while the question is
// still open. Pure renderer state: no IPC, no preload bridge, no transport, no async task, no timer,
// no teardown, and no persistence.
//
// DELIBERATELY SEPARATE FROM `questionBatchStore`, which holds what the DAEMON said. The picks are not
// hung off the held batch, and this module never reaches across to read `Question.multiSelect` — see
// the event union for how the single-versus-multi distinction arrives instead.
//
// THE PICKS CANNOT LIVE IN PANEL-LOCAL `useState`, and that is why this is a store. `PairedShell` keys
// `ConversationScreen` on the active conversation id, so switching chats remounts the whole
// conversation subtree and destroys every `useState` inside it. That keying is deliberate (#670, and
// `e2e/conversation-switch-remount.spec.ts` pins it using the composer draft as its observable), so
// panel-local state and "picks survive a switch" are in direct conflict. The picks live outside the
// keyed pane. #912 wires the panel to this store and proves the survival.
//
// NOTHING RENDERS THIS YET — the shape #899 shipped in: a store landing with no consumer mounted.
//
// THIS STORE IS STRUCTURALLY INCAPABLE OF HOLDING CLAUDE-AUTHORED TEXT, and that is the security
// property the whole shape turns on rather than a happy accident. `Question.question`,
// `Question.header` and every option's `label` and `description` crossed the subprocess trust boundary
// and the daemon neither bounds nor sanitizes them — but a `QuestionSelection` has nowhere to put one:
// two numeric/boolean fields and one OPERATOR-typed string. The only daemon-asserted value anywhere in
// this state is `questionBatchId`, used as a `Map` key and never as content. So the standing
// obligation `questionBatchStore.ts` states — plain text only, never HTML, never into an attribute, a
// URL, a filename, a cache key, a lookup path or a log — has nothing to bind on here, and a future
// edit that gives a selection a `label` field would re-open all of it at once.
//
// NOTHING HERE LOGS. No logger import, no `console.*`, and no `observe?` diagnostics seam — the
// refusal `questionBatches.ts`, `questionBatchStore.ts` and `questionBridge.ts` each record, and it
// binds harder here: `questionBatchId` is a one-time unguessable nonce AND `otherText` is whatever the
// operator typed into the Other row. One observer hands an arbitrary consumer both in a single line.
//
// NOTHING IS PERSISTED, deliberately, and this is the one place `conversationLastReadStore`'s shape is
// NOT copied. That store ships a `localStorage` port because a read mark is worth surviving a restart.
// Persisting picks would write live nonces into a hand-editable blob for state whose entire lifetime
// is one open question — and a batch does not survive the reconnect that a restart implies anyway, so
// there would be nothing left to restore.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/**
 * One question's selection so far.
 *
 * **A pick is an option's POSITION in that question's own `options` array, never its label.**
 * `QuestionOption` carries no `id` by design (#898: claude's answer protocol selects an option by its
 * `label`, so the label is the option's identity ON THE WIRE). Keying a pick by the label would put
 * untrusted claude-authored text into a lookup path — the failure mode `questionBatches.ts` and
 * `QuestionPanel.tsx` each name by hand, and the reason that component already draws its rows with
 * `key={index}`. Position is the client-side identity on both sides. Resolving a position back to a
 * label at answer time is #853's job.
 *
 * `optionIndices` IS HELD IN ASCENDING DISPLAY ORDER, NOT CLICK ORDER. Deterministic: two different
 * tick sequences ending at the same set produce the same value, which is what keeps the same-value
 * guard in `withSelection` honest, and it makes #853's answer list read in claude's own display order
 * rather than the operator's. A single-select question holds at most one position.
 *
 * **`otherText` is held INDEPENDENTLY of `otherTicked`** — clearing the tick leaves the text, in both
 * shapes. The Other row is not an entry in `question.options`: the panel draws it after the mapped
 * options but inside the same list container, so its pick is typed text plus a ticked flag and never
 * an index. That is why these are two fields rather than a sentinel position.
 *
 * `otherText` is the one string here, and it is OPERATOR-typed rather than claude-authored. It is
 * still a string bound into a controlled `<input value={…}>` by #912 — React's own escaping, never a
 * raw-markup sink.
 */
export interface QuestionSelection {
  optionIndices: readonly number[]
  otherText: string
  otherTicked: boolean
}

/**
 * The whole picks state: `questionBatchId` → (question position → that question's selection).
 *
 * **A `ReadonlyMap`, not a `Record` and not an ordered array.** The outer key is a daemon-asserted
 * one-time nonce, so this follows `conversationLastReadStore`'s precedent and its rationale transfers
 * verbatim: `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
 * `Map.prototype.set('__proto__', v)` creates an ordinary own entry, so `__proto__`, `constructor` and
 * `''` are three unremarkable keys BY CONSTRUCTION rather than by validation. Three consequences, none
 * of which is a type error: nothing is keyed into an object literal, there are no computed object keys
 * on any write path, and `Object.fromEntries(picks)` / `{...picks}` / `JSON.stringify(picks)` are all
 * out — each re-materialises the hazard the `Map` removes, and each is also what would make
 * persistence look easy. The test file's hostile-key reads BEFORE ANY WRITE are what catch a swap to
 * `Record`, which would otherwise be no type error at all. The inner map is keyed by `number` and has
 * no key hazard of any kind.
 *
 * ADR 0009's ordered-array-scanned-by-id is deliberately NOT copied, and this is the family's one
 * departure from it: `outstanding` holds DISPLAY-ORDERED CONTENT, whereas this is a pure lookup with
 * no order of its own. Neither of the array's two justifications (insertion order survives; the
 * selector returns the slice by reference) buys anything here.
 *
 * **ABSENT MEANS UNTOUCHED, and there is no `shown` arm.** A batch's picks come into being on the
 * operator's first pick. This store never mirrors the held batch's arrival, so an untouched batch
 * holds nothing. `reconnected` covers the daemon's connect-time re-send, so a re-shown batch cannot
 * inherit picks across a reconnect. See § Security review in the spec for the in-connection
 * re-delivery case this leaves to #853's resolution step.
 *
 * Growth is bounded by OPERATOR ACTION rather than by daemon traffic — an entry exists only for a
 * batch the operator actually picked in, so a daemon flooding `question_shown` creates none — and it
 * is dropped by that batch's `dismissed` or by any reconnect. No cap and no eviction, matching the
 * family's refusals; no growth failure has been observed.
 */
export interface QuestionPicksState {
  picks: ReadonlyMap<string, ReadonlyMap<number, QuestionSelection>>
}

/**
 * The renderer-local, sealed input union. Seven arms, each NAMED FOR ITS BEHAVIOUR rather than
 * carrying a `multiSelect: boolean` flag, and that is a deliberate choice: a boolean at the call site
 * is invertible with no type error, and it sits between a `string` and two `number`s that `tsc`
 * cannot tell apart either. A named arm cannot be sent backwards silently.
 *
 * **WHETHER A QUESTION REPLACES OR ACCUMULATES IS TOLD TO THIS STORE, NEVER READ OFF THE HELD BATCH.**
 * `multiSelect` lives on `Question` in the other store and the two stay apart, so the distinction
 * arrives with the pick itself. Which form the panel sends is #912's wiring.
 *
 * There is no answer arm — an answer clears through `dismissed` below like everything else. **THERE IS
 * NOW A LOCAL DISMISSAL, THOUGH (#921):** `refuseQuestionBatch` dispatches the arm below when the
 * operator hits Cancel, so the daemon's broadcast is no longer the only way a batch leaves the held
 * set. It dispatches HERE FIRST and into the batch store second, the same order
 * `subscribeQuestionBatches` uses, so the optimistic and daemon-driven clears cannot drift. There is
 * still no `resolved` id-memory (the #510 lesson `questionBatches.ts` records, restated there on its
 * new footing): the daemon re-asserts a batch only at connect time, and `reconnected` below already
 * clears everything before that reconcile lands.
 */
export type QuestionPickEvent =
  // SINGLE-SELECT. Replaces this question's option pick with exactly `[optionIndex]` AND clears
  // `otherTicked` — the two are mutually exclusive in a radio group. `otherText` is untouched, which
  // is the half a naive "reset the Other row" drops.
  | { type: 'optionPicked'; questionBatchId: string; questionIndex: number; optionIndex: number }
  // MULTI-SELECT. Adds the position if absent, removes it if present. Other positions, `otherTicked`
  // and `otherText` are all untouched.
  | { type: 'optionToggled'; questionBatchId: string; questionIndex: number; optionIndex: number }
  // SINGLE-SELECT. Ticks Other and clears every option pick; `otherText` untouched. Radio semantics:
  // NOTHING UN-TICKS OTHER except picking an option, which is why this arm takes no boolean.
  | { type: 'otherPicked'; questionBatchId: string; questionIndex: number }
  // MULTI-SELECT. Flips the Other tick, leaving ticked option picks and the text in place — Other
  // sits ALONGSIDE them here, the opposite of `otherPicked` above.
  | { type: 'otherToggled'; questionBatchId: string; questionIndex: number }
  // Replaces the typed text in either shape. Never moves `otherTicked` or `optionIndices`: the text
  // is held independently of the tick, so typing into an un-ticked row is ordinary traffic.
  | { type: 'otherTextChanged'; questionBatchId: string; questionIndex: number; text: string }
  // The daemon retired this batch. Carries ONLY the id: no `outcome`, no `source`. This store clears
  // on any dismissal regardless of cause, which is what satisfies the fail-closed reading rule at
  // this layer — an unrecognised `source` means RESOLVED, CAUSE UNKNOWN, and never an answer.
  | { type: 'dismissed'; questionBatchId: string }
  // The transport (re)connected. Fires on every supervisor (re)handshake, including the first.
  | { type: 'reconnected' }

/** Store shape = picks state + the single mutation entry point. `dispatch` is the sole write path;
 *  the only read surface is `selectQuestionSelection`. No exposed setter, no two-way binding —
 *  unidirectional, per CLAUDE.md. */
export type QuestionPicksStore = QuestionPicksState & {
  dispatch: (event: QuestionPickEvent) => void
}

/**
 * The empty selection, handed out by `selectQuestionSelection` for an untouched question.
 *
 * A HOISTED CONSTANT IS THE WHOLE MECHANISM, not a micro-optimisation: `useStore` compares the
 * selector's RESULT under `Object.is`, so a fresh literal per call would differ on every render and
 * spin a bound component forever. Not exported — a consumer needs the selector, not the sentinel.
 *
 * Not `Object.freeze`d, matching `initialQuestionBatchState` and `initialConversationLastReadState`:
 * `readonly` throughout is the guard this repo relies on, and reaching a mutation past it needs a
 * deliberate cast.
 */
const EMPTY_QUESTION_SELECTION: QuestionSelection = {
  optionIndices: [],
  otherText: '',
  otherTicked: false
}

/** The named empty baseline — the factory's default and what `reconnected` returns, so `picks` has a
 *  stable reference across repeated clears (the `clearAllLastRead` posture). Safe because this map is
 *  only ever REPLACED: every write below clones before it sets. Not exported, because nothing outside
 *  needs to name it — the factory defaults to it and the seeding caller passes real picks. */
const initialQuestionPicksState: QuestionPicksState = { picks: new Map() }

/** Compile-time exhaustiveness guard: a new event arm without a case is a type error.
 *
 *  THE MESSAGE IS CONTENT-FREE, deviating from the sibling modules' `${JSON.stringify(event)}` form,
 *  and that is a security-review finding rather than a style preference. Interpolating THIS union
 *  would put `questionBatchId` (a one-time unguessable nonce) and `otherText` (whatever the operator
 *  typed) into an `Error` message — and an `Error` message is a sink: it reaches a stack trace, a
 *  crash reporter, and anything that catches and logs. The arm is compile-time unreachable, so the
 *  interpolation buys nothing the crash site's own stack does not already give. */
function assertNever(_event: never): never {
  throw new Error('Unhandled question pick event')
}

/** This question's selection, or the shared empty one. The single read path into the nested maps, so
 *  the reducer's arms never index them by hand. */
function selectionIn(
  state: QuestionPicksState,
  questionBatchId: string,
  questionIndex: number
): QuestionSelection {
  return state.picks.get(questionBatchId)?.get(questionIndex) ?? EMPTY_QUESTION_SELECTION
}

/** Structural equality over a selection — `optionIndices` element-wise, since it is held in a stable
 *  ascending order and so compares honestly position by position. */
function sameSelection(a: QuestionSelection, b: QuestionSelection): boolean {
  return (
    a.otherTicked === b.otherTicked &&
    a.otherText === b.otherText &&
    a.optionIndices.length === b.optionIndices.length &&
    a.optionIndices.every((position, i) => position === b.optionIndices[i])
  )
}

/**
 * Write one question's selection: the shared tail of all five write arms, so there is ONE same-value
 * guard and ONE copy-on-write rather than five of each.
 *
 * The guard returns `state` ITSELF when nothing moved, so zustand's `Object.is` short-circuit fires
 * and no subscriber wakes. This is the common case rather than an edge one — clicking an
 * already-selected radio is an ordinary operator action, not a mistake.
 *
 * Copy-on-write clones BOTH maps: neither held map is ever mutated in place, so a selection already
 * handed to a component stays valid and an untouched question's selection is carried across by
 * reference (so a component bound to it does not re-render). `ReadonlyMap` is a compile-time view over
 * a real `Map`, so `tsc` catches none of this — the test file's held-map assertions do.
 *
 * An emptied selection is LEFT IN THE MAP rather than pruned. Absent and all-empty are
 * indistinguishable through `selectQuestionSelection`, so pruning would be a branch with no
 * observable effect.
 */
function withSelection(
  state: QuestionPicksState,
  questionBatchId: string,
  questionIndex: number,
  next: QuestionSelection
): QuestionPicksState {
  if (sameSelection(next, selectionIn(state, questionBatchId, questionIndex))) return state

  const nextInner = new Map<number, QuestionSelection>(state.picks.get(questionBatchId) ?? [])
  nextInner.set(questionIndex, next)
  const nextPicks = new Map<string, ReadonlyMap<number, QuestionSelection>>(state.picks)
  nextPicks.set(questionBatchId, nextInner)
  return { ...state, picks: nextPicks }
}

/**
 * Pure reducer — no mutation, fresh state, and the SAME reference when nothing changes so an unchanged
 * slice does not churn selectors. A `switch` on the sealed union with an `assertNever` default, and
 * every arm spreading `state` so a later field added to `QuestionPicksState` survives every arm (the
 * audit #249 recorded after two arms silently dropped a new one).
 *
 * Not exported: `dispatch` is a synchronous, race-free seam and `createQuestionPicksStore()` is what
 * the tests drive, which keeps this module's exported surface to the five kinds the ticket asks for.
 */
function reduceQuestionPicks(
  state: QuestionPicksState,
  event: QuestionPickEvent
): QuestionPicksState {
  switch (event.type) {
    case 'optionPicked': {
      const current = selectionIn(state, event.questionBatchId, event.questionIndex)
      return withSelection(state, event.questionBatchId, event.questionIndex, {
        optionIndices: [event.optionIndex],
        otherText: current.otherText,
        otherTicked: false
      })
    }
    case 'optionToggled': {
      const current = selectionIn(state, event.questionBatchId, event.questionIndex)
      const ticked = current.optionIndices.includes(event.optionIndex)
      return withSelection(state, event.questionBatchId, event.questionIndex, {
        // Re-sorted on every add so the held order is ascending regardless of click order. Copies,
        // never a mutating `push`/`sort` on the held array — `sort` is in-place, so sorting
        // `current.optionIndices` directly would reorder an array already handed to a component.
        optionIndices: ticked
          ? current.optionIndices.filter((position) => position !== event.optionIndex)
          : [...current.optionIndices, event.optionIndex].sort((a, b) => a - b),
        otherText: current.otherText,
        otherTicked: current.otherTicked
      })
    }
    case 'otherPicked': {
      const current = selectionIn(state, event.questionBatchId, event.questionIndex)
      return withSelection(state, event.questionBatchId, event.questionIndex, {
        optionIndices: [],
        otherText: current.otherText,
        otherTicked: true
      })
    }
    case 'otherToggled': {
      const current = selectionIn(state, event.questionBatchId, event.questionIndex)
      return withSelection(state, event.questionBatchId, event.questionIndex, {
        optionIndices: current.optionIndices,
        otherText: current.otherText,
        otherTicked: !current.otherTicked
      })
    }
    case 'otherTextChanged': {
      const current = selectionIn(state, event.questionBatchId, event.questionIndex)
      return withSelection(state, event.questionBatchId, event.questionIndex, {
        optionIndices: current.optionIndices,
        otherText: event.text,
        otherTicked: current.otherTicked
      })
    }
    case 'dismissed': {
      // An unknown or already-cleared id keeps the SAME state reference — a deterministic,
      // non-throwing no-op absorbing a dismissal whose batch fell before a reconnect, or a
      // double-dismiss race, without killing the store. Nothing is recorded about the id: with no
      // `resolved` slice there is no ordering edge to guard.
      if (!state.picks.has(event.questionBatchId)) return state
      const picks = new Map(state.picks)
      picks.delete(event.questionBatchId)
      return { ...state, picks }
    }
    case 'reconnected': {
      // On every (re)handshake, drop every batch's picks: the daemon's connect-time re-send is the
      // sole repopulation truth for the new connection (#415), so a re-shown batch cannot inherit
      // stale picks. An already-empty map keeps its reference — a fresh `new Map()` would re-render a
      // consumer selecting under `Object.is` for no state change.
      if (state.picks.size === 0) return state
      return { ...state, ...initialQuestionPicksState }
    }
    default:
      return assertNever(event)
  }
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `dispatch` threads the pure
 * `reduceQuestionPicks`, mirroring `createQuestionBatchStore`'s body.
 *
 * THE `init` SEAM IS LOAD-BEARING, NOT TEST SUGAR. Seeding the singleton below is invisible to
 * `renderToStaticMarkup`: the server renderer reads `getServerSnapshot()`, which zustand wires to
 * `getInitialState()` — the state captured at store CREATION — so a seed-then-render test silently
 * asserts against the initial cell. Renderer tests in this repo are static server renders
 * (`environment: 'node'`, no jsdom, no @testing-library), so #912's panel spec needs `vi.mock` over
 * this module with `useQuestionPicksStore` bound to a per-file instance built here.
 *
 * `dispatch` is synchronous with no `await`, so two dispatches cannot interleave and the same-value
 * guard's check-then-act has no suspension point. The one hazard is RE-ENTRANCY: zustand notifies
 * subscribers synchronously inside `setState`, so a subscriber that dispatched during a notify would
 * recurse unbounded. Nothing does — the question bridge dispatches from the preload event callback and
 * the panel only reads.
 */
export function createQuestionPicksStore(init: QuestionPicksState = initialQuestionPicksState) {
  return createStore<QuestionPicksStore>((set) => ({
    ...init,
    dispatch: (event) => set((s) => reduceQuestionPicks(s, event))
  }))
}

/** App-wide singleton — the one source of truth the question bridge clears and #912's panel reads.
 *
 *  NEVER ATTACH THIS TO `window` as a debug handle, the rule `questionBatchStore.ts` records: a global
 *  would hand any injected script both a live write path into renderer state and a read path to every
 *  outstanding batch nonce. `dispatch` is otherwise reachable only from module importers. */
export const questionPicksStore = createQuestionPicksStore()

/** Narrow-slice React binding for #912. Selecting a single question's selection avoids cross-facet
 *  re-renders. */
export function useQuestionPicksStore<T>(selector: (s: QuestionPicksStore) => T): T {
  return useStore(questionPicksStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one batch and one question position, matching
 * `selectBatchFor` / `selectLastReadFor`. It is safe to call inline in a render with no `useMemo`:
 * a fresh function identity is produced per render, but `useStore` compares the selector's RESULT
 * under `Object.is`, and both branches below are reference-stable.
 *
 * An untouched question answers with the shared `EMPTY_QUESTION_SELECTION`, not `null`, and that
 * collapses nothing: absent and all-empty are the SAME state here by construction, since the reducer
 * leaves an emptied selection in place. This is deliberately not the collapse
 * `conversationLastReadStore` warns against inheriting from `queueStore` — there, `0` and never-read
 * are genuinely different readings a consumer must branch on; here there is no second reading to lose,
 * and #912 draws the same rows either way.
 *
 * A picked question answers with the HELD selection by reference, stable across a write to any sibling
 * question or batch (the copy-on-write in `withSelection`), so a bound component re-renders only when
 * ITS question's selection changes.
 *
 * An unknown batch id or question position is a legitimate query, never an error — the same
 * deterministic non-throwing discipline the reducer's unknown-id arm holds.
 */
export const selectQuestionSelection =
  (questionBatchId: string, questionIndex: number) =>
  (s: QuestionPicksState): QuestionSelection =>
    selectionIn(s, questionBatchId, questionIndex)
