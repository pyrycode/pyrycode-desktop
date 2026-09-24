import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { AssistantDeltaPayload, RateLimitedPayload, TurnEndPayload } from '../src/shared/wire/types'

const TS = '2026-07-07T12:00:00.000Z'

async function expectSpacing(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const thread = document.querySelector('.conversation__thread')
    const status = document.querySelector('.composer-status')
    const input = document.querySelector('.composer__row')
    if (!thread || !status || !input) return null
    return {
      above: status.getBoundingClientRect().top - thread.getBoundingClientRect().bottom,
      below: input.getBoundingClientRect().top - status.getBoundingClientRect().bottom,
      statusHeight: status.getBoundingClientRect().height
    }
  })).toEqual({ above: 12, below: 8, statusHeight: 24 })
}

test('status spacing stays outside the scrollport with a warning and five-line draft', async ({
  launchPairedApp
}, testInfo) => {
  const { page, app, daemon } = await launchPairedApp()
  for (let turn = 0; turn < 20; turn += 1) {
    daemon.pushFrame(encodeEnvelope({
      id: 1, type: 'assistant_delta', ts: TS,
      payload: {
        conversation_id: SEEDED_ROW.id, turn_id: `spacing-${turn}`, seq: 0,
        text: `Message ${turn + 1} keeps the conversation taller than the viewport.`
      } satisfies AssistantDeltaPayload
    }))
    daemon.pushFrame(encodeEnvelope({
      id: 1, type: 'turn_end', ts: TS,
      payload: {
        conversation_id: SEEDED_ROW.id, turn_id: `spacing-${turn}`, stop_reason: 'end_turn'
      } satisfies TurnEndPayload
    }))
  }
  const thread = page.locator('.conversation__thread')
  const input = page.locator('.composer__input')
  await expect(thread.locator('.bubble[data-thread-role="assistant"]')).toHaveCount(20)
  const distanceFromBottom = (): Promise<number> => thread.evaluate(
    el => el.scrollHeight - el.clientHeight - el.scrollTop
  )

  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 800)
    }, width)
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)

    for (const warning of [false, true]) {
      daemon.pushFrame(encodeEnvelope({
        id: 1, type: 'rate_limited', ts: TS,
        payload: {
          conversation_id: SEEDED_ROW.id,
          status: warning ? 'allowed_warning' : 'allowed', limit_type: 'seven_day',
          resets_at: 4_102_444_800, truncated_fields: null
        } satisfies RateLimitedPayload
      }))
      await expect(page.locator('.conversation__top-overlay .top-overlay-pill--default')).toHaveCount(warning ? 1 : 0)
      await input.fill(warning ? 'First line\nSecond line\nThird line\nFourth line\nFifth line' : '')
      await expect.poll(() => page.locator('.composer__row').evaluate(
        el => el.getBoundingClientRect().height
      )).toBe(warning ? 132 : 52)
      await expect.poll(() => thread.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(500)

      await thread.hover()
      await page.mouse.wheel(0, 100_000)
      await expect.poll(distanceFromBottom).toBeLessThan(1)
      await expectSpacing(page)
      // The fixed gap replaces the old bottom inset rather than doubling it.
      expect(await thread.evaluate(el => {
        const last = el.lastElementChild
        return last === null ? null : el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom
      })).toBe(0)
      if (warning) await page.screenshot({
        path: testInfo.outputPath(`status-${width}-bottom.png`), animations: 'disabled'
      })

      await page.mouse.wheel(0, -250)
      await expect.poll(distanceFromBottom).toBeGreaterThan(100)
      await expectSpacing(page)
      if (warning) await page.screenshot({
        path: testInfo.outputPath(`status-${width}-scrolled.png`), animations: 'disabled'
      })
    }
  }
})
