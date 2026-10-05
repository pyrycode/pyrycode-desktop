import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** Renderer-local preference, shared by every host and conversation on this client. */
export interface CollapseToolUsesPrefStorage {
  read(): boolean | null
  write(value: boolean): void
}

export type CollapseToolUsesPrefStore = {
  collapseToolUses: boolean
  setCollapseToolUses(value: boolean): void
}

export const COLLAPSE_TOOL_USES_KEY = 'pyry.collapseAssistantToolUses'

/** Only the two encodings we write are valid; missing/corrupt values retain the on default. */
export function decodeCollapseToolUsesPref(raw: string | null): boolean | null {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

export function localStorageCollapseToolUsesPref(): CollapseToolUsesPrefStorage {
  return {
    read: () => typeof window === 'undefined'
      ? null
      : decodeCollapseToolUsesPref(window.localStorage.getItem(COLLAPSE_TOOL_USES_KEY)),
    write: (value) => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(COLLAPSE_TOOL_USES_KEY, value ? 'true' : 'false')
    }
  }
}

/** The storage seam mirrors pushNotificationPrefStore; null and explicit false stay distinct. */
export function createCollapseToolUsesPrefStore(storage: CollapseToolUsesPrefStorage) {
  return createStore<CollapseToolUsesPrefStore>((set) => ({
    collapseToolUses: storage.read() ?? true,
    setCollapseToolUses: (collapseToolUses) => {
      storage.write(collapseToolUses)
      set({ collapseToolUses })
    }
  }))
}

export const collapseToolUsesPrefStore = createCollapseToolUsesPrefStore(localStorageCollapseToolUsesPref())

export function useCollapseToolUsesPrefStore<T>(selector: (state: CollapseToolUsesPrefStore) => T): T {
  return useStore(collapseToolUsesPrefStore, selector)
}

export const selectCollapseToolUses = (state: CollapseToolUsesPrefStore): boolean => state.collapseToolUses
