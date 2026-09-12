import { afterEach, expect, it } from 'vitest'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { canRespondToPromptNow } from './promptResponseAvailability'

const initialRows = conversationListStore.getState()
const initialSession = sessionStore.getState()
const row = { id: 'prompt-chat', name: null, is_promoted: false, is_archived: false,
  cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null }
const connected: ConnectionStatus = { type: 'connected', ack: {
  protocol_version: '1', server_id: 'daemon', conn_id: 'connection', capabilities: []
} }

afterEach(() => {
  conversationListStore.setState(initialRows, true)
  sessionStore.setState(initialSession, true)
})

it('rereads current ownership and status, never borrowing another connected host', () => {
  sessionStore.setState({ status: connected, statuses: new Map([['other', connected]]) })
  expect(canRespondToPromptNow(row.id)).toBe(false)
  expect(canRespondToPromptNow(null)).toBe(false)
  conversationListStore.getState().setConversations([row], 'owner')
  expect(canRespondToPromptNow(row.id)).toBe(false)
  const statuses: ConnectionStatus[] = [{ type: 'connecting' }, { type: 'disconnected' },
    { type: 'error', error: { code: 'transport', message: 'Offline', retryable: true } }, connected]
  for (const status of statuses) {
    sessionStore.setState({ statuses: new Map([['owner', status], ['other', connected]]) })
    expect(canRespondToPromptNow(row.id)).toBe(status.type === 'connected')
  }
  conversationListStore.getState().setConversations([row], 'other')
  expect(canRespondToPromptNow(row.id)).toBe(false)
  conversationListStore.getState().setConversations([], 'owner')
  expect(canRespondToPromptNow(row.id)).toBe(true)
  conversationListStore.getState().setConversations([], 'other')
  conversationListStore.getState().setConversations([row], undefined)
  expect(canRespondToPromptNow(row.id)).toBe(false)
})
