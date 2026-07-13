# #347 — Archive screen: scaffold, navigation route, and two-tab segmented header

Ticket: https://github.com/pyrycode/pyrycode-desktop/issues/347 · Size **S** · Not security-sensitive · Split from #153 (transport half #346 DONE PR#357; content half #348 blocked on this + #346)

This slice is the Archive **screen chrome only** — the `archive` nav route, a channel-home entry affordance that opens it, and the `ArchiveScreen` shell (back header + two-tab segmented header with a selected-tab indicator and **empty** tab bodies). No store read, no counts, no restore rows — those are #348, which mounts into the empty tab body this slice leaves. It mirrors, almost beat-for-beat, how the Settings scaffold shipped (#333: route + channel-home entry + empty section shell before its content row #334).

## Files to read first

Read these before writing code — the design is a structural clone of the Settings scaffold, so the fastest path is to read the four Settings/nav files that shipped it, then mirror them.

- `src/renderer/src/pairedRoute.ts` (whole file, 66 lines) — the paired-region nav model. You add `archive` to the `PairedRoute` union (line 12) and `openArchive` to the `PairedNav` union (lines 22-28), then one `case` in `nextPairedRoute` (lines 44-65). The `assertNever` default (line 62) is the exhaustiveness guard that forces the new arm. The file's own comments already name-check `archive` as a future arm.
- `src/renderer/src/PairedShell.tsx` (whole file, 95 lines) — the pure route→view (`PairedShellView`, lines 29-56, with its own `assertNever` guard at line 11) and the container (`PairedShell`, lines 69-95). You add a `case 'archive'` returning `<ArchiveScreen onBack={props.onBack} />`, add an `onOpenArchive` prop, thread it to `<ChannelList>` in the `list` case (line 41), and add `onOpenArchive={() => dispatch({ type: 'openArchive' })}` in the container (near line 87).
- `src/renderer/src/screens/settings/SettingsScreen.tsx:39-115` — the screen scaffold shape. `SettingsScreen` (39-93) is the composition point; `BackControl` (100-115) is the in-file, non-exported back affordance (icon-only `<button aria-label="Back" onClick={onBack}>` + arrow_back SVG at line 111). Clone `BackControl` verbatim (same glyph, same aria) into `ArchiveScreen.tsx`; clone the topbar row shape (lines 48-51) with the title "Archived".
- `src/renderer/src/screens/channels/ChannelList.tsx:29-136` — the entry-affordance pattern. `SettingsButton` (116-136) is the in-file icon-only `<button aria-label="Settings">` threaded via the `onOpenSettings` prop (lines 32, 51, 101). Clone its shape for an `ArchiveButton` with a **distinct** `aria-label="Archive"`, and thread a new `onOpenArchive` prop through `ChannelList` → `ChannelListView` exactly as `onOpenSettings` is threaded.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx` (whole file, 76 lines) — the render-test idiom: `renderToStaticMarkup(<SettingsScreen onBack={noop} … />)` + `.toContain(...)` assertions on the server-rendered string. Node env, no DOM harness. `ArchiveScreen.test.tsx` follows this shape but renders the pure `ArchiveScreenView` at **both** `selectedTab` values.
- `src/renderer/src/PairedShell.test.tsx` (whole file, 136 lines) — how nav is proven **by composition**, not a click harness: `PairedShellView` is rendered per-route to prove which view mounts (lines 28-95), and the click-driven transitions are closed by asserting `nextPairedRoute(...)` separately (lines 109-135). You add a `route='archive'` block and an `openArchive` composition assertion.
- `src/renderer/src/pairedRoute.test.ts` (whole file, 50 lines) — the React-free reducer test. Add the `openArchive`→`archive` and `back`-from-`archive`→`list` cases.
- `src/renderer/src/screens/settings/settings.css:24-103` — the CSS anchors to clone: `.settings__topbar` (26), `.settings__back` + hover/focus/icon (38-63), `.settings__title` (66-73). Reuse the same spacing/color tokens.
- `src/renderer/src/screens/channels/channels.css:146-177` — `.channel-list__settings` (148-165, sticky top-right 48px icon button) + hover/focus/icon. The Archive entry clones this; see **Design → Entry affordance** for the actions-cluster placement.
- `src/renderer/src/theme/tokens.css:16-30` — the theme tokens. All Figma colors on node 18-2 already exist here (see **Design source**); this slice adds **no** new token.
- `docs/specs/architecture/333-settings-screen-scaffold.md` — the precedent spec this one mirrors (route + entry + empty-shell as one S unit). Skim for the composition-closure rationale.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=18-2

A dark-surface column: a back header (a 48px `arrow_back` icon button `18:4/18:5` + the title-large "Archived" text `18:8`), then a full-width two-tab segmented header `18:9` with a bottom hairline in `--color-outline-variant` — the active **Channels** tab `18:10` uses label-large text in `--color-on-surface` above a 2px `--color-primary` underline `18:13` (the selected-tab indicator), while the inactive **Discussions** tab `18:14` uses dimmer `--color-on-surface-variant` text above a transparent 2px underline `18:17`; below sits the tab body `18:18` (restore rows — **#348's** content, left empty here). Figma order is Channels then Discussions. The Figma labels read "Channels (3)" / "Discussions (8)" — the parenthesised counts are **#348**, so this slice's labels are the bare "Channels" / "Discussions".

**Token map (Figma variable → existing `tokens.css` var — no new token):**

| Figma (node 18-2) | Codebase token | Value | Used for |
|---|---|---|---|
| `schemes/surface` | `--color-surface` | `#101418` | screen background |
| `schemes/on-surface` | `--color-on-surface` | `#e0e2e8` | title, **active** tab label |
| `schemes/on-surface-variant` | `--color-on-surface-variant` | `#c2c7cf` | **inactive** tab label |
| `schemes/primary` | `--color-primary` | `#9dcbfc` | 2px active-tab underline |
| `schemes/outline-variant` | `--color-outline-variant` | `#42474e` | segmented-header bottom hairline |
| `M3/title/large` | `--text-title-large-*` | 22px | "Archived" title |
| `M3/label/large` | `--text-label-large-*` | 14px/500 | tab labels |

## Context

Archived conversations have no home on desktop. #346 shipped the outbound `unarchive_conversation` transport (dormant, awaiting its first caller in #348). This slice adds the *destination*: a navigable Archive screen with its chrome, so #348 has an empty, structured mount point to fill with live counts and restore rows. Splitting the chrome from the content mirrors #333/#334 exactly — the scaffold ships the route + entry + empty shell, the content lands in the follow-up. That keeps each slice a single, testable unit and the screen a pure component with no store/transport/IPC (so it is server-renderable and needs no live connection to test).

## Design

Three touched production files + one new screen, all additive:

### 1. Route + nav arm — `src/renderer/src/pairedRoute.ts`

Two added union members and one added case, each forced by an existing `assertNever` (no rewrite of `list`/`thread`/`settings`/`pairServer`):

- `PairedRoute`: append `| 'archive'` (the file already name-checks `archive` as a future arm).
- `PairedNav`: append `| { type: 'openArchive' }` — the sealed discriminated-union event (CLAUDE.md convention).
- `nextPairedRoute`: add `case 'openArchive': return 'archive'`. Adding the `openArchive` arm forces this case via the `PairedNav` `assertNever` default; adding the `archive` route forces the `PairedShellView` route→view case via *its* `assertNever` default — two guards, one per file, exactly as #333 did.

Returning from Archive **reuses the existing absolute `back` arm** (`back` → `list`, current-independent). No new "close archive" event; `back` from `archive` lands on `list` exactly as it does from `settings`/`thread`.

### 2. Route→view + container — `src/renderer/src/PairedShell.tsx`

- `PairedShellView`: add `case 'archive': return <ArchiveScreen onBack={props.onBack} />` (reuses the shared `back` dispatch, like the `settings` case). Add a required `onOpenArchive: () => void` to the props type; pass it into the `list` case's `<ChannelList … onOpenArchive={props.onOpenArchive} />`.
- `PairedShell` (container): add `onOpenArchive={() => dispatch({ type: 'openArchive' })}` to the rendered `<PairedShellView>`.

### 3. Entry affordance — `src/renderer/src/screens/channels/ChannelList.tsx`

Add `onOpenArchive: () => void` to both `ChannelList` and `ChannelListView` prop types, threaded like `onOpenSettings`. Add an in-file, non-exported `ArchiveButton({ onClick })` cloning `SettingsButton`'s shape exactly — an icon-only native `<button type="button" aria-label="Archive" onClick={onClick}>` wrapping an `aria-hidden` 24px SVG. The **distinct** `aria-label="Archive"` is the ticket's disambiguation from the gear's `aria-label="Settings"`. Suggested glyph: the Material `archive` box (no Figma node pins this desktop-invented entry, like `SettingsButton` — a recognizable archive glyph is acceptable):

```
M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z
```

**Placement — a top-right actions cluster.** `SettingsButton` today is a single sticky top-right child. Two independent sticky children would stack awkwardly, so wrap both in one flex-row cluster: render `<div className="channel-list__actions"><ArchiveButton …/><SettingsButton …/></div>` as the first child of the `.channel-list` `<section>` (Archive leading, gear trailing — conventional gear-rightmost). Move the `position: sticky; top; align-self: flex-end; z-index; margin` off `.channel-list__settings` onto `.channel-list__actions`; `.channel-list__settings` and the new `.channel-list__archive` keep only their 48px box + transparent-background + hover/focus/color rules. This is the one bit of #333-adjacent structural change the task genuinely needs (a second top-right entry has to live somewhere) — keep it surgical, don't touch the FAB or list body.

### 4. New screen — `src/renderer/src/screens/archive/ArchiveScreen.tsx` (+ `archive.css`)

A container/pure-view split (the #203/#218 idiom the ticket calls out), so the view is a pure function of the selected tab and testable at both tab values without a DOM harness.

**Sealed tab identity** (module-level, non-exported except the type):

```ts
export type ArchiveTab = 'channels' | 'discussions'
// Ordered Channels-then-Discussions (Figma order). Bare labels — counts are #348.
const ARCHIVE_TABS: readonly { key: ArchiveTab; label: string }[] = [
  { key: 'channels', label: 'Channels' },
  { key: 'discussions', label: 'Discussions' }
]
```

**Container** `ArchiveScreen({ onBack }: { onBack: () => void }): JSX.Element` — holds the *only* state: `const [selectedTab, setSelectedTab] = useState<ArchiveTab>('channels')` (screen-local, ADR 0006 — resets on remount, never the session store). Renders `<ArchiveScreenView selectedTab={selectedTab} onSelectTab={setSelectedTab} onBack={onBack} />`. No store, no `window.pyry`, no effect → server-renderable (defaults to `channels` at first paint), so `PairedShellView route='archive'` renders it cleanly.

**Pure view** `ArchiveScreenView({ selectedTab, onSelectTab, onBack }): JSX.Element` — props in, markup out. Structure (contract, not implementation):

- Root `<section className="archive" aria-label="Archive screen">` — the screen's region marker (mirrors Settings' `aria-label="Settings screen"`), the unique discriminator PairedShell tests key on.
- Topbar `<div className="archive__topbar">` holding the cloned `<BackControl onBack={onBack} />` + `<h1 className="archive__title">Archived</h1>`.
- Segmented header `<div className="archive__tabs" role="tablist">`: `ARCHIVE_TABS.map(tab => …)` → one `<button type="button" role="tab" id={\`archive-tab-${tab.key}\`} aria-selected={tab.key === selectedTab} aria-controls="archive-tabpanel" className="archive__tab" onClick={() => onSelectTab(tab.key)}>{tab.label}</button>`. Because `tab.key` drives the label, `aria-selected`, and the click payload from a single source, the active-marker and the click target cannot drift apart — the interaction glue is structurally correct, not hand-wired.
- Body `<section className="archive__tab-panel" role="tabpanel" id="archive-tabpanel" aria-labelledby={\`archive-tab-${selectedTab}\`}>` — **empty**. This is #348's mount point: its content becomes a pure function of `selectedTab` (channels-partition vs discussions-partition restore rows). Leaving it empty with the `aria-labelledby` switching is what proves "selecting a tab switches which body is shown."

**In-file `BackControl`** — cloned verbatim from `SettingsScreen`'s (same `arrow_back` glyph, `aria-label="Back"`, required `onBack`); unconditional (the screen always renders it).

**`archive.css`** — clone the topbar/back/title rules from `settings.css:24-73` (rename `settings__` → `archive__`). New rules for the segmented header: `.archive__tabs` (flex row, `border-bottom: 1px solid var(--color-outline-variant)`), `.archive__tab` (flex `1 1 0`, centered, label-large text in `--color-on-surface-variant`, transparent 2px `border-bottom`, button reset, `cursor: pointer`), and `.archive__tab[aria-selected="true"]` (text → `--color-on-surface`, `border-bottom-color: var(--color-primary)` — the 2px indicator). Driving the underline off `[aria-selected="true"]` means the ARIA state **is** the single source of active-ness; no separate modifier class or indicator node. `.archive__tab-panel` fills remaining height (`flex: 1 1 auto`), matching `.settings__body`.

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

## State + concurrency model

- **One state atom, screen-local:** `selectedTab: ArchiveTab` in `ArchiveScreen`'s `useState`. It is ephemeral UI selection (ADR 0006), never the Zustand session store — it resets when the screen remounts, which is correct (re-opening Archive starts on Channels). No store slice, no async task, no stream, no subscription, nothing to cancel or tear down. The screen is inert render.
- **Nav state** stays where it already lives — `PairedShell`'s `useReducer(nextPairedRoute)`. This slice adds one route and one event to that existing reducer; it introduces no new reducer and no new container state.
- **No transport, IPC, sockets, keys, or `window.pyry`** anywhere in this slice — the AC5 "pure component, no store/transport/IPC" invariant, and why the screen server-renders and needs no live connection to test.

## Error handling

There are no failure modes to handle: no network, no socket, no parse, no permission, no daemon round-trip, no untrusted input. Every string this slice renders is a client-owned module constant ("Archived", "Channels", "Discussions") — no injection sink, which is why the ticket is not `security-sensitive` (same rationale as #333's scaffold). `selectedTab` is a closed two-value union guarded by TypeScript; there is no invalid state to defend. The empty tab body renders nothing — no empty-state copy is in scope (that arrives with #348's rows).

## Testing strategy

`npm test` (vitest, **node** env) + `npm run typecheck`. The codebase has **no DOM/jsdom harness** — every test uses `renderToStaticMarkup` and the vitest config deliberately deferred a DOM environment. Do **not** add jsdom / `@testing-library` / a new devDependency for this slice; the tab-switch is proven the way every interaction in this codebase is proven — pure-view-as-a-function-of-state (server-rendered at each value) + composition closure — not a click harness. (CLAUDE.md: no dependencies without justification.)

- **`pairedRoute.test.ts`** (extend, React-free): add
  - `openArchive` from `list` → `'archive'`.
  - `back` from `archive` → `'list'` (documents Archive → channel-home reuses the absolute `back` arm, like the existing `back`-from-`settings` case).
- **`ArchiveScreen.test.tsx`** (new): server-render `ArchiveScreenView` with injected `onBack`/`onSelectTab` noops, at **both** `selectedTab` values:
  - Renders the "Archived" title (`>Archived</h1>`) and the root region marker `aria-label="Archive screen"`.
  - Renders both tab labels "Channels" and "Discussions", with **no** counts (assert the rendered labels are bare — e.g. no `(3)`/`(8)`).
  - **Exactly one tab selected:** at `selectedTab='channels'`, `aria-selected="true"` occurs exactly once and `aria-selected="false"` exactly once; the panel's `aria-labelledby="archive-tab-channels"`.
  - **Tab switch:** at `selectedTab='discussions'`, the selected tab flips and the panel's `aria-labelledby="archive-tab-discussions"` — proving the shown body is a pure function of the selection (the visible-indicator + which-body-is-shown ACs).
  - **Container default:** server-render `<ArchiveScreen onBack={noop} />` and assert it enters with Channels selected (`aria-labelledby="archive-tab-channels"`) — mirrors PairedShell's "enters at the list" container test.
- **`PairedShell.test.tsx`** (extend): add a `route='archive'` block asserting the archive marker `aria-label="Archive screen"` is present and the list/thread markers are absent; add a composition assertion `nextPairedRoute('list', { type: 'openArchive' }) === 'archive'` (the entry→route seam the `ArchiveButton` drives, closed by composition exactly like the `openSettings` seam). Add `onOpenArchive={noop}` to the four existing `<PairedShellView …>` calls (required prop).
- **`ChannelList.test.tsx`** (extend): thread `onOpenArchive={noop}` into the `render` helper's `<ChannelListView>`; add an `ARCHIVE_ENTRY_MARKER = 'aria-label="Archive"'` assertion present in **all three** list states (null / empty / populated), mirroring the existing Settings-entry-marker test.

Interaction-glue not exercised under server render (a tab button's `onClick` actually invoking `setSelectedTab`) is closed by composition, the codebase's established bar: `ChannelList.test.tsx` never fires `SettingsButton`'s click either — it asserts the button's presence and leaves the wiring to `PairedShell` + `pairedRoute`. Here the glue is even tighter: the click payload and the active-marker both derive from the same `tab.key`, so a mismatch is structurally impossible.

## Open questions

- **Entry glyph.** The `ArchiveButton` glyph is developer's choice (Material `archive` suggested); no Figma node pins this desktop-invented entry, so any recognizable archive glyph is fine. Not a blocker.
- **`ArchiveTab` export location.** Exported from `ArchiveScreen.tsx` for now; if #348 needs it plus a partitioning helper in a shared module, #348 can relocate it then. No pre-emptive module split this slice.

## Scope self-check

Production source files (`*.ts`/`*.tsx`, excluding tests): `pairedRoute.ts` (mod), `PairedShell.tsx` (mod), `ChannelList.tsx` (mod), `ArchiveScreen.tsx` (new) = **4** (< 5 ✓). New files: `ArchiveScreen.tsx`, `ArchiveScreen.test.tsx`, `archive.css` = 3 (≤ 3 ✓). New exports: `ArchiveScreen`, `ArchiveScreenView`, `ArchiveTab` = 3 (< 5 ✓). Edit fan-out: `archive` + `openArchive` each force exactly one `assertNever`-guarded case; `onOpenArchive` threads through one component; ~4 mechanical prop-adds in one test file — well under 10 call sites. Est. total ~400 LOC. Sized **S**, ships as one ticket (route + entry + scaffold = one cohesive unit, the #333 precedent).
