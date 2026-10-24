import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { test, expect, FIRST_SERVER_ID, SEEDED_ROW, SECOND_SEEDED_ROW, type PairedApp } from './fixtures/launchPairedApp'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import { createCanonicalThread } from './fixtures/canonicalThread'
import type { RendererCommand } from '../src/shared/ipc/commands'
import type { ConversationSummary, SendMessagePayload } from '../src/shared/wire/types'
import type { ThreadItem, ThreadUpdate } from '../src/shared/wire/thread'

const SESSION = 'session'
const EPOCH = 'offline-actions-epoch'
const canonical = (row: ConversationSummary = SEEDED_ROW) => ({ threadMode: 'canonical' as const,
  thread: createCanonicalThread({ conversations: [{ summary: { ...row, current_session_id: SESSION },
    epoch: EPOCH, version: 1, items: [] }] }), buildReplyFrames: (bytes: Uint8Array) => {
      expect(decodeEnvelope(bytes).type).not.toBe('request_history'); return []
    } })
const item = (id: number, kind: 'user_message' | 'assistant_message',
  status: 'running' | 'queued' | 'delivered', content: unknown): ThreadItem => ({
  id, order: id, rev: 1, kind, status, active: status === 'running' || status === 'queued',
  shown: true, summary: '', session: SESSION, content
})
const frame = (update: ThreadUpdate) => encodeEnvelope({ id: 2, ts: '2026-10-15T00:00:00Z', ...update })

async function settle(app: PairedApp) {
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function event(app: PairedApp, value: object, channel: string = DAEMON_EVENT_CHANNEL) {
  const content = value as Record<string, any>
  const delivered = { envelopeSessionId: SESSION, ...content,
    ...(Array.isArray(content.conversations) ? { conversations: content.conversations.map(row =>
      ({ current_session_id: SESSION, ...row })) } : {}) }
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel, value: delivered })
  await settle(app)
}
async function connection(app: PairedApp, type: string) {
  await event(app, { type, serverId: FIRST_SERVER_ID, ack: { protocol_version: '1', server_id: 'test', conn_id: 'test', capabilities: ['thread'] },
    error: { code: 'transport', message: 'Offline', retryable: true } })
}
async function observe(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__offlineActions = { commands: [], attachments: [] } })
  for (const [method, slot] of [['sendCommand', 'commands'], ['requestAttachment', 'attachments']]) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.pyry.${method}` })
    if (!result.objectId) throw new Error('Missing command observation target')
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
  let sent: Partial<SendMessagePayload> = {}
  const app = await launchPairedApp({ ...canonical(), buildReplyFrames: bytes => {
    const request = decodeEnvelope(bytes)
    expect(request.type).not.toBe('request_history')
    if (request.type === 'send_message') sent = request.payload as SendMessagePayload
    return []
  } },
    { secondServer: canonical(SECOND_SEEDED_ROW) })
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await event(app, { type: 'completed', uploadId: 'held-image', filename: 'held.png' }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
  await event(app, { type: 'completed', uploadId: 'held-file', filename: 'held.pdf' }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
  await page.getByPlaceholder('Message…').fill('Held attachment message')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.bubble__file')).toBeEnabled()
  await expect.poll(() => sent.message_id).toEqual(expect.any(String))
  const identity = await page.evaluate(() => window.pyry.deviceIdentity())
  if (!identity.ok) throw new Error('authenticated device identity unavailable')
  const route = { conversation_id: SEEDED_ROW.id, epoch: EPOCH }
  app.daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 2,
    item: item(10, 'user_message', 'delivered', { text: sent.text, message_id: sent.message_id,
      device_id: identity.deviceId, attachments: [
        { attachment_id: 'held-image', filename: 'held.png' }, { attachment_id: 'held-file', filename: 'held.pdf' }] }) } }))
  app.daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 3,
    item: item(20, 'assistant_message', 'running', { text: 'Held reply\n'.repeat(100) }) } }))
  app.daemon.pushFrame(frame({ type: 'thread_item_added', payload: { ...route, version: 4,
    item: item(30, 'user_message', 'queued', { queued_msg_id: 4, text: 'Held queued work',
      ts: '2026-09-13T00:00:00Z', device_id: 'another-device', message_id: 'held-queued' }) } }))
  await expect(page.locator('[data-thread-role="assistant"]')).toContainText('Held reply')
  await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(1)
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
  await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(1)
  await expect(page.locator('.queued-row__drop')).toHaveCount(0)
  // Offline authoritative items expose no queue action handle.
  await expect(page.locator('.conversation__thread')).toContainText('Held queued work')
  await expect(page.locator('.bubble__file')).toBeDisabled()
  await page.locator('.bubble__file').dispatchEvent('click')
  await expect(page.locator('.composer__actions')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/builder-2222/offline.png', animations: 'disabled' })
  await settle(app)
  expect(await read()).toEqual({ commands: [], attachments: [] })

  // Reopen the same held chat: local activation is observable, without any data requests.
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await page.locator('[data-thread-role="assistant"]').locator('..').getByRole('button', { name: 'Copy message' }).click()
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
  const app = await launchPairedApp(canonical())
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
  await event(app, { type: 'connected', serverId: 'other-connected', ack: { capabilities: ['thread'] } })
  await event(app, { type: 'conversationsReceived', serverId: 'other-connected', conversations: [SEEDED_ROW] })
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.getByPlaceholder('Message…').press('Enter')
  expect((await read()).commands.filter(c => ['sendMessage', 'newSession', 'interrupt', 'dequeueMessage'].includes(c.type))).toEqual([])
})


test('offline opening does not consume first-history eligibility', async ({ launchPairedApp }) => {
  const options = canonical()
  const app = await launchPairedApp(options)
  const held = { ...SEEDED_ROW, id: 'not-yet-opened', name: 'Held unread chat' }
  options.thread.setConversation({ summary: { ...held, current_session_id: SESSION }, epoch: EPOCH,
    version: 1, items: [] })
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, held] })
  app.daemon.pushFrame(frame({ type: 'thread_item_added', payload: { conversation_id: held.id,
    epoch: EPOCH, version: 2, item: item(10, 'assistant_message', 'running', { text: 'Received before opening' }) } }))
  await connection(app, 'disconnected')
  const read = await observe(app)
  await app.page.getByRole('button', { name: held.name, exact: true }).click()
  // An unqueried chat has no accepted epoch, so unverified live content stays hidden.
  await expect(app.page.getByText('Received before opening', { exact: false })).toHaveCount(0)
  await settle(app)
  expect(await read()).toEqual({ commands: [], attachments: [] })
  await connection(app, 'connected')
  // The fake's reconnect list can replace the injected row. Restore its stamped ownership.
  await event(app, { type: 'conversationsReceived', serverId: FIRST_SERVER_ID, conversations: [SEEDED_ROW, held] })
  await settle(app)
  await expect(app.page.getByText('Received before opening', { exact: true })).toBeVisible()
  expect((await read()).commands.filter(c => c.type === 'queryThread' && c.query.payload.conversation_id === held.id)).toHaveLength(1)
  await app.page.locator('.conversation__thread').focus()
  await app.page.keyboard.press('Home')
  await expect.poll(async () => (await read()).commands.filter(c => c.type === 'queryThread' && c.query.payload.conversation_id === held.id).length).toBe(1)
})
