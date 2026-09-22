# Conversation shell — background tasks

Part of [Turn status surfaces](conversation-shell-turn-status.md).

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
for the menu's design. The `ThreadOverflowMenu` item itself still carries no task-count badge of its
own. [#1435](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435)
gave the panel a second trigger instead — a count pill in the composer status row's trailing slot,
wired to the same `setPanelOpen(true)` this menu item calls — so a badge on the menu item itself, if
ever wanted, is still open, left to #580, which also owns the panel's final presentation and may
re-point either trigger again.

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
signal: `patch` itself carries no finish state, and this slice's `entry` prop never reads
`background_task_updated`'s `status` field. (The frame family does carry one, since #1560/#1561 — it
drives the composer's count pill's second removal path, see [Background-task roster store — internals §
The pill's
count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561) — but this
panel is not that reader: a finished task simply stops appearing here once a roster omits it, and no copy
or class in this slice names completion, failure, or success.) No prop, type, store, bridge or wire
change; same `entry` prop #581 shipped. Architect
self-review PASS (security-sensitive label); code review PASS with two non-blocking SHOULD FIX
(both test-coverage gaps, not production defects — see [#583 codebase notes](../codebase/583.md)).

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.
