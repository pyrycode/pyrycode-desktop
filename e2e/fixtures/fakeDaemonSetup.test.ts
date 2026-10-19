import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createServer, Server } from 'node:http'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import * as daemonModule from '../../src/main/transport/fakeDaemon'
import * as noiseModule from '../../src/main/transport/noiseLib'
import { NoiseLoadError } from '../../src/main/transport/noiseLib'
import { startFakeDaemonForTest } from './fakeDaemonSetup'
import { startFakeRelayForwarder } from '../../src/main/transport/fakeRelayForwarder'
import { createNoiseSession, type NoiseSession, type NoiseSessionEvent } from '../../src/main/transport/noiseSession'
import { base64StdDecode, base64StdEncode, decodeInnerFrame, encodeInnerFrame } from '../../src/main/transport/codec'
import { buildClientHello } from '../../src/main/transport/helloExchange'

afterEach(() => vi.restoreAllMocks())

describe('paired fake daemon setup diagnostics', () => {
  it.each([
    [Object.assign(new Error('private-sentinel'), { code: 'ECONNRESET' }), 'ECONNRESET', 2],
    [new Error('Unexpected server response: 400'), 'HTTP 400', 1],
    [new Error('private-sentinel', { cause: new Error('private-cause') }), 'unclassified', 1]
  ])('captures each attempt without exposing arbitrary inputs or claiming an unseen responder', async (failure, failureClass, count) => {
    const forwarder = await startFakeRelayForwarder()
    try {
      const start = vi.spyOn(daemonModule, 'startFakeDaemon').mockRejectedValue(failure)
      const records: unknown[] = []
      const error = await startFakeDaemonForTest({ url: 'ws://private-sentinel' }, {
        snapshot: () => forwarder.setupDiagnostics(),
        record: attempt => { records.push(attempt) }
      }).catch(error => error)
      expect(start).toHaveBeenCalledTimes(count)
      expect(records).toHaveLength(count)
      expect(records).toEqual(Array.from({ length: count }, (_, index) => ({
        attempt: index + 1,
        outcome: failureClass === 'ECONNRESET' && index === 0 ? 'retry-reset' : 'failed',
        failureClass,
        responder: 'unobserved',
        listenerMatchesDial: true,
        parserObserved: false, upgradeObserved: false, upgradeRejected: false, connectionObserved: false,
        parserClass: 'none', methodValid: false, upgradeValid: false, keyValid: false, versionValid: false
      })))
      expect(JSON.stringify(records)).not.toContain('private')
      expect(error.cause).toBeUndefined()
    } finally {
      await forwarder.close()
    }
  })

  it.each(['reset', 'HTTP 400'])('releases a real pre-open %s attempt before fresh setup and teardown', async boundary => {
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
    let resolveRejectedClose: () => void = () => {}
    const rejectedClosed = new Promise<void>(resolve => { resolveRejectedClose = resolve })
    server.on('upgrade', (request, socket, head) => {
      upgrades += 1
      if (upgrades === 1) {
        socket.once('close', resolveRejectedClose)
        if (boundary === 'reset') socket.destroy()
        else socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      } else wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    let daemon: daemonModule.FakeDaemon | undefined
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing test listener')
      if (boundary === 'HTTP 400') {
        await expect(startFakeDaemonForTest({ url: `ws://127.0.0.1:${address.port}` }))
          .rejects.toThrow('Fake daemon setup failed before Electron launch: HTTP 400')
        expect(upgrades).toBe(1) // HTTP rejection is not retried inside setup.
        expect(frees[0]).toHaveBeenCalledOnce()
      }
      daemon = await startFakeDaemonForTest({ url: `ws://127.0.0.1:${address.port}` })
      await rejectedClosed
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

  it.each([400, 404, 501])('identifies an unobserved HTTP %s responder, cleans up and then exchanges encrypted frames', async status => {
    const lib = await noiseModule.loadNoiseLib()
    const frees: MockInstance<() => void>[] = []
    vi.spyOn(noiseModule, 'loadNoiseLib').mockResolvedValue({
      ...lib,
      HandshakeState: (...args: Parameters<typeof lib.HandshakeState>) => {
        const state = lib.HandshakeState(...args)
        frees.push(vi.spyOn(state, 'free'))
        return state
      }
    })
    // Recreate the old wildcard bind on Darwin. Elsewhere isolate the IPv6 family so
    // the same wrong-owner negative control remains deterministic without port reuse.
    const listen = Server.prototype.listen
    vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (this: Server) {
      return listen.call(this, { port: 0, host: '::', ipv6Only: process.platform !== 'darwin' })
    })
    const forwarder = await startFakeRelayForwarder()
    const competitor = createServer()
    let rejectedClosed: Promise<unknown> | undefined
    let requests = 0
    competitor.on('upgrade', (_request, socket) => {
      requests++
      rejectedClosed = once(socket, 'close')
      socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    })
    const records: unknown[] = []
    let daemon: daemonModule.FakeDaemon | undefined
    let client: WebSocket | undefined
    let session: NoiseSession | undefined
    try {
      expect(forwarder.setupDiagnostics().listenerMatchesDial).toBe(false)
      competitor.listen(Number(new URL(forwarder.url).port), '127.0.0.1')
      await once(competitor, 'listening')
      const capture = {
        snapshot: () => forwarder.setupDiagnostics(), record: (attempt: unknown) => { records.push(attempt) }
      }
      const failure = await startFakeDaemonForTest({ url: forwarder.url }, capture).catch(error => error)
      expect(failure.message).toBe(`Fake daemon setup failed before Electron launch: HTTP ${status}`)
      expect(failure.cause).toBeUndefined()
      expect(requests).toBe(1)
      expect(rejectedClosed).toBeDefined()
      await rejectedClosed
      expect(frees).toHaveLength(1)
      expect(frees[0]).toHaveBeenCalledOnce()
      expect(records).toEqual([expect.objectContaining({
        outcome: 'failed', failureClass: `HTTP ${status}`, responder: 'unobserved',
        listenerMatchesDial: false, connectionObserved: false, upgradeObserved: false
      })])
      await new Promise<void>(resolve => competitor.close(() => resolve()))
      // No retry: this is a new invocation after the conflicting listener is gone.
      records.length = 0
      await forwarder.close()
      const owner = await startFakeRelayForwarder()
      try {
        daemon = await startFakeDaemonForTest({ url: owner.url }, {
          snapshot: () => owner.setupDiagnostics(), record: capture.record
        })
        expect(records).toEqual([{
          attempt: 1, outcome: 'opened', failureClass: null, responder: 'opened',
          listenerMatchesDial: true,
          parserObserved: false, upgradeObserved: true, upgradeRejected: false, connectionObserved: true,
          parserClass: 'none', methodValid: true, upgradeValid: true, keyValid: true, versionValid: true
        }])
        expect(frees).toHaveLength(2)
        expect(frees[1]).not.toHaveBeenCalled()
        client = new WebSocket(`${owner.url}/v1/client`)
        await once(client, 'open')
        await owner.whenReady()
        const socket = client
        let first = true
        let onEvent: (event: NoiseSessionEvent) => void = () => {}
        session = await createNoiseSession({
          staticPrivateKey: lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)[0],
          remoteStaticPublicKey: daemon.staticPublicKey,
          prologue: new Uint8Array(),
          hello: buildClientHello({ id: 1, ts: '2026-10-15T00:00:00Z', deviceName: 'test', clientVersion: '0', token: 'dummy' }),
          sendFrame: raw => {
            socket.send(encodeInnerFrame({ v: 2, type: first ? 'noise_init' : 'noise_msg', data: base64StdEncode(raw) }))
            first = false
          },
          onEvent: event => onEvent(event)
        })
        const initiator = session
        socket.on('message', data => {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data as ArrayBuffer)
          const frame = decodeInnerFrame(bytes)
          initiator.onFrame(base64StdDecode(frame.data), frame.type)
        })
        const handshake = new Promise<NoiseSessionEvent>(resolve => { onEvent = resolve })
        session.start()
        expect((await handshake).type).toBe('handshake-complete')
        const received = new Promise<NoiseSessionEvent>(resolve => { onEvent = resolve })
        const probe = new TextEncoder().encode('usable fake')
        session.sendMessage(probe)
        expect(await received).toEqual({ type: 'message', plaintext: probe })
        expect(await daemon.whenSettled()).toEqual({ ok: true })
      } finally {
        session?.close()
        client?.terminate()
        await daemon?.close()
        await owner.close()
      }
      expect(frees[0]).toHaveBeenCalledOnce()
      expect(frees[1]).toHaveBeenCalledOnce()
    } finally {
      await new Promise<void>(resolve => competitor.close(() => resolve()))
      await forwarder.close()
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
