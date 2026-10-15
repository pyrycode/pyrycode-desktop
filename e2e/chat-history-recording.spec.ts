import { test, expect } from './fixtures/launchPairedApp'
import { installUnreadableLocalList } from './fixtures/localListFailure'

test('local list read failures stay beside the saved host', async ({ launchPairedApp }, testInfo) => {
  const { app, page, daemon, forwarder, servers } = await launchPairedApp()
  await daemon.close()
  await forwarder.close()
  // Confirm registration after ambiguous inspection loss; pairing and non-list storage stay intact.
  const setup = await installUnreadableLocalList(app)
  const result = await page.evaluate(serverId => window.pyry.chatHistory({ operation: 'readList', serverId }), servers[0].serverId)
  expect(result).toEqual({ status: 'error', code: 'unreadable' })
  await testInfo.attach('local-list-failure-setup', {
    body: JSON.stringify({ ...setup, result }), contentType: 'application/json'
  })
  await page.reload()
  await expect(page.locator('.channel-list__local-read-error')).toHaveCount(1)
  await expect(page.locator('.channel-list__local-read-error').first())
    .toHaveText('Could not read saved chats on this device.')
  const host = page.locator('.channel-list__host')
  await expect(host).toHaveCount(1)
  await expect(host.locator(':scope + .channel-list__local-read-error')).toHaveCount(1)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(0)
  await expect(page.locator('.conversation')).toHaveCount(0)
  await page.setViewportSize({ width: 800, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1794/local-error-800.png', animations: 'disabled' })
})
