import type { Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { AssistantDeltaPayload, TurnEndPayload } from '../src/shared/wire/types'

const frame = (type: string, payload: unknown): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-10-08T12:00:00.000Z', payload })
const delta = (turn: string, seq: number, text: string): Uint8Array => frame('assistant_delta', {
  conversation_id: SEEDED_ROW.id, turn_id: turn, seq, text
} satisfies AssistantDeltaPayload)
const end = (turn: string): Uint8Array => frame('turn_end', {
  conversation_id: SEEDED_ROW.id, turn_id: turn, stop_reason: 'end_turn'
} satisfies TurnEndPayload)

// Installed at Welcome, before either conversation observer exists. Native methods are
// retained for the oracle. Stack attribution counts only this hook, excluding read observation.
async function instrument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const nativeRect = Element.prototype.getBoundingClientRect
    const children = Object.getOwnPropertyDescriptor(Element.prototype, 'children')!
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    const counts = { geometry: 0, enumerations: 0, observe: 0, unobserve: 0, disconnect: 0 }
    const hook = () => /rememberTop|syncRows|refreshRow/.test(new Error().stack ?? '')
    const row = (el: Element) => el.parentElement?.classList.contains('conversation__thread')
    Element.prototype.getBoundingClientRect = function () {
      if (window.scrollWork?.enabled && row(this) && hook()) {
        counts.geometry++
        if (/rememberTop/.test(new Error().stack ?? '')) window.scrollWork.lastRow = this
      }
      return nativeRect.call(this)
    }
    Object.defineProperty(Element.prototype, 'children', { ...children, get() {
      if (window.scrollWork?.enabled && this.classList.contains('conversation__thread') && hook()) counts.enumerations++
      return children.get!.call(this)
    } })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { ...height, get() {
      if (window.scrollWork?.enabled && row(this) && hook()) counts.geometry++
      return height.get!.call(this)
    } })
    const observers: { pin: boolean; targets: Set<Element> }[] = []
    const NativeResize = ResizeObserver
    window.ResizeObserver = class extends NativeResize {
      record = { pin: false, targets: new Set<Element>() }
      constructor(callback: ResizeObserverCallback) { super(callback); observers.push(this.record) }
      observe(target: Element, options?: ResizeObserverOptions) {
        if (this.record.targets.size === 0) this.record.pin = target.classList.contains('conversation__covered')
        if (this.record.pin && row(target)) counts.observe++
        this.record.targets.add(target); super.observe(target, options)
      }
      unobserve(target: Element) {
        if (this.record.pin) counts.unobserve++
        this.record.targets.delete(target); super.unobserve(target)
      }
      disconnect() {
        if (this.record.pin) counts.disconnect++
        this.record.targets.clear(); super.disconnect()
      }
    }
    Object.assign(window, { scrollWork: {
      counts, observers, rect: (el: Element) => nativeRect.call(el),
      enabled: false,
      reset: () => { window.scrollWork.enabled = true; for (const key of Object.keys(counts)) counts[key as keyof typeof counts] = 0 }
    } })
  })
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame)
  })
}

// Test-only window surface, kept out of production and shared fixtures.
type Work = {
  counts: { geometry: number; enumerations: number; observe: number; unobserve: number; disconnect: number }
  observers: { pin: boolean; targets: Set<Element> }[]
  rect: (el: Element) => DOMRect
  reset: () => void
  lastRow?: Element
  enabled: boolean
}
declare global { interface Window { scrollWork: Work } }
const reset = (page: Page) => page.evaluate(() => window.scrollWork.reset())
const counts = (page: Page) => page.evaluate(() => ({ ...window.scrollWork.counts }))

test('scroll lookup and same-row growth stay bounded on short and long threads', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
  const samples: { size: number; scroll: number; growth: number }[] = []
  for (const size of [32, 400]) {
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: inbound => {
      const type = decodeEnvelope(inbound).type
      if (type === 'list_conversations') return [seedConversationsFrame()]
      if (type !== 'send_message') return []
      return Array.from({ length: size }, (_, i) => [delta(`row-${i}`, 0, `History row ${i}`), end(`row-${i}`)]).flat()
    } }, { onLaunched: async app => instrument(await app.firstWindow()) })
    await page.locator('.composer__input').fill('seed')
    await page.getByRole('button', { name: 'Send', exact: true }).click({ timeout: 60_000 })
    await expect(page.locator('.bubble[data-thread-role="assistant"]').last()).toContainText(`History row ${size - 1}`, { timeout: 15_000 })
    daemon.pushFrame(delta('growing', 0, 'Growing row\n'))
    await expect(page.locator('.bubble[data-thread-role="assistant"]').last()).toContainText('Growing row')
    await settle(page)
    await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = el.scrollHeight * 0.65 })
    await settle(page)
    const parked = await page.locator('.conversation__thread').evaluate(el => ({
      rows: el.children.length, top: el.scrollTop, distance: el.scrollHeight - el.clientHeight - el.scrollTop
    }))
    expect(parked.rows).toBeGreaterThanOrEqual(size)
    expect(parked.top).toBeGreaterThan(0)
    expect(parked.distance).toBeGreaterThan(4)
    await reset(page)
    await page.locator('.conversation__thread').evaluate(el => el.dispatchEvent(new Event('scroll')))
    const scroll = await counts(page)
    expect(scroll.geometry).toBeGreaterThan(0)
    expect.soft(scroll.geometry).toBeLessThanOrEqual(Math.ceil(Math.log2(size + 2)) + 2)
    expect.soft(scroll.enumerations).toBe(0)
    let growthReads = 0
    for (let seq = 1; seq <= 3; seq++) {
      const before = await page.locator('.conversation__thread > :last-child').evaluate(el => window.scrollWork.rect(el).height)
      const offset = await page.locator('.conversation__thread').evaluate(el => el.scrollTop)
      await reset(page)
      daemon.pushFrame(delta('growing', seq, '\nExtra visible line'.repeat(8)))
      await expect.poll(() => page.locator('.conversation__thread > :last-child').evaluate(el => window.scrollWork.rect(el).height)).toBeGreaterThan(before)
      await settle(page)
      const growth = await counts(page)
      expect.soft(growth.observe).toBe(0)
      expect.soft(growth.enumerations).toBe(0)
      expect.soft(growth.geometry).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(size + 2)) + 12)
      expect(await page.locator('.conversation__thread').evaluate(el => el.scrollTop)).toBeCloseTo(offset, 0)
      growthReads = Math.max(growthReads, growth.geometry)
    }
    await page.locator('.conversation__thread').evaluate(el => { el.scrollTop = el.scrollHeight })
    await settle(page)
    const beforeFollowing = await page.locator('.conversation__thread > :last-child').evaluate(el => window.scrollWork.rect(el).height)
    await reset(page)
    daemon.pushFrame(delta('growing', 4, '\nFollowing growth'.repeat(12)))
    await expect.poll(() => page.locator('.conversation__thread > :last-child').evaluate(el => window.scrollWork.rect(el).height)).toBeGreaterThan(beforeFollowing)
    await settle(page)
    const followed = await counts(page)
    expect.soft(followed.observe).toBe(0)
    expect.soft(followed.enumerations).toBe(0)
    expect.soft(followed.geometry).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(size + 2)) + 12)
    expect(await page.locator('.conversation__thread').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(4)
    samples.push({ size, scroll: scroll.geometry, growth: growthReads })
  }
  expect(samples[1].scroll - samples[0].scroll).toBeLessThanOrEqual(4)
  expect(samples[1].growth - samples[0].growth).toBeLessThanOrEqual(16)
  await test.info().attach('hook-work', { body: JSON.stringify(samples), contentType: 'application/json' })
})

test('gaps, long hidden runs and target changes preserve a valid anchor and clean observations', async ({ launchPairedApp }) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: inbound => {
    if (decodeEnvelope(inbound).type === 'list_conversations') return [seedConversationsFrame()]
    return []
  } }, { onLaunched: async app => instrument(await app.firstWindow()) })
  for (let i = 0; i < 100; i++) { daemon.pushFrame(delta(`row-${i}`, 0, `History row ${i}`)); daemon.pushFrame(end(`row-${i}`)) }
  await expect(page.locator('.bubble[data-thread-role="assistant"]').last()).toContainText('History row 99')
  await settle(page)
  // DOM-only adversarial geometry: flex gaps have positive height, hidden rectangles
  // reset to viewport zero. Neither may become the remembered row.
  await page.locator('.conversation__thread').evaluate(el => {
    const rows = Array.from(el.children)
    for (const row of rows.slice(25, 85)) (row as HTMLElement).hidden = true
    const gap = document.createElement('div'); gap.dataset.historyGap = 'test-gap'; gap.style.height = '40px'
    rows[85].before(gap)
    el.scrollTop = 0
  })
  await settle(page)
  await page.locator('.conversation__thread').evaluate(el => {
    const row = el.children[86]
    el.scrollTop += window.scrollWork.rect(row).top - window.scrollWork.rect(el).top - 110
  })
  await settle(page)
  await reset(page)
  await page.locator('.conversation__thread').evaluate(el => el.dispatchEvent(new Event('scroll')))
  expect.soft((await counts(page)).geometry).toBeLessThanOrEqual(9)
  const retained = await page.locator('.conversation__thread').evaluate(el => {
    const edge = Math.max(window.scrollWork.rect(el).top, window.scrollWork.rect(document.querySelector('.conversation__top-chrome')!).bottom)
    const row = Array.from(el.children).find(row => !row.hasAttribute('data-history-gap') && window.scrollWork.rect(row).height > 0 && window.scrollWork.rect(row).bottom > edge)!
    row.setAttribute('data-test-anchor', 'true')
    return { text: row.textContent, top: window.scrollWork.rect(row).top }
  })
  expect(await page.evaluate(() => window.scrollWork.lastRow?.hasAttribute('data-test-anchor'))).toBe(true)
  // Force a hook render without changing membership; it must retain the valid row.
  daemon.pushFrame(delta('growth', 0, 'Growth after hidden rows'))
  await expect(page.locator('.bubble[data-thread-role="assistant"]').last()).toContainText('Growth after hidden rows')
  await settle(page)
  expect(await page.locator('[data-test-anchor]').evaluate(el => ({ text: el.textContent, top: window.scrollWork.rect(el).top }))).toEqual(retained)
  await page.locator('.conversation__thread').evaluate(el => {
    const rows = Array.from(el.children)
    for (const row of rows.slice(25, 85)) {
      const child = row as HTMLElement
      child.hidden = false
      child.style.cssText = 'height:0;min-height:0;padding:0;margin:0;border:0;overflow:hidden;flex:0 0 auto'
    }
    const edge = window.scrollWork.rect(document.querySelector('.conversation__top-chrome')!).bottom
    el.scrollTop += window.scrollWork.rect(rows[25]).top - edge - 1
    // Drain pending visibility mutations during lookup, before ResizeObserver delivery.
    el.dispatchEvent(new Event('scroll'))
  })
  const correctAnchor = () => page.locator('.conversation__thread').evaluate(el => {
    const edge = Math.max(window.scrollWork.rect(el).top, window.scrollWork.rect(document.querySelector('.conversation__top-chrome')!).bottom)
    const expected = Array.from(el.children).find(row => !row.hasAttribute('data-history-gap') && window.scrollWork.rect(row).height > 0 && window.scrollWork.rect(row).bottom > edge)
    return expected !== undefined && window.scrollWork.lastRow === expected
  })
  expect(await correctAnchor()).toBe(true)
  await settle(page)
  await reset(page)
  await page.locator('.conversation__thread').evaluate(el => el.dispatchEvent(new Event('scroll')))
  expect((await counts(page)).geometry).toBeLessThanOrEqual(9)
  expect(await correctAnchor()).toBe(true)
  await page.locator('.conversation__thread').evaluate(el => {
    for (const row of Array.from(el.children).slice(25, 85)) (row as HTMLElement).style.removeProperty('height')
    el.dispatchEvent(new Event('scroll'))
  })
  expect(await correctAnchor()).toBe(true)
  await page.locator('.conversation__thread').evaluate(el => {
    const added = document.createElement('div'); added.textContent = 'Transient row'; added.style.height = '70px'; el.append(added)
  })
  await settle(page)
  expect(await page.evaluate(() => window.scrollWork.observers.filter(o => o.pin).some(o => [...o.targets].some(el => el.textContent === 'Transient row')))).toBe(true)
  await page.locator('.conversation__thread').evaluate(el => {
    const old = el.lastElementChild!
    const replacement = document.createElement('div'); replacement.textContent = 'Replacement row'; replacement.style.height = '80px'
    old.replaceWith(replacement)
  })
  await settle(page)
  expect(await page.evaluate(() => window.scrollWork.observers.filter(o => o.pin).flatMap(o => [...o.targets]).every(el => el.isConnected))).toBe(true)
  expect(await page.evaluate(() => window.scrollWork.observers.filter(o => o.pin).some(o => [...o.targets].some(el => el.textContent === 'Replacement row')))).toBe(true)
  await page.locator('.conversation__thread > :last-child').evaluate(el => el.remove())
  await settle(page)
  expect((await counts(page)).unobserve).toBeGreaterThanOrEqual(2)
  // Leaving the chat tears down the old hook, without depending on process shutdown.
  await page.getByRole('button', { name: 'Sidebar menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await settle(page)
  expect(await page.evaluate(() => window.scrollWork.observers.filter(o => o.pin).every(o => o.targets.size === 0))).toBe(true)
  expect((await counts(page)).disconnect).toBeGreaterThan(0)
  await page.locator('section[aria-label="Settings screen"]').getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Seeded discussion', exact: true }).click()
  await expect(page.locator('.conversation__thread')).toBeVisible()
  await settle(page)
  expect(await page.evaluate(() => {
    const active = window.scrollWork.observers.filter(o => o.pin && o.targets.size > 0)
    return active.length === 1 && [...active[0].targets].every(el => el.isConnected)
  })).toBe(true)
})
