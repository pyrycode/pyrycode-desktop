import { describe, expect, it } from 'vitest'
import { isConversationUnread } from './conversationUnread'

describe('daemon unread authority', () => {
  it('supplies no unread evidence without received shown and read watermarks', () => {
    for (const row of [undefined, {}, { latest_entry_id: 99, read_up_to: 0 }, { last_shown_version: 10 }]) {
      expect(isConversationUnread(row)).toBe(false)
    }
  })
  it('retains zero and compares shown versions, never latest-entry ids', () => {
    for (const [shown, read, unread] of [[0, 0, false], [10, 10, false], [10, 9, true]] as const) {
      expect(isConversationUnread({ serverId: 'host', last_shown_version: shown, read_up_to: read })).toBe(unread)
    }
  })
})
