import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, MessagePayload, QueuedItem } from '@shared/wire/types'
import { translateQueueState, subscribeQueue, QueueData } from './queueBridge'
import { createQueueStore, selectBacklogFor } from './queueStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge idiom): no React, no
// Electron. The real store is wired only for the seam tests. This bridge is reactive-only — no
// request half — so there is no requestX describe block.

const a: QueuedItem = { queued_msg_id: 1, text: 'a', ts: '2026-07-10T00:00:00Z' }
const b: QueuedItem = { queued_msg_id: 2, text: 'b', ts: '2026-07-10T00:01:00Z' }

// The connect-time edge the reset reacts to. The reset reads only the discriminant, never the ack.
const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateQueueState', () => {
  it('maps a queueState event to { conversationId, queued } (the owned arm)', () => {
    const queued: readonly QueuedItem[] = [a, b]
    const event: DaemonEvent = { type: 'queueState', conversationId: 'c1', queued }
    const snapshot = translateQueueState(event)
    expect(snapshot).toEqual({ conversationId: 'c1', queued })
    // queued passes through by reference — enqueue order and identity preserved.
    expect(snapshot?.queued).toBe(queued)
  })

  it('returns null for a sample of unrelated daemon events (the filter, AC4)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // `connected` stays null here on purpose: the #197 reset is a listener branch, NOT a translator
      // mapping — unlike the #415 modal translator, this translator is untouched and stays pure.
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'conversationsReceived', conversations: [] },
      {
        type: 'sessionTransition',
        newSessionId: 's1',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      }
    ]
    for (const event of others) expect(translateQueueState(event)).toBeNull()
  })
})

describe('subscribeQueue', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy.
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
    subscribeQueue(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a queueState event (AC1)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [a, b] })
  })

  it('writes an empty snapshot too — the !== null guard, not truthiness (AC2 clear case)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [] })
  })

  it('does not call setBacklog for an unrelated event (AC4)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'connecting' })
    expect(setBacklog).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeQueue(bridge.onDaemonEvent, vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  // #197 — the connected edge resets, every other event routes as before.
  it('resets the backlog on a connected event, without writing a snapshot (AC1)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogs = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogs)

    bridge.emit({ type: 'connected', ack })
    expect(resetBacklogs).toHaveBeenCalledTimes(1)
    expect(setBacklog).not.toHaveBeenCalled()
  })

  it('writes a snapshot on a queueState event, without resetting (AC2)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogs = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogs)

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(resetBacklogs).not.toHaveBeenCalled()
  })

  it('neither resets nor writes for an unrelated event (AC4)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogs = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogs)

    bridge.emit({ type: 'disconnected' })
    expect(setBacklog).not.toHaveBeenCalled()
    expect(resetBacklogs).not.toHaveBeenCalled()
  })

  it('drives a real store from empty → held on a queueState emit (seam)', () => {
    const bridge = fakeBridge()
    const store = createQueueStore()
    subscribeQueue(
      bridge.onDaemonEvent,
      (s) => store.getState().setBacklog(s),
      () => store.getState().resetBacklogs()
    )

    expect(selectBacklogFor('c1')(store.getState())).toEqual([])
    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
  })

  it('a second queueState for a different conversation does not clobber the first (seam)', () => {
    const bridge = fakeBridge()
    const store = createQueueStore()
    subscribeQueue(
      bridge.onDaemonEvent,
      (s) => store.getState().setBacklog(s),
      () => store.getState().resetBacklogs()
    )

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    bridge.emit({ type: 'queueState', conversationId: 'c2', queued: [b] })
    // Both readable end-to-end — replacement truth is per key, not a single last-snapshot slot.
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
    expect(selectBacklogFor('c2')(store.getState())).toEqual([b])
  })

  // The three AC4 reconnect outcomes, proven end-to-end through the real store: reset on `connected`,
  // then the daemon's connect-time re-sends repopulate (or don't) through setBacklog unchanged. The
  // transport emits `connected` before any re-sent queue_state and the single channel delivers in
  // order, so reset-before-repopulate holds with no renderer ordering logic.
  describe('reconnect reconcile (seam)', () => {
    function reconnectSeam() {
      const bridge = fakeBridge()
      const store = createQueueStore()
      subscribeQueue(
        bridge.onDaemonEvent,
        (s) => store.getState().setBacklog(s),
        () => store.getState().resetBacklogs()
      )
      return { bridge, store }
    }

    it('(a) a message dequeued while away does not resurrect after reconnect', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      bridge.emit({ type: 'connected', ack })
      // `a` drained into claude while away, so the re-send holds only `b`.
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [b] })
      expect(selectBacklogFor('c1')(store.getState())).toEqual([b])
    })

    it('(a-strong) a fully-drained conversation with no re-send reads empty across the boundary', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c2', queued: [b] })
      bridge.emit({ type: 'connected', ack })
      // c2 fully drained → the daemon re-sends NO snapshot for it → absent == empty (AC3).
      expect(selectBacklogFor('c2')(store.getState())).toEqual([])
    })

    it('(b) a message queued while away appears after reconnect', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
      bridge.emit({ type: 'connected', ack })
      // `b` was queued while away — the re-send brings the current backlog.
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      expect(selectBacklogFor('c1')(store.getState())).toEqual([a, b])
    })

    it('(c) an untouched backlog reads identically after a reset-then-re-send round-trip', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      bridge.emit({ type: 'connected', ack })
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      // Content-equal — the array reference legitimately changes (it is the fresh re-sent snapshot).
      expect(selectBacklogFor('c1')(store.getState())).toEqual([a, b])
    })
  })
})

describe('QueueData (container)', () => {
  // Server-render sanity — the SessionIdData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by inspection
  // against the SessionIdData subscribe-effect idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(QueueData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
