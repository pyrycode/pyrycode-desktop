# Settle local sends against daemon user items

## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/conversation-shell.md`, `docs/knowledge/features/composer-send.md`: renderer ownership and existing feedback/rollback contracts.
- `docs/knowledge/features/development-verification.md`: static rendering versus mounted interaction evidence.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage`: injectable send and attachment rollback boundary.
- `src/renderer/src/store/threadTimeline.ts` → `LocalSendPending`: newest-send feedback is not a pending inventory.
- `src/renderer/src/store/threadItemStore.ts` → `ThreadSnapshot`, `ordered`: retained hidden facts and first-arrival provenance.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `threadItemPresentations`, `nest`: authoritative display and agent placement.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsTimeline`, `TimelineRow`: existing bubble, queue controls and feedback styling.
- `src/shared/ipc/commands.ts` → `dequeueMessageCommand`, `sendQueuedNowCommand`: existing command payloads; host is supplied separately to the callback.
- `e2e/thread-items.spec.ts` → `ThreadFixture`: ticket-owned mounted fixture, explicit snapshots and inputs.
- Daemon ADR 042, “Own and queued messages,” and protocol-mobile “Full thread item”: device/message identity, acceptance-owned queue handle, terminal lifecycle and supplied order.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-4
Read design context and screenshot. Preserve the right-aligned user bubbles, leading queue controls and composer status treatment using existing components and tokens. No layout, typography or asset changes.

## Context
An accepted send belongs to the daemon item, even when acknowledgement was lost or the first observed item is terminal or hidden. Production identity access, capability activation and integration remain #1908. Session/read adapters remain independent and untouched. No overlapping remote feature branches were found in the planned existing production files.

## Design
- Add an injectable Zustand `createThreadSendStore` with host/conversation-scoped pending rows, capturing the supplied opaque device identity per submission. Keep newest-send feedback separately from the inventory.
- Supply `retain`, `feedback`, `settle(snapshot)`, scoped selection, conversation deletion, host removal and owner disposal. `feedback` only changes still-pending rows; settlement uses usable nonempty device and message IDs from all retained user items, including hidden facts.
- `submitMessage` optionally takes the store and trusted device identity. This explicit route retains before sending and bypasses both legacy echo writers; the absent option preserves current behavior. Bridge failure rolls attachments back and marks only a still-local row Not sent.
- Extend `ThreadItemsTimeline` with explicit scoped pending/feedback and connection/action inputs. Render pending rows using `TimelineRow`; accepted text and attachments come exclusively from the snapshot. No queueStore, echo or reducer projection enters this view.
- Queue actions use an exact positive safe integer `content.queued_msg_id`, only for shown active queued user items and a connected matching host. Callback receives host plus an existing typed queue command targeting the snapshot conversation. Catch bridge exceptions without changing authoritative state.
- Project unordered user items to the tail using snapshot first-arrival order before existing agent nesting. Positive daemon order controls delivery placement. Explicit lost status adds the existing error treatment with fixed “Not delivered” copy.
- Field availability checks include enclosing records and truncation/drop markers. No fallback from item identity, display text or message id to a queue handle.

## State + concurrency model
No production subscriptions or async jobs are introduced. The owner supplies snapshots and transport feedback and subscribes to the store. Settlement publishes only changes; repeated snapshots are inert. Pending inventory survives view switches and disconnects; deletion/removal/disposal retires it. Snapshots remain owned by the item store and session/account/read state is not rewritten.

## State transitions and identity reuse
| Event | Test coverage |
| --- | --- |
| Multiple sends, scope switches, unavailable device identity | `threadSendStore.test.ts`: scoped inventory and captured identity |
| Peer equal ID, damaged identities, other host/chat snapshot | `threadSendStore.test.ts`: strict scoped identity |
| Live or catch-up first queued/delivered/hidden/lost item; repeated snapshot | `threadSendStore.test.ts`: settlement and terminal first observations |
| Later transport feedback or synchronous bridge failure after acceptance | `threadSendStore.test.ts`: acceptance owns display and late feedback |
| Strict queued ownership re-established in a new epoch, followed by unavailable identities and delivery | `threadSendStore.test.ts`: re-establishes queued ownership across epochs before identities become unavailable (same or different item ID) |
| Queued delivery, drop, loss, historical queue handle reused | `thread-items.spec.ts`: queue lifecycle actions; `threadItems.test.tsx`: eligibility and authority |
| Cleanup and same scope reopened | `threadSendStore.test.ts`: scoped retirement and owner disposal |

## Error handling
Keep pre-acceptance Sending, Waiting for connection and Not sent semantics. Queued acceptance marks newest feedback Waiting for Claude; terminal revision clears it. Unavailable identity cannot settle. Unavailable or inexact queue handles cannot act. Bridge exceptions preserve authoritative rows and use content-free injected logs.

## Testing strategy
Test first with focused Vitest tests for the store/composer seam and static presentation assertions. Extend only the existing mounted fake-transport thread fixture for queue clicks with item 100/queue handle 7, delivery, authoritative hiding, restart loss and reuse. Run the focused spec, pre-verify and build after final main merge; no live Claude or capability switch. Capture the mounted queued state at 1280×800 for visual review.

## Open Questions
None. A separate pending store is simpler than extending the legacy reducer: its inventory and accepted-item authority are explicitly scoped and injectable.

Sizing: one settlement deliverable, approximately 650 written lines including plan/tests, four production files, three new exported types/store surfaces, three existing consumers changed, five observable acceptance criteria, fewer than ten distinct failure branches.

## Revisions
2026-10-14: The existing `nest` lane comparator owns agent placement and overrides a pre-sort. Apply unordered-user tail placement and first-arrival tie breaking inside that comparator, preserving its agent branches. Queued presentation is independent of action eligibility: disconnected or handle-less accepted rows keep the existing dimming without inventing a handle or drawing actions.
Once strict settlement establishes ownership, newest-send feedback follows that scoped item ID within its epoch, including later revisions with unavailable content identities. An epoch change must establish ownership again by both identities; a reused item ID cannot retain queue feedback. Covered by `threadSendStore.test.ts` “follows an accepted item after identity fields become unavailable and fences epoch reuse.”

2026-10-14 (verifier finding 1): `createThreadSendStore.settle` must compute next accepted ownership before its no-change guard and compare both epoch and item ID. Strict re-establishment in a new epoch publishes ownership even when pending inventory and queued feedback are unchanged. The regression “re-establishes queued ownership across epochs before identities become unavailable” covers reused and changed item IDs, unavailable identities immediately afterward, repeated snapshots and terminal delivery. Both cases failed at retained queued feedback before the fix.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/composer-send.md`, “Data flow”: injectable pending-send inventory, per-send trusted identity, strict scoped settlement, epoch-bound accepted ownership, cleanup and newest-send feedback.
- Pending documentation stage: `docs/knowledge/features/conversation-shell.md`, “What it does”: daemon text/attachment authority, unordered tail placement, genuine queue-handle eligibility and terminal action removal.
- Pending documentation stage: `docs/knowledge/features/composer-send.md`, “How it works”: this adapter remains inactive until #1908; preserve the independent session/read adapters from #1935 and #1936 during integration.
