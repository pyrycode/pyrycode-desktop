import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { COMPOSER_REPAIR_BUTTON_COPY, COMPOSER_RECONNECT_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'

import { encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { RECONNECT_SERVER_CHANNEL } from '../src/shared/ipc/reconnectServer'
import { UNPAIR_SERVER_CHANNEL } from '../src/shared/ipc/unpair'

const rejection = () => encodeEnvelope({ id: 50, type: 'error', ts: '2026-09-19T00:00:00Z',
  payload: { code: 'auth.invalid_token', message: 'private pairing detail', retryable: false } })

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
test('re-pair: a sealed pairing rejection opens a recovery modal', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp()

  const pairingBox = page.locator('[aria-label="Pairing code"]')

  // #963 AC3's baseline, read while the session is still live and the slot therefore empty. Taken BEFORE
  // the close so both readings come from one launch and one window size — a second launch would compare
  // two layouts, not one transition.
  const atRest = await readStatusRowGeometry(page)
  expect(atRest.rowHeight).toBe(24)
  expect(atRest.groupFromBottom).toBe(0)

  // A sealed invalid-token frame establishes pairing rejection; a bare close does not.
  daemon.pushFrame(rejection())

  // #1604: Re-pair is a pill in the conversation's Top overlay, pinned over the message area, and the
  // status row's slot falls through to the existing connection chip.
  const repair = page.locator('.conversation__top-overlay')
    .getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })
  await expect(repair).toBeVisible()
  await expect(page.locator('.composer-status').getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY }))
    .toHaveCount(0)
  await expect(page.locator('.composer-status__error')).toHaveCount(1)

  // The row keeps its 24px at-rest geometry: the chip wears the row's own box, so moving Re-pair out of it
  // is what retires #963's 32px growth on this transition.
  const withChip = await readStatusRowGeometry(page)
  expect(withChip).toEqual(atRest)

  // The pill sits at the message area's top edge and inside its right edge.
  const [areaBox, pillBox] = await Promise.all([
    page.locator('.conversation__message-area').boundingBox(),
    repair.boundingBox()
  ])
  expect(areaBox).not.toBeNull()
  expect(pillBox).not.toBeNull()
  if (areaBox !== null && pillBox !== null) {
    expect(Math.round(pillBox.y)).toBe(Math.round(areaBox.y))
    expect(Math.round(pillBox.x + pillBox.width)).toBe(Math.round(areaBox.x + areaBox.width))
  }

  // AC3's focus ring. The design draws no focus state, so the treatment is the UA's and the requirement
  // is that nothing suppresses it — `.top-overlay-pill` declines `outline: none` on purpose. A keypress
  // first, because Chromium only paints the ring for keyboard-driven focus: after any
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

  serverA.daemon.pushFrame(rejection())

  const repair = page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })
  await expect(repair).toBeVisible()
  await repair.click()

  const recovery = page.getByRole('dialog', { name: 'Pair', exact: true })
  await expect(recovery).toBeVisible()
  await expect(pairingBox).toBeVisible()
  await recovery.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(recovery).toHaveCount(0)
  await expect(page.locator('.conversation')).toBeVisible()
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
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

// Observe real main-process dispatch and authenticated connection events, without replacing reconnect.
async function observeRecovery(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, channels) => {
    const counts = { reconnect: [] as string[], connected: [] as string[], unpair: 0 }
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Function> })._invokeHandlers
    for (const channel of [channels.reconnect, channels.unpair]) {
      const original = handlers.get(channel)!
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        if (channel === channels.reconnect) counts.reconnect.push(request.serverId)
        else counts.unpair++
        return original(event, request)
      })
    }
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    contents.send = (channel, ...values) => {
      if (channel === channels.events && values[0]?.type === 'connected') {
        counts.connected.push(values[0].serverId)
      }
      send(channel, ...values)
    }
    ipcMain.handle('test:composer-recovery-counts', () => counts)
  }, { reconnect: RECONNECT_SERVER_CHANNEL, unpair: UNPAIR_SERVER_CHANNEL, events: DAEMON_EVENT_CHANNEL })
}

async function recoveryCounts(app: ElectronApplication) {
  return app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Function> })._invokeHandlers
    return handlers.get('test:composer-recovery-counts')!() as {
      reconnect: string[]; connected: string[]; unpair: number
    }
  })
}

for (const closeCode of [4421, 4401]) {
  test(`reconnect: bare ${closeCode} redials only the open host and preserves row geometry`, async ({ launchPairedApp }) => {
    const { app, page, servers } = await launchPairedApp({}, { secondServer: {} })
    const [serverA, serverB] = servers
    await page.locator('.channel-list__row-open').filter({ hasText: rowName(SEEDED_ROW) }).click()
    await expect(page.locator('.conversation')).toBeVisible()
    await page.setViewportSize({ width: 800, height: 600 })
    await page.getByPlaceholder('Message…').fill('Retained draft')
    const atRest = await readStatusRowGeometry(page)
    expect(atRest).toMatchObject({ rowHeight: 24, groupFromBottom: 0 })
    await observeRecovery(app)

    serverA.forwarder.closeClientLeg(closeCode)
    const reconnect = page.getByRole('button', { name: COMPOSER_RECONNECT_BUTTON_COPY, exact: true })
    await expect(reconnect).toBeVisible()
    await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toHaveCount(0)
    await expect(page.locator('.composer-status__error')).toHaveCount(0)
    const withButton = await readStatusRowGeometry(page)
    expect(withButton).toEqual({ rowHeight: 32, groupFromBottom: 0, iconFromBottom: atRest.iconFromBottom })
    if (closeCode === 4421) await page.screenshot({ path: '/tmp/builder-1510-reconnect-800.png' })
    await reconnect.click()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await expect.poll(() => recoveryCounts(app)).toEqual({
      reconnect: [serverA.serverId], connected: [serverA.serverId], unpair: 0
    })
    await expect(reconnect).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
    await expect(page.getByPlaceholder('Message…')).toHaveValue('Retained draft')
    await expect(page.locator('.channel-list__row-open').filter({ hasText: rowName(SECOND_SEEDED_ROW) })).toBeVisible()
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings__server-row-id')).toHaveText([serverA.serverId, serverB.serverId])
    expect(await recoveryCounts(app)).toEqual({
      reconnect: [serverA.serverId], connected: [serverA.serverId], unpair: 0
    })
  })
}
