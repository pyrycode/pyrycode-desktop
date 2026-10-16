import { test as base } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { test as live, withIsolatedElectronApp, type RealDaemonOptions, type RealDaemonFixtures } from './realDaemon'
import { startFakeRelayForwarder } from '../../src/main/transport/fakeRelayForwarder'
import { startFakeDaemonForTest } from './fakeDaemonSetup'
import { RecordedExchange, parseRecording, type Recording, type RecordedEntry } from './recordedExchange'
import type { ExchangeCapture } from './exchangeCapture'

export { expect } from '@playwright/test'
export { encodePairingPayload, withIsolatedElectronApp } from './realDaemon'

// Scenario inputs are captured once. The application's clock, timers and identities stay real.
let nonce: number | undefined
export function scenarioNonce(): number { return nonce ?? Date.now() }
const mode = process.env.PYRY_CLIENT_MODE ?? 'live'
if (!['live', 'capture', 'replay'].includes(mode)) throw new Error('Unknown client scenario mode')
type CaptureGlobal = typeof globalThis & { __desktopExchangeCapture?: ExchangeCapture }
type ObservationWindow = typeof window & { captureCapabilities: string[]; stopCaptureCapabilities: () => void }

const capture = live.extend({
  page: async ({ daemon, spawnClaude }, use, info) => {
    const output = process.env.PYRY_CLIENT_RECORDING_DIR
    const binary = process.env.PYRY_BIN
    if (!output || !binary) throw new Error('Client capture requires explicit output directory and test daemon')
    const build = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
    const daemonRevision = /vcs.revision=([a-f0-9]{40})/.exec(build)?.[1]
    if (!daemonRevision) throw new Error('Capture daemon must identify its source revision')
    nonce = Date.now()
    try {
      await withIsolatedElectronApp(async ({ app, page }) => {
        await app.evaluate(() => {
          const recorder = (globalThis as CaptureGlobal).__desktopExchangeCapture
          if (!recorder) throw new Error('Client capture requires separate capture build')
          recorder.begin()
        })
        await page.evaluate(() => {
          const target = window as ObservationWindow
          target.captureCapabilities = []
          target.stopCaptureCapabilities = window.pyry.onDaemonEvent(event => {
            if (event.type === 'connected') target.captureCapabilities = event.ack.capabilities
          })
        })
        try {
          await use(page)
          if (info.status !== 'passed' || info.errors.length) return
          const identity = await page.evaluate(() => window.pyry.deviceIdentity())
          if (!identity.ok) throw new Error('Capture device identity unavailable')
          const wire = await app.evaluate(() => (globalThis as CaptureGlobal).__desktopExchangeCapture!.take())
          const nonces = wire.filter(e => e.direction === 'client' && e.message.type === 'modal_answer')
            .map(e => (e.message.payload as Record<string, unknown>).answer_token)
          const normalize = (value: unknown): unknown => {
            if (typeof value === 'string') {
              const index = nonces.indexOf(value)
              return index >= 0 ? `recorded-answer-nonce-${index + 1}` : value.replaceAll(daemon.workdir, '/recorded/workspace')
            }
            if (Array.isArray(value)) return value.map(normalize)
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]))
            return value
          }
          const id = basename(info.file, '.spec.ts').replace(/^real-/, '')
          const recording: Recording = { format: 'pyrycode.daemon-exchange', version: 1,
            source: { capturedAt: new Date().toISOString(), desktopRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
              daemonRevision, daemonBinarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
              claudeVersion: spawnClaude ? execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() : 'not-spawned' },
            scenario: { id, inputs: { nonce: nonce! }, workspace: '/recorded/workspace' },
            capabilities: await page.evaluate(() => (window as ObservationWindow).captureCapabilities),
            deviceId: identity.deviceId, wire: normalize(wire) as RecordedEntry[] }
          const encoded = JSON.stringify(recording, null, 2) + '\n'
          for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'PYRY_LIVE_CLAUDE_TOKEN'])
            if (process.env[key] && encoded.includes(process.env[key]!)) throw new Error('Invalid recording: credential present')
          parseRecording(encoded)
          writeFileSync(join(output, `${id}.json`), encoded, { flag: 'wx', mode: 0o600 })
          await info.attach('capture-provenance', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
            scenario: id, source: recording.source, frames: wire.length })) })
        } finally {
          await app.evaluate(() => (globalThis as CaptureGlobal).__desktopExchangeCapture?.stop())
          await page.evaluate(() => (window as ObservationWindow).stopCaptureCapabilities())
        }
      })
    } finally { nonce = undefined }
  }
})

type ReplayFixtures = RealDaemonOptions & RealDaemonFixtures & {
  recordingName: string; recording: Recording; exchange: RecordedExchange
}
const replay = base.extend<ReplayFixtures>({
  recordingName: ['', { option: true }],
  spawnClaude: [true, { option: true }], seedPromoted: [false, { option: true }],
  skipPermissions: [true, { option: true }], interactiveRunner: ['', { option: true }],
  stdioPermissionPrompt: [false, { option: true }], allowRemotePermissions: [false, { option: true }],
  claudeModel: ['haiku', { option: true }], requiredCapabilities: [[], { option: true }],
  seedCwdSubdir: ['', { option: true }], codexCapture: [false, { option: true }],
  recording: async ({ recordingName }, use) => {
    if (!/^[a-z][a-z0-9-]*$/.test(recordingName)) throw new Error('Client recording name is required')
    const directory = process.env.PYRY_CLIENT_RECORDING_DIR ?? resolve('e2e/recordings')
    const recording = parseRecording(readFileSync(join(directory, `${recordingName}.json`), 'utf8'))
    if (recording.scenario.id !== recordingName) throw new Error('Client recording scenario mismatch')
    nonce = recording.scenario.inputs!.nonce
    try { await use(recording) } finally { nonce = undefined }
  },
  exchange: async ({ recording }, use, info) => {
    const exchange = new RecordedExchange(recording)
    try { await use(exchange) } finally {
      await info.attach('recorded-exchange', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        scenario: recording.scenario.id, source: recording.source, ...exchange.stats() })) })
      exchange.assertComplete()
    }
  },
  relay: async ({}, use) => {
    const relay = await startFakeRelayForwarder()
    try { await use(relay as RealDaemonFixtures['relay']) } finally { await relay.close() }
  },
  daemon: async ({ relay, recording, exchange }, use) => {
    const daemon = await startFakeDaemonForTest({ url: relay.url, helloAck: { capabilities: recording.capabilities },
      buildReplyFrames: bytes => {
        try { return exchange.reply(bytes) } catch { return [] }
      } })
    try {
      const pairFields = { server: 'fake-daemon', token: 'dummy-token-not-a-real-credential',
        server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64') }
      await use({ pairFields, workdir: recording.scenario.workspace ?? '/recorded/workspace',
        mintPairing: async () => { throw new Error('Replay has no live pairing service') } })
    } finally { await daemon.close() }
  },
  page: async ({ daemon, exchange }, use) => {
    void daemon
    await withIsolatedElectronApp(async ({ page }) => {
      const identity = await page.evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw new Error('Replay device identity unavailable')
      exchange.setDeviceId(identity.deviceId)
      await use(page)
    })
  }
})

export const test = (mode === 'replay' ? replay : mode === 'capture' ? capture : live) as typeof live
