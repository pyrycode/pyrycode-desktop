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
Direct-child membership changes reconcile row targets: only new children are observed,
and detached or replaced children are unobserved. Chrome targets reconcile separately
as a constant-size set. Observation-root replacement disconnects both resize and
mutation observers, clears row/chrome caches and the remembered anchor, and observes
the new root; teardown releases the same references. Heights and following remain
DOM/ref-local rather than store state.

The hook caches direct-child document positions and an ordered array of positive-height,
non-gap anchor candidates. Setup and actual direct-child membership changes enumerate
and measure rows to rebuild that index. Scrolls and unchanged-membership renders instead
binary-search candidate bottoms against the greater of thread top and measured header
bottom, then remember the selected row's top relative to the thread. This takes logarithmic
row geometry reads without copying or enumerating all children; no candidate means no
anchor. Searching unfiltered rectangles would be incorrect: hidden rows report viewport-zero
rectangles, breaking monotonic order, and long collapsed runs must not become anchors.

A subtree `MutationObserver` distinguishes direct-child membership changes from mutations
inside existing rows. Pending records are drained before lookup/layout synchronization,
so committed collapse or expansion is reflected before resize delivery. Descendant text,
child and `hidden`/`style`/`class`/`data-history-gap` attribute changes refresh only their
containing direct child; resize entries refresh only delivered row targets, also covering image or stylesheet growth
without mutations. Eligibility changes insert/remove candidates by cached document position;
that array movement is permitted, while ordinary positive-height same-row growth neither
rebuilds nor traverses the row set. Hidden rows and gap markers remain observed even though
they are excluded from anchor lookup. Growth still measures chrome and uses the existing
guarded bottom pin. See [bounded-work design](../../specs/architecture/1892-bounded-scroll-anchor.md).

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
visible-checkbox editing and visible-choice arming. It confirms all 24 completed replies render
with more than 500px of overflow, settles dismissal and pointer geometry, then uses a trusted
500px upward wheel. Before held-card delivery it requires more than 450px of upward movement
and distance from the bottom, with a positive offset. Its baseline requires 20 consecutive
stable frames of offset, content height and viewport height; arrival, focus, positive same-request
growth and drafting retain that baseline and the original <0.5px tolerance. Visible controls are
deliberately positioned before their own settled baselines so native focus movement is not
confused with growth. See [reader setup evidence](#inline-permission-reader-verification) and
[counted inline evidence](development-verification-test-tiers.md#inline-permission-verification).

Resize and Electron zoom can cause native anchoring to emit a scroll before resize
observations arrive. Metadata hover/focus reveal and collapse can do the same without
changing the viewport. The hook remembers the last observed `clientWidth`, `clientHeight`
and `scrollHeight`. While following, a scroll with changed geometry leaves the decision
to the pending observer rather than clearing the flag on layout movement. That
observer refreshes all three measurements after the guarded pin. Trusted upward input
still releases following synchronously, so the geometry guard cannot reclaim a held reader.
Held readers retain native anchoring. This covers metadata reflow, narrowing, widening
and 100%/125% zoom without another follow state machine or async task.

Chromium can reach the bottom before delivering a trusted downward wheel callback,
then change hovered-row heights before the scroll callback. The wheel handler measures
the actual bottom and resumes following there; subsequent downward scrolls retain an
already-following reader's intent even if metadata moved the endpoint. The existing pin
write restores clearance only when outside the tolerance or clearing temporary padding.
An immediate predictive wheel pin would interrupt small native movements; movements
inside the tolerance remain unsnapped. Upward input still takes precedence. See
[metadata-collapse design](../../specs/architecture/1898-collapse-message-metadata.md)
and [counted browser evidence](conversation-shell-message-bubble-testing.md#metadata-collapse-verification).

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
rows to park more than a viewport away: its 40 synthetic replies preserve that
precondition with a full-pane viewport and collapsed metadata. The metadata spec also
repeatedly reveals/collapses the tail at 1280px and 800px, wheels from history start
through changing metadata, and focuses an above-viewport row without moving a held
content anchor. See
[recorded browser and capture evidence](development-verification-layout-evidence.md#translucent-conversation-controls).

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

### Inline permission reader verification

A stable offset alone can be an overwritten bottom endpoint. A programmatic park during
metadata reflow supplies no trusted upward intent, so the geometry guard can retain following
and pending resize delivery can re-pin before the baseline. Settle layout and prove actual
upward movement and distance from the bottom before delivering held-reader content. After each
action, wait for its rendered effect and stable offset/content/viewport geometry; keep the
pre-arrival baseline immutable rather than polling until a jump disappears.

The [controlled cause observation](https://github.com/pyrycode/pyrycode-desktop/issues/1916#issuecomment-6097098604)
at `794574c4` focused an existing Copy control with `preventScroll` immediately before the old
`scrollTop = 100` setup. All 24 replies were rendered. Metadata reveal added 28px; captured
setter stacks showed the row resize observer re-pinning 100px to 1125px before the baseline.
The arriving 470px card triggered the layout-effect pin, while Cancel focus collapsed that
metadata, yielding 1567px: the original 442px jump. This distinguishes retained setup intent
from pending seeded delivery or Cancel scrolling. The controlled run used Linux x86_64,
shown Electron windows on Xvfb `:99`, a 1280×800 Playwright viewport, 3 actual workers and
zero retries: 3 executed, 0 passed, 3 failed, 0 skipped, each at the original held-arrival
assertion. Settled-control and original-timing instrumented runs passed 3/3 and 20/20
respectively, each with 0 failed/skipped; green repetitions alone missed the setup race.

The original reports at `de222e52ff`, linked from that cause comment, record 377 executed,
376 passed, 1 failed, 3 skipped with 3 actual workers; this named test failed attempt 0.
Its focused rerun used 1 actual worker: 1 executed/passed, 0 failed/skipped, attempt 0.

[Post-repair validation](https://github.com/pyrycode/pyrycode-desktop/issues/1916#issuecomment-6097173089)
at `d357bfe90f4bd7eb63f739e5917332f1acdde516` records the named test
`inline arrival and growth follow pinned readers while focus preserves held position`
in `permission-modal-answer-paths.spec.ts`, on Linux x86_64 with shown Electron windows
on Xvfb `:99` and a 1280×800 Playwright viewport. Both runs configured and used 3 workers,
with retries disabled:

- Focused repetitions: 20 executed, 20 passed, 0 failed, 0 skipped; all named-test attempts 0.
- Full default fake-transport gate: 377 executed, 377 passed, 0 failed, 3 skipped.
  Named test separately: 1 executed/passed, 0 failed/skipped, attempt 0, worker 1.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1917#issuecomment-6097311216)
confirms the spec is unchanged at reviewed merge head `f1ada1b9df1f905a2c95baecbc5542a6d92a18e2`.
Dispatcher gate 6 there used 3 configured/actual workers and zero retries: 377 executed,
376 passed, 1 unrelated failure, 3 skipped. The named test was present and passed:
1 executed/passed, 0 failed/skipped, attempt 0. The unrelated failure's focused rerun
executed/passed 1, with 0 failed/skipped and 1 actual worker. Builder scratch reports were
unavailable to the verifier; the controlled and 20-repeat evidence comes from the linked
ticket records, while the verifier independently checked the original and current gate JSON.
This repair changes only the regression; no renderer change or live-Claude run was required.

### Bounded anchor and growth verification

[`thread-scroll-work.spec.ts`](../../../e2e/thread-scroll-work.spec.ts) compares settled
32/400-row fixtures during deep-history scrolling and repeated deltas that visibly grow
one existing row. It asserts logarithmic geometry bounds, zero child enumeration and
zero row re-observation during same-row growth, with held and following readers checked
separately. Counting instrumentation stays in this spec: stack attribution isolates
`rememberTop`/`syncRows`/`refreshRow` geometry and child access, the pane target identifies
the pin's resize observer, and captured native geometry methods serve the test oracle.
Read-observer work and oracle reads therefore do not inflate the hook counts. Positive
rendered-height growth precedes the scroll assertions; setup costs are excluded.

The second case checks gaps, long hidden and zero-height runs, immediate expansion before
resize delivery, row addition/replacement/removal and hook teardown/remount. Its streamed
arrival adds a new assistant row; unchanged-membership growth is proved by the first case.
Observation-root replacement within a surviving hook was source-reviewed rather than
separately exercised in the browser.

Recorded evidence for [#1892](../../specs/architecture/1892-bounded-scroll-anchor.md#revisions):

- The recorded pre-fix main renderer at `214d15625f51495c2e07772d320003dc1eec7588`
  ran both named cases below: 2 executed, 0 passed, 2 failed, 0 skipped. Deep lookup
  read 25/265 row rectangles on the 32/400-row fixtures (bounds 8/11); each delta
  re-observed 34/402 direct children. The gap/hidden case read 87 rectangles and
  failed zero-height anchor correctness. The baseline log is recorded at
  `/tmp/builder-1892/baseline-final.txt`; renderer identity was checked by content hash.
- Dispatcher verifier gate 6 (`npx playwright test --reporter=json`) on 2026-10-08
  at `2e677c70d94547a5d2c32118c5efee970e97f1c9`: 371 executed, 371 passed,
  0 failed, 4 skipped. The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1894#issuecomment-6054832982)
  confirms both named cases were present, executed and passed:
  `scroll lookup and same-row growth stay bounded on short and long threads` and
  `gaps, long hidden runs and target changes preserve a valid anchor and clean observations`.
  The hook-work attachment records 6/10 scroll geometry reads and maximum held-growth
  reads of 8/12 for 32/400 rows, with zero same-row child enumeration/re-observation.

The same verdict confirms all required specs present and passed in that gate:

| Fake-transport spec | Executed / passed | Failed / skipped |
| --- | --- | --- |
| `thread-scroll-work.spec.ts` | 2 / 2 | 0 / 0 |
| `thread-scroll-pin.spec.ts` | 22 / 22 | 0 / 0 |
| `translucent-thread-controls.spec.ts` | 3 / 3 | 0 / 0 |

The existing suites retain prepend position, small upward intent inside the bottom
tolerance, send resumption, late-image, resize/zoom and composer-clearance coverage.
These are bounded-operation and behavior proofs, not profiling evidence for overall
scroll smoothness. Frame publication, read-observation setup and backdrop-filter paint
cost are separate concerns. No live-Claude or visual comparison was required or performed.

## Supplied snapshot anchor restoration

The injectable [daemon item view](conversation-shell-timeline-render.md#supplied-daemon-item-presentation)
calls `useThreadScrollPin(conversationId, 0, false, snapshot.items)`: legacy history
demand is disabled, and the optional immutable presentation token is the item-list
reference. A held reader's remembered anchor includes that token. A changed list
restores the surviving direct-child row to its measured viewport position before
paint, covering older-item prepends (including at offset zero) and content revisions
above the reader. Following readers use the existing bottom pin as rows append/grow.
Native anchoring remains enabled for non-React growth such as decoded images.

`snapshot.version` is protocol progress, not a presentation-change counter. A completed
older batch may insert rows while the store retains its existing version through
`Math.max`; same/lower-watermark batches can also revise held content. Requiring an
increasing watermark would miss those changes and let the viewed row move at zero
offset, where Chromium suppresses native anchoring. Immutable `snapshot.items`
identity detects those display changes independently of certification. Legacy callers
omit the token and retain restoration on increasing `prependedRows`.

The scope-keyed view remount resets its anchor and following state on host,
conversation or epoch changes even when ids match. Observer cleanup still belongs
to the existing hook; this path adds no pagination requests or scroll state machine.

[`thread-items.spec.ts`](../../../e2e/thread-items.spec.ts)'s two width cases hold a
reader at zero, prepend batches at the same and lower watermark, then deliver a
lower-watermark revision above the reader. They also grow the newest row while
following. After assigning `scrollTop` programmatically, the fixture waits two
animation frames before measuring the anchor: the assignment queues a scroll event,
so immediate delivery could test stale following/anchor state. This flush is distinct
from the stable-geometry baselines needed for animated input described above.

The [verifier PASS](https://github.com/pyrycode/pyrycode-desktop/pull/1925#issuecomment-6102450645)
confirms both named `authoritative items retain identity, actions and scroll at 1280`
and `authoritative items retain identity, actions and scroll at 800` cases present and
passed. Ticket coverage executed 3, passed 3,
failed 0, skipped 1; the skip is the separate #1926 attachment transport reproduction.
Full fake-transport coverage executed 380, passed 379, failed 1, skipped 4, with the
unrelated `history-gaps` failure passing an isolated rerun (1 executed/passed,
0 failed/skipped). These are injected snapshot/typed-update proofs; production
selection and combined live acceptance remain with #1908.

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

Resolving/dismissing a batch removes its wrapper from the membership index and unobserves
the detached target while the pane remains mounted. Replacement also releases the old target;
root changes and teardown clear observers, caches and the anchor. This resolves the earlier
[observer-retention finding](https://github.com/pyrycode/pyrycode-desktop/pull/1783#issuecomment-6024030746)
through [membership reconciliation](#thread-scroll-pin). An append-only target set would retain
transient questionnaire wrappers and their input values across repeated batches even after
store drafts were cleared; store clearing alone cannot release observer-held DOM references.

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
The pin remembers the first positive-height direct-child non-gap row whose bottom is
below the usable top edge (the greater of thread top and measured header bottom), and
its top relative to the thread. It refreshes this local measurement after renders,
scrolls and connected demand through the [ordered candidate index](#thread-scroll-pin),
draining pending mutations before binary lookup so collapsed rows cannot become anchors.
When `prependedRows` increases for the same conversation while not following, a layout
effect restores the surviving row's position before paint. This covers zero-offset
prepends and middle-of-thread gap insertion. At nonzero offsets, native anchoring remains
enabled; if it already held the row, the measured displacement requires no extra movement.
Structural prepend compensation may still enumerate and measure all rows to calculate
the content bottom and missing scroll range. That exceptional work is separate from
scroll lookup and ordinary same-row streaming growth, whose membership stays unchanged.
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
