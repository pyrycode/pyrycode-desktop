# Confirmed conversation history deletion

## Files read

- `src/renderer/src/store/chatHistoryWriter.ts` — `createChatHistoryWriter`, `drain`, `capture`, `useChatHistoryWriter`: receipt ownership, buffering, deduplication and shutdown.
- `src/renderer/src/store/chatHistoryWriter.test.ts` — `harness`: injected receipt and scheduler coverage.
- `src/preload/index.ts` — `api.onDaemonEvent`, `historyReceipt`: the existing subscription supplies the deleted id and main-stamped host directly; no preload extension is needed.
- `src/shared/ipc/events.ts` — `StampedDaemonEvent`: confirmed deletion carries `id`.
- `src/renderer/src/store/conversationListBridge.ts` — `shouldRefreshList`: deletion requests a separate list refresh, without mutating the list synchronously.
- `src/main/chatHistoryStore.ts` — `createChatHistoryStore`, `sameRecord`: queued, atomic conversation/list removal with exact host coordinates.
- `src/main/secureStore.ts` — `createSecureStore`: encrypted, availability-gated persistence.
- `e2e/chat-history-removal.test.ts` — `harness`: real protected-store integration with injected persistence.
- `e2e/chat-history-recording.spec.ts` — `frame`, `snapshotText`: mounted writer and restart fixture.
- `docs/knowledge/features/chat-history.md` — “Received-state admission and ownership”, “Window close and app quit”: receipt ownership and host-removal ordering must survive.
- `docs/knowledge/features/development-verification.md` — “Evidence that cannot pass too early”: await successful removal before absence checks.

Codegraph returned an uninitialized-index error; text search supplied the call-site inventory.

## Context

Confirmed daemon deletion currently leaves its protected saved copy behind. This is one persistence integration deliverable; presentation and wire contracts stay as they are.

Sizing: approximately 500 written lines including tests and this plan; one production file, no new exported type/component/store, four existing writer constructors (an optional subscription dependency requires only the mounted caller and test fixtures to opt in), three acceptance criteria and fewer than ten error branches. The estimate is in the same range as the ticket's ~400-line analogue, with protected ordering and restart evidence included. Remote feature branches have no overlaps with the four planned code/test paths.

## Design

Add an optional stamped-event subscription dependency to `createChatHistoryWriter`. `useChatHistoryWriter` supplies `window.pyry.onDaemonEvent`; the writer owns its unsubscribe handle. The callback handles only `conversationDeleted`, captures `serverId` and `id` synchronously, and rejects missing host context without consulting selection or list ownership.

Extend the existing pending queue to hold replacements and `removeConversation` requests. Deletion removes a buffered replacement for that exact timeline, retains unrelated work, and queues removal after already admitted writes. Pending lists for that host are filtered to omit the deleted entry while preserving other entries and order. An already in-flight list/timeline replacement finishes before removal.

Maintain writer-lifetime deleted-id sets per host. `capture` excludes their timeline saves and filters their list entries, including retained timeline mutations and delayed list refreshes. This is independent of holder eviction, list presence and current selection. Successful host removal discards its queue entries, comparison state and deletion set, preserving the existing fresh re-pair behavior. No renderer display state is modified by conversation persistence removal.

## State + concurrency model

The existing single `drain` promise serializes replacements and removals, including normal flush and shutdown. Queue entries retain detached coordinates. Removal entries cannot be overwritten by a stale timeline capture. Deduplication applies to replacements; removal always runs, including for an unloaded or already absent record. After removal, forget comparison state for the affected list and timeline so a later list save cannot be suppressed against pre-removal contents.

Host pause/generation behavior remains intact: paused hosts do not drain; successful unpair discards their pending operations, failed unpair resumes them. Stop unsubscribes stores, daemon events and host removal notifications, settles existing host removal, cancels the timer and drains all remaining operations. No new network request, retry timer or abortable I/O is added.

## Error handling

Use the existing content-free `history-writer-result` diagnostic: missing host reports `unknown-ownership`; removal success reports `conversation-removed` only for `status: ok`; classified storage errors report their static code; thrown IPC failures report `ipc-failed`. Failed removal keeps the protected store's prior content and the writer's suppression of stale saves; no automatic retry or false success is introduced. Explicitly repeated confirmed receipts may retry removal.

## Testing strategy

- Vitest writer tests: explicit confirmed deletion without held/list state, exact captured host/id, missing host, other event types, classified and thrown failures, unsubscribe, and existing host-removal regressions.
- Extend `e2e/chat-history-removal.test.ts` with real protected-store writes held at injected persistence. Exercise buffered and in-flight list/timeline saves, deletion before stop, fresh-instance reads after all work settles, same-host peers and another host's equal id. Partial/empty lists, clear and eviction retain saved timelines.
- Extend the existing fake-transport recording spec: send a delete command, hold confirmation, verify retention, then deliver its correlated receipt. Wait for the real storage operation to return success before checking absence, close/restart and verify both removal and unrelated content persistence. No added history download.
- Run scoped Vitest, `npm run build`, and the focused recording Playwright spec via the approved Electron test helper. No UI visual review is needed for this persistence-only change.

## Open questions

None. The existing stamped-event subscription avoids extending preload receipt context.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/chat-history.md`, especially “Received-state admission and ownership”, “Results and failure preservation” and “Window close and app quit”, with confirmed deletion, cleanup failure and queue ordering, distinguishing explicit deletion from list replacement and memory eviction.

## Security review

**Verdict:** PASS

- **Trust boundaries:** `StampedDaemonEvent` supplies confirmed `id` and main-stamped host. No active-host fallback; `createChatHistoryStore.execute` independently validates requests. Existing main handler retains saved-host authorization.
- **Tokens/secrets:** no token creation, storage or lifecycle changes. Content remains in the existing protected history service, never web storage or diagnostics.
- **File/storage:** reuse `removeConversation` on the fixed collection; ids are record values, never filesystem paths. Existing secure-store adapters use Electron safeStorage, fail when encryption is unavailable and atomically replace the collection under userData. No new file access or check-then-open sequence.
- **Electron surface:** use the existing fixed event and history IPC APIs, without raw IPC exposure or new privileges. Window isolation, navigation policy and process placement are unchanged; no remote content is loaded.
- **Cryptography:** no cryptographic primitive, key, nonce or Noise change; encrypted storage stays in main.
- **Network/I/O:** no new network operation or frame parser; the callback consumes already parsed daemon events.
- **Logs:** only static lifecycle/result codes. Host ids, deleted ids, contents and thrown error messages are excluded.
- **Concurrency:** one drain orders held writes before removal; admission suppression prevents later stale writes, and stop drains deletion before acknowledging shutdown. Unsubscribe is owned by the writer.
- **Threat model:** missing/conflicting selection cannot redirect deletion; exact host scoping preserves equal ids elsewhere. A hostile authenticated daemon can confirm deletion for its own host, consistent with the existing daemon authority. Relay transport, keychain and renderer isolation protections are inherited without weakening them.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13
