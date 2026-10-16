import { expect, it } from 'vitest'
import { parseRecording, RecordedExchange, type Recording } from './recordedExchange'
import { encodeEnvelope, decodeEnvelope } from '../../src/main/transport/codec'
const message = (id: number, type: string, payload = {}) => ({ id, type, ts: '2026-10-16T00:00:00Z', payload })
const fixture = (): Recording => ({
  format: 'pyrycode.daemon-exchange', version: 2,
  source: { capturedAt: '2026-10-16T00:00:00Z', desktopRevision: 'a'.repeat(40), daemonRevision: 'b'.repeat(40),
    daemonBinarySha256: 'c'.repeat(64), claudeVersion: 'unit test' },
  scenario: { id: 'lifecycle-unit', inputs: { nonce: 1 } }, capabilities: ['interactive', 'thread'],
  deviceId: 'first', devices: ['first', 'second'],
  wire: [
    { direction: 'client', connection: 1, message: message(2, 'list_conversations') },
    { direction: 'daemon', connection: 1, message: message(3, 'conversations', { conversations: [] }) },
    { direction: 'client', connection: 2, message: message(2, 'list_conversations') },
    { direction: 'daemon', connection: 2, message: message(3, 'conversations', { conversations: [] }) }
  ]
})
it('requires each captured connection, resetting request IDs only across a real reconnect boundary', () => {
  const replay = new RecordedExchange(parseRecording(JSON.stringify(fixture())))
  replay.setDeviceId('actual-first')
  expect(replay.reply(encodeEnvelope(message(2, 'list_conversations'))).map(decodeEnvelope)).toHaveLength(1)
  expect(() => replay.reply(encodeEnvelope(message(2, 'list_conversations')))).toThrow('duplicate request ID')
  const fresh = new RecordedExchange(fixture())
  fresh.setDeviceId('actual-first')
  fresh.reply(encodeEnvelope(message(2, 'list_conversations')))
  expect(() => fresh.assertComplete()).toThrow('incomplete')
  fresh.reconnect('actual-second')
  expect(fresh.reply(encodeEnvelope(message(2, 'list_conversations'))).map(decodeEnvelope)).toHaveLength(1)
  expect(() => fresh.assertComplete()).not.toThrow()
})
it('holds captured daemon effects behind explicit test-side causal checkpoints', () => {
  const recording = fixture()
  recording.barriers = [{ before: 1, name: 'release-tool' }]
  const replay = new RecordedExchange(recording)
  replay.setDeviceId('actual')
  expect(replay.reply(encodeEnvelope(message(2, 'list_conversations')))).toEqual([])
  expect(() => replay.checkpoint('different')).toThrow('checkpoint mismatch')
  const valid = new RecordedExchange(recording)
  valid.setDeviceId('actual')
  valid.reply(encodeEnvelope(message(2, 'list_conversations')))
  expect(valid.checkpoint('release-tool').map(decodeEnvelope)).toHaveLength(1)
  expect(() => valid.checkpoint('release-tool')).toThrow('checkpoint mismatch')
})
it('rejects forged connection jumps and malformed checkpoint positions', () => {
  for (const change of [
    (r: Recording) => { r.wire[2].connection = 3 },
    (r: Recording) => { r.devices = ['first'] },
    (r: Recording) => { r.barriers = [{ before: 999, name: 'release' }] }
  ]) {
    const recording = fixture(); change(recording)
    expect(() => parseRecording(JSON.stringify(recording))).toThrow('Invalid daemon recording')
  }
})
