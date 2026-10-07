# Test tier proofs

Detailed unit, static-render and mounted fake-transport verification guidance and recorded evidence.
See [development verification](development-verification.md#what-each-test-tier-proves) for the
shared tier boundary and received read-mark coverage.

Permission choice coverage at `1cec0874` separates controller/static proofs from native interaction.
The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1820#issuecomment-6025856890)
confirms all 13 scoped fake scenarios present and passed: permission paths 7, offline responses 3,
resolution notices 3, with 0 failed/skipped. Full run: 305 executed, 304 passed, 1 unrelated flaky
failure, 4 skipped; selected rerun: 1 executed/passed, 0 failed/skipped. Unit run: 8,921
executed/passed, 0 failed, 3 skipped, including both production snapshot-purity regressions.
Capturing the controller during static renders detects an injected reader's render-time IPC;
manually starting it then driving real stores proves silent subscriptions, fresh response guards
and change-then-restoration invalidation. Static output alone proves none of those transitions.

Browser cases retain default/two-activation answers, grants, FIFO, focus, hidden drafts, peer/rejection
feedback and offline attempts. Synthetic desktop and 800×600 captures cover safe-default, armed and
checked/unchecked offers; wrapping/reachability assertions include unbroken paths and complete rules.
A native capture returned the preceding armed frame, so these use Playwright screenshots for painted
state. See [permission coverage and reviewed captures](conversation-shell-permission-modal.md#verification)
and [live evidence](live-e2e-runbook.md#current-real-claude-gate-state).

Permission resolution coverage separates these proofs explicitly.
[`modalPrompts.test.ts`](../../../src/renderer/src/store/modalPrompts.test.ts) checks held-owner
detection, silent local/unknown dismissals, per-chat replacement, stale-object guards, reconnect
preservation and pairing reset. [`TopOverlay.test.tsx`](../../../src/renderer/src/screens/conversation/TopOverlay.test.tsx)
pins both client copies, Default treatment, accessible X and usage/resolution/Re-pair order.
Neither static rendering nor reducer tests execute the display timer or navigation cleanup.
[`permission-resolution-notices.spec.ts`](../../../e2e/permission-resolution-notices.spec.ts)
injects `modal_shown`/`modal_dismissed` frames through fake transport to prove both sources, local
silence, X, expiry, deferred display beyond four seconds, chat isolation, navigation without replay
and replacement across the old deadline. Its paused browser clock checks visibility at 3999ms and
absence at 4000ms from display. Same-copy replacement is essential: a timer keyed only to kind/copy
could pass a remote-to-timeout case while expiring a timeout-to-timeout replacement early.

Session-error regressions exercise three distinct traps. In
[`savedTimelineRestorer.test.ts`](../../../src/renderer/src/store/savedTimelineRestorer.test.ts),
hold the local read while replacing or clearing the notice, then settle stored,
missing, invalid and failed results. Slice identity cannot own the request: transient
changes replace the slice and would strand loading. Settlement must retain the
current sidecars, never resurrect a cleared notice, and reject repeated settlement.
The [host-bound read owner](conversation-timeline-holder.md#local-timeline-admission)
preserves this distinction without admitting another host's content.

Reset coverage must drive the real `sessionTransition(reason: 'clear')` →
`sessionBoundary` route, retaining its divider and the other conversation's notice.
A reducer test that sends only synthetic `reset` misses daemon resets from another client.
[`timelineBridge.test.ts`](../../../src/renderer/src/store/timelineBridge.test.ts) checks routing
and host-specific off-screen reconnect clearing; the encrypted fake-frame reset in
[`session-error-notice.spec.ts`](../../../e2e/session-error-notice.spec.ts) waits for
“Session reset” before checking notice absence.

Production React does not replay effects, so a passing production browser test cannot
prove StrictMode-safe notice consumption. The development case builds the actual
renderer with development React, asserts `commitDoubleInvokeEffectsInDEV` is present,
and checks held-notice opening, replacement, navigation and Settings exit. Serve the
scratch build on loopback and launch it once through `LaunchControl.rendererUrl` and
the existing `ELECTRON_RENDERER_URL` path, checking the loaded URL. Re-navigating the
already-loading window with `loadFile` failed with `ERR_FAILED` before assertions on
the gate host; startup through the normal path preserves Electron confinement,
sandbox and context isolation.

Keep the staged actual-send assertions in
[`status-icon-local-send.spec.ts`](../../../e2e/status-icon-local-send.spec.ts):
“Sending…” before any reply, “Waiting for Claude” only after the queue lists the
sent message id, and “Thinking…” only after daemon turn state. Another device's or
id-less queued item cannot acknowledge this send; an emptied queue cannot end the
acknowledged wait. Session-error coverage adds a pill as the positive receipt barrier
before checking absent label/spin, retaining the idle icon. Replacing all post-send
expectations with “Thinking…” would erase the pre-response proof established by
[the local-send design](conversation-shell-working-indicator.md).

Recorded evidence: the [final session-error verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1784#issuecomment-6001709338)
confirms the development StrictMode case was present and passed at `648fa5fc` on
2026-10-05: 1 executed, 1 passed, 0 failed, 0 skipped within the full browser run
(268 executed, 268 passed, 0 failed, 4 skipped). Both production session-error cases
and the staged local-send test also passed in that run. Unit evidence is 8,756
executed/passed, 0 failed, 3 skipped. No live-Claude proof is claimed.

The end-to-end directory has historically been outside the project's TypeScript
configurations. Playwright strips types when it loads a spec. Check the current
configurations before claiming that a green build typechecks a changed spec.
When doing a focused typecheck, distinguish errors in the changed file from known
fixture errors. A fixture option in the wrong argument can be silently ignored.
Read the fixture signature before supplying launch options.

A test that derives its expected value from the same transformation the code under test
performs re-implements that transformation rather than checking it. A wrong mapping is then
reproduced faithfully on both sides and the test passes green. State the expected value
independently, alongside the input, instead of computing one from the other.

A heterogeneous `it.each` table whose rows do not share every field widens to a union type
each row is missing keys from. This can be the only signal that a table-driven test is
silently under-specified; do not treat the resulting type error as unrelated noise to
work around.

A `readonly` array field makes a `TargetType[]` cast in a test a compile error. Narrow on a
discriminant field instead of casting — it typechecks, and unlike a cast it fails loudly if
the value under test turns out to be the wrong union member.

The dispatcher stops its mechanical gate sequence at the first failure.
Later commands then have no verdict. Report which gates actually ran.
Follow the verifier's current instructions for any remaining validation.

A baseline can fail on a different spec from the proposed change. Compare actual
assertions and inputs before calling the difference a regression.
An Electron connection failure is not an application assertion failure.
Investigate the failing spec with repeated focused runs when the evidence suggests
a race. Do not rerun blindly until one result is green.

Playwright's Electron evaluation error “Execution context was destroyed” can be generic error wording.
`app.evaluate` runs in the main process; the message alone does not prove renderer navigation or an app
crash. Inspect the failing evaluation boundary and launch-fate evidence (process state, exit and teardown)
before assigning a cause. Repeated green checks do not establish that an intermittent failure is
pre-existing; retain an undiagnosed classification when no causal defect was found. See the
[footer review's evaluation diagnosis](https://github.com/pyrycode/pyrycode-desktop/pull/1762#issuecomment-5993150705).

### Host prompt verification

The [Edit host controller](edit-host-dialog.md#prompt-controller-lifetime) has
three lifetimes to prove: effect setup, modal interaction and individual operation.
Static markup checks read gates, helper/reset and disabled controls; injected
controller tests check correlation and draft/save transitions. Neither executes
React effect replay or the parent name/unpair continuations. Production React
does not replay effects, so its green browser run cannot establish one read per
opening in development StrictMode. The development renderer in
[`host-system-prompt.spec.ts`](../../../e2e/host-system-prompt.spec.ts) checks for
`commitDoubleInvokeEffectsInDEV`, launches through `rendererUrl`, then counts one
read per opening, rejects duplicate/old replies and traverses enabled prompt/reset
controls at 800×240. A cancellable post-subscription microtask avoids sending the
discarded setup's read.

Hold name persistence, disconnect the selected host, start unpair, then release
both successful and failed name results. A modal interaction id alone cannot
protect the newer operation in that same dialog; both identity checks must retain
the unpair lock while permitting a valid local label update. Separately open a
terminally disconnected host B, hold its name save, then deliver host A's message
and terminal status. Wait for visible receipt/status before checking B's lock and
dismissal controls; release the save and require successful close with no prompt
write. Cancelling on every session-store update while B is disconnected would
release the controls and invalidate that close. Compare the selected host's
previous/current status records; untouched records retain identity. Terminal loss
keeps the fixture from automatically reconnecting during this proof. Seed each
host through `conversationStateFake({ conversations: [seed] })`; an array passed
where the options object belongs silently loses the intended multi-host state.

Recorded acceptance evidence: dispatcher gate 6 at
`1082bcffb6524c1f507da08ef9e8e250c40125ef` on 2026-10-06 ran
`npx playwright test --reporter=json`: 301 executed, 301 passed, 0 failed,
4 skipped. The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1787#issuecomment-6024523660)
confirms every named case below was present, executed and passed. Host prompt
had 5 executed/passed and sidebar host-edit had 6 executed/passed; both groups
had 0 failed and 0 skipped.

| Named host prompt test | Executed / passed | Proof |
| --- | --- | --- |
| `selected-host prompt read, reset, durable save, failures and modal lifetime` | 1 / 1 | Selected-host transport, whitespace/empty clearing, reset/cancel, failures/reopen, UTF-8 boundary and disconnect |
| `each opening reads once under development StrictMode effect replay` | 1 / 1 | Replay, duplicate rejection, fresh read and short-window keyboard controls |
| `unrelated host traffic preserves a disconnected host name save lock and completion` | 1 / 1 | Connection transition isolation, dismissal and successful name-only completion |
| `late stored name save cannot unlock an outstanding unpair after disconnect` | 1 / 1 | Valid local persistence without releasing a newer erase |
| `late error name save cannot unlock an outstanding unpair after disconnect` | 1 / 1 | Late failure cannot release that erase |

The sidebar cases include rename/clear/remount, both Cancel and Close during a
failed/held save, minimum-width wrapping/short-window reachability, unpair
arm/disarm/reopen and close-image decoding. Unit evidence in the same verdict is
8,934 executed/passed, 0 failed, 3 skipped; typecheck/pre-verify, build and docs
guard passed. This records supplied evidence, not a new documentation-stage run.
Acceptance uses units and encrypted fake transport; no live Claude turn is
required. Next-session application and composition order remain daemon-owned.

### Message lifecycle diagnostics

[Outbound lifecycle diagnostics](outbound-send-path.md#message-lifecycle-diagnostics)
need evidence from the write boundary. A fake driver's nonthrowing return cannot
prove sent: hold its observer, assert queued only, then report the actual write.
[`daemonConnection.test.ts`](../../../src/main/daemonConnection.test.ts) does this
before driving decoded snapshots from matching and unrelated hosts/conversations,
missing/empty/hostile ids, repeated acknowledgment, cancellation and closure. Its
unavailable-driver, driver-failure and encode-failure cases require a classified
drop without sent.

[`messageLifecycle.test.ts`](../../../src/main/messageLifecycle.test.ts) uses the
real diagnostic serializer with a capture sink to check held UUID correlation,
duplicate suppression, queue disappearance, silent retirement at the 1024-entry
cap and hostile IPC-field exclusion. It rejects forged reserved lifecycle events
and planted main-only fields through `onDiagnostic`, then checks serialized lines
rather than only projection results. Cancellation must permit the later sequence
queued → dropped (`user-cancel-request`) → sent → acknowledged: a terminal
cancellation flag could make the diagnostic trail pass ordinary cancellation
coverage while hiding a buffered message's eventual write.

[`noiseSession.test.ts`](../../../src/main/transport/noiseSession.test.ts) holds
and releases the rekey handshake with controlled peers and the real serializer.
Waiting must emit no sent record; flush observes each write; overflow drops only
the incoming entry; abandonment and repeated teardown discard retained entries
once. Closing after flush leaves sent-without-acknowledgment unchanged.
[`noiseRelayDriver.test.ts`](../../../src/main/transport/noiseRelayDriver.test.ts)
checks observer forwarding, refusal and caught write failure.
[`relayConnection.test.ts`](../../../src/main/transport/relayConnection.test.ts)
drives OPEN, pre-open/post-close refusal, an injected socket-write throw and a
throwing observer, with distinct socket UUIDs across repeated connections.
The [oversize regression](../../../src/main/transport/relayConnection.oversize.test.ts)
retains the exact content-free close field set, numeric 1009 and static
classification while validating a UUIDv4 shared with its open record. An additive
safe field must update these exact assertions without weakening content exclusion.

Injected composer/drop effects prove ordering, bridge failures and nonthrowing
diagnostics, but cannot prove React passed the optional callback. The single test
“idle and running composer submissions reach diagnostics, and drop is a local
request” in [`message-lifecycle-diagnostics.spec.ts`](../../../e2e/message-lifecycle-diagnostics.spec.ts)
uses production `ConversationScreen` wiring, encrypted fake transport and the real
stdout sink. It exercises blank refusal, idle and running submissions, held/repeated
queue acknowledgment, queued-row cancellation and production route refusal.
Poll for the observed lifecycle/dequeue before checking counts or content absence;
an immediate absence assertion can pass before the IPC record arrives.

Recorded evidence: the [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1782#issuecomment-6002754916)
at `dfef34da3fc70cc5062e03b0a65a0d713af2c64b` on 2026-10-05 confirms the lifecycle
spec was present and passed: its one named test executed/passed, 0 failed,
0 skipped. The dispatcher’s full fake-transport run executed 271 tests, all 271
passed, 0 failed and 4 skipped. The verdict records aggregate unit evidence of
8,792 executed/passed, 0 failed and 3 skipped, plus passing build and docs guard.
Controlled transports and snapshots establish this diagnostic contract; no
live-Claude result is claimed.

