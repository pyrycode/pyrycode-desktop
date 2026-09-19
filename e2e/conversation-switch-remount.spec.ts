import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary, SendMessagePayload } from '../src/shared/wire/types'

const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded chat',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null
}
const FIRST = '  first line\n\nthird line  \n'
const SECOND = '\n  another draft\n\nlast  '

async function openRow(page: Page, name: string): Promise<void> {
  await page.locator('.channel-list__row').filter({ hasText: name })
    .locator('.channel-list__row-open').click()
}

async function openInfo(page: Page): Promise<void> {
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()
  await expect(page.locator('.status-sheet')).toBeVisible()
}

test('drafts survive create/sidebar switches and screen exits while transient panels reset', async ({
  launchPairedApp
}) => {
  const fake = conversationStateFake({ conversations: [SEED] })
  const sent: SendMessagePayload[] = []
  let holdCreatedList = false
  let createdList: Uint8Array[] = []
  const { page, daemon, forwarder } = await launchPairedApp({
    buildReplyFrames: inbound => {
      const envelope = decodeEnvelope(inbound)
      if (envelope.type === 'send_message') {
        sent.push(envelope.payload as SendMessagePayload)
        return [] // Deliberately no acknowledgement: clearing is local.
      }
      const reply = fake(inbound)
      if (envelope.type === 'create_conversation') holdCreatedList = true
      if (envelope.type === 'list_conversations' && holdCreatedList) {
        createdList = reply
        return []
      }
      return reply
    }
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  const composer = page.getByPlaceholder('Message…')
  const emptyHeight = await composer.evaluate(el => el.getBoundingClientRect().height)
  await composer.fill(FIRST)
  await openInfo(page)
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await expect(composer).toHaveValue('')
  await expect(page.locator('.status-sheet')).toHaveCount(0)
  // Draft before the created chat appears in a list: ownership comes from the create event.
  await composer.fill(SECOND)
  await expect(composer).toHaveValue(SECOND)
  await expect.poll(() => createdList.length).toBeGreaterThan(0)
  holdCreatedList = false
  for (const frame of createdList) daemon.pushFrame(frame)
  await expect(page.locator('.channel-list__row').filter({ hasText: 'Untitled' })).toBeVisible()
  await expect(composer).toHaveValue(SECOND)
  await openInfo(page)
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue(FIRST)
  await expect(page.locator('.status-sheet')).toHaveCount(0)
  await expect.poll(() => composer.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(emptyHeight)
  await page.screenshot({ path: '/tmp/builder-1523-restored-draft.png', animations: 'disabled' })
  await openRow(page, 'Untitled')
  await expect(composer).toHaveValue(SECOND)

  // Editing and explicitly emptying a restored value both survive the next remount.
  await composer.fill('edited\n\n  ')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue(FIRST)
  await openRow(page, 'Untitled')
  await expect(composer).toHaveValue('edited\n\n  ')
  await composer.fill('')
  await openRow(page, 'Seeded chat')
  await openRow(page, 'Untitled')
  await expect(composer).toHaveValue('')
  await composer.fill(SECOND)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('section[aria-label="Settings screen"]')).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await openRow(page, 'Untitled')
  await expect(composer).toHaveValue(SECOND)

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(composer).toHaveValue('')
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({ conversation_id: 'created-1', text: SECOND.trim() })
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue(FIRST)
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1]).toMatchObject({ conversation_id: SEED.id, text: FIRST.trim() })
  await openRow(page, 'Untitled')
  await expect(composer).toHaveValue('')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue('')

  await composer.fill('  \n\n ')
  await composer.press('Enter')
  await openRow(page, 'Untitled')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue('  \n\n ')
  expect(sent).toHaveLength(2)

  // Completion edits the retained draft. An Actions command does not clear it.
  daemon.pushFrame(encodeEnvelope({
    id: 1, type: 'slash_command_list', ts: '2026-09-02T12:00:00.000Z',
    payload: { conversation_id: SEED.id, dropped_commands: 0, commands: [
      { name: 'compact', argument_hint: '', description: '', aliases: [], truncated_fields: null }
    ] }
  }))
  await composer.fill('/comp')
  await expect(page.getByRole('menu', { name: 'Slash commands', exact: true })).toBeVisible()
  await composer.press('Enter')
  await expect(composer).toHaveValue('/compact')
  await composer.press('Escape')
  await openRow(page, 'Untitled')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue('/compact')
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Compact session', exact: true }).click()
  await expect.poll(() => sent.length).toBe(3)
  await expect(composer).toHaveValue('/compact')
  await openRow(page, 'Untitled')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue('/compact')

  // An unavailable host rejects Enter before the local success point.
  await forwarder.close()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await composer.fill('offline draft\n  ')
  await composer.press('Enter')
  await openRow(page, 'Untitled')
  await openRow(page, 'Seeded chat')
  await expect(composer).toHaveValue('offline draft\n  ')
  expect(sent).toHaveLength(3)
})

test('identical conversation IDs on different hosts own separate drafts and pane state', async ({
  launchPairedApp
}) => {
  const first = { ...SEED, name: 'First host channel', is_promoted: true }
  const second = { ...SEED, name: 'Second host channel', is_promoted: true }
  const { page, servers } = await launchPairedApp(
    { buildReplyFrames: conversationStateFake({ conversations: [first] }) },
    { secondServer: { buildReplyFrames: conversationStateFake({ conversations: [second] }) } }
  )
  const composer = page.getByPlaceholder('Message…')
  await openRow(page, 'First host channel')
  await composer.fill(FIRST)
  await openInfo(page)
  await openRow(page, 'Second host channel')
  await expect(composer).toHaveValue('')
  await expect(page.locator('.status-sheet')).toHaveCount(0)
  await composer.fill(SECOND)
  await openRow(page, 'First host channel')
  await expect(composer).toHaveValue(FIRST)
  // A later list from the other host must not change the selected draft owner.
  servers[1].daemon.pushFrame(encodeEnvelope({
    id: 2, type: 'conversations', ts: '2026-09-02T12:00:00.000Z',
    payload: { conversations: [{ ...second, name: 'Refreshed second channel' }] }
  }))
  await expect(page.locator('.channel-list__row').filter({ hasText: 'Refreshed second channel' })).toBeVisible()
  await expect(composer).toHaveValue(FIRST)
  await composer.fill('first edited after refresh')
  await openRow(page, 'Refreshed second channel')
  await expect(composer).toHaveValue(SECOND)
  await openRow(page, 'First host channel')
  await expect(composer).toHaveValue('first edited after refresh')
})
