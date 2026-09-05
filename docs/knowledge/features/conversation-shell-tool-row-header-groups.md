# Conversation shell — tool row header groups

Split out of [Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to
keep every section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Tool row header groups (#854)

Splits the tool-row chip's two packed runs into the redrawn Figma component's (`155-553`) two frames — a
`.tool-row__left` that fills the header and a `.tool-row__right` that hugs its content — and draws the
first thing to live in the right one: a right-pointing chevron, flush against the header's trailing edge.
Split from #774; #855 (which runs sit in the left group) and #856 (the result count, the right group's
other member) are the sibling slices this one sets up for. Markup-only change to `ToolRow`
(`ConversationScreen.tsx`) plus three additive CSS rules; no new file, no new token, no new export.

**The split, not the chevron, is the point.** `.tool-row__chip` keeps its existing `gap: var(--space-3)`
unedited — the gap's job changes from falling between the two runs to falling between Left and Right,
since the design gives both the same 12px, which is why the split needed no new spacing value.
`.tool-row__left` (`flex: 1 1 auto; min-width: 0; overflow: hidden`, its own `--space-3` gap) restores the
12px between the runs the chip's gap no longer supplies and holds `.tool-row__name`/`.tool-row__summary`
byte-unedited. It reuses the fill/hug idiom `.composer-status__activity` already ships one screen region
away (`flex: 1 1 auto` where Figma says `flex: 1 0 0` — equivalent once `min-width: 0` removes the
automatic minimum and the lone sibling never grows) rather than inventing a second one, and its
`overflow: hidden` is the design's own `overflow-clip`, now load-bearing where it used to be redundant: an
oversized daemon tool name overflowed `.tool-row__name`'s box before too, but the chip's own
`overflow: hidden` clipped it harmlessly; with a chevron now sitting to its right, an unclipped left group
would paint *over* the chevron before the chip-level clip ever ran. `.tool-row__right`
(`flex: 0 0 auto`, its own `--space-3` gap, inert with one child today) hugs so the trailing edge never
moves — without it the roles above invert and an oversized name squeezes the chevron instead of
ellipsizing the headline, the `.composer-status__error` reasoning with the names swapped.

**The right group is gated on `result !== null`** — the same binding that already forks `rowClass`, the
chip's `<button>`/`<div>` fork, and `body` — never a second predicate, never `expanded`. The whole group is
gated, not just the chevron: an always-rendered empty `.tool-row__right` would still take one side of the
chip's 12px gap and drag a pending row's trailing edge away from a resolved row's, which is exactly the "a
resolving row does not shift" property #722 shipped and pinned with three chip-width equalities in
`e2e/tool-row-toggle.spec.ts` — unedited by this ticket, and still green because the pending `<div>`
branch is `result === null` by construction, so it can never reach the group that renders inside the
shared `chipRuns` fragment both branches consume.

**The chevron** is a bare inline `<svg viewBox="0 0 4 8" width="4" height="8" fill="currentColor"
aria-hidden="true">`, the same idiom every chevron in this file already follows
(`.status-row__chevron`, `.composer__actions-icon`) — sized from its own attributes, no wrapper frame, no
extracted shared component (three call sites, three different glyphs). Its path is
`TOOL_ROW_CHEVRON_PATH`, a module-level `const` beside `ToolRow`, not exported (no second caller), the
right-pointing sibling of `ComposerActionsMenu.tsx`'s `CHEVRON_PATH` — same family, same construction,
same slight overflow past its nominal box, reproduced rather than corrected by leaving the `viewBox`
un-padded. Ink is `--color-primary` via `color:` + `currentColor`, an exact match to the Figma export
(`#9DCBFC`) — unlike `ComposerActionsMenu`'s export there is nothing to correct. **It points right and
does not turn.** Figma draws the collapsed state only (the Body frame is hidden in `155:553`), and
`ComposerActionsMenu.tsx:47-52` already declined a rotating chevron once for the same reason: `aria-expanded`
plus the body appearing below already carry the open state, so a turning glyph would be design invented
here rather than implemented. If one is ever wanted it's a one-rule follow-up keyed on the
`.tool-row--expanded` class that already ships — not read from `expanded` inside `ToolRow`. The chevron is
purely decorative: no `aria-label`, no `<title>`, no `role="img"`, no `aria-controls`/`id` pair — the
SAFETY block's existing clauses (`ConversationScreen.tsx:704-781`) apply verbatim since this adds one
element into the same chip and no untrusted string (the path is a client-owned constant, the two runs are
unedited) — so the resolved chip's accessible name stays exactly its two text runs (WCAG 2.5.3).

**Both groups are `<span>`, never `<div>`.** A resolved chip is a real `<button>`, which admits phrasing
content only; a `<div>` inside it is invalid HTML and a React DOM-nesting warning. `<svg>` is phrasing
content and is fine. Layout comes from `display: flex` in the CSS, not from the element choice.

**Tests.** Two byte-level assertions in `ConversationScreen.test.tsx` were updated in place (not
loosened) to expect the new wrapper spans and the chevron as the right group's last child; new cases pin
that a pending row draws neither `.tool-row__right` nor `.tool-row__chevron` nor a gap where either would
be, that the chevron carries `aria-hidden="true"` and nothing else exposes an accessible name, that an
error row still draws the chevron (it follows the body, never the outcome), and that an expanded row's
header markup is byte-identical to the collapsed row's (no rotation class, no `--expanded` variant). A new
sibling `test(...)` in `e2e/tool-row-toggle.spec.ts` (its own `launchPairedApp`, since a second row on the
page would make the existing bare `.tool-row` locators ambiguous) covers what `renderToStaticMarkup`
cannot see: the trailing edge sits flush against the chip's padding edge, a very long single-line headline
still ellipsises without pushing the group off it, chip height is unchanged from the pending measurement
(no second line), and the 12px gap between the two runs survived being re-homed from the chip onto
`.tool-row__left`.

**What this does not touch:** which runs sit in `.tool-row__left` (`toolHeadline.ts`/`shortenPath.ts`,
\#855's), the count node (`155:557`, #856's — the right group's first child, inserted *before* the
chevron), the expanded body (`.tool-row__body`, #706's field list, #780's command block,
`.tool-row__result`), and the chip's own width mechanic + #722's three e2e width equalities.

See commit `2c90c01` for the full record; there is no `docs/knowledge/codebase/854.md` — that directory
was frozen 2026-08-26, and this section is #854's only home.

