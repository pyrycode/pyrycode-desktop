import { describe, expect, it } from 'vitest'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import { createScriptedThread } from './scriptedThread'

const frame = (type: string, payload: Record<string, unknown>, extra = {}) =>
  encodeEnvelope({ id: 1, type, ts: '2026-10-15T00:00:00Z', payload, ...extra })
const decode = (frames: Uint8Array[]) => frames.map(decodeEnvelope)

describe('scripted fake daemon thread protocol', () => {
  it('publishes one assistant item and versioned appends without mixing conversations', () => {
    const bridge = createScriptedThread()
    const first = decode(bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 'turn', seq: 0, text: 'one' })))
    expect(first[0].type).toBe('thread_item_added')
    const second = decode(bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 'turn', seq: 1, text: 'two' })))
    expect(second[0]).toMatchObject({ type: 'thread_text_append', payload: { base_rev: 1, rev: 2, text: 'two', version: 2 } })
    expect(decode(bridge.publish(frame('assistant_delta', { conversation_id: 'b', turn_id: 'turn', seq: 0, text: 'other' })))[0])
      .toMatchObject({ type: 'thread_item_added', payload: { conversation_id: 'b', version: 1, item: { content: { text: 'other' } } } })
  })

  it('answers a complete catch-up from retained items and uses the requested checkpoint', () => {
    const bridge = createScriptedThread()
    bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 'turn', seq: 0, text: 'retained' }))
    const request = frame('thread_catch_up', { conversation_id: 'a', epoch: '', version: 0 }, { id: 99 })
    const reply = decode(bridge.reply(request, []))
    expect(reply).toHaveLength(2)
    expect(reply[0]).toMatchObject({ type: 'thread_items', in_reply_to: 99, payload: { final: false, items: [{ content: { text: 'retained' } }] } })
    expect(reply[1]).toMatchObject({ type: 'thread_items', in_reply_to: 99, payload: { final: true, older_exists: false } })
    const epoch = reply[1].payload.epoch
    expect(decode(bridge.reply(frame('thread_catch_up', { conversation_id: 'a', epoch, version: 1 }), []))[0])
      .toMatchObject({ payload: { final: true, from_version: 1 } })
  })

  it('preserves explicitly scripted thread responses byte for byte', () => {
    const bridge = createScriptedThread()
    const native = frame('thread_reset', { conversation_id: 'a', epoch: 'replacement', version: 3 })
    expect(bridge.publish(native)).toEqual([native])
    expect(bridge.reply(frame('thread_catch_up', { conversation_id: 'a', epoch: '', version: 0 }), [native])).toEqual([native])
  })

  it('adds matching session provenance to summaries and session readings', () => {
    const bridge = createScriptedThread()
    const summary = decode(bridge.publish(frame('conversations', { conversations: [{ id: 'a' }] })))[0]
    const reading = decode(bridge.publish(frame('turn_state', { conversation_id: 'a', state: 'thinking' })))[0]
    expect(summary.payload.conversations[0].current_session_id).toBe(reading.session_id)
    expect(reading.session_id).toBeTruthy()
    expect(decode(bridge.publish(frame('turn_state', { conversation_id: 'a', state: 'idle' }, { session_id: 'stale' })))[0].session_id).toBe('stale')
  })

  it('keeps genuine queue action handles while settling the same queued item', () => {
    const bridge = createScriptedThread()
    const added = decode(bridge.publish(frame('queue_state', { conversation_id: 'a', queued: [{ queued_msg_id: 7, text: 'queued' }] })))[0]
    expect(added).toMatchObject({ payload: { item: { kind: 'user_message', status: 'queued', active: true, content: { queued_msg_id: 7 } } } })
    const ended = decode(bridge.publish(frame('queue_state', { conversation_id: 'a', queued: [] })))[0]
    expect(ended).toMatchObject({ type: 'thread_item_changed', payload: { item_id: added.payload.item.id, changes: { active: false } } })
  })

  it('starts a new assistant run after a tool and keeps ordinary turn endings hidden', () => {
    const bridge = createScriptedThread()
    bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 't', seq: 1, text: 'before' }))
    bridge.publish(frame('tool_use', { conversation_id: 'a', turn_id: 't', tool_use_id: 'tool', name: 'Read' }))
    expect(decode(bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 't', seq: 2, text: 'after' })))[0])
      .toMatchObject({ type: 'thread_item_added', payload: { item: { content: { text: 'after' }, rev: 4 } } })
    const end = decode(bridge.publish(frame('turn_end', { conversation_id: 'a', turn_id: 't', stop_reason: 'end_turn' })))
    expect(end.find(frame => frame.type === 'thread_item_added')).toMatchObject({ payload: { item: { kind: 'turn_end', shown: false } } })
  })

  it('enriches a completed compaction in place', () => {
    const bridge = createScriptedThread()
    bridge.publish(frame('compacting', { conversation_id: 'a', active: true }))
    const done = decode(bridge.publish(frame('compacting', { conversation_id: 'a', active: false })))
    const updated = decode(bridge.publish(frame('compaction_boundary', { conversation_id: 'a', trigger: 'manual', pre_tokens: 10, post_tokens: 2 })))
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ type: 'thread_item_changed', payload: { item_id: done[0].payload.item.id,
      changes: { content: { trigger: 'manual', pre_tokens: 10, post_tokens: 2 } } } })
  })

  it('maps held history scripts to correlated complete thread windows and older pages', () => {
    const bridge = createScriptedThread({ history: true })
    const request = frame('thread_catch_up', { conversation_id: 'a', epoch: '', version: 0 }, { id: 99 })
    expect(decodeEnvelope(bridge.historyRequest(request)!)).toMatchObject({ type: 'request_history', payload: { cursor: '', conversation_id: 'a' } })
    expect(bridge.reply(request, [])).toEqual([])
    const message = (id: number) => ({ id, type: 'message', ts: '2026-10-15T00:00:00Z', payload: {
      conversation_id: 'a', role: 'user', message_id: `message-${id}`, text: `history ${id}` } })
    const first = decode(bridge.publish(frame('history_page', { entries: [message(20)], cursor: 'older', at_start: false }, { in_reply_to: 99 })))
    expect(first[0]).toMatchObject({ type: 'thread_items', in_reply_to: 99, payload: { items: [{ order: 40, content: { text: 'history 20' } }] } })
    expect(first.at(-1)).toMatchObject({ payload: { lower_order: 40, upper_order: 41, continuation: 40, older_exists: true } })
    const page = frame('thread_page', { conversation_id: 'a', before_order: 40 }, { id: 100 })
    expect(decodeEnvelope(bridge.historyRequest(page)!)).toMatchObject({ payload: { cursor: 'older' } })
    bridge.reply(page, [])
    const older = decode(bridge.publish(frame('history_page', { entries: [message(10)], cursor: '', at_start: true }, { in_reply_to: 100 })))
    expect(older[0]).toMatchObject({ type: 'thread_items', in_reply_to: 100, payload: { items: [{ order: 20, content: { text: 'history 10' } }] } })
    expect(older.at(-1)).toMatchObject({ payload: { upper_order: 40, older_exists: false } })
  })

  it('settles a scripted send only on matching live activity, using the app public identity', () => {
    const bridge = createScriptedThread()
    bridge.setDeviceId('public-device')
    bridge.reply(frame('send_message', { conversation_id: 'a', message_id: 'own', text: 'sent' }), [])
    const foreign = decode(bridge.publish(frame('assistant_delta', { conversation_id: 'b', turn_id: 't', seq: 0, text: 'other' })))
    expect(foreign.some(frame => frame.payload.item?.kind === 'user_message')).toBe(false)
    const own = decode(bridge.publish(frame('assistant_delta', { conversation_id: 'a', turn_id: 't', seq: 0, text: 'reply' })))
    expect(own[0]).toMatchObject({ payload: { item: { kind: 'user_message', content: { device_id: 'public-device', message_id: 'own', text: 'sent' } } } })
  })
  it('keeps a foreign receipt separate from an own send with the same message id', () => {
    const bridge = createScriptedThread()
    bridge.setDeviceId('desktop')
    bridge.reply(frame('send_message', { conversation_id: 'a', message_id: 'same', text: 'own text' }), [])
    const received = decode(bridge.publish(frame('message', { conversation_id: 'a', role: 'user',
      message_id: 'same', device_id: 'phone', text: 'foreign text' })))
    expect(received.at(-1)).toMatchObject({ payload: { item: { content: { device_id: 'phone', text: 'foreign text' } } } })
  })

  it('streams a large history window in bounded item batches before its certificate', () => {
    const bridge = createScriptedThread({ history: true })
    const request = frame('thread_catch_up', { conversation_id: 'a', epoch: '', version: 0 })
    const entries = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, type: 'message', ts: '2026-10-15T00:00:00Z',
      payload: { conversation_id: 'a', message_id: `m${i}`, role: 'user', text: 'A synthetic history message' } }))
    const frames = bridge.reply(request, [frame('history_page', { entries, cursor: '', at_start: true })])
    const replies = decode(frames)
    expect(replies.filter(reply => reply.payload.final === false).length).toBeGreaterThan(1)
    expect(replies.flatMap(reply => reply.payload.items)).toHaveLength(400)
    expect(replies.at(-1)?.payload.final).toBe(true)
  })

})
