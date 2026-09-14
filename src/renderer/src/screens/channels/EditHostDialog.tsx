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

/**
 * The unpair slot's copy (#1422) — `UNPAIR_COPY`'s idiom one surface over: client-owned module constants,
 * apostrophe-free (renderToStaticMarkup escapes ' → &#x27;), U+2026 ellipsis, and interpolating NEITHER
 * the label NOR the server id. The prompt says "this host" rather than naming one, for the reason the
 * Settings row states: the server id is daemon-authored text that may be rendered escaped as its own
 * line, but never folded into copy the app speaks in its own voice (CLAUDE.md's operator ruling,
 * 2026-08-20). The noun is HOST, not "server" — this surface's own vocabulary, and the one word that
 * differs from the Settings row's otherwise identical prompt.
 *
 * `failure` is a SECOND copy constant beside `EDIT_HOST_ERROR_COPY` rather than a widening of it, and the
 * two are rendered in the same message slot on mutually exclusive arms. No main-side text can reach it:
 * `UnpairResult` is value-free by construction — the type has nowhere to put a token, a relay URL or an
 * error detail — so a coarse category cannot leak backend detail even by accident.
 */
const UNPAIR_HOST_COPY = {
  unpair: 'Unpair host',
  prompt: 'Forget this host?',
  cancel: 'Cancel',
  confirm: 'Confirm',
  busy: 'Forgetting…',
  failure: 'Could not unpair this host'
} as const

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
 *
 * ⭐ #1422 ADDS THE UNPAIR SLOT'S THREE ARMS TO THIS ONE UNION rather than giving the dialog a second,
 * sibling phase cell, and the widening is what renamed it from `EditHostSaveStatus`. The ticket allowed
 * either shape but required that "saving" and "unpairing" never both be true; with one union there is no
 * second slot for the other to live in, so that invariant is UNREPRESENTABLE rather than maintained by a
 * reset — `UnpairPhase`'s own argument for holding one armed id for the whole Settings list. A type still
 * called `SaveStatus` while holding `unpairing` would be exactly the drift this rename avoids.
 *
 * The stated consequence rather than a hidden one: arming the confirm after a failed rename drops the
 * rename failure line, and cancelling the confirm lands on `idle` rather than restoring it. AC2 asks only
 * that Cancel return the slot to the idle button; the alternative — two cells that can disagree — costs
 * the invariant above, which is the more valuable of the two properties.
 */
export type EditHostStatus =
  | 'idle'
  | 'saving'
  | 'failed'
  | 'confirming-unpair'
  | 'unpairing'
  | 'unpair-failed'

/**
 * The unpair slot's three injected effects (#1422). REQUIRED, not optional, and grouped into one object
 * rather than spread across the view's prop list: `ServerRowUnpair`'s rule — a view that cannot act is a
 * bug, so forgetting to wire the action is a compile error rather than a dialog with an inert button.
 *
 * NULLARY, where `ServerRowUnpair`'s members take the row's own serverId. That difference is the shape of
 * the two surfaces, not an oversight: the Settings list renders N rows against one armed id and must name
 * which row's Unpair was clicked, whereas this dialog is open against exactly ONE host, whose id the
 * container already holds in `editHostServerId`. There is no second host here for an answer to land on,
 * so a parameter would be a value the caller reads straight back out of its own state.
 */
export interface EditHostUnpair {
  onArm: () => void
  onCancel: () => void
  onConfirm: () => void
}

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
  onSave,
  unpair
}: {
  name: string
  status: EditHostStatus
  server: ServerInfoValue | null
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
  unpair: EditHostUnpair
}): JSX.Element {
  // #1422 widened `busy` from one arm to two, and that one line is the whole of AC4's freeze on the
  // rename half: an erase in flight disables the Host name field and OK exactly as a save in flight does,
  // because both are round trips this dialog is waiting on and neither may be raced by the other.
  const busy = status === 'saving' || status === 'unpairing'
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
        <UnpairSlot status={status} unpair={unpair} />
        {/* ONE message slot, two mutually exclusive arms (#1422). The union above is what makes them
            exclusive by construction, so neither a stacked pair nor a lost message is representable. */}
        {status === 'failed' && <p className="edit-host__error">{EDIT_HOST_ERROR_COPY}</p>}
        {status === 'unpair-failed' && (
          <p className="edit-host__error">{UNPAIR_HOST_COPY.failure}</p>
        )}
      </Modal>
    </div>
  )
}

/**
 * The content area's unpair affordance (#1422) — an inline, non-exported control mirroring the Settings
 * row's `UnpairAction` posture. Pure: it renders the arm it is given and reports intents; it owns no
 * state and performs no effect.
 *
 * THE PATTERN IS SHARED, THE MARKUP IS NOT. Nothing here imports `ServerRowControl`'s component or its
 * CSS, and no class name is shared with it or with the workspace and conversation dialogs — the Edit host
 * dialog knowledge page records the Playwright-locator reason. What IS reused is the two-phase shape
 * itself: idle offers the verb, confirming asks and offers both answers, in flight disables both so a
 * double-click cannot launch a second erase. That last one is belt-and-suspenders with a different fabric
 * on each side — the disable is UI, and `clearServer` is idempotent and matches by key in main, so a
 * second erase could not reach a different record even if one got through.
 *
 * ⭐ THE IDLE VERB IS DISABLED WHILE A RENAME IS IN FLIGHT, and that one attribute is what makes the
 * status union's invariant true of the two ROUND TRIPS and not merely of the cell. One union means
 * `saving` and `unpairing` cannot both be the value; it does NOT by itself mean both invokes cannot be
 * outstanding at once. Without this: OK → `saving` freezes the field and OK, then arming moves the cell to
 * `confirming-unpair`, which UNFREEZES them while the rename invoke is still open — a second write can be
 * launched, and the save's own resolution then lands on an arm that is no longer its own. Disabling the
 * verb closes that at the source: a rename in flight admits no arm, and an erase in flight already
 * disables the field and OK through `busy`, so at most one of the two can ever be launched.
 *
 * `unpair-failed` renders the IDLE arm, which is AC4's wording read literally: the slot returns to the
 * button and the failure line appears beneath the field, so the button is its own retry. The Figma draws
 * only this idle state (the confirming one is undrawn by design), and the button matches the footer
 * Cancel's outlined tokens.
 *
 * Every button's TEXT is its accessible name; none carries an aria-label. Naming the host in one would
 * put operator-authored text into an attribute, which CLAUDE.md forbids outright — `UnpairAction`'s own
 * ruling, and the reason the two Cancels here are told apart by class rather than by an accessible name.
 */
function UnpairSlot({
  status,
  unpair
}: {
  status: EditHostStatus
  unpair: EditHostUnpair
}): JSX.Element {
  if (status !== 'confirming-unpair' && status !== 'unpairing') {
    return (
      <div className="edit-host__actions">
        <button
          type="button"
          className="edit-host__unpair"
          onClick={unpair.onArm}
          disabled={status === 'saving'}
        >
          {UNPAIR_HOST_COPY.unpair}
        </button>
      </div>
    )
  }

  const busy = status === 'unpairing'
  return (
    <div className="edit-host__actions">
      <span className="edit-host__unpair-prompt">{UNPAIR_HOST_COPY.prompt}</span>
      <button
        type="button"
        className="edit-host__unpair"
        onClick={unpair.onCancel}
        disabled={busy}
      >
        {UNPAIR_HOST_COPY.cancel}
      </button>
      <button
        type="button"
        className="edit-host__unpair edit-host__unpair--confirm"
        onClick={unpair.onConfirm}
        disabled={busy}
      >
        {busy ? UNPAIR_HOST_COPY.busy : UNPAIR_HOST_COPY.confirm}
      </button>
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

/**
 * The injected effects behind the dialog's unpair slot (#1422).
 *
 * `unpair` is bound in the container to `runUnpairServer` with the deps the Settings row builds — erase →
 * refresh → route-or-clear — so it arrives here as the already-classified `'ok' | 'error'`.
 */
export interface EditHostUnpairDeps {
  unpair: () => Promise<'ok' | 'error'>
  setStatus: (status: EditHostStatus) => void
  close: () => void
}

/**
 * Map a confirmed unpair's outcome onto THIS DIALOG's two cells, and nothing else.
 *
 * ⭐ NOT A SECOND DECISION HELPER, and the distinction is the point. Erase → refresh → route-or-clear
 * lives entirely in `runUnpairServer`, which the injected `unpair` calls; that helper holds the post-erase
 * list, owns the "do any records remain?" branch, and carries the fail-safe rule that nothing downstream
 * of the erase runs on anything but `result: 'ok'`. This function adds no branch to any of it. What it
 * owns is the part the Settings row has no equivalent of — a dialog that must close on success and stay
 * open on failure — and the ORDERING that AC4's freeze depends on.
 *
 * It is extracted from the container rather than written inline as an arrow because that is the only way
 * this decision is testable at all: `ChannelList` opens this dialog off `editHostServerId`, which is
 * `null` in every static render, so the whole branch is unreachable under `renderToStaticMarkup` and
 * `ChannelList.test.tsx` cannot reach it (`EditHostDialog.test.tsx`'s own header records that fact). Here
 * it is an ordinary plain-spy test, which is `runUnpairServer`'s own posture one layer down.
 *
 * THE IN-FLIGHT MARK IS SET BEFORE THE AWAIT, which is the whole of AC4's freeze: set afterwards, the
 * field, OK and both answers would stay live for the length of the round trip and a second confirm could
 * land on a record already being erased.
 *
 * ON `'ok'` IT CLOSES AND WRITES NO FURTHER STATUS. When the departed host was the last one, `PairedShell`
 * unmounts with the route flip and takes this dialog with it, so a trailing write would land on nothing;
 * a setState after unmount is a harmless React 18 no-op regardless (`ServerRowControl`'s posture). On
 * `'error'` it does NOT close: the slot returns to its idle button, the field and OK re-enable, and the
 * failure line appears, so the operator's retry is the button they are already looking at.
 *
 * WHICH host is erased is fixed by the CONTAINER, before this is called — see the call site. Nothing here
 * takes or reads a server id, so there is no name in this module by which a late answer could be steered
 * onto another host. Nothing is logged, the posture `runUnpairServer` and `requestSetHostLabel` both
 * hold: any useful line would carry the server id or the label, which ADR 0007's content-free rule
 * forbids, and there is no observed failure to instrument.
 */
export async function runEditHostUnpair(deps: EditHostUnpairDeps): Promise<void> {
  deps.setStatus('unpairing')
  if ((await deps.unpair()) === 'ok') {
    deps.close()
    return
  }
  deps.setStatus('unpair-failed')
}
