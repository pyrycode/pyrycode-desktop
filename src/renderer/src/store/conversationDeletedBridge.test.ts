import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, ConversationUpdatedPayload } from '@shared/wire/types'
import {
  translateConversationDeleted,
  subscribeConversationDeleted
} from './conversationDeletedBridge'

// Framework-free data-path tests with injected spies (the conversationCreatedBridge idiom): no React, no
// Electron. The React glue (useConversationDeletedExit) is proven by composition in PairedShell — its
// server-render safety by PairedShell.test.tsx, its back→list link by pairedRoute.test.ts, and the
// decision it drives by exitActiveConversation.test.ts.

const created: ConversationCreatedPayload = {
  id: 'conv-new',
  is_promoted: false,
  cwd: '/home/pyry/project',
  name: null,
  last_used_at: '2026-08-20T12:00:00Z'
}

const updated: ConversationUpdatedPayload = {
  id: 'conv-updated',
  is_promoted: true,
  name: 'Channel B',
  cwd: '/home/pyry/project',
  last_used_at: '2026-08-20T12:00:00Z'
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

describe('translateConversationDeleted', () => {
  it('maps a conversationDeleted to its bare id (the owned arm)', () => {
    const event: DaemonEvent = { type: 'conversationDeleted', id: 'conv-gone' }
    expect(translateConversationDeleted(event)).toBe('conv-gone')
  })

  it('returns null for the near-miss conversation arms and a sample of others (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'conversationCreated', conversation: created },
      { type: 'conversationUpdated', conversation: updated },
      { type: 'conversationsReceived', conversations: [] },
      { type: 'connecting' },
      { type: 'turnState', state: 'thinking' }
    ]
    for (const event of others) expect(translateConversationDeleted(event)).toBeNull()
  })
})

describe('subscribeConversationDeleted', () => {
  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeConversationDeleted(bridge.onDaemonEvent, vi.fn())
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('invokes onDeleted once per conversationDeleted, with the deleted id', () => {
    const bridge = fakeBridge()
    const onDeleted = vi.fn()
    subscribeConversationDeleted(bridge.onDaemonEvent, onDeleted)

    bridge.emit({ type: 'conversationDeleted', id: 'conv-gone' })
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledWith('conv-gone')
  })

  it('ignores unrelated daemon events — no exit, no navigation (AC5)', () => {
    const bridge = fakeBridge()
    const onDeleted = vi.fn()
    subscribeConversationDeleted(bridge.onDaemonEvent, onDeleted)

    bridge.emit({ type: 'conversationCreated', conversation: created })
    bridge.emit({ type: 'conversationUpdated', conversation: updated })
    bridge.emit({ type: 'conversationsReceived', conversations: [] })
    bridge.emit({ type: 'turnState', state: 'thinking' })
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeConversationDeleted(bridge.onDaemonEvent, vi.fn())
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
