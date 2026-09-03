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
import { buildAttachmentChunk } from './transport/attachmentChunkEnvelope'
import type { AttachmentChunkPlanInput } from './transport/attachmentChunkPlan'
import {
  createAttachmentTransfer,
  type AttachmentTransfer,
  type AttachmentTransferResult
} from './transport/attachmentTransfer'
import { buildModalAnswer, buildModalCancel } from './transport/modalResolutionEnvelope'
import {
  buildQuestionAnswer,
  buildQuestionRefused
} from './transport/questionResolutionEnvelope'
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
  type DequeueMessagePayload,
  type QuestionAnswerPayload,
  type QuestionRefusedPayload,
  type AttachmentChunkPayload
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
   * Ask the daemon for one conversation's current run configuration (#491). The id is forwarded onto
   * the frame as `conversation_id`; omitting it names nothing, which the daemon answers with a
   * zero-valued reply rather than an error (#945). Optional only until #946 gives the renderer an id
   * to supply. Inert no-op when not connected, like send.
   */
  requestSessionSettings(conversationId?: string): void
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
   * Resolve an outstanding `question_shown` batch with the operator's selections (#920): MINT a fresh
   * client-side idempotency `answer_token` (main-side — the renderer holds no CSPRNG seam and never
   * mints), fold it into a `question_answer` envelope alongside the `question_batch_id` and the ordered
   * entries, and encrypt it onto the live session. `question_batch_id` is the sole correlation key, and
   * it is a one-time unguessable nonce that must never reach a log.
   *
   * The `send` TWIN, not `requestDebugBundle`: a resolution has no consumer to fail, so it is an inert
   * no-op when not connected (`driver === null` → return). The silence SELF-HEALS rather than stranding
   * the operator — the daemon still holds the batch parked, and its connect-time reconcile re-asserts it
   * as a fresh `question_shown` after the next handshake. A replayed answer is inert daemon-side (the
   * one-shot consume of `question_batch_id`).
   *
   * NO CORRELATION WINDOW, deliberately, unlike `answerModal`'s #248 push: the daemon emits no reply and
   * no error envelope for a rejected question answer, so there would be nothing to drain the entry.
   *
   * The entries are opaque here — no bound on entry count or value length, no range check on
   * `question_index`, no membership check of a value against the batch's offered labels. Upstream's
   * `answerVerdict` owns all of those. NEVER throws out of the module (parity #490); an over-cap
   * plaintext is a LIVE path here, since `values` are operator-typed free text.
   */
  answerQuestions(payload: Omit<QuestionAnswerPayload, 'answer_token'>): void
  /**
   * Refuse an outstanding `question_shown` batch from the desktop (#920): the operator declined to
   * choose, so the batch resolves without any selection. MINTS a fresh `answer_token` exactly as
   * `answerQuestions` does — `question_refused` carries one on the wire, UNLIKE `modal_cancel`, which
   * carries `modal_id` alone; do not size this pair from the modal pair's asymmetry. The `send` twin: an
   * inert no-op when not connected, with the same self-healing silence. NEVER throws out of the module
   * (parity #490); this frame carries two ids and no free text, so its own over-cap throw stays exotic
   * and the catch is really there for `driver.sendMessage`.
   */
  refuseQuestions(payload: Omit<QuestionRefusedPayload, 'answer_token'>): void
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
  /**
   * Upload one file to the daemon as an ordered run of `attachment_chunk` envelopes, and resolve when
   * the transfer reaches its single terminal (#861). The `requestDebugBundle` posture, not `send`'s
   * silent no-op: the caller awaits an answer, so a request made while disconnected resolves
   * `not-connected` rather than hanging. NEVER throws and NEVER REJECTS — every failure, local or
   * remote, is a value on the resolved result, so a caller that forgets a `catch` cannot produce an
   * unhandled main-process rejection.
   *
   * TWO CORRELATION KEYS, and they are not interchangeable. The success reply is matched on the
   * payload's `attachment_id`; the rejects are matched on `Envelope.in_reply_to` against the chunk
   * envelopes this transfer sent. A driver keyed on the envelope id alone would never resolve — see
   * createAttachmentTransfer's header for why.
   *
   * `attachment_id` is CALLER-MINTED and must be unique across concurrently live transfers: two
   * transfers sharing one id would let a single success reply resolve whichever the scan reaches
   * first. The id is not a capability (not secret, not unguessable), so uniqueness is the whole
   * requirement. #862 owns minting it, picking the file, and bounding its size — this method applies
   * no size bound of its own and holds the whole file plus its base64 for the round trip.
   *
   * A transfer that resolves failed is resolved: it is not retried here, and nothing is emitted to
   * the window (this method ships no daemon event; surfacing the outcome is #862's).
   */
  uploadAttachment(input: AttachmentChunkPlanInput): Promise<AttachmentTransferResult>
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
  // Attachment transfers currently on the wire (#861). A SET, not the debug bundle's single slot: two
  // files can be attached in one session, and a lone slot would have to abandon the first to admit the
  // second. Membership plus a scan is the whole query — the success reply is looked up by
  // `attachmentId`, the rejects by `sentEnvelope` — over a handful of entries at most. Added in
  // uploadAttachment before the first chunk goes out, removed when the transfer settles, and cleared
  // by failAttachmentTransfers on every connection-fatal event. Single-writer — every mutation runs to
  // completion inside a synchronous body (the nextEnvelopeId / pendingSettings rationale).
  const activeTransfers = new Set<AttachmentTransfer>()

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

  // The connection-teardown net for in-flight attachment transfers (#861) — failBundleStream's twin,
  // called from the same four sites for the same reason: a teardown re-dials into a FRESH Noise
  // session with no resume, so the daemon-side transfer dies and no answer to the chunks already sent
  // will ever arrive. With no per-transfer deadline (deliberate — see createAttachmentTransfer's
  // header), an unfailed caller would await forever.
  //
  // Release-then-fail, like failBundleStream: snapshot and clear the set BEFORE failing, so no
  // transfer's settle can mutate the set mid-iteration and the module holds no reference to a transfer
  // it has already abandoned. Idempotent and total — an empty set is a no-op, and a settled transfer's
  // own `settled` flag absorbs a second fail.
  //
  // This is also what makes dial()'s reset of nextEnvelopeId to 2 safe: every live transfer is failed
  // before ids recycle, so a stale envelope id can never correlate a reject on the reconnected
  // session (the pendingSettings.clear() rationale, applied to the transfer set).
  function failAttachmentTransfers(): void {
    const abandoned = [...activeTransfers]
    activeTransfers.clear()
    for (const transfer of abandoned) transfer.fail('connection-lost')
  }

  /** The reject correlation key: which live transfer, if any, minted this envelope id. */
  function transferForEnvelope(envelopeId: number): AttachmentTransfer | undefined {
    for (const transfer of activeTransfers) {
      if (transfer.sentEnvelope(envelopeId)) return transfer
    }
    return undefined
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
              // Attachment-upload rejection correlation (#861), the third member of the same
              // unique-per-request-envelope-id tier. A reject answers ONE chunk, and every chunk id a
              // live transfer minted is known here, so a match is unambiguously the reply to that
              // transfer's chunk — which is why it consumes the frame ENTIRELY, skipping both the
              // reassembler.fail and the modal-FIFO shift below exactly as its two siblings do.
              // Order among the three is immaterial: an envelope id is minted once, so at most one of
              // them can hold it.
              //
              // The outcome carried is the CLIENT-OWNED value #965 already mapped off the daemon's
              // `code` string at the decode boundary. Nothing re-parses that string here — per
              // CLAUDE.md it must never become a lookup path — and no daemon text reaches the caller.
              // This settles the transfer; it emits NO DaemonEvent, because the outcome goes back to
              // uploadAttachment's caller and surfacing it to the window is #862's slice.
              const rejected = transferForEnvelope(inReplyTo)
              if (rejected !== undefined) {
                rejected.fail(inbound.outcome)
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
            // The parser-gap diagnostic data path (widened by #784). Emit a fresh literal carrying the
            // four display fields plus `conversationId`, copied BY NAME from the already-decoded,
            // already-validated payload — never a spread of inbound.unrecognized, so a decoder that
            // later grows a field cannot smuggle it across IPC. That discipline earns its keep here more
            // than anywhere: this is the arm whose payload is unbounded daemon-relayed JSON, so the
            // field list must be the one an operator agreed to render, not whatever arrived. The id is
            // read BARE because the decode already guarantees it: parseUnrecognizedMessagePayload
            // requires `conversation_id`, so a missing or non-string one drops the whole line upstream
            // of this emit, and reaching for `?? ''` here would turn that fail-closed drop into a silent
            // misattribution — a parser-gap row filed against the wrong thread, on the one arm whose
            // whole purpose is making a silent gap visible. It is a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg. The timeline bridge (#202) rebuilds a
            // fresh ThreadEvent that omits it, so the id stops there and instead routes the row into its
            // own conversation's slice (#756). Deliberately stateless: no dedup and no coalescing — and
            // none keyed by the new id either — because a repeat is a REAL repeat and how often this
            // fires is the number that tells you to go fix something. Not compile-forced (this inner
            // switch has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'unrecognizedMessage',
              conversationId: inbound.unrecognized.conversation_id,
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
            // The tool-call data path (#217, widened by #763). snake→camel here, following the
            // assistant-delta idiom above: a fresh literal with the six named fields carrying the render
            // fields and `conversationId` — never a spread of the decoded payload, so a decoder that later
            // grows a field cannot smuggle it across IPC. The id is read BARE because the decode already
            // guarantees it: parseToolUsePayload requires `conversation_id`, so a missing or non-string one
            // drops the whole line upstream of this emit, and reaching for `?? ''` here would turn that
            // fail-closed drop into a silent misattribution. It is a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg. The timeline bridge (#202), not the
            // session store, folds this into a pending `toolCall` item —
            // rebuilding a fresh ThreadEvent that omits the id, so it stops there until #756 routes by it.
            // `input` (#642) crosses BY REFERENCE to the already-narrowed fresh map (the `queued`
            // precedent below): parseToolUsePayload built it from own string values with the reserved
            // keys removed, so there is nothing left to drop and no second copy is warranted. Assigned
            // unconditionally — `undefined` when the wire omitted it (a pre-pyrycode#1678 daemon), which
            // structured clone and JSON.stringify both drop.
            emitDaemonEvent(sink, {
              type: 'toolUse',
              conversationId: inbound.toolUse.conversation_id,
              turnId: inbound.toolUse.turn_id,
              toolUseId: inbound.toolUse.tool_use_id,
              name: inbound.toolUse.name,
              inputSummary: inbound.toolUse.input_summary,
              input: inbound.toolUse.input
            })
            return
          case 'tool-result':
            // The tool-result data path (#229, widened by #766). snake→camel here, following the
            // tool-use idiom above: a fresh literal with the five named fields carrying the render fields
            // and `conversationId` — never a spread of the decoded payload, so a decoder that later grows
            // a field cannot smuggle it across IPC. The id is read BARE because the decode already
            // guarantees it: parseToolResultPayload requires `conversation_id`, so a missing or non-string
            // one drops the whole line upstream of this emit, and reaching for `?? ''` here would turn
            // that fail-closed drop into a silent misattribution. It is a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg. The timeline bridge (#202), not the
            // session store, folds this through `fillResult` to resolve the correlated `toolCall`'s
            // result in place — rebuilding a fresh ThreadEvent that omits the id, so it stops there until
            // #756 routes by it. `isError` is a boolean; `false` is a value.
            // `resultDetail` (#773) is the sixth field, assigned UNCONDITIONALLY — `undefined` when the
            // wire omitted it (a pre-pyrycode#2024 daemon). Never a conditional spread, which would fold
            // an empty detail into absence: the two are carried distinctly all the way to the item, and
            // the decision that both draw nothing belongs to the row (#856). Structured clone carries the
            // key across with its `undefined` value, so the renderer-side contract is `=== undefined`,
            // never `'resultDetail' in event`.
            emitDaemonEvent(sink, {
              type: 'toolResult',
              conversationId: inbound.toolResult.conversation_id,
              turnId: inbound.toolResult.turn_id,
              toolUseId: inbound.toolResult.tool_use_id,
              isError: inbound.toolResult.is_error,
              resultSummary: inbound.toolResult.result_summary,
              resultDetail: inbound.toolResult.result_detail
            })
            return
          case 'queue-state':
            // The queued-backlog data path (#292). Emit a fresh literal carrying `conversationId` (snake→
            // camel) plus the already-narrowed backlog by reference — this daemon-STATE arm KEEPS
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
            // drop, no snake→camel on id/label). The payload's `conversation_id` (pyrycode#1065,
            // decoded by #870) is carried across too as of #871, copied BY NAME like every other field
            // here and read BARE: parseModalShownPayload already requires it, so a missing or
            // non-string one drops the whole line upstream of this emit, and reaching for `?? ''` here
            // would turn that fail-closed drop into a silent misattribution — a permission prompt filed
            // against the wrong conversation, on the one arm where the operator is being asked to grant
            // something. It is an outbound scoping key, not a correlation key: answering still goes by
            // `modalId` alone. A fresh literal with named fields, never a spread, so a decoder that
            // later grows a field cannot smuggle it across IPC. The modal store + bridge (#223), not
            // the session or timeline store, consumes this — and the bridge rebuilds a fresh ModalEvent
            // from named fields, so the id stops there until its consumer (#872) reads it. `title` /
            // `prompt` / `options[].label` are untrusted `claude`-surfaced display text the render
            // slice (#224) must render as plain text.
            emitDaemonEvent(sink, {
              type: 'modalShown',
              conversationId: inbound.modalShown.conversation_id,
              modalId: inbound.modalShown.modal_id,
              class: inbound.modalShown.class,
              title: inbound.modalShown.title,
              prompt: inbound.modalShown.prompt,
              options: inbound.modalShown.options,
              defaultOptionId: inbound.modalShown.default_option_id
            })
            return
          case 'question-shown':
            // The question-batch data path (#885). An UNSOLICITED daemon BROADCAST (not correlated by
            // in_reply_to), so it is emitted unconditionally on decode — no outstanding-request memory.
            // snake→camel at the TOP LEVEL only (`conversation_id`→`conversationId`,
            // `question_batch_id`→`questionBatchId`); `questions` is reused VERBATIM and passes across
            // BY REFERENCE, the `options` / `conversations` precedent — parseQuestionShownPayload
            // already stripped every question and every nested option to its known fields, so there is
            // nothing to drop and no per-row mapping to write. Do not "fix" that into a `.map`: the
            // fresh-literal rule below governs the EVENT OBJECT, and deep-remapping the rows would
            // break the verbatim-row rule instead.
            //
            // A fresh literal naming three fields, never a spread of the decoded payload, so a decoder
            // that later grows a field cannot smuggle it across IPC — and this family nests two levels,
            // so the round-trip test plants its extra key at all three.
            //
            // Every field is read BARE — no `??`, no optional handling. The decode requires all three,
            // so a missing or non-string one drops the whole line upstream of this emit; a `?? ''` here
            // would turn that fail-closed drop into a silent misattribution, filing a batch against the
            // wrong conversation. It is an outbound display-scoping key: `questionBatchId` stays the
            // sole correlation key (the #870/#871 split). NO log call — #884's decode already emitted
            // the content-free record, and this is the one place on the leg where the unguessable nonce
            // could reach a sink.
            //
            // The #850 question store plus its own dedicated bridge — a fourth independent subscriber —
            // consumes this; all three exhaustive bridges no-op it permanently. `question` / `header` /
            // `label` / `description` are untrusted claude-authored text: decoded is not sanitized, and
            // the render slice owes the escaping. Not compile-forced (this inner switch has no
            // assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'questionShown',
              conversationId: inbound.questionShown.conversation_id,
              questionBatchId: inbound.questionShown.question_batch_id,
              questions: inbound.questionShown.questions
            })
            return
          case 'modal-dismissed': {
            // The modal-resolution data path (#201). snake→camel here; NO `conversation_id` (a
            // DISMISSAL carries none — `modal_shown` does carry one and rides it across as of #871).
            // `outcome` is an opaque string carried verbatim. A fresh literal, never a spread.
            // Consumed by the modal store + bridge (#223).
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
          case 'question-dismissed':
            // The question-retirement data path (#895) — the frame that ends the #885 batch. An
            // UNSOLICITED daemon BROADCAST (not correlated by in_reply_to), emitted unconditionally on
            // decode. snake→camel, one level; NO `conversation_id` (the batch carries one, this does
            // not — the nonce is the sole correlation key and adding one "for symmetry" is forbidden by
            // the wire contract). A fresh literal naming three fields, never a spread of the decoded
            // payload, so a decoder that later grows a field cannot smuggle it across IPC.
            //
            // Every field is read BARE — no `??`, no optional handling. The decode requires all three,
            // so a missing or non-string one drops the whole line upstream of this emit; a `?? ''` here
            // would turn that fail-closed drop into a silent misattribution, retiring the wrong batch or
            // reporting a cause the daemon never stated. NO log call — #894's decode already emitted the
            // content-free record, and this is the one place on the leg where the unguessable nonce
            // could reach a sink.
            //
            // `source` crosses as a PLAIN string, never narrowed to WireModalSource: the producer emits
            // no member of that set, only `outcome: "unanswered"` / `source: "no_answer"` for the whole
            // no-answer class. A type error here means the ARM is wrong, not this line. See the arm's
            // own comment in shared/ipc/events.ts for why, and why the upstream `timeout` fixture is a
            // trap rather than a value.
            //
            // DELIBERATELY NO `outstandingAnswers` DRAIN, unlike the modal-dismissed twin directly
            // above. That list holds modal_ids exclusively, and this client sends no question answer at
            // all (the outbound verb is upstream pyrycode#1907, unlanded), so there is nothing here to
            // drain. Copying the block would search the MODAL correlation window with a
            // question_batch_id — letting a daemon retire a live modal-answer entry by echoing a known
            // modal_id as a batch nonce, after which a later content-free `error` (#116) mis-attributes.
            // It would read as a harmless no-op in review, because the indexOf is -1 on every honest
            // frame.
            //
            // The #850 question store plus its own dedicated bridge — a fourth independent subscriber —
            // consumes this; all three exhaustive bridges no-op it permanently. Not compile-forced
            // (this inner switch has no assertNever) — the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'questionDismissed',
              questionBatchId: inbound.questionDismissed.question_batch_id,
              outcome: inbound.questionDismissed.outcome,
              source: inbound.questionDismissed.source
            })
            return
          case 'slash-command-list':
            // The slash-command menu data path (#937) — the verbs claude will accept for this
            // conversation, decoded fail-closed by #936. An UNSOLICITED daemon report: it rides a
            // `control_response` but is not correlated by this client's outstanding-request memory, so
            // it is emitted unconditionally on decode. snake→camel at the TOP LEVEL only
            // (`conversation_id`→`conversationId`, `dropped_commands`→`droppedCommands`); `commands` is
            // reused VERBATIM and passes across BY REFERENCE, the `questions` / `tasks` / `queued`
            // precedent — parseSlashCommand already stripped every row to its five known fields, so
            // there is nothing to drop and no per-row mapping to write. Do not "fix" that into a `.map`:
            // the fresh-literal rule below governs the EVENT OBJECT, and deep-remapping the rows would
            // break the verbatim-row rule instead.
            //
            // A fresh literal naming three fields, never a spread of the decoded payload, so a decoder
            // that later grows a field cannot smuggle it across IPC.
            //
            // Every field is read BARE — no `??`, no `|| 0`, no optional handling. The decode requires
            // all three, so a missing or wrong-typed one drops the whole line upstream of this emit; a
            // `?? ''` here would turn that fail-closed drop into a silent misattribution, filing a menu
            // against the wrong conversation, and a `|| 0` on the count would turn a real defect into a
            // plausible zero. NOTHING RECOMPUTES OR CROSS-CHECKS `droppedCommands` AGAINST
            // `commands.length`: the two disagree by design, their sum is the menu's true size, and only
            // the daemon knows it.
            //
            // NO log call, and deliberately no `count` of commands either. #936's decode already emitted
            // the content-free record, and this leg is the one place on the path where a
            // workspace-authored `description` could reach a sink — `0x0a` is the only sub-`0x20` byte
            // measured across the capture's 51 entries, so an author who can write one holds a
            // log-forgery primitive against a JSON-lines file the operator can ship off-box. How many
            // verbs a workspace offers is itself a fact about the repository the user has open.
            //
            // The #938 store consumes this; all four exhaustive bridges no-op it dormantly meanwhile.
            // The four strings on every row are untrusted WORKSPACE-authored text — a lower trust tier
            // than the claude-authored strings the question arms carry — and decoded is not sanitized:
            // the render slice owes the escaping. Not compile-forced (this inner switch has no
            // assertNever) — the round-trip tests guard this emit.
            emitDaemonEvent(sink, {
              type: 'slashCommandList',
              conversationId: inbound.slashCommandList.conversation_id,
              commands: inbound.slashCommandList.commands,
              droppedCommands: inbound.slashCommandList.dropped_commands
            })
            return
          case 'model-list':
            // The model-menu data path (#973) — the IDENTITIES claude will accept for this conversation,
            // decoded fail-closed by #972, where its sibling `slash_command_list` above inventories the
            // VERBS the working directory will accept. An UNSOLICITED daemon report: it rides a
            // `control_response` but is not correlated by this client's outstanding-request memory, so it
            // is emitted unconditionally on decode. snake→camel at the TOP LEVEL only
            // (`conversation_id`→`conversationId`, `dropped_models`→`droppedModels`); `models` is reused
            // VERBATIM and passes across BY REFERENCE, the `queued` / `tasks` / `questions` / `commands`
            // precedent — parseModelOption already rebuilt every row as a fresh six-field literal, so
            // there is nothing to drop and no per-row mapping to write. Do not "fix" that into a `.map`
            // that camelCases the rows: the fresh-literal rule below governs the EVENT OBJECT, and
            // deep-remapping the rows would break the verbatim-row rule instead.
            //
            // A fresh literal naming three fields, never a spread of the decoded payload, so a decoder
            // that later grows a field cannot smuggle it across IPC. The wire `type` does not cross.
            //
            // Every field is read BARE — no `??`, no `|| 0`, no optional handling. The decode requires
            // all three, so a missing or wrong-typed one drops the whole line upstream of this emit; a
            // `?? ''` here would turn that fail-closed drop into a silent misattribution, filing one
            // conversation's model menu against another, and a `|| 0` on the count would turn a real
            // defect into a plausible zero. NOTHING RECOMPUTES OR CROSS-CHECKS `droppedModels` AGAINST
            // `models.length`: the two disagree by design, their sum is the menu's true size, and only
            // the daemon knows it. The producer's ten-entry cap is a DAEMON-SIDE cap rather than a wire
            // constant, so a short list beside a non-zero count is not a contradiction to reconcile.
            //
            // NO log call, and deliberately no `count` of models either. #972's decode already emitted
            // the content-free record, and this leg is the one place on the path where a claude-authored
            // `display_name` could reach a sink. The never-into-a-log clause rests here on the CONTRACT
            // rather than on a measurement — no control byte is measured in these short labels, but the
            // daemon bounds them and does not sanitize them, so one is PERMITTED rather than excluded;
            // do not transcribe the sibling's measured `0x0a`, whose evidence is workspace-authored and
            // does not transfer. How many models claude offers for a session is itself a fact about that
            // session (the background_task_roster / model_announced posture).
            //
            // The #974 store consumes this through a DEDICATED subscriber; all four exhaustive bridges
            // no-op it PERMANENTLY rather than dormantly, since none of them will ever claim it. The
            // three strings and the effort levels on every row are untrusted CLAUDE-AUTHORED text — a
            // HIGHER trust tier than the sibling's workspace-authored strings — and decoded is not
            // sanitized: the render slice owes the escaping. Not compile-forced (this inner switch has no
            // assertNever) — the round-trip tests guard this emit.
            emitDaemonEvent(sink, {
              type: 'modelList',
              conversationId: inbound.modelList.conversation_id,
              models: inbound.modelList.models,
              droppedModels: inbound.modelList.dropped_models
            })
            return
          case 'attachment-stored': {
            // The upload leg's one POSITIVE terminal (#861), and the ONLY inbound arm here that
            // correlates on a PAYLOAD field rather than on Envelope.in_reply_to. The reply's
            // in_reply_to names the chunk WHOSE ARRIVAL COMPLETED the transfer, not the last one sent,
            // and chunks are index-addressed and may be reassembled in any order — so the envelope id
            // is unpredictable to the sender and #964 deliberately does not surface it. The
            // `attachment_id` is the only handle that works, and it is a value THIS CLIENT chose.
            //
            // The decoded id is a COMPARAND and nothing else: matched against ids this process minted,
            // then dropped. It never becomes a lookup path, a filename or a cache key (CLAUDE.md), and
            // it never reaches a log. `''` cannot reach here — #964's requireNonEmptyString fails the
            // frame closed — so a truncated or hostile payload cannot match a transfer by decoding to
            // Go's zero value.
            //
            // AT MOST ONE transfer settles per reply: the loop returns on the first match, so even a
            // caller that violated the id-uniqueness contract cannot have one reply resolve two
            // transfers. No match — a stale reply, or a daemon naming a transfer this client never
            // started — is DROPPED: no event, no log, no throw.
            //
            // Emits NOTHING. The outcome goes back to uploadAttachment's caller; surfacing it to the
            // window is #862's slice, and this ticket ships no daemon event at all.
            for (const transfer of activeTransfers) {
              if (transfer.attachmentId === inbound.attachmentStored.attachment_id) {
                transfer.stored()
                return
              }
            }
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
        failAttachmentTransfers()
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
        failAttachmentTransfers()
        // A clean local stop() drives terminal{1000,'stopped'}; suppress it (the window is
        // tearing down on quit). Every other fatal close is an authoritative drop the user sees.
        // The supervisor's `reason` string is deliberately NOT forwarded (conservative).
        if (stopped) return
        emitFailed('connection-closed', `The connection to pyrybox was closed (code ${event.code}).`)
        return
      case 'error':
        // Same teardown net for a connection-level driver error mid-stream.
        failBundleStream()
        failAttachmentTransfers()
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

  function requestSessionSettings(conversationId?: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A read request has no consumer to fail; a request sent
    // while disconnected simply produces no reply, and the sheet re-requests on its next open.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestDebugBundle — no second counter —
      // so ids stay unique across interleaved calls (the daemon correlates the session_settings reply
      // by in_reply_to).
      // The id is forwarded verbatim; the builder owns the "absent → `conversation_id: ''`" rule, so
      // nothing here has to know the wire's present-always shape. Never logged (#945): the catch
      // below still drops its caught object and adds no line.
      const bytes = buildRequestSessionSettings({ id: nextEnvelopeId, ts: now(), conversationId })
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

  function answerQuestions(payload: Omit<QuestionAnswerPayload, 'answer_token'>): void {
    // The send twin: inert no-op when not connected (see send's guard rationale). A resolution has no
    // consumer to fail, and the silence self-heals — the daemon keeps the batch parked and its
    // connect-time reconcile re-asserts it as a fresh question_shown after the next handshake.
    if (driver === null) return
    try {
      // Mint the token into a FRESH literal naming exactly the three modeled fields — never a spread
      // of `payload`. The rebuild is DEEP, and that is the point: `answers` is an array of OBJECTS, so
      // a shallow `answers: payload.answers` would carry an extra key smuggled onto an ENTRY (past the
      // structural-minimum guard) straight onto the wire, since buildQuestionAnswer serializes
      // verbatim. Rebuilding each entry is what bounds the frame to the modeled fields at both depths.
      //
      // `values` is passed through without a copy, deliberately: JSON.stringify serializes an array BY
      // INDEX, so no own property on it can ride, and a defensive copy would read as a check it is not.
      const bytes = buildQuestionAnswer({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          question_batch_id: payload.question_batch_id,
          answer_token: mintToken(),
          answers: payload.answers.map((entry) => ({
            question_index: entry.question_index,
            values: entry.values
          }))
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // NO correlation window push here, unlike answerModal's outstandingAnswers (#248): the daemon
      // emits no reply and no error envelope for a rejected question answer, so an entry pushed here
      // would be one nothing ever drains.
    } catch {
      // Never throw out of the module (parity #490). The over-cap WireEncodeError is a LIVE branch on
      // this path, not a defensive one — `values` are operator-typed free text and nothing bounds entry
      // count or value length. Fail closed: the send is dropped WHOLE, never truncated, because a
      // trimmed answer would send a different choice than the operator made. The caught object is
      // DROPPED — its message could echo the batch nonce or an entry value; no log, no event
      // (classify-don't-forward, inherited #62).
    }
  }

  function refuseQuestions(payload: Omit<QuestionRefusedPayload, 'answer_token'>): void {
    // The send twin: inert no-op when not connected (see answerQuestions' rationale).
    if (driver === null) return
    try {
      // Fresh literal naming only the batch id plus the token minted HERE — strips any smuggled extra
      // field, and a smuggled answer_token loses to the minted one. The token is present because
      // question_refused carries one, unlike modal_cancel.
      const bytes = buildQuestionRefused({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          question_batch_id: payload.question_batch_id,
          answer_token: mintToken()
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): two ids and no free text cannot realistically
      // over-cap, so this is really driver.sendMessage's catch. The caught object is DROPPED — its
      // message could echo the batch nonce (classify-don't-forward, inherited #62).
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

  /**
   * Put one chunk on the wire and return the envelope id it went out under (#861) — the send seam
   * createAttachmentTransfer drives, and the reason the id is RETURNED rather than minted inside the
   * transfer: it comes from this module's single monotonic counter, and transport/ must not reach into
   * it. Capture the id BEFORE the build increments it, so the returned value is the one the daemon
   * echoes as in_reply_to on a rejecting error (the createWorkspaceFolder template).
   *
   * THROWS, unlike every other send here, and that is the contract: the loop turns a throw into a
   * `send-failed` terminal so the caller learns the transfer stopped. A silent drop would leave it
   * awaiting an answer to a chunk that never left. The three throwing causes are a null driver, an
   * over-cap envelope (WireEncodeError), and a driver refusal; the loop classifies without inspecting,
   * so no caught message can echo the file's base64.
   *
   * A null driver here means a teardown already ran, and every teardown path fails its transfers
   * first, so the `send-failed` this produces loses to the `connection-lost` already delivered. The
   * throw is the belt to that suspenders — it cannot reach the wire either way.
   */
  function sendAttachmentChunk(payload: AttachmentChunkPayload): number {
    const live = driver
    if (live === null) throw new Error('not connected')
    const envelopeId = nextEnvelopeId
    // The payload is passed through without a fresh literal, unlike the renderer-supplied command
    // payloads: it is not renderer-supplied at all — planAttachmentChunks built it here in the main
    // process as a closed nine-field object, so there is no smuggled field for a copy to strip.
    const bytes = buildAttachmentChunk({ id: envelopeId, ts: now(), payload })
    nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
    live.sendMessage(bytes)
    return envelopeId
  }

  async function uploadAttachment(
    input: AttachmentChunkPlanInput
  ): Promise<AttachmentTransferResult> {
    // Not connected (before start(), mid-bootstrap, bootstrap-failed): resolve terminally so #862's
    // command never hangs. requestDebugBundle's posture — send's silent no-op is wrong for a call that
    // owns an awaiting caller.
    if (driver === null) return { ok: false, outcome: 'not-connected' }
    let transfer: AttachmentTransfer
    try {
      transfer = createAttachmentTransfer(input, {
        sendChunk: sendAttachmentChunk,
        diagnosticLog: deps.diagnosticLog
      })
    } catch {
      // planAttachmentChunks is total, so this is a backstop rather than a live branch — but this is
      // the first async method on the interface, and a synchronous throw escaping it would surface as
      // an UNHANDLED main-process rejection in a caller that forgot a catch. Every path returns a
      // value instead (parity #490, restated for a promise-returning method). The caught object is
      // DROPPED — it could echo the file's bytes.
      return { ok: false, outcome: 'send-failed' }
    }
    // ARM BEFORE DRIVE: record the transfer where both inbound correlations can find it, THEN start
    // the send. The reverse order would put chunk 0 on the wire before the slot was armed, and a fast
    // reply would find nothing to resolve (requestDebugBundle's arm-before-send discipline).
    activeTransfers.add(transfer)
    try {
      transfer.start()
      return await transfer.result
    } finally {
      // Always runs: transfer.result never rejects. Removing on settle is what keeps a later reply
      // naming a finished transfer's id from resolving anything, and bounds the scan to live work.
      activeTransfers.delete(transfer)
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
    failAttachmentTransfers()
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
    answerQuestions,
    refuseQuestions,
    requestDebugBundle,
    uploadAttachment
  }
}
