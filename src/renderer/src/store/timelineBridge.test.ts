import { describe, it, expect, vi } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, ErrorPayload } from '@shared/wire/types'
import { translateTimelineEvent, subscribeTimeline } from './timelineBridge'
import {
  createTimelineStore,
  selectItems,
  selectPhase,
  selectStalled,
  selectApiRetry
} from './timelineStore'
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

  it('toolResult → a ThreadEvent toolResult with the same fields, a fresh object', () => {
    const event: DaemonEvent = {
      type: 'toolResult',
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
    const event: DaemonEvent = { type: 'stallDetected' }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'stallDetected' })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('apiRetry → a ThreadEvent apiRetry with the same four fields, a fresh object (#493)', () => {
    const event: DaemonEvent = { type: 'apiRetry', active: true, current: 3, total: 10 }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'apiRetry', active: true, current: 3, total: 10 })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('apiRetry translates the falling edge verbatim — nothing normalized at the bridge (#493)', () => {
    // The wire repeats the last-known counter on the falling edge; discarding it is the reducer's job,
    // not the bridge's. This is a filter + fresh copy, never a remap.
    const event: DaemonEvent = { type: 'apiRetry', active: false, current: 4, total: 10 }
    expect(translateTimelineEvent(event)).toEqual({
      type: 'apiRetry',
      active: false,
      current: 4,
      total: 10
    })
  })

  it('compacting → a ThreadEvent compacting carrying the edge, a fresh object (#496)', () => {
    const event: DaemonEvent = { type: 'compacting', active: true }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'compacting', active: true })
    // A fresh literal, not a pass-through of the DaemonEvent object.
    expect(translated).not.toBe(event)
  })

  it('compacting translates the falling edge verbatim — the reducer owns the clear (#496)', () => {
    const event: DaemonEvent = { type: 'compacting', active: false }
    const translated = translateTimelineEvent(event)
    expect(translated).toEqual({ type: 'compacting', active: false })
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
      // screen-snapshot text ships dormant (#316); its consumer is the display slice #318, not the
      // timeline store — it is not a turn-stream ThreadItem.
      { type: 'screenSnapshotReceived', text: 'rendered screen', ts: '2026-07-08T00:00:00Z' },
      // relay-link status ships dormant (#328); its consumer is the relay-link store #329, not the
      // timeline store — the relay socket leg is not a turn-stream item.
      { type: 'relayLinkChanged', status: 'connected' },
      // create-folder rejection ships dormant (#396); its consumer is the #397 round-trip store, not the
      // timeline store — it is not a turn-stream item.
      { type: 'workspaceFolderRejected' }
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

  it('AC3: a toolUse then a correlated toolResult fills the call result in place (isError false)', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    const sequence: DaemonEvent[] = [
      { type: 'toolUse', turnId: 'A', toolUseId: 'tu-1', name: 'Read', inputSummary: 'reads /etc/hosts' },
      { type: 'toolResult', turnId: 'A', toolUseId: 'tu-1', isError: false, resultSummary: 'read 12 lines' }
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
      { type: 'toolUse', turnId: 'A', toolUseId: 'tu-1', name: 'Bash', inputSummary: 'rm -rf build/' },
      { type: 'toolResult', turnId: 'A', toolUseId: 'tu-1', isError: true, resultSummary: 'permission denied' }
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
    bridge.emit({ type: 'toolResult', turnId: 'A', toolUseId: 'nope', isError: false, resultSummary: 'x' })

    // No pending toolCall → fillResult returns the same array → the reducer returns the same state.
    expect(store.getState()).toBe(before)
    expect(selectItems(store.getState())).toHaveLength(0)
  })

  it('AC3: a duplicate toolResult (call already resolved) is a no-op — result not overwritten', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    bridge.emit({ type: 'toolUse', turnId: 'A', toolUseId: 'tu-1', name: 'Read', inputSummary: 'reads /etc/hosts' })
    bridge.emit({ type: 'toolResult', turnId: 'A', toolUseId: 'tu-1', isError: false, resultSummary: 'read 12 lines' })
    const afterFirst = store.getState()

    // A second toolResult for the same toolUseId — the call is already resolved, so it is a no-op.
    bridge.emit({ type: 'toolResult', turnId: 'A', toolUseId: 'tu-1', isError: true, resultSummary: 'overwrite attempt' })

    expect(store.getState()).toBe(afterFirst)
    const item = selectItems(store.getState())[0] as Extract<ThreadItem, { kind: 'toolCall' }>
    expect(item.result).toEqual({ isError: false, resultSummary: 'read 12 lines' })
  })

  it('#317: a stallDetected daemon event drives the store stalled flag true, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    expect(selectStalled(store.getState())).toBe(false)
    bridge.emit({ type: 'stallDetected' })
    expect(selectStalled(store.getState())).toBe(true)
  })

  it('#493: an apiRetry rising edge drives the store status, and the falling edge clears it, no React', () => {
    const bridge = fakeBridge()
    const store = createTimelineStore()
    subscribeTimeline(bridge.onDaemonEvent, (e) => store.getState().dispatch(e))

    expect(selectApiRetry(store.getState())).toBeNull()
    bridge.emit({ type: 'apiRetry', active: true, current: 3, total: 10 })
    expect(selectApiRetry(store.getState())).toEqual({ current: 3, total: 10 })

    // The falling edge repeats the last-known counter; the status still clears.
    bridge.emit({ type: 'apiRetry', active: false, current: 3, total: 10 })
    expect(selectApiRetry(store.getState())).toBeNull()
  })
})
