import { describe, expect, it, vi } from 'vitest'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import type { ThreadItem } from '../../src/shared/wire/thread'
import type { Envelope } from '../../src/shared/wire/types'
import { createCanonicalThread } from './canonicalThread'
import { selectThreadPublisher } from './threadPublisher'

const summary = { id: 'a', name: 'Authored', cwd: '/fake', workspace_label: null,
  is_promoted: false, is_archived: false, last_message_ts: '2026-10-21T00:00:00Z', last_used_at: '2026-10-21T00:00:00Z', current_session_id: 'explicit' }
const item = (id: number, text = `row ${id}`): ThreadItem => ({ id, order: id * 10, rev: 1,
  kind: 'assistant_message', status: 'running', active: true, shown: true, summary: '', content: { text } })
const frame = (type: string, payload: unknown, extra = {}) =>
  encodeEnvelope({ id: 1, type, ts: '2026-10-21T00:00:00Z', payload, ...extra })
const seed = () => ({ summary, epoch: 'epoch-a', version: 1, items: [item(3), item(1), item(2)] })
const query = (thread: ReturnType<typeof createCanonicalThread>, type = 'thread_catch_up', payload = {}, id = 99) =>
  thread.reply(frame(type, { conversation_id: 'a', epoch: '', version: 0, ...payload }, { id }), [])
    .map(bytes => decodeEnvelope(bytes) as Envelope & { payload: Record<string, any> })
const rows = (replies: ReturnType<typeof query>) => replies.flatMap(r => r.payload.items)
const update = (type: string, payload: unknown) => frame(type, { conversation_id: 'a', epoch: 'epoch-a', ...payload as object })

describe('canonical fake thread publisher', () => {
  it('certifies bounded ordered windows and empty threads', () => {
    const thread = createCanonicalThread({ conversations: [seed()], windowSize: 2 })
    const opening = query(thread)
    expect(rows(opening).map(i => i.id)).toEqual([2, 3])
    expect(opening.every(r => r.in_reply_to === 99)).toBe(true)
    expect(opening[0].payload.final).toBe(false)
    expect(opening.at(-1)?.payload).toEqual({ conversation_id: 'a', epoch: 'epoch-a', version: 1,
      items: [], final: true, lower_order: 20, upper_order: 31, continuation: 20, older_exists: true })
    const older = query(thread, 'thread_page', { before_order: 20, limit: 1 }, 100)
    expect(rows(older).map(i => i.id)).toEqual([1])
    expect(older.at(-1)).toMatchObject({ in_reply_to: 100, payload: { lower_order: 0, upper_order: 20, continuation: 0, older_exists: false } })
    const empty = createCanonicalThread({ conversations: [{ ...seed(), items: [] }] })
    expect(query(empty)).toMatchObject([{ payload: { items: [], final: true, older_exists: false, continuation: 0 } }])
    expect(rows(query(thread, 'thread_page', { before_order: 10 }))).toEqual([])
    expect(rows(query(thread, 'thread_catch_up', { limit: 1 })).map(i => i.id)).toEqual([3])
  })

  it('retains authored revisions and rejects wrong ownership', () => {
    const initial = seed(), thread = createCanonicalThread({ conversations: [initial] })
    initial.items[0].summary = 'caller mutation'
    const added = update('thread_item_added', { version: 2, item: item(4, 'added') })
    expect(thread.publish(added)).toEqual([added])
    const changed = update('thread_item_changed', { version: 3, item_id: 4, base_rev: 1, rev: 2,
      changes: { status: 'finished', active: false } })
    expect(thread.publish(changed)).toEqual([changed])
    const append = update('thread_text_append', { version: 4, item_id: 4, base_rev: 2, rev: 3, text: ' suffix' })
    expect(thread.publish(append)).toEqual([append])
    expect(rows(query(thread)).at(-1)).toEqual({ ...item(4, 'added suffix'), rev: 3, status: 'finished', active: false })
    expect(rows(query(thread))[2].summary).toBe('')
    expect(() => thread.publish(append)).toThrow()
    for (const bad of [
      { version: 5, item_id: 4, base_rev: 1, rev: 4, text: 'wrong base' },
      { version: 5, item_id: 999, base_rev: 3, rev: 4, text: 'missing' },
      { version: 5, epoch: 'foreign', item_id: 4, base_rev: 3, rev: 4, text: 'wrong epoch' },
      { version: 5, conversation_id: 'foreign', item_id: 4, base_rev: 3, rev: 4, text: 'wrong chat' }
    ]) expect(() => thread.publish(update('thread_text_append', bad))).toThrow()
    expect(() => thread.publish(update('thread_item_added', { version: 5, item: item(4) }))).toThrow()
    expect(() => thread.publish(update('thread_item_changed', { version: 5, item_id: 4, base_rev: 3, rev: 4,
      changes: { id: 999 } }))).toThrow()
    expect(rows(query(thread)).at(-1).content).toEqual({ text: 'added suffix' })
  })

  it('resumes checkpoints and replaces a different epoch', () => {
    const thread = createCanonicalThread({ conversations: [seed()], windowSize: 2 })
    thread.publish(update('thread_item_added', { version: 2, item: item(4) }))
    const catchup = query(thread, 'thread_catch_up', { epoch: 'epoch-a', version: 1 })
    expect(rows(catchup).map(i => i.id)).toEqual([4])
    expect(catchup.at(-1)?.payload).toEqual({ conversation_id: 'a', epoch: 'epoch-a', version: 2,
      items: [], final: true, from_version: 1 })
    expect(query(thread, 'thread_catch_up', { epoch: 'epoch-a', version: 2 })).toHaveLength(1)
    const replaced = query(thread, 'thread_catch_up', { epoch: 'retired', version: 100 })
    expect(rows(replaced).map(i => i.id)).toEqual([3, 4])
    expect(replaced.at(-1)?.payload).not.toHaveProperty('from_version')
    thread.setConversation({ ...seed(), epoch: 'replacement', version: 1, items: [item(1, 'reused identity')] })
    expect(rows(query(thread, 'thread_catch_up', { epoch: 'epoch-a', version: 2 }))[0].content.text).toBe('reused identity')
    expect(query(thread).at(-1)?.payload.epoch).toBe('replacement')
  })

  it('accepts one ordered same-revision suffix companion', () => {
    const thread = createCanonicalThread({ conversations: [seed()] })
    thread.publish(update('thread_item_changed', { version: 2, item_id: 1, base_rev: 1, rev: 2,
      changes: { status: 'finished', active: false } }))
    const suffix = update('thread_text_append', { version: 2, item_id: 1, base_rev: 2, rev: 2, text: ' companion' })
    expect(thread.publish(suffix)).toEqual([suffix])
    expect(rows(query(thread))[0].content.text).toBe('row 1 companion')
    expect(() => thread.publish(suffix)).toThrow()
  })

  it('isolates hosts, conversations and overlapping query identities', () => {
    const host = createCanonicalThread({ conversations: [seed(), { ...seed(), summary: { ...summary, id: 'b' },
      epoch: 'epoch-b', items: [item(1, 'other conversation')] }] })
    const otherHost = createCanonicalThread({ conversations: [{ ...seed(), items: [item(1, 'other host')] }] })
    host.publish(update('thread_item_added', { version: 2, item: item(4) }))
    const a = query(host, 'thread_catch_up', {}, 10)
    const b = query(host, 'thread_catch_up', { conversation_id: 'b' }, 11)
    expect(a.every(r => r.in_reply_to === 10 && r.payload.epoch === 'epoch-a' && r.payload.version === 2)).toBe(true)
    expect(b.every(r => r.in_reply_to === 11 && r.payload.epoch === 'epoch-b' && r.payload.version === 1)).toBe(true)
    expect(rows(b)[0].content.text).toBe('other conversation')
    expect(rows(query(otherHost))[0].content.text).toBe('other host')
  })

  it('never invents acceptance or session transitions', () => {
    const thread = createCanonicalThread({ conversations: [{ ...seed(), items: [] }] })
    expect(query(thread, 'send_message', { message_id: 'sent', text: 'pending' })).toEqual([])
    thread.publish(update('thread_item_added', { version: 2, item: item(1) }))
    const live = frame('turn_state', { conversation_id: 'a', state: 'streaming' }, { session_id: 'other-session' })
    expect(thread.publish(live)).toEqual([live])
    const controls = frame('session_settings_updated', { conversation_id: 'a' }, { session_id: 'explicit' })
    expect(thread.publish(controls)).toEqual([controls])
    const summaries = query(thread, 'list_conversations')
    expect(summaries[0].payload.conversations).toEqual([summary])
    expect(rows(query(thread)).map(i => i.kind)).toEqual(['assistant_message'])
    for (const type of ['message', 'assistant_delta', 'tool_use', 'tool_result', 'queue_state',
      'background_task_started', 'history_page', 'turn_end', 'session_transition'])
      expect(() => thread.publish(frame(type, {}))).toThrow(/unsupported/)
  })

  it('bounds data frames and returns a separate empty final certificate', () => {
    const thread = createCanonicalThread({ conversations: [{ ...seed(), items: Array.from({ length: 50 }, (_, n) => item(n + 1, 'x'.repeat(2000))) }] })
    const result = query(thread)
    expect(result.length).toBeGreaterThan(2)
    expect(rows(result)).toHaveLength(50)
    expect(result.slice(0, -1).every(r => r.payload.final === false && r.payload.items.length > 0)).toBe(true)
    expect(result.at(-1)?.payload.items).toEqual([])
  })

  it('selects canonical and native without constructing the adapter', () => {
    const adapter = vi.fn(() => { throw Error('adapter invoked') })
    const thread = createCanonicalThread({ conversations: [seed()] })
    expect(selectThreadPublisher({ threadMode: 'canonical', thread }, true, adapter)).toBe(thread)
    expect(selectThreadPublisher({ threadMode: 'native' }, true, adapter)).toBeUndefined()
    expect(adapter).not.toHaveBeenCalled()
    expect(() => selectThreadPublisher({}, true, adapter)).toThrow('adapter invoked')
    expect(adapter).toHaveBeenCalledWith({ history: true })
  })
})
