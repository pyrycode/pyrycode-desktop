import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { createHistoryDatabase } from './historyDatabase'
import { createIndexedLegacyHistory } from './indexedLegacyHistory'
import { parseChatHistorySnapshot } from '../shared/chatHistory'
import type { SecretEncryption } from './secureStore'

const roots: string[] = []
const owners: ReturnType<typeof createHistoryDatabase>[] = []
afterEach(() => {
  for (const db of owners.splice(0)) db.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const snapshot = (serverId = 'Host', conversationId = 'Chat') => ({
  version: 1, kind: 'timeline', serverId, conversationId, prependedRows: 2,
  items: [{ kind: 'assistantText', turnId: 't', text: 'MESSAGE-SENTINEL-1979', createdAt: 2099 },
    { kind: 'userText', text: 'second', messageId: 'm', createdAt: 1900,
      attachments: [{ attachmentId: 'a', filename: 'ATTACHMENT-SENTINEL-1979', mimeType: 'image/png', size: 1 }] }],
  rowIdentity: { rowKeys: [-2, 5], nextRowKey: 10 },
  coverage: { status: 'received', cursor: 'COVERAGE-SENTINEL-1979', atStart: false },
  newestCursor: 'NEWEST-SENTINEL-1979',
  served: { ids: [1, 3, 7], highestId: 7, receipts: [
    { ids: [1, 3], cursor: 'RECEIPT-SENTINEL-1979', atStart: false },
    { ids: [3, 7], cursor: '', atStart: true }] },
  display: [{ id: 1, rowKey: -2, kind: 'row', item: { kind: 'assistantText', turnId: 't', text: 'fragment' } },
    { id: 3, rowKey: 5, kind: 'suppressed' }, { id: 7, kind: 'patch', toolUseId: 'orphan', result: { resultSummary: 'result', isError: false } }],
  gaps: [{ olderId: 3, newerId: 7, cursor: 'GAP-SENTINEL-1979', refusedCursors: ['REFUSED-SENTINEL-1979', ''] },
    { legacyRowKeys: [-2, 5], newerId: 10 }]
})
const replace = (s: unknown, serverId = 'Host', conversationId = 'Chat') =>
  ({ operation: 'replaceTimeline', serverId, conversationId, snapshot: s })
const read = (serverId = 'Host', conversationId = 'Chat') => ({ operation: 'readTimeline', serverId, conversationId })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'indexed-history-')); roots.push(root)
  const encryption: SecretEncryption = { isAvailable: () => true,
    encrypt: b => b.map(x => x ^ 173), decrypt: b => b.map(x => x ^ 173) }
  const lines: unknown[] = []
  const fresh = () => {
    const database = createHistoryDatabase({ userDataPath: root }); owners.push(database)
    return { database, store: createIndexedLegacyHistory({ database, encryption, log: { event: e => { lines.push(e) } } }) }
  }
  return { root, encryption, lines, fresh, ...fresh() }
}
function protectedBytes(root: string): Buffer {
  return Buffer.concat(readdirSync(join(root, 'history')).map(name => readFileSync(join(root, 'history', name))))
}

const pageRequest = (limit = 200, serverId = 'Host', conversationId = 'Chat') => ({ serverId, conversationId, limit })
const plain = (count: number) => ({ version: 1, kind: 'timeline', serverId: 'Host', conversationId: 'Chat',
  items: Array.from({ length: count }, (_, i) => ({ kind: 'userText', text: `row-${i % 3}`, createdAt: i % 2 })),
  prependedRows: 7, coverage: { status: 'unknown' } })

it('traverses held order with ties and fallback identity across fresh instances in 200-row windows', async () => {
  const h = setup(); const s = plain(603)
  expect(await h.store.execute(replace(s))).toEqual({ status: 'ok' })
  let current = { database: h.database, store: h.store }
  let result = await current.store.newestPage(pageRequest())
  const keys: number[] = []; const items: unknown[] = []
  for (;;) {
    expect(['newest-page', 'before-page']).toContain(result.status)
    if (result.status !== 'newest-page' && result.status !== 'before-page') throw new Error('expected page')
    expect(result.items.length).toBeLessThanOrEqual(200)
    expect(result.savedCoverage).toEqual({ status: 'unknown' })
    keys.unshift(...result.rowKeys); items.unshift(...result.items)
    if (result.continuation === null) break
    const continuation = result.continuation
    current.database.close(); current = h.fresh()
    result = await current.store.beforePage({ ...pageRequest(), continuation })
  }
  expect(keys).toEqual(s.items.map((_, i) => i - 7))
  expect(items).toEqual(expect.arrayContaining(s.items))
  const normalized = parseChatHistorySnapshot(s)
  expect(items).toEqual(normalized.kind === 'timeline' ? normalized.items : [])
  expect(await current.store.execute(read())).toEqual({ status: 'stored', snapshot: normalized })
})

it('distinguishes missing and saved-empty pages without claiming completeness', async () => {
  const h = setup()
  expect(await h.store.newestPage(pageRequest())).toEqual({ status: 'missing' })
  await h.store.execute(replace(plain(0))); h.database.close()
  expect(await h.fresh().store.newestPage(pageRequest())).toMatchObject({ status: 'newest-page',
    items: [], rowKeys: [], continuation: null, savedCoverage: { status: 'unknown' } })
})

it('projects fragmented evidence with shared numeric boundaries and bounded receipt memberships', async () => {
  const h = setup(); const s = { ...snapshot(), gaps: [{ olderId: 0, newerId: 3 }, { olderId: 3, newerId: 7 },
    { legacyRowKeys: [-2, 5], newerId: 10 }] }
  await h.store.execute(replace(s)); h.database.close()
  const fresh = h.fresh()
  const result = await fresh.store.newestPage(pageRequest(1))
  expect(result).toMatchObject({ status: 'newest-page', rowKeys: [5],
    savedCoverage: s.coverage, newestCursor: s.newestCursor, servedIds: [3],
    receipts: [{ identity: 0, partial: true, ids: [3], cursor: 'RECEIPT-SENTINEL-1979' },
      { identity: 1, partial: true, ids: [3], cursor: '' }],
    gaps: [{ identity: 0, partial: true, olderId: 0, newerId: 3 },
      { identity: 1, partial: true, olderId: 3, newerId: 7 },
      { identity: 2, partial: true, legacyRowKeys: [5], newerId: 10 }] })
  if (result.status !== 'newest-page') throw new Error('expected page')
  expect(result.display).toEqual([parseChatHistorySnapshot(s).kind === 'timeline' &&
    expect.objectContaining({ id: 3, rowKey: 5, kind: 'suppressed' })])
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })
})

it('rejects invalid and stale local continuations including identical replacement and delete/recreate', async () => {
  const h = setup(); const s = plain(3)
  await h.store.execute(replace(s))
  const page = await h.store.newestPage(pageRequest(1))
  if (page.status !== 'newest-page' || !page.continuation) throw new Error('expected continuation')
  const invalid = { status: 'error', code: 'invalid-request' }
  for (const limit of [0, -1, 201, 1.5, NaN, Infinity, '1', null, undefined])
    expect(await h.store.newestPage({ ...pageRequest(), limit })).toEqual(invalid)
  for (const continuation of ['', null, {}, { ...page.continuation, format: 'daemon-items' },
    { ...page.continuation, before: 999 }, { ...page.continuation, before: -1 },
    { ...page.continuation, before: 1.5 }, { ...page.continuation, extra: true },
    { ...page.continuation, serverId: 'host' }, { ...page.continuation, conversationId: 'peer' }])
    expect(await h.store.beforePage({ ...pageRequest(), continuation })).toEqual(invalid)
  const next = { ...pageRequest(), continuation: page.continuation }
  await h.store.execute(replace(s)); expect(await h.store.beforePage(next)).toEqual(invalid)
  await h.store.execute({ operation: 'removeConversation', serverId: 'Host', conversationId: 'Chat' })
  expect(await h.store.beforePage(next)).toEqual(invalid)
  await h.store.execute(replace(s)); expect(await h.store.beforePage(next)).toEqual(invalid)
})

it.each(['serverId', 'conversationId'] as const)('pages exact UTF-16 %s without owner aliasing', async coordinate => {
  const h = setup(); const variants = ['\ud800', '\ud801', '\ufffd', '\udc00', '\ud83d\ude00']
  for (const [i, owner] of variants.entries()) {
    const s = { ...plain(3), [coordinate]: owner, prependedRows: i }
    await h.store.execute(replace(s, s.serverId, s.conversationId))
  }
  h.database.close(); const fresh = h.fresh()
  for (const [i, owner] of variants.entries()) {
    const request = { ...pageRequest(1), [coordinate]: owner }
    const page = await fresh.store.newestPage(request)
    expect(page).toMatchObject({ status: 'newest-page', rowKeys: [2 - i] })
    if (page.status !== 'newest-page') throw new Error('expected page')
    expect(await fresh.store.beforePage({ ...request, continuation: page.continuation })).toMatchObject({ rowKeys: [1 - i] })
    expect(await fresh.store.beforePage({ ...request, [coordinate]: variants[(i + 1) % variants.length],
      continuation: page.continuation })).toEqual({ status: 'error', code: 'invalid-request' })
  }
})

it.each([
  "UPDATE legacy_records SET payload = x'00' WHERE kind = 'row' AND ordinal = 1",
  "UPDATE legacy_records SET row_key = 6 WHERE kind = 'row' AND ordinal = 1",
  "UPDATE legacy_records SET entry_id = 4 WHERE kind = 'display' AND ordinal = 1",
  "UPDATE legacy_records SET entry_id = 1 WHERE kind = 'receipt-id' AND parent = 0 AND ordinal = 1",
  "UPDATE legacy_records SET row_key = -2 WHERE kind = 'gap-key' AND ordinal = 1"
])('rejects corrupted selected associations without changing saved data: %s', async sql => {
  const h = setup(); await h.store.execute(replace(snapshot()))
  h.database.transaction(db => db.exec(sql)); h.database.close()
  const before = protectedBytes(h.root)
  expect(await h.fresh().store.newestPage(pageRequest(2))).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(before)
})

it('bounds record reads, decodes and decrypts despite a receipt spanning unrelated older history', async () => {
  const h = setup()
  const measure = async (older: number) => {
    const items = Array.from({ length: older + 200 }, (_, i) => ({ kind: 'assistantText', turnId: `${i}`, text: 'x' }))
    const ids = items.map((_, i) => i)
    const s = { ...plain(0), items, prependedRows: 0, rowIdentity: { rowKeys: ids, nextRowKey: ids.length },
      coverage: { status: 'received', cursor: '', atStart: false },
      served: { ids, highestId: ids.at(-1), receipts: [
        { ids, cursor: 'spanning', atStart: false },
        ...ids.slice(0, older).map(id => ({ ids: [id], cursor: `unrelated-${id}`, atStart: false }))] },
      display: items.map((item, i) => ({ id: i, rowKey: i, kind: 'row', item })),
      gaps: Array.from({ length: Math.floor(older / 3) }, (_, i) => ({ olderId: i * 3, newerId: i * 3 + 2,
        refusedCursors: [`old-${i}`, `older-${i}`] })) }
    await h.store.execute(replace(s))
    const decrypt = vi.spyOn(h.encryption, 'decrypt'); const decode = vi.spyOn(JSON, 'parse')
    const reads = { row: 0, evidence: 0, order: 0 }
    let result: ReturnType<typeof h.store.newestPage> | undefined
    h.database.transaction(db => {
      const prepare = db.prepare.bind(db)
      const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        for (const method of ['all', 'get'] as const) {
          const original = statement[method].bind(statement)
          vi.spyOn(statement, method).mockImplementation((...args: unknown[]) => {
            const value = original(...args)
            if (sql.includes('legacy_records')) for (const row of Array.isArray(value) ? value : value ? [value] : []) {
              if ('payload' in row) row.kind === 'row' ? reads.row++ : reads.evidence++
              else reads.order++
            }
            return value
          })
        }
        return statement
      })
      // Methods perform synchronous transactions before their promise resolves.
      result = h.store.newestPage(pageRequest())
      spy.mockRestore()
    })
    expect(await result).toMatchObject({ status: 'newest-page', items: expect.arrayContaining(items.slice(-200)) })
    const counts = { ...reads, decrypt: decrypt.mock.calls.length, decode: decode.mock.calls.length }
    decrypt.mockRestore(); decode.mockRestore()
    expect(reads.row).toBe(200); expect(reads.order).toBeLessThanOrEqual(1)
    expect(counts.decrypt).toBe(reads.row + reads.evidence); expect(counts.decode).toBe(counts.decrypt)
    return counts
  }
  expect(await measure(600)).toEqual(await measure(2000))
})

it('selects contribution ranges and only the necessary adjacent cursor anchor', async () => {
  const h = setup(); const item = { kind: 'assistantText', turnId: 't', text: 'committed whole' }
  const s = { ...plain(0), items: [item], rowIdentity: { rowKeys: [9], nextRowKey: 10 },
    coverage: { status: 'received', cursor: 'scope', atStart: true },
    display: [{ kind: 'row', id: 100, lastId: 102, rowKey: 9, item: { ...item, text: 'selected fragment' } }],
    served: { ids: [100, 101, 102, 110, 120], highestId: 120, receipts: [
      { ids: [100, 101, 102], cursor: 'range', atStart: false },
      { ids: [110], cursor: 'adjacent', atStart: false }, { ids: [120], cursor: 'unrelated', atStart: true }] },
    gaps: [{ olderId: 102, newerId: 110, refusedCursors: ['not-selected'] }] }
  expect(await h.store.execute(replace(s))).toEqual({ status: 'ok' }); h.database.close()
  const fresh = h.fresh(); const decrypt = vi.spyOn(h.encryption, 'decrypt')
  const result = await fresh.store.newestPage(pageRequest(1))
  expect(result).toMatchObject({ status: 'newest-page', items: [item], servedIds: [100, 101, 102],
    receipts: [{ identity: 0, partial: true, ids: [100, 101, 102], cursor: 'range' }],
    cursorAnchors: [{ receiptIdentity: 1, id: 110, cursor: 'adjacent' }],
    display: [{ id: 100, lastId: 102, item: { text: 'selected fragment' } }],
    gaps: [{ identity: 0, partial: true, olderId: 102, newerId: 110 }] })
  expect(decrypt).toHaveBeenCalledTimes(13); decrypt.mockRestore()
  expect(JSON.stringify(result)).not.toContain('unrelated'); expect(JSON.stringify(result)).not.toContain('not-selected')
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })
  const displayOnly = { ...s, served: undefined, gaps: undefined }
  await fresh.store.execute(replace(displayOnly))
  const only = await fresh.store.newestPage(pageRequest())
  expect(only).toMatchObject({ status: 'newest-page' }); expect(only).not.toHaveProperty('servedIds')
})

it('reads pre-envelope protected records and classifies selected codec and protection failures', async () => {
  const h = setup(); const s = snapshot(); await h.store.execute(replace(s))
  h.database.transaction(db => {
    const rows = db.prepare('SELECT rowid, payload FROM legacy_records').all() as { rowid: number; payload: Buffer }[]
    for (const r of rows) {
      const old = JSON.parse(new TextDecoder().decode(h.encryption.decrypt(r.payload))).record.payload
      db.prepare('UPDATE legacy_records SET payload = ? WHERE rowid = ?')
        .run(Buffer.from(h.encryption.encrypt(new TextEncoder().encode(JSON.stringify(old)))), r.rowid)
    }
  })
  h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })
  expect(await fresh.store.newestPage(pageRequest())).toMatchObject({ status: 'newest-page', rowKeys: [-2, 5] })
  h.encryption.isAvailable = () => false
  expect(await fresh.store.newestPage(pageRequest())).toEqual({ status: 'error', code: 'encryption-unavailable' })
  h.encryption.isAvailable = () => true
  fresh.database.transaction(db => db.pragma('user_version = 999')); fresh.database.close()
  expect(await h.fresh().store.newestPage(pageRequest())).toEqual({ status: 'error', code: 'unsupported-version' })
})

it('validates selected row/contribution bindings and keeps unselected unreadable rows untouched', async () => {
  const h = setup(); await h.store.execute(replace(snapshot()))
  h.database.transaction(db => db.prepare("UPDATE legacy_records SET payload = x'00' WHERE kind = 'row' AND ordinal = 0").run())
  expect(await h.store.newestPage(pageRequest(1))).toMatchObject({ status: 'newest-page', rowKeys: [5] })
  expect(await h.store.execute(read())).toEqual({ status: 'error', code: 'unreadable' })
  const other = setup(); await other.store.execute(replace(snapshot()))
  other.database.transaction(db => {
    const r = db.prepare("SELECT payload FROM legacy_records WHERE kind = 'display' AND ordinal = 0").get() as { payload: Buffer }
    const value = JSON.parse(new TextDecoder().decode(other.encryption.decrypt(r.payload)))
    value.record.payload.item.turnId = 'wrong-binding'
    db.prepare("UPDATE legacy_records SET payload = ? WHERE kind = 'display' AND ordinal = 0")
      .run(Buffer.from(other.encryption.encrypt(new TextEncoder().encode(JSON.stringify(value)))))
  })
  expect(await other.store.newestPage(pageRequest())).toEqual({ status: 'error', code: 'unreadable' })
})

it('adds the receipt-start index atomically and uses it without walking receipt memberships', async () => {
  const h = setup(); await h.store.execute(replace(snapshot()))
  const identity = h.database.transaction(db => {
    db.exec('DROP INDEX legacy_receipt_start; PRAGMA user_version = 2')
    return db.prepare('SELECT identity FROM legacy_scopes').get()
  })
  h.database.close(); const before = protectedBytes(h.root)
  const decrypt = h.encryption.decrypt
  h.encryption.decrypt = () => { throw new Error('injected') }
  expect(await h.fresh().store.newestPage(pageRequest())).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(before)
  h.encryption.decrypt = decrypt; const fresh = h.fresh()
  expect(await fresh.store.newestPage(pageRequest())).toMatchObject({ status: 'newest-page' })
  fresh.database.transaction(db => {
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.prepare('SELECT identity FROM legacy_scopes').get()).toEqual(identity)
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT payload FROM legacy_records WHERE scope = ? AND kind = 'receipt-id' AND ordinal = 0 AND entry_id >= ? ORDER BY entry_id, parent LIMIT 1").all('scope', 0)
    expect(JSON.stringify(plan)).toContain('legacy_receipt_start')
  })
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(snapshot()) })
})

it('pages a heavily fragmented held row without exceeding SQLite expression limits', async () => {
  const h = setup(); const item = { kind: 'assistantText', turnId: 't', text: 'whole' }
  const ids = Array.from({ length: 1200 }, (_, i) => i * 2)
  const s = { ...plain(0), items: [item], rowIdentity: { rowKeys: [9], nextRowKey: 10 },
    coverage: { status: 'received', cursor: '', atStart: false },
    display: ids.map(id => ({ kind: 'row', id, rowKey: 9, item: { ...item, text: 'fragment' } })),
    served: { ids, highestId: ids.at(-1), receipts: [{ ids, cursor: '', atStart: false }] } }
  expect(await h.store.execute(replace(s))).toEqual({ status: 'ok' }); h.database.close()
  const result = await h.fresh().store.newestPage(pageRequest(1))
  expect(result).toMatchObject({ status: 'newest-page', servedIds: ids, receipts: [{ ids, partial: true }] })
  if (result.status !== 'newest-page') throw new Error('expected page')
  expect(result.display).toHaveLength(1200)
})

it('exact fragmented round trip across close/reopen, with separate indexed memberships', async () => {
  const h = setup(); const s = snapshot()
  const normalized = parseChatHistorySnapshot(s)
  expect(await h.store.execute(replace(s))).toEqual({ status: 'ok' })
  h.database.close()
  const fresh = h.fresh()
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: normalized })
  fresh.database.transaction(db => {
    expect(db.prepare("SELECT count(*) AS n FROM legacy_records WHERE kind = 'receipt-id'").get()).toEqual({ n: 4 })
    expect(db.prepare("SELECT count(*) AS n FROM legacy_records WHERE kind = 'gap-key'").get()).toEqual({ n: 2 })
  })
  for (const secret of ['MESSAGE', 'ATTACHMENT', 'COVERAGE', 'NEWEST', 'RECEIPT', 'GAP', 'REFUSED']) {
    expect(protectedBytes(h.root).includes(Buffer.from(secret + '-SENTINEL-1979'))).toBe(false)
    expect(JSON.stringify(h.lines)).not.toContain(secret + '-SENTINEL-1979')
  }
})

it('preserves old optional absence, empty snapshots, supplied order and exact owners', async () => {
  const h = setup()
  const old = { version: 1, kind: 'timeline', serverId: 'Host', conversationId: 'Chat', items: [], prependedRows: 0, coverage: { status: 'unknown' } }
  expect(await h.store.execute(read())).toEqual({ status: 'missing' })
  for (const [host, chat] of [['Host', 'Chat'], ['host', 'Chat'], ['Host', 'chat']]) {
    const s = { ...old, serverId: host, conversationId: chat }
    expect(await h.store.execute(replace(s, host, chat))).toEqual({ status: 'ok' })
  }
  h.database.close()
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(old) })
  expect(await h.store.execute(replace(snapshot(), 'wrong'))).toEqual({ status: 'error', code: 'invalid-request' })
  expect(await h.store.execute(replace({ ...old, prependedRows: -1 }))).toEqual({ status: 'error', code: 'invalid-request' })
  expect(await h.store.execute({ operation: 'readList', serverId: 'Host' })).toEqual({ status: 'error', code: 'invalid-request' })
})

it.each(['serverId', 'conversationId'] as const)('isolates every UTF-16 %s across restart, replacement and removal', async coordinate => {
  const h = setup()
  let current = { database: h.database, store: h.store }
  const variants = ['\ud800', '\ud801', '\ufffd', '\udc00', '\ud83d\ude00']
  const saved = variants.flatMap((id, i) => ['primary', 'peer'].map((peer, j) => {
    const s = coordinate === 'serverId' ? snapshot(id, peer) : snapshot(peer, id)
    return { ...s, items: [{ ...s.items[0], text: `owner-${i}-${j}` }, s.items[1]] }
  }))
  let expected = [saved[0]]
  const put = async (s: typeof saved[number]) => {
    expect(await current.store.execute(replace(s, s.serverId, s.conversationId))).toEqual({ status: 'ok' })
  }
  const reopenAndCheck = async () => {
    current.database.close(); current = h.fresh()
    for (const s of saved) {
      const retained = expected.find(e => e.serverId === s.serverId && e.conversationId === s.conversationId)
      expect(await current.store.execute(read(s.serverId, s.conversationId))).toEqual(retained
        ? { status: 'stored', snapshot: parseChatHistorySnapshot(retained) } : { status: 'missing' })
    }
  }
  await put(saved[0])
  await reopenAndCheck() // Distinct absent owners must not alias the one committed scope.
  for (const s of saved) await put(s)
  expected = [...saved]
  await reopenAndCheck()
  const changed = { ...saved[2], items: [{ ...saved[2].items[0], text: 'replacement' }, saved[2].items[1]] }
  await put(changed)
  expected[2] = changed
  await reopenAndCheck()
  expect(await current.store.execute({ operation: 'removeConversation', serverId: changed.serverId,
    conversationId: changed.conversationId })).toEqual({ status: 'ok' })
  expected = expected.filter(s => s !== changed)
  await reopenAndCheck()
  expect(await current.store.execute({ operation: 'removeServer', serverId: saved[0].serverId })).toEqual({ status: 'ok' })
  expected = expected.filter(s => s.serverId !== saved[0].serverId)
  await reopenAndCheck()
  await put(saved[0]); expected.push(saved[0])
  await reopenAndCheck()
})

it('migrates version-1 ownership keys atomically without changing payloads or snapshot identities', async () => {
  const h = setup()
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'ok' })
  const original = h.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes').get())
  h.database.transaction(db => db.exec(`
    UPDATE legacy_scopes SET server = 'Host', conversation = 'Chat';
    DROP TABLE thread_records; DROP TABLE thread_scopes;
    PRAGMA user_version = 1;
    CREATE TRIGGER fail_migration BEFORE UPDATE ON legacy_scopes BEGIN SELECT RAISE(ABORT, 'injected'); END;
  `))
  h.database.close()
  const before = protectedBytes(h.root)
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(before)
  const disk = new Database(join(h.root, 'history', 'history.sqlite'))
  disk.exec('DROP TRIGGER fail_migration'); disk.close()
  const fresh = h.fresh()
  const beforeRead = protectedBytes(h.root)
  const decrypt = h.encryption.decrypt
  h.encryption.decrypt = () => { throw new Error('injected') }
  expect(await fresh.store.execute(read())).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(beforeRead)
  h.encryption.decrypt = decrypt
  expect(await fresh.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(snapshot()) })
  fresh.database.transaction(db => {
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.prepare('SELECT identity FROM legacy_scopes').get()).toEqual(original)
    expect(db.prepare('SELECT typeof(server) AS server, typeof(conversation) AS conversation FROM legacy_scopes').get())
      .toEqual({ server: 'blob', conversation: 'blob' })
  })
})

it('rollback and subsequent recovery for replacement and scoped removal; fresh identity after reuse', async () => {
  const h = setup()
  for (const [host, chat] of [['Host', 'Chat'], ['host', 'Chat'], ['Host', 'peer']])
    expect(await h.store.execute(replace(snapshot(host, chat), host, chat))).toEqual({ status: 'ok' })
  const identity = () => h.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes WHERE server = ? AND conversation = ?')
    .get(Buffer.from('Host', 'utf16le'), Buffer.from('Chat', 'utf16le')))
  const first = identity()
  h.database.transaction(db => db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON legacy_records BEGIN SELECT RAISE(ABORT, 'injected'); END"))
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'error', code: 'write-failed' })
  expect(identity()).toEqual(first)
  expect(await h.store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(snapshot()) })
  h.database.transaction(db => db.exec('DROP TRIGGER fail_insert'))
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'ok' })
  expect(identity()).not.toEqual(first)
  for (const operation of ['removeConversation', 'removeServer']) {
    h.database.transaction(db => db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON legacy_records BEGIN SELECT RAISE(ABORT, 'injected'); END"))
    const request = { operation, serverId: 'Host', ...(operation === 'removeConversation' ? { conversationId: 'Chat' } : {}) }
    expect(await h.store.execute(request)).toEqual({ status: 'error', code: 'remove-failed' })
    expect(await h.store.execute(read())).toMatchObject({ status: 'stored' })
    h.database.transaction(db => db.exec('DROP TRIGGER fail_delete'))
    const prior = identity()
    expect(await h.store.execute(request)).toEqual({ status: 'ok' })
    expect(await h.store.execute(read())).toEqual({ status: 'missing' })
    expect(await h.store.execute(read('host'))).toMatchObject({ status: 'stored' })
    if (operation === 'removeConversation') expect(await h.store.execute(read('Host', 'peer'))).toMatchObject({ status: 'stored' })
    expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'ok' })
    expect(identity()).not.toEqual(prior)
  }
})

it('fails closed for unavailable encryption, corrupt payloads and unsupported schemas without modifying bytes', async () => {
  const h = setup()
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'ok' })
  const bytes = protectedBytes(h.root)
  h.encryption.isAvailable = () => false
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'error', code: 'encryption-unavailable' })
  expect(protectedBytes(h.root)).toEqual(bytes)
  h.encryption.isAvailable = () => true
  h.encryption.decrypt = () => { throw new Error('MESSAGE-SENTINEL-1979') }
  for (const request of [read(), replace(snapshot()), { operation: 'removeServer', serverId: 'Host' }])
    expect(await h.store.execute(request)).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(bytes)
  expect(JSON.stringify(h.lines)).not.toContain('MESSAGE-SENTINEL-1979')
  h.database.transaction(db => db.pragma('user_version = 999'))
  h.database.close()
  const unsupported = protectedBytes(h.root)
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'error', code: 'unsupported-version' })
  expect(protectedBytes(h.root)).toEqual(unsupported)
})

it('round-trips every durable row field, equal timestamps, empty evidence and old evidence absence', async () => {
  const h = setup()
  const denial = { toolName: 'tool', decisionReasonType: 'deny', decisionReason: 'reason', message: 'message', truncatedFields: [], droppedFields: null }
  const items = [
    { kind: 'assistantText', turnId: 't', text: 'text', createdAt: 4, parentToolUseId: 'p' },
    { kind: 'userText', text: 'equal timestamp', createdAt: 4, messageId: 'm', attachments: [] },
    { kind: 'toolCall', turnId: 't', toolUseId: 'tool', parentToolUseId: 'p', name: 'run', inputSummary: 'input',
      input: { command: 'echo hi' }, result: { isError: false, resultSummary: 'summary', resultDetail: 'detail' }, denial, elapsedSeconds: 2 },
    { kind: 'turnBoundary', turnId: 't', stopReason: 'done', outcome: 'ok', isError: false, terminalReason: 'end', errorCategory: 'none', durationMs: 100 },
    { kind: 'sessionBoundary', reason: 'idle_evict', workspaceCwd: null, occurredAt: 'yesterday' },
    { kind: 'unrecognizedMessage', site: 'codex_item', messageType: 'new', raw: 'RAW-SENTINEL-1979', truncated: false },
    { kind: 'compactionBoundary', failed: false, manual: true, preTokens: null, postTokens: 0 },
    { kind: 'banner', level: 'info', text: 'banner', stopsTurn: true, truncated: true },
    { kind: 'modelRefusal', refusal: { type: 'modelRefusalFallback', originalModel: 'old', fallbackModel: 'new', scope: 'turn',
      refusalCategory: 'reason', banner: 'fallback', truncatedFields: null, droppedFields: [] } }
  ]
  for (const evidence of [{}, { display: [], gaps: [], newestCursor: '', served: { ids: [], receipts: [{ ids: [], cursor: '', atStart: true }] } }]) {
    const s = { version: 1, kind: 'timeline', serverId: 'Host', conversationId: 'Chat', items, prependedRows: 9,
      coverage: { status: 'received', cursor: '', atStart: true }, ...evidence }
    expect(await h.store.execute(replace(s))).toEqual({ status: 'ok' })
    h.database.close()
    expect(await h.fresh().store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })
    expect(protectedBytes(h.root).includes(Buffer.from('RAW-SENTINEL-1979'))).toBe(false)
  }
})

it('rejects corrupt indexes before mutations and contains mid-write encryption failures across restart', async () => {
  const h = setup()
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'ok' })
  const encrypt = h.encryption.encrypt
  let count = 0
  h.encryption.encrypt = b => {
    if (++count === 5) throw new Error('ATTACHMENT-SENTINEL-1979')
    return encrypt(b)
  }
  expect(await h.store.execute(replace(snapshot()))).toEqual({ status: 'error', code: 'write-failed' })
  h.database.close()
  expect(await h.fresh().store.execute(read())).toEqual({ status: 'stored', snapshot: parseChatHistorySnapshot(snapshot()) })
  for (const secret of ['MESSAGE', 'ATTACHMENT', 'COVERAGE', 'RECEIPT', 'GAP']) {
    expect(protectedBytes(h.root).includes(Buffer.from(secret + '-SENTINEL-1979'))).toBe(false)
    expect(JSON.stringify(h.lines)).not.toContain(secret + '-SENTINEL-1979')
  }
  h.database.transaction(db => db.exec("UPDATE legacy_records SET row_key = 200 WHERE kind = 'row' AND ordinal = 0"))
  const before = protectedBytes(h.root)
  for (const request of [read(), replace(snapshot()), { operation: 'removeConversation', serverId: 'Host', conversationId: 'Chat' }])
    expect(await h.store.execute(request)).toEqual({ status: 'error', code: 'unreadable' })
  expect(protectedBytes(h.root)).toEqual(before)
})
