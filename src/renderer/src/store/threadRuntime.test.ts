import { describe, expect, it, vi } from 'vitest'
import { createThreadRuntime } from './threadRuntime'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import type { ChatHistoryResult } from '@shared/chatHistory'

const connected = (serverId: string, thread: boolean): StampedDaemonEvent => ({ type: 'connected', serverId,
  ack: { protocol_version: 'v2', server_id: serverId, conn_id: 'connection', capabilities: thread ? ['interactive', 'thread'] : [] } })
function fixture() {
  const send = vi.fn(), read = vi.fn(async (): Promise<ChatHistoryResult> => ({ status: 'missing' }))
  const runtime = createThreadRuntime({ send, read, log: vi.fn() })
  return { runtime, send, read }
}
describe('production thread composition', () => {
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
