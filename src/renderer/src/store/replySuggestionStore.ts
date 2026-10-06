import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DaemonEvent } from '@shared/ipc/events'

type SessionSuggestion = { revision: number; text: string | null }
type ConversationSuggestion = {
  sessionId: string
  sessions: ReadonlyMap<string, SessionSuggestion>
}
interface ReplySuggestionState {
  hosts: ReadonlyMap<string | null, ReadonlyMap<string, ConversationSuggestion>>
  receive: (event: DaemonEvent) => void
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
        if (held !== undefined && held.sessionId !== event.sessionId) return state
        const sessions = new Map(held?.sessions)
        if (event.revision <= (sessions.get(event.sessionId)?.revision ?? 0)) return state
        sessions.set(event.sessionId, { revision: event.revision, text: event.suggestedReply })
        conversations.set(event.conversationId, { sessionId: event.sessionId, sessions })
      } else {
        if (event.type === 'turnState' && (event.state === 'idle' || held === undefined)) return state
        const sessions = new Map(held?.sessions)
        for (const [id, suggestion] of sessions) sessions.set(id, { ...suggestion, text: null })
        conversations.set(event.conversationId, {
          sessionId: event.type === 'sessionTransition' ? event.newSessionId : held?.sessionId ?? '',
          sessions
        })
      }
      hosts.set(host, conversations)
      return { hosts }
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
  return held?.sessions.get(held.sessionId)?.text ?? null
}
