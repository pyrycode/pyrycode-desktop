# Thread timeline (conversation model)

A heterogeneous, ordered conversation-timeline data model — the foundation the structured
event-stream render vertical builds on. Introduced **alongside**
[session store](session-store.md)'s flat `MessagePayload[]` as a Strangler Fig: nothing cuts over,
no consumer imports it yet, and the coarse `message`/`message_chunk` render path is untouched.

The vertical this feeds decomposed along the transport → store → render seams the [screen snapshot
fetch](screen-snapshot-fetch.md) vertical (#180 → #187/#188) proved: [#199](../codebase/199.md)
(shipped) built the wire types, transport decode, and `DaemonEvent` arms (`assistantDelta`/`turnEnd`)
this module's `ThreadEvent` union is the eventual target of; [#202](../codebase/202.md) (shipped)
added the [Zustand store + the `DaemonEvent → ThreadEvent` bridge](conversation-timeline-store.md)
over `reduceTimeline`; [#203](../codebase/203.md) (shipped) renders the streamed text — the
blank-thread-critical slice that gates #179 (advertising the `interactive` capability). [#214](../codebase/214.md)
(shipped) wired the `turn_state` transport → bridge chain, giving `selectPhase` its first real source
(no render yet — the thinking indicator is a still-open sibling slice). [#217](../codebase/217.md)
(shipped) wired the `tool_use` transport → bridge chain, giving `reduceTimeline`'s pre-existing
`toolUse` arm its first real feed — a `toolCall` `ThreadItem` now lands on `selectItems` in arrival
order (no render yet — that is the sibling slice #218). [#229](../codebase/229.md) (shipped) wired the
`tool_result` transport → bridge chain, the vertical's last transport slice — giving `reduceTimeline`'s
pre-existing `toolResult` arm its first real feed, resolving the correlated `toolCall`'s `result` in
place via `fillResult` (no render yet — that is the sibling slice #230).

Introduced in [#121](../codebase/121.md). Lives at
`src/renderer/src/store/threadTimeline.ts`. Pure renderer state — no IPC, no preload bridge, no
transport, no React, no wire types. See [ADR 0008](../decisions/0008-thread-timeline-model.md) for
the full rationale and normative reducer contract.

## What it does

`sessionStore`'s `MessagePayload[]` is a homogeneous list of complete text messages: no room for a
tool call between two assistant text turns, no way to grow one bubble as streamed text deltas
arrive, no way to link a tool result back to the tool call it completes. This module models that
richer shape as a pure, unit-tested value type + reducer — nothing more. There is no Zustand store,
no singleton, no React hook here; that render-integration layer is #202/#203's.

## How it works

### Types

```ts
type TurnPhase = 'thinking' | 'responding' | 'idle'
interface ToolResult { isError: boolean; resultSummary: string }

type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string }
  | { kind: 'toolCall'; turnId: string; toolUseId: string; name: string; inputSummary: string; result: ToolResult | null }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }

type ThreadEvent =
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }

interface TimelineState { items: readonly ThreadItem[]; phase: TurnPhase }
```

`ThreadItem` is the durable, ordered content; `ThreadEvent` is the renderer-local (camelCase,
`conversation_id`-free) input the reducer consumes. **`turn_state` is deliberately not a
`ThreadItem` member** — it's a coarse conversation-level lifecycle scalar (the "thinking…"
indicator), so it's carried as `phase` beside `items` rather than interleaved as a timeline row.

### The reducer

`reduceTimeline(state, event): TimelineState` is pure and exported — no mutation, fresh state,
`switch` on `event.type` with an `assertNever` default — the same discipline as `sessionStore`'s
`reduceSession`:

| event | effect |
|---|---|
| `assistantDelta` | tail-check coalesce: same-`turnId` tail `assistantText` → replace with concatenated text; otherwise append fresh. `seq` carried, not consulted — arrival order is authoritative. |
| `toolUse` | append a fresh `toolCall` with `result: null` |
| `toolResult` | find the `toolCall` with matching `toolUseId` **and** `result === null`, fill it in place. No match (orphan or already-resolved duplicate) → **same `state` reference**, a deterministic non-throwing no-op. |
| `turnState` | set `phase`; same reference if unchanged (no-churn) |
| `turnEnd` | append a `turnBoundary`; does **not** touch `phase` |

`items` and `phase` are orthogonal: content events never touch `phase`, `turnState` never touches
`items`. `initialTimelineState = { items: [], phase: 'idle' }`; pure selectors `selectItems`,
`selectPhase` are the only read surface.

### Internal helpers (unexported)

- `appendDelta(items, turnId, text)` — the tail-check coalesce for `assistantDelta`; always
  returns a new array (a delta is always a change).
- `fillResult(items, toolUseId, result)` — the `toolResult` correlate-and-fill. Narrows via a
  `.map` callback whose `item.kind === 'toolCall'` guard narrows `item` so the spread
  (`{ ...item, result }`) type-checks with **no cast** — the codebase bans unchecked `as` in
  production even when a cast would be provably safe (code review caught an index-cast version of
  this in the first submission; see [#121 codebase notes](../codebase/121.md) § Patterns
  established). Returns the same array reference on no match, so the reducer can return the same
  `state`.

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

## Edge cases and limitations

- **Uncorrelated or duplicate `tool_result` is a silent no-op, not a surfaced error.** Evidence-based:
  the structured stream isn't receivable yet (desktop withholds the `interactive` capability until
  #179), so no orphan has been observed in practice. This absorbs a mid-turn-reconnect orphan (the
  `tool_use` fell before a replay cursor) without killing the timeline, but revisit if #202's
  reconnect replay is shown to actually produce them. The transport → bridge chain that can now feed a
  real `tool_result` is wired as of #229; the no-op behavior itself is unchanged.
  - No corresponding test currently is left uncovered — both the orphan and duplicate cases are
    unit-tested with `toBe` reference assertions (`timelineBridge.test.ts`, #229, driving a real store
    end to end).
- **`seq` is not consulted.** It's carried on `assistantDelta` for wire fidelity and a possible
  future monotonicity guard, but the reducer trusts arrival order — no reordering has been
  observed from the ordered Noise/WS transport.
- **Single active conversation.** `conversation_id` is dropped from `ThreadEvent`, mirroring
  `sessionStore`'s single-conversation assumption (ADR 0004). [#199](../codebase/199.md) already
  drops it at the `DaemonEvent` construction step (`daemonConnection.ts`), one layer below this
  module — #202's bridge inherits an event that has no `conversation_id` to further scope.
- **No stable per-item `id`.** `turnId` alone isn't unique (a tool call can split one turn into
  two `assistantText` items) — [#203](../codebase/203.md) resolved the React-key question at
  render time by keying on array index instead: the list is append-only with tail-mutation and never
  reorders or inserts mid-list (`appendDelta` grows the tail in place, every other arm appends a new
  tail, `fillResult` replaces a `toolCall` at its own index), so index identity is stable per logical
  item without needing a dedicated `id` field on `ThreadItem`.
- **Strangler Fig, not a migration.** `sessionStore`, `messageViewModel.ts`, and the coarse
  `message`/`message_chunk` path are completely untouched by this module's existence. The cutover
  decision (does the coarse path retire once `interactive` is on?) belongs to #179/#203.

## Related

- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — full
  rationale, every reducer arm's normative contract, and the Strangler-Fig coexistence decision.
- [#121 codebase notes](../codebase/121.md) — implementation summary and the `as`-cast rework.
- [Session store](session-store.md) — the `MessagePayload[]` store this coexists with and the
  `reduceSession`/`appendUnique` template this module's shape mirrors.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the `DaemonEvent → SessionAction`
  translator #202's `wire → ThreadEvent` bridge is modeled on.
- [Conversation timeline store](conversation-timeline-store.md) — the store + bridge #202 built over
  this module.
- [#199 codebase notes](../codebase/199.md) — the transport slice: wire types, decode, and the
  `assistantDelta`/`turnEnd` `DaemonEvent` arms this module's `ThreadEvent` union targets.
- [#202 codebase notes](../codebase/202.md) — the store + bridge slice built on this module.
- [#203 codebase notes](../codebase/203.md) — the render slice; resolved the React-key question (array
  index) and derived the streaming cursor structurally from the reducer's append-only/tail-mutation
  invariant.
- [#214 codebase notes](../codebase/214.md) — the `turn_state` transport slice: wire types, decode
  (closed-enum idiom), and the `turnState` `DaemonEvent`/`ThreadEvent` arms; gave `selectPhase` its
  first real source.
- [#217 codebase notes](../codebase/217.md) — the `tool_use` transport slice: wire types, decode
  (required-string presence, no enum), and the `toolUse` `DaemonEvent`/`ThreadEvent` arms; gave
  `reduceTimeline`'s `toolUse` arm its first real feed, appending a `toolCall` item onto `selectItems`.
- [#229 codebase notes](../codebase/229.md) — the `tool_result` transport slice, the vertical's last:
  wire types, decode (four required strings + one `requireBoolean`), and the `toolResult`
  `DaemonEvent`/`ThreadEvent` arms; gave `reduceTimeline`'s pre-existing `fillResult` correlation its
  first real feed, resolving a `toolCall`'s `result` in place on `selectItems`.
- [Inbound message decode](inbound-message-decode.md) / [Daemon-event channel](daemon-event-channel.md)
  — the boundary and channel #199 extended to produce those two arms.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline this ADR extends.
