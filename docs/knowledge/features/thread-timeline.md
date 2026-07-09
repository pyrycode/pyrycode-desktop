# Thread timeline (conversation model)

A heterogeneous, ordered conversation-timeline data model — the foundation the structured
event-stream render vertical (#199 and its peel-offs) will build on. Introduced **alongside**
[session store](session-store.md)'s flat `MessagePayload[]` as a Strangler Fig: nothing cuts over,
no consumer imports it yet, and the coarse `message`/`message_chunk` render path is untouched.

Introduced in [#121](../codebase/121.md). Lives at
`src/renderer/src/store/threadTimeline.ts`. Pure renderer state — no IPC, no preload bridge, no
transport, no React, no wire types. See [ADR 0008](../decisions/0008-thread-timeline-model.md) for
the full rationale and normative reducer contract.

## What it does

`sessionStore`'s `MessagePayload[]` is a homogeneous list of complete text messages: no room for a
tool call between two assistant text turns, no way to grow one bubble as streamed text deltas
arrive, no way to link a tool result back to the tool call it completes. This module models that
richer shape as a pure, unit-tested value type + reducer — nothing more. There is no Zustand store,
no singleton, no React hook here; that render-integration layer is #199's.

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

Nothing imports this module yet. The intended consumer, #199, will add:

- Structured wire types (`assistant_delta`, `turn_state`, `tool_use`, `tool_result`, `turn_end`)
- A transport decode + `DaemonEvent` arm
- A `daemonEventBridge`-shaped translator mapping wire snake_case → this module's `ThreadEvent`
  (field names here already mirror the wire, so that bridge is a thin rename)
- The Zustand store, singleton, React hook, and first render slice — the same factory pattern
  `sessionStore` uses (ADR 0004), applied to `TimelineState`/`reduceTimeline`

## Edge cases and limitations

- **Uncorrelated or duplicate `tool_result` is a silent no-op, not a surfaced error.** Evidence-based:
  the structured stream isn't receivable yet (desktop withholds the `interactive` capability until
  #179), so no orphan has been observed in practice. This absorbs a mid-turn-reconnect orphan (the
  `tool_use` fell before a replay cursor) without killing the timeline, but revisit if #199's
  reconnect replay is shown to actually produce them.
  - No corresponding test currently is left uncovered — both the orphan and duplicate cases are
    unit-tested with `toBe` reference assertions.
- **`seq` is not consulted.** It's carried on `assistantDelta` for wire fidelity and a possible
  future monotonicity guard, but the reducer trusts arrival order — no reordering has been
  observed from the ordered Noise/WS transport.
- **Single active conversation.** `conversation_id` is dropped from `ThreadEvent`, mirroring
  `sessionStore`'s single-conversation assumption (ADR 0004). Multi-conversation scoping is
  deferred to #199's bridge.
- **No stable per-item `id`.** `turnId` alone isn't unique (a tool call can split one turn into
  two `assistantText` items) — React keys are a #199 render-time concern, deliberately deferred.
- **Strangler Fig, not a migration.** `sessionStore`, `messageViewModel.ts`, and the coarse
  `message`/`message_chunk` path are completely untouched by this module's existence. The cutover
  decision (does the coarse path retire once `interactive` is on?) belongs to #179/#199.

## Related

- [ADR 0008 — Conversation-timeline model](../decisions/0008-thread-timeline-model.md) — full
  rationale, every reducer arm's normative contract, and the Strangler-Fig coexistence decision.
- [#121 codebase notes](../codebase/121.md) — implementation summary and the `as`-cast rework.
- [Session store](session-store.md) — the `MessagePayload[]` store this coexists with and the
  `reduceSession`/`appendUnique` template this module's shape mirrors.
- [Daemon-event bridge (renderer)](daemon-event-bridge.md) — the `DaemonEvent → SessionAction`
  translator #199's `wire → ThreadEvent` bridge is modeled on.
- [ADR 0004 — Renderer session store](../decisions/0004-renderer-session-store-reducer-wire-types.md)
  — the pure-reducer / sealed-union / wire-types-are-a-bridge-concern discipline this ADR extends.
