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
