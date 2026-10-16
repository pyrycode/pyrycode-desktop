# Disconnected-delivery inspection and cleanup

## Files read
- `e2e/disconnected-message-delivery.spec.ts` → the three delivery modes and `__delivery1853`: retain every delivery, replay, isolation and visual assertion.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `NOT_YET_AVAILABLE`, `isTransientContextLoss`: existing read-only error discrimination.
- `e2e/fixtures/mainProcessRead.test.ts` → read sentinel and fatal error tests: mirror the evaluator seam.
- `e2e/fixtures/heldThreadRead.ts` → `installHeldThreadRead`: guarded effect followed by separate bounded confirmation.
- `e2e/fixtures/launchPairedApp.ts` → `test`: fixture already owns app-first closure and unconditional launch-fate attachment.
- `docs/knowledge/INDEX.md`, `CLAUDE.md`, `docs/knowledge/features/development-verification.md`, `docs/knowledge/features/e2e-harness-context-recovery.md`: test boundaries, retained evidence and confirmation-before-recovery rules.
- `package.json`, `vitest.config.ts`, `playwright.config.ts`: unit/helper discovery and unchanged browser concurrency/projects/retries.

## Context
Raw cleanup inspection can lose its acknowledgement before or after restoration and can replace an earlier assertion error. Retrieved #2044 evidence corroborates the failure and subsequent unchanged passes, but does not establish the upstream inspector trigger or whether the failed cleanup executed. Deterministic injected faults will prove recovery semantics separately. No production change or ADR is needed.

## Design
Extract the existing installation callback into single-consumer `e2e/fixtures/disconnectedDelivery.ts` so fault tests execute the same callbacks as Electron. Installation, forwarding, resume, clicks and frame delivery remain single effects. Add a restoration guard and a read-only confirmation checking the original listener sequence, `fs.readFile`, WebSocket send identity and released pairing gate. Restoration never forwards pending commands. Retain the marker after restoration so late callbacks cannot repeat listener registration.

`readDeliveryObservation<T>(app, read): Promise<T>` uses `readMainProcess` for at most three inspection attempts; unavailable values never become defaults. Pending payload polling has a visible five-second bound and retains its successful payload snapshot for delivery assertions. Socket counters use bounded observations.

`withDeliveryCleanup(app, body): Promise<void>` runs the scenario and cleanup, preserving the original thrown value unchanged when cleanup succeeds. When both fail, throw an `AggregateError` containing both originals. Cleanup permits at most two guarded restoration evaluations, each followed by at most three read-only confirmations. Only a lost mutation acknowledgement followed by a conclusive unrestored state authorizes recovery. Exhausted/unavailable confirmation never authorizes replay or success; acknowledged mismatch and unrelated errors fail. Missing installation needs no restoration. Installation is inside the cleanup scope and is never retried.

One deliverable, five observable acceptance criteria, no production files, no new exported types/components/stores, one consumer and approximately 450 written lines including plan/tests. No remote feature branch overlaps the planned three implementation/test files at planning time. The written design stays below all sizing limits.

## State + concurrency model
The existing main-process gate owns pending IPC commands and socket-write observation. Installation and restoration callbacks are synchronous; the pairing read is the only held async task. Resume settles it once; cleanup also releases it and restores hooks before fixture app closure. No new subscriptions or renderer state. The retained restored marker guards repeated or late restoration callbacks.

## State transitions and identity reuse
| Event | Unit coverage in `disconnectedDelivery.test.ts` |
| --- | --- |
| Inspection loss before restore effect | recovery only after confirmed unrestored state |
| Inspection loss after restore effect | confirmation succeeds without a second mutation |
| Confirmation read loses context | bounded read recovery |
| All confirmation reads unavailable | exhaustion fails without mutation replay |
| Both mutation acknowledgements lost before effect | finite recovery fails |
| Repeated/late restoration | no duplicate listeners or forwarded held messages |
| Resume then restore, including failed resume | original hooks and settled gate remain restored |
| Unrelated mutation/read error or acknowledged mismatch | fatal rejection without recovery |
| Earlier assertion and cleanup failure | both original errors retained |
| Installation fails before/after effect | cleanup handles absence or installed hooks without reinstalling |

## Error handling
Recognize only `isTransientContextLoss`; all other errors propagate. Recovery exhaustion raises a specific cleanup/inspection error. Primary and cleanup errors are retained together, with no swallowed cleanup failure on an otherwise passing scenario. There are no production I/O contracts or UI errors to change.

## Testing strategy
- Write fault tests first and observe failure before implementation. Use a fake Electron IPC emitter, fs and WebSocket boundaries that execute the actual evaluated callbacks, injecting errors before/after invocation; positively assert restoration and gate release, listener identity/order, and no command replay.
- Run helper vitest tests, then Linux `disconnected-message-delivery.spec.ts --repeat-each=10 --retries=0`, preserving all three modes, assertions and launch-fate attachments. Record per-mode executed/passed/failed/skipped counts and raw reports outside the worktree.
- After final main merge, run install, pre-verify (including full units) and build. Dispatcher owns the complete configured fake suite, with the original workers, projects and zero retries; its three named mode results remain pending until that gate executes. macOS is outside this ticket's verification scope. No live-Claude tests change.

## Open Questions
None. The upstream cause of context loss remains unconfirmed; this repair proves bounded acknowledgement recovery rather than reproducing that cause.

## Revisions
2026-10-16: Playwright's `serializeError` reports an Error's message and filtered stack, without `AggregateError.errors`. A controlled assertion failed when the helper only retained the two original objects. The combined error now includes both original stacks in its message as well as retaining both objects, so browser failure output exposes both failures. No delivery behavior changes.

## Validation evidence
- Linux, 2026-10-16, after merging main at `008f468f95acc70a568b4ea41f5ade9e5cc80927`: pre-verify passed all five checks, including 9,070 passed unit tests and three existing skips; final build and a separate strict helper/test typecheck passed.
- Controlled baseline: 20 executed, 6 passed, 14 failed against extracted original behavior (`/tmp/builder-2054/fault-before.log`). The reporting assertion separately failed with an unformatted aggregate (`reporting-before.log`). Final controlled coverage: 20 executed/passed, 0 failed/skipped (`fault-final.log`); the full unit report also includes all 20 passing.
- Final focused run: `npx playwright test e2e/disconnected-message-delivery.spec.ts --repeat-each=10 --retries=0 --reporter=json`, unchanged projects and configured two workers on this host. Automatic, explicit and terminal each executed/passed 10, failed/skipped 0; total 30 executed/passed, 0 failed/skipped/flaky, every retry index 0. All 30 launch-fate attachments report running at outcome, exit 0, no signal and no teardown failures; no report-level errors. JSON and empty stderr retained at `/tmp/builder-2054/focused-final.json` and `/tmp/builder-2054/focused-final.stderr`. The earlier focused run independently recorded the same 30/30 result in `focused.json`.
- Gate and build evidence: `/tmp/builder-2054/pre-verify.log`, `units-final.json`, `build-final.log`, `helper-typecheck.log`. The dispatcher-owned complete configured fake suite remains pending; its three mode outcomes must be reported separately from unrelated failures. macOS is outside this ticket's verification scope. These passes do not identify the upstream inspection-context-loss trigger.
