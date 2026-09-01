import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload, WireQuestion } from '@shared/wire/types'
import { translateQuestionEvent, subscribeQuestionBatches } from './questionBridge'
import { createQuestionBatchStore, selectOutstandingBatches } from './questionBatchStore'

// Fixtures — plain wire-shaped data, mirroring modalBridge.test.ts. No transport involved.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const wireErr: ErrorPayload = {
  code: 'unauthorized',
  message: 'pairing token rejected',
  retryable: false
}

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

// Two questions, deliberately differing in `multi_select` so a hardcoded `false` cannot pass, each with
// its own options array so the by-reference assertions below are per row rather than incidental.
const wireQuestions: readonly WireQuestion[] = [
  {
    question: 'Which strategy should I use?',
    header: 'Write strategy',
    options: [
      { label: 'Rewrite', description: 'Replace the file wholesale' },
      { label: 'Patch', description: 'Apply a minimal diff' }
    ],
    multi_select: false
  },
  {
    question: 'Which files may I touch?',
    header: 'Scope',
    options: [{ label: 'src', description: 'Production sources' }],
    multi_select: true
  }
]

const questionShown: DaemonEvent = {
  type: 'questionShown',
  conversationId: 'conv-7f3a',
  questionBatchId: 'qb_01HZY',
  questions: wireQuestions
}

const questionDismissed: DaemonEvent = {
  type: 'questionDismissed',
  questionBatchId: 'qb_01HZY',
  outcome: 'unanswered',
  source: 'no_answer'
}

describe('translateQuestionEvent — the owned arms', () => {
  it('questionShown → a shown event, a fresh object with multi_select renamed to multiSelect', () => {
    const translated = translateQuestionEvent(questionShown)
    expect(translated).toEqual({
      type: 'shown',
      // Deliberately distinct from `questionBatchId`: both fields are `string`, so tsc cannot catch
      // `conversationId: event.questionBatchId`. This exact match is the only transposition guard.
      conversationId: 'conv-7f3a',
      questionBatchId: 'qb_01HZY',
      questions: [
        {
          question: 'Which strategy should I use?',
          header: 'Write strategy',
          options: [
            { label: 'Rewrite', description: 'Replace the file wholesale' },
            { label: 'Patch', description: 'Apply a minimal diff' }
          ],
          multiSelect: false
        },
        {
          question: 'Which files may I touch?',
          header: 'Scope',
          options: [{ label: 'src', description: 'Production sources' }],
          multiSelect: true
        }
      ]
    })
    // The discriminant is renamed across the boundary: questionShown → 'shown', not 'questionShown'.
    expect(translated?.type).toBe('shown')
  })

  it('rebuilds each question with the exact camelCase key set — no multi_select survives', () => {
    const translated = translateQuestionEvent(questionShown)
    if (translated?.type !== 'shown') throw new Error('expected a shown event')

    // `toEqual` above ignores a surviving extra key on a nested row, so the key SET is asserted
    // directly: this is what proves the rename is a rebuild and not an added alias.
    for (const question of translated.questions) {
      expect(Object.keys(question)).toEqual(['question', 'header', 'options', 'multiSelect'])
      expect(question).not.toHaveProperty('multi_select')
    }
  })

  it("passes each question's options through BY REFERENCE, per row (AC2)", () => {
    const translated = translateQuestionEvent(questionShown)
    if (translated?.type !== 'shown') throw new Error('expected a shown event')

    // The options array itself is held, never copied — matching translateModalEvent's `options:
    // event.options` and reduceQuestionBatches' by-reference hold of `questions` one level up. A
    // per-option rebuild would defend a boundary that is already open above it.
    expect(translated.questions[0].options).toBe(wireQuestions[0].options)
    expect(translated.questions[1].options).toBe(wireQuestions[1].options)
    expect(translated.questions[0].options[0]).toBe(wireQuestions[0].options[0])
  })

  it('rebuilds rather than returning or spreading the event (AC1)', () => {
    const translated = translateQuestionEvent(questionShown)
    if (translated?.type !== 'shown') throw new Error('expected a shown event')

    // Never `return event`, never a spread: the translated event carries the model's key set only, so
    // a DaemonEvent arm gaining an unrelated field later cannot leak into the held model.
    expect(translated).not.toBe(questionShown)
    expect(Object.keys(translated)).toEqual(['type', 'conversationId', 'questionBatchId', 'questions'])
    // The rows are fresh objects too — the rebuild is per question, not a held reference to the wire row.
    expect(translated.questions[0]).not.toBe(wireQuestions[0])
    expect(translated.questions).not.toBe(wireQuestions)
  })

  it('questionDismissed → a dismissed event carrying outcome and source verbatim, a fresh object', () => {
    const translated = translateQuestionEvent(questionDismissed)
    expect(translated).toEqual({
      type: 'dismissed',
      questionBatchId: 'qb_01HZY',
      outcome: 'unanswered',
      source: 'no_answer'
    })
    expect(translated).not.toBe(questionDismissed)
  })

  it('carries an UNRECOGNISED dismissal source through opaquely, never enum-checking it', () => {
    // `source` is a plain open string, deliberately NOT WireModalSource. The producer's landed pair is
    // `no_answer`, but an unrecognised value must still translate — it means *resolved, cause unknown*,
    // never an answer, and a client that dropped it would leave a dead panel on screen.
    const translated = translateQuestionEvent({
      type: 'questionDismissed',
      questionBatchId: 'qb_01HZY',
      outcome: 'some_future_outcome',
      source: 'some_future_source'
    })
    expect(translated).toEqual({
      type: 'dismissed',
      questionBatchId: 'qb_01HZY',
      outcome: 'some_future_outcome',
      source: 'some_future_source'
    })
  })

  it('connected → a payload-free reconnected event, ignoring the ack (AC3)', () => {
    const translated = translateQuestionEvent({ type: 'connected', ack })
    expect(translated).toEqual({ type: 'reconnected' })
    // Nothing off HelloAckPayload rides along: the reset needs no field from the connect ack.
    expect(Object.keys(translated ?? {})).toEqual(['type'])
  })
})

describe('translateQuestionEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for all 38 arms that translate to no QuestionBatchEvent', () => {
    // The complete complement of the three owned arms across the 41-arm DaemonEvent union. AC4's
    // compile-time guarantee comes from `assertNever`, not from this table; the table is what proves
    // each arm is nulled rather than merely unreachable.
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // connected is not here — it is owned, translating to `reconnected` (asserted above).
      { type: 'disconnected' },
      { type: 'failed', error: wireErr },
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [message] },
      { type: 'debugBundleProgress', chunksReceived: 3 },
      { type: 'debugBundleSaved', path: '/downloads/bundle.tar.gz' },
      { type: 'debugBundleFailed', reason: 'unavailable' },
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi', conversationId: 'conv-1' },
      { type: 'turnEnd', turnId: 'A', stopReason: 'end_turn', conversationId: 'conv-1' },
      { type: 'turnState', state: 'thinking', conversationId: 'conv-1' },
      {
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 'A',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts'
      },
      {
        type: 'toolResult',
        conversationId: 'conv-1',
        turnId: 'A',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines'
      },
      {
        type: 'conversationsReceived',
        conversations: [
          {
            id: 'conv-1',
            name: 'My channel',
            is_promoted: true,
            is_archived: false,
            cwd: '/home/user/project',
            last_message_ts: '2026-07-08T00:00:00Z',
            last_used_at: '2026-07-09T00:00:00Z'
          }
        ]
      },
      {
        type: 'conversationCreated',
        conversation: {
          id: 'conv-2',
          is_promoted: false,
          cwd: '/home/user/project',
          name: null,
          last_used_at: '2026-07-09T00:00:00Z'
        }
      },
      {
        type: 'conversationUpdated',
        conversation: {
          id: 'conv-2',
          is_promoted: true,
          name: 'Renamed',
          cwd: '/home/user/project',
          last_used_at: '2026-07-09T00:00:00Z'
        }
      },
      { type: 'conversationDeleted', id: 'conv-2' },
      {
        type: 'recentWorkspacesReceived',
        recentWorkspaces: [{ path: '/home/user/project', last_used_at: '2026-07-09T00:00:00Z' }]
      },
      { type: 'workspaceFolderCreated', path: '/home/user/project/new' },
      { type: 'workspaceFolderRejected' },
      {
        type: 'sessionTransition',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      },
      { type: 'sessionSettingsUpdated', sessionId: 'sess-2', changeId: 'change-x' },
      { type: 'sessionSettingsRejected', changeId: 'change-x' },
      {
        type: 'queueState',
        conversationId: 'conv-1',
        queued: [{ queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' }]
      },
      { type: 'stallDetected', conversationId: 'conv-1' },
      { type: 'relayLinkChanged', status: 'connected' },
      { type: 'notificationActivated' },
      { type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-1' },
      { type: 'compacting', active: true, conversationId: 'conv-1' },
      {
        type: 'unrecognizedMessage',
        conversationId: 'conv-1',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      },
      {
        type: 'backgroundTaskStarted',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        toolCallId: 'toolu_01XYZ',
        description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
        taskType: 'local_bash',
        truncatedFields: ['description']
      },
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        patch: '{"is_backgrounded":tr',
        truncatedFields: ['patch']
      },
      {
        type: 'backgroundTaskRoster',
        conversationId: 'conv-1',
        tasks: [
          {
            task_id: 'task_01ABC',
            task_type: 'local_bash',
            description: "grep -rn 'a<b&c' .",
            truncated_fields: ['description']
          }
        ],
        droppedTasks: 3
      },
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      },
      {
        type: 'runConfigReceived',
        sessionId: 'sess-2',
        model: 'claude-opus-5',
        effort: 'high',
        yolo: false,
        used_tokens: 1200,
        window_tokens: 200000
      },
      // The three arms modalBridge OWNS but this bridge must null — the mirror-image proof, and the
      // one a reader is most tempted to get wrong: a question batch is claude asking the operator to
      // CHOOSE, not a permission prompt gating an action, so neither family routes into the other.
      {
        type: 'modalShown',
        conversationId: 'conv-7f3a',
        modalId: 'mdl-7f3a',
        class: 'permission',
        title: 'Allow Bash?',
        prompt: 'run rm -rf',
        options: [
          { id: 'allow', label: 'Allow' },
          { id: 'deny', label: 'Deny' }
        ],
        defaultOptionId: 'deny'
      },
      { type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' },
      { type: 'modalAnswerRejected', modalId: 'mdl-7f3a' }
    ]

    // The count is asserted so a future arm silently dropped from this table cannot pass unnoticed:
    // 41 union arms minus the 3 owned above.
    expect(others).toHaveLength(38)
    for (const event of others) expect(translateQuestionEvent(event)).toBeNull()
  })
})

describe('subscribeQuestionBatches', () => {
  // A fake onDaemonEvent modelling the real contract: each subscribe registers its own listener, the
  // returned off handle removes THAT listener, and emit fans out to every live one. Modelling the set
  // (rather than a single captured listener) is what makes the double-mount claim below provable.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    offs: ReturnType<typeof vi.fn>[]
    emit: (e: DaemonEvent) => void
    liveListeners: () => number
    subscribeCalls: () => number
  } {
    const listeners = new Set<(e: DaemonEvent) => void>()
    const offs: ReturnType<typeof vi.fn>[] = []
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listeners.add(l)
      const off = vi.fn(() => {
        listeners.delete(l)
      })
      offs.push(off)
      return off
    })
    return {
      onDaemonEvent,
      offs,
      emit: (e) => {
        for (const l of [...listeners]) l(e)
      },
      liveListeners: () => listeners.size,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeQuestionBatches(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('dispatches a translated event for an owned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeQuestionBatches(bridge.onDaemonEvent, dispatch)

    bridge.emit(questionShown)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'shown',
      conversationId: 'conv-7f3a',
      questionBatchId: 'qb_01HZY',
      questions: [
        {
          question: 'Which strategy should I use?',
          header: 'Write strategy',
          options: [
            { label: 'Rewrite', description: 'Replace the file wholesale' },
            { label: 'Patch', description: 'Apply a minimal diff' }
          ],
          multiSelect: false
        },
        {
          question: 'Which files may I touch?',
          header: 'Scope',
          options: [{ label: 'src', description: 'Production sources' }],
          multiSelect: true
        }
      ]
    })
  })

  it('dispatches nothing for an unowned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeQuestionBatches(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent itself as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeQuestionBatches(bridge.onDaemonEvent, vi.fn())
    // Identity, not merely call count: the React binding uses this as its effect cleanup, so it must be
    // the very handle the channel issued rather than a wrapper that could forget to unsubscribe.
    expect(cleanup).toBe(bridge.offs[0])
    cleanup()
    expect(bridge.liveListeners()).toBe(0)
  })

  it('nets exactly one live listener across a StrictMode double-mount (AC5)', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()

    // React StrictMode runs mount → cleanup → mount. The hook's effect body is exactly this call and
    // its cleanup is exactly the returned handle, so driving the seam directly proves the hook's claim
    // without a DOM — which is why the seam is injectable in the first place.
    const firstCleanup = subscribeQuestionBatches(bridge.onDaemonEvent, dispatch)
    firstCleanup()
    subscribeQuestionBatches(bridge.onDaemonEvent, dispatch)

    expect(bridge.subscribeCalls()).toBe(2)
    expect(bridge.liveListeners()).toBe(1)

    // The surviving listener is the second one, and the torn-down first does not double-deliver.
    bridge.emit(questionShown)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeQuestionBatches → the store, end to end (no React)', () => {
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    return {
      onDaemonEvent: (l) => {
        listener = l
        return () => {
          listener = undefined
        }
      },
      emit: (e) => listener?.(e)
    }
  }

  it('a questionShown then a questionDismissed on the same id drives outstanding [1] → []', () => {
    const bridge = fakeBridge()
    const store = createQuestionBatchStore()
    subscribeQuestionBatches(bridge.onDaemonEvent, (event) => store.getState().dispatch(event))

    bridge.emit(questionShown)
    expect(selectOutstandingBatches(store.getState())).toHaveLength(1)
    expect(selectOutstandingBatches(store.getState())[0].questions[0].multiSelect).toBe(false)

    bridge.emit(questionDismissed)
    expect(selectOutstandingBatches(store.getState())).toHaveLength(0)
  })

  it('a dismissal with an unknown id leaves the held batch standing', () => {
    const bridge = fakeBridge()
    const store = createQuestionBatchStore()
    subscribeQuestionBatches(bridge.onDaemonEvent, (event) => store.getState().dispatch(event))

    bridge.emit(questionShown)
    const before = selectOutstandingBatches(store.getState())

    bridge.emit({
      type: 'questionDismissed',
      questionBatchId: 'qb_UNKNOWN',
      outcome: 'unanswered',
      source: 'no_answer'
    })
    // Same reference, not merely equal: the reducer's no-op must not churn a selector.
    expect(selectOutstandingBatches(store.getState())).toBe(before)
  })

  it('a connected after a shown clears the held set, so the re-send is the sole repopulation truth', () => {
    const bridge = fakeBridge()
    const store = createQuestionBatchStore()
    subscribeQuestionBatches(bridge.onDaemonEvent, (event) => store.getState().dispatch(event))

    bridge.emit(questionShown)
    expect(selectOutstandingBatches(store.getState())).toHaveLength(1)

    bridge.emit({ type: 'connected', ack })
    expect(selectOutstandingBatches(store.getState())).toHaveLength(0)

    // A still-outstanding batch re-appends via the daemon's connect-time re-send; absence means it was
    // resolved while the client was away.
    bridge.emit(questionShown)
    expect(selectOutstandingBatches(store.getState())).toHaveLength(1)
  })
})
