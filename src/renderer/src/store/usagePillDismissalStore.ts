// #1604: the usage pill the operator dismissed with its X, remembered for the app process. Renderer
// memory only — no persistence, no IPC — because the ticket asks for nothing longer: a reload may bring
// the pill back.
//
// A STORE rather than component state because `ConversationScreen` remounts per conversation (PairedShell
// keys it by pane) and leaves the tree off the thread route, so a `useState` would forget the dismissal
// on every navigation.
//
// ONE TRIPLE FOR THE WHOLE APP, not one per conversation: the reading describes the account's quota, so
// the same status, window and reset in another conversation is the same fact the operator already
// dismissed. Any change to one of the three makes it a new reading, which `isUsageReadingDismissed`
// compares field by field — the triple is held as data and never becomes a key.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { UsageLimitReading } from './usageLimitStore'

export type UsagePillDismissalStore = {
  dismissed: UsageLimitReading | null
  dismiss: (reading: UsageLimitReading) => void
}

export function createUsagePillDismissalStore() {
  return createStore<UsagePillDismissalStore>((set) => ({
    dismissed: null,
    // A fresh object of exactly the three fields, so nothing else the caller's record carries is held.
    dismiss: ({ status, limitType, resetsAt }) => set({ dismissed: { status, limitType, resetsAt } })
  }))
}

export const usagePillDismissalStore = createUsagePillDismissalStore()

export function useUsagePillDismissalStore<T>(selector: (s: UsagePillDismissalStore) => T): T {
  return useStore(usagePillDismissalStore, selector)
}
