import { useCallback, useEffect, useRef, useState } from 'react'
import { ChannelForm, channelsParent } from './ChannelForm'
import { Modal } from '../../components/Modal'
import { requestNewChannel } from '../../store/conversationCreatedBridge'
import { selectStatusFor, sessionStore } from '../../store/sessionStore'
import { slugForChannel, type ChannelLocation } from './SaveAsChannelDialog'

export function CreateChannelDialogView({
  name, location, busy, error, onNameChange, onLocationChange, onCancel, onCreate
}: {
  name: string
  location: ChannelLocation
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
  onLocationChange: (next: ChannelLocation) => void
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  return (
    <div className="create-channel-overlay">
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Create channel"
        width={640}
        onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onCreate, disabled: busy || name.trim() === '' }}
      >
        <ChannelForm name={name} location={location} busy={busy} error={error}
          onNameChange={onNameChange} onLocationChange={onLocationChange} />
      </Modal>
    </div>
  )
}

type Pending = { type: 'idle' } | { type: 'folder'; name: string } | { type: 'channel' }

// This mounted draft owns only its continuation. The daemon owns already-sent operations,
// and the existing navigation bridge owns opening confirmed channels.
export function CreateChannelDialog({ cwd, serverId, onDismiss }: {
  cwd: string
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [location, setLocation] = useState<ChannelLocation>('scratch')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Pending>({ type: 'idle' })
  const abandoned = useRef(false)
  const unsubscribe = useRef<(() => void) | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const cleanup = useCallback(() => {
    abandoned.current = true
    pending.current = { type: 'idle' }
    unsubscribe.current?.()
    unsubscribe.current = null
  }, [])
  const dismiss = useCallback((code: 'cancelled' | 'confirmed' | 'disconnected') => {
    cleanup()
    window.pyry.sendDiagnostic({ event: 'channel-create-closed', code })
    onDismissRef.current()
  }, [cleanup])
  const fail = useCallback((stage: 'folder' | 'channel') => {
    pending.current = { type: 'idle' }
    setBusy(false)
    setError(stage === 'folder' ? 'Could not create that folder' : 'Could not create that channel')
    window.pyry.sendDiagnostic({ event: 'channel-create-state', code: `${stage}-rejected` })
  }, [])
  const createChannel = useCallback((displayName: string, path: string) => {
    pending.current = { type: 'channel' }
    window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'channel-requested' })
    try {
      requestNewChannel(window.pyry.sendCommand, displayName, path, serverId)
    } catch {
      fail('channel')
    }
  }, [serverId, fail])

  useEffect(() => {
    abandoned.current = false
    const offEvents = window.pyry.onDaemonEvent((event) => {
      // Inspect the original main stamp before flattening: these replies have no renderer request ID.
      // Concurrent same-host operations in the same stage remain indistinguishable.
      if (abandoned.current || serverId === '' || event.serverId !== serverId) return
      if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
        dismiss('disconnected')
        return
      }
      const current = pending.current
      if (current.type === 'folder') {
        if (event.type === 'workspaceFolderCreated') createChannel(current.name, event.path)
        else if (event.type === 'workspaceFolderRejected') fail('folder')
      } else if (current.type === 'channel') {
        if (event.type === 'conversationCreated') dismiss('confirmed')
        else if (event.type === 'conversationCreateRejected') fail('channel')
      }
    })
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && selectStatusFor(serverId)(state)?.type !== 'connected') {
        dismiss('disconnected')
      }
    })
    unsubscribe.current = () => { offEvents(); offStatus() }
    return cleanup
  }, [serverId, cleanup, dismiss, fail, createChannel])

  return <CreateChannelDialogView
    name={name} location={location} busy={busy} error={error}
    onNameChange={setName} onLocationChange={setLocation}
    onCancel={() => dismiss('cancelled')}
    onCreate={() => {
      const displayName = name.trim()
      if (abandoned.current || pending.current.type !== 'idle' || displayName === '') return
      if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
        dismiss('disconnected')
        return
      }
      setBusy(true)
      setError(null)
      if (location === 'scratch') {
        createChannel(displayName, cwd)
        return
      }
      pending.current = { type: 'folder', name: displayName }
      window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'folder-requested' })
      try {
        window.pyry.sendCommand({ type: 'createWorkspaceFolder', serverId,
          payload: { parent: channelsParent(cwd), name: slugForChannel(displayName) } })
      } catch {
        fail('folder')
      }
    }}
  />
}
