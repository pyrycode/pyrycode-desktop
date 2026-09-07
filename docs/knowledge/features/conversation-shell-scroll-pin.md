# Conversation shell — thread scroll pin

Whether `.conversation__thread` stays pinned to the bottom as new content arrives, and — since
[#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260) — what happens when older content
lands at the *top* instead. Split out of [Conversation shell § Edge cases and
limitations](conversation-shell.md#edge-cases-and-limitations) on 2026-09-07 to stay under the size cap,
since this one topic had grown into most of that section.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its
other edge cases and its links.

## Thread scroll pin

**Thread scroll pin** ([#601](../codebase/601.md), built on the dormant `isAtBottom` helper from
[#600](../codebase/600.md)) — `.conversation__thread` now stays pinned to the bottom while a new item
arrives, but only if the operator was already there; a screen-local `useRef` flag, written only by the
container's own scroll events and re-asserted in a dependency-free layout effect, decides — never a
measurement taken after the new content is already in the layout. `Timeline` gained one optional
`scrollPin` prop bundling the ref and the scroll handler so the ~30 pre-existing render sites needed no
edits. Every chrome sibling below the thread that can still mount or unmount there (`__interrupt`) does
so with no risk of un-pinning a thread the operator never scrolled — a chrome mount only shrinks the
thread's viewport, which cannot fire a scroll event. (Through #967 that list also included
`__stall`/`__api-retry`/`__compacting`; all three retired along with the views that mounted them — see
below. `__queued` left the list too, but not by retiring: [#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214)
folded its rows into the thread itself, so what used to be a mounting sibling is now the thread's own
content growth — see below.) **`.conversation__thinking` left this list in
[#796](https://github.com/pyrycode/pyrycode-desktop/issues/796):** its markup now lives inside the
composer status row, a fixed-height element that is mounted at all times, so `turn_state{thinking}` no
longer shrinks anything — it only swaps a label inside an already-present row.
`thread-scroll-pin.spec.ts`'s fourth criterion existed specifically to prove a chrome mount shrinks the
thread without un-pinning it; left pointed at the working indicator it would have kept passing against a
viewport that had stopped moving, silently testing nothing. #796 repointed it onto the stall indicator
(`.conversation__stall`), which kept its own bubble treatment and still shrank the region at the time —
the daemon's `stall` frame drove it, with `conversationActivityBridge.ts`'s unconditional
stall-clear-on-any-turn-state independently confirmed to make the subsequent `toHaveCount(0)` assertion
correct rather than incidental.

**[#967](https://github.com/pyrycode/pyrycode-desktop/issues/967) folded the stall block into the
composer status row too** (see [Conversation shell — turn status § Retired by
\#967](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)),
which took the criterion's subject away a second time — the same swap #796 made, for the same reason,
now needed again. The criterion moved onto the queued backlog (`.conversation__queued`, since deleted —
see below), a region of dimmed rows large enough to shrink the viewport by tens of pixels (116px measured
with a two-item backlog at the time) — deliberately not #963's 8px row-growth, which needs a terminal
connection error the spec has no reason to stage. **The repoint exposed a real gap**:
`useThreadScrollPin`'s re-assert is a dep-free layout effect that runs on **screen** renders, and
`QueuedBacklogControl` (the region's container at the time) held its own queue-store subscription, so a
`queue_state` push re-rendered that control alone and the pin never ran — the thread rested short of the
bottom (116px with #967's setup) until some unrelated render re-pinned it. #967 filed that gap as
[#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) rather than fix it (out of scope for a
ticket that does not otherwise touch `useThreadScrollPin`) and pointed the criterion at the two-step
shape the gap forced: shrink (a `queue_state` push), then a *following* screen render (the stall push)
that must still re-pin, with the immediate case commented rather than asserted.

**[#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) closed the gap.**
`ConversationScreen` now reads the open conversation's backlog itself — a `useMemo`-stable
`selectBacklogFor(openConversationId ?? '')` selector, the same idiom `selectOpenTimelineFor` uses one
read above — and mounts the pure `QueuedBacklog` view directly; `QueuedBacklogControl` is retired.
Because the read lives on the screen, a `queue_state` that mounts *or grows* the region is now a screen
render like any other, so the existing dep-free effect covers it under the rule it already claimed to.
Mount and re-pin land in the same commit — `setBacklog` changes the selector's array reference, React
re-renders the screen, the DOM grows `.conversation__queued`, and the layout effect runs before paint —
so `thread-scroll-pin.spec.ts` asserts pinned immediately after the queued rows appear, with no polling
and no following render required. A second push that grows an already-mounted backlog (`n → n+1` rows)
is asserted the same way, closing the case a fix keyed on "the backlog is non-empty" would miss: that
boolean does not change while the region shrinks the viewport again. The scrolled-away case is
unaffected — both pushes leave `scrollTop` exactly where the operator left it, since the tracked flag,
not the geometry, still governs whether anything scrolls. The measured gap was **132px** at fix time (not
\#967's 116px — the quantity is the mounted region's height, and #969 had redrawn the message bubble in
between; the order of magnitude, and the criterion's point, is unchanged).

**[#1214](https://github.com/pyrycode/pyrycode-desktop/issues/1214) removed the region this criterion's
subject lived in, and left the chrome-shrink category uncovered rather than re-pointing onto a fourth
subject.** The queued backlog is no longer a region between the thread and the composer — its rows fold
directly into `.conversation__thread` (see [Conversation shell — conversation surfaces and modals §
Queued rows folded into the
thread](conversation-shell-conversation-and-modals.md#queued-rows-folded-into-the-thread-1214-was-294-drop-since-296-echo-removal-since-1213)),
so a `queue_state` push now **grows the thread's own content** below the reader instead of shrinking its
viewport. That is #1049's case (below), not this strip's, and of what remains in the strip the status row
is fixed-height/always-mounted (moot) and #963's error slot needs a terminal connection error this spec
has no reason to stage — so `thread-scroll-pin.spec.ts`'s fourth criterion has no remaining subject to
move to. Rather than point it at nothing and pass vacuously, it now asserts what the same push actually
does: `scrollHeight` grows past a measured floor (`QUEUED_GROWTH_FLOOR_PX = 50`, well under two rows and
well over the zero a fold that silently drew nothing would produce) while `clientHeight` is unchanged,
plus `.conversation__queued`'s continued absence — a self-evidencing, non-vacuous gate rather than an
experiment, per the ticket's `## Revisions`. The chrome-shrink category itself is left uncovered,
recorded on the record rather than quietly dropped; a ticket that wants it back should stage #963's
8px error slot instead of reusing these lines.

The container's own backlog read is unaffected — see [Queue
store](queue-store.md#configuration-and-usage) and the section linked above for what changed about what
the read now feeds.

This is also why the two leaves the docblock now names as deliberately un-hoisted —
`ComposerErrorSlotControl`'s own `sessionStore` read and `ComposerSlot`'s own question-batch read — stay
un-hoisted rather than getting the same treatment: both arguments are about traffic the screen has no use
for (a connection-status flap, a keystroke in the question panel), where the backlog read is the opposite
on frequency, relevance and cost (`selectBacklogFor` returns the same reference, or the shared
`EMPTY_BACKLOG`, for every conversation but the open one, so `Object.is` short-circuits and nothing
re-renders for a snapshot elsewhere). Their own shrink — `ComposerErrorSlotControl`'s ~8px button growth,
`ComposerSlot`'s question panel — was a known, uncovered latency gap at #1009: the flag stayed correct
through it (no scroll event fires), so the next screen render still re-pinned, same as the queued backlog
did before #1009. **[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049) closed both as a free
consequence of a mechanism built for a different case, not as its own deliverable:** its `ResizeObserver`
watches `.conversation__thread` itself alongside every direct-child row, and both occupants' shrink is
exactly a change to the container's own border box, so the observation fires and the shared write re-pins.
Neither has a criterion of its own and neither was #1049's target — they are recorded here because the
inventory above needs to stay true, not because either was measured.

`overflow-anchor` stays unset — closed as indifferent by #601, confirmed on an observed e2e run rather
than reasoned about, but that ruling covered only the screen-render cases #601 tested. **[#1046](https://github.com/pyrycode/pyrycode-desktop/issues/1046) found it decisive, not
indifferent, for the one case those tests couldn't reach:** a growth that involves no React render
anywhere. A thumbnail resolving **above** a bottom-resting reader is exactly that case, and anchoring
already holds it. Growth **below** the reader — a thumbnail resolving in their own last row — is the one
direction anchoring is indifferent to, left open by #1046 and closed by
**[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049)**: the same `ResizeObserver` above (the
container and each direct-child row) re-runs the pin's one guarded write, `reassertPinnedToBottom`, on the
row's own resize. The write is idempotent and the flag is the only hinge, so a scrolled-up reader is
untouched and a picture-above reader sees the write as a no-op — anchoring has already moved `scrollTop` by
the time resize observations are delivered. One trap surfaced only under measurement: a thumbnail settles
in more than the two layout steps `useThreadScrollPin`'s docblock names — the `<img>` mount's 12px margin
lands first, the decoded picture's 160px a frame or more later — and the pin's own re-pin on the first step
queued a scroll event that `onScroll` read, against the second step's growth, as the operator scrolling
away. The fix is `pinnedOffset`: the write records the offset it produced, only when it actually moved it,
and `onScroll` declines to re-measure through exactly that one echo, clearing the record on every event so
it can never outlive one. Measured at 172px short (`scrollHeight` 2028 → 2200) with no fix, 0 with it.
**Send-forces-pin** ([#602](../codebase/602.md)) rides this exact
mechanism with no second one: `useThreadScrollPin` now also returns `followBottom`, a single
`following.current = true` re-arm, wired as a required `onMessageSent` prop on `Composer` and invoked
inside `handleSubmit`'s existing `if (sent)` branch — so a submit that sends nothing (not connected,
whitespace-only, no active conversation) never re-arms the flag and leaves no armed pin behind for the
next unrelated arriving item to yank. Because the re-assert layout effect has no dependency array,
"jump to the bottom now" and "stay pinned while the reply streams" are the same fact observed at two
times — an operator who scrolls up again mid-stream still wins, unchanged from #601. **Re-entry lands at
the bottom** ([#603](../codebase/603.md)) closes the family with zero production code: the original
"open at the top of history" premise didn't survive refinement (no backfill exists — opening a
*different* discussion always starts empty), so the only reachable case is re-opening the *same*
discussion. That already worked, as an emergent product of the id-gated timeline reset
(`activateConversation.ts:92-95`), Back unmounting `ConversationScreen` via a different-component-type
swap (`PairedShell.tsx:88-97`), and `following`'s `true` initial value pinning before paint on the fresh
mount — three independent facts, none added for this ticket, now locked by an e2e test rather than left
as an untested accident.

**A late-resolving image thumbnail ([#1046](https://github.com/pyrycode/pyrycode-desktop/issues/1046))
is the third member of the docblock's own "known latency gap" class, and it closed on inspection rather
than on a code change.** `BubbleAttachmentImage` ([Message bubble § The attachment image
thumbnail](conversation-shell-message-bubble.md)) resolves in two events: its own `useState` flips
`pending` → `ready`, a React render of the leaf alone that `ConversationScreen` never sees, and then the
browser decodes and lays the picture out — up to 172px of growth (`.bubble__image`'s 160px `max-height`
plus its 12px `margin-top`) with **no React render anywhere**. Hoisting the read, [#1009](../codebase/1009.md)'s
fix for the queued-backlog gap, cannot reach this one: the hoisted render would still land before the
image decodes. What closes it is Chromium's scroll anchoring, already live because `.conversation__thread`
leaves `overflow-anchor` at its default — measured against the built app (172px of drift with
`overflow-anchor: none` added, 0px without it) and now pinned by the last two tests in
`thread-scroll-pin.spec.ts`, shown failing with that one line present. No production behaviour shipped;
the two comment-only edits (this docblock and `.conversation__thread`'s own rule in `conversation.css`)
exist so a future `ResizeObserver` addition — still on the docblock's list for the *other* two known
gaps — does not get layered over a case the browser already handles for free. Anchoring is indifferent to
growth **below** the reader (their own last bubble); that gap is unaffected and stays filed as
[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049).

**The scroll-back walk rides this exact pin, in reverse, and needed a trigger that isn't the wall itself
([#1260](https://github.com/pyrycode/pyrycode-desktop/issues/1260)).** Scrolling back to the top of a
thread asks the daemon for the page before the oldest loaded entry — see [Conversation timeline store §
Edge cases](conversation-timeline-store.md#edge-cases-and-limitations) for the ask itself. The trigger is
a new pure predicate beside `isAtBottom`, `isNearTop(metrics)` (`threadScrollPosition.ts`), true whenever
`metrics.scrollOffset <= HISTORY_ASK_BAND_PX` (200). It has to be a band above the wall rather than the
wall itself: **Chromium suppresses scroll anchoring at a scroll offset of exactly zero** — the one
position at which the mechanism this whole document is about does not run at all. A walk that only asked
once the reader hit `scrollTop === 0` would ask from the one position where anchoring cannot hold their
place while the page lands above them, making AC2 unsatisfiable by construction. 200px is deliberate, not
round: two of Chromium's ~100px wheel notches of headroom, an order of magnitude above
`AT_BOTTOM_TOLERANCE_PX`'s 4px subpixel-error band (so the two thresholds can never be confused for the
same kind of tolerance), and a quarter of the app's 800px minimum window height, so it reads as a rim
rather than a viewport. `useThreadScrollPin`'s `onScroll` calls the walk's asker
(`requestOlderHistory`) right after its existing pin write, on every scroll event — the walk's own
one-ask-in-flight guard (see the linked section above) is what keeps that from spamming the daemon.

**A known bound, stated rather than defended:** a reader who lands on exactly `scrollTop === 0` — a
fling, `Home`, a programmatic jump — triggers a page that arrives with their place unheld, since nothing
here writes `scrollTop` itself. Closing it would need a second mechanism layered over anchoring, which is
exactly what this whole document already argues against building unless a real gap is observed. Likewise
a page that doesn't overflow the viewport produces no scroll event, so the walk stalls until the operator
scrolls again — both are the ticket's own accepted residue, not oversights.

**Discovered rather than designed: the walk can take several steps for one operator scroll, because
Chromium's anchoring adjustment after a prepend is itself a scroll event.** A page that lands but doesn't
push the reader's `scrollOffset` back out past `HISTORY_ASK_BAND_PX` leaves them still near the top, and
the resulting `onScroll` fires again with no further input from the operator — an empty page (no growth
at all) and a short, one-entry page (≈40px, still inside the band) both cascade this way in practice. This
is the correct product behaviour (keep loading until there's enough above the reader, bounded by
`atStart`), and no production code exists to prevent it or needs to. It did invalidate a class of e2e
assertion that encodes a *moment* rather than a fact — an ask-**count** barrier and a row-**count** read
each raced the cascade in `e2e/history-walk.spec.ts`'s first draft, since a page had often already landed
by the time the assertion ran. The fix in both cases was to assert something that stays true regardless of
how many steps already happened: a barrier waits for a specific **cursor** to appear among the recorded
asks, a reference row is addressed by its own **text**, and the walk's shape is pinned once at the end by
an equality on the full ordered cursor list — a strictly stronger claim than any per-step count, since it
also proves no page was asked for twice across dozens of real scroll events.

**AC2's own case has to drive its growth from the position the walk actually fires from, not from the
middle of the thread the way the two cases above it do.** `thread-scroll-pin.spec.ts`'s new case copies
their `withheldThumbnails` shape — the walk's ask is recorded and deliberately answered with no frames
first, so the reader's position and the reference row's viewport-relative top are captured *after* the
ask has provably gone out — then parks the reader inside `HISTORY_ASK_BAND_PX` and above zero before the
correlated `history_page` lands. It asserts the thread grew by a floor, the reference row (addressed by
its own text) kept the same viewport top, `scrollTop` advanced by that growth, and the reader was not
yanked to the bottom. **§ Design 3's row-key fix is load-bearing here**, not incidental: an
index-addressed reference row would report the same unchanged viewport top even with the bug present,
since the bug leaves the anchor *node* in place and only its content changes — see [Conversation
timeline store § Edge cases](conversation-timeline-store.md#edge-cases-and-limitations) for that fix.
Measured by mutation, the same way the row-key fix itself was: reverting `firstRowKey` and rebuilding
moves the reference row's viewport top from 112px to 848px, which is what this case exists to catch.

**The park is well clear of the bottom, confirmed rather than assumed.** A primer long enough to
overflow the viewport puts the reader a full viewport-plus above it before the walk's trigger fires, so
the pin's `following` flag is clear and the pin writes nothing during the prepend — asserted as a
precondition (`distanceFromBottom(before) > before.clientHeight`), so the case can tell anchoring's
contribution apart from the pin's rather than assuming which mechanism is in play.
