# Edit workspace dialog

The dialog opened by the [workspace row's hover pen](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178):
a Name field seeded with the row's current label, a read-only line showing the workspace's full `cwd`,
and a Cancel/Save pair that renames the workspace — every conversation sharing that `cwd`, in both
trees, on every client — via [`renameWorkspace`](conversation-workspace-change.md#workspace-rename-label-change-1289).
This is the first surface in the app that shows a workspace's full path; the sidebar row has declined
`title={label}` since [#703](../codebase/703.md).

Introduced in #1180. Purely renderer-side: the wire verb (#1289), the inbound re-list (#1288) and the
daemon-held label on the row (#1287) had all already shipped — this ticket is the pen, the dialog, and
the send, the only part of the round trip a user can reach.

## What it does

- Every workspace row, in both trees, except the unknown-workspace group, draws a trailing 14×14 pen on
  hover or keyboard focus — `aria-label="Edit workspace"` — 10px to the left of the create plus, both
  absolutely positioned so neither one's box depends on the other. Hovering or focusing it shows the
  same name-pill treatment ([#1181](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181))
  reading "Edit workspace"; clicking it never touches the group's `aria-expanded`.
- The pen opens a centered `role="dialog"` titled "Edit workspace": the Name field opens **seeded**
  with the row's current label (the daemon's `workspace_label` when there is one, the folder segment
  otherwise — indistinguishable here on purpose, since the row already resolved which one to show), one
  read-only line under it rendering the workspace's full `cwd`, and Cancel/Save. Save is disabled while
  the trimmed name is blank or over 128 characters; Cancel is never disabled.
- Save sends exactly one `renameWorkspace` and closes. `path` is the group's `cwd` verbatim; `label` is
  the trimmed name, or `null` when the trimmed name equals the **folder segment**
  (`workspaceLabelFor(cwd)`, never the current label) — that comparison is the whole of "the way back
  to the folder name is Save itself." There is no separate reset control.
- Cancel closes with no change and sends nothing.
- The rename lands on every row sharing that `cwd`, in both trees, the moment the daemon's
  `workspace_updated` reply reaches [#1288](channel-list.md#workspace-grouping)'s inbound re-list —
  already shipped and already driven; this ticket adds no new inbound handling.

## How it works

**No Figma node draws it.** Verified against the Figma on 2026-09-08: the Desktop page's Dialogs
section holds Rename, Save as Channel, Create Folder and Paste Code only. The dialog clones the Rename
dialog's chrome (overlay/scrim/panel/outlined field), matching [Create-channel dialog](create-channel-dialog.md)'s
own precedent for a dialog with no drawing of its own.

### The pen — `WorkspaceRow`'s second optional trailing control (`ChannelList.tsx`)

A module-private `WorkspaceEditControl = { readonly label: string; readonly onEdit: () => void }` —
[`WorkspaceCreateControl`](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)'s
shape one control over, but its **own** type rather than a shared one: the two controls are
independently withheld in principle and say different words, so bundling them would couple two
affordances that differ in everything but position. `onEdit` is nullary, so no component below
`renderServerTrees` handles a `cwd` — `create`'s own rule, re-derived here.

The chain is the same shape `create` already threads: `WorkspaceRow` gains `edit?: WorkspaceEditControl`,
`CollapsibleWorkspaceGroup` passes it through unchanged, `renderServerTrees` gains a trailing `edit?:
{ label, onEdit: (cwd, label) => void }` parameter and closes over the group — `onEdit: () =>
edit.onEdit(group.key, group.label)`, passing the group's **key** (for the send) and its **label** (to
seed the dialog's field) — and `renderBody` hands the **same** control object to both trees, unlike the
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

The pen's name pill reuses the shared `.channel-list__control-name` class and [#1181](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181)'s
append-after-the-`<svg>` discipline, triggered off the **pen's own** `:hover`/`:focus-visible` (never
the row's) — hovering the row's label shows nothing.

### The dialog (`EditWorkspaceDialog.tsx`, new module)

Two exports, both pure and server-renderable, living **together** — unlike [Create-channel
dialog](create-channel-dialog.md)'s split of view and command constructor into separate files —
because this verb has exactly one sender and no shipped twin to sit beside, the shape
`RenameConversationDialog.tsx` already uses for the same reason:

```ts
EditWorkspaceDialogView({
  name: string
  path: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element

requestRenameWorkspace(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  name: string
): void
```

**The `cwd` is a prop here, where `CreateChannelDialogView` deliberately refused one.** That refusal was
available there because nothing in that dialog showed the workspace; showing it is half of this ticket.
The protection changes form rather than weakening: the value reaches exactly one sink, an auto-escaped
React **child** in `<p className="edit-workspace__path">`, and no attribute of the overlay, panel,
field, input, path line or either action derives from it — no `title`, no `aria-label`, no `id`, no
class-name interpolation, no log line. The four sinks `WorkspaceRow` already declines for the label are
re-derived here rather than inherited, since this is the first surface in the app that renders a `cwd`
at all.

**No `autoFocus`**, the one place this parts company with `CreateChannelDialogView`: that field opens
empty and focusing it costs nothing; this one opens seeded, and stealing focus into a prefilled field
invites an accidental overwrite of the very label the user came to read.

**Save's `disabled` is computed inline from the trimmed name** (blank, or over
`MAX_WORKSPACE_LABEL_LENGTH = 128`), so the state is directly assertable in static markup. This
constant is an **affordance**, not a re-implementation of the wire rule: `RenameWorkspacePayload`'s own
type carries no client-side length check on the send path (`requestRenameWorkspace` refuses nothing),
and the daemon polices 128 UTF-16-agnostic characters server-side. The disable exists to refuse a blank
or over-long name to the user's face before a command exists at all — the home
[`groupByWorkspace`'s docblock](channel-list.md#workspace-grouping) already named for this ticket. The
honest gap: this counts UTF-16 code units, and the daemon's rule need not use the same unit, so an
astral-plane name can pass here and be refused there — not exploitable, just a silent no-op, the same
outcome every rejection on this fire-and-forget verb produces.

**`requestRenameWorkspace`** is `requestRenameConversation`'s shape one verb over — an inline command
literal, no constructor, fire-and-forget. `cwd` goes out **verbatim**: no normalisation, no trim, no
`path` module, because the daemon looks it up by byte-for-byte equality against a stored `cwd`, never a
join, so a `../`-laden value draws `workspace.not_found` rather than traversing anything; main
re-validates at the untrusted IPC boundary and rebuilds a fresh literal before the wire. `label` is
`null` exactly when the trimmed name equals `workspaceLabelFor(cwd)` (the folder segment) — `null` for
a `cwd` with no usable segment, which a non-blank trimmed name can never equal, so the unknown-workspace
shape needs no special case (and is unreachable anyway, since the pen is withheld there). **The `label`
key is named unconditionally**: a literal `null` is the daemon's "clear this label" value, and an
absent key is a contract violation it rejects as malformed.

### Container state (`ChannelList.tsx`)

Two `useState` cells, beside the three dialogs already there, independent of them for the reason they
all share — an open dialog's fixed-inset overlay covers the window, so no two can be open at once and
no mutual-exclusion logic is needed:

```ts
const [editWorkspaceCwd, setEditWorkspaceCwd] = useState<string | null>(null)
const [editWorkspaceName, setEditWorkspaceName] = useState('')
```

Rendered on `editWorkspaceCwd !== null` — an **explicit null check, never a truthiness test** — so an
empty-string `cwd` (the unknown-workspace sentinel) cannot collapse into "no dialog open"; unreachable
today because the pen is withheld from that group by key, and writing the check this way keeps that
withhold load-bearing for one reason rather than two. Opening seeds both cells together from the
group's **current** label (not the abandoned draft of a prior Cancel). `window.pyry` is dereferenced
inside the Save handler alone, never during render.

A `workspace_updated` landing mid-edit re-lists the sidebar under the open dialog and does **not**
re-seed the field — clobbering what the user is typing would be worse than a stale seed.

### CSS (`channels.css`)

A fifth `*-overlay` block, `.edit-workspace-*`, mirroring `.create-channel*` declaration for
declaration plus one added element — not a reuse of `.rename-conversation*`, for
[Create-channel dialog](create-channel-dialog.md)'s own stated reason: `e2e/conversation-create-rename.spec.ts`
scopes to the Rename dialog's classes under Playwright's strict-locator mode, and a second dialog
wearing them would strict-violate; and this dialog's extra line would land inside markers
`RenameConversationDialog.test.tsx` pins.

**The path line, `.edit-workspace__path`**, takes `.settings__default-workspace-value`'s recipe
(body-small, on-surface-variant) with `overflow-wrap: anywhere` and deliberately **no ellipsis chain**
— the opposite call from every other daemon-derived string in this file. The sidebar row ellipsizes
because a row is a fixed band and the name is a glance; this line exists *because* the user came to
read the path, and a path cut off at the panel's edge answers nothing. `anywhere` rather than
`break-word` so an unbroken long segment breaks too, rather than pushing the panel past its
`max-width`. Vertical growth is bounded instead: the panel carries `max-height: 90%; overflow-y: auto`,
load-bearing here in a way it is not on the sibling dialogs, since this is the first dialog rendering
an untrusted string of unbounded length.

## Testing

- **`ChannelList.test.tsx`**: the pen drawn once per workspace row in both trees as a real `<button
  type="button">`, named `Edit workspace`; rendered *after* the create plus (the Tab-order proof);
  the 14px glyph's whole opening run pinned as one string; the pill appended after `</svg>`; withheld
  from the unknown-workspace group in both trees; a hostile `cwd`/`workspace_label` reaching none of
  the pen's attributes; every existing workspace-row marker and tag-scan assertion unchanged.
- **`EditWorkspaceDialog.test.tsx`** (new, static markup): title/role/`aria-labelledby`, the field
  seeded (not `autofocus`ed) with the current label, the `cwd` rendered as an escaped child on its own
  line under the field, Save `disabled` on blank/whitespace/129 chars and enabled at 128, Cancel never
  disabled, a hostile label/`cwd` escaping to inert text with no attribute reached; the send helper
  sends exactly one `renameWorkspace`, `label: null` on the folder segment (not the current label),
  the `label` key present unconditionally, and a `../`-laden `cwd` passed through verbatim.
- **`e2e/sidebar-workspace-edit.spec.ts`** (new, own launch — beside, not inside,
  `sidebar-workspace-create.spec.ts`, whose own assertions had to stay untouched, and distinct from
  `sidebar-tree-geometry.spec.ts`, which owns tree placement and drives no hover): seeds one promoted
  row, mints the second tree's group at the same `cwd` via the FAB (`workspace-collapse.spec.ts`'s
  idiom), reads the **old** label first — a positive auto-waiting read, never an absence, the
  `workspace-updated-relist.spec.ts` ruling — then the pen's resting opacity, its drawn box (14px,
  right 28, 10px clear of the plus, row still 28 tall), click → path line text → type → Save → the
  **new** label in both trees with `aria-expanded` unchanged.
- **`e2e/sidebar-workspace-plus-name-pill.spec.ts`** (revised, not new) — see § Revision below.
- **`e2e/real-daemon-workspace-rename.spec.ts`** (#1293, [real-daemon credential-light
  e2e](real-daemon-credential-light-e2e.md)) is the real-daemon twin: the fake twin's
  `conversationStateFake` answers whatever `rename_workspace` the client sent, so it proves the frame
  leaves the app and nothing about whether a real `pyry` registers a handler for it. Pairs against a
  claude-less spawned daemon, reads the pre-save label off a `seedCwdSubdir` seed, drives the same
  pen → dialog → fill → Save gesture, and asserts the label changed on the daemon's own re-list —
  see that doc's § on the label-clearing trap this drive has to pin apart first.

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

- **No `serverId` on the send**, matching every other sidebar-originated command — with two servers
  paired sharing an identical `cwd`, `servers.route` resolves the sole connection ambiguously. Not a
  regression this ticket introduces; a per-server surface is its own future ticket.
- **No rejection is surfaced.** A daemon refusal (bad label, unknown path) closes the dialog and
  changes nothing, with no message — this verb is fire-and-forget and this client neither awaits nor
  correlates its reply. The dialog's own disable covers the two cases a user can actually reach.
- **A UTF-16-length mismatch against the daemon's own bound** can allow an astral-plane name here that
  the daemon then refuses — a silent no-op, not a security gap (§ How it works above).
- **A `workspace_updated` arriving mid-edit does not re-seed the open dialog's field** — deliberate,
  since clobbering an in-progress edit would be worse than a stale seed.

## Related

- [Channel list § Workspace grouping](channel-list.md#workspace-grouping) — the sidebar's read of the
  label this dialog changes, and the home of the "refusing a blank belongs to the dialog that sends the
  rename" ruling this ticket fulfils.
- [Channel List — the row's desktop geometry § The workspace row's own nest and its create-chat
  plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
  (#1178) and [§ the plus names itself in a pill](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181)
  (#1181) — the shared plus geometry and pill treatment this ticket's pen sits beside and reuses.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — the nearest structural sibling: a pure
  view plus container `useState` pair opening a fresh CSS block cloned from the Rename dialog's chrome.
- [Conversation workspace change § Workspace rename](conversation-workspace-change.md#workspace-rename-label-change-1289)
  (#1289) — the `renameWorkspace` wire contract, guard shape and security review this dialog's Save
  sends against; this ticket is that verb's first and, so far, only caller.
- [Rename conversation dialog](rename-conversation-dialog.md) (#360) — the chrome this dialog clones.
- [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) / #1293 — the real-`pyry`
  proof that a handler is registered for this verb, and the trap a fresh registry's fallback label
  hides from a careless choice of typed name.
- Spec: `docs/specs/architecture/1180-workspace-edit-dialog.md`.
