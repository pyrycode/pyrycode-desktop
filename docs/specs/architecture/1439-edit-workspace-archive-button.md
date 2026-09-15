# #1439 — the Edit workspace dialog's Archive workspace button

## Files read

- `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` → `EditWorkspaceDialogView`,
  `requestRenameWorkspace` — the view this ticket widens and the send helper the new one sits beside.
- `src/renderer/src/screens/channels/EditHostDialog.tsx` → `UnpairSlot`, `EditHostUnpair`,
  `EditHostStatus`, `UNPAIR_HOST_COPY` — the slot one dialog over, whose two-arm shape, injected-effects
  prop and copy idiom this ticket mirrors.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList` (the container's
  `editWorkspaceTarget` pair, its `sessionStore` subscription, `canMutateHost`), `ChannelListView` — the
  container that owns the target, the status arm and the send.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `requestArchiveConversation` — the
  shipped per-conversation send this reuses once per row; already this file's import neighbour
  (`relayLeg`, `daemonLeg`).
- `src/renderer/src/store/conversationListStore.ts` → `ServerConversationSummary`,
  `ConversationListOrigin`, `selectConversations` — the row shape whose `serverId` is the CLIENT's stamp,
  and the union read the container already holds.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `partitionActive`, `groupByWorkspace` —
  the active partition (`!is_archived`) and the exact-`cwd` grouping the selection must agree with.
- `src/main/index.ts` → the `archiveConversation` arm — `router.route(conversation_id)`, which is what
  makes AC3's two-host clause true without a `serverId` on the command.
- `src/renderer/src/components/Modal.tsx` → `Modal` — children render inside `.modal__content`, BEFORE
  the footer; that ordering is what puts the new button into the dialog's tab order between the field
  and Cancel.
- `src/renderer/src/screens/channels/channels.css` → `.edit-host__unpair`, `.edit-host__actions`,
  `.edit-workspace__field` — the outlined recipe to restate and the namespace to restate it in.
- `e2e/sidebar-workspace-edit.spec.ts` → the rename drive — its Tab walk and its `Cancel` locators.
- `e2e/fixtures/mintChatRow.ts` → `mintChatInWorkspace`; `e2e/fixtures/conversationStateFake.ts` → the
  `archive_conversation` arm — the drive's second/third group and the fake's existing answer.
- `docs/knowledge/features/edit-workspace-dialog.md` — the dialog's shipped contract: the container owns
  the target, the view has no path prop, `cwd` is preserved verbatim and never displayed.
- `docs/knowledge/features/edit-host-dialog.md` — #1422's lessons that carry over: one class namespace
  per dialog for the Playwright-locator reason, a class pinned by a test with no CSS rule behind it is
  not a drawn state, and the two Cancels are told apart by class rather than by accessible name.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=487-2239

The Edit workspace panel, unchanged above and below: divided header with the title and close glyph, the
filled `Workspace name (optional):` field, then the centred outlined Cancel / filled OK footer. New is an
`Actions` frame inside the content slot, left-aligned, with an 8px top inset, holding one outlined
button — 1px `--color-primary` border, 6px radius, 7px/19px padding, body-large-emphasized label —
reading **Archive workspace**. That is `.edit-host__unpair`'s recipe exactly, which is the drawing's own
claim: the same outlined Button component the footer's Cancel instantiates. The confirming arm is
undrawn; it mirrors the Edit host dialog's unpair slot.

## Context

The Edit workspace dialog renames a workspace label and does nothing else, so there is no way to take a
whole workspace out of the sidebar — the case that exists today is the one-channel workspaces left behind
when #1436 withdrew the folder option. Neither the daemon nor this client has a workspace entity: a
workspace is a conversation's `cwd` string, grouped per host. So "archive the workspace" is "archive every
active chat and channel in that folder on that host", and the group then leaves both trees because
`groupByWorkspace` has nothing left to group. It archives rather than deletes (Juhana, 2026-09-14), so
every row is recoverable from the Archive screen and the daemon's stored label is untouched.

No ADR is warranted: this adds no contract. No new command, no IPC arm, no wire type — the daemon has no
workspace verb and this needs none.

## Design

### The slot (`EditWorkspaceDialog.tsx`)

Two arms, not the Edit host dialog's three: the send is fire-and-forget and closes the dialog at once, so
there is no in-flight arm and no failure line. An archive the daemon never confirms leaves the row in
place, which is the same answer the rename already gives.

- `export type EditWorkspaceArchiveStatus = 'idle' | 'confirming-archive'` — the container-owned cell.
  A named union rather than a boolean, so the slot's arms read the same way as `EditHostStatus`'s and a
  third arm (were one ever needed) is an addition rather than a reshape.
- `export interface EditWorkspaceArchive { onArm, onCancel, onConfirm }` — all nullary, all REQUIRED and
  grouped in one object: `EditHostUnpair`'s rule, "a view that cannot act is a bug", so forgetting to
  wire the action is a compile error rather than an inert button. Nullary because this dialog is open
  against exactly one workspace, whose `cwd` and host the container already holds.
- `EditWorkspaceDialogView` gains `status: EditWorkspaceArchiveStatus` and `archive:
  EditWorkspaceArchive` beside its four existing props. It still takes NO path prop and still displays
  neither the `cwd` nor a conversation id.
- A non-exported `ArchiveSlot` renders the arm it is given, inside the `Modal` children after the field:
  `idle` draws one `.edit-workspace__archive` button; `confirming-archive` replaces it in the same
  `.edit-workspace__actions` container with a `.edit-workspace__archive-prompt` span and two
  `.edit-workspace__archive` answers. Neither answer carries an error role — the act is reversible, the
  distinction the Channel info sheet already draws between its Archive and its Delete — so the confirm
  answer takes no modifier class at all. A modifier with no CSS rule behind it is precisely what #1422's
  second rework leg was, and a class that draws nothing is worse than no class.
- Copy is one module constant, `ARCHIVE_WORKSPACE_COPY`, `UNPAIR_HOST_COPY`'s idiom: client-owned,
  apostrophe-free (`renderToStaticMarkup` escapes `'` → `&#x27;`), interpolating neither the label nor the
  `cwd`. `{ archive: 'Archive workspace', prompt: 'Archive this workspace? Its chats and channels move to
  the Archive screen.', cancel: 'Cancel', confirm: 'Archive' }`.

### The send helper (`EditWorkspaceDialog.tsx`, beside `requestRenameWorkspace`)

```ts
export type ArchivableRow = {
  readonly id: string
  readonly cwd: string
  readonly is_archived: boolean
  readonly serverId: string | null | undefined
}

export function requestArchiveWorkspace(
  archiveConversation: (conversationId: string) => void,
  rows: readonly ArchivableRow[],
  cwd: string,
  serverId: string
): void
```

It selects and sends in one place: for each row whose `serverId === serverId`, whose `cwd === cwd`
exactly, and whose `is_archived` is false, it calls `archiveConversation(row.id)` once; an empty
selection calls nothing.

Two departures from the ticket's Technical Notes, both deliberate:

- **The helper does the selection, rather than taking ids the container computed.** The container's
  confirm arrow is unreachable under `renderToStaticMarkup` (`ChannelList.test.tsx` renders
  `ChannelListView`, and the dialog is gated on a target that is null in every static render — the fact
  `EditHostDialog.test.tsx`'s own header records). A filter written inline in the arrow would therefore
  be proved by no unit test at all; moved here it is an ordinary plain-spy test, which is exactly why
  `runEditHostUnpair` was extracted one dialog over.
- **The sender is injected rather than `sendCommand`.** The dialog module imports nothing from the
  conversation screen; `ChannelList` binds `requestArchiveConversation` — which it takes from
  `ConversationScreen` beside `relayLeg` — into the one-argument closure. The wire literal stays in the
  one module that already owns it.

`ArchivableRow` is the four fields the selection reads, not `ServerConversationSummary`, so a test builds
a row in four keys rather than eight. `ServerConversationSummary` is assignable to it, so the container
passes its held rows unchanged. The `serverId` arm is `string | null | undefined` because
`ConversationListOrigin` is; the parameter is a required `string`, so an unattributed row (`undefined`)
can never match by accident and an unattributed TARGET cannot be passed at all.

### Container state (`ChannelList.tsx`)

One new cell beside `editWorkspaceTarget`, `editWorkspaceArchive: EditWorkspaceArchiveStatus`, seeded
`'idle'` by the same `onEditWorkspace` handler that seeds the other two — the `editHostStatus` idiom, and
what makes "a reopen starts idle" true with no reset code of its own. It is ALSO reset wherever the target
is cleared, so the cell never holds an arm for a dialog that is closed: a `closeEditWorkspace()` body
helper clears both, used by the view's `onCancel`, its `onSave` and the confirm; and the `sessionStore`
subscription's existing `editWorkspaceTarget` branch clears both in the same statement (AC2's host-loss
clause).

The confirm arrow: `canMutateHost(serverId) || serverId === undefined` guards it exactly as `onCreateChannel`
already does — the one shipped call site that needs the narrowing as well as the check — then calls the
helper with `conversations ?? []` (the union the container already reads via `selectConversations`),
`editWorkspaceTarget.cwd` and the narrowed id, then closes. No rename is sent on that path, whatever the
field holds.

### Data flow after the send

Nothing further is wired. Each `archiveConversation` routes main-side by `router.route(conversation_id)`,
so two hosts sharing a path each receive only their own rows' frames; the daemon answers each with
`conversation_updated`; `shouldRefreshList` in `conversationListBridge` re-requests the list; the refreshed
rows drop out of `partitionActive`, the group loses its last row and leaves both trees; and
`useArchivedActiveConversationExit` fires `exitActiveConversation` when the open chat was one of them.

### CSS (`channels.css`)

Three new rules in the `.edit-workspace*` namespace, sharing no class name with the Edit host, Edit channel
or Edit chat dialogs (the Playwright-locator reason on the Edit host dialog knowledge page):
`.edit-workspace__actions` (flex row, `--space-3` gap, `padding-top: var(--space-2)` — the drawing's 8px
inset), `.edit-workspace__archive` (`.edit-host__unpair`'s outlined recipe restated, plus `:hover` and
`:focus-visible`; no `:disabled` rule, because no arm disables anything) and
`.edit-workspace__archive-prompt` (body-medium, `--color-on-primary-container`).

## State + concurrency model

No store slice, no subscription, no async task, no timer, no promise. The status cell is component-local
`useState` in the existing container; the whole interaction is three synchronous setState calls and one
synchronous burst of `sendCommand`. There is nothing to cancel on teardown, and the only lifecycle edge —
the host going away under an open dialog — is the existing `sessionStore` subscription, which this ticket
extends by one statement rather than adding a second subscriber.

## Error handling

There is no failure surface, by design and by precedent. `sendCommand` returns void and the main-side arm
is an inert no-op when the host is not connected (`router.route(...)?.archiveConversation`), so a confirm
against a dropped host sends nothing and changes nothing. A daemon that never answers leaves the rows in
place and the group in the trees, which is the honest outcome and the same one the rename already has. A
partial burst (some ids archived, some not) leaves the group present with fewer rows — visible, and
re-archivable by the same button.

## Testing strategy

- `EditWorkspaceDialog.test.tsx` (vitest, static markup): the idle arm renders one outlined button whose
  text is its accessible name and no prompt; the confirming arm renders the prompt plus both answers and
  no idle button; the confirm answer carries no error-role class; the prompt names neither a path nor a
  label; the existing field/Cancel/OK assertions still hold in both arms; no `aria-label` beyond
  `Close dialog`. Plus `requestArchiveWorkspace` with plain spies: one send per matching row and none for
  an empty selection; archived rows skipped; another `cwd` on the same host skipped; the same `cwd` on
  another host skipped; an unattributed row skipped; a trailing-slash `cwd` NOT matched (exact equality);
  the ids passed verbatim.
- `ChannelList.test.tsx`: no new test. Its subject is `ChannelListView`; the dialog and its arrows live in
  the container above it and are unreachable under `renderToStaticMarkup`. Stated rather than silently
  skipped — the ticket's Technical Notes ask for container wiring here, and the honest place for that
  proof is the e2e drive below, where the click exists.
- `e2e/sidebar-workspace-edit.spec.ts`: one added drive on the fake tier. Seed the promoted row, mint a
  chat at the same `cwd` (the second tree's group) and a chat at a different `cwd` (the survivor), then
  arm, cancel back to idle, arm again, confirm; assert the dialog closes, both groups for that `cwd` leave
  both trees, the other workspace's group stays, exactly two `archive_conversation` frames reached the
  fake and no `rename_workspace` did. The slot's Cancel is located through `.edit-workspace__actions`,
  since a bare `getByRole('button', { name: 'Cancel', exact: true })` is ambiguous while armed.
- Two existing assertions in that spec move, neither a product regression: the field→OK Tab walk gains one
  Tab for the new control's place in the tab order (`Modal` renders children before the footer), and the
  640px-panel drive is otherwise untouched.
- No real-tier run. `e2e/real-daemon-workspace-rename.spec.ts` locates the field by class and OK by exact
  name, so the new button collides with neither.
- Visual check per `docs/visual-review.md`: capture the dialog in both arms from the fake-transport
  fixture and compare against the Figma node above.

## Documentation handoff

Pending the documentation stage, per the ticket's own handoff section:

- `docs/knowledge/features/edit-workspace-dialog.md` — the archive slot, its two arms, and what archiving
  does to the group and to the daemon's stored label.
- `docs/knowledge/features/channel-list.md` § Workspace grouping — one line on how a group leaves the
  trees.

## Open questions

- Should the drive also assert the archived rows appear on the Archive screen (AC4's second clause)?
  Resolved in Phase B: covered by the existing archive tier, and adding a screen navigation to this drive
  buys a second proof of shipped behaviour at the cost of the drive's focus. Recorded here rather than
  silently dropped.
- Is a cap on the number of frames one confirm sends warranted? See the security review's Network & I/O
  finding; resolved there as no.

## Revisions

**2026-09-15 — the answers do not shrink (`.edit-workspace__archive`).** The plan said "restate
`.edit-host__unpair`'s recipe"; restating it verbatim was wrong. That recipe carries `overflow-wrap:
anywhere` for a long host name, and its prompt is four words, so its answers never shrink. This prompt is
a sentence, and in the same flex row the two answers were squeezed until their own client-owned labels
broke mid-word — `Canc/el`, `Archi/ve`. The rule now sets `flex-shrink: 0` on the button and drops
`overflow-wrap: anywhere` and `max-width: 100%`, with `flex: 1 1 auto` on the prompt so the sentence takes
what is left and wraps there. Found by the rendered capture, which is the only thing that could: every
markup assertion passed against the broken draw.

**2026-09-15 — the e2e drive reads AC4's exit clause directly.** The plan's Testing strategy stopped at
the trees and the frames. The drive now mints the control workspace's chat FIRST and the target's second
chat LAST, so the conversation the pane is showing is one of the archived rows, and asserts
`.conversation__thread` goes from one to none after the confirm. The Open Question about also visiting the
Archive screen is resolved as stated there — no; the archived rows' arrival on that screen is
`conversation-archive-lifecycle.spec.ts`'s subject, and a second navigation would cost this drive its
focus for a second proof of shipped behaviour.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings, and the load-bearing detail is which field the selection keys on.
  `row.serverId` is the CLIENT's stamp — bound main-side by `bindServerOrigin` from a paired record this
  client holds, and placed in the spread order `stampRows` fixes precisely so a daemon-supplied field
  cannot overwrite it. Keying the host half of the filter on it is what makes AC3's "only that host's
  rows" a property rather than a hope; keying it on anything the daemon sent would let one host's reply
  nominate another host's conversations for archiving. `row.cwd` and `row.id` ARE daemon-supplied, and
  both are used only as an exact-equality comparand and an opaque routing id respectively — no join, no
  normalisation, no lookup path. The second boundary is the renderer→main IPC arm, which this ticket does
  not touch: it sends the shipped `archiveConversation` command, whose guard (`isArchiveConversationPayload`)
  and router (`router.route(conversation_id)`) are unchanged.
- [Tokens, secrets, credentials] Not applicable: no credential, token or key is read, written, derived or
  displayed on this path. The dialog holds a label draft and a two-arm enum.
- [File / storage operations] Not applicable: nothing on this path touches the filesystem. The `cwd` is a
  REMOTE path compared as an opaque string — never resolved, joined, normalised or opened locally, which
  is `requestRenameWorkspace`'s existing rule restated for the selection. A traversal-shaped `cwd` is
  inert here for the same reason it is there: it is a comparand, not a path.
- [Inter-process / Electron attack surface] No findings. No `BrowserWindow`, `webPreferences`,
  `contextBridge` API, `ipcMain` channel, protocol handler or navigation guard is added or changed. No
  new capability reaches the renderer; the send goes through the existing `window.pyry.sendCommand`
  bridge, dereferenced at interaction time inside a callback, never during render.
- [Cryptographic primitives] Not applicable: no randomness, hashing, key handling or comparison against a
  secret. No `===` on this path compares anything but a client-held host id and a daemon-supplied path,
  neither secret, so constant-time comparison is not the relevant discipline.
- [Network & I/O] One finding, named and decided rather than deferred: **one confirm sends N frames, and
  N is bounded only by how many active rows the daemon reported for that `cwd`**. A hostile or buggy
  daemon that reports thousands of rows in one folder turns one click into thousands of outbound frames on
  our own socket. No cap is added, deliberately: every one of those rows is one the operator can already
  archive by hand from its own row, the list is the same one the sidebar is already rendering a row each
  for (so the memory cost is paid before this button exists), and a cap would silently leave rows behind —
  the group would stay in the trees and AC4 would be false, which is a worse failure than the send volume.
  No timeout, TLS, reconnect or frame-size decision is in scope; the transport's own limits are unchanged.
- [Error messages, logs, telemetry] No findings. Nothing on this path logs — a useful line would carry the
  `cwd`, the label or a conversation id, all of which ADR 0007's content-free rule and CLAUDE.md forbid,
  and there is no observed failure to instrument. The copy is client-owned module constants interpolating
  neither the label nor the `cwd` (AC5), and the prompt says "this workspace" rather than naming one. No
  error string is rendered at all, so no daemon text can reach one.
- [Concurrency] No findings. No async work, no `await`, no timer, no listener, no promise — so there is no
  cancellation path to thread, nothing to abort on teardown and no check-then-act gap across an await. The
  one ordering question, a host disappearing under an armed dialog, is closed twice: the existing
  `sessionStore` subscription clears both target and arm, and the confirm re-checks `canMutateHost` at
  click time — belt and suspenders of different fabric, since the second is a synchronous guard and the
  first is an event-driven reset, and behind both the main-side arm is an inert no-op when not connected.
- [Threat model alignment] A **hostile daemon** can make this button archive rows the operator did not
  picture — by reporting an unrelated conversation with a matching `cwd` — but that is strictly weaker
  than what it can already do: the daemon owns the archive flag and can set it unilaterally. The act is
  reversible from the Archive screen and the stored workspace label is untouched, so the blast radius is a
  recoverable sidebar change. A **malicious relay** is content-blind and on-path only; dropping or
  delaying these frames leaves rows unarchived and the group in place, which is this design's stated
  benign failure. **Renderer compromise** reaching the transport is unchanged: this path holds no key, no
  socket and no token, and can only send a command the renderer could already send one row at a time.
  **Token theft from disk** is not on this path. Out of scope, and named rather than silently inherited:
  the desktop client does not verify that a `conversation_updated` it receives corresponds to an archive
  it requested — the list refresh is the only feedback, which is the shipped per-row archive's posture
  since #366 and not this ticket's to change.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
