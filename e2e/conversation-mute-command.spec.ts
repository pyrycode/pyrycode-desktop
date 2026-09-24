import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, SetConversationMutedPayload } from '../src/shared/wire/types'

// Fake-stack e2e for the OUTBOUND `set_conversation_muted` verb (#1595). The unit tier pins the builder,
// the guard, the connection method and its correlation; `src/main/index.ts` has no test file, so its
// `case 'setConversationMuted':` arm, and its choice to route by CONVERSATION, is what this spec buys.
// Two fake hosts are paired so "no other host receives a frame" is observed rather than inferred.
//
// No UI sends this yet (the Edit channel checkbox is #1596), so the command goes through the same
// preload bridge the window uses, `window.pyry.sendCommand`. The outcome is read off the window's own
// `onDaemonEvent` subscription, which carries the attempt id and the outcome and nothing else.

type MuteResult = { attemptId: string; outcome: string }
type ProbeWindow = typeof window & { muteResults: MuteResult[] }

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-24T00:00:00Z', payload, in_reply_to })

test('a setConversationMuted command reaches only the owning host and settles once', async ({ launchPairedApp }) => {
  const first: Envelope[] = []
  const second: Envelope[] = []
  let muted = false
  const row = () => ({ ...SEEDED_ROW, is_muted: muted })

  const { page } = await launchPairedApp({
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      first.push(request)
      if (request.type === 'list_conversations') return [seedConversationsFrame(row())]
      if (request.type !== 'set_conversation_muted') return []
      const payload = request.payload as SetConversationMutedPayload
      // The fake refuses an unmute, so one drive observes both correlated outcomes.
      if (!payload.muted) {
        return [frame('error', { code: 'conversation.not_found', message: 'refused', retryable: false }, request.id)]
      }
      muted = true
      const { id, is_promoted, name, cwd, last_used_at, workspace_label } = row()
      return [frame('conversation_updated',
        { id, is_promoted, name, cwd, last_used_at, workspace_label, is_muted: true }, request.id)]
    }
  }, {
    secondServer: {
      buildReplyFrames: bytes => {
        const request = decodeEnvelope(bytes)
        second.push(request)
        return request.type === 'list_conversations' ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : []
      }
    }
  })

  await page.evaluate(() => {
    const probe = window as ProbeWindow
    probe.muteResults = []
    window.pyry.onDaemonEvent(event => {
      if (event.type === 'conversationMuteResult') {
        probe.muteResults.push({ attemptId: event.attemptId, outcome: event.outcome })
      }
    })
  })
  const results = () => page.evaluate(() => (window as ProbeWindow).muteResults)
  const send = (command: unknown) => page.evaluate(command => { window.pyry.sendCommand(command) }, command)
  const writes = (log: Envelope[]) => log.filter(e => e.type === 'set_conversation_muted')
  const lists = () => first.filter(e => e.type === 'list_conversations').length

  // 1. A mute on the first host's conversation: one frame there, exactly the two keys, confirmed once,
  // and the correlated record still drives the list re-request.
  const listsBefore = lists()
  await send({ type: 'setConversationMuted', payload: { conversation_id: SEEDED_ROW.id, muted: true }, attemptId: 'mute-1' })
  await expect.poll(results).toEqual([{ attemptId: 'mute-1', outcome: 'confirmed' }])
  expect(writes(first).map(e => e.payload)).toEqual([{ conversation_id: SEEDED_ROW.id, muted: true }])
  await expect.poll(lists).toBeGreaterThan(listsBefore)

  // 2. An unmute the host refuses: one more frame, one rejected result.
  await send({ type: 'setConversationMuted', payload: { conversation_id: SEEDED_ROW.id, muted: false }, attemptId: 'mute-2' })
  await expect.poll(results).toEqual([
    { attemptId: 'mute-1', outcome: 'confirmed' },
    { attemptId: 'mute-2', outcome: 'rejected' }
  ])

  // 3. An id no host claims: no frame anywhere, and the attempt still settles.
  await send({ type: 'setConversationMuted', payload: { conversation_id: 'unclaimed', muted: true }, attemptId: 'mute-3' })
  await expect.poll(async () => (await results()).at(-1)).toEqual({ attemptId: 'mute-3', outcome: 'rejected' })

  expect(writes(first)).toHaveLength(2)
  expect(writes(second)).toEqual([])
})
