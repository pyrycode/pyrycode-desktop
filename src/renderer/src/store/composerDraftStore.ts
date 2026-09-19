import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

export interface ComposerDraftStore {
  drafts: ReadonlyMap<string, ReadonlyMap<string, string>>
  setDraft: (serverId: string, conversationId: string, text: string) => void
}

/** Renderer-session text only. Pane remounts must not own the lifetime of an unsent draft. */
export function createComposerDraftStore() {
  return createStore<ComposerDraftStore>((set) => ({
    drafts: new Map(),
    setDraft: (serverId, conversationId, text) => set((state) => {
      const drafts = new Map(state.drafts)
      const conversations = new Map(drafts.get(serverId))
      if (text === '') conversations.delete(conversationId)
      else conversations.set(conversationId, text)
      if (conversations.size === 0) drafts.delete(serverId)
      else drafts.set(serverId, conversations)
      return { drafts }
    })
  }))
}

export const composerDraftStore = createComposerDraftStore()

export function useComposerDraftStore<T>(selector: (state: ComposerDraftStore) => T): T {
  return useStore(composerDraftStore, selector)
}

export function selectDraft(
  state: ComposerDraftStore, serverId: string | null, conversationId: string | null
): string {
  return serverId === null || conversationId === null
    ? '' : state.drafts.get(serverId)?.get(conversationId) ?? ''
}
