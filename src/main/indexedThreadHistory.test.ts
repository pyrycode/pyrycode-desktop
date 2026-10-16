import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { createHistoryDatabase } from './historyDatabase'
import { createIndexedThreadHistory } from './indexedThreadHistory'
import { parseChatHistorySnapshot } from '../shared/chatHistory'
import type { SecretEncryption } from './secureStore'

const roots: string[] = [], owners: ReturnType<typeof createHistoryDatabase>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of owners.splice(0)) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function snapshot(count = 9, serverId = 'Host', conversationId = 'Chat') {
  const items = Array.from({ length: count }, (_, id) => ({ id, kind: 'future', rev: id,
    ...(id % 5 === 0 ? {} : { order: [null, 'inert', 2, 2, 100][id % 5] }), hidden: id % 2 === 0,
    text: 'TEXT-SENTINEL-1974', attachment: { filename: 'ATTACHMENT-SENTINEL-1974' },
    ...JSON.parse('{"__proto__":{"constructor":null},"unknown":{"payload":"UNKNOWN-SENTINEL-1974"}}'),
    cursor: 'CURSOR-SENTINEL-1974' }))
  return { version: 1, kind: 'daemon-items', serverId, conversationId, thread: {
    hostId: serverId, conversationId, epoch: 'epoch', items, arrivalOrder: items.map(i => i.id).reverse(),
    version: 300, checkpoint: 100, uncommittedVersion: 50,
    ranges: [{ start: 0, end: 3 }, { start: 100, end: 101 }, { start: 900, end: 950 }],
    olderAvailable: true, repair: { fromVersion: 100, throughVersion: 200 }
  } }
}
const ask = (operation: string, extra: object = {}, serverId = 'Host', conversationId = 'Chat') =>
  ({ operation, serverId, ...(operation === 'removeServer' ? {} : { conversationId }), ...extra })
const put = (s: { serverId: string; conversationId: string } = snapshot()) => ask('replaceThread', { snapshot: s }, s.serverId, s.conversationId)
const newest = (limit = 2) => ask('newestThreadPage', { limit })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'thread-history-')); roots.push(root)
  const encryption: SecretEncryption = { isAvailable: () => true,
    encrypt: b => b.map(x => x ^ 173), decrypt: b => b.map(x => x ^ 173) }
  const lines: unknown[] = []
  const fresh = () => {
    const database = createHistoryDatabase({ userDataPath: root }); owners.push(database)
    return { database, store: createIndexedThreadHistory({ database, encryption, log: { event: e => lines.push(e) } }) }
  }
  return { root, encryption, lines, fresh, ...fresh() }
}
async function page(store: ReturnType<typeof createIndexedThreadHistory>, request = newest()) {
  const result = await store.execute(request)
  expect(result.status).toBe('page')
  if (result.status !== 'page') throw new Error('expected page')
  return result.page
}
const error = (code: string) => ({ status: 'error', code })
const stored = (s: unknown) => ({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })

it('exact round trip and first-arrival restart retain covered unfinished progress', async () => {
  const h = setup(), s = snapshot()
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  h.database.close(); const fresh = h.fresh()
  const result = await fresh.store.execute(ask('readThread'))
  expect(result).toEqual(stored(s))
  if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') throw new Error('expected thread')
  expect(result.snapshot.thread.arrivalOrder).toEqual(s.thread.arrivalOrder)
  const p = await page(fresh.store)
  expect(p.metadata.uncommittedVersion).toBe(50)
  expect(p.metadata.repair).toEqual(s.thread.repair)
  expect(p.arrivalPositions).toEqual([1, 0])
  expect(p.partial).toBe(true)
})

it('200-item windows traverse held order exactly once across ties/null/unordered items', async () => {
  const h = setup(), s = snapshot(611)
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  h.database.close(); const fresh = h.fresh()
  let p = await page(fresh.store, newest(200)), all = [...p.items]
  expect(p.items).toEqual(s.thread.items.slice(-200))
  const metadata = p.metadata
  while (p.continuation !== null) {
    p = await page(fresh.store, ask('beforeThreadPage', { limit: 200, continuation: p.continuation }))
    expect(p.metadata).toEqual(metadata)
    expect(p.items.length).toBeLessThanOrEqual(200)
    all = [...p.items, ...all]
  }
  expect(all).toEqual(s.thread.items)
  expect(new Set(all.map(i => i.id)).size).toBe(611)
  expect(await fresh.store.execute(ask('readThread'))).toEqual(stored(s))
})

it.each([0, 4096])('follows boundary-string continuations after reopen with %i bytes of protection overhead', async padding => {
  const h = setup(), s = snapshot(2, '\ud800'.repeat(8192), '\udfff'.repeat(8192))
  s.thread.epoch = '\ud801'.repeat(8192)
  const encrypt = h.encryption.encrypt, decrypt = h.encryption.decrypt
  // Include the production bridge's base64 expansion plus deliberately large fixed overhead.
  h.encryption.encrypt = b => encrypt(Buffer.concat([Buffer.alloc(padding), Buffer.from(Buffer.from(b).toString('base64'))]))
  h.encryption.decrypt = b => Buffer.from(Buffer.from(decrypt(b)).subarray(padding).toString(), 'base64')
  const request = (operation: string, extra: object = {}) => ask(operation, { limit: 1, ...extra }, s.serverId, s.conversationId)
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  h.database.close(); const fresh = h.fresh()
  const newest = await page(fresh.store, request('newestThreadPage'))
  expect(newest.items).toEqual(s.thread.items.slice(1))
  expect(newest.continuation).not.toBeNull()
  fresh.database.close(); const reopened = h.fresh()
  const before = request('beforeThreadPage', { continuation: newest.continuation })
  expect(await page(reopened.store, before)).toMatchObject({ items: s.thread.items.slice(0, 1), continuation: null })
  expect(newest.continuation!.length).toBeLessThanOrEqual(8192)
  expect(h.encryption.decrypt(Buffer.from(newest.continuation!, 'base64url')).byteLength).toBeLessThanOrEqual(101)
  const replacement = { ...s, thread: { ...s.thread, epoch: 'replacement' } }
  expect(await reopened.store.execute(put(replacement))).toEqual({ status: 'ok' })
  expect(await reopened.store.execute(before)).toEqual(error('invalid-request'))
})

it.each([0, 49153])('never emits an inadmissible continuation from %i protected bytes', async size => {
  const h = setup(), s = snapshot()
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  vi.spyOn(h.encryption, 'encrypt').mockReturnValueOnce(new Uint8Array(size))
  expect(await h.store.execute(newest())).toEqual(error('unreadable'))
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(s))
})

it('optional defaults, saved empty, missing, empty/unordered anchors and sparse ranges', async () => {
  const h = setup(), s = snapshot(0)
  const old = { ...s, thread: { ...s.thread, arrivalOrder: undefined, olderAvailable: undefined, uncommittedVersion: undefined } }
  expect(await h.store.execute(ask('readThread'))).toEqual({ status: 'missing' })
  expect(await h.store.execute(newest())).toEqual({ status: 'missing' })
  expect(await h.store.execute(put(old))).toEqual({ status: 'ok' })
  h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(ask('readThread'))).toEqual(stored(old))
  const empty = await page(fresh.store)
  expect(empty).toMatchObject({ items: [], ranges: s.thread.ranges.slice(-1), continuation: null })
  expect(empty).not.toHaveProperty('arrivalPositions')
  expect(empty.metadata).not.toHaveProperty('olderAvailable')
  expect(empty.metadata.uncommittedVersion).toBe(300)
  const completeOld = { ...old, thread: { ...old.thread, version: 100, ranges: [] } }
  await fresh.store.execute(put(completeOld))
  expect(await page(fresh.store)).toMatchObject({ metadata: { uncommittedVersion: 0 }, ranges: [], continuation: null })
  const ordered = snapshot(10)
  await fresh.store.execute(put(ordered))
  expect((await page(fresh.store, newest(10))).ranges).toEqual(ordered.thread.ranges)
  expect((await page(fresh.store, newest(1))).ranges).toEqual([ordered.thread.ranges[1], ordered.thread.ranges[2]])
})

it('invalid requests and limits cannot mutate or create storage', async () => {
  const h = setup()
  for (const limit of [0, -1, 201, 1.5, NaN, Infinity, '2', null, undefined]) {
    expect(await h.store.execute(ask('newestThreadPage', { limit }))).toEqual(error('invalid-request'))
  }
  expect(readdirSync(h.root)).toEqual([])
  expect(await h.store.execute(put(snapshot()))).toEqual({ status: 'ok' })
  for (const request of [ask('replaceThread', { snapshot: snapshot(2, 'Other') }),
    ask('replaceThread', { snapshot: { ...snapshot(), thread: { ...snapshot().thread, hostId: 'Other' } } }),
    { ...newest(), unexpected: 1 }, ask('beforeThreadPage', { limit: 2 }), ask('readTimeline')]) {
    expect(await h.store.execute(request)).toEqual(error('invalid-request'))
  }
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(snapshot()))
})

it('continuations reject replaced/recreated snapshots, wrong owners/formats and malformed input', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); const token = (await page(h.store)).continuation
  h.database.close(); const fresh = h.fresh()
  const before = (continuation: unknown, host = 'Host') => ask('beforeThreadPage', { limit: 2, continuation }, host)
  expect((await page(fresh.store, before(token))).items).toEqual(s.thread.items.slice(-4, -2))
  for (const bad of ['', 'daemon-cursor', {}, 1, null, 'a'.repeat(65537)]) {
    expect(await fresh.store.execute(before(bad))).toEqual(error('invalid-request'))
  }
  await fresh.store.execute(put(snapshot(9, 'Other')))
  expect(await fresh.store.execute(before(token, 'Other'))).toEqual(error('invalid-request'))
  await fresh.store.execute(put(snapshot(9, 'Host', 'Other')))
  expect(await fresh.store.execute(ask('beforeThreadPage', { limit: 2, continuation: token }, 'Host', 'Other'))).toEqual(error('invalid-request'))
  const raw = JSON.parse(Buffer.from(h.encryption.decrypt(Buffer.from(token!, 'base64url'))).toString())
  for (const replacement of [{ ...raw, format: 'timeline' }, { ...raw, epoch: 'wrong' }, { ...raw, before: 999 }, { ...raw, extra: true }]) {
    const invalid = Buffer.from(h.encryption.encrypt(Buffer.from(JSON.stringify(replacement)))).toString('base64url')
    expect(await fresh.store.execute(before(invalid))).toEqual(error('invalid-request'))
  }
  await fresh.store.execute(put(s))
  expect(await fresh.store.execute(before(token))).toEqual(error('invalid-request'))
  const token2 = (await page(fresh.store)).continuation
  await fresh.store.execute(ask('removeConversation')); await fresh.store.execute(put(s))
  expect(await fresh.store.execute(before(token2))).toEqual(error('invalid-request'))
})

it('selected reads/JSON decodes/decrypts stay bounded when unrelated history grows', async () => {
  const h = setup()
  async function measure(count: number) {
    const s = snapshot(count)
    s.thread.items = s.thread.items.map((item, i) => ({ ...item, order: i < count - 2 ? i * 10 : 999999 }))
    s.thread.ranges = Array.from({ length: count }, (_, i) => ({ start: i * 10, end: i * 10 + 1 }))
    await h.store.execute(put(s)); let rows = 0
    h.database.transaction(db => {
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (sql.startsWith('SELECT')) {
          const all = statement.all.bind(statement), get = statement.get.bind(statement)
          vi.spyOn(statement, 'all').mockImplementation((...args) => { const result = all(...args); rows += result.length; return result })
          vi.spyOn(statement, 'get').mockImplementation((...args) => { const result = get(...args); rows += result ? 1 : 0; return result })
        }
        return statement
      })
    })
    const decrypt = vi.spyOn(h.encryption, 'decrypt'), decode = vi.spyOn(JSON, 'parse')
    const p = await page(h.store)
    const work = [rows, decrypt.mock.calls.length, decode.mock.calls.length]
    expect(work).toEqual([5, 4, 4])
    expect(p.items.length).toBe(2); expect(p.ranges).toEqual(s.thread.ranges.slice(-1))
    vi.restoreAllMocks(); return work
  }
  expect(await measure(1000)).toEqual(await measure(10))
})

it('lossless scoped cleanup preserves legacy and equal ids on other hosts', async () => {
  const h = setup(), ids = ['Host', 'host', 'Host\0', '\ud800', '\ud801', '\ufffd']
  for (const host of ids) for (const chat of ids) expect(await h.store.execute(put(snapshot(2, host, chat)))).toEqual({ status: 'ok' })
  h.database.transaction(db => db.prepare('INSERT INTO legacy_scopes VALUES (?, ?, ?)').run('ignored', Buffer.from('Host', 'utf16le'), Buffer.from('Host', 'utf16le')))
  await h.store.execute(ask('removeConversation', {}, '\ud800', '\ud801'))
  await h.store.execute(ask('removeServer', {}, 'Host'))
  h.database.close(); const fresh = h.fresh()
  for (const host of ids) for (const chat of ids) {
    expect(await fresh.store.execute(ask('readThread', {}, host, chat))).toEqual(
      host === 'Host' || host === '\ud800' && chat === '\ud801' ? { status: 'missing' } : stored(snapshot(2, host, chat)))
  }
  expect(fresh.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes').all())).toEqual([{ identity: 'ignored' }])
})

it('transaction failures preserve committed data and never expose sentinels', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s))
  h.database.transaction(db => db.exec("CREATE TRIGGER reject_thread BEFORE INSERT ON thread_records WHEN NEW.kind = 'range' BEGIN SELECT RAISE(ABORT, 'injected'); END"))
  expect(await h.store.execute(put(snapshot(3)))).toEqual(error('write-failed'))
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(s))
  h.database.transaction(db => db.exec("DROP TRIGGER reject_thread; CREATE TRIGGER reject_remove BEFORE DELETE ON thread_scopes BEGIN SELECT RAISE(ABORT, 'injected'); END"))
  expect(await h.store.execute(ask('removeServer'))).toEqual(error('remove-failed'))
  h.database.transaction(db => db.exec('DROP TRIGGER reject_remove'))
  vi.spyOn(h.encryption, 'encrypt').mockImplementationOnce(() => { throw new Error('UNKNOWN-SENTINEL-1974') })
  expect(await h.store.execute(put(snapshot(4)))).toEqual(error('write-failed'))
  h.database.close(); expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored(s))
  const bytes = Buffer.concat(readdirSync(join(h.root, 'history')).map(name => readFileSync(join(h.root, 'history', name))))
  for (const name of ['TEXT', 'ATTACHMENT', 'UNKNOWN', 'CURSOR']) {
    expect(bytes.includes(Buffer.from(name + '-SENTINEL-1974'))).toBe(false)
    expect(JSON.stringify(h.lines)).not.toContain(name + '-SENTINEL-1974')
  }
})

it.each(['header', 'ordinal', 'arrival', 'order', 'membership', 'range', 'missing'])('malformed saved %s is unreadable, never overwritten', async kind => {
  const h = setup(); await h.store.execute(put(snapshot()))
  h.database.transaction(db => {
    if (kind === 'header') db.prepare("UPDATE thread_records SET payload = ? WHERE kind = 'header'").run(h.encryption.encrypt(Buffer.from('{}')))
    if (kind === 'ordinal') db.exec("UPDATE thread_records SET ordinal = 99 WHERE kind = 'item' AND ordinal = 8")
    if (kind === 'arrival') db.exec("UPDATE thread_records SET arrival = NULL WHERE kind = 'item' AND ordinal = 8")
    if (kind === 'order') db.exec("UPDATE thread_records SET item_order = 55 WHERE kind = 'item' AND ordinal = 8")
    if (kind === 'membership') db.exec("UPDATE thread_records SET range_ordinal = NULL WHERE kind = 'item' AND ordinal = 8")
    if (kind === 'range') db.exec("UPDATE thread_records SET range_end = 999 WHERE kind = 'range' AND ordinal = 2")
    if (kind === 'missing') db.exec("DELETE FROM thread_records WHERE kind = 'item' AND ordinal = 8")
  })
  h.database.close(); const fresh = h.fresh()
  for (const request of [ask('readThread'), newest(), put(snapshot(1)), ask('removeConversation'), ask('removeServer')]) {
    expect(await fresh.store.execute(request)).toEqual(error('unreadable'))
  }
})

it('schema-2 additive migration rolls back with failed authoritative writes and preserves legacy facts', async () => {
  const h = setup()
  h.database.transaction(db => db.prepare('INSERT INTO legacy_scopes VALUES (?, ?, ?)').run('ignored', Buffer.from('Host', 'utf16le'), Buffer.from('Chat', 'utf16le')))
  await h.store.execute(put(snapshot())); const token = (await page(h.store)).continuation
  h.database.transaction(db => db.exec('DROP TABLE thread_records; DROP TABLE thread_scopes; PRAGMA user_version = 2'))
  h.database.close()
  const path = join(h.root, 'history/history.sqlite'), before = readFileSync(path), fresh = h.fresh()
  expect(await fresh.store.execute(ask('beforeThreadPage', { limit: 2, continuation: token }))).toEqual(error('invalid-request'))
  expect(readFileSync(path).equals(before)).toBe(true)
  vi.spyOn(h.encryption, 'encrypt').mockImplementationOnce(() => { throw new Error('TEXT-SENTINEL-1974') })
  expect(await fresh.store.execute(put(snapshot()))).toEqual(error('write-failed'))
  expect(readFileSync(path).equals(before)).toBe(true)
  const disk = new Database(path)
  expect(disk.pragma('user_version', { simple: true })).toBe(2)
  expect(disk.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'thread_%'").all()).toEqual([])
  disk.close()
  expect(await fresh.store.execute(put(snapshot()))).toEqual({ status: 'ok' })
  expect(fresh.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes').all())).toEqual([{ identity: 'ignored' }])
})

it.each(['legacy', 'authoritative'])('preserves the %s schema-3 layout when both migrations converge', async family => {
  const h = setup(), s = snapshot()
  h.database.transaction(db => db.prepare('INSERT INTO legacy_scopes VALUES (?, ?, ?)').run('ignored', Buffer.from('Host', 'utf16le'), Buffer.from('Chat', 'utf16le')))
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  h.database.transaction(db => {
    db.exec(family === 'legacy' ? 'DROP TABLE thread_records; DROP TABLE thread_scopes' : 'DROP INDEX legacy_receipt_start')
    db.pragma('user_version = 3')
  })
  h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(ask('readThread'))).toEqual(family === 'legacy' ? { status: 'missing' } : stored(s))
  expect(fresh.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes').all())).toEqual([{ identity: 'ignored' }])
  fresh.database.transaction(db => {
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_receipt_start'").get()).toEqual({ name: 'legacy_receipt_start' })
  })
})

it('empty replacements always rotate durable identity and invalidate older continuations', async () => {
  const h = setup(); await h.store.execute(put(snapshot()))
  const token = (await page(h.store)).continuation
  const identity = () => h.database.transaction(db => db.prepare('SELECT identity FROM thread_scopes').get())
  await h.store.execute(put(snapshot(0))); const first = identity()
  await h.store.execute(put(snapshot(0))); expect(identity()).not.toEqual(first)
  h.database.close()
  expect(await h.fresh().store.execute(ask('beforeThreadPage', { limit: 2, continuation: token }))).toEqual(error('invalid-request'))
})

it('nonindexable orders remain inert while only safe nonnegative orders select coverage', async () => {
  const h = setup(), s = snapshot(7)
  const values = [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '2', 2, 3]
  s.thread.items = s.thread.items.map((item, i) => ({ ...item, order: values[i] }))
  await h.store.execute(put(s)); h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(ask('readThread'))).toEqual(stored(s))
  const p = await page(fresh.store, newest(7))
  expect(p.items).toEqual(s.thread.items)
  expect(p.ranges).toEqual([s.thread.ranges[0], s.thread.ranges[2]])
})

it('unavailable encryption never opens storage and unsupported schemas are preserved', async () => {
  const h = setup(); vi.spyOn(h.encryption, 'isAvailable').mockReturnValue(false)
  expect(await h.store.execute(put(snapshot()))).toEqual(error('encryption-unavailable'))
  expect(readdirSync(h.root)).toEqual([])
  vi.restoreAllMocks(); await h.store.execute(put(snapshot())); h.database.close()
  const path = join(h.root, 'history/history.sqlite'), db = new Database(path)
  db.pragma('user_version = 999'); db.close()
  const bytes = readFileSync(path)
  expect(await h.fresh().store.execute(put(snapshot()))).toEqual(error('unsupported-version'))
  expect(readFileSync(path).equals(bytes)).toBe(true)
})
