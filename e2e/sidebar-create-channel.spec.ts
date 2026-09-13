import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID, type PairedApp } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { ConversationSummary } from '../src/shared/wire/types'

const CWD = '/home/alex/projects/demo'
const CANONICAL = '/home/alex/resolved/channels/release-planning/'
const row = (id: string): ConversationSummary => ({ id, name: 'Seeded channel', cwd: CWD,
  is_promoted: true, is_archived: false, workspace_label: null,
  last_message_ts: '2026-09-13T00:00:00Z', last_used_at: '2026-09-13T00:00:00Z' })
const dialogOf = (app: PairedApp) => app.page.getByRole('dialog', { name: 'Create channel', exact: true })

function controlled(id: string) {
  const accepted = conversationStateFake({ conversations: [row(id)] })
  const requests: ReturnType<typeof decodeEnvelope>[] = []
  let frames: Uint8Array[] = []
  return {
    requests,
    reply(bytes: Uint8Array): Uint8Array[] {
      const request = decodeEnvelope(bytes)
      if (request.type === 'create_workspace_folder' || request.type === 'create_conversation') {
        requests.push(request)
        if (request.type === 'create_conversation') frames = accepted(bytes)
        return []
      }
      return accepted(bytes)
    },
    release(app: PairedApp, host = 0) {
      frames.forEach(frame => app.servers[host].daemon.pushFrame(frame))
      frames = []
    },
    folder(app: PairedApp, host = 0) {
      app.servers[host].daemon.pushFrame(encodeEnvelope({ id: 900, type: 'workspace_folder_created',
        ts: '2026-09-13T00:00:00Z', in_reply_to: requests.at(-1)!.id, payload: { path: CANONICAL } }))
    },
    reject(app: PairedApp, host = 0) {
      app.servers[host].daemon.pushFrame(encodeEnvelope({ id: 901, type: 'error',
        ts: '2026-09-13T00:00:00Z', in_reply_to: requests.at(-1)!.id,
        payload: { code: 'server.rejected', message: 'private daemon detail', retryable: false } }))
    }
  }
}

async function event(app: PairedApp, value: object): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, { channel, value }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, value)
  }, { channel: DAEMON_EVENT_CHANNEL, value })
  // IPC delivery and the following renderer barrier establish a completed observation turn.
  await app.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

async function open(app: PairedApp, index = 0) {
  await app.page.getByRole('button', { name: 'Create channel', exact: true }).nth(index).click()
  const dialog = dialogOf(app)
  await expect(dialog.getByRole('textbox')).toBeFocused()
  await expect(dialog.getByRole('textbox')).toHaveValue('')
  await expect(dialog.getByLabel('Use shared scratch folder')).toBeChecked()
  return dialog
}

// Real fake-transport round trips prove the outgoing host and payload; injected main events probe
// renderer-only origin/stage guards that the transport would normally filter before delivery.
test('default uses the exact workspace, keeps the name, retries rejection and opens confirmation', async ({ launchPairedApp }) => {
  const fake = controlled('first-seed')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply })
  const dialog = await open(app)
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await expect(ok).toBeDisabled()
  await dialog.getByRole('textbox').fill('   ')
  await expect(ok).toBeDisabled()
  await dialog.getByRole('textbox').fill('Discarded')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await open(app)
  await app.page.setViewportSize({ width: 1280, height: 800 })
  await app.page.screenshot({ path: '/tmp/builder-1351-modal-1280.png' })
  await app.page.setViewportSize({ width: 800, height: 600 })
  await expect(dialog).toHaveCSS('width', '640px')
  await app.page.screenshot({ path: '/tmp/builder-1351-modal-800.png' })
  await app.page.setViewportSize({ width: 800, height: 260 })
  expect(await dialog.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded()
  await app.page.screenshot({ path: '/tmp/builder-1351-modal-short.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await app.page.setViewportSize({ width: 800, height: 600 })
  await open(app)
  await dialog.getByRole('textbox').fill(' Release planning ')
  await ok.press('Enter')
  await expect.poll(() => fake.requests.length).toBe(1)
  expect(fake.requests[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: CWD, name: 'Release planning', is_promoted: true } })
  await expect(dialog.getByRole('textbox')).toBeDisabled()
  await expect(dialog.getByRole('radio').nth(0)).toBeDisabled()
  await expect(dialog.getByRole('radio').nth(1)).toBeDisabled()
  await expect(ok).toBeDisabled()
  await ok.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: '/ignored' })
  expect(fake.requests).toHaveLength(1)
  fake.reject(app)
  await expect(dialog.getByRole('alert')).toHaveText('Could not create that channel')
  await app.page.screenshot({ path: '/tmp/builder-1351-rejected.png' })
  await expect(ok).toBeEnabled()
  await ok.click()
  await expect.poll(() => fake.requests.length).toBe(2)
  fake.release(app)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Release planning')
})

test('dedicated creates missing parents first and uses only the selected host canonical reply', async ({ launchPairedApp }) => {
  const first = controlled('first-seed')
  const second = controlled('second-seed')
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  await expect(app.page.getByRole('button', { name: 'Create channel', exact: true })).toHaveCount(2)
  const dialog = await open(app, 1)
  await event(app, { type: 'workspaceFolderCreated', serverId: SECOND_SERVER_ID, path: '/idle' })
  expect(second.requests).toHaveLength(0)
  await dialog.getByRole('textbox').fill(' Release planning ')
  // Native radio keyboard behavior: ArrowDown switches to dedicated.
  await dialog.getByLabel('Use shared scratch folder').focus()
  await app.page.keyboard.press('ArrowDown')
  await expect(dialog.getByLabel('Create a dedicated channel folder')).toBeChecked()
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await ok.click()
  await expect.poll(() => second.requests.length).toBe(1)
  expect(first.requests).toHaveLength(0)
  expect(second.requests[0]).toMatchObject({ type: 'create_workspace_folder',
    payload: { parent: CWD + '/channels', name: 'release-planning' } })
  for (const serverId of [FIRST_SERVER_ID, undefined, null, '', 42]) {
    await event(app, { type: 'workspaceFolderCreated', serverId, path: '/wrong' })
    await event(app, { type: 'workspaceFolderRejected', serverId })
  }
  await event(app, { type: 'conversationCreateRejected', serverId: SECOND_SERVER_ID })
  await event(app, { type: 'conversationCreated', serverId: SECOND_SERVER_ID, conversation: {
    id: 'out-of-stage', name: null, is_promoted: false, cwd: CWD,
    workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  await expect(dialog.getByRole('textbox')).toBeDisabled()
  expect(second.requests).toHaveLength(1)
  second.reject(app, 1)
  await expect(dialog.getByRole('alert')).toHaveText('Could not create that folder')
  expect(second.requests.filter(request => request.type === 'create_conversation')).toHaveLength(0)
  await ok.click()
  await expect.poll(() => second.requests.length).toBe(2)
  second.folder(app, 1)
  await expect.poll(() => second.requests.length).toBe(3)
  expect(second.requests[2]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: CANONICAL, name: 'Release planning', is_promoted: true } })
  await event(app, { type: 'workspaceFolderCreated', serverId: SECOND_SERVER_ID, path: '/duplicate' })
  for (const serverId of [FIRST_SERVER_ID, undefined]) {
    await event(app, { type: 'conversationCreateRejected', serverId })
    await event(app, { type: 'conversationCreated', serverId, conversation: {
      id: 'foreign', name: null, is_promoted: false, cwd: CWD,
      workspace_label: null, last_used_at: '2026-09-13T00:00:00Z' } })
  }
  await expect(dialog).toBeVisible()
  await expect(ok).toBeDisabled()
  expect(second.requests).toHaveLength(3)
  second.release(app, 1)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Release planning')
  expect(first.requests).toHaveLength(0)
})

test('default creation on the first host cannot fall back to the most recently paired host', async ({ launchPairedApp }) => {
  const first = controlled('first-seed')
  const second = controlled('second-seed')
  const app = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  // Each fake's generated IDs start at created-1; separate launches keep the navigation
  // assertion independent of artificial cross-host ID collisions.
  const dialog = await open(app, 0)
  await dialog.getByRole('textbox').fill('First host channel')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => first.requests.length).toBe(1)
  expect(first.requests[0]).toMatchObject({ type: 'create_conversation',
    payload: { cwd: CWD, name: 'First host channel', is_promoted: true } })
  expect(second.requests).toHaveLength(0)
  first.release(app)
  await expect(dialog).toHaveCount(0)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('First host channel')
})


test('dismissal and disconnect abandon pending continuations, and a fresh opening resets choices', async ({ launchPairedApp }) => {
  const fake = controlled('first-seed')
  const app = await launchPairedApp({ buildReplyFrames: fake.reply }, { secondServer: {} })
  for (const closeName of ['Cancel', 'Close dialog']) {
    const dialog = await open(app)
    await dialog.getByRole('textbox').fill('Release planning')
    await dialog.getByLabel('Create a dedicated channel folder').check()
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(() => fake.requests.length).toBe(closeName === 'Cancel' ? 1 : 2)
    await dialog.getByRole('button', { name: closeName, exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
    expect(fake.requests.filter(request => request.type === 'create_conversation')).toHaveLength(0)
  }
  let dialog = await open(app)
  await dialog.getByRole('textbox').fill('Release planning')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(3)
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  fake.release(app)
  await expect(app.page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Release planning')
  await expect(dialog).toHaveCount(0)
  dialog = await open(app)
  await dialog.getByRole('textbox').fill('Release planning')
  await dialog.getByLabel('Create a dedicated channel folder').check()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => fake.requests.length).toBe(4)
  await event(app, { type: 'disconnected', serverId: FIRST_SERVER_ID })
  await expect(dialog).toHaveCount(0)
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
  await event(app, { type: 'connected', serverId: FIRST_SERVER_ID, ack: { protocol_version: 1 } })
  await event(app, { type: 'workspaceFolderCreated', serverId: FIRST_SERVER_ID, path: CANONICAL })
  expect(fake.requests).toHaveLength(4)
  await expect(dialog).toHaveCount(0)
})
