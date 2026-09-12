import type { RendererCommand } from '@shared/ipc/commands'
import { Modal } from '../../components/Modal'
import { workspaceLabelFor } from './channelListViewModel'

const MAX_WORKSPACE_LABEL_LENGTH = 128

/**
 * Presentation and validation only. The container seeds the draft and owns dismissal.
 * Preserve the existing lack of autofocus and Escape/backdrop dismissal.
 */
export function EditWorkspaceDialogView({
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
    <div className="edit-workspace-overlay">
      <div className="edit-workspace-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Edit workspace"
        width={640}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{
          label: 'OK',
          onClick: onSave,
          disabled: name.trim().length > MAX_WORKSPACE_LABEL_LENGTH
        }}
        onClose={onCancel}
      >
        <label className="edit-workspace__field">
          <span className="edit-workspace__label">Workspace name (optional):</span>
          <input
            type="text"
            className="edit-workspace__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
      </Modal>
    </div>
  )
}

/**
 * Fire once; the existing workspace update flow refreshes the rows.
 * Echo the exact remote path without normalization. An explicit null label clears
 * the custom name; omitting that key would violate the command contract.
 * Server identity is omitted only for the existing unattributed-row fallback.
 */
export function requestRenameWorkspace(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  name: string,
  serverId?: string
): void {
  const trimmed = name.trim()
  sendCommand({
    type: 'renameWorkspace',
    ...(serverId === undefined ? {} : { serverId }),
    payload: {
      path: cwd,
      label: trimmed === '' || trimmed === workspaceLabelFor(cwd) ? null : trimmed
    }
  })
}
