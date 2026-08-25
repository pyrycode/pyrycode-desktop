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
import { randomUUID } from 'node:crypto'
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
import { buildRequestSessionSettings } from './transport/requestSessionSettingsEnvelope'
import { buildListConversations } from './transport/listConversationsEnvelope'
import { buildRecentWorkspaces } from './transport/recentWorkspacesEnvelope'
import { buildCreateConversation } from './transport/createConversationEnvelope'
import { buildCreateWorkspaceFolder } from './transport/createWorkspaceFolderEnvelope'
import { buildPromoteConversation } from './transport/promoteConversationEnvelope'
import { buildArchiveConversation } from './transport/archiveConversationEnvelope'
import { buildUnarchiveConversation } from './transport/unarchiveConversationEnvelope'
import { buildDeleteConversation } from './transport/deleteConversationEnvelope'
import { buildRenameConversation } from './transport/renameConversationEnvelope'
import { buildChangeWorkspace } from './transport/changeWorkspaceEnvelope'
import { buildSetSessionSettings } from './transport/setSessionSettingsEnvelope'
import { buildDequeueMessage } from './transport/dequeueMessageEnvelope'
import { buildInterrupt } from './transport/interruptEnvelope'
import { buildModalAnswer, buildModalCancel } from './transport/modalResolutionEnvelope'
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
  CAPABILITY_INTERACTIVE,
  type HelloAckPayload,
  type SendMessagePayload,
  type CreateConversationPayload,
  type CreateWorkspaceFolderPayload,
  type PromoteConversationPayload,
  type ArchiveConversationPayload,
  type UnarchiveConversationPayload,
  type DeleteConversationPayload,
  type RenameConversationPayload,
  type ChangeWorkspacePayload,
  type SetSessionSettingsPayload,
  type ModalAnswerPayload,
  type ModalCancelPayload,
  type DequeueMessagePayload
} from '../shared/wire/types'

/** Each X25519 static key is exactly 32 bytes — the length a decoded server key must have. */
const SERVER_KEY_LENGTH = 32

/**
 * The relay's "reachable, but no daemon registered behind it" close (#328). The wire spec treats it
 * as RETRYABLE — which is why relaySupervisor's DEFAULT_FATAL_CLOSE_CODES excludes it — and it maps
 * to the 'daemon-absent' relay-leg category (mobile shows this GREEN, "relay reachable"; the daemon
 * leg's absence is the daemon dot's story, not a relay failure). Every other retryable close is an
 * ordinary socket drop → 'offline'. Defined locally: this is its only consumer.
 */
const RELAY_NO_DAEMON_CLOSE_CODE = 4404

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
   * Mints the client-side idempotency `answer_token` per `modal_answer` (#236). Default:
   * crypto.randomUUID (Node CSPRNG — NOT Math.random). A DI seam like `now` / `createDriver` so the
   * mint is deterministic under test. MAIN-side only — the renderer never mints (the token needs
   * randomness and never reaches the web layer). The token is an anti-replay key, not a credential:
   * only its uniqueness + stability per call matter, not its secrecy.
   */
  mintToken?: () => string
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
   * Ask the daemon for the current run configuration (#491). Bare — no payload — because the reply
   * is daemon-wide. Inert no-op when not connected, like send.
   */
  requestSessionSettings(): void
  /**
   * Encrypt a bare `list_conversations` control envelope onto the live session — asks the daemon for
   * the current conversation list. The `send` TWIN, not `requestDebugBundle`: a list request has no
   * consumer to fail, so it is an inert no-op when not connected (`driver === null` → return). The
   * reply arrives asynchronously as one `conversationsReceived` DaemonEvent, consumed by the
   * conversation-list store (#208), not the session store. Bare — no payload argument. It has no
   * caller in this ticket; #208 triggers it via `sendCommand` on connect. NEVER throws out of the
   * module (parity #490).
   */
  requestConversations(): void
  /**
   * Encrypt a bare `recent_workspaces` control envelope onto the live session — asks the daemon for the
   * recent-workspaces list (#888). The `send` TWIN, not `requestDebugBundle`: a list request has no
   * consumer to fail, so it is an inert no-op when not connected (`driver === null` → return). The
   * reply arrives asynchronously as one `recentWorkspacesReceived` DaemonEvent, consumed by the
   * recent-workspaces store (#382), not the session store. Bare — no payload argument. It has no caller
   * in this ticket; #382 triggers it via the command on connect (as #208 triggered `requestConversations`).
   * NEVER throws out of the module (parity #490).
   */
  requestRecentWorkspaces(): void
  /**
   * Encrypt a payload-carrying `create_conversation` control envelope onto the live session — asks the
   * daemon to create a fresh conversation (all three fields nullable; `null` = let the daemon choose).
   * The `send` TWIN, not `requestDebugBundle`: a create request has no consumer to fail, so it is an
   * inert no-op when not connected (`driver === null` → return). The reply arrives asynchronously as one
   * `conversationCreated` DaemonEvent, consumed by the render slice (#242), not the session store. Its
   * caller is #242; this ticket only wires the round-trip. NEVER throws out of the module (parity #490).
   */
  createConversation(payload: CreateConversationPayload): void
  /**
   * Encrypt a payload-carrying `create_workspace_folder` control envelope onto the live session — asks
   * the daemon to create a new workspace folder (both `parent` and `name` required; the daemon confines
   * the create to the operator's $HOME and enforces a single-clean-element name server-side). The `send`
   * TWIN, not `requestDebugBundle`: a create-folder request has no consumer to fail, so it is an inert
   * no-op when not connected (`driver === null` → return). The reply arrives asynchronously as one
   * `workspaceFolderCreated` DaemonEvent carrying the created `path`, consumed by the Create-folder dialog
   * (#157), not the session store. Its caller is #157; this ticket only wires the round-trip. NEVER throws
   * out of the module (parity #490).
   */
  createWorkspaceFolder(payload: CreateWorkspaceFolderPayload): void
  /**
   * Encrypt a payload-carrying `dequeue_message` control envelope onto the live session — asks the
   * daemon to drop one queued-but-not-yet-run message from a conversation's backlog. The `send` TWIN,
   * not `requestDebugBundle`: an inert no-op when not connected (`driver === null` → return), never a
   * `consumer.fail`. UNGATED (#720) and fire-and-forget — no answer token, and no reply is expected (no
   * correlation memory to leave dangling); the daemon's re-broadcast `queue_state` snapshot (#292/#294)
   * is the observable effect, existing machinery not part of this leg. Its caller is the drop affordance
   * (#296); this slice only wires the command path. NEVER throws out of the module (parity #490).
   */
  dequeueMessage(payload: DequeueMessagePayload): void
  /**
   * Encrypt a BARE `interrupt` control envelope onto the live session — the "stop the running turn"
   * signal the daemon maps to a single claude Esc keystroke (daemon SSOT pyrycode #707). Bare: NO
   * payload argument (the twin of `requestConversations`, not the payload-bearing `dequeueMessage`);
   * the #305 builder takes only `{ id, ts }`. The `send` TWIN, not `requestDebugBundle`: an inert no-op
   * when not connected (`driver === null` → return), never a `consumer.fail`. FIRE-AND-FORGET — no
   * answer token, no reply, and NO correlation memory to leave dangling; the turn stops via the ordinary
   * end-of-turn events (`turn_end` / `turn_state{idle}`) the timeline already handles, not this leg. Its
   * caller is the interrupt affordance (#307); this slice only wires the command path. NEVER throws out
   * of the module (parity #490).
   */
  interrupt(): void
  /**
   * Encrypt a payload-carrying `promote_conversation` control envelope onto the live session — asks the
   * daemon to promote a discussion into a saved channel (all three fields required: the id must resolve,
   * and the conversation must carry a name + cwd). The `send` TWIN, not `requestDebugBundle`: a promote
   * request has no consumer to fail, so it is an inert no-op when not connected (`driver === null` →
   * return). The reply is an UNSOLICITED `conversation_updated` BROADCAST (NOT correlated by
   * `in_reply_to`) the daemon fans out to every client on the server-id, decoded into one
   * `conversationUpdated` DaemonEvent — consumed by the list-reflect slice (#275), not the session store.
   * Its caller is the Save-as-channel dialog (#274); this ticket only wires the round-trip. NEVER throws
   * out of the module (parity #490).
   */
  promoteConversation(payload: PromoteConversationPayload): void
  /**
   * Encrypt a payload-carrying `archive_conversation` control envelope onto the live session — asks the
   * daemon to archive an active conversation (a single required field: the id must resolve to an existing
   * row). The mirror-image twin of unarchiveConversation (archive sets the durable flag; unarchive clears
   * it). The `send` TWIN, not `requestDebugBundle`: an archive request has no consumer to fail, so it is an
   * inert no-op when not connected (`driver === null` → return). FIRE-AND-FORGET — no reply is correlated
   * or awaited here: the daemon confirms the flip with a `conversation_updated` record, but the desktop
   * does not correlate it (#366 reads the archived row leaving from the full re-list). Its caller is the
   * Channel Info sheet's Archive action (#366); this ticket ships the transport DORMANT. NEVER throws out
   * of the module (parity #490).
   */
  archiveConversation(payload: ArchiveConversationPayload): void
  /**
   * Encrypt a payload-carrying `unarchive_conversation` control envelope onto the live session — asks the
   * daemon to restore an archived conversation to active (a single required field: the id must resolve to
   * an existing row). The `send` TWIN, not `requestDebugBundle`: an unarchive request has no consumer to
   * fail, so it is an inert no-op when not connected (`driver === null` → return). FIRE-AND-FORGET — no
   * reply is correlated or awaited here: the daemon confirms the flip with a `conversation_updated` record,
   * but the desktop does not correlate it (#348 reads the restored state from the full re-list). Its caller
   * is the Archive screen's restore row (#348); this ticket ships the transport DORMANT. NEVER throws out
   * of the module (parity #490).
   */
  unarchiveConversation(payload: UnarchiveConversationPayload): void
  /**
   * Encrypt a payload-carrying `delete_conversation` control envelope onto the live session — asks the
   * daemon to PERMANENTLY delete a conversation (a single required field: the id must resolve to an
   * existing row). Unlike archive/unarchive (which flip a durable soft-state flag on a surviving row),
   * delete removes the row outright. The `send` TWIN, not `requestDebugBundle`: a delete request has no
   * consumer to fail, so it is an inert no-op when not connected (`driver === null` → return).
   * FIRE-AND-FORGET — no reply is correlated or awaited here: the daemon confirms with a DISTINCT
   * `conversation_deleted { id }` record correlated to the requester (`in_reply_to`), with NO broadcast,
   * so there is no free re-list reflection. Decoding that reply and reflecting the removal via an explicit
   * re-list are owned by the Channel Info sheet's Delete action (#367), NOT here. This ticket ships the
   * transport DORMANT (no caller). NEVER throws out of the module (parity #490).
   */
  deleteConversation(payload: DeleteConversationPayload): void
  /**
   * Encrypt a payload-carrying `rename_conversation` control envelope onto the live session — asks the
   * daemon to change one conversation's stored name (two required fields: the id must resolve to an
   * existing row; `name` is the new display text). The `send` TWIN, not `requestDebugBundle`: a rename
   * request has no consumer to fail, so it is an inert no-op when not connected (`driver === null` →
   * return). FIRE-AND-FORGET — no reply is correlated or awaited here: the daemon confirms the rename by
   * replying with a `conversation_updated` record, but the desktop does not correlate it (#360 reads the
   * new name from the full re-list). Its caller is the Rename dialog (#360); this ticket ships the
   * transport DORMANT. NEVER throws out of the module (parity #490).
   */
  renameConversation(payload: RenameConversationPayload): void
  /**
   * Encrypt a payload-carrying `change_workspace` control envelope onto the live session — asks the
   * daemon to move one conversation's recorded workspace to a different folder (two required fields: the
   * id must resolve to an existing row; `cwd` is the target workspace path). `cwd` is renderer-supplied
   * text the daemon resolves SERVER-side (#823) — the desktop never touches a local filesystem path. The
   * `send` TWIN, not `requestDebugBundle`: a change-workspace request has no consumer to fail, so it is an
   * inert no-op when not connected (`driver === null` → return). FIRE-AND-FORGET — no reply is correlated
   * or awaited here: the daemon confirms the change by replying with the existing `conversation_updated`
   * record, decoded by the existing inbound path and reflected in the list for free, but the desktop does
   * not correlate it (the Workspace Picker reads the new workspace from the full re-list). Its caller is
   * the Workspace Picker UI (#157's remaining slice); this ticket ships the transport DORMANT. NEVER
   * throws out of the module (parity #490).
   */
  changeWorkspace(payload: ChangeWorkspacePayload): void
  /**
   * Encrypt a payload-carrying `set_session_settings` control envelope onto the live session — asks the
   * daemon to change one session's model / reasoning effort / YOLO (pyrycode #844/#845). Honors the
   * omitempty PRESENCE CONTRACT via the builder: an unset field is absent ("leave unchanged"), a field
   * present at its zero value (`''` / `false`) is sent ("set to this value"). The `send` TWIN, not
   * `requestDebugBundle`: a settings change has no consumer to fail, so it is an inert no-op when not
   * connected (`driver === null` → return). The reply arrives asynchronously as one
   * `session_settings_updated` frame, decoded by #264 and correlated HERE (#261) back to the originating
   * request by `Envelope.in_reply_to`: `changeId` is a renderer-minted, client-internal correlation key
   * remembered against the request's envelope id and echoed onto the confirmed event so the renderer can
   * tell two same-`session_id` changes apart. `changeId` NEVER rides the wire (the builder consumes only
   * `payload`). An empty/unknown `session_id` is the daemon's `session.not_found` to reject (no main-side
   * guard, like `archiveConversation`). Its caller is the interactive Run-config controls (#257); ships
   * dormant. NEVER throws out of the module (parity #490).
   */
  setSessionSettings(payload: SetSessionSettingsPayload, changeId: string): void
  /**
   * Resolve an outstanding permission/trust modal with the user's answer (#236): MINT a fresh
   * client-side idempotency `answer_token` (main-side — the renderer never mints), fold it into a
   * `modal_answer` envelope alongside the `modal_id` + `option_id`, and encrypt it onto the live
   * session. `modal_id` is the sole correlation key (ADR 0009). The `send` TWIN, not
   * `requestDebugBundle`: a modal resolution has no consumer to fail, so it is an inert no-op when not
   * connected (`driver === null` → return). A replayed/reordered answer is inert daemon-side
   * (first-answer-wins on `modal_id`). NEVER throws out of the module (parity #490).
   */
  answerModal(payload: Omit<ModalAnswerPayload, 'answer_token'>): void
  /**
   * Cancel an outstanding modal from the desktop (#236): encrypt a `modal_cancel` envelope keyed by
   * `modal_id` (the sole correlation key, ADR 0009) onto the live session. The `send` TWIN: an inert
   * no-op when not connected. NEVER throws out of the module (parity #490).
   */
  cancelModal(payload: ModalCancelPayload): void
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
  // The main-side answer_token mint (#236). Default: crypto.randomUUID (Node CSPRNG). A DI seam like
  // now / createDriver — the renderer never mints (the token needs randomness, stays out of the web
  // layer). It is an anti-replay idempotency key, not a credential; uniqueness + stability suffice.
  const mintToken = deps.mintToken ?? ((): string => randomUUID())

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
  // `null` before/between requests AND after any connection teardown (#505); a settled reassembler
  // stays referenced but inert (its own `settled` flag absorbs stray late frames) until the next
  // request replaces it, or until failBundleStream() releases it.
  let reassembler: BundleReassembler | null = null
  // modal_ids whose modal_answer (#236) is awaiting the daemon's reply (#248). FIFO: the wire `error`
  // (#116) carries no modal_id (ADR 0009), so a rejection dequeues the OLDEST outstanding answer.
  // Pushed after a successful send in answerModal, drained by a matching modal_dismissed (the answer
  // was accepted), and reset on each dial() (a fresh connection starts with no correlation). Single-
  // writer — every mutation runs to completion inside a synchronous answerModal / onDriverEvent body,
  // no await between a read and a write (the nextEnvelopeId single-writer rationale above).
  const outstandingAnswers: string[] = []
  // envelopeId → renderer-minted changeId, for the set_session_settings confirmed round-trip (#261). A
  // per-connection correlation store: set after a successful send in setSessionSettings, matched by the
  // reply's Envelope.in_reply_to and deleted in onDriverEvent, and cleared on each dial(). Single-writer
  // — every mutation runs to completion inside a synchronous setSessionSettings / onDriverEvent body, no
  // await between a read and a write (the nextEnvelopeId / outstandingAnswers single-writer rationale).
  const pendingSettings = new Map<number, string>()
  // Envelope ids of outstanding create_workspace_folder requests, for the #396 rejection round-trip. A
  // Set, not a Map: the workspaceFolderRejected event is BARE (no value to carry per entry, contrast
  // pendingSettings' changeId) — only membership ("is this envelope id an outstanding create-folder
  // request?") matters. Keyed by the request's unique envelope id (not a FIFO like outstandingAnswers,
  // whose `error` carries no discriminating id), so a match is unambiguously the reply to THAT request.
  // Set after a successful send in createWorkspaceFolder, matched by the reply's Envelope.in_reply_to and
  // deleted in onDriverEvent, and cleared on each dial(). Single-writer — every mutation runs to completion
  // inside a synchronous createWorkspaceFolder / onDriverEvent body, no await between a read and a write
  // (the nextEnvelopeId / outstandingAnswers / pendingSettings single-writer rationale).
  const pendingCreateFolders = new Set<number>()

  function emitFailed(code: string, message = messageFor(code)): void {
    emitDaemonEvent(sink, { type: 'failed', error: { code, message, retryable: false } })
    // The single failure choke point (all five classifications) shadows onto the log — the static
    // `code` only, never the `message` param (which interpolates the numeric close code, #127's leg).
    deps.diagnosticLog?.event({ event: 'daemon-failed', code })
  }

  // The connection-teardown net for an in-flight bundle stream (#116, extended to the two
  // lifecycle events it missed by #505). A teardown is stream-fatal: the supervisor re-dials into a
  // FRESH Noise session with no resume, so the daemon-side request dies and the remaining chunks
  // never arrive — with no timeout in the reassembler, an unfailed consumer never settles and the
  // orchestrator's single-in-flight flag wedges the feature for the process lifetime.
  //
  // Release-then-fail, not fail-then-release: `consumer.fail` runs synchronously inside this call,
  // so clearing the field first means the module holds no reference to a stream it has already
  // abandoned while that consumer runs (and a re-entrant requestDebugBundle could not have its
  // freshly-armed slot nulled out from under it — it cannot re-enter today, since the real
  // consumer's fail is an asynchronous webContents.send, but the ordering costs nothing).
  //
  // Idempotent and total: `?.` absorbs an empty slot and the reassembler's own `settled` flag
  // absorbs a second fail, so calling it twice or with nothing armed is a no-op. That is what keeps
  // "exactly one terminal" a property of construction rather than of a guard here.
  //
  // Nulling is byte-release hygiene, NOT terminal correctness (`settled` already owns that): it
  // drops the abandoned stream's accumulated decrypted chunk bytes, which otherwise stay referenced
  // until the next request replaces the slot.
  function failBundleStream(): void {
    const abandoned = reassembler
    reassembler = null
    abandoned?.fail('connection-lost')
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
          case 'daemon-error': {
            // Settings-rejection correlation takes PRECEDENCE over both co-consumers (#269). Correlate
            // the error to a pending set_session_settings request by Envelope.in_reply_to FIRST — the
            // confirmed-reply shape (#261) keyed off `daemon-error` instead of `session-settings-updated`.
            // A match consumes the frame ENTIRELY: emit the client-minted changeId as a rejection, drop
            // the pending entry (AC5), and skip BOTH the reassembler.fail and the modal-FIFO shift below
            // (AC2). An error correlated by a UNIQUE per-request envelope id is unambiguously the reply to
            // THAT request — neither a bundle error nor a modal-answer rejection — so failing a healthy
            // in-flight bundle on it would be a bug. An absent in_reply_to short-circuits before the map
            // lookup; a no-match (stale id, or a hostile daemon forging a rejection for a change the
            // client never dispatched) falls through unchanged (AC3). The emitted event carries ONLY the
            // client's OWN changeId, never a field read from the untrusted error payload (AC1/AC4 no-echo).
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo !== undefined) {
              const changeId = pendingSettings.get(inReplyTo)
              if (changeId !== undefined) {
                pendingSettings.delete(inReplyTo)
                emitDaemonEvent(sink, { type: 'sessionSettingsRejected', changeId })
                return
              }
              // create_workspace_folder rejection correlation (#396), the settings-rejection sibling in the
              // same unique-per-request-id tier. Correlate the content-free error to a pending
              // create_workspace_folder request by Envelope.in_reply_to; a match consumes the frame
              // ENTIRELY: emit the BARE rejection, drop the pending entry, and skip BOTH the reassembler.fail
              // and the modal-FIFO shift below (AC4). An error correlated by a UNIQUE per-request envelope id
              // is unambiguously the reply to THAT request — failing a healthy in-flight bundle or consuming
              // the oldest modal answer on it would be a bug. Order relative to the settings check is
              // immaterial: an envelope id is minted once, so at most one of the two sets can hold it. The
              // emitted event reads NOTHING from the untrusted error payload — it is nullary by construction
              // (AC3 no-echo); the numeric inReplyTo stays main-internal, never placed on the event.
              if (pendingCreateFolders.has(inReplyTo)) {
                pendingCreateFolders.delete(inReplyTo)
                emitDaemonEvent(sink, { type: 'workspaceFolderRejected' })
                return
              }
            }
            reassembler?.fail('daemon-error')
            // Correlate the content-free error against the oldest outstanding modal_answer (#248). The
            // wire `error` carries no modal_id (ADR 0009), so a rejection dequeues in send order. An
            // empty queue → shift() is undefined → no event, preserving the prior drop / reassembler-
            // only behaviour (AC2). The emitted modalId is the client's OWN outstanding-queue value,
            // never read from the untrusted error payload (AC3 no-echo). Independent of the reassembler
            // above — a bundle error still fails the bundle; a rejection emits iff an answer is
            // outstanding (the documented, accepted double-fire on the rare overlap).
            const rejectedModalId = outstandingAnswers.shift()
            if (rejectedModalId !== undefined) {
              emitDaemonEvent(sink, { type: 'modalAnswerRejected', modalId: rejectedModalId })
            }
            return
          }
          case 'session-settings':
            // The run-configuration data path (#491). A fresh literal with named fields, never a
            // spread of inbound.sessionSettings — so a future decoder that grew a field cannot
            // smuggle it across. snake→camel for the id only (`sessionId`), matching the
            // sessionTransition arm; the five value fields keep their wire names, so the event
            // reads the way the daemon's reply does.
            //
            // `session_id: ''` crosses VERBATIM. It is the daemon saying "I have no session to
            // address", which the sheet's gate must be able to see; coercing it to null here would
            // make it indistinguishable from "no reply yet" and re-open the inert-sheet defect one
            // layer down.
            emitDaemonEvent(sink, {
              type: 'runConfigReceived',
              sessionId: inbound.sessionSettings.session_id,
              model: inbound.sessionSettings.model,
              effort: inbound.sessionSettings.effort,
              yolo: inbound.sessionSettings.yolo,
              used_tokens: inbound.sessionSettings.used_tokens,
              window_tokens: inbound.sessionSettings.window_tokens
            })
            return
          case 'assistant-delta':
            // The interactive-stream data path (#199, widened by #751). snake→camel here (wire is snake,
            // IPC is camel). A fresh literal with named fields carrying the turn id, the seq, the text and
            // `conversationId` — never a spread of the decoded payload, so a decoder that later grows a
            // field cannot smuggle it across IPC. This emit IS the idiom the arms below cite by name, so
            // it must keep exemplifying it. The decode stays fail-closed upstream and needed no change
            // here: parseAssistantDeltaPayload already requires `conversation_id`, so a missing or
            // non-string one drops the whole line without emitting — which is why the id is read BARE.
            // Reaching for `?? ''` would turn that fail-closed drop into a silent misattribution.
            //
            // Unlike snapshot, `text` IS carried — it is the render payload (#203), not a secret. The id
            // beside it is a daemon-asserted routing key, not rendered text, and it reaches no sink on
            // this leg. It stops at the timeline bridge (#202), which rebuilds a fresh ThreadEvent from
            // named fields and omits it; the consumers that route by conversation are #756. Deliberately
            // stateless: one event per frame in arrival order, coalescing is the reducer's job, and the
            // added field brings no per-id buffer, dedup or last-seq memo with it.
            emitDaemonEvent(sink, {
              type: 'assistantDelta',
              turnId: inbound.delta.turn_id,
              seq: inbound.delta.seq,
              text: inbound.delta.text,
              conversationId: inbound.delta.conversation_id
            })
            return
          case 'turn-end':
            // The turn-boundary data path (#199, widened by #752). snake→camel here, following the
            // assistant-delta idiom above: a fresh literal with named fields carrying the turn id, the
            // stop reason and `conversationId` — never a spread of the decoded payload, so a decoder
            // that later grows a field cannot smuggle it across IPC. The decode stays fail-closed
            // upstream and needed no change here: parseTurnEndPayload already requires
            // `conversation_id`, so a missing or non-string one drops the whole line without emitting
            // — which is why the id is read BARE. Reaching for `?? ''` would turn that fail-closed drop
            // into a silent misattribution, closing the wrong thread's turn (#675).
            //
            // The id is a daemon-asserted routing key, not rendered text, and it reaches no sink on
            // this leg. It stops at the timeline bridge (#202), which rebuilds a fresh ThreadEvent from
            // named fields and omits it; the consumers that route by conversation are #756.
            emitDaemonEvent(sink, {
              type: 'turnEnd',
              turnId: inbound.turnEnd.turn_id,
              stopReason: inbound.turnEnd.stop_reason,
              conversationId: inbound.turnEnd.conversation_id
            })
            return
          case 'turn-state':
            // The coarse-phase data path (#214, widened by #724). Emit a fresh literal carrying `state`
            // plus `conversationId`, the latter copied BY NAME from the already-decoded, already-validated
            // payload — never a spread of inbound.turnState (the assistant-delta idiom), so a decoder that
            // later grows a field cannot smuggle it across IPC. The decode stays fail-closed upstream: a
            // missing or non-string `conversation_id` drops the whole line without emitting.
            //
            // The id is a daemon-asserted routing key, not rendered text, and it reaches no sink on this
            // leg. It stops at the timeline bridge (#202), which maps this onto the reducer's `phase` and
            // omits the id; the consumers that route by conversation are #674.
            emitDaemonEvent(sink, {
              type: 'turnState',
              state: inbound.turnState.state,
              conversationId: inbound.turnState.conversation_id
            })
            return
          case 'stall':
            // The stall-liveness data path (#315, widened by #732). Emit a fresh literal carrying
            // `conversationId`, copied BY NAME from the already-decoded, already-validated payload —
            // never a spread of inbound.stall (the assistant-delta idiom), so a decoder that later grows
            // a field cannot smuggle it across IPC. The decode stays fail-closed upstream: a missing or
            // non-string `conversation_id` drops the whole line without emitting.
            //
            // The id is a daemon-asserted routing key, not rendered text, and it reaches no sink on this
            // leg. It stops at the timeline bridge (#202), which rebuilds a nullary ThreadEvent and omits
            // it; the consumers that route by conversation are #674. Onset-only: no de-dup / timer state
            // here — the render slice (#317), not this leg, owns the self-clear on next turn activity,
            // and the added field must not tempt anyone into memoising by id. Not compile-forced (this
            // inner switch has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'stallDetected',
              conversationId: inbound.stall.conversation_id
            })
            return
          case 'api-retry':
            // The api-retry status data path (#492, widened by #737). Emit a fresh literal carrying the
            // edge + the counter + `conversationId`, all copied BY NAME from the already-decoded,
            // already-validated payload — never a spread of inbound.apiRetry (the assistant-delta idiom),
            // so a decoder that later grows a field cannot smuggle it across IPC. The decode stays
            // fail-closed upstream: a missing or non-string `conversation_id` drops the whole line
            // without emitting.
            //
            // The id is a daemon-asserted routing key, not rendered text, and it reaches no sink on this
            // leg. It stops at the timeline bridge (#202), which rebuilds a four-field ThreadEvent and
            // omits it; the consumers that route by conversation are #674. Deliberately stateless: no
            // dedup, no coalescing, no timer, no last-value memo — and none keyed by the new id either,
            // which is what gives the wire's "re-fires as the count climbs" contract for free; adding
            // edge tracking here would swallow a legitimate count change. Not compile-forced (this inner
            // switch has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'apiRetry',
              active: inbound.apiRetry.active,
              current: inbound.apiRetry.current,
              total: inbound.apiRetry.total,
              conversationId: inbound.apiRetry.conversation_id
            })
            return
          case 'compacting':
            // The compaction-status data path (#495, widened by #742). Emit a fresh literal carrying
            // the edge + `conversationId`, both copied BY NAME from the already-decoded,
            // already-validated payload — never a spread of inbound.compacting (the assistant-delta
            // idiom), so a decoder that later grows a field cannot smuggle it across IPC. The decode
            // stays fail-closed upstream: a missing or non-string `conversation_id` drops the whole
            // line without emitting.
            //
            // The id is a daemon-asserted routing key, not rendered text, and it reaches no sink on
            // this leg. It stops at the timeline bridge (#202), which rebuilds a one-field ThreadEvent
            // and omits it; the consumers that route by conversation are #674. Deliberately stateless:
            // no dedup, no coalescing, no timer, no last-value memo — and none keyed by the new id
            // either, which is what gives the wire's "a repeated same-edge frame emits its own event"
            // contract for free — #496 is idempotent on it. Not compile-forced (this inner switch has
            // no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'compacting',
              active: inbound.compacting.active,
              conversationId: inbound.compacting.conversation_id
            })
            return
          case 'model-announced':
            // The announced-model data path (#587, #714). Emit a fresh literal carrying the identifier, the
            // cut report and the routing key, copied BY NAME from the already-decoded, already-validated
            // payload — never a spread of inbound.modelAnnounced (the assistant-delta idiom), so a
            // decoder that later grows a field cannot smuggle it across IPC. `model` crosses VERBATIM:
            // no normalising, no lowercasing, no allow-list, no family regex — an identifier claude
            // announces need not be dated or published, so anything narrower here would drop a valid
            // value. `truncated` crosses WITH it: dropping it would make #588 silently wrong, since a
            // cut identifier always misses an exact lookup and would render as a legitimate unknown
            // model. `conversation_id` crosses WITH them as `conversationId` (#714): a daemon-asserted
            // routing key, not rendered text, and it reaches no sink on this leg. The argument here used
            // to be ARITHMETIC — that dropping it left exactly one untrusted string crossing rather than
            // two — and it is REPLACED, not renumbered: the id is not untrusted text of `model`'s kind,
            // and `model` keeps its warnings in full. It stops at the announced-model bridge (#588), which
            // rebuilds a fresh two-field literal from named fields; the consumers that route by conversation
            // are #588 / #674, where an unknown id must be an explicit no-match, never a fallback onto the
            // open conversation. Deliberately stateless: no dedup, no coalescing, no timer, no last-value
            // memo — and none keyed by the new id either — the same identifier repeats turn after turn and
            // suppressing a repeat would invent wire semantics the daemon does not have, starving #588 of
            // the re-announcement that says the value is still current. Not compile-forced (this inner
            // switch has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'modelAnnounced',
              model: inbound.modelAnnounced.model,
              truncated: inbound.modelAnnounced.truncated,
              conversationId: inbound.modelAnnounced.conversation_id
            })
            return
          case 'background-task-started':
            // The background-task open data path (#564). Emit a fresh literal carrying all six fields,
            // copied BY NAME from the already-decoded, already-validated payload — never a spread of
            // inbound.backgroundTaskStarted (the assistant-delta idiom), so a decoder that later grows a
            // field cannot smuggle it across IPC. snake→camel throughout; `truncatedFields` passes the
            // narrowed array by reference (requireStringArrayOrNull already returned a fresh, fully
            // validated string[], so there is nothing left to strip — the `queued` precedent below), and
            // its `null` is preserved, never coerced to [].
            //
            // `conversation_id` is KEPT by the rule, not by comparison with a neighbour: this frame
            // carries no turn_id and opens no turn, so it is daemon STATE, not a turn-stream item —
            // the queue-state rule (#720), and #567 attributes tasks by id.
            //
            // Deliberately stateless: no dedup, no task map, no correlation memory. The wire's ordering
            // is claude's, not the daemon's (a roster can arrive before the `started` for a task it
            // lists), so buffering here would be wrong — #567 joins on task_id instead. Not
            // compile-forced (this inner switch has no assertNever) — the round-trip test guards this
            // emit.
            emitDaemonEvent(sink, {
              type: 'backgroundTaskStarted',
              conversationId: inbound.backgroundTaskStarted.conversation_id,
              taskId: inbound.backgroundTaskStarted.task_id,
              toolCallId: inbound.backgroundTaskStarted.tool_call_id,
              description: inbound.backgroundTaskStarted.description,
              taskType: inbound.backgroundTaskStarted.task_type,
              truncatedFields: inbound.backgroundTaskStarted.truncated_fields
            })
            return
          case 'background-task-updated':
            // The background-task change data path (#565) — the subset twin of the arm above. A fresh
            // literal carrying all FOUR fields (no toolCallId / description / taskType on this frame),
            // copied BY NAME from the already-decoded, already-validated payload — never a spread of
            // inbound.backgroundTaskUpdated, so a decoder that later grows a field cannot smuggle it
            // across IPC. snake→camel throughout; `truncatedFields` passes the narrowed array by
            // reference and its `null` is preserved, never coerced to []. `patch` crosses byte-for-byte:
            // it is an opaque blob the daemon may have truncated mid-token, so nothing here parses,
            // normalizes, or re-serializes it.
            //
            // `conversation_id` is KEPT for the sibling's reason — daemon STATE keyed by id (the
            // queue-state rule, #720), not a turn-stream item; #567 attributes tasks by id.
            //
            // Deliberately stateless, and the temptation is sharper here than on any neighbouring arm:
            // this frame is DEFINITIONALLY an update to a prior one, so joining it against the
            // `background_task_started` set looks natural. It would be wrong — the join would be the
            // only mutable state in this leg, keyed by an attacker-influenceable task_id and fed by a
            // hostile daemon's frame stream. Ordering is claude's, not the daemon's, so an update for a
            // task this client never saw opened is a legal frame that must emit, not buffer. #567 joins
            // on task_id instead. Not compile-forced (this inner switch has no assertNever) — the
            // round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'backgroundTaskUpdated',
              conversationId: inbound.backgroundTaskUpdated.conversation_id,
              taskId: inbound.backgroundTaskUpdated.task_id,
              patch: inbound.backgroundTaskUpdated.patch,
              truncatedFields: inbound.backgroundTaskUpdated.truncated_fields
            })
            return
          case 'background-task-roster':
            // The background-task roster data path (#566) — the AGGREGATE peer of the two arms above:
            // they report what happened to one task, this reports what is ALIVE. A fresh named-field
            // literal at the TOP level, copied BY NAME from the already-decoded, already-validated
            // payload — never a spread of inbound.backgroundTaskRoster, so a decoder that later grows a
            // field cannot smuggle it across IPC. `tasks` passes the already-narrowed row array BY
            // REFERENCE: parseBackgroundTask returned fresh four-field literals, so there is nothing left
            // to strip — exactly the `queued` precedent below, including NO snake→camel on the row and no
            // per-row re-literal. An EMPTY tasks array emits normally; it is never filtered, coalesced,
            // or treated as "nothing to report" — it is the positive "nothing is alive" signal, the
            // payoff of the whole family.
            //
            // `conversation_id` is KEPT for the siblings' reason — daemon STATE keyed by id (the
            // queue-state rule, #720), not a turn-stream item; #567 attributes tasks by id.
            //
            // Deliberately stateless, and the temptation here is a DIFFERENT one from the arm above:
            // that frame tempted a join, this one tempts a DIFF. It is a snapshot, the family has no
            // terminal event, and "a task vanished from the roster" is the only available finish signal —
            // so holding the previous roster to compute what disappeared looks like the obvious next
            // step. It would be wrong: the only mutable state in this leg, keyed by an
            // attacker-influenceable task_id, fed by a hostile daemon's frame stream, and with each frame
            // carrying an attacker-chosen NUMBER of rows it is a growth surface a flood can drive. The
            // daemon is explicit that the finish inference is the client's own conclusion; #567 owns that
            // decision and its own bounding. Ordering is claude's, so a roster can arrive BEFORE the
            // `background_task_started` for a task it lists — emit what decoded, never hold one back
            // waiting for rows to be explained. Not compile-forced (this inner switch has no
            // assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'backgroundTaskRoster',
              conversationId: inbound.backgroundTaskRoster.conversation_id,
              tasks: inbound.backgroundTaskRoster.tasks,
              droppedTasks: inbound.backgroundTaskRoster.dropped_tasks
            })
            return
          case 'unrecognized-message':
            // The parser-gap diagnostic data path. Emit a fresh literal carrying the four display
            // fields, copied BY NAME from the already-decoded, already-validated payload — never a
            // spread of inbound.unrecognized, so a decoder that later grows a field cannot smuggle it
            // across IPC. That discipline earns its keep here more than anywhere: this is the arm whose
            // payload is unbounded daemon-relayed JSON, so the field list must be the one an operator
            // agreed to render, not whatever arrived. `conversation_id` is DROPPED (never referenced —
            // single active conversation). Deliberately stateless: no dedup
            // and no coalescing, because a repeat is a REAL repeat and how often this fires is the
            // number that tells you to go fix something. Not compile-forced (this inner switch has no
            // assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'unrecognizedMessage',
              site: inbound.unrecognized.site,
              messageType: inbound.unrecognized.message_type,
              raw: inbound.unrecognized.raw,
              truncated: inbound.unrecognized.truncated
            })
            return
          case 'session-transition':
            // The session-boundary data path (#254, widened #285). Emit a fresh literal carrying the four
            // fields the delimiter slice (#286) reads — `newSessionId`, `reason`, `occurredAt`,
            // `workspaceCwd` — copied by name from the already-decoded, already-validated payload (so a
            // malformed marker still fails closed upstream in parseSessionTransitionPayload, before this
            // runs). Only `previous_session_id` is DROPPED — it has no consumer. Never a spread of the
            // decoded payload (the assistant-delta idiom), so only the four named fields cross IPC and a
            // decoder that ever grew an extra field cannot smuggle it across. `workspace_cwd` is
            // `string | null` and carried through unchanged — the null is preserved, not coerced. A
            // session_id is a routing id, not a secret (the conversation_id convention).
            emitDaemonEvent(sink, {
              type: 'sessionTransition',
              newSessionId: inbound.sessionTransition.new_session_id,
              reason: inbound.sessionTransition.reason,
              occurredAt: inbound.sessionTransition.occurred_at,
              workspaceCwd: inbound.sessionTransition.workspace_cwd
            })
            return
          case 'session-settings-updated': {
            // The set_session_settings confirmed round-trip (#261). Correlation-gated, fail-closed: match
            // the reply to its originating request by Envelope.in_reply_to, then emit the client-minted
            // changeId so the renderer can tell two same-session_id changes apart. A reply with an absent
            // in_reply_to short-circuits BEFORE the map lookup; a reply matching no pending entry (a stale
            // reply, or a hostile daemon forging a confirmation for a change the client never dispatched)
            // is ignored — no coercion (AC3). The emitted event carries `sessionId` (the reply's field) +
            // `changeId` (the map value) in a FRESH literal — never a spread of the decoded payload, and
            // the numeric in_reply_to is NEVER placed on the event (the renderer receives its own changeId,
            // not the wire routing id). A session_id is a routing id, not a secret. Consumed by #256.
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo === undefined) return
            const changeId = pendingSettings.get(inReplyTo)
            if (changeId === undefined) return
            pendingSettings.delete(inReplyTo)
            emitDaemonEvent(sink, {
              type: 'sessionSettingsUpdated',
              sessionId: inbound.sessionSettingsUpdated.session_id,
              changeId
            })
            return
          }
          case 'tool-use':
            // The tool-call data path (#217). snake→camel here; `conversation_id` is DROPPED (single
            // active conversation; #202's bridge scopes identity). A fresh literal with the five named
            // fields, never a spread of the decoded payload, so only the render fields cross IPC. The
            // timeline bridge (#202), not the session store, folds this into a pending `toolCall` item.
            // `input` (#642) crosses BY REFERENCE to the already-narrowed fresh map (the `queued`
            // precedent below): parseToolUsePayload built it from own string values with the reserved
            // keys removed, so there is nothing left to drop and no second copy is warranted. Assigned
            // unconditionally — `undefined` when the wire omitted it (a pre-pyrycode#1678 daemon), which
            // structured clone and JSON.stringify both drop.
            emitDaemonEvent(sink, {
              type: 'toolUse',
              turnId: inbound.toolUse.turn_id,
              toolUseId: inbound.toolUse.tool_use_id,
              name: inbound.toolUse.name,
              inputSummary: inbound.toolUse.input_summary,
              input: inbound.toolUse.input
            })
            return
          case 'tool-result':
            // The tool-result data path (#229). snake→camel here; `conversation_id` is DROPPED (single
            // active conversation; #202's bridge scopes identity). A fresh literal with the four named
            // fields, never a spread of the decoded payload, so only the render fields cross IPC. The
            // timeline bridge (#202), not the session store, folds this through `fillResult` to resolve
            // the correlated `toolCall`'s result in place. `isError` is a boolean; `false` is a value.
            emitDaemonEvent(sink, {
              type: 'toolResult',
              turnId: inbound.toolResult.turn_id,
              toolUseId: inbound.toolResult.tool_use_id,
              isError: inbound.toolResult.is_error,
              resultSummary: inbound.toolResult.result_summary
            })
            return
          case 'queue-state':
            // The queued-backlog data path (#292). Emit a fresh literal carrying `conversationId` (snake→
            // camel) plus the already-narrowed backlog by reference — unlike toolUse this KEEPS
            // conversation_id, because the snapshot is REPLACEMENT-truth and #293 keys its backlog by it. The
            // `queued` array passes through verbatim (parseQueuedItem already stripped each item to the three
            // known fields, nothing to drop, no snake→camel on the row) — the `conversations` precedent. A
            // fresh top-level literal, never a spread of the decoded payload. Consumed by the #293 queue
            // store, not the session / timeline / modal store — queue_state is daemon state (#720).
            emitDaemonEvent(sink, {
              type: 'queueState',
              conversationId: inbound.queueState.conversation_id,
              queued: inbound.queueState.queued
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
          case 'recent-workspaces':
            // The recent-workspaces data path (#380). Verbatim passthrough (the `conversations`
            // precedent): parseRecentWorkspace already stripped each row to its two known fields, nothing
            // to drop (no secret field), so the RecentWorkspace[] reference passes through — no
            // re-construction, field names stay snake_case (the event reuses the wire row type). The
            // recent-workspaces store (#382), not the session store, consumes this. `path` is untrusted
            // display text. Not compile-forced (this inner switch has no assertNever) — the round-trip
            // test guards this emit.
            emitDaemonEvent(sink, {
              type: 'recentWorkspacesReceived',
              recentWorkspaces: inbound.recentWorkspaces
            })
            return
          case 'conversation-created':
            // The conversation-created data path (#241). Verbatim passthrough (the `conversations`
            // precedent): parseConversationCreatedPayload already returned a fresh 5-field object with
            // nothing to drop (no secret field), so the reference passes through — no re-construction.
            // Field names stay snake_case (the event reuses the wire type). The render slice (#242),
            // not the session store, opens the new thread. `name` / `cwd` are untrusted display text.
            emitDaemonEvent(sink, {
              type: 'conversationCreated',
              conversation: inbound.conversationCreated
            })
            return
          case 'workspace-folder-created':
            // The workspace-folder-created data path (#381). A CORRELATED reply (matched by in_reply_to,
            // NOT a broadcast), but the `path` is self-sufficient so it is emitted unconditionally on
            // decode — NO outstanding-request / correlation state is threaded here (#157 consumes the
            // created path). A fresh literal naming the single `path` field, never a spread of the decoded
            // payload, so a decoder that ever grew an extra field cannot smuggle it across IPC. The
            // Create-folder dialog (#157), not the session store, consumes this. `path` is an untrusted
            // REMOTE path — plain-text-only, never resolved locally. Not compile-forced (this inner switch
            // has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'workspaceFolderCreated',
              path: inbound.workspaceFolderCreated.path
            })
            return
          case 'conversation-updated':
            // The conversation-updated data path (#273). An UNSOLICITED daemon BROADCAST (not correlated
            // by in_reply_to), so it is emitted unconditionally on decode — no outstanding-request memory.
            // Verbatim passthrough (the `conversation-created` precedent): parseConversationUpdatedPayload
            // already returned a fresh 5-field object with nothing to drop (no secret field), so the
            // reference passes through — no re-construction. Field names stay snake_case (the event reuses
            // the wire type). The list-reflect slice (#275), not the session store, reconciles the row.
            // `name` / `cwd` are untrusted display text.
            emitDaemonEvent(sink, {
              type: 'conversationUpdated',
              conversation: inbound.conversationUpdated
            })
            return
          case 'conversation-deleted':
            // The conversation-deleted data path (#375). A CORRELATED reply (matched by in_reply_to, NOT a
            // broadcast — the deliberate contrast with the conversation-updated arm), but the `id` is
            // self-sufficient so it is emitted unconditionally on decode — NO outstanding-request /
            // correlation state is threaded here (#376 removes the row by id). A fresh literal naming the
            // single `id` field, never a spread of the decoded payload, so a decoder that ever grew an
            // extra field cannot smuggle it across IPC. The list-reflect slice (#376), not the session
            // store, reconciles the removal. Not compile-forced (this inner switch has no assertNever) —
            // the round-trip test guards this emit.
            emitDaemonEvent(sink, { type: 'conversationDeleted', id: inbound.conversationDeleted.id })
            return
          case 'modal-shown':
            // The modal data path (#201). snake→camel here (`modal_id`→`modalId`,
            // `default_option_id`→`defaultOptionId`); `options` is reused verbatim (the `conversations`
            // precedent — parseModalOption already stripped each option to `{ id, label }`, nothing to
            // drop, no snake→camel on id/label). NO `conversation_id` to drop — a modal carries none.
            // A fresh literal with named fields, never a spread. The modal store + bridge (#223), not
            // the session or timeline store, consumes this. `title` / `prompt` / `options[].label` are
            // untrusted `claude`-surfaced display text the render slice (#224) must render as plain text.
            emitDaemonEvent(sink, {
              type: 'modalShown',
              modalId: inbound.modalShown.modal_id,
              class: inbound.modalShown.class,
              title: inbound.modalShown.title,
              prompt: inbound.modalShown.prompt,
              options: inbound.modalShown.options,
              defaultOptionId: inbound.modalShown.default_option_id
            })
            return
          case 'modal-dismissed': {
            // The modal-resolution data path (#201). snake→camel here; NO `conversation_id` (a modal
            // carries none). `outcome` is an opaque string carried verbatim. A fresh literal, never a
            // spread. Consumed by the modal store + bridge (#223).
            emitDaemonEvent(sink, {
              type: 'modalDismissed',
              modalId: inbound.modalDismissed.modal_id,
              outcome: inbound.modalDismissed.outcome,
              source: inbound.modalDismissed.source
            })
            // Drain the accepted answer from the correlation window (#248): a dismissal for a modal this
            // client answered confirms the answer landed, so its id must not later mis-attribute an
            // unrelated `error`. Remove the FIRST matching id; a no-op when absent (a dismissal for a
            // modal this client didn't answer — a local/timeout source, or an already-drained id).
            const answered = outstandingAnswers.indexOf(inbound.modalDismissed.modal_id)
            if (answered !== -1) outstandingAnswers.splice(answered, 1)
            return
          }
        }
        return
      }
      case 'relay-link-up':
        // The relay-socket leg came up (#328) — a signal distinct from the session `connecting` /
        // `connected` / `failed` arms. A fresh literal (the established emit discipline); the relay
        // socket being up carries no data to classify.
        emitDaemonEvent(sink, { type: 'relayLinkChanged', status: 'connected' })
        return
      case 'relay-link-down': {
        // A retryable close is stream-fatal too (#505): the supervisor auto-re-dials into a fresh
        // session the daemon-side request does not survive. Fail first, then emit — the terminal
        // arm's order. Above the classification below, so the emitted bundle failure is identical
        // for every close code and discloses nothing about it.
        failBundleStream()
        // The relay socket dropped with a retryable close (#328). This is the single classification
        // choke point (untrusted WS close code → closed RelayLinkStatus category): 4404 is the
        // relay's "reachable, no daemon registered" close → 'daemon-absent'; every other retryable
        // code is an ordinary drop → 'offline'. The raw code is DROPPED here — only the classified
        // category crosses IPC (AC3, content-free). No log call: #127 already logs the close code
        // content-free at relayConnection.ts, and this arm carries no secret.
        const status = event.code === RELAY_NO_DAEMON_CLOSE_CODE ? 'daemon-absent' : 'offline'
        emitDaemonEvent(sink, { type: 'relayLinkChanged', status })
        return
      }
      case 'terminal':
        // A stream interrupted by a socket drop resolves the consumer (no hang, no lingering bytes).
        // Deterministic code, safe unconditionally: fail on a settled/absent reassembler is inert.
        failBundleStream()
        // A clean local stop() drives terminal{1000,'stopped'}; suppress it (the window is
        // tearing down on quit). Every other fatal close is an authoritative drop the user sees.
        // The supervisor's `reason` string is deliberately NOT forwarded (conservative).
        if (stopped) return
        emitFailed('connection-closed', `The connection to pyrybox was closed (code ${event.code}).`)
        return
      case 'error':
        // Same teardown net for a connection-level driver error mid-stream.
        failBundleStream()
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
      token: record.token,
      // Advertise `interactive` (#179): the daemon opens the v2 structured stream (turn state,
      // deltas, tool use/result, thinking, modal prompts) and accepts the interactive control verbs
      // — the mounted render pipeline (timeline + modal bridges) draws them. `interactive` is the
      // whole vocabulary, so this turns on everything a paired interactive client gets. The daemon
      // echoes the accepted intersection back in hello_ack.capabilities (surfaced on `connected`).
      capabilities: [CAPABILITY_INTERACTIVE]
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

  function requestConversations(): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A list request has no consumer to fail; a request sent
    // while disconnected simply produces no reply.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestDebugBundle — no second counter —
      // so ids stay unique across interleaved calls (the daemon correlates by id).
      const bytes = buildListConversations({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function requestSessionSettings(): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A read request has no consumer to fail; a request sent
    // while disconnected simply produces no reply, and the sheet re-requests on its next open.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestDebugBundle — no second counter —
      // so ids stay unique across interleaved calls (the daemon correlates the session_settings reply
      // by in_reply_to).
      const bytes = buildRequestSessionSettings({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function requestRecentWorkspaces(): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A list request has no consumer to fail; a request sent
    // while disconnected simply produces no reply.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestConversations — no
      // second counter — so ids stay unique across interleaved calls (the daemon correlates by id).
      const bytes = buildRecentWorkspaces({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function createConversation(payload: CreateConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A create request has no consumer to fail; a request sent
    // while disconnected simply produces no reply.
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the three modeled fields — never a spread of `payload`.
      // This is the deterministic net that bounds the wire to exactly is_promoted / name / cwd,
      // ignoring any renderer-smuggled extra field the structural-minimum guard let through (#236's
      // fresh-literal posture). Shares the one monotonic nextEnvelopeId with send / requestConversations —
      // no second counter — so ids stay unique across interleaved calls.
      const bytes = buildCreateConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          is_promoted: payload.is_promoted,
          name: payload.name,
          cwd: payload.cwd
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function createWorkspaceFolder(payload: CreateWorkspaceFolderPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A create-folder request has no consumer to fail; a request
    // sent while disconnected simply produces no reply.
    if (driver === null) return
    // Capture the id BEFORE the build increments it, so the pending entry is keyed by this request's
    // envelope id — the value the daemon echoes as in_reply_to on the rejecting error (#396).
    const envelopeId = nextEnvelopeId
    try {
      // Build a FRESH literal naming exactly the two modeled fields — never a spread of `payload`. This
      // is the deterministic net that bounds the wire to exactly parent / name, ignoring any
      // renderer-smuggled extra field the structural-minimum guard let through (the createConversation
      // fresh-literal posture). Shares the one monotonic nextEnvelopeId with send / createConversation —
      // no second counter — so ids stay unique across interleaved calls.
      const bytes = buildCreateWorkspaceFolder({
        id: envelopeId,
        ts: now(),
        payload: {
          parent: payload.parent,
          name: payload.name
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record the pending request AFTER a successful send (the setSessionSettings order, #269): a
      // build/send throw skips this (caught below), so no phantom entry is left for a reply that will
      // never come. Removed by the correlated error in onDriverEvent, or abandoned on the next dial().
      pendingCreateFolders.add(envelopeId)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function dequeueMessage(payload: DequeueMessagePayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A dequeue is ungated fire-and-forget with no consumer to
    // fail; a request sent while disconnected simply produces no effect (no reply is expected anyway).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the two modeled fields — never a spread of `payload`.
      // This is the deterministic net that bounds the wire to exactly conversation_id / queued_msg_id,
      // ignoring any renderer-smuggled extra field the structural-minimum guard let through (#236's
      // fresh-literal posture). Shares the one monotonic nextEnvelopeId with send / createConversation —
      // no second counter — so ids stay unique across interleaved calls.
      const bytes = buildDequeueMessage({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id,
          queued_msg_id: payload.queued_msg_id
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function interrupt(): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A bare interrupt has no consumer to fail and is
    // fire-and-forget; a frame sent while disconnected simply stops nothing (no session, no reply).
    if (driver === null) return
    try {
      // Bare control frame — no payload arg (the requestConversations shape, not dequeueMessage's
      // fresh-literal payload). Shares the one monotonic nextEnvelopeId with send / requestConversations —
      // no second counter — so ids stay unique across interleaved calls.
      const bytes = buildInterrupt({ id: nextEnvelopeId, ts: now() })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape empty-payload envelope cannot
      // over-cap, but driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward,
      // inherited #62) — nothing sensitive on this bare path, and the affordance (#307) is optimistic.
    }
  }

  function promoteConversation(payload: PromoteConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A promote request has no consumer to fail; a request sent
    // while disconnected simply produces no reply (the daemon's `conversation_updated` broadcast never
    // arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the three modeled fields — never a spread of `payload`.
      // This is the deterministic net that bounds the wire to exactly conversation_id / name / cwd,
      // ignoring any renderer-smuggled extra field the structural-minimum guard let through (#236's
      // fresh-literal posture). Shares the one monotonic nextEnvelopeId with send / createConversation —
      // no second counter — so ids stay unique across interleaved calls.
      const bytes = buildPromoteConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id,
          name: payload.name,
          cwd: payload.cwd
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function archiveConversation(payload: ArchiveConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). An archive request has no consumer to fail; a request sent
    // while disconnected simply produces no reply (the daemon's `conversation_updated` confirmation never
    // arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the one modeled field — never a spread of `payload`. This is
      // the deterministic net that bounds the wire to exactly conversation_id, ignoring any renderer-
      // smuggled extra field the structural-minimum guard let through (#236's fresh-literal posture).
      // Shares the one monotonic nextEnvelopeId with send / unarchiveConversation — no
      // second counter — so ids stay unique across interleaved calls.
      const bytes = buildArchiveConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function unarchiveConversation(payload: UnarchiveConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). An unarchive request has no consumer to fail; a request sent
    // while disconnected simply produces no reply (the daemon's `conversation_updated` confirmation never
    // arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the one modeled field — never a spread of `payload`. This is
      // the deterministic net that bounds the wire to exactly conversation_id, ignoring any renderer-
      // smuggled extra field the structural-minimum guard let through (#236's fresh-literal posture).
      // Shares the one monotonic nextEnvelopeId with send / promoteConversation — no
      // second counter — so ids stay unique across interleaved calls.
      const bytes = buildUnarchiveConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function deleteConversation(payload: DeleteConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A delete request has no consumer to fail; a request sent
    // while disconnected simply produces no reply (the daemon's `conversation_deleted` confirmation never
    // arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the one modeled field — never a spread of `payload`. This is
      // the deterministic net that bounds the wire to exactly conversation_id, ignoring any renderer-
      // smuggled extra field the structural-minimum guard let through (#236's fresh-literal posture).
      // Shares the one monotonic nextEnvelopeId with send / unarchiveConversation — no
      // second counter — so ids stay unique across interleaved calls.
      const bytes = buildDeleteConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function renameConversation(payload: RenameConversationPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A rename request has no consumer to fail; a request sent
    // while disconnected simply produces no reply (the daemon's `conversation_updated` confirmation never
    // arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the two modeled fields — never a spread of `payload`. This
      // is the deterministic net that bounds the wire to exactly conversation_id / name, ignoring any
      // renderer-smuggled extra field the structural-minimum guard let through (#236's fresh-literal
      // posture). Shares the one monotonic nextEnvelopeId with send / promoteConversation /
      // unarchiveConversation — no second counter — so ids stay unique across interleaved calls.
      const bytes = buildRenameConversation({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id,
          name: payload.name
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload (including
      // the user-content `name`); no log, no event (classify-don't-forward, inherited #62).
    }
  }

  function changeWorkspace(payload: ChangeWorkspacePayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A change-workspace request has no consumer to fail; a request
    // sent while disconnected simply produces no reply (the daemon's `conversation_updated` confirmation
    // never arrives, and there is no correlation memory to leave dangling).
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the two modeled fields — never a spread of `payload`. This
      // is the deterministic net that bounds the wire to exactly conversation_id / cwd, ignoring any
      // renderer-smuggled extra field the structural-minimum guard let through (#236's fresh-literal
      // posture). Shares the one monotonic nextEnvelopeId with send / renameConversation — no second
      // counter — so ids stay unique across interleaved calls.
      const bytes = buildChangeWorkspace({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id,
          cwd: payload.cwd
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload (including
      // the `cwd` path); no log, no event (classify-don't-forward, inherited #62).
    }
  }

  function setSessionSettings(payload: SetSessionSettingsPayload, changeId: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A settings change has no consumer to fail; a request sent
    // while disconnected simply produces no reply. No empty-session_id guard: an empty/unknown id is
    // the daemon's `session.not_found` to reject (mirrors archiveConversation's empty conversation_id).
    if (driver === null) return
    // Capture the id BEFORE the build increments it, so the pending entry is keyed by this request's
    // envelope id — the value the daemon echoes as in_reply_to on the confirming reply (#261).
    const envelopeId = nextEnvelopeId
    try {
      // Pass `payload` straight through — the builder owns the FRESH literal + the omitempty presence
      // contract (conditional key assignment), which doubles as the anti-smuggling net. `changeId` is
      // NEVER passed to the builder — it stays off the wire. Shares the one monotonic nextEnvelopeId
      // with send — no second counter — so ids stay unique across interleaved calls.
      const bytes = buildSetSessionSettings({ id: nextEnvelopeId, ts: now(), payload })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record the pending change AFTER a successful send (the answerModal order, #248): a build/send
      // throw skips this (caught below), so no phantom entry is left for a reply that will never come.
      // Removed by the correlated reply in onDriverEvent, or abandoned on the next dial().
      pendingSettings.set(envelopeId, changeId)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function answerModal(payload: Omit<ModalAnswerPayload, 'answer_token'>): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A modal resolution has no consumer to fail.
    if (driver === null) return
    try {
      // Mint the token into a FRESH literal naming exactly the three modeled fields — never a spread
      // of `payload`. This is the deterministic net that ignores a renderer-smuggled `answer_token`:
      // the minted value always wins, and no stale ADR-025 field can leak (#235's pinned shape).
      const bytes = buildModalAnswer({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          modal_id: payload.modal_id,
          option_id: payload.option_id,
          answer_token: mintToken()
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record the answered modal_id in the correlation window (#248) AFTER the send succeeds: a
      // build/send throw skips this (caught below), so no phantom outstanding answer is left for an
      // `error` that will never come back. Drained by the matching modal_dismissed (accept) or
      // dequeued by a daemon `error` (reject); reset on each dial().
      outstandingAnswers.push(payload.modal_id)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the payload; no log,
      // no event (classify-don't-forward, inherited #62).
    }
  }

  function cancelModal(payload: ModalCancelPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale).
    if (driver === null) return
    try {
      // Fresh literal naming only `modal_id` — strips any smuggled extra field so nothing beyond the
      // one modeled field crosses the wire (#235's pinned shape; no stale ADR-025 leakage).
      const bytes = buildModalCancel({
        id: nextEnvelopeId,
        ts: now(),
        payload: { modal_id: payload.modal_id }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the caught object is DROPPED
      // (classify-don't-forward, inherited #62).
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
    // Reset the modal-answer correlation window (#248): a fresh connection starts with no outstanding
    // answer, so a stale answer from a dead session can never correlate an `error` on the reconnected
    // one. Holds only strings — nothing to abort, just clear the array in place.
    outstandingAnswers.length = 0
    // Reset the set_session_settings pending map (#261, AC5): a reconnect abandons outstanding changes,
    // so a stale reply from a dead session can never correlate on the reconnected one. This is what makes
    // the recycled envelope ids (nextEnvelopeId restarts at 2 above) safe.
    pendingSettings.clear()
    // Reset the create_workspace_folder pending set (#396, AC1): a reconnect abandons outstanding
    // requests, so a stale envelope id from a dead session can never correlate an `error` on the
    // reconnected one (which recycles ids from 2). The pendingSettings.clear() rationale, applied to the
    // create-folder set.
    pendingCreateFolders.clear()
    // Abandon any in-flight bundle stream (#505), the fourth per-connection reset: its daemon-side
    // request does not survive the fresh Noise session, so the consumer is failed HERE rather than
    // via the stopped driver's terminal — `gen = ++generation` above already fenced that terminal
    // out of onDriverEvent, so #116's net would never fire and the consumer would never settle.
    failBundleStream()
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
    requestSessionSettings,
    requestConversations,
    requestRecentWorkspaces,
    createConversation,
    createWorkspaceFolder,
    dequeueMessage,
    interrupt,
    promoteConversation,
    archiveConversation,
    unarchiveConversation,
    deleteConversation,
    renameConversation,
    changeWorkspace,
    setSessionSettings,
    answerModal,
    cancelModal,
    requestDebugBundle
  }
}
