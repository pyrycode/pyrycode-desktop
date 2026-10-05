import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { RateLimitedPayload } from '../src/shared/wire/types'

test('thread overflow menu paints and receives clicks above Top overlay pills', async ({ launchPairedApp }) => {
  const { page, app, daemon } = await launchPairedApp()
  daemon.pushFrame(encodeEnvelope({
    id: 1,
    type: 'rate_limited',
    ts: '2026-07-07T12:00:00.000Z',
    payload: {
      conversation_id: SEEDED_ROW.id,
      status: 'allowed_warning',
      limit_type: 'seven_day',
      resets_at: 4_102_444_800,
      truncated_fields: null
    } satisfies RateLimitedPayload
  }))
  await expect(page.getByRole('button', { name: 'Dismiss usage notice', exact: true })).toBeVisible()
  const overlay = page.locator('.conversation__top-overlay')
  const pills = overlay.locator('.top-overlay-pill')
  await expect(pills).toHaveCount(1)

  for (const size of [
    { width: 1280, height: 800, kind: 'usage' },
    { width: 800, height: 600, kind: 'usage' },
    { width: 1280, height: 800, kind: 'connection' }
  ]) {
    await app.evaluate(({ BrowserWindow }, dimensions) => {
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height)
    }, size)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size.width)
    if (size.kind === 'connection') {
      // The rejection banner pushes a second pill below the popup. Test Re-pair on its own.
      await page.getByRole('button', { name: 'Dismiss usage notice', exact: true }).click()
      await expect(overlay).toHaveCount(0)
      daemon.pushFrame(encodeEnvelope({
        id: 2,
        type: 'error',
        ts: '2026-07-07T12:00:00.000Z',
        payload: { code: 'auth.invalid_token', message: 'Synthetic pairing rejection', retryable: false }
      }))
      await expect(page.getByRole('button', { name: 'Pairing error - Re-pair', exact: true })).toBeVisible()
      await expect(pills).toHaveCount(1)
    }
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'More actions', exact: true })
    await expect(menu).toBeVisible()
    await page.screenshot({ path: `/tmp/builder-1745/menu-${size.kind}-${size.width}.png`, animations: 'disabled' })

    // Positive overlap plus hit-testing proves paint order; visibility alone passes when covered.
    for (const pill of await pills.all()) {
      const overlap = await pill.evaluate((element) => {
        const menuElement = document.querySelector('.conversation__overflow [role="menu"]')
        if (menuElement === null) throw new Error('Overflow menu missing')
        const pillRect = element.getBoundingClientRect()
        const menuRect = menuElement.getBoundingClientRect()
        const left = Math.max(pillRect.left, menuRect.left)
        const right = Math.min(pillRect.right, menuRect.right)
        const top = Math.max(pillRect.top, menuRect.top)
        const bottom = Math.min(pillRect.bottom, menuRect.bottom)
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        return { width: right - left, height: bottom - top, menuReceivesHit: menuElement.contains(hit) }
      })
      expect(overlap.width).toBeGreaterThan(0)
      expect(overlap.height).toBeGreaterThan(0)
      expect(overlap.menuReceivesHit).toBe(true)
    }
    const anchorZ = await page.locator('.conversation__overflow .composer-options-anchor--bottom-end')
      .evaluate((element) => Number(getComputedStyle(element).zIndex))
    const overlayZ = await overlay.evaluate((element) => Number(getComputedStyle(element).zIndex))
    expect(anchorZ).toBeGreaterThan(overlayZ)

    // Click an item at a point inside the pill's box, through the real menu handler.
    const target = await menu.evaluate((element) => {
      const pillElement = document.querySelector('.conversation__top-overlay .top-overlay-pill')
      if (pillElement === null) throw new Error('Overlay pill missing')
      const pillRect = pillElement.getBoundingClientRect()
      for (const item of element.querySelectorAll('[role="menuitem"]')) {
        const rect = item.getBoundingClientRect()
        const left = Math.max(rect.left, pillRect.left)
        const right = Math.min(rect.right, pillRect.right)
        const top = Math.max(rect.top, pillRect.top)
        const bottom = Math.min(rect.bottom, pillRect.bottom)
        if (right > left && bottom > top) return { x: (left + right) / 2, y: (top + bottom) / 2 }
      }
      throw new Error('No menu item overlaps the overlay pill')
    })
    await page.mouse.click(target.x, target.y)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(menu).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pills).toHaveCount(1)
  }
})
