import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'
import { Modal } from '../../components/Modal'

/**
 * The dialog's two client-owned strings (#1440), in `ARCHIVE_WORKSPACE_COPY`'s idiom one dialog over:
 * module constants, apostrophe-free, interpolating no conversation name. They sit together because BOTH
 * ARE LOAD-BEARING e2e LOCATORS AND NEITHER MAY BE REWORDED — the title is a `getByRole('dialog')` name in
 * three specs, the button's text is its accessible name — so a reader looking for what is pinned finds
 * both at once rather than one inline and one here.
 *
 * SENTENCE CASE against the drawing's title-case "Edit Chat": every sibling dialog in this directory
 * already renders sentence case (Edit host, Edit workspace, Create channel, Add workspace).
 */
const EDIT_CHAT_COPY = { title: 'Edit chat', archive: 'Archive chat' } as const

/** Controlled presentation; callers retain draft, focus and dismissal ownership. */
export function EditChatDialogView({
  name,
  onNameChange,
  onCancel,
  onSave,
  onArchive,
  available = true
}: {
  name: string
  available?: boolean
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
  // #1440: the archive button's effect. REQUIRED, not optional — the `EditWorkspaceArchive` rule: a view
  // that cannot act is a bug, so forgetting to wire it is a compile error rather than an inert button.
  // NULLARY, because this dialog is open against exactly ONE conversation, whose id the container already
  // holds; a parameter would be a value the caller reads straight back out of its own state.
  onArchive: () => void
}): JSX.Element {
  const blank = name.trim() === ''
  return (
    <div className="rename-conversation-overlay">
      <div className="rename-conversation-overlay__scrim" aria-hidden="true" />
      <Modal
        title={EDIT_CHAT_COPY.title}
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
        {/* #1440 — the content slot's own `Actions` frame (487:2320), below the input and above the
            centred footer. ONE arm, where `EditWorkspaceDialogView`'s archive slot has two and needs a
            `status` prop to choose between them: this act takes no confirmation step, because an
            archived chat comes back through the Archive screen's Restore — the same reading the Channel
            info sheet's own Archive already acts on, one surface over, with no confirm either.

            ⭐ DISABLED ON `available` ALONE, never on `blank`. The two buttons read different halves of
            the same guard on purpose: putting a chat away has nothing to do with what its name field
            currently holds, so an empty or unchanged field leaves this clickable while OK is dead.
            Reusing OK's expression here is the regression the static tests are pointed at.

            The class prefix stays `rename-conversation` behind the new title: six specs locate this
            dialog through those tokens, and one dialog with two class namespaces would be worse than one
            whose prefix is older than its name. The text is the accessible name — no `aria-label`, which
            would put daemon-authored text into an attribute (CLAUDE.md's outright prohibition). */}
        <div className="rename-conversation__actions">
          <button
            type="button"
            className="rename-conversation__archive"
            disabled={!available}
            onClick={onArchive}
          >
            {EDIT_CHAT_COPY.archive}
          </button>
        </div>
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
