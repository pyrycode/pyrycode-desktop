import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { daemonIdentity } from './fixtures/daemonVersion'
import { waitForEffortProof } from './fixtures/effortProof'
import type { EffortEvidence } from './fixtures/effortProof'
import type { StampedDaemonEvent } from '../src/shared/ipc/events'
import type { RendererCommand } from '../src/shared/ipc/commands'
import { completedHandoverReply } from './fixtures/lunaHandoverProof'

test.use({ codexCapture: true, seedPromoted: true, claudeModel: 'opus' })
const ROUNDTRIP = 15_000
const TURN = 120_000
type ProofEvent = Extract<StampedDaemonEvent, { type: 'runConfigReceived' | 'modelList' |
  'sessionSettingsUpdated' | 'conversationsReceived' | 'conversationCreated' | 'assistantDelta' | 'turnEnd' |
  'threadUpdate' | 'threadReply' }>
type ProofCommand = Extract<RendererCommand, { type: 'requestSessionSettings' | 'setSessionSettings' | 'switchAgent' }>
type ProofWindow = Window & {
  __handoverEvents: (ProofEvent | ProofCommand)[]
  __stopHandoverProof: () => void
}

async function observe(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as ProofWindow & {
      pyry: { onDaemonEvent: (listener: (event: StampedDaemonEvent) => void) => () => void }
    }
    target.__handoverEvents = []
    target.__stopHandoverProof = target.pyry.onDaemonEvent(event => {
      if (event.type === 'runConfigReceived' || event.type === 'modelList' ||
          event.type === 'sessionSettingsUpdated' || event.type === 'conversationsReceived' ||
          event.type === 'conversationCreated' || event.type === 'assistantDelta' || event.type === 'turnEnd' ||
          event.type === 'threadUpdate' || event.type === 'threadReply') {
        target.__handoverEvents.push(event)
      }
    })
  })
  // Observe existing UI dispatch without replacing the immutable preload bridge.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Debugger.enable')
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
  if (result.objectId === undefined) throw new Error('Missing command observation target')
  await cdp.send('Debugger.setBreakpointOnFunctionCall', {
    objectId: result.objectId,
    condition: "(['requestSessionSettings', 'setSessionSettings', 'switchAgent'].includes(arguments[0].type) && globalThis.__handoverEvents.push(arguments[0]), false)"
  })
  const snapshot = () => page.evaluate(() => ({
    events: (window as unknown as ProofWindow).__handoverEvents,
    footer: document.querySelector('.composer__effort-label')?.textContent ?? '',
    modelFooter: document.querySelector('.composer__model-label')?.textContent ?? ''
  }))
  const effortSnapshot = async () => {
    const { events, footer } = await snapshot()
    return { footer, events: events.filter((event): event is EffortEvidence & (ProofEvent | ProofCommand) =>
      event.type === 'requestSessionSettings' || event.type === 'setSessionSettings' ||
      event.type === 'sessionSettingsUpdated' || event.type === 'runConfigReceived') }
  }
  return {
    snapshot, effortSnapshot,
    mark: async () => (await snapshot()).events.length,
    stop: async () => {
      await page.evaluate(() => (window as unknown as ProofWindow).__stopHandoverProof())
      await cdp.detach()
    }
  }
}

async function completedReply(page: Page, proof: Awaited<ReturnType<typeof observe>>,
  serverId: string, conversationId: string, agent: 'claude' | 'codex', prompt: string) {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: TURN })
  const assistantRows = page.locator('[data-thread-role="assistant"]')
  const before = await assistantRows.count()
  const beforeSend = (await proof.snapshot()).events
  const settings = beforeSend.findLast(event => event.type === 'runConfigReceived' &&
    event.serverId === serverId && event.conversationId === conversationId)
  if (settings?.type !== 'runConfigReceived' || !settings.sessionId) throw new Error('Missing owning-session settings')
  const owner = { serverId, conversationId, sessionId: settings.sessionId, agent }
  const after = beforeSend.length
  await page.getByPlaceholder('Message…').fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  let reply: ReturnType<typeof completedHandoverReply>
  await expect.poll(async () => {
    reply = completedHandoverReply((await proof.snapshot()).events, after, owner)
    return reply !== undefined
  }, { timeout: TURN }).toBe(true)
  await expect.poll(() => assistantRows.count(), { timeout: TURN }).toBeGreaterThan(before)
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: TURN })
  if (!reply) throw new Error('Missing completed owning-session reply')
  return { ...reply, owner, after }
}

test('real Claude conversation hands over to GPT-6 Luna at Low effort and Luna answers with the pre-switch fact', async ({ relay, daemon }, testInfo) => {
  test.setTimeout(420_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })
  await testInfo.attach('daemon-revision', { body: Buffer.from(revision), contentType: 'text/plain' })
  const token = `code-${randomUUID()}`

  await withIsolatedElectronApp(async ({ page }) => {
    const proof = await observe(page)
    try {
      await pairFromUnpairedLaunch(page, encodePairingPayload({
        ...daemon.pairFields, relay: `${relay.url}/v1/client`
      }))
      const row = page.locator('.channel-list__row-open')
      await expect(row).toBeVisible({ timeout: 45_000 })
      await row.click()
      await expect.poll(async () => (await proof.snapshot()).events.some(event =>
        event.type === 'runConfigReceived' && event.serverId === daemon.pairFields.server),
      { timeout: ROUNDTRIP }).toBe(true)
      const initial = (await proof.snapshot()).events.findLast(event =>
        event.type === 'runConfigReceived' && event.serverId === daemon.pairFields.server)!
      expect(initial.type).toBe('runConfigReceived')
      if (initial.type !== 'runConfigReceived') throw new Error('Missing initial run configuration')
      const { conversationId } = initial
      const serverId = daemon.pairFields.server
      const outgoing = (await proof.snapshot()).events.findLast(event =>
        event.type === 'conversationsReceived' && event.serverId === serverId)
      expect(outgoing?.type).toBe('conversationsReceived')
      if (outgoing?.type !== 'conversationsReceived') throw new Error('Missing owning-host conversation list')
      const claudeConversation = outgoing.conversations.find(conversation => conversation.id === conversationId)
      expect(claudeConversation).toBeDefined()
      expect(claudeConversation?.agent ?? 'claude').toBe('claude')

      const claudeReply = await completedReply(page, proof, serverId, conversationId, 'claude',
        `Remember the code word ${token} for this conversation. Reply only with that code word.`)
      expect(claudeReply.text).toContain(token)
      await expect(page.locator('[data-thread-role="assistant"]').last()).toContainText(token)
      const beforeRefresh = await proof.mark()
      await row.click()
      await expect.poll(async () => (await proof.snapshot()).events.slice(beforeRefresh).some(event =>
        event.type === 'runConfigReceived' && event.serverId === serverId &&
        event.conversationId === conversationId && typeof event.effectiveEffort === 'string'),
      { timeout: ROUNDTRIP }).toBe(true)

      // Applied Low on Claude is what the existing confirmation forwards when Luna supports it.
      const beforeLow = (await proof.effortSnapshot()).events.length
      await page.locator('.composer__effort').click()
      await page.getByRole('menu', { name: 'Effort', exact: true })
        .getByRole('menuitem', { name: /^low$/i }).click()
      await waitForEffortProof(proof.effortSnapshot, beforeLow,
        { conversationId, effort: 'low', effectiveEffort: 'low', confirmed: true }, ROUNDTRIP)

      // Codex publishes asynchronously; reopen the same conversation to request fresh lists.
      let published: Extract<ProofEvent, { type: 'modelList' }> | undefined
      await expect(async () => {
        const before = await proof.mark()
        await row.click()
        await expect.poll(async () => {
          published = (await proof.snapshot()).events.slice(before).filter(
            (event): event is Extract<ProofEvent, { type: 'modelList' }> =>
              event.type === 'modelList' && event.serverId === serverId && event.conversationId === conversationId).at(-1)
          return published?.models.some(model => model.agent === 'codex' && model.display_name === 'GPT-6 Luna') === true
        }, { timeout: ROUNDTRIP }).toBe(true)
      }).toPass({ timeout: 60_000, intervals: [500, 1000] })
      const luna = published!.models.find(model => model.agent === 'codex' && model.display_name === 'GPT-6 Luna')!
      expect(luna.value).not.toBe('default')
      expect(luna.effort_levels).toContain('low')
      await testInfo.attach('published-model-row', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ serverId, conversationId, model: luna, models: published!.models })) })

      await page.locator('.composer__model').click()
      await page.getByRole('menu', { name: 'Model', exact: true })
        .getByRole('menuitem', { name: luna.display_name, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Switch to Codex?', exact: true })
      await expect(dialog).toBeVisible()
      const beforeSwitch = await proof.mark()
      await dialog.getByRole('button', { name: 'Switch', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await proof.snapshot()).events.slice(beforeSwitch).some(event =>
        event.type === 'conversationsReceived' && event.serverId === serverId &&
        event.conversations.some(conversation => conversation.id === conversationId && conversation.agent === 'codex')),
      { timeout: TURN }).toBe(true)
      await expect.poll(async () => (await proof.snapshot()).events.slice(beforeSwitch).some(event =>
        event.type === 'runConfigReceived' && event.serverId === serverId &&
        event.conversationId === conversationId && event.model === luna.value && event.effort === 'low'),
      { timeout: ROUNDTRIP }).toBe(true)
      const footer = page.locator('.composer__model-label')
      await expect(footer).toHaveText(luna.display_name)
      await expect(footer).not.toHaveText('Default')

      // Do not restate the token: only the transferred conversation can supply this answer.
      const lunaReply = await completedReply(page, proof, serverId, conversationId, 'codex',
        'What is the code word I asked you to remember earlier in this conversation? Reply only with the code word.')
      expect(lunaReply.text).toContain(token)
      await expect(page.locator('[data-thread-role="assistant"]').last()).toContainText(token)
      const beforeReadback = (await proof.effortSnapshot()).events.length
      await row.click()
      const settings = await waitForEffortProof(proof.effortSnapshot, beforeReadback,
        { conversationId, effort: 'low', effectiveEffort: 'low' }, ROUNDTRIP)
      expect(settings.model).toBe(luna.value)
      await expect(footer).toHaveText(luna.display_name)
      await expect(footer).not.toHaveText('Default')
      const events = (await proof.snapshot()).events
      expect(events.filter(event => event.type === 'switchAgent')).toEqual([{
        type: 'switchAgent', payload: { conversation_id: conversationId, agent: 'codex', model: luna.value, effort: 'low' }
      }])
      expect(events.filter(event => event.type === 'conversationCreated')).toHaveLength(0)
      await testInfo.attach('handover-answer', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ serverId, conversationId, token, claudeReply, lunaReply,
          footer: await footer.innerText(), settings })) })
    } finally {
      // Same-attempt evidence survives a failed turn/answer/settings assertion; it establishes no PASS by itself.
      try {
        const attempt = await proof.snapshot()
        await testInfo.attach('handover-attempt', { contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ revision, token, ...attempt })) })
      } finally { await proof.stop() }
    }
  })
})
