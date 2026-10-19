# E2E harness — inspection-context recovery

Read tolerance and confirmation before resending mutations or native setup. See the [harness overview](e2e-harness.md).

## Tolerating a transient inspection-context loss on reads

`app.evaluate` can raise Playwright's `Execution context was destroyed, most likely because of a
navigation.` while the launched app is demonstrably alive — a `launch-fate` attachment on an observed
failure reported `runningAtOutcome: true`, `exitCode: 0`, no teardown failures. `retries` is `0` off
CI, so one such read turns a green branch red with no `flaky` line.
[#1380](https://github.com/pyrycode/pyrycode-desktop/issues/1380) hit this first, in
`pairing-authentication.spec.ts`'s `readAuthentication` (see [pairing input
screen](pairing-input-screen.md#edge-cases-and-limitations)), and tolerated the exact message on
**reads only**: a mutation must never be blindly replayed — a retried `app.evaluate` that installs a counting
wrapper would wrap the wrapper, and a retried click or pushed frame would double the thing under test.

[#1502](https://github.com/pyrycode/pyrycode-desktop/issues/1502) lifted that rule into a shared
module once a second site hit the identical race. `e2e/fixtures/mainProcessRead.ts` exports
`readMainProcess(app, read)`: it returns what `read` produced, or the sentinel `NOT_YET_AVAILABLE`
when the raised error's message contains `Execution context was destroyed`; any other error,
including a non-`Error` throw, rethrows unchanged and at once. `app` is typed as a one-method
structural evaluator rather than `ElectronApplication`, so `mainProcessRead.test.ts` (vitest, the
`daemonCapabilityGate.ts`/`.test.ts` shape) drives every branch — a completed value including a falsy
`0`, the tolerated message, and a fatal error — with a plain stub, since the race itself does not
reproduce on demand. Bounding the retry stays the caller's job and visible at the call site:
`chat-history-recording.spec.ts`'s confirmed-deletion counter reads pass `{ timeout: 5_000 }`, the
bound #1380 used, so a genuinely dead app still fails inside five seconds instead of waiting out the
test timeout.

`sidebar-add-workspace.spec.ts` also uses `readMainProcess` for the naming-retry
`workspaceAttempts[1]` read. Its five-second poll requires a nonempty string and
retains the successful attempt ID for the foreign/stale-result assertions, avoiding
a second unguarded read. A one-shot injected context-loss error must recover through
a real Electron read; listener installation, clicks and pushed events are never replayed.

`real-daemon-history-on-open.spec.ts` keeps recovery in its local
`mainRead` reader, using the scoped synchronous adapter described below.
A five-second poll returns only when inspection yields an actual value, retaining
that successful value for its caller. The unavailable sentinel never becomes an empty array, a count,
or a successful assertion. Opening-cursor, per-key and settlement checks all use
this reader; listener installation, 205 posts, protected relaunch and native input
remain single actions. Polling availability does not wait for a desired count or
replace the caller's original count assertion.

The shared client scenarios retain that read-only contract. Isolation
read-back also retries only the exact transient error, for five seconds; it still
requires the actual switches, an existing window and hidden state when configured.
The indexed-history lifecycle check uses `readMainProcess` only for the post-close
window count; its close/activate controls and original `toBe(0)` remain unchanged.
`historyQueryEvidence.ts` addresses a separate lost installation acknowledgement:
the installed IPC listener has a main-process identity marker. Inspection must
confirm that exact listener. Only conclusive absence after transient loss permits
a second guarded installation; a late evaluation cannot duplicate the listener or
reset the collected requests. Fatal and inconclusive inspection failures fail setup.
Unit fault cases execute the real callbacks, covering loss before and after effect,
retained observations and unrelated failures. Native input, posts and assertions
remain unchanged. See the [migration inventory](../../client-replay-migration.md).

The [history diagnosis and validation](development-verification-history.md#known-gap-recovery-verification)
distinguishes a failed post-ArrowUp inspection from a rejected history request.
Controlled one-shot loss after reading two requests failed the original observer
while Electron was running; the repaired observer recovered and passed every
original assertion. That proves read recovery without replay, but neither the
upstream Electron/Playwright trigger nor the absent original gate report's
assertion. Changing focus or scroll readiness would address an unproven cause.

### Persistent awaited-inspector loss

`readReplayMainProcess` in `e2e/fixtures/replayNativeStorage.ts` handles a stronger
failure than one lost acknowledgement: Playwright's public main-process
`evaluate` and `evaluateHandle` force `awaitPromise`, which can repeatedly lose
even synchronous results after relaunch. More polling on that path cannot
restore inspection. The [controlled diagnosis and counted Linux evidence](development-verification.md#replay-inspection-after-profile-relaunch)
retain the original failures and same-process awaited/synchronous comparison.

Only the replay SQLite prerequisite and history's `mainRead` use this adapter.
It sends `Runtime.evaluate` through the current ElectronApplication's local
inspector session with `includeCommandLineAPI: true`, `returnByValue: true` and
`awaitPromise: false`. It serializes a client-owned synchronous callback called
with `require('electron')`; daemon-supplied source and scenario mutations must
never enter this path. The SQLite probe owns only a fresh in-memory database.
No session is cached across profile relaunch. Playwright upgrades must preserve
coverage of this internal session access and both relaunch scenarios.

Recognized destroyed-context or collected-promise protocol errors yield
`NOT_YET_AVAILABLE`; unrelated errors propagate unchanged. Valid `false`, `0`,
`null`, `undefined` and `[]` remain values. Callback exceptions and promise results
fail with the static `Replay main-process inspection failed` diagnostic.
History polls availability for five seconds without changing its original value
assertions. The native prerequisite polls unavailable reads every 100ms for five
seconds, then fails `Replay main-process inspection unavailable`; an observed
false probe still produces the existing Electron SQLite rebuild diagnostic.
Observer installation continues to confirm the exact listener identity through
its existing guarded path: recovery neither duplicates listeners nor resets
collected requests. Input, posts and database setup are never blindly replayed.

**Confirmed control resends.** Recovery needs evidence about the mutation's actual effect;
an inconclusive read cannot authorize a resend. For renderer event delivery, watch the
renderer long enough to confirm that the effect has not arrived.
[#1569](https://github.com/pyrycode/pyrycode-desktop/issues/1569) hit this in
`attachment-image-open.spec.ts`'s `pushCompleted`: the push is `app.evaluate` around
`webContents.send` of an `AttachmentUploadEvent`, and a blind retry is wrong because
`reducePendingAttachments` (`ComposerAttach.tsx`) appends every `completed` event with no
dedup by id — a replayed event is a second pending tile and the message carries the
attachment twice. `e2e/fixtures/confirmedPush.ts` exports `pushConfirmingDelivery(push,
delivered, options?)`: on a clean `push()` it returns without ever calling `delivered`; on
the transient context loss (`isTransientContextLoss`, lifted out of `mainProcessRead.ts` so
both modules share one recogniser and one message constant) it polls `delivered()` every
100ms for `confirmWithinMs` (default 2s) and only resends — once — if nothing showed. A
second loss with still nothing seen throws, bounding a dead or permanently context-less app
at about two confirmation windows rather than the test timeout. Any other error, from either
`push` or `delivered`, rethrows unchanged and at once. `delivered` must be phrased as an
absolute expectation — "the strip now holds *n* tiles" — never a before/after difference: a
before-count taken inside the helper could credit a previous push's late-rendering tile to
the current one and skip a resend that was actually needed. `e2e/fixtures/confirmedPush.test.ts`
covers this the way `mainProcessRead.test.ts` covers reads: stubbed `push`/`delivered`, no
Electron, since the race itself does not reproduce on demand. Six of its seven cases use a
shared shrunk-timing options object so real sleeps stay fast; the one case whose outcome
depends on elapsed time — delivery showing on a later poll, inside the window — flaked under
a loaded full suite (\#1647) because the shrunk window and the real poll sleeps were close
enough that load could push the sleeps past the deadline. Fixed by giving that one test its
own options with a seconds-long window instead of switching to fake timers: the window is
only an upper bound, paid when delivery never shows, so a generous one costs nothing when the
probe still turns true on an early read.

`attachment-image-thumbnail.spec.ts` uses the same helper with each upload's
absolute expected pending-tile count. Its document push injects context loss
after `webContents.send` has delivered the completion; exactly two pending tiles
and one document in the resulting bubble prove that confirmation avoided a
duplicate. A pre-push count delta could mistake the preceding upload's delayed
tile for the current completion and is not an equivalent delivery check.

**Connection-pill delivery.** `status` in `connection-pills.spec.ts` delegates only
to [`confirmConnectionPillStatus`](../../../e2e/fixtures/connectionPillStatus.ts).
Disconnected and connecting deliberately share pill copy, so unchanged text or a
main-process send marker cannot prove that the intended transition reached the
renderer. Before sending, the helper installs an observer through the existing
`window.pyry.onDaemonEvent` bridge. Each invocation adds a fresh test-only UUID
beside the unchanged event fields; the observer compares the full serialized event,
including token, host, type and payload, and requires exactly one receipt even when
the send was acknowledged. Earlier or identical events cannot confirm a new call.
The marker stays in the test's IPC injection; no daemon-wire or shipping API changes.

At most two guarded send evaluations share one five-second deadline with observer
installation, receipt polling and confirmed disposal. Only transient send
acknowledgement loss, a successful zero-receipt read and conclusive absence of the
main-process token authorize the second evaluation. Each synchronous send callback
claims that token before `webContents.send`; recovery and a late first callback
cannot both deliver it. Tokens remain until app teardown, and expired callbacks
cannot send. A claimed send awaiting renderer receipt is only polled. Unavailable
renderer or main-process confirmation never establishes absence or success;
duplicate receipt, missing observer, exhaustion and unrelated failures fail the case.

This contract is stronger than `pushConfirmingDelivery`: that shared helper returns
after an acknowledged push and treats transiently unavailable confirmation as
“not seen yet,” eventually allowing another push. Wrapping `status` with it unchanged
would neither confirm every transition nor require conclusive absence before resend.
The stricter adaptation remains local to this single consumer.

Cleanup also needs acknowledgement recovery. In `finally`, synchronous idempotent
disposal replaces the receipt with a completion tombstone before unregistering its
listener. Only transient disposal acknowledgement loss permits polling that mutation
again; success requires acknowledged disposal within the original deadline. A hang,
unavailable cleanup through expiry or exhausted budget fails, even after receipt.
Installation checks the tombstone and deadline before registering, preventing a late
callback from creating an observer after cleanup. Each installed observer also owns
a renderer expiry timer at that deadline, so its listener is removed even if disposal
cannot execute or acknowledge. Tombstones remain until app teardown; application
listeners are preserved. Bounding only the send and read loop would miss both a
cleanup hang and a listener installed after cleanup completed.

[`connectionPillStatus.test.ts`](../../../e2e/fixtures/connectionPillStatus.test.ts)
executes the actual serialized callbacks with fake timers and an independent
application consumer. Faults cover installation, sends, renderer/main-process reads
and disposal, including loss before/after effect, late execution, non-settling calls,
same-copy states and mismatched payloads. Consuming-boundary delivery counts and
listener removals establish single delivery and cleanup; a send counter alone cannot.
The [accepted Linux verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2123#issuecomment-6260433414)
records the lifecycle baseline at **35 executed, 25 passed, 10 failed, 0 skipped**,
then **35 executed/passed, 0 failed/skipped** after repair. The original-send baseline
separately recorded **21 executed, 1 passed, 20 failed, 0 skipped**; neither controlled
baseline identifies the upstream Electron/Playwright trigger.

Retained Linux x64 browser evidence at `abae1d274a28656e61719f743e47ac6004b08d63`
(reviewed head `37d64c3d` adds evidence documentation only):

| Command | Executed / passed / failed / skipped | Configured / actual workers |
| --- | --- | --- |
| `npx playwright test e2e/connection-pills.spec.ts --grep "connection pills clear and float over hidden rows" --repeat-each=10 --retries=0 --reporter=json` | 10 / 10 / 0 / 0 | 3 / 3 |
| `npx playwright test e2e/connection-pills.spec.ts --retries=0 --reporter=json` | 5 / 5 / 0 / 0 | 3 / 1 (one sequential spec) |

The named hidden-row case is present and passed in both reports. `PW_WORKERS` was
unset; every retry index is 0, with no flaky results or report-level errors and empty
matching `.stderr`. Reports remain at `/tmp/builder-2120/recovery/hidden-ten.json`
and `connection-pills.json`. All 15 `launch-fate` attachments record running at
outcome, exit 0, null signal and no teardown failures.

The supplied dispatcher unit gate records **9,597 executed/passed, 0 failed,
3 skipped**; it explicitly includes passing `does not await disposal after the
confirmation budget is exhausted`, `fails exhausted disposal acknowledgement loss
within the shared budget` and `expires a delayed installation when disposal never
confirms`. The separate complete configured application gate (`npx playwright test
--reporter=json`) records **506 executed, 505 passed, 1 failed, 5 skipped**, three
configured/actual workers, no flaky results and every retry index 0. Its hidden-row
case is present and passed at retry 0 with clean launch-fate. The retained complete
run remains failed: the accepted verdict records the unrelated history-writer-native
failure tracked in [#2125](https://github.com/pyrycode/pyrycode-desktop/issues/2125)
as accepted after its dispatcher rerun. A focused pass does not replace that run,
and no overall verifier gate pass is recorded in the supplied gate report.

Empty/hidden/saved rows, selected-host state and recovery target, disabled Send,
replacement/clearing, 1280/800 geometry, wrapping and pointer pass-through assertions
remain intact without forced input, new skips, test retries, fixed readiness sleeps
or larger timeouts. These are retained results, not fresh documentation-stage tests;
macOS is outside this Linux ticket's verification scope, and no live-provider
acceptance is required. See the [plan](../../specs/architecture/2120-connection-pill-delivery.md)
for revision-specific commands and evidence history.

Handler installation has a different confirmation boundary. In
[`localListFailure.ts`](../../../e2e/fixtures/localListFailure.ts), the single-consumer
`installUnreadableLocalList` helper synchronously registers the unreadable-list wrapper
and publishes its identity in a main-process test marker. Every installation is followed
by a read comparing that marker with the actual registered handler. Context loss after
installation can hide a successful mutation acknowledgement, so retrying the installation
blindly could wrap the wrapper. Only explicit absence after transient installation loss
permits one further guarded installation; a late callback sees the marker and cannot
replace the wrapper twice. `readMainProcess` wraps only the inspection. Recovery permits
at most two installations and three inspections per installation; exhausted or inconclusive
reads fail setup, and fatal errors and non-`Error` throws propagate unchanged. Moving the
mutation to `onLaunched` alone would not resolve ambiguous acknowledgement.

Before reload, `chat-history-recording.spec.ts` requires the real renderer IPC bridge to
return exactly `{ status: 'error', code: 'unreadable' }` for the saved host and attaches
installation, inspection and context-loss counts as `local-list-failure-setup`. Only
`readList` is overridden; other operations delegate to the captured handler and pairing
data stays intact. The scenario retains one saved host, its single adjacent notice reading
“Could not read saved chats on this device.”, no conversation rows or open thread, and
the 800-pixel capture. See [local-list failure behavior](chat-history-results.md#results-and-failure-preservation).

[`localListFailure.test.ts`](../../../e2e/fixtures/localListFailure.test.ts) executes the
actual callbacks against an IPC registration fake to distinguish loss before and after
effect, inspection loss, permanent failure, late execution and fatal failures. The
[diagnosis and regression evidence](https://github.com/pyrycode/pyrycode-desktop/issues/1794#issuecomment-6007858652)
records 11 failures in 13 cases against the old single-evaluation setup and all 13 passing
with confirmation. The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1802#issuecomment-6008106654)
confirms the named local-list scenario passed ten times with retries disabled (10 executed,
10 passed, 0 failed, 0 skipped) and in the complete recording spec (7 executed, 7 passed,
0 failed, 1 existing macOS-only skip on Linux). The dispatcher default-tier gate also
includes that scenario passing (286 executed, 286 passed, 0 failed, 4 skipped).
These passes supplement the deterministic recovery proof; the reason Electron lost its
inspection context remains unproven. The original evaluation error and running-at-outcome
launch-fate do not establish renderer navigation, an app crash or completed installation.

### Disconnected-delivery observations and cleanup

[`disconnectedDelivery.ts`](../../../e2e/fixtures/disconnectedDelivery.ts) is a
single-consumer helper for `disconnected-message-delivery.spec.ts`. Socket-write
observations use `readDeliveryObservation`: at most three `readMainProcess` attempts,
then failure if every read is unavailable. Pending payloads use a five-second poll
that retains the successful payload snapshot for the delivery assertions. The
unavailable sentinel never becomes an empty array, zero or a passing assertion;
unrelated errors propagate unchanged. Installation, forwarding, resume, clicks
and frame delivery remain single effects outside read recovery.

Installation runs inside `withDeliveryCleanup` so a lost installation acknowledgement
still reaches cleanup without reinstalling. Restoration releases the held pairing
read and restores `fs.readFile`, `WebSocket.prototype.send` and the original ordered
`pyry:command` listener sequence. A retained restored marker makes late restoration
callbacks no-ops: they cannot duplicate listener registration or forward held messages.
Read-only confirmation checks the restored flag, released gate and all hook/listener
identities; an absent installation marker needs no restoration.

Cleanup permits at most two guarded restoration evaluations, each followed by at
most three confirmation reads, without sleeps. Only transient acknowledgement loss
followed by conclusive unrestored state permits recovery. Confirmed restoration
succeeds even when its acknowledgement was lost; unavailable confirmation never
authorizes replay or success. Exhausted reads/recovery, acknowledged mismatch and
unrelated errors fail cleanup. App-first closure and unconditional `launch-fate`
attachment remain owned by `launchPairedApp`.

When cleanup succeeds, the exact original thrown value survives. When both the
scenario and cleanup fail, `withDeliveryCleanup` retains both originals in
`AggregateError.errors` **and includes both original stacks in its message**.
Playwright serializes an Error's message and filtered stack without
`AggregateError.errors`; retaining the objects alone can hide the original assertion
in browser failure output. Cleanup failure also fails an otherwise passing scenario.

[`disconnectedDelivery.test.ts`](../../../e2e/fixtures/disconnectedDelivery.test.ts)
executes the actual evaluated callbacks against fake IPC, file and socket boundaries.
Coverage distinguishes context loss before/after restoration, transient/exhausted
confirmation, finite recovery, fatal errors and acknowledged mismatch. It also checks
installation loss before/after effect, successful/failed resume, gate release,
listener identity/order, late restoration without duplicate listeners or held-command
replay, successful falsy reads, and visibility of both original failures.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2055#issuecomment-6213389616)
dated 2026-10-16 confirms the following Linux x64 evidence.
Controlled baseline: **20 executed, 6 passed, 14 failed, 0 skipped**;
final fault coverage: **20 executed/passed, 0 failed/skipped**, with all 20 also
present and passed in the unit gate (**9,123 executed/passed, 0 failed, 3 skipped**).
A separate reporting regression failed before both original stacks were included.
Logs remain in `/tmp/builder-2054/fault-before.log`, `reporting-before.log` and
`fault-final.log`.

| `accepted disconnected messages drain and settle:` mode | Focused executed/passed/failed/skipped | Complete-suite executed/passed/failed/skipped |
| --- | --- | --- |
| `automatic` | 10 / 10 / 0 / 0 | 1 / 1 / 0 / 0 |
| `explicit` | 10 / 10 / 0 / 0 | 1 / 1 / 0 / 0 |
| `terminal` | 10 / 10 / 0 / 0 | 1 / 1 / 0 / 0 |

Focused `--repeat-each=10 --retries=0` evidence totals **30 executed/passed,
0 failed/skipped/flaky**, every retry index 0, retained in
`/tmp/builder-2054/focused-final.json` with empty matching `.stderr`.
The dispatcher complete configured fake suite (`npx playwright test --reporter=json`)
at `75c6e5c9b59cf4a1c9243cfc68c432fa208e47a1` totals **435 executed/passed,
0 failed, 3 existing macOS-only skips, 0 flaky**;
the table confirms each named mode is present and passed separately from the other
432 passes. Both clipboard/parallel projects, two configured/actual workers and
zero retries were unchanged on this host; the historical failing host used four
workers. This satisfies execution at the existing configuration, without claiming
a new four-worker run. Retained evidence is
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2054_8.log` and matching
stderr (Vite deprecation warning only). These completed results supersede the
builder plan/PR's pending full-suite status.

All 30 focused and three complete-suite delivery `launch-fate` attachments report
running at outcome, exit 0, no signal and no teardown failures. Neither report has
report-level errors or failed cases. Delivery, socket-write, queue, text/identity/order,
settlement, duplicate-replay barrier, cross-host isolation and visual assertions remain
intact, without new skips, test retries, arbitrary sleeps or larger timeouts.
macOS is outside this ticket's verification scope; no live-Claude acceptance is required.

The [historical failure and artifact limits](https://github.com/pyrycode/pyrycode-desktop/issues/2054#issuecomment-6212772434)
remain separate: during #2044 on Linux at `0ffe0b12fafa366a43c98990daa1169dffdb83e1`,
the complete suite recorded **435 executed, 434 passed, 1 failed, 3 skipped**,
with four workers, both projects and zero retries. The automatic case failed at
`__delivery1853.restore()`; the packaged protected-storage check passed. Original
reported paths are `/tmp/builder-2044-final-playwright.json`, matching `.stderr`,
and `test-results/disconnected-message-deliv-a6f05--drain-and-settle-automatic-parallel/error-context.md`.
The retrieved builder bundle contained a truncated log tail and empty pointers,
corroborating the failure and unchanged subsequent passes without those original
artifacts. Controlled faults prove bounded acknowledgement recovery and reporting;
they do not identify the upstream Electron/Playwright trigger, establish whether
the failed cleanup executed, or reveal an earlier assertion it might have concealed.

### Held thread read registration

The resumed restore-overlap case in `thread-activation.spec.ts` uses the single-consumer
[`installHeldThreadRead`](../../../e2e/fixtures/heldThreadRead.ts) in `onLaunched`, after
window loading and before opening the conversation. Window readiness cannot establish
whether a rejected installation evaluation actually replaced `pyry:chat-history`.
The synchronous callback publishes a marker containing the original handler, wrapper
identity and phase. A separate `readMainProcess` inspection must confirm that the marker
is armed and the actual registered IPC handler is that wrapper before setup succeeds.

Recovery allows at most two installation evaluations, each followed by at most three
inspection reads, without sleeps. Only transient installation loss followed by conclusive
marker absence permits the second guarded installation. Unavailable inspection never
authorizes replay or success; exhausted confirmation, acknowledged absence and changed
registration fail. Fatal errors and non-`Error` throws become bounded, client-owned
installation/inspection error strings, without arbitrary inspector messages or causes.
The launch hook itself is never retried.

Existing marker identity guards late installation callbacks, including after release,
so they cannot double-wrap registration, reset `heldThreadReads` or rearm a completed hold.
The first `readThread` claims the hold before awaiting the original result; other operations
and concurrent later reads delegate. Once the original result is available, the held read
increments the observation and waits for `test:release-thread-read`. Release restores the
original registered handler before returning the captured result and retains the released
marker. The held request owns one release listener; fixture teardown closes the app and
fake services on failure.

[`heldThreadRead.test.ts`](../../../e2e/fixtures/heldThreadRead.test.ts) executes the actual
setup and inspection callbacks against an IPC registration fake with release listeners.
The [verifier evidence](https://github.com/pyrycode/pyrycode-desktop/pull/2037#issuecomment-6206339154)
records 13 executed, 0 passed, 13 failed, 0 skipped against the extracted original setup,
then 13 executed/passed, 0 failed/skipped with confirmation. Coverage includes loss before
and after effect, lost/exhausted confirmation, finite absence, late execution, concurrent
delegation, restoration and content-free fatal rejection. Logs are
`/tmp/builder-2035/held-read-{before,after}.log`.

Linux x64 reports at candidate `4cd97dacce6f64f4d46e80095c011886c1ddd62a` retain the
unchanged named case `restore overlapping live content retains complete progress across
an interrupted catch-up and epoch replacement`: `/tmp/builder-2035/named.json` records
1 executed/passed, 0 failed/skipped. `/tmp/builder-2035/group.json` records 17 executed/passed,
0 failed/skipped across the complete `thread-activation.spec.ts`, `history-native.spec.ts`
and `chat-history-recording.spec.ts` group. Both configured two workers and zero retries;
the named run used one actual worker and the group used two. Matching `.stderr` files
are empty, with no top-level report errors or fake-setup failure attachments. Include
`indexed-history-lifecycle.spec.ts` in that group when #1975 lands; it was absent from the
reviewed main revision and tree. macOS is outside this ticket's verification scope;
no real-Claude acceptance is required.

The group's `held-thread-read-setup` attachment records
`{ installationAttempts: 1, inspectionAttempts: 1, contextLosses: 1 }`: registration was
confirmed after a lost acknowledgement without reinstalling. Its `launch-fate` attachments
cover 18 launches, all exit 0, no signals or teardown failures; the resumed app remained
running at outcome and closed cleanly. The named run records the same setup counts with
zero losses. At `02e7034ad859a672ef9a75128f5d126192826e46`, the complete Linux default-tier
gate records 432 executed/passed, 0 failed, 10 skipped, two actual workers and zero retries;
the named case is present and passed, with one installation, one inspection, zero losses
and clean launch fate. Its exact checkpoint 20, overlap retained once, complete progress
21 after interruption, replacement epoch, stale-content exclusion and no-legacy-request
assertions and positive receipt barriers remain intact. Controlled failures and the
observed recovered acknowledgement establish the confirmation mechanism; the upstream
Electron/Playwright trigger behind context destruction remains unknown.

### Saved traversal diagnostics

The four saved-traversal variants in `thread-activation.spec.ts` install both the
held-read wrapper above and
[`installSavedTraversalReads`](../../../e2e/fixtures/savedTraversalReads.ts) in
`onLaunched`, before opening the conversation. A lost setup acknowledgement may
follow successful registration: blindly adding another `pyry:diagnostic` listener
would double-count restores or reset `savedReads`. The callback publishes its
listener as `__savedTraversalReads`; repeated or late callbacks preserve that
identity and counter. Read-only inspection confirms that exact listener occurs
once among the actual diagnostic listeners.

Setup permits at most two installation attempts, each followed by up to three
inspection attempts. Only transient acknowledgement loss plus confirmed absence
permits another installation. Exhausted/unavailable inspection, acknowledged
absence, changed or missing registration and unrelated errors fail setup.
Both `savedReads` and `heldThreadReads` use `readMainProcess` inside five-second
polls. The release emission remains single-shot; all history, scrolling, anchor
and request assertions remain intact. Each case attaches `saved-traversal-setup`
with separate `held` and `saved` installation, inspection and context-loss counts.

[`savedTraversalReads.test.ts`](../../../e2e/fixtures/savedTraversalReads.test.ts)
executes the serialized callbacks against an IPC fake, covering loss before/after
effect, lost/exhausted confirmation, late/repeated setup, absent/changed listeners
and fatal errors. The [accepted Linux verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/2105#issuecomment-6255574509)
confirms all 12 cases passed, none skipped. The dispatcher gate report counts the
unit run as 9346 executed/passed, 0 failed, 3 skipped.

The complete application run recorded 499 executed, 498 passed, 1 failed and
5 skipped. All 20 thread-activation cases, including “unchanged saved traversal
scrolls independently while server reply is held” and all four saved-traversal
variants, were present and passed without retries. Each variant's setup attachment
records one installation, one inspection and zero context losses for each helper;
launch-fate records show clean exits without teardown failures. The unrelated
history-on-open failure remains recorded in #2112; a separate dispatcher rerun
executed/passed 3 tests, 0 failed/skipped, including “opening asks once and only
trusted upward input asks for subsequent pages”. The dispatcher accepted that
rerun; it does not erase the original failure. These are retained Linux results,
not fresh documentation runs; macOS is outside this ticket's verification scope.
The upstream Electron/Playwright trigger remains unknown.

### Native window setup

Native window setup has two independently observable fields. The single-consumer
[`configureComposerWindow`](../../../e2e/fixtures/composerWindowSetup.ts) serves only
the long-model cases in `composer-options-clamp.spec.ts`. Its control callback checks
outer size and zoom separately before setting either; partial application or a late
original callback cannot repeat an already-applied setter. It then reads outer size,
content size and zoom through `readMainProcess`, returning content dimensions only
when outer size and zoom match. Mutations never enter the read-only helper.

Recovery permits at most two control evaluations, each followed by at most three
inspections, 100ms apart. Matching state succeeds immediately. Only transient control
loss plus a **final conclusive mismatch** permits the second guarded control. An earlier
mismatch cannot authorize resend if the final inspection is unavailable. An acknowledged
control with persistent mismatch fails without resend. Permanent inspection loss,
exhaustion and missing windows fail; unrelated errors and non-`Error` throws propagate
unchanged. Confirm native state before waiting for
[renderer geometry to settle](development-verification-layout-and-input.md#layout-and-input).

The [composer diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1822#issuecomment-6030141371)
records the initial resize evaluation failing after 1268ms at `e0b178ce89`, before menu
assertions, while launch-fate showed the app alive with exit code 0 and clean teardown.
The focused retry-0 rerun passed in 2407ms. The direct mutation setup aborted on lost
inspection acknowledgement; whether that resize executed and the upstream
Playwright/Electron trigger remain unproven. Neither a product layout failure nor an
external prerequisite is established.

[`composerWindowSetup.test.ts`](../../../e2e/fixtures/composerWindowSetup.test.ts)
executes the actual serialized callbacks against fake native state, rather than
substituting confirmation answers. Coverage includes loss before/after effect, read loss, partial and late
execution, final-inconclusive rejection, finite exhaustion and fatal failures. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1838#issuecomment-6030292632)
confirms all 17 fault tests present and passed (17 executed, 0 failed, 0 skipped) in
the unit gate (9,208 executed/passed, 0 failed, 3 skipped). Fault injection proves
recovery semantics, not reproduction of the upstream trigger. Counted browser
[repetition and full-suite evidence](development-verification-layout-and-input.md#composer-native-setup-verification)
preserve the menu proof separately.

The single-consumer [`focusVisibleTailWindow`](../../../e2e/fixtures/visibleTailFocus.ts)
serves `visible-tail-read.spec.ts`. Each synchronous control callback finds the live
window and independently checks `isVisible()` before `show()` and `isFocused()` before
`focus()`. Partial or late execution cannot repeat completed fields. Every control
evaluation is followed by up to three read-only inspections through `readMainProcess`,
without sleeps. Both visible and focused must be confirmed; only transient control
loss plus a **final conclusive mismatch** permits the second and last guarded attempt.
An earlier mismatch followed by unavailable inspection cannot authorize resend.
Unavailable final confirmation, acknowledged mismatch, exhaustion and missing windows
fail setup; unrelated errors and non-`Error` throws propagate unchanged.

Native confirmation does not establish document readiness. The consuming `focus`
still deletes its deliberate `document.hasFocus` override, polls genuine
`document.hasFocus()` and only then dispatches the existing focus notification.
Clicks, daemon frames, scenario actions and observer installation are never replayed.
[`visibleTailFocus.test.ts`](../../../e2e/fixtures/visibleTailFocus.test.ts) executes
the actual control/inspection callbacks against native-state fields, covering loss
before/after effects, partial/late execution, repeated setup, unavailable reads,
final-inconclusive rejection, exhaustion, missing windows and fatal/non-`Error` throws.
See [distinct historical failures and counted Linux proof](development-verification-layout-and-input.md#visible-tail-native-acknowledgement-verification)
for the original/repaired fault results and repetition/spec/full-gate evidence.

`readAuthentication` keeps its own private copy of the same tolerance.
