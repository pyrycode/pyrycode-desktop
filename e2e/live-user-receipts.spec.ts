import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

test('live user envelopes draw with daemon time and preserve one optimistic echo', async ({ launchPairedApp }, testInfo) => {
  const sent: SendMessagePayload[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    if (frame.type === 'list_conversations') return [seedConversationsFrame()]
    if (frame.type === 'send_message') sent.push(frame.payload as SendMessagePayload)
    return []
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  const ts = new Date(2026, 0, 13, 13, 55).toISOString()
  const push = (type: string, payload: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
    id: 77, type, ts, payload: { conversation_id: SEEDED_ROW.id, ...payload }
  }))
  const rows = page.locator('.message-row--user')
  const before = await rows.count()
  push('message', { message_id: 'phone-message', role: 'user', text: 'Sent from the phone' })
  const phone = rows.filter({ hasText: 'Sent from the phone' })
  await expect(phone).toHaveCount(1)
  await expect(rows).toHaveCount(before + 1)
  await expect(phone).toContainText('13.01.2026 - 13:55')
  await page.screenshot({ path: '/tmp/builder-1702-received.png', animations: 'disabled' })

  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Sent from this desktop')
  await composer.press('Enter')
  const echo = rows.filter({ hasText: 'Sent from this desktop' })
  await expect(echo).toHaveCount(1)
  await expect.poll(() => sent.length).toBe(1)
  const heldText = await echo.textContent()
  push('message', { message_id: sent[0].message_id, role: 'user', text: 'Conflicting receipt copy' })
  push('message', { message_id: 'phone-message', role: 'user', text: 'Duplicate phone copy' })
  // This positive effect follows both receipts through the same encrypted stream and UI bridge.
  push('assistant_delta', { turn_id: 'receipt-barrier', seq: 1, text: 'Receipt delivery observed' })
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Receipt delivery observed' })).toBeVisible()
  await expect(echo).toHaveCount(1)
  await expect(phone).toHaveCount(1)
  await expect(rows).toHaveCount(before + 2)
  expect(await echo.textContent()).toBe(heldText)
  await expect(page.getByText('Conflicting receipt copy', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1702-echo.png', animations: 'disabled' })
  testInfo.annotations.push({ type: 'visual-review', description: '1280x800; /tmp/builder-1702-{received,echo}.png' })
})
