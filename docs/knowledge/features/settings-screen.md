# Settings screen (scaffold + Connection + Defaults + Notifications + Storage + About sections)

The paired region's third view — `settings`, a sibling of [`list`](channel-list.md) and
[`thread`](conversation-shell.md) — reachable from a new entry button on the Channel List home. A
top-bar (back + "Settings" title) above five sections: "Connection", whose body renders the paired
server's identity (a Server row showing `serverId` + `relayUrl`, an empty host slot for the future
two-dot status indicator, and a "Pair another server" nav row that switches daemons); "Defaults for new
conversations", whose body renders a Default workspace row showing the client-owned default-workspace
preference and opens a picker to change it; "Notifications", whose body renders a single push-toggle
row reflecting and writing the client-owned push-notification preference; "Storage", whose body renders
a live archived-conversations count; and "About", whose body renders the running app's build version.
Mirrors mobile #390/#398, with the relay URL as a documented desktop addition.

Introduced in [#333](../codebase/333.md) as a chrome-only scaffold (the scaffold child of the #150
split; the other child, #332, shipped the data path: [#339](../codebase/339.md)'s IPC surface +
[#340](../codebase/340.md)'s renderer store). [#334](../codebase/334.md) then filled the scaffold's empty
section-body with the store-bound Server row and mounted #340's previously-dormant loader. [#350](../codebase/350.md)
appended the About section, a static version readout sourced from `package.json` at build time (a #151
split sibling). [#351](../codebase/351.md) then inserted a Storage section between Connection and About,
a live archived-conversations count derived from the existing
[conversation list store](conversation-list-store.md) (another #151 split sibling). [#152](../codebase/152.md)
then added a "Pair another server" row below the Server row that re-opens the existing
[pairing screen](pairing-input-screen.md) as a new [paired-shell](paired-shell.md) sub-route, letting the
user switch which daemon desktop drives without a relaunch — the last open follow-up on the #150 line.
[#404](../codebase/404.md) then inserted a Defaults section between Connection and Storage, holding a
single interactive Default-workspace row that reads and writes the [#403](../codebase/403.md)
default-workspace preference and opens the [#383](../codebase/383.md) recent-workspaces picker to change
it (a #352 split sibling — #352 itself split from the #151 line's Defaults/Push follow-ups). [#409](../codebase/409.md)
then inserted a Notifications section between Defaults and Storage, holding a single push-toggle row
that reads and writes the [#408](../codebase/408.md) push-notification preference — the write half of
the #353 push-toggle split (#353 itself split from the #158 push-notifications line; #408, the data
half, shipped first).
Renderer-only throughout — no keys, sockets, or tokens touched directly (the Server row reads only the
vetted, non-secret `serverId`/`relayUrl` pair off #340's store; the Default-workspace row reads/writes a
renderer-local, non-secret preference and sends no daemon command; the Notifications row reads/writes
another renderer-local, non-secret preference and sends no daemon command either; the Storage row reads
a derived count off the conversation-list store; the About row reads a compile-time constant; the
Pair-another-server row fires pure navigation over the already-vetted pairing IPC surface, #152 security
review PASS) — not security-sensitive except for #152's navigation-only reach into the pairing flow.

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
- Directly below the Server row, a "Pair another server" nav row (label + trailing chevron) opens the
  existing pairing flow in place. Confirming a new pairing overwrites the single stored server record
  and the transport reconnects to the new daemon automatically; cancelling returns to Settings with the
  current server untouched — see [#152](../codebase/152.md).
- Below the Connection section, a "Defaults for new conversations" heading (same `--color-primary`
  treatment) precedes a single interactive "Default workspace" row: a primary label over a secondary
  line showing the current default (the stored path verbatim, or the client-owned "scratch" placeholder
  when none has ever been chosen) and a trailing chevron. Activating it opens the recent-workspaces
  picker; choosing an entry writes the new default and closes the picker — see [#404](../codebase/404.md).
- Below the Defaults section, a "Notifications" heading (same `--color-primary` treatment) precedes a
  single row: the label "Push notifications when claude responds" beside a trailing on/off switch
  reflecting the client-owned push-notification preference. Toggling it writes the negated value back
  through the preference store immediately — see [#409](../codebase/409.md).
- Below the Notifications section, a "Storage" heading (same `--color-primary` treatment) precedes a single
  row reading "Archived conversations" with a secondary line — "N archived" for a loaded list (every N,
  including 0 and 1 — no singular/plural branch) or a neutral "—" placeholder before the conversation list
  has loaded. The count is a live derived read: it updates when an archive/restore round trip re-lists.
- Below the Storage section, an "About" heading (same `--color-primary` treatment) precedes a single
  row reading "Version X.Y.Z" — the running app's `package.json` `version`, baked in at build time.
- Back returns to the channel-home `list` view via the paired router's existing `back` transition — no
  new nav event, no stack-aware back.

## How it works

Additive throughout — no existing route, nav arm, or view is rewritten:

```
src/renderer/src/
├── pairedRoute.ts                        # + 'settings' route, + 'openSettings' nav arm; + 'pairServer' route, + 3 nav arms (#152)
├── PairedShell.tsx                       # + case 'settings', + onOpenSettings threading; + case 'pairServer' (#152)
└── screens/
    ├── channels/ChannelList.tsx          # + SettingsButton entry (in-file, unexported)
    ├── pairing/PairingScreen.tsx          # reused as-is on the new 'pairServer' route (#152, no edit)
    └── settings/
        ├── SettingsScreen.tsx            # scaffold (#333) + mounts ServerInfoData/ServerRowControl (#334) + Defaults section (#404) + Notifications section (#409) + Storage section (#351) + About section (#350) + PairAnotherServerRow (#152)
        ├── ServerRow.tsx                 # pure ServerRow view + store-bound ServerRowControl (#334, new)
        ├── DefaultWorkspaceRow.tsx       # pure DefaultWorkspaceRowView + store-bound DefaultWorkspaceRowControl + in-file DefaultWorkspacePickerSheet (#404, new)
        ├── PushNotificationRow.tsx       # pure PushNotificationRowView + store-bound PushNotificationRowControl (#409, new)
        ├── ArchivedCountRow.tsx          # pure ArchivedCountRow view + store-bound ArchivedCountRowControl (#351, new)
        └── settings.css                 # token-only, scaffold + Server row + Default-workspace row + Notifications row/switch + Storage row + About row + Pair-another-server row styles (#333 + #334 + #404 + #409 + #351 + #350 + #152)

src/renderer/src/store/conversationListStore.ts  # + selectArchivedCount selector (#351)
src/renderer/src/store/defaultWorkspaceStore.ts  # #403; read/write seam #404 consumes (documented separately)
src/renderer/src/store/pushNotificationPrefStore.ts  # #408; read/write seam #409 consumes (documented separately)
src/renderer/src/store/recentWorkspacesStore.ts + recentWorkspacesBridge.ts  # #382; picker data path #404 mounts while open

src/renderer/src/version.d.ts             # ambient `declare const __APP_VERSION__: string` (#350, new)
electron.vite.config.ts                   # + __APP_VERSION__ define, renderer block (#350)
vitest.config.ts                          # + __APP_VERSION__ define, mirrored so tests see it (#350)
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

[#152](../codebase/152.md) later added a fourth route, `'pairServer'`, plus three nav arms:
`openPairServer` (the Settings row → `pairServer`), `pairServerCancelled` (`pairServer` → `settings`,
AC4 non-destructive), and `pairServerPaired` (`pairServer` → `list`, AC3, the new server's home). The
two exits deliberately do **not** reuse the absolute `back` arm even though `back` also currently
resolves to `list`: cancel's destination (`settings`, "return to where I launched pairing from") and a
completed pair's destination (`list`, "go home to the new server") are two different intents that only
coincide with `back` by accident today, and would diverge the moment `back` becomes stack-aware.

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
export function SettingsScreen({
  onBack,
  onPairAnother
}: {
  onBack: () => void
  onPairAnother: () => void
}): JSX.Element
```

`onBack` is **required** (unlike `ConversationScreen`'s optional-gated `BackControl` — a Settings
screen always has a back affordance). Structure: root `<section className="settings"
aria-label="Settings screen">` → top-bar (`BackControl` + `<h1>Settings</h1>`) → body → one
`<section className="settings__section">` with `<h2>Connection</h2>` and a
`<div className="settings__section-body">` that mounts `<ServerInfoData /><ServerRowControl />`
([#334](../codebase/334.md)) followed by `<PairAnotherServerRow onActivate={onPairAnother} />`
([#152](../codebase/152.md), below). Copy strings live in a client-owned `SETTINGS_COPY` module
constant (the `EMPTY_THREAD_COPY` idiom) — never a daemon string. `SettingsScreen` itself stays a pure,
store-free composition point: it reads no store and fires no effect directly — the store read and the
one-shot fetch both live inside the mounted children; `onPairAnother` is a pure injected callback with
no store or effect of its own.

### The Pair-another-server row (`SettingsScreen.tsx`, #152)

An in-file, non-exported control mirroring `BackControl`'s inline-component + inline-SVG posture (not a
dedicated module like `ServerRow.tsx` — it has no populated/null matrix, just a click):

```ts
function PairAnotherServerRow({ onActivate }: { onActivate: () => void }): JSX.Element
// <button type="button" className="settings__pair-another-row" onClick={onActivate}>
//   <span className="settings__pair-another-label">Pair another server</span>
//   <svg aria-hidden="true" …chevron_right…/>
// </button>
```

The row is a native `<button>`, so its visible text is the accessible name (no `aria-label`); the
chevron `<svg>` is `aria-hidden`. Unlike the Server row (#334) and Storage row (#351), which both
**omit** their trailing chevron because they have no detail screen to lead to, this row **keeps** its
chevron — it is a genuine forward-nav affordance, matching Figma `17:21`. Activating it fires
`onPairAnother`, wired by `PairedShellView` to `dispatch({ type: 'openPairServer' })` — see
[Paired shell](paired-shell-pair-server-route.md#the-pairserver-route-152) for what renders next.

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

### The Defaults section (`DefaultWorkspaceRow.tsx`, #404)

Inserted as a `settings__section` **between** Connection and Storage — mirroring how #351 placed Storage
between Connection and About, to preserve the mobile design's relative vertical order (Defaults y=322
above Storage y=910). Unlike every other row in this screen, the row is *interactive*: activating it
opens a picker, so it follows the `PairAnotherServerRow` (#152) idiom — a native `<button>` with a
trailing chevron — rather than the static `ServerRow`/`ArchivedCountRow` idiom:

```ts
export function DefaultWorkspaceRowView({
  defaultWorkspace,
  onActivate
}: { defaultWorkspace: string | null; onActivate: () => void }): JSX.Element

export function DefaultWorkspaceRowControl(): JSX.Element
// useDefaultWorkspaceStore(selectDefaultWorkspace) + useState(open) → <DefaultWorkspaceRowView> + picker
```

`DefaultWorkspaceRowView` renders the primary label "Default workspace" over a secondary line showing
`defaultWorkspace` verbatim, or the client-owned `'scratch'` placeholder constant when `null` (Figma
17:59 — a copy string standing for the daemon's server-side scratch default, not a daemon-sourced
string). No `aria-label`: the button's text content is its accessible name; the trailing chevron SVG is
`aria-hidden`. `defaultWorkspace` is rendered whole and opaque as auto-escaped React children — never
split, basenamed, or filesystem-resolved (the same posture `WorkspacePickerSheet`'s `row.path` uses).

`DefaultWorkspaceRowControl` reads the store and owns the picker's open-state in local `useState` (ADR
0006 — transient UI state, not the store). While open it mounts an in-file, non-exported
`DefaultWorkspacePickerSheet` — the direct analog of [#383](../codebase/383.md)'s own
`WorkspacePickerSheet` container, minus its conversation coupling:

```ts
function DefaultWorkspacePickerSheet({
  activeCwd,
  onClose
}: { activeCwd: string | null; onClose: () => void }): JSX.Element
```

It mounts `<RecentWorkspacesData />` ([#382](../codebase/382.md)) as a sibling of
`<WorkspacePickerSheetView>` ([#383](../codebase/383.md)'s pure view, reused as-is), so each open fires a
fresh `requestRecentWorkspaces` and each close tears the subscription down — "fresh fetch per open" falls
out of React mount/unmount rather than an explicit refetch call. The Escape-to-close `useEffect` is #383's
verbatim. `activeCwd` is passed the current default so the matching picker row carries the built-in
"default" pill. `onChoose` is the sole write path:

```ts
onChoose={(path) => {
  defaultWorkspaceStore.getState().setDefaultWorkspace(path)
  onClose()
}}
```

— dereferencing the store setter only inside the callback, never at render, and firing **no** daemon
command (unlike #383's own container, whose `onChoose` dispatches `change_workspace` against a live
conversation — wrong here, since Settings writes a client preference, not a live conversation's
workspace). `onCreateFolder` is deliberately not supplied: [#398](../codebase/398.md)'s create-folder
dialog is conversation-scoped, so the picker's "Other → Create new folder" entry renders disabled rather
than being wired to a non-conversation folder-creation path (out of scope).

### The Notifications section (`PushNotificationRow.tsx`, #409)

Inserted as a `settings__section` **between** Defaults and Storage — Figma's Notifications section
(header 17:62 at y=610) sits between Defaults (y=322) and Storage (y=910), so this insertion point
preserves that relative order, the same placement discipline #404/#351 used. Unlike the interactive
Default-workspace row, this row has no picker to open — it's a direct on/off control, so it follows
the static `ServerRow`/`ArchivedCountRow` two-part idiom (pure view + store-bound Control) rather than
the `DefaultWorkspaceRow`/`PairAnotherServerRow` button-with-chevron idiom, plus one callback prop
neither of those needs:

```ts
export function PushNotificationRowView({
  enabled,
  onToggle
}: { enabled: boolean; onToggle: (next: boolean) => void }): JSX.Element

export function PushNotificationRowControl(): JSX.Element
// usePushNotificationPrefStore(selectPushNotificationsEnabled) → <PushNotificationRowView>
```

`PushNotificationRowView` renders a text column holding the Figma-verbatim label "Push notifications
when claude responds" (17:66 — a module-level `PUSH_TOGGLE_LABEL` constant, the `SERVER_ROW_LABEL`
idiom, never a daemon string) beside a trailing native `<button type="button" role="switch">` (Figma
17:67 track / 17:68 knob) carrying `aria-checked={enabled}` and a decorative `aria-hidden` knob
child. `onClick={() => onToggle(!enabled)}` is the switch's only interaction wiring — no
`onKeyDown` needed, because a native `<button>` already fires `onClick` on both Space and Enter.
This is the genuine delta from the pre-existing `run-config__switch` in
`RunConfigSections.tsx` — that switch is a `<span role="switch">` wired only to `onClick`, so it is
focusable-but-not-keyboard-operable; this ticket's keyboard AC required real Space/Enter activation,
which a `<span>` cannot give without an `onKeyDown` handler, so the architect spec called for a
native `<button>` here instead of cloning the span verbatim.

Because the switch button is a *sibling* of the label `<p>` (not its parent) and `role="switch"`
computes its accessible name from the author rather than from sibling content, the button also
carries an explicit `aria-label={PUSH_TOGGLE_LABEL}` — the same constant the visible label renders,
so the accessible name can never drift from the visible copy.

`PushNotificationRowControl` reads `usePushNotificationPrefStore(selectPushNotificationsEnabled)`
and hands the boolean straight to the view, wiring `onToggle` to
`pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)` — dereferenced inside the
callback only, never at render (the `DefaultWorkspaceRow` `onChoose` discipline). No `useState`, no
effect, no `window.pyry` — a pure read plus one interaction-time write, and no daemon command: the
preference is entirely client-owned (see [Push-notification preference
store](push-notification-preference-store.md)).

### The Storage section (`ArchivedCountRow.tsx` + `conversationListStore.ts`, #351)

Inserted as a `settings__section` **between** Connection and About — Figma's Storage section sits above
About in the mobile layout (y=910 vs y=1056), and this insertion point preserves that relative order now
that desktop builds both neighbors:

```ts
export const selectArchivedCount = (s: ConversationListState): number | null =>
  s.conversations === null ? null : s.conversations.filter((c) => c.is_archived).length

export function ArchivedCountRow({ archivedCount }: { archivedCount: number | null }): JSX.Element
export function ArchivedCountRowControl(): JSX.Element   // useConversationListStore(selectArchivedCount) → <ArchivedCountRow>
```

The same `ServerRow`/`ServerRowControl` pure-view/store-bound-container split (#334), reading the
[conversation list store](conversation-list-store.md) through a new selector rather than a new store. `ArchivedCountRow` always renders the "Archived conversations" label; the secondary line is
the em-dash placeholder when `archivedCount` is `null` (list not yet loaded — never rendered as "0
archived", since `0` is a real loaded value), else `` `${archivedCount} archived` `` uniformly for every
count including 0 and 1 ("archived" is a past-participle state, not a countable noun, so there is no
singular/plural branch). No trailing chevron, mirroring the Server row's own omission.

Unlike the Server row, **no loader to mount**: the conversation list is already kept live app-level by
`ConversationListData` ([conversation-list store](conversation-list-store.md)), requested on
connect and re-requested on every `conversationUpdated` broadcast (including archive/restore). So
`ArchivedCountRowControl` is a pure store read with nothing to fetch — the count reflects the latest
state on every render, and an archive/restore round trip flows through the existing re-list path into a
fresh count with no new data path added.

### The About section (`SettingsScreen.tsx`, #350)

Appended inline as a second `settings__section`, after Connection — no new component file, since the
version readout has no store and no populated/null matrix (a container/pure-view split would be
over-engineering for a static string):

```ts
const VERSION_LINE = `Version ${__APP_VERSION__}`
```

`__APP_VERSION__` is a compile-time constant substituted by a Vite `define`, fed from `package.json`'s
`version`, present in **both** `electron.vite.config.ts` (drives `npm run dev`/`npm run build`) and
`vitest.config.ts` (drives `npm test` — a separate Vite config, invisible to the electron-vite one, so
without its own copy of the `define` the test throws `ReferenceError: __APP_VERSION__ is not defined` at
transform time rather than a clean assertion miss). Both configs read the version the same way —
`JSON.parse(readFileSync(resolve('package.json'), 'utf-8')).version` — never a JSON import, since
`electron.vite.config.ts` is typechecked by `tsconfig.node.json`, which sets no `resolveJsonModule`
anywhere in the repo. A new ambient `src/renderer/src/version.d.ts` (`declare const __APP_VERSION__:
string`, no import/export) types the global for every renderer module, picked up by `tsconfig.web.json`'s
existing `src/renderer/src/**/*` glob.

This is the deliberate opposite of the Server row above: `serverInfo` is daemon-sourced, async, and
nullable, so it crosses main→renderer over IPC (#339/#340). The version is static, non-secret, and known
at build time, so a compile-time `define` avoids the IPC round-trip and the transport/render split
entirely — no `src/main`, `src/preload`, or `src/shared/ipc` edit.

The Figma's build-hash sub-line (`build a8f3c2d`, node 17-109) is out of scope — desktop has no wired
build-metadata source yet; a follow-up could add it with a second `define` using this same mechanism.

### CSS (`settings.css`)

Token-only, mirroring `channels.css`'s screen-root posture (`height: 100%; overflow-y: auto`, the
direct-child-of-`#root` idiom). The one deliberate deviation from `channels.css`'s section-header
tone: `.settings__section-header` uses `--color-primary` (#9dcbfc), not the muted
`--color-on-surface-variant` `.channel-list__section-header` uses — the M3 settings-section-header
color per Figma. `.settings__back` states its own ~15-line treatment directly (48px square,
`--radius-full`, transparent→`--color-surface-container-high` hover, `--color-outline` focus-visible
outline) rather than sharing a class — an explicit out-of-scope call in the original spec, not an
oversight. It duplicated `.conversation__back` verbatim until
[#1064](conversation-shell-chrome.md#back-control-140-deleted-by-1064) deleted that rule; `.settings__back`
is now the sole statement of the treatment, and three stylesheets' comments were re-pointed at it in the
same ticket. `.settings__storage-row` / `-text` / `-label` / `-count` (#351) and `.settings__about-row` (`--space-3`/
`--space-4` padding) / `.settings__about-version` (`--color-on-surface` + the four `--text-body-large-*`
declarations) mirror the Server row's padding and label type treatment (#350/#351) — each a dedicated
class rather than reusing `.settings__server-row*`, introducing no new token or literal.
`.settings__storage-row-count` additionally sets `overflow-wrap: anywhere` (the Server-row-id-line guard)
since the derived count string has no fixed length. `.settings__pair-another-row` (#152) mirrors
`.settings__back`'s button reset + hover/focus treatment (`--space-3`/`--space-4` padding, transparent→
`--color-surface-container-high` hover, `--color-outline` focus-visible outline);
`.settings__pair-another-label` mirrors the Server-row label's `--text-body-large-*` treatment; the
chevron slot is `flex:0 0 auto`, 20×20, `--color-on-surface-variant` (a muted trailing affordance) — no
new token introduced. `.settings__default-workspace-row` (#404) fuses the two prior idioms: the
`.settings__pair-another-row` button-reset/hover/focus shell (it is also interactive) with the
`.settings__server-row-text`-style two-line column (`-text`/`-label`/`-value`, `-value` carrying the same
`overflow-wrap: anywhere` long-value guard as `-storage-row-count`); its `-chevron` mirrors
`.settings__pair-another-chevron` — again no new token. `.settings__notifications-row` / `-text` /
`-label` (#409) mirror `.settings__storage-row`'s geometry and label typography as their own
dedicated classes (the `.settings__storage-row` / `.settings__about-row` precedent of never sharing
row classes across sections). `.settings__switch` / `--on` / `-knob` (#409) are cloned — not
reused — from `conversation.css`'s `.run-config__switch` family (the client-owned-copy idiom, avoiding
a `settings.css` → conversation-screen selector coupling), adapted from a `<span>` to a `<button>`
with an added button reset; the switch here is always operable (no read-only variant), so
`cursor: pointer` and the `:focus-visible` ring are unconditional, unlike the run-config switch's
`:not([aria-readonly])`-guarded original. Token choices carry over verbatim: off — 52×32 track,
`--color-surface-container-highest` fill, 2px `--color-outline` border, 16px `--color-outline` knob at
`left: 8px`; on — `--color-primary` track+border, knob grown to 24px at `right: 4px`, filled
`--color-surface` (the dark knob substitute, since no `--color-on-primary` token exists in this
codebase's tokens.css). No new token or literal introduced.

### Data flow

```
ChannelList SettingsButton.onClick
  → PairedShell onOpenSettings  = dispatch({ type: 'openSettings' })
  → nextPairedRoute('list', openSettings) = 'settings'
  → PairedShellView route='settings' → <SettingsScreen onBack={dispatch back} />
    → mounts <ServerInfoData />  → window.pyry.serverInfo() [once]
        → mapServerInfo → setServerInfo → serverInfoStore
    → mounts <ServerRowControl /> → useServerInfoStore(selectServerInfo) → <ServerRow serverInfo=… />
    → mounts <DefaultWorkspaceRowControl /> → useDefaultWorkspaceStore(selectDefaultWorkspace)
        → <DefaultWorkspaceRowView defaultWorkspace=… onActivate={() => setOpen(true)} />
    → mounts <PushNotificationRowControl /> → usePushNotificationPrefStore(selectPushNotificationsEnabled)
        → <PushNotificationRowView enabled=… onToggle={(next) => setPushNotificationsEnabled(next)} />
    → mounts <ArchivedCountRowControl /> → useConversationListStore(selectArchivedCount) → <ArchivedCountRow archivedCount=… />
    → renders the About section: `Version ${__APP_VERSION__}` (no fetch, no store — substituted at build time)
    → renders <PairAnotherServerRow onActivate={onPairAnother} />

conversationUpdated (archive/restore) → ConversationListData re-list → setConversations
  → selectArchivedCount recomputes → ArchivedCountRowControl re-renders iff the count itself changed

DefaultWorkspaceRowView.onActivate (#404)
  → DefaultWorkspaceRowControl setOpen(true) → mounts <DefaultWorkspacePickerSheet activeCwd=… onClose=… />
    → mounts <RecentWorkspacesData />  → window.pyry.sendCommand({type:'requestRecentWorkspaces'}) [once per open]
        → recentWorkspacesReceived → setRecentWorkspaces → recentWorkspacesStore
    → renders <WorkspacePickerSheetView workspaces=… activeCwd=… onChoose=… onClose=… />
      row click → onChoose(path)
        → defaultWorkspaceStore.getState().setDefaultWorkspace(path)  [no daemon command]
        → onClose() → setOpen(false) → picker sheet unmounts (RecentWorkspacesData subscription torn down)
      Escape / onClose → setOpen(false) → picker sheet unmounts
    → DefaultWorkspaceRowControl re-renders with the new store value on the next tick

PushNotificationRowView switch button.onClick (#409)
  → onToggle(!enabled)
    → pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)  [no daemon command]
      → storage.write(next) [localStorage, #408] then set({ pushNotificationsEnabled: next })
    → PushNotificationRowControl re-renders with the new store value on the next tick

SettingsScreen BackControl.onClick
  → dispatch({ type: 'back' }) → nextPairedRoute('settings', back) = 'list' → ChannelList

PairAnotherServerRow.onClick (#152)
  → dispatch({ type: 'openPairServer' }) → nextPairedRoute('settings', openPairServer) = 'pairServer'
  → PairedShellView renders <PairingScreen> fresh (editing phase, no bridge — window.pyry default)
    confirm → MAIN: persists the overwriting record → pairingHandler.onPaired → connection.reconnect()
            → RENDERER: onPaired → dispatch({ type: 'pairServerPaired' }) → route 'list' (AC3)
    cancel  → pairing reducer resets (no persist, no reconnect)
            → onCancel → dispatch({ type: 'pairServerCancelled' }) → route 'settings' (AC4)
```

The nav shell (`pairedRoute.ts`/`PairedShell.tsx`) added no store, IPC, wire, or daemon event — that
part is still exactly the screen-local `useReducer` from #333. #334 wires the pre-existing
[server-info store](server-info-store.md) into the tree; the store and its channel are entirely #339/#340's.
\#404's Defaults section reads and writes the pre-existing [default-workspace store](default-workspace-store.md)
(#403) and reuses the pre-existing [recent-workspaces store](recent-workspaces-store.md)/bridge (#382)
and [`WorkspacePickerSheetView`](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) (#383) for its picker —
no new store, wire type, or daemon command; the sole wire traffic is the pre-existing
`requestRecentWorkspaces` fetch, re-fired fresh on every picker open. #409's Notifications section adds
no new data path either: it reads and writes the pre-existing [push-notification preference
store](push-notification-preference-store.md) (#408) directly, with no daemon command and no wire
traffic at all — the entire round trip stays inside the renderer. #351's Storage section adds no new
data path either: it reads the pre-existing [conversation list store](conversation-list-store.md) through
a new selector, and that store is already kept live by the app-level `ConversationListData` bridge. #350's
About section adds no runtime data flow at all — the value is fixed at build time, so there is nothing to
fetch or subscribe to.

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
  has no server-detail screen for it to lead to, so it's omitted rather than rendered dead. The Storage
  row (17:97) omits its own chevron for the same reason — no archive browse screen exists yet (#153/#347).
  The Default-workspace row (#404) is the exception: it **keeps** its chevron, like the Pair-another-server
  row, because it genuinely opens something (the recent-workspaces picker).
- **No client-side way to clear the default back to `null`.** The Default-workspace row's picker only
  ever writes a concrete chosen path via `onChoose`; nothing in the #404 UI calls
  `setDefaultWorkspace(null)`. `null` is reachable today only via a fresh install (no `localStorage` key
  written yet) or by clearing it outside the app. A "reset to scratch" affordance is not in the Figma and
  was out of scope for this ticket.
- **The create-folder picker entry stays inert here.** The Default-workspace row's picker supplies no
  `onCreateFolder`, so the "Other → Create new folder" entry renders disabled — [#398](../codebase/398.md)'s
  `CreateFolderDialog` promotes onto a live conversation, which doesn't exist in the Settings context.
- **The Storage row's `null` vs. `0` distinction is load-bearing and easy to erode.** `conversations:
  null` (not yet loaded) and a loaded `[]` (zero archived) must stay distinct — collapsing them would
  regress the placeholder to a spurious "0 archived" during the brief pre-load window. Any future selector
  added to `conversationListStore` over the same `conversations` slice should preserve this passthrough.
- **The Storage row's populated branch is untestable through `SettingsScreen`'s server-render test** —
  same zustand-v5 gotcha as the Server row: `renderToStaticMarkup` only ever sees the store's initial
  `null`. The count matrix (0/1/5/mixed) is proven on `ArchivedCountRow`'s pure view directly, not through
  the container. The Default-workspace row (#404) has the identical gotcha: under server render
  `defaultWorkspaceStore` hydrates to `null` (its own `typeof window` import guard), so
  `SettingsScreen.test.tsx` only ever exercises the "scratch" placeholder branch — the non-null path
  matrix is proven on `DefaultWorkspaceRowView` directly, and the picker's open/choose interaction isn't
  exercisable under `renderToStaticMarkup` at all (untested reviewed glue, like #383's own container).
  The Notifications row (#409) has the same structural gotcha in the opposite direction: under `node`,
  `pushNotificationPrefStore` always hydrates to the enabled default (its own `typeof window` guard makes
  `storage.read()` return `null`), so a `SettingsScreen`-level render test would only ever see the
  `aria-checked="true"` branch — the full reflect matrix (both states, the `role="switch"` + label +
  native-`<button>` assertions) is proven directly on `PushNotificationRowView` with injected props, not
  through the container, same as the Default-workspace and Storage rows above.
- **No stack-aware back.** `settings` → `back` always lands on `list`; the `pairServer` sub-route added
  by [#152](../codebase/152.md) sidesteps rather than solves this — its two exits are their own explicit
  nav arms (`pairServerCancelled`/`pairServerPaired`), not a reuse of `back`, precisely because a future
  stack-aware `back` from `pairServer` would need to land on `settings`, which is a different resolution
  than the two intents this ticket actually needs. `current` stays in `nextPairedRoute`'s signature for
  exactly this reason — see [paired shell](paired-shell.md).
- **Desktop remains single-server, overwrite semantics after #152.** Confirming a new pairing from
  Settings replaces the one stored record; it is not a multi-server manager. Per-server `.${serverId}`
  keying is a deliberately deferred, separate change (`pairedServerStore.ts`).
- **Marker collision, worth knowing before writing more `PairedShellView` tests.** The `thread` view
  already renders `aria-label="Connection status"` (the two-dot indicator, [#330](../codebase/330.md)),
  and `list` now renders a button with `aria-label="Settings"` — so neither `"Connection"` nor
  `"Settings"` alone discriminates the `settings` view in a `PairedShellView` render test. Use the root
  `aria-label="Settings screen"` (or `class="settings"`) instead — see
  [#333 codebase notes](../codebase/333.md#lessons-learned).
- **Settings entry corner is a free CSS swap.** Top-right sticky was the developer's call against the
  mobile home mock; no Figma node pins it, and the AC only required presence + an accessible name.
- **A `define` added to `electron.vite.config.ts` alone is invisible to `npm test`.** `vitest.config.ts`
  is a separate Vite config; any future compile-time renderer constant needs the same `define` mirrored
  into both, or the render test throws `ReferenceError` at transform rather than failing the assertion
  (#350).
- **The "Version 0.1.0" test assertion is coupled to `package.json`'s current version** and needs a
  one-line update on the next version bump — accepted deliberately since deriving it dynamically in the
  test would need its own JSON import, blocked by the same missing `resolveJsonModule` (#350).
- **No build-hash sub-line.** Desktop has no wired build-metadata source; the Figma's "build a8f3c2d" row
  is deferred to a follow-up.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread ⇄ settings` router
  this screen fills the third arm of.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the new entry button;
  its "Deferred visual elements" note about a future settings gear is now partially resolved by this
  ticket (the entry exists; the top app bar it was originally imagined inside still doesn't).
- [Server-info store](server-info-store.md) / [#340](../codebase/340.md) — the store and loader
  [#334](../codebase/334.md) mounts and reads for the Server row.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the store
  [#351](../codebase/351.md)'s `selectArchivedCount` selector reads, kept live by the same
  `ConversationListData` bridge the Channel List home also depends on.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  the client-owned preference [#404](../codebase/404.md)'s Default-workspace row reads and writes; this
  screen is that store's only UI consumer.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase
  notes](../codebase/408.md) — the client-owned preference [#409](../codebase/409.md)'s Notifications
  row reads and writes; this screen is that store's write consumer (the read consumer, #392, is
  separate — the delivery-side [Push notifications](push-notifications.md) trigger, still open).
- [Conversation shell](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) / [#383 codebase notes](../codebase/383.md)
  — `WorkspacePickerSheetView`, the pure picker view [#404](../codebase/404.md) reuses (not its
  conversation-coupled container).
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) —
  the store + `RecentWorkspacesData` bridge [#404](../codebase/404.md)'s picker sheet mounts while open.
- [#330 codebase notes](../codebase/330.md) — the `ConnectionStatusIndicator`/`Control` view/container
  precedent `ServerRow`/`ServerRowControl` follows, and the `aria-label="Connection status"` marker this
  screen's empty host slot deliberately avoids duplicating.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule
  `PairedShell`'s `useReducer` (and this ticket's added arm) follows.
- [#333 codebase notes](../codebase/333.md) · Spec: `docs/specs/architecture/333-settings-screen-scaffold.md`
- [#334 codebase notes](../codebase/334.md) · Spec: `docs/specs/architecture/334-settings-connection-server-row.md`
  — fills this screen's Connection section-body with the Server row.
- [#350 codebase notes](../codebase/350.md) · Spec: `docs/specs/architecture/350-settings-about-version.md`
  — appends the About section and its version readout; a #151 split sibling of #351/#352/#353.
- [#351 codebase notes](../codebase/351.md) · Spec: `docs/specs/architecture/351-settings-storage-archived-count.md`
  — inserts the Storage section and its archived-count row between Connection and About; a #151 split
  sibling of #350/#352/#353.
- [#152 codebase notes](../codebase/152.md) · Spec: `docs/specs/architecture/152-pair-another-server-from-settings.md`
  — adds the "Pair another server" row and the `pairServer` sub-route it opens; the last open follow-up
  on the #150 line for the Connection section.
- [#403 codebase notes](../codebase/403.md) · Spec: `docs/specs/architecture/403-default-workspace-persist-apply.md`
  — the data half of the Defaults section: the persisted store and its read/write seam, no UI.
- [#404 codebase notes](../codebase/404.md) · Spec: `docs/specs/architecture/404-default-workspace-row.md`
  — inserts the Defaults section and its Default-workspace row between Connection and Storage; a #352
  split sibling of #403 (data half) and #405 (model/effort/YOLO rows, still daemon-blocked).
- [#409 codebase notes](../codebase/409.md) · Spec: `docs/specs/architecture/409-push-toggle-ui.md`
  — inserts the Notifications section and its push-toggle row between Defaults and Storage; the write
  half of the #353 split (data half: [#408](../codebase/408.md)).
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the reused
  `PairingScreen` paste→review→confirm flow #152 re-opens as a paired sub-route.
- Remaining follow-ups: #158 split sibling #392 (the renderer trigger reading [#409](../codebase/409.md)'s
  preference to gate [push notifications](push-notifications.md)), blocked-by the now-merged #353 line
  but not yet built; #352 split sibling #405 (model/effort/YOLO rows of the Defaults section),
  daemon-blocked.
