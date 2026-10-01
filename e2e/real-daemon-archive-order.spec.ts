import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { daemonIdentity } from './fixtures/daemonVersion'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

test.use({ spawnClaude: false, seedPromoted: true })

const FIRST = 'Archived first'
const SECOND = 'Archived second'
const ROUNDTRIP = 15_000

test('real daemon shows the second archived channel first, against last-used ascending order', async ({ relay, daemon, page }) => {
  test.setTimeout(120_000)
  const pyryBin = process.env.PYRY_BIN ?? 'pyry'
  const { stdout } = await promisify(execFile)(pyryBin, ['version'])
  const revision = daemonIdentity(stdout)
  console.log(`daemon-revision: ${revision}`)
  test.info().annotations.push({ type: 'daemon-revision', description: revision })

  await pairFromUnpairedLaunch(page, encodePairingPayload({
    ...daemon.pairFields, relay: `${relay.url}/v1/client`
  }))
  await expect(page.locator('.channel-list__rename')).toBeVisible({ timeout: 45_000 })
  await page.locator('.channel-list__rename').click()
  await page.locator('.edit-channel__input').fill(FIRST)
  await page.getByRole('dialog', { name: 'Edit channel', exact: true })
    .getByRole('button', { name: 'OK', exact: true }).click()
  await expect(page.locator('.channel-list__row-open').filter({ hasText: FIRST }))
    .toHaveText(FIRST, { timeout: ROUNDTRIP })

  await page.getByRole('button', { name: 'Create channel', exact: true }).click()
  await page.locator('.create-channel__input').fill(SECOND)
  await page.locator('.create-channel-overlay .modal__action--confirm').click()
  await expect(page.locator('.channel-list__row-open')).toHaveCount(2, { timeout: ROUNDTRIP })

  // The fixture owns this synthetic registry. Inspect only conversation metadata, never credentials.
  const registryPath = join(dirname(daemon.workdir), '.pyry', 'test', 'conversations.json')
  const registry = async (): Promise<{ id: string; name: string; last_used_at: string; archived_at?: string }[]> => {
    const saved = JSON.parse(await readFile(registryPath, 'utf8'))
    return saved.conversations
  }
  const before = await registry()
  const first = before.find((row) => row.name === FIRST)
  const second = before.find((row) => row.name === SECOND)
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  if (first === undefined || second === undefined) throw new Error('synthetic channels missing')
  expect(Date.parse(first.last_used_at)).toBeLessThan(Date.parse(second.last_used_at))

  await page.locator('.channel-list__row-open').filter({ hasText: FIRST }).click()
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
  await expect(page.locator('.conversation')).toHaveCount(1)
  await page.locator('.conversation').getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP })
  await page.locator('.channel-list__archive').click()
  await expect(page.getByRole('tab', { name: 'Channels (1)', exact: true })).toBeVisible()
  await expect(page.locator('.archive__row-title')).toHaveText(FIRST)
  // Positive completion of the first archive precedes issuing the second archive.
  await page.locator('.archive__back').click()
  await page.locator('.channel-list__row-open').filter({ hasText: SECOND }).click()
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
  await expect(page.locator('.conversation')).toHaveCount(1)
  await page.locator('.conversation').getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.locator('.conversation')).toHaveCount(0, { timeout: ROUNDTRIP })
  await page.locator('.channel-list__archive').click()
  await expect(page.getByRole('tab', { name: 'Channels (2)', exact: true })).toBeVisible()
  await expect(page.locator('.archive__row-title')).toHaveText([SECOND, FIRST])

  const after = await registry()
  const firstStamp = after.find((row) => row.id === first.id)?.archived_at
  const secondStamp = after.find((row) => row.id === second.id)?.archived_at
  // Missing prerequisite support must fail acceptance, not pass on a coincidental fallback order.
  expect(typeof firstStamp).toBe('string')
  expect(typeof secondStamp).toBe('string')
  if (firstStamp === undefined || secondStamp === undefined) throw new Error('daemon archive stamps missing')
  expect(Date.parse(firstStamp)).toBeLessThan(Date.parse(secondStamp))
  expect(after.filter((row) => row.id === first.id || row.id === second.id)
    .sort((a, b) => Date.parse(a.last_used_at) - Date.parse(b.last_used_at)).map((row) => row.name))
    .toEqual([FIRST, SECOND])
})
