import { describe, expect, it } from 'vitest'
import { decodeEnvelope, encodeEnvelope } from '../../src/main/transport/codec'
import { RecordedExchange, parseRecording, type Recording } from './recordedExchange'

const message = (id: number, type: string, payload: unknown, in_reply_to?: number) =>
  ({ id, type, ts: '2026-10-15T00:00:00Z', payload, ...(in_reply_to === undefined ? {} : { in_reply_to }) })
const fixture = (): Recording => ({
  format: 'pyrycode.daemon-exchange', version: 1,
  source: { capturedAt: '2026-10-15T00:00:00Z', desktopRevision: 'a'.repeat(40),
    daemonRevision: 'b'.repeat(40), daemonBinarySha256: 'c'.repeat(64), claudeVersion: 'test' },
  scenario: { id: 'permission-allow', prompt: 'hello', expectedReply: 'done', allowLabel: 'Allow once', historyRetry: false },
  capabilities: ['interactive', 'thread'], deviceId: 'old-device',
  wire: [
    { direction: 'client', message: message(3, 'list_conversations', {}) },
    { direction: 'daemon', message: message(10, 'conversations', { conversations: [{ id: 'chat', current_session_id: 'session' }] }, 3) },
    { direction: 'client', message: message(4, 'send_message', { conversation_id: 'chat', message_id: 'old-message', text: 'hello' }) },
    { direction: 'daemon', message: message(11, 'thread_item_added', { conversation_id: 'chat', item: { id: 1, content: {
      message_id: 'old-message', device_id: 'old-device' } } }) },
    { direction: 'daemon', message: message(12, 'modal_shown', { conversation_id: 'chat', modal_id: 'permission', session_id: 'session' }) },
    { direction: 'client', message: message(5, 'modal_answer', { modal_id: 'permission', option_id: 'allow_once', answer_token: 'old-answer' }) },
    { direction: 'daemon', message: message(13, 'assistant_delta', { conversation_id: 'chat', text: 'done' }) }
  ]
})
const send = (replay: RecordedExchange, id: number, type: string, payload: unknown) =>
  replay.reply(encodeEnvelope(message(id, type, payload))).map(decodeEnvelope)

describe('recorded daemon exchange', () => {
  it('binds fresh client identities, preserves correlation, and holds the reply until approval', () => {
    const replay = new RecordedExchange(fixture())
    replay.setDeviceId('fresh-device')
    const list = send(replay, 91, 'list_conversations', {})
    expect(list[0].in_reply_to).toBe(91)
    const chat = (list[0].payload as any).conversations[0]
    expect(chat.id).not.toBe('chat')
    const offered = send(replay, 92, 'send_message', { conversation_id: chat.id, message_id: 'fresh-message', text: 'hello' })
    expect((offered[0].payload as any).item.content).toEqual({ message_id: 'fresh-message', device_id: 'fresh-device' })
    const modal = offered[1].payload as any
    expect(modal.session_id).toBe(chat.current_session_id)
    expect(modal.modal_id).not.toBe('permission')
    expect(offered.map(e => e.type)).not.toContain('assistant_delta')
    expect(send(replay, 93, 'modal_answer', { modal_id: modal.modal_id, option_id: 'allow_once', answer_token: 'fresh-answer' })
      .map(e => e.type)).toEqual(['assistant_delta'])
    expect(() => replay.assertComplete()).not.toThrow()
  })
  it.each(['reject_once', 'allow_always'])('refuses an unrecorded choice %s and retains a sticky failure', option => {
    const replay = new RecordedExchange(fixture())
    const chat = (send(replay, 91, 'list_conversations', {})[0].payload as any).conversations[0].id
    const modal = send(replay, 92, 'send_message', { conversation_id: chat, message_id: 'fresh', text: 'hello' })[1].payload as any
    expect(() => send(replay, 93, 'modal_answer', { modal_id: modal.modal_id, option_id: option, answer_token: 'fresh' }))
      .toThrow('Recorded exchange request mismatch at step 3')
    expect(() => replay.assertComplete()).toThrow('Recorded exchange request mismatch at step 3')
  })
  it('never satisfies an early query with a future response or accepts extra requests', () => {
    const recording = fixture()
    recording.wire.push({ direction: 'client', message: message(6, 'list_conversations', {}) },
      { direction: 'daemon', message: message(14, 'conversations', { conversations: [] }, 6) })
    const replay = new RecordedExchange(recording)
    expect((send(replay, 91, 'list_conversations', {})[0].payload as any).conversations).toHaveLength(1)
    expect(() => send(replay, 92, 'list_conversations', {})).toThrow('step 2')
  })
  it('accepts reordered background queries but holds responses behind earlier unmatched requests', () => {
    const recording = fixture()
    recording.wire.splice(2, 0,
      { direction: 'client', message: message(6, 'request_model_list', {}) },
      { direction: 'client', message: message(7, 'request_context_usage', {}) },
      { direction: 'daemon', message: message(14, 'model_list', {}, 6) },
      { direction: 'daemon', message: message(15, 'context_usage', {}, 7) })
    const replay = new RecordedExchange(recording)
    send(replay, 91, 'list_conversations', {})
    expect(send(replay, 92, 'request_context_usage', {})).toEqual([])
    const released = send(replay, 93, 'request_model_list', {})
    expect(released.map(e => [e.type, e.in_reply_to])).toEqual([['model_list', 93], ['context_usage', 92]])
    expect(() => send(replay, 94, 'request_context_usage', {})).toThrow('step 4')
  })
  it('rejects wrong text, missing fields and unexpected fields without echoing content', () => {
    for (const payload of [{ text: 'PRIVATE_TRANSCRIPT' }, { text: 'hello', extra: true }, {}]) {
      const replay = new RecordedExchange(fixture())
      send(replay, 91, 'list_conversations', {})
      try { send(replay, 92, 'send_message', payload); expect.unreachable() }
      catch (error) { expect(String(error)).toBe('Error: Recorded exchange request mismatch at step 2') }
    }
  })
  it('requires every recorded request and rejects duplicate request IDs', () => {
    const replay = new RecordedExchange(fixture())
    send(replay, 91, 'list_conversations', {})
    expect(() => replay.assertComplete()).toThrow('Recorded exchange incomplete: 2 requests remain')
    expect(() => send(replay, 91, 'send_message', {})).toThrow('duplicate request ID')
  })
  it('treats additional captured commands as exact action barriers rather than reorderable queries', () => {
    const recording = fixture()
    recording.wire.splice(2, 0,
      { direction: 'client', message: message(6, 'mark_conversation_read', { conversation_id: 'chat', up_to: 13 }) },
      { direction: 'daemon', message: message(14, 'ack', {}, 6) })
    const replay = new RecordedExchange(recording)
    const chat = (send(replay, 91, 'list_conversations', {})[0].payload as any).conversations[0].id
    expect(send(replay, 92, 'mark_conversation_read', { conversation_id: chat, up_to: 13 })[0].in_reply_to).toBe(92)
    expect(() => send(replay, 93, 'mark_conversation_read', { conversation_id: chat, up_to: 99 })).toThrow('step 3')
  })
  it('requires a supported successful capture with correlated replies and no handshake or fragments', () => {
    for (const change of [
      (r: any) => { r.version = 2 },
      (r: any) => { r.source.daemonRevision = '' },
      (r: any) => { r.wire[0].direction = 'other' },
      (r: any) => { r.wire[1].message.in_reply_to = 999 },
      (r: any) => { r.wire[1].message.type = 'hello_ack' },
      (r: any) => { r.wire[1].message.type = 'multipart' },
      (r: any) => { r.wire[1].message.payload = { token: 'PRIVATE_TOKEN' } },
      (r: any) => { r.wire[1].message.payload = { text: 'sk-ant-PRIVATE' } }
    ]) {
      const recording = fixture(); change(recording)
      expect(() => parseRecording(JSON.stringify(recording))).toThrow('Invalid daemon recording')
    }
    expect(parseRecording(JSON.stringify(fixture()))).toEqual(fixture())
  })
})
