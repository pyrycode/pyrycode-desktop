import { useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { requestNewConversation } from '../../store/conversationCreatedBridge'
import { selectStatusFor, sessionStore } from '../../store/sessionStore'

export function CreateChatDialogView({ error, onCancel, onCreate }: {
  error: string | null
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  return <div className="create-chat-overlay">
    <div className="create-chat-overlay__scrim" aria-hidden="true" />
    <Modal title="Create chat" onClose={onCancel}
      cancelAction={{ label: 'Cancel', onClick: onCancel }}
      confirmAction={{ label: 'OK', onClick: onCreate }}>
      <p className="create-chat__detail">Create a chat in this host's default folder?</p>
      {error !== null && <p role="alert">{error}</p>}
    </Modal>
  </div>
}

export function CreateChatDialog({ serverId, onDismiss }: {
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  const submitted = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const dismiss = (code: 'cancelled' | 'disconnected' | 'requested'): void => {
    submitted.current = true
    window.pyry.sendDiagnostic({ event: 'chat-create-closed', code })
    onDismiss()
  }
  return <CreateChatDialogView error={error} onCancel={() => dismiss('cancelled')} onCreate={() => {
    if (submitted.current) return
    if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
      dismiss('disconnected')
      return
    }
    submitted.current = true
    try {
      requestNewConversation(window.pyry.sendCommand, null, serverId)
    } catch {
      submitted.current = false
      setError('Could not create that chat')
      window.pyry.sendDiagnostic({ event: 'chat-create-state', code: 'send-failed' })
      return
    }
    window.pyry.sendDiagnostic({ event: 'chat-create-state', code: 'requested' })
    dismiss('requested')
  }} />
}
