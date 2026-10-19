import { test as base, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { test as live, withIsolatedElectronApp, type RealDaemonOptions, type RealDaemonFixtures } from './realDaemon'
import { startFakeRelayForwarder, type FakeRelayForwarder } from '../../src/main/transport/fakeRelayForwarder'
import { startFakeDaemonForTest } from './fakeDaemonSetup'
import { RecordedExchange, parseRecording, type Recording, type RecordedEntry } from './recordedExchange'
import { clientAppLifecycle } from './clientAppLifecycle'
import { daemonIdentity } from './daemonVersion'
import type { ExchangeCapture } from './exchangeCapture'
import { assertReplayNativeStorage } from './replayNativeStorage'

export { expect } from '@playwright/test'
export type { SpawnedDaemon } from './realDaemon'
export { encodePairingPayload, withIsolatedElectronApp } from './realDaemon'
export const scenarioMode = process.env.PYRY_CLIENT_MODE ?? 'live'
if (!['live', 'capture', 'replay'].includes(scenarioMode)) throw new Error('Unknown client scenario mode')
type CaptureGlobal = typeof globalThis & { __desktopExchangeCapture?: ExchangeCapture }
const scenarioId = (name: string, title: string): string => name === 'claude-queue-delivery'
  ? `${name}-${createHash('sha256').update(title).digest('hex').slice(0, 8)}` : name
type Inputs = { nonce: number; [key: string]: unknown }
let state: { inputs: Inputs; source: Recording['source']; checkpoint: (name: string) => Promise<void> } | undefined

// Only explicit test-authored inputs are replayed. The application's clock and identities stay real.
export function scenarioNonce(): number { return state?.inputs.nonce ?? Date.now() }
export function scenarioInput<T>(name: string, generate: () => T): T {
  if (!state) return generate()
  if (scenarioMode === 'replay') {
    if (!Object.hasOwn(state.inputs, name)) throw new Error('Missing recorded scenario input')
    return state.inputs[name] as T
  }
  const value = generate()
  state.inputs[name] = value
  return value
}
export async function liveProof(run: () => Promise<void> | void): Promise<void> {
  if (scenarioMode !== 'replay') await run()
  // Offline cannot establish the filesystem/OS fact. It must still reach the
  // exact recorded prefix at which the live proof succeeded.
  await state?.checkpoint('live-proof')
}
// A recorded test-side action is distinct from an application request. Its effects
// are never fabricated: capture executes it; replay releases only captured messages.
export async function scenarioEffect(name: string, run: () => Promise<void>): Promise<void> {
  await state?.checkpoint(name)
  if (scenarioMode !== 'replay') await run()
}
export function scenarioDaemonRevision(): string {
  if (state) return state.source.daemonRevision
  return daemonIdentity(execFileSync(process.env.PYRY_BIN ?? 'pyry', ['version'], { encoding: 'utf8', timeout: 10_000 }))
}
export function scenarioDesktopRevision(): string {
  return state?.source.desktopRevision ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

const capture = live.extend<{ _clientCapture: void }>({
  _clientCapture: [async ({ daemon, spawnClaude }, use, info) => {
    const assertCleanSource = () => {
      if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim())
        throw new Error('Commit the source before capturing client scenarios')
    }
    assertCleanSource()
    const output = process.env.PYRY_CLIENT_RECORDING_DIR, binary = process.env.PYRY_BIN
    if (!output || !binary) throw new Error('Client capture requires explicit output directory and test daemon')
    const build = execFileSync('go', ['version', '-m', binary], { encoding: 'utf8' })
    const daemonRevision = /vcs.revision=([a-f0-9]{40})/.exec(build)?.[1]
    if (!daemonRevision || !build.includes('vcs.modified=false')) throw new Error('Capture daemon must identify its source revision')
    const source: Recording['source'] = { capturedAt: new Date().toISOString(),
      desktopRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), daemonRevision,
      daemonBinarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
      claudeVersion: spawnClaude ? execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim() : 'not-spawned' }
    const wire: RecordedEntry[] = [], barriers: NonNullable<Recording['barriers']> = [], devices: string[] = [], closures: NonNullable<Recording['closures']> = []
    let capabilities: string[] = [], connections = 0, active: ElectronApplication | undefined, failure: unknown
    const harvested = new Set<ElectronApplication>()
    const oldFlag = process.env.PYRY_CAPTURE_ON_LAUNCH
    process.env.PYRY_CAPTURE_ON_LAUNCH = '1'
    state = { inputs: { nonce: Date.now() }, source, checkpoint: async name => {
      if (active) await active.evaluate((_, name) => (globalThis as CaptureGlobal).__desktopExchangeCapture!.checkpoint(name), name)
      else barriers.push({ before: wire.length, name })
    } }
    clientAppLifecycle.opened = async app => { active = app }
    clientAppLifecycle.closing = async app => {
      if (harvested.has(app)) return
      harvested.add(app)
      try {
        const page = await app.firstWindow()
        const identity = await page.evaluate(() => window.pyry.deviceIdentity())
        if (!identity.ok) throw new Error('Capture device identity unavailable')
        const result = await app.evaluate(() => {
          const capture = (globalThis as CaptureGlobal).__desktopExchangeCapture!
          const result = capture.takeConnections()
          capture.stop()
          return result
        })
        if (!result.connections) throw new Error('Capture observed no authenticated connection')
        const offset = wire.length
        closures.push(...result.closures.map(c => ({ ...c, before: c.before + offset, connection: c.connection + connections })))
        barriers.push(...result.barriers.map(b => ({ ...b, before: b.before + offset })))
        wire.push(...result.wire.map(e => ({ ...e, connection: (e.connection ?? 1) + connections })))
        for (const names of result.capabilities) {
          if (!names.includes('interactive') || !names.includes('thread')) throw new Error('Capture lacks native thread capabilities')
          capabilities = names
          devices.push(identity.deviceId)
        }
        connections += result.connections
        if (devices.length !== connections) throw new Error('Capture lacks connection provenance')
      } catch (error) { failure ??= error; throw error }
      finally { if (active === app) active = undefined }
    }
    try {
      await use()
      if (failure) throw failure
      assertCleanSource()
      const answerNonces = wire.filter(e => e.direction === 'client' && e.message.type === 'modal_answer')
        .map(e => (e.message.payload as Record<string, unknown>).answer_token)
      const normalize = (value: unknown): unknown => {
        if (typeof value === 'string') {
          const index = answerNonces.indexOf(value)
          return index >= 0 ? `recorded-answer-nonce-${index + 1}` : value.replaceAll(daemon.workdir, '/recorded/workspace').replaceAll(resolve(daemon.workdir, '..'), '/recorded')
        }
        if (Array.isArray(value)) return value.map(normalize)
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]))
        return value
      }
      const id = scenarioId(basename(info.file, '.spec.ts').replace(/^real-/, ''), info.title)
      const recording: Recording = { format: 'pyrycode.daemon-exchange', version: 2, source,
        scenario: { id, inputs: state!.inputs, workspace: '/recorded/workspace' }, capabilities,
        deviceId: devices[0], devices, barriers, closures, wire: normalize(wire) as RecordedEntry[] }
      const encoded = JSON.stringify(recording, null, 2) + '\n'
      for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'PYRY_LIVE_CLAUDE_TOKEN'])
        if (process.env[key] && encoded.includes(process.env[key]!)) throw new Error('Invalid recording: credential present')
      if (info.status !== 'passed' || info.errors.length) {
        // Failed runs are private diagnostics, never eligible replay fixtures.
        const diagnostics = process.env.PYRY_CLIENT_DIAGNOSTICS_DIR
        if (diagnostics) {
          if (!relative(process.cwd(), resolve(diagnostics)).startsWith('..')) throw new Error('Diagnostic directory must be outside the checkout')
          writeFileSync(join(diagnostics, `${id}.failed.json`), JSON.stringify({
            format: 'pyrycode.failed-capture', status: info.status, recording
          }, null, 2), { flag: 'wx', mode: 0o600 })
        }
        return
      }
      parseRecording(encoded)
      writeFileSync(join(output, `${id}.json`), encoded, { flag: 'wx', mode: 0o600 })
      await info.attach('capture-provenance', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        scenario: id, source, frames: wire.length, connections })) })
    } finally {
      delete clientAppLifecycle.opened; delete clientAppLifecycle.closing; state = undefined
      if (oldFlag === undefined) delete process.env.PYRY_CAPTURE_ON_LAUNCH
      else process.env.PYRY_CAPTURE_ON_LAUNCH = oldFlag
    }
  }, { auto: true }]
})

type ReplayFixtures = RealDaemonOptions & Omit<RealDaemonFixtures, 'relay'> & {
  relay: FakeRelayForwarder
  recordingName: string; recording: Recording; exchange: RecordedExchange; _clientReplay: void
}
const replay = base.extend<ReplayFixtures>({
  recordingName: ['', { option: true }],
  spawnClaude: [true, { option: true }], seedPromoted: [false, { option: true }],
  skipPermissions: [true, { option: true }], interactiveRunner: ['', { option: true }],
  stdioPermissionPrompt: [false, { option: true }], allowRemotePermissions: [false, { option: true }],
  claudeModel: ['haiku', { option: true }], requiredCapabilities: [[], { option: true }],
  seedCwdSubdir: ['', { option: true }], codexCapture: [false, { option: true }],
  recording: async ({ recordingName }, use, info) => {
    recordingName = scenarioId(recordingName, info.title)
    if (!/^[a-z][a-z0-9-]*$/.test(recordingName)) throw new Error('Client recording name is required')
    const directory = process.env.PYRY_CLIENT_RECORDING_DIR ?? resolve('e2e/recordings')
    const recording = parseRecording(readFileSync(join(directory, `${recordingName}.json`), 'utf8'))
    if (recording.scenario.id !== recordingName) throw new Error('Client recording scenario mismatch')
    await use(recording)
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
    try { await use(relay) } finally { await relay.close() }
  },
  daemon: async ({ relay, recording, exchange }, use) => {
    exchange.setTransportCloseObserver(({ code, afterServerFrames }) => relay.closeClientAfterServerFrames(afterServerFrames, code))
    const daemon = await startFakeDaemonForTest({ url: relay.url, helloAck: { capabilities: recording.capabilities },
      buildInitialFrames: () => exchange.start(), buildReconnectFrames: () => exchange.reconnect(),
      buildReplyFrames: bytes => exchange.reply(bytes) })
    state = { inputs: recording.scenario.inputs!, source: recording.source, checkpoint: async name => {
      for (const frame of await exchange.checkpointWhenReady(name)) daemon.pushFrame(frame)
    } }
    try {
      await use({ pairFields: { server: 'fake-daemon', token: 'dummy-token-not-a-real-credential',
        server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64') },
      workdir: recording.scenario.workspace ?? '/recorded/workspace',
      mintPairing: async () => ({ server: 'fake-daemon', token: 'dummy-token-not-a-real-credential',
        server_static_pubkey: Buffer.from(daemon.staticPublicKey).toString('base64') }) })
    } finally { state = undefined; await daemon.close() }
  },
  _clientReplay: [async ({ daemon, exchange, recording, relay }, use) => {
    void daemon
    let first = true
    clientAppLifecycle.opened = async (app, page) => {
      await assertReplayNativeStorage(app)
      const identity = await page.evaluate(() => window.pyry.deviceIdentity())
      if (!identity.ok) throw new Error('Replay device identity unavailable')
      if (first) { exchange.setDeviceId(identity.deviceId); first = false }
      else exchange.bindCurrentDevice(identity.deviceId)
    }
    clientAppLifecycle.closing = async (_app, completed) => {
      if (!completed) return
      await exchange.whenConnectionComplete()
      await relay.whenServerFramesForwarded(exchange.serverFrameCount())
    }
    try { await use() } finally {
      delete clientAppLifecycle.opened
      delete clientAppLifecycle.closing
    }
  }, { auto: true }],
  page: async ({ daemon }, use) => { void daemon; await withIsolatedElectronApp(({ page }) => use(page)) }
})

export const test = (scenarioMode === 'replay' ? replay : scenarioMode === 'capture' ? capture : live) as typeof live
