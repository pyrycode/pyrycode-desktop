# Model-list wire types

The wire vocabulary for the daemon's model inventory: one `EnvelopeType` member and two interfaces
mirroring the daemon's published `model_list` contract field for field.

Introduced in [#971](https://github.com/pyrycode/pyrycode-desktop/issues/971), declaration only at
that point — nothing decoded, narrowed, stored or rendered it yet.
[#972](https://github.com/pyrycode/pyrycode-desktop/issues/972) added the fail-closed decode (see
[Inbound message decode](inbound-message-decode.md) and its [Extension
history](inbound-message-decode-history.md)).
[#973](https://github.com/pyrycode/pyrycode-desktop/issues/973) carried the decoded value across IPC as
the `modelList` arm of `DaemonEvent` (see [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md)); still nothing stores or renders it. Split from #561. SSOT is
`pyrycode/pyrycode` `internal/protocol/interactive.go` (`ModelListPayload` / `ModelOption`); do not
trust `docs/protocol-mobile.md` § `model_list` for the delivery window — see
[§ Delivery window](#delivery-window-two-lanes) below. The run-configuration sheet's model rows and
effort segments — `MODEL_CATALOG` and `EFFORT_LEVELS`, both formerly hardcoded in
`RunConfigSections.tsx` — are now built from this frame: #975 deleted the former, #976 the latter. The
same sequencing this repo used for [slash-command-list wire types](slash-command-list-wire-types.md)
(#935 declared → #936 decoded → #937 carried across IPC → #954 stored) played out here too: #971
declared → #972 decoded → #973 carried across IPC → #974 stored → #975/#976 rendered.

## What it does

The daemon publishes the models claude will accept for a conversation, including which
reasoning-effort levels each one supports — some support none — drawn from the same `initialize`
control reply [`slash_command_list`](slash-command-list-wire-types.md) comes from. `model_list`
inventories the **identities** claude will run as; `slash_command_list` inventories the **verbs** the
working directory will accept. Neither family is modelled from the other; the two now sit adjacent in
`EnvelopeType`, `model_list` first, so each member comment can point at the other.

```ts
export type EnvelopeType =
  | …
  | 'question_answer'
  | 'question_refused'
  | 'model_list'            // v2, control-reply snapshot, interactive-gated, not in the daemon's v1TypeSet
  | 'slash_command_list'
  | …

export interface WireModelOption {
  resolved_model: string
  value: string
  display_name: string
  effort_levels: string[]
  supports_auto_mode: boolean
  truncated_fields: string[] | null
}

export interface ModelListPayload {
  conversation_id: string
  models: WireModelOption[]
  dropped_models: number
}
```

Wire order, snake_case keys, every field required — no `omitempty` on any of the nine keys across the
two structs, so `dropped_models: 0` and an empty `display_name` are real values rather than vanished
ones. The key set is a deliberate **subset** of claude's per-entry vocabulary: `description` and
`supportsFastMode` are not carried because neither has a named consumer, and `supportsEffort` is
subsumed by `effort_levels`.

## How it works

**A conversation-scoped snapshot, not a turn-stream item.** It rides a `control_response` from the
`initialize` reply, so receiving one neither opens nor closes a turn, and it **replaces** a reader's
view rather than amending it with a delta. `conversation_id` is an outbound routing/scoping key only —
it grants no inbound capability and is not a nonce.

**Named `WireModelOption`, not `ModelOption`, deliberately** — the same reason
[`WireSlashCommand`](slash-command-list-wire-types.md) is not named `SlashCommand`: `Wire` is this
cluster's prefix for a nested row whose bare name is generic enough to be wanted again downstream
(`WireQuestion`, `WireQuestionOption`, `WireModalOption`, `WireSlashCommand`), and the bare
`ModelOption` is already used across this repo's prose to mean the **daemon's** Go type — in
[`QuestionShownPayload`](question-shown-wire-types.md)'s doc comment, in `types.test.ts`, and in two
package overviews (this one included). Leaving it unclaimed keeps those pointing where they always did.

**One frame states three different positions on empty — the asymmetry is upstream's, not an oversight.**

| Field | Posture | Upstream's reason |
|---|---|---|
| `models` | plain array, never `null` | `ModelListPayload.MarshalJSON` normalises nil → `[]`. `[]` is a **positive statement** that claude offered nothing. |
| `effort_levels` | plain array, never `null` | `ModelOption.MarshalJSON` normalises nil → `[]` for the **opposite** reason: it is a **collapse**. Haiku's live entry omits `supportedEffortLevels` entirely, and a client's behaviour is identical for absent, `null` and `[]` (no effort control), so the wire states one position for all three. |
| `truncated_fields` | `string[] \| null`, nullable and **not** optional | Exempt from both normalisations: `nil` and `[]` say the identical thing here ("nothing was cut") and no consumer branches on the difference. |

A reader who assumes one rule for all three gets two of them wrong.

**A cut `effort_levels` is unknowable from `effort_levels` alone — the one place the collapse costs a
reader.** Because absent, `null` and empty all arrive as `[]`, a `truncated_fields` **naming**
`effort_levels` is the *only* signal separating "the list was cut to nothing, or shortened" from "this
model exposes no effort control". Read as *none*, a cut list silently removes an effort control the
model actually supports. **That reading rule is only sound on a validated frame**: reached through a
bare `as ModelListPayload` on `Envelope.payload`, a row whose `truncated_fields` key is absent decodes
to `undefined`, and `row.truncated_fields?.includes('effort_levels')` is then falsy for exactly the
reason `null` is — the reader concludes nothing was cut. Nullable is not optional; this is
[`WireSlashCommand`](slash-command-list-wire-types.md)'s cut-`aliases` hazard transposed onto a
different field.

**Field contracts a name does not carry:**

- `value` is **the argument you pass back** (`claude --model <value>`) — not a dated identifier and
  not parseable. Measured entries: `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku` — a
  literal, a bare alias, or a bracketed variant. Splitting on `-` to derive a family does not work.
- `resolved_model` is what `value` resolves to **right now**, published before the first turn. It is
  **not reliably populated** — four of the populated fixture's five rows carry the literal
  `<unmeasured>`, angle brackets included (a Go-encoder escaping artefact; the decoded value holds the
  raw characters) — so it is not an identifier merely because one row makes it look like one.
- `display_name` is claude's human label and **the intended join** against a per-turn
  `model_announced` identifier — not `resolved_model`, because the announcement names a concrete
  dated identifier while these rows are alias families. A lookup may miss, and that is ordinary; the
  join is an **exact equality lookup**, never inference. **Any index built from this field must be a
  `Map`, never a plain object** — `display_name` is claude-authored, and a `__proto__` label written
  through `index[row.display_name] = row` reaches `Object.prototype`.
  **This sentence reads two ways, and #975 is the ticket that had to settle it**: "the intended join"
  parses either as *join on `display_name`* or as *display `display_name` after joining on something
  else*. `resolved_model` sounds like the natural join field (an announcement and a `resolved_model`
  are both concrete identifiers), and it is also the only field under which the lookup would ever
  actually fire — but a row's own `resolved_model` is routinely a superstring of its own `value`
  (`'haiku'` → `'claude-haiku-4-5-20251001'`), so joining on it gives #975's mandated
  superstring-must-not-match guard an exception. **The shipped join key is `value`** — compared
  `===`, never `resolved_model` — which keeps the guard exceptionless at the cost of a lookup that
  stays mostly dormant (claude echoes an identifier at least as specific as the one it was given, so
  it rarely equals a bare published `value`). `display_name` is what a *hit* renders, not what
  either side compares. See [#975 codebase notes](../codebase/975.md) § Revisions for the full
  argument.
- `supports_auto_mode` is whether claude accepts `auto` permission mode for this model — since
  \#1022, [the permission-mode menu](composer-permission-mode-menu.md) hides the `auto` entry on a
  matched row saying `false`, checked strictly (`=== false`, never `!supports_auto_mode`) rather than
  greyed out, the operator having ruled against a disabled row. Absent in claude's reply decodes to
  `false`, the correct reading, not a missing one.
- `truncated_fields` names **this row's own** cut fields, producer order `resolved_model`, `value`,
  `display_name`, `effort_levels`. Load-bearing, not decoration — see the cut-`value` hazard below.
  Element vocabulary stays a plain `string[]`, not narrowed to those four names, for
  `WireSlashCommand`'s recorded reason: a closed set would fail-close a valid future frame.
- `dropped_models` is counted and carried verbatim, so **`models.length + dropped_models` is the
  menu's true size**. `0` is a value, never consulted for truthiness.

**A cut `value` is load-bearing and bites harder here than the same shape does on any sibling —
because `value` is the one field a client sends back.** `validModel` (daemon-side, `internal/relay`)
is a **charset-and-length** rule, not a membership check against the published list: a `value` cut
mid-token (`claude-fable-5[1m]` → `claude-fable-5`, `opus[1m]` → `opus`) stays alphanumeric, stays
inside 64 bytes, and is **accepted**. The operator picks one row and gets a different model, with no
error frame anywhere on the path.

**`effort_levels` carries a direction hazard, and it is upstream's to fix, not this repo's.** The
daemon's inbound `validEffort` enum is **closed** at the five measured levels (`low`, `medium`,
`high`, `xhigh`, `max`), while `validModel` was **widened** (pyrycode#1838) for exactly these rows —
so a level claude adds in future would be published here and refused inbound. A consumer must read a
published level as a candidate, not a guarantee.

**The frame is a report, never a control input — with one amendment.** `value` is meant to travel back
on `set_session_settings`. Publishing it does not make it trusted: the daemon re-validates it inbound
at `validModel` rather than trusting a value it published itself — pyrycode#845's argv-injection
defense. An accepted value reaches **two** sinks: the claude argv (`--model` and the value as separate
`execve` elements, no shell) and the live child's turn text, written as `/model <value>` on one line —
so an accepted value must stay a single whitespace-free token.

**Trust tier — higher than `slash_command_list`'s.** `resolved_model`, `value`, `display_name` and
every string in `effort_levels` are **claude-authored** strings that crossed the subprocess trust
boundary — a *higher* tier than [`WireSlashCommand`](slash-command-list-wire-types.md)'s
workspace-authored strings, which makes them reachable by prompt injection in a way workspace text is
not. The daemon **bounds them and does not sanitize them**: nothing on this path strips control
characters or terminal escape sequences, so the render boundary that owes the sanitization is this
client's. Safe to render as inert, escaped, length-bounded text; never into a raw-markup sink
(`innerHTML` / `dangerouslySetInnerHTML`), an attribute, a URL, a filename, a cache key, a lookup path,
or a log — CLAUDE.md's daemon-text ruling in full. **The never-a-log clause rests on a different
footing than `WireSlashCommand`'s**: that sibling argues it from a measurement (`0x0a` is the only
sub-`0x20` byte across 51 workspace-authored entries). No control byte is measured in these short
model labels, so that measurement does not transfer here — the clause holds on the *contract* instead
(the daemon bounds and does not sanitize, so a control byte is *permitted* rather than excluded), and
transcribing the sibling's evidence would have shipped a false claim about this frame.

## Delivery window — two lanes

**This is the section a downstream consumer must read before writing anything against this frame.**
The `EnvelopeType` member comment for `'model_list'` in `types.ts` states the delivery contract in
full; this section summarizes it and records why the summary changed mid-review.

The frame arrives on two lanes:

1. **Live lane.** What the daemon runs on a schedule is an *ask*, not a delivery: one `initialize`
   exchange per claude child spawn, emitted to whatever interactive connections exist at that instant.
   Three losses sit between emit and client — no conversation routed yet (the eagerly-spawned
   bootstrap child's menu is lost unconditionally), a busy session (the frame is classed droppable at
   fan-in, nothing retried, no error frame says a menu was lost), and a session rotation (a new child
   means a new ask, but does **not** deliver a fresh menu).
2. **Connect-time snapshot.** The daemon's `reconcileModelLists` fires from its handshake tail on
   **every** handshake — a Mode B reconcile seam (`RetainedModelLists`, alongside `OutstandingModals`
   and `OutstandingQueues`) — and unicasts the retained set to the just-opened connection. A **first**
   attach is reached, not only a reconnecting one. It arrives as a **burst of N payloads outside any
   turn**, one per conversation whose bound session holds a list (enumerate-all, since a relay session
   carries no conversation id to key on); **archived conversations contribute**; the order is the
   daemon's registry insertion order and is **not** a contract. The reconciled frame carries **no
   `event_id`**, deliberately — it is kept out of the turn-event replay ring, so `forwardEnvelope`'s
   `last_event_id` dedup is **inert** for it, and a store deduping on event id will double-apply or
   drop it. **Correlate on `conversation_id`**; the envelope's own `id` is a fixed `1` upstream and
   explicitly non-load-bearing.

**Still never block a model menu on this frame.** The snapshot narrows the gap rather than closing it
— only a session actually *holding* a list contributes, and the eagerly-spawned bootstrap child
contributes on neither lane. Render a usable UI without one rather than waiting for a frame that may
never arrive.

**Why this took a rework pass.** The architecture spec's first draft concluded there is *no*
connect-time snapshot and *no way to ask for one*, copied verbatim from `docs/protocol-mobile.md` §
`model_list`. That section is the **stale half** of that file: its own `2026-09-02` changelog entry
names both claims stale, records that the reconcile (pyrycode#1863) and its enumeration (#1867) landed
and "neither ever reached this file", and states the Go doc comments carrying the same false claims
were left standing on purpose because no ticket owned them. The verifier caught it as a MUST FIX on
[PR #978](https://github.com/pyrycode/pyrycode-desktop/pull/978#issuecomment-5514649580) — re-derived
from the daemon's code instead (`v2session_seams.go`, `v2session_modelreconcile.go`,
`v2session_handshake.go`, `cmd/pyry/session_model_list.go`) rather than from the stale section. The
lesson generalizes: **a section that survived a sibling's own correction pass is the likeliest stale
one, and `docs/protocol-mobile.md`'s changelog names its own stale sentences verbatim** ("left
standing" / "are both stale") — grep the changelog for that language before quoting any section of
that file as current. The architecture spec's `## Revisions` entry carries the full account.

## Outbound ask (#1165)

Both delivery lanes above are pushes the daemon initiates on its own schedule, and both structurally
miss a conversation created **after** this app connected: the live lane emits once per claude child
spawn and the daemon drops every event whose producing session is not the active conversation's, and
the connect-time reconcile runs inside the handshake tail, so a conversation that did not exist then is
not in it. pyrycode#2125 (merged 2026-09-05) closed that window with an on-demand third path: a
client→daemon `request_model_list` control frame, `interactive`-gated, that draws exactly one
`model_list` in reply — the same payload the connect-time reconcile would have sent, including for a
conversation with **no bound session** (answered from the daemon-wide vocabulary, pyrycode#2124).

```ts
export interface RequestModelListPayload {
  conversation_id: string
}
```

One **required** string, no `omitempty` — the one deliberate divergence from
[`RequestSessionSettingsPayload`](daemon-connection-methods.md#public-surface)'s optional id. That
verb's absent id draws a zero-valued reply, a real answer; there is no zero answer to "what models does
nothing offer," so an unnamed ask here has nothing to ask about and the whole chain (wire type, command
payload, boundary guard, connection method, builder input) types the id as required. `''` still reaches
the wire — the guard checks type, not emptiness — and draws `conversation.not_found` from the daemon
rather than another conversation's list.

The reply is correlated by `in_reply_to` and carries **no `event_id`**, the same deliberate omission
the reconciled frame makes, so it stays out of the turn-event replay ring. A request the daemon cannot
answer draws one `error` frame instead: `conversation.not_found` (not retryable) or the retryable
`model_list.unavailable`. **Neither is retried client-side, ever** — a retry against a relay withholding
the frame is the self-inflicted spin this store's header (see [Model-list store § Edge
cases](model-list-store.md#edge-cases-and-limitations)) forbids, and the rule stated there holds in
full: no consumer may block a model menu on this frame. Both codes fall through
`narrowDaemonErrorOutcome`'s allowlist to `unclassified`; surfacing a refusal to the operator is #1036's
job, not this ticket's.

This slice adds the ask and stops — the outbound `EnvelopeType` member, the payload type above, the
builder, the connection method and its registry delegate, and the `src/main/index.ts` dispatch case (see
[Daemon connection — methods](daemon-connection-methods.md) for the connection-method writeup). **The
receive path gains no branch on whether a frame answered a request** — every `model_list` still lands in
[the model-list store](model-list-store.md) exactly as it does today, unsolicited or not, since the
frame is (and always was) an accept-unsolicited snapshot by contract. Nothing fires this command yet;
[#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166) is the renderer trigger, asking when a
conversation is opened.

## Bounds — deliberately not modelled

No entry cap and no charset check. The producer caps entries at **ten** and reports its own cut
through `dropped_models` — a daemon-side producer cap, not a wire constant, that may change without a
contract change. A client must never hardcode it, treat a list of exactly ten as a signal, or derive
it from anything but `dropped_models`. **The committed fixture does not satisfy the producer's own
stated invariant** (a non-zero `dropped_models` arriving beside exactly ten rows): `model_list.json`
carries five rows beside `dropped_models: 2`, because it pins *shape*, not live traffic — trust the
field, not the length. A second cap in this type would be a second place the limit is decided and
could disagree silently; stricter-than-wire would fail-close a valid frame. The frame cannot arrive
unbounded regardless: `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any parse, in
`parseInboundMessage`, ahead of `decodeEnvelope` and ahead of every narrower.

## Configuration and usage

`src/shared/wire/**` — no React, no DOM, no IPC. Types are erased at compile time; the emitted
JavaScript for `types.ts` is byte-unchanged by this slice. Every field being required is load-bearing:
it leaves the decode slice's future fail-closed narrower no optional key to wave through, so a missing
field is a reject by construction. A required field is still only a promise the wire has not kept
until it is checked — reach this type through that narrower once it exists, never a bare
`as ModelListPayload` on `Envelope.payload`.

The decode exists ([#972](https://github.com/pyrycode/pyrycode-desktop/issues/972),
`parseModelListPayload` + `parseModelOption` in [Inbound message
decode](inbound-message-decode.md)). The IPC carry landed at
[#973](https://github.com/pyrycode/pyrycode-desktop/issues/973): `daemonConnection.ts`'s
`case 'model-list':` emits the `modelList` arm of `DaemonEvent`, a fresh named-field literal with the
rows reused verbatim (see [Daemon event channel — the sealed
union](daemon-event-channel-sealed-union.md)), consumed as a permanent no-op by all four exhaustive
renderer bridges. [#974](https://github.com/pyrycode/pyrycode-desktop/issues/974) added the
per-conversation store and its dedicated fifth-observer bridge — see [Model-list
store](model-list-store.md). [#975](https://github.com/pyrycode/pyrycode-desktop/issues/975) is the
first render consumer: it deleted `MODEL_CATALOG`/`matchedFamily` from `RunConfigSections.tsx` and
built the Model section's rows straight off the held entry — see [Conversation shell — workspace and
run configuration § Run configuration Model section, daemon-published
rows](conversation-shell-run-configuration.md#run-configuration-model-section-daemon-published-rows-975).
[#976](https://github.com/pyrycode/pyrycode-desktop/issues/976) is the second: it deleted
`EFFORT_LEVELS` and built the Effort section's segments off the same held entry, joined by the same
`value`-equality helper (renamed `publishedRowFor`) — see [§ Run configuration Effort section,
daemon-published levels](conversation-shell-run-configuration.md#run-configuration-effort-section-daemon-published-levels-976).
The input footer's [model and effort menus](composer-model-menu.md) (#683) and the
[permission-mode menu](composer-permission-mode-menu.md) (#682, its `auto`-hiding join at #1022)
followed the same pattern.

## Edge cases and limitations

- `Envelope.type` is `EnvelopeType | string` (open) and no exhaustive switch exists over it today, so
  this widening is non-breaking. The `EnvelopeType` membership test in `types.test.ts` is what would
  otherwise miss a dropped member — without it, a decode/re-encode round-trip passes silently on an
  unknown string.
- **RED for this type-only slice was `tsc`, not vitest.** esbuild strips type annotations without
  checking them, so `npm test` passed trivially before the types existed. The honest red was the
  typecheck, surfaced counter-intuitively as `@ts-expect-error` directives reported *unused* — the
  missing type resolved to `any`, so the invalid literal made no error to consume.
- `docs/protocol-mobile.md` § `model_list` is stale on the delivery window (see above) and is the
  daemon repo's to correct, not this one's — do not re-derive future desktop work from its live prose.

## Testing strategy

Type-level shapes in `src/shared/wire/types.test.ts`, a `model-list wire vocabulary (#971)` block
appended after the `#935` block. Values are transcribed **verbatim** from the three committed upstream
fixtures (`internal/protocol/testdata/model_list{,_empty,_zero}.json`), each with a comment naming its
source path — no departures, unlike the `#935` block, since nothing here needed abridging.

Covered: `EnvelopeType` membership (compile-time assignment); `WireModelOption`'s six keys via the
`default` row, including the literal `<unmeasured>` (angle brackets and all); the populated payload
(`model_list.json`, five rows, `dropped_models: 2`) with `models.length + dropped_models === 7`
asserted as a value, the two bracketed `value`s carried verbatim, the one row reporting
`truncated_fields: ['value']` beside four reporting `null`, and Haiku's row as the all-real-value case
(`resolved_model` populated, `effort_levels: []`, `supports_auto_mode: false`); the fixture/invariant
mismatch pinned as a comment rather than silently trusted; the empty frame (`models: []`,
`dropped_models: 0`, summing to `0`); the zero-value row (the only route reaching all six
`WireModelOption` keys at once); and a `@ts-expect-error` block, one directive per omitted key across
both interfaces (six + three).

Not tested: any entry-count or per-field byte bound, since nothing enforces one; any decode, narrowing,
store or render, which this slice does not add.

Gate: `npm test -- src/shared/wire/types.test.ts` and `npm run build`. `npm run typecheck`
short-circuits on a node-side failure and hides every renderer error, so on a red run
`npx tsc --noEmit -p tsconfig.web.json` runs separately before any error count is read as the blast
radius.

## Related

- [Daemon connection — methods](daemon-connection-methods.md) — the `requestModelList(conversationId)`
  connection method (#1165) that sends the outbound ask above, and its `requestSessionSettings` twin
  the required-vs-optional id divergence is stated against.
- [Command channel](command-channel.md) — the `requestModelList` `RendererCommand` member + boundary
  guard (#1165) this ask's frame rides in from the renderer, and the untrusted-payload check that
  refuses a missing, `undefined`, or non-string `conversation_id`.
- [Slash-command-list wire types](slash-command-list-wire-types.md) — the sibling frame from the same
  `initialize` reply, and the nearest local precedent this slice followed (`Wire` prefix,
  required-fields posture, nullable-not-optional `truncated_fields`, the trust-tier paragraph shape).
  That doc's own text (`model_list stays unmodelled on this side`) is now corrected to point here.
- [Question-shown wire types](question-shown-wire-types.md) — `QuestionShownPayload`'s security
  paragraph anchors "at `model_list`'s trust tier" by name; this doc is where that tier is declared.
- [Background-task roster store](background-task-roster-store.md) — the closer **structural**
  precedent for the snapshot shape (`conversation_id` + never-null array + dropped count, per-row
  `truncated_fields: string[] | null`) than `slash_command_list` itself.
- [Model-list store](model-list-store.md) — [#974](https://github.com/pyrycode/pyrycode-desktop/issues/974)'s
  per-conversation holder for this frame, the local consumer of the `modelList` arm below.
- [Wire codec](wire-codec.md) — `Envelope.payload` stays an opaque carrier (`unknown`) through the
  codec; this slice adds no decoder, consistent with that boundary.
- [Inbound message decode](inbound-message-decode.md) / [Extension
  history](inbound-message-decode-history.md) — [#972](https://github.com/pyrycode/pyrycode-desktop/issues/972)
  is the decoder: `parseModelListPayload` + `parseModelOption`, the fail-closed narrowing this type's
  required-fields posture exists to make possible.
- [Daemon event channel — the sealed union](daemon-event-channel-sealed-union.md) —
  [#973](https://github.com/pyrycode/pyrycode-desktop/issues/973) carries the decoded value the rest of
  the way across IPC as the `modelList` arm of `DaemonEvent`, consumed as a permanent no-op by all four
  exhaustive renderer bridges; ships dormant, awaiting the store slice.
- [ADR 0002 — Remote head over relay, shared wire](../decisions/0002-remote-head-over-relay-shared-wire.md)
  — "do not drift the wire types from the mobile contract without a matching daemon change"; this
  slice mirrors a settled upstream contract and makes no desktop-side architectural choice of its own.
- `docs/specs/architecture/971-model-list-wire-types.md` — the full architecture spec, including the
  adversarial security review (verdict: PASS) and the `## Revisions` entry recording the delivery-window
  correction.
- Daemon twin (QMD `pyrycode-docs`): `docs/protocol-mobile.md` § `model_list` — SSOT for the field
  tables, but **stale on delivery timing**; see [§ Delivery window](#delivery-window-two-lanes).
