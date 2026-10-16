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

## Validation evidence — 2026-10-16

Tested revision: `42b94d179d80886aebe5c282f914388ffc58154d`, containing merged main `f9ca308f87354c27115a890911719522661d40c2`. This subsequent evidence commit changes only this plan; production, tests, fixtures, dependencies and configuration remain byte-identical to that tested revision.

- Linux x86_64, ordinary Node 25.8.0. `npm install --no-audit --no-fund` and `npm run rebuild:node` succeeded. Installation warned about better-sqlite3's supported engine range; the native rebuild and all applicable checks passed on the installed runtime.
- `python3 /work/Projects/pyrycode-desktop-agents/bin/pre-verify-check --test-cmd 'npm test -- --reporter=json --outputFile=/tmp/builder-2051/units.json'`: **5/5 checks passed**, **9,103 unit tests executed/passed, 0 failed, 3 skipped**. The coalescing regression passed unchanged. Skips are the existing credential-gated live-relay round trip and two operator-gated Noise cases. `npm run build` and `npm run check:docs` passed after the final main merge. Logs: `/tmp/builder-2051/preverify.log`, `/tmp/builder-2051/build.log`, `/tmp/builder-2051/docs-check.log`.
- After `npm run rebuild:electron`, executed `PW_WORKERS=4 npx playwright test --config=playwright.config.ts --retries=0 --reporter=json --output=/tmp/builder-2051/test-results > /tmp/builder-2051/playwright.json 2> /tmp/builder-2051/playwright.stderr`. Start **10:09:42.044 UTC**, duration **336.629 seconds**. **435 executed/passed, 0 failed, 3 skipped, 0 flaky**, Playwright 1.61.1, **4 actual workers**, `fullyParallel: false`, **clipboard: 30 passed; parallel: 405 passed/3 skipped**, every result retry 0. No file, grep, shard or project filter. The clipboard project retains its configured single-worker limit. Windows remain shown on Linux and `globalSetup` retains the run-owned shared Xvfb display.
- The exact named scenario executed once and passed in **7,577 ms**, retry 0. Its `read-work-30` and `read-work-400` attachments both contain `{ "constructors": 0, "discovery": 0, "listeners": 0, "subscriptions": 0 }`. Both instrumented documents reached ready `complete`; both apps were running at outcome, exited 0, and had no teardown failures. Genuine `document.hasFocus()` success, processing/commit barriers, lifecycle assertions and both thread sizes are unchanged.
- All three browser skips retain their original reasons: two badge cases because the app-icon count exists only on macOS, and window reopen because only macOS keeps the app running after its last window closes. **Top-level errors: `[]`; fake-daemon-setup failure attachments: none.** The only nonempty launch-fate failure labels in the complete report are deliberately injected `daemon`/`user-data-dir` labels in the passing `launch-fate.spec.ts` report-format test, whose launch list is empty; no actual teardown failure was observed. Stderr contains only the existing Vite CJS deprecation warning.
- The configured packaged protection case also passed: Linux x64, Electron 33.4.11 / Node 20.18.3, better-sqlite3 12.4.1, production `gnome_libsecret`, packaged/asar/unpacked true, stage complete, 100,000 retained memberships. Its stdout/stderr are retained as `/tmp/builder-2051/packaged-runtime.stdout` and `/tmp/builder-2051/packaged-runtime.stderr`.

Raw JSON/stderr, the named case's embedded read-work/document/launch-fate attachments, all configured output attachments, historical reports and the dependency evidence bundle are retained under `/tmp/builder-2051/`. `commands.txt`, `SHA256SUMS` and `retained-evidence.tar.gz` there preserve invocation and artifact provenance. SHA256: complete report `eda479e207032b7bae98c2e3d19e5a0ad53655f3c7c2f3943ccca567693efd3e`; stderr `6a013b71d94eadb16a930c32d667b41cd78de87ee97381f3cb81ed13fbe986e3`; unchanged configuration `7097078cf6aaa5b94888a26af30c0f6bb000e6be66ff78891630f2a19a32795b`.

The merged repair resolves the observed candidate-related setup timeout in the inspected full compositions and this fresh complete run. No residual setup repair or duplicate regression is justified. These results do not establish a native-focus event trace or eliminate every possible future scheduling failure; the historical mechanism's uncertainty remains as classified above. macOS is outside scope.
