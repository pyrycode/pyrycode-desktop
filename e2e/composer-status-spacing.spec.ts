import type { Page, TestInfo } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { AssistantDeltaPayload, RateLimitedPayload, TurnEndPayload } from '../src/shared/wire/types'

const TS = '2026-07-07T12:00:00.000Z'

async function expectSpacing(page: Page, testInfo: TestInfo, warning: boolean, bottom: boolean): Promise<void> {
  const observations: unknown[] = []
  try {
    await expect.poll(async () => {
      const observation = await page.evaluate(async () => {
        const read = () => {
          const thread = document.querySelector('.conversation__thread')
          const status = document.querySelector('.composer-status')
          const input = document.querySelector('.composer__row')
          const chrome = document.querySelector('.conversation__input-chrome')
          const last = thread?.lastElementChild
          if (!thread || !status || !input || !chrome || !last) return null
          return {
            above: status.getBoundingClientRect().top - chrome.getBoundingClientRect().top,
            below: input.getBoundingClientRect().top - status.getBoundingClientRect().bottom,
            statusHeight: status.getBoundingClientRect().height,
            clearance: parseFloat(getComputedStyle(thread).paddingBottom) - chrome.getBoundingClientRect().height,
            paneBottom: thread.getBoundingClientRect().bottom - chrome.getBoundingClientRect().bottom,
            inputHeight: input.getBoundingClientRect().height,
            newestClearance: chrome.getBoundingClientRect().top - last.getBoundingClientRect().bottom,
            top: thread.scrollTop, content: thread.scrollHeight, viewport: thread.clientHeight,
            width: innerWidth, height: innerHeight,
            hoveredRows: document.querySelectorAll('.message-row:hover').length,
            focus: document.activeElement?.className
          }
        }
        // Native wheel delivery and metadata reflow can outlive a successful bottom poll.
        // Observe both sides of a frame so the endpoint and chrome describe settled geometry.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const previous = read()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const current = read()
        return { previous, current, stable: JSON.stringify(previous) === JSON.stringify(current) }
      })
      observations.push(observation)
      const current = observation.current
      if (!current) return null
      const distance = current.content - current.viewport - current.top
      return {
        above: current.above, below: current.below, statusHeight: current.statusHeight,
        clearance: current.clearance, paneBottom: current.paneBottom,
        inputHeight: current.inputHeight, overflow: current.content - current.viewport > 500,
        position: bottom ? distance < 1 : distance > 100,
        newestClearance: bottom ? current.newestClearance : undefined, stable: observation.stable
      }
    }).toEqual({ above: 16, below: 8, statusHeight: 24, clearance: 0, paneBottom: 0,
      inputHeight: warning ? 132 : 52, overflow: true, position: true,
      newestClearance: bottom ? 0 : undefined, stable: true })
  } finally {
    await testInfo.attach(`spacing-${warning ? 'draft' : 'empty'}-${bottom ? 'bottom' : 'scrolled'}`, {
      contentType: 'application/json', body: JSON.stringify(observations)
    })
  }
}

test('status spacing and measured input clearance hold with a warning and five-line draft', async ({
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
  await expect(thread.locator('[data-thread-role="assistant"]')).toHaveCount(20)
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
      await expectSpacing(page, testInfo, warning, true)
      // Exercise the demonstrated late metadata reflow after the original bottom observation.
      {
        const observation = await thread.evaluate(el => {
          el.lastElementChild?.querySelector<HTMLElement>('button')?.focus()
          const chrome = document.querySelector('.conversation__input-chrome')!
          return { top: el.scrollTop, content: el.scrollHeight, viewport: el.clientHeight,
            clearance: chrome.getBoundingClientRect().top - el.lastElementChild!.getBoundingClientRect().bottom }
        })
        await testInfo.attach('late-focus', { contentType: 'application/json', body: JSON.stringify(observation) })
        await expectSpacing(page, testInfo, warning, true)
        await testInfo.attach('settled-focus', { contentType: 'application/json', body: JSON.stringify(await thread.evaluate(el => {
          const chrome = document.querySelector('.conversation__input-chrome')!
          return { top: el.scrollTop, content: el.scrollHeight, viewport: el.clientHeight,
            clearance: chrome.getBoundingClientRect().top - el.lastElementChild!.getBoundingClientRect().bottom,
            focused: el.lastElementChild!.contains(document.activeElement) }
        })) })
        await expect(thread.locator(':scope > :last-child button').first()).toBeFocused()
      }
      if (warning) await page.screenshot({
        path: testInfo.outputPath(`status-${width}-bottom.png`), animations: 'disabled'
      })

      await page.mouse.wheel(0, -250)
      await expect.poll(distanceFromBottom).toBeGreaterThan(100)
      await expectSpacing(page, testInfo, warning, false)
      if (warning) await page.screenshot({
        path: testInfo.outputPath(`status-${width}-scrolled.png`), animations: 'disabled'
      })
    }
  }
})
