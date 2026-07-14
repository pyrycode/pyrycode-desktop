import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, MessagePayload } from '@shared/wire/types'
import {
  requestNewConversation,
  translateConversationCreated,
  subscribeConversationCreated
} from './conversationCreatedBridge'

// Framework-free data-path tests with injected spies (the conversationListBridge idiom): no React, no
// Electron. The React glue (useConversationCreatedNav) is proven by composition in PairedShell — its
// server-render safety by PairedShell.test.tsx, its open→thread link by pairedRoute.test.ts.

const created: ConversationCreatedPayload = {
  id: 'conv-new',
  is_promoted: false,
  cwd: '/home/pyry/project',
  name: null,
  last_used_at: '2026-07-11T12:00:00Z'
}

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
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

describe('requestNewConversation', () => {
  it('with no default set, fires createConversation with cwd null — the daemon-default signal, unchanged (AC3)', () => {
    const sendCommand = vi.fn()
    requestNewConversation(sendCommand, null)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'createConversation',
      payload: { is_promoted: false, name: null, cwd: null }
    })
  })

  it('with a saved default, carries it verbatim as cwd; is_promoted/name untouched (AC2)', () => {
    const sendCommand = vi.fn()
    requestNewConversation(sendCommand, '/home/pyry/project')
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'createConversation',
      payload: { is_promoted: false, name: null, cwd: '/home/pyry/project' }
    })
  })
})

describe('translateConversationCreated', () => {
  it('maps a conversationCreated to its payload (the owned arm)', () => {
    const event: DaemonEvent = { type: 'conversationCreated', conversation: created }
    expect(translateConversationCreated(event)).toBe(created)
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'messageReceived', message },
      { type: 'conversationsReceived', conversations: [] },
      { type: 'turnState', state: 'thinking' }
    ]
    for (const event of others) expect(translateConversationCreated(event)).toBeNull()
  })
})

describe('subscribeConversationCreated', () => {
  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeConversationCreated(bridge.onDaemonEvent, vi.fn())
    expect(bridge.onDaemonEvent).toHaveBeenCalledTimes(1)
  })

  it('invokes onCreated once per conversationCreated, with the decoded payload (AC3, AC5)', () => {
    const bridge = fakeBridge()
    const onCreated = vi.fn()
    subscribeConversationCreated(bridge.onDaemonEvent, onCreated)

    bridge.emit({ type: 'conversationCreated', conversation: created })
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(created)
  })

  it('ignores unrelated daemon events — no navigation (AC5)', () => {
    const bridge = fakeBridge()
    const onCreated = vi.fn()
    subscribeConversationCreated(bridge.onDaemonEvent, onCreated)

    bridge.emit({ type: 'messageReceived', message })
    bridge.emit({ type: 'conversationsReceived', conversations: [] })
    bridge.emit({ type: 'turnState', state: 'thinking' })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeConversationCreated(bridge.onDaemonEvent, vi.fn())
    expect(bridge.off).not.toHaveBeenCalled()
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })
})
