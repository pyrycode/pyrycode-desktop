import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Envelope } from '../src/shared/wire/types'
import { focusVisibleTailWindow } from './fixtures/visibleTailFocus'

// Scripted history is published as thread catch-up/pages by the shared fake daemon.
test.use({ scriptedHistory: true })

const ts = '2026-10-08T00:00:00Z'
const row = { ...SEEDED_ROW, read_up_to: 0, last_shown_version: 30 }
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
  await focusVisibleTailWindow(app)
  await page.evaluate(() => {
    delete (document as any).hasFocus
  })
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

async function readState(page: Page, commands: Envelope[]) {
  const state = await page.evaluate(() => {
    const region = document.querySelector('.conversation__thread')
    const tail = region?.querySelector('[data-read-row]:last-child') ??
      [...(region?.querySelectorAll('[data-read-row]') ?? [])].at(-1)
    const rect = tail?.getBoundingClientRect()
    const viewport = region?.getBoundingClientRect()
    const top = Math.max(viewport?.top ?? 0,
      document.querySelector('.conversation__top-chrome')?.getBoundingClientRect().bottom ?? 0)
    const bottom = Math.min(viewport?.bottom ?? 0,
      document.querySelector('.conversation__input-chrome')?.getBoundingClientRect().top ?? Infinity)
    return { url: location.href, ready: document.readyState, focused: document.hasFocus(),
      visible: document.visibilityState, reader: document.querySelector('.markdown-reader') !== null,
      key: tail?.getAttribute('data-read-row'), top, bottom, viewportBottom: viewport?.bottom,
      tailTop: rect?.top, tailBottom: rect?.bottom, height: rect?.height,
      eligible: rect !== undefined && rect.height > 0 && rect.bottom > top && rect.bottom <= bottom,
      committed: tail?.textContent?.includes('Reader-covered addition.') ?? false }
  })
  return { ...state, targets: targets(commands) }
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
  const before = page.url()
  // The fixture hands this hook a loaded app document (appWindow). Waiting for the
  // mounted Welcome screen keeps the instrumentation after the first commit.
  await expect(page.locator('.welcome__pair')).toBeVisible()
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
  await test.info().attach('read-work-document', { body: JSON.stringify({ before,
    installed: await page.evaluate(() => ({ url: location.href, ready: document.readyState,
      timeOrigin: performance.timeOrigin, instrumented: window.readWork !== undefined })) }), contentType: 'application/json' })
}

test('read setup is reused across committed same-row deltas on short and long threads', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
  for (const size of [30, 400]) {
    const commands: Envelope[] = []
    const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes); commands.push(e)
      if (e.type === 'list_conversations') return [frame('conversations', { conversations: [{ ...row, last_shown_version: size }] })]
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
    await expect.poll(active).toEqual({ observers: 1, connected: true, listeners: 3, subscriptions: 1 })
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
    // The assistant's completion changes its visible status at this version.
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 6)
    daemon.pushFrame(frame('assistant_delta', { conversation_id: row.id, turn_id: 'next', seq: 0,
      text: 'New tail [the note](notes/Plan.md).' }, size + 7))
    await expect.poll(() => targets(commands).at(-1)).toBe(size + 7)
    await settle(page)
    expect((await geometry()).key).not.toBe(before.key)
    await expect.poll(active).toEqual({ observers: 1, connected: true, listeners: 3, subscriptions: 1 })
    await page.getByRole('button', { name: 'the note', exact: true }).last().click()
    await expect(page.locator('.markdown-reader')).toBeVisible()
    await settle(page)
    await expect.poll(active).toEqual({ observers: 0, connected: true, listeners: 0, subscriptions: 0 })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await settle(page)
    await expect.poll(active).toEqual({ observers: 1, connected: true, listeners: 3, subscriptions: 1 })
    await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await settle(page)
    await expect.poll(active).toEqual({ observers: 0, connected: true, listeners: 0, subscriptions: 0 })
    await page.locator('.archive__back').click()
    await page.getByRole('button', { name: 'Seeded discussion', exact: true }).click()
    await settle(page)
    await expect.poll(active).toEqual({ observers: 1, connected: true, listeners: 3, subscriptions: 1 })
  }
})

test('stable callbacks exclude hidden, queued and received but uncommitted tails', async ({ launchPairedApp }) => {
  const commands: Envelope[] = []
  const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    const e = decodeEnvelope(bytes); commands.push(e)
    if (e.type === 'request_history') return [pageReply(e.id, [])]
    return e.type === 'list_conversations' ? [frame('conversations', { conversations: [{ ...row, last_shown_version: 0 }] })] : []
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
  // Publish the authoritative next watermark before holding the canonical append's frame.
  daemon.pushFrame(frame('conversations', { conversations: [{ ...row, last_shown_version: 5 }] }))
  const pendingItem = Number(await page.locator('[data-read-row]').last().getAttribute('data-read-row'))
  // #2186: hold the bridge's frame and paired timer, with real preload receipt.
  // Focus/scroll callbacks still run, and must use the displayed target rather than receipt.
  await page.evaluate(() => {
    const browser: Window = window
    const request = browser.requestAnimationFrame
    const cancel = browser.cancelAnimationFrame
    const timeout = browser.setTimeout
    const clear = browser.clearTimeout
    const pending = new Map<number, FrameRequestCallback>()
    const timers = new Map<number, () => void>()
    let frames = 0, timerOpportunities = 0
    let delivered = 0
    const off = window.pyry.onDaemonEvent(event => { if (event.type === 'threadUpdate' && event.update.type === 'thread_text_append') delivered++ }, true)
    browser.requestAnimationFrame = callback => {
      const handle = request.call(window, () => { frames++ })
      pending.set(handle, callback); return handle
    }
    browser.cancelAnimationFrame = handle => { pending.delete(handle); cancel.call(window, handle) }
    browser.setTimeout = (callback, delay, ...args) => {
      // The runtime races the identical drain function through both APIs.
      // Leave unrelated timers live, including focus work and test polling.
      if (typeof callback !== 'function' || ![...pending.values()].some(frame => frame === callback)) {
        return timeout.call(window, callback, delay, ...args)
      }
      const handle = timeout.call(window, () => { timerOpportunities++ }, delay)
      timers.set(handle, () => callback(...args)); return handle
    }
    browser.clearTimeout = handle => { if (handle !== undefined) timers.delete(handle); clear.call(window, handle) }
    window.pendingReadFrame = { received: () => delivered,
      opportunities: () => ({ frames, timers: timerOpportunities }), release: () => {
      browser.requestAnimationFrame = request; browser.cancelAnimationFrame = cancel
      browser.setTimeout = timeout; browser.clearTimeout = clear; off()
      const callbacks = [...pending.values()], drains = [...timers.values()]
      for (const handle of pending.keys()) cancel.call(window, handle)
      for (const handle of timers.keys()) clear.call(window, handle)
      pending.clear(); timers.clear()
      callbacks.forEach(callback => callback(performance.now())); drains.forEach(drain => drain())
      return browser.requestAnimationFrame === request && browser.cancelAnimationFrame === cancel &&
        browser.setTimeout === timeout && browser.clearTimeout === clear
    } }
  })
  try {
    daemon.pushFrame(frame('thread_text_append', { conversation_id: row.id, epoch: `scripted-thread:${row.id}`,
      version: 5, item_id: pendingItem, base_rev: 4, rev: 5, text: ' Awaiting commit' }))
    await expect.poll(() => page.evaluate(() => window.pendingReadFrame.received())).toBe(1)
    await expect.poll(() => page.evaluate(() => window.pendingReadFrame.opportunities().frames)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(() => window.pendingReadFrame.opportunities().timers)).toBeGreaterThan(0)
    await page.waitForTimeout(100) // Challenge the runtime's 50 ms fallback while frames are held.
    await expect(page.locator('.bubble').last()).not.toContainText('Awaiting commit')
    const prior = targets(commands)
    expect(prior).toEqual([1, 2, 3, 4])
    const contextAsks = commands.filter(c => c.type === 'request_context_usage').length
    await page.evaluate(conversationId => {
      window.dispatchEvent(new Event('focus'))
      document.querySelector('.conversation__thread')!.dispatchEvent(new Event('scroll'))
      window.pyry.sendCommand({ type: 'requestContextUsage', payload: { conversation_id: conversationId } })
    }, row.id)
    await expect.poll(() => commands.filter(c => c.type === 'request_context_usage').length).toBe(contextAsks + 1)
    await expect(page.locator('.bubble').last()).not.toContainText('Awaiting commit')
    expect(targets(commands)).toEqual(prior)
    await test.info().attach('pending-read-barrier', { body: JSON.stringify({
      received: await page.evaluate(() => window.pendingReadFrame.received()),
      opportunities: await page.evaluate(() => window.pendingReadFrame.opportunities()), targets: prior,
      sentinel: commands.at(-1)?.type
    }), contentType: 'application/json' })
  } finally {
    expect(await page.evaluate(() => window.pendingReadFrame.release())).toBe(true)
  }
  await expect(page.locator('.bubble').last()).toContainText('Awaiting commit')
  await expect.poll(() => targets(commands)).toEqual([1, 2, 3, 4, 5])
})

declare global { interface Window { pendingReadFrame: {
  received: () => number; opportunities: () => { frames: number; timers: number }; release: () => boolean
} } }

test('committed folded tails require focus, uncovered viewport and a closed reader', async ({ launchPairedApp }) => {
  const commands: Envelope[] = []
  const { app, page, daemon, servers } = await launchPairedApp({ buildReplyFrames: bytes => {
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
  // A tail within the thread can still be covered by the measured input chrome.
  const input = page.locator('.conversation__input-chrome')
  await input.evaluate(el => { (el as HTMLElement).style.transform = 'translateY(-80px)' })
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(async () => {
    const s = await readState(page, commands)
    return s.tailBottom !== undefined && s.viewportBottom !== undefined &&
      s.tailBottom <= s.viewportBottom && s.tailBottom > s.bottom
  }).toBe(true)
  const contextAsks = commands.filter(c => c.type === 'request_context_usage').length
  await page.evaluate(conversationId => {
    window.dispatchEvent(new Event('focus'))
    // The focus observer publishes synchronously. This later command crosses
    // the same ordered IPC/transport path, so its daemon receipt drains any mark.
    window.pyry.sendCommand({ type: 'requestContextUsage', payload: { conversation_id: conversationId } })
  }, row.id)
  await expect.poll(() => commands.filter(c => c.type === 'request_context_usage').length).toBe(contextAsks + 1)
  expect(targets(commands).at(-1)).toBe(35)
  await test.info().attach('chrome-excluded-after-drain', { body: JSON.stringify({
    ...await readState(page, commands), barrier: commands.at(-1)
  }), contentType: 'application/json' })
  await input.evaluate(el => { (el as HTMLElement).style.removeProperty('transform') })
  // A CSS transform does not resize the observed chrome: drive the callback
  // explicitly after restoring it, just as in the covered measurement above.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => targets(commands).at(-1)).toBe(36)
  // The synchronous focus observation can publish before the previously queued
  // scroll event rearms bottom following. Drain that input before the next push.
  await settle(page)
  daemon.pushFrame(end(37))
  try {
    await expect.poll(() => targets(commands).at(-1)).toBe(37)
  } catch (error) {
    const saved = await page.evaluate(async coordinates => {
      const result = await window.pyry.chatHistory({ operation: 'readThread', ...coordinates })
      if (result.status !== 'stored' || result.snapshot.kind !== 'daemon-items') return { status: result.status }
      const { items, ...metadata } = result.snapshot.thread
      return { metadata, tailItems: items.slice(-5).map(({ content: _content, summary: _summary, ...item }) => item) }
    }, { serverId: servers[0].serverId, conversationId: row.id })
    await test.info().attach('end-tail-state', { contentType: 'application/json', body: JSON.stringify({
      ...await readState(page, commands), saved,
      requests: commands.map(e => ({ type: e.type, version: (e.payload as any).version }))
    }) })
    throw error
  }
  await page.getByRole('button', { name: 'the note', exact: true }).click()
  await expect(page.locator('.markdown-reader')).toBeVisible()
  await test.info().attach('reader-open', { body: JSON.stringify(await readState(page, commands)), contentType: 'application/json' })
  daemon.pushFrame(delta(38, 4, '\n\nReader-covered addition.'))
  // Receipt/commit, focus and geometry are independent of reader dismissal.
  await expect(page.locator('.bubble').last()).toContainText('Reader-covered addition.')
  await test.info().attach('reader-committed', { body: JSON.stringify(await readState(page, commands)), contentType: 'application/json' })
  // Clicking the older link can scroll away from the trailing edge. Establish
  // eligible geometry while the reader still excludes publication.
  await thread.evaluate(el => { el.scrollTop = el.scrollHeight })
  await focus(app, page)
  await expect.poll(async () => {
    const s = await readState(page, commands)
    return { focused: s.focused, visible: s.visible, reader: s.reader, committed: s.committed, eligible: s.eligible }
  }).toEqual({ focused: true, visible: 'visible', reader: true, committed: true, eligible: true })
  expect(targets(commands).at(-1)).toBe(37)
  await test.info().attach('reader-eligible', { body: JSON.stringify(await readState(page, commands)), contentType: 'application/json' })
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('.markdown-reader')).toHaveCount(0)
  await expect.poll(() => targets(commands).at(-1)).toBe(38)
  await test.info().attach('reader-dismissed', { body: JSON.stringify(await readState(page, commands)), contentType: 'application/json' })
  daemon.pushFrame(markReply(38))
  await expect(dot).toHaveClass(/--idle/)
  await page.screenshot({ path: test.info().outputPath('read-tail-1280.png') })
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
    daemon.pushFrame(frame('conversations', { conversations: [{ ...row, last_shown_version: 31 }] }))
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
    daemon.pushFrame(frame('conversations', { conversations: [{ ...row, last_shown_version: 31 }] }))
    await settle(page)
    expect(targets(commands)).toEqual([31])
    await expect(dot).toHaveClass(/--new-messages/)
    daemon.pushFrame(markReply(31))
    await expect(dot).toHaveClass(/--idle/)
  })
}
