import { afterEach, expect, it } from 'vitest'
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
    expect(db.pragma('user_version', { simple: true })).toBe(2)
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
  h.database.transaction(db => db.pragma('user_version = 3'))
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
