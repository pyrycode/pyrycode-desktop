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

The reset regression in
[`composer-context-claude-reading.spec.ts`](../../../e2e/composer-context-claude-reading.spec.ts),
`reset completion requests context once and refreshes footer and gauge without a message`,
holds the completion reply while both displays retain 40%. Visible wrapping-up and restarting
labels establish that phase frames were processed before checking that no request was added.
The inactive edge produces one new request addressed to the reset conversation. Two more inactive
frames precede the correlated reply; the footer and gauge changing to 5%, with 10K of 200K tokens,
form the positive processing barrier before checking that request count stayed at two and no message
was sent. An immediate count after pushing inactive frames could pass before they reached the app.
Reopening then produces its separate activation ask.

The [verifier verdict for #1749](https://github.com/pyrycode/pyrycode-desktop/pull/1798#issuecomment-6006397775)
confirms this named regression was present and passed, along with the other two tests in that spec,
in the dispatcher gate at `1f994132db599066efd744a9df57a542195133e0` on 2026-10-06:
279 executed, 279 passed, 0 failed and 4 skipped. This is fake-transport evidence; no live-Claude
result is claimed.

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

The [translucent conversation layout](conversation-shell-chrome.md#layout-contract)
keeps the existing scroll surface across the full pane. Assert unchanged viewport
height plus measured padding changes when status, attachments, drafts or pending
prompts alter the occupied input height. Compare the newest row with input chrome,
and pills with occupied header height plus their 12px gap, including an empty offline
chat. The scrolled Desktop Figma frame does not establish a new resting offset:
history start still needs the 97px first-row clearance and 20px horizontal alignment.
Native anchoring can emit resize scrolls before `ResizeObserver`; verify following
survives native window resizing and Electron zoom, while parked arrivals stay held.
Use `BrowserWindow.setSize`, not `page.setViewportSize`, to establish the actual
800×600 and 1280×800 window geometry, and distinguish outer size from content size.
Native `setSize` and `setZoomFactor` can return before renderer reflow. Poll
`window.innerWidth`/`innerHeight` against `BrowserWindow.getContentSize()` divided by
the requested zoom (allowing pixel rounding), then wait two animation frames before
checking clearance or the final scroll endpoint. An immediate endpoint assertion
produced a transient minimum-width failure in the reader proof.

The [Markdown reader](conversation-shell-markdown-reader.md#pane-wiring) needs its own
full-pane viewport assertion: header padding alone can pass while the scrollport still
starts below the header and cannot overlap it. Check the unchanged 85px resting heading
offset, 20px horizontal inset and 16px bottom clearance, then measured clearance as copy
confirmation and refresh/open/save notices appear or disappear. At both native sizes
and 100%/125% zoom, reach the final content, bound the menu and every label line, establish
positive text/control overlap, and actually click Note actions, a copy row and Back.
Retain keyboard activation, focus, Escape and outside-click checks. Inject external-open
and save failures at the IPC handler seam so layout proof invokes neither OS apps nor
Downloads writes. Draft/thread-position checks and an upload completing while the reader
is open distinguish a hidden covered conversation from one accidentally unmounted.

Stacking levels are relative to ancestor contexts. The message area's level 0
contains rows, pills and drawer; sharp top/input chrome at level 1 keeps controls
and their menus above them. Existing level-2 sheets and later dialog siblings retain
precedence, with Create chat at level 3. A raised sheet can cover the dialog it opens;
an overly raised header can beat a dialog scrim. Keep both surfaces mounted for
scrim hit tests and retain actual dialog clicks. Decorative blur layers must not
intercept pointer input. Drawer containment needs both measured vertical boundaries
and width minus the right inset: `min(360px, 100%)` alone overhangs a narrow pane.
Retain composer send, Escape and conversation-switch checks while the drawer is open.

Conversation footer panels clamp to the input pane, use its width minus right margin
and label inset, and shift left as needed. Bounding the background rectangle alone
can leave labels clipped outside it. Wrapping only in the space beside a rightward
trigger can make long menus taller than the viewport at 125% zoom. Measure every
rendered text line, including unbroken names; prove selection by keyboard and a real
click on the final wrapped line at both sizes and 100%/125% zoom. Keep visible overflow
for focus outlines. Type-ahead retains single-line containment within the pane;
other shared-menu consumers retain their prior boundary. See
[menu clamping](conversation-shell-composer-options-panel.md).

Stacking proof needs positive rectangle overlap before `elementFromPoint` checks,
then a real click on a menu item inside the overlap that opens its destination.
Visibility and bounding boxes can pass while the item is covered; a hit-test outside
the intersection cannot prove precedence. The
[`thread-overflow-overlay.spec.ts`](../../../e2e/thread-overflow-overlay.spec.ts)
regression also checks that the computed menu anchor level exceeds the Top overlay.
It covers usage at 1280×800 and 800×600 windows, and Re-pair alone at 1280×800.
The pairing-rejection banner pushes the second pill below the popup, so the fixture
dismisses usage before testing Re-pair. Usage proves positive overlap and a real
menu-item click inside the pill intersection at both sizes. With measured header
clearance, Re-pair sits below the short popup; that state checks stacking and a real
menu click at its natural position, without claiming overlap. The empty-offline
translucent-control case separately clicks Re-pair below the occupied header.
Drive Re-pair with a sealed non-retryable `error` envelope carrying `auth.invalid_token`;
a terminal socket closure offers Reconnect and cannot establish that pill's stacking.

[`capturePairedApp`](../../../e2e/fixtures/capturePairedApp.ts) waits two animation
frames, then captures through Electron's native `webContents.capturePage`, avoiding
the Playwright screenshot-protocol stall observed on this runner. It recursively
creates the destination parent before writing and returns the PNG buffer. Existing
scratch directories can hide a missing-parent failure; both translucent-control
size cases write a fresh nested test-output path and compare the saved PNG to the
returned buffer. Preserve original capture paths when migrating a scenario.

Recorded [translucent-control design](../../specs/architecture/1733-translucent-thread-controls.md)
evidence: the dispatcher verifier gate on 2026-10-06 at final production revision
`d2ef7fc79270a0b01d8d5b9316bb9544c96659d7` ran
`npx playwright test --reporter=json`: 284 executed, 284 passed, 0 failed, 4 skipped.
The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1797#issuecomment-6007169599)
confirms every test in the following spec groups was present, executed and passed
in that run. Each group had 0 failed and 0 skipped:

| Browser spec | Executed / passed | Proof retained |
| --- | --- | --- |
| `translucent-thread-controls.spec.ts` | 3 / 3 | Full-pane overlap, dynamic clearance, resize/zoom, offline pills, fresh capture parents |
| `composer-options-clamp.spec.ts` | 3 / 3 | Width/shift restoration, complete long labels, real selection and focus |
| `thread-scroll-pin.spec.ts` | 11 / 11 | Following, late images, zero/nonzero prepend position, no extra history demand |
| `history-walk.spec.ts` | 2 / 2 | Existing history behavior |
| `composer-message-box.spec.ts` | 3 / 3 | Draft sizing, scrolling and editing |
| `thread-overflow-overlay.spec.ts` | 1 / 1 | Menu/pill overlap and real clicks |
| `background-task-drawer.spec.ts` | 1 / 1 | Native resizing, containment, send, Escape and chat switch |
| `chat-top-bar-geometry.spec.ts` | 5 / 5 | Top bar, dropdown interaction and sheet/dialog scrims |
| `permission-modal-answer-paths.spec.ts` | 7 / 7 | Permission response paths |
| `question-picks.spec.ts`, `question-answer-continue.spec.ts`, `question-cancel-refuses.spec.ts` | 3 / 3 | Picks, Continue and Cancel |

The footer tests are named `the options panel fits the pane and restores its width
on resize`, and `long footer model labels stay readable and selectable at 1280 with
zoom` / `long footer model labels stay readable and selectable at 800 with zoom`;
each executed once and passed, with 0 failed and 0 skipped.
The verdict also confirms all 13 tests across the migrated top-bar, status-spacing,
usage-limit, type-ahead and unpair/repair specs executed and passed (0 failed, 0 skipped),
retaining interaction and hit-test assertions. These overlap the groups above and
are not an additional suite total. The four full-run skips concern platform-specific
badge/window-close scenarios. Acceptance uses fake transport; no real-Claude run or
separate manual interaction run is claimed.

The same verdict independently inspected all 14 native synthetic captures at that
revision against [Desktop `756:9848`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9848),
[Top bar `731:6010`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=731-6010)
and [Input area `134:5013`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=134-5013).
Fade/softening, sharp controls, preserved sidebar/alignment, expanded-input clearance,
drawer containment and complete long labels with visible focus matched, with no
unresolved visual deviation. Outer windows were 1280×800 and 800×600; native 100%
content captures were 1280×773 and 800×573. Geometry tests establish resting clearance;
captures establish appearance.

| State | Original 1280×800 capture | Original 800×600 capture |
| --- | --- | --- |
| Resting | `/tmp/builder-1733/resting-1280.png` | `/tmp/builder-1733/resting-800.png` |
| Under header | `/tmp/builder-1733/under-header-1280.png` | `/tmp/builder-1733/under-header-800.png` |
| Under composer | `/tmp/builder-1733/under-composer-1280.png` | `/tmp/builder-1733/under-composer-800.png` |
| Expanded composer | `/tmp/builder-1733/expanded-1280.png` | `/tmp/builder-1733/expanded-800.png` |
| Drawer | `/tmp/builder-1733/drawer-1280.png` | `/tmp/builder-1733/drawer-800.png` |
| Long labels, 100% | `/tmp/builder-1733/long-model-1280-1.png` | `/tmp/builder-1733/long-model-800-1.png` |
| Long labels, 125% | `/tmp/builder-1733/long-model-1280-1.25.png` | `/tmp/builder-1733/long-model-800-1.25.png` |

Reviewed copies and a SHA-256 manifest are retained under
`/tmp/verifier-1797/review-d2ef7fc7/` with the same basenames. These are recorded scratch
evidence paths, not committed image assets. Original paths and comparison remain in
[PR #1797](https://github.com/pyrycode/pyrycode-desktop/pull/1797).

Recorded [reader-header design](../../specs/architecture/1734-translucent-markdown-reader.md)
evidence: the dispatcher verifier gate on 2026-10-06 at production revision
`9caa860214f8caee57aca508fa456dbee04bb843` ran
`npx playwright test --reporter=json`: 286 executed, 286 passed, 0 failed, 4 skipped.
The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1801#issuecomment-6007835769)
confirms the existing reader scenario and every reader-menu/shared-header scenario were
present, executed and passed in that run; each group had 0 failed and 0 skipped:

| Browser spec | Executed / passed | Proof retained |
| --- | --- | --- |
| `markdown-reader.spec.ts` | 1 / 1 | Refetch on open, Back, pending attachments completing while covered |
| `markdown-reader-menu.spec.ts` | 3 / 3 | Existing six-action scenario plus full-pane overlap, dynamic clearance, resize/zoom, menu bounds, real pointer/keyboard input, draft and thread-position preservation |
| `translucent-thread-controls.spec.ts` | 3 / 3 | Shared thread-header regression coverage |

The two layout cases in `markdown-reader-menu.spec.ts` are
`reader scrolls under sharp chrome with dynamic clearance and input at 1280` and
`reader scrolls under sharp chrome with dynamic clearance and input at 800`.
The verdict confirms both passed alongside the existing copy/refresh scenario.
The four full-run skips were two OS badge cases, close-time history drain and
window-reopen convergence; none is counted as passed. This is fake-transport evidence;
no live-Claude run is claimed for the reader layout.

The same verdict inspected all ten native synthetic captures and confirmed their hashes
against `/tmp/builder-1734/capture-manifest.json` at that revision. Comparison with the
retained [Figma `756:10358`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-10358)
reference `/tmp/builder-1734/figma-756-10358.png` and shared thread capture
`/tmp/builder-1733/under-header-1280.png` matched downward fade/progressive softening,
sharp controls, preserved sidebar/alignment, readable failure notices and complete menu
labels at both zoom levels, with no unresolved in-scope visual discrepancy. A fresh Figma
fetch was unavailable; the verdict used the retained reference. Outer windows were
1280×800 and 800×600; native 100% content captures were 1280×773 and 800×573.

| State | Original 1280×800 capture | Original 800×600 capture |
| --- | --- | --- |
| Resting | `/tmp/builder-1734/resting-1280.png` | `/tmp/builder-1734/resting-800.png` |
| Scrolled | `/tmp/builder-1734/scrolled-1280.png` | `/tmp/builder-1734/scrolled-800.png` |
| Three failure notices | `/tmp/builder-1734/notices-1280.png` | `/tmp/builder-1734/notices-800.png` |
| Menu, 100% | `/tmp/builder-1734/menu-1280-1.png` | `/tmp/builder-1734/menu-800-1.png` |
| Menu, 125% | `/tmp/builder-1734/menu-1280-1.25.png` | `/tmp/builder-1734/menu-800-1.25.png` |

These are recorded scratch evidence paths. Original paths, revision and comparison
results are retained in [PR #1801](https://github.com/pyrycode/pyrycode-desktop/pull/1801).

Sidebar popup dismissal needs a complete gesture: closing on outside mousedown alone
can expose the underlying tree to the following click. The
[shared menu's opt-in dismissal layer](conversation-shell-composer-options-panel.md)
stays mounted until click. [`sidebar-header-menu.spec.ts`](../../../e2e/sidebar-header-menu.spec.ts)
proves dismissal leaves host expansion and the unopened conversation unchanged, then
uses a second click to prove each underlying control still works. It also checks positive
popup/tree overlap, `elementFromPoint` on both rows and real selection of both destinations.
When replacing toolbar entries, search hover/focus specs as well as navigation selectors:
the surviving Pair new host name-pill test establishes keyboard modality by Shift+Tab
to Sidebar menu then Tab forward, retaining its pointer, style, focus, blur and overflow checks.

Recorded evidence for the [sidebar header menu](../../specs/architecture/1732-sidebar-header-menu.md):
the dispatcher verifier gate on `8e0ccffde50f9bfbb292b877a27d621a15e10cab`
(2026-10-05, `npx playwright test --reporter=json`) executed 278 tests, with 278 passed,
0 failed and 4 skipped. The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1795#issuecomment-6005660644)
confirms both named tests, `sidebar header menu geometry and input at 1280×800` and
`sidebar header menu geometry and input at 800×600`, were present, executed and passed
(2 executed/passed, 0 failed, 0 skipped). They prove exact placement, no selected row,
first-row focus, wrapped arrows, Enter/Space selection, Escape, destinations and consumed
dismissal. The gate report also confirms
`toolbar controls show their existing name-pill treatment on hover and keyboard focus`
was present and passed (1 executed/passed, 0 failed, 0 skipped). The verdict confirms
shared regressions executed and passed: footer Actions 4/4, thread overflow 1/1 and
Markdown reader 1/1, each with 0 failed and 0 skipped. Acceptance uses fake transport;
no full live-Claude result is recorded for this change.

The same verdict independently compared closed/open synthetic paired captures at both
1280×800 and 800×600 against
[Figma `756:9674`](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=756-9674),
popup `756:9837` and trigger `590:5824` (the PR also compared closed frame `102:4`).
The 24px trigger and exact 6×24px ellipsis, 160×60px popup, 28px rows, 2px outer padding,
−4px left offset, 32px downward gap, text and hover surface matched, with no unresolved
menu deviation. Reviewed capture copies were `/tmp/verifier-1795/closed-1280.png`,
`open-1280.png`, `closed-800.png` and `open-800.png` in that directory; the builder's
corresponding captures were under `/tmp/builder-1732/`. These are scratch evidence paths,
not committed assets. Linux Xvfb capture uses the existing `PYRY_E2E_SHOW_WINDOW=1`
fixture option: hidden Linux windows produce no screenshot frames.

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
