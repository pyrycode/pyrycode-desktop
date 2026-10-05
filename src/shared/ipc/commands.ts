// The typed command pipe from the renderer window to the background process: one sealed
// discriminated union, the channel it travels on, a pure constructor, and a runtime boundary
// guard. This is the command half of the background↔window bridge (#17); the event half is
// #18 (events.ts), which flows the other direction.
//
// The producer here is the UNTRUSTED renderer (unlike #18, whose producer is trusted main).
// So this module ships isRendererCommand — the runtime guard the main receiver applies at the
// renderer→main boundary. Downstream consumers (#11/transport) receive only validated commands.
//
// The payload-bearing members (sendMessage) reuse wire payload types from ../wire/types verbatim;
// the bare member (requestDebugBundle) carries no payload at all — never a token, key, or raw frame
// in any case. AC5 is enforced by construction: no member has a field that
// could hold a secret (QrPayload/HelloClientPayload tokens, InnerFrameV2 bytes are not
// referenced here), so a developer cannot serialize one onto this channel.
//
// Imported by src/main and src/preload, which have no @shared path alias — hence the
// relative import here and in those callers (see tsconfig.node.json).
import type {
  SendMessagePayload,
  ModalAnswerPayload,
  ModalCancelPayload,
  CreateConversationPayload,
  PromoteConversationPayload,
  ArchiveConversationPayload,
  UnarchiveConversationPayload,
  DeleteConversationPayload,
  RenameConversationPayload,
  ChangeWorkspacePayload,
  SetSystemPromptPayload,
  SetConversationMutedPayload,
  CreateWorkspaceFolderPayload,
  RenameWorkspacePayload,
  SetSessionSettingsPayload,
  RequestSessionSettingsPayload,
  RequestModelListPayload,
  RequestContextUsagePayload,
  MCPStatusRequestPayload,
  MCPReconnectPayload,
  MCPTogglePayload,
  StopBackgroundTaskPayload,
  RequestSystemPromptPayload,
  RequestHistoryPayload,
  InterruptPayload,
  NewSessionPayload,
  DequeueMessagePayload,
  SendQueuedNowPayload,
  QuestionAnswerPayload,
  QuestionRefusedPayload
} from '../wire/types'

/**
 * The fields the renderer supplies to resolve a modal with an answer (#236): the `modal_id` +
 * chosen `option_id` and optional `always_allow`, derived from `ModalAnswerPayload` without `answer_token` —
 * `Omit` ties the field names to the wire contract while making the token-exclusion a compile-time
 * guarantee (AC1: no member carries a token). The `answer_token` is minted MAIN-side by
 * daemonConnection.answerModal, exactly as `sendMessageCommand` leaves `message_id` minting to the
 * main-side composer.
 */
export type AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>

/**
 * The `newSession` command's payload (#1217) — the wire `NewSessionPayload` with its lone
 * `conversation_id` made REQUIRED.
 *
 * A DERIVATIVE, and the mirror image of `AnswerModalCommandPayload`'s `Omit` above: the same "derive
 * the command payload from the wire type so the two cannot drift" idiom, tightening a field instead of
 * excluding one. A hand-written twin would compile identically today and silently stop tracking the
 * wire type the day it gains a second field.
 *
 * IT IS TIGHTER THAN THE WIRE TYPE ON PURPOSE, and neither side is the one to "fix". The wire type
 * mirrors the daemon, which publishes the field as optional because the absent form is a compatibility
 * promise for clients written before pyrycode#2099 — and that form means the daemon's process-wide
 * follow-active cursor, not "this conversation". This app always holds an id, and the protocol's own
 * rule is that a client which CAN name a conversation must always name one, so the bare form is not
 * something a sender here should be able to construct. `Required` makes it a compile error rather than
 * a convention, and `isNewSessionPayload` refuses the runtime equivalent (`''`) at the boundary.
 */
export type NewSessionCommandPayload = Required<NewSessionPayload>

/**
 * The `interrupt` command's payload (#1092) — the wire `InterruptPayload` with its lone
 * `conversation_id` made REQUIRED.
 *
 * `NewSessionCommandPayload`'s derivation verbatim, for the twin verb and for the same reason, so
 * read that docblock for the "derive rather than hand-write, so the two cannot drift" argument. What
 * differs is only the defect each one closes: an unnamed `new_session` restarts whichever conversation
 * the daemon's follow-active cursor points at, and an unnamed `interrupt` stops that same
 * conversation's turn. The cursor is process-wide and stamped only by a routed `send_message`, so with
 * a sidebar that makes switching chats without sending ordinary, it is the last chat ANY client
 * messaged rather than the one on screen.
 *
 * IT IS TIGHTER THAN THE WIRE TYPE ON PURPOSE, and neither side is the one to "fix". The wire type
 * mirrors the daemon, which publishes the field optional because the absent form is a compatibility
 * promise for clients written before pyrycode#2103. This app always holds an id, and the protocol's
 * own rule is that a client which CAN name a conversation must always name one, so the bare form is
 * not something a sender here should be able to construct. `Required` makes it a compile error rather
 * than a convention, and `isInterruptPayload` refuses the runtime equivalent (`''`) at the boundary.
 */
export type InterruptCommandPayload = Required<InterruptPayload>

/**
 * The fields the renderer supplies to resolve an outstanding question batch with the operator's
 * selections (#920): the `question_batch_id` + the ordered `answers` entries, DERIVED from the wire
 * `QuestionAnswerPayload` with `answer_token` excluded, exactly as AnswerModalCommandPayload derives
 * from ModalAnswerPayload — `Omit` ties the field names to the wire contract while making the
 * token-exclusion a compile-time guarantee. The token is minted MAIN-side by
 * daemonConnection.answerQuestions; the renderer holds no CSPRNG seam and this family's contract is
 * that a token is never renderer-composed.
 */
export type AnswerQuestionsCommandPayload = Omit<QuestionAnswerPayload, 'answer_token'>

/**
 * The fields the renderer supplies to refuse an outstanding question batch (#920): the
 * `question_batch_id` alone. **`question_refused` carries `answer_token` on the wire too — unlike
 * `modal_cancel`, which carries `modal_id` alone — so this is an `Omit` derivative like the answer's,
 * not a bare wire-type reuse like ModalCancelPayload's.** Do not size this pair from the modal pair's
 * asymmetry. Written as an `Omit` rather than a hand-written one-field interface even though it
 * collapses to one field, so an upstream field addition propagates here instead of diverging silently.
 */
export type RefuseQuestionsCommandPayload = Omit<QuestionRefusedPayload, 'answer_token'>

/**
 * The closed set of push-notification kinds the renderer may ask main to raise (#391). A sealed
 * enum, NEVER free text: the main process owns the copy table that maps each kind to a static body,
 * so every kind has a static fallback body. The title may carry the conversation's name (#1593,
 * NotifyPayload.name), and since #1737 the body may carry a preview of the reply or the pending action
 * (NotifyPayload.preview), which main cleans and caps and replaces with the kind's copy when nothing
 * usable is left. Add a kind here only alongside its copy in fireNotification's NOTIFICATION_COPY (a
 * Record<NotifyKind, …>, so a new member won't type-check until it has copy).
 */
export type NotifyKind = 'turn-complete' | 'prompt'

/**
 * The `notify` command payload (#391). Defined HERE, not imported from ../wire/types — unlike every
 * other payload-bearing member, this command is a MAIN-LOCAL side-effect that never reaches the
 * transport, so its type is client-internal (like the derived AnswerModalCommandPayload above). It
 * carries the closed `kind` enum, which picks the fallback body, optionally the conversation's `name`
 * (#1593), which becomes the title, and optionally a `preview` (#1737), which becomes the body. No
 * conversation id, no secret.
 */
export interface NotifyPayload {
  kind: NotifyKind
  /**
   * The name of the conversation the notification is about (#1593) — UNTRUSTED host-supplied text,
   * resolved renderer-side from the conversation list, so the conversation id never crosses. Absent
   * when the conversation is unnamed or not in the list. Main cleans it (fireNotification's
   * notificationTitle) before it becomes the title, uses it as plain text only, and never logs it.
   */
  name?: string
  /**
   * An opaque, renderer-minted correlation token (#1597) that main echoes back unread on the click's
   * `notificationActivated` event, so the renderer can open the conversation that raised THIS
   * notification. It maps to a server and conversation only inside the renderer; neither id crosses.
   * Bounded by isNotificationToken. Main never interprets or logs it.
   */
  token?: string
  /**
   * The start of the agent's reply, or "Wants to run <tool>: <target>" for a pending permission prompt
   * (#1737) — UNTRUSTED daemon-derived plain text, already markdown-stripped and cut to 200 characters by
   * the renderer. Bounded at the boundary by MAX_NOTIFY_PREVIEW_LENGTH. Main cleans it (fireNotification's
   * notificationBody) before it becomes the body, falls back to the kind's copy, and never logs it.
   */
  preview?: string
}

/** The longest `notify` preview the main-side guard admits (#1737). Far above the renderer's own
 *  200-character cut, so a long reply never fails closed; a longer one is not a real renderer. */
export const MAX_NOTIFY_PREVIEW_LENGTH = 4000

/** The shape a notification token may take on either side of the boundary (#1597): 1 to 64 ASCII
 *  letters, digits or hyphens, which a `crypto.randomUUID()` satisfies. The main-side notify guard and
 *  the renderer's re-validation of the echo both call this, so the two sides cannot disagree. Pure;
 *  never throws. */
export function isNotificationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value)
}

/**
 * The `setBadgeCount` command payload (#1592): how many conversations need the operator, for the app
 * icon's badge. Main-local like NotifyPayload and defined here for the same reason. A bare count — no
 * conversation id, no name, no host — so nothing about WHICH conversations crosses to main.
 */
export interface BadgeCountPayload {
  count: number
}

/** The IPC channel every typed renderer command travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it.
 *  A mismatch would silently drop every command, so both sides reference this constant. */
export const COMMAND_CHANNEL = 'pyry:command' as const

/**
 * A single typed command from the renderer window to the background process. Sealed
 * discriminated union on `type`. Ten members today: `sendMessage`, whose `payload` reuses the
 * wire SendMessagePayload verbatim so no field is remapped between layers — since #1055 that includes
 * the optional `attachment_ids`, the ids of the uploads this message names, which are routing
 * identifiers rather than secrets or capabilities (`RequestAttachmentPayload`: "not secret, not
 * unguessable") and are shape-checked by isAttachmentIdList at this boundary; the bare
 * `requestDebugBundle` (#168), which carries NO payload because the bundle is daemon-global;
 * the bare `requestConversations` (#139), which carries NO payload — the daemon returns every
 * conversation; the bare `requestRecentWorkspaces` (#380), which likewise carries NO payload — the
 * daemon returns the recent-workspaces list (its reply is decoded to a `recentWorkspacesReceived`
 * event, consumed by #382); `answerModal` (#236), whose `payload` is AnswerModalCommandPayload (`modal_id` +
 * `option_id`, the token Omit-excluded — minted main-side); `cancelModal` (#236), whose
 * `payload` reuses the wire ModalCancelPayload (`modal_id` only); and `createConversation` (#241),
 * whose `payload` reuses the wire CreateConversationPayload (three nullable-and-present fields, all
 * server-defaultable — no secret); `promoteConversation` (#273), whose `payload` reuses the wire
 * PromoteConversationPayload (three REQUIRED strings — the deliberate opposite of create's nullable
 * fields — `conversation_id` / `name` / `cwd`, no secret); `archiveConversation` (#363), whose `payload`
 * reuses the wire ArchiveConversationPayload (a single REQUIRED `conversation_id` string — a routing id,
 * not a secret — asking the daemon to archive an active conversation, the mirror-image twin of
 * unarchive); `unarchiveConversation` (#346), whose `payload`
 * reuses the wire UnarchiveConversationPayload (a single REQUIRED `conversation_id` string — a routing id,
 * not a secret — asking the daemon to restore an archived conversation); `deleteConversation` (#364), whose
 * `payload` reuses the wire DeleteConversationPayload (a single REQUIRED `conversation_id` string — a routing
 * id, not a secret — asking the daemon to PERMANENTLY delete a conversation; the daemon replies with a
 * distinct `conversation_deleted { id }` record, not decoded here — #367 owns it); `renameConversation` (#359),
 * whose `payload` reuses the wire RenameConversationPayload (two REQUIRED strings — `conversation_id` +
 * `name`, no secret — asking the daemon to change a conversation's stored name); `changeWorkspace` (#379),
 * whose `payload` reuses the wire ChangeWorkspacePayload (two REQUIRED strings — `conversation_id` + `cwd`,
 * no secret — asking the daemon to move a conversation's workspace to a different folder; `cwd` is
 * renderer-supplied text the daemon resolves SERVER-side, never a local path here); `createWorkspaceFolder` (#381),
 * whose `payload` reuses the wire CreateWorkspaceFolderPayload (two REQUIRED strings — `parent` + `name`, no
 * secret — asking the daemon to create a new workspace folder; both are renderer-supplied text the daemon
 * polices SERVER-side ($HOME confinement + a single-clean-element name guard), never a local path here; the
 * daemon replies with one `workspace_folder_created { path }` → `workspaceFolderCreated` event);
 * `renameWorkspace` (#1289), whose `payload` reuses the wire RenameWorkspacePayload (a REQUIRED `path`
 * beside a NULLABLE `label` — no secret — asking the daemon to rename a WORKSPACE, with a literal
 * `null` label meaning "clear it"; both are renderer-supplied text the daemon polices SERVER-side
 * (exact-`cwd` match, non-empty after trim, ≤128 characters), never a local path here; the daemon
 * replies with `workspace_updated`; an optional client-only attemptId requests an additive result.
 * The inbound path always re-lists and the label arrives on that authoritative reply);
 * and `setSessionSettings` (#263), whose `payload` reuses the wire
 * SetSessionSettingsPayload (`session_id` + optional-absent `model`/`effort`/`yolo` — the omitempty
 * presence contract is applied main-side by the builder, not carried here) and additionally carries a
 * `changeId` (#261): a renderer-minted, client-internal correlation string riding ALONGSIDE `payload` (a
 * top-level sibling, NEVER a field inside the wire payload — the builder consumes only `payload`, so the
 * key stays off the wire, mirroring how the composer mints `message_id` main-side). `changeId` is an
 * opaque correlation key, never a token/key/raw frame and never serialized onto the wire; and
 * `dequeueMessage` (#300), whose `payload` reuses the wire DequeueMessagePayload verbatim
 * (`conversation_id` + `queued_msg_id`) to ask the daemon to drop one queued message — ungated (#720),
 * so the payload carries NO token (no `Omit`-derivative, unlike `answerModal`); and `interrupt` (#306,
 * named by #1092), which stops the running turn in the conversation it names — fire-and-forget with no
 * reply, and payload-required for `newSession`'s reason, since an unnamed one is the daemon's
 * process-wide follow-active cursor (daemon SSOT pyrycode #707, widened by #2103); and `notify` (#391), whose `payload`
 * is NotifyPayload — the sole member whose payload type is defined in THIS file, not imported from
 * ../wire/types, because it is a MAIN-LOCAL side-effect command that never reaches the transport. It
 * carries the closed `kind` enum (`turn-complete` | `prompt`), which main maps to a static body, plus an
 * optional conversation `name` that main cleans into the title (#1593) — no free-text body, no id, no
 * secret — to raise an OS notification when the window is unfocused.
 * `setBadgeCount` (#1592) is main-local for the same reason: a bare non-negative count for the app icon's
 * badge, with no id, name or host beside it.
 * and `answerQuestions` / `refuseQuestions` (#920), the question vertical's resolution pair, whose payloads
 * are AnswerQuestionsCommandPayload (`question_batch_id` + the ordered `answers` entries) and
 * RefuseQuestionsCommandPayload (`question_batch_id` alone) — BOTH `Omit`-derivatives, because unlike the
 * modal pair BOTH question frames carry `answer_token` on the wire, so both mints are main-side
 * (daemonConnection.answerQuestions / refuseQuestions). `answerQuestions` is the union's only STRUCTURED
 * payload (an array of `{ question_index, values }` objects rather than a flat scalar row), which is why
 * its guard recurses where every sibling checks one level.
 * And `requestSessionSettings`, which reuses the wire RequestSessionSettingsPayload (a single REQUIRED
 * `conversation_id` string — a routing id, not a secret) to ask for one conversation's run
 * configuration. It was a bare member until #945 and briefly an optional-payload one between #945 and
 * #946: the daemon gained the field on 2026-08-20 (pyrycode#1586/#1610) and answers an unnamed request
 * with a zero-valued reply rather than an error, so a client still sending nothing degraded in silence
 * for two weeks (#941). The payload is REQUIRED since #946 — every sender resolves an id, and a bare
 * send is a compile error here rather than a request that quietly addresses nothing.
 * And `requestModelList` (#1165), which reuses the wire RequestModelListPayload (a single REQUIRED
 * `conversation_id` string — a routing id, not a secret) to ask for one conversation's model and effort
 * vocabulary, covering the conversations both pushed `model_list` lanes structurally miss (one created
 * after this app connected). Payload-REQUIRED from the start, and for a STRONGER reason than its
 * neighbour above: that verb answers an unnamed request with a zero-valued reply, so a bare send there
 * was silently useless rather than impossible; here an unnamed request has nothing to ask about at all.
 * It has NO renderer sender in the slice that declares it — #1166 adds the trigger.
 * And `requestHistory` (#1222), which reuses the wire RequestHistoryPayload (a `conversation_id`, an
 * opaque `cursor` and a `limit`) to ask for one backward step of a scroll-back walk over the daemon's
 * on-disk log. Payload-REQUIRED, like the two above: a request with no conversation to name has
 * nothing to ask about. It is the FIRST member carrying a value this app did not mint — the `cursor`
 * is daemon-minted, round-tripping out through the window and back, and it stays opaque the whole way:
 * never parsed, never rewritten, and never treated as a secret or a capability (it is deliberately
 * unsigned; authorization is pairing, at the Noise handshake). It has NO renderer sender in the slice
 * that declares it — #1224 adds the trigger.
 * And `requestSystemPrompt` (#1230), which reuses the wire RequestSystemPromptPayload (a single
 * REQUIRED `conversation_id` string — a routing id, not a secret) to ask what system prompt a
 * conversation holds and whether the running session was started with a different one. Payload-REQUIRED
 * like the three above, and its divergence from them is that it is the ONLY member whose verb has no
 * error frame at all: an id the daemon cannot resolve draws an ordinary-looking `no_session` reply
 * rather than a refusal a client can see, so an unroutable id must be stopped BEFORE the send — which
 * is `main/index.ts`'s routing lookup, not this guard, which checks type as its siblings do. It has NO
 * renderer sender in the slice that declares it — #1231 adds the trigger.
 * And `setSystemPrompt` (#1249), the WRITE half of the pair above: it reuses the wire
 * SetSystemPromptPayload (a required `conversation_id` beside a TRI-STATE `system_prompt`) to store,
 * replace or clear what a conversation spawns its sessions with. Payload-REQUIRED like the four above,
 * and its divergence from all of them is the nullable second field: `null` clears, `''` is an
 * explicitly-empty stored state and text is stored verbatim, so this is the one member whose guard
 * checks a field is PRESENT-and-(string-or-null) rather than merely present-and-a-string. It is also
 * the file's first member carrying UNTRUSTED OPERATOR TEXT on its way to the network — never a log
 * argument, never a path component, never a cache key — and the first whose over-length refusal is
 * this client's own verdict rather than the daemon's, raised in the connection method so it can be
 * reported rather than dropped. It has NO renderer sender in the slice that declares it — #1250 adds
 * the trigger, and #1078 the editor surface.
 * And `newSession` (#1217), which asks the daemon to KILL claude and spawn a fresh one in the
 * conversation it names — not a `/clear` sent as ordinary message text, which clears context in place
 * and keeps the process. (#1496 made the Actions menu's one `Reset session` row dispatch this command;
 * a typed `/clear` still travels the message path and never reaches here.) It is the only member whose
 * payload type TIGHTENS its wire type rather than reusing or Omit-ing it (NewSessionCommandPayload =
 * `Required<NewSessionPayload>`): the daemon publishes `conversation_id` as optional because the
 * absent form is a pre-#2099 compatibility promise meaning "the daemon's process-wide follow-active
 * cursor", and a client that can name a conversation must always name one. It has NO renderer sender
 * in the slice that declares it — the sibling adds the trigger.
 * No member
 * exposes a field that could hold a token, key, or raw frame (AC5) — the payload-bearing ones reuse only
 * wire types (or a token-excluded derivative), the bare ones carry nothing.
 *
 * SIX MEMBERS CARRY AN OPTIONAL `serverId` (#1120): `requestConversations`, `requestRecentWorkspaces`,
 * `createConversation`, `createWorkspaceFolder`, `requestDebugBundle` and `renameWorkspace` (#1289 —
 * a workspace label belongs to a workspace, not to any one chat, so its payload carries no id to route
 * by and joins the set for exactly the reason the others did). These are the SERVER-SCOPED
 * commands — each is about a whole server and carries no id of any kind to route by, so
 * with more than one server paired they reached whichever host was paired most recently. The field is a
 * top-level string sibling of `payload`, NEVER a field inside it, exactly as `changeId` is: the envelope
 * builders consume only `payload`, so the key stays off the wire BY CONSTRUCTION rather than by
 * discipline, and three of the five are bare members with no payload at all, so it costs no payload type
 * and no new wire-type import. It is a background-process ROUTING KEY, resolved against the connection
 * registry's held entry set by `serverRouter.ts` and refused when it names no connected server; it is
 * never a capability, a token selector, a path, or a log field.
 *
 * `interrupt` WAS THE SIXTH AND LEFT THE SET (#1092), which is the shape a member leaves it by. It
 * qualified only because it carried no id of any kind; once pyrycode#2103 let the frame name the
 * conversation whose turn to stop, that conversation id became the address, and a `serverId` beside it
 * would have been a second one free to disagree with the first. It routes through #1118's
 * conversation index now, like every other conversation-scoped member. A member joins this set for
 * want of an id and leaves it the moment it acquires one.
 *
 * It is OPTIONAL, and that is what keeps #1120 main-only: a required field would be a compile-forced
 * edit in five renderer senders and their fixtures, none of which has a per-server surface to source an
 * id from until #1070/#1085/#1086 land. An absent id resolves to the sole connection when the registry
 * holds exactly one entry, and is refused when it holds more — bounded and observable, never an
 * arbitrary server. `notify` is deliberately NOT in this set: it is main-local (fireNotification owns
 * the body copy, the only free text is the title-bound name resolved renderer-side, no frame results),
 * so an id on it would be a field nothing reads.
 *
 * Extend additively (connect/disconnect) when their transport tickets land — and add a
 * matching case to isRendererCommand in lockstep, or the new member is silently dropped at
 * the boundary.
 */
export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'requestDebugBundle'; serverId?: string }
  | { type: 'requestSessionSettings'; payload: RequestSessionSettingsPayload }
  | { type: 'requestModelList'; payload: RequestModelListPayload }
  | { type: 'requestContextUsage'; payload: RequestContextUsagePayload }
  | { type: 'requestMcpStatus'; payload: MCPStatusRequestPayload }
  | { type: 'reconnectMcpServer'; payload: MCPReconnectPayload }
  | { type: 'toggleMcpServer'; payload: MCPTogglePayload }
  | { type: 'stopBackgroundTask'; payload: StopBackgroundTaskPayload }
  | { type: 'requestHistory'; payload: RequestHistoryPayload }
  | { type: 'requestSystemPrompt'; payload: RequestSystemPromptPayload }
  | { type: 'requestConversations'; serverId?: string }
  | { type: 'requestRecentWorkspaces'; serverId?: string }
  | { type: 'answerModal'; payload: AnswerModalCommandPayload }
  | { type: 'cancelModal'; payload: ModalCancelPayload }
  | { type: 'answerQuestions'; payload: AnswerQuestionsCommandPayload }
  | { type: 'refuseQuestions'; payload: RefuseQuestionsCommandPayload }
  | { type: 'createConversation'; payload: CreateConversationPayload; serverId?: string }
  | { type: 'promoteConversation'; payload: PromoteConversationPayload }
  | { type: 'archiveConversation'; payload: ArchiveConversationPayload }
  | { type: 'unarchiveConversation'; payload: UnarchiveConversationPayload }
  | { type: 'deleteConversation'; payload: DeleteConversationPayload }
  | { type: 'renameConversation'; payload: RenameConversationPayload }
  | { type: 'changeWorkspace'; payload: ChangeWorkspacePayload }
  | { type: 'setSystemPrompt'; payload: SetSystemPromptPayload }
  // Routed by conversation (#1595). The client-only attemptId is required and correlates exactly one
  // content-free conversationMuteResult; it never reaches the wire.
  | { type: 'setConversationMuted'; payload: SetConversationMutedPayload; attemptId: string }
  | { type: 'createWorkspaceFolder'; payload: CreateWorkspaceFolderPayload; serverId?: string }
  | { type: 'renameWorkspace'; payload: RenameWorkspacePayload; serverId?: string; attemptId?: string }
  | { type: 'setSessionSettings'; payload: SetSessionSettingsPayload; changeId: string }
  | { type: 'dequeueMessage'; payload: DequeueMessagePayload }
  | { type: 'sendQueuedNow'; payload: SendQueuedNowPayload }
  | { type: 'interrupt'; payload: InterruptCommandPayload }
  | { type: 'newSession'; payload: NewSessionCommandPayload }
  | { type: 'notify'; payload: NotifyPayload }
  | { type: 'setBadgeCount'; payload: BadgeCountPayload }

/**
 * Wrap already-assembled send-message fields into a well-formed command. Pure: it does NOT
 * generate the message_id (that needs randomness — #11's composer mints it and passes the
 * assembled SendMessagePayload in). The RendererCommand return type is the compile-time
 * guarantee AC4 requires: a member with an unmodelled `type` cannot type-check.
 */
export function sendMessageCommand(fields: SendMessagePayload): RendererCommand {
  return { type: 'sendMessage', payload: fields }
}

/**
 * Wrap the user's modal answer (`modal_id` + chosen `option_id`) into a well-formed command (#236).
 * Pure: it does NOT mint the `answer_token` — that needs randomness and lives main-side
 * (daemonConnection.answerModal), exactly as sendMessageCommand leaves message_id minting to the
 * composer. The `fields` type (AnswerModalCommandPayload) Omit-excludes the token, so a caller
 * cannot even supply one here (AC1: no member carries a token).
 */
export function answerModalCommand(fields: AnswerModalCommandPayload): RendererCommand {
  return { type: 'answerModal', payload: fields }
}

/**
 * Wrap a modal cancel (`modal_id` only) into a well-formed command (#236). Pure; reuses the wire
 * ModalCancelPayload verbatim (the sendMessage "reuse wire types, no remapping" convention). No
 * token, no secret — `modal_id` is the sole correlation key (ADR 0009).
 */
export function cancelModalCommand(fields: ModalCancelPayload): RendererCommand {
  return { type: 'cancelModal', payload: fields }
}

/**
 * Wrap the operator's selections resolving an outstanding question batch (`question_batch_id` + the
 * ordered `answers` entries) into a well-formed command (#920). Pure: it does NOT mint the
 * `answer_token` — that needs randomness and lives main-side (daemonConnection.answerQuestions),
 * exactly as answerModalCommand leaves its token to daemonConnection.answerModal. The `fields` type
 * Omit-excludes the token, so a caller cannot even supply one here.
 *
 * The entries pass through opaque: nothing here checks a value against the batch's offered labels,
 * bounds the array, or range-checks a `question_index`. Upstream's `answerVerdict` owns every one of
 * those rules, and a second copy would be a second bound to keep in agreement with the batch.
 */
export function answerQuestionsCommand(fields: AnswerQuestionsCommandPayload): RendererCommand {
  return { type: 'answerQuestions', payload: fields }
}

/**
 * Wrap a question-batch refusal (`question_batch_id` only) into a well-formed command (#920) — the
 * operator declined to choose, so the batch resolves without any selection. Pure; it does NOT mint the
 * `answer_token`. Unlike cancelModalCommand, whose frame carries no token at all, the
 * `question_refused` frame DOES carry one — hence the Omit-derivative payload type and the main-side
 * mint, identical to the answer half.
 */
export function refuseQuestionsCommand(fields: RefuseQuestionsCommandPayload): RendererCommand {
  return { type: 'refuseQuestions', payload: fields }
}

/**
 * Wrap already-assembled dequeue fields (`conversation_id` + `queued_msg_id`) into a well-formed
 * command (#300) — asks the daemon to drop one queued-but-not-yet-run message. Pure; reuses the wire
 * DequeueMessagePayload verbatim (the sendMessage "reuse wire types, no remapping" convention).
 * Dropping a queued message is UNGATED (#720): no token to mint, so — unlike
 * answerModalCommand — the payload is the wire type directly, not an Omit-derivative. The
 * RendererCommand return type is the compile-time guarantee (AC1).
 */
export function dequeueMessageCommand(fields: DequeueMessagePayload): RendererCommand {
  return { type: 'dequeueMessage', payload: fields }
}

/**
 * Wrap a queued row's `conversation_id` + `queued_msg_id` into a `sendQueuedNow` command (#1726) — asks
 * the daemon to deliver that queued message into the running turn. Pure; the wire payload verbatim, as
 * dequeueMessageCommand. Ungated, so there is no token to mint.
 */
export function sendQueuedNowCommand(fields: SendQueuedNowPayload): RendererCommand {
  return { type: 'sendQueuedNow', payload: fields }
}

/**
 * Wrap the conversation to restart into a well-formed `newSession` command (#1217) — asks the
 * background process to have the daemon kill claude and spawn a fresh one there. Pure; there is no
 * token to mint, because the frame carries none at all (no nonce, no answer token, no correlation
 * key), so — like dequeueMessageCommand and unlike answerModalCommand — the payload type is the
 * wire-derived one directly.
 *
 * It takes the payload rather than a bare `conversationId` scalar, matching every other
 * payload-bearing constructor in this file; the scalar unwrap happens main-side, at the dispatch arm,
 * where one local is read twice so the id routed by and the id sent cannot be two expressions.
 *
 * `NewSessionCommandPayload` is what stops a caller naming nothing: the wire type's optional id is
 * `Required` here, so a restart with no conversation is a compile error rather than a frame that
 * quietly restarts whichever conversation the daemon's cursor last pointed at. Its caller is the
 * render affordance in the sibling ticket.
 */
export function newSessionCommand(fields: NewSessionCommandPayload): RendererCommand {
  return { type: 'newSession', payload: fields }
}

/**
 * Construct the `interrupt` command (#306, named by #1092) — asks the background process to stop the
 * running turn in the conversation it names. Pure; there is no token to mint, because the frame
 * carries none at all (no nonce, no answer token, no correlation key), so — like
 * `newSessionCommand` and unlike `answerModalCommand` — the payload type is the wire-derived one
 * directly.
 *
 * It takes the payload rather than a bare `conversationId` scalar, matching every other
 * payload-bearing constructor in this file; the scalar unwrap happens main-side, at the dispatch arm,
 * where one local is read twice so the id routed by and the id sent cannot be two expressions.
 *
 * `InterruptCommandPayload` is what stops a caller naming nothing: the wire type's optional id is
 * `Required` here, so a Stop with no conversation is a compile error rather than a frame that quietly
 * stops whichever conversation the daemon's cursor last pointed at. THE ZERO-ARG FORM IS GONE
 * DELIBERATELY, and its absence is the AC4 property rather than a signature tidy-up — the old
 * constructor took an optional `serverId` (#1120) and could always be called bare. Its callers are the
 * two Stop affordances in `Composer`, through `sendInterrupt`.
 */
export function interruptCommand(fields: InterruptCommandPayload): RendererCommand {
  return { type: 'interrupt', payload: fields }
}

/**
 * Runtime type guard for the untrusted renderer→main boundary. True iff `value` is a
 * structurally valid RendererCommand. Accepts extra/unknown fields (structural minimum);
 * rejects everything else. Pure; never throws. Co-located with the union so the two evolve
 * in lockstep — grow the switch as the union grows.
 */
export function isRendererCommand(value: unknown): value is RendererCommand {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  switch (value.type) {
    case 'sendMessage':
      return 'payload' in value && isSendMessagePayload(value.payload)
    case 'requestDebugBundle':
      // Bare member: no payload to validate, so the optional server id (#1120) is the whole check.
      return hasValidServerId(value)
    case 'requestSessionSettings':
      // Payload-required since #946, so this collapses to the neighbours' idiom. Both of #945's
      // acceptance arms are gone: an unnamed request addresses nothing and draws a zero-valued reply,
      // which is the #941 regression, not a shape to keep accepting. The explicitly-`undefined` case
      // is refused BY isRequestSessionSettingsPayload rather than by the `in` check — structured
      // clone PRESERVES an explicitly-undefined property across the IPC bridge, so `'payload' in
      // value` alone would pass one straight through to the wire.
      return 'payload' in value && isRequestSessionSettingsPayload(value.payload)
    case 'requestModelList':
      // Payload-required (#1165), so this is the neighbour's idiom verbatim. The explicitly-`undefined`
      // case is refused BY isRequestModelListPayload rather than by the `in` check, for the reason the
      // arm above records: structured clone PRESERVES an explicitly-undefined property across the IPC
      // bridge, so `'payload' in value` alone would pass one straight through to the wire.
      return 'payload' in value && isRequestModelListPayload(value.payload)
    case 'requestContextUsage':
      return 'payload' in value && isRequestContextUsagePayload(value.payload)
    case 'requestMcpStatus':
      return 'payload' in value && isMCPStatusRequestPayload(value.payload)
    case 'reconnectMcpServer':
      return 'payload' in value && isMCPReconnectPayload(value.payload)
    case 'toggleMcpServer':
      return 'payload' in value && isMCPTogglePayload(value.payload)
    case 'stopBackgroundTask':
      return 'payload' in value && isStopBackgroundTaskPayload(value.payload)
    case 'requestHistory':
      // Payload-required (#1222) — the neighbour's idiom verbatim, including why the
      // explicitly-`undefined` case is refused by the payload guard and not by the `in` check.
      return 'payload' in value && isRequestHistoryPayload(value.payload)
    case 'requestSystemPrompt':
      // Payload-required (#1230) — the neighbours' idiom verbatim, including why the
      // explicitly-`undefined` case is refused by the payload guard rather than by the `in` check.
      return 'payload' in value && isRequestSystemPromptPayload(value.payload)
    case 'requestConversations':
      // Bare member (#139): no payload to validate, so the optional server id (#1120) is the whole check.
      return hasValidServerId(value)
    case 'requestRecentWorkspaces':
      // Bare member (#380): no payload to validate, so the optional server id (#1120) is the whole check.
      return hasValidServerId(value)
    case 'answerModal':
      return 'payload' in value && isAnswerModalPayload(value.payload)
    case 'cancelModal':
      return 'payload' in value && isCancelModalPayload(value.payload)
    case 'answerQuestions':
      return 'payload' in value && isAnswerQuestionsPayload(value.payload)
    case 'refuseQuestions':
      return 'payload' in value && isRefuseQuestionsPayload(value.payload)
    case 'createConversation':
      return (
        'payload' in value && isCreateConversationPayload(value.payload) && hasValidServerId(value)
      )
    case 'promoteConversation':
      return 'payload' in value && isPromoteConversationPayload(value.payload)
    case 'archiveConversation':
      return 'payload' in value && isArchiveConversationPayload(value.payload)
    case 'unarchiveConversation':
      return 'payload' in value && isUnarchiveConversationPayload(value.payload)
    case 'deleteConversation':
      return 'payload' in value && isDeleteConversationPayload(value.payload)
    case 'renameConversation':
      return 'payload' in value && isRenameConversationPayload(value.payload)
    case 'changeWorkspace':
      return 'payload' in value && isChangeWorkspacePayload(value.payload)
    case 'setSystemPrompt':
      // Payload-required (#1249) — the neighbours' idiom verbatim, including why the
      // explicitly-`undefined` case is refused by the payload guard rather than by the `in` check.
      return 'payload' in value && isSetSystemPromptPayload(value.payload)
    case 'setConversationMuted':
      return 'payload' in value && isSetConversationMutedPayload(value.payload) &&
        'attemptId' in value && typeof value.attemptId === 'string' &&
        value.attemptId.length > 0 && value.attemptId.length <= 128
    case 'createWorkspaceFolder':
      return (
        'payload' in value && isCreateWorkspaceFolderPayload(value.payload) && hasValidServerId(value)
      )
    case 'renameWorkspace':
      // The createWorkspaceFolder arm's shape (#1289): a payload guard paired with the optional
      // server id, since a workspace label is not scoped to a conversation and carries no id to
      // route by.
      return 'payload' in value && isRenameWorkspacePayload(value.payload) && hasValidServerId(value) &&
        (!('attemptId' in value) || (typeof value.attemptId === 'string' &&
          value.attemptId.length > 0 && value.attemptId.length <= 128))
    case 'setSessionSettings':
      // The renderer-minted `changeId` (#261) is validated at the untrusted boundary exactly as
      // `message_id` is — a top-level string sibling of `payload`, never carried onto the wire.
      return (
        'payload' in value &&
        isSetSessionSettingsPayload(value.payload) &&
        'changeId' in value &&
        typeof value.changeId === 'string'
      )
    case 'dequeueMessage':
      return 'payload' in value && isDequeueMessagePayload(value.payload)
    case 'sendQueuedNow':
      return 'payload' in value && isSendQueuedNowPayload(value.payload)
    case 'interrupt':
      // The newSession arm's shape (#1092) — a required payload, refused BY isInterruptPayload rather
      // than by the `in` check, for the reason the requestModelList arm records. NO serverId arm any
      // more: the conversation id already selects the connection, so a second addressing scheme would
      // be a way for the two to disagree.
      return 'payload' in value && isInterruptPayload(value.payload)
    case 'newSession':
      // The requestModelList arm's shape (#1217) — a required payload, refused BY isNewSessionPayload
      // rather than by the `in` check, for the reason that arm records. NO serverId arm: the
      // conversation id already selects the connection, so a second addressing scheme would be a way
      // for the two to disagree.
      return 'payload' in value && isNewSessionPayload(value.payload)
    case 'notify':
      return 'payload' in value && isNotifyPayload(value.payload)
    case 'setBadgeCount':
      // Main-local like `notify`, and for the same reason carries no serverId arm.
      return 'payload' in value && isBadgeCountPayload(value.payload)
    default:
      return false
  }
}

/**
 * The optional `serverId` arm of the guard above (#1120) — ONE helper for all five server-scoped
 * members, so they cannot drift apart into five subtly different acceptance rules. (`interrupt` was
 * the sixth until #1092 gave the frame a conversation to name; see the union's own header.)
 *
 * ABSENT-OR-UNDEFINED-OR-STRING, and every word of that is load-bearing. `'serverId' in value` alone
 * is wrong in BOTH directions here. Structured clone PRESERVES an own property whose value is
 * `undefined` (this file's `attachment_ids` docblock records the same fact, and the
 * `requestSessionSettings` arm records the reverse call for a REQUIRED field), so a present-key check
 * would read `{ serverId: undefined }` as a supplied value rather than as the omission it is — and a
 * present-key REJECTION would refuse the ordinary bare command every shipped sender emits, since none
 * of the six renderer senders has a per-server surface to name a server from yet.
 *
 * TYPE, NOT EMPTINESS, and not canonical shape either. `''` is accepted here and refused one layer
 * later: `serverRouter.ts` resolves every named id against the connection registry's held entry set,
 * and `''` matches no record's `server`, so it takes the named branch and refuses with no frame on
 * any wire. A shape check here would buy nothing the resolution does not already buy — the id is a
 * routing key looked up against ids this process already holds, never a capability, a path, a cache
 * key or a log field.
 *
 * Structural minimum otherwise, like every sibling: the field is read by the main-side router alone
 * and never forwarded, and the envelope builders consume `payload` only, so it cannot reach the wire.
 * Pure; never throws.
 */
function hasValidServerId(value: object): boolean {
  if (!('serverId' in value)) return true
  return value.serverId === undefined || typeof value.serverId === 'string'
}

function isSendMessagePayload(value: unknown): value is SendMessagePayload {
  if (typeof value !== 'object' || value === null) return false
  if (
    !(
      'conversation_id' in value &&
      typeof value.conversation_id === 'string' &&
      'message_id' in value &&
      typeof value.message_id === 'string' &&
      'text' in value &&
      typeof value.text === 'string'
    )
  ) {
    return false
  }
  return 'attachment_ids' in value ? isAttachmentIdList(value.attachment_ids) : true
}

/**
 * The `attachment_ids` arm of the guard above (#1055) — this file's SECOND array field, after
 * `answers`, and it inherits that field's two lessons rather than re-deriving them.
 *
 * A PRESENT KEY HOLDING `undefined` IS LEGAL, and it is the ordinary case rather than a curiosity:
 * `submitMessage` assigns the field unconditionally (the `createdAt` idiom, so `JSON.stringify` drops
 * it and the wire keeps its three-key form), and structured clone PRESERVES an own property whose
 * value is `undefined`. A bare `'attachment_ids' in value` rejection would refuse every ordinary send.
 *
 * IT ITERATES WITH `for…of`, NEVER `Array.prototype.every` — isAnswerQuestionsPayload's rule, and
 * load-bearing for the same reason: `every` SKIPS holes, so a sparse array would pass it while
 * `JSON.stringify` emits `null` for the hole, i.e. a `null` inside a declared `string[]`. Sparse arrays
 * survive structured clone, so that shape is reachable over IPC rather than theoretical. What it buys
 * is that a type-lie never reaches `buildSendMessage`'s bare serialization, where the daemon would
 * refuse the whole frame as `protocol.malformed` and take the operator's message with it.
 *
 * NON-EMPTY, BUT NOT CANONICALLY SHAPED, and that split is deliberate. The empty string is refused for
 * isAttachmentRetrievalRequest's recorded reason — joined onto a directory it names that directory, so
 * the far side fails silently rather than loudly, and this side declines to ORIGINATE the value. The
 * lowercase-UUIDv4 check is NOT made here: upstream mandates it on the receiver and enforces it since
 * pyrycode#2038 (one canonical-shape check answering both the path-component and the prompt-content
 * hazard), and `RequestAttachmentPayload` already ruled this repo's side of the identical value class
 * *documented, not validated*. A second, divergent posture on one feature's ids would buy nothing: the
 * only producer is the window echoing back ids this process minted with `randomUUID`.
 *
 * It bounds no COUNT. Upstream's 32-id ceiling is a published contract number rather than a DoS
 * mitigation, the envelope cap already bounds the frame, and #1055 rules the bound out of scope.
 * Pure; never throws.
 */
function isAttachmentIdList(value: unknown): value is string[] | undefined {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0) return false
  }
  return true
}

/** The untrusted renderer→main boundary guard for the answerModal payload (#236) — the modal
 *  resolution's boundary check (why the command half is security-sensitive). Mirrors
 *  isSendMessagePayload: `modal_id` AND `option_id` string, and a present `always_allow` Boolean.
 *  Explicit undefined is invalid: structured clone preserves the property. A smuggled
 *  `answer_token` is not rejected here (the main-side sender's fresh-literal construction ignores
 *  it), so this guard need not know about the token. Pure; never throws. */
function isAnswerModalPayload(value: unknown): value is AnswerModalCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'modal_id' in value &&
    typeof value.modal_id === 'string' &&
    'option_id' in value &&
    typeof value.option_id === 'string' &&
    (!('always_allow' in value) || typeof value.always_allow === 'boolean')
  )
}

/** The untrusted renderer→main boundary guard for the cancelModal payload (#236). Mirrors
 *  isUnarchiveConversationPayload: one `modal_id` string check (the sole correlation key, not a secret).
 *  Pure; never throws. */
function isCancelModalPayload(value: unknown): value is ModalCancelPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'modal_id' in value && typeof value.modal_id === 'string'
}

/** The untrusted renderer→main boundary guard for the answerQuestions payload (#920) — the question
 *  vertical's boundary check (why the command half is security-sensitive). THE ONE GUARD IN THIS FILE
 *  THAT RECURSES: every sibling validates a flat row of scalars, but `answers` is an array of objects,
 *  and a shallow `Array.isArray` check would let `{ question_index: 'nope' }` through to the builder's
 *  bare JSON.stringify and put a type-lie on the wire. So each entry is checked field by field.
 *
 *  **It iterates with `for…of`, never `Array.prototype.every` — that is load-bearing, not style.**
 *  `every` SKIPS holes, so a sparse `values` would pass it while JSON.stringify emits `null` for the
 *  hole, i.e. a `null` inside a declared `string[]`. `for…of` goes through the iterator, which yields
 *  `undefined` for a hole, and the `typeof` check then rejects it. Sparse arrays survive structured
 *  clone, so this is reachable over IPC rather than theoretical.
 *
 *  It bounds NOTHING: not entry count, not value length, not `question_index` against any batch, and
 *  not a value against the batch's offered labels. Upstream's `answerVerdict` owns every one of those
 *  (it range-checks before it subscripts and rejects a bad answer totally), and claude's contract
 *  permits free text anywhere — so a validator rejecting an unlisted value would reject a legal answer.
 *  This is a SHAPE guard. An empty `answers` is out of contract upstream but shape-valid here; the
 *  guard does not adjudicate contract.
 *
 *  Structural minimum otherwise — a smuggled `answer_token`, or an extra key at either level, is not
 *  rejected here: the main-side sender's fresh-literal construction rebuilds the payload AND each
 *  entry, so both lose. Pure; never throws. */
function isAnswerQuestionsPayload(value: unknown): value is AnswerQuestionsCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('question_batch_id' in value) || typeof value.question_batch_id !== 'string') return false
  if (!('answers' in value) || !Array.isArray(value.answers)) return false
  for (const entry of value.answers) {
    if (typeof entry !== 'object' || entry === null) return false
    if (!('question_index' in entry) || typeof entry.question_index !== 'number') return false
    if (!('values' in entry) || !Array.isArray(entry.values)) return false
    for (const v of entry.values) {
      if (typeof v !== 'string') return false
    }
  }
  return true
}

/** The untrusted renderer→main boundary guard for the refuseQuestions payload (#920). An exact clone of
 *  isCancelModalPayload with the key changed: one present-and-string `question_batch_id` check — a
 *  literal `null`, a missing key, and a non-string are all rejected. Checks TYPE, not emptiness (an
 *  empty string passes; the daemon polices ids). The batch id is a one-time unguessable nonce, not a
 *  secret to compare — no `timingSafeEqual` question arises here, since nothing on this path compares
 *  it to anything. Structural minimum — a smuggled `answer_token` is not rejected here; the main-side
 *  sender's fresh literal bounds the wire to the batch id plus the token IT mints. Pure; never throws. */
function isRefuseQuestionsPayload(value: unknown): value is RefuseQuestionsCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'question_batch_id' in value && typeof value.question_batch_id === 'string'
}

/** The untrusted renderer→main boundary guard for the createConversation payload (#241) — the reason
 *  the command half is security-sensitive. All three fields are nullable-and-PRESENT: the check is on
 *  TYPE, so a literal `null` is accepted (the daemon-default signal) while a missing/`undefined` key is
 *  rejected (the `in` check makes "present" explicit and narrows for TS). Structural minimum — a
 *  smuggled extra field is not rejected here; the main-side sender's fresh-literal construction bounds
 *  the wire to exactly these three fields. Pure; never throws.
 *
 *  The optional `agent`, `model` and `effort` (#1652) may be absent or `undefined` (structured clone
 *  keeps an undefined property). Otherwise `agent` must be exactly `claude` or `codex`, and `model` and
 *  `effort` must be strings — `null` is refused, since these keys are omitted rather than nulled. */
function isCreateConversationPayload(value: unknown): value is CreateConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'is_promoted' in value &&
    (typeof value.is_promoted === 'boolean' || value.is_promoted === null) &&
    'name' in value &&
    (typeof value.name === 'string' || value.name === null) &&
    'cwd' in value &&
    (typeof value.cwd === 'string' || value.cwd === null) &&
    (!('agent' in value) ||
      value.agent === undefined ||
      value.agent === 'claude' ||
      value.agent === 'codex') &&
    (!('model' in value) || value.model === undefined || typeof value.model === 'string') &&
    (!('effort' in value) || value.effort === undefined || typeof value.effort === 'string')
  )
}

/** The untrusted renderer→main boundary guard for the promoteConversation payload (#273) — the reason
 *  the command half is security-sensitive. The deliberate OPPOSITE of isCreateConversationPayload: all
 *  three fields are REQUIRED strings (a promoted conversation must carry a name + cwd, and the id must
 *  resolve), so this clones isSendMessagePayload's present-and-string checks — a literal `null`, a
 *  missing key, and a non-string are all rejected (unlike the create guard, which accepts null).
 *  Structural minimum — a smuggled extra field is not rejected here; the main-side sender's fresh-literal
 *  construction bounds the wire to exactly these three fields. Pure; never throws. */
function isPromoteConversationPayload(value: unknown): value is PromoteConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'cwd' in value &&
    typeof value.cwd === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the archiveConversation payload (#363) — the reason
 *  the command half is security-sensitive. The mirror-image twin of isUnarchiveConversationPayload: one
 *  present-and-string check — a literal `null`, a missing key, and a non-string are all rejected. Checks
 *  the TYPE of the field, NOT emptiness. Structural minimum — a smuggled extra field is not rejected
 *  here; the main-side sender's fresh-literal construction bounds the wire to exactly the one modeled
 *  field. Pure; never throws. */
function isArchiveConversationPayload(value: unknown): value is ArchiveConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the unarchiveConversation payload (#346) — the reason
 *  the command half is security-sensitive. The single-`conversation_id`-string precedent: one
 *  present-and-string check — a literal `null`, a missing key, and a non-string are all rejected.
 *  Structural minimum — a smuggled extra field is not rejected here; the main-side sender's
 *  fresh-literal construction bounds the wire to exactly the one modeled field. Pure; never throws. */
function isUnarchiveConversationPayload(value: unknown): value is UnarchiveConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the deleteConversation payload (#364) — the reason
 *  the command half is security-sensitive. An exact clone of isUnarchiveConversationPayload (the
 *  single-`conversation_id`-string precedent): one present-and-string check — a literal `null`, a missing
 *  key, and a non-string are all rejected. Checks the TYPE of the field, NOT emptiness (an empty string
 *  passes; the daemon polices it). Structural minimum — a smuggled extra
 *  field is not rejected here; the main-side sender's fresh-literal construction bounds the wire to
 *  exactly the one modeled field. Delete is the PERMANENT verb, but the transport guard is identical to
 *  unarchive's — the destructive-action gate is the user-facing confirmation (#367), not a second factor
 *  here. Pure; never throws. */
function isDeleteConversationPayload(value: unknown): value is DeleteConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the renameConversation payload (#359) — the reason
 *  the command half is security-sensitive. Clones isPromoteConversationPayload but DROPS the `cwd` check
 *  (rename is a deliberate non-reuse of PromoteConversationPayload; #820): both `conversation_id` and
 *  `name` must be present-and-string — a literal `null`, a missing key, and a non-string are all
 *  rejected. Checks TYPE, not emptiness — an empty-string `name` passes (a valid wire value; the daemon's
 *  trim-guard and #360's Save-disable handle blank). Structural minimum — a smuggled extra field is not
 *  rejected here; the main-side sender's fresh-literal construction bounds the wire to exactly these two
 *  fields. Pure; never throws. */
function isRenameConversationPayload(value: unknown): value is RenameConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the changeWorkspace payload (#379) — the reason the
 *  command half is security-sensitive. A clone of isRenameConversationPayload with the second field's key
 *  `name` → `cwd`: both `conversation_id` and `cwd` must be present-and-string — a literal `null`, a
 *  missing key, and a non-string are all rejected. Checks TYPE, not emptiness — an empty-string `cwd`
 *  passes (a valid wire value; the daemon polices the path server-side, #823). `cwd` is filesystem-shaped
 *  but is never resolved into a local path here (only serialized onto the wire). Structural minimum — a
 *  smuggled extra field is not rejected here; the main-side sender's fresh-literal construction bounds the
 *  wire to exactly these two fields. Pure; never throws. */
function isChangeWorkspacePayload(value: unknown): value is ChangeWorkspacePayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'cwd' in value &&
    typeof value.cwd === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the createWorkspaceFolder payload (#381) — the reason
 *  the command half is security-sensitive. A clone of isChangeWorkspacePayload with the two field keys
 *  `conversation_id`/`cwd` → `parent`/`name`: both must be present-and-string — a literal `null`, a
 *  missing key, and a non-string are all rejected. Checks TYPE, not emptiness — an empty-string `parent`
 *  or a bad `name` (separator, `..`, absolute, empty) passes here; the daemon polices both server-side
 *  ($HOME confinement + a single-clean-element name guard, #887). `parent`/`name` are filesystem-shaped
 *  but are never resolved into a local path here (only serialized onto the wire). Structural minimum — a
 *  smuggled extra field is not rejected here; the main-side sender's fresh-literal construction bounds the
 *  wire to exactly these two fields. Pure; never throws. */
function isCreateWorkspaceFolderPayload(value: unknown): value is CreateWorkspaceFolderPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'parent' in value &&
    typeof value.parent === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the renameWorkspace payload (#1289) — the reason the
 *  command half is security-sensitive. THE FIRST HYBRID IN THIS FILE rather than a clone of one
 *  neighbour, because no rename-shaped guard here has a nullable field beside a required one:
 *
 *    - `path` takes isChangeWorkspacePayload's present-and-string arm — a missing key, an
 *      `undefined`, a literal `null` and a non-string are all rejected.
 *    - `label` takes isCreateConversationPayload's present-but-NULLABLE arm — a literal `null` is
 *      accepted (it is the daemon's CLEAR signal, a value rather than an absence) while a missing key
 *      and a wrong type are rejected. The `in` check makes presence explicit, and it is not
 *      decoration: structured clone PRESERVES an explicitly-`undefined` own property across the IPC
 *      bridge, so a truthiness test would let `label: undefined` through as if it were the null.
 *
 *  Checks TYPE, not emptiness or length — an empty-string `label` passes, as an empty `cwd` does for
 *  changeWorkspace, and the 128-character bound is NOT re-implemented here. The daemon polices the
 *  whole contract (exact-`cwd` match, non-empty after trim, ≤128) and a client-side copy of that rule
 *  is how the two drift. `path` is filesystem-shaped but is never resolved into a local path here
 *  (only serialized onto the wire). Structural minimum — a smuggled extra field is not rejected here;
 *  the main-side sender's fresh-literal construction bounds the wire to exactly these two fields.
 *  Pure; never throws. */
function isRenameWorkspacePayload(value: unknown): value is RenameWorkspacePayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'path' in value &&
    typeof value.path === 'string' &&
    'label' in value &&
    (typeof value.label === 'string' || value.label === null)
  )
}

/** The untrusted renderer→main boundary guard for the setSessionSettings payload (#263) — the reason
 *  the command half is security-sensitive. Validates SHAPE, mirroring isCreateConversationPayload's
 *  per-field type checks but for OPTIONAL-ABSENT rather than nullable-present fields: `session_id` must
 *  be present-and-string; each of `model` / `effort` / `yolo` / `permission_mode`, WHEN PRESENT (`in`
 *  check), must be the right type (`string` / `string` / `boolean` / `string`) — a present zero value
 *  (`''` / `false`) passes, an ABSENT optional is accepted ("leave unchanged"). The omitempty presence
 *  contract itself lives in the main-side builder, not here; this guard only bounds the shape. Structural
 *  minimum — a smuggled extra field is not rejected here (the builder's fresh literal bounds the wire to
 *  the five modeled keys).
 *
 *  `permission_mode` (#1021) is a TYPE check, deliberately NOT closed-set membership — the opposite call
 *  from isNotifyPayload below, and the difference is which side owns the policy. The daemon's
 *  `validPermissionMode` is the authority and a client-side allowlist would drift from it on the next
 *  upstream mode; more to the point it would defend nothing, since a renderer able to smuggle a bad mode
 *  (which the daemon simply refuses) can instead send `yolo: true`, the STRICTLY STRONGER capability this
 *  same guard already admits. `isNotifyPayload`'s closed set exists because a bad value there reaches an
 *  OS notification with no server-side check behind it; here the daemon is that check.
 *
 *  Likewise NOT rejected: a payload carrying both `permission_mode` and `yolo`. The daemon refuses that
 *  frame unconditionally as malformed, the intended path cannot build one (`buildSettingsPayload` emits a
 *  single key), and re-implementing a cross-field daemon rule in a structural guard is how the two drift.
 *  Pure; never throws. */
function isSetSessionSettingsPayload(value: unknown): value is SetSessionSettingsPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('session_id' in value) || typeof value.session_id !== 'string') return false
  if ('model' in value && typeof value.model !== 'string') return false
  if ('effort' in value && typeof value.effort !== 'string') return false
  if ('yolo' in value && typeof value.yolo !== 'boolean') return false
  if ('permission_mode' in value && typeof value.permission_mode !== 'string') return false
  return true
}

/** The untrusted renderer→main boundary guard for the dequeueMessage payload (#300) — the reason the
 *  command half is security-sensitive. Mirrors isSendMessagePayload's present-and-string idiom with a
 *  present-and-NUMBER check for `queued_msg_id`: a `typeof` check only, NO integer/positive/range check,
 *  matching the requireNumber-alone posture of the #292 decode guard (a plain per-conversation integer
 *  no layer polices; an out-of-range id is a daemon-side no-op). Structural minimum — a smuggled extra
 *  field is not rejected here; the main-side sender's fresh-literal construction bounds the wire to
 *  exactly these two fields. Pure; never throws. */
/** The untrusted renderer→main boundary guard for the requestSessionSettings payload (#945, required
 *  since #946). isRefuseQuestionsPayload with the key changed: one present-and-string
 *  `conversation_id` check, so a missing key, a literal `null`, and a non-string are all rejected.
 *  Checks TYPE, not emptiness — `''` passes, and the daemon polices ids: it answers
 *  a conversation it does not host, one bound to no live session, and one named `''` alike, with a
 *  zero-valued session_settings, never an error frame and never another session's values. The value
 *  is client-owned (the renderer's own conversation state, not network input) and reaches only
 *  buildRequestSessionSettings, which rebuilds a fresh literal — never a log line, path, attribute,
 *  or cache key. Structural minimum: an extra field is not rejected here, and cannot reach the wire
 *  because that rebuild bounds the frame to the one id. Pure; never throws. */
function isRequestSessionSettingsPayload(value: unknown): value is RequestSessionSettingsPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the requestModelList payload (#1165). The guard
 *  above with the name changed: one present-and-string `conversation_id` check, so a missing key, a
 *  literal `null`, and a non-string are all rejected. Checks TYPE, not emptiness — `''` passes here,
 *  and the two verbs diverge one layer down rather than in their guards: the daemon answers an
 *  unresolvable id on THIS frame with one `error` (`conversation.not_found`), not with the zero-valued
 *  reply the neighbour gets, because there is no zero answer to "what models does nothing offer".
 *  Neither that code nor the retryable `model_list.unavailable` is retried anywhere client-side. The
 *  value is client-owned (this app's own conversation state, not network input) and reaches exactly
 *  two sinks past here: `conversationRouter.route`, a read-only `Map` lookup against an index built
 *  from the daemon's own conversation lists, and `buildRequestModelList`, which rebuilds a fresh
 *  literal — never a log line, path, attribute, or cache key. Structural minimum: an extra field is
 *  not rejected here, and cannot reach the wire because that rebuild bounds the frame to the one id.
 *  Pure; never throws. */
function isRequestModelListPayload(value: unknown): value is RequestModelListPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** Structural string check, including ''. Routing decides whether the id names a host;
 * buildRequestContextUsage discards extra fields before encoding. */
function isRequestContextUsagePayload(value: unknown): value is RequestContextUsagePayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The same structural string check for the MCP status ask (#1578). Routing decides whether the id
 * names a host; buildRequestMcpStatus discards extra fields before encoding. */
function isMCPStatusRequestPayload(value: unknown): value is MCPStatusRequestPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The MCP reconnect guard (#1582): both fields present and strings, either may be empty. Routing decides
 * the conversation, the daemon decides the server; buildMcpReconnect discards extra fields. */
function isMCPReconnectPayload(value: unknown): value is MCPReconnectPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string' &&
    'server_name' in value && typeof value.server_name === 'string'
}

/** The MCP toggle guard (#1586): the reconnect guard's two strings plus a present, genuinely boolean
 * `enabled`, so a truthy stand-in such as `'false'` or `1` never becomes a requested state. */
function isMCPTogglePayload(value: unknown): value is MCPTogglePayload {
  return isMCPReconnectPayload(value) && 'enabled' in value && typeof value.enabled === 'boolean'
}

/** The background-task stop guard (#1770): both ids present, strings and non-empty, so a blank or missing
 * id sends nothing. Opaque lookup keys; buildStopBackgroundTask discards extra fields. */
function isStopBackgroundTaskPayload(value: unknown): value is StopBackgroundTaskPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string' &&
    value.conversation_id.length > 0 &&
    'task_id' in value && typeof value.task_id === 'string' && value.task_id.length > 0
}

/** The untrusted renderer→main boundary guard for the requestSystemPrompt payload (#1230). The guard
 *  above with the name changed: one present-and-string `conversation_id` check, so a missing key, a
 *  literal `null`, and a non-string are all rejected.
 *
 *  CHECKS TYPE, NOT EMPTINESS, like every sibling except `newSession` — and here that choice is worth
 *  reading before "hardening" it, because this verb's divergence pushes the other way. Its neighbours
 *  tolerate `''` because the daemon answers an unresolvable id visibly: `conversation.not_found` on
 *  `request_model_list`, a zero-valued reply on `request_session_settings`. THIS VERB HAS NO ERROR
 *  FRAME AT ALL, so an empty id on the wire would draw an ordinary-looking `no_session` reply with an
 *  absent prompt, and the correlation map would file that false "no prompt, no session" reading
 *  against a real conversation — a reading nothing downstream can tell from a true one. The refusal
 *  that keeps such a frame off the wire is nonetheless NOT here: it is the ROUTING LOOKUP at the IPC
 *  arm (`router.route(id)?.…`), which already refuses and logs an id no server has claimed, and which
 *  refuses far more than emptiness. A second, weaker bound here would be a rule to keep in agreement
 *  with the router's while never being the one that actually fires. `newSession`'s emptiness clause is
 *  the one NOT to copy for the opposite reason: there `''` is a WIRE MEANING (restart whichever
 *  conversation the daemon's process-wide cursor points at), and this verb has no such fallback.
 *
 *  The value is client-owned (this app's own conversation state, not network input) and reaches
 *  exactly two sinks past here: `conversationRouter.route`, a read-only `Map` lookup against an index
 *  built from the daemon's own conversation lists, and `buildRequestSystemPrompt`, which rebuilds a
 *  fresh literal — never a log line, path, attribute, or cache key. Structural minimum: an extra field
 *  is not rejected here, and cannot reach the wire because that rebuild bounds the frame to the one
 *  id. Pure; never throws. */
function isRequestSystemPromptPayload(value: unknown): value is RequestSystemPromptPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'conversation_id' in value && typeof value.conversation_id === 'string'
}

/** The untrusted renderer→main boundary guard for the setSystemPrompt payload (#1249) — the WRITE
 *  half's guard, and the only one in this file that checks a NULLABLE field.
 *
 *  THREE CHECKS WHERE EVERY SIBLING HAS ONE, and the third is the reason. `conversation_id` present
 *  and a string is the usual routing-id check. `system_prompt` must then be PRESENT, and must be a
 *  `string` or exactly `null` — nothing else. The presence half is load-bearing rather than tidy: the
 *  field is a TRI-STATE (`null` clears, `''` is an explicitly-empty stored state, text is stored), and
 *  admitting an absent key would give it a fourth inhabitant, `undefined`, with no defined reading and
 *  a standing invitation to a `?? ''` downstream — which is the collapse that folds "clear" into
 *  "explicitly empty" and makes the clear path unreachable. Requiring the key makes the renderer SAY
 *  which of the three it means. The `=== null` half is not redundant with it either: structured clone
 *  PRESERVES an explicitly-undefined property across the IPC bridge, so `'system_prompt' in value`
 *  alone would pass `undefined` straight through to the wire, where JSON.stringify would then drop the
 *  key — a clear the caller never asked for.
 *
 *  CHECKS TYPE, NOT EMPTINESS, and NOT LENGTH — the two bounds this guard deliberately does not own.
 *  An unroutable `conversation_id` is refused by the ROUTING LOOKUP at the IPC arm, as it is for every
 *  conversation-routed verb. An over-length `system_prompt` is refused by the CONNECTION METHOD, which
 *  measures MAX_SYSTEM_PROMPT_BYTES of UTF-8 and emits a rejection the operator can see; putting that
 *  bound here would make it silent, since a guard rejection drops the command at the boundary and
 *  produces no outcome at all — the "thrown away" refusal the ticket forbids.
 *
 *  Both values are untrusted renderer input. `conversation_id` reaches exactly two sinks past here —
 *  `conversationRouter.route`, a read-only `Map` lookup, and the connection method's fresh literal —
 *  and `system_prompt` reaches exactly one, that same literal, on its way to `encodeEnvelope`. Neither
 *  is ever a log line, a path, an attribute or a cache key, and the prompt's LENGTH is not logged
 *  either. Structural minimum: an extra field is not rejected here, and cannot reach the wire because
 *  the connection method's rebuild bounds the frame to these two. Pure; never throws. */
function isSetSystemPromptPayload(value: unknown): value is SetSystemPromptPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('conversation_id' in value) || typeof value.conversation_id !== 'string') return false
  if (!('system_prompt' in value)) return false
  return typeof value.system_prompt === 'string' || value.system_prompt === null
}

/** The untrusted renderer→main boundary guard for the setConversationMuted payload (#1595). STRICT,
 *  unlike the structural-minimum siblings: the keys must be exactly `conversation_id` and `muted`, the id
 *  a non-empty string and `muted` a real boolean. A truthy `1` or `'true'` is refused rather than coerced,
 *  and so is an explicitly-undefined `muted`, which structured clone preserves across the bridge. The
 *  connection method still rebuilds a fresh two-field literal. Pure; never throws. */
function isSetConversationMutedPayload(value: unknown): value is SetConversationMutedPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 2 || !('conversation_id' in value) || !('muted' in value)) return false
  if (typeof value.conversation_id !== 'string' || value.conversation_id.length === 0) return false
  return value.muted === true || value.muted === false
}

/** The untrusted renderer→main boundary guard for the requestHistory payload (#1222). The guard above
 *  scaled from one field to the three the daemon publishes, all three present-and-typed, so a missing
 *  key, a literal `null` and a mistyped value are each rejected. All three are checked because all
 *  three are ALWAYS on the wire — the daemon declares no `omitempty` — so an absent one here is a
 *  caller bug rather than a shorthand.
 *
 *  CHECKS TYPE, NOT EMPTINESS, and here that is load-bearing on two fields rather than one. `''` is not
 *  merely tolerated for `cursor` — it is the NORMAL OPENING VALUE of every walk ("start at the
 *  newest"), so a non-empty clause would refuse the first ask of every scroll-back. For
 *  `conversation_id` it is the siblings' rule unchanged: an id the daemon cannot resolve draws
 *  `conversation.not_found`, which is the daemon's call rather than a bound this client duplicates.
 *  `newSession`'s emptiness clause is the one NOT to copy — that verb reads an empty id as "whichever
 *  conversation the daemon's process-wide cursor points at", and this one has no such fallback.
 *
 *  `limit` is checked for TYPE ONLY — no range, no integrality. A negative one is a documented reject
 *  (`history.invalid_page_size`) that `buildRequestHistory` normalises away before the wire anyway, and
 *  an upper bound here would be a second ceiling to keep in agreement with the daemon's own clamp.
 *
 *  The cursor is the one value on this channel this app did not mint — daemon-minted, round-tripping
 *  back out — and it is OPAQUE: never parsed here or anywhere, never a log line, path, attribute or
 *  cache key, and never treated as proving anything (it is deliberately unsigned; authorization is
 *  pairing). Past this guard the three reach exactly two sinks: `conversationRouter.route`, a read-only
 *  `Map` lookup on the id, and `buildRequestHistory`, which rebuilds a fresh three-key literal.
 *  Structural minimum: an extra field is not rejected here and cannot reach the wire, because that
 *  rebuild bounds the frame. Pure; never throws. */
function isRequestHistoryPayload(value: unknown): value is RequestHistoryPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'cursor' in value &&
    typeof value.cursor === 'string' &&
    'limit' in value &&
    typeof value.limit === 'number'
  )
}

/** The untrusted renderer→main boundary guard for the newSession payload (#1217). The
 *  `isRequestModelListPayload` guard above with one clause added — and that clause is the
 *  security-relevant line of the slice, so read the divergence before "aligning" this with its
 *  siblings.
 *
 *  THIS ONE CHECKS EMPTINESS, WHERE EVERY SIBLING DELIBERATELY DOES NOT. For them `''` is merely an id
 *  the daemon cannot resolve — a `conversation.not_found` error or a zero-valued reply, harmless
 *  either way, and policing it client-side would be a second bound to keep in agreement with the
 *  daemon's. On `new_session` an empty id is not an unresolvable id: the protocol makes no payload,
 *  `{}`, an absent id and an explicitly empty one ONE wire meaning — restart whichever conversation
 *  the daemon's process-wide follow-active cursor points at, a cursor only a routed `send_message`
 *  stamps and every connection shares. So a sender that read an id from a not-yet-loaded slice and
 *  passed `''` would kill a DIFFERENT conversation's claude, mid-work: the cross-conversation misfire
 *  pyrycode#2099 exists to close. Nothing else in this repo reddens on a relaxed clause — the frame
 *  compiles, typechecks and is silently accepted — which is why the refusal is stated here, at the
 *  untrusted boundary, and not left to `conversationRouter`, whose index happens to skip empty ids but
 *  whose contract is routing rather than payload validity.
 *
 *  A missing key, a literal `null`, an explicitly-undefined payload and a non-string are all rejected
 *  as in the siblings; a missing key for a STRONGER reason, since absent is the bare form here too.
 *  The value is client-owned (this app's own conversation state, not network input) and reaches
 *  exactly two sinks past here: `conversationRouter.route`, a read-only `Map` lookup against an index
 *  built from the daemon's own conversation lists, and `buildNewSession`, which rebuilds a fresh
 *  literal — never a log line, path, attribute, or cache key. Structural minimum: an extra field is
 *  not rejected here, and cannot reach the wire because that rebuild bounds the frame to the one id.
 *  Pure; never throws. */
/** The `interrupt` command's payload guard (#1092) — `isNewSessionPayload`'s clause for the twin verb.
 *
 *  `''` IS THE ONE THAT MATTERS, and the sibling's reasoning transfers word for word: the protocol
 *  makes no payload, `{}`, an absent id and an explicitly empty one ONE wire meaning — stop the turn
 *  in whichever conversation the daemon's process-wide follow-active cursor points at, a cursor only a
 *  routed `send_message` stamps and every connection shares. So a sender that read an id from a
 *  not-yet-loaded slice and passed `''` would stop a DIFFERENT conversation's turn: the
 *  cross-conversation misfire pyrycode#2103 exists to close, and the whole defect #1092 fixes. Nothing
 *  else in this repo reddens on a relaxed clause — the frame compiles, typechecks and is silently
 *  accepted — which is why the refusal is stated here, at the untrusted boundary, and not left to
 *  `conversationRouter`, whose index happens to skip empty ids but whose contract is routing rather
 *  than payload validity.
 *
 *  A missing key, a literal `null`, an explicitly-undefined payload and a non-string are all rejected
 *  as in the siblings; a missing key for a STRONGER reason, since absent is the bare form here too —
 *  and here that form is one every shipped build sent until this ticket, so the rejection is what
 *  turns a wrong-chat Stop into a Stop that does nothing.
 *
 *  NO LENGTH CAP, deliberately matching `isNewSessionPayload` exactly rather than diverging: two twin
 *  verbs with subtly different acceptance rules is the worse failure. It fails closed downstream
 *  regardless — an over-cap id makes `encodeEnvelope` throw and the connection method drops the send —
 *  and this path only READS `conversationRouter`'s index, so no renderer input can grow it.
 *
 *  The value is client-owned (this app's own conversation state, not network input) and reaches
 *  exactly two sinks past here: `conversationRouter.route`, a read-only `Map` lookup against an index
 *  built from the daemon's own conversation lists — a `Map` and never a `Record`, so an untrusted key
 *  has no prototype chain to reach — and `buildInterrupt`, which rebuilds a fresh literal. Never a log
 *  line, path, attribute, or cache key. Structural minimum: an extra field is not rejected here, and
 *  cannot reach the wire because that rebuild bounds the frame to the one id. Pure; never throws. */
function isInterruptPayload(value: unknown): value is InterruptCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    value.conversation_id.length > 0
  )
}

function isNewSessionPayload(value: unknown): value is NewSessionCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    value.conversation_id.length > 0
  )
}

function isDequeueMessagePayload(value: unknown): value is DequeueMessagePayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'queued_msg_id' in value &&
    typeof value.queued_msg_id === 'number'
  )
}

/** The sendQueuedNow boundary guard (#1726): the dequeue guard's structural minimum, field for field. */
function isSendQueuedNowPayload(value: unknown): value is SendQueuedNowPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'queued_msg_id' in value &&
    typeof value.queued_msg_id === 'number'
  )
}

/** The untrusted renderer→main boundary guard for the notify payload (#391). CRITICALLY UNLIKE every
 *  sibling is*Payload above — which check `typeof value.field === 'string'` and so accept ANY string —
 *  this guard tests CLOSED-SET MEMBERSHIP: `kind` must equal one of the two NotifyKind literals. This is
 *  the security-relevant line of the slice: a `typeof === 'string'` check here would let an arbitrary,
 *  possibly daemon-derived string pass the boundary and later map to no copy at all, defeating the
 *  by-construction guarantee that every kind has a static fallback body. A non-object, a
 *  missing `kind`, a non-string `kind`, and any string outside the set are all rejected.
 *
 *  The optional `name` (#1593) is one of two free-text fields, and it only ever becomes the title: it must be
 *  absent, `undefined`, or a string, and any other type fails the whole command closed. Its content is
 *  not judged here — main's notificationTitle drops control characters and bounds the length, because
 *  this side of the boundary is not trusted to have done so. The optional `preview` (#1737) is the second
 *  free-text field and becomes the body: it must be absent, `undefined`, or a string of at most
 *  MAX_NOTIFY_PREVIEW_LENGTH UTF-16 units, or the whole command fails closed; main's notificationBody
 *  cleans and caps its content. The optional `token` (#1597) must be
 *  absent, `undefined`, or pass isNotificationToken; anything else fails closed. Extra fields are ignored (structural
 *  minimum, consistent with the other guards). Pure; never throws. */
function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('kind' in value) || (value.kind !== 'turn-complete' && value.kind !== 'prompt')) return false
  if ('name' in value && value.name !== undefined && typeof value.name !== 'string') return false
  if (
    'preview' in value &&
    value.preview !== undefined &&
    (typeof value.preview !== 'string' || value.preview.length > MAX_NOTIFY_PREVIEW_LENGTH)
  ) {
    return false
  }
  // #1597: the token is opaque, so it is judged only on shape — bounded, never free text.
  return !('token' in value) || value.token === undefined || isNotificationToken(value.token)
}

/** The renderer→main guard for the badge count (#1592). The one value that crosses must be a count: a
 *  non-negative SAFE integer. `Number.isSafeInteger` refuses a non-number, NaN, both infinities, a
 *  fraction and a magnitude past 2^53 that no real count reaches, so `applyBadgeCount` only ever sees a
 *  bounded whole number. Extra fields are ignored, as in the sibling guards. Pure; never throws. */
function isBadgeCountPayload(value: unknown): value is BadgeCountPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'count' in value &&
    typeof value.count === 'number' &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
  )
}
