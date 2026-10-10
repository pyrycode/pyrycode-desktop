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

Keep builds sequential with Electron suites: launches read generated renderer assets.
A concurrent rebuild can rewrite those assets during Welcome setup and produce
timeouts unrelated to the scenario under review. Record that full run as failed
even if the named test passed; a later uninterrupted pass is separate evidence.
See [the counted history-gap runs](development-verification-history.md#known-gap-recovery-verification).

Main/preload and renderer tests belong to separate TypeScript projects. Importing
renderer translators into a main test can pass Vitest's alias resolution while
breaking the node project typecheck. Keep supplied-frame/structured-cloned IPC
and real preload-subscription coverage in `src/main/sessionStateMetadata.test.ts`,
and pure legacy-translator coverage in
`src/renderer/src/store/sessionStateMetadata.test.ts`. Assert `Object.hasOwn` for
optional metadata: checking only `undefined` cannot distinguish a missing key
from an added enumerable property. Use different payload/envelope session IDs
and equal conversation/session IDs on two hosts to expose substitution and
origin-isolation defects. This is supplied-contract proof; it does not establish
production capability activation or live-daemon delivery.

Detailed [permission/session verification, host prompt verification and message lifecycle diagnostics](development-verification-test-tiers.md)
live in the test-tier reference; static proofs and mounted delivery establish different facts.

Newest-history acceptance for [#1815](https://github.com/pyrycode/pyrycode-desktop/issues/1815)
at `b4eee350bb4d` is counted in the [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1878#issuecomment-6047087442):
units 9,517 executed/passed, 0 failed, 3 skipped; fake Playwright 349 executed/passed,
0 failed, 4 skipped. All 26 newest-demand units and all five `history-on-open.spec.ts`
scenarios were present and passed, including mounted newest content without upward
input/no arrival cascade, read/request deferral on reopening, trusted input gates,
pending exclusion and reconnect cursor retention. Settle opening with backwards
paging eligible before negative input assertions; otherwise pending exclusion can
make broken input gates pass.

The dispatcher live report `2026-10-07T21-21-05-639Z` records 26 executed, 26 passed,
0 failed, 1 skipped and lists `real-daemon-history-on-open.spec.ts` →
`a real daemon refreshes saved history with a channel post written while Electron is closed`
as present and passed (one attempt, 3.1 s). This is dispatcher acceptance at the
reviewed head, beyond earlier builder evidence. It proves a post absent from the
saved baseline appears once after full process exit and protected-profile relaunch,
without upward input, against real daemon storage/transport. See
[live provenance and excluded case](live-e2e-runbook.md#current-real-claude-gate-state).

Received read-mark coverage in
[`received-read-marks.spec.ts`](../../../e2e/received-read-marks.spec.ts) withholds metadata refresh
replies while asserting dot/badge clearing from unsolicited and correlated read updates. It covers
unread before any local timeline, delayed lists, higher latest IDs, local opening/timeline stamp
suppression and equal conversation IDs on two hosts. An immediate absence check alone could pass
before delivery; wait for the changed dot and badge command. Linux observes renderer
`setBadgeCount` commands at main IPC, proving composition/delivery, not native OS badge rendering.

Persistence is a separate assertion: the two-host case reads saved lists and finds their admitted
marks `[0, 2]` after host A's push clears attention. The history writer captures received list
replies, not read pushes themselves; a changed held row is no proof of a disk write. Wire/saved
parser and store units cover zero, omission, invalid safe-integer admission, restoration and stale
ordering; predicate, bridge, badge and static-row tests cover legacy fallback/stamping, precedence
and exclusions. See [saved history](chat-history-testing.md) and [unread](conversation-unread.md).
Desktop publication has separate committed-viewport proof below; received marks remain the authority.

Recorded evidence at `362f24a647561f7e6071b3a9904d6c3702205a8f` on 2026-10-07:
dispatcher gate 6 (`npx playwright test --reporter=json`) ran 319 tests, 319 passed,
0 failed and 5 skipped. The [final verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1830#issuecomment-6028224894)
confirms both tests below were present, executed and passed in that run (scoped total:
2 executed, 2 passed, 0 failed, 0 skipped). Unit evidence is 9,101 executed/passed,
0 failed and 3 skipped. No live Claude or live phone round-trip was required or exercised.

- `remote marks clear mounted attention before refresh and survive stale lists and local opening`
- `two hosts sharing an ID retain independent read state, dots and badge contribution`

### Visible-tail read publication

The [final verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1895#issuecomment-6055688246)
confirms dispatcher gates at `fec401cf6ee638bd0d9bb5b8980f21ac7873322b` on 2026-10-08:
fake Playwright (`npx playwright test --reporter=json`) ran 375 executed, 375 passed,
0 failed and 3 skipped. It confirms all eight scenarios in
[`visible-tail-read.spec.ts`](../../../e2e/visible-tail-read.spec.ts) were present, executed and
passed: 8 executed, 8 passed, 0 failed, 0 skipped. These are:

- `read setup is reused across committed same-row deltas on short and long threads`
- `stable callbacks exclude hidden, queued and received but uncommitted tails`
- `committed folded tails require focus, uncovered viewport and a closed reader`
- `ID-less replay stays unknown until independently admitted history, and unseen live content restores attention`
- `late read contract rechecks the committed tail while visible`
- `late read contract rechecks the committed tail while blurred`
- `late read contract rechecks the committed tail while reader-covered`
- `late read contract rechecks the committed tail while above-tail`

The mounted fake inspects actual outbound durable targets with distinct connection (`900`), replay
(`700`) and durable IDs. Folded deltas, tool calls/results and terminal state advance only through
committed visible display; scrolling above the tail, blur and reader coverage withhold observation.
ID-less replay creates no recovery request: the existing opening page independently admits identity.
An unseen closed-chat entry restores attention, and an older acknowledgement cannot clear it.
Late-contract cases change only list eligibility after display commit; the visible case must publish
without another user action, while gated cases wait. Repeated lists/delivery cannot repeat a mark,
and attention remains until a correlated reply or unsolicited received push. Immediate absence
checks alone could pass before delivery; retain committed-content and received-state barriers.

After setup settles, spec-local instrumentation attributes read observer construction by its first
thread target and listener/subscription ownership by callback identity, excluding scroll-pin work
and test-oracle discovery. The verifier confirms `read-work-30` and `read-work-400` each record zero
observer constructions, tail discoveries, listener additions and subscription additions across
separate same-row commits. Spaces advance durable targets with identical numeric row key and
bounding rectangle; growing paragraphs also advance targets without setup churn. Row replacement
keeps one active setup with connected targets; reader coverage and navigation away leave no active
observer targets, listeners or subscription, and returning restores one setup. Independently admitted
history reuses the initially unknown observation too. The [plan's baseline record](../../specs/architecture/1893-stable-read-observation.md#revisions)
reports 3 constructions, 3 discoveries, 6 listener additions and 3 subscriptions for three same-row
commits on each thread size at `9aa12511`; the new churn assertion failed before repair. These are
recorded work counts, not a separately counted suite result or a documentation-stage rerun.

For received-but-uncommitted exclusion, hold the scheduled animation frame and use a real preload
receipt barrier before driving focus/scroll callbacks. Confirm the pending text is still absent and
the outbound target unchanged, then release the frame and require the committed target advance.
Injecting a non-delta daemon event, including a conversation list, flushes buffered deltas in
`subscribeTimeline` and invalidates that pending-frame oracle. Hidden-document, hidden-row and
queued-row cases wait for committed text before checking withheld targets, then clear the gate and
require publication.

Playwright's original CDP session forces focus, so blur cases inject only `document.hasFocus()`.
Viewport, measured overlays, scrolling, reader geometry and outbound transport remain real.
This proves the focus gate, not native OS blur propagation. No live-Claude execution was required
or performed. Unit evidence is 9,606 executed/passed, 0 failed, 3 skipped; the verdict confirms
all six publisher unit tests were present and passed. Publisher/identity
units cover numeric admission, commit candidates, coalescing, failure retention, reconnect/isolation
and protected restoration; static renders alone cannot prove the mounted observation.

### Agent-switch settings verification

The mounted regression must settle an own-agent write before switching: optimistic model text alone
does not prove a confirmed override exists. In
[`agent-switch-confirmation.spec.ts`](../../../e2e/agent-switch-confirmation.spec.ts), wait for the
Sonnet current-model marker and the sheet's model list to lose `aria-busy`, confirm through the existing
switch dialog, then deliver the owning-host target-agent list and incoming settings. Require the extra
settings request, incoming GPT-6 Luna footer and open-sheet marker, and low rather than high effort
offerings. Reuse the spec's ticket-local opening fixture; no shared harness or downstream picker path
is needed. Store/bridge isolation is covered separately by
[`agentSettingsLifecycle.test.ts`](../../../src/renderer/src/store/agentSettingsLifecycle.test.ts).

The [plan's baseline record](../../specs/architecture/1845-settings-agent-switch-lifecycle.md#revisions)
on unmodified main `95ed3951e38df40550eae2680068a6bc0f417563` reports 2 executed,
1 passed and 1 failed focused browser scenarios; the skipped count was not supplied.
The new regression failed at the incoming GPT-6 Luna footer assertion while the footer retained
`sonnet`, despite incoming Codex settings/offerings. Its recorded DOM evidence path is
`/tmp/builder-1845/main-regression-error-context.md`.

At reviewed head `c98d5c0c76a50ef80db2cd7a9c132faff3ce4887` on 2026-10-07,
dispatcher gate 6 (`npx playwright test --reporter=json`) ran 336 tests: 335 passed,
1 failed and 4 skipped. The
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1860#issuecomment-6038815859)
confirms both named scenarios were present, executed and passed (2 passed, 0 failed, 0 skipped):

- `mounted agent switch dismissals, single dispatch, progress, refusal and authoritative success`
- `confirmed own-agent settings yield to incoming footer and open sheet on authoritative switch`

The unrelated chat-history failure passed its selected rerun: 1 executed, 1 passed,
0 failed and 0 skipped. Unit evidence is aggregate only: 9,356 executed/passed,
0 failed and 3 skipped; individual unit results are not enumerated. The PR also records the repaired
focused browser run as 2 executed/passed, 0 failed and 0 skipped. No live-Claude run is required or
claimed for this renderer lifecycle proof; separate live hand-over remains with #1662.

The same verdict inspected synthetic captures attributed to that head: sheet
`/tmp/builder-1845/incoming-settings-1280.png`, footer
`/tmp/builder-1845/incoming-footer-1280.png` and minimum-width footer
`/tmp/builder-1845/incoming-footer-800.png`. They show incoming GPT-6 Luna/low readings and Codex
sheet offerings at 1280×800 and the footer at 800×600. These are recorded scratch paths, not committed
assets. Presentation code is unchanged. The builder compared the footer with Figma `115:3683`;
sheet node `20:100` was unavailable, and the verifier made no fresh Figma comparison.

### Served-page persistence verification

Verify served envelope coverage separately from retained display contributions.
The [history verification reference](development-verification-history.md) covers
partial/repeated overlaps, split replies and orphan patches, strict saved metadata,
held-row/live-state regressions, protected fresh restoration and counted mounted
tool-expansion/content-anchor evidence, known-gap fixture traps and the counted
closed-Electron 205-post proof. Legacy receipt-only data cannot prove retained
content. Fresh reader steps use opaque cursors; opening performs one newest ask.

### Equal-id received history

[`message-reply.spec.ts`](../../../e2e/message-reply.spec.ts) now verifies separate
protected timelines for two hosts advertising the same conversation id, then
reopens the first chat offline and quotes its own reply. Polling saved snapshots
proves persistence; mounted text and isolated drafts alone cannot establish it.
See [history test coverage](chat-history-testing.md#browser-persistence-and-lifecycle)
and [received ownership](chat-history.md#received-state-admission-and-ownership).

Recorded evidence on 2026-10-07 at `0b0bfe738aba668218d5e323201c6f719f03b269`:
dispatcher verifier gate 6 (`npx playwright test --reporter=json`) ran 322 tests,
322 passed, 0 failed and 4 skipped. The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1834#issuecomment-6029226851)
confirms all five reply scenarios below were present, executed and passed in that
run (scoped total: 5 executed, 5 passed, 0 failed, 0 skipped). No live-Claude run
was required or performed for this fake-transport persistence acceptance.

- `pointer and keyboard replies append current source, focus once, and send the edited quote intact`
- `covered replies focus when permission clears once, and pending focus is discarded on chat switch`
- `reply isolates equal conversation ids across hosts`
- `reply appends and focuses in a reopened saved offline chat`
- `received history is saved for equal ids on different hosts and replies reopen offline`

The earlier covered-reply title above records the test at that revision. Inline permissions now
require immediate reply focus with the composer visible; retaining the old deferred-focus assertions
would reject the intended behavior. The current execution is recorded below.

Inline permission, scrolling and session-grant evidence lives in
[inline permission verification](development-verification-test-tiers.md#inline-permission-verification).

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

Message metadata [collapses at rest](conversation-shell-message-bubble.md#the-meta-row),
so fixture row counts that once overflowed can become too short for held-reader or
history-demand checks. Measure `scrollHeight > clientHeight` and the required distance
from the bottom/demand band; increase fixture turns when necessary. Keep input-clearance,
reader-intent, paging and committed-visible-tail assertions intact. Reveal details before
measuring metadata boxes. Hold row focus through action-paint comparisons so hovering an
action cannot change metadata geometry under the baseline.

Hover and focus can resize rows before a wheel, checkbox or content-anchor assertion.
Settle the intended pointer/focus state before recording its baseline: move the pointer
away where hover is irrelevant, focus the checkbox before its Space baseline, and wait
for native motion to settle before measuring wheel displacement. Two animation frames
flush queued events; held-reader checks additionally need stable offset, content height
and viewport height after the corresponding rendered effect.

Stability alone can preserve a bottom baseline overwritten by resize-driven pinning.
A programmatic park during metadata reflow does not release following through the
geometry guard. Confirm completed overflowing history, settle dismissal/pointer geometry,
then establish trusted upward intent and prove movement and distance from the bottom
before recording a held baseline. Keep it immutable through arrival, initial focus,
same-request growth and drafting; position visible controls before their own baselines.
The [controlled observation](https://github.com/pyrycode/pyrycode-desktop/issues/1916#issuecomment-6097098604)
reproduced the exact 1125px → 1567px jump after all 24 rows rendered, distinguishing setup
intent from seeded delivery and Cancel focus. See
[inline permission reader verification](conversation-shell-scroll-pin.md#inline-permission-reader-verification)
for the controlled counts, 20 focused Linux/Xvfb passes with 3 workers and zero retries,
and the named test's full-gate result separately from an unrelated failure.

Known-gap demand measures marker intersection before native key scrolling, so
older-end proximity and an earlier screenshot do not prove eligibility. Pending
tool layout can overwrite a programmatic park while following. At both fresh-input
sites in the known-gap scenario, including protected restoration, settle pointer,
thread focus and measured scroll/content/viewport geometry before centering the
marker between the actual top/input chrome. Settle that movement, then assert
focused intersection and unchanged request count before one ArrowUp. Keep these
helpers local; readiness uses measured animation-frame stability without extra
trusted keys, sleeps, test retries or larger timeouts. See
[the gap testing contract](chat-history-testing.md#demand-and-snapshot-contracts)
and [controlled failure evidence](development-verification-history.md#known-gap-recovery-verification).

Protected-restoration joins need an explicit pre-input history-demand position. After
restored tool expansion and settled focus/hover, park at half the measured
`HISTORY_ASK_BAND_VIEWPORTS * clientHeight` band and assert positioning itself sends no
request. A Home press from outside the band can navigate without asking. After Home,
wait for `scrollTop === 0` before parking the held content anchor: its animation can
overwrite an anchor parked too early. Preserve join, DOM identity, tool expansion,
content-anchor, cursor settlement and request-count assertions. See
[the repair design](../../specs/architecture/1898-collapse-message-metadata.md#revisions)
and [counted metadata/restoration evidence](conversation-shell-message-bubble-testing.md#metadata-collapse-verification).

For message-action sizing, normal controls fit inside a short bubble, so
comparing normal and hidden buttons alone passes even without size containment.
[Message-bubble testing](conversation-shell-message-bubble-testing.md#action-sizing-regression)
records the test-only taller stack, browser height/gap comparisons and counted evidence.

A completed Playwright `hover()` does not guarantee that Chromium still matches
`:hover` at the following style read. Shown windows on one Xvfb display can deliver
native pointer input between those operations. Observe the target's `matches(':hover')`,
the hovered-row count and exact computed treatment together; a transparent resting
row with absent hover and a correct open fill does not establish a CSS defect.
The [sidebar investigation](https://github.com/pyrycode/pyrycode-desktop/issues/1819#issuecomment-6029550135)
reproduced that state by showing a second window after pointer delivery. Two frames
did not restore hover; an unfocused window could still retain the correct fill.

For that regression, each `expect.poll` attempt re-delivers real Playwright pointer
input, then captures hover, fills and control opacities in one synchronous renderer
snapshot. Apply the same observation over the trailing glyph and when parked away
from rows. Polling colours alone cannot restore persistently lost hover. Keep the
exact treatment and the geometry, keyboard-focus and activation assertions.
Prove sensitivity separately: removing only the hover-background declaration from
a scratch built renderer made this assertion fail with `hoveredRows: 1`, a transparent
resting fill, and correct open fill/control opacities. Recovery from input interference
must still detect a broken style. The replay recovered confirmed hover and exact fill
in 30/30 cycles; neither observation is a replacement for counted suite evidence.
See [Desktop isolation](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches) for the
distinction between this local observation and shared launch protection.

Native pointer input is separate from Playwright input. A window over the pointer
clears `:hover`; a corner window retains hover despite focus change.
Shown default-tier launches ignore native mouse events on current/later windows,
preserving renderer hit tests and actionability. Use an independent input-enabled
process for interference: same-app covers inherit protection and can falsely pass
a deletion mutation. Keep unprotected mutations serial to avoid pointer contention. See
[controlled boundary and counted evidence](e2e-harness-desktop-isolation.md#native-display-pointer-protection).

For a [Welcome stall](e2e-harness-desktop-isolation.md#separate-welcome-readiness-boundary),
retain `welcome-stall` and launch-fate before teardown. Controlled faults, green
reruns and the hover finding establish no Welcome cause. Check attachments through
real `TestInfo`, not just sink doubles. See [capture ownership and evidence](e2e-harness-launch-fate.md#welcome-stall-diagnostics).

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

The composer long-model cases first confirm native outer size and zoom through
[`configureComposerWindow`](../../../e2e/fixtures/composerWindowSetup.ts), then poll
both renderer dimensions against its returned content size divided by zoom with
one-pixel tolerance and a five-second bound. Two animation frames elapse before
opening the menu. A lost setter acknowledgement does not establish whether a change
ran; use [guarded native setup recovery](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads)
to inspect the effect, rather than passing setters to `readMainProcess` or blindly
replaying them. Native confirmation alone does not prove renderer reflow.

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

Host prompt/sidebar captures use `testInfo.outputPath` for each PNG, so a clean
machine needs no pre-existing `/tmp/builder-*` directory. A failed first capture
once prevented the subsequent acceptance assertions from running despite a
previous focused pass. On hidden Linux Electron windows, these specs prime a
native `BrowserWindow.capturePage(undefined, { stayHidden: true, stayAwake: true })`,
wait two renderer animation frames, then retain a second native capture. A lone
capture can retain the previous painted frame, and `page.screenshot` stalled on
the hidden fixture. Retain the paint barrier without showing/focusing the window.

The [host prompt verifier](https://github.com/pyrycode/pyrycode-desktop/pull/1787#issuecomment-6024523660)
compared current native empty, filled and long-default captures with fresh Figma
nodes 778-10211, 778-10265 and 780-10336 at the [reviewed revision](development-verification-test-tiers.md#host-prompt-verification). The 640px
panel, typography, helper/reset layout and growing default field matched with no
material discrepancy. Captures cover 1100×773, 800×873 and the scrolled footer at
800×423; mounted tests separately prove control reachability, including 800×240.
Reviewed images and a revision/hash manifest were retained under
`/tmp/verifier-1787/head-1082bcff/`. These are recorded scratch artifacts, not
committed assets or proof of interaction by themselves.

Counted browser results, original capture paths and reviewed visual comparisons for the
translucent conversation and Markdown reader layouts live in the
[layout evidence reference](development-verification-layout-evidence.md).

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
not committed assets. Those Linux Xvfb Playwright captures used the existing
`PYRY_E2E_SHOW_WINDOW=1` fixture option. Hidden-window capture can instead use
Electron's native capture with the paint barrier described above.

Resolution-pill visual evidence covers four states: remote and timeout at both 1280×800 and
800×600 window sizes (1280×772 and 800×572 content viewports). The
[review of implementation revision `1b6aabfe`](https://github.com/pyrycode/pyrycode-desktop/pull/1719#issuecomment-5929842972)
records all four captures compared with Figma Top overlay `132:4171` and Default pill `347:6617`:
token colours, body-small typography, padding, radius, shadow, right alignment, 12px stack spacing
and the exact 8px X matched, and both copies fit at minimum width. Integrated captures show usage
plus resolution; simultaneous usage/resolution/Re-pair order is a static-render assertion backed
by shared layout source, rather than a three-pill screenshot. Captures prove appearance; the
[fake-transport resolution spec](development-verification-test-tiers.md) proves lifetime and interaction.

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

### Composer native setup verification

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1838#issuecomment-6030292632)
records the reliability proof on 2026-10-07 at
`6c41d12d725fa8f60c80ad6524ce001a662a2c4d`. It independently checked the builder's
focused JSON report for `playwright test e2e/composer-options-clamp.spec.ts
--grep 'long footer model labels' --repeat-each=10 --retries=0 --reporter=json`
under Xvfb: 20 executed, 20 passed, 0 failed, 0 skipped, 0 flaky, every result retry 0.
Both named tests were present and passed ten times:

| Named test | Executed / passed |
| --- | --- |
| `long footer model labels stay readable and selectable at 1280 with zoom` | 10 / 10 |
| `long footer model labels stay readable and selectable at 800 with zoom` | 10 / 10 |

Each case still covers native 1280×800 or 800×600 at both 100% and 125% zoom:
panel and complete wrapped/unbroken label containment, visible focus outlines,
keyboard selection, a real click on the final label line, intended model values
and restored trigger focus. The separate `the options panel fits the pane and
restores its width on resize` case retains its width/shift restoration proof.

The builder's full fake suite (`playwright test --retries=0 --reporter=json`) used
the default 3 workers: 324 executed/passed, 0 failed, 4 platform skips, 0 flaky,
all retry 0. Dispatcher verifier gate 6 (`npx playwright test --reporter=json`)
independently records 324 executed/passed, 0 failed, 4 skipped at the reviewed head.
The verdict confirms all three composer cases were present, executed and passed
in both full runs (3 executed/passed, 0 failed, 0 skipped). The skips were two
app-badge cases, history close/reopen and window-reopen convergence on Linux;
none counts as proof. Global retry/worker settings and menu assertions are
unchanged. This is fake-transport evidence; no live Claude or upstream-trigger
reproduction is claimed. See [diagnosis and deterministic fault coverage](e2e-harness-context-recovery.md#tolerating-a-transient-inspection-context-loss-on-reads).

### Inline question verification

Inline-question interaction, live continuation and reviewed captures are recorded in
[the test-tier reference](development-verification-test-tiers.md#inline-question-verification).

## Live-test diagnosis

A real-Claude failure can come from the installed daemon being too old or too new
for the client contract. It can also be an unrelated race.
Check the daemon version and the capabilities the test needs.
Confirm the actual test executable's source revision contains the prerequisite merge. A focused
pass against a temporary binary leaves a stale dedicated test binary unchanged; rerun against
the executable the dispatcher uses before treating that environment as repaired.
A release version needs a source mapping: use the executed binary's build metadata and release
tag, rather than a revision from a separate checkout. If a neighbouring spec supplies the identity,
record why it and the named cases used the same executable in the same run.
Compare neighbouring gate runs and per-spec durations before assigning the cause.
Search existing bug tickets before creating another.

The real suite can exit successfully while every test skipped.
Read executed counts, skip reasons and failure evidence.
The automatic dispatcher gate remains the acceptance check for live behaviour.
Follow the Desktop harness and current role instructions for credentials and runs.
Do not import the daemon repository's Go-specific live-test commands.

Capability-gated failures can share a setup cause even when their bodies exercise different features.
If only `requiredCapabilities` consumers time out waiting for the seeded sidebar row after pairing,
check the pre-app probe's credential ownership before diagnosing question delivery or app capability
advertising. First-key binding makes a successful probe with the app's token prevent the app's
independent key from authenticating. See the
[separate-pairing fixture and regression](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists).

Recorded evidence for [#1785](https://github.com/pyrycode/pyrycode-desktop/issues/1785): the
[dispatcher live verdict](https://github.com/pyrycode/pyrycode-desktop/issues/1785#issuecomment-6004782077)
ran branch `29e351d298a78ef5a488b909a5dce8f80c51d273` integrated with main `cb82a7d9d5` on
2026-10-05. The run `2026-10-05T22-45-56-174Z` executed 24 tests: 24 passed, 0 failed, 1 skipped.
The dispatcher-provided per-test gate report confirms each required case was present and passed:

| Spec | Named test | Result |
| --- | --- | --- |
| `real-claude-question-answer.spec.ts` | `real claude changes model during a question and resumes with the original answer` | Executed, passed |
| `real-claude-question-cancel.spec.ts` | `real claude raises a clarifying question that refusing through Cancel stops the gated work` | Executed, passed |
| `real-daemon-multi-agent.spec.ts` | `a real daemon echoes interactive and multi_agent in the app hello_ack` | Executed, passed |

These three account for 3 executed, 3 passed, 0 failed and 0 skipped. The suite's single skip is
`real-claude-system-prompt.spec.ts` → `real claude picks up a saved channel system prompt at Reset
session`; the evidence comment records no skip reason. The dispatcher-host report is
`pyrycode-desktop-agents/logs/2026-10-05T22-45-56-174Z_real-claude-gate_#1785.log`.
This proves the named live results against the built app and local relay.

**Daemon provenance:** the run's daemon was release `0.34.0`, built from pyrycode tag
`v0.34.0` at source revision `9834e99ee046b9f94b528c2c83c7bd03f389cc41`. The same JSON report
records `daemon-revision` `0.34.0`, parsed from `pyry version`, in every spec that checks it,
including `real-daemon-archive-order.spec.ts`, which ran between the question-cancel and
multi-agent cases. The three named specs do not attach it themselves. They spawn their daemons
from the same `PYRY_BIN`, `/usr/local/bin/pyry` in the dispatcher image, within the same
single-worker run. That image installs the daemon with `go install` of `cmd/pyry@v0.34.0`; the
binary's build info records module `v0.34.0` with sum
`h1:5Xfhf9XwYuRp1TT1rk9LgGIWRfbcMdw42CwfwXQSWgw=`, which the Go module proxy resolves to
`refs/tags/v0.34.0` at that revision. It contains daemon commit `4d651424` from
[pyrycode#2734](https://github.com/pyrycode/pyrycode/issues/2734), so this run exercised
first-key binding. See the
[provenance comment](https://github.com/pyrycode/pyrycode-desktop/issues/1785#issuecomment-6010788994) on the ticket.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1792#issuecomment-6004715409)
records 8,835 unit tests executed/passed, 0 failed and 3 skipped, including all 18 fixture/capability
tests. Its fake-transport gate executed/passed 276 tests, 0 failed and 4 skipped; the three named
live cases were excluded there. This separates fixture regression evidence from live acceptance.

## Review and document hygiene

The pipeline uses one GitHub identity. A reviewer cannot approve or request changes
on its own account's pull request. Post the verdict as a comment and use the role's
issue labels. Keep the issue number separate from the pull request number.

Scratch directories keyed only by pull request can contain an earlier rework run's
review. Read existing evidence and use a distinct file for the new verdict.

Inspect the end of every added Markdown document for tool-call scaffolding.
The documentation guard scans feature docs and cannot prove that every changed
Markdown file is clean. A successful rendered preview can also hide stray tags.

CodeGraph's existing ignore patterns do not cover every runtime artifact. Check
`.codegraph/codegraph.lock`, `.codegraph/writer.pid`, `.codegraph/codegraph.db-shm`
and `.codegraph/codegraph.db-wal` against both the tracked diff and
`git check-ignore -v`; an ignored file can still be tracked. Repository-local Git
exclusions keep these generated lock/PID and mutable SQLite sidecar files out of
automatic commits while preserving the running index's local files.

A listener-count warning may predate the change. Compare against the base before
calling it the cause. Browser console events need explicit collection when the
existing fixture does not forward them.
