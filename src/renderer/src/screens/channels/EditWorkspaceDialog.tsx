import type { RendererCommand } from '@shared/ipc/commands'
import { Modal } from '../../components/Modal'
import { workspaceLabelFor } from './channelListViewModel'

const MAX_WORKSPACE_LABEL_LENGTH = 128

/**
 * The archive slot's copy (#1439) — `UNPAIR_HOST_COPY`'s idiom one dialog over: client-owned module
 * constants, apostrophe-free (`renderToStaticMarkup` escapes ' → &#x27;, the standing desktop lesson),
 * and interpolating NEITHER the workspace label NOR the `cwd`. The prompt says "this workspace" rather
 * than naming one, for the reason CLAUDE.md's operator ruling gives: daemon-authored text may be
 * rendered escaped as its own line, but never folded into copy the app speaks in its own voice.
 *
 * The confirm answer reads `Archive`, not `Confirm`: it is the verb the act performs, and it is the one
 * word in this dialog that distinguishes the slot's two answers from the footer's Cancel and OK.
 */
const ARCHIVE_WORKSPACE_COPY = {
  archive: 'Archive workspace',
  prompt: 'Archive this workspace? Its chats and channels move to the Archive screen.',
  cancel: 'Cancel',
  confirm: 'Archive'
} as const

/**
 * The archive slot's two arms (#1439), held by the container beside `editWorkspaceTarget`.
 *
 * TWO, where the Edit host dialog's unpair slot has three, and the missing one is the point: that slot
 * spans an `ipcRenderer.invoke` round trip it must freeze the dialog for, whereas this send is
 * fire-and-forget through `sendCommand` and closes the dialog in the same tick. There is no in-flight
 * state to represent and no failure to report — an archive the daemon never confirms simply leaves the
 * rows in place, which is the answer the rename beside it already gives.
 */
export type EditWorkspaceArchiveStatus = 'idle' | 'confirming-archive'

/**
 * The slot's three injected effects (#1439). REQUIRED, not optional, and grouped into one object rather
 * than spread across the view's prop list — `EditHostUnpair`'s rule: a view that cannot act is a bug, so
 * forgetting to wire the action is a compile error rather than a dialog with an inert button.
 *
 * NULLARY, because this dialog is open against exactly ONE workspace, whose `cwd` and host the container
 * already holds in `editWorkspaceTarget`. A parameter would be a value the caller reads straight back out
 * of its own state — and it would put a daemon-asserted path into this module, which has never held one.
 */
export interface EditWorkspaceArchive {
  onArm: () => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Presentation and validation only. The container seeds the draft and owns dismissal.
 * Preserve the existing lack of autofocus and Escape/backdrop dismissal.
 *
 * #1439 adds the archive slot: `status` is the injected arm, `archive` its three required effects. The
 * view still has NO path prop and displays neither the `cwd` nor a conversation id.
 */
export function EditWorkspaceDialogView({
  name,
  status,
  onNameChange,
  onCancel,
  onSave,
  archive
}: {
  name: string
  status: EditWorkspaceArchiveStatus
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
  archive: EditWorkspaceArchive
}): JSX.Element {
  return (
    <div className="edit-workspace-overlay">
      <div className="edit-workspace-overlay__scrim" aria-hidden="true" />
      <Modal
        title="Edit workspace"
        width={640}
        cancelAction={{ label: 'Cancel', onClick: onCancel }}
        confirmAction={{
          label: 'OK',
          onClick: onSave,
          disabled: name.trim().length > MAX_WORKSPACE_LABEL_LENGTH
        }}
        onClose={onCancel}
      >
        <label className="edit-workspace__field">
          <span className="edit-workspace__label">Workspace name (optional):</span>
          <input
            type="text"
            className="edit-workspace__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        <ArchiveSlot status={status} archive={archive} />
      </Modal>
    </div>
  )
}

/**
 * The content area's archive affordance (#1439) — an inline, non-exported control mirroring the Edit host
 * dialog's `UnpairSlot` posture. Pure: it renders the arm it is given and reports intents; it owns no
 * state and performs no effect.
 *
 * THE PATTERN IS SHARED, THE MARKUP IS NOT. Nothing here imports that slot's component or its CSS, and no
 * class name is shared with it or with the conversation dialogs — the Edit host dialog knowledge page
 * records the Playwright-locator reason. What IS reused is the two-arm shape: idle offers the verb,
 * confirming asks and offers both answers in the slot the button vacated.
 *
 * ⭐ NEITHER ANSWER CARRIES AN ERROR ROLE, where the unpair slot's Confirm does, and that is the
 * difference between the two acts rather than an oversight: unpairing forgets a host, archiving moves
 * rows to a screen they can be restored from — the same distinction the Channel info sheet already draws
 * between its Archive and its Delete. So the confirm answer takes no modifier class AT ALL, rather than a
 * modifier that draws nothing: #1422 shipped exactly such a class, pinned by a test with no CSS rule
 * behind it, and only a rendered capture caught it.
 *
 * Nothing here is ever disabled. There is no round trip to freeze and no second send to race: the confirm
 * closes the dialog in the same tick, so the slot it belongs to is gone before a second click can land.
 *
 * Every button's TEXT is its accessible name; none carries an `aria-label`. Naming the workspace in one
 * would put daemon-authored text into an attribute, which CLAUDE.md forbids outright — and it is why the
 * slot's Cancel and the footer's Cancel are told apart by class rather than by accessible name.
 */
function ArchiveSlot({
  status,
  archive
}: {
  status: EditWorkspaceArchiveStatus
  archive: EditWorkspaceArchive
}): JSX.Element {
  if (status === 'idle') {
    return (
      <div className="edit-workspace__actions">
        <button type="button" className="edit-workspace__archive" onClick={archive.onArm}>
          {ARCHIVE_WORKSPACE_COPY.archive}
        </button>
      </div>
    )
  }
  return (
    <div className="edit-workspace__actions">
      <span className="edit-workspace__archive-prompt">{ARCHIVE_WORKSPACE_COPY.prompt}</span>
      <button type="button" className="edit-workspace__archive" onClick={archive.onCancel}>
        {ARCHIVE_WORKSPACE_COPY.cancel}
      </button>
      <button type="button" className="edit-workspace__archive" onClick={archive.onConfirm}>
        {ARCHIVE_WORKSPACE_COPY.confirm}
      </button>
    </div>
  )
}

/**
 * The four fields the selection reads (#1439), rather than `ServerConversationSummary` itself: a test
 * builds a row in four keys instead of eight, and this module keeps its one-way relationship with the
 * store (it imports no state). Every held row is assignable to it, so the container passes them through
 * unchanged.
 *
 * `serverId` admits `null | undefined` because `ConversationListOrigin` does — an unattributed row is a
 * real state — while the parameter below is a required `string`. That asymmetry is what makes an
 * unattributed row unmatchable by construction rather than by a branch.
 */
export type ArchivableRow = {
  readonly id: string
  readonly cwd: string
  readonly is_archived: boolean
  readonly serverId: string | null | undefined
}

/**
 * Archive every active chat and channel in one workspace on one host (#1439) — the selection AND the
 * fan-out, in the one place a unit test can reach. The container's confirm arrow cannot be: `ChannelList`
 * gates this dialog on a target that is `null` in every static render, so a filter written inline there
 * would be proved by nothing (the reason `runEditHostUnpair` was extracted one dialog over).
 *
 * THE SEND IS INJECTED, not `sendCommand`. This module imports nothing from the conversation screen; the
 * container binds `requestArchiveConversation`, which already owns the `archiveConversation` literal, so
 * the wire shape is stated once in the codebase rather than twice.
 *
 * ⭐ THE HOST HALF OF THE FILTER READS THE CLIENT'S OWN STAMP. `serverId` is bound main-side by
 * `bindServerOrigin` from a paired record this client holds, and `stampRows`'s spread order keeps a
 * daemon field from overwriting it — which is what makes "two hosts sharing a path archive only their
 * own rows" a property of the data rather than a hope. `cwd` is daemon-supplied and compared by EXACT
 * equality, normalised in no way: `groupByWorkspace` keys its groups on the raw string, so `/a/b` and
 * `/a/b/` are two groups there and must be two here. `id` is daemon-supplied too and is used as nothing
 * but the payload's opaque routing value — no join, no lookup path, no interpolation into copy.
 *
 * Fire-and-forget, once per row, in list order; an empty selection sends nothing. There is no cap on how
 * many: each row is one the operator can already archive by hand, and stopping early would leave the
 * group in the trees, which is the outcome the whole button exists to avoid.
 */
export function requestArchiveWorkspace(
  archiveConversation: (conversationId: string) => void,
  rows: readonly ArchivableRow[],
  cwd: string,
  serverId: string
): void {
  for (const row of rows) {
    if (row.serverId === serverId && row.cwd === cwd && !row.is_archived) archiveConversation(row.id)
  }
}

/**
 * Fire once; the existing workspace update flow refreshes the rows.
 * Echo the exact remote path without normalization. An explicit null label clears
 * the custom name; omitting that key would violate the command contract.
 * Server identity is omitted only for the existing unattributed-row fallback.
 */
export function requestRenameWorkspace(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  name: string,
  serverId?: string
): void {
  const trimmed = name.trim()
  sendCommand({
    type: 'renameWorkspace',
    ...(serverId === undefined ? {} : { serverId }),
    payload: {
      path: cwd,
      label: trimmed === '' || trimmed === workspaceLabelFor(cwd) ? null : trimmed
    }
  })
}
