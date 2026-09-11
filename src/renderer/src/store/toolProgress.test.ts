import { describe, expect, it } from 'vitest'
import { initialTimelineState, reduceTimeline, type ThreadEvent } from './threadTimeline'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { translateTimelineEvent, timelineTargetFor } from './timelineBridge'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'

const call = (turnId = 't1', toolUseId = 'u1'): ThreadEvent => ({
  type: 'toolUse', turnId, toolUseId, name: 'Bash', inputSummary: 'build'
})
const progress = (elapsedSeconds = 30): ThreadEvent => ({
  type: 'toolProgress', turnId: 't1', toolUseId: 'u1', elapsedSeconds
})
const result: ThreadEvent = {
  type: 'toolResult', turnId: 't1', toolUseId: 'u1', isError: false, resultSummary: 'done'
}
const denied: ThreadEvent = {
  type: 'toolDenied', turnId: 't1', toolUseId: 'u1', denial: {
    toolName: 'Bash', decisionReasonType: 'rule', decisionReason: '', message: 'Denied',
    truncatedFields: null, droppedFields: null
  }
}

describe('pending tool progress', () => {
  it('replaces only the matching call and preserves all lifecycle state', () => {
    const seeded = reduceTimeline(reduceTimeline(reduceTimeline(initialTimelineState, call()), call('t2')), call('t1', 'u2'))
    let state = { ...seeded, stalled: true, compacting: true, thinkingTokens: 42 }
    for (const seconds of [30, 60, 0, -65, 12]) {
      const next = reduceTimeline(state, progress(seconds))
      expect(next).toEqual({ ...state, items: [
        { ...state.items[0], elapsedSeconds: seconds }, state.items[1], state.items[2]
      ] })
      expect(next.items[1]).toBe(state.items[1])
      expect(next.items[2]).toBe(state.items[2])
      state = { ...next, stalled: true, compacting: true, thinkingTokens: 42 }
    }
    expect(reduceTimeline(state, progress(12))).toBe(state)
  })
  it('does not create rows for unmatched calls or turns', () => {
    expect(reduceTimeline(initialTimelineState, progress())).toBe(initialTimelineState)
    for (const event of [call('other'), call('t1', 'other')]) {
      const state = reduceTimeline(initialTimelineState, event)
      expect(reduceTimeline(state, progress())).toBe(state)
    }
  })
  it.each([result, denied])('clears on $type and ignores late progress', (completion) => {
    const pending = reduceTimeline(reduceTimeline(initialTimelineState, call()), progress())
    const settled = reduceTimeline(pending, completion)
    expect(settled.items[0]).toHaveProperty('elapsedSeconds', undefined)
    expect(reduceTimeline(settled, progress(90))).toBe(settled)
  })
  it('routes by conversation without creating an unknown slice or changing other conversations', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('c1', call())
    store.getState().dispatchFor('c2', call())
    const before = store.getState()
    const wire = { type: 'toolProgress' as const, conversationId: 'c1', turnId: 't1', toolUseId: 'u1', elapsedSeconds: -65 }
    const translated = translateTimelineEvent(wire)
    expect(translated).toEqual(progress(-65))
    expect(timelineTargetFor(wire)).toBe('c1')
    expect(translateDaemonEvent(wire)).toBeNull()
    expect(translateModalEvent(wire, () => new Set())).toBeNull()
    expect(translateQuestionEvent(wire)).toBeNull()
    if (!translated) throw new Error('missing translation')
    store.getState().dispatchFor('unknown', translated)
    expect(store.getState()).toBe(before)
    store.getState().dispatchFor('c1', translated)
    expect(store.getState().timelines.get('c2')).toBe(before.timelines.get('c2'))
    expect(store.getState().timelines.get('c1')?.timeline.items[0]).toHaveProperty('elapsedSeconds', -65)
  })
})
