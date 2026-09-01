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
`questionBatchId` nonce. There is no Zustand store, no React hook, no wire-type import here — that
render-integration layer is the two follow-ups', [#899](https://github.com/pyrycode/pyrycode-desktop/issues/899)
(the Zustand container) and [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900) (the
`DaemonEvent → QuestionBatchEvent` bridge), both natively blocked-by this module.

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

## Configuration and usage

Nothing imports this module yet. Its first consumer is
[#899](https://github.com/pyrycode/pyrycode-desktop/issues/899), the Zustand container wrapping
`reduceQuestionBatches` (the `modalStore.ts` precedent); the `DaemonEvent → QuestionBatchEvent` bridge
mapping `questionShown`/`questionDismissed` onto the events above, plus renaming `multi_select` at both
nesting levels, is [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900)'s. Both are
natively blocked-by this ticket.

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

## Testing strategy

`src/renderer/src/store/questionBatches.test.ts` — plain vitest unit tests, no DOM, no
`renderToStaticMarkup` (the module is framework-free, so nothing in it needs one). Fixture builders
mirror `modalPrompts.test.ts`'s idiom: a `shown(...)`/`dismissed(...)`/`reconnected()` with sensible
defaults and `Partial<Omit<Extract<…>>>` overrides, and a `run(...)` fold helper. One explicit test
asserts the module's import set is empty (AC1) — stronger than a denylist, since any future import of
any kind reddens the test rather than passing because it wasn't on a banned list. 32 tests green.

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
- Split from [#850](https://github.com/pyrycode/pyrycode-desktop/issues/850); unblocks
  [#899](https://github.com/pyrycode/pyrycode-desktop/issues/899) (Zustand container) and
  [#900](https://github.com/pyrycode/pyrycode-desktop/issues/900) (the `DaemonEvent` bridge).
