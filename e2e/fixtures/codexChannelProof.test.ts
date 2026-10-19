import { expect, it } from 'vitest'
import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { createCodexChannelProof } from './codexChannelProof'

const routing = { conversation_id: 'chat', epoch: 'epoch', version: 1 }
const item = (id: number, kind: string, content: unknown): ThreadItem => ({
  id, rev: 1, kind, content, turn: 'one', status: 'completed', active: false, shown: true, summary: ''
})
const event = (update: ThreadUpdate, serverId = 'host', conversationId = 'chat'): Extract<StampedDaemonEvent, { type: 'threadUpdate' }> => ({
  type: 'threadUpdate', serverId, conversationId, update,
  correlation: { id: update.payload.version, ts: '' }
})

it.each([1, 99])('excludes tool-body data and final replies for item %i from Codex channel facts', itemId => {
  const proof = createCodexChannelProof()
  proof.record(event({ type: 'thread_item_added', payload: { ...routing,
    item: item(1, 'assistant_message', { text: '' }) } }))
  const replies: Extract<StampedDaemonEvent, { type: 'threadReply' }>[] = [false, true].map(final => ({ type: 'threadReply', serverId: 'host',
    conversationId: 'chat', requestId: 'detail', correlation: { id: 10, ts: '' },
    reply: { type: 'thread_tool_body', payload: { ...routing, item_id: itemId, rev: 10, kind: 'tool_call',
      ...(final ? { final: true } : { final: false, content: { text: 'expected reply', stop_reason: 'end_turn' } }) } }
  }))
  const incomplete = { deltas: proof.deltas(), ends: proof.ends() }
  expect(incomplete.deltas.map(delta => delta.text)).toEqual([''])
  expect(incomplete.ends).toHaveLength(0)
  for (const reply of replies) {
    proof.record(reply)
    expect({ deltas: proof.deltas(), ends: proof.ends() }).toEqual(incomplete)
  }
  proof.record(event({ type: 'thread_item_changed', payload: { ...routing, version: 2,
    item_id: 1, base_rev: 1, rev: 2, changes: { content: { text: 'expected' } } } }))
  replies.forEach(proof.record)
  proof.record(event({ type: 'thread_text_append', payload: { ...routing, version: 3,
    item_id: 1, base_rev: 2, rev: 3, text: ' reply' } }))
  expect(proof.deltas().map(delta => delta.text)).toEqual(['expected reply'])
  expect(proof.ends()).toHaveLength(0)
  proof.record(event({ type: 'thread_item_added', payload: { ...routing, version: 4,
    item: item(2, 'turn_end', { stop_reason: 'end_turn', is_error: false }) } }))
  const complete = { deltas: proof.deltas(), ends: proof.ends() }
  expect(complete.ends).toHaveLength(1)
  expect(complete.ends[0]).toMatchObject({ turnId: 'one', stopReason: 'end_turn', isError: false })
  for (const reply of replies) {
    proof.record(reply)
    expect({ deltas: proof.deltas(), ends: proof.ends() }).toEqual(complete)
  }
})

it('retains Codex scalar revision checks and host/chat/epoch ownership', () => {
  const proof = createCodexChannelProof()
  const added: ThreadUpdate = { type: 'thread_item_added', payload: { ...routing,
    item: item(1, 'assistant_message', { text: 'original' }) } }
  proof.record(event(added))
  for (const [serverId, conversationId, epoch] of [
    ['other', 'chat', 'epoch'], ['host', 'other', 'epoch'], ['host', 'chat', 'other']
  ]) proof.record(event({ ...added, payload: { ...added.payload, epoch } }, serverId, conversationId))
  const append: ThreadUpdate = { type: 'thread_text_append', payload: { ...routing,
    version: 2, item_id: 1, base_rev: 1, rev: 2, text: '-tail' } }
  proof.record(event(append))
  proof.record(event(append))
  proof.record(event(added))
  proof.record(event({ type: 'thread_text_append', payload: { ...routing,
    version: 3, item_id: 1, base_rev: 1, rev: 3, text: '-wrong-base' } }))
  expect(proof.deltas().map(delta => delta.text)).toEqual(['original-tail', 'original', 'original', 'original'])
})
