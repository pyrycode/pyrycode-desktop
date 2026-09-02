# Question-batch model

An id-addressed, ordered data model for the clarifying-question batches `claude`'s `AskUserQuestion`
tool raises during a desktop-driven interactive session — the question vertical's counterpart to
[modal-prompt model](modal-prompt-model.md), and the foundation the question panel's render vertical
builds on.

Introduced in [#898](https://github.com/pyrycode/pyrycode-desktop/issues/898), split from
[#850](https://github.com/pyrycode/pyrycode-desktop/issues/850). Lives at
`src/renderer/src/store/questionBatches.ts`. Pure renderer state — no React, no Zustand, no IPC, no
transport, and (deliberately) no imports at all. Reuses [ADR
0009](../decisions/0009-modal-prompt-model.md) rather than minting a sibling ADR: the discipline
(renderer-local camelCase types, sealed event union, `switch` + `assertNever`, same-reference-on-no-op,
ordered array scanned by id) transfers unchanged; nothing in this ticket re-opens 0009.

## What it does

`claude`'s `AskUserQuestion` tool raises a batch of clarifying questions for the operator to choose
from. The transport half landed first — [Question-shown wire
types](question-shown-wire-types.md)'s `questionShown`/`questionDismissed` `DaemonEvent` arms, decoded
fail-closed. This module holds the outstanding batches as a single, testable source of truth: which
batch (if any) is outstanding for a given conversation, addressed by the daemon's one-time
`questionBatchId` nonce. There is no Zustand store, no React hook, no wire-type import in *this* module
— that's the sibling `questionBatchStore.ts` (§ The Zustand container, below), which wraps this reducer
without redefining it. The `DaemonEvent → QuestionBatchEvent` bridge has since shipped in
[#900](https://github.com/pyrycode/pyrycode-desktop/issues/900) (§ The bridge, below).

## How it works

### Types

```ts
interface QuestionOption { label: string; description: string }   // no `id` — label IS the identity

interface Question {
  question: string
  header: string
  options: readonly QuestionOption[]
  multiSelect: boolean   // the one renamed field; wire keeps multi_select across IPC
}

interface QuestionBatch {
  conversationId: string
  questionBatchId: string
  questions: readonly Question[]
}

type QuestionBatchEvent =
  | { type: 'shown'; conversationId: string; questionBatchId: string; questions: readonly Question[] }
  | { type: 'dismissed'; questionBatchId: string; outcome: string; source: string }
  | { type: 'reconnected' }

interface QuestionBatchState { outstanding: readonly QuestionBatch[] }
```

`QuestionBatch` is the durable held content; `QuestionBatchEvent` is the renderer-local (camelCase)
input the reducer consumes — the stable target contract #900's bridge maps the wire-shaped
`DaemonEvent` arms onto. `outstanding` is an **ordered array**, not a `Map`/`Record`, correlated by
`questionBatchId` — the same shape `modalPrompts.ts`'s `outstanding` takes, for the same reasons (ADR
0009 § "Ordered array + scan-by-id, not a Map"): the selector returns the array by reference, and
insertion order survives without leaning on key ordering.

**Three deliberate departures from `ModalPrompt`/`ModalEvent`/`ModalState`**, all decided by this
ticket rather than inherited from ADR 0009:

- **Two nesting levels, not one.** `options` hangs off each `Question`, not off the batch — the panel's
  header tabs and Previous button need every question, and each question's options, in hand at once.
  A near-verbatim clone of the modal shape gets this wrong by default, since `ModalShownPayload.options`
  is flat.
- **No `id` on `QuestionOption`, and no `defaultOptionId` on `QuestionBatch`.** Unlike `ModalOption`'s
  `{ id, label }`, claude's answer protocol selects an option by its `label`, so the label *is* the
  option's identity. A question batch has no fail-safe default the way a permission modal does.
- **No `resolved` id-memory in `QuestionBatchState`, and that is a decision rather than an omission.**
  `ModalState` carries a `resolved: readonly string[]` slice ([#195](../codebase/195.md)) because the
  modal client answers *optimistically* — `answerModal` dispatches `dismissed` locally even when the
  send is swallowed by a downed transport — so it can hold an id the daemon does not consider resolved.
  This vertical has **no answer frame at all** (upstream pyrycode#1907 is where one would land): nothing
  dismisses a batch locally, the daemon's `dismissed` is the only exit, and the daemon does not re-send
  a batch it has already retired. `resolved` here would defend a failure that cannot occur, and
  [#510](../codebase/510.md) (in [modal-prompt model](modal-prompt-model.md) § Edge cases) is the record
  of what that costs when it outlives its justification: a retained id suppressed the daemon's
  legitimate re-delivery, and an operator's explicit Allow decayed into a timeout deny. The slice
  arrives with the answer path, the way the modal vertical added `rejected`/`rejectionDismissed` in
  [#249](../codebase/249.md).

An **empty `questions` array installs nothing** — the fourth, ticket-settled decision, orthogonal to the
three above. [Question-shown wire types](question-shown-wire-types.md) records that an empty batch is
out of contract daemon-side (a producer bug), but crosses the transport unchanged since the transport
polices type, not membership. A batch with no questions cannot be answered and would put an
un-answerable panel on screen, so `shown` with `questions: []` is a same-state-reference no-op — matching
the unknown-id `dismissed` no-op below, and checked **before** the re-delivery match so an empty
re-delivery for a still-outstanding id leaves the good batch standing rather than replacing it with an
unanswerable one.

### The reducer

`reduceQuestionBatches(state, event): QuestionBatchState` is pure and exported — no mutation, fresh
state, `switch` on `event.type` with an `assertNever` default, every arm spreading `state` (the audit
[#249](../codebase/249.md) recorded in the modal vertical after two arms silently dropped a new field):

| event | effect |
|---|---|
| `shown` | an empty `questions` array → same `state` reference (see above). Otherwise build a fresh `QuestionBatch` literal copying each field **by name** (never spreading the event, never deriving `conversationId` from the nonce); a still-outstanding `questionBatchId` is replaced **in place** via `map` (position and length preserved, re-delivered fields win — carries over the [#195](../codebase/195.md) idempotency finding), an unseen id appends. |
| `dismissed` | `removeById` on `questionBatchId`; no match → same `state` reference, a deterministic non-throwing no-op absorbing an unknown or already-dismissed id. Clears on **any** `outcome`/`source`, regardless of value — the reducer never reads either field, which is what satisfies the never-read-an-unrecognised-`source`-as-an-answer rule at this layer. No `resolved` slice to poison, since none exists (see above). |
| `reconnected` | clears `outstanding` so the daemon's connect-time re-send is the sole repopulation truth for the new connection ([#415](../codebase/415.md)'s finding, reapplied) — a still-outstanding batch re-appends via `shown`, absence means resolved-while-away. An already-empty set keeps its reference; a reconnect holding nothing is a same-`state` no-op. |

`initialQuestionBatchState = { outstanding: [] }`. `selectOutstandingBatches` returns the slice by
reference (parity with `selectOutstanding`, so #899 has the whole-set read it re-exports).
`selectBatchFor(conversationId)` is a selector *factory* matching `selectHasOutstandingFor`: an `===`
scan via `Array.prototype.find` over the ordered array, answering with the **first** match in insertion
order. The reducer does not enforce one batch per conversation — nothing observed says the daemon raises
two concurrently, and enforcing it would invent a replacement rule for traffic no one has seen; the
ordered-array-scanned-by-id shape keeps a future one-per-conversation rule a one-arm change. An unknown
conversation id answers `undefined`, never an error.

### Internal helpers (unexported)

- `removeById(outstanding, questionBatchId)` — filters by id, returning the **same array reference**
  when nothing was removed. Mirrors `modalPrompts.ts`'s helper of the same name and contract.
- `assertNever(event)` — the compile-time exhaustiveness guard, reused verbatim from `modalPrompts.ts`.

### The Zustand container (`questionBatchStore.ts`)

Introduced in [#899](https://github.com/pyrycode/pyrycode-desktop/issues/899), the reducer's first
consumer — the question vertical's counterpart to [modal store + bridge](modal-store-bridge.md)'s
`modalStore.ts`, and a near-verbatim clone of its DI-factory → singleton → hook → selectors shape:

```ts
export type QuestionBatchStore = QuestionBatchState & { dispatch: (event: QuestionBatchEvent) => void }

createQuestionBatchStore(init: QuestionBatchState = initialQuestionBatchState)  // vanilla createStore, DI seam
questionBatchStore                                                             // app-wide singleton
useQuestionBatchStore<T>(selector: (s: QuestionBatchStore) => T): T            // useStore(questionBatchStore, selector)
export { selectOutstandingBatches, selectBatchFor } from './questionBatches'   // re-exported, never redefined
```

`dispatch` is `(event) => set((s) => reduceQuestionBatches(s, event))` — one call, no per-arm handling,
so a fourth `QuestionBatchEvent` arm needs no change to this file. No third selector is minted:
`selectBatchFor` already returns both panel-facing reads (which batch belongs to a conversation, and,
on that batch, its full ordered question list), matching the container's own no-redefinition rule.

No `observe?` diagnostics param, matching `createModalStore`: the #134 instrumentation seam is
session-only, and an observer here would be the easiest way to hand `questionBatchId` (a one-time
unguessable nonce) and the four claude-authored strings to an arbitrary sink in one line.
`selectBatchFor(id)` is safe to call inline in a render with no `useMemo` — it's a selector factory
producing a fresh function identity per render, but `useStore` compares the selector's *result* under
`Object.is`, and `Array.prototype.find` returns the held batch by reference, stable while nothing
changed. The singleton must never be attached to `window` as a debug handle — `dispatch` is otherwise
reachable only from module importers, and a global would hand any injected script a live write path
into renderer state.

**Write serialisation — the item this module's own security review handed forward.** `dispatch` is
fully synchronous with no `await`, so two dispatches cannot interleave: each `set(fn)` reads, reduces
and assigns before the next observer runs, and there is no check-then-act race. The one reachable
hazard is re-entrancy — zustand notifies subscribers synchronously inside `setState`, so a subscriber
that dispatched during a notify would recurse. Unreachable as designed: [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900)'s
bridge dispatches from the preload event callback, never from a store subscription, and the panel
slices only read.

**The factory is load-bearing, not test sugar.** Seeding the app singleton is invisible to
`renderToStaticMarkup`: the server renderer reads `getServerSnapshot()`, which zustand wires to
`getInitialState()` (the state captured at store creation), so a seed-then-render test against the
singleton silently asserts against the initial cell. Renderer tests here are static server renders
(`environment: 'node'`, no `jsdom`, no `@testing-library`), so the render slices — [#906](https://github.com/pyrycode/pyrycode-desktop/issues/906),
[#907](https://github.com/pyrycode/pyrycode-desktop/issues/907) and
[#908](https://github.com/pyrycode/pyrycode-desktop/issues/908)/[#853](https://github.com/pyrycode/pyrycode-desktop/issues/853) —
need a per-file `createQuestionBatchStore(init)` instance to seed, overriding only the
`useQuestionBatchStore` binding via `vi.mock`, exactly as `composerSlot.test.tsx` (#906) does.

`questionBatchStore.test.ts` asserts the wiring — initial state, `dispatch` threads the reducer through
all three arms, a same-reference no-op on an unknown `dismissed` id, DI-seeded init, two-instance
isolation, and a read-only check on the app singleton — not the reducer's branches, which
`questionBatches.test.ts` already owns. No test for `useQuestionBatchStore` itself: a bare hook is
untestable without a React renderer, which this repo has none of (the `useModalBridge`/#202 precedent).

[#900](https://github.com/pyrycode/pyrycode-desktop/issues/900)'s bridge dispatches into this store; the
panel slices ([#906](https://github.com/pyrycode/pyrycode-desktop/issues/906),
[#907](https://github.com/pyrycode/pyrycode-desktop/issues/907),
[#908](https://github.com/pyrycode/pyrycode-desktop/issues/908)/[#853](https://github.com/pyrycode/pyrycode-desktop/issues/853))
read from it via `useQuestionBatchStore`.

### The bridge (`questionBridge.ts`)

Introduced in [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900), the **fourth**
independent subscriber on the `onDaemonEvent` channel — the `announcedModelBridge` posture, not
`modalBridge`'s: `daemonEventBridge` owns the session arms, `timelineBridge` the stream arms and
`modalBridge` the modal arms, each returning `null` for the two question arms *permanently*, since none
of the three will ever claim them. This bridge owns exactly those two arms plus `connected`. It edits
none of the other three files.

```ts
translateQuestionEvent(event: DaemonEvent): QuestionBatchEvent | null
// Owns questionShown / questionDismissed / connected, each rebuilt as a fresh named-field literal
// (never `return event`, never a spread). Every other arm -> null via explicit fall-through case
// labels, then default: assertNever(event) — modalBridge's hard-guard form, not
// announcedModelBridge's `default: return null`.

subscribeQuestionBatches(onDaemonEvent, dispatch): () => void
// onDaemonEvent(event => { const qe = translateQuestionEvent(event); if (qe) dispatch(qe) })
// returns the exact off handle (the subscribeModal idiom) — pure, spy-testable, no React.

useQuestionBridge(): void
// useEffect(() => subscribeQuestionBatches(window.pyry.onDaemonEvent,
//   e => questionBatchStore.getState().dispatch(e)), [])
// StrictMode double-mount (mount -> cleanup -> mount) nets exactly one live listener.
```

**This bridge rebuilds, where `translateModalEvent` only filters.** The modal wire fields were already
camelCase field-for-field, so that translator copies them unchanged. This family has one renamed field
and it sits on the nested question row: `multi_select` → `multiSelect`, per the reducer's own
`multiSelect` field above — the nested rows otherwise cross IPC snake_case by settled house rule. The
compiler forces the split rather than leaving it to care: `readonly WireQuestion[]` is not assignable to
`readonly Question[]` (the `multi_select`/`multiSelect` mismatch), so the `questions.map(...)` rebuild
is mandatory; `WireQuestionOption[]` *is* assignable to `readonly QuestionOption[]`, so each question's
`options` is assigned by reference, no cast, no copy — matching `translateModalEvent`'s
`options: event.options` and this module's own by-reference hold of `questions` one level up. **There is
no rename at the option level** — `WireQuestionOption`/`QuestionOption` are both exactly
`{ label, description }` — and inventing a per-option rebuild here is this family's easiest mistake to
make by over-generalizing the two-nesting-level warning that runs through this vertical's docblocks
(that warning is about *where* `options` hangs, off each question rather than off the batch, never a
claim that a field is renamed at both levels).

`connected` maps to a payload-free `{ type: 'reconnected' }`, ignoring `event.ack`, so every supervisor
(re)handshake clears `outstanding` and the daemon's connect-time re-send is the sole repopulation truth
— the same `#415` call `translateModalEvent` makes. `questionDismissed` carries `outcome`/`source`
through verbatim though the reducer reads neither; `source` is deliberately read as an opaque `string`,
never `WireModalSource`, matching § Edge cases below.

`null` here means "not our arm", never "bad data": a malformed frame is rejected upstream by
`parseQuestionShownPayload`'s fail-closed decode before any event is emitted, which is also why the
`.map` in the `questionShown` case is total over `questions`.

**Wired into `App.tsx` since [#906](https://github.com/pyrycode/pyrycode-desktop/issues/906).** Through
that ticket `useQuestionBridge` shipped dormant, matching how #223 left `useModalBridge` unmounted for
\#224; #906 is the production caller, mounting it beside `useModalBridge`. No `useQuestionBridge` test
exists for the same reason `useModalBridge` has none: a bare hook is untestable without a React renderer,
and this repo has none. The StrictMode double-mount claim is instead proven at the
`subscribeQuestionBatches` seam directly — the spec's `fakeBridge()` tracks a **set** of live listeners
with per-subscription off handles (not the single captured listener `modalBridge.test.ts`'s fake uses),
because a single-listener fake cannot distinguish "the cleanup ran" from "the second mount overwrote the
first," which is exactly AC5's claim.

**Fans out to a second store since [#911](https://github.com/pyrycode/pyrycode-desktop/issues/911), with
no fifth channel subscription.** `subscribeQuestionBatches` gained a required third parameter,
`dispatchPicks: (event: QuestionPickEvent) => void` — required rather than optional so `tsc` enforces
that every caller wires both stores, and there is exactly one production caller (`useQuestionBridge`,
signature unchanged, so `App.tsx` needed no edit). A new `translateQuestionPickEvent(event:
QuestionBatchEvent): QuestionPickEvent | null` takes the *already-translated* `QuestionBatchEvent`, never
a raw `DaemonEvent`, so `translateQuestionEvent` stays this family's single reader of the daemon union —
the new switch covers three arms (`dismissed` to `dismissed`, `connected`-derived `reconnected` to
`reconnected`, `shown` to `null`) rather than forty-one. Each clearing literal is rebuilt by name rather
than returned verbatim: `QuestionBatchEvent`'s `dismissed` arm is structurally assignable to
`QuestionPickEvent`'s narrower one (excess-property checking does not apply to a narrowed variable), so
`return event` would compile clean while silently carrying `outcome`/`source` into a store that must
never hold them — caught only by the spec's exact key-set assertion, not by `toEqual`.

**The picks dispatch runs first, before the batch dispatch, and the order is load-bearing.** Both run in
the same synchronous listener turn, but zustand notifies subscribers synchronously inside `setState`, so
whichever store is written first has already woken every subscriber before the second write happens.
Picks-first makes the intermediate state "batch still held, picks already cleared" — indistinguishable
from an untouched batch, and therefore always coherent. Batch-first would expose "batch gone, picks still
held": a stale pick outliving its batch at an observable instant, which is precisely what the picks store
exists to prevent. See § The picks store, below, for the store this feeds.

### The picks store (`questionPicksStore.ts`)

Introduced in [#911](https://github.com/pyrycode/pyrycode-desktop/issues/911), split from
[#908](https://github.com/pyrycode/pyrycode-desktop/issues/908) (grandchild of
[#851](https://github.com/pyrycode/pyrycode-desktop/issues/851)): what the **operator** has picked so far
in an open batch, deliberately separate from the held-batch model above — this module never hangs picks
off `QuestionBatch` and never reads `Question.multiSelect` back off it; which form a question uses
arrives *with* the pick instead. Lives at `src/renderer/src/store/questionPicksStore.ts`, one file with
the reducer inline — the repo's dominant store shape (`modalStore.ts`, `queueStore.ts`,
`conversationLastReadStore.ts`) rather than a second `questionBatches.ts`-style split, since #898/#899
were two files because they were two tickets, not because the house style requires it. It clones
`questionBatchStore.ts`'s DI-factory -> singleton -> hook -> selectors shape.

```ts
interface QuestionSelection {
  optionIndices: readonly number[]   // positions in that question's own `options`, ascending
  otherText: string                  // held independently of `otherTicked`
  otherTicked: boolean
}
interface QuestionPicksState { picks: ReadonlyMap<string, ReadonlyMap<number, QuestionSelection>> }

type QuestionPickEvent =
  | { type: 'optionPicked'; questionBatchId: string; questionIndex: number; optionIndex: number }   // single-select replace
  | { type: 'optionToggled'; questionBatchId: string; questionIndex: number; optionIndex: number }  // multi-select accumulate
  | { type: 'otherPicked'; questionBatchId: string; questionIndex: number }    // single-select: tick Other, clear options
  | { type: 'otherToggled'; questionBatchId: string; questionIndex: number }   // multi-select: flip Other, leave options
  | { type: 'otherTextChanged'; questionBatchId: string; questionIndex: number; text: string }
  | { type: 'dismissed'; questionBatchId: string }
  | { type: 'reconnected' }

createQuestionPicksStore(init: QuestionPicksState = { picks: new Map() })  // vanilla createStore, DI seam
questionPicksStore                                                        // app-wide singleton
useQuestionPicksStore<T>(selector: (s: QuestionPicksStore) => T): T
selectQuestionSelection(questionBatchId, questionIndex)                    // the one read surface
```

Keyed `questionBatchId -> questionIndex -> QuestionSelection`: a `ReadonlyMap` of `ReadonlyMap`s, not a
`Record` and not an ordered array. The outer key is the same daemon-asserted one-time nonce
`conversationLastReadStore` already keys a `Map` by, and that module's rationale transfers verbatim —
`Map.prototype.get('__proto__')`/`.set('__proto__', …)` are ordinary own-key operations, so a hostile key
is unremarkable *by construction*, not by validation. This is the family's one deliberate departure from
ADR 0009's ordered-array-scanned-by-id: `outstanding` above holds display-ordered content, whereas this
is a pure lookup with no order of its own, so neither of the array's two justifications (insertion order;
selector returns the slice by reference) transfers. The inner map's `number` key has no hazard of any
kind.

**A pick is the option's position in `question.options`, never its label** — `QuestionOption` carries no
`id` by design (#898: claude's answer protocol selects by `label`, so the label is the identity *on the
wire*), and `QuestionPanelView` already draws its rows `key={index}` for the same reason — position is
the client-side identity on both sides. Resolving a position back to a label at answer time is #853's
job. The Other row is typed text plus a ticked flag rather than a sentinel index, since it is drawn
inside the option list container but is not an entry in `question.options` (`QuestionPanel.tsx:128-144`).
`otherText` is held independently of `otherTicked` in both shapes — clearing the tick leaves the text.

**Seven arms named for behaviour, not a `multiSelect` boolean flag.** A boolean at the call site is
invertible with no type error, so which form a question uses is told to this store *with* the pick,
never read back off `Question.multiSelect` in the other store. `optionPicked` (single-select) replaces
the option pick with exactly one position and clears `otherTicked`; `otherPicked` (single-select) is its
Other-row mirror, ticking Other and clearing every option pick — the two are mutually exclusive, radio
semantics. `optionToggled`/`otherToggled` (multi-select) each touch only their own field, so Other sits
alongside ticked options rather than excluding them. `optionIndices` is held in ascending display order
regardless of click order, so two tick sequences ending at the same set produce the same value — keeping
the reducer's same-value guard honest — and #853 reads the answer list in claude's own display order
rather than the operator's.

**`dismissed` drops exactly the named batch, `reconnected` drops every batch — there is no `shown` arm.**
A batch's picks come into being on the operator's first pick; an untouched batch holds nothing, so a
re-shown batch cannot inherit stale picks across a *reconnect*. (The one gap this leaves — a
**mid-connection** re-delivery of `question_shown` for a still-outstanding id with a different option
list — is a named, accepted risk; see § Edge cases, below.) An unknown or already-cleared id is a
same-state-reference no-op, mirroring `reduceQuestionBatches`' own clearing arms rather than inventing a
local dismissal — this family has no answer frame yet, so the daemon's `dismissed` is the only way a
batch leaves the held set, and there is no `resolved` id-memory here either (the same [#510](../codebase/510.md)
lesson § Types above already cites).

`selectQuestionSelection(questionBatchId, questionIndex)` answers with the held selection by reference, or
a hoisted `EMPTY_QUESTION_SELECTION` constant for an untouched question — never `null`, since absent and
all-empty are indistinguishable by construction (an emptied selection is left in the map rather than
pruned: pruning would be a branch with no observable effect). The constant, not a fresh literal per call,
is what keeps `useStore`'s `Object.is` result-compare from spinning a bound component on every render.

**The exhaustiveness guard throws a content-free message**, departing from the sibling modules'
`` `Unhandled …: ${JSON.stringify(event)}` `` form — a security-review finding, not a style choice.
Interpolating this union would put `questionBatchId` (a one-time unguessable nonce) and `otherText`
(operator-typed) into an `Error` message, which reaches a stack trace and any catch-and-log; the arm is
compile-time unreachable, so the interpolation buys nothing the crash site's own stack does not already
give. The sibling modules' existing guards are left exactly as they are — this is a lesson for the next
module that clones the family's `assertNever`, not a retrofit.

**The factory is load-bearing for the same reason as `questionBatchStore`'s.** Seeding the app singleton
is invisible to `renderToStaticMarkup` (the server renderer reads `getServerSnapshot()`, wired to the
state captured at store *creation*), so [#912](https://github.com/pyrycode/pyrycode-desktop/issues/912)'s
panel spec needs `vi.mock` over this module with `useQuestionPicksStore` bound to a per-file
`createQuestionPicksStore(init)` instance. `dispatch` is synchronous with no `await`, so two dispatches
cannot interleave and the same-value guard's check-then-act has no suspension point; the one named
hazard, re-entrancy via zustand's synchronous subscriber notification inside `setState`, is unreachable
as designed — the bridge dispatches from the preload event callback and the panel only reads. The
singleton must never be attached to `window` as a debug handle, the same rule `questionBatchStore.ts`
records.

Nothing landed on screen at first — the shape [#899](https://github.com/pyrycode/pyrycode-desktop/issues/899)
shipped in: a store landing with no consumer mounted. [#912](https://github.com/pyrycode/pyrycode-desktop/issues/912)
wired the panel to it, making the rows and the Other field respond, and proved the picks survive a
conversation switch in a new `e2e/question-picks.spec.ts`, built on the same pattern
`e2e/conversation-switch-remount.spec.ts` established for the composer's draft. See [Conversation shell —
modals § Question panel](conversation-shell-modals.md#question-panel-906-option-rows-since-907-live-since-912)
for the render-side design.

## Configuration and usage

[#906](https://github.com/pyrycode/pyrycode-desktop/issues/906) ends the dormant period: `useQuestionBridge`
now mounts app-level in `App.tsx`, beside `useModalBridge`, and `ConversationScreen.tsx`'s `ComposerSlot`
is the batch store's first reader — an outstanding batch for the conversation on screen draws the question
panel in the composer's slot and covers the whole `.composer` with the native `hidden` attribute. See
[Conversation shell — modals § Question
panel](conversation-shell-modals.md#question-panel-906-option-rows-since-907-live-since-912) for the render
vertical's design; this document still owns the model and the bridge underneath it. That slice drew the
panel's frame only — the title row, the question text, the separator, and an inert Cancel/Continue row —
with the option rows landing in [#907](https://github.com/pyrycode/pyrycode-desktop/issues/907). #908 was
meant to land the picks and the answer path together; it was split into
[#911](https://github.com/pyrycode/pyrycode-desktop/issues/911) (the picks store, § The picks store, above)
and [#912](https://github.com/pyrycode/pyrycode-desktop/issues/912), and closed as not planned without
shipping anything of its own. #911 landed the picks store headless, no consumer mounted; #912 wired the
panel to it, making the rows and the Other field respond. The answer path is still
[#853](https://github.com/pyrycode/pyrycode-desktop/issues/853)'s.

## Edge cases and limitations

- **Untrusted text, held opaquely.** `Question.question`, `Question.header`, and every option's
  `label`/`description` are claude-authored: they crossed the subprocess trust boundary and the daemon
  neither bounds nor sanitizes them. This module never inspects, parses, truncates or keys on them — the
  render slice owes the escaping (plain text only, never a raw-markup sink, never into an attribute, a
  URL, a filename, a cache key, a lookup path, or a log). See [Question-shown wire
  types](question-shown-wire-types.md) § Per-field provenance for the full per-field trust split.
- **No claude-authored value ever reaches a key or a lookup path, by construction.** `events.ts` names
  the two ways this family gets it wrong — "keying a tab by `header` or memoising by `label`." The
  design forecloses both structurally: `outstanding` is an ordered array scanned by
  `questionBatchId`, never a `Map`/`Record`/object literal keyed by anything, and every comparison in
  the module (`removeById`, the `shown` in-place match, `selectBatchFor`) is `===` against a
  daemon-asserted id. A future "optimisation" to a keyed container would reopen exactly this hazard —
  the array is load-bearing here, not merely ADR 0009 parity.
- **Nothing here logs, and that absence is load-bearing.** `questionBatchId` is a one-time unguessable
  nonce that must never reach a log, alongside the four claude-authored strings. There is no logger
  import and no `console.*` call in the module; `assertNever` is the only throw, reachable only on a
  compile-time-impossible unhandled union arm, never on a live event.
- **`dismissed`'s `source` is a plain open `string`, deliberately not a closed enum, and the reducer
  never reads it.** [Question-shown wire types](question-shown-wire-types.md) § Question dismissed has
  the full rationale: the producer's three real terminal paths all land on one pair,
  `outcome: "unanswered"` / `source: "no_answer"`, and upstream's `question_dismissed.json` shape
  fixture (`source: "timeout"`) predates any producer and is not live traffic — it must never be copied
  into a test and read as coverage. Clearing on any `source` value (recognised or not) is what satisfies
  the fail-closed reading rule at this layer; the constraint against reading an unrecognised `source` as
  an answer binds on whoever later reads it for display, out of scope here.
- **Bounds are deliberately not modelled**, the same call [Question-shown wire
  types](question-shown-wire-types.md) § Bounds made for the wire shape: an unbounded `questions` array
  or an unbounded string from a compromised daemon is held verbatim, bounded only by the transport's
  existing frame cap. Rendering cost of a hostile-sized batch is the render slice's bound to impose, not
  this reducer's.
- **Security review: PASS** (architect self-review, `docs/specs/architecture/898-question-batch-model.md`).
  No findings across trust boundaries, keying, logging, tokens, storage, IPC/Electron surface, crypto,
  network/I/O, error messages, or concurrency — all either not applicable (no I/O, no async surface, no
  secret) or answered by the array-scanned-by-id + never-logs-the-nonce design above.
- **The bridge is a shape boundary, not a trust boundary.** `translateQuestionEvent` (§ The bridge,
  above) rebuilds each question row but does not — and cannot — make the four claude-authored strings
  trusted; the untrusted→validated crossing already happened upstream in `parseQuestionShownPayload`.
  `string` carries no type-system signal for the difference on either side of the bridge, so the render
  slice's obligation to escape plain text only (never a raw-markup sink, never an attribute/URL/filename/
  cache-key/lookup-path/log) stands unchanged by this module existing.
- **The three pre-existing bridges' `null` arms for both question types are a permanent regression
  guard, not dormant scaffolding.** `daemonEventBridge`, `timelineBridge` and `modalBridge` will never
  claim `questionShown`/`questionDismissed` — [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900)
  added a fourth bridge rather than editing any of the three, and their `assertNever`-guarded exhaustive
  switches mean a change in ownership would be a compile error in whichever file lost the case.
- **Security review (#900): PASS.** No findings across trust boundaries, tokens/secrets, storage,
  IPC/Electron surface, crypto, network/I/O, error messages/logs, or concurrency — the bridge adds no
  IPC channel, no logger call and no comparison of any kind (`questionBatchId` matching stays
  `reduceQuestionBatches`' plain `===`, never `crypto.timingSafeEqual`); see
  `docs/specs/architecture/900-question-bridge.md` for the full review.
- **The picks store's no-`shown`-arm design has one accepted gap: a *mid-connection* re-delivery.** A
  compromised daemon could re-send `question_shown` for a still-outstanding `questionBatchId`, mid-
  connection, with a different option list; `reduceQuestionBatches` replaces that batch in place, but
  `questionPicksStore` has no `shown` arm, so the held positions survive and now address different
  labels — the operator could see a pick ticked on a row they did not choose. Not fixed at this layer by
  design: the ticket forecloses a `shown` arm (a batch's picks come into being only on the operator's
  first pick), it needs a compromised daemon, and it is recoverable at
  [#853](https://github.com/pyrycode/pyrycode-desktop/issues/853)'s answer-resolution step, which must
  resolve a held position against the **currently held** option list and fail closed on an out-of-range
  position rather than fall back to a neighbour. Holding positions rather than labels is what keeps this
  store from making the gap worse. If defence in depth is wanted later, "a `shown` for a known id clears
  that batch's picks" is the one-arm change. See `docs/specs/architecture/911-question-picks-store.md` §
  Security review for the full finding.
- **Security review (#911): PASS.** The picks store is structurally incapable of holding claude-authored
  text — a `QuestionSelection` is two numbers, a boolean and one operator-typed string, and the only
  daemon-asserted value in the state is `questionBatchId`, used as a `Map` key and never as content.
  Nothing is persisted (a nonce in `localStorage` for state whose whole lifetime is one open question
  would be worse than the `conversationLastReadStore` precedent it deliberately does not copy). Two
  SHOULD-FIX findings were fixed in the design itself rather than left as follow-ups: the exhaustiveness
  guards on both new switches (in `questionPicksStore.ts` and `questionBridge.ts`) throw content-free
  messages instead of the family's usual `${JSON.stringify(event)}`, since that form would put the nonce
  and the operator's typed text into an `Error` message; and the bridge's picks-before-batch dispatch
  order closes the observable-intermediate-state gap described in § The bridge, above. See
  `docs/specs/architecture/911-question-picks-store.md` § Security review for the full review, including
  the mid-connection re-delivery finding above.

## Testing strategy

`src/renderer/src/store/questionBatches.test.ts` — plain vitest unit tests, no DOM, no
`renderToStaticMarkup` (the module is framework-free, so nothing in it needs one). Fixture builders
mirror `modalPrompts.test.ts`'s idiom: a `shown(...)`/`dismissed(...)`/`reconnected()` with sensible
defaults and `Partial<Omit<Extract<…>>>` overrides, and a `run(...)` fold helper. One explicit test
asserts the module's import set is empty (AC1) — stronger than a denylist, since any future import of
any kind reddens the test rather than passing because it wasn't on a banned list. 32 tests green.

`src/renderer/src/store/questionBridge.test.ts` (#900) covers the bridge: `questionShown` → `shown` with
an exact `toEqual` and `conversationId`/`questionBatchId` distinct in the fixture (both are plain
`string`, so tsc cannot catch a transposition); the rebuilt question carries `multiSelect` and no
`multi_select` key, asserted on the key set since an extra key survives a loose match; each rebuilt
question's `options` is the same array/object references as the wire question's; `questionDismissed` →
`dismissed` including an unrecognised `source`, proving the field is not enum-checked; `connected` → a
payload-free `reconnected`; an inverse-filter table over the other 38 `DaemonEvent` arms, each
`toBeNull()`; `subscribeQuestionBatches` unit coverage; and an end-to-end pass through a real
`createQuestionBatchStore()` and the seam (no React) proving shown → dismissed drives `outstanding`
`[1] → []` and a `connected` after a `shown` clears the held set.

`src/renderer/src/store/questionPicksStore.test.ts` (#911, 25 tests) — plain vitest, no DOM: single vs
multi-select replace/accumulate, the Other tick clearing an option pick and vice versa in the
single-select shape while the multi-select shape holds them alongside each other, `otherText` moving
independently of `otherTicked` in both, two questions in one batch and two batches holding independent
selections, ascending order held regardless of toggle sequence, `dismissed`/`reconnected` same-state-
reference no-ops on an unknown/already-cleared id, copy-on-write across both map levels, DI isolation
across two instances, and the selector returning the same `EMPTY_QUESTION_SELECTION` reference on repeat
calls for an untouched question.

`questionBridge.test.ts` gained coverage for `translateQuestionPickEvent` over all three
`QuestionBatchEvent` arms — including an exact key-set assertion on the `dismissed` result proving
`outcome`/`source` did not ride along, the trap a bare `toEqual` misses — and for
`subscribeQuestionBatches`'s two-store fan-out: a `questionDismissed` and a `connected` each drive both
dispatches with picks landing first, a `questionShown` drives only the batch dispatch, and
`subscribeCalls() === 1` asserts the no-fifth-listener claim rather than arguing it. An end-to-end pass
through both real stores (no React) proves a pick then a matching `questionDismissed` empties both, and
that a `connected` clears a pick made against a still-outstanding batch. The 9 existing
`subscribeQuestionBatches` call sites in the file took the new required `dispatchPicks` argument.

## Related

- [Modal-prompt model](modal-prompt-model.md) — the sibling vertical's pure model + reducer, whose
  discipline this module clones under ADR 0009; also the source of the `resolved`/[#510](../codebase/510.md)
  lesson this module deliberately does not repeat.
- [Question-shown wire types](question-shown-wire-types.md) — the `questionShown`/`questionDismissed`
  `DaemonEvent` arms this module's events are the camelCase counterpart of, and the source of the
  empty-batch, open-`source`, and never-log-the-nonce rulings this module implements.
- [ADR 0009 — Modal-prompt model](../decisions/0009-modal-prompt-model.md) — the reducer discipline this
  slice reuses without amendment: id-addressing, ordered array + scan-by-id, same-reference reduce
  behavior.
- `docs/specs/architecture/898-question-batch-model.md` — the full architecture spec, including the
  security review this doc summarizes (verdict PASS).
- [Modal store + bridge](modal-store-bridge.md) — the modal vertical's `modalStore.ts`, the direct
  structural precedent § The Zustand container clones (DI-factory → singleton → hook → selectors).
- `docs/specs/architecture/899-question-batch-store.md` — the container's architecture spec and its own
  security review (verdict PASS).
- `docs/specs/architecture/900-question-bridge.md` — the bridge's architecture spec, including its own
  security review (verdict PASS).
- [Conversation shell — conversation surfaces and modals § Question
  panel](conversation-shell-modals.md#question-panel-906) — the render vertical #906
  built on this model and bridge: `ComposerSlot`, `QuestionPanelView`, and the composer's `covered` cover
  mechanism.
- `docs/specs/architecture/911-question-picks-store.md` — the picks store's architecture spec and its own
  security review (verdict PASS), including the mid-connection re-delivery finding handed to #853.
- Split from [#850](https://github.com/pyrycode/pyrycode-desktop/issues/850); the Zustand container
  shipped in [#899](https://github.com/pyrycode/pyrycode-desktop/issues/899) (§ The Zustand container,
  above); the `DaemonEvent` bridge shipped in
  [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900) (§ The bridge, above), landing dormant;
  [#906](https://github.com/pyrycode/pyrycode-desktop/issues/906) mounted it and gave the store its first
  reader (§ Configuration and usage, above) — the panel's frame only, with #907 shipping the option rows
  and #911 (split from #908, § The picks store, above) shipping the operator's picks store, both still
  headless until [#912](https://github.com/pyrycode/pyrycode-desktop/issues/912) wires the panel to read
  and write them.
