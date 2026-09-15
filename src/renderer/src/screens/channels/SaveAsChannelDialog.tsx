import { useEffect, useRef, useState } from 'react'
import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { sessionStore, selectStatusFor } from '../../store/sessionStore'
import { titleFor } from './channelListViewModel'

import { Modal } from '../../components/Modal'
import { ChannelForm } from './ChannelForm'

export function SaveAsChannelDialogView({
  name,
  onNameChange,
  onCancel,
  onSave
}: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  return (
    <div className="create-channel-overlay">
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <Modal title="Save as channel" width={640} onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onSave, disabled: name.trim() === '' }}>
        <ChannelForm name={name} busy={false} error={null} onNameChange={onNameChange} />
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
 * Since #1436 there is one caller and one source for that `cwd`: the promoted row's own, exactly as the
 * daemon reported it — never a client-templated string, which promote's server-side EvalSymlinks would
 * reject. It is opaque display/routing text the renderer never resolves. The view disables Save on a blank
 * name, so this is never reached with one. Fire-and-forget: `sendCommand` is `void`.
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

/**
 * The Save-as-channel dialog's interaction container. Owns the controlled `name` state and the
 * abandonment flag, and dispatches the promotion on Save. Exported so ChannelList imports it.
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
  // Save: close the dialog.
  onPromoted: () => void
}): JSX.Element {
  // The controlled field, seeded from the row's displayed title on mount — the container mounts fresh each
  // open (ChannelList gates the mount on a non-null row), so a lazy initializer suffices with no re-seed
  // effect (the renameName precedent, moved in-container). Transient UI state → useState, not the store.
  const [name, setName] = useState(() => titleFor(row.name))
  const abandoned = useRef(false)
  const serverId = row.serverId

  // A synchronous session subscription abandons the draft when its host stops being connected. Necessary
  // even with ChannelList's render-time gating: a disconnect and a reconnect batched before React paints
  // would otherwise hide the host loss from a Save already focused by the keyboard.
  useEffect(() => {
    abandoned.current = false
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && (typeof serverId !== 'string' || selectStatusFor(serverId)(state)?.type !== 'connected')) {
        abandoned.current = true
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
      }
    })
    return () => {
      abandoned.current = true
      offStatus()
    }
  }, [serverId])

  return (
    <SaveAsChannelDialogView
      name={name}
      onNameChange={setName}
      onCancel={() => {
        abandoned.current = true
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'abandoned' })
        onDismiss()
      }}
      // Promote the existing chat in its own workspace and close on dispatch — there is no round trip
      // to wait on and no correlated rejection. #1436 withdrew the dedicated-folder arm that once
      // stood beside this one. window.pyry is dereferenced only here (interaction time, never render).
      onSave={() => {
        if (abandoned.current || !isHostConnected(serverId) || name.trim() === '') return
        requestPromoteConversation(window.pyry.sendCommand, row.id, name, row.cwd)
        window.pyry.sendDiagnostic({ event: 'sidebar-promotion', code: 'sent' })
        onPromoted()
      }}
    />
  )
}

function isHostConnected(serverId: string | null | undefined): boolean {
  return typeof serverId === 'string' &&
    selectStatusFor(serverId)(sessionStore.getState())?.type === 'connected'
}
