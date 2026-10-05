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
  .__head → .__type <formatTaskType(task.taskType), mono>  +  .__tag (task.status mapped to a label + one of four classes — #1639,
                                                   see § Status tag and summary)
  .__cut-type "Truncated by the daemon" when task.truncatedFields names task_type — #582
  .__description <description, mono for local_bash, body text otherwise; muted on a finished row>
  .__cut-description "Truncated by the daemon" when task.truncatedFields names description — #582
  trimmedDescription = task.description.trim()
  finished && task.summary !== null && task.summary.text !== '' &&
    (trimmedDescription === '' || !task.summary.text.trim().includes(trimmedDescription))
                              → .__summary <task.summary.text> + .__cut-summary
                                 "Truncated by the daemon" when task.summary.truncatedFields names "summary" — #1639
                                 (repeated summaries and their cut chips are hidden together — #1754)
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

**\#1656 named the conversation's agent in the `entry.tasks.size === 0` support line.** "Claude has
nothing running in the background for this conversation." became a Claude/Codex pair
(`BACKGROUND_TASK_PANEL_EMPTY_SUPPORT` / `_EMPTY_SUPPORT_CODEX`), chosen by a new `agent?: WireAgent`
prop on `BackgroundTaskPanelView` and `BackgroundTaskPanel` (default `'claude'`). `ConversationScreen`
passes its `openAgent` straight through, the same value `<Timeline>` gets. The `entry === null`
"No background-task report yet" support line is unaffected — it does not name an agent — so the
three-way branch above keeps its shape.

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
signal: `patch` itself carries no finish state, and — as of #583 — this slice's `entry` prop never read
`background_task_updated`'s `status` field. (The frame family did carry one, since #1560/#1561 — it drove
only the composer's count pill's removal path, see [Background-task roster store — internals § The pill's
count](background-task-roster-store-internals.md#the-pills-count-selectlivetaskcountfor-1561) — and as of
\#583 the panel was not that reader: a finished task simply stopped appearing here once a roster omitted
it, and no copy or class in this slice named completion, failure, or success. **#1639 changed this**: the
row now reads `task.status`/`task.summary` and draws Completed/Failed/Stopped styling and a finished row's
summary text — see § Status tag and summary below. Grouping itself is still #1635's `finishedTaskIds`, not
`status`.) No prop, type, store, bridge or wire change from #581; same `entry` prop, widened by #1639.
Architect
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

As shipped by #1635, the Finished tag wore the **Stopped** style (`--tag--stopped`, Secondary Container
fill) under a neutral "Finished" label — not a status word — because this ticket only had `finishedTasks`
membership (a boolean), never the `status` string itself; mapping the daemon's actual `completed` /
`failed` / `stopped` distinction was left to #1639 (below). The per-row progress lines the Populated and
Capped Figma frames also show still belong to #1640, and are not drawn here. `tokens.css` gained
`--color-secondary` (#bac8da, M3 Secondary, dark scheme) for the group headers — the palette had no
existing token that matched it.

## Task type labels (#1746)

`TaskRow` renders a readable label in `.background-task-panel__type` through the module-private,
pure `formatTaskType` in `BackgroundTaskPanel.tsx`:

- Exact `local_agent` → Agent; exact `local_bash` → Command.
- Other values remove one leading `local_`, replace every underscore with a space, and uppercase
  only the first character: `local_file_watch` → File watch, `agent_search` → Agent search.
  `remote_local_agent` → Remote local agent and `local_local_agent` → Local agent show that only
  one leading prefix is removed. Later words retain their casing.
- Empty results stay empty, including inputs `''` and `local_`.

Formatting is confined to that span's auto-escaped React text child; a markup-shaped unknown type
stays text and never enters an attribute. The span retains its mono font and primary color. The wire
payload, raw `task.taskType` and held roster state stay unchanged. Description styling still compares
the raw type with `local_bash` to select mono; using the display label for that comparison would lose
command styling. Grouping and truncation markers keep their existing rules.

`BackgroundTaskPanel.test.tsx` covers the mapping with independently stated expected labels in static
renders, including prefix handling and empty values. Each case renders a frozen task, compares the
entry with its pre-render clone, and checks task identity and the raw type. A markup-shaped unknown
type checks escaping and absence from attributes; separate assertions retain command-versus-agent
description styling. Computing expected labels with the same transformation would let a wrong mapping
pass on both sides; these tests pin the rendered span instead. See [renderer test boundaries](development-verification.md#what-each-test-tier-proves).

## Status tag and summary (#1639)

Closes the "stays unread" hand-off the bridge doc comment named since #1561: `backgroundTaskUpdated`'s
`status` and `summary` now reach the row, held on `HeldBackgroundTask` itself (`status: string | null`,
`summary: HeldBackgroundTaskSummary | null` — see [Background-task roster store — internals § How it
works](background-task-roster-store-internals.md#how-it-works)), separate from the `finishedTasks` set
that still alone decides grouping and the count.

`TaskStatusTag` takes `status: string | null` in place of the #1635 `finished: boolean`:

- `null` (no status word has ever arrived) → Running, `--tag--running`.
- `'completed'` / `'failed'` / `'stopped'` → their own label and class (`--tag--completed`,
  `--tag--failed`, `--tag--stopped`), looked up in a module-level `TASK_STATUS_TAGS` `Map` and matched
  only by `Map.get`/`===` — the daemon word is the lookup key, never templated into a class string the way
  `ReadingRing`'s `--${variant}` does for a client-owned union.
- Any other non-empty word → the word itself, auto-escaped, in the `--tag--stopped` class
  (`TASK_TAG_UNKNOWN_CLASS`). The class is always one of these four literal strings; only the row's own
  group membership (`finishedTaskIds`, unchanged from #1635) decides whether that row sits under Running
  or Finished, so an unrecognised word still counts and displays as Running even while its tag shows the
  raw text.

A finished row with a non-null, non-empty summary draws `.background-task-panel__summary` straight
after the description and its cut chip, unless the summary repeats the description. Since
[#1754](https://github.com/pyrycode/pyrycode-desktop/issues/1754), `TaskRow` compares
`task.summary.text.trim().includes(task.description.trim())`, case-sensitively, only when the trimmed
description is non-empty. A match hides both the summary and its cut chip: an exact repeat or a template
such as `Agent "Review relay changes" finished` adds no line below `Review relay changes`. A summary
without that substring, including a distinct failure/stop reason or a case-different summary, remains
visible. Empty and whitespace-only descriptions retain non-empty summaries; testing `includes('')`
without this guard would hide every summary for those rows. Only leading and trailing whitespace is
trimmed for comparison; internal whitespace is unchanged. This is a display rule: held task and summary
data stay untouched, and retained `task.summary.text` renders verbatim as an auto-escaped child — never
mono, unlike the `local_bash` description. Its own
cut report, `wasCut(task.summary.truncatedFields, CUT_FIELD_SUMMARY)`, draws the existing dashed cut chip
(now `.background-task-panel__cut-summary`) straight after it, the same `wasCut`/`CUT_FIELD_*` pattern
\#582/\#583 established for `task_type`/`description`/`patch` — `CUT_FIELD_SUMMARY` (`'summary'`) is matched
only against `task.summary.truncatedFields`, never `task.truncatedFields`, the same crossover trap #583
already documents for the patch marker. An empty summary (`text === ''`) draws no line; a running row
never draws one, since the `finished` guard is checked first. Neither draws a summary cut chip.

`BackgroundTaskPanel.test.tsx` has four static-render regression tests for this display rule:

- Template and exact repeats disappear with their summary cut chips, while the description and status
  remain. Frozen held records retain their contents and summary identity after rendering.
- Different failure/stop reasons and case-different summaries remain verbatim with their cut chips.
- Empty and whitespace-only descriptions still show a non-empty summary.
- Empty summaries show neither a summary nor its cut chip, with empty or non-empty descriptions.

These tests assert markup from the actual pure view; they do not exercise effects or interaction. See
[renderer test boundaries](development-verification.md#what-each-test-tier-proves). The
[visual review](https://github.com/pyrycode/pyrycode-desktop/pull/1760#issuecomment-5992148664) compared
static captures of `BackgroundTaskPanelView` at revision `29ce8d38256c576160f98582f2212089bcb0315a`
with [Figma node 564:2230](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230)
at 1280×800 and 800×600. Synthetic completed/template, failed/informative and
stopped/empty-description rows confirmed summary visibility and retained token colours, typography
and card spacing. This evidence covers isolated presentation; no interaction transition changed.

**CSS.** Completed reuses `--color-success` for its label over a 16% tint expressed as
`color-mix(in srgb, var(--color-success) 16%, transparent)` — no new hex literal, matching the Figma-drawn
`rgba(47,192,56,0.16)`. Failed uses the existing `--color-error-container`/`--color-on-error-container`
pair. `.background-task-panel__summary` is body-small, On Surface Variant, with `overflow-wrap: anywhere`
for an unbroken daemon token, the same rule the description carries.

**SECURITY.** `status` and `summary` are daemon-relayed, model-influenced text — `summary` has been
observed carrying a literal command line, the same class as `description`/`patch`. Both render only as
auto-escaped React children: never `dangerouslySetInnerHTML`, an attribute, a key, or a log line, and the
tag's class is chosen exclusively by the `Map`/`===` lookup above, never string-built from the word. Panel
tests render markup-shaped status words and summaries and assert no `<b` element and no attribute carries
either. Architect self-review PASS (security-sensitive label); verifier PASS with no findings blocking
merge.

**Known gap, left open.** A terminal frame's `patch` is still `''` on every finish, so a finished row still
renders the `.background-task-panel__no-change` "No change reported" block even though the Figma finished
rows show none. This predates #1639 (#583/#1635) and is outside this ticket's acceptance criteria; noted
in the PR as a candidate for a follow-up ticket rather than fixed here.

## Progress block (#1640)

The per-row progress lines #1635's Populated and Capped Figma frames drew, but did not build, land here:
between a running row's description (or, on a finished row, its summary) and its Latest update block,
`TaskRow` draws `TaskProgress` whenever `!finished && task.progress !== null`. A finished row never draws
one — the running-only test that must contain none of `completed|failed|...` (see [List
redraw](#list-redraw-1635)) covers this block too. `task.progress` is `HeldBackgroundTaskProgress`, the
latest [`backgroundTaskProgress` report](background-task-roster-store-model.md) held on the task record
— see [Internals § How it works](background-task-roster-store-internals.md#how-it-works).

The block holds two lines: the current activity, one line with an ellipsis
(`.background-task-panel__activity`), followed by the cut chip
(`.background-task-panel__cut-activity`) when `wasCut(task.progress.truncatedFields, CUT_FIELD_DESCRIPTION)`
— reading the **report's own** list, not the task's. `CUT_FIELD_DESCRIPTION` (`'description'`) now names
two different held fields depending on which list it is matched against: the task's own list names the
opening description, the progress report's list names `currentActivity` under the same wire word. Reading
`currentActivity` against the task's list, or `description` against the report's, compiles clean and
never matches — the same crossover trap #583 and #1639 each name once for their own field pair, one more
instance of it. Under that, `.background-task-panel__progress-meta` draws the meta line: when
`lastToolName !== ''` the tool name is its own `.background-task-panel__progress-tool` span followed by
`' · '`, then the client-built counts string from the exported pure `formatTaskProgressCounts`. An empty
tool name drops both the span and the separator, leaving only the counts.

`formatTaskProgressCounts({ toolUses, totalTokens, durationMs })` — pure, unit-tested by table:

- Tools: `'1 tool'`, otherwise `` `${n} tools` ``.
- Tokens: under 1000 the plain number (`'850 tokens'`), otherwise `Math.round(n / 1000)` plus `k`
  (`'18k tokens'`).
- Elapsed, from whole seconds (`Math.floor(durationMs / 1000)`): under a minute `'41s'`; under an hour
  `` `${m}m ${String(s % 60).padStart(2, '0')}s` `` — seconds padded to two digits, e.g. `'1m 05s'`, the
  Figma reading; from an hour on `` `${h}h ${m % 60}m` ``, seconds dropped. The ticket's prose and the
  Figma disagreed on padding below the hour mark; the architect resolved it toward the Figma (padded) and
  kept the ticket's literal hour form.

**SECURITY.** `currentActivity`, `subagentType` and `lastToolName` are untrusted, model- and
tool-authored text — `currentActivity` in particular can name a file on the operator's host, the same
class as `description`. All three render only as auto-escaped React children. The one-line ellipsis on
the activity is deliberately **not** paired with a `title=` tooltip carrying the full text — an attribute
is not a place for daemon text, however tempting for a cut-off line — and the tool name is kept in its
own span so it is never fused with the client-built counts into one text node. Panel tests render a
markup-shaped activity and tool name and assert no `<b` element and no `title` attribute anywhere in the
markup. Architect self-review PASS (security-sensitive label); verifier PASS with no blocking findings.

No prop, type, store or bridge change was needed beyond what #1638/#1640 already added to
`backgroundTaskRosterStore`/`backgroundTaskRosterBridge` — `entry` was already `selectRosterFor`'s return
type, widened to carry `progress`.

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.
