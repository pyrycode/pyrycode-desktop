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

type ReadWork = {
  counts: { constructors: number; discovery: number; listeners: number; subscriptions: number }
  observers: { read: boolean; targets: Set<Element> }[]
  listeners: Map<EventListenerOrEventListenerObject, Set<EventTarget>>
  subscriptions: Set<unknown>
  reset: () => void
}
declare global { interface Window { readWork: ReadWork } }

// Installed before mounting. The read observer's first target is the thread;
// the pin observer starts with the pane. Callback identity attributes subscriptions
// and listeners without counting React, scroll-pin work or the test oracle.
async function instrumentReadWork(page: Page) {
  await page.evaluate(() => {
    const counts = { constructors: 0, discovery: 0, listeners: 0, subscriptions: 0 }
    const observers: ReadWork['observers'] = []
    const callbacks = new Map<unknown, { read: boolean }>()
    const listeners: ReadWork['listeners'] = new Map()
    const subscriptions = new Set<unknown>()
    const NativeResize = ResizeObserver
    window.ResizeObserver = class extends NativeResize {
      record = { read: false, targets: new Set<Element>() }
      constructor(callback: ResizeObserverCallback) {
        super(callback); callbacks.set(callback, this.record); observers.push(this.record)
      }
      observe(target: Element, options?: ResizeObserverOptions) {
        if (this.record.targets.size === 0 && target.classList.contains('conversation__thread')) {
          this.record.read = true; counts.constructors++
        }
        this.record.targets.add(target); super.observe(target, options)
      }
      disconnect() { this.record.targets.clear(); super.disconnect() }
    }
    const query = Element.prototype.querySelector
    const queryAll = Element.prototype.querySelectorAll
    Element.prototype.querySelector = function (selector: string) {
      if (selector.includes('[data-read-row')) counts.discovery++
      return query.call(this, selector)
    }
    Element.prototype.querySelectorAll = function (selector: string) {
      if (selector.includes('[data-read-row')) counts.discovery++
      return queryAll.call(this, selector)
    }
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (callback !== null && callbacks.get(callback)?.read) {
        counts.listeners++
        const targets = listeners.get(callback) ?? new Set<EventTarget>()
        targets.add(this); listeners.set(callback, targets)
      }
      return add.call(this, type, callback, options)
    }
    EventTarget.prototype.removeEventListener = function (type, callback, options) {
      if (callback !== null && callbacks.get(callback)?.read) {
        const targets = listeners.get(callback)
        targets?.delete(this)
        if (targets?.size === 0) listeners.delete(callback)
      }
      return remove.call(this, type, callback, options)
    }
    const setAdd = Set.prototype.add
    const setDelete = Set.prototype.delete
    Set.prototype.add = function (value) {
      if (callbacks.get(value)?.read) { counts.subscriptions++; setAdd.call(subscriptions, value) }
      return setAdd.call(this, value)
    }
    Set.prototype.delete = function (value) {
      if (callbacks.get(value)?.read) setDelete.call(subscriptions, value)
      return setDelete.call(this, value)
    }
    window.readWork = { counts, observers, listeners, subscriptions,
      reset: () => { for (const key of Object.keys(counts)) counts[key as keyof typeof counts] = 0 } }
  })
}

test('read setup is reused across committed same-row deltas on short and long threads', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
  for (const size of [30, 400]) {
    const commands: Envelope[] = []
    const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes); commands.push(e)
      if (e.type === 'list_conversations') return [list()]
      if (e.type === 'request_history') return [pageReply(e.id, Array.from({ length: size }, (_, i) => ({
        id: i + 1, type: 'message', ts, payload: { conversation_id: row.id, message_id: `m${i}`,
          role: 'user', text: `Saved row ${i}` }
      })))]
      return []
    } }, { onLaunched: async app => instrumentReadWork(await app.firstWindow()) })
    await focus(app, page)
    await expect(page.locator('.bubble')).toHaveCount(size)
    daemon.pushFrame(delta(size + 1, 0, 'Read [the note](notes/Plan.md).'))
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 1)
    await settle(page)
    const active = () => page.evaluate(() => ({
      observers: window.readWork.observers.filter(o => o.read && o.targets.size > 0).length,
      connected: window.readWork.observers.filter(o => o.read).every(o => [...o.targets].every(el => el.isConnected)),
      listeners: [...window.readWork.listeners.values()].reduce((sum, targets) => sum + targets.size, 0),
      subscriptions: window.readWork.subscriptions.size
    }))
    expect(await active()).toEqual({ observers: 1, connected: true, listeners: 2, subscriptions: 1 })
    await page.evaluate(() => window.readWork.reset())
    const geometry = () => page.locator('.conversation__thread > :last-child').evaluate(el => {
      const r = el.getBoundingClientRect()
      return { key: el.getAttribute('data-read-row'), top: r.top, bottom: r.bottom, height: r.height }
    })
    const before = await geometry()
    // Spaces advance durable identity without changing the rendered Markdown geometry.
    for (let seq = 1; seq <= 3; seq++) {
      daemon.pushFrame(delta(size + 1 + seq, seq, ' '))
      await expect.poll(() => targets(commands).at(-1)).toBe(size + 1 + seq)
      await settle(page)
      expect(await geometry()).toEqual(before)
    }
    daemon.pushFrame(delta(size + 5, 4, '\n\nGrowing paragraph.\n\nAnother growing paragraph.'))
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 5)
    await settle(page)
    expect((await geometry()).height).toBeGreaterThan(before.height)
    const counts = await page.evaluate(() => ({ ...window.readWork.counts }))
    await test.info().attach(`read-work-${size}`, { body: JSON.stringify(counts), contentType: 'application/json' })
    expect.soft(counts).toEqual({ constructors: 0, discovery: 0, listeners: 0, subscriptions: 0 })
    daemon.pushFrame(end(size + 6))
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 6)
    daemon.pushFrame(frame('assistant_delta', { conversation_id: row.id, turn_id: 'next', seq: 0,
      text: 'New tail [the note](notes/Plan.md).' }, size + 7))
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 7)
    await settle(page)
    expect((await geometry()).key).not.toBe(before.key)
    expect(await active()).toEqual({ observers: 1, connected: true, listeners: 2, subscriptions: 1 })
    await page.getByRole('button', { name: 'the note', exact: true }).last().click()
    await expect(page.locator('.markdown-reader')).toBeVisible()
    await settle(page)
    expect(await active()).toEqual({ observers: 0, connected: true, listeners: 0, subscriptions: 0 })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await settle(page)
    expect(await active()).toEqual({ observers: 1, connected: true, listeners: 2, subscriptions: 1 })
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await settle(page)
    expect(await active()).toEqual({ observers: 0, connected: true, listeners: 0, subscriptions: 0 })
    await page.locator('.archive__back').click()
    await page.getByRole('button', { name: 'Seeded discussion', exact: true }).click()
    await settle(page)
    expect(await active()).toEqual({ observers: 1, connected: true, listeners: 2, subscriptions: 1 })
  }
})

test('stable callbacks exclude hidden, queued and received but uncommitted tails', async ({ launchPairedApp }) => {
  const commands: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const e = decodeEnvelope(bytes); commands.push(e)
    return e.type === 'list_conversations' ? [list()] : []
  } })
  await focus(app, page)
  daemon.pushFrame(delta(1, 0, 'Committed tail'))
  await expect.poll(() => targets(commands)).toEqual([1])
  for (const [index, gate] of ['hidden-document', 'hidden-row', 'queued'].entries()) {
    await page.locator('[data-read-row]').last().evaluate((el, gate) => {
      if (gate === 'hidden-document') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      else if (gate === 'hidden-row') (el as HTMLElement).hidden = true
      else el.classList.add('message-row--queued')
    }, gate)
    daemon.pushFrame(delta(index + 2, index + 1, ` Gate ${index}`))
    await expect(page.locator('.bubble').last()).toContainText(`Gate ${index}`)
    await settle(page)
    expect(targets(commands).at(-1)).toBe(index + 1)
    await page.locator('[data-read-row]').last().evaluate(el => {
      delete (document as any).visibilityState
      ;(el as HTMLElement).hidden = false
      el.classList.remove('message-row--queued')
      window.dispatchEvent(new Event('focus'))
    })
    await expect.poll(() => targets(commands).at(-1)).toBe(index + 2)
  }
  await settle(page)
  // Hold the bridge's frame, with a receipt barrier from the real preload event.
  // Focus/scroll callbacks still run, and must use the displayed target rather than receipt.
  await page.evaluate(() => {
    const request = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const pending = new Map<number, FrameRequestCallback>()
    let handle = -1
    let delivered = 0
    const off = window.pyry.onDaemonEvent(event => { if (event.type === 'assistantDelta') delivered++ })
    window.requestAnimationFrame = callback => { pending.set(handle, callback); return handle-- }
    window.cancelAnimationFrame = handle => { if (!pending.delete(handle)) cancel(handle) }
    window.pendingReadFrame = { received: () => delivered, release: () => {
      window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel; off()
      const callbacks = [...pending.values()]; pending.clear()
      callbacks.forEach(callback => callback(performance.now()))
    } }
  })
  try {
    daemon.pushFrame(delta(5, 4, ' Awaiting commit'))
    await expect.poll(() => page.evaluate(() => window.pendingReadFrame.received())).toBe(1)
    await expect(page.locator('.bubble').last()).not.toContainText('Awaiting commit')
    const prior = targets(commands)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      document.querySelector('.conversation__thread')!.dispatchEvent(new Event('scroll'))
    })
    await expect(page.locator('.bubble').last()).not.toContainText('Awaiting commit')
    expect(targets(commands)).toEqual(prior)
  } finally {
    await page.evaluate(() => window.pendingReadFrame.release())
  }
  await expect(page.locator('.bubble').last()).toContainText('Awaiting commit')
  await expect.poll(() => targets(commands).at(-1)).toBe(5)
})

declare global { interface Window { pendingReadFrame: { received: () => number; release: () => void } } }

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
  } }, { onLaunched: async app => instrumentReadWork(await app.firstWindow()) })
  await focus(app, page)
  daemon.pushFrame(delta(undefined, 0, 'ID-less replay'))
  await expect(page.locator('.bubble')).toHaveCount(1)
  await settle(page)
  expect(targets(commands)).toEqual([])
  expect(await page.evaluate(() => window.readWork.observers.filter(o => o.read && o.targets.size > 0).length)).toBe(1)
  await page.evaluate(() => window.readWork.reset())
  expect(commands.filter(c => c.type === 'request_history')).toHaveLength(1)
  const ask = commands.find(c => c.type === 'request_history')!
  daemon.pushFrame(pageReply(ask.id, [{ id: 30, type: 'assistant_delta', ts,
    payload: { conversation_id: row.id, turn_id: 't', seq: 0, text: 'ID-less replay' } }]))
  await expect.poll(() => targets(commands)).toEqual([30])
  await expect(page.locator('.bubble')).toHaveCount(1)
  expect(await page.evaluate(() => ({ ...window.readWork.counts }))).toEqual({ constructors: 0, discovery: 0, listeners: 0, subscriptions: 0 })
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
