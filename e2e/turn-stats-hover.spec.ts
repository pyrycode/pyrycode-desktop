import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// Metadata has one row-level hover/focus reveal; hidden rows contribute no height or gap.

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

test("reveals time and turn stats together on row hover or focus and collapses them at rest", async ({
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

  const bubble = assistantBubbles.nth(0)
  const row = bubble.locator('..')
  const meta = bubble.locator('.bubble__meta')
  const stats = meta.locator('.bubble__turn-stats')
  const time = meta.locator('.bubble__meta-time')
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 })
    await bubble.scrollIntoViewIfNeeded()
    await composer.focus()
    await page.mouse.move(0, 0)
    await expect(meta).toBeHidden()
    expect(await meta.boundingBox()).toBeNull()
    const restingBox = (await bubble.boundingBox())!
    const contentHeight = await bubble.evaluate(el => {
      const style = getComputedStyle(el)
      return el.querySelector('.bubble__markdown')!.getBoundingClientRect().height +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    })
    expect(restingBox.height).toBeCloseTo(contentHeight, 0)
    await page.screenshot({ path: `/tmp/builder-1898/metadata-rest-${width}.png` })
    // Hover empty row space, away from the bubble and metadata.
    await row.hover({ position: { x: 2, y: 2 } })
    await expect(time).toBeVisible()
    await expect(stats).toBeVisible()
    await expect(stats).toHaveText(EXPECTED_STATS)
    expect((await bubble.boundingBox())!.height).toBeGreaterThan(restingBox.height)
    await page.screenshot({ path: `/tmp/builder-1898/metadata-hover-${width}.png` })
    await row.getByRole('button', { name: 'Copy message' }).focus()
    await page.mouse.move(0, 0)
    await expect(time).toBeVisible()
    await expect(stats).toBeVisible()
    await page.screenshot({ path: `/tmp/builder-1898/metadata-focus-${width}.png` })
    // Removing focus while hovered keeps metadata visible; leaving both collapses it.
    await row.hover({ position: { x: 2, y: 2 } })
    await composer.focus()
    await expect(stats).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(meta).toBeHidden()
    expect((await bubble.boundingBox())!.height).toBe(restingBox.height)
  }

  const user = page.locator('.bubble[data-thread-role="user"]').first()
  await composer.focus()
  await page.mouse.move(0, 0)
  await expect(user.locator('.bubble__meta')).toBeHidden()
  const userHeight = (await user.boundingBox())!.height
  await user.locator('..').getByRole('button', { name: 'Reply to message' }).focus()
  await expect(user.locator('.bubble__meta-time')).toBeVisible()
  expect((await user.boundingBox())!.height).toBeGreaterThan(userHeight)
  await composer.focus()
  await expect(user.locator('.bubble__meta')).toBeHidden()
  expect((await user.boundingBox())!.height).toBe(userHeight)

  const bareBubble = assistantBubbles.nth(1)
  await bareBubble.locator('..').hover({ position: { x: 2, y: 2 } })
  await expect(bareBubble.locator('.bubble__turn-stats')).toHaveCount(0)
  await expect(bareBubble.locator('.bubble__meta-time')).toBeVisible()
  await expect(page.locator('.bubble[data-thread-role="user"] .bubble__turn-stats')).toHaveCount(0)
})
