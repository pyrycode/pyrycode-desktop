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

`groupToolRows.ts` projects the conversation's stored arrival order into display order;
it does not reorder timeline state. Only calls named exactly `Agent` or `Task` can own
tool and assistant-text children through `parentToolUseId`. Owners come from loaded
rows in this conversation, including retained completed calls, or the provisional
Agent projection described below. Ordinary ownership does not require current
roster membership. Roots and mixed text/tool siblings retain their relative arrival
order, including interleaved parallel agents. Each attributed reply appears once
under its owner, using the existing assistant bubble and meta row at child indentation;
parentless replies retain their ordinary rendering and relative order.

A missing parent leaves the tool or reply at the root until a history prepend supplies
its Agent/Task owner; regrouping uses the same retained item without duplication.
A reference to an ordinary tool also stays flat. Iterative traversal
and disconnection of cyclic parent links keep every row reachable; identifiers are
Map equality hints within this conversation, never authority or DOM attributes.
Indentation uses `--space-4` per level, capped at two levels (16px and 32px with the
current tokens). Deeper descendants retain their full ancestry for visibility and counts.

New groups start collapsed. `hasChildren` controls disclosure independently of the
distinct descendant tool count: a pending Agent/Task with only text still has a
chevron and a “running · 0 tools” count. Assistant text never adds to the count.
Headers retain the call description and count distinct descendant tool-use ids,
excluding the parent. For ordinary groups, `running` remains visible while the parent
or any descendant tool has neither a result nor a denial. Both readings update while
collapsed. Expanding a pending group reveals children without drawing an empty result
body; nested groups keep their own collapse state. Text is hidden while its owner
is collapsed, visible when expanded, and hidden again on collapse.

### Started background agents

A connect roster's exact `local_agent` task with a usable launch id immediately
supplies one provisional full Agent row at the bottom, before either a start frame
or launch history. Placement prefers the latest nonempty roster id, falling back to
a known usable started id; neither means no new provisional row. The existing Agent
header uses the held description and “running · 0 tools” treatment, without a launch
marker until a real call loads. See
[retained lifecycle evidence](background-task-roster-store-internals.md#retained-agent-timeline-evidence)
for qualification and ownership.

`withProvisionalAgents` adds synthetic display items after queue folding, never to
stored timeline state or saved history. A later live or historical call named exactly
`Agent` with the matching id replaces synthesis, attaching its marker and children
to the same full row without duplication. Any loaded matching non-Agent suppresses
provisional Agent presentation and retains ordinary rendering. Foreground calls,
`Task`, other task types and unlisted/unconfirmed starts keep their existing behavior.
Ids compare exactly without trimming or coercion within the conversation and owning
host; they remain inert equality hints, never authority, DOM attributes or selectors.

The launch position becomes a one-line “Agent started, still working” marker with
the Agent description and “Go to agent ↓”. The whole marker is a native button:
pointer activation or Enter/Space scrolls the destination Agent's full row into view,
without expanding it or any enclosing collapsed tool run. This effect runs
after the parent's scroll-pin layout pass so explicit navigation wins. The description
is escaped plain text, bounded to 4096 characters and ellipsized; the action keeps its
width. Refs and row keys use retained client-owned identities, never daemon ids as DOM
attributes or selectors.

While running, full Agent groups follow all ordinary rows, including user and queued
messages, in established evidence order. Already-received start order stays authoritative;
new connect-only entries append in initial roster order. Later starts/confirmation,
roster refresh or older launch history never reshuffle established rows.
Descendants and attributed assistant text
move with their group; text adds no tools. The background lifecycle controls the
header's distinct descendant count and running treatment independently of “Async agent
launched” resolving the parent or gaps between child calls. A childless Agent shows
“running · 0 tools”; background treatment removes launch-pending dimming and elapsed
timing. Markers and background roots break folded tool runs, while visible live rows
reuse the existing joined borders.

The first received update whose status is exactly `completed`, `failed` or `stopped`
settles the full group at that update's chronological position, before later ordinary
arrivals. Equal boundaries follow terminal arrival order, rather than start order.
The launch marker reads “Agent finished” with a green dot and retains navigation;
the full header shows the tool count without “running”. Roster omission cannot finish
an Agent, and repeats cannot move or revive an established finish. Placement survives
roster removal before the update, inactive-conversation delivery and late launch/child
history. Launch markers remain chronological anchors: confirming a newer Agent must
not move its marker above an already settled group. See
[placement and history limits](conversation-timeline-store-limits.md#edge-cases-and-limitations).

Retained row identity preserves expansion through provisional-to-loaded attachment,
relocation, prepends and late children. A pinned thread follows live-row growth;
a scrolled-up thread holds the reader's position until explicit navigation.
`readSavedTimeline` contains no task frames and keeps its existing saved format and
placement. A saved Agent/result alone cannot recover this lifecycle.

Daemon pages reconstruct finished rows when a valid historical start names exactly
`local_agent`, has a nonempty tool-call id matching a loaded call named exactly
`Agent`, and joins an exact `completed`, `failed` or `stopped` update. Current roster
membership is unnecessary. Finish, start, launch and children can load on separate
newest-first pages; unmatched evidence stays retained without creating historical
running/provisional rows. Foreground, other-type, empty-id and matching non-Agent
calls keep ordinary placement. Existing connect-roster provisional rows can still
attach their late launches, retaining established start order and roster fallback.

The full historical group settles at its first retained terminal entry, above later
ordinary rows; tied anchors follow chronological finish-entry order. Its launch
marker reads “Agent finished” and uses the retained historical start description,
escaped and bounded to 4096 characters through the existing marker. Older launch/child
pages reuse the same row/marker and client-owned identity, without moving an established
finish or losing expansion/navigation. History overlapping live evidence keeps one
row and marker; replay never revives finished evidence or changes roster/panel/pill
membership or live turn state. A historical start/launch followed by the first live
terminal also qualifies without roster membership, retaining the live finish under
later historical replay. See [retained qualification](background-task-roster-store-internals.md#retained-agent-timeline-evidence)
and [ordinary-row/echo anchors and host/reset boundaries](conversation-timeline-store-internals.md#background-agent-history-placement).

Durable history admission/persistence and automatic newest-page requests remain
with #1814/#1815; memory-only lifecycle joins from daemon pages do not change saved
snapshots.

### Expansion identity

`Timeline` controls expansion for **every** tool row. Ordinary rows use retained client-owned
numeric identity at their source item index. For retained Agent evidence, `agentKeys`
remembers the first observed UI key: an existing ordinary key if already loaded,
otherwise `agent-${identity}` from its client-owned numeric identity. Late launch
attachment reuses that key, keeping the wrapper mounted and expansion intact.
Store resets never recycle these identities: a fresh provisional row must not inherit
an old mounted Timeline's expansion. Queue projection can change display indices;
ancestor and run lookups must resolve through `FoldedRow.itemIndex` too. The fallback for
callers without retained keys is `firstRowKey + itemIndex`. Separate leaf and group state would close an expanded
leaf when history gives it its first child. Tool and attributed-text wrappers stay
under one React parent and remain mounted while hidden, preserving child-result
and inner-group expansion
through outer collapse, results, history prepends and regrouping. The mounted timeline
is keyed by conversation, so this UI state cannot leak into another conversation.

Run expansion uses a separate local `expandedRuns` set with the same origins. Opening
marks the first root origin; a run stays expanded when **any** surviving member origin
is marked. A history prepend can introduce an earlier root or a previously missing
Agent owner, changing the header's key without changing existing member origins.
Checking only the current first root would close the run in that case. Closing clears
markers for **all** current run members, so an older mark cannot reopen it. Appends,
results and closing/reopening the run preserve each member's independent expansion;
run membership never depends on whether an inner Agent group is open.
See [history prepend identity](conversation-timeline-store-limits.md#edge-cases-and-limitations).

`hiddenRows` checks every ancestor's tool expansion **and** enclosing run expansion,
as well as the row's own run. Run membership contains tool indexes only: checking
just an assistant row's membership leaves its reply visible when an expanded owner
is hidden by a collapsed tool run. Reopening the run restores the owner's held
expansion and its text without another toggle. The two controls must be exercised
together; owner-only collapse coverage cannot detect that leak.

### Visible tool-row joins

Join decisions follow visible neighbours at the same **capped** indentation, skipping
collapsed descendants and undrawn `turnBoundary` items. With `foldTools` enabled,
undrawn informational banners are skipped too; optional-off joins retain their prior
reading. An expanded run header joins its first root member using the same wrapper
classes, with the header above the member stack. A visible non-tool row or a
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
distinct counts, denial completion and reducer/history attribution. It also covers
mixed assistant/tool order, two parents sharing a turn, parent-aware
tail growth, text-only disclosure, ordinary-tool fallback, late completed owners
and version-1 snapshot grouping. Static markup
cannot prove retained interaction or border geometry. `e2e/tool-groups.spec.ts` drives
interleaved live calls, nested expansion, result resolution and history regrouping;
it also measures joins through collapse and child-result expansion, including plain
borders on both sides of a failed row at a collapsed-group boundary. Keep the ordinary
stack assertion in `e2e/tool-row-toggle.spec.ts`: unchanged inner ToolRow markup did
not prevent the wrapper regression. Fake transport proves this client behavior; no
additional live-Claude acceptance gate is needed.

Background lifecycle units in `backgroundAgentTimeline.test.ts` and
`groupToolRows.test.ts` cover roster provenance, retained first finish/order, exact
qualification, projection and queued receipt chronology. Static Timeline coverage
checks escaped marker content and a zero-child running row; it cannot exercise
navigation or scrolling. The dispatcher gate at
`a85d004b2144461c7fb65716e469797f471ebf11` on 2026-10-07 executed 327 fake-transport tests:
327 passed, 0 failed, 4 skipped. Its named
“started background agents follow the tail, navigate markers, and settle on inactive
delivery” test in `e2e/tool-groups.spec.ts` is present and passed, covering pointer and
Enter/Space navigation, expansion, pinned/held scrolling, inactive delivery, late
confirmation, equal-boundary finishes and composer-driven queued settlement with
mounted identity retained. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1843#issuecomment-6032197466)
confirms that evidence; no live-Claude acceptance was required.

Connect-roster coverage adds parser cases for missing/empty/exact ids and malformed
non-strings, actual-store provenance/fallback/reset checks, and projection/static
render checks for provisional descriptions, exact joins, matching non-Agent suppression,
late children and retained finish order. Static renders cannot prove DOM continuity.

For reviewed head `1887ed4a8de85e0cc02f3b6ddee5ab1fa93582bb`, the
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1847#issuecomment-6032797140)
records a focused `e2e/tool-groups.spec.ts` run: 4 executed, 4 passed, 0 failed,
0 skipped. All four named tests in that spec were present and passed:

- “interleaved subagents group, update while collapsed, and retain expansion through history”
- “visible tool rows keep joined borders across collapsed descendants”
- “started background agents follow the tail, navigate markers, and settle on inactive delivery”
- “connect roster Agents appear before history and keep identity through live and historical launches”

The connect test covers pre-history rows, non-Agent suppression, live/history launches,
same mounted row/expansion, late children, pointer/Enter/Space marker navigation,
roster removal and inactive-chat finish without duplication. The existing lifecycle
test retains pinned growth, held scrolled-up position and equal-boundary terminal
ordering. Separately, the dispatcher full fake-transport gate on 2026-10-07 at the
same head recorded 328 executed, 328 passed, 0 failed and 4 skipped; the focused
counted run supplies the named-test evidence above. Live Claude was not run or required.

The same verdict records comparison with
[Figma background Agent states](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=789-10437)
for running and finished captures at 1280×800 and 800×600. Typography, joined borders,
counts, chevrons and retained placement matched the reused treatment, with no in-scope
deviation. Builder captures were `two-provisional-{1280,800}.png` and
`finished-{1280,800}.png` under `/tmp/builder-1840`; verifier copies/hashes were recorded
in `/tmp/verifier-1847/capture-manifest.json`. These scratch paths are not durable
artifacts; the linked verdict records the reviewed evidence.

Finished-history coverage in `finishedAgentHistory.test.ts` includes separate-page
start/finish/launch joins, late children, tied anchors, echo mapping, evidence-only
tails and live/history overlap. The history-start → live-terminal → terminal-replay
regressions exercise all three exact terminal statuses and assert unchanged live
membership/turn state and finish identity; testing only live → history misses that
qualification transition.

For reviewed head `eefeb6ffb20ec8aeba135e7b8aa4aeb931557e1a`, the
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1848#issuecomment-6033846146)
records 9,297 unit tests executed/passed, 0 failed and 3 skipped, including all
14 tests in `finishedAgentHistory.test.ts` present and passed. Its browser evidence
records 5 `tool-groups.spec.ts` tests executed/passed, 0 failed and 0 skipped,
including the named “finished agents reconstruct across pages, attach late children,
navigate and preserve the reader” scenario and the four existing scenarios listed
above. The new scenario serves finish, start, launch and child on separate pages;
it checks unique rows/markers, retained DOM nodes/expansion, later-row chronology,
pointer/Enter/Space navigation and a held reader anchor after prepend. The initial
full browser gate recorded 329 executed, 328 passed, 1 failed and 4 skipped; its
unrelated offline-conversation-actions failure passed the dispatcher rerun
(1 executed/passed, 0 failed, 0 skipped). No live-Claude run was required or performed.

The [initial visual verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1848#issuecomment-6033526700)
records comparison with Figma section `789:10437` at 1280×800 and 800×600, covering
finished chronology, green marker, description and Go to agent with no additional
in-scope visual finding. The qualification repair did not change presentation;
the final verdict retains that comparison. Scratch captures under `/tmp/builder-1781`
are not durable artifacts; the verdicts record the evidence.

[`e2e/assistant-parent-text.spec.ts`](../../../e2e/assistant-parent-text.spec.ts)
streams deltas before the owner has a result, then checks text-only and mixed groups,
single occurrence, arrival order, tool-only counts, collapse/expand/collapse and
enclosing-run collapse/reopen. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1791#issuecomment-6003391417)
confirms both tests executed and passed in the 2026-10-05 dispatcher gate at
`fbd9003c4775d5ce00be65917ee0ab84497e238c`: 273 executed, 273 passed, 0 failed,
4 skipped. The tests are “streamed assistant text folds under its owner and follows
expansion without inflating tool counts” and “attributed text follows its owner when
an enclosing tool run collapses”. No real-Claude acceptance is required.
The same verdict records Figma comparison of integrated expanded captures at
1280×773 and 800×773 content viewports, retaining the assistant presentation and
16px child indentation. Scratch captures are not a permanent artifact; the verdict
records the reviewed visual evidence.

Source: [subagent tool groups design](../../specs/architecture/1239-subagent-tool-groups.md)
and [reviewed implementation](https://github.com/pyrycode/pyrycode-desktop/pull/1328);
[assistant parent attribution design](../../specs/architecture/1789-assistant-parent-attribution.md)
and [implementation](https://github.com/pyrycode/pyrycode-desktop/pull/1791);
[provisional live Agent design](../../specs/architecture/1840-provisional-live-agent-rows.md)
and [implementation](https://github.com/pyrycode/pyrycode-desktop/pull/1847);
[finished Agent history design](../../specs/architecture/1781-finished-agent-history.md)
and [implementation](https://github.com/pyrycode/pyrycode-desktop/pull/1848).


## Adjacent tool runs

`ConversationScreen` subscribes to the client-wide
[collapse assistant tool uses preference](collapse-tool-uses-preference-store.md)
and passes it to `Timeline.foldTools`. Settings → Thread defaults the switch on;
off restores ordinary tool rows and existing joins without “Using tools: N” headers.
Turning it on restores folding without restarting, including retained conversations
and those on another paired host. The optional `Timeline.foldTools` prop still
defaults to false: absent or false retains ordinary rendering and joins for other
callers. The persisted preference and expansion remain local presentation, with no
IPC, transport or wire changes.

### Membership and boundaries

[`foldToolRuns.ts`](../../../src/renderer/src/screens/conversation/foldToolRuns.ts)
projects the output of `foldQueuedRows` and `groupToolRows` into runs of at least two
adjacent root tool rows. An Agent/Task counts as one root and retains its owned
tool descendants and indentation. Attributed text follows ancestor visibility
without becoming a tool-run member. A lone root keeps its existing row. Each new run
starts collapsed as “Using tools: N”, where N counts roots only.

Every drawn non-tool ends a run: user/assistant messages, queued rows, warning/error
notices, unrecognized-message notices, session/compaction delimiters and stopped-turn
records. Undrawn turn boundaries and informational banners do not split visually
adjacent roots. Filter for what `TimelineRow` actually draws before deriving runs;
an invisible notice would otherwise create two headers with no visible separator.
Agent expansion does not change membership or N.

### Status and disclosure

The header shows a Primary spinner with the client-owned accessible name `Running`
while any root is running. Agent/Task roots use their existing descendant-inclusive
running reading: a completed parent with an unfinished child keeps the spinner.
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
pins optional-off equivalence, lone tools, drawn/undrawn boundaries (including queued
rows and informational banners), Agent ownership and root status combinations.
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
