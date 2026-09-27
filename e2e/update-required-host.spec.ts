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
  const firstDot = hosts.nth(0).locator('.channel-list__host-dot').first()
  const rejectedDot = hosts.nth(1).locator('.channel-list__host-dot').first()
  await expect(rejectedDot).toHaveAttribute('aria-label', 'Pyrycode Connected')

  servers[1].forwarder.closeClientLeg(UPDATE_REQUIRED_CLOSE_CODE)
  await expect(rejectedDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  // Well past the first backoff step (1 s ±20%): no automatic re-dial brings it back.
  await page.waitForTimeout(3_000)
  await expect(rejectedDot).toHaveAttribute('aria-label', 'Pyrycode Offline')
  // The other host keeps its own connection throughout.
  await expect(firstDot).toHaveAttribute('aria-label', 'Pyrycode Connected')

  // The manual retry is the existing reconnect path; the fake daemon accepts, as an updated app would.
  await page.evaluate((serverId) => window.pyry.reconnectServer(serverId), servers[1].serverId)
  await expect(rejectedDot).toHaveAttribute('aria-label', 'Pyrycode Connected')
  await expect(firstDot).toHaveAttribute('aria-label', 'Pyrycode Connected')
})
