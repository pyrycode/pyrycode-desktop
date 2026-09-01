# 899 — The Zustand container over the question-batch reducer

## Files read

- `src/renderer/src/store/questionBatches.ts` → `reduceQuestionBatches`, `initialQuestionBatchState`,
  `QuestionBatchState`, `QuestionBatchEvent`, `selectOutstandingBatches`, `selectBatchFor` — the pure
  model this slice wraps. Its docblocks carry the constraints this container inherits verbatim.
- `src/renderer/src/store/modalStore.ts` → `ModalStore`, `createModalStore`, `modalStore`,
  `useModalStore` — the near-verbatim clone target named by the ticket: factory → singleton → hook →
  re-exported selectors.
- `src/renderer/src/store/modalStore.test.ts` → the wiring-test idiom (initial state, dispatch threads
  the reducer, same-reference no-op, two-instance isolation) this slice's tests mirror.
- `docs/knowledge/features/question-batch-model.md` — #898's overview. § Edge cases is where the
  untrusted-text, never-key-on-claude-text, and never-log-the-nonce rulings live, and § "Security
  review: PASS" explicitly hands *store-level write serialisation* to this ticket, which § Security
  review below answers rather than defers again.
- `docs/knowledge/features/modal-store-bridge.md` § "The store" — records the modal container's
  no-`observe?` decision (the #202/#134 call) and its DI-factory → singleton → hook structure.
- `docs/specs/architecture/898-question-batch-model.md` § Security review — the predecessor's per-field
  provenance split, re-derived here rather than inherited (no transitive trust).
- `CLAUDE.md` § Build and test — renderer tests are static server renders (`environment: 'node'`, no
  `jsdom`, no `@testing-library`), which is why the factory in AC2 is load-bearing rather than sugar.

## Design source

No `## Figma` section on the ticket, and none is owed: this slice is headless. It adds no component, no
markup and no token read, and nothing mounts it — the panel slices (#851, #853) own every pixel. The
visual-fidelity check is intentionally not applicable here.

## Context

`claude`'s `AskUserQuestion` tool raises a batch of clarifying questions for the operator. The transport
half landed as two `DaemonEvent` arms (#885 `questionShown`, #895 `questionDismissed`); the pure state
model — types, sealed event union, reducer, selectors — landed in #898 as
`src/renderer/src/store/questionBatches.ts`, framework-free and imported by nothing.

This slice is its first consumer: the container that makes the reducer live renderer state. It is the
question vertical's counterpart to the container half of the modal vertical's #223, and it clones
`modalStore.ts`'s shape — a DI factory, an app singleton, a `dispatch` that is the only write path, and
a re-export of the model's narrow selector surface. Consumers arrive after: #900's bridge dispatches
into it, #851/#853's panel read from it. Nothing mounts or renders it here.

No ADR is warranted. ADR 0009's reducer discipline already covers the model, and the container adds no
normative decision of its own — it reuses the DI-factory → singleton → hook structure ADR 0008/#202
established and #223 reapplied. The documentation phase should fold this into
`docs/knowledge/features/question-batch-model.md` rather than mint a sibling overview.

## Design

One new file, `src/renderer/src/store/questionBatchStore.ts`, cloning `modalStore.ts` with the held
shape adjusted. Four exported symbols plus two re-exports:

```ts
export type QuestionBatchStore = QuestionBatchState & { dispatch: (event: QuestionBatchEvent) => void }

createQuestionBatchStore(init: QuestionBatchState = initialQuestionBatchState)  // vanilla createStore
questionBatchStore                                                             // app singleton
useQuestionBatchStore<T>(selector: (s: QuestionBatchStore) => T): T            // narrow React binding
export { selectOutstandingBatches, selectBatchFor } from './questionBatches'   // re-exported, never redefined
```

`dispatch` is `(event) => set((s) => reduceQuestionBatches(s, event))` — one call, no per-arm handling.
All three `QuestionBatchEvent` arms (`shown`, `dismissed`, `reconnected`) fold through it; a fourth arm
added later needs no change here, because the container never switches on `type`.

**No third selector is minted.** `selectBatchFor` already answers both panel-facing reads — which batch
belongs to a conversation, and (on the batch it returns) that batch's full ordered question list. #898
holds the question list on the batch on purpose; a `selectQuestionsFor` would be a second traversal of
the same array returning a nested field, and it would break referential stability for a consumer that
only needs the batch.

**No `observe?` diagnostics param**, matching `createModalStore`: the #134 instrumentation seam is
session-only, and a speculative observer would defend an unobserved need (the call #202 made and #223
repeated). Adding one would also be the single easiest way to put the nonce and claude-authored text
into a sink — see § Security review.

**The re-exported selectors typecheck against the store type without a cast.** A selector declared
`(s: QuestionBatchState) => T` is assignable where `(s: QuestionBatchStore) => T` is expected, since
`QuestionBatchStore` extends `QuestionBatchState` and function parameters are contravariant. Same
mechanism `useModalStore` + `selectOutstanding` already rely on; no `as`, per the ban on unchecked casts.

**`selectBatchFor(id)` is safe to call inline in a render.** It is a selector factory, so a fresh
function identity is produced per render, but `useStore` compares the selector's *result* under
`Object.is`, not the selector's identity — and `Array.prototype.find` returns the held batch object by
reference, stable while nothing changed. A panel author does not need `useMemo` around it. Worth stating
in the docblock, since the natural defensive reflex is to memoise the selector by conversation id.

## State + concurrency model

One store slice, `{ outstanding }`, orthogonal to `sessionStore` / `timelineStore` / `runConfigStore`
(Strangler Fig, ADR 0009): a question arrival re-renders only components selecting this slice.

**Write serialisation — the item #898's review handed forward.** `dispatch` is fully synchronous and
contains no `await`, so two dispatches cannot interleave on the renderer's single thread: each
`set(fn)` reads, reduces and assigns before the next observer runs. There is no check-then-act race,
because no caller reads state, awaits, then writes; the reducer receives the current state as its
argument inside the same tick it writes. The one reachable hazard would be **re-entrancy** — zustand
notifies subscribers synchronously inside `setState`, so a subscriber that dispatched during a notify
would recurse. No such subscriber exists or is planned: #900's bridge dispatches from the preload
event callback, never from a store subscription, and the panel slices only read. Named here so the
constraint is visible to whoever might later add a store-subscription-driven dispatch.

**Same-reference no-ops propagate correctly.** `reduceQuestionBatches` returns the input state by
reference for the unknown-id `dismissed`, empty-`questions` `shown`, and already-empty `reconnected`
arms. zustand's `setState` short-circuits on `Object.is(next, state)` and notifies nobody, so those
arms cost zero re-renders. Pinned by a test asserting `getState()` is referentially identical, not
merely equal.

**Lifetime and teardown.** The singleton is created at module import and lives for the window's
lifetime; there is no subscription, timer, socket or `AbortController` to tear down, so this slice adds
no cancellation path. Held state is per-connection by construction — the `reconnected` arm discards it
on every supervisor re-handshake.

**The factory is load-bearing, not test sugar.** Seeding the singleton is invisible to
`renderToStaticMarkup`: the server renderer reads `getServerSnapshot()`, which zustand v5 wires to
`api.getInitialState()` — the state captured at store creation — so a seed-then-render test silently
asserts against the initial cell. Renderer tests here are static server renders, so #851/#853 need a
per-file instance to seed (via `vi.mock` overriding only the `useQuestionBatchStore` binding). Shipping
`createQuestionBatchStore` now is what makes that possible.

## Error handling

No result type and no error surface: the container performs no I/O and returns nothing. `dispatch`
returns `void` and can throw only through the model's `assertNever`, reachable solely on a
compile-time-impossible unhandled arm — and a throw inside `set` happens before the assignment, so
state is left untouched. No log call in any path (see § Security review). Malformed input is not this
layer's concern: the two malformed-input classes are silent same-reference no-ops decided by #898's
reducer, and the shape boundary is the fail-closed decode (#884/#894) upstream in `src/shared/wire`.

## Testing strategy

`src/renderer/src/store/questionBatchStore.test.ts` — plain vitest, no DOM and no
`renderToStaticMarkup` (nothing here renders). The tests assert **the wiring**, the way
`modalStore.test.ts` does, not the reducer's branches, which `questionBatches.test.ts` already owns:

- `createQuestionBatchStore()` starts at the initial, empty outstanding set.
- `dispatch` threads the reducer: a `shown` appends one batch, asserted with an exact `toEqual` on
  **distinct** id values, so a transposition of the two adjacent `string` fields (`conversationId` /
  `questionBatchId`) reddens — `tsc` cannot see through same-typed fields.
- `dispatch` of `dismissed` for that `questionBatchId` empties `outstanding`.
- `dispatch` of `dismissed` for an unknown id leaves `getState()` **referentially identical** (`toBe`),
  pinning both the reducer's same-reference no-op and zustand's `Object.is` short-circuit.
- `dispatch` of `reconnected` clears a populated set — the third arm, proving the single
  `reduceQuestionBatches` call carries the whole union with no per-arm handling.
- `createQuestionBatchStore(init)` seeds from the passed state — the DI seam #851/#853 depend on.
- Two instances are isolated: dispatching into one leaves the other at initial state.
- The app singleton exists, exposes `dispatch`, and starts empty — asserted **read-only**, never
  dispatched into, so the module-level instance stays clean for any later test in the file.

Fixtures are local literals in the modal test's idiom: one `shown` event with two questions, the second
carrying `multiSelect: true` so a dropped nested field would show. The dismissal fixture uses the real
producer pair, `outcome: 'unanswered'` / `source: 'no_answer'` — **never** upstream's
`question_dismissed.json` `source: "timeout"`, which is a shape fixture minted before any producer and
would read as coverage while pinning traffic that does not exist.

No test for `useQuestionBatchStore`. A bare hook is untestable without a React renderer, and this repo
has none; `useModalStore`, `useDaemonEventBridge` and `useTimelineBridge` are all untested for the same
reason (the #202 precedent). Its behaviour is `useStore(singleton, selector)` and nothing else.

Gate: `npm test -- src/renderer/src/store/questionBatchStore.test.ts` plus `npm run build`.

## Open questions

- **File name.** `questionBatchStore.ts`, following `modalPrompts.ts → modalStore.ts`. Neither #900 nor
  #851 names an import path, so nothing downstream is pinned to a different one; a rename later would
  be cheap while the consumer count is zero. Resolved: proceed with `questionBatchStore.ts`.
- **Whether to re-export the `QuestionBatch` / `Question` types alongside the selectors.** `modalStore`
  does not — `modalStore.test.ts` imports `ModalPrompt` from `./modalPrompts` directly. Resolved: match
  the analogue, keep the container's surface to the selectors only, and let consumers import types from
  the model.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings, and the container moves no boundary — but it is the file the panel
  author reads.** Provenance is per-field and unchanged from #898: `conversationId` and
  `questionBatchId` are daemon-asserted; `question`, `header` and every option's `label` /
  `description` are claude-authored, crossed the subprocess trust boundary, and are neither bounded nor
  sanitized by the daemon. The shape boundary remains the fail-closed decode (#884/#894) in
  `src/shared/wire`, upstream of both files. What *changes* here is reach: this container is what makes
  the four untrusted strings addressable from React, and `useQuestionBatchStore` is the import a panel
  author (#851/#853) lands on first — they may never open `questionBatches.ts`. So the escaping
  obligation must be restated in this module's docblock rather than cited: plain text only, never
  `innerHTML` / `dangerouslySetInnerHTML`, never into an attribute, a URL, a filename, a cache key, a
  lookup path, or a log. Restating it is a Phase-B deliverable, not a nicety.
- **[Untrusted text as a key or lookup path] No findings — the container adds no keying, and must not.**
  Every comparison stays inside `reduceQuestionBatches` / `selectBatchFor`, each an `===` against a
  daemon-asserted id over the ordered array; the container introduces no `Map`, no `Record`, no object
  literal keyed by anything, and no memo cache. The specific hazard this slice creates is a *selector
  memo table*: `selectBatchFor` is a factory, so the reflex is to cache selectors per key. Keyed by
  `conversationId` that would be merely redundant; keyed by anything claude-authored (a `header` tab
  key, a `label` memo key — the two failure modes `events.ts` names) it would put untrusted text in a
  lookup path. The design forecloses it: no memo table is added, because the selector's *result* is
  already referentially stable and `useStore` compares results, not selector identities. Phase B must
  not add one as an "optimisation".
- **[Logging / the nonce] No findings — by construction, and the constraint is absence.**
  `questionBatchId` is a one-time unguessable nonce that must never reach a log, alongside the four
  claude-authored strings. This module adds no logger import, no `console.*`, and no `observe?`
  diagnostics param. That last omission is the live one: an observer hook on `dispatch` is the natural
  "clone `createTimelineStore` fully" move, and it would hand every event — nonce and untrusted text
  together — to an arbitrary sink in one line. It is deliberately not added, matching `createModalStore`.
- **[Tokens, secrets, credentials] Not applicable — none present, and the nonce is not one.** No token,
  key, credential or pairing material is read, held or derived. The container does now retain
  `questionBatchId` in a module-level singleton for the window's lifetime rather than in a call-scoped
  value; that is not a capability leak — receiving a retired batch id resolves nothing daemon-side, the
  value is dead once `questionDismissed` lands, and both `dismissed` and `reconnected` clear it. Plain
  `===` remains correct for matching it, not `crypto.timingSafeEqual`: a local routing decision between
  two values the client already holds, not a secret compared against a guess.
- **[File / storage operations] Not applicable — none.** No `fs` call, no path, no `localStorage` /
  `sessionStorage` / IndexedDB, no persistence, no rehydrate middleware. State is in-memory and
  per-connection; a `persist` wrapper would write claude-authored text and the nonce to renderer web
  storage, and is explicitly not used.
- **[Inter-process / Electron attack surface] No findings — no surface added.** No `BrowserWindow`, no
  `webPreferences`, no `contextBridge` API, no `ipcMain` channel, no protocol handler, no navigation.
  The module imports only `zustand` and `./questionBatches`; it holds no socket and no key, so the
  process-placement rule is satisfied, and would be violated only by importing from `src/main`. One
  concrete Phase-B constraint: **the singleton must not be attached to `window`** (no
  `window.__questionBatchStore` debug handle) — that would hand any injected script a live write path
  into renderer state through `dispatch`, which is otherwise reachable only from module importers.
- **[Cryptographic primitives] Not applicable — none used, and none should be.** No RNG (the container
  mints no id — every id is copied from the event by the reducer), no hash, no secret comparison.
- **[Network & I/O] Not applicable — no socket, no frame, no timeout.** The hostile-relay-adjacent
  concern that does reach this layer is unchanged and unanswered by design: an unbounded `questions`
  array or an unbounded string from a compromised daemon is held verbatim, bounded only by the
  transport's existing frame cap upstream. The container adds no cap, deliberately — a bound here would
  be stricter-than-wire and, with no `truncated_fields` in this family, would present claude's cut text
  as complete. Rendering cost of a hostile-sized batch is **OUT OF SCOPE**, and lands with the render
  slices #851/#853.
- **[Error messages, logs, telemetry] No findings.** No user-facing error string is produced and no
  daemon or claude-authored text can reach an error message from here: malformed input is a silent
  same-reference no-op decided upstream, and the only throw is the model's `assertNever` on a
  compile-time-impossible arm. No telemetry, no metrics.
- **[Concurrency] No findings — and this is the category #898's review handed forward.** Store-level
  write serialisation is answered in § State + concurrency model: `dispatch` is synchronous with no
  `await`, so no two dispatches interleave and no check-then-act race exists. The one reachable hazard
  is re-entrancy — zustand notifies subscribers synchronously inside `setState`, so a subscriber that
  dispatched during a notify would recurse unbounded. It is unreachable as designed (#900 dispatches
  from the preload event callback, the panel slices only read) and is named in the docblock so a later
  store-subscription-driven dispatch is a considered choice rather than an accident. No promise, timer,
  listener or `AbortController` is created, so there is nothing to cancel on teardown.
- **[Threat model alignment] Two named, one answered here, one deferred.** *Hostile daemon response* —
  reaches this container only as an already-shape-checked event dispatched by #900; the container's
  contribution is that it stores every field opaquely and keys on nothing, so a hostile value can at
  worst occupy memory and be rendered (escaped) downstream. *Renderer compromise reaching the
  transport* — unchanged: the module imports nothing from `src/main`, exposes no global, and grants no
  capability the renderer did not already have. *Reading an unrecognised dismissal `source` as an
  answer* stays **OUT OF SCOPE** — the container never reads `source`, and the constraint binds on
  whatever later reads it for display, arriving with the answer path (upstream pyrycode#1907).

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
