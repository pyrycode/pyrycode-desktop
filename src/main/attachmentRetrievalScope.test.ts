import { expect, it } from 'vitest'
import { createAttachmentRetrieval } from './attachmentRetrieval'
import { createConversationRouter } from './conversationRouter'
import { createServerRouter } from './serverRouter'
import type { AttachmentRetrievalConsumer } from './daemonConnection'
import { isAttachmentRetrievalRequest, type AttachmentRetrievalEvent, type AttachmentRetrievalRequest } from '../shared/ipc/attachmentRetrieval'
import type { RequestAttachmentPayload } from '../shared/wire/types'
import type { StoreAttachmentResult } from './attachmentStore'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../shared/ipc/events'

const drain = () => new Promise<void>(resolve => setImmediate(resolve))
function harness(store = async (): Promise<StoreAttachmentResult> => ({ ok: true, path: '/private/path' })) {
  const sends: { host: string; payload: RequestAttachmentPayload; consumer: AttachmentRetrievalConsumer }[] = []
  const connection = (host: string) => ({ requestAttachment: (payload: RequestAttachmentPayload, consumer: AttachmentRetrievalConsumer) => {
    if (host === 'offline') consumer.fail('not-connected')
    else sends.push({ host, payload, consumer })
  } })
  const connections = new Map(['A', 'B', 'offline'].map(host => [host, connection(host)]))
  const connectionFor = (host: string) => connections.get(host) ?? null
  const servers = createServerRouter({ connectionFor, soleConnection: () => null })
  const router = createConversationRouter({ connectionFor })
  const observer = router.observe({ isDestroyed: () => false, webContents: { send: () => undefined } })
  for (const serverId of ['A', 'B']) {
    const event: StampedDaemonEvent = { type: 'conversationsReceived', serverId, conversations: [{
      id: 'listed', name: null, is_promoted: false, is_archived: false, cwd: '/workspace',
      last_message_ts: 'now', last_used_at: 'now', workspace_label: null
    }] }
    observer.webContents.send(DAEMON_EVENT_CHANNEL, event)
  }
  let resolves = 0
  const request = createAttachmentRetrieval({
    resolve: ask => { resolves++; return ask.serverId === undefined ? router.resolve(ask.conversationId) : servers.resolve(ask.serverId) }, store
  })
  const events: AttachmentRetrievalEvent[] = []
  const emit = (event: AttachmentRetrievalEvent) => events.push(event)
  const receive = (ask: unknown) => { if (isAttachmentRetrievalRequest(ask)) request(ask, emit) }
  return { request, receive, events, emit, sends, connections, resolves: () => resolves }
}
const ask = (serverId?: string, conversationId = 'unlisted'): AttachmentRetrievalRequest => ({ serverId, conversationId, attachmentId: 'same' })

it('drops malformed IPC before resolution, transport, storage or emission', () => {
  let writes = 0
  const h = harness(async () => { writes++; return { ok: true, path: 'private' } })
  for (const serverId of [null, false, '', 12, {}, 'x'.repeat(257)]) h.receive({ ...ask(), serverId })
  for (const field of ['conversationId', 'attachmentId']) h.receive({ ...ask('A'), [field]: null })
  h.receive(null)
  expect([h.resolves(), h.sends.length, writes, h.events.length]).toEqual([0, 0, 0, 0])
})
it('routes explicit unlisted and equal-ID conversations to their named owner with wire-only fields', () => {
  const h = harness()
  for (const host of ['A', 'B']) for (const chat of ['unlisted', 'listed']) h.request(ask(host, chat), h.emit)
  expect(h.sends.map(s => [s.host, s.payload])).toEqual(['A', 'B'].flatMap(host => ['unlisted', 'listed'].map(chat => [host, { conversation_id: chat, attachment_id: 'same' }])))
})
it('retains legacy routing/refusal and refuses unknown, unpaired and disconnected hosts without fallback', () => {
  const h = harness()
  h.request(ask(undefined, 'listed'), h.emit)
  expect(h.sends[0].host).toBe('B')
  for (const target of [ask(), ask('unknown'), ask('unpaired'), ask('offline')]) h.request(target, h.emit)
  expect(h.sends).toHaveLength(1)
  expect(h.events.map(e => e.type === 'failed' && e.reason)).toEqual(Array(4).fill('not-connected'))
})
it('coalesces by resolved ownership, preserving each originating window and requested scope', () => {
  const h = harness()
  const legacy: AttachmentRetrievalEvent[] = [], explicit: AttachmentRetrievalEvent[] = []
  h.request(ask(undefined, 'listed'), e => legacy.push(e))
  h.request(ask('B', 'listed'), e => explicit.push(e))
  expect(h.sends).toHaveLength(1)
  h.sends[0].consumer.fail('not-found')
  expect(legacy).toEqual([{ type: 'failed', conversationId: 'listed', attachmentId: 'same', reason: 'not-found' }])
  expect(explicit).toEqual([{ type: 'failed', serverId: 'B', conversationId: 'listed', attachmentId: 'same', reason: 'not-found' }])
})
it('disconnect and delayed storage settle only their owner while equal IDs remain pending', async () => {
  let finish: (r: StoreAttachmentResult) => void = () => undefined
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  const a: AttachmentRetrievalEvent[] = [], b: AttachmentRetrievalEvent[] = [], c: AttachmentRetrievalEvent[] = []
  h.request(ask('A'), e => a.push(e)); h.request(ask('B'), e => b.push(e)); h.request(ask('B', 'other-chat'), e => c.push(e))
  h.sends[0].consumer.fail('connection-lost')
  h.sends[1].consumer.complete(new Uint8Array([1]))
  expect(a[0]).toMatchObject({ serverId: 'A', reason: 'connection-lost' })
  expect([b, c]).toEqual([[], []])
  finish({ ok: true, path: '/private/path' }); await drain()
  expect(b).toEqual([{ type: 'completed', serverId: 'B', conversationId: 'unlisted', attachmentId: 'same' }])
  expect(c).toEqual([])
  h.sends[2].consumer.fail('not-found')
  expect(c[0]).toMatchObject({ conversationId: 'other-chat', reason: 'not-found' })
  expect(JSON.stringify([a, b, c])).not.toContain('/private/path')
})
it('holds aggregate slots through storage and stale terminals cannot release reused ownership', async () => {
  let finish: (r: StoreAttachmentResult) => void = () => undefined
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  h.request(ask('A'), h.emit); h.request(ask('B'), h.emit)
  h.request(ask('A', 'chat-2'), h.emit); h.request(ask('B', 'chat-2'), h.emit)
  h.sends[0].consumer.complete(new Uint8Array([1]))
  h.sends[0].consumer.fail('connection-lost')
  h.request(ask('A', 'overflow'), h.emit)
  expect(h.sends).toHaveLength(4)
  expect(h.events).toEqual([{ type: 'failed', serverId: 'A', conversationId: 'overflow', attachmentId: 'same', reason: 'busy' }])
  finish({ ok: true, path: '/private/path' }); await drain()
  h.request(ask('A'), h.emit)
  h.sends[0].consumer.fail('not-found')
  h.request(ask('B', 'overflow'), h.emit)
  expect(h.sends).toHaveLength(5)
  expect(h.events.at(-1)).toMatchObject({ serverId: 'B', reason: 'busy' })
})

it('repeated asks from one emitter share one terminal without retaining duplicate callbacks', () => {
  const h = harness()
  for (let i = 0; i < 20; i++) h.request(ask('A'), h.emit)
  expect(h.sends).toHaveLength(1)
  h.sends[0].consumer.fail('not-found')
  expect(h.events).toHaveLength(1)
})
