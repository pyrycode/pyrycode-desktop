import { afterEach, expect, it } from 'vitest'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { connectedConversationHostNow } from './conversationActionAvailability'

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
  expect(connectedConversationHostNow(row.id)).toBe(null)
  expect(connectedConversationHostNow(null)).toBe(null)
  conversationListStore.getState().setConversations([row], 'owner')
  expect(connectedConversationHostNow(row.id)).toBe(null)
  const statuses: ConnectionStatus[] = [{ type: 'connecting' }, { type: 'disconnected' },
    { type: 'error', error: { code: 'transport', message: 'Offline', retryable: true } }, connected]
  for (const status of statuses) {
    sessionStore.setState({ statuses: new Map([['owner', status], ['other', connected]]) })
    expect(connectedConversationHostNow(row.id)).toBe(status.type === 'connected' ? 'owner' : null)
  }
  conversationListStore.getState().setConversations([row], 'other')
  expect(connectedConversationHostNow(row.id)).toBe(null)
  conversationListStore.getState().setConversations([], 'owner')
  expect(connectedConversationHostNow(row.id)).toBe('other')
  conversationListStore.getState().setConversations([], 'other')
  conversationListStore.getState().setConversations([row], undefined)
  expect(connectedConversationHostNow(row.id)).toBe(null)
})
