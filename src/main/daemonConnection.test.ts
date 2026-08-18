import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDaemonConnection,
  type DaemonConnection,
  type DaemonConnectionDeps
} from './daemonConnection'
import type { DaemonEvent } from '../shared/ipc/events'
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DeviceKeyPair, DeviceKeypairStore } from './deviceKeypair'
import type {
  ClearablePairedServerStore,
  PairedServerRecord,
  PairedServerStore
} from './pairedServerStore'
import { MalformedPairedServerRecordError } from './pairedServerStore'
import { registerUnpairHandler } from './unpairHandler'
import type {
  NoiseRelayDriver,
  NoiseRelayDriverConfig,
  RelaySessionEvent
} from './transport/noiseRelayDriver'
import type { DiagnosticEvent, DiagnosticLog } from './diagnosticLog'
import { base64StdEncode, base64StdDecode, encodeEnvelope, decodeEnvelope } from './transport/codec'
import type { BundleConsumer, BundleFailReason } from './transport/bundleReassembler'
import { createDebugBundleDownload, type DebugBundleDownload } from './debugBundleDownload'
import {
  MAX_PLAINTEXT_BYTES,
  type SendMessagePayload,
  type RequestSnapshotPayload,
  type ScreenSnapshotPayload,
  type CreateConversationPayload,
  type CreateWorkspaceFolderPayload,
  type PromoteConversationPayload,
  type UnarchiveConversationPayload,
  type DeleteConversationPayload,
  type RenameConversationPayload,
  type ChangeWorkspacePayload,
  type SetSessionSettingsPayload,
  type DequeueMessagePayload
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
// `destroy()` (#518) models the macOS window being closed mid-session: `isDestroyed()` flips true
// and, exactly like a real destroyed BrowserWindow, the `webContents` accessor starts throwing.
function fakeSink(): DaemonEventSink & {
  webContents: { send: ReturnType<typeof vi.fn> }
  /** The send spy by a stable handle — `sink.webContents` throws once destroyed. */
  send: ReturnType<typeof vi.fn>
  destroy(): void
} {
  let destroyed = false
  const webContents = { send: vi.fn() }
  return {
    isDestroyed: () => destroyed,
    get webContents(): { send: ReturnType<typeof vi.fn> } {
      if (destroyed) throw new Error('Object has been destroyed')
      return webContents
    },
    send: webContents.send,
    destroy(): void {
      destroyed = true
    }
  }
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
    mintToken?: () => string
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
    diagnosticLog: overrides.diagnosticLog,
    // Deterministic answer_token mint (#236) — a fixed default so the sent modal_answer frame is
    // pinnable; the uniqueness test injects a counter instead.
    mintToken: overrides.mintToken ?? ((): string => 'test-token')
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

/** A `session_settings` plaintext, wrapping an arbitrary payload (#491). */
function sessionSettingsPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({
    id: 45,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: 812,
    payload
  })
}

/** An `assistant_delta` plaintext, wrapping an arbitrary payload (#199). */
function assistantDeltaPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'assistant_delta', ts: FIXED_TS, payload })
}

/** A `turn_end` plaintext, wrapping an arbitrary payload (#199). */
function turnEndPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'turn_end', ts: FIXED_TS, payload })
}

/** A `conversations` plaintext, wrapping an arbitrary payload (#139). */
function conversationsPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'conversations', ts: FIXED_TS, payload })
}

/** A `recent_workspaces_list` plaintext, wrapping an arbitrary payload (#380). */
function recentWorkspacesPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'recent_workspaces_list', ts: FIXED_TS, payload })
}

/** A `turn_state` plaintext, wrapping an arbitrary payload (#214). */
function turnStatePlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'turn_state', ts: FIXED_TS, payload })
}

/** A `stall` plaintext, wrapping an arbitrary payload (#315). */
function stallPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'stall', ts: FIXED_TS, payload })
}

/** An `api_retry` plaintext, wrapping an arbitrary payload (#492). */
function apiRetryPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'api_retry', ts: FIXED_TS, payload })
}

/** A `compacting` plaintext, wrapping an arbitrary payload (#495). */
function compactingPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'compacting', ts: FIXED_TS, payload })
}

/** A `background_task_started` plaintext, wrapping an arbitrary payload (#564). */
function backgroundTaskStartedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'background_task_started', ts: FIXED_TS, payload })
}

/** An `unrecognized_message` plaintext, wrapping an arbitrary payload. */
function unrecognizedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'unrecognized_message', ts: FIXED_TS, payload })
}

/** A `tool_use` plaintext, wrapping an arbitrary payload (#217). */
function toolUsePlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'tool_use', ts: FIXED_TS, payload })
}

/** A `tool_result` plaintext, wrapping an arbitrary payload (#229). */
function toolResultPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'tool_result', ts: FIXED_TS, payload })
}

/** A `modal_shown` plaintext, wrapping an arbitrary payload (#201). */
function modalShownPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'modal_shown', ts: FIXED_TS, payload })
}

/** A `modal_dismissed` plaintext, wrapping an arbitrary payload (#201). */
function modalDismissedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'modal_dismissed', ts: FIXED_TS, payload })
}

/** A `conversation_created` plaintext, wrapping an arbitrary payload (#241). */
function conversationCreatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'conversation_created', ts: FIXED_TS, payload })
}

/** A `workspace_folder_created` plaintext, wrapping an arbitrary payload (#381). */
function workspaceFolderCreatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'workspace_folder_created', ts: FIXED_TS, payload })
}

/** A `conversation_updated` plaintext, wrapping an arbitrary payload (#273). */
function conversationUpdatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'conversation_updated', ts: FIXED_TS, payload })
}

/** A `conversation_deleted` plaintext, wrapping an arbitrary payload (#375). */
function conversationDeletedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'conversation_deleted', ts: FIXED_TS, payload })
}

/** A `session_transition` plaintext, wrapping an arbitrary payload (#254). */
function sessionTransitionPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'session_transition', ts: FIXED_TS, payload })
}

/** A `queue_state` plaintext, wrapping an arbitrary payload (#292). */
function queueStatePlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'queue_state', ts: FIXED_TS, payload })
}

/** A `session_settings_updated` plaintext, wrapping an arbitrary payload (#264). The optional
 *  `inReplyTo` rides the ENVELOPE (not the payload) — the #261 request↔reply correlation key. */
function sessionSettingsUpdatedPlaintext(payload: unknown, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 3,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    payload,
    ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})
  })
}

/** A single daemon `error` reply plaintext — its ErrorPayload text must never surface (#116). The
 *  optional `inReplyTo` rides the ENVELOPE (not the payload) — the #269 request↔reject correlation id. */
function errorPlaintext(inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 3,
    type: 'error',
    ts: FIXED_TS,
    payload: { code: 'server.binary_offline', message: 'secret error detail', retryable: true },
    ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})
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

  it('surfaces the daemon-accepted capability set on the connected event (#179 AC2)', async () => {
    const { connection, sink, drivers } = build()
    connection.start()
    await tick()

    // The daemon echoes the accepted (intersection) set in hello_ack.capabilities; parseHelloAck
    // already narrows it onto the ack, so the negotiated set must be observable on connected — not
    // just the empty case the test above covers.
    drivers[0].emit({
      type: 'handshake-complete',
      helloAck: encodeEnvelope({
        id: 2,
        type: 'hello_ack',
        ts: FIXED_TS,
        payload: {
          protocol_version: 'v2',
          server_id: 'srv-1',
          conn_id: 'conn-1',
          capabilities: ['interactive']
        }
      })
    })

    const connected = emitted(sink).find((e) => e.type === 'connected')
    expect(connected).toEqual({
      type: 'connected',
      ack: {
        protocol_version: 'v2',
        server_id: 'srv-1',
        conn_id: 'conn-1',
        capabilities: ['interactive']
      }
    })
  })

  // #328 — the relay-socket leg surfaced to the renderer as its own DaemonEvent arm. This is the
  // single classification choke point (raw WS close code → closed RelayLinkStatus category), so the
  // raw code never crosses IPC. The events are content-free by construction (AC3).
  describe('relay-link status mapping (#328)', () => {
    /** Reach a live driver (start → resolve bootstrap) so RelaySessionEvents can be driven in. */
    async function reachDriver(): Promise<ReturnType<typeof build>> {
      const ctx = build()
      ctx.connection.start()
      await tick()
      return ctx
    }

    it('maps relay-link-up to relayLinkChanged{connected}', async () => {
      const { drivers, sink } = await reachDriver()
      drivers[0].emit({ type: 'relay-link-up' })
      expect(emitted(sink)).toContainEqual({ type: 'relayLinkChanged', status: 'connected' })
    })

    it('maps a relay-link-down with the daemon-absent close (4404) to relayLinkChanged{daemon-absent}', async () => {
      const { drivers, sink } = await reachDriver()
      drivers[0].emit({ type: 'relay-link-down', code: 4404 })
      expect(emitted(sink)).toContainEqual({ type: 'relayLinkChanged', status: 'daemon-absent' })
    })

    it('maps an ordinary relay-link-down (1006 / 1000 / 1011) to relayLinkChanged{offline}', async () => {
      for (const code of [1006, 1000, 1011]) {
        const { drivers, sink } = await reachDriver()
        drivers[0].emit({ type: 'relay-link-down', code })
        expect(emitted(sink)).toContainEqual({ type: 'relayLinkChanged', status: 'offline' })
      }
    })

    it('emits a content-free relayLinkChanged — only { type, status }, dropping the raw close code (AC3)', async () => {
      const { drivers, sink } = await reachDriver()
      drivers[0].emit({ type: 'relay-link-down', code: 4404 })
      const relayEvent = emitted(sink).find((e) => e.type === 'relayLinkChanged')
      expect(relayEvent).toEqual({ type: 'relayLinkChanged', status: 'daemon-absent' })
      // The raw WS close code is classified and dropped at this choke point — it never crosses IPC.
      expect(relayEvent && Object.keys(relayEvent)).toEqual(['type', 'status'])
    })
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

  it('advertises the interactive capability in the client hello (#179 AC1)', async () => {
    const { connection, drivers } = build()
    connection.start()
    await tick()

    // Decode the real hello loadDialConfig built — the flip lives at that call site, not in
    // buildClientHello in isolation, so this pins the production wiring, not the codec default.
    const envelope = decodeEnvelope(drivers[0].config.session.hello)
    const payload = envelope.payload as Record<string, unknown>
    expect(payload.capabilities).toEqual(['interactive'])
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

describe('createDaemonConnection — destroyed window sink (#518)', () => {
  // On macOS, closing the window destroys the BrowserWindow but leaves the app and this connection
  // running, so inbound daemon events keep arriving at a destroyed sink. The transport invokes the
  // event callback with no try/catch (relayConnection.ts), so a throw here is an uncaught
  // main-process exception. Drive the CONNECTION's sink, not the emitter in isolation (AC2).
  it('drops an inbound message frame without throwing once the window is destroyed', async () => {
    const { sink, drivers } = await reachConnected()
    const before = sink.send.mock.calls.length
    sink.destroy()

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: messagePlaintext({
          conversation_id: 'c1',
          message_id: 'm1',
          role: 'assistant',
          text: 'hi'
        })
      })
    ).not.toThrow()
    expect(sink.send.mock.calls.length).toBe(before)
  })

  it('drops a relay-link-down transition without throwing once the window is destroyed', async () => {
    // The relay-link pair is inside the emitDaemonEvent funnel, so the one guard covers it too.
    const { sink, drivers } = await reachConnected()
    const before = sink.send.mock.calls.length
    sink.destroy()

    expect(() => drivers[0].emit({ type: 'relay-link-down', code: 4404 })).not.toThrow()
    expect(sink.send.mock.calls.length).toBe(before)
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

describe('createDaemonConnection — teardown on unpair (#504)', () => {
  /**
   * Pull the registered invoke listener out of a fake ipcMain — the unpairHandler.test `listenerOf`
   * idiom. The composition root's wiring (index.ts) has no test of its own, so this test composes
   * those two lines itself: driving `connection.reconnect()` directly would pass on `main`
   * unchanged (reconnect already fences) and prove nothing — the fix IS the wiring.
   */
  function unpairListenerFor(deps: Parameters<typeof registerUnpairHandler>[1]): (
    event: unknown
  ) => Promise<unknown> {
    const handle = vi.fn()
    registerUnpairHandler({ handle, removeHandler: vi.fn() }, deps)
    return handle.mock.calls[0][1]
  }

  /**
   * A connection and a clearable store over ONE mutable record — the real pair modelled with no new
   * helper: clear() erases it, and the connection's read-through `load` sees null on the next dial.
   * `repair()` puts it back, standing in for a later pairing confirm.
   */
  function unpairable(): {
    ctx: ReturnType<typeof build>
    store: ClearablePairedServerStore
    repair: () => void
  } {
    let record: PairedServerRecord | null = RECORD
    return {
      ctx: build({ load: () => Promise.resolve(record) }),
      store: {
        save: () => Promise.resolve(),
        load: () => Promise.resolve(record),
        clear: async () => {
          record = null
        }
      },
      repair: () => {
        record = RECORD
      }
    }
  }

  it('stops the live driver and drops its later events once the record is erased', async () => {
    const { ctx, store } = unpairable()

    // Reach connected. reachConnected() can't be reused — it hardcodes the always-RECORD load.
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    // Positive control: the same frame the post-teardown assertion drives DOES reach the sink while
    // the session is live, so "nothing arrives" below cannot pass vacuously on a mis-shaped fixture.
    const message = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi there' }
    const beforeControl = emitted(ctx.sink).length
    ctx.drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    expect(emitted(ctx.sink).slice(beforeControl)).toEqual([{ type: 'messageReceived', message }])

    // The renderer's unpair invoke, through the real handler wired the way index.ts wires it.
    const listener = unpairListenerFor({ store, onUnpaired: () => ctx.connection.reconnect() })
    const beforeUnpair = emitted(ctx.sink).length
    expect(await listener({})).toEqual({ result: 'ok' })
    await tick()

    // The authenticated session is closed, and bootstrap returns before createDriver with no record.
    expect(ctx.drivers[0].stopped).toBe(true)
    expect(ctx.drivers).toHaveLength(1)

    // Only the two permitted non-connected status events follow the teardown.
    const afterUnpair = emitted(ctx.sink).slice(beforeUnpair)
    expect(afterUnpair.map((e) => e.type)).toEqual(['connecting', 'failed'])
    expect((afterUnpair[1] as { error: { code: string } }).error.code).toBe('not-paired')

    // The superseded session keeps streaming: the generation fence drops it upstream of any decode,
    // so no session-scoped event reaches the renderer channel.
    const beforeStale = emitted(ctx.sink).length
    ctx.drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    expect(emitted(ctx.sink)).toHaveLength(beforeStale)
  })

  it('still connects on a later re-pair — the teardown never sets the permanent stopped flag', async () => {
    const { ctx, store, repair } = unpairable()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    await unpairListenerFor({ store, onUnpaired: () => ctx.connection.reconnect() })({})
    await tick()
    expect(ctx.drivers).toHaveLength(1)

    // A later pairing confirm takes the unchanged onPaired path — the same reconnect(). Were the
    // teardown to have set `stopped`, reconnect() would return early and no driver would be built.
    repair()
    const beforeRepair = emitted(ctx.sink).length
    ctx.connection.reconnect()
    await tick()
    expect(ctx.drivers).toHaveLength(2)

    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    expect(emitted(ctx.sink).slice(beforeRepair).some((e) => e.type === 'connected')).toBe(true)
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

  it('decodes an inbound screen_snapshot into BOTH snapshotReceived (run-config) and screenSnapshotReceived (text), #316', async () => {
    const { sink, drivers } = await connected()

    drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(SNAPSHOT) })

    const events = emitted(sink)
    const runConfig = events.filter((e) => e.type === 'snapshotReceived')
    expect(runConfig).toEqual([
      {
        type: 'snapshotReceived',
        model: 'claude-opus-4-8',
        effort: 'high',
        yolo: true,
        used_tokens: 45000,
        window_tokens: 200000
      }
    ])
    // The dedicated screen-text arm (#316) emits ALONGSIDE snapshotReceived, carrying ONLY text + ts.
    expect(events.filter((e) => e.type === 'screenSnapshotReceived')).toEqual([
      { type: 'screenSnapshotReceived', text: 'secret rendered screen', ts: '2026-07-08T00:00:00Z' }
    ])
    // text / ts ride only screenSnapshotReceived, NEVER the run-config snapshotReceived arm (AC2).
    expect(JSON.stringify(runConfig)).not.toContain('secret rendered screen')
    expect(JSON.stringify(runConfig)).not.toContain('2026-07-08T00:00:00Z')
    // conversation_id is dropped from BOTH events (no consumer).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('carries an empty text through to screenSnapshotReceived as the value "", not dropped (#316)', async () => {
    const { sink, drivers } = await connected()

    const emptyText: ScreenSnapshotPayload = { ...SNAPSHOT, text: '' }
    drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(emptyText) })

    expect(emitted(sink).find((e) => e.type === 'screenSnapshotReceived')).toEqual({
      type: 'screenSnapshotReceived',
      text: '',
      ts: '2026-07-08T00:00:00Z'
    })
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

describe('createDaemonConnection — structured stream (assistant_delta / turn_end, #199)', () => {
  const DELTA = { conversation_id: 'conv-1', turn_id: 'turn-1', seq: 3, text: 'a reply slice' }
  const TURN_END = { conversation_id: 'conv-1', turn_id: 'turn-1', stop_reason: 'end_turn' }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound assistant_delta into one assistantDelta carrying turnId/seq/text (camelCase)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: assistantDeltaPlaintext(DELTA) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'assistantDelta', turnId: 'turn-1', seq: 3, text: 'a reply slice' }])
    // conversation_id is dropped at the choke point (single active conversation; #202 scopes it).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('carries seq:0 and empty text through as those values, not dropped/defaulted', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: assistantDeltaPlaintext({ ...DELTA, seq: 0, text: '' })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'assistantDelta', turnId: 'turn-1', seq: 0, text: '' }
    ])
  })

  it('decodes an inbound turn_end into one turnEnd carrying turnId/stopReason (camelCase)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: turnEndPlaintext(TURN_END) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'turnEnd', turnId: 'turn-1', stopReason: 'end_turn' }])
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('drops a malformed assistant_delta without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: assistantDeltaPlaintext({ ...DELTA, seq: 'x' }) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('leaves the coarse message / message_chunk path untouched (Strangler-Fig, no regression)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length
    const message = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }
    const a = { conversation_id: 'c1', message_id: 'm2', role: 'user', text: 'one' }

    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    drivers[0].emit({ type: 'message', plaintext: chunkPlaintext({ messages: [a] }) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [a] }
    ])
  })
})

describe('createDaemonConnection — turn_state stream (#214)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound turn_state into one turnState carrying only state (conversation_id dropped)', async () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const { sink, drivers } = await connected()
      const before = emitted(sink).length

      drivers[0].emit({
        type: 'message',
        plaintext: turnStatePlaintext({ conversation_id: 'conv-1', state })
      })

      const events = emitted(sink).slice(before)
      expect(events).toEqual([{ type: 'turnState', state }])
      // conversation_id is dropped at the choke point (single active conversation; #202 scopes it).
      expect(JSON.stringify(events)).not.toContain('conv-1')
    }
  })

  it('drops a malformed turn_state without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: turnStatePlaintext({ conversation_id: 'conv-1', state: 'done' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — stall stream (#315)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound stall into exactly one nullary stallDetected (conversation_id dropped)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: stallPlaintext({ conversation_id: 'conv-1' })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'stallDetected' }])
    // conversation_id is dropped at the choke point (single active conversation; #317 owns the clear).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('drops a malformed stall without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: stallPlaintext({ conversation_id: 42 })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — api_retry stream (#492)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes a rising-edge api_retry into exactly one apiRetry event (conversation_id dropped)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: apiRetryPlaintext({
        conversation_id: 'conv-1',
        active: true,
        current: 3,
        total: 10
      })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'apiRetry', active: true, current: 3, total: 10 }])
    // conversation_id is dropped at the choke point (single active conversation, the turnState rule).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('carries 0/0 through verbatim — "count unknown" is neither coerced nor dropped', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: apiRetryPlaintext({
        conversation_id: 'conv-1',
        active: true,
        current: 0,
        total: 0
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'apiRetry', active: true, current: 0, total: 0 }
    ])
  })

  it('emits the falling edge with active false and the last-known counter', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: apiRetryPlaintext({
        conversation_id: 'conv-1',
        active: false,
        current: 4,
        total: 10
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'apiRetry', active: false, current: 4, total: 10 }
    ])
  })

  it('does NOT dedup: a climbing counter and a verbatim repeat each emit their own event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    for (const current of [3, 4, 4]) {
      drivers[0].emit({
        type: 'message',
        plaintext: apiRetryPlaintext({
          conversation_id: 'conv-1',
          active: true,
          current,
          total: 10
        })
      })
    }

    // Three frames, three events, in wire order — no coalescing, no suppression of the repeat. This
    // pins the "no dedup" wire contract against a future optimiser adding edge-tracking state here.
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'apiRetry', active: true, current: 3, total: 10 },
      { type: 'apiRetry', active: true, current: 4, total: 10 },
      { type: 'apiRetry', active: true, current: 4, total: 10 }
    ])
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: apiRetryPlaintext({
        conversation_id: 'conv-1',
        active: true,
        current: 3,
        total: 10,
        smuggled: 'must-not-cross'
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual(['active', 'current', 'total', 'type'])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed api_retry without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: apiRetryPlaintext({
          conversation_id: 'conv-1',
          active: true,
          current: '3',
          total: 10
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — compacting stream (#495)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes a rising-edge compacting into exactly one compacting event (conversation_id dropped)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: true })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'compacting', active: true }])
    // conversation_id is dropped at the choke point (single active conversation, the turnState rule).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('emits the falling edge with active false — the explicit clear, not a derived one', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: false })
    })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'compacting', active: false }])
  })

  it('does NOT dedup: two consecutive identical rising edges each emit their own event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    for (let i = 0; i < 2; i++) {
      drivers[0].emit({
        type: 'message',
        plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: true })
      })
    }

    // Two frames, two events, in wire order — no coalescing, no suppression of the repeat. This pins
    // the "no dedup" contract against a future optimiser adding edge-tracking state to this leg.
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'compacting', active: true },
      { type: 'compacting', active: true }
    ])
  })

  it('emits exactly the two modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: compactingPlaintext({
        conversation_id: 'conv-1',
        active: true,
        smuggled: 'must-not-cross'
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual(['active', 'type'])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed compacting without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: 'true' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — background_task_started stream (#564)', () => {
  /** The daemon's canonical fixture — six distinct, non-empty values (#564). */
  const STARTED = {
    conversation_id: 'conv-1',
    task_id: 'task_01ABC',
    tool_call_id: 'toolu_01XYZ',
    description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
    task_type: 'local_bash',
    truncated_fields: ['description']
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('emits exactly one backgroundTaskStarted carrying all six fields, conversationId KEPT', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskStartedPlaintext(STARTED) })

    // A whole-object assertion, which is what makes a swapped or dropped field fail (AC1).
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'backgroundTaskStarted',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        toolCallId: 'toolu_01XYZ',
        description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
        taskType: 'local_bash',
        truncatedFields: ['description']
      }
    ])
  })

  it('KEEPS conversation_id — daemon state keyed by id, not a turn-stream item (the queueState rule)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskStartedPlaintext(STARTED) })

    const events = emitted(sink).slice(before) as Array<{ conversationId?: string }>
    // The deliberate inverse of api_retry's `not.toContain('conv-1')`: #567 attributes tasks by id,
    // the same model queue_state already uses, so dropping it here would make that slice unbuildable.
    expect(events[0].conversationId).toBe('conv-1')
  })

  it('maps tool_call_id onto toolCallId, distinct from taskId (the wire name is tool_call_id)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskStartedPlaintext({
        ...STARTED,
        task_id: 'the-task-handle',
        tool_call_id: 'the-spawning-tool-call'
      })
    })

    const events = emitted(sink).slice(before) as Array<{ taskId?: string; toolCallId?: string }>
    expect(events[0].taskId).toBe('the-task-handle')
    expect(events[0].toolCallId).toBe('the-spawning-tool-call')
  })

  it('round-trips truncatedFields null as null — never coerced to an empty list', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskStartedPlaintext({ ...STARTED, truncated_fields: null })
    })

    const events = emitted(sink).slice(before) as Array<{ truncatedFields?: unknown }>
    expect(events[0].truncatedFields).toBeNull()
  })

  it('round-trips a populated truncatedFields element-for-element, in order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskStartedPlaintext({
        ...STARTED,
        truncated_fields: ['description', 'task_type']
      })
    })

    const events = emitted(sink).slice(before) as Array<{ truncatedFields?: unknown }>
    expect(events[0].truncatedFields).toEqual(['description', 'task_type'])
  })

  it('emits exactly the seven modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskStartedPlaintext({ ...STARTED, smuggled: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'description',
      'taskId',
      'taskType',
      'toolCallId',
      'truncatedFields',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('holds no correlation memory: two tasks and a verbatim repeat each emit their own event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    for (const task_id of ['task_01ABC', 'task_02DEF', 'task_02DEF']) {
      drivers[0].emit({
        type: 'message',
        plaintext: backgroundTaskStartedPlaintext({ ...STARTED, task_id })
      })
    }

    // Three frames, three events, in arrival order — the transport holds no task map (that is #567's,
    // and the wire's ordering is claude's, so any buffering here would be wrong).
    const events = emitted(sink).slice(before) as Array<{ taskId?: string }>
    expect(events.map((e) => e.taskId)).toEqual(['task_01ABC', 'task_02DEF', 'task_02DEF'])
  })

  it('drops a malformed background_task_started without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length
    const missingKey: Record<string, unknown> = { ...STARTED }
    delete missingKey.truncated_fields

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: backgroundTaskStartedPlaintext(missingKey)
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — unrecognized_message stream', () => {
  const UNRECOGNIZED = {
    conversation_id: 'conv-1',
    site: 'line_type',
    message_type: 'some_future_event',
    raw: '{"type":"some_future_event","detail":"something new"}',
    truncated: false
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('emits an unrecognizedMessage carrying the four display fields, dropping conversation_id', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: unrecognizedPlaintext(UNRECOGNIZED) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      {
        type: 'unrecognizedMessage',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event","detail":"something new"}',
        truncated: false
      }
    ])
    // conversation_id is dropped at the choke point (single active conversation, the turnState rule).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('carries an empty messageType through — the undecodable site read no type at all', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: unrecognizedPlaintext({
        ...UNRECOGNIZED,
        site: 'undecodable',
        message_type: '',
        raw: '{"type":"assist'
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'unrecognizedMessage',
        site: 'undecodable',
        messageType: '',
        raw: '{"type":"assist',
        truncated: false
      }
    ])
  })

  it('does NOT dedup: two identical frames each emit their own event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    for (let i = 0; i < 2; i++) {
      drivers[0].emit({ type: 'message', plaintext: unrecognizedPlaintext(UNRECOGNIZED) })
    }

    // A repeat is a REAL repeat. Collapsing repeats would hide how often this fires, which is exactly
    // the number that tells an operator to go fix something. This pins the contract against a future
    // optimiser adding edge-tracking state to this leg.
    expect(emitted(sink).slice(before)).toHaveLength(2)
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: unrecognizedPlaintext({ ...UNRECOGNIZED, smuggled: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'messageType',
      'raw',
      'site',
      'truncated',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed unrecognized_message without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: unrecognizedPlaintext({ ...UNRECOGNIZED, site: 'bogus_site' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — session_transition stream (#254)', () => {
  const SESSION_TRANSITION = {
    previous_session_id: 'sess-1',
    new_session_id: 'sess-2',
    reason: 'clear',
    occurred_at: '2026-07-10T00:00:00.000000000Z',
    workspace_cwd: null
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound session_transition, carrying newSessionId / reason / occurredAt / workspaceCwd', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: sessionTransitionPlaintext(SESSION_TRANSITION) })

    // The /clear fixture's null workspace_cwd is carried as `null`, not coerced to '' (AC2).
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'sessionTransition',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      }
    ])
  })

  it('carries reason / occurredAt / workspaceCwd; drops only previous_session_id at the emit (content-drop narrowed to the one field with no consumer)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // A workspace_change frame carries a non-null workspace_cwd; it now crosses IPC by design (#286).
    drivers[0].emit({
      type: 'message',
      plaintext: sessionTransitionPlaintext({
        previous_session_id: 'sess-old',
        new_session_id: 'sess-new',
        reason: 'workspace_change',
        occurred_at: '2026-07-10T00:00:00.000000000Z',
        workspace_cwd: '/home/user/secret-workspace'
      })
    })

    const events = emitted(sink).slice(before)
    // The non-null workspace path DOES cross now — the content-drop is narrowed to previous_session_id.
    expect(events).toEqual([
      {
        type: 'sessionTransition',
        newSessionId: 'sess-new',
        reason: 'workspace_change',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: '/home/user/secret-workspace'
      }
    ])
    expect(Object.keys(events[0]).sort()).toEqual([
      'newSessionId',
      'occurredAt',
      'reason',
      'type',
      'workspaceCwd'
    ])
    // The surviving drop: previous_session_id (and its value) never cross — it has no consumer.
    const serialized = JSON.stringify(events)
    for (const dropped of ['sess-old', 'previous_session_id']) {
      expect(serialized).not.toContain(dropped)
    }
  })

  it('drops a malformed session_transition without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: sessionTransitionPlaintext({ ...SESSION_TRANSITION, reason: 'evicted' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('leaves the coarse message / message_chunk path untouched (no regression)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length
    const message = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }
    const a = { conversation_id: 'c1', message_id: 'm2', role: 'user', text: 'one' }

    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    drivers[0].emit({ type: 'message', plaintext: chunkPlaintext({ messages: [a] }) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [a] }
    ])
  })
})

describe('createDaemonConnection — session_settings_updated correlation (#261, reworks #264)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('ignores a reply whose in_reply_to matches no pending change — no confirmed event (AC3 fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // No prior setSessionSettings send: the reply's in_reply_to correlates to nothing, so it is
    // ignored — no coercion, no confirmed event (a hostile daemon cannot forge a confirmation).
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-2' }, 99)
    })

    expect(emitted(sink).slice(before)).toEqual([])
  })

  it('correlates a reply by in_reply_to to its pending change and emits the confirmed event with the changeId (AC1/AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    // The daemon echoes the request envelope id as in_reply_to (pyrycode#845).
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-2' }, id)
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'sessionSettingsUpdated', sessionId: 'sess-2', changeId: 'change-1' }
    ])
  })

  it('ignores a reply with an absent in_reply_to even while a change is outstanding (fail-closed before lookup)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const before = emitted(sink).length

    // A reply that omits in_reply_to cannot correlate — the undefined short-circuits before the map
    // lookup, so it is ignored despite the outstanding pending change.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-2' })
    })

    expect(emitted(sink).slice(before)).toEqual([])
  })

  it('emits a fresh literal — only type + sessionId + changeId cross IPC, never in_reply_to or a spurious echoed key (AC2 no-echo)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-3' }, 'change-1')
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = emitted(sink).length

    // A hostile frame echoing a spurious model / in_reply_to onto the PAYLOAD must not ride the arm;
    // the emitted event carries the CLIENT-minted changeId, never the wire in_reply_to routing id.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext(
        { session_id: 'sess-3', model: 'claude-opus-4-8', in_reply_to: 42 },
        id
      )
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      { type: 'sessionSettingsUpdated', sessionId: 'sess-3', changeId: 'change-1' }
    ])
    // Exactly the three keys — no in_reply_to / inReplyTo, no echoed key. Load-bearing regression pin.
    expect(Object.keys(events[0]).sort()).toEqual(['changeId', 'sessionId', 'type'])
    const serialized = JSON.stringify(events)
    for (const dropped of ['in_reply_to', 'inReplyTo', 'model', 'claude-opus-4-8']) {
      expect(serialized).not.toContain(dropped)
    }
  })

  it('distinguishes two outstanding changes to the SAME session by changeId, replies in either order (AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-x' }, 'change-1')
    connection.setSessionSettings({ session_id: 'sess-x' }, 'change-2')
    const id1 = decodeEnvelope(drivers[0].sent[0]).id
    const id2 = decodeEnvelope(drivers[0].sent[1]).id
    const before = emitted(sink).length

    // Replies arrive REVERSED; each confirmed event still carries the exact matching changeId, so the
    // renderer can tell two same-session_id changes apart.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-x' }, id2)
    })
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-x' }, id1)
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'sessionSettingsUpdated', sessionId: 'sess-x', changeId: 'change-2' },
      { type: 'sessionSettingsUpdated', sessionId: 'sess-x', changeId: 'change-1' }
    ])
  })

  it('clears the pending map on reconnect — a reply for an abandoned change emits nothing (AC5)', async () => {
    const ctx = await connected()

    ctx.connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const id = decodeEnvelope(ctx.drivers[0].sent[0]).id

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = emitted(ctx.sink).length

    // dial() abandoned the outstanding change; a reply echoing the old id (ids also recycle from 2)
    // correlates to nothing on the fresh connection — no stale correlation survives.
    ctx.drivers[1].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-2' }, id)
    })

    expect(emitted(ctx.sink).slice(before)).toEqual([])
  })

  it('drops a malformed session_settings_updated without emitting or throwing, even with a pending change (fail-closed)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = sink.webContents.send.mock.calls.length

    // A malformed payload (no session_id) throws in the decoder and is caught BEFORE correlation — no
    // event, no throw, even though the in_reply_to matches an outstanding change.
    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: sessionSettingsUpdatedPlaintext({}, id) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('records no pending entry when the send throws — a later matching reply emits nothing', async () => {
    const { connection, sink, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    // The send throws (caught); the pendingSettings.set that FOLLOWS the send never runs — no phantom
    // entry (the answerModal record-after-send precedent, #248).
    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const before = emitted(sink).length

    // The would-be minted id is 2 (fresh connect starts nextEnvelopeId at 2); echoing it correlates to
    // nothing because no pending entry was recorded.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsUpdatedPlaintext({ session_id: 'sess-2' }, 2)
    })

    expect(emitted(sink).slice(before)).toEqual([])
  })

  it('leaves the coarse message / message_chunk path untouched (no regression)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length
    const message = { conversation_id: 'c1', message_id: 'm1', role: 'assistant', text: 'hi' }
    const a = { conversation_id: 'c1', message_id: 'm2', role: 'user', text: 'one' }

    drivers[0].emit({ type: 'message', plaintext: messagePlaintext(message) })
    drivers[0].emit({ type: 'message', plaintext: chunkPlaintext({ messages: [a] }) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [a] }
    ])
  })
})

describe('createDaemonConnection — tool_use stream (#217)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound tool_use into one toolUse carrying the four camelCase fields (conversation_id dropped)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolUsePlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        name: 'Read',
        input_summary: 'reads /etc/hosts'
      })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      {
        type: 'toolUse',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts'
      }
    ])
    // conversation_id is dropped at the choke point (single active conversation; #202 scopes it).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('drops a malformed tool_use without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: toolUsePlaintext({
          conversation_id: 'conv-1',
          turn_id: 'turn-1',
          tool_use_id: 'tu-1',
          name: 'Read'
          // input_summary missing → fail closed
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — tool_result stream (#229)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound tool_result into one toolResult carrying the four camelCase fields (conversation_id dropped)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolResultPlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        is_error: false,
        result_summary: 'read 12 lines'
      })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      {
        type: 'toolResult',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines'
      }
    ])
    // conversation_id is dropped at the choke point (single active conversation; #202 scopes it).
    expect(JSON.stringify(events)).not.toContain('conv-1')
  })

  it('carries isError:true through as that value (an errored tool)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolResultPlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        is_error: true,
        result_summary: 'permission denied'
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'toolResult',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: true,
        resultSummary: 'permission denied'
      }
    ])
  })

  it('drops a malformed tool_result without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: toolResultPlaintext({
          conversation_id: 'conv-1',
          turn_id: 'turn-1',
          tool_use_id: 'tu-1',
          is_error: 'nope', // non-boolean → fail closed
          result_summary: 'x'
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — queue_state stream (#292)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound queue_state into one queueState carrying conversationId + the ordered backlog', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: queueStatePlaintext({
        conversation_id: 'conv-1',
        queued: [
          { queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' },
          { queued_msg_id: 2, text: 'second', ts: '2026-07-10T00:00:01Z' }
        ]
      })
    })

    // AC2: the event carries the conversation id and the ordered backlog, queued_msg_id as numbers.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'queueState',
        conversationId: 'conv-1',
        queued: [
          { queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' },
          { queued_msg_id: 2, text: 'second', ts: '2026-07-10T00:00:01Z' }
        ]
      }
    ])
  })

  it('emits an empty backlog as queued: [] — not null, not an error (AC3)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: queueStatePlaintext({ conversation_id: 'conv-1', queued: [] })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'queueState', conversationId: 'conv-1', queued: [] }
    ])
  })

  it('drops a malformed queue_state without emitting or throwing (fail-closed, AC4)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: queueStatePlaintext({
          conversation_id: 'conv-1',
          queued: [{ queued_msg_id: '7', text: 'x', ts: 't' }] // string counter → fail closed
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — modal_shown stream (#201)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound modal_shown into one modalShown carrying all six camelCase fields, options in order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modalShownPlaintext({
        modal_id: 'mdl-7f3a',
        class: 'permission',
        title: 'Allow Bash?',
        prompt: 'claude wants to run: rm -rf build/',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'deny', label: 'Deny' }
        ],
        default_option_id: 'deny'
      })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      {
        type: 'modalShown',
        modalId: 'mdl-7f3a',
        class: 'permission',
        title: 'Allow Bash?',
        prompt: 'claude wants to run: rm -rf build/',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'deny', label: 'Deny' }
        ],
        defaultOptionId: 'deny'
      }
    ])
  })

  it('drops a malformed modal_shown (out-of-enum class) without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: modalShownPlaintext({
          modal_id: 'mdl-7f3a',
          class: 'destructive', // no destructive wire class → fail closed
          title: 'Allow Bash?',
          prompt: 'run rm -rf',
          options: [{ id: 'allow', label: 'Allow' }],
          default_option_id: 'allow'
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — modal_dismissed stream (#201)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound modal_dismissed into one modalDismissed for each of the three sources', async () => {
    for (const source of ['remote', 'local', 'timeout'] as const) {
      const { sink, drivers } = await connected()
      const before = emitted(sink).length

      drivers[0].emit({
        type: 'message',
        plaintext: modalDismissedPlaintext({ modal_id: 'mdl-7f3a', outcome: 'allow', source })
      })

      const events = emitted(sink).slice(before)
      expect(events).toEqual([
        { type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source }
      ])
    }
  })

  it('drops a malformed modal_dismissed (out-of-enum source) without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: modalDismissedPlaintext({ modal_id: 'mdl-7f3a', outcome: 'allow', source: 'admin' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — conversations (list_conversations request / conversations reply, #139)', () => {
  const CONV_NAMED = {
    id: 'conv-1',
    name: 'My channel',
    is_promoted: true,
    is_archived: false,
    cwd: '/home/user/project',
    last_message_ts: '2026-07-08T00:00:00Z',
    last_used_at: '2026-07-09T00:00:00Z'
  }
  const CONV_UNNAMED = {
    id: 'conv-2',
    name: null,
    is_promoted: false,
    is_archived: true,
    cwd: '/tmp/scratch',
    last_message_ts: '2026-07-07T00:00:00Z',
    last_used_at: '2026-07-07T12:00:00Z'
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

    expect(() => connection.requestConversations()).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one bare list_conversations envelope with id 2 and the fixed ts', async () => {
    const { connection, drivers } = await connected()

    connection.requestConversations()

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('list_conversations')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Bare control frame: a present-but-empty payload, no conversation selector.
    expect(envelope.payload).toEqual({})
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.requestConversations()

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.requestConversations()).not.toThrow()
  })

  it('decodes an inbound conversations reply into one conversationsReceived carrying the summaries (snake_case, null name preserved)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: conversationsPlaintext({ conversations: [CONV_NAMED, CONV_UNNAMED] })
    })

    // The event reuses the wire ConversationSummary verbatim (snake_case) — like messagesReceived
    // reuses MessagePayload; #208's store derives the discussion/channel label from is_promoted.
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'conversationsReceived', conversations: [CONV_NAMED, CONV_UNNAMED] }
    ])
  })

  it('preserves wire order and carries an empty conversations list through unchanged', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: conversationsPlaintext({ conversations: [] })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'conversationsReceived', conversations: [] }
    ])
  })

  it('drops a malformed conversations reply without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: conversationsPlaintext({ conversations: [{ ...CONV_NAMED, is_promoted: 'nope' }] })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — recentWorkspaces (recent_workspaces request / recent_workspaces_list reply, #380)', () => {
  const WS_ONE = { path: '/home/user/project', last_used_at: '2026-07-09T00:00:00Z' }
  const WS_TWO = { path: '/tmp/scratch', last_used_at: '2026-07-07T12:00:00Z' }

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

    expect(() => connection.requestRecentWorkspaces()).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one bare recent_workspaces envelope with id 2 and the fixed ts', async () => {
    const { connection, drivers } = await connected()

    connection.requestRecentWorkspaces()

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('recent_workspaces')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Bare control frame: a present-but-empty payload, no selector.
    expect(envelope.payload).toEqual({})
  })

  it('shares the one envelope-id counter with send and requestConversations (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.requestConversations()
    connection.requestRecentWorkspaces()

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
    expect(decodeEnvelope(drivers[0].sent[2]).id).toBe(4)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.requestRecentWorkspaces()).not.toThrow()
  })

  it('decodes an inbound recent_workspaces_list reply into one recentWorkspacesReceived carrying the rows (order preserved)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: recentWorkspacesPlaintext({ workspaces: [WS_ONE, WS_TWO] })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'recentWorkspacesReceived', recentWorkspaces: [WS_ONE, WS_TWO] }
    ])
  })

  it('carries an empty workspaces list through unchanged', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: recentWorkspacesPlaintext({ workspaces: [] })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'recentWorkspacesReceived', recentWorkspaces: [] }
    ])
  })

  it('drops a malformed recent_workspaces_list reply without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: recentWorkspacesPlaintext({ workspaces: [{ ...WS_ONE, path: 42 }] })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — createConversation (create_conversation request / conversation_created reply, #241)', () => {
  const ALL_NULL: CreateConversationPayload = { is_promoted: null, name: null, cwd: null }
  const POPULATED: CreateConversationPayload = {
    is_promoted: true,
    name: 'design review',
    cwd: '/home/user/project'
  }
  const CREATED = {
    id: 'conv-9',
    is_promoted: false,
    cwd: '/tmp/scratch',
    name: null,
    last_used_at: '2026-07-10T00:00:00Z'
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

    expect(() => connection.createConversation(ALL_NULL)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one create_conversation envelope with id 2, ts, and the three explicit nulls', async () => {
    const { connection, drivers } = await connected()

    connection.createConversation(ALL_NULL)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('create_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The explicit nulls cross the wire — the daemon's "take the server default" signal.
    expect(envelope.payload).toEqual({ is_promoted: null, name: null, cwd: null })
  })

  it('forwards a fully-populated payload verbatim', async () => {
    const { connection, drivers } = await connected()

    connection.createConversation(POPULATED)

    expect(decodeEnvelope(drivers[0].sent[0]).payload).toEqual(POPULATED)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.createConversation(ALL_NULL)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.createConversation(ALL_NULL)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the three modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in createConversation must bound the wire to exactly the three fields.
    connection.createConversation({
      is_promoted: null,
      name: null,
      cwd: null,
      is_archived: true
    } as unknown as CreateConversationPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual({ is_promoted: null, name: null, cwd: null })
    expect(JSON.stringify(payload)).not.toContain('is_archived')
  })

  it('decodes an inbound conversation_created into one conversationCreated carrying the summary (null name preserved)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: conversationCreatedPlaintext(CREATED) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'conversationCreated', conversation: CREATED }])
  })

  it('drops a malformed conversation_created reply without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: conversationCreatedPlaintext({ ...CREATED, is_promoted: 'nope' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — createWorkspaceFolder (create_workspace_folder request / workspace_folder_created reply, #381)', () => {
  const PAYLOAD: CreateWorkspaceFolderPayload = { parent: '/home/user/projects', name: 'new-app' }
  const FOLDER_CREATED = { path: '/home/user/projects/new-app' }

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

    expect(() => connection.createWorkspaceFolder(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one create_workspace_folder envelope with id 2, ts, and exactly { parent, name }', async () => {
    const { connection, drivers } = await connected()

    connection.createWorkspaceFolder(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('create_workspace_folder')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual({ parent: '/home/user/projects', name: 'new-app' })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.createWorkspaceFolder(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.createWorkspaceFolder(PAYLOAD)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in createWorkspaceFolder must bound the wire to exactly the two fields.
    connection.createWorkspaceFolder({
      parent: '/home/user/projects',
      name: 'new-app',
      conversation_id: 'smuggled'
    } as unknown as CreateWorkspaceFolderPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual({ parent: '/home/user/projects', name: 'new-app' })
    expect(JSON.stringify(payload)).not.toContain('smuggled')
  })

  it('decodes an inbound workspace_folder_created into one workspaceFolderCreated carrying the path', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: workspaceFolderCreatedPlaintext(FOLDER_CREATED) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'workspaceFolderCreated', path: FOLDER_CREATED.path }
    ])
  })

  it('drops a malformed workspace_folder_created reply without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: workspaceFolderCreatedPlaintext({ path: 42 })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — promoteConversation (promote_conversation request / conversation_updated broadcast, #273)', () => {
  const PROMOTE: PromoteConversationPayload = {
    conversation_id: 'conv-9',
    name: 'weekly sync',
    cwd: '/home/user/project'
  }
  const UPDATED = {
    id: 'conv-9',
    is_promoted: true,
    name: null,
    cwd: '/home/user/project',
    last_used_at: '2026-07-12T00:00:00Z'
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

    expect(() => connection.promoteConversation(PROMOTE)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one promote_conversation envelope with id 2, ts, and the three fields', async () => {
    const { connection, drivers } = await connected()

    connection.promoteConversation(PROMOTE)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('promote_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(PROMOTE)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.promoteConversation(PROMOTE)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.promoteConversation(PROMOTE)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the three modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in promoteConversation must bound the wire to exactly the three fields.
    connection.promoteConversation({
      conversation_id: 'conv-9',
      name: 'weekly sync',
      cwd: '/home/user/project',
      is_promoted: true
    } as unknown as PromoteConversationPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(PROMOTE)
    expect(JSON.stringify(payload)).not.toContain('is_promoted')
  })

  it('decodes an inbound conversation_updated into one conversationUpdated carrying the payload (null name preserved)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: conversationUpdatedPlaintext(UPDATED) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'conversationUpdated', conversation: UPDATED }])
  })

  it('drops a malformed conversation_updated broadcast without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: conversationUpdatedPlaintext({ ...UPDATED, is_promoted: 'nope' })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — conversation_deleted inbound decode → conversationDeleted event (#375)', () => {
  const DELETED = { id: 'conv-9' }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound conversation_deleted into one conversationDeleted carrying the bare id', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: conversationDeletedPlaintext(DELETED) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'conversationDeleted', id: DELETED.id }])
  })

  it('drops a malformed conversation_deleted reply without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: conversationDeletedPlaintext({ id: 42 })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — unarchiveConversation (outbound unarchive_conversation, #346)', () => {
  const UNARCHIVE: UnarchiveConversationPayload = { conversation_id: 'conv-9' }

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

    expect(() => connection.unarchiveConversation(UNARCHIVE)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one unarchive_conversation envelope with id 2, ts, and the field', async () => {
    const { connection, drivers } = await connected()

    connection.unarchiveConversation(UNARCHIVE)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('unarchive_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(UNARCHIVE)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.unarchiveConversation(UNARCHIVE)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.unarchiveConversation(UNARCHIVE)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the one modeled field (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in unarchiveConversation must bound the wire to exactly conversation_id.
    connection.unarchiveConversation({
      conversation_id: 'conv-9',
      is_archived: false
    } as unknown as UnarchiveConversationPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(UNARCHIVE)
    expect(JSON.stringify(payload)).not.toContain('is_archived')
  })
})

describe('createDaemonConnection — deleteConversation (outbound delete_conversation, #364)', () => {
  const DELETE: DeleteConversationPayload = { conversation_id: 'conv-9' }

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

    expect(() => connection.deleteConversation(DELETE)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one delete_conversation envelope with id 2, ts, and the field', async () => {
    const { connection, drivers } = await connected()

    connection.deleteConversation(DELETE)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('delete_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(DELETE)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.deleteConversation(DELETE)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.deleteConversation(DELETE)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the one modeled field (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in deleteConversation must bound the wire to exactly conversation_id.
    // Delete is the PERMANENT verb — bounding the wire to the one modeled field matters most here.
    connection.deleteConversation({
      conversation_id: 'conv-9',
      is_archived: false
    } as unknown as DeleteConversationPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(DELETE)
    expect(JSON.stringify(payload)).not.toContain('is_archived')
  })
})

describe('createDaemonConnection — renameConversation (outbound rename_conversation, #359)', () => {
  const RENAME: RenameConversationPayload = { conversation_id: 'conv-9', name: 'weekly sync' }

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

    expect(() => connection.renameConversation(RENAME)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one rename_conversation envelope with id 2, ts, and the payload', async () => {
    const { connection, drivers } = await connected()

    connection.renameConversation(RENAME)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('rename_conversation')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(RENAME)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.renameConversation(RENAME)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.renameConversation(RENAME)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in renameConversation must bound the wire to conversation_id + name.
    connection.renameConversation({
      conversation_id: 'conv-9',
      name: 'weekly sync',
      cwd: '/smuggled'
    } as unknown as RenameConversationPayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(RENAME)
    expect(JSON.stringify(payload)).not.toContain('cwd')
  })
})

describe('createDaemonConnection — changeWorkspace (outbound change_workspace, #379)', () => {
  const CHANGE: ChangeWorkspacePayload = { conversation_id: 'conv-9', cwd: '/home/user/project' }

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

    expect(() => connection.changeWorkspace(CHANGE)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one change_workspace envelope with id 2, ts, and the payload', async () => {
    const { connection, drivers } = await connected()

    connection.changeWorkspace(CHANGE)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('change_workspace')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(CHANGE)
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.changeWorkspace(CHANGE)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.changeWorkspace(CHANGE)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in changeWorkspace must bound the wire to conversation_id + cwd.
    connection.changeWorkspace({
      conversation_id: 'conv-9',
      cwd: '/home/user/project',
      name: 'smuggled'
    } as unknown as ChangeWorkspacePayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(CHANGE)
    expect(JSON.stringify(payload)).not.toContain('smuggled')
  })
})

describe('createDaemonConnection — setSessionSettings (outbound set_session_settings, #263)', () => {
  const PARTIAL: SetSessionSettingsPayload = { session_id: 'sess-a', yolo: false }

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

    expect(() => connection.setSessionSettings(PARTIAL, 'change-1')).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one set_session_settings envelope with id 2, ts, and the payload', async () => {
    const { connection, drivers } = await connected()

    connection.setSessionSettings(PARTIAL, 'change-1')

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('set_session_settings')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The present zero-value (yolo:false) crosses; the unset optionals are absent (builder contract).
    // This assertion also doubles as the "changeId never rides the wire" check (#261): the client-minted
    // 'change-1' correlation key is NOT in the payload and NOT on the envelope — the builder reads only
    // `payload`, so the key stays IPC-internal.
    expect(envelope.payload).toEqual({ session_id: 'sess-a', yolo: false })
    expect(JSON.stringify(drivers[0].sent[0])).not.toContain('change-1')
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.setSessionSettings(PARTIAL, 'change-1')

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.setSessionSettings(PARTIAL, 'change-1')).not.toThrow()
  })

  it('drops an over-cap payload: no throw, no frame, and the id is not consumed', async () => {
    const { connection, drivers } = await connected()

    // A payload whose serialized envelope exceeds MAX_PLAINTEXT_BYTES makes the builder throw
    // WireEncodeError; the method catches it (parity #490) and advances no id.
    expect(() =>
      connection.setSessionSettings({ session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES + 1) }, 'change-1')
    ).not.toThrow()
    expect(drivers[0].sent).toHaveLength(0)

    // The next successful send still gets id 2 — the dropped over-cap build consumed nothing.
    connection.setSessionSettings(PARTIAL, 'change-2')
    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
  })
})

describe('createDaemonConnection — answerModal (outbound modal_answer, #236)', () => {
  const PAYLOAD = { modal_id: 'md-1', option_id: 'opt-1' }

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

    expect(() => connection.answerModal(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one modal_answer envelope with id 2, the fixed ts, and the minted token', async () => {
    const { connection, drivers } = await connected()

    connection.answerModal(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('modal_answer')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The main-side-minted answer_token lands in the sent frame alongside the passed-through fields.
    expect(envelope.payload).toEqual({
      modal_id: 'md-1',
      option_id: 'opt-1',
      answer_token: 'test-token'
    })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.answerModal(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.answerModal(PAYLOAD)).not.toThrow()
  })

  it('mints a fresh answer_token per call — two answers carry two distinct tokens (anti-replay)', async () => {
    let n = 0
    const ctx = build({ mintToken: () => `tok-${(n += 1)}` })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.connection.answerModal(PAYLOAD)
    ctx.connection.answerModal(PAYLOAD)

    const first = decodeEnvelope(ctx.drivers[0].sent[0]).payload as { answer_token: string }
    const second = decodeEnvelope(ctx.drivers[0].sent[1]).payload as { answer_token: string }
    expect(first.answer_token).toBe('tok-1')
    expect(second.answer_token).toBe('tok-2')
    expect(first.answer_token).not.toBe(second.answer_token)
  })

  it('ignores a renderer-smuggled answer_token — the sent frame carries the minted one (fresh literal, no-smuggle)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an answer_token onto the payload despite the Omit type.
    // The fresh-literal construction in answerModal must ignore it — the minted token wins.
    connection.answerModal({
      modal_id: 'md-1',
      option_id: 'opt-1',
      answer_token: 'smuggled'
    } as unknown as { modal_id: string; option_id: string })

    const payload = decodeEnvelope(drivers[0].sent[0]).payload as { answer_token: string }
    expect(payload.answer_token).toBe('test-token')
    expect(JSON.stringify(payload)).not.toContain('smuggled')
  })
})

describe('createDaemonConnection — cancelModal (outbound modal_cancel, #236)', () => {
  const PAYLOAD = { modal_id: 'md-1' }

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

    expect(() => connection.cancelModal(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one modal_cancel envelope with id 2, the fixed ts, and { modal_id }', async () => {
    const { connection, drivers } = await connected()

    connection.cancelModal(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('modal_cancel')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual({ modal_id: 'md-1' })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.cancelModal(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.cancelModal(PAYLOAD)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent modal_cancel payload is exactly { modal_id } (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    connection.cancelModal({ modal_id: 'md-1', option_id: 'opt-1' } as unknown as {
      modal_id: string
    })

    expect(decodeEnvelope(drivers[0].sent[0]).payload).toEqual({ modal_id: 'md-1' })
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

  // #505 — the two teardown paths the net missed. A retryable close and a re-dial are both
  // stream-fatal (the supervisor dials a FRESH Noise session with no resume, so the daemon-side
  // request dies and the remaining chunks never arrive), but neither reached consumer.fail.
  it('fails the consumer connection-lost when a relay-link-down interrupts the stream (#505)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'relay-link-down', code: 1006 })

    expect(failed).toEqual(['connection-lost'])
    expect(completed).toEqual([])
    // The arm is OTHERWISE unchanged: the same classified category still reaches the window with
    // the same content-free { type, status } payload, and the raw close code is still dropped.
    const relayEvent = emitted(sink).find((e) => e.type === 'relayLinkChanged')
    expect(relayEvent).toEqual({ type: 'relayLinkChanged', status: 'offline' })
    expect(relayEvent && Object.keys(relayEvent)).toEqual(['type', 'status'])
  })

  it('absorbs a straggler chunk after a link-down and takes no second terminal from a later terminal (#505)', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed, progress } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    drivers[0].emit({ type: 'relay-link-down', code: 1006 })

    // The fail must land AT the link-down. A bare end-state "exactly one fail" assertion would be
    // vacuous — the trailing terminal below supplies that one fail on the unfixed build too.
    expect(failed).toEqual(['connection-lost'])
    const ticks = progress.length

    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(1, CHUNK_B) })
    drivers[0].emit({ type: 'terminal', code: 4426, reason: 'dropped' })

    expect(progress).toHaveLength(ticks) // the straggler is absorbed, not delivered
    expect(failed).toEqual(['connection-lost'])
    expect(completed).toEqual([])
  })

  it('fails the consumer connection-lost when a reconnect abandons the stream, without waiting on the new driver (#505)', async () => {
    const { connection, drivers } = await connected()
    const { consumer, completed, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK_A) })
    connection.reconnect()

    // Synchronous, before any tick: dial() bumps `generation` BEFORE stopping the old driver, so
    // that driver's terminal{1000} is dropped by the fence — the fail can only come from dial().
    expect(failed).toEqual(['connection-lost'])

    await tick()
    drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(failed).toEqual(['connection-lost'])
    expect(completed).toEqual([])
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

// #505 — the wedge itself. The single-in-flight `active` flag lives in the ORCHESTRATOR, not in
// the reassembler, so a test that drives a spy consumer directly cannot tell "wedged" from "fine".
// These compose the REAL createDebugBundleDownload over the REAL connection.requestDebugBundle;
// the observable is whether a LATER download still reaches the wire.
describe('createDaemonConnection — a teardown unwedges the debug-bundle orchestrator (#505)', () => {
  const CHUNK = new Uint8Array([1, 2, 3, 4])

  /** Reach the connected window with the real orchestrator wired over the real transport call. */
  async function connectedDownload(): Promise<
    ReturnType<typeof build> & { download: DebugBundleDownload; events: DaemonEvent[] }
  > {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const events: DaemonEvent[] = []
    // `save` is never reached: every path here ends in `fail`, so no archive is ever completed.
    const download = createDebugBundleDownload({
      requestDebugBundle: (consumer) => ctx.connection.requestDebugBundle(consumer),
      save: vi.fn(async () => '/unreachable'),
      emit: (event) => events.push(event)
    })
    return { ...ctx, download, events }
  }

  /** How many request_debug_bundle envelopes actually reached this driver. */
  function bundleRequests(driver: FakeDriver): number {
    return driver.sent.filter((bytes) => decodeEnvelope(bytes).type === 'request_debug_bundle')
      .length
  }

  it('clears the single-in-flight flag on a relay-link-down, so a later download still reaches the wire', async () => {
    const { drivers, download, events } = await connectedDownload()

    download.request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    drivers[0].emit({ type: 'relay-link-down', code: 1006 })

    expect(events).toContainEqual({ type: 'debugBundleFailed', reason: 'unavailable' })

    download.request()

    // Two frames on the wire: without the teardown the second request is silently short-circuited
    // by the stuck `active` flag, for the rest of the process lifetime.
    expect(bundleRequests(drivers[0])).toBe(2)
  })

  it('clears the single-in-flight flag on a reconnect, so a later download reaches the new driver', async () => {
    const { connection, drivers, download } = await connectedDownload()

    download.request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    connection.reconnect()
    await tick()
    drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    download.request()

    expect(bundleRequests(drivers[1])).toBe(1)
  })

  it('fails a download requested before the new handshake completes, rather than wedging (AC4)', async () => {
    const { connection, drivers, download, events } = await connectedDownload()

    download.request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    connection.reconnect()
    // Deliberately no `await tick()`: dial() has nulled the driver and the bootstrap reassigns it
    // only a microtask later, so this is the window where requestDebugBundle's null guard is exact.
    download.request()

    // Two terminals, both the coarse `unavailable` category: one from the re-dial teardown, one
    // from the not-connected guard. Still a terminal, still not wedged.
    expect(events.filter((e) => e.type === 'debugBundleFailed')).toHaveLength(2)
    expect(bundleRequests(drivers[0])).toBe(1) // the second request sent nothing
  })
})

describe('createDaemonConnection — modal-answer rejection correlation (#248)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The modalAnswerRejected events emitted so far, in order. */
  function rejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'modalAnswerRejected')
  }

  it('emits one correlated modalAnswerRejected when an error follows an outstanding answer (AC1)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('does not emit a rejection when no answer is outstanding — the error keeps its drop behaviour (AC2)', async () => {
    const { sink, drivers } = await connected()

    // No prior answerModal: the content-free error is unattributable, so it stays dropped (no bundle in
    // flight either) — exactly the pre-#248 behaviour.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(sink)).toEqual([])
  })

  it('an accepted answer (modal_dismissed) drains the window, so a later unrelated error does not mis-attribute', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    // The daemon accepts the answer and dismisses the modal — this drains the outstanding-answer window.
    drivers[0].emit({
      type: 'message',
      plaintext: modalDismissedPlaintext({ modal_id: 'mdl-1', outcome: 'allow', source: 'remote' })
    })
    // A later, unrelated error must NOT be attributed to the already-accepted answer.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(sink)).toEqual([])
  })

  it('correlates two outstanding answers in FIFO send order across two errors', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.answerModal({ modal_id: 'mdl-2', option_id: 'deny' })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(sink)).toEqual([
      { type: 'modalAnswerRejected', modalId: 'mdl-1' },
      { type: 'modalAnswerRejected', modalId: 'mdl-2' }
    ])
  })

  it('carries only { type, modalId } and never echoes the daemon error content (AC3 no-echo)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    const rejection = rejections(sink)[0]
    expect(Object.keys(rejection).sort()).toEqual(['modalId', 'type'])
    // errorPlaintext()'s ErrorPayload message ('secret error detail') must appear in no emitted event.
    expect(JSON.stringify(emitted(sink))).not.toContain('secret error detail')
  })

  it('reconnect resets the window, so an error after a fresh dial does not correlate a stale answer', async () => {
    const ctx = await connected()

    ctx.connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.drivers[1].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(ctx.sink)).toEqual([])
  })

  it('a bundle download and an outstanding answer both react to one error (independent consumers)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    // Both fire: the reassembler fails the bundle AND the correlation emits the rejection — the
    // documented, accepted double-fire for a genuinely unattributable content-free error.
    expect(failed).toEqual(['daemon-error'])
    expect(rejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('an answer whose send throws records no outstanding answer — a later error emits no rejection', async () => {
    const { connection, sink, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    // The send throws (caught), so the push after sendMessage never runs — no phantom outstanding.
    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(rejections(sink)).toEqual([])
  })
})

describe('createDaemonConnection — set_session_settings rejection correlation (#269)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The sessionSettingsRejected events emitted so far, in order. */
  function settingsRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'sessionSettingsRejected')
  }
  /** The modalAnswerRejected events emitted so far — used to prove the modal FIFO is untouched (AC2). */
  function modalRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'modalAnswerRejected')
  }

  it('correlates a request-error by in_reply_to to its pending change and emits sessionSettingsRejected with the changeId (AC1/AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    // The daemon echoes the request envelope id as in_reply_to (pyrycode#845).
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'sessionSettingsRejected', changeId: 'change-1' }])
    // Exactly two keys — no sessionId / in_reply_to / code / message. Load-bearing regression pin.
    expect(Object.keys(events[0]).sort()).toEqual(['changeId', 'type'])
  })

  it('an error with an absent in_reply_to short-circuits before the map lookup, even with a change pending (fail-closed)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')

    // No in_reply_to at all → undefined short-circuits before the pendingSettings.get.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(settingsRejections(sink)).toEqual([])
  })

  it('an error whose in_reply_to matches no pending change falls through to the modal FIFO unchanged (AC3)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')

    // An error correlated to NO pending change (id 999) while a change is outstanding → no settings
    // rejection; falls through to reject the oldest modal answer exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(settingsRejections(sink)).toEqual([])
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('does not shift the modal FIFO when the error correlates to a pending change; the modal stays outstanding (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const settingsId = decodeEnvelope(drivers[0].sent[1]).id

    // A settings-correlated error: emit the rejection, DO NOT shift the modal FIFO.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(settingsId) })
    expect(settingsRejections(sink)).toEqual([
      { type: 'sessionSettingsRejected', changeId: 'change-1' }
    ])
    expect(modalRejections(sink)).toEqual([])

    // Proof the answer is still outstanding: a later uncorrelated error rejects it exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('a settings-correlated error does not fail a healthy in-flight bundle (precedence)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const settingsId = decodeEnvelope(drivers[0].sent[1]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(settingsId) })

    expect(settingsRejections(sink)).toEqual([
      { type: 'sessionSettingsRejected', changeId: 'change-1' }
    ])
    // A settings error is not a bundle error — the healthy bundle is NOT failed.
    expect(failed).toEqual([])
  })

  it('an error with no matching change still fails a pending bundle reassembler (AC3)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(failed).toEqual(['daemon-error'])
    expect(settingsRejections(sink)).toEqual([])
  })

  it('distinguishes two changes to the same session by changeId, rejects in either order (AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-x' }, 'change-1')
    connection.setSessionSettings({ session_id: 'sess-x' }, 'change-2')
    const id1 = decodeEnvelope(drivers[0].sent[0]).id
    const id2 = decodeEnvelope(drivers[0].sent[1]).id
    const before = emitted(sink).length

    // Rejections arrive REVERSED; each still carries the exact matching changeId.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id2) })
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id1) })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'sessionSettingsRejected', changeId: 'change-2' },
      { type: 'sessionSettingsRejected', changeId: 'change-1' }
    ])
  })

  it('drops the pending entry on a rejection — a second error for the same id emits no further rejection (AC5)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const id = decodeEnvelope(drivers[0].sent[0]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })
    const after = emitted(sink).length
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    expect(emitted(sink).slice(after)).toEqual([])
  })

  it('never echoes the daemon error content (message / code / in_reply_to) onto any emitted event (security no-echo)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const id = decodeEnvelope(drivers[0].sent[0]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    const serialized = JSON.stringify(emitted(sink))
    for (const dropped of [
      'secret error detail',
      'server.binary_offline',
      'in_reply_to',
      'inReplyTo'
    ]) {
      expect(serialized).not.toContain(dropped)
    }
  })

  it('clears the pending map on reconnect — an error for an abandoned change emits nothing (AC5 backstop)', async () => {
    const ctx = await connected()

    ctx.connection.setSessionSettings({ session_id: 'sess-2' }, 'change-1')
    const id = decodeEnvelope(ctx.drivers[0].sent[0]).id

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = emitted(ctx.sink).length

    // dial() abandoned the outstanding change; an error echoing the old id (ids recycle from 2)
    // correlates to nothing on the fresh connection.
    ctx.drivers[1].emit({ type: 'message', plaintext: errorPlaintext(id) })

    expect(emitted(ctx.sink).slice(before)).toEqual([])
  })
})

describe('createDaemonConnection — create_workspace_folder rejection correlation (#396)', () => {
  const PAYLOAD: CreateWorkspaceFolderPayload = { parent: '/home/user/projects', name: 'new-app' }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The workspaceFolderRejected events emitted so far, in order. */
  function folderRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'workspaceFolderRejected')
  }
  /** The modalAnswerRejected events emitted so far — used to prove the modal FIFO is untouched (AC4). */
  function modalRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'modalAnswerRejected')
  }

  it('correlates a request-error by in_reply_to to its pending create-folder and emits a bare workspaceFolderRejected (AC1/AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createWorkspaceFolder(PAYLOAD)
    // The daemon echoes the request envelope id as in_reply_to (pyrycode#887).
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'workspaceFolderRejected' }])
    // Exactly one key — no changeId / modalId / sessionId / in_reply_to / code / message. The event is
    // bare by construction (AC3). Load-bearing regression pin.
    expect(Object.keys(events[0])).toEqual(['type'])
  })

  it('drops the pending entry on a match — a second error for the same id emits no further rejection (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createWorkspaceFolder(PAYLOAD)
    const id = decodeEnvelope(drivers[0].sent[0]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })
    const after = emitted(sink).length
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    expect(emitted(sink).slice(after)).toEqual([])
  })

  it('an error with an absent in_reply_to short-circuits before the set lookup, even with a request pending (fail-closed AC3/AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createWorkspaceFolder(PAYLOAD)

    // No in_reply_to at all → undefined short-circuits before the pendingCreateFolders.has.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(folderRejections(sink)).toEqual([])
  })

  it('an error whose in_reply_to matches no pending request falls through to the modal FIFO unchanged (AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.createWorkspaceFolder(PAYLOAD)

    // An error correlated to NO pending create-folder (id 999) while a request is outstanding → no
    // folder rejection; falls through to reject the oldest modal answer exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(folderRejections(sink)).toEqual([])
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('does not shift the modal FIFO when the error correlates to a pending create-folder; the modal stays outstanding (AC4)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.createWorkspaceFolder(PAYLOAD)
    const folderId = decodeEnvelope(drivers[0].sent[1]).id

    // A create-folder-correlated error: emit the rejection, DO NOT shift the modal FIFO.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(folderId) })
    expect(folderRejections(sink)).toEqual([{ type: 'workspaceFolderRejected' }])
    expect(modalRejections(sink)).toEqual([])

    // Proof the answer is still outstanding: a later uncorrelated error rejects it exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('a create-folder-correlated error does not fail a healthy in-flight bundle (precedence AC4)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.createWorkspaceFolder(PAYLOAD)
    const folderId = decodeEnvelope(drivers[0].sent[1]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(folderId) })

    expect(folderRejections(sink)).toEqual([{ type: 'workspaceFolderRejected' }])
    // A create-folder error is not a bundle error — the healthy bundle is NOT failed.
    expect(failed).toEqual([])
  })

  it('an error with no matching request still fails a pending bundle reassembler (AC4)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.createWorkspaceFolder(PAYLOAD)

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(failed).toEqual(['daemon-error'])
    expect(folderRejections(sink)).toEqual([])
  })

  it('never echoes the daemon error content (message / code / in_reply_to) onto any emitted event (security no-echo AC3)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createWorkspaceFolder(PAYLOAD)
    const id = decodeEnvelope(drivers[0].sent[0]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    const serialized = JSON.stringify(emitted(sink))
    for (const dropped of [
      'secret error detail',
      'server.binary_offline',
      'in_reply_to',
      'inReplyTo'
    ]) {
      expect(serialized).not.toContain(dropped)
    }
  })

  it('clears the pending set on reconnect — an error for an abandoned request emits nothing (AC1 backstop)', async () => {
    const ctx = await connected()

    ctx.connection.createWorkspaceFolder(PAYLOAD)
    const id = decodeEnvelope(ctx.drivers[0].sent[0]).id

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = emitted(ctx.sink).length

    // dial() abandoned the outstanding request; an error echoing the old id (ids recycle from 2)
    // correlates to nothing on the fresh connection.
    ctx.drivers[1].emit({ type: 'message', plaintext: errorPlaintext(id) })

    expect(emitted(ctx.sink).slice(before)).toEqual([])
  })

  it('a request whose send throws records no pending entry — a later error emits no rejection (AC1)', async () => {
    const { connection, sink, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    // The send throws (caught), so the add after sendMessage never runs — no phantom pending entry. The
    // id the request would have used is 2 (the first app envelope), so an error echoing 2 must not match.
    connection.createWorkspaceFolder(PAYLOAD)
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(2) })

    expect(folderRejections(sink)).toEqual([])
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

describe('createDaemonConnection — dequeueMessage (dequeue_message request, ungated fire-and-forget, #300)', () => {
  const PAYLOAD: DequeueMessagePayload = { conversation_id: 'c1', queued_msg_id: 7 }

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

    expect(() => connection.dequeueMessage(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, sends exactly one dequeue_message envelope carrying the payload verbatim — no token, no nonce (AC5)', async () => {
    const { connection, drivers } = await connected()

    connection.dequeueMessage({ conversation_id: 'c1', queued_msg_id: 7 })

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('dequeue_message')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Exact toEqual: any answer-token or nonce would add a key and fail this match. Ungated → neither.
    expect(envelope.payload).toEqual({ conversation_id: 'c1', queued_msg_id: 7 })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.dequeueMessage(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in dequeueMessage must bound the wire to exactly the two fields.
    connection.dequeueMessage({
      conversation_id: 'c1',
      queued_msg_id: 7,
      answer_token: 'smuggled'
    } as unknown as DequeueMessagePayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual({ conversation_id: 'c1', queued_msg_id: 7 })
    expect(JSON.stringify(payload)).not.toContain('answer_token')
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.dequeueMessage(PAYLOAD)).not.toThrow()
  })
})

describe('createDaemonConnection — interrupt (bare interrupt control frame, fire-and-forget, #306)', () => {
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

    expect(() => connection.interrupt()).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one bare interrupt envelope with id 2 and the fixed ts', async () => {
    const { connection, drivers } = await connected()

    connection.interrupt()

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('interrupt')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Bare control frame: a present-but-empty payload — no token, no nonce, no selector (AC5, #305).
    expect(envelope.payload).toEqual({})
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.interrupt()

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.interrupt()).not.toThrow()
  })
})

describe('createDaemonConnection — requestSessionSettings (run-config request/reply, #491)', () => {
  const RUN_CONFIG = {
    session_id: 'sess-a',
    model: 'claude-opus-4-8',
    effort: 'high',
    yolo: true,
    used_tokens: 12480,
    window_tokens: 200000
  }

  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers } = build()
    expect(() => connection.requestSessionSettings()).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends a bare request_session_settings frame when connected', async () => {
    const { connection, drivers } = await connected()

    connection.requestSessionSettings()

    const sent = drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const request = sent.find((e) => e.type === 'request_session_settings')
    expect(request).toBeDefined()
    // Bare: no conversation id, no session id, no selector of any kind. The reply is daemon-wide.
    expect(request?.payload).toEqual({})
  })

  it('decodes an inbound session_settings into runConfigReceived with all six fields', async () => {
    const { sink, drivers } = await connected()

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG) })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([
      {
        type: 'runConfigReceived',
        sessionId: 'sess-a',
        model: 'claude-opus-4-8',
        effort: 'high',
        yolo: true,
        used_tokens: 12480,
        window_tokens: 200000
      }
    ])
  })

  it('carries an empty session_id through as "" (the cannot-address signal), never coerced', async () => {
    // '' is the daemon saying "I have no session to address". The sheet's gate must be able to see
    // it: coercing it to null here would make it indistinguishable from "no reply yet" and re-open
    // the inert-sheet defect one layer down (#491).
    const { sink, drivers } = await connected()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext({ ...RUN_CONFIG, session_id: '' })
    })

    const event = emitted(sink).find((e) => e.type === 'runConfigReceived')
    expect(event).toBeDefined()
    expect(event).toHaveProperty('sessionId', '')
  })

  it('emits nothing for a malformed session_settings (fail-closed, never a partial event)', async () => {
    const { sink, drivers } = await connected()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext({ ...RUN_CONFIG, window_tokens: undefined })
    })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([])
  })
})
