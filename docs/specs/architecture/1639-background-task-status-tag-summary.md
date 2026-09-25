# #1639 — tag finished background tasks Completed, Failed or Stopped and show their summary

## Files read

- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `HeldBackgroundTask`, `BackgroundTaskUpdatedSnapshot`, `createBackgroundTaskRosterStore` (`setRoster`, `setStartedTask`, `setUpdatedTask`), `isTerminalTaskStatus`, `selectFinishedTasksFor` — the record the two new fields join, and the three construction sites that must carry them.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `translateBackgroundTaskUpdated` — drops `summary` today; its docblock names this ticket's parent as the reader.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `TaskGroups`, `TaskRow`, `TaskStatusTag`, `wasCut` — the tag and the row this ticket redraws.
- `src/renderer/src/screens/conversation/conversation.css` → `.background-task-panel__tag--*`, `.background-task-panel__cut-*`, `.background-task-panel__description` — the tag styles and the cut chip rule the summary joins.
- `src/renderer/src/theme/tokens.css` → `--color-success`, `--color-error-container`, `--color-on-error-container` — the tokens the Completed and Failed tags use.
- `src/shared/ipc/events.ts` → the `backgroundTaskUpdated` arm — `status` is an open string, `''` on a patch-bearing frame; `summary` is untrusted model text.
- `e2e/background-task-finished-count.spec.ts` → the fake-transport pattern (`roster`, `updated`, `fake`, `panelFor`) the new spec mirrors.
- Store, bridge and panel test files → the `updated()` snapshot helper, the `task()` view fixture, and the full-record `toEqual` assertions that gain the two fields.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230 (populated panel), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=563-1054 (Task status tag), https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=566-2659 (design notes)

The Task status tag is a 10px-radius pill with a 6px dot and an 11/16 medium label, in four styles. Running uses Primary Container with On Primary Container. Completed uses a 16% tint of Success (`rgba(47,192,56,0.16)`) with the Success label (`#2fc038`). Failed uses Error Container (`#93000a`) with On Error Container (`#ffdad6`). Stopped uses Secondary Container with On Secondary Container. On a finished card the summary sits directly under the description as a 12/17 regular On Surface Variant line in the body font, never mono.

## Context

After #1635 every finished row wears a neutral "Finished" tag, because the store keeps only the finished id. The `backgroundTaskUpdated` frame already carries the status word and the terminal `summary` to the window, and the bridge and the store drop both. This ticket keeps them on the held record and draws them. Grouping and counting are unchanged: `isTerminalTaskStatus` and `finishedTasks` still decide both. No ADR is needed.

#1640 (running-row progress) edits the same record and `TaskRow` after this. The new fields are separate named fields rather than a nested "terminal" object, so progress can add its own field beside them.

## Design

### Store — two fields on `HeldBackgroundTask`

- `status: string | null`: the latest NON-EMPTY status word any update reported for this task. `null` means none has arrived. A `''` frame leaves it unchanged. It is never narrowed to a union.
- `summary: HeldBackgroundTaskSummary | null`: new exported interface `{ text: string; truncatedFields: readonly string[] | null }`. It holds the `summary` and the cut report from the frame whose status was terminal, so the view can tell whether `summary` was cut. `null` means no terminal frame has arrived. `truncatedFields` is assigned straight across and never collapsed into `[]`.

Both fields are required and nullable, the same house rule as `latestUpdate`. Both are the "rides across the rebuild individually" kind that the record's docblock describes, because no roster row and no started frame can report them:

- In `setRoster`, the rebuilt literal carries `held?.status ?? null` and `held?.summary ?? null`. A started-sourced record is kept whole, so it already keeps them.
- In `setStartedTask`, the new record carries them from the listed record or the hold, the same way it carries `latestUpdate`.
- In `setUpdatedTask`, the listed hit and the unlisted-hold hit both write the task's `status` (`snapshot.status === '' ? held.status : snapshot.status`). When `isTerminalTaskStatus(snapshot.status)` is true they also write the `summary` pair. Otherwise the held summary is kept. A miss still returns `s`.

`BackgroundTaskUpdatedSnapshot` gains `summary: string`.

### Bridge

`translateBackgroundTaskUpdated` copies `summary: event.summary` into the snapshot's named-field literal. That makes six fields. Its docblock drops the "stays unread" sentence.

### Panel

- `TaskStatusTag` takes `status: string | null` instead of `finished`. It maps the word to a client-owned `{ label, modifier }` pair:
  - `null` gives Running and `--running`.
  - `'completed'`, `'failed'` and `'stopped'` give Completed, Failed and Stopped with `--completed`, `--failed` and `--stopped`.
  - Any other word gives that word as an auto-escaped child with the `--stopped` style.

  The class is always one of four literal strings, chosen by `===` against constants. The daemon word never becomes a class.
- `TaskRow` passes `task.status` to the tag. On a finished row, when `task.summary !== null && task.summary.text !== ''`, it draws `<span className="background-task-panel__summary">` holding the text directly after the description's cut chip. If `wasCut(task.summary.truncatedFields, 'summary')` is true, the existing cut chip follows as `background-task-panel__cut-summary`. A running row never draws a summary, and group membership still comes only from `finishedTaskIds`.
- The `BACKGROUND_TASK_PANEL_FINISHED_LABEL` constant is still used as the group header.

### CSS

The stylesheet gets:

- `--completed`, which uses the `--color-success` label. Its background is a 16% tint of Success: the drawn `rgba(47,192,56,0.16)`, expressed as `color-mix(in srgb, var(--color-success) 16%, transparent)` so no hex literal is added.
- `--failed`, which uses `--color-error-container` and `--color-on-error-container`.
- `__summary`, which uses the body-small size, 17px line and On Surface Variant colour, with `overflow-wrap: anywhere`.
- `__cut-summary`, which joins the shared cut-chip rule.

## State + concurrency model

There are no new async tasks, and the synchronous dispatch path is unchanged. Both clears already drop whole records, so the new fields go with them. The narrow-slice property is kept, because a write for one task rebuilds only that conversation's entry.

## Error handling

No new failure modes are added. An unknown status word is a value, not an error: it renders raw in the Stopped style and keeps the task counted as running. Nothing logs. That matches the store's silent misses and the content-free diagnostics rule.

## Testing strategy

Vitest, node environment, static markup:

- **Store**:
  - A non-empty status is held.
  - A later `''` frame keeps it.
  - An unknown word is held and the task is not counted as finished.
  - A terminal frame records `summary` with its `truncatedFields`, and `null` is passed straight across.
  - A non-terminal frame after a terminal one keeps the summary.
  - Both fields survive a roster that lists a roster-sourced task, a roster that lists a started-sourced task, and a start that arrives after the update.
  - An update to an unlisted hold records both fields, and they move in with the listing.
  - Existing full-record `toEqual` fixtures gain `status: null, summary: null`.
- **Bridge**: the translator copies `summary`. The old "not copied" sentinel assertion is replaced.
- **Panel**:
  - The tag for each of `null`, `completed`, `failed` and `stopped` has the right class and label.
  - An unknown word such as `<b>weird</b>` renders escaped in the `--stopped` style inside a Running-group row, and appears in no attribute.
  - A finished row shows the summary after the description.
  - The cut chip appears only when `summary` is named in the list.
  - An empty summary shows no line.
  - A running row whose record holds a summary shows none.
  - A markup-shaped summary stays text.
  - The #1635 test for the neutral "Finished" tag is rewritten to the new rule.
- **E2E**: `e2e/background-task-status-summary.spec.ts` sends a roster of two tasks, a `completed` frame with one summary and a `failed` frame with another. It checks that both rows sit under `Finished · 2`, that the Completed tag carries `--completed` and the Failed tag carries `--failed`, and that each row shows its own summary.

## Open questions

- A terminal frame carries `patch: ''`, so after this ticket a finished row still shows a "No change reported" update block. The Figma finished rows show none. That comes from #583/#1635 and is out of this ticket's criteria, so it is left unchanged and noted in the PR.

## Documentation handoff

The ticket has no Documentation handoff section. The documentation stage should fold the new record fields and the tag rule into the background-task package overview. **Pending.**

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings. `summary` and the status word cross from the daemon to the renderer through `translateBackgroundTaskUpdated`, which copies named fields and parses nothing. They are held as opaque strings on `HeldBackgroundTask`, and the store's header already classifies this record's text fields as untrusted display text. The status word is read only by `isTerminalTaskStatus` (set membership) and by the panel's `===` comparisons against client constants.
- [Tokens / secrets] No findings. No secrets are touched, and nothing is persisted: both fields live in the in-memory store that `clearAllRosters` and `resetRostersFor` drop whole at the pairing and reconnect boundaries.
- [File / storage] No findings. There is no filesystem, web storage or cache key. The word is never used as a lookup path or key.
- [Electron / IPC surface] No findings. No new channel, preload API or window is added. The renderer receives an already-typed arm.
- [Rendering sinks] SHOULD FIX, enforced in Phase B by tests. The raw unknown word and the summary must be auto-escaped React children only: never `dangerouslySetInnerHTML`, `title`, `aria-*`, `data-*`, `key` or `className`. `TaskStatusTag` chooses its class from four literal strings by `===`, and it must not template the word into a class string, as `ReadingRing`'s `--${variant}` does for a client-owned union. Panel tests render a markup-shaped word and summary and assert that no `<b` element appears and that the word does not appear inside any attribute.
- [Crypto] Not applicable. No primitive is touched.
- [Network & I/O] No findings. Size is bounded upstream by the daemon's per-frame cap. The store keeps one summary per task, latest-wins, not a history, so there is no unbounded growth.
- [Logs] No findings. Every setter's miss and hit stays silent, and the panel logs nothing. `summary` has been observed carrying a command line, so no log line may name it.
- [Concurrency] No findings. The path is synchronous, with a single listener and no await, and the ordering argument in `subscribeBackgroundTaskRoster` is unchanged.
- [Threat model] A hostile daemon could send a misleading status word, for example a word styled to look like "Completed". The label renders verbatim, so a daemon can put any word in the Stopped style. That is the design's stated rule, and it cannot claim the Completed or Failed colours, because those are chosen only by an exact match. **Out of scope** beyond that: the daemon is inside the Noise session and is trusted for the content it reports.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
