# Question-shown wire types

The wire vocabulary for claude's clarifying-question batch: one `EnvelopeType` member and three
interfaces mirroring the daemon's published `question_shown` contract field for field.

Introduced in [#883](https://github.com/pyrycode/pyrycode-desktop/issues/883), declaration only at
that point — nothing decoded, narrowed, emitted or rendered it. [#884](../codebase/884.md) added the
fail-closed decode into a typed [inbound message](inbound-message-decode.md) arm.
[#885](https://github.com/pyrycode/pyrycode-desktop/issues/885) carried the decoded batch the last hop
across IPC, as the sealed union's `questionShown` arm (see [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md)) — `daemonConnection.ts`'s inbound switch now has a case
for the kind, and all three exhaustive renderer bridges no-op it. It still ships with no renderer
surface: the question store + its own bridge, [#850](https://github.com/pyrycode/pyrycode-desktop/issues/850),
is the first real consumer. SSOT is
`pyrycode/pyrycode` `docs/protocol-mobile.md` § Question (v2) → `question_shown` (declared by
pyrycode#1962, shape by #1963, fixtures and prose by #1964) / `internal/protocol/questions.go`.

## What it does

claude's `AskUserQuestion` tool asks the operator to pick among named options before it continues.
The daemon carries that whole batch to interactive clients as one `question_shown` frame. This slice
declares the vocabulary in `src/shared/wire/types.ts`, placed as its own contiguous block immediately
after `ModalCancelPayload` so the question family reads separately from the modal family:

```ts
export type EnvelopeType =
  | …
  | 'modal_cancel'
  | 'question_shown'   // v2 outbound, interactive-capability-gated, not in the daemon's v1TypeSet
  | …

export interface WireQuestionOption {
  label: string
  description: string
}

export interface WireQuestion {
  question: string
  header: string
  options: WireQuestionOption[]
  multi_select: boolean
}

export interface QuestionShownPayload {
  conversation_id: string
  question_batch_id: string
  questions: WireQuestion[]
}
```

Wire order, snake_case keys, **every field required — no optional keys anywhere**. The daemon sets no
`omitempty`, so an empty `header` or an unset `multi_select` is a real value rather than a vanished
one. `questions` and `options` are plain non-optional arrays (`T[]`, never `T[] | null`): the
daemon's `MarshalJSON` normalises a nil slice to `[]`, so no consumer branches on null.

## How it works

**It is a new frame family, not a grown `modal_shown`**, decided upstream on security grounds:
`modal_shown`'s `default_option_id` is the deny option and MUST equal one of `options[].id`, a total
invariant on the permission surface. A clarifying question has no deny option, so growing the modal
payload would have made that invariant class-conditional.

**The batch is modelled whole, in one frame**, because the desktop question panel steps one question
at a time with header tabs and a Previous button, so every question has to be in hand at once.

**Two nesting levels, and `options` nests under each question** — unlike `ModalShownPayload.options`,
which is flat. A reader pattern-matching off the modal family gets this wrong by default.

**Naming follows the file's own split**: the frame's payload takes the mechanical `<Type>Payload`
(`QuestionShownPayload`, alongside `ModalShownPayload`/`AttachmentChunkPayload`), and a nested
non-payload element takes the `Wire` prefix (`WireQuestion`, `WireQuestionOption`, alongside
`WireModalOption`) — which also keeps `WireQuestion` from colliding with any renderer-side `Question`
a later panel slice introduces.

**Options carry no `id`.** Unlike `WireModalOption`'s `{ id, label }`, claude's answer protocol
selects an option by its `label`, so `label` is the option's identity. claude's optional `preview`
field (an HTML fragment) is absent by construction rather than modelled, since pyry never sets
`toolConfig.askUserQuestion.previewFormat`.

### Per-field provenance

The doc comments carry this because the decode slice's fail-closed boundary is built from it, not
because it is decoration:

- `conversation_id` and `question_batch_id` are **daemon-asserted** — filled from the daemon's own
  state, never from claude's tool input. `conversation_id` is an outbound routing/scoping key only,
  exactly as `modal_shown`'s is: it lets a client with several open conversations avoid rendering one
  conversation's question in another. `question_batch_id` is a one-time, opaque, unguessable nonce
  with `modal_id`'s role exactly — it is `question_batch_id` and not `question_id` because the nested
  question type carries no id of its own, so `question_id` beside a `questions` array would misread
  as that type's key. The upstream fixtures' ids are placeholders; neither their length nor shape is
  a contract, and nothing here is sized from them.
- `question`, `header`, `label` and `description` are **claude-authored** strings that crossed the
  subprocess trust boundary, neither bounded nor sanitized by the daemon. Safe to render as inert,
  escaped, length-bounded text; never into a raw-markup sink (no `innerHTML`, no
  `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a cache key, a lookup path, or a log —
  CLAUDE.md's daemon-text ruling in full, not the render-only subset. The last three are the ones a
  paraphrase drops and the ones a question panel reaches for first (keying a tab by `header`,
  memoising by `label`).

### The two caveats a consumer gets wrong by default

- **The `header` cap is documented 12 but observed 14, counted in runes.** claude's vendor page says
  "max 12 characters"; the only header in the committed upstream capture (`Write strategy`) is 14
  runes. Nothing enforces the cap on either side — size a field for 14 and never truncate at 12. The
  rune/byte units coincide on that pure-ASCII sample and nothing committed separates them, so the
  coincidence is not a measurement.
- **This family ships no `truncated_fields`**, unlike `SlashCommand` and `ModelOption`. A cut can
  never be reported, so an over-long field must be a fail-closed **reject** for the decode slice
  rather than a silent trim — trimming would present claude's truncated text to a client as complete.

## Bounds — deliberately not modelled

claude's contract states 1–4 questions per batch and 2–4 options per question, and nothing on the
daemon enforces either as of 2026-09-01 — checked against the daemon tree at that date. No tuple
types, no branded numbers, no exported max constants: a bound in the type system here would be
stricter-than-wire in a family whose enforcement is still unwritten. This is
[attachment-chunk-envelope](attachment-chunk-envelope.md)'s "documented, not validated" discipline,
minus even the constant, since nothing here consumes a bound the way that slice's producer arithmetic
did.

## Configuration and usage

`src/shared/wire/**` — no React, no DOM, no IPC. Types are erased at compile time; the emitted
JavaScript is unchanged by this slice.

Nothing renders `question_shown` yet:

- **The decoder landed in [#884](../codebase/884.md)** — `parseQuestionShownPayload` /
  `parseQuestion` / `parseQuestionOption` in `src/main/transport/inboundMessage.ts`, a validating
  narrower rather than a bare `as QuestionShownPayload` cast on `Envelope.payload`, exactly as this
  section anticipated. Declaring the types all-required was the load-bearing choice that made the
  narrower simple: no optional key to wave through, so a missing field is a reject by construction.
  The cost is named rather than implicit: an all-required mirror is stricter-than-nothing only while
  the daemon keeps its no-`omitempty` commitment, and widening is a coordinated change with the
  daemon — a dropped batch parks the session, since claude is waiting on the answer and the operator
  never sees the ask. See [inbound message decode](inbound-message-decode.md) for the decode's own
  detail.
- **The IPC carry landed in [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885)** — the
  decoded batch now crosses to the renderer as the `questionShown` `DaemonEvent` arm; see [Daemon
  event channel — the sealed union](daemon-event-channel-sealed-union.md) for the arm itself and
  [Daemon-event bridge](daemon-event-bridge.md) for the three permanent no-ops. No renderer store
  reads it yet.
- **No `question_dismissed`.** Upstream published it the same day (pyrycode#1974) and the desktop
  will need it; sibling slice, not this ticket.
- **No outbound answer verb.** None exists upstream yet (pyrycode#1907). The eventual answer frame
  returns a claude-authored string (selected by `label`, since options carry no id) — publishing that
  string here does not make it trusted on the way back; it is re-resolved daemon-side against the
  recorded batch, keyed on `question_batch_id`, exactly as `modal_answer` is against `modal_id`.

## Edge cases and limitations

- `question_batch_id` comparisons on the eventual dismissal/answer path want plain `===`, not
  `crypto.timingSafeEqual` — it is a local routing decision between two values the client already
  holds, not a secret compared against an attacker's guess. The anti-forgery property is server-side
  resolution, exactly as for `modal_id`.
- No count field exists in this shape to be trusted — a hostile-or-buggy producer's batch is bounded
  only by the codec's existing `MAX_PLAINTEXT_BYTES` frame cap, and that holds only while a future
  decode slice allocates from what actually arrived and never from a claimed count.
- Zero consumer call sites: `Envelope.type` is `EnvelopeType | string` (open), and no exhaustive
  switch exists over it today, so this widening is non-breaking. The `EnvelopeType` membership test
  in `types.test.ts` is what would otherwise miss a dropped member — without it, a decode/re-encode
  round-trip passes silently on an unknown string.

## Testing strategy

Type-level shapes in the existing `src/shared/wire/types.test.ts`, a `question-shown wire vocabulary
(#883)` block. Test values are lifted verbatim from the daemon's three committed fixtures
(`question_shown{,_empty,_zero}.json`) rather than invented, so the pin is against the daemon's own
encoder output — a contract change shows up as a fixture diff, not a disagreement between two
hand-written guesses.

Assertions mix compile-time assignability (a mis-shaped literal fails `tsc`, run by `npm run build`)
and runtime `toEqual` (catches a key transposition `tsc` is blind to, since same-typed `string`
fields are interchangeable to it). Notably: **the genuine RED for this ticket came from `tsc`, not
vitest** — the test file imports these types with `import type`, which vitest erases and never
typechecks, so the runtime assertions alone would pass green against missing types. `npm run
typecheck` is what actually caught the absent exports and the unassignable `'question_shown'`.

Covered: union membership; `WireQuestionOption`'s exact `{ label, description }` shape with explicit
`not.toHaveProperty('id')` / `not.toHaveProperty('preview')`; `WireQuestion`'s exact shape including
`multi_select: false` as a stated position; `QuestionShownPayload`'s populated-fixture shape with
pairwise-distinct values (so a field transposition fails); the empty-`questions` fixture (`[]`
normalisation, never a null branch); the all-zero fixture (the one route that reaches all nine keys,
proving no key is optional); an explicit `not.toHaveProperty('truncated_fields')` at all three
levels; and `@ts-expect-error` pins on each required field, which make the required-field contract
two-way — relaxing any field to optional turns a directive unused and reddens the file at compile
time.

Not tested: the 1–4 / 2–4 bounds and the header cap, since nothing enforces them and a test asserting
them would pin a fiction.

## Related

- [Inbound message decode](inbound-message-decode.md) / [#884 codebase notes](../codebase/884.md) —
  the fail-closed decode into a typed inbound arm, the first consumer of these types.
- [Daemon event channel — the sealed union](daemon-event-channel-sealed-union.md) / [Daemon-event
  bridge](daemon-event-bridge.md) — [#885](https://github.com/pyrycode/pyrycode-desktop/issues/885)'s
  `questionShown` `DaemonEvent` arm, the IPC carry of the decoded batch, and the three permanent
  bridge no-ops. Its own consumer, the question store + bridge, is
  [#850](https://github.com/pyrycode/pyrycode-desktop/issues/850), open.
- [Modal-prompt model](modal-prompt-model.md) / [Modal store bridge](modal-store-bridge.md) — the
  sibling permission/trust-prompt family this one is deliberately **not** merged into, and the
  `WireModalOption`/`ModalShownPayload` naming precedent this slice's `Wire`-prefix and
  `<Type>Payload` conventions follow.
- [Wire codec](wire-codec.md) — `Envelope.payload` stays an opaque carrier (`unknown`) through the
  codec; this slice adds no decoder, consistent with that boundary.
- [Attachment chunk envelope](attachment-chunk-envelope.md) — the nearest analogue: a purely
  additive `EnvelopeType` member shipped unreferenced ahead of its consumer, and the
  "documented, not validated" bound discipline this slice reuses (minus the constants) for the
  header cap and the 1–4/2–4 batch bounds.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — "do not drift the wire types from the mobile contract without a matching daemon change"; this
  slice mirrors a settled upstream contract and makes no desktop-side architectural choice of its
  own, so no new ADR was warranted.
- `docs/specs/architecture/883-question-shown-wire-types.md` — the full architecture spec, including
  the security review this doc summarizes (verdict: PASS).
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § Question (v2) — the source-of-truth
  contract this slice mirrors.
