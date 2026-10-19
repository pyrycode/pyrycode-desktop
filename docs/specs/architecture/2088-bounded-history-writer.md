# Bounded ordered history persistence

## Files read

- `src/renderer/src/store/chatHistoryWriter.ts` → `createChatHistoryWriter`: capture, retry, deletion and shutdown ownership.
- `src/renderer/src/store/chatHistoryWriter.test.ts` → `harness`: held writes and host removal regressions.
- `e2e/daemon-item-cache.test.ts` → `cache`: protected fresh-owner semantic comparisons.
- `src/shared/chatHistory.ts` → `parseChatHistoryRequest`: valid independent mutation slices.
- `src/main/indexedThreadHistory.ts` → `mutateThread`: ordered progress folding and idempotent reset identity.
- `src/main/historyDatabase.ts` → `transactionSteps`: existing 16-unit transactional yielding.
- `src/main/chatHistoryStore.ts` → `createChatHistoryStore`: serial production store and turn hook.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`: isolated launch and secret backend selection.
- `docs/knowledge/features/chat-history-api.md`: ordinary mutation generator is reused, never duplicated.
- `docs/knowledge/features/chat-history-testing-native.md`: Node/Electron ABI order and packaged production proof.
- `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`: exact progress certificates and ownership.
- `docs/knowledge/features/development-verification.md`, `docs/recorded-tests.md`, `docs/client-replay-migration.md`: counted native and guarded replay evidence.

## Context

One behaviour: finite owned history persistence yields while preserving separately saved semantics. Its native keyboard regression is the proof of this repair, not an independent deliverable. No product visuals change. Import, conversion, replacement and renderer admission remain outside scope. #2079 overlaps only by adding a separate case to `e2e/daemon-item-cache.test.ts`; its renderer changes are not consumed.

## Design

Replace flattening merge with an ordered linked queue per host/conversation. Store-owned changes are immutable detached facts, so capture links a reference in constant work rather than parsing the accumulated payload. Epoch/reset supersession drops the superseded queue in constant work. Each queue cursor retains the current request until durable acknowledgement; failures retain that cursor without reconstruction.

One submission admits at most 32 combined removals, items, ranges and progress observations. A real timer turn separates submissions even when IPC resolves immediately. Apply removals, items and ranges in their original mutation order, then its prior progress and final observation in order. Parse every bounded submission before IPC; main independently validates as before. Data-only prefixes use neutral progress (checkpoint zero, no completion, repair or unfinished claim; version retains the admitted target). Thus a new incomplete prefix has version above checkpoint, while existing saved fences remain intact. Original progress runs only after all associated facts are durable. No synthetic completion certificate clears a genuine fence.

Preserve the existing list/removal serial drain and host pause/generation fences. A cursor is advanced only if its queue remains the current owner after await. A replacement queue cannot receive a stale callback. Failure suppresses that key for this drain; later explicit flush or receipt retries it. No retry loop runs on its own.

## State + concurrency model

The writer owns one drain promise, one scheduled capture timer and linked pending queues. Each awaited bounded turn rechecks pending identity, deletion and host pause. Stop unsubscribes and cancels scheduling, waits for host-removal settlement, then drains once with the same finite failure policy. Production storage retains its own serialized transactional generator and teardown.

## State transitions and identity reuse

| Event | Coverage |
| --- | --- |
| Large single change and backlog behind held IPC | writer bounded work test and native storage/input probe |
| Failure after a prefix / explicit retry / lost acknowledgement | cache bounded equivalence and writer retry tests |
| Revisions, equal-revision text, removal, ranges and ordered progress | cache separately flushed versus queued fresh reopen |
| Same epoch reset / epoch replacement while held or after progress | cache reset cases and writer replacement cases |
| Confirmed deletion and equal conversation IDs on two hosts | writer deletion cases |
| Successful/failed unpair while held or after progress | writer host-removal cases |
| Stop/window close while draining | writer stop cases and normal native teardown |

## Error handling

Invalid bounded requests report only `invalid-snapshot`. IPC throws report `ipc-failed`; typed failures retain their static classification. Failed work remains queued without acknowledgement or manufactured completion. Existing reset, deletion and unpair may supersede it. No payload content enters logs.

## Testing strategy

Test first with counted writer requests over all four work categories and held/retry paths. Extend the protected cache fixture to compare exact reopened state after bounded application, partial failure and lost acknowledgement. Reuse existing lifecycle regressions and add held replacement checks. A child-local native Electron probe mounts an isolated text input and existing writer, sends one finite 8333-item workload through production IPC using real OS encryption, records advancing persisted counts around keyboard commits, recurring renderer/main heartbeat gaps, runtime/backend identity, drain under 60 seconds and exact fresh reopen. Run packaged `check:history-native`, targeted pre-verify, build, and applicable guarded client replay on Linux. Scratch artifacts remain under `/tmp/builder-2088/`.

Sizing: approximately 740 written lines including plan, writer, deterministic tests, launch option and native spec; no exported types, no changed consumer signatures, four acceptance behaviours, fewer than ten error branches. One independently useful repair with its verification floor.

## Open Questions

None. Queueing original observations is simpler than rebuilding a coalesced index and preserves placement/arrival semantics directly.

## Security review

**Verdict:** PASS

- Trust boundaries: bounded requests pass `parseChatHistoryRequest` before IPC and independent main admission. Store-owned references are immutable; renderer references grant no main authority.
- Tokens/secrets: no new credentials. Native fixture explicitly selects real `electronSecretEncryption`; production still fails closed when unavailable.
- File/storage: existing isolated userData and authenticated atomic transactions remain the storage boundary. No daemon-derived paths or new storage formats.
- Electron: no new IPC surface or privileges; the mounted probe is test-only and uses the existing bridge.
- Cryptography: no algorithms, keys, nonces or protected record binding change.
- Network/I/O: no socket or relay changes; the fake-daemon launch uses existing transport fixtures.
- Errors/logging: static result classifications only; fixtures contain generated non-secret text and evidence records counts/timings.
- Concurrency: current queue identity and existing host generations fence late callbacks. Durable-only cursor advancement, serial deletion and bounded explicit retry prevent resurrection and spinning.
- Threat model: hostile daemon data remains parsed in main and renderer; a compromised renderer gains no SQL, keys or filesystem access. Relay confidentiality and disk protection remain existing Noise/safeStorage responsibilities.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19

## Revisions

2026-10-19: Native execution showed that Playwright's Electron loader forces `password-store=basic` and `use-mock-keychain`, independently of the application's test-backend flag. The native-only `productionSecrets` launch option also requires a pre-readiness fixture hook removing those mock-protection switches. It preserves sandbox/process isolation settings and asserts the selected real backend at runtime. The failed ordinary launch remains retained under `/tmp/builder-2088/native-run2*`; it establishes no storage/input pass.

2026-10-19: The history replay twice exhausted its coverage deadline with a queue of one transaction per scalar receipt. Add bounded tail coalescing before a node starts: only distinct item identities and metadata, combined counted work at most 32; owner/reset barriers, removals, ranges and repeated identities stay serial. Capture performs at most 32 units, never scans the queue. Started/failed cursors remain immutable. The controlled regression first observed 60 submissions for 60 distinct queued items; it requires fewer than ten while preserving all items, ordered observations and the same 32-unit bound.

## Validation evidence

Linux x64, native scenario source committed in `57248c27f66974f038c96f5e10f8082c05f61e1b`; #2079 renderer admission changes were not consumed.

- `/tmp/builder-2088/pre-verify-final.log`: five checks passed after merging main `5afde437b5e9`, including security review, typecheck and the writer unit file. `/tmp/builder-2088/build-final.log`: production build passed.
- `/tmp/builder-2088/unit-confirmed.log`: both affected files executed/passed 50 cases, failed/skipped 0 (23 writer, 27 protected cache), including the final single-large-mutation interruption and retry-cursor assertions. Node preparation completed before these tests; Electron preparation follows them before replay.
- `/tmp/builder-2088/native-run4.json` and `native-run4.log`: native storage/input case executed/passed 1, failed/skipped 0, retries 0. Electron 33.4.11 / embedded Node 20.18.3 / ABI 130, production `gnome_libsecret`; both Playwright mock-protection switches absent.
- One admission of 8333 generated items, 8333 durably persisted through 271 submissions, producer stopped. Drain including final certification: 46894 ms. Keyboard commits: 139, 19, 137 ms. Durable counts around those inputs: 62→124, 124→186, 186→279, all unfinished. Main heartbeat: 1044 samples, maximum gap 123 ms; renderer: 2327 samples, maximum gap 28.6 ms, including the final tail. Exact items, relationships, placement/arrival and progress survived normal close and a fresh protected owner. Both processes exited 0, no signals or teardown failures.
- `/tmp/builder-2088/packaged.log`, `packaged/runtime.stdout`, `packaged/runtime.stderr`: packaged production-protection check executed/passed 1, failed/skipped 0; same Electron/Node/backend, adapter 12.4.1, packaged/ASAR/native-unpacked true, stage complete. Retained replacement, owned update and exact protected reopen checks passed.
- Failed captures remain separate: `native.log` failed collection (zero executed); `native-run2.json` failed before admission because Playwright forced mock protection; `native-run3.json` failed the initial version-zero fixture barrier before admission. The final fixture explicitly supplies and durably observes a version-one initial thread. Earlier failed unit/pre-verify logs remain in the same scratch directory; they are not counted as passes.

macOS is outside this Linux ticket's verification scope. No provider credentials or live daemon run was required.
