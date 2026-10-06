# Archive screen

The paired region's fifth view — `archive`, a sibling of [`list`](channel-list.md),
[`thread`](conversation-shell.md), [`settings`](settings-screen.md), and
[`pairServer`](pairing-input-screen.md) — reachable through Sidebar menu → Archive in the
always-mounted [Channel List](channel-list.md) toolbar.
A back header titled "Archived" above a two-tab segmented header (Channels / Discussions), each label
carrying its live archived count (e.g. "Channels (3)"), and a per-tab list of restore rows. Mirrors
mobile's Archive design (Figma node 18-2).

Introduced in [#347](../codebase/347.md) as a chrome-only scaffold (route + entry + empty tab-panel
shell), then completed in [#348](../codebase/348.md) with live per-tab counts and restore rows — the
scaffold and content children of the #153 split (the third child, [#346](../codebase/346.md), the
outbound `unarchiveConversation` transport, shipped dormant ahead of both and is now #348's first
caller). #347 mirrored, almost beat-for-beat, how the [Settings scaffold](settings-screen.md) shipped
(#333: route + entry + empty section shell before its content row, #334). Renderer-only — no new
store, no new transport, `window.pyry` dereferenced only inside the restore click handler — so not
security-sensitive.

## What it does

- **Archive** is the second `menuitem` in the left **Sidebar menu** ellipsis popup, after
  [Settings](settings-screen.md). The trigger remains in loading, empty and populated sidebar
  states; **Pair new host** stays at the right with its hover/focus name pill. The standalone
  Archive icon has been removed.
- Selecting Archive closes the menu and invokes the existing `onOpenArchive` callback once,
  navigating the [paired shell](paired-shell.md) to `archive`.
- The Archive screen shows a back header: a back affordance (`aria-label="Back"`, the same 48px
  `arrow_back` glyph as `SettingsScreen`'s `BackControl`, cloned verbatim) beside an `<h1>` reading
  "Archived".
- Below the header, a two-tab segmented header (`role="tablist"`) — **Channels** then **Discussions**
  (Figma order) — with exactly one tab `aria-selected="true"` at a time and a 2px `--color-primary`
  underline under the active tab, driven entirely by the `aria-selected` attribute (no separate
  modifier class or indicator node). Each label carries its own live archived count in parentheses
  (e.g. "Channels (3)", "Discussions (0)"); before the conversation list has loaded, a label renders
  bare with no parenthesised count ([#348](../codebase/348.md)).
- Selecting a tab switches which tab body's `aria-labelledby` the panel exposes. The panel renders a
  restore row per archived conversation of that kind (title over an "Archived &lt;relative time&gt;"
  subtitle, with a trailing icon-only restore control), or a per-tab empty-state line ("No archived
  channels" / "No archived discussions") when that kind has zero archived rows.
- Each tab sorts across all hosts by the most recent archive instant first. Legacy or invalid
  archive stamps fall back to `last_used_at`; the subtitle uses that same selected instant.
- Activating a row's restore control dispatches the `unarchiveConversation` command
  ([#346](../codebase/346.md)) for that row's id, fire-and-forget; the row leaves the tab and both tab
  counts recompute automatically once the daemon confirms (see Data flow) — no local mutation, no
  optimistic removal.
- Back returns to the channel-home `list` view via the paired router's existing `back` transition — no
  new nav event, no stack-aware back (the same #333-established posture).

## How it works

Additive throughout — no existing route, nav arm, or view is rewritten:

```
src/renderer/src/
├── pairedRoute.ts                        # + 'archive' route, + 'openArchive' nav arm
├── PairedShell.tsx                       # + case 'archive', + onOpenArchive threading
└── screens/
    ├── channels/ChannelList.tsx          # Sidebar menu Archive item → onOpenArchive
    └── archive/
        ├── ArchiveScreen.tsx             # ArchiveScreen (container) + ArchiveScreenView (pure) + ArchiveRow/RestoreControl/BackControl (in-file)
        ├── ArchiveScreen.test.tsx
        ├── archiveViewModel.ts           # partitionArchived / archivedSubtitle / tabCountLabel — framework-free (#348)
        ├── archiveViewModel.test.ts
        └── archive.css                   # token-only, topbar/back/title cloned from settings.css + tab/row/restore/empty styles
```

### The route + nav arm (`pairedRoute.ts`)

```ts
export type PairedRoute = 'list' | 'thread' | 'settings' | 'pairServer' | 'archive'
export type PairedNav =
  | { type: 'open' }
  | { type: 'openSettings' }
  | { type: 'openArchive' }
  | { type: 'back' }
  | { type: 'openPairServer' }
  | { type: 'pairServerCancelled' }
  | { type: 'pairServerPaired' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':                return 'thread'
    case 'openSettings':        return 'settings'
    case 'openArchive':         return 'archive'
    case 'back':                 return 'list'
    case 'openPairServer':      return 'pairServer'
    case 'pairServerCancelled': return 'settings'
    case 'pairServerPaired':    return 'list'
    default:                     return assertNever(nav)
  }
}
```

`openArchive` is absolute like `open`/`openSettings`/`back` — no `current` inspection. Archive → home
back reuses the **existing** `back` arm unchanged: `nextPairedRoute('archive', { type: 'back' })`
already resolved to `'list'` before this ticket, since `back`'s arm never inspected `current` — the
same economy #333 first proved for `settings`, cashed a second time here.

### The pure view + container (`PairedShell.tsx`)

`PairedShellView` gains one case:

```ts
case 'archive':
  return <ArchiveScreen onBack={props.onBack} />
```

reusing the shared `onBack` unchanged, same as `settings`. The container adds
`onOpenArchive={() => dispatch({ type: 'openArchive' })}` alongside the existing dispatchers.

### The entry button (`ChannelList.tsx`)

The entry is now a menu item in `ComposerOptionsMenu`, mounted beside `PairNewHostButton`
in `.channel-list__actions`. It passes `currentId={null}`, `placement="bottom-start"` and
`consumeOutsideClick`; selecting id `archive` calls `onOpenArchive` after closing the menu.
The menu has no selected row. Keyboard opening focuses Settings, ArrowDown reaches Archive,
Enter/Space select, and Escape closes and restores trigger focus. The first outside tree click
dismisses without opening or folding the underlying item; a second click operates normally.
See the [toolbar](channel-list-section-header-pair-control.md) for popup geometry and stacking.

### The screen (`ArchiveScreen.tsx`)

Container/pure-view split, the #203/#218 idiom:

```ts
export type ArchiveTab = 'channels' | 'discussions'

export function ArchiveScreen({ onBack }: { onBack: () => void }): JSX.Element {
  const [selectedTab, setSelectedTab] = useState<ArchiveTab>('channels')
  const conversations = useConversationListStore(selectConversations)
  const now = Date.now()
  return (
    <ArchiveScreenView
      selectedTab={selectedTab}
      onSelectTab={setSelectedTab}
      onBack={onBack}
      conversations={conversations}
      now={now}
      onRestore={(id) => requestUnarchiveConversation(window.pyry.sendCommand, id)}
    />
  )
}
```

`selectedTab` is the screen's only state — ephemeral, screen-local UI selection per
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), never the session store;
it resets to `'channels'` on remount (re-opening Archive always starts on Channels). The container's
only other impurities are the [conversation list store](conversation-list-store.md) read
(`useConversationListStore(selectConversations)`) and `Date.now()` — both safe under
`renderToStaticMarkup` in Node (the store yields its initial `null`, the ChannelList container
posture). `window.pyry` is dereferenced only inside the `onRestore` click arrow, never during render,
so `ArchiveScreen` stays server-renderable.

`ArchiveScreenView` is a pure function of `{ selectedTab, onSelectTab, onBack, conversations, now,
onRestore }`. It computes `partitionArchived(conversations)` once (or `null` if `conversations` is
`null`) and indexes the result by `tab.key` for both the tab-label count and the panel body — so a
tab's live count and its rendered rows cannot drift apart. The tablist derives each tab's label
(`tabCountLabel`), `aria-selected`, and click payload from one `ARCHIVE_TABS` map keyed on `tab.key`.
The tab panel (`role="tabpanel"`, `aria-labelledby` switching with `selectedTab`) renders
`renderArchivePanel`'s three-state body — `null` (not-yet-loaded) → nothing; `[]` (loaded, zero of
this kind) → the per-tab empty-state copy; non-empty → one `ArchiveRow` per archived conversation.

`ArchiveRow` (Figma 18-19) is a title (`titleFor`, the Channel List's untitled fallback) over an
"Archived …" subtitle (`archivedSubtitle(conversation, now)`, using the same selected instant as
the row's ordering), with a sibling icon-only `RestoreControl`
(`aria-label="Restore"`, `aria-hidden` SVG, a Material `replay` glyph standing in for Figma's
counter-clockwise restore arrow — not load-bearing, since the accessible name comes from the
`aria-label`). `requestUnarchiveConversation(sendCommand, conversationId)` dispatches the inline
`{ type: 'unarchiveConversation', payload: { conversation_id } }` `RendererCommand`, fire-and-forget —
mirroring `requestPromoteConversation`'s shape.

`BackControl` is cloned verbatim from `SettingsScreen`'s (same `arrow_back` glyph, same
`aria-label="Back"`); unconditional — the screen always renders it, so `onBack` is a required prop, not
optional-gated, the same posture `SettingsScreen`'s back affordance uses.

### The view-model (`archiveViewModel.ts`)

Framework-free `.ts`, mirroring `channelListViewModel.ts` — unit-tested without React or the store:

- `partitionArchived(rows)` — filters to `is_archived === true`, then delegates to the existing
  `partitionByPromotion` on that subset (channels = promoted, discussions = not), then sorts fresh
  arrays for each tab across all hosts. Returns `{ channels, discussions }`, whose keys are exactly
  the `ArchiveTab` union members. Neither the input array nor its rows mutate; the shared partition
  function and the store retain their own ordering.
- The archive-local `archiveInstant(row)` selector chooses `archived_at` only when it has RFC3339
  date/time/zone syntax, a valid calendar day and a parseable instant. Absent, `null`, invalid or
  non-RFC3339 stamps fall back to a parseable `last_used_at`. Legacy rows participate among stamped
  rows using that fallback time. A bare date, a timestamp without a zone or an impossible calendar
  date cannot displace last use, even when JavaScript's permissive `Date.parse` accepts it.
- Selected instants sort descending. UTC offsets are compared as instants, and fractional seconds
  beyond milliseconds are retained so `Date.parse` truncation cannot create false ties. Equal
  instants tie by conversation id ascending in UTF-16 code-unit order, without locale comparison.
  Rows with an unparseable fallback follow every parsable row and use the same id rule. Fully equal
  selected keys and ids retain input order through stable sorting.
- `archivedSubtitle(row, now)` uses the same selector and composes
  `"Archived " + formatLastActivity(instant.iso, now)` (→ "Archived 2 days ago", "Archived Jul 4").
  Neither timestamp parseable means bare `"Archived"`, with no trailing space. The source is never
  `last_message_ts`. `formatLastActivity` keeps its existing relative-time buckets and short date
  past a week; it already embeds "ago", so the subtitle never doubles it. The shared formatter's
  other callers are unchanged; Figma's coarser "weeks/months ago" buckets remain unimplemented.
- `tabCountLabel(base, count)` — `count === null` → the bare `base`; otherwise `` `${base} (${count})` ``,
  including `count === 0` → "Channels (0)".

### CSS (`archive.css`)

Token-only, no new token added — every color in the Figma design (`--color-surface`,
`--color-on-surface`, `--color-on-surface-variant`, `--color-primary`, `--color-outline-variant`)
already existed in `theme/tokens.css`. The topbar/back/title rules are renamed clones of
`settings.css`'s (`settings__` → `archive__`). The segmented-header rules: `.archive__tabs` (flex
row, `border-bottom: 1px solid var(--color-outline-variant)`), `.archive__tab` (flex `1 1 0`,
centered, label-large text in `--color-on-surface-variant`, transparent 2px `border-bottom`, button
reset), and `.archive__tab[aria-selected="true"]` (text flips to `--color-on-surface`,
`border-bottom-color: var(--color-primary)` — the 2px selected-tab indicator). Driving the underline
off the ARIA attribute means the ARIA state **is** the single source of active-ness. The row/restore/
empty rules (`.archive__row`, `.archive__row-text`, `.archive__row-title`, `.archive__subtitle`,
`.archive__restore`, `.archive__empty`) are token-for-token clones of the Channel List's equivalent
classes (title-medium/on-surface, body-small/on-surface-variant at 0.75 opacity, icon-button
radius-full) — under a distinct `.archive__row-title` name, not `.archive__title`, since that name was
already taken by the topbar `<h1>` (title-large).

### Data flow

```
ChannelList Sidebar menu → Archive menuitem → ComposerOptionsMenu.onSelect('archive')
  → onOpenArchive prop
    → PairedShell dispatch({ type: 'openArchive' })
      → nextPairedRoute('list', openArchive) = 'archive'
        → PairedShellView case 'archive' → <ArchiveScreen onBack={dispatch back} />

ArchiveScreen: useState<ArchiveTab> ──selectedTab──▶ ArchiveScreenView (tablist + tabpanel)
               ▲                                     │
               └──────── onSelectTab(tab.key) ◀──────┘ (tab onClick)

conversationListStore (selectConversations) ──▶ partitionArchived ──▶ partition[tab.key]
                                                                        ├─▶ tab label count
                                                                        └─▶ ArchiveRow[] body

restore row click
  → onRestore(row.id) → requestUnarchiveConversation(sendCommand, row.id)   (fire-and-forget)
    → unarchiveConversation IPC → daemon clears is_archived, persists, replies conversation_updated
      → conversationListBridge refreshOnChange re-requests the list        (no wiring added here)
        → setConversations → row's is_archived flips false → falls out of partitionArchived
          → both tab counts + the panel body recompute on the next render

BackControl onClick → onBack → PairedShell dispatch({ type: 'back' }) → nextPairedRoute → 'list'
```

## Testing

`archiveViewModel.test.ts` covers both tabs across hosts, frozen inputs, missing/null/invalid
stamps, invalid fallback times, equivalent UTC offsets, sub-millisecond ordering, UTF-16 id ties
and stable equal rows. `ArchiveScreen.test.tsx` renders timestamps separated by weeks to prove
the subtitle source, last-use fallback and bare "Archived". Cross-view assertions also live in
`channelListViewModel.test.ts`: Archive sorts while the shared `partitionByPromotion` preserves
input order, so changing only the archive suite would miss that regression.

Fake-transport navigation specs open Sidebar menu before selecting the Archive `menuitem` and
retain their destination/lifecycle assertions. `sidebar-header-menu.spec.ts` proves pointer and
keyboard navigation at 1280×800 and 800×600; assert `aria-label="Archive screen"` for arrival,
since Archive text also exists inside the open menu. The shared pairing-arrival helper uses the
sibling Settings item for Pair another server. See [recorded evidence](development-verification.md#layout-and-input).

[`e2e/real-daemon-archive-order.spec.ts`](../../../e2e/real-daemon-archive-order.spec.ts) uses the
Claude-less daemon fixture. It observes the first archive completing before issuing the second,
then expects second-archived-first against opposing last-used order. It also checks both daemon
archive stamps, preventing a missing prerequisite from passing on coincidental fallback order.
The tested daemon must contain [daemon PR #2700](https://github.com/pyrycode/pyrycode/pull/2700);
the spec records its revision. See the [live test runbook](live-e2e-runbook.md) for execution.

## Edge cases and limitations

- **Legacy archive time is approximate.** The daemon reports nullable `archived_at`; active and
  legacy archived rows can have `null`, and older saved rows can omit it. An invalid stamp also
  falls back to `last_used_at` for both sorting and text. This fallback does not reconstruct the
  original archive action. When it cannot parse either, the row sorts after timed rows and reads
  bare "Archived".
- **No stack-aware back**, same as `settings`/`thread`: `archive → back` always lands on `list`
  regardless of which route dispatched it.
- **Restore is fire-and-forget with no optimistic UI.** A row stays visible until the daemon's
  `conversation_updated` broadcast round-trips and the list bridge re-lists — there is no local removal
  on click and no loading/pending state on the row.
- **Tab-switch and restore-click interaction glue is not DOM-tested**, the same gap `paired-shell.md`
  documents for its own click-driven transitions: the codebase has no DOM harness, so click wiring is
  proven by composition (the pure view server-rendered with injected props/callbacks) rather than a
  fired click event. The tab-switch risk is smaller than usual — the click payload and the
  active-marker render both derive from the same `tab.key`, so a mismatch is structurally impossible.
  The restore-dispatch contract itself is pinned directly: `requestUnarchiveConversation` is tested by
  calling it with a fake `sendCommand` and asserting the exact command shape.
- **Restore glyph is a developer choice.** The restore glyph (a
  Material `replay` circular arrow) is a reasonable stand-in for Figma's undo/restore icon — not
  load-bearing, since the accessible name comes from `aria-label`, not the glyph. The sidebar
  Archive entry is now text inside Sidebar menu, with no separate archive glyph.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the router this screen's `archive`
  route slots into, now `list ⇄ thread ⇄ settings ⇄ pairServer ⇄ archive`.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the menu entry in
  its own Top bar, and the `titleFor`/`partitionByPromotion`/`formatLastActivity` reuse source in
  `channelListViewModel.ts`.
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the direct structural precedent
  the #347 scaffold mirrored beat-for-beat (route + entry + empty shell as one unit).
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the
  `selectConversations` read surface and the free re-list-on-`conversation_updated` mechanism the
  restore round-trip relies on.
- [Conversation unarchive (transport)](conversation-unarchive.md) / [#346](../codebase/346.md) — the
  `unarchiveConversation` command this screen's restore rows call; #348 is its first caller.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state
  rule `ArchiveScreen`'s `useState` follows.
- [#347 codebase notes](../codebase/347.md) · Spec: `docs/specs/architecture/347-archive-screen-scaffold.md`
- [#348 codebase notes](../codebase/348.md) · Spec: `docs/specs/architecture/348-archive-counts-restore-rows.md`
- Parent: #153, split into #346 (transport, DONE) + #347 (scaffold, DONE) + #348 (counts + restore,
  DONE) — the full split now shipped.
