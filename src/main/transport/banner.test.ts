import { describe, expect, expectTypeOf, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import type { BannerPayload, EnvelopeType } from '../../shared/wire/types'
import type { DaemonEvent } from '../../shared/ipc/events'

// The daemon's committed internal/protocol/testdata/banner.json payload.
const payload = { conversation_id: 'c1', level: 'warning',
  text: 'UserPromptSubmit operation blocked by hook', truncated: false, stops_turn: true } satisfies BannerPayload
const frame = (value: unknown) => encodeEnvelope({ id: 913, type: 'banner', ts: '2026-09-10T09:14:02Z', payload: value })

describe('banner wire contract', () => {
  it.each(['warning', 'info', 'notice', 'suggestion', '', 'future-level'])('preserves level %j and all five fields', level => {
    const value = { ...payload, level }
    const logs: unknown[] = []
    const bytes = frame({ ...value, extra: 'private-extra' })
    const decoded = parseInboundMessage(bytes, { event: entry => logs.push(entry) })
    expect(decoded).toEqual({ kind: 'banner', banner: value })
    if (decoded?.kind !== 'banner') throw new Error('wrong arm')
    expectTypeOf(decoded.banner).toEqualTypeOf<BannerPayload>()
    expectTypeOf<Extract<EnvelopeType, 'banner'>>().toEqualTypeOf<'banner'>()
    expectTypeOf<Extract<DaemonEvent, { type: 'banner' }>['stopsTurn']>().toEqualTypeOf<boolean>()
    expect(logs).toEqual([{ event: 'inbound-decoded', code: 'banner', bytes: bytes.length, hash: expect.any(String) }])
    expect(JSON.stringify(logs)).not.toMatch(/private|UserPromptSubmit|warning|future-level/)
  })
  it.each([false, true])('preserves empty strings and producer truncation %s without a second cap', truncated => {
    for (const text of ['', 'x'.repeat(5000)]) {
      const value = { ...payload, conversation_id: '', level: '', text, stops_turn: false, truncated }
      expect(parseInboundMessage(frame(value))).toEqual({ kind: 'banner', banner: value })
    }
  })
  it.each(Object.keys(payload))('rejects missing and mistyped %s', key => {
    const invalid = typeof payload[key as keyof typeof payload] === 'string'
      ? [undefined, null, false, 1, {}, []] : [undefined, null, '', 'false', 0, {}, []]
    for (const value of invalid) {
      const logs: unknown[] = []
      expect(() => parseInboundMessage(frame({ ...payload, [key]: value }), { event: entry => logs.push(entry) })).toThrow()
      expect(logs).toEqual([])
    }
  })
  it.each([null, [], 'text', 5])('rejects non-object payload %j', value => {
    expect(() => parseInboundMessage(frame(value))).toThrow()
  })
})
