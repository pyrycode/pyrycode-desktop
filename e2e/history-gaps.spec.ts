import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, HistoryPagePayload } from '../src/shared/wire/types'

const newestIds = Array.from({ length: 20 }, (_, index) => index + 8)
const ts = '2026-10-07T12:00:00Z'
const message = (id: number): HistoryPagePayload['entries'][number] => ({ id, type: 'message', ts,
  payload: { conversation_id: SEEDED_ROW.id, message_id: `m-${id}`, role: 'user', text: `Gap row ${id}` } })
const reply = (ask: Envelope, ids: number[], cursor: string, tool = false) => encodeEnvelope({
  id: 90, type: 'history_page', ts, in_reply_to: ask.id, payload: {
    entries: ids.map(id => tool && id === 3 ? { id, type: 'tool_result', ts, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: 't', tool_use_id: 'held-tool', is_error: false, result_summary: 'held result'
    } } : tool && id === 2 ? { id, type: 'tool_use', ts, payload: {
      conversation_id: SEEDED_ROW.id, turn_id: 't', tool_use_id: 'held-tool', name: 'Read', input_summary: 'held tool', input: { path: 'synthetic.txt' }
    } } : message(id)), cursor, at_start: true
  } })

test('known gaps require fresh input, retain failure/resume, anchor and expansion through protected restoration', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const { app, page, daemon, servers } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') asks.push(env)
    return []
  } })
  await page.setViewportSize({ width: 1280, height: 800 })
  const thread = page.locator('.conversation__thread')
  await expect.poll(() => asks.length).toBe(1)
  daemon.pushFrame(reply(asks[0], [1, 2, 3], 'held-end', true))
  await expect(thread).toContainText('Gap row 1')
  const tool = thread.locator('.tool-row__chip--toggle').first()
  await tool.click()
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  await page.locator('.archive__back').click()
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => asks.length).toBe(2)
  daemon.pushFrame(reply(asks[1], newestIds, 'gap-start'))
  const marker = thread.locator('[data-history-gap]')
  await expect(marker).toHaveText('Load earlier messages')
  await expect(thread.locator('.bubble')).toHaveCount(21)
  expect(await thread.innerText()).toMatch(/Gap row 1[\s\S]*Load earlier messages[\s\S]*Gap row 8[\s\S]*Gap row 9/)
  // Expand after navigation; preserve this exact mounted identity during the walk.
  await tool.click()
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  await marker.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.getByPlaceholder('Message…').focus()
  await page.keyboard.press('ArrowUp')
  await thread.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true })))
  await page.setViewportSize({ width: 800, height: 600 })
  await app.evaluate(() => {})
  expect(asks).toHaveLength(2)
  await marker.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: '/tmp/builder-1879/gap-idle-800.png', animations: 'disabled' })
  await thread.focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => asks.length).toBe(3)
  expect(asks[2].payload).toEqual({ conversation_id: SEEDED_ROW.id, cursor: 'gap-start', limit: 200 })
  await expect(marker).toHaveText('Loading earlier messages…')
  for (const key of ['ArrowUp', 'Home', 'PageUp']) await page.keyboard.press(key)
  await app.evaluate(() => {})
  expect(asks).toHaveLength(3)
  daemon.pushFrame(encodeEnvelope({ id: 91, type: 'error', ts, in_reply_to: asks[2].id,
    payload: { code: 'history.unavailable', message: 'private failure' } }))
  await expect(marker).toContainText('Could not load older messages')
  await expect(marker.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/builder-1879/gap-failed-800.png', animations: 'disabled' })
  await marker.evaluate(node => {
    const thread = node.parentElement!
    const header = document.querySelector('.conversation__top-chrome')!.getBoundingClientRect().bottom
    thread.scrollTop += node.getBoundingClientRect().top - header - 4
  })
  await marker.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => asks.length).toBe(4)
  expect(asks[3].payload).toEqual(asks[2].payload)
  const anchor = thread.getByText('Gap row 8', { exact: true })
  const before = (await anchor.boundingBox())!.y
  daemon.pushFrame(reply(asks[3], [6, 7], 'gap-step'))
  await expect(marker).toHaveText('Load earlier messages')
  await expect(thread.locator('.bubble')).toHaveCount(23)
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2)
  await app.evaluate(() => {})
  expect(asks).toHaveLength(4)
  // Protected snapshot observation is a persistence barrier, separate from rendered rows.
  await expect.poll(() => page.evaluate(async ({ id, serverId }) => {
    const saved = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId: id })
    return saved.status === 'stored' && saved.snapshot.kind === 'timeline' ? saved.snapshot.gaps?.[0]?.cursor : null
  }, { id: SEEDED_ROW.id, serverId: servers[0].serverId })).toBe('gap-step')
  await page.reload()
  await expect(page.getByRole('button', { name: SEEDED_ROW.name!, exact: true })).toBeVisible()
  await page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => asks.length).toBe(5)
  daemon.pushFrame(reply(asks[4], newestIds, 'newest-overlap'))
  await expect(marker).toHaveText('Load earlier messages')
  await marker.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await thread.focus()
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => asks.length).toBe(6)
  expect(asks[5].payload.cursor).toBe('gap-step')
  daemon.pushFrame(reply(asks[5], [4, 5], 'gap-done'))
  await expect(marker).toHaveCount(0)
  await expect(thread.locator('.bubble')).toHaveCount(25)
  expect(await thread.locator('.bubble').allTextContents()).toEqual(expect.arrayContaining(
    [1, 4, 5, 6, 7, ...newestIds].map(id => expect.stringContaining(`Gap row ${id}`))))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1879/gap-complete-1280.png', animations: 'disabled' })
  await thread.focus()
  await page.keyboard.press('Home')
  await app.evaluate(() => {})
  expect(asks).toHaveLength(6)
})
