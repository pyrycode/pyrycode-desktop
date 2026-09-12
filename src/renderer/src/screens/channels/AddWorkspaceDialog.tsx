import { useCallback, useEffect, useRef, useState } from 'react'
import { requestNewWorkspaceChat } from '../../store/conversationCreatedBridge'
import { sessionStore, selectStatusFor, useSessionStore } from '../../store/sessionStore'

const WORKSPACE_CREATE_DEADLINE_MS = 30_000
export type AddWorkspaceStatus = 'idle' | 'creating' | 'rejected' | 'disconnected' | 'timed-out'

const ADD_WORKSPACE_ERROR_COPY = 'Could not start a chat in that folder'
const ADD_WORKSPACE_OFFLINE_COPY = 'Connect this host before starting a chat'
const ADD_WORKSPACE_TIMEOUT_COPY =
  'Could not confirm completion within 30 seconds. The chat may still appear.'

function isAbsolutePath(path: string): boolean {
  return path.trim().startsWith('/')
}

// The ticket retains this form and its existing styling; #1346 owns the Figma modal/path redesign.
// Folder validation remains daemon-owned beyond the existing absolute-path admission rule.
export function AddWorkspaceDialogView({
  path,
  status,
  connected,
  onPathChange,
  onCancel,
  onStart
}: {
  path: string
  status: AddWorkspaceStatus
  connected: boolean
  onPathChange: (next: string) => void
  onCancel: () => void
  onStart: () => void
}): JSX.Element {
  const busy = status === 'creating'
  const error = status === 'timed-out'
    ? ADD_WORKSPACE_TIMEOUT_COPY
    : status === 'disconnected' || !connected
      ? ADD_WORKSPACE_OFFLINE_COPY
      : status === 'rejected' ? ADD_WORKSPACE_ERROR_COPY : null
  return (
    <div className="add-workspace-overlay">
      <div className="add-workspace-overlay__scrim" aria-hidden="true" />
      <div
        className="add-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-workspace-title"
      >
        <h2 id="add-workspace-title" className="add-workspace__title">
          Add workspace
        </h2>
        <label className="add-workspace__field">
          <span className="add-workspace__label">Folder path on the host</span>
          <input
            type="text"
            className="add-workspace__input"
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        {error !== null && <p className="add-workspace__error" role="alert">{error}</p>}
        <div className="add-workspace__actions">
          <button type="button" className="add-workspace__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="add-workspace__start"
            onClick={onStart}
            disabled={busy || !connected || !isAbsolutePath(path)}
          >
            Start chat
          </button>
        </div>
      </div>
    </div>
  )
}

// The open dialog owns the local wait. Ending it never cancels the server-side operation.
// Same-host concurrent creates remain indistinguishable under the current protocol.
export function AddWorkspaceDialog({
  serverId,
  onDismiss
}: {
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  const [path, setPath] = useState('')
  const [status, setStatus] = useState<AddWorkspaceStatus>('idle')
  const connected = useSessionStore(selectStatusFor(serverId))?.type === 'connected'
  const statusRef = useRef(status)
  const submitted = useRef(false)
  const closed = useRef(false)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const clearDeadline = useCallback(() => {
    if (deadline.current !== null) clearTimeout(deadline.current)
    deadline.current = null
  }, [])
  const settle = useCallback((next: AddWorkspaceStatus) => {
    clearDeadline()
    statusRef.current = next
    setStatus(next)
    window.pyry.sendDiagnostic({ event: 'workspace-create-state', code: next })
  }, [clearDeadline])
  const cleanup = useCallback(() => {
    closed.current = true
    clearDeadline()
    unsubscribe.current?.()
    unsubscribe.current = null
  }, [clearDeadline])
  const dismiss = useCallback((code: 'confirmed' | 'cancelled') => {
    cleanup()
    window.pyry.sendDiagnostic({ event: 'workspace-create-closed', code })
    onDismissRef.current()
  }, [cleanup])

  useEffect(() => {
    closed.current = false
    unsubscribe.current = window.pyry.onDaemonEvent((event) => {
      if (
        closed.current || typeof event.serverId !== 'string' || event.serverId.length === 0 ||
        event.serverId !== serverId
      ) return
      if (event.type === 'conversationCreated' && submitted.current) dismiss('confirmed')
      if (event.type === 'conversationCreateRejected' && statusRef.current === 'creating') {
        settle('rejected')
      }
    })
    // Subscribe synchronously to the host's state so loss ends a pending attempt before another click.
    const offStatus = sessionStore.subscribe((state) => {
      if (
        !closed.current && statusRef.current === 'creating' &&
        selectStatusFor(serverId)(state)?.type !== 'connected'
      ) settle('disconnected')
    })
    const offResults = unsubscribe.current
    unsubscribe.current = () => {
      offResults()
      offStatus()
    }
    return cleanup
  }, [serverId, cleanup, dismiss, settle])

  return (
    <AddWorkspaceDialogView
      path={path}
      status={status}
      connected={connected}
      onPathChange={setPath}
      onCancel={() => dismiss('cancelled')}
      onStart={() => {
        if (closed.current || statusRef.current === 'creating' || !isAbsolutePath(path)) return
        if (selectStatusFor(serverId)(sessionStore.getState())?.type !== 'connected') {
          settle('disconnected')
          return
        }
        submitted.current = true
        settle('creating')
        deadline.current = setTimeout(() => {
          if (!closed.current && statusRef.current === 'creating') settle('timed-out')
        }, WORKSPACE_CREATE_DEADLINE_MS)
        try {
          requestNewWorkspaceChat(window.pyry.sendCommand, path, serverId)
        } catch {
          // A local bridge failure has no safe error text to forward.
          settle('rejected')
        }
      }}
    />
  )
}
