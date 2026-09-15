import { useCallback, useEffect, useRef, useState } from 'react'
import { ChannelForm } from './ChannelForm'
import { Modal } from '../../components/Modal'
import { requestNewChannel } from '../../store/conversationCreatedBridge'
import { selectStatusFor, sessionStore } from '../../store/sessionStore'

export function CreateChannelDialogView({
  name, busy, error, onNameChange, onCancel, onCreate
}: {
  name: string
  busy: boolean
  error: string | null
  onNameChange: (next: string) => void
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
        <ChannelForm name={name} busy={busy} error={error} onNameChange={onNameChange} />
      </Modal>
    </div>
  )
}

// One stage since #1436 removed the folder round trip: the channel is created in the clicked
// workspace itself, so `createConversation` is the only command this draft ever sends.
type Pending = { type: 'idle' } | { type: 'channel' }

// This mounted draft owns only its continuation. The daemon owns already-sent operations,
// and the existing navigation bridge owns opening confirmed channels.
export function CreateChannelDialog({ cwd, serverId, onDismiss }: {
  cwd: string
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  const [name, setName] = useState('')
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
  const fail = useCallback(() => {
    pending.current = { type: 'idle' }
    setBusy(false)
    setError('Could not create that channel')
    window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'channel-rejected' })
  }, [])

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
      if (pending.current.type !== 'channel') return
      if (event.type === 'conversationCreated') dismiss('confirmed')
      else if (event.type === 'conversationCreateRejected') fail()
    })
    const offStatus = sessionStore.subscribe((state) => {
      if (!abandoned.current && selectStatusFor(serverId)(state)?.type !== 'connected') {
        dismiss('disconnected')
      }
    })
    unsubscribe.current = () => { offEvents(); offStatus() }
    return cleanup
  }, [serverId, cleanup, dismiss, fail])

  return <CreateChannelDialogView
    name={name} busy={busy} error={error}
    onNameChange={setName}
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
      // The synchronous ref is set before dispatch, so a second activation cannot re-enter
      // before React paints the disabled OK.
      pending.current = { type: 'channel' }
      window.pyry.sendDiagnostic({ event: 'channel-create-state', code: 'channel-requested' })
      try {
        requestNewChannel(window.pyry.sendCommand, displayName, cwd, serverId)
      } catch {
        fail()
      }
    }}
  />
}
