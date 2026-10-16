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

### 2026-10-15 — final Linux validation

Validated pushed implementation `bcc8400efdbe759af1e0c38283d4b70fc5aae6a0` after the final `git merge origin/main` (already up to date at `0d299bd26ede123c5dbda7295f7c5f85b52453d6`) and dependency refresh. The final evidence commit changes this plan only. `validation-identity.json` records revision, platform, dependencies and configuration. The production main/renderer artifact hashes still match the baseline byte for byte. The unchanged Playwright configuration SHA-256 is `3b6b77443bf5f4d3f6d56ece6c6b19ec95566efd9d4d445c2374239406b9db80`.

| Reports under `/tmp/builder-2033/` | Executed / passed / failed / skipped | Configured / effective workers | Readiness |
| --- | --- | --- | --- |
| `final-named-1.json` through `final-named-10.json` | 10 / 10 / 0 / 0 | 2 / 1 each | Ten separate consecutive invocations; every attachment has 100 rows and tail `History row 99`, 1118–2147ms. |
| `final-both.json` | 2 / 2 / 0 / 0 | 2 / 1 | Both cases passed; named-case readiness 1803ms. |
| `final-full.json` | 432 / 432 / 0 / 19 | 2 / 2 | Both cases present/passed in project `parallel`, worker index 2, retry 0; named readiness 1244ms, count 100, tail `History row 99`. |

All final reports have zero retries, flaky cases and report-level errors; clipboard/parallel projects remain configured. The complete run was `PW_WORKERS=2 npx playwright test --retries=0 --reporter=json --output=/tmp/builder-2033/final-full-output`, with no spec/grep/project/shard filter. Named invocations add `e2e/thread-scroll-work.spec.ts --grep 'gaps, long hidden runs'`; the two-case run adds only the spec path. Each report has its matching `.stderr.log`; reports embed `feed-readiness` attachments. The full stderr contains only the existing Vite CJS deprecation warning.

The full report's 19 skip titles and annotations exactly match the unmodified baseline:

| Existing skipped file | Count | Reason |
| --- | --- | --- |
| `app-badge-count.spec.ts` | 2 | macOS-only app badge. |
| `window-reopen-converges.spec.ts` | 1 | Only macOS keeps the app running after last-window close. |
| `history-gaps.spec.ts` | 2 | Retired legacy gap persistence; thread recovery is covered by thread activation. |
| `reconnect-event-replay.spec.ts` | 1 | Retired legacy replay; thread reconnect uses certified catch-up. |
| `chat-history-recording.spec.ts` | 9 | Source comment cites #2020: retired raw-event cache/receipt ledger; report annotations have no description. |
| `visible-tail-read.spec.ts` | 1 | Source comment cites #2020: ID-less raw-event receipt identity has no canonical-item equivalent; report annotation has no description. |
| `history-on-open.spec.ts`, `queued-own-settlement.spec.ts` | 1 + 2 | Existing unconditional `test.skip`; no reason is provided in their report annotations or adjacent comments. |

No skip or assertion exemption was added. `pre-verify.log` records all five checks green: main merged, security label, removed strings, typecheck, and unit suite (416 files passed; 10,252 tests passed, 30 existing skips). `build-final.log` and `docs-check.log` pass. No live tests changed or ran.

Retained raw reports, stderr, diagnostic timelines, comparison patch, identity and verification logs are bundled in `/tmp/builder-2033/evidence.tar.gz` (79 files plus manifest). Archive SHA-256: `b89590dbc2de785a0238d38a2d7b65ef0967bfd40292cd20ca53183c4af93fc3`; `evidence-manifest.sha256`: `2b86369b06249834da1907b4d2220b4715e302924f677b99a1d479c55c92290a`. Full report SHA-256: `d37a14d6aaa890bbec70ec2cc4bc9289c67a4427ae250121992dd684eeded611`; full stderr SHA-256: `6a013b71d94eadb16a930c32d667b41cd78de87ee97381f3cb81ed13fbe986e3`.
