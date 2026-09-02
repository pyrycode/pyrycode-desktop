# Question resolution envelope (outbound)

The **outbound** half of the question vertical: the three wire payload types and two pure,
fail-closed transport builders that form the frames resolving a `question_shown` batch
([question-shown wire types](question-shown-wire-types.md), rendered by the
[question panel](conversation-shell-question-panel.md)). This slice ships **only** the wire contract
and the builders — no command wiring, no `answer_token` minting, no renderer consumer. Wire vocabulary
plus builders only, mirroring [modal resolution envelope](modal-resolution-envelope.md) seam for seam
(#235 is this file's twin).

Introduced in [#919](https://github.com/pyrycode/pyrycode-desktop/issues/919), split from #853. The
contract is settled and published upstream — pyrycode#1983, `docs/protocol-mobile.md` § Question —
landed daemon-side by pyrycode#1990 (refusal) and #1991 (answer), wired by #1986; verified against
`internal/protocol/questions.go` and its committed `testdata/` fixtures, not read off the doc.

## What it does

Defines the byte-exact shape of the two frames the desktop sends **back** to the daemon to resolve an
outstanding batch, and two pure functions that wrap an already-formed payload into a serialized
`Envelope`:

- `question_answer{ question_batch_id, answer_token, answers[] }` — the operator's selections.
  `answers` is an ordered array of `{ question_index, values }`: `question_index` is the entry's
  position in the batch's `questions` array, `values` an ordered array of strings (more than one is
  the `multi_select` case).
- `question_refused{ question_batch_id, answer_token }` — the operator declined to choose; its own
  type rather than an empty-`answers` `question_answer`, mirroring `modal_cancel` beside
  `modal_answer`.

`question_batch_id` is the sole correlation key on both frames — no `conversation_id` rides either,
matching `ModalAnswerPayload`'s absence: the daemon resolves the batch id against its own
outstanding-batch state and never trusts a client-asserted conversation.

**`question_refused` carries `answer_token` too, unlike `modal_cancel`, which carries `modal_id`
alone** — do not size this pair from the modal pair's asymmetry. A refusal is as replayable as an
answer, and the daemon's dedup is the same one-shot consume of `question_batch_id`.

**An answer names its question by INDEX, never by text, and that is the security property the shape
exists for.** `WireQuestionOption` carries no `id` because claude's answer protocol selects an option
by its `label`, so a reflex inbound-mirroring design would have echoed a claude-authored string back
across the trust boundary. Keying by index means no claude-authored byte travels inbound at all; the
daemon builds the text-keyed map claude actually receives from its own parked copy of the batch.
`question_index` is carried but never range-checked here — that bound is the daemon resolver's
(`answerVerdict`, `cmd/pyry/modal_resolve_v2.go:899`), which rejects a bad answer totally rather than
partially. A second copy client-side would be a second bound to keep in agreement, the same reason
`buildDequeueMessage` polices no `queued_msg_id`.

**The daemon never reads `answer_token` on this path at all.** `modalResolverV2.AnswerQuestion`
(`cmd/pyry/modal_resolve_v2.go:750`) takes the batch id and the entries rather than the whole
`QuestionAnswerPayload`, expressly so it never holds a token it has no business reading — the token is
idempotency, not authorization; the real dedup is the batch's one-shot consume. There is no
`questionResolverV2`: `AnswerQuestion` is the question primitive's name precisely because
`ResolveAnswer` was already taken by the *modal* path on the same struct. The field is still a
modelled, always-present field on both frames, minted main-side by the not-yet-built consumer slice,
not here.

## How it works

### Wire types (`src/shared/wire/types.ts`)

```ts
export type EnvelopeType =
  | ...
  | 'question_shown'      // inbound
  | 'question_dismissed'  // inbound
  | 'question_answer'     // outbound — new
  | 'question_refused'    // outbound — new
  | ...

export interface QuestionAnswerEntry {
  question_index: number
  values: string[]
}

export interface QuestionAnswerPayload {
  question_batch_id: string
  answer_token: string
  answers: QuestionAnswerEntry[]
}

export interface QuestionRefusedPayload {
  question_batch_id: string
  answer_token: string
}
```

Placed immediately after `QuestionDismissedPayload` — the first **outbound** members of the question
family, everything above them being inbound. No `omitempty` anywhere upstream: all three fields on
`question_answer` and both on `question_refused` are always present, and `answers` (and each entry's
`values`) is a plain non-optional array, never `| null` — the daemon's `MarshalJSON` normalises a nil
slice to `[]` on both types precisely so a client's array type can stay non-optional. `question_index`
is a plain `number`, deliberately not a branded or unsigned type — upstream chose a signed `int` so a
range problem stays a range problem rather than becoming a decode-error surprise.

Neither payload carries `conversation_id`, matching `ModalAnswerPayload`'s absence and for the same
reason.

### The builders (`src/main/transport/questionResolutionEnvelope.ts`, new, MAIN-PROCESS ONLY)

One file, two builders, one concern — resolving an outstanding question batch — following
`modalResolutionEnvelope.ts`'s one-concern-per-file split exactly. No barrel; `src/main/transport/`
has never had one, and `src/renderer/` imports nothing from `main/transport`.

```ts
export interface QuestionAnswerInput { id: number; ts: string; payload: QuestionAnswerPayload }
export function buildQuestionAnswer(input: QuestionAnswerInput): Uint8Array
// → Envelope{ id, type: 'question_answer', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError

export interface QuestionRefusedInput { id: number; ts: string; payload: QuestionRefusedPayload }
export function buildQuestionRefused(input: QuestionRefusedInput): Uint8Array
// → Envelope{ id, type: 'question_refused', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError
```

Each is a verbatim structural clone of `buildModalAnswer`/`buildModalCancel` — pure, synchronous, no
clock/counter read (`id`/`ts`/`payload` are all caller-injected), no side effects, no `answer_token`
minting. Order-preserving and sort-free: `answers` and each entry's `values` ride in the order given,
and neither builder mutates `input.payload` — `JSON.stringify` reads and copies, so there is no
in-place normalisation reaching through a caller's backing array. `encodeEnvelope` (see
[wire codec](wire-codec.md)) throws `WireEncodeError` above `MAX_PLAINTEXT_BYTES`; both builders
propagate it unchanged rather than truncating — a trimmed answer would send the operator a different
choice than the one they made — matching `buildModalAnswer`. It is more reachable here than on the
modal pair: `values` are operator-typed free text and upstream bounds neither entry count nor value
length. `question_refused`'s frame carries no free text at all (both fields are ids echoed back), so
its over-cap path is unreachable in ordinary use; the assertion exists for parity with the pair anyway.

**The payload is serialized verbatim — every own enumerable key on the object handed to a builder
ships on the wire**, since `Envelope.payload` is `unknown` and `encodeEnvelope` is a bare
`JSON.stringify`. The consumer slice owes the same discipline `daemonConnection.answerModal` already
applies for `modal_answer`: build the wire payload as a fresh object literal from validated scalars,
never a spread of a renderer-supplied object, or a renderer could smuggle an extra key (a
`conversation_id`, say) into the frame. Not fixed here by design — the security review placed the net
at the consumer's trust boundary rather than as a deep rebuild inside a pure serializer, and the
module's header comment carries the obligation forward so the consumer inherits it rather than
rediscovering it.

Nothing on this path logs: `values` are operator-typed text and `question_batch_id` is a one-time
unguessable nonce, so the module imports no logger and `WireEncodeError`'s message names the failure
category only.

## Testing strategy

`questionResolutionEnvelope.test.ts` mirrors `modalResolutionEnvelope.test.ts`: real-codec round-trips
pinning `id`/`ts`/payload verbatim over the upstream fixture's mixed batch (one single-value entry, one
multi-value entry, order asserted), plus an over-cap `WireEncodeError` case per builder. A sibling block
in `types.test.ts` covers the two new `EnvelopeType` members and the three payload shapes the same two
ways as their inbound siblings: compile-time membership plus exact-`toEqual` fixture shapes.

**The membership assertions are the only thing with teeth for a new `EnvelopeType` member — including
inside a builder.** `Envelope.type` is `EnvelopeType | string`, so `type: 'question_answer'` inside
`buildQuestionAnswer` compiles green whether or not the member was ever added to the union; only the
`const answer: EnvelopeType = 'question_answer'`-style assertion in `types.test.ts` fails without it.

**The two touched files RED in different tools, and each stays silent about the other's failure.** The
builder module fails under `vitest` (missing import) before the types exist; the `types.ts` half passes
`vitest` green regardless, since its test file imports the new interfaces with `import type`, which
vitest erases and never typechecks. The genuine RED for the wire-vocabulary half is `tsc`-only — `npm
run typecheck`/`npm run build`, not `npm test` — the same disjoint-coverage shape every prior wire-type
ticket in this family has hit (see [question-shown wire types](question-shown-wire-types.md)'s Testing
strategy section). A change here that watches only `vitest` can believe a broken type export is fully
covered when it is not.

## Configuration and usage

**Consumer landed: [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920).**
`daemonConnection.answerQuestions`/`refuseQuestions` (`src/main/daemonConnection.ts`) call the two
builders directly — the `send`/`answerModal` inert no-op shape (`driver === null` → return; full-body
`try {} catch {}`, never throws out of the module), sharing the module's single `nextEnvelopeId`
counter. Both methods mint `answer_token` via the existing `mintToken` DI seam (default
`crypto.randomUUID`, main-side), since **both question frames carry a token**, unlike the modal pair
where only `modal_answer` does. `answerQuestions` builds a **fresh literal naming exactly the three
modeled fields**, and the rebuild is **deep**: each `answers` entry is rebuilt as
`{ question_index, values }` rather than passed through by reference, because `buildQuestionAnswer`
serializes verbatim and a shallow `answers: payload.answers` would carry any extra key smuggled onto
an *entry* — past the renderer-side guard — straight onto the wire. `values` itself rides without a
copy: `JSON.stringify` serializes an array by index, so no own property on it can ride, and a
defensive copy would read as a check it is not. Routed from a new pair of `RendererCommand` members
(`answerQuestions`/`refuseQuestions`, [command channel](command-channel.md)) through
`src/main/index.ts`'s `onCommand` switch — no orchestrator, direct dispatch. **No correlation window**,
unlike `answerModal`'s `outstandingAnswers` (#248): the daemon emits no reply and no error envelope for
a rejected question answer, so a window here would hold an entry nothing ever drains. `answer_token`
matching, if it is ever added, wants plain `===`, not `crypto.timingSafeEqual` — confirmed unchanged by
this slice: nothing on this path compares a token or a batch id to anything at all. The renderer
controls on the question panel's action row that dispatch these commands are still a later slice —
every control on that row remains inert as to answering until they land.

## Edge cases and limitations

- **No decode path.** Both frames are outbound-only — there is nothing for `inboundMessage.ts` to
  parse here.
- **No validation of `question_index` against the batch's `questions` length**, and none against
  `values` against the offered options — confirmed still true of the landed consumer. The renderer-side
  guard (`isAnswerQuestionsPayload`) is a *shape* check only; upstream's `answerVerdict` owns every
  bound (entry count, value length, index range, membership), and a second copy client-side would be a
  second bound to keep in agreement with the batch.
- **`answer_token` is not a secret**, same as `ModalAnswerPayload`'s. Its uniqueness and stability
  matter for idempotency; secrecy does not, and the daemon on this path never even reads it.
- **Zero `EnvelopeType` consumer cascade.** No production code does an exhaustive `switch` over
  `EnvelopeType` — adding the two members needed no companion `assertNever` fix-up anywhere.

## Related

- [Question-shown wire types](question-shown-wire-types.md) — the inbound half of the vertical
  (`question_shown`/`question_dismissed`, #883/#894) this outbound slice resolves; its own
  "No outbound answer verb" note is now corrected in place, since that verb exists as of this ticket.
- [Question-batch model](question-batch-model.md) — the renderer-side held batch this eventual
  consumer will read `question_batch_id`/`question_index` from.
- [Modal resolution envelope](modal-resolution-envelope.md) — this file's twin (#235), the structural
  clone both builders here follow seam for seam, including its answer/cancel-path split precedent
  (wire+builders → main-command wiring that mints the token → renderer consumer).
- [Command channel](command-channel.md) / [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920)
  — the `answerQuestions`/`refuseQuestions` `RendererCommand` members and their boundary guards, one of
  which (`isAnswerQuestionsPayload`) is the file's first guard to recurse into a structured payload.
- [Daemon connection](daemon-connection.md) / [#920](https://github.com/pyrycode/pyrycode-desktop/issues/920)
  — the `answerQuestions`/`refuseQuestions` methods that consume both builders here, mint
  `answer_token` main-side, and deep-rebuild the `answers` array to net a smuggled entry-level field.
- [Wire codec](wire-codec.md) — `encodeEnvelope`/`WireEncodeError`/`MAX_PLAINTEXT_BYTES`, unchanged by
  this slice.
- [Conversation shell — question panel](conversation-shell-question-panel.md) — the render vertical
  this slice's eventual consumer will wire the action row's Answer/Refuse controls into.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — this slice mirrors a settled upstream contract and makes no desktop-side architectural choice of
  its own, so no new ADR was warranted.
