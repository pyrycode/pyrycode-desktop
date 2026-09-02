# 919 — Question resolution envelope (outbound)

The outbound half of the question vertical: the three wire payload types and the two pure,
fail-closed transport builders that form the frames resolving a `question_shown` batch. Wire
vocabulary plus builders only — no command wiring, no token minting, no renderer consumer.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `Envelope`, `ModalAnswerPayload`,
  `QuestionDismissedPayload`, `MAX_PLAINTEXT_BYTES` — the union the two members join, the neighbours
  the new interfaces sit beside, and the `payload: unknown` / `type: EnvelopeType | string` shape
  that makes membership a compile-time-only property.
- `src/main/transport/modalResolutionEnvelope.ts` + `.test.ts` → `buildModalAnswer`,
  `buildModalCancel`, `ModalAnswerInput`, `ModalCancelInput` — this file's twin, seam for seam; the
  new module is a structural clone and the new spec mirrors its round-trip/over-cap pair.
- `src/main/transport/codec.ts` → `encodeEnvelope`, `WireEncodeError` — a bare `JSON.stringify` plus
  a `MAX_PLAINTEXT_BYTES` gate, and the category-only error message that keeps values out of a throw.
- `src/shared/wire/types.test.ts` → the `question-shown` / `question-dismissed` vocabulary blocks —
  the compile-time-membership + exact-`toEqual` pattern the new block follows.
- `docs/knowledge/features/modal-resolution-envelope.md` — the #235 precedent, including the lesson
  that carries here: **no production code does an exhaustive `switch` over `EnvelopeType`**, so the
  two new members need no companion `assertNever` fix-up anywhere.
- `docs/knowledge/features/question-shown-wire-types.md` § "No outbound answer verb" — the inbound
  slice's forward note this ticket discharges, including its `===`-not-`timingSafeEqual` ruling on
  `question_batch_id`.
- pyrycode `2e9dd1d5` `internal/protocol/questions.go` → `QuestionAnswerPayload`,
  `QuestionAnswerEntry`, `QuestionRefusedPayload` and their `MarshalJSON` methods;
  `internal/protocol/codes.go` → `TypeQuestionAnswer` / `TypeQuestionRefused`; and the committed
  `testdata/question_answer.json` / `question_refused.json`. Read from the Go source and the
  fixtures, not from the doc.

## Design source

N/A — no `## Figma` section on the ticket, and the slice is wire types plus two pure main-process
functions. Nothing renders.

## Context

The question vertical renders a batch and holds it in a store, but every control on the panel's
action row is inert as to answering: there is no wire half to send on. This slice lands that half
and stops there.

The upstream contract is settled and published (pyrycode#1983, landed by #1990/#1991, wired by
#1986). Two frames mirroring `modal_answer` / `modal_cancel`, with one asymmetry that must not be
sized from the modal pair: **`question_refused` carries `answer_token` too**, where `modal_cancel`
carries `modal_id` alone.

**An answer names its question by index, never by text, and that is the security property the shape
exists for.** `WireQuestionOption` carries no `id` because claude's answer protocol selects an option
by its `label`, so the reflex design echoes a claude-authored string back across the trust boundary.
Keying by index means no claude-authored byte travels inbound at all; the daemon builds the
text-keyed map claude actually receives from its own parked copy of the batch.

No ADR is warranted — this slice adds no new normative model, it mirrors a published upstream one.

## Design

### Wire types (`src/shared/wire/types.ts`)

Two members join `EnvelopeType`, placed immediately after `'question_dismissed'`, each carrying the
one-line comment the family's neighbours carry (direction, gating, SSOT).

```ts
| 'question_answer'    // phone → binary, outbound v2 control
| 'question_refused'   // phone → binary, outbound v2 control
```

Three interfaces, placed immediately after `QuestionDismissedPayload`, mirroring the Go structs
field-for-field in wire order, every field always present (no `omitempty` anywhere upstream):

```ts
export interface QuestionAnswerEntry { question_index: number; values: string[] }
export interface QuestionAnswerPayload {
  question_batch_id: string
  answer_token: string
  answers: QuestionAnswerEntry[]
}
export interface QuestionRefusedPayload { question_batch_id: string; answer_token: string }
```

Both arrays are plain non-optional (never `| null`): upstream normalises a nil slice to `[]` in
`QuestionAnswerPayload.MarshalJSON` and in `QuestionAnswerEntry.MarshalJSON` precisely so a client's
array type can be non-optional. `question_index` is a plain `number` — upstream chose a signed `int`
deliberately, and a branded or unsigned type here would be stricter than the wire.

Neither payload carries `conversation_id`, matching `ModalAnswerPayload`'s absence and for the same
reason: the daemon resolves the batch id against its own outstanding-batch state and never trusts a
client-asserted conversation.

### The builders (`src/main/transport/questionResolutionEnvelope.ts`, new, main-process only)

One file, two builders, one concern — resolving an outstanding question batch — following
`modalResolutionEnvelope.ts`'s one-concern-per-file split exactly.

```ts
export interface QuestionAnswerInput { id: number; ts: string; payload: QuestionAnswerPayload }
export function buildQuestionAnswer(input: QuestionAnswerInput): Uint8Array
// → Envelope{ id, type: 'question_answer', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError

export interface QuestionRefusedInput { id: number; ts: string; payload: QuestionRefusedPayload }
export function buildQuestionRefused(input: QuestionRefusedInput): Uint8Array
// → Envelope{ id, type: 'question_refused', ts, payload } → encodeEnvelope(); MAY throw WireEncodeError
```

Both are pure and synchronous: `id`, `ts` and `payload` are all caller-injected, so neither reads a
wall clock nor a global counter, and neither mints the `answer_token` (that is the consumer slice's,
main-side). Neither mutates `input.payload` — `JSON.stringify` is read-only, so there is no
in-place normalisation reaching through a caller's backing array, the aliasing hazard upstream's
per-entry `MarshalJSON` exists to avoid.

**No range check on `question_index`, deliberately.** The bound is the resolver's: upstream's
`answerVerdict` range-checks every index before it subscripts and rejects a bad answer totally rather
than partially. A second copy here would be a second bound to keep in agreement — the same reason
`buildDequeueMessage` polices no `queued_msg_id`.

**Main-process only, no barrel** — see the Electron finding in the security review.

## State + concurrency model

None. Two pure synchronous functions, no store slice, no async task, no stream, no timer, no
listener — nothing to cancel and nothing to tear down. The file holds no module-level mutable state.

## Error handling

The single failure mode is an over-cap plaintext. `encodeEnvelope` throws `WireEncodeError` above
`MAX_PLAINTEXT_BYTES` (65519); both builders let it propagate unchanged rather than catching or
truncating, matching `buildModalAnswer`. The eventual consumer catches it and drops the send. It
matters more here than on the modal pair — see the Network & I/O finding below.

## Testing strategy

Vitest only, node environment. Both files are main/shared — no renderer, no markup, no Playwright
spec: nothing in this slice is reachable from a click.

`src/main/transport/questionResolutionEnvelope.test.ts` (new), using the real codec so the assertions
pin actual wire bytes, mirroring `modalResolutionEnvelope.test.ts`:

- `buildQuestionAnswer` round-trips to a `question_answer` envelope carrying the exact `id`, `ts` and
  payload, over the upstream fixture's mixed batch (entry 0 single-value, entry 1 multi-value) — an
  exact `toEqual` on the whole payload, plus an explicit assertion that `answers` order and each
  entry's `values` order survive.
- `buildQuestionRefused` round-trips to a `question_refused` envelope whose payload is exactly
  `{ question_batch_id, answer_token }` — `toEqual` proves `answers` is not present.
- Each builder throws `WireEncodeError` on an over-cap payload (an over-`MAX_PLAINTEXT_BYTES` value
  string / batch id).

`src/shared/wire/types.test.ts` (extended) — a `question-answer/refused wire vocabulary (#919)`
block following the two sibling blocks:

- Compile-time membership for both members. This is the only thing that catches a dropped one:
  `Envelope.type` is `EnvelopeType | string`, so a `case 'question_answer':` compiles green whether
  or not the member was ever added.
- Payload shapes against the committed upstream fixtures verbatim, with `toEqual` over
  pairwise-distinct values — `question_batch_id` and `answer_token` are both plain `string`, so a
  transposition is invisible to tsc and only distinct values catch it.
- `not.toHaveProperty('conversation_id')` on both, pinning the deliberate absence.

## Open questions

1. Should the builders rebuild `payload` as a fresh object literal rather than serializing the
   caller's object verbatim, as a deterministic net against an excess key riding the frame? Resolved
   in the security review below: no — the net belongs at the command site, where #236 already placed
   it for `answerModal`, and a deep rebuild would put real logic into a pure serializer. Recorded as
   an obligation the consumer slice inherits.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The builders sit entirely on the trusted (main) side of every boundary and
  cross none: outbound-only, so there is no untrusted→trusted parse here at all and nothing for
  `inboundMessage.ts` to narrow. The one boundary in the vertical — renderer IPC → main — is *not*
  in this slice, and that is the finding to carry forward, not to wave through: `Envelope.payload` is
  `unknown` and `encodeEnvelope` is a bare `JSON.stringify`, so **every own enumerable key on the
  object handed to a builder ships on the wire**. A renderer that supplied the payload object could
  therefore smuggle an extra key (say a `conversation_id`) into the frame. SHOULD FIX, at the
  consumer slice: build the wire payload as a fresh object literal from validated scalars, never a
  spread of the renderer's object — exactly the discipline `daemonConnection.answerModal` already
  applies for `modal_answer`. Not a MUST FIX here: the daemon's `json.Unmarshal` ignores unknown
  fields, so an excess key is inert at the far end, and the deterministic net exists one slice away.
  Carried into the module's header comment so the consumer inherits it rather than rediscovering it.
- **[Tokens, secrets, credentials]** `answer_token` is a client-minted idempotency key, not a
  credential — upstream states it in as many words ("the token is idempotency and not authorization")
  and the real dedup is the one-shot consume of `question_batch_id`. It is *not minted here*; that is
  the consumer slice's, main-side, and it owes `crypto.randomUUID` / `crypto.randomBytes` and never
  `Math.random()`. `question_batch_id` **is** a one-time unguessable nonce and must never reach a
  log. Discharged for this slice by construction: neither builder logs, the module imports no logger,
  and `WireEncodeError`'s message names the failure category only, so the nonce cannot escape through
  a throw or a stack trace either.
- **[File / storage operations]** Not applicable by design decision, not by luck: both functions are
  pure and synchronous, take no path, touch no `fs` API and hold no module-level state. No traversal
  surface, no TOCTOU gap, no at-rest secret.
- **[Inter-process / Electron attack surface]** No IPC channel, no `contextBridge` API, no
  `BrowserWindow` and no protocol handler is added. The one process-placement obligation is that raw
  bytes stay out of the web layer, and it holds structurally: the module imports `./codec` (Node
  `Buffer`), `src/main/transport/` has no barrel to re-export it through, and `src/renderer/` today
  imports nothing from `main/transport`. Verified, not assumed.
- **[Cryptographic primitives]** No randomness, no hashing, no key material and no comparison is
  performed here. Forward note rather than a gap: `question_batch_id` matching on the consumer path
  wants plain `===`, not `crypto.timingSafeEqual` — it is a local routing decision between two values
  the client already holds, not a secret compared against an attacker's guess.
- **[Network & I/O]** The over-cap path is the finding, and it is addressed rather than absent.
  `values` are operator-typed free text and upstream enforces no bound on entry count or value
  length, so `MAX_PLAINTEXT_BYTES` is reachable in ordinary use. Both builders fail closed —
  propagate `WireEncodeError`, never truncate — because a truncated answer would send the operator a
  different choice than the one they made. Asserted by AC #4's test. No socket, timeout, TLS or
  reconnect surface is introduced.
- **[Error messages, logs, telemetry]** Nothing on this path logs, and that is required rather than
  incidental: `values` are operator-typed text and `question_batch_id` is an unguessable nonce. The
  only error that escapes is the codec's category-only `WireEncodeError`.
- **[Concurrency]** No async work, no timer, no listener, no shared mutable state, so there is no
  ownership, cancellation or shutdown question to answer. One aliasing hazard is worth naming because
  the upstream sibling has it: neither builder normalises arrays in place, so neither reaches through
  a caller's backing array — `JSON.stringify` reads and copies.
- **[Threat model alignment]** *Malicious relay:* it is on-path and content-blind; it can drop or
  delay a resolution frame, which parks the batch rather than resolving it wrongly — the fail-safe
  direction, and no plaintext leaks since the frame is Noise-sealed before it leaves. *Hostile
  daemon:* no decode path exists here, so nothing parses hostile input. *Renderer compromise reaching
  the transport:* a compromised renderer could dispatch an answer for a batch it already holds and
  renders, and the `values` it supplies reach claude's context — but at exactly `send_message`'s
  trust tier, since a paired client can already put arbitrary text into the conversation. It grants
  nothing new. Answering a batch it does *not* hold is barred by the batch nonce being unguessable
  and main-forwarded; that surface belongs to the consumer slice, which also owes the per-device
  answer gate. *Index-not-label:* the shape itself discharges the family's central threat — no
  claude-authored byte travels inbound, so the daemon's text-keyed map is built from its own parked
  copy. OUT OF SCOPE and named: the interactive gate and the per-device answer gate stay the
  resolver's (upstream #1986); the client-side command wiring, token minting and per-device gating
  are the follow-on slice's.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02
