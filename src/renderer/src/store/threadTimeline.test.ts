import { describe, it, expect } from 'vitest'
import {
  reduceTimeline,
  initialTimelineState,
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry,
  selectCompacting,
  selectLocalSendPending,
  markLocalSendQueued,
  type MessageAttachment,
  type ThreadEvent,
  type ThreadItem,
  type TimelineState
} from './threadTimeline'
import type { QueuedItem, WireResetPhase, WireResetHandoff } from '@shared/wire/types'

// Fixture builders — plain renderer-local events, no transport/wire involved. Mirror
// sessionStore.test.ts's `msg(...)` idiom: sensible defaults, override only what a case asserts.
function delta(turnId: string, text: string, seq = 0): ThreadEvent {
  return { type: 'assistantDelta', turnId, seq, text }
}

function toolUse(turnId: string, toolUseId: string, name = 'Read'): ThreadEvent {
  return { type: 'toolUse', turnId, toolUseId, name, inputSummary: `${name}(${toolUseId})` }
}

/**
 * #643's sibling of `toolUse(...)`, carrying the tool's own input fields. A separate builder rather
 * than a widened `toolUse(...)`: widening would either reorder against the `name = 'Read'` default or
 * push a present-but-`undefined` `input` into every existing caller's fixture. `toolUse(...)` itself
 * stays the ABSENT-map builder (a pre-pyrycode#1678 daemon).
 */
function toolUseWithInput(
  turnId: string,
  toolUseId: string,
  input: Readonly<Record<string, string>>,
  name = 'Read'
): ThreadEvent {
  return { type: 'toolUse', turnId, toolUseId, name, inputSummary: `${name}(${toolUseId})`, input }
}

function toolResult(
  turnId: string,
  toolUseId: string,
  isError = false,
  resultSummary = `ok ${toolUseId}`
): ThreadEvent {
  return { type: 'toolResult', turnId, toolUseId, isError, resultSummary }
}

/**
 * A `toolResult` carrying the #773 structured-outcome detail. The sibling above stays the
 * ABSENT-detail builder (a daemon predating pyrycode#2024).
 */
function toolResultWithDetail(
  turnId: string,
  toolUseId: string,
  resultDetail: string,
  isError = false
): ThreadEvent {
  return {
    type: 'toolResult',
    turnId,
    toolUseId,
    isError,
    resultSummary: `ok ${toolUseId}`,
    resultDetail
  }
}

function turnEnd(turnId: string, stopReason = 'end_turn'): ThreadEvent {
  return { type: 'turnEnd', turnId, stopReason }
}

function userText(text: string): ThreadEvent {
  return { type: 'userText', text }
}

/**
 * #1013's siblings of `delta(...)` / `userText(...)`, carrying the producer's stamped creation time.
 * Separate builders rather than widened ones, following `toolUseWithInput`'s reasoning exactly: widening
 * would push a present-but-`undefined` `createdAt` into every existing caller's fixture. The two builders
 * above stay the UNSTAMPED ones — the shape a spec that injects no clock produces, and the shape #1014
 * renders as the empty slot.
 */
function deltaAt(turnId: string, text: string, createdAt: number, seq = 0): ThreadEvent {
  return { type: 'assistantDelta', turnId, seq, text, createdAt }
}

function userTextAt(text: string, createdAt: number): ThreadEvent {
  return { type: 'userText', text, createdAt }
}

/**
 * #1039's sibling of the two above, carrying the attachments the composer recorded on the send. A third
 * separate builder for `userTextAt`'s reason exactly: widening either of them would push a
 * present-but-`undefined` `attachments` into every existing caller's fixture, and `userText(...)` must
 * stay the builder for the shape a message sent with nothing pending produces.
 */
function userTextWith(text: string, attachments: readonly MessageAttachment[]): ThreadEvent {
  return { type: 'userText', text, attachments }
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

function reset(): ThreadEvent {
  return { type: 'reset' }
}

function reconnected(): ThreadEvent {
  return { type: 'reconnected' }
}

function apiRetry(active: boolean, current = 0, total = 0): ThreadEvent {
  return { type: 'apiRetry', active, current, total }
}

function compacting(active: boolean): ThreadEvent {
  return { type: 'compacting', active }
}

/** #1314: one thinking-token reading. No default — a reading is the whole payload, and defaulting it
 *  would let a test that meant to name a number silently assert against a house value. */
function thinkingProgress(estimatedTokens: number): ThreadEvent {
  return { type: 'thinkingProgress', estimatedTokens }
}

/**
 * #1517: one edge of a reset. The token defaults are the daemon's OWN three rows — a rising edge is
 * `wrapping_up`/`pending` and a falling one is the pair of zero values — so a case that names neither
 * token still exercises traffic the producer actually emits, and a case that means to test the
 * sixteen-combination hazard has to say so out loud.
 */
function resetting(
  active: boolean,
  phase: WireResetPhase = active ? 'wrapping_up' : '',
  handoff: WireResetHandoff = active ? 'pending' : ''
): ThreadEvent {
  return { type: 'resetting', active, phase, handoff }
}

function unrecognized(
  site: 'line_type' | 'assistant_block' | 'user_block' | 'undecodable' = 'line_type',
  messageType = 'some_future_event',
  raw = '{"type":"some_future_event"}',
  truncated = false
): ThreadEvent {
  return { type: 'unrecognizedMessage', site, messageType, raw, truncated }
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

describe('reduceTimeline — tool-result resultDetail (#773)', () => {
  /** The resolved `toolCall` after one call and its correlated result. */
  function resolvedCall(event: ThreadEvent): Extract<ThreadItem, { kind: 'toolCall' }> {
    const state = run([toolUse('A', 't1', 'Read'), event])
    return state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
  }

  it('lands the value on the item BYTE-IDENTICAL, beside isError and resultSummary (AC1, AC4)', () => {
    const call = resolvedCall(toolResultWithDetail('A', 't1', '110 of 1676 lines'))
    expect(call.result).toEqual({
      isError: false,
      resultSummary: 'ok t1',
      resultDetail: '110 of 1676 lines'
    })
  })

  it('carries an EMPTY detail through as "", never collapsed into absent (AC3)', () => {
    expect(resolvedCall(toolResultWithDetail('A', 't1', '')).result?.resultDetail).toBe('')
  })

  it('leaves the detail absent when the event carried none — a pre-#2024 daemon (AC2)', () => {
    const call = resolvedCall(toolResult('A', 't1'))
    expect(call.result?.resultDetail).toBeUndefined()
    // The result is still filled: an absent detail is not a failed correlation.
    expect(call.result).toEqual({ isError: false, resultSummary: 'ok t1' })
  })

  it('leaves the orphan and duplicate same-reference no-ops untouched (regression — fillResult unchanged)', () => {
    const withCall = run([toolUse('A', 't1')])
    expect(reduceTimeline(withCall, toolResultWithDetail('A', 'nope', '265 lines'))).toBe(withCall)

    const resolved = run([toolUse('A', 't1'), toolResultWithDetail('A', 't1', '265 lines')])
    expect(reduceTimeline(resolved, toolResultWithDetail('A', 't1', '999 lines'))).toBe(resolved)
    const call = resolved.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.result?.resultDetail).toBe('265 lines')
  })
})

describe('reduceTimeline — the tool input map (#643)', () => {
  it('appends the map onto the toolCall unchanged, by reference, key order intact', () => {
    // Deliberately NOT alphabetical, so the key-order assertion has teeth, and deliberately
    // non-numeric — JS reorders integer-like string keys ahead of the rest regardless of insertion
    // order, which would make the assertion test the engine rather than the reducer.
    const input = { pattern: 'TODO', path: '/src', output_mode: 'content' }
    const state = run([toolUseWithInput('A', 't1', input, 'Grep')])
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.input).toEqual({ pattern: 'TODO', path: '/src', output_mode: 'content' })
    expect(Object.keys(call.input ?? {})).toEqual(['pattern', 'path', 'output_mode'])
    // By reference — never `{ ...event.input }`, which would turn an ABSENT map into an empty one.
    expect(call.input).toBe(input)
  })

  it('an ABSENT map yields an item whose map is absent, otherwise unchanged', () => {
    // A pre-pyrycode#1678 daemon. Asserted `=== undefined`, never `'input' in item` — structured
    // clone preserves an `undefined`-valued own property, so `in` would be true either way.
    const state = run([toolUse('A', 't1', 'Bash')])
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.input).toBe(undefined)
    expect(call).toEqual({
      kind: 'toolCall',
      turnId: 'A',
      toolUseId: 't1',
      name: 'Bash',
      inputSummary: 'Bash(t1)',
      result: null
    })
  })

  it('an EMPTY map yields an item carrying an empty map, never undefined', () => {
    // The post-#1678 "this daemon sent no fields for this call" case — a different fact from
    // absence, and never collapsed into it.
    const state = run([toolUseWithInput('A', 't1', {})])
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.input).not.toBe(undefined)
    expect(call.input).toEqual({})
  })

  it('survives the tool-result fill — resolving the call leaves the map untouched', () => {
    // A regression pin against a future edit to `fillResult`: its `{ ...item, result }` preserves the
    // map by construction today, so this costs no production line.
    const input = { command: 'ls -la', description: 'list the tree' }
    const state = run([toolUseWithInput('A', 't1', input, 'Bash'), toolResult('A', 't1', false, 'ok')])
    const call = state.items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(call.result).toEqual({ isError: false, resultSummary: 'ok' })
    expect(call.input).toBe(input)
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

// #1039: the attachments a sent message carries. The reducer is a CARRIER of this fact and not its
// source — the composer decides which attachments a send records and normalises "none" to absence, so
// what these pin is that the arm carries whatever arrived, verbatim and by reference, and invents
// nothing when nothing arrived.
describe('reduceTimeline — a user message’s attachments (#1039)', () => {
  const REPORT: MessageAttachment = { attachmentId: 'upload-1', filename: 'report.pdf' }
  const SHOT: MessageAttachment = { attachmentId: 'upload-2', filename: 'clipboard-2026.png' }

  it('carries the recorded attachments onto the item, in the order they were recorded (AC1)', () => {
    const state = run([userTextWith('here you go', [REPORT, SHOT])])
    expect(state.items).toEqual([
      { kind: 'userText', text: 'here you go', attachments: [REPORT, SHOT] }
    ])
  })

  // ⭐ BY REFERENCE, never `[...event.attachments]`. A spread would look identical to `toEqual` and would
  // silently mint `[]` from an absent list one arm over — the `input` (#643) discipline, which is why the
  // identity is asserted rather than the contents.
  it('carries the list by reference, never a copy', () => {
    const attachments = [REPORT]
    const state = run([userTextWith('one file', attachments)])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'userText' }>
    expect(item.attachments).toBe(attachments)
  })

  // AC2: a message sent with nothing pending produces the item today's producer already produces. The
  // `toEqual` against the bare literal is the "byte-identical" half — the reducer assigns the field
  // unconditionally, so it is present-and-undefined, which `toEqual` and the shipped userText assertions
  // both read as absent.
  it('leaves attachments undefined for a message that carries none, item unchanged otherwise (AC2)', () => {
    const state = run([userText('just text')])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'userText' }>
    // `=== undefined`, never `'attachments' in item`: the field is assigned unconditionally, so the key
    // is present with an undefined value. An EMPTY LIST is a different value and the composer never
    // produces one (it normalises at the echo), which is what keeps "absent means none" the only reading.
    expect(item.attachments).toBe(undefined)
    expect(state.items).toEqual([{ kind: 'userText', text: 'just text' }])
  })

  it('still tail-appends, leaves phase untouched and opens the local send window', () => {
    const thinking = reduceTimeline(initialTimelineState, { type: 'turnState', state: 'thinking' })
    const state = reduceTimeline(thinking, userTextWith('with a file', [REPORT]))
    expect(state.items.map((i) => i.kind)).toEqual(['userText'])
    expect(state.phase).toBe('thinking')
    expect(state.localSendPending).not.toBeNull()
  })

  // The two optional fields are independent: one carried without the other must not drop it.
  it('carries attachments and the creation stamp together', () => {
    const state = run([{ type: 'userText', text: 'both', createdAt: 1_700_000_000_000, attachments: [REPORT] }])
    expect(state.items).toEqual([
      { kind: 'userText', text: 'both', createdAt: 1_700_000_000_000, attachments: [REPORT] }
    ])
  })
})

describe('reduceTimeline — the text items’ creation time (#1013)', () => {
  const T0 = 1_700_000_000_000
  const T1 = T0 + 5_000
  const T2 = T0 + 9_000

  it('carries a stamped userText event’s time onto the item', () => {
    const state = run([userTextAt('hello', T0)])
    expect(state.items).toEqual([{ kind: 'userText', text: 'hello', createdAt: T0 }])
  })

  it('leaves createdAt undefined on a userText event that carries none (AC1: the optional shape)', () => {
    const state = run([userText('hello')])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'userText' }>
    // `=== undefined`, never `'createdAt' in item`: the reducer assigns the field unconditionally, so
    // the key is present with an undefined value. Absence and undefined are the same fact here, and
    // #1014's AC3 renders both as the empty slot.
    expect(item.createdAt).toBe(undefined)
  })

  it('stamps a fresh assistant bubble with the first delta’s time', () => {
    const state = run([deltaAt('A', 'Hel', T0)])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.createdAt).toBe(T0)
  })

  it('leaves createdAt undefined on an assistantDelta that carries none', () => {
    const state = run([delta('A', 'Hel')])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.createdAt).toBe(undefined)
  })

  // AC2. Three deltas, three DIFFERENT times: the coalesced item must keep the first. The arm rebuilds
  // the item as a fresh object literal on every delta, which is exactly where a stamp gets dropped.
  it('keeps the FIRST delta’s time when later deltas coalesce into the same bubble (AC2)', () => {
    const state = run([deltaAt('A', 'Hel', T0), deltaAt('A', 'lo ', T1), deltaAt('A', 'there', T2)])
    expect(state.items).toHaveLength(1)
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.text).toBe('Hello there')
    expect(item.createdAt).toBe(T0)
  })

  it('preserves the tail’s time only — a new turn starts a fresh bubble at its own time', () => {
    const state = run([deltaAt('A', 'first', T0), deltaAt('A', ' more', T1), deltaAt('B', 'second', T2)])
    expect(state.items).toHaveLength(2)
    const [first, second] = state.items as Extract<ThreadItem, { kind: 'assistantText' }>[]
    expect(first.createdAt).toBe(T0)
    expect(second.createdAt).toBe(T2)
  })

  it('does not fill an unstamped bubble from a later stamped delta of the same turn', () => {
    const state = run([delta('A', 'Hel'), deltaAt('A', 'lo', T1)])
    const item = state.items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.text).toBe('Hello')
    expect(item.createdAt).toBe(undefined)
  })

  // AC5's fence, from the inside: the one item kind that already holds a time keeps holding its own,
  // and gains nothing.
  it('leaves sessionBoundary’s wire-supplied occurredAt alone and gives it no createdAt', () => {
    const state = run([sessionBoundary('clear', '/w', '2026-01-15T12:00:00.000Z')])
    expect(state.items).toEqual([
      {
        kind: 'sessionBoundary',
        reason: 'clear',
        workspaceCwd: '/w',
        occurredAt: '2026-01-15T12:00:00.000Z'
      }
    ])
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

  it('retains a divider only when a full rising→falling cycle completes', () => {
    const active = run([compacting(true)])
    expect(active.items).toBe(initialTimelineState.items)
    expect(reduceTimeline(active, compacting(false)).items)
      .toEqual([{ kind: 'compactionBoundary', failed: false, manual: false }])
  })
})

// #650: the locally-opened working-indicator window — the FIRST renderer-sourced chrome scalar. The four
// scalars above it are daemon facts with a daemon edge; this one is opened by the operator's own act with
// no daemon involvement, which is exactly why its clear rules differ from all four.
describe('reduceTimeline — the locally-opened working indicator (#650)', () => {
  it('userText opens the window from the initial state (AC1)', () => {
    const state = run([userText('hello')])
    expect(state.localSendPending).not.toBeNull()
    // The orthogonality this file documents SURVIVES: the content event still never touches `phase`,
    // it touches chrome — exactly as `assistantDelta` already writes `stalled`.
    expect(state.phase).toBe('idle')
    expect(state.items).toEqual([{ kind: 'userText', text: 'hello' }])
  })

  it('the initial state holds no locally-opened window', () => {
    expect(initialTimelineState.localSendPending).toBeNull()
    expect(selectLocalSendPending(initialTimelineState)).toBeNull()
    expect(selectLocalSendPending(run([userText('typed')]))).not.toBeNull()
  })

  it('a second userText while already pending still appends — never a same-reference no-op', () => {
    // `userText` always builds a fresh `items` array, so this arm has never returned the same reference
    // and must not start: a redundant open is not a no-op case worth special-casing.
    const opened = run([userText('one')])
    const next = reduceTimeline(opened, userText('two'))
    expect(next).not.toBe(opened)
    expect(next.items).toHaveLength(2)
    expect(next.localSendPending).not.toBeNull()
  })

  it('every turnState closes it — the daemon has spoken, its phase is authoritative (AC2)', () => {
    for (const phase of ['idle', 'thinking', 'responding'] as const) {
      expect(run([userText('typed'), { type: 'turnState', state: phase }]).localSendPending).toBeNull()
    }
  })

  it('closes on turn_state{idle} even when the phase is ALREADY idle (AC2)', () => {
    // The no-churn early-out trap, and the COMMON case rather than a corner: the local window opens at
    // `idle` and the daemon's terminal turn_state is `idle` too, so without the widened guard the arm
    // returns the same state and the window never closes. This is the single test that fails without it.
    const opened = run([userText('typed')])
    expect(opened.phase).toBe('idle')

    const next = reduceTimeline(opened, { type: 'turnState', state: 'idle' })

    expect(next).not.toBe(opened)
    expect(next.localSendPending).toBeNull()
    expect(next.phase).toBe('idle')
    expect(next.items).toBe(opened.items)
  })

  it('does not latch closed — a second send re-opens the window', () => {
    const state = run([userText('one'), { type: 'turnState', state: 'idle' }, userText('two')])
    expect(state.localSendPending).not.toBeNull()
  })

  it('a reconnect closes it even when it is the ONLY live chrome (AC3)', () => {
    // The `reconnected` early-out predicate is the one thing the compiler cannot keep in sync, and this
    // is precisely the state AC3 was written for: a window opened for a turn that ended while the app
    // was offline, with nothing else live to drag the fold past the early-out.
    const opened = run([userText('typed')])
    expect(opened.phase).toBe('idle')
    expect(opened.stalled).toBe(false)
    expect(opened.apiRetry).toBeNull()
    expect(opened.compacting).toBe(false)

    const next = reduceTimeline(opened, reconnected())

    expect(next).not.toBe(opened)
    expect(next.localSendPending).toBeNull()
    // Mode A survives the Mode B clear, as for the other four scalars.
    expect(next.items).toBe(opened.items)
  })

  it('a reset closes it, for free, via the shared initial constant (AC5)', () => {
    const next = reduceTimeline(run([userText('typed')]), reset())
    expect(next).toBe(initialTimelineState)
    expect(next.localSendPending).toBeNull()
  })

  it('content events do NOT close it — the deliberate inverse of `stalled`', () => {
    // Content can arrive before any turn_state, so clearing here would blank the indicator mid-turn
    // while `phase` is still idle. Only a daemon lifecycle edge closes the window.
    expect(run([userText('typed'), delta('A', 'hi')]).localSendPending).not.toBeNull()
    expect(run([userText('typed'), toolUse('A', 't1')]).localSendPending).not.toBeNull()
    expect(
      run([userText('typed'), toolUse('A', 't1'), toolResult('A', 't1')]).localSendPending
    ).not.toBeNull()
  })

  it('turnEnd does NOT close it — the paired turn_state{idle} is what clears', () => {
    // Clearing here would regress: a send issued while the previous turn is finishing would have its
    // fresh window closed by the PREVIOUS turn's boundary.
    expect(run([userText('typed'), turnEnd('A')]).localSendPending).not.toBeNull()
  })

  it('the independent chrome facts and markers leave it alone', () => {
    expect(run([userText('typed'), stall()]).localSendPending).not.toBeNull()
    expect(run([userText('typed'), apiRetry(true, 1, 3)]).localSendPending).not.toBeNull()
    expect(run([userText('typed'), compacting(true)]).localSendPending).not.toBeNull()
    expect(run([userText('typed'), sessionBoundary()]).localSendPending).not.toBeNull()
    expect(run([userText('typed'), unrecognized()]).localSendPending).not.toBeNull()
  })

  it('the carry-through no-op arms stay same-reference with the window open', () => {
    const opened = run([userText('typed')])
    expect(reduceTimeline(opened, apiRetry(false))).toBe(opened) // falling edge, no live retry
    expect(reduceTimeline(opened, compacting(false))).toBe(opened) // verbatim-repeated edge
    expect(reduceTimeline(opened, toolResult('A', 'orphan'))).toBe(opened) // orphan result
    const stalled = reduceTimeline(opened, stall())
    expect(reduceTimeline(stalled, stall())).toBe(stalled) // redundant stall onset
    expect(stalled.localSendPending).not.toBeNull()
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

describe('reduceTimeline — reset', () => {
  /** A state dirty on all six fields. The stall goes LAST: a turnState is turn activity and
   *  would clear it (the #317 semantics). #650: and the userText goes AFTER the turnState, for the
   *  mirror-image reason — a turnState clears `localSendPending`, so the original leading position
   *  left this helper clean on the new field and the clear below would have proved nothing about it.
   *  #1314: the reading goes before the stall for the same family of reasons — after the turnState,
   *  which clears it on any state but `thinking`, and ahead of the stall, which keeps its last place. */
  function dirty(): TimelineState {
    return run([
      delta('A', 'hi'),
      { type: 'turnState', state: 'thinking' },
      userText('typed'),
      apiRetry(true, 3, 10),
      compacting(true),
      thinkingProgress(770),
      stall()
    ])
  }

  it('clears all seven fields from a fully dirty state (AC2)', () => {
    const state = dirty()
    // Precondition: genuinely dirty on every field — otherwise reset proves nothing.
    expect(state.items.length).toBeGreaterThan(0)
    expect(state.phase).not.toBe(initialTimelineState.phase)
    expect(state.stalled).toBe(true)
    expect(state.apiRetry).not.toBeNull()
    expect(state.compacting).toBe(true)
    expect(state.localSendPending).not.toBeNull()
    expect(state.thinkingTokens).not.toBeNull()

    const next = reduceTimeline(state, reset())

    expect(next.items).toEqual(initialTimelineState.items)
    expect(next.phase).toBe(initialTimelineState.phase)
    expect(next.stalled).toBe(initialTimelineState.stalled)
    expect(next.apiRetry).toBe(initialTimelineState.apiRetry)
    expect(next.compacting).toBe(initialTimelineState.compacting)
    expect(next.localSendPending).toBe(initialTimelineState.localSendPending)
    expect(next.thinkingTokens).toBe(initialTimelineState.thinkingTokens)
  })

  it('returns the shared initial constant, not a fresh literal', () => {
    // The property scenarios below rest on: idempotence and the no-churn `items` reference both
    // fall out of returning the constant, and a sixth TimelineState field is cleared for free.
    expect(reduceTimeline(dirty(), reset())).toBe(initialTimelineState)
  })

  it('is idempotent — a second reset changes nothing (AC3)', () => {
    const once = reduceTimeline(dirty(), reset())
    expect(reduceTimeline(once, reset())).toBe(once)
    // …and against an already-initial state it leaves that state at initialTimelineState.
    expect(reduceTimeline(initialTimelineState, reset())).toBe(initialTimelineState)
  })

  it('leaves items un-churned by reference, so no selectItems subscriber re-renders', () => {
    expect(reduceTimeline(dirty(), reset()).items).toBe(initialTimelineState.items)
  })

  it('does not corrupt the shared constant when a later event appends', () => {
    const state = run([userText('a'), reset(), userText('b')])
    expect(state.items).toEqual([{ kind: 'userText', text: 'b' }])
    expect(initialTimelineState.items).toEqual([])
  })
})

describe('reduceTimeline — reconnected', () => {
  /** A state dirty on all six fields — the `reset` block's helper, including its #650 ordering:
   *  the stall goes LAST (a turnState is turn activity and would clear it, the #317 semantics) and
   *  the userText goes AFTER the turnState (a turnState clears `localSendPending`), and #1314's
   *  reading goes after the turnState too (which clears it on any state but `thinking`). */
  function dirty(): TimelineState {
    return run([
      delta('A', 'hi'),
      { type: 'turnState', state: 'thinking' },
      userText('typed'),
      apiRetry(true, 3, 10),
      compacting(true),
      thinkingProgress(770),
      stall()
    ])
  }

  it('clears all six chrome scalars in one step (AC1)', () => {
    const state = dirty()
    // Precondition: genuinely dirty on every scalar — otherwise the clear proves nothing.
    expect(state.phase).toBe('thinking')
    expect(state.stalled).toBe(true)
    expect(state.apiRetry).not.toBeNull()
    expect(state.compacting).toBe(true)
    expect(state.localSendPending).not.toBeNull()
    expect(state.thinkingTokens).not.toBeNull()

    const next = reduceTimeline(state, reconnected())

    expect(next.phase).toBe('idle')
    expect(next.stalled).toBe(false)
    expect(next.apiRetry).toBeNull()
    expect(next.compacting).toBe(false)
    expect(next.localSendPending).toBeNull()
    expect(next.thinkingTokens).toBeNull()
  })

  it('leaves items untouched BY REFERENCE, so no selectItems subscriber re-renders (AC2)', () => {
    const state = dirty()
    expect(state.items.length).toBeGreaterThan(0)

    const next = reduceTimeline(state, reconnected())

    // `toBe` is the load-bearing assertion — `toEqual` alone would pass on a fresh copy and let a
    // re-render regression through.
    expect(next.items).toBe(state.items)
    expect(next.items).toEqual(state.items)
  })

  it('returns the same state reference against already-clean chrome (AC3)', () => {
    expect(reduceTimeline(initialTimelineState, reconnected())).toBe(initialTimelineState)
    // The case that pins the early-out predicate rather than the trivial initial-state one: dirty on
    // `items` (a real transcript), clean on all six chrome scalars — a first connect mid-transcript.
    // #650: the trailing `turn_state{idle}` is what makes the transcript chrome-clean now — the echo
    // opens the local window and the daemon's terminal idle is what closes it, so a completed turn is
    // the honest shape of "a real transcript with nothing live".
    const contentOnly = run([
      userText('typed'),
      delta('A', 'hi'),
      turnEnd('A'),
      { type: 'turnState', state: 'idle' }
    ])
    expect(contentOnly.items.length).toBeGreaterThan(0)
    expect(reduceTimeline(contentOnly, reconnected())).toBe(contentOnly)
  })

  it('is idempotent — a second reconnected returns the same reference', () => {
    const once = reduceTimeline(dirty(), reconnected())
    expect(reduceTimeline(once, reconnected())).toBe(once)
  })

  it('does not latch — a rising apiRetry edge after it sets the status again (AC5)', () => {
    const state = run([apiRetry(true, 1, 3), reconnected(), apiRetry(true, 2, 3)])
    expect(state.apiRetry).toEqual({ current: 2, total: 3 })
  })

  it('does not latch — a rising compacting edge after it sets the status again (AC5)', () => {
    // The one that matters: the `compacting` arm early-outs on `state.compacting === event.active`,
    // so had the clear never landed, the re-assert would be swallowed as a same-reference no-op and
    // the banner would be wrong in the OTHER direction.
    const state = run([compacting(true), reconnected(), compacting(true)])
    expect(state.compacting).toBe(true)
  })

  it('does not blank a live transcript mid-turn (Mode A survives the Mode B clear)', () => {
    const state = run([
      delta('t1', 'hello'),
      apiRetry(true, 1, 3),
      reconnected(),
      delta('t1', ' world')
    ])
    expect(state.items).toEqual([{ kind: 'assistantText', turnId: 't1', text: 'hello world' }])
    expect(state.apiRetry).toBeNull()
  })

  it('is distinct from reset — reset empties items, reconnected keeps them', () => {
    // The ticket's central claim: `reset` is NOT reusable here, because it would blank the transcript
    // on every reconnect. The invariant a future refactor is most likely to break.
    const state = dirty()
    expect(reduceTimeline(state, reconnected()).items).toBe(state.items)
    expect(reduceTimeline(state, reset()).items).toEqual([])
    expect(reduceTimeline(state, reconnected())).not.toBe(initialTimelineState)
  })
})

describe('reduceTimeline — the thinking-token estimate (#1314)', () => {
  it('holds the reading the frame carried, beside the other four chrome scalars', () => {
    expect(run([thinkingProgress(840)]).thinkingTokens).toBe(840)
  })

  it('holds the LATEST reading, never a maximum — the wire is not monotonic', () => {
    // The payload restarts near zero at every inference-request boundary, four times inside the
    // daemon's own committed single-turn capture, so a DROP is ordinary traffic. A `Math.max` or any
    // monotonic filter would eat it, and this is the assertion that reddens if one is ever added.
    expect(run([thinkingProgress(184), thinkingProgress(167), thinkingProgress(4)]).thinkingTokens).toBe(4)
  })

  it('holds 0 as a reading, distinct from the absence null means', () => {
    // Neither Go field carries `omitempty`, so the daemon's zero is legal traffic and nothing may
    // consult truthiness on it. `toBe(0)` over a falsy check is the whole point of the test.
    expect(initialTimelineState.thinkingTokens).toBeNull()
    expect(run([thinkingProgress(0)]).thinkingTokens).toBe(0)
  })

  it('returns the SAME reference on a verbatim repeat — the wire has no dedup', () => {
    const held = run([thinkingProgress(320)])
    expect(reduceTimeline(held, thinkingProgress(320))).toBe(held)
  })

  it('touches neither items nor phase — chrome, never a row', () => {
    const state = run([{ type: 'turnState', state: 'thinking' }, delta('A', 'hi'), thinkingProgress(500)])
    expect(state.items).toEqual([{ kind: 'assistantText', turnId: 'A', text: 'hi' }])
    expect(state.phase).toBe('thinking')
  })

  it('survives a turnState that IS thinking — the daemon re-asserting the phase is not a clear', () => {
    const state = run([thinkingProgress(640), { type: 'turnState', state: 'thinking' }])
    expect(state.thinkingTokens).toBe(640)
  })

  it.each(['responding', 'idle'] as const)('clears on turnState{%s} (AC1)', (phase) => {
    expect(run([thinkingProgress(640), { type: 'turnState', state: phase }]).thinkingTokens).toBeNull()
  })

  it('does NOT early-out a turnState that only changes the estimate', () => {
    // The widened guard's regression test. `turn_state{idle}` against an already-idle phase with no
    // stall and no local send is the arm's early-out case; a held estimate must defeat it, or the
    // clear never lands and a stale reading outlives its turn.
    const held = reduceTimeline(run([thinkingProgress(900)]), { type: 'turnState', state: 'idle' })
    expect(held.phase).toBe('idle')
    expect(held.thinkingTokens).toBeNull()
  })

  it('clears on turnEnd (AC1), which leaves phase alone as it always has', () => {
    const state = run([{ type: 'turnState', state: 'thinking' }, thinkingProgress(1200), turnEnd('A')])
    expect(state.thinkingTokens).toBeNull()
    // The e2e's premise: turnEnd does not reset `phase`, so the row is still mounted showing the
    // thinking label — which is what makes AC4's closing read a POSITIVE one on a live row.
    expect(state.phase).toBe('thinking')
  })

  it('clears on reconnected (AC1) — Mode B chrome, not Mode A transcript', () => {
    expect(run([thinkingProgress(700), reconnected()]).thinkingTokens).toBeNull()
  })

  it('does NOT early-out a reconnect whose only live chrome is the estimate', () => {
    // `nothingLive` is the one predicate the compiler cannot keep in sync with a new field. Without
    // its widened clause this returns the same reference and a reading from before the disconnect is
    // still on screen after a fresh handshake.
    const held = run([thinkingProgress(450)])
    const next = reduceTimeline(held, reconnected())
    expect(next).not.toBe(held)
    expect(next.thinkingTokens).toBeNull()
  })

  it('clears on reset, for free via the shared initial constant', () => {
    expect(run([thinkingProgress(300), reset()]).thinkingTokens).toBeNull()
  })

  it('is carried unchanged by every arm that is not one of the three clearing edges', () => {
    // AC1 enumerates exactly three clears. Turn CONTENT is deliberately not among them: clearing on a
    // delta or a tool step would blank a live reading the instant claude interleaves a tool call with
    // its thinking, which is precisely the long silence this feature exists to explain.
    const carried: readonly ThreadEvent[] = [
      delta('A', 'hi'),
      toolUse('A', 't1'),
      { type: 'toolResult', turnId: 'A', toolUseId: 't1', isError: false, resultSummary: 'ok' },
      userText('typed'),
      sessionBoundary(),
      unrecognized(),
      stall(),
      apiRetry(true, 1, 3),
      compacting(true)
    ]
    for (const event of carried) {
      expect(reduceTimeline(run([thinkingProgress(555)]), event).thinkingTokens).toBe(555)
    }
  })

  it('does not latch — a reading after a clear sets the scalar again', () => {
    // The `compacting` regression shape: had the clear never landed, the same-reference no-op on a
    // verbatim repeat would swallow the re-assert and the label would be wrong in the OTHER direction.
    const state = run([thinkingProgress(120), reconnected(), thinkingProgress(120)])
    expect(state.thinkingTokens).toBe(120)
  })
})

describe('reduceTimeline — the unrecognized-message row', () => {
  it('appends a row carrying all four fields', () => {
    const state = run([unrecognized()])
    expect(state.items).toEqual([
      {
        kind: 'unrecognizedMessage',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      }
    ])
  })

  it('carries an empty messageType and a truncated payload through verbatim', () => {
    const state = run([unrecognized('undecodable', '', '{"type":"assist', true)])
    expect(state.items).toEqual([
      {
        kind: 'unrecognizedMessage',
        site: 'undecodable',
        messageType: '',
        raw: '{"type":"assist',
        truncated: true
      }
    ])
  })

  it('does NOT coalesce identical repeats — each one is its own row', () => {
    // The design decision worth defending: everything else repeat-prone in this reducer collapses,
    // this must not. How often it fires is the number that tells an operator to go fix something, and
    // collapsing repeats would hide exactly that.
    const state = run([unrecognized(), unrecognized(), unrecognized()])
    expect(state.items).toHaveLength(3)
  })

  it('does not coalesce into an adjacent assistant delta, or absorb one after it', () => {
    const state = run([delta('t1', 'before'), unrecognized(), delta('t1', 'after')])
    expect(state.items.map((i) => i.kind)).toEqual([
      'assistantText',
      'unrecognizedMessage',
      'assistantText'
    ])
    // The delta after the row opens a FRESH run rather than appending to the one before it.
    expect(state.items[0]).toMatchObject({ text: 'before' })
    expect(state.items[2]).toMatchObject({ text: 'after' })
  })

  it('opens and closes no turn — phase is untouched', () => {
    const idle = run([unrecognized()])
    expect(idle.phase).toBe('idle')
    const thinking = run([{ type: 'turnState', state: 'thinking' }, unrecognized()])
    expect(thinking.phase).toBe('thinking')
  })

  it('is not turn activity — it clears neither stall, api-retry, nor compaction', () => {
    const state = run([stall(), apiRetry(true, 2, 5), compacting(true), unrecognized()])
    expect(state.stalled).toBe(true)
    expect(state.apiRetry).toEqual({ current: 2, total: 5 })
    expect(state.compacting).toBe(true)
  })

  it('appends in arrival order among other items', () => {
    const state = run([userText('hi'), unrecognized(), delta('t1', 'reply'), turnEnd('t1')])
    expect(state.items.map((i) => i.kind)).toEqual([
      'userText',
      'unrecognizedMessage',
      'assistantText',
      'turnBoundary'
    ])
  })

  it('carries no turnId — the daemon could not attribute one', () => {
    const [item] = run([unrecognized()]).items
    expect(item).not.toHaveProperty('turnId')
  })
})

/**
 * #1213's builders. `userTextWithId` is a FOURTH separate builder rather than a widening of the three
 * above, for the reason `userTextAt` / `userTextWith` already record: widening would push a
 * present-but-`undefined` `messageId` into every existing caller's fixture, and `userText(...)` must stay
 * the builder for the id-less shape a spec that mints nothing produces — which is also the shape a future
 * history backfill would produce, and which no drop may ever remove.
 */
function userTextWithId(text: string, messageId: string): ThreadEvent {
  return { type: 'userText', text, messageId }
}

function dropUserText(messageId: string): ThreadEvent {
  return { type: 'dropUserText', messageId }
}

describe('reduceTimeline — userText messageId (#1213)', () => {
  it('carries the composer-minted id onto the item verbatim', () => {
    const [item] = run([userTextWithId('hello', 'msg-Abc-1')]).items
    expect(item).toEqual({
      kind: 'userText',
      text: 'hello',
      createdAt: undefined,
      messageId: 'msg-Abc-1',
      attachments: undefined
    })
  })

  it('leaves the id undefined when the producer minted none — absence is a legal item', () => {
    const [item] = run([userText('hello')]).items
    expect(item).toHaveProperty('messageId', undefined)
  })
})

describe('reduceTimeline — dropUserText (#1213)', () => {
  it('removes the echo whose messageId matches, and only that echo (AC2)', () => {
    const state = run([
      userTextWithId('first', 'm1'),
      userTextWithId('second', 'm2'),
      dropUserText('m1')
    ])
    expect(state.items).toEqual([
      { kind: 'userText', text: 'second', createdAt: undefined, messageId: 'm2', attachments: undefined }
    ])
  })

  it('separates two IDENTICAL texts by id — the second stays, correctly attributed (AC3)', () => {
    const state = run([
      userTextWithId('same words', 'm1'),
      userTextWithId('same words', 'm2'),
      dropUserText('m1')
    ])
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'userText', text: 'same words', messageId: 'm2' })
  })

  it('moves no other row: the surrounding items keep their order and identity (AC3)', () => {
    const state = run([
      delta('t1', 'before'),
      userTextWithId('drop me', 'm1'),
      delta('t2', 'after'),
      turnEnd('t2'),
      dropUserText('m1')
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText', 'assistantText', 'turnBoundary'])
    expect(state.items.map((i) => ('text' in i ? i.text : i.kind))).toEqual([
      'before',
      'after',
      'turnBoundary'
    ])
  })

  it('returns the SAME state reference when no echo matches — no selector churn', () => {
    const before = run([userTextWithId('kept', 'm1'), delta('t1', 'reply')])
    const after = reduceTimeline(before, dropUserText('m-nothing'))
    expect(after).toBe(before)
  })

  it('never removes an id-less echo, including against an empty-string drop (AC1)', () => {
    const before = run([userText('no id at all')])
    expect(reduceTimeline(before, dropUserText(''))).toBe(before)
    expect(reduceTimeline(before, dropUserText('m1'))).toBe(before)
  })

  it('removes only the FIRST match, never a second row', () => {
    // Ids are unique in production; first-match-only is the fillToolResult discipline, pinned so a
    // future filter-everything rewrite reddens rather than ships.
    const seeded: TimelineState = {
      ...initialTimelineState,
      items: [
        { kind: 'userText', text: 'a', messageId: 'dup' },
        { kind: 'userText', text: 'b', messageId: 'dup' }
      ],
      localEchoes: [{ rowKey: 0, messageId: 'dup', waiting: false }]
    }
    const after = reduceTimeline(seeded, dropUserText('dup'))
    expect(after.items).toEqual([{ kind: 'userText', text: 'b', messageId: 'dup' }])
  })

  it('is not a candidate filter over other kinds — only userText rows can go', () => {
    const state = run([
      toolUse('t1', 'tool-1'),
      delta('t1', 'text'),
      sessionBoundary(),
      dropUserText('tool-1')
    ])
    expect(state.items.map((i) => i.kind)).toEqual(['toolCall', 'assistantText', 'sessionBoundary'])
  })

  it('carries every chrome scalar and the phase unchanged — a drop is not turn activity', () => {
    const before = run([
      userTextWithId('drop me', 'm1'),
      { type: 'turnState', state: 'thinking' },
      stall(),
      apiRetry(true, 2, 5),
      compacting(true)
    ])
    const after = reduceTimeline(before, dropUserText('m1'))
    expect(after.phase).toBe(before.phase)
    expect(after.stalled).toBe(before.stalled)
    expect(after.apiRetry).toEqual(before.apiRetry)
    expect(after.compacting).toBe(before.compacting)
  })

  it('neither opens nor closes the working indicator local window (#650)', () => {
    // The userText arm OPENS it; this arm is not a second userText producer, so it must leave the scalar
    // exactly as it found it — clearing it would hide the indicator for a DIFFERENT pending message.
    const pending = run([userTextWithId('pending', 'm1'), userTextWithId('other', 'm2')])
    expect(pending.localSendPending).not.toBeNull()
    expect(reduceTimeline(pending, dropUserText('m1')).localSendPending).not.toBeNull()

    const idle = run([{ type: 'turnState', state: 'idle' }])
    expect(idle.localSendPending).toBeNull()
    expect(reduceTimeline(idle, dropUserText('m1')).localSendPending).toBeNull()
  })

  it('is idempotent — a second drop for the same id finds nothing and returns the same reference', () => {
    const once = run([userTextWithId('drop me', 'm1'), dropUserText('m1')])
    expect(once.items).toEqual([])
    expect(reduceTimeline(once, dropUserText('m1'))).toBe(once)
  })
})

describe('reduceTimeline — resetting (#1517)', () => {
  it('holds both tokens from the rising edge', () => {
    const state = run([resetting(true)])
    expect(state.resetting).toEqual({ phase: 'wrapping_up', handoff: 'pending' })
  })

  it('returns the SAME reference when the daemon repeats an identical edge', () => {
    // No wire-side dedup: the transport emits one event per decoded frame, verbatim repeats included.
    // An unchanged record must not churn subscribers — the apiRetry arm's own rule.
    const once = run([resetting(true)])
    expect(reduceTimeline(once, resetting(true))).toBe(once)
  })

  it('swaps the record when the rising edge re-fires with a new phase (AC2)', () => {
    // `wrapping_up` → `restarting` is a real transition, not a duplicate to suppress. The row must
    // RELABEL rather than read as a second reset, so the reference changes and the record is fresh.
    const wrapping = run([resetting(true)])
    const restarting = reduceTimeline(wrapping, resetting(true, 'restarting', 'written'))
    expect(restarting).not.toBe(wrapping)
    expect(restarting.resetting).toEqual({ phase: 'restarting', handoff: 'written' })
  })

  it('swaps the record when only the handoff token moves', () => {
    const pending = run([resetting(true, 'restarting', 'pending')])
    expect(reduceTimeline(pending, resetting(true, 'restarting', 'skipped')).resetting).toEqual({
      phase: 'restarting',
      handoff: 'skipped'
    })
  })

  it('clears on the falling edge, ignoring whatever tokens it repeats', () => {
    const after = run([resetting(true, 'restarting', 'written'), resetting(false, 'restarting', 'written')])
    expect(after.resetting).toBeNull()
  })

  it('is a same-reference no-op when a falling edge arrives against no live reset', () => {
    expect(reduceTimeline(initialTimelineState, resetting(false))).toBe(initialTimelineState)
  })

  it('holds an empty phase token rather than rejecting it', () => {
    // `active: true` with `phase: ''` decodes — the decoder deliberately does not cross-validate the
    // pair — so the reducer holds it and the LABEL decides what an unnamed phase reads as.
    expect(run([resetting(true, '', '')]).resetting).toEqual({ phase: '', handoff: '' })
  })

  it('survives the whole wrap-up turn: turn activity does NOT clear it (AC3)', () => {
    // The clear semantics are apiRetry's and compacting's, never `stalled`'s. The wrap-up turn is a
    // REAL turn whose rows stream into the message list exactly as any turn's do, so clearing on turn
    // activity would blank the label on the first delta of the very turn it describes.
    const state = run([
      resetting(true),
      { type: 'turnState', state: 'thinking' },
      delta('A', 'writing the note'),
      toolUse('A', 't1'),
      toolResult('A', 't1'),
      turnEnd('A')
    ])
    expect(state.resetting).toEqual({ phase: 'wrapping_up', handoff: 'pending' })
    // …and the turn's own rows are all there: the label showing does not suppress the thread.
    expect(state.items.map((i) => i.kind)).toEqual(['assistantText', 'toolCall', 'turnBoundary'])
  })

  it('clears on a session boundary — the belt (AC1)', () => {
    // The independent trigger the wire contract demands: a daemon killed mid-reset sends no falling
    // edge, and a reset ends in a session rotation. The two ride SEPARATE producers, so their relative
    // arrival order is deliberately not pinned — each order is asserted on its own below.
    expect(run([resetting(true), sessionBoundary()]).resetting).toBeNull()
  })

  it('ends empty whichever of the falling edge and the boundary arrives first', () => {
    expect(run([resetting(true), resetting(false), sessionBoundary()]).resetting).toBeNull()
    expect(run([resetting(true), sessionBoundary(), resetting(false)]).resetting).toBeNull()
  })

  it('leaves the session-boundary row itself untouched', () => {
    const state = run([resetting(true), sessionBoundary()])
    expect(state.items.map((i) => i.kind)).toEqual(['sessionBoundary'])
  })

  it('clears on a reconnect, and a held reset alone defeats the early-out', () => {
    // Mode B, beside apiRetry / compacting / thinkingTokens: the daemon re-asserts no `resetting` on
    // connect, so a record held across the handshake would report a reset that has since finished.
    const held = run([resetting(true)])
    const after = reduceTimeline(held, reconnected())
    expect(after).not.toBe(held)
    expect(after.resetting).toBeNull()
  })

  it('clears on a timeline reset', () => {
    expect(run([resetting(true), reset()]).resetting).toBeNull()
  })

  it('leaves the other five chrome scalars exactly as it found them', () => {
    const before = run([
      { type: 'turnState', state: 'thinking' },
      stall(),
      apiRetry(true, 3, 10),
      compacting(true),
      thinkingProgress(120)
    ])
    const after = reduceTimeline(before, resetting(true))
    expect(after.phase).toBe(before.phase)
    expect(after.stalled).toBe(before.stalled)
    expect(after.apiRetry).toEqual(before.apiRetry)
    expect(after.compacting).toBe(before.compacting)
    expect(after.localSendPending).toBe(before.localSendPending)
    expect(after.thinkingTokens).toBe(before.thinkingTokens)
    expect(after.items).toBe(before.items)
  })

  it('starts null', () => {
    expect(initialTimelineState.resetting).toBeNull()
  })
})

describe('reduceTimeline — an offered attachment (#1621)', () => {
  function offer(attachmentId: string, filename = 'report.pdf'): ThreadEvent {
    return { type: 'attachmentOffered', attachment: { attachmentId, filename } }
  }

  it('appends one attachmentOffer item carrying both fields, after the existing items', () => {
    const state = reduceTimeline(reduceTimeline(initialTimelineState, delta('A', 'Here it is')), offer('id-1'))
    expect(selectItems(state).map((item) => item.kind)).toEqual(['assistantText', 'attachmentOffer'])
    expect(selectItems(state)[1]).toEqual({
      kind: 'attachmentOffer',
      attachment: { attachmentId: 'id-1', filename: 'report.pdf' }
    })
  })

  it('a second offer with the same attachment id adds nothing (same state reference)', () => {
    const once = reduceTimeline(initialTimelineState, offer('id-1'))
    const twice = reduceTimeline(once, offer('id-1', 'renamed.pdf'))
    expect(twice).toBe(once)
  })

  it('an offer with a different attachment id appends a second item', () => {
    const state = reduceTimeline(reduceTimeline(initialTimelineState, offer('id-1')), offer('id-2', 'b.txt'))
    expect(selectItems(state)).toHaveLength(2)
  })

  it('dedupes against offer items only, not a sent message carrying the same attachment id', () => {
    const sent: ThreadEvent = {
      type: 'userText',
      text: 'see file',
      attachments: [{ attachmentId: 'id-1', filename: 'report.pdf' }]
    }
    const state = reduceTimeline(reduceTimeline(initialTimelineState, sent), offer('id-1'))
    expect(selectItems(state).map((item) => item.kind)).toEqual(['userText', 'attachmentOffer'])
  })

  it('is not turn activity: phase, stall, local send window and retry status are carried unchanged', () => {
    const before: TimelineState = {
      ...initialTimelineState,
      phase: 'responding',
      stalled: true,
      localSendPending: { messageId: 'm1', queued: false },
      apiRetry: { current: 1, total: 3 }
    }
    const after = reduceTimeline(before, offer('id-1'))
    expect(selectPhase(after)).toBe('responding')
    expect(selectStalled(after)).toBe(true)
    expect(selectLocalSendPending(after)).toBe(before.localSendPending)
    expect(selectApiRetry(after)).toBe(before.apiRetry)
  })

  it('builds a fresh attachment record rather than sharing the event object', () => {
    const event = offer('id-1')
    const state = reduceTimeline(initialTimelineState, event)
    const item = selectItems(state)[0] as Extract<ThreadItem, { kind: 'attachmentOffer' }>
    expect(event.type === 'attachmentOffered' && item.attachment === event.attachment).toBe(false)
  })
})

// #1725: the window's two stages. It opens naming the sent id, and a queue_state listing that id moves it
// to queued — stickily, since claude can commit the item before turn_state{thinking} arrives.
describe('the local send window stages — Sending, then Waiting for Claude (#1725)', () => {
  const item = (message_id?: string): QueuedItem => ({ queued_msg_id: 1, text: 'typed', ts: 'ts', message_id })

  it('opens naming the sent message_id, not yet queued', () => {
    expect(run([userTextWithId('typed', 'm1')]).localSendPending).toEqual({ messageId: 'm1', queued: false })
  })

  it('follows the newest send when a second message goes out before the turn starts', () => {
    const queued = markLocalSendQueued(run([userTextWithId('one', 'm1')]), [item('m1')])
    expect(reduceTimeline(queued, userTextWithId('two', 'm2')).localSendPending)
      .toEqual({ messageId: 'm2', queued: false })
  })

  it('a received receipt leaves the window naming the local send', () => {
    const opened = run([userTextWithId('typed', 'm1')])
    const next = reduceTimeline(opened, { type: 'userText', text: 'other device', messageId: 'm9', received: true })
    expect(next.localSendPending).toEqual({ messageId: 'm1', queued: false })
  })

  it('a queue_state listing the sent id marks it queued', () => {
    const opened = run([userTextWithId('typed', 'm1')])
    expect(markLocalSendQueued(opened, [item('other'), item('m1')]).localSendPending)
      .toEqual({ messageId: 'm1', queued: true })
  })

  it('sticks across a later snapshot that no longer lists the item', () => {
    const queued = markLocalSendQueued(run([userTextWithId('typed', 'm1')]), [item('m1')])
    expect(markLocalSendQueued(queued, []).localSendPending).toBe(queued.localSendPending)
    expect(markLocalSendQueued(queued, [item('other')]).localSendPending).toEqual({ messageId: 'm1', queued: true })
  })

  it('another device item, an empty id or an absent id does not advance it', () => {
    const opened = run([userTextWithId('typed', 'm1')])
    for (const queued of [[item('m2')], [item('')], [item()], []]) {
      expect(markLocalSendQueued(opened, queued)).toBe(opened)
    }
  })

  it('a send with no minted id can never match, even an item with an empty id', () => {
    const opened = run([userText('typed')])
    expect(opened.localSendPending).toEqual({ messageId: '', queued: false })
    expect(markLocalSendQueued(opened, [item(''), item()])).toBe(opened)
  })

  it('does nothing with the window closed', () => {
    const closed = run([userTextWithId('typed', 'm1'), { type: 'turnState', state: 'idle' }])
    expect(markLocalSendQueued(closed, [item('m1')]).localSendPending).toBeNull()
    expect(markLocalSendQueued(initialTimelineState, [item('m1')])).toBe(initialTimelineState)
  })

  it('the first turn_state still closes a queued window', () => {
    const queued = markLocalSendQueued(run([userTextWithId('typed', 'm1')]), [item('m1')])
    const next = reduceTimeline(queued, { type: 'turnState', state: 'thinking' })
    expect(next.localSendPending).toBeNull()
    expect(next.phase).toBe('thinking')
  })
})

describe('session error transient notice', () => {
  const error = (code = 'session.blocked'): ThreadEvent => ({ type: 'sessionError', code })
  const pending = reduceTimeline(initialTimelineState, { type: 'userText', text: 'kept', messageId: 'm1' })
  it.each(['idle', 'thinking', 'responding'] as const)('closes stale chrome in %s without deleting rows', phase => {
    const next = reduceTimeline({ ...pending, phase, stalled: true, compacting: true,
      thinkingTokens: 9, apiRetry: { current: 1, total: 2 } }, error())
    expect(next).toMatchObject({ sessionError: { code: 'session.blocked' }, phase: 'idle',
      localSendPending: null, stalled: false, compacting: false, thinkingTokens: null, apiRetry: null })
    expect(next.items).toBe(pending.items)
  })
  it('replaces the notice', () => {
    expect(reduceTimeline(reduceTimeline(pending, error()), error('future')).sessionError).toEqual({ code: 'future' })
  })
  it.each<ThreadEvent>([
    { type: 'turnState', state: 'idle' }, { type: 'userText', text: 'echo', received: true, messageId: 'm2' },
    { type: 'assistantDelta', turnId: 't1', seq: 1, text: 'content' }, { type: 'reconnected' },
    { type: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '/workspace', occurredAt: 'now' },
    { type: 'sessionBoundary', reason: 'idle_evict', workspaceCwd: null, occurredAt: 'now' }
  ])('preserves on $type', event => {
    const held = reduceTimeline(pending, error())
    expect(reduceTimeline(held, event).sessionError).toBe(held.sessionError)
  })
  it.each<ThreadEvent>([
    { type: 'userText', text: 'next', messageId: 'm2' }, { type: 'turnState', state: 'thinking' },
    { type: 'turnState', state: 'responding' }, { type: 'reset' }, { type: 'sessionErrorCleared' },
    { type: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: 'now' }
  ])('clears on $type', event => {
    expect(reduceTimeline(reduceTimeline(pending, error()), event).sessionError).toBeUndefined()
  })
})
