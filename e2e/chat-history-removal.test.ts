import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore, selectExclusiveConversationIdsFor } from '../src/renderer/src/store/conversationListStore'
import { createConversationTimelineStore } from '../src/renderer/src/store/conversationTimelineStore'
import { createChatHistoryWriter } from '../src/renderer/src/store/chatHistoryWriter'
import { clearServerScopedState, serverScopedClearDeps } from '../src/renderer/src/clearServerScopedState'
import { runUnpairServer } from '../src/renderer/src/screens/settings/unpairServerAction'
import { createChatHistoryStore } from '../src/main/chatHistoryStore'
import { createSecureStore } from '../src/main/secureStore'
import type { ChatHistoryRequest, ChatHistoryResult } from '../src/shared/chatHistory'
import type { ConversationSummary } from '../src/shared/wire/types'

const row = (id: string): ConversationSummary => ({ id, name: id, cwd: '/', is_promoted: false,
  is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null })
function harness(write = async (_request: ChatHistoryRequest): Promise<ChatHistoryResult> => ({ status: 'ok' })) {
  const lists = createConversationListStore()
  let receipt: { type: string; serverId: string | null } | null = null
  const timelines = createConversationTimelineStore(undefined, () => receipt?.serverId)
  let scheduled: (() => void) | undefined
  const log = vi.fn()
  const save = vi.fn(write)
  const writer = createChatHistoryWriter({ lists, timelines, write: save, log,
    receipt: () => receipt, schedule: (run) => { scheduled = run; return () => { scheduled = undefined } } })
  const receive = (type: string, action: () => void, serverId: string | null = 'a') => {
    receipt = { type, serverId }
    try { action() } finally { receipt = null }
  }
  const list = (ids = ['chat'], serverId = 'a') => receive('conversationsReceived',
    () => lists.getState().setConversations(ids.map(row), serverId), serverId)
  const delta = (text: string, id = 'chat', serverId: string | null = 'a') => receive('assistantDelta',
    () => timelines.getState().dispatchFor(id, { type: 'assistantDelta', turnId: 'turn', seq: 0, text }), serverId)
  return { lists, timelines, writer, save, log, receive, list, delta, run: () => scheduled?.() }
}

describe('history removal across process stores', () => {
  it('forgets omitted held timelines before same-session re-pair and saves only fresh receipts', async () => {
    const blobs = new Map<string, Uint8Array>()
    const secureStore = createSecureStore({
      encryption: { isAvailable: () => true, encrypt: bytes => bytes.map(b => b ^ 173),
        decrypt: bytes => bytes.map(b => b ^ 173) },
      persistence: { read: async name => blobs.get(name) ?? null,
        write: async (name, bytes) => { blobs.set(name, bytes) },
        delete: async name => { blobs.delete(name) } }
    })
    const fresh = () => createChatHistoryStore({ secureStore, log: { event: () => {} } })
    const store = fresh()
    const h = harness(request => store.execute(request))
    try {
      h.list(['omitted'])
      h.delta('erased text', 'omitted')
      h.list([], 'a')
      h.list(['other'], 'b')
      h.delta('other host text', 'other', 'b')
      await h.writer.flush()
      const other = h.timelines.getState().timelines.get('other')
      const read = (serverId: string, conversationId: string) => fresh().execute({
        operation: 'readTimeline', serverId, conversationId })
      expect(await read('a', 'omitted')).toMatchObject({ status: 'stored' })
      expect(await runUnpairServer({
        unpairServer: async () => {
          expect(await store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual({ status: 'ok' })
          return { result: 'ok' }
        },
        refreshServers: async () => [{ serverId: 'b', relayUrl: 'wss://relay.invalid' }],
        onLastServerUnpaired: () => { throw new Error('Other host remains') },
        clearServerScopedState: serverId => clearServerScopedState({ ...serverScopedClearDeps,
          getDepartedConversationIds: id => selectExclusiveConversationIdsFor(id)(h.lists.getState()),
          clearConversationsFor: id => h.lists.getState().clearConversationsFor(id),
          clearTimelineFor: id => h.timelines.getState().clearTimelineFor(id),
          clearLastReadFor: () => {}, navigateToList: () => {}
        }, serverId)
      }, 'a')).toBe('ok')
      expect(await read('a', 'omitted')).toEqual({ status: 'missing' })
      expect(h.timelines.getState().timelines.get('other')).toBe(other)
      h.list(['omitted'])
      h.delta('fresh text', 'omitted')
      await h.writer.flush()
      expect(await read('a', 'omitted')).toMatchObject({ status: 'stored',
        snapshot: { items: [{ text: 'fresh text' }] } })
      expect(await read('b', 'other')).toMatchObject({ status: 'stored',
        snapshot: { items: [{ text: 'other host text' }] } })
    } finally { await h.writer.stop() }
  })

})
