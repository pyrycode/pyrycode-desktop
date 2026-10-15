import { describe, expect, it, vi } from 'vitest'
import { createConversationTimelineStore } from './conversationTimelineStore'
import { historyAskDeps, requestHistoryPage, requestOlderHistory } from './historyPageBridge'
import { activeConversationStore } from './activeConversationStore'
import { conversationListStore } from './conversationListStore'
import { conversationTimelineStore } from './conversationTimelineStore'
import { sessionStore, type ConnectionStatus } from './sessionStore'

function harness() {
  const store = createConversationTimelineStore()
  store.getState().markViewed('c')
  const sendCommand = vi.fn()
  const deps = {
    sendCommand,
    getHeld: () => store.getState().timelines.get('c') ?? null,
    markRequested: () => store.getState().markHistoryRequested('c')
  }
  return { store, deps, ask: (nearTop = true) => requestOlderHistory(deps, 'c', nearTop) }
}

describe('explicit history demand', () => {
  it('sends no legacy history for a selected conversation, since every host is a thread host (#1908)', () => {
    const active = activeConversationStore.getState(), lists = conversationListStore.getState()
    const sessions = sessionStore.getState(), timelines = conversationTimelineStore.getState()
    const send = vi.fn()
    vi.stubGlobal('window', { pyry: { sendCommand: send } })
    const row = { id: 'c', name: null, is_promoted: false, is_archived: false, cwd: '/',
      last_message_ts: '', last_used_at: '', workspace_label: null }
    const connected: ConnectionStatus = { type: 'connected', ack: {
      protocol_version: '2', server_id: 'server', conn_id: 'connection', capabilities: ['interactive', 'thread'] } }
    try {
      conversationListStore.getState().setConversations([row], 'b')
      sessionStore.setState({ statuses: new Map([['b', connected]]) })
      const owner = { ...row, serverId: 'b' }
      activeConversationStore.getState().setActiveConversation(owner)
      requestHistoryPage(historyAskDeps, 'c', 'b-cursor', 'newest')
      requestOlderHistory(historyAskDeps, 'c', true)
      expect(send).not.toHaveBeenCalled()
      expect(conversationTimelineStore.getState().timelines.get('c')?.history).toBeUndefined()
    } finally {
      activeConversationStore.setState(active, true); conversationListStore.setState(lists, true)
      sessionStore.setState(sessions, true); conversationTimelineStore.setState(timelines, true)
      vi.unstubAllGlobals()
    }
  })
  it('requests the unknown first page once and discards pending demand', () => {
    const h = harness()
    h.ask(false)
    expect(h.deps.sendCommand).not.toHaveBeenCalled()
    h.ask()
    h.ask()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    expect(h.deps.sendCommand).toHaveBeenCalledWith({
      type: 'requestHistory', payload: { conversation_id: 'c', cursor: '', limit: 200 }
    })
  })

  it('retains rows and successful coverage across a failed request, retrying only on demand', () => {
    const h = harness()
    h.store.getState().prependHistoryFor('c', [{ kind: 'userText', text: 'retained' }])
    h.store.getState().recordHistoryPage('c', 'oldest', false)
    const rows = h.store.getState().timelines.get('c')?.timeline
    h.ask()
    h.store.getState().recordHistoryFailure('c', 'unclassified', true)
    expect(h.store.getState().timelines.get('c')?.timeline).toBe(rows)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    h.ask()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
    expect(h.deps.sendCommand.mock.calls.map(([c]) => c.payload.cursor)).toEqual(['oldest', 'oldest'])
  })

  it.each([false, true])('restores coverage, waiting for local reads and stopping only atStart=%s', atStart => {
    const h = harness()
    const read = h.store.getState().beginLocalTimelineRead('host', 'c')!
    h.ask()
    expect(h.deps.sendCommand).not.toHaveBeenCalled()
    read.complete({ version: 1, kind: 'timeline', serverId: 'host', conversationId: 'c',
      items: [], prependedRows: 0, coverage: { status: 'received', cursor: 'saved', atStart } })
    expect(h.deps.sendCommand).not.toHaveBeenCalled()
    h.ask()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(atStart ? 0 : 1)
    if (!atStart) expect(h.deps.sendCommand.mock.calls[0][0].payload.cursor).toBe('saved')
  })

  it('does not read or mark unaddressable ids', () => {
    const deps = { sendCommand: vi.fn(), getHeld: vi.fn(), markRequested: vi.fn() }
    for (const id of [null, '']) requestOlderHistory(deps, id, true)
    expect(deps.getHeld).not.toHaveBeenCalled()
    expect(deps.markRequested).not.toHaveBeenCalled()
    expect(deps.sendCommand).not.toHaveBeenCalled()
  })

  it('a settled local failure permits only a new demand for unknown coverage', () => {
    const h = harness()
    const read = h.store.getState().beginLocalTimelineRead('host', 'c')!
    h.ask()
    read.fail()
    expect(h.deps.sendCommand).not.toHaveBeenCalled()
    h.ask()
    h.store.getState().recordHistoryFailure('c', 'unclassified', true)
    h.ask()
    expect(h.deps.sendCommand.mock.calls.map(([c]) => c.payload.cursor)).toEqual(['', ''])
  })

  it('does not apply another host failure or carry its cursor into a new host request', () => {
    let origin = 'a'
    const store = createConversationTimelineStore(undefined, () => origin)
    store.getState().dispatchFor('c', { type: 'userText', text: 'a' })
    store.getState().recordHistoryPage('c', 'a-cursor', false)
    store.getState().markHistoryRequested('c', 'b')
    const b = store.getState().timelines.get('c')
    expect(b?.coverage).toBeUndefined()
    expect(b?.timeline.items).toEqual([])
    store.getState().recordHistoryFailure('c', 'unclassified', true)
    expect(store.getState().timelines.get('c')).toBe(b)
    origin = 'b'
    store.getState().recordHistoryFailure('c', 'unclassified', true)
    expect(store.getState().timelines.get('c')?.history?.status).toBe('failed')
  })

  it('empty successful pages retain their cursor without starting another download', () => {
    const h = harness()
    h.ask()
    h.store.getState().recordHistoryPage('c', '', false)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    h.ask()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
    h.store.getState().recordHistoryPage('c', 'end', true)
    h.ask()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  })
})
