import { test, expect } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for the PAIRED REGION's inner navigation (#465, split from #429). Every navigation
// target inside the paired app is a PairedRoute driven by the pure `nextPairedRoute` reducer in
// PairedShell (`list`, `thread`, `settings`, `archive`, `pairServer`); only the single list→thread step
// the launcher itself performs has e2e coverage today. This spec drives the REAL product-UI controls
// through the remaining transitions so a routing regression can't leave a screen unreachable or
// unrendered. Zero production code — every screen and control already ships (#141 list, #333 settings,
// #347 archive, #152 pair-another, #140 paired entry); this is a pure coverage add.
//
// ONE test() block, ONE launch, ONE continuous drive: none of these transitions mutate persistent or
// session state (no unpair, no promote, no one-way flip), so a single drive covers all four ACs without a
// second launchPairedApp() (each launch pays the full handshake). Default seed (no options) is all that's
// needed — nav-only, so no daemon.pushFrame, no custom buildReplyFrames, no codec import (the
// pair-to-conversation skeleton's shape).
//
// ⭐ TEARDOWN IS PROVABLE ONLY VIA THE Cancel→Settings ROUND-TRIP, NOT THE PAIRING SURFACE. The
// `pairServer` route and the app-root pairing route render the SAME PairingScreen component, so an
// assertion made while ON the pairing surface (step 4) cannot distinguish an in-shell pair-another
// (session intact) from a torn-down session (session gone) — the DOM is byte-identical. The observable
// that separates them is the Cancel destination (step 5): in-shell Cancel dispatches `pairServerCancelled`,
// which the reducer lands on `settings`, so the Settings screen renders AGAIN with the shell (and session)
// intact. Step 5's Settings assertion IS the teardown proof (the #440-realizability discipline).
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM attributes / text /
// visibility only; the pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is
// never echoed. No failure diagnostic serialises a token, key, or plaintext.

test('paired shell: pair-another-server round-trip and the list/settings/archive back-chain', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  // Arrival hooks (distinctive root per screen) + the controls to leave/advance. The three back buttons
  // (thread / settings / archive) all expose the identical accessible name 'Back', so they are selected by
  // their screen-scoped class, not by role-name — self-documenting, matching the launcher's
  // `.channel-list__row-open` idiom.
  const thread = page.locator('.conversation')
  const list = page.locator('section[aria-label="Conversations"]')
  const settings = page.locator('section[aria-label="Settings screen"]')
  const archive = page.locator('section[aria-label="Archive screen"]')
  // #664: the pairing route's hook is the field's accessible name ALONE — not the card heading, which
  // #665's restyle removes, and not the element type, which it changes. Attribute selector, matching the
  // idiom above; the accessible-name query helper is deliberately absent from this whole suite, since it
  // resolves the label element as well as the control, and #665's filled field wraps the control in a
  // <label> that would then match a second time — the very count ambiguity #664 removes.
  const pairingField = page.locator('[aria-label="Pairing code"]')

  // 1. thread — the fixture's end-state (it drove list→thread by clicking the seeded row). The back-nav
  // chain begins here.
  await expect(thread).toBeVisible()

  // 2. thread → list (AC: back from thread lands on list).
  await page.locator('.conversation__back').click()
  await expect(list).toBeVisible()

  // 3. list → settings (open the gear entry).
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings).toBeVisible()

  // 4. settings → pairServer (AC: "Pair another server" opens the in-shell pairing flow). Asserting the
  // pairing entry surface here proves the route renders; it does NOT prove the session survived — the
  // pairServer route and the app-root pairing route render the SAME component (see the round-trip note).
  await page.getByRole('button', { name: 'Pair another server' }).click()
  await expect(pairingField).toBeVisible()

  // 5. ⭐ pairServer → settings via Cancel (AC: Cancel returns to the Settings screen — the teardown proof).
  // A torn-down session would leave the app-root pairing screen with no Settings to return to; the Settings
  // screen rendering AGAIN is what proves the shell (and session) was never torn down.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(settings).toBeVisible()

  // 6. settings → list (AC: back from settings lands on list).
  await page.locator('.settings__back').click()
  await expect(list).toBeVisible()

  // 7. list → archive (open the archive-box entry).
  await page.getByRole('button', { name: 'Archive' }).click()
  await expect(archive).toBeVisible()

  // 8. archive → list (AC: back from archive lands on list).
  await page.locator('.archive__back').click()
  await expect(list).toBeVisible()
})
