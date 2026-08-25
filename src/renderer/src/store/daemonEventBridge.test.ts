import { describe, it, expect } from 'vitest'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { createSessionStore, initialSessionState, type SessionAction } from './sessionStore'
import { translateDaemonEvent } from './daemonEventBridge'

// Fixtures — plain wire-shaped data, mirroring sessionStore.test.ts. No transport involved.
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

function msg(message_id: string, role: MessagePayload['role'] = 'assistant'): MessagePayload {
  return { conversation_id: 'conv-1', message_id, role, text: `text ${message_id}` }
}

// Mirrors useDaemonEventBridge's real null-skip: `translateDaemonEvent` now returns
// `SessionAction | null` (the debug-bundle events map to no action), so dispatching its result
// must skip on `null` rather than push `null` into the store. Threading every call site through
// this helper keeps the nine tests uniform with the bridge's production behaviour.
function dispatchIfAction(
  store: ReturnType<typeof createSessionStore>,
  action: SessionAction | null
): void {
  if (action) store.getState().dispatch(action)
}

describe('translateDaemonEvent — each variant dispatched into a fresh store', () => {
  it('connecting → status connecting', () => {
    const store = createSessionStore()
    dispatchIfAction(store, translateDaemonEvent({ type: 'connecting' }))
    expect(store.getState().status).toEqual({ type: 'connecting' })
  })

  it('connected → status connected carrying the ack by reference', () => {
    const store = createSessionStore()
    dispatchIfAction(store, translateDaemonEvent({ type: 'connected', ack }))
    const status = store.getState().status
    expect(status).toEqual({ type: 'connected', ack })
    if (status.type === 'connected') {
      expect(status.ack).toBe(ack)
    }
  })

  it('disconnected → status disconnected', () => {
    const store = createSessionStore()
    dispatchIfAction(store, translateDaemonEvent({ type: 'disconnected' }))
    expect(store.getState().status).toEqual({ type: 'disconnected' })
  })

  it('failed → status error copying the wire ErrorPayload into a fresh ConnectionError', () => {
    const store = createSessionStore()
    dispatchIfAction(store, translateDaemonEvent({ type: 'failed', error: wireErr }))
    const status = store.getState().status
    expect(status).toEqual({
      type: 'error',
      error: { code: 'unauthorized', message: 'pairing token rejected', retryable: false }
    })
    // The conversion is a field-by-field copy, not a pass-through of the wire object.
    if (status.type === 'error') {
      expect(status.error).not.toBe(wireErr)
    }
  })

  it('messageReceived → appends the message by reference', () => {
    const store = createSessionStore()
    const message = msg('m1')
    dispatchIfAction(store, translateDaemonEvent({ type: 'messageReceived', message }))
    expect(store.getState().messages).toHaveLength(1)
    expect(store.getState().messages[0]).toBe(message)
  })

  it('messagesReceived → appends the batch in order', () => {
    const store = createSessionStore()
    const batch = [msg('m1'), msg('m2'), msg('m3')]
    dispatchIfAction(store, translateDaemonEvent({ type: 'messagesReceived', messages: batch }))
    expect(store.getState().messages.map((m) => m.message_id)).toEqual(['m1', 'm2', 'm3'])
  })
})

describe('translateDaemonEvent — debug-bundle events produce no session action', () => {
  it('debugBundleProgress → null (consumed by the download UI, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'debugBundleProgress', chunksReceived: 3 })).toBeNull()
  })

  it('debugBundleSaved → null', () => {
    expect(
      translateDaemonEvent({ type: 'debugBundleSaved', path: '/downloads/bundle.tar.gz' })
    ).toBeNull()
  })

  it('debugBundleFailed → null', () => {
    expect(translateDaemonEvent({ type: 'debugBundleFailed', reason: 'unavailable' })).toBeNull()
  })

  it('assistantDelta → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'assistantDelta',
        turnId: 'turn-1',
        seq: 0,
        text: 'slice',
        conversationId: 'conv-1'
      })
    ).toBeNull()
  })

  it('turnEnd → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'turnEnd',
        turnId: 'turn-1',
        stopReason: 'end_turn',
        conversationId: 'conv-1'
      })
    ).toBeNull()
  })

  it('turnState → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })).toBeNull()
  })

  it('toolUse → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'toolUse',
        conversationId: 'conv-1',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        name: 'Read',
        inputSummary: 'reads /etc/hosts'
      })
    ).toBeNull()
  })

  it('toolResult → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'toolResult',
        turnId: 'turn-1',
        toolUseId: 'tu-1',
        isError: false,
        resultSummary: 'read 12 lines'
      })
    ).toBeNull()
  })

  it('conversationsReceived → null (consumed by the conversation-list store #208, not the session store)', () => {
    expect(
      translateDaemonEvent({
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
          },
          {
            id: 'conv-2',
            name: null,
            is_promoted: false,
            is_archived: true,
            cwd: '/tmp/scratch',
            last_message_ts: '2026-07-07T00:00:00Z',
            last_used_at: '2026-07-07T12:00:00Z'
          }
        ]
      })
    ).toBeNull()
  })

  it('modalShown → null (consumed by the modal store + bridge #223, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'modalShown',
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
    ).toBeNull()
  })

  it('modalDismissed → null (consumed by the modal store + bridge #223, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'modalDismissed',
        modalId: 'mdl-7f3a',
        outcome: 'allow',
        source: 'remote'
      })
    ).toBeNull()
  })

  it('sessionTransition → null (consumed by the #259 holder, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'sessionTransition',
        newSessionId: 'sess-2',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      })
    ).toBeNull()
  })

  it('sessionSettingsUpdated → null (consumed by #261 / #256, not the session store)', () => {
    expect(
      translateDaemonEvent({ type: 'sessionSettingsUpdated', sessionId: 'sess-2', changeId: 'change-x' })
    ).toBeNull()
  })

  it('modalAnswerRejected → null (consumed by the modal bridge #249, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'modalAnswerRejected', modalId: 'mdl-1' })).toBeNull()
  })

  it('sessionSettingsRejected → null (consumed by #256, not the session store)', () => {
    expect(
      translateDaemonEvent({ type: 'sessionSettingsRejected', changeId: 'change-x' })
    ).toBeNull()
  })

  it('queueState → null (consumed by the #293 queue store, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'queueState',
        conversationId: 'conv-1',
        queued: [{ queued_msg_id: 1, text: 'first', ts: '2026-07-10T00:00:00Z' }]
      })
    ).toBeNull()
  })

  it('stallDetected → null (consumed by the render slice #317, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'stallDetected', conversationId: 'conv-1' })).toBeNull()
  })

  it('relayLinkChanged → null (consumed by the relay-link store #329, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'connected' })).toBeNull()
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'offline' })).toBeNull()
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'daemon-absent' })).toBeNull()
  })

  it('apiRetry → null (consumed by the render slice #493, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'apiRetry',
        active: true,
        current: 3,
        total: 10,
        conversationId: 'conv-1'
      })
    ).toBeNull()
    expect(
      translateDaemonEvent({
        type: 'apiRetry',
        active: false,
        current: 0,
        total: 0,
        conversationId: 'conv-1'
      })
    ).toBeNull()
  })

  it('compacting → null (consumed by the render slice #496, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'compacting', active: true, conversationId: 'conv-1' })).toBeNull()
    expect(translateDaemonEvent({ type: 'compacting', active: false, conversationId: 'conv-1' })).toBeNull()
  })

  it('modelAnnounced → null (consumed by the announced-model store #588, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-20251001',
        truncated: false,
        conversationId: 'conv-1'
      })
    ).toBeNull()
    // A cut identifier is no more a session action than a complete one.
    expect(
      translateDaemonEvent({
        type: 'modelAnnounced',
        model: 'claude-haiku-4-5-2025',
        truncated: true,
        conversationId: 'conv-1'
      })
    ).toBeNull()
  })

  it('backgroundTaskStarted → null (consumed by the #567 background-task store, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'backgroundTaskStarted',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        toolCallId: 'toolu_01XYZ',
        description: "grep -rn 'a<b&c' . > /tmp/out.txt &",
        taskType: 'local_bash',
        truncatedFields: ['description']
      })
    ).toBeNull()
    expect(
      translateDaemonEvent({
        type: 'backgroundTaskStarted',
        conversationId: 'conv-1',
        taskId: 'task_02DEF',
        toolCallId: 'toolu_02UVW',
        description: 'sleep 60',
        taskType: 'local_bash',
        truncatedFields: null
      })
    ).toBeNull()
  })

  it('backgroundTaskUpdated → null (consumed by the #567 background-task store, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_01ABC',
        patch: '{"is_backgrounded":tr',
        truncatedFields: ['patch']
      })
    ).toBeNull()
    expect(
      translateDaemonEvent({
        type: 'backgroundTaskUpdated',
        conversationId: 'conv-1',
        taskId: 'task_02DEF',
        patch: '',
        truncatedFields: null
      })
    ).toBeNull()
  })

  it('backgroundTaskRoster → null (consumed by the #567 background-task store, not the session store)', () => {
    expect(
      translateDaemonEvent({
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
    ).toBeNull()
    // The empty roster — the positive "nothing is alive" signal — is no more a session action than a
    // populated one.
    expect(
      translateDaemonEvent({
        type: 'backgroundTaskRoster',
        conversationId: 'conv-1',
        tasks: [],
        droppedTasks: 0
      })
    ).toBeNull()
  })

  it('unrecognizedMessage → null (consumed by the timeline render slice, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'unrecognizedMessage',
        site: 'line_type',
        messageType: 'some_future_event',
        raw: '{"type":"some_future_event"}',
        truncated: false
      })
    ).toBeNull()
  })

  it('workspaceFolderRejected → null (consumed by the #397 round-trip store, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'workspaceFolderRejected' })).toBeNull()
  })

  it('the three debug-bundle events dispatch nothing into the session store', () => {
    // Belt-and-suspenders, mirroring production: feed each new event through the same null-guarded
    // dispatch the bridge applies; the store stays at its initial state (no status flip, no message).
    const store = createSessionStore()
    dispatchIfAction(
      store,
      translateDaemonEvent({ type: 'debugBundleProgress', chunksReceived: 3 })
    )
    dispatchIfAction(store, translateDaemonEvent({ type: 'debugBundleSaved', path: '/x' }))
    dispatchIfAction(store, translateDaemonEvent({ type: 'debugBundleFailed', reason: 'write-failed' }))
    expect(store.getState().status).toEqual(initialSessionState.status)
    expect(store.getState().messages).toEqual(initialSessionState.messages)
  })
})
