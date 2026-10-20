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
