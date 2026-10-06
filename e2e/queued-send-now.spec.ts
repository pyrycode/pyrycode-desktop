import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, SendMessagePayload, SessionSettingsPayload } from '../src/shared/wire/types'

// #1726, fake transport: Send now on a queued row. The session-settings reply reports
// `mid_turn_input: true`, a message is queued behind a running turn, and Send now is clicked. The click
// sends exactly one `send_queued_now` naming the row and writes nothing to the thread; the row stays
// queued until a `queue_state` omits it, and the daemon's user `message` push for it draws no second row.
// Every assertion reads DOM roles/counts and captured frames; the texts and ids are non-secret literals.
const ROUNDTRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-10-05T12:00:00.000Z'
const QUEUED_TEXT = 'Send me now please'

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: 900,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      session_id: 'session-1726',
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000,
      capabilities: { slash_commands: true, mcp_servers: true, context_usage_detail: true, mid_turn_input: true }
    } satisfies SessionSettingsPayload
  })
}

test('Send now sends one send_queued_now and keeps the message one row through delivery (#1726)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: (bytes) => {
      const envelope = decodeEnvelope(bytes)
      captured.push(envelope)
      if (envelope.type === 'list_conversations') return [seedConversationsFrame()]
      if (envelope.type === 'request_session_settings') return [sessionSettingsFrame(envelope.id)]
      return []
    }
  })
  const push = (type: string, payload: Record<string, unknown>): void => daemon.pushFrame(encodeEnvelope({
    id: 1, type, ts: FIXED_TS, payload: { conversation_id: SEEDED_ROW.id, ...payload }
  }))
  const sent = (): SendMessagePayload[] =>
    captured.filter((e) => e.type === 'send_message').map((e) => e.payload as SendMessagePayload)
  const framesOf = (type: string): Envelope[] => captured.filter((e) => e.type === type)

  // The context reading arrives in the same reply as the flags, so once it shows the flag is held too.
  await expect(page.locator('.composer__context')).toHaveText('Context: 25%', { timeout: ROUNDTRIP_TIMEOUT_MS })

  const composer = page.getByPlaceholder('Message…')
  await composer.fill('Start the first task')
  await composer.press('Enter')
  await expect.poll(() => sent().length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  push('turn_state', { state: 'responding' })
  await composer.fill(QUEUED_TEXT)
  await composer.press('Enter')
  await expect.poll(() => sent().length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(2)
  const messageId = sent()[1]?.message_id
  push('queue_state', { queued: [{ queued_msg_id: 1, message_id: messageId, text: QUEUED_TEXT, ts: FIXED_TS }] })

  const queuedRow = page.locator('.conversation__thread .message-row--queued', { hasText: QUEUED_TEXT })
  const sendNow = queuedRow.getByRole('button', { name: 'Send queued message now' })
  const drop = queuedRow.getByRole('button', { name: 'Drop queued message' })
  const rowsFor = page.locator('[data-thread-role="user"], [data-thread-role="queued"]', { hasText: QUEUED_TEXT })
  await expect(queuedRow).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(sendNow).toBeEnabled()
  await expect(drop).toBeEnabled()

  // Reachable with Tab: from the thread itself, a bounded walk forward lands on Send now.
  await page.locator('.conversation__thread').focus()
  let reached = false
  for (let i = 0; i < 25 && !reached; i += 1) {
    await page.keyboard.press('Tab')
    reached = await sendNow.evaluate((el) => el === document.activeElement)
  }
  expect(reached).toBe(true)

  const userRowsBefore = await page.locator('[data-thread-role="user"]').count()
  await sendNow.click()
  await expect.poll(() => framesOf('send_queued_now').length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(isDeepStrictEqual(framesOf('send_queued_now')[0]?.payload, {
    conversation_id: SEEDED_ROW.id, queued_msg_id: 1
  })).toBe(true)
  expect(framesOf('dequeue_message')).toHaveLength(0)
  expect(sent()).toHaveLength(2)

  // The click wrote nothing: the row is still queued with both controls, and no row appeared or left.
  await expect(queuedRow).toHaveCount(1)
  await expect(sendNow).toBeVisible()
  await expect(drop).toBeVisible()
  await expect(rowsFor).toHaveCount(1)
  await expect(page.locator('[data-thread-role="user"]')).toHaveCount(userRowsBefore)

  // The daemon's acknowledgement: a backlog without it, then its user `message` push, same message_id.
  push('queue_state', { queued: [] })
  await expect(queuedRow).toHaveCount(0, { timeout: ROUNDTRIP_TIMEOUT_MS })
  push('message', { message_id: messageId, role: 'user', text: QUEUED_TEXT })
  push('assistant_delta', { turn_id: 'first', seq: 1, text: 'Read it mid-turn.' })
  await expect(page.locator('[data-thread-role="assistant"]', { hasText: 'Read it mid-turn.' }))
    .toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(rowsFor).toHaveCount(1)
  await expect(page.locator('[data-thread-role="user"]', { hasText: QUEUED_TEXT })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Send queued message now' })).toHaveCount(0)
})
