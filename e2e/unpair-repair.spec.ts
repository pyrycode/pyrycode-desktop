import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for the SESSION-EXIT path back to the app-root pairing screen (#464, split from
// #429). Two affordances tear down a paired, connected thread and return the operator to the app-root
// `PairingScreen`, and both funnel through the same `runUnpair` → `onUnpaired()` → App-level
// `setRoute('pairing')` flip: the two-phase Unpair control in the thread header (#166), and the
// terminal-error Re-pair escape hatch (#167). Only the initial pairing happy path has coverage today;
// this exit path has none, so a routing regression could strand the operator on a dead thread. Zero
// production code — every control already ships; this pins the exit behaviour. The Re-pair trigger adds
// two test-only infra pieces (a fatal-close hook on the fake forwarder + exposing the forwarder on the
// launcher handle) so the terminal-error path is reachable on the fake stack.
//
// The app-root PairingScreen's `Pairing code` textarea is the unambiguous teardown proof: while on the
// thread the top-level pairing route is NOT mounted (both exits flip the App route, unmounting
// PairedShell entirely), so `textarea[aria-label="Pairing code"]` has count 0; after the flip it is the
// sole pairing surface. Its VISIBILITY proves the return-to-pairing; its ABSENCE (count 0) proves the
// session stayed intact on Cancel. This is a top-level App-route flip, not the in-shell pair-another
// route (#465), so there is no same-component ambiguity to disambiguate here.
//
// The four Unpair/Cancel/Confirm/Re-pair buttons all carry the `conversation__unpair` class, so they
// are selected by role + accessible name (never by class); only one is present at a time given the
// phase, so the names disambiguate.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM visibility /
// enabled-state / count only; the pairing plumbing (synthetic token, fake static key) lives inside
// launchPairedApp and is never echoed. No failure diagnostic serialises a token, key, pairing payload,
// or close reason.

test('unpair: Cancel keeps the session, then Confirm returns to the app-root pairing screen', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  const thread = page.locator('.conversation')
  const send = page.getByRole('button', { name: 'Send' })
  const pairingBox = page.locator('textarea[aria-label="Pairing code"]')
  const forgetPrompt = page.getByText('Forget this pairing?')
  const unpair = page.getByRole('button', { name: 'Unpair', exact: true })

  // Fixture end-state: on the thread, Send enabled (session live), app-root pairing route not mounted.
  await expect(thread).toBeVisible()
  await expect(send).toBeEnabled()

  // AC2 — Cancel keeps the session. Open the confirm prompt, then back out.
  await unpair.click()
  await expect(forgetPrompt).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  // Session intact: thread still mounted, Send still enabled, no app-root pairing surface, control back
  // to idle.
  await expect(thread).toBeVisible()
  await expect(send).toBeEnabled()
  await expect(pairingBox).toHaveCount(0)
  await expect(unpair).toBeVisible()

  // AC3 — re-open the confirmation (same launch) and Confirm returns to the app-root PairingScreen.
  await unpair.click()
  await expect(forgetPrompt).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(pairingBox).toBeVisible()
})

test('re-pair: a fatal relay close surfaces Re-pair, which returns to the app-root pairing screen', async ({
  launchPairedApp
}) => {
  const { page, forwarder } = await launchPairedApp()

  const pairingBox = page.locator('textarea[aria-label="Pairing code"]')

  // The client leg is connected once the fixture resolves (Send-enabled ⇐ the Noise handshake completed
  // over the live relay socket), so fire the fatal close immediately. 4401 ∈ the client's
  // DEFAULT_FATAL_CLOSE_CODES, so the supervised client classifies it as terminal (non-retryable) and
  // arms no re-dial — no reconnect races the assertion.
  forwarder.closeClientLeg(4401)

  // AC4 — the fatal close → terminal → `error` status → shouldOfferRepair true → Re-pair renders below
  // the composer; Playwright auto-wait absorbs the close → terminal → re-render latency.
  const repair = page.getByRole('button', { name: 'Re-pair', exact: true })
  await expect(repair).toBeVisible()

  // Clicking Re-pair runs the same runUnpair flow → App `setRoute('pairing')` → app-root PairingScreen.
  await repair.click()
  await expect(pairingBox).toBeVisible()
})
