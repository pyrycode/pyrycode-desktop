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
  const { page, servers } = await launchPairedApp({
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
  await page.screenshot({ path: '/tmp/builder-1683-sidebar-1280.png', animations: 'disabled' })
})
