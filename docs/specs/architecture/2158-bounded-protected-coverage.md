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
