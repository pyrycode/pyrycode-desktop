import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationsPayload } from '../src/shared/wire/types'

const ROW_COUNT = 40

for (const viewport of [{ width: 1100, height: 800 }, { width: 800, height: 600 }]) {
  test(`the sidebar hides its scrollbar and keeps wheel and focus scrolling at ${viewport.width}×${viewport.height}`, async ({
    launchPairedApp
  }) => {
    const { page, daemon } = await launchPairedApp()
    await page.setViewportSize(viewport)
    // Seed after launch: the pairing fixture opens its single initial row.
    await daemon.pushFrame(encodeEnvelope({
      id: 1,
      type: 'conversations',
      ts: '2026-07-07T12:00:00.000Z',
      payload: {
        conversations: Array.from({ length: ROW_COUNT }, (_, index) => ({
          ...SEEDED_ROW,
          id: `scroll-row-${index}`,
          name: `Sidebar row ${index + 1}`,
          is_promoted: index < ROW_COUNT / 2
        }))
      } satisfies ConversationsPayload
    }))

    const tree = page.locator('.channel-list__tree')
    const rows = tree.locator('.channel-list__row-open')
    const bar = page.locator('.channel-list__actions')
    await expect(rows).toHaveCount(ROW_COUNT)
    const barBefore = await bar.boundingBox()
    const scrollTop = (): Promise<number> => tree.evaluate((el) => el.scrollTop)
    const scrollbarPolicy = () => tree.evaluate((el) => ({
      overflow: getComputedStyle(el).overflowY,
      width: getComputedStyle(el).getPropertyValue('scrollbar-width'),
      fallback: getComputedStyle(el, '::-webkit-scrollbar').display
    }))
    expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    // Computed paint policy also detects overlay bars, whose gutter is already zero.
    expect(await scrollbarPolicy()).toEqual({ overflow: 'auto', width: 'none', fallback: 'none' })
    await expect(rows.first()).toBeInViewport({ ratio: 1 })
    await expect(rows.last()).not.toBeInViewport()

    const box = await tree.boundingBox()
    if (box === null) throw new Error('Expected a visible sidebar scrollport')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 120)
    await expect.poll(scrollTop).toBeGreaterThan(0)
    expect(await scrollbarPolicy()).toEqual({ overflow: 'auto', width: 'none', fallback: 'none' })
    await page.mouse.wheel(0, 100_000)
    await expect(rows.last()).toBeInViewport({ ratio: 1 })
    await page.mouse.wheel(0, -100_000)
    await expect.poll(scrollTop).toBe(0)
    await expect(rows.first()).toBeInViewport({ ratio: 1 })

    // Only the first row is focused programmatically; Tab must reveal every subsequent row.
    await rows.first().focus()
    const visitedRows = new Set([0])
    const buttonCount = await tree.locator('button').count()
    for (let step = 0; step < buttonCount; step += 1) {
      await page.keyboard.press('Tab')
      const index = await rows.evaluateAll((elements) => elements.indexOf(document.activeElement!))
      if (index >= 0) visitedRows.add(index)
      if (index === ROW_COUNT - 1) break
    }
    expect(visitedRows.size).toBe(ROW_COUNT)
    await expect(rows.last()).toBeFocused()
    await expect(rows.last()).toBeInViewport({ ratio: 1 })
    expect(await scrollTop()).toBeGreaterThan(0)
    expect(await bar.boundingBox()).toEqual(barBefore)
    expect(await scrollbarPolicy()).toEqual({ overflow: 'auto', width: 'none', fallback: 'none' })
  })
}
