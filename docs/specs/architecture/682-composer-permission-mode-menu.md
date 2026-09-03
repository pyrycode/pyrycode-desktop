# #682 — the composer footer's permission-mode menu

The input footer's second control, between the Actions menu (#680) and the model trigger (#988). It names
the permission mode the daemon reports for the session and lets the operator change it. It invents no
wire, no store and no panel: #1020 carries the mode inbound, #1021 teaches a settings change to name one
outbound, and #838/#839/#840 own the panel. This slice is the wiring plus three renderings.

## Size — one line of the boundary is exceeded, deliberately

Re-counted against this written plan: **2** production source files (`ComposerPermissionModeMenu.tsx` new,
`ConversationScreen.tsx` for the mount; `conversation.css` is not a source file), **3** new exported types
or components, **5** acceptance criteria, **0** reject branches — all inside the `size:s` boundary. Total
written work lands at roughly **1200 lines**, over the 800 ceiling, and the consumer-edit count is 11 (one
production mount plus ten counted assertions across three test files, enumerated under *The cascade*).

It is built as one ticket anyway, because the floor rule outranks the ceiling here and there is no seam to
cut on. Every one of those ten assertion edits exists *because the control exists*; a child carrying them
would have exactly one consumer — its sibling — and could not be verified on its own. The refiner measured
the same thing and said so: the two nearest analogues, #988 (1380 lines) and #989 (1362 lines), both landed
over the ceiling and both landed clean, and this one reads no list frame so it is the smaller of the three.
The overage is stated rather than engineered away by cutting the e2e tier or the six-mode label coverage.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/renderer/src/screens/conversation/ComposerEffortMenu.tsx` → `composerEffortMenuModel`, `ComposerEffortMenuView`, `ComposerEffortMenu` | The template, one button to the right — the model/view/container split this file reproduces. |
| `src/renderer/src/screens/conversation/ComposerModelMenu.tsx` → `ComposerModelMenuView` | The same shape with a looked-up label; the second half of the precedent. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx` → `ComposerOptionsPanelOption`, `ComposerOptionsMenu` | The shared surface. Its docblock on `ComposerOptionsPanelOption` **names this ticket**: the `id`/`label` split exists because "#682's permission menu shows `Accept edits` for `acceptEdits`". That settles the display question below. |
| `src/renderer/src/store/runSettingsWriteStore.ts` → `selectEffectiveSettings`, `SettingsChange` | The `permissionMode` arm (#1021) and the overlay composition that meets AC3/AC4 structurally. Its `CONSUMER NOTE (#682)` warns the displayed value can be `bypassPermissions`, which a write would be refused for. |
| `src/renderer/src/store/runConfigStore.ts` → `RunConfigSnapshot.permissionMode` | The daemon-reported base; `''` is the real "no session was resolved" reading, and is AC1's draw-nothing arm. |
| `src/renderer/src/screens/conversation/runSettingsControls.ts` → `changeSetting`, `isAddressableSessionId` | The session-id gate the container submits through — no new gate is added here. |
| `src/renderer/src/screens/conversation/runConfigSnapshot.ts` → `toRunConfigSnapshot` | Carries the mode verbatim. Its test notes that "what to DISPLAY for an unknown mode belongs to #682". |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Composer`'s `.composer__footer` | The mount slot #680/#988/#989 left open between Actions and the model menu. |
| `src/renderer/src/screens/conversation/conversation.css` → `.composer__footer-button`, `.composer__model-label`, `.composer__effort-label`, `.composer__actions-icon` | The shared button rule to ride; the two label bounds to derive a third from; and the standing fourth-glyph lift note addressed under *Declined scope* below. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the two footer mount tests | Both seed `permissionMode: 'default'` and assert the row holds exactly **one** anchor and **one** `aria-haspopup`. This control is operable whenever a mode is known, so both counts move to 2 — see *The cascade*. |
| `e2e/composer-effort-menu.spec.ts`, `e2e/composer-model-menu.spec.ts` | The fake-tier drive template, and four more counted footer assertions in the same cascade. |
| `e2e/real-daemon-session-settings.spec.ts` | AC5's template, and the source of its honest limit: `confirmed` outlives a sheet unmount, so a re-read is not provably snapshot-sourced. |
| `docs/knowledge/features/composer-effort-menu.md` § Testing | Two measured e2e lessons: the row-geometry detector, and that one `model_list` frame un-inerts both sibling menus at once. |
| `docs/knowledge/features/composer-model-menu.md`, `.../run-settings-write-store.md` | Prior-ticket lessons for this area. |

Codegraph was unavailable in this worktree (`CodeGraph not initialized for this project`), so the reading
list above was built with `Grep`/`Read`. Worth re-running `codegraph init` on the canonical checkout.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=115-3678

The trigger is one instance of `Input footer button`, identical to the three siblings: a bare inline row —
a word in M3 body/small at `schemes/primary`, a 4px gap, then the 8×4 `chevron-up-solid-full` glyph. No
border, no fill, no padding. The node draws the word **`Auto`** — capitalised, i.e. a *display* name for
the machine value `auto`, which is the second half of the evidence for the label mapping below. The panel
it opens is the shared surface at `121:3879`, which draws exactly five option rows; its geometry, colours,
upward placement, dismissal and keyboard handling are #838/#839/#840's and no prop is added to it.

## Context

The wire contract is asymmetric and that asymmetry is the whole design: the read half reports **six**
modes (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`), the write half accepts
**five** — `bypassPermissions` is refused on `permission_mode` so the escalation keeps exactly one
spelling on the wire, the `yolo` bit the run-configuration sheet's toggle already owns. So this control
**offers five entries and renders six labels**, and nothing here can move a session *into* bypass.

No ADR is warranted: every decision here is local to one control and is recorded in this plan.

### The label: a client-owned display map with a verbatim fallback

The ticket body says the label "is daemon-authored text and gets the effort label's treatment". The panel's
own shipped docblock says this menu "shows `Accept edits` for `acceptEdits`". Figma draws `Auto`. All three
are satisfied by one design, and it is not the effort menu's:

- Six known modes map to a **client-owned display name** through a frozen module-level record.
- Any other string the daemon reports falls through **verbatim** — the reading `toRunConfigSnapshot`'s test
  assigns here.
- Because the fallback arm exists, the label element is treated as a daemon-text sink *unconditionally*:
  its own element, its own `max-width` with ellipsis, exactly one JSX text position, never an attribute, a
  URL, a lookup path or a log. That is the treatment the ticket body asks for.

This is where the control departs from `ComposerEffortMenu`, whose docblock declines relabelling because
"claude's own control displays these levels lowercase and byte-identical to the machine values". Permission
modes are camelCase machine identifiers, not display strings; there *is* a display convention to reproduce,
and the shared panel's `id`/`label` split was introduced for exactly this consumer.

## Design

One new file, `src/renderer/src/screens/conversation/ComposerPermissionModeMenu.tsx`, in the
`ComposerModelMenu.tsx` / `ComposerEffortMenu.tsx` shape: a pure decision function, a pure view, a
store-bound container. Its own file rather than `ConversationScreen.tsx` (~2700 lines, a declared merge
hot-spot), and it adds no CSS import — `conversation.css`'s single importer is `ConversationScreen.tsx`.

### Module-level constants

- `PERMISSION_MODE_LABELS` — a `Readonly<Record<string, string>>` over the six modes. Read through a
  `Object.prototype.hasOwnProperty.call` / `??`-guarded lookup so a hostile `__proto__`-shaped mode string
  cannot borrow an inherited property (see *Security review* § 1).
- `SETTABLE_PERMISSION_MODES` — the five, as a `readonly string[]` in the daemon's declared order
  (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`). `bypassPermissions` is deliberately absent, and its
  absence is what AC2 asserts.
- `COMPOSER_PERMISSION_MODE_MENU_LABEL = 'Permission mode'` — the **panel's** accessible name and a
  client-owned constant, never the trigger's visible text. The trigger carries no `aria-label`, so its
  accessible name stays its visible text (WCAG 2.5.3 label-in-name), which is also what the e2e locators
  match.
- `CHEVRON_PATH` — module-private, the siblings' 8×4 glyph duplicated at its use site, per the idiom each
  of the three sibling files states. Points up, does not flip on open (reading the panel's `open` flag
  would mean a new prop on a shared surface).

### `composerPermissionModeMenuModel(permissionMode: string): ComposerPermissionModeMenuModel | null`

`ComposerPermissionModeMenuModel` is `{ label: string; options: readonly ComposerOptionsPanelOption[];
currentId: string }`.

**Two renderings, not three** — and that is this control's structural departure from both siblings:

| input | result |
|---|---|
| `permissionMode === ''` | `null` — no mode is known, draw nothing (AC1's second half) |
| any other string | the menu, always with the same five entries |

The siblings' third rendering — an inert label with no popup — **cannot exist here**, because the entries
are a client-owned constant rather than a daemon-published list: there is never "nothing to offer". No
empty-options arm, no `publishedRowFor` lookup, no list frame, and no model-list store read at all. The
control is therefore operable the instant a snapshot exists, which is what drives *The cascade* below.

`currentId` is the session's own mode verbatim, including `bypassPermissions`. Matching no option marks
nothing through the panel's existing `option.id === currentId` branch — no special case, and no reason to
withhold the menu: AC2 says a session in bypass is still offered the five.

`options` are `{ id: <machine value>, label: <display name> }`, so `onSelect(id)` submits the machine value
with no reverse lookup and `aria-current` matches on the id rather than the display string.

### `ComposerPermissionModeMenuView`

Props in, markup out — no store read, no `window.pyry`, no state, so it server-renders under the repo's
`node` vitest environment. Signature: `{ permissionMode: string; onSelect: (mode: string) => void }`.
Returns `null` for the unknown-mode arm, otherwise a `ComposerOptionsMenu` with
`triggerClassName="composer__footer-button composer__permission"`, `ariaLabel` the client-owned constant,
`triggerContent` a `<span className="composer__permission-label">` plus an `aria-hidden` chevron.

### `ComposerPermissionModeMenu`

The container, a leaf so a snapshot tick re-renders this control rather than the textarea beside it. It
reads three store slices — `sessionIdStore`, `runConfigStore.snapshot`, and the **raw**
`runSettingsWriteStore` state (not `selectEffectiveSettings` as the zustand selector: it returns a fresh
object every call and would re-render on every tick) — and composes them with `selectEffectiveSettings` in
the render body. Unlike the siblings it takes **no `conversationId` prop and reads no model-list slice**:
its entries come from no frame.

`onSelect` is an arrow so `window.pyry` is dereferenced at interaction time and never during render, and
it forwards to `changeSetting({ field: 'permissionMode', value })`. The no-addressable-session-id gate is
`changeSetting`'s own, not a withheld handler — the siblings' settled reasoning, and here there is no
second condition to fuse it with at all.

### The mount

One line in `ConversationScreen.tsx`'s `.composer__footer`, between `ComposerActionsMenu` and
`ComposerModelMenu`, plus the import. The stale forward-references in that block's comment (which promise a
control "sequenced behind" the two menus) are corrected in the same edit.

### CSS — three rules

`.composer__permission { cursor: pointer }` (the operable half; there is no inert arm, so unlike the
siblings this class is worn unconditionally), `.composer__permission-icon { flex: 0 0 auto }`, and
`.composer__permission-label { min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis }`.

The 120px is **derived, not copied**: #988 measured the 13-character context reading at 82.5px, i.e.
~6.35px per character at 12px body-small, so the longest client-owned display name (`Bypass permissions`,
18 characters) draws at ~114px and 120 clears it without ellipsizing a security posture. It also bounds the
verbatim fallback for an unknown daemon-reported mode, which is the reason the declaration is required at
all rather than merely tidy: an unbounded string in a row with a hard 20px height beside a nowrap reading
is a layout-level denial of that reading, remotely triggerable.

**This control does take the row past its budget, and that is stated rather than fixed here.** At the app's
800px minimum the conversation pane is 400px, less two `--space-4` paddings = 368px, less four `--space-5`
gaps = 288px for five items; realistic content (Actions ~56px, this control ~56px at `Default`, a model
display name ~75px, `medium` ~62px, the reading 82.5px) totals ~331px. `.composer__effort-label`'s standing
note predicted exactly this — "#682's fourth control is what takes it to the boundary" — and pre-ruled the
fix: "a whole-row shrink policy on `.composer__footer`, not a number in a single control's rule". That
policy is out of scope here; retuning `.composer__model-label`'s 120px to buy room would be the same thing
by another name. Recorded as an open question and carried to the PR.

## Declined scope

`.composer__actions-icon` carries a standing note assigning this ticket two lifts: collapsing the three
identical `flex: 0 0 auto` glyph rules into one shared class, and lifting the duplicated `CHEVRON_PATH`
const out of three `.tsx` files. **Both are declined**, and the note is corrected in place rather than left
naming a ticket that landed without doing them.

The note's premise is that "#682 re-classes its own element anyway". It does not — this ticket *adds* an
element; the lift would re-class three **shipped** ones and move five assertions across three test files
that are otherwise untouched here. That is fan-out outside a slice whose subject is a menu, squarely inside
CLAUDE.md's don't-refactor-adjacent-code rule, and it compounds a cross-file assertion cascade this slice
already carries unavoidably (below). The honest finding, which the corrected note records: the lift keeps
being declined because every footer ticket that meets it is already at or over its own size budget, so it
belongs to a standalone tidy-up rather than to the next control in the row.

Two further standing notes are **stale and deliberately not acted on**: `modelListStore.ts` and its test
say "#682 reads `supports_auto_mode` per row" and "greys the mode out from it". The refined ticket parks
that on #1022 (the shared panel has no unavailable-row treatment and Figma draws none, so building one
would mean inventing a visual *and* adding a prop to a surface four consumers share). This menu therefore
offers `auto` unconditionally and reads no model list at all.

## The cascade — assertions this control moves

Because the control is operable whenever a mode is known, it adds a second anchor and a second
`aria-haspopup` to a row whose count several shipped assertions pin at one. These are regressions this
change causes and are fixed in the same commit, not pre-existing failures:

- `ConversationScreen.test.tsx` — the model mount test and the effort mount test both seed
  `permissionMode: 'default'`; their `toBe(1)` anchor and popup counts become `2`.
- `ConversationScreen.test.tsx` — the bare-tree overflow test is **unaffected** (no snapshot ⇒ this control
  renders nothing); its explanatory comment gains this control.
- `e2e/composer-model-menu.spec.ts` — two counted footer assertions, `1` → `2`.
- `e2e/composer-effort-menu.spec.ts` — four counted footer assertions: `1` → `2`, `3` → `4`, `2` → `3`
  (twice).
- `e2e/composer-options-clamp.spec.ts` — **unaffected**: its anchor locator is narrowed by
  `has: actionsTrigger(page)`.

## State + concurrency model

No new store, no new slice, no new async work, and nothing to cancel. The control is a pure reader of
three existing stores plus one synchronous dispatch on click; every subscription is zustand's own and is
torn down with the component. The optimistic overlay, its rollback and the reconnect-strands-a-pending
case are all `runSettingsWriteStore`'s, already shipped and already tested.

## Error handling

There is no new failure mode to classify. A rejected change is `runSettingsWriteStore`'s
`settingsRejected` arm dropping the pending marker, after which `selectEffectiveSettings` falls through to
the confirmed override or the daemon's snapshot — that fall-through **is** AC4, with no code here. The
footer deliberately surfaces nothing further: the daemon answers every rejection with one fixed constant,
the row has a hard 20px height with no slot for an error line, and the revert is the operator-visible
signal (the ticket's own ruling, with the visible-refusal question parked on #1022).

## Testing strategy

**vitest, `ComposerPermissionModeMenu.test.tsx`** — the decision as data, then the markup. `onSelect` is
not exercised: a static render fires no events.

- `composerPermissionModeMenuModel`: `null` for `''`; exactly five options in the daemon's order with
  `id` = machine value and `label` = display name; `bypassPermissions` never an option (asserted as a
  derivation over the returned ids, plus a count, so the guard cannot pass vacuously); all six modes label
  correctly; an unknown mode labels verbatim, still offers five, and marks none; a session in bypass labels
  `Bypass permissions`, still offers five, and marks none.
- `ComposerPermissionModeMenuView`: renders inside a `composer-options-anchor`, closed; the label in its own
  bounded element; the chevron `aria-hidden`; the panel named by the client-owned constant; `null` for `''`;
  the five options fed to the shared panel with the current one marked. Plus an attribute sweep — a hostile
  unknown mode string rendered and confirmed to reach no attribute position.

**vitest, `ConversationScreen.test.tsx`** — a new mount test, seeding a snapshot with a non-empty
`permissionMode`, `model` and `effort` so all four controls draw at once and the row's **order** can be
pinned (Actions → permission → model → effort → reading). This is the only proof the control is wired in:
every assertion in its own file passes on an unmounted component. The two existing mount tests' counts are
corrected here.

**Playwright fake tier, `e2e/composer-permission-mode-menu.spec.ts`** — one launch, one continuous drive,
the effort spec's shape. It pushes only frames the daemon really sends (`turn_state`, and
`session_settings` *as a reply* to the app's own request):

1. Nothing rendered before a snapshot exists.
2. A `thinking → idle` turn-end edge; the fake answers the resulting `request_session_settings` with
   `bypassPermissions`. The label reads `Bypass permissions`, the control is **operable**, the panel offers
   exactly the five display names and marks **none** — AC2's bypass half, driven first because a later
   confirmed pick would mask the snapshot.
3. A second turn-end edge answered with `default`: the label follows the daemon, and `Default` is marked.
4. Pick a different mode: the label moves at once, and exactly one `set_session_settings` goes out carrying
   only `{ session_id, permission_mode }` — a deep equal, so any extra key leaves the match count at 0.
5. Pick again; the fake withholds the reply; the body pushes a correlated `error` addressed by the envelope
   id read off the capture. The label returns to the **confirmed** mode, and the footer grows no
   `role="alert"`.
6. Row geometry with four controls drawn and the panel open: `.composer__footer` still 20px tall and
   `document.body.scrollWidth <= clientWidth`.
7. The footer anchor count moves 1 → 2 and stays there with no `model_list` ever pushed — the proof this
   control needs no list frame.

**Playwright real-claude tier, `e2e/real-claude-permission-mode.spec.ts`** (AC5) — pair against a real
`pyry` with a real claude child, create a conversation through the UI, run one turn so a session resolves
and the turn-end edge fetches a real snapshot. Read the baseline mode **off the button** rather than
assuming one, pick a different settable mode, then drive a further turn-end edge so a **fresh**
`request_session_settings` is answered by the real daemon, and assert the button still names the picked
mode and never the baseline.

Its honest limit, stated in the spec header rather than papered over: `confirmed` is an app-level override
that survives the re-read, so the post-change label is not *provably* snapshot-sourced — the same caveat
`real-daemon-session-settings.spec.ts` records for its own reopen. What the drive does prove is the failure
this tier exists to catch (the #949 shape): a daemon that has no handler for `permission_mode`, or refuses
the value, answers with an error, the store drops the pending marker, and the label rolls back to the
baseline — which fails the spec. This ticket carries `needs-real-claude`, so the tier is the operator's
`npm run e2e:real:gate` run, not this run's.

## Open questions

1. **Display names.** Six client-owned strings are minted here (`Default`, `Accept edits`, `Plan`, `Auto`,
   `Don't ask`, `Bypass permissions`). Figma pins only `Auto`. To be resolved during implementation by
   keeping every name a faithful rendering of its machine value — no abbreviation of `bypassPermissions`,
   which is the one that would tempt a shortening for row width.
2. **Row width at the 800px minimum.** The arithmetic above says five controls plus realistic content
   exceed the row. Resolve by confirming the e2e geometry detector still passes with real display names,
   and by carrying the finding to the PR rather than fixing it here.
3. **Panel accessible name.** `Permission mode` is minted (the run-configuration sheet has no permission
   section to borrow a heading from). Resolve by checking no sibling constant collides.

## Security review

**Verdict:** PASS

**Findings:**

**1. Trust boundaries — one boundary, and it is a render boundary.** `permissionMode` crosses from the
daemon into the renderer as already-typed text through `runConfigSnapshot` → `runConfigStore`; the decode
and IPC boundaries are #1020's and are not reopened. Decoded is **not** sanitized: #1020 made the shape
trusted and nothing more. This control is where that string is rendered, and the whole obligation is
discharged in one place — `PERMISSION_MODE_LABELS[mode] ?? mode` reaching exactly one JSX text position,
where React escapes it. It reaches four non-sink places, all the shared panel's (`key={option.id}`, the
`=== currentId` comparison, the `onSelect` pass-through, an array index) — and for the *entries* those are
all client-owned constants anyway.

*MUST FIX, folded into the design above:* the display lookup is a **plain-object read keyed by a
daemon-controlled string**. `PERMISSION_MODE_LABELS['constructor']` returns a function and `['__proto__']`
returns an object; neither is `undefined`, so a `?? mode` fallback does **not** catch them and a non-string
reaches a JSX child position, where React throws — a remotely triggerable crash of the conversation screen
from one field of one daemon frame. The plan therefore specifies an own-property-guarded read
(`Object.prototype.hasOwnProperty.call` before the lookup, or a `Map`), never a bare index, and a test
drives `__proto__`, `constructor` and `toString` as modes. The write direction is not a hazard: nothing
here ever *assigns* into an object under a wire-derived key.

**2. Tokens, secrets, credentials — not applicable, and structurally so.** This control reads three
renderer stores and submits one settings change. No token, key or credential is read, stored, minted or
logged; the session id it forwards is a non-secret routing id already held by `sessionIdStore` and already
sent on every settings write. Nothing on this path logs at all, which is also the answer to category 7.

**3. File / storage operations — not applicable.** No filesystem access, no `safeStorage`, no path is
constructed from anything, and the mode string is never used as a filename, a cache key or a lookup path.

**4. Inter-process / Electron attack surface — no new surface.** No `contextBridge` API, no `ipcMain`
channel and no `webPreferences` change. `window.pyry.sendCommand` is the existing bridge, reached through
`changeSetting` → `submitSettingsChange`, whose renderer→main payload guard #1021 already widened and
tested. The dereference is inside an arrow so it never runs during render.

**5. Cryptographic primitives — not applicable.** No randomness, no comparison against a secret, no
handshake. The correlation `changeId` is minted by `submitSettingsChange` (`crypto.randomUUID()`), not
here.

**6. Network & I/O — one frame, already bounded.** The only outbound effect is a single
`set_session_settings` carrying `{ session_id, permission_mode }`. `buildSettingsPayload`'s single-key
literal is what keeps `permission_mode` and `yolo` off one frame; no new socket, no timeout, no reconnect
logic.

*Threat considered and rejected as a finding:* a click could be spammed to flood the relay. The panel closes
on select and each change is a small correlated frame; `runSettingsWriteStore` already keys pending changes
by `changeId` with last-write-wins, and no rate limit exists for the three sibling controls that submit
through the identical path. Adding one here would be a defence against an unobserved failure mode, on one
control out of four.

**7. Error messages, logs, telemetry — nothing is logged, deliberately.** A useful log line here would
carry the daemon-reported mode into a log, which ADR 0007's content-free rule and CLAUDE.md both forbid.
The rejection path surfaces no daemon text: `sessionSettingsRejected` strips the message upstream (#269),
and this footer renders no error at all.

**8. Concurrency — no async work.** No promise, no timer, no listener, no `AbortController`, nothing to
cancel: every subscription is zustand's and unmounts with the component. The one check-then-act shape in
range is `changeSetting`'s session-id gate, which is synchronous with no `await` in the critical section.

**9. Threat model alignment.**
- *Hostile / compromised relay:* on-path but content-blind; it can drop or delay a settings reply. A
  dropped reply strands one pending marker, which `reconnected` clears on the next re-dial (#539). No new
  exposure.
- *Hostile daemon response:* the mode string is the attack surface, and category 1 is its whole treatment —
  escaped at one text position, own-property-guarded on lookup, and length-bounded by
  `.composer__permission-label`'s `max-width` so an oversized value cannot deny the row.
- *Renderer compromise reaching the transport:* unchanged. This control holds no key and no socket, and can
  only send a payload shape the main-process guard already validates.
- *Privilege escalation through this control:* named explicitly because it is the reason for the label.
  `bypassPermissions` is **not** an entry, so no click sequence in this menu can move a session into
  bypass; the run-configuration sheet's `yolo` toggle keeps that spelling to itself. A future contributor
  adding the sixth mode "for symmetry" would be adding a one-click privilege escalation to the footer, and
  the design records that in the constant's own comment and asserts it in two tests.

**OUT OF SCOPE:** greying out `auto` when the running model does not support it, and a visible refusal —
both parked on **#1022**, both blocked on a design answer (the shared panel has no unavailable-row
treatment and the footer has no error affordance) rather than on code.
