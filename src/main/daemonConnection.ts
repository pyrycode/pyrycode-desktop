// The background-process consumer the Noise relay driver (#50) was built for: it SOURCES the
// device static key (#43), the paired-server record (#44), and the `hello` early-data (#10),
// CONSTRUCTS and drives the driver, and MAPS its four lifecycle events onto the typed DaemonEvent
// channel (#18). The renderer bridge/store (#19/#2) turn `connected{ack}` into a completed-
// handshake state the window reads — this module produces that event; it does not touch the
// renderer.
//
// It is the composition/wiring layer ABOVE transport: it imports the driver (src/main/transport/)
// AND emitDaemonEvent + DaemonEvent (the IPC layer). transport/ is deliberately IPC-free, so this
// consumer lives at top-level src/main to preserve that boundary. Main-process only — it
// transitively imports codec.ts (Node Buffer) and holds the token/keys, none of which may reach
// the renderer bundle (CLAUDE.md "Keep the transport out of the window"; ADR 0002).
//
// LOG-FREE by construction (inherited #5/#7/#22/#50): no console.*, and every caught error is
// CLASSIFIED into a static category code and the caught object DROPPED — a codec/keychain error
// message can echo the token or transcript bytes, so it never reaches the sink or a log. Every
// failure surfaces as a non-connected DaemonEvent; nothing throws out of the module.
import { createNoiseRelayDriver } from './transport/noiseRelayDriver'
import type {
  NoiseRelayDriver,
  NoiseRelayDriverConfig,
  RelaySessionEvent
} from './transport/noiseRelayDriver'
import { buildClientHello, parseHelloAck } from './transport/helloExchange'
import { buildSendMessage } from './transport/sendMessageEnvelope'
import { parseInboundMessage, type InboundDaemonMessage } from './transport/inboundMessage'
import { base64StdDecode } from './transport/codec'
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import type { DeviceKeypairStore } from './deviceKeypair'
import type { PairedServerStore } from './pairedServerStore'
import { MAX_FRAME_BYTES, type HelloAckPayload, type SendMessagePayload } from '../shared/wire/types'

/** Each X25519 static key is exactly 32 bytes — the length a decoded server key must have. */
const SERVER_KEY_LENGTH = 32

/**
 * Injected dependencies. The stores + sink are constructed at the composition root; `deviceName`
 * and `clientVersion` are sourced there (os.hostname() / app.getVersion()); `now` and
 * `createDriver` are DI seams the tests override.
 */
export interface DaemonConnectionDeps {
  /** `.ensure()` → the device static keypair (the initiator `s`); the private key stays here. */
  deviceKeypair: DeviceKeypairStore
  /** `.load()` → the paired-server record, or null when never paired. */
  pairedServer: PairedServerStore
  /** The emitDaemonEvent target — a BrowserWindow satisfies it structurally. */
  sink: DaemonEventSink
  /** Device identity carried inside the encrypted `hello` (display/audit, not auth). */
  deviceName: string
  /** Client version, carried in the `hello` and the relay User-Agent header. */
  clientVersion: string
  /** RFC3339 clock for the `hello` timestamp. Default: the wall clock. */
  now?: () => string
  /** DI seam — defaults to the real createNoiseRelayDriver. Tests inject a fake. */
  createDriver?: (config: NoiseRelayDriverConfig) => NoiseRelayDriver
}

/** Handle for the single explicit connect this ticket wires (auto-reconnect is #34). */
export interface DaemonConnection {
  /** Idempotent. Emits `connecting`, then sources the inputs and constructs the driver. */
  start(): void
  /** Idempotent teardown: stop the driver and suppress the resulting terminal. */
  stop(): void
  /**
   * Encrypt a `send_message` envelope onto the live session. Idempotent no-op when not connected
   * (no driver yet, pre-handshake, or post-terminal). NEVER throws out of the module (parity #490):
   * a command arriving while disconnected is dropped, never propagated as a crash.
   */
  send(payload: SendMessagePayload): void
}

/**
 * Human-readable, secret-free banner text per failure category. Every string is static — the
 * machine-readable distinction lives in `code`; unknown codes (the driver's own error reasons)
 * fall back to a generic line. No caught-error text or wire value is ever interpolated here.
 */
function messageFor(code: string): string {
  switch (code) {
    case 'not-paired':
      return 'No paired pyrybox — pair a device to connect.'
    case 'malformed-hello-ack':
      return 'The daemon sent a malformed handshake response.'
    default:
      return 'The connection to pyrybox failed.'
  }
}

/**
 * Decode the record's base64 `server_static_pubkey` into the raw 32-byte responder static key.
 * base64StdDecode fails closed on bad base64 (WireDecodeError); we add the length check the codec
 * deliberately omits. Both throws are caught by the bootstrap and classified to `connect-failed`.
 */
function decodeServerKey(encoded: string): Uint8Array {
  const key = base64StdDecode(encoded)
  if (key.length !== SERVER_KEY_LENGTH) {
    throw new Error('server static pubkey must be 32 bytes')
  }
  return key
}

export function createDaemonConnection(deps: DaemonConnectionDeps): DaemonConnection {
  const { deviceKeypair, pairedServer, sink, deviceName, clientVersion } = deps
  const now = deps.now ?? ((): string => new Date().toISOString())
  const createDriver = deps.createDriver ?? createNoiseRelayDriver

  // Three locals, no store: the renderer's sessionStore (#2) is the single source of session
  // state; this module only emits into it. `stopped` doubles as the "stopping" flag that
  // suppresses the terminal a clean stop() produces.
  let started = false
  let stopped = false
  let driver: NoiseRelayDriver | null = null
  // The `hello` consumed envelope id 1 in bootstrap (:153); app envelopes continue from 2. A
  // module-local, single-writer counter — `send` has no `await`, so it runs to completion with no
  // check-then-act race. It advances only on a successful build, so a dropped over-cap send does
  // not consume an id (harmless either way: the daemon uses `id` for in_reply_to correlation, not
  // sequencing).
  let nextEnvelopeId = 2

  function emitFailed(code: string, message = messageFor(code)): void {
    emitDaemonEvent(sink, { type: 'failed', error: { code, message, retryable: false } })
  }

  // The single choke point: RelaySessionEvent → DaemonEvent. Nothing else emits.
  function onDriverEvent(event: RelaySessionEvent): void {
    switch (event.type) {
      case 'handshake-complete': {
        let ack: HelloAckPayload
        try {
          ack = parseHelloAck(event.helloAck)
        } catch {
          // Fail-closed: a malformed ack is a non-connected state, never a crash. The caught
          // WireDecodeError is dropped (its message could echo the ack bytes).
          emitFailed('malformed-hello-ack')
          return
        }
        emitDaemonEvent(sink, { type: 'connected', ack })
        return
      }
      case 'message': {
        // Decode the decrypted app-envelope at the transport boundary, then map its narrowed result
        // onto the IPC layer — the consumer's only job (transport/ stays IPC-free).
        let inbound: InboundDaemonMessage | null
        try {
          inbound = parseInboundMessage(event.plaintext)
        } catch {
          // Fail-closed (AC4): oversized / malformed / unparseable / mistyped payload. Drop the
          // frame — no event, no throw. The caught WireDecodeError is DROPPED (classify-don't-
          // forward: its message could echo message plaintext; it never reaches a log or an event).
          return
        }
        if (inbound === null) return // AC5: a well-formed envelope of another type is ignored.
        if (inbound.kind === 'message') {
          emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
        } else {
          emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
        }
        return
      }
      case 'terminal':
        // A clean local stop() drives terminal{1000,'stopped'}; suppress it (the window is
        // tearing down on quit). Every other fatal close is an authoritative drop the user sees.
        // The supervisor's `reason` string is deliberately NOT forwarded (conservative).
        if (stopped) return
        emitFailed('connection-closed', `The connection to pyrybox was closed (code ${event.code}).`)
        return
      case 'error':
        // The driver's reason is a static enum string — safe to surface as the category code.
        emitFailed(event.reason)
        return
    }
  }

  async function bootstrap(): Promise<void> {
    try {
      const record = await pairedServer.load()
      if (record === null) {
        emitFailed('not-paired')
        return
      }
      const pair = await deviceKeypair.ensure()
      const remoteStaticPublicKey = decodeServerKey(record.server_static_pubkey)
      const hello = buildClientHello({
        id: 1,
        ts: now(),
        deviceName,
        clientVersion,
        token: record.token
      })
      // stop() may have raced the bootstrap while it awaited. JS yields only at `await`, so
      // checking here — immediately before the synchronous createDriver — closes the race: the
      // driver is never constructed after a stop().
      if (stopped) return
      driver = createDriver({
        connection: {
          url: record.relay,
          // Mirrors the live-validated mobile contract (OkHttpRelayTransport.kt) field-for-field.
          // The relay requires a non-empty X-Pyrycode-Token but ignores its value under v2 — the
          // Noise static-key handshake is the real gate. Do not deviate to a placeholder without a
          // matching mobile/relay change (CLAUDE.md no-drift).
          headers: {
            'X-Pyrycode-Server': record.server,
            'X-Pyrycode-Token': record.token,
            'User-Agent': `pyrycode-desktop/${clientVersion}`,
            'X-Pyrycode-Device-Name': deviceName
          },
          maxFrameBytes: MAX_FRAME_BYTES
        },
        session: {
          staticPrivateKey: pair.privateKey,
          remoteStaticPublicKey,
          prologue: new Uint8Array(0),
          hello
        },
        onEvent: onDriverEvent
      })
    } catch {
      // Single catch-all for the whole bootstrap: rejected load()/ensure(),
      // MalformedPairedServerRecordError, bad base64 / wrong-length key, or a driver-construction
      // throw. The caught object is DROPPED (classify-don't-forward); only the static code crosses.
      emitFailed('connect-failed')
    }
  }

  function send(payload: SendMessagePayload): void {
    // No driver yet: before start(), mid-bootstrap (await not resolved), or bootstrap-failed. The
    // driver's own sendMessage is inert pre-handshake / post-terminal (noiseRelayDriver.ts:229),
    // so this single guard plus that inertness covers every "not connected" state — no `connected`
    // flag needed (a flag would only change whether an id is consumed, which is harmless).
    if (driver === null) return
    try {
      const bytes = buildSendMessage({ id: nextEnvelopeId, ts: now(), payload })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): covers an over-cap plaintext (WireEncodeError)
      // and any driver/wasm throw. The caught object is DROPPED — its message could echo the
      // message plaintext; no log, no event (classify-don't-forward, inherited #62).
    }
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      // Emitted synchronously, before any await, so status leaves "connecting" the moment the
      // connect begins (AC3).
      emitDaemonEvent(sink, { type: 'connecting' })
      // Fire-and-forget: bootstrap catches everything internally and never rejects.
      void bootstrap()
    },
    stop(): void {
      if (stopped) return
      stopped = true
      // Idempotent driver teardown. If the bootstrap has not yet constructed the driver, the
      // `stopped` guard above (step 7) prevents it from ever being constructed.
      driver?.stop()
    },
    send
  }
}
