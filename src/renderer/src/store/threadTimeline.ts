// The conversation timeline: a heterogeneous, ordered list of turn content (streamed
// assistant text, tool calls with their results, turn boundaries) plus the coarse
// conversation-level phase. Pure renderer state — no IPC, no preload bridge, no transport,
// no React. Introduced alongside `sessionStore`'s flat `MessagePayload[]` (Strangler Fig,
// ADR 0008): nothing cuts over here and no consumer imports this yet. #199 adds the
// structured wire types, the transport decode, and the bridge that maps wire (snake_case)
// envelopes into the `ThreadEvent`s this reducer consumes — the desktop analog of
// `daemonEventBridge` mapping `DaemonEvent` → `SessionAction`. See ADR 0008.

/** Coarse conversation-level lifecycle — the "thinking…" indicator. A scalar, not an item. */
export type TurnPhase = 'thinking' | 'responding' | 'idle'

/** The filled-in half of a `toolCall`, correlated to it by `toolUseId`. */
export interface ToolResult {
  isError: boolean
  resultSummary: string
}

/**
 * One item of durable, ordered timeline content. Discriminated on `kind`.
 * `turn_state` is deliberately NOT a member: it is a coarse lifecycle scalar (`TurnPhase`)
 * carried beside `items`, not a row in the timeline (ADR 0008).
 */
export type ThreadItem =
  | { kind: 'assistantText'; turnId: string; text: string }
  | {
      kind: 'toolCall'
      turnId: string
      toolUseId: string
      name: string
      inputSummary: string
      // Starts null on the `toolUse`; filled in place when the correlated `toolResult` arrives.
      result: ToolResult | null
    }
  | { kind: 'turnBoundary'; turnId: string; stopReason: string }

/**
 * The renderer-local, sealed input union the reducer consumes. camelCase and
 * `conversation_id`-free (single active conversation, ADR 0004); #199's bridge translates the
 * snake_case wire events into these. Field names mirror the wire so that bridge is a thin rename.
 */
export type ThreadEvent =
  // `seq` is carried for wire fidelity (and a future monotonicity guard) but not consulted —
  // arrival order is authoritative, per ADR 0004's caller-owns-ordering stance.
  | { type: 'assistantDelta'; turnId: string; seq: number; text: string }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; inputSummary: string }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean; resultSummary: string }
  | { type: 'turnState'; state: TurnPhase }
  | { type: 'turnEnd'; turnId: string; stopReason: string }

/** The whole timeline state: ordered content + the coarse lifecycle phase. */
export interface TimelineState {
  items: readonly ThreadItem[]
  phase: TurnPhase
}

/** Compile-time exhaustiveness guard: a new ThreadEvent arm without a case is a type error. */
function assertNever(event: never): never {
  throw new Error(`Unhandled thread event: ${JSON.stringify(event)}`)
}

/**
 * Coalesce a streamed text delta: if the tail item is an `assistantText` for the same turn,
 * return a new array whose tail is a copy with the concatenated text; otherwise append a fresh
 * `assistantText`. The tail-check naturally renders text → tool → text as three items while
 * collapsing consecutive deltas into one growing bubble. Always returns a new array (a delta is
 * always a change), matching `appendUnique`'s new-reference-on-change discipline.
 */
function appendDelta(
  items: readonly ThreadItem[],
  turnId: string,
  text: string
): readonly ThreadItem[] {
  const tail = items[items.length - 1]
  if (tail && tail.kind === 'assistantText' && tail.turnId === turnId) {
    const grown: ThreadItem = { kind: 'assistantText', turnId, text: tail.text + text }
    return [...items.slice(0, -1), grown]
  }
  return [...items, { kind: 'assistantText', turnId, text }]
}

/**
 * Correlate a tool result to its originating call by `toolUseId` alone (the wire's stable,
 * conversation-unique key): find the `toolCall` with a matching id AND a still-null result, and
 * return a new array with a copy whose `result` is filled. If none matches — orphan (no such
 * pending call) or duplicate (already resolved) — return the SAME array reference, so the caller
 * can return the same state unchanged (deterministic no-op, non-throwing, per ADR 0008 / AC4).
 */
function fillResult(
  items: readonly ThreadItem[],
  toolUseId: string,
  result: ToolResult
): readonly ThreadItem[] {
  let filled = false
  const next = items.map((item) => {
    // The `kind === 'toolCall'` guard narrows `item` to the toolCall member, so the spread
    // type-checks as a valid ThreadItem with no cast. `filled` fills only the first match.
    if (!filled && item.kind === 'toolCall' && item.toolUseId === toolUseId && item.result === null) {
      filled = true
      return { ...item, result }
    }
    return item
  })
  return filled ? next : items
}

/**
 * Pure reducer — no mutation, returns fresh state. `items` and `phase` are orthogonal: content
 * events never touch `phase`, `turnState` never touches `items`. Mirrors `reduceSession`: a
 * `switch` on the sealed union with an `assertNever` default, and same-reference returns when
 * nothing changes so unchanged slices do not churn selectors.
 */
export function reduceTimeline(state: TimelineState, event: ThreadEvent): TimelineState {
  switch (event.type) {
    case 'assistantDelta':
      return { items: appendDelta(state.items, event.turnId, event.text), phase: state.phase }
    case 'toolUse':
      return {
        items: [
          ...state.items,
          {
            kind: 'toolCall',
            turnId: event.turnId,
            toolUseId: event.toolUseId,
            name: event.name,
            inputSummary: event.inputSummary,
            result: null
          }
        ],
        phase: state.phase
      }
    case 'toolResult': {
      const items = fillResult(state.items, event.toolUseId, {
        isError: event.isError,
        resultSummary: event.resultSummary
      })
      // Orphan/duplicate result: fillResult returned the same array — return the same state.
      return items === state.items ? state : { items, phase: state.phase }
    }
    case 'turnState':
      // No-churn on an unchanged phase, mirroring appendUnique's pure-duplicate discipline.
      return event.state === state.phase ? state : { items: state.items, phase: event.state }
    case 'turnEnd':
      // Appends a boundary; does NOT reset phase — the daemon emits `turn_state: 'idle'` separately.
      return {
        items: [
          ...state.items,
          { kind: 'turnBoundary', turnId: event.turnId, stopReason: event.stopReason }
        ],
        phase: state.phase
      }
    default:
      return assertNever(event)
  }
}

export const initialTimelineState: TimelineState = { items: [], phase: 'idle' }

/** Selectors — the read surface, mirroring `sessionStore`'s. */
export const selectItems = (s: TimelineState): readonly ThreadItem[] => s.items
export const selectPhase = (s: TimelineState): TurnPhase => s.phase
