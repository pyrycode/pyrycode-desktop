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
// #670 folded the two-pane shell's GEOMETRY assertions (AC1-AC3) into step 1 rather than adding a second
// test() block: they need the same launch on the same thread route, and each launch pays a full
// handshake. They are the first assertions here that read layout (boundingBox) and the Electron window
// (getSize / getMinimumSize) instead of pure DOM presence.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM attributes / text /
// visibility / geometry only; the pairing plumbing (synthetic token, fake static key) lives in
// launchPairedApp and is never echoed. No failure diagnostic serialises a token, key, or plaintext.

// #670: the two-pane shell's fixed sidebar width (Figma Sidebar 103:736, `w-[400px] shrink-0`) and the
// window's minimum width, both asserted below. NARROWING rather than widening is deliberate: a wider
// window can be clamped by the display's work area on a small CI screen, which would fail for a reason
// that has nothing to do with the layout. 1100 (the launch width) − 200 = 900, comfortably above the
// 800 floor, so neither clamp can fire and the delta is exactly what was asked for.
const SIDEBAR_WIDTH_PX = 400
const MIN_WINDOW_WIDTH_PX = 800
const NARROW_BY_PX = 200

test('paired shell: pair-another-server round-trip and the list/settings/archive back-chain', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp()

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

  // 1a. #670 AC1 — BOTH panes at once. The fixture reached this line by CLICKING a list row, which is
  // exactly the step that used to unmount the list, so the pair of assertions is non-vacuous by
  // position: `list` visible HERE is the "selecting a conversation does not hide the sidebar" proof.
  await expect(list).toBeVisible()

  // 1b. #670 AC2 — the sidebar is exactly 400px and stays 400px across a resize, while the chat pane
  // absorbs the entire delta. boundingBox() returns null for a detached/hidden node; the ?? -1 sentinel
  // (a width no real box can have) keeps the poll retrying instead of throwing on the way there.
  const sidebarWidth = async (): Promise<number> =>
    (await page.locator('.paired-shell__sidebar').boundingBox())?.width ?? -1
  const paneWidth = async (): Promise<number> =>
    (await page.locator('.paired-shell__pane').boundingBox())?.width ?? -1

  await expect.poll(sidebarWidth).toBe(SIDEBAR_WIDTH_PX)
  const paneBefore = await paneWidth()
  expect(paneBefore).toBeGreaterThan(0)

  // setSize is asynchronous — it resolves in the main process before the renderer has laid out the new
  // viewport — so both post-resize assertions poll. Width delta only; the height is passed through
  // unchanged so nothing here depends on the platform's title-bar chrome.
  const [startWidth, startHeight] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  )
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: startWidth - NARROW_BY_PX, height: startHeight }
  )
  await expect.poll(paneWidth).toBe(paneBefore - NARROW_BY_PX)
  await expect.poll(sidebarWidth).toBe(SIDEBAR_WIDTH_PX)
  // The window is deliberately LEFT narrowed for the rest of the drive — steps 3-8 are full-screen
  // sections, so running them at 900px costs nothing and incidentally proves they render there too.

  // 1c. #670 AC3 — the window cannot be sized below 800px wide. Read the constraint off the real
  // BrowserWindow rather than trying to drive it past the floor: a setSize the OS clamps is
  // indistinguishable from a setSize the app ignored, so the getter is the sharper observable.
  const [minWidth] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  expect(minWidth).toBe(MIN_WINDOW_WIDTH_PX)

  // 2. thread → list (AC: back from thread lands on list). #670 re-pointed this assertion: the list is
  // now ALWAYS on screen, so `expect(list).toBeVisible()` here would pass for free and prove nothing.
  // The real signal — the one the four archive/delete specs already rely on — is the chat pane emptying
  // (AC4: `null`, not a mounted-but-blank ConversationScreen). Back's meaning became "deselect", and
  // this is what deselecting looks like.
  await page.locator('.conversation__back').click()
  await expect(thread).toHaveCount(0)

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
