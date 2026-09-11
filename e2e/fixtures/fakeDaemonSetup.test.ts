import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import * as daemonModule from '../../src/main/transport/fakeDaemon'
import { startFakeDaemonForTest } from './fakeDaemonSetup'

afterEach(() => vi.restoreAllMocks())

describe('paired fake daemon setup diagnostics', () => {
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
      // An observed setup failure stays red; no automatic retry hides it.
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
    new Error('Unexpected server response: 404 private-sentinel'),
    new Error('private-sentinel', { cause: new Error('private-cause') }),
    'private-sentinel', null
  ])('does not expose arbitrary failure contents or causes', async failure => {
    vi.spyOn(daemonModule, 'startFakeDaemon').mockRejectedValue(failure)
    const error = await startFakeDaemonForTest({ url: 'ws://fixture.invalid' }).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Fake daemon setup failed before Electron launch')
    expect(error.cause).toBeUndefined()
    expect(error.stack).not.toContain('private-sentinel')
  })
})
