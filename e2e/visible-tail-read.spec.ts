import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Envelope } from '../src/shared/wire/types'

const ts = '2026-10-08T00:00:00Z'
const row = { ...SEEDED_ROW, read_up_to: 0, latest_entry_id: 30 }
const frame = (type: string, payload: unknown, history_entry_id?: number, in_reply_to?: number) =>
  encodeEnvelope({ id: 900, event_id: 700, type, ts, history_entry_id, in_reply_to, payload })
const list = () => frame('conversations', { conversations: [row] })
const delta = (id: number | undefined, seq: number, text: string) => frame('assistant_delta', {
  conversation_id: row.id, turn_id: 't', seq, text
}, id)
const end = (id: number) => frame('turn_end', { conversation_id: row.id, turn_id: 't', stop_reason: 'end_turn' }, id)
const markReply = (up_to: number, reply?: number) => frame('conversation_updated', {
  id: row.id, name: row.name, cwd: row.cwd, is_promoted: row.is_promoted,
  last_used_at: row.last_used_at, workspace_label: null, read_up_to: up_to
}, undefined, reply)
const pageReply = (request: number, entries: unknown[]) => frame('history_page', {
  entries, cursor: 'older', at_start: true
}, undefined, request)
const targets = (commands: Envelope[]) => commands.filter(c => c.type === 'mark_conversation_read').map(c => (c.payload as any).up_to)
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function focus(app: ElectronApplication, page: Page) {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await page.evaluate(() => {
    delete (document as any).hasFocus
    window.dispatchEvent(new Event('focus'))
  })
}

test('committed folded tails require focus, uncovered viewport and a closed reader', async ({ launchPairedApp }) => {
  const commands: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const e = decodeEnvelope(bytes); commands.push(e)
    if (e.type === 'list_conversations') return [list()]
    if (e.type === 'request_history') return [pageReply(e.id, Array.from({ length: 30 }, (_, i) => ({
      id: i + 1, type: 'message', ts, payload: { conversation_id: row.id, message_id: `m${i}`,
        role: 'user', text: `Synthetic saved message ${i}\n\nEnough content to hold a reader above the tail.` }
    })))]
    return []
  } })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  await expect(page.locator('.bubble')).toHaveCount(30)
  await focus(app, page)
  await expect.poll(() => targets(commands).at(-1)).toBe(30)
  const dot = page.locator('.conversation-status-dot')
  await expect(dot).toHaveClass(/--new-messages/)
  daemon.pushFrame(markReply(30, commands.filter(c => c.type === 'mark_conversation_read').at(-1)!.id))
  await expect(dot).toHaveClass(/--idle/)
  daemon.pushFrame(delta(31, 0, 'Read [the note](notes/Plan.md).'))
  daemon.pushFrame(delta(32, 1, '\n\nFolded text.'))
  await expect.poll(() => targets(commands).at(-1)).toBe(32)
  const before = targets(commands).length
  daemon.pushFrame(delta(32, 1, '\n\nFolded text.'))
  await settle(page)
  expect(targets(commands)).toHaveLength(before)
  await expect(dot).toHaveClass(/--new-messages/)
  daemon.pushFrame(frame('tool_use', { conversation_id: row.id, turn_id: 't', tool_use_id: 'tool',
    name: 'Read', input_summary: 'Synthetic tool', input_detail: 'Synthetic input' }, 33))
  await expect.poll(() => targets(commands).at(-1)).toBe(33)
  daemon.pushFrame(frame('tool_result', { conversation_id: row.id, turn_id: 't', tool_use_id: 'tool',
    is_error: false, result_summary: 'Synthetic result', result_detail: 'Synthetic detail' }, 34))
  await expect.poll(() => targets(commands).at(-1)).toBe(34)
  // Playwright's original CDP session forces focus; inject only the focus oracle, not geometry.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
    window.dispatchEvent(new Event('blur'))
  })
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
  daemon.pushFrame(delta(35, 2, '\n\nWhile blurred.'))
  await expect(page.locator('.bubble').last()).toContainText('While blurred.')
  await settle(page); expect(targets(commands).at(-1)).toBe(34)
  await focus(app, page)
  await expect.poll(() => targets(commands).at(-1)).toBe(35)
  const thread = page.locator('.conversation__thread')
  await thread.evaluate(el => { el.scrollTop = 0 })
  await settle(page)
  daemon.pushFrame(delta(36, 3, '\n\nWhile above the tail.'))
  await expect(page.locator('.bubble').last()).toContainText('While above the tail.')
  await settle(page); expect(targets(commands).at(-1)).toBe(35)
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(() => targets(commands).at(-1)).toBe(36)
  daemon.pushFrame(end(37))
  await expect.poll(() => targets(commands).at(-1)).toBe(37)
  await page.getByRole('button', { name: 'the note', exact: true }).click()
  await expect(page.locator('.markdown-reader')).toBeVisible()
  daemon.pushFrame(delta(38, 4, '\n\nReader-covered addition.'))
  await settle(page); expect(targets(commands).at(-1)).toBe(37)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect.poll(() => targets(commands).at(-1)).toBe(38)
  daemon.pushFrame(markReply(38))
  await expect(dot).toHaveClass(/--idle/)
  await page.screenshot({ path: '/tmp/builder-1826/read-tail-1280.png' })
})

test('ID-less replay stays unknown until independently admitted history, and unseen live content restores attention', async ({ launchPairedApp }) => {
  const commands: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const e = decodeEnvelope(bytes); commands.push(e)
    return e.type === 'list_conversations' ? [list()] : []
  } })
  await focus(app, page)
  daemon.pushFrame(delta(undefined, 0, 'ID-less replay'))
  await expect(page.locator('.bubble')).toHaveCount(1)
  await settle(page)
  expect(targets(commands)).toEqual([])
  expect(commands.filter(c => c.type === 'request_history')).toHaveLength(1)
  const ask = commands.find(c => c.type === 'request_history')!
  daemon.pushFrame(pageReply(ask.id, [{ id: 30, type: 'assistant_delta', ts,
    payload: { conversation_id: row.id, turn_id: 't', seq: 0, text: 'ID-less replay' } }]))
  await expect.poll(() => targets(commands)).toEqual([30])
  await expect(page.locator('.bubble')).toHaveCount(1)
  daemon.pushFrame(markReply(30))
  const dot = page.locator('.conversation-status-dot')
  await expect(dot).toHaveClass(/--idle/)
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
  daemon.pushFrame(delta(31, 1, '\nUnseen while closed'))
  await page.locator('.archive__back').click()
  await expect(dot).toHaveClass(/--new-messages/)
  daemon.pushFrame(markReply(30))
  await expect(dot).toHaveClass(/--new-messages/)
  expect(targets(commands)).toEqual([30])
  expect(commands.filter(c => c.type === 'request_history')).toHaveLength(1)
})

for (const gate of ['visible', 'blurred', 'reader-covered', 'above-tail'] as const) {
  test(`late read contract rechecks the committed tail while ${gate}`, async ({ launchPairedApp }) => {
    const commands: Envelope[] = []
    const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes); commands.push(e)
      if (e.type === 'list_conversations') return [frame('conversations', { conversations: [SEEDED_ROW] })]
      if (e.type === 'request_history') return [pageReply(e.id, Array.from({ length: 30 }, (_, i) => ({
        id: i + 1, type: 'message', ts, payload: { conversation_id: row.id, message_id: `m${i}`,
          role: 'user', text: `Synthetic saved message ${i}\n\nEnough content to hold a reader above the tail.` }
      })))]
      return []
    } })
    await focus(app, page)
    await expect(page.locator('.bubble')).toHaveCount(30)
    daemon.pushFrame(delta(31, 0, 'Read [the note](notes/Plan.md).'))
    await expect(page.locator('.bubble').last()).toContainText('Read the note.')
    await settle(page)
    expect(targets(commands)).toEqual([])
    const thread = page.locator('.conversation__thread')
    if (gate === 'blurred') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
        window.dispatchEvent(new Event('blur'))
      })
    } else if (gate === 'reader-covered') {
      await page.getByRole('button', { name: 'the note', exact: true }).click()
      await expect(page.locator('.markdown-reader')).toBeVisible()
    } else if (gate === 'above-tail') {
      await thread.evaluate(el => { el.scrollTop = 0 })
    }
    await settle(page)
    // Only the list changes: the durable tail was already committed before eligibility arrived.
    daemon.pushFrame(list())
    const dot = page.locator('.conversation-status-dot')
    await expect(dot).toHaveClass(/--new-messages/)
    await settle(page)
    if (gate !== 'visible') {
      expect(targets(commands)).toEqual([])
      if (gate === 'blurred') await focus(app, page)
      else if (gate === 'reader-covered') await page.getByRole('button', { name: 'Back', exact: true }).click()
      else await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
    }
    await expect.poll(() => targets(commands)).toEqual([31])
    daemon.pushFrame(list())
    await settle(page)
    expect(targets(commands)).toEqual([31])
    await expect(dot).toHaveClass(/--new-messages/)
    daemon.pushFrame(markReply(31))
    await expect(dot).toHaveClass(/--idle/)
  })
}
