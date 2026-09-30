import { test, expect } from './fixtures/launchPairedApp'

// The app-too-old close (#1613). Fatal in the client's DEFAULT_FATAL_CLOSE_CODES, so the supervised
// client stops re-dialling this host. A retryable close (1006) would have re-dialled within the
// first ~1 s backoff step, which is what the hold below would expose.
const UPDATE_REQUIRED_CLOSE_CODE = 4412

test('a host that rejects the app as too old stops re-dialling alone and reconnects on a manual retry', async ({
  launchPairedApp
}) => {
  const { page, servers } = await launchPairedApp({}, { secondServer: {} })
  const hosts = page.locator('.channel-list__host')
  await expect(hosts).toHaveCount(2)
  const firstHost = hosts.nth(0)
  const rejectedHost = hosts.nth(1)
  await expect(rejectedHost.locator('.channel-list__host-disclosure')).toHaveCount(1)
  await expect(firstHost.locator('.channel-list__host-disclosure')).toHaveCount(1)
  const firstCreate = page.locator('.channel-list__host-content').nth(0).getByRole('button', { name: 'Create chat', exact: true })
  const rejectedCreate = page.locator('.channel-list__host-content').nth(1).getByRole('button', { name: 'Create chat', exact: true })
  await expect(firstCreate).toHaveCount(1)
  await expect(rejectedCreate).toHaveCount(1)

  servers[1].forwarder.closeClientLeg(UPDATE_REQUIRED_CLOSE_CODE)
  await expect(rejectedHost).toHaveClass(/channel-list__host--failed/)
  await expect(rejectedHost.getByRole('button', { name: 'Repair host' })).toBeVisible()
  await expect(rejectedCreate).toHaveCount(0)
  // Well past the first backoff step (1 s ±20%): no automatic re-dial brings it back.
  await page.waitForTimeout(3_000)
  await expect(rejectedHost).toHaveClass(/channel-list__host--failed/)
  await expect(rejectedHost.getByRole('button', { name: 'Repair host' })).toBeVisible()
  // The other host keeps its own connection throughout.
  await expect(firstHost.locator('.channel-list__host-disclosure')).toHaveCount(1)
  await expect(firstHost).not.toHaveClass(/channel-list__host--failed/)
  await expect(firstCreate).toHaveCount(1)

  // The manual retry is the existing reconnect path; the fake daemon accepts, as an updated app would.
  await page.evaluate((serverId) => window.pyry.reconnectServer(serverId), servers[1].serverId)
  await expect(rejectedHost.locator('.channel-list__host-disclosure')).toHaveCount(1)
  await expect(rejectedHost).not.toHaveClass(/channel-list__host--failed/)
  await expect(rejectedHost.getByRole('button', { name: 'Repair host' })).toHaveCount(0)
  await expect(rejectedCreate).toHaveCount(1)
  await expect(firstHost.locator('.channel-list__host-disclosure')).toHaveCount(1)
  await expect(firstHost).not.toHaveClass(/channel-list__host--failed/)
})
