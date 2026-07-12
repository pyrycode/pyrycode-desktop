import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload, QueuedItem } from '@shared/wire/types'
import { translateQueueState, subscribeQueue, QueueData } from './queueBridge'
import { createQueueStore, selectBacklogFor } from './queueStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge idiom): no React, no
// Electron. The real store is wired only for the seam tests. This bridge is reactive-only — no
// request half — so there is no requestX describe block.

const a: QueuedItem = { queued_msg_id: 1, text: 'a', ts: '2026-07-10T00:00:00Z' }
const b: QueuedItem = { queued_msg_id: 2, text: 'b', ts: '2026-07-10T00:01:00Z' }

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
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      {
        type: 'snapshotReceived',
        model: '',
        effort: '',
        yolo: false,
        used_tokens: 0,
        window_tokens: 0
      },
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
    subscribeQueue(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a queueState event (AC1)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog)

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [a, b] })
  })

  it('writes an empty snapshot too — the !== null guard, not truthiness (AC2 clear case)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog)

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [] })
  })

  it('does not call setBacklog for an unrelated event (AC4)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog)

    bridge.emit({ type: 'connecting' })
    expect(setBacklog).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeQueue(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives a real store from empty → held on a queueState emit (seam)', () => {
    const bridge = fakeBridge()
    const store = createQueueStore()
    subscribeQueue(bridge.onDaemonEvent, (s) => store.getState().setBacklog(s))

    expect(selectBacklogFor('c1')(store.getState())).toEqual([])
    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
  })

  it('a second queueState for a different conversation does not clobber the first (seam)', () => {
    const bridge = fakeBridge()
    const store = createQueueStore()
    subscribeQueue(bridge.onDaemonEvent, (s) => store.getState().setBacklog(s))

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    bridge.emit({ type: 'queueState', conversationId: 'c2', queued: [b] })
    // Both readable end-to-end — replacement truth is per key, not a single last-snapshot slot.
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
    expect(selectBacklogFor('c2')(store.getState())).toEqual([b])
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
