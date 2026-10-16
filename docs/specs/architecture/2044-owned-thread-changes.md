# Owned authoritative thread persistence

## Files read

- `src/renderer/src/store/threadItemStore.ts` → `publish`, `success`, `acceptEpoch`, `beginBatch`: received admission, local restoration and batch certification.
- `src/renderer/src/store/chatHistoryWriter.ts` → `capture`, `drain`, subscriptions: scheduling, receipts, cleanup and shutdown.
- `src/shared/chatHistory.ts` → `parseChatHistoryRequest`, `threadHistoryCodec`: detached bounded IPC and disk admission.
- `src/main/indexedThreadHistory.ts` → `save`, `decode`, `item`, `readPage`, `executeSync`: current full replacements and generation-bound associations.
- `src/main/historyDatabase.ts` → `createHistoryDatabase`: synchronous transactional schema admission.
- `src/main/chatHistoryStore.ts` → `run`, `importSource`, `retireSource`: application ownership and durable import retirement.
- `src/main/chatHistoryHandler.ts` → `handle`, `clearServer`: membership and admitted host/conversation generation fences.
- `src/main/historyNativeSmoke.ts` → packaged protected-storage smoke: production protection and fresh reopen.
- `docs/knowledge/features/chat-history-api.md`, `chat-history-testing.md`, `development-verification.md` and decision `0013-stable-protected-thread-bindings.md`: full/page compatibility, protected replay and counted verification requirements.
- Root `CLAUDE.md` and knowledge `INDEX.md`: process boundaries and test conventions.

## Context

Complete held snapshots cannot express ownership of an unloaded subset. Schema 6 retains payload ciphertext but still rewrites every generation-bound placement and range. This change activates one owned mutation path through the existing writer, bridge, handler and database owner. A follow-up ADR is appropriate for authenticated mutable record bindings; the documentation stage owns it.

Remote branch audit found #2026 overlapping shared admission, application storage, database, smoke and writer files. Its legacy removal is coordination only; keep edits local and preserve all-retained-format cleanup. No design capability depends on that branch.

Sizing exception: approximately 1,200–1,500 total written lines, including authenticated storage, tests and this plan; at most five new exported abstractions, ten simultaneous consumers, five observable criteria and ten rejection classifications. The authenticated mutation index is additional work beyond the refiner's 1,050-line estimate. The existing `needs-human:sizing` and grandparent #1931 prohibit another split. Without that cap, authenticated mutable layout/full-page compatibility and owned writer activation would be independently checkable slices.

## Design

Add `mutateThread` to the existing shared request union. Its detached change carries exact coordinates/epoch, admitted epoch intent, changed items, explicit removals, owned metadata and newly certified ranges. Shared admission validates changed JSON only; no shortened snapshot passes as a complete snapshot. Full replacement/import remain supported.

The item store publishes an owned change alongside each received transition. Restoration publishes no change. Changes name only revised/new facts and certified evidence; repair/progress can be metadata-only. Epoch acceptance is explicit, and an acceptance of an already saved epoch preserves its contents. Missing holders and recreated holders never imply reset or removal. The writer coalesces by exact scope and epoch, retaining the highest item revisions and pending ownership until acknowledgement. An explicit epoch transition supersedes earlier pending epoch work.

Separate continuation generation from protected mutable record identity. Add an authenticated index inside `indexedThreadHistory`, using standard SHA-256 child/record digests and a root protected in the header. Changed paths and the header update atomically with changed payloads/placements/evidence. An old placement, range or index path cannot authenticate against the current root. Untouched payload and placement bytes remain unchanged. This is an authenticated index, not new encryption; OS `SecretEncryption` remains the confidentiality boundary.

Use stable item lookup and first-arrival identity independently of mutable held placement. Index ordering must support bounded insertion/movement without dense ordinal rewrites. The same authenticated ordering index supplies full reads and bounded rank/page traversal; range lookup verifies relevant evidence and its associations. A mutation rotates the compact continuation generation, invalidating older tokens without rewriting untouched records.

Convert existing schema-6 scopes transactionally after their existing full protected decoder validates them. Retain exact payload ciphertext and supplied held/arrival order. Schema admission, conversion and the requested operation roll back together. Existing older-schema migration chains remain supported.

## State + concurrency model

The existing per-application history queue owns writes; SQLite transactions remain synchronous and contain no secure-store awaits. Renderer pending work is detached before scheduling. A held write takes one owned batch; later work accumulates separately and survives completion/failure. Failed work rejoins pending work, but is retried only on a later explicit flush/new event, avoiding an immediate retry loop. Shutdown unsubscribes, cancels scheduling, waits for unpair settlement and drains admitted work.

Host/conversation admission generations remain independent of epoch strings. Confirmed deletion suppresses pending saves; successful unpair clears that host's pending state and holders. Main handler fences reject already admitted stale requests after removal, including identical owner/epoch reuse. Durable import completion prevents retained-source replay across reopen.

## State transitions and identity reuse

| Event | Required regression in existing fixture |
| --- | --- |
| Local hydration, then live update | `daemon-item-cache.test.ts`: hydration writes nothing; received subset preserves unloaded items. |
| Holder loss and same-epoch recreation | `chatHistoryWriter.test.ts`: no inferred removal/reset; pending ownership survives. |
| Explicit epoch transition/removal | `indexedThreadHistory.test.ts`: intentional reset/removal stays distinct from omitted items. |
| Live/page revision overlap and coalescing | `daemon-item-cache.test.ts`: higher revision and first-arrival ties survive reopen. |
| Completed, unfinished and repaired batches | `daemon-item-cache.test.ts`: metadata-only mutations preserve evidence and progress fences. |
| New work during held save, failure and retry | `chatHistoryWriter.test.ts`: retain both batches without a busy retry loop. |
| Conversion/write interruption | `indexedThreadHistory.test.ts`: prior commit and schema survive, retry succeeds. |
| Mutation followed by old continuation/record replay | `indexedThreadHistory.test.ts`: stale token and protected placement/range reject. |
| Conversation deletion/unpair with equal coordinates reused | Existing removal/cache/handler fixtures extended to owned requests; stale queued work cannot resurrect. |
| Shutdown and fresh database owner | Existing lifecycle fixtures plus owned packaged update/reopen. |

## Error handling

Malformed IPC is `invalid-request` before record access. Protected data/index mismatch is `unreadable`; mutation/commit failure is `write-failed`; existing removal and unavailable-protection classifications remain. Preserve committed storage on every failed transaction. Log only existing static operation/result classifications, never daemon content, keys, ciphertext or caught errors.

## Testing strategy

Write owned-save admission and subset/retry regressions first and observe their failure. Extend existing real temporary-disk/reversible-protection, writer and cache/removal fixtures; introduce no supporting harness. Instrument changed-item validation/serialization and SQL result/decrypt/write counts at small and large unrelated-history sizes. Preserve existing full/page, migration rollback, payload substitution, placement/range replay, unfinished progress and arrival restart tests.

After the final main merge run install, pre-verify, build, focused changed tests, the complete configured fake-transport suite (explicit ticket requirement) and admitted packaged protected-storage smoke with owned update/reopen. Record Linux revision and executed/passed/failed/skipped counts. Other operating systems are outside this ticket's verification scope. No live-Claude spec is required.

## Open Questions

- Resolve the smallest authenticated index representation against existing full/page fixtures before production changes. It must verify replay and bounded ordering/evidence selection, rather than merely retaining payload bytes.

## Security review

**Verdict:** PASS, subject to implementing the authenticated-index contract above.

- [Trust boundaries] Shared `parseChatHistoryRequest` detaches/validates owned facts at renderer IPC, handler, application store and backend admission. Disk indexes and ciphertext remain untrusted until authenticated and codec-validated. A subset is never admitted as a complete snapshot.
- [Tokens/secrets] No new credentials; existing OS `SecretEncryption` fails closed. Continuations contain protected generation/position only. Keys/ciphertext stay in main.
- [File/storage] Existing main-owned `userData` database and restrictive permissions; no caller-controlled paths. Conversion, index root and mutation commit in one transaction. Retained import retirement and all-format cleanup remain required.
- [Electron] Existing fixed bridge forwards one typed request; add no raw IPC/SQL/filesystem capability or window/navigation changes.
- [Cryptography] SHA-256 authenticates record associations through the OS-protected root; use Node crypto and random UUID generations. No custom cipher, MAC, key schedule or Noise change. MUST FIX addressed in design: stable-owner binding alone would allow old-record replay; authenticated current-root verification is required.
- [Network/I/O] No network operation or transport change. Existing received admission owns facts before persistence; malformed daemon JSON stays bounded/inert.
- [Errors/logging] Existing static classifications only; never content, credential, ciphertext, path or exception telemetry.
- [Concurrency] Single writer queue plus atomic transactions; independent host/conversation fences and retained renderer ownership prevent delayed resurrection. Failure retains pending work without automatic spinning.
- [Threat model] Malicious disk substitution/replay is rejected against the protected current root; complete rollback of every protected disk record remains outside the existing guarantee. A compromised renderer receives no secrets and can submit only validated scoped changes after saved-host authorization. Relay and Noise threats retain the existing transport protections, unchanged by this ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-16

## Revisions

2026-10-16 — Resolved the index representation question. Schema 7 adds `thread_auth` in the first owned transaction; each addressed schema-6 scope is fully validated and converted lazily in that same transaction. Other scopes retain their existing full/page representation. Four authenticated radix trees bind item lookup, lexical held positions/rank counts, numeric order plus stable arrival, and normalized range starts. The OS-protected header carries their current roots. SHA-256 covers each path and canonical child references/leaf facts; leaf digests bind exact protected placement/range bytes. No supporting module or dependency is added.

Full replacement preserves supplied held order and stable payload ciphertext through the retained path. Mutable conversion retains exact payload bytes and initializes fractional hexadecimal positions from held ordinals. Owned revisions with unchanged order retain position; additions/order changes use the authenticated numeric-order/arrival tree, including unloaded neighbors. This avoids trusting a partial holder's apparent tail. Pages traverse authenticated rank counts and predecessor range proofs; continuation generation rotates independently. Explicit removals leave stable arrival gaps. All mutable metadata and lookup remain main-only.

Owned changes contain plain changed items, explicit removal IDs, metadata, new certified ranges, epoch intent and a `certified` flag. Only successful `beginBatch.commit` sets certification; live/repair/holder-recreation metadata cannot discharge a saved repair or unfinished-progress fence. The writer validates/serializes only these changed facts, merges pending revisions/evidence and retains failed work for a later flush. Memory-only disappearance does not cancel pending ownership.

New regressions in `indexedThreadHistory.test.ts` cover fresh-owner subset preservation, metadata-only recreation/progress fences, explicit removal/reset, stale continuations, range merging with untouched placements, placement/range/branch replay, transactional rollback/retry and failed schema-6 conversion. `ordinary owned validation, serialization and protected record work stay bounded as unrelated history grows` compares 10 and 1,000 saved items. Existing cache/removal/arrival-restart proofs now execute the owned operation; the new cache case covers same-epoch recreation with unloaded neighbors. Writer tests cover held failure/newer work and memory-only loss. The packaged smoke now updates one owned item and compares exact fresh-reopen content before continuing its retained-format proof.

The final implementation is smaller than the initial conservative forecast: approximately 800 written lines including this plan and focused fixture extensions. The depth-cap sizing exception remains recorded; no new split or exported construction signature is introduced.

2026-10-16 — Full-suite verification exposed repeated shared-path writes during large batches. The original candidate failed the visible-tail focus setup in two complete runs and in isolation, while untouched main passed the isolated case. Each tree now retains pending path updates within the enclosing synchronous transaction and flushes each changed path once before its protected header commits. The isolated case then passed. `coalesces shared protected paths into one write per path in an owned batch` pins this invariant on 400 items; no test assertion or suite configuration changed.


## Manual completion: progress ownership

Replace the unbound `certified` boolean with an optional completion interval containing the exact `fromVersion` and `version` admitted by `beginBatch.commit`. The writer retains ordered metadata/completion observations when it combines same-epoch changes, including when failed work rejoins newer pending work. Item revisions and ranges still coalesce; metadata replay touches the protected header only, with work proportional to received changes rather than saved history. Main folds observations in order against the saved checkpoint, admits completion only when its interval starts at or below that checkpoint, and limits fenced checkpoint advancement to the certified version. Each observation preserves uncovered saved and pending repair/unfinished obligations. Start newly created epochs from empty progress before applying observations. Holder recreation is never evidence of completed work.

Add fresh protected-disk/reopen regressions comparing separately flushed and coalesced operations, saved and pending fences, partial completion, later live progress, repeated completion, and held failure with newer pending work. First demonstrate failures on the preserved revision. Retain the authenticated-path batching regression, run applicable units/build, complete configured fake suite and the admitted packaged protected-storage check on Linux. Keep review separate from implementation completion.

### Security review of manual completion

**Verdict:** PASS, with the identified progress-ownership defect addressed by the design above before implementation.

- [Trust boundaries] `parseChatHistoryRequest` detaches and bounds every observation and completion interval, verifies exact host/conversation/epoch, and rejects invalid intervals before disk access. Metadata is not completion evidence.
- [Tokens/secrets] No new credentials or secret representations; OS protection remains main-only and fails closed.
- [File/storage] Progress folds and authenticated records commit in the existing transaction. Failed writes retain the last commit. Existing identity-generation and import-retirement fences remain active.
- [Electron] The fixed typed IPC bridge admits only the extended owned request; no new channel, navigation, Node, SQL or filesystem access reaches the renderer.
- [Cryptography] Existing protected roots and SHA-256 record bindings remain intact; completion evidence changes no encryption or replay checks.
- [Network/I/O] No protocol, socket, relay or daemon change; received completion still comes only from the coordinator's admitted batch certificate.
- [Errors/logs] Existing static diagnostic classifications only; no new content, metadata, paths or exception logging.
- [Concurrency] Completion intervals retain chronological ownership across coalescing, same-epoch recreation and failed-write merging. Replay cannot let an earlier certificate discharge later obligations. Retry remains explicit/event-driven without spinning.
- [Threat model] Malformed renderer observations fail admission and saved progress fences constrain accepted completion. Disk substitution/replay, unavailable keychain and stale deletion/unpair admission retain existing protections. Complete protected-disk rollback remains outside the existing guarantee.

**Reviewer:** Codex (self-review using `builder/security-review.md`)
**Date:** 2026-10-16


The initial manual regressions failed on preserved `d163c99e`: partial completion with saved or pending fences and loss of later pending obligations before the first save (8 passed, 3 failed in the restart fixture). The interval/ordered-observation repair passed all 189 focused cases. Review then reproduced acknowledgement loss: the disk commit succeeded, IPC rejected, and retry revived a repair interval already behind the saved checkpoint. Main now ignores incoming repair observations whose start is below and end is at/below the saved checkpoint; a repair newly raised at the current checkpoint still persists. The regression checks both fresh-reopen equality after retry and preservation of that new equal-bound obligation. All 190 focused cases pass with this extension. No test assertion, timeout, retry, skip or browser configuration was weakened.


### Final manual validation — Linux x64

Code revision: `53f3b3f1a37291af01243a26c469a22c170a9f4e`, including main `008f468f95acc70a568b4ea41f5ade9e5cc80927`. Executed on build-hp-1 in an isolated `/tmp/manual-desktop-2044` clone on 2026-10-16; no live checkout was modified. The evidence-only follow-up commit changes this plan, not the tested source.

- `npm run rebuild:node`, then `npm test -- --reporter=json --outputFile=/tmp/manual-2044-final-units.json`: **9,087 executed/passed, 0 failed, 3 skipped**, 391 files. The three existing skips require live-relay credentials (one live-round-trip and two operator-gated Noise cases).
- `npm run build`: passed both TypeScript projects and main/preload/renderer bundling. `AGENTS_REPO_PATH=/work/Projects/pyrycode-desktop-agents npm run check:docs`: passed.
- `pre-verify-check --issue 2044 --repo pyrycode/pyrycode-desktop --base 008f468f95acc70a568b4ea41f5ade9e5cc80927 --labels security-sensitive,enhancement,priority:normal,needs-human:sizing --no-suite`: three structural/security checks passed; the two suite steps were deliberately omitted here because the complete units and build are recorded separately above.
- `npm run rebuild:electron`, then `npx playwright test --reporter=json > /tmp/manual-2044-final-playwright.json 2>/tmp/manual-2044-final-playwright.stderr`: **435 executed/passed, 0 failed, 3 skipped, 0 flaky**, four actual workers, both configured `clipboard` and `parallel` projects, zero retries, no setup/top-level errors. Start 2026-10-16 08:51:40 UTC, duration 230.199 seconds. The existing skips are the two macOS app-icon badge tests and macOS-only window-close/reopen lifecycle case.
- The packaged `history-native.spec.ts` check executed/passed once, zero failed/skipped. Runtime evidence at `/tmp/pyry-history-native-utlYt4`: Linux x64, Electron 33.4.11, Node 20.18.3, better-sqlite3 12.4.1, `packaged=true`, `asar=true`, native adapter unpacked, backend `gnome_libsecret`, stage `complete`. This includes owned update/reopen and the 100,000-membership retained-format replacement/reopen (3,877 ms).
- `read setup is reused across committed same-row deltas on short and long threads` passed unchanged. Both `read-work-30` and `read-work-400` attachments report zero additional constructors, discovery, listeners and subscriptions. The protected-path batching regression remains in the unit suite.

The initial exploratory complete browser run recorded 434 passed, one failed and three skipped: its only failure was the packaged check rejecting `basic_text`, because `podman exec` did not inherit the already-running test secret-service environment. Final validation supplied that existing admitted service's `DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/pyry-session-bus`, `XDG_RUNTIME_DIR=/tmp/pyry-secret-service/run`, `XDG_CURRENT_DESKTOP=GNOME` and `DISPLAY=:99`; Playwright retained its own per-run display. No protection gate, test, timeout, retry, skip or suite configuration was changed. The final complete run above supersedes the exploratory run. macOS and live-Claude acceptance are outside this ticket's verification scope. Independent review remains the next workflow stage.

## Revisions — verifier rework

2026-10-16 — Findings 1–4 require four corrections. Replace fractional position traversal with an authenticated AVL sequence keyed by stable placement ordinal, with subtree counts for rank/page work. Parent hints are untrusted: rank verifies the entire hinted route against the protected root before use. Rotations rewrite index nodes only. Existing scopes convert transactionally after full validation; their supplied held order and placement ciphertext remain intact. New scopes use the sequence immediately. Add successive-addition growth, ordering movement/removal and replay coverage in `indexedThreadHistory.test.ts`.

Maintain a protected aggregate JSON-node count, subtracting only removed/revised old items and adding changed items. Reject overflow transactionally so full/page admission remains coherent; cover separate flush/reopen and rollback. Existing scopes compute the count once during conversion.

Give explicit daemon reset a unique reset identity through `acceptEpoch`, shared admission and writer coalescing. A newer reset discards earlier pending facts/progress; the protected header records the last applied reset for idempotent acknowledgement retry. Memory-only holder loss still carries no reset. Cover same-epoch reset before flush and during held failure in existing cache/writer fixtures; the coordinator passes reset intent directly.

Carry certified availability as an exact oldest-boundary observation alongside ordered progress. Main compares each boundary against retained evidence: older wins, equal-boundary exhaustion wins, and newer or metadata-only observations cannot erase older exhaustion. Cover older/newer/equal boundaries, coalescing and fresh reopen.

Overlap audit: #2026 still overlaps shared admission and writer fixtures; its retained-format cleanup is independent and these edits remain local. The existing depth-cap sizing exception applies to this rework.

### Security review of verifier rework

**Verdict:** PASS, subject to the contracts above. Trust boundaries remain shared detached admission and protected main-only decoding. Bound reset IDs and numeric boundary observations before storage. Parent hints grant no authority; only a verified root-to-node route authorizes rank. SHA-256, OS protection, placement/payload associations and transactional rollback remain unchanged. Aggregate node accounting is protected and overflow rolls back all changes. Reset IDs make failed acknowledgements idempotent; host/conversation generations still fence deletion and unpair. No new credentials, paths, network operations, IPC channels, renderer capabilities or background jobs. Logs retain static classifications only. Malicious disk records fail closed; whole-database rollback remains outside the existing guarantee. Reviewer: builder, using `builder/security-review.md`, 2026-10-16.

### Rework validation — Linux x64

Tested source: `7a82a9e33e441bc77683180d53d2c7f27065c22e`, including main `008f468f95acc70a568b4ea41f5ade9e5cc80927`, on 2026-10-16. The following evidence-only commit changes this plan, not tested production or tests.

- Final normal-Node pre-verifier gate: **5/5 checks passed**. `npm test -- --reporter=json --outputFile=/tmp/builder-2044-final-node-units.json`: **9,103 executed/passed, 0 failed, 3 skipped**, 391 files. Skips are the existing live-relay round trip and two operator-gated Noise cases. Log: `/tmp/builder-2044-final-node-preverify.log`.
- `npm run build` passed after that gate; both TypeScript projects and all three bundles passed. `npm run check:docs` also passed. Build log: `/tmp/builder-2044-final-build.log`.
- Complete configured fake suite on the final source: **435 executed/passed, 0 failed, 3 skipped, 0 flaky**, four workers, both `clipboard` and `parallel` projects, zero retries/setup errors. Start: 09:34:23 UTC; duration: 294.494 seconds. Reports: `/tmp/builder-2044-shipped-playwright.json` and `.stderr`. Skips are the two macOS badge tests and macOS window-close/reopen test.
- Packaged production protection: **1 executed/passed, 0 failed/skipped**, `gnome_libsecret`, Linux x64, Electron 33.4.11 / Node 20.18.3, better-sqlite3 12.4.1, packaged/asar/native-unpacked all true, stage complete. `/tmp/pyry-history-native-zaRxU3/runtime.stdout` records the owned update/reopen and 100,000-membership retained-format proof (4,245 ms replacement).
- Final focused protected-disk/cache run: **79 passed, 0 failed/skipped**. This includes reset-ID admission at its shared length boundary, lost reset acknowledgement, older/newer/equal availability boundaries and metadata-only repair observations. The shared/header reset-ID limits now use the same constant. The coordinator reset test additionally asserts explicit reset ownership.
- The existing replacement-seeded work fixture now asserts constant validation/serialization/encryption work and a capped logarithmic sequence-index delta. The new successive-owned-addition case checks 16/128/512-item growth, bounded reads/writes and unchanged first-placement bytes. Shuffled additions, revisions moving order, internal removals, parent-hint tampering and old fractional-root conversion/rollback also pass. Protected path batching and original first-arrival/replay regressions remain active.

Historical failures remain recorded: the initial full browser run had **434 passed, 1 failed, 3 skipped**, reporting an unchanged raw teardown inspection context loss in disconnected delivery. Follow-up [#2054](https://github.com/pyrycode/pyrycode-desktop/issues/2054) is in Backlog with priority:low. Its focused rerun passed **3/3** and the unchanged complete rerun passed **435/435**, before the final-source complete pass above. No browser assertions, timeout, retry, skip or configuration changed. An auxiliary full unit invocation through Electron's bundled Node passed 9,102 and failed the existing Node BLAKE2s oracle because that runtime lacks its digest; the final standard Node gate above passed all 9,103. No crypto code or oracle assertion was changed.

The four numbered verifier answers are written to the requested verdict-handoff file and name pushed implementation commit `0ffe0b12`. macOS and live-Claude acceptance are outside this ticket's verification scope. Independent verifier review remains the next stage.
