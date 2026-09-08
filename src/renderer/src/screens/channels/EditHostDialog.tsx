import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import { mapHostLabel } from '../../store/hostLabelLoader'
import type { HostLabelValue } from '../../store/hostLabelStore'

// #1299: the Edit host dialog — what the host row's hover pen opens, and the pen's FIRST caller. `HostRow`
// has drawn that pen behind an optional `onEditHost` since #1185 and `channels.css` has carried its
// geometry and the `:has()` dot-swap guard just as long, but nothing passed the handler, so until this
// ticket the pen was not drawn in the running app at all.
//
// A near-clone of `EditWorkspaceDialogView` (#1180), itself a clone of the Rename dialog (#360): the same
// overlay / scrim / panel chrome and Name field, differing in the title ("Edit host"), the absence of the
// path line (the server id and relay URL are #1300's), and a round-trip status the sibling has no use for.
//
// No Figma node draws it. Verified 2026-09-08 and already recorded in `EditWorkspaceDialog.tsx`'s header:
// the Desktop page's Dialogs section holds Rename (102:498), Save as Channel, Create Folder and Paste Code
// only, and the ticket pins this dialog's chrome to the Rename one's. So the markup below is
// `EditWorkspaceDialogView`'s, which already mirrors that node declaration for declaration, minus its one
// added element.
//
// ⭐ THE WRITE REACHES NO DAEMON. `window.pyry.setHostLabelFor` (#1186) is a keyed IPC write to the
// background process's at-rest store; `sendCommand` is not a parameter of anything in this module and no
// wire type, command or bridge method is added. That is why this dialog awaits a PROMISE where
// `requestRenameWorkspace` fires and forgets: there is no correlated daemon reply to wait for, only main's
// own answer, and that answer describes the label as it is held AFTER the write.
//
// TWO exports, both pure and unit-testable without a DOM: the view (props in, markup out) and the write
// helper (injected transport, no `window` dereference). They live TOGETHER here, the sibling's ruling for
// the same reason — this verb has exactly one sender and no shipped twin to sit beside. The open → write
// wiring lives in the ChannelList container (`window.pyry` dereferenced only at interaction time).
//
// NO Escape handler and no scrim `onClick`, matching `RenameConversationDialogView` and
// `EditWorkspaceDialogView` exactly — the ticket pins this dialog's close behaviour to the Rename one's,
// and today that is Cancel alone. Matching therefore means adding NOTHING, which also keeps a sixth
// unconditional `document` listener off a window that already has several.
//
// SINKS. The label is untrusted text off disk, and it reaches exactly one place here: the controlled
// input's `value`, which React auto-escapes, so `<` and `>` never open a tag. It is the field's own content
// rather than metadata about it, and it is the sink `EditWorkspaceDialogView` and
// `RenameConversationDialogView` already ship for exactly this. `HostRow`'s four declines are re-derived
// rather than inherited and hold here in full — no `title`, no `aria-label`, no id / key / lookup path
// built from it, no class-name interpolation, no log line.

// A stable id tying the dialog's aria-labelledby to its title element (the EDIT_WORKSPACE_TITLE_ID idiom).
// A single FIXED id, never one derived from the server id: only one Edit host dialog is open at a time
// (the modal overlay guarantees it), and deriving the id — the obvious way to support two — would
// interpolate untrusted text into an `id` and an `aria-labelledby` attribute.
const EDIT_HOST_TITLE_ID = 'edit-host-title'

/**
 * Client-owned failure copy (AC3) — apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27;
 * (the standing desktop lesson). It interpolates NEITHER the label NOR the server id, and no main-side
 * text can reach it even by accident: `HostLabelResult`'s `error` arm is value-free by construction (no
 * reason field, no message), which is that contract's own decision precisely so a coarse category cannot
 * leak backend detail. A single generic message the user reads then retries against.
 */
const EDIT_HOST_ERROR_COPY = 'Could not save that name'

/**
 * The dialog's round-trip state, held by the container. Three arms rather than a boolean pair, so
 * "in flight" and "failed" cannot both be true and neither can be lost: `idle` is the created-in state,
 * `saving` spans the invoke, and `failed` is where a write that answered `error` — or answered nothing
 * recognisable — leaves it. There is no `succeeded` arm because a successful write CLOSES the dialog.
 */
export type EditHostSaveStatus = 'idle' | 'saving' | 'failed'

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state, seeded on open with
 * the row's STORED label — `hostRowEditSeed`, not the word the row displays); `status` is the injected
 * round-trip state. The three effects are REQUIRED injected props (the "a view that cannot act is a bug"
 * rule).
 *
 * SAVE IS REFUSED ON EXACTLY ONE CONDITION BEYOND THE ROUND TRIP: a trimmed name longer than
 * MAX_HOST_LABEL_LENGTH. It is NOT refused on blank, which is where this parts company with
 * `EditWorkspaceDialogView` — a blank name is a valid answer here as it is at pairing, meaning "no label",
 * and main clears that server's entry rather than storing an empty name. The workspace dialog refuses blank
 * because a workspace has a folder name to fall back to; a host has only the generic word, which is exactly
 * what "no label" should show. The bound is measured on the TRIMMED name, which is what the write sends, so
 * surrounding whitespace can never push an otherwise-legal name over it; and it is the IMPORTED constant,
 * never a restated 128 — `PairingScreen` and its test already make that call for the same constant.
 *
 * Both refusals are computed inline so the disabled/enabled state is directly assertable in server-rendered
 * markup (a disabled button renders `disabled=""`, an enabled one omits the attribute).
 *
 * CANCEL IS NEVER DISABLED, IN ANY STATUS, and that is load-bearing rather than copied from the sibling:
 * `ipcRenderer.invoke` carries no timeout, so a main side that never answers would otherwise leave this
 * dialog frozen with a disabled Save, a frozen field and no exit at all.
 *
 * NO `autoFocus`, the sibling's ruling for its reason: that dialog's field opens seeded, this one's does
 * too, and stealing focus into a prefilled field invites an accidental overwrite of the very name the user
 * came to read.
 */
export function EditHostDialogView({
  name,
  status,
  onNameChange,
  onCancel,
  onSave
}: {
  name: string
  status: EditHostSaveStatus
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const busy = status === 'saving'
  const refused = busy || name.trim().length > MAX_HOST_LABEL_LENGTH
  return (
    <div className="edit-host-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the edit-workspace-overlay__scrim idiom. */}
      <div className="edit-host-overlay__scrim" aria-hidden="true" />
      <div
        className="edit-host"
        role="dialog"
        aria-modal="true"
        aria-labelledby={EDIT_HOST_TITLE_ID}
      >
        <h2 id={EDIT_HOST_TITLE_ID} className="edit-host__title">
          Edit host
        </h2>
        {/* The Figma outlined Name field (the Rename dialog's 102:500), opening SEEDED — this is an edit,
            so the machine's current name is what the user is changing, and it opens EMPTY when nothing is
            stored. The wrapping <label> gives the input its accessible name from the "Name" text, so no
            id/htmlFor pair is needed.

            The seeded value is untrusted text off disk and this is its one and only sink here: a
            controlled input's `value`, which React auto-escapes. Frozen while the write is in flight, so
            the field cannot drift from the value the outstanding write carries. */}
        <label className="edit-host__field">
          <span className="edit-host__label">Name</span>
          <input
            type="text"
            className="edit-host__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={busy}
          />
        </label>
        {/* The failure line (AC3) — spec-added, not in the Figma, the `save-as-channel__error` idiom.
            Rendered ONLY when the write failed; `idle` and `saving` render none. */}
        {status === 'failed' && <p className="edit-host__error">{EDIT_HOST_ERROR_COPY}</p>}
        {/* The action row (the Rename dialog's 19:19): Cancel + Save both right-aligned (justify-end in
            the node). It leaves room for a third action without a rebuild — #1061 recorded the host row as
            unpair's likely home, and it returns in its own ticket if it is wanted here. */}
        <div className="edit-host__actions">
          <button type="button" className="edit-host__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="edit-host__save"
            onClick={onSave}
            disabled={refused}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Write one machine's label and answer WHAT THE CONTAINER SHOULD DO — the store value to record, or `null`
 * meaning "keep the dialog open and move no row". The transport is injected (`window.pyry.setHostLabelFor`
 * in production), so this whole path unit-tests with a plain spy and dereferences no `window`.
 *
 * The name is TRIMMED before it goes out, matching what the pairing path sends (`hostLabelToSend`) and what
 * the view measured its bound against. Main trims again and treats a label blank after trimming as the
 * request to CLEAR that server's entry — so a blank field is not refused anywhere, it is the way back to
 * the generic word.
 *
 * ⭐ THE ARMS ARE TESTED POSITIVELY AND THE CONSERVATIVE OUTCOME IS THE UNCONDITIONAL FALLTHROUGH — the
 * shape `mapHostLabel` itself uses, and the reason is not style. Written the other way, as a negative
 * `if (res.status === 'error') return null`, a structurally invalid response (a future arm, a buggy
 * handler, a hostile invoke result) would fall through to the mapper, collapse to `{ status: 'error' }`,
 * land in the store and SILENTLY reset that row to the generic word — a row moved by an answer nobody
 * understood. Written this way an unrecognised arm keeps the dialog open and the row untouched, which is
 * what AC3 asks for on `error` and the only safe reading of "unknown".
 *
 * `error` itself is deliberately NOT written into the store either, and that is the difference from
 * `loadHostLabelFor`, which does write it. A failed READ genuinely means "this machine's label is
 * unreadable" and the row should say so by falling back; a failed WRITE means the label is whatever it was
 * before, so writing `error` would invent a state change out of a refusal and change a row the user was
 * told nothing happened to.
 *
 * The returned promise ALWAYS resolves; it never rejects into the caller, so a late main-side failure
 * cannot surface as an unhandled rejection in React. A rejection means the handler is absent or the main
 * process died mid-write, which is the same "keep the dialog open" outcome. The caught object is dropped
 * unread — never logged, interpolated or stored — matching the classify-don't-forward discipline one layer
 * down. Nothing on this path logs at all: any useful line would carry the label, which is operator content,
 * or the server id, and neither belongs in a log (ADR 0007, CLAUDE.md).
 *
 * NOTE THE NAME COLLISION while reading this: the injected `setLabelFor` is the BRIDGE method
 * `window.pyry.setHostLabelFor`, and the store action the container writes the result through is a
 * different function that happens to share a name.
 */
export function requestSetHostLabel(
  setLabelFor: (serverId: string, label: string) => Promise<HostLabelResult>,
  serverId: string,
  name: string
): Promise<HostLabelValue | null> {
  return setLabelFor(serverId, name.trim())
    .then((res) =>
      res.status === 'stored' || res.status === 'not-stored' ? mapHostLabel(res) : null
    )
    .catch(() => null)
}
