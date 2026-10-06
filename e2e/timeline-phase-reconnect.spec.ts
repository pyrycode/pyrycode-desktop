import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { watchPhaseReconnect, readPhaseReconnect, stopPhaseReconnect } from './fixtures/phaseReconnectEvidence'
import { e2eShowsWindow } from './fixtures/desktopIsolation'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { EnvelopeType, TurnStatePayload } from '../src/shared/wire/types'

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1723, type, ts: '2026-10-05T00:00:00Z', payload, in_reply_to })
// Reconciliation frames deliberately omit event_id: these phases are not replay-ring entries.
const phase = (state: TurnStatePayload['state']): Uint8Array =>
  frame('turn_state', { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload)
const HELD_TEXT = 'Transcript held across the reconnect'
const RECONNECT_TIMEOUT = 20_000

for (const state of ['thinking', 'responding', 'ended-offline'] as const) {
  test(`reconnect restores ${state} status in the open conversation`, async ({ launchPairedApp }, testInfo) => {
    const running = state === 'ended-offline' ? 'responding' : state
    const { page, daemon, forwarder } = await launchPairedApp({
      buildReplyFrames: bytes => {
        const request = decodeEnvelope(bytes)
        if (request.type === 'list_conversations') return [seedConversationsFrame()]
        if (request.type === 'request_history') {
          return [frame('history_page', { entries: [], cursor: '', at_start: true }, request.id)]
        }
        return []
      },
      reconnectResendFrames: state === 'ended-offline' ? [] : [phase(state)]
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await watchPhaseReconnect(page)
    try {
      daemon.pushFrame(frame('assistant_delta', {
        conversation_id: SEEDED_ROW.id, turn_id: 'held-turn', seq: 0, text: HELD_TEXT
      }))
      daemon.pushFrame(frame('turn_end', {
        conversation_id: SEEDED_ROW.id, turn_id: 'held-turn', stop_reason: 'end_turn'
      }))
      daemon.pushFrame(phase(running))
      const status = page.locator('.composer-status__label')
      const copy = running === 'thinking' ? 'Thinking…' : 'Working…'
      const rows = page.locator('[data-thread-role]')
      const held = page.locator('[data-thread-role="assistant"] .bubble__markdown')
      await expect(held).toHaveText(HELD_TEXT)
      await expect(status).toHaveText(copy)
      const rowCount = await rows.count()
      const before = await readPhaseReconnect(page)

      forwarder.dropClientLeg()
      // A NEW handshake, observed in the mounted renderer, gates even the idle absence assertion.
      await expect.poll(async () => (await readPhaseReconnect(page)).connections,
        { timeout: RECONNECT_TIMEOUT }).toBe(before.connections + 1)
      if (state === 'ended-offline') {
        // No phase is sent: the daemon's idle snapshot is silence, not a synthetic idle frame.
        await expect(status).toHaveCount(0)
        expect((await readPhaseReconnect(page)).phases).toEqual(before.phases)
      } else {
        await expect(status).toHaveText(copy, { timeout: RECONNECT_TIMEOUT })
        const after = await readPhaseReconnect(page)
        expect(after.phases.slice(before.phases.length)).toEqual([
          { conversationId: SEEDED_ROW.id, state, connection: before.connections + 1 }
        ])
        testInfo.annotations.push({ type: 'baseline', description: `${state} restored with unchanged production behavior` })
        if (e2eShowsWindow()) {
          await page.screenshot({ path: `/tmp/builder-1723/${state}.png`, animations: 'disabled' })
        }

        const statusMarkup = await page.locator('.composer-status').innerHTML()
        const phaseCount = after.phases.length
        daemon.pushFrame(phase(state))
        // Delivery must be observed before a no-change assertion can mean anything.
        await expect.poll(async () => (await readPhaseReconnect(page)).phases.length).toBe(phaseCount + 1)
        // Let the renderer finish its scheduled React work after observed delivery.
        await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
        expect(await page.locator('.composer-status').innerHTML()).toBe(statusMarkup)
        await expect(status).toHaveText(copy)
      }
      await expect(held).toHaveText(HELD_TEXT)
      await expect(rows).toHaveCount(rowCount)
    } finally {
      await stopPhaseReconnect(page)
    }
  })
}
