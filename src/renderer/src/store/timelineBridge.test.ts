import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import {
  translateTimelineEvent,
  timelineTargetFor,
  timelineWriteTarget,
  subscribeTimeline
} from './timelineBridge'
import {
  createTimelineStore,
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry
} from './timelineStore'
import {
  createConversationTimelineStore,
  selectTimelineFor
} from './conversationTimelineStore'
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

  it('sessionTransition → a sessionBoundary ThreadEvent carrying the render fields, dropping newSessionId', () => {
    const event: DaemonEvent = {
      type: 'sessionTransition',
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

describe('translateTimelineEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for all non-stream DaemonEvent arms', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // connected is no longer here — #538 flips it to a `reconnected` ThreadEvent (asserted above).
      { type: 'disconnected' },
      { type: 'failed', error: wireErr },
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
            last_used_at: '2026-07-09T00:00:00Z'
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
      }
    ]
    for (const event of others) expect(translateTimelineEvent(event)).toBeNull()
  })
})

// #756: attribution is a SECOND pure function beside the translator, never a widening of its return
// type — all 19 `translateTimelineEvent` call sites above stay untouched, which is what makes them
// this ticket's no-op evidence. Each row below uses a DISTINCT id, so a copy-paste that reads a
// neighbour's field fails rather than passing on a shared `'conv-1'`.
describe('timelineTargetFor', () => {
  const idCarrying: readonly (readonly [string, DaemonEvent])[] = [
    [
      'conv-delta',
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi', conversationId: 'conv-delta' }
    ],
    [
      'conv-turn-end',
      { type: 'turnEnd', turnId: 'A', stopReason: 'end_turn', conversationId: 'conv-turn-end' }
    ],
    ['conv-turn-state', { type: 'turnState', state: 'thinking', conversationId: 'conv-turn-state' }],
    [
      'conv-tool-use',
      {
        type: 'toolUse',
        conversationId: 'conv-tool-use',
        turnId: 'A',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts'
      }
    ],
    [
      'conv-tool-result',
      {
        type: 'toolResult',
        conversationId: 'conv-tool-result',
        turnId: 'A',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines'
      }
    ],
    ['conv-stall', { type: 'stallDetected', conversationId: 'conv-stall' }],
    [
      'conv-retry',
      { type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-retry' }
    ],
    ['conv-compacting', { type: 'compacting', active: true, conversationId: 'conv-compacting' }],
    [
      'conv-unrecognized',
      {
        type: 'unrecognizedMessage',
        conversationId: 'conv-unrecognized',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      }
    ]
  ]

  it('returns each id-carrying owned arm its OWN conversation id (all nine)', () => {
    expect(idCarrying).toHaveLength(9)
    for (const [expected, event] of idCarrying) {
      expect(timelineTargetFor(event)).toBe(expected)
    }
  })

  // The two owned arms that carry no routing key. They are NOT dormant — each still reaches the
  // flat store — but there is nothing to attribute them to, and inventing one is what AC3 bans.
  it('returns null for sessionTransition — it carries newSessionId, not a conversation id', () => {
    const event: DaemonEvent = {
      type: 'sessionTransition',
      newSessionId: 'sess-2',
      reason: 'workspace_change',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: '/home/user/next'
    }
    expect(timelineTargetFor(event)).toBeNull()
  })

  it('returns null for connected — a connection edge has no conversation by nature', () => {
    expect(timelineTargetFor({ type: 'connected', ack })).toBeNull()
  })
})

// #785: the write-key half of the routing contract. `timelineTargetFor` above answers "what did the
// event say"; this answers "which slice does the fan-out write into" — and the two are separate
// functions precisely so the open conversation never becomes a property of the event.
describe('timelineWriteTarget (#785)', () => {
  it("returns the event's OWN id and never consults the open conversation", () => {
    const getOpen = vi.fn((): string | null => 'conv-open')
    const event: ThreadEvent = { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' }

    expect(timelineWriteTarget(event, 'conv-own', getOpen)).toBe('conv-own')
    // The strongest statement of "no misattribution": an attributed arm cannot be diverted by what
    // happens to be on screen, because the open conversation is never even read for it.
    expect(getOpen).not.toHaveBeenCalled()
  })

  it('files a sessionBoundary into the conversation on screen', () => {
    const getOpen = vi.fn((): string | null => 'conv-open')
    const event: ThreadEvent = {
      type: 'sessionBoundary',
      reason: 'workspace_change',
      workspaceCwd: '/home/user/next',
      occurredAt: '2026-07-10T00:00:00.000000000Z'
    }

    expect(timelineWriteTarget(event, null, getOpen)).toBe('conv-open')
    expect(getOpen).toHaveBeenCalledTimes(1)
  })

  it('files a reconnect into the conversation on screen', () => {
    expect(timelineWriteTarget({ type: 'reconnected' }, null, () => 'conv-open')).toBe('conv-open')
  })

  it('AC3: returns null when no conversation is open, inventing no key', () => {
    expect(timelineWriteTarget({ type: 'reconnected' }, null, () => null)).toBeNull()
  })

  // Unreachable in production today — `sessionTransition`'s wire payload has no conversation id. It is
  // pinned because it is what makes a future wire widening safe with no edit here: the event's own
  // attribution wins, so the switch can never silently override a real id.
  it('the precedence pin: an id on an id-less arm still wins over the open conversation', () => {
    const getOpen = vi.fn((): string | null => 'conv-open')
    const event: ThreadEvent = {
      type: 'sessionBoundary',
      reason: 'workspace_change',
      workspaceCwd: null,
      occurredAt: '2026-07-10T00:00:00.000000000Z'
    }

    expect(timelineWriteTarget(event, 'conv-own', getOpen)).toBe('conv-own')
    expect(getOpen).not.toHaveBeenCalled()
  })

  // The fallback is ENUMERATED, never blanket: an unattributed arm outside the two named ones falls to
  // `default` and is dropped from the keyed path — the same safe failure direction `timelineTargetFor`
  // has. A blanket `conversationId ?? getOpen()` would file it onto the thread on screen instead.
  it("the default's safe direction: any other unattributed arm resolves to null, getter untouched", () => {
    const getOpen = vi.fn((): string | null => 'conv-open')

    expect(timelineWriteTarget({ type: 'userText', text: 'x' }, null, getOpen)).toBeNull()
    expect(getOpen).not.toHaveBeenCalled()
  })
})

describe('subscribeTimeline', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy — the runConfigSnapshot
  // fakeBridge idiom.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
    off: ReturnType<typeof vi.fn>
    subscribeCalls: () => number
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    const off = vi.fn()
    const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
      listener = l
      return off
    })
    return {
      onDaemonEvent,
      emit: (e) => listener?.(e),
      off,
      subscribeCalls: () => onDaemonEvent.mock.calls.length
    }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeTimeline(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  // #756 added the second argument: `toHaveBeenCalledWith` pins the WHOLE argument list, so this is the
  // one existing assertion the arity widening could not leave alone. The other nineteen call sites —
  // eighteen here and one in interactiveRoundtrip.test.tsx — pass a 1-arity spy or callback and are
  // untouched, because arity 1 is assignable to a parameter typed at arity 2.
  it('dispatches a translated event, and its conversation id, for an owned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeTimeline(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi', conversationId: 'conv-1' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' },
      'conv-1'
    )
  })

  it('dispatches nothing for an unowned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeTimeline(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  // #756: an owned arm with nothing to attribute passes `null` through the same second argument — the
  // routing key is never omitted and never substituted for.
  it('#756: an id-less owned arm passes null as the second argument, never a substitute id', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeTimeline(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connected', ack })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'reconnected' }, null)
  })

  it('returns the off handle from onDaemonEvent as the cleanup (one-listener guarantee)', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeTimeline(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('AC2: two same-turn deltas drive the store to one coalesced assistantText, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const sequence: DaemonEvent[] = [
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'Hel', conversationId: 'conv-1' },
      { type: 'assistantDelta', turnId: 'A', seq: 1, text: 'lo', conversationId: 'conv-1' }
    ]
    for (const event of sequence) bridge.emit(event)

    const items = selectItems(store.getState())
    expect(items).toHaveLength(1)
    const item = items[0] as Extract<ThreadItem, { kind: 'assistantText' }>
    expect(item.kind).toBe('assistantText')
    expect(item.text).toBe('Hello')
  })

  it('AC5: a turnState event drives the store phase; all three states round-trip, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    for (const state of ['thinking', 'responding', 'idle'] as const) {
      bridge.emit({ type: 'turnState', state, conversationId: 'conv-1' })
      expect(selectPhase(store.getState())).toBe(state)
    }
  })

  it('AC5: re-emitting the current state is a no-churn no-op (same state reference)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    const afterFirst = store.getState()
    expect(selectPhase(afterFirst)).toBe('thinking')

    // Same state again — the reducer returns the same state object, so the store does not churn.
    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    expect(store.getState()).toBe(afterFirst)
  })

  it('AC5: a toolUse event appends one pending toolCall item (result: null) via the store, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    })

    const items = selectItems(store.getState())
    expect(items).toHaveLength(1)
    const item = items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(item).toEqual({
      kind: 'toolCall',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts',
      result: null
    })
  })

  it('AC5: a delta → toolUse → delta yields [assistantText, toolCall, assistantText] (the #121 split)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const sequence: DaemonEvent[] = [
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'before ', conversationId: 'conv-1' },
      {
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 'A',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts'
      },
      { type: 'assistantDelta', turnId: 'A', seq: 1, text: 'after', conversationId: 'conv-1' }
    ]
    for (const event of sequence) bridge.emit(event)

    const items = selectItems(store.getState())
    expect(items.map((i) => i.kind)).toEqual(['assistantText', 'toolCall', 'assistantText'])
  })

  it('AC3: a toolUse then a correlated toolResult fills the call result in place (isError false)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const sequence: DaemonEvent[] = [
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
      }
    ]
    for (const event of sequence) bridge.emit(event)

    const items = selectItems(store.getState())
    expect(items).toHaveLength(1)
    const item = items[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(item.result).toEqual({ isError: false, resultSummary: 'read 12 lines' })
  })

  it('AC3: a correlated toolResult with isError:true fills an error result in place', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const sequence: DaemonEvent[] = [
      {
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 'A',
        toolUseId: 'tu-1',
        name: 'Bash',
        inputSummary: 'rm -rf build/'
      },
      {
        type: 'toolResult',
        conversationId: 'conv-1',
        turnId: 'A',
        toolUseId: 'tu-1',
        isError: true,
        resultSummary: 'permission denied'
      }
    ]
    for (const event of sequence) bridge.emit(event)

    const item = selectItems(store.getState())[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(item.result).toEqual({ isError: true, resultSummary: 'permission denied' })
  })

  it('AC3: an orphan toolResult (no matching toolCall) is a deterministic no-op (same state ref)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const before = store.getState()
    bridge.emit({
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'nope',
      isError: false,
      resultSummary: 'x'
    })

    // No pending toolCall → fillResult returns the same array → the reducer returns the same state.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  it('AC3: a duplicate toolResult (call already resolved) is a no-op — result not overwritten', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({
      type: 'toolUse',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      name: 'Read',
      inputSummary: 'reads /etc/hosts'
    })
    bridge.emit({
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'read 12 lines'
    })
    const afterFirst = store.getState()

    // A second toolResult for the same toolUseId — the call is already resolved, so it is a no-op.
    bridge.emit({
      type: 'toolResult',
      conversationId: 'conv-1',
      turnId: 'A',
      toolUseId: 'tu-1',
      isError: true,
      resultSummary: 'overwrite attempt'
    })

    expect(store.getState()).toBe(afterFirst)
    const item = selectItems(store.getState())[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(item.result).toEqual({ isError: false, resultSummary: 'read 12 lines' })
  })

  it('#317: a stallDetected daemon event drives the store stalled flag true, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    expect(selectStalled(store.getState())).toBe(false)
    bridge.emit({ type: 'stallDetected', conversationId: 'conv-1' })
    expect(selectStalled(store.getState())).toBe(true)
  })

  it('#493: an apiRetry rising edge drives the store status, and the falling edge clears it, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    expect(selectApiRetry(store.getState())).toBeNull()
    bridge.emit({ type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-1' })
    expect(selectApiRetry(store.getState())).toEqual({ current: 3, total: 10 })

    // The falling edge repeats the last-known counter; the status still clears.
    bridge.emit({ type: 'apiRetry', active: false, current: 3, total: 10, conversationId: 'conv-1' })
    expect(selectApiRetry(store.getState())).toBeNull()
  })

  it('#587: a modelAnnounced daemon event creates NO timeline item (ships dormant)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const before = store.getState()
    bridge.emit({
      type: 'modelAnnounced',
      model: 'claude-haiku-4-5-20251001',
      truncated: false,
      conversationId: 'conv-1'
    })

    // Both halves, as elsewhere: the bridge filtered it out so no dispatch reached the reducer (same
    // state ref), AND no chat row exists.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  it('#564: a backgroundTaskStarted daemon event creates NO timeline item (ships dormant)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const before = store.getState()
    bridge.emit({
      type: 'backgroundTaskStarted',
      conversationId: 'conv-1',
      taskId: 'task_01ABC',
      toolCallId: 'toolu_01XYZ',
      description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
      taskType: 'local_bash',
      truncatedFields: ['description']
    })

    // Both halves: the bridge filtered it out so no dispatch reached the reducer (same state ref), AND
    // no chat row exists. The length assertion alone would be vacuous against an already-empty store.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  it('#565: a backgroundTaskUpdated daemon event creates NO timeline item (ships dormant)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const before = store.getState()
    bridge.emit({
      type: 'backgroundTaskUpdated',
      conversationId: 'conv-1',
      taskId: 'task_01ABC',
      patch: '{"is_backgrounded":tr',
      truncatedFields: ['patch']
    })

    // Both halves, as above: same state ref (nothing dispatched) AND no chat row.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  it('#566: a backgroundTaskRoster daemon event creates NO timeline item (ships dormant)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const before = store.getState()
    bridge.emit({
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
    })

    // Both halves, as above: same state ref (nothing dispatched) AND no chat row.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  // #756: the fan-out, driven through TWO REAL stores by a callback IDENTICAL IN SHAPE to
  // `useTimelineBridge`'s (timelineBridge.ts) — flat first and unconditional, keyed second and guarded
  // on the resolved write target. The hook body stays untested window glue; this local helper is what
  // covers its logic, and keeping it a faithful copy is what lets review diff the two side by side.
  // #785 moved the decision itself into `timelineWriteTarget`, so the copy shrank to three statements.
  describe('the dual write into both stores (#756)', () => {
    function fanOut(
      flat: ReturnType<typeof createTimelineStore>,
      keyed: ReturnType<typeof createConversationTimelineStore>,
      getOpenConversationId: () => string | null
    ): (event: ThreadEvent, conversationId: string | null) => void {
      return (event, conversationId) => {
        flat.getState().dispatch(event)
        const target = timelineWriteTarget(event, conversationId, getOpenConversationId)
        if (target !== null) keyed.getState().dispatchFor(target, event)
      }
    }

    // The open conversation is a MUTABLE local read through the injected getter, not a constructor
    // argument: the operator switching chats between two events on one long-lived listener is a case
    // these tests have to be able to express (#785). It starts `null` — no conversation open.
    function wired(): {
      bridge: ReturnType<typeof fakeBridge>
      flat: ReturnType<typeof createTimelineStore>
      keyed: ReturnType<typeof createConversationTimelineStore>
      setOpen: (conversationId: string | null) => void
    } {
      const bridge = fakeBridge()
      const flat = createTimelineStore()
      const keyed = createConversationTimelineStore()
      let open: string | null = null
      subscribeTimeline(bridge.onDaemonEvent, fanOut(flat, keyed, () => open))
      return {
        bridge,
        flat,
        keyed,
        setOpen: (conversationId) => {
          open = conversationId
        }
      }
    }

    const sliceOf = (
      keyed: ReturnType<typeof createConversationTimelineStore>,
      conversationId: string
    ): TimelineState | null => selectTimelineFor(conversationId)(keyed.getState())

    const textOf = (items: readonly ThreadItem[] | undefined, at: number): string | undefined =>
      (items?.[at] as Extract<ThreadItem, { kind: 'assistantText' }> | undefined)?.text

    it('AC1: an id-carrying arm lands in BOTH the flat timeline and its own conversation slice', () => {
      const { bridge, flat, keyed } = wired()

      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'Hello',
        conversationId: 'conv-a'
      })

      expect(selectItems(flat.getState())).toHaveLength(1)
      expect(textOf(selectItems(flat.getState()), 0)).toBe('Hello')

      const slice = sliceOf(keyed, 'conv-a')
      expect(slice).not.toBeNull()
      expect(slice?.items).toHaveLength(1)
      expect(textOf(slice?.items, 0)).toBe('Hello')
    })

    // The failure this ticket exists to fix: interleaved frames for two conversations. Both slices are
    // asserted by CONTENT — a map-size assertion alone would pass while one thread clobbered the other.
    it('AC2: interleaved a → b → a events each land in their own slice, neither clobbering the other', () => {
      const { bridge, keyed } = wired()

      const sequence: DaemonEvent[] = [
        { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'a1 ', conversationId: 'conv-a' },
        { type: 'assistantDelta', turnId: 'B', seq: 0, text: 'b1', conversationId: 'conv-b' },
        { type: 'assistantDelta', turnId: 'A', seq: 1, text: 'a2', conversationId: 'conv-a' }
      ]
      for (const event of sequence) bridge.emit(event)

      const a = sliceOf(keyed, 'conv-a')
      const b = sliceOf(keyed, 'conv-b')
      expect(a?.items).toHaveLength(1)
      expect(textOf(a?.items, 0)).toBe('a1 a2')
      expect(b?.items).toHaveLength(1)
      expect(textOf(b?.items, 0)).toBe('b1')
    })

    it('AC2: an event for a never-opened conversation creates ITS slice and touches no other', () => {
      const { bridge, keyed } = wired()

      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'open',
        conversationId: 'conv-open'
      })
      const openBefore = sliceOf(keyed, 'conv-open')

      // An id the holder has never seen and the operator has never viewed: folded, never discarded.
      bridge.emit({
        type: 'assistantDelta',
        turnId: 'X',
        seq: 0,
        text: 'stray',
        conversationId: 'conv-unowned'
      })

      const unowned = sliceOf(keyed, 'conv-unowned')
      expect(unowned?.items).toHaveLength(1)
      expect(textOf(unowned?.items, 0)).toBe('stray')
      // The open conversation's slice is untouched BY REFERENCE — not merely equal.
      expect(sliceOf(keyed, 'conv-open')).toBe(openBefore)
    })

    // #785 made this test's AC3 half CONDITIONAL — with a conversation open both arms now file into it
    // — so the name has to say which case it pins. Its AC4 half was always unconditional and is
    // unchanged: the flat store receives both arms exactly as it does today.
    it('AC3/AC4: with NO conversation open, the two id-less arms reach flat and create NO slice', () => {
      const { bridge, flat, keyed } = wired()

      const idLess: DaemonEvent[] = [
        {
          type: 'sessionTransition',
          newSessionId: 'sess-2',
          reason: 'workspace_change',
          occurredAt: '2026-07-10T00:00:00.000000000Z',
          workspaceCwd: '/home/user/next'
        },
        { type: 'connected', ack }
      ]
      for (const event of idLess) bridge.emit(event)

      // AC4: exactly the flat rows these arms produce today — sessionBoundary tail-appends;
      // `connected` → `reconnected` reconciles chrome and adds no row.
      expect(selectItems(flat.getState()).map((i) => i.kind)).toEqual(['sessionBoundary'])
      // AC3: nothing was attributed, so no slice was invented for the open conversation or any other.
      expect(keyed.getState().timelines.size).toBe(0)
    })

    // The probe stays `sessionTransition` (#784 chose it, #785 keeps it) because it tail-appends a real
    // row: a write landing on the wrong slice is visible in that slice's items, not merely in a fresh
    // reference. Asserting against an EMPTY map would pass for the wrong reason — misfiling needs
    // somewhere to misfile into — so both tests below hold a slice for a conversation that is NOT the
    // one on screen.
    it('AC1: a session boundary lands in the conversation ON SCREEN, not in another held slice', () => {
      const { bridge, keyed, setOpen } = wired()

      setOpen('conv-a')
      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'held',
        conversationId: 'conv-a'
      })
      const aBefore = sliceOf(keyed, 'conv-a')
      expect(aBefore).not.toBeNull()

      // The operator switches chats between the two events — the write follows the SCREEN, per event.
      setOpen('conv-b')
      bridge.emit({
        type: 'sessionTransition',
        newSessionId: 'sess-2',
        reason: 'workspace_change',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: '/home/user/next'
      })

      expect(sliceOf(keyed, 'conv-b')?.items.map((i) => i.kind)).toEqual(['sessionBoundary'])
      // conv-a is untouched BY REFERENCE — not merely equal.
      expect(sliceOf(keyed, 'conv-a')).toBe(aBefore)
    })

    it('AC1: a session boundary tail-appends into the thread being read, in arrival order', () => {
      const { bridge, keyed, setOpen } = wired()

      setOpen('conv-a')
      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'held',
        conversationId: 'conv-a'
      })
      bridge.emit({
        type: 'sessionTransition',
        newSessionId: 'sess-2',
        reason: 'workspace_change',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: '/home/user/next'
      })

      expect(sliceOf(keyed, 'conv-a')?.items.map((i) => i.kind)).toEqual([
        'assistantText',
        'sessionBoundary'
      ])
    })

    // AC2, through both halves of the reducer's Mode A / Mode B split: the chrome scalars reset while
    // `items` survives BY REFERENCE (threadTimeline.ts). The retry status is driven through the bridge
    // by a real rising edge rather than hand-built, so the fixture cannot drift from the reducer.
    it("AC2: a reconnect clears the open thread's chrome and leaves its rows by reference", () => {
      const { bridge, keyed, setOpen } = wired()

      setOpen('conv-a')
      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'held',
        conversationId: 'conv-a'
      })
      bridge.emit({
        type: 'apiRetry',
        active: true,
        current: 3,
        total: 10,
        conversationId: 'conv-a'
      })
      const before = sliceOf(keyed, 'conv-a')
      expect(before?.apiRetry).not.toBeNull()
      const itemsBefore = before?.items

      bridge.emit({ type: 'connected', ack })

      const after = sliceOf(keyed, 'conv-a')
      expect(after?.apiRetry).toBeNull()
      expect(after?.items).toBe(itemsBefore)
    })

    it('AC3: a reconnect with no conversation open leaves a held slice untouched by reference', () => {
      const { bridge, keyed } = wired()

      bridge.emit({
        type: 'assistantDelta',
        turnId: 'A',
        seq: 0,
        text: 'held',
        conversationId: 'conv-a'
      })
      bridge.emit({
        type: 'apiRetry',
        active: true,
        current: 3,
        total: 10,
        conversationId: 'conv-a'
      })
      const before = sliceOf(keyed, 'conv-a')
      expect(before?.apiRetry).not.toBeNull()

      bridge.emit({ type: 'connected', ack })

      // The whole slice by reference — the stuck banner stays stuck rather than being reconciled onto
      // a conversation nobody is reading, and no key was invented.
      expect(sliceOf(keyed, 'conv-a')).toBe(before)
      expect(keyed.getState().timelines.size).toBe(1)
    })

    // #784: the parser-gap diagnostic is now an id-carrying arm, so it files into its own thread.
    // AC3's end-to-end half — the table above covers `timelineTargetFor` in isolation, this covers
    // the whole seam: emit → translate → attribute → both stores.
    it('AC3/AC4: unrecognizedMessage lands in its OWN slice, no other, and still reaches flat', () => {
      const { bridge, flat, keyed } = wired()

      bridge.emit({
        type: 'unrecognizedMessage',
        conversationId: 'conv-a',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      })
      const aBefore = sliceOf(keyed, 'conv-a')
      expect(aBefore?.items.map((i) => i.kind)).toEqual(['unrecognizedMessage'])

      bridge.emit({
        type: 'unrecognizedMessage',
        conversationId: 'conv-b',
        site: 'undecodable',
        messageType: '',
        raw: '{"type":"assist',
        truncated: true
      })

      expect(sliceOf(keyed, 'conv-b')?.items.map((i) => i.kind)).toEqual(['unrecognizedMessage'])
      // conv-a is untouched BY REFERENCE — not merely equal.
      expect(sliceOf(keyed, 'conv-a')).toBe(aBefore)
      // AC4: the flat store still receives the arm exactly as it does today — both rows.
      expect(selectItems(flat.getState()).map((i) => i.kind)).toEqual([
        'unrecognizedMessage',
        'unrecognizedMessage'
      ])
    })
  })
})
