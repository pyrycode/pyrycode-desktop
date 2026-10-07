import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore, type SecretEncryption, type SecretPersistence } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createChatHistoryStore } from './chatHistoryStore'
import { createChatHistoryHandler } from './chatHistoryHandler'
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
  it('explicit removal follows held writes, removes omitted timelines and cannot be undone by queued old saves', async () => {
    const h = await setup()
    const paired = new Set(['a', 'b'])
    const handler = createChatHistoryHandler({ store: h.store, log: { event: () => {} }, pairedServers: {
      loadById: async server => paired.has(server) ? { server, relay: '', token: '', server_static_pubkey: '' } : null
    } })
    for (const snapshot of [list(), timeline(), timeline('a', 'omitted'), list('b'), timeline('b')]) {
      expect(await handler(null, replace(snapshot))).toEqual({ status: 'ok' })
    }
    await handler(null, replace(list('a', [])))
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'omitted' }))
      .toMatchObject({ status: 'stored' })
    let release = () => {}
    let started = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { started = resolve })
    h.persistence.write = async (name, bytes) => { started(); await held; await h.disk.write(name, bytes) }
    const oldWrite = handler(null, replace(timeline('a', 'chat', 'held old text')))
    await writing
    let cleared = false
    const removing = handler.clearServer('a', async id => {
      cleared = true
      paired.delete(id)
      return { matched: true, remaining: 1 }
    })
    const stale = handler(null, replace(timeline('a', 'chat', 'queued old text')))
    expect(cleared).toBe(false)
    release()
    expect(await oldWrite).toEqual({ status: 'ok' })
    await removing
    paired.add('a')
    expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
    for (const request of [{ operation: 'readList', serverId: 'a' },
      { operation: 'readTimeline', serverId: 'a', conversationId: 'chat' },
      { operation: 'readTimeline', serverId: 'a', conversationId: 'omitted' }]) {
      expect(await h.fresh().execute(request)).toEqual({ status: 'missing' })
    }
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'b' }))
      .toEqual({ status: 'stored', snapshot: list('b') })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'b', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: timeline('b') })
    expect(await handler(null, replace(timeline('a', 'chat', 'fresh receipt')))).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: timeline('a', 'chat', 'fresh receipt') })
  })

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

it('retains orphan denial correlation across protected writes and fresh reads, rejecting mismatched references', async () => {
  const h = await setup()
  const save = (snapshot: unknown) => h.store.execute({ operation: 'replaceTimeline', serverId: 'a', conversationId: 'chat', snapshot })
  const denial = { toolName: 'Read', decisionReasonType: 'rule', decisionReason: 'denied', message: 'denied',
    truncatedFields: null, droppedFields: null }
  const snapshot = { ...timeline(), items: [], display: [
    { id: 3, kind: 'patch', toolUseId: 'tool', turnId: 'other', denial }
  ], rowIdentity: { rowKeys: [], nextRowKey: 0 } }
  expect(await save(snapshot)).toEqual({ status: 'ok' })
  expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
    .toMatchObject({ status: 'stored', snapshot: { items: [], display: [
      { id: 3, kind: 'patch', toolUseId: 'tool', turnId: 'other', denial }
    ] } })
  const referenced = { ...snapshot, items: [{ kind: 'toolCall', turnId: 'other', toolUseId: 'tool',
    name: 'Read', inputSummary: '', result: null, denial }], rowIdentity: { rowKeys: [0], nextRowKey: 1 },
    display: [{ ...snapshot.display[0], rowKey: 0 }] }
  expect(await save(referenced)).toEqual({ status: 'ok' })
  for (const turnId of ['', 'wrong', undefined]) {
    expect(await save({ ...referenced, display: [{ ...referenced.display[0], turnId }] }))
      .toEqual({ status: 'error', code: 'invalid-request' })
  }
  expect(await h.fresh().execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
    .toMatchObject({ status: 'stored', snapshot: { display: [{ turnId: 'other', rowKey: 0 }] } })
  expect(h.lines.join('\n')).not.toContain('denied')
})

it('retains exact served receipts and reserved client identities across fresh protected instances', async () => {
  const h = await setup()
  const snapshot = { ...timeline(), coverage: { status: 'received', cursor: 'opaque', atStart: false },
    served: { ids: [0, 7], highestId: 7, receipts: [
      { ids: [0, 7], cursor: 'first', atStart: false }, { ids: [], cursor: 'opaque', atStart: false }
    ] }, rowIdentity: { rowKeys: [-8], nextRowKey: 42 } }
  expect(await h.store.execute(replace(snapshot))).toEqual({ status: 'ok' })
  const secureStore = createSecureStore({ encryption: h.encryption, persistence: h.disk })
  const fresh = createChatHistoryStore({ secureStore, log: { event: () => {} } })
  expect(await fresh.execute({ operation: 'readTimeline', serverId: 'a', conversationId: 'chat' }))
    .toEqual({ status: 'stored', snapshot })
  const invalid = { ...snapshot, served: { ...snapshot.served, highestId: 8 } }
  expect(await fresh.execute(replace(invalid)))
    .toEqual({ status: 'error', code: 'invalid-request' })
  expect(h.lines.join('')).not.toContain('opaque')
  expect(h.lines.join('')).not.toContain('private-content')
})
