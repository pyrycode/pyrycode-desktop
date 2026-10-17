import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { createHistoryDatabase } from './historyDatabase'
import { createIndexedThreadHistory } from './indexedThreadHistory'
import { parseChatHistorySnapshot, parseChatHistoryRequest, type ThreadSnapshot } from '../shared/chatHistory'
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
it.each(['metadata', 'movement', 'removal', 'replacement'] as const)('rebases protected traversal after %s without losing moved identities', async change => {
  const h = setup(), s = snapshot(0)
  const items = Array.from({ length: 61 }, (_, id) => ({ id, kind: 'future', rev: 1, order: id,
    shown: id % 3 === 0, content: { text: `saved-${id}` } }))
  const fixture = { ...s, thread: { ...s.thread, items, arrivalOrder: items.map(i => i.id) } }
  await h.store.execute(put(fixture))
  await page(h.store, ask('openThreadPage', { limit: 10 }))
  let p = await page(h.store, newest(10))
  p = await page(h.store, ask('beforeThreadPage', { limit: 10, continuation: p.continuation }))
  expect(typeof p.recovery).toBe('string')
  const visited = new Map(p.items.map(i => [i.id, i]))
  const changed = { ...items[1], rev: 2, order: 1000, content: { text: 'moved-and-cleared' } }
  const expected = change === 'movement' ? items.map(i => i.id === 1 ? changed : i)
    : change === 'removal' ? items.filter(i => i.id !== p.items[0].id)
    : change === 'replacement' ? [...items.slice(0, 30).filter(i => i.id !== 1), changed, ...items.slice(30)] : items
  const replacement = { ...fixture, thread: { ...fixture.thread, items: expected, arrivalOrder: expected.map(i => i.id) } }
  if (change === 'replacement') await h.store.execute(put(replacement))
  else await h.store.execute(owned(fixture, { items: change === 'movement' ? [changed] : [],
    removeIds: change === 'removal' ? [p.items[0].id] : [] }))
  // Ordinary old-generation requests keep rejecting even though a recovery capability exists.
  expect(await h.store.execute(ask('beforeThreadPage', { limit: 10, continuation: p.continuation })))
    .toEqual({ status: 'error', code: 'invalid-request' })
  h.database.close()
  const fresh = h.fresh()
  for (let attempts = 0; attempts < 20 && p.continuation !== null; attempts++) {
    p = await page(fresh.store, ask('beforeThreadPage', { limit: 10, continuation: p.continuation, recovery: p.recovery }))
    for (const i of p.items) visited.set(i.id, i)
  }
  expect(p.continuation).toBeNull()
  for (const i of expected) expect(visited.get(i.id)).toEqual(i)
})

it.each(['epoch-roundtrip', 'reset', 'delete', 'unpair'] as const)('rejects recovery capability substitution, wrong scopes and %s recreation', async lifecycle => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s))
  await page(h.store, ask('openThreadPage', { limit: 2 }))
  const p = await page(h.store, newest())
  const request = ask('beforeThreadPage', { limit: 2, continuation: p.continuation, recovery: p.recovery })
  await h.store.execute(owned(s, {}))
  expect(await h.store.execute({ ...request, continuation: 'YQ' })).toEqual({ status: 'error', code: 'invalid-request' })
  expect(await h.store.execute({ ...request, conversationId: 'other' })).toEqual({ status: 'error', code: 'invalid-request' })
  if (lifecycle === 'epoch-roundtrip') {
    const other = { ...s, thread: { ...s.thread, epoch: 'other' } }
    await h.store.execute(put(other))
  } else if (lifecycle === 'reset') await h.store.execute(owned(s, { resetId: 'new-reset' }))
  else await h.store.execute(ask(lifecycle === 'delete' ? 'removeConversation' : 'removeServer'))
  await h.store.execute(put(s))
  expect(await h.store.execute(request)).toEqual({ status: 'error', code: 'invalid-request' })
})

it('bounds each demand during repeated invalidation and completes the identity pass once writes settle', async () => {
  const h = setup(), s = snapshot(0), items = Array.from({ length: 35 }, (_, id) => ({ id, rev: 1, kind: 'future', order: id }))
  const fixture = { ...s, thread: { ...s.thread, items, arrivalOrder: items.map(i => i.id) } }
  await h.store.execute(owned(fixture, { items }))
  let p = await page(h.store, newest(4))
  for (let n = 0; n < 5; n++) {
    await h.store.execute(owned(fixture))
    p = await page(h.store, ask('beforeThreadPage', { limit: 4, continuation: p.continuation, recovery: p.recovery }))
    expect(p.items.length).toBeLessThanOrEqual(4)
  }
  const reached = new Map<number, unknown>(p.items.map(value => [value.id, value]))
  for (let n = 0; n < 20 && p.continuation !== null; n++) {
    p = await page(h.store, ask('beforeThreadPage', { limit: 4, continuation: p.continuation, recovery: p.recovery }))
    for (const value of p.items) reached.set(value.id, value)
  }
  expect(p.continuation).toBeNull()
  expect(reached.size).toBe(items.length)
  for (const value of items) expect(reached.get(value.id)).toEqual(value)
})

it('bounded opening selects shown, active and recorded dependencies after fresh reopen', async () => {
  const h = setup(), s = snapshot(0)
  const items: ThreadSnapshot['items'] = [
    { id: 0, kind: 'agent', rev: 1, shown: false, active: false, order: 0 },
    { id: 1, kind: 'agent', rev: 1, shown: true, active: false, order: 1, parent: 0, ended_order: 77, status: 'finished',
      content: { name: 'Agent', tool_use_id: 'call', task_id: 'task', task_link: { task_id: 'task', tool_call_id: 'call' } } },
    { id: 2, kind: 'turn_end', rev: 1, shown: false, session: 's', agent: 'a', turn: 't', parent: 1, content: { output_tokens: 12 } },
    { id: 3, kind: 'future', rev: 1, shown: false, parent: 1 },
    ...Array.from({ length: 240 }, (_, n) => ({ id: n + 10, kind: 'assistant_message', rev: 1,
      shown: true, order: n + 10, session: 's', agent: 'a', turn: 't', parent: 1,
      content: { text: String(n), ts: String(999 - n) } })),
    ...Array.from({ length: 1000 }, (_, n) => ({ id: n + 1000, kind: 'future', rev: 1, shown: false, active: n === 0 }))
  ]
  const fixture = { ...s, thread: { ...s.thread, items, arrivalOrder: items.map(i => i.id).reverse() } }
  expect(await h.store.execute(put(fixture))).toEqual({ status: 'ok' })
  h.database.close()
  const fresh = h.fresh(), p = await page(fresh.store, ask('openThreadPage', { limit: 200 }))
  expect(p.items.map(i => i.id)).toEqual([0, 1, 2, ...Array.from({ length: 200 }, (_, n) => n + 50), 1000])
  expect(p.items.find(i => i.id === 1)).toEqual(items[1])
  expect(p.arrivalPositions).toEqual(p.items.map(i => items.length - 1 - items.findIndex(v => v.id === i.id)))
  expect(p.metadata.checkpoint).toBe(100)
  expect(p.items.find(i => i.id === 2)?.shown).toBe(false)
  expect(p.continuation).not.toBeNull()
})
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
it('opening indexes follow owned revisions and removal without reviving old dependencies', async () => {
  const h = setup(), s = snapshot(0)
  const items = [1, 2, 3].map(id => ({ id, rev: 1, kind: 'turn_end', shown: true, order: id,
    session: 's', agent: 'a', turn: 't' }))
  expect(await h.store.execute(owned(s, { items }))).toEqual({ status: 'ok' })
  expect((await page(h.store, ask('openThreadPage', { limit: 2 }))).items.map(i => i.id)).toEqual([2, 3])
  expect(await h.store.execute(owned(s, { items: [{ ...items[2], rev: 2, shown: false, active: true }], removeIds: [2] }))).toEqual({ status: 'ok' })
  h.database.close()
  expect((await page(h.fresh().store, ask('openThreadPage', { limit: 2 }))).items.map(i => i.id)).toEqual([1, 3])
  expect(await h.store.execute(owned(s, { items: [{ ...items[2], rev: 3, shown: false, active: false }] }))).toEqual({ status: 'ok' })
  expect((await page(h.store, ask('openThreadPage', { limit: 2 }))).items.map(i => i.id)).toEqual([1])
})

it('cold opening payload work stays bounded as unrelated older, hidden and range history grows', async () => {
  async function measure(unrelated: number) {
    const h = setup()
    const s = snapshot(0), items = [
      ...Array.from({ length: unrelated }, (_, n) => ({ id: n + 100, rev: 1, kind: 'future', shown: false })),
      { id: 1, rev: 1, kind: 'future', active: true, order: 1 },
      { id: 2, rev: 1, kind: 'agent', shown: false, order: 2 },
      ...Array.from({ length: 240 }, (_, n) => ({ id: n + 10000, rev: 1, kind: 'assistant_message', shown: true, parent: 2, order: n + 10000 })),
      ...Array.from({ length: unrelated }, (_, n) => ({ id: n + 20000, rev: 1, kind: 'future', shown: false }))
    ]
    const fixture = { ...s, thread: { ...s.thread, items, arrivalOrder: items.map(i => i.id), ranges: [
      { start: 0, end: 5 }, ...Array.from({ length: unrelated }, (_, n) => ({ start: 10 + n * 2, end: 11 + n * 2 })),
      { start: 10000, end: 10240 }, { start: 999999, end: 1000000 }] } }
    await h.store.execute(put(fixture))
    const converting = performance.now(); await page(h.store, ask('openThreadPage', { limit: 200 }))
    const conversionMs = performance.now() - converting
    h.database.close(); const fresh = h.fresh()
    let structural = 0, records = 0, payloads = 0
    // Each prepared statement is private to this call. Count real reads directly
    // without retaining a Vitest mock and its call history for every statement.
    fresh.database.transaction(db => {
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (sql.startsWith('SELECT')) for (const method of ['all', 'get'] as const) {
          const read = statement[method].bind(statement)
          Object.defineProperty(statement, method, { value: (...args: unknown[]) => {
            const result = read(...args), count = Array.isArray(result) ? result.length : Number(result !== undefined)
            if (sql.includes('thread_auth')) structural += count
            else if (sql.includes('thread_records')) records += count
            else if (sql.includes('thread_payloads')) payloads += count
            return result
          } })
        }
        return statement
      })
    })
    const decrypt = vi.spyOn(h.encryption, 'decrypt'), started = performance.now()
    const p = await page(fresh.store, ask('openThreadPage', { limit: 200 })), coldMs = performance.now() - started
    expect(p.items).toHaveLength(202); expect(p.ranges).toHaveLength(3)
    const result = { records, payloads, decrypts: decrypt.mock.calls.length }
    expect(result).toEqual({ records: 206, payloads: 202, decrypts: 408 })
    console.info('opening-work', JSON.stringify({ unrelated, fixtureItems: items.length, selected: 200, active: 1,
      dependencies: 1, evidence: 3, structural, ...result, coldMs, conversionMs }))
    structural = 0; records = 0; payloads = 0; decrypt.mockClear()
    const traversing = performance.now(), held = await page(fresh.store, newest(200))
    expect(held.items).toHaveLength(200)
    expect(payloads).toBe(200); expect(records).toBeLessThanOrEqual(204)
    expect(decrypt.mock.calls.length).toBeLessThanOrEqual(408)
    console.info('traversal-work', JSON.stringify({ unrelated, fixtureItems: items.length, selected: 200,
      structural, records, payloads, decrypts: decrypt.mock.calls.length, coldMs: performance.now() - traversing }))
    for (const depth of [1, 4, 8]) {
      let positioned = await page(fresh.store, newest(20))
      for (let n = 0; n < depth; n++) positioned = await page(fresh.store,
        ask('beforeThreadPage', { limit: 20, continuation: positioned.continuation }))
      expect(await fresh.store.execute(depth === 4 ? put(fixture) : owned(fixture))).toEqual({ status: 'ok' })
      structural = 0; records = 0; payloads = 0; decrypt.mockClear()
      const recovering = performance.now()
      const recovered = await page(fresh.store, ask('beforeThreadPage', { limit: 20,
        continuation: positioned.continuation, recovery: positioned.recovery }))
      expect(recovered.items.length).toBeLessThanOrEqual(20)
      expect(payloads).toBe(recovered.items.length)
      expect(records).toBeLessThanOrEqual(payloads + 5)
      expect(decrypt.mock.calls.length).toBeLessThanOrEqual(2 * payloads + 7)
      expect(structural).toBeLessThan(2000)
      console.info('recovery-work', JSON.stringify({ unrelated, fixtureItems: items.length, depth, replacement: depth === 4,
        selected: recovered.items.length, structural, records, payloads, decrypts: decrypt.mock.calls.length,
        recoveryMs: performance.now() - recovering }))
    }
    vi.restoreAllMocks(); return result
  }
  expect(await measure(500)).toEqual(await measure(10))
})
async function page(store: ReturnType<typeof createIndexedThreadHistory>, request = newest()) {
  const result = await store.execute(request)
  expect(result.status).toBe('page')
  if (result.status !== 'page') throw new Error('expected page')
  return result.page
}
const error = (code: string) => ({ status: 'error', code })
const stored = (s: unknown) => ({ status: 'stored', snapshot: parseChatHistorySnapshot(s) })
function owned(s: { serverId: string; conversationId: string; thread: ThreadSnapshot } = snapshot(), extra: object = {}) {
  const { items: ignoredItems, ranges: ignoredRanges, arrivalOrder: ignoredArrival, ...metadata } = s.thread
  void ignoredItems; void ignoredRanges; void ignoredArrival
  return ask('mutateThread', { change: { metadata, acceptEpoch: true, items: [], removeIds: [], ranges: [], ...extra } }, s.serverId, s.conversationId)
}

it('bounded and separately saved application preserve exact items, order and progress after replay and reopen', async () => {
  const bounded = setup(), separate = setup(), seed = snapshot(40)
  seed.thread.items[1] = { ...seed.thread.items[1], kind: 'assistant_message', content: { text: 'prefix' } }
  for (const h of [bounded, separate]) {
    expect(await h.store.execute(put(seed))).toEqual({ status: 'ok' })
    expect(await h.store.execute(owned(seed))).toEqual({ status: 'ok' })
  }
  const { items: ignoredItems, ranges: ignoredRanges, arrivalOrder: ignoredArrival, ...old } = seed.thread
  void ignoredItems; void ignoredRanges; void ignoredArrival
  const unfinished = { ...old, version: 400, uncommittedVersion: 400 }
  const completed = { ...old, version: 400, checkpoint: 400, uncommittedVersion: 0, repair: null }
  const items = [{ ...seed.thread.items[1], content: { text: 'prefix extended' } },
    { ...seed.thread.items[2], rev: 500, order: 10000, text: 'revision' },
    { id: 100, rev: 1, kind: 'future', order: 2 }]
  const observations = [{ metadata: unfinished }, { metadata: completed, completion: { fromVersion: 100, version: 400 },
    availability: { start: 0, available: false } }, { metadata: { ...completed, version: 450, uncommittedVersion: 450 } }]
  const request = parseChatHistoryRequest(owned(seed, { items, removeIds: [3, 7], ranges: [{ start: 3, end: 900 }],
    priorProgress: observations, metadata: { ...completed, version: 450, checkpoint: 450, uncommittedVersion: 450 } }))
  if (request.operation !== 'mutateThread') throw Error('expected mutation')
  expect(await bounded.store.executeMutation(request)).toEqual({ status: 'ok' })
  expect(await separate.store.execute(owned(seed, { items, removeIds: [3, 7], ranges: [{ start: 3, end: 900 }], metadata: old }))).toEqual({ status: 'ok' })
  for (const progress of [...observations, request.change]) {
    expect(await separate.store.execute(owned(seed, { ...progress, items: [], ranges: [], removeIds: [], priorProgress: [] }))).toEqual({ status: 'ok' })
  }
  const read = ask('readThread'), expected = await separate.store.execute(read)
  if (expected.status !== 'stored' || expected.snapshot.kind !== 'daemon-items') throw Error('expected saved thread')
  expect(expected.snapshot.thread.items).toEqual(expect.arrayContaining(items))
  expect(expected.snapshot.thread.items.some(item => item.id === 3 || item.id === 7)).toBe(false)
  expect(expected.snapshot.thread.arrivalOrder).toEqual([...seed.thread.arrivalOrder.filter(id => id !== 3 && id !== 7), 100])
  expect(expected.snapshot.thread.ranges).toEqual([{ start: 0, end: 950 }])
  expect(await bounded.store.execute(read)).toEqual(expected)
  expect(await bounded.store.executeMutation(request)).toEqual({ status: 'ok' })
  bounded.database.close()
  expect(await bounded.fresh().store.execute(read)).toEqual(expected)
  const p = await page(bounded.fresh().store)
  expect(p.metadata).toMatchObject({ checkpoint: 400, version: 450, uncommittedVersion: 450, olderAvailable: false })
  expect(p.availabilityStart).toBe(0)
})

it('successive owned additions keep ordering paths and record work bounded without rewriting placements', async () => {
  const h = setup(), s = snapshot(0)
  let reads = 0, writes = 0
  h.database.transaction(db => {
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (sql.startsWith('SELECT')) {
        const get = statement.get.bind(statement), all = statement.all.bind(statement)
        statement.get = (...args) => { const r = get(...args); reads += r ? 1 : 0; return r }
        statement.all = (...args) => { const r = all(...args); reads += r.length; return r }
      } else {
        const run = statement.run.bind(statement)
        statement.run = (...args) => { writes++; return run(...args) }
      }
      return statement
    })
  })
  let first: unknown
  for (let id = 0; id < 513; id++) {
    reads = 0; writes = 0
    expect(await h.store.execute(owned(s, { items: [{ id, rev: 1, kind: 'future', order: id }] }))).toEqual({ status: 'ok' })
    if ([16, 128, 512].includes(id)) { expect(reads).toBeLessThan(500); expect(writes).toBeLessThan(300) }
    const row = h.database.transaction(db => db.prepare("SELECT payload FROM thread_records WHERE kind = 'item' AND ordinal = 0").get())
    if (id === 0) first = row
    else expect(row).toEqual(first)
  }
  vi.restoreAllMocks()
  h.database.close()
  const fresh = h.fresh()
  expect((await page(fresh.store, newest(2))).items.map(i => i.id)).toEqual([511, 512])
  expect(await fresh.store.execute(ask('readThread'))).toMatchObject({ status: 'stored', snapshot: { thread: { items: expect.any(Array) } } })
})

it('separately flushed JSON aggregates reject overflow atomically and stay readable after reopen', async () => {
  const h = setup(), s = snapshot(0)
  const entry = (id: number) => ({ id, rev: 1, kind: 'future', data: Array(60000).fill(null) })
  expect(await h.store.execute(owned(s, { items: [entry(1)] }))).toEqual({ status: 'ok' })
  expect(await h.store.execute(owned(s, { items: [entry(2)] }))).toEqual(error('write-failed'))
  h.database.close()
  const fresh = h.fresh()
  expect((await page(fresh.store, newest(2))).items).toEqual([entry(1)])
  expect(await fresh.store.execute(ask('readThread'))).toMatchObject({ status: 'stored', snapshot: { thread: { items: [entry(1)] } } })
  expect(await fresh.store.execute(owned(s, { removeIds: [1], items: [entry(2)] }))).toEqual({ status: 'ok' })
})

it('retains the shared reset identity length boundary across a fresh owner', async () => {
  const h = setup(), s = snapshot(0)
  expect(await h.store.execute(owned(s, { resetId: 'r'.repeat(8192) }))).toEqual({ status: 'ok' })
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toMatchObject({ status: 'stored' })
})

it('balanced owned ordering preserves ties, movements, internal removals and authenticated parent routes', async () => {
  const h = setup(), s = snapshot(0)
  const ids = Array.from({ length: 40 }, (_, i) => i).sort((a, b) => (a * 17) % 41 - (b * 17) % 41)
  const items = ids.map(id => ({ id, kind: 'future', rev: 1, order: id % 20 }))
  for (const item of items) expect(await h.store.execute(owned(s, { items: [item] }))).toEqual({ status: 'ok' })
  const revised = { ...items[10], rev: 2, order: -1 }, removed = ids.filter((_, i) => i % 3 === 0 && i !== 10)
  expect(await h.store.execute(owned(s, { items: [revised], removeIds: removed }))).toEqual({ status: 'ok' })
  h.database.close()
  const fresh = h.fresh(), expected = items.filter(i => !removed.includes(i.id)).map(i => i.id === revised.id ? revised : i).sort((a, b) => a.order - b.order)
  expect(await fresh.store.execute(ask('readThread'))).toMatchObject({ status: 'stored', snapshot: { thread: { items: expected } } })
  expect((await page(fresh.store, newest(3))).items).toEqual(expected.slice(-3))
  fresh.database.transaction(db => db.prepare("UPDATE thread_auth SET payload = path WHERE tree = 'parent'").run())
  expect(await fresh.store.execute(owned(s, { items: [{ ...revised, rev: 3 }] }))).toEqual(error('write-failed'))
})

it('converts an admitted fractional ordering root transactionally while retaining exact placements', async () => {
  const h = setup(), s = snapshot(0), item = { id: 1, rev: 1, kind: 'future', order: 1 }
  await h.store.execute(owned(s, { items: [item] }))
  // Independent old-format singleton radix root, bound to the existing protected placement.
  h.database.transaction(db => {
    const row = db.prepare("SELECT scope, payload FROM thread_records WHERE kind = 'header'").get() as { scope: string; payload: Buffer }
    const envelope = JSON.parse(Buffer.from(h.encryption.decrypt(row.payload)).toString()), value = envelope.value
    const node = db.prepare("SELECT payload FROM thread_auth WHERE tree = 'sequence'").get() as { payload: string }
    const leaf = JSON.parse(node.payload).value, target = '0'.repeat(56)
    let ref = { hash: '', count: 0 }
    for (let length = target.length; length >= 0; length--) {
      const path = target.slice(0, length), payload = JSON.stringify({ left: ref, right: { hash: '', count: 0 }, value: length === target.length ? leaf : null })
      db.prepare('INSERT OR REPLACE INTO thread_auth VALUES (?, ?, ?, ?)').run(row.scope, 'order', path, payload)
      ref = { hash: createHash('sha256').update(path + payload).digest('hex'), count: 1 }
    }
    const { sequence: _sequence, nodes: _nodes, ...old } = value.mutable
    value.mutable = { ...old, roots: { ...old.roots, order: ref } }
    db.prepare("UPDATE thread_records SET payload = ? WHERE kind = 'header'").run(h.encryption.encrypt(Buffer.from(JSON.stringify(envelope))))
  })
  const placements = () => h.database.transaction(db => db.prepare("SELECT * FROM thread_records WHERE kind = 'item'").all())
  const before = placements()
  h.database.transaction(db => db.exec("CREATE TRIGGER fail_conversion BEFORE INSERT ON thread_records WHEN new.kind = 'header' BEGIN SELECT RAISE(ABORT, 'injected'); END"))
  expect(await h.store.execute(owned(s))).toEqual(error('write-failed'))
  expect(placements()).toEqual(before)
  h.database.transaction(db => db.exec('DROP TRIGGER fail_conversion'))
  expect(await h.store.execute(owned(s))).toEqual({ status: 'ok' })
  expect(placements()).toEqual(before)
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toMatchObject({ status: 'stored', snapshot: { thread: { items: [item] } } })
})

it('owned revisions preserve unloaded items and evidence across a fresh owner', async () => {
  const h = setup(), s = snapshot()
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  const changed = { ...s.thread.items[4], rev: 900, content: null }
  const { items: _items, ranges: _ranges, arrivalOrder: _arrivals, ...metadata } = s.thread
  expect(await h.store.execute(ask('mutateThread', { change: {
    metadata, acceptEpoch: false, items: [changed], removeIds: [], ranges: []
  } }))).toEqual({ status: 'ok' })
  h.database.close()
  const result = await h.fresh().store.execute(ask('readThread'))
  expect(result.status).toBe('stored')
  if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') throw Error('expected thread')
  expect(result.snapshot.thread.items).toEqual(s.thread.items.map(i => i.id === changed.id ? changed : i))
  expect(result.snapshot.thread.ranges).toEqual(s.thread.ranges)
  expect(result.snapshot.thread.arrivalOrder).toEqual(s.thread.arrivalOrder)
})

it('metadata-only ownership and same-epoch recreation preserve unloaded facts and progress fences', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s))
  expect(await h.store.execute(owned(s))).toEqual({ status: 'ok' })
  const recreated = { ...s, thread: { ...s.thread, items: [], ranges: [], arrivalOrder: [], version: 0,
    checkpoint: 0, uncommittedVersion: 0, repair: null } }
  expect(await h.store.execute(owned(recreated))).toEqual({ status: 'ok' })
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored(s))
})

it('metadata-only live progress cannot certify saved unfinished work or clear a saved repair', async () => {
  const h = setup(), s = snapshot()
  s.thread.uncommittedVersion = 250
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const partial = { ...s, thread: { ...s.thread, version: 400, checkpoint: 400, uncommittedVersion: 0, repair: null } }
  expect(await h.store.execute(owned(partial))).toEqual({ status: 'ok' })
  expect(await h.store.execute(ask('readThread'))).toEqual(stored({ ...s, thread: { ...s.thread, version: 400 } }))
})

it('owned revision overlap, explicit removal and admitted epoch transition remain distinct', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const token = (await page(h.store)).continuation
  const revised = { ...s.thread.items[4], rev: 1000, content: null }
  expect(await h.store.execute(owned(s, { items: [revised], removeIds: [2] }))).toEqual({ status: 'ok' })
  expect(await h.store.execute(ask('beforeThreadPage', { limit: 2, continuation: token }))).toEqual(error('invalid-request'))
  expect(await h.store.execute(owned(s, { items: [s.thread.items[4]] }))).toEqual({ status: 'ok' })
  const read = await h.store.execute(ask('readThread'))
  expect(read).toEqual(stored({ ...s, thread: { ...s.thread, items: s.thread.items.filter(i => i.id !== 2).map(i => i.id === 4 ? revised : i),
    arrivalOrder: s.thread.arrivalOrder.filter(id => id !== 2) } }))
  const epoch = { ...s, thread: { ...s.thread, epoch: 'next', version: 0, checkpoint: 0, uncommittedVersion: 0, repair: null } }
  expect(await h.store.execute(owned(epoch, { acceptEpoch: false }))).toEqual(error('write-failed'))
  expect(await h.store.execute(owned(epoch))).toEqual({ status: 'ok' })
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored({ ...epoch, thread: {
    ...epoch.thread, items: [], arrivalOrder: [], ranges: [] } }))
})

it('completion cannot bridge a missing version interval or certify a newer checkpoint', async () => {
  const h = setup(), s = snapshot()
  s.thread.uncommittedVersion = 250
  await h.store.execute(put(s))
  const later = { ...s, thread: { ...s.thread, version: 400, checkpoint: 400, uncommittedVersion: 0, repair: null } }
  expect(await h.store.execute(owned(later, { completion: { fromVersion: 150, version: 300 } }))).toEqual({ status: 'ok' })
  expect(await h.store.execute(ask('readThread'))).toEqual(stored({ ...s, thread: { ...s.thread,
    version: 400, repair: { fromVersion: 100, throughVersion: 300 } } }))
  expect(await h.store.execute(owned(later))).toEqual({ status: 'ok' })
  expect(await h.store.execute(owned(later, { completion: { fromVersion: 100, version: 300 } }))).toEqual({ status: 'ok' })
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored({ ...later, thread: { ...later.thread, checkpoint: 300 } }))
})

it('owned evidence merges without rewriting untouched placements and pages prove containing ranges', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const bytes = () => h.database.transaction(db => db.prepare("SELECT * FROM thread_records WHERE kind = 'item' ORDER BY ordinal").all())
  const before = bytes()
  expect(await h.store.execute(owned(s, { ranges: [{ start: 3, end: 100 }] }))).toEqual({ status: 'ok' })
  expect(bytes()).toEqual(before)
  const p = await page(h.store, newest(9))
  expect(p.ranges).toEqual([{ start: 0, end: 101 }, { start: 900, end: 950 }])
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored({ ...s, thread: {
    ...s.thread, ranges: [{ start: 0, end: 101 }, { start: 900, end: 950 }] } }))
})

it.each(['placement', 'range', 'branch'])('owned protected %s replay fails after a fresh owner', async kind => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const old = h.database.transaction(db => ({
    placement: db.prepare("SELECT * FROM thread_records WHERE kind = 'item' AND ordinal = 4").get() as Record<string, unknown>,
    range: db.prepare("SELECT * FROM thread_records WHERE kind = 'range' AND ordinal = 0").get() as Record<string, unknown>,
    branch: db.prepare("SELECT * FROM thread_auth WHERE tree = 'ids' AND path = ''").get() as Record<string, unknown>
  }))
  await h.store.execute(owned(s, { items: [{ ...s.thread.items[4], rev: 1000 }], ranges: [{ start: 3, end: 100 }] }))
  h.database.transaction(db => {
    if (kind === 'branch') db.prepare("UPDATE thread_auth SET payload = ? WHERE tree = 'ids' AND path = ''").run(old.branch.payload)
    else if (kind === 'placement') {
      const r = old.placement
      db.prepare("UPDATE thread_records SET arrival = ?, item_order = ?, range_ordinal = ?, range_start = ?, range_end = ?, payload = ? WHERE kind = 'item' AND ordinal = 4")
        .run(r.arrival, r.item_order, r.range_ordinal, r.range_start, r.range_end, r.payload)
    } else {
      const r = old.range
      db.prepare("UPDATE thread_records SET payload = ? WHERE kind = 'range' AND range_start = 0").run(r.payload)
    }
  })
  h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(ask('readThread'))).toEqual(error('unreadable'))
  const attempt = await fresh.store.execute(owned(s, { items: [{ ...s.thread.items[4], rev: 2000 }],
    ...(kind === 'range' ? { ranges: [{ start: 0, end: 200 }] } : {}) }))
  expect(attempt).toEqual(error('write-failed'))
})

it('owned writes roll back payloads and authenticated paths together and permit retry', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const state = () => h.database.transaction(db => ['thread_records', 'thread_payloads', 'thread_auth'].map(table => db.prepare(`SELECT * FROM ${table}`).all()))
  const before = state(), request = owned(s, { items: [{ ...s.thread.items[4], rev: 1000 }] })
  h.database.transaction(db => db.exec("CREATE TRIGGER fail_owned BEFORE INSERT ON thread_records WHEN new.kind = 'header' BEGIN SELECT RAISE(ABORT, 'injected'); END"))
  expect(await h.store.execute(request)).toEqual(error('write-failed'))
  expect(state()).toEqual(before)
  h.database.transaction(db => db.exec('DROP TRIGGER fail_owned'))
  expect(await h.store.execute(request)).toEqual({ status: 'ok' })
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toMatchObject({ status: 'stored', snapshot: { thread: { items: expect.arrayContaining([{ ...s.thread.items[4], rev: 1000 }]) } } })
})

it('failed protected mutable conversion preserves schema 6 and retries on a fresh owner', async () => {
  const h = setup(), s = snapshot()
  await h.store.execute(put(s)); h.database.close()
  const before = readFileSync(join(h.root, 'history/history.sqlite'))
  vi.spyOn(h.encryption, 'encrypt').mockImplementationOnce(() => { throw Error('injected') })
  expect(await h.fresh().store.execute(owned(s))).toEqual(error('write-failed'))
  h.database.close()
  expect(readFileSync(join(h.root, 'history/history.sqlite'))).toEqual(before)
  const fresh = h.fresh()
  expect(fresh.database.transaction(db => db.pragma('user_version', { simple: true }))).toBe(6)
  expect(await fresh.store.execute(owned(s))).toEqual({ status: 'ok' })
  expect(await fresh.store.execute(ask('readThread'))).toEqual(stored(s))
})

it('rejects malformed owned changes before touching storage', async () => {
  const h = setup(), s = snapshot(), transaction = vi.spyOn(h.database, 'transaction')
  const item = s.thread.items[4]
  for (const extra of [{ items: [item, item] }, { items: [item], removeIds: [item.id] },
    { removeIds: [-1] }, { metadata: { ...s.thread, hostId: 'wrong' } }, { sql: 'ignored' }]) {
    expect(await h.store.execute(owned(s, extra))).toEqual(error('invalid-request'))
  }
  expect(transaction).not.toHaveBeenCalled()
})

it('coalesces shared protected paths into one write per path in an owned batch', async () => {
  const h = setup(), s = snapshot(400)
  let writes = 0
  h.database.transaction(db => {
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (sql.startsWith('INSERT OR REPLACE INTO thread_auth')) {
        const run = statement.run.bind(statement)
        statement.run = (...args) => { writes++; return run(...args) }
      }
      return statement
    })
  })
  expect(await h.store.execute(owned(s, { items: s.thread.items }))).toEqual({ status: 'ok' })
  const rows = h.database.transaction(db => db.prepare('SELECT count(*) AS n FROM thread_auth').get() as { n: number })
  expect(writes).toBe(rows.n)
  expect(writes).toBeGreaterThan(400)
})

it('ordinary owned validation, serialization and protected record work stay bounded as unrelated history grows', async () => {
  const h = setup()
  async function measure(count: number) {
    const s = snapshot(count)
    await h.store.execute(put(s)); await h.store.execute(owned(s))
    const entry = { ...s.thread.items[4], rev: 10000 }
    let rows = 0, writes = 0
    h.database.transaction(db => {
      const prepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (sql.startsWith('SELECT')) {
          const all = statement.all.bind(statement), get = statement.get.bind(statement)
          statement.all = (...args) => { const result = all(...args); rows += result.length; return result }
          statement.get = (...args) => { const result = get(...args); rows += result ? 1 : 0; return result }
        } else {
          const run = statement.run.bind(statement)
          statement.run = (...args) => { writes++; return run(...args) }
        }
        return statement
      })
    })
    const decrypt = vi.spyOn(h.encryption, 'decrypt'), encrypt = vi.spyOn(h.encryption, 'encrypt')
    const serialize = vi.spyOn(JSON, 'stringify')
    expect(await h.store.execute(owned(s, { items: [entry] }))).toEqual({ status: 'ok' })
    // Each admitted item is serialized only at the narrow boundary and its payload.
    const itemSerializations = serialize.mock.calls.filter(([value]) => typeof value === 'object' && value !== null &&
      ('value' in value && (value as { value?: { id?: number } }).value?.id === 4 || 'id' in value && value.id === 4)).length
    const work = [rows, writes, decrypt.mock.calls.length, encrypt.mock.calls.length, itemSerializations]
    expect(decrypt).toHaveBeenCalledTimes(3); expect(encrypt).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks(); return work
  }
  const large = await measure(1000), small = await measure(10)
  // Fixed-width lookup plus logarithmic sequence paths; payload work is constant.
  expect(large.slice(2)).toEqual(small.slice(2))
  expect(large[0] - small[0]).toBeLessThan(40)
  expect(large[1] - small[1]).toBeLessThan(40)
})

// Genuine committed pre-upgrade envelopes, independent of the new writer.
function seedSchema5(h: ReturnType<typeof setup>, s = snapshot(), corrupt = false) {
  const identity = '12345678-1234-1234-1234-123456789abc'
  const admitted = parseChatHistorySnapshot(s)
  if (admitted.kind !== 'daemon-items') throw Error('expected thread')
  const { items, ranges, arrivalOrder, ...metadata } = admitted.thread
  h.database.transaction(db => {
    db.exec('DROP TABLE IF EXISTS thread_payloads; DELETE FROM thread_scopes; PRAGMA user_version = 5')
    db.prepare('INSERT INTO thread_scopes VALUES (?, ?, ?)').run(identity, Buffer.from(s.serverId, 'utf16le'), Buffer.from(s.conversationId, 'utf16le'))
    const insert = db.prepare('INSERT INTO thread_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const add = (kind: string, ordinal: number, value: unknown, arrival: number | null = null,
      item_order: number | null = null, range_ordinal: number | null = null, range_start: number | null = null, range_end: number | null = null) => {
      const indexes = { kind, ordinal, arrival, item_order, range_ordinal, range_start, range_end }
      insert.run(identity, kind, ordinal, arrival, item_order, range_ordinal, range_start, range_end,
        h.encryption.encrypt(Buffer.from(JSON.stringify({ scope: identity, ...indexes, value }))))
    }
    add('header', 0, { metadata, itemCount: items.length, rangeCount: ranges.length, hasArrival: true })
    items.forEach((item, i) => {
      const n = typeof item.order === 'number' && Number.isSafeInteger(item.order) && item.order >= 0 ? item.order : null
      const r = n === null ? -1 : ranges.findIndex(r => r.start <= n && n < r.end)
      add('item', i, item, arrivalOrder?.indexOf(item.id) ?? null, n, r < 0 ? null : r)
    })
    ranges.forEach((r, i) => add('range', i, r, null, null, null, r.start, r.end))
    if (corrupt) db.exec("UPDATE thread_records SET range_ordinal = NULL WHERE kind = 'item' AND ordinal = 8")
  })
  h.database.close()
  return Buffer.from(h.encryption.encrypt(Buffer.from(JSON.stringify({ format: 'daemon-items', identity, before: 7 })))).toString('base64url')
}

it('upgrades committed schema-5 history transactionally and preserves old continuations', async () => {
  const h = setup(), s = snapshot(), continuation = seedSchema5(h, s), first = h.fresh()
  const p = await page(first.store, ask('beforeThreadPage', { limit: 2, continuation }))
  expect(p.items).toEqual(s.thread.items.slice(5, 7))
  expect(p.arrivalPositions).toEqual([3, 2])
  expect(await first.store.execute(ask('readThread'))).toEqual(stored(s))
  expect(first.database.transaction(db => db.pragma('user_version', { simple: true }))).toBe(6)
  first.database.close(); const reopened = h.fresh()
  expect(await reopened.store.execute(ask('readThread'))).toEqual(stored(s))
  expect((await page(reopened.store, ask('beforeThreadPage', { limit: 2, continuation }))).items).toEqual(p.items)
})

it.each(['corrupt', 'protection', 'encrypt', 'insert'])('preserves schema-5 commits across failed migration and retries: %s', async mode => {
  const h = setup(), s = snapshot(), continuation = seedSchema5(h, s, mode === 'corrupt')
  const path = join(h.root, 'history/history.sqlite')
  if (mode === 'insert') {
    const db = new Database(path)
    db.exec("CREATE TRIGGER reject_upgrade BEFORE INSERT ON thread_records WHEN NEW.kind = 'range' BEGIN SELECT RAISE(ABORT, 'injected'); END")
    db.close()
  }
  const before = readFileSync(path), fresh = h.fresh()
  if (mode === 'protection') vi.spyOn(h.encryption, 'isAvailable').mockReturnValue(false)
  if (mode === 'encrypt') vi.spyOn(h.encryption, 'encrypt').mockImplementationOnce(() => { throw Error('private') })
  expect(await fresh.store.execute(newest())).toMatchObject({ status: 'error' })
  fresh.database.close()
  expect(readFileSync(path)).toEqual(before)
  const disk = new Database(path)
  expect(disk.pragma('user_version', { simple: true })).toBe(5)
  expect(disk.prepare("SELECT name FROM sqlite_master WHERE name = 'thread_payloads'").all()).toEqual([])
  if (mode === 'insert') disk.exec('DROP TRIGGER reject_upgrade')
  if (mode === 'corrupt') disk.exec("UPDATE thread_records SET range_ordinal = 0 WHERE kind = 'item' AND ordinal = 8")
  disk.close(); vi.restoreAllMocks()
  const retry = h.fresh()
  expect(await retry.store.execute(ask('readThread'))).toEqual(stored(s))
  expect((await page(retry.store, ask('beforeThreadPage', { limit: 2, continuation }))).items).toEqual(s.thread.items.slice(5, 7))
})

it('retains stable payloads while replacement rotates generation and changes placement', async () => {
  const h = setup(), s = snapshot()
  const encrypt = h.encryption.encrypt, decrypt = h.encryption.decrypt
  let serial = 0
  // Distinct ciphertext on every call makes unnecessary re-encryption observable.
  h.encryption.encrypt = bytes => {
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(++serial)
    return Buffer.concat([prefix, Buffer.from(encrypt(bytes))])
  }
  h.encryption.decrypt = bytes => decrypt(bytes.subarray(4))
  expect(await h.store.execute(put(s))).toEqual({ status: 'ok' })
  const payloads = () => h.database.transaction(db => db.prepare('SELECT * FROM thread_payloads ORDER BY item_id').all())
  const before = payloads(), continuation = (await page(h.store)).continuation
  const moved = { ...s, thread: { ...s.thread, items: [...s.thread.items].reverse(),
    version: 400, ranges: [{ start: 0, end: 101 }], repair: null } }
  expect(await h.store.execute(put(moved))).toEqual({ status: 'ok' })
  expect(payloads()).toEqual(before)
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(moved))
  expect(await h.store.execute(ask('beforeThreadPage', { limit: 2, continuation }))).toEqual(error('invalid-request'))
  expect((await page(h.store)).arrivalPositions).toEqual([7, 8])
  const next = (await page(h.store)).continuation
  expect(await h.store.execute(put(moved))).toEqual({ status: 'ok' })
  expect(payloads()).toEqual(before)
  expect(await h.store.execute(ask('beforeThreadPage', { limit: 2, continuation: next }))).toEqual(error('invalid-request'))
  const changed = { ...moved, thread: { ...moved.thread, items: moved.thread.items.map(i => i.id === 8 ? { ...i, rev: 99 } : i) } }
  expect(await h.store.execute(put(changed))).toEqual({ status: 'ok' })
  expect(payloads().slice(0, 8)).toEqual(before.slice(0, 8))
  expect(payloads().slice(8)).not.toEqual(before.slice(8))
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(changed))
  const epoch = { ...moved, thread: { ...moved.thread, epoch: 'next' } }
  expect(await h.store.execute(put(epoch))).toEqual({ status: 'ok' })
  expect(payloads()).not.toEqual(before)
})

it.each(['lookup', 'revision', 'payload', 'owner', 'orphan', 'replayed-placement', 'replayed-range'])('rejects protected payload association tampering: %s', async mode => {
  const h = setup(); await h.store.execute(put(snapshot()))
  const oldPlacement = h.database.transaction(db => db.prepare("SELECT payload FROM thread_records WHERE kind = 'item' AND ordinal = 8").get()) as { payload: Buffer }
  const oldRange = h.database.transaction(db => db.prepare("SELECT payload FROM thread_records WHERE kind = 'range' AND ordinal = 2").get()) as { payload: Buffer }
  if (mode.startsWith('replayed-')) await h.store.execute(put(snapshot()))
  await h.store.execute(put(snapshot(9, 'Other')))
  h.database.transaction(db => {
    const owner = db.prepare('SELECT identity FROM thread_scopes WHERE server = ?').get(Buffer.from('Host', 'utf16le')) as { identity: string }
    const scope = owner.identity
    if (mode === 'lookup') db.prepare('UPDATE thread_payloads SET item_id = 99 WHERE scope = ? AND item_id = 8').run(scope)
    if (mode === 'revision') db.prepare('UPDATE thread_payloads SET revision = 99 WHERE scope = ? AND item_id = 8').run(scope)
    if (mode === 'payload') db.prepare('UPDATE thread_payloads SET payload = (SELECT payload FROM thread_payloads WHERE scope = ? AND item_id = 7) WHERE scope = ? AND item_id = 8').run(scope, scope)
    if (mode === 'owner') db.prepare('UPDATE thread_payloads SET payload = (SELECT payload FROM thread_payloads WHERE scope != ? AND item_id = 8) WHERE scope = ? AND item_id = 8').run(scope, scope)
    if (mode === 'orphan') db.prepare('INSERT INTO thread_payloads SELECT scope, 99, revision, payload FROM thread_payloads WHERE scope = ? AND item_id = 8').run(scope)
    if (mode === 'replayed-placement') db.prepare("UPDATE thread_records SET payload = ? WHERE scope = ? AND kind = 'item' AND ordinal = 8").run(oldPlacement.payload, scope)
    if (mode === 'replayed-range') db.prepare("UPDATE thread_records SET payload = ? WHERE scope = ? AND kind = 'range' AND ordinal = 2").run(oldRange.payload, scope)
  })
  expect(await h.store.execute(ask('readThread'))).toEqual(error('unreadable'))
  if (mode !== 'orphan') expect(await h.store.execute(newest())).toEqual(error('unreadable'))
  expect(await h.store.execute(put(snapshot(1)))).toEqual(error('unreadable'))
  expect(await h.store.execute(ask('readThread', {}, 'Other'))).toEqual(stored(snapshot(9, 'Other')))
})

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
          statement.all = (...args) => { const result = all(...args); rows += result.length; return result }
          statement.get = (...args) => { const result = get(...args); rows += result ? 1 : 0; return result }
        }
        return statement
      })
    })
    const decrypt = vi.spyOn(h.encryption, 'decrypt'), decode = vi.spyOn(JSON, 'parse')
    const p = await page(h.store)
    const work = [rows, decrypt.mock.calls.length, decode.mock.calls.length]
    expect(work).toEqual([7, 6, 6])
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
  h.database.transaction(db => db.exec('DROP TABLE thread_payloads; DROP TABLE thread_records; DROP TABLE thread_scopes; PRAGMA user_version = 2'))
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
  if (family === 'authoritative') seedSchema5(h, s)
  h.database.transaction(db => {
    db.exec(family === 'legacy' ? 'DROP TABLE thread_payloads; DROP TABLE thread_records; DROP TABLE thread_scopes' : 'DROP INDEX legacy_receipt_start')
    db.pragma('user_version = 3')
  })
  h.database.close(); const fresh = h.fresh()
  expect(await fresh.store.execute(ask('readThread'))).toEqual(family === 'legacy' ? { status: 'missing' } : stored(s))
  expect(fresh.database.transaction(db => db.prepare('SELECT identity FROM legacy_scopes').all())).toEqual([{ identity: 'ignored' }])
  fresh.database.transaction(db => {
    expect(db.pragma('user_version', { simple: true })).toBe(6)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_receipt_start'").get()).toEqual({ name: 'legacy_receipt_start' })
  })
})

it('empty replacements always rotate protected generation and invalidate older continuations', async () => {
  const h = setup(); await h.store.execute(put(snapshot()))
  const token = (await page(h.store)).continuation
  const identity = () => h.database.transaction(db => {
    const row = db.prepare("SELECT payload FROM thread_records WHERE kind = 'header'").get() as { payload: Buffer }
    return JSON.parse(Buffer.from(h.encryption.decrypt(row.payload)).toString()).value.generation
  })
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

it('persists a same-revision text companion without admitting same-revision replacements', async () => {
  const h = setup(), s = snapshot(1)
  const before = { ...s.thread.items[0], kind: 'assistant_message', content: { text: 'TH', preserved: true } }
  s.thread.items[0] = before
  await h.store.execute(put(s)); await h.store.execute(owned(s))
  const complete = { ...before, content: { ...before.content, text: 'THREAD_COMPLETE' } }
  expect(await h.store.execute(owned(s, { items: [complete] }))).toEqual({ status: 'ok' })
  for (const stale of [before, complete, { ...complete, content: { ...complete.content, text: 'different' } },
    { ...complete, hidden: !complete.hidden, content: { ...complete.content, text: 'THREAD_COMPLETE extra' } }]) {
    expect(await h.store.execute(owned(s, { items: [stale] }))).toEqual({ status: 'ok' })
  }
  const expected = { ...s, thread: { ...s.thread, items: [complete] } }
  expect(await h.store.execute(ask('readThread'))).toEqual(stored(expected))
  h.database.close()
  expect(await h.fresh().store.execute(ask('readThread'))).toEqual(stored(expected))
})
