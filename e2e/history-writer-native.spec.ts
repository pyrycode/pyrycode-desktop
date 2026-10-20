import { mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build, loadConfigFromFile, preview } from 'vite'
import { test, expect, FIRST_SERVER_ID, SEEDED_ROW, seedConversationsFrame, emptyThreadWindow } from './fixtures/launchPairedApp'
import { decodeEnvelope } from '../src/main/transport/codec'
import { writerWorkloadDuration } from './historyWriterTiming'
import { startWriterDiagnostics } from './historyWriterDiagnostics'

// Isolate storage from renderer admission and whole-conversation presentation. No product UI changes.
const source = `
import { useState, useLayoutEffect } from 'react';
import { createStore } from 'zustand/vanilla';
import { createChatHistoryWriter } from './store/chatHistoryWriter';
import { createConversationListStore } from './store/conversationListStore';
const evidence = { persisted: 0, submitted: 0, admitted: 0, admittedAt: null, completedAt: null,
  ipcMs: 0, ipcMax: 0, ipcSamples: [],
  maxGap: 0, beats: 0, done: false, commit: 0, committed: '', errors: [] };
let observing = false, last = performance.now(), expected, writer;
setInterval(() => { const now = performance.now();
  if (observing) { evidence.maxGap = Math.max(evidence.maxGap, now - last); evidence.beats++; }
  last = now;
}, 20);
function StorageProbe() {
  const [mounted, mount] = useState(false), [text, setText] = useState('');
  useLayoutEffect(() => { if (text) { evidence.commit = performance.now(); evidence.committed = text; } }, [text]);
  window.storageProbe = { evidence, async start(host, chat) {
    mount(true);
    const items = [];
    for (const [kind, count] of [['tool_call',6396],['assistant_message',889],['turn_end',556],
      ['user_message',345],['agent',135],['session_divider',12]]) for (let n=0; n<count; n++) {
      const id = items.length + 1;
      const content = kind === 'tool_call' || kind === 'agent' ? { name: kind === 'agent' ? 'Agent' : 'Read', tool_use_id: 'tool-' + id }
        : kind === 'turn_end' ? { outcome: 'completed', stop_reason: 'end_turn' }
        : kind === 'session_divider' ? { reason: 'clear', occurred_at: '2026-10-19T00:00:00Z' }
        : { text: 'Synthetic ' + id };
      if (kind === 'agent') Object.assign(content, { task_id: 'task-' + id,
        task_link: { task_id: 'task-' + id, tool_call_id: 'tool-' + id } });
      items.push({ id, rev: 1, ...(kind === 'tool_call' ? { parent: 8187 + n % 135 } : { order: id }),
        kind, status: kind === 'user_message' ? 'delivered' : 'finished',
        shown: kind !== 'turn_end', active: false, summary: '', content });
    }
    const metadata = { hostId: host, conversationId: chat, epoch: 'storage-probe', version: 1,
      checkpoint: 1, uncommittedVersion: 0, repair: null, olderAvailable: false };
    expected = { ...metadata, items: [...items].sort((a,b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
      arrivalOrder: items.map(i => i.id), ranges: [{start: 0, end: 8334}] };
    const threads = createStore(() => ({ hosts: new Map() }));
    writer = createChatHistoryWriter({ threads, lists: createConversationListStore(), receipt: () => null,
      schedule: () => () => {}, log: event => { if (event.code && event.code !== 'ok') evidence.errors.push(event.code); },
      write: async request => { evidence.submitted++; const start = performance.now();
        const result = await window.pyry.chatHistory(request); const ms = performance.now() - start;
        evidence.ipcMs += ms; evidence.ipcMax = Math.max(evidence.ipcMax, ms);
        if (evidence.ipcSamples.length < 300) evidence.ipcSamples.push(ms);
        if (result.status === 'ok' && request.operation === 'mutateThread') evidence.persisted += request.change.items.length;
        return result; } });
    window.pyry.onChatHistoryFlush(() => writer.stop());
    evidence.admitted = items.length; observing = true; last = performance.now();
    evidence.admittedAt = performance.now();
    threads.setState({ hosts: new Map([[host, new Map([[chat, { snapshot: {}, owned: { metadata, items,
      removeIds: [], ranges: expected.ranges, acceptEpoch: true, completion: { fromVersion: 0, version: 1 },
      availability: { start: 0, available: false } } }]])]]) });
    await writer.flush(); evidence.completedAt = performance.now();
    evidence.maxGap = Math.max(evidence.maxGap, evidence.completedAt - last);
    evidence.done = true; observing = false;
  }, expected: () => expected, flush: () => writer.flush() };
  return mounted ? <input aria-label="Storage input" value={text} onChange={e => setText(e.target.value)} /> : <App />;
}
`

test('finite protected writer backlog preserves native keyboard and both event loops', async ({ launchPairedApp }, info) => {
  info.setTimeout(180000)
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve('electron.vite.config.ts'))
  const renderer = loaded!.config.renderer
  const outDir = await mkdtemp(join(tmpdir(), 'builder-2088-renderer-'))
  await build({ ...renderer, configFile: false, root: resolve('src/renderer'), base: './',
    plugins: [...renderer.plugins, { name: 'storage-probe', enforce: 'pre', transform(code: string, id: string) {
      if (id.endsWith('/src/renderer/src/main.tsx')) return code.replace('<App />', '<StorageProbe />') + source
    } }], build: { ...renderer.build, outDir }, logLevel: 'silent' })
  const server = await preview({ configFile: false, root: resolve('src/renderer'), build: { outDir },
    preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  try {
    const { page, app, userDataDir } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      return request.type === 'list_conversations' ? [seedConversationsFrame()]
        : request.type === 'thread_catch_up' ? [emptyThreadWindow(request)] : []
    } }, { productionSecrets: true, rendererUrl: server.resolvedUrls!.local[0] })
    // Positively settle the pairing drive's tiny initial thread before isolating its presentation.
    await expect.poll(() => page.evaluate(async ([host, chat]) => {
      const saved = await window.pyry.chatHistory({ operation: 'readThread', serverId: host, conversationId: chat })
      return saved.status === 'stored' && saved.snapshot.kind === 'daemon-items' ? saved.snapshot.thread.checkpoint : 0
    }, [FIRST_SERVER_ID, SEEDED_ROW.id])).toBeGreaterThan(0)
    const runtime = await app.evaluate(({ safeStorage, app }) => {
      if (!safeStorage.isEncryptionAvailable()) throw Error('OS protection unavailable')
      if (app.commandLine.hasSwitch('password-store') || app.commandLine.hasSwitch('use-mock-keychain'))
        throw Error('mock protection switches remain enabled')
      const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os-keychain'
      if (backend === 'basic_text' || process.env.PYRY_TEST_SECRET_BACKEND === '1') throw Error('production protection required')
      const beats = { maxGap: 0, count: 0, last: performance.now(), observing: true }
      ;(globalThis as any).storageBeats = beats
      ;(globalThis as any).storageTimer = setInterval(() => { const now = performance.now()
        if (beats.observing) { beats.maxGap = Math.max(beats.maxGap, now - beats.last); beats.count++ }
        beats.last = now
      }, 20)
      return { backend, versions: process.versions, platform: process.platform, arch: process.arch }
    })
    const started = performance.now()
    await app.evaluate(startWriterDiagnostics)
    const evidence = () => page.evaluate(() => ({ ...(window as any).storageProbe.evidence,
      observedAt: performance.now() }))
    const mainEvidence = () => app.evaluate(() => {
      const beats = (globalThis as any).storageBeats
      if (beats.observing) beats.maxGap = Math.max(beats.maxGap, performance.now() - beats.last)
      beats.observing = false; clearInterval((globalThis as any).storageTimer)
      return beats
    })
    const inputs: { text: string; latency: number | null; before: number; after: number | null }[] = []
    try {
      await page.evaluate(([host, chat]) => {
        // A rejected start is recorded, not left as an unhandled renderer promise.
        void (window as any).storageProbe.start(host, chat).catch(() => {
          (window as any).storageProbe.evidence.errors.push('probe-start-failed')
        })
      }, [FIRST_SERVER_ID, SEEDED_ROW.id])
      await expect.poll(async () => (await evidence()).persisted).toBeGreaterThan(31)
      for (const text of ['x', 'y', 'z']) {
        const before = await evidence()
        expect(before.done).toBe(false)
        expect(before.persisted).toBeLessThan(8333)
        await page.getByRole('textbox', { name: 'Storage input' }).focus()
        const expectedText = inputs.map(i => i.text).join('') + text
        const input: typeof inputs[number] = { text, latency: null, before: before.persisted, after: null }
        inputs.push(input)
        const dispatch = performance.now()
        await page.keyboard.type(text)
        await expect(page.getByRole('textbox', { name: 'Storage input' })).toHaveValue(expectedText)
        await expect.poll(async () => (await evidence()).committed).toBe(expectedText)
        input.latency = performance.now() - dispatch
        expect(input.latency).toBeLessThanOrEqual(1000)
        await expect.poll(async () => (await evidence()).persisted).toBeGreaterThan(before.persisted)
        const after = await evidence()
        input.after = after.persisted
        expect(after.done).toBe(false)
        expect(after.persisted).toBeLessThan(8333)
        expect(after.commit).toBeGreaterThan(0)
        await info.attach('input-' + text, { body: JSON.stringify(input), contentType: 'application/json' })
      }
      await expect.poll(async () => (await evidence()).done, { timeout: 65000, intervals: [100] }).toBe(true)
      const final = await evidence(), main = await mainEvidence()
      expect(writerWorkloadDuration(final)).toBeLessThanOrEqual(60000)
      expect(final).toMatchObject({ admitted: 8333, persisted: 8333, errors: [] })
      expect(final.maxGap).toBeLessThanOrEqual(1000)
      expect(main.count).toBeGreaterThan(0)
      expect(main.maxGap).toBeLessThanOrEqual(1000)
      await page.evaluate(() => (window as any).storageProbe.flush())
    } finally {
      const [renderer, main, storage] = await Promise.allSettled([evidence(), mainEvidence(),
        app.evaluate(() => (globalThis as any).finishWriterDiagnostics())])
      const final = renderer.status === 'fulfilled' ? renderer.value : null
      await info.attach('native-storage-input', { body: JSON.stringify({ runtime,
        configuredWorkers: info.config.workers, actualWorkers: info.config.metadata.actualWorkers,
        parallelIndex: info.parallelIndex, retry: info.retry,
        runnerElapsed: performance.now() - started,
        workloadDuration: final?.completedAt === null || final?.admittedAt == null ? null
          : final.completedAt - final.admittedAt,
        final, main: main.status === 'fulfilled' ? main.value : null, inputs,
        storage: storage.status === 'fulfilled' ? storage.value : null,
        diagnosticErrors: [renderer.status === 'rejected' ? 'renderer-read-failed' : null,
          main.status === 'rejected' ? 'main-read-failed' : null,
          storage.status === 'rejected' ? 'storage-read-failed' : null].filter(Boolean)
      }), contentType: 'application/json' })
    }
    const expected = await page.evaluate(() => (window as any).storageProbe.expected())
    // Close the actual owner normally, then launch a fresh protected owner against the same profile.
    await app.close()
    const reopened = await launchPairedApp({}, { productionSecrets: true, reuseUserDataDir: userDataDir })
    const saved = await reopened.page.evaluate(([host, chat]) => window.pyry.chatHistory({ operation: 'readThread',
      serverId: host, conversationId: chat }), [FIRST_SERVER_ID, SEEDED_ROW.id])
    expect(saved).toEqual({ status: 'stored', snapshot: { version: 1, kind: 'daemon-items', serverId: FIRST_SERVER_ID,
      conversationId: SEEDED_ROW.id, thread: expected } })
  } finally { await server.close() }
})
