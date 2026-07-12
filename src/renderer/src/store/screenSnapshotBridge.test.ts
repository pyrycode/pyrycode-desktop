import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  translateScreenSnapshot,
  subscribeScreenSnapshot,
  ScreenSnapshotData
} from './screenSnapshotBridge'
import { createScreenSnapshotStore, selectScreenSnapshot } from './screenSnapshotStore'

// Framework-free data-path tests with injected spies (the conversationListBridge / sessionIdBridge
// idiom): no React, no Electron. The real store is wired only for the newer-replaces-older seam test.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateScreenSnapshot', () => {
  it('maps a screenSnapshotReceived to { text, ts } (the owned arm)', () => {
    const event: DaemonEvent = {
      type: 'screenSnapshotReceived',
      text: 'rendered screen',
      ts: '2026-07-10T12:00:00Z'
    }
    expect(translateScreenSnapshot(event)).toEqual({
      text: 'rendered screen',
      ts: '2026-07-10T12:00:00Z'
    })
  })

  it('maps an empty-text screenSnapshotReceived to { text: "", ts } — not null (AC1)', () => {
    const event: DaemonEvent = {
      type: 'screenSnapshotReceived',
      text: '',
      ts: '2026-07-10T12:00:00Z'
    }
    expect(translateScreenSnapshot(event)).toEqual({ text: '', ts: '2026-07-10T12:00:00Z' })
    expect(translateScreenSnapshot(event)).not.toBeNull()
  })

  it('returns null for a sample of unrelated daemon events (the filter — AC3)', () => {
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
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateScreenSnapshot(event)).toBeNull()
  })
})

describe('subscribeScreenSnapshot', () => {
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
    subscribeScreenSnapshot(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a screenSnapshotReceived event (AC3)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeScreenSnapshot(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({ type: 'screenSnapshotReceived', text: 'hi', ts: '2026-07-10T12:00:00Z' })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({ text: 'hi', ts: '2026-07-10T12:00:00Z' })
  })

  it('writes an empty-text snapshot — the !== null guard, not truthiness (AC1/AC5)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeScreenSnapshot(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({ type: 'screenSnapshotReceived', text: '', ts: '2026-07-10T12:00:00Z' })
    expect(setSnapshot).toHaveBeenCalledTimes(1)
    expect(setSnapshot).toHaveBeenCalledWith({ text: '', ts: '2026-07-10T12:00:00Z' })
  })

  it('does not call setSnapshot for an unrelated event (AC3)', () => {
    const bridge = fakeBridge()
    const setSnapshot = vi.fn()
    subscribeScreenSnapshot(bridge.onDaemonEvent, setSnapshot)

    bridge.emit({ type: 'connecting' })
    expect(setSnapshot).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeScreenSnapshot(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-loaded (null) to loaded on a screenSnapshotReceived', () => {
    const bridge = fakeBridge()
    const store = createScreenSnapshotStore()
    subscribeScreenSnapshot(bridge.onDaemonEvent, (s) => store.getState().setSnapshot(s))

    expect(selectScreenSnapshot(store.getState())).toBeNull()
    bridge.emit({ type: 'screenSnapshotReceived', text: 'first', ts: '2026-07-10T12:00:00Z' })
    expect(selectScreenSnapshot(store.getState())).toEqual({
      text: 'first',
      ts: '2026-07-10T12:00:00Z'
    })
  })

  it('a newer snapshot replaces the older one through the real store (AC1)', () => {
    const bridge = fakeBridge()
    const store = createScreenSnapshotStore()
    subscribeScreenSnapshot(bridge.onDaemonEvent, (s) => store.getState().setSnapshot(s))

    bridge.emit({ type: 'screenSnapshotReceived', text: 'old', ts: '2026-07-10T12:00:00Z' })
    bridge.emit({ type: 'screenSnapshotReceived', text: 'new', ts: '2026-07-10T12:01:00Z' })
    expect(selectScreenSnapshot(store.getState())).toEqual({
      text: 'new',
      ts: '2026-07-10T12:01:00Z'
    })
  })

  it('leaves the store untouched on an unrelated event (AC3)', () => {
    const bridge = fakeBridge()
    const store = createScreenSnapshotStore()
    subscribeScreenSnapshot(bridge.onDaemonEvent, (s) => store.getState().setSnapshot(s))

    bridge.emit({ type: 'connecting' })
    expect(selectScreenSnapshot(store.getState())).toBeNull()
  })
})

describe('ScreenSnapshotData (container)', () => {
  // Server-render sanity — the ConversationListData / QueueData idiom. The binding is headless (renders
  // null) and dereferences window.pyry only inside effects, so a server render (effects never run)
  // produces empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by
  // inspection against the QueueData off-handle-as-cleanup idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ScreenSnapshotData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
