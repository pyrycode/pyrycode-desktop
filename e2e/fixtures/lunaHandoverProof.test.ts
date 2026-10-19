import { describe, expect, it } from 'vitest'
import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { completedHandoverReply } from './lunaHandoverProof'

const owner = { serverId: 'host', conversationId: 'chat', sessionId: 'session', agent: 'codex' as const }
const item = (id: number, kind: string, content: unknown, extra: Partial<ThreadItem> = {}): ThreadItem => ({
  id, kind, content, rev: id, status: 'completed', active: false, shown: true, summary: '',
  turn: 'turn', session: owner.sessionId, agent: owner.agent, ...extra
})
const answer = (extra: Partial<ThreadItem> = {}) => item(1, 'assistant_message', { text: 'code-fresh' }, extra)
const end = (content: Record<string, unknown> = {}, extra: Partial<ThreadItem> = {}) =>
  item(2, 'turn_end', { stop_reason: 'end_turn', ...content }, extra)
const update = (held: ThreadItem, epoch = 'epoch'): StampedDaemonEvent => ({
  type: 'threadUpdate', ...owner, update: { type: 'thread_item_added', payload: {
    conversation_id: owner.conversationId, epoch, version: held.rev, item: held
  } }, correlation: { id: held.rev, ts: '' }
})
const snapshot = (items: ThreadItem[], epoch = 'epoch'): StampedDaemonEvent => ({
  type: 'threadReply', ...owner, requestId: 'query', reply: { type: 'thread_items', payload: {
    conversation_id: owner.conversationId, epoch, version: 20, items, final: false
  } }, correlation: { id: 20, ts: '' }
})
const delta = { type: 'assistantDelta', ...owner, turnId: 'turn', text: 'code-fresh', seq: 0,
  envelopeSessionId: owner.sessionId } as StampedDaemonEvent
const legacyEnd = (fields: Record<string, unknown> = {}) => ({ type: 'turnEnd', ...owner,
  turnId: 'turn', stopReason: 'end_turn', envelopeSessionId: owner.sessionId, ...fields }) as StampedDaemonEvent

it.each([1, 99])('excludes tool-body data and final replies for item %i from fresh handover evidence', itemId => {
  const replies: StampedDaemonEvent[] = [false, true].map(final => ({
    type: 'threadReply', ...owner, requestId: 'detail', correlation: { id: 10, ts: '' },
    reply: { type: 'thread_tool_body', payload: { conversation_id: 'chat', epoch: 'epoch', version: 10,
      item_id: itemId, rev: 10, kind: 'tool_call', ...(final ? { final: true } : {
        final: false, content: { text: 'code-fresh', stop_reason: 'end_turn' }
      }) } }
  }))
  const patch = (update: ThreadUpdate): StampedDaemonEvent => ({ type: 'threadUpdate', ...owner, update,
    correlation: { id: update.payload.version, ts: '' } })
  const events = [update(answer({ content: { text: '' } }))]
  for (const reply of replies) {
    events.push(reply)
    expect(completedHandoverReply(events, 0, owner)).toBeUndefined()
    // An old assistant item cannot become fresh merely by reading its detail.
    expect(completedHandoverReply([...events, update(end())], 1, owner)).toBeUndefined()
    expect(completedHandoverReply([...events, update(end())], 0, owner)).toBeUndefined()
  }
  events.push(patch({ type: 'thread_item_changed', payload: { conversation_id: 'chat', epoch: 'epoch',
    version: 3, item_id: 1, base_rev: 1, rev: 3, changes: { content: { text: 'code-' } } } }))
  expect(completedHandoverReply(events, 0, owner)).toBeUndefined()
  events.push(...replies, patch({ type: 'thread_text_append', payload: { conversation_id: 'chat', epoch: 'epoch',
    version: 4, item_id: 1, base_rev: 3, rev: 4, text: 'fresh' } }), update(end()))
  const complete = completedHandoverReply(events, 0, owner)
  expect(complete?.text).toBe('code-fresh')
  for (const reply of replies) {
    events.push(reply)
    expect(completedHandoverReply(events, 0, owner)).toEqual(complete)
  }
})

describe.each(['legacy', 'thread'] as const)('%s handover completion', route => {
  const evidence = (fields: Record<string, unknown> = {}) => route === 'legacy'
    ? [delta, legacyEnd(fields)] : [update(answer()), update(end(fields))]
  it.each([
    ['Claude explicit success', 'success', 'completed'],
    ['Codex empty success', '', ''],
    ['omitted success', undefined, undefined],
    ['empty outcome only', '', 'completed'],
    ['empty terminal reason only', 'success', '']
  ])('accepts successful terminal shapes: %s', (_, outcome, reason) => {
    const fields = route === 'legacy' ? { outcome, terminalReason: reason } : { outcome, terminal_reason: reason }
    expect(completedHandoverReply(evidence(fields), 0, owner)?.text).toBe('code-fresh')
  })
  it.each([
    ['stop', 'cancelled'], ['stop', 'error'], ['error', true], ['outcome', 'error'],
    ['outcome', 'cancelled'], ['reason', 'cancelled'], ['reason', 'failed'], ['category', 'provider']
  ])('rejects unsuccessful completion: %s=%s', (field, value) => {
    const keys = route === 'legacy'
      ? { stop: 'stopReason', error: 'isError', outcome: 'outcome', reason: 'terminalReason', category: 'errorCategory' }
      : { stop: 'stop_reason', error: 'is_error', outcome: 'outcome', reason: 'terminal_reason', category: 'error_category' }
    expect(completedHandoverReply(evidence({ [keys[field as keyof typeof keys]]: value }), 0, owner)).toBeUndefined()
  })
  it.each(['serverId', 'conversationId', 'sessionId'] as const)('rejects mismatched %s', field => {
    expect(completedHandoverReply(evidence(), 0, { ...owner, [field]: 'other' })).toBeUndefined()
  })
  it('rejects mismatched turn and empty text', () => {
    const wrongTurn = route === 'legacy' ? [delta, legacyEnd({ turnId: 'other' })]
      : [update(answer()), update(end({}, { turn: 'other' }))]
    expect(completedHandoverReply(wrongTurn, 0, owner)).toBeUndefined()
    const empty = route === 'legacy' ? [{ ...delta, text: ' ' } as StampedDaemonEvent, legacyEnd()]
      : [update(answer({ content: { text: ' ' } })), update(end())]
    expect(completedHandoverReply(empty, 0, owner)).toBeUndefined()
  })
  it('requires assistant activity and completion after the checkpoint', () => {
    expect(completedHandoverReply(evidence(), 1, owner)).toBeUndefined()
    expect(completedHandoverReply(evidence(), 2, owner)).toBeUndefined()
  })
})

it('folds only correlated newer revisions without duplicate text', () => {
  const append: Extract<StampedDaemonEvent, { type: 'threadUpdate' }> = { type: 'threadUpdate', ...owner, update: {
    type: 'thread_text_append', payload: { conversation_id: 'chat', epoch: 'epoch', version: 3,
      item_id: 1, base_rev: 1, rev: 3, text: '-tail' }
  }, correlation: { id: 3, ts: '' } }
  const events = [update(answer()), append, append, snapshot([answer()]), update(end({}, { rev: 4 }))]
  expect(completedHandoverReply(events, 0, owner)?.text).toBe('code-fresh-tail')
  const change: StampedDaemonEvent = { ...append, update: { type: 'thread_item_changed', payload: {
    conversation_id: 'chat', epoch: 'epoch', version: 5, item_id: 1, base_rev: 3, rev: 5,
    changes: { content: { text: 'revised' } }
  } } }
  expect(completedHandoverReply([...events, change], 0, owner)?.text).toBe('revised')
  expect(completedHandoverReply([update(answer()), change, update(end())], 0, owner)?.text).toBe('code-fresh')
})

it('history alone and pre-send assistant activity cannot prove a fresh reply', () => {
  expect(completedHandoverReply([snapshot([answer(), end()])], 0, owner)).toBeUndefined()
  expect(completedHandoverReply([update(answer()), snapshot([answer(), end()])], 1, owner)).toBeUndefined()
  expect(completedHandoverReply([update(answer()), snapshot([answer(), end()])], 0, owner)?.text).toBe('code-fresh')
})

it('cannot combine different epochs, sessions, agents or child-agent replies', () => {
  expect(completedHandoverReply([update(answer()), update(end(), 'replacement')], 0, owner)).toBeUndefined()
  for (const extra of [{ parent: 9 }, { session: 'outgoing' }, { agent: 'claude' }]) {
    expect(completedHandoverReply([update(answer(extra)), update(end())], 0, owner)).toBeUndefined()
    expect(completedHandoverReply([update(answer()), update(end({}, extra))], 0, owner)).toBeUndefined()
  }
})

it('same-epoch reset discards held items before identifiers are reused', () => {
  const reset: StampedDaemonEvent = { type: 'threadReply', ...owner, requestId: 'reset', reply: {
    type: 'thread_reset', payload: { conversation_id: 'chat', epoch: 'epoch', version: 0 }
  }, correlation: { id: 9, ts: '' } }
  expect(completedHandoverReply([update(answer()), reset, update(end())], 0, owner)).toBeUndefined()
  expect(completedHandoverReply([update(answer()), reset, update(answer({ content: { text: 'new' } })),
    update(end())], 0, owner)?.text).toBe('new')
})

it('accepts Claude-owned thread items with explicit success metadata', () => {
  const fields = { agent: 'claude' }
  expect(completedHandoverReply([update(answer(fields)),
    update(end({ outcome: 'success', terminal_reason: 'completed', is_error: false }, fields))],
  0, { ...owner, agent: 'claude' })?.text).toBe('code-fresh')
})

it('does not join a valid answer to foreign-host, foreign-chat or misrouted terminals', () => {
  for (const foreign of [
    { ...update(end()), serverId: 'foreign' },
    { ...update(end()), conversationId: 'foreign' },
    { ...legacyEnd(), serverId: 'foreign' },
    { ...legacyEnd(), conversationId: 'foreign' }
  ]) expect(completedHandoverReply([delta, update(answer()), foreign], 0, owner)).toBeUndefined()
  const misrouted = update(end())
  if (misrouted.type !== 'threadUpdate') throw new Error('Fixture must be an update')
  misrouted.update.payload.conversation_id = 'foreign'
  expect(completedHandoverReply([update(answer()), misrouted], 0, owner)).toBeUndefined()
})

it('never reuses an old completion or falls back past a newer cancellation', () => {
  expect(completedHandoverReply([update(answer()), update(end()), snapshot([answer(), end()])], 2, owner)).toBeUndefined()
  expect(completedHandoverReply([update(answer()), update(end()),
    update(end({ terminal_reason: 'cancelled' }, { rev: 5 }))], 0, owner)).toBeUndefined()
  expect(completedHandoverReply([update(answer({ turn: undefined })),
    update(end({}, { turn: undefined }))], 0, owner)).toBeUndefined()
})
