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
// CONTENT-FREE-LOG by construction (inherited #5/#7/#22/#50, extended to the daemon leg by #128):
// no console.*, and every caught error is CLASSIFIED into a static category code and the caught
// object DROPPED — a codec/keychain error message can echo the token or transcript bytes, so it
// never reaches the sink or a log. The module now shadows its lifecycle onto the injected #126
// DiagnosticLog (daemon-dial / daemon-connected / daemon-failed), but still logs only the static
// classification code and the event name — never the caught error object, the human-readable banner
// (messageFor), the ack/plaintext bytes, or the numeric close code (that is #127's relay leg). Every
// failure surfaces as a non-connected DaemonEvent; nothing throws out of the module.
import { createNoiseRelayDriver } from './transport/noiseRelayDriver'
import type {
  DialConfig,
  NoiseRelayDriver,
  NoiseRelayDriverConfig,
  RelaySessionEvent
} from './transport/noiseRelayDriver'
import { buildClientHello, parseHelloAck } from './transport/helloExchange'
import { buildSendMessage } from './transport/sendMessageEnvelope'
import { buildRequestDebugBundle } from './transport/requestDebugBundleEnvelope'
import { buildRequestSnapshot } from './transport/requestSnapshotEnvelope'
import { buildListConversations } from './transport/listConversationsEnvelope'
import { parseInboundMessage, type InboundDaemonMessage } from './transport/inboundMessage'
import {
  createBundleReassembler,
  type BundleConsumer,
  type BundleReassembler
} from './transport/bundleReassembler'
import { base64StdDecode } from './transport/codec'
import { emitDaemonEvent, type DaemonEventSink } from './emitDaemonEvent'
import type { DiagnosticLog } from './diagnosticLog'
import type { DeviceKeypairStore } from './deviceKeypair'
import type { PairedServerStore } from './pairedServerStore'
import {
  MAX_FRAME_BYTES,
  type HelloAckPayload,
  type SendMessagePayload,
  type RequestSnapshotPayload
} from '../shared/wire/types'

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
  /**
   * The one content-free diagnostic logger (#126), constructed at the composition root and shared by
   * every transport consumer. Optional injection seam only: #126 threads the dependency here; the
   * daemon-leg call sites (this module) are #128 and the relay-leg threading is #127. Unused in #126.
   */
  diagnosticLog?: DiagnosticLog
}

/**
 * Handle for the explicit connect/re-arm this module wires. #34 split into this ticket's explicit
 * re-arm (reconnect — the connect-on-pair trigger, #82) and #83's supervisor auto-reconnect
 * record-reload.
 */
export interface DaemonConnection {
  /** Idempotent. Emits `connecting`, then sources the inputs and constructs the driver. */
  start(): void
  /** Idempotent teardown: stop the driver and suppress the resulting terminal. */
  stop(): void
  /**
   * Tear down any current connection and dial fresh, re-sourcing the paired-server record at dial
   * time. The connect-on-pair trigger (#82): a fresh pairing dials with no manual step. Emits a
   * fresh `connecting`. No-op once stop()ped. Distinct from the supervisor's in-session transient
   * auto-reconnect (#83) — this replaces the driver entirely.
   */
  reconnect(): void
  /**
   * Encrypt a `send_message` envelope onto the live session. Idempotent no-op when not connected
   * (no driver yet, pre-handshake, or post-terminal). NEVER throws out of the module (parity #490):
   * a command arriving while disconnected is dropped, never propagated as a crash.
   */
  send(payload: SendMessagePayload): void
  /**
   * Encrypt a payload-carrying `request_snapshot` control envelope onto the live session — asks the
   * daemon for the current `screen_snapshot` (its model / effort / yolo) for the given conversation.
   * The `send` TWIN, not `requestDebugBundle`: a snapshot has no consumer, so it is an inert no-op
   * when not connected (`driver === null` → return), never a `consumer.fail`. The reply arrives
   * asynchronously as one `snapshotReceived` DaemonEvent (or, if the daemon rejects the id, an
   * `error` that is dropped today — see #180 Out of scope). NEVER throws out of the module (parity #490).
   */
  requestSnapshot(payload: RequestSnapshotPayload): void
  /**
   * Encrypt a bare `list_conversations` control envelope onto the live session — asks the daemon for
   * the current conversation list. The `send` TWIN, not `requestDebugBundle`: a list request has no
   * consumer to fail, so it is an inert no-op when not connected (`driver === null` → return). The
   * reply arrives asynchronously as one `conversationsReceived` DaemonEvent, consumed by the
   * conversation-list store (#208), not the session store. Bare — no payload argument. It has no
   * caller in this ticket; #208 triggers it via `sendCommand` on connect (as #181 triggered
   * `requestSnapshot`). NEVER throws out of the module (parity #490).
   */
  requestConversations(): void
  /**
   * Encrypt a bare `request_debug_bundle` control envelope onto the live session — asks the daemon
   * to begin streaming the current debug bundle back — and ARM a reassembler for the streamed reply
   * (#116). The daemon answers with ordered `debug_bundle_chunk`* frames + one `debug_bundle_done`,
   * or a single `error` in lieu of the stream; the reassembler delivers the finished archive
   * (`consumer.complete(bytes)`) or a clean failure (`consumer.fail(reason)`) — exactly one terminal.
   * When not connected the consumer is failed `not-connected` (never a silent no-op), so #118's
   * command never hangs. NEVER throws out of the module (parity #490).
   */
  requestDebugBundle(consumer: BundleConsumer): void
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

/**
 * Build the relay CLIENT-leg dial URL from the paired relay base. The deployed relay routes clients
 * only on `/v1/client` and returns 404 on any other path, including the bare base. `pyry pair` emits
 * the bare base in the payload (no path), so the client MUST append `/v1/client` itself — the same as
 * the mobile client (OkHttpRelayTransport: `trimEnd('/') + "/v1/client"`). Idempotent: a record that
 * already carries the `/v1/client` suffix is returned unchanged, so a full dial URL still works.
 */
export function relayClientDialUrl(relay: string): string {
  const trimmed = relay.replace(/\/+$/, '')
  return trimmed.endsWith('/v1/client') ? trimmed : `${trimmed}/v1/client`
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
  // Monotonic connection fence, mirroring the driver's own generation idiom
  // (noiseRelayDriver.ts:100-118) one layer up. `dial()` bumps it before tearing down the old
  // driver, so a superseded driver's events — including the terminal{1000,'stopped'} that stopping
  // it synchronously emits — are dropped by the per-dial onEvent wrapper. `stopped` (permanent
  // teardown) is deliberately NOT subsumed by this counter: stop() does not bump it, so the
  // pre-createDriver guard checks both.
  let generation = 0
  // The `hello` consumed envelope id 1 in bootstrap (:153); app envelopes continue from 2. A
  // module-local, single-writer counter — `send` has no `await`, so it runs to completion with no
  // check-then-act race. It advances only on a successful build, so a dropped over-cap send does
  // not consume an id (harmless either way: the daemon uses `id` for in_reply_to correlation, not
  // sequencing).
  let nextEnvelopeId = 2
  // The single per-connection debug-bundle reassembly slot (#116). The desktop has at most ONE
  // bundle request in flight (daemon-global bundle, one UI action), so a lone slot keyed by
  // liveness — replaced on each requestDebugBundle — is the whole state model: no in_reply_to map.
  // `null` before/between requests; a settled reassembler stays referenced but inert (its own
  // `settled` flag absorbs stray late frames) until the next request replaces it.
  let reassembler: BundleReassembler | null = null

  function emitFailed(code: string, message = messageFor(code)): void {
    emitDaemonEvent(sink, { type: 'failed', error: { code, message, retryable: false } })
    // The single failure choke point (all five classifications) shadows onto the log — the static
    // `code` only, never the `message` param (which interpolates the numeric close code, #127's leg).
    deps.diagnosticLog?.event({ event: 'daemon-failed', code })
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
        // The load-bearing "Noise handshake finished" signal — event name only, never the ack bytes.
        // Distinct from #127's relay-open (the WS socket opening, which precedes the handshake).
        deps.diagnosticLog?.event({ event: 'daemon-connected' })
        return
      }
      case 'message': {
        // Decode the decrypted app-envelope at the transport boundary, then map its narrowed result
        // onto the IPC layer — the consumer's only job (transport/ stays IPC-free).
        let inbound: InboundDaemonMessage | null
        try {
          inbound = parseInboundMessage(event.plaintext, deps.diagnosticLog)
        } catch {
          // Fail-closed (AC4): oversized / malformed / unparseable / mistyped payload. Drop the
          // frame — no event, no throw. The caught WireDecodeError is DROPPED (classify-don't-
          // forward: its message could echo message plaintext; it never reaches a log or an event).
          return
        }
        if (inbound === null) return // AC5: a well-formed envelope of another type is ignored.
        // Route on the narrowed kind. The message / message_chunk paths are unchanged; the three
        // debug-bundle kinds (#116) feed the armed reassembler (a no-op when none is in flight —
        // optional chaining, or the settled reassembler's own inert guard — preserving the prior
        // drop behaviour and keeping an unrelated `error` harmless when no bundle is streaming).
        switch (inbound.kind) {
          case 'message':
            emitDaemonEvent(sink, { type: 'messageReceived', message: inbound.message })
            return
          case 'chunk':
            emitDaemonEvent(sink, { type: 'messagesReceived', messages: inbound.messages })
            return
          case 'bundle-chunk':
            reassembler?.chunk(inbound.seq, inbound.data)
            return
          case 'bundle-done':
            reassembler?.done(inbound.total)
            return
          case 'daemon-error':
            reassembler?.fail('daemon-error')
            return
          case 'snapshot':
            // The content-minimisation seam (#180): `text` / `ts` / `conversation_id` are decoded but
            // DROPPED here — only the three settings fields plus the two usage ints (#191) cross to the
            // renderer. The dedicated minimal snapshotReceived event shape (NOT a reuse of
            // ScreenSnapshotPayload) is what makes this hard to get wrong; a naive "reuse the wire type"
            // would leak `text` to the renderer. The two ints are non-secret context-window counts.
            emitDaemonEvent(sink, {
              type: 'snapshotReceived',
              model: inbound.snapshot.model,
              effort: inbound.snapshot.effort,
              yolo: inbound.snapshot.yolo,
              used_tokens: inbound.snapshot.used_tokens,
              window_tokens: inbound.snapshot.window_tokens
            })
            return
          case 'assistant-delta':
            // The interactive-stream data path (#199). snake→camel here (wire is snake, IPC is camel);
            // `conversation_id` is DROPPED (single active conversation; #202's bridge scopes identity).
            // Unlike snapshot, `text` IS carried — it is the render payload (#203), not a secret. A
            // fresh literal with named fields, never a spread of the decoded payload, so only the three
            // known fields cross IPC.
            emitDaemonEvent(sink, {
              type: 'assistantDelta',
              turnId: inbound.delta.turn_id,
              seq: inbound.delta.seq,
              text: inbound.delta.text
            })
            return
          case 'turn-end':
            emitDaemonEvent(sink, {
              type: 'turnEnd',
              turnId: inbound.turnEnd.turn_id,
              stopReason: inbound.turnEnd.stop_reason
            })
            return
          case 'conversations':
            // The conversation-list data path (#139). Emit a fresh literal reusing the already-minimal
            // decoded array — mirror messagesReceived, NOT the snapshot content-drop: there is nothing
            // to drop (no secret field), so the ConversationSummary[] reference passes through verbatim.
            // Field names stay snake_case (the event reuses the wire row type, like messagesReceived
            // reuses MessagePayload) — #208's store derives the discussion/channel label from is_promoted.
            emitDaemonEvent(sink, {
              type: 'conversationsReceived',
              conversations: inbound.conversations
            })
            return
        }
        return
      }
      case 'terminal':
        // A stream interrupted by a socket drop resolves the consumer (no hang, no lingering bytes).
        // Deterministic code, safe unconditionally: fail on a settled/absent reassembler is inert.
        reassembler?.fail('connection-lost')
        // A clean local stop() drives terminal{1000,'stopped'}; suppress it (the window is
        // tearing down on quit). Every other fatal close is an authoritative drop the user sees.
        // The supervisor's `reason` string is deliberately NOT forwarded (conservative).
        if (stopped) return
        emitFailed('connection-closed', `The connection to pyrybox was closed (code ${event.code}).`)
        return
      case 'error':
        // Same teardown net for a connection-level driver error mid-stream.
        reassembler?.fail('connection-lost')
        // The driver's reason is a static enum string — safe to surface as the category code.
        emitFailed(event.reason)
        return
    }
  }

  // Load the current paired-server record and derive ONE dial's config (connection headers + Noise
  // session material). `null` = no stored record (fail closed). This is the per-dial provider (#83):
  // it is passed to the driver so every AUTOMATIC supervisor reconnect re-sources the record through
  // it (re-reading a re-pair immediately, since pairedServer.load() has no cache), and bootstrap
  // itself calls it for the first/explicit dial. It stays entirely in the background process — no
  // record field crosses to the renderer. A thrown decodeServerKey / ensure() /
  // MalformedPairedServerRecordError propagates to the caller (bootstrap's catch, or the driver's
  // resolveConnection which fails closed).
  async function loadDialConfig(): Promise<DialConfig | null> {
    const record = await pairedServer.load()
    if (record === null) return null
    const pair = await deviceKeypair.ensure()
    const remoteStaticPublicKey = decodeServerKey(record.server_static_pubkey)
    const hello = buildClientHello({
      id: 1,
      ts: now(),
      deviceName,
      clientVersion,
      token: record.token
    })
    return {
      connection: {
        url: relayClientDialUrl(record.relay),
        // The relay routes clients only on /v1/client (404 otherwise); pyry pair emits the bare
        // relay base, so the client-leg path is appended here — matching the mobile client.
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
        maxFrameBytes: MAX_FRAME_BYTES,
        // Route the one process-singleton content-free logger (#126) the last leg into
        // relayConnection (#127). This is the SINGLE per-dial construction site — used for both the
        // first dial and every #83 reload — and it closes over the constant `deps.diagnosticLog`,
        // so each rebuilt blob references the same logger with no re-attach logic. Optional field:
        // assigns cleanly whether or not the composition root wired a logger.
        diagnosticLog: deps.diagnosticLog
      },
      session: {
        staticPrivateKey: pair.privateKey,
        remoteStaticPublicKey,
        prologue: new Uint8Array(0),
        hello
      }
    }
  }

  async function bootstrap(gen: number): Promise<void> {
    try {
      const dc = await loadDialConfig()
      // A reconnect superseded this in-flight bootstrap while it awaited: abandon it silently — do
      // not emit not-paired/connect-failed or build a stale driver. The successor's dial owns the
      // sink now. Gen check FIRST, before the not-paired branch, so a superseded bootstrap never
      // emits not-paired.
      if (gen !== generation) return
      if (dc === null) {
        emitFailed('not-paired')
        return
      }
      // stop() (permanent teardown) or a superseding reconnect (a newer gen) may have raced the
      // bootstrap while it awaited. JS yields only at `await`, so checking here — immediately before
      // the synchronous createDriver — closes both races: the driver is never constructed after a
      // stop() or once a newer dial has taken over. `stopped` is checked explicitly because it does
      // NOT bump `generation`.
      if (stopped || gen !== generation) return
      driver = createDriver({
        connection: dc.connection,
        session: dc.session,
        // Route the same process-singleton content-free logger (#126) into the driver — a SECOND
        // downward path alongside the relay leg at connection.diagnosticLog above: the driver uses it
        // for the framing decode catch AND forwards it into each Noise session it builds (#133).
        diagnosticLog: deps.diagnosticLog,
        // Thread the provider so the driver's automatic supervisor reconnects re-source the record
        // from storage (#83) — for both the connection headers and the Noise session material —
        // instead of reusing this first dial's snapshot.
        loadDialConfig,
        // Fence the driver's events on this dial's generation: a driver superseded by a later dial
        // (including the terminal it emits when dial() stops it) must not reach onDriverEvent, which
        // would surface a spurious `failed` between the new `connecting` and `connected`.
        // onDriverEvent itself is unchanged — it still checks `stopped` for the app-quit terminal.
        onEvent: (event) => {
          if (gen !== generation) return
          onDriverEvent(event)
        }
      })
    } catch {
      // Single catch-all for the whole bootstrap: rejected load()/ensure(),
      // MalformedPairedServerRecordError, bad base64 / wrong-length key, or a driver-construction
      // throw. The caught object is DROPPED (classify-don't-forward); only the static code crosses.
      // A superseded bootstrap's throw is silent — its `failed` would clobber the successor's fresh
      // `connecting`; only the current-gen dial surfaces a failure.
      if (gen === generation) emitFailed('connect-failed')
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

  function requestSnapshot(payload: RequestSnapshotPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A snapshot has no consumer to fail; a request sent while
    // disconnected simply produces no reply.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestDebugBundle — no second counter —
      // so ids stay unique across interleaved calls (the daemon correlates replies by id).
      const bytes = buildRequestSnapshot({ id: nextEnvelopeId, ts: now(), payload })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function requestConversations(): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A list request has no consumer to fail; a request sent
    // while disconnected simply produces no reply.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestSnapshot / requestDebugBundle — no
      // second counter — so ids stay unique across interleaved calls (the daemon correlates by id).
      const bytes = buildListConversations({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function requestDebugBundle(consumer: BundleConsumer): void {
    // Not connected (before start(), mid-bootstrap, bootstrap-failed): fail the consumer terminally
    // so #118's command never hangs — the wire behaviour is still "send nothing," but the caller is
    // notified. Replaces the old silent no-op (send's twin stays a silent no-op; a bundle request
    // owns a consumer that must always receive a terminal).
    if (driver === null) {
      consumer.fail('not-connected')
      return
    }
    // Arm the reassembler BEFORE building/sending the request frame, so the reply cannot race ahead
    // of an armed slot. Replacing the slot releases any prior request's accumulated bytes.
    reassembler = createBundleReassembler(consumer)
    try {
      // Shares the one monotonic nextEnvelopeId with send — no second counter — so ids stay unique
      // across interleaved send/requestDebugBundle calls (the daemon correlates replies by id).
      const bytes = buildRequestDebugBundle({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED. A build/send throw after arming
      // leaves the reassembler pending; the connection-teardown net resolves the consumer when the
      // socket drops.
    }
  }

  // The single fresh-connect path both start() and reconnect() funnel through.
  function dial(): void {
    const gen = ++generation
    // Tear down a live driver before dialing the next, so two sockets never stack and only the
    // fresh server is dialed (AC3). Its stop-terminal carries the OLD gen, so the onEvent wrapper
    // drops it — no spurious `failed`. Null before the first dial / after a not-paired boot, where
    // this is a no-op.
    driver?.stop()
    driver = null
    // Fresh session, fresh app-envelope numbering — each dial rebuilds `hello` at id 1, so app
    // envelopes restart at 2. Correctness-neutral (the daemon correlates by id, not sequence; see
    // the nextEnvelopeId comment above) but keeps a re-dialed session self-consistent.
    nextEnvelopeId = 2
    // Emitted synchronously, before any await, so status leaves "connecting" the moment the connect
    // begins (AC2). On the first start() the driver is null so the stop above is a no-op — no
    // behavior change from the original once-only start.
    emitDaemonEvent(sink, { type: 'connecting' })
    // The daemon-side dial anchor (AC1) — coordinate-free (host/path are #127's, and the paired
    // record is not loaded at this seam). Logged before bootstrap runs, so the not-paired case still
    // anchors the window even though the relay socket never opens and #127 logs nothing.
    deps.diagnosticLog?.event({ event: 'daemon-dial' })
    // Fire-and-forget: bootstrap catches everything internally and never rejects.
    void bootstrap(gen)
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      dial()
    },
    reconnect(): void {
      if (stopped) return
      // Idempotent with a later did-finish-load start() in the unreachable race — keeps that start
      // a no-op once a reconnect has already dialed.
      started = true
      dial()
    },
    stop(): void {
      if (stopped) return
      stopped = true
      // Idempotent driver teardown. If the bootstrap has not yet constructed the driver, the
      // `stopped` guard above (step 7) prevents it from ever being constructed.
      driver?.stop()
    },
    send,
    requestSnapshot,
    requestConversations,
    requestDebugBundle
  }
}
