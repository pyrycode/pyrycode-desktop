import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { ConversationSummary } from '../src/shared/wire/types'

const TS = '2026-10-01T12:00:00Z'
const seed = (id: string, name: string): ConversationSummary => ({
  id, name, is_promoted: false, is_archived: false, cwd: '/fake/workspace',
  workspace_label: null, last_message_ts: TS, last_used_at: TS
})

function controlled(row: ConversationSummary) {
  const fake = conversationStateFake({ conversations: [row] })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  let refuseCreates = false
  return {
    requests,
    refuseCreates: () => { refuseCreates = true },
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (['rename_conversation', 'promote_conversation', 'create_conversation'].includes(request.type)) {
        requests.push(request)
      }
      // The final routing probes refuse creation so independent fakes cannot mint duplicate IDs.
      if (refuseCreates && request.type === 'create_conversation') {
        return [encodeEnvelope({ id: 1, type: 'error', ts: TS, in_reply_to: request.id,
          payload: { code: 'server.rejected', message: 'Creation refused', retryable: false } })]
      }
      return fake(bytes)
    }
  }
}

test('rename reorders the open chat while its status, pen, save action and host creates keep their targets', async ({ launchPairedApp }) => {
  const first = controlled(seed('first-chat', 'Zulu chat'))
  const second = controlled(seed('second-chat', 'Other host chat'))
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  const sections = page.locator('.channel-list__section')
  const chats = page.locator('.channel-list__host-content').nth(0)
  await sections.nth(1).getByRole('button', { name: 'Create chat', exact: true }).click()
  await page.getByRole('dialog', { name: 'Create chat', exact: true })
    .getByRole('button', { name: 'OK', exact: true }).click()
  await expect(chats.locator('.channel-list__row-open')).toHaveText(['Untitled', 'Zulu chat'])
  await chats.getByRole('button', { name: 'Zulu chat', exact: true }).click()

  daemon.pushFrame(encodeEnvelope({ id: 1, type: 'turn_state', ts: TS,
    payload: { conversation_id: 'first-chat', state: 'thinking' } }))
  // The title span itself holds the text; scope by the row-open button to avoid matching chrome.
  const chatRow = (name: string) => chats.locator('.channel-list__row')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
  await expect(chatRow('Zulu chat').locator('.conversation-status-dot--working')).toHaveCount(1)
  await expect(chatRow('Untitled').locator('.conversation-status-dot--idle')).toHaveCount(1)

  const edit = page.getByRole('dialog', { name: 'Edit chat', exact: true })
  const nameField = edit.getByRole('textbox', { name: 'Channel name:', exact: true })
  await chatRow('Zulu chat').hover()
  await chatRow('Zulu chat').getByRole('button', { name: 'Edit chat', exact: true }).click()
  await expect(nameField).toHaveValue('Zulu chat')
  await nameField.fill('Alpha chat')
  await edit.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(chats.locator('.channel-list__row-open')).toHaveText(['Alpha chat', 'Untitled'])
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Alpha chat')
  await expect(chatRow('Alpha chat').locator('.conversation-status-dot--working')).toHaveCount(1)
  await expect(chatRow('Untitled').locator('.conversation-status-dot--idle')).toHaveCount(1)
  await expect.poll(() => first.requests.filter(r => r.type === 'rename_conversation').length).toBe(1)
  expect(first.requests.at(-1)).toMatchObject({ type: 'rename_conversation',
    payload: { conversation_id: 'first-chat', name: 'Alpha chat' } })

  await chatRow('Alpha chat').hover()
  await chatRow('Alpha chat').getByRole('button', { name: 'Edit chat', exact: true }).click()
  await expect(nameField).toHaveValue('Alpha chat')
  await nameField.fill('Beta chat')
  await edit.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(chats.locator('.channel-list__row-open')).toHaveText(['Beta chat', 'Untitled'])
  await expect.poll(() => first.requests.filter(r => r.type === 'rename_conversation').length).toBe(2)
  expect(first.requests.at(-1)).toMatchObject({ type: 'rename_conversation',
    payload: { conversation_id: 'first-chat', name: 'Beta chat' } })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1693-sidebar-1280.png', animations: 'disabled' })
  await chatRow('Beta chat').hover()
  await chatRow('Beta chat').getByRole('button', { name: 'Save as channel', exact: true }).click()
  const save = page.getByRole('dialog', { name: 'Save as channel', exact: true })
  await expect(save.getByRole('textbox', { name: 'Channel name:', exact: true })).toHaveValue('Beta chat')
  await save.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(sections.nth(0).locator('xpath=following-sibling::*[1]')
    .locator('.channel-list__row-open')).toHaveText('Beta chat')
  expect(first.requests.at(-1)).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'first-chat', name: 'Beta chat', cwd: '/fake/workspace' } })
  expect(second.requests).toEqual([])

  first.refuseCreates()
  second.refuseCreates()
  for (const [hostIndex, host] of [first, second].entries()) {
    for (const [sectionIndex, label] of ['Create channel', 'Create chat'].entries()) {
      const before = host.requests.length
      const other = hostIndex === 0 ? second : first
      const otherBefore = other.requests.length
      await sections.nth(hostIndex * 2 + sectionIndex).getByRole('button', { name: label, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      if (sectionIndex === 0) await dialog.getByRole('textbox', { name: 'Channel name:', exact: true }).fill('New channel')
      await dialog.getByRole('button', { name: 'OK', exact: true }).click()
      await expect.poll(() => host.requests.length).toBe(before + 1)
      expect(host.requests.at(-1)).toMatchObject({ type: 'create_conversation',
        payload: { cwd: null, name: sectionIndex === 0 ? 'New channel' : null,
          is_promoted: sectionIndex === 0 } })
      if (sectionIndex === 0) await expect(dialog.getByRole('alert')).toBeVisible()
      else await expect(dialog).toHaveCount(0)
      expect(other.requests).toHaveLength(otherBefore)
      if (sectionIndex === 0) await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  }
})
