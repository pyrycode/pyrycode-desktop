import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile, preview } from 'vite'
import { HOST_LABEL_SET_CHANNEL } from '../src/shared/ipc/hostLabel'
import { UNPAIR_SERVER_CHANNEL } from '../src/shared/ipc/unpair'
import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'

const TS = '2026-10-05T00:00:00Z'
const DEFAULT = 'Keep the main thread free. The operator cannot send you a message while a turn runs. Their messages wait until the turn ends.\n' +
  '- Hand any work longer than a few tool calls to a background subagent. Reply at once with what started, and report the result when it arrives.\n' +
  '- Delegate builds, test runs, device testing, waiting on CI, investigations across several files, ticket filing, design work, log digging and knowledge capture.\n' +
  '- Keep inline only quick work: an answer from context, one lookup, one file read, one small edit.\n' +
  '- In this conversation, responsiveness matters more than token usage.\n' +
  '- Use a cheaper model for routine delegated work.\n' +
  '- Give each subagent a short brief, not the conversation history.\n' +
  '- Check a subagent’s claim cheaply before acting on it.\n' +
  '- Never run two subagents on one shared resource, such as a connected device, emulator or one working tree.'
const answer = (id: number, text: string, failed = false) => encodeEnvelope({
  id: 900, ts: TS, in_reply_to: id, type: failed ? 'error' : 'host_system_prompt',
  payload: failed ? { code: 'host_system_prompt.unavailable', message: 'fixed daemon failure' }
    : { system_prompt: text, default_system_prompt: DEFAULT }
})
function hostFake(seed: typeof SEEDED_ROW, initial: string) {
  const base = conversationStateFake({ conversations: [seed] })
  const reads: Envelope[] = [], writes: Envelope[] = []
  const state = { current: initial, holdRead: false, failRead: false, holdWrite: false, failWrite: false }
  return { state, reads, writes, buildReplyFrames(bytes: Uint8Array): Uint8Array[] {
    const env = decodeEnvelope(bytes)
    if (env.type === 'request_host_system_prompt') {
      reads.push(env)
      return state.holdRead ? [] : [answer(env.id, state.current, state.failRead)]
    }
    if (env.type === 'set_host_system_prompt') {
      writes.push(env)
      if (state.holdWrite) return []
      if (!state.failWrite) state.current = (env.payload as { system_prompt: string }).system_prompt
      return [answer(env.id, state.current, state.failWrite)]
    }
    return base(bytes)
  } }
}

test('selected-host prompt read, reset, durable save, failures and modal lifetime', async ({ launchPairedApp }, testInfo) => {
  test.setTimeout(90_000)
  const a = hostFake(SEEDED_ROW, 'host A instructions'), b = hostFake(SECOND_SEEDED_ROW, '')
  const { page, app, servers } = await launchPairedApp(
    { buildReplyFrames: a.buildReplyFrames }, { secondServer: { buildReplyFrames: b.buildReplyFrames }, hostLabel: 'Pyrybox' })
  // Paint once before the retained capture: a hidden window may hold the previous frame.
  const capture = async (name: string) => {
    const paint = () => app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].capturePage(undefined, { stayHidden: true, stayAwake: true })
      return image.toPNG().toString('base64')
    })
    await paint()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    writeFileSync(testInfo.outputPath(`${name}.png`), Buffer.from(await paint(), 'base64'))
  }
  const dialog = page.getByRole('dialog', { name: 'Edit host', exact: true })
  const field = dialog.getByRole('textbox', { name: 'Host system prompt:' })
  const reset = dialog.getByRole('button', { name: 'Reset to default', exact: true })
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  const cancel = dialog.locator('.modal__action--cancel')
  const open = async () => {
    const host = page.locator('.channel-list__host').nth(1)
    await host.hover(); await host.getByRole('button', { name: 'Edit host', exact: true }).click()
    await expect(dialog).toBeVisible()
  }
  await open()
  await expect(field).toBeEnabled(); await expect(field).toHaveValue('')
  expect(a.reads).toHaveLength(0); expect(b.reads).toHaveLength(1)
  await capture('empty')
  await field.fill('Reply in British English and keep answers short.\nAsk before you push, merge or delete anything.\nWrite commit messages in the imperative mood.')
  await capture('filled')
  b.state.holdWrite = true
  await dialog.getByRole('textbox', { name: 'Host name:' }).fill('Saved name')
  await ok.click(); await expect.poll(() => b.writes.length).toBe(1)
  await expect(field).toBeDisabled(); await expect(ok).toBeDisabled(); await expect(reset).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Unpair host' })).toBeDisabled(); await expect(cancel).toBeEnabled()
  b.state.current = (b.writes[0].payload as { system_prompt: string }).system_prompt
  servers[1].daemon.pushFrame(answer(b.writes[0].id, b.state.current))
  await expect(dialog).toHaveCount(0); expect(a.writes).toHaveLength(0)
  b.state.holdWrite = false
  await open(); await expect(field).toHaveValue(b.state.current)
  await field.fill(''); await ok.click(); await expect(dialog).toHaveCount(0)
  expect(b.writes[1].payload).toEqual({ system_prompt: '' })
  await open(); await expect(field).toBeEnabled(); await reset.click()
  await expect(field).toHaveValue(DEFAULT); await expect(reset).toHaveCount(0)
  await capture('default')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 900))
  await capture('default-minimum-width')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 450))
  await expect.poll(() => page.viewportSize()?.width ?? page.evaluate(() => innerWidth)).toBe(800)
  await cancel.scrollIntoViewIfNeeded(); await expect(cancel).toBeInViewport()
  await capture('default-short')
  await cancel.click(); await expect(dialog).toHaveCount(0); expect(b.writes).toHaveLength(2)
  await open(); await expect(field).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  b.state.failRead = true
  await open(); await expect(dialog.getByText('Could not read the host system prompt')).toBeVisible()
  await expect(field).toBeDisabled(); await expect(reset).toHaveCount(0)
  await expect(dialog.getByRole('textbox', { name: 'Host name:' })).toBeEnabled()
  await cancel.click(); b.state.failRead = false; b.state.holdRead = true
  await open(); await expect.poll(() => b.reads.length).toBe(6)
  const oldRead = b.reads.at(-1)!.id
  await cancel.click(); await open(); await expect.poll(() => b.reads.length).toBe(7)
  servers[1].daemon.pushFrame(answer(oldRead, 'stale'))
  servers[0].daemon.pushFrame(answer(b.reads.at(-1)!.id, 'wrong host'))
  servers[1].daemon.pushFrame(answer(b.reads.at(-1)!.id, 'fresh'))
  await expect(field).toHaveValue('fresh')
  await field.fill('  retry\n ')
  servers[1].daemon.pushFrame(answer(b.reads.at(-1)!.id, 'duplicate'))
  b.state.holdRead = false; b.state.failWrite = true
  await dialog.getByRole('textbox', { name: 'Host name:' }).fill('Name survives prompt rejection')
  await ok.click(); await expect(dialog.getByText('Could not save the host system prompt')).toBeVisible()
  await expect(field).toHaveValue('  retry\n '); await expect(field).toBeEnabled()
  b.state.failWrite = false
  await ok.click(); await expect(dialog).toHaveCount(0)
  expect(b.writes.at(-1)!.payload).toEqual({ system_prompt: '  retry\n ' })
  await open(); await expect(field).toHaveValue('  retry\n ')
  await expect(dialog.getByRole('textbox', { name: 'Host name:' })).toHaveValue('Name survives prompt rejection')
  await field.fill('é'.repeat(4097)); await expect(ok).toBeDisabled()
  await expect(dialog.getByText('Over the 8192-byte limit. Shorten it before saving.')).toBeVisible()
  await field.fill('é'.repeat(4096)); await expect(ok).toBeEnabled()
  b.state.holdWrite = true
  await ok.click(); await expect.poll(() => b.writes.length).toBe(5)
  const oldWrite = b.writes.at(-1)!.id
  await cancel.click(); await open(); await expect(field).toHaveValue('  retry\n ')
  servers[1].daemon.pushFrame(answer(oldWrite, 'late durable write'))
  await field.fill('new interaction')
  await expect(field).toHaveValue('new interaction'); await expect(dialog).toBeVisible()
  await cancel.click()
  await open(); await expect(field).toHaveValue('  retry\n ')
  await field.fill('interrupted write'); await ok.click()
  await expect.poll(() => b.writes.length).toBe(6)
  servers[1].forwarder.closeClientLeg(4404)
  await expect(dialog.getByText('Could not save the host system prompt')).toBeVisible()
  await expect(field).toHaveValue('interrupted write'); await expect(field).toBeEnabled()
  await expect(dialog).toBeVisible(); await cancel.click()
})

test('each opening reads once under development StrictMode effect replay', async ({ launchPairedApp }) => {
  test.setTimeout(90_000)
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'development' }, resolve('electron.vite.config.ts'))
  const renderer = loaded!.config.renderer
  const outDir = await mkdtemp(join(tmpdir(), 'builder-1738-strict-mode-'))
  await build({ ...renderer, configFile: false, root: resolve('src/renderer'), base: './',
    define: { ...renderer.define, 'process.env.NODE_ENV': JSON.stringify('development') },
    build: { ...renderer.build, outDir, minify: false }, logLevel: 'silent' })
  const assets = join(outDir, 'assets')
  const bundle = (await readdir(assets)).find(name => name.endsWith('.js'))!
  expect(await readFile(join(assets, bundle), 'utf8')).toContain('commitDoubleInvokeEffectsInDEV')
  const server = await preview({ configFile: false, root: resolve('src/renderer'), build: { outDir },
    preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  try {
    const rendererUrl = server.resolvedUrls!.local[0]
    const fake = hostFake(SEEDED_ROW, 'Stored prompt')
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: fake.buildReplyFrames }, { rendererUrl })
    expect(page.url()).toBe(rendererUrl)
    const pen = page.locator('.channel-list__host-edit').first()
    const dialog = page.getByRole('dialog', { name: 'Edit host', exact: true })
    const field = dialog.getByRole('textbox', { name: 'Host system prompt:' })
    await pen.click()
    await expect(field).toHaveValue('Stored prompt')
    expect(fake.reads).toHaveLength(1)
    await page.setViewportSize({ width: 800, height: 240 })
    await dialog.getByRole('textbox', { name: 'Host name:' }).focus()
    await page.keyboard.press('Tab')
    await expect(field).toBeFocused()
    await expect(field).toBeInViewport()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Reset to default', exact: true })).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Reset to default', exact: true })).toBeInViewport()
    await field.fill('Unsent draft')
    daemon.pushFrame(answer(fake.reads[0].id, 'Duplicate'))
    await expect(field).toHaveValue('Unsent draft')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    fake.state.holdRead = true
    await pen.click()
    await expect.poll(() => fake.reads.length).toBe(2)
    await expect(field).toBeDisabled()
    daemon.pushFrame(answer(fake.reads[0].id, 'Dismissed interaction'))
    daemon.pushFrame(answer(fake.reads[1].id, 'Fresh opening'))
    await expect(field).toHaveValue('Fresh opening')
    expect(fake.reads).toHaveLength(2)
  } finally {
    await server.close()
  }
})

test('unrelated host traffic preserves a disconnected host name save lock and completion', async ({ launchPairedApp }) => {
  const a = hostFake(SEEDED_ROW, 'Host A prompt'), b = hostFake(SECOND_SEEDED_ROW, 'Host B prompt')
  const { app, page, servers } = await launchPairedApp(
    { buildReplyFrames: a.buildReplyFrames }, { secondServer: { buildReplyFrames: b.buildReplyFrames } })
  await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name }).click()
  const hosts = page.locator('.channel-list__host')
  servers[1].forwarder.closeClientLeg(4401)
  await expect(hosts.nth(1)).toHaveClass(/channel-list__host--failed/)
  await app.evaluate(({ ipcMain }, nameChannel) => {
    const original = (ipcMain as typeof ipcMain & {
      _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>>
    })._invokeHandlers.get(nameChannel)!
    ipcMain.removeHandler(nameChannel)
    ipcMain.handle(nameChannel, async (event, request) => {
      await new Promise<void>(resolve => ipcMain.once('test:release-disconnected-name-save', () => resolve()))
      return original(event, request)
    })
  }, HOST_LABEL_SET_CHANNEL)
  try {
    await page.locator('.channel-list__host-edit').nth(1).click()
    const dialog = page.getByRole('dialog', { name: 'Edit host', exact: true })
    const name = dialog.getByRole('textbox', { name: 'Host name:' })
    const ok = dialog.getByRole('button', { name: 'OK', exact: true })
    const unpair = dialog.getByRole('button', { name: 'Unpair host', exact: true })
    await expect(dialog.getByText('Could not read the host system prompt')).toBeVisible()
    await name.fill('Saved disconnected host name')
    await ok.click()
    await expect(name).toBeDisabled()
    const assertLocked = async () => {
      await expect(name).toBeDisabled()
      await expect(ok).toBeDisabled()
      await expect(unpair).toBeDisabled()
      await expect(dialog.getByRole('textbox', { name: 'Host system prompt:' })).toBeDisabled()
      await expect(dialog.locator('.modal__action--cancel')).toBeEnabled()
      await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeEnabled()
    }
    servers[0].daemon.pushFrame(encodeEnvelope({ id: 901, ts: TS, type: 'message', payload: {
      conversation_id: SEEDED_ROW.id, message_id: 'unrelated-host-message', role: 'user',
      text: 'Unrelated host A message'
    } }))
    // Visible receipt proves the unrelated message crossed IPC before checking the held save.
    await expect(page.locator('.bubble[data-thread-role="user"]')).toContainText('Unrelated host A message')
    await assertLocked()
    servers[0].forwarder.closeClientLeg(4401)
    await expect(hosts.nth(0)).toHaveClass(/channel-list__host--failed/)
    await assertLocked()
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-disconnected-name-save') })
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.channel-list__host-label').nth(1)).toHaveText('Saved disconnected host name')
    expect(a.reads).toHaveLength(0)
    expect(a.writes).toHaveLength(0)
    expect(b.reads).toHaveLength(0)
    expect(b.writes).toHaveLength(0)
  } finally {
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-disconnected-name-save') })
  }
})

for (const nameResult of ['stored', 'error']) {
  test(`late ${nameResult} name save cannot unlock an outstanding unpair after disconnect`, async ({ launchPairedApp }) => {
    const fake = hostFake(SEEDED_ROW, 'Stored prompt')
    const { app, page, forwarder } = await launchPairedApp({ buildReplyFrames: fake.buildReplyFrames })
    await app.evaluate(({ ipcMain }, { nameChannel, unpairChannel, nameResult }) => {
      const original = (ipcMain as typeof ipcMain & {
        _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, request: unknown) => Promise<unknown>>
      })._invokeHandlers.get(nameChannel)!
      ipcMain.removeHandler(nameChannel)
      ipcMain.handle(nameChannel, async (event, request) => {
        await new Promise<void>(resolve => ipcMain.once('test:release-name-save', () => resolve()))
        return nameResult === 'stored' ? original(event, request) : { status: 'error' }
      })
      ipcMain.removeHandler(unpairChannel)
      ipcMain.handle(unpairChannel, async () => {
        await new Promise<void>(resolve => ipcMain.once('test:release-unpair', () => resolve()))
        return { result: 'error' }
      })
    }, { nameChannel: HOST_LABEL_SET_CHANNEL, unpairChannel: UNPAIR_SERVER_CHANNEL, nameResult })
    try {
      await page.locator('.channel-list__host-edit').first().click()
      const dialog = page.getByRole('dialog', { name: 'Edit host', exact: true })
      const name = dialog.getByRole('textbox', { name: 'Host name:' })
      const prompt = dialog.getByRole('textbox', { name: 'Host system prompt:' })
      const ok = dialog.getByRole('button', { name: 'OK', exact: true })
      await expect(prompt).toHaveValue('Stored prompt')
      await name.fill('Persisted late name')
      await ok.click()
      await expect(name).toBeDisabled()
      forwarder.closeClientLeg(4404)
      await expect(dialog.getByText('Could not save the host system prompt')).toBeVisible()
      await dialog.getByRole('button', { name: 'Unpair host', exact: true }).click()
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
      const forgetting = dialog.getByRole('button', { name: 'Forgetting…', exact: true })
      await expect(forgetting).toBeDisabled()
      await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-name-save') })
      // Drain the actual invoke continuation before checking that the unpair lock survived it.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      if (nameResult === 'stored') await expect(page.locator('.channel-list__host-label').first()).toHaveText('Persisted late name')
      await expect(forgetting).toBeDisabled()
      await expect(name).toBeDisabled()
      await expect(prompt).toBeDisabled()
      await expect(ok).toBeDisabled()
      await expect(dialog.getByRole('button', { name: 'Reset to default', exact: true })).toBeDisabled()
      await expect(dialog.locator('.modal__action--cancel')).toBeEnabled()
      await app.evaluate(({ ipcMain }) => { ipcMain.emit('test:release-unpair') })
      await expect(dialog.getByText('Could not unpair this host')).toBeVisible()
      await expect(name).toBeEnabled()
      expect(fake.writes).toHaveLength(0)
    } finally {
      await app.evaluate(({ ipcMain }) => {
        ipcMain.emit('test:release-name-save')
        ipcMain.emit('test:release-unpair')
      })
    }
  })
}
