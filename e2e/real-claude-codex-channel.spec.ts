import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { daemonIdentity } from './fixtures/daemonVersion'
import type { StampedDaemonEvent } from '../src/shared/ipc/events'
import type { ThreadItem } from '../src/shared/wire/thread'

// A real Claude turn supplies effort-capable bootstrap settings; Codex sign-in is separately linked.
test.use({ codexCapture: true, seedPromoted: false, claudeModel: 'opus' })
const ROUNDTRIP = 15_000
const TURN = 120_000
type ProofEvent = Extract<StampedDaemonEvent, { type: 'runConfigReceived' | 'modelList' |
  'sessionSettingsUpdated' | 'conversationCreated' | 'assistantDelta' | 'turnEnd' | 'threadUpdate' | 'threadReply' }>

async function observe(page: Page) {
  const events: ProofEvent[] = []
  const facts = new Map<string, { serverId: string | null; conversationId: string; item: ThreadItem }>()
  await page.exposeFunction('recordLunaProof', (event: ProofEvent) => {
    events.push(event)
    if (event.type !== 'threadUpdate' && event.type !== 'threadReply') return
    const update = event.type === 'threadUpdate' ? event.update : event.reply
    const prefix = JSON.stringify([event.serverId, event.conversationId, update.payload.epoch])
    const put = (item: ThreadItem) => {
      const key = `${prefix}:${item.id}`, held = facts.get(key)
      if (!held || held.item.rev < item.rev) facts.set(key, { serverId: event.serverId, conversationId: event.conversationId, item })
    }
    if (update.type === 'thread_item_added') put(update.payload.item)
    else if (update.type === 'thread_items') update.payload.items.forEach(put)
    else if (update.type !== 'thread_reset') {
      const held = facts.get(`${prefix}:${update.payload.item_id}`)?.item
      if (!held || held.rev !== update.payload.base_rev) return
      if (update.type === 'thread_item_changed') put({ ...held, ...update.payload.changes, rev: update.payload.rev } as ThreadItem)
      else if (held.content && typeof held.content === 'object' && 'text' in held.content && typeof held.content.text === 'string')
        put({ ...held, rev: update.payload.rev, content: { ...held.content, text: held.content.text + update.payload.text } })
    }
  })
  await page.evaluate(() => {
    const target = window as unknown as {
      pyry: { onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => () => void }
      recordLunaProof: (event: ProofEvent) => Promise<void>
      stopLunaProof: () => void
    }
    target.stopLunaProof = target.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived' || event.type === 'modelList' ||
          event.type === 'sessionSettingsUpdated' || event.type === 'conversationCreated' ||
          event.type === 'assistantDelta' || event.type === 'turnEnd' || event.type === 'threadUpdate' || event.type === 'threadReply') {
        // Test observation only; completion is awaited through the proof predicates below.
        void target.recordLunaProof(event)
      }
    })
  })
  return {
    settings: () => events.filter((e): e is Extract<ProofEvent, { type: 'runConfigReceived' }> => e.type === 'runConfigReceived'),
    models: () => events.filter((e): e is Extract<ProofEvent, { type: 'modelList' }> => e.type === 'modelList'),
    acks: () => events.filter((e): e is Extract<ProofEvent, { type: 'sessionSettingsUpdated' }> => e.type === 'sessionSettingsUpdated'),
    created: () => events.filter((e): e is Extract<ProofEvent, { type: 'conversationCreated' }> => e.type === 'conversationCreated'),
    deltas: () => [...events.filter((e): e is Extract<ProofEvent, { type: 'assistantDelta' }> => e.type === 'assistantDelta'),
      ...[...facts.values()].filter(f => f.item.kind === 'assistant_message' && f.item.parent === undefined).map(f => ({
        serverId: f.serverId, conversationId: f.conversationId, turnId: f.item.turn,
        text: typeof (f.item.content as any)?.text === 'string' ? (f.item.content as any).text as string : '' }))],
    ends: () => [...events.filter((e): e is Extract<ProofEvent, { type: 'turnEnd' }> => e.type === 'turnEnd'),
      ...[...facts.values()].filter(f => f.item.kind === 'turn_end' && f.item.parent === undefined).map(f => ({
        serverId: f.serverId, conversationId: f.conversationId, turnId: f.item.turn,
        stopReason: (f.item.content as any)?.stop_reason, isError: (f.item.content as any)?.is_error,
        outcome: (f.item.content as any)?.outcome, terminalReason: (f.item.content as any)?.terminal_reason,
        errorCategory: (f.item.content as any)?.error_category }))],
    stop: () => page.evaluate(() => (window as unknown as { stopLunaProof: () => void }).stopLunaProof())
  }
}

async function assistantCount(page: Page): Promise<number> {
  return page.locator('[data-thread-role="assistant"]').evaluateAll(els => els.filter(el => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.bubble__meta, .bubble__cursor').forEach(node => node.remove())
    return (copy.textContent ?? '').trim().length > 0
  }).length)
}

async function turn(page: Page): Promise<void> {
  const before = await assistantCount(page)
  await page.getByPlaceholder('Message…').fill(`Reply with one short word. run=${Date.now()}`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => assistantCount(page), { timeout: TURN }).toBeGreaterThan(before)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: TURN })
}

test('real GPT-6 Luna channel replies with Low effort from creation', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(360_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })
  await testInfo.attach('daemon-revision', { body: Buffer.from(revision), contentType: 'text/plain' })

  await withIsolatedElectronApp(async ({ page }) => {
    const proof = await observe(page)
    try {
      await pairFromUnpairedLaunch(page, encodePairingPayload({
        ...daemon.pairFields, relay: `${relay.url}/v1/client`
      }))
      const seedRow = page.locator('.channel-list__row-open')
      await expect(seedRow).toBeVisible({ timeout: 45_000 })
      await seedRow.click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
      await expect.poll(() => proof.settings().length, { timeout: ROUNDTRIP }).toBeGreaterThan(0)
      await turn(page)
      const beforeRefresh = proof.settings().length
      await seedRow.click()
      await expect.poll(() => proof.settings().length, { timeout: ROUNDTRIP }).toBeGreaterThan(beforeRefresh)
      const seed = proof.settings().at(-1)!
      expect(seed.serverId).toBe(daemon.pairFields.server)

      // Select Low on the seeded Claude session and require both acknowledgement and read-back.
      const ackBefore = proof.acks().length
      const settingsBefore = proof.settings().length
      await page.locator('.composer__effort').click()
      const low = page.getByRole('menu', { name: 'Effort', exact: true })
        .getByRole('menuitem', { name: /^low$/i })
      const lowValue = (await low.innerText()).trim()
      await low.click()
      await expect.poll(() => proof.acks().slice(ackBefore).some(e =>
        e.serverId === seed.serverId && e.sessionId === seed.sessionId), { timeout: ROUNDTRIP }).toBe(true)
      await expect.poll(() => proof.settings().slice(settingsBefore).some(e =>
        e.serverId === seed.serverId && e.conversationId === seed.conversationId &&
        e.effort === lowValue), { timeout: ROUNDTRIP }).toBe(true)
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(lowValue)

      // The daemon reads Codex families asynchronously. Reopen through the app to ask for fresh lists.
      let published: ReturnType<typeof proof.models>[number] | undefined
      await expect(async () => {
        const before = proof.models().length
        await seedRow.click()
        await expect.poll(() => proof.models().slice(before).some(e =>
          e.serverId === seed.serverId && e.conversationId === seed.conversationId),
        { timeout: ROUNDTRIP }).toBe(true)
        published = proof.models().slice(before).filter(e =>
          e.serverId === seed.serverId && e.conversationId === seed.conversationId).at(-1)
        expect(published?.models.some(row => row.agent === 'codex' &&
          row.display_name === 'GPT-6 Luna')).toBe(true)
      }).toPass({ timeout: 60_000, intervals: [500, 1000] })
      const luna = published!.models.find(row => row.agent === 'codex' && row.display_name === 'GPT-6 Luna')!
      expect(luna.value).not.toBe('default')
      expect(luna.effort_levels).toContain(lowValue)
      await testInfo.attach('published-model-row', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ serverId: published!.serverId,
          conversationId: published!.conversationId, model: luna, models: published!.models })) })

      const createdBefore = proof.created().length
      const readsBeforeCreate = proof.settings().length
      const acksBeforeCreate = proof.acks().length
      const name = `Luna live ${Date.now()}`
      await page.getByRole('button', { name: 'Create channel', exact: true }).click({ force: true })
      const dialog = page.getByRole('dialog', { name: 'Create channel', exact: true })
      await dialog.getByRole('textbox', { name: 'Channel name:', exact: true }).fill(name)
      await dialog.locator('.create-channel__model').click()
      await page.getByRole('menu', { name: 'Model', exact: true })
        .getByRole('menuitem', { name: luna.display_name, exact: true }).click()
      await dialog.getByRole('button', { name: 'OK', exact: true }).click()
      await expect(dialog).toHaveCount(0, { timeout: ROUNDTRIP })
      await expect.poll(() => proof.created().length, { timeout: ROUNDTRIP }).toBe(createdBefore + 1)
      const created = proof.created().at(-1)!
      expect(created.serverId).toBe(seed.serverId)
      expect(created.conversation.agent).toBe('codex')
      expect(created.conversation.is_promoted).toBe(true)
      const channelId = created.conversation.id
      expect(channelId).not.toBe(seed.conversationId)
      await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(name)
      const firstSettings = () => proof.settings().slice(readsBeforeCreate).find(e =>
        e.serverId === seed.serverId && e.conversationId === channelId)
      await expect.poll(() => firstSettings() !== undefined, { timeout: ROUNDTRIP }).toBe(true)
      expect(firstSettings()!.model).toBe(luna.value)
      expect(firstSettings()!.effort).toBe(lowValue)
      const footer = page.locator('.composer__model-label')
      await expect(footer).toHaveText(luna.display_name)
      await expect(footer).not.toHaveText('Default')
      await expect(page.locator('[data-thread-role="user"]')).toHaveCount(0)
      await expect(page.locator('[data-thread-role="assistant"]')).toHaveCount(0)

      await turn(page)
      await expect.poll(() => proof.ends().some(end => end.serverId === seed.serverId &&
        end.conversationId === channelId && end.stopReason === 'end_turn' && end.isError !== true &&
        (!end.outcome || end.outcome === 'success') && (!end.terminalReason || end.terminalReason === 'completed') &&
        !end.errorCategory && proof.deltas().some(delta => delta.serverId === seed.serverId &&
          delta.conversationId === channelId && delta.turnId === end.turnId && delta.text.trim().length > 0)),
      { timeout: TURN }).toBe(true)
      await expect(footer).toHaveText(luna.display_name)
      await expect(footer).not.toHaveText('Default')
      expect(proof.acks().length).toBe(acksBeforeCreate)
    } finally { await proof.stop() }
  })
})
