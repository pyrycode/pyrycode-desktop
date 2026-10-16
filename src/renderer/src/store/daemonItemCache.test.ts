import { describe, expect, it, vi } from 'vitest'
import { createThreadItemStore } from './threadItemStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { createConversationListStore } from './conversationListStore'
import { readSavedTimeline } from './savedTimelineRestorer'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
import type { ChatHistoryRequest, ChatHistoryResult, ChatHistorySnapshot, ThreadSnapshot } from '@shared/chatHistory'
import type { ThreadItem, ThreadUpdate } from '@shared/wire/thread'
import type { StampedDaemonEvent } from '@shared/ipc/events'

const item = (rev = 10, order?: number): ThreadItem => ({ id: 1, rev, kind: 'assistant_message',
  active: false, shown: true, status: 'done', summary: '', content: { text: 'hello' }, ...(order === undefined ? {} : { order }) })
const added = (rev = 10, host = 'a', epoch = 'e', conversation_id = 'c') => ({ host, update: {
  type: 'thread_item_added', payload: { conversation_id, epoch, version: rev, item: item(rev) } } as ThreadUpdate })
const live = (store: ReturnType<typeof createThreadItemStore>, rev = 10, host = 'a', epoch = 'e', conversation = 'c') => {
  store.getState().acceptEpoch(host, conversation, epoch)
  store.getState().applyUpdate(host, added(rev, host, epoch, conversation).update)
}
const saved = (thread: ThreadSnapshot): Extract<ChatHistorySnapshot, { kind: 'daemon-items' }> => ({
  version: 1, kind: 'daemon-items', serverId: thread.hostId, conversationId: thread.conversationId, thread })
const held = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
function harness(write = async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' })) {
  const threads = createThreadItemStore(), lists = createConversationListStore()
  let listener: (event: StampedDaemonEvent) => void = () => {}
  const save = vi.fn(write), log = vi.fn()
  const writer = createChatHistoryWriter({ threads, lists, write: save, log,
    receipt: () => ({ type: 'assistantDelta', serverId: 'a' }),
    subscribeEvents: on => { listener = on; return () => { listener = () => {} } }, schedule: () => () => {} })
  const writes = () => save.mock.calls.map(([r]) => r).filter(r => r.operation === 'mutateThread')
  return { threads, writer, save, log, writes, event: (event: StampedDaemonEvent) => listener(event) }
}
const read = (threads: ReturnType<typeof createThreadItemStore>, response: Promise<ChatHistoryResult>) =>
  readSavedTimeline({ threads, read: () => response.then(project), log: () => {} }, 'a', 'c')
function project(result: ChatHistoryResult): ChatHistoryResult {
  if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') return result
  const { items, ranges, arrivalOrder, ...metadata } = result.snapshot.thread
  return { status: 'page', page: { partial: true, metadata: { ...metadata, hostId: result.snapshot.serverId, conversationId: result.snapshot.conversationId }, items, ranges, continuation: null,
    ...(arrivalOrder === undefined ? {} : { arrivalPositions: items.map(i => arrivalOrder.indexOf(i.id)) }) } }
}

it('partial opening preserves omitted availability ownership and sparse arrival positions', async () => {
  const target = createThreadItemStore(), api = target.getState()
  const page = { partial: true as const, metadata: { hostId: 'a', conversationId: 'c', epoch: 'e',
    version: 20, checkpoint: 20, repair: null, olderAvailable: false },
    items: [{ ...item(10), id: 2 }, item(10)], ranges: [{ start: 900, end: 910 }],
    arrivalPositions: [800, 20], availabilityStart: 1, continuation: null }
  const handle = api.beginLocalRead('a', 'c')!
  live(target, 40)
  api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 40,
    ranges: [{ start: 100, end: 110 }], olderAvailable: true })
  handle.complete(page)
  api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 40, version: 50,
    ranges: [{ start: 50, end: 60 }], olderAvailable: true })
  expect(api.snapshot('a', 'c')).toMatchObject({ olderAvailable: false, arrivalOrder: [1, 2] })
  expect([...target.getState().hosts.get('a')?.get('c')?.residency?.arrivalPositions ?? []]).toEqual([[2, 800], [1, 20]])
})

describe('daemon item cache ownership', () => {
  it.each(['matching', 'missing', 'error', 'reject', 'host', 'conversation', 'timeline', 'list', 'ok'] as const)(
    'requests bounded opening and admits matching daemon items: %s', async outcome => {
      const source = createThreadItemStore(), target = createThreadItemStore()
      live(source)
      const snapshot = saved(source.getState().snapshot('a', 'c')!)
      const response: ChatHistoryResult = outcome === 'missing' ? { status: 'missing' }
        : outcome === 'error' ? { status: 'error', code: 'unreadable' }
        : outcome === 'ok' ? { status: 'ok' }
        : { status: 'stored', snapshot: outcome === 'host' ? { ...snapshot, serverId: 'b' }
          : outcome === 'conversation' ? { ...snapshot, conversationId: 'other' }
          : outcome === 'timeline' ? { version: 1, kind: 'timeline', serverId: 'a', conversationId: 'c',
            items: [], prependedRows: 0, coverage: { status: 'unknown' } }
          : outcome === 'list' ? { version: 1, kind: 'list', serverId: 'a', conversations: [] } : snapshot }
      const log = vi.fn(), read = vi.fn(async () => {
        if (outcome === 'reject') throw Error('private detail')
        return project(response)
      })
      await readSavedTimeline({ threads: target, read, log }, 'a', 'c').done
      expect(read.mock.calls).toEqual([[{ operation: 'openThreadPage', serverId: 'a', conversationId: 'c', limit: 200 }]])
      expect(target.getState().snapshot('a', 'c')).toEqual(outcome === 'matching' ? snapshot.thread : null)
      if (outcome === 'matching') {
        await readSavedTimeline({ threads: target, read, log }, 'a', 'c').done
        expect(read).toHaveBeenCalledOnce()
      } else if (outcome !== 'missing') {
        expect(log).toHaveBeenCalledWith({ event: 'history-timeline-restore',
          code: outcome === 'error' ? 'unreadable' : outcome === 'reject' ? 'ipc-failed' : 'invalid-result' })
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    })
  it('retains exact unfinished and repair fences after offline hydration', async () => {
    const source = createThreadItemStore(); live(source, 100)
    source.getState().requireRepair('a', 'c', 'e', 150)
    live(source, 300)
    const batch = source.getState().beginBatch('a', 'c', 'e')!
    batch.applyItems([item(250)], 250); batch.abandon()
    const snapshot = source.getState().snapshot('a', 'c')!
    expect(snapshot).toMatchObject({ version: 300, checkpoint: 100, uncommittedVersion: 250 })
    const h = harness()
    await read(h.threads, Promise.resolve({ status: 'stored', snapshot: saved(snapshot) })).done
    expect(h.threads.getState().snapshot('a', 'c')).toEqual(snapshot)
    await h.writer.flush(); expect(h.writes()).toHaveLength(0)
    const api = h.threads.getState()
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 100, version: 200, ranges: [{ start: 10, end: 20 }] })
    live(h.threads, 400)
    expect(api.snapshot('a', 'c')).toMatchObject({ checkpoint: 200, uncommittedVersion: 250, repair: null })
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 200, version: 250, ranges: [] })
    live(h.threads, 500)
    expect(api.snapshot('a', 'c')).toMatchObject({ checkpoint: 500, uncommittedVersion: 0, ranges: [{ start: 10, end: 20 }] })
    await h.writer.stop()
  })
  it('restores completed progress without adding coverage', async () => {
    const source = createThreadItemStore(); source.getState().acceptEpoch('a', 'c', 'e')
    const b = source.getState().beginBatch('a', 'c', 'e')!
    b.applyItems([item(20, 5)], 20)
    b.commit({ fromVersion: 0, version: 20, ranges: [{ start: 5, end: 10 }], olderAvailable: false })
    const snapshot = source.getState().snapshot('a', 'c')!, target = createThreadItemStore()
    await read(target, Promise.resolve({ status: 'stored', snapshot: saved(snapshot) })).done
    live(target, 30)
    expect(target.getState().snapshot('a', 'c')).toMatchObject({ checkpoint: 30, ranges: snapshot.ranges, olderAvailable: false })
  })
  it('restores snapshots without arrival metadata using their supplied held order', async () => {
    const target = createThreadItemStore()
    const snapshot: ThreadSnapshot = { hostId: 'a', conversationId: 'c', epoch: 'e', version: 10,
      checkpoint: 10, ranges: [], repair: null, items: [{ ...item(10, 10), id: 2 }, item(10, 20)] }
    await read(target, Promise.resolve({ status: 'stored', snapshot: saved(snapshot) })).done
    target.getState().applyUpdate('a', { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
      version: 20, item_id: 1, base_rev: 10, rev: 20, changes: { order: 10 } } })
    expect(target.getState().snapshot('a', 'c')?.items.map(item => item.id)).toEqual([2, 1])
    expect(target.getState().snapshot('a', 'c')?.arrivalOrder).toEqual([2, 1])
  })
  it.each(['missing', 'failure', 'rejection'] as const)('ignores delayed read outcomes after live admission: %s', async kind => {
    const target = createThreadItemStore(), wait = held<ChatHistoryResult>()
    const task = read(target, kind === 'rejection' ? wait.promise.then(() => { throw Error('private') }) : wait.promise)
    live(target, 50)
    const before = target.getState().snapshot('a', 'c')
    wait.resolve(kind === 'missing' ? { status: 'missing' } : { status: 'error', code: 'unreadable' })
    await task.done
    expect(target.getState().snapshot('a', 'c')).toBe(before)
  })
  it.each([true, false])('merges delayed restoration with admitted revisions and original arrival ties: metadata=%s', async metadata => {
    const h = harness(), wait = held<ChatHistoryResult>(), task = read(h.threads, wait.promise), api = h.threads.getState()
    const items = [1, 2, 3, 4].map(id => ({ ...item(10), id, content: { text: 'saved' } }))
    const snapshot: ThreadSnapshot = { hostId: 'a', conversationId: 'c', epoch: 'e', items,
      version: 10, checkpoint: 10, repair: null, ranges: [], ...(metadata ? { arrivalOrder: [2, 1, 3, 4] } : {}) }
    for (const [id, rev] of [[1, 9], [2, 10], [3, 11], [5, 12]]) api.applyUpdate('a', {
      type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 20,
        item: { ...item(rev), id, content: { text: 'live' }, timestamp: '1900' } } })
    await h.writer.flush(); const before = h.writes().length
    wait.resolve({ status: 'stored', snapshot: saved(snapshot) }); await task.done
    expect(api.snapshot('a', 'c')?.items.map(i => [i.id, i.rev, i.content])).toEqual(
      (metadata ? [2, 1, 3, 4, 5] : [1, 2, 3, 4, 5]).map(id => [id,
        id === 3 ? 11 : id === 5 ? 12 : 10, { text: [2, 3, 5].includes(id) ? 'live' : 'saved' }]))
    await h.writer.flush(); expect(h.writes()).toHaveLength(before)
    api.applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 30, item_id: 2, base_rev: 10, rev: 11, text: '!' } })
    await h.writer.flush(); expect(h.writes()).toHaveLength(before + 1)
    await h.writer.stop()
  })
  it.each([false, true])('preserves saved obligations while folding admitted progress: completion=%s', async complete => {
    const target = createThreadItemStore(), api = target.getState(), wait = held<ChatHistoryResult>(), task = read(target, wait.promise)
    live(target, 400)
    const batch = api.beginBatch('a', 'c', 'e')!
    batch.applyItems([item(350)], 350)
    if (complete) batch.commit({ fromVersion: 0, version: 250, ranges: [{ start: 20, end: 30 }], olderAvailable: true })
    else batch.abandon()
    const snapshot: ThreadSnapshot = { hostId: 'a', conversationId: 'c', epoch: 'e', items: [item(300)],
      version: 300, checkpoint: 100, uncommittedVersion: 250, repair: { fromVersion: 100, throughVersion: 150 },
      ranges: [{ start: 1, end: 10 }], olderAvailable: false }
    wait.resolve({ status: 'stored', snapshot: saved(snapshot) }); await task.done
    expect(api.snapshot('a', 'c')).toMatchObject({ version: 400, checkpoint: complete ? 250 : 100,
      uncommittedVersion: 350, repair: complete ? null : snapshot.repair, olderAvailable: false,
      ranges: complete ? [{ start: 1, end: 10 }, { start: 20, end: 30 }] : snapshot.ranges })
    live(target, 500)
    expect(api.snapshot('a', 'c')?.checkpoint).toBe(complete ? 250 : 100)
  })
  it.each(['cancel', 'repeat', 'epoch', 'reset', 'conversation', 'host', 'all'] as const)(
    'invalidates local reads across cancellation and reused scope identities: %s', async kind => {
    for (const result of ['stored', 'missing', 'failed'] as const) {
      const target = createThreadItemStore(), source = createThreadItemStore(); live(source)
      const wait = held<ChatHistoryResult>(), task = read(target, wait.promise), api = target.getState()
      if (kind === 'cancel') task.cancel()
      if (kind === 'repeat') api.beginLocalRead('a', 'c')!.cancel()
      if (kind === 'epoch') { api.acceptEpoch('a', 'c', 'different'); api.acceptEpoch('a', 'c', 'e') }
      if (kind === 'reset') { live(target); api.acceptEpoch('a', 'c', 'e', true) }
      if (kind === 'conversation') api.deleteConversation('a', 'c')
      if (kind === 'host') api.removeHost('a')
      if (kind === 'all') api.clearAll()
      live(target, 50)
      const before = api.snapshot('a', 'c')
      wait.resolve(result === 'stored' ? { status: 'stored', snapshot: saved(source.getState().snapshot('a', 'c')!) }
        : result === 'missing' ? { status: 'missing' } : { status: 'error', code: 'unreadable' }); await task.done
      expect(api.snapshot('a', 'c')).toBe(before)
      if (kind !== 'epoch' && kind !== 'reset') {
        api.deleteConversation('a', 'c')
        const fresh = api.beginLocalRead('a', 'c')!
        fresh.complete(source.getState().snapshot('a', 'c'))
        expect(api.snapshot('a', 'c')?.items).toEqual([item()])
      }
    }
    })
  it.each(['empty', 'epoch', 'kind', 'invalid'] as const)('settles saved %s without replacing live authority', async kind => {
    const target = createThreadItemStore(), wait = held<ChatHistoryResult>(), task = read(target, wait.promise)
    live(target, 50)
    const before = target.getState().snapshot('a', 'c')!
    const snapshot: ThreadSnapshot = { hostId: 'a', conversationId: 'c', epoch: kind === 'epoch' ? 'other' : 'e',
      version: 10, checkpoint: 10, repair: null, ranges: [], items: kind === 'empty' ? []
        : [{ ...item(100), kind: kind === 'kind' ? 'tool_call' : 'assistant_message' }],
      ...(kind === 'invalid' ? { arrivalOrder: [999] } : {}) }
    wait.resolve({ status: 'stored', snapshot: saved(snapshot) }); await task.done
    expect(target.getState().snapshot('a', 'c')?.items).toEqual(before.items)
    if (kind === 'kind') expect(target.getState().snapshot('a', 'c')?.repair).toEqual({ fromVersion: 50, throughVersion: 50 })
    if (kind === 'invalid' || kind === 'epoch') expect(target.getState().snapshot('a', 'c')).toBe(before)
  })
  it('keeps an admitted batch handle valid when its delayed saved owner settles', async () => {
    const target = createThreadItemStore(), wait = held<ChatHistoryResult>(), task = read(target, wait.promise)
    live(target, 20)
    const api = target.getState(), batch = api.beginBatch('a', 'c', 'e')!
    batch.applyItems([{ ...item(25), id: 2 }], 25)
    wait.resolve({ status: 'stored', snapshot: saved({ hostId: 'a', conversationId: 'c', epoch: 'e',
      version: 10, checkpoint: 10, items: [{ ...item(), id: 3 }], repair: null, ranges: [] }) })
    await task.done
    expect(batch.commit({ fromVersion: 10, version: 25, ranges: [] })).toEqual({ type: 'applied' })
    expect(api.snapshot('a', 'c')).toMatchObject({ checkpoint: 25, uncommittedVersion: 0 })
    expect(api.snapshot('a', 'c')?.items.map(i => i.id)).toEqual([3, 1, 2])
  })
  it('flushes the newest snapshot through a held write and epoch replacement', async () => {
    const wait = held<ChatHistoryResult>(), started = held<void>()
    let first = true
    const h = harness(async () => { if (first) { first = false; started.resolve(); return wait.promise } return { status: 'ok' } })
    live(h.threads); const flushing = h.writer.flush(); await started.promise
    live(h.threads, 20); live(h.threads, 5, 'a', 'new'); live(h.threads, 30, 'b')
    wait.resolve({ status: 'ok' }); await flushing
    expect(h.writes().map(r => [r.serverId, r.change.metadata.epoch, r.change.metadata.version])).toEqual([
      ['a', 'e', 10], ['a', 'new', 5], ['b', 'e', 30] ])
    await h.writer.stop(); live(h.threads, 40)
    expect(h.writes()).toHaveLength(3)
  })
  it('deletion orders both formats and list removal behind held saves', async () => {
    const wait = held<ChatHistoryResult>(), started = held<void>()
    let first = true
    const h = harness(async () => { if (first) { first = false; started.resolve(); return wait.promise } return { status: 'ok' } })
    live(h.threads); const flushing = h.writer.flush(); await started.promise
    live(h.threads, 20); live(h.threads, 30, 'b')
    h.event({ type: 'conversationDeleted', serverId: 'a', id: 'c' })
    expect(h.threads.getState().snapshot('a', 'c')).toBeNull()
    live(h.threads, 40)
    wait.resolve({ status: 'ok' }); await flushing
    expect(h.writes().filter(r => r.serverId === 'a')).toHaveLength(1)
    expect(h.save.mock.calls.map(([r]) => r.operation)).toEqual(['mutateThread', 'mutateThread', 'removeConversation'])
    expect(h.threads.getState().snapshot('b', 'c')?.version).toBe(30)
    await h.writer.stop()
  })
  it('does not deduplicate fresh identical items against a pre-unpair in-flight save', async () => {
    const wait = held<ChatHistoryResult>(), started = held<void>()
    let first = true
    const h = harness(async () => { if (first) { first = false; started.resolve(); return wait.promise } return { status: 'ok' } })
    live(h.threads)
    const flushing = h.writer.flush(); await started.promise
    const settle = beginChatHistoryRemoval('a')
    settle(true)
    live(h.threads)
    wait.resolve({ status: 'ok' }); await flushing
    expect(h.writes()).toHaveLength(2)
    expect(h.writes()[1]).toEqual(h.writes()[0])
    await h.writer.stop()
  })
  it.each([true, false])('unpair invalidates old work and preserves another host: success=%s', async removed => {
    const h = harness(); live(h.threads); live(h.threads, 10, 'a', 'e', 'offscreen'); live(h.threads, 20, 'b')
    const wait = held<ChatHistoryResult>(), task = readSavedTimeline({ threads: h.threads, read: () => wait.promise.then(project), log: () => {} }, 'a', 'unread')
    const settle = beginChatHistoryRemoval('a')
    await h.writer.flush(); expect(h.writes().map(r => r.serverId)).toEqual(['b'])
    live(h.threads, 15, 'a', 'e', 'unread')
    settle(removed)
    wait.resolve({ status: 'stored', snapshot: saved({ ...h.threads.getState().snapshot('b', 'c')!, hostId: 'a', conversationId: 'unread' }) }); await task.done
    await h.writer.flush()
    expect(h.threads.getState().snapshot('a', 'offscreen') === null).toBe(removed)
    expect(h.threads.getState().snapshot('a', 'unread') === null).toBe(removed)
    if (removed) { live(h.threads, 5); await h.writer.flush(); expect(h.writes().at(-1)?.change.metadata.version).toBe(5) }
    expect(h.threads.getState().snapshot('b', 'c')?.version).toBe(20)
    await h.writer.stop()
  })
})
