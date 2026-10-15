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
