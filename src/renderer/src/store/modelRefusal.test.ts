import { describe, expect, it } from 'vitest'
import type { DaemonEvent, ModelRefusalEvent } from '@shared/ipc/events'
import { initialTimelineState, reduceTimeline, type ThreadEvent } from './threadTimeline'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { translateTimelineEvent, timelineTargetFor, liveJoinKeyFor } from './timelineBridge'
import { reduceHistoryPage, withoutLiveEntries } from './historyPageBridge'
import { createRunSettingsWriteStore } from './runSettingsWriteStore'
import { subscribeRefusalRecovery, subscribeRunSettingsWrite } from './runSettingsWriteBridge'

const report: ModelRefusalEvent = { type: 'modelRefusalFallback', originalModel: 'original', fallbackModel: 'fallback',
  scope: 'session', refusalCategory: 'unknown', banner: 'Explanation', truncatedFields: null, droppedFields: [] }
const live = { ...report, conversationId: 'a', daemonTs: 'stamp' }
const refusal = translateTimelineEvent(live)!
const offered = () => reduceTimeline(initialTimelineState, refusal)

describe('refusal timeline', () => {
  it('routes only the named conversation and leaves the turn lifecycle intact', () => {
    expect(timelineTargetFor(live)).toBe('a')
    expect(timelineTargetFor({ ...live, conversationId: '' })).toBeNull()
    const before = { ...initialTimelineState, phase: 'responding' as const, localSendPending: true,
      stalled: true, compacting: true, thinkingTokens: 23,
      latestTurnEnd: { type: 'turnEnd' as const, turnId: 't', stopReason: 'error', isError: true } }
    const after = reduceTimeline(before, refusal)
    expect({ ...after, items: before.items, refusalOffer: undefined }).toMatchObject(before)
    expect(offered().items).toEqual([{ kind: 'modelRefusal', refusal: report }])
  })
  it('history retains identical rows and never creates or revives an offer', () => {
    const entries = [{ id: 1, ts: 'stamp', event: report }]
    expect(reduceHistoryPage(entries)).toEqual(offered().items)
    expect(withoutLiveEntries(entries, new Set([liveJoinKeyFor(live)!]))).toEqual([])
    const store = createConversationTimelineStore()
    store.getState().dispatchFor('a', refusal)
    store.getState().dispatchFor('a', { type: 'refusalSessionReplaced' })
    for (const id of ['a', 'b']) {
      store.getState().prependHistoryFor(id, reduceHistoryPage(entries))
      expect(store.getState().timelines.get(id)?.timeline.refusalOffer).toBeUndefined()
    }
  })
  it.each([{ scope: 'local' }, { scope: 'future' }, { originalModel: '' }, { fallbackModel: '' }])('does not offer %j', patch => {
    const event = translateTimelineEvent({ ...live, ...patch })!
    expect(reduceTimeline(initialTimelineState, event).refusalOffer).toBeUndefined()
    expect(reduceTimeline(offered(), event).refusalOffer).toBeUndefined()
  })
  it('no fallback creates a retained row without an offer', () => {
    const event = translateTimelineEvent({ type: 'modelRefusalNoFallback', conversationId: 'a', originalModel: '',
      refusalCategory: '', banner: '', truncatedFields: null, droppedFields: null })!
    expect(reduceTimeline(initialTimelineState, event).items[0].kind).toBe('modelRefusal')
    expect(reduceTimeline(initialTimelineState, event).refusalOffer).toBeUndefined()
  })
  it('keeps offers through ordinary turns and matching model announcements', () => {
    const before = offered()
    const events: ThreadEvent[] = [{ type: 'turnState', state: 'thinking' }, { type: 'userText', text: 'next' },
      { type: 'assistantDelta', turnId: 't', seq: 0, text: 'reply' }, { type: 'turnEnd', turnId: 't', stopReason: 'end_turn' },
      { type: 'turnState', state: 'idle' }, { type: 'refusalModelAnnounced', model: 'fallback' }]
    expect(events.reduce(reduceTimeline, before).refusalOffer).toBe(before.refusalOffer)
  })
  it('correlates write replies and preserves rejection, without letting late replies retire a new offer', () => {
    const before = offered()
    const pending = reduceTimeline(before, { type: 'refusalWriteStarted', offer: before.refusalOffer!, changeId: 'one' })
    expect(reduceTimeline(pending, { type: 'refusalModelSelected', changeId: 'one' })).toBe(pending)
    expect(reduceTimeline(pending, { type: 'refusalWriteSettled', changeId: 'wrong', confirmed: true })).toBe(pending)
    const rejected = reduceTimeline(pending, { type: 'refusalWriteSettled', changeId: 'one', confirmed: false })
    expect(rejected.refusalOffer?.report).toEqual(report)
    expect(rejected.refusalOffer?.changeId).toBeUndefined()
    expect(rejected.refusalOffer).toHaveProperty('rejected', true)
    const retry = reduceTimeline(rejected, { type: 'refusalWriteStarted', offer: rejected.refusalOffer!, changeId: 'two' })
    expect(retry.refusalOffer).not.toHaveProperty('rejected', true)
    expect(reduceTimeline(retry, { type: 'refusalWriteSettled', changeId: 'one', confirmed: false })).toBe(retry)
    expect(reduceTimeline(pending, { type: 'refusalWriteSettled', changeId: 'one', confirmed: true }).refusalOffer).toBeUndefined()
    const newer = reduceTimeline(pending, refusal)
    expect(reduceTimeline(newer, { type: 'refusalWriteSettled', changeId: 'one', confirmed: true })).toBe(newer)
    expect(reduceTimeline(newer, { type: 'refusalWriteStarted', offer: before.refusalOffer!, changeId: 'stale' })).toBe(newer)
  })
  it.each([{ type: 'refusalModelSelected', changeId: 'manual' }, { type: 'refusalModelAnnounced', model: 'other' },
    { type: 'refusalSessionReplaced' }] satisfies ThreadEvent[])('retires on %j without removing rows', event => {
    const before = offered(), next = reduceTimeline(before, event)
    expect(next.refusalOffer).toBeUndefined()
    expect(next.items).toBe(before.items)
  })
})

it.each(['a', 'b'])('retains a correlated rejection received while %s is open after navigation clears settings', rejectedWhileOpen => {
  const timelines = createConversationTimelineStore(), writes = createRunSettingsWriteStore()
  const listeners = new Set<(event: DaemonEvent) => void>()
  const onEvent = (listener: (event: DaemonEvent) => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  let open = 'a'
  const offRecovery = subscribeRefusalRecovery(onEvent, writes, timelines, () => open)
  const offSettings = subscribeRunSettingsWrite(onEvent, writes.getState().dispatch)
  const get = (id: string) => timelines.getState().timelines.get(id)!.timeline.refusalOffer
  const navigate = (id: string) => {
    writes.getState().dispatch({ type: 'conversationSwitched' })
    open = id
  }
  const start = (changeId: string) => {
    timelines.getState().dispatchFor('a', { type: 'refusalWriteStarted', offer: get('a')!, changeId })
    writes.getState().dispatch({ type: 'changeDispatched', changeId, change: { field: 'model', value: 'original' } })
  }
  const emit = (event: DaemonEvent) => listeners.forEach(listener => listener(event))
  try {
    for (const id of ['a', 'b']) timelines.getState().dispatchFor(id, refusal)
    const other = get('b')
    start('one')
    navigate('b')
    navigate('a')
    expect(writes.getState().pending.size).toBe(0)
    expect(get('a')?.changeId).toBe('one')
    navigate(rejectedWhileOpen)
    emit({ type: 'sessionSettingsRejected', changeId: 'one' })
    navigate('a')
    expect(writes.getState().error).toBeNull()
    expect(get('a')).toEqual({ report, rejected: true })
    expect(get('b')).toBe(other)
    start('two')
    expect(get('a')).toEqual({ report, changeId: 'two' })
    navigate('b')
    emit({ type: 'sessionSettingsRejected', changeId: 'one' })
    expect(get('a')?.changeId).toBe('two')
    emit({ type: 'sessionSettingsUpdated', sessionId: 's', changeId: 'two' })
    navigate('a')
    expect(get('a')).toBeUndefined()
    expect(get('b')).toBe(other)
    expect(timelines.getState().timelines.get('a')?.timeline.items).toHaveLength(1)
  } finally {
    offSettings()
    offRecovery()
  }
  expect(listeners.size).toBe(0)
})

it('observes only later intents/events, isolates conversations, correlates replies, and tears down', () => {
  const timelines = createConversationTimelineStore(), writes = createRunSettingsWriteStore()
  let listener: ((event: DaemonEvent) => void) | undefined
  let open = 'a', stopped = false
  const off = subscribeRefusalRecovery(fn => { listener = fn; return () => { stopped = true } }, writes, timelines, () => open)
  const get = (id: string) => timelines.getState().timelines.get(id)?.timeline
  for (const id of ['a', 'b']) timelines.getState().dispatchFor(id, refusal)
  listener!({ type: 'runConfigReceived', conversationId: 'a', sessionId: 's', model: 'older', effort: '',
    yolo: false, permissionMode: '', used_tokens: 0, window_tokens: 0 })
  expect(get('a')?.refusalOffer).toBeDefined()
  const offer = get('a')!.refusalOffer!
  timelines.getState().dispatchFor('a', { type: 'refusalWriteStarted', offer, changeId: 'one' })
  writes.getState().dispatch({ type: 'changeDispatched', changeId: 'one', change: { field: 'model', value: 'original' } })
  expect(get('a')?.refusalOffer?.changeId).toBe('one')
  open = 'b'
  listener!({ type: 'sessionSettingsUpdated', sessionId: 's', changeId: 'one' })
  expect(get('a')?.refusalOffer).toBeUndefined()
  expect(get('b')?.refusalOffer).toBeDefined()
  writes.getState().dispatch({ type: 'changeDispatched', changeId: 'manual', change: { field: 'model', value: 'manual' } })
  expect(get('b')?.refusalOffer).toBeUndefined()
  timelines.getState().dispatchFor('a', refusal)
  listener!({ type: 'modelAnnounced', conversationId: 'b', model: 'other', truncated: false })
  expect(get('a')?.refusalOffer).toBeDefined()
  listener!({ type: 'sessionTransition', conversationId: 'a', newSessionId: 'new', reason: 'clear', workspaceCwd: null, occurredAt: '' })
  expect(get('a')?.refusalOffer).toBeUndefined()
  off()
  expect(stopped).toBe(true)
  timelines.getState().dispatchFor('b', refusal)
  writes.getState().dispatch({ type: 'changeDispatched', changeId: 'after', change: { field: 'model', value: 'manual' } })
  expect(get('b')?.refusalOffer).toBeDefined()
})
