# Settings reconnect cleanup follows the owning host

## Files read

- `src/renderer/src/store/runSettingsWriteBridge.ts` — `subscribeRunSettingsWrite`, `translateWriteEvent`, `RunSettingsWriteData`: reconnect admission and app-lifetime subscription.
- `src/renderer/src/store/runSettingsWriteBridge.test.ts` — subscription tests: injected event delivery and cleanup convention.
- `src/renderer/src/store/runSettingsWriteStore.ts` — `createRunSettingsWriteStore`: correlated settlement and pending-only reconnect reducer.
- `src/renderer/src/store/conversationListStore.ts` — `selectConversations`, `createConversationListStore`: current client-stamped ownership rows.
- `src/renderer/src/store/activeConversationStore.ts` — `activeConversationStore`: current open conversation.
- `src/renderer/src/screens/conversation/unpairAction.ts` — `serverIdForOpenConversation`: unique-owner lookup, rejecting absent or duplicate rows.
- `src/renderer/src/screens/conversation/runConfigLive.ts` — `RunConfigLiveData`: event-time ownership lookup precedent.
- `src/shared/ipc/events.ts` — `ServerOrigin`, `StampedDaemonEvent`: client-bound origin differs from daemon-reported acknowledgement identity.
- `src/renderer/src/store/modelRefusal.test.ts` — existing subscription caller; optional injection preserves its reply handling.
- `src/renderer/src/App.tsx` — `App`: write bridge remains mounted app-wide.
- `docs/knowledge/features/run-settings-write-store.md` — reconnect preserves confirmed/error; confirmation must retain its pending record to commit.
- `docs/knowledge/features/development-verification.md` — source fallback when codegraph is unavailable; injected unit tests exercise subscriptions without React effects.

## Change

Gate only `connected` events inside `subscribeRunSettingsWrite`: require a string-valued client-bound `serverId` matching the active conversation's unique owning server. Add an optional owning-server getter for isolated tests; its default reads current active-conversation and conversation-list stores through `serverIdForOpenConversation` on each event. Never derive origin from `ack.server_id`. Keep translation and correlated confirm/reject handling unchanged, including unmatched replies. Accepted reconnects dispatch the existing pending-only `reconnected` reducer and emit a static diagnostic through an optional logging callback wired in `RunSettingsWriteData`. No UI, wire, store shape or new async task changes; the existing unsubscribe handle still owns teardown.

In-flight overlap: #1701 adds model persistence in this file's fold/binding; it does not rewrite reconnect admission or provide a required dependency. Keep edits local.

Sizing: one deliverable, one production file, roughly 200 total written lines including tests and this security-reviewed plan, no new exported types, no required consumer updates, two acceptance criteria, no new error state machine. Codegraph returned an uninitialized-index error; source search supplied the reading list and callers.

## Testing strategy

Use the existing injected subscription with an isolated production write store and conversation-list store. First observe failing regressions: B reconnects while A owns the pending choice, then A confirms; owner reconnect clears multiple pending writes but preserves confirmed/error; ownership changes after subscription; no active conversation, unloaded/missing/ambiguous/unattributed ownership and absent/null origin preserve pending. Use misleading acknowledgement IDs in both directions. Correlated rejection and unmatched/replayed replies retain their existing semantics. Update the existing reconnect subscription assertion to supply ownership and client origin. Run the touched bridge test file and `npm run build`; no click, layout or live-daemon acceptance is introduced.

## Documentation handoff

No explicit documentation requirement in the ticket. Pending for the documentation stage: update `docs/knowledge/features/run-settings-write-store.md`, section “The data path”, to describe owner-scoped reconnect admission and event-time ownership resolution in `subscribeRunSettingsWrite`.

## Security review

**Verdict:** PASS

- **Trust boundaries:** `subscribeRunSettingsWrite` admits cleanup only from the client-bound event origin and `serverIdForOpenConversation`'s unique stamped row. A misleading `ack.server_id`, duplicate conversation ID, or unknown origin cannot clear another host's pending write.
- **Tokens/secrets:** no new credential generation, persistence or exposure; correlation IDs remain existing non-secret reply keys.
- **File/storage operations:** this change only reads in-memory stores; it adds no paths, storage writes or at-rest data.
- **Electron attack surface:** existing typed event subscription only; no IPC capability, window option, remote content or navigation change. Transport and keys stay in main.
- **Cryptography:** no primitive, handshake, RNG, nonce or key change; host comparison is of non-secret routing IDs.
- **Network/I/O:** no new network operation, connection lifecycle or parsing; this fix consumes already-typed events from the existing boundary.
- **Errors/logs:** diagnostic uses only static event/code, never IDs, settings values, acknowledgement content or secrets. Missing ownership is a preservation no-op, not a new rendered error.
- **Concurrency:** owner getter is sampled synchronously at event time with no await between lookup and dispatch. No snapshot is retained across events; existing effect cleanup unsubscribes.
- **Threat model:** a confused/hostile daemon's reported identity cannot impersonate a client-bound host for cleanup. Relay delay/replay retains existing correlated reducer rules. Disk theft and renderer compromise gain no new capability; their existing protection is outside this in-memory admission change.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-01
