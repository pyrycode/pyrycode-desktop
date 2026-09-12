import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW, SECOND_SEEDED_ROW,
  type PairedServerHandle } from './fixtures/launchPairedApp'
import { launchIsolatedApp, createLaunchFateLog, attachLaunchFate } from './fixtures/desktopIsolation'
import { COMPOSER_REPAIR_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { PAIRING_CHANNEL } from '../src/shared/ipc/pairing'

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
      '.modal, .pairing-modal__fingerprint')]
    return nodes.some(node => node.scrollWidth > node.clientWidth + 1)
  })
  expect(overflow).toBe(false)
  await page.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
}

test('startup rejection before a list waits for manual repair, cancels and re-pairs in a modal', async ({
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
    const recovery = page.getByRole('dialog', { name: 'Pair', exact: true })
    await expect(page.locator('.channel-list__host')).toHaveCount(2)
    await expect(page.locator('.channel-list__row-open')).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
    expect(rejectedFrames).toBeGreaterThan(0)
    await expect(page.getByRole('img', { name: 'Relay Connected', exact: true })).toHaveCount(2)
    await expect(recovery).toHaveCount(0)
    await expect(page.locator('.pairing')).toHaveCount(0)
    await expect(page.locator('.conversation')).toHaveCount(0)
    await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
    await expect(recovery).toBeVisible()
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
    await expect(page.getByRole('group', { name: 'Server key fingerprint', exact: true })).toBeVisible()
    await fits(page)
    await page.screenshot({ path: testInfo.outputPath('fingerprint-confirmation-800.png') })
    reject = false
    await page.getByRole('button', { name: 'Pair', exact: true }).click()
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

test('healthy host remains usable; last-host and repeated failures never navigate, even after re-pair', async ({
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
  await page.setViewportSize({ width: 1280, height: 800 })
  const [a, b] = servers
  a.daemon.pushFrame(rejection())
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
  await page.locator('.channel-list__row-open').filter({ hasText: 'Server two chat' }).click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await page.getByPlaceholder('Message…').fill('Hello healthy host')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Healthy host reply')
  expect(sends).toBe(1)
  // The composer entry targets A even though B was the last host to connect.
  await page.locator('.channel-list__row-open').filter({ hasText: 'Seeded discussion' }).click()
  await page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true }).click()
  await expect(page.getByText('Repair pairing: Alpha', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true }).getByText(NOTICE, { exact: true })).toBeVisible()
  await expect(page.locator('.channel-list__host')).toHaveCount(4)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.conversation')).toBeVisible()
  await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toBeVisible()
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  await page.locator('.channel-list__row-open').filter({ hasText: 'Server two chat' }).click()
  await page.getByPlaceholder('Message…').fill('Keep the current draft')
  b.daemon.pushFrame(rejection())
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(4)
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep the current draft')
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Healthy host reply')
  await expect(page.locator('.channel-list__host--failed')).toHaveCount(4)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('failed-host-thread-1280.png') })
  a.daemon.pushFrame(rejection())
  b.daemon.pushFrame(rejection())
  // A following visible frame is the barrier for the repeated failures.
  b.daemon.pushFrame(seedConversationsFrame({ ...SECOND_SEEDED_ROW, name: 'Failure barrier' }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Failure barrier' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep the current draft')
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Healthy host reply')
  await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(freshCode(a))
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  await expect(page.locator('.conversation')).toHaveCount(0)
  a.daemon.pushFrame(rejection())
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(4)
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.locator('.conversation')).toHaveCount(0)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([b.serverId, a.serverId])
  await page.locator('.settings__back').click()
  a.daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'Navigation barrier' }))
  await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Navigation barrier' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Repair host', exact: true })).toHaveCount(4)
})

for (const pendingState of ['connecting', 'unreported'] as const) {
  test(`thread navigation while a host is ${pendingState} survives it settling offline and manual repair cancellation`, async ({
    launchPairedApp
  }) => {
    const { app, page, servers: [a, b] } = await launchPairedApp({}, {
      hostLabel: 'Alpha', secondServer: { buildReply: () => seedConversationsFrame(SECOND_SEEDED_ROW) }
    })
    // Withhold B's status replay from the fresh renderer while retaining both real saved hosts.
    await app.evaluate(({ BrowserWindow, ipcMain }, { channel, serverId }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const send = contents.send.bind(contents)
      contents.send = (name, ...args) => {
        if (name === channel && args[0]?.serverId === serverId &&
          ['connecting', 'connected', 'disconnected', 'failed'].includes(args[0]?.type)) return
        send(name, ...args)
      }
      ipcMain.once('test:restore-status-delivery', () => { contents.send = send })
    }, { channel: DAEMON_EVENT_CHANNEL, serverId: b.serverId })
    await page.reload()
    await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
    await expect(page.getByRole('img', { name: 'Pyrycode Offline', exact: true })).toHaveCount(2)
    a.daemon.pushFrame(seedConversationsFrame())
    await expect(page.locator('.channel-list__row-open')).toHaveCount(1)
    await app.evaluate(({ ipcMain, BrowserWindow }, { channel, serverId, pendingState }) => {
      ipcMain.emit('test:restore-status-delivery')
      if (pendingState === 'connecting') {
        BrowserWindow.getAllWindows()[0].webContents.send(channel, { type: 'connecting', serverId })
      }
    }, { channel: DAEMON_EVENT_CHANNEL, serverId: b.serverId, pendingState })
    if (pendingState === 'connecting') {
      await expect(page.getByRole('img', { name: 'Pyrycode Connecting', exact: true })).toHaveCount(2)
    }
    a.daemon.pushFrame(rejection())
    await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
    const recovery = page.getByRole('dialog', { name: 'Pair', exact: true })
    await expect(recovery).toHaveCount(0)
    await page.locator('.channel-list__row-open').filter({ hasText: 'Seeded discussion' }).click()
    await expect(page.locator('.conversation')).toBeVisible()
    await page.getByPlaceholder('Message…').fill('Keep this thread')
    // B settles without ever reporting a successful connection to this renderer.
    await app.evaluate(({ BrowserWindow }, { channel, serverId }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, { type: 'disconnected', serverId })
    }, { channel: DAEMON_EVENT_CHANNEL, serverId: b.serverId })
    a.daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'Settled host barrier' }))
    await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Settled host barrier' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Pyrycode Offline', exact: true })).toHaveCount(2)
    await expect(recovery).toHaveCount(0)
    await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep this thread')
    await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
    await expect(page.getByText('Repair pairing: Alpha', { exact: true })).toBeVisible()
    await expect(page.locator('.channel-list__host')).toHaveCount(4)
    await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Settled host barrier' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.conversation')).toBeVisible()
    a.daemon.pushFrame(rejection())
    a.daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'Deferred failure barrier' }))
    await expect(page.locator('.channel-list__row-open').filter({ hasText: 'Deferred failure barrier' })).toBeVisible()
    await expect(recovery).toHaveCount(0)
    await expect(page.locator('.conversation')).toBeVisible()
    await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toBeVisible()
  })
}

for (const destination of ['healthy thread', 'other recovery'] as const) {
  test(`a delayed confirmation cannot replace a newer ${destination}`, async ({ launchPairedApp }) => {
    const { app, page, servers: [a, b] } = await launchPairedApp({}, {
      hostLabel: 'Alpha', secondServer: { buildReply: () => seedConversationsFrame(SECOND_SEEDED_ROW) }
    })
    a.daemon.pushFrame(rejection())
    await expect(page.getByRole('button', { name: 'Repair host', exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(freshCode(a))
    await page.getByRole('button', { name: 'Pair', exact: true }).click()
    // Wrap Electron's real handler in the test process only: save and reconnect still run,
    // but hold the confirmation reply so navigation can interleave deterministically.
    await app.evaluate(({ ipcMain }, channel) => {
      const handlers = (ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>>
      })._invokeHandlers
      const original = handlers.get(channel)
      if (!original) throw new Error('Pairing handler missing')
      const released = new Promise<void>(resolve => ipcMain.once('test:release-confirmation', () => resolve()))
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        const result = await original(event, request)
        if (request?.type === 'confirm') await released
        return result
      })
    }, PAIRING_CHANNEL)
    await page.getByRole('button', { name: 'Pair', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pair', exact: true })).toBeDisabled()
    // A notification is asynchronous navigation, independent of blocked background input.
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, { type: 'notificationActivated' })
    }, DAEMON_EVENT_CHANNEL)
    await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
    if (destination === 'healthy thread') {
      await page.locator('.channel-list__row-open').filter({ hasText: 'Server two chat' }).click()
      await page.getByPlaceholder('Message…').fill('Keep this newer draft')
    } else {
      b.daemon.pushFrame(rejection())
      const repairB = page.locator('.channel-list__host').filter({
        has: page.locator('.channel-list__host-label').filter({ hasText: /^Server$/ })
      }).getByRole('button', { name: 'Repair host', exact: true }).first()
      await repairB.click()
      await expect(page.getByText('Repair pairing: Server', { exact: true })).toBeVisible()
      await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill('Newer input')
    }
    // A's authorized save finishes even after leaving its flow. Its order is refreshed only
    // when the held confirmation reaches onPairServerPaired, providing a completion barrier.
    await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(
      destination === 'healthy thread' ? 4 : 2)
    await expect(page.locator('.channel-list__host-label').first()).toHaveText('Alpha')
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-confirmation') })
    await expect(page.locator('.channel-list__host-label').first()).toHaveText('Server')
    if (destination === 'healthy thread') {
      await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep this newer draft')
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    } else {
      await expect(page.getByText('Repair pairing: Server', { exact: true })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Pairing code', exact: true })).toHaveValue('Newer input')
    }
  })
}
