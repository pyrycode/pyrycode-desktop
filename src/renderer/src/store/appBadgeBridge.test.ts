import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationStatus } from './conversationStatus'
import { attentionCountNow, conversationStatusNow, countAttentionConversations,
  subscribeAppBadge, subscribeToAttentionStores } from './appBadgeBridge'
import { conversationListStore } from './conversationListStore'
import { threadRuntime } from './threadRuntime'
import { createThreadLiveState } from './threadLiveState'
import type { DaemonEvent } from '@shared/ipc/events'
import { modalStore } from './modalStore'
import { conversationActivityStore } from './conversationActivityStore'

const rows = (...ids: string[]): { id: string }[] => ids.map(id => ({ id }))
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


const row = (serverId = 'a', id = 'same') => ({ id, serverId, name: null, cwd: '/w',
  is_promoted: false, is_archived: false, last_message_ts: '', last_used_at: '', workspace_label: null,
  last_shown_version: 10, read_up_to: 0, latest_entry_id: 99 })
beforeEach(() => {
  const lives = new Map<string, ReturnType<typeof threadRuntime.live>>()
  vi.spyOn(threadRuntime, 'live').mockImplementation((host, id) => {
    const key = JSON.stringify([host, id])
    let live = lives.get(key)
    if (!live) {
      live = createThreadLiveState({ sendResponse: vi.fn(), isConnected: () => true })
      lives.set(key, live)
    }
    return live
  })
})
function reading(type: 'turnState' | 'questionShown', host = 'a', id = 'same') {
  const live = threadRuntime.live(host, id)
  live.getState().dispatch({ type: 'summary', serverId: host, summary: { id, current_session_id: 's' } })
  const event: DaemonEvent = type === 'turnState'
    ? { type, conversationId: id, state: 'thinking' }
    : { type, conversationId: id, questionBatchId: 'question', questions: [
      { question: 'Choose?', header: 'Choice', options: [], multi_select: false }
    ] }
  const received = { ...event, serverId: host, envelopeSessionId: 's' }
  live.getState().dispatch({ type: 'daemon', event: received })
  return live
}
afterEach(() => {
  conversationListStore.setState(conversationListStore.getInitialState(), true)
  modalStore.setState(modalStore.getInitialState(), true)
  conversationActivityStore.setState(conversationActivityStore.getInitialState(), true)
  threadRuntime.live('a', 'same').getState().dispatch({ type: 'summary', serverId: 'a', summary: null })
  vi.restoreAllMocks()
})
it('uses no legacy status before a session binding and no latest-entry unread substitute', () => {
  modalStore.setState({ outstanding: [{ conversationId: 'same' }] } as never)
  conversationActivityStore.getState().setTurnRunning('same', true)
  expect(conversationStatusNow({ ...row(), last_shown_version: undefined })).toBe('idle')
  expect(conversationStatusNow({ ...row(), serverId: undefined })).toBe('idle')
  expect(conversationStatusNow(row())).toBe('new-messages')
  reading('turnState')
  expect(conversationStatusNow(row())).toBe('working')
  reading('questionShown')
  expect(conversationStatusNow(row())).toBe('input-required')
  expect(conversationStatusNow(row('b'))).toBe('new-messages')
})
it('counts colliding owning-host rows independently and preserves badge exclusions', () => {
  conversationListStore.getState().setConversations([row(), { ...row('a', 'archived'), is_archived: true },
    { ...row('a', 'muted'), is_muted: true }], 'a')
  conversationListStore.getState().setConversations([row('b')], 'b')
  expect(attentionCountNow()).toBe(2)
  conversationListStore.getState().advanceReadMark('a', 'same', 10)
  expect(attentionCountNow()).toBe(1)
  reading('questionShown')
  expect(attentionCountNow()).toBe(2)
})
it('wakes on owning list and admitted live revisions and detaches both subscriptions', () => {
  const listener = vi.fn(), off = subscribeToAttentionStores(listener)
  conversationListStore.setState({ conversations: [] })
  threadRuntime.state.setState(s => ({ liveRevision: s.liveRevision + 1 }))
  expect(listener).toHaveBeenCalledTimes(2)
  off()
  conversationListStore.setState({ conversations: null })
  threadRuntime.state.setState(s => ({ liveRevision: s.liveRevision + 1 }))
  expect(listener).toHaveBeenCalledTimes(2)
})
