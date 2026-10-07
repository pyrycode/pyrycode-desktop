import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DaemonEvent } from '@shared/ipc/events'

type SessionSuggestion = { revision: number; text: string | null }
type ConversationSuggestion = {
  // Reconciled clears identify their producer, not necessarily the current session.
  sessionId: string | null
  sessions: ReadonlyMap<string, SessionSuggestion>
}
interface ReplySuggestionState {
  hosts: ReadonlyMap<string | null, ReadonlyMap<string, ConversationSuggestion>>
  receive: (event: DaemonEvent) => void
  // A suggestion sent with Tab is spent; only a newer revision shows one again.
  spend: (host: string, chat: string) => void
}

export function createReplySuggestionStore() {
  return createStore<ReplySuggestionState>((set) => ({
    hosts: new Map(),
    receive: event => set(state => {
      const host = 'serverId' in event && typeof event.serverId === 'string' ? event.serverId : null
      const hosts = new Map(state.hosts)
      if (event.type === 'connected') {
        hosts.delete(host)
        return { hosts }
      }
      if (event.type !== 'replySuggestion' && event.type !== 'sessionTransition' &&
          event.type !== 'turnState') return state
      const conversations = new Map(hosts.get(host))
      const held = conversations.get(event.conversationId)
      if (event.type === 'replySuggestion') {
        if (held?.sessionId != null && held.sessionId !== event.sessionId) return state
        const sessions = new Map(held?.sessions)
        if (event.revision <= (sessions.get(event.sessionId)?.revision ?? 0)) return state
        sessions.set(event.sessionId, { revision: event.revision, text: event.suggestedReply })
        conversations.set(event.conversationId, {
          sessionId: held?.sessionId ?? (event.suggestedReply === null ? null : event.sessionId),
          sessions
        })
      } else {
        if (event.type === 'turnState' && (event.state === 'idle' || held === undefined)) return state
        const sessions = new Map(held?.sessions)
        for (const [id, suggestion] of sessions) sessions.set(id, { ...suggestion, text: null })
        conversations.set(event.conversationId, {
          sessionId: event.type === 'sessionTransition' ? event.newSessionId : held?.sessionId ?? null,
          sessions
        })
      }
      hosts.set(host, conversations)
      return { hosts }
    }),
    spend: (host, chat) => set(state => {
      const held = state.hosts.get(host)?.get(chat)
      const current = held?.sessionId == null ? undefined : held.sessions.get(held.sessionId)
      if (held?.sessionId == null || current === undefined) return state
      const sessions = new Map(held.sessions)
      sessions.set(held.sessionId, { ...current, text: null })
      const conversations = new Map(state.hosts.get(host))
      conversations.set(chat, { ...held, sessions })
      return { hosts: new Map(state.hosts).set(host, conversations) }
    })
  }))
}

export const replySuggestionStore = createReplySuggestionStore()
export function useReplySuggestionStore<T>(selector: (state: ReplySuggestionState) => T): T {
  return useStore(replySuggestionStore, selector)
}
export function selectReplySuggestion(state: ReplySuggestionState, host: string | null, chat: string | null): string | null {
  if (host === null || chat === null) return null
  const held = state.hosts.get(host)?.get(chat)
  return held?.sessionId == null ? null : held.sessions.get(held.sessionId)?.text ?? null
}

// The suggestion shows only over an empty draft, so typing hides it and clearing restores it.
export function visibleReplySuggestion(draft: string, suggestion: string | null): string | null {
  return draft === '' ? suggestion : null
}
