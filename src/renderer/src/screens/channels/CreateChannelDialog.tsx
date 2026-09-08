// #1179: the Create-channel dialog — what the Channels tree's workspace plus opens. A near-clone of the
// Rename dialog (#360, RenameConversationDialog.tsx): the same overlay / scrim / panel chrome and Name
// field, differing in the title ("Create channel"), the field opening EMPTY rather than prefilled, and
// the second action reading "Create" — which is the pair the Create-folder dialog (#398) already draws.
// Verified against the Figma on 2026-09-08: the Desktop page's Dialogs section holds no Create-channel
// drawing, and its Rename (102:498) and Create Folder (102:528) nodes are byte-identical in chrome, so
// cloning one and taking the other's action pair reproduces what a drawing of this dialog would be.
//
// It collects input and dispatches only — it never mutates the list. The created channel's row arrives
// through the daemon's `conversationCreated` confirmation, which `useConversationCreatedNav` in
// PairedShell already turns into the navigation that opens its thread. No keys, sockets, or raw bytes
// here — a fire-and-forget command through the preload bridge.
//
// ONE export, the pure view: props in, markup out, server-renderable, no store, no `window.pyry`, no
// effects. The dispatch helper is NOT here — it lives beside its twin `requestNewConversation` in
// `conversationCreatedBridge.ts`, because the two are the two fixed payload shapes of ONE command and
// reading them side by side is what makes "two callers, no flag" legible. The open → dispatch wiring
// lives in the ChannelList container (`window.pyry` dereferenced only at interaction time).
//
// THE `cwd` IS NOT A PROP, deliberately. The workspace is fixed by the row whose plus was clicked and
// the container closes over it, so no attribute of the overlay, panel, field, input or either action
// can derive from that daemon-asserted path — not by accident and not by a future edit. It is the
// strongest available form of AC2's "no attribute carries the workspace label or the cwd": passing one
// is a type error rather than a review finding.

// A stable id tying the dialog's aria-labelledby to its title element (the RENAME_CONVERSATION_TITLE_ID
// idiom). A single fixed id is safe: only one Create-channel dialog is open at a time.
const CREATE_CHANNEL_TITLE_ID = 'create-channel-title'

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state, seeded empty on
 * open); the three effects are REQUIRED injected props (the "a view that cannot act is a bug" rule).
 * Create is disabled while the name is blank — empty OR whitespace-only (AC2) — computed inline so the
 * disabled/enabled state is directly assertable in server-rendered markup (a disabled button renders
 * `disabled=""`, an enabled one omits the attribute). The `name` renders as an auto-escaped input value
 * (never dangerouslySetInnerHTML), so it stays inert text in every state.
 *
 * NO Escape handler and no scrim `onClick`, matching `RenameConversationDialogView` exactly — the
 * ticket pins this dialog's close behaviour to whatever that one supports today, and today that is
 * Cancel alone. A first Escape claimant here would also add a fifth unconditional `document` listener
 * to a window that already has several, which is its own ticket rather than this one's side effect.
 */
export function CreateChannelDialogView({
  name,
  onNameChange,
  onCancel,
  onCreate
}: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onCreate: () => void
}): JSX.Element {
  const blank = name.trim() === ''
  return (
    <div className="create-channel-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the rename-conversation-overlay__scrim
          idiom. */}
      <div className="create-channel-overlay__scrim" aria-hidden="true" />
      <div
        className="create-channel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={CREATE_CHANNEL_TITLE_ID}
      >
        <h2 id={CREATE_CHANNEL_TITLE_ID} className="create-channel__title">
          Create channel
        </h2>
        {/* The Figma outlined Name field (the Rename dialog's 102:500), opening EMPTY — there is no
            current name to seed from, this being a create. The wrapping <label> gives the input its
            accessible name from the "Name" text, so no id/htmlFor pair is needed.

            ONE field and no location choice: the workspace is fixed by the row whose plus was clicked.
            That is the deliberate difference from the Save-as-channel dialog, which keeps its location
            radios because it serves the promote-a-chat case, where the chat's own folder is an option.

            `autoFocus` is what makes AC2's "empty and FOCUSED" true, and it is one attribute rather
            than a ref plus a mount effect: React DOM focuses the element on mount, and React's server
            renderer emits `autofocus=""`, so the same declaration is assertable in the static tier
            instead of being visible to e2e alone. */}
        <label className="create-channel__field">
          <span className="create-channel__label">Name</span>
          <input
            type="text"
            className="create-channel__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
          />
        </label>
        {/* The action row (the Create-folder dialog's 102:533): Cancel + Create both right-aligned
            (justify-end in the node). Cancel is never disabled — it closes and sends nothing in every
            state. */}
        <div className="create-channel__actions">
          <button type="button" className="create-channel__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="create-channel__create"
            onClick={onCreate}
            disabled={blank}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
