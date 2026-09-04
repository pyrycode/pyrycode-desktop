# Composer permission-mode menu (#682)

The footer's second live control, between [the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
and [the model menu](composer-model-menu.md) (Figma `115:3678`). Part of
[Conversation shell — composer](conversation-shell-composer.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

It assembles rather than invents: the panel is [#838/#839/#840's](conversation-shell-composer-options-panel.md),
the inbound mode is #1020's ([Session settings — permission mode read](conversation-shell-workspace-and-run-config.md)),
the outbound field is #1021's, and the overlay composition is #256's. This ticket adds the entries, the
trigger's label, and what picking one does — the same three things [the model](composer-model-menu.md) and
[effort](composer-effort-menu.md) menus added on either side of it, `ComposerModelMenu.tsx`'s three-part
shape (pure model function, pure view, thin store-bound container) reused a third time, in its own file
(`ComposerPermissionModeMenu.tsx`).

## The wire contract is asymmetric, and that asymmetry is the whole design

Measured from `pyrycode/internal/protocol/settings.go` and `internal/relay/v2session_settings.go` on
2026-09-03: the **read** half reports **six** modes — `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
`bypassPermissions`. The **write** half accepts **five** — `bypassPermissions` is refused on
`permission_mode`, deliberately, so the escalation keeps exactly one spelling on the wire: the `yolo` bit
the run-configuration sheet's toggle already owns.

So this menu **renders six labels and offers five entries**. A session sitting in bypass shows
`Bypass permissions` on the button and is offered the other five; picking one moves it out of bypass,
because the daemon clears the bit for any mode it accepts. **Nothing here can move a session into bypass**,
and nothing here tries to — adding the sixth entry "for symmetry" would be a one-click privilege escalation
in the input footer. The two counts are pinned by name in `ComposerPermissionModeMenu.test.tsx`.

## Where this control departs from its two neighbours

The three footer menus look interchangeable but differ in two load-bearing ways:

- **Its vocabulary is client-owned, and only one entry of it is conditional.** The model and effort menus
  each read `model_list` and have a third rendering — an inert label that opens nothing — for the three
  ways that list can be missing. Nobody publishes the set of settable permission modes to this client, so
  there is no list frame to *wait for* and no empty-list arm, and there is never "nothing to offer": every
  mode that renders at all renders an **operable** trigger. That stayed true when
  [#1022](https://github.com/pyrycode/pyrycode-desktop/issues/1022) gave this control a
  `publishedRowFor` lookup and a model-list store read — see § The `auto`-hiding join below — because the
  read only ever *subtracts* one named entry from the constant; it never grows or replaces the list. This
  is **two renderings, not three** — `permissionMode === ''` draws nothing (no run-config snapshot has
  arrived yet, or the session was never resolved — one string, two readings, both meaning this control has
  nothing true to say), and any other string draws four or five entries, including the bypass reading,
  which gets no branch of its own.
- **Its label is looked up, not verbatim.** Claude publishes effort levels byte-identical to what it
  accepts, so the effort trigger relabels nothing. Permission modes arrive as camelCase machine identifiers
  (`acceptEdits`); Figma `115:3678` draws the display form (`Auto`), and the shared panel's `id`/`label`
  split — [`ComposerOptionsPanelOption`](conversation-shell-composer-options-panel.md) — exists for exactly
  this consumer, which its own docblock names.

Because the control is operable whenever a mode is known, it is the first footer menu with **no inert
arm at all** — the model and effort menus wear `.composer__footer-button` on an inert `<span>` while
waiting for their list; this one never does. That is what moves the footer's anchor and `aria-haspopup`
counts: this control adds a second one to a row four unit assertions (`ConversationScreen.test.tsx`) and
six e2e assertions (`composer-model-menu.spec.ts`, `composer-effort-menu.spec.ts`) had pinned at one. Each
count moved by exactly one — the steps *between* them, which isolate each sibling control, are unchanged.

## The `auto`-hiding join (#1022)

`WireModelOption.supports_auto_mode` says whether claude accepts `auto` permission mode for the running
model — it refuses per model (Haiku 4.5 does not have it, Sonnet 5 does, measured 2026-08-21). #682 shipped
this menu offering all five settable modes unconditionally and parked the flag, because the shared options
panel ([`ComposerOptionsPanel`](conversation-shell-composer-options-panel.md), Figma `121:3879`) draws five
identical rows with no unavailable-row state — greying one out would have meant inventing a new visual
*and* a new prop on a surface four menus share. **The operator settled it 2026-09-04: hide the option
rather than grey it out.** So `ComposerOptionsPanel` gained no prop, no node in the Figma file gained a
state, and the menu simply offers one fewer entry on a refusing model.

The whole decision is one expression in `composerPermissionModeMenuModel`:

```ts
const row = publishedRowFor(models, model)
const hidesAuto = row !== undefined && row.supports_auto_mode === false
// options: SETTABLE_PERMISSION_MODES.filter((mode) => !(hidesAuto && mode === AUTO_PERMISSION_MODE))
```

- **The filter can only ever subtract, and only ever the one named mode.** The offered list is
  `SETTABLE_PERMISSION_MODES` — the client-owned constant — minus `AUTO_PERMISSION_MODE`; it is never
  computed *from* the published row. A hostile or merely buggy daemon lying with `supports_auto_mode:
  false` can remove at most one middle-permission entry; `default` and `plan`, the two safest options, are
  unconditional and cannot be hidden, and no row can *add* an entry, least of all `bypassPermissions`. A
  design that derived the entries from the row instead would have been exploitable. The hide is a UX
  affordance, never an authorization boundary: the daemon is the actual enforcement point, refusing a mode
  it does not accept, and `selectEffectiveSettings` rolls the optimistic label back on that rejection
  (#256).
- **Fails open, by construction, not by a fallback.** `auto` is offered wherever the client does not
  positively know otherwise — no `model_list` frame for the conversation, an empty published list, or the
  session's model matching no row (including a row whose `value` the daemon truncated mid-token, which
  therefore simply misses). All three are one reading and share the one `row !== undefined` guard; only a
  row that positively says `false` hides the entry.
- **`=== false`, never `!row.supports_auto_mode`.** The two agree on the shipped path — `parseModelList`'s
  `requireBoolean` throws on a non-boolean and drops the whole frame, so a row that reaches the store always
  carries a real boolean — but the strict form states AC2's rule directly and stays correct on a path that
  bypasses the narrower (a bare `as` on `Envelope.payload`, which the field's own docblock warns about): an
  absent key reads `undefined` there, and the loose form would act on a flag the client never received.
  It's the decoder's own posture one layer down — checked on the type, never on truthiness.
- **The join is on the session's effective model** (pending optimistic pick > client-confirmed override >
  snapshot base — `selectEffectiveSettings`'s composition), the same input [the effort
  menu](composer-effort-menu.md) reads, through `publishedRowFor`'s exact `value` equality — no case fold,
  no trim, no family derivation. That is what makes picking a model which refuses `auto` drop the entry at
  once, and a rejected model pick bring it back, with no code of this control's own.
- **A session already running `auto` on a refusing model still labels the trigger `Auto` and marks nothing
  in the panel** — the same no-matching-entry branch a session in bypass already uses. `currentId` stays
  the session's mode verbatim; hiding an entry never changes what the trigger says.
- **`AUTO_PERMISSION_MODE = 'auto'`** is the one new exported constant, module-level. Both the filter and
  the two test tiers name it rather than each typing their own copy of the string, and a unit assertion
  pins `SETTABLE_PERMISSION_MODES` containing it, so a rename cannot silently disable the filter.

No render sink is added: the newly-read field is a `boolean`, and the entry labels still route through
`permissionModeLabel` over the client-owned `SETTABLE_PERMISSION_MODES` — `display_name`, the
claude-authored string the two neighbouring menus render, never reaches this menu at all. See [Model-list
store](model-list-store.md) and [Model-list wire types](model-list-wire-types.md) for the store this join
reads and the field's own docblock.

## The label lookup and its `__proto__` hazard

`PERMISSION_MODE_LABELS` is a frozen `Readonly<Record<string, string>>` over the six known modes. It is
read through `permissionModeLabel(mode)`, which guards with
`Object.prototype.hasOwnProperty.call(PERMISSION_MODE_LABELS, mode)` before indexing, and falls through to
the mode itself verbatim when the check fails.

**A daemon-controlled string used as an object key is a hazard even when nothing is ever written.**
`PERMISSION_MODE_LABELS['constructor']` returns a function, `PERMISSION_MODE_LABELS['__proto__']` returns an
object — neither is `undefined`, so a bare `PERMISSION_MODE_LABELS[mode] ?? mode` fallback would not catch
either, and a non-string reaching a JSX child position throws inside React: one field of one daemon frame
taking the whole conversation screen down. This repo's existing prototype-safety lore
([[json-parse-and-object-fromentries-are-prototype-safe]]) is about the *write* direction
(`obj[k] = v` silently dropping a numeric key); this is the *read* direction, and it needed its own guard.
`ComposerPermissionModeMenu.test.tsx` drives `__proto__`, `constructor` and `toString` as modes through both
`composerPermissionModeMenuModel` and the view, asserting the fallen-through string reaches only the one
JSX text position and never an attribute. Since #1022 added a second daemon-controlled read on this same
path (`row.supports_auto_mode`, a fixed literal key on a plain object, not a daemon-controlled one), these
cases run again with a refusing row present, so the guard is asserted rather than assumed to still hold
once the new join exists.

The unrecognized-mode fallthrough is the same posture `runConfigSnapshot.ts`'s own test assigns to this
ticket ("what to display for an unknown mode belongs to #682"), and it is why the label element is treated
as a daemon-text sink unconditionally even though five of its six values are client-owned strings.

## The trigger, the container, and the write

`ComposerPermissionModeMenuView({ model, permissionMode, models, onSelect })` is a pure view — no store
read, no `window.pyry`, no state — so it server-renders under this repo's `node` vitest environment like
its two neighbours. It returns `null` on the empty-mode arm, otherwise a `ComposerOptionsMenu` with
`triggerClassName="composer__footer-button composer__permission"`, a client-owned `ariaLabel` naming the
**panel** (`COMPOSER_PERMISSION_MODE_MENU_LABEL = 'Permission mode'` — the trigger itself carries no
`aria-label`, so its accessible name stays its visible text), and the sibling triggers' `chevron-up-solid-full`
glyph, duplicated at its own use site rather than shared (see § CSS below). Since #1022 every prop is
**required**, `model` and `models` included: the container always knows both, so an optional `models`
would only hide the wiring seam described next.

`ComposerPermissionModeMenu({ conversationId })`, the container, took **no props** until #1022 — the
visible half of reading no per-conversation model list. It now takes `conversationId` the way both
neighbours already do, adding one `useMemo`-stable `selectModelListFor(conversationId)` subscription (a
fresh closure each render would churn it; `conversationId === null` selects `() => null` through the same
path). It reads `sessionIdStore`, `runConfigStore.snapshot`, and the **raw** `runSettingsWriteStore` state
(not the `selectEffectiveSettings` selector — that returns a fresh object every call and would re-render on
every store tick), composing them with `selectEffectiveSettings` in the render body and passing
`effective.model` into the view alongside the held model list. `onSelect` is an arrow so `window.pyry` is
dereferenced at interaction time and never during render, and forwards to
`changeSetting({ field: 'permissionMode', value })` — the mode's own machine value, submitted with no
reverse lookup.

**The container mount is the one seam no unit test can see.** The pure model function stays green with
the mount unwired (`conversationId={null}` selects an empty model list, which reads identically to "no
frame arrived yet" — `auto` stays offered), so a broken wire fails silently in the fail-open direction.
Verified to actually redden: temporarily reverting the `ConversationScreen.tsx` mount to pass no
`conversationId` turns `e2e/composer-permission-mode-auto.spec.ts` red at the four-entry assertion
(`locator resolved to 5 elements`). That e2e case is the only proof this wiring is live.

\#682's AC3 ("sends nothing when there is no addressable session id") is `changeSetting`'s own gate, not a
withheld handler: this view has no operability branch to fuse the gate with, unlike the run-configuration
sheet. #682's AC3 optimistic move and AC4's rollback-on-rejection are both `selectEffectiveSettings`'s
pending-over-confirmed-over-snapshot composition, with no code of #682's own — the same composition the
model and effort triggers read through, and, since #1022, the same composition this control's
`auto`-hiding join reads its `model` from (see § The `auto`-hiding join above).

## CSS: a fourth footer-button consumer, and the fourth-glyph lift declined again

The trigger rides the shared [`.composer__footer-button`](composer-model-menu.md) treatment #988 extracted;
nothing about that rule is re-forked here. Three new declarations:

- **`.composer__permission { cursor: pointer }`** — worn **unconditionally**, unlike its two neighbours'
  per-consumer `cursor: pointer`, which only exists to keep their *inert* arm from lying about being
  clickable. This control has no inert arm, so there is nothing for the declaration to disagree with — and
  that stayed true when #1022 gave it a model-list read: its vocabulary is still client-owned and its list
  never falls below four entries, so the rule is unchanged even though the premise above it was reworded.
- **`.composer__permission-label { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis }`**
  — its own rule rather than reusing `.composer__model-label`'s identical bound, since each footer e2e spec
  locates its own label class bare (a second wearer breaks Playwright strict mode). 120px is derived from
  the client-owned vocabulary: #988 measured the 13-character context reading at ~6.35px/char, so the
  longest display name (`Bypass permissions`, 18 characters) draws at ~114px. It is deliberately **not**
  tuned tighter to buy row width — ellipsizing the one label naming a security posture would be the wrong
  place to economize.
- **`.composer__permission-icon { flex: 0 0 auto }`** — `.composer__actions-icon`'s one declaration,
  repeated rather than shared.

**The row is now over its width budget at the app's 800px minimum window, as
[the effort menu's](composer-effort-menu.md) own note predicted it would be.** At that width the
conversation pane is 400px, less two `--space-4` paddings and four `--space-5` gaps leaves 288px for five
items; realistic content (Actions ~56px, this control ~56px at `Default`, a model display name ~75px,
`medium` ~62px, the context reading 82.5px) totals ~331px. The e2e geometry detector
(`.composer__footer` still 20px tall, `document.body.scrollWidth <= clientWidth`) still passes, because a
drive can only seed short labels — it will not catch this on its own. **The fix stays what
`.composer__effort-label`'s note already named: a whole-row shrink policy on `.composer__footer`, not a
number retuned in any single control's rule.** No sibling bound was touched here.

**The fourth-glyph CSS lift is declined a fourth time.** `.composer__actions-icon`'s standing note had
assigned this ticket two lifts — collapsing the four identical `flex: 0 0 auto` glyph rules into one shared
class, and lifting the four files' duplicated `CHEVRON_PATH` const — on the premise that "#682 re-classes
its own element anyway." That premise was false: a new control *adds* an element, the lift would re-class
three *shipped* ones and move five assertions across three test files this ticket does not otherwise touch,
compounding the ten-assertion recount this ticket already carries unavoidably. The note is corrected rather
than reassigned a fifth time: the lift is not being deferred on its merits (four identical single-declaration
rules is past the point where a lift pays), but because every footer ticket that meets it lands already at
its own size budget. It now belongs to a standalone tidy-up, not to #685 or any other footer ticket — the
four rules are `.composer__actions-icon`/`.composer__model-icon`/`.composer__effort-icon`/`.composer__permission-icon`,
and the four `CHEVRON_PATH` consts live one per `Composer*Menu.tsx` file.

## Security

`permissionMode` crosses the subprocess trust boundary through `runConfigSnapshot` → `runConfigStore`
(#1020); decoded is not sanitized, and this control is where the string is finally rendered. The whole
obligation is discharged at `permissionModeLabel`'s own-property-guarded lookup reaching exactly one JSX
text position, where React escapes it. `currentId` reaches only the shared panel's `option.id === currentId`
string comparison — no plain object is keyed by the raw mode anywhere in this file. Nothing on this path is
logged, matching [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s content-free
rule. The panel's `aria-label` is the client-owned `COMPOSER_PERMISSION_MODE_MENU_LABEL`, never the
trigger's own daemon-authored visible text.

The privilege-escalation angle is this control's actual security question, and it is closed structurally:
`SETTABLE_PERMISSION_MODES` has five entries, `bypassPermissions` is not among them, and two tests assert
its absence as a derivation over the returned ids (a count, so the guard cannot pass vacuously) rather than
trusting a comment. A future contributor adding the sixth mode "for symmetry" would be adding a one-click
privilege escalation to the footer. #1022 does not reopen this list — it reads a boolean off a published
row to *subtract* from it — and the same structural argument extends to that read: see § The
`auto`-hiding join above for why a hostile daemon can only ever remove `auto`, never add
`bypassPermissions` or steer the operator toward a more permissive mode.

## Testing

Renderer tests are static server renders (CLAUDE.md); `ComposerPermissionModeMenu.test.tsx` covers
`composerPermissionModeMenuModel` as data (both renderings, all six modes labeled, an unknown mode falling
through verbatim while still offering five and marking none, the bypass reading labeling
`Bypass permissions` while still offering five and marking none) and the view against it (the anchor/panel
wiring, the label's own bounded element, the chevron `aria-hidden`, the panel's client-owned name, and the
`__proto__`/`constructor`/`toString` attribute sweep above). `ConversationScreen.test.tsx` gained a new mount
test seeding all three footer menus' snapshot fields at once to pin the row's final order
(Actions → permission → model → effort → reading) — the only proof this control is wired in, since every
assertion in its own file passes on an unmounted component.

**#1022 extended the model-function cases** rather than adding a typed fixture list: a row for the
session's model saying `false` (the other four ids, no `auto`); every unknown reading — `models` null, an
empty `models` array, a populated list matching no row, a row whose `value` is a superstring of the
session's model (the truncation-cut shape), and `supports_auto_mode` forced to `undefined` through a cast
(the bare-`as` reading) — offering all five; a row saying `true` offering all five; a session running
`auto` on a refusing row still labelling `Auto` and marking nothing while offering four; and a floor
assertion across the whole matrix that `options.length` never drops below
`SETTABLE_PERMISSION_MODES.length - 1`. The shipped `view()`/`panel()` test helpers took the two new
inputs as trailing optional parameters defaulting to `(null, '')` — the reading that was this control's
only one before #1022 — so every pre-existing call site reads unchanged and doubles as evidence for the
fail-open rule.

**React escapes a text child, so a client-owned label with an apostrophe is not byte-identical in
markup** — `Don't ask` renders in `renderToStaticMarkup` output as `Don&#x27;t ask`. Every markup assertion
on a label routes through a `rendered()` helper that derives the escaped form from React itself, rather than
hand-rolling an escaper that could disagree with the renderer about what escaping means. Playwright is
unaffected: it reads DOM text, so the e2e locators match the label verbatim. Worth reusing for any later
footer label carrying an apostrophe or an ampersand.

`e2e/composer-permission-mode-menu.spec.ts` drives a `bypassPermissions` snapshot first (before a later
confirmed pick could mask it), then a `default` snapshot, then a pick with a correlated reply, then a pick
whose reply is withheld so the store's `error` fallback proves the rollback, then the row-geometry check
with four controls drawn, then confirms the footer's anchor count moves 1 → 2 with no `model_list` ever
pushed — the proof this control needs no list frame. **This spec deliberately pins
`.composer-options-anchor` and `aria-haspopup="menu"` at exactly two in the footer, as the structural proof
this menu needs no list frame** — #1022's case seeds its `model_list` in its own file rather than here, so
that claim stays intact. `e2e/real-claude-permission-mode.spec.ts` (#682's AC5) pairs against a real
daemon, reads the baseline mode off the button rather than assuming one, picks a different settable mode,
and drives a fresh turn-end edge to confirm a **re-read** snapshot still names the picked mode — carrying
the same honest limit `real-daemon-session-settings.spec.ts` already records: the app-level `confirmed`
override survives the reopen, so the post-change label is not *provably* snapshot-sourced. This ticket
carries `needs-real-claude`; the tier runs under the operator's `npm run e2e:real:gate`, not in CI. Its
`picked` can only ever resolve to `Default` or `Accept edits`, never `Auto`, so #1022 owes it nothing.

**`e2e/composer-permission-mode-auto.spec.ts` (new, #1022)** is the AC5 case for the `auto`-hiding join,
and the only proof the container actually passes `conversationId` through — a static render cannot open
the panel, and the pure model function stays green with the mount unwired. One continuous drive,
`composer-effort-menu.spec.ts`'s shape and fake-daemon templates: push a `model_list` with two invented
rows (the session's model refusing `auto`, a second row accepting it — so the flag is read per row, not
per list); push `thinking` → `idle` to trigger the run-config re-fetch that turn-end edge causes; open the
panel and assert **exactly** the four remaining display names, in order, with no `Auto` item — *and*, as a
baseline taken **before** any list arrives, that all five show (an implementation that hid `auto`
unconditionally would otherwise pass the rest of the drive); then push a replacement `model_list` where the
same row now accepts `auto`, reopen, and assert five again — proving the join is live per row rather than a
constant.

See [PR #1025](https://github.com/pyrycode/pyrycode-desktop/pull/1025) and
`docs/specs/architecture/682-composer-permission-mode-menu.md` for #682's full plan, its security review,
and its `## Revisions` entry recording the three open questions resolved during implementation. See
`docs/specs/architecture/1022-hide-auto-permission-mode-on-refusing-model.md` for #1022's plan and its own
`## Revisions` entries, including the measured ~30% overage against the 800-line ceiling — the third
instance in this footer-control family, attributed there to the prose cost of correcting a merged header's
own load-bearing argument rather than to new behaviour.
