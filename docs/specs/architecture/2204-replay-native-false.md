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

### Final diagnostic validation
After the final merge of `origin/main` (`f8e4e508`), pre-verify passed all five checks with **54 executed / 54 passed / 0 failed / 0 skipped** in `unit-final/unit-hywtyq7a/`. `npm run build` passed. Node checks finished before `native-prepare-final.log`; native addon SHA-256: `1aebb6e757848aee805967d82dc09ce25b7797964e2d4afe7222dfabf4eaf9fc`.

- `pre-verify-final.log`: `f5c854df1e45aa74aa11aa53a52c4055f9554f942963b20b4019a64778b21973`.
- `build-final.log`: `7fc860d3646366a9637db05b841a1626e251e7df83d497f01c6928eab10806e4`.
- `native-prepare-final.log`: `d48d180a1cead0c7677943eb82710cb30ba1b2bddd726e6b49348fcda66e900c`.
- `electron-final.json`: `6b1f5d5873e1a73d965692ccb5d6baaf19c9ceff06d9dc943d1d5a7cd3213390`, **4 / 4 / 0 / 0**. The original boolean algorithm was also complete on initial and saved-profile launches. Four classified real SQLite probes completed; both child processes exited zero, with no teardown failures.
- `paired-final.json`: `98ff2d84463f842a69b6b443691d1da7fe100084a48604ea082cbb0b1371a011`, **4 / 4 / 0 / 0**, three configured and overlapping workers, retries zero. Build `d9794a627c28ef97513deaab56f27321bee5c345`, dirty=false, complete-thread. All ten process probes complete, both history exchanges 32 / 63 / 0 and both thread exchanges 45 / 378 / 0, zero forbidden launches. No top-level report errors.
- Final `summary.json`: `d9f67e2aec9ac6ccf5202dd4f71161e120ffbcd3c084ba516f78fbf2a72dec6e`, including all five browser reports, exact input/capture provenance, bundle hashes and worker intervals. Final input hashes remain thread `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`, history `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`.

Across all three diagnostic paired batches: **12 / 12 / 0 / 0**, 30 complete native probes, every exchange complete, no retries or forbidden launches. All commands finished; no native or browser job remains running. These are diagnostic passes, not post-correction acceptance: the explicit false has not reproduced, its original stage remains unknown, and no causal readiness correction or repair PR is claimed. Preserve this branch for continued investigation rather than advancing it as completed.

### Recovery investigation — 2026-10-20
The recovery review identifies a first-use observation defect: `better-sqlite3` loads its native binding inside `Database`, after the current adapter marks `open`. The Electron control also warms that binding with the historical algorithm before testing the prerequisite. First add a default-adapter regression for lazy native loading versus genuine opening, then make the classified prerequisite the first probe on every owned initial/relaunched control process. Keep historical-algorithm comparisons in separately owned processes and retain static cold/warm observations. Inspect the resulting Electron and paired evidence before choosing a readiness correction; classification or diagnostic passes alone do not settle the causal question.

No retained worker or Electron descendants were present on recovery. Current remote feature branches have no overlap with the four harness files. This remains one independently useful native-readiness behavior, with its consumed regressions and evidence; forecast total written work remains below 650 lines, zero production files, no new exported surface or consumer migration, three acceptance behaviors and fewer than ten reject branches. No security-sensitive label is present. Existing history/thread assertions, recordings, ownership, deadlines and immediate false rejection remain unchanged.

### Demonstrated first-use correction — 2026-10-20
The default lazy loader fails while a V8 stack formatter is active: `bindings.getFileName` relies on a nested `Error.prepareStackTrace` callback, which V8 does not invoke recursively. Native discovery throws before opening SQLite, producing the historical algorithm's explicit false and the existing classifier's misleading `open/type-error`. `recovery-causal-unit-red.log` retains 57 executed / 55 passed / 2 failed; `recovery-causal-electron-red.json` retains 7 / 6 / 1 / 0. The actual-Electron cold prerequisite fails immediately; separate historical-algorithm processes reproduce false on initial launch and saved-profile relaunch, then succeed outside stack formatting with the same native artifact. The ordinary unwarmed controls and paired baseline still pass and remain diagnostic evidence. This demonstrates a first-use mechanism, not the unavailable failed-stage provenance of the historical macOS reports.

Resolve the installed SQLite package root explicitly, call its existing `bindings` loader with `module_root`, and load the genuine addon while the stage is `load`. Pass that addon through `Database`'s `nativeBinding` option before marking/performing `open`, then retain the existing query/close and primary-error precedence. Explicit root resolution is preferable to pinning one compiled binary location: it removes the demonstrated stack dependency while preserving the package's supported native search locations. No retry or deferred success is introduced. The default-adapter lazy-load regression distinguishes a native loader exception from a loaded addon rejecting database open. The actual-Electron nested-formatter control must pass with real SQLite on both cold processes after repair; historical comparisons remain in separate processes. The original unavailable-inspection, immediate false, fatal-error and fresh-session controls remain required.

### Recovery validation — Linux x64, 2026-10-20
The causal question is resolved for the controlled first-use boundary: nested V8 stack formatting breaks implicit addon discovery, and explicit package-root discovery removes that dependency. Additional files read were `node_modules/better-sqlite3/lib/database.js` → `Database` (lazy loading and `nativeBinding`), `node_modules/bindings/bindings.js` → `bindings`, `getFileName`, `getRoot` (stack-dependent discovery), and `e2e/fixtures/desktopIsolation.ts` → launch/profile/teardown ownership. This does not recover the missing failed-stage observations of the historical macOS runs or assert that every historical false had this cause. Those failures and all earlier diagnostic artifacts remain intact.

| Repeated event / condition | Regression coverage |
| --- | --- |
| Default adapter encounters lazy native-load failure | `classifies first-use lazy native binding failure through the default adapter as load` |
| Binding loads, but database open fails | `distinguishes a loaded binding rejecting a genuine open through the default adapter` |
| Cold load while a V8 formatter is active | `establishes cold native readiness during an active V8 stack formatter`; `cold native prerequisite survives active stack formatting on launch and relaunch` |
| Initial process exits; same saved profile reopens cold | Both classified Electron controls; marker and launch-fate assertions on each process |
| Historical comparison could warm readiness | Separate historical-control processes, with static cold/warm observations; `historical cold native probe fails during stack formatting in separate processes` |
| First successful result omitted, then another real probe succeeds | Existing missing-inspector-values Electron control, now after an unwarmed classified prerequisite |

Artifacts below are under `/tmp/builder-2204/`, with matching `.log` and `-results/` for every browser JSON. Earlier evidence is neither overwritten nor counted as post-correction acceptance.

| Check | Executed / passed / failed / skipped | Artifact |
| --- | --- | --- |
| Default-adapter and formatter causal units, before repair | 57 / 55 / 2 / 0 | `recovery-causal-unit-red.log` |
| Cold Electron controls, before causal case added | 5 / 5 / 0 / 0 | `recovery-cold-baseline.json` |
| Paired diagnostic baseline, unchanged native behavior | 4 / 4 / 0 / 0 | `recovery-paired-baseline.json` |
| Actual-Electron formatter regression, before repair | 7 / 6 / 1 / 0 | `recovery-causal-electron-red.json` |
| Repaired units / final pre-verify | 57 / 57 / 0 / 0 | `recovery-unit-final/`, `recovery-pre-verify-final.log` |
| Repaired complete Electron control spec | 7 / 7 / 0 / 0 | `recovery-electron-final.json` |
| Post-correction guarded paired acceptance | 4 / 4 / 0 / 0 | `recovery-paired-final.json` |

Final pre-verify passed all five checks after merging `origin/main` `e8fb1c9632f4`. The harness-specific strict TypeScript check and `npm run build` passed. All Node work finished before `recovery-native-final.log`; native SHA-256 is `1aebb6e757848aee805967d82dc09ce25b7797964e2d4afe7222dfabf4eaf9fc`. Build, native preparation and Electron execution were sequential. The final controls own eight processes, each exited zero with no teardown failure. Both classified modes observed cold readiness on initial launch and saved-profile relaunch; separate historical formatter controls retain the expected explicit false on each cold process and a successful unformatted operation using the same artifact.

The final paired command used the exact two named cases with `node scripts/run-offline-replay.mjs --profile complete-thread`, `--fully-parallel --workers 3 --repeat-each 2 --retries 0`. Executed clean revision is `2a9fa07724d78eb24845280ddf45f50fe01225d3`, dirty=false, complete-thread. Slots 0/1/2 overlap from 23:54:07.086 UTC until at least 23:54:13.461 UTC; the reused slot 0 has worker index 3. Every history exchange is 32 matched / 63 emitted / 0 remaining; every thread exchange is 45 / 378 / 0. All ten process prerequisites are complete; zero forbidden launches, retries, skips or top-level report errors. Recorded bytes, original application assertions, envelopes and checkpoints have no diff from main.

`recovery-summary.json` retains worker intervals, all classifications and launch fates, exact capture provenance/input hashes, seven compiled bundle hashes and report/log hashes. History input remains `de0b1166b6e05e0792228c07be25c20498b117914e673558222eac12cd4e6d2c`; thread remains `53a3db11cfab2d5041b511d7be4d030ab5b2b8449b7fdb3ea1d7e5e3db552ae3`. Capture provenance remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`, daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary `5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`. No fresh provider/daemon acceptance was requested. macOS is outside this Linux run's verification scope; its historical failures remain failed.

SHA-256: causal Electron red `619a093f5e0837f28be0ed0a80f7686bd0be8ed24eae94eb9d030b24ccea0285`; final Electron `ed063a3f926406b4c657005bf7a688d496cff265b0229a41a2f9a07d8014f24b`; final paired `0b4e50019b8de512ece0cbe1d61805a2d07d687f57bbd9a612e9e2dcb7bd4964`; recovery summary `23273b79997ceb8ee3e5701d3c001edfad624611d819e5b5df052ee17a828aa2`. Final pre-verify log `53c7878488e6ea565ada8562200c34276982d75bf575a5b33fda443e8cc2cbc7`; build log `6d1a6312d37c858c96a061338e93cdfa0ac275fb4d735bd3a545fa41b8318885`. The first default-adapter red used an invalid fixture root and is retained separately in `recovery-lazy-red.log`; its corrected red and the later causal red fail at the intended boundary. An initial harness-only typecheck exposed an unannotated throwing test method; its return type is now `never`, and the final strict check passed. No worker, build or browser job remains running at handoff.

Final scope: 407 added lines including this evidence (plus local replacements), no production files, zero new exported types/components/stores, one consumer, three acceptance behaviors and the existing bounded rejection model. Within the sizing ceilings and verification floor. Independent verifier review and dispatcher-owned normal gates follow the PR.
