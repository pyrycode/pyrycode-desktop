import type { RendererCommand } from '@shared/ipc/commands'
import type { ConversationSummary } from '@shared/wire/types'

// #274: the Save-as-channel dialog — the naming half of Figma 19:24. Collects a name for a Recent
// (unpromoted) discussion and dispatches the already-shipped `promoteConversation` command (#273),
// keeping the discussion in its current workspace (its existing `cwd` — the "keep in scratch" seam;
// the location-choice radios in 19:24 are #288). It collects input and dispatches only — it never
// mutates the list; the row moving Recent → Channels is #275's job (the `conversation_updated`
// re-request). No keys, sockets, or raw bytes here — a fire-and-forget command through the preload bridge.
//
// Two exports, both pure and SSR-testable: the view (props in, markup out — mirrors PermissionModalView's
// overlay+scrim+panel chrome) and the dispatch helper (the requestNewConversation twin). The click →
// dispatch wiring lives in the ChannelList container (window.pyry dereferenced only at interaction time).

// A stable id tying the dialog's aria-labelledby to its title element (the PERMISSION_MODAL_TITLE_ID
// idiom). A single fixed id is safe: only one Save-as-channel dialog is open at a time.
const SAVE_AS_CHANNEL_TITLE_ID = 'save-as-channel-title'

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state); the three
 * effects are REQUIRED injected props (the RepairPrompt / PermissionModalView "a view that cannot act is
 * a bug" rule). Save is disabled while the name is blank — empty OR whitespace-only (AC3) — computed
 * inline so the disabled/enabled state is directly assertable in server-rendered markup (a disabled
 * button renders `disabled=""`, an enabled one omits the attribute). The `name` renders as an
 * auto-escaped input value (never dangerouslySetInnerHTML), so an untrusted daemon-derived title is inert.
 */
export function SaveAsChannelDialogView({
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
    <div className="save-as-channel-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the permission-modal-overlay__scrim idiom. */}
      <div className="save-as-channel-overlay__scrim" aria-hidden="true" />
      <div
        className="save-as-channel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SAVE_AS_CHANNEL_TITLE_ID}
      >
        <h2 id={SAVE_AS_CHANNEL_TITLE_ID} className="save-as-channel__title">
          Save as channel
        </h2>
        {/* The Figma outlined Name field (19:26). The wrapping <label> gives the input its accessible
            name from the "Name" text — no id/htmlFor pair needed. */}
        <label className="save-as-channel__field">
          <span className="save-as-channel__label">Name</span>
          <input
            type="text"
            className="save-as-channel__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        {/* The action row (Figma 19:39): Cancel + Save both right-aligned (justify-end in the node) —
            this dialog groups both trailing, unlike PermissionModal's leading-dismissive Cancel. */}
        <div className="save-as-channel__actions">
          <button type="button" className="save-as-channel__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="save-as-channel__save"
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
 * Fire the `promoteConversation` command (#273 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained, exactly
 * as `requestNewConversation` inlines its command. All three payload fields are REQUIRED strings (the
 * deliberate opposite of create's nullable fields): `conversation_id ← row.id`, `name ← name.trim()`
 * (a promoted channel should not carry accidental edge whitespace), `cwd ← row.cwd`. `row.cwd` is always
 * present (`ConversationSummary.cwd: string`), satisfying the required-string contract without a null
 * path; it is opaque display/routing text the renderer never resolves to a filesystem path. The view
 * disables Save on a blank name, so this is never reached with one — no redundant guard here (no observed
 * blank-submit path to defend). Fire-and-forget, like the composer's send: `sendCommand` is `void`.
 */
export function requestPromoteConversation(
  sendCommand: (command: RendererCommand) => void,
  row: ConversationSummary,
  name: string
): void {
  sendCommand({
    type: 'promoteConversation',
    payload: { conversation_id: row.id, name: name.trim(), cwd: row.cwd }
  })
}
