import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestContextUsage } from './requestContextUsage'

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
