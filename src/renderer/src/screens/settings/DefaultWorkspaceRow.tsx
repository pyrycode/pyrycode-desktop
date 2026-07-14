import { useEffect, useState } from 'react'
import {
  useDefaultWorkspaceStore,
  selectDefaultWorkspace,
  defaultWorkspaceStore
} from '../../store/defaultWorkspaceStore'
import {
  useRecentWorkspacesStore,
  selectRecentWorkspaces
} from '../../store/recentWorkspacesStore'
import { RecentWorkspacesData } from '../../store/recentWorkspacesBridge'
import { WorkspacePickerSheetView } from '../conversation/WorkspacePickerSheet'

// #404: the "Default workspace" row of the "Defaults for new conversations" section (Figma 17:56). It
// renders the client-owned default-workspace preference (#403) and, on activation, opens the recent-
// workspaces picker (#383's pure view) to change it — writing the choice back through the store setter.
// Renderer-only: no wire types, no daemon command (a workspace path is not a secret; the choose action
// fires nothing over the wire — the sole traffic is the picker's own recent-workspaces fetch on open).
//
// Two exports + one in-file glue component mirror the ServerRow/ArchivedCountRow two-part idiom fused with
// #383's WorkspacePickerSheet container: the pure view (the tested seam), the store-bound Control, and the
// picker sheet that only mounts while open. The row is INTERACTIVE (it opens a picker), so it is a native
// <button> with a trailing chevron — the PairAnotherServerRow (#152) variant of the row idiom, not the
// static ServerRow/ArchivedCountRow variant.

// Client-owned copy — module-level constants (the SETTINGS_COPY / SERVER_ROW_LABEL idiom), never daemon
// strings. Apostrophe-free: renderToStaticMarkup escapes ' (the standing desktop lesson). The placeholder
// is a client-owned constant standing for the server's scratch default (Figma 17:59) — NOT a daemon string;
// it renders whenever the stored default is null ("no default ever chosen").
const DEFAULT_WORKSPACE_ROW_LABEL = 'Default workspace'
const DEFAULT_WORKSPACE_PLACEHOLDER = 'scratch'

/**
 * The pure, exported, props-in/markup-out view (the ServerRow/ArchivedCountRow tested seam) — a native
 * <button> whose visible text is its accessible name (AC4): no aria-label. The primary label sits over a
 * secondary line showing the current default whole and opaque (the stored path rendered as auto-escaped
 * React children, never split/basenamed/resolved — the WorkspacePickerSheet `row.path` posture), or the
 * "scratch" placeholder when `null` (AC2). The trailing 20×20 chevron_right (Figma 17:60) is decorative,
 * aria-hidden — the exact inline glyph from PairAnotherServerRow.
 */
export function DefaultWorkspaceRowView({
  defaultWorkspace,
  onActivate
}: {
  defaultWorkspace: string | null
  onActivate: () => void
}): JSX.Element {
  return (
    <button type="button" className="settings__default-workspace-row" onClick={onActivate}>
      <span className="settings__default-workspace-text">
        <span className="settings__default-workspace-label">{DEFAULT_WORKSPACE_ROW_LABEL}</span>
        <span className="settings__default-workspace-value">
          {defaultWorkspace ?? DEFAULT_WORKSPACE_PLACEHOLDER}
        </span>
      </span>
      <svg
        className="settings__default-workspace-chevron"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
      </svg>
    </button>
  )
}

/**
 * The store-bound container (the ServerRowControl posture) — reads the current default via the store's own
 * selector and owns the picker open-state via `useState` (transient UI state → local state, not the store;
 * ADR 0006, the ChannelInfoSheet / WorkspacePickerSheet idiom). Renders the pure row alone at rest and
 * mounts the picker sheet only while open. No `window` deref at render, no setter call at render — the
 * server-rendered row is just the button with `open` false.
 */
export function DefaultWorkspaceRowControl(): JSX.Element {
  const defaultWorkspace = useDefaultWorkspaceStore(selectDefaultWorkspace)
  const [open, setOpen] = useState(false)
  return (
    <>
      <DefaultWorkspaceRowView defaultWorkspace={defaultWorkspace} onActivate={() => setOpen(true)} />
      {open && (
        <DefaultWorkspacePickerSheet activeCwd={defaultWorkspace} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

/**
 * The Settings picker sheet — the direct analog of #383's WorkspacePickerSheet container, minus its
 * conversation coupling. It mounts only while the picker is open, so "fresh fetch per open" falls out of
 * mount/unmount: each open is a fresh RecentWorkspacesData (fresh useRef → one requestRecentWorkspaces) and
 * the Escape listener attaches on mount / detaches on cleanup with no `open` flag. In-file and not
 * exported — untested reviewed glue, like #383's container.
 *
 * `onChoose` writes the store INSTEAD of dispatching the daemon `change_workspace` command (the #383
 * container's onChoose) — #404 records a client pref, it sends nothing over the wire (AC3). The store setter
 * is dereferenced only inside the callback (interaction time, never render — the RecentWorkspacesData
 * discipline). No `onCreateFolder` is supplied — the "Other → Create new folder" entry (#398) is
 * conversation-scoped and out of scope here, so it renders disabled (out-of-scope note 1). `activeCwd` is
 * the current default so the matching row carries the picker's built-in "default" pill (null marks no row).
 */
function DefaultWorkspacePickerSheet({
  activeCwd,
  onClose
}: {
  activeCwd: string | null
  onClose: () => void
}): JSX.Element {
  const workspaces = useRecentWorkspacesStore(selectRecentWorkspaces)
  useEffect(() => {
    // The #383 Escape effect verbatim — the sheet only mounts while open, so the listener attaches on
    // mount / detaches on cleanup with no `open` flag, no leak past close.
    const onKeyDown = (event: DocumentEventMap['keydown']): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <>
      {/* The dormant #382 data-path bridge — mounting it only while the picker is open gives exactly its
          documented behaviour: a fresh one-shot requestRecentWorkspaces per open, re-fetching on each
          reopen. Renders null. */}
      <RecentWorkspacesData />
      <WorkspacePickerSheetView
        workspaces={workspaces}
        activeCwd={activeCwd}
        onClose={onClose}
        // The sole write path: record the chosen default, then close. The store setter is dereferenced
        // inside the callback (never at render). No daemon command — #404 writes a client pref (AC3).
        onChoose={(path) => {
          defaultWorkspaceStore.getState().setDefaultWorkspace(path)
          onClose()
        }}
      />
    </>
  )
}
