# Channel List — the row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by #1097, marked by #1098, redrawn by #1171, workspace row nested by #1178)

Split out of [Channel List home screen](channel-list.md) § How it works, where the package overview
had grown past the size cap. Read the parent doc first for the screen's overall shape. This page was
itself split once its own six sections passed the doc-guard's 50000-byte cap
(`npm run check:docs`) — it is now a map to those sections, each its own page, listed below in the order
the geometry converged.

## Sections

- [The row's desktop convergence](channel-list-row-convergence.md) (#1097) — the mobile row's 24px height,
  type, spacing and status-dot centring converged onto the desktop node.
- [The open row's fill](channel-list-row-open-fill.md) (#1098) — `aria-current` and the `:has()` fill that
  marks the sidebar's currently-open chat.
- [The row's 8px inset and its hover-revealed control](channel-list-row-hover-control.md) (#1171) — the
  redrawn frame's inset, the hover fill moving off the button, and the Save/Rename controls leaving the
  flex flow for an always-absolute, hover/focus-revealed box.
- [The tree's inset](channel-list-tree-inset.md) (the 2026-09-05 inset fix) — the card-edge padding and
  margins that aligned the whole tree — section header, host row, channel rows, divider — to the Figma
  node.
- [The control's own name pill](channel-list-control-name-pill.md) (#1172, pointer-following since #1427) —
  `.channel-list__control-name`, the shared Pill treatment all seven sidebar controls wear; the home page
  for its mechanism regardless of which control carries it.
- [The workspace row's own nest and its create-chat plus](channel-list-workspace-row-nest.md) (#1178) — the
  workspace row's own 20px nest, its wrapper element, and the create-chat/create-channel plus.
- [The workspace row's plus names itself in a pill](channel-list-workspace-plus-pill.md) (#1181) — that
  plus's own reader of the shared name-pill treatment.

## Related

- [Channel List home screen](channel-list.md) — the parent doc.
- [Composer attach — the name pill](composer-attach-name-pill.md) — the treatment
  [the control's own name pill](channel-list-control-name-pill.md) restates, #1265, shipped first.
- [Save-as-channel dialog](save-as-channel-dialog.md), [Rename conversation dialog](rename-conversation-dialog.md)
  — the two dialogs the row's trailing controls open; their own CSS summaries were corrected for #1171's redraw.
- [Conversation create](conversation-create.md) — `requestNewConversation`'s constructor and the
  `conversationCreated` event-driven nav the workspace plus's click resolves through; the FAB's own consumer doc.
- [Channel List — the host row's pen and plus on hover](channel-list-host-row.md#the-rows-pen-and-plus-on-hover-1185)
  (#1185/#1190) — this treatment's third and fourth wearers, one level up the tree.
- [Channel List — the section header's pair-new-host control](channel-list-section-header-pair-control.md)
  (#1303/#1304) — this treatment's fifth wearer.
