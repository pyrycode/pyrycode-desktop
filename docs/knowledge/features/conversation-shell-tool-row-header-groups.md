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
`TOOL_ROW_CHEVRON_PATH`, a module-level `const` beside `ToolRow`, shared with the folded-run header, the
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

`ThreadItemsView` uses `threadItemPresentations` to nest shown supplied items under
a shown `agent` with the matching item-id `parent` in the same snapshot. It does not
join `parentToolUseId` against stored arrival order. Missing, hidden and non-agent
parents leave children flat; a catch-up parent or revision relocates each child
once. Cycle/self edges are disconnected without losing rows. Visual indentation
uses 16px steps capped at two levels, while full ancestry controls visibility/counts.
See [supplied daemon item presentation](conversation-shell-timeline-render.md#supplied-daemon-item-presentation).

New groups start collapsed. Text-only descendants still permit disclosure and do
not add tools. Counts include distinct shown descendant `tool_call` item ids,
excluding messages, nested agent cards and the owner; equal `tool_use_id` values do
not merge supplied items. Supplied `active` determines activity independently of
launch results, child activity or main-turn endings. Expanding reveals the retained
children; hiding a parent preserves their independent expansion.

`groupToolRows` and `withProvisionalAgents` were deleted in
[#2023](https://github.com/pyrycode/pyrycode-desktop/issues/2023).
`groupToolRows.ts` still owns the shared `GroupedToolRow` interface consumed by
`foldToolRuns`; `foldQueuedRows.ts` retains only the shared `QueuedRowHandle` action
type. Neither module reconstructs rows. Shared `ThreadItem` and live types keep
their existing homes; producer APIs remain until #2024.

### Started background agents

A usable saved task link establishes background membership for an already supplied
item. A direct link or one matching row in a roster-shaped `task_link.tasks` must
match both saved `task_id` and `tool_use_id`; source roster events, names,
`run_in_background` or result prose cannot synthesize provisional cards.

Within a sibling lane, active linked cards follow ordinary rows in creation order;
inactive cards settle at positive `ended_order`, otherwise retaining creation
placement. Descendants move with their owner, and supplied nesting takes precedence.
The launch marker remains at creation order and shows supplied activity/outcome.
Its escaped, bounded description and native “Go to agent” button navigate to the
same card, reveal ancestors and preserve the card's expansion. Refs are scoped to
host/conversation/epoch. Marker and background rows break adjacent tool runs.
Prior-session inactive work stays settled on reopen without reconstructing terminal
positions from retained roster/start/finish evidence.

### Expansion identity

`ThreadItemsTimeline` keys its inner view by host/conversation/epoch. Numeric daemon
item ids key the stable sibling wrappers and tool expansion within that scope;
marker and run headers derive keys from those ids. Appends, revisions, prepends and
late reparenting keep the row mounted, including while an ancestor hides it. Equal
ids in a new scope cannot inherit expansion or refs. There is no `agentKeys`,
`firstRowKey`, `FoldedRow.itemIndex` or provisional-to-loaded key handoff.

Run expansion uses its own member-id set. Opening marks every current member id;
any surviving member keeps a regrouped run open. Marking only the first root would
lose expansion when a prepend or late parent changes that root. Closing clears all
current members. Visibility checks both ancestor tool expansion and an enclosing
run; checking only a text row's own membership can leave it visible through an
outer run collapse. Test the two controls together, not just owner collapse.

### Visible tool-row joins

`ThreadItemsView` computes joins from visible neighbours at the same capped depth.
Hidden descendants do not join; shown non-tools, including supplied informational
notices and turn endings, separate stacks. An expanded run header joins its first
member. The wrapper map emits only `tool-group-row--joined-above` and
`tool-group-row--joined-below`. Direct `.tool-row + .tool-row` selectors miss these
siblings because their mounted wrappers interrupt DOM adjacency. Failure stays
local to the [Failed icon](conversation-shell-tool-rows.md#failed-icon), with plain
borders on neighbours. Wrappers are flex columns so negative join margins affect
height; hidden wrappers consume no space. See
[tool-row box treatment](conversation-shell-tool-row-body.md).

### Verification

`threadItems.test.tsx` covers supplied ancestry, cycle/depth handling, shown-item
counts, activity/outcomes, links, placement and escaped fallback.
`threadTaskPresentation.test.tsx` covers supplied drawer membership and controls.
`ConversationScreen.test.tsx`, `banner.test.tsx`, `compactionBoundaryViewModel.test.tsx`
and `stoppedTurn.test.tsx` render surviving shared rows directly; they do not need
an event-to-item reconstruction helper. `toolRuns.test.tsx` uses supplied snapshots.
The removed `toolGroups.test.tsx`, `groupToolRows.test.ts` and `foldQueuedRows.test.ts`
no longer own presentation coverage.

Mixed presentation suites also contained independent producer proofs. Preserve
those at assertion level while their APIs survive: `threadTimeline.test.ts` checks
result identity/parent precedence and adjacent-delta coalescing;
`historyPageBridge.test.ts` checks newest-first tool/assistant attribution;
`queuedEchoSettlement.test.ts` checks row identity, receipt idempotence, reset and
Send now stream placement. Delta timestamps must differ to prove retention of the
first stamp: identical stamps allow an overwriting implementation to pass.
Roster/history/receipt/delivery/stop suites retain their direct producer assertions,
and `src/shared/chatHistory.test.ts` retains version-1 assistant-parent round trips.

Mounted `e2e/tool-groups.spec.ts` retains all four active cases: marker navigation,
interleaved groups, joined borders and started-agent lifecycle. `e2e/thread-items.spec.ts`
adds authoritative supplied nesting/expansion/scroll and task-control proofs.
Keep the ordinary stack geometry in `e2e/tool-row-toggle.spec.ts`; unchanged inner
ToolRow markup does not establish wrapper geometry. Static markup cannot prove
navigation, listeners, scrolling or mounted state retention.

The [cleanup verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2027#issuecomment-6202221899)
at `11b4c95e4f3e2a665b5342882fd64ce569882793` records the complete configured
fake-transport gate on 2026-10-15: **432 executed, 432 passed, 0 failed, 19 skipped**,
zero flaky results/retries. It confirms active thread activation (15/15), item
rendering (12/12), frame streaming (1/1) and tool groups (4/4) were present and passed.
Exactly two skipped legacy tool-group cases and the skipped roster-reconnect case
were removed; `e2e/background-task-reconnect.spec.ts` is gone. The remaining skips
are 16 legacy cases owned by #2024 and three macOS-only cases. No active case was
removed/newly skipped. No live-Claude run or new visual comparison was required.

## Adjacent tool runs

`ConversationScreen` subscribes to the client-wide
[collapse assistant tool uses preference](collapse-tool-uses-preference-store.md)
and passes it to `ThreadItemsTimeline.foldTools`. Settings → Thread defaults the switch on;
off restores ordinary tool rows and existing joins without “Using tools: N” headers.
Turning it on restores folding without restarting, including retained conversations
and those on another paired host. The optional `ThreadItemsTimeline.foldTools` prop still
defaults to false: absent or false retains ordinary rendering and joins for other
callers. The persisted preference and expansion remain local presentation, with no
IPC, transport or wire changes.

### Membership and boundaries

[`foldToolRuns.ts`](../../../src/renderer/src/screens/conversation/foldToolRuns.ts)
consumes `ThreadItemsView`'s shared row projection with supplied ancestry/activity
and card/marker barriers, forming runs of at least two adjacent root tool rows.
An eligible Agent/Task counts as one root and retains owned tool descendants and
indentation; task-linked cards instead form barriers. Attributed text follows ancestor visibility
without becoming a tool-run member. A lone root keeps its existing row. Each new run
starts collapsed as “Using tools: N”, where N counts roots only.

Every shown non-tool ends a run: user/assistant messages, queued items, notices,
session/compaction delimiters, turn endings and summary fallbacks. Hidden supplied
items have no projection and cannot split a run. Shown informational banners and
normal endings remain authoritative rows, even when the standalone shared row would
suppress them without its summary input. Agent expansion does not change membership
or N.

### Status and disclosure

The header shows a Primary spinner with the client-owned accessible name `Running`
while any root's supplied activity is true. Descendant activity cannot make an
inactive root run; supplied activity remains independent of status/result.
“K failed” and the existing `tool-row__failed` glyph (`Failed`) count roots with a
result error **or** denial once each, even if a denied root later receives an error
result. Descendant failures stay on existing member/group surfaces and do not add
to K. A concurrent failure and running root show both failure and spinner; only a
fully complete run with no failed roots shows the `Done` check. That check uses
`--color-on-surface-variant`, while the spinner reuses `composer-status-spin`.
Copy and accessible labels are client-owned apart from N and K; member tool names
remain escaped React children.

The header is a native button: click, Enter and Space toggle it and `aria-expanded`
reflects the local state. Its chevron follows the label, pointing down when collapsed
and up when expanded; member-row chevrons keep their existing treatment. It shares
the Desktop tool outline, fill and joins. Headers are keyed **siblings** of the
existing mounted tool wrappers, rather than containers that reparent members.
Hidden members consume no space but retain their result and nested-group state;
see [Expansion identity](#expansion-identity) and [Visible tool-row joins](#visible-tool-row-joins).

### Coverage and recorded evidence

[`toolRuns.test.tsx`](../../../src/renderer/src/screens/conversation/toolRuns.test.tsx)
pins optional-off equivalence, lone tools, shown/hidden supplied boundaries and root
status combinations. Supplied ancestry and member retention also live in
`threadItems.test.tsx` and `e2e/thread-items.spec.ts`.
Static renders cannot exercise disclosure, state retention or geometry.
The [preference spec](../../../e2e/collapse-tool-uses-preference.spec.ts) covers
Settings off/on round trips, keyboard activation, retained chats, another host,
ordinary joined-stack geometry and off after full relaunch; see the
[preference coverage and evidence](collapse-tool-uses-preference-store.md#coverage-and-evidence).
[`e2e/tool-runs.spec.ts`](../../../e2e/tool-runs.spec.ts) covers click/Enter/Space,
member expansion through outer collapse, appends and an earlier-root history prepend,
collapsed count/status changes, denial plus result without double counting, and the
header/member join at both 800px and 1280px window widths.

Adjacent-tool setups in [`tool-row-toggle`](../../../e2e/tool-row-toggle.spec.ts),
[`tool-groups`](../../../e2e/tool-groups.spec.ts) and
[`tool-denied`](../../../e2e/tool-denied.spec.ts) open the run before retaining their
member joins, failure, result expansion and history-regrouping assertions; stack
geometry includes the header. Existing lone-tool proof remains in
[`thread-shadow`](../../../e2e/thread-shadow.spec.ts),
[`tool-progress`](../../../e2e/tool-progress.spec.ts) and
[`thread-scroll-pin`](../../../e2e/thread-scroll-pin.spec.ts).

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1788#issuecomment-6002244618)
records the 2026-10-05 gate at `fcf41f3d19adcaf639cbdd0c1017364af077b0ad`:
270 Playwright tests executed, 270 passed, 0 failed and 4 skipped. It confirms all
12 tests across tool-runs/tool-row-toggle/tool-groups/tool-denied executed and passed,
including “tool runs retain expansion and update collapsed status at 800px” and its
1280px counterpart. No live-Claude acceptance is required for this renderer feature.

The same verdict records comparison of ten integrated captures with
[Figma row states](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=726-5376):
collapsed success, expanded, running, failure and concurrent failure/running at
800×800 and 1280×800 windows (800×773 and 1280×773 content viewports). Scratch evidence
was retained at `/tmp/verifier-1788/{800,1280}-{collapsed,expanded,running,failure,failure-running}.png`;
the linked verdict is the durable record. The 38px header meets the design's 36px ±2px
convention, with Desktop geometry, joined borders and Agent indentation retained and
no unresolved visual deviation.

Design: [fold tool runs](../../specs/architecture/1764-fold-tool-runs.md).
