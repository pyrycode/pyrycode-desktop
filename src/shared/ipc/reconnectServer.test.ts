import { describe, expect, it } from 'vitest'
import {
  RECONNECT_SERVER_CHANNEL,
  reconnectServerRequest,
  isReconnectServerRequest
} from './reconnectServer'

describe('reconnect-server request', () => {
  it('uses one fixed channel and constructs fresh requests', () => {
    expect(RECONNECT_SERVER_CHANNEL).toBe('pyry:reconnect-server')
    const request = reconnectServerRequest('alpha')
    expect(request).toEqual({ serverId: 'alpha' })
    expect(reconnectServerRequest('alpha')).not.toBe(request)
    expect(isReconnectServerRequest(request)).toBe(true)
  })

  it.each(['alpha', '', '__proto__', 'constructor', 'toString', 'a'.repeat(20_000)])(
    'accepts ordinary string ids (case %#)',
    (serverId) => {
      expect(reconnectServerRequest(serverId)).toEqual({ serverId })
      expect(isReconnectServerRequest({ serverId })).toBe(true)
    }
  )

  it.each([
    undefined, null, 'alpha', 1, true, Symbol('id'), () => {},
    [], ['alpha'], Object.assign([], { serverId: 'alpha' }),
    {}, { server: 'alpha' }, { serverId: undefined }, { serverId: null },
    { serverId: 1 }, { serverId: false }, { serverId: {} }, { serverId: ['alpha'] },
    Object.create({ serverId: 'alpha' }),
    { serverId: 'alpha', extra: 'payload' },
    { serverId: 'alpha', extra: undefined },
    { serverId: 'alpha', [Symbol('extra')]: undefined },
    Object.defineProperty({ serverId: 'alpha' }, 'extra', { value: undefined })
  ])('refuses malformed or extra-field requests (case %#)', (request) => {
    expect(isReconnectServerRequest(request)).toBe(false)
  })

  it('accepts the one own string field without requiring a prototype or enumerability', () => {
    expect(isReconnectServerRequest(Object.assign(Object.create(null), { serverId: '' })))
      .toBe(true)
    expect(isReconnectServerRequest(Object.defineProperty({}, 'serverId', { value: 'alpha' })))
      .toBe(true)
  })
})
