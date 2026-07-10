import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { translateModalEvent, subscribeModal } from './modalBridge'
import { createModalStore, selectOutstanding } from './modalStore'

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

describe('translateModalEvent — the two owned arms', () => {
  it('modalShown → a ModalEvent shown with the same fields, a fresh object', () => {
    const translated = translateModalEvent(modalShown)
    expect(translated).toEqual({
      type: 'shown',
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
    const translated = translateModalEvent(event)
    expect(translated).toEqual({ type: 'dismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
    // The discriminant is renamed across the boundary: modalDismissed → 'dismissed'.
    expect(translated?.type).toBe('dismissed')
    expect(translated).not.toBe(event)
  })
})

describe('translateModalEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for all 15 non-modal DaemonEvent arms', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'failed', error: wireErr },
      { type: 'messageReceived', message },
      { type: 'messagesReceived', messages: [message] },
      { type: 'debugBundleProgress', chunksReceived: 3 },
      { type: 'debugBundleSaved', path: '/downloads/bundle.tar.gz' },
      { type: 'debugBundleFailed', reason: 'unavailable' },
      {
        type: 'snapshotReceived',
        model: 'claude-x',
        effort: 'high',
        yolo: true,
        used_tokens: 45000,
        window_tokens: 200000
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
      // The four arms timelineBridge OWNS but this bridge must null — the mirror-image proof.
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' },
      { type: 'turnEnd', turnId: 'A', stopReason: 'end_turn' },
      { type: 'turnState', state: 'thinking' },
      { type: 'toolUse', turnId: 'A', toolUseId: 'tu-1', name: 'Read', inputSummary: 'reads /etc/hosts' }
    ]
    for (const event of others) expect(translateModalEvent(event)).toBeNull()
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
    subscribeModal(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('dispatches a translated event for an owned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeModal(bridge.onDaemonEvent, dispatch)

    bridge.emit(modalShown)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'shown',
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
    subscribeModal(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup (one-listener guarantee)', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeModal(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('a modalShown then modalDismissed with the same modalId drives outstanding [1] → [], no React', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit(modalShown)
    expect(selectOutstanding(store.getState())).toHaveLength(1)

    bridge.emit({ type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' })
    expect(selectOutstanding(store.getState())).toEqual([])
  })

  it('a modalDismissed with an unknown id leaves outstanding [1], same-state no-churn, no React', () => {
    const bridge = fakeBridge()
    const store = createModalStore()
    subscribeModal(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit(modalShown)
    const afterShown = store.getState()
    expect(selectOutstanding(afterShown)).toHaveLength(1)

    bridge.emit({ type: 'modalDismissed', modalId: 'unknown', outcome: 'allow', source: 'remote' })
    expect(store.getState()).toBe(afterShown)
  })
})
