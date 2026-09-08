# #1180 — the workspace row's hover pen opens an Edit workspace dialog

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow`, `CollapsibleWorkspaceGroup`,
  `renderServerTrees`, `renderBody`, `ChannelListView`, `ChannelList`, `WorkspaceCreateControl`,
  `CREATE_CHAT_CONTROL_LABEL` — the prop chain the pen rides, and the container cells the dialog joins.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialogView` — the
  pure-view shape this dialog clones, including its ruling on Escape and the scrim.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` → `RenameConversationDialogView`,
  `requestRenameConversation` — the chrome to clone and the send helper's shape one verb over.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`,
  `workspaceLabelFor`, `UNKNOWN_WORKSPACE_KEY` — where a group's `key` and `label` come from, and the
  folder-segment derivation Save compares against. Its docblock names *this* ticket as the place a
  blank label is "refused to the user's face".
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace`,
  `.channel-list__workspace-head`, `.channel-list__workspace-create`, `.channel-list__control-name`,
  `.create-channel*` — the padding to retune, the plus's positioning idiom, the pill, the dialog block
  to mirror. `.channel-list__workspace-create`'s comment already reserves this ticket's 20px.
- `src/renderer/src/screens/settings/settings.css` → `.settings__default-workspace-value` — the
  wrapping-path recipe the path line takes.
- `src/shared/wire/types.ts` → `RenameWorkspacePayload` — `path` + nullable `label`, and its ruling
  that the client adds **no** path or length check of its own on the send path.
- `src/shared/ipc/commands.ts` → the `renameWorkspace` member and `isRenameWorkspacePayload` — the
  main-side guard this renderer's payload answers to.
- `src/main/index.ts` → the `case 'renameWorkspace':` arm — routed by server via
  `servers.route(command.serverId)`, exactly as `createConversation` is.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `WORKSPACE_ROW_MARKER`,
  `WORKSPACE_HEAD_MARKER`, `workspaceRowTagsIn`, `createTagsIn`, `treesOf`, `render` — every marker
  that must keep matching byte for byte, and the one helper that gains a prop.
- `e2e/sidebar-workspace-create.spec.ts` → the plus's drive. **Its step 6 presses Tab once from the
  disclosure and expects the plus focused** — the constraint that fixes this pen's DOM position.
- `e2e/workspace-updated-relist.spec.ts`, `e2e/rename-workspace-command.spec.ts` → the drive to copy,
  including the ruling that the opening read is a positive auto-waiting read of the OLD label.
- `e2e/fixtures/conversationStateFake.ts` → its `rename_workspace` arm already answers with a
  correlated `workspace_updated` and relabels its own rows. Nothing in the fake changes.
- `e2e/sidebar-tree-geometry.spec.ts` → reads the workspace **button's** box and the label's left
  edge, so the padding retune moves nothing it asserts.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1060 (pen `399:1339`,
plus `399:1065`); dialog chrome cloned from the Rename dialog,
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-498

Read 2026-09-08. The Workspace component's Hover state is a 340 × 28 row, `pl-[8px] py-[4px]`
**`pr-[52px]`** with a 10px gap: the 12px folder glyph, the title-small label, and two trailing
controls laid over the right padding — a 16 × 16 plus at `right: 2px; top: 6.01px` and a **14 × 14
"Icon Edgeless" pen at `right: 28px; top: 7.01px`**, both filled `--color-primary` on no background,
no radius and no row fill. The pen is the Font Awesome pen the conversation row's Rename control
already draws at 12px, here at 14. The Idle state draws neither control, and no dialog is drawn.

## Context

A workspace row reads whatever the daemon holds for that `cwd` (#1287), and since #1289 the client can
ask the daemon to change it — but nothing a user can reach sends that command. This ticket is the whole
of the reachable half: a pen on the row, a dialog behind it, and the send. Everything below the UI is
shipped and already driven; **nothing on the wire, in `src/main/` or in the fake changes here.**

The dialog also answers the question the sidebar has never been able to: *where is this workspace?* The
row shows a name (a daemon-held label, or a folder segment), and the full `cwd` has been undiscoverable
since #703 deliberately declined `title={label}`. A read-only path line inside the dialog is the first
surface that shows it — a rendered escaped child, never an attribute, which is what keeps that decline
intact.

**No ADR is warranted.** This adds no decision the neighbourhood has not already recorded: the pure
view plus container state is `CreateChannelDialogView`'s shape, the send helper is
`requestRenameConversation`'s, and the wire contract is #1289's.

### Size — the overage, stated rather than hidden

The refiner estimated ~1050 lines against an 800-line boundary and argued no split exists. Re-measured
against this plan, that holds and the **floor rule decides it**: the only cut available separates the
dialog from the pen, and each half's sole consumer is the other — a control that opens nothing and a
dialog nothing opens, neither verifiable alone. Every other line of the boundary holds comfortably:
2 production `.tsx` files (`ChannelList.tsx` + one new module) plus `channels.css`, 2 new exports, 0
consumer call sites needing simultaneous update, 5 acceptance criteria, no state machine and no reject
branches. Building it as one ticket.

## Design

### 1. The pen — `WorkspaceRow`'s second optional trailing control

A new module-private type beside `WorkspaceCreateControl`:

```
type WorkspaceEditControl = { readonly label: string; readonly onEdit: () => void }
```

Same bundled-object shape and for the same stated reason: a name with no handler, or a handler with no
name, cannot be constructed. `onEdit` is **nullary**, so no component below `renderServerTrees` handles
a `cwd` — the rule that file's comments already state for `create`.

The chain, all additive and all optional:

- `WorkspaceRow` gains `edit?: WorkspaceEditControl`, drawn as an icon-only `<button
  className="channel-list__workspace-edit" aria-label={edit.label}>` holding a 14px `<svg
  className="channel-list__workspace-edit-icon" viewBox="0 0 12 12" …>` — the path
  `.channel-list__rename-icon` carries, drawn at 14 — plus the shipped
  `.channel-list__control-name` pill span, appended **after** the closing `</svg>` so the glyph's
  opening run stays byte-identical (the append discipline #1181 records).
- `CollapsibleWorkspaceGroup` gains `edit?: WorkspaceEditControl` and passes it through.
- `renderServerTrees` gains a trailing `edit?: { label: string; onEdit: (cwd: string, label: string)
  => void }` and closes over the group: `{ label: edit.label, onEdit: () => edit.onEdit(group.key,
  group.label) }`. Withheld on `group.key === UNKNOWN_WORKSPACE_KEY` — decided on the **key**, never
  on the label, exactly as `create` is.
- `renderBody` gains `onEditWorkspace: (cwd: string, label: string) => void` and hands the same
  control object to **both** trees.
- `ChannelListView` gains `onEditWorkspace`, required rather than optional for the reason every sibling
  callback states: a defaulted prop would let a future caller silently render a sidebar whose pen
  opens nothing.

**ONE label constant for both trees**, `EDIT_WORKSPACE_CONTROL_LABEL = 'Edit workspace'`, unlike
`create`'s two — the pen says the same word in each tree, so a second constant would be two literals
kept in step by hand. Client-owned, in the `CREATE_CHAT_CONTROL_LABEL` idiom; the workspace label
reaches it nowhere.

**⭐ THE PEN IS RENDERED AFTER THE PLUS IN THE DOM, AND THAT IS FORCED RATHER THAN CHOSEN.**
`e2e/sidebar-workspace-create.spec.ts`'s step 6 focuses the disclosure button and presses Tab **once**,
asserting the plus receives focus. A pen inserted before the plus takes that Tab and reddens a shipped
spec this ticket must leave untouched. The cost, stated: tab order runs disclosure → plus → pen while
the drawn order is pen → plus, so a keyboard user reaches the two trailing controls right-to-left.
Accepted — both are absolutely positioned, so DOM order drives neither layout nor the drawn result, and
re-ordering the pair is #1178's spec to change, not this ticket's.

### 2. The geometry — one CSS block, no new literal beyond the drawing's own

`.channel-list__workspace-edit` is `.channel-list__workspace-create`'s block with two numbers changed,
positioning itself against the wrapper's trailing edge rather than against a sibling (which is exactly
what that rule's comment promises it does):

| | plus (shipped) | pen (this ticket) |
|---|---|---|
| box | `--space-5` (20) at `right: 0` | `--space-5` (20) at `right: calc(var(--space-7) - 3px)` |
| top | `var(--space-1)` (4) | `var(--space-1)` (4) |
| glyph | 16 × 16 centred | 14 × 14 centred |

A 20px box at right 25 centring a 14px glyph lands that glyph at right 25 + (20−14)/2 = **28** and top
4 + 3 = **7** — the drawn rectangle, derived from tokens rather than restated as an inset, and the
`right: calc(var(--space-7) - 3px)` the ticket names. The two 20px hit boxes (0…20 and 25…45 from the
right edge) do not overlap. Reveal, `:focus-visible` and pill trigger are the plus's rules verbatim,
including `opacity: 0` and never `display: none` — the control must stay focusable without a prior
hover.

`.channel-list__workspace`'s `padding-right` moves from `var(--space-8)` (the Idle 32) to
`calc(var(--space-8) + var(--space-5))` (the Hover 52), written as the sum so the arithmetic stays
legible — the Idle reservation plus the pen's own box, the shape `.channel-list__workspace`'s `gap`
already uses. The existing comment that names the 20 as this ticket's is **updated in place**, not
joined by a second. The label's content box then ends 52 in, and the pen's hit box starts 45 in, so
no glyph of a long label is painted under either control **at rest as well as on hover** (AC3) — which
is the whole reason the padding moves rather than being toggled on hover.

The workspace **button's** own box is unchanged (padding is inside it), so
`e2e/sidebar-tree-geometry.spec.ts`'s trailing-edge and `WORKSPACE_LABEL_X` assertions are untouched.

### 3. The dialog — a new module, `EditWorkspaceDialog.tsx`

Two exports, both pure and server-renderable.

```
export function EditWorkspaceDialogView(props: {
  name: string
  path: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element

export function requestRenameWorkspace(
  sendCommand: (command: RendererCommand) => void,
  cwd: string,
  name: string
): void
```

Markup is `CreateChannelDialogView`'s, retitled "Edit workspace", the field **seeded** rather than
empty, and one element added: a `<p className="edit-workspace__path">{path}</p>` under the field.
Save's `disabled` is computed inline from the trimmed name so the state is directly assertable in
static markup.

**A fresh `.edit-workspace-*` CSS block**, mirroring `.create-channel*` declaration for declaration
plus the path line — not a reuse of `.rename-conversation*`. Playwright runs locators in strict mode
and `e2e/conversation-create-rename.spec.ts` scopes to the Rename dialog's classes, so a second dialog
wearing them would strict-violate; and this dialog's extra line would land inside markers
`RenameConversationDialog.test.tsx` pins. That is `CreateChannelDialogView`'s own stated reason for
minting the fourth such block.

The path line takes `.settings__default-workspace-value`'s recipe (body-small, on-surface-variant,
`overflow-wrap: anywhere`) under its own class — **wrapping is the point**, so not the thread chip's
nowrap mono treatment and not an ellipsis. The panel inherits `max-height: 90%; overflow-y: auto`, so
an unbounded `cwd` scrolls inside the panel instead of blowing out the window.

**No Escape handler and no scrim `onClick`** — the ticket pins this dialog's close behaviour to the
Rename dialog's, and today that is Cancel alone. Matching therefore means *adding nothing*, which also
keeps a fifth unconditional `document` listener off a window that already has several.

**`autoFocus` is not carried over.** `CreateChannelDialogView` sets it because its field opens empty;
this one opens seeded, and stealing focus into a prefilled field invites an accidental overwrite.

### 4. The send

`requestRenameWorkspace` is `requestRenameConversation`'s shape one verb over: an inline command
literal typed as `RendererCommand`, no constructor, fire-and-forget.

```
payload = { path: cwd, label: trimmed === workspaceLabelFor(cwd) ? null : trimmed }
```

- `path` is the group's `cwd` **verbatim** — not normalised, not trimmed, no `path` module. Daemon
  text making its first trip back out, so echoing exactly what was received is the only safe handling;
  main re-validates at the untrusted IPC boundary and rebuilds a fresh literal before the wire.
- `label` is `null` when the trimmed name equals the **folder segment** (`workspaceLabelFor(cwd)`),
  never when it equals the *current* label — that is the whole of "the way back to the folder name is
  Save itself". `workspaceLabelFor` returns `null` for an unusable `cwd`, which a non-blank trimmed
  name can never equal, so the fallback group needs no special case (and is withheld the pen anyway).
- The key is named unconditionally: an absent `label` is a contract violation the daemon rejects as
  malformed; a literal `null` is the value "clear it".
- **No `serverId`**, exactly as the sidebar's shipped `createConversation` sends none — `servers.route`
  resolves the sole connection. Named in the security review below.

**Why a 128-character disable here does not contradict the wire type's "no length check".** That rule
governs the *send path* — `requestRenameWorkspace` refuses nothing and truncates nothing, so the client
cannot drift from the daemon's authoritative rule. The disabled Save is an *affordance*: it refuses to
the user's face before a command exists at all, which is precisely the home `groupByWorkspace`'s
docblock already names for it ("refusing a blank belongs to … the dialog that sends it (#1180)").

## State + concurrency model

Two component-local `useState` cells in `ChannelList`, beside the three dialogs already there —
`editWorkspaceCwd: string | null` and `editWorkspaceName: string`, seeded together on open so a reopen
always starts from the row's current label. No store, no reducer, no context: ADR 0006's lowest scope
that resets correctly, and the transient-per-interaction posture every sibling dialog uses.

Rendered on `editWorkspaceCwd !== null` and **never on truthiness** — an empty-string `cwd` would
collapse into "no dialog open" under a truthy test. Unreachable today because the unknown-workspace
group is withheld the pen, and writing the check this way is what keeps that withhold load-bearing for
one reason rather than two.

No async work, no timers, no listeners, no subscriptions — so nothing to cancel and no `AbortSignal`.
`window.pyry` is dereferenced inside the click arrow alone, never during render (the
`onNewConversation` discipline), so the container stays server-renderable.

A `workspace_updated` landing mid-edit re-lists the sidebar under the open dialog and does **not**
re-seed the field — clobbering what the user is typing would be worse than a stale seed. If the group
itself disappears, Save sends a `path` the daemon answers `workspace.not_found`; harmless, since the
lookup is exact equality and never a path join.

## Error handling

Nothing here can throw: no parse, no I/O, no promise. The only failure mode is a **daemon-side
rejection** (a label the daemon's own rules refuse, or an unknown `path`), which this client neither
awaits nor correlates — #1289's stated posture for the whole verb. The user-visible result is a dialog
that closed and a row that did not change. Surfacing rename rejections is out of scope and named
below; it needs a correlation path no client surface has today.

No `console.*` on any path added here. Every log that would be useful carries the `cwd` or the label —
daemon content in a log, which ADR 0007's content-free rule and `CLAUDE.md` both forbid.

## Testing strategy

**Unit — `ChannelList.test.tsx`** (`render` gains `onEditWorkspace={noop}`; every existing marker
stays byte-identical, and the new class carries its own closing quote so it joins neither
`WORKSPACE_ROW_MARKER` nor `createTagsIn`'s marker):

- the pen is drawn once per workspace row in **both** trees, named `Edit workspace`, as a real
  `<button type="button">`;
- a group rendered **without** the callback carries none;
- withheld from the unknown-workspace group (`cwd: ''`), whose row still renders;
- the 14px glyph's whole opening run is pinned as one string;
- a hostile `cwd` and a hostile `workspace_label` reach none of the pen's attributes — no `title`, no
  `aria-label` beyond the client constant;
- the workspace row's own tag scan still returns tags with no `aria-label` and no `title`, and
  `WORKSPACE_ROW_MARKER` / `WORKSPACE_HEAD_MARKER` counts are unchanged.

**Unit — `EditWorkspaceDialog.test.tsx`** (`renderToStaticMarkup`, the `CreateChannelDialog.test.tsx`
shape): the title, the field seeded with the current label, the `cwd` rendered as escaped text with a
hostile value reaching no attribute, Save `disabled` on blank / whitespace-only / 129 characters and
enabled at 128, Cancel never disabled, and the `role="dialog"` + `aria-labelledby` pair.

**Unit — the send helper**: trims; sends `label: null` for the folder segment and the trimmed string
otherwise; `path` passes through verbatim including a `../`-laden value; exactly one command.

**Fake tier — `e2e/sidebar-workspace-edit.spec.ts`**, beside `sidebar-workspace-create.spec.ts` (its
own launch, that file's stated reason for not extending `sidebar-tree-geometry.spec.ts` — which owns
tree *placement* and drives no hover; the pen's numbers belong beside the plus's, which live in the
create spec). One launch, one sequential drive, seeded with a daemon-held label:

1. a **positive auto-waiting read of the OLD label** first — `workspace-updated-relist.spec.ts`'s
   ruling, without which the drive proves nothing;
2. at rest the pen's computed opacity is `0`; hovering the row's *label* reveals it (a scope claim as
   much as a visibility one);
3. its drawn box — 14 × 14, right edge 28 in from the row's right edge, vertically centred, 10px clear
   of the plus, `--color-primary`, row still 28 tall;
4. click it, read the path line's text, type a new name, Save;
5. the closing assertion: `.channel-list__workspace-label` in **both** trees reads the new name, and
   `aria-expanded` on the disclosure is unchanged.

Playwright counts an opacity-0 element as visible and hovers the row on the way to clicking, so no
explicit hover is needed before the click.

## Open questions

1. **Does the pen belong before or after the plus in the DOM?** Resolved in Design §1 — after, forced
   by `sidebar-workspace-create.spec.ts`'s single-Tab assertion. Recorded here because the drawn order
   is the opposite and a reader will ask.
2. **Does seeding the field mean `autoFocus`?** Resolved in Design §3 — no.
3. **Does the path line need a caption?** Resolved — no. AC4 asks for *one* line showing the `cwd`;
   a caption plus a value is two.

Anything that moves during implementation lands in a `## Revisions` entry in the same commit as the
code that departs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. Two untrusted daemon strings enter this surface, and the design
  names every sink for each. The `cwd` (`group.key`) reaches exactly three: an escaped React **child**
  in `.edit-workspace__path`, the `payload.path` wire field, and `workspaceLabelFor(cwd)` — which is
  deliberately string-splitting and nothing else (its docblock forbids `path`, `fs`, `node:*`, `URL`,
  and it is total over `string`). The label reaches the controlled input's `value` and a `useState`
  cell. **Explicitly declined, each a MUST FIX if it appears:** no `title`, no `aria-label` built from
  either value, no `id`, no React key, no CSS custom property, no class-name interpolation, no
  `Map`/lookup key, no log line. The renderer→main boundary is unchanged and explicit —
  `isRenameWorkspacePayload` re-validates and `renameWorkspaceEnvelope` rebuilds a fresh literal.
  *Checked against the inherited-contract trap:* `WorkspaceRow`'s four-sink decline was written when
  the `cwd` was never rendered at all; this ticket renders it for the first time, so the decline is
  re-derived here rather than inherited, and the input's `value` is called out as the one
  attribute-shaped sink — React-escaped, the field's own content, and `RenameConversationDialogView`'s
  shipped precedent for exactly this.
- **[Tokens, secrets, credentials]** Not applicable, and by construction rather than by omission: this
  ticket adds no credential, reads none, and touches no storage. The pairing token and static key stay
  in main; nothing on this path can name them.
- **[File / storage operations]** No findings, and the path-traversal category is answered rather than
  waved past: `path` is renderer-supplied text the daemon looks up by **byte-for-byte equality against
  a stored `cwd`**, never a join, so a `../`-laden value is answered `workspace.not_found` rather than
  traversing anything (`RenameWorkspacePayload`'s docblock). This client resolves it against no local
  filesystem, writes nothing to disk, and reads nothing from it. A unit test sends a `../` value
  through the helper to pin that it passes through verbatim rather than being "sanitised" into
  something the daemon would match differently.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no new
  `contextBridge` member, no `webPreferences` change, no protocol handler, no navigation. The command
  rides the shipped `window.pyry.sendCommand` bridge and is validated at the main boundary by a guard
  that already exists and already has tests.
- **[Cryptographic primitives]** Not applicable — no randomness, no comparison against a secret, no
  key, no nonce. The one equality in the design (`trimmed === workspaceLabelFor(cwd)`) compares two
  display strings, neither secret, so `timingSafeEqual` would be noise.
- **[Network & I/O]** No findings of this ticket's making. Frame caps, TLS, timeouts and backoff are
  the shipped relay client's and are untouched. The one thing this ticket *adds* to the wire is a
  renderer-typed string of unbounded length: the daemon caps it at 128 server-side, and the dialog
  disables Save past 128 as an affordance. **SHOULD FIX, carried into Phase B:** the client bound is
  measured in UTF-16 code units (`String.prototype.length`) and the daemon's is not necessarily the
  same unit, so an astral-plane name can be allowed here and refused there. Not exploitable — the
  daemon is authoritative and refuses — but it produces a silent no-op, which is the next finding.
- **[Error messages, logs, telemetry]** No findings. Zero `console.*` on every path added, for the
  stated reason that any useful log carries the `cwd` or the label. No error object, no stack trace and
  no telemetry is produced here; the user-facing surface renders no daemon-supplied error string.
- **[Concurrency]** No findings. Nothing async is launched, so there is nothing to own, cancel or tear
  down; no timer, no listener, no `AbortController` needed. The one check-then-act shape — a `cwd`
  captured at open and sent after an `await`-free edit — is safe because the send is a pure function of
  captured state and the daemon's lookup is exact-equality: a group that vanished mid-dialog yields a
  refused rename, never a rename of a *different* workspace.
- **[Threat model alignment]** A **hostile daemon** is the live actor here, and it drives both strings:
  an over-long or markup-bearing `workspace_label` and the same in a `cwd`. Both are bounded by
  construction — the label ellipsizes in the row and is escaped in the field, the path wraps inside a
  `max-height: 90%; overflow-y: auto` panel, and React escapes both — so the worst reachable outcome is
  an ugly dialog, not script execution or an unbounded layout. A **compromised renderer** gains nothing
  new: it could already call `sendCommand` with any `renameWorkspace` payload before this ticket
  existed (`rename-workspace-command.spec.ts` does exactly that), so the pen widens no capability, only
  the UI reaching an existing one. A **malicious relay** is unchanged — content-blind and on-path, and
  this verb is fire-and-forget, so dropping it degrades to "nothing happened".
- **[OUT OF SCOPE — no `serverId` on the send]** With two servers paired, two machines can hold the
  same `cwd` and the sidebar draws a group for each; sending no `serverId` lets `servers.route` resolve
  the sole connection, which is ambiguous beyond one. This is **not** a regression this ticket
  introduces — every sidebar-originated command sends none today (`requestNewConversation`,
  `requestNewChannel`), and #1289's own spec records that #1180 would do the same "until a per-server
  surface exists". Threading a server id belongs to that surface, spanning every sidebar create, not to
  this pen. Naming it here so it is findable.
- **[OUT OF SCOPE — no rejection is surfaced]** A daemon refusal (bad label, unknown path) closes the
  dialog and changes nothing, with no message. Correlating `rename_workspace` replies needs a client
  surface none of the fire-and-forget verbs has; #1289 records the same. Not filed as a bug here
  because the dialog's own disable covers the two cases a user can actually reach.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
