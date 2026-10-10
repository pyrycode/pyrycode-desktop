# Daemon item presentation

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository and knowledge ownership.
- `docs/knowledge/features/conversation-shell.md`: existing conversation layout and row actions.
- `docs/knowledge/features/assistant-markdown-renderer.md`: escaped markdown and reader opt-in.
- `docs/knowledge/features/development-verification.md`: static versus mounted proof boundaries.
- `src/shared/wire/thread.ts` → `ThreadItem`, `ThreadUpdate`: supplied open-ended fields.
- `src/renderer/src/store/threadItemStore.ts` → `ThreadSnapshot`, `createThreadItemStore`: scoped immutable snapshots and completed batches.
- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem`: existing presentation input shapes only.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `TimelineRow`, `ToolRow`, `ToolRunHeader`, `useThreadScrollPin`: reusable presentation and scroll lifecycle.
- `src/renderer/src/screens/conversation/foldToolRuns.ts` → `foldToolRuns`: contiguous tool collapse.
- `src/renderer/src/screens/conversation/turnStats.ts` → `formatTurnStats`: existing metrics formatting.
- `e2e/agent-switch-confirmation.spec.ts`, `e2e/fixtures/launchPairedApp.ts`: ticket-local renderer injection using the existing paired fixture.
- Daemon ADR 042 and `docs/knowledge/features/thread-package-main-thread-folding.md`: source payloads, nested outcomes and recorded attribution.

## Design source
**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4
Reviewed context and screenshot: fixed sidebar beside a conversation pane, asymmetric message bubbles, sibling copy/reply controls, centred dividers and compact tool rows. Reuse existing components and their theme tokens without styling changes.

## Context
Expose a daemon-built presentation consumer alongside the legacy Timeline, without subscribing production to the new store. Later tickets own path selection, agent nesting and local message settlement. No ADR is needed.

## Design
Add an adapter that narrows only view fields of held JSON into existing presentation inputs or a summary fallback. It does not fold raw events, infer parents, search for an open bubble or reorder the snapshot.
Add `ThreadItemsTimeline({ snapshot, foldTools, onReply, onOpenMarkdownPath })`, explicitly injected by mounted tests and future consumers. A scope-keyed inner view resets local state on host/conversation/epoch changes; numeric daemon ids key rows.
Known kinds/statuses use existing row components. Missing required presentation fields, unknown statuses/kinds and unsupported notices use bounded escaped summary text. Hidden items stay in the supplied store and produce no row. Authoritative row mode bypasses legacy info-banner/normal-ending suppression, using supplied summary when existing ending copy is unavailable.
Message timestamps, tool input/result/denial and attachments are narrowed from saved payload fields when supplied. Never manufacture result text or running activity for a terminal tool. Assistant reveal/cursor reads `active` directly.
Associate metrics with assistant messages by recorded session/agent/turn identity, requiring a recorded session and turn; select the final assistant in that identity for existing meta stats. No current-session or adjacent-row attribution.
Use `foldToolRuns` with a flat projection carrying supplied activity. Keep collapsed tool members mounted and hold run expansion by member ids so appends and older prepends retain expansion. Agent/parent items remain in snapshot order with summary presentation.
Reuse `useThreadScrollPin` with legacy history demands disabled. A snapshot revision token allows restoring the existing top-row anchor for prepends and row growth; existing legacy callers retain their current behavior.
No overlapping unmerged numeric feature branch touches the planned existing files.

## State + concurrency model
Only row/tool/run expansion and the existing scroll pin are local state. No new protocol jobs or subscriptions. Existing resize/mutation observers retain their cleanup. The injected owner subscribes to its explicitly created store and supplies snapshots; production stays on Timeline.

## State transitions and identity reuse
| Event | Proof |
| --- | --- |
| Typed text append/revision while other rows follow | static activity case; mounted revision/copy/reply case |
| Tool result revision and run append | mounted expansion case |
| Completed batch with older items, including zero offset | mounted prepend/scroll case |
| Growth while following or reading above newest | mounted follow/anchor case |
| Same ids after host/conversation/epoch switch | mounted scope reset case |
| Hidden, unsupported or malformed content | static visibility/fallback cases |
| Same turn string in different recorded sessions | static usage attribution case |

## Error handling
Unknown JSON uses inert summary presentation rather than exceptions. Invalid optional details are omitted. Existing copy, reader and attachment actions retain their current error behavior and typed IPC results. The view introduces no I/O or classified error boundary.

## Testing strategy
Test first with focused static renders for all kinds, shown visibility, inert fallback, active/status independence and recorded usage association. Mounted ticket-local fake-transport renderer exercises typed updates and completed batches through `createThreadItemStore`, row identity/expansion, current-text actions, attachments, reader callback and scroll anchoring. Capture synthetic rows at 1280 and 800 widths and compare existing layout with Figma. Run pre-verify and build after final main merge; no live tests are required.

## Open Questions
None. Content that lacks an existing presentation contract deliberately uses the supplied summary.

Sizing: one presentation deliverable; approximately 380 production + 330 tests/fixture + 70 plan lines = 780 written lines, at most five exports, no consumer migration, five observable criteria, no new protocol state machine.
