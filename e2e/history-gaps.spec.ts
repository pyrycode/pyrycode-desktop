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
  // Focus and layout can invalidate a park before the pre-scroll demand measurement.
  const settled = () => expect.poll(() => thread.evaluate(async el => {
    const metrics = () => [el.scrollTop, el.scrollHeight, el.clientHeight, el.clientWidth]
    let previous = metrics()
    for (let frame = 0; frame < 3; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const next = metrics()
      if (next.some((value, index) => Math.abs(value - previous[index]) > 0.1)) return false
      previous = next
    }
    return true
  })).toBe(true)
  const prepareGapInput = async (expectedRequests: number) => {
    await page.mouse.move(0, 0)
    await thread.focus()
    await expect(thread).toBeFocused()
    await settled()
    await marker.evaluate(node => {
      const el = node.parentElement!, viewport = el.getBoundingClientRect()
      const top = Math.max(viewport.top, document.querySelector('.conversation__top-chrome')!.getBoundingClientRect().bottom)
      const bottom = Math.min(viewport.bottom, document.querySelector('.conversation__input-chrome')!.getBoundingClientRect().top)
      const rect = node.getBoundingClientRect()
      el.scrollTop += (rect.top + rect.bottom - top - bottom) / 2
    })
    await settled()
    await expect.poll(() => marker.evaluate(node => {
      const el = node.parentElement!, viewport = el.getBoundingClientRect(), rect = node.getBoundingClientRect()
      const top = Math.max(viewport.top, document.querySelector('.conversation__top-chrome')!.getBoundingClientRect().bottom)
      const bottom = Math.min(viewport.bottom, document.querySelector('.conversation__input-chrome')!.getBoundingClientRect().top)
      return document.activeElement === el && rect.height > 0 && rect.bottom > top && rect.top < bottom
    })).toBe(true)
    await app.evaluate(() => {})
    expect(asks).toHaveLength(expectedRequests)
  }
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
  await prepareGapInput(2)
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
  await prepareGapInput(5)
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

test('legacy and refused gap evidence survives full Electron relaunch and needs fresh reader steps', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const first = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') asks.push(env)
    return []
  } })
  await expect.poll(() => asks.length).toBe(1)
  first.daemon.pushFrame(reply(asks[0], [1, 2, 3], 'held-end', true))
  const serverId = first.servers[0].serverId
  const read = (page: typeof first.page) => page.evaluate(async serverId => {
    const saved = await window.pyry.chatHistory({ operation: 'readTimeline', serverId, conversationId: 'seed-conversation' })
    return saved.status === 'stored' && saved.snapshot.kind === 'timeline' ? saved.snapshot : null
  }, serverId)
  await expect.poll(() => read(first.page)).not.toBeNull()
  // Project an old protected display-only snapshot through the shipped validated IPC API.
  const saved = (await read(first.page))!
  await first.page.evaluate(async ({ saved, serverId }) => {
    const { served: _served, display: _display, gaps: _gaps, newestCursor: _newest, ...legacy } = saved
    await window.pyry.chatHistory({ operation: 'replaceTimeline', serverId, conversationId: legacy.conversationId, snapshot: legacy })
  }, { saved, serverId })
  await first.app.close()
  const second = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await second.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => asks.length).toBe(2)
  first.daemon.pushFrame(reply(asks[1], newestIds, 'bad-origin'))
  const thread = second.page.locator('.conversation__thread'), marker = thread.locator('[data-history-gap]')
  await expect(marker).toHaveText('Load earlier messages')
  expect(await thread.innerText()).toMatch(/Gap row 1[\s\S]*synthetic.txt[\s\S]*Load earlier messages[\s\S]*Gap row 8/)
  const tool = thread.locator('.tool-row__chip--toggle').first()
  await tool.click()
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  const step = async () => {
    await marker.first().evaluate(el => el.scrollIntoView({ block: 'center' }))
    await thread.focus(); await second.page.keyboard.press('ArrowUp')
  }
  await step(); await expect.poll(() => asks.length).toBe(3)
  expect(asks[2].payload.cursor).toBe('bad-origin')
  first.daemon.pushFrame(encodeEnvelope({ id: 91, type: 'error', ts, in_reply_to: asks[2].id,
    payload: { code: 'history.invalid_cursor', message: 'synthetic refusal' } }))
  await expect(marker).toHaveText('Could not load older messages')
  await expect(marker.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await read(second.page))?.gaps?.[0].refusedCursors).toEqual(['bad-origin'])
  await second.page.setViewportSize({ width: 800, height: 600 })
  await marker.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await second.page.screenshot({ path: '/tmp/builder-1880/refused-800.png', animations: 'disabled' })
  expect(asks).toHaveLength(3)
  await step(); await expect.poll(() => asks.length).toBe(4)
  expect(asks[3].payload.cursor).toBe('')
  first.daemon.pushFrame(reply(asks[3], newestIds, 'bad-origin'))
  await expect(marker).toHaveText('Load earlier messages')
  await second.app.evaluate(() => {})
  expect(asks).toHaveLength(4)
  await expect(tool).toHaveAttribute('aria-expanded', 'true')
  await second.app.close()
  const third = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await third.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => asks.length).toBe(5)
  first.daemon.pushFrame(reply(asks[4], newestIds, 'bad-origin'))
  const restoredThread = third.page.locator('.conversation__thread')
  const restoredMarker = restoredThread.locator('[data-history-gap]')
  await expect(restoredMarker).toHaveText('Load earlier messages')
  expect((await read(third.page))?.gaps?.[0].refusedCursors).toEqual(['bad-origin'])
  expect((await read(third.page))?.coverage).toEqual({ status: 'received', cursor: 'held-end', atStart: true })
  const restoredTool = restoredThread.locator('.tool-row__chip--toggle').first()
  await restoredTool.click()
  const freshStep = async () => {
    await restoredMarker.first().evaluate(el => el.scrollIntoView({ block: 'center' }))
    await restoredThread.focus(); await third.page.keyboard.press('ArrowUp')
  }
  await freshStep(); await expect.poll(() => asks.length).toBe(6)
  expect(asks[5].payload.cursor).toBe('')
  first.daemon.pushFrame(reply(asks[5], newestIds, 'usable-origin'))
  await expect(restoredMarker).toHaveText('Load earlier messages')
  expect(asks).toHaveLength(6)
  await third.page.setViewportSize({ width: 1280, height: 800 })
  await restoredMarker.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await third.page.screenshot({ path: '/tmp/builder-1880/legacy-idle-1280.png', animations: 'disabled' })
  await freshStep(); await expect.poll(() => asks.length).toBe(7)
  expect(asks[6].payload.cursor).toBe('usable-origin')
  const anchor = restoredThread.getByText('Gap row 8', { exact: true })
  await restoredMarker.evaluate(node => {
    const header = document.querySelector('.conversation__top-chrome')!.getBoundingClientRect().bottom
    node.parentElement!.scrollTop += node.getBoundingClientRect().top - header - 4
  })
  await third.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const before = (await anchor.boundingBox())!.y
  const frame = decodeEnvelope(reply(asks[6], [4, 5, 6, 7], 'walk'))
  first.daemon.pushFrame(encodeEnvelope({ ...frame, payload: { ...frame.payload, at_start: false } }))
  await expect(restoredMarker).toHaveText('Load earlier messages')
  await expect(restoredTool).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2)
  expect(await restoredThread.innerText()).toMatch(/Gap row 1[\s\S]*synthetic.txt[\s\S]*Gap row 4[\s\S]*Gap row 8/)
  expect(asks).toHaveLength(7)
  await freshStep(); await expect.poll(() => asks.length).toBe(8)
  // Only the tool identity proves overlap: omit the held operator ID and fresh-walk atStart.
  const joined = decodeEnvelope(reply(asks[7], [2, 3, 4], 'done', true))
  first.daemon.pushFrame(encodeEnvelope({ ...joined, payload: { ...joined.payload, at_start: false } }))
  await expect(restoredMarker).toHaveCount(0)
  await expect(restoredTool).toHaveAttribute('aria-expanded', 'true')
  await expect(restoredThread.getByText('Gap row 1', { exact: true })).toHaveCount(1)
  await expect(restoredThread.locator('.tool-row__chip--toggle')).toHaveCount(1)
  await expect.poll(async () => (await read(third.page))?.gaps).toEqual([])
  const recovered = (await read(third.page))!
  expect(recovered.display).toContainEqual(expect.objectContaining({ id: 2, kind: 'row',
    rowKey: saved.rowIdentity!.rowKeys[1], joinKey: `toolUse ${ts}` }))
  expect(recovered.rowIdentity!.rowKeys.filter(key => saved.rowIdentity!.rowKeys.includes(key)))
    .toEqual(saved.rowIdentity!.rowKeys)
  await third.app.close()
  const fourth = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await fourth.page.getByRole('button', { name: SEEDED_ROW.name!, exact: true }).click()
  await expect.poll(() => asks.length).toBe(9)
  first.daemon.pushFrame(reply(asks[8], newestIds, 'reopened'))
  const reopenedThread = fourth.page.locator('.conversation__thread')
  await expect(reopenedThread.locator('.tool-row__chip--toggle')).toHaveCount(1)
  await expect(reopenedThread.getByText('Gap row 1', { exact: true })).toHaveCount(1)
  await expect(reopenedThread.locator('[data-history-gap]')).toHaveCount(0)
  await expect.poll(async () => (await read(fourth.page))?.rowIdentity).toEqual(recovered.rowIdentity)
  expect((await read(fourth.page))?.display).toEqual(recovered.display)
  expect((await read(fourth.page))?.coverage).toEqual(recovered.coverage)
})
