import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import {
  AUTO_PERMISSION_MODE,
  PERMISSION_MODE_LABELS,
  SETTABLE_PERMISSION_MODES
} from '../src/renderer/src/screens/conversation/ComposerPermissionModeMenu'
import type {
  ModelListPayload,
  SessionSettingsPayload,
  TurnStatePayload,
  WireModelOption,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1022 — the permission-mode menu drops its `auto` entry when the daemon has
// published a row saying the running model refuses that mode. This is the interaction proof the static
// tier cannot reach: vitest runs the `node` environment, so a renderer spec renders through
// renderToStaticMarkup and CANNOT OPEN THE PANEL AT ALL. The entries only exist in the DOM once the
// trigger has been clicked, so no unit assertion can see which entries a MOUNTED control offers.
//
// THAT IS ALSO WHY THIS FILE EXISTS AT ALL RATHER THAN THE ASSERTIONS GOING IN THE UNIT SUITE. The mount
// in ConversationScreen.tsx now passes `conversationId`, and that seam is invisible to every other tier:
// the pure model function stays green with the mount unwired, and the failure is silent IN THE FAIL-OPEN
// DIRECTION — an unwired container selects no list, matches no row, and offers `auto` exactly as it did
// before #1022. Nothing goes red; the feature is simply absent. This drive is the only thing that fails.
//
// IT IS A SEPARATE FILE FROM composer-permission-mode-menu.spec.ts, DELIBERATELY. That spec asserts the
// footer holds exactly TWO `.composer-options-anchor` and two `aria-haspopup="menu"`, and its own comment
// states that count is the structural proof this menu needs no list frame — it is operable while both
// neighbours are inert. Pushing a `model_list` into that drive makes both counts four and deletes a
// deliberate claim. This case seeds its own state beside it, never inside it.
//
// THE TWO SPECS BOUND THE BEHAVIOUR IN BOTH DIRECTIONS, which is worth stating because neither does it
// alone: the shipped spec asserts all FIVE entries with no `model_list` ever pushed, so an
// always-hide-`auto` bug reddens there; this one asserts FOUR once a refusing row has arrived, so a
// never-hide bug reddens here.
//
// composer-effort-menu.spec.ts's drive with the MODE as the subject — same fixture, same frame factories,
// same one-launch discipline.
//
// THE PUBLISHED ROWS ARE INVENTED, the sibling specs' rule: `value` and `display_name` are the DAEMON's
// strings, so seeding a measured alias would let a production path matching on something other than exact
// equality pass unnoticed. The MODES are imported from the production module instead, because that
// vocabulary is the client's own — importing it is what makes every expectation below a derivation rather
// than a second copy free to drift.
//
// ONE test() block, ONE launch, ONE continuous drive (paired-shell-navigation.spec.ts's shape): each
// launch pays a full handshake, the ordering is load-bearing (the five-entry reading is only reachable
// before any list arrives), and no step mutates persistent state.
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. The
// two pushes here are `turn_state` and `model_list`, both of which the daemon sends unprovoked — the
// second one twice, which is that frame's own replace-wholesale contract rather than a liberty. Every
// `session_settings` frame is a REPLY to a request the app itself made.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles and
// counts. SESSION_ID and the published values are non-secret routing and display literals; the pairing
// plumbing lives in launchPairedApp and is never echoed. No failure diagnostic serialises a token, a key
// or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// A non-secret routing id, carried on the session_settings reply.
const SESSION_ID = 'session-1022'

// The mode the session sits in throughout. Anything but `auto`, so the trigger's label is never the thing
// under test — this drive is about the ENTRIES. Taken from the production constant by position rather
// than typed, and asserted below to be a mode that survives the filter.
const [BASELINE_MODE] = SETTABLE_PERMISSION_MODES

// The four entries a model can never take away, derived rather than typed: a four-name list here would
// keep passing if the production filter dropped the wrong mode.
const UNCONDITIONAL_MODES = SETTABLE_PERMISSION_MODES.filter((m) => m !== AUTO_PERMISSION_MODE)

function row(
  over: Partial<WireModelOption> & Pick<WireModelOption, 'value' | 'display_name'>
): WireModelOption {
  return {
    resolved_model: `${over.value}-resolved`,
    effort_levels: ['steady'],
    supports_auto_mode: true,
    truncated_fields: null,
    ...over
  }
}

// Mutually non-substring, and nothing here collides with a permission-mode label — the trigger locators
// below are `exact`, but the model trigger draws into the same row.
//
// THE SETTLE SIGNAL RIDES `resolved_model` SINCE #1095, not `display_name`. That control now shows a FAMILY
// derived from the matched row's `resolved_model` (falling back to its `value`), so `row()`'s default
// `${value}-resolved` would derive the same `Refuser` the pre-list label already shows, and the two
// `modelLabel` reads below would both be vacuous — the second one worst of all, since it is the only
// barrier proving the REPLACEMENT frame landed before the panel is reopened. Each row therefore carries a
// `resolved_model` naming a family of its own, which restores an observable change at every tick.
const REFUSING = row({
  value: 'refuser',
  display_name: 'Refusing pick',
  resolved_model: 'refusing-1',
  supports_auto_mode: false
})
const ACCEPTING = row({ value: 'accepter', display_name: 'Accepting pick' })

// The replacement frame's version of the same row, now accepting. Its `resolved_model` changes too, and
// that is deliberate: the MODEL trigger derives its label from it, so it gives this drive an observable
// settle signal for an unsolicited frame whose only other effect is inside a panel that is closed at the
// time. `Relenting` must differ from both `Refusing` and the pre-list `Refuser`, or the barrier is gone.
const RELENTED = row({
  value: REFUSING.value,
  display_name: 'Relenting pick',
  resolved_model: 'relenting-1'
})

// The families the two frames put on the model trigger — stated by hand rather than by re-implementing the
// production derivation in the test.
const REFUSING_FAMILY = 'Refusing'
const RELENTED_FAMILY = 'Relenting'

// The baseline the read request is answered with. Its model is the REFUSING row's published value
// verbatim, so exact equality selects that row.
const BASELINE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: REFUSING.value,
  effort: 'steady',
  yolo: false,
  permission_mode: BASELINE_MODE,
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

// The coarse turn-phase scalar, pushed unsolicited exactly as queued-backlog-interrupt.spec.ts pushes it.
// A thinking → idle pair is a TURN-END EDGE, which is what makes the app ask for a session-settings
// snapshot. A lone idle fires nothing.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// The unsolicited push, keyed to the conversation the app opens. Each frame REPLACES the conversation's
// list wholesale, which is what lets the drive below flip the matched row's flag without touching the
// session's model.
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

function replyFrames(inbound: Uint8Array): Uint8Array[] {
  const env = decodeEnvelope(inbound)
  switch (env.type) {
    case 'list_conversations':
      return [seedConversationsFrame()]
    case 'request_session_settings':
      return [sessionSettingsFrame(env.id)]
    default:
      return []
  }
}

test('composer footer: the permission-mode menu hides auto on a model that refuses it (AC1-AC5)', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: replyFrames })

  const label = page.locator('.composer__permission-label')
  const modelLabel = page.locator('.composer__model-label')
  const panel = page.getByRole('menu', { name: 'Permission mode', exact: true })
  // EXACT is load-bearing on the trigger locator: getByRole's `name` matches as a case-insensitive
  // SUBSTRING by default, and the panel rows carry these same names.
  const trigger = page.getByRole('button', {
    name: PERMISSION_MODE_LABELS[BASELINE_MODE],
    exact: true
  })
  const displayed = (mode: string): string => PERMISSION_MODE_LABELS[mode]

  // The baseline mode must be one the filter keeps, or every assertion below would be measuring the
  // trigger rather than the entries. Derived, so a reordering of the production constant fails here
  // loudly instead of quietly weakening the drive.
  expect(UNCONDITIONAL_MODES).toContain(BASELINE_MODE)

  // --- The snapshot has to arrive before this control can say anything. Since #1166 the app asks for one
  // on CONVERSATION OPEN as well as on the connected edge and at each TURN END (runConfigLive), and
  // `launchPairedApp` navigates by clicking the seeded row — so the fake's baseline reply has already
  // landed here and the row is live from launch. The pushed thinking → idle pair is still that turn-end
  // edge, and it re-asks for the same baseline. ---
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))
  await expect(label).toHaveText(displayed(BASELINE_MODE), { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- AC2 END TO END, and it is only reachable HERE: no `model_list` has arrived, so the client does not
  // positively know anything about the running model and the menu is exactly what #682 shipped. This step
  // is what makes the next one falsifiable — without it, an implementation that hid `auto` unconditionally
  // would pass the rest of this drive. ---
  await trigger.click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('menuitem')).toHaveText(SETTABLE_PERMISSION_MODES.map(displayed))
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // --- The list arrives unsolicited. Exact equality on `value` resolves the session's model to the
  // REFUSING row, whose `supports_auto_mode` is false. The second row accepts, so the flag is read per ROW
  // rather than per list. The model trigger's label is the settle signal: it renders the family of the
  // matched row's `resolved_model` (#1095), so once it reads REFUSING's the store tick has been
  // committed — and before the list it read `Refuser`, from the session model, so this is a real move. ---
  daemon.pushFrame(modelListFrame([REFUSING, ACCEPTING]))
  await expect(modelLabel).toHaveText(REFUSING_FAMILY, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // The permission trigger has NOT moved: hiding an entry never changes what the trigger says.
  await expect(label).toHaveText(displayed(BASELINE_MODE))

  // --- AC1 and AC5. Exactly the four remaining modes, by display name, in their existing order —
  // toHaveText on an array is exact and ordered, so a dropped, invented, reordered or extra entry fails
  // here. And `Auto` is gone rather than merely unmarked. ---
  await trigger.click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('menuitem')).toHaveText(UNCONDITIONAL_MODES.map(displayed))
  await expect(
    panel.getByRole('menuitem', { name: displayed(AUTO_PERMISSION_MODE), exact: true })
  ).toHaveCount(0)
  // AC4: shorter, never empty and never inert. The trigger is still a real menu button over a real panel,
  // and this control still has no nothing-to-offer arm — unlike both its neighbours.
  await expect(panel.getByRole('menuitem')).toHaveCount(UNCONDITIONAL_MODES.length)
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // --- The join is LIVE, per row, rather than a one-way latch: a replacement frame says the same model
  // now accepts `auto` and the entry comes back. Without this step, an implementation that hid the entry
  // permanently on the first refusing frame would pass everything above. ---
  daemon.pushFrame(modelListFrame([RELENTED, ACCEPTING]))
  await expect(modelLabel).toHaveText(RELENTED_FAMILY, { timeout: ROUNDTRIP_TIMEOUT_MS })

  await trigger.click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('menuitem')).toHaveText(SETTABLE_PERMISSION_MODES.map(displayed))
})
