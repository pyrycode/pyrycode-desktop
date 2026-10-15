# Visible authoritative thread read marks

## Files read
- `src/renderer/src/store/conversationUnread.ts` → `isConversationUnread`: retain legacy comparison, add explicit thread mode.
- `src/renderer/src/store/conversationReadPublisher.ts` → `createReadPublisher`, `readTargetFor`, `useReadObservation`: committed evidence and attempted/confirmed separation.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `stampLastReadFor`, `conversationLastReadDeps`: suppress local stamps even when thread metadata is unavailable.
- `src/renderer/src/store/appBadgeBridge.ts` → `conversationStatusNow`, `subscribeToAttentionStores`: preserve ranking and exclusions.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ConversationStatusDotControl`: host-owned route selection.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ThreadItemsView`: preserve nested/collapsed presentation and existing scroll pin.
- `src/renderer/src/screens/conversation/threadItemPresentation.ts` → `threadItemPresentations`: shown rows and nested projection.
- `src/renderer/src/store/threadItemStore.ts` → `success`, `beginBatch`: checkpoint, ranges, repair and unfinished progress semantics.
- `e2e/thread-items.spec.ts` → `rendererFixture`: extend existing supplied-input fixture; no new harness.
- `docs/knowledge/INDEX.md`, `features/conversation-shell.md`, `features/channel-list.md`, `features/development-verification.md`: renderer units are static; mounted evidence needs receipt/commit barriers.
- Daemon `docs/knowledge/decisions/042-daemon-built-thread.md` → Sessions, agents, messages, read marks; `docs/protocol-mobile.md` → Marking a conversation read: only foreground presentation establishes sight.

## Design source
Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 (context and screenshot read). Retain the existing sidebar dots, 400px sidebar, conversation bubbles and top/input chrome. Existing theme tokens and nested row components remain unchanged; no assets or styles are added.

## Context
Thread unread uses received shown versions rather than history counts. The inactive authoritative view needs a supplied read seam before #1908 activates production subscriptions. #1905/#1937 and #1935 are merged; no overlapping numeric feature branches touch the design files. This is one visible-read-evidence deliverable, no ADR needed.

## Design
- Add a small explicit route store keyed by host/conversation with epoch values. It starts empty; only supplied callers select thread mode. Props alone were considered, but sidebar/badge/stamp consumers need the same selection without deriving it from optional fields.
- `isConversationUnread(..., row, threadMode)` compares complete shown/read metadata only in thread mode; unavailable metadata returns false without a legacy fallback. Dot and badge consumers select the owning route; stamps are suppressed for any matching thread ID because legacy marks are ID-keyed.
- Extend `readTargetFor` with supplied immutable snapshot and received summary. Require matching host/conversation, complete metadata, checkpoint at least the shown target, a certified loaded range containing the newest ordered shown row, and repair's complete-progress fence. Held version, IDs and revisions never select the target. Unfinished progress cannot raise checkpoint authority.
- `ThreadItemsTimeline.readInputs` supplies the summary and overlay state paired with that render. `useReadObservation` advances these inputs only in its layout effect. Locate the newest ordered shown source row by numeric identity, independently of projected/nested placement; hidden ancestors or a folded proxy never count as that row.
- Observer callbacks may recheck live ownership, route epoch and metadata availability, but never replace the committed target with a newer list watermark. Require focused/visible document and trailing edge inside top/input chrome bounds. Layout commits, scroll, resize, focus, visibility and list changes recheck evidence; collapsed rows remain excluded.
- Publisher pending records carry optional epoch. Thread ownership is host-qualified; legacy ambiguous-ID refusal remains. Before attempts/retries/acknowledgements, require the same route epoch and complete received contract. Preserve coalescing, one attempt per target/link generation, clamped pending targets, and daemon-only confirmation. No send mutates read marks.

## State + concurrency model
Route state is an explicit Zustand slice; no negotiation or thread subscription is installed. Snapshot/summary evidence is render-owned and immutable. Existing list/link subscriptions own retry work. Observer listeners and ResizeObserver are disposed on replacement/unmount. Route changes invalidate pending old-epoch targets synchronously through publisher sync; view scope keys reset DOM evidence. No new timer, I/O job or wire state machine.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Missing/zero/equal/newer shown metadata; local mark suppression | `conversationUnread.test.ts`, `conversationLastReadBridge.test.ts` |
| Focus/blur, reader open/close, above-tail, chrome overlap, collapsed descendant | mounted `publishes only committed visible authoritative read evidence` |
| Same-row append received before React commit; list/focus/scroll callbacks | same mounted test, callback barrier before commit |
| Hidden/unordered trailing item, older/incomplete/abandoned batch, repair fence | `conversationReadPublisher.test.ts` and mounted evidence test |
| Offline observation/reconnect, clamped/late acknowledgement, deletion/owner loss | publisher unit tests and mounted evidence test |
| Host/epoch replacement and duplicate IDs | publisher unit tests and mounted evidence test |
| Re-render/repeated observation/unmount | mounted test and existing legacy publisher regressions |

## Error handling
No new I/O boundary. Missing metadata, scope mismatch or incomplete/hidden evidence grants no authority. Existing host-bound command validation/routing stays in main. Send failures remain attempted but unconfirmed, retried only on a new observation or reconnect; no response text is rendered or logged here.

## Testing strategy
Test first: extend watermark, stamp and publisher units, run red, then implement. Use actual item store snapshots for completeness tests. Extend the existing mounted item fixture with supplied route/summary/overlay controls and pre-commit callback probes; assert outbound targets independently of received marks, with commit/receipt barriers for absences. Run the focused thread-items spec, pre-verify and build after final main merge. Capture 1280/800 screenshots of the existing presentation. No real-Claude run required; #1908 owns combined live proof.

## Open Questions
None. Completion metadata is consumed as supplied; catch-up requests belong to #1902, queue settlement to #1906, production activation to #1908.

## Security review
**Verdict:** PASS
- Trust boundaries: MUST FIX addressed in design — stale list callbacks cannot upgrade committed targets; validate safe numeric targets and require matching immutable evidence and host/epoch.
- Tokens: no credentials generated/read/stored; existing main safeStorage remains unchanged.
- File/storage operations: no new persistence, paths or content storage; route/evidence live only in memory.
- Electron attack surface: reuse only `markConversationRead`; main's existing validation and host routing remain unchanged. No raw IPC or navigation surface added.
- Cryptography: no crypto changes; transport and Noise remain in main.
- Network/I/O: no new network path; reconnect retries only previously evidenced targets, with existing connection generations.
- Errors/logs/telemetry: no daemon content enters logs; observer is silent, existing command diagnostics remain content-free.
- Concurrency: MUST FIX addressed in design — epoch invalidation, ownership recheck and layout-effect evidence updates fence stale callbacks, retries and acknowledgements; cleanup removes listeners.
- Threat alignment: hostile delayed/reordered daemon inputs cannot certify beyond checkpoint/repair/coverage; compromised renderer remains bounded by existing main IPC validation. Relay/credential/isolation hardening is unchanged; authenticated production activation belongs to #1908.
**Reviewer:** builder (self-review per `builder/security-review.md`). **Date:** 2026-10-14.

Sizing: ~760 written lines (280 production, 400 tests/fixture, 80 plan), ≤5 new exports, 7 existing consumer updates, 5 observable acceptance criteria, no new protocol state machine. Recounted before committing.

## Revisions
2026-10-14: Reading `threadQueryCoordinator.receive` established that page certificates can also advance `checkpoint`, and incremental catch-up/live updates need not widen saved order ranges. `ThreadReadInputs.completeThrough` therefore explicitly supplies completed newest-window/catch-up progress represented by the rendered snapshot; older pages never advance it. Targets are bounded by both it and checkpoint/repair. Certified nonempty ranges establish the loaded baseline, including its live suffix, rather than treating a held maximum order as proof. The mounted fixture supplies this separate completion watermark. Publisher injection on the supplied seam records attempts independently of real bridge delivery.
2026-10-15: A shown unordered/queued source makes a new target unavailable because ordered-row visibility cannot certify that content; a hidden queue source grants no evidence and does not block an earlier shown target. The mounted fixture also waits for both real fake-transport links before replacing App, and uses keyboard Home to establish user scroll intent.
2026-10-15 (verifier finding 1): Keep `ConversationListData` mounted in the supplied item view.
Fake-daemon `conversation_updated` replies correlate with recorded wire request IDs; unsolicited
late marks also pass through transport. Committed receipt/list output fences absence assertions.
Cover below-target clamps, confirmation retirement, late receipts after pending-epoch replacement
and host switches, and deletion/owner loss with the observer still mounted. Capture publisher
commands as host/conversation/target separately from wire delivery: duplicate IDs received from
both daemons remain refused by main's existing ambiguous-owner guard. No production contract changes.
#1964 overlaps this file's separate agent-scroll test; edits remain local to read evidence.
Recount: about 590 written lines overall, no new exports or production consumers in this repair.

2026-10-15 (verifier finding 2): The roster scenario in `e2e/tool-groups.spec.ts`
stores history requests from two conversations in one slot, although main's
`requestHistory` correlates replies by request ID and suppresses repeated pending
requests. Make the quiet conversation's outstanding request an explicit barrier
before returning to the seeded conversation, reproducing the wrong-reply race.
Then capture requests by owning host/conversation and answer the seeded request;
wait for its historical child to commit before asserting the existing finished
marker. Keep quiet history delayed throughout. No production behavior changes.
No other numeric feature branch overlaps these repair files. The runtime
CodeGraph sidecars are already untracked by merged main. Obtain the complete
native fake suite for the pushed candidate, preserving its configured workers,
projects and retries; inspect all returned results and setup attachments.
Recount: under 700 total written lines, no additional exports or consumers.
