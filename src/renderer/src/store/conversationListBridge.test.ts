import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type {
  ConversationSummary,
  ConversationUpdatedPayload,
  MessagePayload
} from '@shared/wire/types'
import {
  translateConversationsEvent,
  shouldRefreshList,
  requestConversationList,
  subscribeConversations,
  ConversationListData
} from './conversationListBridge'
import { createConversationListStore, selectConversations } from './conversationListStore'
import { partitionByPromotion } from '../screens/channels/channelListViewModel'

// Framework-free data-path tests with injected spies (the runConfigSnapshot idiom): no React, no
// Electron. The real store is wired only for the not-loaded → loaded seam test.

const row = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'c1',
  name: 'Design review',
  is_promoted: true,
  is_archived: false,
  cwd: '/home/pyry/project',
  last_message_ts: '2026-07-10T12:00:00Z',
  last_used_at: '2026-07-10T12:05:00Z',
  ...over
})

const message: MessagePayload = {
  conversation_id: 'c',
  message_id: 'm',
  role: 'assistant',
  text: 't'
}

// The unsolicited conversation_updated broadcast payload (#273). The re-request path never reads its
// fields — a well-shaped default is enough to exercise the trigger.
const updated = (over: Partial<ConversationUpdatedPayload> = {}): ConversationUpdatedPayload => ({
  id: 'c1',
  is_promoted: true,
  name: 'Design review',
  cwd: '/home/pyry/project',
  last_used_at: '2026-07-10T12:05:00Z',
  ...over
})

describe('translateConversationsEvent', () => {
  it('maps a conversationsReceived to its conversations array (the owned arm)', () => {
    const list = [row({ id: 'a' }), row({ id: 'b' })]
    const event: DaemonEvent = { type: 'conversationsReceived', conversations: list }
    expect(translateConversationsEvent(event)).toBe(list)
  })

  it('maps an empty conversationsReceived to [] — not null (loaded-zero)', () => {
    const event: DaemonEvent = { type: 'conversationsReceived', conversations: [] }
    expect(translateConversationsEvent(event)).toEqual([])
    expect(translateConversationsEvent(event)).not.toBeNull()
  })

  it('returns null for a sample of unrelated daemon events (the filter)', () => {
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
      }
    ]
    for (const event of others) expect(translateConversationsEvent(event)).toBeNull()
  })
})

describe('requestConversationList', () => {
  it('fires exactly one requestConversations command (the bare #139 member)', () => {
    const sendCommand = vi.fn()
    requestConversationList(sendCommand)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({ type: 'requestConversations' })
  })
})

describe('shouldRefreshList', () => {
  it('returns true for a conversationUpdated broadcast (the existing refresh trigger)', () => {
    const event: DaemonEvent = { type: 'conversationUpdated', conversation: updated() }
    expect(shouldRefreshList(event)).toBe(true)
  })

  it('returns true for a conversationDeleted correlated reply (the new arm)', () => {
    const event: DaemonEvent = { type: 'conversationDeleted', id: 'a' }
    expect(shouldRefreshList(event)).toBe(true)
  })

  it('returns false for a sample of unrelated daemon events', () => {
    const others: DaemonEvent[] = [
      { type: 'conversationsReceived', conversations: [] },
      { type: 'connecting' },
      {
        type: 'conversationCreated',
        conversation: { id: 'c1', is_promoted: false, cwd: '/w', name: null, last_used_at: 'ts' }
      }
    ]
    for (const event of others) expect(shouldRefreshList(event)).toBe(false)
  })
})

describe('subscribeConversations', () => {
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
    subscribeConversations(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated list on a conversationsReceived event (AC2)', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, vi.fn())

    const list = [row({ id: 'a' })]
    bridge.emit({ type: 'conversationsReceived', conversations: list })
    expect(setConversations).toHaveBeenCalledTimes(1)
    expect(setConversations).toHaveBeenCalledWith(list)
  })

  it('does not call setConversations for an unrelated event', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, vi.fn())

    bridge.emit({ type: 'connecting' })
    expect(setConversations).not.toHaveBeenCalled()
  })

  it('writes an empty list (loaded-zero) — the !== null guard, not truthiness', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, vi.fn())

    bridge.emit({ type: 'conversationsReceived', conversations: [] })
    expect(setConversations).toHaveBeenCalledTimes(1)
    expect(setConversations).toHaveBeenCalledWith([])
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeConversations(bridge.onDaemonEvent, vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  it('drives the store from not-loaded (null) to loaded on a conversationsReceived (AC5)', () => {
    const bridge = fakeBridge()
    const store = createConversationListStore()
    subscribeConversations(
      bridge.onDaemonEvent,
      (list) => store.getState().setConversations(list),
      vi.fn()
    )

    expect(selectConversations(store.getState())).toBeNull()
    const list = [row({ id: 'a' }), row({ id: 'b' })]
    bridge.emit({ type: 'conversationsReceived', conversations: list })
    expect(selectConversations(store.getState())).toEqual(list)
  })

  it('re-requests (refreshOnChange) on a conversationUpdated — and does NOT write rows', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    const refreshOnChange = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, refreshOnChange)

    bridge.emit({ type: 'conversationUpdated', conversation: updated() })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)
    // An update event carries no rows to land — it only triggers the authoritative re-request.
    expect(setConversations).not.toHaveBeenCalled()
  })

  it('re-requests (refreshOnChange) on a conversationDeleted — and does NOT write rows', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    const refreshOnChange = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, refreshOnChange)

    bridge.emit({ type: 'conversationDeleted', id: 'a' })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)
    // A delete event carries no rows to land — it only triggers the authoritative re-request.
    expect(setConversations).not.toHaveBeenCalled()
  })

  it('a conversationDeleted while not-loaded fires the re-request but leaves the store null (AC2)', () => {
    const bridge = fakeBridge()
    const store = createConversationListStore()
    const refreshOnChange = vi.fn()
    subscribeConversations(
      bridge.onDaemonEvent,
      (list) => store.getState().setConversations(list),
      refreshOnChange
    )

    expect(selectConversations(store.getState())).toBeNull()
    bridge.emit({ type: 'conversationDeleted', id: 'a' })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)
    // The delete cannot fabricate an empty loaded list — the store stays not-loaded (null).
    expect(selectConversations(store.getState())).toBeNull()
  })

  it('a delete leaves the row absent once the authoritative re-request lands (AC1 + AC3)', () => {
    const bridge = fakeBridge()
    const store = createConversationListStore()
    const refreshOnChange = vi.fn()
    subscribeConversations(
      bridge.onDaemonEvent,
      (list) => store.getState().setConversations(list),
      refreshOnChange
    )

    // Seed: two rows.
    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'a' }), row({ id: 'b' })] })
    expect((selectConversations(store.getState()) ?? []).map((r) => r.id)).toEqual(['a', 'b'])

    // The correlated delete triggers exactly one re-request; it writes no rows itself.
    bridge.emit({ type: 'conversationDeleted', id: 'a' })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)
    expect((selectConversations(store.getState()) ?? []).map((r) => r.id)).toEqual(['a', 'b'])

    // The daemon's authoritative reply omits the deleted id; the whole-array replace lands the shorter list.
    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'b' })] })
    expect((selectConversations(store.getState()) ?? []).map((r) => r.id)).toEqual(['b'])
  })

  it('a delete for an id not in the list is harmless — one re-request, no observable change (AC3)', () => {
    const bridge = fakeBridge()
    const store = createConversationListStore()
    const refreshOnChange = vi.fn()
    subscribeConversations(
      bridge.onDaemonEvent,
      (list) => store.getState().setConversations(list),
      refreshOnChange
    )

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'a' }), row({ id: 'b' })] })

    // The trigger is id-blind: an absent id still fires exactly one re-request.
    bridge.emit({ type: 'conversationDeleted', id: 'zzz' })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)

    // The identical authoritative reply leaves the rows unchanged.
    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'a' }), row({ id: 'b' })] })
    expect((selectConversations(store.getState()) ?? []).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('does NOT re-request on a conversationsReceived — the two concerns never cross-fire', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    const refreshOnChange = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, refreshOnChange)

    bridge.emit({ type: 'conversationsReceived', conversations: [row({ id: 'a' })] })
    expect(setConversations).toHaveBeenCalledTimes(1)
    expect(refreshOnChange).not.toHaveBeenCalled()
  })

  it('calls neither spy for an unrelated event', () => {
    const bridge = fakeBridge()
    const setConversations = vi.fn()
    const refreshOnChange = vi.fn()
    subscribeConversations(bridge.onDaemonEvent, setConversations, refreshOnChange)

    bridge.emit({ type: 'connecting' })
    expect(setConversations).not.toHaveBeenCalled()
    expect(refreshOnChange).not.toHaveBeenCalled()
  })

  it('a promotion flips the row from discussions to channels once the re-request lands (AC1 + AC2)', () => {
    const bridge = fakeBridge()
    const store = createConversationListStore()
    const refreshOnChange = vi.fn()
    subscribeConversations(
      bridge.onDaemonEvent,
      (list) => store.getState().setConversations(list),
      refreshOnChange
    )

    // Seed: the row is an ad-hoc discussion (is_promoted false) — partitioned into `discussions`.
    const before = [row({ id: 'a', is_promoted: false })]
    bridge.emit({ type: 'conversationsReceived', conversations: before })
    const seeded = selectConversations(store.getState()) ?? []
    expect(partitionByPromotion(seeded).discussions.map((r) => r.id)).toEqual(['a'])
    expect(partitionByPromotion(seeded).channels).toEqual([])

    // The unsolicited promote broadcast triggers exactly one re-request; it writes no rows itself.
    bridge.emit({ type: 'conversationUpdated', conversation: updated({ id: 'a' }) })
    expect(refreshOnChange).toHaveBeenCalledTimes(1)

    // The daemon's authoritative reply carries the flipped row; the whole-array replace lands it.
    const after = [row({ id: 'a', is_promoted: true })]
    bridge.emit({ type: 'conversationsReceived', conversations: after })
    const flipped = selectConversations(store.getState()) ?? []
    expect(partitionByPromotion(flipped).channels.map((r) => r.id)).toEqual(['a'])
    expect(partitionByPromotion(flipped).discussions).toEqual([])
  })
})

describe('ConversationListData (container)', () => {
  // Server-render sanity — the RunConfigData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside effects, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps/refs/StrictMode) is verified by
  // inspection against the RunConfigData one-shot-ref idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(ConversationListData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
