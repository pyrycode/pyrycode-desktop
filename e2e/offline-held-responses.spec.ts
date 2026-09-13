import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { RendererCommand } from '../src/shared/ipc/commands'
import { conversationStateFake } from './fixtures/conversationStateFake'

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function connection(app: PairedApp, type: string): Promise<void> {
  await event(app, { type, serverId: FIRST_SERVER_ID,
    ack: { protocol_version: '1', server_id: 'test', conn_id: 'test', capabilities: [] },
    error: { code: 'transport', message: 'Offline', retryable: true } })
}

async function observeCommands(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__promptCommands = [] })
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
    condition: '(globalThis.__promptCommands.push(arguments[0]), false)' })
  return async () => app.page.evaluate(() => ((window as any).__promptCommands as RendererCommand[])
    .filter(c => ['answerModal', 'cancelModal', 'answerQuestions', 'refuseQuestions'].includes(c.type)))
}

async function permission(app: PairedApp, kind = 'permission', conversationId = SEEDED_ROW.id, serverId = FIRST_SERVER_ID) {
  await event(app, { type: 'modalShown', serverId, conversationId, modalId: 'held-' + conversationId,
    class: kind, title: 'Held permission', prompt: 'Allow reading?', defaultToNo: true,
    options: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }], defaultOptionId: 'deny' })
}

async function questions(app: PairedApp, conversationId = SEEDED_ROW.id, serverId = FIRST_SERVER_ID) {
  await event(app, { type: 'questionShown', serverId, conversationId, questionBatchId: 'questions-' + conversationId,
    questions: ['Language', 'Editor'].map(header => ({ header, question: 'Choose ' + header,
      options: [{ label: 'First pick', description: 'A choice' }], multi_select: false })) })
}

test('permission and trust retain selection offline, including pre-opened confirmation and keyboard attempts', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const read = await observeCommands(app)
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  const panel = page.locator('.permission-panel')
  for (const kind of ['permission', 'trust']) {
    await permission(app, kind)
    await panel.getByRole('radio', { name: 'Allow', exact: true }).press('Space')
    await panel.getByRole('button', { name: 'Continue', exact: true }).click()
    await panel.getByRole('button', { name: 'Confirm', exact: true }).focus()
    const before = (await read()).length
    await connection(app, 'disconnected')
    await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await expect(panel).toContainText('Send "Allow"?')
    expect(await read()).toHaveLength(before)
    await event(app, { type: 'modalAnswerRejected', serverId: FIRST_SERVER_ID, modalId: 'held-' + SEEDED_ROW.id })
    await expect(page.getByRole('alert')).toContainText('Your answer was rejected.')
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.screenshot({ path: '/tmp/builder-1381-offline-confirm.png', animations: 'disabled' })
    await panel.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(panel.getByRole('radio', { name: 'Allow', exact: true })).toBeChecked()
    await panel.getByRole('radio', { name: 'Deny Default', exact: true }).press('Space')
    for (const name of ['Continue', 'Cancel']) {
      const button = panel.getByRole('button', { name, exact: true })
      await expect(button).toBeDisabled()
      await button.dispatchEvent('click')
    }
    await expect(panel.getByRole('radio', { name: 'Deny Default', exact: true })).toBeChecked()
    expect(await read()).toHaveLength(before)
    await connection(app, 'connected')
    await permission(app, kind)
    expect(await read()).toHaveLength(before)
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
    await panel.getByRole('radio', { name: 'Deny Default', exact: true }).press('Space')
    await panel.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect.poll(async () => (await read()).length).toBe(before + 1)
    await expect(panel).toHaveCount(0)
    // Clear resolved suppression before reusing the synthetic nonce for the next class.
    await connection(app, 'connected')
  }
})

test('questions preserve picks, local navigation and draft offline; a second connected host answers', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [SEEDED_ROW] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [SECOND_SEEDED_ROW] }) } })
  const read = await observeCommands(app)
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await page.getByPlaceholder('Message…').fill('Retained draft')
  await event(app, { type: 'assistantDelta', serverId: FIRST_SERVER_ID, conversationId: SEEDED_ROW.id,
    turnId: 'held-turn', seq: 0, text: 'Retained message' })
  await expect(page.locator('[data-thread-role="assistant"]')).toContainText('Retained message')
  await questions(app)
  const panel = page.locator('.question-panel:not(.permission-panel)')
  await panel.getByRole('radio').first().press('Space')
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await panel.getByRole('radio').first().press('Space')
  await panel.getByRole('button', { name: 'Continue', exact: true }).focus()
  await connection(app, 'disconnected')
  await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await panel.getByRole('button', { name: 'Cancel', exact: true }).dispatchEvent('click')
  await panel.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(panel.getByRole('radio').first()).toBeChecked()
  await panel.getByPlaceholder('Other. Type something.').fill('Local answer')
  await panel.getByRole('button', { name: 'Editor', exact: true }).click()
  await expect(panel.getByRole('radio').first()).toBeChecked()
  await panel.getByRole('button', { name: 'Language', exact: true }).click()
  await expect(panel.getByPlaceholder('Other. Type something.')).toHaveValue('Local answer')
  await expect(page.getByPlaceholder('Message…')).toHaveValue('Retained draft')
  await expect(page.locator('[data-thread-role="assistant"]')).toContainText('Retained message')
  expect(await read()).toEqual([])
  await page.screenshot({ path: '/tmp/builder-1381-offline-question.png', animations: 'disabled' })
  await page.getByRole('button', { name: SECOND_SEEDED_ROW.name!, exact: true }).click()
  await permission(app, 'trust', SECOND_SEEDED_ROW.id, SECOND_SERVER_ID)
  await page.locator('.permission-panel').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(async () => (await read()).length).toBe(1)
  await questions(app, SECOND_SEEDED_ROW.id, SECOND_SERVER_ID)
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(async () => (await read()).length).toBe(2)
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(panel.getByPlaceholder('Other. Type something.')).toHaveValue('Local answer')
  await connection(app, 'connected')
  await expect(panel).toHaveCount(0)
  await questions(app)
  expect(await read()).toHaveLength(2)
  await panel.getByRole('radio').first().press('Space')
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await panel.getByRole('radio').first().press('Space')
  await panel.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect.poll(async () => (await read()).length).toBe(3)
  expect((await read()).map(c => c.type)).toEqual(['cancelModal', 'refuseQuestions', 'answerQuestions'])
})

test('all unavailable statuses and missing or ambiguous ownership block both prompt families', async ({ launchPairedApp }) => {
  const app = await launchPairedApp({ buildReplyFrames: conversationStateFake() })
  const read = await observeCommands(app)
  const { page } = app
  for (const family of ['permission', 'question']) {
    await connection(app, 'connected')
    if (family === 'permission') await permission(app)
    else await questions(app)
    const panel = page.locator(family === 'permission' ? '.permission-panel' : '.question-panel:not(.permission-panel)')
    await panel.getByRole('radio').first().press('Space')
    if (family === 'question') {
      await panel.getByRole('button', { name: 'Next', exact: true }).click()
      await panel.getByRole('radio').first().press('Space')
    }
    async function blocked() {
      for (const name of ['Continue', 'Cancel']) {
        await expect(panel.getByRole('button', { name, exact: true })).toBeDisabled()
        await panel.getByRole('button', { name, exact: true }).dispatchEvent('click')
      }
      await expect(panel.getByRole('radio').first()).toBeChecked()
      expect(await read()).toEqual([])
    }
    for (const type of ['connecting', 'failed', 'disconnected']) {
      await connection(app, type)
      await blocked()
    }
    await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [] })
    await blocked()
    await event(app, { type: 'conversationsReceived', serverId: 'missing-status', conversations: [SEEDED_ROW] })
    await blocked()
    // A duplicate stamped row must not resolve to either host, even when that host is connected.
    await event(app, { type: 'connected', serverId: 'other-connected', ack: {} })
    if (family === 'question') {
      await questions(app)
      await panel.getByRole('radio').first().press('Space')
      await panel.getByRole('button', { name: 'Next', exact: true }).click()
      await panel.getByRole('radio').first().press('Space')
    }
    await event(app, { type: 'conversationsReceived', serverId: 'other-connected', conversations: [SEEDED_ROW] })
    await blocked()
    for (const serverId of ['missing-status', 'other-connected'])
      await event(app, { type: 'conversationsReceived', serverId, conversations: [] })
    await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW] })
  }
})
