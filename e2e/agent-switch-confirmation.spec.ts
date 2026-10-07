import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile, preview } from 'vite'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, WireModelOption } from '../src/shared/wire/types'

const OTHER = { ...SEEDED_ROW, id: 'other', name: 'Other switch channel', agent: 'codex' as const }
const picked: WireModelOption = { agent: 'codex', value: '', display_name: 'GPT-6 Luna',
  resolved_model: '', effort_levels: [], supports_auto_mode: false, truncated_fields: null }
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 90, type, ts: '2026-10-07T12:00:00.000Z', payload, ...(in_reply_to === undefined ? {} : { in_reply_to })
})

test('mounted agent switch dismissals, single dispatch, progress, refusal and authoritative success', async ({ launchPairedApp }) => {
  test.setTimeout(120_000)
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
