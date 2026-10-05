import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile } from 'vite'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, SendMessagePayload } from '../src/shared/wire/types'
import type { Page } from '@playwright/test'

const OTHER = { ...SEEDED_ROW, id: 'session-error-other', name: 'Other conversation' }
const BLOCKED = 'Claude did not pick up your last message. It was not delivered.'
const CRASHING = 'Claude keeps failing to start. Your message is waiting.'
const GENERIC = 'Claude stopped responding.'
const frame = (type: EnvelopeType, payload: unknown) => encodeEnvelope({
  id: 1, type, ts: '2026-10-05T12:00:00.000Z', payload
})
const errorFrame = (code: string, conversation_id = SEEDED_ROW.id) => frame('session_error', {
  conversation_id, code, message: 'PRIVATE DAEMON MESSAGE', extra: 'PRIVATE EXTRA'
})
const notice = (page: Page) => page.locator('.top-overlay-pill--error').filter({ hasText: 'Claude' })
const open = async (page: Page, name: string) => {
  const row = page.locator('.channel-list__row-open').filter({ hasText: name })
  await row.click()
  await expect(row).toHaveAttribute('aria-current', 'true')
}
const send = async (page: Page, text: string) => {
  await page.getByPlaceholder('Message…').fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.composer-status__label')).toHaveText('Sending…')
}

test('session errors end actual send feedback, retain the queue, replace copy and clear on accepted send or activity', async ({ launchPairedApp }) => {
  const captured: Envelope[] = []
  const { page, daemon, app } = await launchPairedApp({ buildReplyFrames: bytes => {
    const inbound = decodeEnvelope(bytes)
    captured.push(inbound)
    return inbound.type === 'list_conversations' ? [seedConversationsFrame()] : []
  } })
  await send(page, 'A held synthetic message')
  await expect(page.locator('[data-thread-role="user"]')).toHaveCount(1)
  await expect.poll(() => captured.filter(e => e.type === 'send_message').length).toBe(1)
  const payload = captured.find(e => e.type === 'send_message')?.payload as SendMessagePayload
  daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [
    { queued_msg_id: 1, text: payload.text, ts: '2026-10-05T12:00:00.000Z', message_id: payload.message_id }
  ] }))
  await expect(page.locator('.composer-status__label')).toHaveText('Waiting for Claude')
  daemon.pushFrame(errorFrame('session.child_crashing'))
  await expect(notice(page)).toHaveText(CRASHING)
  await expect(page.locator('.composer-status__label')).toHaveCount(0)
  await expect(page.locator('.composer-status__icon--spinning')).toHaveCount(0)
  await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(1)
  await expect(page.locator('[data-thread-role="queued"]')).toHaveText(payload.text)
  await expect(notice(page).getByRole('button')).toHaveCount(0)
  await expect(page.locator('.conversation')).not.toContainText('PRIVATE')
  await mkdir('/tmp/builder-1724', { recursive: true })
  for (const [width, height] of [[1280, 800], [800, 600]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height])
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
      return image.toPNG().toString('base64')
    })
    await writeFile(`/tmp/builder-1724/crashing-${width}.png`, Buffer.from(png, 'base64'))
  }
  daemon.pushFrame(errorFrame('session.blocked'))
  await expect(notice(page)).toHaveText(BLOCKED)
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'idle' }))
  // A following echo is the positive barrier for both preservation assertions.
  daemon.pushFrame(frame('message', { conversation_id: SEEDED_ROW.id, message_id: 'remote-echo',
    role: 'user', text: 'A received synthetic echo' }))
  await expect(page.locator('[data-thread-role="user"]').filter({ hasText: 'A received synthetic echo' })).toBeVisible()
  await expect(notice(page)).toHaveText(BLOCKED)
  await send(page, 'A second synthetic message')
  await expect(notice(page)).toHaveCount(0)
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'thinking' }))
  await expect(page.locator('.composer-status__label')).toHaveText('Thinking…')
  daemon.pushFrame(errorFrame('future.code'))
  await expect(notice(page)).toHaveText(GENERIC)
  await expect(page.locator('.composer-status__label')).toHaveCount(0)
  daemon.pushFrame(frame('turn_state', { conversation_id: SEEDED_ROW.id, state: 'thinking' }))
  await expect(page.locator('.composer-status__label')).toHaveText('Thinking…')
  await expect(notice(page)).toHaveCount(0)
  daemon.pushFrame(errorFrame('session.blocked'))
  await expect(notice(page)).toHaveText(BLOCKED)
  daemon.pushFrame(frame('session_transition', { conversation_id: SEEDED_ROW.id,
    previous_session_id: 'previous-session', new_session_id: 'reset-session', reason: 'clear',
    occurred_at: '2026-10-05T12:01:00.000Z', workspace_cwd: null }))
  await expect(page.locator('.session-delimiter__title')).toHaveText('Session reset')
  await expect(notice(page)).toHaveCount(0)
})

for (const strictMode of [false, true]) {
  test(`another conversation error preserves the open send window, and leaving consumes only the displayed notice${strictMode ? ' under development StrictMode' : ''}`, async ({ launchPairedApp }) => {
    let developmentRenderer: string | undefined
    if (strictMode) {
      // The normal Electron build uses production React, which never replays effects.
      // Build the real renderer separately with development React and retain app security settings.
      const loaded = await loadConfigFromFile({ command: 'build', mode: 'development' }, resolve('electron.vite.config.ts'))
      const renderer = loaded!.config.renderer
      developmentRenderer = await mkdtemp('/tmp/builder-1724-strict-mode-')
      await build({ ...renderer, configFile: false, root: resolve('src/renderer'), base: './',
        define: { ...renderer.define, 'process.env.NODE_ENV': JSON.stringify('development') },
        build: { ...renderer.build, outDir: developmentRenderer, minify: false }, logLevel: 'silent' })
      const assets = join(developmentRenderer, 'assets')
      const bundle = (await readdir(assets)).find(name => name.endsWith('.js'))!
      expect(await readFile(join(assets, bundle), 'utf8')).toContain('commitDoubleInvokeEffectsInDEV')
    }
    const developmentIndex = developmentRenderer === undefined ? undefined : join(developmentRenderer, 'index.html')
    const conversations = [SEEDED_ROW]
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const inbound = decodeEnvelope(bytes)
      return inbound.type === 'list_conversations' ? [frame('conversations', { conversations })] : []
    } }, developmentIndex === undefined ? undefined : { onLaunched: async app => {
      await app.evaluate(async ({ BrowserWindow }, path) => {
        await BrowserWindow.getAllWindows()[0].loadFile(path)
      }, developmentIndex)
    } })
    conversations.push(OTHER)
    daemon.pushFrame(frame('conversations', { conversations }))
    await expect(page.locator('.channel-list__row-open').filter({ hasText: OTHER.name ?? '' })).toBeVisible()
    await send(page, 'The open conversation remains pending')
    daemon.pushFrame(errorFrame('session.blocked', OTHER.id))
    // A later same-stream queue snapshot gives a visible barrier without ending the local window.
    daemon.pushFrame(frame('queue_state', { conversation_id: SEEDED_ROW.id, queued: [
      { queued_msg_id: 5, text: 'Another device queued item', ts: '2026-10-05T12:00:00.000Z', message_id: 'other-device' }
    ] }))
    await expect(page.locator('[data-thread-role="queued"]')).toHaveCount(1)
    await expect(page.locator('.composer-status__label')).toHaveText('Sending…')
    await expect(notice(page)).toHaveCount(0)
    await open(page, OTHER.name ?? '')
    await expect(notice(page)).toHaveText(BLOCKED)
    daemon.pushFrame(errorFrame('session.child_crashing', OTHER.id))
    await expect(notice(page)).toHaveText(CRASHING)
    await open(page, SEEDED_ROW.name ?? '')
    await expect(page.locator('.composer-status__label')).toHaveText('Sending…')
    await expect(notice(page)).toHaveCount(0)
    await open(page, OTHER.name ?? '')
    await expect(notice(page)).toHaveCount(0)
    daemon.pushFrame(errorFrame('future.code', OTHER.id))
    await expect(notice(page)).toHaveText(GENERIC)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.settings__back')).toBeVisible()
    await page.locator('.settings__back').click()
    await open(page, OTHER.name ?? '')
    await expect(notice(page)).toHaveCount(0)
  })
}
