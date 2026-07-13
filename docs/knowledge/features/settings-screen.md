# Settings screen (scaffold + Connection section)

The paired region's third view — `settings`, a sibling of [`list`](channel-list.md) and
[`thread`](conversation-shell.md) — reachable from a new entry button on the Channel List home. A
top-bar (back + "Settings" title) above one "Connection" section, whose body now renders the paired
server's identity: a Server row showing `serverId` + `relayUrl`, plus an empty host slot for the future
two-dot status indicator. Mirrors mobile #390/#398, with the relay URL as a documented desktop addition.

Introduced in [#333](../codebase/333.md) as a chrome-only scaffold (the scaffold child of the #150
split; the other child, #332, shipped the data path: [#339](../codebase/339.md)'s IPC surface +
[#340](../codebase/340.md)'s renderer store). [#334](../codebase/334.md) then filled the scaffold's empty
section-body with the store-bound Server row and mounted #340's previously-dormant loader. Renderer-only
throughout — no keys, sockets, or tokens touched directly (the row reads only the vetted, non-secret
`serverId`/`relayUrl` pair off #340's store) — not security-sensitive.

## What it does

- A new icon-only **Settings** entry button (gear glyph, `aria-label="Settings"`) renders as the first
  child of the [Channel List](channel-list.md)'s root `<section>`, pinned top-right via CSS, present in
  all three list states (not-yet-loaded / loaded-zero / non-empty).
- Clicking it navigates the [paired shell](paired-shell.md) to a new `settings` route.
- The Settings screen shows a top-bar: a back affordance (`aria-label="Back"`, the same 48px
  `arrow_back` glyph as `ConversationScreen`'s `BackControl`) and a "Settings" title.
- Below the top-bar, one section: a "Connection" heading (`--color-primary`, **not** the muted
  `channel-list__section-header` tone) plus a content container (`.settings__section-body`) that now
  hosts the Server row: a "Server" label, the paired `serverId` as the primary identity line, and the
  `relayUrl` as a secondary line beneath it — or, before the one-shot fetch resolves, a `Loading…`
  placeholder in place of both values. An empty host slot beneath the values is reserved for a future
  two-dot Relay/Pyrycode status indicator (#330's `ConnectionStatusIndicator`, not yet mounted here).
- Back returns to the channel-home `list` view via the paired router's existing `back` transition — no
  new nav event, no stack-aware back.

## How it works

Additive throughout — no existing route, nav arm, or view is rewritten:

```
src/renderer/src/
├── pairedRoute.ts                        # + 'settings' route, + 'openSettings' nav arm
├── PairedShell.tsx                       # + case 'settings', + onOpenSettings threading
└── screens/
    ├── channels/ChannelList.tsx          # + SettingsButton entry (in-file, unexported)
    └── settings/
        ├── SettingsScreen.tsx            # scaffold (#333) + mounts ServerInfoData/ServerRowControl (#334)
        ├── ServerRow.tsx                 # pure ServerRow view + store-bound ServerRowControl (#334, new)
        └── settings.css                 # token-only, scaffold + Server row styles (#333 + #334)
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
`<section className="settings__section">` with `<h2>Connection</h2>` and a
`<div className="settings__section-body">` that mounts `<ServerInfoData /><ServerRowControl />`
([#334](../codebase/334.md)). Copy strings live in a client-owned `SETTINGS_COPY` module constant (the
`EMPTY_THREAD_COPY` idiom) — never a daemon string. `SettingsScreen` itself stays a pure, store-free
composition point: it reads no store and fires no effect directly — the store read and the one-shot
fetch both live inside the two mounted children.

### The Server row (`ServerRow.tsx`, #334)

Follows the #330 `ConnectionStatusIndicator`/`Control` view/container split, as a dedicated module (its
own test seam) rather than in-file:

```ts
export function ServerRow({ serverInfo }: { serverInfo: ServerInfoValue | null }): JSX.Element
export function ServerRowControl(): JSX.Element   // useServerInfoStore(selectServerInfo) → <ServerRow>
```

`ServerRow` is the pure view: always renders the `Server` label; when `serverInfo` is present, renders
`serverId` (primary line) and `relayUrl` (secondary line) as auto-escaped React children; when `null`,
renders a single `Loading…` placeholder in its place (never a blank `<p>`). In both states it renders an
**empty** `.settings__server-status-slot` — a class-labelled mount point for #330's future two-dot
indicator, deliberately carrying no `aria-label="Connection status"` (that marker belongs to #330's
`thread`-view indicator; duplicating it here was flagged as a collision risk during #333). `ServerRowControl`
is the store-bound container: a narrow `useServerInfoStore(selectServerInfo)` read, no effects, no
`window.pyry` — the one-shot fetch that populates the store is owned entirely by `ServerInfoData`
(mounted alongside it, not inside it).

Mounting `<ServerInfoData />` inside `SettingsScreen`'s section-body is what makes the row work: #340
shipped that loader dormant (zero consumers), so before #334 the store sat at `null` forever. Because
`SettingsScreen` mounts only under the paired shell's `settings` route (post-pairing, [PairedShell](paired-shell.md)),
a fresh fetch fires every time Settings opens rather than once at app launch.

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
    → mounts <ServerInfoData />  → window.pyry.serverInfo() [once]
        → mapServerInfo → setServerInfo → serverInfoStore
    → mounts <ServerRowControl /> → useServerInfoStore(selectServerInfo) → <ServerRow serverInfo=… />

SettingsScreen BackControl.onClick
  → dispatch({ type: 'back' }) → nextPairedRoute('settings', back) = 'list' → ChannelList
```

The nav shell (`pairedRoute.ts`/`PairedShell.tsx`) added no store, IPC, wire, or daemon event — that
part is still exactly the screen-local `useReducer` from #333. #334 wires the pre-existing
[server-info store](server-info-store.md) into the tree; the store and its channel are entirely #339/#340's.

## Edge cases and limitations

- **Momentary loading window, not a persistent empty state.** Before the one-shot fetch resolves
  (`serverInfo === null`), the row shows a `Loading…` placeholder — never a blank or stale value. Because
  Settings mounts only post-pairing, this is a brief window that resolves within a tick, not a "not
  paired" state; the store can't currently distinguish "not yet loaded" from "fetch rejected/unavailable"
  (both are `null`) — see [server-info store](server-info-store.md#edge-cases-and-limitations).
- **The two-dot status slot is intentionally empty.** `.settings__server-status-slot` is a
  class-labelled mount point for a future #330-style indicator; it carries no `aria-label="Connection
  status"` in this slice to avoid colliding with the `thread` view's existing indicator of the same name.
- **No trailing chevron.** Mobile's Server row (17:12) has a navigate-to-detail chevron (17:16); desktop
  has no server-detail screen for it to lead to, so it's omitted rather than rendered dead.
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
- [Server-info store](server-info-store.md) / [#340](../codebase/340.md) — the store and loader
  [#334](../codebase/334.md) mounts and reads for the Server row.
- [#330 codebase notes](../codebase/330.md) — the `ConnectionStatusIndicator`/`Control` view/container
  precedent `ServerRow`/`ServerRowControl` follows, and the `aria-label="Connection status"` marker this
  screen's empty host slot deliberately avoids duplicating.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule
  `PairedShell`'s `useReducer` (and this ticket's added arm) follows.
- [#333 codebase notes](../codebase/333.md) · Spec: `docs/specs/architecture/333-settings-screen-scaffold.md`
- [#334 codebase notes](../codebase/334.md) · Spec: `docs/specs/architecture/334-settings-connection-server-row.md`
  — fills this screen's Connection section-body with the Server row.
- Remaining follow-ups, blocked-by #333: [#151](../codebase/151.md) (preference rows), [#152](../codebase/152.md)
  (pair another server).
