import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from '../../src/main/transport/codec'
import { createExchangeCapture } from './exchangeCapture'

const bytes = (type: string, payload: unknown = {}) => encodeEnvelope({ id: 1, type, ts: 'test', payload })
describe('test-build exchange capture', () => {
  it('stays inactive until begun and clears plaintext on stop', () => {
    const capture = createExchangeCapture()
    capture.observe('client', bytes('list_conversations'))
    expect(() => capture.take()).toThrow('not active')
    capture.begin()
    capture.observe('client', bytes('list_conversations'))
    expect(capture.take()).toHaveLength(1)
    capture.stop()
    capture.begin()
    expect(capture.take()).toEqual([])
  })
  it.each(['hello', 'hello_ack', 'rekey_request'])('rejects %s without throwing into the app', type => {
    const capture = createExchangeCapture(); capture.begin()
    expect(() => capture.observe('daemon', bytes(type, { token: 'DO_NOT_ECHO' }))).not.toThrow()
    expect(() => capture.take()).toThrow('Exchange capture rejected a frame')
  })
  it('bounds memory and retains a failure instead of exporting a partial capture', () => {
    const capture = createExchangeCapture({ maxBytes: 10 }); capture.begin()
    capture.observe('client', bytes('send_message'))
    expect(() => capture.take()).toThrow('Exchange capture exceeded its limit')
    capture.observe('client', bytes('list_conversations'))
    expect(() => capture.take()).toThrow('Exchange capture exceeded its limit')
  })
})

it('retains the actual complete application envelope, including routing and future metadata', () => {
  const capture = createExchangeCapture(); capture.begin()
  const message = { id: 9, type: 'turn_state', ts: 'stamp', payload: { conversation_id: 'chat', state: 'idle' },
    conversation_id: 'chat', session_id: 'session', future_metadata: { supplied: true } }
  capture.observe('daemon', Buffer.from(JSON.stringify(message)))
  expect(capture.take()[0].message).toEqual(message)
})

it('captures the observed transport close at its exact application-message prefix', () => {
  const capture = createExchangeCapture(); capture.begin()
  const connection = capture.openConnection()
  capture.observe('client', bytes('list_conversations'), connection)
  capture.closeConnection(4413)
  capture.openConnection()
  const result = capture.takeConnections()
  expect(result.closures).toEqual([{ before: 1, connection: 1, code: 4413 }])
  expect(result.connections).toBe(2)
})
