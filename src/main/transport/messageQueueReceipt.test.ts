import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'

const decode = (fields: Record<string, unknown>) => parseInboundMessage(encodeEnvelope({
  id: 1, type: 'message', ts: '2026-10-05T12:00:00Z',
  payload: { conversation_id: 'c', message_id: 'm', role: 'user', text: 'copy', ...fields }
}))
describe('message queue receipt metadata', () => {
  it.each([true, false])('decodes sent_now=%s without coercion', sent_now => {
    const result = decode({ queued_msg_id: 7, sent_now })
    expect(result?.kind).toBe('message')
    if (result?.kind !== 'message') throw new Error('Missing receipt')
    expect(result.message).toMatchObject({ queued_msg_id: 7, sent_now })

  })
  it('does not add omitted fields to legacy payloads', () => {
    const result = decode({})
    if (result?.kind !== 'message') throw new Error('Missing receipt')
    expect(result.message).not.toHaveProperty('queued_msg_id')
    expect(result.message).not.toHaveProperty('sent_now')
  })
  it.each(['7', null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid queue id %s', queued_msg_id => {
    expect(() => decode({ queued_msg_id })).toThrow('invalid message queue identity')
  })
  it.each(['true', 1, null])('rejects invalid sent-now flag %s', sent_now => {
    expect(() => decode({ sent_now })).toThrow('invalid message delivery mode')
  })
})
