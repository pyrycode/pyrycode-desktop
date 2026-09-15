# Edit workspace dialog

The [workspace row's pen](channel-list-workspace-row-nest.md)
in either sidebar tree opens the [shared Modal](modal-presentation.md) to edit an
optional workspace label, or, since [#1439](https://github.com/pyrycode/pyrycode-desktop/issues/1439),
to archive the whole workspace. The selected host and exact remote `cwd` remain the save
target; neither is displayed. Renaming changes the label, never the folder's name or location.
Archiving moves the workspace's chats and channels to the Archive screen; it never deletes them and
never touches the daemon's stored label.

## What it does

- Opens with the row's displayed name: its custom label or folder-name fallback.
- Shows a single filled field labelled “Workspace name (optional):”, an accessible
  “Edit workspace” title, a visible header close icon, and centred Cancel/OK actions.
- OK sends one `renameWorkspace` to the selected host, then closes immediately.
  The name is trimmed. Empty or whitespace-only input and the folder's own name
  send explicit `label: null`, clearing the custom label. Other names send the
  trimmed string. OK is disabled only above 128 UTF-16 code units after trimming.
- Cancel and header close dismiss without sending. Each reopening seeds the current
  row name, discarding an abandoned draft. Escape and backdrop clicks do not dismiss;
  the seeded field is not autofocused.
- Below the field, an outlined **Archive workspace** button ([#1439](https://github.com/pyrycode/pyrycode-desktop/issues/1439))
  arms an inline confirmation in the same slot rather than sending anything. Confirming
  archives every active chat and channel on the clicked host whose `cwd` matches exactly,
  and closes the dialog without sending the rename, whatever the name field holds. Cancelling
  the confirmation, or dismissing the dialog by any exit, returns to (or leaves) the idle
  button; a reopen always starts idle. See § The archive slot below.
- The existing `workspace_updated` re-list updates both trees on one host. Multi-host
  refresh remains limited by [#1363](https://github.com/pyrycode/pyrycode-desktop/issues/1363),
  independently of the correctly addressed rename (§ Edge cases and limitations).

## How it works

The [Edit workspace Figma instance](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2239)
uses the [Modal component design](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=489-1942).
`Modal` supplies the 640px preferred panel width, divided title/close header,
24px vertical and 28px horizontal padding, 20px section gaps, title-large typography,
and centred outlined Cancel / filled OK buttons. Host and folder layers are absent.

### The pen — `WorkspaceRow`'s second optional trailing control (`ChannelList.tsx`)

A module-private `WorkspaceEditControl = { readonly label: string; readonly onEdit: () => void }` —
[`WorkspaceCreateControl`](channel-list-workspace-row-nest.md)'s
shape one control over, but its **own** type rather than a shared one: the two controls are
independently withheld in principle and say different words, so bundling them would couple two
affordances that differ in everything but position. `onEdit` is nullary, so no component below
`renderServerTrees` handles a `cwd` — `create`'s own rule, re-derived here.

The chain is the same shape `create` already threads: `WorkspaceRow` gains `edit?: WorkspaceEditControl`,
`CollapsibleWorkspaceGroup` passes it through unchanged, `renderServerTrees` gains a trailing `edit?:
{ label, onEdit: (cwd, label, serverId) => void }` parameter and closes over the group — `onEdit: () =>
edit.onEdit(group.key, group.label, serverId)`, passing the group's **key** (for the send) and its **label** (to
seed the dialog's field), plus the enclosing server's identity — and `renderBody` hands the **same** control object to both trees, unlike the
two `create` labels: the pen says the same word above the divider and below it.

**One label constant for both trees**, `EDIT_WORKSPACE_CONTROL_LABEL = 'Edit workspace'`, read twice —
by the button's `aria-label` and by its pill — so the drawn and spoken names cannot drift.

**⭐ The pen is rendered after the plus in the DOM, and that is forced rather than chosen.**
`e2e/sidebar-workspace-create.spec.ts` focuses the disclosure button and presses Tab once, asserting
the plus receives focus. A pen inserted before it would take that Tab and redden a shipped spec this
ticket had to leave untouched. Both controls are absolutely positioned, so DOM order drives neither the
layout nor the drawn result (the pen still sits visually left of the plus) — only the tab order, which
now runs disclosure → plus → pen. `ChannelList.test.tsx` pins the order so a future reorder fails a unit
test rather than an e2e run.

**Withheld on the group's key, never its label** — `UNKNOWN_WORKSPACE_KEY` (`''`), exactly as `create`
is: a real directory named "Unknown workspace" is an ordinary group and keeps its pen.

### The geometry (`channels.css`)

`.channel-list__workspace-edit` is a fresh class, not a modifier on `.channel-list__workspace-create` —
the two plusses (#1178/#1179) share one class because they're one drawn control differing only in
accessible name; the pen is a different size (14 vs 16) at a different inset (28 vs 2), so sharing would
mean a modifier overriding half the block. A 20×20 (`--space-5`) box at `right: calc(var(--space-7) -
3px)` (25), `top: var(--space-1)` (4), centres a 14×14 glyph at right 28, top 7 — the drawing's own
rectangle, derived from tokens plus the box's own halved slack rather than restated as a literal inset.
The two controls' hit boxes (0…20 and 25…45 from the row's trailing edge) don't overlap. Reveal is
`opacity` alone, never `display: none` — the plus's ruling, load-bearing for the same reason: a
`display: none` control leaves the tab order and the accessibility tree, which AC2's "keyboard-reachable
at all times" forbids. It triggers off **the row's** hover (so the glyph is visible before the pointer
reaches a 20px target) and its own `:focus-visible`.

`.channel-list__workspace`'s right padding moved from the Idle 32 (`--space-8`) to the **Hover
variant's 52**, written as the sum `calc(var(--space-8) + var(--space-5))` — and it is that number in
**both** states, not toggled on hover. Padding to 32 at rest and 52 on hover would re-truncate a long
label the instant the pointer arrived, which is worse than truncating it slightly early; reserving 52
unconditionally is what makes "no glyph of the label is painted under either control" true at rest as
well as on hover (AC3). The label's content box ends 52 in; the pen's hit box starts 45 in.

The pen's name pill reuses the shared `.channel-list__control-name` class and [#1181](channel-list-workspace-plus-pill.md)'s
append-after-the-`<svg>` discipline, triggered off the **pen's own** `:hover`/`:focus-visible` (never
the row's) — hovering the row's label shows nothing.

### The dialog (`EditWorkspaceDialog.tsx`)

`EditWorkspaceDialogView` takes `name`, `onNameChange`, `onCancel`, `onSave`, and since #1439
`status`/`archive` for the archive slot below (§ The archive slot); it has no path prop. It
delegates panel, heading, close control and footer to `Modal`, wiring both Cancel and close to
`onCancel`. The wrapping label gives the controlled input its accessible name. React escapes its
value; names and paths are never logged. See [props and caller ownership](modal-presentation.md#props-and-caller-ownership).

Validation is a presentation affordance computed from `name.trim().length`.
Blank is a valid reset, and 64 astral characters occupy the full 128-unit allowance.
`requestRenameWorkspace(sendCommand, cwd, name, serverId?)` trims and sends without
adding its own length guard. The daemon remains authoritative.

The helper preserves `cwd` verbatim: no normalization, trimming or local filesystem
resolution. Reset compares against `workspaceLabelFor(cwd)`, not the current custom
label. The payload always includes `label`; null means clear, whereas omission
violates the existing command contract. The optional `serverId` is top-level routing
metadata, outside the payload, and is omitted only for unattributed rows.

### The archive slot (`EditWorkspaceDialog.tsx`, added by #1439)

Below the name field, `ArchiveSlot` renders one of two arms from a container-owned
`EditWorkspaceArchiveStatus` (`'idle' | 'confirming-archive'`), mirroring the [Edit host
dialog](edit-host-dialog.md)'s unpair slot's shape but with **two** arms rather than three: the
send is fire-and-forget through `sendCommand` and closes the dialog in the same tick, so there is
no round trip to freeze the dialog for, no in-flight arm and no failure line — an archive the
daemon never confirms simply leaves the rows in place, the same honest answer the rename beside it
already gives. `idle` draws the outlined **Archive workspace** button; `confirming-archive`
replaces it in the same `.edit-workspace__actions` row with the prompt **Archive this workspace?
Its chats and channels move to the Archive screen.** and two answers, **Cancel** and **Archive**.

Both confirming-arm answers wear the plain outlined recipe with **no error-role modifier** — the
distinction the Channel info sheet already draws between its Archive and its Delete, since the act
is reversible. This is the opposite of the Edit host dialog's unpair Confirm, which does carry the
error role for unpairing a host. All copy is one apostrophe-free `ARCHIVE_WORKSPACE_COPY` module
constant, naming neither the label nor the `cwd` — the prompt says "this workspace."

The selection and the fan-out both live in the exported `requestArchiveWorkspace(archiveConversation,
rows, cwd, serverId)`, not inline in the container's confirm handler: `ChannelList.test.tsx` renders
only `ChannelListView`, and the dialog is gated on a target that is `null` in every static render, so
a filter written inline in the container would ship with no unit-test proof at all — the same reason
[`runEditHostUnpair`](edit-host-dialog.md) was extracted one dialog over. It archives one row
(`archiveConversation(row.id)`) for every row whose `serverId` matches the target's host **exactly**,
whose `cwd` matches the target **exactly** (no normalisation — `/a/b` and `/a/b/` are different rows,
matching [workspace grouping](channel-list-workspace-grouping.md)'s own raw-`cwd` keying), and whose
`is_archived` is `false`; an empty selection sends nothing, and there is no cap on how many it sends.
`row.serverId` is the load-bearing half: it is the **client's own** stamp (`bindServerOrigin`), never
a daemon-supplied field, which is what makes "two hosts sharing a path archive only their own rows" a
property of the data rather than a hope. The sender is injected — the dialog module imports nothing
from the conversation screen — so `ChannelList` binds `requestArchiveConversation` (already the one
place the `archiveConversation` wire literal lives) into the one-argument closure the helper takes.

Nothing is wired for the reply beyond what already ships: each archived row's `conversation_updated`
retriggers `shouldRefreshList`, the refreshed list drops the row from `partitionActive`, and
`useArchivedActiveConversationExit` fires the exit if the open chat was one of the archived rows —
see [workspace grouping](channel-list-workspace-grouping.md) for how the emptied group then leaves
both trees.

### Container state (`ChannelList.tsx`)

`ChannelList` holds one nullable `editWorkspaceTarget` containing `{ cwd, serverId }`
and a separate `editWorkspaceName` draft. `renderServerTrees` closes over each server
while building its workspace groups; both trees forward that identity with the group
key and displayed label. The path and host therefore stay together through the edit,
even when two hosts share a path.

Opening sets the target and seeds the draft from the current row. Rendering is gated
on `editWorkspaceTarget !== null`. OK calls the helper once and immediately clears
the target, without awaiting or correlating a reply. Cancel and close only clear the
target. There is no new store, subscription, pending state or error UI. An inbound
workspace update during editing may refresh rows but does not overwrite the draft.

Since #1439 a third cell, `editWorkspaceArchive: EditWorkspaceArchiveStatus`, holds the archive
slot's arm — seeded `'idle'` by the same `onEditWorkspace` handler that seeds the other two, which is
what makes "a reopen starts idle" true with no reset code of its own. A `closeEditWorkspace()` helper
clears both `editWorkspaceTarget` and this cell together, used by the view's Cancel, its OK and the
archive confirm, so the two cells can never disagree about whether the dialog is open; the existing
`sessionStore` subscription's host-loss branch clears both in the same statement rather than adding a
second effect. The confirm handler re-checks `canMutateHost` at click time — the same guard the rename
carries — before calling the helper with the container's own held conversation rows.

### CSS (`channels.css`)

The caller retains `.edit-workspace-overlay` and its separate scrim. The shared
panel owns viewport bounds and whole-panel scrolling; header and footer are not
pinned. It fits the app's 800px minimum width and can scroll to controls in short
windows. The field uses an 8px label gap, label-large emphasized text and a 52px
filled input with body-medium text, theme colors and a focus-visible outline.
The old outlined field, path line and dialog-specific panel/action styles are gone.

Since #1439, three more rules under the `.edit-workspace*` namespace, sharing no class name with the
Edit host, Edit channel or Edit chat dialogs — the Playwright-locator rule on [the Edit host
dialog](edit-host-dialog.md): `.edit-workspace__actions` (the archive slot's row, 8px top inset),
`.edit-workspace__archive` (the button and both answers, restating `.edit-host__unpair`'s outlined
recipe) and `.edit-workspace__archive-prompt` (the confirming copy).

**Restating a sibling's CSS recipe restates its assumptions.** `.edit-host__unpair` carries
`overflow-wrap: anywhere` because it sits beside a long *host name*, and its own prompt is four
words, so its answers never shrink. This slot's prompt is a full sentence, and pasting that recipe
unchanged let the shared flex row squeeze both answers until their own client-owned labels broke
mid-word (`Canc/el`, `Archi/ve`) — invisible to every markup assertion, since the text was still
"Cancel" and "Archive" in the DOM; only a rendered capture caught it. `.edit-workspace__archive` sets
`flex-shrink: 0` instead (the labels are fixed-length constants, so holding their intrinsic width
costs nothing at the 640px panel's narrowest) and drops `overflow-wrap: anywhere`, while
`.edit-workspace__archive-prompt` takes `flex: 1 1 auto` so the sentence absorbs the space the two
buttons leave and wraps there. The lesson generalises: a shared visual recipe carries the layout
assumptions of the copy it was written against, and a longer or shorter neighbour can break it in a
way no unit test sees.

## Testing

- `ChannelList.test.tsx` pins pen availability, accessible naming, glyph geometry,
  escaping and disclosure → plus → pen DOM order.
- `EditWorkspaceDialog.test.tsx` checks shared modal markup, the single optional
  field, blank resets, trimmed UTF-16 boundaries (including astral characters),
  explicit null payloads, exact paths and selected-host routing. Static renders
  cannot prove callbacks, scrolling or close-image decoding.
- `e2e/sidebar-workspace-edit.spec.ts` exercises both-tree rename on one host,
  reset and reseed, dismissal without saving, keyboard controls, preserved
  Escape/backdrop behavior, the decoded close image and scrolling at 800×200.
  It also checks 640px panel width at normal and minimum window widths.
- The active two-host browser test counts requests at each fake daemon and checks
  exact paths independently of refreshed labels. The separate row-refresh test is
  skipped for #1363; a successful rename frame does not prove the subsequent list
  refresh worked. Enable and pass that assertion when the refresh defect is fixed.
- The multi-host fixture pushes a default second-host row after pairing. Replace
  that seed with the same-path scenario before exercising its pen; a custom reply
  builder alone does not establish the intended initial rows.
- `e2e/real-daemon-workspace-rename.spec.ts` drives the optional-name field and OK
  against a real daemon. Unlike the fake, this proves a real handler exists; see
  [credential-light e2e](real-daemon-credential-light-e2e.md) for its label-clearing
  trap. Execution of the updated spec remains a dispatcher handoff.
- `EditWorkspaceDialog.test.tsx` (#1439) checks the archive slot's own markup in both arms — the
  idle button, the confirming prompt plus both answers, neither answer carrying an error-role class —
  and `requestArchiveWorkspace` with plain spies: one send per matching row, none for an empty
  selection, archived rows skipped, another `cwd` on the same host skipped, the same `cwd` on another
  host skipped, an unattributed row skipped, and a trailing-slash `cwd` **not** matched (exact
  equality). `ChannelList.test.tsx` gains no new test here: it renders `ChannelListView`, and the
  dialog and its confirm handler are unreachable under `renderToStaticMarkup` — the e2e drive below is
  the only tier that can prove the container wiring.
- `e2e/sidebar-workspace-edit.spec.ts` (#1439) adds an arm → cancel → arm → confirm drive: seeds the
  promoted row, mints a chat at the same `cwd` (the second tree's group) and a chat at a different
  `cwd` (the survivor) first, then mints the target's own last chat **last** so the open pane is
  showing one of the rows the confirm archives — the ordering is what makes `.conversation__thread`
  going from one to none prove the shipped archived-exit path rather than assume it. Asserts both
  groups for the target `cwd` leave both trees, the other workspace's group survives, exactly two
  `archive_conversation` frames reached the fake daemon and no `rename_workspace` did. The slot's
  Cancel is located through `.edit-workspace__actions`, since a bare `getByRole('button', { name:
  'Cancel', exact: true })` is ambiguous while a second Cancel is armed.

## Revision: the pen's pill forced a sibling spec to narrow its locator

`sidebar-workspace-plus-name-pill.spec.ts` (#1181) located every workspace pill as
`.channel-list__workspace-head .channel-list__control-name`, reasoning that the row controls' pills
were one level down and out of reach. Since this ticket the head row carries a **second**
pill-wearing control, so that locator resolved two elements per head — its counts read double and its
single-element `channelsPill`/`chatsPill` reads strict-violated. Fixed by that spec's own precedent:
all three locators narrowed from the head row to `.channel-list__workspace-create`, naming the plus
specifically, so a future third named control changes nothing there again. Rejected: giving the pen its
own pill class, which would restate the whole `.channel-list__control-name` block to draw an identical
pill and contradict the ticket's own "the plus's pill treatment."

## Edge cases and limitations

- **Selected-host rename and row refresh are separate paths.** The rename includes
  the clicked host's `serverId`, but `subscribeConversations` drops the triggering
  event's origin and `requestConversationList` sends an unaddressed refresh. With
  multiple paired hosts that request is refused as ambiguous, leaving rows stale.
  Full two-host row-refresh acceptance remains pending
  [#1363](https://github.com/pyrycode/pyrycode-desktop/issues/1363).
- **Unattributed rows omit server identity.** They preserve the existing fallback
  routing behavior rather than guessing which host owns the path.
- **No rejection is surfaced.** The dialog closes immediately after dispatch;
  a daemon refusal produces no dialog error or retry state. The view bounds the
  trimmed name in UTF-16 units but does not replace daemon validation.
- **An update during editing does not reseed the draft.** Reopening reads the
  current sidebar label, which can remain stale while the refresh defect persists.
- **Focus policy is unchanged.** There is no autofocus, focus trap or Escape/backdrop
  dismissal. Native enabled controls remain keyboard-operable through the existing
  tab sequence; Cancel and header close are the explicit exits.
- **Archiving never touches the daemon's stored workspace label.** Only the rows move; a workspace
  archived and then given a fresh first chat comes back under its old daemon-held label, exactly as
  reopening the [rename](https://github.com/pyrycode/pyrycode-desktop/issues/1289) path would show it.
- **No cap on how many rows one confirm archives.** Each `archiveConversation` is fire-and-forget and
  there is no batching or throttle; a folder holding many active rows sends one frame per row. Named
  and accepted in the architecture spec's security review rather than deferred: every one of those
  rows is already one the operator could archive by hand, and capping the send would silently strand
  rows in the trees instead.
- **A daemon that never answers a given `archiveConversation` leaves that one row in place.** A
  partial burst (some rows archived, some not) leaves the group visible with fewer rows, re-archivable
  by the same button — the same honest partial-failure behaviour the rename beside it already has.

## Related

- [Channel list — workspace grouping](channel-list-workspace-grouping.md) — label and path identity,
  and how a group leaves both trees when its rows are archived.
- [Edit host dialog](edit-host-dialog.md) — the sibling slot this one's two-arm archive shape and
  `runEditHostUnpair`-style selection extraction are drawn from, and whose unpair Confirm carries the
  error role this dialog's confirm answer deliberately does not.
- [Shared modal](modal-presentation.md) — presentation ownership and close asset delivery.
- [Conversation workspace change — workspace rename](conversation-workspace-change.md#workspace-rename-label-change-1289)
  — command and wire contract.
- [Architecture spec](../../specs/architecture/1349-edit-workspace-modal.md) — design and scope.
- [#1439 architecture spec](../../specs/architecture/1439-edit-workspace-archive-button.md) — the
  archive slot's design, the CSS-recipe revision recorded above, and the security review's unbounded-
  frame-count finding recorded above.
