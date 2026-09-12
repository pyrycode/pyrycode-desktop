# Save received chats on this device

## Files read

- `src/shared/chatHistory.ts` — `ChatHistorySnapshot`, `parseChatHistorySnapshot`: detached display-only projection, including partial rows and coverage.
- `src/main/chatHistoryStore.ts`, `src/main/chatHistoryHandler.ts` — `createChatHistoryStore`, `createChatHistoryHandler`: serialized protected collection and saved-host authorization independent of connection state.
- `src/main/index.ts` — `createWindow`, `openWindow`: secure-store composition and window/quit teardown.
- `src/preload/index.ts` — `api.onDaemonEvent`: synchronous stamped event delivery and the typed bridge.
- `src/renderer/src/App.tsx` — `App`: app-lifetime subscription mounting.
- `src/renderer/src/store/conversationListStore.ts` — `setConversations`, `byServer`: received ordering and client-stamped origins.
- `src/renderer/src/store/conversationTimelineStore.ts` — `dispatchFor`, `prependHistoryFor`, `recordHistoryPage`, `markViewed`: immutable slices, ten-chat eviction and transient request state.
- `src/renderer/src/store/timelineBridge.ts`, `historyPageBridge.ts` — `useTimelineBridge`, `useHistoryPageBridge`: synchronous folds; page prepend precedes successful coverage.
- `src/renderer/src/screens/conversation/composerSend.ts` — `attemptSend`: optimistic echoes append identified user rows with local send state.
- `e2e/fixtures/launchPairedApp.ts` — `launchPairedApp`, `reuseUserDataDir`: production pairing and disconnected relaunch proof.
- `docs/knowledge/features/chat-history.md` — “Snapshot contract”, “Storage and concurrency”: whole-collection I/O, coverage independence, no restoration via live reducers.
- `docs/knowledge/features/secure-store.md`, `conversation-timeline-store.md`, `development-verification.md`: encryption fallback, immutable rows, and effect verification in Electron.

## Context and scope

Connect the existing local history service to received app state. This is one recording integration, with no visible UI or Figma change. Offline restoration remains #1339; reconnect, scroll policy and explicit removal remain #1340. No ADR is needed.

Size check: five production files (main, preload, shared contract, new writer, App), approximately 370 production + 320 test + 75 plan lines, below 800 total. No existing consumer signature changes, at most two new exported functions, five acceptance criteria, fewer than ten classified rejection branches. The refiner's 780-line estimate is consistent with this design. The refreshed remote feature-branch overlap check found no overlap. Codegraph reported an unavailable index; source reads supplied the map.

## Design

Register one `createChatHistoryHandler` over one `createChatHistoryStore`, sharing the existing `secureStore` and `pairedServerStore`. Expose `chatHistory(request): Promise<ChatHistoryResult>` through preload using a fixed channel. Main keeps validation and serialization authoritative.

`createChatHistoryWriter` observes injected list/timeline stores; `useChatHistoryWriter` mounts it once from `App`. Preload supplies a synchronous receipt context containing only event type and stamped server identity while a daemon subscriber runs, restored in `finally`. This avoids subscription-order guesses and captures the actual supplying host before any deferred save. No raw IPC object crosses preload.

Record list replacements only during `conversationsReceived`. Timeline notifications during daemon delivery retain the supplying origin; outside delivery admit only a newly appended local user echo (local-send state, user row, unchanged preceding row references). Direct snapshot installations, startup state, empty activation and clears do not qualify. This leaves future restoration setters free to install snapshots without replaying events or triggering replacements.

Pin an owner for each held timeline. Refuse missing origin, conflicting list claims or an owner change while content remains held; taint such content until the slice is cleared/evicted rather than later guessing. Echo ownership must resolve uniquely from the received list. Saved-host membership is checked again in main. Queued detached snapshots retain their original coordinates after host/chat switches and clears.

Project with `parseChatHistorySnapshot` so only declared nested display fields reach storage. Keep each slice's last successfully received coverage independently of requested/failed state; unknown remains unknown until success. Preserve `prependedRows`, attachment references and partial answers without manufacturing a boundary.

## State and concurrency model

A per-record pending map coalesces bursts on a short timer. Compare canonical projected values to the latest queued/in-flight/successful value, issuing replacements only for durable changes. One async drain processes captured snapshots; updates arriving during an await remain queued and the newest wins. Eviction removes observation metadata, never pending content or disk records. Failed writes do not poison the drain; later changed content can save.

`stop()` unsubscribes, cancels the timer and drains queued/in-flight work. Normal window close and `before-quit` defer destruction until preload invokes that stop/flush callback and acknowledges it. Main checks the acknowledging sender against the window, awaits already submitted history operations and only then resumes close/quit. Readiness registration avoids waiting on a window that never mounted an observer; destroyed renderers release their wait. Handlers remain registered until `will-quit`, with no reconnect listeners added.

## Error handling

Projection, attribution and IPC/storage failures produce static, content-free diagnostics, never conversation text, ids, paths or caught errors. Storage failures stay local and cannot dispatch connection state or request history. Existing protected storage preserves unreadable collections and rejects unavailable encryption without a plaintext fallback. Process kill is outside graceful-drain guarantees; atomic writes still preserve the last complete collection.

## Testing strategy

- Inject stores, receipt context, storage and scheduling in Vitest: coalescing, newest-during-write, failure recovery, list ordering, durable projection, successful coverage across failures, echoes, ambiguous/changing/missing hosts, restoration/empty/transient no-ops, eviction before scheduled save across eleven chats, and stop/flush cleanup.
- Fake-transport Playwright: production observer and handler save live content and a loaded older page; quit with buffered content; relaunch with the same directory and read it while disconnected. Exercise pairing rejection and saved-host validation, and count history requests to prove recording adds none. The fixture's test encryption backend does not prove the OS keychain adapter.
- Run only the new scoped unit tests, `npm run build`, and the new focused Electron spec. Full regression belongs to the verifier.

## Open questions

None. A future restored slice needs explicit ownership installation before recording further live content; #1339 owns that restoration entry point. Until then, unknown existing content is preserved rather than attributed.

## Documentation handoff

Pending for the documentation stage (verbatim refiner handoff): “The documentation stage should update `docs/knowledge/features/chat-history.md` to describe the wired observer, durable coverage, host attribution and quit-flush behavior, retaining the whole-collection I/O tradeoff and the #1339/#1340 integration boundaries.” Relevant sections: “Snapshot contract” and “Storage and concurrency”.

## Security review

**Verdict: PASS.** Reviewed against the builder security checklist on 2026-09-12.

- Trust boundaries: `createChatHistoryHandler` validates/copies every untrusted request and checks saved membership; `parseChatHistorySnapshot` allowlists nested display fields. Receipt origin comes from main's stamp; conflicting held ownership is refused.
- Tokens/crypto/storage: reuse `secureStore`, OS `safeStorage`, fixed collection name, owner-only atomic persistence under `userData/secrets`; unavailable encryption fails closed. No new key, nonce, credential, renderer web storage or caller-controlled path.
- Electron: fixed typed history and flush channels only; acknowledgements are window/sender scoped. Existing sandbox, context isolation and navigation guards remain intact; no remote content or Node capability is introduced.
- Network: no new socket, history request, relay policy or handshake; transport remains in main. Relay threat defenses remain in the existing transport, outside this integration.
- Logs/errors: static classifications and counts only; parser/IPC exceptions are contained without forwarding their messages or payloads.
- Concurrency: detached capture before deferral, single drain, retained pending records through eviction, acknowledged close/quit, and exact listener/timer cleanup.
- Threat alignment: compromised renderer can request only validated operations for saved hosts, never obtain credentials or filesystem paths. Hostile daemon display text is data, never markup or logs. Disk theft remains covered by protected storage; restoration and explicit-removal lifecycle are deferred to #1339/#1340.

**Reviewer:** builder self-review.

## Revisions

- 2026-09-12: the composer symbol in the reading list is `submitMessage` (the initial `attemptSend` name was a transcription error). Verification exposed a coalescing detail: compare the drained candidate with the last successful value as well as the latest queued value, so a burst that returns to the saved value issues no replacement. The record-level contract is unchanged.
- 2026-09-12 (PR #1355 verifier rework): `dropQueuedMessage` dispatches `dropUserText` outside daemon delivery. Admit removal of one locally observed echo object with a nonempty message id only when all surviving rows retain their references and order, and history/prepend metadata is unchanged, matching `removeUserEcho`. Track admitted echoes weakly so eviction retains no extra rows. Keep the held owner and successful coverage, including when the last echo is removed; conflicting list claims and unknown/restored ownership still refuse replacement. This corrects the append-only admission rule without adding a store API or history request. Injected cancellation/continued-stream regressions and a fake-transport cancellation flow prove it. Rechecked scope: five production files overall, no added exports or consumer migrations, and estimated total written work remains below 800 lines.
- Security review of the rework: PASS. `createChatHistoryWriter` recognizes only previously admitted local echo objects; a shortened restored snapshot cannot establish ownership, and conflicting hosts remain refused. Main's saved-host validation and protected snapshot projection are unchanged. The weak references add no I/O, IPC, credentials, logs containing content, or async lifecycle.
