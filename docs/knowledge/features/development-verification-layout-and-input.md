# Development verification — layout and input

Measured layout, native input, focus and capture verification.
See [development verification](development-verification.md) for the topic map.

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
allow queued events to run; they do not acknowledge a particular scroll handler.
Held-reader checks additionally need stable offset, content height and viewport height
after the corresponding rendered effect.

For streaming message copy, settle the attached send's completed assistant reply
before injecting an independent delta. Locate the intended source explicitly and
assert its exact committed text and cursor; a cursor on a dynamic last row can
belong to another turn. Transfer focus before pressing, then hover and require
identical button bounds and thread scroll offset/content height across consecutive
animation frames with focus and hover held. A trusted pointer-down is insufficient:
metadata reflow during the press can move Copy so release hits Reply and click
lands on their common container. Require a trusted click on Copy itself, followed
by exact OS clipboard readback. First verify a different value from an earlier
ordinary activation so a stale matching clipboard cannot satisfy the assertion.
Keep ordinary activation, clipboard serialization and desktop isolation intact.
See [streaming copy readiness and counted evidence](conversation-shell-message-bubble-testing.md#streaming-copy-input-readiness)
for the controlled 28px movement and distinction from the unrecorded historical
schedule. Retain readiness samples even when polling or activation fails; the
current side-actions spec attaches them only after activation reaches its
receipt/readback `try/finally`, a nonblocking diagnostic limitation noted by review.

The supplied-agent regression in [`thread-items.spec.ts`](../../../e2e/thread-items.spec.ts)
registers its target scroll listener after React's listener, so its count and offset
acknowledge processing after `rememberTop`. Settle native Home before parking row 100;
then require a newer processed event at the parked offset and 20 unchanged frame
samples of offset, content/viewport dimensions, row position and processing state.
Keep the probe local to the spec and remove its listener after preservation checks.
An aligned row by itself cannot prove that the hook remembers it.

The fixture's `commitUpdate` wraps the ordinary typed update in React `flushSync`.
Only the agent regression uses it, committing immediately after readiness in the same
renderer task so an incidental Playwright/protocol delay cannot hide missing readiness.
Positive agent child counts certify reparent commit; rendered older row 5 certifies
insertion before settling and comparing with the immutable baseline. Removing only
park readiness deterministically fails both widths at the original position assertion.
The [controlled diagnosis and counted runs](conversation-shell-scroll-pin.md#supplied-snapshot-anchor-restoration)
distinguish this setup race from a settled-reader defect without claiming the
unavailable original failure trace. Production behavior remains unchanged.

An earlier successful bottom/spacing poll cannot certify a later newest-row read:
hover or action focus can reveal metadata between them. The
[composer status-spacing regression](conversation-shell-composer-status-row.md#composer-status-row-796)
observes chrome geometry, input height, overflow and scroll endpoint together on
consecutive animation frames. Require identical snapshots and every expected value;
stable but incorrect geometry must still fail. Retain both snapshots from each poll
attempt, including dimensions, scroll metrics and hover/focus, even on failure.
Exercise late action focus and prove it remains held after zero bottom clearance
settles. Keep this observation local to the scenario, with the existing numeric
assertions, timeouts, retries and parallelism. Two frames by themselves do not prove
settlement when their measurements disagree. See [counted proof](#composer-status-spacing-verification).

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

For metadata wheel checks, completed row delivery and stable geometry are necessary
but do not establish native input/layout ordering. The retained
[`turn-stats-hover` regression](conversation-shell-message-bubble-testing.md#metadata-wheel-ordering-verification)
confirms all 42 rows and more than 1500px overflow before wheel navigation. It samples
offset/content/viewport over 20 consecutive stable frames after pointer/focus changes
and native input. Held setup uses trusted upward motion, proves positive displacement
and distance from bottom, then checks a short downward nudge does not snap to bottom.
Assert that the focus target is actually above the viewport and its details visibly
reveal/collapse before comparing the same immutable reference through both effects.
Never reset scroll or replace the reference after the action to obtain clearance.

A read-only geometry listener can flush layout and change the ordering it observes.
Here one `scrollHeight` read in a one-shot native wheel listener forces layout before
scroll delivery, reproducing an equal-height metadata exchange that leaves the reader
28px short. Treat such traces as controlled interventions, distinguishing them from
passive observations of an original gate. Twenty uninstrumented passes on unchanged
production missed this gap; the layout-read control failed 3/3 before repair and
passed 3/3 after it. The linked evidence records counts, both widths and the repaired
test's focused/full-gate results without claiming the original unrecorded schedule.

Known-gap demand measures marker intersection before native key scrolling, so
older-end proximity and an earlier screenshot do not prove eligibility. Pending
tool layout can overwrite a programmatic park while following. At both fresh-input
sites in the known-gap scenario, including protected restoration, settle pointer,
thread focus and measured scroll/content/viewport geometry before centering the
marker between the actual top/input chrome. Settle that movement, then assert
focused intersection and unchanged request count before one ArrowUp. Keep these
helpers local; readiness uses measured animation-frame stability without extra
trusted keys, sleeps, test retries or larger timeouts. See
[the gap testing contract](chat-history-testing-contracts.md#demand-and-snapshot-contracts)
and [controlled failure evidence](development-verification-history.md#known-gap-recovery-verification).

Retry focus can also reset the thread to scrollTop 0 after a marker was parked.
Re-park the loading marker after retry focus/layout settles, then take the
immutable anchor baseline. Otherwise a named row below the viewport's top can
move when older rows arrive while the actual visible top anchor correctly stays
put. Retain exact cursor/request counts and the <2px preservation assertion. The
[native-view recovery plan](../../specs/architecture/1991-native-hosted-view.md#revisions)
records controlled focus-time movement and retry geometry; the
[counted full-suite evidence](daemon-connection-hosted-resource-views.md#native-viewer-verification)
does not establish the cause of the separate unrecovered history-walk failure.

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

For hover geometry, capture actual hover/focus, exact treatment and every relevant box
in one synchronous renderer snapshot, comparing layout with its resting baseline.
Record absent boxes explicitly: loss of both hover and focus can switch a pill to
`display: none` after visibility passes. A null-only guard or passive style poll does
not establish the complete observation. If protection leaves a residual failure,
re-deliver ordinary Playwright hover on each bounded observation attempt, retaining
every assertion and normal actionability, timeouts, retries and parallelism.

Prove treatment and geometry sensitivity separately with actual hover present.
The [attachment controls](composer-attach-name-pill.md#controlled-hover-and-geometry-verification)
fail the original background equality and vertical-placement assertion independently,
with present boxes and true hover; temporary CSS changes are negative controls only
and must be restored before acceptance. Frames acknowledge paint/events, not hover
recovery. The protected comparison needs no shipping correction and cannot confirm
the overwritten original #1818 occurrence. Raw observations, patches and failure
artifacts are retained in `/tmp/builder-1833/retained-proof.tar.gz`.

For a [Welcome stall](e2e-harness-desktop-isolation.md#separate-welcome-readiness-boundary),
retain `welcome-stall` and launch-fate before teardown. Controlled faults, green
reruns and the hover finding establish no Welcome cause. Check attachments through
real `TestInfo`, not just sink doubles. See [capture ownership and evidence](e2e-harness-launch-fate.md#welcome-stall-diagnostics).

A sticky offset is relative to the scrollport content box.
Read the running window's boxes when a padded scroller is involved.
Flow arithmetic alone can predict the wrong boundary.
An overlay can paint beneath a later positioned sibling when both use automatic
stacking or equal explicit levels. Check the complete ancestor and sibling arrangement.

The [create-channel model list](create-channel-dialog.md#how-it-works) escapes the modal's
scrollport at ordinary heights by fixing only the list at measured trigger bounds. Keep modal
overflow `auto`: a natively resized textarea can push the footer beyond even a tall window,
so a window-height breakpoint alone cannot justify disabling modal scrolling. Drive the resize
handle, open Model, wheel the modal, then verify both footer controls are reachable and cancel.
Anchor updates must follow modal/field resize, window resize and modal scroll, with observer and
listener cleanup. At heights at or below 550px this list stays in the modal's scroll flow.

Small SVG imports can become Vite data URLs that the renderer CSP rejects. The create-channel
chevron uses the unchanged raw local SVG through a lifecycle-owned blob URL, revoked on cleanup,
as an alpha mask coloured by `--color-primary`. Loading an external image alone would preserve
the SVG's hardcoded fill and bypass live theme changes. Interaction evidence must both load the
mask asset and change the theme token to check computed colour; static markup proves neither.

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

Reader reopen input needs geometry stability after focus changes, too. Playwright's
pre-click stability check can precede hover revealing `.bubble__meta--details`;
bottom pinning then moves the link before pointer delivery. In
[`markdown-reader-menu.spec.ts`](../../../e2e/markdown-reader-menu.spec.ts),
`settledThreadPosition` requires 20 consecutive equal frame comparisons of thread
offset, content/viewport height and link x/y/width/height, rejecting after 120 sampled
frames. Focus Back before the first preservation baseline and focus the link before
the final pointer click. Keep the exact Back position assertion before this new
focus/settlement so preparation cannot overwrite the preservation proof. Retain
fresh-content and request-count assertions, diagnostic attachments and keyboard Back;
there is no click retry, fixed sleep or timeout increase. The
[controlled failure and repaired input](development-verification-layout-evidence.md#reader-reopen-input-verification)
establish the setup race; unchanged green repetitions alone cannot establish its cause.

Covered-thread preservation has a separate boundary: native resize can clamp a
released thread even after its positive baseline settled. The reader cases retain
a trusted upward wheel before ordinary opening and prove it moved, then normalize
Back focus before taking the immutable baseline. Settle measured thread geometry
at every native size/zoom phase, keeping native size/zoom and renderer reflow as
separate observations. Compare exact position and draft after pointer Back at the
original dimensions/zoom, before resizing or focusing the reopen link. Reopening
at the alternate size and making another resize round trip checks that keyboard
Back preserves the new open's own record. Keep full-pane, notice clearance,
final-content/menu bounds and pointer/keyboard/request-correlation assertions.

Local `thread-scroll-phases` diagnostics record thread offset, content/viewport
dimensions, link bounds, native outer/content size, zoom and focus at baseline,
resize/zoom and Back, alongside timestamped scroll/resize samples. A test-wide
`finally` removes the probe listeners and attaches evidence even if an assertion
fails before reopen. The [controlled failure and Linux validation](development-verification-layout-evidence.md#reader-resize-scroll-preservation)
show persistent settled-state loss despite later phase settlement; they do not
recover the historical 1300→1020 schedule. Stable bottom geometry does not prove
following intent, and a readiness-only change cannot restore an already-clamped
held offset. See [the production contract](conversation-shell-scroll-pin.md#covered-reader-resize-preservation).

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

### Visible-tail focus reliability

In [`visible-tail-read.spec.ts`](../../../e2e/visible-tail-read.spec.ts), a timeout
at `document.hasFocus()` does not establish concurrent-window focus theft. The
[classification and retained evidence](../../specs/architecture/2051-visible-tail-focus-reliability.md)
record two independent Linux complete-suite failures on `b3291233`, each
**435 executed, 434 passed, 1 failed, 3 skipped**, four actual workers, both
projects and zero retries. Each completed `read-work-30`, installed the second
document probe, then failed the five-second genuine-focus poll before
`read-work-400`; both apps remained running at outcome and exited cleanly.
The isolated baseline/candidate/batched comparison was pass/fail/pass, each
**1 executed, 0 skipped**, zero retries and one actual worker. Concurrent test
windows were therefore unnecessary to reproduce the failure.

Repeated synchronous protected-path writes are the supported storage-related
trigger: #2044's batching repair coalesces writes within the transaction, and
complete compositions subsequently passed with focus/display code unchanged.
The reports measure neither main-loop latency nor native-window/webContents focus,
so the exact path from storage work to delayed page focus remains uncertain.
Keep the [400-item coalescing regression](chat-history-testing-storage.md#owned-mutation-regressions-and-counted-validation)
and existing read spec; no residual setup defect or duplicate regression is justified.
The helper shows/focuses the native window, removes any document focus override,
and positively polls genuine `document.hasFocus()` before its focus notification.
Preserve that predicate, processing/React-commit barriers, observer lifecycle and
read-work assertions at both 30 and 400 rows. A synthetic event alone cannot supply
the positive barrier; longer timeouts, retries, skips or serialization would weaken
the existing proof.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2057#issuecomment-6213507072)
records final-head acceptance on `a0200f81b4fea6d186b1eceb2bb77edd4450c704`,
2026-10-16, Linux x64. `npx playwright test --reporter=json` ran **436 executed,
436 passed, 0 failed, 3 skipped, 0 flaky**, four actual workers, clipboard
**30 passed** and parallel **406 passed/3 skipped**, zero retries and no filters.
Shown Linux windows and the shared run-owned Xvfb display remain unchanged.
The named `read setup is reused across committed same-row deltas on short and long threads`
case was present and passed: **1 executed/passed, 0 failed/skipped**, retry 0.
Both `read-work-30` and `read-work-400` report zero constructors/discovery/listeners/
subscriptions, complete documents and clean two-app launch fate. There were no
top-level errors or fake-daemon setup-failure attachments; stderr contains only
the existing Vite CJS warning. Skips are two macOS badge cases and macOS window
reopen; macOS and live-Claude are outside this ticket's scope.

The plan separates the dependency's 435-case pass, builder's 435-case pass on
`42b94d17`, documentation-only evidence commit `25fc4fec`, and this later
436-case gate after main's initial-thread-loading/Retry regression merged.
Inspect retained reports before requesting another run: a stale refinement
summary can omit subsequently available complete-suite evidence. A targeted pass
alone does not prove full-composition reliability or erase the historical failures.

### Visible-tail native acknowledgement verification

The [diagnosis with original/rerun log identities](https://github.com/pyrycode/pyrycode-desktop/issues/2074#issuecomment-6221656181)
and [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/2075#issuecomment-6222009186)
distinguish two historical failures of `committed folded tails require focus,
uncovered viewport and a closed reader` in `visible-tail-read.spec.ts`:

- The #2072 gate at `20fd3f8bc5` failed after 1464ms at `focus`'s initial native
  `app.evaluate`, before read assertions, with `Execution context was destroyed`.
  The unchanged retry-0 rerun passed in 3644ms through target 38. Launch-fate showed
  a running app, exit 0, no signal and clean teardown. The confirmed defect was
  unhandled ambiguous setup acknowledgement; whether show/focus executed before
  loss, renderer navigation/crash and the upstream inspector trigger remain unproven.
- The earlier #2043 occurrence instead waited 5000ms for target 37 after `end(37)`,
  observing 36 (6778ms total); its unchanged rerun passed. Preserve `b345232b`'s
  queued-scroll drain before that completion and the exact target assertion.
  The later focus-evaluation failure does not establish a common upstream cause
  or show that the scroll repair failed. No external prerequisite was demonstrated.

The diagnosis links portable bundles `99a483213866ece7b6eedddf2be895c8aeb3f9706ab790e4591ee4012421d7f1`
(#2072) and `74069c5b59158442f6b2badee74cdbde4b6b0fb0658af234b4d6d7a0d10e5aae`
(#2043), original SHA-256 records and full original/rerun log paths. Builder copies
were retained under `/tmp/builder-2074/evidence-{2072,2043}/`. These observations
are separate from the preceding genuine-document-focus timeout investigation.

The [guarded helper and callback coverage](e2e-harness-context-recovery.md#native-window-setup)
confirm effects before recovery can resend controls. The controlled
`npm test -- e2e/fixtures/visibleTailFocus.test.ts` baseline ran **19 executed,
2 passed, 17 failed, 0 skipped** against the extracted original setup; the repaired
run recorded **19 executed/passed, 0 failed/skipped**. Failures were at the intended
acknowledgement/confirmation boundary. Logs are `/tmp/builder-2074/fault-before.log`
and `fault-after.log`. Injected faults prove recovery semantics, without reproducing
the unknown upstream trigger.

Linux x64 browser evidence at implementation
`3c7d9ed72f877ab7687f92584941374962941853` (including main `2eafa533b9d4`)
used these commands, with the existing configured two workers:

```sh
npx playwright test e2e/visible-tail-read.spec.ts --grep 'committed folded tails require focus, uncovered viewport and a closed reader' --repeat-each=20 --retries=0 --reporter=json --output=/tmp/builder-2074/focused-results
npx playwright test e2e/visible-tail-read.spec.ts --retries=0 --reporter=json --output=/tmp/builder-2074/spec-results
```

| Run | Executed | Passed | Failed | Skipped | Configured / actual workers |
| --- | --- | --- | --- | --- | --- |
| Named scenario repetition | 20 | 20 | 0 | 0 | 2 / 2 |
| Complete visible-tail spec | 7 | 7 | 0 | 0 | 2 / 1 (one serial file) |
| Complete configured verifier gate | 492 | 492 | 0 | 4 | 2 / 2 |

Both builder reports, `/tmp/builder-2074/focused.json` and `spec.json`, contain the
exact named scenario present/passed, zero flaky results, only retry index 0 and no
report errors. Matching `.stderr` files are empty; output directories above retain
artifacts. All 27 launch-fate attachments across 28 launches show running at outcome,
exit 0, no signal and no teardown failures, with no fake-daemon setup-failure attachments.

The complete Linux gate at `3f1ec3ac384789dc74c297f6a26bcd1a9ea5874a`,
2026-10-16, ran `npx playwright test --reporter=json`: the exact named case passed
in 3038ms, retry 0, and all seven visible-tail cases passed. The table's full-gate
counts have zero flaky results and report errors, with zero retries. Retained report:
`/work/Projects/pyrycode-desktop-agents/logs/verifier-gate_#2074_8.log`, alongside
`verifier-gate_#2074.pass.json`. Only plan evidence changed after the builder's tested
implementation. The four existing skips are three macOS-only badge/window cases and
the independent system-prompt-reset fixme. The unit gate includes all 19 focus faults
present/passed: **9,337 executed/passed, 0 failed, 3 skipped**, 404 passing files.

These recorded passes preserve genuine document focus, every read target and
committed-content check, blur/visibility/reader/chrome exclusions, processing/commit
barriers, scroll drains and observer lifecycle assertions. Timeouts, worker configuration
and skips remain unchanged, without fixed sleeps or assertion weakening. No production
or visual behavior changed; provider/live-Claude checks are not required. Other operating
systems are outside this Linux ticket's verification scope.

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

### Composer status-spacing verification

The [diagnosis](https://github.com/pyrycode/pyrycode-desktop/issues/1953#issuecomment-6175600713)
and [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1954#issuecomment-6175788661)
record a controlled observation race and its repair, reviewed at revision `3bba3878`
on 2026-10-14.
The two original failure/rerun logs from the earlier gate were not recovered;
their assertion, values and cause remain unknown. Green unchanged runs do not
establish that occurrence's cause.

At native width 1280 with an empty draft, late newest-action focus after successful
bottom/spacing polls changed content height from 1613 to 1641 at scrollTop 880 and
viewport height 733. The one-shot `chrome.top - newestRow.bottom` assertion returned
−28px instead of 0. After frame processing it returned 0 with action focus retained.
Ordinary hover also produced content growth from 1585 to 1613 at offset 852, transient
−28px clearance, then offset 880 and clearance 0. The comparison distinguishes a
transient observation boundary from a persistent product geometry defect; it does
not identify the unrecovered original failure. No production or native-resize
correction shipped.

Retained reports under `/tmp/builder-1953/` record `controlled.json`: 1 executed,
1 intentional failure, 0 skipped; `repaired-control.json`: the same input,
1 executed/passed, 0 failed/skipped. Persistent CSS controls each executed 1 and
failed 1, with 0 skipped: `status-mutation.json` observed stable 17px upper spacing
instead of 16px; `padding-mutation.json` observed stable 1px padding/clearance error
instead of 0. All used zero retries. Commands, diagnostic patches and measurements
are linked from the diagnosis; raw failure artifacts and patches were retained in
`/tmp/builder-1953/retained-proof.tar.gz`. Temporary control hooks are absent from
the shipping spec.

The exact named test, `status spacing and measured input clearance hold with a
warning and five-line draft`, was present and passed all 20 focused executions:
20 executed/passed, 0 failed, 0 skipped, 0 flaky, every retry 0, with 4 workers.
The recorded command was:

```sh
xvfb-run -a npx playwright test e2e/composer-status-spacing.spec.ts --grep 'status spacing and measured input clearance hold with a warning and five-line draft' --repeat-each=20 --retries=0 --reporter=json --output=/tmp/builder-1953/final-results > /tmp/builder-1953/final.json
```

Dispatcher verifier gate 6, `npx playwright test --reporter=json`, used 4 workers:
395 executed, 394 passed, 1 unrelated failed, 3 skipped, all retry 0. The supplied
gate report confirms the exact composer test was present and passed; the verdict
records its 1 executed/passed, 0 failed/skipped result. The verdict separately
records the unrelated hover-test rerun as 1 executed/passed, 0 failed/skipped.
The supplied report contains no full verifier-gate pass; that rerun does not
replace or enlarge the composer evidence. Both proofs use fake transport.

### Inline question verification

Inline-question interaction, live continuation and reviewed captures are recorded in
[the test-tier reference](development-verification-test-tiers.md#inline-question-verification).
