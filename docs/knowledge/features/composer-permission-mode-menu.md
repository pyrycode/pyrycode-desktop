# Composer permission-mode menu (#682)

The footer's second live control, between [the Actions menu](conversation-shell-actions-menu-and-reader-cutover.md#actions-menu-680)
and [the model menu](composer-model-menu.md) (Figma `115:3678`). Part of
[Conversation shell — composer](conversation-shell-composer-message-box.md#composer-footer-row-811); see that
document's footer-row section for the row's geometry and no-placeholder rule.

It assembles rather than invents: the panel is [#838/#839/#840's](conversation-shell-composer-options-panel.md),
the inbound mode is #1020's ([Session settings — permission mode read](conversation-shell-workspace-and-run-config.md)),
the outbound field is #1021's, and the model overlay composition is #256's. This ticket adds the entries, the
trigger's label, and what picking one does — the same three things [the model](composer-model-menu.md) and
[effort](composer-effort-menu.md) menus added on either side of it, `ComposerModelMenu.tsx`'s three-part
shape (pure model function, pure view, thin store-bound container) reused a third time, in its own file
(`ComposerPermissionModeMenu.tsx`).

## Selecting bypass

All six known modes are selectable as of 2026-09-20.
Juhana requested that Bypass approvals remain available after choosing another mode.
The earlier display-only restriction no longer applies.
The daemon still refuses `bypassPermissions` on `permission_mode`.
Selecting Bypass approvals sends the existing `yolo: true` setting instead.
Other choices send their own `permission_mode` value.
Each write contains only one changed field.

The footer shares the settings sheet's bypass control.
The label and current menu row change only after a fresh settings report confirms the applied mode.
Pending, acknowledged or rejected writes cannot replace that confirmed reading.

## Where this control departs from its two neighbours

The three footer menus look interchangeable but differ in two load-bearing ways:

- **Its vocabulary is client-owned, and only one entry of it is conditional.** The model and effort menus
  each read `model_list` and have a third rendering — an inert label that opens nothing — for the three
  ways that list can be missing. Nobody publishes the set of settable permission modes to this client, so
  there is no list frame to *wait for* and no empty-list arm: a known mode has five or six choices
  whenever the session is addressable and its owning host is connected. That stayed true when
  [#1022](https://github.com/pyrycode/pyrycode-desktop/issues/1022) gave this control a
  `publishedRowFor` lookup and a model-list store read — see § The `auto`-hiding join below — because the
  read only ever *subtracts* one named entry from the constant; it never grows or replaces the list. This
  gives the pure model function **two outcomes** — `permissionMode === ''` returns nothing (no snapshot
  has arrived, the session was never resolved, or running confirmation is unavailable), and any other string returns five or six entries,
  including the bypass reading,
  which gets no branch of its own. The view holds the label inert when selection is unavailable.
- **Its label is looked up, not verbatim.** Claude publishes effort levels byte-identical to what it
  accepts, so the effort trigger relabels nothing. Permission modes arrive as camelCase machine identifiers
  (`acceptEdits`); the trigger displays `Auto-approve edits`, and the shared panel's `id`/`label`
  split — [`ComposerOptionsPanelOption`](conversation-shell-composer-options-panel.md) — exists for exactly
  this consumer, which its own docblock names.

Because a missing model list does not make this control inert, it can be operable while the model and
effort menus wear `.composer__footer-button` on an inert `<span>` waiting for their list. Host/session
availability still gates all three controls. That is what moves the footer's anchor and `aria-haspopup`
counts: this control adds a second one to a row four unit assertions (`ConversationScreen.test.tsx`) and
six e2e assertions (`composer-model-menu.spec.ts`, `composer-effort-menu.spec.ts`) had pinned at one. Each
count moved by exactly one — the steps *between* them, which isolate each sibling control, are unchanged.

## The `auto`-hiding join (#1022)

`WireModelOption.supports_auto_mode` says whether claude accepts `auto` permission mode for the running
model — it refuses per model (Haiku 4.5 does not have it, Sonnet 5 does, measured 2026-08-21). #682 shipped
this menu offering all five then-settable modes unconditionally and parked the flag, because the shared options
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
  unconditional and cannot be hidden, and no row can add an entry. The hide is a UX
  affordance, never an authorization boundary: the daemon is the actual enforcement point, refusing a mode
  it does not accept. A rejected permission pick leaves the confirmed label intact.
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
- **This menu still calls `publishedRowFor` directly, and #1168 is why it must.** That ticket gave the
  model and effort menus a separate wrapper, `effortRowFor`, that resolves an empty session model — the
  wire's inherited daemon default, not an absence — onto the row the daemon publishes for that default.
  Joining through the same wrapper here would resolve that row too, and a row reporting
  `supports_auto_mode: false` would then hide `auto` on every chat nobody has set a model on. Missing on
  an empty model is what keeps `auto` offered there, so this control keeps the plain `publishedRowFor`
  miss deliberately — see [Composer effort menu](composer-effort-menu.md#composereffortmenumodel-one-pure-function-deciding-all-three-renderings)
  for the wrapper itself.
- **A session already running `auto` on a refusing model still labels the trigger `Auto approval` and
  marks nothing in the panel**. `currentId` stays
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

`PERMISSION_MODE_LABELS` supplies the same behaviour-based copy to the trigger and menu:

| Mode value | Display label |
| --- | --- |
| `default` | Manual approval |
| `acceptEdits` | Auto-approve edits |
| `plan` | Plan |
| `auto` | Auto approval |
| `dontAsk` | Approved actions only |
| `bypassPermissions` | Bypass approvals |

These are display names, not changes to permission behaviour. **Manual approval still respects existing
allow rules**; it does not promise a prompt for every action. Selection sends the existing mode value,
and Bypass approvals remains a reported state only in this menu, never a selectable entry. See the
[label-change spec](../../specs/architecture/1546-permission-mode-labels.md).

The mapping is a `Readonly<Record<string, string>>` over the six known modes. It is
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
as a daemon-text sink unconditionally even though all six known labels are client-owned strings.

## The trigger, the container, and the write

`ComposerPermissionModeMenuView({ model, permissionMode, models, onSelect })` is a pure view — no store
read, no `window.pyry`, no state — so it server-renders under this repo's `node` vitest environment like
its two neighbours. It returns `null` on the empty-mode arm, an inert held label when
`onSelect` is absent, otherwise a `ComposerOptionsMenu` with
`triggerClassName="composer__footer-button composer__permission"`, a client-owned `ariaLabel` naming the
**panel** (`COMPOSER_PERMISSION_MODE_MENU_LABEL = 'Permission mode'` — the trigger itself carries no
`aria-label`, so its accessible name stays its visible text), and the sibling triggers' `chevron-up-solid-full`
glyph, duplicated at its own use site rather than shared (see § CSS below). `model`,
`permissionMode` and `models` remain required; `onSelect` is optional for availability.

`ComposerPermissionModeMenu({ conversationId })`, the container, took **no props** until #1022 — the
visible half of reading no per-conversation model list. It now takes `conversationId` the way both
neighbours already do, adding one `useMemo`-stable `selectModelListFor(conversationId)` subscription (a
fresh closure each render would churn it; `conversationId === null` selects `() => null` through the same
path). It reads `sessionIdStore`, `runConfigStore.snapshot`, and the **raw** `runSettingsWriteStore` state
(not the `selectEffectiveSettings` selector — that returns a fresh object every call and would re-render on
every store tick), composing them with `selectEffectiveSettings` in the render body and passing
`effective.model` into the view alongside the held model list. The permission value comes directly
from `runConfigStore.snapshot.permissionMode`. `onSelect` is an arrow so `window.pyry` is
dereferenced at interaction time and never during render, and forwards to
`changeConnectedSetting`. Bypass submits `{ field: 'yolo', value: true }`.
Other modes submit `{ field: 'permissionMode', value }` with their own machine value.

The container supplies the callback only with an addressable session ID and an
unambiguous owning host reporting `connected`. Missing ownership/status and all
non-connected statuses withhold it. The held label remains readable until a context
boundary invalidates confirmation. The chevron and open menu disappear while unavailable.
`changeConnectedSetting` checks current stores
again before any command or optimistic change. Reconnection restores the existing
`auto` capability gate without replaying blocked choices; see
[the shared settings availability contract](conversation-shell-run-configuration.md#run-configuration-modeleffortyolo-sections-188).

The pure model function alone cannot prove container wiring: it still computes
Auto approval choices with no published list. Missing conversation ownership now makes the
mounted view inert instead. `e2e/composer-permission-mode-auto.spec.ts` proves the
live per-model capability filter, while `e2e/offline-session-settings.spec.ts`
proves host availability through mouse/keyboard actions and outbound commands.

## Permission mode

The footer label and current selection use the latest applicable settings report.
Stored intent, pending picks and acknowledged writes never override that report.
Model and effort still use their existing write overlays.
The model overlay also supplies this menu's Auto capability check.

An empty reported mode hides the control, including on a resolved session with false yolo.
Neither the boolean nor initialization facts supply a fallback.
Operator bypass can coexist with stored default.
A default-only pick can therefore acknowledge without changing the running child.
The footer keeps Bypass approvals until the daemon reports a different mode.

After a permission-mode write or bypass-enable acknowledgement, `subscribeConfirmedRunConfig` refreshes immediately.
It checks again every 500ms for at most 15 seconds, waiting for each outstanding reply.
An early reply with the old mode keeps that label and leaves confirmation pending.
A rejection refreshes once while preserving any earlier acknowledged change's
outstanding read and original deadline.
Timeout retains the latest report and records only a static diagnostic code.

Conversation or owning-host changes, owning-host reconnects, resets and session
replacement invalidate permission confirmation.
The control stays hidden until a report for the current context arrives.
Reset suppresses reports until completion, even if replacement arrives first.
The replacement session identity remains guarded after reset completion.
Main also discards superseded requests and reads started before reset or replacement.

## CSS: a fourth footer-button consumer, and the fourth-glyph lift declined again

The trigger rides the shared [`.composer__footer-button`](composer-model-menu.md) treatment #988 extracted;
nothing about that rule is re-forked here. Three new declarations:

- **`.composer__permission { cursor: pointer }`** — worn only by the operable
  trigger. The unavailable span keeps `.composer__footer-button` without this
  class, so a readable held label does not claim to be clickable.
- **`.composer__permission-label { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis }`**
  — its own rule rather than reusing `.composer__model-label`'s identical bound, since each footer e2e spec
  locates its own label class bare (a second wearer breaks Playwright strict mode). The 120px bound is
  unchanged by the label rename; `Approved actions only` (`dontAsk`, 21 characters) is now the longest
  known label. The full text remains in the trigger's accessible name even when visually ellipsized.
- **`.composer__permission-icon { flex: 0 0 auto }`** — `.composer__actions-icon`'s one declaration,
  repeated rather than shared.

The [footer row shrink policy](conversation-shell-composer-message-box.md#footer-row-shrink-policy-1107)
keeps all controls within the 800px minimum window by compressing gaps and ellipsizing labels together.
Full selectable labels fit in the open dropdown. A body-overflow check alone cannot prove the footer
fits inside its clipped pane: `e2e/composer-footer-overflow.spec.ts` seeds the longest permission label
with long model/effort labels and full context usage, then measures the footer's own overflow and controls.

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
string comparison — no plain object is keyed by the raw mode anywhere in this file. The write gate
logs only static availability codes, never mode values, matching [ADR 0007](../decisions/0007-content-free-diagnostics-by-construction.md)'s content-free
rule. The panel's `aria-label` is the client-owned `COMPOSER_PERMISSION_MODE_MENU_LABEL`, never the
trigger's own daemon-authored visible text.

Bypass is an explicit user selection using the existing yolo setting.
Opening the menu never changes permissions.
The model capability filter can remove only Auto approval.
Host availability, session ownership and confirmed reporting remain required.
No daemon validation or wire contract changed.

## Testing

Renderer tests are static server renders (CLAUDE.md); `ComposerPermissionModeMenu.test.tsx` covers
`composerPermissionModeMenuModel` as data (both renderings, all six modes labeled, an unknown mode falling
through verbatim while offering six and marking none, the bypass reading labeling
`Bypass approvals` and marking its own row) and the view against it (the anchor/panel
wiring, the label's own bounded element, the chevron `aria-hidden`, the panel's client-owned name, and the
`__proto__`/`constructor`/`toString` attribute sweep above). `ConversationScreen.test.tsx` gained a new mount
test seeding all three footer menus' snapshot fields at once to pin the row's final order
(Actions → permission → model → effort → reading) — the only proof this control is wired in, since every
assertion in its own file passes on an unmounted component.

Literal expectations pin all six trigger labels and the six selectable ID/label pairs independently
of `PERMISSION_MODE_LABELS`; deriving the expected copy from that mapping would let a wrong label pass.
The permission-menu Playwright spec also pins the six displayed labels literally and checks the open
panel and each row fit at 800px. Keep negative label assertions current too:
`e2e/offline-session-settings.spec.ts` must check absence of `Auto approval` after a refusing model arrives.
An absence check for the former `Auto` label would pass even if the renamed option were incorrectly
offered. The capability drive below supplies the positive baseline that all six choices can appear.

**#1022 extended the model-function cases** rather than adding a typed fixture list: a row for the
session's model saying `false` (the other five ids, no `auto`); every unknown reading — `models` null, an
empty `models` array, a populated list matching no row, a row whose `value` is a superstring of the
session's model (the truncation-cut shape), and `supports_auto_mode` forced to `undefined` through a cast
(the bare-`as` reading) — offering all six; a row saying `true` offering all six; a session running
`auto` on a refusing row still labelling `Auto approval` and marking nothing while offering five; and a floor
assertion across the whole matrix that `options.length` never drops below
`SETTABLE_PERMISSION_MODES.length - 1`. The shipped `view()`/`panel()` test helpers took the two new
inputs as trailing optional parameters defaulting to `(null, '')` — the reading that was this control's
only one before #1022 — so every pre-existing call site reads unchanged and doubles as evidence for the
fail-open rule.

**React escapes text children, including client-owned labels.** The existing `rendered()` helper derives
escaped markup from React for assertions that need it, rather than hand-rolling an escaper. The current
six labels need no apostrophe escaping; unknown modes and future copy can still require it. Playwright
reads DOM text, so its locators match the label verbatim.

`e2e/composer-permission-mode-menu.spec.ts` holds writes and settings replies to prove
pending, acknowledged and rejected picks retain the last report.
It verifies that bypass uses only `yolo: true` and that rejection keeps the previous label.
It covers delayed confirmation, rejection during an earlier confirmation wait,
empty reports on resolved sessions, context changes and reset/replacement ordering.
The store/bridge tests cover the same boundaries and the original retry deadline.

`e2e/real-claude-permission-mode.spec.ts` starts an operator-bypass child with stored
default and checks the correlated report and footer.
An acknowledged default-only pick must leave Bypass approvals intact.
Plan, a return to Bypass approvals, and Manual approval must then be confirmed
within 15 seconds each, without another turn.
The same session must request approval for an outside-workspace Read.
The modal prompt carries the tool name; its title is the generic Permission required.
The test checks conversation identity, Read-only tool activity and a fresh file witness
returned after approval. The witness never appears in the message requesting the read.
An executed result records the daemon revision and each completed proof.
A skipped test is not acceptance.

**`e2e/composer-permission-mode-auto.spec.ts` (new, #1022)** is the AC5 case for the `auto`-hiding join,
and the only proof the container actually passes `conversationId` through — a static render cannot open
the panel, and the pure model function stays green with the mount unwired. One continuous drive,
`composer-effort-menu.spec.ts`'s shape and fake-daemon templates: push a `model_list` with two invented
rows (the session's model refusing `auto`, a second row accepting it — so the flag is read per row, not
per list); push `thinking` → `idle` to trigger the run-config re-fetch that turn-end edge causes; open the
panel and assert **exactly** the five remaining display names, in order, with no `Auto approval` item —
*and*, as a baseline taken **before** any list arrives, that all six show (an implementation that hid `auto`
unconditionally would otherwise pass the rest of the drive); then push a replacement `model_list` where the
same row now accepts `auto`, reopen, and assert six again — proving the join is live per row rather than a
constant.

See [PR #1025](https://github.com/pyrycode/pyrycode-desktop/pull/1025) and
`docs/specs/architecture/682-composer-permission-mode-menu.md` for #682's full plan, its security review,
and its `## Revisions` entry recording the three open questions resolved during implementation. See
`docs/specs/architecture/1022-hide-auto-permission-mode-on-refusing-model.md` for #1022's plan and its own
`## Revisions` entries, including the measured ~30% overage against the 800-line ceiling — the third
instance in this footer-control family, attributed there to the prose cost of correcting a merged header's
own load-bearing argument rather than to new behaviour.
