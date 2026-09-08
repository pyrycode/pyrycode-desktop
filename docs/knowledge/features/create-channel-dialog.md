# Create-channel dialog

The dialog opened by the [Channels-tree workspace plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178):
a Name field and a Cancel/Create pair that mints a **named channel directly** —
`is_promoted: true` on the first `createConversation` send — in the workspace whose plus was
clicked. Until this ticket a channel could only come into being by
[promoting a chat](save-as-channel-dialog.md); this is the first affordance that skips that step.

Introduced in #1179, split from [#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
— that ticket opened the seam (`renderServerTrees` takes an optional trailing create control) and
left the Channels side unfilled. No wire change, no daemon change: `CreateConversationPayload`'s
`is_promoted`/`name`/`cwd` fields have all been honoured by the daemon since
[#241](conversation-create.md), the client had simply never sent anything but
`is_promoted: false, name: null`.

## What it does

- Every Channels-tree workspace row, except the unknown-workspace group, draws a trailing plus on
  hover or keyboard focus — the same 20×20 box, glyph and reveal rule the Chats-tree plus
  ([#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178))
  already draws, told apart only by its accessible name, `"Create channel"`. Clicking it never
  toggles the group's fold — the plus and the disclosure button are siblings, not nested (#274).
- The plus opens a centered `role="dialog"` modal titled "Create channel": one Name field, empty
  and focused, plus Cancel and Create. Create is disabled while the name is blank or
  whitespace-only. Cancel closes the dialog and sends nothing.
- Create sends exactly one `createConversation` with `is_promoted: true`, the trimmed name and the
  clicked group's `cwd`, then closes the dialog. There is no optimistic row: when the daemon
  confirms with `conversationCreated`, the already-mounted
  [`useConversationCreatedNav`](new-discussion-fab.md#the-nav-wiring-srcrenderersrcpairedshelltsx)
  opens the new channel's thread, the same event-driven nav the FAB and the Chats-tree plus use.
- No location choice — unlike [Save-as-channel](save-as-channel-dialog.md), which keeps its radio
  group because it also serves the promote-a-chat case where the chat's own folder is an option.
  Here the workspace is fixed by the row whose plus was clicked.
- A create the daemon rejects behaves as it does for the FAB today: the dialog has already closed
  by then, and there is no failure surface. Escape and the scrim close nothing, matching whatever
  the [Rename dialog](rename-conversation-dialog.md) supports today — Cancel alone.

## How it works

**No drawing of its own.** Verified against the Figma on 2026-09-08: the Desktop page's Dialogs
section holds exactly four — Rename, Save as Channel, Create Folder, Paste Code. This dialog
clones the Rename dialog's chrome (102:498 — overlay, scrim, panel, outlined field) with the
Create Folder dialog's (102:528) Cancel/Create action pair; the two shipped nodes are
byte-identical in chrome and differ only in title, field label and the second action's word, which
is what makes the borrow sound rather than a guess.

**`CreateChannelDialogView`** (`src/renderer/src/screens/channels/CreateChannelDialog.tsx`, new)
is a pure view in the `RenameConversationDialogView` shape — props in, markup out, no store, no
`window.pyry`, no effects:

```ts
CreateChannelDialogView({
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onCreate: () => void
}): JSX.Element
```

**`name` renders as one sink only** — the controlled input's auto-escaped `value` — and nothing
else derives an attribute from it. `Create` is disabled inline on `name.trim() === ''`, which is
what makes the disabled state directly assertable in server-rendered markup: a disabled button
renders `disabled=""`, an enabled one omits the attribute.

**Focus is one attribute, not a ref.** `autoFocus` on the input is what makes AC2's "empty and
focused" true in the running app, and React's server renderer emits `autofocus=""` for it —
verified in this tree, contrary to the common belief that the server renderer strips it — so the
same declaration is assertable in the static unit tier instead of being visible to e2e alone. A
ref plus a mount effect would have been invisible to every gate but e2e.

**The `cwd` is not a prop, on purpose — the strongest available form of AC2's "no attribute
carries the workspace label or the `cwd`".** The view has no `cwd` parameter at all, so no
attribute of the overlay, panel, field, input or either action can derive from it even by a future
edit. Passing one is a type error, not a review finding. The container closes over it instead.

**Container state, the `renameRow`/`renameName` pair's shape** — two `useState` cells in
`ChannelList` (`src/renderer/src/screens/channels/ChannelList.tsx`), transient and dying with the
dialog:

```ts
const [createChannelCwd, setCreateChannelCwd] = useState<string | null>(null)
const [createChannelName, setCreateChannelName] = useState('')
```

The dialog mounts on `createChannelCwd !== null` — an **explicit null check, never a truthiness
test** — so a hypothetical empty-string `cwd` cannot collapse into "no dialog open" (the trap
`App.tsx`'s `openConversationId` names). It is unreachable in production today because
`renderServerTrees` withholds the plus from the unknown-workspace group, whose key *is* the empty
string; the explicit check keeps that withhold load-bearing for one reason, not two. Opening seeds
both cells together (`setCreateChannelCwd(cwd); setCreateChannelName('')`), so a reopen always
starts from an empty field with no store to reset. `window.pyry` is dereferenced inside the Create
handler alone, never during render, so the container stays server-renderable.

No mutual-exclusion logic is needed between this dialog and Save-as-channel/Rename: an open
dialog's fixed-inset overlay covers the window, so the affordance behind it is not clickable — the
`renameRow` comment's own reasoning, unchanged.

**The command — `requestNewChannel`, `requestNewConversation`'s sibling**
(`src/renderer/src/store/conversationCreatedBridge.ts`):

```ts
function requestNewChannel(
  sendCommand: (command: RendererCommand) => void,
  name: string,
  cwd: string
): void {
  sendCommand({
    type: 'createConversation',
    payload: { is_promoted: true, name: name.trim(), cwd }
  })
}
```

Placed **directly beside** `requestNewConversation`, not behind an `is_promoted` flag on the
existing constructor: two callers with two fixed payload shapes read better than one with a
switch, and each keeps a single-literal unit test. `name` is trimmed — cosmetic, not a validation;
the daemon polices the name server-side, and the view's blank-disable means this is never reached
with an empty one. `cwd` is **required and non-null** (a channel is created in a named workspace,
never the daemon's default) and travels **verbatim** — no normalisation, no `path` module — the
same obligation [#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
already carries for the Chats-tree plus's `cwd`. Fire-and-forget, like its twin: `sendCommand` is
`void`, and `isCreateConversationPayload` plus `daemonConnection.createConversation`'s fresh-literal
rebuild re-validate at the untrusted IPC boundary, unchanged by this ticket. See [Conversation
create](conversation-create.md) for the full transport-layer detail both constructors share.

**The plus's name and handler travel as one object, not two parallel optional props.**
`WorkspaceRow` used to hard-code `CREATE_CHAT_CONTROL_LABEL` on its `aria-label`; giving the
Channels tree its own label needed a second value to reach the same control. A `createLabel?`
prop beside `onCreate?` would have admitted a handler with no name and a name with no handler, and
would have needed a default that silently mislabels one tree. Instead a module-private
`WorkspaceCreateControl = { readonly label: string; readonly onCreate: () => void }` threads
through `renderServerTrees` → `CollapsibleWorkspaceGroup` → `WorkspaceRow` as one optional value,
so the invariant is structural: a tree either offers a create — named — or offers none.
`renderBody` builds the two control objects (`CREATE_CHANNEL_CONTROL_LABEL` /
`CREATE_CHAT_CONTROL_LABEL`, both client-owned module constants) at its two `renderServerTrees`
calls — the one place the two trees are told apart — so neither label constant nor either
component underneath ever handles a daemon-derived `cwd`. Full geometry, the shared plus CSS class
and the withhold-by-key rule for the unknown-workspace group live in [Channel List — the row's
desktop geometry § The workspace row's own nest and its create-chat
plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178).

### CSS (`channels.css`)

A fourth `*-overlay` block, `.create-channel*`, mirroring `.rename-conversation*` declaration for
declaration with two Figma-confirmed differences: the title reads "Create channel" and the second
action is `.create-channel__create`. **A separate class family, not a reuse of
`.rename-conversation*`** — `e2e/conversation-create-rename.spec.ts` scopes to the Rename dialog's
own classes under Playwright's strict-locator mode, and a second dialog wearing them would
strict-violate that spec's match set rather than fail an assertion (AC5 requires it to pass
unedited). `position: fixed` escapes the `.channel-list` scroll column; `z-index: 2` lifts it
above the sticky FAB. Two documented token gaps: Figma's 4px field corner maps to `--radius-xs`
(6px, the `.rename-conversation__field` precedent), and Figma's label-medium (12px) maps to
`--text-label-small` (11px, a 1px delta) since the theme has no label-medium token.

### Data flow

```
Channels-tree plus click → ChannelList seeds createChannelCwd/createChannelName → dialog mounts

Create click → requestNewChannel(window.pyry.sendCommand, createChannelName, createChannelCwd)
  → sendCommand({type:'createConversation', payload:{is_promoted:true, name:trimmed, cwd}})
  → [#241, unchanged] COMMAND_CHANNEL → createConversation(payload) → daemon
  → dialog closes (setCreateChannelCwd(null))

daemon → conversation_created frame → [#241, unchanged] → conversationCreated DaemonEvent
  → useConversationCreatedNav's subscription (PairedShell, mounted since #242)
    → dispatch({ type: 'open' }) → the new channel's thread renders
```

## Testing

- **`CreateChannelDialog.test.tsx`** (new, static markup): title/role/`aria-labelledby`, one Name
  field rendering `autofocus=""` and `value=""`, Create `disabled=""` for `''` and `'   '` and
  omitted for a real name, Cancel never disabled, a hostile name escapes to an inert attribute
  value (asserted on the escaped delimiters, not on the payload's words — see § Lessons below),
  and no `title=` anywhere.
- **`ChannelList.test.tsx`**: `aria-label="Create channel"` once in a Channels-slice render and
  zero times in Chats, the reverse for `"Create chat"`; `createTagsIn` now asserts two controls by
  their two distinct labels (widened from one, the one assertion #1178 left that a second plus
  breaks); #1178's structural markers still count once per group per tree; the unknown-workspace
  group draws no plus in either tree.
- **`conversationCreatedBridge.test.ts`**: `requestNewChannel` sends exactly one command whose
  literal is `{is_promoted:true, name:<trimmed>, cwd}`, with the `cwd` echoed byte-for-byte.
- **`e2e/sidebar-create-channel.spec.ts`** (new, one launch): seeds one **promoted** row at a `cwd`
  other than the fake's `DEFAULT_CREATED_CWD` — that single choice makes all three payload fields
  detectable by one number, since a create sent with a null `cwd` or `is_promoted: false` would
  each mint a *second* `.channel-list__workspace` group. Drives click → dialog open/focus/empty →
  disabled/enabled transitions as text arrives → Cancel sends nothing (proved by the final row
  count, not a vacuous absence) → reopen shows an empty field → Create → the row count and the
  open row's title (the typed name, not a `null`-name "Untitled" placeholder) as the positive
  reads, then the still-one-group / zero-Chats-plus reads as confirmation.
- `e2e/sidebar-workspace-create.spec.ts`, `e2e/save-as-channel-promote.spec.ts` and
  `e2e/conversation-create-rename.spec.ts` are the regression set (AC5) and are unedited — the
  first seeds a single unpromoted row, so its render has no Channels group and its strict
  `.channel-list__workspace-create` locator still resolves to exactly one element even though both
  trees now draw that class.
- **`e2e/real-daemon-create-channel.spec.ts`** (#1283, [real-daemon credential-light
  e2e](real-daemon-credential-light-e2e.md)) is the real-daemon twin: `conversationStateFake` mints
  its row *from the request*, so `sidebar-create-channel.spec.ts` above proves what the client
  sends and nothing about what the daemon does with it. This is the first spec on any tier to
  exercise the daemon's promoted-create branch against a real `pyry`, and it reads all three
  payload fields back off the daemon's own list rather than an echo.

## Lessons learned

- **`renderToStaticMarkup` emits `autofocus=""` for React's `autoFocus`.** The common assumption
  is that the server renderer strips boolean-attribute props like this; it does not, which is what
  lets "opens focused" be proven in the static unit tier instead of e2e alone.
- **An escaped-attribute test that checks for the absence of the payload's *words* detects the
  wrong thing.** `renderView('<img src=x onerror=boom>')` renders
  `value="&lt;img src=x onerror=boom&gt;"` — `onerror=boom` survives verbatim and is inert only
  because the delimiters (`<`, `>`) are escaped. A `not.toContain('onerror=boom')` assertion
  passes against *correct* code and would also pass on a sink that interpolated the same string
  into a `title` attribute instead. Assert the whole escaped value.
- **Two parallel optional props are how a control's name and its handler drift apart.** See § How
  it works above — the fix was bundling both into one `WorkspaceCreateControl` value rather than
  adding a second optional prop beside the existing one.

## Edge cases and limitations

- **No error surface.** Same posture as the FAB and the Chats-tree plus: `sendCommand` is `void`,
  and a create the daemon declines simply mints no row. Adding a rejected state and failure copy
  is future work, not this ticket's.
- **No `serverId` on the command**, matching the FAB and [#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178):
  with more than one host paired this routes to the most recently paired one. Wrong for all three
  callers or none; its own ticket if it needs fixing.
- **A rapid double-click on Create cannot double-fire** — the first click unmounts the dialog,
  taking the button with it. The plus itself can still be double-clicked, exactly as the FAB and
  the Chats-tree plus can; unchanged by this ticket.

## Related

- [Channel List — the row's desktop geometry § The workspace row's own nest and its create-chat
  plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
  (#1178) — the shared plus geometry, CSS class and the withhold-by-key rule both trees' pluses use.
- [Conversation create (transport)](conversation-create.md) / [#241 codebase notes](../codebase/241.md)
  — the `createConversation` command / `conversationCreated` event both `requestNewConversation`
  and `requestNewChannel` send through, unchanged by this ticket.
- [New-discussion FAB](new-discussion-fab.md) / [#242 codebase notes](../codebase/242.md) —
  `requestNewConversation`'s original caller and `useConversationCreatedNav`'s home; this dialog's
  Create reuses the same nav, unchanged.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274](../codebase/274.md) — the only
  other route to a channel before this ticket, and the reason this dialog has no location choice:
  Save-as-channel's radios exist because it also serves the promote-a-chat case.
- [Rename conversation dialog](rename-conversation-dialog.md) / [#360](../codebase/360.md) — the
  chrome this dialog clones (overlay/scrim/panel, the `TITLE_ID` idiom, no Escape/scrim close).
- [Channel List home screen](channel-list.md) / [#141 codebase notes](../codebase/141.md) — the
  parent screen; § Workspace grouping is where `groupByWorkspace`/`UNKNOWN_WORKSPACE_KEY` (the
  withhold this dialog's plus relies on) are defined.
- [Real-daemon credential-light e2e](real-daemon-credential-light-e2e.md) / #1283 — the real-daemon
  proof of this dialog's create, including the `cwd`-defaulting trap and the `seedCwdSubdir` fixture
  option built to make it non-vacuous.
- Spec: `docs/specs/architecture/1179-channels-tree-create-channel-dialog.md`.
