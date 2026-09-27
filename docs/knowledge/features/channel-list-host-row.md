# Channel List — the host row and its connection dots

One saved paired daemon workspace produces one host row in the sidebar, even with no active conversations. Hosts follow saved order. A second daemon workspace on the same machine gets its own row and sections; conversations do not move between them by matching `cwd`. The [Channel List](channel-list.md) describes the host-first render and unattributed fallback.

<a id="the-host-row-channellisttsx-added-by-710-the-operators-label-by-834"></a>

## The host row

`HostRow` renders a 28px row with a server-rack glyph, an operator-stored label (falling back to `Server`), and two status dots. The label renders only as an auto-escaped React child, never as an attribute, title, path or log. `HostRowControl` reads the label and status by the row's saved server id; the current open conversation is not the identity source. The id is used for keyed reconciliation and selectors, never displayed. That prevents a second paired host's label or connection changes from steering this row.

On a healthy host, the glyph, label and chevron sit in a native disclosure button inside `.channel-list__host`. The row itself is still a `div`, and Edit host and the status dots are siblings of the disclosure, so buttons are never nested. Every healthy host has the disclosure, including an empty one. `aria-expanded` drives a downward chevron when open and a rightward chevron when closed. A failed host has no disclosure; it keeps its error-colored label, visible Repair host control and both status dots. Its sections remain visible even if the host was closed before the failure. [Host and section folds](channel-list-host-fold.md) covers the retained local state.

<a id="the-rows-pen-and-plus-on-hover-1185"></a>

The hover action is **Edit host**. Its pen and pointer-following name pill use fixed client copy; clicking opens [Edit host](edit-host-dialog.md), which changes the local paired-host label. The host row no longer renders **Add workspace**. A connected host instead exposes **Create channel** and **Create chat** pluses on its section rows, including when empty. Their confirmation dialogs send the clicked host with `cwd: null` so the daemon chooses its default folder. Disconnected and reconnecting hosts have no section pluses. Section labels are fixed and cannot be renamed. Legacy `onAddWorkspace` props and dialog code still exist in `ChannelList.tsx`, but there is no sidebar entry point; the verifier marked that unreachable path for later cleanup.

<a id="the-edit-host-dialog-1299"></a>
<a id="the-add-workspace-dialog-1308"></a>

The host's trailing status slot stays reserved even when the edit pen appears, so a long label does not reflow on hover. The pen is revealed by hover or focus, and the connection dots remain readable at rest. A failed host keeps repair and edit separately clickable. Browser interaction tests are needed here: markup presence alone cannot detect controls overlapping the status slot.

<a id="the-host-rows-connection-dots-channellisttsx-added-by-718"></a>

## Connection dots

`HostConnectionDotsControl(serverId)` reads daemon and relay status through their separate per-server selectors. `HostConnectionDots` renders the daemon leg first and relay leg second as two 6px dots. Each has `role="img"` and the corresponding accessible label. The two leg mappings share a type, so a swap would type-check; the ordering test pins the design order.

A saved host with no report yet uses each store's own initial state for display: the daemon appears offline and the relay unknown. This is a display fallback, not a repair command. A classified pairing rejection reads `Pyrycode Pairing rejected`; reconnecting and offline keep their distinct labels. Relay state remains independent, so a daemon failure may appear beside a connected relay. Color comes from the shared `.conn-dot--up`, `--in-progress`, `--down` and `--unknown` categories in `channels.css`; [the browser color spec](../../../e2e/connection-dot-colours.spec.ts) checks computed paint because static markup cannot.

## Related

- [Channel List](channel-list.md) — row attribution, partitioning and creation.
- [Host and section folds](channel-list-host-fold.md) — disclosure state and failure behavior.
- [Host-first tree geometry](channel-list-tree-inset.md) — row and section positions.
- [Edit host dialog](edit-host-dialog.md) — local host-label mutation.
- [Session store](session-store.md) and [relay-link store](relay-link-store.md) — per-server status sources.
