import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createDaemonConnection,
  type AttachmentRetrievalConsumer,
  type DaemonConnection,
  type DaemonConnectionDeps
} from './daemonConnection'
import type { AttachmentRetrievalFailure } from '../shared/ipc/attachmentRetrieval'
import type {
  DaemonEvent,
  StampedDaemonEvent,
  HistoryTimelineEntry,
  HistoryTimelineEvent
} from '../shared/ipc/events'
import type { DecodedHistoryEvent } from './transport/inboundMessage'
import type { DaemonEventSink } from './emitDaemonEvent'
import type { DeviceKeyPair, DeviceKeypairStore } from './deviceKeypair'
import type {
  MultiPairedServerStore,
  PairedServerRecord,
  PairedServerStore
} from './pairedServerStore'
import { MalformedPairedServerRecordError } from './pairedServerStore'
import { registerUnpairServerHandler } from './unpairHandler'
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
  attachmentStoredReplyFrames,
  attachmentRejectReplyFrames,
  type AttachmentRejectCode
} from './transport/fakeDaemon'
import type {
  AttachmentTransferFailure,
  AttachmentTransferResult
} from './transport/attachmentTransfer'
import {
  ATTACHMENT_CHUNK_DATA_BYTES,
  MAX_PLAINTEXT_BYTES,
  type AttachmentChunkPayload,
  type SendMessagePayload,
  type CreateConversationPayload,
  type CreateWorkspaceFolderPayload,
  type PromoteConversationPayload,
  type UnarchiveConversationPayload,
  type DeleteConversationPayload,
  type RenameConversationPayload,
  type ChangeWorkspacePayload,
  type RenameWorkspacePayload,
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

/**
 * The events this connection emitted, WITHOUT their server origin (#1068) — the `DaemonEvent[]` this
 * helper's signature has always promised. Every assertion in this file reads through it (directly, or
 * through the `rejections` / `modalRejections` / `folderRejections` filters), and none of them is
 * about the origin, so projecting the stamp away here keeps each one asserting the thing it was
 * written to assert instead of restating `serverId: null` eighty-odd times.
 *
 * The field itself is not left uncovered: `stampedEvents` below exposes the raw channel payloads and
 * the "#1068 — server origin" block asserts on those.
 */
function emitted(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
  return stampedEvents(sink).map(({ serverId: _origin, ...event }) => event as DaemonEvent)
}

/** The raw channel payloads, stamp included — what the window actually receives. */
function stampedEvents(sink: ReturnType<typeof fakeSink>): StampedDaemonEvent[] {
  return sink.webContents.send.mock.calls.map((call) => call[1] as StampedDaemonEvent)
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
    timing?: DaemonConnectionDeps['timing']
    serverId?: string | null
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
    // The server-origin binding (#1068). Defaults to null — what the composition root passes today —
    // so every pre-existing test keeps emitting exactly the events it always did, plus a null stamp
    // that `emitted()` below projects away. The origin tests override it.
    serverId: overrides.serverId ?? null,
    deviceName: 'my-desktop',
    clientVersion: '0.1.0',
    now: () => FIXED_TS,
    createDriver: factory.createDriver,
    diagnosticLog: overrides.diagnosticLog,
    // The retrieval idle-deadline seam (#996). Left undefined by default so every pre-existing test
    // keeps the real setTimeout; the retrieval block injects a fake scheduler.
    timing: overrides.timing,
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

/**
 * A `session_settings` plaintext, wrapping an arbitrary payload (#491).
 *
 * `inReplyTo` is REQUIRED since #1176, and passing it is no longer decoration: the reply is
 * correlation-gated, so a frame naming an envelope id this client never sent draws no event at all.
 * Callers reach it through `requested()` below, which sends a real request and hands back its id, so
 * a test cannot accidentally pin the gate open with a literal. Spelled `number | undefined` rather
 * than optional so OMITTING it is a deliberate `undefined` at the call site — that is the
 * no-in_reply_to reject branch, and it should read as a choice.
 */
function sessionSettingsPlaintext(payload: unknown, inReplyTo: number | undefined): Uint8Array {
  return encodeEnvelope({
    id: 45,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
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

/** A `model_announced` plaintext, wrapping an arbitrary payload (#587). */
function modelAnnouncedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'model_announced', ts: FIXED_TS, payload })
}

/** A `background_task_started` plaintext, wrapping an arbitrary payload (#564). */
function backgroundTaskStartedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'background_task_started', ts: FIXED_TS, payload })
}

/** A `background_task_updated` plaintext, wrapping an arbitrary payload (#565). */
function backgroundTaskUpdatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'background_task_updated', ts: FIXED_TS, payload })
}

/** A `background_task_roster` plaintext, wrapping an arbitrary payload (#566). */
function backgroundTaskRosterPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'background_task_roster', ts: FIXED_TS, payload })
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

/** A `question_shown` plaintext, wrapping an arbitrary payload (#885). */
function questionShownPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'question_shown', ts: FIXED_TS, payload })
}

/** A `question_dismissed` plaintext, wrapping an arbitrary payload (#895). */
function questionDismissedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'question_dismissed', ts: FIXED_TS, payload })
}

/** A `slash_command_list` plaintext, wrapping an arbitrary payload (#937). */
function slashCommandListPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'slash_command_list', ts: FIXED_TS, payload })
}

/** A `model_list` plaintext, wrapping an arbitrary payload (#973). */
function modelListPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'model_list', ts: FIXED_TS, payload })
}

/** A `conversation_created` plaintext, wrapping an arbitrary payload (#241). */
function conversationCreatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'conversation_created', ts: FIXED_TS, payload })
}

/** A `workspace_folder_created` plaintext, wrapping an arbitrary payload (#381). */
function workspaceFolderCreatedPlaintext(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 3, type: 'workspace_folder_created', ts: FIXED_TS, payload })
}

/** A `workspace_updated` plaintext, wrapping an arbitrary payload (#1288). Takes an optional
 *  `in_reply_to` — the daemon correlates this frame to whoever asked for the rename and pushes it
 *  unsolicited to everyone else, so both shapes must reach the same emit. */
function workspaceUpdatedPlaintext(payload: unknown, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 3,
    type: 'workspace_updated',
    ts: FIXED_TS,
    ...(inReplyTo === undefined ? {} : { in_reply_to: inReplyTo }),
    payload
  })
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
   * Pull the registered invoke listener out of a fake ipcMain — the unpairHandler.test
   * `serverListenerOf` idiom. The composition root's wiring (index.ts) has no test of its own, so this
   * test composes those two lines itself: driving `connection.reconnect()` directly would pass on
   * `main` unchanged (reconnect already fences) and prove nothing — the fix IS the wiring.
   *
   * #1163 pointed it at the PER-SERVER handler, the only unpair the app registers now that the
   * whole-collection one is deleted. The property under test is untouched by that move: both arms
   * wired the same value-free `onUnpaired` after a successful erase, so an authenticated session still
   * cannot outlive the record that authorised it. The listener now takes a request, so it is driven as
   * `(event, { serverId })` and the returned closure supplies the id.
   */
  function unpairListenerFor(
    deps: Parameters<typeof registerUnpairServerHandler>[1]
  ): () => Promise<unknown> {
    const handle = vi.fn()
    registerUnpairServerHandler({ handle, removeHandler: vi.fn() }, deps)
    const listener = handle.mock.calls[0][1]
    return () => listener(undefined, { serverId: RECORD.server })
  }

  /**
   * A connection and a clearable store over ONE mutable record — the real pair modelled with no new
   * helper: clear() erases it, and the connection's read-through `load` sees null on the next dial.
   * `repair()` puts it back, standing in for a later pairing confirm.
   */
  function unpairable(): {
    ctx: ReturnType<typeof build>
    store: Pick<MultiPairedServerStore, 'clearServer'>
    repair: () => void
  } {
    let record: PairedServerRecord | null = RECORD
    return {
      ctx: build({ load: () => Promise.resolve(record) }),
      // The narrow handle the per-server handler is typed against, over ONE mutable record: an id
      // matching it erases it and reports `matched`, so the connection's read-through `load` sees null
      // on the next dial. `remaining: 0` — this fixture holds one record, and nothing here reads it.
      store: {
        clearServer: async (serverId: string) => {
          if (serverId !== RECORD.server) return { matched: false, remaining: record === null ? 0 : 1 }
          record = null
          return { matched: true, remaining: 0 }
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
    expect(await listener()).toEqual({ result: 'ok' })
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

    await unpairListenerFor({ store, onUnpaired: () => ctx.connection.reconnect() })()
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

describe('createDaemonConnection — an inbound screen_snapshot reaches no renderer event (#622)', () => {
  const SNAPSHOT = {
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

  it('emits NOTHING for a WELL-FORMED screen_snapshot — unmodeled, then dropped', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // The frame that used to emit two events now emits none: the run-config half moved to the
    // dedicated session_settings reply (#491/#500) and the rendered-screen half lost its display
    // slice (#619). #622 then unmodeled the type outright, so `parseInboundMessage` returns null and
    // the connection has nothing to drop. Asserted as a call COUNT (the malformed-frame idiom below),
    // which pins "no event at all" rather than "not these two" — the only coverage that a
    // screen_snapshot arriving at the REAL connection produces no renderer event.
    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: snapshotPlaintext(SNAPSHOT) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops a malformed screen_snapshot without emitting or throwing (unmodeled, never inspected)', async () => {
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

  it('decodes an inbound assistant_delta into one camelCase assistantDelta, conversation id and all', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: assistantDeltaPlaintext(DELTA) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      { type: 'assistantDelta', turnId: 'turn-1', seq: 3, text: 'a reply slice', conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
    // The frame's conversation_id rides the arm as the routing key (#751): it must reach the renderer
    // verbatim, never dropped and never defaulted to a placeholder.
    expect(JSON.stringify(events)).toContain('conv-1')
  })

  it('carries seq:0 and empty text through as those values, not dropped/defaulted', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: assistantDeltaPlaintext({ ...DELTA, seq: 0, text: '' })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'assistantDelta', turnId: 'turn-1', seq: 0, text: '', conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
  })

  it('decodes an inbound turn_end into one camelCase turnEnd, conversation id and all', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: turnEndPlaintext(TURN_END) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      { type: 'turnEnd', turnId: 'turn-1', stopReason: 'end_turn', conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
    // The frame's conversation_id rides the arm as the routing key (#752): it must reach the renderer
    // verbatim, never dropped and never defaulted to a placeholder.
    expect(JSON.stringify(events)).toContain('conv-1')
  })

  it('drops a malformed assistant_delta without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: assistantDeltaPlaintext({ ...DELTA, seq: 'x' }) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops an assistant_delta whose conversation_id is missing or non-string (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // Absent: the envelope encoding drops an undefined property, so this IS the missing case.
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: assistantDeltaPlaintext({ ...DELTA, conversation_id: undefined })
      })
    ).not.toThrow()
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: assistantDeltaPlaintext({ ...DELTA, conversation_id: 42 })
      })
    ).not.toThrow()
    // Nothing crosses at all — never under a placeholder id and never under an empty one. The decode
    // requires the field, and the emit reads it bare so it cannot paper over the absence with `?? ''`.
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('drops a turn_end whose conversation_id is missing or non-string (fail-closed)', async () => {
    // A GUARD, not a fix: parseTurnEndPayload already requires `conversation_id`, so this holds on the
    // tree before #752 too. What it pins is the BARE read at the emit — a later `?? ''` there would turn
    // this fail-closed drop into a silent misattribution, and nothing else in the suite would notice.
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // Absent: the envelope encoding is JSON.stringify, which drops an undefined property, so this IS
    // the missing case rather than a present-but-undefined one.
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: turnEndPlaintext({ ...TURN_END, conversation_id: undefined })
      })
    ).not.toThrow()
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: turnEndPlaintext({ ...TURN_END, conversation_id: 42 })
      })
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

  it('decodes an inbound turn_state into one turnState carrying state + conversationId', async () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const { sink, drivers } = await connected()
      const before = emitted(sink).length

      drivers[0].emit({
        type: 'message',
        plaintext: turnStatePlaintext({ conversation_id: 'conv-1', state })
      })

      const events = emitted(sink).slice(before)
      expect(events).toEqual([{ type: 'turnState', state, conversationId: 'conv-1', daemonTs: FIXED_TS }])
      // conversation_id now CROSSES the choke point (#724) — it is the routing key the sidebar's
      // per-conversation phase needs (#674). Copied by name at the emit, so this is the verbatim value.
      expect(JSON.stringify(events)).toContain('conv-1')
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

  it('decodes an inbound stall into exactly one stallDetected carrying the conversation id', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: stallPlaintext({ conversation_id: 'conv-1' })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'stallDetected', conversationId: 'conv-1', daemonTs: FIXED_TS }])
    // #732: the frame's conversation_id reaches the emitted event VERBATIM — the routing key #674
    // attributes a stall by. The toEqual above also pins the arm to exactly these two fields, so a
    // spread of the decoded payload would fail it.
    expect(JSON.stringify(events)).toContain('conv-1')
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

  it('decodes a rising-edge api_retry into exactly one apiRetry event, conversation id carried', async () => {
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
    expect(events).toEqual([
      { type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
    // The frame's conversation_id reaches the emitted event VERBATIM (#737): per-conversation retry is
    // daemon state, so the sidebar can say a chat is stuck retrying while the operator looks at another
    // one (#674). The deliberate inverse of this arm's own pre-#737 leak guard.
    expect(JSON.stringify(events)).toContain('conv-1')
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
      { type: 'apiRetry', active: true, current: 0, total: 0, conversationId: 'conv-1', daemonTs: FIXED_TS }
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
      { type: 'apiRetry', active: false, current: 4, total: 10, conversationId: 'conv-1', daemonTs: FIXED_TS }
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
      { type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-1', daemonTs: FIXED_TS },
      { type: 'apiRetry', active: true, current: 4, total: 10, conversationId: 'conv-1', daemonTs: FIXED_TS },
      { type: 'apiRetry', active: true, current: 4, total: 10, conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
  })

  it('emits exactly the six modeled properties, never a spread of the decoded payload', async () => {
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
    expect(Object.keys(events[0]).sort()).toEqual([
      'active',
      'conversationId',
      'current',
      'daemonTs',
      'total',
      'type'
    ])
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

  it('decodes a rising-edge compacting into exactly one compacting event (conversation_id carried)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: true })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'compacting', active: true, conversationId: 'conv-1', daemonTs: FIXED_TS }])
    // The frame's conversation_id reaches the emitted event VERBATIM (#742) — the routing key #674
    // keys by. The inverse of this assertion held while the arm dropped it; it is inverted, not
    // deleted, so the leak guard keeps watching the same string.
    expect(JSON.stringify(events)).toContain('conv-1')
  })

  it('emits the falling edge with active false — the explicit clear, not a derived one', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: compactingPlaintext({ conversation_id: 'conv-1', active: false })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'compacting', active: false, conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
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
      { type: 'compacting', active: true, conversationId: 'conv-1', daemonTs: FIXED_TS },
      { type: 'compacting', active: true, conversationId: 'conv-1', daemonTs: FIXED_TS }
    ])
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
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
    expect(Object.keys(events[0]).sort()).toEqual(['active', 'conversationId', 'daemonTs', 'type'])
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

describe('createDaemonConnection — model_announced stream (#587)', () => {
  /** The daemon's canonical fixture (testdata/model_announced.json). */
  const ANNOUNCED = {
    conversation_id: 'conv-1',
    model: 'claude-haiku-4-5-20251001',
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

  it('decodes a model_announced into exactly one modelAnnounced event (conversation_id carried)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: modelAnnouncedPlaintext(ANNOUNCED) })

    const events = emitted(sink).slice(before)
    // A strict toEqual on the whole event, asserted POSITIVELY rather than by absence of a substring:
    // the arm has exactly `type` / `model` / `truncated` / `conversationId`.
    expect(events).toEqual([
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      }
    ])
    // The frame's conversation_id reaches the emitted event VERBATIM (#714) — the routing key #674
    // keys by. The inverse of this assertion held while the arm dropped it; it is inverted, not
    // deleted, so the leak guard keeps watching the same string.
    expect(JSON.stringify(events)).toContain('conv-1')
  })

  it('carries the identifier to the sink BYTE-FOR-BYTE — no re-casing introduced at the emit', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modelAnnouncedPlaintext({ ...ANNOUNCED, model: 'Claude-Opus-5_TEST.20260819' })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'modelAnnounced',
        model: 'Claude-Opus-5_TEST.20260819',
        truncated: false,
        conversationId: 'conv-1'
      }
    ])
  })

  it('carries truncated true to the sink — the cut report crosses IPC with the value', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modelAnnouncedPlaintext({ ...ANNOUNCED, truncated: true })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: true,
        conversationId: 'conv-1'
      }
    ])
  })

  it('does NOT dedup: two identical announcements each emit their own event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    for (let i = 0; i < 2; i++) {
      drivers[0].emit({ type: 'message', plaintext: modelAnnouncedPlaintext(ANNOUNCED) })
    }

    // Two frames, two events, in wire order — no coalescing, no last-value memo. This pins the "no
    // dedup" contract against a future optimiser adding state to this leg: a re-announcement is what
    // tells a consumer the value is still current.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      },
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      }
    ])
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modelAnnouncedPlaintext({ ...ANNOUNCED, smuggled: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual(['conversationId', 'model', 'truncated', 'type'])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed model_announced without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: modelAnnouncedPlaintext({ ...ANNOUNCED, truncated: 'true' })
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
    // Daemon state keyed by id, not a turn-stream item, so the id crosses: #567 attributes tasks by id,
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

describe('createDaemonConnection — background_task_updated stream (#565)', () => {
  /** The daemon's canonical fixture — four distinct, non-empty values, `patch` cut mid-token by the
   *  daemon and therefore NOT valid JSON (#565). */
  const UPDATED = {
    conversation_id: 'conv-1',
    task_id: 'task_01ABC',
    patch: '{"is_backgrounded":tr',
    truncated_fields: ['patch']
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('emits exactly one backgroundTaskUpdated carrying all four fields, conversationId KEPT', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskUpdatedPlaintext(UPDATED) })

    // A whole-object assertion, which is what makes a swapped or dropped field fail (AC1) — and what
    // catches a `description` / `taskType` left over from cloning the sibling, since an extra emitted
    // property fails toEqual.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        patch: '{"is_backgrounded":tr',
        truncatedFields: ['patch']
      }
    ])
  })

  it('KEEPS conversation_id — daemon state keyed by id, not a turn-stream item (the queueState rule)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskUpdatedPlaintext(UPDATED) })

    const events = emitted(sink).slice(before) as Array<{ conversationId?: string }>
    // Daemon state keyed by id, not a turn-stream item, so the id crosses: #567 attributes tasks by id,
    // the same model queue_state already uses, so dropping it here would make that slice unbuildable.
    expect(events[0].conversationId).toBe('conv-1')
  })

  it('crosses IPC with an invalid-JSON patch byte-for-byte — nothing parses or normalizes it', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length
    const patch = '{"is_backgrounded":true,"note":"a<b&c \'quoted\' > /tmp/out'

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskUpdatedPlaintext({ ...UPDATED, patch })
    })

    const events = emitted(sink).slice(before) as Array<{ patch?: string }>
    expect(() => JSON.parse(patch)).toThrow()
    expect(events[0].patch).toBe(patch)
  })

  it('carries an EMPTY patch across as "" — claude sent no change, never a missing field', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskUpdatedPlaintext({ ...UPDATED, patch: '' })
    })

    const events = emitted(sink).slice(before) as Array<{ patch?: unknown }>
    expect(events[0].patch).toBe('')
  })

  it('round-trips truncatedFields null as null — never coerced to an empty list', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskUpdatedPlaintext({ ...UPDATED, truncated_fields: null })
    })

    const events = emitted(sink).slice(before) as Array<{ truncatedFields?: unknown }>
    expect(events[0].truncatedFields).toBeNull()
  })

  it('round-trips a populated truncatedFields element-for-element, in order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskUpdatedPlaintext({
        ...UPDATED,
        truncated_fields: ['task_id', 'patch']
      })
    })

    const events = emitted(sink).slice(before) as Array<{ truncatedFields?: unknown }>
    expect(events[0].truncatedFields).toEqual(['task_id', 'patch'])
  })

  it('emits exactly the five modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskUpdatedPlaintext({ ...UPDATED, smuggled: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'patch',
      'taskId',
      'truncatedFields',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('holds no correlation memory and performs NO join: an update for a never-opened task still emits', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // No `background_task_started` has been seen on this connection for ANY of these ids. Ordering is
    // claude's, not the daemon's, so an update for a task this client never saw opened is a legal,
    // expected frame — never an error and never something to buffer until the `started` shows up.
    for (const task_id of ['task_never_opened', 'task_02DEF', 'task_02DEF']) {
      drivers[0].emit({
        type: 'message',
        plaintext: backgroundTaskUpdatedPlaintext({ ...UPDATED, task_id })
      })
    }

    // Three frames, three events, in arrival order — the transport holds no task map (that is #567's).
    const events = emitted(sink).slice(before) as Array<{ taskId?: string }>
    expect(events.map((e) => e.taskId)).toEqual(['task_never_opened', 'task_02DEF', 'task_02DEF'])
  })

  it('drops a malformed background_task_updated without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length
    const missingKey: Record<string, unknown> = { ...UPDATED }
    delete missingKey.truncated_fields

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: backgroundTaskUpdatedPlaintext(missingKey)
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — background_task_roster stream (#566)', () => {
  /** The daemon's canonical fixture — two rows whose `truncated_fields` shapes DIFFER, every field on
   *  every row a distinct value, and a non-zero dropped_tasks (#566). */
  const ROSTER = {
    conversation_id: 'conv-1',
    tasks: [
      {
        task_id: 'task_01ABC',
        task_type: 'local_bash',
        description: "grep -rn 'a<b&c' .",
        truncated_fields: ['description']
      },
      {
        task_id: 'task_02DEF',
        task_type: 'local_bash',
        description: 'sleep 300',
        truncated_fields: null
      }
    ],
    dropped_tasks: 3
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('emits exactly one backgroundTaskRoster carrying all three fields, conversationId KEPT', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskRosterPlaintext(ROSTER) })

    // A whole-object assertion over BOTH rows, which is what makes a swapped or dropped field fail
    // (AC1) — and what catches a `toolCallId` / `patch` left over from cloning a scalar sibling's row,
    // since an extra emitted property fails toEqual.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'backgroundTaskRoster',
        conversationId: 'conv-1',
        tasks: [
          {
            task_id: 'task_01ABC',
            task_type: 'local_bash',
            description: "grep -rn 'a<b&c' .",
            truncated_fields: ['description']
          },
          {
            task_id: 'task_02DEF',
            task_type: 'local_bash',
            description: 'sleep 300',
            truncated_fields: null
          }
        ],
        droppedTasks: 3
      }
    ])
  })

  it('KEEPS conversation_id — daemon state keyed by id, not a turn-stream item (the queueState rule)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskRosterPlaintext(ROSTER) })

    const events = emitted(sink).slice(before) as Array<{ conversationId?: string }>
    // Daemon state keyed by id, not a turn-stream item, so the id crosses: #567 attributes tasks by id,
    // the same model queue_state already uses, so dropping it here would make that slice unbuildable.
    expect(events[0].conversationId).toBe('conv-1')
  })

  it('crosses the rows snake_case and by reference — no snake→camel on the row (the queueState rule)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskRosterPlaintext(ROSTER) })

    // The row type is REUSED verbatim from the wire (the queued / conversationsReceived precedent):
    // the row narrower already stripped each row to its known fields, so there is nothing to drop and
    // no mapping to write. A camel-cased row fails this.
    const events = emitted(sink).slice(before) as Array<{ tasks?: Array<Record<string, unknown>> }>
    expect(events[0].tasks?.[0].task_id).toBe('task_01ABC')
    expect(events[0].tasks?.[0].task_type).toBe('local_bash')
    expect(Object.keys(events[0].tasks?.[0] ?? {}).sort()).toEqual([
      'description',
      'task_id',
      'task_type',
      'truncated_fields'
    ])
  })

  it('round-trips each row truncated_fields per row — populated and null in the SAME event', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: backgroundTaskRosterPlaintext(ROSTER) })

    // The anti-flattening pin at the IPC layer: row 1's list element-for-element, row 2's null
    // preserved — never hoisted into one merged list and never coerced to [].
    const events = emitted(sink).slice(before) as Array<{ tasks?: Array<Record<string, unknown>> }>
    expect(events[0].tasks?.[0].truncated_fields).toEqual(['description'])
    expect(events[0].tasks?.[1].truncated_fields).toBeNull()
  })

  it('emits an EMPTY roster as tasks: [] — the positive "nothing is alive" signal (AC2)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskRosterPlaintext({
        conversation_id: 'conv-1',
        tasks: [],
        dropped_tasks: 0
      })
    })

    // Emitted, never dropped / filtered / coalesced. `droppedTasks` crosses as the VALUE 0 (AC3).
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'backgroundTaskRoster', conversationId: 'conv-1', tasks: [], droppedTasks: 0 }
    ])
    const events = emitted(sink).slice(before) as Array<{ droppedTasks?: unknown }>
    expect(events[0].droppedTasks).toBe(0)
  })

  it('distinguishes "roster observed, nothing alive" from "no roster observed" (AC2)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // No frame arrives: zero events. Asserting the empty array against an empty baseline alone would
    // be vacuous, which is what this half of the pair fixes.
    expect(emitted(sink).slice(before)).toEqual([])

    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskRosterPlaintext({
        conversation_id: 'conv-1',
        tasks: [],
        dropped_tasks: 0
      })
    })

    const events = emitted(sink).slice(before) as Array<{ type?: string; tasks?: unknown }>
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('backgroundTaskRoster')
    expect(events[0].tasks).toEqual([])
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // Anti-smuggling at BOTH levels: an extra top-level key and an extra key on the first row.
    drivers[0].emit({
      type: 'message',
      plaintext: backgroundTaskRosterPlaintext({
        ...ROSTER,
        smuggled: 'must-not-cross',
        tasks: [{ ...ROSTER.tasks[0], smuggled_row: 'must-not-cross-either' }]
      })
    })

    const events = emitted(sink).slice(before) as Array<{ tasks?: Array<Record<string, unknown>> }>
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'droppedTasks',
      'tasks',
      'type'
    ])
    expect(Object.keys(events[0].tasks?.[0] ?? {}).sort()).toEqual([
      'description',
      'task_id',
      'task_type',
      'truncated_fields'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('holds no state, no dedup and NO DIFF: repeats emit, and an empty roster after a full one emits', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // A roster listing a task_id NEVER opened by a background_task_started on this connection, the
    // same frame verbatim twice, and then an EMPTY roster following a non-empty one. Ordering is
    // claude's, so a roster can arrive before the `started` for a task it lists; and this layer holds
    // no previous roster, so it draws no "finished" inference from a task's disappearance (#567's
    // call, on its own terms).
    for (const payload of [
      { ...ROSTER, tasks: [{ ...ROSTER.tasks[0], task_id: 'task_never_opened' }] },
      ROSTER,
      ROSTER,
      { conversation_id: 'conv-1', tasks: [], dropped_tasks: 0 }
    ]) {
      drivers[0].emit({ type: 'message', plaintext: backgroundTaskRosterPlaintext(payload) })
    }

    // Four frames, four events, in arrival order — the last one an empty roster that is emitted
    // normally rather than suppressed or diffed against its predecessor.
    const events = emitted(sink).slice(before) as Array<{ tasks?: Array<{ task_id: string }> }>
    expect(events.map((e) => e.tasks?.map((t) => t.task_id))).toEqual([
      ['task_never_opened'],
      ['task_01ABC', 'task_02DEF'],
      ['task_01ABC', 'task_02DEF'],
      []
    ])
  })

  it('drops a malformed background_task_roster without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        // `tasks: null` — the trap case: valid for a ROW's truncated_fields, never for `tasks`.
        plaintext: backgroundTaskRosterPlaintext({ ...ROSTER, tasks: null })
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

  it('emits an unrecognizedMessage carrying the four display fields plus conversationId', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: unrecognizedPlaintext(UNRECOGNIZED) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      {
        type: 'unrecognizedMessage',
        conversationId: 'conv-1',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event","detail":"something new"}',
        truncated: false,
        daemonTs: FIXED_TS
      }
    ])
    // conversation_id crosses as the routing key (#784), read BARE off the already-validated payload.
    expect(JSON.stringify(events)).toContain('conv-1')
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
        conversationId: 'conv-1',
        site: 'undecodable',
        messageType: '',
        raw: '{"type":"assist',
        truncated: false,
        daemonTs: FIXED_TS
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

  it('emits exactly the six modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: unrecognizedPlaintext({ ...UNRECOGNIZED, smuggled: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'daemonTs',
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
    conversation_id: 'conv-1',
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

  it('decodes an inbound session_transition, carrying conversationId / newSessionId / reason / occurredAt / workspaceCwd', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: sessionTransitionPlaintext(SESSION_TRANSITION) })

    // The /clear fixture's null workspace_cwd is carried as `null`, not coerced to '' (AC2).
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'sessionTransition',
        conversationId: 'conv-1',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null,
        daemonTs: FIXED_TS
      }
    ])
  })

  it('#1192: forwards a marker naming ANY conversation — main routes, the window decides what to hold', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // No gate here, deliberately. The correlation index learns `newSessionId → serverId` off this same
    // event, so dropping an unattributed-to-the-open-chat marker in the background process would blind
    // it and reintroduce the refuses-with-no-frame bug that index was written for. The attribution gate
    // is the renderer's (`subscribeSessionId`), and it is the only one.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionTransitionPlaintext({
        ...SESSION_TRANSITION,
        conversation_id: 'chat-elsewhere'
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'sessionTransition',
        conversationId: 'chat-elsewhere',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null,
        daemonTs: FIXED_TS
      }
    ])
  })

  it('#1192: a marker with no conversation_id emits nothing, throws nothing, and leaves the connection up', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    const { conversation_id: _dropped, ...unattributed } = SESSION_TRANSITION
    expect(() =>
      drivers[0].emit({ type: 'message', plaintext: sessionTransitionPlaintext(unattributed) })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)

    // The connection survives the drop — one bad frame costs its own marker and nothing else. Proven
    // the way this suite proves liveness elsewhere: no teardown event went out, and a well-formed
    // frame arriving BEHIND the bad one still crosses.
    const after = emitted(sink).slice(before)
    expect(after.some((e) => e.type === 'disconnected')).toBe(false)
    drivers[0].emit({ type: 'message', plaintext: sessionTransitionPlaintext(SESSION_TRANSITION) })
    expect(emitted(sink).at(-1)).toMatchObject({
      type: 'sessionTransition',
      conversationId: 'conv-1'
    })
  })

  it('carries reason / occurredAt / workspaceCwd; drops only previous_session_id at the emit (content-drop narrowed to the one field with no consumer)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // A workspace_change frame carries a non-null workspace_cwd; it now crosses IPC by design (#286).
    drivers[0].emit({
      type: 'message',
      plaintext: sessionTransitionPlaintext({
        conversation_id: 'conv-1',
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
        conversationId: 'conv-1',
        newSessionId: 'sess-new',
        reason: 'workspace_change',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: '/home/user/secret-workspace',
        daemonTs: FIXED_TS
      }
    ])
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'daemonTs',
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

  it('decodes an inbound tool_use into one camelCase toolUse, conversation id and all', async () => {
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
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts',
        daemonTs: FIXED_TS
      }
    ])
    // The frame's conversation_id rides the arm as the routing key (#763): it must reach the renderer
    // verbatim, never dropped and never defaulted to a placeholder.
    expect(JSON.stringify(events)).toContain('conv-1')
  })

  it('carries the tool input map across to the renderer with its entries unchanged (#642)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolUsePlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        name: 'Read',
        input_summary: 'reads /etc/hosts',
        input: { file_path: '/etc/hosts', limit: '20' }
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts',
        input: { file_path: '/etc/hosts', limit: '20' },
        daemonTs: FIXED_TS
      }
    ])
  })

  it('emits an ABSENT input when the wire omitted it — the pre-#1678 daemon (#642)', async () => {
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
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts',
        daemonTs: FIXED_TS
      }
    ])
    // The deterministic reading of "absent": the emit assigns unconditionally, so the property
    // exists holding `undefined` — which JSON.stringify omits. The consumer contract is
    // `event.input === undefined`, never `'input' in event`. (`"inputSummary"` does not match.)
    expect(JSON.stringify(events)).not.toContain('"input"')
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

  it('decodes an inbound tool_result into one camelCase toolResult, conversation id and all', async () => {
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
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines',
        daemonTs: FIXED_TS
      }
    ])
    // The frame's conversation_id rides the arm as the routing key (#766): it must reach the renderer
    // verbatim, never dropped and never defaulted to a placeholder.
    expect(JSON.stringify(events)).toContain('conv-1')
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
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: true,
        resultSummary: 'permission denied',
        daemonTs: FIXED_TS
      }
    ])
  })

  it('carries result_detail across IPC verbatim, unit words and interior spaces intact (#773)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolResultPlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        is_error: false,
        result_summary: 'read 12 lines',
        result_detail: '110 of 1676 lines'
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'toolResult',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines',
        resultDetail: '110 of 1676 lines',
        daemonTs: FIXED_TS
      }
    ])
  })

  it('carries an EMPTY result_detail across as "", never collapsed into absent (#773)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolResultPlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        is_error: false,
        result_summary: 'ok',
        result_detail: ''
      })
    })

    const [event] = emitted(sink).slice(before)
    expect(event).toMatchObject({ type: 'toolResult', resultDetail: '' })
  })

  it('emits an absent resultDetail when the wire omitted the key (a pre-#2024 daemon, #773)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: toolResultPlaintext({
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        tool_use_id: 'tu-1',
        is_error: false,
        result_summary: 'ok'
      })
    })

    const [event] = emitted(sink).slice(before)
    expect(event?.type).toBe('toolResult')
    // Structured clone carries the key with an `undefined` VALUE across `webContents.send`, so the
    // contract is `=== undefined` — never `'resultDetail' in event`, which is true either way.
    expect(event?.type === 'toolResult' ? event.resultDetail : 'unreachable').toBeUndefined()
  })

  it('drops a tool_result whose result_detail is a non-string, without emitting (#773)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: toolResultPlaintext({
          conversation_id: 'conv-1',
          turn_id: 'turn-1',
          tool_use_id: 'tu-1',
          is_error: false,
          result_summary: 'ok',
          result_detail: 265 // a number, not the formatted string → fail closed
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
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

  it('emits seven camelCase fields including the conversation id, options in order (#871)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modalShownPlaintext({
        conversation_id: 'conv-7f3a',
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
        conversationId: 'conv-7f3a',
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
          // Present so this stays a test of the `class` enum, not of the missing-field path (#870).
          conversation_id: 'conv-7f3a',
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

  it('emits exactly the seven modeled properties, never a spread of the decoded payload (#871)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: modalShownPlaintext({
        conversation_id: 'conv-7f3a',
        modal_id: 'mdl-7f3a',
        class: 'permission',
        title: 'Allow Bash?',
        prompt: 'claude wants to run: rm -rf build/',
        options: [{ id: 'allow', label: 'Allow' }],
        default_option_id: 'allow',
        smuggled: 'must-not-cross'
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'class',
      'conversationId',
      'defaultOptionId',
      'modalId',
      'options',
      'prompt',
      'title',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
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
    last_used_at: '2026-07-09T00:00:00Z',
    workspace_label: null
  }
  const CONV_UNNAMED = {
    id: 'conv-2',
    name: null,
    is_promoted: false,
    is_archived: true,
    cwd: '/tmp/scratch',
    last_message_ts: '2026-07-07T00:00:00Z',
    last_used_at: '2026-07-07T12:00:00Z',
    workspace_label: null
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
    last_used_at: '2026-07-10T00:00:00Z',
    workspace_label: null
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

describe('createDaemonConnection — create_conversation rejection correlation (#1307)', () => {
  const PAYLOAD: CreateConversationPayload = {
    is_promoted: null,
    name: null,
    cwd: '/home/user/projects/new-app'
  }
  const CREATED = {
    id: 'conv-9',
    is_promoted: false,
    cwd: '/home/user/projects/new-app',
    name: null,
    last_used_at: '2026-07-10T00:00:00Z',
    workspace_label: null
  }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The conversationCreateRejected events emitted so far, in order. */
  function createRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'conversationCreateRejected')
  }
  /** The modalAnswerRejected events emitted so far — used to prove the modal FIFO is untouched. */
  function modalRejections(sink: ReturnType<typeof fakeSink>): DaemonEvent[] {
    return emitted(sink).filter((e) => e.type === 'modalAnswerRejected')
  }

  it('correlates a request-error by in_reply_to to its pending create and emits a bare conversationCreateRejected (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createConversation(PAYLOAD)
    // The daemon echoes the request envelope id as in_reply_to (pyrycode#887).
    const id = decodeEnvelope(drivers[0].sent[0]).id
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([{ type: 'conversationCreateRejected' }])
    // Exactly one key — no changeId / modalId / sessionId / in_reply_to / code / message. The event is
    // bare by construction (AC3), the workspaceFolderRejected / sessionSettingsRejected pin.
    expect(Object.keys(events[0])).toEqual(['type'])
  })

  it('drops the pending entry on a match — a second error for the same id emits no further rejection (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createConversation(PAYLOAD)
    const id = decodeEnvelope(drivers[0].sent[0]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })
    const after = emitted(sink).length
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(id) })

    expect(emitted(sink).slice(after)).toEqual([])
  })

  it('an error with an absent in_reply_to short-circuits before the set lookup, even with a create pending (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createConversation(PAYLOAD)

    // No in_reply_to at all → undefined short-circuits before the pendingCreateConversations.has.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(createRejections(sink)).toEqual([])
  })

  it('an error whose in_reply_to matches no pending create falls through to the modal FIFO unchanged (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.createConversation(PAYLOAD)

    // An error correlated to NO pending create (id 999) while a request is outstanding → no create
    // rejection; falls through to reject the oldest modal answer exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(createRejections(sink)).toEqual([])
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('does not shift the modal FIFO when the error correlates to a pending create; the modal stays outstanding (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.answerModal({ modal_id: 'mdl-1', option_id: 'allow' })
    connection.createConversation(PAYLOAD)
    const createId = decodeEnvelope(drivers[0].sent[1]).id

    // A create-correlated error: emit the rejection, DO NOT shift the modal FIFO.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(createId) })
    expect(createRejections(sink)).toEqual([{ type: 'conversationCreateRejected' }])
    expect(modalRejections(sink)).toEqual([])

    // Proof the answer is still outstanding: a later uncorrelated error rejects it exactly as #248.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })
    expect(modalRejections(sink)).toEqual([{ type: 'modalAnswerRejected', modalId: 'mdl-1' }])
  })

  it('a create-correlated error does not fail a healthy in-flight bundle (AC2)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.createConversation(PAYLOAD)
    const createId = decodeEnvelope(drivers[0].sent[1]).id

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(createId) })

    expect(createRejections(sink)).toEqual([{ type: 'conversationCreateRejected' }])
    // A create error is not a bundle error — the healthy bundle is NOT failed.
    expect(failed).toEqual([])
  })

  it('an error with no matching request still fails a pending bundle reassembler (AC2)', async () => {
    const { connection, sink, drivers } = await connected()
    const { consumer, failed } = makeBundleConsumer()

    connection.requestDebugBundle(consumer)
    connection.createConversation(PAYLOAD)

    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(999) })

    expect(failed).toEqual(['daemon-error'])
    expect(createRejections(sink)).toEqual([])
  })

  it('a successful conversation_created emits the created arm and nothing on the rejection arm (AC2)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createConversation(PAYLOAD)
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: conversationCreatedPlaintext(CREATED) })

    expect(emitted(sink).slice(before)).toEqual([{ type: 'conversationCreated', conversation: CREATED }])
    expect(createRejections(sink)).toEqual([])
  })

  it('never echoes the daemon error content (message / code / in_reply_to) onto any emitted event (AC3)', async () => {
    const { connection, sink, drivers } = await connected()

    connection.createConversation(PAYLOAD)
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

  it('clears the pending set on reconnect — an error for an abandoned request emits nothing (AC1)', async () => {
    const ctx = await connected()

    ctx.connection.createConversation(PAYLOAD)
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

  it('a create whose send throws records no pending entry — a later error emits no rejection (AC1)', async () => {
    const { connection, sink, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    // The send throws (caught), so the add after sendMessage never runs — no phantom pending entry. The
    // id the request would have used is 2 (the first app envelope), so an error echoing 2 must not match.
    connection.createConversation(PAYLOAD)
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext(2) })

    expect(createRejections(sink)).toEqual([])
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

describe('createDaemonConnection — workspace_updated broadcast → workspaceUpdated (#1288)', () => {
  /** A well-formed workspace_updated frame — the renamed workspace and its new label. */
  const WORKSPACE_UPDATED = { path: '/home/user/projects/app', label: 'Second Brain' }

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake.
   *  There is no OUTBOUND verb to exercise here — this frame is inbound-only until #1289 — so the
   *  describe carries only this helper, cloned from its neighbours rather than hoisted (each one is
   *  describe-local in this file). */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('decodes an inbound workspace_updated into one workspaceUpdated carrying both fields FLAT', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: workspaceUpdatedPlaintext(WORKSPACE_UPDATED) })

    // Flat fields, not a payload reference — the workspaceFolderCreated / conversationDeleted idiom for
    // a small payload. Exactly one event: the frame is a refresh trigger, not a fan-out.
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'workspaceUpdated', path: WORKSPACE_UPDATED.path, label: WORKSPACE_UPDATED.label }
    ])
  })

  it('emits identically whether the frame is correlated or unsolicited (AC1)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: workspaceUpdatedPlaintext(WORKSPACE_UPDATED, 77) })

    // No `inReplyTo` rides the event: a client that asked for the rename and one that did not both learn
    // the same thing, and both settle it the same way — by re-listing.
    expect(emitted(sink).slice(before)).toEqual([
      { type: 'workspaceUpdated', path: WORKSPACE_UPDATED.path, label: WORKSPACE_UPDATED.label }
    ])
  })

  it('carries a cleared label across as the VALUE null', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: workspaceUpdatedPlaintext({ path: WORKSPACE_UPDATED.path, label: null })
    })

    expect(emitted(sink).slice(before)).toEqual([
      { type: 'workspaceUpdated', path: WORKSPACE_UPDATED.path, label: null }
    ])
  })

  it('emits a FRESH literal — a decoder-side extra field cannot smuggle itself across IPC', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: workspaceUpdatedPlaintext({ ...WORKSPACE_UPDATED, conversation_id: 'smuggled' })
    })

    const events = emitted(sink).slice(before)
    expect(events).toEqual([
      { type: 'workspaceUpdated', path: WORKSPACE_UPDATED.path, label: WORKSPACE_UPDATED.label }
    ])
    expect(JSON.stringify(events)).not.toContain('smuggled')
  })

  it('drops a malformed workspace_updated without emitting or throwing (fail-closed)', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    for (const payload of [{ path: 42 }, { path: '/home/user/app', label: 42 }, { label: 'x' }]) {
      expect(() =>
        drivers[0].emit({ type: 'message', plaintext: workspaceUpdatedPlaintext(payload) })
      ).not.toThrow()
    }
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
    last_used_at: '2026-07-12T00:00:00Z',
    workspace_label: null
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

describe('createDaemonConnection — renameWorkspace (outbound rename_workspace, #1289)', () => {
  const RENAME_WS: RenameWorkspacePayload = { path: '/home/user/projects/app', label: 'Ledger' }

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

    expect(() => connection.renameWorkspace(RENAME_WS)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one rename_workspace envelope with id 2, ts, and the payload', async () => {
    const { connection, drivers } = await connected()

    connection.renameWorkspace(RENAME_WS)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('rename_workspace')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    expect(envelope.payload).toEqual(RENAME_WS)
  })

  it('carries a literal null label onto the wire — the CLEAR signal, never an absent key', async () => {
    const { connection, drivers } = await connected()

    connection.renameWorkspace({ path: '/home/user/projects/app', label: null })

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual({ path: '/home/user/projects/app', label: null })
    // The fresh literal names `label` unconditionally, so the key survives. An implementation that
    // spread a caller payload or built the literal conditionally would drop it, and the daemon reads
    // an absent `label` as malformed rather than as a clear.
    expect(JSON.stringify(payload)).toContain('"label":null')
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.renameWorkspace(RENAME_WS)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.renameWorkspace(RENAME_WS)).not.toThrow()
  })

  it('strips a smuggled extra field — the sent payload is exactly the two modeled fields (fresh literal)', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer could smuggle an extra key past the structural-minimum guard. The
    // fresh-literal construction in renameWorkspace must bound the wire to path + label.
    connection.renameWorkspace({
      path: '/home/user/projects/app',
      label: 'Ledger',
      conversation_id: 'smuggled'
    } as unknown as RenameWorkspacePayload)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual(RENAME_WS)
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

describe('createDaemonConnection — answerQuestions (outbound question_answer, #920)', () => {
  const PAYLOAD = {
    question_batch_id: 'qb-1',
    answers: [
      { question_index: 0, values: ['yes'] },
      { question_index: 1, values: ['a', 'b'] }
    ]
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

    expect(() => connection.answerQuestions(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one question_answer envelope with id 2, the fixed ts, and the minted token', async () => {
    const { connection, drivers } = await connected()

    connection.answerQuestions(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('question_answer')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The main-side-minted answer_token lands alongside the passed-through fields, and entry order
    // plus each entry's values order survive (array order is not the correlation, but it is preserved).
    expect(envelope.payload).toEqual({
      question_batch_id: 'qb-1',
      answer_token: 'test-token',
      answers: [
        { question_index: 0, values: ['yes'] },
        { question_index: 1, values: ['a', 'b'] }
      ]
    })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.answerQuestions(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('mints a fresh answer_token per call — two answers carry two distinct tokens (anti-replay)', async () => {
    let n = 0
    const ctx = build({ mintToken: () => `tok-${(n += 1)}` })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.connection.answerQuestions(PAYLOAD)
    ctx.connection.answerQuestions(PAYLOAD)

    const first = decodeEnvelope(ctx.drivers[0].sent[0]).payload as { answer_token: string }
    const second = decodeEnvelope(ctx.drivers[0].sent[1]).payload as { answer_token: string }
    expect(first.answer_token).toBe('tok-1')
    expect(second.answer_token).toBe('tok-2')
    expect(first.answer_token).not.toBe(second.answer_token)
  })

  it('strips a smuggled token and extra keys at BOTH levels — the fresh literal rebuilds each entry', async () => {
    const { connection, drivers } = await connected()

    // A compromised renderer can smuggle past the structural-minimum guard at two depths: a top-level
    // answer_token/extra key, AND an extra key on an ENTRY (the guard tolerates both). A shallow
    // `answers: payload.answers` would carry the entry-level key onto the wire, since the builder
    // serializes verbatim — this is the assertion that pins the DEEP rebuild.
    connection.answerQuestions({
      question_batch_id: 'qb-1',
      answer_token: 'smuggled',
      conversation_id: 'c-evil',
      answers: [{ question_index: 0, values: ['yes'], conversation_id: 'c-evil' }]
    } as unknown as typeof PAYLOAD)

    const payload = decodeEnvelope(drivers[0].sent[0]).payload
    expect(payload).toEqual({
      question_batch_id: 'qb-1',
      answer_token: 'test-token',
      answers: [{ question_index: 0, values: ['yes'] }]
    })
    expect(JSON.stringify(payload)).not.toContain('smuggled')
    expect(JSON.stringify(payload)).not.toContain('c-evil')
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.answerQuestions(PAYLOAD)).not.toThrow()
  })

  it('drops an over-cap answer whole and does NOT advance the envelope id (AC3, a live path)', async () => {
    const { connection, drivers } = await connected()

    // `values` are operator-typed free text and nothing bounds entry count or value length, so
    // MAX_PLAINTEXT_BYTES is reachable in ordinary use — this is the answer path's LIVE failure, not a
    // defensive branch. Fail closed: the send is dropped whole, never truncated (a trimmed answer would
    // send a different choice than the operator made).
    expect(() =>
      connection.answerQuestions({
        question_batch_id: 'qb-1',
        answers: [{ question_index: 0, values: ['x'.repeat(MAX_PLAINTEXT_BYTES + 1)] }]
      })
    ).not.toThrow()
    expect(drivers[0].sent).toHaveLength(0)

    // The id did not advance: the next successful send still claims 2.
    connection.answerQuestions(PAYLOAD)
    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
  })

  it('logs NOTHING on either the success or the over-cap path (AC4: no batch id, value or token)', async () => {
    const cap = captureLog()
    const ctx = build({ diagnosticLog: cap.log })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = cap.records.length

    ctx.connection.answerQuestions(PAYLOAD)
    ctx.connection.answerQuestions({
      question_batch_id: 'qb-secret',
      answers: [{ question_index: 0, values: ['x'.repeat(MAX_PLAINTEXT_BYTES + 1)] }]
    })

    // The caught object is dropped rather than read: its message could echo the batch nonce or an
    // entry value, so neither the send nor the failure records anything.
    expect(cap.records).toHaveLength(before)
  })
})

describe('createDaemonConnection — refuseQuestions (outbound question_refused, #920)', () => {
  const PAYLOAD = { question_batch_id: 'qb-1' }

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

    expect(() => connection.refuseQuestions(PAYLOAD)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one question_refused envelope with id 2, the fixed ts, and the minted token', async () => {
    const { connection, drivers } = await connected()

    connection.refuseQuestions(PAYLOAD)

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('question_refused')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // The refusal carries a token TOO, unlike modal_cancel which carries modal_id alone — do not size
    // this pair from the modal pair's asymmetry. toEqual proves `answers` is not present.
    expect(envelope.payload).toEqual({
      question_batch_id: 'qb-1',
      answer_token: 'test-token'
    })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.refuseQuestions(PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('mints a fresh answer_token per call — two refusals carry two distinct tokens (anti-replay)', async () => {
    let n = 0
    const ctx = build({ mintToken: () => `tok-${(n += 1)}` })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.connection.refuseQuestions(PAYLOAD)
    ctx.connection.refuseQuestions(PAYLOAD)

    const first = decodeEnvelope(ctx.drivers[0].sent[0]).payload as { answer_token: string }
    const second = decodeEnvelope(ctx.drivers[0].sent[1]).payload as { answer_token: string }
    expect(first.answer_token).toBe('tok-1')
    expect(second.answer_token).toBe('tok-2')
  })

  it('strips a smuggled token and extra field — the sent payload is exactly the two modelled ids', async () => {
    const { connection, drivers } = await connected()

    connection.refuseQuestions({
      question_batch_id: 'qb-1',
      answer_token: 'smuggled',
      answers: [{ question_index: 0, values: ['yes'] }]
    } as unknown as typeof PAYLOAD)

    expect(decodeEnvelope(drivers[0].sent[0]).payload).toEqual({
      question_batch_id: 'qb-1',
      answer_token: 'test-token'
    })
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.refuseQuestions(PAYLOAD)).not.toThrow()
  })

  it('logs nothing on the send path (AC4: the batch id is a one-time nonce)', async () => {
    const cap = captureLog()
    const ctx = build({ diagnosticLog: cap.log })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = cap.records.length

    ctx.connection.refuseQuestions({ question_batch_id: 'qb-secret' })

    expect(cap.records).toHaveLength(before)
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
    ReturnType<typeof build> & {
      download: DebugBundleDownload
      /** Ask, arming the transport through this connection — the argument shape since #1120. */
      request: () => void
      events: DaemonEvent[]
    }
  > {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const events: DaemonEvent[] = []
    // `save` is never reached: every path here ends in `fail`, so no archive is ever completed.
    const download = createDebugBundleDownload({
      save: vi.fn(async () => '/unreachable'),
      emit: (event) => events.push(event)
    })
    // The connection is resolved per ask since #1120, so it is supplied here rather than closed into
    // the orchestrator — the wedge these tests pin is in the GATE, which is still construction-held.
    const request = (): void =>
      download.request((consumer) => ctx.connection.requestDebugBundle(consumer))
    return { ...ctx, download, request, events }
  }

  /** How many request_debug_bundle envelopes actually reached this driver. */
  function bundleRequests(driver: FakeDriver): number {
    return driver.sent.filter((bytes) => decodeEnvelope(bytes).type === 'request_debug_bundle')
      .length
  }

  it('clears the single-in-flight flag on a relay-link-down, so a later download still reaches the wire', async () => {
    const { drivers, request, events } = await connectedDownload()

    request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    drivers[0].emit({ type: 'relay-link-down', code: 1006 })

    expect(events).toContainEqual({ type: 'debugBundleFailed', reason: 'unavailable' })

    request()

    // Two frames on the wire: without the teardown the second request is silently short-circuited
    // by the stuck `active` flag, for the rest of the process lifetime.
    expect(bundleRequests(drivers[0])).toBe(2)
  })

  it('clears the single-in-flight flag on a reconnect, so a later download reaches the new driver', async () => {
    const { connection, drivers, request } = await connectedDownload()

    request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    connection.reconnect()
    await tick()
    drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    request()

    expect(bundleRequests(drivers[1])).toBe(1)
  })

  it('fails a download requested before the new handshake completes, rather than wedging (AC4)', async () => {
    const { connection, drivers, request, events } = await connectedDownload()

    request()
    drivers[0].emit({ type: 'message', plaintext: bundleChunkPlaintext(0, CHUNK) })
    connection.reconnect()
    // Deliberately no `await tick()`: dial() has nulled the driver and the bootstrap reassigns it
    // only a microtask later, so this is the window where requestDebugBundle's null guard is exact.
    request()

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

describe('createDaemonConnection — interrupt (named interrupt control frame, fire-and-forget, #306/#1092)', () => {
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

    expect(() => connection.interrupt('conv-42')).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('after handshake-complete, forwards one interrupt envelope with id 2, the fixed ts and the id it was handed', async () => {
    const { connection, drivers } = await connected()

    connection.interrupt('conv-42')

    expect(drivers[0].sent).toHaveLength(1)
    const envelope = decodeEnvelope(drivers[0].sent[0])
    expect(envelope.type).toBe('interrupt')
    expect(envelope.id).toBe(2)
    expect(envelope.ts).toBe(FIXED_TS)
    // Decoding the BYTES rather than spying on the builder is what makes this a measurement: a method
    // that dropped its argument, or forwarded a stale one, still calls the builder. No token, no
    // nonce, no correlation key — the one modeled field and nothing else (AC5, #1092 AC1).
    expect(envelope.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('sends the id it was handed on each call, never a remembered one', async () => {
    // The two Stop affordances read `activeConversationId` at interaction time, so consecutive presses
    // in different chats must produce different frames. A method holding the first id would pass the
    // single-call assertion above and stop the wrong chat here.
    const { connection, drivers } = await connected()

    connection.interrupt('conv-a')
    connection.interrupt('conv-b')

    expect(decodeEnvelope(drivers[0].sent[0]).payload).toEqual({ conversation_id: 'conv-a' })
    expect(decodeEnvelope(drivers[0].sent[1]).payload).toEqual({ conversation_id: 'conv-b' })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.interrupt('c1')

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('does not throw out of the module when the driver sendMessage throws (parity #490)', async () => {
    const { connection, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    expect(() => connection.interrupt('conv-42')).not.toThrow()
  })
})

describe('createDaemonConnection — requestModelList (on-demand model vocabulary, #1165)', () => {
  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers } = build()
    expect(() => connection.requestModelList('conv-42')).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends one request_model_list frame carrying the conversation id it was handed', async () => {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    ctx.connection.requestModelList('conv-42')

    const sent = ctx.drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const requests = sent.filter((e) => e.type === 'request_model_list')
    // Exactly one: the ask is fire-and-forget with no client-side retry, so a second frame here
    // would be the self-inflicted spin modelListStore's header forbids.
    expect(requests).toHaveLength(1)
    // Asserted as an exact payload against a value distinct from every other string on the envelope,
    // so forwarding the wrong field cannot pass.
    expect(requests[0].payload).toEqual({ conversation_id: 'conv-42' })
  })
})

describe('createDaemonConnection — newSession (kill-and-respawn claude in one conversation, #1217)', () => {
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin, not a fail)', () => {
    const { connection, drivers } = build()

    expect(() => connection.newSession('conv-42')).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends exactly one new_session frame carrying the conversation id it was handed (AC4)', async () => {
    const ctx = await connected()

    ctx.connection.newSession('conv-42')

    const sent = ctx.drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const frames = sent.filter((e) => e.type === 'new_session')
    // Exactly one, and no reply is awaited: the frame is fire-and-forget, so a second frame would be
    // a second restart rather than a retry of the first.
    expect(frames).toHaveLength(1)
    // Exact toEqual against a value distinct from every other string on the envelope: forwarding the
    // wrong field cannot pass, and any nonce or correlation key would add a key and fail the match.
    expect(frames[0].payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.newSession('c1')

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })
})

describe('createDaemonConnection — requestSessionSettings (run-config request/reply, #491)', () => {
  const RUN_CONFIG = {
    session_id: 'sess-a',
    model: 'claude-opus-4-8',
    effort: 'high',
    yolo: true,
    // Agrees with `yolo: true` above, because the daemon stores the pair so they cannot disagree
    // (#1020). It is also the one mode the WRITE half refuses (#1021), which is why it is the
    // baseline here: a decoder narrowed to the write half's five would redden on this fixture.
    permission_mode: 'bypassPermissions',
    used_tokens: 12480,
    window_tokens: 200000
  }

  /** The conversation the request names, and therefore the one the reply describes (#1176). */
  const CONV = 'conv-alpha'

  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The envelope id of the LAST request_session_settings this connection put on the wire. */
  function lastRequestId(ctx: ReturnType<typeof build>): number {
    const sent = ctx.drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const requests = sent.filter((e) => e.type === 'request_session_settings')
    return requests[requests.length - 1].id
  }

  /**
   * Connected, with one outstanding `request_session_settings` naming `conversationId` — the
   * correlation every reply below must match (#1176). Returns its envelope id, read off the frame
   * actually sent rather than assumed, so a change to the client's numbering cannot silently make
   * every reply here uncorrelatable-and-therefore-dropped while the assertions still read as if the
   * gate were being exercised.
   */
  async function requested(
    conversationId: string = CONV
  ): Promise<ReturnType<typeof build> & { replyTo: number }> {
    const ctx = await connected()
    ctx.connection.requestSessionSettings(conversationId)
    return { ...ctx, replyTo: lastRequestId(ctx) }
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers } = build()
    expect(() => connection.requestSessionSettings()).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends a request_session_settings frame naming no conversation when called with no id', async () => {
    const { connection, drivers } = await connected()

    connection.requestSessionSettings()

    const sent = drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const request = sent.find((e) => e.type === 'request_session_settings')
    expect(request).toBeDefined()
    // The key is always present (the daemon's field has no `omitempty`); '' is the "names nothing"
    // value, which the daemon answers with a zero-valued session_settings — the pre-#945 behaviour.
    expect(request?.payload).toEqual({ conversation_id: '' })
  })

  it('forwards the conversation id it is handed into the frame', async () => {
    const { connection, drivers } = await connected()

    connection.requestSessionSettings('conv-42')

    const sent = drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const request = sent.find((e) => e.type === 'request_session_settings')
    // Asserted as an exact payload against a value distinct from every other string on the envelope,
    // so forwarding the wrong field cannot pass.
    expect(request?.payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('decodes an inbound session_settings into runConfigReceived with all eight fields', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([
      {
        type: 'runConfigReceived',
        conversationId: CONV,
        sessionId: 'sess-a',
        model: 'claude-opus-4-8',
        effort: 'high',
        yolo: true,
        permissionMode: 'bypassPermissions',
        used_tokens: 12480,
        window_tokens: 200000
      }
    ])
  })

  it('carries permission_mode across as camelCase permissionMode, and no snake key (#1020)', async () => {
    // The arm is camelCase by convention (`sessionId`, and the assistantDelta neighbour's "wire is
    // snake, IPC is camel"); `used_tokens` / `window_tokens` are the two legacy exceptions on it and
    // are not a precedent to extend. Asserting the ABSENCE of the snake key is what proves the emit is
    // a named copy rather than a spread of the decoded payload — a spread would carry both spellings.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })

    const event = emitted(sink).find((e) => e.type === 'runConfigReceived')
    expect(event).toHaveProperty('permissionMode', 'bypassPermissions')
    expect(event).not.toHaveProperty('permission_mode')
  })

  it('carries an empty permission_mode through as "" (no session resolved), never coerced (#1020)', async () => {
    // The all-zero reply. '' is the one zero on this payload that names no real posture, and it
    // arrives beside `session_id: ''` — both cross verbatim, so a reader can see the pair. Coercing
    // it to a mode name or to null here would invent a posture the daemon never reported.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext(
        { ...RUN_CONFIG, session_id: '', permission_mode: '' },
        replyTo
      )
    })

    const event = emitted(sink).find((e) => e.type === 'runConfigReceived')
    expect(event).toHaveProperty('permissionMode', '')
    expect(event).toHaveProperty('sessionId', '')
  })

  it('emits nothing when permission_mode is absent — the old-daemon shape (#1020)', async () => {
    // The accepted coupling, pinned: a daemon predating pyrycode#1687 omits the key, the required
    // decode rejects the frame whole, and NO partial event crosses. This is what makes the sheet and
    // the three footer controls go inert against an old daemon, which the real-daemon gate detects.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext({ ...RUN_CONFIG, permission_mode: undefined }, replyTo)
    })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([])
  })

  it('carries an empty session_id through as "" (the cannot-address signal), never coerced', async () => {
    // '' is the daemon saying "I have no session to address". The sheet's gate must be able to see
    // it: coercing it to null here would make it indistinguishable from "no reply yet" and re-open
    // the inert-sheet defect one layer down (#491).
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext({ ...RUN_CONFIG, session_id: '' }, replyTo)
    })

    const event = emitted(sink).find((e) => e.type === 'runConfigReceived')
    expect(event).toBeDefined()
    expect(event).toHaveProperty('sessionId', '')
  })

  it('emits nothing for a malformed session_settings (fail-closed, never a partial event)', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext({ ...RUN_CONFIG, window_tokens: undefined }, replyTo)
    })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([])
  })

  // #1176 — the reply carries no conversation id of its own, so the one it describes is resolved
  // HERE: the request's envelope id is recorded against the conversation it named, and the reply is
  // matched back by Envelope.in_reply_to. Fail-closed on anything uncorrelatable, the
  // session-settings-updated arm's shape applied to the read leg.

  it('resolves the conversation the request named onto the reply (#1176, AC1)', async () => {
    const { sink, drivers, replyTo } = await requested('conv-named')

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })

    // Asserted against a value distinct from every other string on the frame and from the describe's
    // default, so resolving the wrong field — or a fallback onto some ambient id — cannot pass.
    const event = emitted(sink).find((e) => e.type === 'runConfigReceived')
    expect(event).toHaveProperty('conversationId', 'conv-named')
  })

  it('emits nothing for a session_settings carrying no in_reply_to (#1176, AC4)', async () => {
    // The unsolicited frame: a daemon that broadcasts this reply, or one impersonating it. There is
    // nothing to attribute it to, so it reaches neither store — and the outstanding request stays
    // outstanding, which the follow-up reply below proves by still correlating.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, undefined) })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([])

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })
    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toHaveLength(1)
  })

  it('emits nothing for a session_settings whose in_reply_to matches no outstanding request (#1176, AC4)', async () => {
    const { sink, drivers, replyTo } = await requested()

    // One past the real id — a plausible-looking neighbour rather than an obviously absurd value, so
    // an off-by-one in the recorded id would be caught by this test rather than passing it.
    drivers[0].emit({
      type: 'message',
      plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo + 1)
    })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toEqual([])
  })

  it('emits nothing for a second reply re-using an already-matched in_reply_to (#1176, AC4)', async () => {
    // The entry is deleted on match, so a duplicate — or a daemon replaying an old reply — finds
    // nothing. Without the delete this is the arm that would let one request answer forever.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })
    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'runConfigReceived')).toHaveLength(1)
  })

  it('keys the correlation by envelope id, so two interleaved requests each draw their own conversation back (#1176, AC1)', async () => {
    // Replies OUT OF REQUEST ORDER, deliberately: a FIFO would hand each reply the other's id and
    // still emit two events, so only crossing the order distinguishes a keyed map from a queue.
    const ctx = await connected()
    ctx.connection.requestSessionSettings('conv-first')
    const first = lastRequestId(ctx)
    ctx.connection.requestSessionSettings('conv-second')
    const second = lastRequestId(ctx)
    expect(first).not.toBe(second)

    ctx.drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, second) })
    ctx.drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, first) })

    expect(
      emitted(ctx.sink)
        .filter((e) => e.type === 'runConfigReceived')
        .map((e) => (e as { conversationId: string }).conversationId)
    ).toEqual(['conv-second', 'conv-first'])
  })

  it('records no pending entry when the send throws — a later matching reply emits nothing (#1176)', async () => {
    // The registration order this pins: the entry is written only AFTER driver.sendMessage returns
    // (the setSessionSettings / answerModal record-after-send precedent). A throwing send advances no
    // envelope id, so the id it would have claimed is re-minted by the next request — and a phantom
    // entry under it would answer that request with the throwing call's conversation instead.
    const { connection, sink, drivers } = build({ throwOnSend: true })
    connection.start()
    await tick()
    drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    connection.requestSessionSettings('conv-never-sent')
    const before = emitted(sink).length

    // The would-be minted id is 2 (a fresh connect starts nextEnvelopeId at 2); echoing it correlates
    // to nothing, because no entry was recorded.
    drivers[0].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, 2) })

    expect(emitted(sink).slice(before)).toEqual([])
  })

  it('clears the correlation map on reconnect — a reply for an abandoned request emits nothing (#1176, AC4)', async () => {
    const ctx = await connected()

    ctx.connection.requestSessionSettings(CONV)
    const id = lastRequestId(ctx)

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const before = emitted(ctx.sink).length

    // dial() abandoned the outstanding request; a reply echoing the old id (ids also recycle from 2)
    // correlates to nothing on the fresh connection. This is what makes the recycled numbering safe:
    // without the clear, the next connection's request would inherit this one's conversation.
    ctx.drivers[1].emit({ type: 'message', plaintext: sessionSettingsPlaintext(RUN_CONFIG, id) })

    expect(emitted(ctx.sink).slice(before)).toEqual([])
  })
})

describe('createDaemonConnection — question_shown stream (#885)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** A well-formed two-question batch, nesting two levels, `multi_select` both ways. */
  const BATCH = {
    conversation_id: 'conv-7f3a',
    question_batch_id: 'qb_01HZY',
    questions: [
      {
        question: 'Which strategy should I use?',
        header: 'Write strategy',
        options: [
          { label: 'Rewrite', description: 'Replace the file wholesale' },
          { label: 'Patch', description: 'Apply a minimal diff' }
        ],
        multi_select: false
      },
      {
        question: 'Which files may I touch?',
        header: 'Scope',
        options: [
          { label: 'src', description: 'Production sources' },
          { label: 'e2e', description: 'Playwright specs' }
        ],
        multi_select: true
      }
    ]
  }

  it('emits three camelCase fields with the nested rows verbatim, in wire order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: questionShownPlaintext(BATCH) })

    // Exact toEqual on every field at both nesting levels: the top level is snake→camel
    // (`conversation_id`→`conversationId`, `question_batch_id`→`questionBatchId`), each question row
    // is reused VERBATIM so `multi_select` stays snake_case, and each option row likewise.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'questionShown',
        conversationId: 'conv-7f3a',
        questionBatchId: 'qb_01HZY',
        questions: [
          {
            question: 'Which strategy should I use?',
            header: 'Write strategy',
            options: [
              { label: 'Rewrite', description: 'Replace the file wholesale' },
              { label: 'Patch', description: 'Apply a minimal diff' }
            ],
            multi_select: false
          },
          {
            question: 'Which files may I touch?',
            header: 'Scope',
            options: [
              { label: 'src', description: 'Production sources' },
              { label: 'e2e', description: 'Playwright specs' }
            ],
            multi_select: true
          }
        ]
      }
    ])
  })

  it('emits exactly the three modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // An extra key planted at ALL THREE levels. A top-level check alone would miss a row-borne extra,
    // and this family nests two deep — so the smuggling surface is three wide, not one.
    drivers[0].emit({
      type: 'message',
      plaintext: questionShownPlaintext({
        ...BATCH,
        smuggled_payload: 'must-not-cross',
        questions: [
          {
            ...BATCH.questions[0],
            smuggled_question: 'must-not-cross',
            options: [{ ...BATCH.questions[0].options[0], smuggled_option: 'must-not-cross' }]
          }
        ]
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'questionBatchId',
      'questions',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed question_shown (non-boolean multi_select) without emitting or throwing', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: questionShownPlaintext({
          ...BATCH,
          // The string "false" is truthy — the branch a truthiness check passes green while broken.
          questions: [{ ...BATCH.questions[0], multi_select: 'false' }]
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })

  it('emits an empty batch rather than dropping it (out of contract is not this leg to judge)', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({
      type: 'message',
      plaintext: questionShownPlaintext({ ...BATCH, questions: [] })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'questionShown',
        conversationId: 'conv-7f3a',
        questionBatchId: 'qb_01HZY',
        questions: []
      }
    ])
  })
})

describe('createDaemonConnection — question_dismissed stream (#895)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The producer's ONE landed pair, for the whole no-answer class. Deliberately not `timeout`: that
   *  value lives only in upstream `testdata/question_dismissed.json`, a shape fixture minted by the
   *  declaring slice before any producer existed. */
  const DISMISSAL = {
    question_batch_id: 'qb_01HZY',
    outcome: 'unanswered',
    source: 'no_answer'
  }

  it('emits three camelCase fields in wire order, carrying an out-of-WireModalSource source verbatim', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: questionDismissedPlaintext(DISMISSAL) })

    // This one assertion is also the type-trap test. `no_answer` is NOT a member of WireModalSource
    // (`remote` | `local` | `timeout`), so an arm that copied `modalDismissed`'s `source:
    // WireModalSource` annotation cannot reach green here — it fails at the emit site, where the
    // decoded field is a plain string. The fix for that error is to widen the arm, never to cast the
    // payload and never to reach for the fixture's `timeout`.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'questionDismissed',
        questionBatchId: 'qb_01HZY',
        outcome: 'unanswered',
        source: 'no_answer'
      }
    ])
  })

  it('carries a source sentinel the producer has yet to name, unchanged', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // The open `string` is not "open enough for today's two values" — it is open. The producer's
    // arbiter cannot tell an elapsed approval window from a caller disconnect or a daemon shutdown,
    // so the vocabulary is expected to grow, and an unrecognised value must cross rather than be
    // rejected here. What it MEANS is the fail-closed reading rule, which belongs to the consumer
    // (#850): resolved, cause unknown — never an answer.
    drivers[0].emit({
      type: 'message',
      plaintext: questionDismissedPlaintext({
        ...DISMISSAL,
        outcome: 'superseded',
        source: 'daemon_shutdown'
      })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'questionDismissed',
        questionBatchId: 'qb_01HZY',
        outcome: 'superseded',
        source: 'daemon_shutdown'
      }
    ])
  })

  it('emits exactly the three modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // One level, unlike the batch's three: this payload is flat, so the smuggling surface is the
    // payload object alone.
    drivers[0].emit({
      type: 'message',
      plaintext: questionDismissedPlaintext({ ...DISMISSAL, smuggled_payload: 'must-not-cross' })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'outcome',
      'questionBatchId',
      'source',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('drops a malformed question_dismissed (non-string source) without emitting or throwing', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: questionDismissedPlaintext({ ...DISMISSAL, source: null })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — slash_command_list stream (#937)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** A four-row menu, SYNTHETIC throughout — no real repository path and no real command name, because
   *  a failing `toEqual` prints the whole object into CI output (Security review 7c). Each row is here
   *  for one property the ACs pin: a `truncated_fields: null`, a description carrying both an embedded
   *  newline and a non-ASCII rune, a `truncated_fields` naming `aliases` beside a non-empty `aliases`,
   *  and the all-zero row that is the only shape reaching an empty `argument_hint` and an empty
   *  `aliases` at once. `dropped_commands` is 2 against 4 carried rows, so nothing can pass by
   *  recomputing one from the other. */
  const MENU = {
    conversation_id: 'conv-9c1d',
    commands: [
      {
        name: 'synth-compact',
        argument_hint: '[instructions]',
        description: 'Synthetic row: nothing was cut for this one.',
        aliases: [],
        truncated_fields: null
      },
      {
        name: 'synth-review',
        argument_hint: '',
        description: 'Synthetic row: first line\nsecond line — ünïcode ✓',
        aliases: [],
        truncated_fields: ['description']
      },
      {
        name: 'synth-clear',
        argument_hint: '',
        description: 'Synthetic row: the cut-aliases reading rule.',
        aliases: ['synth-reset', 'synth-wipe'],
        truncated_fields: ['aliases']
      },
      {
        name: '__synth-zero',
        argument_hint: '',
        description: '',
        aliases: [],
        truncated_fields: null
      }
    ],
    dropped_commands: 2
  }

  it('emits three camelCase top-level fields with the rows verbatim, in wire order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: slashCommandListPlaintext(MENU) })

    // One exact toEqual covering AC1, AC3 and AC4 at once. The top level is snake→camel
    // (`conversation_id`→`conversationId`, `dropped_commands`→`droppedCommands`); each row is reused
    // VERBATIM, so `argument_hint` and `truncated_fields` stay snake_case. `toEqual` distinguishes
    // `null` from `undefined` and from an absent key, so the two `truncated_fields: null` rows are
    // pinned by value here and not merely by shape.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'slashCommandList',
        conversationId: 'conv-9c1d',
        commands: [
          {
            name: 'synth-compact',
            argument_hint: '[instructions]',
            description: 'Synthetic row: nothing was cut for this one.',
            aliases: [],
            truncated_fields: null
          },
          {
            name: 'synth-review',
            argument_hint: '',
            description: 'Synthetic row: first line\nsecond line — ünïcode ✓',
            aliases: [],
            truncated_fields: ['description']
          },
          {
            name: 'synth-clear',
            argument_hint: '',
            description: 'Synthetic row: the cut-aliases reading rule.',
            aliases: ['synth-reset', 'synth-wipe'],
            truncated_fields: ['aliases']
          },
          {
            name: '__synth-zero',
            argument_hint: '',
            description: '',
            aliases: [],
            truncated_fields: null
          }
        ],
        droppedCommands: 2
      }
    ])
  })

  it('carries truncated_fields: null as null, and a cut naming aliases beside a non-empty aliases', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: slashCommandListPlaintext(MENU) })

    const event = emitted(sink).slice(before)[0]
    // Narrow rather than cast — the arm's own discriminant does the work, so no `as` is needed to read
    // a row.
    if (event.type !== 'slashCommandList') throw new Error('expected a slashCommandList arm')

    // AC3, explicitly: `null` is the value, never `undefined` and never an absent key. Asserted by
    // VALUE and deliberately NOT with `toHaveProperty` or an `in` check — this channel is
    // `webContents.send`, so structured clone preserves an assigned `undefined` as a present key, and a
    // presence check would read true on a row carrying nothing.
    expect(event.commands[0].truncated_fields).toBe(null)
    expect(event.commands[3].truncated_fields).toBe(null)

    // The reading-rule row: `truncated_fields` naming `aliases` must arrive intact, because it is the
    // ONLY signal separating "cut to nothing" from "none" — `aliases: []` says both. Here it rides
    // beside a NON-empty `aliases`, the shape that proves the two fields cross independently.
    expect(event.commands[2].truncated_fields).toEqual(['aliases'])
    expect(event.commands[2].aliases).toEqual(['synth-reset', 'synth-wipe'])

    // Both measured byte-level properties of a real description survive the crossing (AC3).
    expect(event.commands[1].description).toContain('\n')
    expect(event.commands[1].description).toContain('ünïcode')
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // An extra key planted at BOTH levels — the payload and a row. This family nests one level, unlike
    // the question batch's three, so the smuggling surface is two wide.
    drivers[0].emit({
      type: 'message',
      plaintext: slashCommandListPlaintext({
        ...MENU,
        smuggled_payload: 'must-not-cross',
        commands: [{ ...MENU.commands[0], smuggled_row: 'must-not-cross' }]
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'commands',
      'conversationId',
      'droppedCommands',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('carries dropped_commands verbatim — 0 is a value, and nothing recomputes it from the entries', async () => {
    const { sink, drivers } = await connected()

    // Zero against four carried rows: a count consulted for truthiness, or defaulted with `|| 0`,
    // reaches green here anyway — which is why the non-zero case below shares the assertion.
    const beforeZero = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: slashCommandListPlaintext({ ...MENU, dropped_commands: 0 })
    })
    const zero = emitted(sink).slice(beforeZero)[0]
    if (zero.type !== 'slashCommandList') throw new Error('expected a slashCommandList arm')
    expect(zero.droppedCommands).toBe(0)
    expect(zero.commands).toHaveLength(4)

    // Three dropped against ONE carried row. The two numbers disagree on purpose: an emit that
    // recomputed the count from `commands.length`, or cross-checked the pair and "corrected" one, lands
    // on 1 rather than 3 and reddens here. The menu's true size is 1 + 3, and only the daemon knows it.
    const beforeMany = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: slashCommandListPlaintext({
        ...MENU,
        commands: [MENU.commands[0]],
        dropped_commands: 3
      })
    })
    const many = emitted(sink).slice(beforeMany)[0]
    if (many.type !== 'slashCommandList') throw new Error('expected a slashCommandList arm')
    expect(many.droppedCommands).toBe(3)
    expect(many.commands).toHaveLength(1)
  })

  it('emits an empty menu as an empty list, distinguishable from no frame at all', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // `commands: []` is a POSITIVE STATEMENT that claude offered nothing — the opposite of
    // `question_shown`'s empty array, which is out of contract. It must cross, never be coalesced away
    // as "no news": asserting the slice has exactly one element is what separates an empty menu from a
    // dropped frame (AC3).
    drivers[0].emit({
      type: 'message',
      plaintext: slashCommandListPlaintext({ ...MENU, commands: [], dropped_commands: 0 })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'slashCommandList',
        conversationId: 'conv-9c1d',
        commands: [],
        droppedCommands: 0
      }
    ])
  })

  it('drops a malformed slash_command_list (aliases: null) without emitting or throwing', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // `aliases` is the field whose contract forbids null while its `truncated_fields` neighbour one row
    // over permits it — the branch a reader pattern-matching off the sibling waves through. Asserted on
    // the raw send-call count rather than on `emitted()`, so a non-event send would still be caught
    // (AC2).
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: slashCommandListPlaintext({
          ...MENU,
          commands: [{ ...MENU.commands[0], aliases: null }]
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — model_list stream (#973)', () => {
  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** A four-row menu, SYNTHETIC throughout — no real model identifier and no real display name, because
   *  a failing `toEqual` prints the whole object into CI output. Each row is here for one property the
   *  ACs pin: a `truncated_fields: null` row, a `truncated_fields` naming `effort_levels` BESIDE a
   *  non-empty `effort_levels` (the shape proving the two fields cross independently, and the one that
   *  separates "cut to nothing" from "this model exposes no effort control"), a `supports_auto_mode:
   *  false` row whose `false` is a VALUE rather than a missing reading, and a display name carrying both
   *  an embedded newline and a non-ASCII rune. `dropped_models` is 2 against 4 carried rows — the
   *  committed fixture's own posture, which deliberately violates upstream's ten-entry invariant because
   *  it pins SHAPE rather than capturing live traffic — so nothing can pass by recomputing one count
   *  from the other. */
  const MENU = {
    conversation_id: 'conv-4b7e',
    models: [
      {
        resolved_model: 'synth-model-a-2026',
        value: 'synth-a',
        display_name: 'Synthetic A',
        effort_levels: ['low', 'high'],
        supports_auto_mode: true,
        truncated_fields: null
      },
      {
        resolved_model: '<unmeasured>',
        value: 'synth-b[1m]',
        display_name: 'Synthetic B: first line\nsecond line — ünïcode ✓',
        effort_levels: ['medium'],
        supports_auto_mode: true,
        truncated_fields: ['effort_levels']
      },
      {
        resolved_model: '<unmeasured>',
        value: 'synth-c',
        display_name: 'Synthetic C',
        effort_levels: [],
        supports_auto_mode: false,
        truncated_fields: null
      },
      {
        resolved_model: '',
        value: 'default',
        display_name: '',
        effort_levels: [],
        supports_auto_mode: false,
        truncated_fields: ['display_name', 'value']
      }
    ],
    dropped_models: 2
  }

  it('emits three camelCase top-level fields with the rows verbatim, in wire order', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: modelListPlaintext(MENU) })

    // One exact toEqual covering AC1 and AC2 at once. The top level is snake→camel
    // (`conversation_id`→`conversationId`, `dropped_models`→`droppedModels`) and the wire `type` does
    // NOT cross; each row is reused VERBATIM, so `resolved_model`, `display_name`, `effort_levels`,
    // `supports_auto_mode` and `truncated_fields` all stay snake_case. A `.map` that camelCased the rows
    // reddens here, which is the point: the fresh-literal rule governs the EVENT OBJECT only.
    // `toEqual` distinguishes `null` from `undefined` and from an absent key, so the two
    // `truncated_fields: null` rows are pinned by value and not merely by shape.
    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'modelList',
        conversationId: 'conv-4b7e',
        models: [
          {
            resolved_model: 'synth-model-a-2026',
            value: 'synth-a',
            display_name: 'Synthetic A',
            effort_levels: ['low', 'high'],
            supports_auto_mode: true,
            truncated_fields: null
          },
          {
            resolved_model: '<unmeasured>',
            value: 'synth-b[1m]',
            display_name: 'Synthetic B: first line\nsecond line — ünïcode ✓',
            effort_levels: ['medium'],
            supports_auto_mode: true,
            truncated_fields: ['effort_levels']
          },
          {
            resolved_model: '<unmeasured>',
            value: 'synth-c',
            display_name: 'Synthetic C',
            effort_levels: [],
            supports_auto_mode: false,
            truncated_fields: null
          },
          {
            resolved_model: '',
            value: 'default',
            display_name: '',
            effort_levels: [],
            supports_auto_mode: false,
            truncated_fields: ['display_name', 'value']
          }
        ],
        droppedModels: 2
      }
    ])
  })

  it('carries truncated_fields: null as null, and a cut naming effort_levels beside a non-empty list', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    drivers[0].emit({ type: 'message', plaintext: modelListPlaintext(MENU) })

    const event = emitted(sink).slice(before)[0]
    // Narrow rather than cast — the arm's own discriminant does the work, so no `as` is needed to read
    // a row.
    if (event.type !== 'modelList') throw new Error('expected a modelList arm')

    // AC4's truncation contract, explicitly: `null` is the value, never `undefined` and never an absent
    // key. Asserted by VALUE and deliberately NOT with `toHaveProperty` or an `in` check — this channel
    // is `webContents.send`, so structured clone preserves an assigned `undefined` as a present key, and
    // a presence check would read true on a row carrying nothing.
    expect(event.models[0].truncated_fields).toBe(null)
    expect(event.models[2].truncated_fields).toBe(null)

    // The reading-rule row: `truncated_fields` naming `effort_levels` must arrive intact, because it is
    // the ONLY signal separating "cut to nothing, or shortened" from "this model exposes no effort
    // control" — an empty `effort_levels` says both, since the wire collapses absent, null and empty
    // into one value. Here the cut rides beside a NON-empty list, the shape that proves the two fields
    // cross independently rather than one being derived from the other.
    expect(event.models[1].truncated_fields).toEqual(['effort_levels'])
    expect(event.models[1].effort_levels).toEqual(['medium'])

    // Row three is the other half of that pair: an empty `effort_levels` with NOTHING cut. The two rows
    // together are what make the collapse legible — identical `effort_levels`-is-uninformative shapes
    // saying opposite things, separated only by `truncated_fields`.
    expect(event.models[2].effort_levels).toEqual([])

    // `false` is a VALUE, not a missing reading: claude refuses `auto` permission mode per model, and
    // absent in claude's reply decodes to `false` correctly. A crossing that dropped falsy fields
    // reddens here.
    expect(event.models[2].supports_auto_mode).toBe(false)

    // Both byte-level properties of a claude-authored label survive the crossing unsanitized — which is
    // the contract, not a defect: the daemon bounds these strings and does not sanitize them, and the
    // RENDER boundary owes the escaping (AC4's provenance clause).
    expect(event.models[1].display_name).toContain('\n')
    expect(event.models[1].display_name).toContain('ünïcode')
  })

  it('emits exactly the four modeled properties, never a spread of the decoded payload', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // An extra key planted at BOTH levels — the payload and a row. This family nests one level, so the
    // smuggling surface is two wide. A hoisted `truncated_fields` is planted alongside, since that is
    // the key this frame deliberately does NOT have (a cut is a property of one row and rides that row).
    drivers[0].emit({
      type: 'message',
      plaintext: modelListPlaintext({
        ...MENU,
        smuggled_payload: 'must-not-cross',
        truncated_fields: ['must-not-cross'],
        models: [{ ...MENU.models[0], smuggled_row: 'must-not-cross' }]
      })
    })

    const events = emitted(sink).slice(before)
    expect(Object.keys(events[0]).sort()).toEqual([
      'conversationId',
      'droppedModels',
      'models',
      'type'
    ])
    expect(JSON.stringify(events)).not.toContain('must-not-cross')
  })

  it('carries dropped_models verbatim — 0 is a value, and nothing recomputes it from the entries', async () => {
    const { sink, drivers } = await connected()

    // Zero against four carried rows: a count consulted for truthiness, or defaulted with `|| 0`,
    // reaches green here anyway — which is why the non-zero case below shares the assertion.
    const beforeZero = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: modelListPlaintext({ ...MENU, dropped_models: 0 })
    })
    const zero = emitted(sink).slice(beforeZero)[0]
    if (zero.type !== 'modelList') throw new Error('expected a modelList arm')
    expect(zero.droppedModels).toBe(0)
    expect(zero.models).toHaveLength(4)

    // Three dropped against ONE carried row. The two numbers disagree on purpose: an emit that
    // recomputed the count from `models.length`, or cross-checked the pair and "corrected" one, lands on
    // 1 rather than 3 and reddens here. The menu's true size is 1 + 3, and only the daemon knows it. The
    // producer's ten-entry cap is a DAEMON-SIDE cap rather than a wire constant, so a shorter list
    // beside a non-zero count is not a contradiction to reconcile.
    const beforeMany = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: modelListPlaintext({
        ...MENU,
        models: [MENU.models[0]],
        dropped_models: 3
      })
    })
    const many = emitted(sink).slice(beforeMany)[0]
    if (many.type !== 'modelList') throw new Error('expected a modelList arm')
    expect(many.droppedModels).toBe(3)
    expect(many.models).toHaveLength(1)
  })

  it('emits an empty menu as an empty list, distinguishable from no frame at all', async () => {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length

    // `models: []` is a POSITIVE STATEMENT that claude offered nothing — the daemon's MarshalJSON
    // normalises a nil slice to `[]` and `omitempty` is deliberately out, because eliding the key would
    // erase the frame's point. It must cross, never be coalesced away as "no news": asserting the slice
    // has exactly one element is what separates an empty menu from a dropped frame (AC2). Note this is
    // NOT the argument behind a row's empty `effort_levels` above, which is a COLLAPSE — one frame
    // states three different positions on empty.
    drivers[0].emit({
      type: 'message',
      plaintext: modelListPlaintext({ ...MENU, models: [], dropped_models: 0 })
    })

    expect(emitted(sink).slice(before)).toEqual([
      {
        type: 'modelList',
        conversationId: 'conv-4b7e',
        models: [],
        droppedModels: 0
      }
    ])
  })

  it('drops a malformed model_list (models: null) without emitting or throwing', async () => {
    const { sink, drivers } = await connected()
    const before = sink.webContents.send.mock.calls.length

    // `models` is the field whose contract forbids null while its row-level `truncated_fields` neighbour
    // permits it — the branch a reader pattern-matching off one to the other waves through.
    // `Array.isArray(null)` is false, which is precisely what fails it closed upstream of this emit.
    // Asserted on the raw send-call count rather than on `emitted()`, so a non-event send would still be
    // caught (AC2).
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: modelListPlaintext({ ...MENU, models: null })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)

    // A malformed ROW fails the whole frame closed too, rather than yielding a partial menu — the
    // outcome #972's narrower exists to prevent. One bad row among three good ones.
    expect(() =>
      drivers[0].emit({
        type: 'message',
        plaintext: modelListPlaintext({
          ...MENU,
          models: [MENU.models[0], { ...MENU.models[1], effort_levels: null }, MENU.models[2]]
        })
      })
    ).not.toThrow()
    expect(sink.webContents.send.mock.calls.length).toBe(before)
  })
})

describe('createDaemonConnection — attachment upload drive (#861)', () => {
  const STRIDE = ATTACHMENT_CHUNK_DATA_BYTES

  /** Three chunks, so "the completing chunk is not the last one sent" is reachable. */
  const FILE = Uint8Array.from({ length: STRIDE * 2 + 5 }, (_, index) => index % 251)

  const upload = (
    connection: DaemonConnection,
    attachmentId = 'att-1'
  ): Promise<AttachmentTransferResult> =>
    connection.uploadAttachment({
      conversation_id: 'conv-1',
      attachment_id: attachmentId,
      filename: 'notes.txt',
      mime_type: 'text/plain',
      bytes: FILE
    })

  /** Reach the connected window: start, let the bootstrap build the driver, complete the handshake. */
  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The chunk envelopes the connection put on the wire, decoded. */
  const chunksSent = (driver: FakeDriver): ReturnType<typeof decodeEnvelope>[] =>
    driver.sent.map(decodeEnvelope).filter((envelope) => envelope.type === 'attachment_chunk')

  /**
   * Let the driver's send loop drain. It yields a `setImmediate` macrotask between chunks, so a
   * `tick()` (one setTimeout) per chunk plus slack is enough for any plan these tests build.
   */
  const drain = async (): Promise<void> => {
    for (let turn = 0; turn < 8; turn++) await tick()
  }

  /** Answer whatever the daemon would answer for one already-sent chunk, through the shipped fake. */
  const answer = (
    driver: FakeDriver,
    reply: (plaintext: Uint8Array) => Uint8Array[]
  ): void => {
    for (const plaintext of driver.sent) {
      for (const frame of reply(plaintext)) driver.emit({ type: 'message', plaintext: frame })
    }
  }

  it('resolves not-connected before the handshake, without sending anything', async () => {
    const ctx = build()

    await expect(upload(ctx.connection)).resolves.toEqual({
      ok: false,
      outcome: 'not-connected'
    })
    expect(ctx.drivers).toHaveLength(0)
  })

  it('puts every chunk on the wire in index order under this connection ids (AC1)', async () => {
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    answer(drivers[0], attachmentStoredReplyFrames(2))
    await result

    const chunks = chunksSent(drivers[0])
    expect(chunks).toHaveLength(3)
    expect(chunks.map((envelope) => (envelope.payload as AttachmentChunkPayload).index)).toEqual([
      0, 1, 2
    ])
    // Ascending envelope ids drawn from the connection's own monotonic counter — no second counter.
    const ids = chunks.map((envelope) => envelope.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(3)
  })

  it('resolves complete on a success reply correlated to a NON-FINAL chunk (AC2)', async () => {
    // The case an envelope-id-keyed driver fails: the daemon answers the chunk whose ARRIVAL
    // completed the transfer, and chunks may be reassembled in any order — here index 0 closes the
    // set, so the reply's in_reply_to names the FIRST envelope sent, not the last.
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    answer(drivers[0], attachmentStoredReplyFrames(0))

    await expect(result).resolves.toEqual({ ok: true })
  })

  it.each<[AttachmentRejectCode, AttachmentTransferFailure]>([
    ['attachment.invalid_chunk', 'attachment-invalid-chunk'],
    ['attachment.integrity_failed', 'attachment-integrity-failed'],
    ['attachment.too_large', 'attachment-too-large'],
    ['attachment.too_many_uploads', 'attachment-too-many-uploads'],
    ['attachment.storage_failed', 'attachment-storage-failed']
  ])('resolves failed carrying the outcome %s maps to (AC3)', async (code, outcome) => {
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    answer(drivers[0], attachmentRejectReplyFrames(1, code))

    await expect(result).resolves.toEqual({ ok: false, outcome })
  })

  it('never also reports complete once a reject has settled the transfer (AC3)', async () => {
    // The "no further chunks go out" half of AC3 is proven deterministically one layer down, in
    // attachmentTransfer.test.ts, where the yield seam is injected. Here the loop yields a real
    // setImmediate against a setTimeout-based tick, so how far it got is genuinely racy and asserting
    // on it would be a flaky test dressed as coverage. What this layer owns is the terminal: the
    // reject wins, and a later success for the same transfer cannot re-settle it.
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    answer(drivers[0], attachmentRejectReplyFrames(0, 'attachment.too_large'))

    await expect(result).resolves.toEqual({ ok: false, outcome: 'attachment-too-large' })
    answer(drivers[0], attachmentStoredReplyFrames(0))
    await expect(result).resolves.toEqual({ ok: false, outcome: 'attachment-too-large' })
  })

  it('resolves connection-lost when the session goes away mid-transfer (AC3)', async () => {
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    drivers[0].emit({ type: 'terminal', code: 1006, reason: 'socket-drop' })

    await expect(result).resolves.toEqual({ ok: false, outcome: 'connection-lost' })
  })

  it('resolves connection-lost on a relay-link-down and on a driver error', async () => {
    const first = await connected()
    const a = upload(first.connection)
    await drain()
    first.drivers[0].emit({ type: 'relay-link-down', code: 1006 })
    await expect(a).resolves.toEqual({ ok: false, outcome: 'connection-lost' })

    const second = await connected()
    const b = upload(second.connection)
    await drain()
    second.drivers[0].emit({ type: 'error', reason: 'transport-decrypt-failed' })
    await expect(b).resolves.toEqual({ ok: false, outcome: 'connection-lost' })
  })

  it('resolves connection-lost on a re-dial, so recycled envelope ids cannot mis-correlate', async () => {
    const { connection, drivers } = await connected()

    const result = upload(connection)
    await drain()
    connection.reconnect()

    await expect(result).resolves.toEqual({ ok: false, outcome: 'connection-lost' })
  })

  it('resolves send-failed when the session refuses a chunk', async () => {
    const ctx = build({ throwOnSend: true })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    await expect(upload(ctx.connection)).resolves.toEqual({
      ok: false,
      outcome: 'send-failed'
    })
  })

  it('drops a success naming a transfer it never started', async () => {
    const { connection, sink, drivers } = await connected()

    const result = upload(connection, 'att-mine')
    await drain()
    const before = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: encodeEnvelope({
        id: 900,
        type: 'attachment_stored',
        ts: FIXED_TS,
        in_reply_to: decodeEnvelope(drivers[0].sent[1]).id,
        payload: { attachment_id: 'att-someone-elses' }
      })
    })

    // Nothing emitted, and the real transfer is still open — proven by resolving it afterwards.
    expect(emitted(sink).slice(before)).toEqual([])
    answer(drivers[0], attachmentStoredReplyFrames(1))
    await expect(result).resolves.toEqual({ ok: true })
  })

  it('resolves two concurrent transfers each on its own reply', async () => {
    const { connection, drivers } = await connected()

    const first = upload(connection, 'att-a')
    await drain()
    const firstChunkIds = new Set(chunksSent(drivers[0]).map((envelope) => envelope.id))
    const second = upload(connection, 'att-b')
    await drain()

    // The success is keyed on the attachment id, so it settles `att-b` even though every envelope
    // it could name belongs to a transfer that is also live.
    answer(drivers[0], (plaintext) => {
      const envelope = decodeEnvelope(plaintext)
      if (envelope.type !== 'attachment_chunk') return []
      const payload = envelope.payload as AttachmentChunkPayload
      return payload.attachment_id === 'att-b' && payload.index === 0
        ? attachmentStoredReplyFrames(0)(plaintext)
        : []
    })
    await expect(second).resolves.toEqual({ ok: true })

    // The reject is keyed on the envelope id, so it settles only the transfer that minted it.
    drivers[0].emit({
      type: 'message',
      plaintext: encodeEnvelope({
        id: 901,
        type: 'error',
        ts: FIXED_TS,
        in_reply_to: [...firstChunkIds][0],
        payload: { code: 'attachment.storage_failed', message: 'nope', retryable: true }
      })
    })
    await expect(first).resolves.toEqual({
      ok: false,
      outcome: 'attachment-storage-failed'
    })
  })

  it('consumes the correlated reject entirely — no bundle failure, no modal-FIFO shift', async () => {
    const { connection, sink, drivers } = await connected()

    const bundle: BundleFailReason[] = []
    connection.requestDebugBundle({
      complete: () => {},
      fail: (reason) => void bundle.push(reason)
    })
    connection.answerModal({ modal_id: 'modal-1', option_id: 'allow' })

    const result = upload(connection)
    await drain()
    const before = emitted(sink).length
    answer(drivers[0], attachmentRejectReplyFrames(0, 'attachment.invalid_chunk'))

    await expect(result).resolves.toEqual({
      ok: false,
      outcome: 'attachment-invalid-chunk'
    })
    expect(bundle).toEqual([])
    expect(emitted(sink).slice(before)).toEqual([])
  })

  // #864: the hop itself. The transfer reports and the flow module decides; this proves the middle
  // passes the figure through unchanged and stops reporting when the daemon's answer settles it.
  it('forwards the chunk count to a progress listener and stops at the stored answer', async () => {
    const { connection, drivers } = await connected()
    const reports: Array<[number, number]> = []

    const result = connection.uploadAttachment(
      { conversation_id: 'conv-1', attachment_id: 'att-1', filename: 'notes.txt', mime_type: 'text/plain', bytes: FILE },
      (sent, total) => void reports.push([sent, total])
    )
    await drain()
    // The daemon answers the chunk whose ARRIVAL completed the transfer — index 2 here — which is the
    // success key this leg correlates on.
    answer(drivers[0], attachmentStoredReplyFrames(2))
    await expect(result).resolves.toEqual({ ok: true })

    expect(reports).toEqual([
      [1, 3],
      [2, 3],
      [3, 3]
    ])
  })

  it('reports no progress at all when there is no live session to send on', async () => {
    // The not-connected early return resolves before a transfer exists, so there is nothing to report
    // and the composer never shows a line for an upload that never started.
    const { connection } = build()
    const reports: number[] = []

    await expect(
      connection.uploadAttachment(
        { conversation_id: 'conv-1', attachment_id: 'att-1', filename: 'notes.txt', mime_type: 'text/plain', bytes: FILE },
        (sent) => void reports.push(sent)
      )
    ).resolves.toEqual({ ok: false, outcome: 'not-connected' })
    expect(reports).toEqual([])
  })

  it('logs the transfer content-free — no filename, mime type or attachment id in any record', async () => {
    const captured = captureLog()
    const ctx = build({ diagnosticLog: captured.log })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })

    const result = ctx.connection.uploadAttachment({
      conversation_id: 'conv-1',
      attachment_id: 'att-secret-9f2b',
      filename: 'quarterly-severance-list.xlsx',
      mime_type: 'application/vnd.ms-excel',
      bytes: FILE
    })
    await drain()
    answer(ctx.drivers[0], attachmentStoredReplyFrames(2))
    await result

    const uploads = captured.records.filter((record) => record.event === 'attachment-upload')
    expect(uploads.length).toBeGreaterThan(0)
    for (const record of captured.records) {
      const line = JSON.stringify(record)
      expect(line).not.toContain('quarterly-severance-list')
      expect(line).not.toContain('vnd.ms-excel')
      expect(line).not.toContain('att-secret-9f2b')
      expect(line).not.toContain(Buffer.from(FILE.subarray(0, 24)).toString('base64'))
    }
  })
})

// ============================================================================================
// #996 — the RETRIEVAL leg: request_attachment, correlation by Envelope.in_reply_to, the idle
// deadline, and the teardown net. The mirror image of the upload block above, and the arm that
// finally drives #995's reassembler and #998's decoded chunks from a live session.
// ============================================================================================

/** A fake scheduler for the retrieval idle deadline — relaySupervisor.test.ts's fakeScheduler,
 *  restated for the seam daemonConnection now accepts. */
interface FakeRetrievalTimer {
  fn: () => void
  ms: number
  cancelled: boolean
  fired: boolean
}

function fakeRetrievalScheduler(): {
  timing: NonNullable<DaemonConnectionDeps['timing']>
  pending: () => FakeRetrievalTimer[]
  fireNext: () => void
  fireAll: () => void
  timers: FakeRetrievalTimer[]
} {
  const timers: FakeRetrievalTimer[] = []
  return {
    timers,
    timing: {
      setTimer(fn: () => void, ms: number) {
        const timer: FakeRetrievalTimer = { fn, ms, cancelled: false, fired: false }
        timers.push(timer)
        return timer as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer(handle) {
        ;(handle as unknown as FakeRetrievalTimer).cancelled = true
      }
    },
    pending() {
      return timers.filter((t) => !t.cancelled && !t.fired)
    },
    fireNext() {
      const next = timers.find((t) => !t.cancelled && !t.fired)
      if (!next) throw new Error('no pending retrieval timer to fire')
      next.fired = true
      next.fn()
    },
    fireAll() {
      for (const t of timers) {
        if (!t.cancelled && !t.fired) {
          t.fired = true
          t.fn()
        }
      }
    }
  }
}

/** Reach the connected window with an injected retrieval scheduler. `build`'s `reachConnected`
 *  twin — the retrieval tests need the timer seam that one does not thread. */
async function reachConnectedWithTimers(
  timing: NonNullable<DaemonConnectionDeps['timing']>
): Promise<ReturnType<typeof build>> {
  const ctx = build({ timing })
  ctx.connection.start()
  await tick()
  ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
  return ctx
}

/** A spy AttachmentRetrievalConsumer recording the single terminal (complete XOR fail). */
function makeRetrievalConsumer(): {
  consumer: AttachmentRetrievalConsumer
  completed: Uint8Array[]
  failed: AttachmentRetrievalFailure[]
  terminals: () => number
} {
  const completed: Uint8Array[] = []
  const failed: AttachmentRetrievalFailure[] = []
  return {
    completed,
    failed,
    terminals: () => completed.length + failed.length,
    consumer: {
      complete: (bytes) => completed.push(bytes),
      fail: (reason) => failed.push(reason)
    }
  }
}

const RETRIEVED_CONVERSATION = 'b19c6a4e-2f70-4d51-9a3c-8e2d5f01c7ab'
const RETRIEVED_ID = 'd41d8cd9-8f00-4204-a980-0998ecf8427e'

/** One retrieval-leg `attachment_chunk` plaintext. `inReplyTo` rides the ENVELOPE — the only
 *  handle a client can correlate a retrieval on, since the payload carries no request id. */
function retrievalChunkPlaintext(
  inReplyTo: number,
  chunk: {
    attachment_id: string
    index: number
    total_chunks: number
    size: number
    sha256: string
    data: Uint8Array
    filename?: string
    mime_type?: string
  }
): Uint8Array {
  return encodeEnvelope({
    id: 9001,
    type: 'attachment_chunk',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      attachment_id: chunk.attachment_id,
      index: chunk.index,
      total_chunks: chunk.total_chunks,
      filename: chunk.filename ?? 'notes.txt',
      mime_type: chunk.mime_type ?? 'text/plain',
      size: chunk.size,
      sha256: chunk.sha256,
      data: base64StdEncode(chunk.data)
    }
  })
}

/** A daemon `error` reply carrying a specific code, correlated by envelope id. */
function codedErrorPlaintext(code: string, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 9002,
    type: 'error',
    ts: FIXED_TS,
    payload: { code, message: 'daemon prose that must never surface', retryable: false },
    ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})
  })
}

/** The whole-file digest the reassembler verifies against, lowercase hex over the WHOLE file. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A one-chunk transfer's frame for `bytes`, correlated to `inReplyTo`. */
function wholeFileChunk(inReplyTo: number, attachmentId: string, bytes: Uint8Array): Uint8Array {
  return retrievalChunkPlaintext(inReplyTo, {
    attachment_id: attachmentId,
    index: 0,
    total_chunks: 1,
    size: bytes.length,
    sha256: sha256Hex(bytes),
    data: bytes
  })
}

/** The envelope id of the single `request_attachment` a driver has been handed. */
function requestAttachmentEnvelopeId(driver: FakeDriver, nth = 0): number {
  const frames = driver.sent
    .map((bytes) => decodeEnvelope(bytes))
    .filter((envelope) => envelope.type === 'request_attachment')
  return frames[nth].id
}

describe('requestAttachment (#996)', () => {
  it('fails the consumer not-connected before start, sending nothing', () => {
    const { connection, drivers } = build()
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )

    // The requestDebugBundle posture: a call that owns a waiting caller must never be a silent
    // no-op. Synchronous, so a caller cannot observe a pending state that never settles.
    expect(spy.failed).toEqual(['not-connected'])
    expect(drivers).toHaveLength(0)
  })

  it('sends a request_attachment carrying exactly the two ids', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )

    const frames = drivers[0].sent.map((bytes) => decodeEnvelope(bytes))
    const request = frames.find((envelope) => envelope.type === 'request_attachment')
    expect(request).toBeDefined()
    // Two fields and no third: the payload carries no request id, correlation rides the envelope.
    expect(request?.payload).toEqual({
      conversation_id: RETRIEVED_CONVERSATION,
      attachment_id: RETRIEVED_ID
    })
    expect(spy.terminals()).toBe(0)
  })

  it('settles send-failed and registers nothing when the ask cannot be put on the wire', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()
    const bundle = makeBundleConsumer()
    // Over MAX_PLAINTEXT_BYTES once serialized, so buildRequestAttachment throws. The IPC guard bounds
    // this class one layer out; requestAttachment owes its own terminal because it is reachable from
    // any main-side caller, and a build that throws must not leave the caller waiting.
    const oversized = 'a'.repeat(70_000)

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: oversized },
      spy.consumer
    )

    // Synchronous and honest: the frame never left the machine, so this is neither a lost session
    // (`connection-lost`) nor a stream that stopped (`timed-out`, 30 s later).
    expect(spy.failed).toEqual(['send-failed'])
    const sentTypes = drivers[0].sent.map((bytes) => decodeEnvelope(bytes).type)
    expect(sentTypes).not.toContain('request_attachment')
    // Nothing was armed: no deadline, and no entry under the id the dropped build did not spend.
    expect(scheduler.pending()).toHaveLength(0)

    // That unspent id is re-minted by the NEXT outbound envelope. Its reject must reach the paths
    // below the correlation tier — a phantom entry would swallow it, settling this already-settled
    // retrieval a second time and starving the bundle net of the frame it was owed.
    connection.requestDebugBundle(bundle.consumer)
    const bundleId = drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .filter((envelope) => envelope.type === 'request_debug_bundle')[0].id
    drivers[0].emit({
      type: 'message',
      plaintext: codedErrorPlaintext('attachment.not_found', bundleId)
    })

    expect(spy.terminals()).toBe(1)
    expect(bundle.failed).toEqual(['daemon-error'])
  })

  it('arms the idle deadline at send and clears it on the terminal', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()
    const file = new Uint8Array([1, 2, 3, 4, 5])

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    expect(scheduler.pending()).toHaveLength(1)
    expect(scheduler.pending()[0].ms).toBe(30_000)

    const id = requestAttachmentEnvelopeId(drivers[0])
    drivers[0].emit({ type: 'message', plaintext: wholeFileChunk(id, RETRIEVED_ID, file) })

    expect(spy.completed).toHaveLength(1)
    expect(Array.from(spy.completed[0])).toEqual([1, 2, 3, 4, 5])
    // Cleared at the settle choke point, so a later fire cannot produce a second terminal.
    expect(scheduler.pending()).toHaveLength(0)
    scheduler.fireAll()
    expect(spy.terminals()).toBe(1)
  })

  it('routes each retrieval by in_reply_to and never cross-feeds two live transfers', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const first = makeRetrievalConsumer()
    const second = makeRetrievalConsumer()
    const otherId = '11112222-3333-4444-8555-666677778888'

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      first.consumer
    )
    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: otherId },
      second.consumer
    )
    const firstEnvelope = requestAttachmentEnvelopeId(drivers[0], 0)
    const secondEnvelope = requestAttachmentEnvelopeId(drivers[0], 1)
    expect(firstEnvelope).not.toBe(secondEnvelope)

    drivers[0].emit({
      type: 'message',
      plaintext: wholeFileChunk(secondEnvelope, otherId, new Uint8Array([9, 9]))
    })
    // The second answered; the first is untouched and still waiting.
    expect(second.completed).toHaveLength(1)
    expect(Array.from(second.completed[0])).toEqual([9, 9])
    expect(first.terminals()).toBe(0)

    drivers[0].emit({
      type: 'message',
      plaintext: wholeFileChunk(firstEnvelope, RETRIEVED_ID, new Uint8Array([7]))
    })
    expect(Array.from(first.completed[0])).toEqual([7])
  })

  it('refuses a chunk answering this request while naming another transfer', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(drivers[0])
    // The right ask, the wrong bytes — the failure only the payload id catches.
    drivers[0].emit({
      type: 'message',
      plaintext: wholeFileChunk(id, 'aaaabbbb-cccc-4ddd-8eee-ffff00001111', new Uint8Array([1]))
    })

    expect(spy.failed).toEqual(['stream-contradiction'])
  })

  it('drops a chunk whose in_reply_to matches no live retrieval', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    drivers[0].emit({
      type: 'message',
      plaintext: wholeFileChunk(4242, RETRIEVED_ID, new Uint8Array([1]))
    })

    expect(spy.terminals()).toBe(0)
  })

  it('fails the waiting retrieval not-found on the published reject code', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers, sink } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(drivers[0])
    drivers[0].emit({ type: 'message', plaintext: codedErrorPlaintext('attachment.not_found', id) })

    expect(spy.failed).toEqual(['not-found'])
    // The reject consumes the frame entirely — no daemon-event rides out of the correlated arm.
    expect(emitted(sink).some((event) => event.type === 'failed')).toBe(false)
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('fails stream-aborted through the reassembler, discarding everything accumulated', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()
    // Two chunks: 45000 raw bytes is the mandated stride, so 45001 declares total_chunks 2.
    const whole = new Uint8Array(45_001).fill(3)
    const digest = sha256Hex(whole)

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(drivers[0])
    drivers[0].emit({
      type: 'message',
      plaintext: retrievalChunkPlaintext(id, {
        attachment_id: RETRIEVED_ID,
        index: 0,
        total_chunks: 2,
        size: whole.length,
        sha256: digest,
        data: whole.subarray(0, 45_000)
      })
    })
    expect(spy.terminals()).toBe(0)

    drivers[0].emit({
      type: 'message',
      plaintext: codedErrorPlaintext('attachment.stream_aborted', id)
    })
    expect(spy.failed).toEqual(['stream-aborted'])

    // The partial bytes are gone, not held for a completing chunk: the closing chunk arriving after
    // the abort produces NOTHING, where an undiscarded accumulator would complete the file.
    drivers[0].emit({
      type: 'message',
      plaintext: retrievalChunkPlaintext(id, {
        attachment_id: RETRIEVED_ID,
        index: 1,
        total_chunks: 2,
        size: whole.length,
        sha256: digest,
        data: whole.subarray(45_000)
      })
    })
    expect(spy.completed).toHaveLength(0)
    expect(spy.terminals()).toBe(1)
  })

  it('fails daemon-error on a code that does not conformingly answer this verb', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(drivers[0])
    drivers[0].emit({ type: 'message', plaintext: codedErrorPlaintext('attachment.too_large', id) })

    // Reported honestly rather than coerced into a not-found that did not happen.
    expect(spy.failed).toEqual(['daemon-error'])
  })

  it('leaves an uncorrelated error on its existing path, failing no retrieval', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers, sink } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()
    const bundle = makeBundleConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    connection.requestDebugBundle(bundle.consumer)
    // No in_reply_to at all: it correlates to nothing and must fall through to the bundle net.
    drivers[0].emit({ type: 'message', plaintext: errorPlaintext() })

    expect(spy.terminals()).toBe(0)
    expect(bundle.failed).toEqual(['daemon-error'])
    expect(emitted(sink)).toBeDefined()
  })

  it('fires timed-out when the stream stops with no terminal frame', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()
    const whole = new Uint8Array(45_001).fill(4)

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(drivers[0])
    drivers[0].emit({
      type: 'message',
      plaintext: retrievalChunkPlaintext(id, {
        attachment_id: RETRIEVED_ID,
        index: 0,
        total_chunks: 2,
        size: whole.length,
        sha256: sha256Hex(whole),
        data: whole.subarray(0, 45_000)
      })
    })
    // The chunk RESET the deadline rather than leaving the original armed: a long legitimate
    // transfer must not be killed for taking long, only for going silent.
    expect(scheduler.pending()).toHaveLength(1)
    expect(scheduler.timers.filter((t) => t.cancelled)).toHaveLength(1)

    scheduler.fireNext()
    expect(spy.failed).toEqual(['timed-out'])

    // The entry is gone, so a late chunk answering it settles nothing a second time.
    drivers[0].emit({
      type: 'message',
      plaintext: retrievalChunkPlaintext(id, {
        attachment_id: RETRIEVED_ID,
        index: 1,
        total_chunks: 2,
        size: whole.length,
        sha256: sha256Hex(whole),
        data: whole.subarray(45_000)
      })
    })
    expect(spy.terminals()).toBe(1)
  })

  it.each([
    ['terminal', { type: 'terminal', code: 1006, reason: 'abnormal' }],
    ['error', { type: 'error', reason: 'handshake-failed' }],
    ['relay-link-down', { type: 'relay-link-down', code: 1006 }]
  ] as const)('fails every retrieval in flight connection-lost on %s', async (_name, event) => {
    const scheduler = fakeRetrievalScheduler()
    const { connection, drivers } = await reachConnectedWithTimers(scheduler.timing)
    const first = makeRetrievalConsumer()
    const second = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      first.consumer
    )
    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: '22223333-4444-4555-8666-777788889999' },
      second.consumer
    )

    drivers[0].emit(event as RelaySessionEvent)

    expect(first.failed).toEqual(['connection-lost'])
    expect(second.failed).toEqual(['connection-lost'])
    // Every deadline is cleared with the map, so nothing can fire into an abandoned retrieval.
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('fails retrievals in flight when a re-dial abandons the session', async () => {
    const scheduler = fakeRetrievalScheduler()
    const { connection } = await reachConnectedWithTimers(scheduler.timing)
    const spy = makeRetrievalConsumer()

    connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    // dial() resets nextEnvelopeId to 2, so the retrieval must be failed BEFORE ids recycle or a
    // stale envelope id could correlate an answer on the reconnected session.
    connection.reconnect()

    expect(spy.failed).toEqual(['connection-lost'])
    expect(scheduler.pending()).toHaveLength(0)
  })

  it('logs nothing that carries an identifier, a byte count or a digest', async () => {
    const captured = captureLog()
    const scheduler = fakeRetrievalScheduler()
    const ctx = build({ diagnosticLog: captured.log, timing: scheduler.timing })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    const spy = makeRetrievalConsumer()

    ctx.connection.requestAttachment(
      { conversation_id: RETRIEVED_CONVERSATION, attachment_id: RETRIEVED_ID },
      spy.consumer
    )
    const id = requestAttachmentEnvelopeId(ctx.drivers[0])
    ctx.drivers[0].emit({
      type: 'message',
      plaintext: wholeFileChunk(id, RETRIEVED_ID, new Uint8Array([8, 8, 8]))
    })

    for (const record of captured.records) {
      const line = JSON.stringify(record)
      expect(line).not.toContain(RETRIEVED_ID)
      expect(line).not.toContain(RETRIEVED_CONVERSATION)
      expect(line).not.toContain(sha256Hex(new Uint8Array([8, 8, 8])))
    }
  })
})

// --- #1068 — server origin -------------------------------------------------------------------
// The connection is bound to one server at CONSTRUCTION and stamps every event it emits with that
// id, so a renderer holding several live connections (#1084) can tell their events apart. These are
// the only tests in this file that read the raw channel payloads; every other assertion reads through
// `emitted()`, which projects the stamp away.
describe('daemonConnection — server origin (#1068)', () => {
  it('stamps the injected id onto every event the connection emits', async () => {
    // Across a whole dial, so the pre-record event (`connecting`), the handshake terminal and an
    // inbound frame are all covered — the id is bound at construction, so none of them can miss it.
    const ctx = build({ serverId: 'srv-a' })
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    ctx.drivers[0].emit({
      type: 'message',
      plaintext: messagePlaintext({
        conversation_id: 'c1',
        message_id: 'm1',
        role: 'assistant',
        text: 'hi'
      })
    })

    const events = stampedEvents(ctx.sink)
    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(events.map((e) => e.serverId)).toEqual(events.map(() => 'srv-a'))
    // The stamp rides ALONGSIDE the event, never in place of it.
    expect(events[0]).toEqual({ type: 'connecting', serverId: 'srv-a' })
    expect(events.some((e) => e.type === 'connected')).toBe(true)
  })

  it('makes two connections with different ids distinguishable by the field alone (AC3)', async () => {
    // Same event, same shape, two servers: `serverId` is the only thing that separates them.
    const a = build({ serverId: 'srv-a' })
    const b = build({ serverId: 'srv-b' })
    a.connection.start()
    b.connection.start()
    await tick()

    const [first] = stampedEvents(a.sink)
    const [second] = stampedEvents(b.sink)
    expect(first).toEqual({ type: 'connecting', serverId: 'srv-a' })
    expect(second).toEqual({ type: 'connecting', serverId: 'srv-b' })
    const { serverId: _a, ...firstEvent } = first
    const { serverId: _b, ...secondEvent } = second
    expect(firstEvent).toEqual(secondEvent)
  })

  it('stamps a null binding as a present null, on the not-paired terminal too', async () => {
    // What production emits today, and the two events the ticket calls out as origin-free even after
    // #1084 would have a record to read: `connecting` fires before any load, and failed(not-paired)
    // has no record at all. Both still carry the field — as a PRESENT null, never an absent property.
    const ctx = build({ serverId: null, load: () => Promise.resolve(null) })
    ctx.connection.start()
    await tick()

    const events = stampedEvents(ctx.sink)
    expect(events[0]).toEqual({ type: 'connecting', serverId: null })
    expect(events[1].type).toBe('failed')
    for (const event of events) {
      expect('serverId' in event).toBe(true)
      expect(event.serverId).toBeNull()
    }
  })

  it('keeps the id out of every emit call site — a re-pair mid-session cannot change it', async () => {
    // The binding is a construction dependency, not an emit-time read of the paired record: the
    // record loads per dial, AFTER the first event. Reconnecting re-reads the record and must not
    // re-attribute anything, which is why the composition root passes null for a connection that
    // outlives a re-pair.
    const ctx = build({ serverId: 'srv-a' })
    ctx.connection.start()
    await tick()
    ctx.connection.reconnect()
    await tick()
    ctx.drivers[ctx.drivers.length - 1].emit({
      type: 'handshake-complete',
      helloAck: validHelloAck()
    })

    const ids = new Set(stampedEvents(ctx.sink).map((e) => e.serverId))
    expect([...ids]).toEqual(['srv-a'])
  })
})

// A COMPILE-TIME drift guard between the two mirrored history-event unions (#1227), not a runtime test.
// `DecodedHistoryEvent` (src/main/transport/inboundMessage.ts) and `HistoryTimelineEvent`
// (src/shared/ipc/events.ts) are declared separately because the transport directory is IPC-free by
// construction, so nothing but structural assignability keeps them in agreement. The emit in
// daemonConnection.ts already checks one direction; this checks the OTHER, so an arm or a required field
// added on either side alone is a typecheck failure (`npm run typecheck` covers src/main/**, this file
// included) rather than a silent divergence. Residual gap, stated rather than papered over: an added
// OPTIONAL field on one side alone still passes both.
type MirrorsIpcEvent = HistoryTimelineEvent extends DecodedHistoryEvent ? true : never
type MirrorsTransportEvent = DecodedHistoryEvent extends HistoryTimelineEvent ? true : never
const _historyEventMirrorsBothWays: [MirrorsIpcEvent, MirrorsTransportEvent] = [true, true]
void _historyEventMirrorsBothWays

describe('createDaemonConnection — requestHistory (history page request/reply, #1222)', () => {
  /** The conversation the request names, and therefore the one the reply describes. */
  const CONV = 'conv-hist'
  /** A daemon-minted opaque cursor — the committed example, kept intact so a "tidying" rewrite shows. */
  const CURSOR = 'MS4zZjhiMWMwNC05ZDI3LTRlNWEtYjZjMS0yZTlmNzBkOGE0MTMuNy40MDk2'

  /** One stored entry, as served. Its payload carries `conversation_id` since #1227 — every live-lane
   *  parser requires it, so an entry without one is skipped at the decode and this fixture would stand
   *  for an empty page. The value is deliberately NOT `CONV`: it is daemon-asserted, and pinning a
   *  DIFFERENT id here is what proves it never reaches the event beside the correlation-resolved one. */
  const ENTRY = {
    id: 412,
    type: 'assistant_delta',
    payload: {
      conversation_id: 'a-different-conversation',
      turn_id: 't1',
      seq: 3,
      text: 'stored assistant text'
    },
    ts: FIXED_TS
  }
  /** What ENTRY decodes to (#1227): the entry's own id and ts, the typed event, no conversation id. */
  const DECODED_ENTRY: HistoryTimelineEntry = {
    id: 412,
    ts: FIXED_TS,
    event: { type: 'assistantDelta', turnId: 't1', seq: 3, text: 'stored assistant text' }
  }
  const PAGE = { entries: [ENTRY], cursor: CURSOR, at_start: false }

  /** A `history_page` envelope's plaintext. Correlation-gated like its session_settings sibling, so
   *  `inReplyTo` is spelled `number | undefined` rather than optional — omitting it is the deliberate
   *  no-correlation branch and should read as a choice at the call site. */
  function historyPagePlaintext(payload: unknown, inReplyTo: number | undefined): Uint8Array {
    return encodeEnvelope({ id: 812, type: 'history_page', ts: FIXED_TS, in_reply_to: inReplyTo, payload })
  }

  /** An `error` envelope's plaintext carrying one reject code. */
  function rejectPlaintext(code: string, inReplyTo: number | undefined): Uint8Array {
    return encodeEnvelope({
      id: 900,
      type: 'error',
      ts: FIXED_TS,
      in_reply_to: inReplyTo,
      payload: { code, message: 'static daemon text that must never cross', retryable: true }
    })
  }

  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The envelope id of the LAST request_history this connection put on the wire. */
  function lastRequestId(ctx: ReturnType<typeof build>): number {
    const requests = ctx.drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .filter((e) => e.type === 'request_history')
    return requests[requests.length - 1].id
  }

  /**
   * Connected, with one outstanding request_history naming `conversationId` — the correlation every
   * reply below must match. Its envelope id is read off the frame ACTUALLY SENT rather than assumed,
   * so a change to the client's numbering cannot silently make every reply here
   * uncorrelatable-and-therefore-dropped while the assertions still read as if the gate were exercised.
   */
  async function requested(
    conversationId: string = CONV
  ): Promise<ReturnType<typeof build> & { replyTo: number }> {
    const ctx = await connected()
    ctx.connection.requestHistory({ conversation_id: conversationId, cursor: '', limit: 50 })
    return { ...ctx, replyTo: lastRequestId(ctx) }
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers } = build()
    expect(() =>
      connection.requestHistory({ conversation_id: CONV, cursor: '', limit: 50 })
    ).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends a request_history frame carrying all three fields', async () => {
    const { connection, drivers } = await connected()

    connection.requestHistory({ conversation_id: CONV, cursor: CURSOR, limit: 50 })

    const request = drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .find((e) => e.type === 'request_history')
    // Asserted as an exact payload against values distinct from every other string on the envelope, so
    // forwarding the wrong field cannot pass — and the cursor crosses byte for byte.
    expect(request?.payload).toEqual({ conversation_id: CONV, cursor: CURSOR, limit: 50 })
  })

  it('shares the one envelope-id counter with send (no second counter)', async () => {
    const { connection, drivers } = await connected()

    connection.send({ conversation_id: 'c1', message_id: 'm1', text: 'hi' })
    connection.requestHistory({ conversation_id: CONV, cursor: '', limit: 0 })

    expect(decodeEnvelope(drivers[0].sent[0]).id).toBe(2)
    expect(decodeEnvelope(drivers[0].sent[1]).id).toBe(3)
  })

  it('decodes a correlated history_page into historyPageReceived, attributed to the ASKED conversation', async () => {
    // The page names no conversation. What crosses is the id THIS CLIENT put in its own outbound
    // frame, resolved from the envelope the page answers — the only place that fact exists.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([
      {
        type: 'historyPageReceived',
        conversationId: CONV,
        entries: [DECODED_ENTRY],
        cursor: CURSOR,
        atStart: false
      }
    ])
  })

  it('lets no entry carry the payload conversation_id beside the correlated one (#1227)', async () => {
    // The one value that could contradict the correlation. ENTRY's payload names a DIFFERENT
    // conversation, so a consumer handed both would have a routing decision it must never be given —
    // and the whole point of #1222's correlation is that there is only one id to route by.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })

    const event = emitted(sink).find((e) => e.type === 'historyPageReceived')
    expect(JSON.stringify(event)).not.toContain('a-different-conversation')
    expect(JSON.stringify(event)).not.toContain('conversation_id')
  })

  it('settles the ask with an EMPTY page when every entry was skipped (#1227)', async () => {
    // A page of undrawn and malformed entries still emits. Dropping it would stall #1224's walk with
    // no terminal and no way to step past the entries this client cannot draw, so `cursor`/`atStart`
    // must arrive as served even when nothing survived the decode.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: historyPagePlaintext(
        {
          entries: [
            { id: 1, type: 'model_announced', payload: { conversation_id: CONV }, ts: FIXED_TS },
            { id: 2, type: 'assistant_delta', payload: {}, ts: FIXED_TS }
          ],
          cursor: CURSOR,
          at_start: false
        },
        replyTo
      )
    })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([
      { type: 'historyPageReceived', conversationId: CONV, entries: [], cursor: CURSOR, atStart: false }
    ])
  })

  it('carries at_start across as camelCase atStart, and no snake key', async () => {
    // Asserting the ABSENCE of the snake key is what proves the emit is a named copy rather than a
    // spread of the decoded payload — a spread would carry both spellings.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: historyPagePlaintext({ entries: [], cursor: '', at_start: true }, replyTo)
    })

    const event = emitted(sink).find((e) => e.type === 'historyPageReceived')
    expect(event).toBeDefined()
    expect(event).not.toHaveProperty('at_start')
    expect(event && 'atStart' in event && event.atStart).toBe(true)
  })

  it('never places the wire routing id on the event', async () => {
    // The window receives the id it supplied, never the numeric in_reply_to the match was made on.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })

    const event = emitted(sink).find((e) => e.type === 'historyPageReceived')
    expect(event).not.toHaveProperty('inReplyTo')
    expect(event).not.toHaveProperty('in_reply_to')
  })

  it('carries a terminal page as sent, normalising nothing into an end-of-log flag', async () => {
    // at_start is the ONLY termination signal, and a short or empty page says nothing on its own. A
    // decoder or consumer that inferred one from the other would break the walk exactly at the
    // boundary it exists to find.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: historyPagePlaintext({ entries: [ENTRY], cursor: '', at_start: true }, replyTo)
    })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([
      {
        type: 'historyPageReceived',
        conversationId: CONV,
        entries: [DECODED_ENTRY],
        cursor: '',
        atStart: true
      }
    ])
  })

  it('drops a page whose in_reply_to matches no outstanding ask', async () => {
    // A stale reply from a cleared connection, a duplicate, or a hostile daemon forging a page for a
    // request this client never sent. The drop is TOTAL rather than "emit without the id": the window
    // would otherwise have to guess a conversation, and a guess writes someone else's transcript into
    // the open one.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo + 999) })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([])
  })

  it('drops a page carrying no in_reply_to at all', async () => {
    const { sink, drivers } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, undefined) })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([])
  })

  it('drops a SECOND page replayed under an id already matched', async () => {
    // The entry is deleted on the match, so a replayed page has nothing to correlate against. This is
    // the assertion that would redden if the delete were dropped.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })
    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toHaveLength(1)
  })

  it('attributes two interleaved asks to their OWN conversations', async () => {
    // The whole point of keying by envelope id rather than by a single slot: a walk may have more than
    // one ask outstanding, and a page must never land on the wrong conversation.
    const ctx = await connected()
    ctx.connection.requestHistory({ conversation_id: 'conv-first', cursor: '', limit: 10 })
    const firstId = lastRequestId(ctx)
    ctx.connection.requestHistory({ conversation_id: 'conv-second', cursor: '', limit: 10 })
    const secondId = lastRequestId(ctx)

    // Answered out of order, which is the case a FIFO would get wrong.
    ctx.drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, secondId) })
    ctx.drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, firstId) })

    expect(
      emitted(ctx.sink)
        .filter((e) => e.type === 'historyPageReceived')
        .map((e) => (e.type === 'historyPageReceived' ? e.conversationId : null))
    ).toEqual(['conv-second', 'conv-first'])
  })

  it.each([
    ['conversation.not_found', 'conversation-not-found', false],
    ['history.invalid_request', 'history-invalid-request', false],
    ['history.invalid_page_size', 'history-invalid-page-size', false],
    ['history.invalid_cursor', 'history-invalid-cursor', false],
    ['history.unavailable', 'history-unavailable', true]
  ])('surfaces %s as a typed failure (retryable: %s)', async (code, reason, retryable) => {
    // The daemon's own `retryable: true` rides EVERY fixture above, so a passthrough of the wire flag
    // would make all five retryable and this table is what catches it. The flag is computed from the
    // closed set at the single emit instead.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: rejectPlaintext(code, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'historyRequestFailed')).toEqual([
      { type: 'historyRequestFailed', conversationId: CONV, reason, retryable }
    ])
  })

  it('surfaces a correlated code outside the five as unclassified, still settling the ask', async () => {
    // `message.too_long` is the published case: an entry too large to fit in any page is emitted
    // anyway and the daemon's own transport answers with it. A walk that dropped it would stall with
    // no terminal and no cursor to step past the entry.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: rejectPlaintext('message.too_long', replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'historyRequestFailed')).toEqual([
      { type: 'historyRequestFailed', conversationId: CONV, reason: 'unclassified', retryable: false }
    ])
  })

  it('carries no daemon text on the failure — only client-owned values', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: rejectPlaintext('history.invalid_cursor', replyTo) })

    const event = emitted(sink).find((e) => e.type === 'historyRequestFailed')
    expect(Object.keys(event ?? {}).sort()).toEqual(['conversationId', 'reason', 'retryable', 'type'])
    expect(JSON.stringify(event)).not.toContain('static daemon text')
    // Nor the cursor, which the daemon's own rejects deliberately never echo.
    expect(JSON.stringify(event)).not.toContain(CURSOR)
  })

  it('drops a reject whose in_reply_to matches no outstanding ask', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: rejectPlaintext('history.unavailable', replyTo + 999) })

    expect(emitted(sink).filter((e) => e.type === 'historyRequestFailed')).toEqual([])
  })

  it('settles the ask on a reject, so a later page under the same id is dropped', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({ type: 'message', plaintext: rejectPlaintext('history.unavailable', replyTo) })
    drivers[0].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, replyTo) })

    expect(emitted(sink).filter((e) => e.type === 'historyPageReceived')).toEqual([])
  })

  it('clears outstanding asks on reconnect, so a stale id cannot correlate on the new connection', async () => {
    // The fresh connection recycles envelope ids from 2, so a surviving entry would attribute the new
    // connection's first page to the dead one's conversation — a live misdelivery, not a theoretical one.
    const ctx = await requested()
    const staleId = ctx.replyTo

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    ctx.drivers[1].emit({ type: 'message', plaintext: historyPagePlaintext(PAGE, staleId) })

    expect(emitted(ctx.sink).filter((e) => e.type === 'historyPageReceived')).toEqual([])
  })
})

describe('createDaemonConnection — requestSystemPrompt + the correlated reply (#1230)', () => {
  const CONV = 'conv-prompt'

  /** A `system_prompt` reply's plaintext, `null` OMITTING the correlation key (a sentinel rather than
   *  `undefined`, which a default parameter would swallow). */
  function systemPromptPlaintext(payload: unknown, inReplyTo: number | null): Uint8Array {
    return encodeEnvelope({
      id: 51,
      type: 'system_prompt',
      ts: FIXED_TS,
      ...(inReplyTo === null ? {} : { in_reply_to: inReplyTo }),
      payload
    })
  }

  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** The envelope id of the LAST request_system_prompt this connection put on the wire. */
  function lastRequestId(ctx: ReturnType<typeof build>): number {
    const requests = ctx.drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .filter((e) => e.type === 'request_system_prompt')
    return requests[requests.length - 1].id
  }

  /**
   * Connected, with one outstanding request_system_prompt naming `conversationId` — the correlation
   * every reply below must match. Its envelope id is read off the frame ACTUALLY SENT rather than
   * assumed, so a change to the client's numbering cannot silently make every reply here
   * uncorrelatable-and-therefore-dropped while the assertions still read as if the gate were exercised.
   */
  async function requested(
    conversationId: string = CONV
  ): Promise<ReturnType<typeof build> & { replyTo: number }> {
    const ctx = await connected()
    ctx.connection.requestSystemPrompt(conversationId)
    return { ...ctx, replyTo: lastRequestId(ctx) }
  }

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers } = build()
    expect(() => connection.requestSystemPrompt(CONV)).not.toThrow()
    expect(drivers).toHaveLength(0)
  })

  it('sends exactly one request_system_prompt frame carrying the conversation id it was handed', async () => {
    const ctx = await connected()

    ctx.connection.requestSystemPrompt('conv-42')

    const requests = ctx.drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .filter((e) => e.type === 'request_system_prompt')
    // Exactly one: this verb has NO error frame, so a missing reply is indistinguishable from a slow
    // one, and a second frame here would be the self-inflicted spin requestModelList's catch forbids.
    expect(requests).toHaveLength(1)
    // Asserted as an exact payload against a value distinct from every other string on the envelope,
    // so forwarding the wrong field cannot pass.
    expect(requests[0].payload).toEqual({ conversation_id: 'conv-42' })
  })

  it('decodes a correlated system_prompt into systemPromptReceived carrying the REQUESTED id', async () => {
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext(
        { system_prompt: 'be terse', session_prompt_status: 'differs' },
        replyTo
      )
    })

    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toEqual([
      {
        type: 'systemPromptReceived',
        conversationId: CONV,
        systemPrompt: 'be terse',
        sessionPromptStatus: 'differs'
      }
    ])
  })

  it('attributes the reply to the conversation ASKED ABOUT, not to another open one', async () => {
    // The reply carries NO conversation id — deliberately, upstream, so an unhosted conversation's
    // answer is byte-identical to a hosted-but-quiet one and the verb cannot be used as a membership
    // probe. So the ONLY place the answer's conversation exists is the map this client wrote. Asking
    // about one conversation while a DIFFERENT one is the obvious ambient candidate is what makes this
    // non-vacuous: an implementation that emitted the open conversation, or the last one seen on any
    // frame, would pass a single-conversation test and fail this.
    const ctx = await connected()
    ctx.connection.send({
      conversation_id: 'conv-open-and-noisy',
      message_id: 'm-1',
      text: 'hello'
    })
    ctx.connection.requestSystemPrompt('conv-asked-about')
    const replyTo = lastRequestId(ctx)

    ctx.drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'no_session' }, replyTo)
    })

    const events = emitted(ctx.sink).filter((e) => e.type === 'systemPromptReceived')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ conversationId: 'conv-asked-about' })
  })

  it('keeps the three stored states apart across IPC: absent, "", and text', () => {
    // AC2's round-trip guarantee, at the LAST boundary before a consumer: a value read here must be
    // writable straight back without collapsing one state into another. Asserted field by field
    // because `toEqual` ignores an undefined property, so an object-shaped expectation would pass
    // against a producer that collapsed `''` into absence.
    const rows: Array<[Record<string, unknown>, string | undefined]> = [
      [{ session_prompt_status: 'matches' }, undefined],
      [{ system_prompt: '', session_prompt_status: 'matches' }, ''],
      [{ system_prompt: 'you are terse', session_prompt_status: 'no_session' }, 'you are terse']
    ]
    return Promise.all(
      rows.map(async ([payload, expectedPrompt]) => {
        const { sink, drivers, replyTo } = await requested()
        drivers[0].emit({ type: 'message', plaintext: systemPromptPlaintext(payload, replyTo) })
        const event = emitted(sink).find((e) => e.type === 'systemPromptReceived')
        expect(event).toBeDefined()
        expect(event && 'systemPrompt' in event ? event.systemPrompt : 'MISSING').toBe(expectedPrompt)
      })
    )
  })

  it('carries the status independently of the prompt, deriving neither from the other', async () => {
    // The two rows that look wrong and are not: text beside `no_session` is "configured, applies at
    // the next session start", and an ABSENT prompt beside `matches` is a conversation holding nothing
    // whose session spawned with nothing (the daemon compares the COLLAPSED stored value).
    for (const [payload, status] of [
      [{ system_prompt: 'x', session_prompt_status: 'no_session' }, 'no_session'],
      [{ session_prompt_status: 'matches' }, 'matches']
    ] as const) {
      const { sink, drivers, replyTo } = await requested()
      drivers[0].emit({ type: 'message', plaintext: systemPromptPlaintext(payload, replyTo) })
      const event = emitted(sink).find((e) => e.type === 'systemPromptReceived')
      expect(event).toMatchObject({ sessionPromptStatus: status })
    }
  })

  it('emits nothing for a system_prompt carrying no in_reply_to', async () => {
    // The unsolicited frame: a daemon that broadcasts this reply, or one impersonating it. There is
    // nothing to attribute it to, so it reaches no consumer — and the outstanding request stays
    // outstanding, which the follow-up reply below proves by still correlating.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'matches' }, null)
    })

    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toEqual([])

    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'matches' }, replyTo)
    })
    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toHaveLength(1)
  })

  it('emits nothing for a system_prompt whose in_reply_to matches no outstanding request', async () => {
    const { sink, drivers, replyTo } = await requested()

    // One past the real id — a plausible-looking neighbour rather than an obviously absurd value, so
    // an off-by-one in the recorded id would be caught by this test rather than passing it.
    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'matches' }, replyTo + 1)
    })

    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toEqual([])
  })

  it('emits nothing for a second reply re-using an already-matched in_reply_to', async () => {
    // The entry is deleted on match, so a duplicate — or a daemon replaying an old reply — finds
    // nothing. Without the delete this is the arm that would let one request answer forever.
    const { sink, drivers, replyTo } = await requested()

    const reply = systemPromptPlaintext({ session_prompt_status: 'matches' }, replyTo)
    drivers[0].emit({ type: 'message', plaintext: reply })
    drivers[0].emit({ type: 'message', plaintext: reply })

    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toHaveLength(1)
  })

  it('keys the correlation by envelope id, so two interleaved asks each draw their own conversation back', async () => {
    // Replies OUT OF REQUEST ORDER, deliberately: a FIFO would hand each reply the other's id and
    // still emit two events, so only crossing the order distinguishes a keyed map from a queue.
    const ctx = await connected()
    ctx.connection.requestSystemPrompt('conv-first')
    const first = lastRequestId(ctx)
    ctx.connection.requestSystemPrompt('conv-second')
    const second = lastRequestId(ctx)
    expect(second).not.toBe(first)

    ctx.drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ system_prompt: 'B', session_prompt_status: 'matches' }, second)
    })
    ctx.drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ system_prompt: 'A', session_prompt_status: 'differs' }, first)
    })

    expect(
      emitted(ctx.sink)
        .filter((e) => e.type === 'systemPromptReceived')
        .map((e) => ('conversationId' in e ? e.conversationId : null))
    ).toEqual(['conv-second', 'conv-first'])
  })

  it('drops a malformed system_prompt without emitting, and records no diagnostic for it', async () => {
    // Fail-closed at the decode: an off-contract `session_prompt_status` throws in
    // parseSystemPromptPayload, daemonConnection's catch drops the frame AND the caught error, and the
    // outstanding entry survives — proven by the well-formed follow-up still correlating.
    const { sink, drivers, replyTo } = await requested()

    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext(
        { system_prompt: 'be terse', session_prompt_status: 'not-a-status' },
        replyTo
      )
    })
    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toEqual([])

    drivers[0].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'matches' }, replyTo)
    })
    expect(emitted(sink).filter((e) => e.type === 'systemPromptReceived')).toHaveLength(1)
  })

  it('clears outstanding asks on reconnect, so a stale id cannot correlate on the new connection', async () => {
    // The fresh connection recycles envelope ids from 2, so a surviving entry would report one
    // conversation's stored prompt as another's — which #1078 then offers the operator to edit.
    const ctx = await requested()
    const staleId = ctx.replyTo

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    ctx.drivers[1].emit({
      type: 'message',
      plaintext: systemPromptPlaintext({ session_prompt_status: 'matches' }, staleId)
    })

    expect(emitted(ctx.sink).filter((e) => e.type === 'systemPromptReceived')).toEqual([])
  })
})

describe('createDaemonConnection — setSystemPrompt + its correlated ack and refusals (#1249)', () => {
  const CONV = 'conv-written'

  /** A well-formed conversation_updated record — the ack this write verb reuses. Its `id` is a THIRD
   *  distinct conversation on purpose: the emitted outcome must never come from this field. */
  const ACK_RECORD = {
    id: 'conv-the-record-names',
    is_promoted: true,
    name: 'weekly sync',
    cwd: '/home/user/project',
    last_used_at: '2026-07-12T00:00:00Z',
    workspace_label: null
  }

  /** A `conversation_updated` plaintext, `null` OMITTING the correlation key (a sentinel rather than
   *  `undefined`, which a default parameter would swallow). */
  function ackPlaintext(inReplyTo: number | null): Uint8Array {
    return encodeEnvelope({
      id: 61,
      type: 'conversation_updated',
      ts: FIXED_TS,
      ...(inReplyTo === null ? {} : { in_reply_to: inReplyTo }),
      payload: ACK_RECORD
    })
  }

  /** An `error` plaintext carrying an arbitrary code, plus a static daemon message that must not cross. */
  function refusalPlaintext(code: string, inReplyTo: number): Uint8Array {
    return encodeEnvelope({
      id: 62,
      type: 'error',
      ts: FIXED_TS,
      in_reply_to: inReplyTo,
      payload: { code, message: 'static daemon text that must never cross', retryable: false }
    })
  }

  async function connected(
    overrides: Parameters<typeof build>[0] = {}
  ): Promise<ReturnType<typeof build>> {
    const ctx = build(overrides)
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** Every set_system_prompt frame this connection has put on the wire. */
  function writes(ctx: ReturnType<typeof build>): ReturnType<typeof decodeEnvelope>[] {
    return ctx.drivers[0].sent
      .map((bytes) => decodeEnvelope(bytes))
      .filter((e) => e.type === 'set_system_prompt')
  }

  /** The envelope id of the LAST set_system_prompt this connection sent. */
  function lastWriteId(ctx: ReturnType<typeof build>): number {
    const sent = writes(ctx)
    return sent[sent.length - 1].id
  }

  /**
   * Connected, with one outstanding write naming `conversationId`. Its envelope id is read off the
   * frame ACTUALLY SENT rather than assumed, so a change to the client's numbering cannot silently
   * make every reply below uncorrelatable-and-therefore-dropped while the assertions still read as if
   * the gate were exercised.
   */
  async function wrote(
    conversationId: string = CONV,
    systemPrompt: string | null = 'be terse'
  ): Promise<ReturnType<typeof build> & { replyTo: number }> {
    const ctx = await connected()
    ctx.connection.setSystemPrompt({
      conversation_id: conversationId,
      system_prompt: systemPrompt
    })
    return { ...ctx, replyTo: lastWriteId(ctx) }
  }

  const confirmations = (sink: ReturnType<typeof build>['sink']): DaemonEvent[] =>
    emitted(sink).filter((e) => e.type === 'systemPromptWriteConfirmed')
  const refusals = (sink: ReturnType<typeof build>['sink']): DaemonEvent[] =>
    emitted(sink).filter((e) => e.type === 'systemPromptWriteRejected')
  const broadcasts = (sink: ReturnType<typeof build>['sink']): DaemonEvent[] =>
    emitted(sink).filter((e) => e.type === 'conversationUpdated')

  it('is a no-op before start(): no driver, nothing forwarded, no throw (the send twin)', () => {
    const { connection, drivers, sink } = build()
    expect(() =>
      connection.setSystemPrompt({ conversation_id: CONV, system_prompt: 'be terse' })
    ).not.toThrow()
    expect(drivers).toHaveLength(0)
    // No outcome either: the value was never refused by anyone, and reporting a rejection here would
    // be indistinguishable from a daemon verdict.
    expect(refusals(sink)).toEqual([])
    expect(confirmations(sink)).toEqual([])
  })

  it('sends exactly one set_system_prompt frame carrying the payload it was handed', async () => {
    const ctx = await connected()

    ctx.connection.setSystemPrompt({ conversation_id: 'conv-42', system_prompt: 'answer in Finnish' })

    // Exactly one: nothing on this verb retries, on any path.
    expect(writes(ctx)).toHaveLength(1)
    expect(writes(ctx)[0].payload).toEqual({
      conversation_id: 'conv-42',
      system_prompt: 'answer in Finnish'
    })
  })

  it('keeps the three states apart on the wire: text, "", and a present null', async () => {
    // AC1. The clear arm is asserted with `'system_prompt' in payload` rather than a bare equality:
    // JSON.stringify DROPS a key whose value is `undefined`, so a `?? undefined` anywhere on this path
    // would emit a one-field envelope and still satisfy a `toBeNull()` read of a missing key.
    for (const [systemPrompt, expected] of [
      ['be terse', 'be terse'],
      ['', ''],
      [null, null]
    ] as const) {
      const ctx = await connected()
      ctx.connection.setSystemPrompt({ conversation_id: CONV, system_prompt: systemPrompt })
      const payload = writes(ctx)[0].payload as Record<string, unknown>
      expect('system_prompt' in payload).toBe(true)
      expect(payload.system_prompt).toBe(expected)
    }
  })

  it('emits the conversationUpdated broadcast AND one confirmation for a correlated ack', async () => {
    // THE TICKET'S NAMED TRAP, and the reason this arm is not the `daemon-error` tier's shape. The ack
    // frame has a second, live consumer: the conversation-list refresh treats every conversationUpdated
    // as a trigger. A correlation that consumed the frame entirely — the shape every sibling in the
    // daemon-error tier correctly uses — would stop the requester's OWN write from refreshing their own
    // row, a regression no other test in this file would catch.
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(replyTo) })

    expect(broadcasts(sink)).toEqual([
      { type: 'conversationUpdated', conversation: ACK_RECORD }
    ])
    expect(confirmations(sink)).toEqual([
      { type: 'systemPromptWriteConfirmed', conversationId: CONV }
    ])
  })

  it('attributes the confirmation to the conversation WRITTEN, never to the id the record names', async () => {
    // The provenance rule, and unlike the read half's reply this record DOES name a conversation —
    // which makes the wrong choice available and typecheck cleanly. A daemon answering write A with a
    // record naming conversation B would report the write as landing on B. Non-vacuous by construction:
    // ACK_RECORD.id is a third value, distinct from both the written conversation and any other string
    // on the frame, so an emit reading `inbound.conversationUpdated.id` fails here and passes a
    // single-conversation test.
    const { sink, drivers, replyTo } = await wrote('conv-asked-to-write')

    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(replyTo) })

    expect(confirmations(sink)).toHaveLength(1)
    expect(confirmations(sink)[0]).toMatchObject({ conversationId: 'conv-asked-to-write' })
    // Stated explicitly so the assertion above cannot be read as incidental.
    expect(ACK_RECORD.id).not.toBe('conv-asked-to-write')
  })

  it('emits the broadcast and NO confirmation for an ack carrying no in_reply_to', async () => {
    // The ordinary unsolicited case, not a degraded one: the daemon pushes this same record with no
    // handle when a host-side `pyry channel new` mints a conversation. The write stays outstanding,
    // which the correlated follow-up proves by still settling.
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(null) })
    expect(broadcasts(sink)).toHaveLength(1)
    expect(confirmations(sink)).toEqual([])

    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(replyTo) })
    expect(confirmations(sink)).toHaveLength(1)
  })

  it('emits the broadcast and NO confirmation for an ack matching no outstanding write', async () => {
    // One past the real id — a plausible-looking neighbour rather than an obviously absurd value, so an
    // off-by-one in the recorded id is caught here rather than passing.
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(replyTo + 1) })

    expect(broadcasts(sink)).toHaveLength(1)
    expect(confirmations(sink)).toEqual([])
  })

  it('emits no second confirmation for an ack re-using an already-settled in_reply_to', async () => {
    // The entry is deleted on match, so a duplicate — or a daemon replaying an old ack — finds nothing.
    // The broadcast fires BOTH times, because it is not gated on the correlation at all.
    const { sink, drivers, replyTo } = await wrote()

    const ack = ackPlaintext(replyTo)
    drivers[0].emit({ type: 'message', plaintext: ack })
    drivers[0].emit({ type: 'message', plaintext: ack })

    expect(confirmations(sink)).toHaveLength(1)
    expect(broadcasts(sink)).toHaveLength(2)
  })

  it.each([
    ['protocol.malformed', 'protocol-malformed'],
    ['conversation.not_found', 'conversation-not-found']
  ])('settles a correlated %s refusal as exactly one rejection carrying %s', async (code, reason) => {
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: refusalPlaintext(code, replyTo) })

    expect(refusals(sink)).toEqual([
      { type: 'systemPromptWriteRejected', conversationId: CONV, reason }
    ])
    expect(confirmations(sink)).toEqual([])
  })

  it('settles a correlated refusal whose code is outside the published two as unclassified', async () => {
    // A correlated refusal must ALWAYS settle the write. Dropping one would leave the consumer
    // reporting a refused write as permanently in flight, which is strictly worse than reporting it
    // refused for a reason this client could not name.
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: refusalPlaintext('message.too_long', replyTo) })

    expect(refusals(sink)).toEqual([
      {
        type: 'systemPromptWriteRejected',
        conversationId: CONV,
        reason: 'unclassified',
      }
    ])
  })

  it('emits nothing for a refusal matching no outstanding write', async () => {
    const { sink, drivers, replyTo } = await wrote()

    drivers[0].emit({ type: 'message', plaintext: refusalPlaintext('protocol.malformed', replyTo + 1) })

    expect(refusals(sink)).toEqual([])
  })

  it('settles each write EXACTLY ONCE when the daemon sends both an ack and a refusal', async () => {
    // Both arms consume the SAME correlation entry, which is what makes "exactly one outcome per
    // write" structural rather than promised: whichever frame arrives first deletes it, and the other
    // matches nothing. Driven in both orders, since a per-arm entry would pass one and fail the other.
    for (const ackFirst of [true, false]) {
      const { sink, drivers, replyTo } = await wrote()
      const frames = [ackPlaintext(replyTo), refusalPlaintext('protocol.malformed', replyTo)]
      for (const plaintext of ackFirst ? frames : [...frames].reverse()) {
        drivers[0].emit({ type: 'message', plaintext })
      }
      expect(confirmations(sink).length + refusals(sink).length).toBe(1)
    }
  })

  it('keys the correlation by envelope id, so two interleaved writes each settle their own', async () => {
    // Settled OUT OF SEND ORDER, deliberately: a FIFO would hand each reply the other's id and still
    // emit two events, so only crossing the order distinguishes a keyed map from a queue. One settles
    // as a confirmation and the other as a refusal, so a shared-arm bug shows as a swapped id.
    const ctx = await connected()
    ctx.connection.setSystemPrompt({ conversation_id: 'conv-first', system_prompt: 'A' })
    const first = lastWriteId(ctx)
    ctx.connection.setSystemPrompt({ conversation_id: 'conv-second', system_prompt: null })
    const second = lastWriteId(ctx)
    expect(second).not.toBe(first)

    ctx.drivers[0].emit({ type: 'message', plaintext: refusalPlaintext('conversation.not_found', second) })
    ctx.drivers[0].emit({ type: 'message', plaintext: ackPlaintext(first) })

    expect(refusals(ctx.sink)).toMatchObject([
      { conversationId: 'conv-second', reason: 'conversation-not-found' }
    ])
    expect(confirmations(ctx.sink)).toMatchObject([{ conversationId: 'conv-first' }])
  })

  it('refuses a prompt over 8192 BYTES of UTF-8 before the wire, measuring bytes not code units', async () => {
    // AC2, and the assertion that makes it non-vacuous: the fixture is under the cap in UTF-16 code
    // units and over it in bytes, so a `.length` bound would send this frame and pass a test built on
    // ASCII. Each '€' is 3 bytes, so 3000 of them are 9000 bytes at 3000 code units.
    const multiByte = '€'.repeat(3000)
    expect(multiByte.length).toBeLessThan(8192)
    expect(Buffer.byteLength(multiByte, 'utf8')).toBeGreaterThan(8192)

    const ctx = await connected()
    ctx.connection.setSystemPrompt({ conversation_id: CONV, system_prompt: multiByte })

    // Nothing was built and nothing reached any wire.
    expect(writes(ctx)).toEqual([])
    expect(refusals(ctx.sink)).toEqual([
      {
        type: 'systemPromptWriteRejected',
        conversationId: CONV,
        reason: 'prompt-too-long',
      }
    ])
  })

  it('sends a prompt of exactly 8192 bytes — the bound is inclusive, like the daemon’s', async () => {
    // The off-by-one guard on the other side of the boundary. A `>=` here would fail-close a prompt the
    // daemon accepts, which is the failure mode a client-side bound most easily introduces.
    const atCap = 'x'.repeat(8192)
    const ctx = await connected()

    ctx.connection.setSystemPrompt({ conversation_id: CONV, system_prompt: atCap })

    expect(writes(ctx)).toHaveLength(1)
    expect(refusals(ctx.sink)).toEqual([])
  })

  it('reports the over-length refusal even when not connected, and records no diagnostic', async () => {
    // The bound runs BEFORE the connected guard on purpose: the verdict is about the value, not the
    // link, and a disconnected over-length write that vanished silently is the "thrown away" refusal
    // AC2 forbids — the operator would see nothing and retype the same text.
    //
    // AND IT LOGS NOTHING. This is the one branch where an implementer reaches for a helpful
    // diagnostic, and its two obvious fields — the prompt and its length — are exactly what AC5
    // forbids. Asserted as "no record at all" rather than "no prompt substring", so a record carrying
    // only the length still reddens.
    const cap = captureLog()
    const { connection, sink, drivers } = build({ diagnosticLog: cap.log })

    connection.setSystemPrompt({ conversation_id: CONV, system_prompt: 'y'.repeat(9000) })

    expect(drivers).toHaveLength(0)
    expect(refusals(sink)).toMatchObject([{ reason: 'prompt-too-long', conversationId: CONV }])
    expect(cap.records).toEqual([])
  })

  it('never carries a prompt byte, nor its length, onto any emitted event', async () => {
    // AC5 at the IPC boundary, on both settle paths and the client-side refusal. The prompt is the most
    // sensitive string this slice handles, and neither outcome has a field for it — the ack record does
    // not carry it back, and the refusal echoes no supplied byte. Serialised and searched rather than
    // key-checked, so a field added later on any arm reddens here.
    const SECRET = 'the-operator-private-prompt-text'
    const { sink, drivers, replyTo } = await wrote(CONV, SECRET)
    drivers[0].emit({ type: 'message', plaintext: ackPlaintext(replyTo) })

    const ctx2 = await connected()
    ctx2.connection.setSystemPrompt({ conversation_id: CONV, system_prompt: SECRET.repeat(400) })

    for (const events of [emitted(sink), emitted(ctx2.sink)]) {
      expect(JSON.stringify(events)).not.toContain(SECRET)
    }
  })

  it('clears outstanding writes on reconnect, so a stale id cannot settle on the new connection', async () => {
    // The fresh connection recycles envelope ids from 2, so a surviving entry would settle a NEW
    // write against a dead one's conversation — reporting a prompt as stored on a conversation that was
    // never written to.
    const ctx = await wrote()
    const staleId = ctx.replyTo

    ctx.connection.reconnect()
    await tick()
    ctx.drivers[1].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    ctx.drivers[1].emit({ type: 'message', plaintext: ackPlaintext(staleId) })
    ctx.drivers[1].emit({ type: 'message', plaintext: refusalPlaintext('protocol.malformed', staleId) })

    expect(confirmations(ctx.sink)).toEqual([])
    expect(refusals(ctx.sink)).toEqual([])
  })

  it('records no correlation entry when the send throws, so an unspent id settles nothing', async () => {
    // The record-AFTER-send ordering. A build or send that throws advances no envelope id, so an entry
    // left under the unspent id would settle whichever write next re-mints it — reporting one
    // conversation's write as another's.
    const ctx = await connected({ throwOnSend: true })
    ctx.connection.setSystemPrompt({ conversation_id: CONV, system_prompt: 'be terse' })

    // The id the throwing send would have used is the one the next write re-mints; nothing may answer
    // to it. Driven with the ack rather than a refusal because a stale confirmation is the worse lie.
    ctx.drivers[0].emit({ type: 'message', plaintext: ackPlaintext(2) })
    ctx.drivers[0].emit({ type: 'message', plaintext: ackPlaintext(3) })

    expect(confirmations(ctx.sink)).toEqual([])
  })
})

// #1225 — the envelope's `ts` reaches the window on the ten timeline-bearing arms, as `daemonTs`. It is
// the live half of the (`type`, `ts`) key the window joins a served history page on; the page half has
// ridden `HistoryTimelineEntry.ts` since #1227.
describe('createDaemonConnection — the envelope ts on the timeline-bearing emits (#1225)', () => {
  /** Deliberately NOT FIXED_TS, which every plaintext helper in this file uses: an emit that read the
   *  wrong envelope, invented a value, or defaulted one from a clock passes against that constant and
   *  fails against this one. */
  const FRAME_TS = '2026-08-19T04:05:06.789Z'

  async function connected(): Promise<ReturnType<typeof build>> {
    const ctx = build()
    ctx.connection.start()
    await tick()
    ctx.drivers[0].emit({ type: 'handshake-complete', helloAck: validHelloAck() })
    return ctx
  }

  /** Push one frame of `type` carrying `payload`, stamped FRAME_TS, and return what it emitted. */
  async function emitFor(type: string, payload: unknown): Promise<DaemonEvent[]> {
    const { sink, drivers } = await connected()
    const before = emitted(sink).length
    drivers[0].emit({
      type: 'message',
      plaintext: encodeEnvelope({ id: 3, type, ts: FRAME_TS, payload })
    })
    return emitted(sink).slice(before)
  }

  const CONV = 'conv-1'

  it.each([
    ['assistant_delta', { conversation_id: CONV, turn_id: 't1', seq: 1, text: 'x' }],
    ['turn_end', { conversation_id: CONV, turn_id: 't1', stop_reason: 'end_turn' }],
    ['turn_state', { conversation_id: CONV, state: 'thinking' }],
    ['stall', { conversation_id: CONV }],
    ['api_retry', { conversation_id: CONV, active: true, current: 1, total: 3 }],
    ['compacting', { conversation_id: CONV, active: true }],
    ['tool_use', {
      conversation_id: CONV, turn_id: 't1', tool_use_id: 'tu-1', name: 'Read', input_summary: 's'
    }],
    ['tool_result', {
      conversation_id: CONV, turn_id: 't1', tool_use_id: 'tu-1', is_error: false, result_summary: 'ok'
    }],
    ['session_transition', {
      conversation_id: CONV,
      previous_session_id: 'sess-1',
      new_session_id: 'sess-2',
      reason: 'clear',
      occurred_at: '2026-08-19T04:00:00Z',
      workspace_cwd: null
    }],
    ['unrecognized_message', {
      conversation_id: CONV, site: 'line_type', message_type: 'future', raw: '{}', truncated: false
    }]
  ])('carries the frame ts to the window as daemonTs on the %s arm', async (type, payload) => {
    const events = await emitFor(type, payload)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ daemonTs: FRAME_TS })
  })

  it('leaves `connected` unstamped — a handshake stands behind no timeline envelope', async () => {
    const { sink } = await connected()
    const handshake = emitted(sink).filter((event) => event.type === 'connected')
    expect(handshake).toHaveLength(1)
    expect(handshake[0]).not.toHaveProperty('daemonTs')
  })

  it('leaves `messageReceived` unstamped — the operator\'s own row has no live twin to join', async () => {
    // A live `message` frame maps onto this arm, but the daemon pushes none on the interactive lane:
    // the operator's message is written to the log only, so its page entry has nothing to be joined to
    // and its duplicate is the optimistic echo `removeUserEcho` dedups on `message_id`. Stamping it
    // would mint a key that suppresses a row the live stream never drew.
    const events = await emitFor('message', {
      conversation_id: CONV,
      message_id: 'm-1',
      role: 'user',
      text: 'hello'
    })
    expect(events).toHaveLength(1)
    expect(events[0]).not.toHaveProperty('daemonTs')
  })
})
