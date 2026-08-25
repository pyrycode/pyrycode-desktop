import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import {
  translateConversationActivity,
  subscribeConversationActivity,
  ConversationActivityData
} from './conversationActivityBridge'
import { createConversationActivityStore, selectActivityFor } from './conversationActivityStore'

// Framework-free data-path tests with injected spies (the backgroundTaskRosterBridge idiom): no React,
// no Electron. The real store is wired only for the seam tests. This bridge is reactive-only — the
// daemon pushes all four arms unsolicited — so there is no requestX describe block.
//
// Every fixture id is DISTINCT from every other id in the file, so an assertion that a write carries
// the event's own id cannot pass by coincidence with the one a neighbouring fixture used.
const turnState = (conversationId: string, state: 'thinking' | 'responding' | 'idle'): DaemonEvent => ({
  type: 'turnState',
  state,
  conversationId
})
const stallDetected = (conversationId: string): DaemonEvent => ({
  type: 'stallDetected',
  conversationId
})
const apiRetry = (conversationId: string, active: boolean, current = 3, total = 5): DaemonEvent => ({
  type: 'apiRetry',
  active,
  current,
  total,
  conversationId
})
const compacting = (conversationId: string, active: boolean): DaemonEvent => ({
  type: 'compacting',
  active,
  conversationId
})

describe('translateConversationActivity', () => {
  it('maps turnState{thinking} to BOTH writes — running true, and the stall clear', () => {
    expect(translateConversationActivity(turnState('conv-think', 'thinking'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-think', turnRunning: true },
      { fact: 'stalled', conversationId: 'conv-think', stalled: false }
    ])
  })

  it('maps turnState{responding} to turnRunning true (AC2 — a one-literal gate fails HERE)', () => {
    // The #648 defect in one assertion: a gate written against `'thinking'` alone passes the scenario
    // above and fails this one, making the signal vanish for the tool-heavy bulk of a turn.
    expect(translateConversationActivity(turnState('conv-respond', 'responding'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-respond', turnRunning: true },
      { fact: 'stalled', conversationId: 'conv-respond', stalled: false }
    ])
  })

  it('maps turnState{idle} to turnRunning false AND still clears the stall (AC3)', () => {
    // The clear is UNCONDITIONAL on any turn state, `idle` included — threadTimeline.ts:356-359's
    // shipped rule, reused rather than re-invented as a running-only variant.
    expect(translateConversationActivity(turnState('conv-idle', 'idle'))).toEqual([
      { fact: 'turnRunning', conversationId: 'conv-idle', turnRunning: false },
      { fact: 'stalled', conversationId: 'conv-idle', stalled: false }
    ])
  })

  it('maps stallDetected to one write, stalled true (onset-only, no payload beyond the id)', () => {
    expect(translateConversationActivity(stallDetected('conv-stall'))).toEqual([
      { fact: 'stalled', conversationId: 'conv-stall', stalled: true }
    ])
  })

  it('copies the apiRetry edge and carries NO counter into this store', () => {
    const writes = translateConversationActivity(apiRetry('conv-retry', true, 3, 5))

    expect(writes).toEqual([
      { fact: 'apiRetrying', conversationId: 'conv-retry', apiRetrying: true }
    ])
    // A fresh named-field literal, never a spread: `current` / `total` belong to the open
    // conversation's chrome (threadTimeline's ApiRetryStatus), and this store holds liveness only.
    expect(writes[0]).not.toHaveProperty('current')
    expect(writes[0]).not.toHaveProperty('total')
    expect(writes[0]).not.toHaveProperty('type')
  })

  it('copies the apiRetry falling edge', () => {
    expect(translateConversationActivity(apiRetry('conv-retry-off', false, 0, 0))).toEqual([
      { fact: 'apiRetrying', conversationId: 'conv-retry-off', apiRetrying: false }
    ])
  })

  it('copies both compacting edges', () => {
    expect(translateConversationActivity(compacting('conv-comp', true))).toEqual([
      { fact: 'compacting', conversationId: 'conv-comp', compacting: true }
    ])
    expect(translateConversationActivity(compacting('conv-comp-off', false))).toEqual([
      { fact: 'compacting', conversationId: 'conv-comp-off', compacting: false }
    ])
  })

  it('returns [] for an unowned arm rather than throwing (reactive-only, not exhaustive)', () => {
    const announced: DaemonEvent = {
      type: 'modelAnnounced',
      model: 'claude-opus-5',
      truncated: false,
      conversationId: 'conv-unowned'
    }
    const result: DaemonEvent = {
      type: 'toolResult',
      turnId: 't1',
      toolUseId: 'tu-1',
      isError: false,
      resultSummary: 'ok'
    }

    expect(translateConversationActivity(announced)).toEqual([])
    expect(translateConversationActivity(result)).toEqual([])
  })
})

describe('subscribeConversationActivity', () => {
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

  function wired() {
    const bridge = fakeBridge()
    const setTurnRunning = vi.fn()
    const setStalled = vi.fn()
    const setApiRetrying = vi.fn()
    const setCompacting = vi.fn()
    const off = subscribeConversationActivity(
      bridge.onDaemonEvent,
      setTurnRunning,
      setStalled,
      setApiRetrying,
      setCompacting
    )
    return { bridge, setTurnRunning, setStalled, setApiRetrying, setCompacting, off }
  }

  it('dispatches BOTH of turnState’s writes, never stopping at the first', () => {
    // The early-return regression this catches: the precedent's shape returns after the first match,
    // which here would silently drop the stall clear.
    const w = wired()
    w.bridge.emit(turnState('conv-a', 'responding'))

    expect(w.setTurnRunning).toHaveBeenCalledWith('conv-a', true)
    expect(w.setStalled).toHaveBeenCalledWith('conv-a', false)
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches stallDetected to setStalled alone', () => {
    const w = wired()
    w.bridge.emit(stallDetected('conv-b'))

    expect(w.setStalled).toHaveBeenCalledWith('conv-b', true)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches apiRetry to setApiRetrying alone', () => {
    const w = wired()
    w.bridge.emit(apiRetry('conv-c', true))

    expect(w.setApiRetrying).toHaveBeenCalledWith('conv-c', true)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('dispatches compacting to setCompacting alone', () => {
    const w = wired()
    w.bridge.emit(compacting('conv-d', false))

    expect(w.setCompacting).toHaveBeenCalledWith('conv-d', false)
    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
  })

  it('calls no setter at all for an unowned arm', () => {
    const w = wired()
    w.bridge.emit({ type: 'disconnected' })
    w.bridge.emit({ type: 'assistantDelta', turnId: 't1', seq: 1, text: 'hi' })

    expect(w.setTurnRunning).not.toHaveBeenCalled()
    expect(w.setStalled).not.toHaveBeenCalled()
    expect(w.setApiRetrying).not.toHaveBeenCalled()
    expect(w.setCompacting).not.toHaveBeenCalled()
  })

  it('subscribes once and returns the bridge’s own off handle as the only teardown', () => {
    const w = wired()

    expect(w.bridge.subscribeCalls()).toBe(1)
    expect(w.off).toBe(w.bridge.off)
    expect(w.bridge.off).not.toHaveBeenCalled()
    w.off()
    expect(w.bridge.off).toHaveBeenCalledTimes(1)
  })

  describe('seam (real store)', () => {
    function seam() {
      const bridge = fakeBridge()
      const store = createConversationActivityStore()
      subscribeConversationActivity(
        bridge.onDaemonEvent,
        (id, v) => store.getState().setTurnRunning(id, v),
        (id, v) => store.getState().setStalled(id, v),
        (id, v) => store.getState().setApiRetrying(id, v),
        (id, v) => store.getState().setCompacting(id, v)
      )
      return { bridge, store }
    }

    it('lands an arm for a conversation the client has never opened (AC1, AC4)', () => {
      const { bridge, store } = seam()
      expect(selectActivityFor('never-opened')(store.getState())).toBeNull()

      bridge.emit(compacting('never-opened', true))

      // Nothing here consults which conversation is open — `activeConversationStore` is not imported,
      // so the `?? activeConversation` fallback events.ts:116-117 bans is unavailable, not avoided.
      expect(selectActivityFor('never-opened')(store.getState())).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: false,
        compacting: true
      })
    })

    it('leaves every other conversation’s entry Object.is-identical (AC1, AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(apiRetry('conv-keep', true))
      const before = selectActivityFor('conv-keep')(store.getState())

      bridge.emit(turnState('conv-other', 'thinking'))
      bridge.emit(compacting('conv-other', true))
      bridge.emit(apiRetry('conv-other', false))

      expect(selectActivityFor('conv-keep')(store.getState())).toBe(before)
      expect(before).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: true,
        compacting: false
      })
    })

    it('does not latch a stall, and does not let a neighbour’s turn clear it (AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(stallDetected('conv-stalled'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(true)

      // Another conversation's turn activity must not reach into this one's entry.
      bridge.emit(turnState('conv-busy', 'thinking'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(true)

      // Its OWN turn state clears it — any state, `idle` included.
      bridge.emit(turnState('conv-stalled', 'idle'))
      expect(selectActivityFor('conv-stalled')(store.getState())?.stalled).toBe(false)
      expect(selectActivityFor('conv-stalled')(store.getState())?.turnRunning).toBe(false)
    })

    it('leaves apiRetry and compacting uncleared by turn activity, only by their edge (AC3)', () => {
      const { bridge, store } = seam()
      bridge.emit(apiRetry('conv-edges', true))
      bridge.emit(compacting('conv-edges', true))

      // Both have an explicit wire falling edge, so a turn-state change mid-retry or mid-compaction
      // must leave the fact showing — the inverse of `stalled`.
      bridge.emit(turnState('conv-edges', 'responding'))
      expect(selectActivityFor('conv-edges')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: true,
        compacting: true
      })

      bridge.emit(apiRetry('conv-edges', false))
      bridge.emit(compacting('conv-edges', false))
      expect(selectActivityFor('conv-edges')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: false,
        compacting: false
      })
    })

    it('treats __proto__, constructor and ’’ as three unremarkable keys — READ BEFORE WRITE', () => {
      const { bridge, store } = seam()

      // Assertion ORDER is the whole test. Reading only AFTER the write cannot distinguish the store's
      // `Map` from a `Record`: `entries['__proto__']` yields `Object.prototype` and `'constructor'`
      // yields the `Object` function, neither of which is nullish, so `?? null` would never fire and a
      // post-write read would pass against a prototype-polluting lookup.
      for (const hostile of ['__proto__', 'constructor', '']) {
        expect(selectActivityFor(hostile)(store.getState())).toBeNull()
      }

      bridge.emit(turnState('__proto__', 'thinking'))
      bridge.emit(stallDetected('constructor'))
      bridge.emit(compacting('', true))

      expect(selectActivityFor('__proto__')(store.getState())).toEqual({
        turnRunning: true,
        stalled: false,
        apiRetrying: false,
        compacting: false
      })
      expect(selectActivityFor('constructor')(store.getState())).toEqual({
        turnRunning: false,
        stalled: true,
        apiRetrying: false,
        compacting: false
      })
      expect(selectActivityFor('')(store.getState())).toEqual({
        turnRunning: false,
        stalled: false,
        apiRetrying: false,
        compacting: true
      })
    })
  })
})

describe('ConversationActivityData (container)', () => {
  // Server-render sanity — the BackgroundTaskRosterData idiom. The binding is headless (renders null)
  // and dereferences window.pyry only inside its effect, so a server render (effects never run)
  // produces empty markup without a bridge mock. That invariant is what keeps App.test's <App/> server
  // render passing with no window stub.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ConversationActivityData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
