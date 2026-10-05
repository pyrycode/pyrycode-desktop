# Development verification

Shared lessons for refining, building and reviewing Pyrycode Desktop.
These were brought across from the active local-memory index on 2026-09-11.
Check current code before applying an observation about a particular implementation.

## Source and contract checks

Search the source and its production callers before estimating a change.
Search both `src/` and `e2e/`. If the code graph reports that it is not initialized,
use text search and file reads. An unavailable index is not evidence of no callers.

Comments wrap across lines. Search the concept as well as the identifier.
Removing the final consumer can invalidate comments that never name it.
A contract inherited from another consumer needs checking against the new sinks.
An untrusted string used as a Map key does not have the prototype behaviour of an
ordinary object key. Review the actual data structure.

The daemon's handling of unmatched event types differs from its explicit ignored
list. Read the individual dispatch arms before generalising a phrase across them.
On the client, trace the actual inbound parser rather than trusting an old symbol name.
A shared model-row lookup can govern behaviour as well as display text.
Read all callers before broadening what an empty identifier means.

## What each test tier proves

Renderer unit tests use static server rendering. They do not execute effects,
click handlers, focus changes, or layout. A removed bridge mount can leave its
import and all unit tests green. Check that each bridge is mounted in the app.
Use the fake-transport browser tier to prove event delivery through the app.

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

## Evidence that cannot pass too early

A closing absence assertion can pass before an action completes.
First wait for a positive effect of that specific action, then check the absence.
A positive assertion can also be vacuous if history already satisfies it.
Measure the pre-action count and wait for an increase.
Keep an opening absence check when it proves that a later observation is new.

A width assertion must distinguish the before and after layouts.
A test that passes at both widths cannot prove that resizing changed anything.
`launchPairedApp` initially clicks an unfiltered `.channel-list__row-open` locator,
so seed exactly one conversation for that step. For off-screen routing or a resting,
unopened row, push the second conversation after launch returns. Seeding both in the
initial reply fails before the feature is exercised; see
[`banner-reports.spec.ts`](../../../e2e/banner-reports.spec.ts).

Optimistic state can disappear in the same frame when the fake immediately replies.
Hold the fake response, assert the optimistic state, then send the correlated reply.
A rejection can distinguish states whose successful renderings look identical.

A streaming assistant row includes cursor and metadata text, so an exact-text locator
can miss a visible delivery marker. Target the assistant role wrapper with `hasText`
for the positive barrier, then assert duplicate absence. In
[`live-user-receipts.spec.ts`](../../../e2e/live-user-receipts.spec.ts), a later
`assistant_delta` on the same encrypted stream proves the preceding receipts passed
through the mounted app before the one-row checks; an immediate count alone could
pass before either receipt arrived.

The footer needs a session-settings snapshot before its controls can render.
Check the current refresh trigger. A lone idle event does not produce a transition
from running to idle. Drive the prerequisite transition when the fixture requires it.

## Layout and input

A sticky offset is relative to the scrollport content box.
Read the running window's boxes when a padded scroller is involved.
Flow arithmetic alone can predict the wrong boundary.
An overlay can paint beneath a later positioned sibling when both use automatic
stacking or equal explicit levels. Check the complete ancestor and sibling arrangement.

Stacking proof needs positive rectangle overlap before `elementFromPoint` checks,
then a real click on a menu item inside the overlap that opens its destination.
Visibility and bounding boxes can pass while the item is covered; a hit-test outside
the intersection cannot prove precedence. The
[`thread-overflow-overlay.spec.ts`](../../../e2e/thread-overflow-overlay.spec.ts)
regression also checks that the computed menu anchor level exceeds the Top overlay.
It covers usage at 1280×800 and 800×600 windows, and Re-pair alone at 1280×800.
The pairing-rejection banner pushes the second pill below the popup, so the fixture
dismisses usage before testing Re-pair and measures actual overlap in each state.
Drive Re-pair with a sealed non-retryable `error` envelope carrying `auth.invalid_token`;
a terminal socket closure offers Reconnect and cannot establish that pill's stacking.

Resolution-pill visual evidence covers four states: remote and timeout at both 1280×800 and
800×600 window sizes (1280×772 and 800×572 content viewports). The
[review of implementation revision `1b6aabfe`](https://github.com/pyrycode/pyrycode-desktop/pull/1719#issuecomment-5929842972)
records all four captures compared with Figma Top overlay `132:4171` and Default pill `347:6617`:
token colours, body-small typography, padding, radius, shadow, right alignment, 12px stack spacing
and the exact 8px X matched, and both copies fit at minimum width. Integrated captures show usage
plus resolution; simultaneous usage/resolution/Re-pair order is a static-render assertion backed
by shared layout source, rather than a three-pill screenshot. Captures prove appearance; the
fake-transport spec above proves lifetime and interaction.

Text truncation needs a shrinkable chain of flex items on the relevant main axis.
A bare text node cannot carry its own bounded truncation box.
Check every ancestor between the label and the row.
A parent's computed background cannot detect a child painting over it.
Assert the property on the element whose paint must change.

Do not assume opening a menu or dialog moves focus into it.
Read its focus code and all competing Escape listeners.
A composer-focused key event can reach several document listeners.

A native clipboard bitmap can advertise Files without an image MIME entry.
A simulated keyboard shortcut does not necessarily execute a trusted paste.
Use the Electron window's native paste operation for this case.
Seed the clipboard before the first paste and distinguish rejection branches in
the fake responses.

## Live-test diagnosis

A real-Claude failure can come from the installed daemon being too old or too new
for the client contract. It can also be an unrelated race.
Check the daemon version and the capabilities the test needs.
Confirm the actual test executable's source revision contains the prerequisite merge. A focused
pass against a temporary binary leaves a stale dedicated test binary unchanged; rerun against
the executable the dispatcher uses before treating that environment as repaired.
Compare neighbouring gate runs and per-spec durations before assigning the cause.
Search existing bug tickets before creating another.

The real suite can exit successfully while every test skipped.
Read executed counts, skip reasons and failure evidence.
The automatic dispatcher gate remains the acceptance check for live behaviour.
Follow the Desktop harness and current role instructions for credentials and runs.
Do not import the daemon repository's Go-specific live-test commands.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
