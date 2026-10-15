import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { parseChatHistorySnapshot } from '../shared/chatHistory'
import { createHistoryDatabase } from './historyDatabase'
import { createChatHistoryStore } from './chatHistoryStore'
import { createSecureStore } from './secureStore'
import { fileSecretPersistence } from './fileSecretPersistence'
import { electronSecretEncryption } from './electronSecretEncryption'

// Isolated packaged entrypoint, bundled only by check:history-native, never the application build.
void app.whenReady().then(async () => {
  const evidence = { platform: process.platform, architecture: process.arch, electron: process.versions.electron,
    node: process.versions.node, adapter: '12.4.1', packaged: app.isPackaged,
    backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os-keychain',
    asar: __filename.includes('app.asar/'), unpacked: false, stage: 'runtime', executed: 1, passed: 0, failed: 0, skipped: 0,
    saturatedMemberships: 100_000, saturatedReplacementMs: 0 }
  const database = createHistoryDatabase({ userDataPath: app.getPath('userData') })
  try {
    const require = createRequire(__filename)
    const adapter = require.resolve('better-sqlite3/package.json')
    const adapterPackage: unknown = JSON.parse(readFileSync(adapter, 'utf8'))
    if (typeof adapterPackage !== 'object' || adapterPackage === null || !('version' in adapterPackage) || adapterPackage.version !== evidence.adapter) throw new Error('adapter')
    evidence.unpacked = existsSync(join(adapter.replace('app.asar/', 'app.asar.unpacked/'), '..', 'build/Release/better_sqlite3.node'))
    const encryption = electronSecretEncryption()
    if (!app.isPackaged || !evidence.asar || !evidence.unpacked || !encryption.isAvailable()) throw new Error('runtime')
    const secureStore = createSecureStore({ encryption, persistence: fileSecretPersistence(join(app.getPath('userData'), 'secrets')) })
    const fresh = () => createChatHistoryStore({ database, encryption, secureStore, log: { event: () => {} } })
    const store = fresh()
    const ids = Array.from({ length: 200 }, (_, i) => i)
    const snapshot = { version: 1, kind: 'timeline', serverId: 'smoke', conversationId: 'chat', prependedRows: 0,
      items: [{ kind: 'userText', text: 'NATIVE-CONTENT-1979', attachments: [{ attachmentId: 'a', filename: 'NATIVE-ATTACHMENT-1979' }] }],
      coverage: { status: 'received', cursor: 'NATIVE-CURSOR-1979', atStart: false },
      served: { ids, highestId: 199, receipts: Array.from({ length: 500 }, (_, i) => ({
        ids, cursor: `page-${i}`, atStart: false })) } }
    const thread = { version: 1, kind: 'daemon-items', serverId: 'smoke', conversationId: 'chat', thread: {
      hostId: 'smoke', conversationId: 'chat', epoch: 'native', version: 1, checkpoint: 1, ranges: [], repair: null,
      items: [{ id: 1, rev: 1, kind: 'future', content: { text: 'NATIVE-THREAD-1975' } }] } }
    evidence.stage = 'fixture-admission'
    parseChatHistorySnapshot(snapshot); parseChatHistorySnapshot(thread)
    await secureStore.set('chat-history', Buffer.from(JSON.stringify({ version: 1, snapshots: [snapshot, thread] })))
    evidence.stage = 'import'
    const result = await store.execute({ operation: 'readTimeline', serverId: 'smoke', conversationId: 'chat' })
    evidence.stage = result.status === 'error' ? result.code : 'compare-import'
    if (result.status !== 'stored' || !isDeepStrictEqual(result.snapshot, parseChatHistorySnapshot(snapshot))) throw new Error('import')
    database.close()
    evidence.stage = 'reopen'
    const next = fresh()
    const reopened = await next.execute({ operation: 'readTimeline', serverId: 'smoke', conversationId: 'chat' })
    if (reopened.status !== 'stored' || !isDeepStrictEqual(reopened.snapshot, parseChatHistorySnapshot(snapshot))) throw new Error('reopen')
    const reopenedThread = await next.execute({ operation: 'readThread', serverId: 'smoke', conversationId: 'chat' })
    if (reopenedThread.status !== 'stored' || !isDeepStrictEqual(reopenedThread.snapshot, parseChatHistorySnapshot(thread))) throw new Error('thread')
    // A saturated full replacement decrypts old memberships and protects every new record.
    // Report completion and duration rather than assuming a short renderer polling deadline.
    evidence.stage = 'saturated-replacement'
    const repeated = { ...snapshot, served: { ...snapshot.served, receipts: [...snapshot.served.receipts.slice(1),
      { ids, cursor: 'repeat', atStart: false }] } }
    const started = performance.now()
    const replaced = await next.execute({ operation: 'replaceTimeline', serverId: 'smoke', conversationId: 'chat', snapshot: repeated })
    if (replaced.status !== 'ok') throw new Error('replacement')
    evidence.saturatedReplacementMs = Math.round(performance.now() - started)
    database.close()
    const saved = await fresh().execute({ operation: 'readTimeline', serverId: 'smoke', conversationId: 'chat' })
    if (saved.status !== 'stored' || !isDeepStrictEqual(saved.snapshot, parseChatHistorySnapshot(repeated))) throw new Error('saturation-reopen')
    evidence.stage = 'protected-bytes'
    const directory = join(app.getPath('userData'), 'history')
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name))
      if (['NATIVE-CONTENT-1979', 'NATIVE-ATTACHMENT-1979', 'NATIVE-CURSOR-1979', 'NATIVE-THREAD-1975'].some(s => bytes.includes(Buffer.from(s)))) throw new Error('plaintext')
    }
    evidence.passed = 1; evidence.stage = 'complete'
  } catch { evidence.failed = 1 }
  finally { database.close() }
  console.log(JSON.stringify(evidence))
  app.exit(evidence.failed ? 1 : 0)
}, () => { app.exit(1) })
