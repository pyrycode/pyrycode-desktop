# History-on-open inspection reliability (#2112)

## Files read
- `e2e/history-on-open.spec.ts` → `count`, `observe`, and all four cases: original request counts, cursor order, ignored/trusted input and demand-band geometry stay intact.
- `e2e/fixtures/electronLaunch.ts` → `electron.launch`: installs shared main-process control before returning each app.
- `e2e/fixtures/mainProcessControl.ts` → `createMainProcessControl`, `dispatch`: synchronous inspector receipts retain app-owned operation outcomes without repeating effects.
- `e2e/fixtures/mainProcessControl.test.ts`, `electronLaunch.test.ts` → existing fault and installation coverage; no redundant regression pair needed.
- `CLAUDE.md`, `docs/knowledge/INDEX.md`, `docs/knowledge/features/development-verification.md`, `e2e-harness.md`, `e2e-harness-context-recovery.md` → test boundaries, inspection contracts and sequential native-addon preparation.
- `docs/recorded-tests.md`, `playwright.config.ts` → native checks versus replay and configured/actual worker reporting.

## Change
Confirm merged PR #2132 (`ebdf6ddf59d4e81b9eb2c0229963bac76f727c0f`) against the exact history-on-open scenario on Linux. Commit only this plan and its validation evidence if existing coverage passes. No production, fixture, assertion, timeout, retry or input change is planned. The independently useful outcome is reliable inspection of this existing pagination scenario; its fault coverage and native acceptance form one deliverable. Forecast about 70 written lines, zero new exports, consumer migrations or error branches, and two observable acceptance criteria; all sizing ceilings hold. Remote feature-branch comparison after fetch found no overlap in the plan, named spec, main-process control or guarded launcher.

## Testing strategy
- Run existing `mainProcessControl.test.ts` and `electronLaunch.test.ts`: loss before/after effect, asynchronous completion, falsy values, callback/fatal errors, bounded unavailability, expiry and launch installation/cleanup.
- Merge final `origin/main`, install, run pre-verify against `e2e/fixtures/mainProcessControl.test.ts`, run the launcher unit file and build; then prepare the Electron SQLite addon sequentially.
- Run `PW_WORKERS=3 npx playwright test e2e/history-on-open.spec.ts --grep "opening asks once and only trusted upward input asks for subsequent pages" --repeat-each=10 --retries=0 --reporter=json` and the unchanged complete four-case spec with three configured workers and zero retries. Preserve JSON, stderr, exact revision and actual workers under `/tmp/builder-2112/`.
- Inspect result counts, retry indices, report errors and launch-fate attachments. Dispatcher owns the complete configured application gate; verifier must confirm the named case passes there without retry. No second-OS or live-provider gate is required.

## Historical evidence
The failed observation follows the 41-row page and scrolling to the bottom: `count()` raises `electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.` Each launch-fate records running at outcome, exit 0, null signal and no teardown failures. This is an inspection failure, with no observed incorrect count or rejected paging request. The upstream Electron/Playwright trigger remains unproven.

Original reports inspected under `/work/Projects/pyrycode-desktop-agents/logs/`:
- `verifier-gate_#2095_7.log`: named case failed at retry 0, 3443 ms; three configured/actual workers.
- `verifier-gate_#2097_7.log`: named case failed at retry 0, 3379 ms; three configured/actual workers. `2026-10-18T21-47-43-785Z_verifier-gate-rerun_#2097.log`: 3 executed/passed, zero failed/skipped; named case passed at retry 0, 3016 ms; three configured/two actual workers.
- `verifier-gate_#2107_7.log.failure-1792365615676.log`: named case failed at retry 0, 3465 ms; three configured/actual workers. `2026-10-18T23-20-15-733Z_verifier-gate-rerun_#2107.log`: 3 executed/passed, zero failed/skipped; named case passed at retry 0, 3424 ms; three configured/actual workers. The unsuffixed complete report has been overwritten; retain the suffixed failure.

Retrieved #2097 verifier bundle `e2451e355ab8a52f290ad3f94cb2f56572da97ef00acfc204b371437681519e1` to `/tmp/builder-2112/failure-2097/`; its full-report pointer SHA-256 is `cdf992e4f41befaa379d1ac802b84a00e0810d75a4100da0285c30f19a18711e`. #2112 refinement bundle is retained under `/tmp/builder-2112/prior-evidence/`.

The merged repair replaces value-based `app.evaluate` at the shared launcher with synchronous `Runtime.evaluate` receipts (`awaitPromise: false`). Operation identities and app-owned outcomes preserve observations and prevent duplicate mutation effects after lost acknowledgements. Native input and renderer assertions remain Playwright-owned.

## Validation evidence — 2026-10-19
Linux x86_64, Node 25.8.0, Electron 33.4.11, Playwright 1.61.1. Tested revision `5522fdc8914cd3c6cf4636fb768db824b2557100`, containing final merged main `4f5684078da7befcc83cf73b5c9bf6a928cb5360`. Subsequent commit adds evidence only. No production, fixture, spec or configuration changed. All four cases retain every original assertion, request/cursor check, native input and presentation setting.

| Check | Executed / passed / failed / skipped | Configured / actual workers | Retained report under `/tmp/builder-2112/` |
| --- | --- | --- | --- |
| Named case, command above, ten repetitions | 10 / 10 / 0 / 0 | 3 / 3 | `history-ten.json` |
| `PW_WORKERS=3 npx playwright test e2e/history-on-open.spec.ts --retries=0 --reporter=json --output=/tmp/builder-2112/history-all-results` | 4 / 4 / 0 / 0 | 3 / 1 (one sequential file) | `history-all.json` |
| Existing inspection fault tests through pre-verify | 10 / 10 / 0 / 0 | Unit tier | `unit-evidence/unit-fytu3spm/0.json`, `dispatcher.xml` |
| `npm test -- e2e/fixtures/electronLaunch.test.ts --reporter=json --outputFile=/tmp/builder-2112/electron-launch-unit.json` | 6 / 6 / 0 / 0 | Unit tier | `electron-launch-unit.json` |

The repetition command additionally used `--output=/tmp/builder-2112/history-ten-results`. Both browser reports have zero configured retries, every result at retry 0, zero flaky results/report errors and empty matching `.stderr` files. All 14 launch-fate attachments show running at outcome, exit 0, null signal and no teardown failures. `summary.json` retains per-case identities and counts. The complete spec includes the named case, outstanding-page exclusion, reconnect cursor retention and mounted newest-content/no-cascade case.

Report SHA-256: `history-ten.json` = `b06e6b167ca5e18b1590dcb40fd50800f28c996774f7c3ce31ac813c9b5de724`; `history-all.json` = `865ae2ed6b1da03f452b02614d07213725bef709ee38b2a4003c5bc74ccfd65b`. Unchanged named spec SHA-256 = `26efca9e29a6e0dc7c7b12afe3120e99c268d4dc37f7313754905b5a937e133f`.

Pre-verify: all 5 checks passed, none skipped (`pre-verify.log`). `npm run build` and `npm run check:docs` passed (`build.log`, `docs-check.log`). Approved install passed (`install-approved.log`) after a sandbox esbuild spawn `EPERM` (`install.log`); this was setup failure, not a test failure. Node preparation completed before Electron native preparation (`electron-preparation.log`), which completed before browser launches; no build ran during either browser check.

### Final verifier acceptance — 2026-10-19

The [accepted verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2135#issuecomment-6264778255), authoritative stage `7768b60daa87c6b2df36bd22bc357caf3d174c54922025b89a85da4de6a4a1ec`, satisfies the previously pending complete configured-gate criterion at reviewed head `f400120f71aa5ea7b80f6df1c53b9e2109aef55f` on Linux. The original `npx playwright test --reporter=json` gate recorded **506 executed, 504 passed, 2 failed, 5 skipped**, three configured/actual workers and zero retries configured in both projects. All four history-on-open cases were present and passed at retry 0 with clean launch-fate; `opening asks once and only trusted upward input asks for subsequent pages` passed once at retry 0 in 3026ms. Report: `/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2112_7.log`, SHA-256 `07d078eab67b4e3162668733c93197cfc96f581c614e3d79785588239394118c`.

The two unrelated original failures were history-writer-native and thread-scroll-pin. Their selected same-tree rerun recorded **3 executed/passed, 0 failed/skipped**; the named history-on-open case required no rerun. The dispatcher accepted those flakes. This is not an all-green first run. The unit gate independently recorded **9,671 executed/passed, 0 failed, 3 skipped**, including all 10 inspection fault tests and 6 launcher tests passed, none skipped in those files.

Focused-artifact availability correction: by verification, the original `/tmp/builder-2112/` focused JSON, stderr and 14 launch-fate attachments were no longer present. Retrieved builder bundle `fe5c4526212c6ac4d91671c5ddea2be504a318743006fd6008df2a2fd1913463` has verified checksums but only a redacted log with truncated tool entries and no artifact pointers. The focused counts, hashes and attachment observations above are builder-recorded evidence; the verifier could not independently recheck them. Historical failed/rerun reports and the current-head configured gate were independently reviewed.

The shared repair meets acceptance without further code changes; the upstream inspection trigger remains unknown. macOS/Windows and provider/daemon live checks are outside this Linux ticket's verification scope. Documentation records existing evidence and ran no unit or browser tests. The durable inspection boundary and counted results are in the [owning harness topic](../../knowledge/features/e2e-harness-context-recovery.md#history-on-open-inspection-validation).
