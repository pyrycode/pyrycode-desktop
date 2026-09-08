# #1179 — the Channels-tree workspace plus opens a Create channel dialog

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `ChannelListView`, `renderBody`,
  `renderServerTrees`, `CollapsibleWorkspaceGroup`, `WorkspaceRow`, `CREATE_CHAT_CONTROL_LABEL`,
  `RENAME_CONTROL_LABEL` — the whole edit surface: #1178's four-level create seam, the two container
  `useState` pairs the new dialog's state is modelled on, and the control-name constant the second one
  is written beside.
- `src/renderer/src/screens/channels/RenameConversationDialog.tsx` → `RenameConversationDialogView`,
  `requestRenameConversation`, `RENAME_CONVERSATION_TITLE_ID` — the pure-view + fixed-title-id shape the
  new dialog clones, and the "blank computed inline so the disabled state is server-assertable" idiom.
- `src/renderer/src/screens/conversation/CreateFolderDialog.tsx` → `CreateFolderDialogView` — the
  Cancel / **Create** action pair, and the precedent for a dialog whose field opens EMPTY rather than
  prefilled.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewConversation`,
  `useConversationCreatedNav` — the command constructor the new one sits beside, and the event-driven
  nav that opens the created channel. No bridge behaviour changes.
- `src/shared/wire/types.ts` → `CreateConversationPayload`, `ConversationCreatedPayload` — the three
  nullable-and-PRESENT fields, and the reply the fake mints its row from.
- `src/shared/ipc/commands.ts` → `isCreateConversationPayload`, the `createConversation` arm of
  `isRendererCommand` — the untrusted renderer→main guard this ticket sends a second payload shape
  through, unchanged.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`,
  `UNKNOWN_WORKSPACE_KEY`, `partitionActive` — `group.key` IS `row.cwd`; the unknown bucket's key is
  `''` and must draw no plus in EITHER tree.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-create`,
  `.channel-list__workspace-head:hover …`, `.rename-conversation*` — the control block this ticket
  reuses verbatim, and the dialog block the new one mirrors.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `createTagsIn`, `CREATE_CHAT_MARKER`,
  `WORKSPACE_ROW_MARKER`, `WORKSPACE_HEAD_MARKER`, `workspaceRowTagsIn`, `treesOf` — the one assertion
  a second plus breaks, and the markers AC4 pins.
- `e2e/sidebar-workspace-create.spec.ts` → its `.channel-list__workspace-create` strict locators and
  the ⭐ seed note — AC5 requires it to pass unedited, and its seed is what keeps it single-match.
- `e2e/fixtures/conversationStateFake.ts` → the `create_conversation` arm
  (`is_promoted: payload.is_promoted ?? false`, `name: payload.name`,
  `cwd: payload.cwd ?? DEFAULT_CREATED_CWD`) and `DEFAULT_CREATED_CWD` (`/fake/workspace`) — all three
  requested fields are honoured, which is what makes ONE group count a detector for all three.
- `docs/specs/architecture/1178-*.md` § Design, § Security review — the four-sink rule on the group key,
  the verbatim-`cwd` obligation, and the unknown-group withhold this ticket inherits.

## Design source

**Figma:**

- The row the plus sits on: https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=106-3160
  (Workspace Hover `399:1060`, plus `399:1065`) — unchanged from #1178.
- The dialog chrome, cloned absent a drawing of its own: Rename dialog
  https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-498 with the
  Cancel / Create pair from the Create Folder dialog
  https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-528.

The plus is the same 16×16 "Icon Edgeless" the Chats tree already draws, in the same 20px box at the
row's trailing edge — the drawing pins ONE Workspace component, so the two trees show one control. The
dialog is a centred `surface-container-high` panel on a 28px corner, 24px padding, a 16px-gap column of
three: a headline-small "Create channel" title, an outlined field (1px `outline`, 4px corner, 16/8
padding) stacking a label-medium "Name" over a body-large value, and a right-aligned 4px-gap action row
of two pill text buttons in `primary` reading "Cancel" and "Create". Verified against both screenshots:
the two shipped dialogs are byte-identical in chrome and differ only in title, field label and the
second action's word — which is exactly the ticket's stated assumption, so it stands.

## Context

A channel can only come into being by promoting a chat. `CreateConversationPayload` has carried
`is_promoted` and `name` since #241 and the daemon honours both; the client has simply never sent
anything but `is_promoted: false, name: null`. #1178 opened the seam — `renderServerTrees` takes an
optional trailing create callback and the Chats call supplies it — and left the Channels side blank.
This fills it.

No ADR is warranted: no new command, no wire change, no daemon change, no new store. It is a second
payload shape on a shipped command and a fourth dialog in a shipped chrome.

**Size, stated rather than hidden.** This plan's total written work lands near the refiner's ~845-line
estimate, over the 800-line ceiling. It stays one ticket on the floor rule: a plus that opens nothing
and a dialog nothing opens are each unobservable alone, so neither half could be verified on its own.
The ceiling costs at most a continuation leg; the floor costs a ticket that cannot be proven.

## Design

**One plus class, not two.** The Channels plus reuses `.channel-list__workspace-create` and
`.channel-list__workspace-create-icon`. The drawing gives the Workspace component ONE trailing plus, so
a second class would restate thirty declarations verbatim to draw the identical box. The cost is the
one the ticket names: `createTagsIn` in `ChannelList.test.tsx` widens from one control to two.
`e2e/sidebar-workspace-create.spec.ts` is unaffected and stays unedited — it seeds a single UNPROMOTED
row, so its render has no Channels group at all and its strict `.channel-list__workspace-create`
locator still resolves to exactly one element.

**The threaded prop becomes ONE object, so the name and the handler cannot drift.** `WorkspaceRow`
hard-codes `CREATE_CHAT_CONTROL_LABEL`; the Channels plus needs "Create channel" to reach it alongside
the callback. Two parallel optional props (`onCreate?`, `createLabel?`) would admit a handler with no
name and a name with no handler, and would need a default that silently mislabels one tree. Instead the
three levels below `renderBody` take a single optional `create`, and its absence is what withholds the
control:

- `renderServerTrees(rows, serverIds, renderRow, create?: { label: string; onCreate: (cwd) => void })`
  — the per-tree difference, now carrying both halves. Its `workspaceGroups` still decides per group,
  withholding on `group.key === UNKNOWN_WORKSPACE_KEY` exactly as shipped, and hands down the nullary
  form.
- `CollapsibleWorkspaceGroup` and `WorkspaceRow` take
  `create?: { label: string; onCreate: () => void }` — a module-local `WorkspaceCreateControl` type,
  NOT exported: nothing outside this file constructs one. The `cwd` is closed over by
  `renderServerTrees`, so neither of these components handles a daemon-derived path at all, which is
  the property #1178 established and this keeps.
- `WorkspaceRow` renders `aria-label={create.label}`. `CREATE_CHAT_CONTROL_LABEL` stops being read
  there and is read at `renderBody`'s two call sites instead, beside the new
  `CREATE_CHANNEL_CONTROL_LABEL = 'Create channel'` — both client-owned module constants in the
  `HOST_ROW_FALLBACK_LABEL` idiom, and both the pair #1181's pill will read.

`renderBody` and `ChannelListView` gain `onCreateChannel: (cwd: string) => void` beside
`onCreateChat`, REQUIRED for `openConversationId`'s stated reason: the container must decide, and a
defaulted prop would let a caller silently render a Channels tree with no create route. `renderBody`
builds the two control objects at its two `renderServerTrees` calls, so the label constants stay
module-local to `ChannelList.tsx`.

**The dialog is a pure view plus container state, the `RenameConversationDialog` shape.**
`CreateChannelDialogView` in a new `CreateChannelDialog.tsx` — props in, markup out, server-renderable,
no store, no `window.pyry`, no effects. Its props are `name`, `onNameChange`, `onCancel`, `onCreate`,
the Rename view's set exactly.

**THE VIEW NEVER RECEIVES THE `cwd`.** It is not a prop, so no attribute of the dialog can derive from
it even by accident — the strongest available form of AC2's "no attribute carries the workspace label
or the `cwd`". The container holds it and the Create handler is the only reader.

Markup: `.create-channel-overlay` > an `aria-hidden` `.create-channel-overlay__scrim` sibling +
`.create-channel` (`role="dialog" aria-modal="true" aria-labelledby`), holding an `<h2>` titled
"Create channel", a wrapping `<label>` field (`Name` span + controlled `<input>`), and an actions row
of `.create-channel__cancel` ("Cancel") and `.create-channel__create` ("Create", `disabled` while
`name.trim() === ''`). A fixed `create-channel-title` id ties the label, safe for the
`RENAME_CONVERSATION_TITLE_ID` reason: only one is open at a time.

**Focus comes from `autoFocus` on the input.** React's server renderer emits `autofocus=""` (verified
in this tree) and React DOM focuses the element on mount, so one attribute satisfies AC2's "empty and
focused" in the running app AND makes it assertable in the static tier. The alternative — a ref plus a
mount effect — is invisible to every gate but e2e and adds state to a view whose whole contract is that
it has none.

**Container state, the save/rename pair's shape.** `ChannelList` gains
`createChannelCwd: string | null` and `createChannelName: string`, both `useState` — transient
per-interaction state at the lowest scope that survives re-render (ADR 0006, the `renameRow` /
`renameName` precedent). `onCreateChannel` seeds both (`setCreateChannelCwd(cwd)`,
`setCreateChannelName('')`); the dialog is mounted on `createChannelCwd !== null` and NEVER on a
truthiness test — an explicit null check is what keeps a hypothetical empty-string `cwd` from
collapsing into "no dialog open" (the trap `App.tsx`'s `openConversationId` header names). It is not
reachable today because the unknown group is withheld; writing the check the other way would make that
withhold load-bearing for a second, unrelated reason.

Create calls `requestNewChannel(window.pyry.sendCommand, createChannelName, createChannelCwd)` then
`setCreateChannelCwd(null)`. `window.pyry` is dereferenced inside the two handlers alone, never during
render, so the container stays server-renderable (the `onNewConversation` discipline).

**Escape and the scrim close nothing, matching the Rename dialog exactly.** `RenameConversationDialogView`
ships no key handler and no scrim `onClick`; the ticket pins this dialog to "whatever the Rename dialog
supports today", and today that is Cancel alone. Adding a first Escape claimant here would also put a
fifth unconditional `document` listener into a window that already has several, which is its own
ticket, not a side effect of this one.

**The command.** `requestNewChannel(sendCommand, name, cwd)` lands in
`conversationCreatedBridge.ts` DIRECTLY BESIDE `requestNewConversation` — the file whose idiom is an
inline `RendererCommand` literal, and the placement that makes "two callers with two fixed payloads
read better than one with a switch" legible: a reader sees both literals together. It sends
`{ is_promoted: true, name: name.trim(), cwd }`. The name is trimmed for
`requestRenameConversation`'s stated reason (a named channel should not carry accidental edge
whitespace); the view's blank-disable means it is never reached with an empty one, so there is no
redundant guard. The `cwd` is passed VERBATIM — not normalised, not trimmed, no `path` module, no local
resolution — which is #1178's security obligation restated at its second call site.

No `serverId`, matching #1178 and the FAB: with more than one host paired this routes to the most
recently paired one. Wrong for all three or wrong for none; its own ticket.

**CSS.** A fourth `*-overlay` block, `.create-channel*` in `channels.css`, mirroring
`.rename-conversation*` declaration for declaration (the precedent that block's own header records for
its relationship to `.save-as-channel*`) with the two Figma-confirmed differences: the title reads
"Create channel" and the second action is `.create-channel__create`. New tokens: none. The Rename
dialog's own rules are not touched.

## State + concurrency model

Two `useState` cells in `ChannelList`, both transient and both dying with the dialog. No store, no
reducer, no context, no effect, no subscription, no timer — and therefore nothing to tear down.

The create is fire-and-forget (`sendCommand` is `void`). Navigation stays event-driven: the daemon's
`conversationCreated` confirmation reaches `PairedShell`'s already-mounted `useConversationCreatedNav`
and opens the new channel. No optimistic row.

The new channel lands under the clicked workspace in the CHANNELS tree because `partitionActive` splits
on `is_promoted` and `groupByWorkspace` keys on `cwd`, and this command sent `true` and that group's key
verbatim.

Mutual exclusion with the other two dialogs needs no logic, for the reason `renameRow`'s comment
already records: an open dialog's fixed-inset overlay covers the window, so the affordance behind it is
not clickable.

A rapid double-click on Create cannot fire twice: the first click closes the dialog, unmounting the
button. The plus itself has the FAB's shipped double-click property, unchanged and not this ticket's.

## Error handling

No new failure mode. `sendCommand` returns `void`, main re-validates through the shipped
`isCreateConversationPayload` and rebuilds a fresh three-field literal, and a create main declines
simply mints no row — the FAB's behaviour today. The ticket adds no error surface, so the dialog has no
rejected state and no failure copy (unlike `CreateFolderDialog`, which has a round-trip store because
its command has a reply this one does not consume).

No `console.*` on any path: a useful line would carry the `cwd` or the typed name, which ADR 0007's
content-free rule and `CLAUDE.md` both forbid.

## Testing strategy

**Unit, `ChannelList.test.tsx`** (static markup; this tier cannot click or hover):

- A render with a promoted and an unpromoted row in the same workspace: `aria-label="Create channel"`
  once in the Channels slice and zero times in the Chats slice, `aria-label="Create chat"` the reverse
  (AC4).
- `createTagsIn` now returns TWO tags; each starts `<button `, carries `type="button"`, and the pair's
  labels are the two constants — the widening the ticket names, stated as an equality on both rather
  than a loosened count.
- #1178's markers still count once per group per tree: `WORKSPACE_ROW_MARKER` and
  `WORKSPACE_HEAD_MARKER` at two each in a two-tree render, `workspaceRowTagsIn` still returning
  `<button>` tags with no `aria-label` and no `title` (AC4).
- The unknown-workspace group draws no plus in the CHANNELS tree either (its key is `''`).
- A hostile `cwd` reaches none of the Channels plus's attributes.

**Unit, `CreateChannelDialog.test.tsx`** (new):

- Title "Create channel", `role="dialog"`, `aria-modal="true"`, `aria-labelledby` matching the `<h2>`'s
  id; one field labelled "Name".
- The input renders `autofocus=""` and, on the open state, `value=""` (AC2's "empty and focused").
- Create renders `disabled=""` for `''` and for `'   '`, and omits the attribute for a real name;
  Cancel is never disabled.
- A hostile name renders escaped as the input's value and reaches no other attribute; the markup
  carries no `title=`.

**Unit, `conversationCreatedBridge.test.ts`**: `requestNewChannel` sends exactly one command whose
literal is `{ type: 'createConversation', payload: { is_promoted: true, name: <trimmed>, cwd } }`, with
the `cwd` echoed byte-for-byte including one that a normaliser would rewrite.

**E2E, `e2e/sidebar-create-channel.spec.ts`** (new, one launch, one continuous drive) — everything a
static render cannot answer: the click, the focus, the disable transitions, and the round trip.

- Seed ONE PROMOTED row at a cwd that is NOT the fake's `DEFAULT_CREATED_CWD`. That single choice makes
  three payload fields detectable by one number: a create sent with a null `cwd` mints a second group,
  and one sent with `is_promoted: false` mints a Chats group — either way `.channel-list__workspace`
  goes to 2. With a promoted seed the Chats tree draws no group at all, so "Create chat" count 0 is a
  second, differently-shaped read of the promotion half.
- At rest: `getByRole('button', { name: 'Create channel' })` count 1, `'Create chat'` count 0.
- Click the plus: the dialog appears, its title reads "Create channel", the input is focused and empty.
- Create is `disabled` blank; typing whitespace leaves it disabled; typing a name enables it.
- Cancel, then reopen and read the field empty (a positive read that proves the reset). The proof that
  Cancel SENT NOTHING is the final row count of exactly 2 — a Cancel that fired would make it 3 — so
  the drive needs no vacuous absence for it.
- Type a client-owned name, click Create. THE POSITIVE AUTO-WAITING READ COMES FIRST: `.channel-list__row`
  1 → 2, and the open row's title is the typed name (which a `name: null` create would render as
  "Untitled"). Only then the closing reads: the dialog is gone, `.channel-list__workspace` is still 1,
  and `'Create chat'` is still 0.
- Secret hygiene, the sibling specs' posture: every assertion reads a number, a computed string, or the
  client-owned name this drive typed. The seed's cwd is a fixed fake remote path, never resolved
  locally and never asserted on.

`e2e/sidebar-workspace-create.spec.ts`, `e2e/save-as-channel-promote.spec.ts` and
`e2e/conversation-create-rename.spec.ts` are the regression set AC5 names and are not edited.

## Open questions

- **Does the second plus break `e2e/sidebar-workspace-create.spec.ts`'s strict locators?** Read as no —
  its seed is a single unpromoted row, so no Channels group renders. To be CONFIRMED by running that
  spec, not by reading.
- **Does `autoFocus` inside a conditionally mounted subtree actually move focus in the packaged app?**
  React focuses on mount and the dialog mounts on the click, so yes; confirmed by the e2e `toBeFocused`
  read rather than assumed.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — a SECOND untrusted value now rides the same outgoing command, and
  it is one the user typed rather than one the daemon asserted.** #1178 sent `group.key` (daemon text)
  as `cwd`; this adds `name`, renderer-origin free text. Four things bound it, each checked rather than
  assumed. It reaches `isCreateConversationPayload` at the untrusted renderer→main boundary, which
  type-checks `name` and after which `daemonConnection.createConversation` rebuilds a fresh three-field
  literal, so no sibling field rides along. It round-trips to its own daemon over the established Noise
  session and reaches no third party. It renders back only as an auto-escaped React child
  (`titleFor(row.name)` in `Row`) — the sink `Row`'s own header already declares for this field. And —
  verified by grep over `src/main` — no `fs`, `path`, `URL` or `node:*` call in main touches a create
  payload's `name` or `cwd`, so neither becomes a local path. **Phase B obligation:** trim the name and
  pass the `cwd` verbatim, and state at the call site that the trim is cosmetic and not a validation —
  the daemon polices the name server-side, exactly as `requestCreateWorkspaceFolder`'s header records
  for its own field.
- **[Attribute sinks / injection] The `cwd` is kept out of the dialog BY CONSTRUCTION, not by
  discipline.** `CreateChannelDialogView` takes no `cwd` prop, so no attribute of the overlay, panel,
  field, input or either action can derive from it even by a future edit — the container closes over it
  and only the Create handler reads it. The plus's `aria-label` is `CREATE_CHANNEL_CONTROL_LABEL`, a
  compile-time constant; the typed `name` reaches exactly one sink, the controlled input's auto-escaped
  `value`. Nothing derives a `title`, `id`, `aria-controls`, `data-*`, class name, URL or CSS custom
  property from either value. The fixed `create-channel-title` id is a client-owned literal.
- **[Errors, logs, telemetry] No findings.** No `console.*` is added anywhere on this path, and there is
  no rejected state to report: any useful line would carry the `cwd` or the typed name, which ADR 0007
  and `CLAUDE.md` forbid. The failure side stays silent upstream, where
  `daemonConnection.createConversation` already catches and drops without logging because the caught
  object could echo the payload.
- **[Electron / IPC attack surface] No findings.** No new `contextBridge` API, no new `ipcMain`
  channel, no new command member, no new preload surface. This is a second PAYLOAD SHAPE on
  `createConversation`, whose validator and routing case both ship — and the validator is shape-based,
  so it admits `is_promoted: true` with no edit and no widening. The renderer gains no filesystem,
  socket, key or raw-byte reach; the transport stays in main.
- **[Threat model — hostile daemon] Addressed, and the new arm is the WEAKER of the two.** A megabyte
  `cwd` reaches `buildCreateConversation`, which throws `WireEncodeError` on an over-cap plaintext and
  drops the send — a dropped request, not an unbounded write, and unchanged from #1178. The name cannot
  reach that size from this surface at all: it is typed into a bounded input. Visually the created row's
  title ellipsizes through `.channel-list__title`'s shipped chain, and the dialog panel's own
  `max-height` + `overflow-y` bound a long field, both already in the block being mirrored.
- **[Concurrency] No security finding; two behaviours named rather than glossed.** Create cannot
  double-fire: the first click unmounts the dialog. The plus can, exactly as the FAB and #1178's plus
  can, which is neither new nor this ticket's to change. No async task, subscription, timer or listener
  is added, so there is nothing to cancel and nothing to leak — and no check-then-act across an `await`,
  because there is no `await` on this path.
- **[Tokens / secrets, file & storage, cryptography, network & I/O] Not applicable, concretely:** the
  change is one CSS block, one new pure component, one command constructor and one object-shaped prop
  threaded through four renderer functions. It opens no file, writes no storage, mints no randomness,
  touches no key or token, compares nothing against a secret, and opens no socket — the create rides
  the already-established Noise session.
- **[Threat model — renderer compromise] OUT OF SCOPE, unchanged.** Process isolation is what stops a
  compromised renderer reaching keys or the socket, and nothing here moves across that line. A
  compromised renderer could already send this payload without the dialog.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
