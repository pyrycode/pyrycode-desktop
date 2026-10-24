import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

test('live user envelopes draw with daemon time and preserve one optimistic echo', async ({ launchPairedApp }, testInfo) => {
  const sent: SendMessagePayload[] = []
  const requests: Envelope[] = []
  const ts = new Date(2026, 0, 13, 13, 55).toISOString()
  const summary = { ...SEEDED_ROW, current_session_id: 'receipt-session' }
  const epoch = 'receipt-epoch'
  const route = { conversation_id: summary.id, epoch }
  let version = 1
  const item = (id: number, kind: string, content: Record<string, unknown>): ThreadItem => ({
    id, order: id * 10, rev: 1, kind, status: kind === 'user_message' ? 'delivered' : 'done', active: false, shown: true,
    summary: '', session: summary.current_session_id, content: { ...content, ts }
  })
  const opening = item(1, 'assistant_message', { text: 'Canonical receipt thread ready' })
  const thread = createCanonicalThread({ conversations: [{ summary, epoch, version, items: [opening] }] })
  // Native preserves deliberate duplicate full-item bytes; valid facts/replies still use the publisher.
  const { page, daemon } = await launchPairedApp({ threadMode: 'native', buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    requests.push(frame)
    if (frame.type === 'send_message') sent.push(frame.payload as SendMessagePayload)
    return thread.reply(bytes, [])
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Canonical receipt thread ready' })).toBeVisible()
  expect(requests).toContainEqual(expect.objectContaining({ type: 'thread_catch_up',
    payload: expect.objectContaining({ conversation_id: summary.id, version: 0 }) }))
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw new Error(identity.error)
  const push = (update: ThreadUpdate) => {
    for (const bytes of thread.publish(encodeEnvelope({ id: 77, ts, ...update }))) daemon.pushFrame(bytes)
  }
  const add = (fact: ThreadItem) => push({ type: 'thread_item_added', payload: { ...route, version: ++version, item: fact } })
  const rows = page.locator('.message-row--user')
  const before = await rows.count()
  const peer = item(2, 'user_message', { device_id: 'phone-device', message_id: 'phone-message', text: 'Sent from the phone' })
  add(peer)
  const phone = rows.filter({ hasText: 'Sent from the phone' })
  await expect(phone).toHaveCount(1)
  await expect(rows).toHaveCount(before + 1)
  await expect(phone).toContainText('13.01.2026 - 13:55')
  await page.screenshot({ path: '/tmp/builder-2249/received.png', animations: 'disabled' })

  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Sent from this desktop')
  await composer.press('Enter')
  const echo = rows.filter({ hasText: 'Sent from this desktop' })
  await expect(echo).toHaveCount(1)
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0].conversation_id).toBe(summary.id)
  expect(sent[0].message_id).toEqual(expect.any(String))
  const acceptedText = 'Sent from this desktop — daemon accepted'
  const activity = item(3, 'assistant_message', { text: 'Assistant activity before user acceptance' })
  add(activity)
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Assistant activity before user acceptance' })).toBeVisible()
  await expect(echo).toHaveCount(1)
  await expect(rows).toHaveCount(before + 2)
  await expect(echo).toContainText('Sent from this desktop')
  await expect(rows.filter({ hasText: acceptedText })).toHaveCount(0)
  await expect(echo).not.toContainText('13.01.2026 - 13:55')

  const accepted = item(4, 'user_message', { device_id: identity.deviceId,
    message_id: sent[0].message_id, text: 'Sent from this desktop — daemon processing' })
  add(accepted)
  await expect(echo).toContainText('Sent from this desktop — daemon processing')
  await expect(rows).toHaveCount(before + 2)
  const acceptedContent = { device_id: identity.deviceId, message_id: sent[0].message_id, text: acceptedText, ts }
  push({ type: 'thread_item_changed', payload: { ...route, version: ++version,
    item_id: accepted.id, base_rev: accepted.rev, rev: 2, changes: { content: acceptedContent } } })
  const held = { ...accepted, rev: 2, content: acceptedContent }
  await expect(echo).toContainText(acceptedText)
  await expect(echo).toContainText('13.01.2026 - 13:55')

  // Advancing delivery versions ensure these reach item-revision handling, not stale-envelope rejection.
  // The publisher deliberately rejects duplicate authoring, so deliver these exact-wire controls directly.
  for (const fact of [held, held, peer, peer,
    { ...held, content: { ...acceptedContent, text: 'Conflicting receipt copy', ts: '2025-01-01T00:00:00Z' } },
    { ...held, rev: 1, content: { ...acceptedContent, text: 'Older receipt copy' } },
    { ...peer, content: { device_id: 'phone-device', message_id: 'phone-message', text: 'Duplicate phone copy', ts } }]) {
    daemon.pushFrame(encodeEnvelope({ id: 77, ts, type: 'thread_item_added',
      payload: { ...route, version: ++version, item: fact } }))
  }
  thread.setConversation({ summary, epoch, version, items: [opening, peer, activity, held] })
  // This positive effect follows every receipt through the same encrypted stream and UI bridge.
  add(item(5, 'assistant_message', { text: 'Receipt delivery observed' }))
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Receipt delivery observed' })).toBeVisible()
  await expect(echo).toHaveCount(1)
  await expect(phone).toHaveCount(1)
  await expect(rows).toHaveCount(before + 2)
  await expect(echo).toContainText('13.01.2026 - 13:55')
  await expect(echo).toContainText('Sent from this desktop')
  await expect(echo).toContainText(acceptedText)
  await expect(phone).toContainText('13.01.2026 - 13:55')
  await expect(page.getByText('Conflicting receipt copy', { exact: true })).toHaveCount(0)
  await expect(rows.filter({ hasText: /Conflicting receipt copy|Older receipt copy|Duplicate phone copy/ })).toHaveCount(0)
  expect(requests.map(request => request.type)).not.toContain('request_history')
  await page.screenshot({ path: '/tmp/builder-2249/echo.png', animations: 'disabled' })
  testInfo.annotations.push({ type: 'visual-review', description: '1280x800; /tmp/builder-2249/{received,echo}.png' })
})
