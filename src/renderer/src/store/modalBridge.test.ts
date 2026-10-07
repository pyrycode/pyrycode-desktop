import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { translateModalEvent, subscribeModal } from './modalBridge'
import { createModalStore, selectOutstanding, selectRejections } from './modalStore'

// Fixtures — plain wire-shaped data, mirroring timelineBridge.test.ts. No transport involved.
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

const modalShown: DaemonEvent = {
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
}

// #1140: the injected "which conversations belong to this server" resolution — a plain stub, since the
// bridge is deliberately store-free. `noConversations` is what a not-loaded or loaded-empty slot answers
// (`EMPTY_CONVERSATION_IDS`), so the clear it produces matches nothing, exactly as a first connect's does.
const noConversations = (): ReadonlySet<string> => new Set()
const listing =
  (...ids: readonly string[]) =>
  (): ReadonlySet<string> =>
    new Set(ids)

describe('translateModalEvent — the owned arms', () => {
  it.each([{ offered: true, rules: ['Bash(touch:*)', 'Read'] }, { offered: false, rules: [] }])(
    'carries the complete offer through bridge and store: %j', (alwaysAllow) => {
      const translated = translateModalEvent({ ...modalShown, alwaysAllow }, noConversations)!
      expect(translated).toHaveProperty('alwaysAllow', alwaysAllow)
      const store = createModalStore()
      store.getState().dispatch(translated)
      expect(selectOutstanding(store.getState())[0]).toHaveProperty('alwaysAllow', alwaysAllow)
    })

  it.each(['plain reason', { checks: [false, 0, null] }, null, false, 0])('preserves optional permission context: %j', (reason) => {
    const context = { reason, reasonType: 'classifier', blockedPath: '/workspace/file',
      description: 'Additional context', defaultToNo: false }
    expect(translateModalEvent({ ...modalShown, ...context }, noConversations)).toMatchObject(context)
  })

  it('does not manufacture absent context properties', () => {
    const translated = translateModalEvent(modalShown, noConversations)
    for (const key of ['reason', 'reasonType', 'blockedPath', 'description', 'defaultToNo']) {
      expect(translated).not.toHaveProperty(key)
    }
  })

  it('modalShown → a ModalEvent shown with the same fields, a fresh object', () => {
    const translated = translateModalEvent(modalShown, noConversations)
    expect(translated).toEqual({
      type: 'shown',
      // Deliberately distinct from `modalId` below: both fields are `string`, so tsc cannot catch
      // `conversationId: event.modalId`. This exact-match expectation is the only transposition guard.
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
    })
    // The discriminant is renamed across the boundary: modalShown → 'shown', not 'modalShown'.
    expect(translated?.type).toBe('shown')
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(modalShown)
  })

  it('modalDismissed → a ModalEvent dismissed with the same fields, a fresh object', () => {
    const event: DaemonEvent = { type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' }
    const translated = translateModalEvent(event, noConversations)
    expect(translated).toEqual({ type: 'dismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
    // The discriminant is renamed across the boundary: modalDismissed → 'dismissed'.
    expect(translated?.type).toBe('dismissed')
    expect(translated).not.toBe(event)
  })

  it('modalAnswerRejected → a ModalEvent rejected carrying only the modalId, a fresh object (#249)', () => {
    const event: DaemonEvent = { type: 'modalAnswerRejected', modalId: 'mdl-9' }
    const translated = translateModalEvent(event, noConversations)
    // Content-free: the translated event carries ONLY the correlation nonce — no daemon error text (AC3).
    expect(translated).toEqual({ type: 'rejected', modalId: 'mdl-9' })
    // The discriminant is renamed across the boundary: modalAnswerRejected → 'rejected'.
    expect(translated?.type).toBe('rejected')
    // A fresh named-field literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('connected → a reconnected ModalEvent carrying the reconnecting server’s conversations (#415, #1140)', () => {
    const event: DaemonEvent = { type: 'connected', ack }
    const translated = translateModalEvent(event, listing('conv-a', 'conv-b'))
    // The re-handshake reset. It carries nothing from the HelloAckPayload — only the conversations the
    // injected resolution answered for the event's own origin.
    expect(translated).toEqual({ type: 'reconnected', conversationIds: new Set(['conv-a', 'conv-b']) })
    expect(translated?.type).toBe('reconnected')
  })
})

describe('translateModalEvent — the reconnect is scoped by the CLIENT-BOUND stamp (#1140)', () => {
  // The origin is a total, opaque lookup key over `ConversationListOrigin`'s three-valued domain, so
  // each of the three selects its own slot and nothing wider — the unstamped cases fall out of the
  // ordinary path rather than needing a special case (AC3).
  const seen = (event: DaemonEvent): unknown[] => {
    const origins: unknown[] = []
    translateModalEvent(event, (origin) => {
      origins.push(origin)
      return new Set<string>()
    })
    return origins
  }

  it('a stamped connected resolves against that server id', () => {
    expect(seen({ type: 'connected', ack, serverId: 'srv-a' } as DaemonEvent)).toEqual(['srv-a'])
  })

  it('an unstamped-null connected resolves against the null slot, not a real id', () => {
    expect(seen({ type: 'connected', ack, serverId: null } as DaemonEvent)).toEqual([null])
  })

  it('a connected with no stamp at all resolves against the undefined slot', () => {
    expect(seen({ type: 'connected', ack })).toEqual([undefined])
  })

  it('reads the STAMP, never the daemon’s own ack.server_id (AC5)', () => {
    // The adversarial case, and the reason `event.ack` is untouched: the ack's `server_id` is a value
    // the DAEMON chose, while the stamp is bound main-side from a paired record this client holds. A
    // hostile daemon naming another server here must not steer whose prompts a reconnect clears.
    const hostileAck: HelloAckPayload = { ...ack, server_id: 'srv-victim' }
    const event = { type: 'connected', ack: hostileAck, serverId: 'srv-a' } as DaemonEvent
    expect(seen(event)).toEqual(['srv-a'])
  })

  it('passes the resolved set through verbatim, by reference', () => {
    // No copy, no filter, no widening between the resolution and the reducer: whatever the client's own
    // conversation list answers IS the clear's key set.
    const ids: ReadonlySet<string> = new Set(['conv-a'])
    const translated = translateModalEvent({ type: 'connected', ack }, () => ids)
    expect(translated).toEqual({ type: 'reconnected', conversationIds: ids })
    expect(translated?.type === 'reconnected' && translated.conversationIds).toBe(ids)
  })

  it('calls the resolution only on the connected arm', () => {
    const resolve = vi.fn(() => new Set<string>())
    translateModalEvent(modalShown, resolve)
    translateModalEvent({ type: 'disconnected' }, resolve)
    expect(resolve).not.toHaveBeenCalled()
    translateModalEvent({ type: 'connected', ack }, resolve)
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})

describe('translateModalEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for every arm that translates to no ModalEvent (the inverse filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // connected is no longer here — #415 flips it to a `reconnected` ModalEvent (asserted above).
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
            last_used_at: '2026-07-09T00:00:00Z',
            workspace_label: null
          }
        ]
      },
      // The five arms timelineBridge OWNS but this bridge must null — the mirror-image proof.
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
        type: 'sessionTransition',
        conversationId: 'conv-transition',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      },
      { type: 'sessionSettingsUpdated', sessionId: 'sess-2', changeId: 'change-x' },
      { type: 'sessionSettingsRejected', changeId: 'change-x' },
      // modalAnswerRejected is no longer here — #249 flips it to a `rejected` ModalEvent (asserted above).
      {
        type: 'queueState',
        conversationId: 'conv-1',
        queued: [{ queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' }]
      },
      // stall ships dormant (#315); its render consumer is #317, not the modal store.
      { type: 'stallDetected', conversationId: 'conv-1' },
      // relay-link status ships dormant (#328); its consumer is the relay-link store #329, not the
      // modal store.
      { type: 'relayLinkChanged', status: 'connected' },
      // create-folder rejection ships dormant (#396); its consumer is the #397 round-trip store, not the
      // modal store.
      { type: 'workspaceFolderRejected' },
      // chat-create rejection ships dormant (#1307); its consumer is #1308's Add workspace dialog, not
      // the modal store — nothing daemon-side is waiting on an answer, so it is not a permission prompt.
      { type: 'conversationCreateRejected' },
      // api-retry ships dormant (#492); its render consumer is #493, not the modal store.
      { type: 'apiRetry', active: true, current: 3, total: 10, conversationId: 'conv-1' },
      // compaction status ships dormant (#495); its render consumer is #496, not the modal store.
      { type: 'compacting', active: true, conversationId: 'conv-1' },
      // the parser-gap diagnostic ships dormant; its render consumer is the timeline row. Nothing is
      // waiting on an answer, so it is emphatically not a modal.
      {
        type: 'unrecognizedMessage',
        conversationId: 'conv-1',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      },
      // the announced model ships dormant (#587); its consumer is the #588 announced-model store, not
      // the modal store — an identity report is not a modal, since nothing is waiting on an answer.
      {
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      },
      // background-task open ships dormant (#564); its consumer is the #567 background-task store, not
      // the modal store — a task claude left running is emphatically not a modal, since nothing is
      // waiting on an answer.
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
      // not the modal store — a change to a task claude left running is not a modal either, since
      // nothing is waiting on an answer.
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        patch: '{"is_backgrounded":tr',
        status: '',
        summary: '',
        truncatedFields: ['patch']
      },
      // background-task progress ships dormant (#1638); its consumer is the #1640 background-task store.
      {
        type: 'backgroundTaskProgress',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        currentActivity: 'Reading beta.txt',
        subagentType: 'general-purpose',
        lastToolName: 'Read',
        totalTokens: 16246,
        toolUses: 2,
        durationMs: 4546,
        truncatedFields: null
      },
      // background-task roster ships dormant (#566); its consumer is the #567 background-task store,
      // not the modal store — a snapshot of what claude left running is not a modal either, since
      // nothing is waiting on an answer.
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
      // question store plus a dedicated bridge — a FOURTH independent subscriber — so unlike
      // `connected`, which #538 flipped to an owned `reconnected`, this case can never flip. A batch
      // of clarifying questions is emphatically NOT a modal in this codebase's sense: `modal_shown`
      // is a permission prompt gating an action, resolved by `modal_answer` against `modal_id`, and
      // this frame has its own nonce, its own outstanding-batch state daemon-side, and no answer
      // frame in the contract at all.
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
      // and its dismissal (#895) is PERMANENTLY no-op here for the same reason — the frame that ends
      // the waiting still routes nowhere near the modal store. `modalDismissed` resolves a permission
      // prompt against `modal_id` under first-answer-wins; this retires a question batch against its
      // own nonce, with no answer frame in the daemon contract at all. `source` is deliberately the
      // landed `no_answer`, which is NOT a WireModalSource member: this typed call site is one of the
      // places an arm wrongly annotated `source: WireModalSource` fails to compile.
      {
        type: 'questionDismissed',
        questionBatchId: 'qb_01HZY',
        outcome: 'unanswered',
        source: 'no_answer'
      },
      // the slash-command menu ships DORMANT here (#937) — its consumer is the #938 store, not the
      // modal store. Nothing is waiting on an answer: this is a published vocabulary the operator may
      // choose to type, not a permission prompt gating an action claude wants to take. Unlike the two
      // question arms above, this no-op is dormant rather than permanent — #938 has not yet decided
      // which subscriber claims it.
      {
        type: 'slashCommandList',
        conversationId: 'conv-1',
        commands: [
          {
            name: 'synth-compact',
            argument_hint: '[instructions]',
            description: 'Synthetic row: nothing was cut for this one.',
            aliases: [],
            truncated_fields: null
          },
          {
            name: 'synth-clear',
            argument_hint: '',
            description: 'Synthetic row: the cut-aliases reading rule.',
            aliases: ['synth-reset'],
            truncated_fields: ['aliases']
          }
        ],
        droppedCommands: 2
      },
      // the model menu ships PERMANENTLY no-op here (#973) — its consumer is the #974 store, which has
      // already committed to a dedicated subscriber, so unlike the sibling directly above this case can
      // never become an owned arm here. Nothing is waiting on an answer: this is the published set of
      // identities claude will run as, not a permission prompt gating an action claude wants to take.
      {
        type: 'modelList',
        conversationId: 'conv-1',
        models: [
          {
            resolved_model: 'synth-model-a-2026',
            value: 'synth-a',
            display_name: 'Synthetic A',
            effort_levels: ['low', 'high'],
            supports_auto_mode: true,
            truncated_fields: null
          },
          {
            resolved_model: '<unmeasured>',
            value: 'synth-b[1m]',
            display_name: 'Synthetic B',
            effort_levels: [],
            supports_auto_mode: false,
            truncated_fields: ['effort_levels']
          }
        ],
        droppedModels: 2
      },
      // the thinking-token reading is PERMANENTLY no-op here (#1313): nothing daemon-side is waiting
      // on an answer, so a reading of how much claude thought is not a permission prompt under any
      // reading. Its consumer is the #1314 render slice.
      { type: 'thinkingProgress', estimatedTokens: 1200, conversationId: 'conv-1' },
      // the usage-limit reading is PERMANENTLY no-op here (#1319) on the same grounds: nothing
      // daemon-side is waiting on an answer and there is no `modal_id` to resolve it against, so a
      // report about the account's usage window gates no action claude wants to take. Whether it ever
      // becomes a dialog is a render decision for #1321 on a surface of its own. Its consumer is the
      // #1320 store slice.
      {
        type: 'rateLimited',
        conversationId: 'conv-1',
        status: 'allowed_warning',
        limitType: 'seven_day',
        resetsAt: 1_755_900_000
      },
      // the context-window reading is PERMANENTLY no-op here (#1419) on the same grounds as the two
      // readings above: nothing daemon-side is waiting on an answer and there is no `modal_id` to
      // resolve it against, so a report of how full the window is gates no action claude wants to
      // take. A near-full window is the strongest invitation in the group to raise AS a dialog, which
      // is exactly why it is refused here — that is a render decision for #1421 on a surface of its
      // own. Its consumer is the #1420 store slice.
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
      // the reset report is PERMANENTLY no-op here (#1515): nothing daemon-side is waiting on an
      // answer, there is no `modal_id` to resolve it against, and the frame gates no action claude
      // wants to take — it reports what the DAEMON is doing to a session, which is the opposite
      // direction from a permission prompt. Its consumers are #1516 and #1517. Both edges are in the
      // table because a falling edge is the member a reader is most tempted to route somewhere that
      // dismisses something.
      {
        type: 'resetting',
        conversationId: 'conv-1',
        active: true,
        phase: 'wrapping_up',
        handoff: 'pending'
      },
      {
        type: 'resetting',
        conversationId: 'conv-1',
        active: false,
        phase: '',
        handoff: ''
      },
      // an offered file is PERMANENTLY no-op here (#1620): nothing daemon-side waits on an answer and
      // there is no `modal_id`. Its consumer is the #1621 thread row.
      {
        type: 'attachmentOffered',
        conversationId: 'conv-1',
        attachmentId: '3f2a1c40-9b7e-4d21-a5c3-0e8f6b2d9a17',
        filename: 'quarterly-secret-report.pdf'
      }
    ]
    for (const event of others) expect(translateModalEvent(event, noConversations)).toBeNull()
  })
})

describe('subscribeModal', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy — the timelineBridge idiom.
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
    subscribeModal(bridge.onDaemonEvent, vi.fn(), noConversations)
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('dispatches a translated event for an owned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeModal(bridge.onDaemonEvent, dispatch, noConversations)

    bridge.emit(modalShown)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'shown',
      // Distinct from `modalId` for the same reason as the translate expectation above.
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
    })
  })

  it('dispatches nothing for an unowned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeModal(bridge.onDaemonEvent, dispatch, noConversations)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup (one-listener guarantee)', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeModal(bridge.onDaemonEvent, vi.fn(), noConversations)
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('a modalShown then modalDismissed with the same modalId drives outstanding [1] → [], no React', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-7f3a'))

    bridge.emit(modalShown)
    expect(selectOutstanding(store.getState())).toHaveLength(1)

    bridge.emit({ type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
    expect(selectOutstanding(store.getState())).toEqual([])
  })

  it('a modalDismissed with an unknown id leaves outstanding [1], same-state no-churn, no React', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-7f3a'))

    bridge.emit(modalShown)
    const afterShown = store.getState()
    expect(selectOutstanding(afterShown)).toHaveLength(1)

    bridge.emit({ type: 'modalDismissed', modalId: 'unknown', outcome: 'allow', source: 'remote' })
    expect(store.getState()).toBe(afterShown)
  })

  it('a modalAnswerRejected drives rejections [] → [1] via the translated rejected event, no React (#249)', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-7f3a'))

    bridge.emit({ type: 'modalAnswerRejected', modalId: 'mdl-9' })
    expect(selectRejections(store.getState())).toEqual(['mdl-9'])
    // The rejection surface is orthogonal to the prompt set — no outstanding prompt was involved.
    expect(selectOutstanding(store.getState())).toEqual([])
  })

  // #416: the renderer-store half of the reconnect reconcile e2e. These fold the SAME ordered
  // DaemonEvent stream a genuine reconnect emits (proven in daemonConnection.roundtrip.test.ts —
  // `connected` then `modalShown`, re-sent or not) through the REAL subscribeModal → translateModalEvent
  // → reduceModal, and assert the clear-then-repopulate at ModalState.outstanding. The transport e2e
  // can't run this half (tsconfig.node.json can't import renderer code), so AC4 splits across the two
  // files at that project boundary; the in-order single daemon-event channel joins them.
  it('reconnect variant 1: a still-held modal re-sent after the reconnect connected surfaces exactly once (#416)', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-7f3a'))

    // Initial connect (empty outstanding → the `reconnected` clear is a no-op), then the modal shows.
    bridge.emit({ type: 'connected', ack })
    bridge.emit(modalShown)
    expect(selectOutstanding(store.getState())).toHaveLength(1)

    // A genuine reconnect re-emits `connected`: translateModalEvent flips it to `reconnected`, clearing
    // outstanding so the daemon's connect-time re-sends are the sole repopulation truth.
    bridge.emit({ type: 'connected', ack })
    expect(selectOutstanding(store.getState())).toEqual([])

    // The daemon re-sends the still-held modal (same modalId) → repopulated exactly once, options +
    // defaultOptionId intact (the answerable precondition), no duplicate.
    bridge.emit(modalShown)
    const outstanding = selectOutstanding(store.getState())
    expect(outstanding).toHaveLength(1)
    expect(outstanding[0]).toEqual({
      // #878: the re-delivered prompt carries its conversation too — distinct from the modal id, so an
      // exact match here catches a transposition the untyped literal hides from `tsc`.
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
    })
  })

  it('reconnect variant 2: a resolved-while-away modal (not re-sent) is gone after the reconnect connected (#416)', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-7f3a'))

    bridge.emit({ type: 'connected', ack })
    bridge.emit(modalShown)
    expect(selectOutstanding(store.getState())).toHaveLength(1)

    // The reconnect `connected` clears outstanding; the daemon does NOT re-send (resolved-while-away),
    // so nothing repopulates it — the prompt is gone.
    bridge.emit({ type: 'connected', ack })
    expect(selectOutstanding(store.getState())).toEqual([])
  })

  it('reconnect variant 3: server B’s reconnect leaves server A’s prompt on screen (#1140 AC1)', () => {
    // The whole path in one case: two servers each waiting on a decision, B's link drops and comes back,
    // and the resolution answers B's conversations only. Before #1140 this emptied the store.
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e), listing('conv-b'))

    bridge.emit({ ...modalShown, conversationId: 'conv-a', modalId: 'mdl-a' })
    bridge.emit({ ...modalShown, conversationId: 'conv-b', modalId: 'mdl-b' })
    expect(selectOutstanding(store.getState())).toHaveLength(2)

    bridge.emit({ type: 'connected', ack, serverId: 'srv-b' } as DaemonEvent)
    expect(selectOutstanding(store.getState()).map((p) => p.modalId)).toEqual(['mdl-a'])
  })
})

it('ignores switchAgentRejected in the modalBridge translator', () => {
  expect(translateModalEvent({ type: 'switchAgentRejected', conversationId: 'conv-1', retryable: true }, () => new Set())).toBeNull()
})
