import { describe, expect, it } from 'vitest'
import { initialTimelineState, reduceTimeline, type ThreadEvent } from './threadTimeline'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { timelineTargetFor, translateTimelineEvent } from './timelineBridge'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'

const start: ThreadEvent = { type: 'compacting', active: true }
const end: ThreadEvent = { type: 'compacting', active: false }
const boundary: ThreadEvent = { type: 'compactionBoundary', trigger: 'manual', preTokens: 180000, postTokens: 40000 }
const run = (...events: ThreadEvent[]) => events.reduce(reduceTimeline, initialTimelineState)

describe('retained compaction boundaries', () => {
  it('records only real falling edges and keeps successive completions', () => {
    expect(reduceTimeline(initialTimelineState, end)).toBe(initialTimelineState)
    const active = run(start)
    expect(reduceTimeline(active, start)).toBe(active)
    const completed = reduceTimeline(active, end)
    expect(completed.items).toEqual([{ kind: 'compactionBoundary', failed: false, manual: false }])
    expect(completed.pendingCompaction).toBe(completed.items[0])
    expect(reduceTimeline(completed, end)).toBe(completed)
    expect(run(start, end, start, end).items).toHaveLength(2)
  })

  it('enriches in place after an intervening row and consumes the association', () => {
    const state = run(start, end, { type: 'userText', text: 'after' })
    const result = reduceTimeline(state, boundary)
    expect(result.items).toEqual([
      { kind: 'compactionBoundary', failed: false, manual: true, preTokens: 180000, postTokens: 40000 },
      state.items[1]
    ])
    expect(result.items[1]).toBe(state.items[1])
    expect(state.items[0]).toEqual({ kind: 'compactionBoundary', failed: false, manual: false })
    expect(result.pendingCompaction).toBeUndefined()
    expect(reduceTimeline(result, boundary).items).toHaveLength(3)
  })

  it('a new compaction supersedes an earlier pending completion', () => {
    const state = run(start, end, start, boundary)
    expect(state.items).toHaveLength(2)
    expect(state.items[0]).toMatchObject({ manual: false })
    expect(state.items[1]).toMatchObject({ manual: true })
    const twoCompleted = run(start, end, start, end, boundary)
    expect(twoCompleted.items).toHaveLength(2)
    expect(twoCompleted.items[0]).toMatchObject({ manual: false })
    expect(twoCompleted.items[1]).toMatchObject({ manual: true })
  })

  it.each([
    { compactResult: 'failed' }, { compactError: 'private-error' },
    { compactResult: 'success', compactError: ' ' }, { compactResult: 'future', compactError: 'error' }
  ])('keeps failure %j immune to success metadata', report => {
    const failed = run(start, { ...end, ...report })
    expect(failed.items).toEqual([{ kind: 'compactionBoundary', failed: true, manual: false }])
    expect(failed.pendingCompaction).toBeUndefined()
    expect(reduceTimeline(failed, boundary).items).toHaveLength(2)
  })

  it.each([undefined, '', 'success', 'future'])('unknown/older outcome %s stays generic', compactResult => {
    expect(run(start, { ...end, compactResult, compactError: '' }).items[0]).toMatchObject({ failed: false })
  })

  it.each(['manual', 'auto', '', 'unknown', 'MANUAL'])('classifies trigger %s without retaining raw text', trigger => {
    expect(run({ ...boundary, trigger }).items)
      .toEqual([{ kind: 'compactionBoundary', failed: false, manual: trigger === 'manual', preTokens: 180000, postTokens: 40000 }])
  })

  it('keeps the pending row identity when an earlier optimistic echo is removed', () => {
    const state = run({ type: 'userText', text: 'queued', messageId: 'echo' }, start, end,
      { type: 'dropUserText', messageId: 'echo' })
    expect(reduceTimeline(state, boundary).items).toEqual([
      { kind: 'compactionBoundary', failed: false, manual: true, preTokens: 180000, postTokens: 40000 }
    ])
  })

  it('reconnect preserves rows/pending metadata and clears status without manufacturing completion', () => {
    const completed = run(start, end, { type: 'turnState', state: 'thinking' })
    const reconnected = reduceTimeline(completed, { type: 'reconnected' })
    expect(reconnected.items).toBe(completed.items)
    expect(reduceTimeline(reconnected, boundary).items).toHaveLength(1)
    expect(run(start, { type: 'reconnected' }, end).items).toEqual([])
    expect(run(start, end, { type: 'reset' })).toBe(initialTimelineState)
  })

  it('routes boundary and outcomes to their own conversation, surviving history prepend', () => {
    const store = createConversationTimelineStore()
    for (const id of ['a', 'b']) {
      store.getState().dispatchFor(id, start)
      store.getState().dispatchFor(id, end)
    }
    const beforeB = store.getState().timelines.get('b')
    store.getState().prependHistoryFor('a', [{ kind: 'userText', text: 'older' }])
    const wire = { type: 'compactionBoundary' as const, conversationId: 'a', trigger: 'manual', preTokens: 0, postTokens: null }
    const event = translateTimelineEvent(wire)
    expect(event).toEqual({ type: 'compactionBoundary', trigger: 'manual', preTokens: 0, postTokens: null })
    expect(timelineTargetFor(wire)).toBe('a')
    expect(translateDaemonEvent(wire)).toBeNull()
    expect(translateModalEvent(wire, () => new Set())).toBeNull()
    expect(translateQuestionEvent(wire)).toBeNull()
    if (!event) throw new Error('missing boundary translation')
    store.getState().dispatchFor('a', event)
    expect(store.getState().timelines.get('a')?.timeline.items).toEqual([
      { kind: 'userText', text: 'older' },
      { kind: 'compactionBoundary', failed: false, manual: true, preTokens: 0, postTokens: null }
    ])
    expect(store.getState().timelines.get('b')).toBe(beforeB)
    expect(translateTimelineEvent({ type: 'compacting', conversationId: 'b', active: false,
      compactResult: 'failed', compactError: 'private-error' }))
      .toEqual({ type: 'compacting', active: false, compactResult: 'failed', compactError: 'private-error' })
  })
})
