import { useEffect, useRef, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { subscribeNewFolder } from '../../store/newFolderBridge'
import {
  newFolderStore,
  useNewFolderStore,
  selectNewFolderRoundTrip,
  type NewFolderRoundTrip
} from '../../store/newFolderStore'
import { sessionStore, selectStatusFor } from '../../store/sessionStore'
import { titleFor } from './channelListViewModel'

import { Modal } from '../../components/Modal'
import { ChannelForm, channelsParent } from './ChannelForm'

export type ChannelLocation = 'dedicated' | 'scratch'

/** Convert a display name to one clean remote folder element. */
export function slugForChannel(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'channel' : slug
}

export function SaveAsChannelDialogView({
  name,
  location,
  roundTrip,
  onNameChange,
  onLocationChange,
  onCancel,
  onSave
}: {
  name: string
  location: ChannelLocation
  roundTrip: NewFolderRoundTrip
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const busy = roundTrip.status === 'in-flight'
  return (
    <div className="create-channel-overlay">
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <Modal title="Save as channel" width={640} onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onSave, disabled: busy || name.trim() === '' }}>
        <ChannelForm name={name} location={location} busy={busy}
          error={roundTrip.status === 'rejected' ? 'Could not create that folder' : null}
          onNameChange={onNameChange} onLocationChange={onLocationChange} />
      </Modal>
    </div>
  )
}

/**
 * Fire the `promoteConversation` command (#273 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestNewConversation` inlines its command. All three payload fields are REQUIRED strings (the
 * deliberate opposite of create's nullable fields): `conversation_id ← conversationId`, `name ← name.trim()`
 * (a promoted channel should not carry accidental edge whitespace), and `cwd` passed VERBATIM by the caller.
 * `cwd` is externalized (#288): the scratch branch passes the row's existing `cwd`, the dedicated branch
 * passes the daemon-RETURNED path — never a client-templated string, which promote's server-side
 * EvalSymlinks would reject. It is opaque display/routing text the renderer never resolves. The view
 * disables Save on a blank name, so this is never reached with one. Fire-and-forget: `sendCommand` is `void`.
 */
export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  conversationId: string,
  name: string,
  cwd: string
): void {
  sendCommand({
    type: 'promoteConversation',
    payload: { conversation_id: conversationId, name: name.trim(), cwd }
  })
}

/** Request the dedicated folder on the retained chat host, relative to its workspace. */
export function requestCreateChannelFolder(
  sendCommand: (command: RendererCommand) => void,
  channelName: string,
  cwd: string,
  serverId?: string
): void {
  sendCommand({
    type: 'createWorkspaceFolder',
    payload: { parent: channelsParent(cwd), name: slugForChannel(channelName) },
    ...(serverId === undefined ? {} : { serverId })
  })
}

/**
 * The Save-as-channel dialog's interaction container (the CreateFolderDialog clone, swapping the tail). Owns
 * the controlled `name` + `location` state, reads the round-trip store, mounts the dormant #397 bridge so the
 * daemon reply resolves, and owns the created-outcome side effect. Exported so ChannelList imports it.
 * `window.pyry` is dereferenced only inside interaction callbacks / the effect, never during render.
 */
export function SaveAsChannelDialog({
  row,
  onDismiss,
  onPromoted
}: {
  row: ConversationSummary & { readonly serverId?: string | null }
  // Cancel: close the dialog only.
  onDismiss: () => void
  // scratch-save OR created→promote: close the dialog.
  onPromoted: () => void
}): JSX.Element {
  // The controlled field, seeded from the row's displayed title on mount — the container mounts fresh each
  // open (ChannelList gates the mount on a non-null row), so a lazy initializer suffices with no re-seed
  // effect (the renameName precedent, moved in-container). Transient UI state → useState, not the store.
  const [name, setName] = useState(() => titleFor(row.name))
  // Each opening uses the chat workspace by default.
  const [location, setLocation] = useState<ChannelLocation>('scratch')
  const roundTrip = useNewFolderStore(selectNewFolderRoundTrip)
  const abandoned = useRef(false)
  const pending = useRef(false)
  const serverId = row.serverId


  useEffect(() => {
    abandoned.current = false
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && (typeof serverId !== 'string' || selectStatusFor(serverId)(state)?.type !== 'connected')) {
        abandoned.current = true
        pending.current = false
        newFolderStore.getState().dispatch({ type: 'reset' })
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
      }
    })
    const offFolder = subscribeNewFolder(
      (listener) => window.pyry.onDaemonEvent((event) => {
        if (!abandoned.current && pending.current && event.serverId === serverId) listener(event)
      }),
      (event) => newFolderStore.getState().dispatch(event)
    )
    return () => {
      abandoned.current = true
      pending.current = false
      offStatus()
      offFolder()
    }
  }, [serverId])

  // Reset the store to idle on unmount — the single deterministic mechanism covering EVERY close path
  // (Cancel, scratch-save, created→onPromoted, Escape). Because the store is an app singleton, any close
  // that left it non-idle would show stale state on the next open; this guarantees every open starts idle.
  useEffect(() => () => newFolderStore.getState().dispatch({ type: 'reset' }), [])

  // The created side effect (AC4 second half): promote to the daemon's RETURNED path VERBATIM (never a
  // client-reconstructed parent+slug — that is EvalSymlinks-rejected daemon-side, the #288 lesson), then
  // close. The path is read BEFORE onPromoted() triggers the unmount, so the promote never races the store
  // reset. `name` is included in deps (it rides into the promote); it is frozen because the input is
  // disabled while in-flight, so it holds the value typed before Save. Only fires in the dedicated branch —
  // the scratch branch never dispatches createRequested, so the store never reaches `created`.
  useEffect(() => {
    if (roundTrip.status === 'rejected' && pending.current) {
      pending.current = false
      window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'folder-rejected' })
    }
    if (roundTrip.status !== 'created' || abandoned.current || !pending.current || !isHostConnected(serverId)) return
    pending.current = false
    requestPromoteConversation(window.pyry.sendCommand, row.id, name, roundTrip.path)
    window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
    onPromoted()
  }, [roundTrip, row.id, name, onPromoted, serverId])

  return (
    <>
      <SaveAsChannelDialogView
        name={name}
        location={location}
        roundTrip={roundTrip}
        onNameChange={setName}
        onLocationChange={setLocation}
        onCancel={() => {
          abandoned.current = true
          pending.current = false
          newFolderStore.getState().dispatch({ type: 'reset' })
          window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
          onDismiss()
        }}
        // Branch on the location choice. Scratch (AC3): promote immediately with the row's existing cwd,
        // no round-trip. Dedicated (AC4 first half): dispatch createRequested (→ in-flight; disables Save +
        // input + radios) THEN send the slugged createWorkspaceFolder; the created-effect does the promote,
        // NOT here. window.pyry is dereferenced only here (interaction time, never render).
        onSave={() => {
          if (abandoned.current || !isHostConnected(serverId) || pending.current || name.trim() === '') return
          if (location === 'scratch') {
            requestPromoteConversation(window.pyry.sendCommand, row.id, name, row.cwd)
            window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
            onPromoted()
            return
          }
          pending.current = true
          newFolderStore.getState().dispatch({ type: 'createRequested' })
          requestCreateChannelFolder(window.pyry.sendCommand, name, row.cwd, typeof serverId === 'string' ? serverId : undefined)
          window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'folder-requested' })
        }}
      />
    </>
  )
}

function isHostConnected(serverId: string | null | undefined): boolean {
  return typeof serverId === 'string' &&
    selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected'
}
