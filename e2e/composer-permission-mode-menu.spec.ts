import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import {
  PERMISSION_MODE_LABELS,
  SETTABLE_PERMISSION_MODES
} from '../src/renderer/src/screens/conversation/ComposerPermissionModeMenu'
import type {
  Envelope,
  SessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  SetSessionSettingsPayload,
  TurnStatePayload,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the COMPOSER FOOTER's permission-mode menu (#682) — the interaction proof the
// static tier cannot reach. vitest runs the `node` environment, so every renderer test is a
// renderToStaticMarkup string assertion with no DOM, no effects and no click handlers: the static tier
// pins the label rule, the entries, the marking and the draw-nothing arm
// (ComposerPermissionModeMenu.test.tsx), and only a real window can prove the panel OPENS, that picking a
// mode sends one single-field change, and that the trigger's label moves optimistically and comes back on
// a rejection.
//
// composer-effort-menu.spec.ts's drive with the MODE as the subject — same fixture, same reply factory
// shape, same one-launch discipline.
//
// THE VOCABULARY IS IMPORTED FROM THE PRODUCTION MODULE rather than invented, and that inverts the two
// sibling specs deliberately. Theirs invent their published levels and rows because those vocabularies are
// the DAEMON's, and a client-side copy is the bug those tickets exist to prevent. This menu's entries are
// a CLIENT-OWNED constant, so the strings under test are the app's own: importing them is what makes every
// assertion below a derivation rather than a second copy that can drift. The MODES THE DAEMON REPORTS are
// still chosen by this spec — `bypassPermissions` for the bypass reading, and a mode this client has never
// heard of is left to the unit tier, which can render it without a wire round-trip.
//
// ONE test() block, ONE launch, ONE continuous drive (paired-shell-navigation.spec.ts's shape): each
// launch pays a full handshake, the ordering is load-bearing (the bypass reading must be asserted BEFORE
// any pick, since a confirmed override would mask the snapshot from then on), and no step mutates
// persistent state.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. The
// only unsolicited push is `turn_state`, which the daemon sends of its own accord; every
// `session_settings` frame here is a REPLY to a request the app itself made, and the mode it carries
// changes between the two reads exactly as it would if the operator had changed it elsewhere.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// counts, geometry and captured wire frames. SESSION_ID and the mode values are non-secret routing and
// display literals; the pairing plumbing lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The session the control addresses, echoed by every set_session_settings payload. A non-secret routing
// id — and the thing that un-inerts the write.
const SESSION_ID = 'session-682'

// The one mode the read half reports and the write half refuses.
const BYPASS = 'bypassPermissions'

// The two picks, taken from the production constant by POSITION so neither is typed here: a mode that is
// not the daemon-reported baseline, and a second one that is neither of the first two. The rejected pick
// is deliberately the one whose display name carries an apostrophe (`Don't ask`), which is the label most
// likely to be mangled by an escaping bug on either side of the round trip.
const [BASELINE_MODE, HAPPY_MODE] = SETTABLE_PERMISSION_MODES
const REJECTED_MODE = 'dontAsk'

// What the daemon reports on the NEXT read. Mutable because the drive reads twice and the second reading
// is a different mode — the frame is a reply either way, so nothing here manufactures an input.
let reportedMode = BYPASS

const baselineRunConfig = (): SessionSettingsPayload => ({
  session_id: SESSION_ID,
  model: 'seeded-model',
  effort: 'seeded-effort',
  yolo: reportedMode === BYPASS,
  permission_mode: reportedMode,
  used_tokens: 50_000,
  window_tokens: 200_000
})

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: baselineRunConfig()
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

/**
 * The capturing reply factory (composer-effort-menu.spec.ts's shape). Value-based discrimination, so the
 * closure stays stateless: the one scripted rejection is keyed to the mode the spec picks last.
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
        return (env.payload as SetSessionSettingsPayload).permission_mode === REJECTED_MODE
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

test('composer footer: the permission-mode menu labels, offers, submits and reverts (AC1-AC4)', async ({
  launchPairedApp
}) => {
  reportedMode = BYPASS
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  // The trigger's label lives in its own element, so one locator reads it throughout. It wears its OWN
  // class rather than either sibling's, which is what keeps this locator and both sibling specs'
  // unambiguous under strict mode.
  const label = page.locator('.composer__permission-label')
  const panel = page.getByRole('menu', { name: 'Permission mode', exact: true })
  // EXACT is load-bearing on every trigger locator here: getByRole's `name` matches as a case-insensitive
  // SUBSTRING by default, and the panel rows carry these same names.
  const trigger = (name: string) => page.getByRole('button', { name, exact: true })
  const displayed = (mode: string): string => PERMISSION_MODE_LABELS[mode]

  // --- The snapshot has to arrive before this control can say anything. Since #1166 the app asks for one
  // on CONVERSATION OPEN as well as on the connected edge and at each TURN END (runConfigLive), and
  // `launchPairedApp` navigates by clicking the seeded row — so the fake's baseline reply has already
  // landed here and every item in this row is live from launch. The pushed thinking → idle pair is still
  // that turn-end edge, unsolicited exactly as the daemon sends it, and it re-asks for the same baseline:
  // no input is manufactured that production does not produce. ---
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))

  // --- AC2's BYPASS HALF, driven first because it is only reachable before a pick: a confirmed change
  // would mask the daemon's snapshot from then on. The session is sitting in the one mode this control
  // cannot send, and it says so plainly. ---
  await expect(label).toHaveText(displayed(BYPASS), { timeout: ROUNDTRIP_TIMEOUT_MS })
  // Operable, and the ONLY operable control in the row: no model_list has arrived, so both neighbours are
  // inert. Two anchors — the Actions menu's and this one's — is therefore the proof this menu needs no
  // list frame at all, which is the structural claim that separates it from its two neighbours.
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(2)
  await expect(page.locator('.composer__footer [aria-haspopup="menu"]')).toHaveCount(2)

  await trigger(displayed(BYPASS)).click()
  await expect(panel).toBeVisible()
  // EXACTLY the five settable modes, in order, by display name — toHaveText is exact and ordered, so a
  // dropped, invented or reordered entry fails here. And the escalation is not among them: a session in
  // bypass is offered the five, and nothing in this menu can put a session back into bypass.
  await expect(panel.getByRole('menuitem')).toHaveText(SETTABLE_PERMISSION_MODES.map(displayed))
  await expect(panel.getByRole('menuitem', { name: displayed(BYPASS), exact: true })).toHaveCount(0)
  // Nothing is marked: the session's mode is in no entry, through the panel's existing branch.
  await expect(panel.locator('[aria-current="true"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // --- AC1: the label follows the DAEMON. A second turn-end edge fetches a fresh snapshot, and this one
  // reports an ordinary mode — the same shape as an operator changing it from another client. ---
  reportedMode = BASELINE_MODE
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(label).toHaveText(displayed(BASELINE_MODE), { timeout: ROUNDTRIP_TIMEOUT_MS })

  await trigger(displayed(BASELINE_MODE)).click()
  await expect(panel).toBeVisible()
  // AC2's marking: the session's mode is the current one, and it is the only one.
  await expect(panel.locator('[aria-current="true"]')).toHaveText(displayed(BASELINE_MODE))

  // The row still fits, with four controls drawn and the panel open: AC1's bound is a client-owned
  // max-width, and the check that matters is that the row keeps its hard height and pushes nothing off the
  // window. The detector .composer__effort-label's note asks this control to keep passing.
  expect((await page.locator('.composer__footer').boundingBox())?.height).toBe(20)
  expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true)

  // --- Pick (AC3). The label moves to the picked mode AT ONCE — the optimistic overlay, asserted before
  // the confirm has any chance to matter — and exactly one set_session_settings goes out carrying only the
  // permission_mode field, with the MACHINE value rather than the display name. ---
  await panel.getByRole('menuitem', { name: displayed(HAPPY_MODE), exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(label).toHaveText(displayed(HAPPY_MODE))
  await expect
    .poll(
      () => settingsFramesMatching(captured, { session_id: SESSION_ID, permission_mode: HAPPY_MODE }),
      { timeout: ROUNDTRIP_TIMEOUT_MS }
    )
    .toBe(1)

  // --- Reject (AC4), and the one drive that separates the OPTIMISTIC label from a confirmed one: the fake
  // withholds this reply, so the trigger sits on a mode the daemon has not agreed to. ---
  await trigger(displayed(HAPPY_MODE)).click()
  await panel.getByRole('menuitem', { name: displayed(REJECTED_MODE), exact: true }).click()
  await expect(label).toHaveText(displayed(REJECTED_MODE))

  // The correlated rejection, addressed by the envelope id the app itself minted — read back off the
  // capture, which is the only place the test can learn it.
  const rejected = captured.find(
    (e) =>
      e.type === 'set_session_settings' &&
      (e.payload as SetSessionSettingsPayload).permission_mode === REJECTED_MODE
  )
  expect(rejected).toBeDefined()
  daemon.pushFrame(settingsErrorFrame(rejected!.id))

  // The overlay is dropped, so the trigger returns to the mode the session is actually in on its own —
  // back to the CONFIRMED pick above, not to the baseline. AC4's "the label never names a mode the session
  // is not in". The footer says nothing further about it: the row has a hard 20px height with no slot for
  // an error line, and the daemon answers every rejection with one fixed constant anyway.
  await expect(label).toHaveText(displayed(HAPPY_MODE), { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
})
