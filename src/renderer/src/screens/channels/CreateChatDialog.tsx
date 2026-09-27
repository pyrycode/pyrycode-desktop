import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/Modal'
import { requestNewConversation } from '../../store/conversationCreatedBridge'
import { selectStatusFor, sessionStore } from '../../store/sessionStore'

export function CreateChatDialogView({ error, onCancel, onCreate }: {
  error: string | null
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const overlay = overlayRef.current
    if (overlay === null) return
    const invoker = document.activeElement
    overlay.querySelector<HTMLButtonElement>('.modal__action--cancel')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const buttons = Array.from(overlay.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (invoker instanceof HTMLElement && invoker.isConnected) invoker.focus()
    }
  }, [])
  return <div className="create-chat-overlay" ref={overlayRef}>
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
