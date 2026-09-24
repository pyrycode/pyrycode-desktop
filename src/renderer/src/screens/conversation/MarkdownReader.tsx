import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { WorkspaceFileReadEvent } from '@shared/ipc/workspaceFileRead'
import { AssistantMarkdown } from './AssistantMarkdown'

// #1627: the in-app markdown reader (Figma 552:2404). A markdown link in an assistant reply asks the
// host for that workspace file through #1626's bridge, and the reader replaces the whole chat pane —
// composer included — until the back arrow closes it. Each open fetches again and nothing is cached
// (operator ruling, 2026-09-24).
//
// The state is screen-local by design: ConversationScreen is keyed per conversation in PairedShell, so a
// conversation switch remounts it and drops the reader, the notice and the listener together.

/** What the pane shows. `notice` is the one static failure line in the thread, set only by a failed
 *  fetch and cleared by the next open. The path is held for the title and never logged. */
export type MarkdownReaderState =
  | { type: 'closed'; notice: boolean }
  | { type: 'loading'; requestKey: string; path: string }
  | { type: 'loaded'; requestKey: string; path: string; text: string }

export type MarkdownReaderEvent =
  | { type: 'open'; requestKey: string; path: string }
  | { type: 'back' }
  | { type: 'outcome'; event: WorkspaceFileReadEvent }

/**
 * Pure. THE REQUEST KEY IS HOW A STALE ANSWER IS RECOGNISED: an outcome applies only while the reader is
 * loading that exact key. An answer after back, after a second link superseded the first, or a second
 * answer to a shown file returns the state unchanged.
 */
export function markdownReaderReducer(
  state: MarkdownReaderState,
  event: MarkdownReaderEvent
): MarkdownReaderState {
  switch (event.type) {
    case 'open':
      return { type: 'loading', requestKey: event.requestKey, path: event.path }
    case 'back':
      return CLOSED
    case 'outcome': {
      const outcome = event.event
      if (state.type !== 'loading' || outcome.requestKey !== state.requestKey) return state
      return outcome.type === 'loaded'
        ? { type: 'loaded', requestKey: state.requestKey, path: state.path, text: outcome.text }
        : { type: 'closed', notice: true }
    }
  }
}

const CLOSED: MarkdownReaderState = { type: 'closed', notice: false }

/** A filesystem path component's cap. The title is daemon-derived text, so it is bounded as well as
 *  escaped; `.markdown-reader__title`'s ellipsis is the geometric second layer. */
const MAX_TITLE_CHARS = 255

/** The path's last component, for the top bar. */
export function markdownFileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).slice(0, MAX_TITLE_CHARS)
}

/** The static, client-owned line the thread shows when a file could not be opened. Never the path and
 *  never the reason. */
export const MARKDOWN_OPEN_FAILED_NOTICE = 'Could not open the file.'

const LOG_EVENT = 'markdown-reader'

/**
 * The reader's state plus its two actions, bound to the open conversation. Subscribes to the outcome
 * channel for the life of the screen and removes the listener on unmount. Content-free diagnostics only:
 * `open`, and `stale` for an answer no current ask is waiting for. The main process already logs how
 * each fetch ended.
 */
export function useMarkdownReader(conversationId: string | null): {
  state: MarkdownReaderState
  open: (path: string) => void
  back: () => void
} {
  const [state, dispatch] = useReducer(markdownReaderReducer, CLOSED)
  // Diagnostics only: the reducer is the authority on which answer applies.
  const pendingKey = useRef<string | null>(null)

  useEffect(
    () =>
      window.pyry.onWorkspaceFileReadEvent((event) => {
        if (event.requestKey === pendingKey.current) pendingKey.current = null
        else window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'stale' })
        dispatch({ type: 'outcome', event })
      }),
    []
  )

  const open = useCallback(
    (path: string): void => {
      if (conversationId === null) return
      const requestKey = crypto.randomUUID()
      pendingKey.current = requestKey
      dispatch({ type: 'open', requestKey, path })
      window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'open' })
      window.pyry.readWorkspaceFile({ requestKey, conversationId, path })
    },
    [conversationId]
  )

  const back = useCallback((): void => {
    pendingKey.current = null
    dispatch({ type: 'back' })
  }, [])

  return { state, open, back }
}

/**
 * The reader, a pure function of its state. The top bar is drawn in both states, so it is on screen
 * while the first fetch is in flight — #1623's menu needs that home. The body is the only scroll box, so
 * the text scrolls beneath the fixed bar. The note renders through AssistantMarkdown under the reply
 * rules, and with NO `onOpenMarkdownPath`: following links inside a note is a later ticket.
 */
export function MarkdownReaderView({ state, onBack }: {
  state: Exclude<MarkdownReaderState, { type: 'closed' }>
  onBack: () => void
}): JSX.Element {
  return (
    <div className="markdown-reader">
      <div className="markdown-reader__bar">
        <div className="markdown-reader__bar-content">
          <button type="button" className="markdown-reader__back" aria-label="Back" onClick={onBack}>
            {/* Figma 552:2865, the arrow drawn as two round-capped strokes in on-surface. */}
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5" />
              <path d="M12 19L5 12L12 5" />
            </svg>
          </button>
          <p className="markdown-reader__title">{markdownFileName(state.path)}</p>
        </div>
        <div className="markdown-reader__rule" />
      </div>
      {state.type === 'loaded' ? (
        <div className="markdown-reader__body">
          <div className="bubble__markdown">
            <AssistantMarkdown text={state.text} />
          </div>
        </div>
      ) : (
        <div className="markdown-reader__body" aria-busy="true" />
      )}
    </div>
  )
}
