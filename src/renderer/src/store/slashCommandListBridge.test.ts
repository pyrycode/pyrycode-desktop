import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type { HelloAckPayload, WireSlashCommand } from '@shared/wire/types'
import {
  translateSlashCommandList,
  subscribeSlashCommandList,
  SlashCommandListData
} from './slashCommandListBridge'
import { createSlashCommandListStore, selectSlashCommandListFor } from './slashCommandListStore'

// Framework-free data-path tests with injected spies (the announcedModelBridge idiom): no React, no
// Electron. The real store is wired only for the absent → published seam tests and the `connected`
// pin.

const clear: WireSlashCommand = {
  name: 'clear',
  argument_hint: '',
  description: 'Clear conversation history and free up context',
  aliases: ['reset'],
  truncated_fields: null
}

const ack: HelloAckPayload = {
  protocol_version: 'v2',
  server_id: 'srv-1',
  conn_id: 'conn-1',
  capabilities: ['interactive']
}

const compact: WireSlashCommand = {
  name: 'compact',
  argument_hint: '[instructions]',
  description: 'Compact the conversation',
  aliases: [],
  truncated_fields: ['aliases']
}

function listEvent(
  conversationId: string,
  commands: readonly WireSlashCommand[],
  droppedCommands: number
): DaemonEvent {
  return { type: 'slashCommandList', conversationId, commands, droppedCommands }
}

describe('translateSlashCommandList', () => {
  it('maps a slashCommandList to its snapshot (the owned arm)', () => {
    expect(translateSlashCommandList(listEvent('conv-1', [clear, compact], 3))).toEqual({
      conversationId: 'conv-1',
      commands: [clear, compact],
      droppedCommands: 3
    })
  })

  it('returns a FRESH literal, not the event — `type` never reaches the store', () => {
    const event = listEvent('conv-1', [clear], 0)
    const result = translateSlashCommandList(event)
    expect(result).not.toBeNull()
    expect(result === null || 'type' in result).toBe(false)
    expect(result).not.toBe(event)
    // The row array itself still passes through by reference: the fresh literal is about the arm's
    // `type` tag and any field it gains later, not about copying the rows.
    expect(result?.commands).toBe(event.type === 'slashCommandList' ? event.commands : undefined)
  })

  it('maps an EMPTY menu to a snapshot, never to null (AC2)', () => {
    // Unconditional by design: there is no `if (event.commands.length === 0) return null` here.
    // `commands: []` is a positive statement that claude offered nothing — the opposite reading from
    // `questionShown`, whose empty array means a producer bug.
    const result = translateSlashCommandList(listEvent('conv-1', [], 0))
    expect(result).not.toBeNull()
    expect(result).toEqual({ conversationId: 'conv-1', commands: [], droppedCommands: 0 })
  })

  it('carries droppedCommands: 0 through as a value, never dropping the field', () => {
    expect(translateSlashCommandList(listEvent('conv-1', [clear], 0))?.droppedCommands).toBe(0)
  })

  it('returns null for unrelated daemon events, INCLUDING its structural twin', () => {
    // `backgroundTaskRoster` carries the identical shape — one conversation id, a row list and a
    // frame-level drop count — and is the one arm a careless filter could pick up by field name
    // rather than by discriminant.
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      { type: 'connected', ack },
      { type: 'disconnected' },
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
    for (const event of others) expect(translateSlashCommandList(event)).toBeNull()
  })
})

describe('subscribeSlashCommandList', () => {
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
    subscribeSlashCommandList(bridge.onDaemonEvent, vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a slashCommandList event (AC3)', () => {
    const bridge = fakeBridge()
    const setSlashCommandList = vi.fn()
    subscribeSlashCommandList(bridge.onDaemonEvent, setSlashCommandList)

    bridge.emit(listEvent('conv-1', [clear], 5))
    expect(setSlashCommandList).toHaveBeenCalledTimes(1)
    expect(setSlashCommandList).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      commands: [clear],
      droppedCommands: 5
    })
  })

  it('writes an EMPTY menu — the !== null guard, not truthiness (AC2)', () => {
    const bridge = fakeBridge()
    const setSlashCommandList = vi.fn()
    subscribeSlashCommandList(bridge.onDaemonEvent, setSlashCommandList)

    bridge.emit(listEvent('conv-1', [], 0))
    expect(setSlashCommandList).toHaveBeenCalledTimes(1)
    expect(setSlashCommandList).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      commands: [],
      droppedCommands: 0
    })
  })

  it('does not write on an unrelated event', () => {
    const bridge = fakeBridge()
    const setSlashCommandList = vi.fn()
    subscribeSlashCommandList(bridge.onDaemonEvent, setSlashCommandList)

    bridge.emit({ type: 'connecting' })
    bridge.emit({
      type: 'backgroundTaskRoster',
      conversationId: 'conv-1',
      tasks: [],
      droppedTasks: 0
    })
    expect(setSlashCommandList).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeSlashCommandList(bridge.onDaemonEvent, vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from no-frame-arrived (null) to the published menu (AC2 → AC1)', () => {
    const bridge = fakeBridge()
    const store = createSlashCommandListStore()
    subscribeSlashCommandList(bridge.onDaemonEvent, (s) =>
      store.getState().setSlashCommandList(s)
    )

    expect(selectSlashCommandListFor('conv-1')(store.getState())).toBeNull()
    bridge.emit(listEvent('conv-1', [clear, compact], 1))
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [clear, compact],
      droppedCommands: 1
    })
  })

  it('a newer frame replaces the older one through the real store (AC1)', () => {
    const bridge = fakeBridge()
    const store = createSlashCommandListStore()
    subscribeSlashCommandList(bridge.onDaemonEvent, (s) =>
      store.getState().setSlashCommandList(s)
    )

    bridge.emit(listEvent('conv-1', [clear, compact], 4))
    bridge.emit(listEvent('conv-1', [compact], 0))
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [compact],
      droppedCommands: 0
    })
  })

  it('a `connected` edge neither writes nor clears the store (AC3)', () => {
    const bridge = fakeBridge()
    const store = createSlashCommandListStore()
    subscribeSlashCommandList(bridge.onDaemonEvent, (s) =>
      store.getState().setSlashCommandList(s)
    )

    bridge.emit(listEvent('conv-1', [clear], 2))
    const held = selectSlashCommandListFor('conv-1')(store.getState())

    // Pinned specifically. Copying backgroundTaskRosterBridge's `connected` reset would be wrong
    // twice over: that branch is the sole enforcement of ITS AC5, and this store's lifetime — the
    // pairing-scoped clear — is #955's slice. The held entry must survive a re-handshake byte for
    // byte, and by reference, so nothing re-notifies a subscriber either.
    bridge.emit({ type: 'connected', ack })
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toBe(held)
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toEqual({
      commands: [clear],
      droppedCommands: 2
    })
  })

  it('leaves the store untouched on its structural twin, backgroundTaskRoster (AC3)', () => {
    const bridge = fakeBridge()
    const store = createSlashCommandListStore()
    subscribeSlashCommandList(bridge.onDaemonEvent, (s) =>
      store.getState().setSlashCommandList(s)
    )

    bridge.emit({
      type: 'backgroundTaskRoster',
      conversationId: 'conv-1',
      tasks: [],
      droppedTasks: 3
    })
    expect(selectSlashCommandListFor('conv-1')(store.getState())).toBeNull()
  })
})

describe('SlashCommandListData (container)', () => {
  // Server-render sanity — the AnnouncedModelData idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. That invariant is what keeps App.test.tsx's no-stub <App/>
  // render neutral once this leaf joins the fragment. Effect timing (deps/StrictMode) is verified by
  // inspection against the off-handle-as-cleanup idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(SlashCommandListData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
