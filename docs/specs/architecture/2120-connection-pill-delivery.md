# Connection-pill event delivery

## Files read
- `e2e/connection-pills.spec.ts` → `status`: single consumer; preserve every existing scenario assertion.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, `isTransientContextLoss`: distinguish unavailable inspection from absence.
- `e2e/fixtures/confirmedPush.ts` → `pushConfirmingDelivery`: acknowledged sends skip confirmation, so its contract does not fit.
- `src/preload/index.ts` → `onDaemonEvent`: existing bridge forwards the event and returns observer disposal.
- `src/shared/ipc/events.ts` → `StampedDaemonEvent`: retain typed event payload; test metadata needs no shipping contract change.
- `e2e/fixtures/heldThreadRead.test.ts` → `harness`: execute evaluated callbacks in fault tests.
- `playwright.config.ts`, `vitest.config.ts`: configured Linux workers and test discovery.
- `docs/knowledge/INDEX.md`, `docs/knowledge/features/e2e-harness-context-recovery.md`, `docs/knowledge/features/development-verification.md`, `CLAUDE.md`: mutation recovery requires positive receipt and guarded replay, not visible copy or unavailable reads.

## Context
An Electron evaluation acknowledgement can be lost before or after `webContents.send`.
The unchanged pill text cannot distinguish consecutive disconnected/connecting events.
One useful deliverable is exact, fresh consuming-boundary confirmation for `status`,
including its controlled regression. No product/UI change or ADR is needed.
No overlapping in-flight feature branches touch the planned files.
Sizing: approximately 400 written lines, zero production files, no exported types/components,
one helper export, eight consumer calls, four acceptance behaviors, fewer than ten reject branches.

## Design
Keep `status` in the spec as a small delegate to single-consumer `connectionPillStatus.ts`.
The helper takes the app, page and typed event. A unique test-only marker travels beside
the unchanged event fields through the existing daemon-event channel. A renderer observer
installed before sending matches the full marked event and counts receipts. Previous events,
other hosts, event types and payloads cannot confirm this invocation.
Every send, acknowledged or ambiguous, waits for exactly one renderer receipt.
A synchronous main-process token guard records the send before enqueueing IPC. Recovery
allows a second guarded evaluation only after transient send loss, a zero renderer receipt,
and a conclusive main-process guard absence. A sent-but-not-yet-received event is only polled.
The same token is retained across attempts; a late callback cannot send twice. Considered
reusing the shared push helper, but local adaptation is simpler than widening its contract.

## State + concurrency model
No application stores or subscriptions change. Per-invocation renderer observations are
disposed in `finally`. Main-process sent tokens remain until app teardown to fence late
callbacks. A single five-second deadline bounds evaluation, observation and recovery;
expired send callbacks cannot send. Polling pauses only while observing an unmet condition.

## State transitions and identity reuse
| Event | Regression coverage in `connectionPillStatus.test.ts` |
| --- | --- |
| Acknowledged send with delayed receipt | waits for consuming receipt |
| Lost acknowledgement before / after effect | recovers once / confirms without resend |
| First evaluation executes late, before or after recovery | token prevents duplicate delivery |
| Repeated host and same-copy states / identical payload | fresh token and exact event matching |
| Transient / permanent confirmation loss | recovers / fails without guessing absence |
| Both attempts lost before effect | bounded exhaustion |
| Send or confirmation throws unrelated failure | original failure propagates |
| Success or failure exits invocation | observer disposed; late expired send suppressed |

## Error handling
Only the existing transient-context-loss recognizer permits recovery. Unavailable reads
never authorize replay or success. Duplicate receipt, missing observer, exhaustion and
deadline expiry fail the scenario. Unrelated thrown values propagate unchanged.

## Testing strategy
First extract the original send into the helper and execute it through controlled app/page
evaluators to record red regression evidence. Then run the same callback-executing fakes with
fake timers, counting renderer-boundary deliveries, preserving original application listeners.
Run pre-verify with the helper unit file and build after the final main merge. On Linux run
the named hidden-row case with `--repeat-each=10 --retries=0`, then the complete connection-pill
spec with configured workers. Record counted reports, retry indices and launch fate below.
The complete configured application gate belongs to the dispatcher and remains pending.

## Open Questions
None.
