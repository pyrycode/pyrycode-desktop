import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { DaemonEvent } from '@shared/ipc/events'

type Snapshot = Extract<DaemonEvent, { type: 'sessionFacts' }>
type Facts = Pick<Snapshot, 'claudeCodeVersion' | 'permissionMode' | 'truncatedFields'>
type State = {
  facts: ReadonlyMap<string, Facts>
  setSessionFacts: (snapshot: Omit<Snapshot, 'type'>) => void
  clearSessionFacts: () => void
}

// Map keys are daemon routing ids; report values remain untrusted display-only text.
export function createSessionFactsStore() {
  return createStore<State>((set) => ({
    facts: new Map(),
    setSessionFacts: (snapshot) => set((state) => {
      const facts = new Map(state.facts)
      facts.set(snapshot.conversationId, {
        claudeCodeVersion: snapshot.claudeCodeVersion,
        permissionMode: snapshot.permissionMode,
        truncatedFields: snapshot.truncatedFields === null ? null : [...snapshot.truncatedFields]
      })
      return { facts }
    }),
    clearSessionFacts: () => set({ facts: new Map() })
  }))
}

export const sessionFactsStore = createSessionFactsStore()
export const selectSessionFactsFor = (conversationId: string | null) => (state: State): Facts | null =>
  conversationId === null ? null : state.facts.get(conversationId) ?? null

export function useSessionFactsStore<T>(selector: (state: State) => T): T {
  return useStore(sessionFactsStore, selector)
}
