import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore, type SecretEncryption, type SecretPersistence } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { createChatHistoryStore } from './chatHistoryStore'
import { createChatHistoryHandler } from './chatHistoryHandler'
import { createDiagnosticLog } from './diagnosticLog'
import { createHistoryDatabase } from './historyDatabase'
import { threadHistoryCodec, type ChatHistoryRequest } from '../shared/chatHistory'

const roots: string[] = []
const owners: ReturnType<typeof createHistoryDatabase>[] = []
afterEach(async () => { vi.restoreAllMocks(); owners.splice(0).forEach(db => db.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const summary = (id: string) => ({ id, name: null, is_promoted: false, is_archived: false, cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null })
const list = (serverId = 'a', ids = ['chat']) => ({ version: 1, kind: 'list', serverId, conversations: ids.map(summary) })
const thread = (serverId = 'a', conversationId = 'chat', text = 'private-content') => ({ version: 1, kind: 'daemon-items', serverId, conversationId,
  thread: { hostId: serverId, conversationId, epoch: 'e', version: 1, checkpoint: 1, uncommittedVersion: 0,
    ranges: [], repair: null, items: [{ id: 1, rev: 1, kind: 'assistant_message', text }] } })
const replace = (snapshot: ReturnType<typeof list> | ReturnType<typeof thread>) => ({
  operation: snapshot.kind === 'list' ? 'replaceList' : 'replaceThread', serverId: snapshot.serverId,
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
  const database = createHistoryDatabase({ userDataPath: dir }); owners.push(database)
  const fresh = () => { database.close(); return createChatHistoryStore({ secureStore, log, encryption, database }) }
  return { dir, disk, encryption, persistence, secureStore, log, lines, database, fresh, store: fresh() }
}

describe('protected chat history storage', () => {
  const mutation = (extra: object = {}, serverId = 'a'): Extract<ChatHistoryRequest, { operation: 'mutateThread' }> => ({ operation: 'mutateThread', serverId, conversationId: 'chat', change: {
    metadata: { hostId: serverId, conversationId: 'chat', epoch: 'e', version: 1, checkpoint: 1, uncommittedVersion: 0, repair: null },
    acceptEpoch: true, items: [], removeIds: [], ranges: [], ...extra
  } })
  it.each(['items', 'removals', 'progress', 'ranges', 'reset'])('bounds %s work and admits a timer after progress before completion', async mode => {
    const h = await setup(), count = 160
    const items = Array.from({ length: count }, (_, id) => ({ id, rev: 1, kind: 'future', order: id, text: 'bounded-private' }))
    const ranges = items.map(i => ({ start: i.id * 3, end: i.id * 3 + 1 }))
    expect(await h.store.execute(mutation({ items, ranges }))).toEqual({ status: 'ok' })
    const turns: number[] = []
    const progressWork = vi.spyOn(threadHistoryCodec, 'metadata')
    let indexWrites = 0, rangeReads = 0, payloadWrites = 0
    h.database.transaction(db => {
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (/^(INSERT|DELETE)/.test(sql)) {
          const run = statement.run.bind(statement)
          vi.spyOn(statement, 'run').mockImplementation((...args) => {
            if (sql.includes('thread_auth')) indexWrites++
            if (sql.includes('thread_payloads')) payloadWrites++
            return run(...args)
          })
        } else if (sql.includes('thread_records') && sql.includes('ordinal = ?')) {
          const get = statement.get.bind(statement)
          vi.spyOn(statement, 'get').mockImplementation((...args) => { rangeReads++; return get(...args) })
        }
        return statement
      })
    })
    let timerObserved = false, complete = false
    const store = createChatHistoryStore({ ...h, onMutationTurn: async units => {
      turns.push(units)
      expect(indexWrites).toBeLessThanOrEqual(16); expect(rangeReads).toBeLessThanOrEqual(16); expect(payloadWrites).toBeLessThanOrEqual(16)
      expect(progressWork.mock.calls.length).toBeLessThanOrEqual(16)
      progressWork.mockClear()
      indexWrites = 0; rangeReads = 0; payloadWrites = 0
      await new Promise<void>(resolve => setTimeout(() => { expect(complete).toBe(false); timerObserved = true; resolve() }, 0))
    } })
    const metadata = mutation().change.metadata
    const request = mutation(mode === 'items' ? { items: items.map(i => ({ ...i, rev: 2 })) }
      : mode === 'removals' ? { removeIds: items.map(i => i.id) }
        : mode === 'ranges' ? { ranges: [{ start: 0, end: count * 3 }] }
          : mode === 'reset' ? { resetId: 'new-reset' } : { priorProgress: items.map(() => ({ metadata })) })
    const saving = store.execute(request)
    progressWork.mockClear() // Admission is already detached; count execution only.
    expect(await saving).toEqual({ status: 'ok' }); complete = true
    expect(timerObserved).toBe(true)
    expect(turns.length).toBeGreaterThan(1)
    expect(turns.every(n => n === 16)).toBe(true)
    expect(indexWrites).toBeLessThanOrEqual(16)
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' })).toMatchObject({ status: 'stored' })
    if (mode === 'reset') {
      const fresh = h.fresh(), read = { operation: 'readThread', serverId: 'a', conversationId: 'chat' }
      await fresh.execute(mutation({ items: [{ id: 999, rev: 1, kind: 'future' }] }))
      expect(await fresh.execute(request)).toEqual({ status: 'ok' })
      expect(await fresh.execute(read)).toMatchObject({ status: 'stored', snapshot: { thread: { items: [{ id: 999, rev: 1, kind: 'future' }] } } })
    }
  }, 30_000)

  it('production scheduling lets a real timer run after item writes and before acknowledgement', async () => {
    const h = await setup()
    await h.store.execute(mutation())
    let observed = false, complete = false, scheduled = false
    const encrypt = h.encryption.encrypt
    h.encryption.encrypt = bytes => {
      if (!scheduled) { scheduled = true; setTimeout(() => { observed = !complete }, 0) }
      return encrypt(bytes)
    }
    expect(await h.store.execute(mutation({ items: Array.from({ length: 100 }, (_, id) => ({ id, rev: 1, kind: 'future' })) }))).toEqual({ status: 'ok' })
    complete = true
    expect(observed).toBe(true)
  })

  it.each(['turn', 'index', 'header'])('rolls back bounded %s failure without retry and retains explicit replay through a fresh owner', async mode => {
    const h = await setup()
    expect(await h.store.execute(mutation())).toEqual({ status: 'ok' })
    let turns = 0
    const store = createChatHistoryStore({ ...h, onMutationTurn: async () => { if (++turns === 8 && mode === 'turn') throw new Error('private-failure') } })
    if (mode !== 'turn') h.database.transaction(db => db.exec(mode === 'index'
      ? "CREATE TRIGGER bounded_failure BEFORE INSERT ON thread_auth BEGIN SELECT RAISE(ABORT, 'private-failure'); END"
      : "CREATE TRIGGER bounded_failure BEFORE INSERT ON thread_records WHEN new.kind = 'header' BEGIN SELECT RAISE(ABORT, 'private-failure'); END"))
    const request = mutation({ items: Array.from({ length: 80 }, (_, id) => ({ id, rev: 1, kind: 'future', text: 'private-failure' })),
      metadata: { ...mutation().change.metadata, version: 80, checkpoint: 80 }, completion: { fromVersion: 1, version: 80 } })
    expect(await store.execute(request)).toEqual({ status: 'error', code: 'write-failed' })
    expect(turns).toBeGreaterThanOrEqual(8)
    const read = { operation: 'readThread', serverId: 'a', conversationId: 'chat' }
    expect(await h.fresh().execute(read)).toMatchObject({ status: 'stored', snapshot: { thread: { items: [], checkpoint: 1 } } })
    if (mode !== 'turn') h.database.transaction(db => db.exec('DROP TRIGGER bounded_failure'))
    const retry = h.fresh()
    expect(await retry.execute(request)).toEqual({ status: 'ok' })
    const admitted = await retry.execute(read)
    expect(admitted).toMatchObject({ status: 'stored', snapshot: { thread: { items: request.change.items, checkpoint: 80 } } })
    expect(await retry.execute(request)).toEqual({ status: 'ok' })
    expect(await h.fresh().execute(read)).toEqual(admitted)
    expect(h.lines.join('')).not.toContain('private-failure')
  })

  it.each(['reset', 'epoch', 'conversation', 'host'].flatMap(action => [false, true].map(interrupted => ({ action, interrupted }))))(
    'serializes $action after interruption=$interrupted across hosts before close', async ({ action, interrupted }) => {
    const h = await setup()
    await h.store.execute(mutation())
    await h.store.execute(mutation({}, 'b'))
    let release = () => {}, entered = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    let turns = 0
    const store = createChatHistoryStore({ ...h, onMutationTurn: async () => {
      if (++turns === 4) { entered(); await held; if (interrupted) throw new Error('interrupted') }
    } })
    const request = mutation({ items: Array.from({ length: 40 }, (_, id) => ({ id, rev: 1, kind: 'future', text: 'admitted' })) })
    const saving = store.execute(request)
    await started
    ;(request.change.items[0] as Record<string, unknown>).text = 'caller-change'
    const read = { operation: 'readThread', serverId: 'a', conversationId: 'chat' }
    const reading = store.execute(read)
    const later = store.execute(mutation({ items: [{ id: 99, rev: 1, kind: 'future' }] }))
    const transition = store.execute(action === 'reset' ? mutation({ resetId: 'reset' })
      : action === 'epoch' ? mutation({ metadata: { ...mutation().change.metadata, epoch: 'next' } })
        : { operation: action === 'host' ? 'removeServer' : 'removeConversation', serverId: 'a', ...(action === 'host' ? {} : { conversationId: 'chat' }) })
    let closed = false
    const closing = store.close().then(() => { closed = true })
    expect(await store.execute(read)).toEqual({ status: 'error', code: 'unreadable' })
    expect(closed).toBe(false)
    release()
    expect(await saving).toEqual(interrupted ? { status: 'error', code: 'write-failed' } : { status: 'ok' })
    expect(await reading).toMatchObject({ status: 'stored', snapshot: { thread: { items: interrupted ? []
      : expect.arrayContaining([{ id: 0, rev: 1, kind: 'future', text: 'admitted' }]) } } })
    expect(await later).toEqual({ status: 'ok' }); expect(await transition).toEqual({ status: 'ok' })
    await closing
    expect(await h.fresh().execute(read)).toMatchObject(action === 'host' || action === 'conversation' ? { status: 'missing' } : { status: 'stored', snapshot: { thread: { items: [] } } })
    expect(await h.fresh().execute({ ...read, serverId: 'b' })).toMatchObject({ status: 'stored', snapshot: { thread: { items: [], epoch: 'e' } } })
  })
  it.each(['conversation', 'host'])('confirmed %s removal fences stale handler admission after bounded progress', async action => {
    const h = await setup(), paired = new Set(['a', 'b'])
    let entered = () => {}, release = () => {}, turns = 0
    const started = new Promise<void>(resolve => { entered = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const store = createChatHistoryStore({ ...h, onMutationTurn: async () => {
      if (++turns === 4) { entered(); await held }
    } })
    const handler = createChatHistoryHandler({ store, log: h.log, pairedServers: {
      loadById: async server => paired.has(server) ? { server, relay: '', token: '', server_static_pubkey: '' } : null
    } })
    await handler(null, mutation()); await handler(null, mutation({}, 'b'))
    const saving = handler(null, mutation({ items: Array.from({ length: 40 }, (_, id) => ({ id, rev: 1, kind: 'future' })) }))
    await started
    const removing = action === 'host' ? handler.clearServer('a', async server => {
      paired.delete(server); return { matched: true, remaining: 1 }
    }) : handler(null, { operation: 'removeConversation', serverId: 'a', conversationId: 'chat' })
    const stale = handler(null, mutation({ items: [{ id: 99, rev: 1, kind: 'future' }] }))
    release()
    expect(await saving).toEqual({ status: 'ok' }); await removing
    paired.add('a')
    expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
    const read = { operation: 'readThread', serverId: 'a', conversationId: 'chat' }
    expect(await h.fresh().execute(read)).toEqual({ status: 'missing' })
    expect(await h.fresh().execute({ ...read, serverId: 'b' })).toMatchObject({ status: 'stored', snapshot: { thread: { items: [] } } })
  })

  it('explicit removal follows held writes, removes omitted threads and cannot be undone by queued old saves', async () => {
    const h = await setup()
    const paired = new Set(['a', 'b'])
    let membership = async () => {}
    const handler = createChatHistoryHandler({ store: h.store, log: { event: () => {} }, pairedServers: {
      loadById: async server => { await membership(); return paired.has(server) ? { server, relay: '', token: '', server_static_pubkey: '' } : null }
    } })
    for (const snapshot of [list(), thread(), thread('a', 'omitted'), list('b'), thread('b')]) {
      expect(await handler(null, replace(snapshot))).toEqual({ status: 'ok' })
    }
    await handler(null, replace(list('a', [])))
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'omitted' }))
      .toMatchObject({ status: 'stored' })
    let release = () => {}
    let started = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const writing = new Promise<void>(resolve => { started = resolve })
    membership = async () => { started(); await held }
    const oldWrite = handler(null, replace(thread('a', 'chat', 'held old text')))
    await writing
    let cleared = false
    const removing = handler.clearServer('a', async id => {
      cleared = true
      paired.delete(id)
      return { matched: true, remaining: 1 }
    })
    const stale = handler(null, replace(thread('a', 'chat', 'queued old text')))
    expect(cleared).toBe(false)
    release()
    expect(await oldWrite).toEqual({ status: 'ok' })
    await removing
    paired.add('a')
    expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
    for (const request of [{ operation: 'readList', serverId: 'a' },
      { operation: 'readThread', serverId: 'a', conversationId: 'chat' },
      { operation: 'readThread', serverId: 'a', conversationId: 'omitted' }]) {
      expect(await h.fresh().execute(request)).toEqual({ status: 'missing' })
    }
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'b' }))
      .toEqual({ status: 'stored', snapshot: list('b') })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'b', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: thread('b') })
    expect(await handler(null, replace(thread('a', 'chat', 'fresh receipt')))).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: thread('a', 'chat', 'fresh receipt') })
  })

  it('round-trips fresh-instance lists and partial threads, separates hosts and keeps credentials', async () => {
    const h = await setup()
    await h.secureStore.set('paired-server', new TextEncoder().encode('credential'))
    for (const snapshot of [list('a', ['second', 'chat']), list('b', []), thread(), thread('b', 'chat', 'other')]) {
      expect(await h.store.execute(replace(snapshot))).toEqual({ status: 'ok' })
      expect(await h.store.execute(replace(snapshot))).toEqual({ status: 'ok' })
    }
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'b' })).toEqual({ status: 'stored', snapshot: list('b', []) })
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list('a', ['second', 'chat']) })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: thread() })
    expect(await h.store.execute({ operation: 'readList', serverId: 'missing' })).toEqual({ status: 'missing' })
    for (const name of await readdir(join(h.dir, 'history'))) expect((await readFile(join(h.dir, 'history', name))).toString()).not.toContain('private-content')
    expect(await h.secureStore.get('paired-server')).toEqual(new TextEncoder().encode('credential'))
    expect(h.lines.join('')).not.toMatch(/private-content|credential|chat-history|\/tmp/)
  })
  it('removes list entries and unlisted threads without a ten-chat retention cap', async () => {
    const h = await setup()
    await h.store.execute(replace(list('a', ['chat', 'keep'])))
    for (let i = 0; i < 12; i++) await h.store.execute(replace(thread('a', String(i))))
    await h.store.execute(replace(thread()))
    await h.store.execute(replace(thread('b')))
    await h.secureStore.set('paired-server', new Uint8Array([1, 2]))
    expect(await h.store.execute({ operation: 'readThread', serverId: 'a', conversationId: '0' })).toMatchObject({ status: 'stored' })
    for (let i = 0; i < 2; i++) expect(await h.store.execute({ operation: 'removeConversation', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'ok' })
    expect(await h.store.execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list('a', ['keep']) })
    await h.store.execute(replace(list('a', [])))
    for (let i = 0; i < 2; i++) expect(await h.store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: '0' })).toEqual({ status: 'missing' })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'b', conversationId: 'chat' })).toMatchObject({ status: 'stored' })
    expect(await h.secureStore.get('paired-server')).toEqual(new Uint8Array([1, 2]))
  })
  it('stores an empty thread distinctly and replaces lists without deleting omitted threads', async () => {
    const h = await setup()
    const empty = { ...thread(), thread: { ...thread().thread, items: [] } }
    expect(await h.store.execute(replace(empty))).toEqual({ status: 'ok' })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: empty })
    await Promise.all([h.store.execute(replace(list('a', ['first']))), h.store.execute(replace(list('a', ['last']))),
      h.store.execute(replace(list('b', ['other'])))])
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' }))
      .toEqual({ status: 'stored', snapshot: list('a', ['last']) })
    expect(await h.store.execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'stored', snapshot: empty })
    await h.store.execute({ operation: 'removeServer', serverId: 'a' })
    expect(await h.store.execute({ operation: 'readList', serverId: 'b' })).toMatchObject({ status: 'stored' })
  })
  it('orders overlapping replacements and removals, copying input before waiting', async () => {
    const h = await setup()
    await h.secureStore.set('chat-history', Buffer.from(JSON.stringify({ version: 1, snapshots: [thread()] })))
    let release = () => {}; let entered = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const get = h.secureStore.get
    h.secureStore.get = async name => { entered(); await held; return get(name) }
    const first = h.store.execute(replace(thread('a', 'chat', 'first')))
    await started
    expect(h.database.transaction(db => db.prepare('SELECT count(*) AS n FROM thread_scopes').get())).toEqual({ n: 0 })
    const snapshot = thread('a', 'chat', 'last')
    const second = h.store.execute(replace(snapshot)); snapshot.thread.items[0]!.text = 'mutated'
    release(); await Promise.all([first, second])
    expect(await h.store.execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: thread('a', 'chat', 'last') })
    for (const operation of ['removeConversation', 'removeServer']) {
      const save = h.store.execute(replace(thread()))
      const remove = h.store.execute({ operation, serverId: 'a', ...(operation === 'removeConversation' ? { conversationId: 'chat' } : {}) })
      expect(await Promise.all([save, remove])).toEqual([{ status: 'ok' }, { status: 'ok' }])
      expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'missing' })
    }
  })
  it('keeps later list saves after an earlier replacement is held in import', async () => {
    const h = await setup()
    let release = () => {}; let entered = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const get = h.secureStore.get
    h.secureStore.get = async name => { entered(); await held; return get(name) }
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
    await h.store.execute(replace(thread()))
    h.encryption.isAvailable = () => false
    expect(await h.store.execute(replace(list()))).toEqual({ status: 'error', code: 'encryption-unavailable' })
    h.encryption.isAvailable = () => true
    h.database.transaction(db => db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON thread_scopes BEGIN SELECT RAISE(ABORT, 'private'); END"))
    expect(await h.store.execute(replace(thread('a', 'chat', 'new')))).toEqual({ status: 'error', code: 'write-failed' })
    h.database.transaction(db => db.exec("CREATE TRIGGER fail_remove BEFORE DELETE ON thread_scopes BEGIN SELECT RAISE(ABORT, 'private'); END"))
    expect(await h.store.execute({ operation: 'removeServer', serverId: 'a' })).toEqual({ status: 'error', code: 'remove-failed' })
    expect(await h.fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'chat' })).toEqual({ status: 'stored', snapshot: thread() })
    h.database.transaction(db => db.exec('DROP TRIGGER fail_write; DROP TRIGGER fail_remove'))
    expect(await h.store.execute(replace(list()))).toEqual({ status: 'ok' })
    h.database.transaction(db => db.exec("CREATE TRIGGER fail_list BEFORE INSERT ON history_lists BEGIN SELECT RAISE(ABORT, 'private'); END"))
    expect(await h.store.execute(replace(list('a', ['new'])))).toEqual({ status: 'error', code: 'write-failed' })
    expect(await h.store.execute({ operation: 'removeConversation', serverId: 'a', conversationId: 'chat' }))
      .toEqual({ status: 'error', code: 'remove-failed' })
    expect(await h.fresh().execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list() })
    expect(h.lines.join('')).not.toMatch(/private-content|credential|secret\/path/)
  })
  it.each(['malformed', 'version', 'decrypt', 'record', 'duplicate'])('distinguishes %s from missing without erasing or replacing', async (mode) => {
    const h = await setup()
    await h.secureStore.set('chat-history', Buffer.from(JSON.stringify({ version: 1, snapshots: [thread()] })))
    const name = 'chat-history'
    if (mode === 'decrypt') h.encryption.decrypt = () => { throw new Error('secret') }
    else {
      const value = mode === 'version' ? '{"version":2}' : mode === 'record'
        ? JSON.stringify({ version: 1, snapshots: [{ ...thread(), thread: null }] })
        : mode === 'duplicate' ? JSON.stringify({ version: 1, snapshots: [thread(), thread()] }) : '{'
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
