# Conversation shell — background tasks

Part of [Turn status surfaces](conversation-shell-turn-status.md).

## Background-task panel (#581, cap and cut display since #582, latest patch since #583)

`ThreadItemsTimeline` supplies the production drawer with task presentations from
immutable [thread snapshots](thread-item-store.md#identity-placement-and-full-items)
and optional `ThreadTaskInputs`. `BackgroundTaskPanelView` requires
`suppliedTasks: readonly SuppliedBackgroundTask[]`, plus `onClose`, optional
`onStopTask` and optional `turnRunning` for keyboard arbitration. It has no store
subscription. The roster-connected `BackgroundTaskPanel` and its `entry`,
`finishedTaskIds`, `pendingTaskIds` and `agent` inputs were removed in
[#2023](https://github.com/pyrycode/pyrycode-desktop/issues/2023).
The roster store/bridge and their producer tests remain until #2024; they cannot
supply drawer membership, empty-state copy or a fallback for a host without `thread`.

**Supplied membership and identity.**
[`threadTaskPresentations`](../../../src/renderer/src/screens/conversation/threadTaskPresentation.ts)
projects only `shown === true` task-linked `agent` and `tool_call` items, including
settled work. Shared `taskLinked`/`usable` rules require nonempty usable
`content.task_id` and `content.tool_use_id`, with matching `task_id`/`tool_call_id`
in a direct `content.task_link` or one of its `tasks` rows. Identity fields marked
truncated or dropped are unusable; hidden, unlinked and identity-damaged items have
no row or count. Names, `run_in_background` and launch-result text cannot establish
membership.

Rows deduplicate by host, conversation, epoch, recorded session, recorded agent and
task id. The first linked item in snapshot order supplies display, activity and
action consistently. Recorded attribution never falls back to the current session
or Claude. Missing session or agent attribution adds the creating item id to the row
identity so distinct creators cannot merge; damaged declared attribution excludes
membership. The composite `rowKey` is separate from the raw Stop target: putting a
composite id into the raw command target would lose routing. Recorded attribution
must not inherit the current conversation's agent.

**Supplied activity and outcomes.** Only `active === true` determines the Running
group and `ComposerTaskCount`; all other admitted rows belong to Finished. The pill
disappears at zero, while a fixed Background tasks opener retains access to settled
rows. Only supplied `status` determines the outcome: `finished` displays Completed,
with distinct Failed, Denied, Stopped and Stopping labels; `ended_with_session`
displays Ended with session plus an available saved `content.ending.cause`; `gone`
and unknown status display Outcome unknown. Group names do not assert successful
completion. Launch results/denials, reports, progress, main-turn endings, roster
absence and session dividers cannot change these readings. Reopening inactive work
from an earlier recorded session therefore keeps it settled.

**Saved display and availability.** Descriptions select the matching saved link's
description, then `input.description`, `input.command` or `input_summary`.
An unmatched or empty `tasks` array does not hide a matching direct link's
description. Available `task_report`/`task_update` summaries and patches render as
inert saved text, including reports on active rows; supplied summaries are not
suppressed when they repeat a description. Unknown status or a missing/malformed
description falls back to escaped item summary, bounded to 4096 characters (or
Unsupported item when no string summary exists). Optional unavailable details are
omitted. Availability checks follow the selected field through every enclosing
record: dropped fields are omitted, and truncated fields keep their own cut notice
beside the displayed description, report, patch or session-ending cause. Selecting
text separately from its cut metadata would silently display a partial value as
complete. Saved and live display strings are bounded and render only as React text
children.

**Injected live readings and Stop.** `ThreadTaskInputs.progress` and `.stops` decorate
existing rows; they cannot create membership or change lifecycle. Matching uses the
full row identity, including recorded session and the creating item id when
attribution is unavailable. Progress displays only on active rows. Reused task ids
on another host, conversation, epoch, session or agent cannot share progress or
pending controls. A matching `pending: true` disables repeat activation; matching
`refused: true` overrides that pending reading without changing activity or outcome.
The injected owner supplies these readings; the view does not claim or settle a
stop wait itself.

Stop requires an active linked item, a usable raw `content.task_id`, an injected
callback, recorded `agent === 'claude'` and the connected owning host passing
`backgroundTaskStopSupported` with `stop_background_task` capability. Missing,
unknown or Codex agent attribution grants no eligibility. Activation calls
`onStopTask(hostId, conversationId, taskId)` with the snapshot's owning coordinates
and raw content task id, never the item id, launch tool id or composite row key.
Acceptance has no acknowledgement and introduces no optimistic Stopping or finish;
only subsequent item updates change lifecycle.

The thread view keys row expansion and refs by host/conversation/epoch. Drawer
visibility is separate: production uses `PairedShell`'s lifted open state for the
ordinary Background tasks menu, count pill and close action, preserving visibility
across conversation switches while replacing the displayed tasks. The
[thread runtime](thread-runtime.md) supplies task state and scoped Stop commands.
This presentation cleanup requires no live-Claude acceptance.

**Supplied testing.** `threadTaskPresentation.test.tsx` uses pure projection and
static renders for membership/deduplication, recorded attribution, independent
activity/outcomes, fallback/availability, scoped progress, gates and pending/refusal.
The existing injected owner in `e2e/thread-items.spec.ts` uses completed batches and
typed changes without roster events to exercise raw callback targets, repeated
activation, item-driven stopping/finish, settled reopening and host/session/epoch
isolation at 1280 and 800 pixels. It also covers shared drawer Escape arbitration
and listener teardown. Wrap array-valued `it.each` cases in objects: positional
argument expansion can silently supply an undefined task array and let a direct-link
regression pass without exercising the damaged case. Static markup cannot prove
those effects or clicks; see
[test boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

<a id="list-redraw-1635"></a>

**Drawer structure and empty input.** The non-modal 360px drawer stays over the
right side of the message area between measured header/input chrome. It has
`role="dialog"`, a client-owned title id, no scrim or `aria-modal`, and a Close button
with inline SVG. The thread and composer remain usable. Its body always contains
`.background-task-panel__groups`; `suppliedTasks: []` leaves that container empty.
It does not add a ring, “No background-task report yet”, “No background tasks” or
“Partial list” from retained roster state. Reintroducing those readings would make
an empty authoritative task list say something its inputs do not establish.

Rows partition in supplied order into Running and Finished, omitting each empty
group and its header. Headers show the partition length. Each row retains type/tag,
description and cut markers, optional summary, active progress, latest update and
eligible Stop action. The latest update distinguishes absent (`null`, no block),
recorded empty patch (“No change reported”), and nonempty inert patch text.
Truthiness would collapse the last two readings. Cut chips read wire field names
from the owning task/report/update list: `task_type`, `description`, `summary` and
`patch` are not interchangeable with held camelCase property names or another
record's truncation list. A patch's own cut chip still draws for an empty patch.

**Open state and keyboard ownership.** `PairedShell` holds the open boolean;
a bare `ConversationScreen` falls back to local state. The overflow-menu item only
opens; `ComposerTaskCount` toggles and draws its Primary outline while open. Close
and Escape clear that same boolean. Unpairing discards it with the shell.

`BackgroundTaskPanelView` owns a capture-phase document key listener and releases
it on closure/unmount. `drawerClosesOnKeyDown` ignores non-Escape and IME composition,
and defers to `shouldInterruptOnKeyDown` when focus matches `.composer__input` or
`.composer__send` and Escape will interrupt a running turn. Otherwise it stops
propagation and closes the drawer. `turnRunning` serves only this arbitration;
it cannot change task membership, activity or outcomes. With a modal above the
drawer, the first Escape can close the drawer underneath and a second closes the
modal. Static rendering cannot prove listener cleanup or key handling.

Task descriptions, types, reports, patches and progress render only as escaped
React text children, never raw markup, attributes, commands or logs. Type labels
and status classes use client-controlled mapping. The raw task id is held only
for action routing; the supplied composite `rowKey` supplies React identity.

## Stop task

Each eligible active row has a separate **Stop task** button after progress,
latest update and cut markers. The shared `.button-small` and local outlined
`.background-task-panel__stop` retain their geometry and label; pending disables
the button at 0.38 opacity. Finished, ineligible and identity-damaged tasks have no
button. An update/progress cut list cannot remove an otherwise valid raw target.

`threadTaskPresentations` supplies `canStop` and `pending` per scoped task. The view
passes `task.taskId` to its callback, and `ThreadItemsView` resolves that row to the
snapshot host/conversation before calling the injected owner. Eligibility requires
recorded Claude attribution, an active linked item, a usable raw task id, an
injected callback and the owning connected host's `stop_background_task` capability.
`backgroundTaskStopSupported` remains shared; another host's status grants nothing.

The [thread runtime](thread-runtime.md) owns production claims and command dispatch;
the view neither calls `beginTaskStop` nor subscribes to roster pending sets.
Injected pending/refused readings disable/re-enable the matching control without
changing lifecycle. There is no acknowledgement, optimistic Stopping or finish:
subsequent supplied item revisions determine the row's outcome and group. Composer
Stop/Escape still interrupts the foreground turn, separately from background Stop.

### Stop task testing

`BackgroundTaskPanel.test.tsx` statically checks supplied active/finished grouping,
raw-target eligibility, pending disabling, footer placement after progress/update/cut
markers, and identity absence from markup. `threadTaskPresentation.test.tsx` checks
host, agent, capability, attribution and scoped pending/refusal gates. Keep a
positive eligible row alongside negative cases; an empty task list makes every
hidden-button assertion pass without proving a gate.

Mounted supplied-task controls and Escape/listener cleanup are covered in
`e2e/thread-items.spec.ts`; production command/control coverage remains in
`e2e/background-task-stop.spec.ts`. The latter uses the existing fake's recorded
requests and delayed replies to check repeat activation, closure/switch persistence,
terminal outcomes and refusal. `backgroundTaskStop.test.ts` retains producer/store/
bridge and capability assertions, with its deleted roster-container render removed.
Static markup does not run effects or handlers; see
[test boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

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
payload and raw `task.taskType` stay unchanged by this display formatting. Description styling still compares
the raw type with `local_bash` to select mono; using the display label for that comparison would lose
command styling. Grouping and truncation markers keep their existing rules.

`BackgroundTaskPanel.test.tsx` covers the mapping with independently stated expected labels in static
renders, including prefix handling and empty values. Each case renders a frozen task, compares the
entry with its pre-render clone, and checks task identity and the raw type. A markup-shaped unknown
type checks escaping and absence from attributes; separate assertions retain command-versus-agent
description styling. Computing expected labels with the same transformation would let a wrong mapping
pass on both sides; these tests pin the rendered span instead. See [renderer test boundaries](development-verification-what-each-test-tier-proves.md#what-each-test-tier-proves).

## Status tag and summary (#1639)

`TaskStatusTag` requires a supplied label (`outcomeLabel` on the public row).
The task adapter derives that label from the supplied item status, including
Completed, Failed, Denied, Stopped, Stopping, Ended with session and Outcome unknown.
A group is Running only when supplied activity is true; a status label cannot move
a row between groups or alter the count.

The tag's style is separate from its text. Normalized `completed`, `failed` and
`stopped` select fixed classes through `TASK_STATUS_TAGS`; null uses the Running
class, and other statuses use the neutral Stopped class. The required supplied
label always supplies the text. There is no fallback to displaying a raw unknown
status from the old roster adapter. Classes never interpolate daemon strings.
Completed reuses `--color-success` with a 16% tint; Failed uses existing Error
Container tokens. Summary text uses body-small, On Surface Variant and
`overflow-wrap: anywhere`.

A non-null, nonempty saved summary renders immediately after the description/cut
chip, on active and inactive rows alike. Repeated-description summaries and their
own cut chips remain visible. The former finished-only duplicate-summary
suppression was removed with the roster route. Empty summary text draws neither
summary nor cut chip; an empty description cannot hide a nonempty report.
`summary.truncatedFields` alone controls the summary chip. Latest-update patches
and progress have their own markers and cannot imply completion.

`BackgroundTaskPanel.test.tsx` retains supplied-row tag, summary, escaping and cut
pairing assertions. `threadTaskPresentation.test.tsx` checks independent activity/
outcomes, unknown-status fallback, repeated saved reports and field availability.
Some view fixtures inject an arbitrary `outcomeLabel` to test escaping; they do not
establish that production displays raw unknown status words. Model-influenced text
remains escaped React children, never markup, attributes or logs.

## Progress block (#1640)

`TaskRow` draws `TaskProgress` between any summary and the Latest update block when
`!finished && task.progress !== null`. Finished rows never draw progress, even if a
reading remains held. The shared `HeldBackgroundTaskProgress` shape is populated
through scoped `ThreadTaskInputs.progress`; retaining that type does not restore a
roster subscription or let progress establish membership/activity.

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

**SECURITY.** `currentActivity` and `lastToolName` are untrusted, model- and
tool-authored text — `currentActivity` in particular can name a file on the operator's host, the same
class as `description`. Both render only as auto-escaped React children. The one-line ellipsis on
the activity is deliberately **not** paired with a `title=` tooltip carrying the full text — an attribute
is not a place for daemon text, however tempting for a cut-off line — and the tool name is kept in its
own span so it is never fused with the client-built counts into one text node. Panel tests render a
markup-shaped activity and tool name and assert no `<b` element and no `title` attribute anywhere in the
markup. Architect self-review PASS (security-sensitive label); verifier PASS with no blocking findings.

The roster store/bridge still retain their producer APIs and tests until #2024.
The drawer consumes only the supplied task's progress reading.

See [#581 codebase notes](../codebase/581.md) for the shell's full design, test posture, and
code-review record.
