import { translateTimelineEvent } from './timelineBridge'
import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent, HistoryTimelineEntry } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import type { ThreadEvent, ThreadItem, TimelineState } from './threadTimeline'

// Fixtures — plain wire-shaped data, mirroring daemonEventBridge.test.ts. No transport involved.
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

describe('translateTimelineEvent — the two owned arms', () => {
  it('assistantDelta → a ThreadEvent assistantDelta keeping turnId/seq/text, the id stopping here', () => {
    const event: DaemonEvent = {
      type: 'assistantDelta',
      turnId: 'A',
      seq: 3,
      text: 'slice',
      conversationId: 'conv-1'
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'assistantDelta', turnId: 'A', seq: 3, text: 'slice' })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('turnEnd → a ThreadEvent turnEnd keeping turnId/stopReason, the id stopping here', () => {
    const event: DaemonEvent = {
      type: 'turnEnd',
      turnId: 'A',
      stopReason: 'max_tokens',
      conversationId: 'conv-1'
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'turnEnd', turnId: 'A', stopReason: 'max_tokens' })
    expect(translated).not.toBe(event)
  })

  it('turnState → a ThreadEvent turnState with the same state, a fresh object, for each phase', () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const event: DaemonEvent = { type: 'turnState', state, conversationId: 'conv-1' }
      const translated = translateTimelineEvent(event)
      expect(translated).toEqual({ type: 'turnState', state })
      // A fresh literal, not a pass-through of the DaemonEvent object.
      expect(translated).not.toBe(event)
    }
  })

  it('toolUse → a ThreadEvent toolUse keeping the render fields, the id stopping here', () => {
    const event: DaemonEvent = {
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({
      type: 'toolUse',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('toolUse carries a several-field input map through unchanged, by reference (#643)', () => {
    // Deliberately NOT alphabetical, so the key-order assertion has teeth, and deliberately
    // non-numeric — JS reorders integer-like string keys ahead of the rest regardless of insertion
    // order, which would make the assertion test the engine rather than the bridge.
    const input = { pattern: 'TODO', path: '/src', output_mode: 'content' }
    const event: DaemonEvent = {
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Grep',
      inputSummary: 'greps /src for TODO',
      input
    }
    const translated = translateTimelineEvent(event) as Extract<ThreadEvent, { type: 'toolUse' }>
    expect(translated).toEqual({
      type: 'toolUse',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Grep',
      inputSummary: 'greps /src for TODO',
      input: { pattern: 'TODO', path: '/src', output_mode: 'content' }
    })
    // Keys and key order reach the ThreadEvent intact — nothing reshaped, reordered or filtered.
    expect(Object.keys(translated.input ?? {})).toEqual(['pattern', 'path', 'output_mode'])
    // The map is carried BY REFERENCE — never `{ ...event.input }`, which would turn an ABSENT map
    // into an empty one — while the containing event is still a fresh literal.
    expect(translated.input).toBe(input)
    expect(translated).not.toBe(event)
  })

  it('toolUse with an ABSENT input map translates to `input === undefined` (#643)', () => {
    // A pre-pyrycode#1678 daemon. Absence must survive the hop: `=== undefined`, never `'input' in …`
    // (structured clone preserves an `undefined`-valued own property, so `in` is true either way).
    const event: DaemonEvent = {
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    }
    const translated = translateTimelineEvent(event) as Extract<ThreadEvent, { type: 'toolUse' }>
    expect(translated.input).toBe(undefined)
    // The other five fields are unchanged.
    expect(translated).toEqual({
      type: 'toolUse',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    })
  })

  it('toolUse with an EMPTY input map translates to an empty map, never undefined (#643)', () => {
    // The post-#1678 "this daemon sent no fields for this call" case — a different fact from absence,
    // and never collapsed into it.
    const event: DaemonEvent = {
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts',
      input: {}
    }
    const translated = translateTimelineEvent(event) as Extract<ThreadEvent, { type: 'toolUse' }>
    expect(translated.input).not.toBe(undefined)
    expect(translated.input).toEqual({})
  })

  it('toolResult → a ThreadEvent toolResult keeping the render fields, the id stopping here', () => {
    const event: DaemonEvent = {
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'read 12 lines'
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({
      type: 'toolResult',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'read 12 lines'
    })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('toolResult carries resultDetail onto the ThreadEvent, still dropping the id (#773)', () => {
    const translated = translateTimelineEvent({
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'read 12 lines',
      resultDetail: '110 of 1676 lines'
    })
    expect(translated).toEqual({
      type: 'toolResult',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'read 12 lines',
      resultDetail: '110 of 1676 lines'
    })
  })

  it('toolResult keeps an EMPTY resultDetail as "", and an absent one absent (#773)', () => {
    const base = {
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'ok'
    } as const

    const empty = translateTimelineEvent({ ...base, resultDetail: '' })
    expect(empty?.type === 'toolResult' ? empty.resultDetail : 'unreachable').toBe('')

    // Absent stays absent: assigned unconditionally, never through a conditional spread that would
    // fold "" into absence — and read as `=== undefined`, never via `in`.
    const absent = translateTimelineEvent(base)
    expect(absent?.type === 'toolResult' ? absent.resultDetail : 'unreachable').toBeUndefined()
  })

  it('sessionTransition → a sessionBoundary ThreadEvent carrying the render fields, dropping newSessionId', () => {
    const event: DaemonEvent = {
      type: 'sessionTransition',
      conversationId: 'conv-transition',
      newSessionId: 'sess-2',
      reason: 'workspace_change',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: '/home/user/next'
    }
    const translated = translateTimelineEvent(event)
    // Exactly the three render fields — newSessionId is dropped (the #259 holder owns it, not the timeline).
    expect(translated).toEqual({
      type: 'sessionBoundary',
      reason: 'workspace_change',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: '/home/user/next'
    })
    expect(translated).not.toHaveProperty('newSessionId')
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('stallDetected → a nullary ThreadEvent stallDetected, a fresh object (#317)', () => {
    const event: DaemonEvent = { type: 'stallDetected', conversationId: 'conv-1' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'stallDetected' })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('apiRetry → a ThreadEvent apiRetry with the same four fields, a fresh object (#493)', () => {
    const event: DaemonEvent = {
      type: 'apiRetry',
      active: true,
      current: 3,
      total: 10,
      conversationId: 'conv-1'
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'apiRetry', active: true, current: 3, total: 10 })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('apiRetry translates the falling edge verbatim — nothing normalized at the bridge (#493)', () => {
    // The wire repeats the last-known counter on the falling edge; discarding it is the reducer's job,
    // not the bridge's. This is a filter + fresh copy, never a remap.
    const event: DaemonEvent = {
      type: 'apiRetry',
      active: false,
      current: 4,
      total: 10,
      conversationId: 'conv-1'
    }
    expect(translateTimelineEvent(event)).toEqual({
      type: 'apiRetry',
      active: false,
      current: 4,
      total: 10
    })
  })

  it('compacting → a ThreadEvent compacting carrying the edge, a fresh object (#496)', () => {
    const event: DaemonEvent = { type: 'compacting', active: true, conversationId: 'conv-1' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'compacting', active: true })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('thinkingProgress → a ThreadEvent carrying the reading alone, the id dropped (#1314)', () => {
    const event: DaemonEvent = {
      type: 'thinkingProgress',
      estimatedTokens: 1200,
      conversationId: 'conv-1'
    }
    const translated = translateTimelineEvent(event)
    // `toEqual` on the whole object is what pins the DROP: a pass-through or a spread would carry
    // `conversationId` into the reducer, and the id must stop at this bridge.
    expect(translated).toEqual({ type: 'thinkingProgress', estimatedTokens: 1200 })
    expect(translated).not.toBe(event)
  })

  it('thinkingProgress → carries a ZERO reading through, never collapsing it to an absence', () => {
    // The wire has no `omitempty`, so the daemon's zero is legal traffic. A translator that tested
    // truthiness would drop it here and the label would read as though nothing had been reported.
    expect(
      translateTimelineEvent({ type: 'thinkingProgress', estimatedTokens: 0, conversationId: 'c' })
    ).toEqual({ type: 'thinkingProgress', estimatedTokens: 0 })
  })

  it('unrecognizedMessage → a ThreadEvent carrying all four fields, a fresh object', () => {
    const event: DaemonEvent = {
      type: 'unrecognizedMessage',
      conversationId: 'conv-1',
      site: 'line_type',
      messageType: 'some_future_event',
      raw: '{"type":"some_future_event"}',
      truncated: false
    }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({
      type: 'unrecognizedMessage',
      site: 'line_type',
      messageType: 'some_future_event',
      raw: '{"type":"some_future_event"}',
      truncated: false
    })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('unrecognizedMessage translates an empty messageType and a truncated payload verbatim', () => {
    const event: DaemonEvent = {
      type: 'unrecognizedMessage',
      conversationId: 'conv-1',
      site: 'undecodable',
      messageType: '',
      raw: '{"type":"assist',
      truncated: true
    }
    expect(translateTimelineEvent(event)).toEqual({
      type: 'unrecognizedMessage',
      site: 'undecodable',
      messageType: '',
      raw: '{"type":"assist',
      truncated: true
    })
  })

  it('compacting translates the falling edge verbatim — the reducer owns the clear (#496)', () => {
    const event: DaemonEvent = { type: 'compacting', active: false, conversationId: 'conv-1' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'compacting', active: false })
    expect(translated).not.toBe(event)
  })

  it('connected → a payload-free reconnected ThreadEvent, ignoring the ack (#538)', () => {
    const event: DaemonEvent = { type: 'connected', ack }
    const translated = translateTimelineEvent(event)
    // The re-handshake reconcile — carries nothing from the HelloAckPayload; the clear needs no field
    // off it.
    expect(translated).toEqual({ type: 'reconnected' })
    expect(translated?.type).toBe('reconnected')
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('sessionTransition preserves a null workspaceCwd for clear / idle_evict (wire nullability)', () => {
    const event: DaemonEvent = {
      type: 'sessionTransition',
      conversationId: 'conv-transition',
      newSessionId: 'sess-3',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    }
    expect(translateTimelineEvent(event)).toEqual({
      type: 'sessionBoundary',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
  })
})

// #1223: the operator's own turn. The daemon stores it as a `message` frame with role `user` and pushes
// none on the interactive lane, so a served page is the only thing that produces one — which is why the
// arm is claimed for the HISTORY shape and gated on the role rather than on where the event came from.
describe('translateTimelineEvent — the messageReceived arm (#1223)', () => {
  it('maps a role-user message to a userText event, over both the live and the history shape', () => {
    const userText = { type: 'userText', received: true, text: 'why did that fail?', messageId: 'm-9' }

    // The history shape: #1227 drops `conversation_id` at the decode, so the arm must not read one.
    expect(
      translateTimelineEvent({
        type: 'messageReceived',
        message: { message_id: 'm-9', role: 'user', text: 'why did that fail?' }
      })
    ).toEqual(userText)

    // The live shape translates identically — the same arm, the conversation id simply dropped.
    expect(
      translateTimelineEvent({
        type: 'messageReceived',
        message: { ...message, message_id: 'm-9', role: 'user', text: 'why did that fail?' }
      })
    ).toEqual(userText)
  })

  it('carries no createdAt even when a clock is injected', () => {
    // AC5's bridge half: the clock is read on `assistantDelta` and nowhere else, so a replayed row can
    // never be stamped with the time it was drawn even on the live path, which does inject one.
    const event = translateTimelineEvent(
      { type: 'messageReceived', message: { message_id: 'm', role: 'user', text: 'q' } },
      () => 12345
    )

    expect(event).toEqual({ type: 'userText', received: true, text: 'q', messageId: 'm' })
  })

  it('draws no row for a role-assistant message, and none for the bulk arm', () => {
    // Assistant content reaches the timeline through `assistantDelta`; a stored assistant `message` is
    // not a user row and must not become one.
    expect(
      translateTimelineEvent({
        type: 'messageReceived',
        message: { message_id: 'm', role: 'assistant', text: 'because' }
      })
    ).toBeNull()
    expect(translateTimelineEvent({ type: 'messagesReceived', messages: [message] })).toBeNull()
  })
})

describe('translateTimelineEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for all non-stream DaemonEvent arms', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // connected is no longer here — #538 flips it to a `reconnected` ThreadEvent (asserted above).
      { type: 'disconnected' },
      { type: 'failed', error: wireErr },
      // #1223 claimed this arm, but only for role `user`; the shared fixture's role is `assistant`, so
      // it still maps to null here. Flipping that fixture's role would break this assertion, not a bug.
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [message] },
      { type: 'debugBundleProgress', chunksReceived: 3 },
      { type: 'debugBundleSaved', path: '/downloads/bundle.tar.gz' },
      { type: 'debugBundleFailed', reason: 'unavailable' },
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
            last_used_at: '2026-07-09T00:00:00Z',
            workspace_label: null
          }
        ]
      },
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
      { type: 'sessionSettingsUpdated', sessionId: 'sess-2', changeId: 'change-x' },
      { type: 'sessionSettingsRejected', changeId: 'change-x' },
      { type: 'modalAnswerRejected', modalId: 'mdl-1' },
      // queue_state is daemon state, not a turn-stream item (#720) — deliberately NOT a timeline row.
      {
        type: 'queueState',
        conversationId: 'conv-1',
        queued: [{ queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' }]
      },
      // relay-link status ships dormant (#328); its consumer is the relay-link store #329, not the
      // timeline store — the relay socket leg is not a turn-stream item.
      { type: 'relayLinkChanged', status: 'connected' },
      // create-folder rejection ships dormant (#396); its consumer is the #397 round-trip store, not the
      // timeline store — it is not a turn-stream item.
      { type: 'workspaceFolderRejected' },
      // chat-create rejection ships dormant (#1307); its consumer is #1308's Add workspace dialog, not
      // the timeline store — it reports that a conversation never came into being, so there is no thread
      // for it to draw in.
      { type: 'conversationCreateRejected' },
      // the announced model ships dormant (#587); its consumer is the #588 announced-model store, not
      // the timeline store. Daemon STATE, not a turn-stream item: the frame carries no turn_id and
      // opens and closes no turn — an identity report ABOUT a turn is not an item IN one.
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      },
      // background-task open ships dormant (#564); its consumer is the #567 background-task store, not
      // the timeline store. Daemon STATE, not a turn-stream item — the wire says so outright: no
      // turn_id, opens and closes no turn, "its own thread of activity, not part of the turn".
      {
        type: 'backgroundTaskStarted',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        toolCallId: 'toolu_01XYZ',
        description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
        taskType: 'local_bash',
        truncatedFields: ['description']
      },
      // background-task update ships dormant (#565); its consumer is the #567 background-task store,
      // not the timeline store. Daemon STATE, not a turn-stream item — the wire says so outright: no
      // turn_id, opens and closes no turn.
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        patch: '{"is_backgrounded":tr',
        status: '',
        summary: '',
        truncatedFields: ['patch']
      },
      // background-task roster ships dormant (#566); its consumer is the #567 background-task store,
      // not the timeline store. Daemon STATE, not a turn-stream item — the wire says so outright: no
      // turn_id, opens and closes no turn.
      {
        type: 'backgroundTaskRoster',
        conversationId: 'conv-1',
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
        droppedTasks: 3
      },
      // the question batch is PERMANENTLY no-op here (#885), not dormant: its consumer is the #850
      // question store plus a dedicated bridge — a FOURTH independent subscriber — so unlike apiRetry
      // and compacting, this case can never flip to an owned arm. Daemon STATE by the queueState rule
      // (#720): the frame carries no turn_id and opens and closes no turn.
      {
        type: 'questionShown',
        conversationId: 'conv-1',
        questionBatchId: 'qb_01HZY',
        questions: [
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
      },
      // and its dismissal (#895) joins on the same queueState rule (#720): the frame carries no
      // turn_id and opens and closes no turn, so retiring a batch is daemon STATE, not a turn-stream
      // item — and PERMANENTLY so, since #850's consumer is a fourth independent subscriber rather
      // than a future case here. `source` is the landed `no_answer`, which is not a WireModalSource
      // member: this typed call site is one of the places a wrongly-annotated arm fails to compile.
      {
        type: 'questionDismissed',
        questionBatchId: 'qb_01HZY',
        outcome: 'unanswered',
        source: 'no_answer'
      },
      // (thinkingProgress is no longer a member — #1314 claimed it as an owned arm, the way #493 and
      // #496 each eventually claimed theirs out of this same group. See its own case below.)
      // the usage-limit reading ships DORMANT (#1319) rather than permanently no-op, which is the
      // disposition thinkingProgress held here until #1314 took it: whether the reading draws as
      // thread chrome through this bridge or through a subscriber of its own is #1320's call. Daemon
      // STATE by the queueState rule (#720) either way — no turn_id, opens and closes no turn.
      {
        type: 'rateLimited',
        conversationId: 'conv-1',
        status: 'allowed_warning',
        limitType: 'seven_day',
        resetsAt: 1_755_900_000
      },
      // the context-window reading ships DORMANT (#1419) on the same terms: whether it draws as thread
      // chrome through this bridge or through a subscriber of its own is #1420's call. Daemon STATE by
      // the queueState rule (#720) either way — no turn_id, opens and closes no turn.
      {
        type: 'contextUsage',
        conversationId: 'conv-1',
        model: 'claude-opus-5',
        totalTokens: 128_400,
        maxTokens: 200_000,
        percentage: 64,
        categories: [{ name: 'System prompt', tokens: 41_200 }],
        droppedCategories: 3,
        mcpTools: [{ name: 'read_file', server_name: 'filesystem', tokens: 1450 }],
        droppedMcpTools: 5,
        memoryFiles: [{ path: '../../../etc/passwd', type: 'user', tokens: 240 }],
        droppedMemoryFiles: 7
      },
      // #1517 TOOK the reset report out of this table. It shipped DORMANT rather than permanently
      // no-op (#1515), the disposition `compacting` held here until #496 took it, and the composer
      // status row is the consumer that reversed it — see the owned-arm describe below.
      // #1621 TOOK the offered file out of this table: it shipped DORMANT (#1620) and the thread's file
      // row is the consumer that reversed it — see the owned-arm describe below.
    ]
    for (const event of others) expect(translateTimelineEvent(event)).toBeNull()
  })
})

describe('translateTimelineEvent — the attachmentOffered arm (#1621)', () => {
  it('translates an offer into a ThreadEvent carrying the attachment and NOT the conversation id', () => {
    const translated = translateTimelineEvent({
      type: 'attachmentOffered',
      conversationId: 'conv-1',
      attachmentId: '3f2a1c40-9b7e-4d21-a5c3-0e8f6b2d9a17',
      filename: 'report.pdf'
    })
    expect(translated).toEqual({
      type: 'attachmentOffered',
      attachment: { attachmentId: '3f2a1c40-9b7e-4d21-a5c3-0e8f6b2d9a17', filename: 'report.pdf' }
    })
    // The routing key stops at the bridge, and the attachment is a fresh two-field literal.
    expect(Object.keys(translated ?? {}).sort()).toEqual(['attachment', 'type'])
    const attachment = translated?.type === 'attachmentOffered' ? translated.attachment : undefined
    expect(Object.keys(attachment ?? {}).sort()).toEqual(['attachmentId', 'filename'])
  })

  it('does not carry an extra key smuggled onto the event object', () => {
    const smuggled = {
      type: 'attachmentOffered',
      conversationId: 'conv-1',
      attachmentId: 'id-1',
      filename: 'a.txt',
      path: '/etc/passwd'
    } as DaemonEvent
    const translated = translateTimelineEvent(smuggled)
    const attachment = translated?.type === 'attachmentOffered' ? translated.attachment : undefined
    expect(Object.keys(attachment ?? {}).sort()).toEqual(['attachmentId', 'filename'])
  })
})

describe('translateTimelineEvent — the resetting arm (#1517)', () => {
  it('translates the rising edge into a ThreadEvent carrying BOTH tokens', () => {
    expect(
      translateTimelineEvent({
        type: 'resetting',
        conversationId: 'conv-reset',
        active: true,
        phase: 'wrapping_up',
        handoff: 'pending'
      })
    ).toEqual({ type: 'resetting', active: true, phase: 'wrapping_up', handoff: 'pending' })
  })

  it('translates the falling edge with its two empty tokens verbatim', () => {
    expect(
      translateTimelineEvent({
        type: 'resetting',
        conversationId: 'conv-reset',
        active: false,
        phase: '',
        handoff: ''
      })
    ).toEqual({ type: 'resetting', active: false, phase: '', handoff: '' })
  })

  it('DROPS conversationId — the routing key stops at the bridge', () => {
    // A fresh named-field literal, never a spread of the DaemonEvent. The id reaches the keyed store
    // through `timelineTargetFor` below, whose index is a Map; it must never reach the reducer, the
    // label or the DOM.
    const translated = translateTimelineEvent({
      type: 'resetting',
      conversationId: 'conv-must-not-cross',
      active: true,
      phase: 'restarting',
      handoff: 'written'
    })
    expect(translated).not.toBeNull()
    expect(Object.keys(translated as object).sort()).toEqual(['active', 'handoff', 'phase', 'type'])
  })
})

describe('translateTimelineEvent — the injected clock (#1013)', () => {
  const delta: DaemonEvent = {
    type: 'assistantDelta',
    turnId: 'A',
    seq: 3,
    text: 'slice',
    conversationId: 'conv-1'
  }

  it('stamps the assistantDelta arm with the injected clock’s exact value', () => {
    expect(translateTimelineEvent(delta, () => 1_700_000_000_000)).toEqual({
      type: 'assistantDelta',
      turnId: 'A',
      seq: 3,
      text: 'slice',
      createdAt: 1_700_000_000_000
    })
  })

  it('leaves createdAt undefined when no clock is injected — absent clock means no stamp', () => {
    const translated = translateTimelineEvent(delta) as { createdAt?: number }
    expect(translated.createdAt).toBe(undefined)
  })

  // AC5's fence at the bridge: the clock reaches exactly one arm. `sessionTransition` is the pointed
  // case — it is the other arm that already carries a time, and it must keep carrying only the wire's.
  it('stamps no other arm — sessionTransition keeps only its wire occurredAt', () => {
    const translated = translateTimelineEvent(
      {
        type: 'sessionTransition',
        conversationId: 'conv-transition',
        reason: 'clear',
        workspaceCwd: '/w',
        occurredAt: '2026-01-15T12:00:00.000Z',
        newSessionId: 's-2'
      },
      () => 1_700_000_000_000
    )
    expect(translated).toEqual({
      type: 'sessionBoundary',
      reason: 'clear',
      workspaceCwd: '/w',
      occurredAt: '2026-01-15T12:00:00.000Z'
    })
  })
})

it('forwards an assistant parent hint through the timeline bridge', () => {
  expect(translateTimelineEvent({ type: 'assistantDelta', conversationId: 'chat', turnId: 't', seq: 0,
    text: 'reply', parentToolUseId: 'agent' })).toMatchObject({
    type: 'assistantDelta', turnId: 't', text: 'reply', parentToolUseId: 'agent'
  })
})

it('ignores switchAgentRejected in the timelineBridge translator', () => {
  expect(translateTimelineEvent({ type: 'switchAgentRejected', conversationId: 'conv-1', retryable: true })).toBeNull()
})
