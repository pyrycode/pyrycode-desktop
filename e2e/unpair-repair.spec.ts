import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'
import { COMPOSER_REPAIR_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'

/**
 * The composer status row's three geometric facts (#963 AC3), read in one evaluate so they describe one
 * layout pass rather than three.
 *
 * `groupFromBottom` is the flush-with-the-bottom-edge claim itself: 0 at both row heights. `iconFromBottom`
 * is the "the label does not move" claim, measured on the mark rather than the label because the label
 * (`ThinkingIndicator`) is null at rest and the mark is the group's other, always-present child — both are
 * centred in the same 24px group, so the mark's offset is the label's.
 *
 * All three are read relative to the ROW, never to the viewport. The transition that grows the row also
 * mounts #279's banner, so absolute positions elsewhere in this column change for a reason this row does
 * not own; a viewport-relative reading would pin that instead. (#968 retired the composer's own caption,
 * which used to mount on the same transition and was the second such reason.)
 */
async function readStatusRowGeometry(page: Page): Promise<{
  rowHeight: number
  groupFromBottom: number
  iconFromBottom: number
}> {
  return page.evaluate(() => {
    const row = document.querySelector('.composer-status')
    const group = document.querySelector('.composer-status__activity')
    const icon = document.querySelector('.composer-status__icon')
    if (row === null || group === null || icon === null) {
      throw new Error('the composer status row is not mounted')
    }
    const r = row.getBoundingClientRect()
    return {
      rowHeight: Math.round(r.height),
      groupFromBottom: Math.round(r.bottom - group.getBoundingClientRect().bottom),
      iconFromBottom: Math.round(r.bottom - icon.getBoundingClientRect().bottom)
    }
  })
}

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
// The app-root PairingScreen's `Pairing code` field is the unambiguous teardown proof: while on the
// thread the top-level pairing route is NOT mounted (both exits flip the App route, unmounting
// PairedShell entirely), so `[aria-label="Pairing code"]` has count 0; after the flip it is the sole
// pairing surface. Its VISIBILITY proves the return-to-pairing; its ABSENCE (count 0) proves the
// session stayed intact on Cancel. This is a top-level App-route flip, not the in-shell pair-another
// route (#465), so there is no same-component ambiguity to disambiguate here.
//
// That accessible name is the WHOLE locator (#664) — never the element type, never the card heading,
// both of which #665's restyle changes. What keeps the count-0 half honest is that ONE `pairingBox`
// binding carries both directions in the first test: a stale selector yields count 0 too, so the
// negative would pass vacuously, and only the `toBeVisible()` sharing that same binding catches it.
// Do not inline the selector at either site, and do not split it into a second const.
//
// The three Unpair/Cancel/Confirm buttons all carry the `conversation__unpair` class, so they are
// selected by role + accessible name (never by class); only one is present at a time given the phase, so
// the names disambiguate. The re-pair affordance was a fourth until #963 moved it into the composer
// status row's error slot as the design's filled `Button small`: it wears `button-small
// button-small--error` now and shares no class with those three, so it needs no disambiguation from them
// at all. It is still located by role + accessible name, which is the whole locator (#664) — and that
// name is now the button's full visible label, `COMPOSER_REPAIR_BUTTON_COPY`, imported rather than
// retyped so a copy change cannot leave this spec passing against a string nothing renders.
//
// #963 also gives this spec the row's GEOMETRY to prove, which no renderer spec can reach: the row is
// 24 tall with the slot empty and 32 with the button in it, and the status group stays flush with the
// row's bottom edge across that transition so the label does not move. `readStatusRowGeometry` reads all
// three facts in one evaluate, and the same fatal close that surfaces the button is what drives the
// transition — measured before it and after it, in one launch, so the two readings are comparable.
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
  const pairingBox = page.locator('[aria-label="Pairing code"]')
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

  const pairingBox = page.locator('[aria-label="Pairing code"]')

  // #963 AC3's baseline, read while the session is still live and the slot therefore empty. Taken BEFORE
  // the close so both readings come from one launch and one window size — a second launch would compare
  // two layouts, not one transition.
  const atRest = await readStatusRowGeometry(page)
  expect(atRest.rowHeight).toBe(24)
  expect(atRest.groupFromBottom).toBe(0)

  // The client leg is connected once the fixture resolves (Send-enabled ⇐ the Noise handshake completed
  // over the live relay socket), so fire the fatal close immediately. 4401 ∈ the client's
  // DEFAULT_FATAL_CLOSE_CODES, so the supervised client classifies it as terminal (non-retryable) and
  // arms no re-dial — no reconnect races the assertion.
  forwarder.closeClientLeg(4401)

  // AC1/AC2 — the fatal close → terminal → `error` status → shouldOfferRepair true → the actionable
  // button takes the status row's error slot, and the chip does not (one occupant per slot). Playwright
  // auto-wait absorbs the close → terminal → re-render latency.
  const repair = page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })
  await expect(repair).toBeVisible()
  await expect(page.locator('.composer-status__error')).toHaveCount(0)

  // AC3 — the row grew to fit the button and nothing else moved with it. The button is 32 (16px line plus
  // 8px twice) and the row declares only a min-height, so the button's own box IS the row's height; the
  // group stays flush with the bottom edge, so the mark — and with it the label that shares its 24px
  // group — sits exactly where it did at 24.
  const withButton = await readStatusRowGeometry(page)
  expect(withButton.rowHeight).toBe(32)
  expect(withButton.groupFromBottom).toBe(0)
  expect(withButton.iconFromBottom).toBe(atRest.iconFromBottom)

  // NO ASSERTION ON THE MESSAGE BOX'S POSITION, and the reason is worth recording rather than leaving as
  // an absence. The ticket accepts "the message box moves 8px on this transition" as a terminal-state
  // cost, and the box does move by more than the row's own 8px: the same status change also mounts
  // #279's connection banner above the thread, so two things resize at once and the box's absolute
  // position isolates neither. (A 20px upward movement was measured here before #968 retired the
  // composer's own caption, which used to be a third mover; that figure is stale and is deliberately not
  // re-measured, because no assertion depends on it.)
  // What the row's growth alone does is settled by the column: `.conversation` is a fixed-height
  // flex column whose thread region is `flex: 1 1 auto; min-height: 0`, so a `flex: 0 0 auto` sibling
  // growing is absorbed by the thread. An assertion here would pin the banner's geometry under a name
  // that claims to be about this row.
  //
  // AC3's focus ring. The design draws Default and Hover and no focus state, so the treatment is the UA's
  // and the requirement is that nothing suppresses it — `.button-small` declines `outline: none` on
  // purpose. A keypress first, because Chromium only paints the ring for keyboard-driven focus: after any
  // key the subsequent programmatic focus counts as keyboard intent.
  await page.keyboard.press('Tab')
  await repair.focus()
  const outline = await repair.evaluate((el) => {
    const style = getComputedStyle(el)
    return { style: style.outlineStyle, width: style.outlineWidth }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).not.toBe('0px')

  // AC2 — clicking runs the same runUnpair flow → App `setRoute('pairing')` → app-root PairingScreen. No
  // second clear path and no new IPC; this is #167's wiring, moved.
  await repair.click()
  await expect(pairingBox).toBeVisible()
})
