import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { WorkspaceFileReadEvent } from '@shared/ipc/workspaceFileRead'
import { AssistantMarkdown, remarkGfmSubset } from './AssistantMarkdown'
import { ComposerOptionsMenu, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import { copyMessageText, copyRichText } from './copyMessageText'

// #1627: the in-app markdown reader (Figma 552:2404). A markdown link in an assistant reply asks the
// host for that workspace file through #1626's bridge, and the reader replaces the whole chat pane —
// composer included — until the back arrow closes it. Each open fetches again and nothing is cached
// (operator ruling, 2026-09-24).
//
// The state is screen-local by design: ConversationScreen is keyed per conversation in PairedShell, so a
// conversation switch remounts it and drops the reader, the notice and the listener together.

/** What the pane shows. `notice` is the one static failure line in the thread, set only by a failed
 *  fetch and cleared by the next open. The path is held for the title and never logged.
 *
 *  #1630: a loaded reader keeps its text while a Refresh is in flight. `requestKey` is the fetch whose
 *  text is shown, `refreshKey` the one pending, and `notice` here is the same static line drawn INSIDE
 *  the reader, set by a failed refresh and cleared by the next successful one. */
export type MarkdownReaderState =
  | { type: 'closed'; notice: boolean }
  | { type: 'loading'; requestKey: string; path: string }
  | {
      type: 'loaded'
      requestKey: string
      path: string
      text: string
      refreshKey: string | null
      notice: boolean
    }

export type MarkdownReaderEvent =
  | { type: 'open'; requestKey: string; path: string }
  | { type: 'back' }
  | { type: 'refresh'; requestKey: string }
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
    case 'refresh':
      // A refresh before the first answer supersedes that fetch; after it, the text stays on screen.
      if (state.type === 'closed') return state
      if (state.type === 'loading') return { ...state, requestKey: event.requestKey }
      return { ...state, refreshKey: event.requestKey }
    case 'outcome': {
      const outcome = event.event
      if (state.type === 'loaded') {
        // Only the one pending refresh applies; an older refresh or the shown key answering again does not.
        if (state.refreshKey === null || outcome.requestKey !== state.refreshKey) return state
        return outcome.type === 'loaded'
          ? { ...state, requestKey: outcome.requestKey, text: outcome.text, refreshKey: null, notice: false }
          : { ...state, refreshKey: null, notice: true }
      }
      if (state.type !== 'loading' || outcome.requestKey !== state.requestKey) return state
      return outcome.type === 'loaded'
        ? {
            type: 'loaded',
            requestKey: state.requestKey,
            path: state.path,
            text: outcome.text,
            refreshKey: null,
            notice: false
          }
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

/** #1631: the static, client-owned line drawn inside the reader when the note could not be handed to
 *  another app. Never the name, the path or the reason. */
export const MARKDOWN_OPEN_IN_APP_FAILED_NOTICE = 'Could not open the note in another app.'

/** #1632: the static, client-owned line drawn inside the reader when the note could not be saved to
 *  Downloads. Never the name, the path or the reason. */
export const MARKDOWN_SAVE_FAILED_NOTICE = 'Could not save the note.'

/** #1630: the static, client-owned line a successful copy shows for `COPY_CONFIRMATION_MS`. */
export const MARKDOWN_COPIED_NOTICE = 'Copied to the clipboard.'

const COPY_CONFIRMATION_MS = 2000

const LOG_EVENT = 'markdown-reader'

/** #1630: the three copy flavours the reader's menu offers. */
export type MarkdownCopyKind = 'markdown' | 'plain' | 'html'

/**
 * The parser for Copy as plain text: remark with exactly AssistantMarkdown's one plugin, so the walk
 * below sees the tree the view renders (tables, task items and strikethrough included, autolinks not).
 */
const plainTextParser = unified().use(remarkParse).use(remarkGfmSubset)

function isNode(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function childrenOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : []
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A phrasing node's visible text: markers dropped, a link as its label, an image as its alt. Raw HTML
 *  is its literal source, because the view shows it escaped as visible characters. */
function inlineText(node: unknown): string {
  if (!isNode(node)) return ''
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'html':
      return stringField(node.value)
    case 'break':
      return '\n'
    case 'image':
    case 'imageReference':
      return stringField(node.alt)
    default:
      return childrenOf(node).map(inlineText).join('')
  }
}

function blocksText(nodes: unknown[], separator: string): string {
  return nodes
    .map(blockText)
    .filter((text) => text !== '')
    .join(separator)
}

/** A flow node's text. Blocks are separated by a blank line, list items and table rows by a newline,
 *  table cells by a tab. Walked from `unknown` so no mdast type (a transitive package) is imported. */
function blockText(node: unknown): string {
  if (!isNode(node)) return ''
  switch (node.type) {
    case 'code':
    case 'html':
      return stringField(node.value)
    case 'thematicBreak':
    case 'definition':
      return ''
    case 'root':
    case 'blockquote':
      return blocksText(childrenOf(node), '\n\n')
    case 'list':
    case 'listItem':
    case 'table':
      return blocksText(childrenOf(node), '\n')
    case 'tableRow':
      return childrenOf(node).map(inlineText).join('\t')
    default:
      return inlineText(node)
  }
}

/** #1630 — the note's rendered text without markdown syntax, for Copy as plain text. Pure. */
export function markdownPlainText(text: string): string {
  return blockText(plainTextParser.parse(text))
}

/**
 * #1630 — the note as HTML, for Copy as HTML. It IS the rendered view's pipeline, server-rendered: raw
 * HTML in the note arrives as escaped text, links follow the http/https allowlist and images are their
 * alt text, all by AssistantMarkdown's own rules rather than a second sanitizer. Like the reader, it
 * passes no `onOpenMarkdownPath`. The code-block chrome (a client-owned Copy code button) comes along,
 * because stripping it would need a second component table in that security-boundary file.
 */
export function markdownHtml(text: string): string {
  return renderToStaticMarkup(<AssistantMarkdown text={text} />)
}

type MarkdownReaderMenuAction =
  | { type: 'copy'; kind: MarkdownCopyKind }
  | { type: 'refresh' }
  | { type: 'open-in-app' }
  | { type: 'save' }

/**
 * #1630 — the menu rows, in the order the operator fixed on 2026-09-24 (#1631 and #1632 append Open in
 * another app and Save to device below Refresh). Every row but Refresh acts on the content shown now, so
 * each is unavailable until that content has loaded; Refresh is always available.
 */
export function markdownReaderMenuOptions(
  state: Exclude<MarkdownReaderState, { type: 'closed' }>
): ReadonlyArray<ComposerOptionsPanelOption & { unavailable: boolean; action: MarkdownReaderMenuAction }> {
  const noContent = state.type !== 'loaded'
  return [
    { id: 'copy-markdown', label: 'Copy as markdown', unavailable: noContent, action: { type: 'copy', kind: 'markdown' } },
    { id: 'copy-plain', label: 'Copy as plain text', unavailable: noContent, action: { type: 'copy', kind: 'plain' } },
    { id: 'copy-html', label: 'Copy as HTML', unavailable: noContent, action: { type: 'copy', kind: 'html' } },
    { id: 'refresh', label: 'Refresh', unavailable: false, action: { type: 'refresh' } },
    // #1631: hands the content shown now to another app, so it waits for that content too.
    { id: 'open-in-app', label: 'Open in another app', unavailable: noContent, action: { type: 'open-in-app' } },
    // #1632: saves the content shown now into Downloads, so it waits for that content too.
    { id: 'save', label: 'Save to device', unavailable: noContent, action: { type: 'save' } }
  ]
}

/** Puts `text` on the clipboard as the chosen flavour. Never throws; `false` when the write failed. */
function copyNote(kind: MarkdownCopyKind, text: string): Promise<boolean> {
  switch (kind) {
    case 'markdown':
      return copyMessageText(text)
    case 'plain':
      return copyMessageText(markdownPlainText(text))
    case 'html':
      return copyRichText({ html: markdownHtml(text), text: markdownPlainText(text) })
  }
}

/**
 * The reader's state plus its actions, bound to the open conversation. Subscribes to the outcome
 * channel for the life of the screen and removes the listener on unmount. Content-free diagnostics only:
 * `open`, `refresh`, `copied`, `copy-failed`, `open-in-app`, `open-in-app-failed`, `save`, `save-failed`,
 * and `stale` for an answer no current ask is waiting for.
 * The main process already logs how each fetch ended.
 */
export function useMarkdownReader(conversationId: string | null): {
  state: MarkdownReaderState
  copied: boolean
  openInAppFailed: boolean
  saveFailed: boolean
  open: (path: string) => void
  back: () => void
  refresh: () => void
  copy: (kind: MarkdownCopyKind) => void
  openInApp: () => void
  save: () => void
} {
  const [state, dispatch] = useReducer(markdownReaderReducer, CLOSED)
  // Diagnostics only: the reducer is the authority on which answer applies.
  const pendingKey = useRef<string | null>(null)
  // #1630: the copy confirmation, UI-local and transient. The timer is cleared on re-copy, on back and on
  // unmount; `alive` stops a copy that resolves after unmount from arming a new one.
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  // #1631: the open-in-another-app failure, UI-local like the copy confirmation. Cleared by the next
  // attempt and by back; a conversation switch remounts the screen and drops it.
  const [openInAppFailed, setOpenInAppFailed] = useState(false)
  // #1632: the save failure, with the same lifetime as the open-in-another-app one.
  const [saveFailed, setSaveFailed] = useState(false)
  const clearCopied = useCallback((): void => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    copiedTimer.current = null
    setCopied(false)
  }, [])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    }
  }, [])

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
    clearCopied()
    setOpenInAppFailed(false)
    setSaveFailed(false)
    dispatch({ type: 'back' })
  }, [clearCopied])

  // A fresh key per refresh, so the reducer ignores a late answer to any earlier fetch.
  const refresh = useCallback((): void => {
    if (conversationId === null || state.type === 'closed') return
    const requestKey = crypto.randomUUID()
    pendingKey.current = requestKey
    dispatch({ type: 'refresh', requestKey })
    window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'refresh' })
    window.pyry.readWorkspaceFile({ requestKey, conversationId, path: state.path })
  }, [conversationId, state])

  // Acts on the text shown at the moment of the choice; a refresh landing mid-write cannot mix contents.
  const copy = useCallback(
    (kind: MarkdownCopyKind): void => {
      if (state.type !== 'loaded') return
      void copyNote(kind, state.text).then((ok) => {
        window.pyry.sendDiagnostic({ event: LOG_EVENT, code: ok ? 'copied' : 'copy-failed' })
        if (!ok || !alive.current) return
        clearCopied()
        setCopied(true)
        copiedTimer.current = setTimeout(() => {
          copiedTimer.current = null
          setCopied(false)
        }, COPY_CONFIRMATION_MS)
      })
    },
    [state, clearCopied]
  )

  // #1631: hands the text shown at the moment of the choice, under the title's name, to the background
  // process. Only the text and the name cross; main picks the directory and sanitises the name.
  const openInApp = useCallback((): void => {
    if (state.type !== 'loaded') return
    setOpenInAppFailed(false)
    window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'open-in-app' })
    void window.pyry
      .openMarkdownInApp({ text: state.text, displayName: markdownFileName(state.path) })
      .then((outcome) => outcome.type === 'opened', () => false)
      .then((ok) => {
        if (ok) return
        window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'open-in-app-failed' })
        if (alive.current) setOpenInAppFailed(true)
      })
  }, [state])

  // #1632: the same request as openInApp; main writes it into Downloads, never over an existing file,
  // and reveals it. The reveal is the success feedback, so only a failure draws anything here.
  const save = useCallback((): void => {
    if (state.type !== 'loaded') return
    setSaveFailed(false)
    window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'save' })
    void window.pyry
      .saveMarkdownToDevice({ text: state.text, displayName: markdownFileName(state.path) })
      .then((outcome) => outcome.type === 'saved', () => false)
      .then((ok) => {
        if (ok) return
        window.pyry.sendDiagnostic({ event: LOG_EVENT, code: 'save-failed' })
        if (alive.current) setSaveFailed(true)
      })
  }, [state])

  return { state, copied, openInAppFailed, saveFailed, open, back, refresh, copy, openInApp, save }
}

/**
 * The reader, a pure function of its state. The top bar is drawn in both states, so it is on screen
 * while the first fetch is in flight — #1630's menu lives at its right end. The body is the only scroll
 * box, so the text scrolls beneath the fixed bar. The note renders through AssistantMarkdown under the
 * reply rules, and with NO `onOpenMarkdownPath`: following links inside a note is a later ticket.
 */
export function MarkdownReaderView({
  state,
  copied,
  openInAppFailed,
  saveFailed,
  onBack,
  onRefresh,
  onCopy,
  onOpenInApp,
  onSave
}: {
  state: Exclude<MarkdownReaderState, { type: 'closed' }>
  copied: boolean
  openInAppFailed: boolean
  saveFailed: boolean
  onBack: () => void
  onRefresh: () => void
  onCopy: (kind: MarkdownCopyKind) => void
  onOpenInApp: () => void
  onSave: () => void
}): JSX.Element {
  const options = markdownReaderMenuOptions(state)
  const choose = (id: string): void => {
    const action = options.find((option) => option.id === id)?.action
    if (action?.type === 'refresh') onRefresh()
    else if (action?.type === 'copy') onCopy(action.kind)
    else if (action?.type === 'open-in-app') onOpenInApp()
    else if (action?.type === 'save') onSave()
  }
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
          {/* Figma 557:2239 — the thread overflow's drawing and glyph, on the shared dropdown. */}
          <ComposerOptionsMenu
            options={options}
            currentId={null}
            onSelect={choose}
            ariaLabel="Note actions"
            triggerAriaLabel="Note actions"
            triggerClassName="conversation__overflow-trigger"
            placement="bottom-end"
            triggerContent={
              <svg
                className="conversation__overflow-icon"
                viewBox="0 0 6 24"
                width="6"
                height="24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3 6C1.34464 6 0 4.65536 0 3C0 1.34464 1.34464 0 3 0C4.65536 0 6 1.34464 6 3C6 4.65536 4.65536 6 3 6ZM3 18C4.65536 18 6 19.3446 6 21C6 22.6554 4.65536 24 3 24C1.34464 24 0 22.6554 0 21C0 19.3446 1.34464 18 3 18ZM6 12C6 13.6554 4.65536 15 3 15C1.34464 15 0 13.6554 0 12C0 10.3446 1.34464 9 3 9C4.65536 9 6 10.3446 6 12Z" />
              </svg>
            }
          />
        </div>
        <div className="markdown-reader__rule" />
      </div>
      {state.type === 'loaded' && state.notice && (
        <p className="conversation__banner markdown-reader__notice" role="status">{MARKDOWN_OPEN_FAILED_NOTICE}</p>
      )}
      {openInAppFailed && (
        <p className="conversation__banner markdown-reader__notice" role="status">{MARKDOWN_OPEN_IN_APP_FAILED_NOTICE}</p>
      )}
      {saveFailed && (
        <p className="conversation__banner markdown-reader__notice" role="status">{MARKDOWN_SAVE_FAILED_NOTICE}</p>
      )}
      {copied && <p className="markdown-reader__copied" role="status">{MARKDOWN_COPIED_NOTICE}</p>}
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
