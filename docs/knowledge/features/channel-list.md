# Channel List home screen

The paired region's [`list` route](paired-shell.md) — since [#670](../codebase/670.md) also the
always-mounted sidebar of the two-pane desktop shell, shown alongside `thread` rather than only on
`list` — a pure render slice over the already-shipped
[conversation list store](conversation-list-store.md), splitting the daemon's conversations into
**Channels** (saved, `is_promoted === true`) above **Chats** (ad-hoc,
`is_promoted === false`; labelled "Recent discussions" until the desktop-design relabel,
[#709](../codebase/709.md)), each row showing its title alone at the desktop node's compact 24px
height — a trailing last-activity time until
[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) removed it, see [the row's desktop
geometry](channel-list-desktop-row-geometry.md). Mirrors the mobile home screen (mobile #312). Replaces the throwaway `PlaceholderList`
[#140](../codebase/140.md) shipped as a stand-in.

Introduced in [#141](../codebase/141.md). Renderer-only, pure render slice — no keys, sockets, tokens,
transport, or new store/wire code, so not security-sensitive.

## What it does

- Reads `useConversationListStore(selectConversations)` and renders: **not-yet-loaded** (`null`) →
  the neutral wrapper only, no headers, no rows; **nothing to draw** (no paired server *and* no
  active row) → the wrapper only; otherwise both section headers and the divider, unconditionally.
  The `"No conversations yet"` empty state was retired by
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070) — a paired app always has at
  least a host row to draw (§ below).
- Splits rows by `is_promoted`, preserving the store's array order within each section (the daemon's
  order is authoritative — no client-side sort), then within each section by **server, then
  workspace** (§ Server grouping below, [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)).
  Both headers and the divider render whenever anything is paired; a paired machine with nothing in
  a section shows its host row there with nothing under it, rather than the section disappearing.
- Each row shows only a title (`name`, or `'Untitled'` when `name` is `null`/blank — never a blank
  row) — a trailing last-activity time until
  [#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) deleted it; `formatLastActivity`
  itself survives for its three other callers (§ Why the row carries no message preview below).
- Every row's click opens the shell's single active conversation (`onOpen`) — not that specific row's
  conversation. See § Edge cases.
- A [new-discussion FAB](new-discussion-fab.md) floats bottom-right over the list, present in all
  three states — a sibling of the section/row rendering described above, added by [#242](../codebase/242.md).
- A [Settings](settings-screen.md) entry button (gear glyph, `aria-label="Settings"`) is pinned
  top-right over the list, likewise present in all three states — added by [#333](../codebase/333.md).
- An [Archive](archive-screen.md) entry button (Material `archive`-box glyph, `aria-label="Archive"`)
  joins it inside the same top-right `.channel-list__actions` cluster, leading the Settings button
  (gear-rightmost) — added by [#347](../codebase/347.md). Two independent sticky top-right children
  would have stacked awkwardly, so both buttons now share one sticky flex-row wrapper.
- Each Recent (unpromoted) row carries a trailing [Save-as-channel](save-as-channel-dialog.md)
  affordance; saved Channel rows carry none. Added by [#274](../codebase/274.md) — see § The row's
  save affordance below.
- Each saved (promoted) Channel row carries a trailing [Rename](rename-conversation-dialog.md)
  affordance; Recent rows carry none — the exact symmetric counterpart, so no row ever carries two
  trailing buttons. Added by [#360](../codebase/360.md).
- Each section now draws **one host row per paired server**, in pairing order, directly below the
  section label and above that machine's own conversation rows (Figma `106:3094` repeated per
  machine in `103:2959`). Both the row and its subtree repeat once per section on purpose — the two
  sections are not deduplicated into a shared tree. It renders a 12px server-rack glyph beside the
  operator's stored host label, falling back to the client-owned word `'Server'` with no usable
  label (never stored, unreadable, or settling), and ends with two trailing connection dots
  reporting that named server's own daemon and relay legs. Added by [#710](../codebase/710.md); the
  operator-typed label shipped in [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834);
  both the label and the dots read by server id since
  [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199); the loop drawing one row per
  paired server, rather than only the first, shipped in
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070) (§ Server grouping below). Per
  the 2026-09-06 operator ruling, every paired machine's row renders in both sections whether or not
  it has conversations there — the row carries the plus that starts a chat in a new workspace
  (#1185/#1189), so a freshly paired machine still needs a route to its first chat. See [the host row
  and its connection dots](channel-list-host-row.md) for the full detail.
- Below each host row, that machine's own rows group by **workspace** — one group per distinct
  `cwd`, each headed by a 28px workspace row one indent deeper than the host row (Figma `106:3098`).
  A workspace is a conversation's `cwd`; there is no separate wire concept for it. Both sections
  group independently, so a workspace with rows in both appears in both; since #1070 this is also
  true across servers — two machines sharing an identical `cwd` render as two separate groups, never
  merged (§ Server grouping below). Groups render expanded (collapse is #704). Added by
  [#703](../codebase/703.md).
- Every row in both trees now leads with a [status dot](conversation-status-dot.md), resolved from
  that row's **own** conversation id — a chat that has never been opened still shows its working or
  unread state, not just the currently-open one. Added by
  [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801); see § The row's status dot below.

## Why the row carries no message preview

The wire `ConversationSummary` (`src/shared/wire/types.ts`) carries **no message text** — only
`last_message_ts` (RFC3339), `id`, `name: string | null`, `is_promoted`, `is_archived`, `cwd`,
`last_used_at`. The Figma design's "Recent discussions" rows show a 2-line message-body preview and
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
├── channelListViewModel.ts       # pure helpers: titleFor, partitionByPromotion, formatLastActivity
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
- `partitionActive(rows)` — filters `!r.is_archived` first, then delegates to `partitionByPromotion`.
  The active list's row source since [#469](../codebase/469.md); the exact dual of
  `archiveViewModel.partitionArchived`. Both partitions went generic
  (`<T extends ConversationSummary>`) in [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)
  so a filter never erases the server stamp the sidebar's rows carry — both bodies are `filter`
  calls, runtime-identical either way, and every existing caller still infers
  `T = ConversationSummary`.
- `groupByServer(serverIds, rows)` — the level [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070)
  added above `groupByWorkspace` (§ Server grouping below).
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

### The container + pure view (`ChannelList.tsx`)

`ChannelList` (container) reads `useConversationListStore(selectConversations)` — its only impurity,
safe under `renderToStaticMarkup` in Node (the store yields its initial `null` there). It passes the
result down to `ChannelListView` (pure), which always returns a stable
`<section className="channel-list" aria-label="Conversations">` root — the test hook, present in
every state — with content by store state (see § What it does). Until
[#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097) it also captured `Date.now()` and
threaded it down as a `now` prop through four file-local signatures; that capture and the prop are
gone along with the time span below.

Each row's title renders as `<span className="channel-list__title">{titleFor(row.name)}</span>` — an
auto-escaped React child (never `dangerouslySetInnerHTML`), the #203/#218 untrusted-string posture,
and since #1097 the row's only text. React key is `row.id` — a real stable per-conversation identity
(unlike the timeline's array-index keying). The row itself is not a single button — see § The row's
save affordance below for the wrapper/open-button/affordance split #274 introduced.

### The row's save affordance (`ChannelList.tsx`, added by #274)

An interactive control cannot nest inside a `<button>`, so `Row` is no longer a single button: it's
now a `.channel-list__row` flex wrapper around sibling children — `.channel-list__row-open` (the
original button, `onClick={onOpen}`, `flex: 1 1 auto; min-width: 0` so the title still ellipsizes),
an optional trailing icon-only `.channel-list__save` (`aria-label="Save as channel"`), and an
optional trailing icon-only `.channel-list__rename` (`aria-label="Rename"`, added by
[#360](../codebase/360.md)). `Row` gained `onSaveAsChannel?: () => void` and (later)
`onRename?: () => void`; `renderBody` passes `onSaveAsChannel` only to the Recent `.map` and
`onRename` only to the Channels `.map` — the two affordance sets are disjoint by section, so each
row carries at most one trailing button, structurally, not merely hidden by CSS. The container owns
each dialog's open/name state as its own local `useState` pair, rendered as siblings of
`ChannelListView`. See [Save-as-channel dialog](save-as-channel-dialog.md) and
[Rename dialog](rename-conversation-dialog.md) for the dialogs themselves, and
[#274](../codebase/274.md)/[#360](../codebase/360.md) codebase notes for lessons learned.

### The row's desktop geometry (`channels.css`/`ChannelList.tsx`, converged by [#1097](https://github.com/pyrycode/pyrycode-desktop/issues/1097))

Split out to its own page: [the row's desktop geometry](channel-list-desktop-row-geometry.md) — #1097's
convergence on Figma node 103:2968: a derived (never declared) 24px height, shrunk trailing affordances,
the corner moved onto the fill's painted surface, 4px between rows via an adjacent-sibling rule rather
than a column `gap`, the body-small label, the deleted time, and the status dot's now-settled centring.

### The host row and its connection dots (`ChannelList.tsx`, added by #710/#718, per-server keying by [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199))

Split out to its own page: [the host row and its connection dots](channel-list-host-row.md) — the row
naming the paired machine a tree's conversations live on, and the two trailing dots reporting that
machine's daemon and relay legs. #1199 moved both off app-wide "most recently written" singleton reads
onto reads keyed by the row's own `serverId`, taken from this client's `serverInfoStore` list and never
from the wire, so a second paired machine's status can no longer steer this row's dots.

### Server grouping (`channelListViewModel.ts` / `ChannelList.tsx`, added by [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070))

The level Figma `103:2959` has always drawn — section, then server, then workspace — but the app
never rendered, because the host row was drawn from a single global (`servers[0]`) rather than a
loop. Two things make the server level load-bearing rather than cosmetic: `groupByWorkspace`'s key
is the raw `cwd`, and a path is unique only *within* one machine, so two servers both holding
`/home/user/project` would silently merge into one workspace group holding both machines'
conversations unless the server level sits above it; and the 2026-09-06 operator ruling gives every
paired machine a host row in both sections whether or not it has conversations there.

`groupByServer(serverIds, rows): { servers, unattributed }` is a new pure export, generic and
**structurally** constrained (`{ readonly serverId?: string | null }`) rather than importing
`conversationListStore`'s `ServerConversationSummary` — this module stays framework- and store-free
so every derivation unit-tests without React or zustand. `serverIds` is the client's own
`serverInfoStore` list (`selectServers`, in `pairedServerStore.list()` order — oldest-paired first),
read in the `ChannelList` **container** and passed down as a prop rather than read inside a row:
the same `openConversationId` ruling applies — zustand v5 serves `getInitialState()` under
`renderToStaticMarkup`, so a row reading the list itself could only ever render the empty launch
frame, and the whole of "one row per server" would fall to e2e. `renderServerTrees` (`ChannelList.tsx`)
splits a section's rows by server *before* handing each machine's rows to `groupByWorkspace`
unchanged, rather than re-keying that grouper on a composite `serverId + cwd` — the smaller change,
and the correct one: React scopes keys per sibling list, so wrapping each server's subtree in its
own keyed `<Fragment key={serverId}>` already makes the raw-`cwd` group keys collision-free across
servers, and it buys per-server workspace-fold independence for free (a `cwd` shared by two machines
gets two `CollapsibleWorkspaceGroup` instances, two separate booleans).

**The join direction is the security property.** `groupByServer` iterates the client's own
`serverIds` and only ever *tests* a row's stamp against those buckets — a stamp can select among
existing keys and can never mint one, so the worst a confused or hostile daemon reaches is its own
rows under its own host row. This is the read-side twin of the rule
[`selectConversationsFor`](conversation-list-store.md)'s docblock states as a condition of its
signature: a wire-sourced lookup key would let one server's conversations appear under another
server's name.

**A `Map`, never a `Record<string, T[]>`** — load-bearing, not stylistic, and written down at the
declaration for that reason: on a plain object a `__proto__` stamp resolves `Object.prototype`, a
truthy non-array whose `.push` corrupts or throws. Client-set stamps make this unreachable today
(the free second fabric), which is exactly why it must not be "simplified" away. A `__proto__`
regression test pins it.

**Where an unstamped or unpaired-server row goes.** `ConversationListOrigin` admits `null` and
`undefined`, and a stamp naming a machine that isn't paired is a third shape; #1068 stamps every
daemon event main-side so none of the three is reachable in production, but the type allows them and
a server-keyed tree has to answer. Such a row lands in `unattributed` and renders last in its
section, grouped by workspace like any other row, with **no host row above it**. Dropping the row
was rejected (it hides a real conversation); filing it under the first paired server was rejected
too (it would put the row under a machine's name on no evidence — the same misattribution the join
direction above exists to prevent, arrived at by omission instead of by a hostile stamp). Rendering
it unattributed is the only outcome that names no machine while keeping the row reachable.

**The React-key exception.** `HostRow`'s header bans the server id from seven sinks — attribute,
class name, React key, title, URL, lookup path, log line. The keyed fragment above needs exactly the
one it bans, so the ban list is amended rather than quietly broken: the other six all reach the DOM
or reach persistence, where a React key is reconciliation identity alone — never serialised, never
emitted by `renderToStaticMarkup`, unobservable to the page. An index key would have been strictly
worse, cross-wiring fold state and per-row component instances between machines whenever the paired
list reorders. A unit test pins a sentinel server id appearing nowhere in the rendered markup.

No log line is added for the `unattributed` bucket: any useful form of one carries the row's `cwd`,
name, or stamp, which ADR 0007's content-free rule and CLAUDE.md both forbid.

### Workspace grouping (`channelListViewModel.ts` / `ChannelList.tsx`, added by #703)

Two pure exports, unit-tested without React: `workspaceLabelFor(cwd: string): string | null` —
the last usable `/`-separated segment of `cwd`, found by walking segments from the end and
returning the first non-blank one after trimming (survives a trailing separator, repeated
separators, and a whitespace-only tail with one rule, not a case per shape); returns `null` only
when every segment is blank. `\` is deliberately not treated as a separator — that would assume
the daemon's host OS, an interpretation this client never makes. And `groupByWorkspace(rows):
readonly WorkspaceGroup[]` — accumulates into a `Map` (never a plain object, since integer-like
string keys on an object enumerate first in numeric order regardless of insertion order, the same
trap `threadTimeline.ts` hit with `Object.entries`, #706), keyed by the *raw* `cwd` string for a
usable label (normalised in no way — `/a/b` and `/a/b/` honestly surface as two groups, both
labelled `b`) or by the module-local sentinel `''` for an unusable one. `''` is collision-proof by
construction: a `cwd` of `''` has no usable segment, so any row that could collide with the
sentinel is already in the fallback bucket by the same rule that assigned it. The fallback group is
labelled `UNKNOWN_WORKSPACE_LABEL = 'Unknown workspace'` and ordered by first appearance like any
other group — not pinned last.

`renderBody` wraps each tree's existing `.map` one level, inside a keyed `Fragment` (the shorthand
`<>` cannot carry a key), still inside the same `length > 0` gate that already decides the host
row and section header — so the zero-row-renders-nothing invariant holds with no new condition.
`Fragment` emits no DOM, so the rendered list stays a flat sibling sequence and every
`.channel-list__row`'s ancestry is unchanged. `WorkspaceRow` is `HostRow`'s structural twin one
indent deeper (28px, same type), differing only in the 8px deeper left inset that shows the
nesting, and it's the file's first component whose visible label is untrusted daemon text rather
than a client-owned constant — it ellipsizes (the `.channel-list__title` treatment) where the host
label, a six-character constant, does not need to. The label reaches the DOM only as an
auto-escaped React child, never an attribute (CLAUDE.md 2026-08-20, #696's MUST FIX). See
[#703 codebase notes](../codebase/703.md) for the full fallback-key trap and selector-hazard
writeup.

Since [#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
and [#1179](create-channel-dialog.md), each `WorkspaceRow` optionally draws a trailing create
control keyed on this same `group.key` — a "Create chat" plus on a Chats-tree row, a "Create
channel" plus opening a dialog on a Channels-tree row — withheld on both trees from the
`UNKNOWN_WORKSPACE_KEY` fallback group alone. A channel is no longer only reachable by [promoting
an existing chat](save-as-channel-dialog.md); see [Create-channel dialog](create-channel-dialog.md)
for the direct path.

### The row's status dot (`ChannelList.tsx`, added by #801, wired to `input-required` by #874)

Split out to its own page: [the row's status dot](channel-list-status-dot.md) — the
`ConversationStatusDotControl` every row leads with, joining four per-id store reads through
`isConversationUnread`/`resolveConversationStatus` into the leaf `ConversationStatusDot`, and the
placement/geometry/testing lessons from wiring it in.

### CSS (`channels.css`)

Token-only: every color/type/spacing value is a `var(--…)` token; opacity is the de-emphasis device
(the #218 precedent), never a color literal. Added a new `--text-title-medium-*` quad to
`theme/tokens.css` (16px/24px/0.15px/500, the exact M3 values from Figma node 15-8) for the row title —
the M3 scale had no `title-medium` slot before this.

`.channel-list__host-label` gained an ellipsize treatment in [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834):
`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` — expiring the rule's
former exemption ("a six-character compile-time constant cannot overflow the sidebar"), now that the
label is bounded only at `MAX_HOST_LABEL_LENGTH` (128). Three of `.channel-list__workspace-label`'s
four ellipsize declarations are copied; the fourth, `flex: 1 1 auto`, is **deliberately not** — it
would make the label absorb the row's free space and render `.channel-list__host-status`'s
`margin-left: auto` inert, replacing a shipped mechanism for pinning the connection dots to the
trailing edge with an implicit one. The workspace row has no trailing element and no such mechanism
to preserve, which is the whole reason the two rules differ.

Lifting `min-width` on the label alone was not sufficient — the *ancestor* flex item,
`.paired-shell__sidebar`, still had `min-width: auto`, and a `white-space: nowrap` descendant's
min-content size is the whole string: a 128-character label measured the sidebar to ~1063px before
this fix, and `.channel-list`'s `overflow-x: auto` (a side effect of its `overflow-y: auto`) does not
stop that propagation — a scroll container's automatic minimum size is 0 for *itself*, but its
min-content *contribution* to an ancestor is still content-derived. See [Paired shell § the sidebar's
`min-width: 0`](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the
fix, landed as its own commit so it stayed independently reviewable.

**`.channel-list` paints no background of its own since #1058**, and gained `position: relative` there
too — not for layout but to lift its subtree above the sidebar wrapper's own `::before` wash, which
would otherwise paint over the unpositioned section headers and host row while leaving the
already-`position: relative` rows untouched. See [Paired shell § the pane
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

## Edge cases and limitations

- **Every row opens the single active conversation, not that row's conversation.** Per-row
  select-and-load needs a transport path that doesn't exist yet (a select-and-load ticket, not yet
  filed as of #141). The seam is already the row — a future ticket changes only what `onClick` passes.
- **Since [#670](../codebase/670.md), a row click while a different conversation's thread is already
  open is a real switch, not just an `open` nav.** Because the sidebar is now permanently mounted, this
  click no longer necessarily passes through `list` — it's the interaction the two-pane shell exists to
  enable, and it drives [the paired shell's `paneKey`
  re-key](paired-shell-routing.md#the-conversation-switch-remount-bug-and-the-panekey-fix) so
  `ConversationScreen` remounts instead of carrying the old conversation's screen-local state over.
- **Archived rows are filtered out.** `renderBody` partitions via `partitionActive`, which drops
  `is_archived` rows before the promotion split — archived conversations render only in the
  [Archive screen](archive-screen.md), never here. Fixed by [#469](../codebase/469.md); before that fix,
  every row the store held rendered here regardless of `is_archived` (a latent #366 regression, "Gap B"
  in [#440](../codebase/440.md)/[#452](../codebase/452.md)). Since
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070) the "nothing to draw" guard is
  `serverIds.length === 0 && channels.length === 0 && discussions.length === 0` — both halves matter:
  a store holding only archived rows still contributes zero to the row half, but a paired server with
  literally nothing in either partition still draws its host rows, because the server half of the
  guard is what a paired app answers on now (§ Server grouping above). The old loaded-zero
  `"No conversations yet"` paragraph and its `.channel-list__empty` rule are deleted, not hidden — a
  paired app is never truly empty any more.
- **A row whose server stamp names no paired machine renders unattributed** — last in its section,
  grouped by workspace, with no host row above it (§ Server grouping above). Unreachable in
  production since #1068 stamps every daemon event main-side; the type still admits it.
- **Deferred visual elements** (documented as intentionally absent, not missing): the top app bar
  (logo/"Pyrycode" title), monogram avatars, and the "See all discussions (N)" collapse. (The
  new-discussion FAB, once deferred here, shipped in [#242](../codebase/242.md) — see [its feature
  doc](new-discussion-fab.md); the settings gear, also once deferred here as "inside a future top app
  bar," instead shipped in [#333](../codebase/333.md) as its own pinned button, since ChannelList still
  has no top app bar.) A screenshot of this screen will not match the full Figma frame 15-8 for this
  reason — fidelity is scoped to the two-section list body only.
- **Section headers are sibling `<header>` elements, not `<h2>`** — flagged in code review as a
  non-blocking future a11y improvement (real headings would give screen readers navigable landmarks).
- **Both section headers and the divider render unconditionally whenever anything is paired**, since
  [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070) — they no longer track whether
  their section holds a row. This retired the two mutually-exclusive-header proxy `save-as-channel-promote.spec.ts`
  and `real-daemon-promote.spec.ts` used to prove "the row moved sections" (a zero-row section used
  to render no header). Both re-proxy on the row's own affordance instead — `.channel-list__save`
  present and `.channel-list__rename` absent before a promote, the reverse after — which is disjoint
  by construction (`Row` is passed one or the other, never both) and still reddens on a promote that
  never lands. Worth the general habit: when a gate becomes unconditional, grep for what was reading
  its absence.
- **The host row shows the label and connection state of the specific server it names**, not a
  singleton — closed by [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199); see
  [the host row and its connection dots](channel-list-host-row.md) for the full detail, including the
  residual staleness a mid-session re-pair leaves until the next `ChannelList` remount.
- **The relay leg's not-yet-known state.** Closed by [#719](../codebase/719.md): `relayLeg(null)` returns
  a fourth category, `unknown`/`Relay Unknown`, instead of being collapsed into `down`/`Relay Offline`.
  See [the host row and its connection dots](channel-list-host-row.md) for how this screen's dots
  consume it.
- **Two workspaces whose last path segment matches render two identically-labelled groups.**
  Deliberately deferred to #716 — a display question, not a trust one, since the groups keep
  distinct `cwd` keys and are never merged.
- **Workspace groups are collapsible per tree, per group, and unpersisted.** [#704](../codebase/704.md)
  turned each `WorkspaceRow` into a real `<button>` disclosure control (`aria-expanded`, click
  withdraws that group's rows and nothing else); the fold survives opening a conversation and
  coming back (component-local state under the sidebar's stable mount position, ADR 0006) but is
  gone on every fresh app start — every group renders expanded by default, and there is no store,
  disk, or wire involvement.
- **Every idle row's status dot is still announced.** See [the row's status
  dot](channel-list-status-dot.md) for the detail and the cheap fix, if wanted.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread` router this screen
  fills the `list` arm of; since [#670](../codebase/670.md) also the two-pane shell's sidebar.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the store slice
  this screen reads verbatim (snake_case `ConversationSummary` rows, `null` vs `[]` contract).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the transport
  decode; documents the no-message-text wire gap this screen's row shape is scoped by.
- [Conversation shell](conversation-shell.md) — the thread view every row opens into via `onOpen`.
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the floating `+`
  affordance rendered as a sibling of this screen's rows.
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the settings entry button
  rendered as a sibling of this screen's rows, and the `settings` route it navigates to.
- [Archive screen](archive-screen.md) / [#347](../codebase/347.md) — the archive entry button sharing
  the Settings button's top-right actions cluster, and the `archive` route it navigates to.
- [Save-as-channel dialog](save-as-channel-dialog.md) / [#274](../codebase/274.md) — the per-row
  save affordance and naming dialog; restructured `Row` into the open-action + save-affordance
  sibling shape described above.
- [Rename dialog](rename-conversation-dialog.md) / [#360](../codebase/360.md) — the per-row rename
  affordance on saved Channel rows, the symmetric counterpart of Save-as-channel.
- [Archive screen](archive-screen.md) / [#469 codebase notes](../codebase/469.md) — `partitionActive`,
  the dual of `partitionArchived`, fixing archived rows leaking into this list.
- [#141 codebase notes](../codebase/141.md) · Spec: `docs/specs/architecture/141-channel-list-screen.md`
- [#709 codebase notes](../codebase/709.md) — relabelled the non-promoted section header from the
  mobile-era "Recent discussions" to the desktop design's "Chats" (Figma `106:3258`); the code-level
  `discussions` partition, CSS classes and store fields kept their names.
- [Channel List — the host row and its connection dots](channel-list-host-row.md) — the full detail
  behind § The host row and its connection dots above: #710/#718's original build, #834's operator-typed
  label, and #1199's per-server-id keying of both the label and the two dots.
- [Channel List — the row's desktop geometry § The workspace row's own nest and its create-chat plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178)
  (#1178) — the Chats-tree workspace plus, the `renderServerTrees` create seam § Workspace grouping
  above now threads.
- [Create-channel dialog](create-channel-dialog.md) (#1179) — the Channels-tree workspace plus and the
  dialog it opens; the first path to a channel that skips [Save-as-channel](save-as-channel-dialog.md)'s
  promotion.
- [#703 codebase notes](../codebase/703.md) — added the workspace grouping level between each
  host row and its conversation rows (Figma `106:3098`), grouping on the daemon's `cwd`.
- [#704 codebase notes](../codebase/704.md) — turned each workspace row into a per-group, per-tree
  disclosure control; renderer-only and unpersisted.
- [Channel List — the row's status dot](channel-list-status-dot.md) — the full detail behind § The
  row's status dot above: #799/#800/#801's three-part split, #874's fourth `input-required` subscription,
  and the wiring/testing lessons.
- [#1097 spec](../../specs/architecture/1097-desktop-24px-sidebar-row.md) — converged the row on the
  desktop 24px node (103:2968): the derived height, the body-small label, the deleted last-activity
  time, the shrunk affordances, and the settled status-dot centring.
  [#1098](https://github.com/pyrycode/pyrycode-desktop/issues/1098) then filled the open row. See
  [the row's desktop geometry](channel-list-desktop-row-geometry.md).
- [#1070 spec](../../specs/architecture/1070-sidebar-grouped-by-server.md) — the server-then-workspace
  grouping design: `groupByServer`'s join-direction security property, the `Map`-not-`Record`
  reasoning, the unattributed-row decision, and the 2026-09-06 always-render-both-sections ruling.
- Deferred: a future daemon+wire ticket (message-body preview text), a future select-and-load ticket
  (per-row open), #716 (same-last-segment workspace label ambiguity), a possible follow-up to
  suppress the idle dot's announced label (see [the row's status dot](channel-list-status-dot.md)).
