import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { RendererCommand } from '../src/shared/ipc/commands'
import { conversationStateFake } from './fixtures/conversationStateFake'

const MODELS = ['opus', 'sonnet'].map(value => ({
  value, display_name: value, resolved_model: value, effort_levels: ['low', 'high'],
  supports_auto_mode: true, truncated_fields: null
}))

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  // Drain React's render and passive effects before a closing absence assertion.
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function connection(app: PairedApp, type: string, serverId = FIRST_SERVER_ID): Promise<void> {
  await event(app, { type, serverId, ack: { protocol_version: '1', server_id: 'test-server', conn_id: 'test-connection', capabilities: [] },
    error: { code: 'transport', message: 'Offline', retryable: true } })
}

async function settings(app: PairedApp, effort = 'low', conversationId = SEEDED_ROW.id,
  sessionId = 'settings-session', serverId = FIRST_SERVER_ID): Promise<void> {
  await event(app, { type: 'runConfigReceived', serverId, conversationId,
    sessionId, model: 'opus', effort, effectiveEffort: effort, yolo: false, permissionMode: 'default',
    used_tokens: 100, window_tokens: 1000 })
  await event(app, { type: 'modelList', serverId, conversationId, models: MODELS, droppedModels: 0 })
}

async function observeCommands(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__settingsCommands = [] })
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: '(globalThis.__settingsCommands.push(arguments[0]), false)'
  })
  return async () => app.page.evaluate(() => ((window as any).__settingsCommands as RendererCommand[])
    .filter(c => c.type === 'setSessionSettings'))
}

async function openSheet(app: PairedApp): Promise<void> {
  await app.page.locator('.conversation__overflow-trigger').click()
  await app.page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
  await expect(app.page.locator('.status-sheet')).toBeVisible()
}

test('pre-opened composer menus discard mouse and keyboard choices offline, then reconnect', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const read = await observeCommands(app)
  const { page } = app
  const cases = [
    ['.composer__model', 'Model', 'Sonnet', '.composer__model-label', 'Opus'],
    ['.composer__effort', 'Effort', 'high', '.composer__effort-label', 'low'],
    ['.composer__permission', 'Permission mode', 'Plan', '.composer__permission-label', 'Manual approval']
  ]
  for (const [trigger, menuName, choice, label, held] of cases) {
    await settings(app)
    await page.locator(trigger).click()
    const menu = page.getByRole('menu', { name: menuName, exact: true })
    await menu.getByRole('menuitem', { name: choice, exact: true }).focus()
    const box = await menu.getByRole('menuitem', { name: choice, exact: true }).boundingBox()
    const before = (await read()).length
    await connection(app, 'disconnected')
    await expect(menu).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator(label)).toHaveText(held)
    expect(await read()).toHaveLength(before)
    await connection(app, 'connected')
    // Reconnect invalidates permission confirmation until the owning host reports again.
    await expect(page.locator('.composer__permission-label')).toHaveCount(0)
    if (trigger !== '.composer__permission') await expect(page.locator(trigger)).toBeVisible()
    await settings(app)
    await expect(page.locator('.composer__permission-label')).toHaveText('Manual approval')
    await expect(page.locator(trigger)).toBeVisible()
    expect(await read()).toHaveLength(before)
    await page.locator(trigger).click()
    await page.getByRole('menu', { name: menuName, exact: true }).getByRole('menuitem', { name: choice, exact: true }).press('Enter')
    await expect.poll(async () => (await read()).length).toBe(before + 1)
    const command = (await read()).at(-1)!
    await event(app, { type: 'sessionSettingsRejected', changeId: (command as any).changeId })
    await connection(app, 'connected')
  }
})

test('an open sheet retains values but cannot write any field offline; another host stays usable', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [SECOND_SEEDED_ROW] }) } })
  const read = await observeCommands(app)
  const { page } = app
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await settings(app)
  await openSheet(app)
  const model = page.locator('.run-config__model-row').filter({ hasText: 'sonnet' })
  const effort = page.locator('.run-config__effort-segment', { hasText: /^high$/ })
  const yolo = page.getByRole('switch', { name: 'Auto-accept tool calls' })
  await expect(model).toHaveAttribute('role', 'button')
  await yolo.focus()
  await connection(app, 'disconnected')
  await expect(model).not.toHaveAttribute('role', 'button')
  await expect(effort).not.toHaveAttribute('role', 'button')
  await expect(yolo).toHaveAttribute('aria-readonly', 'true')
  for (const control of [model, effort, yolo]) {
    await control.click({ force: true })
    await control.press('Enter')
    await control.press('Space')
  }
  await expect(yolo).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('.run-config__effort-segment', { hasText: /^low$/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.run-config__model-row').filter({ hasText: 'opus' }).getByLabel('Current model')).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  expect(await read()).toEqual([])
  await page.screenshot({ path: '/tmp/builder-1380-offline-sheet.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.screenshot({ path: '/tmp/builder-1380-offline-footer.png', animations: 'disabled' })
  await page.getByRole('button', { name: SECOND_SEEDED_ROW.name!, exact: true }).click()
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  // A report naming the open chat still cannot establish confirmation from the wrong host.
  await settings(app, 'low', SECOND_SEEDED_ROW.id, 'second-session', FIRST_SERVER_ID)
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  await settings(app, 'low', SECOND_SEEDED_ROW.id, 'second-session', SECOND_SERVER_ID)
  await expect(page.locator('.composer__permission-label')).toHaveText('Manual approval')
  await page.locator('.composer__permission').click()
  await page.getByRole('menuitem', { name: 'Plan', exact: true }).click()
  await expect.poll(async () => (await read()).length).toBe(1)
  expect((await read())[0]).toMatchObject({ payload: { session_id: 'second-session' } })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await settings(app)
  await connection(app, 'connected')
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  await settings(app)
  await expect(page.locator('.composer__permission')).toBeVisible()
  await openSheet(app)
  for (const control of [model, effort, yolo]) await control.click()
  await expect.poll(async () => (await read()).length).toBe(4)
  expect((await read()).slice(1).map(command => command.payload)).toEqual([
    { session_id: 'settings-session', model: 'sonnet' },
    { session_id: 'settings-session', effort: 'high' },
    { session_id: 'settings-session', yolo: true }
  ])
})

test('missing ownership/status and every non-connected status fail closed, preserving session and capability gates', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const read = await observeCommands(app)
  const { page } = app
  await settings(app)
  for (const type of ['connecting', 'disconnected', 'failed']) {
    await connection(app, type)
    await expect(page.locator('.composer__model')).toHaveCount(0)
    await expect(page.locator('.composer__effort')).toHaveCount(0)
    await expect(page.locator('.composer__permission')).toHaveCount(0)
    await expect(page.locator('.composer__permission-label')).toHaveText('Manual approval')
  }
  await connection(app, 'connected')
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  await settings(app)
  await expect(page.locator('.composer__permission')).toBeVisible()
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [] })
  await expect(page.locator('.composer__permission')).toHaveCount(0)
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  await event(app, { type: 'conversationsReceived', serverId: 'missing-status', conversations: [SEEDED_ROW] })
  await expect(page.locator('.composer__permission')).toHaveCount(0)
  expect(await read()).toEqual([])
  await event(app, { type: 'conversationsReceived', serverId: 'missing-status', conversations: [] })
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW] })
  await expect(page.locator('.composer__permission-label')).toHaveCount(0)
  await settings(app)
  await expect(page.locator('.composer__permission')).toBeVisible()
  await settings(app, 'low', SEEDED_ROW.id, '')
  await expect(page.locator('.composer__permission')).toHaveCount(0)
  await settings(app)
  await event(app, { type: 'modelList', serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id,
    models: [{ ...MODELS[0], supports_auto_mode: false, effort_levels: [] }], droppedModels: 0 })
  await expect(page.locator('.composer__effort')).toHaveCount(0)
  await page.locator('.composer__permission').click()
  await expect(page.getByRole('menuitem', { name: 'Auto approval', exact: true })).toHaveCount(0)
})

test('remembered effort waits offline without consuming its attempt, and reconnect cannot retry an attempt', async ({ launchPairedApp }) => {
  let stateFake = conversationStateFake()
  const app = await launchPairedApp({ buildReplyFrames: frame => stateFake(frame) })
  const read = await observeCommands(app)
  const { page } = app
  await settings(app)
  await page.locator('.composer__effort').click()
  await page.getByRole('menuitem', { name: 'high', exact: true }).click()
  await expect.poll(async () => (await read()).length).toBe(1)
  await event(app, { type: 'sessionSettingsUpdated', changeId: (await read())[0].changeId })
  await connection(app, 'connecting')
  await settings(app, '')
  await expect(page.locator('.composer__effort-label')).toHaveText('Effort')
  // Reconnect clears the prior confirmed overlay, so the empty snapshot becomes eligible.
  // While unavailable, a fresh conversation has no attempt or overlay to hide a bad apply.
  const fresh = { ...SEEDED_ROW, id: 'fresh-effort', name: 'Fresh effort' }
  stateFake = conversationStateFake({ conversations: [SEEDED_ROW, fresh] })
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, fresh] })
  await page.getByRole('button', { name: fresh.name, exact: true }).click()
  await settings(app, '', fresh.id, 'fresh-session')
  await expect(page.locator('.composer__model-label')).toHaveText('Opus')
  expect(await read()).toHaveLength(1)
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW] })
  await settings(app, '', fresh.id, 'fresh-session')
  expect(await read()).toHaveLength(1)
  await event(app, { type: 'conversationsReceived', serverId: 'missing-status', conversations: [fresh] })
  await settings(app, '', fresh.id, 'fresh-session')
  expect(await read()).toHaveLength(1)
  await event(app, { type: 'conversationsReceived', serverId: 'missing-status', conversations: [] })
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, fresh] })
  await connection(app, 'connected')
  await expect.poll(async () => (await read()).length).toBe(2)
  expect((await read())[1]).toMatchObject({ payload: { session_id: 'fresh-session', effort: 'high' } })
  await event(app, { type: 'sessionSettingsRejected', changeId: (await read())[1].changeId })
  await connection(app, 'disconnected')
  await connection(app, 'connected')
  await settings(app, '', fresh.id, 'fresh-session')
  expect(await read()).toHaveLength(2)

  // An unattempted chat gains its own effort before reconnect: eligibility must be checked again.
  await connection(app, 'disconnected')
  const changed = { ...fresh, id: 'changed-effort', name: 'Changed effort' }
  stateFake = conversationStateFake({ conversations: [SEEDED_ROW, fresh, changed] })
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, fresh, changed] })
  await page.getByRole('button', { name: changed.name, exact: true }).click()
  await settings(app, '', changed.id, 'changed-session')
  expect(await read()).toHaveLength(2)
  await settings(app, 'low', changed.id, 'changed-session')
  await connection(app, 'connected')
  await expect(page.locator('.composer__effort')).toHaveText('low')
  expect(await read()).toHaveLength(2)
})
