import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'

// #360: the Rename dialog — the UI half of #154 (Figma 19:14). A near-clone of the Save-as-channel
// dialog (#274, SaveAsChannelDialog.tsx): the same overlay / scrim / panel chrome and Name field,
// differing only in the title ("Rename"), the field being PREFILLED with the row's current name (seeded
// by the container from titleFor(row.name)), and dispatching the already-shipped `renameConversation`
// command (#359) instead of `promoteConversation`. It collects input and dispatches only — it never
// mutates the list; the renamed row's title lands via #275's `conversation_updated` list re-request (AC4).
// No keys, sockets, or raw bytes here — a fire-and-forget command through the preload bridge.
//
// Two exports, both pure and SSR-testable: the view (props in, markup out) and the dispatch helper (the
// requestPromoteConversation twin minus `cwd`). The open → dispatch wiring lives in the ChannelList
// container (window.pyry dereferenced only at interaction time).

// A stable id tying the dialog's aria-labelledby to its title element (the SAVE_AS_CHANNEL_TITLE_ID
// idiom). A single fixed id is safe: only one Rename dialog is open at a time.
const RENAME_CONVERSATION_TITLE_ID = 'rename-conversation-title'

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state, seeded with the
 * row's current title); the three effects are REQUIRED injected props (the "a view that cannot act is a
 * bug" rule). Save is disabled while the name is blank — empty OR whitespace-only (AC2) — computed inline
 * so the disabled/enabled state is directly assertable in server-rendered markup (a disabled button
 * renders `disabled=""`, an enabled one omits the attribute). The `name` renders as an auto-escaped input
 * value (never dangerouslySetInnerHTML), so the untrusted daemon-derived title is inert (AC5).
 */
export function RenameConversationDialogView({
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
  const blank = name.trim() === ''
  return (
    <div className="rename-conversation-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the save-as-channel-overlay__scrim idiom. */}
      <div className="rename-conversation-overlay__scrim" aria-hidden="true" />
      <div
        className="rename-conversation"
        role="dialog"
        aria-modal="true"
        aria-labelledby={RENAME_CONVERSATION_TITLE_ID}
      >
        <h2 id={RENAME_CONVERSATION_TITLE_ID} className="rename-conversation__title">
          Rename
        </h2>
        {/* The Figma outlined Name field (19:16), prefilled with the current name. The wrapping <label>
            gives the input its accessible name from the "Name" text — no id/htmlFor pair needed. */}
        <label className="rename-conversation__field">
          <span className="rename-conversation__label">Name</span>
          <input
            type="text"
            className="rename-conversation__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        {/* The action row (Figma 19:19): Cancel + Save both right-aligned (justify-end in the node). */}
        <div className="rename-conversation__actions">
          <button type="button" className="rename-conversation__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rename-conversation__save"
            onClick={onSave}
            disabled={blank}
          >
            Save
          </button>
        </div>
      </div>
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
 * contract; #820). The view disables Save on a blank name, so this is never reached with one — no
 * redundant guard here (trimming is the only job). Fire-and-forget, like the composer's send: `sendCommand`
 * is `void`.
 */
export function requestRenameConversation(
  sendCommand: (command: RendererCommand) => void,
  row: ConversationSummary,
  name: string
): void {
  sendCommand({
    type: 'renameConversation',
    payload: { conversation_id: row.id, name: name.trim() }
  })
}
