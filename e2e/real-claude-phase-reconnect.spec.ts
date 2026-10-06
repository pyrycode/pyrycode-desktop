import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test, expect, encodePairingPayload } from './fixtures/realDaemon'
import { confirmCreateChat } from './fixtures/confirmCreateChat'
import { pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { daemonIdentity } from './fixtures/daemonVersion'
import { watchPhaseReconnect, readPhaseReconnect, stopPhaseReconnect, hasRunningPhaseLabel } from './fixtures/phaseReconnectEvidence'

// Dispatcher-owned live acceptance: PYRY_BIN must contain pyrycode#2718,
// 25b532b6205507784a7615fe59d3c5a7bb2f5484. An all-skipped run is not acceptance.
// No production phase fix accompanies this baseline; annotations record the original behavior.
test.use({ interactiveRunner: 'stream-json' })
const TURN_TIMEOUT = 120_000
const RECONNECT_TIMEOUT = 45_000

/** Only the app dials this proxy; the daemon keeps its original routing-relay connection.
 * Opaque TCP pipes: no header/frame/token inspection, logging or application-message injection. */
async function clientProxy(relayUrl: string) {
  const target = new URL(relayUrl)
  const sockets = new Set<Socket>()
  const server = createServer(client => {
    const upstream = connect({ host: target.hostname, port: Number(target.port) })
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    }
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
    client.pipe(upstream).pipe(client)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('client proxy did not bind TCP')
  const drop = () => { for (const socket of sockets) socket.destroy() }
  return {
    url: `ws://127.0.0.1:${address.port}/v1/client`, drop,
    close: async () => {
      drop()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

test('real claude restores the status after reconnect during the same running turn', async ({
  relay, daemon, page
}, testInfo) => {
  test.setTimeout(300_000)
  const { stdout } = await promisify(execFile)(process.env.PYRY_BIN || 'pyry', ['version'], { timeout: 10_000 })
  const revision = daemonIdentity(stdout)
  testInfo.annotations.push({ type: 'daemon-revision', description: revision })
  const proxy = await clientProxy(relay.url)
  const nonce = Date.now()
  const entered = join(daemon.workdir, `phase-reconnect-entered-${nonce}`)
  const release = join(daemon.workdir, `phase-reconnect-release-${nonce}`)
  try {
    await watchPhaseReconnect(page)
    await pairFromUnpairedLaunch(page, encodePairingPayload({ ...daemon.pairFields, relay: proxy.url }))
    await expect(page.locator('.channel-list__row-open')).toBeVisible({ timeout: RECONNECT_TIMEOUT })
    await confirmCreateChat(page)
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await expect.poll(async () => (await readPhaseReconnect(page)).conversationId.length).toBeGreaterThan(0)
    await page.getByPlaceholder('Message…').fill(
      'Use Bash to run this exact command in the foreground, never in the background: ' +
      `\`touch "${entered}"; until [ -f "${release}" ]; do sleep 0.2; done\`. ` +
      'Do not create the release file yourself. After the command finishes, reply briefly.'
    )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    // A real tool has STARTED, rather than only an optimistic local-send window being visible.
    await expect.poll(() => existsSync(entered), { timeout: TURN_TIMEOUT }).toBe(true)
    await expect.poll(async () => (await readPhaseReconnect(page)).turnIds.length).toBe(1)
    // The held foreground tool names Bash and may append elapsed time. Recognize its existing
    // presentation as well as the generic phase copy, returning no daemon text to the test process.
    const hasRunningLabel = () => page.locator('.composer-status__label').evaluateAll(hasRunningPhaseLabel)
    await expect.poll(hasRunningLabel).toBe(true)
    const before = await readPhaseReconnect(page)
    const current = before.phases.filter(phase => phase.conversationId === before.conversationId).at(-1)
    expect(current?.state === 'thinking' || current?.state === 'responding').toBe(true)
    testInfo.annotations.push({ type: 'baseline-before-drop', description: `running phase: ${current?.state}` })
    expect(before.endedTurnIds).toEqual([])
    expect(existsSync(release)).toBe(false)
    const heldUserRows = await page.locator('[data-thread-role="user"]').count()
    expect(heldUserRows).toBe(1)

    proxy.drop()
    await expect.poll(async () => (await readPhaseReconnect(page)).connections,
      { timeout: RECONNECT_TIMEOUT }).toBe(before.connections + 1)
    // Observe a NEW attributed running-phase delivery after the new connected edge. Old copy,
    // replayed content alone or a new turn cannot satisfy this gate.
    await expect.poll(async () => {
      const now = await readPhaseReconnect(page)
      return now.phases.slice(before.phases.length).some(phase =>
        phase.connection === before.connections + 1 && phase.conversationId === before.conversationId &&
        phase.state === current?.state)
    }, { timeout: RECONNECT_TIMEOUT }).toBe(true)
    const restored = await readPhaseReconnect(page)
    await expect.poll(hasRunningLabel).toBe(true)
    expect(restored.turnIds).toEqual(before.turnIds)
    expect(restored.endedTurnIds).toEqual([])
    expect(existsSync(release)).toBe(false)
    await expect(page.locator('[data-thread-role="user"]')).toHaveCount(heldUserRows)
    testInfo.annotations.push({ type: 'baseline', description: 'unchanged desktop restored the phase during the original running turn' })
    await testInfo.attach('phase-reconnect-baseline', {
      body: Buffer.from(JSON.stringify({ daemonRevision: revision, phase: current?.state, restored: true,
        connectionsBefore: before.connections, connectionsAfter: restored.connections,
        originalTurnStillRunning: true })), contentType: 'application/json'
    })

    await writeFile(release, '')
    await expect.poll(async () => (await readPhaseReconnect(page)).endedTurnIds,
      { timeout: TURN_TIMEOUT }).toEqual(before.turnIds)
    await expect(page.locator('.composer-status__label')).toHaveCount(0, { timeout: TURN_TIMEOUT })
  } finally {
    // Release even on a failed assertion; the real fixture then reaps the entire child process group.
    try { await writeFile(release, '') } finally {
      try { await stopPhaseReconnect(page) } finally { await proxy.close() }
    }
  }
})
