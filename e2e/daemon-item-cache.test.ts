import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore } from '../src/main/secureStore'
import { fileSecretPersistence } from '../src/main/fileSecretPersistence'
import { createChatHistoryStore } from '../src/main/chatHistoryStore'
import { createThreadItemStore } from '../src/renderer/src/store/threadItemStore'
import { createChatHistoryWriter } from '../src/renderer/src/store/chatHistoryWriter'
import { createConversationListStore } from '../src/renderer/src/store/conversationListStore'
import { createConversationTimelineStore } from '../src/renderer/src/store/conversationTimelineStore'
import { readSavedTimeline } from '../src/renderer/src/store/savedTimelineRestorer'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function cache() {
  const root = await mkdtemp(join(tmpdir(), 'thread-restart-')); roots.push(root)
  const fresh = () => createChatHistoryStore({ log: { event: () => {} }, secureStore: createSecureStore({
    persistence: fileSecretPersistence(root), encryption: { isAvailable: () => true,
      encrypt: bytes => bytes.map(b => b ^ 173), decrypt: bytes => bytes.map(b => b ^ 173) } }) })
  const storage = fresh(), source = createThreadItemStore(), api = source.getState()
  const writer = createChatHistoryWriter({ threads: source, lists: createConversationListStore(),
    timelines: createConversationTimelineStore(), receipt: () => null, log: () => {},
    write: request => storage.execute(request), schedule: () => () => {} })
  return { fresh, source, api, writer }
}

it.each([false, true])('protected writer-to-offline-store restart retains completion=%s', async complete => {
  const { fresh, api, writer } = await cache()
  try {
    for (const host of ['a', 'b']) {
      api.acceptEpoch(host, 'c', 'e')
      const batch = api.beginBatch(host, 'c', 'e')!
      batch.applyItems([{ id: 1, rev: 10, kind: 'assistant_message', order: 1, active: false, shown: false,
        status: 'future', summary: '', content: JSON.parse('{"text":"hello","__proto__":null}'), agent: 'codex' }], 10)
      if (complete) batch.commit({ fromVersion: 0, version: 10, ranges: [{ start: 1, end: 10 }], olderAvailable: false })
      else batch.abandon()
      api.applyUpdate(host, { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
        version: 20, item_id: 1, base_rev: 10, rev: 20, changes: { agent: null, parent: null } } })
    }
    await writer.stop()
    const target = createThreadItemStore(), afterRestart = fresh()
    for (const host of ['a', 'b']) await readSavedTimeline({ threads: target,
      read: request => afterRestart.execute(request), log: () => {} }, host, 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    expect(target.getState().snapshot('b', 'c')).toEqual(api.snapshot('b', 'c'))
    const restored = target.getState().snapshot('a', 'c')!
    expect(restored.items[0]).toMatchObject({ shown: false, agent: null, parent: null })
    expect(Object.hasOwn(restored.items[0].content as object, '__proto__')).toBe(true)
    expect(Object.isFrozen(restored.items[0].content)).toBe(true)
    target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 30, item_id: 1, base_rev: 20, rev: 30, text: '!' } })
    expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(complete ? 30 : 0)
    if (!complete) {
      target.getState().beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 10, ranges: [] })
      target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
        version: 40, item_id: 1, base_rev: 30, rev: 40, text: '?' } })
      expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(40)
    }
    expect(target.getState().snapshot('b', 'c')?.items[0].rev).toBe(20)
  } finally { await writer.stop() }
})

it.each([50, 100])('saves live success after abandoning a batch already covered through %s', async batchVersion => {
  const { fresh, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    api.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 100,
      item: { id: 1, rev: 100, kind: 'assistant_message', active: false, shown: true, status: 'done', summary: '', content: { text: 'first' } } } })
    await writer.flush()
    const batch = api.beginBatch('a', 'c', 'e')!
    batch.applyItems([{ id: 1, rev: batchVersion, kind: 'assistant_message', active: false, shown: true,
      status: 'done', summary: '', content: { text: 'old' } }], batchVersion)
    batch.abandon()
    await writer.flush()
    const savedBatch = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
    const batchSnapshot = api.snapshot('a', 'c')
    api.applyUpdate('a', { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
      version: 200, item_id: 1, base_rev: 100, rev: 200, changes: { content: { text: 'newest' } } } })
    await writer.flush()
    const target = createThreadItemStore(), afterRestart = fresh()
    await readSavedTimeline({ threads: target, read: request => afterRestart.execute(request), log: () => {} }, 'a', 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    expect(savedBatch).toMatchObject({ status: 'stored', snapshot: { thread: batchSnapshot } })
    expect(target.getState().snapshot('a', 'c')).toMatchObject({ checkpoint: 200, uncommittedVersion: batchVersion,
      items: [{ rev: 200, content: { text: 'newest' } }] })
    target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 300, item_id: 1, base_rev: 200, rev: 300, text: '!' } })
    expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(300)
  } finally { await writer.stop() }
})

it('restart preserves first-arrival ties after order changes and clears', async () => {
  const { fresh, source, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    for (const [id, order] of [[1, 20], [2, 10]]) api.applyUpdate('a', {
      type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: id,
        item: { id, rev: 1, kind: 'assistant_message', order, active: false, shown: true,
          status: 'done', summary: '', content: { text: String(id) } } } })
    expect(api.snapshot('a', 'c')?.items.map(item => item.id)).toEqual([2, 1])
    await writer.flush()
    const target = createThreadItemStore(), afterRestart = fresh()
    await readSavedTimeline({ threads: target, read: request => afterRestart.execute(request), log: () => {} }, 'a', 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    for (const store of [source, target]) {
      store.getState().applyUpdate('a', { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
        version: 3, item_id: 1, base_rev: 1, rev: 2, changes: { order: 10 } } })
      expect(store.getState().snapshot('a', 'c')?.items.map(item => item.id)).toEqual([1, 2])
      for (const [id, rev] of [[1, 2], [2, 1]]) store.getState().applyUpdate('a', {
        type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e', version: id + 3,
          item_id: id, base_rev: rev, rev: rev + 1, changes: { order: null } } })
      expect(store.getState().snapshot('a', 'c')?.items.map(item => item.id)).toEqual([1, 2])
    }
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
  } finally { await writer.stop() }
})
