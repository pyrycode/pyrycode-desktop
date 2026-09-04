# #1022 — hide the `auto` permission mode when the running model refuses it

## Files read

Codegraph is symlinked into this worktree but every `mcp__codegraph__*` call in this repo fails with
"CodeGraph not initialized", so this list was built with Grep and Read rather than
`codegraph_context`. The gap is noted here because the brief asks for codegraph first; it was tried on a
previous run in this repo and is a hard error, not an empty result.

- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx` → `composerPermissionModeMenuModel`,
  `ComposerPermissionModeMenuView`, `ComposerPermissionModeMenu`, `SETTABLE_PERMISSION_MODES`,
  `PERMISSION_MODE_LABELS`, `permissionModeLabel` — the file this ticket changes, and the header whose
  first half it un-says.
- `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel`,
  `ComposerEffortMenu` — the template for the half this control does not have yet: the `useMemo`-stable
  per-conversation selector, the `publishedRowFor` join on the **effective** model, and the argument
  order `(models, model, <own field>)` this ticket copies.
- `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `composerModelMenuModel` — the same
  recipe one button along; read for the `row ? … : …` posture (a matched row publishing a falsy field is
  still a hit) that this ticket's predicate reproduces in its own shape.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx` → `publishedRowFor` — the one exported
  match rule; exact equality on `value`, a miss is ordinary. This ticket is its **fifth** caller.
- `src/renderer/src/store/modelListStore.ts` → `selectModelListFor`, `ModelListEntry` — three readings
  (`null` = no frame, `models: []` = claude offered nothing, populated), and the docblock that already
  names #682 as a `supports_auto_mode` reader.
- `src/shared/wire/types.ts` → `WireModelOption` — `supports_auto_mode`'s docblock, including the
  bare-`as` hazard that makes the predicate's strictness load-bearing (see Design).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `.composer__footer` mount block —
  the one seam no unit test can see, and a comment block that states this control takes no props.
- `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.test.tsx` → `view`, `panel`,
  `rowCount` — the ~9 call sites of the two changed signatures, and the "no inert arm" claim that AC4
  keeps.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the permission-mode mount test —
  read to confirm it stays green (no `model_list` seeded ⇒ no row matches ⇒ `auto` still offered ⇒ the
  2/2 anchor and popup counts do not move).
- `e2e/composer-permission-mode-menu.spec.ts` → the shipped drive, and the trap: it pins
  `.composer-options-anchor` and `aria-haspopup="menu"` at **2** as the structural proof this menu needs
  no list frame. AC5's case therefore lands in its own file.
- `e2e/composer-effort-menu.spec.ts` → `modelListFrame`, `turnStateFrame`, `capturingFake` — the exact
  templates the new spec reuses, including the thinking→idle turn-end edge that fetches a snapshot.
- `e2e/real-claude-permission-mode.spec.ts` → read to confirm it stays green under the operator's gate:
  its `picked` is `named.find((name) => name !== baseline)`, which can only ever resolve to `Default` or
  `Accept edits`, never `Auto`. No change is owed there.
- `docs/knowledge/features/composer-permission-mode-menu.md` § "Where this control departs from its two
  neighbours" and § "The trigger, the container, and the write" — the package overview states the
  no-model-list-read claim twice and the no-props container once. **Documentation-phase owned; read, not
  edited.** The lesson it carries that changes this ticket: the label lookup's `__proto__` hazard is a
  *read*-direction hazard with its own guard, and the new join must not reintroduce an unguarded index.
- `docs/knowledge/features/model-list-store.md` — read for the same reason; also describes the greying.
  Documentation-phase owned.
- `docs/PROJECT-MEMORY.md`, `CLAUDE.md` — conventions; in particular the daemon-text ruling and the
  static-render-only renderer test tier.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The shared options panel, **unchanged by this ticket**. The node renders as a narrow dark rounded card
(81 × 144 at 1×) holding five identical single-line rows of the app's body text on the panel surface
token, with the current row distinguished only by a lighter selected-row fill — there is no disabled,
dimmed or otherwise unavailable row treatment anywhere in the node, which is precisely why the operator
ruled for plain omission. On a model that refuses `auto` this control feeds the same component four rows
instead of five; the card shrinks by one row height and nothing else about it changes. The trigger
([`115:3678`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3678)) is untouched, and no
node in the file gains a state.

## Context

`WireModelOption.supports_auto_mode` says whether the running model accepts claude's `auto` permission
mode. #682 shipped the footer's permission-mode menu offering all five settable modes unconditionally and
parked this half, because the shared panel has no unavailable state and inventing one would have meant a
new visual **and** a new prop on a surface four menus share. The operator settled it on 2026-09-04: hide
the option rather than grey it. So the menu offers one fewer entry and nothing else moves.

The data is already here. `modelListStore` holds the published rows per conversation, and the model and
effort menus already join the session's model to its row through the one exported match rule. This
control is the third footer menu to make that join; it invents no wire, no store and no panel.

No ADR is warranted. This slice takes no decision that outlives it — the match rule, the store's three
readings and the panel's contract are all already recorded, and the operator's hide-versus-grey ruling is
recorded on the ticket. The documentation phase should fold the outcome into
`docs/knowledge/features/composer-permission-mode-menu.md` (whose §§ "Where this control departs from its
two neighbours" and "The trigger, the container, and the write" now overstate the departure) and into
`docs/knowledge/features/model-list-store.md` (which still says "greys out").

## Design

### The predicate

One new expression, in `composerPermissionModeMenuModel`:

```
row = publishedRowFor(models, model)
hidden = row !== undefined && row.supports_auto_mode === false
```

**`=== false` rather than `!row.supports_auto_mode`.** In the shipped path the two are equivalent:
`parseModelList`'s `requireBoolean(payload, 'supports_auto_mode')` throws on a non-boolean and rejects the
whole frame, so a row that reaches `modelListStore` always carries a real boolean. The strict form is
chosen for two reasons that survive that. It states AC2's rule *directly* — only a row saying `false`
hides the entry — rather than encoding it as the absence of truthiness, and it stays correct on any path
that bypasses the narrower, which `WireModelOption`'s own docblock warns about for a frame reached
through a bare `as` on `Envelope.payload` (there, an absent key reads `undefined`, and the loose form
would hide the entry on a flag the client never received). It is also the decoder's own posture, stated
one layer down: *"`supports_auto_mode` is checked on the TYPE, never truthiness."* The same reasoning
makes `row !== undefined` the outer guard rather than optional chaining with a `?? false`: a miss is the
unknown reading, not a refusal.

Three inputs, three ways to land on "offer it anyway", all through the one expression and with no branch
of their own — no frame for the conversation (`models` is `null`), the conversation's list is empty, and
the session's model matches no published row (including a row whose `value` was cut by the daemon's
truncation, which stops being the session's model string and simply misses). AC2 names all of them; the
code has one condition because they are one reading.

**The join is on the EFFECTIVE model** — pending optimistic pick > client-confirmed override > snapshot
base, `selectEffectiveSettings`'s composition, the identical input the effort menu reads. That is what
makes picking a model which refuses `auto` drop the entry at once and a rejected model pick bring it
back, with no code of this ticket's own.

**No case fold, no trim, no prefix, no family derivation** anywhere on this path — `publishedRowFor`'s
posture, inherited rather than restated in a second copy.

### Signatures

| Symbol | Before | After |
|---|---|---|
| `composerPermissionModeMenuModel` | `(permissionMode)` | `(models, model, permissionMode)` |
| `ComposerPermissionModeMenuView` | `{ permissionMode, onSelect }` | `{ model, permissionMode, models, onSelect }` |
| `ComposerPermissionModeMenu` | `()` | `({ conversationId })` |

The argument order is `composerEffortMenuModel`'s verbatim — `(models, model, <own field>)` — so the
three footer menus keep one shape. Every view prop stays REQUIRED (this repo's "a view that cannot answer
is a bug" rule): the container always knows both, so an optional `models` would only hide the wiring seam
AC5 exists to catch.

The container gains the sibling recipe's fifth store read and nothing else: a `useMemo`-stable
`selectModelListFor(conversationId)` closure per id (a fresh closure each render churns the
subscription), with `conversationId === null` selecting `() => null` through the same path — no invented
key, no second branch downstream, and `null` is a stable reference.

### One new exported constant

`AUTO_PERMISSION_MODE = 'auto'`, module-level and exported. It is the string the predicate filters and
the string the two test tiers must name to derive their expectations; exporting it is what keeps the
filter and the tests from each typing their own copy. `SETTABLE_PERMISSION_MODES` keeps five plain
literals in the daemon's declared order — substituting the const into the middle of that list would
obscure the vocabulary it exists to state — and a unit assertion pins membership
(`SETTABLE_PERMISSION_MODES` contains `AUTO_PERMISSION_MODE`), so a typo in either reddens rather than
silently disabling the filter.

### What does NOT change

- **`ComposerOptionsPanel` gains no prop.** Four menus share it; a shorter `options` array needs nothing
  from it. This is the whole point of the operator's ruling.
- **No third rendering.** The view keeps its two arms — `permissionMode === ''` draws nothing, anything
  else draws the menu. AC4: the entry list is never shorter than the four unconditional modes, so this
  menu still has no nothing-to-offer arm, unlike both neighbours. No `options.length === 0` branch is
  added, and no inert `<span>`.
- **The trigger's label.** AC3: a session already running `auto` on a model that refuses it still labels
  the trigger `Auto` and marks nothing in the panel, through the same no-matching-entry branch a session
  in bypass already uses. `currentId` stays the session's mode verbatim and the panel's existing
  `option.id === currentId` comparison does the rest. Hiding an entry never changes what the trigger
  says.
- **`bypassPermissions` stays out of `SETTABLE_PERMISSION_MODES`**, and the two counts pinning that
  asymmetry stay. This ticket makes one entry conditional; it does not reopen which modes exist.
- **CSS.** `.composer__permission` stays worn unconditionally, because the control still has no inert
  arm. One clause of the note above that rule is corrected (see Prose below); the rule is not.

### Prose this change falsifies, and prose it must not touch

The "its entries are a client-owned constant, so it reads no model list" claim is restated in **five**
places. Four are falsified in their premise and are corrected here; the fifth is the docs phase's.

| Site | Status |
|---|---|
| `ComposerPermissionModeMenu.tsx` header, the departures list | Correct the "no `publishedRowFor` lookup and no model-list store read at all" clause. The "never nothing to offer" clause **stays** — it is AC4. |
| `ConversationScreen.tsx`, the footer mount comment | Correct "It takes NO props … needs no `conversationId`". "IT IS ALSO THE ONE FOOTER MENU THAT IS ALWAYS OPERABLE" **stays** — still true. |
| `App.tsx`, `ModelListData`'s comment | "reads each row's `supports_auto_mode` to grey out a mode the running model refuses" — greying is what the operator ruled out. One clause. Not named on the ticket; found by the sweep. |
| `conversation.css`, the note above `.composer__permission` | One clause: the premise, not the conclusion. The unconditional `cursor: pointer` and the absence of an inert rule are unchanged. |
| `docs/knowledge/features/composer-permission-mode-menu.md`, `…/model-list-store.md` | **Do not edit.** Documentation phase owns them. |

Do **not** touch, though a sweep returns them:

- `e2e/composer-effort-menu.spec.ts` and `e2e/composer-model-menu.spec.ts` each say this control "has no
  list to be waiting for". That is an **operability** claim about why the anchor count is 2 before a
  `model_list` arrives, and it stays true: the control never waits for a list, it fails open without one.
  Editing either would be adjacent-code churn in two green specs.
- `src/shared/wire/types.ts`'s `WireModelOption` docblock **apart from** the one `supports_auto_mode`
  clause. The paragraphs around it anchor the write half's closed five, the `effort_levels` collapse and
  the `truncated_fields` rule by name; a sweep for auto-mode prose returns far more anchors than claims.
- `src/renderer/src/store/modelListStore.ts`'s "#682 reads `supports_auto_mode` per row, so it must know
  whether it has any rows to reason from at all" — this ticket makes that sentence *true* for the first
  time.

## State + concurrency model

No new state, no new store, no new async work, and no new subscription lifecycle. The container gains one
zustand subscription to `modelListStore` through the existing `selectModelListFor` read path — the same
subscription both neighbours already hold, narrow-slice correct by that store's construction (a write for
a different conversation returns the same entry object for this one, so `Object.is` holds and this leaf
does not re-render).

Re-render seams: the container is a leaf so a model-list or snapshot tick re-renders this control rather
than the textarea and send button beside it. The `useMemo`-stable selector is what keeps the new
subscription from churning on every render.

There is no cancellation path to define because nothing long-lived is started.

## Error handling

No new I/O, IPC or parse boundary, so no new result type. The failure modes this slice can meet are all
*data* readings, and each resolves to "offer `auto`":

- No `model_list` frame for the conversation → `selectModelListFor` returns `null` → miss.
- `models: []` → miss.
- Session model matches no row, including a truncation-cut `value` → miss.
- A row present but `supports_auto_mode` absent because the frame came through a bare `as` → not `false`
  → offered.

The one reading that hides is a row that positively says `false`. Nothing throws, nothing logs, and no
error reaches the UI — consistent with the footer's hard 20px row, which has no slot for a message, and
with ADR 0007's content-free rule.

## Testing strategy

**vitest — `ComposerPermissionModeMenu.test.tsx`** (static server renders; nothing in this repo can
click). The existing ~9 call sites of the two changed signatures take the new arguments; the `view()` and
`panel()` helpers grow optional `models`/`model` parameters so the shipped cases keep reading as
one-argument calls and only the new cases pass a list. New scenarios, each a derivation over
`SETTABLE_PERMISSION_MODES` and `AUTO_PERMISSION_MODE` rather than a typed list of four:

- A row for the session's model saying `false` → the other four ids, in their existing order, no `auto`
  (AC1).
- Each unknown reading offers all five (AC2): `models` `null`; `models` with an empty `models` array; a
  populated list matching no row; a row whose `value` is a *superstring* of the session's model (the
  cut-value shape); and a row with `supports_auto_mode` forced to `undefined` through the test's own cast
  — the bare-`as` reading, which must fail **open**.
- A row saying `true` offers all five (AC2).
- A session running `auto` on a refusing row: the label is still `Auto`, `currentId` is still `auto`, and
  the panel marks nothing while offering four (AC3).
- Membership: `SETTABLE_PERMISSION_MODES` contains `AUTO_PERMISSION_MODE`, so the filter cannot be
  silently disabled by a rename.
- AC4 as a floor across the whole matrix: `options.length` is never below
  `SETTABLE_PERMISSION_MODES.length - 1`, the view returns an operable trigger (anchor, `aria-haspopup`,
  chevron) on every row shape, and no inert `<span>` arm exists. The existing "is operable while the
  session runs %s" parameterised case is extended over a refusing row rather than duplicated.
- The `__proto__` / `constructor` cases keep running, now with a refusing row present, so the new join
  cannot have introduced a second unguarded index.

`ConversationScreen.test.tsx` needs no change and is expected to stay green: it seeds no `model_list`, so
no row matches, so `auto` is still offered and the 2/2 anchor and popup counts do not move. That it stays
green is asserted by running it, not by editing it.

**Playwright — a NEW file, `e2e/composer-permission-mode-auto.spec.ts`.** AC5's case seeds its own state
*beside* the shipped spec, never inside it: `e2e/composer-permission-mode-menu.spec.ts` pins
`.composer-options-anchor` and `aria-haspopup="menu"` at exactly 2 as the structural proof this menu
needs no list frame, and seeding a `model_list` there would make both counts 4 and delete a deliberate
claim. One `test()`, one launch, one continuous drive (`composer-effort-menu.spec.ts`'s shape and its
`modelListFrame` / `turnStateFrame` / `capturingFake` templates verbatim):

1. Push an unsolicited `model_list` carrying two invented rows — the session's model refusing `auto`, a
   second row accepting it, so the flag is read per row rather than per list.
2. Push a `thinking` → `idle` pair. That turn-end edge is what makes the app request a session-settings
   snapshot; the fake answers with a baseline naming the refusing row's `value`. A lone `idle` fires
   nothing.
3. Open the panel and assert the menu items are **exactly** the four remaining display names, in order
   (`toHaveText` on the array is exact and ordered), and that no item is named `Auto`.
4. Push a replacement `model_list` where that same row now accepts `auto` — the frame's own
   replace-wholesale contract — reopen, and assert five. This is what proves the join is live per row
   rather than a constant, and it is cheap.

The always-hide bug — the mirror failure — is already caught by the shipped spec, which asserts all five
entries with no `model_list` ever pushed. The two specs together bound the behaviour in both directions.

The fake-tier spec is the ONLY proof the mount passes `conversationId`: the pure model function stays
green with the mount unwired, the failure is silent in the fail-open direction, and a static render
cannot open the panel to see the entries at all. Nothing is owed to
`e2e/real-claude-permission-mode.spec.ts` — its `picked` resolves to `Default` or `Accept edits` and
never to `Auto`.

**Fakes over mocks** throughout: the e2e tier drives the existing fake daemon, and the unit tier builds
plain `WireModelOption` fixtures with invented values (mutually non-substring, so a widened comparison
would be visible rather than accidentally right).

## Open questions

1. **Does the shipped `ComposerPermissionModeMenu.test.tsx` mount test or any sibling e2e spec redden on
   the anchor/popup counts?** Expected no — no `model_list` is seeded at any of those points. Resolve by
   running the touched scope; record a `## Revisions` entry if any count actually moves.
2. **Should the `view()` / `panel()` test helpers take the new inputs as optional trailing parameters, or
   should all ~9 call sites be rewritten?** Leaning optional-trailing, which keeps the diff on the cases
   this ticket is about. Resolve while writing the RED tests; the production signatures stay required
   either way.
3. **Does the e2e replacement-frame step (step 4) fit the budget?** It is the strongest single assertion
   for a live per-row join. Drop it only if the run is at its wall clock, and say so in the PR if so.

## Security review

**Verdict:** PASS

The category that actually matters here is #9. This ticket makes a *permission* control's offered set
depend on a **daemon-supplied flag** for the first time, which is the shape that deserves the adversarial
read; the other categories are genuinely untouched and are recorded below with the design decision that
makes them so, not with a tick.

**Findings:**

- **[Threat model — hostile daemon steering the permission menu] No finding, and this is the load-bearing
  property: the filter can only ever REMOVE, and only ever the one named mode.** The offered set is
  computed as `SETTABLE_PERMISSION_MODES` (a client-owned constant) minus `AUTO_PERMISSION_MODE` — it is
  never computed *from* the row. So the worst a hostile or compromised daemon achieves by lying with
  `supports_auto_mode: false` is removing one middle-permission entry; `default` and `plan`, the two
  safest options, are unconditional and cannot be hidden, and the operator is never steered toward a
  *more* permissive mode because no more-permissive mode is reachable from this menu at all. A design
  that instead derived the entries from the published row would be exploitable — a row could then name
  `bypassPermissions` — and this plan rejects that shape explicitly. **`bypassPermissions` remains absent
  from `SETTABLE_PERMISSION_MODES` and this slice does not reopen that list**, so the one-click
  privilege escalation the shipped design excludes stays excluded, pinned by the two counts already in
  `ComposerPermissionModeMenu.test.tsx`.
- **[Threat model — what this control is NOT] No finding, stated so the next reader does not mistake it:
  the hide is a UX affordance, never an authorization boundary.** The daemon is the enforcement point —
  it refuses a `permission_mode` it does not accept, and `selectEffectiveSettings` rolls the optimistic
  label back on that rejection (#256). Nothing about this ticket lets a client-side omission be relied on
  for safety, and the fail-open direction (offer `auto` whenever the flag is unknown, AC2) is therefore
  not a hole: it restores exactly the behaviour that shipped in #682 and that the daemon already polices.
- **[Trust boundaries] No finding — this ticket adds NO new render sink for daemon text.** The newly-read
  field is a `boolean`. The entry labels stay `permissionModeLabel` over the client-owned
  `SETTABLE_PERMISSION_MODES`, so `display_name` — the claude-authored string the two neighbouring menus
  do render — never reaches this menu at all. The session's `model` string reaches exactly one new place,
  `publishedRowFor`'s `row.value === model` comparison, which is a string equality and keys no object.
  The boundary itself is unmoved: `parseModelList` in `src/main/transport/inboundMessage.ts` narrows the
  frame fail-closed before it becomes a typed IPC event, and this consumer holds only the narrowed type.
- **[Trust boundaries — the `__proto__` read hazard, re-checked rather than inherited]** The existing
  `permissionModeLabel` own-property guard is the one place this file indexes a plain object by a
  daemon-controlled string, and this ticket adds no second one: the new code iterates a client-owned array
  with `Array.prototype.filter` and reads `row.supports_auto_mode`, a fixed literal key. The
  `__proto__` / `constructor` unit cases are extended to run *with a refusing row present*, so the claim
  is asserted rather than assumed.
- **[Electron attack surface / process placement] No finding — nothing crosses `contextBridge` that did
  not already.** No new IPC channel, no new preload API, no new `ipcMain` handler. The `model_list` event
  already flows to the renderer and is already held by `modelListStore` for three shipped consumers; this
  adds a fourth reader of the same renderer-side store. No key, socket, token or raw byte comes within
  reach of this leaf, and none is added to the renderer.
- **[Tokens, secrets, credentials] Not applicable by construction** — this slice reads a boolean and a
  model alias out of an existing renderer store and renders a client-owned label. It creates, stores,
  transmits and logs nothing secret; `safeStorage` and the device token are nowhere on this path.
- **[File / storage operations] Not applicable by construction** — no filesystem access, no path built
  from any input, no persistence. The one value this control can send (`permissionMode`) is an entry from
  a client-owned constant, never a path.
- **[Cryptographic primitives] Not applicable by construction** — no randomness, no comparison against a
  secret, nothing touching the Noise session. `publishedRowFor`'s `===` compares two non-secret display
  identifiers, so `timingSafeEqual` is not owed here.
- **[Network & I/O] No finding, with one pre-existing property named.** This ticket adds no request, no
  frame type and no socket work; it does not widen the wire. It does add a **fourth** linear `find` over
  the daemon-sized `models` array per render. That array's bound is the producer's, reported by
  `dropped_models`, and three shipped consumers already scan it on the same renders — so this is not a new
  memory- or CPU-exhaustion surface, and any cap would belong to the decode slice (#972), not here. Named
  rather than silently inherited.
- **[Error messages, logs, telemetry] No finding — the new path logs nothing and throws nothing.** There
  is no new error to surface, by design: every unknown reading resolves to "offer `auto`" rather than to
  a message, which also keeps the footer's hard 20px row free of a slot it does not have. Consistent with
  ADR 0007's content-free rule; no daemon string reaches a log on this path, and none is added.
- **[Concurrency] No finding — nothing long-lived is started, so there is no cancellation path to
  define.** The one addition is a zustand subscription through the shipped `selectModelListFor` read
  path, `useMemo`-stabilised per conversation id exactly as both neighbours do it, torn down by zustand on
  unmount. No timer, no listener, no promise, no `AbortController` owed. The container does read two
  stores in one render body, so a render can in principle compose a fresh model list with a
  one-tick-stale effective model; the consequence is bounded to one frame of a five-entry menu where four
  belong (or the reverse), it self-corrects on the next render, and it has no security consequence
  because the daemon, not the menu, decides what a session may enter.
- **[Threat model — renderer compromise reaching the transport] No finding** — process isolation is
  untouched. A script-injection bug in the renderer gains nothing from this slice that it did not already
  have from the three shipped `modelListStore` readers.
- **[Threat model — hostile daemon response shape] No finding.** A non-boolean `supports_auto_mode` is
  rejected at the decode boundary (`requireBoolean`, which throws and drops the whole frame), so it never
  reaches this predicate; and were it to arrive through a path that bypasses the narrower, `=== false`
  fails **open** rather than acting on a value the client never received. A unit case pins that direction
  with an explicit cast.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-04
</content>
</invoke>
