import { afterEach, expect, it, vi } from 'vitest'
import { parseRecording, RecordedExchange, type Recording } from './recordedExchange'
import { encodeEnvelope, decodeEnvelope } from '../../src/main/transport/codec'
import { createExchangeCapture } from './exchangeCapture'
import { startFakeRelayForwarder } from '../../src/main/transport/fakeRelayForwarder'
import { startFakeDaemon } from '../../src/main/transport/fakeDaemon'
import { createNoiseRelayDriver } from '../../src/main/transport/noiseRelayDriver'
const message = (id: number, type: string, payload = {}) => ({ id, type, ts: '2026-10-16T00:00:00Z', payload })
afterEach(() => vi.useRealTimers())
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

it('keeps a retiring connection alive until its own trailing request and replies settle', async () => {
  const replay = new RecordedExchange(fixture())
  let closed = false
  const retiring = replay.whenConnectionComplete().then(() => { closed = true })
  await Promise.resolve()
  expect(closed).toBe(false)
  expect(() => replay.reconnect()).toThrow('connection mismatch')
  await expect(retiring).rejects.toThrow('connection mismatch')

  const healthy = new RecordedExchange(fixture())
  const complete = healthy.whenConnectionComplete()
  expect(healthy.reply(encodeEnvelope(message(2, 'list_conversations'))).map(decodeEnvelope)).toHaveLength(1)
  await complete
  healthy.reconnect()
  healthy.reply(encodeEnvelope(message(2, 'list_conversations')))
  healthy.assertComplete()
})

it('never waits for a future connection or an unreleased test action during retirement', async () => {
  const recording = fixture()
  recording.barriers = [{ before: 1, name: 'future-action' }]
  const replay = new RecordedExchange(recording)
  replay.reply(encodeEnvelope(message(2, 'list_conversations')))
  await expect(replay.whenConnectionComplete()).rejects.toThrow('unreleased checkpoint')
})

it('bounds missing trailing requests and preserves the failure for final completion', async () => {
  vi.useFakeTimers()
  const replay = new RecordedExchange(fixture())
  const retiring = replay.whenConnectionComplete(50)
  const check = expect(retiring).rejects.toThrow('connection prefix incomplete')
  await vi.advanceTimersByTimeAsync(51)
  await check
  expect(() => replay.assertComplete()).toThrow('connection prefix incomplete')
})

// Capture observes send calls before the actual session attempts a socket write.
// Keep their session identity even when the transport already reported link-down.
function capturedTail(): Recording {
  const capture = createExchangeCapture()
  capture.begin()
  const first = capture.openConnection()
  capture.observe('client', encodeEnvelope(message(2, 'list_conversations')), first)
  capture.observe('daemon', encodeEnvelope(message(3, 'conversations', { conversations: [] })), first)
  capture.closeConnection(4413)
  capture.observe('client', encodeEnvelope(message(4, 'request_session_settings')), first)
  capture.observe('client', encodeEnvelope(message(5, 'request_model_list')), first)
  const second = capture.openConnection()
  capture.observe('client', encodeEnvelope(message(2, 'list_conversations', { archived: true })), second)
  capture.observe('daemon', encodeEnvelope(message(3, 'conversations', { conversations: [] })), second)
  const result = capture.takeConnections()
  expect(result.closures).toEqual([{ before: 2, connection: 1, code: 4413 }])
  expect(result.wire.map(entry => entry.connection)).toEqual([1, 1, 1, 1, 2, 2])
  return { ...fixture(), wire: result.wire, closures: result.closures }
}

it('replays a captured close only after its exact old-connection client-only suffix', () => {
  const recording = capturedTail()
  const replay = new RecordedExchange(recording)
  const close = vi.fn()
  replay.setTransportCloseObserver(close)
  expect(replay.reply(encodeEnvelope(message(20, 'list_conversations'))).map(decodeEnvelope))
    .toEqual([recording.wire[1].message])
  expect(close).not.toHaveBeenCalled()
  expect(replay.reply(encodeEnvelope(message(21, 'request_model_list')))).toEqual([])
  expect(close).not.toHaveBeenCalled()
  expect(() => replay.assertComplete()).toThrow('incomplete')
  expect(replay.reply(encodeEnvelope(message(22, 'request_session_settings')))).toEqual([])
  expect(close).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledWith({ code: 4413, afterServerFrames: 2 })
  expect(replay.start()).toEqual([])
  expect(close).toHaveBeenCalledTimes(1)
  replay.reconnect('actual-second')
  expect(replay.reply(encodeEnvelope(message(20, 'list_conversations', { archived: true }))).map(decodeEnvelope))
    .toEqual([recording.wire[5].message])
  replay.assertComplete()
  expect(recording.closures).toEqual([{ before: 2, connection: 1, code: 4413 }])
})

it.each(['changed', 'duplicate', 'extra', 'wrong-connection', 'early-reconnect'])(
  'keeps %s fatal while draining the captured client tail', kind => {
    const replay = new RecordedExchange(capturedTail())
    const close = vi.fn()
    replay.setTransportCloseObserver(close)
    replay.reply(encodeEnvelope(message(20, 'list_conversations')))
    const invalid = () => {
      if (kind === 'early-reconnect') return replay.reconnect()
      if (kind === 'duplicate') return replay.reply(encodeEnvelope(message(20, 'request_session_settings')))
      if (kind === 'extra') {
        replay.reply(encodeEnvelope(message(21, 'request_session_settings')))
        return replay.reply(encodeEnvelope(message(22, 'request_session_settings')))
      }
      return replay.reply(encodeEnvelope(kind === 'changed'
        ? message(21, 'request_session_settings', { changed: true })
        : message(21, 'list_conversations', { archived: true })))
    }
    let failure: unknown
    try { invalid() } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(close).not.toHaveBeenCalled()
    for (const operation of [() => replay.start(), () => replay.reconnect(),
      () => replay.reply(encodeEnvelope(message(23, 'request_model_list'))), () => replay.assertComplete()]) {
      try { operation(); expect.unreachable('sticky failure required') } catch (error) { expect(error).toBe(failure) }
    }
  })

it.each([false, true])('rejects extra calls after closing the drained tail (final connection: %s)', final => {
  const recording = capturedTail()
  if (final) { recording.wire = recording.wire.slice(0, 4); recording.devices = ['first'] }
  const replay = new RecordedExchange(recording)
  const close = vi.fn()
  replay.setTransportCloseObserver(close)
  replay.reply(encodeEnvelope(message(20, 'list_conversations')))
  replay.reply(encodeEnvelope(message(21, 'request_session_settings')))
  replay.reply(encodeEnvelope(message(22, 'request_model_list')))
  expect(close).toHaveBeenCalledTimes(1)
  if (final) replay.assertComplete()
  else expect(() => replay.assertComplete()).toThrow('incomplete')
  expect(() => replay.reply(encodeEnvelope(message(23, 'request_model_list')))).toThrow('request mismatch')
  expect(() => replay.assertComplete()).toThrow('request mismatch')
  expect(close).toHaveBeenCalledTimes(1)
})

it('bounds a missing captured-close tail with the existing connection deadline', async () => {
  vi.useFakeTimers()
  const replay = new RecordedExchange(capturedTail())
  const close = vi.fn()
  replay.setTransportCloseObserver(close)
  replay.reply(encodeEnvelope(message(20, 'list_conversations')))
  replay.reply(encodeEnvelope(message(21, 'request_session_settings')))
  const pending = expect(replay.whenConnectionComplete()).rejects.toThrow('connection prefix incomplete')
  await vi.advanceTimersByTimeAsync(4_999)
  expect(close).not.toHaveBeenCalled()
  expect(replay.stats().remainingRequests).toBe(2)
  await vi.advanceTimersByTimeAsync(1)
  await pending
  expect(vi.getTimerCount()).toBe(0)
  expect(() => replay.assertComplete()).toThrow('connection prefix incomplete')
  expect(() => replay.reply(encodeEnvelope(message(22, 'request_model_list')))).toThrow('connection prefix incomplete')
  expect(close).not.toHaveBeenCalled()
})

it('cannot drain across an unreleased checkpoint in the captured tail', async () => {
  const recording = capturedTail()
  recording.barriers = [{ before: 3, name: 'release-tail' }]
  const replay = new RecordedExchange(recording)
  const close = vi.fn()
  replay.setTransportCloseObserver(close)
  replay.reply(encodeEnvelope(message(20, 'list_conversations')))
  replay.reply(encodeEnvelope(message(21, 'request_session_settings')))
  await expect(replay.whenConnectionComplete()).rejects.toThrow('unreleased checkpoint')
  expect(close).not.toHaveBeenCalled()
  expect(replay.stats()).toEqual({ matchedRequests: 2, emittedFrames: 1, remainingRequests: 2 })
  expect(replay.checkpoint('release-tail')).toEqual([])
  replay.reply(encodeEnvelope(message(22, 'request_model_list')))
  expect(close).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledWith({ code: 4413, afterServerFrames: 2 })
  replay.reconnect()
  replay.reply(encodeEnvelope(message(20, 'list_conversations', { archived: true })))
  replay.assertComplete()

  const blocked = new RecordedExchange(recording)
  blocked.setTransportCloseObserver(vi.fn())
  blocked.reply(encodeEnvelope(message(20, 'list_conversations')))
  blocked.reply(encodeEnvelope(message(21, 'request_session_settings')))
  expect(() => blocked.reply(encodeEnvelope(message(22, 'request_model_list')))).toThrow('request mismatch')
  expect(() => blocked.assertComplete()).toThrow('request mismatch')
})

it('never forwards same-connection daemon data beyond a captured close', () => {
  const recording = capturedTail()
  recording.wire.splice(4, 0, { direction: 'daemon', connection: 1, message: message(6, 'conversations', { conversations: [] }) })
  const replay = new RecordedExchange(recording)
  const close = vi.fn()
  replay.setTransportCloseObserver(close)
  expect(replay.reply(encodeEnvelope(message(20, 'list_conversations'))).map(decodeEnvelope))
    .toEqual([recording.wire[1].message])
  replay.reply(encodeEnvelope(message(21, 'request_session_settings')))
  expect(() => replay.reply(encodeEnvelope(message(22, 'request_model_list')))).toThrow('transport boundary mismatch')
  expect(close).not.toHaveBeenCalled()
  expect(replay.stats().emittedFrames).toBe(1)
  expect(() => replay.assertComplete()).toThrow('transport boundary mismatch')
})

it('delivers the prefix then observes the actual relay close and reconnect after tail matching', async () => {
  const replay = new RecordedExchange(capturedTail())
  const relay = await startFakeRelayForwarder()
  const scheduled: unknown[] = [], codes: number[] = [], frames: unknown[] = []
  replay.setTransportCloseObserver(close => {
    scheduled.push(close)
    relay.closeClientAfterServerFrames(close.afterServerFrames, close.code)
  })
  const daemon = await startFakeDaemon({ url: relay.url,
    buildInitialFrames: () => replay.start(), buildReconnectFrames: () => replay.reconnect(),
    buildReplyFrames: bytes => replay.reply(bytes) })
  let resolveDone = () => {}, rejectDone = (_error: Error) => {}
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
  let handshakes = 0
  const driver = createNoiseRelayDriver({
    connection: { url: `${relay.url}/v1/client`, headers: {} },
    session: { staticPrivateKey: new Uint8Array(32).fill(7), remoteStaticPublicKey: daemon.staticPublicKey,
      prologue: new Uint8Array(0), hello: encodeEnvelope(message(1, 'hello')) },
    onEvent: event => {
      if (event.type === 'error') rejectDone(new Error(event.reason))
      if (event.type === 'relay-link-down') codes.push(event.code)
      if (event.type === 'handshake-complete') {
        handshakes++
        driver.sendMessage(encodeEnvelope(message(20, 'list_conversations', handshakes === 1 ? {} : { archived: true })))
      }
      if (event.type === 'message') {
        frames.push(decodeEnvelope(event.plaintext))
        if (frames.length === 1) {
          // The pre-close daemon prefix is actually received before the test supplies the tail.
          expect(scheduled).toEqual([])
          driver.sendMessage(encodeEnvelope(message(21, 'request_session_settings')))
          driver.sendMessage(encodeEnvelope(message(22, 'request_model_list')))
        } else resolveDone()
      }
    }
  })
  try {
    await done
    expect(handshakes).toBe(2)
    expect(codes).toEqual([4413])
    expect(scheduled).toEqual([{ code: 4413, afterServerFrames: 2 }])
    expect(frames).toEqual([message(3, 'conversations', { conversations: [] }), message(3, 'conversations', { conversations: [] })])
    expect(replay.stats()).toEqual({ matchedRequests: 4, emittedFrames: 2, remainingRequests: 0 })
    replay.assertComplete()
  } finally {
    driver.stop()
    await daemon.close()
    await relay.close()
  }
})
