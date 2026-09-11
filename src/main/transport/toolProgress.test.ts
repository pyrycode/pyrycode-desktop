import { describe, expect, expectTypeOf, it } from 'vitest'
import { encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import type { EnvelopeType, ToolProgressPayload } from '../../shared/wire/types'
import type { DaemonEvent } from '../../shared/ipc/events'

const payload = {
  conversation_id: 'conversation-11', turn_id: 'turn-22',
  tool_use_id: 'tool-progress-33', elapsed_seconds: -44
} satisfies ToolProgressPayload
const frame = (value: unknown) => encodeEnvelope({
  id: 914, type: 'tool_progress', ts: '2026-09-10T14:25:36Z', payload: value
})

describe('tool progress wire contract', () => {
  it.each([-65, -44, 0, 12, 65])('preserves signed integer reading %s and all upstream keys', (seconds) => {
    const value = { ...payload, elapsed_seconds: seconds }
    const entries: unknown[] = []
    const decoded = parseInboundMessage(frame({ ...value, extra: 'ignored' }), {
      event: (entry) => entries.push(entry)
    })
    expect(decoded).toEqual({ kind: 'tool-progress', toolProgress: value })
    expect(entries).toEqual([{
      event: 'inbound-decoded', code: 'tool_progress',
      bytes: expect.any(Number), hash: expect.any(String)
    }])
    if (decoded?.kind !== 'tool-progress') throw new Error('wrong arm')
    expectTypeOf(decoded.toolProgress).toEqualTypeOf<ToolProgressPayload>()
    expectTypeOf<ToolProgressPayload['elapsed_seconds']>().toEqualTypeOf<number>()
    expectTypeOf<Extract<EnvelopeType, 'tool_progress'>>().toEqualTypeOf<'tool_progress'>()
    expectTypeOf<Extract<DaemonEvent, { type: 'toolProgress' }>['elapsedSeconds']>().toEqualTypeOf<number>()
  })
  it.each(Object.keys(payload))('rejects missing or malformed %s', (key) => {
    for (const value of [undefined, null, {}, [], true]) {
      expect(() => parseInboundMessage(frame({ ...payload, [key]: value }))).toThrow()
    }
  })
  it.each(['65', 1.5, Infinity, NaN])('rejects non-integer elapsed %s', (elapsed_seconds) => {
    expect(() => parseInboundMessage(frame({ ...payload, elapsed_seconds }))).toThrow()
  })
  it.each(['conversation_id', 'turn_id', 'tool_use_id'])('rejects numeric %s', (key) => {
    expect(() => parseInboundMessage(frame({ ...payload, [key]: 12 }))).toThrow()
  })
  it.each([null, [], 'bad'])('rejects non-object payload %s', (value) => {
    expect(() => parseInboundMessage(frame(value))).toThrow()
  })
})
