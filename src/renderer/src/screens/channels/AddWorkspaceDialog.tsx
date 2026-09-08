import { useEffect, useRef, useState } from 'react'
import {
  requestNewWorkspaceChat,
  subscribeConversationCreated,
  subscribeConversationCreateRejected
} from '../../store/conversationCreatedBridge'

// #1308: the Add workspace dialog — what the HOST row's hover plus opens, and that plus's FIRST caller.
// `HostRow` has drawn it behind an optional `onAddWorkspace` since #1185 and `channels.css` has carried its
// geometry and the `:has()` dot-swap guard just as long, but nothing passed the handler, so until this
// ticket the plus was not drawn in the running app at all.
//
// A near-clone of `CreateChannelDialogView` (#1179) with a round trip added — which makes `EditHostDialog`
// the closer relative for everything below the field: a three-arm status, a frozen field while the answer
// is outstanding, a client-owned failure line and a Cancel that is never disabled. Both descend from the
// Rename dialog (#360, Figma 102:498), whose chrome the Desktop page's Dialogs section is the only drawing
// of; read back again on 2026-09-08 (a dark rounded panel, a left-aligned title, one outlined field with a
// caption over its value, two right-aligned text actions) and per the ticket's stated assumption the title
// is "Add workspace", the field "Folder path on the host" and the confirm "Start chat".
//
// WHAT IT DOES is #1178's workspace-row plus ONE LEVEL UP with a folder field in front of it: the same
// `createConversation` with `is_promoted: false, name: null`, the folder typed by the operator instead of
// taken from a group key, and the clicked row's machine as the command's routing key. No client-side list
// of workspaces exists or is wanted — both sidebar trees are derived from the conversation list, so the
// folder appears with its first chat (`partitionActive`) and leaves when its last conversation is archived.
//
// THREE exports: the status union, the pure view, and the container that drives it. The container lives
// HERE rather than in `ChannelList`, the `SaveAsChannelDialog` shape — this dialog's round trip is its
// whole substance, and separating them would put the state one import away from the markup it is about.
// The dispatch and subscribe helpers are NOT here: they live beside their two shipped siblings in
// `conversationCreatedBridge.ts`, because reading the three fixed create payloads side by side is what
// makes "three callers, no flag" legible (that file's stated rule, applied by its third caller).
//
// SINKS. The typed path is OPERATOR input bound for the wire, and it reaches exactly one place: the
// controlled input's `value`, which React auto-escapes, so `<` and `>` never open a tag. `HostRow`'s four
// declines are re-derived rather than inherited and hold here in full — no `title`, no `aria-label` built
// from the text, no id / key / lookup path / class-name interpolation, and no log line. Nothing on this
// path logs at all: any useful line would carry the folder the operator typed, which ADR 0007's
// content-free rule and CLAUDE.md both forbid.
//
// ⭐ NOTHING COMES BACK. `conversationCreateRejected` (#1307) is nullary by construction — no daemon byte,
// code, message or path crosses IPC on the failure path — so the failure line below cannot interpolate
// daemon text even by a future edit: there is none in the renderer to interpolate.
//
// NO Escape handler and no scrim `onClick`, matching `RenameConversationDialogView`,
// `CreateChannelDialogView` and `EditHostDialogView` exactly — the ticket pins this dialog's close
// behaviour to the Rename one's, and today that is Cancel alone. Matching therefore means adding NOTHING,
// which also keeps a further unconditional `document` listener off a window that already has several.

// A stable id tying the dialog's aria-labelledby to its title element (the EDIT_HOST_TITLE_ID idiom). A
// single FIXED id, never one derived from the server id or the typed path: only one Add workspace dialog is
// open at a time (the modal overlay guarantees it), and deriving the id — the obvious way to support two —
// would interpolate untrusted text into an `id` and an `aria-labelledby` attribute.
const ADD_WORKSPACE_TITLE_ID = 'add-workspace-title'

/**
 * The field's caption (AC1) and the confirm's label. Client-owned module constants in the
 * EDIT_HOST_SERVER_ID_CAPTION idiom, apostrophe-free by design (renderToStaticMarkup escapes ' → &#x27;,
 * the standing desktop lesson).
 *
 * The caption says "on the host" rather than just "Folder path" because this dialog is reached from a
 * MACHINE's row and the path is resolved on that machine, never locally — the one thing a reader could
 * otherwise get wrong here. WHICH machine is not named in it: the row that was clicked is the only answer,
 * and interpolating the host label would put untrusted operator text into this dialog's copy for no gain.
 */
const ADD_WORKSPACE_FIELD_LABEL = 'Folder path on the host'
const ADD_WORKSPACE_ACTION_LABEL = 'Start chat'

/**
 * Client-owned failure copy (AC3), apostrophe-free by design. It interpolates neither the typed path nor
 * any daemon text, and — unlike `EDIT_HOST_ERROR_COPY`, which relies on `HostLabelResult`'s error arm being
 * value-free — it CANNOT: the rejection event carries no fields at all, so there is nothing in the renderer
 * to leak. A single generic message the user reads, then retries or cancels against.
 */
const ADD_WORKSPACE_ERROR_COPY = 'Could not start a chat in that folder'

/**
 * The dialog's round-trip state, held by the container. Three arms rather than a boolean pair, the
 * `EditHostSaveStatus` ruling for its stated reason: "in flight" and "failed" cannot both be true and
 * neither can be lost. `idle` is the created-in state, `creating` spans the wait for the daemon's answer,
 * and `rejected` is where a correlated refusal leaves it. There is no `succeeded` arm because a confirmed
 * create CLOSES the dialog.
 */
export type AddWorkspaceStatus = 'idle' | 'creating' | 'rejected'

/**
 * THE ONE CLIENT RULE, and it is a rule rather than a validator: the path must be absolute.
 *
 * It exists to keep the sidebar's group keys canonical — `~/foo` and `/home/x/foo` name one folder and
 * would draw two groups, since the daemon expands a leading `~` when it mints the session but records the
 * `cwd` as typed. Everything else about the folder is the daemon's to police: it confines the path to its
 * own home and refuses one that escapes or does not exist, with a non-retryable error whose static message
 * never echoes the path.
 *
 * `''.startsWith('/')` is `false`, so this ONE test also covers AC2's blank case — no second predicate, no
 * per-case message, and nothing here rewrites what the user typed. The trim decides WHETHER the action is
 * offered and never WHAT is shown or sent: the dispatch trims the same way, so the two cannot disagree.
 */
function isAbsolutePath(path: string): boolean {
  return path.trim().startsWith('/')
}

/**
 * The pure dialog chrome. `path` is the controlled field value (container-owned state, seeded EMPTY on
 * every open — this creates a workspace, so there is nothing to seed from); `status` is the injected
 * round-trip state. The three effects are REQUIRED injected props (the "a view that cannot act is a bug"
 * rule).
 *
 * NO `serverId` PROP, deliberately, and the same call `CreateChannelDialogView` made about its `cwd`. The
 * machine is fixed by the row whose plus was clicked and the container closes over it, so no attribute of
 * the overlay, panel, field or either action can derive from it — not by accident and not by a future edit.
 * Passing one is a type error rather than a review finding.
 *
 * Start chat is refused while the create is in flight OR while the trimmed path is not absolute; both
 * refusals are computed inline so the disabled/enabled state is directly assertable in server-rendered
 * markup (a disabled button renders `disabled=""`, an enabled one omits the attribute).
 *
 * CANCEL IS NEVER DISABLED, IN ANY STATUS, and here that is load-bearing rather than copied from the
 * sibling: nothing times out the create round trip, so a daemon that answers neither a confirmation nor an
 * error would otherwise leave this dialog frozen with a disabled action, a frozen field and no exit at all.
 */
export function AddWorkspaceDialogView({
  path,
  status,
  onPathChange,
  onCancel,
  onStart
}: {
  path: string
  status: AddWorkspaceStatus
  onPathChange: (next: string) => void
  onCancel: () => void
  onStart: () => void
}): JSX.Element {
  const busy = status === 'creating'
  return (
    <div className="add-workspace-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the edit-host-overlay__scrim idiom. */}
      <div className="add-workspace-overlay__scrim" aria-hidden="true" />
      <div
        className="add-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ADD_WORKSPACE_TITLE_ID}
      >
        <h2 id={ADD_WORKSPACE_TITLE_ID} className="add-workspace__title">
          Add workspace
        </h2>
        {/* The Figma outlined field (the Rename dialog's 102:500), opening EMPTY — there is no current
            value to seed from, this being a create. The wrapping <label> gives the input its accessible
            name from the caption text, so no id/htmlFor pair is needed.

            ONE field and no host choice: the machine is fixed by the row whose plus was clicked.

            `autoFocus` is what makes AC1's "empty and FOCUSED" true, and it is one attribute rather than a
            ref plus a mount effect: React DOM focuses the element on mount, and React's server renderer
            emits `autofocus=""`, so the same declaration is assertable in the static tier instead of being
            visible to e2e alone.

            Frozen while the create is in flight, so the field cannot drift from the path the outstanding
            command carries. */}
        <label className="add-workspace__field">
          <span className="add-workspace__label">{ADD_WORKSPACE_FIELD_LABEL}</span>
          <input
            type="text"
            className="add-workspace__input"
            value={path}
            onChange={(e) => onPathChange(e.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        {/* The failure line (AC3) — spec-added, not in the Figma, the `edit-host__error` idiom. Rendered
            ONLY on `rejected`; `idle` and `creating` render none. */}
        {status === 'rejected' && (
          <p className="add-workspace__error">{ADD_WORKSPACE_ERROR_COPY}</p>
        )}
        {/* The action row (the Rename dialog's 19:19): Cancel + the confirm, both right-aligned
            (justify-end in the node). */}
        <div className="add-workspace__actions">
          <button type="button" className="add-workspace__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="add-workspace__start"
            onClick={onStart}
            disabled={busy || !isAbsolutePath(path)}
          >
            {ADD_WORKSPACE_ACTION_LABEL}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The interaction container — state, the round trip, and the dispatch. Rendered by `ChannelList` ONLY while
 * its open-dialog cell holds a server id, which is what makes the subscription's lifetime exactly the
 * dialog's open lifetime. `window.pyry` is dereferenced only inside the effect and the click callback,
 * never during render, so `ChannelList` stays server-renderable (the `onNewConversation` discipline).
 *
 * ⭐ THE IN-FLIGHT GATE IS THE WHOLE OF AC3 AND AC4, and it is the obligation #1307 named for its first
 * consumer. Both listeners act only while `status === 'creating'`:
 *   - A rejection arriving at `idle` or `rejected` changes nothing — no error line, no state moved. That
 *     covers a rejection belonging to the FAB's or the workspace plus's concurrent create arriving before
 *     this dialog has submitted anything, and one arriving after its own create was already confirmed (the
 *     dialog is closed and this component unmounted by then, so no listener exists at all).
 *   - The residue is NAMED rather than designed away: while this dialog's own create IS outstanding, a
 *     concurrent caller's rejection is indistinguishable from its own and will show the line. The bare arm
 *     cannot say whose it is, and the daemon's refusal never echoes the path, so there is nothing to
 *     correlate on even if a field were added. It fails toward a false failure report on a create that will
 *     still land — never a false success — and the exit is the same either way: retype, or Cancel.
 *
 * ⭐ CLOSING ON A CONFIRMATION DOES NOT MATCH ON `cwd`, deliberately. `ConversationCreatedPayload` carries
 * one and comparing it to the typed path is the obvious tightening. It is declined because it would make
 * this dialog's only exit depend on the daemon echoing the string byte for byte: a daemon that normalises a
 * trailing slash or resolves a symlink would strand the dialog open forever over a chat it had already
 * created. Closing on the first confirmation while our own create is outstanding fails in the safe
 * direction, and the navigation to the new thread is `useConversationCreatedNav`'s in PairedShell either
 * way.
 *
 * The subscriptions are established ONCE (empty-dep effect, both off-handles composed as the cleanup — a
 * StrictMode double-mount nets exactly one live listener each). The latest status is read through a ref
 * rather than captured in the listener's closure, the `useConversationCreatedNav` idiom: a listener holding
 * the mount-time `idle` would ignore every answer to the create it is waiting for.
 */
export function AddWorkspaceDialog({
  serverId,
  onDismiss
}: {
  serverId: string
  onDismiss: () => void
}): JSX.Element {
  // Transient, per-interaction state — component-local useState, not a store. `newFolderStore` exists
  // because #398 wanted one, not because a round trip requires one, and #1179's dialog needed none. Seeded
  // empty on mount, and `ChannelList` mounts a fresh instance per open, so a reopen after a Cancel or a
  // refusal always starts from an empty field and an `idle` status.
  const [path, setPath] = useState('')
  const [status, setStatus] = useState<AddWorkspaceStatus>('idle')
  const statusRef = useRef(status)
  statusRef.current = status
  // The caller passes a fresh inline arrow each render, so the latest `onDismiss` is held in a ref and
  // invoked from the listener — `useConversationCreatedNav`'s rule, for the same reason: the subscription
  // is established once and must not re-subscribe on a re-render.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  useEffect(() => {
    const offCreated = subscribeConversationCreated(window.pyry.onDaemonEvent, () => {
      if (statusRef.current === 'creating') onDismissRef.current()
    })
    const offRejected = subscribeConversationCreateRejected(window.pyry.onDaemonEvent, () => {
      if (statusRef.current === 'creating') setStatus('rejected')
    })
    return () => {
      offCreated()
      offRejected()
    }
  }, [])
  return (
    <AddWorkspaceDialogView
      path={path}
      status={status}
      onPathChange={setPath}
      onCancel={onDismiss}
      onStart={() => {
        // Fire-and-forget, then WAIT (AC2) — unlike its three sibling dialogs, which close on their own
        // action. `window.pyry` is dereferenced HERE, at interaction time, never during render (the
        // `onNewConversation` discipline). The helper trims the path; the view already refused a relative
        // one, so there is no redundant guard here.
        requestNewWorkspaceChat(window.pyry.sendCommand, path, serverId)
        setStatus('creating')
      }}
    />
  )
}
