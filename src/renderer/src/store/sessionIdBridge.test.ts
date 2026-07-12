import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { MessagePayload } from '@shared/wire/types'
import {
  translateSessionTransition,
  subscribeSessionId,
  SessionIdData
} from './sessionIdBridge'
import { createSessionIdStore, selectSessionId } from './sessionIdStore'

// Framework-free data-path tests with injected spies (the conversationListBridge idiom): no React,
// no Electron. The real store is wired only for the not-seen → held seam test. This holder is
// reactive-only — no request half — so there is no requestX describe block.

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

describe('translateSessionTransition', () => {
  it('maps a sessionTransition to its newSessionId (the owned arm)', () => {
    // The #285 fields (reason / occurredAt / workspaceCwd) are present but ignored — the holder reads
    // only the id, which is exactly the AC5 (consumer-unchanged) proof.
    const event: DaemonEvent = {
      type: 'sessionTransition',
      newSessionId: 's1',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    }
    expect(translateSessionTransition(event)).toBe('s1')
  })

  it('returns null for a sample of unrelated daemon events (the filter, AC3)', () => {
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
    for (const event of others) expect(translateSessionTransition(event)).toBeNull()
  })
})

describe('subscribeSessionId', () => {
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
    subscribeSessionId(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes newSessionId on a sessionTransition event (AC1)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId)

    bridge.emit({
      type: 'sessionTransition',
      newSessionId: 's1',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('s1')
  })

  it('writes again on a second sessionTransition — last-write-wins (AC2)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId)

    bridge.emit({
      type: 'sessionTransition',
      newSessionId: 's1',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
    bridge.emit({
      type: 'sessionTransition',
      newSessionId: 's2',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
    expect(setSessionId).toHaveBeenCalledTimes(2)
    expect(setSessionId).toHaveBeenNthCalledWith(2, 's2')
  })

  it('does not call setSessionId for an unrelated event (AC3)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId)

    bridge.emit({ type: 'connecting' })
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('writes an empty-string newSessionId — the !== null guard, not truthiness (AC4)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId)

    bridge.emit({
      type: 'sessionTransition',
      newSessionId: '',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('')
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeSessionId(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-seen (null) to the id on a sessionTransition (seam)', () => {
    const bridge = fakeBridge()
    const store = createSessionIdStore()
    subscribeSessionId(bridge.onDaemonEvent, (id) => store.getState().setSessionId(id))

    expect(selectSessionId(store.getState())).toBeNull()
    bridge.emit({
      type: 'sessionTransition',
      newSessionId: 's1',
      reason: 'clear',
      occurredAt: '2026-07-10T00:00:00.000000000Z',
      workspaceCwd: null
    })
    expect(selectSessionId(store.getState())).toBe('s1')
  })
})

describe('SessionIdData (container)', () => {
  // Server-render sanity — the ConversationListData.test idiom. The binding is headless (renders
  // null) and dereferences window.pyry only inside its effect, so a server render (effects never
  // run) produces empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified
  // by inspection against the ConversationListData subscribe-effect idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(SessionIdData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
