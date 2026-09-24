import { test, expect, FIRST_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { RendererCommand } from '../src/shared/ipc/commands'

async function settle(app: PairedApp) {
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function event(app: PairedApp, value: object, channel = DAEMON_EVENT_CHANNEL) {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel, value })
  await settle(app)
}
async function connection(app: PairedApp, type: string) {
  await event(app, { type, serverId: FIRST_SERVER_ID, ack: { protocol_version: '1', server_id: 'test', conn_id: 'test', capabilities: [] },
    error: { code: 'transport', message: 'Offline', retryable: true } })
}
async function observe(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__offlineActions = { commands: [], attachments: [] } })
  for (const [method, slot] of [['sendCommand', 'commands'], ['requestAttachment', 'attachments']]) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.pyry.${method}` })
    // The app badge's main-local count is not daemon-bound, so it is not recorded.
    await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
      condition: `(arguments[0]?.type !== 'setBadgeCount' && globalThis.__offlineActions.${slot}.push(arguments[0]), false)` })
  }
  return () => app.page.evaluate(() => (window as any).__offlineActions as { commands: RendererCommand[], attachments: object[] })
}
async function info(app: PairedApp) {
  await app.page.getByRole('button', { name: 'More actions', exact: true }).click()
  await app.page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
}

test('held reading, draft and queue survive offline actions, reopening and copying; another host and reconnect work', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [SECOND_SEEDED_ROW] }) } })
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await event(app, { type: 'completed', uploadId: 'held-image', filename: 'held.png' }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
  await event(app, { type: 'completed', uploadId: 'held-file', filename: 'held.pdf' }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
  await page.getByPlaceholder('Message…').fill('Held attachment message')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble__file')).toBeEnabled()
  await event(app, { type: 'assistantDelta', serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id,
    turnId: 'held-turn', seq: 0, text: 'Held reply\n'.repeat(100) })
  await event(app, { type: 'queueState', serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id,
    queued: [{ queued_msg_id: 4, text: 'Held queued work', ts: '2026-09-13T00:00:00Z' }] })
  await event(app, { type: 'turnState', serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id, state: 'thinking' })
  await page.getByPlaceholder('Message…').fill('Retained local draft')
  await info(app)
  // #1440 retitled this dialog and its sheet pill to Edit chat. The sidebar pen keeps its own `Rename`
  // accessible name (#1441 owns that), which is why this locator is still scoped to the sheet's actions.
  await page.locator('.channel-info__actions').getByRole('button', { name: 'Edit chat', exact: true }).click()
  const rename = page.getByRole('dialog', { name: 'Edit chat', exact: true })
  const archiveChat = rename.getByRole('button', { name: 'Archive chat', exact: true })
  await rename.getByRole('textbox').fill('Held new name')
  await rename.getByRole('button', { name: 'OK', exact: true }).focus()
  const read = await observe(app)
  await connection(app, 'disconnected')
  await expect(rename.getByRole('button', { name: 'OK', exact: true })).toBeDisabled()
  // #1440 AC3's interactive arm, in the one drive that holds this dialog open ACROSS a disconnect —
  // the state a static render cannot reach. Archive chat is enabled-with-a-blank-name by design (it
  // reads only the `available` half of OK's guard), so this is the single assertion that separates
  // "disabled on unavailability" from "never disabled at all": held open, it goes dead alongside OK.
  await expect(archiveChat).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await rename.getByRole('button', { name: 'OK', exact: true }).dispatchEvent('click')
  // The `disabled` attribute is the affordance; the handler's own interaction-time re-check is the
  // guarantee. Dispatching past the attribute proves the second one — nothing reaches `read()` below.
  await archiveChat.dispatchEvent('click')
  await expect(rename.getByRole('textbox')).toHaveValue('Held new name')
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.channel-info__actions').getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const stop = page.getByRole('button', { name: 'Stop the running turn', exact: true })
  await expect(stop).toBeDisabled()
  await stop.dispatchEvent('click')
  await stop.dispatchEvent('keydown', { key: 'Escape' })
  await page.getByPlaceholder('Message…').press('Escape')
  await page.getByPlaceholder('Message…').press('Enter')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Retained local draft')
  await expect(page.locator('.queued-row__drop')).toBeDisabled()
  await page.locator('.queued-row__drop').dispatchEvent('click')
  await expect(page.locator('.conversation__thread')).toContainText('Held queued work')
  await expect(page.locator('.bubble__file')).toBeDisabled()
  await page.locator('.bubble__file').dispatchEvent('click')
  await expect(page.locator('.composer__actions')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-1382-offline.png', animations: 'disabled' })
  await settle(app)
  expect(await read()).toEqual({ commands: [], attachments: [] })

  // Reopen the same held chat: local activation is observable, without any data requests.
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await page.locator('[data-thread-role="assistant"]').getByRole('button', { name: 'Copy message' }).click()
  await expect.poll(() => app.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Held reply')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Retained local draft')
  expect(await read()).toEqual({ commands: [], attachments: [] })

  await page.getByRole('button', { name: SECOND_SEEDED_ROW.name!, exact: true }).click()
  await page.getByPlaceholder('Message…').fill('Second host works')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await read()).commands.filter(c => c.type === 'sendMessage').length).toBe(1)
  expect((await read()).commands.find(c => c.type === 'sendMessage')).toMatchObject({ payload: { conversation_id: SECOND_SEEDED_ROW.id } })
  const beforeOpen = await read()
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(page.locator('.conversation__thread')).toContainText('Held attachment message')
  await settle(app)
  expect(await read()).toEqual(beforeOpen)
  await connection(app, 'connected')
  expect((await read()).commands.filter(c => c.type === 'sendMessage')).toHaveLength(1)
  await page.getByPlaceholder('Message…').fill('Explicit reconnect action')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(async () => (await read()).commands.filter(c => c.type === 'sendMessage').length).toBe(2)
})

test('pre-opened action menu and missing, connecting, failed or ambiguous ownership cannot submit', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const { page } = app
  const read = await observe(app)
  await page.locator('.composer__actions').click()
  const menu = page.getByRole('menu', { name: 'Actions', exact: true })
  await menu.getByRole('menuitem', { name: 'Reset session', exact: true }).focus()
  await connection(app, 'connecting')
  await expect(menu).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  for (const type of ['connecting', 'failed', 'disconnected']) {
    await connection(app, type)
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await page.getByPlaceholder('Message…').fill('/clear')
    await page.getByPlaceholder('Message…').press('Enter')
  }
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [] })
  await event(app, { type: 'conversationsReceived', serverId: 'no-status', conversations: [SEEDED_ROW] })
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Send', exact: true }).dispatchEvent('click')
  await event(app, { type: 'connected', serverId: 'other-connected', ack: {} })
  await event(app, { type: 'conversationsReceived', serverId: 'other-connected', conversations: [SEEDED_ROW] })
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.getByPlaceholder('Message…').press('Enter')
  expect((await read()).commands.filter(c => ['sendMessage', 'newSession', 'interrupt', 'dequeueMessage'].includes(c.type))).toEqual([])
})


test('offline opening does not consume first-history eligibility', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const held = { ...SEEDED_ROW, id: 'not-yet-opened', name: 'Held unread chat' }
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, held] })
  await event(app, { type: 'assistantDelta', serverId: FIRST_SERVER_ID, conversationId: held.id,
    turnId: 'unopened-turn', seq: 0, text: 'Received before opening' })
  await connection(app, 'disconnected')
  const read = await observe(app)
  await app.page.getByRole('button', { name: held.name, exact: true }).click()
  await expect(app.page.locator('.conversation__thread')).toContainText('Received before opening')
  await app.page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await settle(app)
  expect(await read()).toEqual({ commands: [], attachments: [] })
  await connection(app, 'connected')
  // The fake's reconnect list can replace the injected row. Restore its stamped ownership.
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, held] })
  await app.page.getByRole('button', { name: held.name, exact: true }).click()
  await settle(app)
  expect((await read()).commands.filter(c => c.type === 'requestHistory')).toEqual([])
  await app.page.locator('.conversation__thread').focus()
  await app.page.keyboard.press('Home')
  await expect.poll(async () => (await read()).commands.filter(c => c.type === 'requestHistory' && c.payload.conversation_id === held.id).length).toBe(1)
})
