# Conversation shell — conversation surfaces and modals

Surfaces that act on the conversation as a whole rather than on one turn. This document is now a map: the larger sections split out on 2026-09-02 to stay under the size cap, and three smaller ones stayed here.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — the composer's Actions menu (#680) and the per-conversation timeline reader cutover (#758).
- [Modals](conversation-shell-modals.md) — the permission/trust modal (#224, its rejection surface #249) and the question panel (#906).
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — the session-boundary delimiter row (#286/#690) and the Channel Info sheet (#365, with its Rename/Archive/Delete actions).
- [Message bubble](conversation-shell-message-bubble.md) — the later redraw of the bubble itself (#969): the desktop `Message` shape, the meta row and its copy control.

## The interactive flip + thread cutover (#179)

`loadDialConfig` (`daemonConnection.ts`), the single production `buildClientHello` call site,
passes `capabilities: [CAPABILITY_INTERACTIVE, CAPABILITY_MULTI_AGENT]`.
`interactive` enables the v2 structured stream (turn state, deltas, tool use/result, thinking)
and the `modal_shown` prompts decoded by the transport and rendered by the timeline and modal
bridges. `multi_agent` also unlocks Codex conversations, their frames and Codex model rows on a
supporting v0.27.0+ daemon (pyrycode#2643); without it those are withheld even from an interactive
client. Codex uses the existing channel rows and the per-agent decoders. The daemon echoes the
accepted intersection on `hello_ack.capabilities`, surfaced unchanged on `connected{ack}`.
The unit test in `daemonConnection.test.ts` decodes the hello built by `loadDialConfig` and pins
both names; the [real-daemon proof](real-claude-liveness-e2e.md#capability-gated-skip--the-one-check-that-runs-after-the-daemon-exists)
checks the app's own acknowledgment separately from the harness probe.

Advertising `interactive` stops the daemon's coarse `message` fan-out in the same instant
(pyrycode #699), so the flip and the render cutover **land in one commit**:

- **The composer's echo retargets.** `Composer`'s `dispatch` now reads
  `useTimelineStore((s) => s.dispatch)` instead of `useSessionStore((s) => s.dispatch)`;
  `composerSend.ts`'s `submitMessage` dispatches `{ type: 'userText', text: trimmed }` (the
  [#245](../codebase/245.md) event) instead of a `messageSent` `SessionAction`. The same composer-minted
  `message_id` now also rides the echo: confirmed user
  messages arrive through the interactive receipt path, and [local correlation](thread-timeline-internals.md#queued-own-echo-settlement)
  preserves the held row while settling queued delivery.
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

**`foldQueuedRows(items, queued, localEchoes, rowKeys)`** (`foldQueuedRows.ts`, pure,
no store/clock/React) joins snapshots to the timeline's retained local ownership facts:

1. Only locally minted user echoes with nonempty message ids participate. Received/history
   rows and non-user rows cannot acquire ownership through an id collision. Unbound records
   claim entries one-to-one by message id; bound records use the exact conversation-scoped
   queue id. Settled unbound records cannot claim a later snapshot entry.
2. Every timeline item appears once. Unconfirmed waiting echoes associated with queue entries
   project below continuing assistant/tool output in submission order; removal-before-receipt
   preserves that projection. A receipt settles the original item after its observed predecessor
   boundary, or at the stream point for Send now. See [settlement and late receipts](thread-timeline-internals.md#queued-own-echo-settlement).
3. Snapshot presence controls the queued treatment and controls independently of settlement.
   Receipt-before-removal can leave a settled row queued temporarily, but does not move it
   behind its answering reply. Removal alone cannot imply Send now.
4. Unclaimed foreign backlog entries remain independent tail rows in snapshot order, with
   synthesized `{ kind: 'userText', text: entry.text }`, no message id, time or attachments.
   Equal text and empty/absent ids never correlate.

`message_id` is only an equality comparand, never a rendered value, Map key or React key.
Each `FoldedRow.itemIndex` names its source timeline index; foreign tail rows use `-1`.
`Timeline` reads turn statistics and streaming-cursor selection through that source index,
not the projected display index. Client-owned `rowKeys` provide React identity and all
ancestor, leaf-tool and tool-run expansion lookups. This keeps expansion attached to the
same content through projection, settlement and history prepends. Saved restoration
initializes keys before the first render; see [row identity](conversation-timeline-store-limits.md#edge-cases-and-limitations).

`Timeline` accepts optional `queued`, `onDropQueued`, `localEchoes` and `rowKeys` props.
Absent backlog means an empty snapshot; absent ownership facts cannot claim arbitrary user
rows. The empty-thread branch checks folded rows, so a foreign backlog alone is a populated
thread. Foreign rows retain the separate `` `q${queued_msg_id}` `` React-key namespace;
`firstRowKey + itemIndex` remains the fallback for callers without retained numeric keys.

**`TimelineRow`'s `userText` arm forks on `queued` (`QueuedRowHandle | null`), and that fork is the
whole visual change:**

| | queued | delivered |
|---|---|---|
| row class | `message-row message-row--user message-row--queued` (modifier **appended**, never prepended — `ConversationScreen.test.tsx` asserts the class run with `toContain`) | `message-row message-row--user` |
| `data-thread-role` | `queued` | `user` |
| drop control | `QueuedRowDrop`, a leading sibling of the bubble | none |
| Send now control | `QueuedRowSendNow`, before Drop, only for explicit `midTurnInput: true` | none |
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
(only `QueuedBacklog` rendered it); it is now a condition, guarded one level up by
`foldQueuedRows`' local-ownership join above, and asserted directly in the renderer spec
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
**unmatched** row's own drop has no such transient — it dispatches `dropUserText` for a queue entry no local record
owns, the reducer returns the same state reference, and the row leaves on the snapshot as it always
did.

**Send now preserves the echo.** [#1726](https://github.com/pyrycode/pyrycode-desktop/issues/1726)
adds `midTurnInput` and `onSendQueuedNow` optional props to `Timeline` / `TimelineRow`.
The [run-config selector](run-config-store.md#session-capability-flags-1655) requires
the open conversation's latest `mid_turn_input: true`; false, omission or no
capabilities object preserves the queued row's previous markup. `QueuedRowSendNow`
is a native button named "Send queued message now", with the same action gate,
connected-host click guard and disabled conditions as Drop. Both controls share
hover and focus styling, and Tab can reach Send now.

The injected-effects `sendQueuedNow.ts` helper sends one `sendQueuedNowCommand`
per activation and has no timeline dispatch. Main routes it by conversation and
rebuilds the `send_queued_now` payload with only `conversation_id` and
`queued_msg_id`. There is no reply frame: both controls and queued treatment
remain until `queue_state` omits the item. The later user `message` push carries
`queued_msg_id` and `sent_now: true`; it settles
the owned echo at the stream delivery point, preserving its content and numeric key.
Ordinary receipts use the predecessor boundary instead. Still-held successors start
waiting behind the current turn after either delivery mode; released echoes retain
their observed boundary for late receipts. A bridge
throw is caught, and a daemon no-op (idle turn, unknown id or Codex session) leaves
the row queued to drain normally.

Both controls stay available until that snapshot, with no pending-action ledger
or repeat-click debounce. Once the daemon removes the item, additional Send now
frames are no-ops. Drop clicked after Send now can still remove the echo before
the snapshot arrives; if the daemon already delivered it, the later user receipt
restores a truthful row at the tail. This accepted display race is recorded in
the [plan's concurrency review](../../specs/architecture/1726-send-queued-now.md#security-review).
`e2e/queued-send-now.spec.ts` covers the single-frame click, retained controls,
Tab reachability and receipt deduplication; static markup alone cannot exercise
the click. The live spec `e2e/real-claude-queue-send-now.spec.ts` holds Bash on a
test-owned gate file and checks the marker in the held turn, no separate later
turn and one delivered row. Its marker evidence accepts any assistant delta
in that turn, rather than specifically the final response, as the verifier accepted.

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

Send now also has no separate Figma frame. By the decision in
[#1726](https://github.com/pyrycode/pyrycode-desktop/issues/1726), it follows the
drop control's icon-button idiom beside Drop; Juhana may overrule this decision.

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

