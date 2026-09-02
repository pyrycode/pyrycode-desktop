# 911 — Question picks store

Hold what the operator has picked so far while a question batch is open, keyed per question and by
option position, and clear it exactly when the batch itself is cleared.

Split from [#908](https://github.com/pyrycode/pyrycode-desktop/issues/908) (grandchild of
[#851](https://github.com/pyrycode/pyrycode-desktop/issues/851)).

## Files read

- `src/renderer/src/store/questionBatches.ts` → `Question`, `QuestionOption`, `QuestionBatchEvent`,
  `reduceQuestionBatches`, `selectBatchFor` — the held-batch model this store must stay *separate*
  from, and the source of the clearing arms this one mirrors.
- `src/renderer/src/store/questionBatchStore.ts` → `createQuestionBatchStore`, `questionBatchStore`,
  `useQuestionBatchStore` — the DI-factory → singleton → hook → selectors structure this module
  clones, and the `init`-seam rationale (`getServerSnapshot()` reads the state captured at store
  *creation*) that #912's panel spec will need.
- `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent`, `subscribeQuestionBatches`,
  `useQuestionBridge` — the single daemon-event subscriber this store is fed from; its docblock
  records why the subscriber count is a considered number.
- `src/renderer/src/store/conversationLastReadStore.ts` → `ConversationLastReadState`,
  `createConversationLastReadStore`, `clearAllLastRead`, `selectLastReadFor` — the repo's
  `ReadonlyMap`-keyed-by-a-daemon-asserted-string precedent, including the written rationale for
  `ReadonlyMap` over `Record` and the copy-on-write / same-reference-clear discipline.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionPanelView` — where the option
  rows and the Other row are drawn, and where the `key={index}` decision already establishes array
  position as the option's client-side identity. Also the source of the "Other row is *inside* the
  list but is not an entry in `question.options`" fact this store's shape depends on.
- `src/renderer/src/store/questionBatchStore.test.ts`, `src/renderer/src/store/questionBridge.test.ts`
  → the fixture and `fakeBridge()` idioms this slice's tests extend.
- `docs/knowledge/features/question-batch-model.md` § The bridge, § Edge cases — the family's
  never-log rule, the never-key-on-claude-authored-text rule, and the record that
  `source: 'timeout'` is a shape fixture that must never be copied into a test.
- `docs/knowledge/features/conversation-last-read-store.md` is *not* read as an authority here; the
  code is, because the storage decision (`Map`, copy-on-write, same-reference clear) is in the module.

## Design source

**Figma:** N/A — the ticket carries no `## Figma` section and states "Not UI-visible: no store state
reaches the screen in this slice." The visual-fidelity check is intentionally skipped; #912 wires the
panel and owns the render.

## Context

`claude` pauses a turn to ask the operator a batch of clarifying questions. `questionBatchStore` holds
what the daemon said; the panel frame (#906) and its option rows (#907) draw it, both deliberately
inert. This slice holds what the *operator* has said back, so nothing already chosen is lost while the
question is still open.

Two constraints shape it before any code:

- **The picks cannot live in panel-local `useState`.** `PairedShell` keys `ConversationScreen` on the
  active conversation id, so switching chats remounts the whole conversation subtree and destroys every
  `useState` inside it. That keying is deliberate (#670, pinned by
  `e2e/conversation-switch-remount.spec.ts` using the composer draft as its observable), so
  panel-local state and "picks survive a switch" are in direct conflict. The picks live outside the
  keyed pane, in a store of their own.
- **The two stores stay separate.** The picks are not hung off the held batch, and this store never
  reaches across to read `Question.multiSelect`. Whether a question replaces or accumulates arrives
  *with the pick*.

No ADR is warranted: this reuses [ADR 0009](../decisions/0009-modal-prompt-model.md)'s discipline
(renderer-local sealed event union, `switch` + `assertNever`, same-reference-on-no-op) with no
amendment, exactly as `questionBatches.ts` did. The one departure from 0009's "ordered array +
scan-by-id" is argued below and follows an existing in-repo precedent rather than opening a new
question.

## Design

One production module, `src/renderer/src/store/questionPicksStore.ts`, with the reducer inline — the
repo's dominant store shape (`modalStore.ts`, `queueStore.ts`, `conversationLastReadStore.ts`). No
second module is minted: `questionBatches.ts` + `questionBatchStore.ts` are two files because they
were two tickets.

### The held shape

```ts
/** One question's selection so far. Absent ≡ all-empty, by construction. */
interface QuestionSelection {
  optionIndices: readonly number[]   // positions in that question's own `options`, ASCENDING
  otherText: string                  // held independently of `otherTicked`
  otherTicked: boolean
}

interface QuestionPicksState {
  // questionBatchId → (question position → that question's selection)
  picks: ReadonlyMap<string, ReadonlyMap<number, QuestionSelection>>
}
```

**A pick is an option's POSITION, never its label.** `QuestionOption` carries no `id` by design
(#898: claude's answer protocol selects an option by its `label`, so the label is the option's
identity *on the wire*). Keying a pick by the label would put untrusted claude-authored text in a
lookup path — the failure mode `questionBatchStore.ts` and `QuestionPanel.tsx` each name by hand.
`QuestionPanelView` already renders its rows with `key={index}` for exactly this reason, so position
is the client-side identity on both sides. Resolving a position back to a label at answer time is
#853's job.

**The Other row is not an entry in `question.options`.** The panel draws it after the mapped options
but inside the same list container, so its pick is typed text plus a ticked flag, never an index.
That is why `otherText` / `otherTicked` are their own fields rather than a sentinel index.

**`optionIndices` is held in ascending display order, not click order.** Deterministic: two different
tick sequences ending at the same set produce the same value, which keeps the same-value guard below
honest and makes #853's answer list read in claude's own display order rather than the operator's.

**`ReadonlyMap`, not a `Record` and not an ordered array.** The outer key is `questionBatchId`, a
daemon-asserted one-time nonce; `conversationLastReadStore` is the direct precedent and its rationale
transfers verbatim — `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
`Map.prototype.set('__proto__', v)` creates an ordinary own entry, so hostile keys are unremarkable
*by construction* rather than by validation. Consequences pinned here because none is a type error:
nothing is keyed into an object literal, there are no computed object keys on any write path, and
`Object.fromEntries` / spreading the map into an object / `JSON.stringify` of the map are all out.
ADR 0009's ordered array is not copied because its justification does not transfer: `outstanding`
holds *display-ordered content*, whereas this is a pure lookup with no order of its own. The inner
map is keyed by `number`, which has no key hazard at all.

**Absent means untouched; there is no `shown` arm.** A batch's picks come into being on the first
pick. This store never mirrors the held batch's arrival, so an untouched batch holds nothing and a
re-shown batch cannot inherit stale picks — `reconnected` already covers the daemon's connect-time
re-send.

### The event union

Seven arms, each named for its behaviour rather than carrying a `multiSelect: boolean` flag. A
boolean at the call site is invertible with no type error and both id-ish fields around it are
`string`; a named arm cannot be sent backwards silently.

| arm | fields | effect |
|---|---|---|
| `optionPicked` | `questionBatchId`, `questionIndex`, `optionIndex` | **Single-select.** Replaces that question's option pick with exactly `[optionIndex]` **and clears `otherTicked`** (mutually exclusive). `otherText` untouched. |
| `optionToggled` | same | **Multi-select.** Adds the position if absent, removes it if present; other positions and `otherTicked` untouched. |
| `otherPicked` | `questionBatchId`, `questionIndex` | **Single-select.** Sets `otherTicked` true and clears `optionIndices`. `otherText` untouched. Radio semantics: nothing un-ticks Other except picking an option. |
| `otherToggled` | `questionBatchId`, `questionIndex` | **Multi-select.** Flips `otherTicked`, leaving ticked option picks and `otherText` in place. |
| `otherTextChanged` | `questionBatchId`, `questionIndex`, `text` | Replaces `otherText`. Never touches `otherTicked` or `optionIndices`, in either shape. |
| `dismissed` | `questionBatchId` | Drops exactly that batch's picks. Unknown / already-cleared id → same state reference. |
| `reconnected` | — | Drops every batch's picks. Already-empty → same state reference. |

The clearing arms mirror `reduceQuestionBatches`' own. This family has no local dismissal — the
daemon's `dismissed` is the only way a batch leaves the held set — so there is no optimistic path to
keep in step, and no `resolved` id-memory (the #510 lesson `questionBatches.ts` records).

`dismissed` carries **only** `questionBatchId`: no `outcome`, no `source`. This store clears on any
dismissal regardless of cause, which is what satisfies the fail-closed reading rule at this layer.

### The reducer

`reduceQuestionPicks(state, event)` — pure, `switch` + `assertNever`, every arm spreading `state`.
The five write arms share one shape rather than five branches:

1. Read the current selection (or the empty one).
2. Compute `next` per arm — a fresh `QuestionSelection` literal, fields copied by name.
3. **One same-value guard** for all five: a structural `sameSelection(next, current)` compare
   (`otherTicked`, `otherText`, then element-wise `optionIndices`). Equal → return `state` itself, so
   zustand's `Object.is` short-circuit fires and no subscriber wakes. Re-clicking an already-selected
   radio is the common case this covers.
4. Otherwise copy-on-write **both** maps (`new Map(outer)`, `new Map(inner)`) and return fresh state.
   Neither held map is ever mutated in place.

An emptied selection is **left in the map rather than pruned**. Absent and all-empty are
indistinguishable by construction (the selector below collapses them), so pruning would add a branch
with no observable effect.

`reduceQuestionPicks` is *not* exported: the store's `dispatch` is a synchronous, race-free seam and
`createQuestionPicksStore()` is what the tests drive, which keeps the exported surface at the five
kinds the ticket asks for.

**The exhaustiveness guard throws a CONTENT-FREE message**, deviating from the sibling modules'
`` throw new Error(`Unhandled question event: ${JSON.stringify(event)}`) `` — a security-review
finding, not a style preference. Interpolating this union would put `questionBatchId` (a one-time
unguessable nonce) and `otherText` (operator-typed) into an `Error` message, and an `Error` message
is a sink: it reaches a stack trace, a crash reporter, and anything that catches and logs. The arm is
compile-time unreachable, so the interpolation buys nothing the crash site's own stack does not
already give. The sibling modules keep their existing form — sweeping them would be refactoring
adjacent code.

### Store, hook, selector

Cloning `questionBatchStore.ts` exactly:

```ts
type QuestionPicksStore = QuestionPicksState & { dispatch: (event: QuestionPickEvent) => void }

createQuestionPicksStore(init: QuestionPicksState = initialQuestionPicksState)  // vanilla createStore, DI seam
questionPicksStore                                                             // app-wide singleton
useQuestionPicksStore<T>(selector: (s: QuestionPicksStore) => T): T
selectQuestionSelection(questionBatchId, questionIndex)                         // the one read surface
```

The `init` seam is load-bearing rather than test sugar, for the reason `questionBatchStore` records:
seeding the singleton is invisible to `renderToStaticMarkup`, so #912's panel spec will need
`vi.mock` over this module with `useQuestionPicksStore` bound to a per-file `createQuestionPicksStore(init)`
instance.

`selectQuestionSelection` returns the held `QuestionSelection` **by reference**, or a hoisted,
module-private `EMPTY_QUESTION_SELECTION` constant when absent. The constant (not a fresh literal) is
the whole mechanism: a fresh object per selector call would fail `Object.is` on every render and spin
a consumer. Returning the empty selection rather than `null` collapses nothing — absent and all-empty
are the same state here, unlike `selectLastReadFor`'s `0`-vs-never-read, which is why that module's
warning against `?? EMPTY_*` does not bind. The constant is not exported: a consumer needs the
selector, not the sentinel.

No second selector is minted, and nothing is re-exported from `questionBatches.ts` — #898's model
answers no read about picks.

### Feeding it from the existing bridge

`questionBridge.ts` gains two things and no new channel subscription:

```ts
translateQuestionPickEvent(event: QuestionBatchEvent): QuestionPickEvent | null
subscribeQuestionBatches(onDaemonEvent, dispatch, dispatchPicks): () => void   // third param REQUIRED
```

`translateQuestionPickEvent` takes the **already-translated** `QuestionBatchEvent`, deliberately not a
`DaemonEvent`, so `translateQuestionEvent` stays the family's single reader of the daemon union and
this one switches over three arms rather than forty. `dismissed` → a fresh
`{ type: 'dismissed', questionBatchId }` literal; `connected`-derived `reconnected` → `{ type: 'reconnected' }`;
`shown` → `null`.

**The literal must be rebuilt by name, and `return event` would compile.** `QuestionBatchEvent`'s
dismissed arm is structurally assignable to `QuestionPickEvent`'s (excess-property checking does not
apply to a narrowed variable), so a `return event` would silently carry `outcome` and `source` into
this store. A key-set assertion in the spec is the guard, matching the existing spec's
`multi_select`-key idiom.

The third `dispatchPicks` parameter is **required, not optional**: `tsc` then enforces that every
caller wires both stores, and there is exactly one production caller. `useQuestionBridge` keeps its
`(): void` signature, so `App.tsx` is untouched and no second subscriber appears on the channel — one
`onDaemonEvent` call fanning out to two dispatches (AC5).

**The picks dispatch runs FIRST, before the batch dispatch** — a security-review finding, and the one
ordering decision in this slice. Both run in the same synchronous listener turn, but zustand notifies
subscribers synchronously inside `setState`, so whichever store is written first has already woken
every subscriber before the second write happens. Picks-first makes the intermediate state "batch
still held, picks already cleared", which is indistinguishable from an untouched batch and is
therefore always coherent. Batch-first would make it "batch gone, picks still held" — a stale pick
outliving its batch at an observable instant, which is precisely what this store exists to prevent.
The property is stronger than the current consumer needs and is cheap to hold now; it would be
expensive to discover later.

`translateQuestionPickEvent`'s own exhaustiveness guard is content-free for the reason given above,
and deliberately does **not** reuse this file's existing `assertNever` — that one interpolates the
whole event, which for a `QuestionBatchEvent` is the nonce plus the four claude-authored strings. The
existing guard is left exactly as it is.

## State + concurrency model

Pure renderer state: no IPC, no preload bridge, no transport, no async task, no timer, no teardown.
The only feed is the existing question bridge's already-subscribed callback; the only other writer is
#912's panel.

`dispatch` is a synchronous `set` with no `await` inside the updater, so two dispatches cannot
interleave and the same-value guard's check-then-act has no suspension point. The one reachable
hazard is re-entrancy — zustand notifies subscribers synchronously inside `setState` — and nothing
dispatches from a store subscription: the bridge dispatches from the preload event callback and the
panel only reads.

Growth is bounded by **operator action**, not by daemon traffic: an entry exists only for a batch the
operator has actually picked in, and it is dropped by that batch's `dismissed` or by any reconnect.
No cap, no eviction, matching the family's refusals — no growth failure has been observed.

## Error handling

No I/O, no parse, no async surface, so no `Result` type and nothing to surface to the UI. The
deterministic non-throwing discipline is the whole error model: an unknown `questionBatchId`, an
already-cleared id, a reconnect holding nothing and a repeat of the same pick are each a
same-reference no-op rather than a throw. `assertNever` is the only throw and is reachable only on a
compile-time-impossible unhandled arm.

Indices are **client-originated** (the panel's own `.map` index), never daemon-asserted, and are
deliberately not validated against the held batch — doing so would require exactly the cross-store
read the ticket forbids. See the security review for what that hands forward.

**Nothing here logs.** No logger import, no `console.*`. `questionBatchId` is a one-time unguessable
nonce and the four claude-authored strings must not reach a sink either — the absence
`questionBatches.ts`, `questionBatchStore.ts` and `questionBridge.ts` each already record. No
`observe?` diagnostics seam, for the same reason.

## Testing strategy

Plain vitest, no DOM and no `renderToStaticMarkup` — both modules are framework-free at the seams
under test. Fixtures follow `questionBatchStore.test.ts`'s idiom, with the batch ids distinct so an
exact `toEqual` catches a transposition `tsc` cannot.

`src/renderer/src/store/questionPicksStore.test.ts`:

- **AC1** — single: a second `optionPicked` on one question replaces the first. Multi: `optionToggled`
  accumulates; toggling a ticked position removes just that one, leaving the others.
- **AC2** — `optionPicked` clears `otherTicked` but leaves `otherText`; `otherPicked` clears
  `optionIndices` but leaves `otherText`; `otherToggled` leaves ticked option picks *and* the text;
  `otherTextChanged` never moves the tick, in either shape.
- **AC3** — two questions in one batch hold independent selections; two batches hold independent
  picks; ascending order held regardless of toggle sequence; a `toEqual` on the state proves no
  claude-authored string appears anywhere in it.
- **AC4** — `dismissed` drops exactly the named batch and leaves the sibling; an unknown and an
  already-cleared id each return the *same state reference* (`toBe`); `reconnected` drops everything;
  `reconnected` on empty returns the same reference.
- Same-value no-ops (`toBe` on state) for a repeat `optionPicked` and a repeat `otherTextChanged`.
- Copy-on-write: the previously held state's maps are untouched after a later write.
- DI isolation across two instances; the app singleton read-only (dispatching into it would leak into
  later tests in the file).
- The selector: absent → the empty selection, the *same reference* on two calls; present → the held
  object by reference.

`src/renderer/src/store/questionBridge.test.ts` (extended):

- **AC5** — `translateQuestionPickEvent` over all three `QuestionBatchEvent` arms, with an exact key-set
  assertion on the `dismissed` result proving `outcome`/`source` did not ride along.
- Through the seam with a `fakeBridge()`: a `questionDismissed` and a `connected` each drive **both**
  dispatches; a `questionShown` drives only the batch dispatch; `subscribeCalls()` is **1** — the
  no-second-subscriber claim, asserted rather than argued.
- End to end through a real `createQuestionPicksStore()` and a real `createQuestionBatchStore()`: a
  pick then a `questionDismissed` on that id empties both.

The 8 existing `subscribeQuestionBatches` call sites in that spec take the new required argument.

The `source: 'timeout'` value is never used in a fixture: it is upstream's shape fixture, minted
before any producer existed, and reads as coverage while pinning traffic that does not exist.

No Playwright spec: nothing renders in this slice, so there is no transition to drive. #912 owns the
survival proof across a conversation switch.

## Open questions

- **Does `optionIndices` want a `ReadonlySet` instead of an ordered array?** Resolved in the design
  above: an array, held ascending. A `Set` has no defined ordering contract the answer path can rely
  on, and the arrays here are at most a handful of small integers.
- **Should an emptied selection be pruned from the map?** Resolved: no — absent and all-empty are
  indistinguishable through the selector, so pruning is an unobservable branch.
- **Does #912 need a whole-batch selector as well as the per-question one?** Left open. The
  per-question slice is the narrower read and is what a single-question panel binds; if #852's
  navigation wants the whole batch at once it can add one then, against a real consumer.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings — and the design decision that makes it so is structural.** This
  store is incapable of holding claude-authored text: a `QuestionSelection` is two numbers-and-a-boolean
  fields plus one operator-typed string, and the only daemon-asserted value anywhere in the state is
  `questionBatchId`, used as a `Map` key and never as content. The one path from a `DaemonEvent` into
  this store runs through the existing `translateQuestionEvent` and then the new
  `translateQuestionPickEvent`, and carries exactly one field. `questionBatchStore.ts`'s standing
  obligation on the render slice (escape plain text, never a raw-markup sink, an attribute, a URL, a
  filename, a cache key, a lookup path or a log) therefore has nothing to bind on here. Handed to
  #912: `otherText` is operator-typed rather than claude-authored, but it is still a string bound into
  a controlled `<input value={…}>` — React's own escaping, never `dangerouslySetInnerHTML`.
- **[Tokens/secrets] No findings, resting on a decision: nothing is persisted.** `questionBatchId` is
  a one-time unguessable nonce and this store deliberately ships no storage port, unlike
  `conversationLastReadStore`. Persisting picks would put live nonces into a hand-editable
  `localStorage` blob for state whose entire lifetime is one open question. The `ReadonlyMap` choice
  is what keeps the nonce out of an object key space, and it forecloses `JSON.stringify(picks)` /
  `Object.fromEntries(picks)` / `{...picks}` — each of which would re-materialise it as an object key,
  which is also the shape that would make persistence look easy.
- **[File/storage] Not applicable** — no filesystem, no `localStorage`, no IndexedDB, no persistence
  at all (see above). No path is built from any held value.
- **[Electron attack surface] No findings.** No IPC channel, no `contextBridge` API, no `ipcMain`
  handler, no preload change, and no new `onDaemonEvent` subscription — the existing single subscriber
  fans out to a second dispatch, which the spec asserts with `subscribeCalls() === 1` rather than
  arguing. The singleton must never be attached to `window` as a debug handle, the rule
  `questionBatchStore.ts` records: `dispatch` is otherwise reachable only from module importers, and a
  global would hand an injected script both a live write path into renderer state and a read path to
  every outstanding nonce.
- **[Crypto] Not applicable** — no primitive, no RNG, no key, no nonce generation. The only comparison
  is `Map`'s internal key equality on `questionBatchId`, deliberately not `crypto.timingSafeEqual`:
  this is a local routing decision between two values the client already holds, not a secret compared
  against a guess (`removeById`'s stated reasoning, unchanged). A caller able to guess an id already
  holds a module import, and therefore already holds the whole state.
- **[Network & I/O] Not applicable** — no socket, no fetch, no frame, no timeout to set. On bounds:
  `otherText` is unbounded operator input in renderer memory, which the operator would have to type,
  and the number of held entries is bounded by **operator action** rather than by daemon traffic —
  an entry exists only for a batch the operator actually picked in. A daemon flooding `question_shown`
  creates zero entries here.
- **[Errors/logs] SHOULD FIX, fixed in the design above.** The family's `assertNever` idiom throws
  `` `Unhandled question event: ${JSON.stringify(event)}` ``. Cloned onto `QuestionPickEvent` that
  puts the nonce and the operator's typed text into an `Error` message — a sink that reaches stack
  traces and any catch-and-log. Both new exhaustiveness guards throw content-free messages instead;
  the arm is compile-time unreachable, so the interpolation buys nothing the crash site's stack does
  not already give. No logger import, no `console.*`, no `observe?` seam.
- **[Concurrency] SHOULD FIX, fixed in the design above.** `subscribeQuestionBatches` now performs two
  dispatches per event, and zustand notifies subscribers synchronously inside `setState`, so the
  intermediate state between them is observable. Batch-first would expose "batch gone, picks still
  held" — a stale pick outliving its batch. The picks dispatch is ordered **first**, making the gap
  state indistinguishable from an untouched batch. Otherwise: `dispatch` is synchronous with no
  `await`, so the same-value guard's check-then-act has no suspension point; no timer, no listener, no
  async task, nothing to abort; re-entrancy is unreachable because nothing dispatches from a store
  subscription (the bridge dispatches from the preload event callback, the panel only reads).
- **[Threat model] SHOULD FIX — handed to #853, with the scenario named.** A **compromised daemon**
  can re-deliver `question_shown` for a still-outstanding `questionBatchId` **mid-connection** with a
  different option list. `reduceQuestionBatches` replaces that batch in place, this store has no
  `shown` arm, so the held positions survive and now address different labels — the operator sees a
  pick ticked on a row they did not choose and may Continue into an answer they did not intend. The
  ticket's stated cover, "`reconnected` already covers the daemon's connect-time re-send", holds for
  the reconnect path only; the in-connection path is the one `reduceQuestionBatches`' own re-delivery
  arm keeps open. Not a MUST FIX: it needs a compromised daemon, it is recoverable at #853's
  resolution step (a held position is resolved against the **currently held** option list and must
  fail closed — never answer for an out-of-range position, never fall back to a neighbour), and
  holding positions rather than labels is what keeps the store from making it worse. Not fixed here
  because the ticket forecloses a `shown` arm by design; if defence in depth at this layer is wanted
  later, "a `shown` for a known id clears that batch's picks" is the one-arm change. Other threats:
  a hostile relay is on-path but content-blind and cannot forge a frame inside the Noise session; a
  compromised daemon forging `question_dismissed` costs the operator their picks, which is a
  convenience DoS the batch store already inherits; renderer compromise reaching the transport is
  unchanged, since this module holds no key, socket or token.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

None yet.
