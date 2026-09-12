import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, type PairedServerHandle } from './fixtures/launchPairedApp'
import { startFakeRelayForwarder } from '../src/main/transport/fakeRelayForwarder'
import { startFakeDaemonForTest } from './fixtures/fakeDaemonSetup'
import { PAIRING_CHANNEL } from '../src/shared/ipc/pairing'
import { DAEMON_EVENT_CHANNEL, type DaemonEvent } from '../src/shared/ipc/events'

const pending = 'Pairing saved. Waiting for the host to authenticate…'

function codeFor(server: PairedServerHandle, token = 'authentication-test-token'): string {
  return Buffer.from(JSON.stringify({ server: server.serverId,
    relay: `${server.forwarder.url}/v1/client`, token,
    server_static_pubkey: Buffer.from(server.daemon.staticPublicKey).toString('base64')
  })).toString('base64url')
}

// Keep the real save, registry and Noise handshake. Hold only the selected host's
// authentication delivery so another connected host cannot make the view pass early.
async function holdAuthentication(app: ElectronApplication, serverId: string, holdResponse = false) {
  await app.evaluate(({ ipcMain, BrowserWindow }, args) => {
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Function> })._invokeHandlers
    const original = handlers.get(args.pairing)!
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    let held: unknown
    let saves = 0
    let responses = 0
    let releaseResponse: (() => void) | undefined
    contents.send = (channel, ...values) => {
      const event = values[0]
      if (channel === args.events && event?.serverId === args.serverId && event.type === 'connected') {
        held = event
        return
      }
      send(channel, ...values)
    }
    ipcMain.removeHandler(args.pairing)
    ipcMain.handle(args.pairing, async (event, request) => {
      const result = await original(event, request)
      if (request.type === 'confirm' && result.ok) {
        saves++
        if (args.holdResponse) await new Promise<void>(resolve => { releaseResponse = resolve })
        responses++
      }
      return result
    })
    ipcMain.handle('test:authentication', (_event, command, event) => {
      if (command === 'authenticate' && held) send(args.events, held)
      if (command === 'response') releaseResponse?.()
      if (command === 'event') send(args.events, event)
      return { saves, responses, authenticated: held !== undefined }
    })
  }, { pairing: PAIRING_CHANNEL, events: DAEMON_EVENT_CHANNEL, serverId, holdResponse })
}

function control(app: ElectronApplication, command = 'counts', event?: DaemonEvent) {
  return app.evaluate(({ ipcMain }, { command, event }) => {
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Function> })._invokeHandlers
    return handlers.get('test:authentication')!(undefined, command, event) as {
      saves: number; responses: number; authenticated: boolean
    }
  }, { command, event })
}

async function confirm(page: Page, server: PairedServerHandle, onboarding = false) {
  await page.getByRole('textbox', { name: 'Pairing code', exact: true }).fill(codeFor(server))
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.getByRole('button', { name: onboarding ? 'Confirm' : 'Pair', exact: true }).click()
}

test('new host waits while the existing host is connected; timeout, Retry and one real save', async ({ launchPairedApp }) => {
  const { app, page } = await launchPairedApp()
  const forwarder = await startFakeRelayForwarder()
  const daemon = await startFakeDaemonForTest({ url: forwarder.url })
  const server = { forwarder, daemon, serverId: 'new-selected-host' }
  try {
    await holdAuthentication(app, server.serverId)
    await page.getByPlaceholder('Message…').fill('Retained draft')
    await page.getByRole('button', { name: 'Pair new host' }).first().click()
    await page.clock.install()
    await confirm(page, server)
    await expect(page.getByText(pending, { exact: true })).toBeVisible()
    await expect.poll(() => control(app)).toEqual({ saves: 1, responses: 1, authenticated: true })
    await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
    await page.setViewportSize({ width: 800, height: 600 })
    await page.screenshot({ path: '/private/tmp/builder-1366-pending-800.png' })
    await page.clock.runFor(30_000)
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await page.screenshot({ path: '/private/tmp/builder-1366-timeout-800.png' })
    await control(app, 'authenticate')
    // An authenticated host does not dismiss sticky failure without a user action.
    await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(4)
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
    await expect(page.locator('.conversation')).toHaveCount(0)
    expect((await control(app)).saves).toBe(1)
  } finally { await daemon.close(); await forwarder.close() }
})

test('manual repair waits for fresh authentication; rejection and cancellation retain the thread', async ({ launchPairedApp }) => {
  const { app, page, servers } = await launchPairedApp()
  const server = servers[0]
  await page.getByPlaceholder('Message…').fill('Preserved repair draft')
  server.forwarder.closeClientLeg(4401)
  await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await holdAuthentication(app, server.serverId)
  await confirm(page, server)
  await expect(page.getByText(pending, { exact: true })).toBeVisible()
  await expect.poll(() => control(app)).toEqual({ saves: 1, responses: 1, authenticated: true })
  await control(app, 'event', { type: 'failed', serverId: server.serverId,
    error: { code: 'pairing-rejected', message: 'private daemon detail', retryable: false } })
  const dialog = page.getByRole('dialog', { name: 'Pair', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('pair manually with a fresh code')
  await expect(dialog).not.toContainText('private daemon detail')
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/private/tmp/builder-1366-rejected-1280.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await control(app, 'authenticate')
  await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Preserved repair draft')
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1)
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await expect(page.getByRole('textbox', { name: 'Pairing code', exact: true })).toHaveValue('')
  await control(app, 'authenticate')
  await expect(page.getByRole('textbox', { name: 'Pairing code', exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Preserved repair draft')
})

test('onboarding catches authentication before the save response and navigates once', async ({ launchPairedApp }) => {
  const { app, page, servers } = await launchPairedApp({}, { skipPairing: true })
  await holdAuthentication(app, servers[0].serverId, true)
  await page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click()
  await confirm(page, servers[0], true)
  // First-handshake inspection can transiently lose its CDP execution context while
  // Electron remains alive. Retry only this read; action failures still fail immediately.
  await expect.poll(async () => {
    try { return await control(app) }
    catch (error) {
      if (error instanceof Error && error.message.includes('Execution context was destroyed')) return null
      throw error
    }
  }, { timeout: 5_000 }).toEqual({ saves: 1, responses: 0, authenticated: true })
  await control(app, 'authenticate')
  await expect(page.getByRole('button', { name: 'Confirming…', exact: true })).toBeDisabled()
  await control(app, 'response')
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1)
  await expect(page.locator('.pairing')).toHaveCount(0)
  await page.locator('.channel-list__row-open').click()
  await page.getByPlaceholder('Message…').fill('After onboarding')
  await control(app, 'authenticate')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('After onboarding')
})

test('post-save pending cancel invalidates completion and refreshes saved hosts', async ({ launchPairedApp }) => {
  const { app, page, servers } = await launchPairedApp({}, { secondServer: {} })
  await page.locator('.channel-list__row-open').first().click()
  await page.getByPlaceholder('Message…').fill('Keep this draft')
  await holdAuthentication(app, servers[0].serverId)
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await confirm(page, servers[0])
  await expect(page.getByText(pending, { exact: true })).toBeVisible()
  await expect.poll(() => control(app)).toEqual({ saves: 1, responses: 1, authenticated: true })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep this draft')
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await control(app, 'authenticate')
  await expect(page.getByRole('textbox', { name: 'Pairing code', exact: true })).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Keep this draft')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([servers[1].serverId, servers[0].serverId])
})


test('an identical same-host save cannot reuse the pre-confirmation connected status', async ({ launchPairedApp }) => {
  const { app, page, servers } = await launchPairedApp()
  await holdAuthentication(app, servers[0].serverId)
  await page.getByRole('button', { name: 'Pair new host' }).first().click()
  await page.getByRole('textbox', { name: 'Pairing code', exact: true })
    .fill(codeFor(servers[0], 'dummy-token-not-a-real-credential'))
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect.poll(() => control(app)).toEqual({ saves: 1, responses: 1, authenticated: false })
  await expect(page.getByText(pending, { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.conversation')).toBeVisible()
})

test('onboarding daemon absence is sticky; Retry and Cancel retain the saved host', async ({ launchPairedApp }) => {
  const { app, page, servers } = await launchPairedApp({}, { skipPairing: true })
  await holdAuthentication(app, servers[0].serverId)
  await page.getByRole('button', { name: 'I already have pyrycode', exact: true }).click()
  await confirm(page, servers[0], true)
  await expect(page.getByText(pending, { exact: true })).toBeVisible()
  await expect.poll(() => control(app)).toEqual({ saves: 1, responses: 1, authenticated: true })
  await control(app, 'event', { type: 'relayLinkChanged', serverId: servers[0].serverId, status: 'daemon-absent' })
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByText(pending, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'I already have pyrycode', exact: true })).toBeVisible()
  await control(app, 'authenticate')
  expect((await control(app)).saves).toBe(1)
  await expect(page.getByRole('button', { name: 'I already have pyrycode', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await window.pyry.serverInfo()).status)).toBe('available')
})
