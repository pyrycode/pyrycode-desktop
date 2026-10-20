# Effort replay failure preservation

## Files read
- `e2e/real-claude-effort-default.spec.ts` → `observe`, scenario relaunch and finalization: stale proof can mask relaunch rejection.
- `e2e/fixtures/effortProof.ts` → `waitForEffortProof`: observations must remain required and fresh.
- `e2e/fixtures/realDaemon.ts` → `withIsolatedElectronApp`: already preserves incoming errors through profile cleanup.
- `e2e/fixtures/clientScenario.ts` and `replayProfileRetirement.test.ts` → replay retirement: preserve connection completion and forwarding ordering.
- `docs/recorded-tests.md`, `docs/client-replay-migration.md`, `docs/knowledge/features/development-verification.md` and `development-verification-replay-native-storage.md`: strict replay, native preparation and counted evidence boundaries.
- Root `CLAUDE.md`, knowledge index, shared working practice and ticket scope policy: test-only ownership and macOS checks.

## Context
Repair one independently verifiable failure-preservation boundary. The historical
closed-page report does not establish the relaunch trigger. Preserve both original
reports separately. No production/status convergence repair or ADR is needed.
In-flight remote branch inspection found no overlap in the scenario/helper paths.
Sizing: approximately 350–450 written lines, zero production files, at most three
exported test contracts/functions, one consumer, four observable criteria, at most
eight classified failure branches; within all ceilings before and after planning.

## Design
Add a directly consumed `withEffortScenarioProof` helper beside the proof fixture.
It runs observation setup, scenario body, requested handoff and finalization under
one first-error boundary. Each process owns one observer; handoff captures and
attaches proof before disposing and clearing that owner, then awaits relaunch and
installs replacement observation. Finalization attempts capture, disposal and
attachment independently, preserving the first thrown value even if secondary
work rejects. The outer isolated-app fixture retains process/profile cleanup.
`observe` retains its latest successful snapshot for diagnostics only and always
attempts CDP detach even if listener disposal fails. Partial setup releases its
observer resources. Existing settings assertions never use cached diagnostics.

## State + concurrency model
Sequential test tasks only; no new timers, retries, stores or background work.
Current observer ownership is cleared before awaiting replacement. Proof records
identify process ordinal, phase and availability; lifecycle diagnostics contain
only static categories and counts, never raw native/inspector failures or paths.

## State transitions and identity reuse
| Event | Regression in `effortScenarioProof.test.ts` |
| --- | --- |
| Old page closes, relaunch rejects before handles return | relaunch rejection retains primary and pre-retirement proof |
| Scenario failure plus snapshot, attachment or disposal rejection | secondary failures preserve primary and finish cleanup |
| Unexpected page closure | unexpected closure fails with last available proof |
| Successful same-profile handoff | successful handoff distinguishes process proof |
| Initial/replacement observer setup failure | required observation and setup failures remain failures |
| Required snapshot/disposal/attachment fails without prior error | required finalization fails without an earlier error |

## Error handling
The original thrown error remains primary; secondary failures are static lifecycle
categories. Unavailable proof is explicit, never a successful observation. Setup
and relaunch failures propagate when first. Every remaining cleanup is attempted.

## Testing strategy
Test the exact helper consumed by the scenario with fake pages/observers and the
real isolated-app lifecycle behind a fake launch boundary where appropriate.
First run the causal regression against extracted original finalization to prove
failure, then repair. Run affected units, pre-verify, client-test typecheck and
build before sequential Electron-native preparation. On macOS run the exact
guarded recorded effort case, then the complete guarded recorded suite, retries
zero. Retain JSON/log/results, build/profile identity, checksums, workers, counts,
exchange totals and launch guard. Keep reset-prompt fixme explicit. Dispatcher
owns later normal application verification; no fresh provider proof is claimed.

## Open Questions
None. The historical relaunch trigger remains unknown and outside this repair.

## Revisions
2026-10-20: Capture still precedes disposal, but attachment follows disposal so
the same attachment includes classified disposal failures. Each is attempted
independently. Retain retirement proof again in the final attachment, including
when the initial attachment fails. Neither diagnostic cache is an assertion input.

## Validation evidence — macOS arm64, 2026-10-20
Executed clean build `734e6a03dcabc645c65250a93dc87913e7359b87`, normal
profile, `sourceDirty: false`, with main `83a7fc075bfe` merged. The subsequent
evidence commit changes only this plan. Logs and `evidence-summary.json` under
`/tmp/builder-2196/` retain compilation provenance, all seven bundle hashes,
per-input capture provenance, every exchange count and effort lifecycle phases.

| Check | Executed / passed / failed / skipped | Evidence |
| --- | --- | --- |
| Extracted original finalization, causal regression | 10 / 1 / 9 / 0 | `causal-red.log` |
| Initial repaired causal regression | 10 / 10 / 0 / 0 | `causal-green.log` |
| Final proof, isolated-profile and effort ordering units | 33 / 33 / 0 / 0 | `unit-final.log` |
| Final pre-verify, proof file | 13 / 13 / 0 / 0 | `pre-verify-proof-approved.log`, five checks pass |
| Final pre-verify, isolated-profile file | 9 / 9 / 0 / 0 | `pre-verify-retirement.log`, five checks pass |
| Exact guarded effort replay | 1 / 1 / 0 / 0 | `recorded-focused.json`, `.log`, `-results/` |
| Subsequent complete guarded replay | 29 / 29 / 0 / 1 | `recorded-full.json`, `.log`, `-results/` |

Both replay commands used one configured/actual worker, retries zero and zero
forbidden launches. The exact named effort case passed in both: 96 matched
requests / 396 emitted frames / zero remaining. All 29 full-suite exchanges
completed: 773 matched / 3,216 emitted / zero remaining. The sole skip remains
`real claude picks up a saved channel system prompt at Reset session` (existing
fixme, upstream #2436). No new skips, retries, mutations or deadlines were added.
The original scenario retains all 134 expect-rooted calls byte-for-byte, checked
with TypeScript AST traversal (`assertion-audit.json`).

Commands, run sequentially at the native boundary:
```sh
npm test -- e2e/fixtures/effortScenarioProof.test.ts e2e/fixtures/replayProfileRetirement.test.ts e2e/fixtures/effortProof.test.ts
npm run typecheck:client-tests
python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file e2e/fixtures/effortScenarioProof.test.ts
python3 "$AGENTS_REPO_PATH/bin/pre-verify-check" --test-file e2e/fixtures/replayProfileRetirement.test.ts
npm run build
npm run rebuild:electron
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2196/recorded-focused.json node scripts/run-offline-replay.mjs --grep "applied effort, confirmed preference, restart, chat recall and channel creation choice" --retries 0 --reporter=list,json --output=/tmp/builder-2196/recorded-focused-results
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/builder-2196/recorded-full.json node scripts/run-offline-replay.mjs --retries 0 --reporter=list,json --output=/tmp/builder-2196/recorded-full-results
```
Node checks, client typecheck and build passed before `native-preparation.log`;
no native rebuild overlapped replay. Electron commands used approved macOS
execution outside the sandbox. Initial sandboxed pre-verify passed four checks
but could not read labels; its approved rerun passed all five.

Focused JSON SHA-256: `a4243c1744852d7f96f6c0e8d071abd4438d68457b958f9023d096d946c5e279`.
Full JSON SHA-256: `ce5328712c02c6aad7e1c1dab46e391a46253a6c46473199d4db4413b3c45797`.
Unchanged effort input SHA-256:
`999324c7bc7fce3f8a0ce6a6eaf78139ca4cb98b8b9afe79f15bf69704b21866`.
Capture source remains Desktop `00ec821f9380b00cf2dfc0dd4817ee15584106a5`,
daemon `58f46aa56962f75ff4e3d77c0f8ffb0cad00ebbf`, daemon binary SHA-256
`5f5b3b9ce42eda74024637f4929dd720d36c1226ce6e370eb62fbe9e6b22f7c0`, Claude 2.1.280.

### Historical failure and unchanged pass remain separate
The original reports remain untouched in `/private/tmp/desktop-manual-evidence-20261020/`:
`application.json` SHA-256 `7dcafff4a68e74a268a41d27374834e9597fe710f190bc1fd1e1db2a4de9663a`
records 531 executed / 529 passed / 2 failed / 2 skipped, four configured/actual
workers, retries zero. Effort stopped at 36 requests / 147 frames / 60 remaining.
`application-exact-retry.json` SHA-256
`82b50006e70904befed661e0eb6b9cf155915709408600dec97880c2e2ea47d5`
records 2 executed/passed, zero failed/skipped, four configured/two actual workers,
retries zero; effort completed 96 / 396 / zero remaining on the unchanged tree.
Both retain the same input checksum above. The controlled red regression proves
error masking, not the unknown historical relaunch trigger. Captured replay adds
no fresh provider/daemon proof. Linux is outside scope; dispatcher owns subsequent
normal configured application verification.
