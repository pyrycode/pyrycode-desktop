import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ConversationSummary,
  SessionSettingsPayload,
  SessionTransitionPayload,
  SetSessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  WireModelOption,
  ModelListPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1192 — an unsolicited `session_transition` describing conversation A, arriving
// while the operator is working in B, must leave B's controls addressing B's session.
//
// WHY A NEW SPEC. `run-config-cross-conversation.spec.ts` is this drive's sibling and covers the OTHER
// ingress: a reply-only `session_settings`, correlated by envelope id. That mechanism does not exist
// here — the daemon PUSHES this marker with nothing to correlate against — so the routing key on the
// frame is the whole of the attribution, and no existing spec pushes a marker for a chat other than the
// one on screen. Every other spec that pushes a `session_transition` (`thread-shadow`,
// `thread-scroll-pin`) names the single seeded row, so a drive without a SECOND chat would assert the
// gate against a marker that would have matched anyway and pass with the gate deleted.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce.
// `session_transition` is exactly the frame the daemon pushes unprovoked on an idle eviction — the live
// trigger for this defect. (Desktop's own Reset session row dispatches `new_session` since #1496, so
// this spec's marker stands in for the daemon-side eviction rather than for that row.) The create round trip is the plus's own, each `session_settings` answers a
// `request_session_settings` this app actually sent, and the model list is the unsolicited push. Only
// the TIMING of the marker is this test's, and the timing is the defect.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, a count,
// or a captured outbound payload this app itself built. Session ids and conversation ids are non-secret
// routing literals; the pairing plumbing lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, a key or plaintext.

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
  last_used_at: FIXED_TS,
  workspace_label: null
}

// The three session ids this drive tells apart, mutually non-substring so a widened comparison would be
// visible rather than accidentally right. A is the chat left idle in the background; B is the one the
// operator is looking at; A_ROTATED is what A's eviction marker carries and what must never be written.
const SESSION_A = 'session-alpha'
const SESSION_B = 'session-bravo'
const SESSION_A_ROTATED = 'rotated-for-alpha'
const SESSION_B_ROTATED = 'rotated-for-bravo'

const LEVELS = ['brisk', 'steady', 'deep']
const [BASELINE_EFFORT, FIRST_PICK, SECOND_PICK] = LEVELS

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

function runConfigFrame(inReplyTo: number, sessionId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      session_id: sessionId,
      model: GRADED.value,
      effort: BASELINE_EFFORT,
      yolo: false,
      permission_mode: 'default',
      used_tokens: 50_000,
      window_tokens: 200_000
    } satisfies SessionSettingsPayload
  })
}

/**
 * The unsolicited session-boundary marker — an idle eviction of `conversationId`'s session. Since #1192
 * `conversation_id` is REQUIRED on the wire and is the marker's only attribution: the daemon resolves it
 * from the new session id once per transition and drops the event rather than emitting an unbound one.
 */
function sessionTransitionFrame(conversationId: string, newSessionId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_transition',
    ts: FIXED_TS,
    payload: {
      conversation_id: conversationId,
      // An eviction mirrors the evicted id onto both fields; the previous one has no consumer here.
      previous_session_id: newSessionId,
      new_session_id: newSessionId,
      reason: 'idle_evict',
      occurred_at: FIXED_TS,
      workspace_cwd: null
    } satisfies SessionTransitionPayload
  })
}

/** The unsolicited push that un-inerts the effort control for `conversationId`. */
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

function settingsUpdatedFrame(inReplyTo: number, sessionId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { session_id: sessionId } satisfies SessionSettingsUpdatedPayload
  })
}

/** Every `set_session_settings` this app sent carrying exactly this effort, and the session it addressed. */
function sessionsAddressedFor(captured: Envelope[], effort: string): string[] {
  return captured
    .filter((e) => e.type === 'set_session_settings')
    .map((e) => e.payload as SetSessionSettingsPayload)
    .filter((p) => p.effort === effort)
    .map((p) => p.session_id)
}

test('an idle-eviction marker for another chat never steers this chat’s settings write', async ({
  launchPairedApp
}) => {
  // `request_session_settings` is captured and DELIBERATELY UNANSWERED here so the drive owns when each
  // reply lands — answering inline settles it inside the click's own frame and leaves no window to hold
  // a marker across a switch, the only state this spec exists to reach. Everything else the app asks for
  // is answered normally, including the settings WRITE, whose captured payload is the assertion.
  const captured: Envelope[] = []
  const requests: CapturedRequest[] = []
  const stateFake = conversationStateFake({ conversations: [SEED] })
  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    const envelope = decodeEnvelope(inbound)
    captured.push(envelope)
    if (envelope.type === 'request_session_settings') {
      requests.push({
        conversationId: (envelope.payload as { conversation_id: string }).conversation_id,
        envelopeId: envelope.id
      })
      return []
    }
    if (envelope.type === 'set_session_settings') {
      return [
        settingsUpdatedFrame(
          envelope.id,
          (envelope.payload as SetSessionSettingsPayload).session_id
        )
      ]
    }
    return stateFake(inbound)
  }

  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  const label = page.locator('.composer__effort-label')
  const panel = page.getByRole('menu', { name: 'Effort', exact: true })
  const trigger = (name: string) => page.getByRole('button', { name, exact: true })

  // --- 1. Chat A is open: launchPairedApp navigates by clicking the seeded row, and since #1166 opening
  // a chat asks for its run configuration. Answer it, so A's session id is the one the store holds. ---
  await expect
    .poll(() => requests.find((r) => r.conversationId === SEED.id)?.envelopeId, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeDefined()
  const requestA = requests.find((r) => r.conversationId === SEED.id)
  daemon.pushFrame(runConfigFrame(requestA!.envelopeId, SESSION_A))
  await expect(label).toHaveText(BASELINE_EFFORT, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 2. Switch to B, minted through the real create round trip; the correlated `conversation_created`
  // drives the nav, so B is the open chat and A is the one left idle in the background — the defect's
  // exact state. Answer B's own ask with a DIFFERENT session id, and push B's model list so B's effort
  // control is operable. ---
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect
    .poll(() => requests.find((r) => r.conversationId !== SEED.id)?.envelopeId, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeDefined()
  const requestB = requests.find((r) => r.conversationId !== SEED.id)
  daemon.pushFrame(runConfigFrame(requestB!.envelopeId, SESSION_B))
  daemon.pushFrame(modelListFrame(requestB!.conversationId))
  await expect(trigger(BASELINE_EFFORT)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 3. A's session is evicted for idleness and the daemon pushes the marker naming A, while B is on
  // screen. Before #1192 this wrote A's rotated id into the app-singleton store, and B's footer controls
  // then addressed A's session. ---
  daemon.pushFrame(sessionTransitionFrame(SEED.id, SESSION_A_ROTATED))

  // --- 4. THE BARRIER, and it is what makes step 5 an assertion rather than a race: the Noise transport
  // is an ordered per-direction counter, so a frame pushed AFTER the marker whose effect is visible
  // proves the marker has already been consumed. B's list is re-pushed with the same content — a
  // wholesale replace, so it is idempotent — and the settle is read through the control it feeds. ---
  daemon.pushFrame(modelListFrame(requestB!.conversationId))
  await expect(trigger(BASELINE_EFFORT)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 5. AC2: a pick made in B addresses B's session, not the one A's marker named. This is the
  // operator-visible half — the store is not readable from here, but the frame it steers is, and that
  // frame is what a wrong-session write actually does. ---
  await trigger(BASELINE_EFFORT).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('menuitem', { name: FIRST_PICK, exact: true }).click()
  await expect
    .poll(() => sessionsAddressedFor(captured, FIRST_PICK), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([SESSION_B])

  // --- 6. THE MUTATION CHECK, and it must come last. A marker naming B DOES land, so the next write
  // carries B's rotated id — which proves the gate is a filter and not a wholesale mute, and that this
  // drive was not asserting against a pipeline where markers never arrive at all. Pushed after step 5
  // rather than before it on purpose: with both markers landing, the later write wins and the end state
  // is B's whether or not the gate exists, so a drive that only read the end state would pass with the
  // gate deleted. ---
  daemon.pushFrame(sessionTransitionFrame(requestB!.conversationId, SESSION_B_ROTATED))
  await trigger(FIRST_PICK).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('menuitem', { name: SECOND_PICK, exact: true }).click()
  await expect
    .poll(() => sessionsAddressedFor(captured, SECOND_PICK), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([SESSION_B_ROTATED])

  // ...and A's rotated id never addressed anything, on any frame this app sent.
  expect(
    captured
      .filter((e) => e.type === 'set_session_settings')
      .map((e) => (e.payload as SetSessionSettingsPayload).session_id)
  ).not.toContain(SESSION_A_ROTATED)
})
