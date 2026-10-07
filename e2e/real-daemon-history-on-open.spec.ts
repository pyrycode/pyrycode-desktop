import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { electron } from './fixtures/electronLaunch'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { e2eShowsWindow, expectDesktopIsolated, RENDERER_THROTTLING_SWITCHES } from './fixtures/desktopIsolation'
import { HIDDEN_WINDOW_ENV_FLAG } from '../src/main/windowPresentation'
import { LOOPBACK_RELAY_ENV_FLAG } from '../src/main/relayPolicy'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'

// Channel posts append daemon-owned assistant entries without starting a Claude turn.
// This acceptance uses real daemon storage and a fully exited, protected desktop profile.
test.use({ spawnClaude: false, seedPromoted: true })

test('a real daemon refreshes saved history with a channel post written while Electron is closed', async ({ relay, daemon }) => {
  test.setTimeout(150_000)
  const channel = `history-open-${Date.now()}`
  const baseline = `saved baseline ${Date.now()}`
  const marker = `closed desktop post ${Date.now()}`
  const post = async (text: string): Promise<void> => {
    try {
      await promisify(execFile)(process.env.PYRY_BIN ?? 'pyry', ['channel',
        `-pyry-socket=${join(dirname(daemon.workdir), '.pyry', 'test.sock')}`, 'post',
        '--name', channel, '--text', text], { timeout: 45_000 })
    } catch { throw new Error('channel post failed') } // Never print argv, payload or child output.
  }
  await withIsolatedElectronApp(async initial => {
    const { page, app, userDataDir } = initial
    await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
    await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: 45_000 })
    await page.locator('.channel-list__rename').click()
    await page.locator('.edit-channel__input').fill(channel)
    await page.getByRole('dialog', { name: 'Edit channel', exact: true })
      .getByRole('button', { name: 'OK', exact: true }).click()
    const row = page.locator('.channel-list__row-open').filter({ hasText: channel })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await post(baseline)
    await expect(page.locator('.conversation__thread .bubble').filter({ hasText: baseline })).toHaveCount(1)
    // Inspect only this fixture's synthetic conversation registry, never pairing credentials.
    const registry = JSON.parse(await readFile(join(dirname(daemon.workdir), '.pyry', 'test', 'conversations.json'), 'utf8'))
    const conversationId: string = registry.conversations.find((c: { name?: string }) => c.name === channel).id
    const savedText = () => page.evaluate(async ({ serverId, conversationId }) => {
      const result = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'timeline'
        ? result.snapshot.items.flatMap(item => 'text' in item ? [item.text] : []).join('\n') : ''
    }, { serverId: daemon.pairFields.server, conversationId })
    await expect.poll(savedText).toContain(baseline)
    await expect(page.locator('.bubble__cursor')).toHaveCount(0)
    // Establish served/display evidence for the baseline rather than legacy live-only rows.
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await page.locator('.archive__back').click()
    await row.click()
    await expect.poll(() => page.evaluate(async ({ serverId, conversationId }) => {
      const result = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId })
      return result.status === 'stored' && result.snapshot.kind === 'timeline'
        ? result.snapshot.served?.ids.length ?? 0 : 0
    }, { serverId: daemon.pairFields.server, conversationId })).toBeGreaterThan(0)
    expect(await savedText()).not.toContain(marker)
    await expect(page.locator('.conversation__thread .bubble').filter({ hasText: marker })).toHaveCount(0)
    const child = app.process()
    await app.close()
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true)
    // The unique post is created only after full process exit; it cannot be in the saved timeline.
    await post(marker)
    const env = { ...process.env, [LOOPBACK_RELAY_ENV_FLAG]: '1', [TEST_SECRET_BACKEND_ENV_FLAG]: '1' }
    delete env.ELECTRON_RENDERER_URL
    if (e2eShowsWindow()) delete env[HIDDEN_WINDOW_ENV_FLAG]
    else env[HIDDEN_WINDOW_ENV_FLAG] = '1'
    const reopened = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, ...RENDERER_THROTTLING_SWITCHES.map(name => `--${name}`)], env
    })
    try {
      await expectDesktopIsolated(reopened)
      await reopened.evaluate(({ ipcMain }) => {
        const proof = { asks: 0 }
        ;(globalThis as any).__openingHistoryProof = proof
        ipcMain.on('pyry:command', (_event, command) => { if (command.type === 'requestHistory') proof.asks++ })
      })
      const fresh = await reopened.firstWindow()
      await expect(fresh.locator('.channel-list__row-open').filter({ hasText: channel })).toBeVisible({ timeout: 45_000 })
      await fresh.locator('.channel-list__row-open').filter({ hasText: channel }).click()
      const thread = fresh.locator('.conversation__thread')
      await expect(thread.locator('.bubble').filter({ hasText: marker })).toHaveCount(1, { timeout: 20_000 })
      await expect(thread).toContainText(baseline)
      await expect.poll(() => reopened.evaluate(() => (globalThis as any).__openingHistoryProof.asks)).toBe(1)
      await fresh.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect(thread.locator('.bubble').filter({ hasText: marker })).toHaveCount(1)
    } finally { await reopened.close() }
  })
})
