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

it.each([false, true])('protected writer-to-offline-store restart retains completion=%s', async complete => {
  const root = await mkdtemp(join(tmpdir(), 'thread-restart-')); roots.push(root)
  const fresh = () => createChatHistoryStore({ log: { event: () => {} }, secureStore: createSecureStore({
    persistence: fileSecretPersistence(root), encryption: { isAvailable: () => true,
      encrypt: bytes => bytes.map(b => b ^ 173), decrypt: bytes => bytes.map(b => b ^ 173) } }) })
  const storage = fresh(), source = createThreadItemStore(), api = source.getState()
  const writer = createChatHistoryWriter({ threads: source, lists: createConversationListStore(),
    timelines: createConversationTimelineStore(), receipt: () => null, log: () => {},
    write: request => storage.execute(request), schedule: () => () => {} })
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
