import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChatHistoryRequest, ChatHistoryResult, ThreadSnapshot } from '../../src/shared/chatHistory'
import { createChatHistoryStore } from '../../src/main/chatHistoryStore'
import { createHistoryDatabase } from '../../src/main/historyDatabase'
import { createSecureStore } from '../../src/main/secureStore'
import { fileSecretPersistence } from '../../src/main/fileSecretPersistence'
import { createDiagnosticLog } from '../../src/main/diagnosticLog'
import { createChatHistoryHandler } from '../../src/main/chatHistoryHandler'
import { createChatHistoryWriter } from '../../src/renderer/src/store/chatHistoryWriter'
import { createConversationListStore } from '../../src/renderer/src/store/conversationListStore'
import { createThreadItemStore } from '../../src/renderer/src/store/threadItemStore'
import { readHistoryCoverage } from './historyCoverage'

afterEach(() => vi.useRealTimers())
const stored = (start: number | null = 100): ChatHistoryResult => ({ status: 'stored', snapshot: {
  version: 1, kind: 'daemon-items', serverId: 'host', conversationId: 'chat', thread: {
    hostId: 'host', conversationId: 'chat', epoch: 'epoch', version: 1, checkpoint: 1,
    uncommittedVersion: 0, repair: null, items: [], arrivalOrder: [],
    ranges: start === null ? [] : [{ start, end: 200 }]
  }
} })
function page(start: number | null = 100): Extract<ChatHistoryResult, { status: 'page' }> {
  const result = stored(start)
  if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') throw Error('fixture')
  const { items, ranges, arrivalOrder: _arrival, ...metadata } = result.snapshot.thread
  return { status: 'page', page: { partial: true, metadata, items, ranges, continuation: null } }
}
function gate() {
  let release = () => {}
  const ready = new Promise<void>(resolve => { release = resolve })
  return { ready, release }
}

it('bounded protected reads leave time for received paging progress', async () => {
  vi.useFakeTimers({ toFake: ['performance'] })
  const root = await mkdtemp(join(tmpdir(), 'history-coverage-work-'))
  const database = createHistoryDatabase({ userDataPath: root })
  let observing = false, decrypts = 0
  const encryption = { isAvailable: () => true, encrypt: (b: Uint8Array) => b.map(n => n ^ 173),
    decrypt: (b: Uint8Array) => {
      if (observing) {
        decrypts++
        // Controlled synchronous keychain cost: full reads monopolize main's queue,
        // whereas a selected protected page leaves time for receipt and persistence.
        // Advance only the monotonic deadline clock. Real tasks stay queued
        // until this synchronous protected read returns; no wall-clock sleep.
        vi.advanceTimersByTime(10)
      }
      return b.map(n => n ^ 173)
    } }
  const log = createDiagnosticLog({ sink: { write: () => {} } })
  const store = createChatHistoryStore({ database, encryption, log,
    secureStore: createSecureStore({ encryption, persistence: fileSecretPersistence(root) }) })
  const handle = createChatHistoryHandler({ store, log, pairedServers: { loadById: async () => ({}) as never } })
  const threads = createThreadItemStore(), lists = createConversationListStore(), trace: string[] = []
  const thread: ThreadSnapshot = { hostId: 'host', conversationId: 'chat', epoch: 'epoch', version: 412,
    checkpoint: 412, uncommittedVersion: 0, repair: null, ranges: [{ start: 113, end: 413 }],
    items: Array.from({ length: 300 }, (_, index) => ({ id: 113 + index, rev: 1, kind: 'future', order: 113 + index })) }
  expect(await handle(null, { operation: 'replaceThread', serverId: 'host', conversationId: 'chat',
    snapshot: { version: 1, kind: 'daemon-items', serverId: 'host', conversationId: 'chat', thread } })).toEqual({ status: 'ok' })
  threads.getState().beginLocalRead('host', 'chat')!.complete(thread)
  const writer = createChatHistoryWriter({ threads, lists, receipt: () => null, log: () => {},
    schedule: run => { const timer = setTimeout(run, 0); return () => clearTimeout(timer) },
    write: async request => {
      const result = await handle(null, request)
      if (request.operation === 'mutateThread' && request.change.ranges.length) trace.push('range-durable')
      expect(result).toEqual({ status: 'ok' })
      return result
    } })
  let publication: ReturnType<typeof setTimeout> | undefined
  let first = true
  try {
    trace.push('query-dispatched')
    const start = await readHistoryCoverage(async (request: ChatHistoryRequest = {
      operation: 'readThread', serverId: 'host', conversationId: 'chat'
    }) => {
      observing = true
      let result: ChatHistoryResult
      try { result = await handle(null, request) } finally { observing = false }
      const ranges = result.status === 'page' ? result.page.ranges
        : result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.ranges : []
      trace.push(`protected-read:${ranges[0]?.start ?? result.status}`)
      if (first) {
        first = false
        // Delivery is ready on the next task, after the initial protected read.
        publication = setTimeout(() => {
          const batch = threads.getState().beginBatch('host', 'chat', 'epoch')!
          batch.applyItems(Array.from({ length: 50 }, (_, index) => ({
            id: 63 + index, rev: 1, kind: 'future', order: 63 + index
          })), 412)
          expect(batch.commit({ fromVersion: 0, version: 412, ranges: [{ start: 63, end: 113 }], olderAvailable: true }).type).toBe('applied')
          trace.push('page-published')
        }, 0)
      }
      return result
    }, 'host', 'chat', 113)
    expect(start).toBe(63)
    expect(trace.indexOf('page-published')).toBeGreaterThan(trace.indexOf('protected-read:113'))
    expect(trace.indexOf('range-durable')).toBeGreaterThan(trace.indexOf('page-published'))
    expect(trace.indexOf('protected-read:63')).toBeGreaterThan(trace.indexOf('range-durable'))
    expect(decrypts).toBeLessThan(50)
  } finally {
    console.info(JSON.stringify({ boundedCoverage: { decrypts, trace } }))
    clearTimeout(publication)
    observing = false
    await writer.stop(); await store.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15_000)

it('waits across split saves at baseline and after dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-coverage-'))
  const database = createHistoryDatabase({ userDataPath: root })
  const encryption = { isAvailable: () => true, encrypt: (b: Uint8Array) => b.map(n => n ^ 173),
    decrypt: (b: Uint8Array) => b.map(n => n ^ 173) }
  const log = createDiagnosticLog({ sink: { write: () => {} } })
  const store = createChatHistoryStore({ database, encryption, log,
    secureStore: createSecureStore({ encryption, persistence: fileSecretPersistence(root) }) })
  const handle = createChatHistoryHandler({ store, log, pairedServers: { loadById: async () => ({}) as never } })
  const threads = createThreadItemStore(), lists = createConversationListStore()
  const trace: string[] = []
  let scheduled: (() => void) | undefined
  let control: ReturnType<typeof controls> | undefined
  function controls() { return { prefix: gate(), prefixAck: gate(), final: gate(), finalCommit: gate(), durable: gate(), ack: gate() } }
  const writer = createChatHistoryWriter({ threads, lists, receipt: () => null, log: () => {},
    schedule: run => { scheduled = run; return () => { scheduled = undefined } },
    write: async request => {
      const c = control
      const part = request.operation === 'mutateThread' ? request.change.persistence : undefined
      if (c && part && part.part === part.parts - 1) {
        trace.push('final-submitted'); c.final.release(); await c.finalCommit.ready
      }
      const result = await handle(null, request)
      expect(result.status).toBe('ok')
      if (c && part?.part === 0) {
        trace.push('prefix-durable'); c.prefix.release(); await c.prefixAck.ready
      }
      if (c && part && part.part === part.parts - 1) {
        trace.push('final-durable'); c.durable.release(); await c.ack.ready
        trace.push('final-acknowledged')
      }
      return result
    } })
  const read = async (request: ChatHistoryRequest = { operation: 'readThread', serverId: 'host', conversationId: 'chat' }) => {
    const result = await handle(null, request)
    trace.push(result.status === 'error' ? `protected-read:${result.code}` : 'protected-read:stored')
    return result
  }
  try {
    threads.getState().acceptEpoch('host', 'chat', 'epoch'); scheduled?.()
    await vi.waitFor(async () => expect((await read()).status).toBe('stored'))
    let before: number | undefined
    for (const start of [100, 50]) {
      vi.useRealTimers()
      control = controls()
      const slice = threads.getState().hosts.get('host')!.get('chat')!
      const { items: _items, ranges: _ranges, arrivalOrder: _arrival, ...previous } = slice.snapshot
      const metadata = { ...previous, version: 100, checkpoint: 100 }
      const items = Array.from({ length: 40 }, (_, id) => ({ id: start + id, rev: 1, kind: 'future', order: start + id }))
      const ranges = [{ start, end: 200 }]
      if (before !== undefined) trace.push('query-dispatched')
      threads.setState({ hosts: new Map([['host', new Map([['chat', { ...slice,
        snapshot: { ...metadata, items, ranges, arrivalOrder: items.map(i => i.id) },
        owned: { metadata, items, ranges, removeIds: [], acceptEpoch: false,
          completion: { fromVersion: 0, version: 100 } }
      }]])]]) })
      trace.push('page-published'); scheduled?.(); await control.prefix.ready
      const original = await read()
      const collapsed = original.status === 'stored' && original.snapshot.kind === 'daemon-items'
        ? original.snapshot.thread.ranges[0]?.start : undefined
      expect(collapsed).toBeUndefined()
      // Both original assertions reject this actual protected-store result.
      expect(() => expect(collapsed).toBeDefined()).toThrow()
      if (before !== undefined) expect(() => expect(collapsed).toBeLessThan(before!)).toThrow()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
      let finished = false
      const observing = readHistoryCoverage(read, 'host', 'chat', before).then(value => { finished = true; return value })
      await vi.advanceTimersByTimeAsync(200)
      expect(finished).toBe(false)
      control.prefixAck.release(); await control.final.ready
      await vi.advanceTimersByTimeAsync(300)
      expect(finished).toBe(false)
      expect(await read()).toEqual({ status: 'error', code: 'unreadable' })
      control.finalCommit.release(); await control.durable.ready
      control.ack.release()
      await vi.runAllTimersAsync()
      const actual = await observing
      expect(actual).toBe(start)
      if (before !== undefined) expect(actual).toBeLessThan(before)
      before = actual
      trace.push(`retained-start:${actual}`)
    }
    const dispatch = trace.indexOf('query-dispatched')
    const publication = trace.indexOf('page-published', dispatch)
    const unreadable = trace.indexOf('protected-read:unreadable', publication)
    const durable = trace.indexOf('final-durable', unreadable)
    expect(publication).toBeGreaterThan(dispatch)
    expect(unreadable).toBeGreaterThan(publication)
    expect(durable).toBeGreaterThan(unreadable)
    expect(trace.indexOf('retained-start:50')).toBeGreaterThan(durable)
    expect(trace.filter(event => event === 'final-acknowledged')).toHaveLength(2)
    console.info(JSON.stringify({ protectedCoverageOrdering: trace }))
  } finally {
    control?.prefixAck.release(); control?.finalCommit.release(); control?.ack.release()
    vi.useRealTimers(); await writer.stop(); await store.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('requests one protected item and retains the actual newest range boundary', async () => {
  const read = vi.fn(async () => page(0))
  expect(await readHistoryCoverage(read, 'host', 'chat', 1)).toBe(0)
  expect(read).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledWith({ operation: 'newestThreadPage', serverId: 'host', conversationId: 'chat', limit: 1 })
})

it.each(['hostId', 'conversationId'] as const)('rejects wrong page ownership: %s', async field => {
  const result = page()
  result.page.metadata = { ...result.page.metadata, [field]: 'other' }
  const read = vi.fn(async () => result)
  await expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow('wrong-owner')
  expect(read).toHaveBeenCalledOnce()
})

it('does not treat an older disjoint protected range as progress of the newest window', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const result = page()
  result.page.ranges = [{ start: 0, end: 50 }, { start: 100, end: 200 }]
  const read = vi.fn(async () => result)
  const failure = expect(readHistoryCoverage(read, 'host', 'chat', 100)).rejects.toThrow('no-progress')
  await vi.runAllTimersAsync(); await failure
  expect(read.mock.calls.length).toBeGreaterThan(1)
})

it.each([
  ['unreadable', { status: 'error', code: 'unreadable' }], ['missing', { status: 'missing' }],
  ['empty-ranges', stored(null)], ['no-progress', stored(100)], ['no-progress', stored(110)]
] as const)('bounds persistent %s', async (category, value) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const started = Date.now(), read = vi.fn(async () => value as ChatHistoryResult)
  const failure = expect(readHistoryCoverage(read, 'host', 'chat', 100)).rejects.toThrow(category)
  await vi.runAllTimersAsync(); await failure
  expect(Date.now() - started).toBeLessThanOrEqual(5000)
  expect(read.mock.calls.length).toBeGreaterThan(1)
})

it.each(['invalid-request', 'unknown-host', 'membership-unavailable', 'unsupported-version',
  'encryption-unavailable', 'write-failed', 'remove-failed'] as const)('does not repeat %s', async code => {
  const read = vi.fn(async (): Promise<ChatHistoryResult> => ({ status: 'error', code }))
  await expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow(code)
  expect(read).toHaveBeenCalledOnce()
})

it.each(['serverId', 'conversationId', 'hostId', 'innerConversation'] as const)('rejects wrong ownership: %s', async field => {
  const result = stored()
  if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') throw Error('fixture')
  if (field === 'serverId' || field === 'conversationId') result.snapshot[field] = 'other'
  else result.snapshot.thread[field === 'hostId' ? 'hostId' : 'conversationId'] = 'other'
  const read = vi.fn(async () => result)
  await expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow('wrong-owner')
  expect(read).toHaveBeenCalledOnce()
})

it.each<ChatHistoryResult>([{ status: 'ok' }, { status: 'stored', snapshot: {
  version: 1, kind: 'list', serverId: 'host', conversations: []
} }])('rejects unexpected status/kind', async result => {
  const read = vi.fn(async () => result)
  await expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow('unexpected-result')
  expect(read).toHaveBeenCalledOnce()
})

it('does not expose or repeat a rejected read', async () => {
  const read = vi.fn(async (): Promise<ChatHistoryResult> => { throw Error('private content') })
  await expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow(/^History coverage: read-failed$/)
  expect(read).toHaveBeenCalledOnce()
})

it('does not retain unreadable when the next result is unexpected', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const read = vi.fn(async (): Promise<ChatHistoryResult> => ({ status: 'ok' }))
    .mockResolvedValueOnce({ status: 'error', code: 'unreadable' })
  const failure = expect(readHistoryCoverage(read, 'host', 'chat')).rejects.toThrow('unexpected-result')
  await vi.runAllTimersAsync(); await failure
  expect(read).toHaveBeenCalledTimes(2)
})

it.each([undefined, 1])('returns actual zero without rereading (before %s)', async before => {
  const read = vi.fn(async () => stored(0)).mockResolvedValueOnce(stored(0)).mockResolvedValue({ status: 'missing' })
  expect(await readHistoryCoverage(read, 'host', 'chat', before)).toBe(0)
  expect(read).toHaveBeenCalledOnce()
})
