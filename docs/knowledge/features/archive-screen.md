# Archive screen (scaffold)

The paired region's fifth view — `archive`, a sibling of [`list`](channel-list.md),
[`thread`](conversation-shell.md), [`settings`](settings-screen.md), and
[`pairServer`](pairing-input-screen.md) — reachable from a new entry button on the Channel List home.
A back header titled "Archived" above a two-tab segmented header (Channels / Discussions) with a
selected-tab indicator; both tab bodies ship **empty** as [#348](../codebase/348.md)'s mount points.
Mirrors mobile's Archive design (Figma node 18-2).

Introduced in [#347](../codebase/347.md) as a chrome-only scaffold — the scaffold child of the #153
split (the other children: [#346](../codebase/346.md), the outbound `unarchiveConversation` transport,
shipped dormant ahead of this; [#348](../codebase/348.md), the live counts + restore rows, blocked on
both). Mirrors, almost beat-for-beat, how the [Settings scaffold](settings-screen.md) shipped
(#333: route + entry + empty section shell before its content row, #334). Renderer-only — no store
read, no transport, no `window.pyry` — so not security-sensitive.

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
  modifier class or indicator node). Tab labels are bare — no parenthesised counts yet; that's
  [#348](../codebase/348.md).
- Selecting a tab switches which (still-empty) tab body's `aria-labelledby` the panel exposes; the
  panel itself renders nothing until #348 mounts content into it.
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
        ├── ArchiveScreen.tsx             # ArchiveScreen (container) + ArchiveScreenView (pure) + BackControl (in-file)
        ├── ArchiveScreen.test.tsx
        └── archive.css                   # token-only, topbar/back/title cloned from settings.css + new tab styles
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
  return <ArchiveScreenView selectedTab={selectedTab} onSelectTab={setSelectedTab} onBack={onBack} />
}
```

`selectedTab` is the screen's only state — ephemeral, screen-local UI selection per
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md), never the session store;
it resets to `'channels'` on remount (re-opening Archive always starts on Channels). No effect, no
`window.pyry` deref anywhere in the container or the view, so `ArchiveScreen` is server-renderable —
`PairedShellView`'s `'archive'` case renders cleanly with no live connection.

`ArchiveScreenView` is a pure function of `{ selectedTab, onSelectTab, onBack }`. The tablist derives
each tab's label, `aria-selected`, and click payload from one `ARCHIVE_TABS` map keyed on `tab.key` —
so the active marker and the click target are structurally welded, not hand-wired to match. The tab
panel (`role="tabpanel"`, `aria-labelledby` switching with `selectedTab`) is deliberately empty; #348
fills it with a pure function of `selectedTab` (the channels-partition vs. discussions-partition
restore rows, mirroring [Channel List](channel-list.md)'s `partitionByPromotion` shape but on
`is_archived` instead).

`BackControl` is cloned verbatim from `SettingsScreen`'s (same `arrow_back` glyph, same
`aria-label="Back"`); unconditional — the screen always renders it, so `onBack` is a required prop, not
optional-gated, the same posture `SettingsScreen`'s back affordance uses.

### CSS (`archive.css`)

Token-only, no new token added — every color in the Figma design (`--color-surface`,
`--color-on-surface`, `--color-on-surface-variant`, `--color-primary`, `--color-outline-variant`)
already existed in `theme/tokens.css`. The topbar/back/title rules are renamed clones of
`settings.css`'s (`settings__` → `archive__`). The new segmented-header rules: `.archive__tabs` (flex
row, `border-bottom: 1px solid var(--color-outline-variant)`), `.archive__tab` (flex `1 1 0`,
centered, label-large text in `--color-on-surface-variant`, transparent 2px `border-bottom`, button
reset), and `.archive__tab[aria-selected="true"]` (text flips to `--color-on-surface`,
`border-bottom-color: var(--color-primary)` — the 2px selected-tab indicator). Driving the underline
off the ARIA attribute means the ARIA state **is** the single source of active-ness.

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

BackControl onClick → onBack → PairedShell dispatch({ type: 'back' }) → nextPairedRoute → 'list'
```

## Edge cases and limitations

- **Both tab bodies are empty.** No store read, no counts, no restore rows — [#348](../codebase/348.md)
  mounts live content into `.archive__tab-panel` as a pure function of `selectedTab`.
- **No stack-aware back**, same as `settings`/`thread`: `archive → back` always lands on `list`
  regardless of which route dispatched it.
- **Tab-switch interaction glue is not DOM-tested**, the same gap `paired-shell.md` documents for its
  own click-driven transitions: the codebase has no DOM harness, so the click→`setSelectedTab` wiring is
  proven by composition (the pure view server-rendered at both `selectedTab` values) rather than a
  fired click event. The risk is smaller here than usual — the click payload and the active-marker
  render both derive from the same `tab.key`, so a mismatch between them is structurally impossible,
  not merely untested.
- **Entry glyph is a developer choice.** No Figma node pins the desktop-invented `ArchiveButton`; any
  recognizable archive glyph was acceptable (mirrors `SettingsButton`'s own precedent).

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the router this screen's `archive`
  route slots into, now `list ⇄ thread ⇄ settings ⇄ pairServer ⇄ archive`.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the new entry button
  inside the shared `.channel-list__actions` cluster.
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the direct structural precedent
  this scaffold mirrors beat-for-beat (route + entry + empty shell as one unit).
- [Conversation unarchive (transport)](conversation-unarchive.md) / [#346](../codebase/346.md) — the
  dormant `unarchiveConversation` command #348's restore rows in this screen's tab bodies will call.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state
  rule `ArchiveScreen`'s `useState` follows.
- [#347 codebase notes](../codebase/347.md) · Spec: `docs/specs/architecture/347-archive-screen-scaffold.md`
- Parent: #153, split into #346 (transport, DONE) + #347 (this scaffold) + #348 (counts + restore,
  blocked on both).
