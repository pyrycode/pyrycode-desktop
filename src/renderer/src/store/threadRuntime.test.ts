import { describe, expect, it, vi } from 'vitest'
import { createThreadRuntime } from './threadRuntime'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ChatHistoryResult } from '@shared/chatHistory'
import { beginChatHistoryRemoval } from './chatHistoryRemoval'
import { connectThreadLiveProjection } from './threadLiveProjection'
import { activeConversationStore } from './activeConversationStore'
import { modelListStore } from './modelListStore'

const connected = (serverId: string, thread: boolean): StampedDaemonEvent => ({ type: 'connected', serverId,
  ack: { protocol_version: 'v2', server_id: serverId, conn_id: 'connection', capabilities: thread ? ['interactive', 'thread'] : [] } })
function fixture() {
  const send = vi.fn(), read = vi.fn(async (): Promise<ChatHistoryResult> => ({ status: 'missing' }))
  const runtime = createThreadRuntime({ send, read, log: vi.fn() })
  return { runtime, send, read }
}
describe('production thread composition', () => {
  it('successful removal cancels empty-scope work and forgets every pairing-owned adapter', async () => {
    const { runtime: r, send } = fixture()
    r.event(connected('one', true))
    await r.open('one', 'empty').done
    const request = send.mock.calls.at(-1)![0]
    r.summary('one', { id: 'empty', current_session_id: 'A' })
    const live = r.live('one', 'empty')
    r.sends.getState().retain('one', 'empty', 'device', { type: 'userText', text: 'pending', messageId: 'message' })
    beginChatHistoryRemoval('one')(false)
    r.event({ type: 'failed', serverId: 'one', error: { code: 'unpair', message: 'Could not forget this pairing.', retryable: false } })
    expect(r.isThread('one', 'empty')).toBe(true)
    expect(live.getState().binding?.sessionId).toBe('A')
    beginChatHistoryRemoval('one')(true)
    expect(live.getState().binding).toBeNull()
    expect(r.sends.getState().select('one', 'empty').pending).toHaveLength(0)
    expect(r.state.getState().routes.has('one')).toBe(false)
    expect(r.state.getState().queries.size).toBe(0)
    r.event(connected('one', true))
    r.event({ type: 'threadReply', serverId: 'one', conversationId: 'empty', requestId: request.requestId,
      correlation: { id: 1, ts: '2026-10-15T00:00:00Z' }, reply: { type: 'thread_items', payload: {
        conversation_id: 'empty', epoch: 'departed', version: 1, items: [], final: true,
        lower_order: 0, upper_order: 1, continuation: 0, older_exists: false } } })
    expect(r.items.getState().snapshot('one', 'empty')).toBeNull()
    expect(r.live('one', 'empty').getState().binding).toBeNull()
    r.dispose()
  })
  it('authoritative metadata has one selected-host projection rather than parallel legacy writers', () => {
    const { runtime: r } = fixture()
    for (const host of ['one', 'two']) {
      r.event(connected(host, true)); r.summary(host, { id: 'chat', current_session_id: 'A' })
      expect(r.acceptsSession({ type: 'modelList', serverId: host, conversationId: 'chat',
        envelopeSessionId: 'A', models: [], droppedModels: 0 })).toBe(false)
    }
    r.dispose()
  })
  it('projects the selected host and switches reused IDs without an offscreen writer winning', () => {
    const { runtime: r } = fixture()
    const choose = (serverId: string) => {
      const row = { id: 'chat', serverId, name: null, cwd: '/', is_promoted: false, workspace_label: null, last_used_at: '' }
      activeConversationStore.getState().setActiveConversation(row)
    }
    const off = connectThreadLiveProjection(r)
    for (const host of ['one', 'two']) {
      r.event(connected(host, true)); r.summary(host, { id: 'chat', current_session_id: 'A' })
    }
    choose('two')
    const event = (serverId: string, droppedModels: number): StampedDaemonEvent => ({ type: 'modelList', serverId,
      conversationId: 'chat', envelopeSessionId: 'A', models: [], droppedModels })
    r.event(event('two', 2))
    const selected = modelListStore.getState().lists.get('chat')
    expect(selected?.droppedModels).toBe(2)
    r.event(event('one', 1))
    expect(modelListStore.getState().lists.get('chat')).toBe(selected)
    choose('one')
    expect(modelListStore.getState().lists.get('chat')?.droppedModels).toBe(1)
    beginChatHistoryRemoval('one')(true)
    expect(modelListStore.getState().lists.has('chat')).toBe(false)
    off(); r.dispose(); activeConversationStore.getState().clearActiveConversation()
  })
  it('selects each negotiated host independently and retires work on downgrade', async () => {
    const { runtime: r, send } = fixture()
    r.event(connected('one', true)); r.event(connected('two', false))
    await r.open('one', 'chat').done
    expect(r.isThread('one', 'chat')).toBe(true)
    expect(r.isThread('two', 'chat')).toBe(false)
    expect(send.mock.calls[0][0].query.type).toBe('thread_catch_up')
    const request = send.mock.calls[0][0]
    r.event(connected('one', false))
    r.event({ type: 'threadReply', serverId: 'one', conversationId: 'chat', requestId: request.requestId,
      correlation: { id: 1, ts: '2026-10-15T00:00:00Z' },
      reply: { type: 'thread_items', payload: { conversation_id: 'chat', epoch: 'late', version: 10,
        items: [], final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false } } })
    expect(r.items.getState().snapshot('one', 'chat')).toBeNull()
    expect(r.isThread('one', 'chat')).toBe(false)
    r.dispose()
  })
  it('keeps offline authoritative display separate from current capability and resumes complete progress', async () => {
    const { runtime: r, read, send } = fixture()
    read.mockResolvedValue({ status: 'stored', snapshot: { version: 1, kind: 'daemon-items', serverId: 'one', conversationId: 'chat',
      thread: { hostId: 'one', conversationId: 'chat', epoch: 'saved', version: 12, checkpoint: 7,
        uncommittedVersion: 12, items: [], ranges: [], repair: null } } })
    await r.open('one', 'chat').done
    expect(r.isThread('one', 'chat')).toBe(true)
    expect(send).not.toHaveBeenCalled()
    r.event(connected('one', true))
    await Promise.resolve()
    expect(send.mock.calls.at(-1)?.[0].query.payload).toMatchObject({ epoch: 'saved', version: 7 })
    r.dispose()
  })
  it('binds live state only from owning summaries and rejects an old session', () => {
    const { runtime: r } = fixture()
    r.event(connected('one', true))
    r.summary('one', { id: 'chat', current_session_id: 'A' })
    const live = r.live('one', 'chat')
    r.event({ type: 'turnState', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'A', state: 'thinking' })
    expect(live.getState().readings.size).toBe(1)
    r.summary('one', { id: 'chat', current_session_id: 'B' })
    r.event({ type: 'turnState', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'A', state: 'responding' })
    expect(live.getState().readings.size).toBe(0)
    r.dispose()
  })
})
