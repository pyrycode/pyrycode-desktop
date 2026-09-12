import { useEffect, useState } from 'react'
import { connectedConversationHostNow, useConversationActionAvailability } from './conversationActionAvailability'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationCreatedPayload } from '@shared/wire/types'
import { NewFolderData } from '../../store/newFolderBridge'
import {
  newFolderStore,
  useNewFolderStore,
  selectNewFolderRoundTrip,
  type NewFolderRoundTrip
} from '../../store/newFolderStore'
import { requestChangeWorkspace } from './WorkspacePickerSheet'

// #398: the Create-folder dialog — the UI slice of #384 (Figma 19-44). A near-clone of the Rename dialog
// (#360, RenameConversationDialog.tsx): the same overlay / scrim / panel chrome and text field, retitled
// "Create workspace" with the field labelled "What should this workspace be called?" and Cancel / Create
// actions. It drives the create-workspace-folder round-trip store (#397, newFolderStore) — in-flight
// disables Create + the input (AC3), rejected surfaces a generic failure line (AC5), created switches the
// conversation to the daemon's returned path and closes both surfaces (AC4). No keys, sockets, or raw
// bytes here — it dispatches the already-guarded `createWorkspaceFolder` command (#381) and reuses the
// `changeWorkspace` reflect helper (#379), both fire-and-forget through the preload bridge.
//
// Three exports mirror the Rename dialog's two (pure view + dispatch helper) plus the ChannelInfoSheet
// container idiom: the pure view (props-in / markup-out, SSR-testable), the dispatch helper, and the
// in-file interaction container (untested reviewed glue; `window.pyry` dereferenced only at interaction
// time). The round-trip state is an INJECTED prop on the view (the RepairPrompt / ConnectionBanner
// discipline), so all four union states are server-renderable without a store.

// A stable id tying the dialog's aria-labelledby to its title element (the RENAME_CONVERSATION_TITLE_ID
// idiom). A single fixed id is safe: only one Create-folder dialog is open at a time.
const CREATE_FOLDER_TITLE_ID = 'create-folder-title'

// Client-owned failure copy (AC5) — apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27;
// (the standing desktop lesson), and workspaceFolderRejected is bare (#396), so NO daemon error text ever
// reaches this line. A single generic message the user reads then retries against.
const CREATE_FOLDER_ERROR_COPY = 'Could not create that folder'

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state); `roundTrip` is the
 * injected round-trip status (#397) that drives the disabled/error display. The four effects are REQUIRED
 * injected props (the "a view that cannot act is a bug" rule). Create is disabled while the name is blank
 * (empty OR whitespace-only, AC2) OR the request is in-flight (AC3); the input is disabled while in-flight
 * (AC3) — both computed inline so the disabled state is directly assertable in server-rendered markup. The
 * `name` renders as an auto-escaped input value (never dangerouslySetInnerHTML), so untrusted text is inert
 * (AC5). When `rejected`, a single generic failure line renders (AC5); any other status renders none.
 */
export function CreateFolderDialogView({
  name,
  roundTrip,
  onNameChange,
  onCancel,
  onCreate,
  available = true
}: {
  name: string
  available?: boolean
  roundTrip: NewFolderRoundTrip
  onNameChange: (next: string) => void
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  const blank = name.trim() === ''
  const busy = roundTrip.status === 'in-flight'
  const rejected = roundTrip.status === 'rejected'
  return (
    <div className="create-folder-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is never
          dimmed and no bare color literal is needed — the rename-conversation-overlay__scrim idiom. */}
      <div className="create-folder-overlay__scrim" aria-hidden="true" />
      <div
        className="create-folder"
        role="dialog"
        aria-modal="true"
        aria-labelledby={CREATE_FOLDER_TITLE_ID}
      >
        <h2 id={CREATE_FOLDER_TITLE_ID} className="create-folder__title">
          Create workspace
        </h2>
        {/* The Figma outlined field (19:46), empty on open. The wrapping <label> gives the input its
            accessible name from the label text — no id/htmlFor pair needed. Disabled while in-flight (AC3). */}
        <label className="create-folder__field">
          <span className="create-folder__label">What should this workspace be called?</span>
          <input
            type="text"
            className="create-folder__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={busy}
          />
        </label>
        {/* The rejected failure line (AC5) — spec-added, not in the Figma. Generic and apostrophe-free;
            reads NO daemon error text (workspaceFolderRejected is bare, #396). Absent in every other status. */}
        {rejected && <p className="create-folder__error">{CREATE_FOLDER_ERROR_COPY}</p>}
        {/* The action row (Figma 19:49): Cancel + Create both right-aligned (justify-end in the node). */}
        <div className="create-folder__actions">
          <button type="button" className="create-folder__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="create-folder__create"
            onClick={onCreate}
            disabled={blank || busy || !available}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Fire the `createWorkspaceFolder` command (#381 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, the requestChangeWorkspace / requestRenameConversation
 * twin (fire-and-forget: `sendCommand` returns void, no try/catch). `parent` is the active conversation's
 * cwd, passed VERBATIM; `name` is trimmed here (a created folder should not carry accidental edge
 * whitespace). Both are renderer strings the daemon polices server-side (#381/#887) — the blank-name
 * disable in the view is the ONLY client-side gate; no separator / `..` / absolute-path check here.
 */
export function requestCreateWorkspaceFolder(
  sendCommand: (command: RendererCommand) => void,
  parent: string,
  name: string,
  serverId?: string
): void {
  sendCommand({ type: 'createWorkspaceFolder', payload: { parent, name: name.trim() },
    ...(serverId === undefined ? {} : { serverId }) })
}

/**
 * The Create-folder dialog's interaction container (the ChannelInfoSheet-mounts-RenameConversationDialogView
 * idiom). Owns the controlled `name` state, reads the round-trip store, mounts the dormant #397 bridge so the
 * daemon reply resolves, and owns the created-outcome side effect. Exported so the picker imports it. The
 * caller gates the mount on a non-null conversation, so `conversation` is non-null here (it carries the
 * `conversation_id` the switch needs). `window.pyry` is dereferenced only inside interaction callbacks / the
 * effect, never during render.
 */
export function CreateFolderDialog({
  conversation,
  onDismiss,
  onCreated
}: {
  conversation: ConversationCreatedPayload
  // Cancel: close the dialog only — the picker stays open (AC2).
  onDismiss: () => void
  // created: close the picker (which unmounts this dialog with it) (AC4).
  onCreated: () => void
}): JSX.Element {
  // The controlled field — transient UI state → useState, not the store (ADR 0006, the renameName
  // precedent). Resets for free on unmount (the dialog only mounts while open).
  const available = useConversationActionAvailability(conversation.id)
  const [name, setName] = useState('')
  const roundTrip = useNewFolderStore(selectNewFolderRoundTrip)

  // Reset the store to idle on unmount — the single deterministic mechanism covering EVERY close path
  // (Cancel, created→onCreated, Escape/scrim closing the whole picker). Because the store is an app
  // singleton, any close that left it non-idle would show stale state on the next open; this guarantees
  // every open starts from idle, and satisfies AC4's reset on the created path.
  useEffect(() => () => newFolderStore.getState().dispatch({ type: 'reset' }), [])

  // The created side effect: switch the conversation to the daemon's RETURNED path VERBATIM (never a
  // client-reconstructed parent+name — that is EvalSymlinks-rejected daemon-side, the #288 lesson), then
  // close the picker. The command is idempotent (same cwd), so a stray re-fire before unmount is harmless;
  // in practice onCreated() unmounts this dialog immediately. The path is read BEFORE onCreated() triggers
  // the unmount, so the switch never races the store reset.
  useEffect(() => {
    if (roundTrip.status !== 'created') return
    if (connectedConversationHostNow(conversation.id) === null) {
      newFolderStore.getState().dispatch({ type: 'reset' })
      return
    }
    requestChangeWorkspace(window.pyry.sendCommand, conversation.id, roundTrip.path)
    onCreated()
  }, [roundTrip, conversation.id, onCreated])

  return (
    <>
      {/* Mount the dormant #397 bridge dialog-scoped so the daemon-reply listener lives exactly while the
          dialog is open (the RecentWorkspacesData picker-scoped shape). Without this the store never leaves
          in-flight and the dialog hangs forever. Renders null. */}
      <NewFolderData />
      <CreateFolderDialogView
        available={available}
        name={name}
        roundTrip={roundTrip}
        onNameChange={setName}
        onCancel={onDismiss}
        // Dispatch createRequested (→ in-flight; disables Create + input, AC3) THEN send the command with
        // the active conversation's cwd as `parent` and the trimmed name. window.pyry is dereferenced only
        // here (interaction time, never render — the ChannelInfoSheet discipline).
        onCreate={() => {
          const serverId = connectedConversationHostNow(conversation.id)
          if (serverId === null) return
          newFolderStore.getState().dispatch({ type: 'createRequested' })
          requestCreateWorkspaceFolder(window.pyry.sendCommand, conversation.cwd, name, serverId)
        }}
      />
    </>
  )
}
