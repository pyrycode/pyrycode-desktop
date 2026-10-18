import { describe, it, expect } from 'vitest'
import { buildSetConversationPinned } from './setConversationPinnedEnvelope'
import { decodeEnvelope } from './codec'

describe('buildSetConversationPinned', () => {
  it.each([true, false])('encodes exactly the pin contract for %s', pinned => {
    expect(decodeEnvelope(buildSetConversationPinned({ id: 7, ts: '2026-10-18T00:00:00Z',
      payload: { conversation_id: 'channel', pinned } }))).toEqual({
      id: 7, ts: '2026-10-18T00:00:00Z', type: 'set_conversation_pinned',
      payload: { conversation_id: 'channel', pinned }
    })
  })
})
