import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { BackgroundTask, HelloAckPayload, MessagePayload } from '@shared/wire/types'
import {
  translateBackgroundTaskRoster,
  translateBackgroundTaskStarted,
  translateBackgroundTaskUpdated,
  subscribeBackgroundTaskRoster,
  BackgroundTaskRosterData
} from './backgroundTaskRosterBridge'
import { createBackgroundTaskRosterStore, selectRosterFor } from './backgroundTaskRosterStore'

// Framework-free data-path tests with injected spies (the queueBridge idiom): no React, no Electron.
// The real store is wired only for the seam tests. This bridge is reactive-only — the daemon pushes
// all three frames unsolicited — so there is no requestX describe block. Three sibling translators,
// each a pure single-arm filter, rather than one translator returning a tagged union.

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

/** The started frame's fuller copy of `noCut`'s label, plus the tool call no roster row carries. */
const fullDescription = 'grep -rn "a<b&c" . --include="*.ts" --color=never'

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
    // A FRESH named-field literal, never `return event` and never a spread: a spread would carry the
    // arm's `type` tag and any field a later arm gains into a write unit that never agreed to hold it.
    expect(snapshot).not.toBe(event)
    // The rows still pass through by reference here — the row → held-record mapping happens inside
    // `setRoster`, which is where the prior state the join needs lives.
    expect(snapshot?.tasks).toBe(tasks)
  })

  it('maps an EMPTY roster to a snapshot, not null — the filter hazard (AC5)', () => {
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
      // The started arm is this bridge's, but it belongs to the SIBLING translator below — each one
      // stays a single-arm filter, so neither's existing assertions move when the other lands.
      {
        type: 'backgroundTaskStarted',
        conversationId: 'c1',
        taskId: 't1',
        taskType: 'local_bash',
        description: 'ls',
        toolCallId: 'tc-1',
        truncatedFields: null
      },
      // `backgroundTaskUpdated` is now this bridge's too, but it belongs to the THIRD translator
      // below — the assertion stays, because each translator remains a single-arm filter.
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

describe('translateBackgroundTaskStarted', () => {
  it('maps a backgroundTaskStarted event to its six-field snapshot (the owned arm)', () => {
    const event: DaemonEvent = {
      type: 'backgroundTaskStarted',
      conversationId: 'c1',
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: fullDescription,
      truncatedFields: ['description']
    }
    const snapshot = translateBackgroundTaskStarted(event)

    expect(snapshot).toEqual({
      conversationId: 'c1',
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: fullDescription,
      truncatedFields: ['description']
    })
    // Same posture as its neighbour: a fresh named-field literal, never `return event`, never a spread.
    expect(snapshot).not.toBe(event)
  })

  it('passes truncatedFields: null through as null — never collapsed into [] (AC3)', () => {
    const event: DaemonEvent = {
      type: 'backgroundTaskStarted',
      conversationId: 'c1',
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: 'ls',
      truncatedFields: null
    }
    expect(translateBackgroundTaskStarted(event)?.truncatedFields).toBeNull()
  })

  it('returns null for a sample of unrelated daemon events, roster and updated included', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'backgroundTaskRoster', conversationId: 'c1', tasks: [noCut], droppedTasks: 0 },
      {
        type: 'backgroundTaskUpdated',
        conversationId: 'c1',
        taskId: 't1',
        patch: 'p',
        truncatedFields: null
      }
    ]
    for (const event of others) expect(translateBackgroundTaskStarted(event)).toBeNull()
  })
})

describe('translateBackgroundTaskUpdated', () => {
  it('maps a backgroundTaskUpdated event to its four-field snapshot (the owned arm)', () => {
    const event: DaemonEvent = {
      type: 'backgroundTaskUpdated',
      conversationId: 'c1',
      taskId: 't1',
      patch: '{"is_backgrounded":true}',
      truncatedFields: ['patch']
    }
    const snapshot = translateBackgroundTaskUpdated(event)

    // FOUR fields, not six: no toolCallId, no description, no taskType, and it gains `patch`.
    expect(snapshot).toEqual({
      conversationId: 'c1',
      taskId: 't1',
      patch: '{"is_backgrounded":true}',
      truncatedFields: ['patch']
    })
    // Same posture as both neighbours: a fresh named-field literal, never `return event`, never a
    // spread — a spread would carry the `type` tag into a write unit that never agreed to hold it.
    expect(snapshot).not.toBe(event)
  })

  it('passes truncatedFields: null through as null — never collapsed into [] (AC3)', () => {
    const event: DaemonEvent = {
      type: 'backgroundTaskUpdated',
      conversationId: 'c1',
      taskId: 't1',
      patch: '',
      truncatedFields: null
    }
    const snapshot = translateBackgroundTaskUpdated(event)

    expect(snapshot?.truncatedFields).toBeNull()
    // And `patch: ''` survives as the value it is — the arm always carries one (no `omitempty`).
    expect(snapshot?.patch).toBe('')
  })

  it('returns null for a sample of unrelated daemon events, roster and started included', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'backgroundTaskRoster', conversationId: 'c1', tasks: [noCut], droppedTasks: 0 },
      {
        type: 'backgroundTaskStarted',
        conversationId: 'c1',
        taskId: 't1',
        toolCallId: 'tc-1',
        taskType: 'local_bash',
        description: 'ls',
        truncatedFields: null
      }
    ]
    for (const event of others) expect(translateBackgroundTaskUpdated(event)).toBeNull()
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

  function taskStarted(
    conversationId: string,
    taskId: string,
    toolCallId = 'tc-1',
    description = fullDescription
  ): DaemonEvent {
    return {
      type: 'backgroundTaskStarted',
      conversationId,
      taskId,
      toolCallId,
      taskType: 'local_bash',
      description,
      truncatedFields: null
    }
  }

  function taskUpdated(
    conversationId: string,
    taskId: string,
    patch = '{"is_backgrounded":true}',
    truncatedFields: readonly string[] | null = null
  ): DaemonEvent {
    return { type: 'backgroundTaskUpdated', conversationId, taskId, patch, truncatedFields }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, vi.fn(), vi.fn(), vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeBackgroundTaskRoster(bridge.onDaemonEvent, vi.fn(), vi.fn(), vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('writes the translated snapshot on a roster event, without resetting (AC1)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    const setStartedTask = vi.fn()
    const setUpdatedTask = vi.fn()
    subscribeBackgroundTaskRoster(
      bridge.onDaemonEvent,
      setRoster,
      resetRosters,
      setStartedTask,
      setUpdatedTask
    )

    bridge.emit(roster('c1', [noCut, cutDescription], 1))
    expect(setRoster).toHaveBeenCalledTimes(1)
    expect(setRoster).toHaveBeenCalledWith({
      conversationId: 'c1',
      tasks: [noCut, cutDescription],
      droppedTasks: 1
    })
    expect(setStartedTask).not.toHaveBeenCalled()
    expect(setUpdatedTask).not.toHaveBeenCalled()
    expect(resetRosters).not.toHaveBeenCalled()
  })

  it('writes an empty roster too — the !== null guard, not truthiness (AC5)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    subscribeBackgroundTaskRoster(bridge.onDaemonEvent, setRoster, vi.fn(), vi.fn(), vi.fn())

    bridge.emit(roster('c1', []))
    expect(setRoster).toHaveBeenCalledTimes(1)
    expect(setRoster).toHaveBeenCalledWith({ conversationId: 'c1', tasks: [], droppedTasks: 0 })
  })

  it('writes the started snapshot on a started event, without rostering or resetting (AC1)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    const setStartedTask = vi.fn()
    const setUpdatedTask = vi.fn()
    subscribeBackgroundTaskRoster(
      bridge.onDaemonEvent,
      setRoster,
      resetRosters,
      setStartedTask,
      setUpdatedTask
    )

    bridge.emit(taskStarted('c1', 't1'))
    expect(setStartedTask).toHaveBeenCalledTimes(1)
    expect(setStartedTask).toHaveBeenCalledWith({
      conversationId: 'c1',
      taskId: 't1',
      toolCallId: 'tc-1',
      taskType: 'local_bash',
      description: fullDescription,
      truncatedFields: null
    })
    expect(setRoster).not.toHaveBeenCalled()
    expect(setUpdatedTask).not.toHaveBeenCalled()
    expect(resetRosters).not.toHaveBeenCalled()
  })

  it('writes the updated snapshot on an updated event, and nothing else (AC1)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    const setStartedTask = vi.fn()
    const setUpdatedTask = vi.fn()
    subscribeBackgroundTaskRoster(
      bridge.onDaemonEvent,
      setRoster,
      resetRosters,
      setStartedTask,
      setUpdatedTask
    )

    bridge.emit(taskUpdated('c1', 't1', 'p', ['patch']))
    expect(setUpdatedTask).toHaveBeenCalledTimes(1)
    expect(setUpdatedTask).toHaveBeenCalledWith({
      conversationId: 'c1',
      taskId: 't1',
      patch: 'p',
      truncatedFields: ['patch']
    })
    expect(setRoster).not.toHaveBeenCalled()
    expect(setStartedTask).not.toHaveBeenCalled()
    expect(resetRosters).not.toHaveBeenCalled()
  })

  it('resets on a connected event, without writing either snapshot (AC5)', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    const setStartedTask = vi.fn()
    const setUpdatedTask = vi.fn()
    subscribeBackgroundTaskRoster(
      bridge.onDaemonEvent,
      setRoster,
      resetRosters,
      setStartedTask,
      setUpdatedTask
    )

    bridge.emit(taskStarted('c1', 't1'))
    bridge.emit({ type: 'connected', ack })
    expect(resetRosters).toHaveBeenCalledTimes(1)
    expect(setRoster).not.toHaveBeenCalled()
  })

  it('neither resets nor writes for an unrelated event', () => {
    const bridge = fakeBridge()
    const setRoster = vi.fn()
    const resetRosters = vi.fn()
    const setStartedTask = vi.fn()
    const setUpdatedTask = vi.fn()
    subscribeBackgroundTaskRoster(
      bridge.onDaemonEvent,
      setRoster,
      resetRosters,
      setStartedTask,
      setUpdatedTask
    )

    bridge.emit({ type: 'disconnected' })
    expect(setRoster).not.toHaveBeenCalled()
    expect(setStartedTask).not.toHaveBeenCalled()
    expect(setUpdatedTask).not.toHaveBeenCalled()
    expect(resetRosters).not.toHaveBeenCalled()
  })

  describe('seam (real store)', () => {
    function seam() {
      const bridge = fakeBridge()
      const store = createBackgroundTaskRosterStore()
      subscribeBackgroundTaskRoster(
        bridge.onDaemonEvent,
        (s) => store.getState().setRoster(s),
        () => store.getState().resetRosters(),
        (s) => store.getState().setStartedTask(s),
        (s) => store.getState().setUpdatedTask(s)
      )
      return { bridge, store }
    }

    const heldTask = (
      store: ReturnType<typeof createBackgroundTaskRosterStore>,
      conversationId: string,
      taskId: string
    ) => selectRosterFor(conversationId)(store.getState())?.tasks.get(taskId)

    it('drives a real store from never-observed → held on one roster emit', () => {
      const { bridge, store } = seam()
      expect(selectRosterFor('c1')(store.getState())).toBeNull()

      bridge.emit(roster('c1', [noCut], 2))
      expect(selectRosterFor('c1')(store.getState())?.droppedTasks).toBe(2)
      expect(heldTask(store, 'c1', 't1')).toEqual({
        taskId: 't1',
        toolCallId: null,
        taskType: 'local_bash',
        description: 'grep -rn "a<b&c" .',
        truncatedFields: null,
        latestUpdate: null
      })
    })

    it('drives a real store from never-observed → held on one started emit', () => {
      const { bridge, store } = seam()
      bridge.emit(taskStarted('c1', 't1'))

      expect(heldTask(store, 'c1', 't1')).toEqual({
        taskId: 't1',
        toolCallId: 'tc-1',
        taskType: 'local_bash',
        description: fullDescription,
        truncatedFields: null,
        latestUpdate: null
      })
    })

    it('started → roster keeps the fuller label and the toolCallId end-to-end (AC2, AC4)', () => {
      const { bridge, store } = seam()
      bridge.emit(taskStarted('c1', 't1'))
      bridge.emit(roster('c1', [noCut, cutDescription]))

      // The roster row's shorter-capped copy of the same text never overwrites the authoritative one.
      expect(heldTask(store, 'c1', 't1')?.description).toBe(fullDescription)
      expect(heldTask(store, 'c1', 't1')?.toolCallId).toBe('tc-1')
      expect(heldTask(store, 'c1', 't2')?.toolCallId).toBeNull()
    })

    it('roster → started upgrades the held task in place (AC2)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut, cutDescription]))
      bridge.emit(taskStarted('c1', 't1'))

      expect(heldTask(store, 'c1', 't1')?.description).toBe(fullDescription)
      expect([...(selectRosterFor('c1')(store.getState())?.tasks.keys() ?? [])]).toEqual(['t1', 't2'])
    })

    it('a roster excluding a started-only task drops it (AC5)', () => {
      const { bridge, store } = seam()
      bridge.emit(taskStarted('c1', 't1'))
      bridge.emit(roster('c1', [cutDescription]))

      expect(heldTask(store, 'c1', 't1')).toBeUndefined()
      expect(heldTask(store, 'c1', 't2')).toBeDefined()
    })

    it('roster → update → roster keeps the patch and refreshes the row fields (AC4 end-to-end)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(taskUpdated('c1', 't1', 'p', ['patch']))
      bridge.emit(
        roster('c1', [
          {
            task_id: 't1',
            task_type: 'remote_agent',
            description: 'newer label',
            truncated_fields: []
          }
        ])
      )

      // No roster row can report a patch, so the recorded pair rides across the rebuild while every
      // field the row CAN report is refreshed from it.
      expect(heldTask(store, 'c1', 't1')?.latestUpdate).toEqual({
        patch: 'p',
        truncatedFields: ['patch']
      })
      expect(heldTask(store, 'c1', 't1')?.description).toBe('newer label')
      expect(heldTask(store, 'c1', 't1')?.taskType).toBe('remote_agent')
    })

    it('a connected edge clears recorded patches too (AC5 end-to-end)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(taskUpdated('c1', 't1'))
      expect(heldTask(store, 'c1', 't1')?.latestUpdate).not.toBeNull()

      bridge.emit({ type: 'connected', ack })

      // A patch key may carry command text, so a previous PAIRING's patch never survives a
      // (re)handshake. This assertion must not be deleted as redundant with the store's own test.
      expect(selectRosterFor('c1')(store.getState())).toBeNull()
    })

    it('a second write for a different conversation does not clobber the first (AC1)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(taskStarted('c2', 't2'))

      // Replacement truth is per key, not a single last-frame slot.
      expect(heldTask(store, 'c1', 't1')).toBeDefined()
      expect(heldTask(store, 'c2', 't2')).toBeDefined()
    })

    it('a connected edge returns every held conversation to null, both kinds (AC5 end-to-end)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', [noCut]))
      bridge.emit(taskStarted('c2', 't2'))
      bridge.emit({ type: 'connected', ack })

      // The sole enforcement of AC5: a previous pairing's literal command lines never survive a
      // (re)handshake, whichever frame reported them. This assertion must not be deleted as
      // redundant with the store's own test.
      expect(selectRosterFor('c1')(store.getState())).toBeNull()
      expect(selectRosterFor('c2')(store.getState())).toBeNull()
    })

    it('keeps observed-empty and never-observed distinct end-to-end, then clears both (AC5)', () => {
      const { bridge, store } = seam()
      bridge.emit(roster('c1', []))

      // The single test that would fail if the precedent's `?? EMPTY_*` collapse were cloned: c1 was
      // observed and holds nothing, c2 was never observed at all, and they read differently.
      expect(selectRosterFor('c1')(store.getState())).toEqual({
        tasks: new Map(),
        droppedTasks: 0
      })
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
