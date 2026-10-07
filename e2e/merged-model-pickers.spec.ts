import { mkdir } from 'node:fs/promises'
import { test, expect, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope, EnvelopeType, WireAgent, WireModelOption } from '../src/shared/wire/types'

const claude: WireModelOption = { value: 'sonnet', display_name: 'Published Claude', resolved_model: 'claude-sonnet-5',
  effort_levels: ['low', 'high'], supports_auto_mode: true, truncated_fields: null }
const codex: WireModelOption = { ...claude, agent: 'codex', value: 'gpt-luna', display_name: 'GPT-6 Luna',
  resolved_model: 'gpt-luna', effort_levels: ['low', 'xhigh'], supports_auto_mode: false }
const rows = [claude, { ...claude, value: 'default' }, codex]
const frame = (type: EnvelopeType, payload: unknown, in_reply_to?: number) => encodeEnvelope({
  id: 90, type, ts: '2026-10-07T12:00:00.000Z', payload, ...(in_reply_to === undefined ? {} : { in_reply_to })
})

for (const entry of ['footer', 'sheet'] as const) {
  for (const priorOwnPick of [false, true]) {
    // https://github.com/pyrycode/pyrycode-desktop/issues/1845
    const run = priorOwnPick ? test.skip : test
    run(`${priorOwnPick ? 'blocked on #1845 — prior confirmed settings mask incoming agent: ' : ''}${entry} model picks confirm both agent directions, suppress duplicates and reconcile outcomes`, async ({ launchPairedApp }) => {
      const sent: Envelope[] = []
      let agent: WireAgent = 'claude'
      let model = claude.value
      const snapshot = () => ({ session_id: 'session', model, effort: 'low', effective_effort: 'low',
        permission_mode: 'default', yolo: false, used_tokens: 0, window_tokens: 200_000 })
      const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
        const e = decodeEnvelope(bytes); sent.push(e)
        if (e.type === 'list_conversations') return [frame('conversations', { conversations: [{ ...SEEDED_ROW, agent }] })]
        if (e.type === 'request_session_settings') return [frame('session_settings', snapshot(), e.id)]
        if (e.type === 'set_session_settings') return [frame('session_settings_updated', { session_id: 'session' }, e.id)]
        return []
      } })
      await mkdir('/tmp/builder-1662', { recursive: true })
      await page.setViewportSize({ width: 1280, height: 800 })
      daemon.pushFrame(frame('model_list', { conversation_id: SEEDED_ROW.id, models: rows, dropped_models: 0 }))
      const trigger = page.locator('.composer__model')
      const status = page.locator('.composer-status__label')
      const switches = () => sent.filter(e => e.type === 'switch_agent')
      const writes = () => sent.filter(e => e.type === 'set_session_settings')
      const sheet = page.locator('.status-sheet')
      const modelRow = (row: WireModelOption) => page.locator('.run-config__model-row').filter({ hasText: row.display_name })
      const openSheet = async () => {
        if (await sheet.count()) return
        await page.locator('.conversation__overflow-trigger').click()
        await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
        await expect(page.locator('.run-config__model-row')).toHaveCount(2)
      }
      const closeSheet = async () => { if (await sheet.count()) await sheet.getByRole('button', { name: 'Close', exact: true }).click() }
      const pick = async (row: WireModelOption) => {
        if (entry === 'footer') {
          await trigger.click()
          const menu = page.getByRole('menu', { name: 'Model', exact: true })
          await expect(menu.getByRole('menuitem')).toHaveText(['Sonnet', 'GPT-6 Luna'])
          await menu.getByRole('menuitem', { name: row.agent === 'codex' ? row.display_name : 'Sonnet', exact: true }).click()
        } else { await openSheet(); await modelRow(row).click() }
      }
      const expectPermissionOffer = async (auto: boolean) => {
        await closeSheet()
        await page.locator('.composer__permission').click()
        const menu = page.getByRole('menu', { name: 'Permission mode', exact: true })
        await expect(menu.getByRole('menuitem', { name: 'Auto approval', exact: true })).toHaveCount(auto ? 1 : 0)
        await page.keyboard.press('Escape')
      }
      const dialog = (target: string) => page.getByRole('dialog', { name: `Switch to ${target}?`, exact: true })
      await expect(trigger).toHaveText('Sonnet')
      if (priorOwnPick) {
        await pick(claude)
        await expect.poll(() => writes().length).toBe(1)
        expect(writes()[0].payload).toEqual({ session_id: 'session', model: claude.value })
        await expect(page.locator('.agent-switch-overlay')).toHaveCount(0)
      }
      await closeSheet()
      await pick(codex)
      await expect(dialog('Codex')).toBeVisible()
      await expect(trigger).toHaveText('Sonnet')
      expect(switches()).toHaveLength(0)
      expect(writes()).toHaveLength(priorOwnPick ? 1 : 0)
      await dialog('Codex').getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog('Codex')).toHaveCount(0)
      await expect(trigger).toHaveText('Sonnet')
      await pick(codex)
      await page.screenshot({ path: `/tmp/builder-1662/${entry}-confirmation.png` })
      await dialog('Codex').getByRole('button', { name: 'Switch', exact: true }).evaluate(button => { button.click(); button.click() })
      await expect.poll(() => switches().length).toBe(1)
      expect(switches()[0].payload).toEqual({ conversation_id: SEEDED_ROW.id, agent: 'codex', model: codex.value, effort: 'low' })
      await expect(trigger).toHaveText('GPT-6 Luna')
      await expect(status).toHaveText('Switching to Codex…')
      await pick(codex)
      await expect(dialog('Codex')).toHaveCount(0)
      expect(switches()).toHaveLength(1)
      await expectPermissionOffer(true)
      await openSheet()
      await expect(modelRow(codex).getByRole('img', { name: 'Current model' })).toBeVisible()
      await expect(modelRow(claude).getByRole('img', { name: 'Current model' })).toHaveCount(0)
      await expect(page.locator('.run-config__effort-segment')).toHaveText(['low', 'high'])
      daemon.pushFrame(frame('error', { code: 'switch_agent.refused', message: 'PRIVATE', retryable: true }, switches()[0].id))
      await expect(trigger).toHaveText('Sonnet')
      await expect(modelRow(claude).getByRole('img', { name: 'Current model' })).toBeVisible()
      await expect(status).toHaveText('The agent did not change. Try again.')
      await closeSheet()
      await pick(codex)
      await dialog('Codex').getByRole('button', { name: 'Switch', exact: true }).click()
      await expect.poll(() => switches().length).toBe(2)
      await expect(trigger).toHaveText('GPT-6 Luna')
      // An unchanged owning list and resetting ending do not prove success.
      daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, agent }] }))
      daemon.pushFrame(frame('resetting', { conversation_id: SEEDED_ROW.id, active: false, phase: '', handoff: 'written' }))
      await expect(status).toHaveText('Switching to Codex…')
      agent = 'codex'; model = codex.value
      daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, agent }] }))
      await expect(status).toHaveCount(0)
      await closeSheet(); await openSheet()
      await expect(trigger).toHaveText('GPT-6 Luna')
      await expect(page.locator('.run-config__effort-segment')).toHaveText(['low', 'xhigh'])
      await page.screenshot({ path: `/tmp/builder-1662/${entry}-sheet-1280.png` })
      await page.setViewportSize({ width: 800, height: 600 })
      await page.screenshot({ path: `/tmp/builder-1662/${entry}-sheet-800.png` })
      await closeSheet()
      await expectPermissionOffer(false)
      await trigger.click()
      await page.screenshot({ path: `/tmp/builder-1662/${entry}-menu-800.png` })
      await page.keyboard.press('Escape')
      // The new agent's row is now a plain settings pick.
      await pick(codex)
      await expect.poll(() => writes().length).toBe(priorOwnPick ? 2 : 1)
      expect(writes()[priorOwnPick ? 1 : 0].payload).toEqual({ session_id: 'session', model: codex.value })
      await expect(dialog('Codex')).toHaveCount(0)
      await closeSheet()
      // Untagged Claude rows route the reverse direction through the same real entry point.
      await pick(claude)
      await expect(dialog('Claude')).toBeVisible()
      await dialog('Claude').getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(trigger).toHaveText('GPT-6 Luna')
      await pick(claude)
      await dialog('Claude').getByRole('button', { name: 'Switch', exact: true }).click()
      await expect.poll(() => switches().length).toBe(3)
      expect(switches()[2].payload).toEqual({ conversation_id: SEEDED_ROW.id, agent: 'claude', model: claude.value, effort: 'low' })
      await expect(trigger).toHaveText('Sonnet')
      await pick(claude)
      await expect(dialog('Claude')).toHaveCount(0)
      expect(switches()).toHaveLength(3)
      // Removal of the conversation abandons pending and restores the underlying Codex reading.
      daemon.pushFrame(frame('conversations', { conversations: [] }))
      await expect(status).toHaveCount(0)
      daemon.pushFrame(frame('conversations', { conversations: [{ ...SEEDED_ROW, agent }] }))
      await expect(trigger).toHaveText('GPT-6 Luna')
      expect(writes()).toHaveLength(priorOwnPick ? 2 : 1)
      await expect(page.locator('.conversation')).not.toContainText('PRIVATE')
    })
  }
}

for (const entry of ['footer', 'sheet'] as const) {
  for (const agent of ['claude', 'codex'] as const) {
    test(`${entry} ${agent} own-agent picks write the raw value and equal-value foreign rows confirm`, async ({ launchPairedApp }) => {
      const sent: Envelope[] = []
      // Identical raw values deliberately cannot identify an agent.
      const sameRows = [{ ...claude, value: 'shared' }, { ...codex, value: 'shared' }]
      const { page, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
        const e = decodeEnvelope(bytes); sent.push(e)
        if (e.type === 'list_conversations') return [frame('conversations', { conversations: [{ ...SEEDED_ROW, agent }] })]
        if (e.type === 'request_session_settings') return [frame('session_settings', {
          session_id: 'session', model: 'shared', effort: 'low', effective_effort: 'low', permission_mode: 'default',
          yolo: false, used_tokens: 0, window_tokens: 200_000
        }, e.id)]
        if (e.type === 'set_session_settings') return [frame('session_settings_updated', { session_id: 'session' }, e.id)]
        return []
      } })
      daemon.pushFrame(frame('model_list', { conversation_id: SEEDED_ROW.id, models: sameRows, dropped_models: 0 }))
      await expect(page.locator('.composer__model')).toHaveText(agent === 'claude' ? 'Sonnet' : 'GPT-6 Luna')
      if (entry === 'sheet') {
        await page.locator('.conversation__overflow-trigger').click()
        await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
      }
      const pick = async (target: WireAgent) => {
        if (entry === 'footer') {
          await page.locator('.composer__model').click()
          await page.getByRole('menu', { name: 'Model', exact: true }).getByRole('menuitem', {
            name: target === 'claude' ? 'Shared' : 'GPT-6 Luna', exact: true
          }).click()
        } else await page.locator('.run-config__model-row').filter({ hasText: target === 'claude' ? claude.display_name : codex.display_name }).click()
      }
      await pick(agent)
      await expect.poll(() => sent.filter(e => e.type === 'set_session_settings').length).toBe(1)
      expect(sent.find(e => e.type === 'set_session_settings')?.payload).toEqual({ session_id: 'session', model: 'shared' })
      await expect(page.locator('.agent-switch-overlay')).toHaveCount(0)
      await pick(agent === 'claude' ? 'codex' : 'claude')
      const confirmation = page.getByRole('dialog', { name: agent === 'claude' ? 'Switch to Codex?' : 'Switch to Claude?', exact: true })
      await expect(confirmation).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmation).toHaveCount(0)
      expect(sent.filter(e => e.type === 'switch_agent')).toHaveLength(0)
      expect(sent.filter(e => e.type === 'set_session_settings')).toHaveLength(1)
    })
  }
}
