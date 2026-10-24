import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { createCanonicalThread } from './fixtures/canonicalThread'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload, WireTurnState } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

// Mounted actions retain the real composer/IPC/Noise path. Only authored daemon
// facts accept messages, remove queued rows or settle a running turn.
const ROUNDTRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-07-07T12:00:00.000Z'
const SESSION = 'queue-interrupt-session'
const route = { conversation_id: SEEDED_ROW.id, epoch: 'queue-interrupt-epoch' }
const DELIVERED_TEXT = 'A delivered user message'
const QUEUED_A = { queued_msg_id: 1, text: 'First queued task', ts: FIXED_TS }
const QUEUED_B = { queued_msg_id: 2, text: 'Second queued task', ts: FIXED_TS,
  message_id: 'an-id-no-echo-in-this-window-carries' }
const frame = (update: ThreadUpdate): Uint8Array => encodeEnvelope({ id: 1, ts: FIXED_TS, ...update })

function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({ id: 1, type: 'turn_state', ts: FIXED_TS, session_id: SESSION,
    payload: { conversation_id: SEEDED_ROW.id, state } })
}

function sentMessageId(captured: Envelope[], text: string): string | undefined {
  const sent = captured.find(e => e.type === 'send_message' && (e.payload as SendMessagePayload).text === text)
  return sent === undefined ? undefined : (sent.payload as SendMessagePayload).message_id
}

test('queued backlog renders distinctly, drops a queued message, and interrupts a running turn', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const opening: ThreadItem = { id: 10, order: 10, rev: 1, kind: 'assistant_message',
    status: 'finished', active: false, shown: true, summary: '', session: SESSION,
    content: { text: 'Queue actions ready' } }
  const thread = createCanonicalThread({ conversations: [{ summary: { ...SEEDED_ROW,
    current_session_id: SESSION }, epoch: route.epoch, version: 1, items: [opening] }] })
  const { page, daemon } = await launchPairedApp({ threadMode: 'canonical', thread,
    helloAck: { capabilities: ['interactive', 'thread'] }, buildReplyFrames: bytes => {
      captured.push(decodeEnvelope(bytes)); return []
    } })
  await expect(page.getByText('Queue actions ready', { exact: true })).toBeVisible()
  expect(captured.find(e => e.type === 'thread_catch_up')?.payload).toMatchObject({
    conversation_id: SEEDED_ROW.id, version: 0
  })
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  expect(identity.ok).toBe(true)
  if (!identity.ok) throw new Error('authenticated device identity unavailable')

  const queuedRow = (text: string) =>
    page.locator('.conversation__thread .message-row--queued', { hasText: text })
  const dropButton = (text: string) => queuedRow(text).getByRole('button', { name: 'Drop queued message' })
  const queuedBubbles = page.locator('[data-thread-role="queued"]')
  const deliveredUser = page.locator('[data-thread-role="user"]')
  const deliveredEcho = (text: string) => page.locator('[data-thread-role="user"]', { hasText: text })
  const rowsFor = (text: string) =>
    page.locator('[data-thread-role="user"], [data-thread-role="queued"]', { hasText: text })
  const interruptButton = page.getByRole('button', { name: 'Stop the running turn' })
  const runningIndicator = page.locator('.conversation__thinking')

  await page.getByPlaceholder('Message…').fill(DELIVERED_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(deliveredUser).toHaveCount(1)
  await expect.poll(() => sentMessageId(captured, DELIVERED_TEXT), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual(expect.any(String))
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2, item: {
    id: 20, order: 20, rev: 1, kind: 'user_message', status: 'delivered', active: false,
    shown: true, summary: '', session: SESSION, content: { text: DELIVERED_TEXT,
      message_id: sentMessageId(captured, DELIVERED_TEXT), device_id: identity.deviceId, ts: FIXED_TS }
  } } }))

  // The second actual send supplies a genuine local message ID. Its queued fact
  // must replace the user echo rather than duplicate it.
  await page.getByPlaceholder('Message…').fill(QUEUED_A.text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(deliveredUser).toHaveCount(2)
  await expect.poll(() => sentMessageId(captured, QUEUED_A.text), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual(expect.any(String))
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(interruptButton).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })

  const queuedA: ThreadItem = { id: 30, order: 30, rev: 1, kind: 'user_message', status: 'queued',
    active: true, shown: true, summary: '', session: SESSION, content: { ...QUEUED_A,
      message_id: sentMessageId(captured, QUEUED_A.text), device_id: identity.deviceId } }
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 3, item: queuedA } }))
  // B matches no echo in this window and must remain a separate item.
  daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 4,
    item: { ...queuedA, id: 40, order: 40, content: { ...QUEUED_B, device_id: 'synthetic-other-device' } } } }))
  await expect(queuedBubbles).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(queuedRow('First queued task')).toBeVisible()
  await expect(queuedRow('Second queued task')).toBeVisible()
  await expect(deliveredUser).toHaveCount(1)
  await expect(rowsFor(QUEUED_A.text)).toHaveCount(1)
  await expect(deliveredEcho(QUEUED_A.text)).toHaveCount(0)
  await expect(rowsFor('Second queued task')).toHaveCount(1)
  await expect(page.locator('.conversation__queued')).toHaveCount(0)
  await expect(page.locator('.conversation__thread [data-thread-role="queued"]')).toHaveCount(2)
  await expect(deliveredEcho(DELIVERED_TEXT)).toHaveCount(1)

  await dropButton('First queued task').click()
  await expect.poll(() => captured.filter(e => e.type === 'dequeue_message').length,
    { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(isDeepStrictEqual(captured.find(e => e.type === 'dequeue_message')?.payload,
    { conversation_id: SEEDED_ROW.id, queued_msg_id: QUEUED_A.queued_msg_id })).toBe(true)
  // Captured command is the barrier: the click completed but authoritative
  // queue membership has not changed, and both unrelated rows survive.
  await expect(deliveredEcho(QUEUED_A.text)).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rowsFor(QUEUED_A.text)).toHaveCount(1)
  await expect(queuedRow('First queued task')).toBeVisible()
  await expect(dropButton('First queued task')).toBeVisible()
  await expect(queuedRow('Second queued task')).toBeVisible()
  await expect(deliveredEcho(DELIVERED_TEXT)).toHaveCount(1)
  await expect(deliveredUser).toHaveCount(1)

  daemon.pushFrame(frame({ type: 'thread_item_changed', payload: { ...route, version: 5,
    item_id: queuedA.id, base_rev: 1, rev: 2, changes: { shown: false, active: false, status: 'dropped' } } }))
  await expect(queuedRow('First queued task')).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rowsFor(QUEUED_A.text)).toHaveCount(0)
  await expect(queuedRow('Second queued task')).toBeVisible()
  await expect(queuedBubbles).toHaveCount(1)
  await expect(deliveredUser).toHaveCount(1)
  await expect(deliveredEcho(DELIVERED_TEXT)).toHaveCount(1)

  // The accepted queue facts are the positive processing barrier for the earlier
  // idle control and settle the outstanding local send before the interrupt leg.
  await expect(interruptButton).toHaveCount(0)
  await expect(runningIndicator).toHaveCount(0)
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(interruptButton).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(runningIndicator).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await interruptButton.click()
  await expect.poll(() => captured.filter(e => e.type === 'interrupt').length,
    { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(captured.filter(e => e.type === 'interrupt').map(e => e.payload))
    .toEqual([{ conversation_id: SEEDED_ROW.id }])
  await expect(interruptButton).toBeVisible()
  await expect(runningIndicator).toBeVisible()
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(interruptButton).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(runningIndicator).toHaveCount(0)
  expect(captured.filter(e => e.type === 'dequeue_message')).toHaveLength(1)
  expect(captured.filter(e => e.type === 'send_message')).toHaveLength(2)
  expect(captured.filter(e => e.type === 'request_history')).toHaveLength(0)
})
