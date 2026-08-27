# Channel List home screen

The paired region's [`list` route](paired-shell.md) — since [#670](../codebase/670.md) also the
always-mounted sidebar of the two-pane desktop shell, shown alongside `thread` rather than only on
`list` — a pure render slice over the already-shipped
[conversation list store](conversation-list-store.md), splitting the daemon's conversations into
**Channels** (saved, `is_promoted === true`) above **Chats** (ad-hoc,
`is_promoted === false`; labelled "Recent discussions" until the desktop-design relabel,
[#709](../codebase/709.md)), each row showing its title and a last-activity relative time. Mirrors the
mobile home screen (mobile #312). Replaces the throwaway `PlaceholderList` [#140](../codebase/140.md)
shipped as a stand-in.

Introduced in [#141](../codebase/141.md). Renderer-only, pure render slice — no keys, sockets, tokens,
transport, or new store/wire code, so not security-sensitive.

## What it does

- Reads `useConversationListStore(selectConversations)` and renders three states: **not-yet-loaded**
  (`null`) → the neutral wrapper only; **loaded-zero** (`[]`) → an empty state ("No conversations
  yet"); **non-empty** → the two sections.
- Splits rows by `is_promoted`, preserving the store's array order within each section (the daemon's
  order is authoritative — no client-side sort). A section with zero rows renders no header; a
  divider appears only between two present sections.
- Each row shows a title (`name`, or `'Untitled'` when `name` is `null`/blank — never a blank row) and
  a last-activity relative time derived from `last_message_ts` ("2m ago", "3h ago", "Yesterday", "2
  days ago", or a short UTC date past a week).
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
- Each present tree (Channels, Chats) is now headed by a **host row** directly below its section
  label and above its conversation rows, naming the machine the tree's conversations live on
  (Figma `106:3094`). The row repeats in both trees on purpose — the two trees are not
  deduplicated into a shared heading. It renders a 12px server-rack glyph beside a client-owned
  label, currently the constant `'Server'`; multi-host and the operator-typed label are deferred
  (§ below). Added by [#710](../codebase/710.md).
- Below each host row, rows now group by **workspace** — one group per distinct `cwd`, each headed
  by a 28px workspace row one indent deeper than the host row (Figma `106:3098`). A workspace is a
  conversation's `cwd`; there is no separate wire concept for it. Both trees group independently,
  so a workspace with rows in both appears in both. Groups render expanded (collapse is #704).
  Added by [#703](../codebase/703.md).
- Every row in both trees now leads with a [status dot](conversation-status-dot.md), resolved from
  that row's **own** conversation id — a chat that has never been opened still shows its working or
  unread state, not just the currently-open one. Added by
  [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801); see § The row's status dot below.

## Why last-activity time, not a message preview

The wire `ConversationSummary` (`src/shared/wire/types.ts`) carries **no message text** — only
`last_message_ts` (RFC3339), `id`, `name: string | null`, `is_promoted`, `is_archived`, `cwd`,
`last_used_at`. The Figma design's "Recent discussions" rows show a 2-line message-body preview and
message-derived titles for unnamed discussions — neither is buildable from this wire shape. Both
Figma row shapes (avatar-bearing channel rows, preview-bearing discussion rows) collapse to one
title+time row here. Adding the preview needs a daemon-side wire change first (a field on
`conversations_read.go`'s `ConversationSummary`), then a desktop decode ([#139](conversation-list-fetch.md))
and store ([#208](conversation-list-store.md)) change — flagged to the human in the ticket, not built
speculatively.

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
  `archiveViewModel.partitionArchived`.
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

`ChannelList` (container) reads `useConversationListStore(selectConversations)` and captures
`Date.now()` — its only two impurities, both safe under `renderToStaticMarkup` in Node (the store
yields its initial `null` there). It passes both down to `ChannelListView` (pure), which always
returns a stable `<section className="channel-list" aria-label="Conversations">` root — the test
hook, present in every state — with content by store state (see § What it does).

Each row is `<button type="button" className="channel-list__row" onClick={onOpen}>` with
`<span className="channel-list__title">{titleFor(row.name)}</span>` and
`<span className="channel-list__time">{formatLastActivity(row.last_message_ts, now)}</span>` — both
auto-escaped React children (never `dangerouslySetInnerHTML`), the #203/#218 untrusted-string posture.
React key is `row.id` — a real stable per-conversation identity (unlike the timeline's array-index
keying).

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

### The host row (`ChannelList.tsx`, added by #710)

A module-local, nullary `HostRow(): JSX.Element` — the file's sixth inline-glyph idiom instance,
alongside `SettingsButton`/`ArchiveButton`/`NewConversationFab`/the row's rename/save buttons. It
renders a non-interactive `<div className="channel-list__host">` holding a 12px inline Material
`dns` (server-rack) glyph and `<span className="channel-list__host-label">{HOST_ROW_LABEL}</span>`,
where `HOST_ROW_LABEL = 'Server'` is a module-level client-owned constant — never
`serverInfoStore`'s `serverId` (legitimate in Settings' `ServerRow.tsx:37`, since that's a details
surface; an opaque identifier in this *name* slot would read as an invented machine name) and never
the Figma node's own placeholder text ("Pyrybox").

`renderBody` mounts one `<HostRow />` inside *each* of the two existing `channels.length > 0` /
`discussions.length > 0` gates, directly after the `<header className="channel-list__section-header">`
and before that tree's rows. Because the row lives inside the same gate that already decides
whether the section header renders, "a tree with zero rows renders neither a header nor a host
row" holds by construction — no new condition was added, and the promote specs' "a zero-row
section renders no header" proxy still holds for a second element under it.

The row repeats once per tree deliberately — the operator confirmed the repetition (2026-08-21);
the two trees are not merged under one shared host heading. There is exactly one host row per tree
this milestone, since the app pairs with exactly one daemon (`pairedServerStore.save` overwrites on
re-pair) — the design already draws a `Host container` per tree in anticipation of a future
multi-host case, not built here.

**Selector-safety by construction.** `channel-list__host`/`__host-icon`/`__host-label` share no
class token *and no substring* with any existing selector in the file (`channel-list__row`,
`__row-open`, `__section-header`, …), and the shipped label contains neither "Channels" nor
"Chats" case-folded either way. Both guard the same failure mode: Playwright's strict mode turns an
added element that joins an *existing* locator's match set into a violation rather than an
assertion failure — at fixture-launch scale for the unfiltered `.channel-list__row-open` click 28
specs ride (`launchPairedApp.ts:224`), not just the two `.channel-list__section-header` + `hasText`
promote-spec locators. See [#710 codebase notes](../codebase/710.md) for the full hazard writeup.

### The host row's connection dots (`ChannelList.tsx`, added by #718)

Split from #672 (the not-yet-known relay state half is [#719](../codebase/719.md), which shipped
as a fourth `LegCategory` picked up here with no code change — see below). Each host row ends with
two label-less 6px dots at its trailing edge — the host (daemon)
leg first, the relay leg second — reusing [#330's shipped `relayLeg`/`daemonLeg`/`ConnectionLeg`
mapping](conversation-shell.md#two-dot-relaypyrycode-connection-status-indicator-330) verbatim
rather than growing a second copy of it. The exported pure view `HostConnectionDots({ host, relay
})` renders `<span className="channel-list__host-status">` holding two
`<span className="channel-list__host-dot conn-dot--{category}" role="img" aria-label={leg.label}
/>`; a module-local `HostConnectionDotsControl` reads `useSessionStore(selectStatus)` and
`useRelayLinkStore(selectRelayLinkStatus)` through their shipped narrow selectors and mounts as
`HostRow`'s last child, so a relay flap re-renders only the four dots, not the row or the
conversation list beneath it.

Two reuse decisions, at the two levels the contract exists on:

- **TypeScript.** `relayLeg`/`daemonLeg`/`ConnectionLeg` are imported straight from
  `conversation/ConversationScreen.tsx` — the established cross-screen-import idiom in this
  codebase — rather than lifted into a shared module first. Order is the design's, and is the
  *reverse* of `ConnectionStatusIndicator(relay, daemon)`'s call site: host/daemon first here,
  relay first there. Both props share one type, so a copied call site would swap them silently;
  a leg-order test pins it.
- **CSS.** The colour contract lives one level below the TS mapping, in `.conn-dot--up` /
  `--in-progress` / `--down` (`conversation.css`). The sidebar dot wears that modifier *without*
  its `.conn-dot` 8px base — `.channel-list__host-dot` in `channels.css` supplies 6px geometry
  only. This keeps the category → colour binding to one copy in the renderer
  (`grep -rn "color-success" src/renderer --include='*.css'` proves it), at the cost of a
  cross-file dependency the node-environment unit tier cannot see: if `.conn-dot--*` ever leaves
  `conversation.css`, the sidebar dots go invisible with no test failure. Mitigated by a comment
  on those three rules naming the sidebar as a second consumer — see
  [conversation-shell.md](conversation-shell.md#two-dot-relaypyrycode-connection-status-indicator-330).

The accessible name is `leg.label` unchanged — "Pyrycode Connected"/"Relay Offline"/"Relay
Unknown"/etc. — on a
`role="img"` span (a bare `<span>`'s `aria-label` is dropped by the accessible-name computation,
so this is load-bearing, not decorative). The wrapper carries no role or name of its own, unlike
#330's `role="group" aria-label="Connection status"`: the host row renders twice, and #670's
two-pane layout shows the conversation status row at the same time, so a per-group name would
put three identically-named groups in one window. The dots add no text node.

"Pyrycode" — not the Figma's "Host" or #710's visible "Server" — was kept as the host leg's label
word: any other word would re-derive the label half of #330's contract, and the dot reports the
*daemon session*, not the machine — a machine can be up while `pyry` is not.

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

### The row's status dot (`ChannelList.tsx`, added by #801)

Split from #676, the last of the three ([#799](conversation-status.md)'s resolver,
[#800](conversation-status-dot.md)'s leaf, and this ticket's wiring). A module-private, nullary-prop-free
`ConversationStatusDotControl({ conversationId })`, mirroring `HostConnectionDotsControl`'s shape one level
down: three narrow per-id subscriptions —
`useConversationActivityStore(selectActivityFor(id))`, `useConversationTimelineStore(selectTimelineFor(id))`,
`useConversationLastReadStore(selectLastReadFor(id))` — reduced through
[`isConversationUnread`](conversation-unread.md) then [`resolveConversationStatus`](conversation-status.md)
and handed straight to `ConversationStatusDot`. It renders as `Row`'s **first child**, ahead of the
`.channel-list__row-open` button, in both `renderBody` map sites (`:558`, `:589`) — so both trees, every
workspace group, get exactly one unconditional dot, idle included.

This is also the answer to the question [`conversationUnread.ts`](conversation-unread.md) deliberately left
open — **where the two-store unread composition lives.** It lives here, per row, keyed by the row's own
conversation id: never the open conversation's, so a chat the operator has never opened still shows its
working or unread state correctly.

**Placement — a sibling of the open button, not a child of it.** `ConversationStatusDot` ships a named
`role="img" aria-label` on all three statuses, idle included, so nesting the dot inside
`.channel-list__row-open` would fold "Idle" (and, live, "Assistant working") into the button's own
accessible name, mutating it as the daemon works. `RunConfigSections.tsx:270-280` already declined exactly
this shape for the run-config sheet's unselected radios — a named `role="img"` stays a sibling of an
interactive row, not nested in it. As a sibling the dot is announced in reading order and the button's name
stays `title + time`.

The geometry cost of that choice is real and is paid in CSS, not layout: in the row's ordinary flex flow
the dot would push the button's left edge to x≈22, notching the `:hover`/`:focus-visible` fill short of the
row's leading edge. `channels.css` instead takes the dot **out of flow** —
`.channel-list__row { position: relative }` plus `.channel-list__row > .conversation-status-dot { position:
absolute; left: var(--space-4); top: 50%; transform: translateY(-50%); pointer-events: none }` — landing
both of the Figma's x-values (16px dot, 32px title) exactly while the button keeps spanning the full row and
its hover/focus rectangles unchanged. `.channel-list__row-open`'s own left padding widened from `--space-4`
to `--space-8` to reserve the 32px the dot no longer claims in flow (sidebar-only: `channel-list__row*`
appears in this file alone, so the archive screen's rows are untouched). `pointer-events: none` is what
keeps a click on the dot's box opening the conversation rather than being swallowed by it; it has no effect
on the accessibility tree, so the dot's `role="img"` label is still announced.

Making `.channel-list__row` a positioned element was checked for blast radius rather than assumed
harmless: it moves the row into the positioned-descendants paint layer, where the two sticky top-right
siblings (`.channel-list__actions`, `.channel-list__fab`) win on document order alone — both already carry
`z-index: 1`, so rows still paint under them, and no fixed-position element renders inside a row. No
regression, but worth recording since it's the one edit here whose cost isn't local to the row itself.

**Vertical alignment is a measurement, not an inheritance — and it doesn't work the way this file's own
prior reasoning for `.channel-list__host-dot` claimed.** The Figma frame's `Status dot` instance sits a few
pixels below the `Channel` row title's own centre (`cy` at row-relative y=15 in a 24px frame whose centre is
y=12); porting that 3px offset onto the shipped row would be meaningless, since the shipped row isn't the
design's 24px frame — it carries its own vertical padding, a larger title type scale, and a trailing
`.channel-list__time` the design node has no equivalent for. The dot is centred on the row instead
(`top: 50%; transform: translateY(-50%)`), and the reasoning is recorded in the CSS comment so a later
reader doesn't reopen it. [The dot's own doc](conversation-status-dot.md#edge-cases-and-limitations) records
the matching correction: its "no wrapper needed to centre a 6px dot against the row's line box" claim,
written for `.channel-list__host-dot`, does not hold for this node's Figma metadata and did not transfer
here.

**Testing: two traps in wiring a store into a `renderToStaticMarkup` component, not specific to this
ticket.** Both surfaced while extending `ChannelList.test.tsx` and apply to any future row that reads a
Zustand store under this repo's `environment: 'node'` renderer tier:

- **Seeding a store singleton's setter is invisible to the render.** React's server renderer resolves
  `useSyncExternalStore` through `getServerSnapshot()` and never subscribes, and Zustand v5 wires that
  argument to `api.getInitialState()` — the snapshot captured at the store's **module-load** creation, which
  no setter ever moves. Calling `conversationActivityStore.getState().setTurnRunning(id, true)` before
  rendering therefore renders as if nothing were seeded; the naive "seed the singleton, then
  `renderToStaticMarkup`" fixture shape (the one the architecture spec itself proposed) passes green while
  asserting nothing. The fix is a `vi.mock` per test file that redirects only the three `useXStore` **React
  bindings** onto a fresh per-file `createXStore()` instance, keeping `...importActual` for everything else
  — the selectors, the predicate, the resolver — so the real logic under test stays real and only the
  binding that `renderToStaticMarkup` can't see gets swapped.
- **An `indexOf`-based ordering assertion passes vacuously when the needle is absent**, since `-1` compares
  less than every real index. "The dot leads the row" cases must pin presence (`indexOf !== -1`) before
  they pin ordering, or a row that draws no dot at all reads as a passing test.

No new e2e spec: all four ACs are statically assertable in the unit tier with seeded stores (a per-row
chunk sliced out of the markup by title, mirroring the file's existing `ROW_MARKER`/`ROW_OPEN_MARKER`
slicing idiom), and the live path that feeds the activity store for a non-open conversation is #748's
shipped coverage, not this ticket's. The `prefers-reduced-motion` clone of
`e2e/composer-status-reduced-motion.spec.ts` that `channels.css:862` hands forward stays explicitly out of
scope — a per-component e2e spec is a separate concern, filed only if wanted.

### CSS (`channels.css`)

Token-only: every color/type/spacing value is a `var(--…)` token; opacity is the de-emphasis device
(the #218 precedent), never a color literal. Added a new `--text-title-medium-*` quad to
`theme/tokens.css` (16px/24px/0.15px/500, the exact M3 values from Figma node 15-8) for the row title —
the M3 scale had no `title-medium` slot before this.

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
  re-key](paired-shell.md#the-conversation-switch-remount-bug-and-the-panekey-fix) so
  `ConversationScreen` remounts instead of carrying the old conversation's screen-local state over.
- **Archived rows are filtered out.** `renderBody` partitions via `partitionActive`, which drops
  `is_archived` rows before the promotion split — archived conversations render only in the
  [Archive screen](archive-screen.md), never here. Fixed by [#469](../codebase/469.md); before that fix,
  every row the store held rendered here regardless of `is_archived` (a latent #366 regression, "Gap B"
  in [#440](../codebase/440.md)/[#452](../codebase/452.md)). The empty-state guard
  (`channels.length === 0 && discussions.length === 0`) is evaluated on the *active* partition, so a
  store holding only archived rows shows "No conversations yet" rather than a blank body.
- **Relative times don't tick.** `now` is captured once per render at the container — a live-updating
  interval is a deferred enhancement.
- **Deferred visual elements** (documented as intentionally absent, not missing): the top app bar
  (logo/"Pyrycode" title), monogram avatars, and the "See all discussions (N)" collapse. (The
  new-discussion FAB, once deferred here, shipped in [#242](../codebase/242.md) — see [its feature
  doc](new-discussion-fab.md); the settings gear, also once deferred here as "inside a future top app
  bar," instead shipped in [#333](../codebase/333.md) as its own pinned button, since ChannelList still
  has no top app bar.) A screenshot of this screen will not match the full Figma frame 15-8 for this
  reason — fidelity is scoped to the two-section list body only.
- **Section headers are sibling `<header>` elements, not `<h2>`** — flagged in code review as a
  non-blocking future a11y improvement (real headings would give screen readers navigable landmarks).
- **The host row's label is still a placeholder.** Deliberately deferred, not a gap: #688 replaces
  `HOST_ROW_LABEL` with the operator-typed machine name, and will need the label's own
  ellipsis/overflow treatment, skipped here since a six-character constant cannot overflow the
  400px sidebar. (The row's glyph carries no status either, but that gap closed with [#718](../codebase/718.md)'s
  connection dots — see § above.)
- **The relay leg's not-yet-known state.** Closed by [#719](../codebase/719.md), split from the
  same #672 as #718: `relayLeg(null)` now returns a fourth category, `unknown`/`Relay Unknown`,
  instead of being collapsed into `down`/`Relay Offline`. Both #330's status row and this screen's
  sidebar dots picked it up with no code change here, since both render `relayLeg`'s output
  unchanged — only the shared mapping and its CSS colour binding
  (`conversation-shell.md`) changed.
- **Two workspaces whose last path segment matches render two identically-labelled groups.**
  Deliberately deferred to #716 — a display question, not a trust one, since the groups keep
  distinct `cwd` keys and are never merged.
- **Workspace groups are collapsible per tree, per group, and unpersisted.** [#704](../codebase/704.md)
  turned each `WorkspaceRow` into a real `<button>` disclosure control (`aria-expanded`, click
  withdraws that group's rows and nothing else); the fold survives opening a conversation and
  coming back (component-local state under the sidebar's stable mount position, ADR 0006) but is
  gone on every fresh app start — every group renders expanded by default, and there is no store,
  disk, or wire involvement.
- **Every idle row's status dot is still announced.** Since [#801](https://github.com/pyrycode/pyrycode-desktop/issues/801)
  wired the [status dot](conversation-status-dot.md) into every row, a long sidebar of mostly-idle
  conversations announces "Idle" once per row (`role="img" aria-label="Idle"` ships on all three
  statuses). Built exactly as #799/#800/#801's specs intend and confirmed in #801's code review;
  the cheap fix, if wanted, is `aria-hidden` on the dot's idle branch — a change to
  `ConversationStatusDot` alone, not a conditional wrapper here. Not filed as a follow-up ticket yet.

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
- [#710 codebase notes](../codebase/710.md) — added the host row heading each tree (Figma
  `106:3094`), a client-owned `'Server'` placeholder label ahead of #688's operator-typed one.
- [#703 codebase notes](../codebase/703.md) — added the workspace grouping level between each
  host row and its conversation rows (Figma `106:3098`), grouping on the daemon's `cwd`.
- [#704 codebase notes](../codebase/704.md) — turned each workspace row into a per-group, per-tree
  disclosure control; renderer-only and unpersisted.
- [#718 codebase notes](../codebase/718.md) — added the host row's two trailing connection dots
  (Figma `110:3499`/`106:3114`), reusing [#330's two-leg mapping](conversation-shell.md#two-dot-relaypyrycode-connection-status-indicator-330)
  across screens rather than a second copy of it.
- [#719 codebase notes](../codebase/719.md) — gave the relay leg's `null` sentinel its own
  `unknown`/`Relay Unknown` category instead of collapsing it into `down`/`Relay Offline`; reaches
  this screen's dots via the shared mapping with no edit here.
- [Conversation status dot](conversation-status-dot.md) / [#800](https://github.com/pyrycode/pyrycode-desktop/issues/800)
  — the presentational leaf every row now leads with; see § The row's status dot above for the
  #801 call site.
- [Conversation status resolver](conversation-status.md) / [#799](https://github.com/pyrycode/pyrycode-desktop/issues/799)
  — the pure join `ConversationStatusDotControl` calls to reduce a row's activity and unread facts
  to one status.
- [Conversation unread predicate](conversation-unread.md) / [#778](https://github.com/pyrycode/pyrycode-desktop/pull/795)
  — composed at the row alongside the resolver above; #801 is the ticket that finally answers where
  this composition lives.
- [Conversation activity store](conversation-activity-store.md) / [#747](../codebase/747.md) and
  [conversation timeline holder](conversation-timeline-holder.md) / [conversation last-read
  store](conversation-last-read-store.md) — the three per-id stores `ConversationStatusDotControl`
  subscribes to through their shipped selector factories.
- [#801 spec](../../specs/architecture/801-sidebar-row-status-dot.md) — the row's status dot.
- Deferred: a future daemon+wire ticket (message-body preview text), a future select-and-load ticket
  (per-row open), #688 (operator-typed host label), #716 (same-last-segment workspace label
  ambiguity), a possible follow-up to suppress the idle dot's announced label (see § Edge cases).
