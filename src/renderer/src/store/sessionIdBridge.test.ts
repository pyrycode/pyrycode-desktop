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

// The two chats the gate (#1192) discriminates between. Mutually non-substring, so a widened
// comparison would be visible rather than accidentally right.
const OPEN_CONVERSATION = 'conv-open'
const OTHER_CONVERSATION = 'chat-elsewhere'

/** One `session_transition` marker as it reaches the renderer, named by the chat it describes. */
function marker(conversationId: string, newSessionId: string): DaemonEvent {
  return {
    type: 'sessionTransition',
    conversationId,
    newSessionId,
    reason: 'clear',
    occurredAt: '2026-07-10T00:00:00.000000000Z',
    workspaceCwd: null
  }
}

describe('translateSessionTransition', () => {
  it('maps a sessionTransition to its newSessionId (the owned arm)', () => {
    // The #285 fields (reason / occurredAt / workspaceCwd) are present but ignored — the holder reads
    // only the id, which is exactly the AC5 (consumer-unchanged) proof. #1192's `conversationId` is
    // ignored HERE too, and deliberately: this stays a pure function OF THE EVENT, and the attribution
    // decision lives one level up in subscribeSessionId. Widening this translator to take the open id
    // would give one decision two implementations (runConfigSnapshot's stated reason for the same
    // split).
    expect(translateSessionTransition(marker(OPEN_CONVERSATION, 's1'))).toBe('s1')
  })

  it('returns null for a sample of unrelated daemon events (the filter, AC3)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
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
    subscribeSessionId(bridge.onDaemonEvent, vi.fn(), () => OPEN_CONVERSATION)
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes newSessionId on a sessionTransition naming the open conversation (AC1)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => OPEN_CONVERSATION)

    bridge.emit(marker(OPEN_CONVERSATION, 's1'))
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('s1')
  })

  it('writes again on a second sessionTransition — last-write-wins (AC2)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => OPEN_CONVERSATION)

    bridge.emit(marker(OPEN_CONVERSATION, 's1'))
    bridge.emit(marker(OPEN_CONVERSATION, 's2'))
    expect(setSessionId).toHaveBeenCalledTimes(2)
    expect(setSessionId).toHaveBeenNthCalledWith(2, 's2')
  })

  it('does not call setSessionId for an unrelated event (AC3)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => OPEN_CONVERSATION)

    bridge.emit({ type: 'connecting' })
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('writes an empty-string newSessionId — the !== null guard, not truthiness (AC4)', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => OPEN_CONVERSATION)

    bridge.emit(marker(OPEN_CONVERSATION, ''))
    expect(setSessionId).toHaveBeenCalledTimes(1)
    expect(setSessionId).toHaveBeenCalledWith('')
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeSessionId(bridge.onDaemonEvent, vi.fn(), () => OPEN_CONVERSATION)
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-seen (null) to the id on a sessionTransition (seam)', () => {
    const bridge = fakeBridge()
    const store = createSessionIdStore()
    subscribeSessionId(
      bridge.onDaemonEvent,
      (id) => store.getState().setSessionId(id),
      () => OPEN_CONVERSATION
    )

    expect(selectSessionId(store.getState())).toBeNull()
    bridge.emit(marker(OPEN_CONVERSATION, 's1'))
    expect(selectSessionId(store.getState())).toBe('s1')
  })
})

describe('subscribeSessionId — the open-conversation gate (#1192)', () => {
  // The same injected-spy bridge, plus a getter the test owns. Every case here reads the getter's
  // value through the SUBSCRIPTION, never around it, so a gate that consulted anything else fails.
  function fakeBridge(): {
    onDaemonEvent: (l: (e: DaemonEvent) => void) => () => void
    emit: (e: DaemonEvent) => void
  } {
    let listener: ((e: DaemonEvent) => void) | undefined
    return {
      onDaemonEvent: (l) => {
        listener = l
        return () => {}
      },
      emit: (e) => listener?.(e)
    }
  }

  it('AC2: a marker naming another conversation leaves the store untouched', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => OPEN_CONVERSATION)

    // The live shape: chat A's session is evicted for idleness while the operator works in B. Before
    // this gate the id landed anyway, so B's footer controls addressed A's running session and a
    // model / effort / permission-mode pick was written to the wrong session.
    bridge.emit(marker(OTHER_CONVERSATION, 'session-elsewhere'))
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('AC2: the drop survives the store seam — the held id is unchanged, not overwritten', () => {
    const bridge = fakeBridge()
    const store = createSessionIdStore()
    subscribeSessionId(
      bridge.onDaemonEvent,
      (id) => store.getState().setSessionId(id),
      () => OPEN_CONVERSATION
    )

    bridge.emit(marker(OPEN_CONVERSATION, 'session-open'))
    bridge.emit(marker(OTHER_CONVERSATION, 'session-elsewhere'))
    expect(selectSessionId(store.getState())).toBe('session-open')
  })

  it('AC3: a marker arriving while no conversation is open lands nowhere, and does not latch', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    // `null` is what the injected getter returns with no chat open. No daemon-supplied conversation
    // id is null, so the comparison is unequal and the marker is DROPPED rather than held until a
    // conversation opens — fail-closed, the direction runConfigLive's `?? null` was chosen for.
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => null)

    bridge.emit(marker(OTHER_CONVERSATION, 'session-elsewhere'))
    expect(setSessionId).not.toHaveBeenCalled()
  })

  it('AC4: the open conversation is resolved PER MARKER, never captured at subscribe time', () => {
    const bridge = fakeBridge()
    const setSessionId = vi.fn()
    // One app-lifetime listener, one getter whose answer CHANGES between emits — the whole point.
    // An id captured in the closure would freeze at whatever was open when the leaf mounted, compile,
    // and pass every single-event case above; only a getter read per event survives this.
    let open = OPEN_CONVERSATION
    subscribeSessionId(bridge.onDaemonEvent, setSessionId, () => open)

    bridge.emit(marker(OPEN_CONVERSATION, 'session-first'))
    open = OTHER_CONVERSATION
    bridge.emit(marker(OTHER_CONVERSATION, 'session-second'))
    // ...and the first chat's own marker, now that the operator has switched away from it, is the one
    // that must be refused. A closure-captured id refuses the middle marker and accepts this one.
    bridge.emit(marker(OPEN_CONVERSATION, 'session-first-rotated'))

    expect(setSessionId.mock.calls).toEqual([['session-first'], ['session-second']])
  })

  it('the getter is consulted once per owned marker, and not at all for unrelated events', () => {
    const bridge = fakeBridge()
    const getOpenConversationId = vi.fn((): string | null => OPEN_CONVERSATION)
    subscribeSessionId(bridge.onDaemonEvent, vi.fn(), getOpenConversationId)

    // Not read at subscribe time — the listener has not run yet.
    expect(getOpenConversationId).not.toHaveBeenCalled()
    bridge.emit({ type: 'connecting' })
    expect(getOpenConversationId).not.toHaveBeenCalled()
    bridge.emit(marker(OPEN_CONVERSATION, 's1'))
    expect(getOpenConversationId).toHaveBeenCalledTimes(1)
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
