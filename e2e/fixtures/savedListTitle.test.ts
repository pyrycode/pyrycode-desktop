import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ChatHistoryResult, ChatHistorySnapshot } from '../../src/shared/chatHistory'
import { createChatHistoryStore } from '../../src/main/chatHistoryStore'
import { createHistoryDatabase } from '../../src/main/historyDatabase'
import { createSecureStore } from '../../src/main/secureStore'
import { fileSecretPersistence } from '../../src/main/fileSecretPersistence'
import { createDiagnosticLog } from '../../src/main/diagnosticLog'
import { createChatHistoryHandler } from '../../src/main/chatHistoryHandler'
import { createChatHistoryWriter } from '../../src/renderer/src/store/chatHistoryWriter'
import { createConversationListStore } from '../../src/renderer/src/store/conversationListStore'
import { createThreadItemStore } from '../../src/renderer/src/store/threadItemStore'
import { readSavedListTitle } from './savedListTitle'
import { savedRepliesMatch, type RecordedReply } from './threadReplyEvidence'

afterEach(() => vi.useRealTimers())
const row = (id = 'chat', name: string | null = null) => ({ id, name, cwd: '/', is_promoted: false,
  is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null })
const list = (rows = [row()], host = 'host'): ChatHistoryResult => ({ status: 'stored', snapshot: {
  version: 1, kind: 'list', serverId: host, conversations: rows
} })

it('waits for the exact named list after replies are already saved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saved-list-title-'))
  const database = createHistoryDatabase({ userDataPath: root })
  const encryption = { isAvailable: () => true, encrypt: (b: Uint8Array) => b.map(n => n ^ 173),
    decrypt: (b: Uint8Array) => b.map(n => n ^ 173) }
  const log = createDiagnosticLog({ sink: { write: () => {} } })
  const store = createChatHistoryStore({ database, encryption, log,
    secureStore: createSecureStore({ encryption, persistence: fileSecretPersistence(root) }) })
  const handle = createChatHistoryHandler({ store, log,
    pairedServers: { loadById: async () => ({}) as never } })
  const lists = createConversationListStore(), threads = createThreadItemStore()
  const events: string[] = []
  let receipt: { type: string; serverId: string } | null = null
  let scheduled: (() => void) | undefined
  let held = false, release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  const writer = createChatHistoryWriter({ lists, threads, receipt: () => receipt, log: () => {},
    schedule: run => { scheduled = run; return () => { scheduled = undefined } },
    write: async request => {
      if (request.operation === 'replaceList' && held) {
        events.push('named-list-submitted'); await gate
      }
      const result = await handle(null, request)
      if (request.operation === 'replaceList' && held) events.push('named-list-acknowledged')
      return result
    } })
  const receive = (name: string | null) => {
    events.push(name === null ? 'unnamed-list-received' : 'named-list-received')
    receipt = { type: 'conversationsReceived', serverId: 'host' }
    lists.getState().setConversations([row('chat', name), row('other', 'Other title')], 'host')
    receipt = null
  }
  const read = async () => {
    const result = await handle(null, { operation: 'readList', serverId: 'host' })
    const name = result.status === 'stored' && result.snapshot.kind === 'list'
      ? result.snapshot.conversations.find(r => r.id === 'chat')?.name : undefined
    events.push(typeof name === 'string' ? 'protected-read:named' : 'protected-read:unnamed')
    return result
  }
  try {
    receive(null)
    threads.getState().acceptEpoch('host', 'chat', 'epoch')
    threads.getState().applyUpdate('host', { type: 'thread_item_added', payload: {
      conversation_id: 'chat', epoch: 'epoch', version: 1, item: {
        id: 1, rev: 1, kind: 'assistant_message', session: 'session', agent: 'claude', turn: 'turn',
        status: 'done', active: false, shown: true, summary: '', content: { text: 'Actual reply' }
      }
    } })
    scheduled?.()
    const reply: RecordedReply = { host: 'host', conversation: 'chat', epoch: 'epoch', id: 1,
      session: 'session', agent: 'claude', turn: 'turn', text: 'Actual reply' }
    await vi.waitFor(async () => {
      const result = await handle(null, { operation: 'readThread', serverId: 'host', conversationId: 'chat' })
      expect(savedRepliesMatch(result.status === 'stored' && result.snapshot.kind === 'daemon-items'
        ? result.snapshot.thread : null, [reply])).toBe(true)
    })
    // The original one-shot projection deterministically yields a stored null name.
    const original = await read()
    expect(original).toMatchObject({ status: 'stored', snapshot: { kind: 'list',
      conversations: [expect.objectContaining({ id: 'chat', name: null }), expect.anything()] } })
    const originalTitle = original.status === 'stored' && original.snapshot.kind === 'list'
      ? original.snapshot.conversations.find(r => r.id === 'chat')?.name : null
    expect(() => expect(typeof originalTitle).toBe('string')).toThrow()
    vi.useFakeTimers()
    let retired = false
    const observing = readSavedListTitle(read, 'host', 'chat').then(title => {
      events.push('retirement'); retired = true; return title
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(retired).toBe(false)
    // Delivery and scheduled persistence proceed independently of the observation.
    held = true; receive('Actual saved title'); scheduled?.()
    await vi.advanceTimersByTimeAsync(300)
    expect(events).toContain('named-list-submitted')
    expect(retired).toBe(false)
    release()
    await vi.runAllTimersAsync()
    expect(await observing).toBe('Actual saved title')
    expect(events).toEqual([
      'unnamed-list-received', 'protected-read:unnamed', 'protected-read:unnamed',
      'protected-read:unnamed', 'named-list-received', 'named-list-submitted',
      'protected-read:unnamed', 'named-list-acknowledged', 'protected-read:named', 'retirement'
    ])
    console.info(JSON.stringify({ savedTitleOrdering: events }))
  } finally {
    release(); vi.useRealTimers(); await writer.stop(); database.close()
    await rm(root, { recursive: true, force: true })
  }
})

it.each([
  ['missing-list', { status: 'missing' }], ['absent-row', list([row('other', 'Other title')])],
  ['unnamed-row', list()]
] as const)('bounds persistent %s', async (category, value) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const started = Date.now()
  const read = vi.fn(async () => value as ChatHistoryResult)
  const failure = expect(readSavedListTitle(read, 'host', 'chat')).rejects.toThrow(category)
  await vi.runAllTimersAsync(); await failure
  expect(Date.now() - started).toBeLessThanOrEqual(5000)
  expect(read.mock.calls.length).toBeGreaterThan(1)
})

it.each([
  ['unreadable', { status: 'error', code: 'unreadable' }],
  ['unexpected-result', { status: 'ok' }],
  ['unexpected-result', { status: 'stored', snapshot: { kind: 'daemon-items' } as ChatHistorySnapshot }],
  ['wrong-host', list([row('chat', 'Wrong host title')], 'other-host')]
] as const)('does not repeat %s', async (category, value) => {
  const read = vi.fn(async () => value as ChatHistoryResult)
  await expect(readSavedListTitle(read, 'host', 'chat')).rejects.toThrow(category)
  expect(read).toHaveBeenCalledOnce()
})

it('does not repeat a rejected protected read', async () => {
  const read = vi.fn(async (): Promise<ChatHistoryResult> => { throw new Error('private failure') })
  await expect(readSavedListTitle(read, 'host', 'chat')).rejects.toThrow('read-failed')
  expect(read).toHaveBeenCalledOnce()
})

it.each(['Actual saved title', ''])('returns the actual stored string %j', async title => {
  expect(await readSavedListTitle(async () => list([row('chat', title)]), 'host', 'chat')).toBe(title)
})
