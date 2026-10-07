import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW, FIRST_SERVER_ID, SECOND_SERVER_ID } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ElectronApplication } from '@playwright/test'
import type { ConversationSummary, EnvelopeType } from '../src/shared/wire/types'

const ts = '2026-10-06T12:00:00Z'
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) =>
  encodeEnvelope({ id: 90, type, ts, payload, in_reply_to })
const list = (row: ConversationSummary) => frame('conversations', { conversations: [row] })
const update = (row: ConversationSummary, read_up_to?: number, reply?: number) =>
  frame('conversation_updated', { id: row.id, name: row.name, cwd: row.cwd,
    is_promoted: row.is_promoted, last_used_at: row.last_used_at, workspace_label: row.workspace_label,
    ...(read_up_to === undefined ? {} : { read_up_to }) }, reply)

async function observeBadge(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    ;(globalThis as any).__receivedBadgeCounts = []
    ipcMain.on('pyry:command', (_event, command) => {
      if (command.type === 'setBadgeCount') (globalThis as any).__receivedBadgeCounts.push(command.payload.count)
    })
  })
}
const badge = (app: ElectronApplication) => app.evaluate(() =>
  (globalThis as any).__receivedBadgeCounts.at(-1))

test('remote marks clear mounted attention before refresh and survive stale lists and local opening', async ({ launchPairedApp }) => {
  const row = { ...SEEDED_ROW, read_up_to: 0, latest_entry_id: 10 }
  let asks = 0
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
    if (decodeEnvelope(bytes).type !== 'list_conversations') return []
    return ++asks === 1 ? [list(row)] : [] // Hold every metadata refresh reply.
  } }, { onLaunched: observeBadge })
  const dot = page.locator('.conversation-status-dot')
  await expect(dot).toHaveClass(/--new-messages/)
  await expect.poll(() => badge(app)).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('pyry.conversationLastRead'))).toBeNull()
  expect(await page.locator('.bubble').count()).toBe(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1825/unread-1280.png' })

  daemon.pushFrame(update(row, 10))
  await expect(dot).toHaveClass(/--idle/)
  await expect.poll(() => badge(app)).toBe(0)
  await expect.poll(() => asks).toBe(2)
  daemon.pushFrame(list({ ...row, read_up_to: 2, name: 'Delayed list' }))
  await expect(page.locator('.channel-list__row-open')).toContainText('Delayed list')
  await expect(dot).toHaveClass(/--idle/)
  daemon.pushFrame(update(row, 1, 8))
  daemon.pushFrame(update(row))
  daemon.pushFrame(list({ ...row, read_up_to: 10, latest_entry_id: 11, name: 'New entry' }))
  await expect(page.locator('.channel-list__row-open')).toContainText('New entry')
  await expect(dot).toHaveClass(/--new-messages/)
  await page.locator('.channel-list__row-open').click()
  daemon.pushFrame(frame('assistant_delta', { conversation_id: row.id, turn_id: 'remote-new', seq: 0, text: 'Synthetic reply' }))
  await expect(page.locator('.bubble')).toHaveCount(1)
  await expect(dot).toHaveClass(/--new-messages/)
  expect(await page.evaluate(() => localStorage.getItem('pyry.conversationLastRead'))).toBeNull()
  daemon.pushFrame(update(row, 11, 9))
  await expect(dot).toHaveClass(/--idle/)
  await expect.poll(() => badge(app)).toBe(0)
  await page.setViewportSize({ width: 800, height: 600 })
  await page.screenshot({ path: '/tmp/builder-1825/read-800.png' })
})

test('two hosts sharing an ID retain independent read state, dots and badge contribution', async ({ launchPairedApp }) => {
  const first = { ...SEEDED_ROW, read_up_to: 0, latest_entry_id: 10 }
  const second = { ...SECOND_SEEDED_ROW, id: first.id, read_up_to: 2, latest_entry_id: 10 }
  let firstAsks = 0
  let secondAsks = 0
  const { page, app, servers } = await launchPairedApp({ buildReplyFrames: bytes =>
    decodeEnvelope(bytes).type === 'list_conversations' && ++firstAsks === 1 ? [list(first)] : []
  }, { onLaunched: observeBadge, secondServer: { buildReplyFrames: bytes =>
    decodeEnvelope(bytes).type === 'list_conversations' && ++secondAsks === 1 ? [list(second)] : [] } })
  const rows = page.locator('.channel-list__row')
  const a = rows.filter({ hasText: first.name ?? '' }).locator('.conversation-status-dot')
  const b = rows.filter({ hasText: second.name ?? '' }).locator('.conversation-status-dot')
  await expect(a).toHaveClass(/--new-messages/)
  await expect(b).toHaveClass(/--new-messages/)
  await expect.poll(() => badge(app)).toBe(2)
  servers[0].daemon.pushFrame(update(first, 10))
  await expect(a).toHaveClass(/--idle/)
  await expect(b).toHaveClass(/--new-messages/)
  await expect.poll(() => badge(app)).toBe(1)
  // Saved list replies preserve the admitted fields; pushes patch held attention immediately.
  await expect.poll(async () => page.evaluate(async ({ firstHost, secondHost }) => {
    const a = await window.pyry.chatHistory({ operation: 'readList', serverId: firstHost })
    const b = await window.pyry.chatHistory({ operation: 'readList', serverId: secondHost })
    return [a.status === 'stored' && a.snapshot.kind === 'list' ? a.snapshot.conversations[0].read_up_to : null,
      b.status === 'stored' && b.snapshot.kind === 'list' ? b.snapshot.conversations[0].read_up_to : null]
  }, { firstHost: FIRST_SERVER_ID, secondHost: SECOND_SERVER_ID })).toEqual([0, 2])
  servers[1].daemon.pushFrame(update(second, 10, 6))
  await expect(b).toHaveClass(/--idle/)
  await expect.poll(() => badge(app)).toBe(0)
})
