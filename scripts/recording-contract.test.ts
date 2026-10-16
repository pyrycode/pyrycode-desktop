import { describe, expect, it } from 'vitest'
import { requestContract } from './recording-contract.mjs'

const fixture = (conversation = 'recorded-chat') => ({ scenario: { id: 'permission-allow', historyRetry: true },
  wire: [
    { direction: 'client', message: { type: 'create_conversation', payload: { cwd: null } } },
    { direction: 'client', message: { type: 'request_model_list', payload: { conversation_id: conversation } } },
    { direction: 'client', message: { type: 'thread_catch_up', payload: { conversation_id: conversation, epoch: '', version: 0 } } },
    { direction: 'client', message: { type: 'send_message', payload: { conversation_id: conversation, message_id: 'fresh-message', text: 'hello' } } },
    { direction: 'client', message: { type: 'modal_answer', payload: { modal_id: 'fresh-modal', option_id: 'allow_once', answer_token: 'fresh-answer' } } }
  ] })
describe('recording request contract verification', () => {
  it('binds upload IDs to the same attachment list while detecting a substituted attachment', () => {
    const make = (id: string, sent = id) => ({ scenario: { id: 'attachment' }, wire: [
      { direction: 'client', message: { type: 'attachment_chunk', payload: { attachment_id: id, data: 'actual-bytes' } } },
      { direction: 'client', message: { type: 'send_message', payload: { attachment_ids: [sent], text: 'describe it' } } }
    ] })
    expect(requestContract(make('fresh-upload'))).toBe(requestContract(make('recorded-upload')))
    expect(requestContract(make('fresh-upload', 'different-upload'))).not.toBe(requestContract(make('recorded-upload')))
    const altered = make('fresh-upload')
    altered.wire[0].message.payload.data = 'different-bytes'
    expect(requestContract(altered)).not.toBe(requestContract(make('recorded-upload')))
  })
  it('accepts fresh opaque IDs and query reordering within the same action', () => {
    const fresh = fixture('another-chat')
    ;[fresh.wire[1], fresh.wire[2]] = [fresh.wire[2], fresh.wire[1]]
    fresh.wire[3].message.payload.message_id = 'another-message'
    fresh.wire[4].message.payload.modal_id = 'another-modal'
    fresh.wire[4].message.payload.answer_token = 'another-answer'
    expect(requestContract(fresh)).toBe(requestContract(fixture()))
  })
  it('detects changed choices, text, cursors and omitted query coverage', () => {
    for (const mutate of [
      (r: ReturnType<typeof fixture>) => { r.wire[4].message.payload.option_id = 'reject_once' },
      (r: ReturnType<typeof fixture>) => { r.wire[3].message.payload.text = 'different' },
      (r: ReturnType<typeof fixture>) => { r.wire[2].message.payload.version = 42 },
      (r: ReturnType<typeof fixture>) => { r.wire.splice(1, 1) },
      (r: ReturnType<typeof fixture>) => { [r.wire[2], r.wire[3]] = [r.wire[3], r.wire[2]] },
      (r: ReturnType<typeof fixture>) => { r.scenario.historyRetry = false }
    ]) {
      const fresh = fixture(); mutate(fresh)
      expect(requestContract(fresh)).not.toBe(requestContract(fixture()))
    }
  })
  it('accepts a fresh question batch identity but detects changed answers', () => {
    const make = (batch: string, value: string) => ({ ...fixture(), wire: [{ direction: 'client',
      message: { type: 'question_answer', payload: { question_batch_id: batch,
        answer_token: batch + '-answer', answers: [{ question_index: 0, values: [value] }] } } }] })
    expect(requestContract(make('fresh-batch', 'TTL'))).toBe(requestContract(make('old-batch', 'TTL')))
    expect(requestContract(make('fresh-batch', 'LRU'))).not.toBe(requestContract(make('old-batch', 'TTL')))
  })
})

it('compares explicit fresh scenario inputs but still detects altered content and causal checkpoints', () => {
  const make = (nonce: number) => ({ ...fixture(), scenario: { id: 'claude-queue-delivery', inputs: { nonce } },
    barriers: [{ before: 1, name: 'release-tool' }], wire: fixture().wire.map((entry, index) => index === 3
      ? { ...entry, message: { ...entry.message, payload: { ...entry.message.payload, text: `run=${nonce} reply briefly` } } } : entry) })
  expect(requestContract(make(123))).toBe(requestContract(make(456)))
  const changed = make(456)
  changed.wire[3].message.payload.text += ' using a different tool'
  expect(requestContract(changed)).not.toBe(requestContract(make(123)))
  const reordered = make(456)
  reordered.barriers[0].before = 3
  expect(requestContract(reordered)).not.toBe(requestContract(make(123)))
})
