import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  SessionSettingsPayload,
  TurnStatePayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1176 — a `session_settings` reply describing conversation A, landing after the
// operator has switched to B, must change nothing.
//
// WHY A NEW SPEC RATHER THAN A STEP ON AN EXISTING ONE. Seven specs already seed a run configuration
// (`run-config-settings`, `composer-model-menu`, `composer-effort-menu`, `composer-permission-mode-menu`,
// `composer-permission-mode-auto`, `composer-model-announced`, `composer-context-severity`), and every
// one of them correlates its reply against a request the app sent while the ONE seeded row was open. A
// bug that resolved the WRONG conversation would pass all seven. What this ticket needs and none of them
// has is a SECOND conversation and a reply held across the switch — so the shape, not the assertion, is
// what makes this its own file.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame here is one the daemon sends unprovoked or in reply — the create round trip is the FAB's own
// (`conversationStateFake` answers `create_conversation` with the correlated `conversation_created`), a
// `turn_state` is pushed unprovoked, and each `session_settings` answers a `request_session_settings`
// this app actually sent, correlated by that request's own envelope id. Only the TIMING is this test's,
// and the timing is the defect.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text or a count.
// The session ids, conversation ids and token figures are non-secret display/routing literals; the
// pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a
// token, a key or plaintext.

// The create round trip plus a reply-gated re-render, on a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

const WINDOW_TOKENS = 200_000

// The two run configurations, chosen so a wrong-chat write is unmistakable in a failure diagnostic: the
// readings differ, and neither text is a substring of the other.
const CONFIG_A = { sessionId: 'session-A', usedTokens: 140_000, text: 'Context high: 70%' } as const
const CONFIG_B = { sessionId: 'session-B', usedTokens: 20_000, text: 'Context: 10%' } as const

/** One `request_session_settings` this app put on the wire: the conversation it named, and its id. */
type CapturedRequest = { conversationId: string; envelopeId: number }

function sessionSettingsFrame(
  inReplyTo: number,
  sessionId: string,
  usedTokens: number
): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    // Since #1176 this is the whole of the reply's attribution: the client resolves the conversation
    // from the request this id answers. A frame without it, or with one naming no outstanding request,
    // reaches neither store.
    in_reply_to: inReplyTo,
    payload: {
      session_id: sessionId,
      model: 'seeded-model',
      effort: 'low',
      yolo: false,
      permission_mode: 'default',
      used_tokens: usedTokens,
      window_tokens: WINDOW_TOKENS
    } satisfies SessionSettingsPayload
  })
}

function turnStateFrame(conversationId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: conversationId, state: 'thinking' } satisfies TurnStatePayload
  })
}

test('a run-config reply describing the previous conversation changes nothing after a switch', async ({
  launchPairedApp
}) => {
  // Every request_session_settings this app sends, in order — captured and DELIBERATELY UNANSWERED, so
  // the drive owns when each reply lands. Answering inline (the loopback shape the sibling specs use)
  // would settle the reply inside the click's own frame and leave no window to hold it across a switch,
  // which is the only state this spec exists to reach.
  const requests: CapturedRequest[] = []
  const stateFake = conversationStateFake({ conversations: [SEED] })
  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    const envelope = decodeEnvelope(inbound)
    if (envelope.type === 'request_session_settings') {
      requests.push({
        conversationId: (envelope.payload as { conversation_id: string }).conversation_id,
        envelopeId: envelope.id
      })
      return []
    }
    return stateFake(inbound)
  }

  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  // The reading mounts ONLY once a run-config snapshot exists, and nothing pushes one — `session_settings`
  // is reply-only. Nothing above answered a request, so it is absent here for a reason the drive created.
  const reading = page.locator('.composer__context')
  const stopButton = page.getByRole('button', { name: 'Stop the running turn' })

  // --- 1. Conversation A is open: launchPairedApp navigates by clicking the seeded row, and since #1166
  // opening a chat asks for its run configuration. Poll rather than read once — the ask rides the open,
  // not the click. ---
  await expect
    .poll(() => requests.find((r) => r.conversationId === SEED.id)?.envelopeId, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeDefined()
  const requestA = requests.find((r) => r.conversationId === SEED.id)
  expect(requestA).toBeDefined()

  // --- 2. Switch to B. The FAB mints it through the real create round trip and the correlated
  // `conversation_created` drives the nav, so B is the open conversation and A's request is now the
  // in-flight one the operator navigated away from — the defect's exact state. B's own ask goes out
  // behind A's; both stay unanswered. ---
  await page.locator('.channel-list__fab').click()
  await expect
    .poll(() => requests.find((r) => r.conversationId !== SEED.id)?.envelopeId, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeDefined()
  const requestB = requests.find((r) => r.conversationId !== SEED.id)
  expect(requestB).toBeDefined()

  // --- 3. A's reply lands, late, while B is open. Before #1176 this wrote A's snapshot and A's session
  // id into both app-singleton stores, so B's footer showed A's reading and B's write controls addressed
  // A's session. ---
  daemon.pushFrame(
    sessionSettingsFrame(requestA!.envelopeId, CONFIG_A.sessionId, CONFIG_A.usedTokens)
  )

  // --- 4. The BARRIER, and it is what makes step 5 an assertion rather than a race. A closing "it did
  // not appear" proves nothing if the app has simply not processed the frame yet. So push a second frame
  // AFTER A's reply whose effect is visible and which no run-config field feeds, and wait for it: the
  // Noise transport is an ordered per-direction counter, so once the Stop button is up, A's reply has
  // already been consumed and dropped. `thinking` is deliberately not followed by an `idle` — a
  // running → not-running transition is a refresh edge, and this drive owns every request. ---
  daemon.pushFrame(turnStateFrame(requestB!.conversationId))
  await expect(stopButton).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 5. AC2: A's reply reached neither store. The reading never mounted, because no snapshot exists —
  // with the gate removed, A's would have mounted it before the barrier and this reddens. ---
  await expect(reading).toHaveCount(0)

  // --- 6. The mutation check, and it must come LAST. B's own reply — correlated to B's own request —
  // lands and mounts B's reading, which proves this drive was not asserting against a dead pipeline and
  // that the locator can populate at all. Pushed after step 5 rather than before it on purpose: with
  // both replies landing, the later write wins and the end state is B's whether or not the gate exists,
  // so a drive that only read the end state would pass with the gate deleted. ---
  daemon.pushFrame(
    sessionSettingsFrame(requestB!.envelopeId, CONFIG_B.sessionId, CONFIG_B.usedTokens)
  )
  await expect(reading).toHaveText(CONFIG_B.text, { timeout: ROUNDTRIP_TIMEOUT_MS })
})
