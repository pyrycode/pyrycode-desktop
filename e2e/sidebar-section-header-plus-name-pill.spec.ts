import { test, expect } from './fixtures/launchPairedApp'

test('toolbar controls show their existing name-pill treatment on hover and keyboard focus', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()
  const bar = page.locator('.channel-list__actions')
  const controls = bar.getByRole('button')
  await expect(controls).toHaveCount(3)

  for (const name of ['Settings', 'Archive', 'Pair new host']) {
    const control = bar.getByRole('button', { name, exact: true })
    const pill = control.locator('.channel-list__control-name')
    await page.mouse.move(0, 0)
    await expect(pill).toHaveCount(1)
    await expect(pill).toBeHidden()
    await control.hover()
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText(name)
    expect(await pill.evaluate(el => {
      const s = getComputedStyle(el)
      return [s.backgroundColor, s.color, s.fontWeight, s.fontSize, s.lineHeight,
        s.letterSpacing, s.borderTopLeftRadius, s.paddingTop, s.paddingLeft,
        s.position, s.pointerEvents]
    })).toEqual(['rgb(19, 74, 116)', 'rgb(207, 228, 255)', '400', '12px', '16px',
      '0.4px', '6px', '4px', '8px', 'fixed', 'none'])

    const box = await control.boundingBox()
    if (!box) throw new Error('missing toolbar control box')
    for (const offset of [4, 12]) {
      const x = Math.round(box.x + offset)
      const y = Math.round(box.y + offset)
      await page.mouse.move(x, y)
      const tooltip = await pill.boundingBox()
      if (!tooltip) throw new Error('missing tooltip box')
      expect(tooltip.x).toBeCloseTo(x + 12, 0)
      expect(tooltip.y).toBeCloseTo(y + 24, 0)
      expect(tooltip.y).toBeGreaterThanOrEqual(box.y + box.height)
      expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    }
    await bar.hover()
    await expect(pill).toBeHidden()
  }

  // Tab back from Archive to establish keyboard modality for the first control.
  await page.mouse.move(0, 0)
  await controls.nth(1).focus()
  await page.keyboard.press('Shift+Tab')
  for (const name of ['Settings', 'Archive', 'Pair new host']) {
    const control = bar.getByRole('button', { name, exact: true })
    const pill = control.locator('.channel-list__control-name')
    await expect(control).toBeFocused()
    await expect(pill).toBeVisible()
    expect(await control.evaluate(el => {
      const s = getComputedStyle(el)
      return [el.matches(':focus-visible'), s.outlineStyle, s.outlineWidth]
    })).toEqual([true, 'solid', '1px'])
    const box = await control.boundingBox()
    const tooltip = await pill.boundingBox()
    if (!box || !tooltip) throw new Error('missing focused tooltip geometry')
    expect(tooltip.x).toBeCloseTo(box.x + box.width + 12, 0)
    expect(tooltip.y).toBeCloseTo(box.y + box.height + 24, 0)
    await page.keyboard.press('Tab')
    await expect(pill).toBeHidden()
  }
  expect(await page.locator('.channel-list__tree').evaluate(el => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1)
})
