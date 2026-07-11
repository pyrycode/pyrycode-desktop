# Channel List home screen

The paired region's [`list` route](paired-shell.md) — a pure render slice over the already-shipped
[conversation list store](conversation-list-store.md), splitting the daemon's conversations into
**Channels** (saved, `is_promoted === true`) above **Recent discussions** (ad-hoc,
`is_promoted === false`), each row showing its title and a last-activity relative time. Mirrors the
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
- `partitionByPromotion(rows)` — two order-preserving `Array#filter`s on `is_promoted`. No sort.
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

### CSS (`channels.css`)

Token-only: every color/type/spacing value is a `var(--…)` token; opacity is the de-emphasis device
(the #218 precedent), never a color literal. Added a new `--text-title-medium-*` quad to
`theme/tokens.css` (16px/24px/0.15px/500, the exact M3 values from Figma node 15-8) for the row title —
the M3 scale had no `title-medium` slot before this.

`.channel-list` deviates from the architecture spec's `flex: 1 1 auto`: it uses `height: 100%;
box-sizing: border-box` instead, because `PairedShellView` mounts this `<section>` directly under the
block-level `#root` with no flex wrapper in between — `flex: 1 1 auto` would be inert there (no fill,
no internal scroll). Mirrors `.conversation`'s proven direct-child-of-`#root` pattern; documented in a
`channels.css` comment. Code-review-verified as a legitimate, well-reasoned spec deviation.

## Edge cases and limitations

- **Every row opens the single active conversation, not that row's conversation.** Per-row
  select-and-load needs a transport path that doesn't exist yet (a select-and-load ticket, not yet
  filed as of #141). The seam is already the row — a future ticket changes only what `onClick` passes.
- **`is_archived` is not filtered.** Every row the store holds renders, partitioned only by
  `is_promoted`. Correct if the daemon already excludes archived conversations from its `conversations`
  response; otherwise a scoped one-line filter is a future follow-up.
- **Relative times don't tick.** `now` is captured once per render at the container — a live-updating
  interval is a deferred enhancement.
- **Deferred visual elements** (documented as intentionally absent, not missing): the top app bar
  (logo/"Pyrycode" title/settings gear → a future Settings screen), monogram avatars, and the "See
  all discussions (N)" collapse. (The new-discussion FAB, once deferred here, shipped in
  [#242](../codebase/242.md) — see [its feature doc](new-discussion-fab.md).) A screenshot of this
  screen will not match the full Figma frame 15-8 for this reason — fidelity is scoped to the
  two-section list body only.
- **Section headers are sibling `<header>` elements, not `<h2>`** — flagged in code review as a
  non-blocking future a11y improvement (real headings would give screen readers navigable landmarks).

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread` router this screen
  fills the `list` arm of.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the store slice
  this screen reads verbatim (snake_case `ConversationSummary` rows, `null` vs `[]` contract).
- [Conversation list fetch](conversation-list-fetch.md) / [#139](../codebase/139.md) — the transport
  decode; documents the no-message-text wire gap this screen's row shape is scoped by.
- [Conversation shell](conversation-shell.md) — the thread view every row opens into via `onOpen`.
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the floating `+`
  affordance rendered as a sibling of this screen's rows.
- [#141 codebase notes](../codebase/141.md) · Spec: `docs/specs/architecture/141-channel-list-screen.md`
- Deferred: a future daemon+wire ticket (message-body preview text), a future select-and-load ticket
  (per-row open).
