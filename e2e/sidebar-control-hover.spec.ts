import { mkdir } from 'node:fs/promises'
import type { Locator } from '@playwright/test'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'

const cases = [
  ['host-edit', 'host-edit'],
  ['section-create', 'section-create'],
  ['rename', 'rename'],
  ['chat-edit', 'chat-edit'],
  ['save', 'save'],
  // These CSS surfaces survive the host-first layout, but their actions are no longer mounted.
  // Apply them to equivalent real controls in this test only; do not restore obsolete UI.
  ['host-edit', 'workspace-edit'],
  ['section-create', 'workspace-create'],
  ['section-create', 'host-add']
] as const

const geometry = (control: Locator) => control.evaluate(el => {
  const rect = (node: Element) => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height }
  }
  const svg = el.querySelector('svg')
  if (!svg || !el.parentElement) throw new Error('Expected a row control with a glyph')
  return { control: rect(el), glyph: rect(svg), row: rect(el.parentElement) }
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`row control hover preserves geometry, focus and name pills at ${viewport.width}`, async ({ launchPairedApp }) => {
    const { page, daemon } = await launchPairedApp()
    await page.setViewportSize(viewport)
    daemon.pushFrame(encodeEnvelope({ id: 1, type: 'conversations', ts: '2026-07-07T12:00:00.000Z',
      payload: { conversations: [SEEDED_ROW, { ...SEEDED_ROW, id: 'hover-channel', name: 'Hover channel', is_promoted: true }] } }))
    await expect(page.locator('.channel-list__rename')).toHaveCount(1)
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--color-state-hover)'
      probe.style.borderRadius = 'var(--radius-xs)'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = { background: style.backgroundColor, radius: style.borderRadius }
      probe.remove()
      return result
    })
    await mkdir('/tmp/builder-1865', { recursive: true })
    for (const [source, target] of cases) {
      const original = page.locator(`.channel-list__${source}`).first()
      const originalClass = await original.getAttribute('class')
      const originalRowClass = await original.evaluate(el => el.parentElement?.className ?? '')
      if (source !== target) await original.evaluate((el, name) => {
        el.className = `channel-list__${name}`
        el.parentElement?.classList.add(name === 'host-add' ? 'channel-list__host' : 'channel-list__workspace-head')
      }, target)
      const control = page.locator(`.channel-list__${target}`).first()
      const pill = control.locator('.channel-list__control-name')
      await page.mouse.move(viewport.width - 10, 10)
      await page.keyboard.press('Tab')
      await control.focus()
      await expect(control).toHaveCSS('outline-style', 'solid')
      await expect(control).toHaveCSS('outline-width', '1px')
      await expect(pill).toHaveCSS('display', 'block')
      expect(await control.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
      await control.evaluate(el => (el as HTMLElement).blur())
      const before = await geometry(control)
      await page.mouse.move(before.row.x + 20, before.row.y + before.row.height / 2)
      expect(await control.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
      await control.hover()
      await expect(control).toHaveCSS('opacity', '1')
      await expect(pill).toHaveCSS('display', 'block')
      const layer = await control.evaluate(el => {
        const style = getComputedStyle(el, '::before')
        const { x, y } = el.getBoundingClientRect()
        const transform = new DOMMatrix(style.transform)
        return { content: style.content, background: style.backgroundColor, radius: style.borderRadius,
          pointerEvents: style.pointerEvents, width: parseFloat(style.width), height: parseFloat(style.height),
          x: x + parseFloat(style.left) + transform.m41, y: y + parseFloat(style.top) + transform.m42 }
      })
      expect(layer.content).toBe('""')
      expect(layer.background).toBe(tokens.background)
      expect(layer.radius).toBe(tokens.radius)
      expect(layer.pointerEvents).toBe('none')
      expect(layer.width).toBe(before.glyph.width + 8)
      expect(layer.height).toBe(before.glyph.height + 8)
      expect(layer.x).toBeCloseTo(before.glyph.x - 4, 1)
      expect(layer.y).toBeCloseTo(before.glyph.y - 4, 1)
      expect(await geometry(control)).toEqual(before)
      const pillBefore = await pill.boundingBox()
      await page.mouse.move(before.control.x + before.control.width / 2 + 1, before.control.y + before.control.height / 2 + 1)
      const pillAfter = await pill.boundingBox()
      expect(pillBefore).not.toBeNull()
      expect(pillAfter?.x).toBeCloseTo((pillBefore?.x ?? 0) + 1, 1)
      expect(pillAfter?.y).toBeCloseTo((pillBefore?.y ?? 0) + 1, 1)
      expect(await geometry(control)).toEqual(before)
      if (source === target) {
        await page.screenshot({ path: `/tmp/builder-1865/${target}-${viewport.width}.png`, animations: 'disabled' })
      }
      if (source !== target && originalClass !== null) {
        await control.evaluate((el, classes) => {
          el.className = classes.control
          if (el.parentElement) el.parentElement.className = classes.row
        }, { control: originalClass, row: originalRowClass })
      }
    }
  })
}
