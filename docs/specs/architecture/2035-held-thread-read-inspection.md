## Files read
- `e2e/thread-activation.spec.ts` → restore-overlap scenario: held protected read, release ordering and exact progress/epoch assertions.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchControl.onLaunched`: runs after loaded window, before conversation activation; unchanged.
- `e2e/fixtures/localListFailure.ts` and its tests → `installUnreadableLocalList`: registration confirmation and guarded late execution analogue.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `isTransientContextLoss`: only inspection reads tolerate unavailable results.
- `docs/knowledge/features/e2e-harness-context-recovery.md` → Tolerating a transient inspection-context loss on reads: acknowledgement does not establish whether mutation ran.
- `docs/knowledge/features/development-verification.md`, `docs/knowledge/INDEX.md`, `CLAUDE.md` and shared working practice: test boundaries and scoped Linux verification.

## Context
The resumed application's setup currently aborts on an ambiguous inspector result, regardless of whether IPC replacement executed. Loading the window already precedes installation. Controlled injection can demonstrate this acknowledgement ambiguity without claiming to reproduce the upstream inspector trigger. Retrieved #1975 evidence retains the original failure and subsequent unchanged passing rerun. No ADR or product change is needed.

## Design
Extract only this scenario's installation into `e2e/fixtures/heldThreadRead.ts`, exporting `installHeldThreadRead(app): Promise<evidence>`. Keep the consumer and its Vitest regression together. Do not retry `onLaunched`, change its ordering or modify any history assertion.

The synchronous installation callback captures the original handler and publishes a main-process marker identifying the wrapper, original handler and release state. Existing marker identity gates all subsequent installation callbacks, including callbacks arriving after release. Initialize `heldThreadReads` only on first installation. Delegate every operation to the original handler; claim only the first `readThread`, await its original result, increment the observation, wait for the existing release event, then restore the original before returning the result. Concurrent later reads delegate without being held.

After each installation evaluation, inspect actual registered handler identity against the marker through `readMainProcess`. Confirmed active registration succeeds. Transient installation loss followed by conclusive absence permits one further guarded evaluation. An unavailable inspection never authorizes replay or succeeds. At most two installation evaluations and three inspection reads per evaluation; no sleeps or test-timeout changes. Return numeric installation/inspection/loss evidence and attach it in the scenario.

## State + concurrency model
Only test-process setup counters and a main-process marker; no production store changes. Installation and inspection callbacks are synchronous. The held request owns one release listener. Release restores registration before returning its captured result; app teardown owns cleanup if setup/test fails. A persistent released marker prevents a late installation from rearming the hold.

## State transitions and identity reuse
| Event | Regression in `heldThreadRead.test.ts` |
| --- | --- |
| Clean install and release | confirms registration, delegates and restores before returning |
| Loss before effect | confirms absence before retry |
| Loss after effect | confirms without reinstalling |
| Lost inspection | retries reads only; exhausted confirmation fails |
| Repeated absence | finite installation exhaustion |
| Late original callback, including after release | preserves registration identity and observation count |
| Concurrent reads | holds only one read and delegates the next |
| Missing/replaced registration or unrelated fatal failure | rejects without replay |

## Error handling
Use bounded client-owned error strings for setup failures, without arbitrary inspector messages or causes. Only `isTransientContextLoss` permits recovery; fatal errors and non-Error throws fail immediately with a static installation/inspection classification. Marker mismatch and acknowledged absence fail. Existing fixture teardown closes the app and fake services.

## Testing strategy
- Execute actual serialized installation/inspection callbacks against an IPC registration fake, including release listeners. First run these against the extracted original setup and record the expected failures; then implement confirmation and rerun.
- Preserve all exact history assertions, receipt barriers and release action in the named Playwright case. Run it alone and the required thread-activation/history-native/chat-history-recording group with two workers, zero retries; add indexed-history-lifecycle if present on main.
- Inspect JSON counts, launch-fate and setup attachments. Record revision/configuration and before/after evidence in the PR. Pre-verify and build after final main merge; dispatcher owns the complete default tier. No live Claude or macOS checks required.

## Open Questions
None. The cleaner shape is the existing guarded-registration analogue scoped to one consumer, rather than a general launch retry mechanism.

## Size check
One independently verifiable setup-reliability deliverable; approximately 400 written lines, one exported function, one consumer, four observable criteria and fewer than ten classified recovery/reject branches. No overlapping remote feature branches touch the planned files at planning time.
