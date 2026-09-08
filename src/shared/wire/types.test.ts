import { describe, it, expect } from 'vitest'
import {
  NOISE_PROTOCOL,
  PROTOCOL_VERSION,
  CAPABILITY_INTERACTIVE,
  ATTACHMENT_CHUNK_DATA_BYTES,
  ATTACHMENT_ID_MAX_BYTES,
  ATTACHMENT_FILENAME_MAX_BYTES,
  ATTACHMENT_MIME_TYPE_MAX_BYTES
} from './types'
import type {
  EnvelopeType,
  WorkspaceUpdatedPayload,
  DebugBundleChunkPayload,
  DebugBundleDonePayload,
  AssistantDeltaPayload,
  TurnEndPayload,
  TurnStatePayload,
  WireTurnState,
  StallPayload,
  ApiRetryPayload,
  CompactingPayload,
  BackgroundTaskStartedPayload,
  BackgroundTaskUpdatedPayload,
  BackgroundTask,
  BackgroundTaskRosterPayload,
  ModelAnnouncedPayload,
  ThinkingProgressPayload,
  RateLimitedPayload,
  WireUnrecognizedSite,
  UnrecognizedMessagePayload,
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
  DequeueMessagePayload,
  InterruptPayload,
  NewSessionPayload,
  AttachmentChunkPayload,
  AttachmentStoredPayload,
  RequestAttachmentPayload,
  WireQuestionOption,
  WireQuestion,
  QuestionShownPayload,
  QuestionDismissedPayload,
  QuestionAnswerEntry,
  QuestionAnswerPayload,
  QuestionRefusedPayload,
  WireSlashCommand,
  SlashCommandListPayload,
  WireModelOption,
  ModelListPayload
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

describe('api-retry wire vocabulary (#492)', () => {
  it('admits the api_retry inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const apiRetry: EnvelopeType = 'api_retry'
    expect(apiRetry).toBe('api_retry')
  })

  it('shapes ApiRetryPayload as its four fields — the edge plus the counter, no turn_id', () => {
    const payload: ApiRetryPayload = {
      conversation_id: 'c1',
      active: true,
      current: 3,
      total: 10
    }
    expect(payload).toEqual({ conversation_id: 'c1', active: true, current: 3, total: 10 })
  })

  it('admits the falling edge and the 0/0 "count unknown" state (both legitimate wire values)', () => {
    const falling: ApiRetryPayload = {
      conversation_id: 'c1',
      active: false,
      current: 3,
      total: 10
    }
    const unknownCount: ApiRetryPayload = {
      conversation_id: 'c1',
      active: true,
      current: 0,
      total: 0
    }
    expect(falling.active).toBe(false)
    expect([unknownCount.current, unknownCount.total]).toEqual([0, 0])
  })
})

describe('compacting wire vocabulary (#495)', () => {
  it('admits the compacting inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const compacting: EnvelopeType = 'compacting'
    expect(compacting).toBe('compacting')
  })

  it('shapes CompactingPayload as its two fields — banner-only, no counter and no turn_id', () => {
    const payload: CompactingPayload = {
      conversation_id: 'c1',
      active: true
    }
    expect(payload).toEqual({ conversation_id: 'c1', active: true })
  })

  it('admits the explicit falling edge — active false is a wire VALUE, not an absence', () => {
    const falling: CompactingPayload = {
      conversation_id: 'c1',
      active: false
    }
    expect(falling.active).toBe(false)
  })
})

describe('thinking-progress wire vocabulary (#1312)', () => {
  it('admits the thinking_progress inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const thinking: EnvelopeType = 'thinking_progress'
    expect(thinking).toBe('thinking_progress')
  })

  it('shapes ThinkingProgressPayload as its three fields — no turn_id, no truncated_fields', () => {
    // The cut list's absence is the daemon's decision, not an omission: this payload carries no
    // claude-authored text at all, so nothing is ever cut and a permanently-null field would claim
    // a bound that does not exist.
    const payload: ThinkingProgressPayload = {
      conversation_id: 'c1',
      estimated_tokens: 184,
      estimated_tokens_delta: 67
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      estimated_tokens: 184,
      estimated_tokens_delta: 67
    })
  })

  it('admits the all-zero reading — neither Go field carries omitempty, so it is real traffic', () => {
    const zero: ThinkingProgressPayload = {
      conversation_id: 'c1',
      estimated_tokens: 0,
      estimated_tokens_delta: 0
    }
    expect([zero.estimated_tokens, zero.estimated_tokens_delta]).toEqual([0, 0])
  })

  it('admits a reading LOWER than the one before it — the value is not monotonic across a turn', () => {
    // `estimated_tokens` restarts near zero at every inference-request boundary, which happens
    // repeatedly inside one turn (four restarts in the daemon's committed capture). The pair below
    // is ordinary traffic, which is why nothing on this wire may subtract two readings.
    const first: ThinkingProgressPayload = {
      conversation_id: 'c1',
      estimated_tokens: 184,
      estimated_tokens_delta: 67
    }
    const afterRestart: ThinkingProgressPayload = {
      conversation_id: 'c1',
      estimated_tokens: 4,
      estimated_tokens_delta: 4
    }
    expect(afterRestart.estimated_tokens).toBeLessThan(first.estimated_tokens)
  })
})

describe('rate-limited wire vocabulary (#1318)', () => {
  it('admits the rate_limited inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const limited: EnvelopeType = 'rate_limited'
    expect(limited).toBe('rate_limited')
  })

  it('shapes RateLimitedPayload as its five fields — no turn_id, and no utilization', () => {
    // `utilization` is NOT on the wire. Declaring a sixth field would drift the wire types ahead of
    // the daemon, which CLAUDE.md forbids.
    const payload: RateLimitedPayload = {
      conversation_id: 'c1',
      status: 'allowed_warning',
      limit_type: 'seven_day',
      resets_at: 1_756_000_000,
      truncated_fields: null
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      status: 'allowed_warning',
      limit_type: 'seven_day',
      resets_at: 1_756_000_000,
      truncated_fields: null
    })
    // Conversation-scoped: a usage-limit window is orthogonal to whichever turn observed it, so
    // attributing it to one would be a claim the daemon cannot honestly make.
    expect(payload).not.toHaveProperty('turn_id')
  })

  it('admits truncated_fields null AND [] as different facts — "nothing was cut" is not "empty"', () => {
    // The Go type has no MarshalJSON, so nil reaches the wire as a literal `null`. That is
    // BackgroundTask.truncated_fields's nullability, and NOT BackgroundTaskRosterPayload.tasks's
    // nil→[] normalisation, which means the opposite. Both spellings are expressible here.
    const nothingCut: RateLimitedPayload = {
      conversation_id: 'c1',
      status: 'allowed_warning',
      limit_type: 'seven_day',
      resets_at: 1_756_000_000,
      truncated_fields: null
    }
    const cut: RateLimitedPayload = { ...nothingCut, truncated_fields: ['status', 'limit_type'] }
    expect(nothingCut.truncated_fields).toBeNull()
    expect(cut.truncated_fields).toEqual(['status', 'limit_type'])
  })

  it('admits an EMPTY status and a resets_at of 0 — a cut-to-nothing value and a not-reported one', () => {
    // Neither field carries `omitempty`, so both are real traffic rather than absences: the producer
    // can cut `status` to nothing, and `0` means claude did not report a reset instant — NOT the epoch.
    const unreported: RateLimitedPayload = {
      conversation_id: 'c1',
      status: '',
      limit_type: '',
      resets_at: 0,
      truncated_fields: ['status', 'limit_type']
    }
    expect([unreported.status, unreported.resets_at]).toEqual(['', 0])
  })

  it("admits a resets_at in the PAST — claude's number, unvalidated in both directions", () => {
    // A consumer must not assume the instant lies in the future, or in a sane range at all.
    // Formatting it as a date without a range check is the daemon's named realistic client bug.
    const stale: RateLimitedPayload = {
      conversation_id: 'c1',
      status: 'allowed_warning',
      limit_type: 'five_hour',
      resets_at: -1,
      truncated_fields: null
    }
    expect(stale.resets_at).toBeLessThan(0)
  })
})

describe('background-task-started wire vocabulary (#564)', () => {
  it('admits the background_task_started inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const started: EnvelopeType = 'background_task_started'
    expect(started).toBe('background_task_started')
  })

  it('shapes BackgroundTaskStartedPayload as its six fields — no turn_id', () => {
    const payload: BackgroundTaskStartedPayload = {
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      tool_call_id: 'toolu_01XYZ',
      description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
      task_type: 'local_bash',
      truncated_fields: ['description']
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      tool_call_id: 'toolu_01XYZ',
      description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
      task_type: 'local_bash',
      truncated_fields: ['description']
    })
    // No turn_id: a background task outlives the turn that spawned it, so it is not turn-scoped.
    expect(payload).not.toHaveProperty('turn_id')
  })

  it('admits truncated_fields null — "nothing was cut", a wire VALUE distinct from []', () => {
    const nothingCut: BackgroundTaskStartedPayload = {
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      tool_call_id: 'toolu_01XYZ',
      description: 'sleep 60',
      task_type: 'local_bash',
      truncated_fields: null
    }
    expect(nothingCut.truncated_fields).toBeNull()
  })
})

describe('background-task-updated wire vocabulary (#565)', () => {
  it('admits the background_task_updated inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const updated: EnvelopeType = 'background_task_updated'
    expect(updated).toBe('background_task_updated')
  })

  it('shapes BackgroundTaskUpdatedPayload as its FOUR fields — the sibling minus three', () => {
    // The daemon's canonical fixture verbatim: `patch` is cut mid-token and is therefore not valid
    // JSON, which is exactly why it is typed as a plain string here and never as nested JSON.
    const payload: BackgroundTaskUpdatedPayload = {
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      patch: '{"is_backgrounded":tr',
      truncated_fields: ['patch']
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      patch: '{"is_backgrounded":tr',
      truncated_fields: ['patch']
    })
    // No turn_id: like its sibling, the frame opens and closes no turn.
    expect(payload).not.toHaveProperty('turn_id')
    // The three fields the SIBLING carries and this frame must NOT: cloning #564 means DELETING them,
    // and a leftover would compile at four of the seven touch-points, so it is pinned at the type.
    expect(payload).not.toHaveProperty('tool_call_id')
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('task_type')
  })

  it('admits an EMPTY patch — claude sent no change, a wire VALUE and not an absence', () => {
    const noChange: BackgroundTaskUpdatedPayload = {
      conversation_id: 'c1',
      task_id: 'task_01ABC',
      patch: '',
      truncated_fields: null
    }
    expect(noChange.patch).toBe('')
    // `null` means NOTHING WAS CUT, distinct from [].
    expect(noChange.truncated_fields).toBeNull()
  })
})

describe('background-task-roster wire vocabulary (#566)', () => {
  it('admits the background_task_roster inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const roster: EnvelopeType = 'background_task_roster'
    expect(roster).toBe('background_task_roster')
  })

  it('shapes BackgroundTaskRosterPayload as its THREE fields, tasks a PLAIN non-optional array', () => {
    // The daemon's canonical fixture verbatim (internal/protocol/testdata/background_task_roster.json):
    // two rows whose `truncated_fields` shapes DIFFER, and a non-zero dropped_tasks.
    const payload: BackgroundTaskRosterPayload = {
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
    expect(payload.tasks).toHaveLength(2)
    expect(payload.dropped_tasks).toBe(3)
    // No turn_id: like both siblings, the frame opens and closes no turn.
    expect(payload).not.toHaveProperty('turn_id')
    // No TOP-LEVEL truncated_fields — deliberately absent (the trap-3 pin). `dropped_tasks` is this
    // frame's only truncation report, so the roster's true size is tasks.length + dropped_tasks.
    expect(payload).not.toHaveProperty('truncated_fields')
    expect(payload.tasks.length + payload.dropped_tasks).toBe(5)
  })

  it('shapes BackgroundTask as its FOUR fields — NOT the scalar siblings four', () => {
    const row: BackgroundTask = {
      task_id: 'task_01ABC',
      task_type: 'local_bash',
      description: "grep -rn 'a<b&c' .",
      truncated_fields: ['description']
    }
    expect(row).toEqual({
      task_id: 'task_01ABC',
      task_type: 'local_bash',
      description: "grep -rn 'a<b&c' .",
      truncated_fields: ['description']
    })
    // The two fields the SCALAR frames carry because their LINES do, and this row must never have.
    // A row narrower cloned from parseBackgroundTaskStartedPayload would require `tool_call_id` and
    // fail-close every valid roster, so the absence is pinned at the type.
    expect(row).not.toHaveProperty('tool_call_id')
    expect(row).not.toHaveProperty('patch')
  })

  it('admits an EMPTY tasks array — the positive statement that NOTHING IS ALIVE', () => {
    // The daemon's second golden fixture (background_task_roster_empty.json). An empty roster is a
    // signal, not an absence of information: the reassurance that a turn really is finished.
    const nothingAlive: BackgroundTaskRosterPayload = {
      conversation_id: 'c1',
      tasks: [],
      dropped_tasks: 0
    }
    expect(nothingAlive.tasks).toEqual([])
    // 0 is a VALUE, never consulted for truthiness.
    expect(nothingAlive.dropped_tasks).toBe(0)
  })

  it('takes a row truncated_fields of null while tasks stays a plain array — the two contracts', () => {
    // THE TRAP, at the type level: within this one payload a row's `truncated_fields` is nullable
    // (nil and [] say the identical thing there) while `tasks` is not (the daemon's only custom
    // MarshalJSON normalises a nil Tasks to [], so an empty roster never serialises as null).
    const nothingCut: BackgroundTask = {
      task_id: 'task_02DEF',
      task_type: 'local_bash',
      description: 'sleep 300',
      truncated_fields: null
    }
    expect(nothingCut.truncated_fields).toBeNull()
    // `tasks` admits no null: a consumer never branches on it, which is AC2's whole point.
    const roster: BackgroundTaskRosterPayload = {
      conversation_id: 'c1',
      tasks: [nothingCut],
      dropped_tasks: 0
    }
    expect(roster.tasks[0].truncated_fields).toBeNull()
  })
})

describe('model-announced wire vocabulary (#587)', () => {
  it('admits the model_announced inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const announced: EnvelopeType = 'model_announced'
    expect(announced).toBe('model_announced')
  })

  it('shapes ModelAnnouncedPayload as its three fields — no turn_id, no counter', () => {
    const payload: ModelAnnouncedPayload = {
      conversation_id: 'c1',
      model: 'claude-haiku-4-5-20251001',
      truncated: true
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      model: 'claude-haiku-4-5-20251001',
      truncated: true
    })
  })

  it('admits truncated false as a wire VALUE, not an absence — the field is never optional', () => {
    // The daemon's own zero fixture (model_announced_zero.json) round-trips all three fields present,
    // so `false` is what "nothing was cut" looks like on the wire — never a missing key.
    const notCut: ModelAnnouncedPayload = {
      conversation_id: '',
      model: '',
      truncated: false
    }
    expect(notCut.truncated).toBe(false)
  })

  it('admits an identifier in no published list — the type imposes no shape beyond `string`', () => {
    // claude echoes an identifier at least as specific as the one it was given: requesting
    // `claude-haiku-4-5` yields it back undated, which appears in no published model list. A lookup
    // miss is ORDINARY, so nothing here narrows `model` to a dated pattern or a closed set.
    const undated: ModelAnnouncedPayload = {
      conversation_id: 'c1',
      model: 'claude-haiku-4-5',
      truncated: false
    }
    expect(undated.model).toBe('claude-haiku-4-5')
  })
})

describe('unrecognized-message wire vocabulary', () => {
  it('admits the unrecognized_message inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const unrecognized: EnvelopeType = 'unrecognized_message'
    expect(unrecognized).toBe('unrecognized_message')
  })

  it('shapes UnrecognizedMessagePayload as its five fields — no turn_id', () => {
    const payload: UnrecognizedMessagePayload = {
      conversation_id: 'c1',
      site: 'line_type',
      message_type: 'some_future_event',
      raw: '{"type":"some_future_event"}',
      truncated: false
    }
    expect(payload).toEqual({
      conversation_id: 'c1',
      site: 'line_type',
      message_type: 'some_future_event',
      raw: '{"type":"some_future_event"}',
      truncated: false
    })
    // No turn_id: the daemon could not parse the message well enough to attribute a turn to it.
    expect(payload).not.toHaveProperty('turn_id')
  })

  it('closes the site enum over exactly the four drop sites', () => {
    const sites: WireUnrecognizedSite[] = [
      'line_type',
      'assistant_block',
      'user_block',
      'undecodable'
    ]
    expect(sites).toHaveLength(4)
  })

  it('admits an empty message_type — the undecodable site read no type at all', () => {
    const undecodable: UnrecognizedMessagePayload = {
      conversation_id: 'c1',
      site: 'undecodable',
      message_type: '',
      raw: '{"type":"assist',
      truncated: false
    }
    expect(undecodable.message_type).toBe('')
  })

  it('carries raw as a plain string, since a truncated blob is no longer valid JSON', () => {
    const cut: UnrecognizedMessagePayload = {
      conversation_id: 'c1',
      site: 'line_type',
      message_type: 'huge_event',
      raw: '{"type":"huge_event","blob":"xxxxx',
      truncated: true
    }
    expect(typeof cut.raw).toBe('string')
    expect(cut.truncated).toBe(true)
    // The point of the string typing: this would throw if the field claimed to be JSON.
    expect(() => JSON.parse(cut.raw)).toThrow()
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

  it('shapes SessionTransitionPayload as its six fields, conversation_id first and workspace_cwd nullable', () => {
    const payload: SessionTransitionPayload = {
      conversation_id: 'conv-1',
      previous_session_id: 'sess-1',
      new_session_id: 'sess-2',
      reason: 'clear',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: null
    }
    expect(payload).toEqual({
      conversation_id: 'conv-1',
      previous_session_id: 'sess-1',
      new_session_id: 'sess-2',
      reason: 'clear',
      occurred_at: '2026-07-10T00:00:00.000000000Z',
      workspace_cwd: null
    })
    // `conversation_id` IS on the wire and always present (#1192): the daemon resolves the owning
    // conversation from NewSessionID once per transition and drops the event rather than emitting one
    // it cannot bind (upstream #740/#741). This port asserted the opposite until #1192, which was a
    // fact about the port and never about the daemon — and it is why the marker, pushed unsolicited,
    // has an attribution at all.
    expect(payload).toHaveProperty('conversation_id')
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

  it('carries the tool input as an optional name→value map (#642)', () => {
    const payload: ToolUsePayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts',
      input: { file_path: '/etc/hosts', limit: '20' }
    }
    expect(payload.input).toEqual({ file_path: '/etc/hosts', limit: '20' })
  })

  it('admits a ToolUsePayload omitting `input` entirely — the field is OPTIONAL (#642)', () => {
    // Compile-time: this literal type-checks only while `input` is optional. A later ticket making it
    // required breaks HERE, which is the point — a pre-pyrycode#1678 daemon omits the key, and the
    // client runs against daemon builds days apart (the conversation_updated.is_archived scar).
    const payload: ToolUsePayload = {
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      tool_use_id: 'tu-1',
      name: 'Read',
      input_summary: 'reads /etc/hosts'
    }
    expect(payload.input).toBeUndefined()
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

  it('shapes ModalShownPayload as { conversation_id, modal_id, class, title, prompt, ordered options, default_option_id }', () => {
    const payload: ModalShownPayload = {
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
    expect(payload).toEqual({
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
    // `conversation_id` rides a modal_shown as of pyrycode#1065 (#870) — an OUTBOUND display-scoping
    // key. `modal_id` stays the sole INBOUND correlation key: an answer carries no conversation id.
    expect(payload).toHaveProperty('conversation_id')
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

  it('shapes ConversationCreatedPayload as its OWN 6 fields — NOT a ConversationSummary (spec #274)', () => {
    // The daemon deliberately omits is_archived + last_message_ts on a create reply, so this is a
    // dedicated 6-field shape, not a reuse of the 8-field ConversationSummary. name is string | null,
    // and so is workspace_label (#1287) — both required-present, neither ever absent on the wire.
    const payload: ConversationCreatedPayload = {
      id: 'conv-9',
      is_promoted: false,
      cwd: '/tmp/scratch',
      name: null,
      last_used_at: '2026-07-10T00:00:00Z',
      workspace_label: null
    }
    expect(payload).toEqual({
      id: 'conv-9',
      is_promoted: false,
      cwd: '/tmp/scratch',
      name: null,
      last_used_at: '2026-07-10T00:00:00Z',
      workspace_label: null
    })
    // The two fields the daemon excludes on a create reply are absent (no ConversationSummary reuse).
    expect(payload).not.toHaveProperty('is_archived')
    expect(payload).not.toHaveProperty('last_message_ts')

    // A populated name is an equally valid value (a named conversation).
    const named: ConversationCreatedPayload = { ...payload, name: 'design review' }
    expect(named.name).toBe('design review')
  })
})

describe('workspace_updated wire vocabulary (#1288)', () => {
  it('admits the workspace_updated envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const updated: EnvelopeType = 'workspace_updated'
    expect(updated).toBe('workspace_updated')
  })

  it('shapes WorkspaceUpdatedPayload as { path, label } — path REQUIRED, label REQUIRED but NULLABLE', () => {
    // The two fields have deliberately different nullability. `path` names the workspace and is a plain
    // value-string; `label` mirrors ConversationUpdatedPayload.workspace_label (`*string` with no
    // `omitempty`), so a cleared label is a literal `null` and never an absent key.
    const named: WorkspaceUpdatedPayload = { path: '/home/user/projects/app', label: 'Second Brain' }
    expect(named.label).toBe('Second Brain')

    const cleared: WorkspaceUpdatedPayload = { path: '/home/user/projects/app', label: null }
    expect(cleared.label).toBeNull()

    // An EMPTY label is a value on the wire, not an absence — nothing may collapse it to null.
    const empty: WorkspaceUpdatedPayload = { path: '/home/user/projects/app', label: '' }
    expect(empty.label).toBe('')
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

  it('shapes ConversationUpdatedPayload as { id, is_promoted, name, cwd, last_used_at, workspace_label } — name BEFORE cwd', () => {
    // The reply's own 5-field shape. `name` is `string | null` (a literal null, never absent — the
    // daemon uses *string WITHOUT omitempty), exactly like ConversationSummary.name. Field order
    // deliberately places `name` before `cwd` (spec #274), unlike ConversationCreatedPayload.
    const payload: ConversationUpdatedPayload = {
      id: 'conv-9',
      is_promoted: true,
      name: null,
      cwd: '/home/user/project',
      last_used_at: '2026-07-10T00:00:00Z',
      workspace_label: null
    }
    expect(payload).toEqual({
      id: 'conv-9',
      is_promoted: true,
      name: null,
      cwd: '/home/user/project',
      last_used_at: '2026-07-10T00:00:00Z',
      workspace_label: null
    })
    // Pin the no-drift wire order: name comes before cwd (the intentional reordering vs. created), with
    // #1287's workspace_label appended last, matching the daemon's own append.
    expect(Object.keys(payload)).toEqual([
      'id',
      'is_promoted',
      'name',
      'cwd',
      'last_used_at',
      'workspace_label'
    ])

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

describe('attachment-chunk wire vocabulary (#860)', () => {
  it('admits the attachment_chunk envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType. It is the
    // whole point of the row — `Envelope.type` is `EnvelopeType | string`, so a builder round-trip
    // passes with or without the union member and cannot see the hole. `npm run typecheck` does.
    const chunk: EnvelopeType = 'attachment_chunk'
    expect(chunk).toBe('attachment_chunk')
  })

  it('shapes AttachmentChunkPayload as the published nine fields, all always present', () => {
    // Mirrors the daemon SSOT (pyrycode #1752 / docs/protocol-mobile.md § Attachments) field-for-
    // field. Every field rides every chunk in BOTH directions — no omitempty — so a decoder may
    // rely on all nine. A literal missing one, or carrying a tenth, fails to typecheck.
    // `conversation_id` is FIRST, matching the daemon's struct order (pyrycode #2142), and it is
    // REQUIRED: the daemon refuses a chunk without one since pyrycode #2143 (#1205).
    const payload: AttachmentChunkPayload = {
      conversation_id: 'conv-1',
      attachment_id: 'att-1',
      index: 0,
      total_chunks: 2,
      filename: 'notes.txt',
      mime_type: 'text/plain',
      size: 45001,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      data: 'aGVsbG8='
    }

    expect(Object.keys(payload)).toEqual([
      'conversation_id',
      'attachment_id',
      'index',
      'total_chunks',
      'filename',
      'mime_type',
      'size',
      'sha256',
      'data'
    ])
    expect(payload.conversation_id).toBe('conv-1')
    expect(payload.attachment_id).toBe('att-1')
    expect(payload.index).toBe(0)
    expect(payload.total_chunks).toBe(2)
    expect(payload.filename).toBe('notes.txt')
    expect(payload.mime_type).toBe('text/plain')
    expect(payload.size).toBe(45001)
    expect(payload.sha256).toHaveLength(64)
    expect(payload.data).toBe('aGVsbG8=')
  })

  it('pins index as a number — a JSON string is a compile-time type error', () => {
    // The no-drift pin: the position counter is a number on the wire. If the field were ever relaxed
    // to `string`, this line would stop erroring and fail the test at compile time.
    const wrong: AttachmentChunkPayload = {
      conversation_id: 'conv-1',
      attachment_id: 'att-1',
      // @ts-expect-error index is a number, not a string
      index: '0',
      total_chunks: 2,
      filename: 'notes.txt',
      mime_type: 'text/plain',
      size: 1,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      data: ''
    }
    expect(wrong.attachment_id).toBe('att-1')
  })

  it('pins the mandated stride and the three metadata byte ceilings', () => {
    // 45000 is RAW BYTES of `data` before base64, and it is a stride the receiver derives
    // total_chunks from — not a ceiling to fit under. The three ceilings count BYTES, not runes.
    expect(ATTACHMENT_CHUNK_DATA_BYTES).toBe(45000)
    expect(ATTACHMENT_ID_MAX_BYTES).toBe(64)
    expect(ATTACHMENT_FILENAME_MAX_BYTES).toBe(255)
    expect(ATTACHMENT_MIME_TYPE_MAX_BYTES).toBe(255)
  })
})

describe('question-shown wire vocabulary (#883)', () => {
  // Every value below is lifted VERBATIM from the daemon's three committed fixtures
  // (internal/protocol/testdata/question_shown{,_empty,_zero}.json), so a contract change shows up
  // as a fixture diff rather than as a disagreement between two hand-written guesses.

  it('admits the question_shown inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType. It is the
    // whole point of the row — `Envelope.type` is `EnvelopeType | string`, so without the member a
    // decode/re-encode round-trip passes silently on an unknown string and nothing else catches it.
    const shown: EnvelopeType = 'question_shown'
    expect(shown).toBe('question_shown')
  })

  it('shapes WireQuestionOption as { label, description } — no id, no preview', () => {
    const option: WireQuestionOption = {
      label: 'Write-through',
      description: 'Writes reach the cache and the store together.'
    }
    expect(option).toEqual({
      label: 'Write-through',
      description: 'Writes reach the cache and the store together.'
    })
    // NO `id`, and the absence is the contract's — unlike `WireModalOption`'s `{ id, label }` one
    // screen up. claude's answer protocol selects an option by its LABEL, so a future answer frame
    // returns a claude-authored string rather than an id.
    expect(option).not.toHaveProperty('id')
    // NO `preview` either — claude's optional HTML-fragment field is absent BY CONSTRUCTION, since
    // pyry never sets `toolConfig.askUserQuestion.previewFormat`.
    expect(option).not.toHaveProperty('preview')
  })

  it('shapes WireQuestion as { question, header, ordered options, multi_select }', () => {
    // The wire key is `question`, NOT the Go field's name: `Question.Text` is renamed upstream only
    // to avoid `Question.Question` stuttering, and the wire key is what a client mirrors.
    const question: WireQuestion = {
      question: 'Which eviction policies should it support?',
      header: 'Eviction',
      options: [
        { label: 'LRU', description: 'Evict the least recently used entry.' },
        { label: 'LFU', description: 'Evict the least frequently used entry.' },
        { label: 'TTL', description: 'Evict entries after a fixed time to live.' }
      ],
      multi_select: true
    }
    expect(question).toEqual({
      question: 'Which eviction policies should it support?',
      header: 'Eviction',
      options: [
        { label: 'LRU', description: 'Evict the least recently used entry.' },
        { label: 'LFU', description: 'Evict the least frequently used entry.' },
        { label: 'TTL', description: 'Evict entries after a fixed time to live.' }
      ],
      multi_select: true
    })
    // `options` nests HERE, on each question — not flat on the payload the way
    // `ModalShownPayload.options` is. A reader pattern-matching off the modal family gets this wrong
    // by default, so the two-level nesting is pinned rather than left to the type declaration.
    expect(question.options).toHaveLength(3)
  })

  it('shapes QuestionShownPayload as { conversation_id, question_batch_id, questions }', () => {
    // The populated fixture (question_shown.json): two questions, one with three options, one with
    // multi_select true. Values are pairwise distinct on purpose — `toEqual` is what catches a
    // transposition of two same-typed `string` fields, which tsc is structurally blind to.
    const payload: QuestionShownPayload = {
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
    expect(payload.conversation_id).toBe('conv-1')
    expect(payload.question_batch_id).toBe('qb-7f3a')
    expect(payload.questions).toHaveLength(2)
    // Array order IS the canonical display order — claude's own, carried through unchanged.
    expect(payload.questions.map((q) => q.header)).toEqual(['Write strategy', 'Eviction'])
    // `multi_select: false` is a STATED POSITION, never an absent key, so it is read as a value.
    expect(payload.questions[0].multi_select).toBe(false)
    expect(payload.questions[1].multi_select).toBe(true)
    // The observed header is 14 runes while the vendor page documents a 12 cap. Nothing enforces
    // either, and a client that sizes for 12 and truncates clips the only real header ever measured.
    expect([...payload.questions[0].header].length).toBe(14)
  })

  it('carries NO truncated_fields at any of the three levels — a cut can never be reported', () => {
    // The trap that separates this family from `SlashCommand` and `ModelOption`, both of which DO
    // carry one. With no way to report a cut, an over-long field is a fail-closed REJECT for the
    // decode slice rather than a silent trim — cutting silently would present claude's truncated
    // text to a client as complete.
    const payload: QuestionShownPayload = {
      conversation_id: 'conv-1',
      question_batch_id: 'qb-7f3a',
      questions: [
        {
          question: 'Which write strategy should the cache use?',
          header: 'Write strategy',
          options: [
            { label: 'Write-through', description: 'Writes reach the cache and the store together.' }
          ],
          multi_select: false
        }
      ]
    }
    expect(payload).not.toHaveProperty('truncated_fields')
    expect(payload.questions[0]).not.toHaveProperty('truncated_fields')
    expect(payload.questions[0].options[0]).not.toHaveProperty('truncated_fields')
  })

  it('admits an EMPTY questions array — the [] normalisation, never a null branch', () => {
    // The daemon's second fixture (question_shown_empty.json). `questions` is a plain non-optional
    // array because the daemon's MarshalJSON normalises a nil slice to [], so no consumer ever
    // branches on null. Unlike `model_list`'s `models`, an empty batch is NOT a positive statement —
    // it is out of contract and means a producer bug, not "claude asked nothing".
    const emptyBatch: QuestionShownPayload = {
      conversation_id: 'conv-1',
      question_batch_id: 'qb-0e21',
      questions: []
    }
    expect(emptyBatch.questions).toEqual([])
  })

  it('admits the ZERO-VALUE batch — the only route that reaches all nine wire keys', () => {
    // The daemon's third fixture (question_shown_zero.json): one all-zero question holding one
    // all-zero option. A batch with no questions reaches neither nested type, so this arm is what
    // proves no key is optional — every field is present with its zero value.
    const zero: QuestionShownPayload = {
      conversation_id: '',
      question_batch_id: '',
      questions: [{ question: '', header: '', options: [{ label: '', description: '' }], multi_select: false }]
    }
    expect(zero).toEqual({
      conversation_id: '',
      question_batch_id: '',
      questions: [{ question: '', header: '', options: [{ label: '', description: '' }], multi_select: false }]
    })
    // '' and false are VALUES, never consulted for truthiness: the daemon sets no `omitempty`, so an
    // empty header or an unset multi_select is a real answer rather than a vanished one.
    expect(zero.questions[0].header).toBe('')
    expect(zero.questions[0].multi_select).toBe(false)
  })

  it('pins every field as REQUIRED — omitting one is a compile-time error', () => {
    // The no-drift pin, and the load-bearing one: all-required is what leaves the decode slice's
    // fail-closed narrower no optional key to wave through. If any field were ever relaxed to
    // optional, the directives below would stop erroring and fail this file at compile time.

    // @ts-expect-error `header` is required — the daemon sets no omitempty on it
    const missingHeader: WireQuestion = {
      question: 'Which write strategy should the cache use?',
      options: [{ label: 'Write-through', description: 'Writes reach the cache and the store together.' }],
      multi_select: false
    }
    // @ts-expect-error `description` is required — it and `label` are the COMPLETE per-option key set
    const missingDescription: WireQuestionOption = { label: 'Write-through' }
    // @ts-expect-error `questions` is required and non-optional — nil is normalised to [], never elided
    const missingQuestions: QuestionShownPayload = {
      conversation_id: 'conv-1',
      question_batch_id: 'qb-7f3a'
    }
    expect(missingHeader.question).toBe('Which write strategy should the cache use?')
    expect(missingDescription.label).toBe('Write-through')
    expect(missingQuestions.conversation_id).toBe('conv-1')
  })
})

describe('question-dismissed wire vocabulary (#894)', () => {
  // Values here are NOT lifted from the daemon's committed fixture, and that inverts the sibling
  // block's habit deliberately. `internal/protocol/testdata/question_dismissed.json` carries
  // `source: "timeout"`; it is a SHAPE fixture from the declaring slice (pyrycode#1974), minted
  // before any producer existed, and the landed producer contradicts it — `retireQuestion` emits the
  // compile-time constants `outcomeQuestionUnanswered` / `sourceQuestionNoAnswer` on every one of its
  // three terminal paths. So the keys are the fixture's and the values are the producer's.

  it('admits the question_dismissed inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType, and it is the
    // only thing that catches a dropped one — `Envelope.type` is `EnvelopeType | string`, so the
    // decoder's `case 'question_dismissed':` compiles green whether or not the member was ever added.
    const dismissed: EnvelopeType = 'question_dismissed'
    expect(dismissed).toBe('question_dismissed')
  })

  it('shapes QuestionDismissedPayload as { question_batch_id, outcome, source } — no conversation_id', () => {
    const payload: QuestionDismissedPayload = {
      question_batch_id: 'qb-7f3a',
      outcome: 'unanswered',
      source: 'no_answer'
    }
    // Exact `toEqual` over three PAIRWISE-DISTINCT values: `outcome` and `source` are both plain
    // `string`, so a transposition between them is invisible to tsc and only distinct values catch it.
    expect(payload).toEqual({
      question_batch_id: 'qb-7f3a',
      outcome: 'unanswered',
      source: 'no_answer'
    })
    // NO `conversation_id`, though `question_shown` carries one. The batch nonce is the sole
    // correlation key; a shape carrying both would admit a disagreeing pair someone has to adjudicate.
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('types source as a PLAIN string, not WireModalSource', () => {
    // The single most likely mistake in this family. Two of the producer's three terminal paths — a
    // caller disconnect and a daemon shutdown — have no member in `{remote, local, timeout}` at all,
    // so closing the enum would reject the only traffic that exists. `no_answer` is what actually
    // ships; the modal set's three values assign here too, but nothing emits any of them.
    const live: QuestionDismissedPayload['source'] = 'no_answer'
    const unknownFuture: QuestionDismissedPayload['source'] = 'some_cause_named_later'
    expect([live, unknownFuture]).toEqual(['no_answer', 'some_cause_named_later'])
    // The reading rule that makes the open type safe: an unrecognised `source` means *resolved, cause
    // unknown*, and NEVER an answer — reading it as one renders a daemon safe-deny as the operator's
    // own choice. Enforced by documentation and by the consuming slice, not by this type.
    const modalSource: WireModalSource = 'timeout'
    const carriedOver: QuestionDismissedPayload['source'] = modalSource
    expect(carriedOver).toBe('timeout')
  })
})

describe('outbound question wire vocabulary (#919)', () => {
  // Values are lifted verbatim from the daemon's committed fixtures
  // (internal/protocol/testdata/question_answer.json, question_refused.json), so a contract change
  // shows up here. Unlike the question_dismissed block above there is no producer/fixture
  // disagreement to work around: these two frames are the CLIENT's to emit, and the fixtures are the
  // shape it must emit.

  it('admits the question_answer and question_refused outbound envelope types', () => {
    // Compile-time membership: these assign only if the members are part of EnvelopeType, and it is
    // the only thing that catches a dropped one — `Envelope.type` is `EnvelopeType | string`, so a
    // builder's `type: 'question_answer'` compiles green whether or not the member was ever added.
    const answer: EnvelopeType = 'question_answer'
    const refused: EnvelopeType = 'question_refused'
    expect([answer, refused]).toEqual(['question_answer', 'question_refused'])
  })

  it('shapes QuestionAnswerPayload as { question_batch_id, answer_token, answers }', () => {
    const payload: QuestionAnswerPayload = {
      question_batch_id: 'qb-4c19',
      answer_token: 'at-7f3d',
      answers: [
        { question_index: 0, values: ['Rewrite the parser'] },
        { question_index: 1, values: ['Add a benchmark', 'Add a fuzz target'] }
      ]
    }
    // Exact `toEqual` over PAIRWISE-DISTINCT ids: `question_batch_id` and `answer_token` are both
    // plain `string`, so a transposition between them is invisible to tsc and only distinct values
    // catch it.
    expect(payload).toEqual({
      question_batch_id: 'qb-4c19',
      answer_token: 'at-7f3d',
      answers: [
        { question_index: 0, values: ['Rewrite the parser'] },
        { question_index: 1, values: ['Add a benchmark', 'Add a fuzz target'] }
      ]
    })
    // NO `conversation_id`, matching `ModalAnswerPayload`'s absence: the daemon resolves the batch id
    // against its own outstanding-batch state and never trusts a client-asserted conversation.
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('types answers as a plain non-optional array of entries keyed by index, never by label', () => {
    // The array is never `| null`: upstream normalises a nil slice to `[]` in
    // QuestionAnswerPayload.MarshalJSON precisely so a client's array type can be non-optional. The
    // same holds for an entry's `values`.
    const empty: QuestionAnswerPayload['answers'] = []
    expect(empty).toEqual([])

    // An entry names its question by INDEX — the security property this shape exists for. A
    // `WireQuestionOption` carries no `id` and claude selects by `label`, so the reflex design would
    // echo a claude-authored string back across the trust boundary; keying by index means no
    // claude-authored byte travels inbound at all.
    const entry: QuestionAnswerEntry = { question_index: 0, values: ['Rewrite the parser'] }
    expect(entry).toEqual({ question_index: 0, values: ['Rewrite the parser'] })
    expect(entry).not.toHaveProperty('label')

    // A plain signed `number`, deliberately NOT range-checked by this wire type. The bound is the
    // daemon resolver's (`answerVerdict`); a second copy here would be a second bound to keep in
    // agreement. Upstream chose a signed int for the same reason — a uint would reject -1 at decode
    // and still accept 1<<62.
    const outOfRange: QuestionAnswerEntry = { question_index: -1, values: [] }
    expect(outOfRange.question_index).toBe(-1)
  })

  it('shapes QuestionRefusedPayload as { question_batch_id, answer_token } — no answers', () => {
    const payload: QuestionRefusedPayload = {
      question_batch_id: 'qb-91ae',
      answer_token: 'at-2c60'
    }
    expect(payload).toEqual({ question_batch_id: 'qb-91ae', answer_token: 'at-2c60' })
    // It carries `answer_token` too, UNLIKE `modal_cancel`, which carries `modal_id` alone: a refusal
    // is as replayable as an answer. Do not size this pair from the modal pair's asymmetry.
    const modalCancel: ModalCancelPayload = { modal_id: 'mdl-7f3a' }
    expect(modalCancel).not.toHaveProperty('answer_token')
    // Its own type rather than an answer with an empty `answers`, so a reader routes on the frame's
    // name rather than on a value's shape.
    expect(payload).not.toHaveProperty('answers')
    expect(payload).not.toHaveProperty('conversation_id')
  })
})

describe('slash-command-list wire vocabulary (#935)', () => {
  // Values are lifted from the daemon's three committed fixtures
  // (internal/protocol/testdata/slash_command_list{,_empty,_zero}.json), so a contract change shows up
  // as a fixture diff rather than as a disagreement between two hand-written guesses. TWO DELIBERATE
  // DEPARTURES, both named here rather than left to be spotted, following the `question_dismissed`
  // block's precedent above:
  //
  //   1. `claude-api`'s description is ABRIDGED. The fixture's is 1,145 bytes of prose and none of it
  //      is contract-bearing; what the row pins is its EMPTY argument hint, its EMPTY aliases, its
  //      reported `description` cut, and the two byte-level properties measured on the real string —
  //      an embedded newline and a non-ASCII rune — both of which the stand-in keeps.
  //   2. The `truncated_fields: ['aliases']` case is HAND-AUTHORED. No committed upstream fixture
  //      carries it: the populated fixture's only cut is `description`. It is the one arm that
  //      separates "cut to nothing" from "none", so it is written rather than skipped for want of
  //      bytes to copy.

  it('admits the slash_command_list inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType, and it is the
    // only thing that catches a dropped one — `Envelope.type` is `EnvelopeType | string`, so #936's
    // `case 'slash_command_list':` compiles green whether or not the member was ever added.
    const list: EnvelopeType = 'slash_command_list'
    expect(list).toBe('slash_command_list')
  })

  it('shapes WireSlashCommand as { name, argument_hint, description, aliases, truncated_fields }', () => {
    // The fixture's `model` row. Its hint arrives as a RAW `<model>`: the committed bytes carry
    // `<model>` because Go's encoder escapes `<`, `>` and `&`, so the escaping is a transport
    // artefact and the decoded value holds the literal angle brackets — the exact byte a render sink
    // would be tempted by, which is why the trust-tier rule is stated at the type.
    const command: WireSlashCommand = {
      name: 'model',
      argument_hint: '<model>',
      description: 'Set the AI model for Claude Code',
      aliases: [],
      truncated_fields: null
    }
    expect(command).toEqual({
      name: 'model',
      argument_hint: '<model>',
      description: 'Set the AI model for Claude Code',
      aliases: [],
      truncated_fields: null
    })
    expect(command.argument_hint).toBe('<model>')
    // `name` is NOT an identifier — one name in the measured capture is `__remote-workflow`, so no
    // charset assumption belongs in a client, and nothing may key a cache or a lookup path by it.
    const oddName: WireSlashCommand = { ...command, name: '__remote-workflow' }
    expect(oddName.name).toBe('__remote-workflow')
  })

  it('shapes SlashCommandListPayload as { conversation_id, commands, dropped_commands }', () => {
    // The populated fixture (slash_command_list.json): five rows in claude's own order, one reporting
    // a cut `description` beside four reporting `null`, and a NON-ZERO `dropped_commands`.
    const payload: SlashCommandListPayload = {
      conversation_id: 'c1',
      commands: [
        {
          name: 'claude-api',
          argument_hint: '',
          // Abridged (see the block comment). Both measured properties of the real string are kept:
          // an embedded newline — `0x0a` is the ONLY sub-`0x20` byte anywhere across the capture's 51
          // entries' four string fields — and a non-ASCII rune, here the em dash.
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
    expect(payload.conversation_id).toBe('c1')
    // Array order IS claude's own, carried through unchanged.
    expect(payload.commands.map((c) => c.name)).toEqual(['claude-api', 'clear', 'config', 'model', 'usage'])
    // `dropped_commands` IS COUNTED AND CARRIED, so this arithmetic yields the menu's true size. The
    // published section still says "nothing counts it" and forbids exactly this sum; that prose is
    // stale (the count landed upstream in #1826 and the frame-level cut adds to it in #2002 rather
    // than recomputing it), and the correction is pyrycode#2010, still open. Asserted rather than only
    // commented, because it is the statement most likely to be copied wrong from the upstream doc.
    expect(payload.dropped_commands).toBe(2)
    expect(payload.commands.length + payload.dropped_commands).toBe(7)
    // A cut is per row and each row reports its OWN. There is no hoisted or flattened list on the
    // payload, so a reader grepping the frame for one finds nothing.
    expect(payload).not.toHaveProperty('truncated_fields')
    expect(payload.commands[0].truncated_fields).toEqual(['description'])
    expect(payload.commands.filter((c) => c.truncated_fields === null)).toHaveLength(4)
    // A description is not necessarily one line, and the newline is the control character that
    // actually occurs on this path — the reason the never-into-a-log clause of CLAUDE.md's ruling
    // bites harder here than on its neighbours: a workspace author could forge a log record with it.
    expect(payload.commands[0].description).toContain('\n')
  })

  it('admits an EMPTY commands array — a positive statement, never a null branch', () => {
    // The daemon's second fixture (slash_command_list_empty.json). `commands` is a plain non-optional
    // array because the daemon's MarshalJSON normalises a nil slice to [], so no consumer branches on
    // null. Unlike `question_shown`'s `questions`, an empty list here IS in contract: it says claude
    // offered nothing. `0` is a VALUE, never consulted for truthiness.
    const emptyMenu: SlashCommandListPayload = {
      conversation_id: 'c1',
      commands: [],
      dropped_commands: 0
    }
    expect(emptyMenu.commands).toEqual([])
    expect(emptyMenu.dropped_commands).toBe(0)
    expect(emptyMenu.commands.length + emptyMenu.dropped_commands).toBe(0)
  })

  it('admits the ZERO-VALUE entry — an empty hint, an empty aliases and a null truncated_fields', () => {
    // The daemon's third fixture (slash_command_list_zero.json): one all-zero row, which is the only
    // route to WireSlashCommand's five keys, since a frame carrying no entries reaches none of them.
    // It is also the all-at-once case: an empty `argument_hint`, an empty `aliases` and a `null`
    // `truncated_fields` on ONE entry, read with no branch on absent-versus-empty anywhere.
    const zero: SlashCommandListPayload = {
      conversation_id: '',
      commands: [{ name: '', argument_hint: '', description: '', aliases: [], truncated_fields: null }],
      dropped_commands: 0
    }
    expect(zero).toEqual({
      conversation_id: '',
      commands: [{ name: '', argument_hint: '', description: '', aliases: [], truncated_fields: null }],
      dropped_commands: 0
    })
    // '' is a VALUE, never a vanished key: the daemon sets no `omitempty` on any of the eight keys.
    expect(zero.commands[0].argument_hint).toBe('')
    expect(zero.commands[0].aliases).toEqual([])
    expect(zero.commands[0].truncated_fields).toBeNull()

    // Neither empty is a zero-value artefact — both occur independently in the real capture, so a
    // consumer may not read one as evidence of a malformed row. `argument_hint` is empty on 33 of the
    // capture's 51 entries (the ORDINARY case rather than missing data), and `aliases` is `[]` on the
    // 42 entries claude sends no alias key for at all.
    const realEmptyHint: WireSlashCommand = {
      name: 'usage',
      argument_hint: '',
      description: "Show session cost, plan usage, and what's contributing to your limits",
      aliases: ['cost', 'stats'],
      truncated_fields: null
    }
    const realEmptyAliases: WireSlashCommand = {
      name: 'model',
      argument_hint: '<model>',
      description: 'Set the AI model for Claude Code',
      aliases: [],
      truncated_fields: null
    }
    expect(realEmptyHint.argument_hint).toBe('')
    expect(realEmptyHint.aliases).toEqual(['cost', 'stats'])
    expect(realEmptyAliases.aliases).toEqual([])
    expect(realEmptyAliases.argument_hint).toBe('<model>')
  })

  it('carries a truncated_fields naming aliases — the ONLY signal that an empty aliases is UNKNOWN', () => {
    // Hand-authored; no committed fixture carries this arm (see the block comment). `aliases` collapses
    // claude's ABSENT and its EMPTY list into the same `[]`, which spares every other row a branch and
    // costs a reader exactly here: with the key cut, `[]` no longer says "none".
    const cutAliases: WireSlashCommand = {
      name: 'clear',
      argument_hint: '[name]',
      description: 'Start a new session with empty context',
      aliases: [],
      truncated_fields: ['aliases']
    }
    expect(cutAliases.aliases).toEqual([])
    expect(cutAliases.truncated_fields).toEqual(['aliases'])

    // THE READING RULE, pinned as a predicate rather than left in prose: an empty `aliases` means
    // "none" only when this row reported no cut naming it. Read the cut row as *no aliases* and #681's
    // Actions menu greys out a working command — its own `reset` entry is an ALIAS of `clear`, not a
    // command name, so `reset` disappears from a menu whose command is live.
    const aliasesAreKnownEmpty = (c: WireSlashCommand): boolean =>
      c.aliases.length === 0 && !(c.truncated_fields ?? []).includes('aliases')
    expect(aliasesAreKnownEmpty(cutAliases)).toBe(false)
    expect(aliasesAreKnownEmpty({ ...cutAliases, truncated_fields: null })).toBe(true)
    // A cut naming some OTHER field says nothing about the aliases, so the rule keys on the name and
    // never on the presence of a cut.
    expect(aliasesAreKnownEmpty({ ...cutAliases, truncated_fields: ['description'] })).toBe(true)
  })

  it('pins every field as REQUIRED — omitting one is a compile-time error', () => {
    // The no-drift pin, and the load-bearing one: all-required is what leaves #936's fail-closed
    // narrower no optional key to wave through. If any field were ever relaxed to optional, the
    // directives below would stop erroring and fail this file at compile time.

    // @ts-expect-error `argument_hint` is required — always present, and empty is a value, not an absence
    const missingHint: WireSlashCommand = {
      name: 'usage',
      description: 'Show session cost',
      aliases: [],
      truncated_fields: null
    }
    // @ts-expect-error `aliases` is required and non-optional — nil is normalised to [], never elided
    const missingAliases: WireSlashCommand = {
      name: 'usage',
      argument_hint: '',
      description: 'Show session cost',
      truncated_fields: null
    }
    // @ts-expect-error `truncated_fields` is required — NULLABLE is not the same as OPTIONAL, and an
    // absent key would decode to `undefined`, which a `?.includes('aliases')` reads as "nothing cut"
    const missingTruncated: WireSlashCommand = {
      name: 'usage',
      argument_hint: '',
      description: 'Show session cost',
      aliases: []
    }
    // @ts-expect-error `dropped_commands` is required — the key is always written, so an absent one is
    // a real defect rather than a valid zero
    const missingDropped: SlashCommandListPayload = {
      conversation_id: 'c1',
      commands: []
    }
    // @ts-expect-error `commands` is required and non-optional — nil is normalised to [], never elided
    const missingCommands: SlashCommandListPayload = {
      conversation_id: 'c1',
      dropped_commands: 0
    }
    expect(missingHint.name).toBe('usage')
    expect(missingAliases.name).toBe('usage')
    expect(missingTruncated.name).toBe('usage')
    expect(missingDropped.conversation_id).toBe('c1')
    expect(missingCommands.conversation_id).toBe('c1')
  })
})

describe('attachment-stored wire vocabulary (#964)', () => {
  // The id below is lifted VERBATIM from the daemon's committed fixture
  // (internal/protocol/testdata/attachment_stored.json, whose whole envelope reads
  // `{"id":815,"type":"attachment_stored","ts":…,"payload":{"attachment_id":"3f2a1c40-…"},"in_reply_to":814}`)
  // and from the round-trip literal in TestAttachmentStoredPayload_WireKeys, so a contract change shows
  // up here as a fixture diff rather than as a disagreement between two hand-written guesses.

  it('admits the attachment_stored inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType, and it is the
    // only thing in the tree that catches a dropped one — `Envelope.type` is `EnvelopeType | string`,
    // so both the decoder's `case 'attachment_stored':` and the fake daemon's
    // `encodeEnvelope({ type: 'attachment_stored' })` compile green whether or not the member was ever
    // added, and a decode/re-encode round-trip passes silently on an unknown string.
    const stored: EnvelopeType = 'attachment_stored'
    expect(stored).toBe('attachment_stored')
  })

  it('shapes AttachmentStoredPayload as { attachment_id } — one key, and every absence a decision', () => {
    const payload: AttachmentStoredPayload = {
      attachment_id: '3f2a1c40-9b7e-4d16-a5c3-0e8f1b2d4a67'
    }
    expect(payload).toEqual({ attachment_id: '3f2a1c40-9b7e-4d16-a5c3-0e8f1b2d4a67' })
    expect(Object.keys(payload)).toEqual(['attachment_id'])

    // The absences are the contract, not an oversight, and the daemon pins the key set two-sidedly
    // (TestAttachmentStoredPayload_WireKeys) so drift surfaces upstream as a failing test rather than as
    // a review note. NO size / sha256 / total_chunks: the client sent all three and they were checked
    // against the assembled bytes before this frame could be emitted, so echoing them confirms nothing.
    expect(payload).not.toHaveProperty('size')
    expect(payload).not.toHaveProperty('sha256')
    expect(payload).not.toHaveProperty('total_chunks')
    // NO filename and no host path or directory component — § Error codes already forbids
    // `attachment.storage_failed` from disclosing the daemon's layout, and a SUCCESS frame leaking what
    // the FAILURE frame is guarded against would undo that mitigation from the other side.
    expect(payload).not.toHaveProperty('filename')
    // NO conversation_id, for AttachmentChunkPayload's reason: the upload landed in the conversation the
    // authenticated session is already on, so a client cannot steer bytes by naming another one.
    expect(payload).not.toHaveProperty('conversation_id')
  })

  it('carries the transfer id in the PAYLOAD, with correlation left to the envelope', () => {
    // The one key is the whole correlation story this side can act on. `in_reply_to` rides the ENVELOPE
    // (`Envelope.in_reply_to`, 814 in the fixture above) and names the chunk WHOSE ARRIVAL COMPLETED THE
    // TRANSFER — not the highest index, and not predictable, since chunks may be reassembled in any
    // order. So the payload deliberately does not repeat it, and a consumer matching on a guessed
    // envelope id never resolves.
    // @ts-expect-error `attachment_id` is required — no omitempty daemon-side, so an absent key is a
    // real defect rather than a valid zero
    const missingId: AttachmentStoredPayload = {}
    expect(missingId).toEqual({})

    // A plain `string`, deliberately NOT a validated or branded id type. Upstream publishes a canonical
    // lowercase-UUIDv4 shape (conversations.ValidID's), but that rule binds the side that MINTS ids —
    // this client's own outbound leg — not the decode of a value this client originated. A second copy
    // of the shape rule here would fail-close valid traffic the moment the two disagreed.
    const notCanonical: AttachmentStoredPayload['attachment_id'] = 'ATT-1'
    expect(notCanonical).toBe('ATT-1')
  })
})

describe('request-attachment wire vocabulary (#993)', () => {
  // The ids below are lifted VERBATIM from the daemon's committed fixture
  // (internal/protocol/testdata/request_attachment.json, whose whole envelope reads
  // `{"id":91,"type":"request_attachment","ts":"2026-08-25T09:14:05Z","payload":{"conversation_id":"9d4e…","attachment_id":"7c1d…"}}`)
  // and from the round-trip literal in TestRequestAttachmentPayload_WireKeys, so a contract change
  // shows up here as a fixture diff rather than as a disagreement between two hand-written guesses.
  const CONVERSATION_ID = '9d4e7a21-8c05-4f3b-b6e2-1a7c9e30d5f4'
  const ATTACHMENT_ID = '7c1d5e92-4a30-4b8f-9e21-6d4c3b0a8f55'

  it('admits the request_attachment outbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType, and it is
    // the only thing in the tree that catches a dropped one — `Envelope.type` is
    // `EnvelopeType | string`, so the builder's own round-trip test compiles green whether or not
    // the member was ever added.
    const request: EnvelopeType = 'request_attachment'
    expect(request).toBe('request_attachment')
  })

  it('shapes RequestAttachmentPayload as { conversation_id, attachment_id } — two fields, no third', () => {
    const payload: RequestAttachmentPayload = {
      conversation_id: CONVERSATION_ID,
      attachment_id: ATTACHMENT_ID
    }
    expect(payload).toEqual({ conversation_id: CONVERSATION_ID, attachment_id: ATTACHMENT_ID })
    expect(Object.keys(payload)).toEqual(['conversation_id', 'attachment_id'])

    // NO request-id key of any spelling. Correlation rides the ENVELOPE — the daemon's answering
    // chunks and its reject both name this frame through `Envelope.in_reply_to`, and its committed
    // retrieval-chunk fixture rides `in_reply_to: 91` against this fixture's `id: 91`. A request-id
    // key invented here would leave a landed upstream fixture describing a different scheme.
    expect(payload).not.toHaveProperty('request_id')
    expect(payload).not.toHaveProperty('requestId')
  })

  it('requires both keys — no omitempty daemon-side, so an absent key is a defect not a zero', () => {
    // @ts-expect-error `attachment_id` is required
    const missingAttachment: RequestAttachmentPayload = { conversation_id: CONVERSATION_ID }
    // @ts-expect-error `conversation_id` is required
    const missingConversation: RequestAttachmentPayload = { attachment_id: ATTACHMENT_ID }

    expect(missingAttachment.conversation_id).toBe(CONVERSATION_ID)
    expect(missingConversation.attachment_id).toBe(ATTACHMENT_ID)
  })

  it('carries a conversation_id where attachment_chunk deliberately carries none', () => {
    // The asymmetry is the daemon's and it is deliberate on both sides. An upload lands in the
    // conversation the authenticated session is already on, so naming one THERE would only let a
    // client steer bytes into another conversation's directory; a retrieval has to be able to say
    // WHICH conversation's file it wants. Do not "harmonise" the two frames in either direction.
    const request: RequestAttachmentPayload = {
      conversation_id: CONVERSATION_ID,
      attachment_id: ATTACHMENT_ID
    }
    expect(request).toHaveProperty('conversation_id')

    // And naming one is NOT authorization. The daemon validates the id against its own registry
    // before it reaches a path join and confines resolution to that conversation's directory;
    // confinement is what bounds a paired but hostile client, never the id's shape or its secrecy.
    // Both ids are plain `string`s, deliberately NOT branded or validated types: the canonical
    // lowercase-UUIDv4 shape is DOCUMENTED here and enforced by the daemon, which is the posture
    // both sibling payload types already ship with. A non-canonical value therefore compiles.
    const notCanonical: RequestAttachmentPayload = {
      conversation_id: 'CONV-1',
      attachment_id: 'ATT-1'
    }
    expect(notCanonical.conversation_id).toBe('CONV-1')
    expect(notCanonical.attachment_id).toBe('ATT-1')
  })
})

describe('model-list wire vocabulary (#971)', () => {
  // Values are transcribed VERBATIM from the daemon's three committed fixtures
  // (internal/protocol/testdata/model_list{,_empty,_zero}.json), so a contract change shows up as a
  // fixture diff rather than as a disagreement between two hand-written guesses. Unlike the #935 block
  // above, there are NO departures here: nothing is abridged and nothing is hand-authored, because
  // every arm this frame needs is present in the committed bytes.

  it('admits the model_list inbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType, and it is the
    // only thing that catches a dropped one — `Envelope.type` is `EnvelopeType | string`, so a later
    // decode's `case 'model_list':` compiles green whether or not the member was ever added.
    const list: EnvelopeType = 'model_list'
    expect(list).toBe('model_list')
  })

  it('shapes WireModelOption as { resolved_model, value, display_name, effort_levels, supports_auto_mode, truncated_fields }', () => {
    // The populated fixture's FIRST row. Its `resolved_model` arrives as a RAW `<unmeasured>`: the
    // committed bytes carry `<unmeasured>` because Go's encoder escapes `<`, `>` and `&`, so
    // the escaping is a transport artefact and the decoded value holds the literal angle brackets — the
    // exact byte a render sink would be tempted by, in a field the type's SECURITY note names as
    // claude-authored. It is also the reason `resolved_model` may not be treated as an identifier
    // merely because other rows make it look like one.
    const option: WireModelOption = {
      resolved_model: '<unmeasured>',
      value: 'default',
      display_name: 'Default (recommended)',
      effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supports_auto_mode: true,
      truncated_fields: null
    }
    expect(option).toEqual({
      resolved_model: '<unmeasured>',
      value: 'default',
      display_name: 'Default (recommended)',
      effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supports_auto_mode: true,
      truncated_fields: null
    })
    expect(option.resolved_model).toBe('<unmeasured>')
    expect(Object.keys(option)).toHaveLength(6)
  })

  it('shapes ModelListPayload as { conversation_id, models, dropped_models }', () => {
    // The populated fixture (model_list.json): five rows in claude's own order, one reporting a cut
    // `value` beside four reporting `null`, one publishing an EMPTY `effort_levels`, and a NON-ZERO
    // `dropped_models`.
    const payload: ModelListPayload = {
      conversation_id: 'c1',
      models: [
        {
          resolved_model: '<unmeasured>',
          value: 'default',
          display_name: 'Default (recommended)',
          effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supports_auto_mode: true,
          truncated_fields: null
        },
        {
          resolved_model: '<unmeasured>',
          value: 'opus[1m]',
          display_name: 'Opus (1M context)',
          effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supports_auto_mode: true,
          truncated_fields: null
        },
        {
          resolved_model: '<unmeasured>',
          value: 'claude-fable-5[1m]',
          display_name: 'Fable',
          effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supports_auto_mode: true,
          truncated_fields: ['value']
        },
        {
          resolved_model: '<unmeasured>',
          value: 'sonnet',
          display_name: 'Sonnet',
          effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          supports_auto_mode: true,
          truncated_fields: null
        },
        {
          resolved_model: 'claude-haiku-4-5-20251001',
          value: 'haiku',
          display_name: 'Haiku',
          effort_levels: [],
          supports_auto_mode: false,
          truncated_fields: null
        }
      ],
      dropped_models: 2
    }
    expect(payload.conversation_id).toBe('c1')
    // Array order IS claude's own, carried through unchanged.
    expect(payload.models.map((m) => m.value)).toEqual([
      'default',
      'opus[1m]',
      'claude-fable-5[1m]',
      'sonnet',
      'haiku'
    ])
    // `value` is the ARGUMENT you pass, not a dated identifier and NOT parseable: a literal
    // (`default`), a bare alias (`sonnet`), or a bracketed variant. Splitting on `-` to derive a family
    // is the tempting mistake, and it yields nothing usable on either shape — asserted rather than only
    // commented, because it is the rule a consumer is most likely to break.
    expect(payload.models[1].value).toBe('opus[1m]')
    expect(payload.models[0].value.split('-')).toEqual(['default'])
    expect(payload.models[2].value.split('-')[0]).toBe('claude')
    // `display_name` is the intended join against a per-turn `model_announced` identifier — NOT
    // `resolved_model`, which is `<unmeasured>` on four of the five rows here and so joins nothing.
    expect(payload.models[4].resolved_model).toBe('claude-haiku-4-5-20251001')
    expect(payload.models.filter((m) => m.resolved_model === '<unmeasured>')).toHaveLength(4)
    // `dropped_models` IS COUNTED AND CARRIED, so this arithmetic yields the menu's true size.
    expect(payload.dropped_models).toBe(2)
    expect(payload.models.length + payload.dropped_models).toBe(7)
    // THE FIXTURE DOES NOT SATISFY THE PRODUCER'S OWN INVARIANT, and pinning that is the point of this
    // assertion. Upstream states the producer caps entries at TEN and cuts only the overflow, so a
    // non-zero `dropped_models` always arrives beside exactly ten rows — yet these committed bytes
    // carry five. It is a SHAPE fixture, not a live capture. Nothing may derive the cap from a list
    // length, treat a list of exactly ten as a signal, or hardcode ten: the cap is daemon-side and may
    // change without any change to this contract.
    expect(payload.models.length).toBe(5)
    // A cut is per row and each row reports its OWN. There is no hoisted or flattened list on the
    // payload, so a reader grepping the frame for one finds nothing.
    expect(payload).not.toHaveProperty('truncated_fields')
    expect(payload.models[2].truncated_fields).toEqual(['value'])
    expect(payload.models.filter((m) => m.truncated_fields === null)).toHaveLength(4)
    // Haiku's row is the all-at-once case in the LIVE data: the only real `resolved_model`, the only
    // empty `effort_levels`, and the only `supports_auto_mode: false`. `false` is a VALUE — claude
    // refuses `auto` permission mode per model, and an absent key in claude's reply decodes to `false`,
    // which is the correct reading rather than a missing one.
    expect(payload.models[4].effort_levels).toEqual([])
    expect(payload.models[4].supports_auto_mode).toBe(false)
    expect(payload.models.filter((m) => m.supports_auto_mode)).toHaveLength(4)
  })

  it('admits an EMPTY models array — a positive statement, never a null branch', () => {
    // The daemon's second fixture (model_list_empty.json). `models` is a plain non-optional array
    // because ModelListPayload.MarshalJSON normalises a nil slice to [], so no consumer branches on
    // null, and an empty list IS in contract: it says claude offered nothing. `0` is a VALUE, never
    // consulted for truthiness — the key is always written, so an absent one is a real defect.
    const emptyMenu: ModelListPayload = {
      conversation_id: 'c1',
      models: [],
      dropped_models: 0
    }
    expect(emptyMenu.models).toEqual([])
    expect(emptyMenu.dropped_models).toBe(0)
    expect(emptyMenu.models.length + emptyMenu.dropped_models).toBe(0)
  })

  it('admits the ZERO-VALUE row — empty strings, an empty effort_levels and a null truncated_fields', () => {
    // The daemon's third fixture (model_list_zero.json): one all-zero row, which is the only route to
    // WireModelOption's six keys at once, since a frame carrying no entries reaches none of them.
    const zero: ModelListPayload = {
      conversation_id: '',
      models: [
        {
          resolved_model: '',
          value: '',
          display_name: '',
          effort_levels: [],
          supports_auto_mode: false,
          truncated_fields: null
        }
      ],
      dropped_models: 0
    }
    expect(zero).toEqual({
      conversation_id: '',
      models: [
        {
          resolved_model: '',
          value: '',
          display_name: '',
          effort_levels: [],
          supports_auto_mode: false,
          truncated_fields: null
        }
      ],
      dropped_models: 0
    })
    // '' is a VALUE, never a vanished key: the daemon sets no `omitempty` on any of the nine keys
    // across the two structs, so an empty `display_name` is a real value rather than an absence.
    expect(zero.models[0].display_name).toBe('')
    expect(zero.models[0].effort_levels).toEqual([])
    expect(zero.models[0].truncated_fields).toBeNull()
  })

  it('reads a cut effort_levels as UNKNOWN — truncated_fields is the only signal that [] is not "none"', () => {
    // THE READING RULE, pinned as a predicate rather than left in prose. `effort_levels` collapses
    // claude's ABSENT, its `null` and its EMPTY list into one `[]` — Haiku's live entry omits
    // `supportedEffortLevels` entirely and a client's behaviour is identical for all three (no effort
    // control) — which spares every row an optional-array branch and costs a reader exactly here: with
    // the list cut, `[]` no longer says "none". This is WireSlashCommand's cut-`aliases` hazard
    // transposed onto a different field, and reading a cut list as "none" silently removes an effort
    // control the model actually supports.
    const cutLevels: WireModelOption = {
      resolved_model: '<unmeasured>',
      value: 'sonnet',
      display_name: 'Sonnet',
      effort_levels: [],
      supports_auto_mode: true,
      truncated_fields: ['effort_levels']
    }
    const levelsAreKnownEmpty = (m: WireModelOption): boolean =>
      m.effort_levels.length === 0 && !(m.truncated_fields ?? []).includes('effort_levels')
    expect(levelsAreKnownEmpty(cutLevels)).toBe(false)
    expect(levelsAreKnownEmpty({ ...cutLevels, truncated_fields: null })).toBe(true)
    // A cut naming some OTHER field says nothing about the levels, so the rule keys on the NAME and
    // never on the mere presence of a cut.
    expect(levelsAreKnownEmpty({ ...cutLevels, truncated_fields: ['value'] })).toBe(true)

    // A CUT `value` STILL PASSES THE DAEMON'S INBOUND RULE, which is why `truncated_fields` is
    // load-bearing rather than decoration on this frame specifically. `validModel` is a
    // charset-and-length rule, not a membership check against the published list, so the fixture's cut
    // `claude-fable-5[1m]` row would send back a value that is still alphanumeric and still inside 64
    // bytes — accepted, and selecting a DIFFERENT model, with no error frame anywhere on the path.
    const cutValue: WireModelOption = {
      resolved_model: '<unmeasured>',
      value: 'claude-fable-5',
      display_name: 'Fable',
      effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supports_auto_mode: true,
      truncated_fields: ['value']
    }
    const valueIsSendable = (m: WireModelOption): boolean => !(m.truncated_fields ?? []).includes('value')
    expect(valueIsSendable(cutValue)).toBe(false)
    expect(valueIsSendable({ ...cutValue, truncated_fields: null })).toBe(true)
  })

  it('pins every field as REQUIRED — omitting one is a compile-time error', () => {
    // The no-drift pin, and the load-bearing one: all-required is what will leave the decode slice's
    // fail-closed narrower no optional key to wave through. If any field were ever relaxed to optional,
    // its directive below would stop erroring and fail this file at compile time.

    // @ts-expect-error `resolved_model` is required — no omitempty daemon-side, and '' is a value
    const missingResolved: WireModelOption = {
      value: 'sonnet',
      display_name: 'Sonnet',
      effort_levels: [],
      supports_auto_mode: false,
      truncated_fields: null
    }
    // @ts-expect-error `value` is required — the one field a client sends back, never elided
    const missingValue: WireModelOption = {
      resolved_model: '',
      display_name: 'Sonnet',
      effort_levels: [],
      supports_auto_mode: false,
      truncated_fields: null
    }
    // @ts-expect-error `display_name` is required — the intended join key, and empty is a value
    const missingDisplayName: WireModelOption = {
      resolved_model: '',
      value: 'sonnet',
      effort_levels: [],
      supports_auto_mode: false,
      truncated_fields: null
    }
    // @ts-expect-error `effort_levels` is required and non-optional — nil is normalised to [], never
    // elided, and modelling it optional would invent an absent/empty distinction the wire does not carry
    const missingLevels: WireModelOption = {
      resolved_model: '',
      value: 'sonnet',
      display_name: 'Sonnet',
      supports_auto_mode: false,
      truncated_fields: null
    }
    // @ts-expect-error `supports_auto_mode` is required — `false` is a value, not an absence
    const missingAutoMode: WireModelOption = {
      resolved_model: '',
      value: 'sonnet',
      display_name: 'Sonnet',
      effort_levels: [],
      truncated_fields: null
    }
    // @ts-expect-error `truncated_fields` is required — NULLABLE is not the same as OPTIONAL, and an
    // absent key would decode to `undefined`, which a `?.includes('effort_levels')` reads as "nothing cut"
    const missingTruncated: WireModelOption = {
      resolved_model: '',
      value: 'sonnet',
      display_name: 'Sonnet',
      effort_levels: [],
      supports_auto_mode: false
    }
    // @ts-expect-error `conversation_id` is required — the routing key every interactive event carries
    const missingConversation: ModelListPayload = {
      models: [],
      dropped_models: 0
    }
    // @ts-expect-error `models` is required and non-optional — nil is normalised to [], never elided
    const missingModels: ModelListPayload = {
      conversation_id: 'c1',
      dropped_models: 0
    }
    // @ts-expect-error `dropped_models` is required — the key is always written, so an absent one is a
    // real defect rather than a valid zero
    const missingDropped: ModelListPayload = {
      conversation_id: 'c1',
      models: []
    }
    expect(missingResolved.value).toBe('sonnet')
    expect(missingValue.display_name).toBe('Sonnet')
    expect(missingDisplayName.value).toBe('sonnet')
    expect(missingLevels.value).toBe('sonnet')
    expect(missingAutoMode.value).toBe('sonnet')
    expect(missingTruncated.value).toBe('sonnet')
    expect(missingConversation.dropped_models).toBe(0)
    expect(missingModels.conversation_id).toBe('c1')
    expect(missingDropped.conversation_id).toBe('c1')
  })
})

describe('interrupt wire vocabulary (#1092)', () => {
  it('shapes InterruptPayload as a lone conversation_id and nothing else', () => {
    // Mirrors the daemon SSOT (pyrycode#2103, docs/protocol-mobile.md § Interrupt (v2)): ONE field.
    // No nonce, no idempotency key and no correlation key — the frame is fire-and-forget with no
    // reply, and the daemon documents a replay as simply stopping the turn again.
    const payload: InterruptPayload = { conversation_id: 'conv-1' }
    expect(payload).toEqual({ conversation_id: 'conv-1' })
    expect(Object.keys(payload)).toEqual(['conversation_id'])
  })

  it('keeps conversation_id OPTIONAL — the no-drift pin against tightening it to match the guard', () => {
    // The `new_session` twin's pin, and for the same reason. The wire type mirrors the DAEMON, which
    // publishes the field optional because a bare frame is a compatibility promise: from pyrycode#707
    // until #2103 the frame carried no payload at all, so no payload, `{}`, an absent id and an
    // explicitly empty one are one wire meaning (the process-wide follow-active cursor).
    //
    // This app never sends that form — its command payload is a `Required` derivative and its boundary
    // guard refuses `''` — but the fix for that asymmetry is NEVER to tighten this interface. Doing so
    // would be a wire drift against the mobile/daemon contract (CLAUDE.md no-drift), and this line is
    // what reddens if someone tries: a required field makes the empty literal a TS2741.
    const bare: InterruptPayload = {}
    expect(bare.conversation_id).toBeUndefined()
  })
})

describe('new-session wire vocabulary (#1217)', () => {
  it('admits the new_session outbound envelope type', () => {
    // Compile-time membership: this assigns only if the member is part of EnvelopeType.
    const newSession: EnvelopeType = 'new_session'
    expect(newSession).toBe('new_session')
  })

  it('shapes NewSessionPayload as a lone conversation_id and nothing else', () => {
    // Mirrors the daemon SSOT (pyrycode#2099, docs/protocol-mobile.md § New session (v2)): ONE field.
    // No nonce, no idempotency key and no correlation key — the frame is fire-and-forget with no
    // reply, and a replay simply starts another fresh session, which the daemon documents as harmless.
    const payload: NewSessionPayload = { conversation_id: 'conv-1' }
    expect(payload).toEqual({ conversation_id: 'conv-1' })
    expect(Object.keys(payload)).toEqual(['conversation_id'])
  })

  it('keeps conversation_id OPTIONAL — the no-drift pin against tightening it to match the guard', () => {
    // The wire type mirrors the DAEMON, which publishes the field as optional because a bare frame is
    // a compatibility promise: no payload, `{}`, an absent id and an explicitly empty one are one wire
    // meaning (the process-wide follow-active cursor), so an un-upgraded client keeps working.
    //
    // This app never sends that form — its command payload is a `Required` derivative and its boundary
    // guard refuses `''` — but the fix for that asymmetry is NEVER to tighten this interface. Doing so
    // would be a wire drift against the mobile/daemon contract (CLAUDE.md no-drift), and this line is
    // what reddens if someone tries: a required field makes the empty literal a TS2741.
    const bare: NewSessionPayload = {}
    expect(bare.conversation_id).toBeUndefined()
  })
})
