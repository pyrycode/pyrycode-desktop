import { useEffect, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationCreatedPayload, RecentWorkspace } from '@shared/wire/types'
import { formatLastActivity } from '../channels/channelListViewModel'
import {
  useRecentWorkspacesStore,
  selectRecentWorkspaces
} from '../../store/recentWorkspacesStore'
import { RecentWorkspacesData } from '../../store/recentWorkspacesBridge'
import { CreateFolderDialog } from './CreateFolderDialog'

// #383: the Workspace Picker sheet — the UI slice of #157 (Figma node 20-2). A bottom sheet that lists
// the recent-workspaces store, marks the active conversation's current workspace, and dispatches the
// existing `change_workspace` command (#379) on selection. Everything it consumes — the store + data-path
// bridge (#382), the command (#379), the relative-time formatter (#141), and the .status-sheet__* chrome
// (#177/#365) — is already merged; this file adds one pure view + its thin container + a one-line dispatch
// helper. The daemon's `conversation_updated` reply reflects the change into the conversation LIST for
// free (the same re-list path rename/archive/promote use) — no optimistic update, no extra request.
//
// Three exports mirror the ChannelInfoSheetView + ChannelInfoSheet split: the pure view, the dispatch
// helper (both directly testable), and the in-file interaction container (untested reviewed glue).

// Client-owned copy — no daemon string reaches these. Every literal is apostrophe-free: renderToStaticMarkup
// escapes ' → &#x27; (the standing desktop lesson), so an apostrophe would break the server-render tests.
const WORKSPACE_PICKER_TITLE = 'Choose workspace'
const WORKSPACE_PICKER_RECENT_HEADER = 'Recent'
const WORKSPACE_PICKER_OTHER_HEADER = 'Other'
const WORKSPACE_PICKER_DEFAULT_PILL = 'default'
const WORKSPACE_PICKER_EMPTY_COPY = 'No recent workspaces'
// #398: the create-folder entry label. When an active conversation supplies a workspace, the entry names
// the parent it will create under (WORKSPACE_PICKER_CREATE_PREFIX + activeCwd); with no active conversation
// (the disabled state) it falls back to the generic label. Both apostrophe-free; U+2026 ellipsis, not three
// dots. `activeCwd` is an untrusted daemon string rendered as auto-escaped React children, never resolved
// as a path (the `row.path` posture).
const WORKSPACE_PICKER_CREATE_LABEL = 'Create new folder…'
const WORKSPACE_PICKER_CREATE_PREFIX = 'Create new folder under '
const WORKSPACE_PICKER_LAST_USED_PREFIX = 'Last used '

// Distinct from STATUS_SHEET_TITLE_ID / CHANNEL_INFO_SHEET_TITLE_ID so all three sheets can coexist
// without duplicate ids.
const WORKSPACE_PICKER_SHEET_TITLE_ID = 'workspace-picker-sheet-title'

// #383: fire the existing `changeWorkspace` command (#379 wired the main side through to the daemon). An
// inline literal typed as RendererCommand — no constructor added, the mirror of `requestArchiveConversation`
// / `requestDeleteConversation` (fire-and-forget: `sendCommand` returns void, no try/catch). The `cwd`
// parameter IS the chosen row's `path` — the container does the `path → cwd` map at the call site (the wire
// field is `cwd`, not `path`; #379). Exported so the dispatch stays directly unit-testable — the view renders
// server-side only, so a row click cannot be fired via a DOM event. The change reflects into the conversation
// LIST for free via the daemon's `conversation_updated` re-list (#379) — no optimistic update here.
export function requestChangeWorkspace(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  cwd: string
): void {
  sendCommand({ type: 'changeWorkspace', payload: { conversation_id: conversationId, cwd } })
}

// A decorative 24px Material `folder` glyph — inline SVG, aria-hidden (the ChannelList row-glyph idiom;
// the Figma's localhost asset is not fetched, an inline M3 path carries the same shape).
function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

// The `create_new_folder` Material glyph (folder + plus) for the "Other" entry — decorative, aria-hidden.
function FolderPlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z" />
    </svg>
  )
}

// #383: the pure Workspace Picker view — props-in / markup-out, server-renderable, no store / no effects /
// no window.pyry (the ChannelInfoSheetView posture). It reuses the .status-sheet__* chrome verbatim.
//
// `workspaces`: the store slice — `null` = not-loaded (the one-shot request in flight), `[]` = loaded-empty
// (a real "zero recent workspaces"), the #141/#324 distinction. `activeCwd`: the active conversation's cwd,
// or null — the row whose `path` equals it carries the "default" pill (exact string equality, so a null
// marks no row, AC2). `onChoose`: callback-gated — supplied ONLY for an active conversation, so absent it
// yields inert (disabled) rows (AC3). `onCreateFolder`: supplied ONLY for an active conversation (#398) —
// present ⇒ the "Other" entry is enabled and its label names `activeCwd`; absent ⇒ disabled + the generic
// label (AC1).
//
// `path` is an untrusted daemon string rendered WHOLE and OPAQUE — auto-escaped React children, never
// dangerouslySetInnerHTML, never split/basenamed/otherwise resolved as a filesystem path (the WorkspaceChip
// / RecentWorkspace posture). `last_used_at` is fed only to formatLastActivity (which degrades an
// unparseable value to '' → the '—' fallback and never throws).
export function WorkspacePickerSheetView({
  workspaces,
  activeCwd,
  now = Date.now(),
  onClose,
  onChoose,
  onCreateFolder
}: {
  workspaces: readonly RecentWorkspace[] | null
  activeCwd: string | null
  now?: number
  onClose: () => void
  onChoose?: (path: string) => void
  onCreateFolder?: () => void
}): JSX.Element {
  return (
    <div className="status-sheet-overlay">
      <div className="status-sheet-overlay__scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="status-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={WORKSPACE_PICKER_SHEET_TITLE_ID}
      >
        <div className="status-sheet__handle" aria-hidden="true" />
        <div className="status-sheet__header">
          <p id={WORKSPACE_PICKER_SHEET_TITLE_ID} className="status-sheet__title">
            {WORKSPACE_PICKER_TITLE}
          </p>
          <button type="button" className="status-sheet__close" aria-label="Close" onClick={onClose}>
            <svg
              className="status-sheet__close-icon"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <div className="status-sheet__body">
          <p className="status-sheet__section-header">{WORKSPACE_PICKER_RECENT_HEADER}</p>
          {/* null (not-loaded) → the header alone, no rows and no empty copy; [] (loaded-empty) → the
              muted empty line; otherwise → one row per workspace. The three branches are structurally
              distinct (AC1). */}
          {workspaces === null ? null : workspaces.length === 0 ? (
            <p className="workspace-picker__empty">{WORKSPACE_PICKER_EMPTY_COPY}</p>
          ) : (
            workspaces.map((row) => (
              // key = row.path: the daemon sends distinct paths, most-recent-first — a real unique key.
              // Gated `disabled={!onChoose}` (no active conversation ⇒ inert, AC3); onClick maps the row
              // path up (the container owns the conversation_id — the path is all the view carries).
              <button
                key={row.path}
                type="button"
                className="workspace-picker__row"
                disabled={!onChoose}
                onClick={() => onChoose?.(row.path)}
              >
                <span className="workspace-picker__row-icon" aria-hidden="true">
                  <FolderIcon />
                </span>
                <span className="workspace-picker__row-body">
                  <span className="workspace-picker__row-line">
                    {/* `path` — opaque daemon display text, auto-escaped, never resolved as a path. */}
                    <span className="workspace-picker__path">{row.path}</span>
                    {row.path === activeCwd && (
                      <span className="workspace-picker__default-pill">
                        {WORKSPACE_PICKER_DEFAULT_PILL}
                      </span>
                    )}
                  </span>
                  {/* formatLastActivity returns '' only on an unparseable timestamp — the '—' fallback
                      then keeps the line from looking broken (the ChannelInfoSheetView idiom). */}
                  <span className="workspace-picker__meta">
                    {WORKSPACE_PICKER_LAST_USED_PREFIX +
                      (formatLastActivity(row.last_used_at, now) || '—')}
                  </span>
                </span>
              </button>
            ))
          )}
          <p className="status-sheet__section-header">{WORKSPACE_PICKER_OTHER_HEADER}</p>
          {/* #398: the create-folder entry — enabled only for an active conversation (onCreateFolder
              supplied), whose label then names the workspace it will create under (AC1). With no active
              conversation the container omits onCreateFolder, so `disabled={!onCreateFolder}` renders it
              disabled and `activeCwd === null` shows the generic fallback label. */}
          <button
            type="button"
            className="workspace-picker__other"
            disabled={!onCreateFolder}
            onClick={onCreateFolder}
          >
            <span className="workspace-picker__other-icon" aria-hidden="true">
              <FolderPlusIcon />
            </span>
            <span className="workspace-picker__other-label">
              {activeCwd === null
                ? WORKSPACE_PICKER_CREATE_LABEL
                : WORKSPACE_PICKER_CREATE_PREFIX + activeCwd}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

// #383: the Workspace Picker's thin interaction container (the ChannelInfoSheet idiom minus its own
// open-state, which ConversationScreen owns). It mounts the dormant #382 data-path bridge, reads the
// store, derives the current-workspace mark, gates the change action on an active conversation, and
// attaches an Escape document-listener. In-file and not exported, like ChannelInfoSheet.
function WorkspacePickerSheet({
  conversation,
  now,
  onClose
}: {
  conversation: ConversationCreatedPayload | null
  now: number
  onClose: () => void
}): JSX.Element {
  // Read the app-singleton store — the bridge (mounted below) writes it, this reads the slice; the view
  // re-renders when rows arrive. Unidirectional: the only write path is daemon → bridge → setter.
  const workspaces = useRecentWorkspacesStore(selectRecentWorkspaces)
  // The "default" mark source: null for a list-opened thread (activeConversationStore is written only on
  // conversation_created), which marks no row (AC2).
  const activeCwd = conversation?.cwd ?? null
  // #398: the Create-folder dialog's open-state — transient UI state → useState, not the store (ADR 0006,
  // the sheet-open idiom). Resets for free on the picker's unmount (it only mounts while open).
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  useEffect(() => {
    // Index the DOM event map — the ChannelInfoSheet Escape effect verbatim. The sheet only mounts while
    // open (gated in ConversationScreen), so the listener attaches on mount / detaches on cleanup — no
    // `open` flag, no leak past close.
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <>
      {/* The dormant #382 data-path bridge — mounting it only while the picker is open gives exactly its
          documented behaviour: a fresh one-shot requestRecentWorkspaces per open (fresh instance → fresh
          useRef → one request), re-fetching on each reopen. Renders null. */}
      <RecentWorkspacesData />
      <WorkspacePickerSheetView
        workspaces={workspaces}
        activeCwd={activeCwd}
        now={now}
        onClose={onClose}
        // Supply onChoose ONLY for a non-null conversation — the change action needs the conversation_id,
        // which only an active conversation carries (AC3). window.pyry is dereferenced only inside this
        // callback (interaction time, never render — the ChannelInfoSheet discipline), so a server-rendered
        // container never touches the bridge. The chosen row's path maps into the `cwd` wire field; then close.
        onChoose={
          conversation === null
            ? undefined
            : (path) => {
                requestChangeWorkspace(window.pyry.sendCommand, conversation.id, path)
                onClose()
              }
        }
        // #398: supply onCreateFolder ONLY for a non-null conversation (gated exactly like onChoose — the
        // dialog needs the conversation_id the switch reflects onto). It just opens the dialog; no wire
        // traffic here.
        onCreateFolder={conversation === null ? undefined : () => setCreateFolderOpen(true)}
      />
      {/* #398: the Create-folder dialog, mounted picker-scoped as a sibling (the ChannelInfoSheet-mounts-
          RenameConversationDialog idiom). onDismiss closes the dialog alone (picker stays, AC2); onCreated
          is the picker's own onClose — closing the picker unmounts this whole tree, so "both the dialog and
          the picker close" (AC4) is one call. Gated on a non-null conversation so its prop is non-null. */}
      {createFolderOpen && conversation !== null && (
        <CreateFolderDialog
          conversation={conversation}
          onDismiss={() => setCreateFolderOpen(false)}
          onCreated={onClose}
        />
      )}
    </>
  )
}

export { WorkspacePickerSheet }
