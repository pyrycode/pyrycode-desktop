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

## Validation evidence
Linux x64, candidate `7272d281a2b5e60bea36133437b7b58c0d5ad28a`, containing main
`107558eb26b52f4b98089cbcba4716c3043a9fbe`. No shipping code changed.

- Controlled final regression against the extracted original send: 21 executed,
  1 passed, 20 failed, 0 skipped (`/tmp/builder-2120/fault-baseline-final.log`).
  Repaired callback-executing regressions: 21 executed/passed, 0 failed/skipped;
  the post-merge pre-verify gate reran all 21 successfully. Counted unit evidence:
  `build/dispatcher-tests/unit-40xst2u1/dispatcher.xml`; console report:
  `/tmp/builder-2120/pre-verify.log` (all five checks passed).
- `npx playwright test e2e/connection-pills.spec.ts --grep "connection pills clear and float over hidden rows" --repeat-each=10 --retries=0 --reporter=json`:
  10 executed/passed, 0 failed/skipped/flaky, all retry indices 0. Configured/actual
  workers: 3/3 (`PW_WORKERS` unset). JSON: `/tmp/builder-2120/hidden-ten.json`;
  matching `.stderr` empty.
- `npx playwright test e2e/connection-pills.spec.ts --retries=0 --reporter=json`:
  5 executed/passed, 0 failed/skipped/flaky, all retry indices 0, including the
  hidden-row case. Configured/actual workers: 3/1 (one sequential spec).
  JSON: `/tmp/builder-2120/connection-pills.json`; matching `.stderr` empty.
- All 15 browser `launch-fate` attachments: running at outcome, exit 0,
  null signal, no teardown failures. Both reports have no report-level errors.
- Separate TypeScript check includes both new helper files and preload declarations.
  Existing empty/hidden/saved, selection/recovery, Send, replacement/clearing,
  1280/800 geometry, wrapping and pointer assertions are unchanged.
- `npm run build` passed after the final main merge and pre-verify gate:
  `/tmp/builder-2120/build-final.log`.

The dispatcher-owned complete configured application gate remains pending; it must
include the hidden-row case passing without retry. Focused evidence does not claim
that later result. macOS is outside this Linux ticket's verification scope.

## Revisions
2026-10-19 — Address verifier findings 1 and 2 on `37a858d1`. Both repair the same
per-invocation observer lifetime guarantee; neither is an independent deliverable.
Keep the single-consumer seam and all scenario assertions unchanged. After fetching
origin, no in-flight feature branch overlaps the helper or its regression.

Cleanup now shares the original five-second deadline. Evaluations start only while
budget remains. A confirmed synchronous, idempotent disposal replaces the active
receipt with a completion tombstone and unregisters its listener. Only transient
acknowledgement loss permits polling that disposal again; success requires its
acknowledgement. Unavailable or non-settling disposal fails within the same deadline.
Installation checks both the tombstone and deadline before registering, so callbacks
delayed beyond cleanup or expiry cannot create another observer. Each installed
observer also has a renderer-owned expiry at that deadline, removing itself even
when cleanup cannot execute or acknowledge. Completion tombstones remain until app
teardown, like the existing send tokens. No shipping state or API changes.

The callback-executing harness now injects faults into installation and disposal
as well as receipt inspection, and counts listener removals. Added regressions cover
non-settling disposal before/after effect, already-expired confirmation, installation
and disposal acknowledgement loss before/after effect and delayed execution,
exhausted cleanup, unrelated lifecycle errors, and installation delayed past expiry.
They assert consuming delivery counts and preservation of the application listener.
The written-work forecast remains below 800 lines across the existing change and
this repair; no additional exported type or consumer, acceptance behavior, or
independent error category is introduced.

| Observer lifecycle event | Added regression in `connectionPillStatus.test.ts` |
| --- | --- |
| Cleanup hangs before/after effect, including receipt at 4,900 ms | `bounds non-settling disposal ... within the invocation deadline` |
| Confirmation exhausts the deadline before cleanup | `does not await disposal after the confirmation budget is exhausted` |
| Installation loses acknowledgement before/after effect or executes late | `fences observer installation after ... acknowledgement loss` |
| Disposal loses acknowledgement before/after effect or executes late | `confirms idempotent disposal after ... acknowledgement loss` |
| Disposal remains unavailable through expiry | `fails exhausted disposal acknowledgement loss within the shared budget` |
| Lifecycle evaluation throws an unrelated error or value | `propagates unrelated ... failures` |
| Installation executes after expiry while cleanup was unavailable | `expires a delayed installation when disposal never confirms` |

Rework validation on Linux, working tree based on `37a858d1`, with fetched main
`107558eb` already included: the extended suite against the original helper executed
35 cases, 25 passed and 10 failed for the reported lifecycle defects; the repaired
helper passes all 35 with no failures or skips. Logs:
`/tmp/builder-2120/rework/baseline.log` and `/tmp/builder-2120/rework/unit.log`.
The helper-specific TypeScript check and `npm run build` also passed; logs are
`helper-typecheck.log` and `build.log` in that directory.
Pre-verify completed with four checks passed and the security-label read skipped
because of sandbox name resolution; the successful managed issue read showed no
`security-sensitive` label. Its affected suite executed/passed all 35 cases with
zero failures or skips. Log: `pre-verify.log`; counted XML:
`build/dispatcher-tests/unit-i8jvdffl/dispatcher.xml`.

Fresh browser validation remains pending: the required ten-repeat command stopped
in global setup with Xvfb unable to create sockets inside the sandbox (configured
workers 3, actual workers 0, executed/passed/failed/skipped tests all 0, no retries
or launch-fate records). Retained report: `hidden-ten.sandbox.json` in that directory.
The requested approved rerun did not execute because automatic approval review
reported model capacity failure. Git staging, commit and final merge requests hit
the same service failure. This is not a safety rejection. No new candidate has
been published, and no fresh complete-spec or dispatcher application-gate pass
is claimed. The original evidence above belongs to the previous revision.
Writing the required verdict-answer file under the publishing directory also
failed in approval review without execution. A copy is retained at
`/tmp/builder-2120/rework/rework-answers-2120-37a858d17e3e.md` for recovery.

## Documentation handoff
- Pending documentation stage: `docs/knowledge/features/e2e-harness-context-recovery.md`,
  “Confirmed control resends”: document the local helper's fresh exact renderer
  receipt, guarded resend, shared five-second budget and observer lifetime guarantees.
  Distinguish it from `pushConfirmingDelivery` and retain counted Linux evidence.
