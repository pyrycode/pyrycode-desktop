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
    retainedItems: 1000, protectedReplacementMs: 0 }
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
    const legacy = { version: 1, kind: 'timeline', serverId: 'smoke', conversationId: 'chat',
      items: 'NATIVE-LEGACY-2026', coverage: null }
    const list = { version: 1, kind: 'list', serverId: 'smoke', conversations: [{ id: 'chat',
      name: 'NATIVE-LIST-2026', is_promoted: false, is_archived: false, cwd: '/',
      last_message_ts: '', last_used_at: '', workspace_label: null }] }
    const thread = { version: 1, kind: 'daemon-items', serverId: 'smoke', conversationId: 'chat', thread: {
      hostId: 'smoke', conversationId: 'chat', epoch: 'native', version: 2, checkpoint: 1, uncommittedVersion: 2,
      ranges: [{ start: 1, end: 1 }], repair: null,
      items: Array.from({ length: evidence.retainedItems }, (_, id) => ({ id, rev: 1, kind: 'future',
        content: { text: 'NATIVE-THREAD-1975', attachment: 'NATIVE-ATTACHMENT-2026' } })) } }
    evidence.stage = 'fixture-admission'
    parseChatHistorySnapshot(list); parseChatHistorySnapshot(thread)
    await secureStore.set('chat-history', Buffer.from(JSON.stringify({ version: 1, snapshots: [legacy, list, thread] })))
    evidence.stage = 'import'
    const result = await store.execute({ operation: 'readThread', serverId: 'smoke', conversationId: 'chat' })
    if (result.status !== 'stored' || !isDeepStrictEqual(result.snapshot, parseChatHistorySnapshot(thread))) throw new Error('import')
    if (database.transaction(db => db.prepare('SELECT 1 FROM legacy_scopes').get()) !== undefined) throw new Error('legacy-import')
    await store.close()
    evidence.stage = 'reopen'
    const next = fresh()
    const reopened = await next.execute({ operation: 'readList', serverId: 'smoke' })
    if (reopened.status !== 'stored' || !isDeepStrictEqual(reopened.snapshot, parseChatHistorySnapshot(list))) throw new Error('list')
    const reopenedThread = await next.execute({ operation: 'readThread', serverId: 'smoke', conversationId: 'chat' })
    if (reopenedThread.status !== 'stored' || !isDeepStrictEqual(reopenedThread.snapshot, parseChatHistorySnapshot(thread))) throw new Error('thread')
    evidence.stage = 'protected-replacement'
    const replacement = { ...thread, thread: { ...thread.thread, epoch: 'replacement', checkpoint: 2, uncommittedVersion: 0 } }
    const started = performance.now()
    const replaced = await next.execute({ operation: 'replaceThread', serverId: 'smoke', conversationId: 'chat', snapshot: replacement })
    if (replaced.status !== 'ok') throw new Error('replacement')
    evidence.protectedReplacementMs = Math.round(performance.now() - started)
    await next.close()
    const final = fresh()
    const saved = await final.execute({ operation: 'readThread', serverId: 'smoke', conversationId: 'chat' })
    if (saved.status !== 'stored' || !isDeepStrictEqual(saved.snapshot, parseChatHistorySnapshot(replacement))) throw new Error('replacement-reopen')
    await final.close()
    evidence.stage = 'protected-bytes'
    const directory = join(app.getPath('userData'), 'history')
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name))
      if (['NATIVE-LEGACY-2026', 'NATIVE-LIST-2026', 'NATIVE-ATTACHMENT-2026', 'NATIVE-THREAD-1975'].some(s => bytes.includes(Buffer.from(s)))) throw new Error('plaintext')
    }
    evidence.passed = 1; evidence.stage = 'complete'
  } catch { evidence.failed = 1 }
  finally { database.close() }
  console.log(JSON.stringify(evidence))
  app.exit(evidence.failed ? 1 : 0)
}, () => { app.exit(1) })
