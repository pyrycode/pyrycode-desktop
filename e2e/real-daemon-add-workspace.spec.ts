import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

test.use({ spawnClaude: false, seedPromoted: false })

// Dispatcher runs this with a dedicated daemon containing pyrycode#2378 and records
// its source revision plus execution result. This adds one real-tier test to the gate floor.
test('real daemon creates missing workspace parents and reuses the directory for another chat', async ({
  relay, daemon, page
}) => {
  test.setTimeout(120_000)
  // These filesystem paths come from the test-owned fixture, never from daemon output.
  const parent = join(daemon.workdir, 'add-workspace-parent')
  const destination = join(parent, 'nested-project')
  for (const path of [parent, destination]) {
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  await pairFromUnpairedLaunch(page, encodePairingPayload({
    server: daemon.pairFields.server,
    relay: relay.url + '/v1/client',
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  }))
  await expect(page.locator('.channel-list__row-open')).toHaveCount(1, { timeout: 45_000 })
  await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'nested-project' })).toHaveCount(0)
  let directoryIdentity: { dev: number; ino: number } | undefined
  const seed = await page.locator('.channel-list__row-open').elementHandle()
  if (seed === null) throw new Error('Seed row missing after readiness')
  let previousChat = seed
  for (const attempt of [1, 2]) {
    await previousChat.click()
    const host = page.locator('.channel-list__host').first()
    await host.hover()
    await host.locator('.channel-list__host-add').click()
    const dialog = page.getByRole('dialog', { name: 'Add workspace' })
    await dialog.getByRole('textbox', { name: 'Workspace folder on the host', exact: false }).fill(destination)
    await expect(dialog.locator('output')).toHaveText(destination)
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(page.locator('.channel-list__row-open')).toHaveCount(attempt + 1, { timeout: 15_000 })
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.channel-list__workspace-label').filter({ hasText: 'nested-project' })).toHaveCount(1)
    const active = page.locator('.channel-list__row-open[aria-current="true"]')
    await expect(active).toHaveText('Untitled')
    await expect.poll(() => active.evaluate((node, previous) => node === previous, previousChat)).toBe(false)
    const created = await active.elementHandle()
    if (created === null) throw new Error('Created chat missing after navigation')
    previousChat = created
    expect((await stat(parent)).isDirectory()).toBe(true)
    const folder = await stat(destination)
    expect(folder.isDirectory()).toBe(true)
    const identity = { dev: folder.dev, ino: folder.ino }
    if (directoryIdentity) expect(identity).toEqual(directoryIdentity)
    directoryIdentity = identity
  }
})
