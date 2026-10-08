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
[renderer geometry to settle](development-verification.md#layout-and-input).

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
[repetition and full-suite evidence](development-verification.md#composer-native-setup-verification)
preserve the menu proof separately.

`readAuthentication` keeps its own private copy of the same tolerance.

