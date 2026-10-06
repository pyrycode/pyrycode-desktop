# Channel List — the host row and its controls

One saved paired daemon workspace produces one host row in the sidebar, even with no active conversations. Hosts follow saved order. A second daemon workspace on the same machine gets its own row and sections; conversations do not move between them by matching `cwd`. The [Channel List](channel-list.md) describes the host-first render and unattributed fallback.

<a id="the-host-row-channellisttsx-added-by-710-the-operators-label-by-834"></a>

## The host row

`HostRow` renders a 28px row with a server-rack glyph and an operator-stored label (falling back to `Server`). It has no connection dots or dot wrapper at rest, on hover or on keyboard focus, and no replacement host indicator. The label renders only as an auto-escaped React child, never as an attribute, title, path or log. `HostRowControl` reads the label by the row's saved server id and receives that host's status from `CollapsibleHostGroup`; the current open conversation is not the identity source. The id is used for keyed reconciliation and selectors, never displayed. That prevents a second paired host's label or connection changes from steering this row.

On a non-failed host, the glyph, label and chevron sit in a native disclosure button inside `.channel-list__host`. The row itself is still a `div`, and Edit host is a sibling of the disclosure, so buttons are never nested. Every non-failed host has the disclosure, including an empty, connecting or unreported one. `aria-expanded` drives a downward chevron when open and a rightward chevron when closed. A failed host has no disclosure; it keeps its error-colored glyph and label, visible Repair host control and separate Edit host control. Its sections remain visible even if the host was closed before the failure. The saved-chats read-error line remains below the row when the local read fails. [Host and section folds](channel-list-host-fold.md) covers the retained local state.

<a id="the-rows-pen-and-plus-on-hover-1185"></a>

The hover action is **Edit host**. Its pen and pointer-following name pill use fixed client copy; clicking opens [Edit host](edit-host-dialog.md), which changes the local paired-host label and reads/edits that selected host's daemon-wide system prompt. The host row no longer renders **Add workspace**. A connected host instead exposes **Create channel** and **Create chat** pluses on its section rows, including when empty. Their confirmation dialogs send the clicked host with `cwd: null` so the daemon chooses its default folder. Disconnected and reconnecting hosts have no section pluses. Section labels are fixed and cannot be renamed. Legacy `onAddWorkspace` props and dialog code still exist in `ChannelList.tsx`, but there is no sidebar entry point; the verifier marked that unreachable path for later cleanup.

<a id="the-edit-host-dialog-1299"></a>
<a id="the-add-workspace-dialog-1308"></a>

The trailing control space stays reserved at rest and on hover, so a long label does not reflow when the Edit pen appears. The controls are absolutely positioned: Edit has a 20px target at a 25px right inset on a non-failed row; on a failed row, Edit moves to a 52px right inset and Repair occupies its own 20px target at a 28px inset. Label and disclosure reservations clear these targets. Edit reveals through row hover or its own keyboard focus; its opacity changes without removing it from the tab order. There is no dot/control swap. [The hover spec](../../../e2e/host-row-hover-controls.spec.ts) drives pointer and keyboard activation; [the long-label spec](../../../e2e/host-label-sidebar.spec.ts) checks truncation and fixed geometry. [Failed-host clicks](../../../e2e/sidebar-offline-mutations.spec.ts) prove Edit and Repair remain separately usable: markup presence alone cannot detect overlapping hit boxes.

<a id="the-host-rows-connection-dots-channellisttsx-added-by-718"></a>

<a id="connection-dots"></a>

## Connection presentation and verification

Host rows do not display daemon or relay legs. The host-dot components, wrapper, geometry and hover/focus swap are removed. The shared `.conn-dot--up`, `--in-progress`, `--down` and `--unknown` classes remain flat in `channels.css`, bound respectively to success, warning, error and outline tokens. [The browser color spec](../../../e2e/connection-dot-colours.spec.ts) checks their computed backgrounds with standalone probes, without requiring host dots. [Conversation activity dots](channel-list-status-dot.md) keep their separate state and paint contract.

A disclosure alone cannot prove authentication: connecting, disconnected and unreported hosts are also foldable. Connection checks need host-scoped, connected-only section creation controls or composer readiness together with the existing authentication and receipt barriers. For isolation, [the two-host spec](../../../e2e/host-row-per-server.spec.ts) first observes host B's failed row and Repair control after its terminal leg loss, then checks host A's label, folds, creation controls and usable composer. Checking A before positively observing B's loss could pass against the pre-loss render. Static renderer tests cover dot/wrapper absence across all six host states; browser tests own hover, focus, geometry and interaction.

## Related

- [Channel List](channel-list.md) — row attribution, partitioning and creation.
- [Host and section folds](channel-list-host-fold.md) — disclosure state and failure behavior.
- [Host-first tree geometry](channel-list-tree-inset.md) — row and section positions.
- [Edit host dialog](edit-host-dialog.md) — local host label and selected-host system prompt.
- [Session store](session-store.md) and [relay-link store](relay-link-store.md) — per-server status sources.
