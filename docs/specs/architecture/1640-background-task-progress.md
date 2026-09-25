# #1640 — show a running background task's progress in the panel

## Files read

- `src/shared/ipc/events.ts` → the `backgroundTaskProgress` arm (#1638): `currentActivity` is the wire `description` renamed; the counters are cumulative, not monotonic; three untrusted text fields; ships dormant until this ticket.
- `src/shared/wire/types.ts` → `BackgroundTaskProgressPayload` — the wire names inside `truncated_fields` (`description`, not `currentActivity`).
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `HeldBackgroundTask`, `HeldBackgroundTaskSummary`, `createBackgroundTaskRosterStore` (`setRoster`, `setStartedTask`, `setUpdatedTask`) — the record the new field joins, the two rebuild sites it must ride across, and the listed-then-hold join the new setter mirrors.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `translateBackgroundTaskUpdated`, `subscribeBackgroundTaskRoster`, `BackgroundTaskRosterData` — the single-arm translator posture and the writer list the new arm joins.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskRow`, `wasCut`, `CUT_FIELD_DESCRIPTION` — where the Progress block goes (between the description/summary and the Latest update block) and the cut-chip idiom.
- `src/renderer/src/screens/conversation/conversation.css` → `.background-task-panel__summary`, the shared `.background-task-panel__cut-*` rule, `.background-task-panel__row` (flex column, `--space-2` gap).
- `src/renderer/src/theme/tokens.css` → `--color-on-surface-variant`, `--color-outline`, `--text-body-small-*`, `--text-label-small-*`.
- `e2e/background-task-status-summary.spec.ts` → the fake-transport pattern (`frame`, `roster`, `fake`, `panelFor`) the new spec mirrors.
- `docs/specs/architecture/1639-background-task-status-tag-summary.md` — the analogue; its Context names this ticket as adding "its own field beside" `status` and `summary`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230 (populated panel, running rows' Progress block), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=566-2659 (design notes)

On a running card, a "Progress" column sits under the description and above "Latest update", with a 2px gap: the current activity as a 12/17 regular On Surface Variant line in the body font, then a meta line in 11/16 regular Outline (`#8c9199`) such as "Bash · 4 tools · 18k tokens · 2m 41s". Finished cards draw no Progress block. The design notes add that a cut field is followed by the dashed Tertiary "Truncated by the daemon" chip on its own line.

## Context

#1638 decodes `background_task_progress` into the `backgroundTaskProgress` daemon event, and nothing reads it. Without it a long running task looks the same whether it is working or stalled. This ticket holds the latest report per task and draws it on running rows. No ADR is needed.

## Design

### Store

- New exported `HeldBackgroundTaskProgress`: `currentActivity`, `subagentType`, `lastToolName` (strings), `totalTokens`, `toolUses`, `durationMs` (numbers), `truncatedFields: readonly string[] | null`. It is the whole report minus the join keys. Latest wins, no history.
- `HeldBackgroundTask` gains a required, nullable `progress: HeldBackgroundTaskProgress | null`. `null` means no report has matched the task. It is the rides-across-the-rebuild kind: `setRoster`'s rebuilt literal and `setStartedTask`'s record both carry `held?.progress ?? null` / `prior?.progress ?? null`, beside `status` and `summary`.
- New exported `BackgroundTaskProgressSnapshot`: the arm minus `type` (nine fields).
- New setter `setTaskProgress(snapshot)`. It joins on `conversationId` + `taskId` like `setUpdatedTask`: the listed task first, else the unlisted hold. A miss in both returns `s` itself, so a report never opens a task. A hit replaces `progress` wholesale and touches nothing else, not `finishedTasks`, not `latestUpdate`. `truncatedFields` goes straight across. The counters are stored as received.

### Bridge

- New `translateBackgroundTaskProgress(event)`: the fourth single-arm filter, a fresh named-field literal of all nine fields, `default: null`.
- `subscribeBackgroundTaskRoster` gains a sixth writer, `setTaskProgress`, and a fourth `!== null` branch. `BackgroundTaskRosterData` passes the store's setter.

### Panel

- In `TaskRow`, on a running row (`!finished`) with `task.progress !== null`, draw `<div className="background-task-panel__progress">` between the description block (and the summary, which a running row never shows) and the Latest update block. It holds:
  - `<span className="background-task-panel__activity">` with `currentActivity`, one line with ellipsis.
  - The cut chip `background-task-panel__cut-activity` when `wasCut(task.progress.truncatedFields, CUT_FIELD_DESCRIPTION)`. It reads the progress report's own list, with the wire name `description`.
  - `<span className="background-task-panel__progress-meta">`. When `lastToolName !== ''` it starts with the tool name in its own `<span className="background-task-panel__progress-tool">` and a `' · '` separator. The rest is the client-built counts string.
- New exported pure `formatTaskProgressCounts(progress: Pick<HeldBackgroundTaskProgress, 'toolUses' | 'totalTokens' | 'durationMs'>): string`, which returns e.g. `4 tools · 18k tokens · 2m 41s`. Rules:
  - Tools: `1 tool`, otherwise `N tools`.
  - Tokens: under 1000 the plain number, otherwise `Math.round(n / 1000)` + `k`.
  - Elapsed, from whole seconds `floor(durationMs / 1000)`: `41s` under a minute, `2m 41s` under an hour (seconds padded to two digits, `1m 05s` as drawn), `1h 2m` from an hour on.
- The daemon text stays in its own elements. Only client-built numbers are concatenated.

### CSS

- `__progress`: flex column, 2px gap, stretch.
- `__activity`: body-small size, 17px drawn line → the scale's `--text-body-small-line`, On Surface Variant, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%`.
- `__progress-meta`: label-small size and line, 400 weight, `--color-outline`.
- `__cut-activity` joins the shared cut-chip rule.

## State + concurrency model

No new async work. The progress arm rides the same synchronous listener as the other three, so the ordering argument in `subscribeBackgroundTaskRoster` still holds. Both clears drop whole records, so they drop progress too.

## Error handling

No new failure modes. A miss is silent, like `setUpdatedTask`'s. Nothing logs: `currentActivity` names a file on the operator's host.

## Testing strategy

Vitest (node, static markup):

- **Store**:
  - A report on a listed task is held.
  - A second report replaces it.
  - A report survives a later roster listing the task, and a later started frame.
  - A report on an unlisted hold is held and moves in with the listing.
  - A report for an unknown task, or an unknown conversation, returns the same state object.
  - `truncatedFields: null` stays `null`.
  - The report does not touch `finishedTasks`.
  - Existing full-record fixtures gain `progress: null`.
- **Bridge**:
  - The translator maps all nine fields.
  - The translator returns `null` for the other arms.
  - `subscribe` routes a progress event to the sixth writer only.
  - Existing call sites gain the sixth argument.
- **Panel**:
  - `formatTaskProgressCounts` table: `1 tool`, `4 tools`, `850 tokens`, `18k tokens`, `41s`, `2m 41s`, `1m 05s`, `1h 2m`.
  - A running row with progress shows the activity and the meta line between the description and the Latest update.
  - An empty tool name drops its segment.
  - The cut chip appears only when `description` is named in the progress list, not when it is named in the task's own list.
  - A running row without progress shows no block, and a finished row with progress shows none.
  - A markup-shaped activity or tool name stays literal text.
- **E2E**: `e2e/background-task-progress.spec.ts` sends a roster with a running task, opens the panel, pushes a progress frame and asserts the activity and meta line. It then pushes a newer frame and asserts it replaced the first.

## Open questions

- The elapsed format pads seconds (`1m 05s`, the Figma) while the ticket writes `1h 2m`. Resolved: seconds are padded under an hour, and the hour form follows the ticket literally.

## One-ticket boundary

Four production files (store, bridge, panel, CSS) and four new exports. `subscribeBackgroundTaskRoster` gains a required writer, which touches 12 call sites: 11 in `backgroundTaskRosterBridge.test.ts` and 1 in `BackgroundTaskRosterData`. That is over the 10-site line. A split is not the right fix. The store-and-bridge half would have exactly one consumer, the panel half, and the floor rule wins over the ceiling. So the ticket is built whole and the overage is stated here.

## Documentation handoff

The ticket has no Documentation handoff section. The documentation stage should fold the `progress` record field, the fourth translator and the meta-line format into the background-task package overview. **Pending.**

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. The three text fields cross from the daemon through `translateBackgroundTaskProgress`, which copies named fields and parses nothing. `setTaskProgress` holds them as opaque strings on `HeldBackgroundTaskProgress`, whose docblock carries the untrusted-text rule to the reader. The counters are numbers and are only formatted.
- [Tokens / secrets] No findings. No secret is touched. The record lives only in the in-memory store that `clearAllRosters` and `resetRostersFor` drop whole, and nothing persists it. That matters because `currentActivity` names a file on the operator's host.
- [File / storage] No findings. No field is used as a path, filename, cache key or lookup key. The join key is the held `taskId`, the same one the other three setters use.
- [Electron / IPC surface] No findings. There is no new channel or preload API. The arm already reaches the renderer typed (#1638).
- [Rendering sinks] SHOULD FIX, enforced in Phase B by tests. `currentActivity` and `lastToolName` are auto-escaped children of their own elements only. The one-line ellipsis tempts a `title=` tooltip carrying the full activity, and that is forbidden: no `title`, `aria-*`, `data-*`, `key` or `className` built from them. The tool name is kept in its own span, so daemon text is never fused with the client's counts into one text node. Panel tests render a markup-shaped activity and tool name and assert that no `<b` element appears and that neither string appears inside an attribute.
- [Crypto] Not applicable.
- [Network & I/O] No findings. Size is bounded by the daemon's per-frame cap. The store keeps one report per task, latest-wins, with no history. A report for a task the store does not hold creates nothing, so a flood of reports for invented ids cannot grow the store. An absurd counter, such as a negative or a huge number, renders as an inert odd number and is not a failure.
- [Logs] No findings. The setter's hit and miss are silent, and the panel logs nothing.
- [Concurrency] No findings. It is the same synchronous listener with no await, and the fourth branch keeps the arrival-order argument in `subscribeBackgroundTaskRoster`.
- [Threat model] A hostile daemon can report any activity text or counts for a task it holds. That is within the daemon's trusted-content role inside the Noise session, and the panel labels nothing as verified. It cannot open a row, move a task between groups or change the pill's count, because progress touches neither membership nor `finishedTasks`. **Out of scope** beyond that.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
