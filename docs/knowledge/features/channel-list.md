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
- **The host row's label is a placeholder, its glyph carries no status, and nothing under it is
  indented yet** — all three deliberately deferred to sibling tickets, not gaps: #688 replaces
  `HOST_ROW_LABEL` with the operator-typed machine name (and will need the label's own
  ellipsis/overflow treatment, skipped here since a six-character constant cannot overflow the
  400px sidebar); #672 adds the two connection-status dots at the row's right edge, with no
  pre-rendered slot shipped for them; #703 adds the workspace grouping level between the host row
  and the conversation rows, which is what will indent the rows under it.

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
- Deferred: a future daemon+wire ticket (message-body preview text), a future select-and-load ticket
  (per-row open), #672 (host row connection dots), #688 (operator-typed host label), #703 (workspace
  grouping level under the host row).
