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
  it('admits cloned owning lifecycle readings without enabling competing metadata writers', async () => {
    const { runtime: r } = fixture()
    r.event(connected('one', true)); r.event(connected('two', true))
    await r.open('one', 'chat').done
    r.summary('one', { id: 'chat', current_session_id: 'A' })
    const event: StampedDaemonEvent = { type: 'turnState', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'A', state: 'thinking' }
    r.event(event)
    expect(r.acceptsLifecycle({ ...event })).toBe(true)
    expect(r.acceptsSession({ ...event })).toBe(false)
    expect(r.acceptsLifecycle({ ...event, serverId: 'two' })).toBe(false)
    expect(r.acceptsLifecycle({ ...event, conversationId: 'other' })).toBe(false)
    const ack: StampedDaemonEvent = { type: 'sessionSettingsUpdated', serverId: 'one', envelopeSessionId: 'A', sessionId: 'A', changeId: 'change' }
    expect(r.acceptsLifecycle(ack)).toBe(true)
    r.summary('one', { id: 'chat', current_session_id: 'B' })
    expect(r.acceptsLifecycle({ ...event })).toBe(false)
    expect(r.acceptsLifecycle(ack)).toBe(false)
    r.dispose()
  })
  it('ends local send feedback only after the owning current-session error is admitted', () => {
    const { runtime: r } = fixture()
    r.event(connected('one', true)); r.summary('one', { id: 'chat', current_session_id: 'A' })
    r.sends.getState().retain('one', 'chat', 'device', { type: 'userText', text: 'pending', messageId: 'message' })
    const error: StampedDaemonEvent = { type: 'sessionError', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'old', code: 'session.blocked' }
    r.event(error)
    expect(r.sends.getState().select('one', 'chat').localSendPending).not.toBeNull()
    r.event({ ...error, envelopeSessionId: 'A' })
    expect(r.sends.getState().select('one', 'chat').localSendPending).toBeNull()
    expect(r.sends.getState().select('one', 'chat').pending).toHaveLength(1)
    r.dispose()
  })
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
    expect(r.state.getState().linked.has('one')).toBe(false)
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
  it('links only hosts with an accepted thread handshake and retires work when one is lost', async () => {
    const { runtime: r, send } = fixture()
    r.event(connected('one', true)); r.event(connected('two', false))
    expect(r.state.getState().linked).toEqual(new Set(['one']))
    await r.open('two', 'chat').done
    // An update-required host is still drawn through the item view, but nothing is requested from it.
    expect(r.isThread('two', 'chat')).toBe(true)
    expect(send).not.toHaveBeenCalled()
    await r.open('one', 'chat').done
    expect(send.mock.calls[0][0]).toMatchObject({ serverId: 'one', query: { type: 'thread_catch_up' } })
    const request = send.mock.calls[0][0]
    r.event({ type: 'failed', serverId: 'one', cause: 'daemon',
      error: { code: 'update-required', message: 'daemon', retryable: true } })
    r.event({ type: 'threadReply', serverId: 'one', conversationId: 'chat', requestId: request.requestId,
      correlation: { id: 1, ts: '2026-10-15T00:00:00Z' },
      reply: { type: 'thread_items', payload: { conversation_id: 'chat', epoch: 'late', version: 10,
        items: [], final: true, lower_order: 0, upper_order: 10, continuation: 0, older_exists: false } } })
    expect(r.items.getState().snapshot('one', 'chat')).toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    // A later accepted handshake with `thread` clears the state and loads the thread.
    r.event(connected('one', true))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toMatchObject({ serverId: 'one', query: { type: 'thread_catch_up' } })
    r.dispose()
  })
  it('defers an uninterrupted append burst to the next frame and flushes it before any other event', async () => {
    const callbacks: (() => void)[] = []
    const frame = { request: vi.fn((callback: () => void) => callbacks.push(callback)), cancel: vi.fn() }
    const send = vi.fn()
    const r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }), log: vi.fn(), frame })
    r.event(connected('one', true))
    await r.open('one', 'chat').done
    const request = send.mock.calls[0][0]
    const reply = (payload: object) => r.event({ type: 'threadReply', serverId: 'one', conversationId: 'chat',
      requestId: request.requestId, correlation: { id: 1, ts: '2026-10-15T00:00:00Z' }, reply: payload as never })
    reply({ type: 'thread_items', payload: { conversation_id: 'chat', epoch: 'e', version: 1, final: false,
      items: [{ id: 1, rev: 1, order: 1, kind: 'assistant_message', status: 'running', active: true, shown: true,
        summary: '', content: { text: '' } }] } })
    reply({ type: 'thread_items', payload: { conversation_id: 'chat', epoch: 'e', version: 1, items: [], final: true,
      lower_order: 0, upper_order: 1, continuation: 0, older_exists: false } })
    const text = () => (r.items.getState().snapshot('one', 'chat')!.items[0].content as { text: string }).text
    let publications = 0
    const off = r.items.subscribe(() => { publications++ })
    const append = (seq: number) => r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat',
      correlation: { id: 2, ts: '2026-10-15T00:00:00Z' }, update: { type: 'thread_text_append', payload: {
        conversation_id: 'chat', epoch: 'e', version: seq + 2, item_id: 1, base_rev: seq + 1, rev: seq + 2, text: `${seq},` } } })
    for (let seq = 0; seq < 3; seq++) append(seq)
    expect(frame.request).toHaveBeenCalledOnce()
    expect(publications).toBe(0)
    callbacks.shift()!()
    expect(text()).toBe('0,1,2,')
    expect(publications).toBe(3)
    // A boundary event applies earlier pending appends first and cancels their frame.
    append(3)
    r.event({ type: 'disconnected', serverId: 'one' })
    expect(text()).toBe('0,1,2,3,')
    expect(frame.cancel).toHaveBeenCalledOnce()
    // Teardown cancels a scheduled frame and later callbacks change nothing.
    r.event(connected('one', true)); append(4)
    r.dispose()
    expect(frame.cancel).toHaveBeenCalledTimes(2)
    callbacks.forEach(callback => callback())
    off()
  })
  it('applies held appends on suspend and on a burst long enough to outlast paused frames', async () => {
    const frame = { request: vi.fn(() => 1), cancel: vi.fn() }
    const send = vi.fn()
    const r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }), log: vi.fn(), frame })
    r.event(connected('one', true))
    await r.open('one', 'chat').done
    const request = send.mock.calls[0][0]
    for (const payload of [{ version: 1, final: false, items: [{ id: 1, rev: 1, order: 1, kind: 'assistant_message',
      status: 'running', active: true, shown: true, summary: '', content: { text: '' } }] },
    { version: 1, items: [], final: true, lower_order: 0, upper_order: 1, continuation: 0, older_exists: false }])
      r.event({ type: 'threadReply', serverId: 'one', conversationId: 'chat', requestId: request.requestId,
        correlation: { id: 1, ts: '2026-10-15T00:00:00Z' }, reply: { type: 'thread_items', payload: { conversation_id: 'chat', epoch: 'e', ...payload } } as never })
    let rev = 1
    const append = () => r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat',
      correlation: { id: 2, ts: '2026-10-15T00:00:00Z' }, update: { type: 'thread_text_append', payload: {
        conversation_id: 'chat', epoch: 'e', version: rev + 1, item_id: 1, base_rev: rev, rev: ++rev, text: 'x' } } })
    const text = () => (r.items.getState().snapshot('one', 'chat')!.items[0].content as { text: string }).text
    for (let i = 0; i < 255; i++) append()
    expect(text()).toBe('')
    append()
    expect(text()).toHaveLength(256)
    append(); append()
    r.suspend()
    expect(text()).toHaveLength(258)
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

it('revalidates withdrawn configuration once per bound session and opening', async () => {
  const { runtime: r, send } = fixture()
  r.event(connected('one', true)); r.event(connected('two', true))
  r.summary('one', { id: 'chat', current_session_id: 'A' })
  await r.open('one', 'chat').done
  const vocabulary: StampedDaemonEvent = { type: 'modelList', serverId: 'one', conversationId: 'chat',
    envelopeConversationId: 'chat', envelopeSessionId: 'bootstrap', models: [], droppedModels: 0 }
  const settings: StampedDaemonEvent = { type: 'runConfigReceived', serverId: 'one', conversationId: 'chat',
    envelopeConversationId: 'chat', envelopeSessionId: 'A', sessionId: 'A', model: '', effort: '', yolo: false,
    permissionMode: '', used_tokens: 0, window_tokens: 0 }
  const clear: StampedDaemonEvent = { type: 'sessionStateCleared', family: 'session_settings', correlation: { id: 8, ts: '' },
    serverId: 'one', envelopeConversationId: 'chat', envelopeSessionId: 'A' }
  const requests = () => send.mock.calls.filter(([command]) => command.type === 'requestModelList' || command.type === 'requestSessionSettings')
  r.event(vocabulary); r.event(settings)
  r.event({ ...clear, serverId: 'two' })
  r.event({ ...clear, envelopeConversationId: 'other' })
  expect(requests()).toHaveLength(0)
  r.event(clear)
  expect(requests()).toEqual(['requestSessionSettings', 'requestModelList'].map(type => [{ type, serverId: 'one', payload: { conversation_id: 'chat' } }]))
  r.event(settings); r.event(clear)
  expect(requests()).toHaveLength(2)
  r.event(settings)
  await r.open('one', 'chat').done
  r.event(clear)
  expect(requests()).toHaveLength(4)
  r.dispose()
})
