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

  it('snapshotReceived → null (consumed by the Run configuration render bridge #181, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'snapshotReceived',
        model: 'claude-opus-4-8',
        effort: 'high',
        yolo: true,
        used_tokens: 45000,
        window_tokens: 200000
      })
    ).toBeNull()
  })

  it('assistantDelta → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({ type: 'assistantDelta', turnId: 'turn-1', seq: 0, text: 'slice' })
    ).toBeNull()
  })

  it('turnEnd → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({ type: 'turnEnd', turnId: 'turn-1', stopReason: 'end_turn' })
    ).toBeNull()
  })

  it('turnState → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'turnState', state: 'thinking' })).toBeNull()
  })

  it('toolUse → null (consumed by the renderer timeline bridge #202, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'toolUse',
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
    expect(translateDaemonEvent({ type: 'stallDetected' })).toBeNull()
  })

  it('screenSnapshotReceived → null (consumed by the display slice #318, not the session store)', () => {
    expect(
      translateDaemonEvent({
        type: 'screenSnapshotReceived',
        text: 'rendered screen',
        ts: '2026-07-08T00:00:00Z'
      })
    ).toBeNull()
  })

  it('relayLinkChanged → null (consumed by the relay-link store #329, not the session store)', () => {
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'connected' })).toBeNull()
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'offline' })).toBeNull()
    expect(translateDaemonEvent({ type: 'relayLinkChanged', status: 'daemon-absent' })).toBeNull()
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
