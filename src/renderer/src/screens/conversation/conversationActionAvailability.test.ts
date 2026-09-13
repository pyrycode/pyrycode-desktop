import { afterEach, expect, it, vi } from 'vitest'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { connectedConversationHostNow, initializeCreatedConversationAfterList } from './conversationActionAvailability'

const initialRows = conversationListStore.getState()
const initialSession = sessionStore.getState()
const initialActive = activeConversationStore.getState()
const cleanups: (() => void)[] = []
const row = { id: 'prompt-chat', name: null, is_promoted: false, is_archived: false,
  cwd: '/', last_message_ts: '', last_used_at: '', workspace_label: null }
const connected: ConnectionStatus = { type: 'connected', ack: {
  protocol_version: '1', server_id: 'daemon', conn_id: 'connection', capabilities: []
} }

afterEach(() => {
  cleanups.splice(0).forEach(off => off())
  activeConversationStore.setState(initialActive, true)
  conversationListStore.setState(initialRows, true)
  sessionStore.setState(initialSession, true)
})

function waitForCreated(serverId: string | undefined) {
  activeConversationStore.getState().setActiveConversation(row)
  const initialize = vi.fn()
  cleanups.push(initializeCreatedConversationAfterList(row.id, serverId, initialize))
  return initialize
}

it('initializes once after the creating host supplies unique ownership', () => {
  sessionStore.setState({ statuses: new Map([['owner', connected], ['other', connected]]) })
  const initialize = waitForCreated('owner')
  conversationListStore.getState().setConversations([], 'other')
  expect(initialize).not.toHaveBeenCalled()
  conversationListStore.getState().setConversations([row], 'owner')
  expect(initialize).toHaveBeenCalledWith(row.id)
  conversationListStore.getState().setConversations([row], 'owner')
  expect(initialize).toHaveBeenCalledTimes(1)
})

it.each(['missing', 'connecting', 'disconnected', 'error', 'ambiguous', 'switched', 'unmounted', 'wrong-owner', 'absent-row'])(
  'never replays initialization after %s ownership or cancellation', reason => {
    sessionStore.setState({ statuses: new Map([['owner', connected], ['other', connected]]) })
    const initialize = waitForCreated('owner')
    if (reason === 'missing') sessionStore.setState({ statuses: new Map([['other', connected]]) })
    if (reason === 'connecting' || reason === 'disconnected') {
      sessionStore.setState({ statuses: new Map<string, ConnectionStatus>([['owner', { type: reason }], ['other', connected]]) })
    }
    if (reason === 'error') sessionStore.setState({ statuses: new Map([['owner', {
      type: 'error', error: { code: 'transport', message: 'Offline', retryable: true }
    }]]) })
    if (reason === 'switched') activeConversationStore.getState().clearActiveConversation()
    if (reason === 'unmounted') cleanups[0]()
    if (reason === 'ambiguous' || reason === 'wrong-owner') {
      conversationListStore.getState().setConversations([row], 'other')
    }
    conversationListStore.getState().setConversations(reason === 'wrong-owner' || reason === 'absent-row' ? [] : [row], 'owner')
    expect(initialize).not.toHaveBeenCalled()
    sessionStore.setState({ statuses: new Map([['owner', connected]]) })
    conversationListStore.getState().setConversations([], 'other')
    conversationListStore.getState().setConversations([row], 'owner')
    expect(initialize).not.toHaveBeenCalled()
  }
)

it.each(['missing-origin', 'missing-status', 'existing-row'])('does not start a wait for %s', reason => {
  if (reason !== 'missing-status') sessionStore.setState({ statuses: new Map([['owner', connected]]) })
  if (reason === 'existing-row') conversationListStore.getState().setConversations([row], 'owner')
  const initialize = waitForCreated(reason === 'missing-origin' ? undefined : 'owner')
  sessionStore.setState({ statuses: new Map([['owner', connected]]) })
  conversationListStore.getState().setConversations([row], 'owner')
  expect(initialize).not.toHaveBeenCalled()
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
