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
  handle: NoiseRelayDriver
  /** Drive a RelaySessionEvent back into the consumer's onEvent handler. */
  emit(event: RelaySessionEvent): void
}

function makeDriverFactory(): {
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
        emit: (event) => config.onEvent(event),
        handle: {
          sendMessage() {},
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
  } = {}
): {
  connection: DaemonConnection
  sink: ReturnType<typeof fakeSink>
  drivers: FakeDriver[]
} {
  const sink = fakeSink()
  const stores = makeStores(overrides)
  const factory = makeDriverFactory()
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

  it('treats an inbound message as a no-op (streamed decode is #12)', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()
    const before = sink.webContents.send.mock.calls.length

    drivers[0].emit({ type: 'message', plaintext: new Uint8Array([1, 2, 3]) })

    expect(sink.webContents.send.mock.calls.length).toBe(before)
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
    try {
      // Happy path.
      const ok = build()
      ok.connection.start()
      await tick()
      ok.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

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
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
