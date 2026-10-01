import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import * as daemonModule from '../../src/main/transport/fakeDaemon'
import * as noiseModule from '../../src/main/transport/noiseLib'
import { NoiseLoadError } from '../../src/main/transport/noiseLib'
import { startFakeDaemonForTest } from './fakeDaemonSetup'

afterEach(() => vi.restoreAllMocks())

describe('paired fake daemon setup diagnostics', () => {
  it('recovers one real pre-open reset and frees each attempt before teardown', async () => {
    const lib = await noiseModule.loadNoiseLib()
    const frees: MockInstance<() => void>[] = []
    vi.spyOn(noiseModule, 'loadNoiseLib').mockResolvedValue({
      ...lib,
      HandshakeState: (...args: Parameters<typeof lib.HandshakeState>) => {
        if (frees.length === 1) expect(frees[0]).toHaveBeenCalledOnce()
        const state = lib.HandshakeState(...args)
        frees.push(vi.spyOn(state, 'free'))
        return state
      }
    })
    let upgrades = 0
    const server = createServer()
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      upgrades += 1
      if (upgrades === 1) socket.destroy()
      else wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    let daemon: daemonModule.FakeDaemon | undefined
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing test listener')
      daemon = await startFakeDaemonForTest({ url: `ws://127.0.0.1:${address.port}` })
      expect(upgrades).toBe(2)
      expect(daemon.staticPublicKey).toHaveLength(32)
      expect(frees).toHaveLength(2)
      expect(frees[0]).toHaveBeenCalledOnce()
      expect(frees[1]).not.toHaveBeenCalled()
      await daemon.close()
      expect(await daemon.whenSettled()).toEqual({ ok: false, reason: 'closed' })
      expect(frees[1]).toHaveBeenCalledOnce()
    } finally {
      await daemon?.close()
      for (const client of wss.clients) client.terminate()
      await new Promise<void>(resolve => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('fails after exactly two pre-open resets without exposing error contents', async () => {
    const failure = Object.assign(new Error('private-sentinel'), { code: 'ECONNRESET' })
    const start = vi.spyOn(daemonModule, 'startFakeDaemon').mockRejectedValue(failure)
    const error = await startFakeDaemonForTest({ url: 'ws://fixture.invalid' }).catch(error => error)
    expect(start).toHaveBeenCalledTimes(2)
    expect(error.message).toBe('Fake daemon setup failed before Electron launch: ECONNRESET')
    expect(error.cause).toBeUndefined()
    expect(error.stack).not.toContain('private-sentinel')
  })

  it('identifies a real HTTP 404 during daemon setup before Electron launch', async () => {
    let upgrades = 0
    const server = createServer()
    server.on('upgrade', (_request, socket) => {
      upgrades += 1
      socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing test listener')
      await expect(startFakeDaemonForTest({ url: `ws://127.0.0.1:${address.port}` }))
        .rejects.toThrow('Fake daemon setup failed before Electron launch: HTTP 404')
      // An HTTP rejection is not the pre-open socket reset eligible for recovery.
      expect(upgrades).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('passes options and a successful daemon handle through unchanged', async () => {
    const handle = {} as daemonModule.FakeDaemon
    const start = vi.spyOn(daemonModule, 'startFakeDaemon').mockResolvedValue(handle)
    const options = { url: 'ws://fixture.invalid', buildReplyFrames: () => [] }
    expect(await startFakeDaemonForTest(options)).toBe(handle)
    expect(start).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith(options)
  })

  it.each([
    [new NoiseLoadError('wasm-load-failed'), 'wasm-load-failed'],
    [new NoiseLoadError('wasm-load-timeout'), 'wasm-load-timeout'],
    [Object.assign(new Error('connect private-sentinel'), { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
    [Object.assign(new Error('read private-sentinel'), { code: 'ECONNRESET' }), 'ECONNRESET'],
    [new Error('Unexpected server response: 503'), 'HTTP 503']
  ])('names the fixed class of a recognised setup failure', async (failure, suffix) => {
    const start = vi.spyOn(daemonModule, 'startFakeDaemon').mockRejectedValue(failure)
    const error = await startFakeDaemonForTest({ url: 'ws://fixture.invalid' }).catch(error => error)
    expect(error.message).toBe(`Fake daemon setup failed before Electron launch: ${suffix}`)
    expect(error.cause).toBeUndefined()
    expect(error.stack).not.toContain('private-sentinel')
    expect(start).toHaveBeenCalledTimes(suffix === 'ECONNRESET' ? 2 : 1)
  })

  it.each([
    new Error('Unexpected server response: 404 private-sentinel'),
    new Error('private-sentinel', { cause: new Error('private-cause') }),
    Object.assign(new Error('private-sentinel'), { code: 'private-sentinel' }),
    'private-sentinel', null
  ])('does not expose arbitrary failure contents or causes', async failure => {
    const start = vi.spyOn(daemonModule, 'startFakeDaemon').mockRejectedValue(failure)
    const error = await startFakeDaemonForTest({ url: 'ws://fixture.invalid' }).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Fake daemon setup failed before Electron launch: unclassified')
    expect(error.cause).toBeUndefined()
    expect(error.stack).not.toContain('private-sentinel')
    expect(start).toHaveBeenCalledOnce()
  })
})
