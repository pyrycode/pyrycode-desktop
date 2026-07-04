import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDaemonConnection,
  type DaemonConnection,
  type DaemonConnectionDeps
} from './daemonConnection'
import type { DaemonEvent } from '../shared/ipc/events'
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DeviceKeyPair, DeviceKeypairStore } from './deviceKeypair'
import type { PairedServerRecord, PairedServerStore } from './pairedServerStore'
import { MalformedPairedServerRecordError } from './pairedServerStore'
import type {
  NoiseRelayDriver,
  NoiseRelayDriverConfig,
  RelaySessionEvent
} from './transport/noiseRelayDriver'
import { base64StdEncode, base64StdDecode, encodeEnvelope, decodeEnvelope } from './transport/codec'
import { MAX_PLAINTEXT_BYTES, type SendMessagePayload } from '../shared/wire/types'

// This consumer is a pure in-process composition, so its tests inject fakes at the three seams
// only — the two stores (`ensure()` / `load()`), a fake driver factory (captures the config it is
// constructed with and lets the test drive `RelaySessionEvent`s back in), and a spied sink — while
// using the REAL #5 codec + #10 envelope so the assertions pin actual wire bytes (the sourced
// token inside the `hello`, the decoded 32-byte server key). Mirrors noiseRelayDriver.test.ts one
// layer up.

// --- fixtures ------------------------------------------------------------------------------
const PAIR: DeviceKeyPair = {
  privateKey: new Uint8Array(32).fill(0x11),
  publicKey: new Uint8Array(32).fill(0x22)
}
const SERVER_KEY = new Uint8Array(32).fill(0x33)
const TOKEN = 'tok-secret-do-not-leak'
const RECORD: PairedServerRecord = {
  server: 'srv-1',
  relay: 'wss://relay.example/v1/client',
  token: TOKEN,
  server_static_pubkey: base64StdEncode(SERVER_KEY)
}
const FIXED_TS = '2026-07-04T12:00:00.000Z'

/** A valid `hello_ack` the daemon would send back, encoded through the real codec. */
function validHelloAck(): Uint8Array {
  return encodeEnvelope({
    id: 2,
    type: 'hello_ack',
    ts: FIXED_TS,
    payload: { protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1' }
  })
}

// --- fake driver factory -------------------------------------------------------------------
interface FakeDriver {
  config: NoiseRelayDriverConfig
  stopped: boolean
  /** Every plaintext handed to the driver's sendMessage, in order. */
  sent: Uint8Array[]
  handle: NoiseRelayDriver
  /** Drive a RelaySessionEvent back into the consumer's onEvent handler. */
  emit(event: RelaySessionEvent): void
}

function makeDriverFactory(options: { throwOnSend?: boolean } = {}): {
  createDriver: (config: NoiseRelayDriverConfig) => NoiseRelayDriver
  drivers: FakeDriver[]
} {
  const drivers: FakeDriver[] = []
  return {
    drivers,
    createDriver(config) {
      const fake: FakeDriver = {
        config,
        stopped: false,
        sent: [],
        emit: (event) => config.onEvent(event),
        handle: {
          // Record what the connection forwards. The driver's own inertness (pre-handshake /
          // post-terminal) is NOT modelled here — that contract is proven by
          // noiseRelayDriver.test.ts:304-358; this layer only tests what it hands the driver.
          sendMessage(plaintext) {
            if (options.throwOnSend) throw new Error('driver send boom')
            fake.sent.push(plaintext)
          },
          stop() {
            fake.stopped = true
          }
        }
      }
      drivers.push(fake)
      return fake.handle
    }
  }
}

// --- sink ----------------------------------------------------------------------------------
function fakeSink(): DaemonEventSink & { webContents: { send: ReturnType<typeof vi.fn> } } {
  return { webContents: { send: vi.fn() } }
}

function emitted(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
  return sink.webContents.send.mock.calls.map((call) => call[1] as DaemonEvent)
}

// --- deps builder --------------------------------------------------------------------------
function makeStores(overrides: {
  load?: () => Promise<PairedServerRecord | null>
  ensure?: () => Promise<DeviceKeyPair>
} = {}): { deviceKeypair: DeviceKeypairStore; pairedServer: PairedServerStore } {
  const load = overrides.load ?? (() => Promise.resolve(RECORD))
  const ensure = overrides.ensure ?? (() => Promise.resolve(PAIR))
  return {
    deviceKeypair: { ensure },
    pairedServer: { load, save: () => Promise.resolve() }
  }
}

function build(
  overrides: {
    load?: () => Promise<PairedServerRecord | null>
    ensure?: () => Promise<DeviceKeyPair>
    throwOnSend?: boolean
  } = {}
): {
  connection: DaemonConnection
  sink: ReturnType<typeof fakeSink>
  drivers: FakeDriver[]
} {
  const sink = fakeSink()
  const stores = makeStores(overrides)
  const factory = makeDriverFactory({ throwOnSend: overrides.throwOnSend })
  const deps: DaemonConnectionDeps = {
    ...stores,
    sink,
    deviceName: 'my-desktop',
    clientVersion: '0.1.0',
    now: () => FIXED_TS,
    createDriver: factory.createDriver
  }
  return { connection: createDaemonConnection(deps), sink, drivers: factory.drivers }
}

/** Flush the microtask chain the async bootstrap runs on (fakes resolve immediately). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Reach the connected window: start, resolve the bootstrap, complete the handshake. */
async function reachConnected(): Promise<ReturnType<typeof build>> {
  const ctx = build()
  ctx.connection.start()
  await tick()
  ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
  return ctx
}

/** A `message` envelope's plaintext bytes, wrapping an arbitrary (possibly malformed) payload. */
function messagePlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'message', ts: FIXED_TS, payload })
}

/** A `message_chunk` envelope's plaintext bytes, wrapping an arbitrary payload. */
function chunkPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'message_chunk', ts: FIXED_TS, payload })
}

describe('createDaemonConnection', () => {
  it('emits connecting synchronously, then constructs the driver with the sourced config', async () => {
    const { connection, sink, drivers } = build()

    connection.start()
    // connecting is emitted before any await; the driver is NOT yet constructed.
    expect(emitted(sink)).toEqual([{ type: 'connecting' }])
    expect(drivers).toHaveLength(0)

    await tick()

    expect(drivers).toHaveLength(1)
    const { config } = drivers[0]
    expect(config.connection.url).toBe(RECORD.relay)
    expect(config.connection.headers['X-Pyrycode-Server']).toBe(RECORD.server)
    expect(config.connection.headers['X-Pyrycode-Token']).toBe(RECORD.token)
    expect(config.connection.headers['User-Agent']).toBe('pyrycode-desktop/0.1.0')
    expect(config.session.staticPrivateKey).toBe(PAIR.privateKey)
    expect(config.session.prologue.length).toBe(0)
  })

  it('maps handshake-complete to a connected event carrying the parsed HelloAckPayload', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()

    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(emitted(sink)).toEqual([
      { type: 'connecting' },
      {
        type: 'connected',
        ack: { protocol_version: 'v2', server_id: 'srv-1', conn_id: 'conn-1', capabilities: [] }
      }
    ])
  })

  it('sources the hello early-data from the record token via buildClientHello', async () => {
    const { connection, drivers } = build()
    connection.start()
    await tick()

    const envelope = decodeEnvelope(drivers[0].config.session.hello)
    expect(envelope.type).toBe('hello')
    const payload = envelope.payload as Record<string, unknown>
    expect(payload.token).toBe(TOKEN)
    expect(payload.device_name).toBe('my-desktop')
  })

  it('decodes server_static_pubkey to the raw 32-byte key', async () => {
    const { connection, drivers } = build()
    connection.start()
    await tick()

    const key = drivers[0].config.session.remoteStaticPublicKey
    expect(key.length).toBe(32)
    expect([...key]).toEqual([...base64StdDecode(RECORD.server_static_pubkey)])
  })

  it('emits failed(not-paired) and constructs no driver when no record is stored', async () => {
    const { connection, sink, drivers } = build({ load: () => Promise.resolve(null) })
    connection.start()
    await tick()

    expect(drivers).toHaveLength(0)
    const events = emitted(sink)
    expect(events[0]).toEqual({ type: 'connecting' })
    expect(events[1].type).toBe('failed')
    expect((events[1] as { error: { code: string } }).error.code).toBe('not-paired')
  })

  it('maps a malformed record to failed(connect-failed) without constructing a driver', async () => {
    const { connection, sink, drivers } = build({
      load: () => Promise.reject(new MalformedPairedServerRecordError())
    })
    connection.start()
    await tick()

    expect(drivers).toHaveLength(0)
    const last = emitted(sink).at(-1) as { type: string; error: { code: string } }
    expect(last.type).toBe('failed')
    expect(last.error.code).toBe('connect-failed')
  })

  it('maps a wrong-length server key to failed(connect-failed)', async () => {
    const { connection, sink, drivers } = build({
      load: () =>
        Promise.resolve({ ...RECORD, server_static_pubkey: base64StdEncode(new Uint8Array(31)) })
    })
    connection.start()
    await tick()

    expect(drivers).toHaveLength(0)
    const last = emitted(sink).at(-1) as { type: string; error: { code: string } }
    expect(last.type).toBe('failed')
    expect(last.error.code).toBe('connect-failed')
  })

  it('maps a bad-base64 server key to failed(connect-failed) without crashing', async () => {
    const { connection, sink, drivers } = build({
      load: () => Promise.resolve({ ...RECORD, server_static_pubkey: 'not valid base64 !!!' })
    })
    connection.start()
    await tick()

    expect(drivers).toHaveLength(0)
    const last = emitted(sink).at(-1) as { type: string; error: { code: string } }
    expect(last.error.code).toBe('connect-failed')
  })

  it('maps a rejecting keychain (ensure) to failed(connect-failed)', async () => {
    const { connection, sink, drivers } = build({
      ensure: () => Promise.reject(new Error('keychain unavailable'))
    })
    connection.start()
    await tick()

    expect(drivers).toHaveLength(0)
    const last = emitted(sink).at(-1) as { type: string; error: { code: string } }
    expect(last.error.code).toBe('connect-failed')
  })

  it('maps a malformed hello_ack to failed(malformed-hello-ack), never connected', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()

    // A well-formed envelope of the wrong type: parseHelloAck rejects it.
    const wrongType = encodeEnvelope({ id: 2, type: 'hello', ts: FIXED_TS, payload: {} })
    drivers[0].emit({ type: 'handshake-complete', helloAck: wrongType })

    const events = emitted(sink)
    expect(events.some((e) => e.type === 'connected')).toBe(false)
    const last = events.at(-1) as { type: string; error: { code: string } }
    expect(last.type).toBe('failed')
    expect(last.error.code).toBe('malformed-hello-ack')
  })

  it('maps a driver error to failed with that reason as the code, carrying no bytes', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()

    drivers[0].emit({ type: 'error', reason: 'session-load-failed' })

    const last = emitted(sink).at(-1) as { type: string; error: Record<string, unknown> }
    expect(last.type).toBe('failed')
    expect(last.error.code).toBe('session-load-failed')
    // The payload carries only the three ErrorPayload fields — no key/token/frame bytes.
    expect(Object.keys(last.error).sort()).toEqual(['code', 'message', 'retryable'])
  })

  it('maps a fatal terminal to failed(connection-closed) without forwarding the reason string', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()

    drivers[0].emit({ type: 'terminal', code: 4426, reason: 'noise-handshake-secret-detail' })

    const events = emitted(sink)
    expect(events.some((e) => e.type === 'connected')).toBe(false)
    const last = events.at(-1) as { type: string; error: { code: string } }
    expect(last.type).toBe('failed')
    expect(last.error.code).toBe('connection-closed')
    // The supervisor's reason string is deliberately not forwarded into any payload.
    expect(JSON.stringify(events)).not.toContain('noise-handshake-secret-detail')
  })

  it('decodes an inbound message frame into a single messageReceived event', async () => {
    const { sink, drivers } = await reachConnected()
    const before = emitted(sink).length
    const message = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi there' }

    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'messageReceived', message }])
  })

  it('decodes an inbound message_chunk frame into one ordered messagesReceived event', async () => {
    const { sink, drivers } = await reachConnected()
    const before = emitted(sink).length
    const a = { conversation_id: 'c1', message_id: 'm1', role: 'user', text: 'one' }
    const b = { conversation_id: 'c1', message_id: 'm2', role: 'assistant', text: 'two' }

    drivers[0].emit({ type: 'message', plaintext: chunkPlaintext({ messages: [a, b] }) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'messagesReceived', messages: [a, b] }])
  })

  it('ignores a well-formed inbound frame of another envelope type (ack)', async () => {
    const { sink, drivers } = await reachConnected()
    const before = sink.webContents.send.mock.calls.length

    drivers[0].emit({
      type: 'message',
      plaintext: encodeEnvelope({ id: 3, type: 'ack', ts: FIXED_TS, payload: {} })
    })

    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops a malformed inbound frame without emitting, and emit() does not throw', async () => {
    const { sink, drivers } = await reachConnected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: new TextEncoder().encode('{not json') })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops an inbound message with a missing field or unknown role, without emitting or throwing', async () => {
    const { sink, drivers } = await reachConnected()
    const before = sink.webContents.send.mock.calls.length

    // Missing `text`, then an unknown `role`.
    drivers[0].emit({
      type: 'message',
      plaintext: messagePlaintext({ conversation_id: 'c1', message_id: 'm1', role: 'assistant' })
    })
    drivers[0].emit({
      type: 'message',
      plaintext: messagePlaintext({ conversation_id: 'c1', message_id: 'm1', role: 'system', text: 't' })
    })

    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops an oversized inbound frame without emitting or throwing', async () => {
    const { sink, drivers } = await reachConnected()
    const before = sink.webContents.send.mock.calls.length

    // Built with a raw encoder (encodeEnvelope caps on encode) so the bytes ARE a valid message
    // envelope — the size guard, not JSON validity, is what drops it.
    const oversized = new TextEncoder().encode(
      JSON.stringify({
        id: 3,
        type: 'message',
        ts: FIXED_TS,
        payload: {
          conversation_id: 'c1',
          message_id: 'm1',
          role: 'user',
          text: 'x'.repeat(MAX_PLAINTEXT_BYTES)
        }
      })
    )
    expect(oversized.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)

    expect(() => drivers[0].emit({ type: 'message', plaintext: oversized })).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('emits in arrival order and does not dedupe two frames with the same message_id', async () => {
    const { sink, drivers } = await reachConnected()
    const before = emitted(sink).length
    const message = { conversation_id: 'c1', message_id: 'dup', role: 'assistant', text: 'again' }

    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'messageReceived', message },
      { type: 'messageReceived', message }
    ])
  })

  it('suppresses the terminal a clean stop() produces', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = sink.webContents.send.mock.calls.length

    connection.stop()
    expect(drivers[0].stopped).toBe(true)
    drivers[0].emit({ type: 'terminal', code: 1000, reason: 'stopped' })

    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('never constructs a driver when stop() races the bootstrap', async () => {
    const { connection, drivers } = build()
    connection.start()
    connection.stop() // before the async bootstrap resolves
    await tick()

    expect(drivers).toHaveLength(0)
  })

  it('is idempotent: a second start() does not construct a second driver', async () => {
    const { connection, drivers } = build()
    connection.start()
    connection.start()
    await tick()

    expect(drivers).toHaveLength(1)
  })

  it('never logs, and no emitted event carries the token, keys, or hello bytes', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const MALFORMED_SECRET = 'malformed-frame-secret-plaintext'
    try {
      // Happy path.
      const ok = build()
      ok.connection.start()
      await tick()
      ok.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

      // A benign inbound message: its text legitimately flows into a messageReceived event (the
      // intended data path, not a leak) — driven here only to prove the message path is log-free.
      ok.drivers[0].emit({
        type: 'message',
        plaintext: messagePlaintext({
          conversation_id: 'c1',
          message_id: 'm1',
          role: 'assistant',
          text: 'benign reply'
        })
      })
      // A malformed inbound message whose (unparseable) bytes embed a secret: it is dropped, so the
      // secret must never reach an emitted event or a log.
      ok.drivers[0].emit({
        type: 'message',
        plaintext: new TextEncoder().encode(`{"payload":{"text":"${MALFORMED_SECRET}"} not json`)
      })

      // A failure path (bad key).
      const bad = build({
        load: () => Promise.resolve({ ...RECORD, server_static_pubkey: 'not!base64' })
      })
      bad.connection.start()
      await tick()

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()

      const serialized = JSON.stringify([...emitted(ok.sink), ...emitted(bad.sink)])
      expect(serialized).not.toContain(TOKEN)
      expect(serialized).not.toContain(RECORD.server_static_pubkey)
      expect(serialized).not.toContain(base64StdEncode(PAIR.privateKey))
      expect(serialized).not.toContain(MALFORMED_SECRET)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('createDaemonConnection — send (outbound send_message)', () => {
  const PAYLOAD: SendMessagePayload = {
    conversation_id: 'c1',
    message_id: 'm1',
    text: 'hello daemon'
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw', () => {
    const { connection, drivers } = build()

    expect(() => connection.send(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards exactly one send_message envelope with id 2 and the fixed ts', async () => {
    const { connection, drivers } = await connected()

    connection.send(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('send_message')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('advances the envelope id monotonically across sends (hello consumed id 1)', async () => {
    const { connection, drivers } = await connected()

    connection.send(PAYLOAD)
    connection.send(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(2)
    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('drops an over-cap payload without throwing or forwarding, and does not consume an id', async () => {
    const { connection, drivers } = await connected()

    const overCap: SendMessagePayload = {
      conversation_id: 'c1',
      message_id: 'm1',
      text: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1)
    }
    expect(() => connection.send(overCap)).not.toThrow()
    expect(drivers[0].sent).toHaveLength(0)

    // The failed build did not consume the id: the next successful send still uses id 2.
    connection.send(PAYLOAD)
    expect(drivers[0].sent).toHaveLength(1)
    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.send(PAYLOAD)).not.toThrow()
  })

  it('never logs and emits nothing to the sink on send — the message text never reaches an event', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const SECRET_TEXT = 'super-secret-message-plaintext'
    try {
      const { connection, sink } = await connected()
      const eventsBefore = sink.webContents.send.mock.calls.length

      connection.send({ conversation_id: 'c1', message_id: 'm1', text: SECRET_TEXT })
      // The over-cap send's caught WireEncodeError message could echo the plaintext — it must be
      // dropped, never logged.
      connection.send({
        conversation_id: 'c1',
        message_id: 'm2',
        text: 'y'.repeat(MAX_PLAINTEXT_BYTES + 1)
      })

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      // send emits no DaemonEvent, so no event carries the plaintext back to the renderer.
      expect(sink.webContents.send.mock.calls.length).toBe(eventsBefore)
      expect(JSON.stringify(emitted(sink))).not.toContain(SECRET_TEXT)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
