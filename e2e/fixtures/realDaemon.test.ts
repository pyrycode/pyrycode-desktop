import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readdirSync, realpathSync } from 'node:fs'
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
      allowRemotePermissions: true, claudeModel: 'haiku', seedCwdSubdir: '', requiredCapabilities,
      codexCapture: false
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

describe('real daemon fixture dedicated Codex home', () => {
  let root: string
  let operatorHome: string
  let captureHome: string
  let daemonHome: string
  let probeHome: string
  let version: string
  let setupFailure: boolean
  let linkedAtSpawn: boolean
  let reaped: boolean
  let daemonArgs: readonly string[]
  let daemonEnv: NodeJS.ProcessEnv
  let probeFailure: 'launch' | 'exit' | 'timeout' | undefined

  beforeEach(async () => {
    root = await realpath(await mkdtemp('/tmp/codex-fixture-test-'))
    operatorHome = join(root, 'operator')
    captureHome = join(root, 'dedicated')
    await mkdir(operatorHome)
    await mkdir(captureHome)
    await writeFile(join(captureHome, 'sentinel'), 'test-owned sign-in stand-in')
    const binDir = join(root, 'bin')
    await mkdir(binDir)
    await writeFile(join(binDir, 'codex'), '', { mode: 0o700 })
    vi.stubEnv('HOME', operatorHome)
    vi.stubEnv('PATH', binDir)
    vi.stubEnv('PYRY_BIN', process.execPath)
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', captureHome)
    vi.stubEnv('CODEX_HOME', join(operatorHome, '.codex'))
    daemonHome = probeHome = ''
    version = 'codex-cli 0.156.1'
    setupFailure = linkedAtSpawn = reaped = false
    daemonArgs = []
    daemonEnv = {}
    probeFailure = undefined
    const daemon = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 424242, exitCode: null as number | null, signalCode: null
    })
    vi.spyOn(process, 'kill').mockImplementation(() => {
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
      if (args?.[0] === '--version') {
        probeHome = options?.env?.CODEX_HOME ?? ''
        const probe = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()
        })
        probe.kill.mockImplementation(() => { probe.emit('close', null) })
        queueMicrotask(() => {
          expect(probeHome).not.toBe(captureHome)
          expect(probeHome).not.toBe(process.env.CODEX_HOME)
          expect(readdirSync(probeHome)).toEqual([])
          if (probeFailure === 'timeout') return
          if (probeFailure === 'launch') {
            probe.emit('error', new Error('private-probe-sentinel'))
            return
          }
          probe.stderr.write('private-probe-sentinel')
          probe.stdout.write(version)
          probe.emit('close', probeFailure === 'exit' ? 1 : 0)
        })
        return probe as unknown as ChildProcess
      }
      daemonHome = options?.env?.HOME ?? ''
      if (args?.[0] === 'pair') {
        const pair = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn()
        })
        queueMicrotask(() => {
          if (setupFailure) { pair.emit('close', 1); return }
          pair.stdout.write(Buffer.from(JSON.stringify({
            server: 'fixture-server', token: 'test-owned-token',
            server_static_pubkey: Buffer.alloc(32, 7).toString('base64')
          })).toString('base64url'))
          pair.emit('close', 0)
        })
        return pair as unknown as ChildProcess
      }
      daemonArgs = args ?? []
      daemonEnv = options?.env ?? {}
      // This filesystem read starts synchronously at spawn, not at fixture handoff.
      const link = join(daemonHome, '.pyry/test/codex-home')
      try { linkedAtSpawn = realpathSync(link) === captureHome } catch { linkedAtSpawn = false }
      return daemon as unknown as ChildProcess
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    if (probeHome) await expect(access(probeHome)).rejects.toMatchObject({ code: 'ENOENT' })
    if (daemonHome) await expect(access(daemonHome)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(captureHome, 'sentinel'), 'utf8')).toBe('test-owned sign-in stand-in')
    await rm(root, { recursive: true, force: true })
  })

  async function run(codexCapture = true, use = async (_daemon: RealDaemonFixtures['daemon']) => {}, spawnClaude = false) {
    await fixture({ relay: { url: 'ws://127.0.0.1:1' } as RealDaemonFixtures['relay'],
      spawnClaude, seedPromoted: false, skipPermissions: true, interactiveRunner: '',
      stdioPermissionPrompt: false, allowRemotePermissions: false, claudeModel: 'haiku',
      requiredCapabilities: [], seedCwdSubdir: '', codexCapture
    }, use, { skip(condition = true, reason?: string) {
      if (condition) throw new Error(`SKIP: ${reason}`)
    } })
  }

  it('skips an unset capture variable before any process', async () => {
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', '')
    await expect(run()).rejects.toThrow('SKIP: real-codex: PYRY_CODEX_CAPTURE_HOME is unset')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips a missing directory', async () => {
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', join(root, 'missing'))
    await expect(run()).rejects.toThrow(/SKIP:.*directory.*missing/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('skips an absent executable', async () => {
    vi.stubEnv('PATH', '')
    await expect(run()).rejects.toThrow(/SKIP:.*codex.*PATH/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['0.156.0', '0.156.1-preview.1'])('skips Codex %s below the minimum', async old => {
    version = `codex-cli ${old}`
    await expect(run()).rejects.toThrow(/SKIP:.*0.156.1/)
    expect(spawn).toHaveBeenCalledOnce()
    expect(daemonHome).toBe('')
  })

  it.each(['launch', 'exit'] as const)('cleans a failed version probe on %s without exposing subprocess diagnostics', async failure => {
    probeFailure = failure
    const error = await run().catch(error => error as Error)
    expect(String(error)).toContain('real-codex: version probe failed')
    expect(String(error)).not.toContain('private-probe-sentinel')
    expect(daemonHome).toBe('')
  })

  it('fails malformed version output without echoing it', async () => {
    version = 'private-version-sentinel'
    await expect(run()).rejects.toThrow('real-codex: cannot parse Codex version')
    expect(daemonHome).toBe('')
  })

  it('kills a timed-out version probe before removing its isolated home', async () => {
    vi.useFakeTimers()
    probeFailure = 'timeout'
    const result = run().catch(error => error as Error)
    // Allow the real filesystem setup to reach the fake process before advancing its deadline.
    await vi.waitFor(() => expect(probeHome).not.toBe(''))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(String(await result)).toBe('Error: real-codex: version probe failed or timed out')
    const probe = vi.mocked(spawn).mock.results[0].value as ChildProcess
    expect(probe.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it.each(['.codex', '.pyry'])('rejects %s equal and descendant homes before probing', async protectedName => {
    const protectedRoot = join(operatorHome, protectedName)
    await mkdir(join(protectedRoot, 'child'), { recursive: true })
    for (const path of [protectedRoot, join(protectedRoot, 'child'), join(protectedRoot, 'missing')]) {
      vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', path)
      await expect(run()).rejects.toThrow(/real-codex:.*protected/)
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['.codex', '.pyry'])('rejects a supplied symlink alias into %s', async protectedName => {
    const protectedRoot = join(operatorHome, protectedName)
    await mkdir(join(protectedRoot, 'child'), { recursive: true })
    const alias = join(root, 'alias')
    await symlink(protectedRoot, alias, 'dir')
    for (const path of [alias, join(alias, 'child')]) {
      vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', path)
      await expect(run()).rejects.toThrow(/real-codex:.*protected/)
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['.codex', '.pyry'])('rejects canonical aliases when protected root %s is a symlink', async protectedName => {
    await symlink(captureHome, join(operatorHome, protectedName), 'dir')
    await mkdir(join(captureHome, 'child'))
    for (const path of [captureHome, join(captureHome, 'child')]) {
      vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', path)
      await expect(run()).rejects.toThrow(/real-codex:.*protected/)
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['.codex', '.pyry'])('rejects broken symlink aliases into protected %s before a missing-home skip', async protectedName => {
    const protectedRoot = join(operatorHome, protectedName)
    await symlink(protectedRoot, join(root, 'missing-alias'), 'dir')
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', join(root, 'missing-alias/child'))
    await expect(run()).rejects.toThrow(/real-codex:.*protected/)
    await symlink(join(root, 'missing-target'), protectedRoot, 'dir')
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', join(root, 'missing-target/child'))
    await expect(run()).rejects.toThrow(/real-codex:.*protected/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('accepts the minimum, probes in isolation, links before spawn and preserves target during successful cleanup', async () => {
    const alias = join(root, 'dedicated-alias')
    await symlink(captureHome, alias, 'dir')
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', alias)
    await run(true, async () => {
      expect(linkedAtSpawn).toBe(true)
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe(join(root, 'bin/codex'))
      expect(daemonArgs).toContain(`-pyry-codex=${join(root, 'bin/codex')}`)
      expect(await realpath(join(daemonHome, '.pyry/test/codex-home'))).toBe(captureHome)
      await writeFile(join(daemonHome, '.pyry/test/codex-home/config.toml'), 'test-owned update')
    })
    expect(reaped).toBe(true)
    expect(await readFile(join(captureHome, 'config.toml'), 'utf8')).toBe('test-owned update')
  })

  it('preserves target during failed setup cleanup', async () => {
    setupFailure = true
    await expect(run()).rejects.toThrow('pyry pair exited with code 1')
    expect(linkedAtSpawn).toBe(true)
    expect(reaped).toBe(true)
  })

  it('keeps non-opt-in behavior unchanged even with a protected configured home', async () => {
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', join(operatorHome, '.codex'))
    await run(false)
    expect(probeHome).toBe('')
    expect(linkedAtSpawn).toBe(false)
    expect(daemonArgs.some(arg => arg.startsWith('-pyry-codex'))).toBe(false)
    expect(daemonArgs).not.toContain('--')
    expect(daemonEnv).toEqual({ ...process.env, HOME: daemonHome,
      PYRY_ALLOW_INSECURE_RELAY: '1', PYRY_MOBILE_V2: '1' })
    expect((registered as unknown as { codexCapture: unknown }).codexCapture).toEqual([false, { option: true }])
  })

  it('retains the Claude binary and credential gates and pass-through arguments without Codex opt-in', async () => {
    vi.stubEnv('PYRY_CODEX_CAPTURE_HOME', join(operatorHome, '.pyry'))
    await expect(run(false, undefined, true)).rejects.toThrow('SKIP: realclaude: `claude` not on PATH')
    await writeFile(join(root, 'bin/claude'), '', { mode: 0o700 })
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await expect(run(false, undefined, true)).rejects.toThrow('SKIP: realclaude: neither')
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-owned-key')
    await run(false, undefined, true)
    expect(probeHome).toBe('')
    expect(daemonArgs.slice(-4)).toEqual(['--', '--model', 'haiku', '--dangerously-skip-permissions'])
    expect(daemonArgs).toContain(`-pyry-claude=${join(root, 'bin/claude')}`)
    expect(daemonEnv.ANTHROPIC_API_KEY).toBe('test-owned-key')
  })
})
