import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { ATTACHMENT_UPLOAD_EVENT_CHANNEL } from '../src/shared/ipc/attachmentUpload'
import type { Envelope, SetSessionSettingsPayload, WireModelOption } from '../src/shared/wire/types'

const rows: WireModelOption[] = [
  { value: 'default', display_name: 'Inherited', resolved_model: 'claude-brisk-5',
    effort_levels: [], supports_auto_mode: false, truncated_fields: null },
  { value: 'steady[wide]', display_name: 'Steady', resolved_model: 'claude-steady-5',
    effort_levels: [], supports_auto_mode: false, truncated_fields: null }
]
const frame = (type: string, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 1, type, ts: '2026-10-01T00:00:00Z', payload, in_reply_to
})

test('recall holds all first-send entries and attachments through confirmation or silent rejection', async ({ launchPairedApp }, testInfo) => {
  const captured: Envelope[] = []
  const created: string[] = []
  const saved = new Map<string, string>()
  const fake = conversationStateFake({ conversations: [{ ...SEEDED_ROW, name: 'Existing chat' }] })
  const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: inbound => {
    const e = decodeEnvelope(inbound)
    captured.push(e)
    if (e.type === 'request_model_list') {
      const id = (e.payload as { conversation_id: string }).conversation_id
      return [frame('model_list', { conversation_id: id, models: rows, dropped_models: 0 })]
    }
    if (e.type === 'request_session_settings') {
      const id = (e.payload as { conversation_id: string }).conversation_id
      if (id !== 'seed-conversation' && !created.includes(id)) created.push(id)
      return [frame('session_settings', { session_id: 'session-' + id, model: saved.get(id) ?? '',
        effort: '', yolo: false, permission_mode: 'default', used_tokens: 0, window_tokens: 200000 }, e.id)]
    }
    if (e.type === 'set_session_settings') {
      const p = e.payload as SetSessionSettingsPayload
      if (p.session_id !== 'session-seed-conversation') return []
      if (p.model !== undefined) saved.set('seed-conversation', p.model)
      return [frame('session_settings_updated', { session_id: p.session_id }, e.id)]
    }
    if (e.type === 'send_message') return []
    return fake(inbound)
  } })
  const sends = () => captured.filter(e => e.type === 'send_message')
  const writes = () => captured.filter(e => e.type === 'set_session_settings')
  const send = page.getByRole('button', { name: 'Send', exact: true })
  const input = page.getByPlaceholder('Message…')
  await expect(page.locator('.composer__model-label')).toHaveText('Brisk')
  expect(writes()).toHaveLength(0)
  await page.locator('.composer__model').click()
  await page.getByRole('menu', { name: 'Model', exact: true }).getByRole('menuitem').click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pyry.lastModel'))).toBe(rows[1].value)

  for (const outcome of ['confirm', 'reject'] as const) {
    const before = writes().length
    await confirmCreateChat(page)
    await expect.poll(() => writes().length).toBe(before + 1)
    const write = writes().at(-1)!
    const id = created.at(-1)!
    expect(write.payload).toEqual({ session_id: 'session-' + id, model: rows[1].value })
    await expect(send).toBeDisabled()
    await input.fill('Draft survives recall ' + outcome)
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, {
        type: 'completed', uploadId: 'pending-file', filename: 'report.pdf'
      })
    }, ATTACHMENT_UPLOAD_EVENT_CHANNEL)
    await expect(page.locator('.composer__attachment')).toHaveCount(1)
    const beforeSend = sends().length
    await input.press('Enter')
    await expect(input).toHaveValue('Draft survives recall ' + outcome)
    await expect(page.locator('.composer__attachment')).toHaveCount(1)
    expect(sends()).toHaveLength(beforeSend)
    // Actions share sendText with Enter; opening the panel proves the event loop has advanced.
    await page.locator('.composer__actions').click()
    const actions = page.getByRole('menu', { name: 'Actions', exact: true })
    await actions.getByRole('menuitem', { name: 'Compact session', exact: true }).click()
    await expect(input).toHaveValue('Draft survives recall ' + outcome)
    expect(sends()).toHaveLength(beforeSend)
    daemon.pushFrame(outcome === 'confirm'
      ? frame('session_settings_updated', { session_id: 'session-' + id }, write.id)
      : frame('error', {}, write.id))
    await expect(send).toBeEnabled()
    await expect(page.locator('.composer__model-label')).toHaveText(outcome === 'confirm' ? 'Steady' : 'Brisk')
    await expect(page.locator('.run-config__error, .composer-options__error')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('pyry.lastModel'))).toBe(rows[1].value)
    if (outcome === 'confirm') {
      await page.screenshot({ path: testInfo.outputPath('confirmed-recall.png'), animations: 'disabled' })
      await testInfo.attach('confirmed-recall', { path: testInfo.outputPath('confirmed-recall.png'), contentType: 'image/png' })
    }
    await send.click()
    await expect.poll(() => sends().length).toBe(beforeSend + 1)
    expect(sends().at(-1)!.payload).toMatchObject({ conversation_id: id,
      text: 'Draft survives recall ' + outcome, attachment_ids: ['pending-file'] })
    await expect(input).toHaveValue('')
  }
  const beforeReopen = captured.filter(e => e.type === 'request_session_settings').length
  await page.getByRole('button', { name: 'Existing chat', exact: true }).click()
  await expect.poll(() => captured.filter(e => e.type === 'request_session_settings').length).toBeGreaterThan(beforeReopen)
  expect(writes()).toHaveLength(3)
  await page.getByRole('button', { name: 'Create channel', exact: true }).click({ force: true })
  await page.locator('.create-channel__input').fill('No model recall')
  await page.locator('.create-channel-overlay .modal__action--confirm').click()
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('No model recall')
  await expect(send).toBeEnabled()
  expect(writes()).toHaveLength(3)
})
