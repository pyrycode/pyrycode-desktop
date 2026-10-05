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

**The right group follows `expandable`: a result, a denial, or descendants.** A pending
leaf still draws neither the right group nor its gap. An Agent/Task with descendants
has a button and chevron even before its result arrives, so its children can be opened
while running. The count slot shows the group's descendant count instead of the
parent's result detail; calls without children retain the ordinary result-detail slot.
See [Subagent tool groups](#subagent-tool-groups) below.

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
purely decorative: no `aria-label`, no `<title>`, no `role="img"`, no `aria-controls`/`id` pair.
The separate [Failed icon](conversation-shell-tool-rows.md#failed-icon) is meaningful:
it has `role="img"` and the client-owned label `Failed`, after the count and before the
chevron. Tool text and count remain escaped text children; the glyph path and label
are client-owned constants.

**Both groups are `<span>`, never `<div>`.** A resolved chip is a real `<button>`, which admits phrasing
content only; a `<div>` inside it is invalid HTML and a React DOM-nesting warning. `<svg>` is phrasing
content and is fine. Layout comes from `display: flex` in the CSS, not from the element choice.

**Tests.** Two byte-level assertions in `ConversationScreen.test.tsx` were updated in place (not
loosened) to expect the new wrapper spans and the chevron as the right group's last child; new cases pin
that a pending leaf draws neither `.tool-row__right` nor `.tool-row__chevron` nor a gap where either would
be, that the chevron carries `aria-hidden="true"`, that an
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


## Subagent tool groups

`groupToolRows.ts` projects the conversation's stored arrival order into display order;
it does not reorder timeline state. Only calls named exactly `Agent` or `Task` can own
children through `parentToolUseId`. Roots and siblings retain their relative arrival
order, including interleaved parallel agents. Assistant text remains independent:
this feature does not attribute or group assistant deltas.

A missing parent leaves the tool at the root until a history prepend supplies its
Agent/Task owner. A reference to an ordinary tool also stays flat. Iterative traversal
and disconnection of cyclic parent links keep every row reachable; identifiers are
Map equality hints within this conversation, never authority or DOM attributes.
Indentation uses `--space-4` per level, capped at two levels (16px and 32px with the
current tokens). Deeper descendants retain their full ancestry for visibility and counts.

New groups start collapsed. Their headers retain the call description and count distinct
descendant tool-use ids, excluding the parent. `running` remains visible while the
parent or any descendant has neither a result nor a denial. Both readings update while
collapsed. Expanding a pending group reveals children without drawing an empty result
body; nested groups keep their own collapse state.

### Expansion identity

`Timeline` controls expansion for **every** tool row, keyed by its origin-relative
index (`firstRowKey + index`). Separate leaf and group state would close an expanded
leaf when history gives it its first child. Tool wrappers stay under one React parent
and remain mounted while hidden, preserving child-result and inner-group expansion
through outer collapse, results, history prepends and regrouping. The mounted timeline
is keyed by conversation, so this UI state cannot leak into another conversation.
See [history prepend identity](conversation-timeline-store-limits.md#edge-cases-and-limitations).

### Visible tool-row joins

Join decisions follow visible neighbours at the same **capped** indentation, skipping
collapsed descendants and undrawn `turnBoundary` items. A visible non-tool row or a
change in indentation ends the stack. Direct `.tool-row + .tool-row` selectors alone
cannot implement this: the mounted wrappers interrupt DOM adjacency even for ordinary
calls with no children. Client-owned wrapper classes extend the existing join rules
for flattened internal corners, overlapping plain borders and a shadow only on the
stack's last row. `Timeline`'s `joins` map emits only `tool-group-row--joined-above`
and `tool-group-row--joined-below`; #1748 removed `tool-group-row--error-above` and
`tool-group-row--error-below` and their CSS retints. Failure stays local to the
header's [Failed icon](conversation-shell-tool-rows.md#failed-icon), without changing
stack geometry or its neighbours' border colour.

Visible wrappers are flex columns so the child's negative join margin reduces wrapper
height without collapsing through it. Hidden wrappers retain `display: none`, consuming
neither height nor thread gap. See [tool-row box treatment](conversation-shell-tool-row-body.md).

### Verification

`toolGroups.test.tsx` covers projection order, depth cap, orphan recovery, cycles,
distinct counts, denial completion and reducer/history attribution. Static markup
cannot prove retained interaction or border geometry. `e2e/tool-groups.spec.ts` drives
interleaved live calls, nested expansion, result resolution and history regrouping;
it also measures joins through collapse and child-result expansion, including plain
borders on both sides of a failed row at a collapsed-group boundary. Keep the ordinary
stack assertion in `e2e/tool-row-toggle.spec.ts`: unchanged inner ToolRow markup did
not prevent the wrapper regression. Fake transport proves this client behavior; no
additional live-Claude acceptance gate is needed.

Source: [subagent tool groups design](../../specs/architecture/1239-subagent-tool-groups.md)
and [reviewed implementation](https://github.com/pyrycode/pyrycode-desktop/pull/1328).
