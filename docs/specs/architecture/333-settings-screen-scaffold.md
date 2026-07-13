# Spec — #333 Settings screen reachable from the nav shell (scaffold + Connection section)

Size **S**. Not security-sensitive (pure renderer nav/UI — no keys, sockets, tokens, or crypto).

Adds a navigable, testable **Settings** screen to the paired region: one route member, one nav
event, an entry affordance on the channel home, and a scaffold screen with the top-level chrome
(back + "Settings" title) and an empty **Connection** section container. The scaffold carries **no
data** — the Server-info row is #334, and the preference sections (Appearance/Defaults/…) are
#151/#152. All three are blocked-by this ticket and mount into what ships here.

This is the *scaffold* child of the #150 → #332/#333/#334 split. The store/data path was the OTHER
child (#332 → #339 IPC surface, merged PR#341; #340 renderer store, merged PR#344). This slice is
chrome-only: route + entry + scaffold form one indivisible unit — a route with no screen, or a screen
with no route, is dead code.

## Files to read first

- `src/renderer/src/pairedRoute.ts` (whole, 43 lines) — the paired-region router. `PairedRoute` bare
  string union + `PairedNav` discriminated union + `nextPairedRoute` reducer with an `assertNever`
  default. Its own comments already name the `settings`/`openSettings` extension point. **You edit all
  three here.**
- `src/renderer/src/pairedRoute.test.ts` (whole, 24 lines) — the React-free reducer test idiom
  (appRoute.test.ts precedent). You add two cases here.
- `src/renderer/src/PairedShell.tsx` (whole, 69 lines) — `PairedShellView` (pure route→view switch
  with its own `assertNever` default; **the second guard**) + `PairedShell` container (the `useReducer`
  over `nextPairedRoute`). Note how `onBack` is already threaded to `ConversationScreen` and how
  `onOpen` is threaded to `ChannelList` — you copy that threading for `onOpenSettings`.
- `src/renderer/src/PairedShell.test.tsx` (whole, 64 lines) — `renderToStaticMarkup` view test with
  per-view discriminating markers. **Read the marker-collision note in Testing strategy below** before
  adding the `route='settings'` case.
- `src/renderer/src/screens/channels/ChannelList.tsx:29-126` — the `list` view. Container +
  `ChannelListView` pure view + the in-file `NewConversationFab` (icon-only `<button aria-label=…>`
  rendered as a sibling of `renderBody`). **Your entry affordance is a sibling in the same spot;
  clone the FAB's shape.** Note the container-reads/pure-view split and the "`window.pyry` only inside
  click closures" discipline (not needed here — no bridge call — but keep the render pure).
- `src/renderer/src/screens/channels/ChannelList.test.tsx` (whole) — the `render()` helper passing all
  view props; the `FAB_MARKER` "present in all three list states" pattern you mirror for the entry.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1060-1085` — `BackControl`: the
  icon-only `<button className="conversation__back" aria-label="Back">` + inline arrow_back SVG. Your
  back affordance reuses this exact shape (but **required**, not optional-gated — a Settings screen
  always has a back button).
- `src/renderer/src/screens/conversation/conversation.css:24-66` — `.conversation__back` treatment
  (48px square, `--radius-full`, transparent→`--color-surface-container-high` hover, focus-visible
  outline). Duplicate this ~15-line treatment into `settings.css` (do NOT extract a shared class — that
  refactors adjacent code, out of scope).
- `src/renderer/src/screens/channels/channels.css:11-40, 141-175` — `.channel-list` full-height scroll
  column (the screen-root idiom you mirror for `.settings`), `.channel-list__section-header` (muted
  `--color-on-surface-variant` at 85% — **your Connection header is DIFFERENT: `--color-primary`**,
  per Figma), and `.channel-list__fab` sticky-corner treatment (the entry button's positioning model).
- `src/renderer/src/theme/tokens.css` (whole, 103 lines) — the only source of color/type/spacing.
  Token mapping table is in Design below; **no literal may live in a component stylesheet.**
- New: `src/renderer/src/screens/settings/` — this feature's new directory (siblings: `channels/`,
  `conversation/`, `pairing/`). You create `SettingsScreen.tsx`, `SettingsScreen.test.tsx`,
  `settings.css` here.

## Context

Desktop has no Settings screen. `pairedRoute.ts` currently routes two views — `list` (channel home)
and `thread` — and its comments already anticipate a `settings` member "an added union member, not a
rewrite" with an `openSettings` nav arm. This slice realizes that: it makes the screen reachable and
gives it its chrome, leaving the section contents to follow-ups. Mirrors mobile #390/#398.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-2

A full-height dark (`--color-surface` #101418) column. **Top (`17:3`)**: a compact app-bar row — a
48px back icon button (`17:4/17:5`, arrow_back, on-surface) followed by the "Settings" title (`17:8`,
title-large 22/28, on-surface). **Body**: a scroll region whose first section is the **Connection**
header (`17:10/17:11`) — label-large 14/20 in the **primary accent** `--color-primary` #9dcbfc (this
is the M3 settings section-header color; it is *not* the muted grey of the channel-list section
headers) — followed by an empty content area reserved for #334's Server row. **Reproduce chrome +
Connection header only.** Everything below is out of scope on this node: Server row `17:12` → #334;
"Pair another server" `17:18`, Appearance/Defaults/Notifications/Memory/Storage/About → #151/#152.

## Design

Four production files. Additive throughout — no existing route/nav/view is rewritten; each edit is
forced or threaded, never restructured.

### 1. `pairedRoute.ts` — route + nav member (the two exhaustiveness guards)

- `PairedRoute`: add `'settings'` → `'list' | 'thread' | 'settings'`.
- `PairedNav`: add `{ type: 'openSettings' }` arm.
- `nextPairedRoute`: add `case 'openSettings': return 'settings'`. **No `current` inspection** —
  `openSettings` always lands on `settings`, like `open`/`back` today.
- **Back reuses the existing `back` arm.** `nextPairedRoute('settings', { type: 'back' })` already
  returns `'list'` (the arm is absolute, `current`-independent), so Settings → channel-home back needs
  no new event and no stack-aware `back` (AC3, Technical Notes). The `assertNever` default forces the
  new `openSettings` case at `npm run typecheck`.

### 2. `PairedShell.tsx` — the second guard + threading

- `PairedShellView`: add prop `onOpenSettings: () => void`; add
  `case 'settings': return <SettingsScreen onBack={props.onBack} />`. The `settings` case **reuses the
  existing `onBack`** (already `() => dispatch({ type: 'back' })`); no new back wiring. The `assertNever`
  default forces this case. Thread `onOpenSettings` into the `list` case:
  `<ChannelList onOpen={props.onOpen} onOpenSettings={props.onOpenSettings} />`.
- `PairedShell` container: add `onOpenSettings={() => dispatch({ type: 'openSettings' })}` to the
  `<PairedShellView>` call (beside the existing `onOpen`/`onBack`). No new state, no new store — the
  same ephemeral `useReducer` (ADR 0006).
- Import `SettingsScreen` from `./screens/settings/SettingsScreen`.

### 3. `ChannelList.tsx` — the entry affordance

- `ChannelList` container: add prop `onOpenSettings: () => void`; pass it to `ChannelListView`.
- `ChannelListView`: add prop `onOpenSettings: () => void`; render a new in-file `SettingsButton` as a
  **sibling of `renderBody`/`NewConversationFab`** inside the `<section>` (so it is present in all three
  list states, like the FAB). Clone `NewConversationFab`'s shape exactly: an icon-only native
  `<button type="button" aria-label="Settings" onClick={onOpenSettings}>` with an inline 24px Material
  `settings` (gear) glyph, `aria-hidden` on the SVG. `aria-label="Settings"` supplies the accessible
  name (AC1 — "an accessible-named control on ChannelList"). No `window.pyry`, no store: `onOpenSettings`
  is a pure injected nav effect (required — "a view that cannot act is a bug").
- **Placement (desktop-gap affordance).** ChannelList has no top app bar (its own comment defers it),
  and Figma 15-8's scoped nodes don't pin a settings entry — so this is a desktop-invented affordance,
  like `NewConversationFab`'s "no Figma node pins this" note. Recommended: render `SettingsButton` as
  the **first** child of the `<section>` and pin it top-right via CSS — the FAB's sticky-corner model
  inverted to the top (`position: sticky; top; align-self: flex-end; z-index: 1`), so it stays reachable
  in a long, scrolling list. The developer confirms the corner against the mobile home mock; the AC only
  requires the control be present and accessible-named, not a pixel-pinned location.

### 4. `SettingsScreen.tsx` — the scaffold (new)

A single **pure, exported** view — no store read, no effects, no `window.pyry` (the scaffold has no
data; #334 adds the store-bound Server row later). Trivially server-renderable, so tests render it
directly with `renderToStaticMarkup` and an injected `onBack`.

Contract:

```
export function SettingsScreen({ onBack }: { onBack: () => void }): JSX.Element
```

- `onBack` is **required** (chrome, not optional — unlike `ConversationScreen`'s optional-gated
  `BackControl`). Bound by `PairedShellView` to the shared `back` dispatch.
- Structure (Figma 17-2, chrome + Connection only):
  - Root `<section className="settings" aria-label="Settings screen">` — full-height scroll column
    (the `.channel-list`/`.conversation` root idiom). Use a **distinct** aria-label from the entry
    button (see the marker-collision note in Testing strategy) — `"Settings screen"`, not `"Settings"`.
  - Top-bar row `<div className="settings__topbar">`: the back button (an in-file `BackControl`
    reusing `.conversation__back`'s shape/glyph — see Files to read first) + the title
    `<h1 className="settings__title">Settings</h1>`.
  - Body `<div className="settings__body">` containing the Connection section:
    `<section className="settings__section">` with `<h2 className="settings__section-header">Connection</h2>`
    and an **empty** `<div className="settings__section-body" />`. The empty body is #334's documented
    mount point — the Server row (`17:12`) becomes its child.
- Copy strings ("Settings", "Connection", the `Back`/`Settings` accessible names) are **client-owned
  module-level constants** (the `EMPTY_THREAD_COPY` idiom) — never daemon strings, so nothing untrusted
  reaches the DOM (this is why the slice is not security-sensitive). Semantic `<h1>`/`<h2>` give a free,
  assertable heading hierarchy; the "Settings" region has no top-level heading precedent to conflict with.

### 5. `settings.css` (new) — imported by `SettingsScreen.tsx`

Mirror `channels.css`'s screen-root posture; every value is a token (no literals). Token map:

| Element | Figma | Token(s) |
|---|---|---|
| Root bg / text / font | surface #101418 / on-surface #e0e2e8 | `--color-surface` / `--color-on-surface` / `--font-sans` |
| Root layout | full-height scroll column | `height:100%; box-sizing:border-box; display:flex; flex-direction:column; overflow-y:auto` (the `.channel-list` idiom) |
| `.settings__title` "Settings" | title-large 22/28 | `--text-title-large-size/-line/-tracking/-weight`, `--color-on-surface` |
| `.settings__back` | 48px back button | duplicate `.conversation__back` (48px square, `--radius-full`, transparent→`--color-surface-container-high` hover, `--color-outline` focus-visible outline, `--color-on-surface` glyph) |
| `.settings__section-header` "Connection" | label-large 14/20, **primary** | `--text-label-large-*`, **`--color-primary`** (NOT the muted `--color-on-surface-variant` of `.channel-list__section-header`) |
| Header/section padding | `17:10` pt-16 pb-4 px-16; rows px-16 py-10 | `--space-4`, `--space-1`, `--space-2`/`--space-3` from the 4px scale |

`.channel-list__settings` (the entry button, in `channels.css`): 48px icon button (the
`.conversation__back` glyph-in-square treatment) positioned per §3 (sticky top-right).

### Data flow

```
ChannelList SettingsButton.onClick
  → PairedShell onOpenSettings  = dispatch({ type:'openSettings' })
  → nextPairedRoute('list', openSettings) = 'settings'
  → PairedShellView route='settings' → <SettingsScreen onBack={dispatch back} />

SettingsScreen back
  → dispatch({ type:'back' }) → nextPairedRoute('settings', back) = 'list' → ChannelList
```

No new store, no IPC, no wire, no daemon events. Nav is the existing screen-local `useReducer`.

## State + concurrency model

None added. The paired-region nav remains a single ephemeral `useReducer` over the pure
`nextPairedRoute` (ADR 0006 — screen-local, resets on remount, never the session store). `SettingsScreen`
holds no state and subscribes to no store. There are no async tasks, streams, subscriptions,
`AbortController`s, or teardown concerns in this slice. `PairedShell` still only mounts on App's
`conversation` route (paired-only), so the neutral-first-paint invariant is untouched.

## Error handling

No failure modes in scope — no network, socket, parse, or permission surface is touched (the transport
stays in `src/main`, untouched). The only "invalid state" the nav can reach is compile-checked: a
missing `openSettings`/`settings` case trips the respective `assertNever` (`nextPairedRoute` /
`PairedShellView`) at `npm run typecheck`, which is the QA gate. `SettingsScreen` renders no
daemon-supplied string, so there is no untrusted-text sink to guard.

## Testing strategy

All tests are React-free reducer tests or `renderToStaticMarkup` string assertions — no DOM harness,
no live connection (the #203/#218 container-reads/pure-view split; the existing `pairedRoute.test.ts` /
`PairedShell.test.tsx` idioms). `npm run typecheck` covers the two exhaustiveness guards and all prop
contracts.

**`pairedRoute.test.ts` — add two cases:**
- `openSettings` from `list` → `settings`.
- `back` from `settings` → `list` (documents that Settings→home reuses the existing absolute `back`
  arm — no stack-aware back).

**`SettingsScreen.test.tsx` (new) — server-render `<SettingsScreen onBack={noop} />`, assert:**
- the "Settings" title text is present;
- the "Connection" section heading text is present;
- the back affordance (`aria-label="Back"`) is present;
- the scaffold is empty of data: the Server row is absent (e.g. `not.toContain('Server')` / the
  `juhana-mac-2026` host-name sentinel) — proves the section is a container, not #334's populated row;
- (optional) the root region marker (`aria-label="Settings screen"`) is present.

**`PairedShell.test.tsx` — add a `route='settings'` view case:**
- `<PairedShellView route="settings" … onOpenSettings={noop} />` renders the Settings screen and not
  the thread/list.
- **Marker-collision hazard — read before choosing the marker.** The `route='list'` view now contains
  the entry button whose `aria-label="Settings"`, and the thread view contains a Back button whose
  `aria-label="Back"`. So neither `"Settings"` nor `aria-label="Back"` discriminates the settings view.
  Use a **settings-unique** marker: the `"Connection"` section-heading text or the root
  `aria-label="Settings screen"` (or `class="settings"`). Add `onOpenSettings={noop}` to the two
  existing `PairedShellView` render calls (compile fix for the new required prop).
- Add a one-line composition assertion (the file's existing style):
  `nextPairedRoute('list', { type: 'openSettings' })` === `'settings'` — documents the entry→route seam
  the button drives, closed by composing the separately-tested reducer with the view.

**`ChannelList.test.tsx` — add:**
- a `SETTINGS_ENTRY_MARKER = 'aria-label="Settings"'` present in all three list states (null / `[]` /
  populated), mirroring `FAB_MARKER`;
- add `onOpenSettings={noop}` to the `render()` helper (compile fix for the new required view prop).

Tests are described as scenarios; write them in the project's vitest idiom.

## Open questions

- **Entry-button corner.** Recommended top-right sticky (§3). If the developer's read of the mobile
  home mock argues for another corner, that's a free CSS swap — the AC pins presence + accessible name,
  not location. Not a blocker.
- **`SettingsButton` glyph.** The Material `settings` gear is the natural choice; no Figma node on the
  ChannelList (15-8) scope pins a specific glyph (the `NewConversationFab` "no node pins this row-level
  control" situation). A specific path is a small later swap.
