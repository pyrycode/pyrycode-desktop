# Saved-list title observation

## Files read
- `e2e/real-claude-thread.spec.ts` → `savedThread`, saved-title read: saved replies precede a single collapsed list observation.
- `e2e/fixtures/threadReplyEvidence.ts` and its tests → `savedRepliesMatch`: thread content proof, independent of list persistence.
- `e2e/fixtures/certifiedCheckpoint.ts` and its tests → `readCertifiedCheckpoint`: bounded read-only observation precedent.
- `src/renderer/src/store/chatHistoryWriter.ts` and its tests → `capture`, `captureChange`, `drain`: lists and owned mutations have separate buffered work.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: serializes submitted IPC, not future renderer submissions.
- `src/main/chatHistoryStore.ts` and its tests → `createChatHistoryStore`: protected list/thread read and storage setup.
- `src/shared/chatHistory.ts` → `ChatHistoryResult`: distinguish missing, storage errors and unexpected kinds.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and test-first practice.
- `docs/knowledge/features/chat-history-storage.md` → Buffered replacements: natural receipt and serial drain; thread durability is insufficient for list durability.
- `docs/knowledge/features/development-verification.md`: Node checks finish before Electron SQLite preparation; retain counted offline evidence.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`: strict replay contract, retirement settlement and existing reset fixme.

## Context
One useful behavior: observe the exact host/chat's durable string title before
retiring its protected profile, with the causal regression kept alongside it.
The historical collapsed null does not identify a production cause. A controlled
delayed list demonstrates the observation gap without claiming that it triggered
the historical failure. No production or UI changes and no ADR are needed.
No in-flight remote feature branch overlaps the planned files (checked after fetch).

## Design
Add `readSavedListTitle(read, host, conversation): Promise<string>` under
`e2e/fixtures/`. Its read callback returns the actual `ChatHistoryResult` for the
host. Classify results as missing list, absent row, unnamed row, named row,
storage error or unexpected result kind/host. Poll only the first three, using
Playwright's existing default five-second assertion bound. Return the actual
stored string, including an empty string; never derive it from another row,
thread contents or UI. Stop repeating reads on classified errors/unexpected
results or a rejected read, and report static categories/codes without payloads.
The scenario replaces only its one-shot title read; it retains the explicit
`expect(typeof title).toBe('string')` and every surrounding assertion.

Before committing to this contract, considered waiting for a renderer writer
acknowledgement: the protected list result is the smaller and stronger observation
because it directly establishes the required data without new instrumentation.

## State + concurrency model
No application state or background jobs change. A local observation retains the
last classified result and repeats read-only IPC until ready or bounded failure.
The controlled regression uses real writer, list/thread stores, history handler
and protected SQLite storage, with an injected scheduler and held list write to
control receipt/submission/acknowledgement ordering. It never flushes to make the
observation succeed; the test drives the writer's scheduled work independently.

## State transitions and identity reuse
| Event | Regression |
| --- | --- |
| Saved replies precede named-list receipt and persistence | `waits for the exact named list after replies are already saved`: original read yields stored null; repaired read waits through receipt and held write, then returns actual protected title before retirement. |
| Same chat ID on another host / another chat on same host | The controlled regression and `does not accept a different host`: unrelated names cannot satisfy observation. |
| Persistent missing list, absent row or null name | `bounds persistent ...`: fake timers exhaust the unchanged five-second bound. |
| Repeated storage error / unexpected result / rejected IPC | `does not repeat ...`: fail after one observation. |
| Relaunch | Original shared thread scenario: saved replies before and immediately after relaunch, before opening any chat, then saved-row reopen and rendered replies. |

## Error handling
Storage error codes remain failures, with no repeated mutation or error masking.
Unexpected result kinds/host fail explicitly. Pending categories appear in bounded
assertion failures. The regression records ordered static category/event labels
for list receipt, write acknowledgement, protected read and retirement, without
title, reply, host or chat payloads.

## Testing strategy
- Write the controlled regression first and observe failure with the original one-shot observation.
- Focused Vitest tests prove causal ordering, exact coordinates, result categories, bounded missing/unnamed failure and no retry of errors.
- After final main merge: install, pre-verify with the affected unit file, client-test typecheck and build; finish Node checks before rebuilding Electron SQLite.
- Run five consecutive guarded paired batches using the ticket's exact command: both named cases twice, fully parallel, three actual workers, retries zero (20 executed/passed required).
- Run complete guarded `npm run e2e:recorded`; inspect counted reports, zero remaining requests per exchange and zero forbidden launches. Preserve capture hashes/provenance, boundaries, inspector repair and retirement settlement.
- Dispatcher owns the subsequent application gate; verifier reviews both named cases without retry and separates unrelated failures. Existing system-prompt-reset fixme stays explicit. Linux only; offline checks add no provider/live claim.

## Open Questions
None. If the exact list never becomes durable, reassess scope before changing production persistence.

## Scope measurement
One behavior with regression, four observable criteria; estimated 350–450 written
lines, zero production files, one exported helper, one consumer and fewer than
ten result branches. Within all numeric ceilings; no independent split seam.

## Revisions
2026-10-19: Test naming only: the host-rejection case is named
`does not repeat wrong-host` in the parameterized regression. No contract change.

## Validation evidence
Linux x64, implementation revision `aa4938b653cf0b2f9b6f98b238699c2287a17191`,
containing main `0848c1fbe194420212229d4bd2fabbf7f3af0296`. Node 25.8.0,
Electron 33.4.11. This final evidence addition changes documentation only.

The controlled original one-shot observation failed as intended: one selected
test executed/failed, with the other ten cases not selected
(`/tmp/builder-2129/original-observation.log`). Real protected thread content
already satisfied `savedRepliesMatch`; the actual list was `stored/list`, exact
row present, name null. The original `typeof title` assertion rejects that result.
The repaired test remains pending both before named-list receipt and while its
scheduled write is held, then returns the actual protected name. Its payload-free
trace records unnamed-list receipt, protected unnamed reads, named-list receipt,
write submission, another protected unnamed read, successful write acknowledgement,
protected named read, then the retirement sentinel. Actual profile retirement and
relaunch remain covered by the unchanged application scenario assertions.
This demonstrates an observation mechanism, not the unobserved historical trigger.

Final focused regression: **11 executed, 11 passed, 0 failed/skipped**.
`pre-verify-check` passed all five checks after the final main merge; build and
client-test typecheck passed. Node-native preparation finished before Electron
preparation; no native rebuild ran during replay. Commands:

```sh
npm install --no-audit --no-fund
python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file e2e/fixtures/savedListTitle.test.ts
npm run build
npm run typecheck:client-tests
npm run rebuild:electron
node scripts/run-offline-replay.mjs --grep "a real daemon lazily fills a served gap|daemon-built thread streams" --fully-parallel --workers=3 --repeat-each=2 --retries=0 --reporter=list,json
npm run e2e:recorded -- --reporter=list,json --output=/tmp/builder-2129/recorded-full-results
```

Each paired invocation additionally uses `--output=/tmp/builder-2129/paired-N-results`
and `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2129/paired-N.json`; stdout/stderr is
retained in `paired-N.log`. Five consecutive batches, both named cases twice:

| Batch | Configured workers | Actual slots / peak concurrent tests | Worker process IDs | Executed/passed/failed/skipped |
| --- | --- | --- | --- | --- |
| 1 | 3 | 0,1,2 / 3 | 0,1,2 | 4/4/0/0 |
| 2 | 3 | 0,1,2 / 3 | 0,1,2 | 4/4/0/0 |
| 3 | 3 | 0,1,2 / 3 | 0,1,2,3 | 4/4/0/0 |
| 4 | 3 | 0,1,2 / 3 | 0,1,2 | 4/4/0/0 |
| 5 | 3 | 0,1,2 / 3 | 0,1,2 | 4/4/0/0 |

Total **20 executed/passed, 0 failed/skipped**, every result retry zero. Batch 3
recycled slot 0 after its earlier case completed; three slots actually executed
concurrently, measured from result start times/durations. This was not a retry.
Every thread exchange matched **45 requests / 378 emitted frames / 0 remaining**;
every history exchange **32 / 63 / 0**. Each guard reported zero forbidden launches.

The subsequent complete guarded recorded suite used its unchanged configured and
actual one-worker execution: **29 executed/passed, 0 failed, 1 existing skipped
system-prompt-reset fixme**, retries zero. All **29 exchanges** had zero remaining
requests; forbidden launches zero. Reports: `/tmp/builder-2129/recorded-full.json`
and `.log`, with artifacts in `recorded-full-results/`. Preparation/check logs are
`pre-verify.log`, `build.log`, `client-typecheck.log`, `electron-preparation.log`
and `regression.log` under the same scratch root. Structured unit evidence is in
`build/dispatcher-tests/unit-k80cx7ph` in this worktree.

Unchanged capture SHA-256 values: thread
`53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`, history
`de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`.
Both retain source Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5` and daemon
`58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf` provenance. No capture bytes, request
contracts, frame ordering, connection boundaries or completion checks changed.

Pending later-stage work: dispatcher-owned application gate must run both named
cases without retry; verifier reviews its counted evidence and reports unrelated
failures separately. These are offline Linux results, with no new live-provider
or physical-effect claim. macOS is outside this ticket's verification scope.
