import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, WireModelOption } from '@shared/wire/types'
import {
  translateModelList,
  subscribeModelList,
  requestModelList,
  ModelListData
} from './modelListBridge'
import { createModelListStore, selectModelListFor } from './modelListStore'

// Framework-free data-path tests with injected spies (the announcedModelBridge / slashCommandListBridge
// idiom): no React, no Electron. The real store is wired only for the absent → published seam tests
// and the `connected` pin.

const defaultRow: WireModelOption = {
  resolved_model: '<unmeasured>',
  value: 'default',
  display_name: 'Default (recommended)',
  effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  supports_auto_mode: true,
  truncated_fields: null
}

const haiku: WireModelOption = {
  resolved_model: 'claude-haiku-4-5-20251001',
  value: 'haiku',
  display_name: 'Haiku',
  effort_levels: [],
  supports_auto_mode: false,
  truncated_fields: null
}

const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

function listEvent(
  conversationId: string,
  models: readonly WireModelOption[],
  droppedModels: number
): DaemonEvent {
  return { type: 'modelList', conversationId, models, droppedModels }
}

describe('translateModelList', () => {
  it('maps a modelList to its snapshot (the owned arm)', () => {
    expect(translateModelList(listEvent('conv-1', [defaultRow, haiku], 3))).toEqual({
      conversationId: 'conv-1',
      models: [defaultRow, haiku],
      droppedModels: 3
    })
  })

  it('returns a FRESH literal, not the event — `type` never reaches the store', () => {
    const event = listEvent('conv-1', [defaultRow], 0)
    const result = translateModelList(event)
    expect(result).not.toBeNull()
    expect(result === null || 'type' in result).toBe(false)
    expect(result).not.toBe(event)
    // The row array itself still passes through by reference: the fresh literal is about the arm's
    // `type` tag and any field it gains later, not about copying the rows.
    expect(result?.models).toBe(event.type === 'modelList' ? event.models : undefined)
  })

  it('maps an EMPTY list to a snapshot, never to null (AC1)', () => {
    // Unconditional by design: there is no `if (event.models.length === 0) return null` here.
    // `models: []` is a positive statement that claude offered nothing, so it must be emitted and
    // consumed rather than coalesced as "no news".
    const result = translateModelList(listEvent('conv-1', [], 0))
    expect(result).not.toBeNull()
    expect(result).toEqual({ conversationId: 'conv-1', models: [], droppedModels: 0 })
  })

  it('carries droppedModels: 0 through as a value, never dropping the field', () => {
    const result = translateModelList(listEvent('conv-1', [defaultRow], 0))
    expect(result?.droppedModels).toBe(0)
    expect(result).toHaveProperty('droppedModels')
  })

  it('returns null for unrelated daemon events, INCLUDING its two structural twins (AC2)', () => {
    // `slashCommandList` and `backgroundTaskRoster` carry the identical shape — one conversation id, a
    // row list and a frame-level drop count — and are the arms a careless filter could pick up by
    // field name rather than by discriminant. `default: null` rather than `assertNever` is deliberate
    // and is a security control, not a style choice: every assertNever guard in this repo stringifies
    // the whole event into an Error, which would put claude-authored row text into an error message.
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack },
      { type: 'disconnected' },
      {
        type: 'slashCommandList',
        conversationId: 'conv-1',
        commands: [
          {
            name: 'clear',
            argument_hint: '',
            description: 'Clear conversation history',
            aliases: [],
            truncated_fields: null
          }
        ],
        droppedCommands: 2
      },
      {
        type: 'backgroundTaskRoster',
        conversationId: 'conv-1',
        tasks: [
          { task_id: 't1', task_type: 'local_bash', description: 'ls', truncated_fields: null }
        ],
        droppedTasks: 2
      },
      { type: 'modelAnnounced', model: 'claude-opus-5', truncated: false, conversationId: 'conv-1' },
      { type: 'conversationsReceived', conversations: [] }
    ]
    for (const event of others) expect(translateModelList(event)).toBeNull()
  })
})

describe('subscribeModelList', () => {
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
    subscribeModelList(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a modelList event (AC2)', () => {
    const bridge = fakeBridge()
    const setModelList = vi.fn()
    subscribeModelList(bridge.onDaemonEvent, setModelList)

    bridge.emit(listEvent('conv-1', [defaultRow], 5))
    expect(setModelList).toHaveBeenCalledTimes(1)
    expect(setModelList).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      models: [defaultRow],
      droppedModels: 5
    })
  })

  it('writes an EMPTY list — the !== null guard, not truthiness (AC1)', () => {
    const bridge = fakeBridge()
    const setModelList = vi.fn()
    subscribeModelList(bridge.onDaemonEvent, setModelList)

    // A snapshot object is truthy even when its `models` are empty, so the way an empty list would
    // get dropped is a `length` check at the translator. The guard stays on the RECORD's presence,
    // never on the list's contents — a content guard would drop the drop count with it.
    bridge.emit(listEvent('conv-1', [], 0))
    expect(setModelList).toHaveBeenCalledTimes(1)
    expect(setModelList).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      models: [],
      droppedModels: 0
    })
  })

  it('does not write on an unrelated event (AC2)', () => {
    const bridge = fakeBridge()
    const setModelList = vi.fn()
    subscribeModelList(bridge.onDaemonEvent, setModelList)

    bridge.emit({ type: 'connecting' })
    bridge.emit({
      type: 'backgroundTaskRoster',
      conversationId: 'conv-1',
      tasks: [],
      droppedTasks: 0
    })
    expect(setModelList).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeModelList(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from no-frame-arrived (null) to the published list (AC1 → AC2)', () => {
    const bridge = fakeBridge()
    const store = createModelListStore()
    subscribeModelList(bridge.onDaemonEvent, (s) => store.getState().setModelList(s))

    expect(selectModelListFor('conv-1')(store.getState())).toBeNull()
    bridge.emit(listEvent('conv-1', [defaultRow, haiku], 1))
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [defaultRow, haiku],
      droppedModels: 1
    })
  })

  it('a newer frame replaces the older one wholesale through the real store (AC2)', () => {
    const bridge = fakeBridge()
    const store = createModelListStore()
    subscribeModelList(bridge.onDaemonEvent, (s) => store.getState().setModelList(s))

    bridge.emit(listEvent('conv-1', [defaultRow, haiku], 4))
    bridge.emit(listEvent('conv-1', [haiku], 0))
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [haiku],
      droppedModels: 0
    })
  })

  it('lands each conversation’s frame under its own id (AC2)', () => {
    const bridge = fakeBridge()
    const store = createModelListStore()
    subscribeModelList(bridge.onDaemonEvent, (s) => store.getState().setModelList(s))

    // A frame arrives for a conversation the operator may never have opened, which is why the leaf is
    // mounted app-level rather than inside a screen.
    bridge.emit(listEvent('never-opened', [haiku], 0))
    bridge.emit(listEvent('conv-1', [defaultRow], 3))

    expect(selectModelListFor('never-opened')(store.getState())).toEqual({
      models: [haiku],
      droppedModels: 0
    })
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [defaultRow],
      droppedModels: 3
    })
  })

  it('a `connected` edge neither writes nor clears the store (AC2)', () => {
    const bridge = fakeBridge()
    const store = createModelListStore()
    subscribeModelList(bridge.onDaemonEvent, (s) => store.getState().setModelList(s))

    bridge.emit(listEvent('conv-1', [defaultRow], 2))
    const held = selectModelListFor('conv-1')(store.getState())

    // Pinned specifically. Copying backgroundTaskRosterBridge's `connected` reset would be wrong
    // twice over: that branch is the sole enforcement of ITS AC5, and this store's pairing-scoped
    // clear is #977's, landing in clearPairingScopedState's dep set where a reconnect never reaches
    // it. A reconnect to the same daemon does not invalidate a published list, and #1166's request half
    // does not change that: it is fired per conversation on activation, so a daemon-wide edge has no one
    // list to re-assert. The held entry must survive a re-handshake by reference, so nothing re-notifies
    // a subscriber either.
    bridge.emit({ type: 'connected', ack })
    expect(selectModelListFor('conv-1')(store.getState())).toBe(held)
    expect(selectModelListFor('conv-1')(store.getState())).toEqual({
      models: [defaultRow],
      droppedModels: 2
    })
  })

  it('leaves the store untouched on its structural twin, slashCommandList (AC2)', () => {
    const bridge = fakeBridge()
    const store = createModelListStore()
    subscribeModelList(bridge.onDaemonEvent, (s) => store.getState().setModelList(s))

    bridge.emit({
      type: 'slashCommandList',
      conversationId: 'conv-1',
      commands: [],
      droppedCommands: 3
    })
    expect(selectModelListFor('conv-1')(store.getState())).toBeNull()
  })
})

describe('requestModelList', () => {
  it('sends exactly one requestModelList naming the conversation (#1166)', () => {
    const sendCommand = vi.fn()

    requestModelList(sendCommand, 'conv-1')

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'requestModelList',
      payload: { conversation_id: 'conv-1' }
    })
  })

  it('puts NOTHING but the conversation id on the payload (#1166)', () => {
    // The wire bound is `buildRequestModelList`'s fresh literal, but the renderer half owes the same
    // discipline: a caller that later hands this an object to spread must not be able to widen the
    // payload from here.
    const sendCommand = vi.fn()

    requestModelList(sendCommand, 'conv-1')

    const command = sendCommand.mock.calls[0][0] as {
      payload: Record<string, unknown>
    }
    expect(Object.keys(command.payload)).toEqual(['conversation_id'])
  })

  it('sends nothing for an empty id, and nothing for null — asserted separately (#1166)', () => {
    // Two assertions rather than one parameterised case: `''` and `null` take the same falsy branch, so
    // a guard written for only one of them passes a test that checks only the other. `''` is the case
    // the boundary guard deliberately still ACCEPTS structurally, which is why refusing it has to be
    // proven here.
    const emptyId = vi.fn()
    requestModelList(emptyId, '')
    expect(emptyId).not.toHaveBeenCalled()

    const noId = vi.fn()
    requestModelList(noId, null)
    expect(noId).not.toHaveBeenCalled()
  })
})

describe('ModelListData (container)', () => {
  // Server-render sanity — the SlashCommandListData idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. That invariant is what keeps App.test.tsx's no-stub <App/>
  // render neutral once this leaf joins the fragment. Effect timing (deps/StrictMode) is verified by
  // inspection against the off-handle-as-cleanup idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ModelListData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
