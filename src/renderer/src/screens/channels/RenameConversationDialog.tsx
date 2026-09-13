import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { Modal } from '../../components/Modal'

/** Controlled presentation; callers retain draft, focus and dismissal ownership. */
export function RenameConversationDialogView({
  name,
  onNameChange,
  onCancel,
  onSave,
  available = true
}: {
  name: string
  available?: boolean
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const blank = name.trim() === ''
  return (
    <div className="rename-conversation-overlay">
      <div className="rename-conversation-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Rename"
        width={640}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onSave, disabled: blank || !available }}
        onClose={onCancel}
      >
        <label className="rename-conversation__field">
          <span className="rename-conversation__label">Channel name:</span>
          <input
            type="text"
            className="rename-conversation__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
      </Modal>
    </div>
  )
}

/**
 * Fire the `renameConversation` command (#359 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestPromoteConversation` inlines its command. The requestPromoteConversation twin MINUS `cwd`:
 * both payload fields are REQUIRED strings — `conversation_id ← row.id`, `name ← name.trim()` (a renamed
 * channel should not carry accidental edge whitespace). Do NOT carry `cwd`: rename is a deliberate
 * non-reuse of PromoteConversationPayload (RenameConversationPayload has no `cwd`; a stray one would fail
 * isRenameConversationPayload's exact-shape check at the main boundary and drift the wire from the daemon
 * contract; #820). The view disables OK on a blank name, so this is never reached with one — no
 * redundant guard here (trimming is the only job). Fire-and-forget, like the composer's send: `sendCommand`
 * is `void`.
 */
export function requestRenameConversation(
  sendCommand: (command: RendererCommand) => void,
  // The param is narrowed to exactly what this helper reads — the `id`. A full ConversationSummary (the
  // ChannelList caller) still satisfies `Pick<…, 'id'>`, and the Channel Info sheet's active conversation
  // (a ConversationCreatedPayload, #368) is accepted directly with no adapter — it too carries `id`,
  // though not ConversationSummary's is_archived / last_message_ts. Reading only `.id`, the signature now
  // states its real input rather than over-demanding a shape it never touches.
  row: Pick<ConversationSummary, 'id'>,
  name: string
): void {
  sendCommand({
    type: 'renameConversation',
    payload: { conversation_id: row.id, name: name.trim() }
  })
}
