import { describe, it, expect, vi } from 'vitest'
import { sendQueuedNow } from './sendQueuedNow'

describe('sendQueuedNow (#1726)', () => {
  it('sends exactly one sendQueuedNow command naming the row and nothing else', () => {
    const sendCommand = vi.fn()

    sendQueuedNow('conv-1', 7, { sendCommand })

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'sendQueuedNow',
      payload: { conversation_id: 'conv-1', queued_msg_id: 7 }
    })
  })

  it('swallows a send-bridge failure without logging the ids', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendCommand = vi.fn(() => {
      throw new Error('bridge down')
    })

    expect(() => sendQueuedNow('conv-1', 7, { sendCommand })).not.toThrow()
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls[0]?.[0])).not.toContain('conv-1')
    error.mockRestore()
  })
})
