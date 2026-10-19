import { describe, expect, it } from 'vitest'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { createQueueTurnEvidence } from './queueTurnEvidence'

const options = { conversationId: 'origin', markers: ['FIRST_DONE', 'SECOND_DONE', 'THIRD_DONE'] }
const delta = (turnId: string, text: string, conversationId = 'origin') =>
  ({ type: 'assistantDelta' as const, turnId, text, seq: 1, conversationId })
const end = (turnId: string, isError = false) =>
  ({ type: 'turnEnd' as const, turnId, conversationId: 'origin', stopReason: 'end_turn', isError })

it.each([1, 99])('excludes tool-body data and final replies for item %i from queue evidence', itemId => {
  const proof = createQueueTurnEvidence(options)
  const update = (update: ThreadUpdate) => proof.observe({ type: 'threadUpdate',
    conversationId: 'origin', update, correlation: { id: update.payload.version, ts: '' } })
  const routing = { conversation_id: 'origin', epoch: 'epoch', version: 1 }
  const item = (id: number, kind: string, content: unknown): ThreadItem => ({
    id, rev: 1, kind, content, turn: 'one', status: 'queued', active: true, shown: true, summary: ''
  })
  update({ type: 'thread_item_added', payload: { ...routing, item: item(1, 'assistant_message', { text: '' }) } })
  update({ type: 'thread_item_added', payload: { ...routing,
    item: item(2, 'user_message', { message_id: 'follow-up' }) } })
  const replies: DaemonEvent[] = [false, true].map(final => ({ type: 'threadReply',
    conversationId: 'origin', requestId: 'detail', correlation: { id: 10, ts: '' }, reply: { type: 'thread_tool_body', payload: {
      ...routing, item_id: itemId, rev: 10, kind: 'tool_call', ...(final ? { final: true } : {
        final: false, content: { text: 'FIRST_DONE SECOND_DONE', stop_reason: 'end_turn' }
      })
    } } }))
  const incomplete = proof.snapshot([0])
  expect(incomplete.complete).toBe(false)
  expect(incomplete.turns[0]).toMatchObject({ markers: [], completions: 0 })
  expect(incomplete.queuedMessageIds).toEqual(['follow-up'])
  for (const reply of replies) {
    proof.observe(reply)
    expect(proof.snapshot([0])).toEqual(incomplete)
  }
  update({ type: 'thread_item_changed', payload: { ...routing, version: 3,
    item_id: 1, base_rev: 1, rev: 3, changes: { content: { text: 'FIRST_' } } } })
  replies.forEach(proof.observe)
  update({ type: 'thread_text_append', payload: { ...routing, version: 4,
    item_id: 1, base_rev: 3, rev: 4, text: 'DONE' } })
  expect(proof.snapshot([0]).turns[0]).toMatchObject({ markers: [0], completions: 0 })
  expect(proof.snapshot([0]).complete).toBe(false)
  update({ type: 'thread_item_added', payload: { ...routing, version: 5,
    item: item(3, 'turn_end', { stop_reason: 'end_turn' }) } })
  const complete = proof.snapshot([0])
  expect(complete.complete).toBe(true)
  expect(complete.turns[0].completions).toBe(1)
  for (const reply of replies) {
    proof.observe(reply)
    expect(proof.snapshot([0])).toEqual(complete)
  }
})

describe('queued-turn evidence', () => {
  it('uses negotiated authoritative queue and turn facts without raw event delivery', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe({ type: 'connected', ack: { capabilities: ['interactive', 'thread'],
      protocol_version: 1, server_id: 'host', conn_id: 'connection' } })
    const added = (item: Pick<ThreadItem, 'id' | 'rev' | 'kind' | 'content'> & Partial<ThreadItem>, version: number) =>
      proof.observe({ type: 'threadUpdate', conversationId: 'origin', correlation: { id: version, ts: '' },
        update: { type: 'thread_item_added', payload: { conversation_id: 'origin', epoch: 'epoch', version,
          item: { status: 'completed', active: false, shown: true, summary: '', ...item } } } })
    added({ id: 1, rev: 1, kind: 'user_message', status: 'queued', active: true, shown: true,
      content: { message_id: 'follow-up', queued_msg_id: 7 } }, 1)
    expect(proof.snapshot([]).queuedMessageIds).toEqual(['follow-up'])
    added({ id: 2, rev: 1, kind: 'assistant_message', turn: 'one', content: { text: 'FIRST_DONE' } }, 2)
    added({ id: 3, rev: 1, kind: 'turn_end', turn: 'one', content: { stop_reason: 'end_turn' } }, 3)
    expect(proof.snapshot([0]).complete).toBe(true)
    // Replayed terminal full items cannot manufacture a second completion.
    added({ id: 3, rev: 1, kind: 'turn_end', turn: 'one', content: { stop_reason: 'end_turn' } }, 3)
    expect(proof.snapshot([0]).turns[0].completions).toBe(1)
    // Withheld legacy events cannot provide the second turn's proof on this route.
    proof.observe(delta('two', 'SECOND_DONE')); proof.observe(end('two'))
    expect(proof.snapshot([0, 1]).complete).toBe(false)
  })
  it('binds to the UI-created conversation before its first turn', () => {
    const proof = createQueueTurnEvidence({ ...options, conversationId: '' })
    proof.observe({ type: 'conversationCreated', conversation: { id: 'origin' } } as DaemonEvent)
    proof.observe({ type: 'conversationCreated', conversation: { id: 'elsewhere' } } as DaemonEvent)
    proof.observe(delta('one', 'FIRST_DONE'))
    proof.observe(end('one'))
    expect(proof.snapshot([0]).conversationId).toBe('origin')
    expect(proof.snapshot([0]).complete).toBe(true)
  })

  it('correlates split markers with separate, ordered, completed turns', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe(delta('one', 'FIRST_'))
    proof.observe(delta('one', 'DONE'))
    proof.observe(end('one'))
    proof.observe(delta('two', 'SECOND_DONE'))
    proof.observe(end('two'))
    expect(proof.snapshot([0, 1]).complete).toBe(true)
    expect(proof.snapshot([0, 1]).turns.map(t => t.markers)).toEqual([[0], [1]])
    expect(JSON.stringify(proof.snapshot([0, 1]))).not.toContain('FIRST_')
  })

  it('cannot pass on an emptied queue or trailing output from the first turn', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe({ type: 'queueState', conversationId: 'origin', queued: [] })
    proof.observe(delta('one', 'FIRST_DONE and SECOND_DONE'))
    proof.observe(end('one'))
    expect(proof.snapshot([0, 1]).complete).toBe(false)
  })

  it('accepts absent optional stop details serialized as empty strings by the daemon', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe(delta('one', 'FIRST_DONE'))
    proof.observe({ ...end('one'), outcome: '', terminalReason: '', errorCategory: '' })
    expect(proof.snapshot([0]).complete).toBe(true)
  })

  it.each([{ outcome: 'error_max_turns' }, { terminalReason: 'prompt_too_long' }, { errorCategory: 'rate_limit' }])
    ('rejects a reported terminal failure %o', details => {
      const proof = createQueueTurnEvidence(options)
      proof.observe(delta('one', 'FIRST_DONE'))
      proof.observe({ ...end('one'), ...details })
      expect(proof.snapshot([0]).complete).toBe(false)
    })

  it.each(['missing completion', 'error', 'cancelled', 'duplicate completion', 'extra turn', 'reordered', 'overlap'])
    ('rejects %s', failure => {
      const proof = createQueueTurnEvidence(options)
      proof.observe(delta('one', failure === 'reordered' ? 'SECOND_DONE' : 'FIRST_DONE'))
      if (failure === 'overlap') proof.observe(delta('two', 'SECOND_DONE'))
      proof.observe(end('one'))
      if (failure !== 'overlap') proof.observe(delta('two', failure === 'reordered' ? 'FIRST_DONE' : 'SECOND_DONE'))
      if (failure !== 'missing completion') proof.observe({ ...end('two', failure === 'error'),
        stopReason: failure === 'cancelled' ? 'interrupted' : 'end_turn' })
      if (failure === 'duplicate completion') proof.observe(end('two'))
      if (failure === 'extra turn') proof.observe(delta('three', 'SECOND_DONE'))
      expect(proof.snapshot([0, 1]).complete).toBe(false)
    })

  it('ignores another conversation and proves the dropped marker never ran', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe(delta('foreign', 'SECOND_DONE', 'elsewhere'))
    proof.observe(delta('one', 'FIRST_DONE'))
    proof.observe(end('one'))
    proof.observe(delta('three', 'THIRD_DONE'))
    proof.observe(end('three'))
    expect(proof.snapshot([0, 2]).complete).toBe(true)
    proof.observe(delta('four', 'SECOND_DONE'))
    expect(proof.snapshot([0, 2]).complete).toBe(false)
  })

  it('retains only correlated queue ids and excludes text from snapshots', () => {
    const proof = createQueueTurnEvidence(options)
    proof.observe({ type: 'queueState', conversationId: 'origin', queued: [
      { queued_msg_id: 1, message_id: 'message-2', text: 'private body', ts: 'now' }
    ] })
    proof.observe({ type: 'queueState', conversationId: 'elsewhere', queued: [] })
    expect(proof.snapshot([0]).queuedMessageIds).toEqual(['message-2'])
    expect(JSON.stringify(proof.snapshot([0]))).not.toContain('private body')
  })
})

it('retains the captured field-change/text-suffix pair at one revision without counting a duplicate suffix', () => {
  const proof = createQueueTurnEvidence(options)
  const routing = { conversation_id: 'origin', epoch: 'epoch' }
  const update = (update: ThreadUpdate) => proof.observe({ type: 'threadUpdate', conversationId: 'origin',
    update, correlation: { id: update.payload.version, ts: '' } })
  update({ type: 'thread_item_added', payload: { ...routing, version: 19, item: { id: 19, rev: 19,
    kind: 'assistant_message', turn: 'one', content: { text: 'FIRST_' }, status: 'running', active: true, shown: true, summary: '' } } })
  update({ type: 'thread_item_changed', payload: { ...routing, version: 20, item_id: 19, base_rev: 19, rev: 20, changes: { summary: 'FIRST_DONE' } } })
  update({ type: 'thread_text_append', payload: { ...routing, version: 20, item_id: 19, base_rev: 20, rev: 20, text: 'DONE' } })
  update({ type: 'thread_text_append', payload: { ...routing, version: 20, item_id: 19, base_rev: 20, rev: 20, text: 'SECOND_DONE' } })
  update({ type: 'thread_item_added', payload: { ...routing, version: 22, item: { id: 21, rev: 21,
    kind: 'turn_end', turn: 'one', content: { stop_reason: 'end_turn' }, status: 'completed', active: false, shown: true, summary: '' } } })
  expect(proof.snapshot([0]).complete).toBe(true)
  expect(proof.snapshot([0]).turns[0].markers).toEqual([0])
})
