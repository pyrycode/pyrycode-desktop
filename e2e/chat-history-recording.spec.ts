import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, seedConversationsFrame, type PairedApp } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ChatHistoryResult } from '../src/shared/chatHistory'
import { pairAnotherServerFromSettings } from './fixtures/pairingArrival'
import { readMainProcess } from './fixtures/mainProcessRead'

const ts = '2026-07-07T12:00:00.000Z'
const frame = (type: string, payload: Record<string, unknown>, in_reply_to?: number) =>
  encodeEnvelope({ id: 90, type, ts, payload, in_reply_to })
const entry = (i: number) => ({ id: i, type: 'message', ts, payload: {
  conversation_id: SEEDED_ROW.id, message_id: `old-${i}`, role: 'user', text: `loaded history ${i}` } })
const snapshotText = (result: ChatHistoryResult): string => result.status === 'stored' && result.snapshot.kind === 'timeline'
  ? result.snapshot.items.map((i) => 'text' in i ? i.text : '').join('|') : ''

test('confirmed deletion removes saved content through restart without waiting for a list refresh', async ({ launchPairedApp }) => {
  const commands: string[] = []
  let deleteReplyTo: number | undefined
  let confirmed = false
  const first = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    commands.push(env.type)
    if (env.type === 'delete_conversation') { deleteReplyTo = env.id; return [] }
    return env.type === 'list_conversations' && !confirmed ? [seedConversationsFrame()] : []
  } }, { secondServer: { buildReplyFrames: bytes => decodeEnvelope(bytes).type === 'list_conversations'
    ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : [] } })
  const { page, app, daemon } = first
  const serverId = first.servers[0].serverId
  const otherId = first.servers[1].serverId
  const read = (page: PairedApp['page'], host = serverId, conversationId = SEEDED_ROW.id) =>
    page.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId }),
      { serverId: host, conversationId })
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'deleted-turn', seq: 0, text: 'saved before confirmed deletion' }))
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: 'surviving-chat', turn_id: 'survivor-turn', seq: 0, text: 'same-host saved peer' }))
  await expect.poll(async () => snapshotText(await read(page))).toBe('saved before confirmed deletion')
  await expect.poll(async () => snapshotText(await read(page, serverId, 'surviving-chat'))).toBe('same-host saved peer')
  const saved = await read(page)
  if (saved.status !== 'stored' || saved.snapshot.kind !== 'timeline') throw new Error('Missing seed timeline')
  expect(await page.evaluate(({ serverId, snapshot }) => window.pyry.chatHistory({ operation: 'replaceTimeline',
    serverId, conversationId: snapshot.conversationId, snapshot: { ...snapshot, serverId } }),
  { serverId: otherId, snapshot: saved.snapshot })).toEqual({ status: 'ok' })
  // Observe the real operation's successful result, not just the command or renderer disappearance.
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('pyry:chat-history')
    if (!original) throw new Error('Missing chat history handler')
    ;(globalThis as any).__conversationRemovals = 0
    ipcMain.removeHandler('pyry:chat-history')
    ipcMain.handle('pyry:chat-history', async (event, request) => {
      const result = await original(event, request)
      if (request.operation === 'removeConversation' && result.status === 'ok') {
        (globalThis as any).__conversationRemovals++
      }
      return result
    })
  })
  // Read the counter through the tolerant helper: Electron can transiently lose its inspection
  // context while the app stays alive. Only the READS may retry — the wrapper install above is a
  // mutation and stays the single un-retried call it is.
  const removals = () => readMainProcess(app, () => (globalThis as any).__conversationRemovals)
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Delete this conversation permanently? This cannot be undone.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => deleteReplyTo).toBeDefined()
  expect(snapshotText(await read(page))).toBe('saved before confirmed deletion')
  // Bounded, so a genuinely dead app still fails fast. The counter only ever increments, so polling
  // to 0 is the same claim the single read made: nothing has been removed yet.
  await expect.poll(removals, { timeout: 5_000 }).toBe(0)
  confirmed = true
  await daemon.pushFrame(frame('conversation_deleted', { id: SEEDED_ROW.id }, deleteReplyTo))
  await expect.poll(removals, { timeout: 5_000 }).toBe(1)
  expect(await read(page)).toEqual({ status: 'missing' })
  expect(await page.evaluate(serverId => window.pyry.chatHistory({ operation: 'readList', serverId }), serverId))
    .toMatchObject({ status: 'stored', snapshot: { conversations: [] } })
  expect(snapshotText(await read(page, serverId, 'surviving-chat'))).toBe('same-host saved peer')
  expect(snapshotText(await read(page, otherId))).toBe('saved before confirmed deletion')
  await app.close()
  await daemon.close()
  const second = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  expect(await read(second.page)).toEqual({ status: 'missing' })
  expect(await second.page.evaluate(serverId => window.pyry.chatHistory({ operation: 'readList', serverId }), serverId))
    .toMatchObject({ status: 'stored', snapshot: { conversations: [] } })
  expect(snapshotText(await read(second.page, serverId, 'surviving-chat'))).toBe('same-host saved peer')
  expect(snapshotText(await read(second.page, otherId))).toBe('saved before confirmed deletion')
  expect(commands.filter(c => c === 'request_history')).toEqual([])
})

test('explicit unpair discards buffered history across restart while same-server repair retains it', async ({ launchPairedApp }) => {
  test.setTimeout(90_000)
  const commands: string[] = []
  const first = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    commands.push(env.type)
    return env.type === 'list_conversations' ? [seedConversationsFrame()] : []
  } }, { secondServer: { buildReplyFrames: bytes => decodeEnvelope(bytes).type === 'list_conversations'
    ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : [] } })
  const serverId = first.servers[0].serverId
  const otherId = first.servers[1].serverId
  const read = (page: PairedApp['page'], host = serverId, conversationId = SEEDED_ROW.id) =>
    page.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId }),
      { serverId: host, conversationId })
  const freshCode = () => Buffer.from(JSON.stringify({ server: serverId,
    relay: `${first.forwarder.url}/v1/client`, token: 'synthetic-repair-token',
    server_static_pubkey: Buffer.from(first.daemon.staticPublicKey).toString('base64') })).toString('base64url')
  await first.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'before-forget', seq: 0, text: 'saved before removal' }))
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: 'omitted-chat', turn_id: 'omitted', seq: 0, text: 'unlisted saved timeline' }))
  await expect.poll(async () => snapshotText(await read(first.page))).toBe('saved before removal')
  await expect.poll(async () => snapshotText(await read(first.page, serverId, 'omitted-chat'))).toBe('unlisted saved timeline')
  const saved = await read(first.page)
  if (saved.status !== 'stored' || saved.snapshot.kind !== 'timeline') throw new Error('Expected saved timeline')
  expect(await first.page.evaluate(({ serverId, snapshot }) => window.pyry.chatHistory({ operation: 'replaceTimeline',
    serverId, conversationId: snapshot.conversationId, snapshot: { ...snapshot, serverId } }),
  { serverId: otherId, snapshot: saved.snapshot })).toEqual({ status: 'ok' })

  first.forwarder.closeClientLeg(4401)
  await first.page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await first.page.locator('[aria-label="Pairing code"]').fill(freshCode())
  await first.page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(first.page.getByRole('group', { name: 'Server key fingerprint', exact: true })).toBeVisible()
  await first.page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(first.page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  expect(await read(first.page)).toEqual(saved)
  expect(await read(first.page, serverId, 'omitted-chat')).toMatchObject({ status: 'stored' })
  expect(commands).not.toContain('request_history')
  await first.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(first.page.locator('.bubble[data-thread-role="assistant"]')).toContainText('saved before removal')

  await first.page.clock.install({ time: new Date('2026-09-13T00:00:00Z') })
  await first.page.clock.pauseAt(new Date('2026-09-13T00:00:01Z'))
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'before-forget', seq: 1, text: ' buffered stale tail' }))
  await expect(first.page.locator('.bubble[data-thread-role="assistant"]')).toContainText('buffered stale tail')
  expect(await read(first.page)).toEqual(saved)
  await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
  const row = first.page.locator('.settings__server-row').filter({ has: first.page.locator('.settings__server-row-id', { hasText: new RegExp(`^${serverId}$`) }) })
  await row.getByRole('button', { name: 'Unpair', exact: true }).click()
  await row.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(first.page.locator('.settings__server-row-id')).toHaveText([otherId])
  await first.page.clock.runFor(500)
  expect(await read(first.page)).toEqual({ status: 'error', code: 'unknown-host' })
  expect(snapshotText(await read(first.page, otherId))).toBe('saved before removal')
  await first.page.clock.resume()
  await first.page.getByRole('button', { name: 'Back', exact: true }).click()
  // Re-pair in the same renderer: restarting here would hide retained omitted slices.
  const second = first
  await pairAnotherServerFromSettings(second.page, freshCode())
  await expect(second.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true })).toBeVisible()
  expect(await read(second.page)).toEqual({ status: 'missing' })
  expect(await read(second.page, serverId, 'omitted-chat')).toEqual({ status: 'missing' })
  expect(snapshotText(await read(second.page, otherId))).toBe('saved before removal')
  await second.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'after-forget', seq: 0, text: 'fresh after re-pair' }))
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: 'omitted-chat', turn_id: 'fresh-omitted', seq: 0, text: 'fresh omitted timeline' }))
  await expect.poll(async () => snapshotText(await read(second.page))).toBe('fresh after re-pair')
  await expect.poll(async () => snapshotText(await read(second.page, serverId, 'omitted-chat'))).toBe('fresh omitted timeline')
  expect(commands).not.toContain('request_history')
  await second.app.close()
  const third = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  expect(snapshotText(await read(third.page))).toBe('fresh after re-pair')
  expect(snapshotText(await read(third.page, serverId, 'omitted-chat'))).toBe('fresh omitted timeline')
  expect(snapshotText(await read(third.page, otherId))).toBe('saved before removal')
})

async function observeCommands(app: PairedApp) {
  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Debugger.enable')
  await app.page.evaluate(() => { (window as any).__savedCommands = [] })
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
    condition: '(globalThis.__savedCommands.push(arguments[0]), false)' })
  return () => app.page.evaluate(() => (window as any).__savedCommands as object[])
}

test('records received content, drains buffered quit, and reads locally after relaunch', async ({ launchPairedApp }) => {
  let historyAsks = 0
  const queuedText = 'queued echo to cancel'
  let queuedMessageId: string | undefined
  let dequeues = 0
  const first = await launchPairedApp({ buildReplyFrames: (bytes) => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'send_message' && env.payload.text === queuedText && typeof env.payload.message_id === 'string') {
      queuedMessageId = env.payload.message_id
    }
    if (env.type === 'dequeue_message') dequeues++
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type !== 'request_history') return []
    historyAsks++
    const opening = env.payload.cursor === ''
    return [frame('history_page', { entries: opening ? Array.from({ length: 14 }, (_, i) => entry(i + 1)) : [entry(0)],
      cursor: opening ? 'older-page' : 'oldest-page', at_start: !opening }, env.id)]
  } })
  const { page, daemon, app, servers, userDataDir, forwarder } = first
  const serverId = servers[0].serverId
  const read = () => page.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({
    operation: 'readTimeline', serverId, conversationId }), { serverId, conversationId: SEEDED_ROW.id })
  await page.locator('.conversation__thread').focus()
  await page.keyboard.press('Home')
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(14)
  await expect.poll(async () => {
    await page.locator('.conversation__thread').evaluate((el) => { el.scrollTop = el.scrollTop === 1 ? 2 : 1 })
    await page.locator('.conversation__thread').focus()
    await page.keyboard.press('ArrowUp')
    return historyAsks
  }).toBe(2)
  await expect(page.locator('.bubble[data-thread-role="user"]').first()).toContainText('loaded history 0')
  await page.getByPlaceholder('Message…').fill('composer echo saved')
  await page.getByRole('button', { name: 'Send' }).click()
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'partial-turn', seq: 0, text: 'live partial' }))
  await expect.poll(async () => snapshotText(await read())).toContain('live partial')
  const saved = await read()
  expect(saved).toMatchObject({ status: 'stored', snapshot: { prependedRows: 15,
    coverage: { status: 'received', cursor: 'oldest-page', atStart: true } } })
  expect(snapshotText(saved)).toContain('composer echo saved')

  await page.getByPlaceholder('Message…').fill(queuedText)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect.poll(() => queuedMessageId).toEqual(expect.any(String))
  await expect.poll(async () => snapshotText(await read())).toContain(queuedText)
  await daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id,
    queued: [{ queued_msg_id: 7, message_id: queuedMessageId, text: queuedText, ts }] }))
  await page.getByRole('button', { name: 'Drop queued message' }).click()
  await expect.poll(() => dequeues).toBe(1)
  await daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [] }))
  await expect(page.locator('.conversation__thread')).not.toContainText(queuedText)
  await expect.poll(read).toEqual(saved)

  // Freeze only renderer timers: the final received updates cannot reach their scheduled save.
  await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'))
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'partial-turn', seq: 1, text: ' final buffered text' }))
  await daemon.pushFrame(seedConversationsFrame({ ...SEEDED_ROW, name: 'latest received list' }))
  await expect.poll(() => page.locator('.bubble[data-thread-role="assistant"]').textContent()).toContain('final buffered text')
  await expect.poll(() => page.locator('.channel-list__row-open').textContent()).toContain('latest received list')
  expect(snapshotText(await read())).not.toContain('final buffered text')
  forwarder.closeClientLeg(4401)
  await expect.poll(() => page.getByRole('button', { name: 'Pairing error - Re-pair' }).count()).toBe(1)
  expect(await read()).toEqual(saved)
  expect(await page.evaluate((serverId) => window.pyry.chatHistory({ operation: 'replaceList', serverId,
    snapshot: { version: 1, kind: 'list', serverId, conversations: [] } }), serverId)).toEqual({ status: 'ok' })
  expect(await page.evaluate(() => window.pyry.chatHistory({ operation: 'readList', serverId: 'unsaved-host' })))
    .toEqual({ status: 'error', code: 'unknown-host' })
  expect(historyAsks).toBe(2)
  await app.close()
  await daemon.close()

  const second = await launchPairedApp({}, { reuseUserDataDir: userDataDir })
  await expect(second.page.locator('.channel-list__row-open')).toHaveText(['latest received list'])
  await expect(second.page.locator('.conversation')).toHaveCount(0)
  await expect(second.page.locator('[aria-current="true"]')).toHaveCount(0)
  const outbound = await observeCommands(second)
  await second.page.getByRole('button', { name: 'latest received list', exact: true }).click()
  await expect(second.page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
  await expect(second.page.locator('.bubble[data-thread-role="assistant"]')).toContainText('live partial final buffered text')
  await expect(second.page.locator('.bubble__cursor')).toHaveCount(0)
  await expect(second.page.getByText('Older messages require a connection.', { exact: true })).toHaveCount(0)
  await second.page.locator('.bubble[data-thread-role="assistant"]').getByRole('button', { name: 'Copy message' }).click()
  await expect.poll(() => second.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('live partial final buffered text')
  await second.page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  expect(await outbound()).toEqual([])
  await expect(second.page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(second.page.getByRole('img', { name: 'Assistant working', exact: true })).toHaveCount(0)
  await second.page.setViewportSize({ width: 800, height: 800 })
  await second.page.screenshot({ path: '/tmp/builder-1388-offline-800.png', animations: 'disabled' })
  const reread = await second.page.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({
    operation: 'readTimeline', serverId, conversationId }), { serverId, conversationId: SEEDED_ROW.id })
  expect(snapshotText(reread)).toContain('live partial final buffered text')
  expect(snapshotText(reread)).toContain('loaded history 0')
  expect(snapshotText(reread)).toContain('composer echo saved')
  expect(reread).toMatchObject({ status: 'stored', snapshot: { prependedRows: 15,
    coverage: { status: 'received', cursor: 'oldest-page', atStart: true } } })
  if (reread.status !== 'stored' || reread.snapshot.kind !== 'timeline') throw new Error('missing timeline')
  expect(reread.snapshot.items.some((i) => i.kind === 'turnBoundary')).toBe(false)
  expect(await second.page.evaluate((serverId) => window.pyry.chatHistory({ operation: 'readList', serverId }), serverId))
    .toMatchObject({ status: 'stored', snapshot: { conversations: [{ ...SEEDED_ROW, name: 'latest received list' }] } })
  expect(await second.page.evaluate(({ serverId, conversationId, snapshot }) => window.pyry.chatHistory({
    operation: 'replaceTimeline', serverId, conversationId, snapshot }),
  { serverId, conversationId: SEEDED_ROW.id, snapshot: reread.snapshot })).toEqual({ status: 'ok' })
  expect(historyAsks).toBe(2)
})

test('window close drains the writer and a reopened window can read its saved rows', async ({ launchPairedApp }) => {
  const { page, app, daemon, servers } = await launchPairedApp()
  await page.clock.install({ time: new Date('2026-09-12T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-09-12T12:00:01Z'))
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'window-turn', seq: 0, text: 'buffered before window close' }))
  await expect.poll(() => page.locator('.bubble[data-thread-role="assistant"]').textContent()).toContain('buffered before window close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  const [reopened] = await Promise.all([app.waitForEvent('window'), app.evaluate(({ app }) => app.emit('activate'))])
  const result = await reopened.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({
    operation: 'readTimeline', serverId, conversationId }), { serverId: servers[0].serverId, conversationId: SEEDED_ROW.id })
  expect(snapshotText(result)).toBe('buffered before window close')
})

test('restores a pairing-rejected saved host beside a usable connected host', async ({ launchPairedApp }) => {
  let rejected = false
  const commands: string[] = []
  const first = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    commands.push(env.type)
    if (rejected) return [frame('error', { code: 'auth.invalid_token', message: 'private', retryable: false })]
    return env.type === 'list_conversations' ? [seedConversationsFrame()] : []
  } }, { secondServer: { buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    commands.push(env.type)
    return env.type === 'list_conversations' ? [seedConversationsFrame(SECOND_SEEDED_ROW)] : []
  } } })
  await first.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'saved-rejected', seq: 0, text: 'Saved rejected-host reply'
  }))
  await expect(first.page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Saved rejected-host reply')
  await first.app.close()
  rejected = true
  commands.length = 0
  const second = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  // The original endpoints remain alive: one rejects pairing, the other reconnects normally.
  const { page } = second
  await expect(page.getByRole('img', { name: 'Pyrycode Pairing rejected', exact: true })).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Pyrycode Connected', exact: true })).toHaveCount(2)
  await expect(page.locator('.channel-list__row-open')).toHaveText([SEEDED_ROW.name!, SECOND_SEEDED_ROW.name!])
  await expect(page.locator('.conversation')).toHaveCount(0)
  expect(commands.filter(c => c !== 'list_conversations')).toEqual([])
  const outbound = await observeCommands(second)
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(page.locator('.bubble[data-thread-role="assistant"]')).toContainText('Saved rejected-host reply')
  await expect(page.getByText('Older messages require a connection.', { exact: true })).toBeVisible()
  await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  await page.locator('.bubble[data-thread-role="assistant"]').getByRole('button', { name: 'Copy message' }).click()
  await expect.poll(() => second.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Saved rejected-host reply')
  expect(await outbound()).toEqual([])
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1388-rejected-1280.png', animations: 'disabled' })
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  expect(commands.filter(c => c !== 'list_conversations')).toEqual([])
  await page.getByRole('button', { name: SECOND_SEEDED_ROW.name!, exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await page.locator('.conversation__thread').focus()
  await page.keyboard.press('Home')
  await expect.poll(() => commands.includes('request_history')).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1387-mixed-1280.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
})

test('pending saved reading survives opening and cancelling host repair', async ({ launchPairedApp }) => {
  const launched = await launchPairedApp()
  const { app, page, daemon, forwarder, servers } = launched
  const text = 'Saved reply after repair cancellation'
  await daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'repair-read', seq: 0, text
  }))
  const read = () => page.evaluate(({ serverId, conversationId }) => window.pyry.chatHistory({
    operation: 'readTimeline', serverId, conversationId
  }), { serverId: servers[0].serverId, conversationId: SEEDED_ROW.id })
  await expect.poll(async () => snapshotText(await read())).toBe(text)
  const saved = await read()
  forwarder.closeClientLeg(4401)
  await expect(page.getByRole('button', { name: 'Pairing error - Re-pair' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: SEEDED_ROW.name!, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Repair host', exact: true }).first()).toBeVisible()

  // Hold the real saved result at the IPC boundary until repair has been cancelled.
  await app.evaluate(({ ipcMain }, saved) => {
    ipcMain.removeHandler('pyry:chat-history')
    ipcMain.handle('pyry:chat-history', (_event, request) => {
      if (request.operation !== 'readTimeline') return { status: 'error', code: 'unreadable' }
      return new Promise(resolve => { (globalThis as any).__releaseSavedRead = () => resolve(saved) })
    })
  }, saved)
  // Observe renderer IPC before host routing can discard an offline command.
  await app.evaluate(({ ipcMain }) => {
    (globalThis as any).__offlineCommands = []
    ipcMain.on('pyry:command', (_event, command) => {
      (globalThis as any).__offlineCommands.push(command)
    })
  })
  const outbound = () => app.evaluate(() => (globalThis as any).__offlineCommands)
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(page.getByText('Loading saved messages…', { exact: true })).toBeVisible()
  await expect.poll(() => app.evaluate(() => typeof (globalThis as any).__releaseSavedRead)).toBe('function')
  await page.getByRole('button', { name: 'Repair host', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Pair', exact: true })).toHaveCount(0)
  await app.evaluate(() => (globalThis as any).__releaseSavedRead())
  const reply = page.locator('.bubble[data-thread-role="assistant"]')
  await expect(reply).toContainText(text)
  await expect(page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
  await reply.getByRole('button', { name: 'Copy message' }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(text)
  await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')) })
  expect(await outbound()).toEqual([])
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
})

test('local list read failures stay beside the saved host', async ({ launchPairedApp }) => {
  const { app, page, daemon, forwarder } = await launchPairedApp()
  await daemon.close()
  await forwarder.close()
  // Inject a classified storage failure at the existing IPC boundary, without changing pairing data.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('pyry:chat-history')
    ipcMain.handle('pyry:chat-history', () => ({ status: 'error', code: 'unreadable' }))
  })
  await page.reload()
  await expect(page.locator('.channel-list__local-read-error')).toHaveCount(2)
  await expect(page.locator('.channel-list__local-read-error').first())
    .toHaveText('Could not read saved chats on this device.')
  await expect(page.locator('.channel-list__host')).toHaveCount(2)
  await expect(page.locator('.channel-list__row-open')).toHaveCount(0)
  await expect(page.locator('.conversation')).toHaveCount(0)
  await page.setViewportSize({ width: 800, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1387-local-error-800.png', animations: 'disabled' })
})

test('saved coverage survives offline restart, reconnect, live receipts and connected reopening', async ({ launchPairedApp }) => {
  test.setTimeout(90_000)
  let unavailable = false
  let drop: () => void = () => {}
  const cursors: unknown[] = []
  const newPayload = { conversation_id: SEEDED_ROW.id, turn_id: 'after-reconnect', seq: 0, text: 'New same-host reply' }
  const observe = async (app: PairedApp['app']) => {
    await app.evaluate(({ ipcMain }) => {
      ;(globalThis as any).__continuityCommands = []
      ipcMain.on('pyry:command', (_event, command) => (globalThis as any).__continuityCommands.push(command))
    })
  }
  const count = (app: PairedApp['app']) => app.evaluate(() =>
    (globalThis as any).__continuityCommands.filter((c: any) => c.type === 'requestHistory').length)
  const settle = (page: PairedApp['page']) => page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const read = (page: PairedApp['page']) => page.evaluate(conversationId => window.pyry.chatHistory({
    operation: 'readTimeline', serverId: 'fake-daemon', conversationId
  }), SEEDED_ROW.id)
  const first = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (unavailable) { drop(); return [] }
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type !== 'request_history') return []
    cursors.push(env.payload.cursor)
    return [frame('history_page', { entries: env.payload.cursor === '' ? [entry(1)] : [
      { id: 99, type: 'assistant_delta', ts, payload: newPayload }, entry(0)],
    cursor: env.payload.cursor === '' ? 'saved-cursor' : 'advanced-cursor', at_start: false }, env.id)]
  } }, { onLaunched: observe })
  drop = () => first.forwarder.dropClientLeg()
  await settle(first.page)
  expect(await count(first.app)).toBe(0)
  await first.page.locator('.conversation__thread').focus()
  await first.page.keyboard.press('Home')
  await expect(first.page.locator('.bubble')).toHaveCount(1)
  await first.daemon.pushFrame(frame('assistant_delta', {
    conversation_id: SEEDED_ROW.id, turn_id: 'saved-partial', seq: 0, text: 'Restored partial reply' }))
  await expect.poll(() => read(first.page)).toMatchObject({ status: 'stored', snapshot: {
    coverage: { status: 'received', cursor: 'saved-cursor', atStart: false } } })
  await expect.poll(async () => snapshotText(await read(first.page))).toContain('Restored partial reply')
  await first.app.close()
  unavailable = true

  const second = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir, onLaunched: observe })
  await second.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(second.page.getByText('Offline. Showing saved messages.', { exact: true })).toBeVisible()
  await expect(second.page.locator('.bubble')).toHaveCount(2)
  await expect(second.page.locator('.bubble__cursor')).toHaveCount(0)
  await expect(second.page.getByText('Older messages require a connection.', { exact: true })).toBeVisible()
  expect(await count(second.app)).toBe(0)
  unavailable = false
  await expect(second.page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect(second.page.getByText('Offline. Showing saved messages.', { exact: true })).toHaveCount(0)
  await expect(second.page.locator('.bubble__cursor')).toHaveCount(0)
  await expect(second.page.locator('.bubble')).toHaveCount(2)
  await settle(second.page)
  expect(await count(second.app)).toBe(0)
  await second.page.setViewportSize({ width: 800, height: 800 })
  await second.page.screenshot({ path: '/tmp/builder-1395-reconnected-800.png', animations: 'disabled' })
  await first.daemon.pushFrame(frame('assistant_delta', newPayload))
  await expect(second.page.locator('.bubble')).toHaveCount(3)
  await expect(second.page.locator('.bubble__cursor')).toHaveCount(1)
  await expect.poll(async () => snapshotText(await read(second.page))).toContain('New same-host reply')
  await second.page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0 })
  await second.page.locator('.conversation__thread').focus()
  await second.page.keyboard.press('Home')
  await expect(second.page.locator('.bubble')).toHaveCount(4)
  expect(cursors).toEqual(['', 'saved-cursor'])
  expect(await count(second.app)).toBe(1)
  await expect.poll(() => read(second.page)).toMatchObject({ status: 'stored', snapshot: {
    prependedRows: 2, coverage: { status: 'received', cursor: 'advanced-cursor', atStart: false } } })
  const saved = await read(second.page)
  expect(snapshotText(saved)).toBe('loaded history 0|loaded history 1|Restored partial reply|New same-host reply')
  await second.app.close()

  // Hold the actual protected read result, leaving the real writer and all other operations intact.
  const third = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir, onLaunched: async app => {
    await observe(app)
    await app.evaluate(({ ipcMain }) => {
      const original = (ipcMain as any)._invokeHandlers.get('pyry:chat-history')
      if (!original) throw new Error('Missing chat history handler')
      ipcMain.removeHandler('pyry:chat-history')
      ipcMain.handle('pyry:chat-history', async (event, request) => {
        const result = await original(event, request)
        if (request.operation !== 'readTimeline') return result
        return new Promise(resolve => { (globalThis as any).__releaseContinuityRead = () => resolve(result) })
      })
    })
  } })
  await expect(third.page.getByRole('img', { name: 'Pyrycode Connected', exact: true }).first()).toBeVisible()
  await third.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => third.app.evaluate(() => typeof (globalThis as any).__releaseContinuityRead)).toBe('function')
  await expect(third.page.getByText('Loading saved messages…', { exact: true })).toBeVisible()
  await third.page.locator('.conversation__thread').focus()
  await third.page.keyboard.press('Home')
  await settle(third.page)
  expect(await count(third.app)).toBe(0)
  await third.app.evaluate(() => (globalThis as any).__releaseContinuityRead())
  await expect(third.page.locator('.bubble')).toHaveCount(4)
  await expect(third.page.locator('.bubble__cursor')).toHaveCount(0)
  await expect(third.page.getByText('Offline. Showing saved messages.', { exact: true })).toHaveCount(0)
  await third.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect(third.page.locator('.bubble')).toHaveCount(4)
  await settle(third.page)
  expect(await count(third.app)).toBe(0)
  expect(await third.page.locator('.bubble').allTextContents()).toEqual([
    expect.stringContaining('loaded history 0'), expect.stringContaining('loaded history 1'),
    expect.stringContaining('Restored partial reply'), expect.stringContaining('New same-host reply')])
  await third.page.setViewportSize({ width: 1280, height: 800 })
  await third.page.screenshot({ path: '/tmp/builder-1395-connected-1280.png', animations: 'disabled' })
  await third.page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0 })
  await third.page.locator('.conversation__thread').focus()
  await third.page.keyboard.press('ArrowUp')
  await expect.poll(() => count(third.app)).toBe(1)
  expect(cursors).toEqual(['', 'saved-cursor', 'advanced-cursor'])
})
