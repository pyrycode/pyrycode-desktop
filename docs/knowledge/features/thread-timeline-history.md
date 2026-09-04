# Thread timeline — ticket-by-ticket history

Split from [Thread timeline](thread-timeline.md) on 2026-09-04 to stay under the size cap. This is the
per-ticket changelog of every arm, scalar and field the model has grown; the current shape (types, reducer
contract, edge cases) stays on the parent page. Nothing here changes what's true today — read
[Thread timeline § How it works](thread-timeline.md#how-it-works) for that.

## Configuration and usage

Nothing imports this module yet.

- **[#199](../codebase/199.md) (shipped)** added the structured wire types
  (`AssistantDeltaPayload`/`TurnEndPayload`, `assistant_delta`/`turn_end` on `EnvelopeType`), the
  transport decode (`inboundMessage.ts`), and the `assistantDelta`/`turnEnd` `DaemonEvent` arms
  (`src/shared/ipc/events.ts`) — see [inbound message decode](inbound-message-decode.md) and
  [daemon-event channel](daemon-event-channel.md). At the time, `turn_state`/`tool_use`/`tool_result`
  were not yet decoded (still fell to `inbound-unmodeled → null`).
- **[#202](../codebase/202.md) (shipped)** added the `daemonEventBridge`-shaped translator mapping
  `DaemonEvent`'s wire-derived snake→camel fields onto this module's `ThreadEvent` — a filter, not a
  reshape, since the two owned arms are field-for-field identical (`turnId`/`seq`/`text`,
  `turnId`/`stopReason`) — plus the Zustand store, singleton, and React hook, the same factory
  pattern `sessionStore` uses (ADR 0004), applied to `TimelineState`/`reduceTimeline`. See
  [conversation timeline store](conversation-timeline-store.md).
- **[#203](../codebase/203.md) (shipped)** added the first render slice: the streamed assistant text
  + a streaming cursor on the timeline (`Timeline`, in `ConversationScreen.tsx`) — the
  blank-thread-critical render that gates #179. Resolved the React-key question below as array index.
- **[#214](../codebase/214.md) (shipped)** added the `turn_state` wire type, transport decode, and the
  `turnState` `DaemonEvent`/`ThreadEvent` arms — the fail-closed decode uses the `role`-style
  closed-enum idiom instead of `requireString`. `reduceTimeline`'s pre-existing `turnState` arm and
  `selectPhase` are unmodified by this ticket; it only wires up a real feed. No render — the thinking
  indicator is a still-open sibling slice.
- **[#217](../codebase/217.md) (shipped)** added the `tool_use` wire type, transport decode, and the
  `toolUse` `DaemonEvent`/`ThreadEvent` arms — five required-string fields, no enum (unlike
  `turn_state`). `reduceTimeline`'s pre-existing `toolUse` arm (append a `toolCall`, `result: null`,
  splitting a turn's text) and `selectItems` are unmodified by this ticket; it only wires up a real
  feed. No render — the tool row is a still-open sibling slice (#218), and correlating a later
  `tool_result` into `result` is a separate still-open ticket (#206, later split into transport #229 +
  render #230).
- **[#229](../codebase/229.md) (shipped)** added the `tool_result` wire type, transport decode, and the
  `toolResult` `DaemonEvent`/`ThreadEvent` arms — four required-string fields plus one required boolean
  (`is_error`, via `requireBoolean` — the `yolo` #180 idiom, `false` is a value, not an absence).
  `reduceTimeline`'s pre-existing `toolResult` arm and `fillResult` (below) are unmodified by this
  ticket; it only wires up a real feed, **resolving** the correlated `toolCall`'s `result` in place
  rather than appending a new item — the last transport slice of the vertical. No render — the
  success/error visual is the still-open sibling slice (#230). Also the ticket that surfaced a cost:
  by the time it shipped, [#223](../codebase/223.md) had added a **third** independent exhaustive
  `DaemonEvent` switch (`modalBridge.ts`), so a new arm now forces a case in three renderer bridges, not
  two — see [#229 codebase notes](../codebase/229.md) § Lessons learned.
- **[#230](../codebase/230.md) (shipped)** rendered the `toolResult`-filled `result` — `TimelineRow`'s
  `case 'toolCall'` now derives the wrapper `className` from `item.result` (`tool-row--resolved` iff
  filled, `tool-row--error` on top iff `isError`), lifting the pending 50% dimming and tinting the
  chip border with a newly-introduced `--color-error` token (M3 default dark error role, tone 80 —
  desktop's first error-family token). `reduceTimeline`'s `fillResult`/`ToolResult` shape is
  unmodified; `result.resultSummary` was deliberately not surfaced at the time (no result-text slot in
  the Figma mock) — **[#696](../codebase/696.md) reversed that decision** (below).
- **[#696](../codebase/696.md) (shipped)** drew `result.resultSummary` for the first time: the
  `toolCall` arm was extracted into an exported `ToolRow({ item, expanded? })`, and with `expanded`
  true and a result present a body stacks under the chip carrying the result text in a bounded,
  scrolling `<pre>` (`.unrecognized-row__raw`'s treatment). `reduceTimeline`'s `ToolResult` shape is
  unmodified — this is a render-only slice, pure view, no store/transport/wire change. Ships with
  nothing passing `expanded` yet, so `<Timeline>` still only ever produces the collapsed form; the
  toggle, the container state and the e2e are [#697](https://github.com/pyrycode/pyrycode-desktop/issues/697).
- **[#245](../codebase/245.md) (shipped)** added the fourth `ThreadItem` kind, `userText` — a plain
  fresh-tail-append (the `toolUse`/`turnEnd` discipline, not `assistantDelta`'s coalescing), no
  `turnId`/`seq` (a renderer-sourced echo has neither). Shipped **dormant**: no producer dispatched a
  `userText` event yet, and `TimelineRow`'s `case 'userText'` was a placeholder `return null`.
- **[#179](../codebase/179.md) (shipped)** wired `userText`'s producer — the composer's optimistic
  echo, retargeted from a `messageSent` `SessionAction` into `timelineStore.dispatch` — and the real
  render row (the right-aligned user bubble, replacing #245's placeholder). Flipped the `interactive`
  capability the whole vertical had been gated on, and retired the coarse `MessageThread` mount in the
  same commit. `reduceTimeline`'s `userText` arm is unmodified by this ticket. The vertical is
  complete.
- **[#286](../codebase/286.md) (shipped)** added a fifth `ThreadItem`/`ThreadEvent` kind,
  `sessionBoundary` — the `/clear`/idle-eviction/workspace-change marker #285 widened the
  `sessionTransition` `DaemonEvent` arm to carry. `timelineBridge.ts` moved that arm out of its no-op
  fall-through into a translating case (dropping `newSessionId`, which the sibling #259 session-id
  holder still owns unaffected); `reduceTimeline` fresh-tail-appends the item (the `userText`/`turnEnd`
  discipline, never coalesced); `TimelineRow` drew it as a titled horizontal rule via a pure
  `sessionBoundaryViewModel.ts` (at the time a long-form-relative-time sibling of
  `channelListViewModel.ts`'s `formatLastActivity`) — restyled and re-copied by
  [#690](https://github.com/pyrycode/pyrycode-desktop/issues/690), which dropped the relative time
  entirely; see [Conversation shell § Session-boundary
  delimiter](conversation-shell-session-and-channel-info.md#session-boundary-delimiter-286-redrawn-690). `item.occurredAt` stays
  on `ThreadItem` unaffected — the store still owns it, only the render layer stopped reading it. The
  fifth application of the "new timeline-item kind → bridge arm → render row" pattern (#218/#230/#245).
- **[#317](../codebase/317.md) (shipped)** added the `stalled` scalar and the `stallDetected` arm —
  the render consumer of [#315](../codebase/315.md)'s dormant, at-ship-time-nullary `DaemonEvent`.
  `timelineBridge.ts` moved `stallDetected` from its inverse-filter `null` group to an owned arm (a
  fresh, field-identical literal, since both sides were nullary at the time); `ConversationScreen.tsx`
  gained `StallIndicator`, `Timeline`/`ThinkingIndicator`'s twin. Unlike every prior extension, this
  one touches an **existing** scalar's clearing logic rather than only adding a new arm — see
  [Thread timeline § Edge cases](thread-timeline.md#edge-cases-and-limitations) for the widened no-op
  guards. [#732](../codebase/732.md) later widened `DaemonEvent.stallDetected` with `conversationId`;
  the bridge now filters it out rather than arm-selecting a field-identical literal, and
  `ThreadEvent.stallDetected` alone stays nullary.
- **[#493](../codebase/493.md) (shipped)** added the `apiRetry: ApiRetryStatus | null` scalar and the
  `apiRetry` arm — the render consumer of [#492](../codebase/492.md)'s dormant, non-nullary
  `DaemonEvent`. `timelineBridge.ts` moved `apiRetry` from its inverse-filter `null` group to an owned
  arm (a field-for-field literal, since this event carries data unlike `stallDetected`);
  `ConversationScreen.tsx` gained `ApiRetryIndicator` (`StallIndicator`'s twin) and a named
  `shouldShowThinking(ThreadStatus)` predicate that narrows `ThinkingIndicator`'s gate whenever a retry
  is live — closing the mutual-exclusion question #317 deferred. Like #317, this touches every existing
  arm's carry-through, but with the **clearing rule inverted** — see
  [Thread timeline § Edge cases](thread-timeline.md#edge-cases-and-limitations).
- **[#496](../codebase/496.md) (shipped)** added the `compacting: boolean` scalar and the `compacting`
  arm — the render consumer of [#495](../codebase/495.md)'s dormant, non-nullary `DaemonEvent`.
  `timelineBridge.ts` moved `compacting` from its inverse-filter `null` group to a ninth owned arm
  (field-for-field, like `apiRetry`); `ConversationScreen.tsx` gained `CompactingIndicator` (also
  `StallIndicator`'s twin) and a second `shouldShowThinking` clause, extending the seam #493 built by
  name for this ticket — one field, one clause, no new gate. `apiRetry`'s clearing-rule inversion, minus
  the counter — see [Thread timeline § Edge cases](thread-timeline.md#edge-cases-and-limitations).
- **[#528](../codebase/528.md) (shipped)** added the nullary `reset` arm — the first `ThreadEvent`
  that is neither daemon- nor user-content-derived, a renderer-lifecycle control event ported
  verbatim from [`sessionStore`'s `reset` (#166)](../codebase/166.md). `reduceTimeline`'s new arm
  returns `initialTimelineState` directly, clearing all five fields (`items`, `phase`, `stalled`,
  `apiRetry`, `compacting`) in one step. Shipped **capability-only**: no dispatch site landed in this
  ticket, and `timelineStore.ts`/`timelineBridge.ts` needed no edit — `dispatch` already accepted any
  `ThreadEvent`, and `timelineBridge.ts` never produces a `reset` since no wire frame maps to it.
  [#530](../codebase/530.md) (conversation switch, shipped) added the first dispatch site, via
  [`activateConversation`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx), gated on the active
  conversation's id actually changing. [#531](../codebase/531.md) (unpair / pair-another-server, shipped)
  added the second, unconditional site, via
  [`clearPairingScopedState`](paired-shell-routing.md#the-pure-view--container-pairedshelltsx).
  [#652](../codebase/652.md) (the deleted-open-discussion exit, shipped) added the third, via
  [`exitActiveConversation`](paired-shell.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652) —
  gated on the id like #530's, but comparing against the just-deleted conversation's id rather than a
  newly-opened one's.
- **[#538](../codebase/538.md) (shipped)** added a twelfth arm, the nullary `reconnected` — the second
  arm that is neither daemon- nor user-content-derived, but unlike `reset` it **is** bridge-produced:
  `timelineBridge.ts` maps the `connected` daemon edge onto it (moved out of the null fall-through
  cluster into an owned case), implementing `docs/protocol-mobile.md`'s Mode B reset-on-reconnect
  contract for the two two-edged chrome scalars (`apiRetry`, `compacting`) that were otherwise stuck
  forever once their falling edge was lost to a disconnect. Clears `phase`/`stalled`/`apiRetry`/
  `compacting` in one step while preserving `items` **by reference** — the Mode A/Mode B split held on
  the same connect. The [`modalStore` #415](../codebase/415.md) / `queueStore` #197 reconcile shape,
  applied a third time.
- **[#531](../codebase/531.md) (shipped)** added `reset`'s second production dispatch site — unpair and
  pair-another-server, the two paths that end a pairing rather than merely switch conversations, both
  routed through the new `clearPairingScopedState` helper alongside three sibling clears
  (`activeConversationStore`, `sessionIdStore`, `sessionStore`). Unlike `reconnected` above and unlike
  [#530](../codebase/530.md)'s conversation-switch dispatch, this one is unconditional — no id gate, no
  `connected`-edge trigger — because the pairing itself is ending and no state in which `items`
  legitimately survives. `reduceTimeline`'s `reset` arm is unmodified; this ticket only wires a second
  call site.
- **[#643](../codebase/643.md) (shipped)** widened the `toolUse` arm/`toolCall` item pair with one
  optional field, `input` — no new arm, no new item kind. `reduceTimeline`'s pre-existing `toolUse`
  arm and `fillResult` are otherwise unmodified; the reducer's appended literal gained one line
  carrying the map by reference. No render — [#645](https://github.com/pyrycode/pyrycode-desktop/issues/645)
  is the still-open sibling slice.
- **[#773](../codebase/773.md) (shipped)** widened the `toolResult` arm/`ToolResult` pair with one
  optional field, `resultDetail` — no new arm, no new item kind, and unlike #642/#643 it lands wire
  through item in a single ticket, since a scalar has no daemon-chosen-keys surface forcing a split.
  `reduceTimeline`'s pre-existing `toolResult` arm and `fillResult` are otherwise unmodified. No render
  — [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856) is the still-open sibling slice.
- **[#1013](https://github.com/pyrycode/pyrycode-desktop/issues/1013) (shipped)** widened
  `assistantText`/`userText` and their matching `ThreadEvent` arms with one optional field each,
  `createdAt` — the third instance of the `input`(#643)/`resultDetail`(#773) field-pair-widen shape,
  covered in full on the parent page (§ Types). No new arm, no new item kind, and `reduceTimeline`'s own
  signature is untouched — the clock rides the event rather than a reducer parameter, since both timeline
  stores call `reduceTimeline` from production code and a parameter there would have stamped the items 13
  of the ticket's 19 fenced `toEqual` expectations assert on.
- **[#1014](https://github.com/pyrycode/pyrycode-desktop/issues/1014) (shipped)** is the render sibling
  that fills [#969](../codebase/969.md)'s empty meta-row time slot — no change to this module: it reads
  `item.createdAt` as `=== undefined` per the contract above and formats it, no new arm and no reducer
  change. See [Conversation shell — message bubble § The meta
  row](conversation-shell-message-bubble.md#the-meta-row).
- **[#1039](../codebase/1039.md) (shipped)** widened `userText` and its matching `ThreadEvent` arm with
  one optional field, `attachments: readonly MessageAttachment[]` — the fourth field-pair widen in this
  family (`input`#643/`resultDetail`#773/`createdAt`#1013), and the first thing in this app that
  associates an attachment with a message. `reduceTimeline`'s `userText` arm carries the field
  unconditionally and **by reference** (never a spread, which on an absent list would silently mint `[]`).
  No new arm, no new item kind, and unlike `createdAt` there is no clock-vs-parameter question — the sole
  producer, [composer send](composer-send.md)'s `submitMessage`, normalises an empty take to `undefined`
  before the event is built, so the store never has to decide what an empty list means. Full field and
  type documentation lives on the parent page (§ Types); the composer-side accumulation
  (`reducePendingAttachments`, the pending-set ref) is [Composer attach § Pending
  attachments](composer-attach.md#pending-attachments-1039).

## Related

- [Thread timeline](thread-timeline.md) — the parent page: current types, reducer contract, edge cases.
