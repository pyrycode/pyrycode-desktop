import { MAX_HOST_LABEL_LENGTH } from '@shared/ipc/pairing'
import type { HostLabelResult } from '@shared/ipc/hostLabel'
import { Modal } from '../../components/Modal'
import { mapHostLabel } from '../../store/hostLabelLoader'
import type { HostLabelValue } from '../../store/hostLabelStore'
import type { ServerInfoValue } from '../../store/serverInfoStore'

// Modal owns the panel chrome; ChannelList owns the selected host, field and save state.
// Host identity and relay remain escaped display text; neither becomes navigation or metadata.
// The stored name reaches only the controlled input value. No host content is logged.
// Preserve the existing focus policy: no autofocus, Escape listener or backdrop dismissal.

/**
 * Client-owned failure copy (AC3) — apostrophe-free by design: renderToStaticMarkup escapes ' → &#x27;
 * (the standing desktop lesson). It interpolates NEITHER the label NOR the server id, and no main-side
 * text can reach it even by accident: `HostLabelResult`'s `error` arm is value-free by construction (no
 * reason field, no message), which is that contract's own decision precisely so a coarse category cannot
 * leak backend detail. A single generic message the user reads then retries against.
 */
const EDIT_HOST_ERROR_COPY = 'Could not save that name'

const EDIT_HOST_SERVER_ID_CAPTION = 'Server identity:'
const EDIT_HOST_RELAY_CAPTION = 'Relay address:'

/**
 * What a caption's value slot reads when the container's lookup MISSED — a reseed or an unpair can empty
 * the paired-server list while this dialog is open. Client-owned, naming neither value and carrying no
 * backend detail, `EDIT_HOST_ERROR_COPY`'s rule.
 *
 * It is a WORD rather than an empty slot, and the captions stay rather than the block being dropped.
 * Three properties, each asked for by name: not a crash (this is a rendered arm, not a dereference); not
 * a blank, which is indistinguishable from a real value that failed to arrive; and not a panel that
 * jumps. The dialog is NOT closed either — a miss has nothing to do with the rename being typed, and
 * closing would destroy it for an unrelated reason.
 */
const EDIT_HOST_DETAIL_UNAVAILABLE = 'Unavailable'

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
 * `server` IS ONE NULLABLE OBJECT, NOT TWO NULLABLE STRINGS, and that is a deliberate departure from the
 * ticket's own suggestion. `serverInfoStore`'s state docblock rejects `ServerInfoValue[] | null` because
 * it would add a distinction no consumer reads — "an unobservable impossible-state pair", the same
 * ceremony-without-benefit test that kept that store's mutation a setter. Two nullable strings here
 * reproduce exactly that pair: an id present with the relay absent is not a state the container's lookup
 * can produce, because the miss is ATOMIC — the entry is found whole or not at all. One prop makes the
 * impossible state unrepresentable rather than merely untested. The substance is unchanged: both values
 * arrive as props from the container and this view looks nothing up.
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
  server,
  onNameChange,
  onCancel,
  onSave
}: {
  name: string
  status: EditHostSaveStatus
  server: ServerInfoValue | null
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const busy = status === 'saving'
  const refused = busy || name.trim().length > MAX_HOST_LABEL_LENGTH
  return (
    <div className="edit-host-overlay">
      <div className="edit-host-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Edit host"
        width={646}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{ label: 'OK', onClick: onSave, disabled: refused }}
        onClose={onCancel}
      >
        <div className="edit-host__details">
          <p className="edit-host__detail">
            <span className="edit-host__detail-label">{EDIT_HOST_SERVER_ID_CAPTION}</span>
            <span className="edit-host__detail-value">
              {server === null ? EDIT_HOST_DETAIL_UNAVAILABLE : server.serverId}
            </span>
          </p>
          <p className="edit-host__detail">
            <span className="edit-host__detail-label">{EDIT_HOST_RELAY_CAPTION}</span>
            <span className="edit-host__detail-value">
              {server === null ? EDIT_HOST_DETAIL_UNAVAILABLE : server.relayUrl}
            </span>
          </p>
        </div>
        <label className="edit-host__field">
          <span className="edit-host__label">Host name:</span>
          <input
            type="text"
            className="edit-host__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            disabled={busy}
          />
        </label>
        {status === 'failed' && <p className="edit-host__error">{EDIT_HOST_ERROR_COPY}</p>}
      </Modal>
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
