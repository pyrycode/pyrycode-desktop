# Bounded protected coverage observations

## Files read
- `e2e/real-daemon-history-on-open.spec.ts` → `coverage`: observes durable numeric progress alongside one request per trusted input.
- `e2e/fixtures/historyCoverage.ts` → `readHistoryCoverage`: ownership checks, pending classifications and five-second deadline from #2153.
- `e2e/fixtures/historyCoverage.test.ts` → split-save regression: real writer, handler and protected database; retain its held acknowledgements.
- `e2e/fixtures/historyQueryEvidence.ts` → `installHistoryQueryEvidence`: dispatch evidence is distinct from saved coverage.
- `src/main/indexedThreadHistory.ts` → `load`, `readPage`, `mutablePage`: full reads decrypt every retained item; newest pages authenticate the newest range and reject pending split saves.
- `src/main/chatHistoryStore.ts` → `run`, `execute`: reads and writes share one serial main-process queue.
- `src/main/chatHistoryHandler.ts` → `createChatHistoryHandler`: validates and authorizes exact requested ownership before storage.
- `src/renderer/src/store/chatHistoryWriter.ts` → `drain`: serial bounded mutation submissions, including protected split-save obligations.
- `src/renderer/src/store/threadItemStore.ts` → `beginBatch`, `beginLocalRead`: real received publication and restoration seams for regression.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/chat-history.md`, `chat-history-storage.md`, `chat-history-testing.md`, `development-verification.md`, `docs/recorded-tests.md`: protected admission, bounded page APIs, evidence and native ABI preparation.

## Context
One useful invariant: every existing trusted history-paging step observes actual durable progress within its existing bound. The observer currently requests a full transcript merely to inspect its first range. This synchronous protected read competes with receipt/persistence in main and grows with the transcript. Scratch normal-build observations rose from ~100 ms to ~650 ms per read as history grew. No production or visual behavior change or ADR is needed.

Retain the original #2155 verifier bundle `14df6631806c2588217566de95cd3eee953c694985c152a314a588117e8f300f`, retrieved at `/tmp/builder-2158/evidence-2155/`: isolated main `64e0a66876fe` and candidate `9189aa1a` fail with `no-progress`, 30 matched / 59 emitted / 2 remaining. Current clean `1c001e0e` passed one normal case and three instrumented cases; these do not reclassify the historical failures or establish their precise host scheduling conditions.

Scope admission: about 350–450 written lines including plan and controlled regression, no new exported types/components/stores, one scenario consumer, four observable acceptance criteria and no new reject state machine. Remote feature-file overlap check after fetch found none. Fix and causal regression are one slice.

## Design
Keep the single-consumer observer beside its scenario. Change its injected reader contract to accept a `ChatHistoryRequest`; construct `newestThreadPage` with limit 1 and exact host/chat inside `readHistoryCoverage`. The scenario forwards that request through the existing preload API. This prevents accidentally reintroducing the growing full read at its only consumer.

For a protected page, validate metadata host/chat and retain the numeric start of the newest authenticated range. A disconnected older range cannot establish progress of the newest window. Keep full stored-result ownership validation for the existing regression fixtures, and preserve all error classifications and the five-second deadline. Missing, empty, unreadable and unchanged coverage remain pending observations only. No dispatch, rendered content, continuation token or checkpoint substitutes for the returned protected range.

`readPage` already checks protected ownership/header bindings and rejects `h.persistence`; do not add an IPC operation or change production persistence. Keep recording bytes, full envelope matching, causal barriers, connection ownership, retirement and final completion untouched. Preserve every original scenario assertion.

## State + concurrency model
No new application state or asynchronous job. The observer keeps one local numeric result and one existing poll deadline. Bounded read-only requests use the existing serial authorized handler/store. The controlled regression uses real stores/writer/SQLite and a controlled per-decrypt cost during observation to expose how a full read can consume the deadline before a scheduled received page can persist. Cleanup releases/awaits the writer and closes the database.

## State transitions and identity reuse
| Event | Test |
| --- | --- |
| Growing saved transcript; page delivery scheduled after the initial read | `bounded protected reads leave time for received paging progress`: original full read fails with no-progress, bounded read permits publication and actual durable older coverage. |
| Split-save prefix, final submission and durable acknowledgement | Existing `waits across split saves at baseline and after dispatch`, extended to observe the real bounded page path too. |
| Repeated unchanged reads / persistent pending state | Existing `bounds persistent %s`; retain five-second failure. |
| Equal identifiers under the wrong owner | Existing ownership tests plus wrong page metadata tests. |
| Independent fresh profile after saved-profile retirement | Unchanged named guarded recorded history scenario. |

## Error handling
Retain #2153's static codes and immediate terminal errors. Only pending observations repeat. Page metadata is checked against requested coordinates; malformed result kinds remain unexpected-result. No error payload or transcript is logged. Existing handler authorization and pending-save failure remain authoritative.

## Testing strategy
- Write the causal controlled regression first and retain its failing-before log, then run the repaired regression and existing ownership/error/split-save tests. Count protected decrypts separately from publication and durable ranges.
- Verify one-item observation work stays bounded with a large saved transcript; test that a disjoint older range cannot fake newest-window progress.
- Run Node checks before Electron preparation. After final main merge, run pre-verify with the affected test and normal build, then prepare Electron SQLite.
- Run the exact named case on the clean repaired normal build with retries zero, then the complete guarded recorded suite. Record build/input identities, counts, exchanges and artifact paths. Dispatcher owns the subsequent configured application gate. Linux only; no fresh provider/daemon acceptance.

## Open Questions
- Controlled latency must reproduce no-progress before correction; if evidence contradicts full-read contention, revise the design before implementing a different boundary.

## Revisions
2026-10-20: Resolved the open question with the real protected-store/writer regression. The original observer performs 603 synchronous decrypts and fails with `no-progress` before the queued page publication. The selected reader performs nine decrypts across initial, pending and successful observations; publication precedes the range write and only the subsequent protected start 63 satisfies progress. The regression advances only Vitest's fake monotonic clock by 10 ms per synchronous decrypt, leaving task delivery real; it has no wall-clock sleep. An earlier wall-clock-cost version also failed with no-progress. This proves the observer contention mechanism without attributing unrecorded keychain timings to the historical failure. No production storage correction is needed.

## Security review
**Verdict:** PASS
- Trust boundaries: `createChatHistoryHandler` continues to parse and authorize exact host/chat requests. `readHistoryCoverage` validates page metadata; existing stored fixtures retain both outer and inner ownership checks.
- Tokens/secrets: no new token or credential access. Page continuation/recovery values are ignored and never logged; production protection remains Electron safeStorage.
- File/storage operations: use the existing trusted userData SQLite owner and protected transaction/page validation. No new path or disk format. Pending split-save headers still reject reads.
- Electron attack surface: use the existing limited preload API; no new channel, exposed primitive, navigation or window preference.
- Cryptography: no primitive, Noise state, key/nonce handling or secret comparison changes. The regression's reversible fake protection is test-only.
- Network/I/O: unchanged bounded transport; the observer issues only local read-only history requests and never supplies network completion.
- Errors/logs: only static classifications, counts, ranges and timings in controlled evidence; no content, keys, pairing payloads or caught errors.
- Concurrency: existing single deadline and serial authorization/storage; no new listener or long-lived job. Tests await writer shutdown before database cleanup.
- Threat model: malicious relay/daemon parsing and compromised-renderer limits remain production-owned and unchanged. Bounded local reads reduce observer contention without granting progress or authority; disk token theft protections remain safeStorage-owned.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-20

## Validation evidence
Linux x64, 2026-10-20. Tested implementation `a17ce88308917e07480fbe99c01ff61c25dc5aee`, containing final merged main `1c001e0efff30ddb4260152cdbbaf28629332524`. The evidence-only commit after this run changes this plan. No production code, recording or assertion was changed after validation.

| Check | Executed / passed / failed / skipped | Artifacts |
| --- | --- | --- |
| Original full-read causal regression, fake monotonic decrypt cost | 1 / 0 / 1 / 27 unselected | `/tmp/builder-2158/causal-before-clock.log`, SHA-256 `7d25e61ffbeb0062f7bb21baf8ea6b53fb02935517672d50ebd93c18d175ff0b` |
| Final affected regression file through pre-verify | 28 / 28 / 0 / 0 | `/tmp/builder-2158/units-final/unit-o3ppu_e3/0.json`, SHA-256 `1dbeb9e373673d3a7a9b181c68acc60ec39616b052798ac65a7e5ec487e7f0fb` |
| Exact named guarded history case, normal build | 1 / 1 / 0 / 0 | `/tmp/builder-2158/named-final.json`, SHA-256 `72d1df287dddbba869a29250e82fb6148fcd21d9ce76aefdd06da050d9e080dd` |
| Subsequent complete guarded recorded suite, normal build | 29 / 29 / 0 / 1 | `/tmp/builder-2158/recorded-full-final.json`, SHA-256 `97c6c6c7253f3511b54d7dce6031f0a89a45cf4311aa36241e35006dd094fa97` |

Pre-verify passed all five checks (`pre-verify-serial.log`); client-test typecheck (`client-typecheck-final.log`) and `npm run build` (`final-build.log`) passed. All Node checks completed before final `npm run rebuild:electron` (`final-electron-prep.log`). Earlier preparation failures are retained: an ABI-mismatched early test executed no valid causal proof, and overlapping pre-verify native rebuilds collided. Confirmed all earlier processes exited before the successful serial preparation/check; neither failed attempt counts as acceptance.

The failing-before regression performed 603 protected decrypts and retained start 113 without reaching page publication. The repaired regression performed nine decrypts and traced `query-dispatched → protected-read:113 → page-published → protected-read:error → range-durable → protected-read:63`. Its error observation is the real pending split save. The existing held-prefix/final-acknowledgement regression also passed through the bounded reader, retaining starts 100 then 50. Existing terminal-error and full stored-result ownership controls remain intact, with added page ownership and disconnected-range controls.

Commands, in order after the final normal build and Electron preparation:
1. `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2158/named-final.json node scripts/run-offline-replay.mjs --grep 'a real daemon lazily fills a served gap after more than 200 entries written while Electron is closed' --retries=0 --reporter=list,json`
2. `PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2158/recorded-full-final.json node scripts/run-offline-replay.mjs --retries=0 --reporter=list,json`

Both use one configured worker, retries zero, no flaky result, and `forbiddenLaunchAttempts: 0`. The exact history case is present/passed at retry 0 in both reports, each with 32 matched requests / 63 emitted frames / zero remaining requests. All 29 full-suite exchanges completed with zero remaining requests. The sole skipped case is the pre-existing `real claude picks up a saved channel system prompt at Reset session`; no new skip or retry was added.

Both logs retain the complete executed-bundle SHA-256 map. Executed build provenance is `profile: normal`, `desktopRevision: a17ce88308917e07480fbe99c01ff61c25dc5aee`, `sourceDirty: false`; `out/main/build-provenance.json` SHA-256 is `e3c9d202b0e77680bf1e3a97cde7c2c48d6eff57565b88b21d963e2699ff666e`.

The unchanged history input SHA-256 is `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`. Both `replay-input` attachments retain capture Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256 `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`, capture time `2026-10-16T12:30:09.805Z`, Claude `not-spawned`.

Dispatcher owns the subsequent complete configured application gate (`npx playwright test --reporter=json`); verifier checks the named retry-zero result. This is captured-client proof, with no fresh provider/daemon or physical-effect claim. macOS is outside this ticket's scope.
