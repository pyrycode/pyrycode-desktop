# Certified checkpoint after overlapping saved restore

## Files read

- `CLAUDE.md`, `docs/knowledge/INDEX.md`: repository boundaries and reading map.
- `docs/knowledge/features/e2e-harness-context-recovery.md` → Held thread read registration: confirmed installation does not prove reply completion; control effects cannot be retried.
- `docs/knowledge/features/thread-item-store.md` → Reply certification and recovery: exact request/generation/epoch/version fences and terminal certificates.
- `docs/knowledge/features/chat-history-api.md` → Owned authoritative mutations: only completed intervals carry completion authority; split persistence is independent.
- `docs/knowledge/features/development-verification.md`: positive barriers and native storage preparation.
- `e2e/thread-activation.spec.ts` → restore-overlap scenario: held restore, bounded opening, final certificate, interrupted reconnect and replacement epoch.
- `e2e/fixtures/heldThreadRead.ts` → `installHeldThreadRead`: one-effect installation/release ownership.
- `src/renderer/src/store/threadRuntime.ts` → `restore`, `sync`, `handle`: restore gates catch-up dispatch.
- `src/renderer/src/store/threadQueryCoordinator.ts` → `receive`: exact correlation and `beginBatch.commit` admission.
- `src/renderer/src/store/threadItemStore.ts` → `beginLocalRead`, `restoredProgress`, `beginBatch`: revision merge, unfinished obligations and completion.
- `src/renderer/src/store/chatHistoryWriter.ts` → `captureChange`, `drain`, `mutationSteps`: serial acknowledged bounded writes.
- `src/main/daemonConnection.ts` → `queryThread`: main registers correlation before sending.
- #2109 refinement comments and retained #2101 checkpoint-only failure (2026-10-18T19:39:28.015Z): checkpoint remains 20 after injected final; setup and teardown succeed.

## Context

One deliverable: retain certified complete checkpoint 25 through the existing overlap/reconnect sequence. A successful rerun cannot identify a repair. First observe the causal boundaries independently, then repair only the demonstrated owner. No visible product change or ADR is intended.

Sizing: expected ≤650 written lines, ≤3 production files, no exported API migration, ≤5 new exported types/components/stores, four observable acceptance criteria and ≤10 new reject branches. The regression and causal instrumentation belong to the same useful repair. In-flight #2079 changes batching/runtime coordination and one observer option in the spec; #2089 changes unpair cleanup. Neither currently supplies a required dependency. Keep any repair local and inspect landed main before final checks.

## Design

Preserve the existing runtime → query coordinator → item-store certificate → owned writer → protected history chain. Add content-free scenario observations for request identity and connection lifetime, terminal receipt/admission, memory checkpoint/completion and protected write acknowledgement. Observe real production state without synthesizing commits or flushes. Keep test controls one-shot; polling performs reads only.

Use these observations to select the failing boundary and write a deterministic regression there before its repair. If evidence establishes invalid scenario ordering, synchronize that existing scenario using a positive causal barrier; do not relax production fences. Record the demonstrated cause and exact contract in Revisions before departing from this investigative design. Do not expand into adjacent lifecycle or harness repairs.

## State + concurrency model

No new application state or asynchronous production task is planned. Existing selection owns saved restore cancellation, coordinator owns request timers/batches, and the history writer owns serial bounded writes. Test observations are scoped to the resumed app and its launch lifetime. Release, injected frames and reconnect remain single effects; observation recovery never replays them.

## State transitions and identity reuse

| Event | Required coverage |
| --- | --- |
| Saved read overlaps newer live revision and new row | Existing named restore-overlap mounted case; add deterministic owner regression after diagnosis. |
| Held correlated terminal certifies 20→25 | Same mounted case independently observes receipt, memory completion and protected result. |
| Two interrupted version-30 replies reconnect | Same mounted case requires checkpoint 25 on both requests and two received fragments. |
| Replacement epoch and late retired reply | Same mounted case positively observes replacement content before excluding retired content. |

## Error handling

Retain typed history status/error results and existing bounded query failures. A rejected/missing certificate cannot gain authority through restoration, scalar version or persistence completion. Diagnostic output contains static classifications, numeric progress and synthetic request correlation only; no daemon item contents, credentials or arbitrary exception text.

## Testing strategy

- Run a controlled failing/passing regression at the demonstrated boundary; preserve its causal evidence and exact command/counts.
- Run focused units for the repaired owner and held-read helper as applicable.
- Build, then run the named mounted case with `--repeat-each 10 --workers 3 --retries 0 --reporter=json`, preserving projects/scheduling; run the complete spec with three workers and zero retries.
- If production changes, run the two ticket-named recorded-client thread/history scenarios without retries after sequential Electron SQLite preparation, preserving capture bytes and strict matching.
- After final merge of main: install, affected-file pre-verify and build. The dispatcher owns the complete configured application gate, including this named case.
- Preserve reports and setup/launch attachments under `/tmp/builder-2122/`; record revision, configured/actual workers and executed/passed/failed/skipped counts here and in PR. Linux is this ticket's operating system.

## Open Questions

- Which boundary loses completion: correlation/admission, memory certificate or protected write? Resolve by causal trace and controlled regression; unchanged green repetition is insufficient.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings: preserve `queryThread` registered correlation, coordinator generation/epoch/version admission and validated history IPC. Test reads cannot confer authority.
- [Tokens] No findings: no credential paths change; observations exclude secrets and item text.
- [File/storage] No findings: use existing protected history API and acknowledged mutations; no new storage paths, plaintext cache or persistence authority.
- [Electron attack surface] No findings: no IPC channel, bridge API, window preference or navigation change; test inspection stays local to the fake scenario.
- [Cryptography] No findings: no Noise, key, nonce or cryptographic changes.
- [Network/I/O] No findings: existing query deadlines and receiver validation remain; no retry or timeout increase.
- [Errors/logs] No findings: only static classifications, progress scalars and synthetic correlation evidence; no caught error messages or daemon contents.
- [Concurrency] No findings: existing owners cancel restore/query work; observation polling is read-only, controls single effects. Certificates and durable acknowledgements are checked separately.
- [Threat model] No findings: delayed/reordered relay replies remain fenced, hostile daemon items remain validated and escaped, compromised renderer retains existing IPC validation, disk secrets retain protected storage. This repair introduces no new trust capability.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-10-19
