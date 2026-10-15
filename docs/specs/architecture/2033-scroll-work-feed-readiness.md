# Scroll-work feed readiness

## Files read

- `e2e/thread-scroll-work.spec.ts` → `instrument`, `settle`, `correctAnchor` and both scenarios: preserve the bounded-work and lifecycle oracles; change only second-scenario setup.
- `src/main/transport/fakeDaemon.ts` → `FakeDaemon.pushFrame`: synchronous seal/send is not renderer acknowledgement.
- `playwright.config.ts` → `workerCount`, clipboard/parallel projects: preserve configuration and use `PW_WORKERS=2`, zero retries.
- `e2e/fixtures/runDisplay.ts` → `globalSetup`: Linux runs own their Xvfb display.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`: repository and proof boundaries.
- `docs/knowledge/features/conversation-shell-scroll-pin.md` → Bounded anchor and growth verification: exclude readiness from measured hook work.
- `docs/knowledge/features/development-verification-evidence-that-cannot-pass-too-early.md`: require positive committed input before absence/geometry assertions.
- Shared `docs/working-practice.md`: publishing, validation and evidence ownership.

## Change

The gap/hidden-run scenario currently pushes 100 completed replies then waits only the default five seconds for the final rendered text. Investigate the unchanged scenario on Linux at main `0d299bd26ede123c5dbda7295f7c5f85b52453d6`, then repair only its local feed/readiness setup. If the same feed completes after five seconds, use a bounded local rendering deadline justified by measurements, with positive checks for all 100 assistant rows and the final `History row 99` before any DOM geometry mutation. Verify completion rather than relying on animation frames or send completion. Keep instrumentation disabled until its existing reset, and retain every subsequent assertion and the sibling case unchanged. No production code, shared fixture, dependency, global timeout, project or concurrency changes.

No in-flight remote feature branch overlaps `e2e/thread-scroll-work.spec.ts` in the pre-plan audit. One deliverable; forecast ≤180 written lines, zero new exports, zero migrated production callers, four observable acceptance criteria and no new error branches. No UI change or documentation-stage requirement.

## Testing strategy

- First run the unmodified named scenario with `PW_WORKERS=2`, `--retries=0`, JSON report and retained stderr. Record dependencies and revision.
- Diagnose unchanged-feed progress after the original five-second deadline without ending the app; record count/tail at five seconds and at completion. Keep diagnostics local and exclude them from the shipping work oracle.
- Run the repaired named scenario in ten separate consecutive Linux invocations with zero retries, then both cases in the file. Preserve configured workers and record effective workers from each report.
- Run the complete configured fake suite with `PW_WORKERS=2`, zero retries, unchanged clipboard/parallel projects. Retain JSON, stderr, skip reasons, report errors and exact named-case result.
- After final merge of main, run pre-verify and build. This ticket explicitly requires the full fake suite in builder validation; no live-Claude tests change.

## Revisions

Investigation and counted validation outcomes will be appended here before handoff. Evidence files stay under `/tmp/builder-2033/`; this plan records their provenance and results.

### 2026-10-15 — controlled cause and chosen barrier

All comparisons used Linux x86_64 on build-hp-1, application main `0d299bd26ede123c5dbda7295f7c5f85b52453d6` (plan-only HEAD `a08b28ab20061fe1fb7deab8afdcb60aa1f32488`), the same built app and installed dependencies, Node 25.8.0, npm 11.11.0, Electron 33.4.11 and Playwright 1.61.1. Lock SHA-256: `ce7ecdb807ffdceacd7e93c272b989f1c1f3f07a9b045ab58d8879088fe91026`. `dependencies.txt` and `baseline-build.sha256` retain identities. All commands set `PW_WORKERS=2`, `--retries=0`, `--reporter=json` and scratch `--output`; clipboard/parallel projects are unchanged. No live tests or UI changes.

Unmodified natural scheduling did **not** reproduce the incident on this host: `control-original.json` passed 1/1 (one effective worker); `control-original-repeat.json` passed 4/4 with `--repeat-each=4` (two effective workers); `control-full.json` passed 432/432 with 19 inherited skips and two effective workers. All had zero retries and report errors. This does not explain the original build-fractal-2 scheduling trace.

To control throughput without changing delivery, temporary spec-local CDP `Emulation.setCPUThrottlingRate({ rate: 6 })` ran **after launch and before the unchanged 100-pair feed**, identically in control and repaired comparison. A renderer-local MutationObserver recorded committed count/tail versus `performance.now()`, disconnected at row 100, and made no geometry reads. Throttling was restored before geometry checks; none of this diagnostic instrumentation ships.

| Report | Executed / passed / failed / skipped | Configured / effective workers | Outcome |
| --- | --- | --- | --- |
| `control-slow.json` | 1 / 0 / 1 / 0 | 2 / 1 | Original tail assertion rejected at 5000ms; the same feed subsequently rendered all 100 rows. |
| `control-slow-timeline.json` | 1 / 0 / 1 / 0 | 2 / 1 | Original deadline rejected; timeline had 63 rows at 4919ms, 64 at 5069ms, all 100 ending in `History row 99` at 8257ms. |
| `repaired-slow.json` | 1 / 1 / 0 / 0 | 2 / 1 | Same feed/slowdown: 70 rows at 4953ms, 100 at 7288ms; positive readiness at 7489ms, then all geometry/cleanup assertions passed. |

Each comparison had zero retries and report-level errors. The control rethrows its original assertion only **after** observing eventual completeness, preserving both the failure and proof of continued delivery. `control-slow-timeline-progress.json`, `repaired-slow-progress.json` and JSON report attachments retain the row timelines; `repaired-slow.patch` retains the temporary comparison instrumentation. Matching `.stderr.log` files are retained for every report. The controlled failure demonstrates an insufficient deadline under slower rendering, not a dropped/permanently stalled feed; natural unthrottled results above remain explicit.

The shipping barrier checks the exact ordered markdown contents of all 100 assistant rows in one assertion with a local 15-second limit, then requires no streaming cursors and attaches actual count/tail/elapsed time. Fifteen seconds is the sibling's existing initial-render allowance and exceeds the measured controlled completion maximum of 8.26 seconds with headroom, while remaining bounded inside the fixture's unchanged 60-second test deadline. The subsequent six frames settle layout only; the positive DOM barrier establishes receipt/commit. Existing `reset` still begins work measurement later. No assertion after setup or in the sibling scenario changed.
