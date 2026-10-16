# Conversation shell — conversation surfaces and modals

Surfaces that act on the conversation as a whole rather than on one turn. This document is now a map: the larger sections split out on 2026-09-02 to stay under the size cap, and three smaller ones stayed here.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

- [Actions menu and reader cutover](conversation-shell-actions-menu-and-reader-cutover.md) — the composer's Actions menu (#680) and the per-conversation timeline reader cutover (#758).
- [Modals](conversation-shell-modals.md) — the permission/trust modal (#224, its rejection surface #249) and the question panel (#906).
- [Session boundaries and channel info](conversation-shell-session-and-channel-info.md) — the session-boundary delimiter row (#286/#690) and the Channel Info sheet (#365, with its Rename/Archive/Delete actions).
- [Message bubble](conversation-shell-message-bubble.md) — the later redraw of the bubble itself (#969): the desktop `Message` shape, the meta row and its copy control.

## The interactive flip + thread cutover (#179)

This section records the original cutover. Production now uses the
[authoritative thread runtime](thread-runtime.md); #2023 deleted the retained
`Timeline` presentation while keeping shared rows and producers for #2024.

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

At that cutover `Timeline` became the conversation's single thread surface: the user's `userText` echo and the
daemon's structured reply share the one ordered `timelineStore.items` array, so arrival order gives
one continuous thread with no split-brain and no empty second region. See
[#179 codebase notes](../codebase/179.md) for the full design, the security review, and lessons
learned.

## Queued rows folded into the thread (#1214, was #294, drop since #296, echo removal since #1213)

Queued content now comes from shown daemon `user_message` items and scoped local
pending sends. `ThreadItemsView` derives action handles with `threadQueueHandle`,
not queue-store/event matching. `foldQueuedRows` and its foreign-row projection were
deleted in #2023; `foldQueuedRows.ts` retains only `QueuedRowHandle`. The reducer's
local-echo/receipt APIs and tests remain until #2024 and cannot add accepted rows.
See [queue authority](conversation-shell.md#what-it-does) for supplied ordering,
identity damage, scoped targets and item-driven delivery/drop/loss.

**`TimelineRow`'s `userText` arm uses supplied queued presentation independently of
action eligibility.** A valid `QueuedRowHandle` enables the shared action column:

| | queued | delivered |
|---|---|---|
| row class | `message-row message-row--user message-row--queued message-row--text` | `message-row message-row--user message-row--text` |
| `data-thread-role` | `queued` | `user` |
| drop control | `QueuedRowDrop` (Cancel), in the leading actions column | none |
| Send now control | `QueuedRowSendNow`, above Cancel, only for explicit `midTurnInput: true` | none |
| `<BubbleMeta>` | **suppressed** | rendered |
| attachments | rendered (message content, not chrome) | rendered |

Queued bubbles omit delivery timestamps and sent copy/reply chrome, retaining valid
supplied attachments and the same desktop bubble styling. Their dimming remains
even without an actionable handle. Cancel and Send now require a shown active queued
item, connected owning host, usable raw `content.queued_msg_id` and injected callback;
Send now also requires the open session's `mid_turn_input` capability. No item id,
text match or legacy local-ownership inference can supply a missing handle.

`QueuedRowDrop` and `QueuedRowSendNow` remain native buttons with client-owned names
“Drop queued message” and “Send queued message now”. Activation routes the raw handle
through the existing `dequeueMessage`/`sendQueuedNow` command and rechecks eligibility.
A bridge throw preserves supplied state. There is no optimistic accepted-row removal
or pending-action ledger: controls and queued styling remain until a daemon revision
changes them. Drop hides after `shown: false`; delivered/lost revisions remove queue
actions even if another entry reuses the old handle.

**Queued side actions (#1868).** The queued `userText` arm renders a direct
`.message-actions.message-actions--queued` sibling before the bubble. Send now sits above Cancel;
without the capability, Cancel alone is centred. The column stretches to the bubble's height and
centres the stack vertically. It is 12px wide (`--space-3`), with a 12px bubble gap and
`gap: calc(var(--space-3) + var(--space-1) / 4)` between glyphs: 13px, giving 25px top-edge spacing.
Sent copy/reply keeps its separate 13px column and 12px glyph gap.

Both glyph spans are 12×12px masks from local `queued-send-now.svg` and `queued-cancel.svg` assets.
Send now matches the composer's normal circular send-chevron; Cancel is the close-modal X without
its circle. They inherit `--color-inverse-primary` through `currentColor`, including on hover.
The controls share copy/reply's CSS selectors: 4px vertical/8px horizontal padding with matching
negative margins gives each a 28×20px target without changing row layout. Only the hovered control
paints an isolated `::before` layer, inset 4px horizontally from the target, extending 4px beyond
each glyph edge with `--color-state-hover` fill and `--radius-xs` corners. Keyboard focus keeps
its 1px solid `--color-outline` outline; focus alone creates no hover layer.

**Dim the bubble, not its ancestor.** `.message-row--queued > .bubble { opacity: 0.5 }`
replaces the former row-level dimming, preserving the pending bubble, attachments and shadow at
50% while the column, buttons and hover layers stay fully opaque. Setting a child to `opacity: 1`
cannot undo an ancestor's opacity compositing group. The 50% value intentionally overrides Figma's
60% sample. The row retains the shared centred 900px text cap, 40px left inset and wrapping rules.

The [scroll pin](conversation-shell-scroll-pin.md) observes supplied item-list
changes and local pending sends. A legacy `queue_state` cannot create a projected
row. The queued design comes from [Figma Queued Message Actions](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=847-14138),
integrated row `847:14149` and hover variants `847:14124` / `847:14133`; see the
[#1868 plan](../../specs/architecture/1868-queued-message-actions.md).

### Queued-action testing

`ConversationScreen.test.tsx` statically checks the shared column, glyph spans, control order,
capability gate, disabled conditions and delivered-row exclusion. It cannot measure 12px glyphs,
opacity or interaction. `e2e/queued-send-now.spec.ts` measures short and wrapping rows at 800px and
1280px: column and glyph dimensions, centring, 25px glyph spacing, 12px bubble gap, containment,
bubble-only dimming, unchanged tint/geometry, isolated hover paint and keyboard focus. Its existing
frame case checks one `send_queued_now`, preserved queued controls and one row through delivery.
`e2e/queued-backlog-interrupt.spec.ts` retains supplied drop/queue interaction coverage;
`e2e/message-side-actions.spec.ts` now expects a queued actions column and bubble-only opacity.

`threadItems.test.tsx` additionally covers supplied queued ordering, handles,
item revisions and local pending settlement. Shared-row
markup assertions render `TimelineRow` directly; authoritative fixtures preserve
supplied content instead of constructing it through retired queue inference.

**Counted acceptance evidence (#1868).** Dispatcher browser gate 6 on
`e1e9e4b736e8e5eef98e842c939e4470528e4eb7` executed 346 tests: 346 passed, 0 failed,
4 skipped. The [verifier's verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1876#issuecomment-6045444570)
confirms the named specs were present and passed: `queued-send-now.spec.ts` 2/2,
`queued-backlog-interrupt.spec.ts` 1/1 and `message-side-actions.spec.ts` 2/2 (5 executed,
5 passed, 0 failed, 0 skipped). This includes `queued actions keep Figma geometry, full opacity, isolated hover and keyboard focus at 800 and 1280`.
The verifier reviewed ten unique integrated synthetic rest/hover/focus captures (twelve files,
including duplicate resting captures) against the Figma nodes above, with no unresolved deviation.
Windows were 800×800 and 1280×800; content viewports were 800×773 and 1280×773.
Captures and a revision/hash manifest were retained under `/tmp/verifier-1876/`, with originals
under `/tmp/builder-1868/`; these are scratch evidence, not durable repository artifacts.
Live Claude was not run by the verifier and is not claimed as passed for this presentation change.

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

