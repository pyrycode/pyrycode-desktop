import { test, expect } from './fixtures/launchPairedApp'

test('host hover reveals Edit host while retaining connection status and no workspace action', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp()
  const host = page.locator('.channel-list__host')
  const edit = host.getByRole('button', { name: 'Edit host' })
  const dots = host.locator('.channel-list__host-status')
  await expect(host).toHaveCount(1)
  await expect(edit).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Add workspace' })).toHaveCount(0)
  await expect(dots).toHaveCSS('opacity', '1')
  await host.hover()
  await expect(edit).toHaveCSS('opacity', '1')
  await expect(dots).toHaveCSS('opacity', '0')
  await edit.click()
  await expect(page.getByRole('dialog', { name: 'Edit host' })).toBeVisible()
})
