# Spec #121 — Introduce the `ThreadItem` conversation-timeline model

**Size:** S · **Security-sensitive:** no · **Figma:** N/A (pure data model, no rendering — render is #199)

Decision record: [ADR 0008](../../knowledge/decisions/0008-thread-timeline-model.md) — read it first; it fixes the member set, coalescing rule, correlation key, orphan outcome, and Strangler-Fig coexistence. This spec is the implementation contract for that ADR.

## Files to read first

- `src/renderer/src/store/sessionStore.ts:34-172` — **the template.** Copy its shape exactly: sealed union on a discriminant, pure exported reducer built without `...state` spread, `assertNever` exhaustiveness guard, `appendUnique`'s "return the same array reference when nothing changes" no-churn discipline, `initial…State` const, pure selectors. Your module is the same shape for a different state.
- `src/renderer/src/store/sessionStore.test.ts:1-217` — **the test idiom.** Fixture builders (`msg(...)`), `describe` blocks per behavior, reference-equality assertions (`toBe`) for no-churn and purity. Mirror this structure.
- `docs/knowledge/decisions/0008-thread-timeline-model.md` — the model, every reducer arm's contract, and the rationale. The reducer behavior section is normative.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` — why the reducer is pure/exported and why events are a renderer-local union, not wire types.
- `src/renderer/src/screens/conversation/messageViewModel.ts:16-19` — the `assertNever` pattern to reuse verbatim.
- `src/shared/wire/types.ts:40-97` — confirm the structured wire types do **not** exist here (`EnvelopeType` stops at `screen_snapshot`). You are **not** adding any. Your input is a renderer-local union.

## Context

`sessionStore` holds replies as a flat `MessagePayload[]` — homogeneous, complete text messages, no room for a tool call between two text turns, no growing-bubble coalescing, no tool-result correlation. The v2 structured stream (`assistant_delta`, `turn_state`, `tool_use`, `tool_result`, `turn_end`) needs a heterogeneous, ordered timeline to land on. This ticket introduces that model — **the pure model + reducer half only** — alongside `MessagePayload[]`, migrating nothing. Wire types, transport, IPC, and rendering are #199 (blocked-by this). See ADR 0008 for the full rationale.

## Design

One new module `src/renderer/src/store/threadTimeline.ts` and its test. **No other file changes.** No Zustand store, no React hook, no wire types — those are #199's.

### Types (the contract — do not add fields beyond these)

```ts
export type TurnPhase = 'thinking' | 'responding' | 'idle'
export interface ToolResult { isError: boolean; resultSummary: string }

export type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string }
  | { kind: 'toolCall'; turnId: string; toolUseId: string; name: string; inputSummary: string; result: ToolResult | null }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }

export type ThreadEvent =
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }

export interface TimelineState { items: readonly ThreadItem[]; phase: TurnPhase }
```

`ThreadEvent` is the renderer-local input union (camelCase, `conversation_id` dropped — single active conversation). #199's transport bridge will map wire snake_case → `ThreadEvent`, exactly as `daemonEventBridge` maps `DaemonEvent` → `SessionAction`. Field names/types here are load-bearing: they mirror the wire (`docs/protocol-mobile.md` § Interactive events) so #199's bridge is a thin rename.

### Reducer — `reduceTimeline(state: TimelineState, event: ThreadEvent): TimelineState`

Pure, exported, no mutation, no `...state` spread, `switch` on `event.type` with an `assertNever` default. Each arm's behavior (normative in ADR 0008 § Reducer behavior):

- **`assistantDelta`** — if the **last** item in `items` is an `assistantText` with the same `turnId`, replace it with a copy whose `text` is `tail.text + event.text` (new array, new item). Otherwise append a fresh `assistantText { turnId, text }`. `seq` is **not** consulted (carried for wire fidelity only; arrival order is authoritative).
- **`toolUse`** — append `toolCall { turnId, toolUseId, name, inputSummary, result: null }`.
- **`toolResult`** — find the `toolCall` whose `toolUseId` matches **and** `result === null`; replace it with a copy whose `result` is `{ isError, resultSummary }`. If none matches → **return the same `state` reference unchanged** (deterministic no-op; documented, non-throwing — see Error handling).
- **`turnState`** — return `{ items: state.items, phase: event.state }`; if `event.state === state.phase`, return the same `state` reference (no-churn).
- **`turnEnd`** — append `turnBoundary { turnId, stopReason }`. Does **not** touch `phase`.

Also export `initialTimelineState: TimelineState = { items: [], phase: 'idle' }`, and pure selectors `selectItems(s) => s.items`, `selectPhase(s) => s.phase` (the read surface, matching `sessionStore`).

Keep helper logic (tail-check, the tool-result replace) as small internal functions, in the spirit of `appendUnique`. Do not export them.

## State + concurrency model

None. This is a pure, synchronous, framework-free reducer over an in-memory value — no store, no async, no subscription, no teardown. The single active conversation is assumed (ADR 0004); multi-conversation scoping is #199's bridge concern. No React, no IPC, no transport imports in this module or its test (`node` test env, like `sessionStore.test.ts`).

## Error handling

The one failure mode this ticket addresses is an **uncorrelated or duplicate `toolResult`** (a `tool_result` whose `tool_use` was never seen, or whose `toolCall` already has a result). Outcome: **deterministic no-op returning the same `state` reference** — never a throw, never a partial mutation. This absorbs a mid-turn-reconnect orphan (the `tool_use` fell before the replay cursor) without killing the timeline, per AC4. It is drop-and-document, not a recovery path: no orphan item is synthesized (evidence-based — no orphan observed yet; #199 revisits if reconnect replay produces them). The `assertNever` default guards against an unhandled future event arm at compile time and throws only on a genuinely impossible runtime value, matching `reduceSession`.

## Testing strategy

`src/renderer/src/store/threadTimeline.test.ts`, vitest, `node` env, `reduceTimeline` exercised directly against injected `ThreadEvent` sequences (no store, no React) — mirror `sessionStore.test.ts`'s structure and use fixture builders. Cover, as bullet-pointed scenarios (write the code in the project idiom):

- **Append order** — a mixed sequence (`assistantDelta` → `toolUse` → `assistantDelta` for a *new* turn → `turnEnd`) yields items in exactly that arrival order.
- **Coalescing** — two successive `assistantDelta`s with the same `turnId` produce **one** `assistantText` whose `text` is the concatenation, not two items.
- **Coalescing breaks on interleave** — `assistantDelta`(turn A) → `toolUse`(turn A) → `assistantDelta`(turn A) yields **two** separate `assistantText` items with the tool call between them (tail is no longer text).
- **Coalescing breaks on new turn** — `assistantDelta`(turn A) → `assistantDelta`(turn B) yields two `assistantText` items.
- **Correlation** — `toolUse` then `toolResult` with the same `toolUseId` fills that `toolCall`'s `result`; assert `isError`/`resultSummary` land, and the item count stays 1 (no separate result item).
- **Orphan result (AC4)** — a `toolResult` with no matching `toolCall` returns the **same `state` reference** (`toBe`); the timeline is unchanged and nothing throws.
- **Duplicate result** — a second `toolResult` for an already-resolved `toolCall` is also a same-reference no-op.
- **Phase** — `turnState` updates `phase`; `items` is preserved by reference; a `turnState` equal to the current phase returns the same `state` reference (no-churn).
- **Turn boundary** — `turnEnd` appends a `turnBoundary` and leaves `phase` untouched.
- **Purity** — a reducer call does not mutate the input `state`, its `items` array, or any existing item (assert old references intact; new references where a change occurred).
- **Exhaustiveness** — a compile-time note: adding a `ThreadEvent` arm without a case is a type error (the `assertNever` guard; no runtime test needed).

Type coverage rides `npm run typecheck` (the discriminated unions + `assertNever`). Build gate `npm run build` and `npm test` must stay green — they will, because nothing imports the module.

## Out of scope (do not touch)

- `sessionStore.ts`, `messageViewModel.ts`, the coarse `message`/`message_chunk` path — untouched (Strangler Fig).
- Wire types (`src/shared/wire/types.ts`), transport decode, `DaemonEvent` arms, `daemonEventBridge.ts` — all #199.
- Any Zustand store, singleton, React hook, or rendering of `ThreadItem` — #199.
- Do not migrate any consumer; nothing imports `threadTimeline` at the end of this ticket.

## Open questions (resolve in #199, not here)

- Stable per-item `id` for React keys — `turnId` alone is not unique (a tool can split a turn into two `assistantText` items). #199 adds keying when it renders.
- `seq` monotonicity/dedup guard — add only if reconnect replay is observed to duplicate deltas.
- Whether an orphan `tool_result` should be surfaced rather than dropped — revisit if observed.
