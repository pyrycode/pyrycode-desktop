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

// Composer recovery preserves saved hosts; explicit removal is covered by the Settings specs.
test('re-pair: a fatal relay close surfaces Re-pair, which opens recovery beside the sidebar', async ({
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

  await repair.click()
  await expect(pairingBox).toBeVisible()
  await expect(page.locator('.paired-shell__recovery-notice')).toHaveCount(0)
})

test('re-pair with a second server preserves both hosts in the paired shell', async ({
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

  await expect(pairingBox).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings__server-row-id')).toHaveText([serverA.serverId, serverB.serverId])

  await expect(pairingBox).toHaveCount(0)

  // AC2, second half — the pairing-scoped clear did not run either. `clearAllConversations` is one of
  // its thirteen stores and server B's connection saw no `connected` rising edge to re-fetch on, so a
  // row still standing is a clear that never happened. Read back on the list, which Settings replaces.
  await page.locator('.settings__back').click()
  await expect(
    page.locator('.channel-list__row-open').filter({ hasText: rowName(SECOND_SEEDED_ROW) })
  ).toBeVisible()
})
