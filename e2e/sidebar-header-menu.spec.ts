import { test, expect } from './fixtures/launchPairedApp'

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`sidebar header menu geometry and input at ${viewport.width}×${viewport.height}`, async ({ launchPairedApp }) => {
    const { page } = await launchPairedApp()
    await page.setViewportSize(viewport)
    const trigger = page.getByRole('button', { name: 'Sidebar menu', exact: true })
    const menu = page.getByRole('menu', { name: 'Sidebar menu', exact: true })
    const settings = menu.getByRole('menuitem', { name: 'Settings', exact: true })
    const archive = menu.getByRole('menuitem', { name: 'Archive', exact: true })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Pair new host' })).toBeVisible()
    await page.mouse.move(viewport.width - 10, viewport.height - 10)
    await page.screenshot({ path: `/tmp/builder-1732/closed-${viewport.width}.png` })
    await trigger.click()
    await settings.hover()
    await page.screenshot({ path: `/tmp/builder-1732/open-${viewport.width}.png` })
    await page.keyboard.press('Escape')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(settings).toBeFocused()
    await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Archive'])
    await expect(menu.locator('[aria-current]')).toHaveCount(0)
    const triggerBox = await trigger.boundingBox()
    const menuBox = await menu.boundingBox()
    expect(triggerBox).not.toBeNull()
    expect(menuBox).not.toBeNull()
    expect(triggerBox!.width).toBe(24)
    expect(triggerBox!.height).toBe(24)
    expect(menuBox!.width).toBe(160)
    expect(menuBox!.height).toBe(60)
    expect(menuBox!.x).toBe(triggerBox!.x - 4)
    expect(menuBox!.y).toBe(triggerBox!.y + triggerBox!.height + 32)
    for (const item of [settings, archive]) expect((await item.boundingBox())!.height).toBe(28)
    const toolbarBox = (await page.locator('.channel-list__actions').boundingBox())!
    const pairBox = (await page.getByRole('button', { name: 'Pair new host' }).boundingBox())!
    expect(triggerBox!.x).toBe(toolbarBox.x)
    expect(pairBox.x + pairBox.width).toBe(toolbarBox.x + toolbarBox.width)
    const glyphBox = (await trigger.locator('svg').boundingBox())!
    expect(glyphBox.width).toBe(6)
    expect(glyphBox.height).toBe(24)
    expect((await settings.boundingBox())!.y).toBe(menuBox!.y + 2)
    expect((await archive.boundingBox())!.y + 28).toBe(menuBox!.y + menuBox!.height - 2)
    const treeBox = (await page.locator('.channel-list__tree').boundingBox())!
    expect(menuBox!.y + menuBox!.height).toBeGreaterThan(treeBox.y)
    // Both rows occupy the tree's rectangle: prove the popup wins paint and hit testing.
    for (const item of [settings, archive]) {
      expect(await item.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
    }
    await page.keyboard.press('ArrowDown')
    await expect(archive).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(settings).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(archive).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()

    // Dismissal consumes a full pointer gesture before a host fold changes.
    const host = page.locator('.channel-list__host-disclosure')
    await trigger.click()
    const hostBox = (await host.boundingBox())!
    await page.mouse.click(hostBox.x + hostBox.width - 2, hostBox.y + hostBox.height / 2)
    await expect(menu).toHaveCount(0)
    await expect(host).toHaveAttribute('aria-expanded', 'true')
    await host.click()
    await expect(host).toHaveAttribute('aria-expanded', 'false')
    await host.click()

    // Start on the list so opening the seeded conversation is observable.
    await trigger.click()
    await settings.click()
    await page.locator('.settings__back').click()
    await expect(page.locator('.conversation')).toHaveCount(0)
    await trigger.click()
    const row = page.locator('.channel-list__row-open')
    const rowBox = (await row.boundingBox())!
    await page.mouse.click(rowBox.x + rowBox.width - 2, rowBox.y + rowBox.height / 2)
    await expect(menu).toHaveCount(0)
    await expect(page.locator('.conversation')).toHaveCount(0)
    await row.click()
    await expect(page.locator('.conversation')).toBeVisible()

    for (const key of ['Enter', 'Space']) {
      await trigger.focus()
      await page.keyboard.press(key)
      await expect(settings).toBeFocused()
      await page.keyboard.press(key)
      await expect(page.locator('section[aria-label="Settings screen"]')).toBeVisible()
      await expect(menu).toHaveCount(0)
      await page.locator('.settings__back').click()
      await trigger.focus()
      await page.keyboard.press(key)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press(key)
      await expect(page.locator('section[aria-label="Archive screen"]')).toBeVisible()
      await expect(menu).toHaveCount(0)
      await page.locator('.archive__back').click()
    }
    // Real clicks inside the overlapping popup reach each destination too.
    await trigger.click()
    await settings.click()
    await expect(page.locator('section[aria-label="Settings screen"]')).toBeVisible()
    await page.locator('.settings__back').click()
    await trigger.click()
    await archive.click()
    await expect(page.locator('section[aria-label="Archive screen"]')).toBeVisible()
  })
}
