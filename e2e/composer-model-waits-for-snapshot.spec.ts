import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ModelListPayload,
  SessionSettingsPayload,
  TurnStatePayload,
  WireModelOption,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1495 — the composer footer's model label with NO SNAPSHOT under it. The static
// tier pins the decision as data (ComposerModelMenu.test.tsx's `#1495` block), and only a real window can
// prove the CONTAINER supplies the distinction the pure function now separates: the layer is assembled
// from `runConfigStore` in the container, and a container that kept collapsing `snapshot === null` into
// `''` would pass every unit case in this repo untouched.
//
// THE DEFECT THIS DRIVES. Since #1423 an empty shown string resolves the daemon's inherited-default row,
// and the container flattened "no snapshot has arrived" into that same input — so a chat whose snapshot
// had not landed drew the inherited-default row's family anyway, on a chat whose real model may be
// something else. `activateConversation` clears `runConfigStore` on every switch but deliberately never
// clears `modelListStore`, so the list outlives the clear and the row stays resolvable across it. On
// 2026-09-15 a daemon restart widened that from one round trip to the whole pre-message window.
//
// composer-model-menu.spec.ts's template throughout — its frame builders, its capturing reply factory and
// its one-launch/one-drive shape. TWO DEPARTURES, both load-bearing:
//
//   1. The `request_session_settings` reply is WITHHELD at first, which is what makes the missing snapshot
//      reachable at all. That is the same liberty the sibling takes with the rejection it withholds: the
//      daemon does send this frame, and only its TIMING is the test's. A reply landing inside the same
//      frame the request did would put the snapshot on screen before any assertion could see its absence.
//   2. THE ABSENCE IS ASSERTED BEHIND A BARRIER, never bare. `.composer__model-label` is missing before
//      the app has finished launching too, so a bare `toHaveCount(0)` would pass against a blank window
//      and prove nothing. The barrier is the turn-end edge: `runConfigLive` re-requests the settings on a
//      running → idle transition, so pushing the pair AFTER the model list and waiting for the extra ask
//      to reach the capture proves the list was processed first — frames arrive on one socket in order.
//      The ask count is a sound baseline because the request has exactly three triggers (the connected
//      edge, conversation open, and that transition) and no retry or poll: it cannot move on its own.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// counts and captured wire frames. SESSION_ID, the published values and the display names are non-secret
// routing and display literals; the pairing plumbing lives in launchPairedApp and is never echoed. No
// failure diagnostic serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SESSION_ID = 'session-1495'

// The published rows, and the FIRST one is the whole point: the daemon publishes its own inherited default
// as an ordinary row (pyrycode#2124's captured `initialize` reply), which is the row #1423 resolves for an
// empty model and the row this drive must NOT see resolved while no snapshot has arrived.
//
// Its two fields name DIFFERENT families on purpose, exactly as the sibling spec seeds them: the trigger
// reads a matched row's `resolved_model` (`Sonnet`) and a ROW reads its own `value` (`Default`). One label
// could otherwise be produced by the wrong half of the rule and still read correctly.
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
  }
]

// What the two halves of the source chain derive to for the inherited-default row above.
const TRIGGER_FAMILY = 'Sonnet'
const ROW_FAMILY = 'Default'

// The snapshot delivered LATE, and its model is `''` — not an absence but the reading the wire contract
// calls the daemon's inherited default, which #1423 resolves a row for and this ticket leaves untouched.
const EMPTY_MODEL_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: '',
  effort: 'low',
  yolo: false,
  // Required since #1020 — a missing key is decode-rejected at runtime and reads as the controls never
  // mounting, which would make every assertion below vacuous rather than red.
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
    payload: EMPTY_MODEL_RUN_CONFIG
  })
}

// The coarse turn-phase scalar, pushed unsolicited exactly as the sibling specs push it. A thinking → idle
// pair is the TURN-END EDGE, and here it is the drive's barrier rather than a way of getting a snapshot.
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

// The one unsolicited push, keyed to the conversation the app opens — the frame the daemon publishes
// unprovoked from the conversation's initialize reply.
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

/** The capturing reply factory. `request_session_settings` is answered with NOTHING — the test body
 *  delivers that reply itself, correlated by an id it reads back off the capture. */
function capturingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    return env.type === 'list_conversations' ? [seedConversationsFrame()] : []
  }
}

function settingsAsks(captured: Envelope[]): Envelope[] {
  return captured.filter((e) => e.type === 'request_session_settings')
}

test('composer footer: the model label waits for a snapshot, then resolves the inherited default (AC1, AC2)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  // The label lives in its own element in BOTH renderings — the inert one and the operable one — so one
  // locator reads it throughout, and its ABSENCE is unambiguous: there is exactly one model control.
  const label = page.locator('.composer__model-label')
  const panel = page.getByRole('menu', { name: 'Model', exact: true })

  // --- The window is up and the footer row has rendered. This is what stops AC1's assertion from passing
  // against a blank window: the composer exists, the row exists, and the only thing missing from it is
  // the control under test. `launchPairedApp` navigates by clicking the seeded row, so the conversation
  // is open and its settings have been asked for — and gone unanswered. ---
  await expect(page.locator('textarea.composer__input')).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.composer__footer')).toHaveCount(1)
  await expect.poll(() => settingsAsks(captured).length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBeGreaterThan(0)

  // --- AC1. The list arrives and is HELD with no snapshot under it, which is the state a switch leaves
  // behind: the activation clear empties `runConfigStore` and deliberately spares `modelListStore`. The
  // baseline is read immediately before the pushes and cannot drift — the ask has three triggers and none
  // of them fires unprompted. ---
  const asksBefore = settingsAsks(captured).length
  daemon.pushFrame(modelListFrame())
  daemon.pushFrame(turnStateFrame('thinking'))
  daemon.pushFrame(turnStateFrame('idle'))
  await expect
    .poll(() => settingsAsks(captured).length, { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toBeGreaterThan(asksBefore)

  // The list is now demonstrably held and the inherited-default row in it is resolvable — and the footer
  // says nothing about the model anyway. Before this ticket the trigger read `Sonnet` here.
  await expect(label).toHaveCount(0)

  // --- AC2. The withheld reply, delivered late and correlated by the id the app itself minted — read back
  // off the capture, which is the only place the test can learn it. Its model is `''`, so #1423's branch
  // must fire exactly as it shipped. ---
  const ask = settingsAsks(captured).at(-1)
  expect(ask).toBeDefined()
  daemon.pushFrame(sessionSettingsFrame(ask!.id))

  // The trigger appears and reads the matched row's `resolved_model` family — `Sonnet`, which no ROW
  // wears, so this cannot be satisfied by a row's own label leaking into the trigger.
  await expect(label).toHaveText(TRIGGER_FAMILY, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC2's marking half, through the real panel: the inherited-default row is current, and the only one.
  // `exact` is load-bearing — getByRole's `name` matches as a case-insensitive SUBSTRING by default.
  await page.getByRole('button', { name: TRIGGER_FAMILY, exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(panel.locator('[aria-current="true"]')).toHaveText(ROW_FAMILY)
})
