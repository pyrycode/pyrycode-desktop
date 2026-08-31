# #854 — the tool row header as a filling left group and a hugging right group

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/854

**Size:** S. Four files, **no new files**, one `.tsx` production file, no new exported symbol, no new
token.
**Shape:** two wrapper `<span>`s inside the existing chip, one inline `<svg>` gated on the condition that
already forks the chip, three CSS rules, two byte-level unit assertions updated plus three added, and one
new e2e test. `toolHeadline.ts`, `toolBody.ts`, `shortenPath.ts`, the reducer, the wire types and the
expanded body are **not touched**. A diff that reaches any of them has overshot the ticket.

---

## Files to read first

Codegraph is wired but **not indexed** for this repo (`codegraph_status` → "CodeGraph not initialized",
re-probed 2026-08-31; same as the 2026-08-24 and 2026-08-27 probes). Everything below was located by
grep/Read; the list is complete, so no exploratory sweep is needed.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:782-926` | `ToolRow` — the whole component. The `result` binding at `:789` that drives `rowClass`, the chip fork and `body`; the shared `chipRuns` fragment at `:805-815`; the `<button>`/`<div>` fork at `:819-841`. **This is the only production TSX file this ticket edits.** |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:704-781` | The SAFETY comment block. Read it before adding markup — every "NO title / NO aria-label / NO aria-controls" clause below inherits from it. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:1641-1668` | `StatusRow` — **the in-repo chevron idiom.** Inline `<svg>`, `fill="currentColor"`, `aria-hidden="true"`, size from the svg's own `width`/`height` attributes. Copy the shape, not the glyph. |
| `src/renderer/src/screens/conversation/ComposerActionsMenu.tsx:47-54, 78-95` | The other half of the idiom: a Figma-exported path as a module-level `const`, its export fill dropped for `currentColor`, and the recorded ruling that **the chevron does not turn on open**. |
| `src/renderer/src/screens/conversation/conversation.css:1108-1300` | The whole tool-row region. `.tool-row__chip` (`:1182`) owns the 12px gap this ticket re-homes; `.tool-row__name` (`:1255`) is `flex: 0 0 auto; white-space: nowrap`; `.tool-row__summary` (`:1277`) owns the ellipsis chain. |
| `src/renderer/src/screens/conversation/conversation.css:818-935` | **The shipped fill/hug precedent.** `.composer-status__activity` (`:824`, `flex: 1 1 auto; min-width: 0`) beside `.composer-status__label--tool` (`:906`) and the `flex: 0 0 auto` trailing chip (`:922-935`) — the same "a filling group ellipsizes, a hugging trailing item never shrinks" chain, with its re-measured numbers and its hostile-daemon reasoning. Reuse the argument; do not restate the measurements. |
| `src/renderer/src/screens/conversation/conversation.css:1587-1591, 1687-1690` | `.composer__actions-icon` and `.status-row__chevron` — both are `flex: 0 0 auto` and nothing else. The size lives on the svg. |
| `src/renderer/src/theme/tokens.css:24, 170-172` | `--color-primary: #9dcbfc` (the chevron's ink) and `--space-1/2/3`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:486-600` | The `#697`/`#705` unit block. **Two byte-level assertions here go red by construction** (`:561-573`, `:575-585`) and are updated, not deleted; everything else in the file must stay green untouched. |
| `e2e/tool-row-toggle.spec.ts` (all 178 lines) | The shipped pending → resolved → expanded → collapsed drive, `measureChip()`, and #722's three width equalities. The new test is a sibling `test(...)` in this file. |
| `docs/knowledge/features/thread-timeline.md` | The package overview's tool-row section — read for context. **Do not edit it**; the documentation phase owns it. |

**Trap:** the line numbers written *inside* `conversation.css` comments (`:943`, `:1029`, `:602`, `:2462`,
…) have drifted and are wrong. Trust the class names in those comments, never their numbers, and do not
"fix" them — that is unrelated churn.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553

The Header (`155:554`) is a 12px-gap, `items-center`, `overflow-clip` row holding exactly two frames:
**Left** (`156:629`) — `flex: 1 0 0`, `min-width: 1px`, `overflow-clip`, its own 12px gap, holding the
mono tertiary tool name and the ellipsizing `M3/body/medium` headline — and **Right** (`156:630`) —
`shrink-0`, its own 12px gap, holding the Count text (`155:557`, **#856's**, not drawn here) and the
Chevron instance (`155:558`) as its **last** child, flush against the Header's trailing edge. The Body
frame (`155:561`) is hidden in this node: the design draws the collapsed state only.

Design-context readback, so the developer need not re-fetch:

| Figma | Value | Token / decision |
| --- | --- | --- |
| Header gap (Left→Right) | `12px` | `--space-3` — the gap `.tool-row__chip` already carries. No new value. |
| Left gap (name→headline) | `12px` | `--space-3` — the same gap, re-homed onto the left group (see § 2). |
| Right gap (count→chevron) | `12px` | `--space-3` — inert today with one child; stated because it is the frame's, and #856 lands the second child. |
| Left sizing | `flex: 1 0 0`, `min-w-px` | `flex: 1 1 auto; min-width: 0` — the shipped `.composer-status__activity` form. Equivalent here (see § 2). |
| Right sizing | `shrink-0` | `flex: 0 0 auto`. |
| Chevron glyph | `3.985 × 7.967` vector in an `8 × 10` frame (`pt-2 px-2`) | a bare `4 × 8` inline `<svg>`, no wrapper frame (see § 3). |
| Chevron fill | `#9DCBFC` | `--color-primary` (`tokens.css:24`) — an **exact** match. Unlike `ComposerActionsMenu`'s export, this node's fill is already the dark scheme's, so there is nothing to correct. Still `currentColor` + a `color:` declaration, per the idiom. |

The exported path, verbatim from the asset (`155:558` → `I155:558;134:4925`), so this spec is the source
and no MCP round-trip is needed at implementation time:

```
M3.8393 3.58178C4.03385 3.804 4.03385 4.16489 3.8393 4.38711L0.850973 7.80045C0.656421 8.02267 0.340467 8.02267 0.145915 7.80045C-0.048638 7.57822 -0.048638 7.21733 0.145915 6.99511L2.78249 3.98356L0.147471 0.972C-0.0470815 0.749778 -0.0470815 0.388889 0.147471 0.166667C0.342024 -0.0555556 0.657977 -0.0555556 0.85253 0.166667L3.84086 3.58L3.8393 3.58178Z
```

It is the right-pointing sibling of `ComposerActionsMenu`'s `CHEVRON_PATH` — same family, same
construction, same slight overflow past the nominal box.

---

## 1. The markup

`ToolRow` keeps its single `result` binding, its `rowClass`, its `body`, its `command`, its `<button>` /
`<div>` fork and its two existing runs **unchanged**. What changes is the shape of `chipRuns`:

```
chipRuns = <>
  <span className="tool-row__left">   … the two existing runs, moved in unedited …   </span>
  {result !== null && (
    <span className="tool-row__right">
      <svg className="tool-row__chevron" viewBox="0 0 4 8" width="4" height="8"
           fill="currentColor" aria-hidden="true"><path d={TOOL_ROW_CHEVRON_PATH} /></svg>
    </span>
  )}
</>
```

Five things are load-bearing and each must be stated in the comment beside it:

- **`<span>`, never `<div>`, for both groups.** A resolved chip is a real `<button>`, which admits
  phrasing content only; a `<div>` inside it is invalid HTML and a React DOM-nesting warning. `<svg>` is
  phrasing content and is fine. Both spans are `display: flex` in CSS — the element is chosen for
  validity, the box for layout.
- **The right group is gated on the same `result` binding**, not on a second predicate. `result` already
  drives `rowClass`, the chip fork and `body`; adding the right group to that same list is what makes
  AC2's "a pending row draws neither it nor a gap where it would be" structural rather than a fourth
  condition that can drift. Do **not** gate on `expanded`, on `body`, or on a new `hasResult` const.
- **The whole group, not just the chevron, is gated.** An always-rendered empty `.tool-row__right`
  would still take one side of the chip's 12px gap and move the pending row's trailing edge — the
  property #722 pinned with its three chip-width equalities and the ticket's "a pending row must not pay
  for the group it does not fill".
- **The gate stays inside the one shared `chipRuns` fragment**, which both branches keep consuming. The
  right group is unreachable from the `<div>` branch by construction (that branch *is* `result === null`),
  so the pending chip's children are byte-identical to today's plus one wrapper — which is exactly what
  the updated unit assertion pins.
- **The chevron is the LAST child of the right group.** #856 inserts the count *before* it. Say so in the
  comment so the follow-up does not have to re-derive it from the Figma.

`TOOL_ROW_CHEVRON_PATH` is a module-level `const` in `ConversationScreen.tsx` beside the component (the
`CHEVRON_PATH` / `TOOL_RESULT_EMPTY_COPY` precedent), **not exported** — no second caller exists.

### What the chevron must not become

The SAFETY block at `:704-781` already forbids the sinks; this ticket adds one element into that same
chip, so three of its clauses apply verbatim and are **MUST FIX** if they ever appear:

- **No `aria-label`, no `<title>` child, no `role="img"`.** The chevron is decorative; `aria-hidden="true"`
  is what keeps the button's accessible name exactly its two text runs (AC2, and WCAG 2.5.3 label-in-name
  — `ComposerActionsMenu.test.tsx:84-90` records the same reasoning for the same reason).
- **No `aria-controls` / `id` pair**, for the reason already written at `:723-726`.
- **No rotation, no `--expanded` variant class on the chevron, no reading of `expanded` to pick a glyph.**
  Figma draws the collapsed state only; `ComposerActionsMenu.tsx:47-52` declined exactly this once
  already. `aria-expanded` on the chip and the body appearing below already carry the open state. If a
  turning chevron is ever wanted it is a one-rule follow-up keyed on the `.tool-row--expanded` class that
  already ships — not this ticket.

No new untrusted string reaches the DOM: the path is a client-owned constant and the two runs are
unedited. This ticket has **no** `security-sensitive` label and the § 3 security-review pass therefore
does not run.

---

## 2. The CSS

Three new rules in `conversation.css`, placed immediately after `.tool-row__chip--toggle:hover` (source
order: the chip and its variants, then the chip's children) and **before** `.tool-row__name`.

| Selector | Declarations | Why |
| --- | --- | --- |
| `.tool-row__left` | `display: flex; align-items: center; gap: var(--space-3); flex: 1 1 auto; min-width: 0; overflow: hidden;` | Fills the header; its own gap replaces the chip gap that used to fall between the two runs. |
| `.tool-row__right` | `display: flex; align-items: center; gap: var(--space-3); flex: 0 0 auto;` | Hugs its content and never shrinks, so the trailing edge is fixed whatever the left group does. |
| `.tool-row__chevron` | `display: block; flex: 0 0 auto; color: var(--color-primary);` | `.status-row__chevron`'s two declarations plus the ink the design binds. Size comes from the svg's attributes. |

`.tool-row__chip` keeps `gap: var(--space-3)` **unchanged** — it is now the Left→Right gap, which the
design gives the same 12px. That is the whole reason this split needs no new spacing value, and it is why
the chip rule is not edited at all.

Four points the comment must carry:

- **`min-width: 0` on the left group is required, not decorative.** Without it the group's automatic
  minimum size floors at the runs' intrinsic width, the chip cannot shrink below it, and the ellipsis on
  `.tool-row__summary` becomes unreachable in a narrow window — link 2 of the three-link chain written at
  `conversation.css:888-895` for `.composer-status__activity`. `.tool-row__summary` keeps its own
  `min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap`; that is link 3
  and it is **not edited**.
- **`flex: 0 0 auto` on the right group is required, not decorative**, for `:922-926`'s reason with the
  names swapped: without it the trailing group is a shrink candidate too, and an oversized daemon-chosen
  tool name would squeeze the *chevron* instead of ellipsizing the *headline* — inverting the truncation
  chain, remotely triggerable by a hostile or merely buggy daemon.
- **`overflow: hidden` on the left group is what the design's `overflow-clip` buys.** `.tool-row__name` is
  `flex: 0 0 auto; white-space: nowrap`, so a 3000-character tool name overflows its group's box. Overflow
  is paint, not layout, so today the chip's own `overflow: hidden` clips it harmlessly; after the split it
  would paint *over* the chevron before being clipped at the chip edge. Clipping at the group boundary is
  the fix, and it is the design's own declaration rather than an invention.
- **`flex: 1 1 auto` where Figma says `flex: 1 0 0`.** Equivalent in this container — with the group's
  automatic minimum removed by `min-width: 0` and a single sibling that never grows, both forms resolve to
  "take the leftover" — and `1 1 auto` is the form already shipped one screen region away
  (`.composer-status__activity`), so the file gains no second idiom for the same job.

No token is added, no colour or size literal is introduced, and `--space-3` is reused three times.

---

## 3. The chevron's geometry

The design's Chevron (`155:558`) is an 8×10 icon frame with `padding: 2px 2px 0` around a 3.985×7.967
vector. This ticket ships **the glyph only** — a bare `<svg width="4" height="8" viewBox="0 0 4 8">` — and
drops the frame's 2px inset:

- Every chevron in this repo (`status-row__chevron` 18×18, the two settings chevrons 20×20,
  `composer__actions-icon` 8×4) is a bare inline `<svg>` sized by its own attributes with a `flex: 0 0 auto`
  rule and no wrapper. The ticket asks for that idiom explicitly.
- Rounding `3.985 × 7.967` to `4 × 8` is a ±0.02px change, and dropping the frame's inset moves the glyph
  2px toward the trailing edge — both inside the ±2px/±1px convention this file runs on and states on
  `.tool-row` (`:1108-1115`).
- `viewBox="0 0 4 8"` against a path whose extreme points are ≈`(-0.05, -0.06)` … `(4.03, 8.02)` reproduces
  the exporter's own slight overflow, exactly as `ComposerActionsMenu`'s 8×4 box does. Do not "fix" it by
  padding the viewBox.

The flush-trailing-edge assertion in § 5 therefore measures `.tool-row__right`'s box against the chip's
**padding edge** (border-box right minus computed `border-right-width` and `padding-right`), which is the
Header's trailing edge in the design.

---

## 4. What this ticket does not change

State explicitly in the PR description, and keep every existing assertion green:

- `.tool-row` / `--resolved` / `--error` / `--expanded`, the 50% pending dimming, the error border, and
  the pending row's non-activatability. The pending branch is still a `<div>` with no `aria-expanded` and
  no `<button>` anywhere.
- The expanded body: `.tool-row__body`, #780's `.code-block`, #706's field list, `.tool-row__result`,
  `.tool-row__empty` — all untouched. The chevron lives in the header and never moves into the body.
- `toolHeadline`'s pick and `shortenPath`'s output (#855 owns which runs the left group draws).
- The count node (`155:557`) is **#856's**. Do not draw it, do not add a placeholder for it, do not add a
  prop for it.
- The chip's own width mechanic (`width: 100%`, `box-sizing: border-box`) and its three shipped e2e width
  equalities.

---

## 5. Testing strategy

### Unit — `ConversationScreen.test.tsx`, `renderToStaticMarkup`, `node` env

Two existing byte-level assertions go red **by construction** and are updated in place (never deleted,
never loosened to a substring):

- `:561-573` "leaves the chip element, classes and run order otherwise unchanged" → the resolved chip is
  now `<button …><span class="tool-row__left">` + the two unedited runs + `</span><span class="tool-row__right">`
  + the `<svg class="tool-row__chevron" …>` + `</span></button>`. Rename the case to say what it now pins
  (the wrapper, the run order inside it, and the chevron as the right group's last child).
- `:575-585` "draws the headline on a pending row too" → the pending chip is `<div class="tool-row__chip"
  data-thread-role="tool"><span class="tool-row__left">` + the two unedited runs + `</span></div>`.

New cases, as scenarios (the developer writes them in the file's existing idiom):

1. **Pending row draws no trailing group at all.** Render `toolItem(null)`; assert the markup contains
   neither `tool-row__right` nor `tool-row__chevron` nor `<svg`. This is AC2's "neither it nor a gap".
2. **The chevron is decorative.** Render a resolved row; assert the svg carries `aria-hidden="true"` and
   that the markup still contains no `aria-label`, no `title=` and no `aria-controls` (the last three
   already assert at `:501-503` — extend that case rather than duplicating it if it reads better).
3. **An error row still draws the chevron.** Render a resolved `isError: true` row; assert
   `tool-row__chevron` is present and the wrapper class string is still
   `class="tool-row tool-row--resolved tool-row--error"`. Pins "the chevron follows the body, never the
   outcome".
4. **An expanded row's header is the collapsed header.** Render with `defaultExpanded`; assert the
   chevron markup is byte-identical to the collapsed row's (no rotation class, no `--expanded` variant on
   the chevron) and that `tool-row__body`, `tool-row__result` and the field list still render as today.

Everything else in the tool-row block — the `:520` pending-chip case, `:587-600`'s summary assertions,
`:848`'s command sentinel, `interactiveRoundtrip.test.tsx:80` — must stay green **unedited**. If one needs
touching, the markup is wrong.

### E2E — one new `test(...)` in `e2e/tool-row-toggle.spec.ts`

Geometry is invisible to the unit tier, so AC1 and AC3 live here. A **sibling test**, not an extension of
the existing one: each test launches its own app through `launchPairedApp`, so a second row on the page
would make the existing bare `.tool-row` locators strict-mode-ambiguous.

The new test pushes one `tool_use` whose `input_summary` is a very long single-line string (no `input`
map, so `toolHeadline`'s rule-4 fallback draws it verbatim — no new fixture machinery), then its
`tool_result`, reusing the file's existing frame builders and constants. Assertions, in order:

- **Pending:** `.tool-row__chevron` and `.tool-row__right` both have count 0; `.tool-row__left` has count
  1. Record the chip's bounding box.
- **Resolved:** the chevron and the right group each have count 1.
- **The trailing edge is flush (AC1).** Read the chip's computed `padding-right` and `border-right-width`
  via `evaluate` rather than hardcoding 12 and 1; assert
  `|(chipRight − paddingRight − borderRight) − rightGroupRight| ≤ WIDTH_TOLERANCE_PX`.
- **The long headline still ellipsises on one line and pushes nothing off (AC3).** Assert
  `.tool-row__summary` reports `scrollWidth > clientWidth` (the ellipsis is engaged), and that the chip's
  height is unchanged from the pending measurement (one line, and the chevron added no second one).
- **The runs' 12px spacing survived the re-homing.** Assert the measured gap between `.tool-row__name`'s
  right edge and `.tool-row__summary`'s left edge equals the chip's computed `column-gap`, within
  `WIDTH_TOLERANCE_PX`. This is the one silent regression the split can produce — the gap moving off the
  chip and no rule replacing it — and nothing else catches it.

The existing test is **not edited**; its three chip-width equalities are what keep "a resolving row does
not shift" pinned, and they must stay green.

### Gates

`npm test`, `npm run typecheck`, `npm run build`, `npm run e2e`.

---

## 6. Open questions

None blocking. Two notes for the follow-ups:

- **#856** inserts its count as the right group's *first* child, before the chevron, and inherits the
  `result !== null` gate that already wraps the group — a count is a fact about the result, so the same
  predicate is the correct one. The group's `gap: var(--space-3)` is already stated for it.
- **#855** works entirely inside `.tool-row__left`; nothing in that group's rule constrains which runs it
  holds, except that a run which must never shrink needs `flex: 0 0 auto` and one that ellipsises needs
  `.tool-row__summary`'s three-declaration chain.
