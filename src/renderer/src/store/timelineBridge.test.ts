import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { translateTimelineEvent, subscribeTimeline } from './timelineBridge'
import { createTimelineStore, selectItems, selectPhase } from './timelineStore'
import type { ThreadItem } from './threadTimeline'

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
  it('assistantDelta → a ThreadEvent assistantDelta with the same fields, a fresh object', () => {
    const event: DaemonEvent = { type: 'assistantDelta', turnId: 'A', seq: 3, text: 'slice' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'assistantDelta', turnId: 'A', seq: 3, text: 'slice' })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('turnEnd → a ThreadEvent turnEnd with the same fields, a fresh object', () => {
    const event: DaemonEvent = { type: 'turnEnd', turnId: 'A', stopReason: 'max_tokens' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'turnEnd', turnId: 'A', stopReason: 'max_tokens' })
    expect(translated).not.toBe(event)
  })

  it('turnState → a ThreadEvent turnState with the same state, a fresh object, for each phase', () => {
    for (const state of ['thinking', 'responding', 'idle'] as const) {
      const event: DaemonEvent = { type: 'turnState', state }
      const translated = translateTimelineEvent(event)
      expect(translated).toEqual({ type: 'turnState', state })
      // A fresh literal, not a pass-through of the DaemonEvent object.
      expect(translated).not.toBe(event)
    }
  })

  it('toolUse → a ThreadEvent toolUse with the same fields, a fresh object', () => {
    const event: DaemonEvent = {
      type: 'toolUse',
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
})

describe('translateTimelineEvent — every other arm returns null (the inverse filter)', () => {
  it('returns null for all non-stream DaemonEvent arms', () => {
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
      {
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
      },
      { type: 'modalDismissed', modalId: 'mdl-7f3a', outcome: 'allow', source: 'remote' }
    ]
    for (const event of others) expect(translateTimelineEvent(event)).toBeNull()
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

  it('dispatches a translated event for an owned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeTimeline(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({ type: 'assistantDelta', turnId: 'A', seq: 0, text: 'hi' })
  })

  it('dispatches nothing for an unowned arm', () => {
    const bridge = fakeBridge()
    const dispatch = vi.fn()
    subscribeTimeline(bridge.onDaemonEvent, dispatch)

    bridge.emit({ type: 'connecting' })
    expect(dispatch).not.toHaveBeenCalled()
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
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'Hel' },
      { type: 'assistantDelta', turnId: 'A', seq: 1, text: 'lo' }
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
      bridge.emit({ type: 'turnState', state })
      expect(selectPhase(store.getState())).toBe(state)
    }
  })

  it('AC5: re-emitting the current state is a no-churn no-op (same state reference)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({ type: 'turnState', state: 'thinking' })
    const afterFirst = store.getState()
    expect(selectPhase(afterFirst)).toBe('thinking')

    // Same state again — the reducer returns the same state object, so the store does not churn.
    bridge.emit({ type: 'turnState', state: 'thinking' })
    expect(store.getState()).toBe(afterFirst)
  })

  it('AC5: a toolUse event appends one pending toolCall item (result: null) via the store, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({
      type: 'toolUse',
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
      { type: 'assistantDelta', turnId: 'A', seq: 0, text: 'before ' },
      { type: 'toolUse', turnId: 'A', toolUseId: 'tu-1', name: 'Read', inputSummary: 'reads /etc/hosts' },
      { type: 'assistantDelta', turnId: 'A', seq: 1, text: 'after' }
    ]
    for (const event of sequence) bridge.emit(event)

    const items = selectItems(store.getState())
    expect(items.map((i) => i.kind)).toEqual(['assistantText', 'toolCall', 'assistantText'])
  })
})
