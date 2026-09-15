# #1431 — Channel info's edit action opens Edit channel for a promoted channel

A short plan (the § A4 form): one conditional label and one conditional dialog mount, no new type, no
new state, no new failure mode of this ticket's own.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView` (the pure
  view that draws the pill) and `ChannelInfoSheet` (the container holding `renameOpen`/`renameName`
  and mounting `EditChatDialogView`) — the only production file this ticket edits.
- `src/renderer/src/screens/channels/EditChannelDialog.tsx` → `EditChannelDialog` — the container this
  ticket mounts. Its header states the contract the new arm must honour: the host guard is *the
  container's render gate on `connected(…)` plus the `canMutateHost` re-check the save takes*, and its
  subscription lifetime is its mount lifetime.
- `src/renderer/src/screens/channels/EditChatDialog.tsx` → `EditChatDialogView`,
  `requestRenameConversation` — the arm that stays unchanged, and the rename helper both arms share
  (it reads `.id` alone, so the sheet's `ConversationCreatedPayload` passes with no adapter).
- `src/renderer/src/screens/channels/ChannelList.tsx` → the `EditChannelDialog` mount site — the
  shipped shape of the render gate and of the `onSave(writePrompt)` body, which this ticket restates
  for the sheet.
- `src/renderer/src/screens/conversation/conversationActionAvailability.ts` →
  `useConversationActionAvailability`, `connectedConversationHostNow` — the render-time and
  interaction-time host checks the sheet already uses for every action.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `serverIdForOpenConversation` — how the
  open chat's owning host is resolved at render time (already imported by `ConversationScreen.tsx`).
- `src/shared/wire/types.ts` → `ConversationCreatedPayload` — `is_promoted` is a required boolean on
  the payload the sheet already receives, so the branch needs no new data.
- `src/renderer/src/store/activeConversationReseedBridge.ts` → `reseededActiveConversation` — confirms
  the open chat's snapshot carries the daemon's `is_promoted` and is kept in step with the list, so a
  list-opened channel reaches the sheet as promoted. (`ChannelInfoSheetView`'s own header still says a
  list-opened thread never populates the store; that sentence predates `PairedShell`'s `onOpen`
  handing the clicked row straight to the store, and this ticket does not rewrite it.)
- `docs/knowledge/features/conversation-shell-session-and-channel-info.md` § "Rename action … retitled
  Edit chat" — the pill's callback-gate rule (`onRename?` supplied exactly in the `conversation !==
  null` branch) that this ticket leaves intact.
- `docs/knowledge/features/edit-channel-dialog.md` — "The dialog closes if the row's host stops being
  connected — the render gate re-evaluates on every status change." That is why the new arm carries a
  host condition its chat twin does not.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=500-2120

A 640-wide dark modal: the title **Edit channel** with a round close ✕ at the right over a hairline
rule, then a semibold **Channel name:** label above a filled borderless input, then **Channel system
prompt:** above a four-row filled text area, and a centred **Cancel** / **OK** footer. That is
`EditChannelDialogView` as #1476 and #1477 already shipped it, translated onto `.edit-channel*` and the
shared `Modal`; this ticket adds no markup to it and re-fetched only the screenshot, because it mounts
an already-translated component rather than translating the node. The drawing's outlined **Archive
channel** button between the text area and the footer is **#1438's**, not yet built and not this
ticket's — its absence from the render is expected, not an infidelity here.

## Change

`ChannelInfoSheetView`'s edit pill reads **Edit channel** when `conversation?.is_promoted` and **Edit
chat** otherwise. The word is derived from the payload the view already holds rather than from a new
prop: the view reads `conversation.cwd`, `.name` and `.last_used_at` directly a few lines above, and a
`promoted?: boolean` prop would be a second authority on a fact already in scope. The optional-chain
form keeps the null-conversation branch typed without a `!` — that branch renders no pill at all,
since the pill stays gated on `onRename` exactly as before.

`ChannelInfoSheet` resolves the open chat's host at render time with
`serverIdForOpenConversation(useConversationListStore(selectConversations), conversation?.id ?? null)`
— the `useSessionSettingsConnected` idiom, with both imports already present in the file and
`selectConversations` a bare field read, so the added subscription re-renders only when the list
itself changes. The existing `renameOpen && conversation !== null` mount then splits on
`conversation.is_promoted`:

- **chat (`is_promoted` false)** — `EditChatDialogView`, byte-for-byte as #1440 left it, including its
  `available` prop and its Archive chat arm.
- **channel (`is_promoted` true)** — `EditChannelDialog` with `conversationId={conversation.id}`,
  `serverId`, `name={renameName}`, `onNameChange={setRenameName}`, `onCancel` closing the dialog
  alone, and `onSave={(writePrompt) => …}`. The arm additionally requires `serverId !== null &&
  available`: `available` is this sheet's `connected(…)` equivalent, mirroring `ChannelList`'s
  documented host-loss close, and the `!== null` is what narrows `serverId` to the `string` the
  container's prop demands without a cast.

The channel arm's `onSave` restates `ChannelList`'s body in `ChannelList`'s order — the live
`connectedConversationHostNow(conversation.id)` re-check first, then `writePrompt()`, then the rename,
then `setRenameOpen(false)` — with one deliberate divergence: **no unchanged-name no-send check.** The
sheet has always sent its rename unconditionally (`EditChatDialog`'s header records
`ConversationScreen` as one of the two callers that do), and splitting that behaviour across the two
arms of one pill would make the sheet's rename mean different things for a chat and a channel. Both
arms close the dialog and leave the sheet standing, as the chat arm already does.

No new state: both arms drive the one `renameOpen`/`renameName` pair. No new export, no new type, no
wire, IPC or transport change, and `SystemPromptSection` in the sheet is untouched.

## Testing strategy

- **Static (`ConversationScreen.test.tsx`, beside the existing `ChannelInfoSheetView` block).** Two
  server renders of the view with `onRename` supplied: a `createdPayload({ is_promoted: true })`
  renders `>Edit channel</button>` and no `Edit chat`; the default non-promoted `createdPayload()`
  renders `>Edit chat</button>` and no `Edit channel`. The existing sheet tests all use the
  non-promoted default and stay green.
- **Fake-transport (`e2e/channel-info-edit-channel.spec.ts`, new).** The container's arm choice needs a
  click, and no renderer spec in this repo can click. Seed `conversationStateFake` with one promoted
  row so `launchPairedApp` lands in that channel's thread, open the sheet through the operator's own
  route (overflow → Channel info), assert the dialog is absent, click the pill **scoped to
  `.conversation`** so the sidebar pen cannot be the thing that opened it, then assert the Edit channel
  dialog is visible with its name field seeded from the channel. A screenshot of that state is the
  ticket's visual evidence.
- The two shipped specs that click this pill — `offline-conversation-actions.spec.ts` and
  `conversation-create-rename.spec.ts` — both act on non-promoted conversations (`SEEDED_ROW` and the
  minted `created-1`), so both keep finding **Edit chat**.

## Open questions

None outstanding. The one judgement taken above and not deferred: the channel arm does **not** adopt
`ChannelList`'s unchanged-name no-send, for the reason stated under Change.

## Documentation handoff

The ticket body has no Documentation handoff section and no documentation-only acceptance criterion.
Pending for the documentation stage: fold this branch into
`docs/knowledge/features/conversation-shell-session-and-channel-info.md` § "Rename action … retitled
Edit chat", and note the second entry point on
`docs/knowledge/features/edit-channel-dialog.md`.
