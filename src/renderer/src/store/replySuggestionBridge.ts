import { useEffect } from 'react'
import { replySuggestionStore } from './replySuggestionStore'

/** One ordered listener retains off-screen state and clears each host before reconciliation. */
export function ReplySuggestionData(): null {
  useEffect(() => window.pyry.onDaemonEvent(replySuggestionStore.getState().receive), [])
  return null
}
