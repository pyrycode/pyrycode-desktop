import { test, expect } from './fixtures/launchPairedApp'
import { MAX_HOST_LABEL_LENGTH } from '../src/shared/ipc/pairing'
import type { Locator } from '@playwright/test'

const HOST_LABEL = 'Pyrybox-'.repeat(MAX_HOST_LABEL_LENGTH / 8)
const GEOMETRY_TOLERANCE_PX = 1

type Box = { x: number; y: number; width: number; height: number }
const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('expected a laid-out host row element')
  return box
}

test('the long host label truncates before the fixed disclosure and Edit control', async ({ launchPairedApp }, testInfo) => {
  const { page } = await launchPairedApp({}, { hostLabel: HOST_LABEL })
  const hostRows = page.locator('.channel-list__host')
  await expect(hostRows).toHaveCount(1)
  const host = hostRows.first()
  const label = host.locator('.channel-list__host-label')
  const disclosure = host.locator('.channel-list__host-disclosure')
  const chevron = host.locator('.channel-list__host-chevron')
  const edit = host.getByRole('button', { name: 'Edit host' })
  // Compare lengths to avoid echoing operator content in failure output.
  await expect.poll(async () => ((await label.textContent()) ?? '').length).toBe(MAX_HOST_LABEL_LENGTH)
  await expect.poll(() => label.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(label).toHaveCSS('text-overflow', 'ellipsis')
  await expect.poll(async () => (await page.locator('.paired-shell__sidebar').boundingBox())?.width).toBe(400)
  const before = await Promise.all([host, label, disclosure, chevron, edit].map(boxOf))
  const [rowBox, labelBox, disclosureBox, chevronBox, editBox] = before
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(chevronBox.x)
  expect(disclosureBox.x + disclosureBox.width).toBeLessThanOrEqual(editBox.x)
  expect(chevronBox.x + chevronBox.width).toBeLessThanOrEqual(editBox.x)
  expect(Math.abs(rowBox.x + rowBox.width - editBox.x - editBox.width - 25)).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX)
  await expect(host.locator('.channel-list__host-status, .channel-list__host-dot')).toHaveCount(0)
  await host.hover()
  await expect(edit).toHaveCSS('opacity', '1')
  expect(await Promise.all([host, label, disclosure, chevron, edit].map(boxOf))).toEqual(before)
  await expect(host.locator('.channel-list__host-status, .channel-list__host-dot')).toHaveCount(0)
  await expect(page.locator('.channel-list__host[title], .channel-list__host [title]')).toHaveCount(0)
  await expect(page.locator('section[aria-label="Settings screen"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('host-long-label.png'), animations: 'disabled' })
})
