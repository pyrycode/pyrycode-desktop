# Conversation shell — turn status surfaces

What the screen shows while a turn is running: the timeline render, the composer status row's single label (thinking/working, retry, compacting, or stalled — folded into one view by #967), and the background-task panel.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Background-task panel (#581, cap and cut display since #582, latest patch since #583)

An openable surface listing the tasks claude has running in the background for the open conversation
— the first reader of [`backgroundTaskRosterStore`](background-task-roster-store.md), shipped and
unread since #573. The store joins three daemon frames (roster, started, updated); this slice reads
only two of the held per-task fields, `description` and `taskType`. Split from #568 (whose panel work
was itself split three ways: #581 → #582 → #583). No Figma node exists for this surface — it is
desktop-only (pyrycode#1241) and the canonical mobile file has no counterpart; visual design is #580's,
so the chrome deliberately reuses the shared `.status-sheet__*` overlay vocabulary as an interim
placeholder rather than anything #580 would have to unwind.

```
.conversation
├── ThreadOverflowMenu > menuitem "Background tasks"    (trigger since #962 — see below)
└── BackgroundTaskPanel (if panelOpen)
    └── BackgroundTaskPanelView
        ├── .status-sheet-overlay__scrim        (onClick → onClose)
        └── .status-sheet  role="dialog" aria-labelledby="background-task-panel-title"
            ├── .status-sheet__handle
            ├── .status-sheet__header             "Background tasks" + close
            └── .status-sheet__body
                ├── entry.droppedTasks > 0    → .background-task-panel__partial     "Partial list (N not shown)"
                │                                 (sibling of the branch below, not nested in any arm — #582)
                └── entry === null            → .background-task-panel__unobserved  "No background-task report yet"
                  · entry.tasks.size === 0    → .background-task-panel__empty       "No background tasks"
                  · otherwise                 → .background-task-panel__list > .background-task-panel__row × N
                                                  (description + taskType, roster order, each field followed
                                                  by .background-task-panel__cut-description / -cut-type
                                                  "Truncated by the daemon" when truncatedFields names it — #582;
                                                  then task.latestUpdate !== null            → one of:
                                                    patch === ''  → .background-task-panel__no-change  "No change reported"
                                                    patch !== ''  → .background-task-panel__patch       <patch text, escaped>
                                                  followed by .background-task-panel__cut-patch "Truncated by the daemon"
                                                  when update.truncatedFields (not task.truncatedFields) names "patch" — #583)
```

**No bridge mount.** Unlike `WorkspacePickerSheet` (which mounts `RecentWorkspacesData` inside itself),
`<BackgroundTaskRosterData />` is already the seventh headless leaf in `App.tsx` — this panel is a pure
reader, and mounting a second data path here would be a second, wrong write path.

**The three-way branch is the ticket's hardest AC**, and is deliberately written on two different
things in this order: `entry === null` (no background-task frame has ever arrived) before
`entry.tasks.size === 0` (observed — nothing alive), before the populated row list. Reaching for
`entry?.tasks` (via `.values()`, `.size ?? 0`, or `?? new Map()`) before branching collapses the first
two readings into one — compiles clean, breaks no other test — which is exactly the collapse
`selectRosterFor`'s `?? null` return refuses to make. Each reading is its **own element with its own
class and copy**, not a shared "empty" element and not `null`: unlike `WorkspacePickerSheetView`'s
not-loaded branch (which renders `null`, since that sheet has other content), this branch *is* the
whole panel body, so a `null` render would read as broken.

**The container** (`BackgroundTaskPanel`) clones the conversation-id idiom `ConversationScreen`'s own
queued-backlog read carries (since [#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009)
retired its `QueuedBacklogControl` container): `activeConversation?.id ?? null` derived inline at the
`ConversationScreen` mount site (no second subscription), a `useMemo`-stable
`selectRosterFor(conversationId ?? '')` selector, and
`useBackgroundTaskRosterStore(selectRoster)`. The `''` sentinel matches no store key, so "no active
conversation" reads as `null` — the correct "never observed" reading — for free. An Escape `keydown`
effect closes the panel; open/closed state is a fourth screen-local `useState` boolean in
`ConversationScreen` (the `pickerOpen`/`channelInfoOpen`/`sheetOpen` twin, [ADR
0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)).

**Trigger.** Originally an icon-only `.background-task-trigger` button (`aria-label="Background tasks"`,
`aria-haspopup="dialog"`), mounted unconditionally as a `StatusRow` sibling — not gated on tasks
existing, since gating would make both non-populated readings unreachable through the UI. Chosen at the
time over the overflow menu, which was then hardcoded to one item, and `WorkspaceChip`'s "Change" button
(self-gates to `null` once the thread has a message — exactly when background tasks exist).

**Retired by #962**, along with `StatusRow` itself: the desktop design draws no home for either
control in the region between the thread and the composer, so both `.background-task-trigger` and
`BACKGROUND_TASK_TRIGGER_LABEL` are deleted. The trigger is now the `Background tasks` item in
`ThreadOverflowMenu`, wired to the same `setPanelOpen(true)` the deleted button called — the panel and
its `useState` cell are untouched, only the affordance moved. This closes the reason the menu was
originally passed over (it now generalises to three items instead of one) — see
[Run-configuration row and background-task trigger retired](conversation-shell-chrome.md#run-configuration-row-and-background-task-trigger-retired-overflow-menu-grows-to-three-items-962)
for the menu's design. Still carries no task-count badge; a badge would need its own roster
subscription, left to #580, which also owns the panel's final trigger and may re-point this one again.

**SECURITY.** For `taskType: local_bash`, `description` is the literal shell command claude ran —
untrusted, model-influenced text the daemon bounds but does not sanitize. Rendered as auto-escaped
React children only: never `dangerouslySetInnerHTML`, never an attribute (not even `title=`), never a
key, never executed or re-shelled. Rows are deliberately non-interactive (no `<button>`, no `onClick`)
so there is no handler for a future "run this" affordance to grow from. The list itself is not treated
as a work list: `entry.tasks.values()` is spread once, inline, into `<li>` children — no join, no
clipboard, no export, no `data-*` attribute carrying a task field. Architect self-review PASS (security-
sensitive label); code review PASS with zero findings.

**Cap and cut display (#582).** Two independent bounds the daemon reports and now displays: a
**partial-list notice** (`.background-task-panel__partial`, `` `Partial list (${entry.droppedTasks} not
shown)` ``) whenever the entry reports a nonzero `droppedTasks`, and a **per-field cut marker**
(`.background-task-panel__cut-description` / `-cut-type`, both reading `Truncated by the daemon`)
immediately after any field a task's `truncatedFields` names. The notice is a sibling of the three-way
branch above, not nested in any of its arms, so it shows whichever branch the task list itself takes —
the placement is the acceptance criterion, since the count belongs to the entry, not to the list. The
marker match is the ticket's central trap: `truncatedFields`' contents cross IPC unconverted, so the
panel holds `task.taskType` but must match the wire string `task_type`, not the held name. Neither
reading is styled as an error — a bounded report is the daemon working as designed, reported honestly.
Architect self-review PASS (security-sensitive label); code review PASS with zero findings. See [#582
codebase notes](../codebase/582.md).

**Latest patch (#583).** The held `latestUpdate: HeldBackgroundTaskUpdate | null` pair — the last field
of `entry` the panel had left unread — now renders as the third element of each row, appended after the
description and task-type fields and their own markers. Three readings, each rendered distinctly:
`latestUpdate === null` (no update has ever matched this task) renders **no element at all**;
`latestUpdate.patch === ''` (claude reported no change — the field always arrives on the wire, so an
empty string is a value, not an absence) renders `.background-task-panel__no-change`, "No change
reported"; a non-empty patch renders `.background-task-panel__patch` holding the patch as **inert,
auto-escaped text** — never parsed, since the daemon truncates it at construction and its own golden
fixture is cut mid-token, so a truncated patch no longer parses. The branch is on `latestUpdate !== null`
then `patch === ''`, never on the patch's truthiness — `{latestUpdate?.patch && …}` would render a
recorded empty patch exactly as the never-updated reading, #582's `droppedTasks` truthiness trap one
field over, quieter still because an empty string leaves no visible trace.

The update's own cut marker (`.background-task-panel__cut-patch`, "Truncated by the daemon") is a
sibling of the two-arm ternary, gated on the same `latestUpdate !== null` guard, and reads **only**
`latestUpdate.truncatedFields` — a second list, over a different vocabulary (`task_id` / `patch`) from
the task's own `truncatedFields` (`task_id` / `task_type` / `description`), matched against a third
`CUT_FIELD_PATCH` constant. Reading the task's list for the patch marker, or the update's list for the
description/task-type markers, compiles and type-checks (both are `readonly string[] | null`) and never
matches — the crossover both directions guard against. Neither list ever reaches the markup; names are
matched, never displayed. No history: `latestUpdate` is latest-wins, one record per task — the panel
does not accumulate patches into a list, a ref, or component state. Nothing here is read as a terminal
signal: this frame family reports no finish event by design, so a task simply stops appearing in the
roster rather than being shown as done, and no copy or class in this slice names completion, failure, or
success. No prop, type, store, bridge or wire change; same `entry` prop #581 shipped. Architect
self-review PASS (security-sensitive label); code review PASS with two non-blocking SHOULD FIX
(both test-coverage gaps, not production defects — see [#583 codebase notes](../codebase/583.md)).

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.

## Structured-stream timeline render (#203)

The render slice (L3) of the Phase-2 structured-streaming vertical (transport [#199](../codebase/199.md)
→ store [#202](../codebase/202.md) → render #203), mounted immediately after `<MessageThread/>`:

```
.conversation
├── MessageThread              messages={useSessionStore(selectMessages).map(toMessageViewModel)}
└── Timeline                   items={useTimelineStore(selectItems)}
```

`Timeline({ items }: { items: readonly ThreadItem[] })` is `MessageThread`'s twin — a pure, exported,
in-file component (props-in/markup-out, server-rendered in tests from an injected `ThreadItem[]`, no
store, no IPC). It reuses `MessageThread`'s scroll region class (`.conversation__thread`) and the
coarse path's daemon-bubble treatment (`.message-row--daemon` / `.bubble--daemon`) verbatim — no new
bubble styling. `ThreadItem` (from [thread-timeline](thread-timeline.md)) is already the render model
(camelCase, `conversation_id`-free, ADR 0008), so the container passes `selectItems`'s result straight
through — no adapter, unlike the coarse path's `toMessageViewModel`.

Per-item render, by `kind`, with **no `default`/`assertNever`** (an exhaustive switch that degrades an
unsourced-today kind to `null` rather than throwing — the render-path counterpart to the store
bridges' hard `assertNever`, see [#203 codebase notes § Patterns established](../codebase/203.md)):

- `assistantText` → one bubble, carrying `data-thread-role="assistant"` as the test hook
  (`MessageThread`'s `data-message-role` counterpart). Since [#609](../codebase/609.md), the bubble
  forks on the same `inProgress` prop the streaming cursor below reads — no new state:
  - **In progress** (the tail, still growing): unchanged from #199/#607 — text as React children
    (never `dangerouslySetInnerHTML`, so HTML inside a delta renders as visible characters), plus the
    dedicated `.bubble--assistant-text` modifier (`white-space: pre-wrap`) so a multi-paragraph reply
    keeps its blank lines and space runs instead of collapsing to one run-on line. Hung on its own
    class rather than `.bubble--daemon` so the four chrome affordances below
    (thinking/stall/api-retry/compacting) and the coarse path's `.bubble--user` stay structurally
    unreachable by the rule.
  - **Settled** (every other item, and the tail once its turn's `turn_end` arrives): renders through
    [`AssistantMarkdown`](assistant-markdown-renderer.md) (#608, wired in by #609) inside a
    `<div className="bubble__markdown">` — a flex column with `gap: var(--space-2)` for Figma `16:43`'s
    8px block rhythm, `margin-block: 0` on direct children (`index.css` resets only `body`, so UA block
    margins would otherwise stack on top of the flex gap), and `pre { white-space: pre-wrap }` so
    fenced code wraps within the bubble's measure instead of spilling out of it. `bubble--assistant-text`
    is **not** carried here — the settled branch never gets the class at all, making "markdown owns the
    whitespace" true by construction rather than by an override one level down. `React.memo` was
    considered and declined (unmeasured cost, no test tier in this repo can observe a skipped
    re-render); the seam is named in a code comment at the render site.

  The fork exists because the daemon emits one event per *complete* content block and the store
  coalesces a turn's deltas in place, so a settled item's text is always a whole document — a fenced
  block never arrives half-open — while the in-progress tail must never be shown half-parsed, which is
  why it stays plain text permanently rather than gaining markdown once "enough" of it has streamed in.
- `toolCall` → the tool-row chip ([#218](conversation-shell-tool-rows.md#pending-tool-call-row-218), below) — no longer a no-op as
  of that ticket; the resolved success/error treatment ([#230](conversation-shell-tool-rows.md#resolved-tool-call-row-230), below)
  lifted the pending dimming and added the error accent.
- `turnBoundary` → `null` (structural only; Figma has no per-turn divider).

**Streaming cursor** (Figma `16:56`, glyph `▎` U+258E): a trailing `<span class="bubble__cursor"
aria-hidden="true">` inside the in-progress bubble, rendered only on the tail item when
`item.kind === 'assistantText'` — derived from array position, never from `selectPhase` (which had no
source at the time; [#214](../codebase/214.md) later wired one up, but this render still doesn't read
it — the thinking indicator is a separate, still-open slice). CSS blink guarded by
`@media (prefers-reduced-motion: reduce)`. Since #607's `pre-wrap` rule, a reply whose text ends in a
newline now carries the cursor onto the following line — the whitespace rule working as intended, not
a regression; the cursor `<span>` sits flush against `{item.text}` in the JSX with no intervening
whitespace so no extra blank line is introduced by the markup itself.

**React key = array index**, deliberately: the reducer's `appendDelta`/`fillResult` invariants
guarantee the list is append-only with tail-mutation, never reordering or inserting mid-list, so index
identity is stable per logical item (`turnId` alone would collide once #205 lets a tool split one turn
into two `assistantText` items; a text-bearing key would remount the growing bubble every delta).

**Strangler-Fig coexistence at ship time, not a cutover** — as originally shipped, `Timeline` sat
directly beside `MessageThread`; the coarse path was completely untouched and stayed the *live* one,
`Timeline` returning `null` on an empty `items` array (not an empty `<div>`) for zero layout footprint
so the thread was pixel-identical to before this ticket. The store stayed empty in production until
`interactive` flipped (a non-interactive v2 connection receives no structured stream), so this entire
render path was inert at ship time.

**Reconciled in [#179](../codebase/179.md):** the client hello now advertises `interactive`, the coarse
`message` fan-out stopped daemon-side, and `MessageThread` was retired rather than left as an empty
dead region — `Timeline` is now the conversation's single thread surface. See
[The interactive flip + thread cutover](conversation-shell-conversation-and-modals.md#the-interactive-flip--thread-cutover-179) below and
[#203 codebase notes](../codebase/203.md) for the original design and code review record.

## Thinking / working indicator (#215, held for the whole running turn since #648, tool-named since #649, opens on send since #650, folds in retry, compacting and stall since #967)

`Timeline`'s structural twin over the coarse `phase` scalar (`TurnPhase`, [ADR 0008](../decisions/0008-thread-timeline-model.md))
rather than the `items` list. Through #796 it mounted immediately after `Timeline`; **since
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796) it mounts as the sole child of
`ComposerStatusArea`**, the fixed-height row directly above the composer — see [Composer status
row](conversation-shell-composer-status.md#composer-status-row-796) below for the row itself. **Since
[#967](https://github.com/pyrycode/pyrycode-desktop/issues/967) this is the row's only occupant, full
stop** — the region between `Timeline` and the queued backlog, which through #796 still held three loose
null-at-rest bubble blocks (`ApiRetryIndicator`, `CompactingIndicator`, `StallIndicator`, see below), is
now empty, and their copy is a wider `state` union on this one view instead:

```
.conversation
├── Timeline                   items={useTimelineStore(selectItems)}
└── ComposerStatusArea         isRunning={isTurnRunning(phase)}
    └── ThinkingIndicator      state={workingIndicatorStateWithLocalSend(
                                         { phase, apiRetry, compacting, stalled }, localSendPending)}
                                toolName={openToolName(items)}
                                retry={apiRetry}
                                thinkingTokens={thinkingTokens}
```

The daemon opens a turn with `turn_state{thinking}` before any `assistant_delta` (pyrycode #632), so
during that window `Timeline` is `null` (no items yet) and, before #215, the thread showed nothing — a
slow turn was indistinguishable from a stalled one. `ThinkingIndicator({ state })` is `Timeline`'s twin:
pure, exported, in-file, server-rendered from an injected value, never a store read of its own. `state
=== null` → `null` (zero footprint, the `Timeline`-on-empty-`items` precedent) — **as of #796, "zero
footprint" describes the label only, not the row**, since `ComposerStatusArea` always renders and holds
its height regardless (AC2, see below); otherwise a single `<span
className="conversation__thinking composer-status__label">` (a `<div className="bubble bubble--daemon
bubble--thinking">` through #796; the bubble treatment retired when the label moved into the row — see
[Composer status row](conversation-shell-composer-status.md#composer-status-row-796)) with `THINKING_COPY` (`'Thinking…'`) when `state ===
'thinking'` or `WORKING_COPY` (`'Working…'`) when `state === 'working'`. The label now inherits
`--color-primary` from the row's `.composer-status__activity` group rather than carrying its own muted
tint — both labels are still static, client-owned constants, never `phase` itself.

**Union input, not `phase` and not a `string` — the label CHOICE stays a type-level guarantee; naming
the tool is a deliberate, narrow exception to it, since [#649](../codebase/649.md).** The view's `state`
prop is `state: WorkingIndicatorState | null`, never `phase: TurnPhase` (which would make the illegal
`'idle'` branch representable) and never a plain `string` (which would reopen the hole the type exists to
close). Through #648 this was "no daemon-supplied string is rendered by this slice, full stop" — the
prop's only inhabitants were two client-owned literals and `null`. #649 named the daemon's currently-open
tool in the label (per the operator's 2026-08-20 decision: the tool row two lines above the indicator
already renders the same `name` as an escaped inert React child, so the indicator adds no new exposure)
and had to reverse that guarantee to do it. What survives, narrowed rather than dropped: the **label
choice** (`state`) is still a closed client-owned union — **widened from two members to five by #967**
(`'thinking' | 'working' | 'retrying' | 'compacting' | 'stalled'`), and #967's own comment is explicit
that this is a *different* act from the one #649 refused: every added member is another client-owned
literal, so the label choice stays a closed set of this file's own constants rather than dissolving into
the daemon's vocabulary. The daemon's two contributions still ride their own separately-typed, *required*
props: the tool name on `toolName: string | null` (`toolWorkingCopy` keeps its client-owned copy around
it, and the name reaches the DOM only as an auto-escaped text child, never through an HTML sink), and —
new in #967 — the retry counter's two integers on `retry: ApiRetryStatus | null` (no string field, so the
"this prop structurally cannot carry a daemon string" guarantee `ApiRetryIndicator` used to hold on its
own is preserved verbatim on the merged view) — and, new in [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314), the running thinking-token estimate on
`thinkingTokens: number | null` (also a bare number, same guarantee). All three are required for
`toolName`'s own recorded reason: an optional prop lets the container silently omit it, and nothing in
this repo could catch that since every container test renders the initial store, so `tsc` is the only
available detector and the type must be the one that fails. **#1314 paid that reason's cost in full**: the
prop's own consumer count is one (the label), but `tsc` making it required is what turned all seventeen
pre-existing `<ThinkingIndicator …>` sites in `ConversationScreen.test.tsx` into compile errors rather than
a silent gap — recorded as the plan's own `## Revisions` entry on why the ticket stayed whole rather than
splitting at that cascade.

**The tool name is scoped to the working/thinking state alone — reversed by #967.** Until #967 the
`state === null` guard was what enforced #493's and #496's supersede rules, and the tool name then won
over the phase-derived copy: `toolName !== null ? toolWorkingCopy(toolName) : …`, safe only because a
live retry or compaction made `state` null and the component returned before reaching the label. Now
that all five states share the one slot, `state === 'retrying'` with a tool still open is *reachable*,
and the old order would have rendered the tool name where the row must say `API_RETRY_COPY`. So one
`const toolLabel = (state === 'thinking' || state === 'working') && toolName !== null ?
toolWorkingCopy(toolName) : null` now drives both the label and the `--tool` modifier — one expression
rather than two conditions that have to independently agree — and the three superseding states outrank
it unconditionally. `{ state: 'thinking', toolName: 'Bash' }` stays well-defined rather than illegal (the
daemon flips to `responding` on the first tool step, so it is a defined edge, not a defended one); an
open tool during a live retry or compaction is now equally well-defined and renders the state's own copy.
No animation shipped (an optional pulse was explicitly non-load-bearing per spec); through #796 the
interim treatment stayed deliberately minimal, since the locked mobile design (`g2HIq2UyPhslEoHRokQmHG`,
node `16-8`) has no dedicated working-indicator node. **#796 is the deferred desktop-design pass this
paragraph used to await** — the desktop layout's own Figma node (`111:3525`) exists, and consuming it
moved the label off the daemon-bubble surface into the fixed-height row above the composer and added the
one genuinely new piece, a turning icon; see [Composer status
row](conversation-shell-composer-status.md#composer-status-row-796) below.

**The label is a single text child in every one of the five states, never constant-plus-span.** That is
load-bearing for the truncation bound: one text run ellipsizes as one unit, so on overflow the client `…`
is truncated away and replaced by the ellipsis the truncation itself draws — two runs would render two
ellipses. `ApiRetryIndicator`'s retired bubble *did* render constant-plus-span (`.api-retry__counter`,
CSS deleted with it), which is exactly why the counter is interpolated into the label's own string
instead (`apiRetryLabel`, below) rather than carried in a nested span — [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)'s running thinking-token estimate takes the identical shape in the thinking
state (`thinkingLabel`, below), for the same reason. The class attribute keeps its
shipped order and appends at most one modifier: `conversation__thinking composer-status__label`, plus
` composer-status__label--tool` in the working/thinking state with a name, or
` composer-status__label--stalled` in the stalled state — mutually exclusive by construction, since
`toolLabel` is `null` in every superseding state.

**Opens locally on send since [#650](../codebase/650.md), closes robustly.** Through #649 the
indicator stayed dark from Enter until the daemon's first event — the composer's optimistic echo
landed as a `userText` timeline item, but `phase` stayed `idle` until `turn_state{thinking}`
arrived, so a slow network round-trip looked identical to a dead app. #650 closes that window with
a new [timeline-store](conversation-timeline-store.md) scalar, `localSendPending: boolean`, set by
the same `userText` dispatch that posts the echo (no new event: that dispatch already *is* the
composer's accept signal). `phase` itself stays daemon-only — a wire mirror, and the one field the
composer's stop variant reads (`InterruptControl` read it here until [#678](https://github.com/pyrycode/pyrycode-desktop/issues/678)
folded the affordance into `Composer`'s own send button; see [Interrupt envelope § The render
affordance](interrupt-envelope.md#the-render-affordance-307-merged-into-the-send-button-by-678)) — so the
local open cannot arm the interrupt affordance. The mount site
now calls a second exported derivation, `workingIndicatorStateWithLocalSend(status,
localSendPending)`, composed *on top of* `workingIndicatorState` rather than folded into
`ThreadStatus`: the daemon's answer wins when non-null, otherwise a pending local send re-calls the
same gate with `phase: 'thinking'` substituted, inheriting #493's/#496's supersede clauses for
free and picking the flicker-free `'thinking'` label (the daemon's first real `turn_state{thinking}`
then changes nothing at the seam). Closes on any daemon `turn_state`, on a reconnect reconcile (the
sharpest form of the #538 hazard — a locally-opened window has no daemon-side edge to wait for at
all if the send never arrives, corroborated by pyrycode #1062), and for free on a timeline `reset`
(conversation switch, unpair). `ThreadStatus`, `shouldShowThinking` and `workingIndicatorState`
stay textually untouched. See [#650 codebase notes](../codebase/650.md) for the full reducer
arm-by-arm classification and the e2e mount-timing repair it also required.

Was dormant until [#179](../codebase/179.md) flipped `interactive` (`phase` stayed `idle` in
production until then, the same posture as `Timeline`); now live. Code review flagged one non-gating
NIT: the label has no live region (`role="status"`), so a screen reader won't announce it appearing,
disappearing, **or its label changing mid-turn since #648, or naming a tool since #649** — still
unaddressed. #796's own spec logged this as an open question rather than a NIT and left it standing on
the same reasoning: a live region beside a rotating icon is its own a11y decision, and no AC has ever
covered it. See [#215 codebase notes](../codebase/215.md) for
the full original design, [#648 codebase notes](../codebase/648.md) for the whole-turn broadening,
[#649 codebase notes](../codebase/649.md) for the tool-naming reversal, patterns established, and the
deferred stale-open-`toolCall` risk (cross-referenced against pyrycode #1243), and
[#650 codebase notes](../codebase/650.md) for the local-send open/close and the e2e mount-timing
repair it forced.

**Gate narrowed in [#493](../codebase/493.md), narrowed again in [#496](../codebase/496.md), broadened
in [#648](../codebase/648.md), composed on — not touched — by [#650](../codebase/650.md), widened into a
four-way precedence by [#967](https://github.com/pyrycode/pyrycode-desktop/issues/967).**
`shouldShowThinking(status)` is unchanged since #496 — `isTurnRunning(status.phase) &&
status.apiRetry === null && !status.compacting` — and after #967 it answers a **narrower** question than
its name once implied: not "does anything show", but whether the *working* label specifically shows,
now that a stall can also occupy the slot. It keeps its name, its `ThreadStatus` parameter, its `boolean`
return, and both supersede clauses textually untouched, deliberately: they are #493's and #496's standing
regression evidence, the predicate is exported and independently tested, and — per #650's own comment,
trued up by #967 — one order living in one function is what keeps the supersede facts from drifting into
two places. It gains **no** `stalled` clause of its own.

**`workingIndicatorState(status)` is where the four-way order actually lives, since #967:**

| Order | State | Why |
| --- | --- | --- |
| 1 | `'retrying'` | a live rising/falling-edge signal — claude is re-attempting a failed API call |
| 2 | `'compacting'` | the same kind of signal; the two never overlap in practice, retry wins if they do |
| 3 | `'stalled'` | a one-shot onset with no clearing frame, cleared only by the next turn activity — the two live signals still outrank it, but it is the more useful of two compatible facts (stalled, working) while it lasts |
| 4 | `'thinking'` / `'working'` | what `shouldShowThinking` + the raw phase decide, tool-named where a tool is open |

```ts
export function workingIndicatorState(status: ThreadStatus): WorkingIndicatorState | null {
  if (status.apiRetry !== null) return 'retrying'
  if (status.compacting) return 'compacting'
  if (status.stalled) return 'stalled'
  if (!shouldShowThinking(status)) return null
  return status.phase === 'thinking' ? 'thinking' : 'working'
}
```

**The first three returns are read *before* `shouldShowThinking`'s running-turn gate, and that ordering
is AC2, not an implementation detail.** All three folded views rendered off their own scalar alone —
`StallIndicator({ isStalled })`, `ApiRetryIndicator({ retry })`, `CompactingIndicator({ isCompacting })`
took no phase at all — so putting the three early returns *behind* the gate would have silently narrowed
three shipped behaviours to only-while-a-turn-is-running. `thread-scroll-pin.spec.ts` pins this by
construction: it pushes a stall onto a turn the primer has already returned to `idle` and asserts the
label still renders. Only the thinking/working label is turn-gated; the three superseding states are not
and must stay that way.

**`ThreadStatus` takes the fourth field #650 declined to take.** #493 built the record as the seam for
exactly this — "one field here, one clause below" — and #496 extended it once already:

```ts
export interface ThreadStatus {
  phase: TurnPhase
  apiRetry: ApiRetryStatus | null
  compacting: boolean
  stalled: boolean
}
```

`stalled` is **required, not optional** — an optional field is precisely the silent-omission hole
`toolName`'s own comment refuses, and the type is the only detector this repo has here, since every
container test renders the initial store. The cost of having a detector at all is that every
`ThreadStatus` literal in `ConversationScreen.test.tsx` gains one token; `tsc` names each one (measured
at 30 call sites once the fold shipped, not the 32 a `grep -c 'compacting:'` estimate had counted before
build — the grep matched two prose lines inside `describe` comments that merely mention the field name;
the compiler's count is the trustworthy one). See § Why the field, not a wrapper, below.

**Why the field, not a wrapper — #650's own comment argued against taking a fourth field, and #967
departs from that reasoning rather than contradicting it silently.** #650 composed
`workingIndicatorStateWithLocalSend` *on top of* `workingIndicatorState` instead of adding a field,
because a field would have broken 19 status literals as pure retyping with not one expectation changed —
literals that are the standing regression evidence for #493's and #496's supersede rules. Both halves
were true, and neither carries to a status in the **middle** of the order. The difference is precedence
position: #650's local-send window is a *lower*-priority fallback, composing on top of a proven gate
without restating anything. A stall sits *below* retry and compaction and *above* the working label, so a
wrapper would have had to re-read `apiRetry` and `compacting` itself to choose between `'retrying'`,
`'compacting'` and `'stalled'` — putting the supersede facts in two places, which is the exact drift
\#650's comment exists to prevent. So #967 took the field, paid the retype, and kept one record, one
function, one order; #650's own comment was rewritten in place so it stops arguing against the code
sitting below it.

**Why broaden rather than add a second indicator.** The daemon emits `turn_state{thinking}` only while
claude is producing thinking text; the first reply token or the first tool step flips `phase` to
`responding`, and no further `turn_state` arrives until the turn ends (pyrycode
`cmd/pyry/interactive_turn_v2.go`). For a tool-heavy turn `responding` is the phase that *lasts*, and it
was exactly the phase in which #215's gate showed nothing — the operator's first real use of the desktop
app (2026-08-20) surfaced this as a screen that looked frozen for most of a turn. Because the client
receives no signal finer than `responding` inside the tool loop, `WORKING_COPY` ("Working…") is
deliberately generic rather than naming tool activity — a copy like "Running tools…" would be a lie
whenever the turn is actually still streaming text.

**Named since [#649](../codebase/649.md): `WORKING_COPY` is superseded by the specific tool name whenever
one is actually open**, closing the operator's remaining complaint that `WORKING_COPY` read identically
for a 40 ms file read and a four-minute build. This doesn't reopen the lie #215 avoided, because it isn't
derived from `phase` at all — it's a direct, independent read of `items` (`openToolName`): a `toolCall`
item carries `name` and starts `result: null`, filled in place when the
correlated `toolResult` arrives. The scan requires both `result === null` and no explicit `denial`,
so "a tool is open right now" and "which one, if more than one" (the
last such item in array order — `items` is append-only, `fillResult` fills in place without reordering)
are both facts already sitting in the store, not an inference over `phase`. `openToolName(items)` is
computed alongside `workingIndicatorState` at the same call site and passed as the indicator's second,
required `toolName: string | null` prop; when it is non-null it replaces the phase-derived copy with
`` `Running ${name}…` `` (`toolWorkingCopy`) rather than sitting beside it, and reverts to the generic copy
the moment no eligible tool remains — a result or an explicit
[denial](conversation-shell-tool-rows.md#permission-denied-tool-call-row) retires a call from
the scan immediately, without another `turn_state`. Denial leaves the turn's working state
and priority rules intact. Renders through a
`.tool-row__summary`-style one-line-ellipsis bound (not `.tool-row__name`'s never-truncates one — see
[#649 codebase notes](../codebase/649.md)) so a long tool name never wraps to a second line or moves the
composer — through #796 via `.bubble--tool-label`, backstopped by `.bubble`'s own `max-width: min(680px,
75%)`; **since #796 via `.composer-status__label--tool`**, and the backstop changed with it: `.bubble` is
gone from this label's ancestry, so the bound is now a three-link flex chain instead — see [Composer
status row § the truncation bound](conversation-shell-composer-status.md#composer-status-row-796) below for the replacement and why it had to
be re-derived rather than copied. One deliberately undefended edge: an interrupted turn can leave a
`toolCall` permanently `result: null`, so the *next* turn's indicator could name that stale tool — the
timeline already shows that call as a permanently pending, dimmed row (#230), so the label would mirror
what's already on screen rather than contradict it; the fix if ever observed is scoping the scan to stop
at the current turn's `turnBoundary`.

### Retired by #967: `ApiRetryIndicator` (#493), `CompactingIndicator` (#496), `StallIndicator` (#317)

Through #796 these three still floated as loose, independently-mounted, null-at-rest bubble blocks
between `Timeline` and the queued backlog — `ThinkingIndicator`'s supersede peers, a relationship always
carried by `workingIndicatorState` reading `apiRetry`/`compacting`/`stalled`, never by DOM adjacency,
which is why #796 could move `ThinkingIndicator`'s own markup down into the composer status row without
touching them. The design draws one row with one label and nothing else in this region — #967 is the
follow-up #796's refiner deferred to keep that ticket small, filed and built here. All three views, their
three mount comments, and seven CSS rules (`.conversation__stall`, `.bubble--stall`,
`.conversation__api-retry`, `.bubble--api-retry`, `.api-retry__counter`, `.conversation__compacting`,
`.bubble--compacting`) are gone; their copy constants (`API_RETRY_COPY`, `COMPACTING_COPY`, `STALL_COPY`)
moved beside `toolWorkingCopy` in the merged view's module, grouped with the fourth and fifth labels
(`THINKING_COPY`/`WORKING_COPY`) they now compete with for the slot — reviewable as one cluster, the
reason `composerSend.ts`'s own chip-copy comment gives for living where it does. `STALL_COPY` is newly
**exported** here — it was the one label of the five still module-private, forcing three separate test
files to assert its literal instead of the constant.

**What the reducer still does is unchanged — only which view reads it moved.** The wire mechanics that
used to be these three components' own explanation now live entirely in [Conversation timeline
store](conversation-timeline-store.md) and its [internals](conversation-timeline-store-internals.md):
`api_retry` carries an explicit `active`/`current`/`total` counter with an explicit falling edge and no
wire-side dedup, held as `ApiRetryStatus | null` and cleared only by that falling edge; `compacting`
carries `{ active: boolean }` with no counter, held as a plain `boolean`, same falling-edge-only clear;
`stall` is onset-only with no clearing frame at all, so `reduceTimeline` self-clears `stalled`
client-side on the next turn-activity event. Turn activity leaves `apiRetry` and `compacting` showing —
the deliberate inverse of the stall's self-clear — and that asymmetry is exactly what
`thread-scroll-pin.spec.ts` still exercises end to end (see the **Thread scroll pin** edge case in
[Conversation shell](conversation-shell.md#edge-cases-and-limitations)).

**The retry counter now folds into the label's one text run instead of its own span.**
`ApiRetryIndicator`'s bubble rendered `API_RETRY_COPY` as a constant with a nested
`<span className="api-retry__counter">` for the counter; the merged label is a **single text child in
every state** (see above), so a module-private `apiRetryLabel(retry: ApiRetryStatus | null): string`
interpolates it into one string instead — `retry === null || retry.total <= 0` returns the bare
`API_RETRY_COPY` (a degrade, not a defence: the container only ever derives `'retrying'` from
`apiRetry !== null`, so this arm is unreachable from there, but the type admits it), otherwise
`` `${API_RETRY_COPY} attempt ${retry.current}/${retry.total}` `` — the same `total > 0` gate the retired
view used, never `current / total` (`NaN` at `0/0`). Both integers are guaranteed JS numbers, not daemon
strings: `parseApiRetryPayload` (`src/main/transport/inboundMessage.ts`) narrows them with
`requireNumber` and throws `WireDecodeError` otherwise, which is also what bounds the interpolation's
length — a JS number stringifies to at most 24 characters. A module-private `statusRowCopy(state, retry,
thinkingTokens)` is the total switch that picks among all five labels, with **no `default`**, so a sixth
`WorkingIndicatorState` member is a `tsc` error here rather than a silently unlabelled row. **The estimate
reaches the `'thinking'` arm alone** — AC2 froze the other four states verbatim, so a retry, a compaction,
a stall and the generic working label never carry it, and neither does the tool-named label (the tool name
already supersedes the thinking copy unconditionally).

**`thinkingLabel(thinkingTokens: number | null): string`** ([#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314)) is `apiRetryLabel`'s sibling, written to the identical shape — the constant, one
hole, one client-owned unit — and reads `` `${THINKING_COPY} ~${shown} tokens}` `` when a reading is held,
the bare `THINKING_COPY` otherwise. The `~` is not decoration: the daemon's own docs call the reading
"approximate progress for spinners/pills, not the authoritative billed output_tokens", so the label must
never read as a number to bill against. `shown` is the reading verbatim below 1000 and rounded to the
nearest hundred at 1000 and above (`1250` → `~1300 tokens`, `1249` → `~1200 tokens`); `0` takes the
ordinary path and renders `~0 tokens` — a reading, not an absence. **Formatted defensively, which is this
arm's stated security obligation, not a style choice**: `requireNumber` at the decode boundary
(`src/main/transport/inboundMessage.ts`) proves only `typeof value === 'number'` — NaN, `Infinity` and
negatives all decode successfully and survive the contextBridge — so `thinkingLabel` degrades to the bare
copy for `null` and for anything that is not a non-negative finite number, the `apiRetryLabel(null)`
degrade posture rather than a throw, since a hostile or buggy daemon must not be able to blank the status
row. Two comparisons, one `Math.round`, one interpolation — no `repeat`, `Array(n)`, `padStart` or loop
bounded by the reading, which is the concrete failure mode a right-aligned formatter written as
`padStart(estimate)` would open (gigabytes allocated from a daemon claim); the plan's security review
carried this forward as a Phase B ban rather than a one-time check. See [Thread timeline § Edge
cases](thread-timeline.md#edge-cases-and-limitations) for the `thinkingTokens` scalar this label reads and
its own non-monotonic contract.

**The stall keeps reading as a problem, but as a colour modifier instead of a bubble role.**
`.bubble--stall` used to carry `color: var(--color-error)` plus a 4px `border-left` accent bar (the
connection-banner/rejection-line precedent); the merged label takes only
`.composer-status__label--stalled { color: var(--color-error) }` — no bar, since a bar was a *bubble*
idiom and there is no fill behind a bare text run for one to bound. Retry and compaction keep the row's
own `--color-primary`, the only colour Figma `111:3523` draws; `--color-error` is the only error-role
token on desktop, so this is within-token — no new token, no literal. Colour-only is also what makes "no
state can move the row" true by construction: no type, box, or line-height changes, so all five labels
occupy identical geometry. **The stall's error colour, and whether retry should share it, was drawn
nowhere in Figma — flagged for Juhana in the PR rather than decided silently; still an open question, not
resolved by this ticket.**

**Co-render is gone by construction, not by a new coordination mechanism.** Through #796 all three could
show at once with `ThinkingIndicator` (mutual exclusion scoped to the working label only, by AC4/AC5 of
\#493/#496) — separate surfaces conveying independent facts. One label slot cannot hold more than one
string, so `workingIndicatorState`'s four-way order (above) replaces "may all co-render" with "exactly
one wins" — a loss of simultaneity, not of any individual fact: a live retry still shows, a stall still
shows, just never two at once. `shouldShowThinking`'s own docblock used to state the old co-render
posture twice; both sentences were removed rather than qualified, since #967 made them false at the
function whose result now actually picks between the four.

**e2e re-points, not new coverage.** `stall-bundle.spec.ts` swapped its `.conversation__stall` /
`.bubble--stall` visibility check for one **exact-text** assertion on the row's label
(`.conversation__thinking`, still the identity hook) plus a class check for
`composer-status__label--stalled` — exact rather than `toBeVisible`, because the label element is now
shared by all five states, so mere visibility proves nothing. `thread-scroll-pin.spec.ts` needed two
separate repairs, covered in the **Thread scroll pin** edge case of [Conversation
shell](conversation-shell.md#edge-cases-and-limitations): its fourth criterion (chrome mounting shrinks
the thread's viewport without un-pinning it) moved off the now-empty stall block onto the queued backlog,
and its stall self-clear assertions switched from `toBeVisible` to exact label text, for the same
shared-element reason as the stall-bundle repoint.

`Timeline`'s `toolCall` arm gained its pending render in [#218](../codebase/218.md): a compact chip —
tool name and one-line input summary — replaces the earlier `case 'toolCall': return null` no-op, at
50% opacity for the unresolved (`result: null`) state. [#230](../codebase/230.md) later taught the
same arm to resolve that chip in place once `result` fills. Both were dormant until
[#179](../codebase/179.md); now live. See
[Pending tool-call row](conversation-shell-tool-rows.md#pending-tool-call-row-218) and
[Resolved tool-call row](conversation-shell-tool-rows.md#resolved-tool-call-row-230) below.
