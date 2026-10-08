# Conversation shell — thread scroll pin

Whether `.conversation__thread` stays pinned to the bottom as new content arrives, and — since
[#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) — what happens when older content
lands at the *top* instead. Split out of [Conversation shell § Edge cases and
limitations](conversation-shell.md#edge-cases-and-limitations) on 2026-09-07 to stay under the size cap,
since this one topic had grown into most of that section.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its
other edge cases and its links.

## Thread scroll pin

[`useThreadScrollPin`](../../../src/renderer/src/screens/conversation/ConversationScreen.tsx)
keeps a DOM-local `following` ref, initially true. Scroll/input handlers update it;
a successful send re-arms it through `followBottom`. Trusted upward wheel input,
including trackpad wheel events, and ArrowUp/PageUp/Home targeted at the thread itself
release following synchronously when `scrollTop > 0`, before native scrolling starts.
Waiting for `onScroll` would let a render or row-growth observation re-pin during the
input-to-scroll interval and interrupt Chromium's animated movement. Untrusted input
does not release intent; keys targeted at descendant controls retain their behavior.
At zero, input leaves following unchanged unless connected history demand deliberately
releases it; see [User demand and prepend position](#user-demand-and-prepend-position).

The 4px bottom tolerance allows rounding while already following. A released reader
resumes only on downward movement into that band, rather than merely being inside it:
even a 1px upward wheel must remain released through subsequent streaming growth.
The DOM-local `scrollOffset` ref snapshots the offset at upward input and refreshes on
every scroll before the echo/resize guards, so those events cannot leave stale direction
measurements. A dependency-free layout effect and a `ResizeObserver` call the same
guarded `reassertPinnedToBottom` write. Both read intent without re-enabling it. Neither
re-measures whether the operator was at the bottom after content has grown: that
would mistake new content for reader movement. A submission that sends nothing does
not resume following. Scrolling away again during a reply still wins.

The [full-pane layout](conversation-shell-chrome.md#layout-contract) overlays the
header and input area on the existing `.conversation__thread` scroller. Its viewport
no longer shrinks when the draft grows. `measureThreadChrome(pane)` reads the occupied
border-box heights, including header notices and the entire input slot, and writes
`--thread-header-height` and `--thread-input-height` on `.conversation__covered`.
Stylesheet padding reserves header height plus 12px at the start and input height at
the bottom, with 20px horizontal insets. The connected resting first row therefore
keeps its 97px clearance. Top overlay pills use header height plus their 12px gap;
the drawer uses both heights to leave controls usable.

Bottom-following is scroll intent, not proof that a durable message was read.
The [read observer](conversation-last-read-store.md#how-it-works) separately measures
the newest message's trailing edge against these occupied chrome borders after
display commit, requiring document focus and a closed Markdown reader. Geometry
callbacks use the committed slice, so new receipt evidence cannot outrun rendering.

Measure before re-pinning and before zero-offset prepend compensation. Occupied
height includes status, attachment previews and multiline draft growth/shrink.
Inline permission/trust cards and questionnaires grow inside history and do not add
input-slot height. Temporary inline bottom padding
belongs only to short-history compensation. `reassertPinnedToBottom` removes that
inline property when following resumes, exposing the measured stylesheet clearance;
putting overlay clearance into the same inline property would lose it on send.

The observer watches the covered pane, both chrome boxes, the thread when mounted,
and every direct-child row. Chrome-only leaf renders must be observed directly:
watching the thread's border box alone no longer detects composer changes, and
hoisting every leaf store subscription would re-render the timeline unnecessarily.
Likewise, a fixed scroll container's border box does not change when a row's decoded
image grows. Row observation catches that content growth. The callback re-reads both
refs, measures chrome even without a thread, and pins only a mounted, following
thread. An empty offline chat can omit `Timeline` while notices and Re-pair remain;
measurement rooted only in the scroller would place that pill inside the header.
Current observation targets are added on renders; the observer disconnects on root changes and
at teardown. Removed direct children are not unobserved; see the inline-batch limitation below.
Heights and following remain DOM/ref-local rather than store state.

`QuestionHistorySlot` is the stable observed direct child for inline permission and questionnaire
content. It mounts only while an open-chat batch, permission or owned rejection exists, including
empty/offline histories; an empty trailing element would suppress the normal welcome state.
Permission's entire title/context/rules/choices and external Cancel scroll in this thread rather
than a capped inner scrollport. Arming and leaf-only content growth change the wrapper's height:
the observer follows that growth only when `following` is already true.

Initial hinted Cancel focus uses `focus({ preventScroll: true })`. Without it, focusing the newly
arrived offscreen card would move a scrolled-up reader despite the guarded pin. The fake-transport
case `inline arrival and growth follow pinned readers while focus preserves held position` proves
pinned arrival/arming and held-reader arrival, Cancel focus, content growth, composer drafting,
visible-checkbox editing and visible-choice arming. It waits two animation frames after positioning
to let the scroll event update `following`; offscreen controls are first deliberately scrolled into
view so native focus movement is not confused with growth. See
[counted inline evidence](development-verification-test-tiers.md#inline-permission-verification).

Resize and Electron zoom can cause native anchoring to emit a scroll before resize
observations arrive. The hook remembers the last observed `clientWidth` and
`clientHeight`. While following, a scroll with changed dimensions leaves the decision
to the pending observer rather than clearing the flag on layout movement. That
observer refreshes dimensions after the guarded pin. At unchanged dimensions, reader
scrolls still release following outside the bottom band or resume it on downward
movement into the band. This covers narrowing, widening and 100%/125%
zoom without adding another follow state machine.

`pinnedOffset` protects the pin's own scroll-event echo. It records the exact offset
read back after a write that actually moved the thread, and is cleared on every scroll
event, matching or not. A matching echo does not re-measure following. Without this,
a thumbnail's initial 12px margin can trigger a pin whose queued scroll arrives after
the decoded image has added another 160px; the event then clears following just before
the observation that could close the gap. A no-op write records no echo, so it cannot
swallow the operator's next real scroll.

Keep native `overflow-anchor: auto` by leaving `overflow-anchor` unset. Chromium
holds a reader when an image above them grows without any React render; a hoisted
React read would still run before decoding and cannot replace anchoring. Growth below
the reader, including an image in their last row, requires row observation while
following. Native anchoring runs before the observer, so the shared pin is a no-op
when the browser already reached the bottom and writes nothing while reading away.
These mechanisms originate in [#1046](https://github.com/pyrycode/pyrycode-desktop/issues/1046)
and [#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049); the measured chrome
extension is [#1733](../../specs/architecture/1733-translucent-thread-controls.md).

[`translucent-thread-controls.spec.ts`](../../../e2e/translucent-thread-controls.spec.ts)
proves unchanged full-pane viewport, start alignment, rows beneath both controls,
actual overlapping clicks, held arrivals, send resumption, draft/attachment/question
clearance, native window resizing and zoom at 1280×800 and 800×600. Its empty-offline
case clicks Re-pair below the measured header.
[`composer-message-box.spec.ts`](../../../e2e/composer-message-box.spec.ts) checks the
matching padding delta when the draft grows rather than expecting viewport shrink.
[`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts) retains send,
late-image, queued-content and prepend checks. The late-image fixture needs enough
rows to park more than a viewport away: its 24 synthetic replies preserve that
precondition after the viewport grew to fill the pane. See
[recorded browser and capture evidence](development-verification.md#layout-and-input).

### Streaming input verification

[`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts) uses trusted
`page.mouse.wheel` over an overflowing thread outside the history-demand band, with no
gap markers. The main regression grows the last row intrinsically during wheel dispatch
and streams successive fake-daemon deltas into one unfinished reply. IPC timing alone
can miss the input race; the intrinsic growth exercises the row observer before the
first native scroll step. A 500px upward gesture must move more than 450px. Two animation
frames only flush queued scroll events; the held baseline instead requires 20 stable
frames, then a positive rendered-height increase before checking the held offset.

The cases `a 1px upward wheel holds released intent inside the bottom tolerance` and
`a 4px upward wheel holds released intent inside the bottom tolerance` each require two
positive streamed-height increases after motion settles. They then move downward from
6px to 3px short of the bottom and prove following resumes on further growth. Merely
asserting bottom geometry would miss the released intent inside the rounding band.
The suite also covers thread-focused ArrowUp/PageUp/Home, descendant-control keys,
untrusted input, offline no-range input, send resumption and existing prepend/image cases.

Recorded browser evidence for [#1885](../../specs/architecture/1885-streaming-reader-scroll-intent.md),
confirmed by the [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1890#issuecomment-6054076625):

- Unmodified main hook at `5f75ddc3`: 20 executed, 18 passed, 2 failed, 0 skipped.
  `upward wheel during streaming holds the reader after native motion settles` and
  `thread-focused ArrowUp releases following during streaming` both failed. The wheel
  started at 6488px; expected below 6038px, actual 6328px.
- Pre-repair hook from `ba8f29a5`, with main merged at `5e4a1750`: 22 executed,
  20 passed, 2 failed, 0 skipped. Both 1px/4px cases failed after positive streamed
  growth: expected held offsets 6487px/6484px, actual 7076px for both.
- Fixed focused run at `7d936932`: 22 executed, 22 passed, 0 failed, 0 skipped,
  including the original wheel/ArrowUp regressions, both small-wheel cases and all
  existing scroll-pin scenarios.
- Dispatcher fake-transport gate at `7d936932` on 2026-10-08: 369 executed,
  369 passed, 0 failed, 4 skipped. All 22 scroll-pin scenarios executed and passed
  on their first attempt, including those named above. History-walk (3), history-gaps
  (2), and resize/zoom controls (3) also executed and passed without skips.

These runs exercised the built Electron app with fake-daemon streaming; physical
trackpad gestures and live-Claude streaming were not exercised.

## Inline question growth

`Timeline.trailing` places `QuestionHistorySlot` after message rows, even with empty/offline history
while a batch, permission or owned rejection remains pending. Its shared wrapper is a direct child
observed by `useThreadScrollPin`.
Arrival, local card edits and same-request growth preserve the existing `following` ref: readers
reviewing earlier messages stay where they are; readers following the bottom remain pinned as the
wrapper grows. The batch is not a history row and contributes no pagination or saved-message data.
Permission hides only the questionnaire inside that wrapper while adding its own inline card;
both changes use the same guarded pin and preserve the questionnaire drafts.

A scroll-position assertion can pass before the browser's scroll event updates `following`.
`question-picks.spec.ts` waits two animation frames after positioning before delivering a batch or
more cards. Its edit case scrolls the option into view, verifies the reader is still above the bottom
tolerance, then makes a real label click. A synthetic click on an offscreen label measures a different
thing: it focuses the visually hidden radio, whose containing block is now the positioned thread,
and Chromium scrolls it into view. The arrival and bottom-growth assertions remain separate from
that visible-edit proof. See [verification evidence](development-verification-test-tiers.md#inline-question-verification).

**Open observer-retention limitation:** the observer adds current children but does not unobserve
removed children while the same pane remains mounted. Resolving/dismissing a batch therefore leaves
its detached wrapper, including input values, retained by the observer until a root change or teardown;
repeated batches accumulate such targets for the pane's lifetime. The
[verifier finding](https://github.com/pyrycode/pyrycode-desktop/pull/1783#issuecomment-6024030746)
reports no observed answer-routing or scrolling failure and treats this as nonblocking. A future
hook change should unobserve removed children or rebuild the observation set; the old append-only
assumption does not hold for transient questionnaires. Store clearing prevents those old values from
being used as live drafts, but does not release these DOM references.

## User demand and prepend position

[`useThreadScrollPin`](../../../src/renderer/src/screens/conversation/ConversationScreen.tsx)
separates local scroll measurement from download intent. `onScroll` updates bottom
following only; it never requests history. The shared `readUpward` input helper
snapshots the offset and releases following when upward range exists, independently
of host availability, then calls `demandHistory` before the browser scrolls.
`demandHistory` requires a connected conversation host. A visible known
gap between measured header/input overlays takes priority, selecting the first
marker from newer toward older rows; otherwise `isNearTop` governs oldest-end demand.
The band includes offsets from zero through `HISTORY_ASK_BAND_VIEWPORTS` (2) viewport
heights, scaled by the thread's own measured `clientHeight` rather than a fixed pixel
rim (widened from a fixed 200px band by [#1752](https://github.com/pyrycode/pyrycode-desktop/issues/1752)).
Crossing into it does not queue demand. See [history admission](chat-history.md#received-state-admission-and-ownership)
for first-page coverage, pending-read gates and retry policy.

`Timeline` keeps its empty content inside the same focusable scroll region
(`tabIndex={0}`, client-owned accessible label `Conversation history`). Returning
`EmptyThread` before mounting that region makes first-page input unreachable.
The browser's keyboard-focus indicator remains visible. At `scrollTop === 0`, ordinary
upward input has no upward range and preserves following, including on an offline short
thread whose rows later grow. Connected demand in the band or at a visible gap deliberately
releases following even on a short thread, retaining the prepend anchor regardless of
whether admission permits another request. Programmatic movement and a page's arrival
cannot ask for another page. Descendant-control keys do not enter this demand path.

Chromium suppresses native anchoring at exactly `scrollTop === 0`. Stable row keys
and clearing bottom following alone therefore cannot preserve that reader's place.
The pin remembers the first visible direct-child non-gap row and its viewport-relative
top, refreshing this local measurement after renders, scrolls and connected demand.
When `prependedRows` increases for the same conversation while not following, a layout
effect restores the surviving row's position before paint. This covers zero-offset
prepends and middle-of-thread gap insertion. At nonzero offsets, native anchoring remains
enabled; if it already held the row, the measured displacement requires no extra movement.
The synchronous intent release and direction check retain this compensation and its
pin-write echo protection. Momentum flings can still leave a stale remembered anchor;
the streaming-input fix does not change that separate limitation.

A short thread may not have enough scroll range to reach the measured target.
The pin adds only the measured bottom padding needed to retain its existing blank
space below the rows. Bottom following removes that inline padding and restores
the measured stylesheet input clearance, including after a successful send. The existing
`pinnedOffset` echo guard prevents compensation's scroll event from re-arming
following. Measuring row displacement matters: `scrollHeight` includes unused
viewport space in short threads and is not the inserted content's height.
Convert the measured content bottom to absolute scroll coordinates by adding
`scrollTop` before computing missing room. A stable reader row alone can hide
unnecessary blank-space growth at nonzero offset; retain the exact insertion/
scroll-height assertion as well as anchor geometry.

[`thread-scroll-pin.spec.ts`](../../../e2e/thread-scroll-pin.spec.ts) covers a
one-row held thread receiving one or twenty rows, an overflowing thread at zero,
and the existing nonzero native-anchor case. It identifies the retained row by
content and checks its viewport top, plus zero extra requests and padding removal
on send. Index-addressed assertions can pass while a reused DOM node displays a
different row. The nonzero case alone can also pass while zero-offset prepends
remain broken. Native ArrowUp scrolling animates after release, so that case issues
demand at zero before parking the nonzero anchor and releasing the held reply.

[`history-walk.spec.ts`](../../../e2e/history-walk.spec.ts) proves the band edge: an
input parked at exactly `HISTORY_ASK_BAND_VIEWPORTS * clientHeight` asks, one pixel
further out sends nothing. The "sends nothing" half cannot be ordered behind a later
in-band ask in the same test — `requestOlderHistory`'s single-request-in-flight guard
would swallow the in-band ask if the out-of-band input had (wrongly) already asked, so
the two cases would be indistinguishable by request count. The absence is read after a
fixed settle instead, before the in-band input fires.
