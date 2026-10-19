import { useEffect } from 'react'
import { onCurrentSessionEvent } from './threadRuntime'
import { replySuggestionStore } from './replySuggestionStore'

/** One ordered listener retains off-screen state and clears each host before reconciliation. */
export function ReplySuggestionData(): null {
  useEffect(() => onCurrentSessionEvent(replySuggestionStore.getState().receive), [])
  return null
}
