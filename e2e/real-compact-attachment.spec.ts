import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { completedAttachmentDelivery } from './fixtures/compactAttachmentEvidence'
import { COMPOSER_ATTACH_LABEL } from '../src/renderer/src/screens/conversation/ComposerAttach'
import { ATTACHMENT_OPEN_CHANNEL } from '../src/shared/ipc/attachmentOpen'

const grants = ['interactive', 'thread', 'thread_expansion', 'thread_compact']
const filename = 'compact-authority.png'
const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4' +
  'FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc' +
  '8OJg6Ln3AAAAAElFTkSuQmCC', 'base64')
type Evidence = { host: string; chat: string; message: string; device: string; owningHost: boolean | null; grants: Record<string, boolean>;
  queries: { id: string; chat: string; projection?: string; version?: number }[];
  finals: { requestId: string; sequence: number }[];
  roots: { id: number; rev: number; status: string; attachment: string; filename: string; live: boolean; requestId: string | null; sequence: number }[];
  replies: { chat: string; projection?: string; final: boolean }[]; retrievals: number; sends: number; bodyReads: number }
type ObservedWindow = Window & { attachmentEvidence: Evidence; attachmentCommand: (command: any) => void }

// Read-only observation of real preload traffic; no request, capability or daemon fact is replaced.
async function observe(page: Page, host: string, chat = '', message = '') {
  await page.evaluate(async ({ host, chat, message, filename }) => {
    const identity = await window.pyry.deviceIdentity()
    if (!identity.ok) throw Error('Device identity unavailable')
    const evidence: Evidence = { host, chat, message, device: identity.deviceId, owningHost: null, grants: {}, queries: [], finals: [], roots: [], replies: [],
      retrievals: 0, sends: 0, bodyReads: 0 }
    let sequence = 0
    const target = window as unknown as ObservedWindow
    target.attachmentEvidence = evidence
    target.attachmentCommand = command => {
      if (command.type === 'sendMessage') {
        evidence.message = command.payload.message_id; evidence.chat = command.payload.conversation_id; evidence.sends++
      }
      if (command.type === 'queryThread' && command.serverId === host) {
        if (command.query.type === 'thread_read_tool_body') evidence.bodyReads++
        else evidence.queries.push({ id: command.requestId, chat: command.query.payload.conversation_id,
          projection: command.query.payload.projection, version: command.query.payload.version })
      }
    }
    window.pyry.onAttachmentRetrievalEvent(event => {
      if (event.type === 'completed' && event.serverId === host && event.conversationId === evidence.chat) evidence.retrievals++
    })
    window.pyry.onDaemonEvent(event => {
      if (event.serverId !== host) return
      sequence++
      if (event.type === 'connected') {
        evidence.owningHost = event.ack.server_id === host
        for (const grant of ['interactive', 'thread', 'thread_expansion', 'thread_compact'])
          evidence.grants[grant] = event.ack.capabilities.includes(grant)
      }
      const payload = event.type === 'threadCompactUpdate' ? event.update.payload
        : event.type === 'threadReply' && event.reply.type === 'thread_items' ? event.reply.payload : null
      if (event.type === 'threadReply' && event.reply.type === 'thread_items') evidence.replies.push({
        chat: event.reply.payload.conversation_id, projection: event.reply.payload.projection, final: event.reply.payload.final })
      if (!payload || payload.conversation_id !== evidence.chat || payload.projection !== 'compact-v1') return
      if (event.type === 'threadReply' && event.reply.type === 'thread_items' && event.reply.payload.final)
        evidence.finals.push({ requestId: event.requestId, sequence })
      const items = 'item' in payload ? payload.item ? [payload.item] : [] : 'items' in payload ? payload.items : []
      for (const item of items) {
        const content = item.content as { message_id?: string; device_id?: string; attachments?: { attachment_id: string; filename: string }[] }
        if (item.kind !== 'user_message' || content?.message_id !== evidence.message || content.device_id !== evidence.device) continue
        const attachment = content.attachments?.find(a => a.filename === filename)
        if (attachment) evidence.roots.push({ id: item.id, rev: item.rev, status: item.status,
          attachment: attachment.attachment_id, filename: attachment.filename, live: event.type === 'threadCompactUpdate',
          requestId: event.type === 'threadReply' ? event.requestId : null, sequence })
      }
    })
  }, { host, chat, message, filename })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Debugger.enable')
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  if (!result.objectId) throw Error('Preload command observation unavailable')
  await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
    condition: '(globalThis.attachmentCommand(arguments[0]), false)' })
  return cdp
}
const evidence = (page: Page) => page.evaluate(() => (window as unknown as ObservedWindow).attachmentEvidence)
async function deliveredQuery(page: Page, chat: string, after: number, root: Evidence['roots'][number]) {
  await expect.poll(async () => (await evidence(page)).queries.slice(after).some(q => q.chat === chat)).toBe(true)
  const query = (await evidence(page)).queries.slice(after).find(q => q.chat === chat)
  if (!query) throw Error('New owning compact query unavailable')
  expect(query.projection).toBe('compact-v1')
  // Only attachment-bearing data from this newly dispatched request, followed by its own final,
  // can certify delivery. Retained rows and send-time/live observations cannot satisfy this barrier.
  await expect.poll(async () => completedAttachmentDelivery(await evidence(page), query.id, root), { timeout: 45_000 }).toBe(true)
  return query
}
async function acceptedImage(page: Page) {
  const rows = page.locator('[data-thread-role="user"]')
  await expect(rows).toHaveCount(1)
  await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(0)
  const image = rows.getByRole('button', { name: 'Attached image', exact: true })
  await expect(image).toHaveCount(1)
  await expect.poll(() => image.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(64)
  return image
}

test.use({ interactiveRunner: 'stream-json', requiredCapabilities: grants })
test('compact attachment survives owning echo, replacements, navigation and fresh online restart', async ({ relay, daemon }, info) => {
  test.setTimeout(240_000)
  const binary = process.env.PYRY_BIN
  if (!binary) throw Error('Explicit source-stamped PYRY_BIN is required')
  const stamp = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
  const revision = /vcs.revision=([a-f0-9]{40})/.exec(stamp)?.[1]
  expect(revision).toBeTruthy(); expect(stamp).toContain('vcs.modified=false')
  const build = JSON.parse(await readFile('out/main/build-provenance.json', 'utf8'))
  expect(build.profile).toBe('normal')
  await info.attach('provenance', { contentType: 'application/json', body: JSON.stringify({ desktop: build,
    os: process.platform, daemonRevision: revision, daemonVersion: execFileSync(binary, ['version'], { encoding: 'utf8' }).trim(),
    daemonSha256: createHash('sha256').update(await readFile(binary)).digest('hex') }) })
  const dir = await mkdtemp(join(tmpdir(), 'compact-attachment-'))
  const path = join(dir, filename)
  await writeFile(path, picture)
  try {
    await withIsolatedElectronApp(async initial => {
      let { page, app } = initial
      let cdp = await observe(page, daemon.pairFields.server)
      try {
        await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
        const seedName = await page.locator('.channel-list__row-open').first().innerText()
        await confirmCreateChat(page)
        await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
        await app.evaluate(({ dialog, shell, ipcMain }, { path, channel }) => {
          Object.defineProperty(dialog, 'showOpenDialog', { configurable: true,
            value: async () => ({ canceled: false, filePaths: [path] }) })
          Object.defineProperty(shell, 'openPath', { configurable: true, value: async () => '' })
          ;(globalThis as any).attachmentOpened = 0
          ipcMain.on(channel, () => { (globalThis as any).attachmentOpened++ })
        }, { path, channel: ATTACHMENT_OPEN_CHANNEL })
        await page.getByRole('button', { name: COMPOSER_ATTACH_LABEL, exact: true }).click()
        await expect(page.locator('.composer__attachment')).toHaveCount(1, { timeout: 60_000 })
        await page.getByPlaceholder('Message…').fill('Reply with only READY. Do not use tools.')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await expect.poll(async () => (await evidence(page)).roots.some(r => r.live && r.status === 'delivered'), { timeout: 90_000 }).toBe(true)
        const accepted = await evidence(page)
        const ownName = await page.locator('.channel-list__row-open[aria-current="true"]').innerText()
        expect(ownName).not.toBe(seedName)
        expect(accepted.owningHost).toBe(true)
        expect(accepted.grants).toEqual(Object.fromEntries(grants.map(g => [g, true])))
        expect(accepted.roots.some(r => r.live && r.status === 'queued')).toBe(true)
        expect(new Set(accepted.roots.map(r => r.rev)).size).toBeGreaterThan(1)
        expect(new Set(accepted.roots.map(r => r.id)).size).toBe(1)
        expect(new Set(accepted.roots.map(r => r.attachment)).size).toBe(1)
        await (await acceptedImage(page)).click()
        await expect.poll(() => app.evaluate(() => (globalThis as any).attachmentOpened)).toBe(1)
        expect(accepted.sends).toBe(1); expect(accepted.bodyReads).toBe(0)
        await page.getByRole('button', { name: seedName, exact: true }).click()
        await expect(page.getByRole('button', { name: seedName, exact: true })).toHaveAttribute('aria-current', 'true')
        await expect.poll(async () => (await evidence(page)).replies.some(r => r.chat !== accepted.chat && r.final)).toBe(true)
        const beforeNavigation = (await evidence(page)).queries.length
        await page.getByRole('button', { name: ownName, exact: true }).click()
        await deliveredQuery(page, accepted.chat, beforeNavigation, accepted.roots[0])
        await acceptedImage(page)
        const reopened = await evidence(page)
        expect(reopened.sends).toBe(1); expect(reopened.bodyReads).toBe(0)
        await info.attach('accepted-and-reopened', { body: JSON.stringify(await evidence(page)), contentType: 'application/json' })
        await cdp.detach()
        const restarted = await initial.relaunch()
        page = restarted.page; app = restarted.app
        cdp = await observe(page, accepted.host, accepted.chat, accepted.message)
        // Switching after installing the observer ensures a positively witnessed fresh query, even
        // when app startup restored the selected row before Playwright obtained the new page.
        await page.getByRole('button', { name: seedName, exact: true }).click()
        await expect(page.getByRole('button', { name: seedName, exact: true })).toHaveAttribute('aria-current', 'true')
        await expect.poll(async () => (await evidence(page)).replies.some(r => r.chat !== accepted.chat && r.final)).toBe(true)
        const beforeRestartNavigation = (await evidence(page)).queries.length
        await page.getByRole('button', { name: ownName, exact: true }).click()
        const freshQuery = await deliveredQuery(page, accepted.chat, beforeRestartNavigation, accepted.roots[0])
        expect(freshQuery.version).toBe(0)
        await acceptedImage(page)
        const fresh = await evidence(page)
        expect(fresh.roots.every(r => r.attachment === accepted.roots[0].attachment)).toBe(true)
        expect(fresh.sends).toBe(0); expect(fresh.bodyReads).toBe(0)
        await expect.poll(async () => (await evidence(page)).retrievals).toBeGreaterThan(0)
        const history = await page.evaluate(async ({ host, chat }) => window.pyry.chatHistory({ operation: 'readThread', serverId: host, conversationId: chat }), accepted)
        await info.attach('complete-history-reading', { body: JSON.stringify(history), contentType: 'application/json' })
        expect(history.status).toBe('missing')
        for (const width of [1280, 800]) {
          await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width)
          await (await acceptedImage(page)).scrollIntoViewIfNeeded()
          await page.screenshot({ path: `/tmp/builder-2164/compact-attachment-${width}.png` })
        }
        await info.attach('fresh-online-delivery', { body: JSON.stringify(await evidence(page)), contentType: 'application/json' })
      } finally {
        await info.attach('last-observed-delivery', { body: JSON.stringify(await evidence(page)), contentType: 'application/json' })
        await cdp.detach().catch(() => undefined)
      }
    })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
