# Restore saved host conversation lists offline

## Context and scope

Restore saved lists for browsing after launch when a host is unavailable. Timeline
restoration belongs to #1388; reconnect reconciliation and explicit removal belong
to #1340. No ownership migration or new storage format is needed.

One deliverable, three acceptance criteria. Estimate: about 450 written lines
including tests and this plan, four TypeScript production files plus one stylesheet,
at most two new exports, one new consumer, and four read-result branches. No existing
required signature changes. The #1338 analogue has 604 inserted lines across its
writer, tests, recording spec and plan, matching the refiner's stated comparison.
The refreshed remote feature-branch check found no overlap in planned existing files.

## Files read

- `src/renderer/src/store/conversationListStore.ts`: `createConversationListStore`, `stampRows`, `flattenByServer` preserve host coordinates and row order.
- `src/renderer/src/store/serverInfoStore.ts`: `selectServers` supplies saved identities independently of connection state.
- `src/renderer/src/store/chatHistoryWriter.ts`: `createChatHistoryWriter` admits list saves only during received-list delivery.
- `src/shared/chatHistory.ts`: `ChatHistoryResult`, `parseChatHistorySnapshot` define bounded local display records.
- `src/renderer/src/PairedShell.tsx`: `PairedShell`, `activateDeps` own the persistent shell and gated chat activation.
- `src/renderer/src/screens/channels/ChannelList.tsx`: `HostRowControl`, `HostRow`, `renderServerTrees` supply host grouping and repair controls.
- `src/renderer/src/store/conversationListStore.test.ts`: isolated store fixtures and clear notification contracts.
- `e2e/chat-history-recording.spec.ts`: normal quit and protected persistence proof.
- `e2e/fixtures/launchPairedApp.ts`: `launchPairedApp` supports preserved user data and a second saved host.
- `docs/knowledge/features/chat-history.md`, Snapshot contract and Received-state admission and ownership: direct list installation must never become a save or deletion signal.
- `docs/knowledge/features/channel-list.md`, CSS: repair and edit controls need actual click coverage; retain their layout.
- `docs/knowledge/features/paired-shell.md` and `conversation-list-store.md`: route lifetime and per-host list union.
- `docs/knowledge/features/development-verification.md`: static renders do not execute effects; restart requires Electron proof.

Codegraph reported an uninitialized index; source reads supplied the code map.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

The inspected context and screenshot show a 400px sidebar with separate host/workspace
trees, compact body-small conversation labels and paired connection dots beside host
titles. Preserve that hierarchy and the failed-host repair control; add static local
read failure copy beneath the affected host using body-small and error theme tokens.

## Design

`createConversationListStore` gains `beginLocalListRead(serverId)`, returning a
completion/failure/cancellation handle or null when a list or local read already
exists. Per-host `localListReads` distinguishes loading, loaded and failed. Completion
installs stamped rows directly, including an empty array for missing/empty success;
failure leaves the list absent. This path never invokes `setConversations` or a
daemon reducer. The existing writer receipt guard excludes it from persistence.

A new `createSavedListRestorer` in `store/savedListRestorer.ts` observes the saved
identities and calls only `chatHistory({ operation: 'readList', serverId })`. It checks
stored snapshot kind and host against the requested identity before completion.
`PairedShell` mounts it once with production stores and returns its teardown.
`HostRowControl` reads its host's failure flag and supplies an optional presentation
prop to `HostRow`; `channels.css` styles the adjacent failure paragraph.

## State and concurrency

Store-owned unique read tokens guard completion synchronously. Received lists and
host/global clears invalidate pending tokens, including clears before any rows exist.
Other hosts retain their rows by reference. Cancellation removes pending read state
so a remounted shell can retry; loaded/failed results remain settled during navigation.
The restorer tracks attempted saved identities, cancels departed hosts, unsubscribes
and cancels outstanding handles on teardown. IPC reads themselves are not abortable;
late results cannot pass the cancelled token. No selection, session or working-state
store is written, and no navigation callback is reachable from restoration.

## Error handling

Missing and stored lists succeed; typed errors, rejected IPC and unexpected result
kind/coordinates fail locally. Static diagnostics report start, result and teardown
without ids, content, paths or caught exceptions. The user sees “Could not read saved
chats on this device.” independently of host connection styling and repair actions.
No save, deletion, retry loop or network request follows a local read failure.

## Testing strategy

- Store/injected tests prove ordered host isolation, equal ids, admission after received data, missing/empty/errors, repeated identities and teardown.
- Deferred successes and failures after received lists and host/global clears cannot install rows or errors; navigation state is untouched.
- Exercise the real writer alongside restoration to prove no storage mutation is scheduled.
- Static `HostRow` tests prove failure copy is distinct from failed-connection styling and repair controls.
- Extend the recording Playwright spec to browse after normal quit/relaunch with unavailable hosts, and restore a rejected host beside a usable host. Reuse offline mutation and recovery coverage for existing action gates.
- Run touched unit tests, build and the focused recording spec. Capture synthetic integrated sidebar evidence for visual comparison.

## Open questions

None.

## Documentation handoff

Pending for the documentation stage: update `docs/knowledge/features/chat-history.md`
to describe saved-list restoration, stale-read admission, local list-read failures
and the distinction between a saved list and current server state. Place restoration
and admission under “Received-state admission and ownership”, and failure semantics
under “Results and failure preservation”.

## Security review

**Verdict:** PASS

- Trust boundaries: main's existing `createChatHistoryHandler` validates requests and saved-host membership; `parseChatHistorySnapshot` bounds and projects stored content. The restorer verifies kind and coordinates before filing under the requested identity.
- Tokens and cryptography: no credentials, key operations or crypto changes. Existing main-process safeStorage remains fail-closed; no plaintext or renderer web storage is introduced.
- File operations: restoration only reads the existing protected collection; ids stay Map keys, never paths. No write or removal operation is exposed by the loader.
- Electron attack surface: reuse the fixed `chatHistory` bridge; no new IPC capability, window preference, navigation or remote content change. Saved text remains escaped React children.
- Network and I/O: no new transport operation; connection gates remain based on `SessionState.statuses`, never list presence.
- Errors and logs: static copy and diagnostic codes only; no host ids, list contents, raw errors or snapshot objects in diagnostics.
- Concurrency: store-owned tokens invalidate both success and failure on received data, clears and teardown; per-host cancellation cannot affect another host.
- Threat alignment: delayed/unavailable relay traffic cannot prevent local reads or manufacture a connected state. Timeline ownership (#1388) and reconnect/removal policy (#1340) remain explicitly out of scope.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-13

## Revisions

2026-09-13: No design change. The existing startup rejection assertion in
`e2e/pairing-recovery.spec.ts` now expects the saved row instead of zero rows;
the rest of its repair flow is unchanged. Its file and the stylesheet were included
in the overlap check with no conflicts. Added an injected IPC read-failure capture
to the recording spec to validate the mounted error presentation. Final scope
remains four TypeScript production files, one stylesheet, one new exported factory,
and fewer than 600 added lines including this plan and tests.
