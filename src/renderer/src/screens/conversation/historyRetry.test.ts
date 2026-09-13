import { describe, expect, it, vi } from 'vitest'
import { createConversationTimelineStore } from '../../store/conversationTimelineStore'
import { requestOlderHistory } from '../../store/historyPageBridge'
import { retryHistoryPage, selectHistoryFailure } from './historyRetry'

function harness(retryable = true) {
  const store = createConversationTimelineStore(undefined, () => 'host')
  const open = { id: 'chat' }
  let current: { id: string } | null = open
  let host: string | null = 'host'
  store.getState().markViewed(open.id)
  store.getState().markHistoryRequested(open.id, 'host')
  store.getState().prependHistoryFor(open.id, [{ kind: 'userText', text: 'retained' }])
  store.getState().recordHistoryPage(open.id, 'opaque/oldest==', false)
  store.getState().recordHistoryFailure(open.id, 'history-unavailable', retryable)
  const getHeld = (id: string) => store.getState().timelines.get(id) ?? null
  const failure = selectHistoryFailure(getHeld(open.id), 'host')!
  const deps = {
    getOpen: () => current,
    getConnectedHost: () => host,
    getHeld,
    markRequested: (id: string) => store.getState().markHistoryRequested(id, 'host'),
    sendCommand: vi.fn(),
    logRequested: vi.fn()
  }
  return { store, open, failure, deps, getHeld,
    navigate: (next: typeof current) => { current = next },
    connect: (next: typeof host) => { host = next },
    retry: () => retryHistoryPage(deps, open, 'host', failure) }
}

describe('history Retry', () => {
  it('reissues the same page once, preserving rows and coverage through pending and settlement', () => {
    const h = harness()
    const before = h.getHeld('chat')!
    h.retry()
    h.retry()
    requestOlderHistory(h.deps, 'chat', true)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    expect(h.deps.sendCommand).toHaveBeenCalledWith({ type: 'requestHistory',
      payload: { conversation_id: 'chat', cursor: 'opaque/oldest==', limit: 0 } })
    expect(h.deps.logRequested).toHaveBeenCalledTimes(1)
    expect(h.getHeld('chat')?.timeline).toBe(before.timeline)
    expect(h.getHeld('chat')?.coverage).toBe(before.coverage)
    expect(selectHistoryFailure(h.getHeld('chat'), 'host')).toBeNull()
    h.store.getState().recordHistoryFailure('chat', 'history-invalid-cursor', false)
    expect(selectHistoryFailure(h.getHeld('chat'), 'host')?.retryable).toBe(false)
    h.retry()
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(1)
    // Fresh upward demand remains available after either failure classification.
    requestOlderHistory(h.deps, 'chat', true)
    h.store.getState().recordHistoryPage('chat', 'next', true)
    expect(selectHistoryFailure(h.getHeld('chat'), 'host')).toBeNull()
    expect(h.getHeld('chat')?.timeline).toBe(before.timeline)
    expect(h.deps.sendCommand).toHaveBeenCalledTimes(2)
  })

  it('shows nonretryable failure but does not activate Retry', () => {
    const h = harness(false)
    expect(h.failure.retryable).toBe(false)
    h.retry()
    expect(h.deps.sendCommand).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'same-id-navigation', 'closed', 'disconnect', 'other-host', 'new-failure', 'success'])
    ('rejects a stale action after %s', change => {
      const h = harness()
      if (change === 'navigation') h.navigate({ id: 'other' })
      if (change === 'same-id-navigation') h.navigate({ id: 'chat' })
      if (change === 'closed') h.navigate(null)
      if (change === 'disconnect') h.connect(null)
      if (change === 'other-host') h.connect('other')
      if (change === 'new-failure') h.store.getState().recordHistoryFailure('chat', 'unclassified', true)
      if (change === 'success') h.store.getState().recordHistoryPage('chat', 'next', false)
      h.retry()
      expect(h.deps.sendCommand).not.toHaveBeenCalled()
      expect(h.deps.logRequested).not.toHaveBeenCalled()
    })

  it('requires exact host ownership and the displayed conversation slice', () => {
    const h = harness()
    expect(selectHistoryFailure(h.getHeld('chat'), 'host')).toBe(h.failure)
    expect(selectHistoryFailure(h.getHeld('chat'), 'other')).toBeNull()
    expect(selectHistoryFailure(h.getHeld('other'), 'host')).toBeNull()
    expect(selectHistoryFailure(h.getHeld('chat'), null)).toBeNull()
    expect(selectHistoryFailure({ ...h.getHeld('chat')!, serverId: undefined }, 'host')).toBeNull()
  })
})
