# #1635 — redraw the background task list to the #580 design

## Files read

- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanelView`, `BackgroundTaskPanel`, `wasCut`, the `CUT_FIELD_*` constants, `partialListCopy` — the view being redrawn, its container, and the wire-name pairing that must not move.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.test.tsx` — every shipped assertion keys on `background-task-panel__*` class substrings; new class names must not collide with them (see Design § class names).
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `BackgroundTaskRosterState.finishedTasks`, `selectRosterFor`, `selectLiveTaskCountFor`, `withFinished`, the `setRoster` prune — the finished-id set is copy-on-write, so a per-conversation `get` hands back a held reference.
- `src/renderer/src/screens/conversation/conversation.css` → the `.background-task-drawer*` chrome (untouched) and the `.background-task-panel__*` list rules (replaced); `.composer__row::before` records the house rule for a translucent token fill: a pseudo-element at `opacity`, never `color-mix()` or `rgba()`.
- `src/renderer/src/theme/tokens.css` — the type scale (`--text-label-small-*`, `--text-label-medium-*`, `--text-body-small-*`, `--text-body-medium-*`), `--space-*`, `--radius-*`; there is no `--color-secondary`.
- `e2e/background-task-finished-count.spec.ts`, `e2e/background-task-reconnect.spec.ts` — they locate `.background-task-panel__row`, `__empty` and `__unobserved` and assert `toHaveText` on the last two, so those classes must stay on elements whose full text is the heading copy alone.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=564-2230 (Populated), 565-2241 (Capped and cut text), 565-2281 (Latest update variants), 565-2327 (Empty), 565-2341 (Never reported), 563-1054 (Task status tag), 563-1055 (Cut marker), 566-2659 (Design notes).

The drawer body is a 10px-gap column: an optional filled Secondary Container notice (8px dot + "Partial list (n not shown)", on-secondary-container 12 medium), then a "Running · n" header (12 medium, Secondary #bac8da, 0.5 tracking) over running cards, a 6px spacer, then "Finished · n" over finished cards. A card is a 6px-radius box of On Primary (#003355) at 41% (running) or 22% (finished), padded 12/14 with an 8px gap: a line holding the raw task type (Roboto Mono 11/16, Primary) and, on the right, a pill tag (6px dot + 11 medium label; Running = Primary Container fill with on-primary-container text; Stopped = Secondary Container with on-secondary-container); then the description, 12px on-surface (on-surface-variant on finished cards), mono for `local_bash`; then an optional "Latest update" label (11 medium, Outline) over a Surface code block (radius 6, padding 8/10) holding the raw patch in mono 11/16 on-surface-variant pre-wrapped, or "No change reported" in italic 12 Outline. The cut marker is a dashed 1px Tertiary chip (radius 4, padding 1/6) reading "Truncated by the daemon" in 11 medium Tertiary, on its own line after the cut field. The two empty readings are a centred column (padding 48 vertical, gap 10): a 28px ring (solid for Empty, dashed for Never reported), a 14 medium on-surface heading and a 12 on-surface-variant support line. The progress lines, summaries and Completed/Failed tags in the frames belong to #1640/#1639 and are not drawn; the capped frame's "8 shown" header wording and its "6 more rows below" footer are not in this ticket's AC (the ticket fixes the header as "Running · n"), so neither is drawn.

## Context

The list inside `.background-task-drawer__body` renders plain spans. #580's drawing groups it by liveness and draws cards, tags, a code block, a cut chip, a filled notice and two illustrated empty readings. The drawer chrome (#1634) stays as it is. No ADR is warranted.

## Design

### Store — one new selector

`selectFinishedTasksFor(conversationId: string): (s: BackgroundTaskRosterState) => ReadonlySet<string> | null` beside `selectRosterFor`: `s.finishedTasks.get(conversationId) ?? null`. It returns the held set or the `null` literal, never a fresh set, so a write for another conversation leaves it `Object.is`-identical. `withFinished` and the `setRoster` prune already build a new set only when this conversation's membership changes.

### Container

`BackgroundTaskPanel` adds a second `useMemo`-stable selector read and passes `finishedTaskIds` to the view. Escape handling untouched.

### View

`BackgroundTaskPanelView` gains `finishedTaskIds?: ReadonlySet<string> | null` (optional, `null` default — "nothing finished", which is what the pill's count also assumes when the key is absent). Optional so the ~30 shipped static renders keep compiling unchanged; the one production caller always passes it.

The three-way branch (`null` / empty / populated) and the sibling partial notice keep their structure. The populated arm partitions `entry.tasks.values()` once, in roster order, into running (`finishedTaskIds?.has(taskId) !== true`) and finished. Each non-empty partition renders a group; an empty one renders nothing, header included. Counts are the partition lengths, so dropped tasks are never counted.

Module-private pieces, all pure:

- `TaskGroup({ label, tasks, finished })` — a header `<h3>` reading `` `${label} · ${tasks.length}` `` over a `<ul class="background-task-panel__list">`.
- `TaskRow({ task, finished })` — the `<li class="background-task-panel__row">` (plus `--finished` on finished rows), key stays `task.taskId`. Children in order: the head line (type span + tag), the type's cut chip, the description, the description's cut chip, then the latest-update section.
- The tag: Running → `background-task-panel__tag--running`, label "Running"; finished → `background-task-panel__tag--stopped`, label "Finished" (the Stopped style; #1639 swaps the label and modifier for the status word).
- Description: `background-task-panel__description`, plus `--mono` when `task.taskType === 'local_bash'` (a named constant). The daemon string is compared against a client constant; it selects a client-owned class and is never itself placed in an attribute.
- Latest update, only when `latestUpdate !== null`: a `background-task-panel__update` wrapper holding the "Latest update" label, a `background-task-panel__update-block` holding either `__patch` (raw text) or `__no-change` (client copy), and the `__cut-patch` chip after the block, inside the null guard (unchanged placement rule).
- Cut chips keep their three classes and `wasCut` pairings exactly.
- Partial notice keeps `background-task-panel__partial` and copy, gains an `aria-hidden` dot span.
- Empty readings: a neutral `background-task-panel__reading` wrapper holding an inline SVG ring (`__ring--dashed` for unobserved, `__ring--solid` for empty, `aria-hidden`), the heading `<p>` that keeps `__unobserved` / `__empty` and only the heading copy (the e2e `toHaveText` assertions), and a `__reading-support` line. New client copy, apostrophe-free: "The daemon has not reported on this conversation since the app connected." and "Claude has nothing running in the background for this conversation."

**Class names.** Shipped tests assert substrings: `not.toContain('background-task-panel__patch')` on an empty-patch render, `not.toContain('background-task-panel__cut-')` on uncut renders, `not.toContain('background-task-panel__empty')` on the unobserved render. So the code block is `__update-block` (not `__patch-block`), no shared `__cut-*` class is added, and the reading wrapper is `__reading` (not `__empty-state`). A running-only roster must contain none of `completed|complete|failed|failure|succeeded|success|finished|error` (the #583 AC4 sweep), so `finished` appears only on finished rows, the Finished header and the Finished tag.

### CSS

Replace the `.background-task-panel__*` rules; the drawer rules stay. Every colour is a token. The two translucent card fills use a `::before` at `opacity` over `--color-on-primary` (the `.composer__row::before` house form) with `isolation: isolate` on the row and `z-index: -1` on the pseudo-element, so no child needs `position`. Rings are SVG `circle` strokes in `--color-outline`, the dashed one via `stroke-dasharray`. Tag and notice dots are `currentColor` discs. The body gets its 10px column gap on `.background-task-panel__groups` and the partial notice, not on the drawer body rule.

`tokens.css` gains `--color-secondary: #bac8da` (M3 Schemes/Secondary, dark scheme), the group header's colour; nothing else in the palette matches it.

Deliberate deviations: the drawn 17px and 18px line heights take the nearest type-scale token (`--text-body-small-line` 16px, `--text-label-medium-line` 16px) rather than new one-consumer tokens.

## State + concurrency model

No new async work, subscription or teardown. One extra narrow-slice store read in the container.

## Error handling

No new failure modes. `droppedTasks > 0` stays a comparison. An unknown `taskType` renders in body text; an unknown cut field marks nothing.

## Security

Unchanged posture: every daemon string (`taskType`, `description`, `patch`) is an auto-escaped React child only. `taskId` is a React key and a `Set` lookup needle, never rendered. `taskType` is compared against a constant to pick a client class. No attribute, key, parse, copy or `<img>` carries daemon text; the rings are inline SVG. Rows stay `<li>`, non-interactive.

## Testing strategy

Vitest static renders in `BackgroundTaskPanel.test.tsx` (new `describe` for #1635):

- Grouping: a mixed roster renders "Running · 2" before "Finished · 1", each finished task after the Running header's rows, roster order within each group.
- Dropped tasks not counted: `entry([t1], 3)` renders "Running · 1" and the notice.
- An empty group is not drawn: all-running renders no "Finished"; all-finished renders no "Running ·" header.
- Tags: running row has `__tag--running` + "Running"; finished row has `__tag--stopped` + "Finished" and `__row--finished`.
- Description font: `local_bash` gets `--mono`, another type does not.
- Latest update: never-updated row renders no `__update`; empty patch renders the label, the block and "No change reported"; a patch renders inside `__update-block`.
- Empty readings: each has its ring modifier and support line, and neither carries the other's.
- Partial notice sits before the first group header.
- Security: a mixed roster with hostile `description`/`taskType`/`patch` keeps the attribute-shaped guards and no `<img`.

Store: `backgroundTaskRosterStore.test.ts` — `selectFinishedTasksFor` returns `null` when absent, the held set after a terminal update, and the same reference after a write for another conversation.

All shipped assertions stay green without edits (the class-name choices above exist for that).

e2e: `background-task-finished-count.spec.ts` gains one assertion that the drawer reads "Finished · 2" and no Running header, proving the container wires the store read to the view. Visual evidence per `visual-review.md` static capture of the populated, capped/cut, latest-update and both empty states at the drawer's 360px width.

## Documentation handoff

The ticket has no Documentation handoff section. Pending for the documentation stage: fold the grouping, the `selectFinishedTasksFor` selector and the class-name collision constraints into `docs/knowledge/features/` (the background-task panel's package overview).

## Open questions

- None blocking. The capped frame's "· 8 shown" header wording differs from the ticket's "Running · n"; the ticket's wording is followed.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the boundary is unchanged: `taskType`, `description` and `latestUpdate.patch` arrive in the renderer already typed by `backgroundTaskRosterBridge` and are rendered only as auto-escaped React children. The new reads of daemon data are both needles against client-held values: `taskType === 'local_bash'` picks a client-owned class, and `finishedTaskIds.has(taskId)` picks a group. Neither places daemon text in a class, attribute, key, style or URL. Group counts are partition lengths (numbers). The empty-reading rings are inline SVG with constant geometry, so the whole-markup `not.toContain('<img')` guard stays meaningful.
- [Trust boundaries — spoofing client chrome] No findings — a description or patch whose text reads "Truncated by the daemon", "Running", "Finished" or "No change reported" renders inside its own field element in mono (or body) text, while the client's chips and tags are separate elements with borders, fills and dots the daemon cannot produce; the marker is never concatenated into a field (unchanged). `white-space: pre-wrap` on the patch lets the daemon choose line breaks inside its own block only. Each field is a block-level flex child, so a bidi override inside it cannot reorder the adjacent client chip or tag.
- [Trust boundaries — hostile finish set] No findings — `finishedTasks` is written from daemon `status` values by the store; a hostile daemon marking tasks finished only moves rows between groups and changes a tag label to a client constant. No daemon status word is rendered in this ticket (that is #1639's surface).
- [Parsing] No findings — the patch stays raw text. No JSON parse, no key enumeration, no syntax highlighting is added by the code-block styling, which is CSS only.
- [Interactivity] No findings — rows stay `<li>` elements with no handler, no `tabIndex`, no hover affordance and no copy control; the design notes say "no hover, no copy, no run".
- [Tokens, secrets, storage, Electron surface, crypto, network] Not applicable — renderer-only presentational change plus one pure store selector; no IPC channel, preload API, storage, socket or key is touched.
- [Logs] No findings — nothing is logged on any branch (unchanged content-free posture).
- [Concurrency] No findings — no new async work; the new selector returns the held set or `null`, so no render loop or churn.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
