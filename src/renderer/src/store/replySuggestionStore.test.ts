import { describe, expect, it } from 'vitest'
import type { StampedDaemonEvent } from '@shared/ipc/events'
import { createReplySuggestionStore, selectReplySuggestion, visibleReplySuggestion } from './replySuggestionStore'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'

const suggestion = (revision = 1, suggestedReply: string | null = 'Continue', sessionId = 's', conversationId = 'c', serverId = 'h'): StampedDaemonEvent =>
  ({ type: 'replySuggestion', revision, suggestedReply, sessionId, conversationId, serverId })
const transition = (newSessionId: string, conversationId = 'c', serverId = 'h'): StampedDaemonEvent =>
  ({ type: 'sessionTransition', newSessionId, conversationId, serverId, reason: 'clear', occurredAt: '', workspaceCwd: null })
const connected = (serverId = 'h'): StampedDaemonEvent => ({ type: 'connected', ack: { protocol_version: 'v2', server_id: 'untrusted', conn_id: 'connection', capabilities: [] }, serverId })

describe('transient reply suggestions', () => {
  const setup = () => {
    const store = createReplySuggestionStore()
    return { store, emit: (event: StampedDaemonEvent) => store.getState().receive(event), read: (host = 'h', chat = 'c') => selectReplySuggestion(store.getState(), host, chat) }
  }
  it('replaces only strictly higher revisions; a null cannot be resurrected by duplicates', () => {
    const { emit, read } = setup()
    emit(suggestion(3)); emit(suggestion(2, 'Older')); emit(suggestion(3, 'Duplicate'))
    expect(read()).toBe('Continue')
    emit(suggestion(4, null)); emit(suggestion(3)); emit(suggestion(4))
    expect(read()).toBeNull()
    emit(suggestion(5, 'Newer')); expect(read()).toBe('Newer')
  })
  it('isolates identical conversation/session ids between hosts and holds unopened chats', () => {
    const { emit, read, store } = setup()
    emit(suggestion()); emit(suggestion(1, 'Other chat', 's', 'other')); emit(suggestion(1, 'Other host', 's', 'c', 'host2'))
    expect(read()).toBe('Continue'); expect(read('h', 'other')).toBe('Other chat'); expect(read('host2')).toBe('Other host')
    expect(selectReplySuggestion(store.getState(), null, 'c')).toBeNull()
    expect(read('h', 'missing')).toBeNull()
  })
  it('locks identity on transitions and retains per-session watermarks if identity returns', () => {
    const { emit, read } = setup()
    emit(transition('s')); emit(suggestion(1, 'Wrong session', 'old')); expect(read()).toBeNull()
    emit(suggestion(7)); emit(transition('new')); expect(read()).toBeNull()
    emit(suggestion(100, 'Stale')); expect(read()).toBeNull()
    emit(suggestion(1, 'Fresh', 'new')); expect(read()).toBe('Fresh')
    emit(transition('s')); emit(suggestion(7)); expect(read()).toBeNull()
    emit(suggestion(8)); expect(read()).toBe('Continue')
    emit(transition('')); emit(suggestion(100)); expect(read()).toBeNull()
  })
  it('clears on non-idle activity, preserving watermarks and other conversations', () => {
    const { emit, read } = setup()
    emit(suggestion(3)); emit(suggestion(1, 'Other', 's', 'other'))
    emit({ type: 'turnState', state: 'idle', conversationId: 'c', serverId: 'h' }); expect(read()).toBe('Continue')
    emit({ type: 'turnState', state: 'thinking', conversationId: 'c', serverId: 'h' }); expect(read()).toBeNull()
    emit(suggestion(3)); expect(read()).toBeNull(); expect(read('h', 'other')).toBe('Other')
    emit(suggestion(4)); expect(read()).toBe('Continue')
  })
  it('fresh handshake clears all of its host before accepting low revision reconciliation', () => {
    const { emit, read, store } = setup()
    emit(suggestion(20)); emit(suggestion(20, 'Hidden', 's', 'other')); emit(suggestion(20, 'Untouched', 's', 'c', 'host2'))
    emit(transition('new')); emit(connected()); expect(read()).toBeNull(); expect(read('h', 'other')).toBeNull()
    expect(read('host2')).toBe('Untouched')
    emit(suggestion(1)); expect(read()).toBe('Continue')
    expect(store.getState().hosts.has('untrusted')).toBe(false)
    expect(selectReplySuggestion(createReplySuggestionStore().getState(), 'h', 'c')).toBeNull()
  })
  it.each([false, true])('accepts a fresh session after old-session null reconciliation (activity: %s)', activity => {
    const { emit, read } = setup()
    emit(suggestion(10, 'Old session', 'old', 'offscreen'))
    // The off-screen conversation rotated while disconnected; no transition replays.
    emit(connected())
    emit(suggestion(11, null, 'old', 'offscreen'))
    expect(read('h', 'offscreen')).toBeNull()
    emit(suggestion(11, 'Duplicate', 'old', 'offscreen'))
    emit(suggestion(10, 'Older', 'old', 'offscreen'))
    expect(read('h', 'offscreen')).toBeNull()
    if (activity) {
      emit({ type: 'turnState', state: 'thinking', conversationId: 'offscreen', serverId: 'h' })
      emit({ type: 'turnState', state: 'idle', conversationId: 'offscreen', serverId: 'h' })
    }
    emit(suggestion(12, 'Current session', 'current', 'offscreen'))
    expect(read('h', 'offscreen')).toBe('Current session')
    emit(suggestion(99, 'Retired session', 'old', 'offscreen'))
    expect(read('h', 'offscreen')).toBe('Current session')
    emit(transition('old', 'offscreen'))
    emit(suggestion(11, 'Cleared revision', 'old', 'offscreen'))
    expect(read('h', 'offscreen')).toBeNull()
    emit(suggestion(12, 'New revision', 'old', 'offscreen'))
    expect(read('h', 'offscreen')).toBe('New revision')
  })
  it('is visible only over an empty draft and reappears when the draft empties again', () => {
    expect(visibleReplySuggestion('', 'Continue')).toBe('Continue')
    expect(visibleReplySuggestion('a', 'Continue')).toBeNull()
    expect(visibleReplySuggestion(' ', 'Continue')).toBeNull()
    expect(visibleReplySuggestion('', null)).toBeNull()
  })
  it('a sent suggestion is spent until a newer revision arrives, leaving other chats alone', () => {
    const { emit, read, store } = setup()
    emit(suggestion(3)); emit(suggestion(1, 'Other', 's', 'other'))
    store.getState().spend('h', 'c'); expect(read()).toBeNull(); expect(read('h', 'other')).toBe('Other')
    emit(suggestion(3)); expect(read()).toBeNull()
    emit(suggestion(4, 'Next')); expect(read()).toBe('Next')
    const before = store.getState().hosts
    store.getState().spend('h', 'missing'); store.getState().spend('nobody', 'c')
    expect(store.getState().hosts).toBe(before)
  })
  it('safely excludes suggestions from all exhaustive translators and exception messages', () => {
    const event = suggestion(1, 'private suggestion')
    expect(translateDaemonEvent(event)).toBeNull()
    expect(translateTimelineEvent(event)).toBeNull()
    expect(translateModalEvent(event, () => new Set())).toBeNull()
    expect(translateQuestionEvent(event)).toBeNull()
  })
})
