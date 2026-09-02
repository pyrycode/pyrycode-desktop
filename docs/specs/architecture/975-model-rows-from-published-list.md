# #975 — Build the run-configuration Model rows from the daemon-published list

## Files read

- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `MODEL_CATALOG`, `ModelCatalogEntry`,
  `matchedFamily`, `runningCatalogEntry`, `ModelSection`, `RunningModelSection`, `RunConfigView`,
  `RunConfigSections` — the whole surface this slice rewrites.
- `src/renderer/src/screens/conversation/RunConfigSections.test.tsx` → `segmentFor`, `tagWithClass`,
  `closedBefore` — the three markup helpers every new assertion reuses; and the 31 catalog-label
  assertions that cascade.
- `src/renderer/src/store/modelListStore.ts` → `ModelListEntry`, `selectModelListFor`,
  `useModelListStore`, `createModelListStore` — the read surface, its `null` vs `models: []`
  distinction, and the three-separate-exports rule that makes the renderer mock possible.
- `src/shared/wire/types.ts` → `WireModelOption`, `ModelListPayload`, `ModelAnnouncedPayload` — the row
  contract: `value` is not parseable, `resolved_model` is what it resolves to now, `truncated_fields`
  is per-row, `dropped_models` is the frame-level report, and the claude-authored trust tier.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanelView`,
  `partialListCopy`, `BACKGROUND_TASK_PANEL_CUT_COPY`, `BACKGROUND_TASK_PANEL_UNOBSERVED_COPY`,
  `BACKGROUND_TASK_PANEL_EMPTY_COPY` — the settled house treatment of exactly this pair of daemon
  truncation reports beside exactly this pair of non-populated readings. This slice copies its shape:
  the partial notice is a SIBLING of the branch, and `> 0` never truthiness.
- `src/renderer/src/screens/conversation/ComposerSlashCommandTypeAhead.tsx` →
  `useSlashCommandTypeAhead` — the `useMemo`-stable keyed-selector idiom with the `null`-id
  short-circuit, verbatim.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `<RunConfigSections />` mount
  inside the `sheetOpen` block, beside `ComposerSlot` and `BackgroundTaskPanel`, which already read
  `activeConversation?.id ?? null`.
- `src/renderer/src/screens/conversation/conversation.css` → `.run-config__model-list`,
  `.run-config__model-row`, `.run-config__radio`, `.run-config__model-name`,
  `.run-config__model-descriptor`, `.run-config__running-value`,
  `.background-task-panel__partial` — the geometry this slice keeps and the overflow-wrap pairing it
  now needs.
- `e2e/run-config-settings.spec.ts` → `OPUS_ROW` / `SONNET_ROW` / `HAIKU_ROW`, `capturingRunConfigFake`,
  and the header's STANDING RULE about not binding the `daemon` handle.
- `e2e/slash-command-type-ahead.spec.ts` → `slashCommandListFrame`, the `daemon.pushFrame` template for
  the twin unsolicited frame.
- `docs/knowledge/features/model-list-store.md` § Edge cases — the store's own statement that #975 owes
  the render boundary's sanitization and a `key` scheme that is not `display_name`.
- `docs/knowledge/features/model-list-wire-types.md` § the per-field prose — the cut-`value` hazard and
  the trust-tier footing.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=20-111

A left-aligned column of radio rows: a 20px ring (2px `on-surface-variant`, filled `primary` with a
10px inner dot when selected) beside a two-line text column — the name in body-large `on-surface` over
a descriptor in body-small `on-surface-variant`, 2px apart — with 12px between radio and text, 4px
between rows and 16px of horizontal padding. Every one of those is already shipped in
`conversation.css` and this slice changes none of it. The drawn row COUNT, row LABELS and descriptor
TEXT stop being the design's to specify: they become daemon data, which is the ticket.

## Context

`RunConfigSections.tsx` builds its Model section from `MODEL_CATALOG` — four hardcoded rows naming a
generation-old model set, matched against the daemon's `model` string by a case-insensitive substring
matcher, `matchedFamily`. The list cannot grow without a release, every version number is stale, and
picking a row submits a bare family alias whose current resolution the operator never sees.

The four slices above this one (#971 wire types → #972 decode → #973 event arm → #974 store) landed the
daemon's published list into `modelListStore`, keyed per conversation. This slice is the consumer that
deletes the guess: the rows become the published entries, one per entry, in the daemon's order, with
nothing derived and nothing parsed.

No ADR is warranted — this slice takes a decision already recorded in `model-list-wire-types.md` and
`model-list-store.md` and spends it.

## Design

### The Model section reads three states, not two

`selectModelListFor` deliberately hands back `null` for "no frame has arrived" and a present entry
holding `models: []` for "claude published an empty list". The section renders three branches and
collapses none:

| store reading | section renders |
|---|---|
| `null` (or no conversation id) | one line, the not-yet-known copy |
| entry, `models: []` | one line, a positive statement that claude offered nothing |
| entry, rows | one row per entry, published order |

Neither non-populated branch renders an empty control or a stale menu, and neither is an error state or
wears an error colour — `BackgroundTaskPanelView`'s settled treatment of the identical pair.

### `RunConfigView` gains one optional prop

```ts
models?: ModelListEntry | null   // #974's held entry, verbatim — never a derived array
```

Optional, and its absence IS the `null` reading — the `announced` prop's shape, and what keeps the pure
view server-renderable with no store and no mock. Nothing wraps, copies or maps the entry: the view
reads `entry.models` and `entry.droppedModels` directly, which is what keeps the store's
by-reference/by-construction guarantees intact at the render boundary.

### The container takes the conversation id as a prop

`RunConfigSections` today reads `sessionIdStore`. A session id is a DIFFERENT identifier from a
conversation id — it keys nothing in the model-list map, so reaching for the one already in scope would
compile clean, typecheck clean and render the not-yet-known line forever. The settled house idiom is a
prop off `activeConversation`, exactly as `ComposerSlot` and `BackgroundTaskPanel` take it:

```ts
export function RunConfigSections({ conversationId }: { conversationId: string | null }): JSX.Element
```

with the `useMemo`-stable keyed selector and the `null` short-circuit copied from
`useSlashCommandTypeAhead`: a fresh selector per render would re-subscribe on every store tick, and a
`null` id selects nothing through the SAME path rather than through an invented key.
`ConversationScreen` passes `conversationId={activeConversation?.id ?? null}` at the existing mount.

### Selection is exact equality on `value`, and it round-trips

`matchedFamily` and `ModelCatalogEntry` are deleted outright. The selected row is the one whose `value`
is `===` the composed effective model — no `toLowerCase`, no `includes`, no `startsWith`, no `trim`, no
regex, nowhere on the path. Picking a row submits that row's `value` VERBATIM, so the optimistic
overlay holds the same string the next render compares against and the same row re-selects. That
round-trip is the whole reason no derivation may creep in: the moment either side normalises, the two
stop being the same string.

`value` is not parseable and there is no family to derive (`default`, `opus[1m]`,
`claude-fable-5[1m]`, `sonnet`, `haiku`). Nothing splits it.

### The React key is the array index

The obligation `modelListStore`'s header assigns this slice. `display_name` and `value` are both
claude-authored and neither may be a key — a key is a lookup path. There is also no cross-frame
identity to preserve: each frame REPLACES the conversation's list wholesale, rows never reorder within
a render, and claude may legitimately publish two rows sharing a `value`. The index is the honest key
for a wholesale-replaced positional list; `entry.family` disappears with the catalog.

### Both truncation reports reach the operator, separately

- **Per row** — `truncated_fields` non-empty ⇒ the row shows the sheet's existing cut copy in its own
  SIBLING element inside the row's text column, never text concatenated into a daemon-authored node.
  `null` and `[]` say the identical thing per the wire, so the test is on length.
- **Per frame** — `droppedModels > 0` ⇒ a partial-list notice above the branch, carrying the count.
  It is a SIBLING of the three-way branch, not a child of any arm: the count belongs to the ENTRY, so
  an entry reporting drops beside zero carried rows must still show it. `> 0`, never
  `{entry.droppedModels && …}` — React renders `0` as a text node.

The module's existing `RUN_CONFIG_RUNNING_CUT_COPY` is renamed to `RUN_CONFIG_CUT_COPY` and reused by
both surfaces; no new cut vocabulary is minted. The partial notice reuses `partialListCopy`'s shipped
shape, which also dodges pluralisation.

### The running-model lookup moves onto the published rows

`runningCatalogEntry` reads `MODEL_CATALOG` and goes with it. Its replacement resolves an announced
identifier against the published rows by EXACT EQUALITY on `resolved_model`, rendering that row's
`display_name` on a hit and the announced identifier verbatim on a miss.

`resolved_model` rather than `value` is the join key because `resolved_model` is *the concrete
identifier this row resolves to right now* and an announcement is *the concrete identifier claude
resolved for the turn* — the same kind of thing, which is what makes it a real join rather than the
permanently-dormant one it replaces. It is internally consistent within this one file too: the row that
tells the operator it resolves to X is the row named when claude announces X. `value` cannot serve —
claude echoes an identifier at least as specific as the one it was given, so a bare alias is never
announced and a `value` join would never fire. A miss stays ORDINARY, not an error: an announced
identifier need not appear in any published row, and the verbatim fallback is the correct outcome.

The exactness guard survives the rewrite re-anchored: an announced identifier that is a SUPERSTRING of
a published `value` must not resolve to that row's display name. That is the assertion that fails if
anyone reintroduces substring matching, and it is field-agnostic — it holds against any of the row's
strings.

One provenance claim in that surface stops being true and is rewritten rather than left standing: the
comment says the hit path renders a client-owned display name while the miss path renders the daemon's
identifier, and that "the two provenances never mix in one node". Once rows come from the daemon, BOTH
paths are daemon-authored. The text stays safe to render as escaped inert text; the comment is what was
wrong.

### Markup, unchanged in shape

```
<p class="status-sheet__section-header">Model</p>
[partial-list notice]                       ← sibling, when droppedModels > 0
<div class="run-config__model-list" aria-busy?>
  [unknown line | empty line | rows]
</div>
[<p class="run-config__error" role="alert">] ← sibling of the busy wrapper, unchanged
```

Each row keeps `.run-config__model-row`, the radio pair with `aria-label="Current model"` on the
selected one, and `.run-config__model-text` holding `.run-config__model-name` (`display_name`) over
`.run-config__model-descriptor` (`resolved_model`), plus the optional cut marker. Operability still
keys off handler presence.

CSS adds `.run-config__model-unknown`, `.run-config__model-empty`, `.run-config__model-partial` and
`.run-config__model-cut` on the shipped muted body-small token set (none is an error state, so none
takes `--color-error`), and pairs `overflow-wrap: anywhere` onto `.run-config__model-name` and
`.run-config__model-descriptor` — the `.run-config__running-value` rationale, now that both lines carry
unbounded daemon text instead of short static labels.

## State + concurrency model

Read-only, one new narrow-slice subscription. The container reads `modelListStore` through a
`useMemo`-stable selector bound to the conversation id; the selector returns the HELD ENTRY ITSELF, so
a write for a different conversation leaves this entry `Object.is`-identical and does not re-render the
sheet. No async work, no effect, no timer, no cancellation path — there is nothing here to tear down.
The store's write path is untouched; this slice adds no dispatch beyond the existing
`changeSetting` submit, and no setter is called during render.

The sheet mounts only while open, so the subscription's lifetime is the sheet's.

## Error handling

There is no failure mode to classify: the store cannot hand back a malformed entry (#972's fail-closed
narrower rejects a bad frame before any event is emitted), and absence is a normal reading rather than
an error. The three branches above are readings, not error states. The existing rejection surface
(`RunConfigError`, `role="alert"`) is unchanged and stays a SIBLING of the `aria-busy` wrapper — an
`aria-busy` ancestor would instruct assistive technology to withhold the announcement on the very field
the operator was told is in flight.

Nothing on this path is logged, and no diagnostic is added — the store's standing rule, and the reason
its own setters are silent.

## Testing strategy

**vitest, `RunConfigSections.test.tsx`** — the pure view carries almost all of it, server-rendered:

- one row per published entry, in published order, labelled with `display_name`
- exact-equality selection: the matching row marked, exactly one marker; no match for a case-folded,
  padded, prefixed or superstring model; the empty model marks nothing
- round-trip: rendering with a row's own `value` marks that row (the submit-then-reselect proof the
  `node` environment cannot get from a click)
- the second line carries `resolved_model` verbatim and escaped
- the three readings kept apart: `null`/omitted ⇒ not-yet-known and no rows; `models: []` ⇒ the
  offered-nothing line and no rows; neither renders an empty control
- per-row cut marker present on a non-empty `truncated_fields`, absent on `null` and `[]`, a sibling
  element, and unforgeable by a `display_name` ending in the same words
- frame-level partial notice at `droppedModels > 0`, absent at `0` (and no bare `0` in the markup),
  present on the empty branch too
- hostile row text renders as inert escaped text — attribute-shaped guards only (`<img`, `src="`,
  `href="`, `/\son[a-z]+="/`), never `not.toContain('onerror=')`, which passes vacuously
- operability and `aria-busy` placement unchanged, error line still a sibling
- the running-model surface: resolves via exact `resolved_model` equality, misses on a superstring of a
  published `value`, renders verbatim on a miss

**vitest, the container** — one test with `vi.mock` on `modelListStore` overriding ONLY the
`useModelListStore` binding onto a per-file `createModelListStore(seededState)` instance and keeping
`...importActual` for the selectors. Seeding after creation is invisible to `renderToStaticMarkup`
(the server renderer reads the state captured at creation), so the seed goes in as the factory's init.
It proves the conversation-id prop selects that conversation's list — the guard against the
compiles-clean-renders-empty-forever trap — and that a different id reads not-yet-known. The existing
no-mock container test keeps proving the server render touches no bridge.

**Playwright, `e2e/run-config-settings.spec.ts`** — the row locators stop being catalog labels and
become the pushed fixture's display names, chosen mutually non-substring so the existing text-scoped
row locators and the page-wide `aria-label="Current model"` count stay meaningful. The list arrives as
an unsolicited `model_list` frame sealed with the production `encodeEnvelope` and pushed through
`daemon.pushFrame`, keyed to the seeded conversation — the `slash-command-type-ahead` template.

That means binding the `daemon` handle the spec deliberately left unbound. The spec's STANDING RULE is
*a fake-tier spec may not supply an input production does not produce* — and this frame is a genuine
unsolicited server push (the daemon publishes it from the conversation's `initialize` reply; nothing
the client sends provokes it), which is exactly the case the rule permits and the sibling spec already
exercises. The header comment is rewritten to record that, so the structural guard is replaced by a
stated one rather than silently dropped.

Fakes over mocks throughout; no new dependency.

## Open questions

- **An announced empty identifier against a row carrying an empty `resolved_model`.** Exact equality
  would name that row. Both blanks are daemon-side and neither has been observed; the uniform rule is
  applied rather than a special case added, per evidence-based fix selection. To be restated in a code
  comment if it survives implementation.
- **Whether the descriptor line should suppress an empty `resolved_model`.** Current answer: no — the
  line renders unconditionally, inventing no distinction the wire does not carry.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The one in play is the render boundary this slice IS:
  `display_name`, `value`, `resolved_model` and `truncated_fields`' elements are claude-authored text
  that crossed the subprocess trust boundary, bounded by the daemon and NOT sanitized by it. #972's
  narrower made the SHAPE trusted and nothing more. Every one of them reaches exactly one JSX text
  position where React escapes it. The store hands the view the held entry by reference and the view
  derives nothing from it, so the boundary stays a single place.
- **[Trust boundaries]** Named finding, addressed in the design: `value` is the one field this client
  sends BACK, and `validModel` upstream is a charset-and-length rule, not a membership check — a
  `value` cut mid-token (`opus[1m]` → `opus`) is still accepted and silently runs a different model.
  That is why a cut row is MARKED rather than hidden or repaired: the client must not repair a cut
  argument (repairing would mean parsing, which the wire forbids), and must not present it as complete.
- **[Tokens/secrets]** N/A by construction — nothing on this path touches a token, a key or any
  credential. The sheet's submit reuses the shipped `changeSetting` path unchanged.
- **[File/storage]** N/A — nothing here reads or writes disk or web storage, and nothing may: a
  persisted copy of a published list would outlive the pairing that scoped it and survive #977's clear
  with every in-memory assertion still green. `createModelListStore` takes no storage port.
- **[Electron attack surface]** No new IPC channel, no new preload surface, no `contextBridge` change,
  no navigation or window-open change. The renderer gains a read of state that already crossed IPC.
  Process placement is unchanged — no crypto, socket, key or raw byte enters the window.
- **[Injection sinks — the category that actually bites here]** Enumerated explicitly rather than waved
  past. No `dangerouslySetInnerHTML`, no `innerHTML`. No daemon string reaches an attribute (not
  `title`, not `aria-label`, not `data-*`), a URL, an `href`/`src`, a filename, a cache key, a lookup
  path, or a `key`. THE KEY IS THE ARRAY INDEX and that is a security decision, not a style one — a
  `display_name` key is a lookup path built from claude-authored text. No index keyed by row text is
  built at all, so the `__proto__`-writes-through-to-`Object.prototype` hazard has no site to occur in;
  should a later slice need one, it is a `Map`.
- **[Injection sinks]** The cut markers and the partial-list notice are client-owned constants in their
  own SIBLING elements, never concatenated into a daemon-authored node — so a `display_name` ending in
  "Truncated by the daemon" cannot forge the sheet's own claim. Asserted structurally, because
  `not.toContain(CUT)` would fail on a correct render of that hostile string.
- **[Logs/telemetry]** No finding, by an explicit decision: nothing on this path is logged and no
  diagnostic is added anywhere in this slice — not a "no list for this conversation" line, not a
  rejected-lookup line. That inherits the store's rule, whose footing is the CONTRACT (the daemon
  bounds and does not sanitize, so a control byte is permitted rather than excluded) and NOT the
  sibling frame's measured `0x0a`, which is a claim about workspace-authored slash-command text and
  does not transfer here.
- **[Concurrency]** No finding. The slice adds one synchronous store subscription and no async work,
  no timer, no listener, no promise — so there is nothing to cancel and no check-then-act window. The
  subscription's lifetime is the sheet's mount.
- **[Threat model — hostile daemon / prompt-injected model output]** The realistic actor here is text
  claude was induced to emit. It can: make a row's label read as anything (rendered escaped and inert);
  claim a cut that did not happen or omit one that did (the flag is the daemon's report and the client
  states it as such rather than verifying it); publish an empty list (a distinguishable reading, not an
  empty control); or publish a `value` that runs a different model than its label suggests. That last
  one is NOT closable client-side — the client cannot know what an argument means — and the honest
  mitigation is the one this slice ships: show the concrete identifier the row resolves to on its
  second line, so the operator can see what an alias means before the first turn.
- **[Threat model — DoS via list size]** Out of scope and already bounded upstream: `MAX_PLAINTEXT_BYTES`
  caps the decrypted envelope in `parseInboundMessage` ahead of every narrower, and the producer caps
  the entry count. No client-side cap is added — a second place the limit is decided could disagree
  with the first, and the producer's cap is not a wire constant. Unbounded per-row STRING length is
  handled visually rather than by truncation (`overflow-wrap: anywhere`), because truncating would
  violate the verbatim contract and re-introduce the ambiguity the cut marker exists to remove.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-02

## Size

Two lines of the size table are exceeded and the ticket ships as one anyway, as the refiner recorded:
~870 lines of total written work against the 800 ceiling, and 6 acceptance criteria against 5. #975 is
a grandchild (#556 → #561 → #975), so the split-depth gate forbids a third level; `needs-human:sizing`
is on the ticket and the seam that would have been cut is recorded in a comment there. The file,
call-site and reject-branch limits all hold comfortably — 2 production `.tsx` files plus one stylesheet,
one consumer call site, no state machine — and the overage is test cascade rather than design surface.
