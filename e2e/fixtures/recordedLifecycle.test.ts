import { expect, it, vi } from 'vitest'
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

it('waits for the actual recorded prefix before releasing a successful live-proof checkpoint', async () => {
  const recording = fixture()
  recording.barriers = [{ before: 1, name: 'live-proof' }]
  const replay = new RecordedExchange(recording)
  replay.setDeviceId('actual')
  let finished = false
  const ready = replay.checkpointWhenReady('live-proof').then(frames => { finished = true; return frames })
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(replay.reply(encodeEnvelope(message(2, 'list_conversations')))).toEqual([])
  expect((await ready).map(decodeEnvelope)).toHaveLength(1)
  expect(finished).toBe(true)
})

it('requires the actual captured transport close after all preceding daemon frames', () => {
  const recording = fixture()
  recording.closures = [{ before: 2, connection: 1, code: 4413 }]
  const closes: unknown[] = []
  const replay = new RecordedExchange(recording)
  replay.setTransportCloseObserver(close => closes.push(close))
  replay.setDeviceId('actual')
  expect(closes).toEqual([])
  expect(replay.reply(encodeEnvelope(message(2, 'list_conversations'))).map(decodeEnvelope)).toHaveLength(1)
  expect(closes).toEqual([{ code: 4413, afterServerFrames: 2 }])
  replay.reconnect()
  replay.reply(encodeEnvelope(message(2, 'list_conversations')))
  expect(() => replay.assertComplete()).not.toThrow()
  const missing = new RecordedExchange(recording)
  expect(() => missing.reply(encodeEnvelope(message(2, 'list_conversations')))).toThrow('transport boundary mismatch')
})

it('settles only the current connection without needing a future request', async () => {
  const replay = new RecordedExchange(fixture())
  const pending = replay.settleConnection()
  const frames = replay.reply(encodeEnvelope(message(2, 'list_conversations')))
  expect(frames).toHaveLength(1)
  await pending
  expect(replay.stats().remainingRequests).toBe(1)
  expect(() => replay.assertComplete()).toThrow('incomplete')
  replay.reconnect()
  const next = replay.settleConnection()
  replay.reply(encodeEnvelope(message(2, 'list_conversations')))
  await next
  await replay.settleConnection()
  replay.assertComplete()
})

it('bounds a persistent missing prefix, keeps failure sticky and removes the deadline', async () => {
  vi.useFakeTimers()
  try {
    const replay = new RecordedExchange(fixture())
    const pending = replay.settleConnection()
    const failure = expect(pending).rejects.toThrow('connection prefix incomplete')
    await vi.advanceTimersByTimeAsync(5_000)
    await failure
    expect(vi.getTimerCount()).toBe(0)
    expect(() => replay.reply(encodeEnvelope(message(2, 'list_conversations')))).toThrow('connection prefix incomplete')
    await expect(replay.settleConnection()).rejects.toThrow('connection prefix incomplete')
    expect(() => replay.assertComplete()).toThrow('connection prefix incomplete')
  } finally { vi.useRealTimers() }
})

it('rejects unreleased test-side actions without waiting or releasing their frames', async () => {
  vi.useFakeTimers()
  try {
    const capture = fixture()
    capture.barriers = [{ before: 1, name: 'release-tool' }]
    const replay = new RecordedExchange(capture)
    replay.reply(encodeEnvelope(message(2, 'list_conversations')))
    await expect(replay.settleConnection()).rejects.toThrow('connection has unreleased checkpoint')
    expect(replay.stats().emittedFrames).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('propagates a concurrent mismatch unchanged and clears all settlement waiters', async () => {
  vi.useFakeTimers()
  try {
    const replay = new RecordedExchange(fixture())
    const waits = [replay.settleConnection(), replay.settleConnection()]
    const outcomes = Promise.all(waits.map(wait => wait.catch(error => error)))
    let failure: unknown
    try { replay.reconnect() } catch (error) { failure = error }
    expect(await outcomes).toEqual([failure, failure])
    expect(vi.getTimerCount()).toBe(0)
    expect(() => replay.assertComplete()).toThrow('connection mismatch')
  } finally { vi.useRealTimers() }
})

it('does not require a checkpoint belonging to the independent next connection', async () => {
  const capture = fixture()
  capture.barriers = [{ before: 2, name: 'next-profile-action' }]
  const replay = new RecordedExchange(capture)
  replay.reply(encodeEnvelope(message(2, 'list_conversations')))
  await replay.settleConnection()
  expect(() => replay.reconnect()).toThrow('connection mismatch')
})
