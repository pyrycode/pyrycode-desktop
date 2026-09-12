import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore, type SecretEncryption, type SecretPersistence } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createChatHistoryStore } from './chatHistoryStore'
import { createDiagnosticLog } from './diagnosticLog'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const summary = (id: string) => ({ id, name: null, is_promoted: false, is_archived: false, cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null })
const list = (serverId = 'a', ids = ['chat']) => ({ version: 1, kind: 'list', serverId, conversations: ids.map(summary) })
const timeline = (serverId = 'a', conversationId = 'chat', text = 'private-content') => ({ version: 1, kind: 'timeline', serverId, conversationId,
  items: [{ kind: 'assistantText', turnId: 'turn', text }], prependedRows: 0, coverage: { status: 'unknown' } })
const replace = (snapshot: ReturnType<typeof list> | ReturnType<typeof timeline>) => ({
  operation: snapshot.kind === 'list' ? 'replaceList' : 'replaceTimeline', serverId: snapshot.serverId,
  ...('conversationId' in snapshot ? { conversationId: snapshot.conversationId } : {}), snapshot
})
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pyry-history-')); roots.push(dir)
  const disk = fileSecretPersistence(dir)
  const encryption: SecretEncryption = { isAvailable: () => true,
    encrypt: (bytes) => bytes.map((b) => b ^ 173), decrypt: (bytes) => bytes.map((b) => b ^ 173) }
  const persistence: SecretPersistence = { ...disk }
  const secureStore = createSecureStore({ encryption, persistence })
  const lines: string[] = []
  const log = createDiagnosticLog({ sink: { write: (line) => { lines.push(line) } } })
  const fresh = () => createChatHistoryStore({ secureStore, log })
  return { dir, disk, encryption, persistence, secureStore, lines, fresh, store: fresh() }
}

describe('protected chat history storage', () => {
  it('round-trips fresh-instance lists and partial timelines, separates hosts and keeps credentials', async () => {
    const h = await setup()
    await h.secureStore.set('paired-server', new TextEncoder().encode('credential'))
    for (const snapshot of [list('a', ['second', 'chat']), list('b', []), timeline(), timeline('b', 'chat', 'other')]) {
      expect(await h.store.execute(replace(snapshot))).toEqual({ status: 'ok' })
      expect(await h.store.execute(replace(snapshot))).toEqual({ status: 'ok' })
    }
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'b' })).toEqual({ status: 'stored', snapshot: list('b', []) })
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list('a', ['second', 'chat']) })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: timeline() })
    expect(await h.store.execute({ operation: 'readList', serverId: 'missing' })).toEqual({ status: 'missing' })
    for (const name of await readdir(h.dir)) expect((await readFile(join(h.dir, name))).toString()).not.toContain('private-content')
    expect(await h.secureStore.get('paired-server')).toEqual(new TextEncoder().encode('credential'))
    expect(h.lines.join('')).not.toMatch(/private-content|credential|chat-history|\/tmp/)
  })
  it('removes list entries and unlisted timelines without a ten-chat retention cap', async () => {
    const h = await setup()
    await h.store.execute(replace(list('a', ['chat', 'keep'])))
    for (let i = 0; i < 12; i++) await h.store.execute(replace(timeline('a', String(i))))
    await h.store.execute(replace(timeline()))
    await h.store.execute(replace(timeline('b')))
    await h.secureStore.set('paired-server', new Uint8Array([1, 2]))
    expect(await h.store.execute({ operation: 'readTimeline', serverId: 'a', conversationId: '0' })).toMatchObject({ status: 'stored' })
    for (let i = 0; i < 2; i++) expect(await h.store.execute({ operation: 'removeConversation', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'ok' })
    expect(await h.store.execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list('a', ['keep']) })
    await h.store.execute(replace(list('a', [])))
    for (let i = 0; i < 2; i++) expect(await h.store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: '0' })).toEqual({ status: 'missing' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'b', conversationId: 'chat' })).toMatchObject({ status: 'stored' })
    expect(await h.secureStore.get('paired-server')).toEqual(new Uint8Array([1, 2]))
  })
  it('stores an empty timeline distinctly and replaces lists without deleting omitted timelines', async () => {
    const h = await setup()
    const empty = { ...timeline(), items: [], coverage: { status: 'received', cursor: '', atStart: true } }
    expect(await h.store.execute(replace(empty))).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: empty })
    await Promise.all([h.store.execute(replace(list('a', ['first']))), h.store.execute(replace(list('a', ['last']))),
      h.store.execute(replace(list('b', ['other'])))])
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' }))
      .toEqual({ status: 'stored', snapshot: list('a', ['last']) })
    expect(await h.store.execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: empty })
    await h.store.execute({ operation: 'removeServer', serverId: 'a' })
    expect(await h.store.execute({ operation: 'readList', serverId: 'b' })).toMatchObject({ status: 'stored' })
  })
  it('orders overlapping replacements and removals, copying input before waiting', async () => {
    const h = await setup()
    await h.store.execute(replace(timeline()))
    let release = () => {}; let entered = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    h.persistence.write = async (name, bytes) => { entered(); await held; await h.disk.write(name, bytes) }
    const first = h.store.execute(replace(timeline('a', 'chat', 'first')))
    await started
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: timeline() })
    const snapshot = timeline('a', 'chat', 'last')
    const second = h.store.execute(replace(snapshot)); snapshot.items[0]!.text = 'mutated'
    release(); await Promise.all([first, second])
    expect(await h.store.execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: timeline('a', 'chat', 'last') })
    for (const operation of ['removeConversation', 'removeServer']) {
      const heldSave = new Promise<void>((resolve) => { release = resolve })
      const saveStarted = new Promise<void>((resolve) => { entered = resolve })
      h.persistence.write = async (name, bytes) => { entered(); await heldSave; await h.disk.write(name, bytes) }
      const save = h.store.execute(replace(timeline()))
      await saveStarted
      const remove = h.store.execute({ operation, serverId: 'a', ...(operation === 'removeConversation' ? { conversationId: 'chat' } : {}) })
      await new Promise<void>((resolve) => setImmediate(resolve))
      release()
      expect(await Promise.all([save, remove])).toEqual([{ status: 'ok' }, { status: 'ok' }])
      expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'missing' })
    }
  })
  it('keeps later list saves after an earlier replacement is held in persistence', async () => {
    const h = await setup()
    let release = () => {}; let entered = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    h.persistence.write = async (name, bytes) => { entered(); await held; await h.disk.write(name, bytes) }
    const first = h.store.execute(replace(list('a', ['first'])))
    await started
    const last = h.store.execute(replace(list('a', ['last'])))
    await new Promise<void>((resolve) => setImmediate(resolve))
    release(); await Promise.all([first, last])
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' }))
      .toEqual({ status: 'stored', snapshot: list('a', ['last']) })
  })
  it('fails closed and preserves previous records after failed replacements and removals', async () => {
    const h = await setup()
    await h.store.execute(replace(timeline()))
    h.encryption.isAvailable = () => false
    expect(await h.store.execute(replace(list()))).toEqual({ status: 'error', code: 'encryption-unavailable' })
    h.encryption.isAvailable = () => true
    h.persistence.write = async () => { throw new Error('/secret/path private-content') }
    expect(await h.store.execute(replace(timeline('a', 'chat', 'new')))).toEqual({ status: 'error', code: 'write-failed' })
    h.persistence.delete = async () => { throw new Error('credential') }
    expect(await h.store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual({ status: 'error', code: 'remove-failed' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: timeline() })
    h.persistence.write = h.disk.write; h.persistence.delete = h.disk.delete
    expect(await h.store.execute(replace(list()))).toEqual({ status: 'ok' })
    h.persistence.write = async () => { throw new Error('secret') }
    expect(await h.store.execute(replace(list('a', ['new'])))).toEqual({ status: 'error', code: 'write-failed' })
    expect(await h.store.execute({ operation: 'removeConversation', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'error', code: 'remove-failed' })
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list() })
    expect(h.lines.join('')).not.toMatch(/private-content|credential|secret\/path/)
  })
  it.each(['malformed', 'version', 'decrypt', 'record', 'duplicate'])('distinguishes %s from missing without erasing or replacing', async (mode) => {
    const h = await setup(); await h.store.execute(replace(timeline()))
    const name = 'chat-history'
    if (mode === 'decrypt') h.encryption.decrypt = () => { throw new Error('secret') }
    else {
      const value = mode === 'version' ? '{"version":2}' : mode === 'record'
        ? JSON.stringify({ version: 1, snapshots: [{ ...timeline(), items: [null] }] })
        : mode === 'duplicate' ? JSON.stringify({ version: 1, snapshots: [timeline(), timeline()] }) : '{'
      await h.secureStore.set(name, new TextEncoder().encode(value))
    }
    const before = await h.disk.read(name)
    const result = { status: 'error', code: mode === 'version' ? 'unsupported-version' : 'unreadable' }
    expect(await h.store.execute({ operation: 'readList', serverId: 'a' })).toEqual(result)
    expect(await h.store.execute(replace(list()))).toEqual(result)
    expect(await h.store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual(result)
    expect(await h.disk.read(name)).toEqual(before)
  })
})
