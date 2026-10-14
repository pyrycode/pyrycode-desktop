import { expect, it, vi } from 'vitest'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { parseChatHistorySnapshot } from '@shared/chatHistory'
import type { HistoryTimelineEntry } from '@shared/ipc/events'
import { createNewestHistoryDemand } from './newestHistoryDemand'
import { readSavedTimeline } from './savedTimelineRestorer'
import { retryHistoryPage, selectHistoryFailure } from '../screens/conversation/historyRetry'

function harness() {
  let host = 'a'
  let target: { serverId: string; conversationId: string } | null = { serverId: host, conversationId: 'c' }
  let connected = true
  const store = createConversationTimelineStore(undefined, () => host)
  const sendCommand = vi.fn()
  const deps = { sendCommand, canRequest: () => connected && target?.serverId === host,
    getHeld: (id: string) => store.getState().timelines.get(id) ?? null,
    markRequested: (id: string, cursor?: string, purpose?: 'older' | 'newest' | 'gap' | 'gap-newest') =>
      store.getState().markHistoryRequested(id, host, cursor, purpose) }
  const demand = createNewestHistoryDemand(deps)
  const sync = () => demand.sync(target, connected)
  store.subscribe(sync)
  return { store, deps, sync,
    navigate(next: typeof target) { target = next; if (next) host = next.serverId; sync() },
    connect(next: boolean) { connected = next; sync() },
    settle() { store.getState().recordHistoryPage('c', 'end', true, []) } }
}

it('counts real openings and reconnect edges, ignoring replay, metadata and settlement', () => {
  const h = harness()
  h.sync(); h.sync()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.settle(); h.sync(); h.navigate({ serverId: 'a', conversationId: 'c' })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.navigate(null); h.navigate({ serverId: 'a', conversationId: 'c' }); h.settle()
  h.connect(false); h.connect(true); h.settle(); h.connect(true)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(3)
  expect(h.deps.sendCommand.mock.calls.map(([c]) => c.payload)).toEqual(Array(3).fill({
    conversation_id: 'c', cursor: '', limit: 200
  }))
})

it('an offline opening waits for its first connection and host replacement isolates equal IDs', () => {
  const h = harness()
  h.connect(false); h.sync()
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  h.connect(true); h.settle()
  h.navigate({ serverId: 'b', conversationId: 'c' })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  expect(h.store.getState().timelines.get('c')?.serverId).toBe('b')
  expect(h.store.getState().timelines.get('c')?.coverage).toBeUndefined()
})

it.each(['missing', 'failure', 'live'])('a saved read releases its one delayed ask on %s', outcome => {
  const h = harness()
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.sync(); h.sync()
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  if (outcome === 'missing') read.complete(null)
  if (outcome === 'failure') read.fail()
  if (outcome === 'live') h.store.getState().dispatchLocalEcho('a', 'c', { type: 'userText', text: 'live' })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  expect(h.deps.getHeld('c')?.localRead).toBe(outcome === 'missing' ? 'loaded' : undefined)
  read.complete(null); h.sync()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
})

it.each(['departure', 'disconnect', 'replacement'])('invalidates the saved-read delayed send on %s', change => {
  const h = harness()
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.sync()
  if (change === 'departure') h.navigate(null)
  if (change === 'disconnect') h.connect(false)
  if (change === 'replacement') {
    h.store.getState().beginLocalTimelineRead('b', 'c')
    h.navigate({ serverId: 'b', conversationId: 'c' })
  }
  read.complete(null)
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
})

it('defers a newest opening behind an owned ask, without settlement generating demand', () => {
  const h = harness()
  h.store.getState().markHistoryRequested('c', 'a', 'older', 'older')
  h.sync()
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  h.settle()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.settle(); h.sync()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
})

it.each(['created', 'failed-read'])('reopening an empty %s slice retains its outstanding ask through a saved read', source => {
  for (const outcome of ['stored', 'missing', 'failure', 'cancel']) {
    const h = harness()
    if (source === 'created') h.store.getState().initializeCreatedTimeline('a', 'c')
    else h.store.getState().beginLocalTimelineRead('a', 'c')!.fail()
    h.sync()
    const outstanding = h.deps.getHeld('c')!.history
    h.navigate(null)
    const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
    expect(h.deps.getHeld('c')?.history).toBe(outstanding)
    h.navigate({ serverId: 'a', conversationId: 'c' })
    if (outcome === 'failure') read.fail()
    else if (outcome === 'cancel') read.cancel()
    else read.complete(outcome === 'stored' ? { version: 1, kind: 'timeline', serverId: 'a', conversationId: 'c',
      items: [{ kind: 'userText', text: 'saved row' }], prependedRows: 0, coverage: { status: 'unknown' } } : null)
    expect(h.deps.getHeld('c')?.history).toBe(outstanding)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    h.settle()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
    expect(h.deps.sendCommand.mock.calls[1][0].payload.cursor).toBe('')
    h.settle(); h.sync()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  }
})

it('cancelling a saved read after the outstanding page settles preserves its rows and receipt', () => {
  const h = harness()
  h.sync(); h.navigate(null)
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.store.getState().prependHistoryFor('c', [{ kind: 'userText', text: 'received row' }])
  h.store.getState().recordHistoryPage('c', 'end', true, [7])
  read.cancel()
  expect(h.deps.getHeld('c')?.timeline.items).toMatchObject([{ text: 'received row' }])
  expect(h.deps.getHeld('c')?.served?.ids).toEqual([7])
  h.navigate({ serverId: 'a', conversationId: 'c' })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
})

it.each(['missing', 'stored'])('a newest page supersedes a reopened %s read even if the following refresh fails', outcome => {
  const h = harness()
  h.sync(); h.navigate(null)
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.navigate({ serverId: 'a', conversationId: 'c' })
  const entries: HistoryTimelineEntry[] = [{ id: 7, ts: 'received', event: {
    type: 'messageReceived', message: { message_id: 'received-message', role: 'user', text: 'received row' }
  } }]
  h.store.getState().prependHistoryFor('c', [], false, entries)
  h.store.getState().recordHistoryPage('c', 'newest-cursor', false, [7, 8])
  const admitted = h.deps.getHeld('c')!
  expect(admitted.timeline.items).toMatchObject([{ text: 'received row' }])
  expect(admitted.display?.map(entry => entry.id)).toEqual([7])
  read.complete(outcome === 'missing' ? null : { version: 1, kind: 'timeline', serverId: 'a', conversationId: 'c',
    items: [{ kind: 'userText', text: 'older saved row' }], prependedRows: 0,
    coverage: { status: 'received', cursor: 'saved-oldest', atStart: true } })
  expect(h.deps.getHeld('c')).toBe(admitted)
  expect(admitted.localRead).toBeUndefined()
  expect(admitted.localReadOwner).toBeUndefined()
  expect(admitted.history).toEqual({ status: 'requested', cursor: '', purpose: 'newest' })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  h.store.getState().recordHistoryFailure('c', 'unclassified', true)
  const failed = h.deps.getHeld('c')!
  expect(failed.timeline).toBe(admitted.timeline)
  expect(failed.display).toBe(admitted.display)
  expect(failed.coverage).toEqual({ status: 'received', cursor: 'newest-cursor', atStart: false })
  expect(failed.served).toEqual({ ids: [7, 8], highestId: 8,
    receipts: [{ ids: [7, 8], cursor: 'newest-cursor', atStart: false }] })
  read.fail(); read.cancel(); h.sync()
  expect(h.deps.getHeld('c')).toBe(failed)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
})

it.each([undefined, [], [7]])('empty newest settlement supersedes loading reads with served IDs %j', ids => {
  const h = harness()
  h.sync(); h.navigate(null)
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.navigate({ serverId: 'a', conversationId: 'c' })
  h.store.getState().recordHistoryPage('c', 'empty-cursor', false, ids)
  const admitted = h.deps.getHeld('c')!
  read.complete({ version: 1, kind: 'timeline', serverId: 'a', conversationId: 'c',
    items: [{ kind: 'userText', text: 'older saved row' }], prependedRows: 0, coverage: { status: 'unknown' } })
  expect(h.deps.getHeld('c')).toBe(admitted)
  expect(admitted.timeline.items).toEqual([])
  expect(admitted.localRead).toBeUndefined()
  expect(admitted.localReadOwner).toBeUndefined()
  expect(admitted.coverage).toEqual({ status: 'received', cursor: 'empty-cursor', atStart: false })
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
})

it('departure cancels demand deferred behind a request and ownership gates every send', () => {
  const h = harness()
  h.store.getState().markHistoryRequested('c', 'a', 'older', 'older')
  h.sync(); h.navigate(null); h.settle()
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  const guarded = createNewestHistoryDemand({ ...h.deps, canRequest: () => false })
  guarded.sync({ serverId: 'a', conversationId: 'c' }, true)
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
})

it.each([{ ids: [] }, { ids: [3, 7] }])('an empty or undrawable newest page seeds paging and settles without cascading: %j', ({ ids }) => {
  const h = harness()
  h.sync()
  h.store.getState().recordHistoryPage('c', 'seed-cursor', false, ids)
  const held = h.deps.getHeld('c')!
  expect(held.timeline.items).toEqual([])
  expect(held.history?.status).toBe('loaded')
  expect(held.coverage).toEqual({ status: 'received', cursor: 'seed-cursor', atStart: false })
  expect(held.served?.receipts).toEqual([{ ids, cursor: 'seed-cursor', atStart: false }])
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
})

it('reconnect waits for interruption settlement then asks newest once', () => {
  const h = harness()
  h.sync(); h.connect(false); h.connect(true)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  h.store.getState().recordHistoryFailure('c', 'history-unavailable', true)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  h.store.getState().recordHistoryFailure('c', 'unclassified', true); h.sync()
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
})

it('Retry resends a failed newest cursor at held atStart and rejects stale ownership', () => {
  const h = harness()
  h.connect(false); h.store.getState().markViewed('c'); h.settle(); h.connect(true)
  h.store.getState().recordHistoryFailure('c', 'unclassified', true)
  const failure = selectHistoryFailure(h.deps.getHeld('c'), 'a')!
  const open = { id: 'c' }
  const deps = { ...h.deps, getOpen: () => open, getConnectedHost: () => 'a', logRequested: vi.fn() }
  retryHistoryPage(deps, open, 'b', failure)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
  retryHistoryPage(deps, open, 'a', failure)
  retryHistoryPage(deps, open, 'a', failure)
  expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  expect(h.deps.sendCommand.mock.calls[1][0].payload.cursor).toBe('')
})

it('the owned async reader settles before sending and cancellation suppresses completion', async () => {
  const h = harness()
  let finish: (value: { status: 'missing' }) => void = () => {}
  const reader = readSavedTimeline({ timelines: h.store, log: vi.fn(), read: () =>
    new Promise(resolve => { finish = resolve }) }, 'a', 'c')
  h.sync()
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
  h.navigate(null); reader.cancel(); finish({ status: 'missing' }); await reader.done
  expect(h.deps.sendCommand).not.toHaveBeenCalled()
})

it('a newest page preserves the oldest cursor and every complete receipt', () => {
  const store = createConversationTimelineStore(undefined, () => 'host')
  store.getState().markViewed('c')
  store.getState().recordHistoryPage('c', 'oldest', true, [1, 2])
  store.getState().markHistoryRequested('c', 'host', '', 'newest')
  store.getState().recordHistoryPage('c', 'newest-cursor', false, [10, 12])
  const held = store.getState().timelines.get('c')!
  expect(held.coverage).toEqual({ status: 'received', cursor: 'oldest', atStart: true })
  expect(held.served).toEqual({ ids: [1, 2, 10, 12], highestId: 12, receipts: [
    { ids: [1, 2], cursor: 'oldest', atStart: true },
    { ids: [10, 12], cursor: 'newest-cursor', atStart: false }
  ] })
  const saved = parseChatHistorySnapshot({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
    items: [{ kind: 'userText', text: 'legacy display only' }], prependedRows: 0,
    coverage: held.coverage, served: held.served })
  const fresh = createConversationTimelineStore()
  if (saved.kind !== 'timeline') throw new Error('Expected timeline')
  fresh.getState().beginLocalTimelineRead('host', 'c')!.complete(saved)
  expect(fresh.getState().timelines.get('c')?.served).toEqual(held.served)
  expect(fresh.getState().timelines.get('c')?.display).toBeUndefined()
})

it('a newest failure retains its empty request cursor despite backwards completion', () => {
  const store = createConversationTimelineStore()
  store.getState().markViewed('c')
  store.getState().recordHistoryPage('c', 'end', true)
  store.getState().markHistoryRequested('c', 'host', '', 'newest')
  store.getState().recordHistoryFailure('c', 'unclassified', true)
  expect(store.getState().timelines.get('c')?.history).toEqual({
    status: 'failed', reason: 'unclassified', retryable: true, cursor: '', purpose: 'newest'
  })
})

it('newest request and contribution settlement keep restored rows in saved presentation', () => {
  const h = harness()
  const read = h.store.getState().beginLocalTimelineRead('a', 'c')!
  h.sync()
  read.complete({ version: 1, kind: 'timeline', serverId: 'a', conversationId: 'c',
    items: [{ kind: 'assistantText', turnId: 'saved', text: 'partial saved reply' }],
    prependedRows: 0, coverage: { status: 'unknown' } })
  expect(h.deps.getHeld('c')?.localRead).toBe('loaded')
  h.store.getState().prependHistoryFor('c', [], false, [])
  h.store.getState().recordHistoryPage('c', 'newest', false, [])
  expect(h.deps.getHeld('c')?.localRead).toBe('loaded')
  h.connect(false); h.connect(true)
  h.store.getState().recordHistoryFailure('c', 'history-unavailable', true)
  expect(h.deps.getHeld('c')?.localRead).toBe('loaded')
})
