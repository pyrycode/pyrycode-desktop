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
  CreateWorkspaceFolderPayload,
  SetSessionSettingsPayload,
  DequeueMessagePayload,
  QuestionAnswerPayload,
  QuestionRefusedPayload
} from '../wire/types'

/**
 * The fields the renderer supplies to resolve a modal with an answer (#236): the `modal_id` +
 * chosen `option_id`, DERIVED from the wire `ModalAnswerPayload` with `answer_token` excluded —
 * `Omit` ties the field names to the wire contract while making the token-exclusion a compile-time
 * guarantee (AC1: no member carries a token). The `answer_token` is minted MAIN-side by
 * daemonConnection.answerModal, exactly as `sendMessageCommand` leaves `message_id` minting to the
 * main-side composer.
 */
export type AnswerModalCommandPayload = Omit<ModalAnswerPayload, 'answer_token'>

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
 * enum, NEVER free text: the main process owns the copy table that maps each kind to a static
 * title/body, so it is impossible by construction for daemon-relayed content (a permission-prompt
 * title, an assistant message, a workspace path) to ride into an OS notification. Add a kind here
 * only alongside its copy in fireNotification's NOTIFICATION_COPY (a Record<NotifyKind, …>, so a
 * new member won't type-check until it has copy).
 */
export type NotifyKind = 'turn-complete' | 'prompt'

/**
 * The `notify` command payload (#391). Defined HERE, not imported from ../wire/types — unlike every
 * other payload-bearing member, this command is a MAIN-LOCAL side-effect that never reaches the
 * transport, so its type is client-internal (like the derived AnswerModalCommandPayload above). It
 * carries only the closed `kind` enum — no title/body free text, no conversation id, no secret.
 */
export interface NotifyPayload {
  kind: NotifyKind
}

/** The IPC channel every typed renderer command travels on, renderer → main.
 *  Single source of truth: the preload sender ships on it, the main receiver listens on it.
 *  A mismatch would silently drop every command, so both sides reference this constant. */
export const COMMAND_CHANNEL = 'pyry:command' as const

/**
 * A single typed command from the renderer window to the background process. Sealed
 * discriminated union on `type`. Ten members today: `sendMessage`, whose `payload` reuses the
 * wire SendMessagePayload verbatim so no field is remapped between layers; the bare
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
 * daemon replies with one `workspace_folder_created { path }` → `workspaceFolderCreated` event); and `setSessionSettings` (#263), whose `payload` reuses the wire
 * SetSessionSettingsPayload (`session_id` + optional-absent `model`/`effort`/`yolo` — the omitempty
 * presence contract is applied main-side by the builder, not carried here) and additionally carries a
 * `changeId` (#261): a renderer-minted, client-internal correlation string riding ALONGSIDE `payload` (a
 * top-level sibling, NEVER a field inside the wire payload — the builder consumes only `payload`, so the
 * key stays off the wire, mirroring how the composer mints `message_id` main-side). `changeId` is an
 * opaque correlation key, never a token/key/raw frame and never serialized onto the wire; and
 * `dequeueMessage` (#300), whose `payload` reuses the wire DequeueMessagePayload verbatim
 * (`conversation_id` + `queued_msg_id`) to ask the daemon to drop one queued message — ungated (#720),
 * so the payload carries NO token (no `Omit`-derivative, unlike `answerModal`); and the bare `interrupt`
 * (#306), which carries NO payload — it stops the running turn (a fire-and-forget bare control frame the
 * daemon maps to a single claude Esc; daemon SSOT pyrycode #707); and `notify` (#391), whose `payload`
 * is NotifyPayload — the sole member whose payload type is defined in THIS file, not imported from
 * ../wire/types, because it is a MAIN-LOCAL side-effect command that never reaches the transport. It
 * carries only the closed `kind` enum (`turn-complete` | `prompt`) — no free-text title/body, no id, no
 * secret — which main maps to a static copy table to raise an OS notification when the window is unfocused.
 * and `answerQuestions` / `refuseQuestions` (#920), the question vertical's resolution pair, whose payloads
 * are AnswerQuestionsCommandPayload (`question_batch_id` + the ordered `answers` entries) and
 * RefuseQuestionsCommandPayload (`question_batch_id` alone) — BOTH `Omit`-derivatives, because unlike the
 * modal pair BOTH question frames carry `answer_token` on the wire, so both mints are main-side
 * (daemonConnection.answerQuestions / refuseQuestions). `answerQuestions` is the union's only STRUCTURED
 * payload (an array of `{ question_index, values }` objects rather than a flat scalar row), which is why
 * its guard recurses where every sibling checks one level.
 * No member
 * exposes a field that could hold a token, key, or raw frame (AC5) — the payload-bearing ones reuse only
 * wire types (or a token-excluded derivative), the bare ones carry nothing.
 *
 * Extend additively (connect/disconnect) when their transport tickets land — and add a
 * matching case to isRendererCommand in lockstep, or the new member is silently dropped at
 * the boundary.
 */
export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'requestDebugBundle' }
  | { type: 'requestSessionSettings' }
  | { type: 'requestConversations' }
  | { type: 'requestRecentWorkspaces' }
  | { type: 'answerModal'; payload: AnswerModalCommandPayload }
  | { type: 'cancelModal'; payload: ModalCancelPayload }
  | { type: 'answerQuestions'; payload: AnswerQuestionsCommandPayload }
  | { type: 'refuseQuestions'; payload: RefuseQuestionsCommandPayload }
  | { type: 'createConversation'; payload: CreateConversationPayload }
  | { type: 'promoteConversation'; payload: PromoteConversationPayload }
  | { type: 'archiveConversation'; payload: ArchiveConversationPayload }
  | { type: 'unarchiveConversation'; payload: UnarchiveConversationPayload }
  | { type: 'deleteConversation'; payload: DeleteConversationPayload }
  | { type: 'renameConversation'; payload: RenameConversationPayload }
  | { type: 'changeWorkspace'; payload: ChangeWorkspacePayload }
  | { type: 'createWorkspaceFolder'; payload: CreateWorkspaceFolderPayload }
  | { type: 'setSessionSettings'; payload: SetSessionSettingsPayload; changeId: string }
  | { type: 'dequeueMessage'; payload: DequeueMessagePayload }
  | { type: 'interrupt' }
  | { type: 'notify'; payload: NotifyPayload }

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
 * Construct the bare `interrupt` command (#306) — asks the background process to stop the running
 * turn. Pure and zero-arg: the frame carries NO payload (no token, no conversation selector — the
 * daemon maps it to a single claude Esc, daemon SSOT pyrycode #707), so there is nothing to wrap. The
 * twin of a bare `requestConversations` constructor, not the payload-bearing `dequeueMessageCommand`.
 * The RendererCommand return type is the compile-time guarantee (AC4). Its caller is the render
 * affordance in #307.
 */
export function interruptCommand(): RendererCommand {
  return { type: 'interrupt' }
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
      // Bare member: no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'requestSessionSettings':
      // Bare member (#491): no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'requestConversations':
      // Bare member (#139): no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'requestRecentWorkspaces':
      // Bare member (#380): no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'answerModal':
      return 'payload' in value && isAnswerModalPayload(value.payload)
    case 'cancelModal':
      return 'payload' in value && isCancelModalPayload(value.payload)
    case 'answerQuestions':
      return 'payload' in value && isAnswerQuestionsPayload(value.payload)
    case 'refuseQuestions':
      return 'payload' in value && isRefuseQuestionsPayload(value.payload)
    case 'createConversation':
      return 'payload' in value && isCreateConversationPayload(value.payload)
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
    case 'createWorkspaceFolder':
      return 'payload' in value && isCreateWorkspaceFolderPayload(value.payload)
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
    case 'interrupt':
      // Bare member (#306): no payload to validate, so a well-formed `type` is complete acceptance.
      return true
    case 'notify':
      return 'payload' in value && isNotifyPayload(value.payload)
    default:
      return false
  }
}

function isSendMessagePayload(value: unknown): value is SendMessagePayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'conversation_id' in value &&
    typeof value.conversation_id === 'string' &&
    'message_id' in value &&
    typeof value.message_id === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  )
}

/** The untrusted renderer→main boundary guard for the answerModal payload (#236) — the modal
 *  resolution's boundary check (why the command half is security-sensitive). Mirrors
 *  isSendMessagePayload: `modal_id` AND `option_id` string. Structural minimum — a smuggled
 *  `answer_token` is not rejected here (the main-side sender's fresh-literal construction ignores
 *  it), so this guard need not know about the token. Pure; never throws. */
function isAnswerModalPayload(value: unknown): value is AnswerModalCommandPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'modal_id' in value &&
    typeof value.modal_id === 'string' &&
    'option_id' in value &&
    typeof value.option_id === 'string'
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
 *  the wire to exactly these three fields. Pure; never throws. */
function isCreateConversationPayload(value: unknown): value is CreateConversationPayload {
  if (typeof value !== 'object' || value === null) return false
  return (
    'is_promoted' in value &&
    (typeof value.is_promoted === 'boolean' || value.is_promoted === null) &&
    'name' in value &&
    (typeof value.name === 'string' || value.name === null) &&
    'cwd' in value &&
    (typeof value.cwd === 'string' || value.cwd === null)
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

/** The untrusted renderer→main boundary guard for the setSessionSettings payload (#263) — the reason
 *  the command half is security-sensitive. Validates SHAPE, mirroring isCreateConversationPayload's
 *  per-field type checks but for OPTIONAL-ABSENT rather than nullable-present fields: `session_id` must
 *  be present-and-string; each of `model` / `effort` / `yolo`, WHEN PRESENT (`in` check), must be the
 *  right type (`string` / `string` / `boolean`) — a present zero value (`''` / `false`) passes, an
 *  ABSENT optional is accepted ("leave unchanged"). The omitempty presence contract itself lives in the
 *  main-side builder, not here; this guard only bounds the shape. Structural minimum — a smuggled extra
 *  field is not rejected here (the builder's fresh literal bounds the wire to the four modeled keys).
 *  Pure; never throws. */
function isSetSessionSettingsPayload(value: unknown): value is SetSessionSettingsPayload {
  if (typeof value !== 'object' || value === null) return false
  if (!('session_id' in value) || typeof value.session_id !== 'string') return false
  if ('model' in value && typeof value.model !== 'string') return false
  if ('effort' in value && typeof value.effort !== 'string') return false
  if ('yolo' in value && typeof value.yolo !== 'boolean') return false
  return true
}

/** The untrusted renderer→main boundary guard for the dequeueMessage payload (#300) — the reason the
 *  command half is security-sensitive. Mirrors isSendMessagePayload's present-and-string idiom with a
 *  present-and-NUMBER check for `queued_msg_id`: a `typeof` check only, NO integer/positive/range check,
 *  matching the requireNumber-alone posture of the #292 decode guard (a plain per-conversation integer
 *  no layer polices; an out-of-range id is a daemon-side no-op). Structural minimum — a smuggled extra
 *  field is not rejected here; the main-side sender's fresh-literal construction bounds the wire to
 *  exactly these two fields. Pure; never throws. */
function isDequeueMessagePayload(value: unknown): value is DequeueMessagePayload {
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
 *  by-construction guarantee that no free text can ride into an OS notification. A non-object, a missing
 *  `kind`, a non-string `kind`, and any string outside the set are all rejected. Extra fields are ignored
 *  (structural minimum, consistent with the other guards). Pure; never throws. */
function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== 'object' || value === null) return false
  return 'kind' in value && (value.kind === 'turn-complete' || value.kind === 'prompt')
}
