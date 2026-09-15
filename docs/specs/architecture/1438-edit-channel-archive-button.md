# #1438 — the Edit channel modal gets an Archive channel button

## Files read

- `src/renderer/src/screens/channels/EditChannelDialog.tsx` → `EditChannelDialogView`, `EditChannelDialog`
  — the view this button lands in and the container it is threaded through. Its header carries the
  `available`-prop forecast this ticket has to answer one way or the other.
- `src/renderer/src/screens/channels/EditChatDialog.tsx` → `EditChatDialogView` — the sibling's shipped
  archive arm: a required nullary `onArchive`, the `Actions` wrapper, the copy constant, the reasoning for
  reading a different half of the guard than OK does. This ticket restates that shape one namespace over.
- `src/renderer/src/screens/channels/ChannelList.tsx` → the `EditChannelDialog` mount, `canMutateHost`,
  the shipped `EditChatDialogView` `onArchive` arm, `requestArchiveConversation` (already imported) — the
  sidebar caller and the exact guard/send/dismiss sequence to restate.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the Channel info sheet's two dialog
  arms and `connectedConversationHostNow` — **the second mount site of this same container** (#1431),
  which a required prop makes a compile-time caller. See § Design.
- `src/renderer/src/screens/channels/channels.css` → `.rename-conversation__actions` /
  `__archive` — the outlined recipe to restate under `.edit-channel*`, and its header's ruling on why a
  shared selector is forbidden.
- `src/renderer/src/screens/channels/EditChannelDialog.test.tsx` → `renderView` — every case routes
  through one helper, so a newly required prop is a one-line change plus new cases.
- `e2e/edit-channel-system-prompt.spec.ts` → `capturingFake`, `mutations`, `mintChatInWorkspace` — the
  drive AC3 points at: a promoted `seed-conversation` row carrying the pen beside a separate `created-1`
  chat holding the open slot.
- `e2e/conversation-create-rename.spec.ts` → its pinned Edit-channel Tab walk, whose own comment predicts
  that **this ticket puts a third stop back for real**. See § Design.
- `e2e/fixtures/conversationStateFake.ts` → the `archive_conversation` arm — sets `is_archived` and
  answers `conversation_updated`, so the re-list drops the row with no fixture change.
- `docs/knowledge/features/edit-channel-dialog.md` § What it does, § `EditChannelDialog.tsx`,
  § Lessons learned — the `available` forecast, the "no Archive chat button" statement, and the
  row-versus-open-conversation assertion this ticket is named as re-establishing.
- `docs/knowledge/features/rename-conversation-dialog.md` (via the page above) — the `EditWorkspaceArchive`
  rule that a view which cannot act is a bug, hence a **required** prop rather than an optional one.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=500-2120

The `Content` frame gains a third child after `Text area large`: an `Actions` column with an 8px top
inset holding one `Button` — a transparent, 1px `schemes/primary`-outlined pill at `radius 6`, 19/7
padding, `body-large` medium label in `schemes/primary`, lettered **Archive channel**, left-aligned and
full-height-of-its-text rather than stretched. It is drawn as the footer's Cancel button, one frame
higher; the header, both fields and the centred Cancel/OK footer are #1476's and #1477's and unchanged.

## Context

The channel modal is the one place a channel is edited under its own word, and it has had no way to put
the channel away — the operator had to open the channel and go through Channel info. This adds the
outlined button the drawing has carried since 2026-09-14, in the slot the Edit chat dialog fills with
**Archive chat** and the Edit host dialog fills with Unpair host.

Everything downstream is already wired: `requestArchiveConversation` is imported where it is needed,
`shouldRefreshList` re-requests the list on `conversationUpdated`, `channelListViewModel` filters
`is_archived` out of both sidebar sections, and `useArchivedActiveConversationExit` leaves an open thread
whose row comes back archived. This ticket adds no command literal, no wire type and no IPC arm.

No ADR is warranted: this is a second instance of a shipped pattern, not a new decision.

## Design

### The `available` prop is **not** added — the forecast is answered "no"

`EditChannelDialogView`'s docblock and the dialog's knowledge page both forecast an `available` prop
arriving "when #1438 adds the second button that needs it". It is not needed, and adding it would be
wrong. That prop exists on `EditChatDialogView` because #1440's two buttons read *different halves* of one
guard — OK reads `blank || !available`, Archive chat reads `!available` alone — so the prop lives in the
gap between two disabled expressions. AC1 removes that gap outright: this button **carries no disabled arm
of its own**, being live on a blank name and while the prompt read is still outstanding. With no disabled
expression there is nothing for the prop to feed, the shipped OK has no `available` arm either, and a
second host authority in the render could only disagree with the interaction-time re-check that is already
the only thing standing between a disconnect and a send. The two forecasting comments are corrected in
place in the same commit as the button.

### `EditChannelDialogView` — one required nullary prop and one `Actions` row

`onArchive: () => void`, **required** (the `EditWorkspaceArchive` rule the sibling records: a view that
cannot act is a bug, so forgetting to wire it is a compile error rather than an inert button) and
**nullary** (the dialog is open against exactly one conversation, whose id every caller already holds).

It renders last in the Modal's content slot, after the reading / over-limit lines:

```tsx
<div className="edit-channel__actions">
  <button type="button" className="edit-channel__archive" onClick={onArchive}>{…}</button>
</div>
```

Placement is the drawing's — `Actions` is the last child of `Content` — and the two notice lines stay
adjacent to the text area they describe. No `disabled` attribute on any branch. The label is a new module
constant beside `EDIT_CHANNEL_TITLE`, apostrophe-free, interpolating neither the name nor the id; it is the
button's **accessible name**, so there is no `aria-label` (which would put a string into an attribute).

The container `EditChannelDialog` gains the same required prop and forwards it verbatim. It takes no guard
of its own and logs nothing — the guard belongs to each caller, which is where the live session store and
the right diagnostic are.

### Both mount sites are wired — `ConversationScreen` is a fourth production file

The container has **two** mount sites since #1431: `ChannelList`'s row pen and the Channel info sheet's
edit pill for a promoted channel. A required prop makes both compile-time callers. This is a deliberate
departure from the ticket's estimate line, which named three production files on the reasoning that the
send helper is already imported where it is needed — true of `ChannelList`, but the sheet mounts the same
container and `ConversationScreen` already imports `requestArchiveConversation` for its own chat arm, so
the addition there is a callback and nothing else. The alternatives were both worse: an optional prop
would ship an inert button on the sheet's arm against the rule above, and an opt-out prop would be the
`available`-shaped second authority § the section above rejects. One modal must not grow a button on one
of its two mount sites.

- **`ChannelList`** — `canMutateHost(editChannelRow.serverId)`, then
  `requestArchiveConversation(window.pyry.sendCommand, editChannelRow.id)`, then `setEditChannelRow(null)`.
  The row is the captured `editChannelRow` closed over by the same JSX the rename arm reads, which is what
  makes "the row the modal was opened on, not whichever conversation is open in the chat pane" true by
  construction. Neither `writePrompt()` nor `requestRenameConversation` is on this path.
- **`ConversationScreen`** (sheet) — its chat arm's sequence restated for the channel arm:
  `connectedConversationHostNow(conversation.id)`, the same send, `setRenameOpen(false)`, then `onClose()`
  to dismiss the sheet as well, because a sheet left standing describes a row on its way out.

The guards deliberately differ per caller, per the ticket's note: the sidebar's every mutation re-checks
with `canMutateHost` (which also emits the single `sidebar-mutation` diagnostic on refusal); the sheet acts
on the open conversation and re-checks with `connectedConversationHostNow`. Neither is imported across.

### `channels.css` — `.edit-channel__actions` and `.edit-channel__archive`

`.rename-conversation__actions` / `__archive` restated declaration for declaration under this namespace —
a locator decision, not a styling one, and the ruling the block header already carries twice. Its
`:disabled` arm is the one rule **not** carried: this button has no disabled state. `:enabled:hover` and
`:focus-visible` are carried as-is.

### The Tab order gains a third stop, by design

`conversation-create-rename.spec.ts` pins a two-Tab walk through this dialog (input → Cancel → OK) and its
own comment names this ticket as putting a third stop back. A focusable button in the content slot makes
the order input → Archive channel → Cancel → OK, the chat dialog's shape exactly. That spec's walk is
updated as part of this ticket; it is a consequence of the drawing's placement, not a regression.

## State + concurrency model

None added. No store slice, no subscription, no async work, no timer, nothing to cancel. The send is
fire-and-forget through the existing IPC command channel, and the container's one existing effect (the
system-prompt read) is untouched — a click on this button unmounts the container, and that effect's
cleanup is already its whole teardown path.

## Error handling

No busy state and no failure line, matching the sheet's Archive and the chat dialog's Archive chat. The
archive is a one-way command with no invoke result, unlike #1422's unpair, so there is nothing to await
and no arm to wait in. A request the daemon never answers leaves the row in place — the shipped rule at
both sibling surfaces. Nothing is dispatched on the reply. Nothing on this path logs: neither the
channel's name nor its id reaches a log or a diagnostic event, and the only diagnostic anywhere near it is
`canMutateHost`'s existing content-free `sidebar-mutation` refusal.

## Testing strategy

**vitest — `EditChannelDialog.test.tsx`** (static markup; `renderView` gains the new required prop):

- the outlined button renders with its exact copy, under `.edit-channel__actions` / `.edit-channel__archive`
- placement: its markup index falls after the text area's and before `modal__action--cancel`'s
- it carries no `disabled` on a blank name, and none in the `reading` arm (AC1's "no disabled arm of its own")
- OK's own disabled arms are unchanged by its presence
- its accessible name is its text — no `aria-label` anywhere in the dialog
- the shipped "no Archive chat, no `rename-conversation` namespace" assertion still holds beside it
- **intent, with plain `vi.fn()` spies**: the view is a pure function, so its element tree is readable
  without a DOM — the only way this environment can prove a handler is *bound* rather than merely drawn.
  A small local walker finds the `.edit-channel__archive` element and asserts its `onClick` is the injected
  spy; invoking it fires that spy exactly once with no argument, while the `onSave` and `onCancel` spies
  stay silent. Rendering alone invokes none of the three.

**Playwright — `e2e/edit-channel-system-prompt.spec.ts`**, a second `test()` beside the shipped one,
reusing its `capturingFake` / `mutations` and adding an `archives()` reader. It re-establishes the
assertion the knowledge page records as deleted: a promoted `seed-conversation` row carrying the pen,
beside a *different* open conversation (`created-1`, from `mintChatInWorkspace`). The drive: open the
modal on the row; assert the button live with a blank name and in the reading arm; push the channel's own
`system_prompt` reply so the text area seeds and opens; change **both** fields; click Archive channel.
Assert exactly one `archive_conversation` naming the **channel**, `mutations` still empty (no
`rename_conversation`, no `set_system_prompt`, whatever the two fields held), the modal closed, the row
gone from the sidebar on the refreshed list, and the open thread still standing — the positive half of
"the row the control was on, not the open conversation".

**Playwright — `e2e/conversation-create-rename.spec.ts`**: the pinned Tab walk gains its third stop. No
click on the new button there, so that spec's `mutations` expectations are unchanged.

Not run here: the full unit suite and the full fake-transport tier are the verifier's gate. No
real-claude work — this vertical touches neither claude nor a live daemon.

Visual check against the Figma screenshot before the PR, per `docs/visual-review.md`.

## Documentation handoff

Owned by the documentation stage, pending. In `docs/knowledge/features/edit-channel-dialog.md`:

- **Header** — "The outlined Archive/Remove-channel button drawn below the field in Figma is #1438's and
  is not yet built" is now stale; it is built, lettered **Archive channel**.
- **§ What it does** — "There is no Archive chat button — the one thing this dialog deliberately does not
  inherit from its sibling" needs correcting in place: it now has a put-away button of its own, under its
  own word (**Archive channel**) and its own namespace (`.edit-channel__archive`), and the chat dialog's
  button is still not what it wears.
- **§ `EditChannelDialog.tsx`** — "**No `available` prop** … #1438 adds the prop when it adds the second
  button that needs it" must record what shipped: **no prop was added**, because this button has no
  disabled arm and therefore no gap for one to fill (§ Design above).
- **§ Lessons learned** — close out the item asking this ticket to re-establish the row-versus-open-
  conversation assertion, naming `e2e/edit-channel-system-prompt.spec.ts` as where it now lives.
- Worth recording alongside: the container's two mount sites, so the next required prop is known to be a
  two-caller change.

## Open questions

- **Does the sheet's Edit channel arm get the button too?** Resolved at plan time: yes, forced by the
  required prop and correct on its own terms (§ Design). Recorded here rather than left implicit because
  it diverges from the ticket's estimate line.
- **Does anything else pin this dialog's focus order or button count?** Swept at plan time:
  `conversation-create-rename.spec.ts` alone pins the in-dialog walk (updated here); the other Tab walks
  in `sidebar-row-geometry` and `sidebar-control-name-pill` are sidebar-row walks, and
  `channel-info-edit-channel.spec.ts` locates by exact name. Re-confirmed by running the touched specs.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The one value crossing renderer → main is the conversation id,
  through the **shipped** `archiveConversation` command arm whose payload main already shape-checks; this
  ticket adds no command literal, no wire type and no IPC arm, so the boundary is exactly where #1440 and
  the workspace fan-out already put it. The id itself is **daemon-asserted** — a hostile or impersonating
  daemon that picks its own conversation id could direct an archive at a conversation of its choosing.
  That is the shipped exposure of every mutation in this file (the rename path, the sheet's own Archive),
  recorded on `edit-channel-dialog.md`; no client-side compare of a field that same party supplies can
  close it, and nothing here widens it.
- **[Trust boundaries — confused deputy]** The *new* authorization-shaped hazard is acting on the wrong
  conversation: a button in a modal opened from a sidebar row, in an app whose chat pane holds a different
  conversation, is exactly the shape that archives the wrong thing. Closed by construction rather than by
  a check — the send reads `editChannelRow`, the row captured by the same JSX closure the rename arm
  reads, never an "active conversation" lookup — and proven by the e2e drive AC3 points at, which seeds a
  promoted row beside a *different* open conversation precisely to catch a regression here.
- **[Tokens, secrets, credentials]** SHOULD FIX, as an implementation binding: **the archive path must not
  call `writePrompt()`.** No token, key or credential is on this path, but the system prompt draft is
  operator-authored text that #1477's own docblock treats as possibly holding a pasted credential, and it
  arrived over the network. An implementer "helpfully" saving the draft before putting the channel away
  would send the operator's in-progress prompt on a click that promised to send nothing. The plan's
  sequence is guard → send → dismiss with no write; the draft dies with the unmounted container. AC2 and
  the e2e drive both assert `set_system_prompt` is absent, so the verifier can check this landed.
- **[File / storage operations]** No findings — nothing on this path touches the filesystem, storage or a
  cache. Per CLAUDE.md's ruling the channel's name and id reach no filename, no cache key and no lookup
  path; the button's label is a client-owned constant interpolating neither.
- **[Inter-process / Electron attack surface]** No findings — no new `contextBridge` API, no new
  `ipcMain` arm, no `webPreferences` change, no protocol registration, no navigation, and nothing moved
  out of the background process. A compromised renderer could already send `archiveConversation` over the
  existing command channel, so this button grants the web layer no authority it did not have. The one
  design choice with a security edge is the **required** `onArchive` prop: it makes a mis-wire a compile
  error at both mount sites rather than an inert button on one of them, and each caller passes the id it
  already holds rather than resolving one.
- **[Cryptographic primitives]** Not applicable by design — no randomness, no hashing, no key material, no
  comparison against a secret, and no interaction with the Noise session beyond handing one already-typed
  command to the shipped transport. The `Noise_IK_25519_ChaChaPoly_BLAKE2s` constant is untouched.
- **[Network & I/O]** No findings — no new socket, frame type, size cap or timeout. One fire-and-forget
  command per click, with **no retry, no timer and no loop**: the modal unmounts on the same click, so
  another send needs another deliberate open. A hostile relay that swallows the command or the
  `conversation_updated` leaves the row in place, which is the shipped posture at both sibling surfaces,
  and nothing awaits the reply so a withheld frame cannot hang or pin the UI.
- **[Error messages, logs, telemetry]** No findings, and this is AC2's own clause: nothing on this path
  logs. The only diagnostic reachable is `canMutateHost`'s existing refusal,
  `{ event: 'sidebar-mutation', code: 'host-unavailable' }` — two static client-owned strings carrying no
  conversation id, no name and no prompt. This ticket adds no `sendDiagnostic`, no `console.*`, and no
  exhaustive `DaemonEvent` switch (whose `assertNever` would `JSON.stringify` an event that on one arm is
  the operator's prompt text onto a path reaching a console or a crash reporter — the container's standing
  ban, unchanged here).
- **[Concurrency]** No findings. Nothing async is started: no promise, timer, interval or listener is
  added, so there is no `AbortController` to thread and no cleanup to write. The click unmounts the
  container, and React runs the existing effect's `off` cleanup, so the system-prompt listener is removed
  rather than left to fire into a dead cell. Rapid repeated clicks within one frame were considered: a
  duplicate would be a second `archive_conversation` for an already-archived conversation, which is
  idempotent daemon-side (`is_archived = true`), confers nothing and loses nothing — the same accepted
  shape the sibling Archive chat ships, not a new exposure.
- **[Threat model alignment]** The content-blind but on-path relay can drop, delay or reorder this
  command; every outcome is "the row stays", which is the stated rule, and it can read nothing inside the
  Noise session. A hostile daemon response is not consumed at all on this path — nothing is dispatched on
  the reply — and the re-list that does consume one is shipped and unchanged. Token theft from disk and
  renderer-compromise-reaching-the-transport are unaffected: no secret is read, written or moved.
  **Out of scope, unchanged from the shipped surfaces:** a daemon that lies about conversation ids
  (first finding above) — no ticket, because no client-side fix exists.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
