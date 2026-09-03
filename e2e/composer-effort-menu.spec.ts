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

// Fake-stack UI e2e for the COMPOSER FOOTER's effort menu (#989) — the interaction proof the static tier
// cannot reach. vitest runs the `node` environment, so every renderer test is a renderToStaticMarkup
// string assertion with no DOM, no effects and no click handlers: the static tier pins the label rule,
// the entries, the marking and every inert arm (ComposerEffortMenu.test.tsx), and only a real window can
// prove the panel OPENS, that picking a level sends one single-field change, and that the trigger's
// label moves optimistically and comes back on a rejection.
//
// composer-model-menu.spec.ts's drive with the LEVELS as the subject — same templates, same fixture,
// same reply factory shape.
//
// THE PUBLISHED LEVELS ARE INVENTED, exactly as the unit fixture's are, and that is AC2's "no level list
// is hardcoded in this repo" discharged by construction. Seeding the five measured levels would put the
// vocabulary #976 deleted back into the repo, and it would let a production fallback that offered the
// real five pass this spec unnoticed. Every assertion is a derivation over these arrays.
//
// ONE test() block, ONE launch, ONE continuous drive (paired-shell-navigation.spec.ts's shape): each
// launch pays a full handshake, the ordering is load-bearing (the list must arrive AFTER the app has
// rendered without it), and no step mutates persistent state.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. The
// two pushes here are `turn_state` and `model_list`, both of which the daemon sends unprovoked — the
// second one twice, which is the frame's own replace-wholesale contract rather than a liberty.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// counts, geometry and captured wire frames. SESSION_ID, the published values and the levels are
// non-secret routing and display literals; the pairing plumbing lives in launchPairedApp and is never
// echoed. No failure diagnostic serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The session the control addresses, carried on the session_settings reply and echoed by every
// set_session_settings payload. A non-secret routing id — and the thing that un-inerts the write.
const SESSION_ID = 'session-989'

// Mutually non-substring, so a widened comparison would be visible rather than accidentally right, and
// short enough that the label's own 64px bound is not the thing under test here.
const LEVELS = ['brisk', 'steady', 'deep']
const [BASELINE_EFFORT, HAPPY_EFFORT, REJECTED_EFFORT] = LEVELS

// One row publishing levels and one publishing none, in a single list — the two readings the daemon
// really sends. The values cover the measured shapes, including a bracketed variant that is emphatically
// not parseable: nothing in this feature may derive a family from one.
const GRADED: WireModelOption = {
  value: 'graded[1m]',
  display_name: 'Graded pick',
  resolved_model: 'claude-graded-5',
  effort_levels: LEVELS,
  supports_auto_mode: true,
  truncated_fields: null
}

const FLAT: WireModelOption = {
  value: 'flat',
  display_name: 'Flat pick',
  resolved_model: 'claude-flat-5',
  effort_levels: [],
  supports_auto_mode: false,
  truncated_fields: null
}

// The baseline the read request is answered with. Its model is GRADED's PUBLISHED value verbatim, so
// exact equality selects that row; its effort is one of that row's published levels, so it is the one
// the panel marks.
const BASELINE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: GRADED.value,
  effort: BASELINE_EFFORT,
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

// The coarse turn-phase scalar, pushed unsolicited exactly as queued-backlog-interrupt.spec.ts pushes
// it. A thinking → idle pair is a TURN-END EDGE, which is what makes the app ask for a session-settings
// snapshot — see the drive.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// The unsolicited push, keyed to the conversation the app opens. Each frame REPLACES the conversation's
// list wholesale, which is what lets the drive below move the matched row from publishing levels to
// publishing none without touching the session's model.
function modelListFrame(models: readonly WireModelOption[]): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      models: [...models],
      dropped_models: 0
    } satisfies ModelListPayload
  })
}

/**
 * The capturing reply factory (composer-model-menu.spec.ts's shape). Value-based discrimination, so the
 * closure stays stateless: the one scripted rejection is keyed to the level the spec picks last.
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
      // pushes a correlated error — the daemon does send that frame, and only its TIMING is the test's.
      case 'set_session_settings':
        return (env.payload as SetSessionSettingsPayload).effort === REJECTED_EFFORT
          ? []
          : [sessionSettingsUpdatedFrame(env.id)]
      default:
        return []
    }
  }
}

// `.toBe(1)` on this proves BOTH halves of AC4 at once: sent exactly once, and carrying ONLY the changed
// field — a deep equal, so any extra key or wrong value leaves the count at 0.
function settingsFramesMatching(captured: Envelope[], expected: SetSessionSettingsPayload): number {
  return captured.filter(
    (e) => e.type === 'set_session_settings' && isDeepStrictEqual(e.payload, expected)
  ).length
}

test('composer footer: the effort menu labels, offers, submits and reverts (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  // The trigger's label lives in its own element in BOTH renderings — the inert one and the operable one
  // — so one locator reads it throughout. It wears its OWN class rather than the model label's, which is
  // what keeps both this locator and that sibling spec's unambiguous under strict mode.
  const label = page.locator('.composer__effort-label')
  const panel = page.getByRole('menu', { name: 'Effort', exact: true })
  // EXACT is load-bearing on every trigger locator here: getByRole's `name` matches as a
  // case-insensitive SUBSTRING by default, and the panel rows carry these same names.
  const trigger = (name: string) => page.getByRole('button', { name, exact: true })

  // --- The snapshot has to arrive before this control can say anything, and the app asks for one on the
  // connected edge and at each TURN END (runConfigLive). The connected edge lands before a conversation
  // is active, so nothing is asked for then — which is why every item in this row is absent on a fresh
  // launch. A pushed thinking → idle pair is that turn-end edge, unsolicited exactly as the daemon sends
  // it, and the reply is the fake's own baseline: no input is manufactured that production does not
  // produce. ---
  await expect(label).toHaveCount(0)
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))

  // --- AC3's first reading, and it must be asserted BEFORE the push or not at all. No list has arrived,
  // so the control shows the session's effort verbatim and is INERT: no popup announced, and the footer
  // still holds exactly one anchor (the Actions menu's — the model control is inert here for the same
  // reason). An operable trigger over an empty panel would fail all three, and so would reading an absent
  // list as "offer every level". ---
  await expect(label).toHaveText(BASELINE_EFFORT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [aria-haspopup="menu"]')).toHaveCount(1)
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(1)

  // --- The list arrives unsolicited (AC2). Exact equality on `value` resolves the session's model to the
  // graded row, so this control becomes operable while the label stays exactly what it was: the session's
  // effort is not re-derived from the list. ---
  daemon.pushFrame(modelListFrame([GRADED, FLAT]))
  // Three anchors now: Actions, the model menu (one frame un-inerts both footer menus at once) and this
  // one. Counted rather than assumed, because it is the cheapest proof this control became operable —
  // and because the count is what the LAST step of this drive moves back down.
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(3, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(label).toHaveText(BASELINE_EFFORT)

  // --- Open (AC2). The trigger is now a real button whose accessible name is that level; the chevron is
  // aria-hidden, so the name is exactly the label. ---
  await trigger(BASELINE_EFFORT).click()
  await expect(panel).toBeVisible()
  // Exactly the levels the matched row published, one per entry, in the daemon's published order —
  // toHaveText is exact and ordered, so a dropped, invented, reordered or deduped level fails here, and
  // so does the whole measured vocabulary appearing in place of these three.
  await expect(panel.getByRole('menuitem')).toHaveText(LEVELS)
  // AC2's marking: the session's effort is the current one, and it is the only one.
  await expect(panel.locator('[aria-current="true"]')).toHaveText(BASELINE_EFFORT)

  // The row still fits, with three controls drawn and the panel open: AC1's bound is a client-owned
  // max-width, and the check that matters is that the row keeps its hard height and pushes nothing off
  // the window. The detector for .composer__effort-label's derived 64px.
  expect((await page.locator('.composer__footer').boundingBox())?.height).toBe(20)
  expect(
    await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)
  ).toBe(true)

  // --- Pick (AC4). The label moves to the picked level AT ONCE — the optimistic overlay, asserted before
  // the confirm has any chance to matter — and exactly one set_session_settings goes out carrying only
  // the effort field, with the published string verbatim. ---
  await panel.getByRole('menuitem', { name: HAPPY_EFFORT, exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(label).toHaveText(HAPPY_EFFORT)
  await expect
    .poll(
      () => settingsFramesMatching(captured, { session_id: SESSION_ID, effort: HAPPY_EFFORT }),
      { timeout: ROUNDTRIP_TIMEOUT_MS }
    )
    .toBe(1)

  // --- Reject (AC4's second half), and the one drive that separates the OPTIMISTIC label from a
  // confirmed one: the fake withholds this reply, so the trigger sits on a value the daemon has not
  // agreed to. ---
  await trigger(HAPPY_EFFORT).click()
  await panel.getByRole('menuitem', { name: REJECTED_EFFORT, exact: true }).click()
  await expect(label).toHaveText(REJECTED_EFFORT)

  // The correlated rejection, addressed by the envelope id the app itself minted — read back off the
  // capture, which is the only place the test can learn it.
  const rejected = captured.find(
    (e) =>
      e.type === 'set_session_settings' &&
      (e.payload as SetSessionSettingsPayload).effort === REJECTED_EFFORT
  )
  expect(rejected).toBeDefined()
  daemon.pushFrame(settingsErrorFrame(rejected!.id))

  // The overlay is dropped, so the trigger returns to the true value on its own — back to the CONFIRMED
  // pick above, not to the baseline. The footer says nothing further about it: the row has a hard 20px
  // height with no slot for an error line, and the run-configuration sheet is where the rejection is
  // named.
  await expect(label).toHaveText(HAPPY_EFFORT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)

  // --- AC3's third reading, end to end, and the one this ticket exists to prevent getting wrong: the
  // matched row now publishes an EMPTY level list. A replacement frame is how the daemon states that (the
  // list is replaced wholesale per conversation), and the session's model is untouched. The control must
  // go inert — still labelled, opening nothing — rather than falling back to a vocabulary of its own. ---
  daemon.pushFrame(modelListFrame([{ ...GRADED, effort_levels: [] }, FLAT]))
  // Back to two anchors — Actions and the model menu, which still has rows to offer. THIS control is the
  // one that dropped out, which is what the pair of counts across the two pushes isolates.
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(2, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(label).toHaveText(HAPPY_EFFORT)
  await expect(page.locator('.composer__footer [aria-haspopup="menu"]')).toHaveCount(2)
})
