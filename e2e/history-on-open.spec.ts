import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'

const ts = '2026-07-07T12:00:00.000Z'
const history = (id: number, count: number, cursor = 'older') => encodeEnvelope({
  id: 90, type: 'history_page', ts, in_reply_to: id,
  payload: { entries: Array.from({ length: count }, (_, i) => ({ id: i, type: 'message', ts,
    payload: { conversation_id: SEEDED_ROW.id, message_id: `${id}-${i}`, role: 'user', text: `History row ${id}-${i}` }
  })), cursor, at_start: false }
})
async function observe(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const commands: string[] = []
    ;(globalThis as any).__historyCommands = commands
    ipcMain.on('pyry:command', (_event, command) => commands.push(command.type))
  })
}
const count = (app: ElectronApplication): Promise<number> => app.evaluate(() =>
  (globalThis as any).__historyCommands.filter((type: string) => type === 'requestHistory').length)
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test('opening asks once and only trusted upward input asks for subsequent pages', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') asks.push(env)
    return []
  } }, { onLaunched: observe })
  const thread = page.locator('.conversation__thread')
  await expect.poll(() => asks.length).toBe(1)
  await settle(page)
  expect(await count(app)).toBe(1)
  await page.getByPlaceholder('Message…').fill('local draft')
  for (const key of ['ArrowUp', 'PageUp', 'Home']) await page.keyboard.press(key)
  await thread.evaluate(el => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
  })
  await page.setViewportSize({ width: 1280, height: 800 })
  await settle(page)
  expect(await count(app)).toBe(1)
  await thread.hover()
  await page.mouse.wheel(0, 100)
  await settle(page)
  expect(await count(app)).toBe(1)
  await page.mouse.wheel(0, -100)
  await expect.poll(() => asks.length).toBe(1)
  expect(asks[0].payload.cursor).toBe('')
  await thread.focus()
  for (const key of ['ArrowUp', 'PageUp', 'Home']) await page.keyboard.press(key)
  await settle(page)
  expect(await count(app)).toBe(1)
  daemon.pushFrame(history(asks[0].id, 0))
  // A later live frame is the renderer receipt barrier for the empty history reply.
  daemon.pushFrame(encodeEnvelope({ id: 91, type: 'assistant_delta', ts,
    payload: { conversation_id: SEEDED_ROW.id, turn_id: 'receipt-barrier', seq: 0, text: 'Live receipt barrier' } }))
  await expect(thread.locator('.bubble')).toHaveCount(1)
  await settle(page)
  expect(await count(app)).toBe(1)
  await page.keyboard.press('PageUp')
  await expect.poll(() => asks.length).toBe(2)
  expect(asks[1].payload.cursor).toBe('older')
  daemon.pushFrame(history(asks[1].id, 18, 'oldest'))
  await expect(thread.locator('.bubble')).toHaveCount(19)
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await settle(page)
  expect(await count(app)).toBe(2)
  await page.keyboard.press('Home')
  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBe(0)
  expect(await count(app)).toBe(2)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => asks.length).toBe(3)
  expect(asks[2].payload.cursor).toBe('oldest')
  await page.screenshot({ path: '/tmp/builder-1394-thread-1280.png', animations: 'disabled' })
})

test('reconnect settles the interrupted page and asks newest while preserving backwards cursor', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const { app, page, daemon, forwarder } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') asks.push(env)
    return []
  } }, { onLaunched: observe })
  const thread = page.locator('.conversation__thread')
  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(1)
  daemon.pushFrame(history(asks[0].id, 1, 'retained'))
  await expect(thread.locator('.bubble')).toHaveCount(1)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => asks.length).toBe(2)
  forwarder.dropClientLeg()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await page.keyboard.press('Home')
  await settle(page)
  expect(await count(app)).toBe(2)
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect.poll(() => asks.length).toBe(3)
  expect(asks[2].payload.cursor).toBe('')
  daemon.pushFrame(history(asks[2].id, 0, 'newest'))
  daemon.pushFrame(encodeEnvelope({ id: 92, type: 'assistant_delta', ts, payload: {
    conversation_id: SEEDED_ROW.id, turn_id: 'reconnect-barrier', seq: 0, text: 'Reconnect receipt' } }))
  await expect(thread.locator('.bubble')).toHaveCount(2)
  await thread.focus()
  await page.keyboard.press('Home')
  await expect.poll(() => asks.length).toBe(4)
  expect(asks.map(e => e.payload.cursor)).toEqual(['', 'retained', '', 'retained'])
  await expect(thread.locator('.bubble')).toHaveCount(2)
})

test('mounted newest content appears without upward input and page arrival creates no cascade', async ({ launchPairedApp }) => {
  const asks: Envelope[] = []
  const { app, page } = await launchPairedApp({ buildReplyFrames: bytes => {
    const env = decodeEnvelope(bytes)
    if (env.type === 'list_conversations') return [seedConversationsFrame()]
    if (env.type === 'request_history') { asks.push(env); return [history(env.id, 18)] }
    return []
  } }, { onLaunched: observe })
  await expect(page.locator('.conversation__thread .bubble')).toHaveCount(18)
  await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = 0 })
  await page.setViewportSize({ width: 800, height: 600 })
  await settle(page)
  expect(await count(app)).toBe(1)
  expect(asks[0].payload).toEqual({ conversation_id: SEEDED_ROW.id, cursor: '', limit: 200 })
  await page.screenshot({ path: '/tmp/builder-1815/newest-800.png', animations: 'disabled' })
})
