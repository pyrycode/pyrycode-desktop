import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  ModelListPayload,
  SessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  SetSessionSettingsPayload,
  WireModelOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1167 — no run-configuration value from the chat the operator left may reach the
// chat they opened.
//
// WHY THE CONFIRMED OVERRIDE IS THE SUBJECT, AND NOT THE SNAPSHOT. A drive that only shows the snapshot
// going stale is racing #1166's round trip: #1166 asks for the new chat's configuration on open and
// #1176 refuses a reply that names another chat, so the snapshot half self-heals in one round trip and a
// drive built on it would be timing-dependent. `runSettingsWriteStore.confirmed` never heals at all — a
// `set_session_settings` ack carries only `session_id` and never rewrites a snapshot, so an override
// confirmed in chat A composes over EVERY later chat's snapshot permanently, through
// selectEffectiveSettings. That is the durable half of the defect and it reddens deterministically.
//
// SO THE SEED IS THE POINT. This drive confirms a change in A before switching. Skipping that step would
// assert "B draws nothing" against a state that draws nothing anyway, and would pass with the whole fix
// deleted. Two independent detectors follow from it: the label must UNMOUNT on the switch (1 → 0, a
// mutation rather than an opening absence), and B's own reply must then mount B's value rather than the
// one picked in A.
//
// WHY A NEW SPEC RATHER THAN A STEP ON AN EXISTING ONE — run-config-cross-conversation.spec.ts's stated
// reason, one axis over. Seven specs seed a run configuration and every one drives the ONE seeded row;
// that sibling adds a second chat but seeds no WRITE, so a defect that carried a confirmed override
// across a switch passes all eight. A second chat plus a confirmed override is what makes the shape, not
// the assertion, its own file.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Every
// frame is one the daemon really sends — `model_list` unprovoked, `session_settings` and
// `session_settings_updated` correlated by `in_reply_to` to a request this app actually sent, and the
// create round trip is the plus's own. Only the TIMING of B's reply is this test's, and that timing is the
// defect.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text or a count.
// The session ids, conversation ids and effort levels are non-secret display/routing literals; the
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
  last_used_at: FIXED_TS,
  workspace_label: null
}

// The levels, INVENTED rather than the measured vocabulary (the sibling effort spec's rule: seeding the
// real five would put back the list #976 deleted and would let a production fallback pass unnoticed).
// Mutually non-substring, because Playwright's accessible-name and hasText matching is substring-based,
// so an overlapping pair would let one locator select the wrong control and pass by accident.
const A_BASELINE = 'brisk'
const A_PICKED = 'steady'
const B_BASELINE = 'plodding'
const LEVELS = [A_BASELINE, A_PICKED, B_BASELINE]

// A's session and B's. Distinct so a wrong-chat write would be unmistakable in a failure diagnostic.
const SESSION_A = 'session-A'
const SESSION_B = 'session-B'

// One row publishing all three levels, so the effort control is operable in A and the pick below is a
// real menu selection rather than a synthesised event. Pushed for A only — B is deliberately left with
// no list at all, which is what proves the label's absence comes from the cleared effort value and not
// from a missing list: `composerEffortMenuModel` returns null on `effort === ''` BEFORE consulting one.
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
    // Since #1176 this is the whole of the reply's attribution: the client resolves the conversation
    // from the request this id answers.
    in_reply_to: inReplyTo,
    payload: {
      session_id: sessionId,
      model: GRADED.value,
      effort,
      effective_effort: effort,
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

test('a confirmed run-configuration override does not follow the operator into the next chat', async ({
  launchPairedApp
}) => {
  // Every request_session_settings this app sends, in order. A's is answered inline so the control has
  // something to show and something to write; B's is captured and DELIBERATELY UNANSWERED, so the drive
  // owns when B's reply lands and there is a window in which B has asked and heard nothing — the state
  // the operator is really in for one round trip after every switch.
  const requests: CapturedRequest[] = []
  let saved = A_BASELINE
  const stateFake = conversationStateFake({ conversations: [SEED] })
  const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
    const envelope = decodeEnvelope(inbound)
    if (envelope.type === 'request_session_settings') {
      const conversationId = (envelope.payload as { conversation_id: string }).conversation_id
      requests.push({ conversationId, envelopeId: envelope.id })
      return conversationId === SEED.id
        ? [sessionSettingsFrame(envelope.id, SESSION_A, saved)]
        : []
    }
    // The confirm is answered inline: this drive needs the override CONFIRMED, not optimistic. A pending
    // marker would also survive the switch on the broken build, but `confirmed` is the half no reply can
    // ever displace, so settling it here is what makes the seed the durable one.
    if (envelope.type === 'set_session_settings') {
      saved = (envelope.payload as SetSessionSettingsPayload).effort ?? saved
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

  // --- 1. Chat A is open (launchPairedApp navigates by clicking the seeded row) and since #1166 opening
  // it asks for its run configuration, which the fake above answered. ---
  await expect(label).toHaveText(A_BASELINE, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The list arrives unsolicited, keyed to A, and un-inerts this control so the pick below is real.
  daemon.pushFrame(modelListFrame(SEED.id))
  await expect(page.getByRole('button', { name: A_BASELINE, exact: true })).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // --- 2. Confirm a change IN A. The seed the whole drive rests on: after this,
  // `runSettingsWriteStore.confirmed.effort` holds a value that composes over any snapshot and that no
  // later reply can displace. The label reading the picked level is the proof it landed. ---
  await page.getByRole('button', { name: A_BASELINE, exact: true }).click()
  await panel.getByRole('menuitem', { name: A_PICKED, exact: true }).click()
  await expect(label).toHaveText(A_PICKED, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 3. Switch to B, minted through the plus's real create round trip: the correlated
  // `conversation_created` drives the nav, so B is the open chat. B's own ask goes out and is captured
  // unanswered, so B has a session-settings request in flight and no reply — the defect's exact state. ---
  await confirmCreateChat(page)
  await expect
    .poll(() => requests.find((r) => r.conversationId !== SEED.id)?.envelopeId, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeDefined()
  const requestB = requests.find((r) => r.conversationId !== SEED.id)
  expect(requestB).toBeDefined()

  // --- 4. THE FIRST DETECTOR. B has no run configuration of its own yet, so every layer must be empty
  // and the effort control must draw its not-known rendering: nothing at all. This is a 1 → 0 MUTATION,
  // not an opening absence — the label was mounted and reading A_PICKED one step ago — so it cannot pass
  // vacuously, and Playwright's auto-wait makes it a real wait rather than a race. On the broken build
  // A's confirmed override survives the switch, composes over B's absent snapshot, and this locator stays
  // mounted reading A_PICKED. ---
  await expect(label).toHaveText('Effort', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 5. THE MUTATION CHECK, and it must come LAST. B's own reply — correlated to B's own request —
  // lands and mounts B's reading, which proves this drive was not asserting against a dead pipeline and
  // that the locator can populate at all. It is a second, independent detector for the same defect: with
  // the clear deleted the confirmed override outranks the snapshot base in selectEffectiveSettings, so
  // the label would read A_PICKED here rather than B's own level. Pushed after step 4 rather than before
  // it because with both replies landed the end state is B's either way. ---
  daemon.pushFrame(sessionSettingsFrame(requestB!.envelopeId, SESSION_B, B_BASELINE))
  await expect(label).toHaveText(B_BASELINE, { timeout: ROUNDTRIP_TIMEOUT_MS })
})
