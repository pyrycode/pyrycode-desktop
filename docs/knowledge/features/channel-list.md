# Channel List home screen

The paired region's [`list` route](paired-shell.md) — since [#670](../codebase/670.md) also the
always-mounted sidebar of the two-pane desktop shell, shown alongside `thread` rather than only on
`list` — a pure render slice over the already-shipped
[conversation list store](conversation-list-store.md), splitting each saved host's conversations into
**Channels** (saved, `is_promoted === true`) and **Chats** (ad-hoc,
`is_promoted === false`; labelled "Recent discussions" until the desktop-design relabel,
[#709](../codebase/709.md)), each row showing its title alone at the desktop node's compact 24px
height — a trailing last-activity time until
[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) removed it, see [the row's desktop
geometry](channel-list-desktop-row-geometry.md). Mirrors the mobile home screen (mobile #312). Replaces the throwaway `PlaceholderList`
[#140](../codebase/140.md) shipped as a stand-in.

Introduced in [#141](../codebase/141.md). Conversation rendering remains a pure view over held state;
host apps consume a separate display stream, and the app-wide self-update row reads its own store
and sends narrow actions through preload.
Updater eligibility, download verification and installation authority stay in main.

## What it does

The sidebar shows each saved host once, in paired-server order, including a host with no
conversations. Under each host are fixed **Channels**, **Chats** and **Apps** sections, in that order.
Channels holds active promoted rows; Chats holds active unpromoted rows. Each host's Channels and Chats sort alphabetically
by displayed title, separately; the unattributed Channels and Chats fallbacks after all hosts follow
the same rule. A rename or daemon auto-name moves the row after the re-list; an unnamed chat sorts at
its **Untitled** placeholder position until named. Displayed titles remain verbatim. Archived rows
belong only in [Archive](archive-screen.md), which retains daemon list order. A missing or unpaired
server stamp remains visible in a fallback without host actions; it is never assigned to another
host. Two paired daemon workspaces on one machine remain two hosts.

A single **Pinned** section, when non-empty, precedes every host, outside any host's folds — see [the
global Pinned section](#the-global-pinned-section) below. Eligible rows leave their host's Channels
list; they are never also drawn there.

The host and all three sections begin expanded and fold independently, including on an empty host.
Folding preserves the current conversation or app selection and composer draft. Host rows show no
connection dots or dot wrapper in any state; Edit host reveals on hover or keyboard focus. A failed host keeps a
separate, visible Repair host control and its error-colored glyph and label, and reveals its
sections even if it was folded before failure. See [host and section folds](channel-list-host-fold.md).

Connected hosts have a trailing plus on Channels and Chats. **Create channel** and **Create chat** open
their respective confirmation dialogs, including on an empty host. Confirmation targets the clicked
host with `cwd: null`, letting that daemon workspace choose its default folder; Cancel sends no
create. Disconnected hosts cannot create. The section labels are fixed and have no rename action.
The host hover control is **Edit host**; the sidebar has no Add workspace or Edit workspace action.
The [toolbar](channel-list-section-header-pair-control.md) holds a 24px **Sidebar menu** ellipsis
at the left and **Pair new host** at the right above a fixed rule, outside the scrollport.
The menu lists Settings then Archive, with no selected row, in loading, empty and populated
states. Selection closes it and invokes the existing `onOpenSettings` or `onOpenArchive`
callback once. Its popup paints above the rule and tree; the first outside click dismisses
without opening a conversation or folding a host, and the next click operates normally.

Conversation rows retain their title, status dot, selection, edit and
[Save-as-channel](save-as-channel-dialog.md) controls. The Channels pen opens
[Edit channel](edit-channel-dialog.md); the Chats pen opens
[Edit chat](rename-conversation-dialog.md). The row's own identity, stored `cwd` and daemon
contract are unchanged. The 400px card uses the [host-first geometry](channel-list-tree-inset.md).
There are no sidebar workspace rows, global Channels/Chats trees or section divider.

### Host apps

Each paired host's Apps section lists complete discovery in daemon order, independently of its
conversations. Titles render as escaped React text, bounded to 128 characters by main. Rows show
readable `starting`, `running`, `stopped` or `failed` observed state beside the title, with existing
status-dot styles. Contiguous lifecycle updates change that host's rows without a restart; removal
affects only its row. Equal app IDs on two hosts remain distinct. Apps has no creation plus:
creation stays conversational.

| Discovery state | Section body |
| --- | --- |
| Initial or `loading` | Loading apps… |
| Complete `ready` with no items | No apps |
| `failed` | Could not load apps, with Retry |
| `unavailable` | Apps disconnected |
| `unsupported` | Apps unsupported |

Retry refreshes only the clicked host; in-progress refreshes coalesce in main. Disconnected and
unsupported hosts send no discovery or resource requests. Partial pages and cached readiness after
reconnect never become rows. Retry uses shared typography, outline, spacing, radius and focus tokens.

`ChannelList` owns a mount-local Zustand Map of display snapshots keyed by host. Its effect subscribes
through `window.pyry.onHostedApps(serverId, listener)`, clears the Map when the saved-host list changes,
and deactivates callbacks before unsubscribing. `ChannelListView` receives injectable display and pane
state plus select/refresh callbacks. Main and preload provide the additional
[subscription and replacement fences](daemon-connection-hosted-resource-views.md#sidebar-display-projection).

Clicking an app sends `hostedPane({ type: 'select', serverId, appId })`; the streamed
`hostedPaneStore` state highlights only that host/app. While a pane is open, conversation highlights
are suppressed. Selection does not start a non-running app or authorize a release from display
metadata. Main retains readiness and opening authority. Apps and host folds preserve each other's
section state and selection. Returning to the original channel/chat closes the hosted pane and
[restores its selection and draft](paired-shell-routing.md#hosted-app-selection-and-trusted-chrome).

[`e2e/hosted-app-sidebar.spec.ts`](../../../e2e/hosted-app-sidebar.spec.ts) clicks production rows
through preload/IPC; [counted evidence](daemon-connection-hosted-resource-views.md#sidebar-verification)
records its four cases. Static renderer tests prove escaped text, states and selection markup only.
Apps reuse `.channel-list__row-open`, so conversation fixture activation and row counts must exclude
rows containing `.channel-list__app-state`. Seeding apps only after fixture launch hides an overly
broad selector. Fold checks must account for three sections per host, and pointer-pill tests must
place a real conversation control at the scrollport edge: extra Apps rows can remove the overflow
precondition without changing the control itself.

### App-wide self-update row

`ChannelListView` renders its optional `appUpdate` slot after `.channel-list__tree`, outside the
host scrollport. `AppUpdateRow` stays pinned below the hosts within the card's 20px inset; the row
is 360px wide in the fixed 400px sidebar. Host connectivity, folds and conversation selection do
not control it. The app-lifetime subscription lives in `App`, so completion received while Settings
or pairing owns the screen is retained in `appUpdateStore`. Main supplies the latest state after
a renderer remount. See [Windows self-update](windows-packaging.md#packaged-windows-self-update).

- Ready shows **Update ready** and “Version X.Y.Z installs when you restart.” Only a stable ASCII
  three-part version, at most 64 characters with no leading zeroes except zero itself, is displayed;
  prefixes, whitespace and prerelease/build suffixes fall back to “An update installs when you restart.”
  **Restart now** requests silent installation and relaunch after the history drain. **Later**
  hides the row for the process lifetime while preserving installation on ordinary quit.
- Download/verification failure shows **Update could not install**, “Pyrycode will try again next
  launch.” and **Dismiss**. Dismiss hides it for the process lifetime; duplicate errors cannot
  revive it. Checking, downloading, up-to-date results and check/offline failures draw nothing.
  Development and non-Windows builds never show the row.

The separator uses inverse-primary at 60% opacity, with a 12px gap below it; the 20px edgeless Update
path sits 8px from body-medium title/body-small caption. Only the failed caption uses the error
role. Restart reuses the shared small Secondary button; Later/Dismiss use text actions.
`app-update.svg` is a local alpha mask painted by `--color-primary`. An external image with a fixed
fill would ignore theme changes, while Vite's default small-asset data URL would violate renderer
CSP; keep its `assetsInlineLimit` exclusion in `electron.vite.config.ts`.

[`e2e/app-update.spec.ts`](../../../e2e/app-update.spec.ts) decodes the actual mask, checks intrinsic
and rendered 20px dimensions, changes the primary token to prove recolouring, and measures pinned
insets at 1280×800 and 800×600 windows. It also drives all three actions through preload, including
completion during Settings and dismissal across remounts. Markup alone proves neither asset paint
nor clicks. Counted gate evidence and pending Surface acceptance are recorded in
[Windows packaging](windows-packaging.md#self-update-test-evidence).

## Why the row carries no message preview

The wire `ConversationSummary` (`src/shared/wire/types.ts`) carries **no message text** — only
`last_message_ts` (RFC3339), `id`, `name: string | null`, `is_promoted`, `is_archived`, `cwd`,
`last_used_at`, since [#1287](https://github.com/pyrycode/pyrycode-desktop/issues/1287)
`workspace_label: string | null` (see [workspace grouping](channel-list-workspace-grouping.md)), and
since [#1594](https://github.com/pyrycode/pyrycode-desktop/issues/1594) `is_muted?: boolean` — whether
the host has muted this conversation's notifications. No row in this screen reads `is_muted` yet (the
mute checkbox and the notification gate are later consumers); the field is optional in the TS type but
the decoder (`parseConversationSummary`) always emits a boolean, normalising an absent key to `false`
so a daemon predating the field keeps notifying — a future consumer reads it as `row.is_muted ===
true`, never on the key's presence. [#1595](https://github.com/pyrycode/pyrycode-desktop/issues/1595)
shipped the write side, `setConversationMuted` — no row here sends it either; see [Daemon connection —
system-prompt and MCP-status correlation § Conversation-mute write
correlation](daemon-connection-correlation-system-prompt-and-mcp.md#conversation-mute-write-correlation-1595)
for the transport, and [Edit channel dialog](edit-channel-dialog.md) for the checkbox that will call it
(#1596). See [Inbound message decode —
internals](inbound-message-decode-internals.md) for the decode. The Figma design's "Recent discussions" rows show a 2-line message-body preview and
message-derived titles for unnamed discussions — neither is buildable from this wire shape. Adding the
preview needs a daemon-side wire change first (a field on `conversations_read.go`'s
`ConversationSummary`), then a desktop decode ([#139](conversation-list-fetch.md)) and store
([#208](conversation-list-store.md)) change — flagged to the human in the ticket, not built
speculatively.

This gap is unrelated to the row's own last-activity time, which the mobile-mirrored row showed in
place of the preview and which
[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) later deleted outright — the
**desktop** node (103:2968) draws no time and no trailing element of any kind, independent of what the
wire can or can't supply. `formatLastActivity` itself is untouched and stays live for its three other
callers — the Archive screen's subtitle, `WorkspacePickerSheet`, and `ConversationScreen` — see
[the row's desktop geometry](channel-list-desktop-row-geometry.md).

## How it works

New directory, `src/renderer/src/screens/channels/`:

```
screens/channels/
├── channelListViewModel.ts       # pure helpers: titles, active sorting, partitions, grouping, time
├── channelListViewModel.test.ts
├── ChannelList.tsx               # container (ChannelList) + pure view (ChannelListView)
├── ChannelList.test.tsx
└── channels.css                  # token-only
```

### The view-model (`channelListViewModel.ts`)

Framework-free `.ts`, mirroring `messageViewModel.ts` — every derivation unit-tests without React or
the store:

- `titleFor(name: string | null): string` — `name` when present and non-blank
  (`name.trim() !== ''`), else `UNNAMED_LABEL = 'Untitled'`.
- `partitionByPromotion(rows)` — two order-preserving `Array#filter`s on `is_promoted`. No sort. The
  neutral shared primitive both `partitionActive` (below) and [`archiveViewModel.partitionArchived`](archive-screen.md)
  wrap, each pre-filtering on `is_archived` from opposite ends before delegating to it.
- `partitionActive(rows)` — filters `!r.is_archived` first, delegates to `partitionByPromotion`, then
  sorts fresh copies of both active partitions with the private `compareActiveRows` comparator.
  Input arrays and rows are not mutated; row references and server stamps survive. Both helpers are
  generic (`<T extends ConversationSummary>`) so their signatures preserve the caller's row type.
  Keep sorting here: moving it into the shared primitive would also reorder Archive.
- `groupByServer(serverIds, rows)` — the level [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)
  added for host attribution (§ Server grouping below).
- `formatLastActivity(iso: string, now: number): string` — `now` is **injected**, not `Date.now()`
  inside, so the function stays pure and deterministic under test. Bucket contract:

  | condition (`delta = now - Date.parse(iso)`) | output |
  |---|---|
  | `Date.parse(iso)` is `NaN` | `''` (row renders title only) |
  | `delta < 0` (clock skew) | `'just now'` |
  | `delta < 1min` | `'just now'` |
  | `delta < 1h` | `Nm ago` |
  | `delta < 24h` | `Nh ago` |
  | `delta < 48h` | `'Yesterday'` |
  | `delta < 7d` | `N days ago` |
  | else | UTC-derived `Mon DD` (never `toLocaleDateString` — timezone-independent) |

The active comparator uses `titleFor(row.name).trim()` as its label, so null, empty and
whitespace-only names sort as `Untitled`. Its key is
`label.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase()`: compatibility decomposition,
removal of every nonspacing combining mark, then lowercase. Compare keys ascending with UTF-16
code-unit `<` and `>`; equal keys compare trimmed labels, then `row.id`, with the same operators.
Thus `Alpha` precedes `alpha`, and `Chat 10` precedes `Chat 2`. Never substitute `localeCompare`,
`Intl.Collator` or natural-number ordering. Desktop and mobile share this comparison contract,
using their own displayed placeholders (`Untitled` and `Untitled discussion`, respectively).

Trimming and normalization affect comparison only; `titleFor` still displays a usable name verbatim.
The worked order is `Alpha`, `alpha`, `beta`, `Émile`, `Untitled`, `zeta`. Each render derives fresh
partitions from the latest list snapshot, so renamed and newly named rows move without cached sort
state. View-model tests pin compatibility/accent/case folding, numeric and UTF-16 order, both
tie-breaks, frozen input/reference identity, archive exclusion and the shared Archive input order.

### The container + pure view (`ChannelList.tsx`)

`ChannelList` supplies conversations, paired host ids and `SessionState.statuses` to
`ChannelListView`. The view keeps a stable `<section className="channel-list"
aria-label="Conversations">` root, including under static server rendering.

Sidebar mutations require the clicked row or host's status to be `connected`;
missing, reconnecting, disconnected and error entries fail closed. This covers chat/channel
creation, conversation rename and Save as channel. The open chat never determines
availability. Held rows remain selectable; host and section folds remain usable. The
existing workspace dialog state has no sidebar entry point.

Section creation retains the clicked `serverId` and sends `cwd: null` on confirmation,
so the daemon selects that host's default folder. Rename and promotion retain the clicked
`conversation_id`. Submission checks the live store before sending. Disconnect clears
open creation and conversation-action targets, preventing a stale draft from reappearing
on reconnect. [Save as channel](save-as-channel-dialog.md#what-it-does) also abandons
its pending folder continuation across reconnect.

Each row's title renders as `<span className="channel-list__title">{titleFor(row.name)}</span>` — an
auto-escaped React child (never `dangerouslySetInnerHTML`), the #203/#218 untrusted-string posture,
and since #1097 the row's only text. React key is `row.id` — a real stable per-conversation identity
(unlike the timeline's array-index keying). The row itself is not a single button — see § The row's
save affordance below for the wrapper/open-button/affordance split #274 introduced.

Successive static renders in `ChannelList.test.tsx` prove sorting across renamed and newly named
snapshots, including two hosts and both fallbacks; they cannot prove event delivery or action
identity. [`e2e/sidebar-alphabetical-order.spec.ts`](../../../e2e/sidebar-alphabetical-order.spec.ts)
renames an open chat across another row and checks that selection, a distinguishable working dot,
Edit chat prefill and submitted ID, Save as channel and each host's section creates retain their
targets after the re-list. Identical dots would conceal a status subscription attached to the wrong
row.

### The row's save affordance (`ChannelList.tsx`, added by #274)

An interactive control cannot nest inside a `<button>`, so `Row` is no longer a single button: it's
now a `.channel-list__row` flex wrapper around sibling children — `.channel-list__row-open` (the
original button, `onClick={onOpen}`, `flex: 1 1 auto; min-width: 0` so the title still ellipsizes),
an optional trailing icon-only `.channel-list__save` (`aria-label="Save as channel"`), and an
optional trailing icon-only pen carrying the `.channel-list__rename` token (added by
[#360](../codebase/360.md); its own `.channel-list__chat-edit` token on a Recent row, added by
[#1441](channel-list-row-hover-control.md#1441-a-chats-row-now-carries-both-controls-not-one)). The
class tokens are historical and do not move with the word: a Channels row's pen reads **Edit
channel** since [#1476](edit-channel-dialog.md) (**Rename** before it) and opens the [Edit channel
dialog](edit-channel-dialog.md) through its own `onEditChannel` handler; a Chats row's pen reads
**Edit chat** and opens the [Edit chat dialog](rename-conversation-dialog.md) through `onRename`,
which now serves the Chats tree alone. Both pens draw from one `RowPenControl` shape (label,
class tokens, handler) built in `renderBody` for the two row partitions — see [the row's hover-revealed
control](channel-list-row-hover-control.md) for the shared markup.

Since #1441 the two trailing-control sets are **not** disjoint by section: a Recent row carries both
its own Save-as-channel chevron and this pen, while a Channels row carries the pen alone (there is
nothing to save on an already-promoted row). `renderBody` passes `onSaveAsChannel` to the Recent
`.map` alone and a pen handler to both maps, so at most two trailing controls render per row, never
the Save-as-channel chevron on a Channels row. The container owns each dialog's open/name state as
its own local `useState` pair, rendered as siblings of `ChannelListView`. See [Save-as-channel
dialog](save-as-channel-dialog.md), [Edit channel dialog](edit-channel-dialog.md) and [Edit chat
dialog](rename-conversation-dialog.md) for the dialogs themselves, and
[#274](../codebase/274.md)/[#360](../codebase/360.md) codebase notes for lessons learned.

### The row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by [#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097))

Split out to its own page: [the row's desktop geometry](channel-list-desktop-row-geometry.md) — #1097's
convergence on Figma node 103:2968: a derived (never declared) 24px height, shrunk trailing affordances,
the corner moved onto the fill's painted surface, 4px between rows via an adjacent-sibling rule rather
than a column `gap`, the body-small label, the deleted time, and the status dot's now-settled centring.

<a id="the-host-row-and-its-connection-dots-channellisttsx-added-by-710718-per-server-keying-by-1199"></a>

### The host row and its controls (`ChannelList.tsx`)

See [the host row and its controls](channel-list-host-row.md) for saved-host identity, the disclosure,
Edit host and failed-host Repair targets. Rows have no daemon/relay dots or hover swap. Label and
status reads remain keyed by the row's own saved `serverId`, so another host cannot steer its label,
failure treatment or controls. The saved-chats read-error line remains below the affected host.

### Server grouping (`channelListViewModel.ts` / `ChannelList.tsx`, added by [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070))

`groupByServer(serverIds, rows): { servers, unattributed }` remains the pure attribution
boundary. The container reads saved ids in `pairedServerStore.list()` order and passes them to
`ChannelListView`. `renderBody` partitions and sorts active rows once, groups each partition by server,
then renders one keyed `CollapsibleHostGroup` per saved id with Channels, Chats and Apps beneath it.
No path grouping occurs in this active render. `groupByServer` preserves incoming row order, so
each host's conversation section and each unattributed fallback is a sorted subsequence of its active
partition, using the same normalized-key, trimmed-label and ID tie-breaks. Sorting conversations never changes
paired-host order or fallback placement. A host's key is its saved server id, so reordering cannot
transfer fold state to a different host.

The join iterates client-owned saved ids and tests row stamps against them. A stamp can select a
saved host but cannot create one. Rows stamped with `null`, `undefined` or an unpaired id land
in the unattributed Channels or Chats fallback after all hosts. They gain neither a host row nor
a create control. Dropping such a row would hide a real conversation; placing it under the first
host would claim an identity the client cannot establish. The helper uses a `Map`, avoiding
plain-object `__proto__` behavior for string ids. Server ids are React reconciliation keys and
comparison operands, never rendered as labels or attributes.

### The global Pinned section (`channelListViewModel.ts` / `ChannelList.tsx`, added by [#2084](https://github.com/pyrycode/pyrycode-desktop/issues/2084))

Pins are host-local and nullable (`ConversationSummary.pinned_at?: string | null`, [Core
\#3538](https://github.com/pyrycode/pyrycode/issues/3538)) — the daemon decides what's pinned, this
screen only displays it; see [Conversation list store § Received pin
state](conversation-list-store.md#received-pin-state-since-2084) for the decode. `partitionSidebar(rows,
serverIds)` wraps `partitionActive`: it starts from the active Channels partition, keeps only rows
stamped with a **saved** host id (`serverIds`, the same join `groupByServer` uses — an unattributed or
unpaired-host stamp is never eligible) and a non-null `pinned_at`, and removes exactly those rows from
the Channels copy it returns. Chats, Apps, and both unattributed fallbacks are untouched. `renderBody`
draws the resulting `pinned` list in a `.channel-list__pinned` block before the host loop, and omits
both the block and its separator when `pinned` is empty — the section's only entry/exit condition.

Ordering parses each row's `pinned_at` once (not once per comparator call) with a local
`PIN_RFC3339`/`pinInstant` pair that mirrors [Archive's `archiveInstant`/`isArchiveInstant`
convention](archive-screen.md) rather than importing it, to keep this screen's fallback semantics from
drifting if Archive's ever changes: real calendar/leap-year validity, RFC3339 offset or `Z`, and
arbitrary sub-millisecond precision compared by parsed milliseconds first, then the fractional digits
past the third with trailing zeros trimmed (so `.0001` and `.00010000...1` compare correctly without
float rounding). A row with a syntactically invalid or impossible-date stamp sorts after every row
with a valid one. Ties — both invalid, or two valid instants equal to that precision — break on
`serverId` then `id`, ascending UTF-16 code-unit order, the same tie-break family `channelListViewModel`
uses elsewhere. Two hosts reporting the same conversation ID both keep their own pinned row — the
partition and the sort key on server id first, never collapsing by conversation id alone. The input
array and its rows are not mutated.

Each pinned row reuses the ordinary `Row` component with two additional optional props: `pinnedHost`
(a display label, never `undefined` for a pinned row, so its presence is `Row`'s own "am I a pinned
row" signal) and `hostDown`. The title's `· host name` suffix renders as a second escaped `<span
className="channel-list__pinned-host">` child of the existing title span — never a separate attribute,
URL or lookup key — using the same `hostRowLabel`/`selectHostLabelFor` fallback (`'Server'`) the host
row itself falls back to, read by the container from `useHostLabelStore` and passed down as a
`serverId → label` map so the pure view never touches the label store directly. The pen is the existing
`CHANNELS_ROW_PEN` (**Edit channel**, gated on that row's own host being `connected` — never on the
open chat), and the row's React key is `JSON.stringify([serverId, id])`, the two-part key `groupByServer`
anticipates for exactly this duplicate-ID case.

**Selection is both-identities, not conversation-id-alone — [verifier finding
1](../../specs/architecture/2084-global-pinned-channels.md#revisions) on the first pass.** A pinned
row reads `isOpen` from `serverId === openServerId && row.id === openConversationId` (and no hosted
pane open); `openServerId` is a narrow read of the active conversation's own stamped host
(`useActiveConversationStore`), not a derived guess. Comparing only `row.id` would mark both of two
hosts' rows current whenever they share a conversation ID, which the duplicate-ID case above
guarantees can happen. Opening a pinned row calls the same `onOpen` every other row uses; host
attribution and the Edit channel dialog's target follow the clicked row, not the open chat.

**Offline appearance is scoped to pinned rows only, by a data attribute, not a shared class.**
`Row` sets `data-pinned` and `data-host-down` on its wrapper; `channels.css` scopes
`.channel-list__row[data-host-down='true']` to error-colored title/suffix/status-dot text and 0.6
row opacity, `connecting` draws the normal appearance, and a 1px inverse-primary
`.channel-list__pinned-rule` follows the group. This status comes from the same `SessionState.statuses`
map every other row reads — a pinned row for a saved-but-unreachable host keeps rendering from the
persisted list (see [chat history](chat-history.md)) through a profile relaunch, independent of
whether that host's connection has resolved yet.

[`pinnedChannels.test.tsx`](../../../src/renderer/src/screens/channels/pinnedChannels.test.tsx) is the
static suite: `partitionSidebar` ordering (fractional precision, invalid-after-valid, UTF-16 ties,
eligibility, frozen input) and markup (heading placement, escaped suffix and fallbacks, exactly one
pinned-vs-host-tree selection, connecting-vs-down-vs-error coloring, empty-section omission).
[`e2e/sidebar-pinned.spec.ts`](../../../e2e/sidebar-pinned.spec.ts) is the one mounted scenario: external
and correlated `conversation_updated` pushes that add/remove/reorder only the emitting host's pins,
host-attributed rename and selection across a shared conversation ID, measured geometry against Figma,
computed disconnected/error styling, and an actual profile relaunch that observes a successful saved
list before quitting rather than re-seeding one. Local pin/unpin controls are a separate ticket
(#2085); this screen only ever displays a pin the host already reports, including one changed from
another device.

### Workspace data

The [workspace data and sidebar grouping](channel-list-workspace-grouping.md) page distinguishes
surviving `cwd`/label helpers and dialog code from the active host-first render. Creation from a
section uses the clicked daemon workspace's default folder. The old workspace grouping and sidebar
workspace controls have no rendered entry point.

### The row's status dot (`ChannelList.tsx`, added by #801, wired to `input-required` by #874)

Split out to its own page: [the row's status dot](channel-list-status-dot.md) — the
`ConversationStatusDotControl` every row leads with, joining five per-id store reads through
`isConversationUnread`/`resolveConversationStatus` into the leaf `ConversationStatusDot`, and the
placement/geometry/testing lessons from wiring it in. An outstanding permission or trust prompt,
or a pending question batch, shows the gold `input-required` dot. Idle stays an unfilled primary ring at
half opacity even on hovered/open rows; working is solid primary blue and blinks; new messages is solid
success green. See [the dot's paint contract](conversation-status-dot.md).

#### Thread-route unread and attention

`ConversationStatusDotControl` and the badge's `conversationStatusNow(row)` use
thread read policy for every host-stamped row, including before its first snapshot
or opening. `conversationReadRouteStore` additionally retains the accepted epoch
for scoped read publication. Optional summary fields do not negotiate capability.
Off-screen attention comes from that host/conversation's bound live state.

On a selected thread route, unread means received `last_shown_version > read_up_to`, even
without a held timeline. Zero is present and equality is read. Missing either field makes
thread unread unavailable (the predicate returns false); history IDs, local counts and local
marks cannot fill that gap. Hidden trailing items and live-state counters cannot raise this
comparison. Sending a read command never clears it; only the owning daemon's received mark
can confirm reading. See [committed thread read publication](conversation-shell.md#authoritative-thread-read-publication).

Both local stamp paths use `stampLastReadFor`. Any explicitly selected thread with the same
conversation ID suppresses stamping, including when its metadata is missing: local marks
are ID-keyed, so choosing only one host's matching row would leave another path to a stamp.
Host-stamped production rows always suppress legacy local read stamps. Retained
unattributed callers keep the previous history/local-count policy.

The actual host-stamped row supplies read fields and mode. Attention still ranks pending
permission/trust/questions above working, then new messages, then idle. Archived rows stay
outside the active sidebar; the badge excludes archived and muted rows and counts only
input-required/new-messages, once per eligible conversation. Muting does not hide its dot.
Route changes also wake the badge subscription. See [unread](conversation-unread.md) and
[badge composition](app-badge.md).

### CSS (`channels.css`)

`.channel-list__tree` scrolls inside the padded card; the top bar, its rule and the app-wide
self-update row remain outside that scrollport. Since
[#1527](https://github.com/pyrycode/pyrycode-desktop/issues/1527), it shares
the [thread and composer's hidden-scrollbar policy](conversation-shell-chrome.md#layout-contract):
`scrollbar-width: none` plus a separate `::-webkit-scrollbar { display: none; }` fallback hide the
bar at rest and during scrolling, including with an always-visible OS scrollbar preference.
`overflow-y: auto` preserves native wheel, trackpad and focus scrolling. Keep the negative
`--space-5` right margin and matching padding: the scrollport extends through the card's 20px
right inset while the content retains its existing inset and row positions. The 24px top
padding scrolls with the tree; see [tree geometry](channel-list-tree-inset.md).

[`e2e/sidebar-scrollbar.spec.ts`](../../../e2e/sidebar-scrollbar.spec.ts) seeds 20 channels and
20 chats after the fixture's single-row launch, at 1100×800 and 800×600. It proves overflow,
checks both hiding declarations and `overflow-y: auto` before and after input, reaches the first
and last rows by wheel, and Tabs through every row to reveal and focus the last one while the
top bar stays fixed. A zero gutter alone cannot prove hiding: overlay bars consume no layout
width even when visible. Static renderer tests cannot observe either CSS paint or focus
scrolling. Physical trackpad momentum and changing the OS scrollbar preference were not
manually exercised; computed style verifies the policy independently of that preference.

Host rows reserve fixed trailing control space without a dot wrapper or hover/focus swap.
Edit reveals through opacity on hover or keyboard focus; failed hosts reserve separate pen and repair targets.
A DOM-presence assertion misses overlapping controls; exercise the actual Edit host and
Repair host clicks (`e2e/sidebar-offline-mutations.spec.ts`).

Token-only: every color/type/spacing value is a `var(--…)` token; opacity is the de-emphasis device
(the #218 precedent), never a color literal. Added a new `--text-title-medium-*` quad to
`theme/tokens.css` (16px/24px/0.15px/500, the exact M3 values from Figma node 15-8) for the row title —
the M3 scale had no `title-medium` slot before this.

`.channel-list__host-label` gained an ellipsize treatment in [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834):
`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — expiring the rule's
former exemption ("a six-character compile-time constant cannot overflow the sidebar"), now that the
label is bounded only at `MAX_HOST_LABEL_LENGTH` (128). Three of `.channel-list__workspace-label`'s
four ellipsize declarations are copied; the fourth, `flex: 1 1 auto`, is **deliberately not** — the
label must shrink without growing away from its chevron. The disclosure uses `flex: 1 1 auto` and
`min-width: 0`, while the row reserves space for absolutely positioned trailing controls. These
positions and the label's truncation point stay fixed on hover. The shared `conn-dot--*` color
bindings remain in this stylesheet independently of host presentation; conversation activity dots
keep their own bindings.

Lifting `min-width` on the label alone was not sufficient — the *ancestor* flex item,
`.paired-shell__sidebar`, still had `min-width: auto`, and a `white-space: nowrap` descendant's
min-content size is the whole string: a 128-character label measured the sidebar to ~1063px before
this fix, and `.channel-list__tree`'s `overflow-x: auto` (a side effect of its `overflow-y: auto`,
`.channel-list`'s before #1443) does not stop that propagation — a scroll container's automatic
minimum size is 0 for *itself*, but its
min-content *contribution* to an ancestor is still content-derived. See [Paired shell § the sidebar's
`min-width: 0`](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the
fix, landed as its own commit so it stayed independently reviewable.

**`.channel-list` paints no background of its own since #1058**, and gained `position: relative` there
too, lifting its subtree above the sidebar wrapper's own `::before` wash. Keeping `z-index: auto`
avoids creating a stacking context that traps fixed name pills. See [Paired shell § the pane
card](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the
wash itself and the stacking reasoning.

`.channel-list` deviates from the architecture spec's `flex: 1 1 auto`: it uses `height: 100%;
box-sizing: border-box` instead. Originally because `PairedShellView` mounted this `<section>` directly
under the block-level `#root` with no flex wrapper in between — `flex: 1 1 auto` would have been inert
there (no fill, no internal scroll) — mirroring `.conversation`'s direct-child-of-`#root` pattern.
Code-review-verified as a legitimate, well-reasoned spec deviation. **Since [#670](../codebase/670.md)**,
`.channel-list` *is* the child of a flex item (`.paired-shell__sidebar`, a fixed 400px column), but the
same rule still holds: it carries no width rule of its own, so `height: 100%` continues to fill whatever
box it's given, and the sidebar's `flex: 0 0 400px` is the single place width is decided. The
`channels.css` header comment was updated at #670 to record the new parent rather than leave the old
"not a flex item" claim standing.

#### Row control hover

Each edit pen, section-create plus and Save-as-channel chevron paints its own
`--color-state-hover` rectangle with `--radius-xs` corners when the control itself
is hovered. Row hover alone reveals the glyph without this layer; keyboard-only
focus retains the existing outline and name pill without painting the layer.
The layer extends 4px beyond each side of the SVG box: 20px square for the 12px
conversation pens/chevron, 22px for the 14px host/workspace pens and 24px for
the 16px pluses.

The shared `:hover::before` rule covers `.channel-list__host-edit`,
`.channel-list__workspace-edit`, `.channel-list__rename`, `.channel-list__chat-edit`,
`.channel-list__host-add`, `.channel-list__workspace-create`,
`.channel-list__section-create` and `.channel-list__save`. Host-add and workspace
controls remain retained CSS surfaces without sidebar entry points.
The absolutely positioned, non-interactive layer sits over the row fill and below
the relatively positioned SVG. Sizing the paint from the larger hit box would
give the wrong glyph clearance; changing button padding or dimensions would
move existing geometry. Keep the centring transform on the pseudo-element:
transforming the button would trap its [fixed name pill](channel-list-control-name-pill.md)
in a new containing block.

[`e2e/sidebar-control-hover.spec.ts`](../../../e2e/sidebar-control-hover.spec.ts)
checks layer tokens, glyph-relative clearance and unchanged row/button/SVG boxes
at 1280×800 and 800×600, plus keyboard-only focus and pointer-following pills.
It applies the three dormant classes to equivalent existing controls only inside
the test; that proves their CSS treatment, not a restored action. Static markup
cannot establish hover paint or layout stability. See the
[hover design](../../specs/architecture/1865-sidebar-control-hover.md).

## Edge cases and limitations

- Archived rows are excluded by `partitionActive` before either section is grouped.
  A paired host still renders when it has no active rows. If there are neither paired
  hosts nor active rows, the tree body is empty while the toolbar remains.
- Missing or unpaired server stamps render in an unattributed Channels or Chats
  section after the hosts. These sections have no create control. Host attribution
  never falls back to the first saved host.
- A host's three section folds survive closing and reopening the host because the
  hidden section components stay mounted. A failed host reveals all three sections and
  repair even if it was closed earlier. Recovery restores its held host fold.
- Apps retain daemon order rather than conversation title order. Workspace names, folder paths and
  `workspace_label` are retained as data but do not produce sidebar rows.
- A host disclosure does not prove a connected session: connecting, disconnected and unreported
  hosts remain foldable but cannot create. Authentication checks need connected-only controls or
  composer readiness plus authentication/receipt barriers; see
  [host connection verification](channel-list-host-row.md#connection-presentation-and-verification).
- **Unpairing an unreachable saved host after a profile relaunch can hang — tracked by
  [#2089](https://github.com/pyrycode/pyrycode-desktop/issues/2089), reproduced on unchanged main
  without any pin field or pinned markup involved.** The global Pinned section's own restart,
  offline-appearance and authoritative-replace behavior are unaffected and independently verified;
  only the follow-on unpair action on such a host is the open gap. Do not read #2084's e2e coverage as
  closing it — that scenario is skipped pending #2089, independently of the active pin-display
  assertions in the same spec.
- **Mounted and recorded-replay coverage of the Pinned section (`e2e/sidebar-pinned.spec.ts`, the
  shared-replay client scenarios) is fake-transport and captured-daemon evidence, not current
  provider/daemon live acceptance.** It proves the client's own decode, partition, render and
  persistence behavior against a scripted peer; it does not establish that a present-day `pyry`
  daemon or provider sends `pinned_at` in the shape this screen expects.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread` router this screen
  fills the `list` arm of; since [#670](../codebase/670.md) also the two-pane shell's sidebar.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the store slice
  this screen reads verbatim (snake_case `ConversationSummary` rows, `null` vs `[]` contract), including
  [the received `pinned_at` field](conversation-list-store.md#received-pin-state-since-2084) this
  screen's global Pinned section reads (#2084).
- [Global Pinned section architecture](../../specs/architecture/2084-global-pinned-channels.md) —
  design, security review and the verifier-found host-vs-conversation-id selection fix (#2084).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the transport
  decode; documents the no-message-text wire gap this screen's row shape is scoped by.
- [Conversation shell](conversation-shell.md) — the thread view every row opens into via `onOpen`.
- [The create → nav bridge, formerly the new-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md)
  — the FAB was deleted in #1426; the bridge survives as the nav wiring behind this screen's create controls.
- [Settings screen](settings-screen.md) — the first Sidebar menu item and its `settings` route.
- [Archive screen](archive-screen.md) — the second Sidebar menu item and its `archive` route.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274](../codebase/274.md) — the per-row
  save affordance and naming dialog; restructured `Row` into the open-action + save-affordance
  sibling shape described above.
- [Rename dialog](rename-conversation-dialog.md) / [#360](../codebase/360.md) — the per-row rename
  affordance on saved Channel rows, the symmetric counterpart of Save-as-channel.
- [Archive screen](archive-screen.md) / [#469 codebase notes](../codebase/469.md) — `partitionActive`,
  the dual of `partitionArchived`, fixing archived rows leaking into this list.
- [#141 codebase notes](../codebase/141.md) · Spec: `docs/specs/architecture/141-channel-list-screen.md`
- [Host row and its controls](channel-list-host-row.md) — saved host identity,
  failure treatment, edit and repair.
- [Host and section folds](channel-list-host-fold.md) — independent state and failure reveal.
- [Workspace data and sidebar grouping](channel-list-workspace-grouping.md) — retained
  path and label data, and the retired workspace entry points.
- [Host-first tree geometry](channel-list-tree-inset.md) — measured insets, heights and spacing.
- [Create channel](create-channel-dialog.md) and
  [Create chat](conversation-create.md) — section confirmation dialogs.
- [Conversation status dot](channel-list-status-dot.md) — per-row state.
- [Host-first architecture](../../specs/architecture/1683-host-first-sidebar.md) — design decisions.
