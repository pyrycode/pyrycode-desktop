import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'

const ts = '2026-09-13T10:00:00.000Z'
const pageReply = (ask: Envelope, text: string, cursor: string) => encodeEnvelope({
  id: ask.id + 100, type: 'history_page', ts, in_reply_to: ask.id,
  payload: { entries: [{ id: ask.id, type: 'message', ts,
    payload: { conversation_id: SEEDED_ROW.id, message_id: `history-${ask.id}`, role: 'user', text }
  }], cursor, at_start: false }
})
const failedReply = (ask: Envelope, code: string) => encodeEnvelope({
  id: ask.id + 200, type: 'error', ts, in_reply_to: ask.id,
  payload: { code, message: 'Private daemon failure text' }
})

test('history failure supports explicit same-page Retry and preserves pending rows', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') asks.push(env)
    return []
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  const thread = page.locator('.conversation__thread')
  const failure = page.getByText('Could not load older messages', { exact: true })
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(1)
  daemon.pushFrame(pageReply(asks[0], 'Retained history row', 'opaque/cursor=='))
  await expect(thread.getByText('Retained history row', { exact: true })).toBeVisible()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(2)
  daemon.pushFrame(failedReply(asks[1], 'history.unavailable'))
  await expect(failure).toBeVisible()
  await expect(retry).toBeVisible()
  await expect(page.getByText('Private daemon failure text')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1401-retry-1280.png', animations: 'disabled' })
  await retry.click()
  await expect.poll(() => asks.length).toBe(3)
  expect(asks[2].payload).toEqual(asks[1].payload)
  expect(asks[2].payload).toEqual({ conversation_id: SEEDED_ROW.id, cursor: 'opaque/cursor==', limit: 0 })
  expect(asks[2].id).not.toBe(asks[1].id)
  await expect(failure).toHaveCount(0)
  await expect(retry).toHaveCount(0)
  await expect(thread.getByText('Retained history row', { exact: true })).toBeVisible()
  await thread.focus()
  for (const key of ['Home', 'ArrowUp', 'PageUp']) await page.keyboard.press(key)
  // The held response makes pending demand observable independently of renderer speed.
  await app.evaluate(() => {})
  expect(asks).toHaveLength(3)
  daemon.pushFrame(pageReply(asks[2], 'Recovered older row', 'next-cursor'))
  await expect(thread.getByText('Recovered older row', { exact: true })).toBeVisible()
  await expect(thread.getByText('Retained history row', { exact: true })).toBeVisible()
  await expect(failure).toHaveCount(0)
  await expect(thread.locator('.bubble')).toHaveCount(2)
  expect(asks).toHaveLength(3)

  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(4)
  expect(asks[3].payload.cursor).toBe('next-cursor')
  daemon.pushFrame(failedReply(asks[3], 'history.invalid_cursor'))
  await expect(failure).toBeVisible()
  await expect(retry).toHaveCount(0)
  await page.setViewportSize({ width: 800, height: 800 })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(failure).toBeInViewport()
  await page.screenshot({ path: '/tmp/builder-1401-nonretryable-800.png', animations: 'disabled' })
  // A fresh upward demand remains legal even after the nonretryable classification.
  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(5)
  expect(asks[4].payload).toEqual(asks[3].payload)
  daemon.pushFrame(pageReply(asks[4], 'Fresh demand recovered', 'last-cursor'))
  await expect(thread.getByText('Fresh demand recovered', { exact: true })).toBeVisible()
  await expect(failure).toHaveCount(0)
  expect(asks).toHaveLength(5)
})
