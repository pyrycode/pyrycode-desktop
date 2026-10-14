import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { AssistantDeltaPayload, TurnEndPayload } from '../src/shared/wire/types'

const TS = '2026-10-01T00:00:00Z'
const SEED_CURSOR = 41
const delta = (turn: string, seq: number, text: string, eventId: number): Uint8Array => encodeEnvelope({
  id: eventId, event_id: eventId, type: 'assistant_delta', ts: TS,
  payload: { conversation_id: SEEDED_ROW.id, turn_id: turn, seq, text } satisfies AssistantDeltaPayload
})
const end = (turn: string, eventId: number): Uint8Array => encodeEnvelope({
  id: eventId, event_id: eventId, type: 'turn_end', ts: TS,
  payload: { conversation_id: SEEDED_ROW.id, turn_id: turn, stop_reason: 'end_turn' } satisfies TurnEndPayload
})

test('reconnect negotiates the retained tail alongside one newest history refresh', async ({ launchPairedApp }) => {
  const hellos: { type: string; cursor: unknown; hasTimestamp: boolean }[] = []
  const requests: string[] = []
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: bytes => {
      const envelope = decodeEnvelope(bytes)
      requests.push(envelope.type)
      return envelope.type === 'list_conversations' ? [seedConversationsFrame()] : []
    },
    // This proof releases no tail when negotiation is absent or wrong. Capture only replay metadata,
    // never the hello token or identity, including on assertion failure.
    buildReconnectFrames: hello => {
      const payload = hello.payload as Record<string, unknown>
      hellos.push({ type: hello.type, cursor: payload.last_event_id, hasTimestamp: 'last_seen_ts' in payload })
      return payload.last_event_id === SEED_CURSOR ? [
        delta('held-turn', 1, ' and recovered tail', 42), end('held-turn', 43),
        delta('missed-turn', 0, 'Missed reply', 44), end('missed-turn', 45)
      ] : []
    }
  })
  const rows = page.locator('.bubble[data-thread-role="assistant"]')
  daemon.pushFrame(delta('held-turn', 0, 'Held prefix', SEED_CURSOR))
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toContainText('Held prefix')
  const historyBefore = requests.filter(type => type === 'request_history').length

  forwarder.dropClientLeg()
  await expect.poll(() => hellos.length, { timeout: 20_000 }).toBe(1)
  expect(hellos).toEqual([{ type: 'hello', cursor: SEED_CURSOR, hasTimestamp: false }])
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('.bubble__markdown')).toHaveText('Held prefix and recovered tail')
  await expect(rows.nth(1).locator('.bubble__markdown')).toHaveText('Missed reply')

  daemon.pushFrame(delta('live-turn', 0, 'Later live reply', 46))
  daemon.pushFrame(end('live-turn', 47))
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('.bubble__markdown')).toHaveText('Held prefix and recovered tail')
  await expect(rows.nth(1).locator('.bubble__markdown')).toHaveText('Missed reply')
  await expect(rows.nth(2).locator('.bubble__markdown')).toHaveText('Later live reply')
  await expect.poll(() => requests.filter(type => type === 'request_history').length).toBe(historyBefore + 1)
  expect(hellos).toHaveLength(1)
})
