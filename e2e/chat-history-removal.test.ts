import { describe, expect, it, vi } from 'vitest'
import { createConversationListStore, selectExclusiveConversationIdsFor } from '../src/renderer/src/store/conversationListStore'
import { createConversationTimelineStore } from '../src/renderer/src/store/conversationTimelineStore'
import { createChatHistoryWriter } from '../src/renderer/src/store/chatHistoryWriter'
import { clearServerScopedState, serverScopedClearDeps } from '../src/renderer/src/clearServerScopedState'
import { runUnpairServer } from '../src/renderer/src/screens/settings/unpairServerAction'
import { createChatHistoryStore } from '../src/main/chatHistoryStore'
import { createSecureStore } from '../src/main/secureStore'
import type { ChatHistoryRequest, ChatHistoryResult } from '../src/shared/chatHistory'
import type { StampedDaemonEvent } from '../src/shared/ipc/events'
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
  let listener: (event: StampedDaemonEvent) => void = () => {}
  const writer = createChatHistoryWriter({ lists, timelines, write: save, log,
    subscribeEvents: onEvent => { listener = onEvent; return () => { listener = () => {} } },
    receipt: () => receipt, schedule: (run) => { scheduled = run; return () => { scheduled = undefined } } })
  const receive = (type: string, action: () => void, serverId: string | null = 'a') => {
    receipt = { type, serverId }
    try { action() } finally { receipt = null }
  }
  const list = (ids = ['chat'], serverId = 'a') => receive('conversationsReceived',
    () => lists.getState().setConversations(ids.map(row), serverId), serverId)
  const delta = (text: string, id = 'chat', serverId: string | null = 'a') => receive('assistantDelta',
    () => timelines.getState().dispatchFor(id, { type: 'assistantDelta', turnId: 'turn', seq: 0, text }), serverId)
  return { lists, timelines, writer, save, log, receive, list, delta,
    deleted: (id: string, serverId = 'a') => listener({ type: 'conversationDeleted', id, serverId }), run: () => scheduled?.() }
}

describe('history removal across process stores', () => {
  it.each(['buffered', 'list', 'timeline'])('orders deletion after %s saves and through shutdown', async heldOperation => {
    const blobs = new Map<string, Uint8Array>()
    let hold = false
    let entered = false
    let release = () => {}
    const barrier = new Promise<void>(resolve => { release = resolve })
    const secureStore = createSecureStore({
      encryption: { isAvailable: () => true, encrypt: bytes => bytes.map(b => b ^ 173),
        decrypt: bytes => bytes.map(b => b ^ 173) },
      persistence: { read: async name => blobs.get(name) ?? null,
        write: async (name, bytes) => {
          if (hold) { hold = false; entered = true; await barrier }
          blobs.set(name, bytes)
        }, delete: async name => { blobs.delete(name) } }
    })
    const fresh = () => createChatHistoryStore({ secureStore, log: { event: () => {} } })
    const store = fresh()
    const h = harness(request => store.execute(request))
    const read = (serverId: string, conversationId: string) => fresh().execute({
      operation: 'readTimeline', serverId, conversationId })
    try {
      h.list(['chat', 'peer'])
      h.delta('target')
      h.delta('same-host peer', 'peer')
      await h.writer.flush()
      h.timelines.getState().clearAllTimelines()
      h.lists.getState().clearAllConversations()
      h.list(['chat'], 'b')
      h.delta('equal id on other host', 'chat', 'b')
      await h.writer.flush()
      h.timelines.getState().clearAllTimelines()
      h.lists.getState().clearAllConversations()
      h.list(['chat', 'peer'])
      await h.writer.flush()
      if (heldOperation === 'list') h.list(['peer', 'chat'])
      else h.delta('old buffered tail')
      hold = heldOperation !== 'buffered'
      const flushing = heldOperation === 'buffered' ? Promise.resolve() : h.writer.flush()
      if (heldOperation !== 'buffered') await vi.waitFor(() => expect(entered).toBe(true))
      h.delta(' newer buffered tail')
      h.list(['chat', 'peer'])
      h.deleted('chat')
      // Retained holder mutations and late refreshes must not resurrect deleted content.
      h.delta(' late tail')
      h.list(['chat', 'peer'])
      let stopped = false
      const stopping = h.writer.stop().then(() => { stopped = true })
      if (heldOperation !== 'buffered') {
        await Promise.resolve()
        expect(stopped).toBe(false)
        expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
      }
      release()
      await Promise.all([flushing, stopping])
      expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
      expect(await read('a', 'chat')).toEqual({ status: 'missing' })
      expect(await fresh().execute({ operation: 'readList', serverId: 'a' })).toMatchObject({
        status: 'stored', snapshot: { conversations: [row('peer')] } })
      expect(await read('a', 'peer')).toMatchObject({ status: 'stored', snapshot: { items: [{ text: 'same-host peer' }] } })
      expect(await read('b', 'chat')).toMatchObject({ status: 'stored', snapshot: { items: [{ text: 'equal id on other host' }] } })
    } finally { release(); await h.writer.stop() }
  })

  it.each([false, true])('removes an omitted, evicted timeline only on confirmation (storage failure=%s)', async failRemoval => {
    const blobs = new Map<string, Uint8Array>()
    let fail = false
    const secureStore = createSecureStore({
      encryption: { isAvailable: () => true, encrypt: bytes => bytes.map(b => b ^ 173), decrypt: bytes => bytes.map(b => b ^ 173) },
      persistence: { read: async name => blobs.get(name) ?? null,
        write: async (name, bytes) => { if (fail) throw new Error('private storage detail'); blobs.set(name, bytes) },
        delete: async name => { if (fail) throw new Error('private storage detail'); blobs.delete(name) } }
    })
    const fresh = () => createChatHistoryStore({ secureStore, log: { event: () => {} } })
    const store = fresh()
    const h = harness(request => store.execute(request))
    const read = () => fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })
    h.list(['chat', 'peer'])
    h.delta('saved despite omission')
    await h.writer.flush()
    h.list(['peer'])
    h.receive('error', () => {})
    h.receive('disconnected', () => {})
    for (let i = 0; i < 11; i++) h.timelines.getState().markViewed(String(i))
    h.lists.getState().clearAllConversations()
    await h.writer.flush()
    expect(h.timelines.getState().timelines.has('chat')).toBe(false)
    expect(await read()).toMatchObject({ status: 'stored' })
    h.list([])
    await h.writer.flush()
    expect(await read()).toMatchObject({ status: 'stored' })
    fail = failRemoval
    h.deleted('chat')
    await h.writer.flush()
    if (failRemoval) {
      expect(await read()).toMatchObject({ status: 'stored' })
      expect(h.log).toHaveBeenCalledWith({ event: 'history-writer-result', code: 'remove-failed' })
      expect(h.log).not.toHaveBeenCalledWith({ event: 'history-writer-result', code: 'conversation-removed' })
      expect(JSON.stringify(h.log.mock.calls)).not.toContain('private')
      fail = false
      h.deleted('chat')
    }
    await h.writer.stop()
    expect(await read()).toEqual({ status: 'missing' })
  })

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
