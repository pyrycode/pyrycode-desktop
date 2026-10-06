import { describe, expect, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'

const payload = { conversation_id: 'c', session_id: 's', revision: 1, suggested_reply: 'Continue please' }
const frame = (value: unknown) => encodeEnvelope({ id: 91, type: 'reply_suggestion', ts: '2026-10-06T00:00:00Z', payload: value })

describe('reply suggestion validation', () => {
  it.each([null, ' Continue please ', 'é'.repeat(512), '😀'.repeat(256), '<script>inert</script>'])('preserves valid text or null', suggested_reply => {
    const logs: unknown[] = []
    const value = { ...payload, suggested_reply }
    const bytes = frame({ ...value, extra: 'private-extra' })
    expect(parseInboundMessage(bytes, { event: e => logs.push(e) })).toEqual({ kind: 'reply-suggestion', replySuggestion: value })
    expect(logs).toEqual([{ event: 'inbound-decoded', code: 'reply_suggestion', bytes: bytes.length, hash: expect.any(String) }])
    expect(JSON.stringify(logs)).not.toMatch(/Continue|private|script|suggested_reply/)
  })
  it.each(Object.keys(payload))('rejects absent and mistyped %s without content in diagnostics', key => {
    for (const value of [undefined, {}, [], true, false, ...(key === 'suggested_reply' ? [12] : [null])]) {
      const logs: unknown[] = []
      expect(() => parseInboundMessage(frame({ ...payload, [key]: value }), { event: e => logs.push(e) })).toThrow('invalid reply suggestion')
      expect(logs).toEqual([{ event: 'inbound-rejected', code: 'reply-suggestion-invalid' }])
    }
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects revision %j', revision => {
    expect(() => parseInboundMessage(frame({ ...payload, revision }))).toThrow('invalid reply suggestion')
  })
  it.each(['', ' \t ', 'a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', '\ud800', '\udc00', 'é'.repeat(513), '😀'.repeat(257)])('rejects invalid text', suggested_reply => {
    expect(() => parseInboundMessage(frame({ ...payload, suggested_reply }))).toThrow('invalid reply suggestion')
  })
  it.each([null, 12, [], 'private-payload'])('rejects malformed payload', value => {
    expect(() => parseInboundMessage(frame(value))).toThrow('invalid reply suggestion')
  })
  it('rejects invalid UTF-8 at the envelope boundary', () => {
    expect(() => parseInboundMessage(new Uint8Array([0xff]))).toThrow()
  })
})
