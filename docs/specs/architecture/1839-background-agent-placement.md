# Started background agents follow the thread bottom

## Files read

- `src/renderer/src/store/backgroundTaskRosterStore.ts` → roster setters and clears: retain separate timeline evidence without changing membership.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `BackgroundTaskRosterData`: capture the addressed timeline's next row key synchronously on updates.
- `src/renderer/src/store/threadTimeline.ts` → `TimelineState`, `reduceTimeline`: row keys survive prepends and grow monotonically for received rows.
- `src/renderer/src/store/conversationTimelineStore.ts` → retained timelines: inactive conversations keep their own chronological boundary.
- `src/renderer/src/screens/conversation/groupToolRows.ts` → grouping: reuse descendants, cycle handling and distinct tool counts.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `ToolRow`, scroll pin: retained expansion and native button navigation.
- `src/renderer/src/screens/conversation/foldQueuedRows.ts`, `foldToolRuns.ts` → pending-tail projection and collapsed runs.
- `src/renderer/src/screens/conversation/conversation.css`, `src/renderer/src/theme/tokens.css` → existing joined rows, body/label styles and status colors.
- `e2e/tool-groups.spec.ts`, `e2e/background-task-progress.spec.ts` → existing transport fixture and event injection.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-tool-row-header-groups.md`, `conversation-timeline-store.md`, `background-task-roster-store.md`, `development-verification.md` → projection-only attribution, unlisted-start hold, retained ownership and static-render test limitations.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=789-10437
Read the section screenshot and high-fidelity children `789:10452`, `789:10539`, `789:10623`, `789:10650`, `789:10764`. Reuse tool rows and their joined borders. Markers use body-medium muted text, an ellipsized description, label-medium primary navigation, 8px gaps/padding and the existing primary/success dot treatment. Running rows show descendant count plus running; finished rows show count alone.

## Context

A resolved launch result does not mean a background agent has finished. Keep its live group at the bottom and leave a navigable marker at launch. Saved timelines contain no task frames and retain existing placement; background-task history reconstruction remains #1781 and roster-only rows remain #1840. No ADR needed. Overlap: #1661 changes other screen/chrome functions and CSS; edits here stay local.

## Design

Add a conversation/task Map of received-start evidence to the roster store, independent of membership. Each record holds the exact nonempty started tool-call id, roster-confirmation flag and optional first terminal boundary. Map insertion order is received-start order; repeats retain the original join and order. A roster confirms only a listed local_agent with a usable received start. Unconfirmed evidence follows the existing hold pruning; confirmed evidence survives omission. No provisional row is manufactured.

`setUpdatedTask(snapshot, finishBefore?)` retains the first exact completed/failed/stopped boundary even after roster removal; unknown statuses never finish. The app binding supplies the addressed retained timeline's next row key, never the visible pane's position. Existing callers may omit the boundary.

`groupToolRows(items, evidence?, rowKeys?)` qualifies only an exact Agent launch. Its output adds marker entries at launch and relocates the same full descendant group to the tail while running, or before the first ordinary row whose retained key reaches the terminal boundary. Stored items never move. Counts continue to count distinct tools, excluding assistant text; lifecycle controls running independently of resolved parent/child results.

Timeline consumes the projection after folding queued rows. Markers are native buttons: activation expands the destination and any owning collapsed run, then scrolls its ref into view after layout. Refs and attributes use client-owned numeric row identity, never daemon ids. Existing row keys retain expansion across relocation, prepends and late attachment. Markers break tool runs; live groups retain existing joined-row styling.

## State + concurrency model

All evidence writes are synchronous in the existing app-lifetime listener. No new async job or subscription. Both existing clears drop evidence, and other conversations retain their references. The existing owning-host admission and selected-timeline guard remain in force. Scroll navigation uses a layout effect; existing resize observation follows growth only while pinned.

## Error handling

No new I/O or failure surface. Missing/empty starts, mismatched tools and other task types keep existing rendering. Cyclic attribution retains the existing grouping fallback. Repeated starts and terminal updates cannot move or revive a settled record. Descriptions remain escaped, bounded plain text and cannot hide the navigation action.

## Testing strategy

- First failing units: roster qualification/order, removal-before-terminal, immutable first finish, unknown statuses and both clears; projection isolation, children/text counts and keyed finish placement after history.
- Static Timeline render proves escaped marker content, zero-child running count and ordinary rendering exclusions.
- Extend the existing fake-transport tool-group spec for pointer/Enter/Space navigation, collapse/expansion, live/finished ordering, queued tail, inactive delivery and pinned/held scrolling. Capture synthetic running/two-running/finished states for comparison.
- Final main merge, pre-verify and build; run the changed fake spec. No live-Claude test or shared harness changes.

## Open Questions

None. The simpler shape is retained evidence in the existing roster store; a separate subscription/store would duplicate lifecycle ownership.

Size: approximately 700 total written lines, one new exported evidence type, fewer than 10 consumer updates, five observable criteria and no more than 10 lifecycle ignore branches.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] Typed task events remain untrusted data; exact nonempty ids are conversation-local Map joins. Only roster-confirmed local_agent starts matching exact Agent calls relocate; no coercion or selector construction.
- [Tokens] No credential generation, storage or access; existing safeStorage and main-only transport remain unchanged.
- [File/storage operations] Evidence is memory-only and cleared on pairing/reconnect. Saved snapshot format remains unchanged; no paths derive from task data.
- [Electron attack surface] No IPC API, navigation, webPreferences or remote content additions. Native marker buttons render escaped text; refs use numeric retained keys.
- [Cryptographic primitives] No cryptographic changes; existing Noise variant and key lifecycle remain in main.
- [Network/I/O] Existing typed decoding and owning-host delivery boundary are reused; no sockets, deadlines or network operations added.
- [Errors/logs/telemetry] No daemon text or ids enter logs, attributes, URLs or filenames; no new classified I/O errors. Lifecycle inputs are inert equality hints.
- [Concurrency] Synchronous single-listener writes capture terminal boundaries before another arrival; first finish is immutable. Existing listener cleanup and scoped clears cover lifetime.
- [Threat model] Relay delay/repeats cannot revive a finish; hostile daemon strings remain escaped text or Map keys. Disk theft and compromised renderer access retain existing safeStorage/process isolation. No new protocol authority is created.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-07

## Revisions

2026-10-07: Keep minimal unconfirmed start evidence through roster omission as well. The existing unlisted task records still prune unchanged, but discarding their start join/order would lose received order when a later roster confirms the task. Evidence contains only Map hints, confirmation and first finish boundary; it cannot extend panel/pill membership and both clears remove it.

2026-10-07: History prepends receive fresh retained keys too, rather than negative keys. Pass the existing prepended-row count to the projection and exclude that prefix when locating a live terminal boundary; late history remains chronologically older even when its new key exceeds the boundary.

2026-10-07: Marker navigation runs after commit in an effect, after the parent scroll-pin layout pass, so explicit navigation wins and static markup remains effect-free. Background group treatment lifts launch-pending dimming and suppresses its elapsed timer independently of the launch result.

2026-10-07 (verifier finding 1): Launch markers retain their chronological source keys and remain eligible finish anchors. Late roster confirmation cannot move a newer launch above an established finish. Historical-prefix and relocated-group rows remain excluded from anchor lookup; a projection regression covers confirmation with prepended history.

2026-10-07 (verifier finding 2): `BackgroundAgentTimeline.finishOrder: number | null` records an immutable conversation-local ordinal together with the first terminal boundary. It is one greater than the largest retained ordinal, so no extra counter state or subscription is needed. Projection sorts equal boundaries by this ordinal, preserving reverse completion order through repeated updates, roster changes and late launch attachment. Store tests cover all three terminal statuses after roster removal; projection tests cover a later history attachment with descendants. Security review remains PASS: the ordinal is client-owned memory-only state, cleared with its evidence, with no new input interpretation, persistence or DOM sink.

The existing fake-transport lifecycle scenario also asserts that late confirmation leaves a newer marker below the established finish, and reverse completion at one boundary retains C-before-B placement after repeated updates and roster refresh.

2026-10-07 (verifier finding 1, review of `a23e83e9`): `HeldBackgroundTask.taskType` can come from a started frame, including one with an empty tool-call id, so it cannot prove roster qualification. `BackgroundTaskRosterState.rosterAgentIds` retains each conversation's latest exact `local_agent` roster ids separately from display records. Only `setRoster` replaces this set; both start-time and later roster confirmation use it. Roster omission removes eligibility for a new join, while established timeline confirmation remains retained. The set shares roster lifetime and existing reconnect/pairing clears; panel/pill records, membership and counts remain unchanged. Tests reproduce the empty-id/type-overwrite sequence through the actual store and projection, cover opposite display/roster type disagreement, and reject stale eligibility after omission and clears. No new exports or consumer signatures change; the rework remains within the 800-line written-work limit.

Security re-review: **PASS** after the provenance fix. [Trust boundaries] Start-derived display types never confer roster authority; exact roster-derived Map/Set equality is the sole qualification source. [Tokens, file/storage, Electron, cryptography, network/I/O, errors/logs, concurrency, threat model] The added set is synchronous, memory-only, conversation-scoped and cleared with its roster; it introduces no credentials, persistence, IPC, DOM sinks, logging, transport or async work. The existing security review's isolation, escaping and immutable terminal-order decisions still apply.

2026-10-07 (verifier finding 1, review of `c049b1ec`): Stable row identity is not delivery chronology: queued receipts preserve their original key. `TimelineState.rowArrivalOrder` holds memory-only placement overrides keyed by that identity. A first queued receipt reserves the next value from the existing monotonic `nextRowKey` allocator and advances it without replacing the row/key. The terminal binding still captures this allocator synchronously; `Timeline` passes placement values to `groupToolRows` while retaining identity for React, expansion and navigation. Duplicate receipts cannot reserve another value. History prepends retain the overrides and existing prefix exclusion; drop and reset remove them. Actual reducer/projection regressions cover all terminal statuses, duplicate receipts and subsequent messages; fake transport queues through the composer, finishes, delivers, and checks order and mounted identity. No new export or failure mode; total written work remains below 800 lines.

Security re-review: **PASS**. [Trust boundaries] Only the client allocator supplies placement values; untrusted ids remain equality hints. [Concurrency] Synchronous receipt settlement reserves a unique later value, leaving first terminal evidence immutable. [File/storage, Electron, errors/logs] The sidecar is memory-only, omitted from saved snapshots and absent from DOM/log sinks. [Tokens, cryptography, network/I/O, threat model] No new credentials, protocol, transport, async work or authority; existing isolation and escaping remain unchanged.

## Documentation handoff

- Pending for the documentation stage: `docs/knowledge/features/conversation-shell-tool-row-header-groups.md` § Subagent tool groups — marker navigation, live-tail stacking and settled placement.
- Pending for the documentation stage: `docs/knowledge/features/background-task-roster-store-internals.md` § How it works — retained start/finish evidence, immutable terminal order and roster-type provenance independent of display records and panel/pill membership.
- Pending for the documentation stage: `docs/knowledge/features/conversation-timeline-store-limits.md` § Edge cases and limitations — queued receipt placement independent of stable row identity, history-prefix handling and the unchanged saved-timeline limitation.
