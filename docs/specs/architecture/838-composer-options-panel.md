# 838 — The composer options panel surface

Ticket: [#838](https://github.com/pyrycode/pyrycode-desktop/issues/838) · size `s` · split from #692.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

A flush-cornered, opaque dark-navy column (`--color-on-primary-fixed`) padded 2px top and bottom, holding
five 28px full-width rows whose body-small labels sit 12px in from the left in `--color-primary`; one row —
the current value — carries a lighter navy fill (`--color-on-primary`). No border, no radius, no shadow, no
icons: the fill contrast is the whole treatment.

## Files to read first

Codegraph is **not indexed for this repo** (`codegraph_context` errors with `CodeGraph not initialized`,
confirmed again 2026-08-27), so this list was built by hand. Read these before writing anything.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2564-2611` | `ThreadOverflowMenuView` — the pure-view posture this panel copies: props in, markup out, `role="menu"`/`role="menuitem"`, and the `{open && …}` seam that lives in the **caller**, not the view. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2050-2102` | `ComposerSendButton` — required-injected-callback rule ("a view that cannot answer is a bug"); the view never touches `window.pyry`. |
| `src/renderer/src/screens/conversation/PermissionModal.tsx:1-30` | The extracted-component file convention: no `import './conversation.css'` (`ConversationScreen.tsx:13` is the single importer), a leading `#ticket:` block comment, exported pure view. |
| `src/renderer/src/screens/conversation/PermissionModal.test.tsx:1-18` | The static-render test harness shape — `renderToStaticMarkup`, no DOM, "one button per option in array order, the default modifier on the matching option, untrusted text escaped". This is the closest sibling to AC4's test. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1128-1132` | **The AC-without-a-detector ruling.** Stylesheet declarations get no vitest proof; the test pins that the class is *on* the element. AC2/AC3/AC5 follow this split — do not invent a measurement path. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1152-1165` | The hostile-string test shape: assert on the escaped run and on `not.toMatch(/\son[a-z]+="/i)`, never a vacuous `not.toContain('src=')`. |
| `src/renderer/src/screens/conversation/conversation.css:2325-2334` | The **no-z-index** comment (#276). Its reasoning is this panel's reasoning; AC5 is that reasoning restated. |
| `src/renderer/src/screens/conversation/conversation.css:2370-2414` | `.conversation__overflow-menu` / `__item` — the row-button reset to copy (`border: none`, `background: transparent`, `font-family: var(--font-sans)`, `cursor: pointer`, `text-align: left`, `:focus-visible` outline). Copy the reset, **not** the visual treatment (see § Not a variant of the overflow menu). |
| `src/renderer/src/screens/conversation/conversation.css:1395-1420` | `.composer__footer` (#811) — the eventual host. Note `height: 20px`: the panel cannot be an in-flow child of it. #839 owns that. |
| `src/renderer/src/screens/conversation/conversation.css:745-755` | **`height: 24px` as a literal rather than `var(--space-6)`: "a component's own height is structural geometry, not spacing".** This settles the 28px row height. Also records that the repo has **no global `box-sizing` reset**. |
| `src/renderer/src/theme/tokens.css:24-42` | Where the new token goes, and the two existing colour comments (`--color-inverse-primary`, `--color-on-primary`) whose provenance format the new one follows. |
| `docs/knowledge/decisions/0003-m3-theme-tokens-css-custom-properties.md` | "No colour/type/spacing/radius literal in a component stylesheet", the off-grid-gets-a-token rule, and its "bare structural geometry is not a theme value" carve-out. |
| `docs/knowledge/features/conversation-shell.md` | The only overview covering `.composer__footer`; read the footer section for what #811 already settled. |

## Context

The input footer (#811) carries the context reading and nothing else. Four controls are queued for it —
#680 Actions, #682 permission mode, #683 model and effort — and #694's slash-command type-ahead opens the
same surface from the message box. Five consumers, one surface. This slice builds the surface so none of
them builds its own; #839 places it, #840 opens it and drives it from the keyboard.

Nothing in the app renders this component when the ticket lands. That is intended, not a gap: the panel has
no host until #839. It is proven by direct server render, exactly as `ThreadOverflowMenuView` and
`PermissionModalView` are.

## Design

### Module

New file `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx`, plus its test alongside.

**Why a new file rather than `ConversationScreen.tsx`.** The ticket's technical note points at the
`ThreadOverflowMenuView` / `ComposerSendButton` *posture*, and that posture is what this spec keeps. The
*location* is a separate call, made here for three reasons: the surface has five named future consumers
across two later tickets, so it wants an addressable module (the `PermissionModal.tsx` /
`WorkspacePickerSheet.tsx` / `BackgroundTaskPanel.tsx` precedent); `ConversationScreen.tsx` is ~2700 lines
and `ConversationScreen.test.tsx` ~3000, and both are merge hot-spots for the concurrent sibling tickets;
and #840 will grow this component with keyboard state, which is a poor fit for the hot file.

Styles still land in `conversation.css` (AC1 names it), and the new file adds **no** CSS import —
`ConversationScreen.tsx:13` is the single importer of that stylesheet and `PermissionModal.tsx` relies on
exactly that.

### Public surface

Three exports. All props are **required** — the injected-callback rule at `ConversationScreen.tsx:2033`.

```ts
export interface ComposerOptionsPanelOption {
  id: string      // stable identity; the wire/model value, not the display string
  label: string   // the visible row text
}

export interface ComposerOptionsPanelProps {
  options: readonly ComposerOptionsPanelOption[]
  currentId: string | null   // the chosen option for a value menu; null for a command list
  onSelect: (id: string) => void
  ariaLabel: string          // the panel's accessible name, supplied by whichever control opened it
}

export function ComposerOptionsPanel(props: ComposerOptionsPanelProps): JSX.Element
```

- **`id` is distinct from `label`** because #683's model menu shows `Opus 5` for `claude-opus-5` and #682's
  permission menu shows `Accept edits` for `acceptEdits`. Matching on the label would force those tickets
  to invent a lookup.
- **`currentId: string | null`, not optional.** `null` is the ticket's "a menu of commands is a list of
  actions rather than a choice: same panel, no row highlighted". A `currentId` that matches no option
  highlights nothing — the same branch, no special case, no throw.
- **Ids are unique by caller contract.** No runtime guard: no such failure has been observed, and a
  duplicate id is a caller bug that the `key` warning already surfaces in dev.
- **No `open` prop, and no trigger.** The trigger belongs to #680/#682/#683, and a view that owns no
  trigger cannot own `aria-expanded`. Mounting *is* opening; a consumer writes
  `{open && <ComposerOptionsPanel … />}`, which is where `ThreadOverflowMenuView` puts the same seam
  (`ConversationScreen.tsx:2597`).
- **No empty-state branch.** Zero options renders a bare 4px surface. Consumers gate on `options.length`;
  #694 owns the "no matches" question.

### Markup contract

The whole render, as a shape — the developer writes the JSX:

```
<div class="composer-options" role="menu" aria-label={ariaLabel}>
  <button type="button" role="menuitem" class="composer-options__item">Ultracode</button>
  <button type="button" role="menuitem"
          class="composer-options__item composer-options__item--current"
          aria-current="true">Max</button>
  …one <button> per option, in array order, key={option.id}
</div>
```

- One row per option, **in array order** — the panel does not sort.
- The current row and only the current row gains `composer-options__item--current` **and**
  `aria-current="true"`. The base class stays on it: a modifier worn without its base is the vacuity this
  repo legislates against (`conversation.css:779-781`, `ConversationScreen.test.tsx:1082`).
- `aria-current` rather than a `menuitemradio` role branch: it is a global ARIA attribute, valid on any
  element, and it means exactly "the current item within a set". Branching the *role* on `currentId` would
  make the same panel two different widgets, which #694 (a type-ahead, not a menu) would then have to
  fight.
- Labels reach the DOM as ordinary React text children — auto-escaped, no `dangerouslySetInnerHTML`, no
  attribute or URL sink. #694 feeds this workspace-authored command names, so this is load-bearing, per
  CLAUDE.md's daemon-text ruling.
- `<button type="button">` gives Enter/Space activation for free; #840 layers roving focus on top.

### Stylesheet

Appended to `conversation.css`. Five rules, in this order — **the order is load-bearing**:

1. `.composer-options` — `display: flex; flex-direction: column; padding: 2px 0; width: max-content;`
   and `background: var(--color-on-primary-fixed)`.
2. `.composer-options__item` — the `.conversation__overflow-item` reset (`display: flex; align-items:
   center; border: none; background: transparent; cursor: pointer; text-align: left;`), plus
   `height: 28px`, `padding: 0 var(--space-3)`, `white-space: nowrap`, `color: var(--color-primary)`,
   `font-family: var(--font-sans)` and the four `--text-body-small-*` tokens.
3. `.composer-options__item--current` — `background: var(--color-on-primary)`.
4. `.composer-options__item:hover` — `background: var(--color-primary-container)`.
5. `.composer-options__item:focus-visible` — `outline: 1px solid var(--color-outline)`.

Rules 3 and 4 have **equal specificity** (0,2,0), so source order decides the hovered-current row. Hover is
declared last and therefore wins, deliberately: a selection marker that swallows hover feedback makes the
current row look untargetable, and AC2 states the hover fill unconditionally ("a hovered row"), not
"a non-current hovered row".

Geometry notes for the developer:

- **`padding: 2px 0` is a literal, not a new spacing token.** ADR 0003's off-grid-gets-a-token rule is real,
  but `gap: 2px` is already an established literal in this exact stylesheet (`conversation.css:2031, 2102,
  2598, 2959`) and in `settings.css:129, 184, 315`. Follow the precedent; do not add `--space-*`.
- **`height: 28px` is a literal, not `var(--space-7)`** (also 28px), per the ruling recorded at
  `conversation.css:753-754`: a component's own height is structural geometry, not spacing.
- With **no global `box-sizing` reset** in this repo (same comment), `padding: 2px 0` on a content-box
  column of five 28px rows gives 4 + 140 = **144px**, the Figma frame height exactly. Keep the panel's
  vertical padding and the row height in different boxes — do not "simplify" the 2px onto the rows.
- **Rows get symmetric `padding: 0 var(--space-3)`, and the right half is an architect call.** AC2 pins one
  number, the 12px *left* inset; AC3's "no horizontal padding" is scoped to the panel ("The panel is
  padded 2px top and bottom, with no horizontal padding — rows run its full width"), and symmetric row
  padding does not stop a row running the panel's full width. The design carries no authoritative right
  inset to port: `get_metadata` on `121:3881` and `121:3896` (2026-08-27) returns a **fixed 65px text slot
  at x=12 that every instance shares verbatim** — the "Low" row's text node is byte-identical to
  "Ultracode"'s, layer name included — so the drawn 81px is the component's default box, not a measurement
  of any label, and its 4px right gap is slack rather than design. Mirroring the one inset the design does
  pin is the honest translation; left-only padding would set the longest label flush against the panel
  edge. Width stays content-driven either way.
- **No `width`, `min-width` or `max-width`** beyond `width: max-content` (AC3). `max-content` is not a
  fixed or minimum width — it *is* "width follows the longest label", made independent of whatever
  formatting context #839 drops the panel into. Without it the panel would stretch in a block or
  stretch-aligned flex host, and its resting appearance would depend on an unspecified host. The bound that
  hostile long strings need is #694's, per the ticket.
- **No `position`, no `top`/`right`/`bottom`/`left`, no `z-index`** (AC5). Positioning is #839's whole
  ticket; stacking is settled by DOM order for the reason `conversation.css:2325-2334` records.
- **No `border`, no `border-radius`, no `box-shadow`** — the node draws none.

### Not a variant of the overflow menu

`.conversation__overflow-menu` is a light surface-container card with an outline border, `--radius-md`
corners, label-large rows and `var(--space-2) var(--space-4)` padding. This panel is a flush dark-navy
surface with body-small rows and a fill-based selection marker. Copy its **button reset** and its
**no-z-index reasoning**; copy none of its visual treatment, and add no modifier to it.

### The new token

One line added to `tokens.css`, between `--color-on-primary` and `--color-on-primary-container`:

```css
--color-on-primary-fixed: #001d34;
```

Its comment follows the `--color-inverse-primary` / `--color-on-primary` provenance format already in the
file, and must record:

- **M3 `Schemes/On Primary Fixed`**, read from the Figma **variable** (`get_variable_defs` on node
  `121:3879`, 2026-08-27), which returned `#001d34`.
- The composer options panel's surface fill (#838) — one consumer today, per the file's header note
  sanctioning tokens ported ahead of their consumers.
- The first `*-fixed` token in the file, and **why the neighbouring light/dark-transposition warnings do
  not apply to it**: M3's `*Fixed` roles are defined to resolve identically in the light and dark schemes,
  so unlike `Inverse Primary` or `Error Container` there is no transposed generated fallback to be trapped
  by. Say this explicitly — a reader who has just read the two warnings above it will otherwise assume the
  same trap is live here.

Verified absent before writing: `tokens.css` has no `*-fixed` token, and `#001d34` appears nowhere under
`src/`. `--color-on-primary`, `--color-primary`, `--color-primary-container` are referenced **by token
name** and not re-added; `conversation.css` gains no colour literal.

## State + concurrency model

None. No store slice, no effect, no subscription, no async work, no timer, no local `useState`. The
component is a pure function of its props, which is what makes both the current-value and no-current-value
states directly server-renderable. #840 owns whatever state opening and keyboard navigation need.

## Error handling

No failure modes reach this layer — no I/O, no parse, no bridge call. Two degenerate inputs, both handled
by the ordinary branch rather than a guard:

| Input | Behaviour |
| --- | --- |
| `options: []` | Renders the bare surface. Consumers gate on length. |
| `currentId` matching no option | No row highlighted. Identical to `currentId: null`. |
| A hostile `label` | Rendered as escaped inert text; never markup, never an attribute. |

## Testing strategy

New file `ComposerOptionsPanel.test.tsx`, `renderToStaticMarkup` only — `vitest.config.ts` sets
`environment: 'node'` and there is no jsdom, no `@testing-library`, so nothing here can click, focus or
measure. Gates: `npm test`, `npm run typecheck`, `npm run build`.

**Only AC4 has a detector.** AC2, AC3 and AC5 are stylesheet declarations and server render has no layout
engine. Per the ruling at `ConversationScreen.test.tsx:1128-1132`, the declarations are left to the
stylesheet and the test pins that the classes are *on* the elements. Do **not** read `conversation.css` as
text from a test, and do not add a DOM environment — that is a separate, deliberate decision (CLAUDE.md),
never a side effect of this ticket. No e2e proof is available either: the panel has no host until #839.

Scenarios:

- **AC4, positive.** Three options, `currentId` matching the second. The markup contains
  `class="composer-options__item composer-options__item--current"` exactly once, on the row whose text is
  the second label; the other two carry `class="composer-options__item"`.
- **AC4, negative.** Same options with `currentId: null` — the substring `--current` appears nowhere, and
  `aria-current` appears nowhere.
- **AC4, stale value.** `currentId` matching no option behaves identically to `null`. (Guards the branch a
  future ticket would otherwise be free to turn into a throw.)
- **Order and completeness.** Every label appears, and their indices in the markup string are strictly
  increasing in the order the `options` array gave them.
- **ARIA.** The panel carries `role="menu"` and `aria-label` from the prop; every row carries
  `role="menuitem"` and `type="button"`; `aria-current="true"` appears exactly once in the positive case.
- **Untrusted label.** A `<img src=x onerror="alert(1)">` label renders escaped: assert the escaped run is
  present, `not.toContain('<img')`, `not.toMatch(/\son[a-z]+="/i)` and `not.toContain('alert(1)"')`. Match
  the shape at `ConversationScreen.test.tsx:1152-1165` — a bare `not.toContain('src=')` passes vacuously.
- **Class hooks for AC2/AC3/AC5.** The panel element carries `class="composer-options"` and each row
  `composer-options__item`; assert the full class attribute, never the modifier alone.
- **Empty options.** Renders the surface with no `<button>` in it, and does not throw.

`onSelect` is wired to each row's `onClick` and is not exercised by a static render — that is expected, and
it is #840's e2e tier that will drive it. Do not add a DOM harness to reach it.

## Scope check

| Red line | This spec |
| --- | --- |
| > 3 new files | 2 (`ComposerOptionsPanel.tsx`, `ComposerOptionsPanel.test.tsx`) |
| > ~600 LOC total written | ~210 (≈55 component, ~90 test, ~45 CSS, ~8 token + comment) |
| > 5 new exported types/components | 3 |
| > 10 consumer call sites | 0 — nothing consumes it until #839 |
| > 5 acceptance criteria | 5 |
| ≥ 10 reject branches | 0 |

Production source files touched: `tokens.css`, `conversation.css`, `ComposerOptionsPanel.tsx` — 3, under
the 5-file commit gate. Size confirmed `s`.

**File-overlap check** (2026-08-27, `git fetch origin --prune` then a branch-diff sweep over all 18
`origin/feature/<n>` branches): no in-flight branch touches `tokens.css`, `conversation.css`,
`ConversationScreen.tsx` or `ConversationScreen.test.tsx`. No block set.

## Open questions

- **The row's right padding** is this spec's call (12px, mirroring the left), not the ticket's or the
  design's — see the reasoning under § Stylesheet. If a visual review reads the panel as too wide, the
  correction is a one-declaration change to `padding: 0 0 0 var(--space-3)`, and AC2/AC3 hold either way.
- **`--color-primary` may want hoisting to `.composer__footer`.** The comment at
  `conversation.css:1421-1424` records that every item in the footer is `schemes/primary` and that
  "whichever of them lands first is the natural place to hoist it". This panel is not that ticket — it is
  not a footer child (#839 places it) and its rows sit on a different fill. Leave the hoist to the first
  control that actually lands in the row.
- **#694's width bound.** Content-driven width plus workspace-authored command names means a pathological
  name makes a pathological panel. The ticket assigns that bound to #694; nothing here forecloses it, since
  a `max-width` can be added to `.composer-options` without touching this markup.
