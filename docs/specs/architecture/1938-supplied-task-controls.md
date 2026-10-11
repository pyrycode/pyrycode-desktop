# Supplied thread task controls

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository contracts and ownership map.
- `docs/knowledge/features/conversation-shell.md`, `conversation-shell-background-tasks.md`, `thread-item-store.md`, `development-verification.md`: static-render boundaries, legacy task presentation and immutable scoped snapshots.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `taskLinked`, `usable`: saved link validity and damaged identity rejection.
- `src/renderer/src/screens/conversation/BackgroundTaskPanel.tsx` → `BackgroundTaskPanelView`, `TaskRow`, `backgroundTaskStopSupported`: reusable presentation and owning connection gate.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsTimeline`, `ComposerTaskCount`, `ComposerErrorSlotControl`: supplied seam and legacy consumers.
- `src/renderer/src/store/backgroundTaskRosterStore.ts` → `HeldBackgroundTask`: existing view shape; supplied rows never write this store.
- `e2e/thread-items.spec.ts` → `ThreadFixture`: injected mounted owner using completed batches and typed updates.
- Daemon `docs/knowledge/decisions/042-daemon-built-thread.md` and `docs/knowledge/features/thread-package-agents-and-background-work.md` → Agent lifecycle / Background shells: supplied lifecycle authority, inert saved content.

## Design source
**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=565-2966 within node 102-4.
Reuse the existing blue drawer, header/close icon, Running and Finished groups, task status tags, descriptions, progress, report block and outlined Stop button. Existing theme tokens and typography remain; no new assets or styling. Figma's historical inferred lifecycle notes yield to this ticket's supplied status contract.

## Context
The inactive supplied route needs task controls grounded in daemon items rather than roster inference. Production wiring and live admission remain #1908/#1935. No overlapping remote feature branches touch these files. One deliverable, estimated 650 written lines including tests/plan, two new exported interfaces, five new exports total, four production files, fewer than ten consumers, five observable acceptance criteria, no protocol state machine.

## Design
- Add `threadTaskPresentations(snapshot, inputs)` in `threadTaskPresentation.ts`: pure projection to supplied panel rows extending the existing held display shape, with separate scoped row key, active, pending, stop eligibility and outcome label.
- Export existing `taskLinked` and `usable`; reuse their validity rules. Only shown agent/tool_call items with usable saved links qualify. First representation in snapshot order wins by scope/session/agent/task. Missing attribution remains absent and adds the creating item id to identity so distinct creators cannot merge. Damaged declared attribution excludes membership.
- Descriptions use saved link description, input description/command or input summary; optional task_report/task_update summary and patch are inert bounded text. Unknown status or malformed required display uses bounded item summary. Known outcomes distinguish finished/failed/denied/stopped/stopping/ended_with_session with saved cause/gone unknown. Active alone controls groups and count.
- Add an optional supplied-row input to `BackgroundTaskPanelView`, preserving its legacy entry path. Supplied groups use row keys, per-row eligibility/pending and explicit labels; raw task id remains the action target.
- Extend `ThreadItemsTimeline` with optional typed task inputs: owning connection status, separately scoped progress and stop readings, optional `(hostId, conversationId, taskId) => void` callback. Inputs match host/conversation/epoch/session/agent/task and creating id when attribution is absent. Refusal overrides only its matching pending reading.
- Local drawer visibility lives inside the scope-keyed supplied view. Reuse `ComposerTaskCount`; retain a fixed Background tasks opener when settled rows exist at zero count.
- No roster subscription, store write, IPC/wire change or production-route migration. No optimistic lifecycle or stop admission state; the injected owner supplies pending.

## State + concurrency model
Immutable snapshots and live readings are props. Projection is memoized by inputs/snapshot; drawer visibility is UI-local. Host/conversation/epoch key remounts clear visibility and existing expansion state. No async jobs or subscriptions are added. Stop sends synchronously through the callback only when the displayed row is active, recorded Claude and the owning connection passes the existing gate.

## State transitions and identity reuse
| Event | Proof |
| --- | --- |
| Duplicate linked representations / repeated snapshots | `threadTaskPresentation.test.tsx`: first representation controls all readings |
| Same task in another session or host | projection scope isolation test and mounted task controls spec |
| Unknown/missing recorded attribution | projection identity and gate test |
| Pending, refusal, repeated activation | mounted task controls spec; static pending/refusal test |
| Accepted stop followed by item stopping/finished update | mounted task controls spec: no optimistic transition |
| Scope switch, epoch switch, settled reopen | mounted task controls spec: closed drawer, retained settled rows, absent pill |

## Error handling
No new I/O boundary. Missing callback/status/capability/Claude attribution hides Stop; malformed identity excludes membership. Unknown status and malformed content degrade to escaped summary bounded to 4096. Optional unavailable details are omitted. Saved reports and live readings cannot create lifecycle or membership.

## Testing strategy
Test first: pure projection/static tests for membership, dedup, status/fallback, saved reports, attribution, progress isolation and capability/pending/refusal. Extend existing injected owner in `e2e/thread-items.spec.ts` for click targets, repeated activation, item updates, scope switches and settled reopen without roster events. Capture panel at 1280/800 for Figma comparison. Final main merge, pre-verify and build; focused fake-transport spec only. Combined live-daemon proof belongs to #1908.

## Open Questions
None. A cleaner alternative is to feed composite ids through the legacy roster shape; rejected because it conflates row identity with raw Stop targets and defaults attribution to Claude. Explicit supplied rows keep the legacy contract intact.
