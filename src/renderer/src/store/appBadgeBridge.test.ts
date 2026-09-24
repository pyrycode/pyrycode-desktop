import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationStatus } from './conversationStatus'
import {
  attentionCountNow,
  conversationStatusNow,
  countAttentionConversations,
  subscribeAppBadge,
  subscribeToAttentionStores
} from './appBadgeBridge'
import { conversationListStore } from './conversationListStore'
import { modalStore } from './modalStore'
import { conversationActivityStore } from './conversationActivityStore'
import { conversationTimelineStore } from './conversationTimelineStore'
import { conversationLastReadStore } from './conversationLastReadStore'

const rows = (...ids: string[]): { id: string }[] => ids.map((id) => ({ id }))

describe('countAttentionConversations', () => {
  it('counts input-required and new-messages rows, never working or idle ones', () => {
    const status: Record<string, ConversationStatus> = {
      a: 'input-required',
      b: 'working',
      c: 'new-messages',
      d: 'idle',
      e: 'new-messages'
    }
    expect(countAttentionConversations(rows('a', 'b', 'c', 'd', 'e'), (id) => status[id])).toBe(3)
  })

  it('counts only the rows the caller passed', () => {
    expect(countAttentionConversations(rows('a', 'b'), () => 'input-required')).toBe(2)
    expect(countAttentionConversations([], () => 'input-required')).toBe(0)
  })
})

/** A hand-driven subscription: `set()` plays a store write, `live()` reports whether anyone listens. */
function harness(initial: number) {
  let count = initial
  let listener: (() => void) | null = null
  const sent: RendererCommand[] = []
  const off = subscribeAppBadge({
    subscribe: (l) => {
      listener = l
      return () => {
        listener = null
      }
    },
    count: () => count,
    sendCommand: (command) => sent.push(command)
  })
  return {
    sent,
    off,
    set: (next: number) => {
      count = next
      listener?.()
    },
    live: () => listener !== null
  }
}

const badge = (count: number): RendererCommand => ({ type: 'setBadgeCount', payload: { count } })

describe('subscribeAppBadge', () => {
  it('sends the first count on subscribe, even zero, so a reloaded window re-asserts the badge', () => {
    expect(harness(0).sent).toEqual([badge(0)])
    expect(harness(2).sent).toEqual([badge(2)])
  })

  it('sends each change once and stays silent while the count is unchanged', () => {
    const h = harness(0)
    h.set(1)
    h.set(1)
    h.set(3)
    h.set(3)
    h.set(0)
    expect(h.sent).toEqual([badge(0), badge(1), badge(3), badge(0)])
  })

  it('clears the badge on teardown and stops listening', () => {
    const h = harness(2)
    h.off()
    expect(h.live()).toBe(false)
    expect(h.sent).toEqual([badge(2), badge(0)])
  })

  it('sends nothing more on teardown when the badge already reads zero', () => {
    const h = harness(1)
    h.set(0)
    h.off()
    expect(h.sent).toEqual([badge(1), badge(0)])
  })
})

describe('conversationStatusNow', () => {
  afterEach(() => {
    modalStore.setState(modalStore.getInitialState(), true)
    conversationActivityStore.setState(conversationActivityStore.getInitialState(), true)
    conversationTimelineStore.setState(conversationTimelineStore.getInitialState(), true)
    conversationLastReadStore.setState(conversationLastReadStore.getInitialState(), true)
  })

  it('reads idle for a conversation nothing is held about', () => {
    expect(conversationStatusNow('nobody')).toBe('idle')
  })

  it('reads input-required for a conversation with an outstanding prompt', () => {
    modalStore.setState({ outstanding: [{ conversationId: 'asking' }] } as never)
    expect(conversationStatusNow('asking')).toBe('input-required')
    expect(conversationStatusNow('other')).toBe('idle')
  })

  it('reads working for a running turn, and new-messages for a held slice with no read mark', () => {
    const entry = { turnRunning: true, stalled: false, apiRetrying: false, compacting: false, resetting: false }
    conversationActivityStore.setState({ entries: new Map([['busy', entry]]) } as never)
    conversationTimelineStore.setState({
      timelines: new Map([['unread', { timeline: { items: [{}] } }], ['read', { timeline: { items: [{}] } }]])
    } as never)
    conversationLastReadStore.setState({ marks: new Map([['read', 1]]) } as never)
    expect(conversationStatusNow('busy')).toBe('working')
    expect(conversationStatusNow('unread')).toBe('new-messages')
    expect(conversationStatusNow('read')).toBe('idle')
  })
})

describe('attentionCountNow and subscribeToAttentionStores', () => {
  afterEach(() => {
    conversationListStore.setState(conversationListStore.getInitialState(), true)
    modalStore.setState(modalStore.getInitialState(), true)
    conversationActivityStore.setState(conversationActivityStore.getInitialState(), true)
    conversationTimelineStore.setState(conversationTimelineStore.getInitialState(), true)
    conversationLastReadStore.setState(conversationLastReadStore.getInitialState(), true)
  })

  it('counts every server\'s rows and leaves archived ones out, as the sidebar does', () => {
    conversationListStore.setState({
      conversations: [
        { id: 'one', serverId: 'host-a', is_archived: false },
        { id: 'two', serverId: 'host-b', is_archived: false },
        { id: 'gone', serverId: 'host-a', is_archived: true }
      ]
    } as never)
    modalStore.setState({
      outstanding: [{ conversationId: 'one' }, { conversationId: 'two' }, { conversationId: 'gone' }]
    } as never)
    expect(attentionCountNow()).toBe(2)
  })

  it('leaves a muted row out of the count, and counts the same row unmuted (#1607)', () => {
    modalStore.setState({ outstanding: [{ conversationId: 'noisy' }] } as never)
    conversationListStore.setState({
      conversations: [{ id: 'noisy', serverId: 'host-a', is_archived: false, is_muted: true }]
    } as never)
    expect(attentionCountNow()).toBe(0)
    conversationListStore.setState({
      conversations: [{ id: 'noisy', serverId: 'host-a', is_archived: false, is_muted: false }]
    } as never)
    expect(attentionCountNow()).toBe(1)
  })

  it('reads zero before any list has loaded', () => {
    expect(attentionCountNow()).toBe(0)
  })

  it('wakes the listener on a write to each of the five stores, and off removes all five', () => {
    const listener = vi.fn()
    const off = subscribeToAttentionStores(listener)
    conversationListStore.setState({ conversations: [] } as never)
    modalStore.setState({ outstanding: [] } as never)
    conversationActivityStore.setState({ entries: new Map() } as never)
    conversationTimelineStore.setState({ timelines: new Map() } as never)
    conversationLastReadStore.setState({ marks: new Map() } as never)
    expect(listener).toHaveBeenCalledTimes(5)
    off()
    conversationListStore.setState({ conversations: null } as never)
    modalStore.setState({ outstanding: [] } as never)
    conversationActivityStore.setState({ entries: new Map() } as never)
    conversationTimelineStore.setState({ timelines: new Map() } as never)
    conversationLastReadStore.setState({ marks: new Map() } as never)
    expect(listener).toHaveBeenCalledTimes(5)
  })
})
