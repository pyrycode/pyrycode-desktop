import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// #1566 — a turn's tokens and time on hover of the meta row of its last assistant bubble. The unit tier
// pins the format and which bubble carries the text; it cannot hover and has no stylesheet, so this
// spec proves the two things only a running browser answers: the numbers are hidden and take no space
// until the row is hovered, and a turn whose `turn_end` carries no numbers reveals nothing.
//
// SECRET HYGIENE (the sibling specs' rule): every literal is a non-secret display string.

const ROUND_TRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-09-23T12:00:00.000Z'

const WITH_NUMBERS = 'turn with numbers'
const WITHOUT_NUMBERS = 'turn without numbers'

// in = 9 + 12000 + 440 = 12449 → 12.4k; 41999ms → 41s (whole seconds, rounded down).
const METRICS = {
  input_tokens: 9,
  cache_read_tokens: 12000,
  cache_creation_tokens: 440,
  output_tokens: 800,
  duration_ms: 41999
}
const EXPECTED_STATS = '12.4k in · 800 out · 41s'

// One [assistant_delta, turn_end] pair per send, as message-copy.spec.ts pushes it; the sent text
// decides whether this turn's turn_end carries the numbers.
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type !== 'send_message') return [seedConversationsFrame()]
  const payload = envelope.payload as SendMessagePayload
  if (payload.conversation_id !== SEEDED_ROW.id) return []
  const withNumbers = payload.text === WITH_NUMBERS
  const turnId = withNumbers ? 'turn-1' : 'turn-2'
  return [
    encodeEnvelope({
      id: withNumbers ? 101 : 201,
      type: 'assistant_delta',
      ts: FIXED_TS,
      payload: {
        conversation_id: SEEDED_ROW.id,
        turn_id: turnId,
        seq: 0,
        text: withNumbers ? 'reply with numbers' : 'reply without numbers'
      } satisfies AssistantDeltaPayload
    }),
    encodeEnvelope({
      id: withNumbers ? 102 : 202,
      type: 'turn_end',
      ts: FIXED_TS,
      payload: {
        conversation_id: SEEDED_ROW.id,
        turn_id: turnId,
        stop_reason: 'end_turn',
        ...(withNumbers ? METRICS : {})
      } satisfies TurnEndPayload
    })
  ]
}

test("shows a turn's tokens and time only while its last assistant meta row is hovered", async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })
  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')
  const composer = page.getByPlaceholder('Message…')

  await composer.fill(WITH_NUMBERS)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles.nth(0).locator('.bubble__markdown')).toBeVisible({
    timeout: ROUND_TRIP_TIMEOUT_MS
  })
  await composer.fill(WITHOUT_NUMBERS)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(assistantBubbles.nth(1).locator('.bubble__markdown')).toBeVisible({
    timeout: ROUND_TRIP_TIMEOUT_MS
  })

  // --- The turn that carries the numbers. Unhovered, the stats are in the DOM but drawn nowhere and
  // the row keeps its size; hovered, they read exactly as the ticket's format. ---
  const meta = assistantBubbles.nth(0).locator('.bubble__meta')
  const stats = meta.locator('.bubble__turn-stats')
  await page.mouse.move(0, 0)
  await expect(stats).toBeHidden()
  const restingBox = await meta.boundingBox()
  await meta.hover()
  await expect(stats).toBeVisible()
  await expect(stats).toHaveText(EXPECTED_STATS)
  expect((await meta.boundingBox())?.height).toBe(restingBox?.height)
  await page.mouse.move(0, 0)
  await expect(stats).toBeHidden()
  expect(await meta.boundingBox()).toEqual(restingBox)

  // --- The turn whose turn_end carried none: hovering reveals nothing. ---
  const bareMeta = assistantBubbles.nth(1).locator('.bubble__meta')
  // Timestamp visibility now changes on row hover; the meta's underlying text must stay unchanged.
  const restingText = await bareMeta.textContent()
  await expect(bareMeta.locator('.bubble__meta-time')).toBeHidden()
  await bareMeta.hover()
  await expect(bareMeta.locator('.bubble__turn-stats')).toHaveCount(0)
  await expect(bareMeta.locator('.bubble__meta-time')).toBeVisible()
  expect(await bareMeta.textContent()).toBe(restingText)

  // --- User bubbles carry none either. ---
  await expect(page.locator('.bubble[data-thread-role="user"] .bubble__turn-stats')).toHaveCount(0)
})
