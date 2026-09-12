import type { ElectronApplication, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, encodePairingPayload, withIsolatedElectronApp } from './fixtures/realDaemon'
import { pairAnotherServerFromSettings, pairFromUnpairedLaunch } from './fixtures/pairingArrival'
import { startFakeDaemon } from '../src/main/transport/fakeDaemon'
import { startFakeRelayForwarder } from '../src/main/transport/fakeRelayForwarder'
import { encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import { TEST_SECRET_BACKEND_ENV_FLAG } from '../src/main/secretBackend'
import { PAIRED_SERVER_NAME } from '../src/main/pairedServerStore'
import { DEVICE_STATIC_KEY_NAME } from '../src/main/deviceKeypair'
import { HOST_LABEL_NAME } from '../src/main/hostLabelStore'

// Dispatcher-owned live proof. No Claude turn or Claude credential is needed.
// No traces, screenshots, video, plaintext snapshots or raw daemon logs: a pairing
// code is present during the UI drive. Assertion output contains only fixed codes
// and booleans. The secondary peer is synthetic and proves isolation, not redemption.
test.use({ spawnClaude: false, screenshot: 'off', trace: 'off', video: 'off' })

const SECOND_HOST = 'restart-secondary'
const HANDSHAKE_TIMEOUT = 45_000
const SECRET_NAMES = [PAIRED_SERVER_NAME, DEVICE_STATIC_KEY_NAME, HOST_LABEL_NAME]

async function observeStatus(app: ElectronApplication, page: Page, serverIds: string[]) {
  await app.evaluate(({ app, BrowserWindow }, { channel, serverIds }) => {
    const statuses = new Map<string, {
      type: string; code: string | null; lastFailure: string | null; authentications: number
    }>()
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const send = contents.send.bind(contents)
    contents.send = (sentChannel, ...args) => {
      const event: unknown = args[0]
      if (sentChannel === channel && typeof event === 'object' && event !== null &&
          'serverId' in event && typeof event.serverId === 'string' &&
          serverIds.includes(event.serverId) && 'type' in event) {
        const type = event.type
        if (type === 'connected' || type === 'connecting' || type === 'disconnected' || type === 'failed') {
          let code: string | null = null
          if (type === 'failed') {
            const error = 'error' in event ? event.error : null
            const rawCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
            // Daemon-authored error strings never escape the main process here.
            code = typeof rawCode === 'string' && [
              'auth.invalid_token', 'auth.device_revoked', 'pairing-rejected',
              'connect-failed', 'handshake-timeout', 'handshake-read-failed',
              'malformed-hello-ack', 'not-paired', 'socket-closed'
            ].includes(rawCode) ? rawCode : 'other-failure'
          }
          statuses.set(event.serverId, {
            type, code,
            lastFailure: code ?? statuses.get(event.serverId)?.lastFailure ?? null,
            authentications: (statuses.get(event.serverId)?.authentications ?? 0) + (type === 'connected' ? 1 : 0)
          })
        }
      }
      send(sentChannel, ...args)
    }
    Object.assign(app, { restartStatusObserver: {
      read: () => serverIds.map(id => statuses.get(id) ?? {
        type: 'unobserved', code: null, lastFailure: null, authentications: 0
      }),
      dispose: () => { contents.send = send }
    } })
  }, { channel: DAEMON_EVENT_CHANNEL, serverIds })
  // Launch may authenticate before Playwright attaches. Replay comes from THIS
  // process's initially empty createLiveWindow cache, never persisted renderer data.
  // Process exit and new PID checks below make this a fresh-authentication proof.
  await page.reload()
  // Keep observation in the main process and read through the application evaluator.
  // Pairing can temporarily invalidate the inspector context on Electron 33.
  return {
    read: async () => {
      try {
        return await app.evaluate(({ app }) =>
          (app as typeof app & { restartStatusObserver: { read(): Array<{
            type: string; code: string | null; lastFailure: string | null; authentications: number
          }> } }).restartStatusObserver.read())
      } catch (error) {
        // Inspector context replacement is not authentication evidence. Keep polling
        // within the caller's deadline; all other errors must fail the test.
        if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error
        return serverIds.map(() => ({
          type: 'inspection-unavailable', code: null, lastFailure: null, authentications: 0
        }))
      }
    },
    dispose: () => app.evaluate(({ app }) => {
      const observed = app as typeof app & { restartStatusObserver?: { dispose(): void } }
      observed.restartStatusObserver?.dispose()
      delete observed.restartStatusObserver
    })
  }
}

type StatusObserver = Awaited<ReturnType<typeof observeStatus>>

async function expectAuthenticated(observer: StatusObserver, host: number, stage: string) {
  await expect.poll(async () => {
    const state = (await observer.read())[host]
    return { type: state.type, code: state.type === 'connected' ? null : state.code ?? state.lastFailure }
  }, { message: stage, timeout: HANDSHAKE_TIMEOUT }).toEqual({ type: 'connected', code: null })
}

async function expectOsEncryption(app: ElectronApplication) {
  const backend = await app.evaluate(({ safeStorage }, flag) => ({
    testBackendSelected: process.env[flag] === '1',
    encryptionAvailable: safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  }), TEST_SECRET_BACKEND_ENV_FLAG)
  expect(backend, 'Production OS encryption is required; no fallback is accepted').toEqual({
    testBackendSelected: false, encryptionAvailable: true
  })
}

async function encryptedRecords(userDataDir: string) {
  return Promise.all(SECRET_NAMES.map(name =>
    readFile(join(userDataDir, 'secrets', `${Buffer.from(name).toString('base64url')}.bin`))))
}

async function expectOsEncryptedRecords(app: ElectronApplication, userDataDir: string) {
  // Only ciphertext crosses into the main process; decrypted bytes stay there.
  // Electron's evaluator does not expose CommonJS require for filesystem reads.
  const ciphertexts = (await encryptedRecords(userDataDir)).map(bytes => bytes.toString('base64'))
  const readable = await app.evaluate(({ safeStorage }, ciphertexts) => {
    try {
      return ciphertexts.every(bytes => safeStorage.decryptString(Buffer.from(bytes, 'base64')).length > 0)
    } catch {
      return false
    }
  }, ciphertexts)
  expect(readable, 'Every persisted record is decryptable by real safeStorage').toBe(true)
}

async function expectHosts(page: Page, serverIds: string[]) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  // Compare identities as a boolean so neither identifier is printed on failure.
  await expect.poll(async () => {
    const ids = await page.locator('.settings__server-row-id').allTextContents()
    return ids.length === serverIds.length && serverIds.every(id => ids.includes(id))
  }).toBe(true)
  await page.locator('.settings__back').click()
  await expect(page.locator('.channel-list__host').filter({ hasText: 'Restart primary' })).toHaveCount(2)
  await expect(page.locator('.channel-list__host').filter({ hasText: 'Restart secondary' })).toHaveCount(2)
}

test('real daemon authenticates saved OS-encrypted pairing after two full desktop restarts', async ({
  relay, daemon
}) => {
  test.setTimeout(240_000)
  const secondaryRelay = await startFakeRelayForwarder()
  try {
    const secondary = await startFakeDaemon({ url: secondaryRelay.url, buildReplyFrames: () => [] })
    try {
      await withIsolatedElectronApp(async first => {
        let current = first
        const serverIds = [daemon.pairFields.server, SECOND_HOST]
        const pids = new Set<number>()
        const recordProcess = () => {
          const pid = current.app.process().pid
          if (pid === undefined) throw new Error('restart proof: missing process')
          expect(pids.has(pid), 'Every launch is a new main process').toBe(false)
          pids.add(pid)
        }
        recordProcess()
        await expectOsEncryption(current.app)
        let observer = await observeStatus(current.app, current.page, serverIds)
        await pairFromUnpairedLaunch(current.page, encodePairingPayload({
          ...daemon.pairFields, relay: `${relay.url}/v1/client`
        }), 'Restart primary')
        await expectAuthenticated(observer, 0, 'Initial real-daemon authentication')

        await pairAnotherServerFromSettings(current.page, encodePairingPayload({
          server: SECOND_HOST, relay: `${secondaryRelay.url}/v1/client`,
          token: 'synthetic-secondary-token',
          server_static_pubkey: Buffer.from(secondary.staticPublicKey).toString('base64')
        }), 'Restart secondary')
        await expectAuthenticated(observer, 1, 'Initial secondary-peer handshake')
        await expectHosts(current.page, serverIds)
        await expectOsEncryptedRecords(current.app, current.userDataDir)
        const saved = await encryptedRecords(current.userDataDir)

        // An abnormal socket drop is retryable. No repair action or renderer reload
        // occurs between the baseline and the next genuine handshake event.
        const beforeDrop = (await observer.read())[1].authentications
        expect(beforeDrop, 'Observe a real secondary handshake before dropping its connection').toBeGreaterThan(0)
        secondaryRelay.dropClientLeg()
        await expect.poll(async () => (await observer.read())[1].authentications,
          { timeout: HANDSHAKE_TIMEOUT }).toBeGreaterThan(beforeDrop)
        await expectAuthenticated(observer, 1, 'Secondary peer automatically recovers a network drop')

        // Exercise the existing classified-rejection path, then leave this peer
        // unavailable while the real daemon must authenticate on both restarts.
        secondary.pushFrame(encodeEnvelope({ id: 50, type: 'error', ts: '2026-09-12T00:00:00Z',
          payload: { code: 'auth.invalid_token', message: 'synthetic rejection', retryable: false } }))
        await expect(current.page.getByRole('button', { name: 'Repair host', exact: true })).toHaveCount(2)
        await expectAuthenticated(observer, 0, 'Secondary rejection does not invalidate primary')
        await secondary.close()
        await secondaryRelay.close()

        for (const stage of ['First full relaunch', 'Second full relaunch']) {
          const oldChild = current.app.process()
          await observer.dispose()
          current = await current.relaunch()
          expect(oldChild.exitCode !== null || oldChild.signalCode !== null).toBe(true)
          recordProcess()
          await expectOsEncryption(current.app)
          observer = await observeStatus(current.app, current.page, serverIds)
          await expectAuthenticated(observer, 0, stage)
          await expectHosts(current.page, serverIds)
          await expectOsEncryptedRecords(current.app, current.userDataDir)
          const reloaded = await encryptedRecords(current.userDataDir)
          expect(reloaded.every((bytes, i) => bytes.equals(saved[i])), 'All saved records remain unchanged').toBe(true)
        }
        expect(pids.size).toBe(3)
        await observer.dispose()
      }, { encryption: 'os' })
    } finally {
      await secondary.close()
    }
  } finally {
    await secondaryRelay.close()
  }
})
