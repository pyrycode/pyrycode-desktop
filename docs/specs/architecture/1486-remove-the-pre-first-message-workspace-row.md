# #1486 — remove the pre-first-message Workspace row

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `WorkspaceChip`, `WorkspaceChipProps`,
  `WORKSPACE_CHIP_LABEL`, the `pickerOpen` `useState` and the `WorkspacePickerSheet` mount — everything this
  ticket deletes lives here.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__workspace-chip` and its four
  descendants, plus the six comments elsewhere that cite one as a precedent.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` → the `WorkspaceChip` describe and the
  `createdPayload` helper beside it — the helper is shared with the `ChannelInfoSheetView` tests and stays.
- `src/renderer/src/screens/conversation/WorkspacePickerSheet.tsx` → `WorkspacePickerSheetView`,
  `requestChangeWorkspace`, the `WorkspacePickerSheet` container — the file stays whole; only its container's
  last caller goes. Read to confirm the container is the sole supplier of `onCreateFolder`.
- `src/renderer/src/screens/settings/DefaultWorkspaceRow.tsx` → `DefaultWorkspacePickerSheet` — the surviving
  consumer of `WorkspacePickerSheetView`, untouched by this ticket. Confirms the view keeps a live caller.
- `e2e/workspace-picker.spec.ts`, `e2e/real-daemon-workspace.spec.ts` → both enter only through the chip's
  "Change workspace" button; no other entry point, so both files go whole.
- `e2e/offline-conversation-actions.spec.ts` → the fourth test is the chip-driven one; the other three do not
  touch the picker.
- `docs/knowledge/features/conversation-shell-workspace-chip-and-picker.md` and
  `docs/knowledge/features/conversation-shell.md` → the surface this removal halves; the documentation stage
  owns the fold (see § Documentation handoff).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4

The chat pane is a top bar with the overflow menu, then the message thread, then the composer footer — no
pill, no path and no "Change" control anywhere above the thread. The screenshot draws a populated thread, so
the empty state is not drawn separately; what it settles is that the workspace row has no home in the chat
pane at any thread length. Removing it brings the empty thread to the drawing.

## Change

`WorkspaceChip` rendered a Material 3 pill above an empty, unpromoted thread: the client-owned "Workspace"
label, the conversation's `cwd`, and a "Change" button that opened `WorkspacePickerSheet`. Since the sidebar's
workspace plus (#1178) and Add workspace (#1189) started every chat in a chosen directory, the row restates a
choice already made, so it goes and the empty thread's copy becomes the first thing below the banner row.

Deleted from `ConversationScreen.tsx`: `WORKSPACE_CHIP_LABEL`, `WorkspaceChipProps`, `WorkspaceChip`, the
`<WorkspaceChip>` element above `Timeline`, the `pickerOpen` `useState`, the conditional `WorkspacePickerSheet`
mount and its import. `activeConversation` and `actionsAvailable` both keep other readers in the file
(`ChannelInfoSheet`, `EditChatDialog`, `BackgroundTaskPanel`, the queued-row drop, `RunConfigData`), so neither
read is disturbed. Deleted from `conversation.css`: `.conversation__workspace-chip` and its `-pill`, `-label`,
`-cwd` and `-change` rules, with the last one's three state selectors.

**Nothing else is swept.** `WorkspacePickerSheet.tsx` keeps its file — Settings' `DefaultWorkspaceRow` mounts
`WorkspacePickerSheetView` and `requestChangeWorkspace` keeps its unit test — and the `WorkspacePickerSheet`
container, `CreateFolderDialog` and `requestChangeWorkspace` stay in the tree dormant after losing their last
caller here. That is deliberate: the container is the app's only supplier of `onCreateFolder`, so removing this
row removes the app's only way to make a directory on the host, and **#1499 owns that capability question**.
Sweeping the dormant code here would pre-empt it, and this codebase already carries dormant paths on purpose
(`workspaceFolderRejected`, `conversationCreateRejected`).

**The six comment re-points.** Each cites a deleted rule as its precedent and must cite a live one instead.
The precedent is in the file already: `.question-panel__label--tab` records that it cited
`.conversation__unpair` for the pill form until #1061 deleted that rule. Same situation, six times over.

| Comment on | Cited | Re-points to |
|---|---|---|
| `.conversation__thread` (the #1444 inset block) | `.conversation__banner` and `.conversation__workspace-chip` | `.conversation__banner` alone — the other rule that stated its x as "the thread's" |
| `.bubble__file-icon` (non-shrinking lead item) | `.bubble__copy`, `.conversation__workspace-chip-label` + a count | `.bubble__copy` and `.composer-status__icon`; the count is dropped rather than re-derived |
| `.bubble__file-name`'s no-rule note (deliberately no ellipsis) | `.conversation__workspace-chip-cwd` and `.tool-row__summary` | `.tool-row__summary` and `.channel-info__row-value--mono` |
| `.composer__attachment-name` (the bound's chain) | `.conversation__workspace-chip-cwd`'s chain, "the untrusted-cwd precedent" | `.channel-info__row-value--mono` — the Channel info sheet's Workspace line, which is now the surviving untrusted-cwd ellipsis chain |
| `.channel-info__row-value--mono` (truncate, don't overflow) | the `.conversation__workspace-chip-cwd` treatment | `.tool-row__summary` — the root of that same chain, an unbounded daemon string bounded by ellipsis |
| `.question-panel__label--tab` (text button minus its pill) | `.conversation__workspace-chip-change` carries the pill form | `.modal-rejection__dismiss` — same recipe (`flex: 0 0 auto`, `--space-2`/`--space-3` padding, no border, `--radius-full`, transparent, label-large), differing only in ink |

Two of these point at each other's owners and that is not a cycle: `.tool-row__summary` is the chain's root and
cites neither.

## Testing strategy

The chip-driven coverage is retired, not skipped — there is no behaviour left for it to guard:

- `ConversationScreen.test.tsx` — the `WorkspaceChip` describe and the `WorkspaceChip` import go. The
  `createdPayload` helper defined beside the describe **stays**: the `ChannelInfoSheetView` tests further down
  the file use it. So does the `ChannelInfoSheetView` test asserting its Actions slot holds no "Change
  workspace" — a different surface.
- `WorkspacePickerSheet.test.tsx` — names `WorkspaceChip` only in two comments, as the test idiom it copies.
  Reworded to name a live idiom; the test itself is untouched.
- `e2e/workspace-picker.spec.ts` and `e2e/real-daemon-workspace.spec.ts` — deleted whole. Both open the sheet
  through the chip's "Change workspace" button and have no second entry point, so leaving either would leave an
  always-failing spec, not a thinner one.
- `e2e/offline-conversation-actions.spec.ts` — loses its fourth test only. The other three stay; any import or
  helper left without a caller by that deletion goes with it.

What proves the removal: the existing `ConversationScreen` and `Timeline` empty-thread assertions, which now
describe the first thing below the banner row. No new assertion is added — the change removes logic rather than
adding any, and the two surviving surfaces (Settings' picker, the channel-info Workspace line) keep the tests
they already have.

Gate: `npm test` on the touched files plus `npm run build`. The full unit suite, `npm run e2e` and the real
tier are the verifier's and the operator's, per the ticket's AC4.

## Documentation handoff

Pending for the documentation stage, not done here:

- `docs/knowledge/features/conversation-shell-workspace-chip-and-picker.md` — § "Workspace chip (#278)"
  describes a surface that no longer renders. Fold the removal in, keeping the picker's continuing life in
  Settings and recording that the create-folder entry point is gone pending #1499.
- `docs/knowledge/features/conversation-shell.md` — the two paragraphs introducing the chip (#278) and its
  wiring to the picker (#383) need the same fold.

Precedent: #1061's fold of the Unpair control's removal and #1064's of the back arrow's.
