import { describe, expect, it } from 'vitest'
import type { DaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem } from '../../src/shared/wire/thread'
import { createQuestionAnswerEvidence } from './questionAnswerEvidence'

const confirmation = 'confirmation-unique-after-surface'
const answers = [{ question_index: 0, values: ['LRU cache'] }, { question_index: 1, values: [confirmation] }]
function setup() {
  const proof = createQuestionAnswerEvidence()
  const emit = (type: string, payload: object, host = 'host', chat = 'chat') => proof.observe({
    type: 'threadUpdate', serverId: host, conversationId: chat, correlation: { id: 1, ts: '' },
    update: { type, payload: { conversation_id: chat, epoch: 'epoch', version: 1, ...payload } }
  } as DaemonEvent)
  const item = (kind: string, id: number, content: object, turn = 'turn', extra = {}) => emit('thread_item_added', {
    item: { id, kind, rev: 1, status: 'running', active: true, shown: true, summary: '', turn, content, ...extra }
  })
  const shown = { type: 'questionShown', serverId: 'host', conversationId: 'chat', questionBatchId: 'batch', questions: [] } as unknown as DaemonEvent
  const dismiss = (overrides = {}) => proof.observe({ type: 'questionDismissed', serverId: 'host',
    questionBatchId: 'batch', outcome: 'answered', source: 'remote', ...overrides } as DaemonEvent)
  const submit = (overrides = {}) => proof.submit({ serverId: 'host', conversationId: 'chat', batchId: 'batch', answers, ...overrides })
  const end = (turn = 'turn', content = {}) => item('turn_end', 9, {
    stop_reason: 'end_turn', outcome: 'success', terminal_reason: 'completed', is_error: false, ...content
  }, turn)
  proof.observe(shown)
  item('tool_call', 1, { name: 'AskUserQuestion' })
  const arm = () => proof.arm({ confirmation, answers })
  const reply = (text = `Unlike LRU, LRU cache is chosen. Confirmation: ${confirmation}`, turn = 'turn', extra = {}) =>
    item('assistant_message', 2, { text }, turn, extra)
  const snapshot = (items: ThreadItem[], host = 'host', chat = 'chat', epoch = 'epoch') => proof.observe({
    type: 'threadReply', serverId: host, conversationId: chat, correlation: { id: 1, ts: '' },
    reply: { type: 'thread_items', payload: { conversation_id: chat, epoch, version: 1, items, final: false } }
  })
  const finish = () => { submit(); dismiss(); reply(); end() }
  return { proof, emit, item, shown, dismiss, submit, end, arm, reply, snapshot, finish }
}

describe('original question answer evidence', () => {
  it.each([
    `Unlike LRU, LRU cache is chosen. ${confirmation}`,
    `${confirmation}: selected LRU cache rather than LRU.`,
    `LRU and FIFO were alternatives; the selected policy is LRU cache. Received ${confirmation}.`
  ])('accepts varied prose and overlapping labels: %s', text => {
    const s = setup(); expect(s.arm()).toBe(true)
    s.submit(); s.dismiss(); s.reply(text); s.end()
    expect(s.proof.complete()).toBe(true)
  })
  it.each(['ignored answers', 'question restatement', 'missing submission', 'missing dismissal', 'missing completion'])('rejects %s', fault => {
    const s = setup(); s.arm()
    if (fault !== 'missing submission') s.submit()
    if (fault !== 'missing dismissal') s.dismiss()
    s.reply(fault === 'ignored answers' ? 'Proceeding.' : fault === 'question restatement' ? 'LRU, FIFO or LRU cache?' : confirmation)
    if (fault !== 'missing completion') s.end()
    expect(s.proof.complete()).toBe(false)
  })
  it.each([
    { serverId: 'other' }, { conversationId: 'other' }, { batchId: 'other' },
    { answers: [...answers].reverse() }, { answers: [{ question_index: 0, values: ['LRU'] }, answers[1]] },
    { answers: [answers[0], { question_index: 0, values: [confirmation] }] }
  ])('rejects wrong submission %j', fields => {
    const s = setup(); s.arm(); s.submit(fields); s.dismiss(); s.reply(); s.end()
    expect(s.proof.complete()).toBe(false)
  })
  it.each([{ serverId: 'other' }, { questionBatchId: 'other' }, { outcome: 'refused' }])('rejects wrong dismissal %j', fields => {
    const s = setup(); s.arm(); s.submit(); s.dismiss(fields); s.reply(); s.end()
    expect(s.proof.complete()).toBe(false)
  })
  it('rejects stale assistant content even when replayed after submission', () => {
    const s = setup(); s.reply(confirmation); s.arm(); s.submit(); s.dismiss(); s.reply(confirmation); s.end()
    expect(s.proof.complete()).toBe(false)
  })
  const snapshotAssistant: ThreadItem = { id: 2, rev: 1, kind: 'assistant_message', turn: 'turn',
    status: 'done', active: false, shown: true, summary: '', content: { text: confirmation } }
  const snapshotEnd: ThreadItem = { ...snapshotAssistant, id: 9, kind: 'turn_end', content: {
    stop_reason: 'end_turn', is_error: false, outcome: 'success', terminal_reason: 'completed'
  } }
  it('rejects a pre-arm snapshot replayed as identical live assistant and terminal items', () => {
    const s = setup(); s.snapshot([snapshotAssistant, snapshotEnd]); s.arm(); s.submit(); s.dismiss()
    s.emit('thread_item_added', { item: snapshotAssistant })
    s.emit('thread_item_added', { item: snapshotEnd })
    expect(s.proof.snapshot()).toMatchObject({ witnessed: false, completed: false })
    expect(s.proof.complete()).toBe(false)
  })
  it.each([false, true])('excludes snapshot text before live replay (already armed: %s)', armed => {
    for (const rev of [1, 2]) {
      const s = setup()
      if (armed) s.arm()
      s.snapshot([snapshotAssistant])
      if (!armed) s.arm()
      s.submit(); s.dismiss()
      s.emit('thread_item_added', { item: { ...snapshotAssistant, rev } }); s.end()
      expect(s.proof.snapshot().witnessed).toBe(false)
      expect(s.proof.complete()).toBe(false)
    }
  })
  it.each([false, true])('excludes snapshot terminal identity before live replay (already armed: %s)', armed => {
    for (const rev of [1, 2]) {
      const s = setup()
      if (armed) s.arm()
      s.snapshot([snapshotEnd])
      if (!armed) s.arm()
      s.submit(); s.dismiss(); s.reply()
      s.emit('thread_item_added', { item: { ...snapshotEnd, rev } })
      expect(s.proof.snapshot()).toMatchObject({ witnessed: true, completed: false })
      expect(s.proof.complete()).toBe(false)
    }
  })
  it('excludes snapshot text received after submission before a live replay', () => {
    const s = setup(); s.arm(); s.submit(); s.dismiss(); s.snapshot([snapshotAssistant])
    s.emit('thread_item_added', { item: { ...snapshotAssistant, rev: 2 } }); s.end()
    expect(s.proof.snapshot().witnessed).toBe(false)
    expect(s.proof.complete()).toBe(false)
  })
  it('accepts fresh live append and completion after a snapshot baseline without rolling revisions back', () => {
    const s = setup(); s.snapshot([{ ...snapshotAssistant, rev: 2, content: { text: 'Before.' } }])
    s.snapshot([{ ...snapshotAssistant, content: { text: 'Older.' } }]); s.arm()
    s.submit(); s.dismiss()
    s.emit('thread_text_append', { item_id: 2, base_rev: 2, rev: 3, text: confirmation })
    s.end()
    expect(s.proof.complete()).toBe(true)
  })
  it('ignores snapshot exclusions from another host or conversation', () => {
    for (const [host, chat] of [['other', 'chat'], ['host', 'other']]) {
      const s = setup(); s.snapshot([snapshotAssistant, snapshotEnd], host, chat); s.arm(); s.finish()
      expect(s.proof.complete()).toBe(true)
    }
  })
  it.each([false, true])('preserves paired live append freshness across snapshots (same item: %s)', sameItem => {
    const s = setup(); s.reply('Before.'); s.arm(); s.submit(); s.dismiss()
    s.emit('thread_item_changed', { item_id: 2, base_rev: 1, rev: 2, changes: { status: 'done' } })
    s.snapshot(sameItem ? [{ ...snapshotAssistant, rev: 2, content: { text: 'Before.' + confirmation } }] : [])
    s.emit('thread_text_append', { item_id: 2, base_rev: 2, rev: 2, text: confirmation })
    s.end()
    expect(s.proof.snapshot().witnessed).toBe(!sameItem)
    expect(s.proof.complete()).toBe(!sameItem)
  })
  it('rejects snapshot-only text and text on another route, turn or nested item', () => {
    for (const fault of ['snapshot', 'host', 'chat', 'turn', 'nested']) {
      const s = setup(); s.arm(); s.submit(); s.dismiss()
      if (fault === 'snapshot') s.snapshot([snapshotAssistant])
      else if (fault === 'turn' || fault === 'nested') s.reply(confirmation, fault === 'turn' ? 'other' : 'turn', fault === 'nested' ? { parent: 1 } : {})
      else s.emit('thread_item_added', { item: { id: 2, rev: 1, kind: 'assistant_message', turn: 'turn', content: { text: confirmation } } }, fault === 'host' ? 'other' : 'host', fault === 'chat' ? 'other' : 'chat')
      s.end(); expect(s.proof.complete()).toBe(false)
    }
  })
  it.each(['other turn', 'error', 'wrong reason', 'before witness'])('rejects completion %s', fault => {
    const s = setup(); s.arm(); s.submit(); s.dismiss()
    if (fault === 'before witness') s.end()
    s.reply()
    if (fault !== 'before witness') s.end(fault === 'other turn' ? 'other' : 'turn', fault === 'error' ? { is_error: true } : fault === 'wrong reason' ? { stop_reason: 'max_tokens' } : {})
    expect(s.proof.complete()).toBe(false)
  })
  it('requires an outstanding original batch and does not accept a replacement', () => {
    const s = setup(); s.dismiss(); expect(s.arm()).toBe(false)
    const t = setup(); t.arm(); t.proof.observe({ ...t.shown, questionBatchId: 'replacement' } as DaemonEvent); t.finish()
    expect(t.proof.complete()).toBe(false)
  })
  it('binds the original turn even when its tool update arrives before the question', () => {
    const s = setup()
    const p = createQuestionAnswerEvidence()
    p.observe({ type: 'conversationCreated', serverId: 'host', conversation: { id: 'chat' } } as DaemonEvent)
    p.observe({ type: 'threadUpdate', serverId: 'host', conversationId: 'chat', update: {
      type: 'thread_item_added', payload: { conversation_id: 'chat', epoch: 'epoch', version: 1,
        item: { id: 1, rev: 1, kind: 'tool_call', turn: 'turn', content: { name: 'AskUserQuestion' } } }
    } } as unknown as DaemonEvent)
    p.observe(s.shown)
    expect(p.arm({ confirmation, answers })).toBe(true)
    expect(p.identity().turn).toBe('turn')
  })
  it('rejects completion on a different host, conversation or epoch', () => {
    for (const fault of ['host', 'chat', 'epoch']) {
      const s = setup(); s.arm(); s.submit(); s.dismiss(); s.reply()
      s.emit('thread_item_added', { ...(fault === 'epoch' ? { epoch: 'new' } : {}), item: {
        id: 9, rev: 1, kind: 'turn_end', turn: 'turn', content: { stop_reason: 'end_turn' }
      } }, fault === 'host' ? 'other' : 'host', fault === 'chat' ? 'other' : 'chat')
      expect(s.proof.complete()).toBe(false)
    }
  })
  it('does not reuse a terminal item first seen before the witness', () => {
    const s = setup(); s.arm(); s.submit(); s.dismiss(); s.end(); s.reply()
    s.emit('thread_item_changed', { item_id: 9, base_rev: 1, rev: 2, changes: { status: 'done' } })
    expect(s.proof.complete()).toBe(false)
  })
  it('does not reject a correct witness because a snapshot-only user item later changes', () => {
    const s = setup(); s.arm()
    s.emit('thread_item_changed', { item_id: 20, base_rev: 1, rev: 8,
      changes: { status: 'done', content: { text: 'unrelated user message' } } })
    s.finish()
    expect(s.proof.complete()).toBe(true)
  })
  it('accepts fresh append text once and rejects prefix replacement or epoch reuse', () => {
    for (const fault of ['none', 'prefix', 'epoch']) {
      const s = setup(); s.reply('Before.'); s.arm(); s.submit(); s.dismiss()
      s.emit('thread_item_changed', { item_id: 2, base_rev: 1, rev: 2, changes: { status: 'done' } })
      s.emit('thread_text_append', { item_id: 2, base_rev: 2, rev: 2, text: confirmation, ...(fault === 'epoch' ? { epoch: 'new' } : {}) })
      if (fault === 'prefix') s.emit('thread_item_changed', { item_id: 2, base_rev: 2, rev: 3, changes: { content: { text: confirmation } } })
      s.end(); s.end()
      expect(s.proof.complete()).toBe(fault === 'none')
    }
  })
})
