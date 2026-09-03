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

- **Its entries are a client-owned constant, not a daemon-published list.** The model and effort menus each
  read `model_list` and have a third rendering — an inert label that opens nothing — for the three ways
  that list can be missing. Nobody publishes the set of settable permission modes to this client, so there
  is no list frame to read, no empty-list arm, no `publishedRowFor` lookup, and no model-list store read at
  all. There is never "nothing to offer": every mode that renders at all renders an **operable** trigger.
  This is **two renderings, not three** — `permissionMode === ''` draws nothing (no run-config snapshot has
  arrived yet, or the session was never resolved — one string, two readings, both meaning this control has
  nothing true to say), and any other string draws the same five entries every time, including the bypass
  reading, which gets no branch of its own.
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
JSX text position and never an attribute.

The unrecognized-mode fallthrough is the same posture `runConfigSnapshot.ts`'s own test assigns to this
ticket ("what to display for an unknown mode belongs to #682"), and it is why the label element is treated
as a daemon-text sink unconditionally even though five of its six values are client-owned strings.

## The trigger, the container, and the write

`ComposerPermissionModeMenuView({ permissionMode, onSelect })` is a pure view — no store read, no
`window.pyry`, no state — so it server-renders under this repo's `node` vitest environment like its two
neighbours. It returns `null` on the empty-mode arm, otherwise a `ComposerOptionsMenu` with
`triggerClassName="composer__footer-button composer__permission"`, a client-owned `ariaLabel` naming the
**panel** (`COMPOSER_PERMISSION_MODE_MENU_LABEL = 'Permission mode'` — the trigger itself carries no
`aria-label`, so its accessible name stays its visible text), and the sibling triggers' `chevron-up-solid-full`
glyph, duplicated at its own use site rather than shared (see § CSS below).

`ComposerPermissionModeMenu()`, the container, takes **no props** — the visible half of reading no
per-conversation model list, where both neighbours take `conversationId` solely to select one. It reads
`sessionIdStore`, `runConfigStore.snapshot`, and the **raw** `runSettingsWriteStore` state (not the
`selectEffectiveSettings` selector — that returns a fresh object every call and would re-render on every
store tick), composing them with `selectEffectiveSettings` in the render body. `onSelect` is an arrow so
`window.pyry` is dereferenced at interaction time and never during render, and forwards to
`changeSetting({ field: 'permissionMode', value })` — the mode's own machine value, submitted with no
reverse lookup.

AC3 ("sends nothing when there is no addressable session id") is `changeSetting`'s own gate, not a withheld
handler: this view has no operability branch to fuse the gate with, unlike the run-configuration sheet.
AC3's optimistic move and AC4's rollback-on-rejection are both `selectEffectiveSettings`'s
pending-over-confirmed-over-snapshot composition, with no code of this ticket's own — the same composition
the model and effort triggers read through.

## CSS: a fourth footer-button consumer, and the fourth-glyph lift declined again

The trigger rides the shared [`.composer__footer-button`](composer-model-menu.md) treatment #988 extracted;
nothing about that rule is re-forked here. Three new declarations:

- **`.composer__permission { cursor: pointer }`** — worn **unconditionally**, unlike its two neighbours'
  per-consumer `cursor: pointer`, which only exists to keep their *inert* arm from lying about being
  clickable. This control has no inert arm, so there is nothing for the declaration to disagree with.
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
privilege escalation to the footer.

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
pushed — the proof this control needs no list frame. `e2e/real-claude-permission-mode.spec.ts` (AC5) pairs
against a real daemon, reads the baseline mode off the button rather than assuming one, picks a different
settable mode, and drives a fresh turn-end edge to confirm a **re-read** snapshot still names the picked
mode — carrying the same honest limit `real-daemon-session-settings.spec.ts` already records: the app-level
`confirmed` override survives the reopen, so the post-change label is not *provably* snapshot-sourced. This
ticket carries `needs-real-claude`; the tier runs under the operator's `npm run e2e:real:gate`, not in CI.

See [PR #1025](https://github.com/pyrycode/pyrycode-desktop/pull/1025) and
`docs/specs/architecture/682-composer-permission-mode-menu.md` for the full plan, its security review, and
its `## Revisions` entry recording the three open questions resolved during implementation.
