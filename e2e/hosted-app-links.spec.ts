import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import type { LaunchPairedAppOptions, LaunchControl, PairedApp } from './fixtures/launchPairedApp'
import { pairFromUnpairedLaunch, pairAnotherServerFromSettings } from './fixtures/pairingArrival'
import type { Page, ElectronApplication } from '@playwright/test'

const appId = '22222222-2222-4222-8222-222222222222'
const FIRST_SERVER_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_SERVER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const unknown = '33333333-3333-4333-8333-333333333333'
const url = (host = FIRST_SERVER_ID, app = appId) => `pyrycode://hosts/${host}/apps/${app}`
// The shared fixture uses legacy non-UUID host IDs. Keep canonical identity setup local to this spec.
async function launch(start: (options?: LaunchPairedAppOptions, control?: LaunchControl) => Promise<PairedApp>,
  a: ReturnType<typeof scenario>, b?: ReturnType<typeof scenario>, pairSecond = true) {
  const handles = await start(a.options, { skipPairing: true, ...(b ? { secondServer: b.options } : {}) })
  const { page, app, servers } = handles
  const window = await app.browserWindow(page)
  try { await window.evaluate(w => w.webContents.setBackgroundThrottling(false)) } finally { await window.dispose() }
  const payload = (index: number, server: string) => Buffer.from(JSON.stringify({ server,
    relay: `${servers[index].forwarder.url}/v1/client`, token: 'synthetic-host-link-token',
    server_static_pubkey: Buffer.from(servers[index].daemon.staticPublicKey).toString('base64') })).toString('base64url')
  await pairFromUnpairedLaunch(page, payload(0, FIRST_SERVER_ID))
  await page.getByRole('button', { name: 'Seeded discussion', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  if (b && pairSecond) {
    await pairAnotherServerFromSettings(page, payload(1, SECOND_SERVER_ID))
    await expect(page.getByRole('button', { name: 'Server two chat', exact: true })).toBeVisible()
  }
  return handles
}
function scenario(second = false) {
  let id = 2000, revision = 1, state = 'running', hold = false, missing = false
  const capabilities = ['thread', 'hosted_apps_v1']
  const seen: any[] = [], held: Uint8Array[] = []
  const frame = (type: string, payload: unknown, reply?: number) => Buffer.from(JSON.stringify({
    id: id++, type, ts: '2026-10-15T10:00:00Z', ...(reply === undefined ? {} : { in_reply_to: reply }), payload
  }))
  const record = () => ({ app_id: appId, title: `${second ? 'Second' : 'First'} app ${revision}`, state,
    desired: 'available', active_release: '1.0.0', pending_release: null, last_error: null, revision })
  return { seen, held, frame, hold(value = true) { hold = value },
    support(value: boolean) { capabilities.splice(0, capabilities.length, 'thread', ...(value ? ['hosted_apps_v1'] : [])) },
    update(next = state) { state = next; revision++; return frame('app_updated', record()) },
    remove() { missing = true; revision++; return frame('app_removed', { app_id: appId, revision }) },
    options: { helloAck: { server_id: second ? SECOND_SERVER_ID : FIRST_SERVER_ID, capabilities },
    buildReplyFrames(bytes: Uint8Array) {
      const r = JSON.parse(Buffer.from(bytes).toString()); seen.push(r)
      if (r.type === 'list_conversations') return [seedConversationsFrame(second ? SECOND_SEEDED_ROW : undefined)]
      if (r.type === 'list_apps') {
        const reply = frame('apps', { revision, items: missing ? [] : [record()], next_cursor: null }, r.id)
        if (hold) { held.push(reply); return [] }
        return [reply]
      }
      if (r.type === 'app_cancel') return [frame('app_cancelled', r.payload, r.id)]
      if (r.type !== 'app_asset_request' && r.type !== 'app_api_request') return []
      const body = Buffer.from(`<html><body>Hosted ${second ? 'second' : 'first'}</body></html>`)
      return [frame('app_response', { app_id: appId, release_version: '1.0.0', status: 200,
        headers: { 'content-type': 'text/html' }, size_bytes: body.length, total_chunks: 1,
        sha256: createHash('sha256').update(body).digest('hex') }, r.id),
      frame('app_response_chunk', { app_id: appId, index: 0, data: body.toString('base64') }, r.id)]
    } }
  }
}
async function snapshot(page: Page) {
  const result = await page.evaluate(() => window.pyry.hostedPane({ type: 'snapshot' }))
  if (!result.ok) throw new Error('snapshot refused')
  return result.state
}
async function native(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.flatMap(child => {
    const wc = (child as Electron.WebContentsView).webContents
    return wc?.getURL().startsWith('https://app-') ? [wc.id] : []
  }))
}
async function ready(page: Page, app: ElectronApplication, serverId = FIRST_SERVER_ID) {
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Connected')
  expect(await snapshot(page)).toMatchObject({ type: 'ready', serverId, appId })
  expect(await native(app)).toHaveLength(1)
  return (await native(app))[0]
}
async function noHandoff(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    ;(globalThis as any).linkHandoffs = []
    shell.openExternal = async value => { (globalThis as any).linkHandoffs.push(value) }
  })
}
async function assertNoHandoff(app: ElectronApplication) {
  expect(await app.evaluate(() => (globalThis as any).linkHandoffs)).toEqual([])
}
async function discovered(app: ElectronApplication, deliver: () => void, code = 'ready') {
  let completed = false, output = ''
  const stream = app.process().stdout!
  const observe = (chunk: Buffer) => {
    output += chunk.toString(); completed = output.includes(`"event":"hosted-discovery","code":"${code}"`)
  }
  stream.on('data', observe)
  try { deliver(); await expect.poll(() => completed).toBe(true) }
  finally { stream.removeListener('data', observe) }
}
function reply(s: ReturnType<typeof scenario>, text: string, conversation = SEEDED_ROW.id, turn = 'links') {
  return s.frame('assistant_delta', { conversation_id: conversation, turn_id: turn, seq: 0, text })
}
const status = (page: Page) => page.locator('.hosted-pane [role=status]')
const link = (page: Page, name: string) => page.locator('.bubble__markdown').getByRole('button', { name, exact: true })
async function returnToChat(page: Page, second = false) {
  await page.getByRole('button', { name: second ? 'Server two chat' : 'Seeded discussion', exact: true }).click()
  await expect(page.locator('.hosted-pane')).toHaveCount(0)
  expect((await snapshot(page)).type).toBe('closed')
}

test('streaming and settled links preserve conversation drafts', async ({ launchPairedApp }) => {
  const s = scenario(), { page, app, daemon } = await launch(launchPairedApp, s)
  await noHandoff(app)
  await page.getByPlaceholder('Message…').fill('origin draft')
  daemon.pushFrame(reply(s, `[Frozen](${url()})\n\nparagraph\nline\n\n[Pending](${url()})`))
  await expect(link(page, 'Frozen')).toBeVisible()
  await expect(link(page, 'Pending')).toBeVisible()
  await expect(page.locator('.bubble__cursor')).toBeVisible()
  const walks = s.seen.filter(r => r.type === 'list_apps').length
  mkdirSync('/tmp/builder-2002', { recursive: true })
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    await page.screenshot({ path: `/tmp/builder-2002/links-${width}.png`, animations: 'disabled' })
  }
  await link(page, 'Pending').focus(); await page.keyboard.press('Enter')
  const first = await ready(page, app)
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    const capture = await app.evaluate(async ({ BrowserWindow, nativeImage }) => {
      const parent = BrowserWindow.getAllWindows()[0]
      const child = parent.contentView.children.find(child =>
        (child as Electron.WebContentsView).webContents?.getURL().startsWith('https://app-')) as Electron.WebContentsView
      const chrome = await parent.capturePage(), content = await child.webContents.capturePage()
      const size = chrome.getSize(), bounds = child.getBounds(), childSize = content.getSize()
      if (childSize.width !== bounds.width || childSize.height !== bounds.height) throw new Error('capture dimensions differ')
      const bitmap = chrome.toBitmap(), pixels = content.toBitmap()
      for (let y = 0; y < childSize.height; y++) pixels.copy(bitmap,
        ((bounds.y + y) * size.width + bounds.x) * 4, y * childSize.width * 4, (y + 1) * childSize.width * 4)
      return nativeImage.createFromBitmap(bitmap, size).toPNG().toString('base64')
    })
    writeFileSync(`/tmp/builder-2002/pane-${width}.png`, Buffer.from(capture, 'base64'))
  }
  await returnToChat(page)
  expect(await native(app)).toEqual([])
  await expect(page.getByPlaceholder('Message…')).toHaveValue('origin draft')
  await link(page, 'Frozen').click(); expect(await ready(page, app)).not.toBe(first)
  await returnToChat(page)
  await page.evaluate(() => {
    ;(window as any).linkTurnSettled = false
    const off = window.pyry.onDaemonEvent(event => {
      if (event.type === 'threadUpdate' && event.update.type === 'thread_item_added' && event.update.payload.item.kind === 'turn_end' && event.update.payload.item.turn === 'links') { (window as any).linkTurnSettled = true; off() }
    }, true)
  })
  daemon.pushFrame(s.frame('turn_end', { conversation_id: SEEDED_ROW.id, turn_id: 'links', stop_reason: 'end_turn' }))
  await expect.poll(() => page.evaluate(() => (window as any).linkTurnSettled)).toBe(true)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0)
  await link(page, 'Pending').click(); await ready(page, app)
  expect(s.seen.filter(r => r.type === 'list_apps')).toHaveLength(walks)
  await returnToChat(page)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('origin draft')
  await assertNoHandoff(app)
})

test('invalid and unpaired links stay bounded', async ({ launchPairedApp }) => {
  const s = scenario(), b = scenario(true), { page, app, daemon, servers } = await launch(launchPairedApp, s, b, false)
  await noHandoff(app)
  await page.getByPlaceholder('Message…').fill('cancel keeps draft')
  const invalid = [url() + '/', url() + '?x=1', url() + '#x', url().replace('hosts/', 'user@hosts/'),
    url().replace('hosts/', 'hosts:80/'), url().replace(':', '&#58;'), url().replace(':', '\\:'),
    url().replace('/apps/', '/x/../apps/'), url().replace('hosts', '%68osts')]
  daemon.pushFrame(reply(s, invalid.map((v, i) => `[Bad ${i}](${v})`).join(' ') + ` [Unpaired](${url(SECOND_SERVER_ID)})`))
  await expect(link(page, 'Unpaired')).toBeVisible()
  expect(await page.locator('.bubble__markdown a').count()).toBe(0)
  expect(await page.locator('.bubble__markdown button').count()).toBe(1)
  await page.getByText('Bad 0', { exact: false }).last().click({ position: { x: 3, y: 3 } })
  expect((await snapshot(page)).type).toBe('closed')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  expect(s.seen.filter(r => r.type.startsWith('app_'))).toEqual([])
  await link(page, 'Unpaired').click()
  await expect(page.locator('dialog[open]')).toBeVisible()
  expect((await snapshot(page)).type).toBe('closed')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('cancel keeps draft')
  expect((await snapshot(page)).type).toBe('closed')
  await link(page, 'Unpaired').click()
  await expect(page.locator('dialog[open]')).toBeVisible()
  const payload = Buffer.from(JSON.stringify({ server: SECOND_SERVER_ID,
    relay: `${servers[1].forwarder.url}/v1/client`, token: 'synthetic-second-host-link-token',
    server_static_pubkey: Buffer.from(servers[1].daemon.staticPublicKey).toString('base64') })).toString('base64url')
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(payload)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.locator('[aria-label="Server key fingerprint"]')).toBeVisible()
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Server two chat', exact: true })).toBeVisible()
  expect((await snapshot(page)).type).toBe('closed')
  expect(b.seen.filter(r => r.type.startsWith('app_'))).toEqual([])
  await returnToChat(page)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('cancel keeps draft')
  await assertNoHandoff(app)
})

test('latest host selection survives delayed replies', async ({ launchPairedApp }) => {
  const a = scenario(), b = scenario(true); a.hold()
  const { page, app, servers } = await launch(launchPairedApp, a, b)
  await noHandoff(app)
  await returnToChat(page, true)
  await page.getByPlaceholder('Message…').fill('second host draft')
  servers[1].daemon.pushFrame(reply(b, `[A](${url()}) [B](${url(SECOND_SERVER_ID)})`, SECOND_SEEDED_ROW.id))
  await expect(link(page, 'A')).toBeVisible()
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('pyry:hosted-pane')
    handlers.set('pyry:hosted-pane', async (event: any, command: any) => {
      const result = original(event, command)
      if (command.type === 'select' && command.serverId === '11111111-1111-4111-8111-111111111111') {
        await new Promise(resolve => { (globalThis as any).releaseSelection = resolve })
      }
      return result
    })
  })
  await link(page, 'A').click()
  await expect(status(page)).toHaveText('Loading app…')
  await expect.poll(() => a.held.length).toBe(1)
  await returnToChat(page, true)
  await link(page, 'B').click(); const selected = await ready(page, app, SECOND_SERVER_ID)
  const generation = (await snapshot(page)).generation
  await discovered(app, () => { for (const frame of a.held.splice(0)) servers[0].daemon.pushFrame(frame) })
  servers[1].daemon.pushFrame(b.update())
  await expect(page.locator('.hosted-pane__identity')).toContainText('Second app 2')
  await app.evaluate(() => (globalThis as any).releaseSelection())
  // The later snapshot response follows the released command response on the privileged IPC stream.
  expect(await snapshot(page)).toMatchObject({ serverId: SECOND_SERVER_ID, generation })
  await expect(page.locator('.hosted-pane__identity')).toContainText('Second app 2')
  expect(await native(app)).toEqual([selected])
  expect(a.seen.some(r => r.type === 'app_asset_request')).toBe(false)
  expect(b.seen.some(r => r.type === 'app_asset_request')).toBe(true)
  await returnToChat(page, true)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('second host draft')
  await link(page, 'A').click(); await ready(page, app)
  await returnToChat(page, true)
  await link(page, 'B').click(); await ready(page, app, SECOND_SERVER_ID)
  await assertNoHandoff(app)
})

test('links reuse discovery recovery', async ({ launchPairedApp }) => {
  const s = scenario(), { page, app, daemon } = await launch(launchPairedApp, s)
  await noHandoff(app)
  daemon.pushFrame(reply(s, `[Open](${url()}) [Missing](${url(FIRST_SERVER_ID, unknown)})`))
  await link(page, 'Missing').click()
  await expect(status(page)).toHaveText('App unavailable')
  expect(s.seen.some(r => r.type === 'app_asset_request')).toBe(false)
  for (const state of ['stopped', 'failed']) {
    await returnToChat(page)
    daemon.pushFrame(s.update(state))
    await link(page, 'Open').click()
    await expect(page.locator('.hosted-pane__identity')).toContainText(`First app ${state === 'stopped' ? 2 : 3}`)
    await expect(status(page)).toHaveText('App unavailable')
    expect(await native(app)).toEqual([])
    expect(s.seen.some(r => r.type === 'app_asset_request')).toBe(false)
  }
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  await expect(status(page)).toHaveText('App unavailable')
  daemon.pushFrame(s.update('running'))
  await expect(page.locator('.hosted-pane__identity')).toContainText('First app 4')
  await ready(page, app)
  s.hold()
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), FIRST_SERVER_ID)
  await expect.poll(() => s.held.length).toBe(1)
  await expect(status(page)).toHaveText('Disconnected')
  const resources = s.seen.filter(r => r.type === 'app_asset_request').length
  expect(await native(app)).toEqual([])
  await returnToChat(page)
  await link(page, 'Open').click(); await expect(status(page)).toHaveText('Loading app…')
  expect(s.seen.filter(r => r.type === 'app_asset_request')).toHaveLength(resources)
  for (const frame of s.held.splice(0)) daemon.pushFrame(frame)
  await ready(page, app)
  s.support(false)
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), FIRST_SERVER_ID)
  await expect(status(page)).toHaveText('Hosted apps are unsupported')
  await returnToChat(page)
  await link(page, 'Open').click(); await expect(status(page)).toHaveText('Hosted apps are unsupported')
  expect(await native(app)).toEqual([])
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  expect((await snapshot(page)).type).toBe('unsupported')
  s.support(true); s.hold(false)
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), FIRST_SERVER_ID)
  await expect.poll(() => s.seen.filter(r => r.type === 'list_apps').length).toBe(3)
  await ready(page, app)
  s.hold()
  await page.evaluate(serverId => window.pyry.reconnectServer(serverId), FIRST_SERVER_ID)
  await expect.poll(() => s.held.length).toBe(1)
  const request = JSON.parse(Buffer.from(s.held.splice(0)[0]).toString()).in_reply_to
  await discovered(app, () => daemon.pushFrame(s.frame('error', {
    code: 'app.busy', message: 'synthetic failure', retryable: true
  }, request)), 'bridge')
  const before = s.seen.filter(r => r.type === 'app_asset_request').length
  await page.getByRole('button', { name: 'Reopen app', exact: true }).click()
  await expect.poll(() => s.held.length).toBe(1)
  await expect(status(page)).toHaveText('Loading app…')
  expect(await native(app)).toEqual([])
  expect(s.seen.filter(r => r.type === 'app_asset_request')).toHaveLength(before)
  for (const frame of s.held.splice(0)) daemon.pushFrame(frame)
  await ready(page, app)
  daemon.pushFrame(s.remove()); await expect(status(page)).toHaveText('App unavailable')
  expect(await native(app)).toEqual([])
  await assertNoHandoff(app)
})
