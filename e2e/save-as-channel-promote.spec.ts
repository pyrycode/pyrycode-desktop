import { test, expect, FIRST_SERVER_ID, type PairedApp } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { ConversationSummary } from '../src/shared/wire/types'

const CWD = '/home/alex/projects/demo'
const CANONICAL = '/home/alex/resolved/channels/release-planning/'
const TS = '2026-09-13T00:00:00Z'
const row = (id: string, name: string | null): ConversationSummary => ({ id, name, cwd: CWD,
  is_promoted: false, is_archived: false, workspace_label: null, last_message_ts: TS, last_used_at: TS })
const dialogOf = (app: PairedApp) => app.page.getByRole('dialog', { name: 'Save as channel', exact: true })

function controlled(id: string, name: string | null = 'Existing chat') {
  const accepted = conversationStateFake({ conversations: [row(id, name)] })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  return {
    requests,
    // `create_workspace_folder` is still captured though nothing should send it: a stray one would
    // trip the exact request-count assertions rather than passing unseen.
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (['create_workspace_folder', 'promote_conversation', 'create_conversation'].includes(request.type)) requests.push(request)
      if (request.type === 'create_workspace_folder') return []
      return accepted(bytes)
    }
  }
}

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

async function open(app: PairedApp, index = 0, title = 'Existing chat') {
  await app.page.locator('.channel-list__save').nth(index).click({ force: true })
  const dialog = dialogOf(app)
  await expect(dialog.getByRole('textbox', { name: 'Channel name:' })).toBeFocused()
  await expect(dialog.getByRole('textbox')).toHaveValue(title)
  // #1436 withdrew the folder choice: the name field is the whole form.
  await expect(dialog.getByRole('radio')).toHaveCount(0)
  return dialog
}

test('promotion keeps the original chat in its exact workspace and refreshes without duplication', async ({ launchPairedApp }) => {
  const first = controlled('first-chat')
  const second = controlled('second-chat', 'Other chat')
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  const dialog = await open(app)
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await dialog.getByRole('textbox').fill('   ')
  await expect(ok).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await open(app)
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-1280.png' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-800.png' })
  await app.page.setViewportSize({ width: 800, height: 260 })
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await app.page.screenshot({ path: '/tmp/builder-1436-save-modal-short.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.page.setViewportSize({ width: 800, height: 600 })
  await open(app)
  await dialog.getByRole('textbox').fill(' Release planning ')
  await ok.press('Enter')
  await expect.poll(() => first.requests.length).toBe(1)
  expect(first.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'first-chat', cwd: CWD, name: 'Release planning' } })
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
  await expect(app.page.locator('.channel-list__row-open')).toHaveCount(2)
  await expect(app.page.locator('.channel-list__row-open').filter({ hasText: 'Release planning' })).toHaveCount(1)
  await expect(dialog).toHaveCount(0)
  expect(second.requests).toHaveLength(0)
  // Cross-host routing, inherited from the deleted dedicated test: promotion is addressed by
  // conversation id through the main process, so the second host's chat reaches the second daemon
  // and the first sees nothing further. The first row is promoted by now, so its save affordance is
  // gone and the remaining one is the second host's.
  const other = await open(app, 0, 'Other chat')
  await other.getByRole('textbox').fill('Second host channel')
  await other.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(second.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'second-chat', cwd: CWD, name: 'Second host channel' } })
  expect(first.requests).toHaveLength(1)
})

test('dismissal abandons the draft; reopening restores the Untitled default', async ({ launchPairedApp }) => {
  const fake = controlled('untitled-chat', null)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  for (const closeName of ['Cancel', 'Close dialog']) {
    const dialog = await open(app, 0, 'Untitled')
    await dialog.getByRole('textbox').fill('Discarded idle')
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    // Dismissal sends nothing, and a stray folder reply is inert: since #1436 this dialog neither
    // requests a folder nor waits on one, so no reply can promote behind the operator's back.
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
    expect(fake.requests).toHaveLength(0)
  }
  // Each opening mounts fresh, so the discarded edits above leave no residue.
  const dialog = await open(app, 0, 'Untitled')
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(1)
  expect(fake.requests[0]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'untitled-chat', cwd: CWD, name: 'Untitled' } })
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
})
