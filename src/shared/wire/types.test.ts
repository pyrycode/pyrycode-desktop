import { describe, it, expect } from 'vitest'
import { NOISE_PROTOCOL, PROTOCOL_VERSION, CAPABILITY_INTERACTIVE } from './types'
import type {
  EnvelopeType,
  DebugBundleChunkPayload,
  DebugBundleDonePayload,
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState,
  StallPayload,
  WireSessionTransitionReason,
  SessionTransitionPayload,
  ToolUsePayload,
  ToolResultPayload,
  WireModalClass,
  WireModalSource,
  WireModalOption,
  ModalShownPayload,
  ModalDismissedPayload,
  ModalAnswerPayload,
  ModalCancelPayload,
  CreateConversationPayload,
  ConversationCreatedPayload,
  PromoteConversationPayload,
  ConversationUpdatedPayload,
  QueuedItem,
  QueueStatePayload,
  DequeueMessagePayload
} from './types'

describe('wire protocol constants', () => {
  it('pins the Noise variant to the daemon contract', () => {
    expect(NOISE_PROTOCOL).toBe('Noise_IK_25519_ChaChaPoly_BLAKE2s')
  })

  it('defaults to protocol v2', () => {
    expect(PROTOCOL_VERSION).toBe('v2')
  })

  it('advertises the interactive capability', () => {
    expect(CAPABILITY_INTERACTIVE).toBe('interactive')
  })
})

describe('debug-bundle wire vocabulary (#116)', () => {
  it('admits the two streamed bundle envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const chunk: EnvelopeType = 'debug_bundle_chunk'
    const done: EnvelopeType = 'debug_bundle_done'
    expect(chunk).toBe('debug_bundle_chunk')
    expect(done).toBe('debug_bundle_done')
  })

  it('shapes DebugBundleChunkPayload as { seq, data } — data is base64-std on the wire', () => {
    // Mirrors the daemon golden fixture testdata/debug_bundle_chunk.json field-for-field.
    const payload: DebugBundleChunkPayload = { seq: 0, data: 'aGVsbG8sIGJ1bmRsZQ==' }
    expect(payload.seq).toBe(0)
    expect(payload.data).toBe('aGVsbG8sIGJ1bmRsZQ==')
  })

  it('shapes DebugBundleDonePayload as { total }', () => {
    const payload: DebugBundleDonePayload = { total: 4 }
    expect(payload.total).toBe(4)
  })
})

describe('structured-stream wire vocabulary (#199)', () => {
  it('admits the two interactive-stream inbound envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const delta: EnvelopeType = 'assistant_delta'
    const end: EnvelopeType = 'turn_end'
    expect(delta).toBe('assistant_delta')
    expect(end).toBe('turn_end')
  })

  it('shapes AssistantDeltaPayload as { conversation_id, turn_id, seq, text } (mobile field-for-field)', () => {
    const payload: AssistantDeltaPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      seq: 0,
      text: 'hello'
    }
    expect(payload).toEqual({ conversation_id: 'conv-1', turn_id: 'turn-1', seq: 0, text: 'hello' })
  })

  it('shapes TurnEndPayload as { conversation_id, turn_id, stop_reason }', () => {
    const payload: TurnEndPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      stop_reason: 'end_turn'
    }
    expect(payload).toEqual({ conversation_id: 'conv-1', turn_id: 'turn-1', stop_reason: 'end_turn' })
  })
})

describe('turn-state wire vocabulary (#214)', () => {
  it('admits the turn_state inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const state: EnvelopeType = 'turn_state'
    expect(state).toBe('turn_state')
  })

  it('shapes TurnStatePayload as { conversation_id, state } with state a closed wire enum', () => {
    const payload: TurnStatePayload = { conversation_id: 'conv-1', state: 'thinking' }
    expect(payload).toEqual({ conversation_id: 'conv-1', state: 'thinking' })
  })

  it('admits exactly the three WireTurnState values (mobile field-for-field, no named enum)', () => {
    const states: WireTurnState[] = ['thinking', 'responding', 'idle']
    expect(states).toEqual(['thinking', 'responding', 'idle'])
  })
})

describe('stall wire vocabulary (#315)', () => {
  it('admits the stall inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const stall: EnvelopeType = 'stall'
    expect(stall).toBe('stall')
  })

  it('shapes StallPayload as { conversation_id } only — no turn_id, no clear field', () => {
    const payload: StallPayload = { conversation_id: 'conv-1' }
    expect(payload).toEqual({ conversation_id: 'conv-1' })
  })
})

describe('session-transition wire vocabulary (#254)', () => {
  it('admits the session_transition inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const transition: EnvelopeType = 'session_transition'
    expect(transition).toBe('session_transition')
  })

  it('admits exactly the three WireSessionTransitionReason values (closed set incl. workspace_change)', () => {
    // The set stays exhaustive over workspace_change even though the producer (#657) emits only the
    // first two today — the consumer enum may admit a value the producer cannot yet emit (SSOT #656).
    const reasons: WireSessionTransitionReason[] = ['clear', 'idle_evict', 'workspace_change']
    expect(reasons).toEqual(['clear', 'idle_evict', 'workspace_change'])
  })

  it('shapes SessionTransitionPayload as its five fields with workspace_cwd nullable, no conversation_id', () => {
    const payload: SessionTransitionPayload = {
      previous_session_id: 'sess-1',
      new_session_id: 'sess-2',
      reason: 'clear',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: null
    }
    expect(payload).toEqual({
      previous_session_id: 'sess-1',
      new_session_id: 'sess-2',
      reason: 'clear',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: null
    })
    // No conversation_id — a session boundary is attributed by the connection it arrives on (SSOT #656).
    expect(payload).not.toHaveProperty('conversation_id')
    // workspace_cwd is a valid non-null path only for workspace_change.
    const moved: SessionTransitionPayload = {
      ...payload,
      reason: 'workspace_change',
      workspace_cwd: '/home/user/other'
    }
    expect(moved.workspace_cwd).toBe('/home/user/other')
  })
})

describe('tool-use wire vocabulary (#217)', () => {
  it('admits the tool_use inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const toolUse: EnvelopeType = 'tool_use'
    expect(toolUse).toBe('tool_use')
  })

  it('shapes ToolUsePayload as { conversation_id, turn_id, tool_use_id, name, input_summary } — all strings', () => {
    const payload: ToolUsePayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts'
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts'
    })
  })
})

describe('tool-result wire vocabulary (#229)', () => {
  it('admits the tool_result inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const toolResult: EnvelopeType = 'tool_result'
    expect(toolResult).toBe('tool_result')
  })

  it('shapes ToolResultPayload as { conversation_id, turn_id, tool_use_id, is_error, result_summary } — is_error a boolean', () => {
    const payload: ToolResultPayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      is_error: false,
      result_summary: 'read 12 lines'
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      is_error: false,
      result_summary: 'read 12 lines'
    })
    // is_error is a boolean whose false is a value (success), not an absence (the yolo #180 idiom).
    const failed: ToolResultPayload = { ...payload, is_error: true }
    expect(failed.is_error).toBe(true)
  })
})

describe('modal wire vocabulary (#201)', () => {
  it('admits the two inbound modal envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const shown: EnvelopeType = 'modal_shown'
    const dismissed: EnvelopeType = 'modal_dismissed'
    expect(shown).toBe('modal_shown')
    expect(dismissed).toBe('modal_dismissed')
  })

  it('admits exactly the two WireModalClass values — no destructive class (ADR 0009)', () => {
    const classes: WireModalClass[] = ['permission', 'trust']
    expect(classes).toEqual(['permission', 'trust'])
  })

  it('admits exactly the three WireModalSource values (closed set)', () => {
    const sources: WireModalSource[] = ['remote', 'local', 'timeout']
    expect(sources).toEqual(['remote', 'local', 'timeout'])
  })

  it('shapes WireModalOption as { id, label } — ordered by array position', () => {
    const option: WireModalOption = { id: 'allow', label: 'Allow' }
    expect(option).toEqual({ id: 'allow', label: 'Allow' })
  })

  it('shapes ModalShownPayload as { modal_id, class, title, prompt, ordered options, default_option_id }', () => {
    const payload: ModalShownPayload = {
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
    expect(payload).toEqual({
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
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('shapes ModalDismissedPayload as { modal_id, outcome, source } with source a closed wire enum', () => {
    const payload: ModalDismissedPayload = {
      modal_id: 'mdl-7f3a',
      outcome: 'allow',
      source: 'remote'
    }
    expect(payload).toEqual({ modal_id: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
  })
})

describe('outbound modal wire vocabulary (#235)', () => {
  it('admits the two outbound modal envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const answer: EnvelopeType = 'modal_answer'
    const cancel: EnvelopeType = 'modal_cancel'
    expect(answer).toBe('modal_answer')
    expect(cancel).toBe('modal_cancel')
  })

  it('shapes ModalAnswerPayload as { modal_id, option_id, answer_token } — single option_id', () => {
    const payload: ModalAnswerPayload = {
      modal_id: 'mdl-7f3a',
      option_id: 'allow',
      answer_token: 'tok-9c2e'
    }
    expect(payload).toEqual({
      modal_id: 'mdl-7f3a',
      option_id: 'allow',
      answer_token: 'tok-9c2e'
    })
    // A single option_id — NOT the stale ADR-025 multi-select option_ids[].
    expect(payload).not.toHaveProperty('option_ids')
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('shapes ModalCancelPayload as { modal_id } — the sole correlation key', () => {
    const payload: ModalCancelPayload = { modal_id: 'mdl-7f3a' }
    expect(payload).toEqual({ modal_id: 'mdl-7f3a' })
    // No conversation_id — modal_id is the sole correlation key (ADR 0009).
    expect(payload).not.toHaveProperty('conversation_id')
  })
})

describe('conversations-write wire vocabulary (#241)', () => {
  it('admits the create request + created reply envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const create: EnvelopeType = 'create_conversation'
    const created: EnvelopeType = 'conversation_created'
    expect(create).toBe('create_conversation')
    expect(created).toBe('conversation_created')
  })

  it('shapes CreateConversationPayload as { is_promoted, name, cwd } — all nullable-and-present', () => {
    // All three fields default server-side: a literal null (never absent) means "let the daemon
    // choose". They are T | null (present, nullable), NOT T | undefined (optional) — the daemon's
    // request struct uses *T without omitempty, so the key is always on the wire with an explicit null.
    const allNull: CreateConversationPayload = { is_promoted: null, name: null, cwd: null }
    expect(allNull).toEqual({ is_promoted: null, name: null, cwd: null })

    const populated: CreateConversationPayload = {
      is_promoted: true,
      name: 'design review',
      cwd: '/home/user/project'
    }
    expect(populated).toEqual({
      is_promoted: true,
      name: 'design review',
      cwd: '/home/user/project'
    })
  })

  it('shapes ConversationCreatedPayload as its OWN 5 fields — NOT a ConversationSummary (spec #274)', () => {
    // The daemon deliberately omits is_archived + last_message_ts on a create reply, so this is a
    // dedicated 5-field shape, not a reuse of the 7-field ConversationSummary. name is string | null.
    const payload: ConversationCreatedPayload = {
      id: 'conv-9',
      is_promoted: false,
      cwd: '/tmp/scratch',
      name: null,
      last_used_at: '2026-07-10T00:00:00Z'
    }
    expect(payload).toEqual({
      id: 'conv-9',
      is_promoted: false,
      cwd: '/tmp/scratch',
      name: null,
      last_used_at: '2026-07-10T00:00:00Z'
    })
    // The two fields the daemon excludes on a create reply are absent (no ConversationSummary reuse).
    expect(payload).not.toHaveProperty('is_archived')
    expect(payload).not.toHaveProperty('last_message_ts')

    // A populated name is an equally valid value (a named conversation).
    const named: ConversationCreatedPayload = { ...payload, name: 'design review' }
    expect(named.name).toBe('design review')
  })
})

describe('conversations-write promote/update wire vocabulary (#273)', () => {
  it('admits the promote request + updated reply envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType.
    const promote: EnvelopeType = 'promote_conversation'
    const updated: EnvelopeType = 'conversation_updated'
    expect(promote).toBe('promote_conversation')
    expect(updated).toBe('conversation_updated')
  })

  it('shapes PromoteConversationPayload as { conversation_id, name, cwd } — all REQUIRED strings', () => {
    // The deliberate OPPOSITE of CreateConversationPayload's nullable-and-present fields: a promoted
    // conversation MUST carry a real name and cwd, and the id MUST resolve to an existing row, so the
    // daemon struct uses value-strings (no pointers, no omitempty). All three are plain `string`.
    const payload: PromoteConversationPayload = {
      conversation_id: 'conv-9',
      name: 'weekly sync',
      cwd: '/home/user/project'
    }
    expect(payload).toEqual({
      conversation_id: 'conv-9',
      name: 'weekly sync',
      cwd: '/home/user/project'
    })
    // Declared field order (no-drift): conversation_id, name, cwd.
    expect(Object.keys(payload)).toEqual(['conversation_id', 'name', 'cwd'])
  })

  it('shapes ConversationUpdatedPayload as { id, is_promoted, name, cwd, last_used_at } — name BEFORE cwd', () => {
    // The reply's own 5-field shape. `name` is `string | null` (a literal null, never absent — the
    // daemon uses *string WITHOUT omitempty), exactly like ConversationSummary.name. Field order
    // deliberately places `name` before `cwd` (spec #274), unlike ConversationCreatedPayload.
    const payload: ConversationUpdatedPayload = {
      id: 'conv-9',
      is_promoted: true,
      name: null,
      cwd: '/home/user/project',
      last_used_at: '2026-07-10T00:00:00Z'
    }
    expect(payload).toEqual({
      id: 'conv-9',
      is_promoted: true,
      name: null,
      cwd: '/home/user/project',
      last_used_at: '2026-07-10T00:00:00Z'
    })
    // Pin the no-drift wire order: name comes before cwd (the intentional reordering vs. created).
    expect(Object.keys(payload)).toEqual(['id', 'is_promoted', 'name', 'cwd', 'last_used_at'])

    // A populated name is an equally valid value (a named channel).
    const named: ConversationUpdatedPayload = { ...payload, name: 'weekly sync' }
    expect(named.name).toBe('weekly sync')
  })
})

describe('queue-state wire vocabulary (#292)', () => {
  it('admits the queue_state inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const queueState: EnvelopeType = 'queue_state'
    expect(queueState).toBe('queue_state')
  })

  it('shapes QueuedItem as { queued_msg_id, text, ts } — queued_msg_id a number', () => {
    const item: QueuedItem = { queued_msg_id: 1, text: 'hello there', ts: '2026-07-10T00:00:00Z' }
    expect(item).toEqual({ queued_msg_id: 1, text: 'hello there', ts: '2026-07-10T00:00:00Z' })
  })

  it('shapes QueueStatePayload as { conversation_id, queued } — an ordered two-item backlog', () => {
    // Mirrors the daemon SSOT (pyrycode #720) field-for-field. `queued` is always present and
    // enqueue-ordered; each item carries queued_msg_id (a number) / text / ts.
    const payload: QueueStatePayload = {
      conversation_id: 'conv-1',
      queued: [
        { queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' },
        { queued_msg_id: 2, text: 'second', ts: '2026-07-10T00:00:01Z' }
      ]
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      queued: [
        { queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' },
        { queued_msg_id: 2, text: 'second', ts: '2026-07-10T00:00:01Z' }
      ]
    })
  })

  it('admits an empty queued array as a valid zero-length backlog (never null, never absent)', () => {
    const empty: QueueStatePayload = { conversation_id: 'conv-1', queued: [] }
    expect(empty.queued).toEqual([])
  })

  it('pins queued_msg_id as a number — a JSON string is a compile-time type error', () => {
    // The compile-time no-drift pin: the counter MUST be a number, never a string (AC1). A `'1'`
    // literal here is a TS2322 the @ts-expect-error absorbs — if the field were ever relaxed to
    // `string`, this line would stop erroring and fail the test at compile time.
    // @ts-expect-error queued_msg_id is number, not string
    const wrong: QueuedItem = { queued_msg_id: '1', text: 'x', ts: 't' }
    expect(wrong.text).toBe('x')
  })
})

describe('dequeue-message wire vocabulary (#299)', () => {
  it('admits the dequeue_message outbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const dequeue: EnvelopeType = 'dequeue_message'
    expect(dequeue).toBe('dequeue_message')
  })

  it('shapes DequeueMessagePayload as { conversation_id, queued_msg_id } in wire order', () => {
    // Mirrors the daemon SSOT (pyrycode #720) field-for-field, wire order conversation_id then
    // queued_msg_id — both always present. queued_msg_id selects the queue entry the daemon's
    // msgqueue.Remove deletes; it is symmetric with the inbound QueuedItem.queued_msg_id (a number).
    const payload: DequeueMessagePayload = { conversation_id: 'conv-1', queued_msg_id: 7 }
    expect(payload).toEqual({ conversation_id: 'conv-1', queued_msg_id: 7 })
    expect(Object.keys(payload)).toEqual(['conversation_id', 'queued_msg_id'])
  })

  it('pins queued_msg_id as a number — a JSON string is a compile-time type error', () => {
    // The compile-time no-drift pin symmetric with QueuedItem's: the outbound counter MUST be a
    // number, never a string. A `'7'` literal here is a TS2322 the @ts-expect-error absorbs — if the
    // field were ever relaxed to `string`, this line would stop erroring and fail at compile time.
    // @ts-expect-error queued_msg_id is number, not string
    const wrong: DequeueMessagePayload = { conversation_id: 'conv-1', queued_msg_id: '7' }
    expect(wrong.conversation_id).toBe('conv-1')
  })
})
