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
