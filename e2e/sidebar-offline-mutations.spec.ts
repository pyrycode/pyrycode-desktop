import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { RendererCommand } from '../src/shared/ipc/commands'
import { conversationStateFake } from './fixtures/conversationStateFake'

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
    ['.channel-list__rename', '.rename-conversation__input', 'OK', 'renameConversation'],
    ['.channel-list__workspace-create', '.create-channel__input', 'OK', 'createConversation'],
    ['.channel-list__workspace-edit', '.edit-workspace__input', 'OK', 'renameWorkspace']
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

test('folder completion cannot promote an abandoned attempt offline or after reconnect', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) })
  const commands = await observeCommands(app)
  const { page } = app
  await page.locator('.channel-list__save').click({ force: true })
  await page.getByRole('radio', { name: 'Use shared scratch folder' }).check()
  await page.getByRole('button', { name: 'OK', exact: true }).focus()
  await connection(app, FIRST_SERVER_ID, 'disconnected')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Enter')
  expect((await commands.read()).filter(c => ['promoteConversation', 'createWorkspaceFolder'].includes(c.type))).toEqual([])
  await connection(app, FIRST_SERVER_ID, 'connected')
  await expect(page.locator('.channel-list__save')).toHaveCount(1)
  for (const reconnectFirst of [false, true]) {
    await page.locator('.channel-list__save').click({ force: true })
    await page.getByRole('radio', { name: 'Create a dedicated channel folder' }).check()
    await page.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createWorkspaceFolder').length).toBe(1)
    expect((await commands.read()).find(c => c.type === 'createWorkspaceFolder')).toMatchObject({ serverId: FIRST_SERVER_ID })
    await connection(app, FIRST_SERVER_ID, 'disconnected')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    if (reconnectFirst) await connection(app, FIRST_SERVER_ID, 'connected')
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/fake/delayed' })
    if (!reconnectFirst) await connection(app, FIRST_SERVER_ID, 'connected')
    await expect(page.locator('.channel-list__save')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await commands.read()).filter(c => c.type === 'promoteConversation')).toEqual([])
    await commands.clear()
  }
  await page.locator('.channel-list__save').click({ force: true })
  await page.getByRole('radio', { name: 'Create a dedicated channel folder' }).check()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createWorkspaceFolder').length).toBe(1)
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/fake/fresh' })
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'promoteConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'promoteConversation')).toMatchObject({
    payload: { conversation_id: SEEDED_ROW.id, cwd: '/fake/fresh' }
  })
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
    await expect(page.locator('.channel-list__workspace-create')).toHaveCount(1)
    await expect(page.locator('.channel-list__workspace-edit')).toHaveCount(1)
    await expect(page.locator('.channel-list__rename')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'New discussion' })).toBeDisabled()
    await commands.clear()
    await page.locator('.channel-list__workspace-create').click({ force: true })
    await page.locator('.create-channel__input').fill('Owned channel')
    await page.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createConversation').length).toBe(1)
    expect((await commands.read()).find(c => c.type === 'createConversation')).toMatchObject({
      serverId: online, payload: { cwd: onlineRow.cwd, is_promoted: true }
    })
    await page.getByRole('button', { name: onlineRow.name!, exact: true }).click()
    const offlineHeld = page.locator('.channel-list__row').filter({ hasText: offlineRow.name! })
    await expect(offlineHeld.locator('.channel-list__rename')).toHaveCount(0)
    await page.screenshot({ path: '/tmp/builder-1379-sidebar.png', animations: 'disabled' })
  }
})

test('a batched disconnect and reconnect invalidates pending promotion before React paints', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) })
  const commands = await observeCommands(app)
  await app.page.locator('.channel-list__save').click({ force: true })
  await app.page.getByRole('radio', { name: 'Create a dedicated channel folder' }).check()
  await app.page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createWorkspaceFolder').length).toBe(1)
  await app.app.evaluate(({ BrowserWindow }, { channel, serverId }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.send(channel, { type: 'disconnected', serverId })
    contents.send(channel, { type: 'connected', serverId, ack: { protocol_version: 1 } })
    contents.send(channel, { type: 'workspaceFolderCreated', serverId, path: '/fake/abandoned' })
  }, { channel: DAEMON_EVENT_CHANNEL, serverId: FIRST_SERVER_ID })
  await expect(app.page.getByRole('dialog')).toHaveCount(0)
  await expect(app.page.locator('.channel-list__save')).toHaveCount(1)
  expect((await commands.read()).filter(c => c.type === 'promoteConversation')).toEqual([])
})

test('chat creation and scratch promotion address the connected sidebar host while another chat is open offline', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [SECOND_SEEDED_ROW] }) } })
  const { page } = app
  const commands = await observeCommands(app)
  await connection(app, FIRST_SERVER_ID, 'disconnected')
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'createConversation')).toMatchObject({
    serverId: SECOND_SERVER_ID, payload: { cwd: SECOND_SEEDED_ROW.cwd, is_promoted: false }
  })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  const secondRow = page.locator('.channel-list__row').filter({ hasText: SECOND_SEEDED_ROW.name! })
  await secondRow.locator('.channel-list__save').click({ force: true })
  await page.getByRole('radio', { name: 'Create a dedicated channel folder' }).check()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createWorkspaceFolder').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'createWorkspaceFolder')).toMatchObject({ serverId: SECOND_SERVER_ID })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await secondRow.locator('.channel-list__save').click({ force: true })
  await page.getByRole('radio', { name: 'Use shared scratch folder' }).check()
  await page.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'promoteConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'promoteConversation')).toMatchObject({
    payload: { conversation_id: SECOND_SEEDED_ROW.id, cwd: SECOND_SEEDED_ROW.cwd }
  })
})

test('the sole-host global create targets that host, and failed-host local controls remain usable', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const commands = await observeCommands(app)
  const { page } = app
  await page.getByRole('button', { name: 'New discussion' }).click()
  await expect.poll(async () => (await commands.read()).filter(c => c.type === 'createConversation').length).toBe(1)
  expect((await commands.read()).find(c => c.type === 'createConversation')).toMatchObject({ serverId: FIRST_SERVER_ID })
  await connection(app, FIRST_SERVER_ID, 'failed')
  const host = page.locator('.channel-list__host').first()
  await expect(host.getByRole('button', { name: 'Repair host' })).toBeVisible()
  await host.hover()
  await host.getByRole('button', { name: 'Edit host' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const workspace = page.locator('.channel-list__workspace').first()
  await workspace.click()
  await expect(workspace).toHaveAttribute('aria-expanded', 'false')
  await workspace.click()
  await expect(workspace).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Pair new host' })).toHaveCount(2)
  await host.hover()
  await page.screenshot({ path: '/tmp/builder-1379-failed-host.png', animations: 'disabled' })
  await host.getByRole('button', { name: 'Repair host' }).click()
  await expect(page.getByText('Repair pairing: Server', { exact: true })).toBeVisible()
})
