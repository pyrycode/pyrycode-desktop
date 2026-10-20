import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, SEEDED_ROW, FIRST_SERVER_ID, seedConversationsFrame } from './fixtures/launchPairedApp'
import { launchIsolatedApp, appWindow, createLaunchFateLog } from './fixtures/desktopIsolation'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { watchPhaseReconnect, readPhaseReconnect } from './fixtures/phaseReconnectEvidence'
import { installHistoryQueryEvidence } from './fixtures/historyQueryEvidence'
import { readReplayMainProcess } from './fixtures/replayNativeStorage'

// Hold only React mount; main, preload and the actual native-thread protocol run normally.
for (const delayed of [false, true]) test(`saved-profile native catch-up with delayed React=${delayed}`, async ({ launchPairedApp }, info) => {
  const trace: string[] = []
  let resumed = false, handshakes = 0
  const baseline = 'controlled saved baseline', newest = 'controlled resumed publication'
  const asks: { type: string; version?: number }[] = []
  const first = await launchPairedApp({ threadMode: 'native',
    helloAck: { capabilities: ['thread', 'interactive'] },
    buildReconnectFrames: () => { handshakes++; trace.push('resumed-handshake'); return [] },
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'list_conversations') return [seedConversationsFrame()]
      if (request.type === 'request_history') throw Error('legacy request in native control')
      if (request.type !== 'thread_catch_up') return []
      const payload = request.payload as { conversation_id: string; version: number }
      expect(payload.conversation_id).toBe(SEEDED_ROW.id)
      if (resumed) { asks.push({ type: request.type, version: payload.version }); trace.push('resumed-request-dispatched') }
      const version = resumed ? 2 : 1
      const items = [{ id: version, order: version, kind: 'assistant_message', rev: 1,
        status: 'finished', active: false, shown: true, summary: '', content: { text: resumed ? newest : baseline } }]
      const envelope = (payload: object) => encodeEnvelope({ id: 90, type: 'thread_items',
        ts: '2026-07-07T12:00:00.000Z', in_reply_to: request.id,
        payload: { conversation_id: SEEDED_ROW.id, epoch: 'startup', version, ...payload } })
      return [envelope({ items, final: false }), envelope(resumed
        ? { items: [], final: true, from_version: 1 }
        : { items: [], final: true, lower_order: 1, upper_order: 2, continuation: 1, older_exists: false })]
    }
  })
  await expect(first.page.locator('.conversation__thread')).toContainText(baseline)
  await expect.poll(() => first.page.evaluate(async ({ serverId, conversationId }) => {
    const result = await window.pyry.chatHistory({ operation: 'readThread', serverId, conversationId })
    return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread.checkpoint : null
  }, { serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id })).toBe(1)
  const child = first.app.process()
  await first.app.close()
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
  trace.push('saved-profile-exited'); resumed = true
  const root = join(process.cwd(), 'out/renderer')
  const html = await readFile(join(root, 'index.html'), 'utf8')
  const entry = html.match(/src="\.\/([^\"]+\.js)"/)![1]
  const mount = 'client.createRoot(document.getElementById("root")).render('
  const server = createServer(async (request, response) => {
    const path = request.url === '/' ? 'index.html' : request.url!.slice(1)
    try {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
      const content = await readFile(join(root, path))
      if (path === entry && delayed) {
        expect(content.toString()).toContain(mount)
        response.end(content.toString().replace(mount, 'window.startControlledApp = () => ' + mount))
      } else response.end(content)
    } catch { response.statusCode = 404; response.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw Error('controlled server unavailable')
  const env = { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}/`,
    PYRY_ALLOW_LOOPBACK_RELAY: '1', PYRY_TEST_SECRET_BACKEND: '1' }
  let app: Awaited<ReturnType<typeof launchIsolatedApp>> | undefined
  try {
    const fate = createLaunchFateLog(), watch = fate.watch
    fate.watch = launched => {
      watch(launched)
      launched.process().stdout?.on('data', bytes => {
        if (String(bytes).includes('"event":"daemon-connected"')) trace.push('main-accepted-connection')
      })
    }
    app = await launchIsolatedApp({ args: ['.', `--user-data-dir=${first.userDataDir}`], env, fate })
    const page = await appWindow(app)
    await expect.poll(() => trace.includes('main-accepted-connection')).toBe(true)
    if (delayed) {
      expect(await page.locator('#root').innerHTML()).toBe('')
      expect(asks).toEqual([])
      trace.push('document-loaded-before-react')
      await installHistoryQueryEvidence(app, 'resume')
      await watchPhaseReconnect(page)
      await page.evaluate(() => (window as any).startControlledApp())
      await expect.poll(() => readPhaseReconnect(page)).toMatchObject({ connections: 1, thread: true, interactive: true })
      trace.push('renderer-received-status')
    }
    await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name! }).click()
    const thread = page.locator('.conversation__thread')
    await expect(thread).toContainText(newest, { timeout: 45_000 })
    await expect(thread).toContainText(baseline)
    trace.push('received-publication-rendered')
    expect(asks).toEqual([{ type: 'thread_catch_up', version: 1 }])
    if (delayed) expect(await readReplayMainProcess(app, () => (globalThis as any).__threadHistoryAsks)).toEqual(asks)
    expect(handshakes).toBe(1)
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    // Mounting another observer must not dispatch another opening query.
    await page.evaluate(() => { const off = window.pyry.onDaemonEvent(() => {}); off() })
    expect(asks).toHaveLength(1)
  } finally {
    await info.attach('controlled-startup', { body: Buffer.from(JSON.stringify(trace)), contentType: 'application/json' })
    await app?.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
