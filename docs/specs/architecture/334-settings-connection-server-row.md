# #334 — Settings Connection section: paired server-id + relay-URL row

**Size:** S · **Security-sensitive:** no · Split from #150; data path re-pointed to #339 (IPC) + #340 (renderer store), both merged.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-12

A single settings row: a left text column holding a `Server` label (M3 body-large, on-surface) above the server-id value (`juhana-mac-2026`, M3 body-small, on-surface-variant), with the two-dot Relay/Pyrycode status (green + red dots) directly beneath the id. **Desktop deltas vs the mobile node:** (1) the desktop row adds the `relayUrl` as a second body-small secondary line beneath the server-id (mobile omits it — a documented field-level augmentation, per the ticket); (2) this slice renders the two-dot Status area as an **empty host slot** (no dots, no "Relay"/"Pyrycode" labels — #330 fills it later); (3) the mobile row's trailing chevron (`17:16`) is **omitted** — it is a navigate-to-server-detail affordance and desktop has no such screen; a dead chevron would be misleading UI.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:967-1058` — **the load-bearing precedent.** `ConnectionStatusIndicator` (pure props-in view, exported) + `ConnectionStatusIndicatorControl` (in-file store-bound container). Copy this exact view/container shape. Extract: the pure-view + container split, and that the container reads narrow store slices and passes mapped props down.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:891-934` — the `RepairPrompt`/`RepairControl` comment stating **"the container's populated branch is unreachable under server render (zustand v5 reads getInitialState())"**. This is the single fact that determines the whole test strategy (see Testing). Read it.
- `src/renderer/src/store/serverInfoStore.ts` (whole, 65 lines) — the read surface: `useServerInfoStore(selectServerInfo)` → `ServerInfoValue | null` where `ServerInfoValue = { serverId: string; relayUrl: string }`. Extract: read the store through this selector; never call the bridge yourself.
- `src/renderer/src/store/serverInfoLoader.ts` (whole, 69 lines) — `ServerInfoData()` headless loader (already exists, ships dormant). Extract: mount it as-is; it renders `null`, fires a one-shot `window.pyry.serverInfo()` on mount, and writes the store. It dereferences `window.pyry` only inside its `useEffect`, so it server-renders with no bridge mock.
- `src/renderer/src/screens/settings/SettingsScreen.tsx` (whole, 62 lines) — the mount point: the empty `<div className="settings__section-body" />`. Extract: the `SETTINGS_COPY` client-owned-copy idiom; the pure-scaffold-with-`onBack` shape you'll extend to compose two children.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx` (whole, 38 lines) — the `renderToStaticMarkup` test idiom **and the "data-free scaffold" test at lines 29-37 that this ticket must update** (it asserts `not.toContain('Server')`, which the mounted row breaks). Extract: what to change.
- `src/renderer/src/screens/settings/settings.css` (whole, ~90 lines) — the "every color/type/spacing value references a token; bare geometry literals are OK" idiom, `.settings__section-body`, and the ±token-mapping convention ("map Figma px with no exact token to the nearest `--space-*`"). Extract: the CSS conventions; the section-body container the row lives in.
- `src/renderer/src/theme/tokens.css:22-23, 62-75, 88-93` — exact tokens for the row: `--color-on-surface` (#e0e2e8), `--color-on-surface-variant` (#c2c7cf), `--text-body-large-*` (16/24/0.5px/400), `--text-body-small-*` (12/16/0.4px/400), `--space-1..6` (4/8/12/16/20/24). Extract: the exact token names to reference in CSS.
- `src/renderer/src/PairedShell.tsx:29-39` — confirms `SettingsScreen` mounts only under the `settings` route, and PairedShell mounts only post-pairing. Extract: Settings is paired-only, so `serverInfo === null` means "not yet loaded", not "not paired" (AC3).
- `src/shared/ipc/serverInfo.ts:48-50` — the `ServerInfo` union (context only; the row reads the store, not this). Extract: `serverId` + `relayUrl` are the only two fields, both non-secret by construction.

## Context

The Settings scaffold (#333, merged) reaches the paired shell's `settings` route and leaves an empty `.settings__section-body` under the "Connection" header as this ticket's documented mount point. The paired server's non-secret identity now reaches the renderer: #339 vets `serverId` + `relayUrl` across the IPC boundary (credentials stripped main-side), and #340 lands them in `serverInfoStore` via the `ServerInfoData` loader.

But #340 shipped that loader **dormant** — nothing mounts it, so the store sits at `null` forever. Its own doc rejects an app-level mount (it would run before pairing → `unavailable` → `null` and never re-run). So this slice does two things: (1) render the Server row reading `serverInfo` from the store, and (2) **mount `ServerInfoData` inside the Settings tree** so a fresh fetch fires on every Settings-open. Without the mount, the row never populates.

## Design

### Module structure

One new file plus a small edit to the scaffold. Mirrors the `ConnectionStatusIndicator` precedent, but as a dedicated module (rather than in-file) so the pure view gets its own clean test seam and `SettingsScreen` stays a thin composition point.

**New: `src/renderer/src/screens/settings/ServerRow.tsx`**
- `ServerRow` — the pure, exported, props-in/markup-out view. Signature:
  - `export function ServerRow({ serverInfo }: { serverInfo: ServerInfoValue | null }): JSX.Element`
  - Behavior: renders the "Server" label always; when `serverInfo` is present, renders `serverId` (primary line) and `relayUrl` (secondary line) as two body-small values; when `null`, renders a single client-owned loading placeholder in place of the values (no blank `<p></p>`); renders the empty host slot in both states.
- `ServerRowControl` — the exported, store-bound container. Signature:
  - `export function ServerRowControl(): JSX.Element`
  - Behavior: `const serverInfo = useServerInfoStore(selectServerInfo)` → `<ServerRow serverInfo={serverInfo} />`. No effects, no `window.pyry`, no IPC — a pure read (the `ConnectionStatusIndicatorControl` posture).
- One module-level client-owned copy constant for the loading placeholder, e.g. `SERVER_ROW_LOADING = 'Loading…'` (U+2026 ellipsis, apostrophe-free — the `STALL_COPY`/`'Thinking…'` idiom). Also a `SERVER_ROW_LABEL = 'Server'` constant, matching the `SETTINGS_COPY` convention.

**Modified: `src/renderer/src/screens/settings/SettingsScreen.tsx`**
- Import `ServerInfoData` from `../../store/serverInfoLoader` and `ServerRowControl` from `./ServerRow`.
- Fill the section-body: `<div className="settings__section-body"><ServerInfoData /><ServerRowControl /></div>`. `ServerInfoData` is the headless loader (renders null, fires the fetch on mount); `ServerRowControl` renders the row. This is the `RunConfigData` + `RunConfigSections` sibling-mount pattern (ConversationScreen `144-146`).

**Modified: `src/renderer/src/screens/settings/settings.css`** — row styles (see below).

### Row markup shape (contract, not implementation)

```
<div class="settings__server-row">
  <div class="settings__server-row-text">
    <p class="settings__server-row-label">Server</p>        // always; body-large / on-surface
    // present:  <p class="settings__server-row-id">{serverId}</p>       // body-small / on-surface-variant
    //           <p class="settings__server-row-relay">{relayUrl}</p>    // body-small / on-surface-variant (desktop-added)
    // null:     <p class="settings__server-row-id ...--loading">{SERVER_ROW_LOADING}</p>  // single placeholder line
    <div class="settings__server-status-slot" />            // always; EMPTY host slot for #330 — see AC4
  </div>
</div>
```

- **`serverId` / `relayUrl` render as auto-escaped React children** (`{serverInfo.serverId}`), never `dangerouslySetInnerHTML`. Consistent with the codebase posture even though this ticket is not security-sensitive (these are the user's own at-rest pairing record, not live relay content).
- **The host slot is empty and carries NO `aria-label="Connection status"`** (AC4). It is "labelled" by its class name (`settings__server-status-slot`) — a stable mount target #330's settings-side indicator will later fill; that indicator brings its own `aria-label="Connection status"`. Rendering it here would collide with #330's marker (the #333 developer flagged this hazard).
- **No trailing chevron** (Figma `17:16` omitted — see Design source).

### CSS (settings.css) — describe, don't pre-write; every value is a token

| Class | Role | Key tokens (per settings.css convention) |
|---|---|---|
| `.settings__server-row` | The row container (Figma `17:12`): flex row, `px-16 py-10`. | `padding: <py token> var(--space-4)`; `py-10` has no exact token → nearest `--space-3` (12) or `--space-2` (8) per the file's ±token-mapping convention. |
| `.settings__server-row-text` | Left text column (`17:13`): flex-col, `gap-2px`. | `gap: 2px` (structural geometry, like the file's 48px square — no token). |
| `.settings__server-row-label` | "Server" label (`17:14`). | `--text-body-large-*`, `color: var(--color-on-surface)`, `margin: 0`. |
| `.settings__server-row-id`, `.settings__server-row-relay` | id + relay value lines (`17:15` + desktop addition). | `--text-body-small-*`, `color: var(--color-on-surface-variant)`, `margin: 0`. |
| `.settings__server-status-slot` | Empty two-dot host (`90:4`). | Structural only; may hold the `gap-16` for when #330 fills it, but no drawn styling this slice. |

Word-break: the id and relay values can be long (a `wss://…` URL) — allow `word-break: break-word` / `overflow-wrap` so they wrap inside the column rather than overflow the window (Figma `17:15` uses `word-break: break-word`).

## State + concurrency model

- **Store slice:** `serverInfoStore` (#340), read via `useServerInfoStore(selectServerInfo)` → `ServerInfoValue | null`. Narrow single-slice read — the row re-renders only when `serverInfo` changes (once, when the loader resolves). No new store, no new selector.
- **Data path / one-shot fetch:** `ServerInfoData` (#340) owns it. On mount it fires `window.pyry.serverInfo()` once (no subscription), maps the union → store value, and writes it; an `active` flag drops a StrictMode double-mount's late write. This ticket only *mounts* it — it writes zero loader/store code. Because it is mounted inside `SettingsScreen` (which mounts only under the `settings` route, post-pairing), a fresh, correct read fires on every Settings-open.
- **Concurrency/teardown:** the loader's `useEffect` cleanup flips `active = false` on unmount (Settings close), so a late-resolving fetch never writes into an unmounted tree. No `AbortController` needed — it is a one-shot `invoke`, and the loader already guards the write. Nothing in this ticket adds effects; `ServerRow`/`ServerRowControl` are pure reads.
- **Unidirectional:** read-only selector in; the only write path is the loader's `setServerInfo`. No two-way binding from the row into the store.

## Error handling

The failure surface is fully absorbed upstream by the two-arm `ServerInfo` union and the loader:
- **Not paired / unreadable record / rejected invoke** → the loader maps every non-`available` outcome to `null` and never rejects into the renderer (`serverInfoLoader.ts:35-42`). So the row's only observable states are `{serverId, relayUrl}` or `null`.
- **`null` (AC3):** render the loading placeholder — no crash, no stale values, no blank-looking empty `<p>`. Because Settings is paired-only and the fetch reads an at-rest record, `null` is a momentary "not yet loaded" window that resolves within a tick, not a persistent "no server" state. The placeholder is a purposeful `Loading…`, not an empty string.
- **Present:** both `serverId` and `relayUrl` are required non-empty strings by the `ServerInfoValue` type (both come off the same present arm or neither is written), so the populated row can never render a blank value. **Do not add empty-string guards** — no such failure has been observed, and the upstream record validation (#44) plus the union type make it unreachable (Evidence-Based Fix Selection).

## Testing strategy (vitest, `renderToStaticMarkup` — no jsdom, no new test deps)

The critical constraint: **under `renderToStaticMarkup`, a zustand-v5 `useStore` reads the *initial* store state, so the store-bound container's populated branch is unreachable at server-render** (per the `RepairControl` comment). Therefore the populated/null matrix (AC5) is proven on the **pure view with injected props**, and the container + loader wiring is proven by the SettingsScreen server-render (which reads the initial `null` → loading branch). This is the `ConnectionStatusIndicator` discipline exactly.

**New: `ServerRow.test.tsx`** — server-render the pure `ServerRow` view with injected props (the "seeded/fake store" is the value a seeded `selectServerInfo` would return, passed straight in). Scenarios:
- **Populated** (`{ serverId: 'juhana-mac-2026', relayUrl: 'wss://relay.example' }`): markup contains `juhana-mac-2026` and `wss://relay.example` (both shown); contains the `Server` label; contains `settings__server-status-slot`; does **not** contain the loading placeholder; does **not** contain `aria-label="Connection status"` (AC4).
- **Not-yet-loaded** (`null`): contains the `Server` label and the `Loading…` placeholder; does **not** contain `juhana-mac-2026` or a stale/blank value; contains `settings__server-status-slot`; does **not** contain `aria-label="Connection status"`.
- Keep `ServerRow.test.tsx` on the **pure view with injected props** — never seed the global singleton `serverInfoStore` (a module-global shared across tests; seeding it risks cross-test contamination and, per the SSR rule above, wouldn't even reach the server-rendered container anyway).

**Modified: `SettingsScreen.test.tsx`** — the chrome tests (title, back, Connection header, region marker) stay unchanged. Update the "data-free scaffold" test (lines 29-37): the row is now mounted, so under server-render (initial store = `null`) the tree renders the row's loading branch. Assert:
- The row is wired in: markup contains the `Server` label and the `Loading…` placeholder (proves `ServerRowControl` + `ServerInfoData` mounted in the section-body).
- Still contains `settings__section-body`.
- Does **not** contain `aria-label="Connection status"` (AC4) and **not** contain `juhana-mac-2026` (no seeded value at server-render).
- Remove the now-false `not.toContain('Server')` assertion.

Mounting `ServerInfoData` does not break the server-render: `renderToStaticMarkup` doesn't run effects, and the loader touches `window.pyry` only inside its effect — so no bridge mock is needed (the loader doc guarantees this).

## Open questions

- **Loading-placeholder styling.** `Loading…` as body-small on-surface-variant is the simplest honest placeholder. If a subtler skeleton (e.g. a muted em-dash) reads better against the near-instant resolve, that's polish, not an AC — developer's call within the "no blank-looking values" constraint.
- **`py-10` token mapping.** 10px sits between `--space-2` (8) and `--space-3` (12). Pick per the existing settings.css ±token-mapping convention; the delta is immaterial. Confirm against the Figma node when writing the CSS.

## Acceptance criteria (developer deliverables)

1. The Connection section's Server row (Figma `17:12`) renders the paired server's identity — a "Server" label, `serverId` as the primary identity line, and `relayUrl` as a secondary line beneath it — all read via `useServerInfoStore(selectServerInfo)`, never from the bridge directly.
2. Opening Settings fires the one-shot fetch: `ServerInfoData` (`src/renderer/src/store/serverInfoLoader.ts`) is mounted inside the Settings tree (the `.settings__section-body`) so it runs on Settings-open, not app-launch.
3. Before the fetch resolves (`serverInfo === null`), the row degrades gracefully — the `Loading…` placeholder, no crash, no stale or blank-looking values.
4. The Server row provides an **empty** host slot for the future two-dot indicator (Figma `90:4`) — a class-labelled container, no dots/labels rendered — and the Settings screen contains **no** `aria-label="Connection status"` group in this slice (no #330 coupling).
5. Tests assert both the populated state (id + relay URL shown) and the not-yet-loaded state (`null` → graceful placeholder, no blank-looking values), per the Testing strategy above.
