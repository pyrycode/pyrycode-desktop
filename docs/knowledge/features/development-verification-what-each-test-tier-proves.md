# Development verification — what each test tier proves

Static, mounted and live proof boundaries, with counted regression evidence.
See [development verification](development-verification.md) for the topic map.

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

Keep report basenames distinct from app/worktree directories: a sibling `historical.json`
shadowed `historical/` during Electron module resolution and prevented startup.
Playwright grep matches project/file prefixes as well as the title; a fully anchored
bare title can select zero tests. Select the exact unique title suffix and confirm
nonzero executed counts in the JSON report before recording acceptance. See
[retained setup and acceptance evidence](composer-attach-name-pill.md#controlled-hover-and-geometry-verification).

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

