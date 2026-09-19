import { describe, expect, it } from 'vitest'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import { createQueueTurnEvidence } from './queueTurnEvidence'

const options = { conversationId: 'origin', markers: ['FIRST_DONE', 'SECOND_DONE', 'THIRD_DONE'] }
const delta = (turnId: string, text: string, conversationId = 'origin') =>
  ({ type: 'assistantDelta' as const, turnId, text, seq: 1, conversationId })
const end = (turnId: string, isError = false) =>
  ({ type: 'turnEnd' as const, turnId, conversationId: 'origin', stopReason: 'end_turn', isError })

describe('queued-turn evidence', () => {
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
