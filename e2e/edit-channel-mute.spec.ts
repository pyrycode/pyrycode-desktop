import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  Envelope,
  EnvelopeType,
  SetConversationMutedPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1608's Mute notifications checkbox in Edit channel. Renderer specs cannot click,
// so the view's markup and the pure `muteWriteFor` rule are unit-covered in `EditChannelDialog.test.tsx`;
// this file drives the transitions: open, toggle, and which exits put a `set_conversation_muted` on the
// wire. `conversation-mute-command.spec.ts` beside it proves the verb's routing and settlement.
//
// The fake holds ONE promoted channel (so the sidebar pen exists and launchPairedApp's single-row click
// lands in its thread), answers every `list_conversations` from its current flag, and answers a mute
// write the way the host does: flip the flag, reply with a correlated `conversation_updated`.
//
// SECRET HYGIENE: assertions read DOM state and captured wire payloads; the row is display literals.

const CHANNEL: ConversationSummary = {
  id: 'mute-channel',
  name: 'Muted channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/fake/workspace',
  workspace_label: null,
  last_message_ts: '2026-09-24T00:00:00Z',
  last_used_at: '2026-09-24T00:00:00Z'
}

const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number): Uint8Array =>
  encodeEnvelope({ id: 1, type, ts: '2026-09-24T00:00:00Z', payload, in_reply_to })

test('Edit channel reads the host mute flag and writes it only on a changed OK', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  let muted = true

  const { page } = await launchPairedApp({
    buildReplyFrames: (bytes) => {
      const request = decodeEnvelope(bytes)
      captured.push(request)
      if (request.type === 'list_conversations') {
        return [seedConversationsFrame({ ...CHANNEL, is_muted: muted })]
      }
      if (request.type !== 'set_conversation_muted') return []
      muted = (request.payload as SetConversationMutedPayload).muted
      const { id, is_promoted, name, cwd, last_used_at, workspace_label } = CHANNEL
      return [frame('conversation_updated',
        { id, is_promoted, name, cwd, last_used_at, workspace_label, is_muted: muted }, request.id)]
    }
  })
  await page.setViewportSize({ width: 1280, height: 800 })

  const writes = (): SetConversationMutedPayload[] =>
    captured.filter((e) => e.type === 'set_conversation_muted').map((e) => e.payload as SetConversationMutedPayload)
  const dialog = page.getByRole('dialog', { name: 'Edit channel', exact: true })
  const checkbox = dialog.getByRole('checkbox', { name: 'Mute notifications', exact: true })
  // The operator clicks the visible row: the native input is visually hidden under its own label.
  const muteRow = dialog.locator('.edit-channel__mute')
  const pen = page.locator('.channel-list__rename')
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })

  // AC1 — opens checked from the host's `is_muted: true`.
  await pen.click()
  await expect(dialog).toBeVisible()
  await expect(checkbox).toBeChecked()

  // AC3 — Cancel after a toggle sends nothing, and the reopen starts from the host value again.
  await muteRow.click()
  await expect(checkbox).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // AC3 — the close control after a toggle sends nothing.
  await pen.click()
  await expect(checkbox).toBeChecked()
  await muteRow.click()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  // AC3 — OK with the checkbox unchanged sends nothing.
  await pen.click()
  await expect(checkbox).toBeChecked()
  await ok.click()
  await expect(dialog).toHaveCount(0)
  expect(writes()).toEqual([])

  // AC2 — a toggle and OK send exactly one write, with the new value, naming this channel.
  await pen.click()
  await muteRow.click()
  await ok.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(writes).toEqual([{ conversation_id: CHANNEL.id, muted: false }])

  // The host's refreshed row reaches the sidebar through the list refresh; a reopen shows it. Polled
  // across reopens because the re-list lands asynchronously after the ack.
  await expect.poll(async () => {
    await pen.click()
    const checked = await checkbox.isChecked()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    return checked
  }).toBe(false)

  // AC1, the second mount site — the Channel info sheet's edit pill opens the same checkbox, reading
  // the same host value.
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Channel info', exact: true }).click()
  await page.locator('.channel-info__actions').getByRole('button', { name: 'Edit channel', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(checkbox).not.toBeChecked()

  // AC3 — Archive channel after a toggle sends the archive and no mute write.
  await muteRow.click()
  await expect(checkbox).toBeChecked()
  await dialog.getByRole('button', { name: 'Archive channel', exact: true }).click()
  await expect.poll(() => captured.filter((e) => e.type === 'archive_conversation').length).toBe(1)
  expect(writes()).toEqual([{ conversation_id: CHANNEL.id, muted: false }])
})
