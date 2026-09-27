# Channel List — workspace data and sidebar grouping

The sidebar renders one host for each paired daemon workspace, with Channels and Chats directly underneath. It has no workspace rows, workspace fold, Add workspace control or Edit workspace control. Two daemon workspaces on one machine remain two saved hosts. A conversation's `cwd` and `workspace_label` remain daemon data, but neither creates a sidebar level. See [the host-first hierarchy](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070).

The pure `workspaceLabelFor` and `groupByWorkspace` exports remain in `channelListViewModel.ts`, and the retired `renderServerTrees` and workspace dialog paths remain in `ChannelList.tsx` without a sidebar entry point. They do not describe the active render. This distinction matters when reading old tests or refactoring the component: do not infer a visible workspace row from a surviving helper. The final verifier flagged the unreachable renderer and dialog state for later cleanup.

Workspace paths remain exact strings. `workspaceLabelFor` interprets `/` segments only for a display label and does not normalize `cwd`; `/a/b` and `/a/b/` remain different keys. A daemon `workspace_label`, including a blank non-null one, is presented verbatim when a workspace label is shown elsewhere. An unusable path falls back to `Unknown workspace` only in the legacy grouping helper. The [Edit workspace dialog](edit-workspace-dialog.md) and [workspace rename contract](conversation-workspace-change.md#workspace-rename-label-change-1289) remain documented for callers outside the retired sidebar controls.

The host section pluses reuse the [Create chat](conversation-create.md) and [Create channel](create-channel-dialog.md) confirmation flows. The clicked host is retained, and confirmation sends `cwd: null` so that daemon workspace chooses its own default folder. The section can create even with zero rows. Cancel sends nothing. A disconnected or reconnecting host has no plus; submission rechecks connection state. The new row appears after the daemon's `conversationCreated` event and fresh list, without any sidebar folder derivation. A matched host's rows are partitioned by promotion, in list order; archived rows are excluded. Missing or unpaired server stamps stay in unattributed sections after all saved hosts and gain no host actions.

The fake transport can verify the clicked host and `cwd: null`. A count of section rows cannot prove which folder a live daemon chose: the final verifier found that the migrated real-daemon create-channel spec counts two sections both before and after creation. When maintaining that spec, assert the returned conversation's `cwd` independently.

## Related

- [Channel List home screen](channel-list.md) — active grouping and row behavior.
- [Host row](channel-list-host-row.md) and [host fold](channel-list-host-fold.md) — visible hierarchy and state.
- [Conversation list store](conversation-list-store.md) — re-list triggers, including `workspace_updated`.
