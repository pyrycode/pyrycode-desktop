# #883 — `question_shown` batch payload and its nested question and option types

Declare the wire vocabulary for claude's clarifying-question batch: one `EnvelopeType` member and
three interfaces mirroring the daemon's published contract field for field. **Declaration only** —
nothing decodes, narrows, emits or renders it in this slice.

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `WireModalOption`, `ModalShownPayload`,
  `ModalDismissedPayload` — the placement anchor and the doc-comment discipline to follow (per-field
  provenance prose, SSOT citation, "always present (no `omitempty`)"). Also `Envelope`: its `type` is
  `EnvelopeType | string`, which makes this widening non-breaking and the membership test
  load-bearing.
- `src/shared/wire/types.test.ts` → the `modal wire vocabulary (#201)` block for the payload+option
  pairing, and `background-task-roster wire vocabulary (#566)` for a nested non-optional array with
  its empty case pinned separately. The two patterns this slice mirrors.
- `~/Workspace/Projects/pyrycode` `docs/protocol-mobile.md` § Question (v2) → `question_shown` —
  **the SSOT.** Field tables and per-field provenance, the bounds-enforced-nowhere table, the
  documented-12-observed-14 header paragraph, the no-`truncated_fields` consequence, the SECURITY
  paragraph. Verified against `origin/main` at `53e22df` (2026-09-01).
- `~/Workspace/Projects/pyrycode` `internal/protocol/questions.go` → `QuestionShownPayload`,
  `Question`, `QuestionOption` — the json tags fix the wire key set and order. Note `Question.Text`
  carries the wire key `question`: the Go field is renamed only to avoid `Question.Question`
  stuttering, and the wire key is what this slice mirrors.
- `~/Workspace/Projects/pyrycode` `internal/protocol/testdata/question_shown{,_empty,_zero}.json` →
  the three committed fixtures, and the source of every test value here, so a contract change shows
  up as a fixture diff rather than a disagreement between two hand-written guesses.
- `docs/knowledge/features/attachment-chunk-envelope.md` → the nearest analogue (#860): a
  purely-additive `EnvelopeType` member shipped unreferenced ahead of its consumer, with the
  "documented, not validated" bound discipline this slice reuses for the header cap.
- `docs/knowledge/features/wire-codec.md` → *"`Envelope.payload` stays an opaque carrier (`unknown`)
  — decoded but never narrowed to a concrete payload type here"*. Why this slice touches no decoder:
  narrowing is the consumer's edge, not the codec's.
- `CLAUDE.md` § Conventions → the daemon-text ruling. The four claude-authored strings are exactly
  its category, and the doc comments must carry its banned-sink list in full.

## Sizing — measured, and one boundary knowingly crossed

Recorded because the verifier re-checks these six numbers and would otherwise read the overrun as an
omission.

| Boundary | Limit | This ticket |
|---|---|---|
| Production source files | ≤ 3 | **1** (`src/shared/wire/types.ts`) |
| New exported types | ≤ 5 | **3** |
| Consumer call sites needing simultaneous update | ≤ 10 | **0** |
| Acceptance criteria | ≤ 5 | **5** |
| Distinct error/reject branches | ≤ 10 | **0** |
| Total written work | ≤ 400 | **~560** — implementation ~240, this plan 321 |

The call-site count is measured, not assumed: a repo-wide search for `EnvelopeType` finds the
declaration, `Envelope.type` (`EnvelopeType | string`, open), and membership assignments in this
file's own tests. No exhaustive switch exists, so the widening cascades nowhere.

**The last line is over, and the ticket still ships whole.** The overrun is this plan's prose plus
§ A6's mandated security appendix (~75 lines of the 321), not work the ticket generates: the
implementation is ~240 lines in one production file and its existing test file, which sits on the
refiner's own ~300 estimate. Every boundary that predicts turn cost passes with large margin. And no
split survives § A1's floor rule — the only seams available (option type / question type / payload,
or member / interfaces) produce a child whose sole consumer is its sibling, and the deliverables test
finds one deliverable, not two. Splitting because the *plan* is long is the inverse of the failure
§ A1 names, where a careful write-up measures as oversized and each child is then written back up to
the ceiling.

## Design source

**Figma:** N/A — no `## Figma` section on the ticket, and correctly so. This slice declares
TypeScript interfaces and adds a string to a union. It renders nothing and has no visual surface;
the question panel that eventually draws these fields is a separate slice of #849's family.

## Context

claude's `AskUserQuestion` tool asks the operator to pick among named options before it continues.
The daemon carries that whole batch to interactive clients as one `question_shown` frame. Upstream
declared the wire type (pyrycode#1962), the Go shape (#1963) and the fixtures plus the published
contract section (#1964); nothing on either side emits or parses it yet. This slice is the desktop's
mirror of that vocabulary, so the fail-closed decode slice has a settled shape to narrow into.

Two upstream decisions the desktop inherits rather than re-litigates. It is a **new frame family, not
a grown `modal_shown`**, decided on security grounds: `modal_shown`'s `default_option_id` is the deny
option and MUST equal one of `options[].id`, a total invariant on the permission surface, and a
clarifying question has no deny option — growing the modal payload would have made that invariant
class-conditional. And the batch is modelled **whole, in one frame** because the desktop question
panel steps one question at a time with header tabs and a Previous button, so every question has to
be in hand at once.

No ADR is warranted. This mirrors a settled upstream contract and makes no desktop-side architectural
choice; [ADR 0002](../../knowledge/decisions/) already governs "the wire types match mobile
field-for-field". The documentation phase should fold this into a package overview, not a decision
record.

## Design

One production file, `src/shared/wire/types.ts`, additive throughout.

### The union member

`'question_shown'` joins `EnvelopeType`, placed beside the modal members with a leading comment in
the established style: a v2 outbound (binary → phone) interactive-capability-gated frame, **not in
the daemon's `v1TypeSet`, so an old client never receives it**, and a pointer to why it is its own
family rather than a grown `modal_shown`.

This widening is non-breaking and has **zero consumer call sites**: `Envelope.type` is
`EnvelopeType | string`, an open union, and a repo-wide search for `EnvelopeType` finds no exhaustive
switch over it — every use is either the declaration, the open field, or a test's membership
assignment. That openness is also why the membership test earns its place: without the union member a
decode/re-encode round-trip passes silently on an unknown string, so nothing else would catch a
dropped member (the same reasoning `attachment_chunk` records in #860).

### The three interfaces

Placed immediately after `ModalCancelPayload`, so the modal family stays contiguous and the question
family reads as its own block. Declared innermost-first (`WireQuestionOption`, `WireQuestion`,
`QuestionShownPayload`) so each type's reader has already met the one it nests.

Wire order, snake_case keys, **every field required — no optional keys anywhere**. The daemon sets no
`omitempty`, so an empty `header` or an unset `multi_select` is a real value rather than a vanished
one. `questions` and `options` are non-optional plain arrays (`T[]`, never `T[] | null`): the daemon's
two `MarshalJSON` normalisers turn a nil slice into `[]`, so no consumer ever branches on null. That
is the one place this shape differs from `BackgroundTask.truncated_fields`, whose nullability is real
— worth stating in the comment, because the two live one file apart and read alike.

| Type | Fields, in wire order |
|---|---|
| `QuestionShownPayload` | `conversation_id: string`, `question_batch_id: string`, `questions: WireQuestion[]` |
| `WireQuestion` | `question: string`, `header: string`, `options: WireQuestionOption[]`, `multi_select: boolean` |
| `WireQuestionOption` | `label: string`, `description: string` |

Naming follows the file's own split: the payload of a frame takes the mechanical `<Type>Payload`
(`ModalShownPayload`, `AttachmentChunkPayload`), and a nested non-payload element takes the `Wire`
prefix (`WireModalOption`, `WireModalClass`) — which also keeps `WireQuestion` from colliding with
any renderer-side `Question` the panel slice later introduces, exactly as `WireModalOption` is
structurally paired with but nominally distinct from the renderer's `ModalOption`.

**Two nesting levels, and `options` nests under each question** — unlike `ModalShownPayload.options`,
which is flat. A reader who pattern-matches off the modal family gets this wrong by default, so the
`QuestionShownPayload` comment states it.

### What the doc comments must carry

The comments are a deliverable here, not decoration: the decode slice's fail-closed boundary is built
from the per-field trust tiers recorded in them. Four things, none of which a reader can infer:

1. **Per-field provenance.** `conversation_id` and `question_batch_id` are **daemon-asserted** — the
   daemon fills them from its own state and they never come from claude's tool input. `question`,
   `header`, `label` and `description` are **claude-authored**, at `model_list`'s trust tier: they
   crossed the subprocess trust boundary, the daemon neither bounds nor sanitizes them, and nothing
   on the path strips control characters or terminal escapes. Safe to render as inert text; never
   into an HTML sink, an attribute or a URL. This is CLAUDE.md's daemon-text ruling and upstream
   § Security model's threat 1 landing on a remote render surface — the sanitization is owed by the
   client's render boundary. The banned-sink list is CLAUDE.md's in full and not a paraphrase of
   it: no HTML sink, no attribute, no URL, **and no filename, cache key or lookup path, and never a
   log**. The last three are the ones a paraphrase drops, and they are the ones a question panel
   reaches for first — keying a tab by `header`, memoising by `label`.
2. **`conversation_id` is an outbound routing/scoping key only**, exactly as `modal_shown`'s is
   (pyrycode#1065): it is what lets a client with several open conversations avoid rendering one
   conversation's question in another. It grants no inbound capability.
3. **`question_batch_id` is a one-time, opaque, unguessable nonce with `modal_id`'s role exactly.**
   The fixtures' ids are placeholders — neither their length nor their shape is a contract, so
   nothing may be sized from them. It is `question_batch_id` and not `question_id` precisely because
   the nested question type carries **no id at all**, so a `question_id` beside a `questions` array
   would misread as that type's key.
4. **The two caveats a consumer gets wrong by default.** The `header` cap is **documented 12 but
   observed 14**, counted in **runes** — the vendor page says max 12, the only header in the
   committed capture (`Write strategy`) is 14, so a client sizing for 12 and truncating clips the one
   real header anyone has measured. The rune/byte units coincide on that ASCII sample and **nothing
   committed separates them**, so the coincidence is not a measurement. And this family ships **no
   `truncated_fields`**, unlike `SlashCommand` and `ModelOption`: a cut can never be reported, so an
   over-long field is a **reject** for the decode slice rather than a silent trim.

### What this slice deliberately does not model

- **No bounds as types.** claude's contract states 1–4 questions per batch and 2–4 options per
  question, and **nothing on the daemon enforces either** as of 2026-09-01. No tuple types, no
  branded numbers, no exported max constants — a bound in the type system here would be
  stricter-than-wire in a family whose enforcement is still unwritten. The numbers go in prose with
  their non-enforcement named: `attachment-chunk-envelope`'s "documented, not validated" discipline
  minus even the constant, since #860 exported constants only because its producer arithmetic
  consumed them and nothing here consumes a bound.
- **No `question_dismissed`.** Upstream published it the same day (pyrycode#1974) and the desktop
  will need it, but this ticket's acceptance names one union member and three interfaces. Sibling
  slice of #849's family, not scope here.
- **No outbound answer verb.** None exists upstream — that is pyrycode#1907's. One comment line for
  whoever reads this next: options carry **no id**, because claude's answer protocol selects by
  **`label`**, so the eventual answer frame returns a claude-authored string, and publishing it here
  does not make it trusted on the way back.
- **No decoder, no narrowing, no `parse*` function.** `Envelope.payload` stays `unknown` through the
  codec by design; narrowing is the consumer's edge and the fail-closed parse is a later slice.

## State + concurrency model

None. Three interfaces and a string-union member — no store slice, no async task, no stream, no
subscription, nothing to cancel or tear down. The types are erased at compile time and the emitted
JavaScript is unchanged. `src/shared/` imports neither React nor the DOM, and this addition keeps
it so.

## Error handling

None in this slice, and the absence is the design: no code path here parses, validates or fails. The
two obligations this slice *creates* for the decode slice are recorded in the doc comments rather
than in code:

- An over-long field must be **rejected fail-closed**, never silently truncated, because there is no
  `truncated_fields` to report a cut with.
- The header cap must **not** be enforced at 12: upstream's own parse is forbidden from doing so
  (its acceptance pins it against the 14-rune capture), and whatever bound does land must name its
  unit.

Declaring the types as all-required is itself the load-bearing choice: it means the decode slice's
narrowing function has no optional key to wave through, so a missing field is a reject by
construction rather than by remembering to check.

Its cost is named rather than left implicit: an all-required mirror is stricter-than-nothing only
while the daemon keeps its no-`omitempty` commitment, and a fail-closed narrower built on it drops a
frame that ever gains an omitted key. A dropped question batch parks the session — claude is waiting
on the answer and the operator never sees the ask — so widening is a coordinated change with the
daemon, the same posture `WireModalClass` records for an unknown class.

**A required field is a promise the wire has not kept until it is checked.** The decode slice must
reach these types through a validating narrower, never a bare `as QuestionShownPayload` on
`Envelope.payload` — the cast would hand a `.map` a non-array from a malformed frame. The doc
comments say so at the type, since the type is what a later implementer reads.

## Testing strategy

Vitest, node environment, in the existing `src/shared/wire/types.test.ts` — a new
`question-shown wire vocabulary (#883)` block appended after the modal blocks. Type-level shapes, so
the assertions are a mix of compile-time assignability (a mis-shaped literal fails `tsc`, which
`npm run build` runs) and runtime `toEqual` (which catches a key transposition `tsc` is blind to,
since same-typed `string` fields are interchangeable to it). No Playwright spec: nothing renders and
nothing is interactive.

Test values come **verbatim from the three committed upstream fixtures** rather than being invented,
so the pin is against the daemon's own encoder output.

Scenarios:

- Union membership — `const shown: EnvelopeType = 'question_shown'` assigns. The one thing that would
  otherwise go undetected, since `Envelope.type` is open.
- `WireQuestionOption` is exactly `{ label, description }` — and carries **no `id`** (pinned as an
  explicit absence, because `WireModalOption` one screen up does carry one) and **no `preview`**
  (absent by construction: pyry never sets `previewFormat`).
- `WireQuestion` is exactly `{ question, header, options, multi_select }` — the wire key is
  `question`, not the Go field's `text`; `multi_select` is `false` as a stated position rather than
  an absent key; `options` nests here rather than on the payload.
- `QuestionShownPayload` is exactly `{ conversation_id, question_batch_id, questions }`, from the
  populated fixture (two questions, one with three options, one `multi_select: true`) — with an
  exact `toEqual` on pairwise-distinct values, so a transposition of two `string` fields cannot pass.
- An **empty** `questions: []` is admitted (the `question_shown_empty.json` fixture) — the `[]`
  normalisation guarantee, asserted as `toEqual([])` and never as a null branch.
- A **zero-value** batch (the `question_shown_zero.json` fixture: one all-zero question holding one
  all-zero option) is admitted, with `''` and `false` read back as values. This is the arm that
  proves no key is optional — it is the only route that reaches every one of the nine keys, since a
  batch with no questions reaches neither nested type.
- The batch carries **no `truncated_fields`** at any of the three levels, pinned as an explicit
  `not.toHaveProperty` — the trap that separates this family from `SlashCommand` / `ModelOption`.

Deliberately **not** tested: the 1–4 / 2–4 bounds and the header cap. Nothing enforces them, so a
test asserting them would pin a fiction. The prose records them; the decode slice's test suite is
where a bound becomes assertable.

## Open questions

1. **Does the `Wire` prefix belong on the nested types, or should they be bare `Question` /
   `QuestionOption`?** Leaning `Wire`, matching `WireModalOption`'s precedent and pre-empting a
   collision with the renderer-side `Question` the panel slice will want. Resolve at implementation;
   if it changes, it changes only names declared in this slice and consumed by nobody.
2. **Placement — after `ModalCancelPayload`, or at the end of the file beside the newest
   additions?** Ticket says "beside `ModalShownPayload` and `WireModalOption`". Confirm the modal
   block's actual end while editing and place immediately after it.

Both are naming/placement calls with no contract consequence. Anything that changes the *shape* would
be a contract disagreement with the SSOT, and would be resolved by re-reading § Question (v2), not by
a judgement call here.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] **No MUST FIX, and the category is the point of the ticket.** This slice does
  not *build* the untrusted→trusted boundary — it publishes the per-field tiers the decode slice's
  fail-closed boundary is constructed from, which is why the doc comments are a deliverable and not
  decoration. The concrete weakness worth naming: nothing in the type system marks
  `WireQuestion.header` as untrusted, so a panel component can receive one and render it with no
  signal. Branded types were considered and rejected — `ModalShownPayload.title` / `prompt` carry the
  identical hazard with the identical mitigation (prose), and diverging here would leave one family
  branded and its neighbour not, which reads as *the unbranded one is safe*. The mitigation stays the
  comment, and AC3 is what makes it load-bearing.
- [Trust boundaries] **SHOULD FIX, landing in Phase B as comment text.** The all-required declaration
  is a promise the wire has not kept until checked; a bare `as QuestionShownPayload` on
  `Envelope.payload` would hand a `.map` a non-array from a malformed frame. Recorded at the type so
  the decode slice reads it. See § Error handling.
- [Trust boundaries] **SHOULD FIX, landing in Phase B as comment text.** The banned-sink list must be
  CLAUDE.md's in full — filename, cache key, lookup path and log included, not just the HTML/
  attribute/URL trio. Those are precisely the sinks a question panel reaches for (a tab keyed by
  `header`, a memo keyed by `label`). The plan body was revised for this before commit.
- [Tokens, secrets, credentials] **No MUST FIX; one SHOULD FIX.** Nothing is minted, stored or
  compared here — `question_batch_id` is minted daemon-side with `crypto/rand` (pyrycode#1975) and
  resolved server-side, so a client holding it gains no capability. Nothing at rest, so `safeStorage`
  does not arise. SHOULD FIX: the nonce carries `modal_id`'s unguessability and **must never reach a
  log**; nothing logs payloads today (`Envelope.payload` is opaque through the codec) but the store
  and decode slices are where that temptation lands, so the obligation is recorded at the field.
- [File / storage operations] **Not applicable, by a decision rather than by luck.** No path, handle
  or file is derived from any field. The category *would* land the moment a later slice used a
  claude-authored `header` or `label` as a filename or a cache key, which is exactly why the finding
  above insists on the full banned-sink list rather than the render-only subset.
- [Inter-process / Electron attack surface] **No findings.** No window, no channel, no
  `contextBridge` surface and no `ipcMain` handler is added; `src/shared/` imports neither React nor
  the DOM and still does. The structured-clone hazard on the eventual bridge crossing — an
  `undefined` property surviving `webContents.send`, so `'k' in payload` is true where a reader
  expects absence — is **removed by construction here**: every field is required, so no field is ever
  `undefined`, and there is no absent-vs-present distinction for a consumer to get wrong.
- [Cryptographic primitives] **Not applicable, and one over-engineering trap named.** No primitive,
  no RNG, no key, no nonce reuse — the Noise variant is untouched. The trap: a later slice matching a
  dismissal to its batch compares `question_batch_id` values, and `crypto.timingSafeEqual` is *not*
  wanted there. The comparison is a local routing decision between two values the client already
  holds, not a secret compared against an attacker's guess; the anti-forgery property is server-side
  resolution, exactly as for `modal_id`. Plain `===` is correct.
- [Network & I/O] **No findings for this slice; one consequence recorded for the decode slice.**
  No socket, no timeout, no `maxPayload` is touched. Adversarially: since **no bound is enforced
  anywhere** (1–4 questions, 2–4 options and every string length are all unenforced as of
  2026-09-01), a hostile-or-buggy producer's batch is bounded only by the codec's existing
  `MAX_PLAINTEXT_BYTES` frame cap. That cap is what makes a memory-exhaustion batch already
  impossible, and it holds only while the decode slice allocates from **what actually arrived** and
  never from a claimed count. No count field exists in this shape to be trusted, which is a property
  worth keeping.
- [Error messages, logs, telemetry] **Covered by the two SHOULD FIX items above** — the four
  claude-authored strings and the nonce are all must-not-log, and the comments say so. No error
  message, no telemetry and no log call is added by this slice.
- [Concurrency] **Not applicable.** Types are erased at compile time; no task, timer, listener,
  subscription or shared mutable state is introduced, so there is nothing to cancel, abort or tear
  down and no check-then-act gap to race.
- [Threat model alignment] **Threat 1 (prompt injection, high, partial) lands and is addressed as
  far as this slice can address it** — claude's own words become text the desktop draws, and the
  sanitization is owed by the client's render boundary, recorded per field. *Hostile daemon
  response*: the frame arrives inside the authenticated Noise session, so this means a compromised
  pyrybox, which can already send anything; this slice's contribution is that an all-required shape
  leaves a fail-closed narrower no optional key to wave through. *Malicious relay*: content-blind and
  on-path, so it can drop, delay or reorder but cannot forge a frame inside the session. *Renderer
  compromise reaching the transport*: unchanged — nothing here moves a secret toward the renderer,
  and the four strings hold nothing secret. **OUT OF SCOPE, named with its owner:** the fail-closed
  parse that rejects an over-long field rather than truncating it (there is no `truncated_fields` to
  report a cut with) belongs to the decode slice of pyrycode-desktop#849's family, upstream
  pyrycode#1965's counterpart; and the render-side escaping belongs to the question-panel slice.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-01
