import { expect, it, vi } from 'vitest'
import { createThreadRuntime } from './threadRuntime'

it('compact presentation exposes admitted roots without borrowing retained complete evidence', async () => {
  const sent: any[] = [], read = vi.fn(async () => ({ status: 'missing' as const }))
  const runtime = createThreadRuntime({ send: command => sent.push(command), read, log() {} })
  runtime.event({ type: 'connected', serverId: 'host', ack: { protocol_version: 'v2', server_id: 'host', conn_id: 'one',
    capabilities: ['interactive', 'thread', 'thread_expansion', 'thread_compact'] } })
  runtime.items.getState().acceptEpoch('host', 'chat', 'epoch')
  const batch = runtime.items.getState().beginBatch('host', 'chat', 'epoch')!
  batch.applyItems([{ id: 99, kind: 'assistant_message', rev: 1, order: 99, active: false, shown: true,
    status: 'done', summary: '', content: { text: 'Retained complete' } }], 100)
  batch.commit({ fromVersion: 0, version: 100, ranges: [{ start: 0, end: 100 }] })
  runtime.open('host', 'chat', { projection: 'compact-v1' })
  expect(runtime.compact.state.getState().pending.get('host')).toBe('chat')
  const request = sent.find(command => command.type === 'queryThread')
  runtime.event({ type: 'threadReply', serverId: 'host', conversationId: 'chat', requestId: request.requestId, correlation: { id: 1, ts: '', in_reply_to: 1 },
    reply: { type: 'thread_items', payload: { projection: 'compact-v1', conversation_id: 'chat', epoch: 'epoch', version: 101,
      items: [{ id: 1, kind: 'assistant_message', rev: 1, order: 1, active: false, shown: true,
        status: 'done', summary: '', content: { text: 'Compact root' } }], final: false } } })
  expect(runtime.presentation('host', 'chat')?.items.map(item => item.id)).toEqual([1])
  expect(runtime.presentation('host', 'chat')?.checkpoint).toBe(0)
  expect(runtime.items.getState().snapshot('host', 'chat')?.checkpoint).toBe(100)
  expect(read).not.toHaveBeenCalled()
  runtime.event({ type: 'threadReply', serverId: 'host', conversationId: 'chat', requestId: request.requestId,
    correlation: { id: 2, ts: '', in_reply_to: 1 }, reply: { type: 'thread_items', payload: {
      projection: 'compact-v1', conversation_id: 'chat', epoch: 'epoch', version: 101, items: [], final: true,
      lower_order: 0, upper_order: 2, continuation: 0, older_exists: false } } })
  expect(runtime.compact.state.getState().pending.has('host')).toBe(false)
  expect(runtime.compact.snapshot('host', 'chat')?.checkpoint).toBe(101)
  expect(runtime.presentation('host', 'chat')?.checkpoint).toBe(0)
  runtime.dispose()
})

it('selects only the owning accepted handshake before issuing recovery queries', async () => {
  const sent: any[] = [], runtime = createThreadRuntime({ send: command => sent.push(command),
    read: async () => ({ status: 'missing' }), log() {} })
  const connected = (host: string, capabilities: string[], owner = host) => runtime.event({ type: 'connected', serverId: host,
    ack: { protocol_version: 'v2', server_id: owner, conn_id: 'connection', capabilities } })
  const compact = ['interactive', 'thread', 'thread_expansion', 'thread_compact']
  connected('other', compact)
  const handle = runtime.open('host', 'chat', { projection: 'auto' })
  await handle.done
  expect(runtime.state.getState().selection?.projection).toBe('complete')
  connected('host', compact, 'other')
  expect(runtime.state.getState().selection?.projection).toBe('complete')
  runtime.event({ type: 'disconnected', serverId: 'host' })
  sent.length = 0
  connected('host', compact)
  expect(sent.filter(c => c.type === 'queryThread').map(c => c.query.payload.projection)).toEqual(['compact-v1'])
  runtime.event({ type: 'disconnected', serverId: 'host' })
  handle.cancel()
  const offline = runtime.open('host', 'chat', { projection: 'auto' })
  expect(runtime.state.getState().selection?.projection).toBe('compact-v1')
  connected('host', ['interactive', 'thread'])
  await Promise.resolve()
  expect(runtime.state.getState().selection?.projection).toBe('complete')
  offline.cancel()
  const count = sent.length
  connected('host', compact)
  expect(sent).toHaveLength(count)
  runtime.dispose()
})

it('requires each compact grant, and cancellation cannot close a replacement selection', async () => {
  const runtime = createThreadRuntime({ send() {}, read: async () => ({ status: 'missing' }), log() {} })
  const grants = ['interactive', 'thread', 'thread_expansion', 'thread_compact']
  for (const missing of grants) {
    runtime.event({ type: 'connected', serverId: 'host', ack: { protocol_version: 'v2', server_id: 'host', conn_id: missing,
      capabilities: grants.filter(grant => grant !== missing) } })
    const handle = runtime.open('host', 'chat', { projection: 'auto' })
    await handle.done
    expect(runtime.state.getState().selection?.projection).toBe('complete')
    handle.cancel()
  }
  const first = runtime.open('host', 'first'), second = runtime.open('host', 'second')
  const ownsSecond = runtime.submissionOwner('host', 'second')
  first.cancel()
  expect(ownsSecond()).toBe(true)
  expect(runtime.state.getState().selection?.chat).toBe('second')
  second.cancel()
  expect(ownsSecond()).toBe(false)
  runtime.dispose()
})
