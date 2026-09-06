import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DaemonEvent } from '@shared/ipc/events'
import type {
  ConversationSummary,
  HelloAckPayload,
  MessagePayload,
  QueuedItem
} from '@shared/wire/types'
import { translateQueueState, subscribeQueue, QueueData } from './queueBridge'
import { createQueueStore, selectBacklogFor } from './queueStore'
import {
  createConversationListStore,
  selectConversationIdsFor,
  type ConversationListOrigin
} from './conversationListStore'

// Framework-free data-path tests with injected spies (the sessionIdBridge idiom): no React, no
// Electron. The real store is wired only for the seam tests. This bridge is reactive-only — no
// request half — so there is no requestX describe block.

const a: QueuedItem = { queued_msg_id: 1, text: 'a', ts: '2026-07-10T00:00:00Z' }
const b: QueuedItem = { queued_msg_id: 2, text: 'b', ts: '2026-07-10T00:01:00Z' }

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

describe('translateQueueState', () => {
  it('maps a queueState event to { conversationId, queued } (the owned arm)', () => {
    const queued: readonly QueuedItem[] = [a, b]
    const event: DaemonEvent = { type: 'queueState', conversationId: 'c1', queued }
    const snapshot = translateQueueState(event)
    expect(snapshot).toEqual({ conversationId: 'c1', queued })
    // queued passes through by reference — enqueue order and identity preserved.
    expect(snapshot?.queued).toBe(queued)
  })

  it('returns null for a sample of unrelated daemon events (the filter, AC4)', () => {
    const others: DaemonEvent[] = [
      { type: 'connecting' },
      // `connected` stays null here on purpose: the #197 reset is a listener branch, NOT a translator
      // mapping — unlike the #415 modal translator, this translator is untouched and stays pure.
      { type: 'connected', ack },
      { type: 'disconnected' },
      { type: 'messageReceived', message },
      { type: 'conversationsReceived', conversations: [] },
      {
        type: 'sessionTransition',
        conversationId: 'conv-transition',
        newSessionId: 's1',
        reason: 'clear',
        occurredAt: '2026-07-10T00:00:00.000000000Z',
        workspaceCwd: null
      }
    ]
    for (const event of others) expect(translateQueueState(event)).toBeNull()
  })
})

describe('subscribeQueue', () => {
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

  // #1068's stamp rides BESIDE the union, so it arrives structurally at a bare-DaemonEvent-typed hole
  // while the static type stays silent about it. The cast is exactly that shape: a stamped `connected`
  // as it really arrives from the main side (the conversationListBridge.test idiom).
  const connectedFrom = (serverId: unknown): DaemonEvent =>
    ({ type: 'connected', ack, serverId }) as DaemonEvent

  const conversationRow = (id: string): ConversationSummary => ({
    id,
    name: null,
    is_promoted: false,
    is_archived: false,
    cwd: '/home/pyry/project',
    last_message_ts: '2026-07-10T12:00:00Z',
    last_used_at: '2026-07-10T12:05:00Z'
  })

  /**
   * Both real stores, wired the way `QueueData` wires them (#1138): the bridge hands the reset the
   * ORIGIN it read off the stamp, and the composition root resolves that to the ids to drop through
   * the shared conversation-list resolution. `lists` seeds which conversations each server has
   * reported — a server absent from it has no list yet, which is AC2's "drops nothing" case.
   */
  function seam(
    lists: readonly (readonly [ConversationListOrigin, readonly string[]])[] = []
  ): { bridge: ReturnType<typeof fakeBridge>; store: ReturnType<typeof createQueueStore> } {
    const bridge = fakeBridge()
    const store = createQueueStore()
    const list = createConversationListStore()
    for (const [origin, ids] of lists) {
      list.getState().setConversations(ids.map(conversationRow), origin)
    }
    subscribeQueue(
      bridge.onDaemonEvent,
      (s) => store.getState().setBacklog(s),
      (origin) => store.getState().resetBacklogsFor(selectConversationIdsFor(origin)(list.getState()))
    )
    return { bridge, store }
  }

  it('subscribes exactly once', () => {
    const bridge = fakeBridge()
    subscribeQueue(bridge.onDaemonEvent, vi.fn(), vi.fn())
    expect(bridge.subscribeCalls()).toBe(1)
  })

  it('writes the translated snapshot on a queueState event (AC1)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [a, b] })
  })

  it('writes an empty snapshot too — the !== null guard, not truthiness (AC2 clear case)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(setBacklog).toHaveBeenCalledWith({ conversationId: 'c1', queued: [] })
  })

  it('does not call setBacklog for an unrelated event (AC4)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, vi.fn())

    bridge.emit({ type: 'connecting' })
    expect(setBacklog).not.toHaveBeenCalled()
  })

  it('returns the off handle from onDaemonEvent as the cleanup', () => {
    const bridge = fakeBridge()
    const cleanup = subscribeQueue(bridge.onDaemonEvent, vi.fn(), vi.fn())
    cleanup()
    expect(bridge.off).toHaveBeenCalledTimes(1)
  })

  // #197 — the connected edge resets, every other event routes as before. Since #1138 the reset
  // carries the ORIGIN the edge came from, read off #1068's stamp; the caller turns it into the ids to
  // drop. The bridge itself never touches the conversation-list store, so this stays a plain spy.
  it('resets the backlog on a connected event, without writing a snapshot (AC1)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogsForServer = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogsForServer)

    bridge.emit(connectedFrom('srv-b'))
    expect(resetBacklogsForServer).toHaveBeenCalledTimes(1)
    expect(resetBacklogsForServer).toHaveBeenCalledWith('srv-b')
    expect(setBacklog).not.toHaveBeenCalled()
  })

  // AC2's key domain: the origin is three-valued and each value selects its OWN slot. Nothing here
  // special-cases the unstamped forms — they are ordinary lookup keys, which is the whole reason for
  // reusing ConversationListOrigin rather than minting a fourth origin declaration. The last row is a
  // stamp no producer can emit (bindServerOrigin takes a `string | null` scalar); answering with a slot
  // rather than throwing is what keeps originOf total, the three precedent bridges' rule.
  it.each([
    ['a real server id', connectedFrom('srv-b'), 'srv-b'],
    ['the unstamped null', connectedFrom(null), null],
    ['an absent stamp', { type: 'connected', ack } as DaemonEvent, undefined],
    ['a stamp that is neither a string nor null', connectedFrom(7), undefined]
  ])('scopes the reset to %s', (_label, event, expected) => {
    const bridge = fakeBridge()
    const resetBacklogsForServer = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, vi.fn(), resetBacklogsForServer)

    bridge.emit(event)
    expect(resetBacklogsForServer).toHaveBeenCalledTimes(1)
    expect(resetBacklogsForServer).toHaveBeenCalledWith(expected)
  })

  it('writes a snapshot on a queueState event, without resetting (AC2)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogsForServer = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogsForServer)

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    expect(setBacklog).toHaveBeenCalledTimes(1)
    expect(resetBacklogsForServer).not.toHaveBeenCalled()
  })

  it('neither resets nor writes for an unrelated event (AC4)', () => {
    const bridge = fakeBridge()
    const setBacklog = vi.fn()
    const resetBacklogsForServer = vi.fn()
    subscribeQueue(bridge.onDaemonEvent, setBacklog, resetBacklogsForServer)

    bridge.emit({ type: 'disconnected' })
    expect(setBacklog).not.toHaveBeenCalled()
    expect(resetBacklogsForServer).not.toHaveBeenCalled()
  })

  it('drives a real store from empty → held on a queueState emit (seam)', () => {
    const { bridge, store } = seam()

    expect(selectBacklogFor('c1')(store.getState())).toEqual([])
    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
  })

  it('a second queueState for a different conversation does not clobber the first (seam)', () => {
    const { bridge, store } = seam()

    bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
    bridge.emit({ type: 'queueState', conversationId: 'c2', queued: [b] })
    // Both readable end-to-end — replacement truth is per key, not a single last-snapshot slot.
    expect(selectBacklogFor('c1')(store.getState())).toEqual([a])
    expect(selectBacklogFor('c2')(store.getState())).toEqual([b])
  })

  // The three AC4 reconnect outcomes, proven end-to-end through the real store: reset on `connected`,
  // then the daemon's connect-time re-sends repopulate (or don't) through setBacklog unchanged. The
  // transport emits `connected` before any re-sent queue_state and the single channel delivers in
  // order, so reset-before-repopulate holds with no renderer ordering logic.
  describe('reconnect reconcile (seam)', () => {
    // One server, both of its conversations listed — the shape #197 shipped against, now reached
    // through the scoped reset. The stamp names the same server, so its listed keys are the ones the
    // reconnect drops.
    const reconnectSeam = () => seam([['srv-a', ['c1', 'c2']]])

    it('(a) a message dequeued while away does not resurrect after reconnect', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      bridge.emit(connectedFrom('srv-a'))
      // `a` drained into claude while away, so the re-send holds only `b`.
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [b] })
      expect(selectBacklogFor('c1')(store.getState())).toEqual([b])
    })

    it('(a-strong) a fully-drained conversation with no re-send reads empty across the boundary', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c2', queued: [b] })
      bridge.emit(connectedFrom('srv-a'))
      // c2 fully drained → the daemon re-sends NO snapshot for it → absent == empty (AC3).
      expect(selectBacklogFor('c2')(store.getState())).toEqual([])
    })

    it('(b) a message queued while away appears after reconnect', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a] })
      bridge.emit(connectedFrom('srv-a'))
      // `b` was queued while away — the re-send brings the current backlog.
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      expect(selectBacklogFor('c1')(store.getState())).toEqual([a, b])
    })

    it('(c) an untouched backlog reads identically after a reset-then-re-send round-trip', () => {
      const { bridge, store } = reconnectSeam()
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      bridge.emit(connectedFrom('srv-a'))
      bridge.emit({ type: 'queueState', conversationId: 'c1', queued: [a, b] })
      // Content-equal — the array reference legitimately changes (it is the fresh re-sent snapshot).
      expect(selectBacklogFor('c1')(store.getState())).toEqual([a, b])
    })
  })

  // #1138 — two servers connected at once, a queued backlog held for a conversation on each. The
  // reconnect edge is per-connection since #1117, so it must leave the other server's backlog alone.
  describe('per-server reconnect scope (seam)', () => {
    const twoServers = () =>
      seam([
        ['srv-a', ['a1']],
        ['srv-b', ['b1']]
      ])

    it('drops the reconnecting server’s backlog and leaves the other server’s held (AC1)', () => {
      const { bridge, store } = twoServers()
      bridge.emit({ type: 'queueState', conversationId: 'a1', queued: [a] })
      bridge.emit({ type: 'queueState', conversationId: 'b1', queued: [b] })

      bridge.emit(connectedFrom('srv-b'))
      expect(selectBacklogFor('a1')(store.getState())).toEqual([a])
      expect(selectBacklogFor('b1')(store.getState())).toEqual([])
    })

    it('repopulates B in arrival order after the reset, with A untouched (AC4)', () => {
      const { bridge, store } = seam([
        ['srv-a', ['a1']],
        ['srv-b', ['b1', 'b2']]
      ])
      bridge.emit({ type: 'queueState', conversationId: 'a1', queued: [a] })
      bridge.emit({ type: 'queueState', conversationId: 'b1', queued: [b] })

      bridge.emit(connectedFrom('srv-b'))
      // B's daemon re-sends one snapshot per non-empty conversation, in its own order.
      bridge.emit({ type: 'queueState', conversationId: 'b1', queued: [b, a] })
      bridge.emit({ type: 'queueState', conversationId: 'b2', queued: [a] })
      expect(selectBacklogFor('b1')(store.getState())).toEqual([b, a])
      expect(selectBacklogFor('b2')(store.getState())).toEqual([a])
      expect(selectBacklogFor('a1')(store.getState())).toEqual([a])
    })

    it('drops nothing when the reconnecting server has no list yet (AC2)', () => {
      // srv-b has never answered list_conversations — its slot holds no list, so its reconnect edge
      // resolves to the empty set. The first connect of a fresh server is exactly this case.
      const { bridge, store } = seam([['srv-a', ['a1']]])
      bridge.emit({ type: 'queueState', conversationId: 'a1', queued: [a] })
      bridge.emit(connectedFrom('srv-b'))
      expect(selectBacklogFor('a1')(store.getState())).toEqual([a])
    })

    it('scopes an unstamped or null-stamped edge to its OWN slot, nothing wider (AC2)', () => {
      const { bridge, store } = seam([
        ['srv-a', ['a1']],
        [null, ['n1']],
        [undefined, ['u1']]
      ])
      bridge.emit({ type: 'queueState', conversationId: 'a1', queued: [a] })
      bridge.emit({ type: 'queueState', conversationId: 'n1', queued: [a] })
      bridge.emit({ type: 'queueState', conversationId: 'u1', queued: [a] })

      bridge.emit(connectedFrom(null))
      expect(selectBacklogFor('n1')(store.getState())).toEqual([])
      expect(selectBacklogFor('a1')(store.getState())).toEqual([a])
      expect(selectBacklogFor('u1')(store.getState())).toEqual([a])

      bridge.emit({ type: 'connected', ack })
      expect(selectBacklogFor('u1')(store.getState())).toEqual([])
      expect(selectBacklogFor('a1')(store.getState())).toEqual([a])
    })

    it('leaves a backlog whose conversation is in NO server’s list alone (AC3)', () => {
      // The accepted consequence of scoping by the list. Pinned so a later widening is a deliberate
      // change rather than a drift.
      const { bridge, store } = twoServers()
      bridge.emit({ type: 'queueState', conversationId: 'orphan', queued: [a] })
      bridge.emit(connectedFrom('srv-a'))
      bridge.emit(connectedFrom('srv-b'))
      bridge.emit({ type: 'connected', ack })
      expect(selectBacklogFor('orphan')(store.getState())).toEqual([a])
    })

    it('scopes to the client-bound stamp, never the daemon’s ack.server_id (AC5)', () => {
      const { bridge, store } = twoServers()
      bridge.emit({ type: 'queueState', conversationId: 'a1', queued: [a] })
      bridge.emit({ type: 'queueState', conversationId: 'b1', queued: [b] })

      // The ack is the DAEMON's word and names srv-b; the stamp is bound main-side from a paired
      // record this client holds and names srv-a. A confused or hostile daemon must not be able to
      // steer which server's backlogs survive — the stamp wins.
      bridge.emit({
        ...(connectedFrom('srv-a') as object),
        ack: { ...ack, server_id: 'srv-b' }
      } as DaemonEvent)
      expect(selectBacklogFor('a1')(store.getState())).toEqual([])
      expect(selectBacklogFor('b1')(store.getState())).toEqual([b])
    })
  })
})

describe('QueueData (container)', () => {
  // Server-render sanity — the SessionIdData.test idiom. The binding is headless (renders null) and
  // dereferences window.pyry only inside its effect, so a server render (effects never run) produces
  // empty markup without a bridge mock. Effect timing (deps/StrictMode) is verified by inspection
  // against the SessionIdData subscribe-effect idiom, not unit-tested.
  it('server-renders to empty markup without touching window.pyry', () => {
    let markup = 'not-empty'
    expect(() => {
      markup = renderToStaticMarkup(createElement(QueueData))
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
