import { test, expect } from './fixtures/launchPairedApp'

test('toolbar pairing returns to its origin and trigger without losing the conversation draft', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()
  const thread = page.locator('.conversation')
  const list = page.locator('section[aria-label="Conversations"]')
  const settings = page.locator('section[aria-label="Settings screen"]')
  const pairingField = page.locator('[aria-label="Pairing code"]')
  const pair = page.getByRole('button', { name: 'Pair new host' })
  const draft = page.getByPlaceholder('Message…')

  await expect(thread).toBeVisible()
  await expect(list).toBeVisible()
  await expect(pair).toHaveCount(1)
  await expect(pair).toBeVisible()
  await expect(page.locator('.channel-list__section-header')).toHaveCount(0)
  await expect(page.locator('.channel-list__tree .channel-list__pair')).toHaveCount(0)
  await draft.fill('Retain this draft')

  for (const key of ['Enter', 'Space']) {
    await pair.focus()
    await page.keyboard.press(key)
    await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toBeVisible()
    await expect(pairingField).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused()
    if (key === 'Enter') await page.keyboard.press('Escape')
    else await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pairingField).toHaveCount(0)
    await expect(pair).toBeFocused()
    await expect(thread).toBeVisible()
    await expect(draft).toHaveValue('Retain this draft')
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).press('Enter')
  await expect(settings).toBeVisible()
  await page.locator('.settings__back').click()
  await expect(list).toBeVisible()
  await expect(thread).toHaveCount(0)

  for (const cancel of ['Cancel', 'Escape']) {
    await pair.click()
    await expect(pairingField).toBeVisible()
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    else await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pairingField).toHaveCount(0)
    await expect(list).toBeVisible()
    await expect(thread).toHaveCount(0)
    await expect(pair).toBeFocused()
  }

  await page.getByRole('button', { name: 'Archive', exact: true }).press('Space')
  await expect(page.locator('section[aria-label="Archive screen"]')).toBeVisible()
  await page.locator('.archive__back').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settingsPair = page.getByRole('button', { name: 'Pair another server' })
  for (const cancel of ['Cancel', 'Escape']) {
    await settingsPair.click()
    await expect(pairingField).toBeVisible()
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    else await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(pairingField).toHaveCount(0)
    await expect(settings).toBeVisible()
    await expect(settingsPair).toBeFocused()
  }
})
