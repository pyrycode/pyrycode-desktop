import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createChatHistoryStore } from './chatHistoryStore'
import { createChatHistoryHandler } from './chatHistoryHandler'
import { parseChatHistorySnapshot, type ChatHistoryRequest } from '../shared/chatHistory'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const thread = (serverId = 'a', conversationId = 'c') => ({ version: 1, kind: 'daemon-items', serverId, conversationId,
  thread: { hostId: serverId, conversationId, epoch: 'e', version: 30, checkpoint: 10, uncommittedVersion: 20,
    ranges: [{ start: 1, end: 10 }], olderAvailable: false, repair: { fromVersion: 10, throughVersion: 25 },
    items: [JSON.parse('{"id":2,"rev":30,"kind":"future","order":null,"shown":false,"content":null,"session":"s","agent":"unknown","parent":null,"__proto__":{"polluted":true},"constructor":null}'),
      { id: 1, rev: 10, kind: 'assistant_message', order: 1, active: false, content: { text: 'private', future: [null, false, 0] } }] } })
const legacy = (serverId = 'a') => ({ version: 1, kind: 'timeline', serverId, conversationId: 'c',
  items: [{ kind: 'assistantText', text: 'legacy', turnId: 't' }], prependedRows: 0, coverage: { status: 'unknown' } })
const list = (serverId = 'a') => ({ version: 1, kind: 'list', serverId, conversations: ['c', 'other'].map(id => ({
  id, name: null, is_promoted: false, is_archived: false, cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null })) })
const save = (snapshot: unknown): ChatHistoryRequest => {
  const s = parseChatHistorySnapshot(snapshot)
  if (s.kind === 'list') return { operation: 'replaceList', serverId: s.serverId, snapshot: s }
  return { operation: s.kind === 'timeline' ? 'replaceTimeline' : 'replaceThread', serverId: s.serverId,
    conversationId: s.conversationId, snapshot: s } as ChatHistoryRequest
}
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'daemon-cache-')); roots.push(dir)
  const disk = fileSecretPersistence(dir), persistence = { ...disk }
  let available = true
  const secureStore = createSecureStore({ persistence, encryption: { isAvailable: () => available,
    encrypt: bytes => bytes.map(b => b ^ 173), decrypt: bytes => bytes.map(b => b ^ 173) } })
  const logs: unknown[] = [], log = { event: (value: unknown) => { logs.push(value) } }
  const fresh = () => createChatHistoryStore({ secureStore, log })
  return { fresh, store: fresh(), disk, persistence, secureStore, logs, unavailable: () => { available = false } }
}
const read = (serverId = 'a', conversationId = 'c'): ChatHistoryRequest => ({ operation: 'readThread', serverId, conversationId })

describe('protected daemon item history', () => {
  it('round-trips held facts beside legacy rows through protected fresh instances', async () => {
    const h = await setup()
    for (const s of [thread(), legacy(), thread('b'), thread('a', 'offscreen')]) expect(await h.store.execute(save(s))).toEqual({ status: 'ok' })
    const restored = await h.fresh().execute(read())
    expect(restored).toEqual({ status: 'stored', snapshot: thread() })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'c' })).toMatchObject({ status: 'stored', snapshot: legacy() })
    expect(await h.fresh().execute(read('b'))).toEqual({ status: 'stored', snapshot: thread('b') })
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(JSON.stringify(h.logs)).not.toContain('private')
  })
  it('rejects malformed daemon metadata without replacing valid storage', async () => {
    const h = await setup(), s = thread()
    await h.store.execute(save(s))
    const invalids = [{ checkpoint: 31 }, { version: -1 }, { uncommittedVersion: 31 }, { epoch: 42 },
      { ranges: [{ start: 10, end: 1 }] }, { ranges: [{ start: 1, end: 5 }, { start: 4, end: 8 }] },
      { repair: { fromVersion: 11, throughVersion: 25 } }, { items: [{ id: 1, rev: -1, kind: 'x' }] },
      { items: [s.thread.items[0], s.thread.items[0]] }, { olderAvailable: null }, { hostId: 'b' },
      { arrivalOrder: [1] }, { arrivalOrder: [1, 1] }, { arrivalOrder: [1, 3] },
      { arrivalOrder: [1, -2] }, { arrivalOrder: [1, 2.5] }, { arrivalOrder: null }]
    for (const patch of invalids) {
      expect(await h.store.execute({ operation: 'replaceThread', serverId: 'a', conversationId: 'c', snapshot: { ...s, thread: { ...s.thread, ...patch } } })).toEqual({ status: 'error', code: 'invalid-request' })
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(await h.store.execute({ operation: 'replaceThread', serverId: 'a', conversationId: 'c', snapshot: { ...s, thread: { ...s.thread, items: [{ id: 1, rev: 1, kind: 'x', cyclic }] } } })).toEqual({ status: 'error', code: 'invalid-request' })
    h.unavailable()
    expect(await h.store.execute(save({ ...s, thread: { ...s.thread, epoch: 'new' } }))).toEqual({ status: 'error', code: 'encryption-unavailable' })
    expect(await h.fresh().execute(read())).toEqual({ status: 'stored', snapshot: s })
  })
  it('contains malformed protected files and validates the new IPC operations before access', async () => {
    const h = await setup()
    await h.store.execute(save(thread()))
    const original = await h.secureStore.get('chat-history')
    const corrupt = { version: 1, snapshots: [{ ...thread(), thread: { ...thread().thread, checkpoint: 99 } }] }
    await h.secureStore.set('chat-history', new TextEncoder().encode(JSON.stringify(corrupt)))
    expect(await h.fresh().execute(read())).toEqual({ status: 'error', code: 'unreadable' })
    expect(await h.store.execute(save(thread('b')))).toEqual({ status: 'error', code: 'unreadable' })
    expect(JSON.parse(new TextDecoder().decode((await h.secureStore.get('chat-history'))!))).toEqual(corrupt)
    await h.secureStore.set('chat-history', original!)
    const execute = vi.fn(h.store.execute)
    const handler = createChatHistoryHandler({ store: { execute }, log: { event: () => {} }, pairedServers: { loadById: async () => null } })
    for (const request of [read(), save(thread())]) expect(await handler(null, request)).toEqual({ status: 'error', code: 'unknown-host' })
    for (const request of [{ ...read(), extra: true }, { ...save(thread()), conversationId: 'wrong' }])
      expect(await handler(null, request)).toEqual({ status: 'error', code: 'invalid-request' })
    expect(execute).not.toHaveBeenCalled()
    expect(await h.fresh().execute(read())).toEqual({ status: 'stored', snapshot: thread() })
  })
  it('bounds inert JSON depth and aggregate size while retaining absent availability', async () => {
    const h = await setup(), s = thread()
    let deep: unknown = null
    for (let i = 0; i < 66; i++) deep = { child: deep }
    for (const content of [deep, Array(100_001).fill(null), Infinity, new Date()]) {
      expect(await h.store.execute({ operation: 'replaceThread', serverId: 'a', conversationId: 'c',
        snapshot: { ...s, thread: { ...s.thread, items: [{ id: 1, rev: 1, kind: 'future', content }] } } })).toEqual({ status: 'error', code: 'invalid-request' })
    }
    const { olderAvailable: _older, uncommittedVersion: _pending, ...withoutOptional } = s.thread
    await h.store.execute(save({ ...s, thread: withoutOptional }))
    const result = await h.fresh().execute(read())
    expect(result).toMatchObject({ status: 'stored', snapshot: { thread: { uncommittedVersion: 30 } } })
    if (result.status === 'stored' && result.snapshot.kind === 'daemon-items') expect(Object.hasOwn(result.snapshot.thread, 'olderAvailable')).toBe(false)
  })
  it('deletion orders both formats and list removal behind held saves', async () => {
    const h = await setup()
    for (const s of [list(), legacy(), thread(), thread('a', 'other'), thread('b')]) await h.store.execute(save(s))
    let release = () => {}, entered = () => {}
    const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
    h.persistence.write = async (name, bytes) => { entered(); await held; await h.disk.write(name, bytes) }
    const writing = h.store.execute(save({ ...thread(), thread: { ...thread().thread, epoch: 'new' } }))
    await started
    const removing = h.store.execute({ operation: 'removeConversation', serverId: 'a', conversationId: 'c' })
    release(); await writing; expect(await removing).toEqual({ status: 'ok' })
    expect(await h.fresh().execute(read())).toEqual({ status: 'missing' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'c' })).toEqual({ status: 'missing' })
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' })).toMatchObject({ snapshot: { conversations: [{ id: 'other' }] } })
    expect(await h.fresh().execute(read('b'))).toMatchObject({ status: 'stored' })
  })
  it('unpair invalidates old work and preserves another host', async () => {
    const h = await setup()
    const handler = createChatHistoryHandler({ store: h.store, log: { event: () => {} }, pairedServers: { loadById: async () => ({}) as never } })
    for (const s of [list(), legacy(), thread(), thread('a', 'offscreen'), thread('b')]) await handler(null, save(s))
    const clearing = handler.clearServer('a', async () => ({ matched: true }) as never)
    const staleWrite = handler(null, save(thread())), staleRead = handler(null, read())
    await clearing
    expect(await staleWrite).toEqual({ status: 'error', code: 'unknown-host' })
    expect(await staleRead).toEqual({ status: 'error', code: 'unknown-host' })
    for (const request of [read(), read('a', 'offscreen'), { operation: 'readList', serverId: 'a' }, { operation: 'readTimeline', serverId: 'a', conversationId: 'c' }]) expect(await h.fresh().execute(request)).toEqual({ status: 'missing' })
    expect(await h.fresh().execute(read('b'))).toMatchObject({ status: 'stored' })
    expect(await handler(null, save(thread()))).toEqual({ status: 'ok' })
  })
})
