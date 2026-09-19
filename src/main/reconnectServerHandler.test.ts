import { describe, expect, it, vi } from 'vitest'
import {
  registerReconnectServerHandler,
  type ReconnectServerHandleTarget
} from './reconnectServerHandler'

function harness(reconnect = vi.fn<(serverId: string) => void>()) {
  const target = {
    handle: vi.fn<ReconnectServerHandleTarget['handle']>(),
    removeHandler: vi.fn<ReconnectServerHandleTarget['removeHandler']>()
  }
  const diagnosticLog = { event: vi.fn() }
  const unregister = registerReconnectServerHandler(target, {
    registry: { reconnect }, diagnosticLog
  })
  const listener = target.handle.mock.calls[0][1]
  return { target, reconnect, diagnosticLog, unregister, listener }
}

describe('registerReconnectServerHandler', () => {
  it('registers once and removes exactly its fixed channel', () => {
    const { target, unregister } = harness()
    expect(target.handle.mock.calls).toEqual([['pyry:reconnect-server', expect.any(Function)]])
    expect(target.removeHandler).not.toHaveBeenCalled()
    unregister()
    expect(target.removeHandler.mock.calls).toEqual([['pyry:reconnect-server']])
  })

  it.each(['private-server-id', '', '__proto__', 'constructor'])(
    'dispatches an accepted id once with an empty acknowledgement (case %#)',
    async (serverId) => {
      const { reconnect, diagnosticLog, listener } = harness()
      await expect(listener({ sender: 'event-content' }, { serverId })).resolves.toBeUndefined()
      expect(reconnect.mock.calls).toEqual([[serverId]])
      expect(diagnosticLog.event.mock.calls).toEqual([[{ event: 'reconnect-server-requested' }]])
    }
  )

  it.each([
    undefined, null, 'private-payload', 42, [], ['private-server-id'], {},
    { serverId: undefined }, { serverId: 42 }, { serverId: null },
    { serverId: 'private-server-id', extra: 'private-payload' },
    { serverId: 'private-server-id', extra: undefined },
    Object.create({ serverId: 'private-server-id' })
  ])('refuses malformed requests without leaking content (case %#)', async (request) => {
    const { reconnect, diagnosticLog, listener } = harness()
    await expect(listener({ sender: 'event-content' }, request)).resolves.toBeUndefined()
    expect(reconnect).not.toHaveBeenCalled()
    expect(diagnosticLog.event.mock.calls).toEqual([
      [{ event: 'reconnect-server-refused', code: 'malformed-request' }]
    ])
  })

  it('drops dispatch exception details and acknowledges without data', async () => {
    const reconnect = vi.fn<(serverId: string) => void>(() => {
      throw new Error('private-server-id private-payload /private/path')
    })
    const { diagnosticLog, listener } = harness(reconnect)
    await expect(listener({}, { serverId: 'private-server-id' })).resolves.toBeUndefined()
    expect(reconnect.mock.calls).toEqual([['private-server-id']])
    expect(diagnosticLog.event.mock.calls).toEqual([
      [{ event: 'reconnect-server-requested' }],
      [{ event: 'reconnect-server-failed', code: 'dispatch-failed' }]
    ])
  })
})
