import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

const seed = (id: string): ConversationSummary => ({
  id, name: id, is_promoted: true, is_archived: false, cwd: '/fake/workspace',
  workspace_label: null, last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z'
})

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  if (value === null) throw new Error('Expected a laid-out sidebar element')
  return value
}

test('host-first sidebar follows the Figma insets, row sizes and host spacing', async ({ launchPairedApp }) => {
  const { page, servers, app } = await launchPairedApp({
    buildReplyFrames: conversationStateFake({ conversations: [seed('one')] })
  }, { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [seed('three')] }) } })
  servers[0].daemon.pushFrame(encodeEnvelope({ id: 102, type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z', payload: { conversations: [seed('one'), seed('two')] } }))
  const card = await box(page.locator('.paired-shell__sidebar'))
  const hosts = page.locator('.channel-list__host')
  const sections = page.locator('.channel-list__section')
  const rows = page.locator('.channel-list__row')
  await expect(hosts).toHaveCount(2)
  await expect(sections).toHaveCount(4)
  await expect(rows).toHaveCount(3)
  await expect(page.locator('.channel-list__workspace')).toHaveCount(0)
  await expect(page.locator('.channel-list__divider')).toHaveCount(0)

  for (const host of await hosts.all()) {
    const h = await box(host)
    expect(h.x - card.x).toBe(20)
    expect(h.height).toBe(28)
  }
  for (const section of await sections.all()) {
    const h = await box(section)
    expect(h.x - card.x).toBe(24)
    expect(h.height).toBe(28)
  }
  for (const row of await rows.all()) {
    const h = await box(row)
    expect(h.x - card.x).toBe(32)
    expect(h.height).toBe(24)
  }
  expect((await box(rows.nth(1))).y - (await box(rows.nth(0))).y).toBe(28)
  const firstHostEnd = await box(sections.nth(1))
  expect((await box(hosts.nth(1))).y - firstHostEnd.y - firstHostEnd.height).toBe(16)
  const tree = page.locator('.channel-list__tree')
  const list = page.locator('.channel-list')
  const bar = page.locator('.channel-list__actions')
  const rule = page.locator('.channel-list__actions-rule')
  const pair = page.getByRole('button', { name: 'Pair new host' })
  const barBox = await box(bar)
  const ruleBox = await box(rule)
  const pairBox = await box(pair)
  expect(barBox.y - card.y).toBe(24)
  expect(barBox.height).toBe(28)
  expect(ruleBox.y - barBox.y - barBox.height).toBe(16)
  expect((await box(hosts.first())).y - ruleBox.y - ruleBox.height).toBe(24)
  expect(card.y + card.height - (await box(tree)).y - (await box(tree)).height).toBe(20)
  await page.screenshot({ path: '/tmp/builder-1683-sidebar-1280.png', animations: 'disabled' })
  for (const width of [1280, 800]) {
    await app.evaluate(({ BrowserWindow }, nextWidth) => {
      BrowserWindow.getAllWindows()[0].setContentSize(nextWidth, 800)
    }, width)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width)
    expect((await box(page.locator('.paired-shell__sidebar'))).width).toBe(400)
    expect((await box(bar)).height).toBe(28)
  }
  servers[0].daemon.pushFrame(encodeEnvelope({ id: 103, type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z', payload: { conversations: Array.from({ length: 40 }, (_, index) => seed(`tall-${index}`)) } }))
  await expect(rows).toHaveCount(41)
  expect(await tree.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
  const restingRowY = (await box(rows.first())).y
  const scrolled = await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
    return el.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)
  expect((await box(rows.first())).y).toBeLessThan(restingRowY)
  expect((await box(bar)).y).toBe(barBox.y)
  expect((await box(rule)).y).toBe(ruleBox.y)
  expect((await box(pair)).y).toBe(pairBox.y)
  await expect(pair).toBeVisible()
})
