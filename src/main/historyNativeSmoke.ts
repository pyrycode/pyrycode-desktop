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
    saturatedMemberships: 100_000, saturatedReplacementMs: 0,
    openingFixtureItems: 801, openingSelected: 200, openingActive: 1, openingDependencies: 0, openingEvidence: 2,
    openingConversionMs: 0, coldOpeningMs: 0, recoveryMs: 0, recoveredIdentities: 0 }
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
    evidence.stage = 'owned-update'
    const { items: ignoredItems, ranges: ignoredRanges, ...metadata } = thread.thread
    void ignoredItems; void ignoredRanges
    const updatedItem = { ...thread.thread.items[0], rev: 2, content: { text: 'NATIVE-OWNED-2044' } }
    const updated = await next.execute({ operation: 'mutateThread', serverId: 'smoke', conversationId: 'chat', change: {
      metadata, acceptEpoch: false, items: [updatedItem], removeIds: [], ranges: []
    } })
    if (updated.status !== 'ok') throw new Error('owned-update')
    database.close()
    const owned = await fresh().execute({ operation: 'readThread', serverId: 'smoke', conversationId: 'chat' })
    if (owned.status !== 'stored' || !isDeepStrictEqual(owned.snapshot,
      parseChatHistorySnapshot({ ...thread, thread: { ...thread.thread, items: [updatedItem], arrivalOrder: [1] } }))) throw new Error('owned-reopen')
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
    evidence.stage = 'bounded-opening'
    const openingItems = [
      ...Array.from({ length: 300 }, (_, id) => ({ id, rev: 1, kind: 'future', shown: true, order: id })),
      ...Array.from({ length: 500 }, (_, n) => ({ id: n + 1000, rev: 1, kind: 'future', shown: false })),
      { id: 2000, rev: 1, kind: 'future', shown: false, active: true }]
    const opening = { ...thread, conversationId: 'opening', thread: { ...thread.thread, conversationId: 'opening',
      items: openingItems, arrivalOrder: openingItems.map(i => i.id), ranges: [{ start: 0, end: 300 }, { start: 900, end: 901 }] } }
    const openingStore = fresh()
    if ((await openingStore.execute({ operation: 'replaceThread', serverId: 'smoke', conversationId: 'opening', snapshot: opening })).status !== 'ok') throw Error('opening-write')
    const request = { operation: 'openThreadPage', serverId: 'smoke', conversationId: 'opening', limit: 200 }
    const conversion = performance.now(), converted = await openingStore.execute(request)
    evidence.openingConversionMs = Math.round(performance.now() - conversion)
    if (converted.status !== 'page') throw Error('opening-conversion')
    database.close()
    const cold = performance.now(), opened = await fresh().execute(request)
    evidence.coldOpeningMs = Math.round(performance.now() - cold)
    if (opened.status !== 'page' || !isDeepStrictEqual({ ...opened.page, continuation: null }, { ...converted.page, continuation: null }) ||
      typeof opened.page.continuation !== 'string' ||
      !isDeepStrictEqual(opened.page.items.map(i => i.id), [...Array.from({ length: 200 }, (_, n) => n + 100), 2000]) ||
      opened.page.ranges.length !== 2 || opened.page.metadata.checkpoint !== 1) throw Error('opening-reopen')
    evidence.stage = 'saved-traversal'
    const traversalStore = fresh(), all = []
    let traversed = await traversalStore.execute({ ...request, operation: 'newestThreadPage' })
    for (let n = 0; n < 5; n++) {
      if (traversed.status !== 'page') throw Error('traversal-page')
      all.unshift(...traversed.page.items)
      if (traversed.page.continuation === null) break
      traversed = await traversalStore.execute({ ...request, operation: 'beforeThreadPage', continuation: traversed.page.continuation })
    }
    if (!isDeepStrictEqual(all, openingItems) || new Set(all.map(i => i.id)).size !== 801) throw Error('traversal-content')
    evidence.stage = 'saved-recovery'
    let recovering = await traversalStore.execute({ ...request, operation: 'newestThreadPage' })
    if (recovering.status !== 'page' || recovering.page.continuation === null) throw Error('recovery-start')
    recovering = await traversalStore.execute({ ...request, operation: 'beforeThreadPage', continuation: recovering.page.continuation })
    if (recovering.status !== 'page') throw Error('recovery-depth')
    const { items: omittedItems, ranges: omittedRanges, arrivalOrder: omittedArrival, ...openingMetadata } = opening.thread
    void omittedItems; void omittedRanges; void omittedArrival
    if ((await traversalStore.execute({ operation: 'mutateThread', serverId: 'smoke', conversationId: 'opening', change: {
      metadata: openingMetadata, acceptEpoch: false, items: [], removeIds: [], ranges: [] } })).status !== 'ok') throw Error('recovery-invalidation')
    database.close()
    const recoveryStore = fresh(), recovered = new Map<number, unknown>(), recoveryStarted = performance.now()
    for (let n = 0; n < 10 && recovering.status === 'page' && recovering.page.continuation !== null; n++) {
      recovering = await recoveryStore.execute({ ...request, operation: 'beforeThreadPage',
        continuation: recovering.page.continuation, recovery: recovering.page.recovery })
      if (recovering.status !== 'page') throw Error('recovery-page')
      for (const value of recovering.page.items) recovered.set(value.id, value)
    }
    if (recovering.status !== 'page' || recovering.page.continuation !== null ||
      openingItems.some(value => !isDeepStrictEqual(recovered.get(value.id), value))) throw Error('recovery-content')
    evidence.recoveryMs = Math.round(performance.now() - recoveryStarted)
    evidence.recoveredIdentities = recovered.size
    evidence.stage = 'protected-bytes'
    const directory = join(app.getPath('userData'), 'history')
    for (const name of readdirSync(directory)) {
      const bytes = readFileSync(join(directory, name))
      if (['NATIVE-CONTENT-1979', 'NATIVE-ATTACHMENT-1979', 'NATIVE-CURSOR-1979', 'NATIVE-THREAD-1975', 'NATIVE-OWNED-2044'].some(s => bytes.includes(Buffer.from(s)))) throw new Error('plaintext')
    }
    evidence.passed = 1; evidence.stage = 'complete'
  } catch { evidence.failed = 1 }
  finally { database.close() }
  console.log(JSON.stringify(evidence))
  app.exit(evidence.failed ? 1 : 0)
}, () => { app.exit(1) })
