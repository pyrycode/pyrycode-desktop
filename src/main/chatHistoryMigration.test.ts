import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHistoryDatabase } from './historyDatabase'
import { createChatHistoryStore } from './chatHistoryStore'
import { createIndexedLegacyHistory } from './indexedLegacyHistory'
import { createIndexedThreadHistory } from './indexedThreadHistory'
import { createSecureStore, type SecretEncryption } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { parseChatHistorySnapshot } from '../shared/chatHistory'
import { createChatHistoryHandler } from './chatHistoryHandler'

const roots: string[] = [], owners: ReturnType<typeof createHistoryDatabase>[] = []
afterEach(async () => { owners.splice(0).forEach(db => db.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const timeline = (serverId = 'a', text = 'MIGRATION-PRIVATE') => ({ version: 1, kind: 'timeline', serverId, conversationId: 'c',
  items: [{ kind: 'assistantText', turnId: 't', text }], prependedRows: 3,
  coverage: { status: 'received', cursor: 'MIGRATION-CURSOR', atStart: false },
  rowIdentity: { rowKeys: [-3], nextRowKey: 4 }, served: { ids: [1], highestId: 1, receipts: [{ ids: [1], cursor: '', atStart: false }] } })
const thread = (serverId = 'a') => ({ version: 1, kind: 'daemon-items', serverId, conversationId: 'c', thread: {
  hostId: serverId, conversationId: 'c', epoch: 'e', version: 30, checkpoint: 10, uncommittedVersion: 20,
  repair: { fromVersion: 10, throughVersion: 25 }, olderAvailable: false, ranges: [{ start: 1, end: 10 }], arrivalOrder: [2, 1],
  items: [{ id: 1, rev: 10, order: 1, kind: 'future', content: { text: 'MIGRATION-THREAD', patch: null } },
    { id: 2, rev: 30, kind: 'future', order: null, shown: false }] } })
const list = { version: 1, kind: 'list', serverId: 'a', conversations: ['c', 'peer'].map(id => ({
  id, name: null, is_promoted: false, is_archived: false, cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null })) }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'history-import-')); roots.push(root)
  const encryption: SecretEncryption = { isAvailable: () => true, encrypt: b => b.map(v => v ^ 173), decrypt: b => b.map(v => v ^ 173) }
  const persistence = fileSecretPersistence(join(root, 'secrets')), secureStore = createSecureStore({ persistence, encryption })
  const log = { event: (_event: unknown) => {} }
  const fresh = () => { const database = createHistoryDatabase({ userDataPath: root }); owners.push(database)
    return { database, store: createChatHistoryStore({ secureStore, encryption, database, log }) } }
  const seed = async (snapshots: unknown[], version = 1) => secureStore.set('chat-history', Buffer.from(JSON.stringify({ version, snapshots })))
  return { root, encryption, persistence, secureStore, log, fresh, seed }
}
const read = (operation = 'readTimeline', serverId = 'a') => ({ operation, serverId, conversationId: 'c' })

it('keeps detached Promise backend execution callable', async () => {
  const h = await setup(), { database } = h.fresh()
  const { execute: legacy } = createIndexedLegacyHistory({ database, encryption: h.encryption, log: h.log })
  const { execute: authoritative } = createIndexedThreadHistory({ database, encryption: h.encryption, log: h.log })
  expect(await legacy(read())).toEqual({ status: 'missing' })
  expect(await authoritative(read('readThread'))).toEqual({ status: 'missing' })
})

it('commits a saturated receipt replacement through handler admission and preserves it across fresh owners', async () => {
  const h = await setup(), first = h.fresh()
  const ids = Array.from({ length: 200 }, (_, i) => i)
  const original = { ...timeline(), served: { ids, highestId: 199,
    receipts: Array.from({ length: 500 }, (_, i) => ({ ids, cursor: `page-${i}`, atStart: false })) } }
  await h.seed([original, thread()])
  const handler = createChatHistoryHandler({ store: first.store, log: h.log,
    pairedServers: { loadById: async () => ({ server: 'a', relay: '', token: '', server_static_pubkey: '' }) } })
  expect(await handler(null, read())).toEqual({ status: 'stored', snapshot: original })
  const repeated = { ...original, served: { ...original.served, receipts: [...original.served.receipts.slice(1),
    { ids, cursor: 'repeat', atStart: false }] } }
  const saving = handler(null, { ...read('replaceTimeline'), snapshot: repeated })
  const queuedRead = handler(null, read())
  expect(await saving).toEqual({ status: 'ok' })
  expect(await queuedRead).toEqual({ status: 'stored', snapshot: repeated })
  first.database.close()
  const next = h.fresh()
  expect(await next.store.execute(read())).toEqual({ status: 'stored', snapshot: repeated })
  expect(await next.store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
}, 60_000)

it('imports both exact formats once, preserves newer indexed content and never reopens the source after restart', async () => {
  const h = await setup(), first = h.fresh()
  const indexed = createIndexedLegacyHistory({ database: first.database, encryption: h.encryption, log: h.log })
  const newer = timeline('a', 'newer')
  expect(await indexed.execute({ ...read('replaceTimeline'), snapshot: newer })).toEqual({ status: 'ok' })
  await h.seed([timeline(), thread(), timeline('b'), thread('b'), list])
  expect(await first.store.execute(read())).toEqual({ status: 'stored', snapshot: newer })
  first.database.close()
  h.secureStore.get = async () => { throw Error('must never reopen') }
  const reopened = h.fresh()
  expect(await reopened.store.execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list })
  for (const [operation, snapshot] of [['readThread', thread()], ['readTimeline', timeline('b')], ['readThread', thread('b')]] as const)
    expect(await reopened.store.execute(read(operation, snapshot.serverId))).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(snapshot) })
  for (const name of await readdir(join(h.root, 'history'))) {
    const bytes = await readFile(join(h.root, 'history', name))
    for (const text of ['MIGRATION-PRIVATE', 'MIGRATION-THREAD', 'MIGRATION-CURSOR']) expect(bytes.includes(Buffer.from(text))).toBe(false)
  }
})

it('rolls back an interrupted two-format import and retries without duplicates', async () => {
  const h = await setup(); await h.seed([timeline(), thread()])
  const before = await h.persistence.read('chat-history'), first = h.fresh(), encrypt = h.encryption.encrypt
  let count = 0
  h.encryption.encrypt = b => { if (++count === 7) throw Error('interrupted'); return encrypt(b) }
  expect(await first.store.execute(read())).toMatchObject({ status: 'error' })
  expect(first.database.transaction(db => db.prepare('SELECT count(*) AS n FROM legacy_scopes').get())).toEqual({ n: 0 })
  expect(await h.persistence.read('chat-history')).toEqual(before)
  first.database.close(); h.encryption.encrypt = encrypt
  const next = h.fresh()
  expect(await next.store.execute(read())).toEqual({ status: 'stored', snapshot: timeline() })
  expect(await next.store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
})

it.each(['list insertion', 'marker insertion', 'outer commit'])('classifies an import %s failure and rolls back both families before queued retry', async mode => {
  const h = await setup(), first = h.fresh()
  const legacy = createIndexedLegacyHistory({ database: first.database, encryption: h.encryption, log: h.log })
  const threads = createIndexedThreadHistory({ database: first.database, encryption: h.encryption, log: h.log })
  expect(await legacy.execute({ ...read('replaceTimeline', 'b'), snapshot: timeline('b') })).toEqual({ status: 'ok' })
  expect(await threads.execute({ ...read('replaceThread', 'b'), snapshot: thread('b') })).toEqual({ status: 'ok' })
  await h.seed([timeline(), thread(), list])
  const source = await h.persistence.read('chat-history')
  first.database.transaction(db => db.exec(mode === 'outer commit' ? `
    CREATE TABLE import_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE import_child (id INTEGER REFERENCES import_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_import AFTER INSERT ON history_import
      BEGIN INSERT INTO import_child VALUES (1); END;
  ` : `CREATE TRIGGER fail_import BEFORE INSERT ON ${mode === 'list insertion' ? 'history_lists' : 'history_import'}
      BEGIN SELECT RAISE(FAIL, 'import rejected'); END;`))
  const failing = first.store.execute(read()), queued = first.store.execute(read('readThread'))
  for (const result of [await failing, await queued]) expect(result).toEqual({ status: 'error', code: 'write-failed' })
  expect(await h.persistence.read('chat-history')).toEqual(source)
  first.database.transaction(db => {
    for (const table of ['history_import', 'history_lists'])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    for (const table of ['legacy_scopes', 'thread_scopes'])
      expect(db.prepare(`SELECT server FROM ${table}`).all()).toEqual([{ server: Buffer.from('b', 'utf16le') }])
    expect(db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get('fail_import')).toEqual({ n: 1 })
  })
  expect(await legacy.execute(read('readTimeline', 'b'))).toEqual({ status: 'stored', snapshot: timeline('b') })
  expect(await threads.execute(read('readThread', 'b'))).toEqual({ status: 'stored', snapshot: thread('b') })
  first.database.transaction(db => db.exec('DROP TRIGGER fail_import'))
  expect(await first.store.execute(read())).toEqual({ status: 'stored', snapshot: timeline() })
  await first.store.close()
  const next = h.fresh()
  expect(await next.store.execute(read())).toEqual({ status: 'stored', snapshot: timeline() })
  expect(await next.store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
  expect(await next.store.execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: list })
  expect(next.database.transaction(db => db.prepare('SELECT * FROM history_import').all())).toEqual([{ singleton: 1, retired: 1 }])
  expect(await h.persistence.read('chat-history')).toBeNull()
})

it.each([9, 1.5, '9'])('preserves a stored list with version %s across reads and mutations', async version => {
  const h = await setup(), first = h.fresh()
  await h.seed([timeline(), thread(), list])
  expect(await first.store.execute(read())).toEqual({ status: 'stored', snapshot: timeline() })
  const payload = Buffer.from(h.encryption.encrypt(Buffer.from(JSON.stringify({ ...list, version }))))
  first.database.transaction(db => db.prepare('UPDATE history_lists SET payload = ?').run(payload))
  await first.store.close()
  h.secureStore.get = async () => { throw Error('completed import must not reopen source') }
  const next = h.fresh()
  for (const request of [{ operation: 'readList', serverId: 'a' }, { operation: 'replaceList', serverId: 'a', snapshot: list },
    read('removeConversation'), { operation: 'removeServer', serverId: 'a' }]) {
    expect(await next.store.execute(request)).toEqual({ status: 'error',
      code: version === 9 ? 'unsupported-version' : 'unreadable' })
    expect(next.database.transaction(db => db.prepare('SELECT payload FROM history_lists').all())).toEqual([{ payload }])
    expect(await next.store.execute(read())).toEqual({ status: 'stored', snapshot: timeline() })
    expect(await next.store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
  }
  expect(await next.store.execute({ ...read('replaceThread', 'b'), snapshot: thread('b') })).toEqual({ status: 'ok' })
  await next.store.close()
  const reopened = h.fresh()
  expect(await reopened.store.execute(read('readThread', 'b'))).toEqual({ status: 'stored', snapshot: thread('b') })
  expect(reopened.database.transaction(db => db.prepare('SELECT payload FROM history_lists').all())).toEqual([{ payload }])
})

it('keeps invalid destination list decoding unreadable before importing either family', async () => {
  const h = await setup(), first = h.fresh()
  await h.seed([timeline(), thread(), list])
  const source = await h.persistence.read('chat-history'), payload = Buffer.from(h.encryption.encrypt(Buffer.from('{')))
  first.database.transaction(db => db.prepare('INSERT INTO history_lists VALUES (?, ?)').run(Buffer.from('a', 'utf16le'), payload))
  expect(await first.store.execute(read())).toEqual({ status: 'error', code: 'unreadable' })
  expect(await h.persistence.read('chat-history')).toEqual(source)
  first.database.transaction(db => {
    expect(db.prepare('SELECT payload FROM history_lists').all()).toEqual([{ payload }])
    for (const table of ['legacy_scopes', 'thread_scopes', 'history_import'])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    db.exec('DELETE FROM history_lists')
  })
  expect(await first.store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
})

it.each(['timeline', 'daemon-items'])('classifies an outer %s replacement commit failure and preserves the committed snapshot', async kind => {
  const h = await setup(), first = h.fresh()
  const operation = kind === 'timeline' ? 'replaceTimeline' : 'replaceThread'
  const reading = kind === 'timeline' ? 'readTimeline' : 'readThread'
  const before = kind === 'timeline' ? timeline() : thread()
  const replacement = kind === 'timeline' ? timeline('a', 'newer') : { ...thread(), thread: { ...thread().thread, epoch: 'fresh' } }
  expect(await first.store.execute({ ...read(operation), snapshot: before })).toEqual({ status: 'ok' })
  first.database.transaction(db => db.exec(`
    CREATE TABLE commit_parent (id INTEGER PRIMARY KEY);
    CREATE TABLE commit_child (id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER fail_outer_commit AFTER INSERT ON ${kind === 'timeline' ? 'legacy_scopes' : 'thread_scopes'}
      BEGIN INSERT INTO commit_child VALUES (1); END;
  `))
  // A deferred constraint passes nested backend savepoints and fails the store's actual COMMIT.
  expect(await first.store.execute({ ...read(operation), snapshot: replacement })).toEqual({ status: 'error', code: 'write-failed' })
  expect(await first.store.execute(read(reading))).toEqual({ status: 'stored', snapshot: before })
  first.database.close()
  const next = h.fresh()
  expect(await next.store.execute(read(reading))).toEqual({ status: 'stored', snapshot: before })
  next.database.transaction(db => db.exec('DROP TRIGGER fail_outer_commit'))
  expect(await next.store.execute({ ...read(operation), snapshot: replacement })).toEqual({ status: 'ok' })
  expect(await next.store.execute(read(reading))).toEqual({ status: 'stored', snapshot: replacement })
})

it.each(['invalid', 'version', 'decrypt'])('preserves an unreadable %s source and recovers without poisoning the queue', async mode => {
  const h = await setup(); await h.seed(mode === 'invalid' ? [{ ...thread(), thread: null }] : [thread()], mode === 'version' ? 9 : 1)
  const before = await h.persistence.read('chat-history'), decrypt = h.encryption.decrypt
  if (mode === 'decrypt') h.encryption.decrypt = () => { throw Error('private') }
  const { store } = h.fresh()
  expect(await store.execute(read())).toEqual({ status: 'error', code: mode === 'version' ? 'unsupported-version' : 'unreadable' })
  expect(await h.persistence.read('chat-history')).toEqual(before)
  h.encryption.decrypt = decrypt; await h.seed([thread()])
  expect(await store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
})

it('retries retirement after commit without replaying removed records, even with reused identities', async () => {
  const h = await setup(); await h.seed([timeline(), thread(), timeline('b'), thread('b'), list])
  const erase = h.secureStore.delete
  h.secureStore.delete = async () => { throw Error('cleanup') }
  const first = h.fresh()
  expect(await first.store.execute(read())).toMatchObject({ status: 'stored' })
  expect(await first.store.execute(read('removeConversation'))).toEqual({ status: 'error', code: 'remove-failed' })
  first.database.close()
  h.secureStore.get = async () => { throw Error('source replay') }
  h.secureStore.delete = erase
  const next = h.fresh()
  expect(await next.store.execute(read())).toEqual({ status: 'missing' })
  expect(await next.store.execute(read('readThread'))).toEqual({ status: 'missing' })
  expect(await next.store.execute({ operation: 'readList', serverId: 'a' })).toEqual({ status: 'stored', snapshot: { ...list, conversations: [list.conversations[1]] } })
  expect(await next.store.execute(read('readThread', 'b'))).toEqual({ status: 'stored', snapshot: thread('b') })
  expect(await next.store.execute({ ...read('replaceThread'), snapshot: thread() })).toEqual({ status: 'ok' })
  next.database.close()
  expect(await h.fresh().store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
  expect(await h.persistence.read('chat-history')).toBeNull()
})

it.each(['conversation', 'host'])('orders a held import before %s removal and rejects queued stale saves after identical reuse', async scope => {
  const h = await setup(); await h.seed([timeline(), thread(), timeline('b'), thread('b'), list])
  let release = () => {}, entered = () => {}
  const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  const get = h.secureStore.get
  h.secureStore.get = async name => { entered(); await held; return get(name) }
  const first = h.fresh(), handler = createChatHistoryHandler({ store: first.store, log: h.log,
    pairedServers: { loadById: async () => ({ server: 'a', relay: '', token: '', server_static_pubkey: '' }) } })
  const importing = handler(null, read())
  await started
  const removal = scope === 'host' ? handler.clearServer('a', async () => ({ matched: true, remaining: 1 }))
    : handler(null, read('removeConversation'))
  const stale = handler(null, { ...read('replaceThread'), snapshot: thread() })
  release(); await importing; await removal
  expect(await stale).toEqual({ status: 'error', code: 'unknown-host' })
  first.database.close()
  expect(await h.fresh().store.execute(read('readThread'))).toEqual({ status: 'missing' })
  expect(await h.fresh().store.execute(read('readThread', 'b'))).toEqual({ status: 'stored', snapshot: thread('b') })
  expect(await handler(null, { ...read('replaceThread'), snapshot: thread() })).toEqual({ status: 'ok' })
  expect(await h.fresh().store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
})

it('drains accepted import before close and rejects later admission', async () => {
  const h = await setup(); await h.seed([thread()])
  const { store } = h.fresh()
  const importing = store.execute(read('readThread')), closing = store.close()
  expect(await importing).toEqual({ status: 'stored', snapshot: thread() })
  await closing
  expect(await store.execute(read('readThread'))).toEqual({ status: 'error', code: 'unreadable' })
  expect(await h.fresh().store.execute(read('readThread'))).toEqual({ status: 'stored', snapshot: thread() })
})

it('preserves committed records and source when database admission or encryption is unavailable', async () => {
  const h = await setup(), first = h.fresh()
  const backend = createIndexedLegacyHistory({ database: first.database, encryption: h.encryption, log: h.log })
  expect(await backend.execute({ ...read('replaceTimeline'), snapshot: timeline('a', 'committed') })).toEqual({ status: 'ok' })
  await h.seed([thread()])
  const source = await h.persistence.read('chat-history')
  first.database.transaction(db => db.pragma('user_version = 99'))
  first.database.close()
  const before = await readFile(join(h.root, 'history', 'history.sqlite'))
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'error', code: 'unsupported-version' })
  expect(await readFile(join(h.root, 'history', 'history.sqlite'))).toEqual(before)
  expect(await h.persistence.read('chat-history')).toEqual(source)
  h.encryption.isAvailable = () => false
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'error', code: 'encryption-unavailable' })
  expect(await h.persistence.read('chat-history')).toEqual(source)
})
