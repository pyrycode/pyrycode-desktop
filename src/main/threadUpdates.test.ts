import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createDaemonConnection } from './daemonConnection'
import { encodeEnvelope, base64StdEncode, decodeEnvelope } from './transport/codec'
import { DAEMON_EVENT_CHANNEL, type StampedDaemonEvent } from '../shared/ipc/events'
import type { NoiseRelayDriverConfig } from './transport/noiseRelayDriver'
import type { PyryApi } from '../preload'
const electron = vi.hoisted(() => ({ expose: vi.fn(), listeners: new Set<Function>() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, webUtils: {}, ipcRenderer: {
  on: (_channel: string, listener: Function) => electron.listeners.add(listener),
  removeListener: (_channel: string, listener: Function) => electron.listeners.delete(listener)
} }))
import '../preload'
const api: PyryApi = electron.expose.mock.calls[0][1]
const p = { conversation_id: 'c', epoch: 'e', version: 7, item_id: 0, base_rev: 0, rev: 7, text: 'é'.repeat(40000) }
function frames(type = 'thread_text_append', logical: any = p) {
  const data = JSON.stringify(logical), offset = Buffer.byteLength(data.slice(0, 20000))
  const update_id = createHash('sha256').update(type).update('\0').update(data).digest('hex')
  return [data.slice(0, 20000), data.slice(20000)].map((data, index) => encodeEnvelope({
    id: 10 + index, type, ts: 'stamp', in_reply_to: 4, event_id: 30 + index,
    history_entry_id: 7, session_id: 'session', payload: { conversation_id: logical.conversation_id, epoch: logical.epoch, version: logical.version,
      item_id: logical.item?.id ?? logical.item_id, rev: logical.item?.rev ?? logical.rev,
      ...(type === 'thread_item_added' ? {} : { base_rev: logical.base_rev }), data,
      continuation: { update_id, index, offset: index ? offset : 0, total_bytes: Buffer.byteLength(JSON.stringify(logical)), final: index === 1 } }
  }))
}
async function connected(serverId = 'host') {
  const configs: NoiseRelayDriverConfig[] = [], events: StampedDaemonEvent[] = [], sent: Uint8Array[] = []
  const connection = createDaemonConnection({
    serverId, deviceName: 'test', clientVersion: 'test',
    pairedServer: { load: async () => ({ server: 'host', relay: 'wss://relay.example/v1/client', token: 'fake', server_static_pubkey: base64StdEncode(new Uint8Array(32)) }), save: async () => {} },
    deviceKeypair: { ensure: async () => ({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }) },
    sink: { isDestroyed: () => false, webContents: { send: (channel, e) => {
      const cloned = structuredClone(e) as StampedDaemonEvent
      events.push(cloned)
      if (channel === DAEMON_EVENT_CHANNEL) electron.listeners.forEach(listener => listener({}, cloned))
    } } },
    createDriver: config => { configs.push(config); return { sendMessage: bytes => { sent.push(bytes) }, stop: () => {} } }
  })
  connection.start(); await vi.waitFor(() => expect(configs).toHaveLength(1))
  const ack = encodeEnvelope({ id: 1, type: 'hello_ack', ts: 'stamp', payload: { protocol_version: 'v2', server_id: 'host', conn_id: 'connection', capabilities: [] } })
  const emit = (plaintext: Uint8Array) => configs.at(-1)!.onEvent({ type: 'message', plaintext })
  configs[0].onEvent({ type: 'handshake-complete', helloAck: ack })
  return { connection, configs, events, emit, ack, sent }
}
afterEach(() => { electron.listeners.clear(); vi.useRealTimers() })
it('delivers completed updates through shared IPC and preload; legacy translators ignore them', async () => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e))
  const h = await connected(), f = frames()
  h.emit(f[0]); expect(received.filter(e => e.type === 'threadUpdate')).toHaveLength(0)
  h.emit(f[1])
  const update = received.find(e => e.type === 'threadUpdate')
  expect(update).toMatchObject({ type: 'threadUpdate', serverId: 'host', conversationId: 'c',
    update: { type: 'thread_text_append', payload: p }, correlation: { id: 11, ts: 'stamp', in_reply_to: 4, event_id: 31, history_entry_id: 7, session_id: 'session' } })
  const before = received.length; off(); h.emit(f[0]); h.emit(f[1]); expect(received).toHaveLength(before)
  expect((decodeEnvelope(h.configs[0].session.hello).payload as { capabilities: string[] }).capabilities).not.toContain('thread')
  h.connection.stop()
})
it.each(['thread_item_added', 'thread_item_changed', 'thread_text_append'])('forwards ordinary and oversized %s through the existing preload subscription', async type => {
  const received: StampedDaemonEvent[] = [], off = api.onDaemonEvent(e => received.push(e)), h = await connected()
  const logical = (text: string) => ({ conversation_id: 'c', epoch: 'e', version: 7,
    ...(type === 'thread_item_added' ? { item: { id: 0, rev: 7, kind: 'unknown-kind', status: 'unknown-status',
      active: true, shown: false, summary: text, session: 'recorded', content: JSON.parse('{"__proto__":{"safe":true},"future":[null,false]}') } } :
      { item_id: 0, base_rev: 0, rev: 7, ...(type === 'thread_item_changed' ?
        { changes: { summary: text, active: false, parent: 0, content: null, ...JSON.parse('{"constructor":0,"__proto__":{}}') } } : { text }) }) })
  h.emit(encodeEnvelope({ id: 0, type, ts: 'ordinary', payload: logical('') }))
  const ordinary = received.filter(e => e.type === 'threadUpdate').at(-1)
  expect(ordinary).toMatchObject({ serverId: 'host', update: { type, payload: logical('') }, correlation: { id: 0, ts: 'ordinary' } })
  expect(ordinary && 'correlation' in ordinary && Object.keys(ordinary.correlation)).toEqual(['id', 'ts'])
  const f = frames(type, logical('é'.repeat(40000)))
  f.slice(0, -1).forEach(frame => h.emit(frame))
  expect(received.filter(e => e.type === 'threadUpdate')).toHaveLength(1)
  h.emit(f.at(-1)!)
  const complete = received.filter(e => e.type === 'threadUpdate').at(-1)
  expect(complete && 'update' in complete && complete.update.payload).toEqual(logical('é'.repeat(40000)))
  expect(received.filter(e => e.type === 'threadUpdate')).toHaveLength(2)
  expect(h.sent).toHaveLength(0) // No catch-up or capability request.
  off(); h.connection.stop()
})
it.each(['relay-drop', 'handshake', 'terminal', 'driver-error', 'daemon-terminal', 'daemon-update-required', 'malformed-handshake', 'reconnect', 'stop'])('clears assembly/timers on %s and prevents stale completion in a successor connection', async event => {
  const h = await connected(), f = frames()
  vi.useFakeTimers(); h.emit(f[0]); expect(vi.getTimerCount()).toBe(1)
  const old = h.configs[0]
  if (event === 'relay-drop') old.onEvent({ type: 'relay-link-down', code: 1006 })
  if (event === 'handshake') old.onEvent({ type: 'handshake-complete', helloAck: h.ack })
  if (event === 'terminal') old.onEvent({ type: 'terminal', code: 4401, reason: 'fatal' })
  if (event === 'driver-error') old.onEvent({ type: 'error', reason: 'handshake-read-failed' })
  if (event === 'daemon-terminal') h.emit(encodeEnvelope({ id: 9, type: 'error', ts: 'stamp', payload: { code: 'auth.invalid_token', message: 'inert' } }))
  if (event === 'malformed-handshake') old.onEvent({ type: 'handshake-complete', helloAck: Buffer.from('invalid') })
  if (event === 'daemon-update-required') h.emit(encodeEnvelope({ id: 9, type: 'error', ts: 'stamp', payload: { code: 'client.update_required', message: 'inert' } }))
  if (event === 'reconnect' || event === 'daemon-update-required') { h.connection.reconnect(); await vi.waitFor(() => expect(h.configs).toHaveLength(2)) }
  if (event === 'stop') h.connection.stop()
  expect(vi.getTimerCount()).toBe(0)
  if (event !== 'stop') h.configs.at(-1)!.onEvent({ type: 'handshake-complete', helloAck: h.ack })
  const before = h.events.length
  vi.advanceTimersByTime(30000); expect(h.events).toHaveLength(before)
  if (event === 'reconnect') old.onEvent({ type: 'message', plaintext: f[1] })
  h.emit(f[1]); expect(h.events.some(e => e.type === 'threadUpdate')).toBe(false)
  if (event !== 'stop') { h.emit(f[0]); h.emit(f[1]); expect(h.events.filter(e => e.type === 'threadUpdate')).toHaveLength(1) }
  else { h.emit(f[0]); h.emit(f[1]); expect(vi.getTimerCount()).toBe(0) }
  h.connection.stop(); expect(vi.getTimerCount()).toBe(0)
})
it('isolates equal conversation/update ids on different hosts and keeps replay admission independent of fragment progress', async () => {
  const a = await connected('a'), b = await connected('b'), f = frames()
  a.emit(f[0]); b.emit(f[0]); a.connection.reconnect()
  await vi.waitFor(() => expect(a.configs).toHaveLength(2))
  expect((decodeEnvelope(a.configs[1].session.hello).payload as { last_event_id: number }).last_event_id).toBe(30)
  b.emit(f[1]); expect(b.events.at(-1)).toMatchObject({ type: 'threadUpdate', serverId: 'b' })
  expect(a.events.some(e => e.type === 'threadUpdate')).toBe(false)
  a.configs[1].onEvent({ type: 'handshake-complete', helloAck: a.ack })
  a.emit(f[1]); expect(a.events.at(-1)).toMatchObject({ type: 'threadRepairNeeded', serverId: 'a', conversationId: 'c', reason: 'sequence' })
  a.connection.reconnect(); await vi.waitFor(() => expect(a.configs).toHaveLength(3))
  expect((decodeEnvelope(a.configs[2].session.hello).payload as { last_event_id: number }).last_event_id).toBe(31)
  expect(a.sent).toHaveLength(0); expect(b.sent).toHaveLength(0)
  a.connection.stop(); b.connection.stop()
})
it('an unrelated correlated daemon refusal leaves thread assembly intact', async () => {
  const h = await connected(), f = frames()
  h.emit(f[0]); h.emit(encodeEnvelope({ id: 20, type: 'error', ts: 'stamp', in_reply_to: 99, payload: { code: 'protocol.malformed', message: 'inert' } }))
  h.emit(f[1]); expect(h.events.at(-1)?.type).toBe('threadUpdate'); h.connection.stop()
})
