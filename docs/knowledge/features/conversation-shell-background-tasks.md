# Conversation shell — background tasks

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Background-task panel (#581, cap and cut display since #582, latest patch since #583)

An openable surface listing the tasks claude has running in the background for the open conversation
— the first reader of [`backgroundTaskRosterStore`](background-task-roster-store.md), shipped and
unread since #573. The store joins three daemon frames (roster, started, updated); this slice reads
only two of the held per-task fields, `description` and `taskType`. Split from #568 (whose panel work
was itself split three ways: #581 → #582 → #583). It shipped with no Figma node — desktop-only
(pyrycode#1241), the canonical mobile file has no counterpart — so the shell reused the shared
`.status-sheet__*` overlay vocabulary as an interim placeholder, deliberately reused rather than
duplicated so that only the outermost wrapper was chrome and every row and branch carried its own
`background-task-panel__*` class with no positional CSS.

**[#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634) swapped that placeholder for #580's
drawer chrome** (Figma node 565:2966): a **non-modal** 360px drawer pinned over the right of the message
area, with no scrim, so the thread keeps scrolling and the composer keeps taking input while it is open.
Because only the wrapper was ever chrome, the swap landed without touching a single list row — the list's
own redraw was the follow-up ticket, [#1635](#list-redraw-1635). The design's circle-xmark close glyph is
drawn as an inline `<svg>`, not an `<img>`: three of this panel's escaping tests assert there is no `<img`
anywhere in its markup, since that absence is how they prove a markup-shaped `description` stayed text, so
any future chrome icon in this view needs the same inline treatment (the empty readings' rings, added by
\#1635 below, follow it too).

```
.conversation
├── ThreadOverflowMenu > menuitem "Background tasks"       (trigger since #962 — opens only, never toggles)
├── ComposerTaskCount (.composer-status__tasks pill)       (toggles since #1634 — see conversation-shell-composer-status.md)
└── BackgroundTaskPanel (if panelOpen)
    └── BackgroundTaskPanelView
        └── section.background-task-drawer  role="dialog" aria-labelledby="background-task-panel-title"
            │                                (non-modal — no aria-modal, no scrim — #1634)
            ├── .background-task-drawer__header   <h2> "Background tasks" + .background-task-drawer__close (inline svg)
            ├── .background-task-drawer__rule
            └── .background-task-drawer__body
                ├── entry.droppedTasks > 0    → .background-task-panel__partial   filled notice, dot + "Partial list (N not shown)"
                │                                 (sibling of the branch below, not nested in any arm — #582; dot added #1635)
                ├── entry === null            → .background-task-panel__reading  ring(dashed) + .__unobserved "No background-task report yet" + .__reading-support
                ├── entry.tasks.size === 0    → .background-task-panel__reading  ring(solid)  + .__empty       "No background tasks" + .__reading-support
                └── otherwise                 → .background-task-panel__groups                                (#1635, TaskGroups)
                                                  ├── running.length > 0  → .background-task-panel__group  <h3> "Running · n" + .__list > .__row × running.length
                                                  └── finished.length > 0 → .background-task-panel__group  <h3> "Finished · n" + .__list > .__row.__row--finished × finished.length
                                                       (roster order within each group; a row is finished when finishedTaskIds.has(taskId); an empty
                                                       group renders nothing, header included; a dropped task has no row and is counted by the
                                                       partial notice alone)

each .background-task-panel__row (TaskRow, #1635):
  .__head → .__type <taskType, mono>  +  .__tag (dot + "Running" | dot + "Finished", .__tag--running | .__tag--stopped)
  .__cut-type "Truncated by the daemon" when task.truncatedFields names task_type — #582
  .__description <description, mono for local_bash, body text otherwise; muted on a finished row>
  .__cut-description "Truncated by the daemon" when task.truncatedFields names description — #582
  task.latestUpdate !== null → .__update ("Latest update" label + .__update-block > .__no-change | .__patch) + .__cut-patch
                                 when update.truncatedFields (not task.truncatedFields) names "patch" — #583
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
conversation" reads as `null` — the correct "never observed" reading — for free. Since #1635 the container
takes a second, sibling `useMemo`-stable read the same way —
[`selectFinishedTasksFor(conversationId ?? '')`](background-task-roster-store-internals.md#the-panels-grouping-read-selectfinishedtasksfor-1635)
— and passes the result down as `finishedTaskIds`; the view stays a pure function of its props and does not
read the store itself.

**Open state lifted into `PairedShell` by #1634.** The drawer is non-modal and takes no focus, so it has
to survive the conversation switch that remounts `ConversationScreen` under `PairedShell`'s `paneKey`. The
boolean moved one level up, beside `paneKey`, and reaches the screen as an optional
`backgroundTasksOpen` / `onBackgroundTasksOpenChange` prop pair — still [ADR
0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) screen-local state, just held by
the parent shell instead of the screen itself. When the props are absent, as at every bare
`<ConversationScreen />` render site the test suite already used, the screen falls back to its own
`useState`, so none of those sites needed to change. Unpairing unmounts `PairedShell` and drops the state;
switching conversations keeps it and re-renders the newly active conversation's roster underneath it.

**Escape is arbitrated, not just handled, since #1634.** The container's `document` listener moved to the
**capture** phase (`addEventListener('keydown', onKeyDown, true)`), which runs before React's root
listener and before any bubble-phase document listener, so a press the drawer takes never reaches the
options overlay, a type-ahead, or any other claimant. Whether a given press is the drawer's is decided by
the exported pure predicate `drawerClosesOnKeyDown(keystroke, { inComposerStop, turnRunning })`: false for
a non-`Escape` key or mid-IME-composition, and false when focus is on one of the composer's own #1072 stop
bindings (`.composer__input`, `.composer__send`) and the composer's own `shouldInterruptOnKeyDown`
predicate says that Escape will stop the running turn — the drawer asks the composer's predicate rather
than restating it, so the two cannot disagree about which press belongs to which. Everywhere else, Escape
closes the drawer. The container gained a `turnRunning: boolean` prop, wired from `ConversationScreen` as
`isTurnRunning(phase)`, the same gate the stop button itself uses. One interaction is accepted rather than
fixed: `stopPropagation` on a press the drawer takes means a modal overlay stacked over it (the markdown
reader, Run configuration, Channel info) needs a **second** Escape to close, since the first one only
closes the drawer beneath it — "one Escape does one thing" per press, not per overlay stack.

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
gave the panel a second trigger — a count pill in the composer status row's trailing slot, originally
wired to the same `setPanelOpen(true)` this menu item calls. **[#1634](https://github.com/pyrycode/pyrycode-desktop/issues/1634)
re-pointed the pill to toggle instead** (`setPanelOpen(!panelOpen)`) and gave it a Primary outline while
open — see [Background-task count pill](conversation-shell-composer-status.md#background-task-count-pill-the-slots-last-occupant-1435).
The menu item is unchanged: it still only opens, never closes. A badge on the menu item itself, if ever
wanted, remains open.

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

**List redraw (#1635).** #580's drawing for the populated arm — cards, a status tag, a latest-update code
block, the dashed cut chip, the filled partial notice and the two ringed empty readings — landed on top of
the three-way branch and the field-level rules #581/#582/#583 already established, none of which moved:
the branch order, the cut-marker pairing, the never-updated/empty-patch/patch distinction and the crossover
guard between a task's own `truncatedFields` and its update's are all unchanged, only re-styled and
re-wrapped in new elements. Two things did change:

- **Running vs. Finished is a partition of the same list, drawn once, module-private.** `TaskGroups`
  filters `[...entry.tasks.values()]` twice — once for `!isFinished`, once for `isFinished` — rather than
  threading a third state through the existing map, so roster order is preserved inside each partition for
  free (the held `Map`'s insertion order, unchanged). A row is finished when
  `finishedTaskIds?.has(task.taskId) === true`, the same `!== true` / `=== true` discipline
  `selectLiveTaskCountFor` already uses for the same set, for the same reason:
  `finishedTaskIds?.has(id)` alone is `boolean | undefined`, and an `undefined` reads as falsy either way
  used bare, but the explicit comparison is what keeps a future find-and-replace from turning `!isFinished`
  into something that silently inverts on `undefined`. Each count (`` `${label} · ${tasks.length}` ``) is
  the partition's length, so a dropped task — which has no `HeldBackgroundTask` and therefore no row — is
  never counted by either header; it is counted by the partial notice alone, the same separation #582 drew
  between the roster's `droppedTasks` and its `tasks`. An empty partition renders nothing, `TaskGroup`
  included, so an all-running roster shows no "Finished" text anywhere in the markup — load-bearing for the
  #583-era AC4 sweep that a running-only render must contain none of
  `completed|complete|failed|failure|succeeded|success|finished|error`: `finished` now appears only on a
  finished row's own class, the Finished header, and the Finished tag.
- **The class-name collision constraint is why the code block is `__update-block`, not `__patch-block`,
  and why the reading wrapper is `__reading`, not `__empty-state`.** #581–#583's shipped tests assert
  substrings — `not.toContain('background-task-panel__patch')` on an empty-patch render,
  `not.toContain('background-task-panel__cut-')` on an uncut render, `not.toContain('background-task-panel__empty')`
  on the unobserved render — so a redraw that reused those substrings as a *prefix* of a new class would
  have made an old negative assertion fail on markup the ticket didn't even touch. The container element for
  a patch/no-change pair is named around the concept (`update`) rather than around either reading inside
  it, and the two empty readings share one wrapper class (`__reading`) that names neither of the two
  existing leaf classes (`__unobserved`, `__empty`) it wraps. Any later redraw in this panel inherits the
  same constraint: check the shipped substring assertions in `BackgroundTaskPanel.test.tsx` before choosing
  a new class name, not just the classes currently in the markup.

The Finished tag wears the **Stopped** style (`--tag--stopped`, Secondary Container fill) under a neutral
"Finished" label — not a status word — because the daemon's actual `completed` / `failed` / `stopped`
distinction is #1639's to map; this ticket only had `finishedTasks` membership (a boolean), never the
`status` string itself. The per-row progress lines the Populated and Capped Figma frames also show belong
to #1640, and are not drawn here either. `tokens.css` gained `--color-secondary` (#bac8da, M3 Secondary,
dark scheme) for the group headers — the palette had no existing token that matched it.

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.
