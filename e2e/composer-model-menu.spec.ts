import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ModelListPayload,
  SessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  SetSessionSettingsPayload,
  TurnStatePayload,
  WireModelOption,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the COMPOSER FOOTER's model menu (#988) — the interaction proof the static tier
// cannot reach. vitest runs the `node` environment, so every renderer test is a renderToStaticMarkup
// string assertion with no DOM, no effects and no click handlers: the static tier pins the label rule,
// the entries, the marking and both inert arms (ComposerModelMenu.test.tsx), and only a real window can
// prove the panel OPENS, that picking a row sends one single-field change, and that the trigger's label
// moves optimistically and comes back on a rejection.
//
// Two templates joined: run-config-settings.spec.ts's frame builders (an unsolicited model_list sealed
// with the production encoder, a seeded session_settings baseline, a capturing set_session_settings fake)
// and composer-actions.spec.ts's footer-menu drive.
//
// THE TRIGGER IS LOCATED BY A NAME DERIVED FROM DAEMON TEXT, which is the one thing this spec cannot
// borrow from its sibling. composer-actions.spec.ts locates by COMPOSER_ACTIONS_LABEL, a client-owned
// constant; this trigger's visible text is a FAMILY derived from the strings this spec itself seeded
// (#1095 — before it, the published display name). That is not a weaker proof, it is a stronger one: a
// trigger showing anything else is not findable at all.
//
// ONE test() block, ONE launch, ONE continuous drive (paired-shell-navigation.spec.ts's shape): each
// launch pays a full handshake, the ordering is load-bearing (the list must arrive AFTER the app has
// rendered without it), and no step mutates persistent state.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. The
// one push here is `model_list`, which the daemon publishes unprovoked from the conversation's
// initialize reply — the same frame and the same justification run-config-settings.spec.ts records.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// counts and captured wire frames. SESSION_ID, the published values and the display names are non-secret
// routing and display literals; the pairing plumbing lives in launchPairedApp and is never echoed. No
// failure diagnostic serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The session the control addresses, carried on the session_settings reply and echoed by every
// set_session_settings payload. A non-secret routing id — and the thing that un-inerts the write.
const SESSION_ID = 'session-988'

// The published rows. The values cover the measured shapes, including a bracketed variant that is NOT
// PARSEABLE FOR MATCHING, INDEXING OR KEYING — the join below is still exact equality on the whole string,
// and nothing in this feature splits a value to look anything up. #1095 re-scoped that from the absolute
// this note used to state: the trigger and the rows now DISPLAY a family derived from these strings, which
// is why the locators below read families rather than display names.
//
// The internal default recommends Sonnet, which is deliberately unmatched in the visible rows.
// Before the announcement it labels the trigger but marks nothing; Haiku then supersedes it.
const MODEL_ROWS: WireModelOption[] = [
  {
    value: 'default',
    display_name: 'Inherited default',
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

// The families the rows above derive to, stated by hand rather than by re-implementing the production rule
// in the test: a row shows the family of its OWN `value`, and the trigger shows the family of the matched
// row's `resolved_model`. They differ for exactly one row, which is the whole point of seeding it.
const ROW_FAMILIES = ['Opus', 'Haiku']
const BASELINE_TRIGGER_FAMILY = 'Sonnet'

const HAPPY_MODEL = MODEL_ROWS[1]
const REJECTED_MODEL = MODEL_ROWS[2]

// An inherited model and a saved/applied effort disagreement exercise both shared decisions.
const BASELINE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: '',
  effort: 'low',
  effective_effort: 'high',
  yolo: false,
  // Required since #1020 — see the note on run-config-settings.spec.ts's baseline: a missing key is
  // decode-rejected at runtime and reads as the controls never mounting.
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

function sessionSettingsUpdatedFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { session_id: SESSION_ID } satisfies SessionSettingsUpdatedPayload
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

// The coarse turn-phase scalar, pushed unsolicited exactly as queued-backlog-interrupt.spec.ts pushes it.
// A thinking → idle pair is a TURN-END EDGE, which is what makes the app ask for a session-settings
// snapshot — see the drive.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// The one unsolicited push, keyed to the conversation the app opens.
function modelListFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      models: MODEL_ROWS,
      dropped_models: 0
    } satisfies ModelListPayload
  })
}

/**
 * The capturing reply factory (run-config-settings.spec.ts's capturingRunConfigFake shape). Value-based
 * discrimination, so the closure stays stateless: the one scripted rejection is keyed to the model the
 * spec picks last.
 */
function capturingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_session_settings':
        return [sessionSettingsFrame(env.id)]
      // The rejected change is answered by the TEST BODY rather than here, and that is what makes the
      // optimistic overlay observable at all: this fake runs in-process over a loopback forwarder, so a
      // reply returned here lands within the same frame the click did and the intermediate state is gone
      // before any assertion can see it. Withholding the reply parks the change in flight until the body
      // pushes a correlated error, which is the same liberty queued-backlog-interrupt.spec.ts takes with
      // the frames it pushes: the daemon does send this frame, and only its TIMING is the test's.
      case 'set_session_settings':
        return (env.payload as SetSessionSettingsPayload).model === REJECTED_MODEL.value
          ? []
          : [sessionSettingsUpdatedFrame(env.id)]
      default:
        return []
    }
  }
}

// `.toBe(1)` on this proves BOTH halves of AC3 at once: sent exactly once, and carrying ONLY the changed
// field — a deep equal, so any extra key or wrong value leaves the count at 0.
function settingsFramesMatching(captured: Envelope[], expected: SetSessionSettingsPayload): number {
  return captured.filter(
    (e) => e.type === 'set_session_settings' && isDeepStrictEqual(e.payload, expected)
  ).length
}

test('composer footer: the model menu labels, offers, submits and reverts (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  // The trigger's label lives in its own element in BOTH renderings — the inert one and the operable one
  // — so one locator reads it throughout. Exactly one model control exists, so this is unambiguous.
  const label = page.locator('.composer__model-label')
  const panel = page.getByRole('menu', { name: 'Model', exact: true })
  // EXACT is load-bearing on every trigger locator here: getByRole's `name` matches as a
  // case-insensitive SUBSTRING by default, and the panel rows carry these same names.
  const trigger = (name: string) => page.getByRole('button', { name, exact: true })

  // --- The snapshot has to arrive before this control can say anything. Since #1166 the app asks for one
  // on CONVERSATION OPEN as well as on the connected edge and at each TURN END (runConfigLive), and
  // `launchPairedApp` navigates by clicking the seeded row — so the fake's baseline reply has already
  // landed here and this control is live from launch. The pushed thinking → idle pair is still the
  // turn-end edge, unsolicited exactly as the daemon sends it, and it re-asks for the same baseline: no
  // input is manufactured that production does not produce. ---
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))

  // --- AC4, and it must be asserted BEFORE the push or not at all. No list has arrived, so the control
  // shows the family of the session's model derived from the shown string alone (#1095's miss arm) and is
  // INERT: no popup announced, and the footer still holds exactly one anchor (the Actions menu's). An
  // operable trigger over an empty panel would fail all three. ---
  await expect(label).toHaveText('Model', { timeout: ROUNDTRIP_TIMEOUT_MS })
  // TWO rather than one since #682: the Actions menu's, plus the permission-mode control's. That one is
  // operable the moment a snapshot names a mode — its entries are a client-owned constant, so it has no
  // list to be waiting for — and this baseline names one. The claim being made here is still THIS
  // control's inert arm; what changed is that the row is no longer the Actions menu alone.
  await expect(page.locator('.composer__footer [aria-haspopup="menu"]')).toHaveCount(2)
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(2)

  // The published recommendation supplies only the pre-announcement label.
  daemon.pushFrame(modelListFrame())
  await expect(label).toHaveText(BASELINE_TRIGGER_FAMILY, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- Open (AC2). The trigger is now a real button whose accessible name is that family; the chevron is
  // aria-hidden, so the name is exactly the label. `exact` still matters, and the trigger's family is
  // deliberately one no ROW wears — the two would otherwise be separated only by role. ---
  await trigger(BASELINE_TRIGGER_FAMILY).click()
  await expect(panel).toBeVisible()
  // Visible rows retain published order, labels and raw write values, with Default removed.
  await expect(panel.getByRole('menuitem')).toHaveText(ROW_FAMILIES)
  // The published prose is gone from the panel entirely — the half a derivation that only reached the
  // trigger would leave standing.
  for (const row of MODEL_ROWS) {
    await expect(panel.getByText(row.display_name, { exact: true })).toHaveCount(0)
  }
  // AC2's marking: the row AC1 matched is the current one, and it is the only one.
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(0)
  await expect(panel.getByRole('menuitem', { name: 'Default', exact: true })).toHaveCount(0)

  await page.keyboard.press('Escape')
  daemon.pushFrame(encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'model_announced', ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, model: 'claude-haiku-4-5-20251001', truncated: false } }))
  await expect(label).toHaveText('Haiku')
  await trigger('Haiku').click()
  await expect(panel.locator('[aria-current="true"]')).toHaveText('Haiku')
  await page.keyboard.press('Escape')
  await expect(page.locator('.composer__effort-label')).toHaveText('high')
  await page.screenshot({ path: '/tmp/1690-model-footer.png', animations: 'disabled' })
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  const sheet = page.getByRole('dialog', { name: 'Run configuration' })
  await expect(sheet.locator('.run-config__model-name')).toHaveText(['Wide context', 'Quick tier'])
  await expect(sheet.locator('.run-config__model-row').filter({ has: page.locator('[aria-label="Current model"]') })).toContainText('Quick tier')
  await expect(sheet.locator('.run-config__effort [aria-current="true"]')).toHaveText('high')
  await page.screenshot({ path: '/tmp/1690-run-config.png', animations: 'disabled' })
  await sheet.getByRole('button', { name: 'Close', exact: true }).click()
  await trigger('Haiku').click()

  // --- Pick (AC3). The label moves to the picked row AT ONCE — the optimistic overlay, asserted before
  // the confirm has any chance to matter — and exactly one set_session_settings goes out carrying only
  // the model field, with the row's `value` VERBATIM. That payload assertion is the one place #1095 must
  // not reach: the write still sends the raw published value, never the family the row displays. ---
  await panel.getByRole('menuitem', { name: ROW_FAMILIES[0], exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(label).toHaveText(ROW_FAMILIES[0])
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, model: HAPPY_MODEL.value }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)

  // --- Reject (AC3's second half), and the one drive that separates the OPTIMISTIC label from a
  // confirmed one: the fake withholds this reply, so the trigger sits on a value the daemon has not
  // agreed to. ---
  await trigger(ROW_FAMILIES[0]).click()
  await panel.getByRole('menuitem', { name: ROW_FAMILIES[1], exact: true }).click()
  await expect(label).toHaveText(ROW_FAMILIES[1])

  // The correlated rejection, addressed by the envelope id the app itself minted — read back off the
  // capture, which is the only place the test can learn it.
  const rejected = captured.find(
    (e) =>
      e.type === 'set_session_settings' &&
      (e.payload as SetSessionSettingsPayload).model === REJECTED_MODEL.value
  )
  expect(rejected).toBeDefined()
  daemon.pushFrame(settingsErrorFrame(rejected!.id))

  // The overlay is dropped, so the trigger returns to the true value on its own — back to the CONFIRMED
  // pick above, not to the baseline. The footer says nothing further about it: the row has a hard 20px
  // height with no slot for an error line, and the run-configuration sheet is where the rejection is
  // named.
  await expect(label).toHaveText(ROW_FAMILIES[0], { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
})
