import { describe, it, expect } from 'vitest'
import {
  reduceTimeline,
  initialTimelineState,
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry,
  selectCompacting,
  type ThreadEvent,
  type ThreadItem,
  type TimelineState
} from './threadTimeline'

// Fixture builders — plain renderer-local events, no transport/wire involved. Mirror
// sessionStore.test.ts's `msg(...)` idiom: sensible defaults, override only what a case asserts.
function delta(turnId: string, text: string, seq = 0): ThreadEvent {
  return { type: 'assistantDelta', turnId, seq, text }
}

function toolUse(turnId: string, toolUseId: string, name = 'Read'): ThreadEvent {
  return { type: 'toolUse', turnId, toolUseId, name, inputSummary: `${name}(${toolUseId})` }
}

function toolResult(
  turnId: string,
  toolUseId: string,
  isError = false,
  resultSummary = `ok ${toolUseId}`
): ThreadEvent {
  return { type: 'toolResult', turnId, toolUseId, isError, resultSummary }
}

function turnEnd(turnId: string, stopReason = 'end_turn'): ThreadEvent {
  return { type: 'turnEnd', turnId, stopReason }
}

function userText(text: string): ThreadEvent {
  return { type: 'userText', text }
}

function sessionBoundary(
  reason: 'clear' | 'idle_evict' | 'workspace_change' = 'clear',
  workspaceCwd: string | null = null,
  occurredAt = '2026-01-15T12:00:00.000Z'
): ThreadEvent {
  return { type: 'sessionBoundary', reason, workspaceCwd, occurredAt }
}

function stall(): ThreadEvent {
  return { type: 'stallDetected' }
}

function apiRetry(active: boolean, current = 0, total = 0): ThreadEvent {
  return { type: 'apiRetry', active, current, total }
}

function compacting(active: boolean): ThreadEvent {
  return { type: 'compacting', active }
}

/** Fold a sequence of events over the initial state — the reducer's natural exercise shape. */
function run(events: readonly ThreadEvent[]): TimelineState {
  return events.reduce(reduceTimeline, initialTimelineState)
}

describe('reduceTimeline — append order', () => {
  it('preserves arrival order across a mixed sequence', () => {
    const state = run([
      delta('A', 'hello'),
      toolUse('A', 't1'),
      delta('B', 'world'),
      turnEnd('B')
    ])
    expect(state.items.map((i) => i.kind)).toEqual([
      'assistantText',
      'toolCall',
      'assistantText',
      'turnBoundary'
    ])
  })
})

describe('reduceTimeline — sessionBoundary (#286)', () => {
  it('appends a fresh sessionBoundary item in arrival order, between the surrounding items, never coalesced', () => {
    const state = run([
      delta('A', 'before the break'),
      sessionBoundary('workspace_change', '/home/user/next', '2026-01-15T10:00:00.000000000Z'),
      userText('after the break')
    ])
    expect(state.items.map((i) => i.kind)).toEqual([
      'assistantText',
      'sessionBoundary',
      'userText'
    ])
    const item = state.items[1] as Extract<ThreadItem, { kind: 'sessionBoundary' }>
    expect(item).toEqual({
      kind: 'sessionBoundary',
      reason: 'workspace_change',
      workspaceCwd: '/home/user/next',
      occurredAt: '2026-01-15T10:00:00.000000000Z'
    })
  })

  it('always yields a new items array (a fresh append is always a change) and leaves phase untouched', () => {
    const before = { ...initialTimelineState, phase: 'thinking' as const }
    const after = reduceTimeline(before, sessionBoundary())
    expect(after.items).not.toBe(before.items)
    expect(after.items).toHaveLength(1)
    expect(after.phase).toBe('thinking')
  })

  it('carries a null workspaceCwd for clear / idle_evict verbatim (wire nullability preserved)', () => {
    const state = run([sessionBoundary('idle_evict', null)])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'sessionBoundary' }>
    expect(item.reason).toBe('idle_evict')
    expect(item.workspaceCwd).toBeNull()
  })
})

describe('reduceTimeline — assistantDelta coalescing', () => {
  it('coalesces two successive deltas of the same turn into one growing text item', () => {
    const state = run([delta('A', 'Hel'), delta('A', 'lo')])
    expect(state.items).toHaveLength(1)
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.kind).toBe('assistantText')
    expect(item.text).toBe('Hello')
    expect(item.turnId).toBe('A')
  })

  it('does not consult seq — arrival order is authoritative even when seq decreases', () => {
    const state = run([delta('A', 'Hel', 5), delta('A', 'lo', 1)])
    expect(state.items).toHaveLength(1)
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.text).toBe('Hello')
  })

  it('breaks coalescing when a tool call interleaves (tail is no longer text)', () => {
    const state = run([delta('A', 'before'), toolUse('A', 't1'), delta('A', 'after')])
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText', 'toolCall', 'assistantText'])
    const first = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    const last = state.items[2] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(first.text).toBe('before')
    expect(last.text).toBe('after')
  })

  it('breaks coalescing across a new turn', () => {
    const state = run([delta('A', 'first'), delta('B', 'second')])
    expect(state.items).toHaveLength(2)
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText', 'assistantText'])
    expect((state.items[0] as { turnId: string }).turnId).toBe('A')
    expect((state.items[1] as { turnId: string }).turnId).toBe('B')
  })
})

describe('reduceTimeline — tool-result correlation', () => {
  it('fills the originating toolCall in place, keeping the item count at 1', () => {
    const state = run([toolUse('A', 't1', 'Bash'), toolResult('A', 't1', true, 'boom')])
    expect(state.items).toHaveLength(1)
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.kind).toBe('toolCall')
    expect(call.result).toEqual({ isError: true, resultSummary: 'boom' })
  })

  it('correlates by toolUseId when two calls are pending', () => {
    const state = run([toolUse('A', 't1'), toolUse('A', 't2'), toolResult('A', 't2', false, 'done-2')])
    const calls = state.items as ReadonlyArray<Extract<ThreadItem, { kind: 'toolCall' }>>
    expect(calls[0].result).toBeNull()
    expect(calls[1].result).toEqual({ isError: false, resultSummary: 'done-2' })
  })

  it('is a same-reference no-op when no matching toolCall exists (orphan result — AC4)', () => {
    const withCall = run([toolUse('A', 't1')])
    const after = reduceTimeline(withCall, toolResult('A', 'nope'))
    expect(after).toBe(withCall)
  })

  it('does not throw on an orphan result against an empty timeline', () => {
    expect(() => reduceTimeline(initialTimelineState, toolResult('A', 't1'))).not.toThrow()
    expect(reduceTimeline(initialTimelineState, toolResult('A', 't1'))).toBe(initialTimelineState)
  })

  it('is a same-reference no-op for a duplicate result against an already-resolved call', () => {
    const resolved = run([toolUse('A', 't1'), toolResult('A', 't1')])
    const dup = reduceTimeline(resolved, toolResult('A', 't1', true, 'second'))
    expect(dup).toBe(resolved)
  })
})

describe('reduceTimeline — phase (turnState)', () => {
  it('updates phase and preserves items by reference', () => {
    const withItems = run([delta('A', 'hi')])
    const thinking = reduceTimeline(withItems, { type: 'turnState', state: 'thinking' })
    expect(thinking.phase).toBe('thinking')
    expect(thinking.items).toBe(withItems.items)
  })

  it('is a same-reference no-op when the phase is unchanged', () => {
    const responding = reduceTimeline(initialTimelineState, { type: 'turnState', state: 'responding' })
    const again = reduceTimeline(responding, { type: 'turnState', state: 'responding' })
    expect(again).toBe(responding)
  })
})

describe('reduceTimeline — turn boundary', () => {
  it('appends a turnBoundary and leaves phase untouched', () => {
    const thinking = reduceTimeline(initialTimelineState, { type: 'turnState', state: 'thinking' })
    const ended = reduceTimeline(thinking, turnEnd('A', 'max_tokens'))
    expect(ended.items).toHaveLength(1)
    const boundary = ended.items[0] as Extract<ThreadItem, { kind: 'turnBoundary' }>
    expect(boundary).toEqual({ kind: 'turnBoundary', turnId: 'A', stopReason: 'max_tokens' })
    expect(ended.phase).toBe('thinking')
  })
})

describe('reduceTimeline — userText (user message)', () => {
  it('appends exactly one userText item carrying the text, leaving phase idle', () => {
    const state = run([userText('hello')])
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toEqual({ kind: 'userText', text: 'hello' })
    expect(state.phase).toBe('idle')
  })

  it('appends at the tail, preserving existing items by reference', () => {
    const withText = run([delta('A', 'hi')])
    const priorItem = withText.items[0]
    const next = reduceTimeline(withText, userText('you typed this'))
    expect(next.items.map((i) => i.kind)).toEqual(['assistantText', 'userText'])
    // The prior assistantText survives, same reference, original text intact.
    expect(next.items[0]).toBe(priorItem)
    expect((next.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>).text).toBe('hi')
    expect(next.items[1]).toEqual({ kind: 'userText', text: 'you typed this' })
  })

  it('leaves phase untouched — a user message is not a lifecycle event', () => {
    const thinking = reduceTimeline(initialTimelineState, { type: 'turnState', state: 'thinking' })
    const after = reduceTimeline(thinking, userText('still thinking?'))
    expect(after.phase).toBe('thinking')
    expect(after.items).toEqual([{ kind: 'userText', text: 'still thinking?' }])
  })

  it('returns a new items array without mutating the input state or its items', () => {
    const start = run([delta('A', 'hi')])
    const startItems = start.items
    const next = reduceTimeline(start, userText('typed'))
    expect(next.items).not.toBe(start.items)
    expect(start.items).toBe(startItems)
    expect(start.items).toHaveLength(1)
  })

  it('lands in arrival order interleaved among the other fresh-append arms', () => {
    const state = run([userText('q'), delta('A', 'answer'), turnEnd('A')])
    expect(state.items.map((i) => i.kind)).toEqual(['userText', 'assistantText', 'turnBoundary'])
  })
})

describe('reduceTimeline — stall indicator (#317)', () => {
  it('stallDetected sets stalled true from the initial state (AC1)', () => {
    const state = run([stall()])
    expect(state.stalled).toBe(true)
    // Onset only flips the scalar — items/phase are untouched.
    expect(state.items).toEqual([])
    expect(state.phase).toBe('idle')
  })

  it('a redundant stall onset is a same-reference no-op (no churn)', () => {
    const stalled = run([stall()])
    const again = reduceTimeline(stalled, stall())
    expect(again).toBe(stalled)
  })

  // AC2 — each of the four turn-activity events clears a live stall, one case per arm.
  it('assistantDelta clears a live stall (AC2)', () => {
    const state = run([stall(), delta('A', 'hi')])
    expect(state.stalled).toBe(false)
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText'])
  })

  it('toolUse clears a live stall (AC2)', () => {
    const state = run([stall(), toolUse('A', 't1')])
    expect(state.stalled).toBe(false)
    expect(state.items.map((i) => i.kind)).toEqual(['toolCall'])
  })

  it('toolResult clears a live stall even when the result is an orphan (still turn activity, AC2)', () => {
    // An orphan result changes no items (a same-reference fillResult), but it is turn activity, so it
    // must still clear the stall — the widened no-op guard.
    const state = run([stall(), toolResult('A', 'nope')])
    expect(state.stalled).toBe(false)
  })

  it('a toolResult that fills a pending call clears a live stall (AC2)', () => {
    const state = run([toolUse('A', 't1'), stall(), toolResult('A', 't1')])
    expect(state.stalled).toBe(false)
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.result).toEqual({ isError: false, resultSummary: 'ok t1' })
  })

  it('turnState clears a live stall for a non-idle state (AC2)', () => {
    const state = run([stall(), { type: 'turnState', state: 'thinking' }])
    expect(state.stalled).toBe(false)
    expect(state.phase).toBe('thinking')
  })

  it('turnState clears a live stall even for idle — the case a naive guard would miss (AC2)', () => {
    // The stall arrives while phase is already idle; an idle turnState is "no phase change" but IS turn
    // activity, so the widened guard must still clear the stall (AC2 "any state, including idle").
    const state = run([stall(), { type: 'turnState', state: 'idle' }])
    expect(state.stalled).toBe(false)
    expect(state.phase).toBe('idle')
  })

  // AC2 lists exactly four clearing events — a stall alone stays shown, and the three non-activity arms
  // (turnEnd / userText / sessionBoundary) leave it shown.
  it('a stall with no following activity keeps stalled true', () => {
    expect(run([stall()]).stalled).toBe(true)
  })

  it('turnEnd does NOT clear a stall (a boundary, not turn activity — the daemon clears via turn_state idle)', () => {
    expect(run([stall(), turnEnd('A')]).stalled).toBe(true)
  })

  it('userText does NOT clear a stall (a renderer-sourced echo, not daemon turn activity)', () => {
    expect(run([stall(), userText('typed while stuck')]).stalled).toBe(true)
  })

  it('sessionBoundary does NOT clear a stall (a session rotation, not turn activity)', () => {
    expect(run([stall(), sessionBoundary()]).stalled).toBe(true)
  })

  // Regression guard: the widened toolResult no-op guard must keep the orphan-against-initial path a
  // same-reference return, because initialTimelineState.stalled is already false (mirrors line ~165).
  it('the toolResult-orphan same-reference no-op survives the widened guard (regression, AC)', () => {
    // items unchanged AND !stalled → the reducer returns the exact same reference.
    expect(reduceTimeline(initialTimelineState, toolResult('A', 't1'))).toBe(initialTimelineState)
  })
})

// #493: the api-retry status — the stall scalar's structural twin with the clear semantics INVERTED.
// `api_retry` has an explicit falling edge on the wire, so the reducer never self-clears it: turn
// activity leaves it showing (the deliberate inverse of the #317 clearing tests above). Held as
// `ApiRetryStatus | null` — presence IS "a retry is in flight", so the falling edge discards the
// counter with nowhere to leak it from.
describe('reduceTimeline — api-retry status (#493)', () => {
  it('starts absent on the initial state, and selectApiRetry reads the slice', () => {
    expect(initialTimelineState.apiRetry).toBeNull()
    expect(selectApiRetry(initialTimelineState)).toBeNull()
  })

  it('a rising edge holds the attempt counter, leaving items/phase untouched (AC1)', () => {
    const state = run([apiRetry(true, 3, 10)])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
    expect(selectApiRetry(state)).toEqual({ current: 3, total: 10 })
    // Chrome, never a ThreadItem row — the `phase`-beside-`items` precedent.
    expect(state.items).toEqual([])
    expect(state.phase).toBe('idle')
  })

  it('a climbing rising edge replaces the held counter in place (AC2)', () => {
    const state = run([apiRetry(true, 3, 10), apiRetry(true, 4, 10)])
    expect(state.apiRetry).toEqual({ current: 4, total: 10 })
    // Still one status, never stacked.
    expect(state.items).toEqual([])
  })

  it('a verbatim repeated rising edge is a same-reference no-op — no churn, no flicker (AC2)', () => {
    // The wire has no dedup, so the daemon may repeat an identical frame; an identical repeat must not
    // churn the selector into a re-render.
    const retrying = run([apiRetry(true, 3, 10)])
    expect(reduceTimeline(retrying, apiRetry(true, 3, 10))).toBe(retrying)
  })

  it('a 0/0 rising edge yields a PRESENT status with both zeros, never null (AC3)', () => {
    // "retrying, count unknown" — a live retry, not the absence of one. Conflating the two would lose
    // the distinction the view needs to omit the counter.
    const state = run([apiRetry(true, 0, 0)])
    expect(state.apiRetry).toEqual({ current: 0, total: 0 })
    expect(state.apiRetry).not.toBeNull()
  })

  it('a falling edge clears the status (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), apiRetry(false, 3, 10)])
    expect(state.apiRetry).toBeNull()
  })

  it('a falling edge carrying a non-zero counter still clears — the counter is ignored (AC4)', () => {
    // The wire repeats the last-known counter verbatim on the falling edge; `null` discards it.
    const state = run([apiRetry(true, 3, 10), apiRetry(false, 4, 10)])
    expect(state.apiRetry).toBeNull()
  })

  it('a redundant falling edge against no live retry is a same-reference no-op', () => {
    expect(reduceTimeline(initialTimelineState, apiRetry(false, 0, 0))).toBe(initialTimelineState)
  })

  // AC4 — the inverse of #317: each of the four turn-activity arms leaves a live retry SHOWING. These
  // four are the cases a copied `stalled: false` clear-set (or a widened no-op guard) would break.
  it('assistantDelta leaves a live retry showing (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), delta('A', 'hi')])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText'])
  })

  it('toolUse leaves a live retry showing (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), toolUse('A', 't1')])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
  })

  it('an orphan toolResult leaves a live retry showing — the no-op guard must NOT widen (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), toolResult('A', 'nope')])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
  })

  it('a toolResult that fills a pending call leaves a live retry showing (AC4)', () => {
    const state = run([toolUse('A', 't1'), apiRetry(true, 3, 10), toolResult('A', 't1')])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
  })

  it('turnState leaves a live retry showing for a non-idle state (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), { type: 'turnState', state: 'thinking' }])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
    expect(state.phase).toBe('thinking')
  })

  it('an idle turnState leaves a live retry showing — the second guard that must NOT widen (AC4)', () => {
    const state = run([apiRetry(true, 3, 10), { type: 'turnState', state: 'idle' }])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
    expect(state.phase).toBe('idle')
  })

  it('turnEnd / userText / sessionBoundary carry a live retry through unchanged', () => {
    expect(run([apiRetry(true, 3, 10), turnEnd('A')]).apiRetry).toEqual({ current: 3, total: 10 })
    expect(run([apiRetry(true, 3, 10), userText('typed')]).apiRetry).toEqual({ current: 3, total: 10 })
    expect(run([apiRetry(true, 3, 10), sessionBoundary()]).apiRetry).toEqual({ current: 3, total: 10 })
  })

  // The two problem-state scalars are independent facts — neither clears the other.
  it('a stall onset leaves a live retry showing, and both scalars coexist', () => {
    const state = run([apiRetry(true, 3, 10), stall()])
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
    expect(state.stalled).toBe(true)
  })

  it('an api-retry event leaves `stalled` unchanged in both directions', () => {
    expect(run([stall(), apiRetry(true, 3, 10)]).stalled).toBe(true)
    expect(run([stall(), apiRetry(false, 3, 10)]).stalled).toBe(true)
    expect(run([apiRetry(true, 3, 10)]).stalled).toBe(false)
  })
})

// #496: the compaction status — the api-retry scalar's clear semantics (an explicit wire falling edge,
// never self-cleared by turn activity) over the `stalled` scalar's plain-boolean shape. Banner-only: the
// wire carries no progress payload, so there is no counter to hold and nothing numeric to invent. Both
// edges collapse into one same-reference-or-fresh-state expression, so idempotency is symmetric.
describe('reduceTimeline — compaction status (#496)', () => {
  it('starts false on the initial state, and selectCompacting reads the slice', () => {
    expect(initialTimelineState.compacting).toBe(false)
    expect(selectCompacting(initialTimelineState)).toBe(false)
  })

  it('a rising edge shows the status, leaving items/phase untouched (AC1, AC5)', () => {
    const state = run([compacting(true)])
    expect(state.compacting).toBe(true)
    expect(selectCompacting(state)).toBe(true)
    // Transient chrome, never a ThreadItem row — the `phase`-beside-`items` precedent.
    expect(state.items).toEqual([])
    expect(state.phase).toBe('idle')
  })

  it('a falling edge clears the status (AC2)', () => {
    const state = run([compacting(true), compacting(false)])
    expect(state.compacting).toBe(false)
  })

  it('a verbatim repeated rising edge is a same-reference no-op — no stacking, no flicker (AC3)', () => {
    // The wire has no dedup, so the daemon may repeat an identical frame; an identical repeat must not
    // churn the selector into a re-render.
    const live = run([compacting(true)])
    expect(reduceTimeline(live, compacting(true))).toBe(live)
  })

  it('a repeated falling edge is a same-reference no-op too — idempotency is symmetric (AC3)', () => {
    const cleared = run([compacting(true), compacting(false)])
    expect(reduceTimeline(cleared, compacting(false))).toBe(cleared)
  })

  it('a falling edge against no live compaction is a same-reference no-op', () => {
    expect(reduceTimeline(initialTimelineState, compacting(false))).toBe(initialTimelineState)
  })

  // AC3 — the inverse of #317, and the trap this ticket had to resist: each of the four turn-activity
  // arms leaves a live compaction SHOWING. These are the cases a copied `stalled: false` clear-set (or a
  // widened same-reference no-op guard) would break.
  it('assistantDelta leaves a live compaction showing (AC3)', () => {
    const state = run([compacting(true), delta('A', 'hi')])
    expect(state.compacting).toBe(true)
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText'])
  })

  it('toolUse leaves a live compaction showing (AC3)', () => {
    expect(run([compacting(true), toolUse('A', 't1')]).compacting).toBe(true)
  })

  it('an orphan toolResult leaves a live compaction showing — the no-op guard must NOT widen (AC3)', () => {
    expect(run([compacting(true), toolResult('A', 'nope')]).compacting).toBe(true)
  })

  it('a toolResult that fills a pending call leaves a live compaction showing (AC3)', () => {
    expect(run([toolUse('A', 't1'), compacting(true), toolResult('A', 't1')]).compacting).toBe(true)
  })

  it('turnState leaves a live compaction showing for a non-idle state (AC3)', () => {
    const state = run([compacting(true), { type: 'turnState', state: 'thinking' }])
    expect(state.compacting).toBe(true)
    expect(state.phase).toBe('thinking')
  })

  it('an idle turnState leaves a live compaction showing — the second guard that must NOT widen (AC3)', () => {
    const state = run([compacting(true), { type: 'turnState', state: 'idle' }])
    expect(state.compacting).toBe(true)
    expect(state.phase).toBe('idle')
  })

  it('turnEnd / userText / sessionBoundary carry a live compaction through unchanged', () => {
    expect(run([compacting(true), turnEnd('A')]).compacting).toBe(true)
    expect(run([compacting(true), userText('typed')]).compacting).toBe(true)
    expect(run([compacting(true), sessionBoundary()]).compacting).toBe(true)
  })

  // The three chrome scalars are independent daemon facts — none clears another.
  it('a stall onset and an api-retry edge leave a live compaction showing, and all three coexist', () => {
    const state = run([compacting(true), stall(), apiRetry(true, 3, 10)])
    expect(state.compacting).toBe(true)
    expect(state.stalled).toBe(true)
    expect(state.apiRetry).toEqual({ current: 3, total: 10 })
  })

  it('a compaction edge leaves stalled / apiRetry / phase unchanged in both directions', () => {
    // The stall goes LAST: a turnState is turn activity and would clear it (the #317 semantics).
    const live = run([{ type: 'turnState', state: 'thinking' }, apiRetry(true, 3, 10), stall()])
    expect(live.stalled).toBe(true)
    for (const edge of [compacting(true), compacting(false)]) {
      const after = reduceTimeline(live, edge)
      expect(after.stalled).toBe(true)
      expect(after.apiRetry).toBe(live.apiRetry)
      expect(after.phase).toBe('thinking')
    }
  })

  it('leaves items untouched by reference across a full rising→falling cycle (AC5)', () => {
    const state = run([compacting(true), compacting(false)])
    expect(state.items).toBe(initialTimelineState.items)
    expect(state.items).toEqual([])
  })
})

describe('reduceTimeline — purity', () => {
  it('does not mutate the input state, its items array, or an existing item on coalesce', () => {
    const start = run([delta('A', 'Hel')])
    const startItems = start.items
    const startItem = start.items[0]

    const next = reduceTimeline(start, delta('A', 'lo'))

    // New references where a change occurred.
    expect(next.items).not.toBe(start.items)
    expect(next.items[0]).not.toBe(startItem)
    // Old references intact and unmutated.
    expect(start.items).toBe(startItems)
    expect((start.items[0] as { text: string }).text).toBe('Hel')
    expect((next.items[0] as { text: string }).text).toBe('Hello')
  })

  it('does not mutate the existing toolCall item when filling its result', () => {
    const start = run([toolUse('A', 't1')])
    const startCall = start.items[0]
    const next = reduceTimeline(start, toolResult('A', 't1'))

    expect(next.items).not.toBe(start.items)
    expect(next.items[0]).not.toBe(startCall)
    expect((start.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>).result).toBeNull()
  })
})

describe('initial state + selectors', () => {
  it('initialTimelineState is an empty, idle, un-stalled, un-compacting timeline', () => {
    expect(initialTimelineState.items).toEqual([])
    expect(initialTimelineState.phase).toBe('idle')
    expect(initialTimelineState.stalled).toBe(false)
    expect(initialTimelineState.compacting).toBe(false)
  })

  it('selectItems / selectPhase / selectStalled / selectCompacting return the current slices', () => {
    const state = run([delta('A', 'hi'), stall(), compacting(true)])
    expect(selectItems(state)).toBe(state.items)
    expect(selectPhase(state)).toBe(state.phase)
    expect(selectStalled(state)).toBe(true)
    expect(selectCompacting(state)).toBe(true)
  })
})
