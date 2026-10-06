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
a successful send re-arms it through `followBottom`. A dependency-free layout effect
and a `ResizeObserver` call the same guarded `reassertPinnedToBottom` write. Neither
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

Measure before re-pinning and before zero-offset prepend compensation. Occupied
height includes status, attachment previews, multiline draft growth/shrink, and
permission/trust replacing the composer. Inline questionnaires grow inside history and do not add
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

Resize and Electron zoom can cause native anchoring to emit a scroll before resize
observations arrive. The hook remembers the last observed `clientWidth` and
`clientHeight`. While following, a scroll with changed dimensions leaves the decision
to the pending observer rather than clearing the flag on layout movement. That
observer refreshes dimensions after the guarded pin. At unchanged dimensions, reader
scrolls still update following normally. This covers narrowing, widening and 100%/125%
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

## Inline question growth

`Timeline.trailing` places `QuestionHistorySlot` after message rows, even with empty/offline history
while a batch remains pending. Its wrapper is a direct child observed by `useThreadScrollPin`.
Arrival, local card edits and same-request growth preserve the existing `following` ref: readers
reviewing earlier messages stay where they are; readers following the bottom remain pinned as the
wrapper grows. The batch is not a history row and contributes no pagination or saved-message data.
Permission hiding can shrink that wrapper while retaining the draft, using the same guarded pin.

A scroll-position assertion can pass before the browser's scroll event updates `following`.
`question-picks.spec.ts` waits two animation frames after positioning before delivering a batch or
more cards. Its edit case scrolls the option into view, verifies the reader is still above the bottom
tolerance, then makes a real label click. A synthetic click on an offscreen label measures a different
thing: it focuses the visually hidden radio, whose containing block is now the positioned thread,
and Chromium scrolls it into view. The arrival and bottom-growth assertions remain separate from
that visible-edit proof. See [verification evidence](development-verification.md#inline-question-verification).

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
following only. Trusted upward wheel input or ArrowUp/PageUp/Home targeted at the
thread itself checks host availability and `isNearTop` before the browser scrolls.
The band includes offsets from zero through `HISTORY_ASK_BAND_VIEWPORTS` (2) viewport
heights, scaled by the thread's own measured `clientHeight` rather than a fixed pixel
rim (widened from a fixed 200px band by [#1752](https://github.com/pyrycode/pyrycode-desktop/issues/1752)).
Crossing into it does not queue demand. See [history admission](chat-history.md#received-state-admission-and-ownership)
for first-page coverage, pending-read gates and retry policy.

`Timeline` keeps its empty content inside the same focusable scroll region
(`tabIndex={0}`, client-owned accessible label `Conversation history`). Returning
`EmptyThread` before mounting that region makes first-page input unreachable.
The browser's keyboard-focus indicator remains visible. Upward demand in the band
releases bottom following even on a short thread; programmatic movement and a
page's arrival cannot ask for another page.

Chromium suppresses native anchoring at exactly `scrollTop === 0`. Stable row keys
and clearing bottom following alone therefore cannot preserve that reader's place.
The pin remembers the first direct-child row and its viewport-relative top at zero,
refreshing this local measurement after renders and scroll/input. When
`prependedRows` increases for the same conversation while the reader remains at
zero and is not following, a layout effect restores the surviving row's position
before paint. Nonzero offsets retain native anchoring, avoiding double compensation.

A short thread may not have enough scroll range to reach the measured target.
The pin adds only the measured bottom padding needed to retain its existing blank
space below the rows. Bottom following removes that inline padding and restores
the measured stylesheet input clearance, including after a successful send. The existing
`pinnedOffset` echo guard prevents compensation's scroll event from re-arming
following. Measuring row displacement matters: `scrollHeight` includes unused
viewport space in short threads and is not the inserted content's height.

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
