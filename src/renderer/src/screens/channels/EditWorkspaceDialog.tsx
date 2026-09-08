import type { RendererCommand } from '@shared/ipc/commands'
import { workspaceLabelFor } from './channelListViewModel'

// #1180: the Edit workspace dialog — what the workspace row's hover pen opens. A near-clone of the
// Create-channel dialog (#1179, CreateChannelDialog.tsx), itself a clone of the Rename dialog (#360):
// the same overlay / scrim / panel chrome and Name field, differing in the title ("Edit workspace"),
// the field opening SEEDED with the row's current label rather than empty, one read-only line under
// the field showing the workspace's full `cwd`, and the second action reading "Save".
//
// No Figma node draws it. Verified 2026-09-08: the Desktop page's Dialogs section holds Rename
// (102:498), Save as Channel, Create Folder and Paste Code only, and the ticket pins this dialog's
// chrome to the Rename one's. So the markup below is `CreateChannelDialogView`'s, which already
// mirrors that node declaration for declaration, plus the one element the path line adds.
//
// It collects input and dispatches only — it never mutates the list. The renamed workspace's label
// arrives through the daemon's `workspace_updated` reply, which #1288's inbound path turns into the
// re-list that relabels every row for that `cwd` in both trees. No keys, sockets, or raw bytes here —
// a fire-and-forget command through the preload bridge.
//
// TWO exports, both pure and SSR-testable: the view (props in, markup out) and the dispatch helper
// (the `requestRenameConversation` twin one verb over). They live TOGETHER here, unlike #1179's
// split, because this verb has exactly one sender and no shipped twin to sit beside — the shape
// `RenameConversationDialog.tsx` already uses for the same reason. The open → dispatch wiring lives
// in the ChannelList container (`window.pyry` dereferenced only at interaction time).
//
// THE `cwd` IS A PROP HERE, WHERE `CreateChannelDialogView` DELIBERATELY REFUSED ONE. That refusal was
// available there because nothing in that dialog showed the workspace; showing it is half of this
// ticket. So the protection changes form rather than weakening: the value reaches exactly ONE sink, an
// auto-escaped React CHILD in `.edit-workspace__path`, and NO attribute of the overlay, panel, field,
// input, path line or either action derives from it — no `title`, no `aria-label`, no `id`, no key, no
// class-name interpolation and no log line. The same four sinks `WorkspaceRow` declines for the label,
// re-derived here rather than inherited, because this is the first surface in the app that renders a
// `cwd` at all.
//
// NO Escape handler and no scrim `onClick`, matching `RenameConversationDialogView` and
// `CreateChannelDialogView` exactly — the ticket pins this dialog's close behaviour to the Rename
// one's, and today that is Cancel alone. Matching therefore means adding NOTHING, which also keeps a
// fifth unconditional `document` listener off a window that already has several.

// A stable id tying the dialog's aria-labelledby to its title element (the CREATE_CHANNEL_TITLE_ID
// idiom). A single fixed id is safe: only one Edit workspace dialog is open at a time.
const EDIT_WORKSPACE_TITLE_ID = 'edit-workspace-title'

/**
 * The longest label Save will send. The daemon polices the real rule server-side — an exact-`cwd`
 * match, non-empty after trim, at most 128 characters (`RenameWorkspacePayload`) — and this client
 * adds NO length check to the SEND path, which is that type's stated rule and the reason
 * `requestRenameWorkspace` below refuses nothing.
 *
 * This constant is a different thing: an AFFORDANCE. It disables Save before a command exists at all,
 * so an over-long name is refused to the user's face instead of vanishing into a rejection this client
 * never correlates. `channelListViewModel`'s `groupByWorkspace` docblock already names this dialog as
 * the home for exactly that refusal.
 *
 * The honest gap, stated rather than hidden: this counts UTF-16 code units and the daemon's rule need
 * not use the same unit, so an astral-plane name can be allowed here and refused there. The daemon
 * stays authoritative; the cost is a silent no-op, which is the same outcome every other refusal on
 * this fire-and-forget verb produces.
 */
const MAX_WORKSPACE_LABEL_LENGTH = 128

/**
 * The pure dialog chrome. `name` is the controlled field value (container-owned state, seeded on open
 * with the row's current label); `path` is the workspace's full `cwd`, held by the container and handed
 * down as a display string. The three effects are REQUIRED injected props (the "a view that cannot act
 * is a bug" rule).
 *
 * Save is disabled while the trimmed name is blank — empty OR whitespace-only — or longer than
 * MAX_WORKSPACE_LABEL_LENGTH, computed inline so the disabled/enabled state is directly assertable in
 * server-rendered markup (a disabled button renders `disabled=""`, an enabled one omits the attribute).
 * The bound is measured on the TRIMMED name, which is what Save actually sends, so surrounding
 * whitespace can never push an otherwise-legal name over it.
 *
 * NO `autoFocus`, which is the one place this parts company with `CreateChannelDialogView`: that field
 * opens empty and focusing it costs nothing, this one opens seeded and stealing focus into a prefilled
 * field invites an accidental overwrite of the very label the user came to read.
 */
export function EditWorkspaceDialogView({
  name,
  path,
  onNameChange,
  onCancel,
  onSave
}: {
  name: string
  path: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element {
  const trimmed = name.trim()
  const refused = trimmed === '' || trimmed.length > MAX_WORKSPACE_LABEL_LENGTH
  return (
    <div className="edit-workspace-overlay">
      {/* A dedicated scrim element (not the overlay's own background) so the opaque panel sibling is
          never dimmed and no bare color literal is needed — the create-channel-overlay__scrim idiom. */}
      <div className="edit-workspace-overlay__scrim" aria-hidden="true" />
      <div
        className="edit-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby={EDIT_WORKSPACE_TITLE_ID}
      >
        <h2 id={EDIT_WORKSPACE_TITLE_ID} className="edit-workspace__title">
          Edit workspace
        </h2>
        {/* The Figma outlined Name field (the Rename dialog's 102:500), opening SEEDED — this is an
            edit, so the current label is what the user is changing. The wrapping <label> gives the
            input its accessible name from the "Name" text, so no id/htmlFor pair is needed.

            The seeded value is untrusted daemon text and this is its one attribute-shaped sink: a
            controlled input's `value`, which React auto-escapes, so `<` and `>` never open a tag. It
            is the field's own content rather than metadata about it, and it is the sink
            `RenameConversationDialogView` already ships for exactly this. */}
        <label className="edit-workspace__field">
          <span className="edit-workspace__label">Name</span>
          <input
            type="text"
            className="edit-workspace__input"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
        {/* The path line — the first surface in the app that shows a workspace's full `cwd`. The
            sidebar row deliberately declines `title={label}` ("hover for the rest"), which #696's
            security review made a MUST FIX, and #703 recorded the full path staying undiscoverable as
            a cost. This is where that cost is paid back, and paying it here rather than on the row is
            what keeps the decline intact: a dialog body is a CHILD sink, a tooltip is an attribute.

            It WRAPS rather than ellipsizing (`.edit-workspace__path`), which is the point — a path
            the user came to read must be readable whole. An unbounded `cwd` is bounded instead by the
            panel's own `max-height` + `overflow-y: auto`, so it scrolls inside the dialog rather than
            blowing out the window.

            A bare line with no caption: AC4 asks for ONE line showing the `cwd`, and a caption plus a
            value is two. */}
        <p className="edit-workspace__path">{path}</p>
        {/* The action row (the Rename dialog's 19:19): Cancel + Save both right-aligned (justify-end
            in the node). Cancel is never disabled — it closes and sends nothing in every state. */}
        <div className="edit-workspace__actions">
          <button type="button" className="edit-workspace__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="edit-workspace__save"
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
 * Fire the `renameWorkspace` command (#1289 wired the main side through to the daemon). An inline
 * literal typed as RendererCommand — no constructor added, keeping the change renderer-contained,
 * exactly as `requestRenameConversation` inlines its own. Fire-and-forget, like the composer's send:
 * `sendCommand` is `void`, and the daemon's correlated `workspace_updated` is consumed by #1288's
 * inbound path, never awaited here.
 *
 * `cwd` GOES OUT VERBATIM. Not normalised, not trimmed, no `path` module, no local resolution. It is
 * daemon-asserted text making its trip back out as a command field, and the daemon looks it up by
 * byte-for-byte equality against a stored `cwd` — never a join — so a `../`-laden value is answered
 * `workspace.not_found` rather than traversing anything. Normalising it here would make this client
 * disagree with the daemon about which workspace was named. Main re-validates it at the untrusted IPC
 * boundary (`isRenameWorkspacePayload`) and rebuilds a fresh literal before it reaches the wire.
 *
 * `label` IS `null` WHEN THE TRIMMED NAME EQUALS THE FOLDER SEGMENT — `workspaceLabelFor(cwd)`, and
 * emphatically NOT the label the daemon is currently holding. That is the whole of "the way back to
 * the folder name is Save itself": typing the folder's own name clears the stored label, the daemon
 * drops it, and the row falls back to the folder segment on the re-list. There is no separate reset
 * control and none is needed.
 *
 *   - `workspaceLabelFor` is deliberately string work and nothing else (no `path`, no `fs`, no
 *     `node:*`, no `URL`) and is total over `string`, so an arbitrary `cwd` cannot make this throw.
 *   - It returns `null` for a `cwd` with no usable segment, which a non-blank trimmed name can never
 *     equal — so the unknown-workspace shape needs no special case here. (It is unreachable anyway:
 *     `renderServerTrees` withholds the pen from that group.)
 *
 * THE `label` KEY IS NAMED UNCONDITIONALLY. A literal `null` is the VALUE "clear this workspace's
 * label"; an ABSENT key is a contract violation the daemon rejects as malformed (`RenameWorkspacePayload`
 * carries no `omitempty`). A conditional spread would compile identically and fail on the wire.
 *
 * NO LENGTH OR PATH CHECK HERE, deliberately — the wire type's own rule, and re-implementing a daemon
 * rule in the sender is how the two drift. The view's disabled Save is the affordance; this helper
 * trims and sends.
 *
 * No `console.*`: every useful log on this path carries the `cwd` or the label, which ADR 0007's
 * content-free rule and CLAUDE.md both forbid.
 */
export function requestRenameWorkspace(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  name: string
): void {
  const trimmed = name.trim()
  sendCommand({
    type: 'renameWorkspace',
    payload: { path: cwd, label: trimmed === workspaceLabelFor(cwd) ? null : trimmed }
  })
}
