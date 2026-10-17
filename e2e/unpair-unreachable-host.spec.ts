import { test, expect, SEEDED_ROW, FIRST_SERVER_ID, SECOND_SERVER_ID } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Page } from '@playwright/test'

const alpha: ConversationSummary = { ...SEEDED_ROW, name: 'Alpha', is_promoted: true }
function host(initial: ConversationSummary) {
  let rows = [initial]
  const fallback = conversationStateFake({ conversations: [initial] })
  return {
    set: (next: ConversationSummary[]) => { rows = next },
    reply: (bytes: Uint8Array) => {
      const request = decodeEnvelope(bytes)
      if (request.type !== 'list_conversations') return fallback(bytes)
      return [encodeEnvelope({ id: 1, ts: '2026-10-01T00:00:00Z', type: 'conversations', payload: { conversations: rows }, in_reply_to: request.id })]
    }
  }
}
const storedNames = (page: Page, serverId: string) => page.evaluate(async id => {
  const result = await window.pyry.chatHistory({ operation: 'readList', serverId: id })
  return result.status === 'stored' && result.snapshot.kind === 'list' ? result.snapshot.conversations.map(row => row.name) : null
}, serverId)

// #2089: disposing the departed host's live state re-entered its own iteration through badge readers.
test('unpairing an unreachable saved host after relaunch keeps the app responsive and forgets it', async ({ launchPairedApp }) => {
  const a = host(alpha), b = host({ ...alpha, name: 'Beta' })
  const first = await launchPairedApp({ buildReplyFrames: a.reply }, { secondServer: { buildReplyFrames: b.reply } })
  await first.page.locator('.channel-list__row-open').filter({ hasText: 'Beta' }).click()
  a.set([alpha, { ...alpha, id: 'gamma', name: 'Gamma' }])
  await first.servers[0].daemon.pushFrame(encodeEnvelope({ id: 1, ts: '2026-10-01T00:00:00Z', type: 'conversation_updated',
    payload: { id: alpha.id, name: alpha.name, is_promoted: true, cwd: alpha.cwd, last_used_at: alpha.last_used_at, workspace_label: alpha.workspace_label } }))
  await expect(first.page.locator('.channel-list__row-open')).toHaveText(['Alpha', 'Gamma', 'Beta'])
  await expect.poll(() => storedNames(first.page, FIRST_SERVER_ID)).toEqual(['Alpha', 'Gamma'])
  await expect.poll(() => storedNames(first.page, SECOND_SERVER_ID)).toEqual(['Beta'])
  first.servers[1].forwarder.closeClientLeg(4401)
  await expect(first.page.locator('.channel-list__host').nth(1)).toHaveClass(/channel-list__host--failed/)
  await first.app.close()
  for (const server of first.servers) { await server.daemon.close(); await server.forwarder.close() }

  const reopened = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  const rows = reopened.page.locator('.channel-list__row-open')
  await expect(rows).toHaveText(['Alpha', 'Gamma', 'Beta'])
  await reopened.page.locator('.channel-list__host-edit').first().click()
  const dialog = reopened.page.getByRole('dialog', { name: 'Edit host', exact: true })
  await dialog.getByRole('button', { name: 'Unpair host', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(rows).toHaveText(['Beta'])
  await expect(reopened.page.locator('.channel-list__host')).toHaveCount(1)
  await rows.filter({ hasText: 'Beta' }).click()
  await expect(reopened.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(['Beta'])
  expect(await storedNames(reopened.page, FIRST_SERVER_ID)).toBeNull()
  expect(await storedNames(reopened.page, SECOND_SERVER_ID)).toEqual(['Beta'])
  await reopened.app.close()

  const again = await launchPairedApp({}, { reuseUserDataDir: first.userDataDir })
  await expect(again.page.locator('.channel-list__row-open')).toHaveText(['Beta'])
  await expect(again.page.locator('.channel-list__host')).toHaveCount(1)
})
