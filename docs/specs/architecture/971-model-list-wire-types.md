# 971 — `model_list` wire types

**Ticket:** [#971](https://github.com/pyrycode/pyrycode-desktop/issues/971) — feat(wire): model the
`model_list` payload and its nested model option type
**Size:** `size:s` · `security-sensitive`
**Branch:** `feature/971`

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType` — the union to widen, and the `slash_command_list`
  member comment whose *"is NOT modelled on this side"* clause this slice is the one to correct.
- `src/shared/wire/types.ts` → `SlashCommandListPayload`, `WireSlashCommand` — the sibling frame's
  declaration, and the nearest local precedent for every choice here: the `Wire` prefix, the
  required-fields posture, the nullable-not-optional `truncated_fields`, and the trust-tier paragraph.
- `src/shared/wire/types.ts` → `ModelAnnouncedPayload` — the **join partner**. Its doc already states
  that a lookup miss is ordinary and that resolution to a display name is an exact lookup, never
  inference; this frame is the list that lookup runs against, so the two docs must agree.
- `src/shared/wire/types.ts` → `Envelope` — `type` is `EnvelopeType | string`, which is why the
  membership test below is the only thing that catches a dropped union member.
- `src/shared/wire/types.test.ts` → `describe('slash-command-list wire vocabulary (#935)')` — the
  fixture-transcription pattern, the `EnvelopeType` compile-time admission test and the reason it is
  written as an assignment, and the `@ts-expect-error`-per-omitted-key block.
- `~/Workspace/Projects/pyrycode/internal/protocol/interactive.go` → `ModelListPayload`,
  `ModelOption`, and **both** `MarshalJSON` methods — SSOT for the nine keys and, more importantly,
  for *why* the three array/nullable postures differ. The two marshallers carry different arguments
  and say so explicitly; that asymmetry is AC 2's subject.
- `~/Workspace/Projects/pyrycode/docs/protocol-mobile.md` § `model_list` — the two field tables (SSOT
  throughout), plus the **delivery-window** and **producer-cap** prose that the ticket body does not
  carry and that a downstream consumer needs.
- `~/Workspace/Projects/pyrycode/internal/protocol/testdata/model_list{,_empty,_zero}.json` — the
  three committed fixtures transcribed by AC 3.
- `docs/knowledge/features/slash-command-list-wire-types.md` § "Bounds — deliberately not modelled",
  § "Edge cases and limitations" — the prior ticket's lessons in this exact area: model no bound the
  daemon already enforces, and pair the membership assignment with a `@ts-expect-error` block because
  an open `Envelope.type` makes every other check pass silently.
- `docs/specs/architecture/935-slash-command-list-wire-types.md` — the analogue plan, including the
  shape of its security-review section.
- `CLAUDE.md` § Conventions — the 2026-08-20 daemon-text ruling, quoted in full at the type rather
  than trimmed to its render-only clause.

## Design source

**Figma:** N/A — the ticket carries no `## Figma` section and none is owed. This slice adds two
exported TypeScript interfaces and one string-union member; it renders nothing and has no runtime
footprint. The visual-fidelity check is intentionally skipped.

## Context

The run-configuration sheet's model rows are a hardcoded `MODEL_CATALOG` array in
`RunConfigSections.tsx`, and its effort segments a hardcoded `EFFORT_LEVELS` constant beside it. Both
guess at what claude will accept. The daemon publishes the truth — per model, including which
reasoning-effort levels each one supports, and some support none — on a `model_list` frame that
nothing on this side models. This slice declares the vocabulary so the decode, IPC, store and
run-config slices below it are written against a local type instead of against the daemon's Go source.

**Vocabulary only.** Nothing decodes, narrows, stores or renders the frame here. That is the
sequencing this repo used for the sibling frame — #935 declared `slash_command_list`'s types, #936
decoded them, #937 carried them across IPC, #954 stored them — and the sequencing the daemon used
upstream (shape at pyrycode#1704, fixtures and section at #1705, mapping at #1848, producer at #1849,
end-to-end proof at #1845).

`model_list` and `slash_command_list` are siblings drawn from the same `initialize` control reply:
both ride a `control_response` rather than the turn stream, both are conversation-scoped snapshots
that replace a reader's view rather than deltas amending it, and receiving either neither opens nor
closes a turn. This one inventories the **identities** claude will run as; that one the **verbs** the
working directory will accept.

**No ADR is owed.** Every decision here is an application of a convention this file already holds —
the `Wire` prefix, required-fields-only, nullable-not-optional, bounds-not-re-modelled. The
documentation phase owns the package overview; the shape it wants is
`docs/knowledge/features/slash-command-list-wire-types.md`.

## Design

Three edits to one production file, `src/shared/wire/types.ts`. No other production file is touched.

### 1. `EnvelopeType` gains `'model_list'`

Placed **immediately before** the `'slash_command_list'` member, so the two siblings sit adjacent and
each member comment can point at the other without a reader hunting. The comment follows the
neighbours' form: v2 outbound (binary → phone), interactive-capability-gated, absent from the daemon's
`v1TypeSet` so an old client never receives it, a conversation-scoped snapshot rather than a turn
event, and the SSOT trail.

> **⚠️ The paragraph below is SUPERSEDED — see [§ Revisions](#revisions), 2026-09-02.** Its final two
> sentences are false: a connect-time snapshot *does* exist. The text is left standing rather than
> rewritten so the audit trail shows what was designed and what corrected it.

The member comment additionally records the **delivery window**, because it is the fact a consumer
will otherwise get wrong and the ticket body does not carry it: what the daemon runs on a schedule is
an *ask*, not a delivery. Three losses sit between emit and client — no conversation routed yet (the
eager first child's menu is lost unconditionally), a busy session (the frame is classed droppable and
nothing is retried), and a session rotation (the fresh child's events no longer match the lane's
binding). There is **no connect-time snapshot and no way to ask for one**; only a *reconnecting*
client with a cursor predating the frame is replayed it. So: **never block a model menu on this
frame.**

### 2. `WireModelOption` — the nested per-model row

```ts
export interface WireModelOption {
  resolved_model: string
  value: string
  display_name: string
  effort_levels: string[]
  supports_auto_mode: boolean
  truncated_fields: string[] | null
}
```

Six keys, wire order, all required, no `omitempty` upstream. Named `WireModelOption` rather than
`ModelOption` for the reason `WireSlashCommand` records: `Wire` is this cluster's prefix for a nested
row whose bare name is generic enough to be wanted downstream (`WireQuestion`, `WireQuestionOption`,
`WireModalOption`, `WireSlashCommand`), **and** the bare `ModelOption` is already used across this
repo's prose to mean the *daemon's* Go type — in `QuestionShownPayload`'s doc comment, in the
`#935` test block, and in two package overviews. Leaving it unclaimed keeps those pointing where they
always did.

Placed immediately before `WireSlashCommand`, mirroring the union order.

### 3. `ModelListPayload`

```ts
export interface ModelListPayload {
  conversation_id: string
  models: WireModelOption[]
  dropped_models: number
}
```

Placed between `WireModelOption` and `WireSlashCommand`, so row-then-payload reads the same way twice
down the file.

### Doc-comment obligations

The two interfaces carry the contract; these are the statements Phase B must land, each traceable to
an AC.

**A. The three-way array asymmetry, and why it is upstream's (AC 2).** One frame states three
different positions on empty, and a reader who assumes one rule gets two of them wrong. Each is
decided by a distinct upstream argument, both marshallers naming their own:

| Field | Posture | Upstream's reason |
|---|---|---|
| `models` | plain array, never `null` | `ModelListPayload.MarshalJSON` normalises nil → `[]`. `[]` is a **positive statement** that claude offered nothing, so no consumer branches on null. |
| `effort_levels` | plain array, never `null` | `ModelOption.MarshalJSON` normalises nil → `[]` — but for the **opposite** reason: `[]` here is a **collapse**. Haiku's live entry omits `supportedEffortLevels` entirely, and a client's behaviour is identical for absent, `null` and `[]` (no effort control), so the wire states **one** position for all three. Do not model it optional; do not invent an absent/empty distinction the wire does not carry. |
| `truncated_fields` | `string[] \| null`, nullable and **not** optional | Deliberately **exempt** from both normalisations: `nil` and `[]` say the identical thing here ("nothing was cut") and no consumer branches on the difference. |

The doc states this asymmetry is upstream's rather than an oversight, and cites the two `MarshalJSON`
methods as the place each argument lives.

**B. Field contracts a name does not carry (AC 2).**

- `value` is **the argument you pass** (`claude --model <value>`), not a dated identifier and not
  parseable: the measured entries are `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`.
  Splitting on `-` to derive a family does not work; no consumer may try.
- `resolved_model` is what `value` resolves to **right now** — the concrete identifier, published
  *before* the first turn, which is what lets a client show what an alias currently means instead of
  inferring it from an announcement after the fact.
- `display_name` is claude's human label and **the intended join** against a per-turn
  `model_announced` identifier — not `resolved_model`, because the announcement names a concrete
  dated identifier while these rows are alias families. A lookup may miss, and that is ordinary
  rather than an error; `ModelAnnouncedPayload`'s doc already states the same from the other side.
- `supports_auto_mode` is whether claude accepts `auto` permission mode for this model. claude
  refuses per model, so a client greys the option out on `false` (pyrycode-desktop#682). Absent in
  claude's reply decodes to `false`, which is the correct reading — a `false` here is a value, never
  an absence.
- `truncated_fields` names **this row's own** cut fields, in producer order `resolved_model`, `value`,
  `display_name`, `effort_levels`. It is load-bearing rather than decoration: a reader ignoring it
  presents claude's cut text as complete and would offer back a `value` it was never told was
  truncated. Each row reports its own — there is no hoisted or flattened list on the payload. The
  element vocabulary stays a plain `string[]`, not narrowed to those four names, for `WireSlashCommand`'s
  recorded reason: a closed set would fail-close a valid future frame.
- `dropped_models` is counted and carried, so **`models.length + dropped_models` is the menu's true
  size**. `0` is a value, never consulted for truthiness. The producer's cap is **ten** entries and it
  is a **daemon-side producer cap, not a wire constant** — a client must never hardcode it, treat a
  list of exactly ten as a signal, or derive it from anything but this field.

**C. The `effort_levels` direction hazard (Technical Notes).** The daemon's inbound `validEffort`
enum is **closed** at the five measured levels, while `validModel` was widened (pyrycode#1838) for
exactly these rows. A level claude adds in future would be published here and refused inbound. That
asymmetry is upstream's and is not this repo's to fix; the type states it so a later consumer handles
the refusal rather than assuming a published level is sendable.

**D. `value` round-trips, and publishing it does not make it trusted (AC 4, Technical Notes).**
Nothing in this slice sends anything, but `value` is the first field in this family a client is meant
to send **back**, on `set_session_settings`. The daemon re-validates it inbound at `internal/relay`'s
`validModel` rather than trusting a value it published itself — and that rule is pyrycode#845's
argv-injection defense, because an accepted value reaches two sinks: the claude argv, and the live
child's turn text as `/model <value>` on one line. So the frame is a **report, never a control
input**, with that one amendment stated rather than left to be discovered.

**E. Provenance and trust (AC 4).** `resolved_model`, `value`, `display_name` and **every string in
`effort_levels`** are claude-authored strings that crossed the subprocess trust boundary. The daemon
**bounds them and does not sanitize them** — nothing on this path strips control characters or
terminal escape sequences — so they stay untrusted, model-influenced text all the way here, and the
render boundary that owes the sanitization is **this client's**. Safe to render as inert, escaped,
length-bounded text; never into a raw-markup sink (`innerHTML`, `dangerouslySetInnerHTML`), an
attribute, a URL, a filename, a cache key, a lookup path, or a log — CLAUDE.md's ruling in full
rather than its render-only subset. This is a **higher** trust tier than `WireSlashCommand`'s
workspace-authored strings, and the existing "at `model_list`'s trust tier" anchors in this file
depend on it being stated here.

**F. No bound is re-modelled.** The bound is the producer's, decided at construction. A second cap
here would be a second place the limit is decided and the two could disagree silently; a
stricter-than-wire type would fail-close a valid frame. The frame cannot arrive unbounded regardless:
`MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any parse — the guard is in
`parseInboundMessage`, ahead of `decodeEnvelope`. No charset check either.

### 4. The one correction — and the four that must not be touched

Exactly **one** shipped sentence becomes false. In the `slash_command_list` member comment inside
`EnvelopeType`, the clause reading *"Its sibling `model_list` rides the same reply and is NOT modelled
on this side, so there is no local precedent to copy from it"* is this slice's to correct: `model_list`
becomes modelled, and the precedent becomes the member immediately above it. The clause's second half
— identities versus verbs — stays true and is preserved verbatim.

**DO NOT TOUCH, verified against the tree 2026-09-02.** The other four `model_list` mentions in
`types.ts` are **anchors, not assertions**, and none says the frame is unmodelled:

| Where | What it says | Why it stays |
|---|---|---|
| `QuestionShownPayload`'s security paragraph | "at `model_list`'s trust tier" | Anchors a trust tier by name. Still true — and *more* true once the tier is declared here. |
| `QuestionShownPayload`'s `questions` paragraph | contrasts its empty array with `model_list`'s `models` | Contrast, still exact. |
| `WireSlashCommand`'s security paragraph | "a LOWER trust tier than the claude-authored strings `model_list` … carry" | Contrast, still exact. |
| `SlashCommandListPayload`'s opening | "that one inventories the IDENTITIES … this one the VERBS" | Identity contrast, unaffected by modelling. |

The single mention in `types.test.ts` (the `#919` block's empty-array contrast) is likewise an anchor
and stays. Editing any of these because it matched a grep is the failure mode this table exists to
prevent. `docs/knowledge/features/slash-command-list-wire-types.md` also says `model_list` is
unmodelled — that file is the **documentation phase's** to amend, not this slice's.

## State + concurrency model

None. This slice declares types. It launches no async work, registers no listener, holds no timer,
opens no subscription and mutates no store. There is no ownership, cancellation or teardown question
to answer. Frame delivery, retention and connect-time reconciliation are the daemon's
(pyrycode#1845–#1849); the decode, the IPC carry and the store are the slices below this one.

## Error handling

None in this slice, by construction — nothing parses. The declaration's contribution to the decode
that follows is that **every field is required**, which leaves the later fail-closed narrower no
optional key to wave through: a missing field is a reject by construction.

**A required field is only a promise the wire has not kept until it is checked.** Reached through a
bare `as ModelListPayload` on `Envelope.payload`, a frame whose `truncated_fields` key is absent
yields `undefined`, and `row.truncated_fields?.includes('value')` is then falsy for exactly the reason
`null` is — the reader concludes nothing was cut and presents claude's cut text as complete, the one
wrong answer D above exists to prevent. **Nullable is not optional.** The doc comment states the
reading rule as conditional on validation rather than unconditionally.

## Testing strategy

Type-level shapes in the existing `src/shared/wire/types.test.ts`, a
`model-list wire vocabulary (#971)` block appended after the `#935` block. Values are transcribed
**verbatim** from the three committed upstream fixtures, each with a comment naming its
`internal/protocol/testdata/` source path, so a contract change shows up as a fixture diff rather than
as a disagreement between two hand-written guesses. **No departures** — unlike the `#935` block, every
case here is copyable and nothing is abridged or hand-authored.

Scenarios:

- **`EnvelopeType` admission** — a compile-time assignment (`const list: EnvelopeType = 'model_list'`).
  It is the only thing that catches a dropped member: `Envelope.type` is `EnvelopeType | string`, so a
  later `case 'model_list':` compiles green whether or not the member was ever added.
- **`WireModelOption`'s six keys** — the `default` row. Pins `resolved_model: '<unmeasured>'` with its
  **literal angle brackets**: the fixture's committed bytes carry `<` because Go's encoder escapes
  `<`, `>` and `&`, so the escaping is a transport artefact and the decoded value holds the raw
  characters — the exact byte a render sink would be tempted by, in a field E names as claude-authored.
- **The populated payload** (`model_list.json`) — five rows in claude's own order, `dropped_models: 2`.
  Asserts `models.length + dropped_models === 7` as a value rather than only in prose; the two
  bracketed `value`s (`opus[1m]`, `claude-fable-5[1m]`) carried verbatim, with the no-`-`-split rule
  stated at the case that would tempt it; the one row reporting `truncated_fields: ['value']` beside
  four reporting `null`; Haiku's row as the all-at-once case — the only real `resolved_model`, an empty
  `effort_levels`, and `supports_auto_mode: false`; and `expect(payload).not.toHaveProperty('truncated_fields')`,
  since a cut is per row and a reader grepping the payload for one must find nothing.
- **The fixture does not satisfy the producer's own invariant, and that is worth pinning.** Upstream
  states a non-zero `dropped_models` always arrives beside exactly ten entries, yet this fixture
  carries five and a `dropped_models` of `2`. It is a **shape** fixture, not a live capture. The test
  asserts the arithmetic (the contract) and comments the mismatch, so a later reader does not derive
  the ten-entry cap from a list length — which the SSOT explicitly forbids.
- **The empty frame** (`model_list_empty.json`) — `models: []`, `dropped_models: 0`, summing to `0`. A
  positive statement that claude offered nothing, never a null branch.
- **The zero-value row** (`model_list_zero.json`) — the only route that reaches all six
  `WireModelOption` keys at once, since a frame with no entries reaches none of them. `''` is a value
  and not a vanished key (no `omitempty` on any of the nine); `effort_levels: []` and
  `truncated_fields: null` read with no absent-versus-empty branch anywhere; `supports_auto_mode: false`
  is a value.
- **A `@ts-expect-error` block, one directive per omitted key** across both interfaces (six + three).
  Relaxing any field to optional turns its directive unused and reddens the file at compile time —
  the deterministic guard behind the all-required posture, following the `#935` block's precedent.

**Not tested:** any entry-count or per-field byte bound, since nothing here enforces one and a test
asserting one would pin a fiction; and any decode, narrowing, store or render, which this slice does
not add.

**Gate:** `npm test -- src/shared/wire/types.test.ts` and `npm run build`. `npm run typecheck`
short-circuits on a node-side failure and hides every renderer error, so on a red run
`npx tsc --noEmit -p tsconfig.web.json` runs separately before any error count is read as the blast
radius.

## Open questions

1. **Does `model_list` belong adjacent to `slash_command_list` in the union, or beside
   `model_announced`?** Resolved at design time in favour of adjacency to its sibling: the two ride
   the same `initialize` reply, the correction in § 4 is *in* the `slash_command_list` member comment,
   and adjacency lets each member point at the other. `model_announced` is a per-turn event in a
   different family; the two are linked by the `display_name` join, which the doc states rather than
   the ordering implying.
2. **Should the `truncated_fields` element vocabulary be narrowed to the four producer names?** No —
   `WireSlashCommand` already recorded the reason (a closed set fail-closes a valid future frame), and
   this slice follows it rather than re-arguing it.
3. **Does the ten-entry producer cap belong in the type as a constant?** No — § F. It is a daemon-side
   producer cap that may change without a contract change, and the SSOT forbids a client deriving it
   from anything but `dropped_models`.

Anything unresolved during Phase B that changes the design is recorded as a `## Revisions` entry in
the same commit as the code that departs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — a cut `effort_levels` is unknowable from `effort_levels` alone,
  and the plan as first written stated the collapse without stating its cost.** The boundary is
  `Envelope.payload` (`unknown`) → `ModelListPayload`, and this slice deliberately adds no narrower.
  The `[]`-as-collapse rule in § A is correct and is exactly what makes a cut invisible: because
  absent, `null` and empty all arrive as `[]`, a `truncated_fields` **naming `effort_levels`** is the
  *only* signal separating "the list was cut to nothing, or shortened" from "this model exposes no
  effort control". Read as *none*, a cut list silently removes an effort control the model actually
  supports — and on a bare `as ModelListPayload` cast over a frame whose `truncated_fields` key is
  absent, `row.truncated_fields?.includes('effort_levels')` is falsy for exactly the reason `null` is,
  so the reader concludes nothing was cut. **Nullable is not optional**; the reading rule is
  conditional on validation and Phase B states it that way at `WireModelOption`, not unconditionally.
  This is `WireSlashCommand`'s cut-`aliases` hazard transposed onto a different field, and naming it
  as the same shape is what keeps the later narrower from closing one and missing the other.
- **[Trust boundaries] SHOULD FIX — a truncated `value` passes `validModel` and selects the wrong
  model silently.** Sharper here than on any sibling, because `value` is the one field a client sends
  back. `validModel` is a **charset-and-length** rule, not a membership check against the published
  list: a `value` cut mid-token (`claude-fable-5[1m]` → `claude-fable-5`, or `opus[1m]` → `opus`)
  stays alphanumeric, stays inside 64 bytes, and is **accepted**. The operator picks one row and gets
  another model, with no error frame anywhere on the path. That is the concrete consequence of
  ignoring `truncated_fields` on this frame, and it is why the field is load-bearing rather than
  decoration. Phase B states it at the type.
- **[Tokens, secrets, credentials] SHOULD FIX — record the send-back amendment and both sinks at the
  type.** The payload carries no token, key or nonce: `conversation_id` is a daemon-asserted routing
  key, is not unguessable, is not a secret, and grants no inbound capability. The frame declares no
  inbound verb. The amendment a client needs is that `value` **is** meant to travel back on
  `set_session_settings`, and publishing it does not make it trusted — the daemon re-validates at
  `internal/relay`'s `validModel` rather than trusting a value it published itself. Phase B carries
  *why* that rule is shaped as it is, because a reader who does not know will read it as arbitrary:
  it is pyrycode#845's argv-injection defense, and an accepted value reaches **two** sinks — the
  claude argv (`--model` and the value as separate `execve` elements, no shell) and the live child's
  turn text, written as `/model <value>` on one line, which is why an accepted value must stay a
  single whitespace-free token.
- **[File / storage operations] SHOULD FIX — this plan *designs in* a lookup keyed by untrusted text,
  which is the one category that is not vacuous here.** Nothing derives a filesystem path and nothing
  persists. But § B makes `display_name` **the intended join** against a `model_announced` identifier,
  and a join is a lookup: the plausible implementation is an index built as `index[row.display_name] =
  row`, and `display_name` is claude-authored. A row whose `display_name` is `__proto__` written
  through plain-object assignment sets the index's prototype — untrusted, model-influenced text
  reaching `Object.prototype` from a frame this type declares. The shape hazard is compounded by
  `value` and `resolved_model` *looking* like identifiers (`claude-haiku-4-5-20251001`) while the
  committed fixture's `resolved_model` is literally `<unmeasured>`, angle brackets included. This is
  why CLAUDE.md's ruling is carried in **full** — filename, cache key and lookup path clauses
  included — rather than trimmed to the render-only subset a paraphrase leaves behind, and why Phase B
  states that the join is an exact equality lookup and that any index built from these fields uses a
  `Map`, never a plain-object index. No consumer exists yet to get it wrong; the type is where the
  first one learns it.
- **[Inter-process / Electron attack surface] No findings — this slice has no runtime footprint.** It
  adds two `interface` declarations and one union member. All are type-level and erased at compile
  time, so the JavaScript emitted for `src/shared/wire/types.ts` is byte-unchanged; no `contextBridge`
  API, no `ipcMain` channel, no `BrowserWindow`, no handler, and nothing new crossing the preload
  bridge. The renderer gains no capability it did not have.
- **[Cryptographic primitives] No findings — no primitive is reached.** No randomness is generated, no
  key or nonce is handled, and no field is compared against a secret, so no `timingSafeEqual`
  obligation arises. The Noise session this frame rides inside is untouched.
- **[Network & I/O] OUT OF SCOPE — the bound is enforced upstream of any parse and must not be
  re-modelled here.** An oversized `models` array cannot reach a decode unbounded:
  `MAX_PLAINTEXT_BYTES` caps the decrypted envelope, and that guard is in `parseInboundMessage` —
  ahead of `decodeEnvelope` and ahead of every narrower — so a file-name grep for the constant walks
  past it. The producer additionally caps entries at ten and reports its cut through `dropped_models`.
  A bound in this type would be a second place the limit is decided, could disagree silently, and
  stricter-than-wire would fail-close a valid frame. The defensive parse belongs to the decode slice.
- **[Error messages, logs, telemetry] SHOULD FIX — keep the never-a-log clause and do NOT copy the
  sibling's measurement for it.** `WireSlashCommand`'s doc argues the clause from measured bytes:
  `0x0a` is the only sub-`0x20` byte across the capture's 51 entries, so a workspace author can forge
  a log record. **That measurement is the sibling's and does not transfer** — these strings are short
  model names, labels and effort levels, and no control byte is measured in them. Transcribing that
  rationale here would ship a false measurement claim. The clause still holds, on the weaker but
  honest ground that the daemon **bounds and does not sanitize**, so an unmeasured control byte is
  *permitted* by the contract rather than excluded by it, and the tier is the higher one: these
  strings are claude-authored, which makes them reachable by prompt injection in a way workspace text
  is not.
- **[Concurrency] No findings — no async work exists to own or cancel.** This slice launches no task,
  registers no listener, holds no timer and mutates no shared state, so there is no ownership,
  cancellation, teardown or check-then-act question. Delivery, retention and reconciliation are the
  daemon's (pyrycode#1845–#1849).
- **[Threat model alignment] Named with owners; nothing exploitable as designed.** *Prompt injection*
  (ADR 025 threat 1, `severity: high`, `mitigation: partial`) lands here at the **highest** tier in
  this file — claude-authored rather than workspace-authored — and the sanitization is owed by this
  client; this slice inherits and records the constraint, and the render slice of this family
  discharges it. *Hostile relay* is content-blind and on-path: dropping or delaying the frame yields
  an absent or stale menu, which is precisely why § 1 states **never block a model menu on this
  frame**; a **replayed** stale frame can misinform (offering a row claude no longer accepts) but
  grants nothing, since the inbound path re-validates and claude may still refuse — which is the
  refusal § C already requires a consumer to handle. *Hostile daemon response* is the later narrower's
  to reject, and this slice's all-required declaration is what leaves that narrower no optional key to
  wave through. *Renderer compromise reaching the transport* is unaffected: this slice adds no IPC
  surface and moves no secret.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Revisions

### 2026-09-02 — the delivery window has two lanes, not one

**Driven by:** the verifier's MUST FIX on [PR #978](https://github.com/pyrycode/pyrycode-desktop/pull/978#issuecomment-5514649580).

**What was wrong.** § 1 above, and the `'model_list'` member comment it prescribed, concluded that
*"there is no connect-time snapshot and no way to ask for one; only a reconnecting client with a
cursor predating the frame is replayed it."* That is false against the daemon tree. The claim was
copied from `docs/protocol-mobile.md` § `model_list`, which is the **stale half** of that file: its
own `2026-09-02` changelog entry names § `model_list`'s *"no connect-time snapshot today"* and its
*"deliberately absent from the Mode B list"* as both stale, records that the reconcile and its
enumeration landed and *"neither ever reached this file"*, and states that the Go comments carrying
the same false claims were left standing on purpose because no ticket owned them. The ticket body
contradicted the section directly (*"connect-time delivery at pyrycode#1867"*), and the body was right.

**How the correction was derived.** From the daemon's code rather than its prose, which is what the
sibling frame's own correction did:

- `internal/relay/v2session_seams.go` → `RetainedModelLists`, documented there as the third **Mode B**
  reconcile seam alongside `OutstandingModals` and `OutstandingQueues`.
- `cmd/pyry/relay.go` → `RetainedModelLists: w.retainedModelLists`, and `cmd/pyry/main.go` →
  `retainedModelLists(convReg, pool)`. Wired end to end, not a nil stub.
- `internal/relay/v2session_modelreconcile.go` → `reconcileModelLists`, called from
  `internal/relay/v2session_handshake.go`'s `handleNoiseInit` success tail on **every** handshake,
  gated only on the negotiated interactive flag and a non-nil seam.
- `cmd/pyry/session_model_list.go` → `retainedModelLists` for the enumeration's own semantics.

**The new contract, as stated at the type.** The live lane and its three loss points were **verified
still accurate** and are kept. What replaces the false conclusion:

1. A **connect-time snapshot exists**: the retained set is unicast to the just-opened conn on every
   interactive handshake, so a *first* attach is reached, not only a reconnecting one.
2. It arrives as a **burst of N payloads outside any turn** — enumerate-all, one per conversation
   whose bound session holds a list, because a relay session carries no conversation id to key on.
   **Archived conversations contribute**, and the order is the daemon's registry insertion order and
   is **not** a contract.
3. The reconciled frame carries **no `event_id`**, deliberately: it is kept out of the turn-event
   replay ring, which makes `forwardEnvelope`'s `last_event_id` dedup **inert** for it. A store
   deduping on event id will double-apply or drop it.
4. **Correlate on `conversation_id`.** The envelope's own `id` is a fixed `1` upstream and explicitly
   non-load-bearing.

**What did not change.** *Never block a model menu on this frame* survives, on narrower and now
correct grounds: the snapshot reaches only a session actually **holding** a list, and the eagerly
spawned bootstrap child has no conversation record, so it contributes on neither lane. No type, no
field, no fixture and no test changed — the correction is doc-comment only. The SSOT trail at the
member now points at the two daemon symbols and **warns the reader off** § `model_list`'s live prose,
naming the changelog as the current half, so the next slice does not re-import the same false claim.

**Why this was a blocker rather than a nit.** For a vocabulary-only slice the documented contract *is*
the deliverable, and four slices are written against this docblock. Items 2–4 are exactly the facts a
decode/IPC/store author needs and the old paragraph denied or omitted all three. It also asserted an
**absence**, which needs more evidence than a presence does — and the evidence pointed the other way
in both the ticket body and the daemon's own changelog.
