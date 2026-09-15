import { Modal } from '../../components/Modal'

/**
 * The dialog's one client-owned string (#1476), in `EDIT_CHAT_COPY`'s idiom one dialog over: a module
 * constant, apostrophe-free, interpolating no conversation name. It sits here rather than inline because
 * IT IS A LOAD-BEARING e2e LOCATOR AND MAY NOT BE REWORDED — five specs find this dialog by
 * `getByRole('dialog', { name: … })`, one of them a `real-*` spec behind the live gate.
 *
 * SENTENCE CASE against the drawing's title-case "Edit Channel", matching every sibling dialog in this
 * directory (Edit chat, Edit host, Edit workspace, Create channel, Add workspace).
 *
 * NOT shared with `ChannelList`'s `EDIT_CHANNEL_CONTROL_LABEL`, which happens to carry the same two
 * words: that constant names the PEN and is read by its `aria-label` and its hover pill; this one names
 * the DIALOG. Folding them together would couple a control's accessible name to a modal's heading across
 * a module boundary for a coincidence of wording — the ruling `HOST_ROW_FALLBACK_LABEL` already records.
 */
const EDIT_CHANNEL_TITLE = 'Edit channel'

/**
 * Controlled presentation; callers retain draft, focus and dismissal ownership.
 *
 * `EditChatDialogView`'s shape MINUS `onArchive` and MINUS `available`, and a separate module rather
 * than a prop on it, because the two dialogs' class namespaces must not collide: six shipped specs find
 * the chat dialog through `.rename-conversation*`, and #1438 already specifies `.edit-channel*` for the
 * button it adds below this field. Two locator sets is the whole reason for two files.
 *
 * NO `available` PROP. Its twin carries one because #1440's AC3 lives in the GAP between two buttons'
 * disabled expressions — OK reads `blank || !available`, Archive chat reads `!available` alone. This
 * dialog has one button and no such gap, so the prop would have one value and no caller. Its host guard
 * is the container's pair instead: the render gate on `connected(…)`, plus the `canMutateHost` re-check
 * the save callback takes at interaction time against the LIVE store rather than against React state.
 * #1438 adds the prop when it adds the second button that needs it.
 */
export function EditChannelDialogView({
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
    <div className="edit-channel-overlay">
      <div className="edit-channel-overlay__scrim" aria-hidden="true" />
      <Modal
        title={EDIT_CHANNEL_TITLE}
        width={640}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        // Disabled on a BLANK name alone. The "unchanged name sends nothing" half of AC2 is deliberately
        // NOT expressed here: OK stays live on an untouched field and dismisses, because a dialog whose
        // only exit went dead the moment you opened it reads as broken. The decision not to send is the
        // container's, taken beside the send where the row's seeded title is in scope.
        confirmAction={{ label: 'OK', onClick: onSave, disabled: name.trim() === '' }}
        onClose={onCancel}
      >
        {/* The drawing's `Input large` (500:2118) — a semibold label above a filled, borderless field.
            The shared Modal already draws everything around it: the title, the close control, the rule
            under them and the centred Cancel/OK footer. */}
        <label className="edit-channel__field">
          <span className="edit-channel__label">Channel name:</span>
          <input
            type="text"
            className="edit-channel__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
      </Modal>
    </div>
  )
}
