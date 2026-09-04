import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ModelAnnouncedPayload,
  ModelListPayload,
  SessionSettingsPayload,
  SetSessionSettingsPayload,
  TurnStatePayload,
  WireModelOption,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1053 — the ANNOUNCEMENT layered into the composer footer's model control. A
// SECOND spec rather than steps bolted onto composer-model-menu.spec.ts, because that drive is ordered
// around NOT having an announcement: its opening assertion is that the control renders nothing before a
// snapshot exists, and pushing an announcement into it would make that claim untestable there.
//
// The four layers, in the order the control resolves them: a pending-or-confirmed PICK, then the
// ANNOUNCEMENT, then the snapshot's STORED choice, then nothing. This drive walks them bottom-up, so each
// step is falsifiable by the one before it.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. Three
// frames are pushed unsolicited and the daemon sends all three unprovoked — `model_announced` rides
// claude's `system` / `init` line (the producer is pyrycode#1638), `model_list` comes off the
// conversation's initialize reply, and a `turn_state` thinking → idle pair is an ordinary turn end. Only
// their TIMING is this test's.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// counts and captured wire frames. SESSION_ID, the published values, the display names and the announced
// identifier are non-secret routing and display literals; the pairing plumbing lives in launchPairedApp
// and is never echoed. No failure diagnostic serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SESSION_ID = 'session-1053'

// Display names are locators, so they are mutually non-substring — and so are the values, since the
// announced identifier is read verbatim on screen before any list arrives.
const MODEL_ROWS: WireModelOption[] = [
  {
    value: 'sonnet',
    display_name: 'Balanced pick',
    resolved_model: 'claude-sonnet-5',
    effort_levels: ['low', 'high'],
    supports_auto_mode: true,
    truncated_fields: null
  },
  {
    value: 'opus[1m]',
    display_name: 'Wide context',
    resolved_model: 'claude-opus-5',
    effort_levels: ['low', 'high'],
    supports_auto_mode: true,
    truncated_fields: null
  },
  {
    value: 'haiku',
    display_name: 'Quick tier',
    resolved_model: 'claude-haiku-4-5-20251001',
    effort_levels: [],
    supports_auto_mode: false,
    truncated_fields: null
  }
]

// What claude announces for the running turn. Its `value` IS a published one, so the announcement joins a
// row on exact equality once the list arrives — the join AC1 asks for, and the only reason the label can
// change from a raw identifier to a display name at that step.
const ANNOUNCED_MODEL = MODEL_ROWS[0]
// What the DAEMON is set to. A different row, which is what makes AC2 falsifiable: an implementation that
// let the stored choice win would show this row's name instead.
const STORED_MODEL = MODEL_ROWS[1]
// The pick, whose reply is withheld so it can be rejected.
const PICKED_MODEL = MODEL_ROWS[2]

// The snapshot the read request is answered with. It arrives LATE — only at a turn end — which is the
// whole reason the announcement is worth showing.
const BASELINE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: STORED_MODEL.value,
  effort: 'low',
  yolo: false,
  permission_mode: 'default',
  used_tokens: 50_000,
  window_tokens: 200_000
}

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: BASELINE_RUN_CONFIG
  })
}

// The rejection — a content-free `error` correlated by in_reply_to. decodeEnvelope requires a PRESENT
// payload, hence `{}`.
function settingsErrorFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'error',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {}
  })
}

function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

function modelListFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, models: MODEL_ROWS, dropped_models: 0 } satisfies ModelListPayload
  })
}

// claude's own report for the running turn. `truncated: false` is a VALUE (nothing was cut), not an
// absence — and this control renders no cut report either way, by design.
function modelAnnouncedFrame(model: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_announced',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      model,
      truncated: false
    } satisfies ModelAnnouncedPayload
  })
}

/** The capturing reply factory — value-based discrimination, so the closure stays stateless. */
function capturingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_session_settings':
        return [sessionSettingsFrame(env.id)]
      // WITHHELD, and that is what makes the optimistic label observable at all: this fake runs in-process
      // over a loopback forwarder, so a reply returned here lands within the same frame the click did and
      // the intermediate state is gone before any assertion can see it. The test body pushes a correlated
      // error instead, addressed by the envelope id read back off the capture.
      case 'set_session_settings':
        return []
      default:
        return []
    }
  }
}

function settingsFramesMatching(captured: Envelope[], expected: SetSessionSettingsPayload): number {
  return captured.filter(
    (e) => e.type === 'set_session_settings' && isDeepStrictEqual(e.payload, expected)
  ).length
}

test('composer footer: the announced model shows when nothing was chosen, and layers (AC1-AC5)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  const label = page.locator('.composer__model-label')
  const panel = page.getByRole('menu', { name: 'Model', exact: true })
  // EXACT is load-bearing on every trigger locator here: getByRole's `name` matches as a
  // case-insensitive SUBSTRING by default, and the panel rows carry these same names.
  const trigger = (name: string) => page.getByRole('button', { name, exact: true })
  // The context reading mounts only once a run-config snapshot exists, so it is this drive's barrier for
  // "the snapshot has landed" — the one event that is otherwise invisible, because the label deliberately
  // does NOT move when it arrives.
  const contextReading = page.locator('.composer__context')

  // --- AC4. Nothing at any layer: no pick, no announcement, and no snapshot to carry a stored choice.
  // The control draws nothing at all, exactly as before this ticket. ---
  await expect(label).toHaveCount(0)
  await expect(contextReading).toHaveCount(0)

  // --- AC1, and the state this ticket exists for. The announcement alone brings the control back, with
  // NO snapshot of any kind — no turn has ended yet. No list has arrived either, so the identifier shows
  // verbatim on the inert arm: no popup announced, and the footer holds only the anchors of the two
  // controls that do not depend on the model (Actions, and the permission mode, which is itself still
  // waiting on a snapshot here). ---
  daemon.pushFrame(modelAnnouncedFrame(ANNOUNCED_MODEL.value))
  await expect(label).toHaveText(ANNOUNCED_MODEL.value, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [aria-haspopup="menu"]')).toHaveCount(1)

  // --- AC1's join. The list arrives unsolicited and the announced identifier resolves through the
  // published rows on exact `value` equality — the same rule the run-configuration sheet's Running model
  // section uses, which is why the label can only become this one string. ---
  daemon.pushFrame(modelListFrame())
  await expect(label).toHaveText(ANNOUNCED_MODEL.display_name, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- AC2. A turn ends, so the app asks for a snapshot and the daemon answers with a stored choice that
  // names a DIFFERENT row. A lone `idle` fires nothing — the refresh trigger is a running → idle
  // transition. The label does not move: the announcement outranks the stored choice. ---
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(contextReading).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(label).toHaveText(ANNOUNCED_MODEL.display_name)

  // --- AC5. The rows, and the MARKING — which is the session's model, never the announcement. This is
  // the pair a single-string implementation cannot satisfy: the trigger names what is RUNNING while the
  // panel marks what the daemon is SET TO. ---
  await trigger(ANNOUNCED_MODEL.display_name).click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('menuitem')).toHaveText(MODEL_ROWS.map((row) => row.display_name))
  await expect(panel.locator('[aria-current="true"]')).toHaveText(STORED_MODEL.display_name)

  // --- AC3. A pick outranks both, at once — the optimistic overlay, asserted before any reply could
  // matter — and it still sends exactly one single-field change carrying the row's `value` verbatim. ---
  await panel.getByRole('menuitem', { name: PICKED_MODEL.display_name, exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(label).toHaveText(PICKED_MODEL.display_name)
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, model: PICKED_MODEL.value }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)

  // --- AC3's second half, and the drive that separates this spec's revert from the sibling's: with the
  // pending record dropped there is no pick at any client layer, so the label falls back to the
  // ANNOUNCEMENT rather than to the daemon's stored choice. Addressed by the envelope id the app itself
  // minted, read back off the capture — the only place the test can learn it. ---
  const rejected = captured.find(
    (e) =>
      e.type === 'set_session_settings' &&
      (e.payload as SetSessionSettingsPayload).model === PICKED_MODEL.value
  )
  expect(rejected).toBeDefined()
  daemon.pushFrame(settingsErrorFrame(rejected!.id))

  await expect(label).toHaveText(ANNOUNCED_MODEL.display_name, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
})
