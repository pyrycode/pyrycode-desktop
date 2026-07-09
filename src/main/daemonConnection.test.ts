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
import type { DiagnosticEvent, DiagnosticLog } from './diagnosticLog'
import { base64StdEncode, base64StdDecode, encodeEnvelope, decodeEnvelope } from './transport/codec'
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import {
  MAX_PLAINTEXT_BYTES,
  type SendMessagePayload,
  type RequestSnapshotPayload,
  type ScreenSnapshotPayload
} from '../shared/wire/types'

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

// --- diagnostic-log capture ----------------------------------------------------------------
/** A fake DiagnosticLog that records every content-free envelope its call sites emit (#128). */
function captureLog(): { log: DiagnosticLog; records: DiagnosticEvent[] } {
  const records: DiagnosticEvent[] = []
  return {
    records,
    log: {
      event(fields: DiagnosticEvent): void {
        records.push(fields)
      }
    }
  }
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
    diagnosticLog?: DiagnosticLog
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
    createDriver: factory.createDriver,
    diagnosticLog: overrides.diagnosticLog
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

/** A `debug_bundle_chunk` plaintext carrying raw bytes as base64-std `data` (#116). */
function bundleChunkPlaintext(seq: number, data: Uint8Array): Uint8Array {
  return encodeEnvelope({
    id: 3,
    type: 'debug_bundle_chunk',
    ts: FIXED_TS,
    payload: { seq, data: base64StdEncode(data) }
  })
}

/** A `debug_bundle_done` plaintext (#116). */
function bundleDonePlaintext(total: number): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'debug_bundle_done', ts: FIXED_TS, payload: { total } })
}

/** A `screen_snapshot` plaintext, wrapping an arbitrary payload (#180). */
function snapshotPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'screen_snapshot', ts: FIXED_TS, payload })
}

/** A single daemon `error` reply plaintext — its ErrorPayload text must never surface (#116). */
function errorPlaintext(): Uint8Array {
  return encodeEnvelope({
    id: 3,
    type: 'error',
    ts: FIXED_TS,
    payload: { code: 'server.binary_offline', message: 'secret error detail', retryable: true }
  })
}

/** A spy BundleConsumer recording the single terminal (complete XOR fail) + progress ticks (#116). */
function makeBundleConsumer(): {
  consumer: BundleConsumer
  completed: Uint8Array[]
  failed: BundleFailReason[]
  progress: number[]
} {
  const completed: Uint8Array[] = []
  const failed: BundleFailReason[] = []
  const progress: number[] = []
  return {
    completed,
    failed,
    progress,
    consumer: {
      complete: (bytes) => completed.push(bytes),
      fail: (reason) => failed.push(reason),
      progress: (n) => progress.push(n)
    }
  }
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

  it('appends the /v1/client client-leg path to a bare relay base (the real pyry pair payload)', async () => {
    // pyry pair emits the bare relay base with no path; the relay 404s on anything but /v1/client.
    // The dial URL must carry the client-leg path, matching the mobile client.
    const { connection, drivers } = build({
      load: () => Promise.resolve({ ...RECORD, relay: 'wss://relay.example' })
    })

    connection.start()
    await tick()

    expect(drivers[0].config.connection.url).toBe('wss://relay.example/v1/client')
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

describe('createDaemonConnection — reconnect (connect-on-pair, #82)', () => {
  it('replaces the driver and emits a fresh connecting', async () => {
    const ctx = await reachConnected()
    expect(emitted(ctx.sink).some((e) => e.type === 'connected')).toBe(true)

    ctx.connection.reconnect()
    await tick()

    expect(ctx.drivers[0].stopped).toBe(true)
    expect(ctx.drivers).toHaveLength(2)
    expect(emitted(ctx.sink).filter((e) => e.type === 'connecting')).toHaveLength(2)
  })

  it('fences the superseded driver terminal, so no spurious failed is emitted', async () => {
    const ctx = await reachConnected()
    ctx.connection.reconnect()
    await tick()
    const before = emitted(ctx.sink).length

    // The old driver's stop() emits terminal{1000,'stopped'} after the reconnect superseded it.
    ctx.drivers[0].emit({ type: 'terminal', code: 1000, reason: 'stopped' })

    const after = emitted(ctx.sink)
    expect(after).toHaveLength(before) // the generation wrapper dropped it
    expect(after.some((e) => e.type === 'failed')).toBe(false)
  })

  it('sources the paired-server record fresh at dial time (AC3)', async () => {
    const RECORD_A = { ...RECORD, server: 'srv-A', relay: 'wss://relay-a.example/v1/client' }
    const RECORD_B = { ...RECORD, server: 'srv-B', relay: 'wss://relay-b.example/v1/client' }
    const records = [RECORD_A, RECORD_B]
    let call = 0
    const { connection, drivers } = build({
      load: () => Promise.resolve(records[Math.min(call++, records.length - 1)])
    })

    connection.start()
    await tick()
    expect(drivers[0].config.connection.url).toBe(RECORD_A.relay)
    expect(drivers[0].config.connection.headers['X-Pyrycode-Server']).toBe(RECORD_A.server)

    connection.reconnect()
    await tick()
    expect(drivers[1].config.connection.url).toBe(RECORD_B.relay)
    expect(drivers[1].config.connection.headers['X-Pyrycode-Server']).toBe(RECORD_B.server)
  })

  it('connects after a not-paired boot (primary scenario)', async () => {
    const records: (PairedServerRecord | null)[] = [null, RECORD]
    let call = 0
    const { connection, sink, drivers } = build({
      load: () => Promise.resolve(records[Math.min(call++, records.length - 1)])
    })

    connection.start()
    await tick()
    expect(drivers).toHaveLength(0)
    expect((emitted(sink).at(-1) as { error: { code: string } }).error.code).toBe('not-paired')

    connection.reconnect()
    await tick()
    expect(drivers).toHaveLength(1)

    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    expect(emitted(sink).some((e) => e.type === 'connected')).toBe(true)
  })

  it('is a no-op after stop() (app quitting)', async () => {
    const ctx = await reachConnected()
    ctx.connection.stop()
    const beforeEvents = emitted(ctx.sink).length
    const beforeDrivers = ctx.drivers.length

    ctx.connection.reconnect()
    await tick()

    expect(ctx.drivers).toHaveLength(beforeDrivers)
    expect(emitted(ctx.sink).length).toBe(beforeEvents)
  })

  it('restarts the fresh session envelope numbering at 2', async () => {
    const ctx = await reachConnected()
    ctx.connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'first' })
    expect(decodeEnvelope(ctx.drivers[0].sent[0]).id).toBe(2)

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.connection.send({ conversation_id: 'c1', message_id: 'm2', text: 'second' })
    expect(ctx.drivers[1].sent).toHaveLength(1)
    expect(decodeEnvelope(ctx.drivers[1].sent[0]).id).toBe(2)
  })

  it('never logs, and no event carries the token or keys, across a reconnect', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const ctx = await reachConnected()
      ctx.connection.reconnect()
      await tick()
      ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      const serialized = JSON.stringify(emitted(ctx.sink))
      expect(serialized).not.toContain(TOKEN)
      expect(serialized).not.toContain(RECORD.server_static_pubkey)
      expect(serialized).not.toContain(base64StdEncode(PAIR.privateKey))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('createDaemonConnection — reload-per-dial provider (#83)', () => {
  it('threads loadDialConfig into the driver as a function', async () => {
    const { connection, drivers } = build()
    connection.start()
    await tick()

    expect(typeof drivers[0].config.loadDialConfig).toBe('function')
  })

  it('the threaded provider re-sources the record on each call (AC1/AC2)', async () => {
    const SERVER_KEY_B = new Uint8Array(32).fill(0x44)
    const RECORD_A = { ...RECORD, server: 'srv-A', relay: 'wss://relay-a.example/v1/client' }
    const RECORD_B: PairedServerRecord = {
      server: 'srv-B',
      relay: 'wss://relay-b.example/v1/client',
      token: 'tok-B',
      server_static_pubkey: base64StdEncode(SERVER_KEY_B)
    }
    const records = [RECORD_A, RECORD_B]
    let call = 0
    const { connection, drivers } = build({
      load: () => Promise.resolve(records[Math.min(call++, records.length - 1)])
    })

    connection.start()
    await tick()
    // First dial consumed A.
    expect(drivers[0].config.connection.url).toBe(RECORD_A.relay)

    // Invoking the provider — as the supervisor would before an automatic re-dial — re-sources B:
    // both the connection headers AND the Noise session material come from the fresh record.
    const dc = await drivers[0].config.loadDialConfig?.()
    expect(dc?.connection.url).toBe(RECORD_B.relay)
    expect(dc?.connection.headers['X-Pyrycode-Server']).toBe(RECORD_B.server)
    expect(dc?.connection.headers['X-Pyrycode-Token']).toBe(RECORD_B.token)
    expect([...(dc?.session.remoteStaticPublicKey ?? [])]).toEqual([...SERVER_KEY_B])
  })

  it('the threaded provider resolves null when a later load finds no record (AC3)', async () => {
    const records: (PairedServerRecord | null)[] = [RECORD, null]
    let call = 0
    const { connection, drivers } = build({
      load: () => Promise.resolve(records[Math.min(call++, records.length - 1)])
    })

    connection.start()
    await tick()
    expect(drivers).toHaveLength(1)

    const dc = await drivers[0].config.loadDialConfig?.()
    expect(dc).toBeNull()
  })

  it('handles the token and server key with no logging and no secret in any event, across a reload (AC4)', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const { connection, sink, drivers } = build()
      connection.start()
      await tick()

      // Exercise the reload path (which handles the token + server key) the supervisor would drive.
      const dc = await drivers[0].config.loadDialConfig?.()
      expect(dc).not.toBeNull()

      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      const serialized = JSON.stringify(emitted(sink))
      expect(serialized).not.toContain(TOKEN)
      expect(serialized).not.toContain(RECORD.server_static_pubkey)
      expect(serialized).not.toContain(base64StdEncode(PAIR.privateKey))
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

describe('createDaemonConnection — requestSnapshot (screen_snapshot request/reply, #180)', () => {
  const PAYLOAD: RequestSnapshotPayload = { conversation_id: 'conv-1' }
  const SNAPSHOT: ScreenSnapshotPayload = {
    conversation_id: 'conv-1',
    text: 'secret rendered screen',
    ts: '2026-07-08T00:00:00Z',
    model: 'claude-opus-4-8',
    effort: 'high',
    yolo: true,
    used_tokens: 45000,
    window_tokens: 200000
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin, not a fail)', () => {
    const { connection, drivers } = build()

    expect(() => connection.requestSnapshot(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one request_snapshot envelope with id 2 and the payload', async () => {
    const { connection, drivers } = await connected()

    connection.requestSnapshot(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('request_snapshot')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PAYLOAD)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.requestSnapshot(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.requestSnapshot(PAYLOAD)).not.toThrow()
  })

  it('decodes an inbound screen_snapshot into one snapshotReceived carrying model/effort/yolo + usage (#191)', async () => {
    const { sink, drivers } = await connected()

    drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(SNAPSHOT) })

    const events = emitted(sink)
    expect(events.filter((e) => e.type === 'snapshotReceived')).toEqual([
      {
        type: 'snapshotReceived',
        model: 'claude-opus-4-8',
        effort: 'high',
        yolo: true,
        used_tokens: 45000,
        window_tokens: 200000
      }
    ])
    // Content minimisation: the rendered screen text / ts / conversation_id are dropped at the choke
    // point (only the settings fields + usage ints cross), so no emitted event carries them.
    expect(JSON.stringify(events)).not.toContain('secret rendered screen')
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('decodes the empty-model/effort and yolo:false defaults as those values (AC3)', async () => {
    const { sink, drivers } = await connected()

    const defaults: ScreenSnapshotPayload = { ...SNAPSHOT, model: '', effort: '', yolo: false }
    drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(defaults) })

    expect(emitted(sink).find((e) => e.type === 'snapshotReceived')).toEqual({
      type: 'snapshotReceived',
      model: '',
      effort: '',
      yolo: false,
      used_tokens: 45000,
      window_tokens: 200000
    })
  })

  it('carries used_tokens:0 / window_tokens:0 through as those values, not dropped/defaulted (#191, AC3)', async () => {
    const { sink, drivers } = await connected()

    const zeros: ScreenSnapshotPayload = { ...SNAPSHOT, used_tokens: 0, window_tokens: 0 }
    drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(zeros) })

    expect(emitted(sink).find((e) => e.type === 'snapshotReceived')).toEqual({
      type: 'snapshotReceived',
      model: 'claude-opus-4-8',
      effort: 'high',
      yolo: true,
      used_tokens: 0,
      window_tokens: 0
    })
  })

  it('drops a malformed screen_snapshot without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext({ ...SNAPSHOT, yolo: 'nope' }) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — requestDebugBundle (outbound debug-bundle request)', () => {
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

  it('before start() fails the consumer not-connected: no driver, nothing forwarded, no throw', () => {
    const { connection, drivers } = build()
    const { consumer, failed, completed } = makeBundleConsumer()

    expect(() => connection.requestDebugBundle(consumer)).not.toThrow()
    expect(drivers).toHaveLength(0)
    expect(failed).toEqual(['not-connected'])
    expect(completed).toEqual([])
  })

  it('after handshake-complete, forwards exactly one bare request_debug_bundle envelope with id 2 and the fixed ts', async () => {
    const { connection, drivers } = await connected()

    connection.requestDebugBundle(makeBundleConsumer().consumer)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('request_debug_bundle')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
  })

  it('carries no payload and no session-selecting field (AC3)', async () => {
    const { connection, drivers } = await connected()

    connection.requestDebugBundle(makeBundleConsumer().consumer)

    const envelope = decodeEnvelope(drivers[0].sent[0])
    // Bare control frame: an empty payload, no conversation_id / message_id selector.
    expect(envelope.payload).toEqual({})
    const record = envelope.payload as Record<string, unknown>
    expect(record).not.toHaveProperty('conversation_id')
    expect(record).not.toHaveProperty('message_id')
  })

  it('shares the single monotonic id counter with send (a send then a request yield ids 2 then 3)', async () => {
    const { connection, drivers } = await connected()

    connection.send(PAYLOAD)
    connection.requestDebugBundle(makeBundleConsumer().consumer)

    expect(drivers[0].sent).toHaveLength(2)
    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.requestDebugBundle(makeBundleConsumer().consumer)).not.toThrow()
  })
})

describe('createDaemonConnection — debug-bundle reassembly routing (#116)', () => {
  /** Reach the connected window. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  const CHUNK_A = new Uint8Array([1, 2, 3, 4])
  const CHUNK_B = new Uint8Array([5, 6])

  it('reassembles ordered bundle-chunk frames + done into consumer.complete with the served bytes', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed, progress } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(1, CHUNK_B) })
    drivers[0].emit({ type: 'message', plaintext: bundleDonePlaintext(2) })

    expect(failed).toEqual([])
    expect(completed).toHaveLength(1)
    expect([...completed[0]]).toEqual([1, 2, 3, 4, 5, 6])
    expect(progress).toEqual([1, 2])
  })

  it('routes an interleaved message / message_chunk to the existing path, unaffected (additive)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, completed } = makeBundleConsumer()
    const before = emitted(sink).length
    const msg = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    // A normal message arriving mid-stream still routes to messageReceived, invisible to the bundle.
    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(msg) })
    drivers[0].emit({ type: 'message', plaintext: bundleDonePlaintext(1) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'messageReceived', message: msg }])
    expect([...completed[0]]).toEqual([1, 2, 3, 4])
  })

  it('fails the consumer seq-mismatch on a reordered chunk, completing nothing', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(2, CHUNK_B) }) // gap

    expect(failed).toEqual(['seq-mismatch'])
    expect(completed).toEqual([])
  })

  it('fails the consumer total-mismatch on a truncated done', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'message', plaintext: bundleDonePlaintext(3) }) // only 1 received

    expect(failed).toEqual(['total-mismatch'])
    expect(completed).toEqual([])
  })

  it('fails the consumer daemon-error on a single error reply with an active request', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(failed).toEqual(['daemon-error'])
    expect(completed).toEqual([])
  })

  it('drops an error reply with no active request: no consumer call, no crash', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // No requestDebugBundle armed — the error frame routes to the (null) reassembler as a no-op.
    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('fails the consumer connection-lost when a terminal interrupts the stream', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'terminal', code: 4426, reason: 'dropped' })

    expect(failed).toEqual(['connection-lost'])
    expect(completed).toEqual([])
  })

  it('fails the consumer connection-lost when a driver error interrupts the stream', async () => {
    const { connection, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'error', reason: 'session-load-failed' })

    expect(failed).toEqual(['connection-lost'])
  })

  it('completes an empty bundle (done{0}, no chunks) with a zero-length archive', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleDonePlaintext(0) })

    expect(failed).toEqual([])
    expect(completed[0]).toHaveLength(0)
  })
})

describe('createDaemonConnection — diagnostic logging (#128)', () => {
  it('logs a coordinate-free daemon-dial anchor synchronously with connecting (AC1)', () => {
    const cap = captureLog()
    const { connection } = build({ diagnosticLog: cap.log })

    connection.start()

    // Emitted before any await, alongside the `connecting` DaemonEvent; carries only `event`
    // (no host/path/status/code — those coordinates are #127's relay leg, and unloaded here).
    expect(cap.records).toEqual([{ event: 'daemon-dial' }])
  })

  it('anchors the not-paired window as daemon-dial then daemon-failed(not-paired) (AC1)', async () => {
    // The daemon-side window exists even when #127 (relay leg) is silent: no socket opens.
    const cap = captureLog()
    const { connection } = build({ load: () => Promise.resolve(null), diagnosticLog: cap.log })

    connection.start()
    await tick()

    expect(cap.records).toEqual([
      { event: 'daemon-dial' },
      { event: 'daemon-failed', code: 'not-paired' }
    ])
  })

  it('logs daemon-connected on the handshake-complete success path, never the ack bytes (AC2)', async () => {
    const cap = captureLog()
    const { connection, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()

    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(cap.records.filter((r) => r.event === 'daemon-connected')).toEqual([
      { event: 'daemon-connected' }
    ])
    // The event-name-only record never carries the hello-ack contents.
    expect(JSON.stringify(cap.records)).not.toContain('conn-1')
  })

  it('logs daemon-failed(malformed-hello-ack) with the static code only, never connected (AC3)', async () => {
    const cap = captureLog()
    const { connection, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()

    const wrongType = encodeEnvelope({ id: 2, type: 'hello', ts: FIXED_TS, payload: {} })
    drivers[0].emit({ type: 'handshake-complete', helloAck: wrongType })

    expect(cap.records).toContainEqual({ event: 'daemon-failed', code: 'malformed-hello-ack' })
    expect(cap.records.some((r) => r.event === 'daemon-connected')).toBe(false)
  })

  it('logs daemon-failed(connect-failed) for a bootstrap throw (AC3)', async () => {
    const cap = captureLog()
    const { connection } = build({
      load: () => Promise.reject(new MalformedPairedServerRecordError()),
      diagnosticLog: cap.log
    })
    connection.start()
    await tick()

    expect(cap.records).toContainEqual({ event: 'daemon-failed', code: 'connect-failed' })
  })

  it("logs the driver's static error reason as daemon-failed(session-load-failed) (AC3)", async () => {
    const cap = captureLog()
    const { connection, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()

    drivers[0].emit({ type: 'error', reason: 'session-load-failed' })

    expect(cap.records).toContainEqual({ event: 'daemon-failed', code: 'session-load-failed' })
  })

  it('logs daemon-failed(connection-closed) but never the numeric close code, peer reason, or banner (AC3)', async () => {
    const cap = captureLog()
    const { connection, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()

    drivers[0].emit({ type: 'terminal', code: 4426, reason: 'noise-handshake-secret-detail' })

    const failed = cap.records.filter((r) => r.event === 'daemon-failed')
    // Static classification only — no `status` (that is #127's relay-closed numeric close code).
    expect(failed).toEqual([{ event: 'daemon-failed', code: 'connection-closed' }])
    expect(failed[0]).not.toHaveProperty('status')
    const serialized = JSON.stringify(cap.records)
    expect(serialized).not.toContain('4426') // the numeric WS close code (#127's, not the daemon leg's)
    expect(serialized).not.toContain('noise-handshake-secret-detail') // the peer reason string
    expect(serialized).not.toContain('The connection to pyrybox was closed') // the banner text
  })

  it('does not perturb the emitted DaemonEvent sequence, with or without a logger (AC4)', async () => {
    const withLog = build({ diagnosticLog: captureLog().log })
    withLog.connection.start()
    await tick()
    withLog.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    const withoutLog = build()
    withoutLog.connection.start()
    await tick()
    withoutLog.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(emitted(withLog.sink)).toEqual(emitted(withoutLog.sink))
  })

  it('a clean stop() suppresses both the failed event and the daemon-failed record (AC4)', async () => {
    const cap = captureLog()
    const { connection, sink, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    connection.stop()
    drivers[0].emit({ type: 'terminal', code: 1000, reason: 'stopped' })

    expect(emitted(sink).some((e) => e.type === 'failed')).toBe(false)
    expect(cap.records.some((r) => r.event === 'daemon-failed')).toBe(false)
  })

  it('logs exactly one daemon-dial per dial and no stray daemon-failed from a superseded dial (AC4)', async () => {
    const cap = captureLog()
    const { connection, drivers } = build({ diagnosticLog: cap.log })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    connection.reconnect()
    await tick()

    // The superseded driver's stop-terminal is gen-fenced, so it logs no daemon-failed.
    drivers[0].emit({ type: 'terminal', code: 1000, reason: 'stopped' })

    expect(cap.records.filter((r) => r.event === 'daemon-dial')).toHaveLength(2)
    expect(cap.records.some((r) => r.event === 'daemon-failed')).toBe(false)
  })
})
