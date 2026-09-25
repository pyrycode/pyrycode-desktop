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
import { buildRequestModelList } from './transport/requestModelListEnvelope'
import { buildRequestContextUsage } from './transport/requestContextUsageEnvelope'
import { buildRequestMcpStatus } from './transport/requestMcpStatusEnvelope'
import { buildMcpReconnect } from './transport/mcpReconnectEnvelope'
import { buildMcpToggle } from './transport/mcpToggleEnvelope'
import { buildRequestSystemPrompt } from './transport/requestSystemPromptEnvelope'
import { buildSetSystemPrompt } from './transport/setSystemPromptEnvelope'
import { buildSetConversationMuted } from './transport/setConversationMutedEnvelope'
import { buildRequestHistory } from './transport/requestHistoryEnvelope'
import { buildNewSession } from './transport/newSessionEnvelope'
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
import { buildRenameWorkspace } from './transport/renameWorkspaceEnvelope'
import { buildSetSessionSettings } from './transport/setSessionSettingsEnvelope'
import { buildDequeueMessage } from './transport/dequeueMessageEnvelope'
import { buildInterrupt } from './transport/interruptEnvelope'
import { buildAttachmentChunk } from './transport/attachmentChunkEnvelope'
import { buildRequestAttachment } from './transport/requestAttachmentEnvelope'
import { buildReadWorkspaceFile } from './transport/readWorkspaceFileEnvelope'
import {
  createAttachmentReassembler,
  type AttachmentReassembler
} from './transport/attachmentReassembler'
import type { AttachmentChunkPlanInput } from './transport/attachmentChunkPlan'
import {
  createAttachmentTransfer,
  type AttachmentTransfer,
  type AttachmentTransferProgress,
  type AttachmentTransferResult
} from './transport/attachmentTransfer'
import { buildModalAnswer, buildModalCancel } from './transport/modalResolutionEnvelope'
import {
  buildQuestionAnswer,
  buildQuestionRefused
} from './transport/questionResolutionEnvelope'
import { parseInboundMessage, turnEndMetricsOf, type InboundDaemonMessage } from './transport/inboundMessage'
import {
  createBundleReassembler,
  type BundleConsumer,
  type BundleReassembler
} from './transport/bundleReassembler'
import { base64StdDecode } from './transport/codec'
import { emitDaemonEvent, bindServerOrigin, type DaemonEventSink } from './emitDaemonEvent'
import type { AttachmentRetrievalFailure } from '../shared/ipc/attachmentRetrieval'
import type { HistoryRequestFailure } from '../shared/ipc/events'
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
  type RenameWorkspacePayload,
  type SetSystemPromptPayload,
  type SetConversationMutedPayload,
  MAX_SYSTEM_PROMPT_BYTES,
  type RequestAttachmentPayload,
  type ReadWorkspaceFilePayload,
  type SetSessionSettingsPayload,
  type ModalAnswerPayload,
  type ModalCancelPayload,
  type DequeueMessagePayload,
  type QuestionAnswerPayload,
  type QuestionRefusedPayload,
  type AttachmentChunkPayload,
  type RequestHistoryPayload
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
 * The app-too-old close (#1613): a host whose minimum app version this build is below. Fatal in
 * relaySupervisor's DEFAULT_FATAL_CLOSE_CODES, and reported as `update-required` rather than
 * `connection-closed` when it arrives without the sealed `client.update_required` error.
 */
const CLIENT_UPDATE_REQUIRED_CLOSE_CODE = 4412

/**
 * How long one retrieval may go SILENT before this client gives up on it (#996). An IDLE deadline,
 * not a total-duration one: it is armed when the `request_attachment` goes out and re-armed on every
 * accepted chunk, so a large legitimate transfer is never killed for taking long — only for stopping.
 *
 * IT IS THE ONLY THING THAT DETECTS THE THIRD FAILURE MODE. A retrieval can end three ways and only
 * two of them are frames: `attachment.not_found`, `attachment.stream_aborted`, and a stream that
 * simply stops because the session died. The protocol offers nothing for the third and says so.
 *
 * 30 s restates relayConnection's WIRE_PONG_TIMEOUT_MS deliberately: that wire-pong deadline is the
 * deterministic backstop one layer down, so a client-side deadline meaningfully shorter would fire
 * first on a merely slow relay and one meaningfully longer would add nothing the socket does not
 * already catch. A stream silent for 30 s is dead either way.
 */
const RETRIEVAL_IDLE_TIMEOUT_MS = 30_000

/** Outstanding MCP status asks kept for refusal correlation (#1578). A success reply cannot consume an
 *  entry, so the map is bounded here; the 33rd ask evicts the oldest. */
const MAX_PENDING_MCP_STATUS_REQUESTS = 32

/** Outstanding MCP reconnects kept for refusal correlation (#1582), bounded for the same reason: the
 *  accepted answer is an mcp_status that cannot consume an entry. The 33rd evicts the oldest. */
const MAX_PENDING_MCP_RECONNECTS = 32

/** Outstanding MCP toggles kept for refusal correlation (#1586), bounded like the reconnects above. */
const MAX_PENDING_MCP_TOGGLES = 32

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
  /**
   * Which server this connection speaks to (#1068), stamped onto every event it emits so a renderer
   * holding several live connections can tell their events apart. Bound ONCE here, at construction,
   * and never re-read: it CANNOT be sourced inside the connection, because the paired record loads per
   * dial in `loadDialConfig` and events fire before it.
   *
   * The value is the paired record's `server` — never `hello_ack.server_id` (a distinct value; see
   * `shared/ipc/serverInfo.ts`, which ruled this for the same field) and never the record's `token`,
   * which is the same `string` type and only the construction site can tell apart.
   *
   * REQUIRED, not optional: a connection that forgets its own identity is exactly what the registry
   * (#1084) must not be able to build. `null` is a real value meaning "no paired record was in hand" —
   * what the single connection at the composition root passes today, since it is constructed before
   * any record is read and outlives a re-pair.
   */
  serverId: string | null
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
  /**
   * The retrieval idle-deadline seam (#996) — createRelaySupervisor's `timing` parameter, restated
   * for the one timer this module owns. Test-only in practice: every field defaults to the real
   * behaviour, so production never passes it. Injected rather than driven with fake timers because
   * this repo has no fake-timer precedent in src/main and the supervisor already established the
   * pattern one layer down.
   */
  timing?: {
    retrievalIdleTimeoutMs?: number
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  }
}

/**
 * The injected sink for one RETRIEVAL (#996) — `BundleConsumer`'s twin for the leg that fetches an
 * attachment back. Exactly one of `complete` / `fail` is called, exactly once, per
 * `requestAttachment` call; there is no `progress` member, because this leg has no completion frame
 * and a count of chunks tells a consumer nothing it can act on.
 *
 * `fail` takes the IPC-layer `AttachmentRetrievalFailure` rather than a transport-local union, and
 * that is the whole correspondence mechanism: `requestAttachment` forwards an `AttachmentFailReason`
 * straight into it, so a reason added to the reassembler's closed set upstream reddens that call
 * instead of silently becoming unrepresentable at the bridge. Same check as the upload leg's
 * `reason: result.outcome`, running the other way and with no re-declared mirror to keep in step.
 */
export interface AttachmentRetrievalConsumer {
  /** The one success terminal: the whole file, verified against its declared length and digest. */
  complete(bytes: Uint8Array): void
  /** The one failure terminal: a client-owned literal, never a wire value. */
  fail(reason: AttachmentRetrievalFailure): void
}

/**
 * One retrieval this connection is waiting on. Module-internal — the map's value type, never
 * exported: a caller holds its consumer and needs nothing else.
 */
interface PendingRetrieval {
  /** #995's accumulator for this transfer, pinned to the id THIS CLIENT asked for, or to the first
   *  chunk's id when the daemon mints it (`read_workspace_file`, #1626). */
  reassembler: AttachmentReassembler
  /** The caller's sink, settled exactly once by `settleRetrieval`. */
  consumer: AttachmentRetrievalConsumer
  /** The live idle deadline, replaced on every accepted chunk and cleared at every settle site. */
  deadline: ReturnType<typeof setTimeout>
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
   * Ask the daemon for one conversation's model and effort vocabulary (#1165). The id is forwarded
   * onto the frame as `conversation_id` and is REQUIRED — unlike the method above, whose unnamed
   * request draws a zero-valued reply, an unnamed request here has nothing to ask about. Answered by
   * one `model_list` correlated on `in_reply_to`, which the existing inbound path lands in the
   * model-list store exactly as it lands an unsolicited one; a request the daemon cannot answer draws
   * one `error` frame, which nothing here retries. Inert no-op when not connected, like send.
   */
  requestModelList(conversationId: string): void
  /** Ask once for context_usage; the existing inbound path delivers the reading.
   * Unavailable connections and send failures are inert. No retry or pending state. */
  requestContextUsage(conversationId: string): void
  /** Ask once for mcp_status (#1578); the existing inbound path delivers the report. A correlated
   * refusal emits mcpStatusRequestRejected. Unavailable connections and send failures are inert. No retry. */
  requestMcpStatus(conversationId: string): void
  /** Ask once for an mcp_reconnect of one named server (#1582). An accepted reconnect answers with an
   * mcp_status on the existing inbound path; any correlated refusal emits mcpReconnectRejected. The server
   * name is only put on the wire, never logged or stored. Unavailable connections and send failures are
   * inert. No retry. */
  reconnectMcpServer(conversationId: string, serverName: string): void
  /** Ask once for an mcp_toggle of one named server to the operator's requested state (#1586). Accepted
   * toggles answer with an mcp_status; any correlated refusal emits mcpToggleRejected. The server name and
   * the requested state are only put on the wire, never logged or stored. Inert when unavailable. No retry. */
  toggleMcpServer(conversationId: string, serverName: string, enabled: boolean): void
  /**
   * Ask the daemon for one backward step of a scroll-back walk over a conversation's on-disk history
   * (#1222). Takes the whole PAYLOAD rather than a scalar — unlike its two neighbours above, this verb
   * carries three fields, and the builder rebuilds a fresh literal from them so nothing
   * renderer-supplied reaches the wire uninspected.
   *
   * IT IS THE ONLY REQUEST METHOD THAT RECORDS WHAT IT ASKED. The `history_page` reply names no
   * conversation, so this connection keeps the envelope id it just spent against the conversation the
   * request named, and matches the reply back by `Envelope.in_reply_to` — the `requestSessionSettings`
   * arrangement, and for the same reason. Answered by one `history_page` → `historyPageReceived`, or by
   * one `error` → `historyRequestFailed`; nothing here retries either, including the one retryable
   * refusal. Inert no-op when not connected, like send.
   */
  requestHistory(payload: RequestHistoryPayload): void
  /**
   * Ask the daemon what system prompt one conversation holds, and whether the running session was
   * started with a different one (#1230). Takes the conversation id as a SCALAR, like
   * `requestModelList` and unlike `requestHistory`, and the id is REQUIRED: an unnamed request has
   * nothing to ask about.
   *
   * IT RECORDS WHAT IT ASKED, like `requestHistory` and `requestSessionSettings`. The `system_prompt`
   * reply names no conversation — the omission is what makes an unhosted conversation's answer
   * byte-identical to a hosted-but-quiet one, so the verb cannot be used as a membership probe — so
   * this connection keeps the envelope id it just spent against the conversation the request named and
   * matches the reply back by `Envelope.in_reply_to`.
   *
   * ANSWERED ONLY BY ONE `system_prompt` → `systemPromptReceived`, and NEVER by an error frame: this
   * verb mints no wire code and has no failure branch, so every unresolvable case comes back as an
   * ordinary `no_session` reading. Two things follow. Nothing retries and nothing may block on the
   * reply — the daemon also answers a conn that never negotiated the interactive capability with
   * nothing at all. And an id no server has claimed must be refused BEFORE the send, at the IPC arm's
   * routing lookup, because an empty or unroutable id on the wire draws a false "no prompt, no
   * session" reply that nothing downstream can distinguish from a true one. Inert no-op when not
   * connected, like send.
   */
  requestSystemPrompt(conversationId: string): void
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
   * Request a fresh conversation on an authenticated session. Unavailable connections and local
   * build/send failures emit a content-free conversationCreateRejected through the host-bound sink.
   * The reply arrives asynchronously as conversationCreated or a correlated rejection. Never throws
   * transport/build errors to the caller; daemon folder validation remains unchanged.
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
   * Encrypt a payload-carrying `interrupt` control envelope onto the live session — the "stop the
   * running turn in the conversation it names" signal, which the daemon maps to the neutral
   * `turnevent.Cancel` and routes to that conversation's bound runner (daemon SSOT pyrycode #707,
   * widened by #2103). Takes the conversation id as a SCALAR, like `newSession` and `requestModelList`
   * and unlike the payload-bearing `dequeueMessage` — the builder rebuilds a fresh literal, so no
   * renderer-supplied key reaches the wire — and it is REQUIRED (#1092): an unnamed interrupt is the
   * daemon's process-wide follow-active cursor, which is another conversation's turn as often as it is
   * this one's. The `send` TWIN, not `requestDebugBundle`: an inert no-op when not connected
   * (`driver === null` → return), never a `consumer.fail`. FIRE-AND-FORGET — no answer token, no reply,
   * and NO correlation memory to leave dangling; the turn stops via the ordinary end-of-turn events
   * (`turn_end` / `turn_state{idle}`) the timeline already handles, not this leg. Its callers are the
   * two Stop affordances in the composer. NEVER throws out of the module (parity #490).
   */
  interrupt(conversationId: string): void
  /**
   * Encrypt a payload-carrying `new_session` control envelope onto the live session — asks the daemon
   * to KILL claude in the named conversation and spawn a fresh one under a newly minted session id, so
   * every stored setting re-applies at the spawn. NOT a `/clear` sent as ordinary message text: that
   * clears context in place and the process keeps everything it holds. (Since #1496 the Actions menu's
   * one `Reset session` row dispatches this verb; the typed `/clear` route is unchanged and reaches
   * claude down the message path.) Takes the conversation id as a SCALAR, like `requestModelList` and
   * unlike `dequeueMessage`
   * — the builder rebuilds a fresh literal, so no renderer-supplied key reaches the wire — and it is
   * REQUIRED: an unnamed restart is the daemon's process-wide follow-active cursor, which is another
   * conversation's restart as often as it is this one's (pyrycode#2099). The `send` TWIN, not
   * `requestDebugBundle`: an inert no-op when not connected (`driver === null` → return), never a
   * `consumer.fail`. FIRE-AND-FORGET — no answer token, NO REPLY of any kind (not even an error; a
   * named id the daemon cannot act on is silently inert), and no correlation memory to leave dangling;
   * the break surfaces through the existing `session_transition` marker the timeline already handles.
   * Its caller is the render affordance in the sibling ticket; this slice only wires the command path.
   * NEVER throws out of the module (parity #490).
   */
  newSession(conversationId: string): void
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
   * Encrypt a payload-carrying `rename_workspace` control envelope onto the live session — asks the
   * daemon to change a WORKSPACE's stored label (#1289). Its neighbour `changeWorkspace` moves ONE
   * CONVERSATION between workspaces; this renames the workspace itself, so it is scoped to a server
   * rather than to a chat and carries no conversation id at all. `payload.label` is the TRI-STATE's
   * two live arms — a string names the workspace, a literal `null` clears the label back to the folder
   * name — and both pass through untouched.
   *
   * `path` and `label` are renderer-supplied text the daemon polices SERVER-side (the path must equal a
   * stored conversation's `cwd` byte for byte, the label must be non-empty after trimming and at most
   * 128 characters) — the desktop never resolves the path into a local filesystem path and applies no
   * length check of its own. With no attempt identifier, existing callers remain fire-and-forget.
   * An identifier requests a content-free correlated workspaceRenameResult, including local failure.
   * Every workspace update still triggers the authoritative list refresh. Never throws.
   */
  renameWorkspace(payload: RenameWorkspacePayload, attemptId?: string): void
  /**
   * Encrypt a payload-carrying `set_system_prompt` control envelope onto the live session — asks the
   * daemon to store, replace or CLEAR one conversation's durable system prompt (#1249). Keyed by
   * CONVERSATION, not by session: the prompt must be settable with nothing running, and it outlives
   * every session the conversation has. `payload.system_prompt` is the TRI-STATE — `null` clears, `''`
   * is an explicitly-empty stored state, any other string is stored verbatim — and all three pass
   * through untouched.
   *
   * THE ONE WRITE VERB IN THIS INTERFACE THAT CORRELATES ITS REPLY. Its five neighbours
   * (`renameConversation`, `archiveConversation`, `unarchiveConversation`, `promoteConversation`,
   * `changeWorkspace`) all decline to correlate the `conversation_updated` they draw; this one must,
   * because the operator needs to learn whether the write took. So it is NOT fire-and-forget: exactly
   * one outcome is emitted per write that reached the wire — `systemPromptWriteConfirmed` off the
   * correlated ack, or `systemPromptWriteRejected` off a correlated `error`.
   *
   * IT ALSO REFUSES BEFORE THE SEND, which no neighbour does. A prompt over MAX_SYSTEM_PROMPT_BYTES of
   * UTF-8 is rejected here, reported through the same event as a daemon refusal, and never built into
   * a frame — the daemon would answer it with a non-retryable `protocol.malformed`, and there is no
   * reason to spend that on text this client can measure. The check runs BEFORE the connected guard,
   * so an over-length write is reported whether or not a socket is up.
   *
   * Otherwise the `send` TWIN: an inert no-op when not connected (`driver === null` → return, no
   * outcome, no correlation entry). A saved prompt does NOT touch the running session — the daemon
   * installs it at the conversation's next spawn — and nothing here may paper over that with an
   * optimistic local value. NOTHING RETRIES on any path. NEVER throws out of the module (parity #490).
   */
  setSystemPrompt(payload: SetSystemPromptPayload): void
  /**
   * Encrypt a `set_conversation_muted` envelope onto the live session — mutes or unmutes one
   * conversation's notifications on its host (#1595). Exactly one content-free conversationMuteResult
   * per call: `confirmed` off the correlated `conversation_updated`, `rejected` off a correlated `error`
   * or any local failure (not connected, build or send throw). A write the daemon never answers settles
   * nothing and is cleared on the next dial. The attempt id never reaches the wire. Never throws.
   */
  setConversationMuted(payload: SetConversationMutedPayload, attemptId: string): void
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
   *
   * `onProgress` is told after each chunk reaches the wire how far the transfer has got (#864), and it
   * is OPTIONAL — a caller that only wants the terminal passes nothing and behaves exactly as before.
   * It is a second parameter rather than a field on `input`, which is the PLAN's input and is spread
   * onto every chunk payload. Both early exits below return before any transfer exists, so a caller
   * that never reaches the wire is never told it did.
   */
  uploadAttachment(
    input: AttachmentChunkPlanInput,
    onProgress?: AttachmentTransferProgress
  ): Promise<AttachmentTransferResult>
  /**
   * Ask the host for one stored attachment and stream the answer into a reassembler, settling
   * `consumer` with the whole verified file or one static reason (#996). The `requestDebugBundle`
   * posture — a call that owns a waiting consumer, so a disconnected request FAILS rather than
   * silently sending nothing. Never throws; exactly one terminal per call.
   *
   * CORRELATION RIDES THE ENVELOPE, and the two answers correlate differently. The answering
   * `attachment_chunk` frames carry the transfer's own `attachment_id` AND the `in_reply_to` naming
   * this request; the reject carries only `in_reply_to`, because it is a plain `error` envelope with
   * no attachment id in it at all. Routing on the attachment id alone therefore could not deliver a
   * rejection to the request waiting for one, which is why the pending map is keyed by envelope id.
   * That numeric id stays main-internal and never rides an event to the window.
   *
   * `payload` is rebuilt as a fresh literal by this method's caller chain before it reaches the
   * builder, so no renderer-supplied key can reach the wire. Both ids are UNVALIDATED here: the
   * daemon owns the registry check and the confinement, and `resolveAttachmentPath` (via
   * `storeAttachment`) is the sole gate before the attachment id becomes a path component. Their
   * SIZE is bounded one layer out, at the IPC guard; a main-side caller that passes an identifier
   * long enough to over-cap the envelope anyway gets `send-failed` rather than a hung request.
   */
  requestAttachment(
    payload: RequestAttachmentPayload,
    consumer: AttachmentRetrievalConsumer
  ): void
  /**
   * Ask the host for one markdown file from a conversation's workspace, as it is right now, and
   * settle `consumer` with its verified bytes or one static reason (#1626). `requestAttachment`'s
   * contract exactly — same correlation by envelope id, same rejects, same idle deadline, same
   * teardown net, never throws — except that the daemon mints the transfer id, so the reassembler
   * pins to the first chunk's id rather than to one this client named. Every call sends a fresh
   * frame. The path is sent unchanged and is never resolved, logged or echoed on this side.
   */
  readWorkspaceFile(
    payload: ReadWorkspaceFilePayload,
    consumer: AttachmentRetrievalConsumer
  ): void
}

/**
 * Human-readable, secret-free banner text per failure category. Every string is static — the
 * machine-readable distinction lives in `code`; unknown codes (the driver's own error reasons)
 * fall back to a generic line. No caught-error text or wire value is ever interpolated here.
 */
function messageFor(code: string): string {
  switch (code) {
    case 'pairing-rejected':
      return 'Your pairing has expired or is no longer valid. Enter a new pairing code to reconnect.'
    case 'update-required':
      return 'This app is too old for this host. Update Pyrycode to reconnect.'
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
  const { deviceKeypair, pairedServer, deviceName, clientVersion } = deps
  // The origin binding (#1068), and the only line of this module that knows the server id. Every
  // `emitDaemonEvent(sink, …)` below emits into the BOUND sink, so all 39 of them carry the origin
  // without naming it and none of them can vary it — origin-free by construction, not by discipline.
  // `deps.sink` is deliberately dropped from the destructure above so that this `sink` — the bound
  // one — is the only binding by that name in the factory, and the unbound sink can be reached only
  // by naming `deps.sink` again, which nothing below does.
  const sink = bindServerOrigin(deps.sink, deps.serverId)
  const now = deps.now ?? ((): string => new Date().toISOString())
  const createDriver = deps.createDriver ?? createNoiseRelayDriver
  // The main-side answer_token mint (#236). Default: crypto.randomUUID (Node CSPRNG). A DI seam like
  // now / createDriver — the renderer never mints (the token needs randomness, stays out of the web
  // layer). It is an anti-replay idempotency key, not a credential; uniqueness + stability suffice.
  const mintToken = deps.mintToken ?? ((): string => randomUUID())
  // The retrieval idle-deadline seam (#996), defaulted to the real timer here so production passes
  // nothing — createRelaySupervisor's `timing.setTimer ?? setTimeout` idiom verbatim.
  const timing = deps.timing ?? {}
  const retrievalIdleTimeoutMs = timing.retrievalIdleTimeoutMs ?? RETRIEVAL_IDLE_TIMEOUT_MS
  const setTimer = timing.setTimer ?? ((fn, ms): ReturnType<typeof setTimeout> => setTimeout(fn, ms))
  const clearTimer = timing.clearTimer ?? ((handle): void => clearTimeout(handle))

  // Three locals, no store: the renderer's sessionStore (#2) is the single source of session
  // state; this module only emits into it. `stopped` doubles as the "stopping" flag that
  // suppresses the terminal a clean stop() produces.
  let started = false
  let stopped = false
  let driver: NoiseRelayDriver | null = null
  let authenticated = false
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
  // Envelope ids of outstanding create_conversation requests, for the #1307 rejection round-trip — a
  // further member of the same unique-per-request-envelope-id tier, in pendingCreateFolders' exact shape.
  // A Set, not a Map: the conversationCreateRejected event is BARE (no value to carry per entry, contrast
  // pendingSettings' changeId) — membership ("is this envelope id an outstanding create request?") is the
  // whole query. Keyed by the request's unique envelope id (not a FIFO like outstandingAnswers, whose
  // `error` carries no discriminating id), so a match is unambiguously the reply to THAT request. The key
  // is a number this client MINTED, never a daemon-supplied string, so nothing inbound reaches a prototype
  // setter through it — and a later widening that keys this by anything daemon-supplied must say why.
  //
  // Set after a successful send in createConversation, matched by the reply's Envelope.in_reply_to and
  // deleted in onDriverEvent, and cleared on each dial(). THE SUCCESS REPLY DOES NOT CONSUME AN ENTRY
  // (pendingCreateFolders again): `conversation_created` is also an unsolicited broadcast, so the entry
  // lives until a correlated error or the next dial. Nothing bounds the set, deliberately, on
  // pendingHistoryRequests' argument — an entry costs one number, only this client's own sends add one,
  // every match deletes one and every dial clears all, so a daemon withholding replies cannot grow it
  // faster than the operator creates chats. The consequence is that a late error for an already-created
  // conversation still emits a rejection; the consumer gates on its own in-flight state, the way #396's
  // newFolderStore honors a reply only while a request is outstanding, and #1308 inherits that obligation.
  //
  // Single-writer — every mutation runs to completion inside a synchronous createConversation /
  // onDriverEvent body, no await between a read and a write (the nextEnvelopeId / outstandingAnswers /
  // pendingSettings single-writer rationale).
  const pendingCreateConversations = new Set<number>()
  // envelopeId → the conversation id that request_session_settings named, for the run-config read's
  // attribution (#1176). The reply carries no conversation id of its own and the wire cannot grow one
  // (ADR 0002), so the conversation a reply describes is whichever one this client asked about under
  // that envelope id — which makes this map the ONLY place that fact exists.
  //
  // A MAP, like pendingSettings and unlike pendingCreateFolders' bare Set: there is a value to carry
  // per entry, and a lookup by exactly one key is the whole query. Its key is a number this client
  // MINTED (nextEnvelopeId), not a daemon-supplied string, so no prototype setter is reachable through
  // it under any inbound frame — a bare object would still be wrong here, and a later widening that
  // keys this by anything daemon-supplied must keep the Map for the reason the Set has one.
  //
  // Set after a SUCCESSFUL send in requestSessionSettings, matched by the reply's Envelope.in_reply_to
  // and deleted in onDriverEvent, and cleared on each dial(). The ordering is load-bearing twice over:
  // a build or send that throws advances no envelope id, so an entry left under an unspent id would
  // answer whichever request re-mints it with the wrong conversation (pendingSettings' and
  // pendingCreateFolders' stated ordering), and it is what keeps this map's cost strictly smaller than
  // the encrypted frame build and socket write that necessarily precede it — so a daemon flapping
  // turn_state to drive requests gains nothing here that it did not already have on the wire.
  // Single-writer — every mutation runs to completion inside a synchronous requestSessionSettings /
  // onDriverEvent body, no await between a read and a write (the nextEnvelopeId / outstandingAnswers /
  // pendingSettings single-writer rationale).
  const pendingConfigRequests = new Map<number, string>()
  function invalidateConfigRequests(conversationId: string): void {
    for (const [id, conversation] of pendingConfigRequests) {
      if (conversation === conversationId) pendingConfigRequests.delete(id)
    }
  }
  // envelopeId → the conversation id that request_history named, for a history page's attribution
  // (#1222). THE SAME PROBLEM pendingConfigRequests solves, on a second reply that names no
  // conversation of its own and cannot grow one (correlation rides `in_reply_to` and nothing in a page
  // is echoed from the request), so this map is again the ONLY place that fact exists.
  //
  // A MAP for pendingConfigRequests' reasons exactly: a value to carry per entry, a lookup by one key
  // as the whole query, and a key this client MINTED (nextEnvelopeId) rather than a daemon-supplied
  // string — so no prototype setter is reachable through it under any inbound frame, and a later
  // widening that keys this by anything daemon-supplied must keep the Map.
  //
  // It differs from that sibling in ONE way and it is worth stating: a run-config read is one ask at a
  // time in practice, where a walk is a SEQUENCE — #1224 may have an ask outstanding while the operator
  // keeps scrolling. Nothing here bounds the map's size, deliberately: an entry costs one number and
  // one string, entries are deleted on every match, and every one is cleared on dial(), so the only way
  // to accumulate them is for this client to send asks a daemon never answers — a rate this client
  // controls, not a remote one.
  //
  // Set after a SUCCESSFUL send in requestHistory, matched by the reply's Envelope.in_reply_to and
  // deleted in onDriverEvent, and cleared on each dial(). The ordering is load-bearing for the reason
  // pendingConfigRequests states: a build or send that throws advances no envelope id, so an entry left
  // under an unspent id would answer whichever request re-mints it — here handing a page of one
  // conversation's history to another. Single-writer — every mutation runs to completion inside a
  // synchronous requestHistory / onDriverEvent body, no await between a read and a write.
  const pendingHistoryRequests = new Map<number, string>()
  // envelopeId → the conversation id that request_system_prompt named, for a system-prompt read's
  // attribution (#1230). THE SAME PROBLEM the two maps above solve, on a third reply that names no
  // conversation of its own — and here the omission is a SECURITY PROPERTY upstream rather than a
  // shape decision: it is what makes an unhosted conversation's answer byte-identical to a
  // hosted-but-quiet one, so the verb cannot be used as a conversation-membership probe. This map is
  // therefore the ONLY place the reply's conversation exists, and no future wire change will supply
  // one.
  //
  // A MAP for pendingConfigRequests' reasons exactly: a value to carry per entry, a lookup by one key
  // as the whole query, and a key this client MINTED (nextEnvelopeId) rather than a daemon-supplied
  // string — so no prototype setter is reachable through it under any inbound frame, and a later
  // widening that keys this by anything daemon-supplied must keep the Map.
  //
  // Set after a SUCCESSFUL send in requestSystemPrompt, matched by the reply's Envelope.in_reply_to
  // and deleted in onDriverEvent, and cleared on each dial(). The ordering is load-bearing for the
  // reason pendingConfigRequests states: a build or send that throws advances no envelope id, so an
  // entry left under an unspent id would answer whichever request re-mints it — here handing one
  // conversation's system prompt to another. Nothing bounds the map's size, deliberately, on
  // pendingHistoryRequests' argument: an entry costs one number and one string, every match deletes
  // one, every dial clears all, so the only way to accumulate is for this client to send asks a daemon
  // never answers — a rate this client controls, not a remote one. Single-writer — every mutation runs
  // to completion inside a synchronous requestSystemPrompt / onDriverEvent body, no await between a
  // read and a write.
  const pendingSystemPromptRequests = new Map<number, string>()
  // envelopeId → the conversation id that set_system_prompt named, for a system-prompt WRITE's
  // attribution (#1249). The ninth correlation store, and the first whose reply is a record that DOES
  // name a conversation of its own — which is exactly why the map is still the only acceptable source.
  // The ack is the reused `conversation_updated`, so a daemon answering write A with a record naming
  // conversation B would misattribute the outcome to B if the emit read the record's `id`; reading the
  // map's value instead makes the emitted id the one THIS CLIENT wrote to, and the wrong-record case
  // then costs a lost confirmation rather than a false one.
  //
  // A MAP for pendingConfigRequests' reasons exactly: a value to carry per entry, a lookup by one key
  // as the whole query, and a key this client MINTED (nextEnvelopeId) rather than a daemon-supplied
  // string — so no prototype setter is reachable through it under any inbound frame, and a later
  // widening that keys this by anything daemon-supplied must keep the Map.
  //
  // IT IS READ FROM TWO INBOUND ARMS, unlike pendingSystemPromptRequests' one, because this verb HAS
  // refusals where its read half has none: `conversation-updated` settles it as a confirmation and
  // `daemon-error` settles it as a rejection. Both DELETE the entry, which is what makes "exactly one
  // outcome per write" structural rather than promised — a daemon sending both frames for one write
  // has the first consume the entry and the second match nothing.
  //
  // Set after a SUCCESSFUL send in setSystemPrompt, matched by the reply's Envelope.in_reply_to and
  // deleted in onDriverEvent, and cleared on each dial(). The ordering is load-bearing for the reason
  // pendingConfigRequests states: a build or send that throws advances no envelope id, so an entry
  // left under an unspent id would settle whichever request re-mints it — here reporting one
  // conversation's write as another's. Nothing bounds the map's size, deliberately, on
  // pendingHistoryRequests' argument: an entry costs one number and one string, every settle deletes
  // one, every dial clears all, so the only way to accumulate is for this client to send writes a
  // daemon never answers — a rate this client controls, not a remote one. Single-writer — every
  // mutation runs to completion inside a synchronous setSystemPrompt / onDriverEvent body, no await
  // between a read and a write.
  const pendingSystemPromptWrites = new Map<number, string>()
  // MCP status ask correlation (#1578): envelope id → the conversation this app asked about. The success
  // reply is an ordinary `mcp_status` carrying no in_reply_to, so it cannot consume an entry; only a
  // correlated refusal or the next dial removes one. Capped, oldest evicted first, so a renderer that asks
  // in a loop cannot grow it without bound.
  const pendingMcpStatusRequests = new Map<number, string>()
  // MCP reconnect correlation (#1582): envelope id → the conversation this app acted on, and never the
  // server name. Same lifecycle and cap as the map above.
  const pendingMcpReconnects = new Map<number, string>()
  // MCP toggle correlation (#1586): envelope id → conversation, never the server name or requested state.
  // Its own map, so a toggle refusal can never settle as a reconnect one; ids share one sequence.
  const pendingMcpToggles = new Map<number, string>()
  // Wire envelope id to the optional renderer attempt; reset with each connection generation.
  const pendingWorkspaceRenames = new Map<number, string>()
  // Wire envelope id → the renderer attempt of a set_conversation_muted write (#1595). Keyed by a
  // client-minted number, so no daemon-supplied string ever becomes a key. Settled (and deleted) by
  // the correlated ack or error, whichever lands first, and cleared on each dial.
  const pendingMuteWrites = new Map<number, string>()
  // Attachment transfers currently on the wire (#861). A SET, not the debug bundle's single slot: two
  // files can be attached in one session, and a lone slot would have to abandon the first to admit the
  // second. Membership plus a scan is the whole query — the success reply is looked up by
  // `attachmentId`, the rejects by `sentEnvelope` — over a handful of entries at most. Added in
  // uploadAttachment before the first chunk goes out, removed when the transfer settles, and cleared
  // by failAttachmentTransfers on every connection-fatal event. Single-writer — every mutation runs to
  // completion inside a synchronous body (the nextEnvelopeId / pendingSettings rationale).
  const activeTransfers = new Set<AttachmentTransfer>()
  // Retrievals currently waiting on the host (#996), keyed by the envelope id of the
  // `request_attachment` this client sent — the ONLY handle both answers publish, since the reject
  // is a plain `error` envelope with no attachment id in it. A MAP, not the bundle's single slot and
  // not the upload leg's Set: two attachments can be fetched at once (so a lone slot would abandon
  // the first to admit the second), and unlike a transfer a retrieval is looked up by exactly one
  // key, so a scan would be a worse shape than a keyed get. The pendingSettings / pendingCreateFolders
  // correlation idiom, with a reassembler and a deadline hanging off each entry.
  //
  // Added in requestAttachment AFTER the frame is on the wire — a build or send that throws registers
  // nothing, because this client's envelope-id counter advances only on a successful build and an
  // entry left under an unspent id would swallow the reject of whichever envelope re-mints it
  // (pendingSettings' and pendingCreateFolders' stated ordering). Removed at the single settleRetrieval
  // choke point, and cleared by failAttachmentRetrievals on every connection-fatal event. Single-writer —
  // every mutation runs to completion inside a synchronous body with no await between a read and a
  // write (the nextEnvelopeId / pendingSettings rationale).
  const pendingRetrievals = new Map<number, PendingRetrieval>()

  // A later send/close failure must not erase this connection's authentication rejection.
  let pairingRejected = false

  // `minClientVersion` is the classifier's already-validated MAJOR.MINOR.PATCH (#1613), placed on the
  // event only for `update-required`, and never logged.
  function emitFailed(code: string, message = messageFor(code), minClientVersion?: string): void {
    authenticated = false
    if (pairingRejected) {
      code = 'pairing-rejected'
      message = messageFor(code)
    }
    const version = code === 'update-required' && minClientVersion !== undefined
      ? { min_client_version: minClientVersion } : {}
    emitDaemonEvent(sink, { type: 'failed', error: { code, message, retryable: false, ...version } })
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

  // The connection-teardown net for in-flight retrievals (#996) — failAttachmentTransfers' twin, and
  // deliberately the SET-shaped one rather than failBundleStream's single-slot release: a teardown
  // re-dials into a fresh Noise session with no resume, so every daemon-side retrieval dies at once
  // and each waiting consumer must be told. With no answer ever coming and the idle deadline the only
  // other backstop, an unfailed consumer would sit for 30 s and then report the wrong reason.
  //
  // Release-then-fail, like both twins: snapshot and clear the map BEFORE settling, so no consumer's
  // fail can mutate the map mid-iteration and the module holds no reference to a retrieval it has
  // already abandoned. Clearing the map also drops each reassembler's accumulated chunk bytes.
  // Idempotent and total — an empty map is a no-op.
  //
  // This is what makes dial()'s reset of nextEnvelopeId to 2 safe for this map: every live retrieval
  // is failed before ids recycle, so a stale envelope id can never correlate an answer on the
  // reconnected session (the pendingSettings.clear() rationale, applied to the retrieval map).
  function failAttachmentRetrievals(): void {
    const abandoned = [...pendingRetrievals.values()]
    pendingRetrievals.clear()
    for (const retrieval of abandoned) {
      clearTimer(retrieval.deadline)
      retrieval.consumer.fail('connection-lost')
    }
  }

  /**
   * The ONE exit from a pending retrieval: clear its deadline, drop its entry, settle its consumer.
   * Routing every terminal through here is what makes "exactly one terminal" a property of there
   * being a single exit rather than of a guard at each site — the entry is gone, so a later frame,
   * a later reject and a late deadline all find nothing and are inert.
   *
   * Dropping the entry is also the byte release: the reassembler and everything it accumulated
   * become unreachable here, which is failBundleStream's stated hygiene rather than terminal
   * correctness (the reassembler's own `settled` flag already owns that where it settles itself).
   */
  function settleRetrieval(
    envelopeId: number,
    entry: PendingRetrieval,
    reason: AttachmentRetrievalFailure
  ): void {
    clearTimer(entry.deadline)
    pendingRetrievals.delete(envelopeId)
    entry.consumer.fail(reason)
  }

  /**
   * A fresh idle deadline for the retrieval under `envelopeId` — armed at send and re-armed on every
   * accepted chunk, so it measures SILENCE rather than total transfer time.
   *
   * It re-reads the map at fire time rather than closing over the entry, which is what makes a late
   * fire against an already-settled retrieval a no-op even if a clearTimer were ever missed.
   */
  function armRetrievalDeadline(envelopeId: number): ReturnType<typeof setTimeout> {
    return setTimer(() => {
      const live = pendingRetrievals.get(envelopeId)
      if (live === undefined) return
      settleRetrieval(envelopeId, live, 'timed-out')
    }, retrievalIdleTimeoutMs)
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
        pairingRejected = false
        authenticated = true
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
            if (inbound.pairingReject === 'pairing-rejected') {
              pairingRejected = true
              failBundleStream()
              failAttachmentTransfers()
              failAttachmentRetrievals()
              abandonHistoryRequests()
              emitFailed('pairing-rejected')
              return
            }
            // The app-too-old rejection (#1613), terminal for THIS host only. Supervision is halted
            // on the sealed error itself, not left to the 4412 close that follows it, so no backoff
            // re-dial can start whatever close the socket ends with. Bumping `generation` is dial()'s
            // own fence: the stopped driver's terminal and the relay's close both carry the old
            // generation and are dropped before onDriverEvent, so neither can overwrite the reason
            // with `connection-closed`. Nothing is persisted; a manual reconnect() dials afresh.
            if (inbound.updateRequired !== undefined) {
              failBundleStream()
              failAttachmentTransfers()
              failAttachmentRetrievals()
              abandonHistoryRequests()
              generation++
              const halted = driver
              driver = null
              halted?.stop()
              emitFailed('update-required', undefined, inbound.updateRequired.minClientVersion)
              return
            }
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
              // create_conversation rejection correlation (#1307), the create-folder arm's nearest twin in
              // the same unique-per-request-envelope-id tier and identical to it in every respect but the
              // verb. Correlate the content-free error to a pending create_conversation by
              // Envelope.in_reply_to; a match consumes the frame ENTIRELY: emit the BARE rejection, drop the
              // pending entry, and skip BOTH the reassembler.fail and the modal-FIFO shift below. An error
              // correlated by a UNIQUE per-request envelope id is unambiguously the reply to THAT request —
              // failing a healthy in-flight bundle or consuming the oldest modal answer on it would be a
              // bug. Order relative to the siblings is immaterial: an envelope id is minted once, so at most
              // one store can hold it. The emitted event reads NOTHING from the untrusted error payload — it
              // is nullary by construction; the numeric inReplyTo stays main-internal, never placed on the
              // event, and the daemon's refusal message is not echoed even in part (it names no path of its
              // own to surface). Diagnostics name only the static rejection classification.
              if (pendingCreateConversations.has(inReplyTo)) {
                pendingCreateConversations.delete(inReplyTo)
                deps.diagnosticLog?.event({ event: 'conversation-create-failed', code: 'server-rejected' })
                emitDaemonEvent(sink, { type: 'conversationCreateRejected' })
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
              // History-request rejection correlation (#1222), the fourth member of the same
              // unique-per-request-envelope-id tier. Order among them is immaterial for the reason the
              // siblings state — an envelope id is minted once, so at most one store can hold it — and
              // a match consumes the frame ENTIRELY, skipping both the reassembler.fail and the
              // modal-FIFO shift below exactly as they do.
              //
              // A CORRELATED REFUSAL ALWAYS SETTLES THE ASK, including one whose code is outside the
              // verb's five published rejects. That case is real rather than defensive: an entry too
              // large for any page draws `message.too_long` from the daemon's own transport, and a walk
              // that dropped it would stall with no terminal and no cursor to step past the entry.
              // `'unclassified'` is where those land.
              //
              // What crosses is the CLIENT-OWNED reason narrowed at the decode boundary plus the
              // conversation id this app itself named — never the daemon's `code` string, never its
              // static message, and never the numeric in_reply_to the match was made on. `retryable` is
              // computed HERE, at the single emit, so the walk driver cannot re-derive it wrong.
              const failedHistory = pendingHistoryRequests.get(inReplyTo)
              if (failedHistory !== undefined) {
                pendingHistoryRequests.delete(inReplyTo)
                const reason: HistoryRequestFailure = inbound.historyReject ?? 'unclassified'
                deps.diagnosticLog?.event({ event: 'history-request-failed', code: reason })
                emitDaemonEvent(sink, {
                  type: 'historyRequestFailed',
                  conversationId: failedHistory,
                  reason,
                  retryable: reason === 'history-unavailable'
                })
                return
              }
              // System-prompt WRITE rejection correlation (#1249), the fifth member of the same
              // unique-per-request-envelope-id tier. Order among them is immaterial for the reason
              // the siblings state — an envelope id is minted once, so at most one store can hold it
              // — and a match consumes the frame ENTIRELY, skipping both the reassembler.fail and the
              // modal-FIFO shift below exactly as they do. Consuming the frame is right HERE and
              // wrong on the ack arm above: an error correlated to a write has exactly one meaning,
              // where the ack doubles as every client's list-refresh trigger.
              //
              // A CORRELATED REFUSAL ALWAYS SETTLES THE WRITE, including one whose code is outside
              // the verb's two published rejects. Dropping such a frame would leave #1250 reporting a
              // refused write as permanently in flight, which is strictly worse than reporting it
              // refused for a reason this client could not name. `'unclassified'` is where those land.
              //
              // What crosses is the CLIENT-OWNED reason narrowed at the decode boundary plus the
              // conversation id this app itself named — never the daemon's `code` string, never its
              // static message, and never the numeric in_reply_to the match was made on. No
              // `retryable` flag: BOTH published conditions are non-retryable, so a carried flag would
              // be a constant, and the reasoning that makes historyRequestFailed carry one — exactly
              // one retryable member in its set — does not transfer.
              //
              // It reads the SAME map the ack arm does, which is what makes "exactly one outcome per
              // write" structural: whichever frame arrives first deletes the entry, and the other
              // matches nothing.
              const failedWrite = pendingSystemPromptWrites.get(inReplyTo)
              if (failedWrite !== undefined) {
                pendingSystemPromptWrites.delete(inReplyTo)
                emitDaemonEvent(sink, {
                  type: 'systemPromptWriteRejected',
                  conversationId: failedWrite,
                  reason: inbound.systemPromptReject ?? 'unclassified'
                })
                return
              }
              // MCP status ask refusal (#1578), in the same unique-envelope-id tier. The event names the
              // conversation recorded at send time, never one from the error, and carries only the
              // client-owned reason. The stored report is left alone: a refusal clears nothing.
              const refusedMcpStatus = pendingMcpStatusRequests.get(inReplyTo)
              if (refusedMcpStatus !== undefined) {
                pendingMcpStatusRequests.delete(inReplyTo)
                const reason = inbound.mcpStatusReject ?? 'unclassified'
                deps.diagnosticLog?.event({ event: 'mcp-status-request-rejected', code: reason })
                emitDaemonEvent(sink, { type: 'mcpStatusRequestRejected', conversationId: refusedMcpStatus, reason })
                return
              }
              // MCP reconnect refusal (#1582), in the same tier. Every code settles as the ONE permanent
              // outcome: the daemon merges the causes on purpose, so neither `code` nor any narrowed
              // field is read here, and nothing but the recorded conversation crosses.
              const refusedMcpReconnect = pendingMcpReconnects.get(inReplyTo)
              if (refusedMcpReconnect !== undefined) {
                pendingMcpReconnects.delete(inReplyTo)
                deps.diagnosticLog?.event({ event: 'mcp-reconnect-rejected' })
                emitDaemonEvent(sink, { type: 'mcpReconnectRejected', conversationId: refusedMcpReconnect })
                return
              }
              // MCP toggle refusal (#1586): the reconnect rule above, settled as its own event.
              const refusedMcpToggle = pendingMcpToggles.get(inReplyTo)
              if (refusedMcpToggle !== undefined) {
                pendingMcpToggles.delete(inReplyTo)
                deps.diagnosticLog?.event({ event: 'mcp-toggle-rejected' })
                emitDaemonEvent(sink, { type: 'mcpToggleRejected', conversationId: refusedMcpToggle })
                return
              }
              const failedRename = pendingWorkspaceRenames.get(inReplyTo)
              if (failedRename !== undefined) {
                pendingWorkspaceRenames.delete(inReplyTo)
                workspaceRenameResult(failedRename, 'rejected')
                return
              }
              // Mute write refusal (#1595): every code settles as the one rejected outcome, and the
              // code itself is not read.
              const failedMute = pendingMuteWrites.get(inReplyTo)
              if (failedMute !== undefined) {
                pendingMuteWrites.delete(inReplyTo)
                conversationMuteResult(failedMute, 'rejected')
                return
              }
              // Attachment-RETRIEVAL rejection correlation (#996), the fourth member of the same
              // unique-per-request-envelope-id tier, and the ONLY correlation this reject can have:
              // it is a plain `error` envelope carrying no attachment id at all, so a design routing
              // on the payload id could not deliver it to the request waiting for one. A match
              // consumes the frame entirely, exactly as its three siblings do. Order among the four
              // is immaterial — an envelope id is minted once, so at most one can hold it.
              //
              // The abort takes the LONG way round on purpose. `attachment.stream_aborted` is routed
              // through the reassembler's two-member door rather than settled directly, because that
              // door is where the discard-the-partial obligation lives (#995 reserved the member for
              // this translation); everything accumulated goes with it, and the client never presents
              // partial bytes as the file. Retry is allowed after a backoff and is NOT built here —
              // a re-request re-runs the same resolution work on the host, and no automatic retry is
              // asked for.
              //
              // Every other code settles DIRECTLY, with nothing to discard: a reject yields no bytes.
              // `attachment.not_found` gets its own static reason; anything else is reported as the
              // catch-all rather than coerced into a not-found that did not happen. Nothing re-parses
              // the daemon's `code` string here — #965 mapped it at the decode boundary, and per
              // CLAUDE.md it must never become a lookup path. No daemon text reaches the consumer.
              const retrieval = pendingRetrievals.get(inReplyTo)
              if (retrieval !== undefined) {
                if (inbound.outcome === 'attachment-stream-aborted') {
                  // Settles through the reassembler's consumer, which routes back into
                  // settleRetrieval — one exit, not two.
                  retrieval.reassembler.fail('stream-aborted')
                  return
                }
                settleRetrieval(
                  inReplyTo,
                  retrieval,
                  inbound.outcome === 'attachment-not-found' ? 'not-found' : 'daemon-error'
                )
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
              deps.diagnosticLog?.event({ event: 'modal-answer-rejected' })
              emitDaemonEvent(sink, { type: 'modalAnswerRejected', modalId: rejectedModalId })
            }
            return
          }
          case 'session-settings': {
            // CORRELATION-GATED SINCE #1176, fail-closed, in the shape the session-settings-updated
            // arm below already uses. The reply names no conversation, so the one it describes is the
            // one this client asked about under the envelope id it answers: match by
            // Envelope.in_reply_to, then carry the recorded id. A reply with an absent in_reply_to
            // short-circuits BEFORE the map lookup; a reply matching no outstanding entry — a stale
            // reply from a connection whose ids were cleared, a duplicate of one already matched, or a
            // hostile daemon forging a snapshot for a request this client never sent — is ignored
            // entirely, with no coercion and no partial event. Both branches are SILENT: the only
            // values a diagnostic could carry are the conversation id and the wire routing id, and
            // neither may reach a sink.
            //
            // The drop is deliberately total rather than "emit without the id". A run-config reply
            // this client cannot attribute is exactly the input every consumer downstream must not
            // accept: the renderer would have to guess a conversation, and correlationRouter would
            // learn a session→server binding off a frame tied to no request.
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo === undefined) return
            const conversationId = pendingConfigRequests.get(inReplyTo)
            if (conversationId === undefined) return
            pendingConfigRequests.delete(inReplyTo)
            // The run-configuration data path (#491). A fresh literal with named fields, never a
            // spread of inbound.sessionSettings — so a future decoder that grew a field cannot
            // smuggle it across. snake→camel for the id (`sessionId`, matching the sessionTransition
            // arm) and for `permissionMode` (#1020); the other four value fields keep their wire
            // names, so the event reads the way the daemon's reply does.
            //
            // `session_id: ''` crosses VERBATIM. It is the daemon saying "I have no session to
            // address", which the sheet's gate must be able to see; coercing it to null here would
            // make it indistinguishable from "no reply yet" and re-open the inert-sheet defect one
            // layer down. `permission_mode: ''` is the SAME reading arriving on the same frame — no
            // session was resolved — and crosses verbatim for the same reason. The two are read as a
            // pair; neither is inferred from the other, and neither is inferred from `yolo`.
            // `conversationId` is the map's value, never a field of the decoded payload — the reply
            // has none — and the numeric in_reply_to it was resolved from is NOT placed on the event:
            // the renderer receives the id it supplied, not the wire routing id.
            emitDaemonEvent(sink, {
              type: 'runConfigReceived',
              conversationId,
              sessionId: inbound.sessionSettings.session_id,
              model: inbound.sessionSettings.model,
              effort: inbound.sessionSettings.effort,
              effectiveEffort: inbound.sessionSettings.effective_effort,
              yolo: inbound.sessionSettings.yolo,
              permissionMode: inbound.sessionSettings.permission_mode,
              used_tokens: inbound.sessionSettings.used_tokens,
              window_tokens: inbound.sessionSettings.window_tokens,
              // The three capability flags only (#1654), by name; the wire object itself never crosses.
              slashCommands: inbound.sessionSettings.capabilities?.slash_commands,
              mcpServers: inbound.sessionSettings.capabilities?.mcp_servers,
              contextUsageDetail: inbound.sessionSettings.capabilities?.context_usage_detail
            })
            return
          }
          case 'system-prompt': {
            // CORRELATION-GATED, fail-closed, in the shape the two arms below it use and for the same
            // reason: the reply names no conversation, so the one it describes is the one this client
            // asked about under the envelope id it answers. An absent in_reply_to short-circuits
            // BEFORE the lookup; a reply matching no outstanding entry — a stale reply from a
            // connection whose ids were cleared, a duplicate of one already matched, or a hostile
            // daemon forging a prompt for a request this client never sent — is ignored entirely, with
            // no coercion and no partial event. Both branches are SILENT: the only values a diagnostic
            // could carry are the conversation id and the wire routing id, and neither may reach a
            // sink.
            //
            // The drop is deliberately total rather than "emit without the id", and on this frame the
            // reason is sharper than on its neighbours. The reply carries NO conversation id BY
            // DESIGN, upstream, so that an unhosted conversation's answer is byte-identical to a
            // hosted-but-quiet one and the verb cannot be used as a membership probe. A consumer
            // handed an unattributed prompt would have to guess a conversation — and #1078 then offers
            // that guess to the operator as editable text, writing one conversation's prompt over
            // another's on save.
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo === undefined) return
            const conversationId = pendingSystemPromptRequests.get(inReplyTo)
            if (conversationId === undefined) return
            pendingSystemPromptRequests.delete(inReplyTo)
            // A fresh literal with named fields, never a spread of inbound.systemPrompt — so a future
            // decoder that grew a field cannot smuggle it across. snake→camel per this channel's
            // convention.
            //
            // `systemPrompt` CROSSES AS DECODED, and the three states stay apart: `undefined` (no
            // prompt stored), `''` (an explicitly empty prompt stored) and any other string. No `??`,
            // no `||`, no truthiness read — any of them is the collapse that would stop a consumer
            // writing the value back unchanged. `sessionPromptStatus` is the client-owned literal the
            // decode narrowed against constants, and is INDEPENDENT of the prompt: neither is inferred
            // from the other here or anywhere downstream.
            //
            // `conversationId` is the map's value, never a field of the decoded payload — the reply
            // has none — and the numeric in_reply_to it was resolved from is NOT placed on the event:
            // the window receives the id it supplied, not the wire routing id.
            emitDaemonEvent(sink, {
              type: 'systemPromptReceived',
              conversationId,
              systemPrompt: inbound.systemPrompt.system_prompt,
              sessionPromptStatus: inbound.systemPrompt.session_prompt_status
            })
            return
          }
          case 'history-page': {
            // CORRELATION-GATED, fail-closed, in the shape the session-settings arm above uses and for
            // the identical reason: the reply names no conversation, so the one it describes is the one
            // this client asked about under the envelope id it answers. An absent in_reply_to
            // short-circuits BEFORE the lookup; a page matching no outstanding entry — a stale reply
            // from a connection whose ids were cleared, a duplicate of one already matched, or a
            // hostile daemon forging a page for a request this client never sent — is ignored entirely,
            // with no coercion and no partial event. Both branches are SILENT: the only values a
            // diagnostic could carry are the conversation id and the wire routing id.
            //
            // The drop is deliberately total rather than "emit without the id". A page this client
            // cannot attribute is exactly the input the window must not accept: it would have to guess
            // a conversation, and a guess writes someone else's transcript into the open one.
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo === undefined) return
            const conversationId = pendingHistoryRequests.get(inReplyTo)
            if (conversationId === undefined) return
            pendingHistoryRequests.delete(inReplyTo)
            deps.diagnosticLog?.event({ event: 'history-page-received' })
            // A fresh literal with named fields, never a spread of inbound.historyPage — so a future
            // decoder that grew a field cannot smuggle it across. snake→camel for `at_start` per this
            // channel's convention; `entries` and `cursor` keep their names and their values.
            //
            // Both are carried AS SENT: nothing normalises a short or empty page into an end-of-log
            // flag, because `atStart` is the only termination signal and a page filling exactly at the
            // log's first entry reports it false. Nor is either inferred from how many entries
            // survived the decode: an EMPTY `entries` here can mean an empty page OR a page every
            // entry of which was skipped (#1227), and both must still settle the ask.
            //
            // `entries` is the TYPED array by reference — since #1227 the transport decodes each stored
            // payload against the live-lane parser for its type, so nothing untyped crosses from here.
            // This assignment is also the drift guard between `DecodedHistoryEvent` and its
            // `HistoryTimelineEvent` mirror: the two are declared in separate modules (transport is
            // IPC-free by construction), and an arm that stopped matching is a compile error at this
            // one site. `conversationId` is the map's value, never a field of the payload (there is
            // none) — and no entry carries a payload's daemon-asserted `conversation_id` either, so
            // this stays the page's ONLY routing key. The numeric in_reply_to it was resolved from is
            // NOT placed on the event: the window receives the id it supplied, not the wire routing id.
            emitDaemonEvent(sink, {
              type: 'historyPageReceived',
              conversationId,
              entries: inbound.historyPage.entries,
              cursor: inbound.historyPage.cursor,
              atStart: inbound.historyPage.at_start
            })
            return
          }
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
              conversationId: inbound.delta.conversation_id,
              daemonTs: inbound.ts
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
              outcome: inbound.turnEnd.outcome,
              isError: inbound.turnEnd.is_error,
              terminalReason: inbound.turnEnd.terminal_reason,
              errorCategory: inbound.turnEnd.error_category,
              conversationId: inbound.turnEnd.conversation_id,
              daemonTs: inbound.ts,
              ...turnEndMetricsOf(inbound.turnEnd)
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
              conversationId: inbound.turnState.conversation_id,
              daemonTs: inbound.ts
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
              conversationId: inbound.stall.conversation_id,
              daemonTs: inbound.ts
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
              conversationId: inbound.apiRetry.conversation_id,
              daemonTs: inbound.ts
            })
            return
          case 'compacting':
            emitDaemonEvent(sink, {
              type: 'compacting',
              active: inbound.compacting.active,
              compactResult: inbound.compacting.compact_result,
              compactError: inbound.compacting.compact_error,
              conversationId: inbound.compacting.conversation_id,
              daemonTs: inbound.ts
            })
            return
          case 'banner':
            emitDaemonEvent(sink, {
              type: 'banner',
              conversationId: inbound.banner.conversation_id,
              level: inbound.banner.level,
              text: inbound.banner.text,
              stopsTurn: inbound.banner.stops_turn,
              truncated: inbound.banner.truncated
            })
            return
          case 'compaction-boundary':
            emitDaemonEvent(sink, {
              type: 'compactionBoundary',
              conversationId: inbound.boundary.conversation_id,
              trigger: inbound.boundary.trigger,
              preTokens: inbound.boundary.pre_tokens,
              postTokens: inbound.boundary.post_tokens
            })
            return
          case 'session-facts':
            emitDaemonEvent(sink, {
              type: 'sessionFacts',
              conversationId: inbound.sessionFacts.conversation_id,
              claudeCodeVersion: inbound.sessionFacts.claude_code_version,
              permissionMode: inbound.sessionFacts.permission_mode,
              truncatedFields: inbound.sessionFacts.truncated_fields
            })
            return
          case 'mcp-status':
            // Named fields only, so a later decoder field cannot cross IPC. The rows are the decoder's
            // fresh literals. Stateless: no dedup and no memo keyed by a daemon-supplied id.
            emitDaemonEvent(sink, {
              type: 'mcpStatus',
              conversationId: inbound.mcpStatus.conversation_id,
              servers: inbound.mcpStatus.servers,
              droppedServers: inbound.mcpStatus.dropped_servers
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
            // and `model` keeps its warnings in full. It used to stop at the announced-model bridge
            // (#588), which rebuilt a fresh two-field literal from named fields; #1146 widened that
            // literal — dropping the id is what made the announced-model store one app-wide slot showing
            // the wrong server's model — so it now stops as a `Map` key in that store, never copied into
            // the held record and so reaching no render surface. An unknown id is an explicit no-match
            // there, never a fallback onto the open conversation. Deliberately stateless: no dedup, no coalescing, no timer, no last-value
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
          case 'tool-progress':
            emitDaemonEvent(sink, {
              type: 'toolProgress',
              conversationId: inbound.toolProgress.conversation_id,
              turnId: inbound.toolProgress.turn_id,
              toolUseId: inbound.toolProgress.tool_use_id,
              elapsedSeconds: inbound.toolProgress.elapsed_seconds
            })
            return
          case 'thinking-progress':
            // The thinking-token data path (#1313, decoded at #1312). Emit a fresh literal carrying
            // the reading and the routing key, copied BY NAME from the already-decoded,
            // already-validated payload — never a spread of inbound.thinkingProgress (the
            // assistant-delta idiom), so a decoder that later grows a field cannot smuggle it across
            // IPC. The decode stays fail-closed upstream: a missing or non-number reading drops the
            // whole line without emitting.
            //
            // TWO OF THE THREE DECODED FIELDS CROSS. `estimated_tokens_delta` is deliberately left
            // behind: nothing consumes it (#1314 shows the total alone), and the wire's own contract
            // says the deltas received do not sum to the turn's total, so an arm carrying one would
            // invite exactly the accumulation it forbids. NO `daemonTs` either — the decode arm takes
            // no FrameTimestamp, because a stored `thinking_progress` is still skipped and there is
            // no served-page half for a (type, ts) key to join against; `model-announced` directly
            // above, not `api-retry`, is the precedent for this literal's shape.
            //
            // `conversation_id` crosses as `conversationId`: a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg — all four exhaustive bridges no-op
            // the arm until #1314. It reaches no log either, here or upstream: emitDaemonEvent is
            // log-free by construction and the decode's log line is content-free, which matters for
            // the reading beside it as much as for the id — how much claude thought is a side-channel
            // on private work.
            //
            // DELIBERATELY STATELESS: no dedup, no coalescing, no timer, no last-value memo, and none
            // keyed by the id either. The temptation is sharper here than on any neighbour, because
            // the frames arrive in a climbing run that LOOKS like it wants smoothing — and the two
            // obvious rules would both be wrong. Suppressing a repeat starves #1314 of the re-fire
            // that says the reading is current; filtering a reading that dropped eats ordinary
            // traffic, since `estimated_tokens` restarts near zero at every inference-request
            // boundary, four times inside the daemon's own committed single-turn capture. A rate
            // limit on a flooding daemon would be the only mutable state on this leg, keyed by a
            // daemon-supplied id and fed by a daemon-supplied stream; the render loop is where that
            // belongs, if anywhere. Not compile-forced (this inner switch has no assertNever) — the
            // round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'thinkingProgress',
              estimatedTokens: inbound.thinkingProgress.estimated_tokens,
              conversationId: inbound.thinkingProgress.conversation_id
            })
            return
          case 'rate-limited':
            // The usage-limit data path (#1319, decoded at #1318). Emit a fresh literal carrying the
            // routing key, both readings and the reset instant, copied BY NAME from the
            // already-decoded, already-validated payload — never a spread of inbound.rateLimited (the
            // assistant-delta idiom), so a decoder that later grows a field cannot smuggle it across
            // IPC. The decode stays fail-closed upstream: a missing or mistyped field drops the whole
            // frame without emitting.
            //
            // FOUR OF THE FIVE DECODED FIELDS CROSS. `truncated_fields` is deliberately left behind:
            // nothing consumes it, because the eventual surface renders no daemon-authored string at
            // all — it selects client-owned copy by `status` / `limit_type` and falls back to generic
            // wording — so a cut value misses that lookup exactly as an unrecognised one does and
            // there is nothing on screen for a truncation marker to qualify. NO `daemonTs` either —
            // the decode arm takes no FrameTimestamp, because a stored `rate_limited` is still skipped
            // and there is no served-page half for a (type, ts) key to join against; the
            // `thinking-progress` arm directly above, not `api-retry`, is the precedent for this
            // literal's shape.
            //
            // NEITHER STRING IS NARROWED HERE. `status` and `limit_type` cross VERBATIM: no
            // allow-list, no normalising, no lowercasing, no rejection of the benign value. The daemon
            // left both sets open because the value set beyond the one measured-benign status is
            // UNMEASURED, so anything narrower on this boundary would re-introduce exactly the drop
            // #1318's decoder avoids on the wire — and would drop the first real limit that fires.
            // `resets_at` crosses unpoliced for the same reason in the other direction: `0` means
            // claude did not report an instant and is not the epoch, so a truthiness test here would
            // read it as an absence. Nothing on this leg SCHEDULES from it, and nothing downstream may
            // either; that prohibition rides the arm's contract forward.
            //
            // `conversation_id` crosses as `conversationId`: a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg — all four exhaustive bridges no-op
            // the arm until #1320. Nothing decoded reaches a log either, here or upstream:
            // emitDaemonEvent is log-free by construction and the decode's log line is content-free,
            // which matters for the two strings beside the id as much as for the id — they are
            // unsanitized claude-authored text, and together they disclose the account's quota
            // posture.
            //
            // DELIBERATELY STATELESS: no dedup, no coalescing, no timer, no last-value memo, and none
            // keyed by the id either. The daemon re-reports the window once per run whatever its
            // state, so suppressing a repeat would starve the consumer of the report that says the
            // reading is still current; and a rate limit on a flooding daemon would be the only
            // mutable state on this leg, keyed by a daemon-supplied id and fed by a daemon-supplied
            // stream. Not compile-forced (this inner switch has no assertNever) — the round-trip test
            // guards this emit.
            emitDaemonEvent(sink, {
              type: 'rateLimited',
              conversationId: inbound.rateLimited.conversation_id,
              status: inbound.rateLimited.status,
              limitType: inbound.rateLimited.limit_type,
              resetsAt: inbound.rateLimited.resets_at
            })
            return
          case 'attachment-offered':
            // The assistant-sent-file data path (#1620, decoded at #1619). A fresh literal copied BY
            // NAME from the already-validated payload, never a spread, so a decoder that later grows a
            // field cannot smuggle it across IPC. All three fields cross; no `daemonTs`, because the
            // frame is live-only. Nothing here logs: the filename is claude-authored and the id pair
            // correlates a conversation. Stateless — one event per frame, no dedup. Not compile-forced
            // (this inner switch has no assertNever); the round-trip test guards this emit.
            emitDaemonEvent(sink, {
              type: 'attachmentOffered',
              conversationId: inbound.attachmentOffered.conversation_id,
              attachmentId: inbound.attachmentOffered.attachment_id,
              filename: inbound.attachmentOffered.filename
            })
            return
          case 'resetting':
            invalidateConfigRequests(inbound.resetting.conversation_id)
            // The session-reset data path (#1515, decoded at #1514). Emit a fresh literal carrying
            // the routing key, the edge and both closed-set tokens, copied BY NAME from the
            // already-decoded, already-validated payload — never a spread of inbound.resetting (the
            // assistant-delta idiom), so a decoder that later grows a field cannot smuggle it across
            // IPC. The decode stays fail-closed upstream: a missing or mistyped field, or a token
            // outside its closed set, drops the whole frame without emitting.
            //
            // ALL FOUR DECODED FIELDS CROSS — unlike `rate-limited` directly above, there is nothing
            // to leave behind: this frame carries no truncation marker and every field has a consumer
            // in #1516 / #1517. NO `daemonTs` — the decode arm takes no FrameTimestamp, because a
            // stored `resetting` is SKIPPED rather than served and there is no served-page half for a
            // (type, ts) key to join against; the `rate-limited` arm directly above, not `compacting`,
            // is the precedent for this literal's shape. The union's timestamp is optional on every
            // arm, so nothing but the round-trip test catches a stray stamp here.
            //
            // BOTH EMPTY STRINGS CROSS INTACT on the falling edge: `''` is the daemon's declared zero
            // value, written on every frame because nothing upstream is `omitempty`, and a member of
            // both closed sets. No truthiness test, no `|| undefined`, no dropping the key — the
            // window gates on `active`, and a consumer that saw a missing key could not tell a
            // falling edge from a malformed one. NEITHER TOKEN IS WIDENED OR NORMALISED either: they
            // cross as the closed sets #1514 established, and nothing here re-validates what the
            // decode already narrowed.
            //
            // `conversation_id` crosses as `conversationId`: a daemon-asserted routing key, not
            // rendered text, and it reaches no sink on this leg — all four exhaustive bridges no-op
            // the arm until #1516 and #1517. Nothing decoded reaches a log either, here or upstream:
            // emitDaemonEvent is log-free by construction and the decode's log line is content-free,
            // which matters for the pair beside the id as much as for the id — together they disclose
            // which conversation the operator reset and whether a handoff note was written.
            //
            // Invalidate read correlation without suppressing any reset phase event.
            emitDaemonEvent(sink, {
              type: 'resetting',
              conversationId: inbound.resetting.conversation_id,
              active: inbound.resetting.active,
              phase: inbound.resetting.phase,
              handoff: inbound.resetting.handoff
            })
            return
          case 'context-usage':
            // The context-window data path (#1419, decoded across #1454 / #1455 / #1459 / #1460).
            // Emit a fresh ELEVEN-property literal carrying the routing key, the model, the three
            // reading integers, the three inventories and the three dropped counts — each copied BY
            // NAME from the already-decoded, already-validated payload, never a spread of
            // inbound.contextUsage (the assistant-delta idiom), so a decoder that later grows a field
            // cannot smuggle it across IPC. The decode stays fail-closed upstream: a missing or
            // mistyped field — at the top level OR inside a single row of one inventory — drops the
            // whole frame without emitting.
            //
            // ALL ELEVEN CROSS. Unlike `rate-limited` directly above, nothing is left behind: this
            // frame carries no truncation marker to drop and every field has a consumer in #1420 /
            // #1421. Top-level keys are snake→camel; THE THREE ARRAYS PASS THROUGH BY REFERENCE,
            // UNMAPPED, with their row types' snake_case fields intact (`server_name` inside its row)
            // — the `queued` / `tasks` precedent two arms down, and the settled house rule for nested
            // arrays. That is safe HERE for a reason that belongs to the decoder rather than to this
            // emit: parseContextUsageCategory, parseContextUsageMCPTool and parseContextUsageMemoryFile
            // each return a FRESH two- or three-field literal built from named requireString /
            // requireNumber reads, so no reference to the JSON.parse result survives into any array,
            // there is nothing left to strip, and a key planted INSIDE a row cannot ride across. Were
            // any of those to return its input record instead, this emit would have to re-map each
            // row; the round-trip test pins the property from this side so a future decoder change
            // that broke it reddens here, where the value actually crosses the boundary.
            //
            // NOTHING IS NARROWED HERE. `model`, every row label, every `server_name`, every `path`
            // and every `type` cross VERBATIM: no allow-list, no normalising, no lowercasing. `type`
            // in particular stays an open string — a client-side closed set would fail-close a valid
            // future frame, the drift risk CLAUDE.md / ADR 0002 rank above cosmetic robustness. The
            // six integers cross unpoliced in both directions: `0` is claude's reading of zero rather
            // than an absence, and an empty inventory is the POSITIVE statement that claude reported
            // no rows — so a truthiness test anywhere on this leg would read ordinary traffic as
            // missing. Nothing here ALLOCATES, ITERATES OR SIZES anything from any integer, and a
            // dropped count especially is a count of rows that are NOT PRESENT; that prohibition rides
            // the arm's contract forward.
            //
            // NO `daemonTs` — the decode arm takes no FrameTimestamp, because a stored context_usage
            // has no served-page half for a (type, ts) key to join against; the `rate-limited` arm
            // directly above, not `api-retry`, is the precedent for this literal's shape.
            //
            // `conversation_id` crosses as `conversationId`: a daemon-asserted routing key, not
            // rendered text, and its membership in any known-conversation set is deliberately NOT
            // checked here — whether a reading for a conversation this window does not host is kept is
            // #1420's call, and a frame filtered here would make that call unmakeable. It reaches no
            // sink on this leg: all four exhaustive bridges no-op the arm until #1420.
            //
            // NOTHING DECODED REACHES A LOG, here or upstream — emitDaemonEvent is log-free by
            // construction and the decode's line is content-free. The grounds escalate across this
            // frame: the integers disclose how much private work is in the window, each per-row figure
            // how it is COMPOSED, a `server_name` what the operator WIRED UP, and a `path` WHO THE USER
            // IS AND WHERE THEY WORK. It is an INTEGRITY rule too, this stream being line-delimited
            // JSON: the committed MCP fixture's embedded newline and the newline a POSIX path may
            // legitimately contain could each forge a record.
            //
            // DELIBERATELY STATELESS: no dedup, no coalescing, no timer, no last-value memo, and none
            // keyed by the id either. The daemon fans this out after EVERY turn end, so consecutive
            // frames legitimately repeat and legitimately FALL — a window shrinks at a `/clear` or a
            // compaction. Suppressing a repeat would starve the consumer of the report that says the
            // reading is current; filtering a fall would eat ordinary traffic, the thinking_progress
            // mistake two arms up. A rate limit on a flooding daemon would be the only mutable state
            // on this leg, keyed by a daemon-supplied id and fed by a daemon-supplied stream. Not
            // compile-forced (this inner switch has no assertNever) — the round-trip test guards this
            // emit.
            emitDaemonEvent(sink, {
              type: 'contextUsage',
              conversationId: inbound.contextUsage.conversation_id,
              model: inbound.contextUsage.model,
              totalTokens: inbound.contextUsage.total_tokens,
              maxTokens: inbound.contextUsage.max_tokens,
              percentage: inbound.contextUsage.percentage,
              categories: inbound.contextUsage.categories,
              droppedCategories: inbound.contextUsage.dropped_categories,
              mcpTools: inbound.contextUsage.mcp_tools,
              droppedMcpTools: inbound.contextUsage.dropped_mcp_tools,
              memoryFiles: inbound.contextUsage.memory_files,
              droppedMemoryFiles: inbound.contextUsage.dropped_memory_files
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
            // The background-task change data path (#565) — the twin of the arm above. A fresh literal
            // carrying all SIX fields (no toolCallId / description / taskType on this frame; `status` /
            // `summary` added by #1560), copied BY NAME from the already-decoded, already-validated
            // payload — never a spread of inbound.backgroundTaskUpdated, so a decoder that later grows a
            // field cannot smuggle it across IPC. snake→camel throughout; `truncatedFields` passes the
            // narrowed array by reference and its `null` is preserved, never coerced to []. `patch`
            // crosses byte-for-byte: it is an opaque blob the daemon may have truncated mid-token, so
            // nothing here parses, normalizes, or re-serializes it. `status` and `summary` cross verbatim
            // too, `''` included (a mid-life frame, or a daemon predating them): nothing here branches on
            // `status` — deciding what a finish means is the renderer consumer's (#1561).
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
              status: inbound.backgroundTaskUpdated.status,
              summary: inbound.backgroundTaskUpdated.summary,
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
          case 'background-task-progress':
            // The background-task progress data path (#1638). A fresh literal copied BY NAME from the
            // already-decoded payload — never a spread, so a decoder that later grows a field cannot
            // smuggle it across IPC. The wire `description` crosses as `currentActivity`, so it can
            // never be joined with the opening description `backgroundTaskStarted` carries. The
            // counters cross as received: nothing here accumulates, diffs or bounds them. Stateless for
            // the siblings' reasons; #1640 joins on task_id. Not compile-forced (this inner switch has no
            // assertNever) — the stream test guards this emit.
            emitDaemonEvent(sink, {
              type: 'backgroundTaskProgress',
              conversationId: inbound.backgroundTaskProgress.conversation_id,
              taskId: inbound.backgroundTaskProgress.task_id,
              currentActivity: inbound.backgroundTaskProgress.description,
              subagentType: inbound.backgroundTaskProgress.subagent_type,
              lastToolName: inbound.backgroundTaskProgress.last_tool_name,
              totalTokens: inbound.backgroundTaskProgress.total_tokens,
              toolUses: inbound.backgroundTaskProgress.tool_uses,
              durationMs: inbound.backgroundTaskProgress.duration_ms,
              truncatedFields: inbound.backgroundTaskProgress.truncated_fields
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
              truncated: inbound.unrecognized.truncated,
              daemonTs: inbound.ts
            })
            return
          case 'session-transition':
            invalidateConfigRequests(inbound.sessionTransition.conversation_id)
            // The session-boundary data path (#254, widened #285, attributed #1192). Emit a fresh literal
            // carrying the marker's routing key plus the four fields the delimiter slice (#286) reads —
            // `conversationId`, `newSessionId`, `reason`, `occurredAt`, `workspaceCwd` — copied by name
            // from the already-decoded, already-validated payload (so a malformed marker still fails
            // closed upstream in parseSessionTransitionPayload, before this runs; since #1192 that
            // includes a marker with no `conversation_id`, which is dropped at the decode with no event
            // emitted and the connection left up). Only `previous_session_id` is DROPPED — it has no
            // consumer. Never a spread of the decoded payload (the assistant-delta idiom), so only the
            // five named fields cross IPC and a decoder that ever grew an extra field cannot smuggle it
            // across. `workspace_cwd` is `string | null` and carried through unchanged — the null is
            // preserved, not coerced. A session_id is a routing id, not a secret (the conversation_id
            // convention).
            //
            // EVERY marker is forwarded, including one naming a conversation the operator is not looking
            // at. The attribution gate is the RENDERER's (`subscribeSessionId`), deliberately: the
            // correlation index below learns `newSessionId → serverId` off this same event, and dropping
            // a marker here would blind it — reintroducing the refuses-with-no-frame bug its header
            // documents. Main routes; the window decides what to hold.
            emitDaemonEvent(sink, {
              type: 'sessionTransition',
              conversationId: inbound.sessionTransition.conversation_id,
              newSessionId: inbound.sessionTransition.new_session_id,
              reason: inbound.sessionTransition.reason,
              occurredAt: inbound.sessionTransition.occurred_at,
              workspaceCwd: inbound.sessionTransition.workspace_cwd,
              daemonTs: inbound.ts
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
              parentToolUseId: inbound.toolUse.parent_tool_use_id,
              name: inbound.toolUse.name,
              inputSummary: inbound.toolUse.input_summary,
              input: inbound.toolUse.input,
              daemonTs: inbound.ts
            })
            return
          case 'model-refusal-fallback': {
            const p = inbound.refusal
            emitDaemonEvent(sink, {
              type: 'modelRefusalFallback',
              conversationId: p.conversation_id,
              originalModel: p.original_model,
              fallbackModel: p.fallback_model,
              scope: p.scope,
              refusalCategory: p.refusal_category,
              banner: p.banner,
              truncatedFields: p.truncated_fields,
              droppedFields: p.dropped_fields,
              daemonTs: inbound.ts
            })
            return
          }
          case 'model-refusal-no-fallback': {
            const p = inbound.refusal
            emitDaemonEvent(sink, {
              type: 'modelRefusalNoFallback',
              conversationId: p.conversation_id,
              originalModel: p.original_model,
              refusalCategory: p.refusal_category,
              banner: p.banner,
              truncatedFields: p.truncated_fields,
              droppedFields: p.dropped_fields,
              daemonTs: inbound.ts
            })
            return
          }
          case 'tool-denied': {
            const p = inbound.toolDenied
            emitDaemonEvent(sink, {
              type: 'toolDenied',
              conversationId: p.conversation_id,
              turnId: p.turn_id,
              toolUseId: p.tool_use_id,
              toolName: p.tool_name,
              decisionReasonType: p.decision_reason_type,
              decisionReason: p.decision_reason,
              message: p.message,
              truncatedFields: p.truncated_fields,
              droppedFields: p.dropped_fields,
              daemonTs: inbound.ts
            })
            return
          }
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
              parentToolUseId: inbound.toolResult.parent_tool_use_id,
              isError: inbound.toolResult.is_error,
              resultSummary: inbound.toolResult.result_summary,
              resultDetail: inbound.toolResult.result_detail,
              daemonTs: inbound.ts
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
            deps.diagnosticLog?.event({ event: 'conversation-create-confirmed' })
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
          case 'workspace-updated': {
            // Refresh every broadcast before independently settling an identified rename.
            emitDaemonEvent(sink, {
              type: 'workspaceUpdated',
              path: inbound.workspaceUpdated.path,
              label: inbound.workspaceUpdated.label
            })
            const inReplyTo = inbound.inReplyTo
            const attemptId = inReplyTo === undefined ? undefined : pendingWorkspaceRenames.get(inReplyTo)
            if (inReplyTo !== undefined && attemptId !== undefined) {
              pendingWorkspaceRenames.delete(inReplyTo)
              workspaceRenameResult(attemptId, 'confirmed')
            }
            return
          }
          case 'conversation-updated': {
            // The conversation-updated data path (#273). Emitted UNCONDITIONALLY on decode, first and
            // before any correlation below — the record is a list-refresh trigger for every consumer
            // that sees it, and the requester's own writes must refresh their own row like anyone
            // else's. Verbatim passthrough (the `conversation-created` precedent):
            // parseConversationUpdatedPayload already returned a fresh 5-field object with nothing to
            // drop (no secret field), so the reference passes through — no re-construction. Field
            // names stay snake_case (the event reuses the wire type). The list-reflect slice (#275),
            // not the session store, reconciles the row. `name` / `cwd` are untrusted display text.
            emitDaemonEvent(sink, {
              type: 'conversationUpdated',
              conversation: inbound.conversationUpdated
            })
            // The set_system_prompt WRITE ack (#1249) — a SECOND reading of the same frame, ADDITIVE
            // to the emit above and never a gate on it. This is the file's first correlation of this
            // record, and the shape is deliberately NOT the `daemon-error` tier's: that tier consumes
            // a matched frame entirely and returns early, which is right there because an error has
            // exactly one meaning, and would be wrong here because it would stop the requester's own
            // write from refreshing their conversation row. A confirmation is produced IN ADDITION TO
            // the broadcast, not instead of it.
            //
            // Fail-closed on the correlation: an absent in_reply_to short-circuits BEFORE the lookup —
            // the ordinary case, since the daemon also pushes this record genuinely unsolicited when a
            // host-side `pyry channel new` mints a conversation — and a record matching no outstanding
            // write (a stale ack from a connection whose ids were cleared, a duplicate of one already
            // settled, or a hostile daemon forging an ack for a write this client never sent) produces
            // no outcome at all. Both branches are SILENT: the only values a diagnostic could carry
            // are the conversation id and the wire routing id, and neither may reach a sink.
            //
            // THE EMITTED conversationId IS THE MAP'S VALUE, NEVER `inbound.conversationUpdated.id`.
            // Unlike the read half's reply, this record DOES name a conversation — which makes the
            // wrong choice available and typecheck cleanly. A daemon answering write A with a record
            // naming conversation B would report the write as landing on B; reading the map instead
            // makes the outcome name the conversation this client actually wrote to, and turns that
            // case into a lost confirmation rather than a false one. The numeric in_reply_to it was
            // resolved from is NOT placed on the event.
            //
            // The confirmation carries NOTHING ELSE, deliberately: the record does not carry the
            // prompt back (it is broadcast-shaped daemon-side, and only the requester asked about the
            // value), so there is nothing here to report about what the conversation now holds. That
            // is the read path's answer.
            const inReplyTo = inbound.inReplyTo
            if (inReplyTo === undefined) return
            // The set_conversation_muted ack (#1595), the same additive reading: the emit above has
            // already refreshed the list, and a match settles only the write this client recorded.
            const muteAttempt = pendingMuteWrites.get(inReplyTo)
            if (muteAttempt !== undefined) {
              pendingMuteWrites.delete(inReplyTo)
              conversationMuteResult(muteAttempt, 'confirmed')
              return
            }
            const written = pendingSystemPromptWrites.get(inReplyTo)
            if (written === undefined) return
            pendingSystemPromptWrites.delete(inReplyTo)
            emitDaemonEvent(sink, {
              type: 'systemPromptWriteConfirmed',
              conversationId: written
            })
            return
          }
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
            deps.diagnosticLog?.event({ event: 'modal-shown' })
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
              defaultOptionId: inbound.modalShown.default_option_id,
              // Presence survives IPC: an omitted field must not become an own undefined property.
              ...('reason' in inbound.modalShown ? { reason: inbound.modalShown.reason } : {}),
              ...('reason_type' in inbound.modalShown ? { reasonType: inbound.modalShown.reason_type } : {}),
              ...('blocked_path' in inbound.modalShown ? { blockedPath: inbound.modalShown.blocked_path } : {}),
              ...('description' in inbound.modalShown ? { description: inbound.modalShown.description } : {}),
              ...('default_to_no' in inbound.modalShown ? { defaultToNo: inbound.modalShown.default_to_no } : {}),
              ...('always_allow' in inbound.modalShown ? { alwaysAllow: inbound.modalShown.always_allow } : {})
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
            deps.diagnosticLog?.event({ event: 'modal-dismissed' })
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
          case 'attachment-chunk': {
            // The retrieval leg's byte stream (#996). Routed by Envelope.in_reply_to — the request
            // this frame answers — where its upload-leg neighbour above routes on a payload field.
            // The asymmetry is the daemon's: an `attachment_stored` names whichever chunk closed the
            // set, which no sender can predict, while a retrieval chunk names the ask, which the
            // sender chose. #998 makes `inReplyTo` REQUIRED on this kind for exactly that reason.
            //
            // The payload `attachment_id` is checked too, one layer down: the reassembler refuses a
            // chunk naming a different transfer. The two are NOT redundant — the failure only the
            // payload id catches is the host answering the right ask with the wrong bytes.
            //
            // A frame matching no live retrieval is DROPPED: no event, no log, no throw. That covers
            // a stale answer, a frame arriving after its retrieval already settled, and a daemon
            // naming a request this client never sent.
            const retrieval = pendingRetrievals.get(inbound.inReplyTo)
            if (retrieval === undefined) return
            // Re-arm BEFORE feeding the chunk in: `chunk()` may settle synchronously (the completing
            // index, or a refusal), and settleRetrieval clears whatever deadline is current. Arming
            // afterwards would leave a fresh timer running against a retrieval that no longer exists.
            clearTimer(retrieval.deadline)
            retrieval.deadline = armRetrievalDeadline(inbound.inReplyTo)
            retrieval.reassembler.chunk(inbound.attachmentChunk)
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
        const wasAuthenticated = authenticated
        authenticated = false
        // A retryable close is stream-fatal too (#505): the supervisor auto-re-dials into a fresh
        // session the daemon-side request does not survive. Fail first, then emit — the terminal
        // arm's order. Above the classification below, so the emitted bundle failure is identical
        // for every close code and discloses nothing about it.
        failBundleStream()
        failAttachmentTransfers()
        failAttachmentRetrievals()
        abandonHistoryRequests()
        // The relay socket dropped with a retryable close (#328). This is the single classification
        // choke point (untrusted WS close code → closed RelayLinkStatus category): 4404 is the
        // relay's "reachable, no daemon registered" close → 'daemon-absent'; every other retryable
        // code is an ordinary drop → 'offline'. The raw code is DROPPED here — only the classified
        // category crosses IPC (AC3, content-free). No log call: #127 already logs the close code
        // content-free at relayConnection.ts, and this arm carries no secret.
        const status = event.code === RELAY_NO_DAEMON_CLOSE_CODE ? 'daemon-absent' : 'offline'
        // Preserve an existing authentication error when its socket subsequently drops.
        if (wasAuthenticated) emitDaemonEvent(sink, { type: 'disconnected' })
        emitDaemonEvent(sink, { type: 'relayLinkChanged', status })
        return
      }
      case 'terminal':
        // A stream interrupted by a socket drop resolves the consumer (no hang, no lingering bytes).
        // Deterministic code, safe unconditionally: fail on a settled/absent reassembler is inert.
        failBundleStream()
        failAttachmentTransfers()
        failAttachmentRetrievals()
        abandonHistoryRequests()
        // A clean local stop() drives terminal{1000,'stopped'}; suppress it (the window is
        // tearing down on quit). Every other fatal close is an authoritative drop the user sees.
        // The supervisor's `reason` string is deliberately NOT forwarded (conservative).
        if (stopped) return
        // A 4412 with no sealed error before it (the daemon's close-only path when sealing fails)
        // still names the app-too-old reason, with no version to carry (#1613).
        if (event.code === CLIENT_UPDATE_REQUIRED_CLOSE_CODE) {
          emitFailed('update-required')
          return
        }
        emitFailed('connection-closed', `The connection to pyrybox was closed (code ${event.code}).`)
        return
      case 'error':
        // Same teardown net for a connection-level driver error mid-stream.
        failBundleStream()
        failAttachmentTransfers()
        failAttachmentRetrievals()
        abandonHistoryRequests()
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
      //
      // ONE local for the envelope id, read three times (#1176), so the id sent, the id counted and
      // the id recorded can never be three different expressions — main/index.ts's own rule for the
      // conversation id, applied to the correlation key.
      const envelopeId = nextEnvelopeId
      const bytes = buildRequestSessionSettings({ id: envelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record AFTER the send, so a build or send that throws leaves no entry under an id the next
      // request will re-mint (#1176). An absent id records `''`: it is what went on the wire, and it
      // can never equal an open conversation, so the reply it draws is dropped renderer-side rather
      // than attributed to whatever chat happens to be open. Unreachable in production —
      // requestRunConfigSnapshot refuses to send an unaddressable id and main/index.ts routes on the
      // same scalar — and fail-closed if it ever becomes reachable.
      invalidateConfigRequests(conversationId ?? '')
      pendingConfigRequests.set(envelopeId, conversationId ?? '')
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
    }
  }

  function requestModelList(conversationId: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A menu request has no consumer to fail; a request sent
    // while disconnected simply produces no reply, and nothing may block a model menu on it anyway.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestSessionSettings — no second
      // counter — so ids stay unique across interleaved calls (the daemon correlates the model_list
      // reply by in_reply_to).
      // The id is forwarded verbatim to the builder, which rebuilds a fresh literal, so no
      // renderer-supplied key reaches the wire. Never logged: the catch below drops its caught
      // object and adds no line.
      const bytes = buildRequestModelList({ id: nextEnvelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited #62).
      // NO RETRY HERE OR ANYWHERE ABOVE — a retry against a relay withholding the frame is the
      // self-inflicted spin modelListStore's header forbids.
    }
  }

  function requestContextUsage(conversationId: string): void {
    if (driver === null || !authenticated) {
      deps.diagnosticLog?.event({ event: 'context-usage-request-refused', code: 'unavailable' })
      return
    }
    try {
      const bytes = buildRequestContextUsage({ id: nextEnvelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      deps.diagnosticLog?.event({ event: 'context-usage-request-sent' })
    } catch {
      // Drop the exception and never retry: a withheld reply must not induce more requests.
      deps.diagnosticLog?.event({ event: 'context-usage-request-failed', code: 'build-or-send-failed' })
    }
  }

  function requestMcpStatus(conversationId: string): void {
    if (driver === null || !authenticated) {
      deps.diagnosticLog?.event({ event: 'mcp-status-request-refused', code: 'unavailable' })
      return
    }
    try {
      const envelopeId = nextEnvelopeId
      const bytes = buildRequestMcpStatus({ id: envelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      // Record after the send, so a throwing build or send leaves no entry to correlate.
      if (pendingMcpStatusRequests.size >= MAX_PENDING_MCP_STATUS_REQUESTS) {
        const oldest = pendingMcpStatusRequests.keys().next()
        if (oldest.done !== true) pendingMcpStatusRequests.delete(oldest.value)
      }
      pendingMcpStatusRequests.set(envelopeId, conversationId)
      deps.diagnosticLog?.event({ event: 'mcp-status-request-sent' })
    } catch {
      // Drop the exception and never retry: a withheld or refused reply must not induce more requests.
      deps.diagnosticLog?.event({ event: 'mcp-status-request-failed', code: 'build-or-send-failed' })
    }
  }

  function reconnectMcpServer(conversationId: string, serverName: string): void {
    if (driver === null || !authenticated) {
      deps.diagnosticLog?.event({ event: 'mcp-reconnect-refused', code: 'unavailable' })
      return
    }
    try {
      const envelopeId = nextEnvelopeId
      const bytes = buildMcpReconnect({ id: envelopeId, ts: now(), conversationId, serverName })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      // Record after the send, so a throwing build or send leaves no entry to correlate.
      if (pendingMcpReconnects.size >= MAX_PENDING_MCP_RECONNECTS) {
        const oldest = pendingMcpReconnects.keys().next()
        if (oldest.done !== true) pendingMcpReconnects.delete(oldest.value)
      }
      pendingMcpReconnects.set(envelopeId, conversationId)
      deps.diagnosticLog?.event({ event: 'mcp-reconnect-sent' })
    } catch {
      // Drop the exception and never retry: every refusal is final, and a failed send must not become a loop.
      deps.diagnosticLog?.event({ event: 'mcp-reconnect-failed', code: 'build-or-send-failed' })
    }
  }

  function toggleMcpServer(conversationId: string, serverName: string, enabled: boolean): void {
    if (driver === null || !authenticated) {
      deps.diagnosticLog?.event({ event: 'mcp-toggle-refused', code: 'unavailable' })
      return
    }
    try {
      const envelopeId = nextEnvelopeId
      const bytes = buildMcpToggle({ id: envelopeId, ts: now(), conversationId, serverName, enabled })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      // Record after the send, so a throwing build or send leaves no entry to correlate.
      if (pendingMcpToggles.size >= MAX_PENDING_MCP_TOGGLES) {
        const oldest = pendingMcpToggles.keys().next()
        if (oldest.done !== true) pendingMcpToggles.delete(oldest.value)
      }
      pendingMcpToggles.set(envelopeId, conversationId)
      deps.diagnosticLog?.event({ event: 'mcp-toggle-sent' })
    } catch {
      // Drop the exception and never retry: every refusal is final, and a failed send must not become a loop.
      deps.diagnosticLog?.event({ event: 'mcp-toggle-failed', code: 'build-or-send-failed' })
    }
  }

  function failHistoryRequest(conversationId: string, code: string): void {
    deps.diagnosticLog?.event({ event: 'history-request-failed', code })
    emitDaemonEvent(sink, { type: 'historyRequestFailed', conversationId,
      reason: 'unclassified', retryable: true })
  }

  function abandonHistoryRequests(): void {
    const pending = [...pendingHistoryRequests.values()]
    pendingHistoryRequests.clear()
    for (const conversationId of pending) failHistoryRequest(conversationId, 'interrupted')
  }

  function requestHistory(payload: RequestHistoryPayload): void {
    if (driver === null || !authenticated) {
      failHistoryRequest(payload.conversation_id, 'unavailable')
      return
    }
    if ([...pendingHistoryRequests.values()].includes(payload.conversation_id)) return
    try {
      const envelopeId = nextEnvelopeId
      const bytes = buildRequestHistory({ id: envelopeId, ts: now(),
        conversationId: payload.conversation_id, cursor: payload.cursor, limit: payload.limit })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      pendingHistoryRequests.set(envelopeId, payload.conversation_id)
      deps.diagnosticLog?.event({ event: 'history-request-sent' })
    } catch {
      failHistoryRequest(payload.conversation_id, 'build-or-send-failed')
    }
  }

  function requestSystemPrompt(conversationId: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A prompt read has no consumer to fail; a request sent while
    // disconnected simply produces no reply, and nothing may block on this frame anyway.
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestSessionSettings — no second counter
      // — so ids stay unique across interleaved calls, which is what makes them usable as the
      // correlation key below (the daemon correlates the system_prompt reply by in_reply_to).
      //
      // ONE local for the envelope id, read three times (the #1176 rule), so the id sent, the id
      // counted and the id recorded can never be three different expressions. The conversation id is
      // forwarded verbatim to the builder, which rebuilds a fresh literal, so no renderer-supplied key
      // reaches the wire. Nothing is logged — not the id, and the catch below drops its caught object
      // without adding a line.
      const envelopeId = nextEnvelopeId
      const bytes = buildRequestSystemPrompt({ id: envelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record AFTER the send, so a build or send that throws leaves no entry under an id the next
      // request will re-mint. The value is the conversation this app named, held here and handed back
      // when the reply lands — the reply itself names none, deliberately, so this is where that fact
      // lives and the only place it can live.
      pendingSystemPromptRequests.set(envelopeId, conversationId)
    } catch {
      // Never throw out of the module (parity #490): the fixed-shape envelope cannot over-cap, but
      // driver.sendMessage can throw. The caught object is DROPPED (classify-don't-forward, inherited
      // #62). NO RETRY, here or anywhere on this verb: it has no error frame, so a missing reply is
      // indistinguishable from a slow one, and a retry against a relay withholding the frame is the
      // self-inflicted spin requestModelList's catch forbids.
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
    // A driver can exist before authentication or after its socket has dropped.
    if (driver === null || !authenticated || stopped) {
      deps.diagnosticLog?.event({ event: 'conversation-create-failed', code: 'unavailable' })
      emitDaemonEvent(sink, { type: 'conversationCreateRejected' })
      return
    }
    // Capture the id BEFORE the build increments it, so the pending entry is keyed by this request's
    // envelope id — the value the daemon echoes as in_reply_to on the rejecting error (#1307). The
    // createWorkspaceFolder shape; this function named no id before it had a rejection to correlate.
    const envelopeId = nextEnvelopeId
    try {
      // Build a FRESH literal naming exactly the three modeled fields — never a spread of `payload`.
      // This is the deterministic net that bounds the wire to exactly is_promoted / name / cwd,
      // ignoring any renderer-smuggled extra field the structural-minimum guard let through (#236's
      // fresh-literal posture). Shares the one monotonic nextEnvelopeId with send / requestConversations —
      // no second counter — so ids stay unique across interleaved calls. The optional agent / model /
      // effort (#1652) are copied in only when present, so a create without them stays byte-identical.
      const bytes = buildCreateConversation({
        id: envelopeId,
        ts: now(),
        payload: {
          is_promoted: payload.is_promoted,
          name: payload.name,
          cwd: payload.cwd,
          ...(payload.agent === undefined ? {} : { agent: payload.agent }),
          ...(payload.model === undefined ? {} : { model: payload.model }),
          ...(payload.effort === undefined ? {} : { effort: payload.effort })
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record the pending request AFTER a successful send (the createWorkspaceFolder order, #396): a
      // build/send throw skips this (caught below), so no phantom entry is left under an id the next
      // outbound envelope re-mints — one that would swallow THAT envelope's reject. Removed by the
      // correlated error in onDriverEvent, or abandoned on the next dial().
      pendingCreateConversations.add(envelopeId)
      deps.diagnosticLog?.event({ event: 'conversation-create-sent' })
    } catch {
      // Drop the caught object: it may contain folder text or transport secrets.
      deps.diagnosticLog?.event({ event: 'conversation-create-failed', code: 'build-or-send-failed' })
      emitDaemonEvent(sink, { type: 'conversationCreateRejected' })
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

  function interrupt(conversationId: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). An interrupt has no consumer to fail and is
    // fire-and-forget; a frame sent while disconnected simply stops nothing (no session, no reply).
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / newSession — no second counter — so ids
      // stay unique across interleaved calls, though nothing correlates a reply to this one: the
      // daemon never answers this frame.
      // The id is forwarded verbatim to the builder, which rebuilds a fresh literal, so no
      // renderer-supplied key reaches the wire. Never logged: the catch below drops its caught object
      // and adds no line, and the routing refusal one layer up logs a static code with no id in it.
      const bytes = buildInterrupt({ id: nextEnvelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the conversation id;
      // no log, no event (classify-don't-forward, inherited #62). #1092 REPLACED the old rationale
      // here ("nothing sensitive on this bare path"), which stopped being true the moment the frame
      // started naming a conversation. NO RETRY: a resend is a second interrupt rather than a second
      // attempt at the first — benign on this verb, but uniform with newSession beside it.
    }
  }

  function newSession(conversationId: string): void {
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). A restart request has no consumer to fail and is
    // fire-and-forget; a frame sent while disconnected simply restarts nothing (no session, no reply).
    if (driver === null) return
    try {
      // Shares the one monotonic nextEnvelopeId with send / interrupt — no second counter — so ids
      // stay unique across interleaved calls, though nothing correlates a reply to this one: the
      // daemon never answers this frame.
      // The id is forwarded verbatim to the builder, which rebuilds a fresh literal, so no
      // renderer-supplied key reaches the wire. Never logged: the catch below drops its caught object
      // and adds no line, and the routing refusal one layer up logs a static code with no id in it.
      const bytes = buildNewSession({ id: nextEnvelopeId, ts: now(), conversationId })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. The caught object is DROPPED — its message could echo the conversation id;
      // no log, no event (classify-don't-forward, inherited #62). NO RETRY: a restart is destructive
      // and unacknowledged, so a resend is a second kill rather than a second attempt at the first.
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

  function workspaceRenameResult(attemptId: string, outcome: 'confirmed' | 'rejected'): void {
    deps.diagnosticLog?.event({ event: 'workspace-rename-result', code: outcome })
    emitDaemonEvent(sink, { type: 'workspaceRenameResult', attemptId, outcome })
  }

  function renameWorkspace(payload: RenameWorkspacePayload, attemptId?: string): void {
    if (driver === null) {
      if (attemptId !== undefined) workspaceRenameResult(attemptId, 'rejected')
      return
    }
    try {
      const envelopeId = nextEnvelopeId
      // Keep renderer correlation and routing off the wire, and preserve the explicit null clear.
      const bytes = buildRenameWorkspace({
        id: envelopeId, ts: now(), payload: { path: payload.path, label: payload.label }
      })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      if (attemptId !== undefined) pendingWorkspaceRenames.set(envelopeId, attemptId)
      deps.diagnosticLog?.event({ event: 'workspace-rename-sent' })
    } catch {
      deps.diagnosticLog?.event({ event: 'workspace-rename-failed', code: 'local-send' })
      if (attemptId !== undefined) workspaceRenameResult(attemptId, 'rejected')
    }
  }

  function conversationMuteResult(attemptId: string, outcome: 'confirmed' | 'rejected'): void {
    deps.diagnosticLog?.event({ event: 'conversation-mute-result', code: outcome })
    emitDaemonEvent(sink, { type: 'conversationMuteResult', attemptId, outcome })
  }

  function setConversationMuted(payload: SetConversationMutedPayload, attemptId: string): void {
    if (driver === null) {
      conversationMuteResult(attemptId, 'rejected')
      return
    }
    try {
      const envelopeId = nextEnvelopeId
      // A fresh literal naming exactly the two modeled fields, never a spread of the caller's object.
      const bytes = buildSetConversationMuted({
        id: envelopeId, ts: now(), payload: { conversation_id: payload.conversation_id, muted: payload.muted }
      })
      nextEnvelopeId += 1
      driver.sendMessage(bytes)
      // Recorded after the send, so a throw leaves no entry under an id the next write re-mints.
      pendingMuteWrites.set(envelopeId, attemptId)
      deps.diagnosticLog?.event({ event: 'conversation-mute-sent' })
    } catch {
      // The caught object is dropped: its message could echo the payload.
      deps.diagnosticLog?.event({ event: 'conversation-mute-failed', code: 'local-send' })
      conversationMuteResult(attemptId, 'rejected')
    }
  }

  function setSystemPrompt(payload: SetSystemPromptPayload): void {
    // THE BYTE BOUND RUNS FIRST — before the connected guard, deliberately, and this is the one place
    // this method departs from every sibling write verb's opening line. The verdict is about the VALUE,
    // not about the link: an over-length prompt is over-length whether or not a socket is up, and the
    // daemon would answer it with a NON-RETRYABLE `protocol.malformed`. Checking connectedness first
    // would make a disconnected over-length write vanish silently, which is exactly the "thrown away"
    // refusal the ticket forbids — the operator would see nothing and retype the same text.
    //
    // MEASURED IN BYTES OF UTF-8, never in `.length`, which counts UTF-16 code units: a prompt of
    // emoji or CJK text sits well under 8192 code units at several thousand bytes over the daemon's
    // bound, so `.length` would let exactly the multi-byte cases through that this exists to stop.
    // `Buffer.byteLength` measures without copying the string, so no transient copy of the prompt is
    // made here. `null` is the clear path and carries no bytes to bound.
    //
    // NEITHER THE PROMPT NOR ITS LENGTH IS LOGGED on this branch. The refusal is an EVENT, not a
    // diagnostic — the only two facts a log line here could add are the two AC5 forbids.
    const prompt = payload.system_prompt
    if (prompt !== null && Buffer.byteLength(prompt, 'utf8') > MAX_SYSTEM_PROMPT_BYTES) {
      emitDaemonEvent(sink, {
        type: 'systemPromptWriteRejected',
        conversationId: payload.conversation_id,
        reason: 'prompt-too-long'
      })
      return
    }
    // The send twin: inert no-op when not connected (see send's guard rationale — before start(),
    // mid-bootstrap, or bootstrap-failed). NO OUTCOME on this path, and no correlation entry: a write
    // sent while disconnected never reaches a daemon, so there is nothing to settle and nothing left
    // dangling. It is deliberately not reported as a rejection — the value was never refused by
    // anyone, and reporting one would be indistinguishable from a daemon verdict.
    if (driver === null) return
    try {
      // Build a FRESH literal naming exactly the two modeled fields — never a spread of `payload`.
      // This is the deterministic net that bounds the wire to exactly conversation_id / system_prompt,
      // ignoring any renderer-smuggled extra field the structural-minimum guard let through (#236's
      // fresh-literal posture). The tri-state crosses UNTOUCHED: no `?? ''`, no `|| null`, no
      // truthiness read — any of them collapses two of the three states into one and makes the clear
      // path unreachable.
      //
      // ONE local for the envelope id, read three times (the #1176 rule), so the id sent, the id
      // counted and the id recorded can never be three different expressions. Shares the one monotonic
      // nextEnvelopeId with send / changeWorkspace — no second counter — so ids stay unique across
      // interleaved calls, which is what makes them usable as the correlation key below.
      const envelopeId = nextEnvelopeId
      const bytes = buildSetSystemPrompt({
        id: envelopeId,
        ts: now(),
        payload: {
          conversation_id: payload.conversation_id,
          system_prompt: payload.system_prompt
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record AFTER the send, so a build or send that throws leaves no entry under an id the next
      // request will re-mint. The value is the conversation this app named, held here and handed back
      // when the ack or the refusal lands — and it is the ONLY source the outcome may use, even though
      // the ack record carries an `id` of its own, because that one is the daemon's to choose.
      pendingSystemPromptWrites.set(envelopeId, payload.conversation_id)
    } catch {
      // Never throw out of the module (parity #490): an over-cap plaintext (WireEncodeError) or any
      // driver/wasm throw. Near-unreachable from both directions — the prompt is bounded above and the
      // conversation id by the routing lookup one layer up — but caught regardless. The caught object
      // is DROPPED: its message could echo the payload, INCLUDING THE PROMPT (classify-don't-forward,
      // inherited #62). No log, no event, NO RETRY. No entry was recorded, so the unspent envelope id
      // carries no stale attribution.
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
    if (driver === null) {
      deps.diagnosticLog?.event({ event: 'modal-answer-failed', code: 'unavailable' })
      return
    }
    try {
      // Mint the token into a fresh literal naming only modeled fields — never a spread
      // of `payload`. This is the deterministic net that ignores a renderer-smuggled `answer_token`:
      // the minted value always wins, and no stale ADR-025 field can leak (#235's pinned shape).
      const bytes = buildModalAnswer({
        id: nextEnvelopeId,
        ts: now(),
        payload: {
          modal_id: payload.modal_id,
          option_id: payload.option_id,
          answer_token: mintToken(),
          ...('always_allow' in payload ? { always_allow: payload.always_allow } : {})
        }
      })
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
      // Record the answered modal_id in the correlation window (#248) AFTER the send succeeds: a
      // build/send throw skips this (caught below), so no phantom outstanding answer is left for an
      // `error` that will never come back. Drained by the matching modal_dismissed (accept) or
      // dequeued by a daemon `error` (reject); reset on each dial().
      outstandingAnswers.push(payload.modal_id)
      deps.diagnosticLog?.event({ event: 'modal-answer-sent' })
    } catch {
      // Classify the failure without exposing the caught object or any request content.
      deps.diagnosticLog?.event({ event: 'modal-answer-failed', code: 'send-failed' })
    }
  }

  function cancelModal(payload: ModalCancelPayload): void {
    // The send twin: inert no-op when not connected (see send's guard rationale).
    if (driver === null) {
      deps.diagnosticLog?.event({ event: 'modal-cancel-failed', code: 'unavailable' })
      return
    }
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
      deps.diagnosticLog?.event({ event: 'modal-cancel-sent' })
    } catch {
      // Classify the failure without exposing the caught object or any request content.
      deps.diagnosticLog?.event({ event: 'modal-cancel-failed', code: 'send-failed' })
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
    // process as a closed nine-field object (#1205 made it nine), so there is no smuggled field for a
    // copy to strip.
    const bytes = buildAttachmentChunk({ id: envelopeId, ts: now(), payload })
    nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
    live.sendMessage(bytes)
    return envelopeId
  }

  async function uploadAttachment(
    input: AttachmentChunkPlanInput,
    onProgress?: AttachmentTransferProgress
  ): Promise<AttachmentTransferResult> {
    // Not connected (before start(), mid-bootstrap, bootstrap-failed): resolve terminally so #862's
    // command never hangs. requestDebugBundle's posture — send's silent no-op is wrong for a call that
    // owns an awaiting caller.
    if (driver === null) return { ok: false, outcome: 'not-connected' }
    let transfer: AttachmentTransfer
    try {
      transfer = createAttachmentTransfer(input, {
        sendChunk: sendAttachmentChunk,
        // Passed straight through, undefined and all: this hop adds no policy of its own, and the
        // transfer already refuses to report after it settles.
        onProgress,
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

  function requestAttachment(
    payload: RequestAttachmentPayload,
    consumer: AttachmentRetrievalConsumer
  ): void {
    startRetrieval(
      // A FRESH LITERAL with named fields, never the caller's object spread through: the two ids
      // originate in an untrusted renderer, so a smuggled key must not reach the envelope even though
      // the boundary guard reads only these two (createConversation's posture).
      (envelopeId) =>
        buildRequestAttachment({
          id: envelopeId,
          ts: now(),
          payload: {
            conversation_id: payload.conversation_id,
            attachment_id: payload.attachment_id
          }
        }),
      // Pinned to the id THIS CLIENT ASKED FOR, never one read back off the wire — the second half
      // of the correlation, and storeAttachment's stated precondition further down the chain.
      payload.attachment_id,
      consumer
    )
  }

  function readWorkspaceFile(
    payload: ReadWorkspaceFilePayload,
    consumer: AttachmentRetrievalConsumer
  ): void {
    startRetrieval(
      // A fresh literal, for requestAttachment's reason. The path goes to the daemon unchanged.
      (envelopeId) =>
        buildReadWorkspaceFile({
          id: envelopeId,
          ts: now(),
          payload: { conversation_id: payload.conversation_id, path: payload.path }
        }),
      // The daemon mints the transfer id, so there is none to pin in advance: the reassembler adopts
      // the first chunk's and holds the rest of the stream to it.
      null,
      consumer
    )
  }

  /**
   * The shared body of both retrieval asks: send the frame `build` produces under the next envelope
   * id, then register the pending entry the chunk and reject arms of onDriverEvent route by. The two
   * verbs differ only in the frame and in what the reassembler pins to; everything after the send is
   * one correlation machine.
   */
  function startRetrieval(
    build: (envelopeId: number) => Uint8Array,
    pinnedId: string | null,
    consumer: AttachmentRetrievalConsumer
  ): void {
    // Not connected (before start(), mid-bootstrap, bootstrap-failed): fail the consumer terminally
    // so #996's orchestrator never hangs. requestDebugBundle's posture — send's silent no-op is
    // wrong for a call that owns a waiting consumer. There is nothing accumulated to discard, so this
    // does NOT go through the reassembler, which is why AttachmentFailReason has no member for it.
    if (driver === null) {
      consumer.fail('not-connected')
      return
    }
    // Capture the id BEFORE the build increments it: this is the value the daemon echoes as
    // in_reply_to on every answering chunk AND on the reject (the createWorkspaceFolder template).
    const envelopeId = nextEnvelopeId
    try {
      // Shares the one monotonic nextEnvelopeId with send / requestDebugBundle — no second counter —
      // so ids stay unique across interleaved calls, which is what the daemon correlates replies by.
      const bytes = build(envelopeId)
      nextEnvelopeId += 1 // advance only on a successful build — a dropped over-cap send keeps the id
      driver.sendMessage(bytes)
    } catch {
      // Never throw out of the module (parity #490): an over-cap envelope (WireEncodeError, reachable
      // from a main-side caller passing an out-of-contract identifier) or a driver throw. The caught
      // object is DROPPED — its message could echo an id — and the two causes collapse to one outcome,
      // the upload leg's `send-failed`.
      //
      // SETTLING HERE, WITH NOTHING REGISTERED, is what keeps a dropped build from leaving a phantom
      // keyed to a RECYCLED id (#1003 review). The line above advances the counter only on a successful
      // build, so the next outbound envelope re-mints this id; an entry left armed under it would
      // swallow that envelope's reject — settling a healthy retrieval on a frame that answers something
      // else, and consuming a frame the bundle net and the modal FIFO below were owed. Both in-repo maps
      // keyed by envelope id, pendingSettings and pendingCreateFolders, register after the send and say
      // the same thing. This is also the honest terminal: the deadline's `timed-out` 30 s later would
      // report a stream that stopped, for a frame that never left the machine.
      consumer.fail('send-failed')
      return
    }
    // THE FRAME IS ON THE WIRE: arm now, and only now. Ordering the arm after the send cannot lose a
    // fast answer — an inbound frame reaches onDriverEvent through socket I/O, which cannot run
    // synchronously inside driver.sendMessage — and that is the reasoning both envelope-id-keyed
    // precedents already rely on. requestDebugBundle arms FIRST because its single slot is not keyed by
    // an envelope id at all, so nothing it leaves behind can be re-minted; that half of its analogy
    // does not carry here.
    const entry: PendingRetrieval = {
      reassembler: createAttachmentReassembler(pinnedId, {
        complete: (bytes) => {
          clearTimer(entry.deadline)
          pendingRetrievals.delete(envelopeId)
          consumer.complete(bytes)
        },
        // Forwarded through settleRetrieval rather than handed over as a bare method reference, and
        // that is load-bearing: `reason` is contextually an AttachmentFailReason here, so this call
        // is the COMPILE-FORCED check that AttachmentRetrievalFailure still covers the reassembler's
        // closed set (a bare `fail: consumer.fail` would not check it — AttachmentConsumer.fail is
        // declared method-style, and TypeScript checks method parameters bivariantly).
        fail: (reason) => settleRetrieval(envelopeId, entry, reason)
      }),
      consumer,
      // Armed here rather than assigned a placeholder and replaced: the deadline is a real handle
      // from the moment the entry exists, so every clearTimer site is total with no nullable field.
      deadline: armRetrievalDeadline(envelopeId)
    }
    pendingRetrievals.set(envelopeId, entry)
  }

  // The single fresh-connect path both start() and reconnect() funnel through.
  function dial(): void {
    authenticated = false
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
    // Reset the create_conversation pending set (#1307, AC1): the pendingCreateFolders rationale applied
    // to the create verb. A reconnect abandons outstanding creates, so a stale envelope id from a dead
    // session can never correlate an `error` on the reconnected one (which recycles ids from 2).
    pendingCreateConversations.clear()
    // Reset the run-config request correlation map (#1176, AC4): a reconnect abandons outstanding
    // reads, so a reply correlated against a previous connection's envelope ids can never match on the
    // reconnected one — which is what makes the recycled ids safe here too. Without it, the fresh
    // connection's first request would inherit the dead one's conversation. The pendingSettings.clear()
    // rationale, applied to the read leg.
    pendingConfigRequests.clear()
    abandonHistoryRequests()
    // Reset the system-prompt request correlation map (#1230): the pendingConfigRequests rationale
    // applied to the prompt read, and the consequence of skipping it is the worst of the three — a
    // reply inheriting a dead connection's conversation would report one conversation's stored prompt
    // as another's, which #1078 then offers the operator to edit.
    pendingSystemPromptRequests.clear()
    // Reset the system-prompt WRITE correlation map (#1249): the same rationale on the write leg, and
    // here a surviving entry would settle a NEW connection's write against a dead one's conversation —
    // reporting a prompt as stored on a conversation that was never written to.
    pendingSystemPromptWrites.clear()
    // The same rationale for the MCP status ask (#1578): a recycled id must not settle a new connection's
    // refusal against a dead one's conversation.
    pendingMcpStatusRequests.clear()
    pendingMcpReconnects.clear()
    pendingMcpToggles.clear()
    pendingWorkspaceRenames.clear()
    pendingMuteWrites.clear()
    // Abandon any in-flight bundle stream (#505), the fourth per-connection reset: its daemon-side
    // request does not survive the fresh Noise session, so the consumer is failed HERE rather than
    // via the stopped driver's terminal — `gen = ++generation` above already fenced that terminal
    // out of onDriverEvent, so #116's net would never fire and the consumer would never settle. The
    // same argument covers the transfer set and the retrieval map beside it.
    failBundleStream()
    failAttachmentTransfers()
    failAttachmentRetrievals()
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
      authenticated = false
      // Idempotent driver teardown. If the bootstrap has not yet constructed the driver, the
      // `stopped` guard above (step 7) prevents it from ever being constructed.
      driver?.stop()
    },
    send,
    requestSessionSettings,
    requestModelList,
    requestContextUsage,
    requestMcpStatus,
    reconnectMcpServer,
    toggleMcpServer,
    requestSystemPrompt,
    requestHistory,
    requestConversations,
    requestRecentWorkspaces,
    createConversation,
    createWorkspaceFolder,
    dequeueMessage,
    interrupt,
    newSession,
    promoteConversation,
    archiveConversation,
    unarchiveConversation,
    deleteConversation,
    renameConversation,
    changeWorkspace,
    renameWorkspace,
    setSystemPrompt,
    setConversationMuted,
    setSessionSettings,
    answerModal,
    cancelModal,
    answerQuestions,
    refuseQuestions,
    requestDebugBundle,
    uploadAttachment,
    requestAttachment,
    readWorkspaceFile
  }
}
