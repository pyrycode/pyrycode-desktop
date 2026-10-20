# Reconcile stable-callback flake evidence

## Files read
- `e2e/visible-tail-read.spec.ts` → named stable-callback case: paired hold, exclusions, ordered sentinel and release assertions.
- `src/renderer/src/store/threadRuntime.ts` → `schedule` / `unschedule`: identical drain races a frame and 50 ms timer; loser is cancelled.
- `docs/specs/architecture/2186-pending-read-barrier.md` → Final Linux validation: controlled regression, repetitions and retained reports.
- `docs/knowledge/features/development-verification.md`, `development-verification-evidence-that-cannot-pass-too-early.md` and `thread-runtime.md` → source identity, accepted evidence and read-publication contract.

## Change
One evidence-only deliverable: reconcile the [two Linux sightings and unchanged reruns](https://github.com/pyrycode/pyrycode-desktop/issues/2197#issuecomment-6297802728) with merged [#2186 / PR #2189](https://github.com/pyrycode/pyrycode-desktop/pull/2189). Record the cause, source comparison and retained accepted proof here and on #2197. Preserve the existing implementation, assertions and original failures. No UI, state, type, error branch, ADR or documentation-stage deliverable is introduced. Estimate: approximately 30 plan lines, zero production/test changes, exports or consumer migrations, two criteria; within every ceiling. Remote feature-branch audit found no overlap with this plan path; #2176's diagnostic edits to the inspected spec require no dependency for this receipt.

## Testing strategy
Reuse #2186's accepted controlled red/green, ten repetitions, seven-case spec and complete Linux gate for the unchanged barrier. Download the exact accepted bundle and both original-failure bundles, verify manifests and inspect the named cases. Compare failed and accepted Git blobs with current main. After the final main merge, run installation, pre-verify selecting existing `src/renderer/src/store/threadRuntime.test.ts` and build on Linux. These fresh checks validate this branch; retained browser evidence remains attributed to its original candidates. No new browser/native/live run is required. Dispatcher owns complete downstream acceptance; macOS is outside scope.
