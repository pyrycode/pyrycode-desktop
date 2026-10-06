import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { access } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import type { TestInfo } from '@playwright/test'
import { encodeEnvelope } from '../../src/main/transport/codec'
import * as driverModule from '../../src/main/transport/noiseRelayDriver'
import { readDaemonCapabilities } from './daemonCapabilityGate'
import { test as registered, type RealDaemonOptions, type RealDaemonFixtures } from './realDaemon'

vi.mock('@playwright/test', async importOriginal => ({
  ...await importOriginal<typeof import('@playwright/test')>(),
  test: { extend: (fixtures: unknown) => fixtures }
}))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn()
}))
vi.mock('node:net', async importOriginal => ({
  ...await importOriginal<typeof import('node:net')>(), connect: vi.fn()
}))

// Run the registered daemon fixture itself, with fakes only at process/socket/driver boundaries.
// The capability reader still generates real independent keys and makes the real skip decision.
const fixture = (registered as unknown as {
  daemon: (
    options: RealDaemonOptions & Pick<RealDaemonFixtures, 'relay'>,
    use: (daemon: RealDaemonFixtures['daemon']) => Promise<void>,
    info: Pick<TestInfo, 'skip'>
  ) => Promise<void>
}).daemon

describe('real daemon fixture pairing ownership', () => {
  let home: string
  let mints: { granted: boolean; name: string }[]
  let bindings: Map<string, Uint8Array>
  let stopped: number
  let capabilities: string[]
  let probeFailure: boolean
  let mintFailure: 'exit' | 'launch' | undefined
  let reaped: boolean

  beforeEach(() => {
    home = ''
    mints = []
    bindings = new Map()
    stopped = 0
    capabilities = ['question']
    probeFailure = false
    mintFailure = undefined
    reaped = false
    vi.stubEnv('PYRY_BIN', process.execPath)
    const daemon = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 424242, exitCode: null as number | null, signalCode: null
    })
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid !== -daemon.pid) throw new Error('Unexpected process group')
      reaped = true
      daemon.exitCode = 0
      daemon.emit('exit', 0)
      return true
    })
    vi.mocked(connect).mockImplementation(() => {
      const socket = Object.assign(new EventEmitter(), { destroy() {} })
      queueMicrotask(() => socket.emit('connect'))
      return socket as ReturnType<typeof connect>
    })
    vi.mocked(spawn).mockImplementation((_bin, args, options) => {
      home = options?.env?.HOME ?? ''
      if (args?.[0] !== 'pair') return daemon as unknown as ChildProcess
      mints.push({
        granted: args.includes('--allow-remote-permissions'),
        name: args.find(arg => arg.startsWith('--name=')) ?? ''
      })
      const pair = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()
      })
      queueMicrotask(() => {
        if (mints.length === 2 && mintFailure === 'launch') {
          pair.emit('error', new Error('private-pairing-sentinel'))
          return
        }
        pair.stdout.write(Buffer.from(JSON.stringify({
          server: 'fixture-server', token: `fixture-pair-${mints.length}`,
          server_static_pubkey: Buffer.alloc(32, 7).toString('base64')
        })).toString('base64url'))
        if (mints.length === 2 && mintFailure === 'exit') {
          pair.stderr.write('private-pairing-sentinel')
          pair.emit('close', 1)
        } else pair.emit('close', 0)
      })
      return pair as unknown as ChildProcess
    })
    vi.spyOn(driverModule, 'createNoiseRelayDriver').mockImplementation(config => {
      const token = config.connection.headers?.['X-Pyrycode-Token'] ?? ''
      const key = config.session.staticPrivateKey
      const bound = bindings.get(token)
      // Model daemon first-key binding: a later different key is refused for the same token.
      const accepted = !probeFailure && (bound === undefined || Buffer.from(bound).equals(key))
      if (accepted) bindings.set(token, key)
      queueMicrotask(() => config.onEvent(accepted ? {
        type: 'handshake-complete',
        helloAck: encodeEnvelope({ id: 1, type: 'hello_ack', ts: '2026-01-01T00:00:00Z',
          payload: { server_id: 'fixture-server', conn_id: 'fixture-connection',
            protocol_version: 'v2', capabilities } })
      } : { type: 'terminal', code: 4401, reason: 'auth.invalid_token' }))
      return { sendMessage() {}, stop() { stopped += 1 } }
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    expect(reaped).toBe(true)
    await expect(access(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  async function run(requiredCapabilities: string[], use = async (_daemon: RealDaemonFixtures['daemon']) => {}) {
    await fixture({
      relay: { url: 'ws://127.0.0.1:1' } as RealDaemonFixtures['relay'],
      spawnClaude: false, seedPromoted: false, skipPermissions: true,
      interactiveRunner: '', stdioPermissionPrompt: false,
      allowRemotePermissions: true, claudeModel: 'haiku', seedCwdSubdir: '', requiredCapabilities
    }, use, { skip(condition = true, reason?: string) { if (condition) throw new Error(reason) } })
  }

  it('a successful probe leaves the app pairing available for its independent static key', async () => {
    let appAccepted = false
    await run(['question'], async daemon => {
      // A second initiator represents the app's independent key, consuming the actual fixture handoff.
      const appRead = await readDaemonCapabilities({ relayUrl: 'ws://127.0.0.1:1',
        pairFields: daemon.pairFields, advertise: ['question'] })
      appAccepted = appRead.ok
    })
    expect(appAccepted).toBe(true)
    expect(bindings.size).toBe(2)
    expect(mints.map(mint => mint.granted)).toEqual([true, false])
    expect(mints[0].name !== mints[1].name).toBe(true)
    expect(stopped).toBe(2)
  })

  it('does not mint or connect a probe when no capabilities are required', async () => {
    const use = vi.fn()
    await run([], use)
    expect(use).toHaveBeenCalledOnce()
    expect(mints).toHaveLength(1)
    expect(stopped).toBe(0)
  })

  it.each(['missing', 'failure'])('prevents app handoff on a %s capability read', async mode => {
    capabilities = []
    probeFailure = mode === 'failure'
    const use = vi.fn()
    await expect(run(['question'], use)).rejects.toThrow(mode === 'missing' ? 'stale' : 'handshake-failed')
    expect(use).not.toHaveBeenCalled()
    expect(stopped).toBe(1)
  })

  it.each(['exit', 'launch'] as const)('does not report subprocess secrets on probe mint %s failure', async failure => {
    mintFailure = failure
    const use = vi.fn()
    const error = await run(['question'], use).catch(error => error as Error)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain(failure === 'exit' ? 'code 1' : 'failed to launch')
    expect(String(error)).not.toContain('private-pairing-sentinel')
    expect(error.stack).not.toContain('private-pairing-sentinel')
    expect(error.cause).toBeUndefined()
    expect(use).not.toHaveBeenCalled()
    expect(stopped).toBe(0)
  })
})
