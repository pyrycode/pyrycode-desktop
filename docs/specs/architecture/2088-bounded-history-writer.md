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

### Final bounded-coalescing candidate

Source: `52924914` (production writer and final regression fixtures).

- `writer-coalesced.log`: 26 executed/passed; `cache-coalesced.log`: 27 executed/passed, zero failed/skipped in either file. `build-coalesced.log` and the build in `replay-final.log` passed. `pre-verify-coalesced.log`: three mechanical gates passed; its typecheck/unit actions were intentionally skipped because the current build/typecheck and exact affected files ran separately with the native ABI prepared for each runtime.
- `replay-final.json` / `replay-final.log`: both original client scenarios executed/passed, zero failed/skipped/retries, zero forbidden live launches. `claude-thread` matched 45 requests/emitted 378 frames; `daemon-history-on-open` matched 32/emitted 63; both have zero remaining requests. Capture provenance: Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Original assertions, captures and strict matchers are unchanged.
- Earlier `replay.json` (1 passed/1 failed) and `replay-history-rerun.json` (1 failed) retain the coverage-deadline failure that drove bounded tail coalescing; the new candidate's complete exchanges above supersede neither those failed captures nor their recorded outcomes.
- `native-final.json` / `native-final.log`: final candidate executed/passed 1, failed/skipped/retries 0. Real `gnome_libsecret`, Electron 33.4.11 / Node 20.18.3 / ABI 130. One admission, 8333 persisted items, 271 bounded submissions; full drain 43000 ms. Keyboard commits 167/142/142 ms, bracketed by durable counts 62→124, 124→186, 186→217, all unfinished. Main 979 heartbeats / maximum gap 109 ms; renderer 2110 / 22.4 ms. Exact fresh-owner reopen passed; both app exits 0, no signals or teardown failures. The earlier packaged proof uses unchanged main/storage/protection code.

Final written scope remains below 800 lines, with no new exported type or consumer signature change. One independently useful history-persistence repair and its verification floor remain together.

### Rework — lifecycle request assertions

2026-10-19: Verifier finding 2 identified five stale flattened-write assertions in `src/renderer/src/store/daemonItemCache.test.ts`. Assert the complete ordered sequence of owner admission and item/progress requests, with exact host, conversation, epoch, version and item identities. Keep the deletion, epoch supersession, stale callback, failed unpair and post-stop assertions. No production behavior changes for this finding; the existing security review still applies.

Verifier finding 1 remains under assessment: daemon progress has no independent persistence obligation at an already covered version. A durable storage obligation must not manufacture a daemon completion certificate or discharge genuine repair/unfinished work. An internal IPC extension requires resolution of the ticket's unchanged-contract requirement before implementation.

The retained current-source diagnostic `/tmp/builder-2088-rework/partial.test.ts` exercises protected fresh-owner reopening after the second item submission fails at saved version/checkpoint 100, both with and without an incoming completion certificate. `partial-run2.log` records two executed, zero passed, two failed, zero skipped: each reopens 31 of 100 admitted items without an obligation. The earlier `partial.log` is a separate collection failure, zero executed. A synthetic repair can fence some certified saves, but a certificate-free save cannot clear that repair without granting completion authority it never received; versions below the saved checkpoint also cannot fence it through the existing monotonic fold. These are the same partial-durability invariant, not separate deliverables. Refinement must specify a durable persistence obligation independent of daemon progress and permit the necessary internal storage/IPC contract, including retry identity and abandoned-owner recovery. Keep the daemon wire contract unchanged.

Rework validation on Linux x64, after merging unchanged main `5afde437b5e9`: `/tmp/builder-2088-pre-verify-rework-final.log` passes all five gates, including all 37 lifecycle cases. `/tmp/builder-2088-five-rework.log` selects and passes exactly the five verifier names (32 unselected); `/tmp/builder-2088-lifecycle-after.log` passes all 37, zero skipped. `/tmp/builder-2088-regressions-rework.log` passes 26 writer and 27 protected-cache cases, zero failed/skipped. `/tmp/builder-2088-build-rework.log` passes typecheck and the production build. The first pre-verify attempt failed native executable provenance before running units; installing Electron normally resolved that environment failure. Finding 2 is repaired in `2f09af90`; finding 1 remains unresolved. This test-only rework does not claim new native/protection/replay execution or acceptance for the unresolved save invariant.

## Documentation handoff

- Pending documentation stage: `docs/knowledge/features/chat-history-api.md`, **Owned authoritative mutations** — document the final 32-unit capture/coalescing/submission budget, ordered progress, durable acknowledgement, explicit/event-triggered retry, ownership supersession and stop behavior after the partial-durability repair is resolved.
- Pending documentation stage: `docs/knowledge/features/chat-history-testing-native.md`, **Native runtime and packaged proof** — document `productionSecrets` removing Playwright mock-protection switches before readiness, backend assertions, counted Linux input/heartbeat/reopen evidence and the exclusions for renderer admission, import, conversion and replacement. Preserve failed captures and captured-client provenance separately.
- Pending documentation stage (refined contract): `docs/knowledge/features/chat-history-api.md`, **Owned authoritative mutations**, and `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`, **Decision**/**Consequences** — independent persistence obligation, fail-closed interrupted reads, retry/supersession rules and separation from daemon completion authority; final capture/coalescing/submission budget, ordered progress, durable acknowledgement, event/explicit retry and stop behavior.

## Revisions — independent persistence obligation (2026-10-19)

The refined ticket permits an additive internal contract. Finding 1 cannot be fixed by neutral daemon progress. Preserve the retained queue and introduce optional `change.persistence: { id, part, parts }` only for split saves. The UUID is generated once when a generator starts; part counts are computed from array lengths in constant work. Each independently parsed part still contains at most 32 counted facts/observations. Retries retain the exact request and identity.

Main stores a protected pending `{ id, next, parts }` in the existing header, plus a stable persistence owner identity. A small indexed `history_save_parts` journal retains encrypted identity/owner bindings and per-part request digests. Its records contain no item content. Journal entries survive scope deletion to reject previously accepted requests against recreated scope strings; full replacement rotates the persistence owner even at the same epoch. This avoids an ever-growing header or scanning prior receipts. Receipt retention is deliberate: removing acknowledged identities would lose stale-replay rejection. Snapshot format versions and daemon contracts remain unchanged.

Within the existing `mutateThread` transaction, main checks a known save's exact scope/owner before any reset, rejects changed replays, skipped parts, wrong totals and unrelated writes, and records each accepted part atomically with its data. Exact accepted replays return without folding progress again, including a final acknowledgement replay while a newer save is pending. Only the expected last part retires its pending marker. No completion certificate, repair or unfinished version is synthesized. Existing explicit epoch/reset supersession, replacement and deletion remain available; their internal validation may inspect a pending prefix, whereas public full/opening/newest/before reads return `unreadable` before traversal.

Lifecycle coverage added in the existing protected-cache/main suites: checkpoint 100 with incoming version 100/50, each with/without certificate; all four read operations fail closed after second-part failure, exact retry and fresh reopen; lost prefix/final acknowledgements; duplicate old endings during a new save; wrong continuation/changed part; reset/epoch/replacement/deletion/host removal and reused scope strings; abandoned stopped writer. Existing 37 ownership assertions, including the five repaired in `2f09af90`, remain intact. The native 8333-item probe, packaged protection check and guarded thread/history captured scenarios rerun on Linux.

Sizing: one observable repair with its regression/native verification floor, approximately 1100 total written lines including retained work and plan revisions; this is the ticket's explicit verification-floor exception. Three production files, no new exported types, no required consumer updates, four acceptance behaviours, fewer than ten protocol reject classes. An unused obligation contract cannot ship independently. Overlap: #2079 only appends a separate protected-cache test and consumes none of this design.

Documentation pending: `docs/knowledge/features/chat-history-api.md`, **Owned authoritative mutations**, and `docs/knowledge/decisions/0014-authenticated-owned-thread-mutations.md`, **Decision**/**Consequences** — independent persistence obligation, interrupted fail-closed reads, exact retry and supersession, retained acknowledgement identity, separation from daemon completion; final capture/coalescing/submission budget, ordered progress, explicit/event retry and stop behavior. The existing native documentation handoff remains pending.

## Security review — revised internal contract

**Verdict:** PASS

- Trust boundaries/Electron: `parseChatHistoryRequest` admits only exact bounded UUID/sequence fields and at most 32 facts when persistence is present. Main independently validates them. The identity confers no epoch/reset/daemon completion authority. No new channel or process privilege.
- Tokens/cryptography: UUIDs use WebCrypto randomness; they are local correlation identities, not credentials. Journal and pending headers use the existing OS-protected encryption and exact owner/scope bindings, with no new cryptographic primitive, key or nonce.
- Storage: only main's existing userData database gains an indexed encrypted receipt journal. No daemon paths or plaintext item content. Receipt, data and pending changes share the existing yielding atomic transaction. Corruption and unavailable protection fail closed.
- Network/I/O: no relay, frame, handshake, URL, credential or socket changes. Existing transport security remains in main.
- Errors/logging: existing static `write-failed`/`unreadable` classifications; no item text, identities, encryption bytes or request digests are logged.
- Concurrency: journal owner binding precedes supersession; pending sequence rejects gaps, changed replay and unrelated saves. Exact old acknowledgements cannot clear a newer marker. Existing writer generations and stop fences remain; no retry timer is introduced.
- Threat model: a hostile daemon still passes retained item validation; a compromised renderer can request only existing authorized operations and cannot create daemon completion authority with a persistence identity. Relay confidentiality and disk credential protection remain existing Noise/safeStorage boundaries.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19

## Revisions — schema admission (2026-10-19)

The receipt journal is a versioned database schema-8 addition, admitted by `historyDatabase.open` and created atomically by the first split mutation. This adds one production file read/touched (`src/main/historyDatabase.ts` → `open`); snapshot format version 1 stays unchanged. Older executables reject schema 8 instead of silently ignoring pending persistence state. Opening conversion of a different retained scope preserves schema 8; `protects ordered save parts and exact acknowledgements independently of daemon fences` covers this alongside host isolation and duplicate acknowledgements.

The persistence budget is checked from raw array lengths before item/progress decoding at shared/main admission. The admission regression uses getter-counted oversized input to prove rejection visits no item payload. Ordinary requests without persistence retain their existing limits.

Additional lifecycle/identity verification:

| Transition | Exact regression |
| --- | --- |
| Interrupted covered save and matching retry | `covered checkpoint save stays unreadable until exact retry: version=%s certificate=%s` |
| Accepted prefix/final acknowledgement replay | `lost %s acknowledgement retries without resurrecting obligations`; `protects ordered save parts and exact acknowledgements independently of daemon fences` |
| Transaction turn fails before durable acknowledgement | `rolls back a failed data part and its obligation atomically before exact fresh-owner retry` |
| Reset/epoch/replacement/deletion/unpair and reused coordinates | `retires an abandoned save on %s and rejects stale parts after scope reuse` |
| Stop after repeated failure | `stop leaves repeatedly failed admitted work protected without spinning or manufacturing completion` |

## Validation evidence — independent obligation repair

Linux x64, production/test source `bc7c8add` (repair `b58552ca`, preceding plan/security review `d3237f5a`), after final merge of main `5afde437b5e9`. No #2079 renderer admission changes were consumed. Final documentation-only commit does not change these sources.

- `/tmp/builder-2088-obligation-units-final.log`: five affected files, 230 executed/passed, zero failed/skipped (56 shared admission, 77 indexed storage, 34 protected cache, 26 writer, 37 lifecycle). After the final early admission guard, `/tmp/builder-2088-obligation-admission-final.log` reruns/passes all 82 admission/writer cases. `/tmp/builder-2088-obligation-atomic.log` executes/passes the added transactional rollback/fresh-owner retry case (77 other indexed cases unselected). Thus every changed assertion ran, with 231 distinct affected cases passing across these runs. The covered-checkpoint matrix includes versions 100 and 50, each with/without completion, all four read paths and exact final reopen. Five original lifecycle repairs remain green.
- `/tmp/builder-2088-obligation-preverify-final.log`: all five checks pass, including current security label/review, final main ancestry, typecheck and the exact 26-case writer gate. `/tmp/builder-2088-obligation-build-guard.log` and the build in `/tmp/builder-2088-obligation-replay.log` pass on final source. Earlier overlapping local SQLite rebuild attempts and their failed storage/pre-verify runs remain under the same scratch prefix; the final preparation was sequential. Those failures are not successful test evidence.
- `/tmp/builder-2088-obligation-native.json` and `.log`: 1 executed/passed, zero failed/skipped/retries. Electron 33.4.11 / Node 20.18.3 / ABI 130, Linux x64, real `gnome_libsecret`, both mock-protection switches absent. Exactly one admission of 8333 items, producer stopped; 8333 durably persisted through 271 bounded submissions in 40131 ms. Keyboard commits 148/125/123 ms, bracketed by advancing durable counts 62→124, 124→186, 186→217 while unfinished. Main heartbeat 936 samples / maximum gap 95 ms; renderer 1992 / 22.7 ms throughout the drain. Exact flush and fresh protected-owner reopen pass. Both launches exit 0, no signals or teardown failures.
- `/tmp/builder-2088-obligation-packaged-final.log`, `/tmp/builder-2088-obligation-packaged-final/runtime.stdout` and `runtime.stderr`: `check:history-native`, 1 executed/passed, zero failed/skipped, stage complete. Same runtime/backend; adapter 12.4.1, packaged/ASAR/native-unpacked true. Retained replacement, owned mutation, plaintext exclusion and exact protected reopen assertions pass. The earlier `obligation-packaged` success is retained separately.
- `/tmp/builder-2088-obligation-replay.json` and `.log`: original `claude-thread` and `daemon-history-on-open` scenarios, 2 executed/passed, zero failed/skipped/retries; offline guard reports zero forbidden launches. Exact exchanges match 45/32 requests and emit 378/63 frames, zero requests remaining. Unchanged capture provenance: Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, binary SHA256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. Original assertions, fixtures and strict matchers remain unchanged; this is captured-client evidence, not a fresh provider run.
- Supplementary `typecheck:client-tests` remains red with six identical pre-existing TS2339 diagnostics on candidate and unchanged main. Exact comparison logs: `/tmp/builder-2088-obligation-client-typecheck.log`, `/tmp/builder-2088-client-baseline.log`. Separate follow-up #2119 is in Backlog with `priority:low`; no related code/assertions were changed or skipped here. Production build/typecheck, pre-verify and both affected runtime scenarios pass.

Verifier finding 1 is fixed in `b58552ca`; finding 2 remains fixed in retained `2f09af90`. Required numbered answers are recorded in the publishing handoff. Documentation requirements above remain pending for the documentation stage. Complete configured unit/application acceptance remains dispatcher-owned. macOS is outside this Linux ticket's verification scope; no provider credentials or live daemon check was required.

## Revisions — paused-clock shutdown (2026-10-19)

Verifier finding 1 on `fbc2aaa4` identifies shutdown suspended on `drain`'s renderer timer when application tests pause the clock. Replace only the between-submission wait with a one-shot `MessageChannel` task. Close both ports on delivery before resuming the drain. This preserves a real event-loop boundary without depending on elapsed renderer time; the ordinary 200 ms capture debounce remains clock-controlled. No ownership, persistence-obligation, acknowledgement, retry or teardown ordering changes.

Files read: `src/renderer/src/store/chatHistoryWriter.ts` → `drain`, `flush`, `stop`; `src/renderer/src/store/chatHistoryWriter.test.ts` → `harness` and bounded-work heartbeat assertion; `e2e/indexed-history-lifecycle.spec.ts` → both buffered-close/exact-offline-reopen cases; `e2e/permission-resolution-notices.spec.ts` → `freezeTime` and paused-clock teardown; the history API/native testing and development-verification overviews → runtime preparation and proof boundaries. No in-flight feature branch overlaps the two writer files.

Test first: a bounded backlog must explicitly flush, then admit more work and stop, while timers stay frozen. Assert complete ordered requests, bounded sizes and final admitted items. Observe independent posted tasks between writes so replacing the yield with a microtask would fail. Rerun the existing four named application regressions without relaxing buffered-close/reopen or notice assertions, followed by the native 8333-item probe, packaged protection proof and both guarded thread/history replays on Linux. Full configured acceptance remains dispatcher-owned.

Sizing: the same correctness repair and its regression proof; approximately 90 additional written lines, no new exported types, state, failure branches or consumer updates. The ticket's documented verification-floor exception remains applicable.

## Security review — paused-clock shutdown

**Verdict:** PASS

- Trust boundaries: the channel carries only a local wake-up constant inside `drain`; it receives no daemon data and crosses no IPC authority boundary. Main admission remains independent.
- Tokens/secrets, storage and cryptography: no credential, protected record, path, schema, algorithm or persistence identity changes.
- Electron: built-in renderer message ports need no Node integration or bridge extension; sandbox, context isolation and navigation settings stay intact.
- Network/I/O: no socket, relay, frame or timeout changes; the existing production IPC/protected-storage path is reused.
- Errors/logs: no new failure classification or logged data; existing static writer diagnostics remain.
- Concurrency: one awaited task per bounded submission; both ports close before resolution. The existing drain promise owns it through flush/stop, and generation/queue fences still run around each write. No retry loop or abandoned recurring task is added.
- Threat model: hostile daemon and compromised-renderer admission remain bounded and independently parsed; relay confidentiality and disk protection continue through Noise/safeStorage. Local task scheduling grants no daemon-completion or owner authority.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19
