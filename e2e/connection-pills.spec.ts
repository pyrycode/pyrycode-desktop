import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { installHeldThreadRead } from './fixtures/heldThreadRead'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { StampedDaemonEvent } from '../src/shared/ipc/events'
import { confirmConnectionPillStatus } from './fixtures/connectionPillStatus'
import { CONNECTION_BANNER_COPY, DAEMON_UPDATE_REQUIRED_COPY } from '../src/renderer/src/screens/conversation/composerSend'

// The existing main/preload boundary supplies typed lifecycle events. Real recovery dispatch is
// independently observed in unpair-repair; these controlled events make intermediate states stable.
async function status(app: ElectronApplication, page: Page, event: StampedDaemonEvent) {
  await confirmConnectionPillStatus(app, page, event)
}

const connected = (serverId: string): StampedDaemonEvent => ({ type: 'connected', serverId,
  ack: { protocol_version: '1', server_id: serverId, conn_id: 'connection', capabilities: ['interactive', 'thread'] } })
const frame = (type: string, payload: unknown, reply?: number) => encodeEnvelope({ id: 50, type, payload,
  ts: '2026-10-16T00:00:00Z', ...(reply === undefined ? {} : { in_reply_to: reply }) })
const geometry = (page: Page) => page.evaluate(() =>
  ['.conversation__thread', '.composer'].map(selector => {
    const box = document.querySelector(selector)!.getBoundingClientRect()
    return [box.x, box.y, box.width, box.height].map(Math.round)
  }))

for (const mode of ['empty', 'hidden', 'saved']) test(`connection pills clear and float over ${mode} rows`, async ({ launchPairedApp }) => {
  const saved = mode === 'saved'
  const { page, app, daemon, servers } = await launchPairedApp({ threadMode: 'native',
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    if (request.type === 'list_conversations') return [seedConversationsFrame(SEEDED_ROW)]
    if (request.type !== 'thread_catch_up') return []
    return [frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'pills', version: 40,
      items: mode !== 'empty' ? Array.from({ length: 35 }, (_, index) => ({ id: index + 1, rev: 1, order: index + 1,
        kind: 'assistant_message', status: 'finished', active: false, shown: saved, session: 'session',
        summary: `Saved message ${index}`, content: { text: `Saved message ${index}` } })) : [], final: false }, request.id),
      frame('thread_items', { conversation_id: SEEDED_ROW.id, epoch: 'pills', version: 40, items: [], final: true,
        ...(Number(request.payload.version) > 0 ? { from_version: request.payload.version }
          : { lower_order: 0, upper_order: 41, continuation: 0, older_exists: false }) }, request.id)]
  } })
  const serverId = servers[0].serverId
  const feedback = page.locator('.conversation__top-overlay [role="status"]')
  if (saved) await expect(page.getByText('Saved message 34', { exact: true })).toBeVisible()
  else await expect(page.locator('.conversation__thread')).toBeVisible()
  daemon.pushFrame(frame('rate_limited', { conversation_id: SEEDED_ROW.id, status: 'allowed_warning',
    limit_type: 'seven_day', resets_at: 4102444800, truncated_fields: null }))
  await expect(page.locator('.top-overlay-pill--default')).toBeVisible()

  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    const baseline = await geometry(page)
    for (const type of ['disconnected', 'connecting'] as const) {
      await status(app, page, { type, serverId })
      await expect(feedback).toContainText(CONNECTION_BANNER_COPY)
      await expect(feedback).toHaveCount(1)
      await expect(feedback.getByText('Offline. Showing saved messages.', { exact: true })).toHaveCount(saved ? 1 : 0)
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      expect(await geometry(page)).toEqual(baseline)
    }
    await status(app, page, { type: 'failed', serverId, cause: 'daemon',
      error: { code: 'update-required', message: 'PRIVATE', retryable: true } })
    await expect(feedback).toContainText(DAEMON_UPDATE_REQUIRED_COPY)
    await expect(feedback).not.toContainText('Showing saved messages')
    await status(app, page, { type: 'failed', serverId, error: { code: 'transport', message: 'PRIVATE', retryable: true } })
    await expect(feedback).toContainText(CONNECTION_BANNER_COPY)
    await expect(page.locator('.conversation__banner')).toHaveCount(0)
    await expect(page.locator('.composer-status__error')).toHaveCount(0)
    await expect(feedback).not.toContainText('PRIVATE')
    await expect(feedback.locator('button')).toHaveCount(0)
    const fits = await feedback.evaluate(el => {
      const pane = document.querySelector('.conversation__message-area')!.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return { fits: rect.left >= pane.left && rect.right <= pane.right && el.scrollWidth <= el.clientWidth,
        wraps: rect.height > parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) }
    })
    expect(fits.fits).toBe(true)
    if (width === 800) expect(fits.wraps).toBe(true)
    expect(await geometry(page)).toEqual(baseline)
    await page.screenshot({ path: `/tmp/builder-2076/connection-${mode}-${width}.png` })
    if (saved) {
      const gap = await page.locator('.conversation__top-overlay').evaluate(el => {
        const a = el.children[0].getBoundingClientRect(), b = el.children[1].getBoundingClientRect()
        const x = b.left + b.width / 2, y = (a.bottom + b.top) / 2
        return { x, y, clear: document.elementFromPoint(x, y)?.closest('.top-overlay-pill') === null }
      })
      expect(gap.clear).toBe(true)
      const thread = page.locator('.conversation__thread')
      await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
      const before = await thread.evaluate(el => el.scrollTop)
      await page.mouse.move(gap.x, gap.y)
      await page.mouse.wheel(0, -150)
      await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBeLessThan(before)
    }
    await status(app, page, connected(serverId))
    await expect(feedback).toHaveCount(0)
    await expect(page.locator('.top-overlay-pill--default')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  }
})

test('empty saved read loading is independent of connection and settles silently', async ({ launchPairedApp }) => {
  const { page, app, servers } = await launchPairedApp({}, {
    onLaunched: app => installHeldThreadRead(app).then(() => {})
  })
  const feedback = page.locator('.conversation__top-overlay [role="status"]')
  await expect(feedback).toContainText('Loading saved messages…')
  await expect.poll(() => app.evaluate(() => (globalThis as any).heldThreadReads)).toBe(1)
  await status(app, page, { type: 'disconnected', serverId: servers[0].serverId })
  await expect(feedback).toContainText(CONNECTION_BANNER_COPY)
  await expect(feedback).not.toContainText('Showing saved messages')
  await status(app, page, connected(servers[0].serverId))
  await expect(feedback).toHaveText(' Loading saved messages…')
  await app.evaluate(({ ipcMain }) => ipcMain.emit('test:release-thread-read'))
  await expect(feedback).toHaveCount(0)
  await status(app, page, { type: 'connecting', serverId: servers[0].serverId })
  await expect(feedback).toContainText(CONNECTION_BANNER_COPY)
  await expect(feedback).not.toContainText('Showing saved messages')
})

test('switching hosts replaces connection pills and recovery targets the selected host', async ({ launchPairedApp }) => {
  const { page, app, servers } = await launchPairedApp({}, { secondServer: {} })
  const [a, b] = servers
  const open = (name: string) => page.locator('.channel-list__row-open').filter({ hasText: name }).click()
  await open(SEEDED_ROW.name!)
  a.forwarder.closeClientLeg(4401)
  const reconnect = page.locator('.conversation__top-overlay').getByRole('button', { name: 'Connection error - Reconnect', exact: true })
  await expect(reconnect).toBeVisible()
  await open(SECOND_SEEDED_ROW.name!)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.locator('.conversation__top-overlay')).toHaveCount(0)
  b.daemon.pushFrame(frame('error', { code: 'auth.invalid_token', message: 'PRIVATE', retryable: false }))
  const repair = page.locator('.conversation__top-overlay').getByRole('button', { name: 'Pairing error - Re-pair', exact: true })
  await expect(repair).toBeVisible()
  await expect(reconnect).toHaveCount(0)
  await repair.click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await repair.click()
  const code = Buffer.from(JSON.stringify({ server: b.serverId, relay: `${b.forwarder.url}/v1/client`,
    token: 'synthetic-repair-token', server_static_pubkey: Buffer.from(b.daemon.staticPublicKey).toString('base64')
  })).toString('base64url')
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(code)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Server key fingerprint', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await open(SEEDED_ROW.name!)
  await expect(reconnect).toBeVisible()
  await reconnect.click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(reconnect).toHaveCount(0)
  await open(SECOND_SEEDED_ROW.name!)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(repair).toHaveCount(0)
  await expect(reconnect).toHaveCount(0)
})
