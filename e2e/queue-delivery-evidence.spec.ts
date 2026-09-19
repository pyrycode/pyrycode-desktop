import { join } from 'node:path'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { createQueueTurnEvidence } from './fixtures/queueTurnEvidence'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

type EvidenceWindow = typeof window & {
  queueTurnEvidence: Pick<ReturnType<typeof createQueueTurnEvidence>, 'snapshot'> & { stop: () => void }
}

// Verifies the live oracle's browser installation and real UI wiring; only the real-Claude
// scenarios can establish that a daemon actually drains the queue.
test('queue evidence follows a single user row through delivery in the built app', async ({ launchPairedApp }, testInfo) => {
  const sent: SendMessagePayload[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const frame = decodeEnvelope(bytes)
    if (frame.type === 'list_conversations') return [seedConversationsFrame()]
    if (frame.type === 'send_message') sent.push(frame.payload as SendMessagePayload)
    return []
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate(createQueueTurnEvidence, {
    conversationId: SEEDED_ROW.id, markers: ['FIRST_DONE', 'SECOND_DONE'], subscribe: true
  })
  const evidence = () => page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.snapshot([0, 1]))
  const push = (type: string, payload: Record<string, unknown>) => daemon.pushFrame(encodeEnvelope({
    id: 1, type, ts: '2026-09-19T12:00:00Z', payload: { conversation_id: SEEDED_ROW.id, ...payload }
  }))
  try {
    const composer = page.getByPlaceholder('Message…')
    await composer.fill('Start the first task')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(1)
    push('turn_state', { state: 'responding' })
    push('assistant_delta', { turn_id: 'first', seq: 1, text: 'The first task is running. ' })
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toBeVisible()
    await composer.fill('Follow-up task')
    await composer.press('Enter')
    await expect.poll(() => sent.length).toBe(2)
    push('queue_state', { queued: [{ queued_msg_id: 1, message_id: sent[1].message_id,
      text: sent[1].text, ts: '2026-09-19T12:00:00Z' }] })
    const queued = page.locator('.message-row--queued', { hasText: 'Follow-up task' })
    await expect(queued).toHaveCount(1)
    await expect(queued.getByRole('button', { name: 'Drop queued message' })).toBeVisible()
    await expect.poll(async () => (await evidence()).queuedMessageIds).toEqual([sent[1].message_id])
    await page.screenshot({ path: join('/tmp', 'builder-1522-queued.png'), animations: 'disabled' })
    push('queue_state', { queued: [] })
    await expect(queued).toHaveCount(0)
    expect((await evidence()).complete).toBe(false)
    push('assistant_delta', { turn_id: 'first', seq: 2, text: 'FIRST_DONE' })
    push('turn_end', { turn_id: 'first', stop_reason: 'end_turn', outcome: 'success' })
    push('assistant_delta', { turn_id: 'second', seq: 1, text: 'SECOND_' })
    push('assistant_delta', { turn_id: 'second', seq: 2, text: 'DONE' })
    push('turn_end', { turn_id: 'second', stop_reason: 'end_turn', outcome: 'success' })
    push('turn_state', { state: 'idle' })
    await expect.poll(async () => (await evidence()).complete).toBe(true)
    await expect(page.locator('[data-thread-role="user"]', { hasText: 'Follow-up task' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Drop queued message' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop the running turn' })).toHaveCount(0)
    expect(sent).toHaveLength(2)
    await page.screenshot({ path: join('/tmp', 'builder-1522-delivered.png'), animations: 'disabled' })
    testInfo.annotations.push({ type: 'visual-review', description: '1280x800; /tmp/builder-1522-{queued,delivered}.png' })
  } finally {
    await page.evaluate(() => (window as EvidenceWindow).queueTurnEvidence.stop())
  }
})
