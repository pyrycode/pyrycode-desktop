import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { decodeEnvelope, encodeEnvelope } from './codec'
import { parseInboundMessage } from './inboundMessage'
import { createThreadUpdateReceiver } from './threadUpdates'
import type { Envelope } from '../../shared/wire/types'

const item = { id: 0, kind: 'future', rev: 3, status: 'future-status', active: false,
  shown: false, summary: '', content: JSON.parse('{"__proto__":{"polluted":true},"constructor":{},"deep":[null,false,0]}') }
const payload = (type: string, text = '') => ({ conversation_id: 'c', epoch: 'e', version: 5,
  ...(type === 'thread_item_added' ? { item: { ...item, summary: text } } :
    { item_id: 0, base_rev: 0, rev: 3, ...(type === 'thread_item_changed' ?
      { changes: { summary: text, active: false, parent: 0, content: null, future: {}, ...JSON.parse('{"__proto__":null}') } } : { text }) }) })
const envelope = (type: string, p: unknown): Envelope => ({ id: 9, type, ts: 'stamp', payload: p,
  in_reply_to: 2, event_id: 7, history_entry_id: 5 })
function parts(type: string, p: ReturnType<typeof payload>, size = 24000): Envelope[] {
  const json = JSON.stringify(p), bytes = Buffer.from(json)
  const update_id = createHash('sha256').update(type).update('\0').update(bytes).digest('hex')
  const metadata = { conversation_id: p.conversation_id, epoch: p.epoch, version: p.version,
    item_id: 0, rev: 3, ...(type === 'thread_item_added' ? {} : { base_rev: 0 }) }
  let offset = 0
  return Array.from({ length: Math.ceil(json.length / size) }, (_, index) => {
    const data = json.slice(index * size, (index + 1) * size), start = offset
    offset += Buffer.byteLength(data)
    return envelope(type, { ...metadata, data, continuation: { update_id, index,
      offset: start, total_bytes: bytes.length, final: offset === bytes.length } })
  })
}
const decode = (e: Envelope) => decodeEnvelope(encodeEnvelope(e))
const types = ['thread_item_added', 'thread_item_changed', 'thread_text_append']
afterEach(() => vi.useRealTimers())
describe('thread supplied delivery', () => {
  it.each(types)('validates ordinary %s and retains inert JSON, false/zero/null/empty replacements', type => {
    const events: unknown[] = [], receiver = createThreadUpdateReceiver(e => events.push(e))
    const e = envelope(type, payload(type))
    expect(parseInboundMessage(encodeEnvelope(e))).toEqual({ kind: 'thread-frame', envelope: decode(e) })
    receiver.receive(decode(e))
    expect(events).toEqual([{ kind: 'thread-update', update: { type, payload: payload(type) }, envelope: decode(e) }])
    expect({}).not.toHaveProperty('polluted')
  })
  it.each(types)('assembles oversized %s exactly once with multibyte offsets', type => {
    const events: unknown[] = [], receiver = createThreadUpdateReceiver(e => events.push(e))
    const p = payload(type, 'é'.repeat(75000)), frames = parts(type, p)
    frames.slice(0, -1).forEach(e => { receiver.receive(decode(e)); expect(events).toEqual([]) })
    receiver.receive(decode(frames.at(-1)!))
    expect(events).toEqual([{ kind: 'thread-update', update: { type, payload: p }, envelope: { ...decode(frames.at(-1)!), payload: p } }])
  })
})

describe('thread rejection and isolation', () => {
  const setup = () => {
    const events: any[] = [], log: any[] = []
    return { events, log, receiver: createThreadUpdateReceiver(e => events.push(e), { event: e => log.push(e) }) }
  }
  it('validates every full-item required/optional shape and all history numbers without inference', () => {
    const h = setup(), type = types[0]
    const full = { ...item, order: 0, ended_order: 0, parent: 0, no_child: true,
      session: 'recorded', agent: 'unknown-agent', turn: '', subtype: '' }
    h.receiver.receive(decode(envelope(type, { ...payload(type), item: full })))
    expect(h.events[0].update.payload.item).toEqual(full)
    for (const key of ['id', 'kind', 'rev', 'status', 'active', 'shown', 'summary', 'content']) {
      const missing: any = { ...full }; delete missing[key]
      h.receiver.receive(decode(envelope(type, { ...payload(type), item: missing })))
      expect(h.events.at(-1).kind).toBe('thread-repair')
    }
    for (const key of ['order', 'ended_order', 'parent', 'session', 'agent', 'turn', 'subtype', 'no_child']) {
      h.receiver.receive(decode(envelope(type, { ...payload(type), item: { ...full, [key]: null } })))
      expect(h.events.at(-1).kind).toBe('thread-repair')
    }
    for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '0']) {
      for (const key of ['version', 'item_id', 'base_rev', 'rev']) {
        h.receiver.receive(decode(envelope(types[2], { ...payload(types[2]), [key]: bad })))
        expect(h.events.at(-1).kind).toBe('thread-repair')
      }
      for (const key of ['id', 'rev', 'order', 'ended_order', 'parent']) {
        h.receiver.receive(decode(envelope(type, { ...payload(type), item: { ...full, [key]: bad } })))
        expect(h.events.at(-1).kind).toBe('thread-repair')
      }
    }
    for (const key of ['id', 'kind']) {
      h.receiver.receive(decode(envelope(types[1], { ...payload(types[1]), changes: { [key]: null } })))
      expect(h.events.at(-1).kind).toBe('thread-repair')
    }
    h.receiver.receive(decode(envelope(types[1], { ...payload(types[1]), changes: {} })))
    expect(h.events.at(-1).update.payload.changes).toEqual({})
    expect(h.log.every(e => Object.keys(e).every(k => ['event', 'code'].includes(k)))).toBe(true)
  })
  it.each(['index', 'offset', 'epoch', 'version', 'item_id', 'rev', 'base_rev', 'total_bytes', 'type', 'data', 'final', 'digest', 'routing', 'json'])('rejects %s disagreement while another conversation completes', field => {
    const h = setup(), f = parts(types[2], payload(types[2], 'x'.repeat(40000)))
    const other = parts(types[2], { ...payload(types[2], 'y'.repeat(40000)), conversation_id: 'other' })
    if (field === 'routing' || field === 'json') {
      const text = field === 'routing' ? JSON.stringify({ ...payload(types[2], 'x'.repeat(40000)), rev: 4 }) : '{invalid'
      const digest = createHash('sha256').update(types[2]).update('\0').update(text).digest('hex')
      f.splice(0, f.length, envelope(types[2], { conversation_id: 'c', epoch: 'e', version: 5,
        item_id: 0, base_rev: 0, rev: 3, data: text,
        continuation: { update_id: digest, index: 0, offset: 0, total_bytes: Buffer.byteLength(text), final: true } }))
    }
    h.receiver.receive(decode(other[0]))
    if (f.length > 1) {
      h.receiver.receive(decode(f[0]))
      const p: any = f[1].payload
      if (['index', 'offset', 'total_bytes'].includes(field)) p.continuation[field]++
      else if (field === 'type') f[1].type = types[1]
      else if (field === 'data') p.data = '\ud800'
      else if (field === 'final') p.continuation.final = 'true'
      else if (field === 'digest') p.data = p.data.replace('x', 'z')
      else p[field] = typeof p[field] === 'number' ? p[field] + 1 : 'changed'
    }
    h.receiver.receive(decode(f.at(-1)!))
    expect(h.events).toMatchObject([{ kind: 'thread-repair', conversationId: 'c' }])
    h.receiver.receive(decode(other[1]))
    expect(h.events.map(e => e.kind)).toEqual(['thread-repair', 'thread-update'])
    h.receiver.reset()
  })
  it.each(types)('rejects malformed %s parts, base_rev presence, missing/repeated starts and premature final', type => {
    const f = parts(type, payload(type, 'x'.repeat(60000)))
    for (const change of [(p: any) => { p.data = '' }, (p: any) => { p.continuation = null },
      (p: any) => { p.continuation.update_id = 'A'.repeat(64) }, (p: any) => { p.continuation.final = true },
      (p: any) => { if (type === types[0]) p.base_rev = 0; else delete p.base_rev }]) {
      const h = setup(), first = decode(f[0]); change(first.payload)
      h.receiver.receive(first)
      expect(h.events[0].kind).toBe('thread-repair'); h.receiver.reset()
    }
    for (const order of [[2], [0, 2], [0, 0], [1, 0, 2]]) {
      const h = setup(); order.forEach(i => h.receiver.receive(decode(f[i])))
      expect(h.events.some(e => e.kind === 'thread-update')).toBe(false); h.receiver.reset()
    }
  })
  it('drops unidentifiable malformed input and keeps isolated identical ids on independent receivers', () => {
    const a = setup(), b = setup(), f = parts(types[2], payload(types[2], 'x'.repeat(30000)))
    a.receiver.receive(envelope(types[2], null)); a.receiver.receive(envelope(types[2], { continuation: {} }))
    expect(a.events).toEqual([])
    a.receiver.receive(decode(f[0])); b.receiver.receive(decode(f[0]))
    a.receiver.reset(); b.receiver.receive(decode(f[1])); a.receiver.receive(decode(f[1]))
    expect(b.events[0].kind).toBe('thread-update'); expect(a.events[0].kind).toBe('thread-repair')
  })
  it('expires only after 30 seconds without an accepted part, and releases all reset timers', () => {
    vi.useFakeTimers()
    const h = setup(), f = parts(types[2], payload(types[2], 'x'.repeat(60000)))
    h.receiver.receive(decode(f[0])); vi.advanceTimersByTime(29999)
    h.receiver.receive(decode(f[1])); vi.advanceTimersByTime(29999); expect(h.events).toEqual([])
    h.receiver.receive(decode(f[2])); expect(h.events[0].kind).toBe('thread-update')
    h.receiver.receive(decode(f[0])); vi.advanceTimersByTime(30000)
    expect(h.events.at(-1)).toEqual({ kind: 'thread-repair', conversationId: 'c', reason: 'expired' })
    h.receiver.receive(decode(f[0])); h.receiver.reset(); expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(30000); expect(h.events).toHaveLength(2)
  })
  it('retains the existing exact plaintext frame boundary and rejects malformed UTF-8', () => {
    const e = envelope(types[2], payload(types[2])), overhead = encodeEnvelope(e).length
    const exact = envelope(types[2], payload(types[2], 'x'.repeat(65519 - overhead)))
    expect(parseInboundMessage(encodeEnvelope(exact))?.kind).toBe('thread-frame')
    expect(() => parseInboundMessage(Buffer.from(JSON.stringify(envelope(types[2], payload(types[2], 'x'.repeat(65520 - overhead))))))).toThrow()
    expect(() => parseInboundMessage(new Uint8Array([255]))).toThrow()
  })
  it('admits eight incomplete updates, rejects only the ninth, then reuses the released slot', () => {
    const h = setup(), f = Array.from({ length: 9 }, (_, i) => parts(types[2], { ...payload(types[2], 'x'.repeat(30000)), conversation_id: String(i) }))
    f.forEach(x => h.receiver.receive(decode(x[0])))
    expect(h.events).toEqual([{ kind: 'thread-repair', conversationId: '8', reason: 'limit' }])
    h.receiver.receive(decode(f[0][1])); h.receiver.receive(decode(f[8][0])); h.receiver.receive(decode(f[8][1]))
    expect(h.events.filter(e => e.kind === 'thread-update')).toHaveLength(2); h.receiver.reset()
  })
  it('enforces exact 8 MiB update and 16 MiB aggregate UTF-8 byte boundaries and releases overflow', () => {
    const h = setup(), size = 8 * 1024 * 1024
    const make = (conversation_id: string) => {
      const empty = { ...payload(types[2]), conversation_id }
      const p = { ...empty, text: 'x'.repeat(size - Buffer.byteLength(JSON.stringify(empty))) }
      const f = parts(types[2], p, 32000), last: any = f.pop()!.payload
      const data = last.data, index = last.continuation.index, offset = last.continuation.offset
      f.push(envelope(types[2], { ...last, data: data.slice(0, -1), continuation: { ...last.continuation, final: false } }))
      const final = envelope(types[2], { ...last, data: data.slice(-1), continuation: { ...last.continuation, index: index + 1, offset: offset + data.length - 1 } })
      return { f, final }
    }
    const a = make('a'), b = make('b')
    for (const f of [a.f, b.f]) f.forEach(e => h.receiver.receive(decode(e)))
    const c = parts(types[2], payload(types[2], 'abc'), 2)
    h.receiver.receive(decode(c[0])); expect(h.events).toEqual([]) // Exactly 16 MiB buffered.
    h.receiver.receive(decode(c[1])); expect(h.events[0].reason).toBe('limit')
    h.receiver.receive(decode(a.final)); h.receiver.receive(decode(b.final))
    expect(h.events.filter(e => e.kind === 'thread-update')).toHaveLength(2)
    const tooLarge: any = decode(c[0]); tooLarge.payload.continuation.total_bytes = size + 1
    h.receiver.receive(tooLarge); expect(h.events.at(-1).reason).toBe('limit')
    c.forEach(e => h.receiver.receive(decode(e))); expect(h.events.at(-1).kind).toBe('thread-update')
    h.receiver.reset()
  }, 20000)
})
it('complete single-part delivery does not occupy an incomplete-update slot', () => {
  const events: any[] = [], receiver = createThreadUpdateReceiver(e => events.push(e))
  for (let i = 0; i < 8; i++) receiver.receive(decode(parts(types[2], { ...payload(types[2], 'x'.repeat(30000)), conversation_id: String(i) })[0]))
  receiver.receive(decode(parts(types[2], { ...payload(types[2]), conversation_id: 'complete' })[0]))
  expect(events.at(-1).kind).toBe('thread-update'); receiver.reset()
})
