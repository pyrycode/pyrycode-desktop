import type { Locator } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'

const geometry = (target: Locator) => target.evaluate(el => {
  const style = getComputedStyle(el)
  return {
    box: el.getBoundingClientRect().toJSON(),
    children: Array.from(el.children).filter(child => !child.matches('.channel-list__control-name'))
      .map(child => child.getBoundingClientRect().toJSON()),
    padding: style.padding, margin: style.margin, border: style.borderWidth
  }
})

const outline = (target: Locator) => target.evaluate(el => {
  const style = getComputedStyle(el)
  return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
})

for (const width of [1280, 800]) {
  test(`chrome hover preserves layout, pill fills and keyboard focus at ${width}px`, async ({ launchPairedApp }) => {
    const { page, app, daemon } = await launchPairedApp()
    await page.setViewportSize({ width, height: 800 })
    const paint = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--color-state-hover)'
      probe.style.backgroundImage = 'linear-gradient(var(--color-state-hover), var(--color-state-hover))'
      probe.style.color = 'var(--color-outline)'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = { hover: style.backgroundColor, image: style.backgroundImage, outline: style.color }
      probe.remove()
      return result
    })
    const park = () => page.mouse.move(width - 10, 790)
    const toolbar = page.locator('.channel-list__actions')
    const header = page.locator('.conversation__overflow')
    for (const selector of ['.conversation__overflow-trigger', '.channel-list__menu', '.channel-list__pair']) {
      const control = page.locator(selector)
      await park()
      const before = await geometry(control)
      const bars = [await toolbar.boundingBox(), await header.boundingBox()]
      await expect.poll(async () => {
        await control.hover()
        return control.evaluate(el => {
          const style = getComputedStyle(el, '::before')
          return {
            hovered: el.matches(':hover'), background: style.backgroundColor,
            inset: style.top, width: style.width, height: style.height,
            radius: style.borderRadius, pointer: style.pointerEvents
          }
        })
      }).toEqual({ hovered: true, background: paint.hover, inset: '-4px', width: '32px', height: '32px', radius: '6px', pointer: 'none' })
      expect(await geometry(control)).toEqual(before)
      expect([await toolbar.boundingBox(), await header.boundingBox()]).toEqual(bars)
      await capturePairedApp(app, page, `/tmp/builder-1866/${selector.slice(1)}-${width}.png`)
      await park()
      await page.keyboard.press('Tab')
      await control.focus()
      expect(await outline(control)).toEqual({ style: 'solid', width: '1px', color: paint.outline })
      expect(await control.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
    }

    daemon.pushFrame(encodeEnvelope({ id: 50, type: 'rate_limited', ts: '2026-10-07T00:00:00Z',
      payload: { conversation_id: SEEDED_ROW.id, status: 'allowed_warning', limit_type: 'five_hour', resets_at: 4102444800, truncated_fields: null } }))
    const warning = page.locator('.top-overlay-pill--default')
    await expect(warning).toBeVisible()
    daemon.pushFrame(encodeEnvelope({ id: 51, type: 'error', ts: '2026-10-07T00:00:00Z',
      payload: { code: 'auth.invalid_token', message: 'Synthetic pairing rejection', retryable: false } }))
    const repair = page.locator('button.top-overlay-pill')
    await expect(repair).toBeVisible()
    for (const [pill, focusTarget, name] of [
      [warning, warning.locator('button'), 'warning'], [repair, repair, 'repair']
    ] as const) {
      await park()
      await page.keyboard.press('Tab')
      await focusTarget.focus()
      const focusBefore = await outline(focusTarget)
      expect(focusBefore.style).not.toBe('none')
      expect(focusBefore.width).not.toBe('0px')
      const fill = await pill.evaluate(el => getComputedStyle(el).backgroundColor)
      const before = await geometry(pill)
      await expect.poll(async () => {
        await pill.hover()
        return pill.evaluate(el => ({ hovered: el.matches(':hover'), image: getComputedStyle(el).backgroundImage }))
      }).toEqual({ hovered: true, image: paint.image })
      expect(await pill.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(fill)
      expect(await geometry(pill)).toEqual(before)
      expect(await outline(focusTarget)).toEqual(focusBefore)
      await capturePairedApp(app, page, `/tmp/builder-1866/${name}-${width}.png`)
      await park()
      expect(await pill.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none')
    }

    // A non-dismissible notice has no action and must not acquire an interactive layer.
    daemon.pushFrame(encodeEnvelope({ id: 52, type: 'rate_limited', ts: '2026-10-07T00:00:00Z',
      payload: { conversation_id: SEEDED_ROW.id, status: 'rejected', limit_type: 'five_hour', resets_at: 4102444800, truncated_fields: null } }))
    const inert = page.locator('div.top-overlay-pill--error')
    await expect(inert).toBeVisible()
    await inert.hover()
    expect(await inert.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none')
  })
}
