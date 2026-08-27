import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload } from '@shared/wire/types'
import {
  createRunConfigRefreshTrigger,
  subscribeRunConfigRefresh,
  RunConfigLiveData
} from './runConfigLive'

// Framework-free refresh-trigger tests with injected spies (the runConfigSnapshot / conversationListBridge
// idiom): no React, no store, no Electron. Both edge predicates and the subscribe seam are assertable
// without React, which is what makes AC1/AC2 deterministic in a repo whose renderer specs are static
// server renders (CLAUDE.md).

const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}
const connected: DaemonEvent = { type: 'connected', ack }

const turn = (conversationId: string, state: 'thinking' | 'responding' | 'idle'): DaemonEvent => ({
  type: 'turnState',
  state,
  conversationId
})

describe('createRunConfigRefreshTrigger', () => {
  it('fires on a connected event (AC1 — the figures exist before the sheet is ever mounted)', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(connected)).toBe(true)
  })

  it('fires on EVERY connected event — each one is a completed handshake, never a re-assertion', () => {
    // daemonConnection's one emit site fires on handshake-complete, and liveWindow replays the held
    // `connected` into a reopened window whose stores are empty. Both need the reading.
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(connected)).toBe(true)
    expect(trigger(connected)).toBe(true)
  })

  it('does not fire when a turn STARTS — neither running phase is an edge', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    const other = createRunConfigRefreshTrigger()
    expect(other(turn('a', 'responding'))).toBe(false)
  })

  it('fires on the running → not-running transition (AC2 — a read after a turn reflects it)', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(turn('a', 'idle'))).toBe(true)
  })

  it('counts BOTH running phases as running, via isTurnRunning', () => {
    // thinking → responding is not an end; the end is the arrival of a non-running phase.
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(turn('a', 'responding'))).toBe(false)
    expect(trigger(turn('a', 'idle'))).toBe(true)
  })

  it('does not fire for a conversation that was never observed running', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'idle'))).toBe(false)
    expect(trigger(turn('a', 'idle'))).toBe(false)
  })

  it('does not fire on an idle that merely RE-ASSERTS a phase already held (AC2)', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(turn('a', 'idle'))).toBe(true)
    expect(trigger(turn('a', 'idle'))).toBe(false)
  })

  it('holds phase PER CONVERSATION — interleaved turns do not steal each other’s edges', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(turn('b', 'thinking'))).toBe(false)
    expect(trigger(turn('a', 'idle'))).toBe(true)
    expect(trigger(turn('b', 'idle'))).toBe(true)
  })

  it('ignores an idle for an unrelated conversation while another one is running', () => {
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(turn('b', 'idle'))).toBe(false)
  })

  it('clears the running set on connected, so a turn in flight across a drop leaves no stale entry', () => {
    // A turn that was running when the socket dropped may have finished while it was down, so its
    // liveness must not survive the handshake (conversationActivityBridge's clearAllActivity argument).
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('a', 'thinking'))).toBe(false)
    expect(trigger(connected)).toBe(true)
    expect(trigger(turn('a', 'idle'))).toBe(false)
  })

  it('treats a daemon-supplied "__proto__" id as an ordinary membership key', () => {
    // The running set is a Set, never a plain object: `obj[id] = true` would hand a daemon-supplied
    // `__proto__` to Object.prototype's setter. Read back under the exact key.
    const trigger = createRunConfigRefreshTrigger()
    expect(trigger(turn('__proto__', 'thinking'))).toBe(false)
    expect(trigger(turn('__proto__', 'idle'))).toBe(true)
    expect(Object.prototype).toBe(Object.getPrototypeOf({}))
  })

  it('returns false for a sample of unrelated daemon events (the filter)', () => {
    const trigger = createRunConfigRefreshTrigger()
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'disconnected' },
      { type: 'conversationsReceived', conversations: [] },
      {
        type: 'runConfigReceived',
        sessionId: 'sess-a',
        model: '',
        effort: '',
        yolo: false,
        used_tokens: 0,
        window_tokens: 200000
      }
    ]
    for (const event of others) expect(trigger(event)).toBe(false)
  })

  it('gives each instance its own state — two triggers never share edges', () => {
    const first = createRunConfigRefreshTrigger()
    const second = createRunConfigRefreshTrigger()
    expect(first(turn('a', 'thinking'))).toBe(false)
    expect(second(turn('a', 'idle'))).toBe(false)
    expect(first(turn('a', 'idle'))).toBe(true)
  })
})

describe('subscribeRunConfigRefresh', () => {
  // A fake onDaemonEvent that captures the listener and hands back an off spy (the
  // runConfigSnapshot.test bridge shape).
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
    subscribeRunConfigRefresh(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeRunConfigRefresh(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('refreshes once per true edge and never on a false one', () => {
    const bridge = fakeBridge()
    const refresh = vi.fn()
    subscribeRunConfigRefresh(bridge.onDaemonEvent, refresh)

    bridge.emit(connected) // edge 1
    expect(refresh).toHaveBeenCalledTimes(1)
    bridge.emit(turn('a', 'thinking'))
    bridge.emit(turn('a', 'responding'))
    expect(refresh).toHaveBeenCalledTimes(1)
    bridge.emit(turn('a', 'idle')) // edge 2
    expect(refresh).toHaveBeenCalledTimes(2)
    bridge.emit(turn('a', 'idle')) // a re-assertion, not an edge
    bridge.emit({ type: 'disconnected' })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('takes no arguments into refresh — the request is daemon-wide, with no id to filter on', () => {
    const bridge = fakeBridge()
    const refresh = vi.fn()
    subscribeRunConfigRefresh(bridge.onDaemonEvent, refresh)

    bridge.emit(turn('a', 'thinking'))
    bridge.emit(turn('a', 'idle'))
    expect(refresh).toHaveBeenCalledWith()
  })

  it('gives each subscription its own trigger state', () => {
    const first = fakeBridge()
    const second = fakeBridge()
    const firstRefresh = vi.fn()
    const secondRefresh = vi.fn()
    subscribeRunConfigRefresh(first.onDaemonEvent, firstRefresh)
    subscribeRunConfigRefresh(second.onDaemonEvent, secondRefresh)

    first.emit(turn('a', 'thinking'))
    second.emit(turn('a', 'idle'))
    expect(secondRefresh).not.toHaveBeenCalled()
    first.emit(turn('a', 'idle'))
    expect(firstRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('RunConfigLiveData (container)', () => {
  // Server-render sanity — the ConversationActivityData idiom. The leaf is headless (renders null) and
  // dereferences window.pyry only inside its effects, so a server render (effects never run) produces
  // empty markup without a bridge mock. That invariant is what keeps App.test's <App/> server render
  // passing with no window stub.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(RunConfigLiveData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
