import { scenarioNonce, scenarioDaemonRevision, scenarioDesktopRevision } from './fixtures/clientScenario'
import type { Page } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantMarkdown } from '../src/renderer/src/screens/conversation/AssistantMarkdown'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/clientScenario'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { confirmCreateChat } from './fixtures/confirmCreateChat'

import { watchPhaseReconnect, readPhaseReconnect } from './fixtures/phaseReconnectEvidence'
import { createThreadReplyEvidence, savedRepliesMatch, type RecordedReply } from './fixtures/threadReplyEvidence'

type ProofWindow = typeof window & { threadReplyEvidence: ReturnType<typeof createThreadReplyEvidence> }
async function savedThread(page: Page, host: string, conversation: string) {
  return page.evaluate(async ({ host, conversation }) => {
    const result = await window.pyry.chatHistory({ operation: 'readThread', serverId: host, conversationId: conversation })
    return result.status === 'stored' && result.snapshot.kind === 'daemon-items' ? result.snapshot.thread : null
  }, { host, conversation })
}
async function actualReply(page: Page): Promise<RecordedReply> {
  let reply: RecordedReply | null = null
  await expect.poll(async () => {
    reply = await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.reply())
    return reply !== null
  }, { timeout: 180_000 }).toBe(true)
  if (reply === null) throw new Error('Missing settled thread reply')
  return reply
}
async function renderedReplies(page: Page, replies: RecordedReply[], timeout = 45_000) {
  // Compare assistant body text only; markdown formatting and row chrome are not reply content.
  for (const reply of replies) await expect.poll(() => page.locator('[data-thread-role="assistant"] .bubble__markdown').evaluateAll(
    (rows, markup) => {
      const expected = new DOMParser().parseFromString(markup, 'text/html').body.textContent
      return rows.some(row => row.textContent === expected)
    }, renderToStaticMarkup(createElement(AssistantMarkdown, { text: reply.text }))
  ), { timeout }).toBe(true)
}

test.use({ interactiveRunner: 'stream-json', claudeModel: 'sonnet', requiredCapabilities: ['interactive', 'thread'] })
test('daemon-built thread streams, places an agent, reconnects, resets and reopens saved items', async ({ relay, daemon }, info) => {
  test.setTimeout(600_000)
  const daemonRevision = scenarioDaemonRevision()
  expect(daemonRevision, 'isolated test binary must identify its source revision').toMatch(/^[a-f0-9]{7,40}$/)
  const desktopRevision = scenarioDesktopRevision()
  info.annotations.push({ type: 'daemon-revision', description: daemonRevision })
  await withIsolatedElectronApp(async initial => {
    const { page } = initial
    await watchPhaseReconnect(page)
    await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: `${relay.url}/v1/client` }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: 45_000 })
    await confirmCreateChat(page)
    expect(await readPhaseReconnect(page)).toMatchObject({ interactive: true, thread: true })
    const host = daemon.pairFields.server, id = (await readPhaseReconnect(page)).conversationId
    expect(id).not.toBe('')
    await page.evaluate(createThreadReplyEvidence, { host, conversation: id, subscribe: true })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Debugger.enable')
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.pyry.sendCommand' })
    if (!result.objectId) throw new Error('Send observation unavailable')
    await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: result.objectId,
      condition: '(globalThis.threadReplyEvidence.send(arguments[0]), false)' })
    try {
      const nonce = scenarioNonce(), first = `THREAD_AGENT_${nonce}`, second = `THREAD_RESET_${nonce}`
      const composer = page.getByPlaceholder('Message…')
      await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.mark())
      await composer.fill(`Use the Agent tool to run a small background subagent task that replies READY. Wait for its result, then reply with only ${first}.`)
      await composer.press('Enter')
      await expect(page.locator('.agent-start-marker').first()).toBeVisible({ timeout: 180_000 })
      const firstReply = await actualReply(page)
      await renderedReplies(page, [firstReply])
      await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 120_000 })
      const before = await readPhaseReconnect(page)
      await page.evaluate(host => window.pyry.reconnectServer(host), daemon.pairFields.server)
      await expect.poll(async () => (await readPhaseReconnect(page)).connections, { timeout: 45_000 }).toBeGreaterThan(before.connections)
      await expect(page.locator('.agent-start-marker').first()).toBeVisible()
      expect(await page.evaluate(reply => (window as ProofWindow).threadReplyEvidence.retained(reply), firstReply)).toBe(true)
      await renderedReplies(page, [firstReply])
      const boundaries = await page.locator('.session-delimiter').count()
      await page.getByRole('button', { name: 'Actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Reset session', exact: true }).click()
      await expect(page.locator('.session-delimiter')).toHaveCount(boundaries + 1, { timeout: 120_000 })
      await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.mark())
      await composer.fill(`Reply with only ${second}. Do not use tools.`)
      await composer.press('Enter')
      const secondReply = await actualReply(page)
      expect([secondReply.epoch, secondReply.id]).not.toEqual([firstReply.epoch, firstReply.id])
      expect(secondReply.turn).not.toBe(firstReply.turn)
      const replies = [firstReply, secondReply]
      await renderedReplies(page, replies)
      await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 120_000 })
      await expect.poll(async () => savedRepliesMatch(await savedThread(page, host, id), replies)).toBe(true)
      const title = await page.evaluate(async ({ host, id }) => {
        const result = await window.pyry.chatHistory({ operation: 'readList', serverId: host })
        return result.status === 'stored' && result.snapshot.kind === 'list'
          ? result.snapshot.conversations.find(row => row.id === id)?.name : null
      }, { host: daemon.pairFields.server, id })
      expect(typeof title).toBe('string')
      const actualCapabilities = await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.capabilities())
      expect(actualCapabilities).toEqual(expect.arrayContaining(['interactive', 'thread']))
      await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.stop())
      await cdp.detach()
      const fresh = await initial.relaunch()
      // The new process has not opened any conversation: network history cannot fill this read.
      await expect(fresh.page.locator('.conversation__thread')).toHaveCount(0)
      expect(savedRepliesMatch(await savedThread(fresh.page, host, id), replies)).toBe(true)
      await fresh.page.locator('.channel-list__row-open').filter({ hasText: title ?? '' }).click()
      await renderedReplies(fresh.page, replies)
      await info.attach('thread-activation-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        daemonRevision, desktopRevision, actualCapabilities,
        scenarios: ['send/stream', 'agent placement', 'reconnect', 'session reset', 'reopen saved items']
      })) })
    } finally {
      if (!page.isClosed()) {
        await page.evaluate(() => (window as ProofWindow).threadReplyEvidence.stop())
        await cdp.detach()
      }
    }
  })
})
