import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { BackgroundTask, HelloAckPayload, MessagePayload } from '@shared/wire/types'
import {
  translateBackgroundTaskRoster,
  subscribeBackgroundTaskRoster,
  BackgroundTaskRosterData
} from './backgroundTaskRosterBridge'
import { createBackgroundTaskRosterStore, selectRosterFor } from './backgroundTaskRosterStore'

// Framework-free data-path tests with injected spies (the queueBridge idiom): no React, no Electron.
// The real store is wired only for the seam tests. This bridge is reactive-only — the daemon pushes
// the roster unsolicited — so there is no requestX describe block.

const noCut: BackgroundTask = {
  task_id: 't1',
  task_type: 'local_bash',
  description: 'grep -rn "a<b&c" .',
  truncated_fields: null
}
const cutDescription: BackgroundTask = {
  task_id: 't2',
  task_type: 'local_bash',
  description: 'npm test -- src/renderer',
  truncated_fields: ['description']
}

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

describe('translateBackgroundTaskRoster', () => {
  it('maps a backgroundTaskRoster event to { conversationId, tasks, droppedTasks } (the owned arm)', () => {
    const tasks: readonly BackgroundTask[] = [noCut, cutDescription]
    const event: DaemonEvent = {
      type: 'backgroundTaskRoster',
      conversationId: 'c1',
      tasks,
      droppedTasks: 2
    }
    const snapshot = translateBackgroundTaskRoster(event)

    expect(snapshot).toEqual({ conversationId: 'c1', tasks, droppedTasks: 2 })
    // A FRESH named-field literal, never `return event` and never a spread — #574 widens the held
    // entry, and a spread would silently start carrying fields this slice never agreed to hold.
    expect(snapshot).not.toBe(event)
    // The rows pass through by reference — order, identity and snake_case preserved.
    expect(snapshot?.tasks).toBe(tasks)
  })

  it('maps an EMPTY roster to a snapshot, not null — the filter hazard (AC4)', () => {
    const event: DaemonEvent = {
      type: 'backgroundTaskRoster',
      conversationId: 'c1',
      tasks: [],
      droppedTasks: 0
    }
    // `tasks: []` is a positive statement that nothing is alive, not "no news": the translator stays
    // unconditional, so no `if (tasks.length === 0) return null` can creep in.
    expect(translateBackgroundTaskRoster(event)).toEqual({
      conversationId: 'c1',
      tasks: [],
      droppedTasks: 0
    })
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // `connected` stays null here on purpose: the AC5 reset is a listener branch, NOT a translator
      // mapping — unlike the modal translator, this one stays a pure roster→snapshot filter.
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'queueState', conversationId: 'c1', queued: [] },
      // The two dormant scalar siblings stay dormant here — they are #574's, not this slice's.
      {
        type: 'backgroundTaskStarted',
        conversationId: 'c1',
        taskId: 't1',
        taskType: 'local_bash',
        description: 'ls',
        toolCallId: 'tc-1',
        truncatedFields: null
      },
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'c1',
        taskId: 't1',
        patch: 'p',
        truncatedFields: null
      }
    ]
    for (const event of others) expect(translateBackgroundTaskRoster(event)).toBeNull()
  })
})

describe('subscribeBackgroundTaskRoster', () => {
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

  function roster(
    conversationId: string,
    tasks: readonly BackgroundTask[],
    droppedTasks = 0
  ): DaemonEvent {
    return { type: 'backgroundTaskRoster', conversationId, tasks, droppedTasks }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeBackgroundTaskRoster(bridge.onDaemonEvent, vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('writes the translated snapshot on a roster event, without resetting (AC1)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, setRoster, resetRosters)

    bridge.emit(roster('c1', [noCut, cutDescription], 1))
    expect(setRoster).toHaveBeenCalledTimes(1)
    expect(setRoster).toHaveBeenCalledWith({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 1
    })
    expect(resetRosters).not.toHaveBeenCalled()
  })

  it('writes an empty roster too — the !== null guard, not truthiness (AC4)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, setRoster, vi.fn())

    bridge.emit(roster('c1', []))
    expect(setRoster).toHaveBeenCalledTimes(1)
    expect(setRoster).toHaveBeenCalledWith({ conversationId: 'c1', tasks: [], droppedTasks: 0 })
  })

  it('resets on a connected event, without writing a snapshot (AC5)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, setRoster, resetRosters)

    bridge.emit({ type: 'connected', ack })
    expect(resetRosters).toHaveBeenCalledTimes(1)
    expect(setRoster).not.toHaveBeenCalled()
  })

  it('neither resets nor writes for an unrelated event', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, setRoster, resetRosters)

    bridge.emit({ type: 'disconnected' })
    expect(setRoster).not.toHaveBeenCalled()
    expect(resetRosters).not.toHaveBeenCalled()
  })

  describe('seam (real store)', () => {
    function seam() {
      const bridge = fakeBridge()
      const store = createBackgroundTaskRosterStore()
      subscribeBackgroundTaskRoster(
        bridge.onDaemonEvent,
        (s) => store.getState().setRoster(s),
        () => store.getState().resetRosters()
      )
      return { bridge, store }
    }

    it('drives a real store from never-observed → held on one roster emit', () => {
      const { bridge, store } = seam()
      expect(selectRosterFor('c1')(store.getState())).toBeNull()

      bridge.emit(roster('c1', [noCut], 2))
      expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: [noCut], droppedTasks: 2 })
    })

    it('a second roster for a different conversation does not clobber the first (AC1)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(roster('c2', [cutDescription]))

      // Replacement truth is per key, not a single last-roster slot.
      expect(selectRosterFor('c1')(store.getState())?.tasks).toEqual([noCut])
      expect(selectRosterFor('c2')(store.getState())?.tasks).toEqual([cutDescription])
    })

    it('a connected edge returns every held conversation to null (AC5 end-to-end)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(roster('c2', [cutDescription], 3))
      bridge.emit({ type: 'connected', ack })

      // The sole enforcement of AC5: a previous pairing's literal command lines never survive a
      // (re)handshake. This assertion must not be deleted as redundant with the store's own test.
      expect(selectRosterFor('c1')(store.getState())).toBeNull()
      expect(selectRosterFor('c2')(store.getState())).toBeNull()
    })

    it('keeps observed-empty and never-observed distinct end-to-end, then clears both (AC4, AC5)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', []))

      // The single test that would fail if the precedent's `?? EMPTY_*` collapse were cloned: c1 was
      // observed and holds nothing, c2 was never observed at all, and they read differently.
      expect(selectRosterFor('c1')(store.getState())).toEqual({ tasks: [], droppedTasks: 0 })
      expect(selectRosterFor('c2')(store.getState())).toBeNull()

      bridge.emit({ type: 'connected', ack })
      expect(selectRosterFor('c1')(store.getState())).toBeNull()
    })
  })
})

describe('BackgroundTaskRosterData (container)', () => {
  // Server-render sanity — the QueueData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. That invariant is what keeps App.test's <App/> server render
  // passing with no window stub.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(BackgroundTaskRosterData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
