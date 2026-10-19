import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'

for (const layout of ['channels', 'chats', 'pinned/tree'] as const) {
  test(`shared conversation IDs select only the clicked host in ${layout}`, async ({ launchPairedApp }) => {
    const alpha = { ...SEEDED_ROW, name: 'Alpha', is_promoted: layout !== 'chats', pinned_at: null }
    const beta = { ...alpha, name: 'Beta', pinned_at: layout === 'pinned/tree' ? '2026-10-01T00:00:00Z' : null }
    const { page } = await launchPairedApp({ buildReplyFrames: conversationStateFake({ conversations: [alpha] }) }, {
      hostLabel: 'Pyry', secondServer: { buildReplyFrames: conversationStateFake({ conversations: [beta] }) }
    })
    const betaLabel = layout === 'pinned/tree' ? 'Beta · Server' : 'Beta'
    const rows = page.locator('.channel-list__row')
    await expect(rows).toHaveCount(2)
    for (const label of ['Alpha', betaLabel, 'Alpha', betaLabel]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(page.locator('[aria-current="true"]')).toHaveText([label])
      // Move away so hover cannot disguise the resting fill of either row.
      await page.mouse.move(700, 20)
      const fills = await rows.evaluateAll(elements => {
        const swatch = document.createElement('span')
        swatch.style.backgroundColor = 'var(--color-on-primary)'
        elements[0].append(swatch)
        const selected = getComputedStyle(swatch).backgroundColor
        swatch.remove()
        return elements.map(el => ({
          current: el.querySelector('[aria-current="true"]') !== null,
          fill: getComputedStyle(el).backgroundColor, selected
        }))
      })
      expect(fills.filter(row => row.fill === row.selected)).toHaveLength(1)
      expect(fills.every(row => (row.fill === row.selected) === row.current)).toBe(true)
    }
    for (const [width, height] of [[1280, 800], [800, 600]]) {
      await page.setViewportSize({ width, height })
      await page.screenshot({ path: `/tmp/builder-2092/${layout.replace('/', '-')}-${width}.png`, animations: 'disabled' })
    }
  })
}
