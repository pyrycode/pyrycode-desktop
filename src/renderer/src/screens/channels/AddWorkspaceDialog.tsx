import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { requestNewWorkspaceChat } from '../../store/conversationCreatedBridge'
import { sessionStore, selectStatusFor, useSessionStore } from '../../store/sessionStore'
import { Modal } from '../../components/Modal'
import { selectHostLabelFor, useHostLabelStore } from '../../store/hostLabelStore'

const WORKSPACE_CREATE_DEADLINE_MS = 30_000
export type AddWorkspaceStatus = 'idle' | 'creating' | 'rejected' | 'disconnected' | 'timed-out'

const ADD_WORKSPACE_ERROR_COPY = 'Could not start a chat in that folder'
const ADD_WORKSPACE_OFFLINE_COPY = 'Connect this host before starting a chat'
const ADD_WORKSPACE_TIMEOUT_COPY =
  'Could not confirm completion within 30 seconds. The chat may still appear.'

// Remote string resolution only; validation and canonicalisation belong to the selected daemon.
function resolveWorkspacePath(path: string, workspaceRoot?: string): string {
  const input = path.trim()
  if (input === '' || input.startsWith('/')) return input
  if (!workspaceRoot?.startsWith('/')) return ''
  return workspaceRoot.replace(/\/+$/, '') + '/' + input
}

export function AddWorkspaceDialogView({
  path, workspaceRoot, hostLabel, status, connected, onPathChange, onCancel, onStart
}: {
  path: string
  workspaceRoot?: string
  hostLabel: string
  status: AddWorkspaceStatus
  connected: boolean
  onPathChange: (next: string) => void
  onCancel: () => void
  onStart: () => void
}): JSX.Element {
  const previewId = useId()
  const busy = status === 'creating'
  const destination = resolveWorkspacePath(path, workspaceRoot)
  const locationUnavailable = path.trim() !== '' && destination === ''
  const error = status === 'timed-out'
    ? ADD_WORKSPACE_TIMEOUT_COPY
    : status === 'disconnected' || !connected
      ? ADD_WORKSPACE_OFFLINE_COPY
      : status === 'rejected' ? ADD_WORKSPACE_ERROR_COPY : null
  return (
    <div className="add-workspace-overlay">
      <div className="add-workspace-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Add workspace"
        width={640}
        onClose={onCancel}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onStart, disabled: busy || !connected || destination === '' }}
      >
        <p className="add-workspace__detail">
          <span className="add-workspace__label">Host:</span>
          <span>{hostLabel}</span>
        </p>
        <label className="add-workspace__field">
          <span className="add-workspace__label">Workspace folder on the host (relative or absolute path):</span>
          <input
            type="text"
            className="add-workspace__input"
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        <p className="add-workspace__detail">
          <span id={previewId} className="add-workspace__label">Absolute path preview:</span>
          <output className="add-workspace__preview" aria-labelledby={previewId}>{destination}</output>
        </p>
        {locationUnavailable && (
          <p className="add-workspace__error" role="alert">Host workspace location is unavailable</p>
        )}
        {error !== null && <p className="add-workspace__error" role="alert">{error}</p>}
      </Modal>
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
  const connection = useSessionStore(selectStatusFor(serverId))
  const connected = connection?.type === 'connected'
  const workspaceRoot = connection?.type === 'connected' ? connection.ack.workspace_root : undefined
  const destination = resolveWorkspacePath(path, workspaceRoot)
  const label = useHostLabelStore(selectHostLabelFor(serverId))
  // Match the host row's display fallback without coupling this dialog to the parent screen.
  const hostLabel = label.status === 'stored' && label.label.trim() !== '' ? label.label : 'Server'
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
      workspaceRoot={workspaceRoot}
      hostLabel={hostLabel}
      status={status}
      connected={connected}
      onPathChange={setPath}
      onCancel={() => dismiss('cancelled')}
      onStart={() => {
        if (closed.current || statusRef.current === 'creating' || destination === '') return
        const current = selectStatusFor(serverId)(sessionStore.getState())
        if (current?.type !== 'connected') {
          settle('disconnected')
          return
        }
        // Never send a newer greeting's destination before its preview has rendered.
        if (resolveWorkspacePath(path, current.ack.workspace_root) !== destination) return
        submitted.current = true
        settle('creating')
        deadline.current = setTimeout(() => {
          if (!closed.current && statusRef.current === 'creating') settle('timed-out')
        }, WORKSPACE_CREATE_DEADLINE_MS)
        try {
          requestNewWorkspaceChat(window.pyry.sendCommand, destination, serverId)
        } catch {
          // A local bridge failure has no safe error text to forward.
          settle('rejected')
        }
      }}
    />
  )
}
