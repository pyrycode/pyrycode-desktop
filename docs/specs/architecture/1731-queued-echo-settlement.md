# Queued own message settlement

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository and verification constraints.
- `docs/knowledge/features/conversation-shell-conversation-and-modals.md`, `queue-store.md`, `thread-timeline-internals.md`, `inbound-message-decode-contract.md`: replacement snapshots, optimistic echoes, content/chrome separation and parsing.
- `src/shared/wire/types.ts` → `MessagePayload`; `src/main/transport/inboundMessage.ts` → `parseMessagePayload`: admitted receipt contract.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent`; `threadTimeline.ts` → `reduceTimeline`, `markLocalSendQueued`: named routing and local receipt settlement.
- `src/renderer/src/store/conversationTimelineStore.ts` → `prependHistoryFor`; `queueBridge.ts` → snapshot subscription: host-scoped correlation and history identity.
- `src/renderer/src/screens/conversation/composerSend.ts` → `submitMessage`; `foldQueuedRows.ts` → `foldQueuedRows`; `ConversationScreen.tsx` → `Timeline`; `turnStats.ts` → `turnStatsByItemIndex`: echo origin and display-index assumptions.
- `e2e/live-user-receipts.spec.ts`, `e2e/real-claude-queue-delivery.spec.ts`: mounted receipt barriers and credentialed queue scenarios.
- Daemon `docs/protocol-mobile.md` → message entry and Queue (v2): queue IDs identify entries; ordinary echoed delivery precedes its answering stream, but late fallback and Codex receipts do not establish that timing.

## Design source

Figma: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171 (context and screenshot read). Message area stacks assistant bubbles on the left, user bubbles on the right and outlined tool rows, using existing scheme colours and body-medium/body-small tokens. Preserve shipped queued treatment, Drop, attachment rendering and actions; no new visual state or assets.

## Context

Queued echoes retain tap-time placement and receipts currently deduplicate before settlement. One ordering deliverable, estimated at 720–790 written lines including tests and this plan, zero exported declarations, fewer than ten production consumer changes, five observable criteria and no new error state machine. Codegraph index is unavailable; repository/QMD searches supply context. Overlap with #1721, #1723, #1724, #1726, #1729, #1738 and #1764 is additive and local; no dependency. A simpler snapshot-only fold cannot survive removal-before-receipt or distinguish received rows, so retain local facts independently.

## Design

- Admit optional `queued_msg_id` as a positive safe integer and `sent_now` as a boolean without coercion; omitted fields stay absent. Forward them through the existing typed message event and translation.
- Keep optional timeline sidecars for stable numeric row keys and locally minted echoes. A local record names its row key, nonempty message ID, whether it waited behind running content, observed predecessor boundary, queue entry ID when associated, and settled status. Received/history rows never create local records.
- Assign snapshots one-to-one to unbound local records using nonempty message IDs. Once bound, only that queue ID matches; duplicate message IDs never alias entries. Queue snapshots remain replacement truth in `queueStore`.
- Project unconfirmed waiting echoes below continuing content, in local submission order. Removal alone leaves their placement facts alive. Preserve snapshot-controlled queued treatment and Drop, including after receipt but before snapshot removal. Foreign entries remain independent tail rows.
- A matching receipt settles once: ordinary waiting sends use their observed predecessor turn boundary if available, otherwise the stream delivery point; Send now uses the stream point. Move the held item with its row key, text, timestamp and attachments. Observe the first boundary after submission before a fallback receipt can arrive, so late receipts cannot enter a subsequent reply. Receipts change no activity or chrome state. Metadata-free repeats retain legacy no-op semantics.
- `FoldedRow` carries its source item index. `Timeline` uses that for stats and cursor selection, and stable row keys for React identity and tool expansion. History prepends add new keys while preserving all held keys.

## State + concurrency model

Pure synchronous reducer and snapshot correlation; no new store, timer, subscription or asynchronous job. Existing host/conversation routing, reset/eviction and unsubscribe paths own lifetime. The pending-send indicator remains separate from the local inventory. Drops remove the corresponding own row and its correlation facts.

## Error handling

Malformed optional receipt fields use existing `WireDecodeError` catch/drop handling and static diagnostics. No new error UI; no coercion, inference from text or inference of Send now from disappearance.

## Testing strategy

- Decoder tests reject wrong types, fractional/out-of-range queue IDs and preserve absent/false fields.
- Reducer/fold tests cover both event orders, continuing deltas/tools, multiple sends, late/fallback/Send now and duplicate receipts, ID collisions, received/history ownership, preserved content/time/attachments, keys and history prepends.
- Mounted fake-transport scenarios drive composer sends and receipt/snapshot orders through the encrypted stream; positive output barriers prove dispatch, ordering and one row per send. Capture queued and settled states at 1280×800 for comparison.
- Extend all three existing live queue scenarios with transcript-order assertions. Dispatcher owns credentialed execution and must record dedicated `PYRY_BIN` revision containing `8581e740` and `29f1ab04` or a descendant. Pending live acceptance is not a builder pass.
- Run focused tests, final main merge, pre-verify check, build and focused fake Playwright spec. No dependency or full Playwright sweep.

## Open Questions

None. Optional sidecars avoid changing the durable row schema and preserve existing callers.

## Revisions

2026-10-05: Bind the predecessor boundary to the observed running turn rather than advancing it on every later turn end; late fallback receipts otherwise relocate old echoes into subsequent replies. Remaining queued entries start waiting behind the next answering turn after ordinary settlement. Carry queue identity on `dropUserText` so dropping one colliding entry cannot remove another own echo or a received row. These are local correlation facts; no queue snapshot is copied into the timeline. Track admitted foreign receipt queue IDs separately for idempotence when a different bound local entry shares its message ID. Metadata-free immediate confirmations mark local records settled without changing row content; subsequent snapshots cannot claim them.

The original focused ordering scenarios captured queued/delivered states successfully at 1280×800. The expanded-group scenarios timed out inside Electron screenshot capture after their assertions; retain the earlier reviewed captures (renderer presentation unchanged) and remove capture calls from the behavioral regression. Expanded-group recapture is missing evidence, not a passed capture.

A compact fourth mounted scenario now captures the final queued and delivered presentation at `/tmp/builder-1731/visual-queued.png` and `/tmp/builder-1731/visual-settled.png`; both were viewed and compared with the design reference. All four mounted scenarios pass, including the expanded-group behavioral assertions. Final written work is about 635 added lines including this plan, below every sizing boundary.

2026-10-05 (verifier rework): Finding 1 corrects receipt selection in `reduceTimeline`: metadata-bearing receipts first match a bound queue ID, then may associate an unsettled, unbound local record by nonempty message ID. Settled unbound records cannot shadow that association; metadata-free receipts retain their legacy same-reference idempotence. Regression cases cover both settled and unsettled older collisions and delivery before snapshot association.

Finding 2 corrects the trust-boundary assumption in the original review: `QueueData` runs with the preload's trusted receipt origin, but `ConversationTimelineStore.markLocalSendQueued` must check `receiptHost` against the held slice's `serverId` before correlating or releasing echoes. Another host's colliding snapshot leaves the complete held state unchanged; absent origins retain older event compatibility. The regression covers hostile binding and removal snapshots followed by legitimate settlement. The refreshed branch overlap is #1723, a separate reconnect comment edit in `threadTimeline`; no dependency. Rework adds about 75 lines, staying below the 800-line ceiling.

2026-10-05 (restoration rework): Finding 1 initializes saved row keys as `index - prependedRows` with the next unused key at admission, before any render; reducer updates and history prepends retain those keys. After merging main's tool-run folding, all ancestor/run expansion lookups use source-row identities. Unit and mounted regressions cover live-first and prepend-first orders, expanded Agent/Read/run controls and connected DOM nodes. Overlaps with #1721, #1723, #1726, #1729 and #1789 are local changes or different behavior; no dependency. The existing security verdict holds: parsed saved rows receive only client-owned in-memory numeric keys, with no new trust boundary or capability.

2026-10-06 (mixed-delivery verifier rework): Finding 1 is resolved by committing the pending merge containing `2168a4b73962`, preserving main's Send now wiring alongside source-index statistics. Finding 2 removes the forced-receipt exclusion from `reduceTimeline`'s successor-boundary update: still-held, unsettled echoes sharing the delivered echo's predecessor begin waiting behind the current turn for both forced and ordinary delivery. Released echoes retain their already observed boundary for late receipts. No new state, interface or failure mode is added. Reducer coverage exercises both receipt/snapshot orders with held and released successors; mounted coverage forces A then ordinarily delivers B during the same intervening turn, preserving row identity and tool expansion.

The sole overlap is #1723's unrelated reconnect comment in `threadTimeline`; no dependency. Required rework brings the cumulative branch additions to about 840 lines. These regressions and the one-line guard correction belong to the same ordering deliverable and have no independently useful split. The existing security review remains PASS: only admitted receipt metadata and local in-memory placement facts participate, with `released` guarding late-receipt boundaries and unchanged host/queue ownership checks. Deterministic gates will run against the final main-merged tree; live acceptance remains dispatcher-owned.

## Security review

**Verdict:** PASS

- [Trust boundaries] Corrected MUST FIX from verifier finding 2: `ConversationTimelineStore.markLocalSendQueued` rejects snapshots whose trusted `receiptHost` differs from the held `serverId` before any correlation or release. This origin comes from the preload's dispatch context, never a daemon payload. `parseMessagePayload` admits typed fields; local records and nonempty IDs establish ownership, and exact queue identity takes precedence over unbound message-ID fallback.
- [Tokens/secrets] No credential generation, storage or exposure; IDs are non-secret equality comparands, never logged or rendered.
- [File/storage] No new file operations or web storage; sidecars remain in memory and history rows do not acquire ownership.
- [Electron] Existing typed IPC carries parsed optional fields; no new API, window, navigation or raw markup sink. Transport remains in main.
- [Cryptography] No changes to Noise, keys, nonces or random ID generation.
- [Network/I/O] Existing frame caps and socket lifecycle apply; positive safe integers avoid lossy queue identity, boolean validation rejects truthy strings.
- [Errors/logs] Existing content-free decode diagnostics; never log text, IDs, attachments or secrets.
- [Concurrency] Synchronous association/settlement, immutable state and one-time settlement survive duplicate/reordered snapshots and receipts. Reset destroys local facts.
- [Threat model] Hostile daemon collisions cannot turn received/history/non-user rows into own echoes; compromised relay cannot forge Noise plaintext. No added disk-token or renderer capability exposure.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-05
