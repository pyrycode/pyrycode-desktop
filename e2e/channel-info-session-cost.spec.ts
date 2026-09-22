import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope, decodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// #1567 — the session's running cost in the channel info sheet, attributed to Claude. Each turn_end's
// `cost_usd_total` is already the session's running total, so the sheet shows the latest positive one and
// never a sum; a later turn reporting none leaves it in place; with none received there is no row.
//
// SECRET HYGIENE (the sibling specs' rule): every literal is a non-secret display string.

const ROUND_TRIP_TIMEOUT_MS = 15_000
const FIXED_TS = '2026-09-23T12:00:00.000Z'
const COST_LABEL = "Cost (Claude's estimate)"

// The sent text picks the running total its turn_end reports; the third reports none.
const COST_BY_TEXT: Record<string, number | undefined> = { first: 0.1, second: 0.42, third: undefined }

const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  if (envelope.type !== 'send_message') return [seedConversationsFrame()]
  const payload = envelope.payload as SendMessagePayload
  if (payload.conversation_id !== SEEDED_ROW.id) return []
  const index = Object.keys(COST_BY_TEXT).indexOf(payload.text)
  const cost = COST_BY_TEXT[payload.text]
  const turnId = `turn-${index}`
  return [
    encodeEnvelope({
      id: 100 + index * 2,
      type: 'assistant_delta',
      ts: FIXED_TS,
      payload: {
        conversation_id: SEEDED_ROW.id,
        turn_id: turnId,
        seq: 0,
        text: `reply ${payload.text}`
      } satisfies AssistantDeltaPayload
    }),
    encodeEnvelope({
      id: 101 + index * 2,
      type: 'turn_end',
      ts: FIXED_TS,
      payload: {
        conversation_id: SEEDED_ROW.id,
        turn_id: turnId,
        stop_reason: 'end_turn',
        ...(cost === undefined ? {} : { cost_usd_total: cost })
      } satisfies TurnEndPayload
    })
  ]
}

test("shows the session's latest running cost as Claude's estimate, and no row before one", async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({ buildReplyFrames })
  const sheet = page.getByRole('dialog')
  const open = async (): Promise<void> => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Channel info' }).click()
    await expect(sheet.getByText('Session', { exact: true })).toBeVisible()
  }

  // --- No positive cost received yet: the Session section has no cost row. ---
  await open()
  await expect(sheet.getByText(COST_LABEL, { exact: true })).toHaveCount(0)
  await expect(sheet.getByText(/est\.$/)).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()

  const assistantBubbles = page.locator('.bubble[data-thread-role="assistant"]')
  const composer = page.getByPlaceholder('Message…')
  for (const [i, text] of Object.keys(COST_BY_TEXT).entries()) {
    await composer.fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(assistantBubbles.nth(i).locator('.bubble__markdown')).toBeVisible({
      timeout: ROUND_TRIP_TIMEOUT_MS
    })
  }

  // --- 0.10 then 0.42 then none: the latest positive total, not a sum, in a row attributed to Claude. ---
  await open()
  const row = sheet.locator('.channel-info__row').filter({ hasText: COST_LABEL })
  await expect(row).toHaveCount(1)
  await expect(row.locator('.channel-info__row-value')).toHaveText('$0.42 est.')
  await expect(sheet.getByText('$0.52 est.', { exact: true })).toHaveCount(0)
})
