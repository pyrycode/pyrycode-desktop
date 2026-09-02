# #976 — Offer only the effort levels the selected model supports

## Files read

- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `EFFORT_LEVELS`, `EffortSection`,
  `ModelSection`, `runningPublishedRow`, `RunConfigView`, `RUN_CONFIG_MODELS_EMPTY_COPY`,
  `RUN_CONFIG_CUT_COPY` — the constant this slice deletes, the section it rewrites, and the Model
  section directly above it that is the working template for the rewrite.
- `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` → `modelRow`, `PUBLISHED_ROWS`,
  `segmentFor`, `tagWithClass`, `closedBefore` — the fixture builder whose `effort_levels: []` default
  makes every currently-published row offer nothing, and the three markup helpers every new assertion
  reuses.
- `src/renderer/src/store/modelListStore.ts` → `ModelListEntry`, `selectModelListFor` — the read
  surface, and the header clause that assigns this slice the obligation to read a `truncated_fields`
  naming `effort_levels` as UNKNOWN rather than as *none*.
- `src/shared/wire/types.ts` → `WireModelOption`, `ModelListPayload` — the per-field contract:
  `effort_levels` is a COLLAPSE of absent/null/empty, a cut one is unknowable from the field alone, the
  direction hazard is upstream's, and the trust tier is claude-authored. Also the one stale status
  paragraph on `ModelListPayload` this slice corrects.
- `e2e/run-config-settings.spec.ts` → `MODEL_ROWS`, `BASELINE_RUN_CONFIG`, `effortSegment`,
  `modelListFrame`, and the header's STANDING RULE plus #975's record of why the `daemon` handle is now
  bound — all three fixture rows carry `effort_levels: []`, so the shipped effort round-trip loses the
  segments it clicks.
- `src/renderer/src/screens/conversation/conversation.css` → `.run-config__effort`,
  `.run-config__effort-segment`, `.run-config__model-unknown` / `-empty` / `-cut` — the geometry this
  slice keeps and the muted body-small group its new lines join.
- `docs/knowledge/features/model-list-store.md`, `docs/knowledge/features/model-list-wire-types.md` —
  the store's three-positions-on-empty rule and the per-field prose behind it.
- `docs/specs/architecture/975-model-rows-from-published-list.md` — the sibling plan whose shape,
  security posture and key decision this one reuses rather than re-derives.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-130

A single left-aligned row of pill segments, 8px apart inside 16px horizontal / 4px vertical padding:
each is a 1px `outline` border, 8px radius, transparent, `on-surface-variant` label-large text, and the
selected one drops its border for a `secondary-container` fill with `on-secondary-container` text.
Every one of those is already shipped in `conversation.css` and this slice changes none of it. Per the
operator instruction of 2026-08-22 the drawn segment COUNT and LABELS are illustrative only — the
entries become daemon data, which is the ticket.

## Context

`EffortSection` renders from `EFFORT_LEVELS`, a hardcoded five-value constant, for every model.
Reasoning-effort support is per model: measured live against claude 2.1.220 on 2026-08-21, Haiku
publishes no levels at all while the other rows publish all five. Selecting Haiku today leaves five
segments on screen that it cannot use, and pressing one asks the daemon for something it will not do.

The daemon publishes the supported levels on the same rows the model menu is built from
(`WireModelOption.effort_levels`). #975 replaced the hardcoded model catalog with those rows; this
slice does the same for the segments beneath them, and deletes the last hardcoded vocabulary in the
sheet.

No ADR is warranted: this spends decisions already recorded in `model-list-wire-types.md` and
`model-list-store.md`.

## Design

### One join rule, two callers

The row this section follows is resolved from the SESSION's model by exact equality on `value` — the
same string the Model section marks a row selected by, and no second matching rule. That lookup already
exists as `runningPublishedRow`; it is RENAMED to `publishedRowFor(models, value)` and called from both
places, so the join rule has exactly one home and no way to drift into a substring match in one of two
copies. The two callers join DIFFERENT strings through the SAME rule — `RunningModelSection` joins
`announced.model`, this section joins the composed effective `model` — and the docblock says so, because
conflating the two inputs is the mistake the rename makes easy to see and easy to make.

`value` is not parseable (`default`, `opus[1m]`, `sonnet`, `haiku`), so nothing derives a family and
nothing is normalised on either side.

### Four inputs, three renderings

| matched row | `effort_levels` | cut reported for `effort_levels` | renders |
|---|---|---|---|
| none (no list yet, or the model matches no row) | — | — | **AC3** — no segments; the session's current effort value as text |
| yes | non-empty | either | **AC1** — one segment per level, published order |
| yes | `[]` | no | **AC2** — a client-owned line saying the model offers none |
| yes | `[]` | yes | **AC3's rendering** — the list is UNKNOWN, not *none* |

**AC3's collapse is deliberate and is the OPPOSITE posture to the Model section above it.** That
section keeps `null` ("no frame has arrived") and `[]` ("claude published an empty list") in different
elements with different copy, because it is arguing about a different field. Here no-list-yet and
no-matching-row are one rendering, because the client's behaviour is identical for both: it has been
told no level is accepted, so it offers none. The section still has three distinct outcomes.

**The fourth input row is a written contract MUST, not an invented distinction.** `WireModelOption`'s
docblock states that a `truncated_fields` naming `effort_levels` is the ONLY signal separating "cut to
nothing, or shortened" from "this model exposes no effort control", and that it must be read as
UNKNOWN, never as *none* — read as *none*, a cut list silently removes a control the model actually
supports. `modelListStore`'s header names this slice as the reader that owes that. It costs one term in
one condition; the reading it lands in already exists.

**No fallback, ever.** An absent, `null` or unmatched `models` must never mean "offer all five". That
is the single failure AC3 exists to forbid, it would re-mint the vocabulary this ticket deletes, and it
would keep every currently-red test green. The test fixtures gain real levels; the production default
gains nothing.

### The cut marker

Whenever the matched row reports `effort_levels` cut, the section renders the module's existing
`RUN_CONFIG_CUT_COPY` in its own SIBLING element inside the control wrapper — in every reading, so a
shortened non-empty list is not presented as complete either, and an empty-because-cut one says why it
is offering nothing. It reuses the shipped constant; no new cut vocabulary is minted, and the copy is
never concatenated into a daemon-authored node.

`truncated_fields` is exempt from normalisation, so `null` and `[]` say the identical thing and the
test is `?.includes('effort_levels') ?? false` against a client-owned literal — a linear scan by `===`,
not an index lookup, so nothing here builds a lookup path out of daemon text. The report is read
PER FIELD: a `truncated_fields` naming only `display_name` leaves an empty `effort_levels` meaning
*none*.

### Markup

```
<p class="status-sheet__section-header">Effort</p>
<div class="run-config__effort" aria-busy?>          ← in ALL THREE readings
  [segments | offers-none line | current-effort line]
  [cut marker]                                        ← sibling of the branch, when cut
</div>
[<p class="run-config__error" role="alert">]          ← SIBLING of the busy wrapper, unchanged
```

The `aria-busy` placement rule the section already documents holds in the no-segments readings too: an
effort change can still be in flight when the section has nothing to offer (the operator picks a level,
then a `model_list` frame or a model change empties the levels), so the wrapper always renders and
always carries the marker. The error line stays a SIBLING — an `aria-busy` ancestor would instruct
assistive technology to withhold the rejection on the very field the operator was told is in flight.
The Model section's `.run-config__model-list` is the precedent for both halves: the marker in all
readings, the unknown/empty copy inside, the alert outside.

New classes: `.run-config__effort-current` (AC3's value line), `.run-config__effort-empty` (AC2's
copy), `.run-config__effort-cut`. All three join the shipped muted body-small group beside
`.run-config__model-unknown`; none is an error state, so none takes `--color-error`.

AC3's line carries the effort VALUE ALONE with no client-owned prefix — concatenating client copy and
daemon-sourced text into one node is what the module's cut-marker rationale forbids, and claude's own
control displays these values lowercase and byte-identical, so there is no display convention to add.
An empty effort renders a present, empty line, inventing no distinction the snapshot does not carry
(the `.run-config__model-descriptor` precedent).

### Selection, keys and the round trip

A segment is marked by exact equality against the session's effort value — no substring, prefix, case
fold or trim anywhere on the path. `high` is a substring of `xhigh`, so that pair is the guard which
fails if a substring matcher is ever introduced. Pressing a segment submits the published level
VERBATIM, so the optimistic overlay holds the same string the next render compares against, and the
existing pending / rejection / rollback behaviour of the effort field is untouched.

THE KEY IS THE ARRAY INDEX, for #975's reason unchanged: a key is a lookup path, and these are exactly
the claude-authored strings the store's header forbids using as one. There is no cross-frame identity
to preserve — each frame replaces the conversation's list wholesale — and claude may legitimately
publish a repeated level.

`EFFORT_LEVELS` is deleted, and the group comment claiming "the field's five controls" is corrected
with it.

### The one stale wire paragraph

`ModelListPayload`'s docblock still reads "**Wire vocabulary only.** Nothing decodes, narrows, stores
or renders this yet" and names `MODEL_CATALOG` and `EFFORT_LEVELS` as the sheet's guesses.
`MODEL_CATALOG` went with #975 and `EFFORT_LEVELS` goes here, so every clause of that paragraph becomes
false. It is rewritten to say the frame is decoded, held and rendered. **The rest of that docblock is
left alone** — the `models` empty-array argument, the three-positions-on-empty note, the
`dropped_models` paragraph and the producer-cap paragraph are contract statements rather than status
prose, and several anchor neighbouring frames by name.

## State + concurrency model

Nothing new. The section is a pure function of props it already receives (`models`, `model`, `effort`,
`onSelect`, `error`, `busy`); the container's `modelListStore` subscription, its `useMemo`-stable keyed
selector and the `conversationId` prop all landed in #975 and are untouched. No store is added, no
effect, no async work, no timer, no listener — so there is nothing to cancel and no teardown path to
define. No setter is called during render, and the section dispatches only through the existing
`changeSetting` submit.

## Error handling

No new failure mode. The store cannot hand back a malformed entry (#972's fail-closed narrower rejects
a bad frame before any event is emitted), and every reading above is a reading rather than an error
state — none renders in an error colour.

The one live failure is upstream's DIRECTION HAZARD and it is handled by the surface that already
exists: the daemon's inbound `validEffort` is a closed enum at the five measured levels while
`validModel` was widened for these rows, so a sixth level claude adds in future — or a level string cut
mid-token — is published and then REFUSED on the way back. The client submits it verbatim regardless,
never repairing and never allow-listing (a client-side allowlist would put a second copy of the
vocabulary in the very place this ticket deletes one from), and the refusal surfaces through the
shipped `RunConfigError` line with the store's automatic rollback. Nothing on this path is logged.

## Testing strategy

**vitest, `RunConfigSections.test.tsx`** (static server render — the section's markup is a pure
function of its props, so all three readings are unit-testable):

- the segments are exactly the matched row's levels, in published order, and the COUNT equals the
  published count — stated as a count, never as a list of the five deleted literals, so this file keeps
  no effort vocabulary of its own
- a fixture publishing levels that are NOT the measured five proves the vocabulary is the daemon's
- the segments follow the SELECTED model: two rows publishing different sets, rendered against each
  `value` in turn
- exact-equality selection: the matching level marked, exactly one marker; nothing marked for `''` or
  for a level the row does not publish; `effort="xhigh"` marks no `high` segment (the substring guard)
- AC3, both ways in: no `models` prop, and a `models` matching no row — no segments, the current effort
  as text, and specifically not the offers-none copy
- AC2: a matched row with `effort_levels: []` and `truncated_fields: null` — the offers-none copy, no
  segments, no current-effort line
- the cut readings: `[]` + `truncated_fields: ['effort_levels']` renders AC3's line and NOT the
  offers-none copy; a non-empty cut list still renders its segments; both show the cut marker; a
  `truncated_fields` naming only another field leaves the offers-none reading intact
- hostile level text renders as inert escaped text — attribute-shaped guards (`<img`, `src="`, `href="`,
  `/\son[a-z]+="/`), never `not.toContain('onerror=')`, which passes vacuously — and the segment's
  opening tag carries no daemon string at all (the key/attribute guard)
- `aria-busy` on the group in ALL THREE readings, never on a segment, with the rejection line still a
  sibling (`closedBefore`); operability still keys off handler presence

The cascade the ticket named, plus two it did not: `it('always renders all five level labels')` is
DELETED as a statement of the removed contract; the `aria-current` cases, the `#558` pending cases and
the container's `>low<` assertion gain fixtures that publish levels or move to AC3's reading; and
`it('leaves a marked control fully operable')` plus `it('alters no existing accessible name…')` go red
too — the first draws its only `role="button"` from the effort segments, the second its only
`aria-current` from them. `PUBLISHED_ROWS` gains an honest per-row level set (the five on one row, a
shorter distinct set on another, `[]` on the Haiku-shaped row) so one fixture serves all three
readings.

**Playwright, `e2e/run-config-settings.spec.ts`** — the transition a static render cannot make. Before
the `model_list` frame arrives: no segments and the current-effort line reading the baseline value.
After it: the segments are exactly the baseline row's published levels, exact and ordered. After the
model click: they become the newly selected row's DIFFERENT set — the model→effort dependency, which is
the whole ticket, proven end to end. The existing effort click, captured-frame and `aria-current`
assertions then survive unchanged. No new frame is pushed and the standing rule is untouched: the
fixture rows simply gain the `effort_levels` they always should have carried. AC2's offers-none reading
is left to the unit tests — the only row publishing none is the REJECTED one, so it is never the
settled model and any e2e assertion on it would race the optimistic window.

Fakes over mocks; no new dependency.

## Open questions

- **A row that publishes a repeated level.** Two identical segments would render, both marked when
  selected. The wire permits it, nothing has observed it, and de-duplicating would mean editing the
  published list — so the uniform rule is applied. To be restated as a code comment if it survives.
- **Whether the cut marker should also appear when a level string itself was cut but the list was
  not shortened.** The wire reports both under the same field name, so it does; that is the honest
  reading and no attempt is made to tell the two apart.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary; this slice IS one. Every string in `effort_levels` is
  claude-authored text that crossed the subprocess trust boundary — a HIGHER tier than the
  workspace-authored slash-command strings — bounded by the daemon and NOT sanitized by it. #972 made
  the SHAPE trusted and nothing more. Each level reaches exactly one JSX text position where React
  escapes it, and the view derives nothing from the held entry, so the boundary stays a single place.
- **[Trust boundaries — the named finding, and the one that is genuinely new]** This slice changes what
  the client SENDS: `set_session_settings.effort` stops carrying a client-owned constant and starts
  carrying a claude-authored string echoed back verbatim. That is the Model section's shipped posture
  applied to a second field, and it is deliberate — the ticket forbids a client-side allowlist, because
  it would re-mint the vocabulary being deleted. It is safe because the value is an argument the daemon
  validates against its own closed `validEffort` enum, never a path, a command or a shell word, and
  because the client never REPAIRS a cut level (repairing would mean parsing). The refusal path is the
  shipped rejection line plus the store's rollback. Unlike `value` on the model row, a cut level does
  NOT silently run something else: `validEffort` is a membership check, not a charset rule, so a cut
  level is refused rather than accepted as a different one.
- **[Injection sinks — the category that actually bites here]** Enumerated rather than waved past. No
  `dangerouslySetInnerHTML`, no `innerHTML`. No level string reaches an attribute (not `title`, not
  `aria-label`, not `data-*`), a URL, an `href`/`src`, a filename, a cache key, a lookup path or a
  `key`. THE KEY IS THE ARRAY INDEX and that is a security decision, not a style one. The one place a
  daemon string meets a comparison is `truncated_fields.includes('effort_levels')` — a linear scan by
  `===` against a client-owned literal, with no object indexed by daemon text anywhere, so the
  `__proto__`-writes-through hazard has no site to occur in.
- **[Injection sinks]** The offers-none copy and the cut marker are client-owned constants in their own
  SIBLING elements, never concatenated into a daemon-authored node — so a level named "Truncated by the
  daemon" cannot forge the sheet's own claim. Asserted structurally, because `not.toContain(CUT)` would
  fail on a correct render of that hostile string. AC3's line is the sole exception in reverse: it
  holds daemon-sourced text with NO client copy beside it in the same node, which is the same rule from
  the other side.
- **[Tokens/secrets]** N/A by construction — nothing on this path touches a token, key or credential,
  and the submit reuses the shipped `changeSetting` path unchanged.
- **[File/storage]** N/A — nothing here reads or writes disk or web storage, and nothing may: a
  persisted copy of a published list would outlive the pairing that scoped it and survive #977's clear
  with every in-memory assertion still green.
- **[Electron attack surface]** No new IPC channel, no preload surface, no `contextBridge` change, no
  navigation or window-open change. Process placement is unchanged — no crypto, socket, key or raw byte
  enters the window; the renderer gains no new read at all, only a new use of state #975 already reads.
- **[Cryptographic primitives]** N/A — no RNG, no comparison against a secret. The exact-equality
  comparisons here are on non-secret display and routing strings, so `===` is correct and
  `timingSafeEqual` would be cargo cult.
- **[Network & I/O]** No finding. No new frame is sent or parsed; the outbound payload shape is
  unchanged and its one field's PROVENANCE is the named finding above. Inbound size is already bounded
  by `MAX_PLAINTEXT_BYTES` in `parseInboundMessage`, ahead of `decodeEnvelope` and every narrower, and
  no client-side cap is added — a second place the limit is decided could disagree with the first.
- **[Logs/telemetry]** No finding, by explicit decision: nothing on this path is logged and no
  diagnostic is added — not a "no row matched" line, not a "cut levels" line. That inherits the store's
  rule, whose footing is the CONTRACT (the daemon bounds and does not sanitize, so a control byte is
  PERMITTED rather than excluded) and NOT the sibling frame's measured `0x0a`, which is a claim about
  workspace-authored text and does not transfer here.
- **[Concurrency]** No finding. The slice adds no subscription, no async work, no timer, no listener
  and no promise, so there is nothing to cancel and no check-then-act window. `busy` and the displayed
  value are still derived from the same `writeState` reference in the same render pass, so they cannot
  disagree.
- **[Threat model — hostile daemon / prompt-injected model output]** The realistic actor is text claude
  was induced to emit. It can: make a segment read as anything (rendered escaped and inert); publish a
  level the daemon will then refuse (surfaced as a rejection, which is the honest outcome); claim a cut
  that did not happen, or omit one that did — the flag is the daemon's report and the client states it
  as such rather than verifying it; or publish an empty list (a distinguishable reading, not an empty
  control). It CANNOT make the sheet offer a level for a model that published none, which is the
  ticket, nor forge a client-owned sentence, nor reach any non-text position.
- **[Threat model — a cut list read as *none*]** Named because it is the one this slice would ship if
  the fourth input row were dropped: a `truncated_fields` naming `effort_levels` beside an empty list
  read as *none* silently removes an effort control the model actually supports, and the operator has
  no way to tell. Addressed in the design; asserted directly.
- **[Threat model — DoS via list size]** Out of scope and bounded upstream as above. Unbounded per-level
  STRING length is handled visually (`overflow-wrap` plus a wrapping row) rather than by truncation,
  because truncating would violate the verbatim contract and re-introduce the ambiguity the cut marker
  exists to remove.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-03

## Size

Within every line of the size-S table. Two production source files (`RunConfigSections.tsx` for the
rewrite, `src/shared/wire/types.ts` for the one stale paragraph) plus one stylesheet, against a ceiling
of 5; ~560 lines of total written work against 800; no new exported type, component or store; one
consumer call site for the section; 4 acceptance criteria; 3 renderings and no state machine.
