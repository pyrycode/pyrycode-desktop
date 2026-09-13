# Saved timelines for offline reading

## Files read

- `src/renderer/src/store/conversationTimelineStore.ts`: `createConversationTimelineStore`, `withSliceAtTail`, `dispatchFor` — bounded holder and mutation seams.
- `src/renderer/src/store/chatHistoryWriter.ts`: `createChatHistoryWriter` — receipt admission and pinned ownership.
- `src/renderer/src/store/savedListRestorer.ts`: `createSavedListRestorer` — injected local-read pattern.
- `src/renderer/src/PairedShell.tsx`: `activateDeps`, `PairedShell` — row activation carries its host stamp.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx`: `ConversationScreen`, `Timeline`, `useThreadScrollPin` — display, copy and existing offline scroll gate.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts`: `connectedConversationHostNow` — existing host-scoped command gate.
- `src/shared/chatHistory.ts`: `ChatHistorySnapshot`, `parseChatHistorySnapshot` — durable display projection and coverage.
- `docs/knowledge/features/chat-history.md`: Snapshot contract; Received-state admission and ownership — restoration must confer ownership without recording a receipt.
- `docs/knowledge/features/conversation-timeline-store.md`, `conversation-shell.md`, `development-verification.md` — nullable holder reads, renderer testing and capture requirements.
- `e2e/chat-history-recording.spec.ts`: restart and rejected-host scenarios — extend existing persistence proof.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

The desktop frame has a 400px sidebar with host/workspace trees beside a scrollable message pane, blue message bubbles and inline copy controls. Retain existing theme tokens, message rows, composer and failed-host repair control; use existing notice typography for the requested local-history messages, with the older-history notice inside the scrollport before its first row.

## Context and size

One deliverable: opening saved timelines offline. Reconciliation and explicit removal remain in #1340. The estimate is approximately 720 written lines including tests and this plan, five production files, at most three new exported symbols, no required consumer signature cascade, five acceptance criteria and fewer than ten reject branches. The writer analogue spans 604 inserted lines before IPC wiring and documentation. Refreshed remote feature branches have no overlap with the five intended files or recording spec. Codegraph is uninitialized in this worktree; source reads were used.

## Design

Add an explicit `beginLocalTimelineRead(serverId, conversationId)` store entry point returning completion, failure and cancellation handles. Its pending slice occupies the existing ten-slot holder and uses the existing view/eviction order. It replaces an unowned or differently owned held slice rather than treating another host's rows as a cache hit. A settled same-host local slice is reusable. Store-owned admission compares the exact pending slice, so later mutations, clears, replacement reads and eviction invalidate both success and failure. Installation preserves items, prepended row count and saved coverage while resetting transient timeline state.

Host ownership and local-read metadata live on the slice, separately from connection truth. Received mutations stamp their synchronous receipt origin; a receipt from a different host cannot append onto a restored host's rows. The writer recognizes explicit successful restoration before its ordinary receipt checks, records ownership and coverage without scheduling a save, and continues its existing unambiguous same-host recording rules. Eviction remains memory disposal, never disk deletion.

An injected `readSavedTimeline` helper performs only `readTimeline`, validates returned snapshot kind and coordinates, and settles the handle. It logs static lifecycle/result codes, catches rejected IPC and never selects a conversation. Shell row activation starts the read using the clicked row's host stamp when that host is unavailable. The screen checks the active row's host against the held slice before displaying offline content, including equal ids on two hosts.

Local notices distinguish loading, failed reads, successful missing/empty data and saved rows. The older-history notice is omitted only for explicit saved `atStart`; it does not issue requests. Existing command gates stay in place. Restored rows use initial transient state, so partial messages and tool reports do not resurrect working or actionable recovery state.

## State and concurrency

IPC cannot be aborted; cancellation invalidates admission. Navigation owns cancellation of pending reads. Exact slice identity prevents delayed results from overwriting received updates or repopulating a cleared/evicted slice. No timers, retry loop, transport subscriptions or connection mutations are added. Selected coordinates and stored coordinates must agree before display or admission.

## Error handling

Missing and stored-empty results are successful empty reads. Error results, rejection, malformed snapshots, wrong kinds and wrong coordinates produce a local failure; they never change session status or write saved data. Diagnostics contain only static event and classification strings, never coordinates, content or caught exception details.

## Testing strategy

- Store/injected tests: admission, missing/empty/failure/mismatch, delayed success/failure after received update, clear, navigation cancellation and eviction; eleven opens and reload; equal ids on two hosts; coverage and row identity metadata.
- Writer tests: restoration and eviction do not save/delete; subsequent unambiguous same-host receipt saves with restored ownership and coverage; conflicting ownership stays refused.
- Static renderer tests: local notice variants and saved coverage.
- Extend the recording Playwright spec to open/copy restored received messages after normal quit, and under pairing rejection alongside a connected host. Observe renderer outbound commands around offline opening/scrolling. Capture at 800×800 and 1280×800 and compare with Figma.
- Run focused Vitest, build and the one recording Playwright spec. Full regression belongs to the verifier; live Claude is unnecessary.

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/chat-history.md` to describe on-demand offline timeline restoration, restored ownership, local timeline-read failures and the distinction between saved coverage and current server history. Relevant sections: Snapshot contract; Received-state admission and ownership; Results and failure preservation.

## Security review

**Verdict:** PASS

- Trust boundaries: `readSavedTimeline` validates projected snapshots and exact coordinates before store admission. Main's existing handler independently validates requests and saved-host membership; unavailable and rejected hosts remain eligible.
- Storage and secrets: reuse main's protected chat-history service and Electron `safeStorage`; unavailable encryption fails without plaintext fallback. No new disk paths, renderer web storage, credentials or cryptographic operations.
- Electron and network: no new IPC channel, navigation surface, remote asset or transport operation. Saved text stays in the existing escaped display renderers; keys and sockets remain in main.
- Concurrency: exact pending-slice identity and cancellation reject stale results after mutation, navigation, clear and eviction. The bounded holder owns all settled state; host comparison prevents substituting another saved copy.
- Logs: only static local-read lifecycle and error codes; no content, ids or exception objects.
- OUT OF SCOPE: reconnect reconciliation and removal integration remain in #1340; this change neither downloads history nor modifies pairing or relay security.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

- 2026-09-13: `reseededActiveConversation` deliberately projects wire fields, so the saved host cannot rely on an incidental extra field surviving active metadata refresh. `PairedShell` retains the clicked saved coordinates and passes them explicitly to the conversation view; metadata-only refreshes do not cancel reads. Pending results still have no selection write. Saved rendering also suppresses the tail cursor and grouped-tool running labels, which are derived from row shape rather than transient store state.
