# Visible-tail focus reliability (#2051)

## Files read

- `e2e/visible-tail-read.spec.ts` → `focus`, `instrumentReadWork`, `readState` and the short/long-thread scenario: genuine focus, positive processing/commit barriers and read-work counters.
- `e2e/fixtures/desktopIsolation.ts` → `launchIsolatedApp`, `e2eShowsWindow`: shown Linux windows, independent app resources and launch-fate evidence.
- `e2e/fixtures/runDisplay.ts` → `globalSetup`, `startRunDisplay`: one Xvfb display per run, shared within that run.
- `playwright.config.ts` → `workerCount`, clipboard/parallel projects: unchanged four-worker composition and zero-retry local policy.
- `src/main/indexedThreadHistory.ts` → `tree`, `sequence`, `mutateThread`: synchronous protected-path batching and flush before header commit, delivered by #2044.
- `src/main/indexedThreadHistory.test.ts` → `coalesces shared protected paths into one write per path in an owned batch`: existing 400-item write-count regression.
- `docs/specs/architecture/2044-owned-thread-changes.md` → Revisions: original comparison, merged repair and final verification history.
- `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/development-verification-layout-and-input.md`, `docs/knowledge/features/chat-history-testing.md`: counted evidence, focus and storage verification boundaries.
- Root `CLAUDE.md` and agents `docs/working-practice.md`: Linux verification, native-module rebuild and publishing requirements.

## Change

Classify the historical focus timeout against merged #2044 / PR #2053 (`f9ca308f87354c27115a890911719522661d40c2`) and commit the inspected evidence. No product, fixture, focus helper or suite configuration change is currently justified. Keep the existing coalescing regression and unchanged visible-tail spec; add a local setup repair only if final verification demonstrates a residual defect, after recording a controlled failure and a plan revision.

This is one classification/reliability deliverable, estimated at fewer than 150 plan/evidence lines, zero production/test changes, exported abstractions or consumer migrations, three acceptance behaviors and no new error state machine. The in-flight remote-branch audit found no overlap with this new plan. The potential existing regression file overlaps #2026's independent legacy-cleanup tests; those changes are not needed or consumed here.

### Historical evidence inspected independently

All reports below are retained JSON with corresponding `.stderr` under `/tmp/builder-2044-`. The two original complete reports are separate observations, not a combined rerun summary.

| Report suffix | UTC start on 2026-10-16 | Executed / passed / failed / skipped | Actual workers |
| --- | --- | --- | --- |
| `playwright.json` | 07:09:03.302 | 435 / 434 / 1 / 3 | 4 |
| `playwright-repeat.json` | 07:13:56.328 | 435 / 434 / 1 / 3 | 4 |
| `baseline-focus.json` | 07:20:25.059 | 1 / 1 / 0 / 0 | 1 |
| `candidate-focus.json` | 07:20:55.460 | 1 / 0 / 1 / 0 | 1 |
| `batched-focus.json` | 07:22:20.468 | 1 / 1 / 0 / 0 | 1 |
| `shipped-playwright.json` | 09:34:23.950 | 435 / 435 / 0 / 3 | 4 |

The original candidate was `b329123346da6ef757723db567bad82c761e3ec4`; batching landed in `d163c99eb483ee5230ee04016e5a464a6559b708`. Both originals and the isolated candidate fail the five-second `document.hasFocus()` poll in `focus`. Each completes `read-work-30`, installs a second document probe, and never completes `read-work-400`. Both apps remain running at outcome and exit 0 with no teardown failures. The packaged protection case passes in each original. This localizes the failure to long-thread setup, before its read assertions.

Each comparison has zero retries/skips/top-level errors. The passing baseline and batched runs contain both completed read-work sizes. An isolated candidate failure demonstrates that concurrent test windows are not necessary to reproduce it. The comparisons do not measure native window/webContents focus or main-loop latency, so neither focus theft nor a specific delayed-focus event is established.

The merged implementation coalesces repeated authenticated-path writes within a synchronous transaction; its existing regression asserts one write per final path for 400 items. Together with pass/fail/pass and unchanged focus/display code, this supports excessive synchronous storage work as the candidate-related trigger. The exact scheduling path from that work to page focus remains uncertain. A focused pass alone provides no full-composition reliability proof.

Inspected the later final-source complete pass above and the independent verifier gate at `5005bf69a9eb04ea2d7e11dbccd50cfbc464680e`, starting 09:47:04.581 UTC: 435 executed/passed, 0 failed, 3 skipped, four actual workers, both projects, zero retries/flaky results/top-level errors. Both retain `read-work-30` and `read-work-400` with zero constructor/discovery/listener/subscription increments, and clean launch-fate attachments. The verifier report is `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2044_8.log`; its managed evidence bundle is `ead9679382b70f8de414cdb257b8391999f6629197c2b399d056496aa7f2efd8` (retrieved under `/tmp/builder-2051/dependency-verifier/`). The bundle's pointer identifies the full report and its SHA256. There are no fake-daemon-setup failure attachments. Stderr contains only the Vite CJS deprecation warning.

The passing verifier revision differs from this checkout only in documentation. Existing complete-suite evidence was inspected before scheduling fresh verification. No residual setup defect is demonstrated, and the existing batching regression is reused without duplication.

## Testing strategy

- Merge latest `origin/main`, install dependencies, rebuild better-sqlite3 for ordinary Node, run the full pre-verify check and build. Run the existing coalescing assertion through the unit suite.
- Rebuild better-sqlite3 for Electron before browser tests. Run the complete configured Linux fake suite with four actual workers, clipboard/parallel projects and zero retries, preserving existing display/isolation behavior. This fresh run validates the merged #2051 checkout, beyond the inspected source-equivalent evidence.
- Retain JSON, stderr, attachments and hashes under `/tmp/builder-2051/`; record exact tested revision, command, effective configuration, counts, skips and setup/top-level errors here before handoff. Confirm the named case passes both sizes with the genuine focus predicate and positive processing/commit assertions unchanged.
- The three existing browser skips are the two macOS badge scenarios and macOS window-reopen scenario. macOS is outside this ticket's verification scope. No live-Claude tests are changed or required.
