import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, seedConversationsFrame, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import type { Page } from '@playwright/test'
const appId = '22222222-2222-4222-8222-222222222222'
function scenario(second = false) {
  let id = 1000, revision = 0, items: any[] = [], hold = false, fail = false, paged = false, holdAssets = false
  const pending: Uint8Array[] = [], assets: Uint8Array[] = [], seen: any[] = []
  const frame = (type: string, payload: unknown, reply?: number) => Buffer.from(JSON.stringify({ id: id++, type,
    ts: '2026-10-15T10:00:00Z', ...(reply === undefined ? {} : { in_reply_to: reply }), payload }))
  const record = (state: string, title: string, app_id = appId) => ({ app_id, title, state, desired: 'available',
    active_release: state === 'starting' ? null : '1.0.0', pending_release: null, last_error: null, revision })
  return { seen, pending, assets, frame,
    hold(value = true) { hold = value }, fail(value = true) { fail = value }, paged() { paged = true }, holdAssets(value: boolean) { holdAssets = value },
    update(state = 'running', title = second ? 'Second app' : '<App & first>') {
      revision++; const next = record(state, title); items = [next]; return frame('app_updated', next)
    },
    remove() { revision++; items = []; return frame('app_removed', { app_id: appId, revision }) },
    options: { helloAck: { server_id: second ? SECOND_SERVER_ID : FIRST_SERVER_ID, capabilities: ['thread', 'hosted_apps_v1'] },
      buildReplyFrames(bytes: Uint8Array) {
        const r = JSON.parse(Buffer.from(bytes).toString()); seen.push(r)
        if (r.type === 'list_conversations') return [seedConversationsFrame(second ? SECOND_SEEDED_ROW : undefined)]
        if (r.type === 'list_apps') {
          const reply = fail ? frame('error', { code: 'app.io_failed', message: 'Unavailable' }, r.id)
            : frame('apps', { revision, items: paged && r.payload.cursor ? [] : items, next_cursor: paged && !r.payload.cursor ? 'next' : null }, r.id)
          if (hold || (paged && r.payload.cursor)) { pending.push(reply); return [] }
          return [reply]
        }
        if (r.type === 'app_cancel') return [frame('app_cancelled', r.payload, r.id)]
        if (r.type !== 'app_asset_request') return []
        const body = Buffer.from('<!doctype html><html><body>Hosted app</body></html>')
        const result = [frame('app_response', { app_id: appId, release_version: '1.0.0', status: 200,
          headers: { 'content-type': 'text/html' }, size_bytes: body.length, total_chunks: 1,
          sha256: createHash('sha256').update(body).digest('hex') }, r.id),
        frame('app_response_chunk', { app_id: appId, index: 0, data: body.toString('base64') }, r.id)]
        if (holdAssets) { assets.push(...result); return [] }
        return result
      } }
  }
}
const host = (page: Page, index = 0) => page.locator('.channel-list__host-content').nth(index)
const row = (page: Page, name: string) => page.getByRole('button', { name: name.replace(/(running|starting|stopped|failed)$/, ' $1'), exact: true })
async function committed(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('discovery, lifecycle and navigation', async ({ launchPairedApp }) => {
  const a = scenario(), b = scenario(true)
  const { page, app, daemon, servers } = await launchPairedApp(a.options, { secondServer: b.options })
  await expect(host(page, 0)).toContainText('No apps')
  await page.getByRole('button', { name: 'Server two chat', exact: true }).click()
  await page.getByPlaceholder('Message…').fill('host two draft')
  daemon.pushFrame(a.update()); servers[1].daemon.pushFrame(b.update())
  await expect(row(page, '<App & first>running')).toBeVisible()
  await expect(row(page, 'Second apprunning')).toBeVisible()
  expect(await host(page).locator('img').count()).toBe(0)
  await host(page).getByRole('button', { name: 'Chats', exact: true }).click()
  await host(page).getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(host(page).getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(host(page, 1).getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.channel-list__host-disclosure').first().click()
  await page.locator('.channel-list__host-disclosure').first().click()
  await expect(host(page).getByRole('button', { name: 'Chats', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await host(page).getByRole('button', { name: 'Apps', exact: true }).click()
  a.holdAssets(true)
  await row(page, '<App & first>running').click()
  await expect.poll(() => a.assets.length).toBe(2)
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Loading app…')
  await row(page, 'Second apprunning').click()
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Connected')
  await host(page, 1).getByRole('button', { name: 'Apps', exact: true }).click()
  await page.locator('.channel-list__host-disclosure').nth(1).click()
  await page.locator('.channel-list__host-disclosure').nth(1).click()
  await expect(host(page, 1).getByRole('button', { name: 'Apps', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Connected')
  await host(page, 1).getByRole('button', { name: 'Apps', exact: true }).click()
  for (const frame of a.assets.splice(0)) daemon.pushFrame(frame)
  daemon.pushFrame(a.update('running', 'Processed successor'))
  await expect(row(page, 'Processed successorrunning')).toBeVisible(); await committed(page)
  await expect(row(page, 'Second apprunning')).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.channel-list__row-open[aria-current=true]')).toHaveCount(1)
  await expect(page.locator('.hosted-pane__identity')).toContainText('Second app')
  const walks = a.seen.filter(r => r.type === 'list_apps').length
  a.holdAssets(false); await row(page, 'Processed successorrunning').click()
  await expect(page.locator('.hosted-pane [role=status]')).toHaveText('Connected')
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await committed(page); mkdirSync('/tmp/builder-2001', { recursive: true })
    await page.screenshot({ path: `/tmp/builder-2001/sidebar-${width}.png`, animations: 'disabled' })
  }
  expect(a.seen.filter(r => r.type === 'list_apps')).toHaveLength(walks)
  for (const state of ['starting', 'stopped', 'failed']) {
    daemon.pushFrame(a.update(state))
    await expect(row(page, `<App & first>${state}`)).toBeVisible()
    await row(page, `<App & first>${state}`).click()
    await expect(page.locator('.hosted-pane [role=status]')).toHaveText('App unavailable')
  }
  daemon.pushFrame(a.remove()); await expect(host(page)).toContainText('No apps'); await committed(page)
  await expect(row(page, 'Second apprunning')).toBeVisible()
  await expect(row(page, '<App & first>failed')).toHaveCount(0)
  daemon.pushFrame(a.frame('conversations', { conversations: [] }))
  await host(page).getByRole('button', { name: 'Chats', exact: true }).click()
  await expect(row(page, 'Seeded discussion')).toHaveCount(0)
  await expect(host(page).getByRole('button', { name: 'Apps', exact: true })).toBeVisible()
  await row(page, 'Server two chat').click()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('host two draft')
  await expect(page.locator('.hosted-pane')).toHaveCount(0)
  await expect(row(page, 'Server two chat')).toHaveAttribute('aria-current', 'true')
  expect(a.seen.concat(b.seen).some(r => r.type === 'create_conversation')).toBe(false)
})

test('paging and retry', async ({ launchPairedApp }) => {
  const s = scenario(); s.update(); s.paged()
  const { page, app, daemon } = await launchPairedApp(s.options)
  await expect.poll(() => s.pending.length).toBe(1)
  await expect(host(page)).toContainText('Loading apps…'); await committed(page)
  await expect(row(page, '<App & first>running')).toHaveCount(0)
  for (const frame of s.pending.splice(0)) daemon.pushFrame(frame)
  await expect(row(page, '<App & first>running')).toBeVisible()
  s.fail(); s.hold(false)
  await page.evaluate(server => window.pyry.refreshHostedApps(server), FIRST_SERVER_ID)
  await expect(host(page)).toContainText('Could not load apps')
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    await committed(page); mkdirSync('/tmp/builder-2001', { recursive: true })
    await page.screenshot({ path: `/tmp/builder-2001/sidebar-failed-${width}.png`, animations: 'disabled' })
  }
  await expect(host(page).getByRole('button', { name: 'Retry', exact: true })).toHaveCSS('font-size', '12px')
  s.fail(false); s.hold()
  await host(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => s.pending.length).toBe(1)
  const walks = s.seen.filter(r => r.type === 'list_apps').length
  await page.evaluate(async server => { await window.pyry.refreshHostedApps(server); await window.pyry.refreshHostedApps(server) }, FIRST_SERVER_ID)
  await committed(page); expect(s.seen.filter(r => r.type === 'list_apps')).toHaveLength(walks)
  // First page is accepted, then the next list request positively proves it was processed.
  daemon.pushFrame(s.pending.shift()!)
  await expect.poll(() => s.seen.filter(r => r.type === 'list_apps').length).toBe(walks + 1)
  await expect(host(page)).toContainText('Loading apps…')
  for (const frame of s.pending.splice(0)) daemon.pushFrame(frame)
  await expect(row(page, '<App & first>running')).toBeVisible()
})

test('unsupported and unauthorized', async ({ launchPairedApp }) => {
  const s = scenario()
  const { page, app, forwarder } = await launchPairedApp({ ...s.options, helloAck: { server_id: FIRST_SERVER_ID, capabilities: ['thread'] } })
  await expect(host(page)).toContainText('Apps unsupported')
  await page.evaluate(server => window.pyry.refreshHostedApps(server), FIRST_SERVER_ID)
  expect(await page.evaluate(server => window.pyry.refreshHostedApps(server), 'unknown')).toEqual({ ok: false, error: 'refused' })
  const refusals = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
    const client = BrowserWindow.getAllWindows()[0].webContents
    const handler = (ipcMain as any)._invokeHandlers.get('pyry:hosted-apps-display')
    const output = []
    for (const type of ['watch', 'refresh']) for (const event of [{ sender: client, senderFrame: null }, { sender: {}, senderFrame: null }])
      output.push(await handler(event, { type, serverId: 'fake-daemon', token: 1 }))
    return output
  })
  expect(refusals).toEqual(Array(4).fill({ ok: false, error: 'refused' }))
  forwarder.closeClientLeg(4401)
  await expect(host(page)).toContainText('Apps disconnected')
  await page.evaluate(server => window.pyry.refreshHostedApps(server), FIRST_SERVER_ID)
  await committed(page)
  expect(s.seen.some(r => ['list_apps', 'app_asset_request', 'app_api_request'].includes(r.type))).toBe(false)
})

test('stale delivery and remount', async ({ launchPairedApp }) => {
  const s = scenario(), survivor = scenario(true)
  const { page, app, daemon, servers } = await launchPairedApp(s.options, { secondServer: survivor.options })
  daemon.pushFrame(s.update())
  await expect(row(page, '<App & first>running')).toBeVisible()
  s.hold()
  await page.evaluate(server => window.pyry.refreshHostedApps(server), FIRST_SERVER_ID)
  await expect.poll(() => s.pending.length).toBe(1)
  const stale = s.pending.splice(0)
  await page.evaluate(server => window.pyry.reconnectServer(server), FIRST_SERVER_ID)
  await expect.poll(() => s.pending.length).toBe(1)
  await expect(host(page)).toContainText('Loading apps…')
  for (const frame of stale) daemon.pushFrame(frame)
  for (const frame of s.pending.splice(0)) daemon.pushFrame(frame)
  daemon.pushFrame(s.update('running', 'Current connection'))
  await expect(row(page, 'Current connectionrunning')).toBeVisible(); await committed(page)
  await expect(row(page, '<App & first>running')).toHaveCount(0)
  // Save an old token, then deliver it after a real sidebar unmount/remount.
  await app.evaluate(({ BrowserWindow }) => {
    const client = BrowserWindow.getAllWindows()[0].webContents, send = client.send.bind(client)
    ;(globalThis as any).oldDisplay = null
    client.send = (channel, ...args) => { if (channel === 'pyry:hosted-apps-display') (globalThis as any).oldDisplay = args[0]; send(channel, ...args) }
  })
  daemon.pushFrame(s.update('running', 'Before remount'))
  await expect(row(page, 'Before remountrunning')).toBeVisible()
  const old = await app.evaluate(() => (globalThis as any).oldDisplay)
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page.locator('section[aria-label="Settings screen"]').getByRole('button', { name: 'Back', exact: true }).click()
  await expect(row(page, 'Before remountrunning')).toBeVisible()
  daemon.pushFrame(s.update('running', 'After remount'))
  await expect(row(page, 'After remountrunning')).toBeVisible()
  const retired = await app.evaluate(() => (globalThis as any).oldDisplay)
  expect(retired.token).not.toBe(old.token)
  await app.evaluate(({ BrowserWindow }, old) => BrowserWindow.getAllWindows()[0].webContents.send('pyry:hosted-apps-display', old), old)
  daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'Render barrier' }))
  await expect(row(page, 'Render barrier')).toBeVisible(); await committed(page)
  await expect(row(page, 'After remountrunning')).toBeVisible()
  await expect(row(page, 'Before remountrunning')).toHaveCount(0)
  // Use the normal in-sidebar removal so the mounted host-list subscriber cleans up.
  await page.locator('.channel-list__host-edit').first().click()
  const dialog = page.getByRole('dialog', { name: 'Edit host', exact: true })
  await dialog.getByRole('button', { name: 'Unpair host', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('.channel-list__host-content')).toHaveCount(1)
  // A privileged snapshot/refresh refusal proves main has processed removal before stale publication.
  await expect.poll(() => page.evaluate(server => window.pyry.refreshHostedApps(server), FIRST_SERVER_ID)).toEqual({ ok: false, error: 'refused' })
  await app.evaluate(({ BrowserWindow }, retired) => BrowserWindow.getAllWindows()[0].webContents.send('pyry:hosted-apps-display', retired), retired)
  servers[1].daemon.pushFrame(survivor.update('running', 'Surviving host barrier'))
  await expect(row(page, 'Surviving host barrierrunning')).toBeVisible(); await committed(page)
  await expect(row(page, 'After remountrunning')).toHaveCount(0)
  await expect(page.getByText('Before remount', { exact: true })).toHaveCount(0)
  await expect(page.locator('.channel-list__host-content')).toHaveCount(1)
  // Reload is separate evidence; the mounted unpair fence has already been asserted.
  s.hold(false)
  await page.reload()
  await expect(row(page, 'Surviving host barrierrunning')).toBeVisible(); await committed(page)
  await expect(page.locator('.channel-list__host-content')).toHaveCount(1)
  await expect(row(page, 'After remountrunning')).toHaveCount(0)
})
