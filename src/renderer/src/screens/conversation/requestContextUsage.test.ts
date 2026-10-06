import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestContextUsage, subscribeResetContextUsage } from './requestContextUsage'
import { createConversationActivityStore } from '../../store/conversationActivityStore'

afterEach(() => vi.useRealTimers())

describe('requestContextUsage', () => {
  it.each([null, ''])('does not send without an addressable id (%s)', (id) => {
    const send = vi.fn()
    requestContextUsage(send, id)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends once per explicit ask, including the same id, without scheduling retries', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    requestContextUsage(send, 'chat-a')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      type: 'requestContextUsage', payload: { conversation_id: 'chat-a' }
    })
    vi.advanceTimersByTime(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    requestContextUsage(send, 'chat-a')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({
      type: 'requestContextUsage', payload: { conversation_id: 'chat-a' }
    })
  })
})

describe('subscribeResetContextUsage', () => {
  it('asks once on completion, ignoring repeated phases, inactive states and unrelated activity', () => {
    const activities = createConversationActivityStore()
    const send = vi.fn()
    const off = subscribeResetContextUsage(activities, send)
    const state = activities.getState()
    state.setResetting('chat-a', false)
    state.setResetting('chat-a', true)
    state.setResetting('chat-a', true)
    state.setTurnRunning('chat-a', true)
    state.setTurnRunning('chat-a', false)
    expect(send).not.toHaveBeenCalled()
    state.setResetting('chat-a', false)
    state.setResetting('chat-a', false)
    state.setStalled('chat-a', true)
    expect(send.mock.calls).toEqual([[{
      type: 'requestContextUsage', payload: { conversation_id: 'chat-a' }
    }]])
    off()
  })

  it('routes independent completions to their own conversations, including a second reset', () => {
    const activities = createConversationActivityStore()
    const send = vi.fn()
    const off = subscribeResetContextUsage(activities, send)
    const state = activities.getState()
    state.setResetting('chat-a', true)
    state.setResetting('chat-b', true)
    state.setResetting('chat-b', false)
    state.setResetting('chat-a', false)
    state.setResetting('chat-a', true)
    state.setResetting('chat-a', false)
    expect(send.mock.calls.map(([command]) => command.payload.conversation_id)).toEqual([
      'chat-b', 'chat-a', 'chat-a'
    ])
    off()
  })

  it('ignores eviction and reconnect clears and stops observing on cleanup', () => {
    const activities = createConversationActivityStore()
    const state = activities.getState()
    state.setResetting('chat-a', true)
    const send = vi.fn()
    const off = subscribeResetContextUsage(activities, send)
    expect(send).not.toHaveBeenCalled()
    state.dropConversation('chat-a')
    state.setResetting('chat-b', true)
    state.resetActivityFor(new Set(['chat-b']))
    state.setResetting('chat-b', true)
    state.clearAllActivity()
    state.setResetting('chat-c', true)
    off()
    state.setResetting('chat-c', false)
    expect(send).not.toHaveBeenCalled()
  })
})
