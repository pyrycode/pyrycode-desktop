import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { type Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { daemonIdentity } from './fixtures/daemonVersion'
import type { DaemonEvent } from '../src/shared/ipc/events'
import { waitForEffortProof, type EffortEvidence, type EffortIntent, type EffortReading as Reading } from './fixtures/effortProof'

// The bootstrap turn populates the daemon's model-list fallback for never-messaged conversations.
// Observe real settings replies and acknowledgements; no store injection or optimistic-label proof.
// Use an effort-capable model: the fixture's default Haiku reports a null effort parameter.
test.use({ seedPromoted: false, claudeModel: 'opus' })
const ROUNDTRIP = 15_000
const TURN = 120_000

type ProofWindow = Window & { __effortEvidence: EffortEvidence[]; __stopEffortProof: () => void }

async function observe(page: Page) {
  const announcements: Extract<DaemonEvent, { type: 'modelAnnounced' }>[] = []
  const models: Extract<DaemonEvent, { type: 'modelList' }>[] = []
  await page.exposeFunction('recordModelProof', (event: Extract<DaemonEvent, { type: 'modelAnnounced' | 'modelList' }>) => {
    if (event.type === 'modelAnnounced') announcements.push(event)
    else models.push(event)
  })
  await page.evaluate(() => {
    const target = window as unknown as ProofWindow & {
      pyry: { onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void }
      recordModelProof: (event: Extract<DaemonEvent, { type: 'modelAnnounced' | 'modelList' }>) => Promise<void>
    }
    target.__effortEvidence = []
    target.__stopEffortProof = target.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived') {
        const { conversationId, sessionId, model, effort, effectiveEffort } = event
        target.__effortEvidence.push({ type: event.type, conversationId, sessionId, model, effort, effectiveEffort })
      } else if (event.type === 'modelAnnounced' || event.type === 'modelList') {
        void target.recordModelProof(event)
      } else if (event.type === 'sessionSettingsUpdated') {
        const { sessionId, changeId } = event
        target.__effortEvidence.push({ type: event.type, sessionId, changeId })
      } else if (event.type === 'conversationCreated') {
        target.__effortEvidence.push({ type: event.type, conversationId: event.conversation.id })
      }
    })
  })
  // Observe outbound settings without replacing or delaying the immutable preload API.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Debugger.enable')
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  await cdp.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: "(['requestSessionSettings', 'setSessionSettings'].includes(arguments[0].type) && globalThis.__effortEvidence.push(arguments[0]), false)"
  })
  const samples: { eventCount: number; footer: string }[] = []
  const snapshot = async () => {
    const value = await page.evaluate(() => ({
      events: (window as unknown as ProofWindow).__effortEvidence,
      footer: document.querySelector('.composer__effort-label')?.textContent ?? ''
    }))
    const last = samples.at(-1)
    if (last?.eventCount !== value.events.length || last.footer !== value.footer) {
      samples.push({ eventCount: value.events.length, footer: value.footer })
    }
    return value
  }
  return {
    announcements, models, snapshot, samples,
    mark: async () => (await snapshot()).events.length,
    confirmations: async () => (await snapshot()).events.filter(e => e.type === 'sessionSettingsUpdated').length,
    readingsSince: async (after: number) => {
      const events = (await snapshot()).events.slice(after)
      const created = events.filter(e => e.type === 'conversationCreated').at(-1)
      return events.filter((e): e is Extract<EffortEvidence, { type: 'runConfigReceived' }> =>
        e.type === 'runConfigReceived' && e.conversationId === created?.conversationId)
    },
    dispose: async () => {
      await page.evaluate(() => (window as unknown as ProofWindow).__stopEffortProof())
      await cdp.detach()
    }
  }
}

async function assistantCount(page: Page): Promise<number> {
  return page.locator('[data-thread-role="assistant"]').evaluateAll(els => els.filter(el => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.bubble__meta, .bubble__cursor').forEach(node => node.remove())
    return (copy.textContent ?? '').trim().length > 0
  }).length)
}

async function turn(page: Page, number: number): Promise<void> {
  const before = await assistantCount(page)
  await page.getByPlaceholder('Message…').fill(`Reply with one short word. run=${Date.now()} turn=${number}`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => assistantCount(page), { timeout: TURN }).toBeGreaterThan(before)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: TURN })
}

function showFresh(proof: Awaited<ReturnType<typeof observe>>, after: number, intent: EffortIntent = {}): Promise<Reading> {
  return waitForEffortProof(proof.snapshot, after, intent, ROUNDTRIP)
}

async function refresh(page: Page, proof: Awaited<ReturnType<typeof observe>>, intent: EffortIntent = {}): Promise<Reading> {
  const before = await proof.mark()
  await page.locator('.channel-list__row-open[aria-current="true"]').click()
  return showFresh(proof, before, intent)
}

test('applied effort, confirmed preference, restart, chat recall and channel creation choice', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(480_000)
  // Read the actual binary's revision or release version; never claim an unversioned daemon passed.
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })
  await testInfo.attach('daemon-revision', { body: Buffer.from(revision), contentType: 'text/plain' })

  await withIsolatedElectronApp(async ({ page: initialPage, relaunch }) => {
    let page = initialPage
    let proof = await observe(page)
    const attachProof = async () => testInfo.attach('effort-settings-sequence', {
      body: Buffer.from(JSON.stringify({ ...await proof.snapshot(), samples: proof.samples })), contentType: 'application/json'
    })
    try {
      await pairFromUnpairedLaunch(page, encodePairingPayload({
        server: daemon.pairFields.server, relay: `${relay.url}/v1/client`,
        token: daemon.pairFields.token, server_static_pubkey: daemon.pairFields.server_static_pubkey
      }))
      await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
      await page.locator('.channel-list__row-open').click()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
      await turn(page, 1)
      const listsBeforeRefresh = proof.models.length
      const inherited = await refresh(page, proof)
      expect(['', 'default']).toContain(inherited.model)
      expect(inherited.effort).toBe('')
      expect(inherited.effectiveEffort, 'live daemon must report applied effort after a turn').not.toBeUndefined()
      expect(inherited.effectiveEffort).not.toBeNull()
      expect(inherited.effectiveEffort).not.toBe('')
      await expect.poll(() => proof.models.slice(listsBeforeRefresh).some(event => event.conversationId === inherited.conversationId), { timeout: ROUNDTRIP }).toBe(true)
      await expect.poll(() => proof.announcements.some(event => event.conversationId === inherited.conversationId && event.model !== ''), { timeout: ROUNDTRIP }).toBe(true)
      const announced = proof.announcements.filter(event => event.conversationId === inherited.conversationId).at(-1)
      const freshModels = proof.models.slice(listsBeforeRefresh).filter(event => event.conversationId === inherited.conversationId).at(-1)
      expect(announced).toBeDefined()
      expect(freshModels).toBeDefined()
      const rows = freshModels!.models.filter(row => (row.agent ?? 'claude') === 'claude' && row.value !== 'default')
      // Independent oracle over observed wire data; no renderer decision or stores are imported.
      const family = (raw: string): string => {
        const word = /^[A-Za-z]+/.exec(raw.replace(/^claude-/, ''))?.[0] ?? ''
        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      const announcement = announced!.model
      let expectedIndex = -1
      for (const candidates of [
        rows.filter(row => row.value === announcement),
        rows.filter(row => row.resolved_model === announcement),
        rows.filter(row => family(announcement) !== '' && family(row.value) === family(announcement))
      ]) {
        if (candidates.length === 0) continue
        if (candidates.length === 1) expectedIndex = rows.indexOf(candidates[0])
        break
      }
      const markedCount = expectedIndex < 0 ? 0 : 1
      await expect(page.locator('.composer__model-label')).not.toHaveText('Default')
      await page.locator('.composer__model').click()
      const modelMenu = page.getByRole('menu', { name: 'Model', exact: true })
      await expect(modelMenu.getByRole('menuitem')).toHaveCount(rows.length)
      await expect(modelMenu.getByRole('menuitem', { name: 'Default', exact: true })).toHaveCount(0)
      await expect(modelMenu.locator('[aria-current="true"]')).toHaveCount(markedCount)
      if (expectedIndex >= 0) await expect(modelMenu.getByRole('menuitem').nth(expectedIndex)).toHaveAttribute('aria-current', 'true')
      await page.keyboard.press('Escape')
      await page.locator('.composer__effort').click()
      const effortMenu = page.getByRole('menu', { name: 'Effort', exact: true })
      await expect(effortMenu.locator('[aria-current="true"]')).toHaveText(inherited.effectiveEffort!)
      await page.keyboard.press('Escape')
      const settingsBeforeSheet = await proof.mark()
      await page.locator('.conversation__overflow-trigger').click()
      await page.getByRole('menuitem', { name: 'Run configuration', exact: true }).click()
      const sheetReading = await showFresh(proof, settingsBeforeSheet, { conversationId: inherited.conversationId })
      expect(sheetReading.conversationId).toBe(inherited.conversationId)
      expect(sheetReading.model).toBe(inherited.model)
      expect(sheetReading.effectiveEffort).toBe(inherited.effectiveEffort)
      const sheet = page.getByRole('dialog', { name: 'Run configuration', exact: true })
      await expect(sheet.locator('.run-config__model-name')).toHaveText(rows.map(row => row.display_name))
      await expect(sheet.locator('.run-config__model-list')).not.toContainText('Default')
      await expect(sheet.getByRole('img', { name: 'Current model', exact: true })).toHaveCount(markedCount)
      if (expectedIndex >= 0) await expect(sheet.locator('.run-config__model-row').nth(expectedIndex).getByRole('img', { name: 'Current model', exact: true })).toBeVisible()
      await expect(sheet.locator('.run-config__effort [aria-current="true"]')).toHaveText(sheetReading.effectiveEffort!)
      await testInfo.attach('inherited-model-selection', { body: Buffer.from(JSON.stringify({ announcement, models: freshModels, settings: sheetReading, expectedIndex })), contentType: 'application/json' })
      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBeNull()

      // Pool.mintSettings copies the bootstrap's saved effort into new sessions. Keep that seed
      // unset: choosing there would make later chats explicit already, so recall must not run.
      const beforeCreate = await proof.mark()
      await confirmCreateChat(page)
      const unset = await showFresh(proof, beforeCreate, { created: true, effort: '' })
      expect(unset.conversationId).not.toBe(inherited.conversationId)
      expect(unset.effort).toBe('')
      const originalName = 'Effort explicit chat'
      await page.locator('.channel-list__row').filter({
        has: page.locator('.channel-list__row-open[aria-current="true"]')
      }).locator('.channel-list__chat-edit').click()
      const edit = page.getByRole('dialog')
      await edit.getByRole('textbox', { name: 'Channel name:', exact: true }).fill(originalName)
      await edit.getByRole('button', { name: 'OK', exact: true }).click()
      await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(originalName)

      await page.locator('.composer__effort').click()
      const panel = page.getByRole('menu', { name: 'Effort', exact: true })
      const published = await panel.getByRole('menuitem').allTextContents()
      const pickedIndex = published.findIndex(level => level !== inherited.effectiveEffort)
      expect(pickedIndex, 'requires a supported choice different from inherited effort').toBeGreaterThanOrEqual(0)
      const picked = published[pickedIndex]
      const beforePick = await proof.mark()
      await panel.getByRole('menuitem').nth(pickedIndex).click()
      const selected = await showFresh(proof, beforePick, { conversationId: unset.conversationId, effort: picked, confirmed: true })
      expect(selected.effort).toBe(picked)
      expect(selected.effectiveEffort).toBeUndefined()
      await expect(page.locator('.composer__effort-label')).toHaveText(picked)
      await expect(page.locator('.composer__effort-label')).toHaveAttribute('title', 'Selected effort; applied effort is unavailable.')
      await page.locator('.composer__effort').click()
      await expect(panel.locator('[aria-current="true"]')).toHaveText(picked)
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-thread-role="user"]')).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(picked)
      const originalId = selected.conversationId
      await turn(page, 2)
      const running = await refresh(page, proof, { conversationId: originalId, effectiveEffort: picked })
      expect(running.effectiveEffort).toBe(picked)

      // The shared lifecycle owns both processes and preserves the isolated profile.
      await attachProof()
      await proof.dispose()
      page = (await relaunch()).page
      proof = await observe(page)
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(picked)
      const original = page.getByRole('button', { name: originalName, exact: true })
      await expect(original).toBeVisible({ timeout: 45_000 })
      const beforeRestore = await proof.mark()
      await original.click()
      const restored = await showFresh(proof, beforeRestore, { conversationId: originalId, effort: picked })
      expect(restored.conversationId).toBe(originalId)
      expect(restored.effort).toBe(picked)
      expect(await proof.confirmations()).toBe(0)

      for (const kind of ['chat', 'channel'] as const) {
        const before = await proof.mark()
        const ackBefore = await proof.confirmations()
        const expectedRecallWrites = kind === 'chat' ? 1 : 0
        if (kind === 'chat') {
          await confirmCreateChat(page)
        } else {
          await page.getByRole('button', { name: 'Create channel', exact: true }).click({ force: true })
          await page.locator('.create-channel__input').fill('Effort recall channel')
          await page.locator('.create-channel-overlay .modal__action--confirm').click()
        }
        await expect(page.locator('.bubble')).toHaveCount(0)
        await expect.poll(async () => (await proof.readingsSince(before)).length, { timeout: ROUNDTRIP }).toBeGreaterThan(0)
        const opening = (await proof.readingsSince(before))[0]
        expect(opening.conversationId).not.toBe(originalId)
        expect(opening.conversationId).not.toBe(inherited.conversationId)
        if (kind === 'chat') {
          expect(opening.effort, 'chat recall requires an empty saved choice at opening').toBe('')
        } else {
          // Compatible remembered effort travels in create_conversation, including on Default.
          // The first daemon settings read must already hold it; no recall write is needed.
          expect(opening.effort, 'channel effort must be saved at creation').toBe(picked)
          expect(['', 'default']).toContain(opening.model)
        }
        const recalled = await showFresh(proof, before, { conversationId: opening.conversationId, created: true, effort: picked, confirmed: kind === 'chat' })
        expect(recalled.conversationId).not.toBe(originalId)
        expect(recalled.effort).toBe(picked)
        expect(recalled.effectiveEffort).toBeUndefined()
        await expect(page.locator('.composer__effort-label')).toHaveText(picked)
        expect(await proof.confirmations()).toBe(ackBefore + expectedRecallWrites)
        await turn(page, kind === 'chat' ? 3 : 4)
        const applied = await refresh(page, proof, { conversationId: opening.conversationId, effort: picked, effectiveEffort: picked })
        expect(applied.effectiveEffort).toBe(picked)
        expect(applied.effort).toBe(picked)
        expect(await proof.confirmations()).toBe(ackBefore + expectedRecallWrites)
        await expect(page.locator('[data-thread-role="user"]')).not.toContainText('/effort')
      }

      // Remember a different choice on the channel, then reopen the original explicit chat.
      await page.locator('.composer__effort').click()
      const reopenedPanel = page.getByRole('menu', { name: 'Effort', exact: true })
      const levels = await reopenedPanel.getByRole('menuitem').allTextContents()
      const otherIndex = levels.findIndex(level => level !== picked)
      expect(otherIndex).toBeGreaterThanOrEqual(0)
      const beforeChange = await proof.mark()
      const ackBeforeChange = await proof.confirmations()
      const remembered = levels[otherIndex]
      await reopenedPanel.getByRole('menuitem').nth(otherIndex).click()
      await showFresh(proof, beforeChange, { effort: remembered, effectiveEffort: remembered, confirmed: true })
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(remembered)
      const beforeReopen = await proof.mark()
      // Reopen the named explicit chat independently of sidebar ordering.
      await page.getByRole('button', { name: originalName, exact: true }).click()
      const explicit = await showFresh(proof, beforeReopen, { conversationId: originalId, effort: picked })
      expect(explicit.conversationId).toBe(originalId)
      expect(explicit.effort).toBe(picked)
      await refresh(page, proof)
      expect(await proof.confirmations()).toBe(ackBeforeChange + 1)
      expect(await page.evaluate(() => localStorage.getItem('pyry.lastEffort'))).toBe(remembered)
    } finally {
      await attachProof()
      await proof.dispose()
    }
  })
})
