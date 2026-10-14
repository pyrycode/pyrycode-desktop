import { describe, expect, it } from 'vitest'
import { selectEffortProof, waitForEffortProof, type EffortEvidence } from './effortProof'

const request = (conversation_id = 'channel'): EffortEvidence => ({ type: 'requestSessionSettings', payload: { conversation_id } })
const reading = (effort: string, conversationId = 'channel'): Extract<EffortEvidence, { type: 'runConfigReceived' }> => ({
  type: 'runConfigReceived', conversationId, sessionId: 'session', model: 'opus', effort, effectiveEffort: effort
})
const write: EffortEvidence = { type: 'setSessionSettings', changeId: 'change', payload: { session_id: 'session', effort: 'medium' } }
const ack: EffortEvidence = { type: 'sessionSettingsUpdated', changeId: 'change', sessionId: 'session' }
const intent = { conversationId: 'channel', effort: 'medium', confirmed: true }

describe('live effort proof ordering', () => {
  it('creation proof requires the created conversation rather than a previous chat', () => {
    const events: EffortEvidence[] = [request('previous'), { type: 'conversationCreated', conversationId: 'channel' },
      request(), reading('medium', 'previous')]
    expect(selectEffortProof(events, 0, { created: true }, 'medium')).toBeNull()
    events.push(reading('medium'))
    expect(selectEffortProof(events, 0, { created: true }, 'medium')?.conversationId).toBe('channel')
    expect(selectEffortProof([request(), reading('medium')], 0, { created: true }, 'medium')).toBeNull()
  })

  it('bounded polling re-samples the transitional applied reading', async () => {
    const events = [request(), write, ack, { ...reading('medium'), effectiveEffort: 'low' }]
    let samples = 0
    const result = await waitForEffortProof(async () => {
      if (++samples === 2) events.push(reading('medium'))
      return { events, footer: 'medium' }
    }, 0, { ...intent, effectiveEffort: 'medium' }, 1000)
    expect(samples).toBe(2)
    expect(result.effectiveEffort).toBe('medium')
  })

  it.each([
    ['obsolete only', [request(), write, ack, { ...reading('medium'), effectiveEffort: 'low' }], 'low'],
    ['unrelated only', [request(), write, ack, reading('medium', 'other')], 'medium'],
    ['wrong footer', [request(), write, ack, reading('medium')], 'low']
  ] as const)('bounded polling fails with %s', async (_name, events, footer) => {
    await expect(waitForEffortProof(async () => ({ events: [...events], footer }), 0, { ...intent, effectiveEffort: 'medium' }, 20))
      .rejects.toThrow('Timeout 20ms')
  })

  it('obsolete reply followed by current evidence', () => {
    const appliedIntent = { ...intent, effectiveEffort: 'medium' }
    const events = [request(), write, reading('low'), ack, request(), { ...reading('medium'), effectiveEffort: 'low' }]
    // Original showFresh freezes this low reading, then asserts it against the medium footer.
    const frozen = events.filter(e => e.type === 'runConfigReceived').at(-1)!
    expect(frozen.effectiveEffort).toBe('low')
    expect(selectEffortProof(events, 0, appliedIntent, 'low')).toBeNull()
    expect(selectEffortProof(events, 0, appliedIntent, 'medium')).toBeNull()
    events.push(reading('medium'))
    expect(frozen.effectiveEffort).not.toBe('medium')
    expect(selectEffortProof(events, 0, appliedIntent, 'medium')?.effectiveEffort).toBe('medium')
  })

  it('unrelated evidence cannot settle the operation', () => {
    const unrelatedAck: EffortEvidence = { ...ack, changeId: 'other' }
    expect(selectEffortProof([request(), write, unrelatedAck, reading('medium')], 0, intent, 'medium')).toBeNull()
    expect(selectEffortProof([request(), write, ack, reading('medium', 'other')], 0, intent, 'medium')).toBeNull()
    expect(selectEffortProof([request('other'), reading('medium', 'other')], 0, { conversationId: 'channel' }, 'medium')).toBeNull()
  })

  it('superseded evidence cannot pass', () => {
    const events = [request(), write, ack, reading('medium'), reading('low')]
    expect(selectEffortProof(events, 0, intent, 'medium')).toBeNull()
    events.push(reading('medium'))
    expect(selectEffortProof(events, 0, intent, 'medium')?.effort).toBe('medium')
    events.push({ ...write, changeId: 'next', payload: { session_id: 'session', effort: 'high' } })
    expect(selectEffortProof(events, 0, intent, 'medium')).toBeNull()
  })

  it('missing current evidence or incorrect footer stays pending', () => {
    expect(selectEffortProof([request(), write, reading('medium'), ack], 0, intent, 'medium')).toBeNull()
    expect(selectEffortProof([request(), write, ack, reading('low')], 0, intent, 'low')).toBeNull()
    const events = [request(), write, ack, reading('medium')]
    expect(selectEffortProof(events, 0, intent, 'low')).toBeNull()
    expect(selectEffortProof(events, 0, intent, 'medium')?.effort).toBe('medium')
  })

  it('checkpoints exclude previous operations on the same conversation', () => {
    const events = [request(), write, ack, reading('medium')]
    const after = events.length
    expect(selectEffortProof(events, after, intent, 'medium')).toBeNull()
    events.push(request(), reading('medium'))
    expect(selectEffortProof(events, after, intent, 'medium')).toBeNull()
    expect(selectEffortProof(events, after, { conversationId: 'channel', effectiveEffort: 'medium' }, 'medium')?.effort).toBe('medium')
  })

  it('keeps saved effort separate from the daemon footer oracle', () => {
    const events = [request(), write, ack, { ...reading('medium'), effectiveEffort: 'high' }]
    expect(selectEffortProof(events, 0, intent, 'medium')).toBeNull()
    expect(selectEffortProof(events, 0, intent, 'high')?.effectiveEffort).toBe('high')
    expect(selectEffortProof([request(), { ...reading(''), effectiveEffort: null }], 0, {}, 'Effort')?.effectiveEffort).toBeNull()
    expect(selectEffortProof([request(), { ...reading('medium'), effectiveEffort: undefined }], 0, {}, 'medium')?.effort).toBe('medium')
    expect(selectEffortProof([request(), { ...reading('medium'), effectiveEffort: undefined }], 0, { effectiveEffort: 'medium' }, 'medium')).toBeNull()
  })
})
