import { test, expect, SECOND_SERVER_ID } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { ConversationSummary } from '../src/shared/wire/types'

const seed: ConversationSummary = {
  id: 'seed-conversation', name: 'Seeded channel', is_promoted: true, is_archived: false,
  cwd: '/fake/workspace', workspace_label: null,
  last_message_ts: '2026-07-07T12:00:00.000Z', last_used_at: '2026-07-07T12:00:00.000Z'
}

test('hosts and sections fold independently; an empty host creates in its default folder', async ({ launchPairedApp }) => {
  const first = conversationStateFake({ conversations: [seed] })
  const second = conversationStateFake({ conversations: [{ ...seed, id: 'second-seed', name: 'Other channel' }] })
  const creates: ReturnType<typeof decodeEnvelope>[] = []
  const app = await launchPairedApp({ buildReplyFrames: first }, { secondServer: {
    buildReplyFrames: bytes => {
      const request = decodeEnvelope(bytes)
      if (request.type === 'create_conversation') creates.push(request)
      return second(bytes)
    }
  } })
  const { page } = app
  const hosts = page.locator('.channel-list__host-disclosure')
  const sections = page.locator('.channel-list__section-disclosure')
  const rows = page.locator('.channel-list__row')
  await expect(hosts).toHaveCount(2)
  await expect(sections).toHaveCount(4)
  await expect(rows).toHaveCount(2)
  for (const section of await sections.all()) await expect(section).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.channel-list__row-open').filter({ hasText: 'Seeded channel' }).click()
  const composer = page.getByPlaceholder('Message…')
  await composer.fill('draft remains here')

  await sections.nth(0).click()
  await expect(sections.nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(rows).toHaveCount(1)
  await expect(sections.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await expect(sections.nth(2)).toHaveAttribute('aria-expanded', 'true')
  await expect(composer).toHaveValue('draft remains here')
  await expect(page.locator('.channel-list__section-chevron').nth(0)).toHaveCSS(
    'transform', 'matrix(0, -1, 1, 0, 0, 0)'
  )
  await sections.nth(0).click()
  await expect(rows).toHaveCount(2)

  await hosts.nth(0).click()
  await expect(sections).toHaveCount(2)
  await expect(rows).toHaveCount(1)
  await expect(composer).toHaveValue('draft remains here')
  await hosts.nth(0).click()
  await expect(sections).toHaveCount(4)
  await expect(rows).toHaveCount(2)

  app.servers[1].daemon.pushFrame(encodeEnvelope({ id: 101, type: 'conversations',
    ts: '2026-07-07T12:00:00.000Z', payload: { conversations: [] } }))
  await expect(rows).toHaveCount(1)

  const chatCreates = page.getByRole('button', { name: 'Create chat', exact: true })
  await expect(chatCreates).toHaveCount(2)
  await chatCreates.nth(1).click()
  const dialog = page.getByRole('dialog', { name: 'Create chat', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(creates).toHaveLength(0)
  await chatCreates.nth(1).click()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => creates.length).toBe(1)
  expect(creates[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: null, name: null, is_promoted: false } })
  await expect(rows.filter({ hasText: 'Untitled' })).toHaveCount(1)

  await app.app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].webContents.send(value.channel, value.event)
  }, { channel: DAEMON_EVENT_CHANNEL, event: { type: 'disconnected', serverId: SECOND_SERVER_ID } })
  await expect(chatCreates).toHaveCount(1)
  await expect(hosts).toHaveCount(2)
  await app.app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows()[0].webContents.send(value.channel, value.event)
  }, { channel: DAEMON_EVENT_CHANNEL,
    event: { type: 'connected', serverId: SECOND_SERVER_ID, ack: { protocol_version: 1 } } })
  await expect(chatCreates).toHaveCount(2)
  await expect(page.locator('.channel-list__host-disclosure')).toHaveCount(2)
  await expect(page.locator('.channel-list__row').filter({ hasText: 'Untitled' })).toHaveCount(1)
})
