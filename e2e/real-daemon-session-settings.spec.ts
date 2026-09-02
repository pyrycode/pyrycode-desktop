import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'

// #481 — the missing half of #442. `set_session_settings` (model / effort / YOLO from the run-config
// sheet) shipped with no real-wire test: #442 scoped "run-controls over the real wire" but closed with
// only the dequeue half landed. Every existing spec covering this sheet talks to a fake daemon, which
// answers anything — the exact #949 shape, where the daemon defined a type and payload but registered
// NO handler, the real wire answered `unsupported`, and the whole client suite stayed green.
//
// This is the claude-less tier (`spawnClaude: false`) that #481 asked for, and it can be: the write is
// a pure session-pool mutation and the read is three primitive seam reads, so neither half needs a
// claude child. That makes this cheap enough to sit in the everyday gate rather than the credentialed
// one.
//
// WHAT MAKES IT A LIVENESS TEST rather than a render test: the assertion is on the round trip, not on
// the click. Selecting a model marks it current only after the daemon replies; closing and reopening
// the sheet re-reads over the wire. So a daemon that loses the write, or answers the read with a
// default instead of the stored value, fails here — while a client-only regression that never sends
// the frame fails at the same assertion. Both are the failure this exists to catch.
//
// SECRET HYGIENE: every assertion reads DOM text, visibility, or counts. The pairing payload is built
// the same way as the sibling specs and is never echoed into a message or a failure diagnostic.

test.use({ spawnClaude: false, seedPromoted: true })

const HANDSHAKE_TIMEOUT_MS = 45_000
// A session-settings write plus its reply-gated re-render. No claude turn to absorb, so this is tight
// on purpose — a timeout here means the daemon did not answer, which is the signal.
const ROUNDTRIP_TIMEOUT_MS = 15_000
const SPEC_TIMEOUT_MS = 120_000

const SONNET_ROW = 'Sonnet'

test('real daemon persists a session-settings write and returns it on a fresh read', async ({
  relay,
  daemon,
  page
}) => {
  test.setTimeout(SPEC_TIMEOUT_MS)

  const payload = encodePairingPayload({
    server: daemon.pairFields.server,
    relay: `${relay.url}/v1/client`,
    token: daemon.pairFields.token,
    server_static_pubkey: daemon.pairFields.server_static_pubkey
  })

  await pairFromUnpairedLaunch(page, payload)

  // The seeded promoted row rendering IS the connected gate (the launchPairedApp idiom): it appears
  // only once the handshake completed and the auto-fired list_conversations reply came back.
  const seededRow = page.locator('.channel-list__row-open')
  await expect(seededRow).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })
  await seededRow.click()

  const conversation = page.locator('.conversation')
  await expect(conversation).toBeVisible({ timeout: HANDSHAKE_TIMEOUT_MS })

  // --- Open the sheet. Per-control locators mirror run-config-settings.spec.ts so the two specs stay
  // readable side by side; `.run-config__model-row` is not unique, hence the hasText narrowing.
  //
  // #962 retired the collapsed status row that used to be the one-click trigger, so opening is now the
  // two-step overflow path (the conversation-create-rename.spec.ts idiom). It is a HELPER rather than a
  // locator constant because this spec opens the sheet TWICE and the second open is load-bearing — see
  // the read below — so both must go through the same sequence from one definition.
  const openRunConfiguration = async (): Promise<void> => {
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  }
  const modelRow = (name: string) => page.locator('.run-config__model-row', { hasText: name })
  const selectedRadioIn = (name: string) =>
    modelRow(name).locator('[aria-label="Current model"]')

  await openRunConfiguration()
  await expect(modelRow(SONNET_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- The write. Reply-gated: the row is marked current only after the daemon answers, so a missing
  // or broken `set_session_settings` handler times out here rather than passing on optimistic UI.
  await modelRow(SONNET_ROW).click()
  await expect(selectedRadioIn(SONNET_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- The read, on a fresh sheet. Closing unmounts the run-config container, so reopening fires a new
  // `request_session_settings` and the mark below can only come from the daemon's reply — not from
  // state the previous open left behind. This is the half #491 restored and the half that was never
  // covered against a real daemon.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.run-config__model-row')).toHaveCount(0)

  await openRunConfiguration()
  await expect(selectedRadioIn(SONNET_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // Exactly one model is marked, so a daemon that answered with every field set would fail here.
  await expect(page.locator('[aria-label="Current model"]')).toHaveCount(1)
})
