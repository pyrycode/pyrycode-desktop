# Explicit host removal clears saved history

## Files read

- `src/main/chatHistoryHandler.ts` — `createChatHistoryHandler` queues membership checks and operations.
- `src/main/chatHistoryStore.ts` — `createChatHistoryStore` atomically removes all matching snapshots, independent of the latest list.
- `src/main/unpairHandler.ts` — `registerUnpairServerHandler` treats credential removal as authoritative and preserves teardown after secondary failures.
- `src/main/index.ts` — history and unpair composition share the same paired store.
- `src/renderer/src/store/chatHistoryWriter.ts` — `createChatHistoryWriter` retains detached pending snapshots through holder clears.
- `src/renderer/src/screens/settings/unpairServerAction.ts` — `runUnpairServer` is the common explicit removal action.
- `src/main/chatHistoryHandler.test.ts`, `src/main/chatHistoryStore.test.ts`, `src/renderer/src/store/chatHistoryWriter.test.ts` — injected handlers and protected-storage test patterns.
- `e2e/chat-history-recording.spec.ts` — received recording, restart, rejected pairing and connected restoration coverage.
- `docs/knowledge/features/chat-history.md` — recording ownership, partial-list retention and explicit-download contract.
- `docs/knowledge/features/paired-server-store.md` — `clearServer` reports a matched erase and fails without modifying credentials.
- `docs/knowledge/features/development-verification.md` — held operations and positive completion checks prevent vacuous absence assertions.

## Context

Forgetting a host currently leaves its protected history behind. Deleting through renderer IPC after removing credentials fails membership validation. Buffered renderer snapshots can also survive holder clears. This ticket adds one retention behavior, with no presentation or wire change.

## Design source

N/A — existing Forget/Unpair controls are unchanged; this is the ticket's data-retention integration, with no new presentation.

## Design

Keep the history handler callable. Attach a main-only `clearServer(serverId, clearCredentials)` capability returning the existing credential outcome. It serializes credential removal and protected `removeServer` with membership checks and storage work. The unpair registration receives this wrapper as its erase-only store in `index.ts`; existing label cleanup, teardown and success transition remain authoritative after credential success.

Add a small renderer removal coordinator in `chatHistoryRemoval.ts`. `runUnpairServer` begins a scoped removal before invoking main and settles it immediately when the result is known, before refreshing identities. Each writer subscribes to begin/settle notifications. Failed removal resumes pending content; successful removal discards that host's pending snapshots, deduplication state and observation ownership. Recovery never invokes this coordinator.

## State + concurrency model

Main captures a per-host generation at history request admission. A successful matched credential removal advances that generation before releasing its queued operation, including when cleanup fails. Requests captured behind removal with the previous generation are refused. Already-running and earlier queued writes finish before deletion; membership validation remains mandatory for later requests and re-pairing allows fresh receipts.

The renderer pauses draining the selected host while removal is pending, continuing other hosts. Successful settle invalidates comparison state and pending snapshots; an in-flight completion may report its result but cannot repopulate deduplication state after invalidation. Fresh receipts after settlement can record normally. Stop unsubscribes and preserves the existing flush lifecycle. Coordinator notifications carry only host identity and outcome in renderer memory, never content or credentials.

## Error handling

Credential failure or unmatched identity does not delete history or advance the main generation. History cleanup errors and throws are contained after credential removal. Emit `history-unpair-cleanup` with static `ok` or `failed`; never log host identity, caught errors or content. Return the successful credential outcome so existing unpaired state and connection teardown complete. Stale requests use the existing `unknown-host` result. No new result union or network behavior.

## Testing strategy

- Extend handler tests with the real protected store over fake secure storage: held membership/write ordering, fresh service reads, orphan timelines, equal ids on another host, re-pair and fresh saves.
- Cover failed credentials, unmatched removal and cleanup failure/throw, including static diagnostics and existing unpair teardown.
- Extend writer tests: buffered and in-flight work across successful removal/re-pair, failed removal resumption, other-host progress and fresh receipts.
- Extend fake-transport recording coverage through explicit Forget and restart; retain existing repair, rejection, partial-list and connected restoration assertions and no-download checks.
- Run touched unit tests, `npm run build`, and the focused recording Playwright spec. No live Claude run is required.

## Scope check

Estimated 650–750 written lines including tests and this plan; five production files, one new exported coordinator capability, two existing production consumers wired, four acceptance criteria, fewer than ten classified failure branches. No feature-branch overlaps found after fetching origin. Codegraph was unavailable; source reads and text searches supplied the call-site check.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/chat-history.md` with explicit host-removal ordering, failure behavior and same-server recovery retention (the ticket's exact requirement; relevant API and received-state admission/ownership sections).

## Open questions

None.

## Security review

**Verdict:** PASS

- Trust boundaries: `isUnpairServerRequest` validates the unpair request; `parseChatHistoryRequest` copies and bounds snapshots before queueing. The new erase capability is main-only and never exposed as a membership bypass over history IPC.
- Credentials: `clearServer` stays the authoritative protected credential operation. No token/key read is added to unpair, and failures retain history.
- Storage: `createChatHistoryStore` retains fixed blob naming, safeStorage-backed encryption, fail-closed encryption handling and atomic collection replacement. Server ids remain values, not paths. No renderer web storage is introduced.
- Electron: no new IPC channel, navigation, window option or Node capability. Coordinator listeners are renderer-local and cannot weaken main membership validation.
- Cryptography: no crypto, nonce, key or Noise variant changes.
- Network: existing connection registry teardown remains wired; repair/reconnect, frame validation and TLS are unchanged.
- Diagnostics: only static event and status codes; caught objects, host ids and saved plaintext are excluded.
- Concurrency: the shared queue orders authorization, writes and removal; admission generations reject requests delayed behind a completed erase. Renderer pause plus successful invalidation handles snapshots not yet sent to main. A failed cleanup still invalidates old work and preserves unpaired truth.
- Threat model: existing relay and hostile-daemon parsing boundaries remain intact. The changed surface is protected retention under explicit user deletion, including buggy late callers, not a new network capability.

**Reviewer:** builder self-review using `builder/security-review.md`.
**Date:** 2026-09-13

## Revisions

- During implementation, shutdown testing showed that a paused writer could acknowledge close before a failed unpair resumed its buffered snapshots. `stop` now unsubscribes, waits for already-started removal settlements, then flushes; settlement cannot schedule a new timer after stop. A held-removal test proves both success and failure. The coordinator exposes two functions (subscribe and begin), within the export budget.

### 2026-09-13 — retained timelines after same-session re-pair

The verifier found that `clearServerScopedState` enumerates the latest list through
`selectExclusiveConversationIdsFor`, leaving omitted timelines held. Resetting writer
ownership alone then rejects all fresh same-host receipts; simply restoring ownership
would instead allow erased text back into storage.

Successful removal settlement in `createChatHistoryWriter` now clears every retained
slice whose `serverId` matches the removed host, using `clearTimelineFor`, before
resuming writes. This includes omitted, restored and pending-read slices, independent
of list claims. Other host-stamped slices remain held. Failed removal and repair do
not clear slices. The existing generation and buffered-snapshot invalidation remain.

The regression in `e2e/chat-history-removal.test.ts` uses receipt-stamped holders, `runUnpairServer`, the actual
`clearServerScopedState` with its production selector, and fresh protected-store
instances to prove only fresh content saves after same-session re-pair. The recording
Playwright scenario now re-pairs before restart and receives fresh text for the omitted
timeline, then checks persistence after restart. No new production file or API is needed.
The cross-process store regression runs in the existing `e2e/*.test.ts` Vitest tier;
importing main storage into a renderer test violates the separate TypeScript project
file lists. Renderer writer tests now supply the same receipt-host callback as production.

### Security review of revision

**Verdict: PASS.** The retained-holder finding is addressed by clearing actual
host-stamped content, not by relaxing writer ownership checks. `serverId` comes from
the existing receipt/restoration boundary; another host's list claim cannot authorize
clearing its slice. Clearing also invalidates pending local-read completion by removing
its exact held slice. Settlement runs synchronously before identity refresh, with no
new async task or subscription. Existing main membership checks, generations, protected
storage, credential outcomes and static diagnostics remain unchanged. No new IPC,
credential, path, crypto, network or markup surface is introduced. The threat under
review is erased plaintext returning through a retained renderer slice; the fresh-store
and same-renderer regressions cover it.

**Reviewer:** builder self-review using `builder/security-review.md`, 2026-09-13.
