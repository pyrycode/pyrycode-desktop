import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'
import { subscribeNotificationActivated } from './notificationActivatedBridge'

// Framework-free data-path tests with injected spies (the conversationCreatedBridge idiom): no React,
// no Electron. The React glue (useNotificationActivatedNav) is proven by composition in PairedShell —
// its server-render safety by PairedShell.test.tsx, its open→thread link by pairedRoute.test.ts.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

const created: ConversationCreatedPayload = {
  id: 'conv-new',
  is_promoted: false,
  cwd: '/home/pyry/project',
  name: null,
  last_used_at: '2026-07-11T12:00:00Z'
}

// A fake onDaemonEvent that captures the listener and hands back an off spy — the bridge-test idiom.
function fakeBridge(): {
  onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
  emit: (e: DaemonEvent) => void
  off: ReturnType<typeof vi.fn>
} {
  let listener: ((e: DaemonEvent) => void) | undefined
  const off = vi.fn()
  const onDaemonEvent = vi.fn((l: (e: DaemonEvent) => void) => {
    listener = l
    return off
  })
  return { onDaemonEvent, emit: (e) => listener?.(e), off }
}

describe('subscribeNotificationActivated', () => {
  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeNotificationActivated(bridge.onDaemonEvent, vi.fn())
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('invokes onActivated once per notificationActivated event, with no args (AC3, nullary)', () => {
    const bridge = fakeBridge()
    const onActivated = vi.fn()
    subscribeNotificationActivated(bridge.onDaemonEvent, onActivated)

    bridge.emit({ type: 'notificationActivated' })
    expect(onActivated).toHaveBeenCalledTimes(1)
    // Nullary: no payload rides the arm — the callback is invoked with zero arguments.
    expect(onActivated).toHaveBeenCalledWith()
  })

  it('ignores a sample of unrelated daemon events — no navigation', () => {
    const bridge = fakeBridge()
    const onActivated = vi.fn()
    subscribeNotificationActivated(bridge.onDaemonEvent, onActivated)

    bridge.emit({ type: 'connecting' })
    bridge.emit({ type: 'messageReceived', message })
    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({ type: 'turnState', state: 'thinking', conversationId: 'conv-1' })
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeNotificationActivated(bridge.onDaemonEvent, vi.fn())
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
