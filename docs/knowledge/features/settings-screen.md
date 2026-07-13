# Settings screen (scaffold + Connection section)

The paired region's third view — `settings`, a sibling of [`list`](channel-list.md) and
[`thread`](conversation-shell.md) — reachable from a new entry button on the Channel List home. Ships
as a chrome-only scaffold: a top-bar (back + "Settings" title) and an empty "Connection" section
container, with no data of its own. Mirrors mobile #390/#398.

Introduced in [#333](../codebase/333.md), the scaffold child of the #150 split (the other child, #332,
shipped the data path: [#339](../codebase/339.md)'s IPC surface + [#340](../codebase/340.md)'s renderer
store). Renderer-only, pure nav/view — no keys,
sockets, tokens, store, or IPC touched, so not security-sensitive.

## What it does

- A new icon-only **Settings** entry button (gear glyph, `aria-label="Settings"`) renders as the first
  child of the [Channel List](channel-list.md)'s root `<section>`, pinned top-right via CSS, present in
  all three list states (not-yet-loaded / loaded-zero / non-empty).
- Clicking it navigates the [paired shell](paired-shell.md) to a new `settings` route.
- The Settings screen shows a top-bar: a back affordance (`aria-label="Back"`, the same 48px
  `arrow_back` glyph as `ConversationScreen`'s `BackControl`) and a "Settings" title.
- Below the top-bar, one section: a "Connection" heading (`--color-primary`, **not** the muted
  `channel-list__section-header` tone) plus an **empty** content container
  (`.settings__section-body`) — the ticket ships the section, not its content.
- Back returns to the channel-home `list` view via the paired router's existing `back` transition — no
  new nav event, no stack-aware back.

## How it works

Four production files, additive throughout — no existing route, nav arm, or view is rewritten:

```
src/renderer/src/
├── pairedRoute.ts                        # + 'settings' route, + 'openSettings' nav arm
├── PairedShell.tsx                       # + case 'settings', + onOpenSettings threading
└── screens/
    ├── channels/ChannelList.tsx          # + SettingsButton entry (in-file, unexported)
    └── settings/
        ├── SettingsScreen.tsx            # the scaffold view (new)
        └── settings.css                  # token-only (new)
```

### The route + nav arm (`pairedRoute.ts`)

```ts
export type PairedRoute = 'list' | 'thread' | 'settings'
export type PairedNav = { type: 'open' } | { type: 'openSettings' } | { type: 'back' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':         return 'thread'
    case 'openSettings': return 'settings'
    case 'back':          return 'list'
    default:              return assertNever(nav)
  }
}
```

`openSettings` is absolute like `open`/`back` — no `current` inspection. Settings → home back reuses
the **existing** `back` arm unchanged: `nextPairedRoute('settings', { type: 'back' })` already resolved
to `'list'` before this ticket, since `back`'s arm never inspected `current`. This is the ticket's
central economy — one new route, one new nav arm, zero new back-transition logic.

### The second guard (`PairedShell.tsx`)

`PairedShellView` gains a `case 'settings'`, reusing the shared `onBack`:

```ts
case 'settings':
  return <SettingsScreen onBack={props.onBack} />
```

`PairedShell` (the `useReducer` container) adds `onOpenSettings={() => dispatch({ type: 'openSettings' })}`
beside the existing `onOpen`/`onBack` — no new state, still the one `useReducer(nextPairedRoute, 'list')`
from [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md).

### The entry affordance (`ChannelList.tsx`)

`ChannelList`/`ChannelListView` both gain a required `onOpenSettings: () => void` prop, threaded
straight through (the `onOpen` precedent). `SettingsButton` is an in-file, unexported sibling of
`NewConversationFab`, cloning its shape exactly: a native `<button type="button" aria-label="Settings">`
holding an `aria-hidden` inline 24px Material `settings` (gear) glyph SVG. No `window.pyry`, no store —
`onOpenSettings` is a pure injected nav effect. Placement is a **desktop-invented** affordance (like the
FAB before it): ChannelList has no top app bar yet, and no Figma node on the list scope (15-8) pins a
settings entry, so it's rendered as the section's first child and pinned top-right via CSS
(`position: sticky; top; align-self: flex-end`) so it stays reachable while a long list scrolls under
it.

### The scaffold view (`SettingsScreen.tsx`)

A single pure, exported, server-renderable view — no store read, no effects, no `window.pyry`:

```ts
export function SettingsScreen({ onBack }: { onBack: () => void }): JSX.Element
```

`onBack` is **required** (unlike `ConversationScreen`'s optional-gated `BackControl` — a Settings
screen always has a back affordance). Structure: root `<section className="settings"
aria-label="Settings screen">` → top-bar (`BackControl` + `<h1>Settings</h1>`) → body → one
`<section className="settings__section">` with `<h2>Connection</h2>` and an empty
`<div className="settings__section-body" />`, the documented mount point for
[#334](../codebase/334.md)'s store-bound Server row. Copy strings live in a client-owned
`SETTINGS_COPY` module constant (the `EMPTY_THREAD_COPY` idiom) — never a daemon string, which is why
this scaffold carries no untrusted-text sink.

### CSS (`settings.css`)

Token-only, mirroring `channels.css`'s screen-root posture (`height: 100%; overflow-y: auto`, the
direct-child-of-`#root` idiom). The one deliberate deviation from `channels.css`'s section-header
tone: `.settings__section-header` uses `--color-primary` (#9dcbfc), not the muted
`--color-on-surface-variant` `.channel-list__section-header` uses — the M3 settings-section-header
color per Figma. `.settings__back` duplicates `.conversation__back`'s ~15-line treatment verbatim
(48px square, `--radius-full`, transparent→`--color-surface-container-high` hover,
`--color-outline` focus-visible outline) rather than extracting a shared class — an explicit
out-of-scope call in the spec, not an oversight.

### Data flow

```
ChannelList SettingsButton.onClick
  → PairedShell onOpenSettings  = dispatch({ type: 'openSettings' })
  → nextPairedRoute('list', openSettings) = 'settings'
  → PairedShellView route='settings' → <SettingsScreen onBack={dispatch back} />

SettingsScreen BackControl.onClick
  → dispatch({ type: 'back' }) → nextPairedRoute('settings', back) = 'list' → ChannelList
```

No new store, no IPC, no wire, no daemon event — the entire slice is the existing screen-local
`useReducer` plus two new pure views.

## Edge cases and limitations

- **No data.** The Connection section's content area is intentionally empty; [#334](../codebase/334.md)
  mounts the store-bound Server row (host name, two-dot Relay+Server status) into
  `.settings__section-body`. The already-shipped [server-info store](server-info-store.md)
  (`<ServerInfoData />`, [#340](../codebase/340.md)) is not mounted anywhere yet — deferred to whichever
  of #334/#151/#152 first needs it live.
- **No stack-aware back.** `settings` → `back` always lands on `list`, even though the ticket's own
  comments (both here and in [#334](../codebase/334.md)/[#151](../codebase/151.md)) anticipate this
  changing if a future sub-navigation (e.g. a "pair another server" sub-screen, [#152](../codebase/152.md))
  needs a real stack. `current` stays in `nextPairedRoute`'s signature for exactly this reason — see
  [paired shell](paired-shell.md).
- **Marker collision, worth knowing before writing more `PairedShellView` tests.** The `thread` view
  already renders `aria-label="Connection status"` (the two-dot indicator, [#330](../codebase/330.md)),
  and `list` now renders a button with `aria-label="Settings"` — so neither `"Connection"` nor
  `"Settings"` alone discriminates the `settings` view in a `PairedShellView` render test. Use the root
  `aria-label="Settings screen"` (or `class="settings"`) instead — see
  [#333 codebase notes](../codebase/333.md#lessons-learned).
- **Settings entry corner is a free CSS swap.** Top-right sticky was the developer's call against the
  mobile home mock; no Figma node pins it, and the AC only required presence + an accessible name.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread ⇄ settings` router
  this screen fills the third arm of.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the new entry button;
  its "Deferred visual elements" note about a future settings gear is now partially resolved by this
  ticket (the entry exists; the top app bar it was originally imagined inside still doesn't).
- [Server-info store](server-info-store.md) / [#340](../codebase/340.md) — the not-yet-mounted store this
  screen's Connection section will eventually read, once #334 mounts it.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule
  `PairedShell`'s `useReducer` (and this ticket's added arm) follows.
- [#333 codebase notes](../codebase/333.md) · Spec: `docs/specs/architecture/333-settings-screen-scaffold.md`
- Follow-ups, all blocked-by this ticket: [#334](../codebase/334.md) (Server row), [#151](../codebase/151.md)
  (preference rows), [#152](../codebase/152.md) (pair another server).
