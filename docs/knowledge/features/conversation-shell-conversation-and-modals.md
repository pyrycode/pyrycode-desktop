# Conversation shell — conversation surfaces and modals

Surfaces that act on the conversation as a whole rather than on one turn. This document is now a map: the larger sections split out on 2026-09-02 to stay under the size cap, and three smaller ones stayed here.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — the composer's Actions menu (#680) and the per-conversation timeline reader cutover (#758).
- [Modals](conversation-shell-modals.md) — the permission/trust modal (#224, its rejection surface #249) and the question panel (#906).
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — the session-boundary delimiter row (#286/#690) and the Channel Info sheet (#365, with its Rename/Archive/Delete actions).
- [Message bubble](conversation-shell-message-bubble.md) — the later redraw of the bubble itself (#969): the desktop `Message` shape, the meta row and its copy control.

## The interactive flip + thread cutover (#179)

The on-switch for the whole structured surface above. `loadDialConfig` (`daemonConnection.ts`) now
passes `capabilities: [CAPABILITY_INTERACTIVE]` to `buildClientHello` — the single production call
site, previously always `[]`. `interactive` is the only capability in the vocabulary, so advertising
it turns on everything the daemon offers a paired interactive client: the v2 structured stream (turn
state, deltas, tool use/result, thinking) and the `modal_shown` prompts, all decoded by the
already-shipped, previously-inert transport (#199–#230) and rendered by the already-mounted pipeline
above. The daemon's accepted set echoes back on `hello_ack.capabilities`, surfaced unchanged on the
`connected{ack}` event (`parseHelloAck` already did this — no production change needed for that half).

Advertising `interactive` stops the daemon's coarse `message` fan-out in the same instant
(pyrycode #699), so the flip and the render cutover **land in one commit**:

- **The composer's echo retargets.** `Composer`'s `dispatch` now reads
  `useTimelineStore((s) => s.dispatch)` instead of `useSessionStore((s) => s.dispatch)`;
  `composerSend.ts`'s `submitMessage` dispatches `{ type: 'userText', text: trimmed }` (the
  [#245](../codebase/245.md) event) instead of a `messageSent` `SessionAction`. The `message_id`
  minted in `submitMessage` is now used for the **wire** command only — the old "reuse the id so the
  daemon's re-echo dedupes" rationale is retired: in interactive mode the `DaemonEvent` union carries
  no user-message arm and the coarse fan-out is off, so the optimistic echo is the sole source of the
  user's own message and needs no dedup key.
- **`TimelineRow`'s `case 'userText'`** (the [#245](../codebase/245.md) dormant placeholder) now draws
  the right-aligned user bubble — `.message-row--user` / `.bubble--user` (`data-thread-role="user"`,
  distinct from `MessageBubble`'s `data-message-role`), reusing the coarse thread's own user-bubble
  treatment verbatim (no new CSS at the time — [#969](conversation-shell-message-bubble.md) later
  redrew both bubbles' CSS from the desktop `Message` component and added the meta row + copy control
  this arm now also renders). Text renders as auto-escaped React children, never
  `dangerouslySetInnerHTML`.
- **`MessageThread` is retired.** Its mount (`<MessageThread messages={messages} />`) and the
  `useSessionStore(selectMessages)` read are removed from `ConversationScreen`. `MessageThread` /
  `MessageBubble` / `messageViewModel.ts` / `selectMessages` all stay as **dead-but-tested residue**
  (deliberate — a later cleanup ticket removes them); `sessionStore.messages` is populated but unread.

`Timeline` is now the conversation's **single** thread surface: the user's `userText` echo and the
daemon's structured reply share the one ordered `timelineStore.items` array, so arrival order gives
one continuous thread with no split-brain and no empty second region. See
[#179 codebase notes](../codebase/179.md) for the full design, the security review, and lessons
learned.

## Queued rows folded into the thread (#1214, was #294, drop since #296, echo removal since #1213)

**A message sent mid-turn used to draw twice**, and #1214 made it draw once. `submitMessage`
(`composerSend.ts`) posts an optimistic `userText` echo into the timeline unconditionally, with no idea
whether the daemon ran the message or parked it; the daemon parks it and pushes a `queue_state`
snapshot, and through #1214 that snapshot rendered as a *second*, near-identical row in a
`.conversation__queued` region below the thread (`QueuedBacklog`, described below in earlier form), and
\#1214 deleted that view and its region outright and folds the two row lists together inside `Timeline`
itself, so there is exactly one row per message, delivered or waiting.

**`foldQueuedRows(items, queued)`** (`foldQueuedRows.ts`, pure, no store/clock/React) does the join, on
the correlation [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) established
(`QueuedItem.message_id` ↔ the echo's `messageId`). Contract, in the order it matters:

1. Every timeline item appears exactly once, at its own index, in order — the fold never reorders,
   drops or duplicates a row, which is what makes "stays where it is when the message runs" structural
   rather than conventional.
2. A backlog item correlates to at most one echo and an echo to at most one backlog item: a greedy,
   one-to-one, first-come assignment over an index built once from `items` (`messageId → indices`,
   non-empty ids only), consumed as each is claimed. Two identical texts with distinct ids claim two
   distinct rows; a same-id-twice backlog claims first-come and leaves the second unmatched rather than
   double-marking one row.
3. Only `kind === 'userText'` items are ever candidates — enforced by the type system (`messageId` lives
   on that arm alone), stated as a contract because it is the guard that keeps a `queue_state` from ever
   putting the queued treatment, or its drop control, onto daemon-authored content.
4. Only a non-empty `message_id` on both sides participates; `undefined` and `''` correlate with
   nothing. This is the *first* guard on this path — #1213's own empty-id rule lives at
   `dropQueuedMessage`, which this consumer never goes through.
5. A backlog item that claims no echo becomes its own row **at the tail**, in snapshot order, after
   every timeline row — a first-class state (`queue_state` reaches every interactive connection, so a
   window can see ids it never minted, e.g. a message queued from mobile, or a reconnect into a backlog
   it has no echo for), never an error, and never allowed to attach itself to somebody else's row.

`message_id` is compared for strict string equality only — never a `Map` key, a lookup path, a React
key or a rendered value (#1213 § Security review 1's contract, inherited unchanged). An unmatched tail
row is synthesized as `{ kind: 'userText', text: entry.text }` with **no** `messageId` — an id this
window did not mint must never look like one it did — and no `createdAt`/`attachments`, since the wire
item carries neither.

**`Timeline` takes the backlog through two optional props**, `queued?: readonly QueuedItem[]` and
`onDropQueued?: (queuedMsgId, messageId) => void`, the same `scrollPin` precedent
([Conversation shell § Thread scroll
pin](conversation-shell.md#thread-scroll-pin-601-built-on-the-dormant-isatbottom-helper-from-600)) —
required props would have been a 72-site edit cascade in `ConversationScreen.test.tsx` alone. Absent
`queued`, the fold runs against an empty backlog and yields today's rows byte-for-byte, so the ~72
existing render sites needed no edit. `Timeline` calls `foldQueuedRows` and renders the folded list;
**the empty-thread branch now tests the folded rows, not `items`** — a window with no echoes but a
non-empty backlog used to draw `<EmptyThread/>` with queued rows underneath it (reachable from a
reconnect into another device's backlog, or a conversation opened fresh here); after the fold that
combination draws the queued rows instead. Item rows keep their stable array-index key; tail rows key
on `` `q${queued_msg_id}` `` — a real per-conversation unique integer, the key the deleted
`QueuedBacklog` already used, in a string namespace that cannot collide with a numeric index —
**never `message_id`**, which stays a compared value only.

**`TimelineRow`'s `userText` arm forks on `queued` (`QueuedRowHandle | null`), and that fork is the
whole visual change:**

| | queued | delivered |
|---|---|---|
| row class | `message-row message-row--user message-row--queued` (modifier **appended**, never prepended — `ConversationScreen.test.tsx` asserts the class run with `toContain`) | `message-row message-row--user` |
| `data-thread-role` | `queued` | `user` |
| drop control | `QueuedRowDrop`, a leading sibling of the bubble | none |
| `<BubbleMeta>` | **suppressed** | rendered |
| attachments | rendered (message content, not chrome) | rendered |

The meta-row ruling — suppressed on a queued row, matched or unmatched alike — keeps #969's shipped
reasoning true word for word ("nothing sent yet to copy, and no time") and keeps the two merged forms
identical in chrome; a *matched* row is this window's own echo with a `createdAt` it simply doesn't
show yet, an *unmatched* one has none to show. `e2e/user-whitespace.spec.ts`'s "a queued bubble carries
no meta row, so its box is a different constant height" needed no edit because of this. Reusing
`.bubble--user` with no CSS of its own for the bubble itself still means the row inherits
[#969](conversation-shell-message-bubble.md#what-stays-untouched)'s desktop restyle for free — nothing
there changed.

**`QueuedRowDrop`** (module-private, moved off the deleted `QueuedBacklog`, markup byte-identical) is
the drop/cancel affordance #296 shipped: an icon-only button, a leading sibling of the bubble (the row
is right-aligned, so leading sits it at the inner edge), `aria-label="Drop queued message"`
(`DROP_QUEUED_LABEL`, a client-owned constant) plus an inline `aria-hidden` SVG glyph. It rides a row
**only** while `queued !== null` — before #1214 "no delivered row can reach this button" was structural
(only `QueuedBacklog` rendered it); it is now a condition, guarded one level up by `foldQueuedRows`
rule 3 above (only `userText` items are ever candidates), and asserted directly in the renderer spec
rather than left to the shape of the file. `onDropQueued` is still wired the same way: `ConversationScreen`
binds it inline to the pure `dropQueuedMessage` helper (`dropQueuedMessage.ts`), supplying
`openConversationId` and dereferencing `window.pyry.sendCommand` only inside the click closure, never at
render. Activating it dispatches `dequeueMessageCommand` (see [Dequeue message
envelope](dequeue-message-envelope.md)) — **the queued row itself is still never removed
optimistically**, #296's ruling unchanged; it disappears only when the daemon's next `queue_state`
snapshot replaces the backlog and the fold re-derives the row list.

**The drop's two clocks now land on one row, and the resulting hop is accepted, not defended
against.** [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) made a drop remove the
correlated `userText` echo optimistically (at the click) while leaving the queued item itself to leave
non-optimistically (on the daemon's next snapshot, #296 AC3) — a pair that was invisible while the two
lived in separate rows. Folded onto one row, the gap between the click and the confirming snapshot
finds the message unmatched (echo gone, backlog entry still held), so it draws for one relay round trip
as a tail row before it disappears for good — a visible hop to the bottom of the thread, then gone.
Every alternative reverses a shipped ruling (making the queued row's departure optimistic reverses #296
AC3; removing the echo by backlog-diff would also delete the echo of every message the daemon simply
*ran*; a pending-drop ledger across the async boundary is the ledger #1213 §4 reason 3 already
rejected), so this is tolerated on the same rule the idle flash and the reconnect clear already use: the
daemon's honest report of its own state, bounded to one relay round trip and strictly display. An
**unmatched** row's own drop has no such transient — it dispatches `dropUserText` for an id no echo
carries, the reducer returns the same state reference, and the row leaves on the snapshot as it always
did.

**CSS: the compositing group moved from the region to the row.** `.conversation__queued`'s `opacity:
0.5` is now `.message-row--queued { opacity: 0.5 }` — the row is the smallest element containing both
the bubble and `QueuedRowDrop`, which #296 made a *sibling* of the bubble, so a bubble-level opacity
(the relocation #294 originally sketched) would leave the button at full brightness. Everything else
the region contributed was redundant: `.conversation__thread` already declares the same `gap:
var(--space-3)` / `padding: var(--space-2) var(--space-4)`, so merged rows keep the region's exact
rhythm with no new rule.

`items` still comes from `ConversationScreen`'s own `selectBacklogFor(openConversationId ?? '')` read
([queue store](queue-store.md), unchanged by this ticket) — #1214 kept the read exactly where
[#1009](https://github.com/pyrycode/pyrycode-desktop/issues/1009) hoisted it, because a `queue_state`
still needs to re-render the screen for the fold to see it, and because [the thread scroll
pin](conversation-shell.md#thread-scroll-pin-601-built-on-the-dormant-isatbottom-helper-from-600)'s
dep-free re-assert still runs on that render — only the reason changed, from "the region's height" to
"the fold's input". See that section for what #1214 did to the pin's occupant inventory and to the
`thread-scroll-pin.spec.ts` criterion that used to be pointed at this region.

No Figma coverage for the queued row or its drop control — the same documented gap as
[#148](../codebase/148.md)'s thread-chrome states: the mobile file draws only the populated, delivered
thread (node 16-8/16-21), and node 102-4's desktop Message area has no queued/pending component either.
\#1214 adds no visual of its own; the "waiting" treatment and the drop control both simply moved. See
[#294 codebase notes](../codebase/294.md), [#296 codebase notes](../codebase/296.md) and the
[#1214 architecture spec](../../specs/architecture/1214-fold-queued-backlog-into-thread.md) for full
design, the security review (hostile-daemon capability bounded to display, §4/§5) and patterns
established.

## Screen-snapshot action & display (#324, removed #618)

The view half of #318's store/render split (store half: [#323](../codebase/323.md)) — a request
button between `<StatusRow/>` and `<InterruptControl/>` (`ScreenSnapshotControl`, `.screen-snapshot`)
that fired the `requestSnapshot` command, plus a bounded `<pre>` panel (`.screen-snapshot__screen`,
`max-height: 240px; overflow: auto`) showing the daemon's held rendered-screen text, with a distinct
`.screen-snapshot__empty` placeholder before any reply arrived.

**Removed in [#618](../codebase/618.md).** The feature it exposed — photographing claude's terminal
— was deleted upstream (pyrycode#1348); the daemon now wires `Snapshotter: nil`, so the button
rendered enabled and did nothing, with no error shown. #618 took only this visible surface:
`ScreenSnapshotView`, `ScreenSnapshotControl`, both copy constants, `requestScreenSnapshot.ts`, and
the `.screen-snapshot*` CSS block are all gone, and the mount between `StatusRow` and
`InterruptControl` reverts to the two sitting adjacent. A raw-event view to replace this was
discussed and deliberately deferred, not built.

**What stayed, and what's since gone.** [`screenSnapshotStore`](screen-snapshot-store.md) and its
bridge stayed reader-less through #618's scope, then were deleted outright by
[#619](../codebase/619.md). The outbound `requestSnapshot` IPC command and its wire type were then
removed by [#620](../codebase/620.md); the inbound decode and its two events remain #621/#622's
removals. See [#324 codebase notes](../codebase/324.md) for the original design and patterns
established, [#618 codebase notes](../codebase/618.md) for the visible-surface removal and its comment
re-anchors, [#619 codebase notes](../codebase/619.md) for the state-layer removal, and [#620 codebase
notes](../codebase/620.md) for the outbound-transport removal.

