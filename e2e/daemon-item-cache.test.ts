import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSecureStore } from '../src/main/secureStore'
import { fileSecretPersistence } from '../src/main/fileSecretPersistence'
import { createChatHistoryStore } from '../src/main/chatHistoryStore'
import { createThreadItemStore } from '../src/renderer/src/store/threadItemStore'
import { createChatHistoryWriter } from '../src/renderer/src/store/chatHistoryWriter'
import { createConversationListStore } from '../src/renderer/src/store/conversationListStore'
import { readSavedTimeline } from '../src/renderer/src/store/savedTimelineRestorer'
import { createThreadRuntime } from '../src/renderer/src/store/threadRuntime'
import { createHistoryDatabase } from '../src/main/historyDatabase'
import type { ChatHistoryRequest, ChatHistoryResult } from '../src/shared/chatHistory'

const roots: string[] = []
const owners: ReturnType<typeof createHistoryDatabase>[] = []
afterEach(async () => { owners.splice(0).forEach(db => db.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it.each([false, true])('fresh protected traversal reaches every fragmented saved identity including opening omissions without writes (invalidation %s)', async invalidation => {
  const { fresh, source, api, writer } = await cache()
  api.acceptEpoch('a', 'c', 'e')
  for (let id = 0; id < 650; id++) api.applyUpdate('a', { type: 'thread_item_added', payload: {
    conversation_id: 'c', epoch: 'e', version: 20, item: { id, rev: 1, kind: 'assistant_message',
      order: id < 100 ? id + 100 : id < 200 ? id + 800 : null, shown: id < 250,
      active: id === 0, summary: '', content: { text: `saved-${id}` } } } })
  api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 20,
    ranges: [{ start: 100, end: 200 }, { start: 900, end: 1000 }], olderAvailable: true })
  await writer.stop()
  const expected = source.getState().snapshot('a', 'c')!, storage = fresh(), writes: string[] = []
  const runtime = createThreadRuntime({ send: () => { throw Error('offline') }, log: () => {}, read: request => {
    writes.push(request.operation); return storage.execute(request)
  } })
  try {
    await runtime.open('a', 'c').done
    expect(runtime.items.getState().snapshot('a', 'c')!.items).toHaveLength(201)
    const slice = () => runtime.items.getState().hosts.get('a')!.get('c')!
    for (let n = 0; n < 10 && slice().residency?.traversal !== null; n++) {
      if (invalidation && n === 2) {
        const { items, ranges, arrivalOrder, ...metadata } = expected
        void items; void ranges; void arrivalOrder
        expect((await storage.execute({ operation: 'mutateThread', serverId: 'a', conversationId: 'c', change: {
          metadata, acceptEpoch: false, items: [], removeIds: [], ranges: [] } })).status).toBe('ok')
      }
      runtime.query('older', 'a')
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(slice().snapshot).toEqual(expected)
    expect(new Set(slice().snapshot.items.map(i => i.id)).size).toBe(650)
    expect(slice().restored).toBe(slice().snapshot)
    if (!invalidation) expect(writes).toEqual(['openThreadPage', 'newestThreadPage', 'beforeThreadPage', 'beforeThreadPage', 'beforeThreadPage'])
    expect(writes.every(operation => ['openThreadPage', 'newestThreadPage', 'beforeThreadPage'].includes(operation))).toBe(true)
    const tokenPage = await storage.execute({ operation: 'newestThreadPage', serverId: 'a', conversationId: 'c', limit: 1 })
    expect(tokenPage.status).toBe('page')
    if (tokenPage.status !== 'page' || !tokenPage.page.continuation) throw Error('missing token')
    const token = tokenPage.page.continuation
    const reopened = fresh()
    expect((await reopened.execute({ operation: 'beforeThreadPage', serverId: 'a', conversationId: 'c', limit: 1, continuation: token })).status).toBe('page')
    await reopened.execute({ operation: 'replaceThread', serverId: 'a', conversationId: 'c', snapshot: {
      version: 1, kind: 'daemon-items', serverId: 'a', conversationId: 'c', thread: expected } })
    expect(await reopened.execute({ operation: 'beforeThreadPage', serverId: 'a', conversationId: 'c', limit: 1, continuation: token }))
      .toEqual({ status: 'error', code: 'unreadable' })
    expect(slice().snapshot).toEqual(expected)
  } finally { runtime.dispose() }
}, 30000)

async function cache(intercept?: (request: ChatHistoryRequest, execute: () => Promise<ChatHistoryResult>) => Promise<ChatHistoryResult>) {
  const root = await mkdtemp(join(tmpdir(), 'thread-restart-')); roots.push(root)
  const database = createHistoryDatabase({ userDataPath: root }); owners.push(database)
  const encryption = { isAvailable: () => true, encrypt: (bytes: Uint8Array) => bytes.map(b => b ^ 173), decrypt: (bytes: Uint8Array) => bytes.map(b => b ^ 173) }
  const fresh = () => { database.close(); return createChatHistoryStore({ log: { event: () => {} }, database, encryption,
    secureStore: createSecureStore({ persistence: fileSecretPersistence(root), encryption }) }) }
  const storage = fresh(), source = createThreadItemStore(), api = source.getState()
  const writer = createChatHistoryWriter({ threads: source, lists: createConversationListStore(),
    receipt: () => null, log: () => {},
    write: request => intercept ? intercept(request, () => storage.execute(request)) : storage.execute(request), schedule: () => () => {} })
  return { fresh, source, api, writer, storage }
}

it.each([[100, false], [100, true], [50, false], [50, true]] as const)(
  'covered checkpoint save stays unreadable until exact retry: version=%s certificate=%s', async (version, certificate) => {
    let itemWrites = 0, failing = true
    const requests: ChatHistoryRequest[] = []
    const { fresh, storage, source, api, writer } = await cache(async (request, execute) => {
      requests.push(request)
      if (request.operation === 'mutateThread' && request.change.items.length && ++itemWrites === 2 && failing)
        return { status: 'error', code: 'write-failed' }
      return execute()
    })
    api.acceptEpoch('a', 'c', 'e'); await writer.flush()
    const held = source.getState().hosts.get('a')!.get('c')!
    const metadata = { hostId: 'a', conversationId: 'c', epoch: 'e', version: 100, checkpoint: 100,
      uncommittedVersion: 0, repair: null, olderAvailable: false }
    const items = Array.from({ length: 100 }, (_, id) => ({ id, rev: 1, kind: 'assistant_message',
      order: id, shown: true, active: false, status: 'finished', summary: '', content: { text: `fixture ${id}` } }))
    await storage.execute({ operation: 'mutateThread', serverId: 'a', conversationId: 'c', change: {
      metadata, acceptEpoch: false, items: items.slice(98), removeIds: [], ranges: [] } })
    const page = await storage.execute({ operation: 'newestThreadPage', serverId: 'a', conversationId: 'c', limit: 1 })
    if (page.status !== 'page' || !page.page.continuation) throw Error('missing seed page')
    const incoming = { ...metadata, version, checkpoint: version }
    source.setState({ hosts: new Map([['a', new Map([['c', { ...held, owned: {
      metadata: incoming, items, ranges: [{ start: 0, end: 100 }], removeIds: [], acceptEpoch: false,
      ...(certificate ? { completion: { fromVersion: 0, version } } : {})
    } }]])]]) })
    await writer.flush()
    const interrupted = fresh()
    for (const operation of ['readThread', 'openThreadPage', 'newestThreadPage', 'beforeThreadPage'] as const) {
      expect(await interrupted.execute({ operation, serverId: 'a', conversationId: 'c',
        ...(operation === 'readThread' ? {} : { limit: 1 }),
        ...(operation === 'beforeThreadPage' ? { continuation: page.page.continuation } : {}) }))
        .toEqual({ status: 'error', code: 'unreadable' })
    }
    expect(await interrupted.execute({ operation: 'mutateThread', serverId: 'a', conversationId: 'c', change: {
      metadata, acceptEpoch: false, items: [], ranges: [], removeIds: [] } }))
      .toEqual({ status: 'error', code: 'write-failed' })
    const failedRequest = requests.at(-1)
    failing = false
    await writer.flush()
    expect(requests).toContainEqual(failedRequest)
    expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' }))
      .toEqual({ status: 'stored', snapshot: { version: 1, kind: 'daemon-items', serverId: 'a', conversationId: 'c',
        thread: { ...metadata, items, ranges: [{ start: 0, end: 100 }], arrivalOrder: [98, 99, ...items.slice(0, 98).map(i => i.id)] } } })
    await writer.stop()
  })

it('stop leaves repeatedly failed admitted work protected without spinning or manufacturing completion', async () => {
  let failures = 0
  const { fresh, source, api, writer } = await cache(async (request, execute) => {
    if (request.operation === 'mutateThread' && request.change.persistence?.part === 1) {
      failures++; return { status: 'error', code: 'write-failed' }
    }
    return execute()
  })
  api.acceptEpoch('a', 'c', 'e'); await writer.flush()
  const held = source.getState().hosts.get('a')!.get('c')!
  source.setState({ hosts: new Map([['a', new Map([['c', { ...held, owned: {
    metadata: { ...held.owned!.metadata, version: 100, checkpoint: 100 }, acceptEpoch: false,
    items: Array.from({ length: 100 }, (_, id) => ({ id, rev: 1, kind: 'future' })), ranges: [], removeIds: []
  } }]])]]) })
  await writer.flush(); expect(failures).toBe(1)
  await writer.stop(); expect(failures).toBe(2)
  api.requireRepair('a', 'c', 'e', 101)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(failures).toBe(2)
  expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' }))
    .toEqual({ status: 'error', code: 'unreadable' })
})

it.each(['prefix', 'final'] as const)('lost %s acknowledgement retries without resurrecting obligations', async lost => {
  let lose = true
  const { fresh, source, api, writer } = await cache(async (request, execute) => {
    const result = await execute()
    if (request.operation === 'mutateThread' && request.change.persistence && lose &&
      request.change.persistence.part === (lost === 'prefix' ? 1 : request.change.persistence.parts - 1)) {
      lose = false; throw Error('lost acknowledgement')
    }
    return result
  })
  api.acceptEpoch('a', 'c', 'e'); await writer.flush()
  const held = source.getState().hosts.get('a')!.get('c')!
  const metadata = { hostId: 'a', conversationId: 'c', epoch: 'e', version: 100, checkpoint: 100,
    uncommittedVersion: 0, repair: null }
  const items = Array.from({ length: 100 }, (_, id) => ({ id, rev: 1, kind: 'future' }))
  const change = { metadata, items, ranges: [], removeIds: [], acceptEpoch: false }
  const admit = (owned: typeof change) => source.setState({ hosts: new Map([['a', new Map([['c', { ...held, owned }]])]]) })
  admit(change); await writer.flush()
  expect(lose).toBe(false)
  expect((await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })).status)
    .toBe(lost === 'prefix' ? 'error' : 'stored')
  admit({ ...change, items: [{ id: 100, rev: 1, kind: 'future' }] })
  await writer.stop()
  expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' }))
    .toEqual({ status: 'stored', snapshot: { version: 1, kind: 'daemon-items', serverId: 'a', conversationId: 'c',
      thread: { ...metadata, items: [...items, { id: 100, rev: 1, kind: 'future' }], ranges: [],
        arrivalOrder: [...items.map(i => i.id), 100] } } })
})

it('bounded data prefixes reopen unfinished and retry to the exact separately admitted state', async () => {
  const results: unknown[] = []
  for (const fail of [false, true]) {
    let submissions = 0, failing = fail
    const { fresh, source, api, writer } = await cache(async (request, execute) => {
      if (request.operation === 'mutateThread' && ++submissions === 4 && failing)
        return { status: 'error', code: 'write-failed' }
      return execute()
    })
    api.acceptEpoch('a', 'c', 'e')
    await writer.flush()
    const held = source.getState().hosts.get('a')!.get('c')!
    const items = Array.from({ length: 100 }, (_, id) => ({ id, rev: 1, kind: 'assistant_message',
      order: id % 7, shown: true, active: false, status: 'finished', summary: '', content: { text: `fixture ${id}` } }))
    const ranges = [{ start: 0, end: 101 }]
    const metadata = { hostId: 'a', conversationId: 'c', epoch: 'e', version: 100, checkpoint: 100,
      uncommittedVersion: 0, repair: null, olderAvailable: false }
    source.setState({ hosts: new Map([['a', new Map([['c', { ...held,
      snapshot: { ...metadata, items: [...items].sort((a, b) => a.order - b.order), ranges,
        arrivalOrder: items.map(i => i.id) },
      owned: { metadata, items, ranges, removeIds: [], acceptEpoch: false,
        completion: { fromVersion: 0, version: 100 }, availability: { start: 0, available: false } }
    }]])]]) })
    await writer.flush()
    if (fail) {
      const partial = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
      expect(partial).toEqual({ status: 'error', code: 'unreadable' })
      failing = false
      await writer.flush()
    }
    const saved = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
    expect(saved).toMatchObject({ status: 'stored', snapshot: { thread: source.getState().snapshot('a', 'c') } })
    results.push(saved)
    await writer.stop()
  }
  expect(results[1]).toEqual(results[0])
}, 30000)

it('separate, queued and lost-acknowledgement saves retain identical removals, extensions, arrival and ordered evidence', async () => {
  const results: unknown[] = []
  for (const mode of ['separate', 'queued', 'lost-ack'] as const) {
    let lose = false
    const { fresh, source, api, writer } = await cache(async (_request, execute) => {
      const result = await execute()
      if (lose) { lose = false; throw Error('lost acknowledgement') }
      return result
    })
    api.acceptEpoch('a', 'c', 'e'); await writer.flush()
    const slice = source.getState().hosts.get('a')!.get('c')!
    const metadata = { ...slice.snapshot, items: undefined, ranges: undefined,
      version: 100, checkpoint: 100, uncommittedVersion: 0 }
    const item = (id: number, text = `fixture ${id}`, rev = 1) => ({ id, rev, kind: 'assistant_message',
      order: id % 5, shown: true, active: false, status: 'finished', summary: '', content: { text } })
    const admit = async (change: Extract<ChatHistoryRequest, { operation: 'mutateThread' }>['change']) => {
      source.setState({ hosts: new Map([['a', new Map([['c', { ...slice, owned: change }]])]]) })
      if (mode === 'separate') await writer.flush()
    }
    await admit({ metadata, acceptEpoch: false, items: Array.from({ length: 100 }, (_, n) => item(n)),
      removeIds: [], ranges: [{ start: 10, end: 20 }], completion: { fromVersion: 0, version: 100 },
      availability: { start: 10, available: false } })
    if (mode === 'lost-ack') { lose = true; await writer.flush() }
    await admit({ metadata: { ...metadata, version: 150, checkpoint: 150 }, acceptEpoch: false,
      items: Array.from({ length: 80 }, (_, n) => item(n + 70, `fixture ${n + 70}`, 2)),
      removeIds: Array.from({ length: 70 }, (_, n) => n),
      ranges: Array.from({ length: 68 }, (_, n) => ({ start: 30 + n * 3, end: 31 + n * 3 })),
      priorProgress: Array.from({ length: 65 }, () => ({ metadata })) })
    await admit({ metadata: { ...metadata, version: 150, checkpoint: 150 }, acceptEpoch: false,
      items: [item(70, 'fixture 70 extended', 2), item(0, 'returned')], removeIds: [], ranges: [],
      priorProgress: [{ metadata: { ...metadata, version: 175, uncommittedVersion: 175 } }],
      availability: { start: 20, available: true }, completion: { fromVersion: 100, version: 150 } })
    await writer.flush()
    const saved = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
    expect(saved).toMatchObject({ status: 'stored', snapshot: { thread: {
      checkpoint: 150, version: 175, uncommittedVersion: 175, olderAvailable: false } } })
    if (saved.status === 'stored' && saved.snapshot.kind === 'daemon-items') {
      expect(saved.snapshot.thread.items).toHaveLength(81)
      expect(saved.snapshot.thread.items.find(i => i.id === 70)).toEqual(item(70, 'fixture 70 extended', 2))
      expect(saved.snapshot.thread.arrivalOrder?.at(-1)).toBe(0)
    }
    results.push(saved)
    await writer.stop()
  }
  expect(results[1]).toEqual(results[0])
  expect(results[2]).toEqual(results[0])
}, 30000)

it.each(['separate', 'coalesced', 'held-failure'] as const)('explicit same-epoch reset replaces owned history through %s saves', async mode => {
  let hold = false, release!: (result: ChatHistoryResult) => void
  const { fresh, api, writer } = await cache((_request, execute) => hold ? new Promise(resolve => { release = resolve }) : execute())
  const add = (id: number) => api.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 20,
    item: { id, rev: 1, kind: 'assistant_message', shown: true, active: false, status: 'done', summary: '', content: {} } } })
  try {
    api.acceptEpoch('a', 'c', 'e'); add(1)
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 20, ranges: [{ start: 10, end: 20 }] })
    if (mode === 'separate') await writer.flush()
    hold = mode === 'held-failure'
    const draining = hold ? writer.flush() : undefined
    // The fourth argument is explicit daemon reset intent, unlike holder deletion.
    api.acceptEpoch('a', 'c', 'e', true)
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 4, ranges: [{ start: 1, end: 4 }] })
    if (draining) { release({ status: 'error', code: 'write-failed' }); await draining; hold = false }
    await writer.flush()
    expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })).toMatchObject({ status: 'stored', snapshot: {
      thread: { items: [], ranges: [{ start: 1, end: 4 }], version: 4, checkpoint: 4 }
    } })
  } finally { await writer.stop() }
})

it('a lost reset acknowledgement does not reset newer facts when the same owned batch retries', async () => {
  let lose = false
  const { fresh, api, writer } = await cache(async (_request, execute) => {
    const result = await execute()
    if (lose) { lose = false; throw Error('lost reset acknowledgement') }
    return result
  })
  try {
    api.acceptEpoch('a', 'c', 'e'); await writer.flush()
    api.acceptEpoch('a', 'c', 'e', true)
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 4, ranges: [{ start: 1, end: 4 }] })
    lose = true; await writer.flush()
    api.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 5,
      item: { id: 5, rev: 5, order: 5, kind: 'assistant_message', shown: true, active: false, status: 'done', summary: '', content: {} } } })
    await writer.flush()
    expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })).toMatchObject({ status: 'stored', snapshot: {
      thread: { items: [{ id: 5 }], version: 5, checkpoint: 5, ranges: [{ start: 1, end: 4 }] }
    } })
  } finally { await writer.stop() }
})

it.each([
  [200, true, false, false], [50, true, true, false], [100, true, false, false], [100, false, false, false],
  [100, false, false, true], [200, false, true, true]
] as const)('saved availability at 100 survives boundary %s with availability %s', async (start, available, expected, initial) => {
  for (const coalesced of [false, true]) {
    const { fresh, api, writer } = await cache()
    try {
      api.acceptEpoch('a', 'c', 'e')
      api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 1, ranges: [{ start: 100, end: 110 }], olderAvailable: initial })
      if (!coalesced) await writer.flush()
      api.deleteConversation('a', 'c'); api.acceptEpoch('a', 'c', 'e')
      api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 2, ranges: [{ start, end: start + 10 }], olderAvailable: available })
      await writer.flush()
      // This holder's metadata still describes its subset boundary, not saved history.
      api.requireRepair('a', 'c', 'e', 3); await writer.flush()
      // Metadata-only recreation must not change the retained certified boundary.
      api.deleteConversation('a', 'c'); api.acceptEpoch('a', 'c', 'e'); await writer.flush()
      expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })).toMatchObject({ status: 'stored', snapshot: {
        thread: { olderAvailable: expected }
      } })
    } finally { await writer.stop() }
  }
})

it.each([
  ['saved', 5], ['pending', 5], ['saved', 10], ['pending', 10]
] as const)('completion through %s/%s stays version-bound across coalescing and held failure', async (seed, through) => {
  async function run(mode: 'separate' | 'coalesced' | 'retry') {
    let hold = false, release!: (result: ChatHistoryResult) => void, attempts = 0
    const { fresh, api, writer } = await cache((_request, execute) => {
      if (!hold) return execute()
      attempts++
      return new Promise(resolve => { release = resolve })
    })
    const add = (id: number, version: number) => api.applyUpdate('a', { type: 'thread_item_added', payload: {
      conversation_id: 'c', epoch: 'e', version, item: { id, rev: version, kind: 'assistant_message',
        active: false, shown: true, status: 'done', summary: '', content: { text: String(id) } }
    } })
    const flush = async () => { if (mode === 'separate') await writer.flush() }
    try {
      api.acceptEpoch('a', 'c', 'e'); add(1, 2)
      const unfinished = api.beginBatch('a', 'c', 'e')!
      unfinished.applyItems([{ id: 2, rev: 10, kind: 'assistant_message', active: false, shown: true,
        status: 'done', summary: '', content: { text: 'unloaded' } }], 10)
      unfinished.abandon(); api.requireRepair('a', 'c', 'e', 10)
      if (seed === 'saved') await writer.flush()
      await flush()
      api.deleteConversation('a', 'c'); api.acceptEpoch('a', 'c', 'e')
      await flush()
      expect(api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: through,
        ranges: [{ start: 1, end: 3 }] }).type).toBe('applied')
      await flush()
      hold = mode === 'retry'
      const draining = hold ? writer.flush() : undefined
      add(3, 12)
      if (draining) {
        release({ status: 'error', code: 'write-failed' }); await draining
        expect(attempts).toBe(1) // Failed work waits for an explicit retry, including newer pending work.
        hold = false
      }
      await writer.flush()
      const result = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
      expect(result).toMatchObject({ status: 'stored', snapshot: { thread: {
        checkpoint: through < 10 ? through : 12, uncommittedVersion: through < 10 ? 10 : 0,
        repair: through < 10 ? { fromVersion: through, throughVersion: 10 } : null,
        ranges: [{ start: 1, end: 3 }], items: [{ id: 1 }, { id: 2 }, { id: 3 }]
      } } })
      return result
    } finally { await writer.stop() }
  }
  const separate = await run('separate')
  expect(await run('coalesced')).toEqual(separate)
  expect(await run('retry')).toEqual(separate)
})

it('later pending repair and unfinished progress survive an earlier completion before the first save', async () => {
  const { fresh, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 5, ranges: [] })
    const unfinished = api.beginBatch('a', 'c', 'e')!
    unfinished.applyItems([{ id: 1, rev: 15, kind: 'assistant_message', active: false, shown: true,
      status: 'done', summary: '', content: { text: 'unfinished' } }], 15)
    unfinished.abandon(); api.requireRepair('a', 'c', 'e', 15)
    api.deleteConversation('a', 'c'); api.acceptEpoch('a', 'c', 'e')
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 10, ranges: [] })
    await writer.stop()
    expect(await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })).toMatchObject({
      status: 'stored', snapshot: { thread: { version: 15, checkpoint: 10, uncommittedVersion: 15,
        repair: { fromVersion: 10, throughVersion: 15 }, items: [{ id: 1, rev: 15 }] } }
    })
  } finally { await writer.stop() }
})

it('retry after a lost acknowledgement does not revive already completed repair obligations', async () => {
  let loseAcknowledgement = true
  const { fresh, api, writer } = await cache(async (_request, execute) => {
    const result = await execute()
    if (loseAcknowledgement && _request.operation === 'mutateThread' && _request.change.metadata.checkpoint === 12) {
      loseAcknowledgement = false; throw Error('lost acknowledgement')
    }
    return result
  })
  try {
    api.acceptEpoch('a', 'c', 'e')
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 2, ranges: [] })
    api.requireRepair('a', 'c', 'e', 10)
    api.beginBatch('a', 'c', 'e')!.commit({ fromVersion: 2, version: 10, ranges: [] })
    api.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 12,
      item: { id: 1, rev: 12, kind: 'assistant_message', active: false, shown: true,
        status: 'done', summary: '', content: { text: 'received' } } } })
    await writer.flush()
    const request = { operation: 'readThread', serverId: 'a', conversationId: 'c' }
    const committed = await fresh().execute(request)
    expect(committed).toMatchObject({ status: 'stored', snapshot: { thread: { checkpoint: 12, repair: null } } })
    await writer.flush()
    expect(await fresh().execute(request)).toEqual(committed)
    api.requireRepair('a', 'c', 'e', 12)
    await writer.flush()
    expect(await fresh().execute(request)).toMatchObject({ status: 'stored', snapshot: { thread: {
      checkpoint: 12, repair: { fromVersion: 12, throughVersion: 12 }
    } } })
  } finally { await writer.stop() }
})

it('same-epoch holder recreation saves only owned facts and metadata without erasing unloaded history', async () => {
  const { fresh, source, api, writer } = await cache()
  api.acceptEpoch('a', 'c', 'e')
  const batch = api.beginBatch('a', 'c', 'e')!
  const item = (id: number, rev: number) => ({ id, rev, kind: 'assistant_message', order: id,
    active: false, shown: true, status: 'done', summary: '', content: { text: String(id) } })
  batch.applyItems([item(1, 1), item(2, 1), item(3, 1)], 10)
  batch.commit({ fromVersion: 0, version: 10, ranges: [{ start: 1, end: 4 }] })
  await writer.flush()
  source.getState().deleteConversation('a', 'c')
  source.getState().acceptEpoch('a', 'c', 'e')
  await writer.flush()
  const recreated = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
  expect(recreated).toMatchObject({ status: 'stored', snapshot: { thread: { checkpoint: 10,
    ranges: [{ start: 1, end: 4 }], items: [item(1, 1), item(2, 1), item(3, 1)] } } })
  source.getState().applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 20, item: item(2, 20) } })
  source.getState().requireRepair('a', 'c', 'e', 30)
  await writer.stop()
  const saved = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
  expect(saved.status).toBe('stored')
  if (saved.status !== 'stored' || saved.snapshot.kind !== 'daemon-items') throw Error('expected thread')
  expect(saved.snapshot.thread.items.map(i => [i.id, i.rev])).toEqual([[1, 1], [2, 20], [3, 1]])
  expect(saved.snapshot.thread.ranges).toEqual([{ start: 1, end: 4 }])
  expect(saved.snapshot.thread.arrivalOrder).toEqual([1, 2, 3])
  expect(saved.snapshot.thread.repair?.throughVersion).toBe(30)
})

it('fresh protected restoration merges live ownership without saving hydration', async () => {
  const { fresh, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    const batch = api.beginBatch('a', 'c', 'e')!
    const item = (id: number, rev = 1) => ({ id, rev, order: id, kind: 'assistant_message', active: false,
      shown: true, status: 'done', summary: '', content: { text: String(id) } })
    batch.applyItems([item(1), item(2), item(3)], 100)
    batch.commit({ fromVersion: 0, version: 100, ranges: [{ start: 1, end: 4 }], olderAvailable: false })
    api.requireRepair('a', 'c', 'e', 150)
    api.beginBatch('a', 'c', 'e')!.applyItems([item(3, 2)], 250)
    await writer.stop()
    const storage = fresh(), target = createThreadItemStore(), writes: ChatHistoryRequest[] = []
    const targetWriter = createChatHistoryWriter({ threads: target, lists: createConversationListStore(), receipt: () => null,
      log: () => {}, schedule: () => () => {}, write: request => { writes.push(request); return storage.execute(request) } })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const restoring = readSavedTimeline({ threads: target, read: async request => {
      const result = await storage.execute(request); await gate; return result
    }, log: () => {} }, 'a', 'c')
    target.getState().applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e',
      version: 400, item: item(2, 3) } })
    target.getState().acceptEpoch('b', 'c', 'e')
    target.getState().applyUpdate('b', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 7, item: item(1, 7) } })
    await targetWriter.flush(); const count = writes.length
    release(); await restoring.done; await targetWriter.flush()
    expect(writes).toHaveLength(count)
    expect(target.getState().snapshot('a', 'c')).toMatchObject({ checkpoint: 100, version: 400, uncommittedVersion: 250,
      repair: { fromVersion: 100, throughVersion: 150 }, olderAvailable: false,
      items: [item(1), item(2, 3), item(3, 2)], arrivalOrder: [1, 2, 3], ranges: [{ start: 1, end: 4 }] })
    target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 500, item_id: 2, base_rev: 3, rev: 4, text: '!' } })
    await targetWriter.stop()
    const reopened = createThreadItemStore(), nextStorage = fresh()
    await readSavedTimeline({ threads: reopened, read: request => nextStorage.execute(request), log: () => {} }, 'a', 'c').done
    expect(reopened.getState().snapshot('a', 'c')).toEqual(target.getState().snapshot('a', 'c'))
    expect(target.getState().snapshot('b', 'c')?.items).toEqual([item(1, 7)])
  } finally { await writer.stop() }
})

it.each([false, true])('protected writer-to-offline-store restart retains completion=%s', async complete => {
  const { fresh, api, writer } = await cache()
  try {
    for (const host of ['a', 'b']) {
      api.acceptEpoch(host, 'c', 'e')
      const batch = api.beginBatch(host, 'c', 'e')!
      batch.applyItems([{ id: 1, rev: 10, kind: 'assistant_message', order: 1, active: true, shown: false,
        status: 'future', summary: '', content: JSON.parse('{"text":"hello","__proto__":null}'), agent: 'codex' }], 10)
      if (complete) batch.commit({ fromVersion: 0, version: 10, ranges: [{ start: 1, end: 10 }], olderAvailable: false })
      else batch.abandon()
      api.applyUpdate(host, { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
        version: 20, item_id: 1, base_rev: 10, rev: 20, changes: { agent: null, parent: null } } })
    }
    await writer.stop()
    const target = createThreadItemStore(), afterRestart = fresh()
    for (const host of ['a', 'b']) await readSavedTimeline({ threads: target,
      read: request => afterRestart.execute(request), log: () => {} }, host, 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    expect(target.getState().snapshot('b', 'c')).toEqual(api.snapshot('b', 'c'))
    const restored = target.getState().snapshot('a', 'c')!
    expect(restored.items[0]).toMatchObject({ shown: false, agent: null, parent: null })
    expect(Object.hasOwn(restored.items[0].content as object, '__proto__')).toBe(true)
    expect(Object.isFrozen(restored.items[0].content)).toBe(true)
    target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 30, item_id: 1, base_rev: 20, rev: 30, text: '!' } })
    expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(complete ? 30 : 0)
    if (!complete) {
      target.getState().beginBatch('a', 'c', 'e')!.commit({ fromVersion: 0, version: 10, ranges: [] })
      target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
        version: 40, item_id: 1, base_rev: 30, rev: 40, text: '?' } })
      expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(40)
    }
    expect(target.getState().snapshot('b', 'c')?.items[0].rev).toBe(20)
  } finally { await writer.stop() }
})

it.each([50, 100])('saves live success after abandoning a batch already covered through %s', async batchVersion => {
  const { fresh, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    api.applyUpdate('a', { type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: 100,
      item: { id: 1, rev: 100, kind: 'assistant_message', active: false, shown: true, status: 'done', summary: '', content: { text: 'first' } } } })
    await writer.flush()
    const batch = api.beginBatch('a', 'c', 'e')!
    batch.applyItems([{ id: 1, rev: batchVersion, kind: 'assistant_message', active: false, shown: true,
      status: 'done', summary: '', content: { text: 'old' } }], batchVersion)
    batch.abandon()
    await writer.flush()
    const savedBatch = await fresh().execute({ operation: 'readThread', serverId: 'a', conversationId: 'c' })
    const batchSnapshot = api.snapshot('a', 'c')
    api.applyUpdate('a', { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
      version: 200, item_id: 1, base_rev: 100, rev: 200, changes: { content: { text: 'newest' } } } })
    await writer.flush()
    const target = createThreadItemStore(), afterRestart = fresh()
    await readSavedTimeline({ threads: target, read: request => afterRestart.execute(request), log: () => {} }, 'a', 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    expect(savedBatch).toMatchObject({ status: 'stored', snapshot: { thread: batchSnapshot } })
    expect(target.getState().snapshot('a', 'c')).toMatchObject({ checkpoint: 200, uncommittedVersion: batchVersion,
      items: [{ rev: 200, content: { text: 'newest' } }] })
    target.getState().applyUpdate('a', { type: 'thread_text_append', payload: { conversation_id: 'c', epoch: 'e',
      version: 300, item_id: 1, base_rev: 200, rev: 300, text: '!' } })
    expect(target.getState().snapshot('a', 'c')?.checkpoint).toBe(300)
  } finally { await writer.stop() }
})

it('restart preserves first-arrival ties after order changes and clears', async () => {
  const { fresh, source, api, writer } = await cache()
  try {
    api.acceptEpoch('a', 'c', 'e')
    for (const [id, order] of [[1, 20], [2, 10]]) api.applyUpdate('a', {
      type: 'thread_item_added', payload: { conversation_id: 'c', epoch: 'e', version: id,
        item: { id, rev: 1, kind: 'assistant_message', order, active: false, shown: true,
          status: 'done', summary: '', content: { text: String(id) } } } })
    expect(api.snapshot('a', 'c')?.items.map(item => item.id)).toEqual([2, 1])
    await writer.flush()
    const target = createThreadItemStore(), afterRestart = fresh()
    await readSavedTimeline({ threads: target, read: request => afterRestart.execute(request), log: () => {} }, 'a', 'c').done
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
    for (const store of [source, target]) {
      store.getState().applyUpdate('a', { type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e',
        version: 3, item_id: 1, base_rev: 1, rev: 2, changes: { order: 10 } } })
      expect(store.getState().snapshot('a', 'c')?.items.map(item => item.id)).toEqual([1, 2])
      for (const [id, rev] of [[1, 2], [2, 1]]) store.getState().applyUpdate('a', {
        type: 'thread_item_changed', payload: { conversation_id: 'c', epoch: 'e', version: id + 3,
          item_id: id, base_rev: rev, rev: rev + 1, changes: { order: null } } })
      expect(store.getState().snapshot('a', 'c')?.items.map(item => item.id)).toEqual([1, 2])
    }
    expect(target.getState().snapshot('a', 'c')).toEqual(api.snapshot('a', 'c'))
  } finally { await writer.stop() }
})
