# Archive screen

The paired region's fifth view — `archive`, a sibling of [`list`](channel-list.md),
[`thread`](conversation-shell.md), [`settings`](settings-screen.md), and
[`pairServer`](pairing-input-screen.md) — reachable from a new entry button on the Channel List home.
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

- A new icon-only **Archive** entry button (Material `archive`-box glyph, `aria-label="Archive"`)
  renders alongside the existing [Settings entry](settings-screen.md) inside a shared top-right
  `.channel-list__actions` cluster on the [Channel List](channel-list.md)'s root `<section>` — present
  in all three list states (not-yet-loaded / loaded-zero / non-empty). Archive leads, Settings trails
  (conventional gear-rightmost).
- Clicking it navigates the [paired shell](paired-shell.md) to a new `archive` route.
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
    ├── channels/ChannelList.tsx          # + ArchiveButton entry (in-file, unexported) + .channel-list__actions cluster
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

`SettingsButton` used to be the list's lone top-right sticky child. A second independent sticky child
would have stacked awkwardly, so both buttons now share one cluster:

```tsx
<div className="channel-list__actions">
  <ArchiveButton onClick={onOpenArchive} />
  <SettingsButton onClick={onOpenSettings} />
</div>
```

`.channel-list__actions` carries the `position: sticky; top; align-self: flex-end; z-index; margin`
rules that `.channel-list__settings` used to carry alone; both button rules now keep only their 48px
box + hover/focus/color presentation. `ArchiveButton` clones `SettingsButton`'s shape exactly — an
icon-only native `<button aria-label="Archive">` wrapping an `aria-hidden` 24px SVG (the Material
`archive`-box glyph) — with a **distinct** `aria-label` disambiguating it from the gear's "Settings"
(the ticket's accessibility requirement).

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
"Archived …" subtitle (`archivedSubtitle`), with a sibling icon-only `RestoreControl`
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
  `partitionByPromotion` on that subset (channels = promoted, discussions = not). Order-preserving, no
  sort — the daemon's array order is authoritative. Returns `{ channels, discussions }`, whose keys are
  exactly the `ArchiveTab` union members.
- `archivedSubtitle(iso, now)` — composes `"Archived " + formatLastActivity(iso, now)` (→ "Archived 2
  days ago", "Archived Jul 4"). `formatLastActivity` already embeds "ago" and falls back to a short
  date past a week, so this never doubles it; a non-parseable `iso` makes `formatLastActivity` return
  `''`, collapsing the subtitle to the bare `"Archived"`. Does **not** extend `formatLastActivity` with
  Figma's coarser "weeks/months ago" buckets — that function is shared with the Channel List, so this
  composition keeps the change additive to the archive screen only. Honest-signal seam:
  `ConversationSummary` carries no true `archived_at` time, only `last_message_ts` — the same last-
  activity posture `channelListViewModel.ts` documents for its own row subtitle.
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
ChannelList (ArchiveButton onClick)
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

## Edge cases and limitations

- **No true "archived at" time.** `ConversationSummary` carries no `archived_at` field, only
  `last_message_ts` — the subtitle's "Archived …" time is measured from that last-activity signal, not
  a true archive timestamp, and Figma's coarser "weeks/months ago" buckets are deferred pending a
  daemon field. Same honest-signal posture the Channel List documents for its own row subtitle.
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
- **Entry glyph is a developer choice.** No Figma node pins the desktop-invented `ArchiveButton`; any
  recognizable archive glyph was acceptable (mirrors `SettingsButton`'s own precedent). Likewise the
  restore glyph (a Material `replay` circular arrow) is a reasonable stand-in for Figma's undo/restore
  icon — not load-bearing, since the accessible name comes from `aria-label`, not the glyph.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the router this screen's `archive`
  route slots into, now `list ⇄ thread ⇄ settings ⇄ pairServer ⇄ archive`.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the entry button
  inside the shared `.channel-list__actions` cluster, and the `titleFor`/`partitionByPromotion`/
  `formatLastActivity` reuse source in `channelListViewModel.ts`.
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
