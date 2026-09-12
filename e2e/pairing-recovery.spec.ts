import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW, SECOND_SEEDED_ROW,
  type PairedServerHandle } from './fixtures/launchPairedApp'
import { launchIsolatedApp, createLaunchFateLog, attachLaunchFate } from './fixtures/desktopIsolation'
import { COMPOSER_REPAIR_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'

const NOTICE = 'Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.'
const ts = '2026-09-12T00:00:00Z'
const rejection = (): Uint8Array => encodeEnvelope({ id: 50, type: 'error', ts,
  payload: { code: 'auth.invalid_token', message: 'synthetic private detail', retryable: false } })

function freshCode(server: PairedServerHandle): string {
  return Buffer.from(JSON.stringify({ server: server.serverId, relay: `${server.forwarder.url}/v1/client`,
    token: 'fresh-synthetic-pairing-token',
    server_static_pubkey: Buffer.from(server.daemon.staticPublicKey).toString('base64')
  })).toString('base64url')
}

async function fits(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const nodes = [document.documentElement, ...document.querySelectorAll(
      '.paired-shell__recovery, .pairing, .pairing-page__hero, .pairing__fingerprint')]
    return nodes.some(node => node.scrollWidth > node.clientWidth + 1)
  })
  expect(overflow).toBe(false)
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
}

test('startup rejection before a list retains its host, cancels and re-pairs beside the sidebar', async ({
  launchPairedApp
}, testInfo) => {
  let reject = false
  let rejectedFrames = 0
  const first = await launchPairedApp({ buildReplyFrames: () => {
    if (reject) { rejectedFrames++; return [rejection()] }
    return [seedConversationsFrame()]
  } }, { hostLabel: 'Alpha' })
  await first.app.close()
  reject = true
  const fate = createLaunchFateLog()
  const env = { ...process.env, PYRY_ALLOW_LOOPBACK_RELAY: '1', PYRY_TEST_SECRET_BACKEND: '1' }
  delete env.ELECTRON_RENDERER_URL
  // Reuse the SAME endpoint and fake daemon, so this is a decoded rejection, not connection refusal.
  const app = await launchIsolatedApp({ args: ['.', `--user-data-dir=${first.userDataDir}`], env, fate })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 800, height: 800 })
    const recovery = page.getByRole('region', { name: 'Repair pairing', exact: true })
    await expect(recovery).toBeVisible()
    expect(rejectedFrames).toBeGreaterThan(0)
    await expect(page.locator('.channel-list__host')).toHaveCount(2)
    await expect(page.locator('.channel-list__row-open')).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
    await expect(page.getByRole('img', { name: 'Relay Connected', exact: true })).toHaveCount(2)
    await expect(recovery.getByText(NOTICE, { exact: true })).toBeVisible()
    // A visible button alone misses a glyph blocked by the renderer's image policy.
    const glyphLoads = await page.locator('.channel-list__host-repair-icon').first().evaluate(async node => {
      const source = /url\("(.+)"\)/.exec(getComputedStyle(node).maskImage)?.[1]
      if (source === undefined) return false
      const glyph = new Image()
      glyph.src = source
      try { await glyph.decode(); return glyph.naturalWidth > 0 } catch { return false }
    })
    expect(glyphLoads).toBe(true)
    await fits(page)
    await page.screenshot({ path: testInfo.outputPath('startup-recovery-800.png') })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.channel-list__host')).toHaveCount(2)
    await expect(recovery).toHaveCount(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings__server-row-id')).toHaveText([first.servers[0].serverId])
    await page.locator('.settings__back').click()
    const repair = page.getByRole('button', { name: 'Repair host', exact: true }).first()
    await repair.focus()
    await page.keyboard.press('Enter')
    await expect(recovery).toBeVisible()
    await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(freshCode(first.servers[0]))
    await page.getByRole('button', { name: 'Pair', exact: true }).click()
    await expect(page.getByText('Confirm fingerprint', { exact: true })).toBeVisible()
    await fits(page)
    await page.screenshot({ path: testInfo.outputPath('fingerprint-confirmation-800.png') })
    reject = false
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
    await expect(page.locator('.channel-list__row-open')).toHaveCount(1)
    await expect(recovery).toHaveCount(0)
    await expect(page.getByText(NOTICE, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings__server-row-id')).toHaveText([first.servers[0].serverId])
    await page.locator('.settings__back').click()
    await page.screenshot({ path: testInfo.outputPath('recovered-host.png') })
  } finally {
    await fate.closeWatched(app)
    await attachLaunchFate(testInfo, fate)
  }
})

test('healthy host remains usable; last-host failure opens once and re-arms after recovery', async ({
  launchPairedApp
}, testInfo) => {
  let sends = 0
  const { page, servers } = await launchPairedApp({}, { hostLabel: 'Alpha', secondServer: {
    buildReplyFrames: bytes => {
      const frame = decodeEnvelope(bytes)
      if (frame.type !== 'send_message') return [seedConversationsFrame(SECOND_SEEDED_ROW)]
      sends++
      return [encodeEnvelope({ id: 80, type: 'assistant_delta', ts, payload: {
        conversation_id: SECOND_SEEDED_ROW.id, turn_id: 'reply', seq: 0, text: 'Healthy host reply'
      } }), encodeEnvelope({ id: 81, type: 'turn_end', ts, payload: {
        conversation_id: SECOND_SEEDED_ROW.id, turn_id: 'reply', stop_reason: 'end_turn'
      } })]
    }
  } })
  const [a, b] = servers
  a.daemon.pushFrame(rejection())
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
  await page.locator('.channel-list__row-open').filter({ hasText: 'Server two chat' }).click()
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await page.getByPlaceholder('Message…').fill('Hello healthy host')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Healthy host reply')
  expect(sends).toBe(1)
  // The composer entry targets A even though B was the last host to connect.
  await page.locator('.channel-list__row-open').filter({ hasText: 'Seeded discussion' }).click()
  await page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true }).click()
  await expect(page.getByText('Repair pairing: Alpha', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.conversation')).toBeVisible()
  await page.locator('.channel-list__row-open').filter({ hasText: 'Server two chat' }).click()
  b.daemon.pushFrame(rejection())
  await expect(page.getByText('Repair pairing: Alpha', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('failed-host-recovery.png') })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  a.daemon.pushFrame(rejection())
  b.daemon.pushFrame(rejection())
  // A following visible frame is the barrier for the repeated failures.
  b.daemon.pushFrame(seedConversationsFrame({ ...SECOND_SEEDED_ROW, name: 'Failure barrier' }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Failure barrier' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Healthy host reply')
  await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(freshCode(a))
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  a.daemon.pushFrame(rejection())
  // Upsert moves A last in saved order: B now owns the first rejection.
  await expect(page.getByText('Repair pairing: Server', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([b.serverId, a.serverId])
  await page.locator('.settings__back').click()
  a.daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'Navigation barrier' }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Navigation barrier' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Repair host', exact: true })).toHaveCount(4)
})
