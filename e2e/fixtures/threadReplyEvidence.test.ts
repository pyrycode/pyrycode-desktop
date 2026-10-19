import { expect, it } from 'vitest'
import type { StampedDaemonEvent } from '../../src/shared/ipc/events'
import type { ThreadItem, ThreadUpdate } from '../../src/shared/wire/thread'
import { createThreadReplyEvidence, renderedRepliesMatch, savedRepliesMatch } from './threadReplyEvidence'

const route = { conversation_id: 'chat', epoch: 'epoch', version: 1 }
const item = (id: number, kind: string, content: object, extra: Partial<ThreadItem> = {}): ThreadItem => ({
  id, kind, rev: 1, session: 'session', agent: 'claude', turn: 'turn', order: id,
  status: 'done', active: false, shown: true, summary: '', content, ...extra
})
const user = () => item(1, 'user_message', { message_id: 'sent' }, { turn: undefined, status: 'delivered' })
const assistant = () => item(3, 'assistant_message', { text: 'An ordinary answer.' })
const end = () => item(4, 'turn_end', { stop_reason: 'end_turn', is_error: false, outcome: 'success', terminal_reason: 'completed' })
const event = (update: ThreadUpdate, serverId = 'host', conversationId = 'chat'): StampedDaemonEvent => ({
  type: 'threadUpdate', serverId, conversationId, update, correlation: { id: 1, ts: '' }
})
function setup() {
  const proof = createThreadReplyEvidence({ host: 'host', conversation: 'chat' })
  const add = (value: ThreadItem, host = 'host', chat = 'chat') => proof.observe(event({
    type: 'thread_item_added', payload: { ...route, item: value }
  }, host, chat))
  proof.mark()
  proof.send({ type: 'sendMessage', serverId: 'host', payload: { conversation_id: 'chat', message_id: 'sent', text: 'prompt' } })
  return { proof, add }
}

it('accepts non-marker text only after delivered input and matching normal completion', () => {
  const { proof, add } = setup()
  add(user()); add(assistant())
  expect(proof.reply()).toBeNull()
  add(end())
  expect(proof.reply()).toMatchObject({ id: 3, text: 'An ordinary answer.', turn: 'turn' })
})

it.each(['host', 'conversation', 'parent', 'session', 'turn', 'error', 'blank', 'message'])('rejects %s mismatch', mismatch => {
  const { proof, add } = setup()
  add(mismatch === 'message' ? { ...user(), content: { message_id: 'old' } } : user())
  // The first top-level work identifies the submitted turn, even before assistant text arrives.
  add(item(2, 'agent', {}))
  const a = assistant(), terminal = end()
  if (mismatch === 'parent') a.parent = 2
  if (mismatch === 'session') a.session = 'other'
  if (mismatch === 'turn') a.turn = 'other'
  if (mismatch === 'error') terminal.content = { stop_reason: 'end_turn', is_error: true }
  if (mismatch === 'blank') a.content = { text: '  ' }
  add(a, mismatch === 'host' ? 'other' : 'host', mismatch === 'conversation' ? 'other' : 'chat')
  add(terminal)
  expect(proof.reply()).toBeNull()
})

it.each(['host', 'conversation', 'epoch', 'session', 'agent', 'turn', 'parent', 'stop', 'outcome'])('rejects a %s completion from another source', mismatch => {
  const { proof, add } = setup()
  add(user()); add(assistant())
  const terminal = end()
  if (mismatch === 'session') terminal.session = 'other'
  if (mismatch === 'agent') terminal.agent = 'codex'
  if (mismatch === 'turn') terminal.turn = 'other'
  if (mismatch === 'parent') terminal.parent = 2
  if (mismatch === 'stop') terminal.content = { stop_reason: 'max_tokens' }
  if (mismatch === 'outcome') terminal.content = { stop_reason: 'end_turn', outcome: 'failed' }
  proof.observe(event({ type: 'thread_item_added', payload: { ...route,
    epoch: mismatch === 'epoch' ? 'other' : route.epoch, item: terminal
  } }, mismatch === 'host' ? 'other' : 'host', mismatch === 'conversation' ? 'other' : 'chat'))
  expect(proof.reply()).toBeNull()
})

it('rejects old items/turns despite new revisions and reset substitution', () => {
  const { proof, add } = setup()
  add(user()); add(assistant()); add(end())
  const first = proof.reply()!
  proof.mark()
  proof.send({ type: 'sendMessage', payload: { conversation_id: 'chat', message_id: 'next', text: 'next' } })
  add(item(5, 'user_message', { message_id: 'next' }, { turn: undefined, status: 'delivered' }))
  add({ ...assistant(), rev: 99, order: 6 }); add({ ...end(), rev: 99, order: 7 })
  expect(proof.reply()).toBeNull()
  add(item(8, 'assistant_message', { text: 'Second answer.' }, { turn: 'next-turn' }))
  add(item(9, 'turn_end', end().content as object, { turn: 'next-turn' }))
  const second = proof.reply()!
  const saved = { hostId: 'host', conversationId: 'chat', epoch: 'epoch', items: [assistant(), item(8, 'assistant_message', { text: second.text }, { turn: 'next-turn' })] }
  expect(savedRepliesMatch(saved, [first, second])).toBe(true)
  expect(savedRepliesMatch({ ...saved, items: [assistant()] }, [first, second])).toBe(false)
  expect(savedRepliesMatch({ ...saved, items: [assistant(), { ...assistant(), id: 8 }] }, [first, second])).toBe(false)
  expect(savedRepliesMatch({ ...saved, epoch: 'other' }, [first, second])).toBe(false)
  expect(savedRepliesMatch(null, [first, second])).toBe(false)
  expect(savedRepliesMatch({ ...saved, items: saved.items.map(i => ({ ...i, content: { text: 'Changed' } })) }, [first, second])).toBe(false)
  expect(savedRepliesMatch(saved, [first, first])).toBe(false)
})

it('keeps attributed identity/content across history redelivery and rejects changed reconnect text', () => {
  const { proof, add } = setup()
  add(user()); add(assistant()); add(end())
  const recorded = proof.reply()!
  add({ ...assistant(), rev: 2 })
  expect(proof.retained(recorded)).toBe(true)
  add({ ...assistant(), rev: 3, content: { text: 'Changed' } })
  expect(proof.retained(recorded)).toBe(false)
})

it('accepts revisions and one ordered same-revision suffix without changing identity', () => {
  const { proof, add } = setup()
  add(user()); add({ ...assistant(), active: true, status: 'running', content: { text: 'Hello' } })
  proof.observe(event({ type: 'thread_item_changed', payload: { ...route, version: 2, item_id: 3, base_rev: 1, rev: 2, changes: { summary: 'Hello world' } } }))
  const append: ThreadUpdate = { type: 'thread_text_append', payload: { ...route, version: 2, item_id: 3, base_rev: 2, rev: 2, text: ' world' } }
  proof.observe(event(append)); proof.observe(event(append))
  proof.observe(event({ type: 'thread_item_changed', payload: { ...route, version: 3, item_id: 3, base_rev: 2, rev: 3, changes: { active: false, status: 'done' } } }))
  add(end())
  expect(proof.reply()).toMatchObject({ id: 3, text: 'Hello world' })
  add({ ...assistant(), rev: 1 })
  expect(proof.reply()?.text).toBe('Hello world')
})

it('requires both native rendered identities when distinct replies have identical text', () => {
  const replies = [{ id: 3, text: 'An ordinary answer.' }, { id: 8, text: 'An ordinary answer.' }]
  const rows = replies.map(reply => ({ id: String(reply.id), text: reply.text }))
  expect(renderedRepliesMatch(rows, replies)).toBe(true)
  expect(renderedRepliesMatch(rows.slice(0, 1), replies)).toBe(false)
  expect(renderedRepliesMatch(rows.slice(1), replies)).toBe(false)
  expect(renderedRepliesMatch([rows[0], rows[0]], replies)).toBe(false)
  expect(renderedRepliesMatch([rows[0], { ...rows[1], id: null }], replies)).toBe(false)
  expect(renderedRepliesMatch([rows[0], { ...rows[1], id: '80' }], replies)).toBe(false)
  expect(renderedRepliesMatch([rows[0], { ...rows[1], text: 'Changed answer.' }], replies)).toBe(false)
})

it('compares settled rendered body text while ignoring layout whitespace', () => {
  expect(renderedRepliesMatch([{ id: '3', text: 'An ordinary\nanswer. ' }],
    [{ id: 3, text: 'An ordinary answer.' }])).toBe(true)
})
