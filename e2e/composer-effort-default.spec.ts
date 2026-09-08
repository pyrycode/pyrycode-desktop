import { isDeepStrictEqual } from 'node:util'
import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  Envelope,
  ModelListPayload,
  SessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  SetSessionSettingsPayload,
  WireModelOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1169 — a new chat opens at the last effort level used.
//
// THE SHAPE IS THREE CHATS IN ONE DRIVE, and each one is a different acceptance criterion:
//   A — reports an effort of its own, and a level is PICKED and CONFIRMED in it. That confirm is what
//       writes the remembered level; without it every later assertion would be about a store holding
//       nothing and would pass with the whole feature deleted.
//   B — reports NO effort of its own (`effort: ''`, the wire's inherited daemon default) and publishes
//       the same levels. The remembered level must be applied to it, exactly once, naming B's session.
//   C — reports an effort of its own WHILE something is remembered. Nothing may be sent, and C must keep
//       showing what its own session reports.
//
// C IS WHY THIS IS THREE CHATS AND NOT TWO. A's own "nothing was sent" reading at launch is vacuous:
// nothing is remembered yet either, so the apply is blocked twice over and the assertion would pass with
// the empty-effort precondition deleted. Only a chat opened AFTER a level has been remembered isolates
// that precondition, which is AC2's whole content.
//
// WHY A NEW FILE rather than a step on e2e/composer-effort-menu.spec.ts — run-config-scoped-to-
// conversation.spec.ts's reason, one axis over: every existing effort spec seeds a chat that REPORTS an
// effort, and a chat reporting none is the shape. The shape, not the assertion, is what makes it its own
// file. The drive itself is that spec's two-chat template with a third chat added.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame here is one the daemon really sends — `model_list` unprovoked, `session_settings` and
// `session_settings_updated` correlated by `in_reply_to` to a request this app actually sent, and the
// create round trips are the FAB's own.
//
// THE LEVELS ARE INVENTED, the sibling effort specs' rule: seeding the measured five would put back the
// vocabulary #976 deleted and would let a client-side fallback pass this drive unnoticed. They are
// mutually non-substring, because Playwright's accessible-name and hasText matching is substring-based.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, a count, or
// a captured wire frame. The session ids, conversation ids and levels are non-secret routing and display
// literals; the pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic
// serialises a token, a key or plaintext.

// Two create round trips plus reply-gated re-renders, on a cold runner.
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
  last_used_at: FIXED_TS,
  workspace_label: null
}

const A_BASELINE = 'brisk'
const A_PICKED = 'steady'
const C_BASELINE = 'plodding'
const LEVELS = [A_BASELINE, A_PICKED, C_BASELINE]

// One session per chat. Distinct, so a write addressed to the wrong chat is unmistakable in a failure
// diagnostic — and so the frame counts below can isolate which chat a change named.
const SESSION_A = 'session-A'
const SESSION_B = 'session-B'
const SESSION_C = 'session-C'

// One row publishing all three levels, pushed per conversation. Every chat here reports this same model,
// so the remembered level is published for all three: the level's ABSENCE from a list is AC4's arm and is
// pinned in the unit table, not here.
const GRADED: WireModelOption = {
  value: 'graded',
  display_name: 'Graded pick',
  resolved_model: 'claude-graded-5',
  effort_levels: LEVELS,
  supports_auto_mode: true,
  truncated_fields: null
}

/** One `request_session_settings` this app put on the wire: the conversation it named, and its id. */
type CapturedRequest = { conversationId: string; envelopeId: number }

function sessionSettingsFrame(inReplyTo: number, sessionId: string, effort: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    // Since #1176 this is the whole of the reply's attribution: the client resolves the conversation from
    // the request this id answers.
    in_reply_to: inReplyTo,
    payload: {
      session_id: sessionId,
      // An empty model, the wire's inherited daemon default, would ALSO resolve a row since #1168 — the
      // published value is used here so the join under test is the ordinary one and the inherited-default
      // substitution stays pinned where it belongs, in the unit table.
      model: GRADED.value,
      effort,
      yolo: false,
      // Required since #1020 — a missing key is decode-rejected at runtime and reads as the controls
      // never mounting, which would make every assertion below vacuous.
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000
    } satisfies SessionSettingsPayload
  })
}

function sessionSettingsUpdatedFrame(inReplyTo: number, sessionId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { session_id: sessionId } satisfies SessionSettingsUpdatedPayload
  })
}

function modelListFrame(conversationId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: conversationId,
      models: [GRADED],
      dropped_models: 0
    } satisfies ModelListPayload
  })
}

/** Every `set_session_settings` this app sent whose payload is EXACTLY this — a deep equal, so an extra
 *  key or a wrong value leaves the count at 0. `.toBe(1)` proves both halves of "exactly one effort change
 *  naming that chat's session" at once. */
function settingsFramesMatching(captured: Envelope[], expected: SetSessionSettingsPayload): number {
  return captured.filter(
    (e) => e.type === 'set_session_settings' && isDeepStrictEqual(e.payload, expected)
  ).length
}

/** Every `set_session_settings` addressed to one session, whatever it carried. The companion to the deep
 *  equal above: that one would stay at 1 beside a SECOND frame carrying a different value, and this one
 *  would not. */
function settingsFramesFor(captured: Envelope[], sessionId: string): number {
  return captured.filter(
    (e) =>
      e.type === 'set_session_settings' &&
      (e.payload as SetSessionSettingsPayload).session_id === sessionId
  ).length
}

test('a new chat opens at the last effort level used, and a chat with its own level is left alone', async ({
  launchPairedApp
}) => {
  // Every frame this app sent, in order — the only place the drive can learn what went out.
  const captured: Envelope[] = []
  // Every request_session_settings, in order. The two chats the FAB mints are told apart by the order
  // they first ask: the first is B, the second is C.
  const requests: CapturedRequest[] = []
  const minted: string[] = []
  const stateFake = conversationStateFake({ conversations: [SEED] })

  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    const envelope = decodeEnvelope(inbound)
    captured.push(envelope)
    if (envelope.type === 'request_session_settings') {
      const conversationId = (envelope.payload as { conversation_id: string }).conversation_id
      requests.push({ conversationId, envelopeId: envelope.id })
      if (conversationId === SEED.id) {
        return [sessionSettingsFrame(envelope.id, SESSION_A, A_BASELINE)]
      }
      if (!minted.includes(conversationId)) minted.push(conversationId)
      // B reports NO effort of its own; C reports one. Both are answered inline, so the drive is gated on
      // renderings rather than on when a reply is released.
      return minted.indexOf(conversationId) === 0
        ? [sessionSettingsFrame(envelope.id, SESSION_B, '')]
        : [sessionSettingsFrame(envelope.id, SESSION_C, C_BASELINE)]
    }
    // Every change is confirmed. A confirm is what writes the remembered level (a rejected level is not a
    // level that was used), so the seed this whole drive rests on is settled here rather than optimistic.
    if (envelope.type === 'set_session_settings') {
      return [
        sessionSettingsUpdatedFrame(
          envelope.id,
          (envelope.payload as SetSessionSettingsPayload).session_id
        )
      ]
    }
    return stateFake(inbound)
  }

  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  // The effort trigger's label lives in its own element in BOTH renderings — inert and operable — so one
  // locator reads it throughout, and its COUNT is the mounted/not-mounted reading.
  const label = page.locator('.composer__effort-label')
  const panel = page.getByRole('menu', { name: 'Effort', exact: true })
  const newChat = (): Promise<void> => page.locator('.channel-list__fab').click()

  // --- 1. Chat A is open (launchPairedApp navigates by clicking the seeded row) and since #1166 opening
  // it asks for its run configuration, which the fake answered with A's own level. ---
  await expect(label).toHaveText(A_BASELINE, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // A's list arrives unsolicited and un-inerts the control, so the pick below is a real menu selection.
  daemon.pushFrame(modelListFrame(SEED.id))
  await expect(page.getByRole('button', { name: A_BASELINE, exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // --- 2. Pick a level in A and let the fake confirm it. THE SEED: the confirm is what writes the
  // remembered level, and the label moving is the proof it landed. ---
  await page.getByRole('button', { name: A_BASELINE, exact: true }).click()
  await panel.getByRole('menuitem', { name: A_PICKED, exact: true }).click()
  await expect(label).toHaveText(A_PICKED, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // A got exactly the operator's own pick and nothing else — no default was applied on top of it.
  expect(settingsFramesFor(captured, SESSION_A)).toBe(1)

  // --- 3. Mint chat B through the FAB's real create round trip. B reports NO effort of its own, and its
  // list arrives once it has asked, so the levels the remembered value is validated against are B's. ---
  await newChat()
  await expect
    .poll(() => requests.filter((r) => r.conversationId !== SEED.id).length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  const chatB = requests.find((r) => r.conversationId !== SEED.id)
  expect(chatB).toBeDefined()
  daemon.pushFrame(modelListFrame(chatB!.conversationId))

  // --- 4. AC1, and the drive's primary detector. Exactly one set_session_settings, deep-equal to B's
  // session carrying only the effort field, with the remembered level verbatim. A frame count can only be
  // non-zero if the apply really fired, so it cannot pass vacuously — and the companion count catches a
  // second frame carrying something else. ---
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_B, effort: A_PICKED }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  expect(settingsFramesFor(captured, SESSION_B)).toBe(1)
  // ...and the operator sees it: the footer shows the level on B before B's first message. The whole
  // point of the ticket, and the reading that was blank before it.
  await expect(label).toHaveText(A_PICKED, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 5. AC2, and the reason this drive has a third chat. C reports an effort of its OWN while a level
  // is remembered, so the empty-effort precondition is the only thing that can hold the apply back. ---
  await newChat()
  await expect
    .poll(() => requests.filter((r) => r.conversationId !== SEED.id).length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(2)
  const chatC = requests.find(
    (r) => r.conversationId !== SEED.id && r.conversationId !== chatB!.conversationId
  )
  expect(chatC).toBeDefined()
  daemon.pushFrame(modelListFrame(chatC!.conversationId))

  // C keeps showing the level its own session reports — a POSITIVE reading, and the mutation that proves
  // the switch happened at all (the label read A_PICKED one step ago).
  await expect(label).toHaveText(C_BASELINE, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // Nothing was written to C. Asserted after the positive reading above, so the pipeline is provably live
  // rather than dead.
  //
  // THIS ZERO IS NOT THE RULE-4 DETECTOR, and the line below is — do not delete it believing otherwise.
  // The label read above proves C's `session_settings` reply was processed; it proves nothing about the
  // `model_list` pushed on the line before it, which is fire-and-forget and is sent AFTER that reply on
  // the same connection. So a build with the empty-effort precondition removed could still read zero here
  // simply because C's levels had not landed yet — the membership rule would refuse for the wrong reason
  // and this assertion would pass anyway.
  expect(settingsFramesFor(captured, SESSION_C)).toBe(0)
  // The earlier chats are untouched by C's opening: no late frame went out under either session. A's count
  // is what actually catches a rule-4 mutation, and it catches it independently of any ordering above: a
  // build that ignored the empty-effort precondition re-applies the remembered level to A the moment A's
  // own confirm lands, so this reads 2 rather than 1.
  expect(settingsFramesFor(captured, SESSION_A)).toBe(1)
  expect(settingsFramesFor(captured, SESSION_B)).toBe(1)
})
