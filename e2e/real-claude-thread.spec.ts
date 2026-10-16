import { scenarioNonce, scenarioDaemonRevision, scenarioDesktopRevision, scenarioInput, liveProof, scenarioEffect, scenarioMode } from './fixtures/clientScenario'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/clientScenario'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { daemonIdentity } from './fixtures/daemonVersion'
import { watchPhaseReconnect, readPhaseReconnect } from './fixtures/phaseReconnectEvidence'

// Credentialed execution and revision/count artifacts belong to the dispatcher's live gate.
test.use({ interactiveRunner: 'stream-json', claudeModel: 'sonnet', requiredCapabilities: ['interactive', 'thread'] })
test('daemon-built thread streams, places an agent, reconnects, resets and reopens saved items', async ({ relay, daemon }, info) => {
  test.setTimeout(600_000)
  const run = promisify(execFile)
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
    const nonce = scenarioNonce(), first = `THREAD_AGENT_${nonce}`, second = `THREAD_RESET_${nonce}`
    const composer = page.getByPlaceholder('Message…')
    await composer.fill(`Use the Agent tool to run a small background subagent task that replies READY. Wait for its result, then reply with only ${first}.`)
    await composer.press('Enter')
    await expect(page.locator('.agent-start-marker').first()).toBeVisible({ timeout: 180_000 })
    await expect.poll(() => page.locator('[data-thread-role="assistant"]').evaluateAll((rows, marker) =>
      rows.some(row => row.textContent?.includes(marker)), first), { timeout: 180_000 }).toBe(true)
    await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 120_000 })
    const before = await readPhaseReconnect(page)
    await page.evaluate(host => window.pyry.reconnectServer(host), daemon.pairFields.server)
    await expect.poll(async () => (await readPhaseReconnect(page)).connections, { timeout: 45_000 }).toBeGreaterThan(before.connections)
    await expect(page.locator('.agent-start-marker').first()).toBeVisible()
    const boundaries = await page.locator('.session-delimiter').count()
    await page.getByRole('button', { name: 'Actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Reset session', exact: true }).click()
    await expect(page.locator('.session-delimiter')).toHaveCount(boundaries + 1, { timeout: 120_000 })
    await composer.fill(`Reply with only ${second}. Do not use tools.`)
    await composer.press('Enter')
    await expect.poll(() => page.locator('[data-thread-role="assistant"]').evaluateAll((rows, marker) =>
      rows.some(row => row.textContent?.includes(marker)), second), { timeout: 180_000 }).toBe(true)
    await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 120_000 })
    const id = before.conversationId
    const title = await page.evaluate(async ({ host, id }) => {
      const result = await window.pyry.chatHistory({ operation: 'readList', serverId: host })
      return result.status === 'stored' && result.snapshot.kind === 'list'
        ? result.snapshot.conversations.find(row => row.id === id)?.name : null
    }, { host: daemon.pairFields.server, id })
    expect(typeof title).toBe('string')
    const fresh = await initial.relaunch()
    await fresh.page.locator('.channel-list__row-open').filter({ hasText: title ?? '' }).click()
    await expect.poll(() => fresh.page.locator('[data-thread-role="assistant"]').evaluateAll((rows, marker) =>
      rows.some(row => row.textContent?.includes(marker)), second), { timeout: 45_000 }).toBe(true)
    await info.attach('thread-activation-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      daemonRevision, desktopRevision, actualCapabilities: ['interactive', 'thread'],
      scenarios: ['send/stream', 'agent placement', 'reconnect', 'session reset', 'reopen saved items']
    })) })
  })
})
