import { describe, expect, it, vi } from 'vitest'
import { createThreadItemStore } from './threadItemStore'
import { createChatHistoryWriter } from './chatHistoryWriter'
import { createConversationListStore } from './conversationListStore'
import { createConversationTimelineStore } from './conversationTimelineStore'
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
  const threads = createThreadItemStore(), lists = createConversationListStore(), timelines = createConversationTimelineStore()
  let listener: (event: StampedDaemonEvent) => void = () => {}
  const save = vi.fn(write), log = vi.fn()
  const writer = createChatHistoryWriter({ threads, lists, timelines, write: save, log, receipt: () => null,
    subscribeEvents: on => { listener = on; return () => { listener = () => {} } }, schedule: () => () => {} })
  const writes = () => save.mock.calls.map(([r]) => r).filter(r => r.operation === 'replaceThread')
  return { threads, writer, save, log, writes, event: (event: StampedDaemonEvent) => listener(event) }
}
const read = (threads: ReturnType<typeof createThreadItemStore>, response: Promise<ChatHistoryResult>) =>
  readSavedTimeline({ threads, read: () => response, log: () => {} }, 'a', 'c')

describe('daemon item cache ownership', () => {
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
  it.each(['stored', 'missing', 'failure', 'rejection'] as const)('ignores delayed read outcomes after live admission: %s', async kind => {
    const target = createThreadItemStore(), wait = held<ChatHistoryResult>()
    const task = read(target, kind === 'rejection' ? wait.promise.then(() => { throw Error('private') }) : wait.promise)
    const source = createThreadItemStore(); live(source)
    live(target, 50)
    const before = target.getState().snapshot('a', 'c')
    wait.resolve(kind === 'stored' ? { status: 'stored', snapshot: saved(source.getState().snapshot('a', 'c')!) }
      : kind === 'missing' ? { status: 'missing' } : { status: 'error', code: 'unreadable' })
    await task.done
    expect(target.getState().snapshot('a', 'c')).toBe(before)
  })
  it.each(['cancel', 'repeat', 'epoch', 'conversation', 'host', 'all'] as const)(
    'invalidates local reads across cancellation and reused scope identities: %s', async kind => {
      const target = createThreadItemStore(), source = createThreadItemStore(); live(source)
      const wait = held<ChatHistoryResult>(), task = read(target, wait.promise), api = target.getState()
      if (kind === 'cancel') task.cancel()
      if (kind === 'repeat') api.beginLocalRead('a', 'c')!.cancel()
      if (kind === 'epoch') { api.acceptEpoch('a', 'c', 'different'); api.acceptEpoch('a', 'c', 'e') }
      if (kind === 'conversation') api.deleteConversation('a', 'c')
      if (kind === 'host') api.removeHost('a')
      if (kind === 'all') api.clearAll()
      const before = api.snapshot('a', 'c')
      wait.resolve({ status: 'stored', snapshot: saved(source.getState().snapshot('a', 'c')!) }); await task.done
      expect(api.snapshot('a', 'c')).toBe(before)
      if (kind !== 'epoch') {
        const fresh = api.beginLocalRead('a', 'c')!
        fresh.complete(source.getState().snapshot('a', 'c'))
        expect(api.snapshot('a', 'c')?.items).toEqual([item()])
      }
    })
  it('flushes the newest snapshot through a held write and epoch replacement', async () => {
    const wait = held<ChatHistoryResult>(), started = held<void>()
    let first = true
    const h = harness(async () => { if (first) { first = false; started.resolve(); return wait.promise } return { status: 'ok' } })
    live(h.threads); const flushing = h.writer.flush(); await started.promise
    live(h.threads, 20); live(h.threads, 5, 'a', 'new'); live(h.threads, 30, 'b')
    wait.resolve({ status: 'ok' }); await flushing
    expect(h.writes().map(r => [r.serverId, r.snapshot.thread.epoch, r.snapshot.thread.version])).toEqual([
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
    expect(h.save.mock.calls.map(([r]) => r.operation)).toEqual(['replaceThread', 'replaceThread', 'removeConversation'])
    expect(h.threads.getState().snapshot('b', 'c')?.version).toBe(30)
    await h.writer.stop()
  })
  it.each([true, false])('unpair invalidates old work and preserves another host: success=%s', async removed => {
    const h = harness(); live(h.threads); live(h.threads, 10, 'a', 'e', 'offscreen'); live(h.threads, 20, 'b')
    const wait = held<ChatHistoryResult>(), task = readSavedTimeline({ threads: h.threads, read: () => wait.promise, log: () => {} }, 'a', 'unread')
    const settle = beginChatHistoryRemoval('a')
    await h.writer.flush(); expect(h.writes().map(r => r.serverId)).toEqual(['b'])
    settle(removed)
    wait.resolve({ status: 'stored', snapshot: saved({ ...h.threads.getState().snapshot('b', 'c')!, hostId: 'a', conversationId: 'unread' }) }); await task.done
    await h.writer.flush()
    expect(h.threads.getState().snapshot('a', 'offscreen') === null).toBe(removed)
    expect(h.threads.getState().snapshot('a', 'unread') === null).toBe(removed)
    if (removed) { live(h.threads, 5); await h.writer.flush(); expect(h.writes().at(-1)?.snapshot.thread.version).toBe(5) }
    expect(h.threads.getState().snapshot('b', 'c')?.version).toBe(20)
    await h.writer.stop()
  })
})
