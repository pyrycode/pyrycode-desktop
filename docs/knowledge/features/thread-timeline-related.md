# Thread timeline — related

Part of [Thread timeline](thread-timeline.md).

## Related

- [Thread timeline — history](thread-timeline-history.md) — the ticket-by-ticket build-out of every arm,
  scalar and field, including the per-ticket `#XXX codebase notes` links this page used to carry, split
  out from this page on 2026-09-04 (and trimmed further on 2026-09-08 to stay under the size cap).
- [#1039](https://github.com/pyrycode/pyrycode-desktop/issues/1039) — added `attachments` to `userText`,
  covered in full above (§ Types, § Edge cases). Sole producer: [composer send](composer-send.md)'s
  `ComposerSendDeps.takeAttachments`, fed by [Composer attach § Pending
  attachments](composer-attach-pending.md#pending-attachments-1039)'s `reducePendingAttachments`. Consumer:
  [Conversation shell — message bubble § The attachment file
  row](conversation-shell-message-bubble-attachments.md#the-attachment-file-row-815-816) (#815, shipped). #868 (the image
  thumbnail, and #869's open-in-viewer click) has since shipped too.
- [#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) — added `createdAt` to
  `assistantText`/`userText`, covered in full above (§ Types, § Configuration and usage). Producers:
  [conversation timeline store](conversation-timeline-store.md)'s `translateTimelineEvent`/
  `subscribeTimeline` (assistant side) and [composer send](composer-send.md)'s `ComposerSendDeps.now`
  (user side). [#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) — shipped; the sibling
  slice that renders the stamp into [#969](../codebase/969.md)'s empty meta-row time slot. [Conversation
  shell — message bubble § The meta row](conversation-shell-message-bubble.md#the-meta-row) has the
  formatter and render-slot design.
- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — full
  rationale, every reducer arm's normative contract, and the Strangler-Fig coexistence decision.
- [#121 codebase notes](../codebase/121.md) — implementation summary and the `as`-cast rework.
- [Session store](session-store.md) — the `MessagePayload[]` store this coexists with and the
  `reduceSession`/`appendUnique` template this module's shape mirrors.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the `DaemonEvent → SessionAction`
  translator #202's `wire → ThreadEvent` bridge is modeled on.
- [Conversation timeline store](conversation-timeline-store.md) — the store + bridge #202 built over
  this module; its [internals](conversation-timeline-store-internals.md) page documents
  `timelineBridge.ts`'s `translateTimelineEvent`/`timelineTargetFor`, including the `thinkingProgress`
  arm [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) claimed.
- [Conversation timeline holder](conversation-timeline-holder.md) — a second, per-conversation-keyed
  store (#755) that imports `TimelineState`/`ThreadEvent`/`reduceTimeline` from this module unchanged,
  reusing the reducer rather than writing a second one.
- Every per-ticket `#XXX codebase notes` link this section used to carry (#199/#202/#203/#214/#217/#229/
  #230/#696/#245/#179/#286/#315/#732/#317/#492/#493/#495/#496/#528/#530/#531/#642/#643/#773/#538) moved to
  [Thread timeline — history § Related](thread-timeline-history.md#related) on 2026-09-08 to stay under
  the size cap; nothing about the current contract changed.
- [Paired shell](paired-shell.md) — the container `activateConversation` lives beside, and the nav sites
  that now dispatch `reset` on an actual conversation switch.
- [Inbound message decode](inbound-message-decode.md) / [Daemon-event channel](daemon-event-channel.md)
  — the boundary and channel #199 extended to produce those two arms.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline this ADR extends.
- [#1213](https://github.com/pyrycode/pyrycode-desktop/issues/1213) (PR
  [#1215](https://github.com/pyrycode/pyrycode-desktop/pull/1215)) — added `messageId` to `userText` and
  the `dropUserText` removal arm + `removeUserEcho`, covered in full above (§ Types, § The reducer, §
  Internal helpers, § Edge cases). Producer: [composer send](composer-send.md)'s `submitMessage`, which
  mints the id once for the wire frame and retains it on the echo. Consumer:
  [dequeue message envelope § Configuration and usage](dequeue-message-envelope.md#configuration-and-usage)'s
  `dropQueuedMessage`, which dispatches the removal to both this module's two host stores
  ([timeline store](conversation-timeline-store.md), [conversation timeline
  holder](conversation-timeline-holder.md)) on the same `message_id` the [queue
  store](queue-store.md)'s `QueuedItem` now carries (pyrycode#2092). Full design, including why the
  removal fires at the click rather than on a confirming snapshot: `docs/specs/architecture/1213-drop-queued-message-removes-echo.md`.
- [#1312](https://github.com/pyrycode/pyrycode-desktop/issues/1312) (decode) /
  [#1313](https://github.com/pyrycode/pyrycode-desktop/issues/1313) (IPC carry, dormant) /
  [#1314](https://github.com/pyrycode/pyrycode-desktop/issues/1314) (this module's `thinkingProgress` arm
  and `thinkingTokens` scalar) — covered in full above (§ Types, § The reducer, § Edge cases). Render
  consumer: [Conversation shell § Thinking / working
  indicator](conversation-shell-turn-status.md#thinking--working-indicator-215-held-for-the-whole-running-turn-since-648-tool-named-since-649-opens-on-send-since-650-folds-in-retry-compacting-and-stall-since-967)'s
  `thinkingLabel`. Full design and the security review of the unbounded daemon integer:
  `docs/specs/architecture/1314-thinking-token-estimate-status-row.md`.
