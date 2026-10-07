# Settings screen — how it works

Part of [Settings screen](settings-screen.md); see that document for what the package does, its edge
cases and its links.


```
src/renderer/src/
├── pairedRoute.ts                        # + 'settings' route, + 'openSettings' nav arm; + 'pairServer' route, + 3 nav arms (#152)
├── PairedShell.tsx                       # + case 'settings', + onOpenSettings threading; + case 'pairServer' (#152); + onUnpaired threading (#1162)
├── applyPairingChange.ts                 # comment-only: the 'unpaired' arm's docblock names its second, conditional caller (#1162)
└── screens/
    ├── channels/ChannelList.tsx          # Sidebar menu Settings item → onOpenSettings
    ├── pairing/PairingScreen.tsx          # reused as-is on the new 'pairServer' route (#152, no edit)
    └── settings/
        ├── SettingsScreen.tsx            # scaffold (#333) + mounts ServerInfoData/ServerRowControl (#334) + Defaults section (#404) + Notifications section (#409) + Thread section + Storage section (#351) + About section (#350) + PairAnotherServerRow (#152) + onUnpaired threading (#1162)
        ├── ServerRow.tsx                 # pure ServerRow view + store-bound ServerRowControl (#334, new) + per-row Unpair action + UnpairPhase (#1162)
        ├── unpairServerAction.ts         # runUnpairServer — pure erase→refresh→maybe-route helper, a SIBLING of unpairAction.ts's runUnpair (#1162, new)
        ├── DefaultWorkspaceRow.tsx       # pure DefaultWorkspaceRowView + store-bound DefaultWorkspaceRowControl + in-file DefaultWorkspacePickerSheet (#404, new)
        ├── PushNotificationRow.tsx       # pure PushNotificationRowView + store-bound PushNotificationRowControl (#409, new)
        ├── CollapseToolUsesRow.tsx       # pure switch view + store-bound Control in Thread
        ├── ArchivedCountRow.tsx          # pure ArchivedCountRow view + store-bound ArchivedCountRowControl (#351, new)
        └── settings.css                 # token-only, scaffold + Server row + Default-workspace row + Notifications row/switch + Storage row + About row + Pair-another-server row + per-row Unpair action styles (#333 + #334 + #404 + #409 + #351 + #350 + #152 + #1162)

src/renderer/src/store/conversationListStore.ts  # + selectArchivedCount selector (#351)
src/renderer/src/store/defaultWorkspaceStore.ts  # #403; read/write seam #404 consumes (documented separately)
src/renderer/src/store/pushNotificationPrefStore.ts  # #408; read/write seam #409 consumes (documented separately)
src/renderer/src/store/collapseToolUsesPrefStore.ts  # shared Thread preference, also read by ConversationScreen
src/renderer/src/store/recentWorkspacesStore.ts + recentWorkspacesBridge.ts  # #382; picker data path #404 mounts while open
src/renderer/src/store/serverInfoLoader.ts       # loadServerInfo now RESOLVES TO the list it wrote, not void (#1162) — the one refresh unpairServerAction.ts reuses

src/renderer/src/version.d.ts             # ambient `declare const __APP_VERSION__: string` (#350, new)
electron.vite.config.ts                   # + __APP_VERSION__ define, renderer block (#350)
vitest.config.ts                          # + __APP_VERSION__ define, mirrored so tests see it (#350)
```

## The route + nav arm (`pairedRoute.ts`)

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

## The second guard (`PairedShell.tsx`)

`PairedShellView` gains a `case 'settings'`, reusing the shared `onBack` and (#152) `onOpenPairServer`
as `onPairAnother`. [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) adds a third prop
to the same case, reusing the shared `onUnpaired` rather than a callback of its own:

```ts
case 'settings':
  return (
    <SettingsScreen
      onBack={props.onBack}
      onPairAnother={props.onOpenPairServer}
      onUnpaired={props.onUnpaired}
    />
  )
```

`props.onUnpaired` is the **same** callback the `thread` case hands `ConversationScreen`, already bound
by the `PairedShell` container to `applyPairingChange(pairingChangeDeps, 'unpaired')` — the shared
clear-then-navigate arm. Both mean exactly "the app's pairing has ended — clear and leave"; the
per-server Unpair action reaches it only when its own erase leaves no record behind (see [The Server
row(s)](#the-server-rows-serverrowtsx-334-widened-to-a-list-by-1148-given-an-unpair-action-by-1162) below), so this case needed no new
nav arm and `applyPairingChange`'s `unpaired` arm needed no behavioural change — only its docblock, now
naming a second, conditional caller.

`PairedShell` (the `useReducer` container) adds `onOpenSettings={() => dispatch({ type: 'openSettings' })}`
beside the existing `onOpen`/`onBack` — no new state, still the one `useReducer(nextPairedRoute, 'list')`
from [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md).

## The entry affordance (`ChannelList.tsx`)

`ChannelList`/`ChannelListView` retain the required `onOpenSettings: () => void` prop, threaded
straight through. The toolbar's `ComposerOptionsMenu` renders Settings then Archive with
`currentId={null}`; selecting id `settings` closes the menu and calls `onOpenSettings` once.
The Sidebar menu trigger stays outside the tree scrollport, with Pair new host at the right.
No `window.pyry` or store mutation participates in this entry: `onOpenSettings` remains a pure
injected navigation effect. The former standalone gear button is removed. See the
[toolbar](channel-list-section-header-pair-control.md) for Figma geometry, keyboard behavior
and consumed outside-click dismissal.

## The scaffold view (`SettingsScreen.tsx`)

A single pure, exported, server-renderable view — no store read, no effects, no `window.pyry`:

```ts
export function SettingsScreen({
  onBack,
  onPairAnother,
  onUnpaired
}: {
  onBack: () => void
  onPairAnother: () => void
  onUnpaired: () => void
}): JSX.Element
```

`onBack` is **required** (unlike `ConversationScreen`'s optional-gated `BackControl` — a Settings
screen always has a back affordance). Structure: root `<section className="settings"
aria-label="Settings screen">` → top-bar (`BackControl` + `<h1>Settings</h1>`) → body → one
`<section className="settings__section">` with `<h2>Connection</h2>` and a
`<div className="settings__section-body">` that mounts `<ServerInfoData />` then
`<ServerRowControl onLastServerUnpaired={onUnpaired} />` ([#334](../codebase/334.md),
[#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)) followed by
`<PairAnotherServerRow onActivate={onPairAnother} />` ([#152](../codebase/152.md), below). Copy strings
live in a client-owned `SETTINGS_COPY` module constant (the `EMPTY_THREAD_COPY` idiom) — never a daemon
string. `SettingsScreen` itself stays a pure, store-free composition point: it reads no store and fires
no effect directly — the store read, the one-shot fetch, and (#1162) the confirm-phase state and erase
all live inside the mounted children; `onPairAnother` and `onUnpaired` are both pure injected callbacks
with no store or effect of their own at this layer.

`onUnpaired` is **required**, for the same reason `onPairAnother` is: a Settings screen that cannot
forget a server is the exact regression the prop exists to prevent, so a call site that forgets to wire
it is a compile error rather than a silently absent Unpair action. It fires on strictly fewer occasions
than its name suggests — see [The Server row(s)](#the-server-rows-serverrowtsx-334-widened-to-a-list-by-1148-given-an-unpair-action-by-1162)
below for when.

## The Pair-another-server row (`SettingsScreen.tsx`, #152)

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

## The Server row(s) (`ServerRow.tsx`, #334, widened to a list by #1148, given an Unpair action by #1162)

Follows the #330 `ConnectionStatusIndicator`/`Control` view/container split, as a dedicated module (its
own test seam) rather than in-file. Five exports as of #1162, of which the first is untouched since
\#334 beyond a new required prop:

```ts
export function ServerRow({ serverInfo, unpair }: { serverInfo: ServerInfoValue | null; unpair: ServerRowUnpair }): JSX.Element
export function ServerRows({ servers, unpair }: { servers: ServerInfoValue[]; unpair: { phase: UnpairPhase } & Omit<ServerRowUnpair, 'phase'> }): JSX.Element   // #1148, widened #1162
export function ServerRowControl({ onLastServerUnpaired }: { onLastServerUnpaired: () => void }): JSX.Element
export type UnpairPhase = { kind: 'idle' } | { kind: 'confirming'; serverId: string } | { kind: 'unpairing'; serverId: string }   // #1162
export interface ServerRowUnpair { phase: 'idle' | 'confirming' | 'unpairing'; onArm: (serverId: string) => void; onCancel: () => void; onConfirm: (serverId: string) => void }   // #1162
```

`ServerRow` is the pure single-row view: always renders the `Server` label; when `serverInfo` is
present, renders `serverId` (primary line) and `relayUrl` (secondary line) as auto-escaped React
children, plus (#1162) a trailing `UnpairAction` as a **sibling** of the text column — the text column
is `flex: 1 1 auto`, so the action lands at the trailing edge with no new layout rule and the row's own
class is untouched (several existing assertions count whole `class="settings__server-row"` attribute
runs, which a second class on the same element would silently defeat). When `serverInfo` is `null`,
renders a single `Loading…` placeholder in its place (never a blank `<p>`) and **no** Unpair action —
the not-yet-loaded row has no `serverId` to name and so nothing to erase. In both states it renders an
**empty** `.settings__server-status-slot` — a class-labelled mount point for \#330's future two-dot
indicator, deliberately carrying no `aria-label="Connection status"` (that marker belongs to #330's
`thread`-view indicator; duplicating it here was flagged as a collision risk during #333).

`ServerRows` (#1148) is the pure exported list view: a non-empty list renders one `<ServerRow>` per
entry, keyed by `serverId` and in the given order; an empty list renders exactly one
`<ServerRow serverInfo={null} />` — the same placeholder byte-for-byte, so nothing paired, nothing
fetched yet, and an unreadable collection all render identically, with no new "no servers" copy string.
Returns a fragment, so each row is a direct child of `.settings__section-body`, already a plain flex
column with per-row padding — N rows stack correctly with `settings.css` untouched. `serverId` is safe
as a React key because `pairedServerStore`'s decode raises `MalformedPairedServerRecordError` on a
repeated `server` id, collapsing the whole collection to the absent arm before it reaches the renderer.

The one-row-per-entry loop lives on this **exported view**, not inside `ServerRowControl`, because the
container's populated branch is unreachable under `renderToStaticMarkup` (zustand v5 reads
`getInitialState()`) and neither e2e tier covers this row — so on the container the only detector left
would be a `vi.mock` of the store module, ceremony `ServerRow.test.tsx` already declined once in favour
of injected props. On `ServerRows`, a multi-entry injection (including the two-row confirm-phase matrix
below) is an ordinary server render.

Mounting `<ServerInfoData />` inside `SettingsScreen`'s section-body is what makes the row(s) work: #340
shipped that loader dormant (zero consumers), so before #334 the store sat empty forever. Because
`SettingsScreen` mounts only under the paired shell's `settings` route (post-pairing, [PairedShell](paired-shell.md)),
a fresh fetch fires every time Settings opens rather than once at app launch.

### The per-row Unpair action (#1162)

Client-owned copy — a `UNPAIR_COPY` module constant beside `SERVER_ROW_LABEL`, apostrophe-free, U+2026
ellipsis: `Unpair`, `Forget this server?`, `Cancel`, `Confirm`, `Forgetting…`. The prompt says "this
server" rather than naming one — `serverId` is daemon-authored text (it arrived off a pairing payload)
and CLAUDE.md forbids it in an attribute, so no button carries an `aria-label`; each button's own text
is its accessible name, and the labels therefore repeat identically across rows. The rendered id line
above the action is what tells rows apart visually — e2e addresses rows by position over the store's
pinned order (oldest-paired first), never by accessible name.

**The confirm state is one value for the whole list, not one per row** (`UnpairPhase`, held in
`ServerRowControl`'s own `useState` — ADR 0006, screen-local, resets on unmount, so leaving and
re-entering Settings lands every row un-armed). A single armed id makes "arming row B leaves row A
un-armed" unrepresentable-by-construction: there is no second slot for a second armed row to live in.
`ServerRows` resolves that one phase against each row's own id (`rowPhase`, an `===` comparison — never
a prefix or `includes`, since the e2e fixture's two ids, `fake-daemon` and `fake-daemon-2`, share a
prefix and a loose match would arm both rows on one click) and hands every other row `'idle'`.

The second, different-fabric half of "a second row's Unpair must never fire the first row's confirmed
erase": `onArm`/`onConfirm` both take the **row's own `serverId`** as an argument, rather than the
container reading an id back out of the phase. The erase always names the row that rendered the button
the operator clicked, so the two cannot disagree by construction.

Three phases, following #166's deleted `UnpairControl` verbatim in shape: idle renders one "Unpair"
button; confirming renders the prompt plus Cancel and Confirm, both enabled; unpairing disables both
(`Confirm` reads "Forgetting…"), so a double-click cannot launch a second erase — belt-and-suspenders,
since `clearServer` is idempotent regardless.

`ServerRowControl`'s click handler dereferences `window.pyry` only inside itself, never at render (the
deleted `UnpairControl`'s own posture, and `Composer.handleSubmit`'s), so the container stays
server-renderable. Confirming a row calls `runUnpairServer` (below) with three effects — `window.pyry.unpairServer`,
a `refreshServers` that re-runs `loadServerInfo` against the **same** store the mount fetch uses, and
`onLastServerUnpaired` — and resets the phase to `idle` once it resolves, whichever way. On the
last-server path the route flips and the whole shell unmounts before that `setState` runs; a `setState`
after unmount is a harmless React 18 no-op, the same posture the deleted control's `ok` branch had.

### `runUnpairServer` (`unpairServerAction.ts`, #1162)

The interaction's whole decision, extracted into one pure, React-free, effects-injected helper —
mirroring `unpairAction.ts`'s `runUnpair` and `composerSend.ts`'s posture — because a server-render
test cannot drive an async click:

```ts
export interface UnpairServerDeps {
  unpairServer: (serverId: string) => Promise<UnpairResult>
  refreshServers: () => Promise<ServerInfoValue[]>
  onLastServerUnpaired: () => void
}

export function runUnpairServer(deps: UnpairServerDeps, serverId: string): Promise<'ok' | 'error'>
```

**A sibling of `runUnpair`, deliberately not a widening of it.** `runUnpair`'s error arm dispatches
`UNPAIR_FAILED_ERROR` into the one app-wide `sessionStore` — harmless from the conversation screen,
where a failed unpair meant the only pairing was in doubt, but wrong from a Settings row: one server's
failed erase would put the whole app into a `failed` session status while the *other* server stays
connected and its conversation is fine. The constraint is met by the **type**, not a rule:
`UnpairServerDeps` carries no `dispatch` member at all, so there is no name in this module through which
a session-store write could be reached — a future edit cannot reintroduce the degradation without first
widening a reviewed interface. [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) later
built on exactly that gap rather than closing it: `unpairAction.ts`'s `UnpairDeps` now `extends
UnpairServerDeps` and adds only `dispatch`, and `runUnpair` **delegates** to `runUnpairServer` instead of
restating its erase→refresh→maybe-flip sequence — passing the wider bag into the narrower parameter type
does not leak `dispatch` into this module's body, since TypeScript gives a callee only what its
parameter type declares. That is also how the composer's Re-pair control moved off the whole-collection
channel this doc used to describe as its remaining caller — see [Unpair channel](unpair-channel.md).

Behaviour, in order: (1) `await deps.unpairServer(serverId)` — a rejected invoke or `{ result: 'error' }`
returns `'error'` having done nothing else, fail-safe by construction and inherited from `runUnpair`: no
refresh, no route flip, no clear on any non-`ok` outcome. (2) On `{ result: 'ok' }`, `await
deps.refreshServers()` — this is what makes the departed row leave without a relaunch, since
`ServerInfoData` is a one-shot mount fetch and `serverInfoStore` is deliberately not one of the thirteen
stores `clearPairingScopedState` wipes. (3) If that refreshed list is **empty**, call
`deps.onLastServerUnpaired()`. A non-empty list means records remain, so the shell stays up and nothing
is cleared.

**One read answers both questions.** #1149 refused to widen `UnpairResult` on purpose (a third member
would answer "is this id paired?" for a compromised renderer) and `clearServer`'s `remaining` is
deliberately not returned, so "do any records remain?" has to come from a read the renderer already
has. Using the *same* `serverInfo` re-read for the row refresh and the route decision means the two can
never disagree about how many servers are left.

**The one collapse this inherits, stated rather than hidden.** `ServerInfo`'s `unavailable` arm covers
*nothing paired* **and** *the collection could not be read*, and `loadServerInfo` additionally maps a
rejected invoke to `[]` — so an empty list here means "no *readable* record remains," not strictly "no
record remains." Both non-empty-but-unreadable cases correctly route to the pairing screen (a malformed
collection already makes `pairingStatus` answer *not paired*); the rejected-invoke case is a mis-route,
but only on a path where the main-process bridge has vanished moments after answering an unpair, and it
self-corrects on relaunch since `pairingStatus` reads disk. Nothing here is logged — no `serverId`, no
error detail, extending `unpairHandler`'s log-free-by-construction property to its first caller.

`loadServerInfo` itself was widened from `Promise<void>` to `Promise<ServerInfoValue[]>` (purely
additive — `ServerInfoData` still `void`s the call and is unaffected) so this could be the *one* refresh
function rather than a near-duplicate of it. The rewrite is not free of a trap: the obvious
`.then(map).catch(() => []).then(write)` reshuffling quietly moves a throw *from the write* into the
caller and breaks the loader's documented "never rejects into the renderer" contract — returning the
value from each of the original two arms (`.then`/`.catch`) keeps the control flow identical to before.

## The Defaults section (`DefaultWorkspaceRow.tsx`, #404)

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

## The Notifications section (`PushNotificationRow.tsx`, #409)

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

`PushNotificationRowView` renders a text column holding the label "Push notifications when an agent
responds" (a module-level `PUSH_TOGGLE_LABEL` constant, the `SERVER_ROW_LABEL` idiom, never a daemon
string) beside a trailing native `<button type="button" role="switch">` (Figma
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

**\#1656 made the label agent-neutral.** Every other Claude-named client string in the app was changed
to name the conversation's agent (Claude or Codex), but this row sits in Settings, which has no open
conversation to read an agent from — so the fix is not a ternary but a rewrite to the agent-neutral
"…when an agent responds". Figma 17:66 still draws the original "claude" wording; the ticket changed
only that one word, ahead of the frame.

`PushNotificationRowControl` reads `usePushNotificationPrefStore(selectPushNotificationsEnabled)`
and hands the boolean straight to the view, wiring `onToggle` to
`pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)` — dereferenced inside the
callback only, never at render (the `DefaultWorkspaceRow` `onChoose` discipline). No `useState`, no
effect, no `window.pyry` — a pure read plus one interaction-time write, and no daemon command: the
preference is entirely client-owned (see [Push-notification preference
store](push-notification-preference-store.md)).

## The Thread section

`SettingsScreen` mounts `CollapseToolUsesRowControl` directly below Notifications
and above Storage, inside the existing `settings__section` / `settings__section-body`
structure with the same `settings__section-header` treatment. The pure
`CollapseToolUsesRowView({ enabled, onToggle })` reuses `settings__notifications-row`,
its text/label classes and `settings__switch` / `settings__switch--on` / knob classes;
there is no separate switch CSS or Mobile modal.

The client-owned constant “Collapse assistant tool uses” supplies both the visible
label and `aria-label`. Its native `<button type="button" role="switch">` reflects
`aria-checked={enabled}` and calls `onToggle(!enabled)` on click; Enter and Space
activate that same native button without custom keyboard handlers. The knob is
decorative (`aria-hidden="true"`).

The control reads `useCollapseToolUsesPrefStore(selectCollapseToolUses)` and invokes
`collapseToolUsesPrefStore.getState().setCollapseToolUses(next)` inside the callback.
The [separate preference store](collapse-tool-uses-preference-store.md) defaults on,
persists off across restarts and feeds `ConversationScreen`'s `Timeline.foldTools`
prop across all hosts and conversations. This is a renderer-only write with no
daemon command. Static tests inject both values into the pure view: changing the
singleton after import cannot prove the off view through server rendering.

The [verifier visual review](https://github.com/pyrycode/pyrycode-desktop/pull/1793#issuecomment-6003905659)
compared all four Settings on/off captures at `08f34a4f` with
[Figma 726:8150](https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=726-8150).
Windows were 800×800 and 1280×800, content viewports 800×773 and 1280×773.
Thread placement, shared typography, spacing and the 52×32 switch matched the
Desktop adaptation. The linked review preserves the evidence independently of
scratch captures; see the [Linux frame-generation requirement](e2e-harness-desktop-isolation.md#desktop-isolation-default-tier-launches).

## The Storage section (`ArchivedCountRow.tsx` + `conversationListStore.ts`, #351)

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

## The About section (`SettingsScreen.tsx`, #350)

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

## CSS (`settings.css`)

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
codebase's tokens.css). No new token or literal introduced. `.settings__server-row-unpair` (#1162) is a
SIBLING of `.settings__server-row-text` inside the row, so the row's own flex geometry places it (the
text column is `flex: 1 1 auto`) with no new layout rule and `flex-shrink: 0` so a long server id or
relay URL cannot compress the buttons. There is no Figma node behind its treatment — #1090 records the
Settings home as an interim decision pending #1070, so `.settings__server-unpair` reuses the
`.settings__pair-another-row` text-button treatment at label-large (transparent, `--radius-full`,
`--color-surface-container-high` hover, `--color-outline` focus-visible outline, `:disabled` at
`opacity: 0.5` so the `unpairing` phase reads as busy rather than broken) and
`.settings__server-unpair--confirm` carries `--color-error` — text-only, since the row is a settings
line rather than a dialog, and a filled button would out-shout every other control on the screen.
`.settings__server-unpair-prompt` reuses the Server row's own secondary-line treatment
(`--text-body-small-*`, `--color-on-surface-variant`) so the confirm question reads as part of the row
it belongs to.

## Data flow

```
ChannelList Sidebar menu → Settings menuitem → ComposerOptionsMenu.onSelect('settings')
  → PairedShell onOpenSettings  = dispatch({ type: 'openSettings' })
  → nextPairedRoute('list', openSettings) = 'settings'
  → PairedShellView route='settings' → <SettingsScreen onBack={dispatch back} onUnpaired={dispatch-bound applyPairingChange('unpaired')} />
    → mounts <ServerInfoData />  → window.pyry.serverInfo() [once]
        → mapServerInfo → setServers → serverInfoStore
    → mounts <ServerRowControl onLastServerUnpaired={onUnpaired} /> → useServerInfoStore(selectServers) → <ServerRows servers=… unpair=… /> → one <ServerRow> per entry
    → mounts <DefaultWorkspaceRowControl /> → useDefaultWorkspaceStore(selectDefaultWorkspace)
        → <DefaultWorkspaceRowView defaultWorkspace=… onActivate={() => setOpen(true)} />
    → mounts <PushNotificationRowControl /> → usePushNotificationPrefStore(selectPushNotificationsEnabled)
        → <PushNotificationRowView enabled=… onToggle={(next) => setPushNotificationsEnabled(next)} />
    → mounts <CollapseToolUsesRowControl /> → useCollapseToolUsesPrefStore(selectCollapseToolUses)
        → <CollapseToolUsesRowView enabled=… onToggle={(next) => setCollapseToolUses(next)} />
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

CollapseToolUsesRowView switch button.onClick (also native Enter/Space)
  → onToggle(!enabled)
    → collapseToolUsesPrefStore.getState().setCollapseToolUses(next) [no daemon command]
      → storage.write(next) [localStorage] then set({ collapseToolUses: next })
    → switch reflects the new value; ConversationScreen passes it to Timeline.foldTools

UnpairAction Confirm.onClick, row names its own serverId (#1162)
  → ServerRowControl.handleConfirm(serverId): setPhase({ kind: 'unpairing', serverId })
    → runUnpairServer({ unpairServer: window.pyry.unpairServer, refreshServers: () => loadServerInfo(...), onLastServerUnpaired }, serverId)
        → window.pyry.unpairServer(serverId)  [#1149's UNPAIR_SERVER_CHANNEL]
        result.result !== 'ok' (or a rejected invoke) → 'error', nothing else runs
        result.result === 'ok'
          → loadServerInfo(window.pyry.serverInfo, serverInfoStore.getState().setServers)  [re-read + rewrite, one call answers both halves below]
              → servers.length > 0  → serverInfoStore holds the survivors → the departed row is gone from ServerRows, shell stays on 'settings'
              → servers.length === 0 → onLastServerUnpaired()  → applyPairingChange(pairingChangeDeps, 'unpaired')
                  → clearPairingScopedState(clearPairingDeps)  [the same thirteen-store clear #531/#757/#779/… built up]
                  → App sets route='pairing'  (the whole PairedShell, Settings included, unmounts)
    → .then(() => setPhase({ kind: 'idle' }))  [a no-op if the shell already unmounted on the last-server path]

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
and [`WorkspacePickerSheetView`](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383) (#383) for its picker —
no new store, wire type, or daemon command; the sole wire traffic is the pre-existing
`requestRecentWorkspaces` fetch, re-fired fresh on every picker open. #409's Notifications section adds
no new data path either: it reads and writes the pre-existing [push-notification preference
store](push-notification-preference-store.md) (#408) directly, with no daemon command and no wire
traffic at all — the entire round trip stays inside the renderer. #351's Storage section adds no new
data path either: it reads the pre-existing [conversation list store](conversation-list-store.md) through
a new selector, and that store is already kept live by the app-level `ConversationListData` bridge. #350's
About section adds no runtime data flow at all — the value is fixed at build time, so there is nothing to
fetch or subscribe to. [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)'s per-row
Unpair action adds no new store and no new IPC channel either — it is the first renderer caller of
[#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149)'s already-shipped
`window.pyry.unpairServer`, and its "does any record remain?" read reuses the same `serverInfo` fetch
\#334 wired in. The one genuinely new wire traffic is that existing `unpairServer` invoke, now finally
called from somewhere.

