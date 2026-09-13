import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, type PairedApp } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
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
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (['create_workspace_folder', 'promote_conversation', 'create_conversation'].includes(request.type)) requests.push(request)
      if (request.type === 'create_workspace_folder') return []
      return accepted(bytes)
    },
    folder(app: PairedApp, host = 0) {
      app.servers[host].daemon.pushFrame(encodeEnvelope({ id: 900, type: 'workspace_folder_created',
        ts: TS, in_reply_to: requests.at(-1)!.id, payload: { path: CANONICAL } }))
    },
    reject(app: PairedApp, host = 0) {
      app.servers[host].daemon.pushFrame(encodeEnvelope({ id: 901, type: 'error', ts: TS,
        in_reply_to: requests.at(-1)!.id,
        payload: { code: 'server.rejected', message: 'private daemon detail', retryable: false } }))
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
  await expect(dialog.getByLabel('Use shared scratch folder')).toBeChecked()
  return dialog
}

test('default promotes the original chat in its exact workspace and refreshes without duplication', async ({ launchPairedApp }) => {
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
  await app.page.screenshot({ path: '/tmp/builder-1353-modal-1280.png' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1353-modal-800.png' })
  await app.page.setViewportSize({ width: 800, height: 260 })
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await app.page.screenshot({ path: '/tmp/builder-1353-modal-short.png' })
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
})

test('dedicated uses its own host canonical reply, freezes edits and retries rejection', async ({ launchPairedApp }) => {
  const first = controlled('first-chat')
  const second = controlled('second-chat', 'Other chat')
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  const dialog = await open(app, 1, 'Other chat')
  await event(app, { type: 'workspaceFolderCreated', serverId: SECOND_SERVER_ID, path: '/idle' })
  expect(second.requests).toHaveLength(0)
  await dialog.getByRole('textbox').fill(' Release planning ')
  await dialog.getByLabel('Use shared scratch folder').focus()
  await app.page.keyboard.press('ArrowDown')
  await expect(dialog.getByLabel('Create a dedicated channel folder')).toBeChecked()
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await ok.click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(second.requests[0]).toMatchObject({ type: 'create_workspace_folder',
    payload: { parent: CWD + '/channels', name: 'release-planning' } })
  await expect(dialog.getByRole('textbox')).toBeDisabled()
  await expect(dialog.getByRole('radio').nth(0)).toBeDisabled()
  await expect(dialog.getByRole('radio').nth(1)).toBeDisabled()
  await expect(ok).toBeDisabled()
  await ok.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  for (const serverId of [FIRST_SERVER_ID, undefined, null, '', 42]) {
    await event(app, { type: 'workspaceFolderCreated', serverId, path: CANONICAL })
    await event(app, { type: 'workspaceFolderRejected', serverId })
  }
  await event(app, { type: 'conversationCreateRejected', serverId: SECOND_SERVER_ID })
  await expect(ok).toBeDisabled()
  expect(second.requests).toHaveLength(1)
  second.reject(app, 1)
  await expect(dialog.getByRole('alert')).toHaveText('Could not create that folder')
  await expect(dialog.getByRole('textbox')).toBeEnabled()
  await expect(dialog.getByRole('radio').nth(1)).toBeEnabled()
  await app.page.screenshot({ path: '/tmp/builder-1353-rejected.png' })
  expect(second.requests.filter(r => r.type === 'promote_conversation')).toHaveLength(0)
  await ok.click()
  await expect.poll(() => second.requests.length).toBe(2)
  second.folder(app, 1)
  await expect.poll(() => second.requests.length).toBe(3)
  expect(second.requests[2]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'second-chat', cwd: CANONICAL, name: 'Release planning' } })
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
  await expect(app.page.locator('.channel-list__row-open')).toHaveCount(2)
  await event(app, { type: 'workspaceFolderCreated', serverId: SECOND_SERVER_ID, path: '/duplicate' })
  expect(second.requests).toHaveLength(3)
  expect(first.requests).toHaveLength(0)
})

test('idle and pending dismissal abandon drafts; reopening restores the Untitled default', async ({ launchPairedApp }) => {
  const fake = controlled('untitled-chat', null)
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  for (const closeName of ['Cancel', 'Close dialog']) {
    let dialog = await open(app, 0, 'Untitled')
    await dialog.getByRole('textbox').fill('Discarded idle')
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    dialog = await open(app, 0, 'Untitled')
    await dialog.getByRole('textbox').fill('Discarded pending')
    await dialog.getByLabel('Create a dedicated channel folder').check()
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(() => fake.requests.length).toBe(closeName === 'Cancel' ? 1 : 2)
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
    expect(fake.requests.filter(r => r.type === 'promote_conversation')).toHaveLength(0)
  }
  const dialog = await open(app, 0, 'Untitled')
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeEnabled()
  expect(fake.requests).toHaveLength(2)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(3)
  expect(fake.requests[2]).toMatchObject({ type: 'promote_conversation',
    payload: { conversation_id: 'untitled-chat', cwd: CWD, name: 'Untitled' } })
  await expect(app.page.locator('.channel-list__rename')).toHaveCount(1)
})
