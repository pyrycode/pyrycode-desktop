import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { parseChatHistorySnapshot } from '../shared/chatHistory'
import { createHistoryDatabase } from './historyDatabase'
import { createIndexedLegacyHistory } from './indexedLegacyHistory'
import { electronSecretEncryption } from './electronSecretEncryption'

// Isolated packaged entrypoint, bundled only by check:history-native, never the application build.
void app.whenReady().then(async () => {
  const evidence = { platform: process.platform, architecture: process.arch, electron: process.versions.electron,
    node: process.versions.node, adapter: '12.4.1', packaged: app.isPackaged,
    backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os-keychain',
    asar: __filename.includes('app.asar/'), unpacked: false, stage: 'runtime', executed: 1, passed: 0, failed: 0, skipped: 0 }
  const database = createHistoryDatabase({ userDataPath: app.getPath('userData') })
  try {
    const require = createRequire(__filename)
    const adapter = require.resolve('better-sqlite3/package.json')
    const adapterPackage: unknown = JSON.parse(readFileSync(adapter, 'utf8'))
    if (typeof adapterPackage !== 'object' || adapterPackage === null || !('version' in adapterPackage) || adapterPackage.version !== evidence.adapter) throw new Error('adapter')
    evidence.unpacked = existsSync(join(adapter.replace('app.asar/', 'app.asar.unpacked/'), '..', 'build/Release/better_sqlite3.node'))
    const encryption = electronSecretEncryption()
    if (!app.isPackaged || !evidence.asar || !evidence.unpacked || !encryption.isAvailable()) throw new Error('runtime')
    const store = createIndexedLegacyHistory({ database, encryption, log: { event: () => {} } })
    const snapshot = { version: 1, kind: 'timeline', serverId: 'smoke', conversationId: 'chat', prependedRows: 0,
      items: [{ kind: 'userText', text: 'NATIVE-CONTENT-1979', attachments: [{ attachmentId: 'a', filename: 'NATIVE-ATTACHMENT-1979' }] }],
      coverage: { status: 'received', cursor: 'NATIVE-CURSOR-1979', atStart: false } }
    evidence.stage = 'replace'
    const result = await store.execute({ operation: 'replaceTimeline', serverId: 'smoke', conversationId: 'chat', snapshot })
    if (result.status !== 'ok') throw new Error('write')
    database.close()
    evidence.stage = 'reopen'
    const reopened = await store.execute({ operation: 'readTimeline', serverId: 'smoke', conversationId: 'chat' })
    if (reopened.status !== 'stored' || !isDeepStrictEqual(reopened.snapshot, parseChatHistorySnapshot(snapshot))) throw new Error('reopen')
    evidence.stage = 'protected-bytes'
    const directory = join(app.getPath('userData'), 'history')
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name))
      if (['NATIVE-CONTENT-1979', 'NATIVE-ATTACHMENT-1979', 'NATIVE-CURSOR-1979'].some(s => bytes.includes(Buffer.from(s)))) throw new Error('plaintext')
    }
    evidence.passed = 1; evidence.stage = 'complete'
  } catch { evidence.failed = 1 }
  finally { database.close() }
  console.log(JSON.stringify(evidence))
  app.exit(evidence.failed ? 1 : 0)
}, () => { app.exit(1) })
