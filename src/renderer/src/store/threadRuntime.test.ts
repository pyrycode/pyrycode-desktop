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
  it('removal of a host with several live rows terminates and cannot be recreated by delayed readers', () => {
    const { runtime: r } = fixture()
    for (const host of ['one', 'two']) r.event(connected(host, true))
    r.summary('two', { id: 'alpha', current_session_id: 'B' })
    const rows = [['one', 'alpha'], ['one', 'gamma'], ['two', 'alpha']] as const
    const before = rows.map(([host, chat]) => r.live(host, chat))
    // Like the badge recount: every listed row is read on each runtime state change, departed ones included.
    let reads = 0
    const off = r.state.subscribe(() => {
      if (++reads > 100) throw new Error('re-entrant removal')
      for (const [host, chat] of rows) r.live(host, chat)
    })
    beginChatHistoryRemoval('one')(false)
    expect(rows.map(([host, chat]) => r.live(host, chat))).toEqual(before)
    beginChatHistoryRemoval('one')(true)
    expect(reads).toBeLessThan(100)
    const inert = r.live('one', 'alpha')
    expect(inert).not.toBe(before[0])
    expect(r.live('one', 'gamma')).toBe(inert)
    inert.getState().dispatch({ type: 'summary', serverId: 'one', summary: { id: 'alpha', current_session_id: 'late' } })
    expect(inert.getState().binding).toBeNull()
    expect(r.live('two', 'alpha')).toBe(before[2])
    expect(before[2].getState().binding?.sessionId).toBe('B')
    r.event({ type: 'disconnected', serverId: 'one' })
    expect(r.live('one', 'alpha')).toBe(inert)
    r.event(connected('one', true))
    const relinked = r.live('one', 'alpha')
    expect(relinked).not.toBe(inert)
    expect(r.live('one', 'alpha')).toBe(relinked)
    off(); r.dispose()
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
  it('folds an append burst on its first frame and orders controls after content', async () => {
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
    expect(publications).toBe(1)
    // Controls wait for a bounded scheduled drain, rather than flushing on receipt.
    append(3)
    r.event({ type: 'disconnected', serverId: 'one' })
    expect(text()).toBe('0,1,2,')
    callbacks.shift()!()
    expect(text()).toBe('0,1,2,3,')
    // Teardown cancels a scheduled frame and later callbacks change nothing.
    r.event(connected('one', true)); append(4)
    r.dispose()
    callbacks.forEach(callback => callback())
    off()
  })
  it('bounds each drain with paused frames and retires queued appends on suspend', async () => {
    vi.useFakeTimers()
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
    expect(text()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(text()).toHaveLength(128)
    await vi.advanceTimersByTimeAsync(50)
    expect(text()).toHaveLength(256)
    append(); append()
    r.suspend()
    await vi.advanceTimersByTimeAsync(100)
    expect(text()).toHaveLength(256)
    r.dispose()
    vi.useRealTimers()
  })
  it.each(['navigate', 'cancel', 'reset', 'delete', 'unpair', 'suspend', 'dispose'] as const)(
    'retires queued work and late callbacks on %s, including reused IDs on another host', async action => {
      vi.useFakeTimers()
      const callbacks: (() => void)[] = [], send = vi.fn()
      const r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }), log: vi.fn(),
        frame: { request: callback => callbacks.push(callback), cancel: () => {} } })
      try {
        r.event(connected('one', true)); r.event(connected('two', true))
        const opening = r.open('one', 'chat'); await opening.done
        r.items.getState().acceptEpoch('one', 'chat', 'e')
        r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat',
          correlation: { id: 1, ts: '' }, update: { type: 'thread_item_added', payload: {
            conversation_id: 'chat', epoch: 'e', version: 2, item: { id: 1, rev: 1, kind: 'assistant_message',
              shown: true, active: false, status: 'finished', summary: '', content: { text: 'departed' } } } } })
        if (action === 'navigate') await r.open('two', 'chat').done
        if (action === 'cancel') opening.cancel()
        if (action === 'reset') r.items.getState().acceptEpoch('one', 'chat', 'e', true)
        if (action === 'delete') {
          // Deletion is ordered, but content received after it cannot resurrect the owner.
          r.event({ type: 'conversationDeleted', serverId: 'one', id: 'chat' })
        }
        if (action === 'unpair') beginChatHistoryRemoval('one')(true)
        if (action === 'suspend') r.suspend()
        if (action === 'dispose') r.dispose()
        callbacks.forEach(callback => callback())
        await vi.advanceTimersByTimeAsync(200)
        expect(r.items.getState().snapshot('one', 'chat')?.items ?? []).toEqual([])
        expect(r.items.getState().snapshot('two', 'chat')?.items ?? []).toEqual([])
      } finally { r.dispose(); vi.useRealTimers() }
    })

  it.each([['reply', 'navigate'], ['reply', 'cancel-reopen'], ['failure', 'navigate'], ['failure', 'cancel-reopen']] as const)(
    'retires received %s bookkeeping on %s with paused frames', async (terminal, action) => {
      vi.useFakeTimers()
      const send = vi.fn(), callbacks: (() => void)[] = []
      const r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }), log: vi.fn(),
        frame: { request: callback => callbacks.push(callback), cancel: () => {} } })
      try {
        r.event(connected('one', true))
        const opening = r.open('one', 'A'); await opening.done
        const request = send.mock.calls[0][0]
        for (let id = 1; id <= 300; id++) r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'A',
          correlation: { id, ts: '' }, update: { type: 'thread_item_added', payload: { conversation_id: 'A', epoch: 'e', version: id,
            item: { id, rev: 1, kind: 'assistant_message', status: 'finished', shown: true, active: false, summary: '', content: {} } } } })
        if (terminal === 'reply') r.event({ type: 'threadReply', serverId: 'one', conversationId: 'A', requestId: request.requestId,
          correlation: { id: 301, ts: '' }, reply: { type: 'thread_items', payload: { conversation_id: 'A', epoch: 'e', version: 300,
            items: [], final: true, lower_order: 0, upper_order: 301, continuation: 0, older_exists: false } } })
        else r.event({ type: 'threadQueryFailed', serverId: 'one', conversationId: 'A', requestId: request.requestId,
          inReplyTo: 301, reason: 'expired' })
        expect(send).toHaveBeenCalledOnce()
        if (action === 'cancel-reopen') opening.cancel()
        const destination = action === 'navigate' ? 'B' : 'A'
        await r.open('one', destination).done
        expect(send).toHaveBeenCalledTimes(2)
        expect(send.mock.calls[1][0]).toMatchObject({ query: { payload: { conversation_id: destination, version: 0 } } })
        callbacks.forEach(callback => callback())
        await vi.advanceTimersByTimeAsync(29999)
        expect(send).toHaveBeenCalledTimes(2)
        expect(r.items.getState().snapshot('one', 'A')?.items ?? []).toEqual([])
        expect(r.state.getState().complete.size).toBe(0)
      } finally { r.dispose(); vi.useRealTimers() }
  })

  it('publishes each affected conversation and settles sends once per bounded drain before controls', async () => {
    vi.useFakeTimers()
    const send = vi.fn(), r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }),
      log: vi.fn(), frame: { request: () => 1, cancel: () => {} } })
    try {
      r.event(connected('one', true)); await r.open('one', 'chat').done
      const api = r.items.getState()
      api.acceptEpoch('one', 'chat', 'e'); api.acceptEpoch('one', 'other', 'e')
      const settle = vi.spyOn(r.sends.getState(), 'settle'), publications = vi.fn()
      const off = r.items.subscribe(publications)
      for (let id = 1; id <= 300; id++) r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat',
        correlation: { id, ts: '' }, update: { type: 'thread_item_added', payload: {
          conversation_id: 'chat', epoch: 'e', version: id, item: { id, rev: 1, kind: 'assistant_message',
            shown: true, active: false, status: 'finished', summary: '', content: { text: 'batch' } } } } })
      r.event({ type: 'disconnected', serverId: 'one' })
      expect(publications).not.toHaveBeenCalled()
      for (const size of [128, 256, 300]) {
        await vi.advanceTimersToNextTimerAsync()
        expect(api.snapshot('one', 'chat')?.items).toHaveLength(size)
        expect(r.state.getState().linked.has('one')).toBe(size < 300)
      }
      expect(publications).toHaveBeenCalledTimes(3)
      expect(settle).toHaveBeenCalledTimes(3) // the unrelated conversation never derives again
      off()
    } finally { r.dispose(); vi.useRealTimers() }
  })

  it('keeps questions, permissions and session replacement behind preceding content with paused frames', async () => {
    vi.useFakeTimers()
    const r = createThreadRuntime({ send: () => {}, read: async () => ({ status: 'missing' }), log: vi.fn(),
      frame: { request: () => 1, cancel: () => {} } })
    try {
      r.event(connected('one', true)); await r.open('one', 'chat').done
      r.summary('one', { id: 'chat', current_session_id: 'A' })
      r.items.getState().acceptEpoch('one', 'chat', 'e')
      const seen: number[] = [], live = r.live('one', 'chat')
      const off = live.subscribe(() => seen.push(r.items.getState().snapshot('one', 'chat')!.items.length))
      const notified: number[] = []
      const offEvents = r.subscribe(() => notified.push(r.items.getState().snapshot('one', 'chat')!.items.length))
      r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat', correlation: { id: 1, ts: '' },
        update: { type: 'thread_item_added', payload: { conversation_id: 'chat', epoch: 'e', version: 2,
          item: { id: 1, rev: 1, kind: 'assistant_message', status: 'finished', active: false,
            shown: true, summary: '', content: { text: 'preceding' } } } } })
      r.event({ type: 'questionShown', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'A',
        questionBatchId: 'q', questions: [{ question: 'Choose?', header: 'Choice', options: [{ label: 'First', description: '' }], multi_select: false }] })
      r.event({ type: 'modalShown', serverId: 'one', conversationId: 'chat', envelopeSessionId: 'A',
        modalId: 'p', class: 'permission', title: 'Permission', prompt: 'Run?', defaultOptionId: 'deny', options: [{ id: 'deny', label: 'Deny' }] })
      r.event({ type: 'conversationsReceived', serverId: 'one', conversations: [{ id: 'chat', current_session_id: 'B',
        name: null, cwd: '/', is_promoted: false, is_archived: false, workspace_label: null, last_used_at: '', last_message_ts: '' }] })
      expect(seen).toEqual([])
      await vi.advanceTimersByTimeAsync(50)
      expect(seen.length).toBeGreaterThanOrEqual(3)
      expect(seen.every(count => count === 1)).toBe(true)
      expect(notified).toEqual([1, 1, 1, 1])
      expect(live.getState().binding?.sessionId).toBe('B')
      off()
      offEvents()
    } finally { r.dispose(); vi.useRealTimers() }
  })

  it('orders a queued same-epoch reset and fences a late deletion from its replacement owner', async () => {
    vi.useFakeTimers()
    const send = vi.fn(), r = createThreadRuntime({ send, read: async () => ({ status: 'missing' }), log: vi.fn(),
      frame: { request: () => 1, cancel: () => {} } })
    try {
      r.event(connected('one', true)); await r.open('one', 'chat').done
      const api = r.items.getState(); api.acceptEpoch('one', 'chat', 'e')
      // Refresh the pending request so its generation is the current item owner.
      r.event(connected('one', true))
      const request = send.mock.calls.at(-1)![0]
      const add = (id: number) => r.event({ type: 'threadUpdate', serverId: 'one', conversationId: 'chat',
        correlation: { id, ts: '' }, update: { type: 'thread_item_added', payload: { conversation_id: 'chat', epoch: 'e',
          version: id, item: { id, rev: 1, kind: 'assistant_message', status: 'finished', active: false,
            shown: true, summary: '', content: { text: 'owner' } } } } })
      add(1)
      r.event({ type: 'threadReply', serverId: 'one', conversationId: 'chat', requestId: request.requestId,
        correlation: { id: 2, ts: '' }, reply: { type: 'thread_reset', payload: {
          conversation_id: 'chat', epoch: 'e', version: 2 } } })
      add(3)
      await vi.advanceTimersByTimeAsync(50)
      expect(api.snapshot('one', 'chat')?.items.map(item => item.id)).toEqual([3])
      add(4)
      r.event({ type: 'conversationDeleted', serverId: 'one', id: 'chat' })
      api.acceptEpoch('one', 'chat', 'e', true)
      await vi.advanceTimersByTimeAsync(50)
      expect(api.snapshot('one', 'chat')?.items).toEqual([])
      expect(r.state.getState().linked.has('one')).toBe(true)
    } finally { r.dispose(); vi.useRealTimers() }
  })

  it('keeps offline authoritative display separate from current capability and resumes complete progress', async () => {
    const { runtime: r, read, send } = fixture()
    read.mockResolvedValue({ status: 'page', page: { partial: true, metadata: { hostId: 'one', conversationId: 'chat', epoch: 'saved', version: 12, checkpoint: 7,
      uncommittedVersion: 12, repair: null }, items: [], ranges: [], continuation: null } })
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
