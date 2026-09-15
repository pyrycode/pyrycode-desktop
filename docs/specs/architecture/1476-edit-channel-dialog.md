# #1476 — the channel row's pen reads Edit channel and opens an Edit channel modal

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList` — the container holding every
  dialog's per-interaction cells and the one `sessionStore.subscribe` effect that clears them on host
  loss; `ChannelListView` / `renderBody` / `renderServerTrees` — the prop chain a per-tree handler
  threads down; `CHANNELS_ROW_PEN` / `CHATS_ROW_PEN` / `RENAME_CONTROL_LABEL` — the pen's word and
  tokens, built at the only level that knows which tree it draws; `Row` — the single block that draws
  both trees' pens from a `RowPenControl`.
- `src/renderer/src/screens/channels/EditChatDialog.tsx` → `EditChatDialogView` — the view shape the
  new dialog copies (and the Archive arm it drops); `requestRenameConversation` — reused verbatim, it
  owns the `renameConversation` literal and the trim.
- `src/renderer/src/components/Modal.tsx` → `Modal` — the shared panel that already draws the header,
  the close control, the divider and the centred Cancel/OK footer, and takes the 640 `width`.
- `src/renderer/src/screens/channels/channels.css` → the `.rename-conversation*` block — the recipe
  the new namespace restates, and the header comment listing the fixed overlays that must escape
  `.channel-list`'s `position: relative`.
- `src/renderer/src/screens/channels/EditChatDialog.test.tsx` → the static-markup idiom the new spec
  mirrors (`renderToStaticMarkup` over the pure view, index assertions for ordering).
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `RENAME_MARKER` — the `aria-label`
  literal five assertions read, and the render helper that must learn the new prop.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `titleFor` — the `Untitled` fallback
  that is both the field's seed and the comparison the send is gated on.
- `docs/knowledge/features/channel-list.md` § The row's save affordance — records that `Row`'s
  trailing controls are disjoint-by-section siblings, and that `.channel-list__rename` is what the
  promote specs proxy "the row moved sections" on. That is why this ticket changes the word alone.
- `docs/knowledge/features/edit-workspace-dialog.md` — the sibling dialog whose namespace-per-dialog
  rule (a Playwright-locator rule, not a style one) the `.edit-channel*` decision follows.

**Codegraph gap.** `codegraph_context` failed with *"CodeGraph not initialized for this project"* — the
symlinked index is absent for this worktree, so every symbol question above was answered by Grep/Read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=500-2120

A 640px dark modal on the shared Modal component: a 22px **Edit channel** title with the circled close
glyph opposite it over a 60%-opacity rule, then a content column whose first field is a semibold 14px
**Channel name:** label above a filled, borderless, 6px-radius input, and a centred footer pairing the
outlined **Cancel** with the filled **OK**. The drawing's **Channel system prompt:** text area
(`500:2151`) and the outlined **Archive channel** button below it are #1477's and #1438's and are not
drawn here — this ticket renders the header, the name field and the footer only.

## Context

Since #1441 each tree's pen carries its own label and class tokens, but both still open the one dialog
`EditChatDialog` exports — so a Channels row's pen opens a modal headed **Edit chat** carrying #1440's
**Archive chat** button. Juhana's 2026-09-14 ruling: channels are not renamed, they are edited, under
their own word and in their own modal holding the name and the system prompt. This ticket takes the
first half; #1477 adds the system-prompt field and #1438 the Archive/Remove button, both onto this
modal.

The new modal takes its own `.edit-channel*` namespace rather than a share of `.rename-conversation*`.
That is a locator decision, not a styling one: six shipped specs find the chat dialog through the old
tokens, and #1438 already specifies `.edit-channel*` for its own button. The pen's tokens do **not**
move — `.channel-list__rename` is what twelve specs read as "this row is promoted" — only the word does.

No ADR is warranted: this introduces no new contract, no wire change and no cross-cutting rule. The
documentation stage's new `edit-channel-dialog.md` page is the right home for it.

## Design

### `EditChannelDialog.tsx` (new)

One export, a pure controlled view in `EditChatDialogView`'s shape **minus the archive arm**:

```ts
export function EditChannelDialogView(props: {
  name: string
  onNameChange: (next: string) => void
  onCancel: () => void
  onSave: () => void
}): JSX.Element
```

It renders `.edit-channel-overlay` + an inert `.edit-channel-overlay__scrim` around `<Modal title={…}
width={640} cancelAction={Cancel} confirmAction={{ label: 'OK', disabled: name.trim() === '' }}
onClose={onCancel} />`, whose content slot is one `.edit-channel__field` label wrapping
`.edit-channel__label` and a controlled `.edit-channel__input`.

**No `available` prop**, unlike `EditChatDialogView`. That prop exists there because #1440's AC3 lives
in the *gap* between two buttons' disabled expressions; this dialog has one button, and its host guard
is the container's render gate plus the interaction-time re-check below. #1438 adds `available` when it
adds the second button that needs it — shipping it now would be a prop with one value and no caller.

The title is a module constant in `EDIT_CHAT_COPY`'s idiom — client-owned, apostrophe-free,
interpolating no conversation name — because it is a load-bearing `getByRole('dialog')` name in five
specs and must not be reworded casually.

### `ChannelList.tsx`

- `RENAME_CONTROL_LABEL = 'Rename'` becomes `EDIT_CHANNEL_CONTROL_LABEL = 'Edit channel'`, read twice
  as before (the pen's `aria-label` and its hover pill) so the two cannot drift. The constant is
  renamed rather than re-valued: its only two readers are its declaration and `CHANNELS_ROW_PEN`, and a
  constant named for the old word is the drift this file's idiom exists to prevent.
- `CHANNELS_ROW_PEN`'s `className` / `iconClassName` are **unchanged**.
- A second per-interaction cell pair beside `renameRow` / `renameName`: `editChannelRow` /
  `editChannelName`, independent for the reason its five siblings already carry (an open dialog's
  fixed-inset overlay covers the window, so no two can be open at once).
- **No third cell for the seed.** The comparison's left side is derived from the held row —
  `titleFor(editChannelRow.name)` — which is the same expression the open handler seeds the field
  from, evaluated over the same captured snapshot. A cell holding a copy of it would be a second thing
  to clear and a second thing to forget.
- A second handler `onEditChannel` beside `onRename`, threaded down the existing chain
  (`ChannelListView` prop → `renderBody` param → the **Channels** `renderServerTrees` call, the level
  that already builds `CHANNELS_ROW_PEN`). The Chats tree's `pen` keeps `onRename` and its
  `EditChatDialogView` untouched, as do `ConversationScreen`'s two call sites.
- The host-loss clear goes **inside the existing `sessionStore.subscribe` effect**, one statement
  beside `renameRow`'s, with `editChannelRow` added to its dependency list. Not a second effect: a
  reset written anywhere else is one an edit to this branch can forget (#1439's ruling, restated).

### `channels.css`

`.edit-channel-overlay`, `.edit-channel-overlay__scrim`, `.edit-channel__field`, `.edit-channel__label`,
`.edit-channel__input` and its `:focus-visible` arm restate the `.rename-conversation*` recipe
declaration for declaration, token for token. The `.channel-list` header comment naming the fixed
overlays that must escape its `position: relative` gains the new one.

## State + concurrency model

No store slice, no async task, no subscription of its own. The dialog's whole lifetime is the
`editChannelRow` cell, and three things end it: Cancel, the header close, and a successful OK all set
it to `null`; host loss clears it from the existing subscription; and the render is additionally gated
on `connected(editChannelRow.serverId)` so a status flip hides it on the very next paint.

`window.pyry` is dereferenced only inside the save callback, never during render, so `ChannelList`
stays server-renderable (the `onCreateChat` discipline).

**The send's two conditions, in order:** the interaction-time `canMutateHost(editChannelRow.serverId)`
re-check first (a live store read, not the React state the render gate gutted), then
`editChannelName.trim() !== titleFor(editChannelRow.name)`. Only then
`requestRenameConversation(window.pyry.sendCommand, editChannelRow, editChannelName)`, then close.
Closing happens on **both** arms — an unchanged name dismisses without sending, it does not refuse.

The "only when it differs" check lives **in the container, beside the send, never in the helper**:
`ConversationScreen` and the Chats tree are `requestRenameConversation`'s other callers and keep
sending unconditionally.

## Error handling

There is no failure mode to handle here that the sidebar does not already have. `sendCommand` is
fire-and-forget (`void`), exactly as the shipped rename; the daemon is authoritative and answers with a
`conversation_updated` re-list. A host that dies mid-dialog is the cleared-cell path above, not an
error. No result type is introduced because no call in this change can fail locally.

**No log line is added, on either arm.** The no-send branch is precisely where an implementer reaches
for one, and every useful form of it carries the conversation's title or id — which ADR 0007's
content-free rule and `CLAUDE.md` both forbid. The same reasoning `groupByServer`'s `unattributed`
bucket already records.

## Testing strategy

**vitest — `EditChannelDialog.test.tsx` (new), static markup over the pure view:**

- the modal is role-`dialog`, `aria-modal`, labelled by its own title id, `--modal-width:640px`, and
  carries the Close dialog control
- the header reads `Edit channel`; **`Edit chat` and `Rename` are asserted absent**, not merely
  unmentioned — five e2e specs locate this dialog by its role name, and a header carrying both words
  would let them pass while the retitle had not happened
- the `Channel name:` label and the input prefilled with the injected name
- Cancel and OK render; OK is disabled on an empty name and on a whitespace-only name, enabled on a
  non-blank one
- **no `rename-conversation__archive` and no `Archive chat` text** (AC2's "and no Archive chat button")
- the injected name renders as escaped attribute text, never live markup (`Tom & Jerry` → `Tom &amp;
  Jerry`)

**vitest — `ChannelList.test.tsx` (edited):** `RENAME_MARKER` moves to `aria-label="Edit channel"`; its
five existing assertions (present on a Channels row, absent on a Chats row, counted once) then carry the
new word unchanged. The render helper gains `onEditChannel={noop}`.

**Not unit-tested, by the repo's standing constraint:** the open → type → OK → dismiss transition. The
vitest environment is `node` with no DOM and nothing that can click, so the seeded field, the
unchanged-name no-send, and the reopen-from-stored-title all belong to Playwright.

**Playwright — the six specs the ticket names**, each moving from the chat dialog's title and tokens to
the new ones on the **Channels** pen drive only: `conversation-state-fake`, `conversation-create-rename`,
`sidebar-offline-mutations`, `sidebar-control-name-pill`, `sidebar-row-geometry` and
`real-daemon-rename`. Specs that only await or count `.channel-list__rename` stay unedited, the token
being unchanged. `sidebar-row-geometry`'s Chats-row drive keeps the **Edit chat** dialog — it is the
Chats pen, untouched by this ticket.

`real-daemon-rename.spec.ts` is a `real-*` spec, excluded by the default config's filename `testIgnore`
and executed only by `npm run e2e:real:gate` — which is why the ticket carries `needs-real-claude` and
why the live tier is the dispatcher's to run, not this run's.

**Visual check:** capture the rendered modal and compare against the `500:2120` screenshot, scoped to
the header, the name field and the footer (the system-prompt area and the Archive button are absent by
design).

## Open questions

1. Does the "differs from the seed" comparison belong against the *seed* or against the row's *live*
   title? Resolved in the design above: against `titleFor(editChannelRow.name)` over the captured
   snapshot, which is the seed by construction. Recorded here because a future edit that re-reads the
   row from the store would silently change the behaviour AC2 pins.
2. Should `EditChannelDialogView` take `available` now, in anticipation of #1438? Resolved: no — see
   the Design section. If #1438's review disagrees, it adds the prop with its button.

## Documentation handoff

Owned by the documentation stage, not this run. Pending:

- A new `docs/knowledge/features/edit-channel-dialog.md` covering the Edit channel modal, its
  `.edit-channel*` namespace and the container cell that opens it. #1477 and #1438 both extend it.
- Fold the pen's new name into `docs/knowledge/features/channel-list.md`.
- Record the departure of the channel-row caller in
  `docs/knowledge/features/rename-conversation-dialog.md`, the page still carrying the chat dialog
  under its pre-#1440 name.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The one untrusted value in this change is the daemon-authored
  `ConversationSummary.name`. The design gives it exactly three destinations, all of them already
  sanctioned: `titleFor` → the controlled `<input value>` (React attribute-escaped), the
  `renameConversation` payload after `requestRenameConversation`'s trim, and — new in this ticket — a
  **control-flow branch**, the `!==` that decides whether to send. That third one is a sink class this
  value has not had before, so it is named rather than assumed benign: the worst a hostile daemon
  reaches by naming a channel `Untitled` is an OK press that sends nothing, which is the behaviour AC2
  specifies. No injection, no state corruption, no new reachable path. It reaches no attribute, no
  markup, no URL, no filename, no cache key and no log.
- **[Tokens, secrets, credentials]** Not applicable by construction: this change touches no credential,
  no `safeStorage` call and no persisted value. `window.pyry` is dereferenced only inside the save
  callback, never during render.
- **[File / storage operations]** Not applicable: no disk path, no web storage, no cache key is built
  anywhere in the design. Stated explicitly because the conversation title is exactly the string
  `CLAUDE.md` forbids in those positions, and it is in scope here.
- **[Inter-process / Electron attack surface]** No new IPC channel, no new wire type, no new envelope
  and no widening of the preload bridge. `requestRenameConversation` is reused **verbatim** rather than
  a second `renameConversation` literal being inlined, which is what keeps the renderer→main boundary
  single-sited and keeps the payload passing `isRenameConversationPayload`'s exact-shape check. A
  hand-written payload here would have been the finding.
- **[Cryptographic primitives]** Not applicable: renderer-only, no key, no handshake, no randomness of
  any kind.
- **[Network & I/O]** One fire-and-forget command per OK press, on the shipped transport. The "only
  when it differs" check reduces traffic but is **not** a security control and must not be relied on as
  one — the daemon remains authoritative over what a rename is permitted to do.
- **[Error messages, logs, telemetry]** No log line is added on either arm. See § Error handling: the
  no-send branch is where a per-reject log call would naturally go, and every useful form of it would
  carry the title or the id, which ADR 0007 and `CLAUDE.md` forbid outright.
- **[Concurrency]** SHOULD FIX, carried into Phase B: because this dialog omits `available`, its OK has
  **no disabled arm of its own** — unlike `EditChatDialogView`, whose OK is dead when the host is gone.
  The render gate is React state, which can be a paint behind a status flip. The save callback must
  therefore carry the `canMutateHost(editChannelRow.serverId)` re-check as its first statement: a live
  store read is a genuinely different fabric from the render gate, where a second React-state test
  would not be. The design above specifies it; the verifier should confirm it landed.
  Separately, the new cell is cleared inside the **existing** subscription, so this adds no second
  subscription, no second teardown path and no listener to leak.
- **[Threat model alignment]** *Hostile daemon response:* a `name` of arbitrary length or content
  reaches a controlled React input with no `maxlength` — unchanged from the shipped
  `.rename-conversation__input` this restates, and a layout question rather than a trust one. *Renderer
  compromise reaching the transport:* unchanged; this exposes no new capability to the web layer.
  *Out of scope:* any length bound on conversation names, which is a daemon-contract question for a
  ticket of its own, not this one.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-15
