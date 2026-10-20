## Files read
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/recorded-tests.md`: repository and guarded replay contracts.
- `docs/knowledge/features/development-verification-replay-native-storage.md`: distinguish missing observations from false and keep Node/native rebuilds sequential.
- `e2e/fixtures/replayNativeStorage.ts` → `probeReplayNativeStorage`, `readReplayMainProcess`, `assertReplayNativeStorage`: native operation and synchronous inspector boundary.
- `e2e/fixtures/replayNativeStorage.test.ts`: bounded absence, fatal propagation and fresh-session controls.
- `e2e/replay-native-storage.spec.ts`: actual Electron saved-profile control and content-free diagnostics.
- `e2e/fixtures/clientScenario.ts` → replay `opened`: prerequisite before device binding.
- `scripts/run-offline-replay.mjs`, `scripts/replay-build-profile.mjs`: sequential guarded builds and executed build hashes.

## Context
One behavior: reliably establish genuine native SQLite readiness for each replay process. Its classifications, regression and repair are inseparable proof of that behavior. Historical #2191 macOS explicit-false results remain failures; the retrieved builder evidence bundle is `e11eb885f5cb9b311b863680bd76209907c6d9b4d6fef5fcca206e4c7cfd89ce` under `/tmp/builder-2204/evidence-2191/`. No cache or ABI attribution is established. No production changes or ADR are planned.

## Design
Return a content-free native observation with readiness, failed stage (resolution, load, open, query or close), and a static exception category. Keep cleanup failure separately when an earlier operation failed. A successful observation requires all four genuine SQLite operations, including close. Keep the synchronous inspector generic and its return values unchanged. The prerequisite recognizes only validated observations (and conclusive booleans), rejecting a failure immediately. An optional observation callback records only validated static classifications, never unexpected inspector values. Attach per-process classifications from the replay lifecycle before device binding.

Considered a separate diagnostic probe: keep classifications on the actual prerequisite instead, since a later probe cannot attribute an earlier failure. Investigate the classified failing boundary, then record the demonstrated local correction in Revisions before handoff.

Overlap: #2201 changes replay daemon diagnostics in `clientScenario.ts`; this ticket adds local observations in the separate opened hook, with no dependency.

## State + concurrency model
Each probe owns a new in-memory database and closes it synchronously. Each opened Electron process obtains its own inspector session. Observations belong to one Playwright test and are attached in fixture teardown. No production state, shared profiles or background work is introduced. Preserve the five-second deadline and 100 ms inconclusive-observation polling.

## State transitions and identity reuse
| Event | Coverage |
| --- | --- |
| Initial launch then saved-profile relaunch | actual-Electron native prerequisite control; fresh-session unit |
| Query failure followed by close failure | native stage classification unit preserves first failure |
| Inconclusive observation followed by success or false | existing bounded observation units |
| Persistent absence, fatal inspector error | existing timeout and fatal propagation units |

## Error handling
Native exceptions become static categories without messages, paths or stacks. Inspection exceptions remain distinct from unavailable values. Fatal transport/session errors propagate unchanged. Native false is immediate; unknown returned values are inconclusive, never synthetic success.

## Testing strategy
- Test-first causal regression for the demonstrated mechanism and stage/error precedence controls.
- Existing prerequisite units retain immediate false, bounded absence, fatal errors and session freshness.
- Run the actual-Electron saved-profile control with real SQLite and owned teardown.
- Finish Node pre-verify and build before Electron rebuild. Run the unchanged two-case guarded complete-thread selection twice, fully parallel, three workers, retries zero on Linux. Retain reports, logs, hashes, classifications, worker overlap and complete exchanges in `/tmp/builder-2204/`; record counted evidence here. macOS is outside this run's scope and historical macOS failures remain failed.

## Open Questions
- Which native or inspection stage supplies explicit false? Resolve using the actual classified prerequisite before claiming a causal repair.

Sizing: approximately 420 written lines, at most 2 new exported types, 1 updated consumer, 3 observable acceptance criteria, fewer than 10 classified failure branches. Within all ceilings and the verification floor.

## Revisions
2026-10-20: this branch currently contains investigation instrumentation, not a demonstrated readiness repair. Native exceptions now retain static stage/code categories and the first failing operation when cleanup also fails. That regression corrects diagnostic precedence; it does not attribute the historical false result. The actual-Electron control also runs the original boolean algorithm before the classified probe on each process, retaining its result separately. No production source, recordings, envelopes, checkpoints, bounds or application assertions changed.

The open causal question remains unresolved after two diagnostic paired batches. Do not treat their passes as a correction, open a normal repair PR, or close this ticket on these results. Next work must capture an explicit false with its native/inspection classification, demonstrate that mechanism with a failing control, and repair it before acceptance. No dependency on #2191, #2198, #2153 or #2201 is established.

## Investigation evidence
All paths below are under `/tmp/builder-2204/`, unless explicitly qualified. Reports have same-stem `.log` and `-results/` directories. Linux x64 is the tested OS; macOS is outside this run's verification scope. Historical macOS failures remain failures.

| Check | Executed / passed / failed / skipped | Report SHA-256 |
| --- | --- | --- |
| Original probe, classification regressions | 49 / 40 / 9 / 0 | `unit-classification-red.log` |
| Classified probe units | 49 / 49 / 0 / 0 | `unit-classification.log` |
| Actual-Electron saved-profile and diagnostic controls | 4 / 4 / 0 / 0 | `electron-diagnostic.json`: `c27567d5befe04033cead807c5fa7c8e9b3d6ab198ac55206509cafd77250a63` |
| Paired diagnostic batch 1 | 4 / 4 / 0 / 0 | `paired-diagnostic.json`: `0034aff5a40baf49b454fb2985baa45ba1327cbfe4e15b7490139ffb00231598` |
| Paired diagnostic batch 2 | 4 / 4 / 0 / 0 | `paired-diagnostic-2.json`: `f245b022ef47e04fc53502d243929aa775ed893215e3349d05a7c4de2357eded` |

Both paired batches used the exact named cases, repeat-each 2, three configured and actually overlapping workers, retries zero. Every history exchange matched 32 requests / emitted 63 frames / 0 remaining; every thread exchange matched 45 / 378 / 0. Both guards reported zero forbidden launches. All 20 process probes were complete. Executed build: `e106d2ba9a4e5feaeca3765b30dd69750375ba65`, dirty=true, complete-thread. `summary.json`, generated by `summarize.py`, retains per-test worker intervals, native classifications, input hashes/capture provenance and all executed build/bundle hashes. Build and execution were sequential; Node work finished before native preparation.

Original macOS failure retention: `/tmp/builder-2191/index-candidate-paired.json`, `.log`, and `index-candidate-results/` remain original remote artifacts. The retrieved evidence bundle contains the builder log and no full report or result-directory copy. Its recorded report SHA-256 is `e8c076dd31d05cf5f7e380cf3c76c88db74db086cc32db36d56377ddb9b7c1e7`; executed `f2a58a2e`, dirty=true, complete-thread, 4 / 2 / 2 / 0. Thread exchange 38 / 345 / 7 and history 10 / 21 / 22 failed explicit false before protected-paging observation. That evidence supplies no failed native stage. Keep separate from #2191's paging stall, #2153's saved-only assertion and #2201's reconnect failure.

The first final pre-verify run retained `pre-verify-first.log` and `unit-final-first/`: 51 / 50 / 1 / 0, solely an unsupported Vitest matcher in the new diagnostic test. Replaced it with supported separate call-count and argument assertions. This test-authoring failure is separate from the historical native failures.
