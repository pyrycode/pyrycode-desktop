import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import {
  PERMISSION_MODE_LABELS,
  SETTABLE_PERMISSION_MODES
} from '../src/renderer/src/screens/conversation/ComposerPermissionModeMenu'

// #682/AC5 — the LIVENESS NET for a permission-mode change over the real stack. The fake-tier twin
// (e2e/composer-permission-mode-menu.spec.ts) proves the client wiring end to end against a daemon that
// answers anything; this is the tier that catches the #949 shape, where the daemon defines a type and a
// payload but registers no handler for the field, the real wire answers with an error, and the whole fake
// suite stays green. `permission_mode` is a 2026 addition to `set_session_settings` (pyrycode#1687) whose
// only client consumer is this control, so it has never been exercised against a real daemon at all.
//
// WHY THIS TIER SPAWNS CLAUDE, unlike real-daemon-session-settings.spec.ts's YOLO drive. The mode is read
// off `session_settings.permission_mode`, and the daemon reports `''` — "no session was resolved" — until
// a session actually exists. Claude-less there is no session, so the control never renders and there is
// nothing to click. One real turn is the cheapest way to resolve one.
//
// REAL-CLAUDE DIVERGENCES from the fake twin (the only deltas — the real-daemon-workspace.spec.ts doc
// discipline):
//   - NO `daemon.pushFrame`: the real daemon owns the turn lifecycle and answers every request itself. The
//     snapshot arrives because a real turn really ended, not because a frame was scripted.
//   - NO outbound frame capture: the daemon is a SEPARATE process behind the content-blind relay, so the
//     twin's in-process capture (`settingsFramesMatching`, the deep equal on the payload) is unavailable.
//     Every assertion here reads DOM text and counts only.
//   - THE BASELINE IS READ, NEVER ASSUMED. The daemon's default posture is its own, and the seeded session
//     carries no settings object, so the mode to pick is derived from what the button actually says.
//
// ACCEPTED LIMITATION, stated rather than papered over, and it is the same one
// real-daemon-session-settings.spec.ts records for its own re-read: `runSettingsWriteStore.confirmed` is
// an app-level per-field override that outlives the re-read, so the post-change label is not PROVABLY
// snapshot-sourced. What the drive does prove is the failure this tier exists to catch — a daemon that
// refuses `permission_mode`, or has no handler for it, replies with an error, the store drops the pending
// marker WITHOUT committing an override, and the label rolls back to the daemon-reported baseline, which
// fails the final assertion. Do NOT try to strengthen this into a snapshot-provenance proof by asserting
// the label alone; that needs a renderer state reset the harness does not have.
//
// SECRET HYGIENE: every assertion reads DOM text or counts. The pairing payload is built the same way as
// the sibling specs and is never echoed into a message or a failure diagnostic. The mode values and their
// display names are client-owned display literals.

const HANDSHAKE_TIMEOUT_MS = 45_000
// One turn = cold claude (spawn + model load + first reply), the sibling specs' per-turn budget.
const TURN_TIMEOUT_MS = 120_000
// Handshake + 2×turn + the settings round-trip + headroom.
const SPEC_TIMEOUT_MS = 300_000
// A settings write and its reply-gated re-render. No claude turn to absorb, so this is tight on purpose —
// a timeout here means the daemon did not answer, which is the signal.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// The streaming cursor is a child of the assistant bubble; its absence is the per-turn quiesce signal, and
// a quiesced turn is what makes the app ask for a fresh session-settings snapshot (runConfigLive).
const CURSOR_SELECTOR = '.bubble__cursor'

test('real claude applies a permission-mode change picked from the input footer', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  // A per-run nonce so the two turns differ and reruns differ; never asserted on. The single-short-word
  // phrasing (from #854) discourages tool calls, which this drive has no need of.
  const runNonce = Date.now()
  const message = (turn: number): string => `Reply with a single short word. run=${runNonce} turn=${turn}`

  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  const conversation = page.locator('.conversation')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const composer = page.getByPlaceholder('Message…')
  const label = page.locator('.composer__permission-label')
  const panel = page.getByRole('menu', { name: 'Permission mode', exact: true })

  await pairFromUnpairedLaunch(page, payload)

  // --- Precondition: pair, then create the conversation THROUGH THE UI (#448) — the operator flow. The
  // seeded row rendering is the connected gate; the FAB must not be clicked before it. ---
  await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await expect(sendButton).toBeEnabled({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Turn 1: resolve a real session. The control renders NOTHING until the daemon reports a mode, so
  // its appearance is itself the proof that a session resolved and that `permission_mode` came back
  // non-empty over the real wire — the read half (#1020) has never been exercised here either. ---
  await composer.fill(message(1))
  await sendButton.click()
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })
  await expect(label).toBeVisible({ timeout: TURN_TIMEOUT_MS })

  // The daemon's own posture, read rather than assumed. It must be one this client can name: an unmapped
  // mode would render verbatim and would mean the daemon reports a mode outside the measured six, which is
  // a finding in itself rather than something to work around.
  const baseline = (await label.innerText()).trim()
  const named = SETTABLE_PERMISSION_MODES.map((mode) => PERMISSION_MODE_LABELS[mode])
  expect([...named, PERMISSION_MODE_LABELS.bypassPermissions]).toContain(baseline)

  // Pick something the session is NOT already in, so the final assertion is falsifiable: a change to the
  // mode already running would pass whether or not the daemon did anything at all.
  const picked = named.find((name) => name !== baseline)
  expect(picked).toBeDefined()

  // --- The change. The label moves at once (the optimistic overlay, raised in the same dispatch as the
  // pending marker), which is the client half and is already proven at the fake tier. ---
  await page.getByRole('button', { name: baseline, exact: true }).click()
  await expect(panel).toBeVisible()
  await panel.getByRole('menuitem', { name: picked!, exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(label).toHaveText(picked!, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- Turn 2: a second real turn ends, so the app asks the real daemon for a FRESH session-settings
  // snapshot. This is the daemon-required half — a refusal has landed long before this point and would
  // have rolled the label back to the baseline, so the two assertions below fail on a daemon that does not
  // accept `permission_mode`. ---
  await composer.fill(message(2))
  await sendButton.click()
  await expect(page.locator(CURSOR_SELECTOR)).toHaveCount(0, { timeout: TURN_TIMEOUT_MS })

  await expect(label).toHaveText(picked!, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(label).not.toHaveText(baseline)
  // AC4's shape over the real wire: the rejection path raises no footer affordance, so a silently refused
  // change would show up as the rollback above and nothing else.
  await expect(page.locator('.composer__footer [role="alert"]')).toHaveCount(0)
})
