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
import { questionBatchStore } from './questionBatchStore'

// One pending question batch for `conversationId`; its id is derived from, never equal to, the conversation id.
const showBatch = (conversationId: string): void =>
  questionBatchStore.getState().dispatch({
    type: 'shown',
    conversationId,
    questionBatchId: `q-${conversationId}`,
    questions: [{ question: 'Which branch?', header: 'Branch', options: [], multiSelect: false }]
  })
const dismissBatch = (conversationId: string): void =>
  questionBatchStore.getState().dispatch({
    type: 'dismissed',
    questionBatchId: `q-${conversationId}`,
    outcome: 'unanswered',
    source: 'no_answer'
  })

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
    expect(countAttentionConversations(rows('a', 'b', 'c', 'd', 'e'), (row) => status[row.id])).toBe(3)
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
    questionBatchStore.setState(questionBatchStore.getInitialState(), true)
  })

  it('reads idle for a conversation nothing is held about', () => {
    expect(conversationStatusNow({ id: 'nobody' })).toBe('idle')
  })

  it('reads input-required for a conversation with an outstanding prompt', () => {
    modalStore.setState({ outstanding: [{ conversationId: 'asking' }] } as never)
    expect(conversationStatusNow({ id: 'asking' })).toBe('input-required')
    expect(conversationStatusNow({ id: 'other' })).toBe('idle')
  })

  it('reads input-required for a conversation with only a pending question batch, until it is dismissed (#1700)', () => {
    showBatch('asking')
    expect(conversationStatusNow({ id: 'asking' })).toBe('input-required')
    expect(conversationStatusNow({ id: 'other' })).toBe('idle')
    dismissBatch('asking')
    expect(conversationStatusNow({ id: 'asking' })).toBe('idle')
  })

  it('reads working for a running turn, and new-messages for a held slice with no read mark', () => {
    const entry = { turnRunning: true, stalled: false, apiRetrying: false, compacting: false, resetting: false }
    conversationActivityStore.setState({ entries: new Map([['busy', entry]]) } as never)
    conversationTimelineStore.setState({
      timelines: new Map([['unread', { timeline: { items: [{}] } }], ['read', { timeline: { items: [{}] } }]])
    } as never)
    conversationLastReadStore.setState({ marks: new Map([['read', 1]]) } as never)
    expect(conversationStatusNow({ id: 'busy' })).toBe('working')
    expect(conversationStatusNow({ id: 'unread' })).toBe('new-messages')
    expect(conversationStatusNow({ id: 'read' })).toBe('idle')
  })
})

describe('attentionCountNow and subscribeToAttentionStores', () => {
  afterEach(() => {
    conversationListStore.setState(conversationListStore.getInitialState(), true)
    modalStore.setState(modalStore.getInitialState(), true)
    conversationActivityStore.setState(conversationActivityStore.getInitialState(), true)
    conversationTimelineStore.setState(conversationTimelineStore.getInitialState(), true)
    conversationLastReadStore.setState(conversationLastReadStore.getInitialState(), true)
    questionBatchStore.setState(questionBatchStore.getInitialState(), true)
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

  it('counts a question-only row once, and a row holding both a prompt and a batch once (#1700)', () => {
    conversationListStore.setState({
      conversations: [
        { id: 'asking', serverId: 'host-a', is_archived: false },
        { id: 'both', serverId: 'host-a', is_archived: false }
      ]
    } as never)
    showBatch('asking')
    showBatch('both')
    modalStore.setState({ outstanding: [{ conversationId: 'both' }] } as never)
    expect(attentionCountNow()).toBe(2)
    dismissBatch('asking')
    expect(attentionCountNow()).toBe(1)
  })

  it('reads zero before any list has loaded', () => {
    expect(attentionCountNow()).toBe(0)
  })

  it('wakes the listener on a write to each of the six stores, and off removes all six', () => {
    const listener = vi.fn()
    const off = subscribeToAttentionStores(listener)
    conversationListStore.setState({ conversations: [] } as never)
    modalStore.setState({ outstanding: [] } as never)
    conversationActivityStore.setState({ entries: new Map() } as never)
    conversationTimelineStore.setState({ timelines: new Map() } as never)
    conversationLastReadStore.setState({ marks: new Map() } as never)
    questionBatchStore.setState({ outstanding: [] } as never)
    expect(listener).toHaveBeenCalledTimes(6)
    off()
    conversationListStore.setState({ conversations: null } as never)
    modalStore.setState({ outstanding: [] } as never)
    conversationActivityStore.setState({ entries: new Map() } as never)
    conversationTimelineStore.setState({ timelines: new Map() } as never)
    conversationLastReadStore.setState({ marks: new Map() } as never)
    questionBatchStore.setState({ outstanding: [] } as never)
    expect(listener).toHaveBeenCalledTimes(6)
  })
})

describe('row-owned daemon attention', () => {
  afterEach(() => {
    conversationListStore.setState(conversationListStore.getInitialState(), true)
    conversationActivityStore.setState(conversationActivityStore.getInitialState(), true)
    modalStore.setState(modalStore.getInitialState(), true)
    questionBatchStore.setState(questionBatchStore.getInitialState(), true)
  })
  it('counts colliding IDs independently and retains precedence and badge exclusions', () => {
    const row = { id: 'same', name: null, cwd: '/w', is_promoted: false, is_archived: false,
      last_message_ts: '', last_used_at: '', workspace_label: null, read_up_to: 0, latest_entry_id: 10 }
    conversationListStore.getState().setConversations([row,
      { ...row, id: 'archived', is_archived: true }, { ...row, id: 'muted', is_muted: true }], 'a')
    conversationListStore.getState().setConversations([row], 'b')
    expect(attentionCountNow()).toBe(2)
    conversationListStore.getState().advanceReadMark('a', 'same', 10)
    expect(attentionCountNow()).toBe(1)
    expect(conversationStatusNow({ ...row, read_up_to: 10 })).toBe('idle')
    expect(conversationStatusNow(row)).toBe('new-messages')
    conversationActivityStore.getState().setTurnRunning('same', true)
    expect(conversationStatusNow(row)).toBe('working')
    expect(attentionCountNow()).toBe(0)
    showBatch('same')
    expect(conversationStatusNow(row)).toBe('input-required')
    expect(attentionCountNow()).toBe(2)
  })
})
