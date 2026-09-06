import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
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

/**
 * The seeded row's display name, narrowed to a string for a `hasText` filter (#1163).
 *
 * `ConversationSummary.name` is `string | null` on the wire, and NO tsconfig includes `e2e/` while
 * Playwright strips types with esbuild — so a type error here surfaces in no gate at all, and the
 * narrowing is by hand. `?? ''` would be worse than the error it silences: an empty `hasText` matches
 * every row, so a null seed name would quietly select BOTH servers' rows, which is exactly the
 * ambiguity the fixture's deliberately non-overlapping names exist to prevent. Throwing keeps it loud.
 */
function rowName(row: { name: string | null }): string {
  if (row.name === null) throw new Error('the fixture seed must carry a name')
  return row.name
}

// Fake-stack UI e2e for the SESSION-EXIT path back to the app-root pairing screen (#464, split from
// #429). ONE affordance tears down a paired, connected thread and returns the operator to the app-root
// `PairingScreen`: the terminal-error Re-pair escape hatch (#167), funnelling through `runUnpair` →
// `onLastServerUnpaired()` → App-level `setRoute('pairing')`. Only the initial pairing happy path has
// coverage otherwise; this exit path had none, so a routing regression could strand the operator on a
// dead thread. Since #1163 that funnel is CONDITIONAL — it fires only when the erase left nothing
// paired — so this first test is the last-server case and the second test below is the other half. Zero production code — the control already ships; this pins the exit behaviour. It adds two
// test-only infra pieces (a fatal-close hook on the fake forwarder + exposing the forwarder on the
// launcher handle) so the terminal-error path is reachable on the fake stack.
//
// #1061 took the second affordance. The two-phase Unpair control in the thread header (#166) drove the
// same flip and had its own test here; that control and the bare `.conversation__header` row it owned
// are deleted — the drawing's Content frame (Figma 106:3321) has no header row of any kind — so the
// test went with it rather than being skipped. The property this spec exists to protect is unchanged
// and still covered: the exit path back to pairing still reddens here if the routing breaks. Unpairing
// a HEALTHY pairing has no entry point at all until a successor lands it on a host-level surface (it is
// host-scoped, not conversation-scoped), to be settled with #1070 — an accepted gap, operator ruling
// 2026-09-04, not something this spec should assert about.
//
// The app-root PairingScreen's `Pairing code` field is the unambiguous teardown proof: while on the
// thread the top-level pairing route is NOT mounted (the exit flips the App route, unmounting
// PairedShell entirely), so `[aria-label="Pairing code"]` has count 0; after the flip it is the sole
// pairing surface, and its VISIBILITY is what proves the return-to-pairing. This is a top-level
// App-route flip, not the in-shell pair-another route (#465), so there is no same-component ambiguity
// to disambiguate here.
//
// That accessible name is the WHOLE locator (#664) — never the element type, never the card heading,
// both of which #665's restyle changes. The same rule governs the re-pair affordance: #963 moved it into
// the composer status row's error slot as the design's filled `Button small`, wearing `button-small
// button-small--error`, and it is located by role + accessible name — that name being the button's full
// visible label, `COMPOSER_REPAIR_BUTTON_COPY`, imported rather than retyped so a copy change cannot
// leave this spec passing against a string nothing renders.
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
  //
  // #1163 made the flip CONDITIONAL on the refreshed collection coming back empty, so this launch —
  // one paired server, now forgotten — is the LAST-SERVER case, and the assertion is unchanged for
  // exactly that reason. The two-server case, where the flip must NOT happen, is the test below.
  await repair.click()
  await expect(pairingBox).toBeVisible()
})

// #1163: the same affordance against TWO paired servers. Re-pair now forgets only the server whose
// conversation is open — through the per-server channel #1149 shipped — and the route flip that used to
// follow every successful unpair is conditional on nothing being left paired. Before this slice,
// recovering server A's dead connection erased server B's record too, dropped its live connection, ran
// the thirteen-store clearPairingScopedState and threw the whole app back to the pairing screen. That
// failure is entirely renderer-side and nothing in this repo can click, so this is the only tier that
// can see it.
//
// THE ORDER OF THE THREE READS IS THE ARGUMENT, not a convenience. `pairingBox` has count 0 for the
// whole launch, so asserting it first would pass before the unpair had even resolved — it cannot
// distinguish "did not flip" from "has not flipped yet". The Settings-row read is what makes it
// meaningful: it AUTO-WAITS for the first server's row to leave, so by the time it passes the erase has
// demonstrably landed, and it could not have been reached at all from the pairing screen. Only then is
// the absence of a flip a fact rather than a race.
//
// Row identity is read as the ARRAY FORM of `toHaveText` over `.settings__server-row-id`, never a text
// filter: the fixture's two ids are 'fake-daemon' and 'fake-daemon-2', the first a SUBSTRING of the
// second, and Playwright's `hasText` is a case-insensitive substring match. That is
// `settings-per-server-unpair.spec.ts`'s own assertion, reused deliberately.
//
// SECRET HYGIENE, as above: every assertion reads DOM text, visibility or a small integer. A failure
// diff can print a server id — which `serverInfoHandler` already vets as non-secret — never a payload,
// a token, a key or a relay URL.
test('re-pair with a second server paired forgets only its own, and stays in the paired shell', async ({
  launchPairedApp
}) => {
  const { page, servers } = await launchPairedApp({}, { secondServer: {} })
  const [serverA, serverB] = servers

  const pairingBox = page.locator('[aria-label="Pairing code"]')

  // With a second server opted in the fixture finishes on the LIST (the second pairing routes to the
  // new server's list), so the list→thread step is this spec's own. Filtering by row name is safe where
  // filtering by server id is not: the two seeded names share no substring, which the fixture chose
  // deliberately for exactly these per-server specs.
  await page
    .locator('.channel-list__row-open')
    .filter({ hasText: rowName(SEEDED_ROW) })
    .click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Server A's leg only. 4401 ∈ the client's DEFAULT_FATAL_CLOSE_CODES, so its supervised client
  // classifies the close as terminal and arms no re-dial; server B's forwarder is untouched and its
  // connection stays live and un-handshaken throughout.
  serverA.forwarder.closeClientLeg(4401)

  const repair = page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })
  await expect(repair).toBeVisible()
  await repair.click()

  // AC1 — exactly one record left, and it is the OTHER machine's. The Settings list is re-read from
  // main by the unpair itself (`refreshServers`), so these rows are what main says, not a locally
  // mutated copy.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([serverB.serverId])

  // AC2, first half — the app never left the paired shell. Meaningful here and nowhere earlier: the
  // erase has landed (above), and the app-root pairing screen would have unmounted PairedShell
  // entirely, so Settings could not have been opened from it.
  await expect(pairingBox).toHaveCount(0)

  // AC2, second half — the pairing-scoped clear did not run either. `clearAllConversations` is one of
  // its thirteen stores and server B's connection saw no `connected` rising edge to re-fetch on, so a
  // row still standing is a clear that never happened. Read back on the list, which Settings replaces.
  await page.locator('.settings__back').click()
  await expect(
    page.locator('.channel-list__row-open').filter({ hasText: rowName(SECOND_SEEDED_ROW) })
  ).toBeVisible()
})
