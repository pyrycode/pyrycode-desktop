import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile, preview } from 'vite'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, WireModelOption } from '../src/shared/wire/types'

const OTHER = { ...SEEDED_ROW, id: 'other', name: 'Other switch channel', agent: 'codex' as const }
const picked: WireModelOption = { agent: 'codex', value: '', display_name: 'GPT-6 Luna',
  resolved_model: '', effort_levels: [], supports_auto_mode: false, truncated_fields: null }
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 90, type, ts: '2026-10-07T12:00:00.000Z', payload, ...(in_reply_to === undefined ? {} : { in_reply_to })
})

async function openingFixture() {
  // This ticket-local build exposes only the production opening function in its fixture.
  // No production test API, menu entry point or shared harness is added.
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve('electron.vite.config.ts'))
  const renderer = loaded!.config.renderer
  const outDir = await mkdtemp(join(tmpdir(), 'builder-1661-renderer-'))
  await build({ ...renderer, configFile: false, root: resolve('src/renderer'), base: './',
    plugins: [...renderer.plugins, { name: 'agent-switch-fixture', transform(code: string, id: string) {
      if (!id.endsWith('/src/renderer/src/main.tsx')) return
      return `import { openAgentSwitch } from './store/agentSwitchStore';\n${code}\nObject.assign(window, { openAgentSwitch });`
    } }], build: { ...renderer.build, outDir }, logLevel: 'silent' })
  const server = await preview({ configFile: false, root: resolve('src/renderer'), build: { outDir },
    preview: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' })
  return server
}

test('mounted agent switch dismissals, single dispatch, progress, refusal and authoritative success', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
  const server = await openingFixture()
  try {
    const sent: Envelope[] = []
    const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes); sent.push(e)
      return e.type === 'list_conversations' ? [frame('conversations', { conversations: [SEEDED_ROW] })] : []
    } }, { rendererUrl: server.resolvedUrls!.local[0] })
    const open = async (row = picked) => page.evaluate(({ id, row }) => {
      (window as unknown as { openAgentSwitch: (id: string, row: WireModelOption) => void }).openAgentSwitch(id, row)
    }, { id: SEEDED_ROW.id, row })
    const switches = () => sent.filter(e => e.type === 'switch_agent')
    const dialog = page.getByRole('dialog', { name: 'Switch to Codex?', exact: true })
    const status = page.locator('.composer-status__label')
    for (const dismissal of ['Cancel', 'Escape', 'Close dialog']) {
      await open(); await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Switch', exact: true })).toBeFocused()
      if (dismissal === 'Escape') await page.keyboard.press('Escape')
      else await dialog.getByRole('button', { name: dismissal, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      // A subsequent confirmed round trip is the positive barrier for all zero-send assertions.
      expect(switches()).toHaveLength(0)
    }
    await open()
    await expect(dialog).toContainText('This channel moves from Claude to GPT-6 Luna on Codex.')
    await mkdir('/tmp/builder-1661', { recursive: true })
    for (const [width, height] of [[1280, 800], [800, 300]]) {
      await page.setViewportSize({ width, height })
      await page.screenshot({ path: `/tmp/builder-1661/confirmation-${width}.png` })
      await expect(dialog.getByRole('button', { name: 'Switch', exact: true })).toBeInViewport()
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    // Two DOM activations in one task prove pending is recorded before the second handler.
    await dialog.getByRole('button', { name: 'Switch', exact: true }).evaluate(button => { button.click(); button.click() })
    await expect(dialog).toHaveCount(0)
    await expect(status).toHaveText('Switching to Codex…')
    await expect.poll(() => switches().length).toBe(1)
    expect(switches()[0].payload).toEqual({ conversation_id: SEEDED_ROW.id, agent: 'codex', model: '' })
    await open(); await expect(dialog).toHaveCount(0)
    for (const [phase, copy] of [
      ['wrapping_up', 'Switching to Codex: Claude is writing a hand-over note…'],
      ['restarting', 'Switching to Codex: starting Codex…']
    ]) {
      daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: true, phase, handoff: 'pending' }))
      await expect(status).toHaveText(copy)
    }
    await page.screenshot({ path: '/tmp/builder-1661/switch-progress.png' })
    daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: false, phase: '', handoff: 'written' }))
    await expect(status).toHaveText('Switching to Codex…')
    daemon.pushFrame(frame('session_transition', { conversation_id: SEEDED_ROW.id,
      previous_session_id: 'old', new_session_id: 'new', reason: 'clear',
      occurred_at: '2026-10-07T12:00:00.000Z', workspace_cwd: null }))
    await expect(page.locator('.session-delimiter__title')).toHaveText('Session reset')
    await expect(status).toHaveText('Switching to Codex…')
    daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW] }))
    daemon.pushFrame(frame('error', { code: 'switch_agent.refused', message: 'PRIVATE', retryable: true }, switches()[0].id))
    await expect(status).toHaveText('The agent did not change. Try again.')
    expect(switches()).toHaveLength(1)
    await open(); await expect(status).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Switch', exact: true }).click()
    await expect.poll(() => switches().length).toBe(2)
    daemon.pushFrame(frame('error', { code: 'switch_agent.refused', message: 'PRIVATE', retryable: false }, switches()[1].id))
    await expect(status).toHaveText('The agent did not change.')
    await open(); await dialog.getByRole('button', { name: 'Switch', exact: true }).click()
    await expect.poll(() => switches().length).toBe(3)
    // A foreign conversation's list row cannot turn the attempt into success.
    daemon.pushFrame(frame('conversations', { conversations: [SEEDED_ROW, OTHER] }))
    await expect(status).toHaveText('Switching to Codex…')
    const otherRow = page.locator('.channel-list__row-open').filter({ hasText: OTHER.name })
    await expect(page.locator('.channel-list__row-open')).toHaveCount(2)
    await otherRow.click(); await expect(status).toHaveCount(0)
    daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, agent: 'codex' }, OTHER] }))
    await page.locator('.channel-list__row-open').filter({ hasText: SEEDED_ROW.name }).click()
    await expect(status).toHaveCount(0)
    // Reverse-direction mounted copy uses Claude's existing family label rule.
    await open({ ...picked, agent: undefined, value: 'sonnet', display_name: 'Unused label' })
    const reverse = page.getByRole('dialog', { name: 'Switch to Claude?', exact: true })
    await expect(reverse).toContainText('from Codex to Sonnet on Claude. Codex writes a hand-over note first, and Claude continues from it.')
    await reverse.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(switches()).toHaveLength(3)
    await expect(page.locator('.conversation')).not.toContainText('PRIVATE')
  } finally { await server.close() }
})

test('confirmed own-agent settings yield to incoming footer and open sheet on authoritative switch', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
  const server = await openingFixture()
  try {
    const sent: Envelope[] = []
    const models: WireModelOption[] = [
      { ...picked, agent: 'claude', value: 'opus', display_name: 'Opus', effort_levels: ['high'] },
      { ...picked, agent: 'claude', value: 'sonnet', display_name: 'Sonnet', effort_levels: ['high'] },
      { ...picked, value: 'gpt-luna', effort_levels: ['low'] }
    ]
    let incoming = false
    let holdNextRead = false
    let heldRead: Envelope | undefined
    const settings = (id: number) => frame('session_settings', {
      session_id: incoming ? 'codex-session' : 'claude-session',
      model: incoming ? 'gpt-luna' : 'opus', effort: incoming ? 'low' : 'high',
      effective_effort: incoming ? 'low' : 'high', yolo: false,
      permission_mode: incoming ? 'acceptEdits' : 'default', used_tokens: 0, window_tokens: 0
    }, id)
    const { app, page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const e = decodeEnvelope(bytes); sent.push(e)
      if (e.type === 'list_conversations') return [frame('conversations', { conversations: [SEEDED_ROW] })]
      if (e.type === 'request_model_list') return [frame('model_list', {
        conversation_id: SEEDED_ROW.id, models, dropped_models: 0
      }, e.id)]
      if (e.type === 'request_session_settings') {
        if (holdNextRead) { heldRead = e; holdNextRead = false; return [] }
        return [settings(e.id)]
      }
      if (e.type === 'set_session_settings') return [frame('session_settings_updated', { session_id: 'claude-session' }, e.id)]
      return []
    } }, { rendererUrl: server.resolvedUrls!.local[0] })
    const footer = page.locator('.composer__footer')
    await expect(footer.getByRole('button', { name: 'Opus', exact: true })).toBeEnabled()
    await footer.getByRole('button', { name: 'Opus', exact: true }).click()
    await page.getByRole('menu', { name: 'Model', exact: true }).getByRole('menuitem', { name: 'Sonnet', exact: true }).click()
    await expect.poll(() => sent.filter(e => e.type === 'set_session_settings').length).toBe(1)
    expect(sent.find(e => e.type === 'set_session_settings')?.payload).toEqual({ session_id: 'claude-session', model: 'sonnet' })
    await expect(footer.getByRole('button', { name: 'Sonnet', exact: true })).toBeEnabled()
    // Hold the sheet read so the baseline also receives incoming settings through a real request.
    holdNextRead = true
    await page.locator('.conversation__overflow-trigger').click()
    await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
    await expect.poll(() => heldRead !== undefined).toBe(true)
    const sheet = page.getByRole('dialog', { name: 'Run configuration', exact: true })
    await expect(sheet.locator('.run-config__model-row').filter({ hasText: 'Sonnet' })).toContainText('Sonnet')
    await expect(sheet.locator('.run-config__model-row').filter({ hasText: 'Sonnet' }).getByRole('img', { name: 'Current model', exact: true })).toBeVisible()
    await expect(sheet.locator('.run-config__model-list')).not.toHaveAttribute('aria-busy', 'true')
    await page.evaluate(({ id, row }) => {
      (window as unknown as { openAgentSwitch: (id: string, row: WireModelOption) => void }).openAgentSwitch(id, row)
    }, { id: SEEDED_ROW.id, row: models[2] })
    await page.getByRole('dialog', { name: 'Switch to Codex?', exact: true }).getByRole('button', { name: 'Switch', exact: true }).click()
    await expect.poll(() => sent.filter(e => e.type === 'switch_agent').length).toBe(1)
    const reads = sent.filter(e => e.type === 'request_session_settings').length
    incoming = true
    daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, agent: 'codex' }] }))
    daemon.pushFrame(settings(heldRead!.id))
    await expect(footer.getByRole('button', { name: 'GPT-6 Luna', exact: true })).toBeEnabled()
    await expect.poll(() => sent.filter(e => e.type === 'request_session_settings').length).toBe(reads + 1)
    await expect(sheet.locator('.run-config__model-row').filter({ hasText: 'GPT-6 Luna' }).getByRole('img', { name: 'Current model', exact: true })).toBeVisible()
    await expect(sheet.locator('.run-config__model-row').filter({ hasText: 'Sonnet' })).toHaveCount(1)
    await expect(sheet.locator('.run-config__model-row').filter({ hasText: 'Sonnet' }).getByRole('img', { name: 'Current model', exact: true })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'low', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'high', exact: true })).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await capturePairedApp(app, page, '/tmp/builder-1845/incoming-settings-1280.png')
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect(footer.getByRole('button', { name: 'GPT-6 Luna', exact: true })).toBeEnabled()
    await capturePairedApp(app, page, '/tmp/builder-1845/incoming-footer-1280.png')
    await page.setViewportSize({ width: 800, height: 600 })
    await capturePairedApp(app, page, '/tmp/builder-1845/incoming-footer-800.png')
  } finally { await server.close() }
})
