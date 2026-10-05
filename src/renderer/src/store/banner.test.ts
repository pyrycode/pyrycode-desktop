import { describe, expect, it, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import { initialTimelineState, reduceTimeline, type ThreadEvent } from './threadTimeline'
import { createConversationTimelineStore, MAX_RETAINED_TIMELINES } from './conversationTimelineStore'
import { subscribeTimeline, timelineTargetFor, timelineWriteTarget, translateTimelineEvent } from './timelineBridge'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { submitMessage } from '../screens/conversation/composerSend'

const report = { level: 'warning', text: 'hook blocked', stopsTurn: true, truncated: false }
const banner: ThreadEvent = { type: 'banner', ...report }
const wire: DaemonEvent = { type: 'banner', conversationId: 'a', ...report }

describe('retained banner reports', () => {
  it('appends every arrival and replaces only the latest stopping reading without changing lifecycle', () => {
    const state = { ...initialTimelineState, phase: 'thinking' as const, stalled: true,
      localSendPending: { messageId: 'm1', queued: false }, compacting: true, thinkingTokens: 4, apiRetry: { current: 1, total: 2 } }
    const first = reduceTimeline(state, banner)
    expect(first).toEqual({ ...state, items: [{ kind: 'banner', ...report }], stoppingBanner: report })
    const duplicate = reduceTimeline(first, banner)
    expect(duplicate.items).toEqual([first.items[0], first.items[0]])
    const passive = reduceTimeline(duplicate, { ...banner, text: 'passive', stopsTurn: false })
    expect(passive.stoppingBanner).toBe(duplicate.stoppingBanner)
    const info = reduceTimeline(passive, { ...banner, level: 'info', text: '' })
    expect(info.items).toHaveLength(4)
    expect(info.stoppingBanner).toEqual({ ...report, level: 'info', text: '' })
  })
  it('preserves the report across daemon activity and reconnect, including trailing idle', () => {
    const held = reduceTimeline(initialTimelineState, banner)
    const events: ThreadEvent[] = [
      { type: 'turnState', state: 'idle' }, { type: 'turnState', state: 'thinking' },
      { type: 'assistantDelta', turnId: 't', seq: 1, text: 'reply' },
      { type: 'toolUse', turnId: 't', toolUseId: 'u', name: 'Bash', inputSummary: '' },
      { type: 'toolProgress', turnId: 't', toolUseId: 'u', elapsedSeconds: 1 },
      { type: 'toolResult', turnId: 't', toolUseId: 'u', isError: false, resultSummary: '' },
      { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' },
      { type: 'thinkingProgress', estimatedTokens: 10 }, { type: 'stallDetected' },
      { type: 'apiRetry', active: true, current: 1, total: 2 },
      { type: 'compacting', active: true }, { type: 'compacting', active: false },
      { type: 'compactionBoundary', trigger: 'manual' },
      { type: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: '' },
      { type: 'reconnected' }
    ]
    let state = held
    for (const event of events) {
      state = reduceTimeline(state, event)
      expect(state.stoppingBanner).toBe(held.stoppingBanner)
    }
    expect(reduceTimeline(state, { type: 'reset' }).stoppingBanner).toBeUndefined()
  })
  it.each(['message', '/cost'])('clears only for an optimistic accepted %s send', text => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('a', banner)
    store.getState().dispatchFor('b', banner)
    const held = store.getState().timelines.get('a')!.timeline
    const deps = { sendCommand: vi.fn(), newMessageId: () => 'local', dispatch: vi.fn(), dispatchFor: store.getState().dispatchFor }
    expect(submitMessage(' \t\n', 'a', deps)).toBe(false)
    expect(submitMessage(text, null, deps)).toBe(false)
    expect(store.getState().timelines.get('a')!.timeline).toBe(held)
    expect(submitMessage(text, 'a', deps)).toBe(true)
    const after = store.getState().timelines.get('a')!.timeline
    expect(after.stoppingBanner).toBeUndefined()
    expect(after.items[0]).toBe(held.items[0])
    expect(after.items[1]).toMatchObject({ kind: 'userText', text })
    expect(store.getState().timelines.get('b')!.timeline.stoppingBanner).toEqual(report)
  })
  it.each([null, 'other'])('routes received banners to their own conversation with open chat %j', open => {
    const store = createConversationTimelineStore()
    const getOpen = vi.fn(() => open)
    let receive: (event: DaemonEvent) => void = () => { throw new Error('not subscribed') }
    const off = vi.fn()
    const unsubscribe = subscribeTimeline(listener => { receive = listener; return off }, (event, id, key) => {
      const target = timelineWriteTarget(event, id, getOpen)
      if (target !== null) store.getState().dispatchFor(target, event, key)
    })
    for (const conversationId of ['a', 'a', '__proto__', 'constructor']) receive({ ...wire, conversationId })
    receive({ ...wire, conversationId: '' })
    expect(getOpen).not.toHaveBeenCalled()
    expect(store.getState().timelines.has('other')).toBe(false)
    expect(store.getState().timelines.has('')).toBe(false)
    expect(store.getState().timelines.get('a')!.timeline.items).toHaveLength(2)
    expect(store.getState().timelines.get('__proto__')!.timeline.stoppingBanner).toEqual(report)
    expect(translateTimelineEvent(wire)).toEqual(banner)
    expect(timelineTargetFor(wire)).toBe('a')
    expect(translateTimelineEvent({ ...wire, conversationId: '' })).toBeNull()
    expect(timelineTargetFor({ ...wire, conversationId: '' })).toBeNull()
    expect(translateDaemonEvent(wire)).toBeNull()
    expect(translateModalEvent(wire, () => new Set())).toBeNull()
    expect(translateQuestionEvent(wire)).toBeNull()
    unsubscribe()
    expect(off).toHaveBeenCalledOnce()
  })
  it('navigation retains the reading; clearing and eviction drop it with the timeline', () => {
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('a', banner)
    store.getState().markViewed('a')
    store.getState().markViewed('b')
    store.getState().markViewed('a')
    expect(store.getState().timelines.get('a')!.timeline.stoppingBanner).toEqual(report)
    store.getState().clearTimelineFor('a')
    expect(store.getState().timelines.has('a')).toBe(false)
    store.getState().dispatchFor('a', banner)
    for (let i = 0; i < MAX_RETAINED_TIMELINES; i++) store.getState().markViewed(`viewed-${i}`)
    expect(store.getState().timelines.has('a')).toBe(false)
  })
})
