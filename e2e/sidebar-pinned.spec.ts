import { test, expect, SEEDED_ROW, FIRST_SERVER_ID, SECOND_SERVER_ID } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, EnvelopeType } from '../src/shared/wire/types'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'

const stamp = '2026-10-01T00:00:00'
const pin = (name: string, fraction: string): ConversationSummary => ({
  ...SEEDED_ROW, name, is_promoted: true, pinned_at: `${stamp}.${fraction}Z`
})
function frame(type: EnvelopeType, payload: unknown, in_reply_to?: number) {
  return encodeEnvelope({ id: 1, ts: `${stamp}Z`, type, payload, in_reply_to })
}
function update(row: ConversationSummary, inReplyTo?: number) {
  const { id, name, is_promoted, cwd, last_used_at, workspace_label } = row
  return frame('conversation_updated', { id, name, is_promoted, cwd, last_used_at, workspace_label }, inReplyTo)
}
function host(initial: ConversationSummary) {
  let rows = [initial]
  let lists = 0
  const renames: unknown[] = []
  const fallback = conversationStateFake({ conversations: [initial] })
  return {
    set: (next: ConversationSummary[]) => { rows = next },
    lists: () => lists,
    renames,
    reply: (bytes: Uint8Array) => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'list_conversations') {
        lists++
        return [frame('conversations', { conversations: rows }, request.id)]
      }
      if (request.type === 'rename_conversation') {
        const payload = request.payload as { conversation_id: string; name: string }
        renames.push(payload)
        rows = rows.map(r => r.id === payload.conversation_id ? { ...r, name: payload.name } : r)
        return [update(rows.find(r => r.id === payload.conversation_id)!, request.id)]
      }
      return fallback(bytes)
    }
  }
}

test('pins refresh per host, preserve attribution and folds, and survive an offline profile relaunch', async ({ launchPairedApp }) => {
  const a = host(pin('Alpha', '0002')), b = host(pin('Beta', '0001'))
  const first = await launchPairedApp({ buildReplyFrames: a.reply }, {
    hostLabel: 'Pyry', secondServer: { buildReplyFrames: b.reply }
  })
  const { page, servers } = first
  const pinned = page.locator('.channel-list__pinned')
  const buttons = pinned.locator('.channel-list__row-open')
  await expect(buttons).toHaveText(['Beta · Server', 'Alpha · Pyry'])
  const geometry = await pinned.evaluate(el => {
    const heading = el.querySelector('.channel-list__pinned-heading')!.getBoundingClientRect()
    const rows = [...el.querySelectorAll('.channel-list__row')].map(row => row.getBoundingClientRect())
    return { inset: rows[0].x - heading.x, pitch: rows[1].y - rows[0].y, height: rows[0].height }
  })
  expect(geometry).toEqual({ inset: 0, pitch: 28, height: 24 })
  await expect(page.locator('.channel-list__host-content .channel-list__row-open')).toHaveCount(0)
  // Both hosts report the same conversation ID; their rows remain independently interactive.
  for (const label of ['Beta · Server', 'Alpha · Pyry', 'Beta · Server']) {
    await pinned.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText([label])
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-2084/rework-selected-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 800 })
  await page.screenshot({ path: '/tmp/builder-2084/rework-selected-800.png', animations: 'disabled' })
  await pinned.locator('.channel-list__row').first().getByRole('button', { name: 'Edit channel', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit channel', exact: true })
  await dialog.getByRole('textbox', { name: 'Channel name:', exact: true }).fill('Beta renamed')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(buttons).toHaveText(['Beta renamed · Server', 'Alpha · Pyry'])
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(['Beta renamed · Server'])
  expect(b.renames).toEqual([{ conversation_id: SEEDED_ROW.id, name: 'Beta renamed' }])
  expect(a.renames).toEqual([])

  const hosts = page.locator('.channel-list__host-disclosure')
  await hosts.first().click()
  await expect(hosts.first()).toHaveAttribute('aria-expanded', 'false')
  await expect(buttons).toHaveCount(2)
  const bLists = b.lists()
  a.set([pin('Alpha', '00001'), { ...pin('Gamma', '0003'), id: 'gamma' }])
  await servers[0].daemon.pushFrame(update(pin('Alpha', '00001')))
  await expect(buttons).toHaveText(['Alpha · Pyry', 'Beta renamed · Server', 'Gamma · Pyry'])
  expect(b.lists()).toBe(bLists)
  a.set([{ ...pin('Alpha', '00001'), pinned_at: null }, { ...pin('Gamma', '0003'), id: 'gamma' }])
  await servers[0].daemon.pushFrame(update(pin('Alpha', '00001')))
  await expect(buttons).toHaveText(['Beta renamed · Server', 'Gamma · Pyry'])
  expect(b.lists()).toBe(bLists)
  await hosts.first().click()
  await expect(page.locator('.channel-list__host-content .channel-list__row-open')).toHaveText(['Alpha'])
  a.set([{ ...pin('Alpha', '00001'), pinned_at: null }])
  await servers[0].daemon.pushFrame(update(pin('Alpha', '00001')))
  await expect(buttons).toHaveText(['Beta renamed · Server'])
  a.set([{ ...pin('Alpha', '00001'), pinned_at: null }, { ...pin('Gamma', '0003'), id: 'gamma' }])
  await servers[0].daemon.pushFrame(update(pin('Alpha', '00001')))
  await expect(buttons).toHaveText(['Beta renamed · Server', 'Gamma · Pyry'])

  // Use the existing typed lifecycle pipe to hold transient renderer appearance deterministically.
  for (const type of ['disconnected', 'connecting'] as const) {
    await first.app.evaluate(({ BrowserWindow }, { channel, event }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, event)
    }, { channel: DAEMON_EVENT_CHANNEL, event: { type, serverId: FIRST_SERVER_ID } })
    const gamma = pinned.locator('.channel-list__row').filter({ hasText: 'Gamma' })
    if (type === 'disconnected') {
      await expect(gamma).toHaveAttribute('data-host-down', 'true')
      await expect(gamma).toHaveCSS('opacity', '0.6')
    } else {
      await expect(gamma).not.toHaveAttribute('data-host-down', 'true')
      await expect(gamma).toHaveCSS('opacity', '1')
    }
  }

  // Observe actual successful persisted list data before quitting, rather than seeding disk on relaunch.
  await expect.poll(async () => page.evaluate(async serverId => {
    const result = await window.pyry.chatHistory({ operation: 'readList', serverId })
    return result.status === 'stored' && result.snapshot.kind === 'list'
      ? result.snapshot.conversations.map(r => [r.name, r.pinned_at]) : null
  }, FIRST_SERVER_ID)).toEqual([['Alpha', null], ['Gamma', `${stamp}.0003Z`]])
  await expect.poll(async () => page.evaluate(async serverId => {
    const result = await window.pyry.chatHistory({ operation: 'readList', serverId })
    return result.status === 'stored' && result.snapshot.kind === 'list'
      ? result.snapshot.conversations.map(r => [r.name, r.pinned_at]) : null
  }, SECOND_SERVER_ID)).toEqual([['Beta renamed', `${stamp}.0001Z`]])
  servers[1].forwarder.closeClientLeg(4401)
  const down = pinned.locator('.channel-list__row').first()
  await expect(down).toHaveAttribute('data-host-down', 'true')
  await expect(down).toHaveCSS('opacity', '0.6')
  const errorColor = await page.locator('.channel-list').evaluate(el => getComputedStyle(el).getPropertyValue('--color-error').trim())
  const colors = await down.evaluate(el => {
    const swatch = document.createElement('span')
    swatch.style.color = 'var(--color-error)'; el.append(swatch)
    const expected = getComputedStyle(swatch).color; swatch.remove()
    const dot = getComputedStyle(el.querySelector('.conversation-status-dot')!)
    return { expected, actual: [...el.querySelectorAll('.channel-list__title, .channel-list__pinned-host')].map(n => getComputedStyle(n).color),
      dot: `${dot.backgroundColor} ${dot.boxShadow}` }
  })
  expect(errorColor).not.toBe('')
  expect(colors.actual).toEqual([colors.expected, colors.expected])
  expect(colors.dot).toContain(colors.expected)
  await expect(down.locator('.channel-list__rename')).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-2084/pinned-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 800 })
  await page.screenshot({ path: '/tmp/builder-2084/pinned-800.png', animations: 'disabled' })
  await first.app.close()
  for (const server of servers) { await server.daemon.close(); await server.forwarder.close() }
  const reopened = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  const saved = reopened.page.locator('.channel-list__pinned .channel-list__row')
  await expect(saved.locator('.channel-list__row-open')).toHaveText(['Beta renamed · Server', 'Gamma · Pyry'])
  await expect(saved.locator('.channel-list__rename')).toHaveCount(0)
  // Unreachable hosts may remain connecting while the supervisor retries. Cache visibility
  // is independent of that lifecycle; disconnected/error styling was asserted above.
})

// Reproduced without pins on main: https://github.com/pyrycode/pyrycode-desktop/issues/2089
test.skip('blocked on #2089 — unpair an unreachable saved host after relaunch', async ({ launchPairedApp }) => {
  const alpha = { ...SEEDED_ROW, name: 'Alpha', is_promoted: true }
  const a = host(alpha), b = host({ ...alpha, name: 'Beta' })
  const first = await launchPairedApp({ buildReplyFrames: a.reply }, { secondServer: { buildReplyFrames: b.reply } })
  await first.page.locator('.channel-list__row-open').filter({ hasText: 'Beta' }).click()
  a.set([alpha, { ...alpha, id: 'gamma', name: 'Gamma' }])
  await first.servers[0].daemon.pushFrame(update(alpha))
  await expect(first.page.locator('.channel-list__row-open')).toHaveText(['Alpha', 'Gamma', 'Beta'])
  for (const server of first.servers) {
    await expect.poll(() => first.page.evaluate(async serverId => {
      const result = await window.pyry.chatHistory({ operation: 'readList', serverId })
      return result.status === 'stored' && result.snapshot.kind === 'list'
        ? result.snapshot.conversations.map(row => row.name) : null
    }, server.serverId)).toEqual(server === first.servers[0] ? ['Alpha', 'Gamma'] : ['Beta'])
  }
  first.servers[1].forwarder.closeClientLeg(4401)
  await expect(first.page.locator('.channel-list__host').nth(1)).toHaveClass(/channel-list__host--failed/)
  await first.app.close()
  for (const server of first.servers) { await server.daemon.close(); await server.forwarder.close() }
  const reopened = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await expect(reopened.page.locator('.channel-list__row-open')).toHaveText(['Alpha', 'Gamma', 'Beta'])
  await reopened.page.locator('.channel-list__host-edit').first().click()
  const dialog = reopened.page.getByRole('dialog', { name: 'Edit host', exact: true })
  await dialog.getByRole('button', { name: 'Unpair host', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(reopened.page.locator('.channel-list__row-open')).toHaveText(['Beta'])
})
