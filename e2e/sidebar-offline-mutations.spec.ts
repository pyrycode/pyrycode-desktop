import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { RendererCommand } from '../src/shared/ipc/commands'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
}

async function connection(app: PairedApp, serverId: string, type: string): Promise<void> {
  await event(app, { type, serverId, ack: { protocol_version: 1 },
    error: { code: 'transport', message: 'Offline', retryable: true } })
}

// Break on the renderer's exposed function, before IPC or transport can filter the call.
async function observeCommands(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__sidebarCommands = [] })
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: '(globalThis.__sidebarCommands.push(arguments[0]), false)'
  })
  return {
    read: () => app.page.evaluate(() => (window as any).__sidebarCommands as RendererCommand[]),
    clear: () => app.page.evaluate(() => { (window as any).__sidebarCommands = [] })
  }
}

test('pre-opened mutation dialogs cannot submit by keyboard after disconnection', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const commands = await observeCommands(app)
  const { page } = app
  const cases = [
    // #1476 — the Channels pen's dialog is now Edit channel, under `.edit-channel*`. Its OK still sends
    // `renameConversation` (the helper is reused verbatim), and a `New label` fill always differs from the
    // seeded title, so the send is armed exactly as before and the offline case still has one to suppress.
    ['.channel-list__rename', '.edit-channel__input', 'OK', 'renameConversation'],
    ['.channel-list__section-create', '.create-channel__input', 'OK', 'createConversation']
  ]
  for (const [entry, input, confirm, commandType] of cases) {
    await page.locator(entry).first().click({ force: true })
    await page.locator(input).fill('New label')
    await page.getByRole('button', { name: confirm, exact: true }).focus()
    await commands.clear()
    await connection(app, FIRST_SERVER_ID, 'disconnected')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    expect((await commands.read()).filter(c => ['createConversation', 'renameConversation', 'renameWorkspace'].includes(c.type))).toEqual([])
    await connection(app, FIRST_SERVER_ID, 'connected')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator(entry).first().click({ force: true })
    await page.locator(input).fill('Connected label')
    await page.getByRole('button', { name: confirm, exact: true }).press('Enter')
    await expect.poll(async () => (await commands.read()).filter(c => c.type === commandType).length).toBe(1)
    const sent = (await commands.read()).find(c => c.type === commandType)
    if (commandType === 'renameConversation') expect(sent).toMatchObject({ payload: { conversation_id: 'seed-conversation' } })
    else expect(sent).toMatchObject({ serverId: FIRST_SERVER_ID })
    await expect(page.getByRole('dialog')).toHaveCount(0)

  }
})

// #1436 deleted this test's folder-round-trip body: Save as channel no longer requests a folder or
// waits for one, so there is no pending promotion left to strand offline. What survives is its first
// leg — the keyboard guard on a dialog that disconnected under the operator — plus the standing
// claim that a late folder reply, which nothing asked for, still promotes nothing.
test('a pre-opened save dialog cannot promote by keyboard after disconnection', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) })
  const commands = await observeCommands(app)
  const { page } = app
  await page.locator('.channel-list__save').click({ force: true })
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByRole('button', { name: 'OK', exact: true }).focus()
  await connection(app, FIRST_SERVER_ID, 'disconnected')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/fake/delayed' })
  await connection(app, FIRST_SERVER_ID, 'connected')
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/fake/delayed' })
  await expect(page.locator('.channel-list__save')).toHaveCount(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await commands.read()).filter(c => ['promoteConversation', 'createWorkspaceFolder'].includes(c.type))).toEqual([])
  // Reconnected, the same row promotes in its own workspace on an explicit reopening.
  await page.locator('.channel-list__save').click({ force: true })
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'promoteConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'promoteConversation')).toMatchObject({
    payload: { conversation_id: SEEDED_ROW.id, cwd: SEEDED_ROW.cwd }
  })
  expect((await commands.read()).filter(c => c.type === 'createWorkspaceFolder')).toEqual([])
})

test('sidebar ownership follows the target in both open-chat directions', async ({ launchPairedApp }) => {
  const a = { ...SEEDED_ROW, is_promoted: true }
  const b = { ...SECOND_SEEDED_ROW, is_promoted: true }
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [a] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [b] }) } })
  const { page } = app
  const commands = await observeCommands(app)
  for (const [offline, online, offlineRow, onlineRow] of [
    [FIRST_SERVER_ID, SECOND_SERVER_ID, a, b],
    [SECOND_SERVER_ID, FIRST_SERVER_ID, b, a]
  ] as const) {
    await connection(app, online, 'connected')
    await connection(app, offline, 'disconnected')
    await page.getByRole('button', { name: offlineRow.name!, exact: true }).click()
    // TWO of each since #1485 — the connected host's group is drawn in BOTH trees now, so it carries a
    // plus and a pen in each. The claim is unchanged and is still exact: the DISCONNECTED host's two
    // groups carry neither, which is what these numbers not being four says.
    await expect(page.locator('.channel-list__section-create')).toHaveCount(2)
    await expect(page.locator('.channel-list__workspace-edit')).toHaveCount(0)
    await expect(page.locator('.channel-list__rename')).toHaveCount(1)
    // #1426 deleted the assertion that stood here: the global create was inert while two hosts were
    // paired. The plus that replaced it is per-row and carries no such state — it is withheld entirely
    // for a host that is not connected, which the three counts above already read.
    await commands.clear()
    // `.first()` is the CHANNELS tree's plus — that tree renders above the divider — which is the one
    // that opens `.create-channel__input`. The Chats mirror's plus opens chat confirmation.
    await page.locator('.channel-list__section-create').first().click({ force: true })
    await page.locator('.create-channel__input').fill('Owned channel')
    await page.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createConversation').length).toBe(1)
    expect((await commands.read()).find(c => c.type === 'createConversation')).toMatchObject({
      serverId: online, payload: { cwd: null, is_promoted: true }
    })
    await page.getByRole('button', { name: onlineRow.name!, exact: true }).click()
    const offlineHeld = page.locator('.channel-list__row').filter({ hasText: offlineRow.name! })
    await expect(offlineHeld.locator('.channel-list__rename')).toHaveCount(0)
    await page.screenshot({ path: '/tmp/builder-1379-sidebar.png', animations: 'disabled' })
  }
})

// #1436 deleted the test that stood here. Its subject was a promotion left pending across a
// disconnect and reconnect batched into one paint — state that no longer exists, because Save as
// channel dispatches and closes in the same turn. The keyboard guard above covers what remains of
// the batched-transition claim: the session subscription abandons the draft synchronously.

test('chat creation and promotion address the connected sidebar host while another chat is open offline', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [SECOND_SEEDED_ROW] }) } })
  const { page } = app
  const commands = await observeCommands(app)
  await connection(app, FIRST_SERVER_ID, 'disconnected')
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await confirmCreateChat(page)
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'createConversation')).toMatchObject({
    serverId: SECOND_SERVER_ID, payload: { cwd: null, is_promoted: false }
  })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  const secondRow = page.locator('.channel-list__row').filter({ hasText: SECOND_SEEDED_ROW.name! })
  await secondRow.locator('.channel-list__save').click({ force: true })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await secondRow.locator('.channel-list__save').click({ force: true })
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'promoteConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'promoteConversation')).toMatchObject({
    payload: { conversation_id: SECOND_SEEDED_ROW.id, cwd: SECOND_SEEDED_ROW.cwd }
  })
})

// #1426 — this test opened with a FAB press and two `createConversation` assertions, proving the global
// create addressed the sole paired host. That half is deleted rather than re-pointed: there is no global
// create any more, and its host-targeting claim is not lost — the sibling test above presses the plus and
// asserts the resulting `createConversation` carries the right `serverId` and `cwd`. What survives is the
// failed-host half, which is what this test is now named for.
test('failed-host local controls remain usable', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const { page } = app
  await connection(app, FIRST_SERVER_ID, 'failed')
  const host = page.locator('.channel-list__host').first()
  await expect(host.getByRole('button', { name: 'Repair host' })).toBeVisible()
  await host.hover()
  await host.getByRole('button', { name: 'Edit host' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const section = page.locator('.channel-list__section-disclosure').first()
  await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'false')
  await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Pair new host' })).toHaveCount(1)
  await host.hover()
  await page.screenshot({ path: '/tmp/builder-1379-failed-host.png', animations: 'disabled' })
  await host.getByRole('button', { name: 'Repair host' }).click()
  await expect(page.getByText('Repair pairing: Server', { exact: true })).toBeVisible()
})
