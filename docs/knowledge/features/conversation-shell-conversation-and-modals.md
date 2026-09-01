# Conversation shell — conversation surfaces and modals

Surfaces that act on the conversation as a whole rather than on one turn. This document is now a map: the larger sections split out on 2026-09-02 to stay under the size cap, and three smaller ones stayed here.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — the composer's Actions menu (#680) and the per-conversation timeline reader cutover (#758).
- [Modals](conversation-shell-modals.md) — the permission/trust modal (#224, its rejection surface #249) and the question panel (#906).
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — the session-boundary delimiter row (#286/#690) and the Channel Info sheet (#365, with its Rename/Archive/Delete actions).

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
  treatment verbatim (no new CSS). Text renders as auto-escaped React children, never
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

## Queued backlog + drop affordance (#294, drop since #296)

The [queue store](queue-store.md)'s held backlog (per-conversation `QueuedItem` rows the daemon has
accepted but not yet run) renders as `QueuedBacklog`, an exported pure view mounted after
`<ThinkingIndicator/>` and before the status row's `<StatusRow/>` trigger. Empty → `null` (no
region, no chrome — the `ThinkingIndicator` posture); non-empty → one row per item, in enqueue
order, inside a `.conversation__queued` wrapper dimmed to 50% opacity (the `.tool-row` pending
precedent, the single "waiting / not yet run" signal). Each row reuses the delivered user-bubble
treatment (`message-row--user` / `bubble--user`) but is tagged `data-thread-role="queued"` —
distinct from a delivered row's `data-thread-role="user"`. `QueuedBacklogControl`, the in-file
container, binds a module-scope-hoisted `selectBacklogFor(MILESTONE_CONVERSATION_ID)` (the same
milestone constant the composer sends under — this screen has no conversation id in nav scope, and
the spec explicitly ruled out threading one through for this slice).

[#296](../codebase/296.md) added a **drop / cancel affordance** to each row: an icon-only button, a
leading sibling of the bubble (the row is right-aligned, so leading sits it at the inner edge),
carrying a client-owned `aria-label="Drop queued message"` and an inline `aria-hidden` SVG glyph.
`onDrop` is a **required** injected-effect prop on `QueuedBacklog` (the `PermissionModal` "a view
that cannot answer is a bug" rule) — the container binds it to the pure `dropQueuedMessage` helper
(`dropQueuedMessage.ts`), supplying `MILESTONE_CONVERSATION_ID` and dereferencing
`window.pyry.sendCommand` only inside the click closure. Activating it dispatches
`dequeueMessageCommand` (see [Dequeue message envelope](dequeue-message-envelope.md)) and nothing
else — **no optimistic removal**: the row disappears only when the daemon's next `queue_state`
snapshot replaces the backlog and this same store subscription re-renders. The button exists only
inside `QueuedBacklog`; `Timeline` draws every delivered row and is untouched, so "affordance only
on queued rows" and "delivered rows unaffected" are structural guarantees, not conventions. The
drop button inherits the region's 50% dimming (a child's own opacity cannot escape a parent opacity
compositing group) — shipped dimmed by design; see [#296 codebase notes](../codebase/296.md).

No Figma coverage for either the queued row or its drop control — the same documented gap as
[#148](../codebase/148.md)'s thread-chrome states: the mobile file draws only the populated,
delivered thread (node 16-8/16-21). See [#294 codebase notes](../codebase/294.md) and [#296
codebase notes](../codebase/296.md) for full design and patterns established.

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

