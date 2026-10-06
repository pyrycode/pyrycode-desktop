import { test, expect } from './fixtures/launchPairedApp'

test('toolbar controls show their existing name-pill treatment on hover and keyboard focus', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()
  const bar = page.locator('.channel-list__actions')
  const controls = bar.getByRole('button')
  await expect(controls).toHaveCount(2)
  const menu = bar.getByRole('button', { name: 'Sidebar menu', exact: true })
  const control = bar.getByRole('button', { name: 'Pair new host', exact: true })
  const pill = control.locator('.channel-list__control-name')
  await expect(menu).toBeVisible()

  await page.mouse.move(0, 0)
  await expect(pill).toHaveCount(1)
  await expect(pill).toBeHidden()
  await control.hover()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('Pair new host')
  expect(await pill.evaluate(el => {
    const s = getComputedStyle(el)
    return [s.backgroundColor, s.color, s.fontWeight, s.fontSize, s.lineHeight,
      s.letterSpacing, s.borderTopLeftRadius, s.paddingTop, s.paddingLeft,
      s.position, s.pointerEvents]
  })).toEqual(['rgb(19, 74, 116)', 'rgb(207, 228, 255)', '400', '12px', '16px',
    '0.4px', '6px', '4px', '8px', 'fixed', 'none'])

  const hoverBox = await control.boundingBox()
  if (!hoverBox) throw new Error('missing toolbar control box')
  for (const offset of [4, 12]) {
    const x = Math.round(hoverBox.x + offset)
    const y = Math.round(hoverBox.y + offset)
    await page.mouse.move(x, y)
    const tooltip = await pill.boundingBox()
    if (!tooltip) throw new Error('missing tooltip box')
    expect(tooltip.x).toBeCloseTo(x + 12, 0)
    expect(tooltip.y).toBeCloseTo(y + 24, 0)
    expect(tooltip.y).toBeGreaterThanOrEqual(hoverBox.y + hoverBox.height)
    expect(tooltip.x + tooltip.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  }
  await bar.hover()
  await expect(pill).toBeHidden()

  // Tab through the two-control toolbar to establish keyboard modality.
  await page.mouse.move(0, 0)
  await control.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(menu).toBeFocused()
  await expect(pill).toBeHidden()
  await page.keyboard.press('Tab')
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
  expect(await page.locator('.channel-list__tree').evaluate(el => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1)
})
