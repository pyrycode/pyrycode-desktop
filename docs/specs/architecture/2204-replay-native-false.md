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
