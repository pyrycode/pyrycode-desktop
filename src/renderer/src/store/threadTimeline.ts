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

/**
 * The reason a session rotated, renderer-local. A deliberate re-declaration of
 * `WireSessionTransitionReason` (the `TurnPhase` ↔ `WireTurnState` precedent), NOT an import — it keeps
 * this reducer wire-free, lets the bridge assign `event.reason` with no cast (the literal unions are
 * identical), and turns a future fourth wire reason into a compile error here (the intended no-drift guard).
 */
export type SessionBoundaryReason = 'clear' | 'idle_evict' | 'workspace_change'

/**
 * Where the daemon's stream parser met claude output it has no mapping for, renderer-local. A
 * deliberate re-declaration of `WireUnrecognizedSite` on the SessionBoundaryReason model, not an
 * import: it keeps this reducer wire-free, lets the bridge assign `event.site` with no cast (the
 * literal unions are identical), and turns a future fifth wire site into a compile error here.
 */
export type UnrecognizedSite = 'line_type' | 'assistant_block' | 'user_block' | 'undecodable'

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
  // The user's own message — a renderer-sourced echo, not daemon content, so it carries no `turnId`
  // (the daemon assigns those) and no `seq` (wire fidelity for daemon deltas): just the text. Ships
  // dormant; #179 wires the producer (the composer echo) and the render row.
  | { kind: 'userText'; text: string }
  // #286: the session-boundary delimiter — a `/clear`, an idle eviction, or a workspace change started a
  // fresh session. A whole marker, never coalesced. Carries the RAW `occurredAt` (formatted at render, the
  // channel-list precedent, so the relative time stays fresh) and the untrusted `workspaceCwd` (rendered as
  // auto-escaped text). `newSessionId` is deliberately absent — the #259 holder owns it; this render slice
  // consumes only the three display fields.
  | {
      kind: 'sessionBoundary'
      reason: SessionBoundaryReason
      workspaceCwd: string | null
      occurredAt: string
    }
  // The daemon's stream parser met claude output it has no mapping for. A durable ROW rather than a
  // chrome scalar (the contrast with `stalled` / `apiRetry` / `compacting` beside `items`), because it
  // is a discrete historical event with no clearing edge: it happened, at a point in the conversation,
  // and it stays there. A whole marker, NEVER coalesced — a repeat is a real repeat, and collapsing
  // repeats would hide how often this fires, which is the number that tells you to go fix it.
  //
  // No `turnId`, following `userText` and `sessionBoundary`: the daemon could not parse the message
  // well enough to attribute a turn to it. `messageType` may be the empty string (the `undecodable`
  // site read no type at all). `raw` and `messageType` are the most untrusted strings the timeline
  // holds — rendered as auto-escaped React children only, never through an HTML sink.
  | {
      kind: 'unrecognizedMessage'
      site: UnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }

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
  // The user's own message. A whole message, never a stream of deltas — folded by a plain fresh
  // tail-append (like `toolUse`/`turnEnd`), not coalesced via `appendDelta`.
  | { type: 'userText'; text: string }
  // #286: the session boundary. Field-for-field identical to the `sessionBoundary` ThreadItem, so the
  // bridge is a filter + fresh copy (not a remap); folded by a plain fresh tail-append (the `userText`
  // discipline), never coalesced.
  | { type: 'sessionBoundary'; reason: SessionBoundaryReason; workspaceCwd: string | null; occurredAt: string }
  // #317: the daemon's one-shot stall onset (#315 decodes it to a nullary `stallDetected` daemon event).
  // A NULLARY arm — the wire frame carries no field the renderer keeps, so this event has no payload
  // either. That is what makes AC4 ("no daemon-supplied string is ever rendered") true by construction:
  // there is no field to render. Onset-only; the reducer derives the self-clear on the next turn activity.
  | { type: 'stallDetected' }
  // #493: the daemon's api-retry edge (#492 decodes it). Field-for-field identical to the `apiRetry`
  // DaemonEvent, so the bridge is a filter + fresh copy (the `toolUse` / `sessionBoundary` discipline),
  // not a remap. The EVENT carries `active` — a faithful renderer-local re-declaration of the wire edge
  // (true rising, false the explicit falling one); the reducer is the single place that translates that
  // edge into the state's presence-or-absence. Two integers and a bool, no string field: AC1 ("no
  // daemon-supplied string is ever rendered") stays true by construction, as with `stallDetected`.
  | { type: 'apiRetry'; active: boolean; current: number; total: number }
  // #496: the daemon's compaction edge (#495 decodes it). Field-for-field identical to the `compacting`
  // DaemonEvent, so the bridge is a filter + fresh copy (the `apiRetry` discipline), not a remap. The
  // EVENT carries `active` (true rising, false the explicit falling one); the reducer is the single place
  // that translates that edge into state. BANNER-ONLY: the wire streams no compaction progress, so there
  // is no counter here and none may be invented (the one delta from `apiRetry`). One bool, no string
  // field: AC1 ("no daemon-supplied string is ever rendered") stays true by construction.
  | { type: 'compacting'; active: boolean }
  // The parser-gap diagnostic. Field-for-field identical to the `unrecognizedMessage` ThreadItem, so
  // the bridge is a filter + fresh copy (the `sessionBoundary` discipline), not a remap.
  | {
      type: 'unrecognizedMessage'
      site: UnrecognizedSite
      messageType: string
      raw: string
      truncated: boolean
    }
  // #528: return the whole timeline to its initial state on a context change (a conversation switch,
  // an unpair). The FIRST arm that is neither daemon- nor user-content-derived — a renderer lifecycle
  // control event, never translated from a wire frame, so `timelineBridge` never produces it. Nullary
  // following `stallDetected` (:109): a reset carries no payload, so there is no field a caller can
  // get wrong. `sessionStore`'s `reset` (#166) is the same arm for the session facet.
  | { type: 'reset' }

/**
 * #493: the live api-retry attempt counter. Present ⇒ a retry is in flight; `null` ⇒ none.
 *
 * A record rather than a flag because the render shows "attempt N/M", and `| null` rather than carrying
 * the wire's `active` because it collapses "not retrying" into ONE representation: the render gate is a
 * presence check, and the wire's "the falling edge repeats the last-known counter verbatim; the counter
 * is ignored once `active` is false" is true BY CONSTRUCTION — the falling edge stores `null`, so there
 * is nowhere for a stale counter to leak from. `{ current: 0, total: 0 }` is a PRESENT status meaning
 * "retrying, count unknown" — distinct from `null`, which means no retry at all.
 */
export interface ApiRetryStatus {
  current: number
  total: number
}

/** The whole timeline state: ordered content + the coarse lifecycle phase + the three chrome scalars. */
export interface TimelineState {
  items: readonly ThreadItem[]
  phase: TurnPhase
  // #317: a coarse, onset-only stall scalar (the `phase`-beside-`items` precedent — NOT a ThreadItem row).
  // Set by `stallDetected`, self-cleared by the reducer on the next turn-activity event.
  stalled: boolean
  // #493: the live api-retry status — the `stalled` twin with the clear semantics INVERTED. `api_retry`
  // has an explicit falling edge on the wire, so this is NEVER self-cleared by turn activity: only an
  // `active: false` event clears it. Chrome beside `items`, never a ThreadItem row.
  apiRetry: ApiRetryStatus | null
  // #496: whether claude is auto-compacting the conversation. `apiRetry`'s clear semantics (an explicit
  // wire falling edge, never self-cleared by turn activity) over `stalled`'s plain-boolean SHAPE: a plain
  // `boolean`, not a record and not `| null`, because `compacting` is a pure liveness fact with no counter
  // to hold — `| null` would invent a third state the wire cannot produce, and a record would cargo-cult
  // #493's structure past the reason for it. Chrome beside `items`, never a ThreadItem row.
  compacting: boolean
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
      // Turn activity — clears a live stall (AC2). Already returns a fresh `items`, so just carry
      // `stalled: false`.
      return {
        items: appendDelta(state.items, event.turnId, event.text),
        phase: state.phase,
        stalled: false,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'toolUse':
      // Turn activity — clears a live stall (AC2). Already appends a fresh `items`, so just carry
      // `stalled: false`.
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
        phase: state.phase,
        stalled: false,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'toolResult': {
      const items = fillResult(state.items, event.toolUseId, {
        isError: event.isError,
        resultSummary: event.resultSummary
      })
      // Turn activity — clears a live stall (AC2). Same-reference no-op ONLY when the result changed
      // nothing AND no stall is live; an orphan/duplicate result against a live stall must still clear
      // it, so the guard widens with `&& !state.stalled`. From `initialTimelineState` (stalled already
      // false) the orphan path still returns the same reference — the regression guard the test asserts.
      // #493/#496: the guard deliberately does NOT widen for `apiRetry` or `compacting` — both have an
      // explicit wire falling edge, so turn activity must LEAVE them showing (the inverse of `stalled`);
      // both are carried through unchanged on both paths.
      return items === state.items && !state.stalled
        ? state
        : {
            items,
            phase: state.phase,
            stalled: false,
            apiRetry: state.apiRetry,
            compacting: state.compacting
          }
    }
    case 'turnState':
      // Turn activity — clears a live stall (AC2, "any state, including idle"). No-churn ONLY when the
      // phase is unchanged AND no stall is live; an idle-when-already-idle turnState against a live stall
      // must still clear it, so the guard widens with `&& !state.stalled`.
      // #493/#496: the guard deliberately does NOT widen for `apiRetry` or `compacting` — a turn-state
      // change arriving mid-retry or mid-compaction is expected and must leave the status showing (the
      // inverse of `stalled`); both are carried unchanged.
      return event.state === state.phase && !state.stalled
        ? state
        : {
            items: state.items,
            phase: event.state,
            stalled: false,
            apiRetry: state.apiRetry,
            compacting: state.compacting
          }
    case 'turnEnd':
      // Appends a boundary; does NOT reset phase — the daemon emits `turn_state: 'idle'` separately.
      // NOT in AC2's clear set: a turn boundary is not turn activity; the paired `turn_state: idle` is
      // what clears. `stalled` carried through unchanged.
      return {
        items: [
          ...state.items,
          { kind: 'turnBoundary', turnId: event.turnId, stopReason: event.stopReason }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'userText':
      // A whole user message: fresh tail-append (never coalesced), `phase` untouched — the `turnEnd`
      // arm's discipline. Always a new `items` array (a fresh append is always a change). NOT in AC2's
      // clear set: a renderer-sourced echo is not daemon turn activity, so `stalled` is carried unchanged.
      return {
        items: [...state.items, { kind: 'userText', text: event.text }],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'sessionBoundary':
      // A whole boundary marker: fresh tail-append (never coalesced), `phase` untouched — the `userText` /
      // `turnEnd` discipline. Always a new `items` array (a fresh append is always a change). AC1. NOT in
      // AC2's clear set: a session rotation is not turn activity, so `stalled` is carried unchanged.
      return {
        items: [
          ...state.items,
          {
            kind: 'sessionBoundary',
            reason: event.reason,
            workspaceCwd: event.workspaceCwd,
            occurredAt: event.occurredAt
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'unrecognizedMessage':
      // A whole diagnostic marker: fresh tail-append, `phase` untouched — the `sessionBoundary` /
      // `userText` discipline. Always a new `items` array (a fresh append is always a change).
      //
      // DELIBERATELY NOT COALESCED, and this is the one design decision worth defending here. Every
      // other repeat-prone thing in this reducer collapses; this one must not. A repeat is a real
      // repeat, and how often it fires is precisely the number that tells an operator to go fix
      // something — collapsing repeats would hide the signal the row exists to carry.
      //
      // NOT in the turn-activity clear set either: an unrecognized message is not turn activity, so
      // `stalled`, `apiRetry` and `compacting` are all carried through unchanged. It neither opens nor
      // closes a turn, matching the daemon, which cannot honestly attribute one.
      return {
        items: [
          ...state.items,
          {
            kind: 'unrecognizedMessage',
            site: event.site,
            messageType: event.messageType,
            raw: event.raw,
            truncated: event.truncated
          }
        ],
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: state.apiRetry,
        compacting: state.compacting
      }
    case 'stallDetected':
      // #317: onset-only stall — set the scalar, leave `items`/`phase` untouched. A redundant onset (the
      // stall is already live) is a same-reference no-op, mirroring the pure-duplicate discipline of the
      // other arms. `apiRetry` and `compacting` are independent facts, carried through unchanged.
      return state.stalled
        ? state
        : {
            items: state.items,
            phase: state.phase,
            stalled: true,
            apiRetry: state.apiRetry,
            compacting: state.compacting
          }
    case 'apiRetry': {
      // #493: the two-edged api-retry status — set from the rising edge, cleared ONLY by the falling one.
      // `items`/`phase`/`stalled`/`compacting` are untouched on every path: the retry status is chrome,
      // and it neither clears nor is cleared by the other two scalars (three independent daemon facts,
      // the #317 posture).
      if (!event.active) {
        // The falling edge. `event.current` / `event.total` are deliberately NOT read — the wire repeats
        // the last-known counter here and it is ignored. A falling edge against no live retry is a
        // same-reference no-op.
        return state.apiRetry === null
          ? state
          : {
              items: state.items,
              phase: state.phase,
              stalled: state.stalled,
              apiRetry: null,
              compacting: state.compacting
            }
      }
      // The rising edge re-fires as the count climbs and the daemon may repeat an identical frame (no
      // wire-side dedup), so an unchanged counter returns the SAME state reference — the status never
      // stacks, duplicates, or flickers (AC2) — while a climbing count swaps in a fresh status record.
      // `{ current: 0, total: 0 }` is held as a PRESENT status ("retrying, count unknown"), never null.
      const held = state.apiRetry
      if (held !== null && held.current === event.current && held.total === event.total) return state
      return {
        items: state.items,
        phase: state.phase,
        stalled: state.stalled,
        apiRetry: { current: event.current, total: event.total },
        compacting: state.compacting
      }
    }
    case 'compacting':
      // #496: the two-edged compaction status — set from the rising edge, cleared ONLY by the falling one
      // (turn activity must NOT clear it; see the two deliberately un-widened guards above). The state IS
      // the event's payload, so both edges collapse into one expression: an edge that changes nothing —
      // a verbatim repeat of EITHER edge, the wire has no dedup — returns the SAME state reference, so
      // the status never stacks, duplicates, or flickers (AC3). `items`/`phase` are untouched on every
      // path: compaction is transient chrome, and it neither opens, closes, nor alters a turn (AC5).
      // `stalled` and `apiRetry` are independent daemon facts, carried through unchanged.
      return state.compacting === event.active
        ? state
        : {
            items: state.items,
            phase: state.phase,
            stalled: state.stalled,
            apiRetry: state.apiRetry,
            compacting: event.active
          }
    case 'reset':
      // All five fields clear in one step. Returning the shared const rather than a hand-written
      // literal is what makes the equality with `initialTimelineState` an identity instead of a
      // coincidence — a sixth `TimelineState` field is cleared for free, where a literal would
      // silently keep the stale value and still compile. It also buys two properties: a second reset
      // is a no-op reference (idempotent), and `items` stays the SAME reference, so a no-op reset
      // churns no `selectItems` subscriber where a fresh `[]` would re-render every one of them.
      // Aliasing the shared `items` is safe because the reducer only ever spreads it into a new
      // array, never mutates it (pinned by the purity block). The `sessionStore.ts` #166 rationale.
      return initialTimelineState
    default:
      return assertNever(event)
  }
}

export const initialTimelineState: TimelineState = {
  items: [],
  phase: 'idle',
  stalled: false,
  apiRetry: null,
  compacting: false
}

/** Selectors — the read surface, mirroring `sessionStore`'s. */
export const selectItems = (s: TimelineState): readonly ThreadItem[] => s.items
export const selectPhase = (s: TimelineState): TurnPhase => s.phase
export const selectStalled = (s: TimelineState): boolean => s.stalled
export const selectApiRetry = (s: TimelineState): ApiRetryStatus | null => s.apiRetry
export const selectCompacting = (s: TimelineState): boolean => s.compacting
