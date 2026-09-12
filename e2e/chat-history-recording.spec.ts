import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ChatHistoryResult } from '../src/shared/chatHistory'

const ts = '2026-07-07T12:00:00.000Z'
const frame = (type: string, payload: Record<string, unknown>, in_reply_to?: number) =>
  encodeEnvelope({ id: 90, type, ts, payload, in_reply_to })
const entry = (i: number) => ({ id: i, type: 'message', ts, payload: {
  conversation_id: SEEDED_ROW.id, message_id: `old-${i}`, role: 'user', text: `loaded history ${i}` } })
const snapshotText = (result: ChatHistoryResult): string => result.status === 'stored' && result.snapshot.kind === 'timeline'
  ? result.snapshot.items.map((i) => 'text' in i ? i.text : '').join('|') : ''

test('records received content, drains buffered quit, and reads locally after relaunch', async ({ launchPairedApp }) => {
  let historyAsks = 0
  const first = await launchPairedApp({ buildReplyFrames: (bytes) => {
    const env = decodeEnvelope(bytes)
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
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(14)
  await expect.poll(async () => {
    await page.locator('.conversation__thread').evaluate((el) => { el.scrollTop = el.scrollTop === 1 ? 2 : 1 })
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
