import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, seedConversationsFrame, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import type { ElectronApplication, Page } from '@playwright/test'
const appId = '22222222-2222-4222-8222-222222222222'
function scenario(second = false) {
  let id = 1000, revision = 1, release = '1.0.0', state = 'running', held = false, holdPage = false, title = '<App & trusted>'
  const replies: Uint8Array[] = [], seen: any[] = []
  const pages: Uint8Array[] = []
  const record = () => ({ app_id: appId, title, state, desired: 'available',
    active_release: release, pending_release: null, last_error: null, revision })
  const frame = (type: string, payload: unknown, reply?: number) => Buffer.from(JSON.stringify({ id: id++, type,
    ts: '2026-10-15T10:00:00Z', ...(reply === undefined ? {} : { in_reply_to: reply }), payload }))
  return { seen, replies, pages, frame, hold() { held = true }, holdPage(value: boolean) { holdPage = value },
    update(next = release, nextState = 'running') { release = next; state = nextState; revision++;
      title = `<App & trusted> ${revision}`; return frame('app_updated', record()) },
    options: { helloAck: { server_id: second ? SECOND_SERVER_ID : FIRST_SERVER_ID, capabilities: ['hosted_apps_v1'] },
      buildReplyFrames(bytes: Uint8Array) {
        const r = JSON.parse(Buffer.from(bytes).toString()); seen.push(r)
        if (r.type === 'list_conversations') return [seedConversationsFrame(second ? SECOND_SEEDED_ROW : undefined)]
        if (r.type === 'list_apps') {
          const reply = frame('apps', { revision, items: [record()], next_cursor: null }, r.id)
          if (held) { replies.push(reply); return [] }
          return [reply]
        }
        if (r.type === 'app_cancel') return [frame('app_cancelled', r.payload, r.id)]
        if (r.type !== 'app_asset_request' && r.type !== 'app_api_request') return []
        const body = Buffer.from(`<!doctype html><html><body><h1>Hosted ${second ? 'second' : 'first'} ${r.payload.release_version}</h1></body></html>`)
        const frames = [frame('app_response', { app_id: appId, release_version: r.payload.release_version, status: 200,
          headers: { 'content-type': 'text/html' }, size_bytes: body.length, total_chunks: 1,
          sha256: createHash('sha256').update(body).digest('hex') }, r.id),
        frame('app_response_chunk', { app_id: appId, index: 0, data: body.toString('base64') }, r.id)]
        if (holdPage) { pages.push(...frames); return [] }
        return frames
      } }
  }
}
async function snapshot(page: Page) {
  const result = await page.evaluate(() => window.pyry.hostedPane({ type: 'snapshot' }))
  if (!result.ok) throw new Error('snapshot refused')
  return result.state
}
async function select(page: Page, serverId = FIRST_SERVER_ID) {
  expect((await page.evaluate(({ serverId, appId }) => window.pyry.hostedPane({ type: 'select', serverId, appId }), { serverId, appId })).ok).toBe(true)
}
async function native(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const parent = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html'))!
    return parent.contentView.children.flatMap(child => {
      const wc = (child as Electron.WebContentsView).webContents
      const observed = child as any
      if (wc && !observed.observeVisibility) {
        const setVisible = child.setVisible.bind(child)
        observed.observeVisibility = true; observed.visible = true
        child.setVisible = value => { observed.visible = value; setVisible(value) }
      }
      return wc && wc.getURL().startsWith('https://app-') ? [{ id: wc.id, url: wc.getURL(),
        bounds: child.getBounds(), visible: observed.visible }] : []
    })
  })
}
async function ready(page: Page, app: ElectronApplication) {
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Connected')
  await expect.poll(async () => (await native(app)).length).toBe(1)
  return (await native(app))[0]
}
async function discoveryDelivered(app: ElectronApplication, deliver: () => void) {
  let completed = false, output = ''
  const stream = app.process().stdout!
  const observe = (chunk: Buffer) => { output += chunk.toString(); completed = output.includes('"event":"hosted-discovery","code":"ready"') }
  stream.on('data', observe)
  try { deliver(); await expect.poll(() => completed).toBe(true) }
  finally { stream.removeListener('data', observe) }
}

test('geometry, dialogs and selection', async ({ launchPairedApp }) => {
  const s = scenario(), { page, app } = await launchPairedApp(s.options, { hostLabel: '<Host & trusted>' })
  await select(page); const first = await ready(page, app)
  await expect(page.locator('.hosted-pane__identity')).toHaveText('<Host & trusted><App & trusted>')
  expect(await page.locator('.hosted-pane__identity img').count()).toBe(0)
  for (const width of [1280, 800, 1100]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    await expect.poll(async () => {
      const r = await page.locator('.hosted-pane__surface').boundingBox(), v = (await native(app))[0]
      return r && v && Math.abs(v.bounds.x - r.x) <= 1 && Math.abs(v.bounds.width - r.width) <= 1 &&
        Math.abs(v.bounds.y - r.y) <= 1 && Math.abs(v.bounds.height - r.height) <= 1
    }).toBe(true)
    const chrome = await page.locator('.hosted-pane__chrome').boundingBox()
    expect((await native(app))[0].bounds.x).toBeGreaterThanOrEqual(440)
    expect((await native(app))[0].bounds.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height - 1)
  }
  await page.getByRole('button', { name: 'Pair new host' }).click()
  await expect(page.locator('dialog[open]')).toBeVisible()
  await expect.poll(async () => (await native(app))[0]?.visible).toBe(false)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect.poll(async () => (await native(app))[0]?.visible).toBe(true)
  expect((await native(app))[0].id).toBe(first.id)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  mkdirSync('/tmp/builder-1992', { recursive: true })
  const capture = await app.evaluate(async ({ BrowserWindow, nativeImage }) => {
    const parent = BrowserWindow.getAllWindows()[0]
    const child = parent.contentView.children.find(child => (child as any).webContents?.getURL().startsWith('https://app-')) as Electron.WebContentsView
    // BrowserWindow.capturePage excludes native child views. Compose the two actual captures at measured bounds.
    const chrome = await parent.capturePage(), content = await child.webContents.capturePage()
    const size = chrome.getSize(), childSize = content.getSize(), bounds = child.getBounds()
    const bitmap = chrome.toBitmap(), pixels = content.toBitmap()
    if (childSize.width !== bounds.width || childSize.height !== bounds.height) throw new Error('native capture size mismatch')
    for (let y = 0; y < childSize.height; y++) pixels.copy(bitmap,
      ((bounds.y + y) * size.width + bounds.x) * 4, y * childSize.width * 4, (y + 1) * childSize.width * 4)
    return nativeImage.createFromBitmap(bitmap, size).toPNG().toString('base64')
  })
  writeFileSync('/tmp/builder-1992/composed-1100.png', Buffer.from(capture, 'base64'))
  await page.getByRole('button', { name: 'Close app', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).type).toBe('closed')
  expect(await native(app)).toEqual([])
  await select(page); await ready(page, app)
  await page.getByRole('button', { name: 'Seeded discussion', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).type).toBe('closed')
  expect(await native(app)).toEqual([])
  await expect(page.getByPlaceholder('Message…')).toBeVisible()
  await select(page); await ready(page, app)
  const contentId = (await native(app))[0].id
  await app.evaluate(({ BrowserWindow }) => {
    const parent = BrowserWindow.getAllWindows()[0]
    new BrowserWindow({ show: false }) // Keep the process alive to observe parent-owned content teardown.
    parent.destroy()
  })
  await expect.poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id) === undefined, contentId)).toBe(true)
})

test('loading discovery and recovery', async ({ launchPairedApp }) => {
  const s = scenario(); s.hold()
  const { page, app, daemon } = await launchPairedApp(s.options)
  await expect.poll(() => s.replies.length).toBe(1)
  await select(page)
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Loading app…')
  expect(await native(app)).toEqual([])
  for (const frame of s.replies.splice(0)) daemon.pushFrame(frame)
  const original = await ready(page, app)
  await page.evaluate(server => window.pyry.reconnectServer(server), FIRST_SERVER_ID)
  await expect.poll(() => s.replies.length).toBe(1)
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Disconnected')
  expect(await native(app)).toEqual([])
  await expect(page.locator('.hosted-pane__identity')).toContainText('<App & trusted>')
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Loading app…')
  expect(await native(app)).toEqual([])
  expect(s.replies).toHaveLength(1) // Reopen waits for the already pending discovery walk.
  for (const frame of s.replies.splice(0)) daemon.pushFrame(frame)
  const reopened = await ready(page, app)
  expect(reopened.id).not.toBe(original.id); expect(reopened.url).not.toBe(original.url)
})

test('release replacement and unavailable states', async ({ launchPairedApp }) => {
  const s = scenario(), { page, app, daemon } = await launchPairedApp(s.options)
  await select(page); let prior = await ready(page, app)
  for (const release of ['2.0.0', '3.0.0']) {
    const old = await snapshot(page)
    daemon.pushFrame(s.update(release))
    await expect.poll(async () => (await native(app))[0]?.id !== prior.id && (await snapshot(page)).type).toBe('ready')
    const current = await ready(page, app)
    expect(current.url).not.toBe(prior.url)
    expect(await page.evaluate(generation => window.pyry.hostedPane({ type: 'close', generation }), old.generation)).toEqual({ ok: false, error: 'refused' })
    expect(await page.evaluate(generation => window.pyry.hostedPane({ type: 'layout', generation, visible: false,
      bounds: { x: 0, y: 0, width: 10, height: 10 } }), old.generation)).toEqual({ ok: false, error: 'refused' })
    prior = current
  }
  for (const state of ['stopped', 'failed']) {
    daemon.pushFrame(s.update('3.0.0', state))
    await expect(page.locator('.hosted-pane__identity')).toContainText(state === 'stopped' ? '4' : '5')
    await expect(page.locator('.hosted-pane [role=status]')).toHaveText('App unavailable')
    expect(await native(app)).toEqual([])
    await expect(page.locator('.hosted-pane__identity')).toContainText('<App & trusted>')
  }
  daemon.pushFrame(s.update('3.0.0'))
  await expect(page.locator('.hosted-pane__identity')).toContainText('6')
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  await ready(page, app)
  daemon.pushFrame(s.frame('app_removed', { app_id: appId, revision: 7 }))
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('App unavailable')
  expect(await native(app)).toEqual([])
})

test('two hosts and stale controls', async ({ launchPairedApp }) => {
  const a = scenario(), b = scenario(true), { page, app } = await launchPairedApp(a.options, { secondServer: b.options })
  await page.getByRole('button', { name: 'Server two chat', exact: true }).click()
  await select(page); const first = await ready(page, app), old = await snapshot(page)
  // The active chat and most recently paired connection are on host two; the app is explicitly on host one.
  const text = await app.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("fetch('/api/read').then(r=>r.text())"), first.id)
  expect(text).toContain('Hosted first')
  expect(a.seen.some(r => r.type === 'app_api_request')).toBe(true)
  expect(b.seen.some(r => r.type === 'app_api_request')).toBe(false)
  await select(page, SECOND_SERVER_ID); const second = await ready(page, app)
  expect(second.id).not.toBe(first.id)
  expect((await snapshot(page)).type).toBe('ready')
  expect(await page.evaluate(generation => window.pyry.hostedPane({ type: 'reopen', generation }), old.generation)).toEqual({ ok: false, error: 'refused' })
  const generation = (await snapshot(page)).generation
  for (const command of [{ type: 'select', serverId: '', appId }, { type: 'select', serverId: SECOND_SERVER_ID, appId: 'bad' },
    { type: 'select', serverId: 'unknown', appId },
    { type: 'layout', generation, visible: true, bounds: { x: 0, y: 0, width: 99999, height: 100 } },
    { type: 'layout', generation, visible: true, bounds: { x: NaN, y: 0, width: 100, height: 100 } }]) {
    expect(await page.evaluate(command => window.pyry.hostedPane(command as any), command)).toEqual({ ok: false, error: 'refused' })
  }
  const refused = await app.evaluate(async ({ BrowserWindow, ipcMain }, generation) => {
    const parent = BrowserWindow.getAllWindows()[0]
    const hosted = (parent.contentView.children.find(child => (child as any).webContents?.getURL().startsWith('https://app-')) as Electron.WebContentsView).webContents
    const handler = (ipcMain as any)._invokeHandlers.get('pyry:hosted-pane')
    return Promise.all([{ sender: hosted, senderFrame: hosted.mainFrame }, { sender: parent.webContents, senderFrame: null }]
      .map(event => handler(event, { type: 'close', generation })))
  }, generation)
  expect(refused).toEqual([{ ok: false, error: 'refused' }, { ok: false, error: 'refused' }])
  expect((await native(app))[0].id).toBe(second.id)
  await page.getByRole('button', { name: 'Server two chat', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).type).toBe('closed')
  expect(await native(app)).toEqual([])
})

test('unsupported and lost discovery retain identity without reviving pages', async ({ launchPairedApp }) => {
  const unsupported = await launchPairedApp()
  await select(unsupported.page)
  await expect(unsupported.page.locator('.hosted-pane [role=status]')).toHaveText('Hosted apps are unsupported')
  expect(await native(unsupported.app)).toEqual([])
  const s = scenario(), { page, app, daemon } = await launchPairedApp(s.options)
  await select(page); const initial = await ready(page, app)
  s.hold()
  daemon.pushFrame(s.frame('app_removed', { app_id: appId, revision: 999 }))
  await expect.poll(() => s.replies.length).toBe(1)
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('App unavailable')
  expect(await native(app)).toEqual([])
  await expect(page.locator('.hosted-pane__identity')).toContainText('<App & trusted>')
  await discoveryDelivered(app, () => { for (const frame of s.replies.splice(0)) daemon.pushFrame(frame) })
  expect(await native(app)).toEqual([])
  const companionId = await app.evaluate(({ app, BrowserWindow }, { serverId, appId }) => {
    const parent = new BrowserWindow({ show: false })
    const result = app.hostedAppViews!.open(parent, serverId, appId, { x: 0, y: 0, width: 300, height: 200 })
    if (!result.ok) throw new Error('authoritative companion open refused')
    ;(globalThis as any).companion = result.view
    return result.view.content.webContents.id
  }, { serverId: FIRST_SERVER_ID, appId })
  await expect.poll(() => app.evaluate(() => (globalThis as any).companion.read().type)).toBe('ready')
  const walks = s.seen.filter(r => r.type === 'list_apps').length
  const generation = (await snapshot(page)).generation
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(generation)
  // Command completion is the barrier: refresh would synchronously retire this other parent's binding.
  expect(await app.evaluate(() => (globalThis as any).companion.read().type)).toBe('ready')
  expect((await ready(page, app)).id).not.toBe(initial.id)
  const result = await app.evaluate(async () => (globalThis as any).companion.request({ type: 'app_api_request',
    payload: { path: '/api/read', method: 'GET', headers: {}, body: '' } }))
  expect(result.ok).toBe(true) // A completed read proves the retained binding is usable after reopen.
  expect(await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.isDestroyed(), companionId)).toBe(false)
  expect(s.seen.filter(r => r.type === 'list_apps')).toHaveLength(walks)
  expect(s.replies).toHaveLength(0)
})

test('pending native load cannot complete into a successor selection', async ({ launchPairedApp }) => {
  const s = scenario(); s.holdPage(true)
  const { page, app, daemon } = await launchPairedApp(s.options)
  await select(page)
  await expect.poll(() => s.pages.length).toBe(2)
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Loading app…')
  const old = await snapshot(page)
  s.holdPage(false)
  await select(page); const current = await ready(page, app)
  for (const frame of s.pages.splice(0)) daemon.pushFrame(frame)
  daemon.pushFrame(s.update()) // Same-socket authoritative update is the positive late-delivery barrier.
  await expect(page.locator('.hosted-pane__identity')).toContainText('<App & trusted> 2')
  expect((await native(app))[0].id).toBe(current.id)
  expect((await snapshot(page)).generation).not.toBe(old.generation)
})
