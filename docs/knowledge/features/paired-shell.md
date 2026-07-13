# Paired shell (list ⇄ thread router)

The second-level router **under** the app shell's `conversation` route: a pure `list` / `thread`
view-state model plus a thin container, mirroring the `appRoute.ts` + `AppView` split the
[app shell](app-shell.md) shipped as. Before this, the `conversation` route dropped straight into a
single [conversation shell](conversation-shell.md) screen with no list and no way back; this is the
inner navigation spine for the paired region. [#333](../codebase/333.md) added the third arm, a
[Settings screen](settings-screen.md); [#152](../codebase/152.md) added a fourth, `pairServer`, that
re-opens the existing [pairing screen](pairing-input-screen.md) to switch daemons. An Archive screen
remains a future added arm along the same seam.

Introduced in [#140](../codebase/140.md). Renderer-only, pure view-state — no keys, sockets, tokens,
or frames, so not security-sensitive.

## What it does

- The paired region now enters at a **list** view — the [Channel List home screen](channel-list.md)
  (two-tier Channels/Recent discussions, [#141](../codebase/141.md)) — instead of the single
  conversation thread.
- Every row in the list view opens the active conversation into the **thread** view — the existing
  [conversation shell](conversation-shell.md), unchanged. (Per-row opening of a *specific* conversation
  is deferred — see the [Channel List doc](channel-list.md).)
- The thread view shows a leading back affordance (Figma node 16-9's `arrow_back`) that returns to the list.
- Navigation is a three-state spine (`list ⇄ thread`, `list → settings`) since [#333](../codebase/333.md)
  added a `settings` view — a new entry button on the list opens it, and its own back affordance returns
  to `list` via the same absolute `back` transition `thread` already used. A future `archive` view is the
  same shape again: an added `PairedRoute` member and an added `PairedShellView` case, not a rewrite (the
  ticket's extensibility requirement).
- [#152](../codebase/152.md) added a fourth view, `pairServer` — reached from a "Pair another server" row
  inside `settings` — that re-opens the existing pairing screen from inside the paired app. Unlike
  `settings`'s single `back` exit, `pairServer` has **two** distinct exits with their own nav arms:
  cancelling returns to `settings` (the current server stays paired and connected); completing a new
  pairing goes to `list` (the freshly-paired server's channel home). See [Settings
  screen](settings-screen.md#the-pair-another-server-row-settingsscreentsx-152) for the entry row.
- The `open` transition has a second trigger besides a list row click: the [new-discussion
  FAB](new-discussion-fab.md) (#242) fires it asynchronously when the daemon confirms a
  `conversationCreated` event, via `useConversationCreatedNav` mounted in the `PairedShell`
  container. No new route or nav arm — the existing `open` transition is reused as-is.
- That same `conversationCreated` payload — previously discarded after triggering the nav — is now
  also snapshotted into the [active-conversation store](conversation-shell.md#workspace-chip-278) so
  the thread's workspace chip can read its `cwd` ([#278](../codebase/278.md)). Still no new route, nav
  arm, or subscription — one existing callback now does two things instead of one.

## How it works

Two new files, peers of `appRoute.ts` / `App.tsx` (the second-level router, not a screen), plus
additive edits to `App.tsx` and `ConversationScreen.tsx`:

```
src/renderer/src/
├── pairedRoute.ts          # PairedRoute + PairedNav + nextPairedRoute (pure, React-free)
├── pairedRoute.test.ts     # the four transition scenarios
├── PairedShell.tsx         # PairedShellView (pure view) + PairedShell (container)
└── PairedShell.test.tsx    # route→view + enters-at-list
```

### The route model + transition (`pairedRoute.ts`)

```ts
export type PairedRoute = 'list' | 'thread' | 'settings' | 'pairServer'
export type PairedNav =
  | { type: 'open' }
  | { type: 'openSettings' }
  | { type: 'back' }
  | { type: 'openPairServer' }
  | { type: 'pairServerCancelled' }
  | { type: 'pairServerPaired' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':               return 'thread'
    case 'openSettings':       return 'settings'
    case 'back':                return 'list'
    case 'openPairServer':     return 'pairServer'
    case 'pairServerCancelled': return 'settings'
    case 'pairServerPaired':    return 'list'
    default:                    return assertNever(nav)
  }
}
```

The `(state, event) => state` shape `useReducer` wants directly. Every transition is **absolute and
idempotent**: `open` from `thread` stays `thread`; `openSettings` from `settings` stays `settings`;
`back` from `list` (home) stays `list` — there is no stack today. `current` is unreferenced (every arm
ignores it) but is kept in the signature deliberately: a future stack-aware `back` (settings/archive →
list vs. thread → list) becomes an added arm, not a signature rewrite. [#333](../codebase/333.md)
proved this design bet — adding `openSettings` needed zero changes to the `back` arm, since `back` was
already `current`-independent. `noUnusedParameters` is off in both tsconfigs, so this compiles clean; a
one-line comment in the source heads off a review flag. `assertNever(nav)` at the `switch`'s `default`
— the `pairingState.ts` idiom — makes a future nav event without a case a compile error, satisfying
AC1's "exhaustive/compile-checked transition surface."

[#152](../codebase/152.md) added `pairServer` and its three arms. `pairServerCancelled` and
`pairServerPaired` are deliberately **not** a reuse of `back`, even though `back` also resolves to
`list` today: the two pairing exits carry distinct intents (cancel → return to `settings`, where
pairing was launched from; a completed pair → go home to `list`, the new server's channel list), and
only one of those coincides with `back`'s current absolute resolution. Keeping them as their own arms
is forward-safe if `back` ever becomes stack-aware — a stack-aware `back` from `pairServer` would pop to
`settings` (correct for cancel, wrong for a completed pair).

### The pure view + container (`PairedShell.tsx`)

`PairedShellView` is `AppView`'s inner twin — hookless, effectless, a `switch (props.route)` with its
own `assertNever` default:

```ts
export function PairedShellView(props: {
  route: PairedRoute
  onOpen: () => void
  onOpenSettings: () => void
  onBack: () => void
  onUnpaired: () => void
  onOpenPairServer: () => void
  onPairServerPaired: () => void
  onPairServerCancelled: () => void
}): JSX.Element {
  switch (props.route) {
    case 'list':       return <ChannelList onOpen={props.onOpen} onOpenSettings={props.onOpenSettings} />
    case 'thread':     return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    case 'settings':   return <SettingsScreen onBack={props.onBack} onPairAnother={props.onOpenPairServer} />
    case 'pairServer': return <PairingScreen onPaired={props.onPairServerPaired} onCancel={props.onPairServerCancelled} />
    default:           return assertNever(props.route)
  }
}
```

Every route renders a real view (no `null` arm, unlike `AppView`'s `pending` case) — the paired region
always has *something* to show. The `settings` case reuses the shared `onBack` unchanged — see
[Settings screen](settings-screen.md) for the scaffold it renders.

### The `pairServer` route (#152)

The `pairServer` case renders the pre-existing `PairingScreen` ([#55](../codebase/55.md)) with **no**
`bridge` prop, so it falls back to its production `window.pyry` default — the same posture the app-shell
`pairing` route already uses. `PairingScreen` derefs `window.pyry` at render time (not in an effect), so
any test that server-renders the `pairServer` route needs a `globalThis.window = { pyry: {} }` stub, the
same one `App.test.tsx` already carries for its own `pairing` route. Unlike `thread`/`settings`, which
share `onBack`, `pairServer` binds to two distinct callbacks — `onPairServerPaired` and
`onPairServerCancelled` — because its two exits land on different routes (see above). `PairingScreen`
mounts fresh on every entry to `pairServer` (its own `useReducer(pairingReducer, initialPairingState)`)
and unmounts on every exit, so it always opens at an empty paste screen — no stale paste survives a route
change.

`case 'list'` originally rendered an in-file `PlaceholderList` throwaway (a bare `Open conversation`
button); [#141](../codebase/141.md) replaced it wholesale with the real
[Channel List home screen](channel-list.md) — see that doc for the store it reads and its row/section
behavior. Every row's `onClick` still opens the single active conversation (the placeholder's one
affordance, preserved), since per-conversation selection needs a transport path that doesn't exist yet.

`PairedShell` is the container — the only new state owner:

```ts
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  const setActiveConversation = useActiveConversationStore((s) => s.setActiveConversation)
  useConversationCreatedNav((created) => {   // #242, widened #278
    setActiveConversation(created)            // #278 — snapshot cwd for the workspace chip
    dispatch({ type: 'open' })
  })
  return (
    <PairedShellView
      route={route}
      onOpen={() => dispatch({ type: 'open' })}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onBack={() => dispatch({ type: 'back' })}
      onUnpaired={onUnpaired}
      onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
      onPairServerPaired={() => dispatch({ type: 'pairServerPaired' })}
      onPairServerCancelled={() => dispatch({ type: 'pairServerCancelled' })}
    />
  )
}
```

`useReducer(nextPairedRoute, 'list')` is screen-local ephemeral state per
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — resets on remount, never
the session store (AC5). Enters at `'list'` (AC2). `onUnpaired` threads straight through to
`ConversationScreen` unchanged ([#166](../codebase/166.md)); `PairedShell` does not intercept it.
[`useConversationCreatedNav`](new-discussion-fab.md) (#242) is the one added line: it subscribes to
the daemon's `conversationCreated` event and dispatches the same `open` transition the list rows
use, so a FAB-initiated create eventually opens the thread with no new route. `PairedShell` itself
still has no effects and no `window` deref — the hook's own effect is where `window.pyry` is
dereferenced — so the container stays server-renderable and `App`'s `pending`/`pairing`
neutral-first-paint invariant is untouched (`PairedShell` only mounts once the app-level route is
`conversation`).

**[#278](../codebase/278.md) widened the callback**, not the hook: `useConversationCreatedNav` already
delivered the decoded `created: ConversationCreatedPayload` argument, and the callback used to ignore
it (`() => dispatch(...)`). It now also calls `setActiveConversation(created)` — a store setter read via
`useActiveConversationStore`, the `Composer`/`UnpairControl` store-write idiom — before dispatching the
same `open` transition. No new subscription: this is the one existing `conversation_created` listener
PairedShell already mounted, doing one more thing on the event it already receives. See [Workspace
chip](conversation-shell.md#workspace-chip-278) for the store and the render it feeds.

### The app-shell seam (`App.tsx`)

The `conversation` case in `AppView` swaps its direct `<ConversationScreen>` render for
`<PairedShell>` — see [App shell § the pure view](app-shell.md#the-pure-view-appview-exported-from-apptsx).
Everything else in the app shell (`pending`/`pairing`, the launch query, `onPaired`/`onUnpaired`) is
unchanged; `PairedShell` nests *under* the `conversation` route, not beside it.

### The thread's back affordance (`ConversationScreen.tsx`)

`ConversationScreenProps` gained `onBack?: () => void` — the exact `onUnpaired?` precedent
([#166](../codebase/166.md)): optional and gated, so a bare `<ConversationScreen />` (no shell, no
`onBack`) keeps today's DOM output identical, satisfying AC3 ("no behavioral change" to the existing
screen). An in-file `BackControl({ onBack })` mirrors the `UnpairControl` idiom, returning `null` when
`onBack` is absent and, when present, an icon-only 48px `<button aria-label="Back">` holding a 24px
inline `arrow_back` SVG glyph (Figma node 16-11, `on-surface` color — the `.composer__send` inline-SVG
precedent, no remote asset fetch). Rendered as the **first child** of `.conversation`, before the
existing `UnpairControl` header row — the leading edge, matching Figma's top-app-bar placement. The
back arrow and the unpair header are two separate rows for now (a future top-app-bar ticket
consolidates back + title + overflow + unpair into one bar per Figma 16-9); a deliberate, spec-sanctioned
interim, not an oversight.

### Data flow

```
AppView (route='conversation')
  └─ PairedShell            useReducer(nextPairedRoute, 'list')  ← nav state (ADR 0006)
       │                    useConversationCreatedNav((created) => {
       │                      setActiveConversation(created)       ← #278, into activeConversationStore
       │                      dispatch({type:'open'})              ← #242
       │                    })
       └─ PairedShellView   route='list'     → ChannelList (store-backed) — any row → dispatch{open}
                                                new-discussion FAB → createConversation command (#242)
                                                SettingsButton → dispatch{openSettings} (#333)
                            route='thread'   → ConversationScreen (store-backed) + BackControl — [←] → dispatch{back}
                                                → WorkspaceChip reads activeConversationStore (#278)
                            route='settings' → SettingsScreen (pure, no store) + BackControl — [←] → dispatch{back} (#333)
                                                PairAnotherServerRow → dispatch{openPairServer} (#152)
                            route='pairServer' → PairingScreen (window.pyry default) — (#152)
                                                onCancel → dispatch{pairServerCancelled} → 'settings'
                                                onPaired → dispatch{pairServerPaired} → 'list'
```

A `conversationCreated` daemon event reaches `dispatch({ type: 'open' })` independently of any row
click — see [the new-discussion FAB](new-discussion-fab.md) for the bridge that fires it.

`sessionStore` (module-singleton, app-lifetime) holds the messages, independent of this nav state.
Navigating list→thread→list→thread unmounts/remounts `ConversationScreen`, which re-reads the store on
each mount — so store-backed messages stay intact across navigation (AC4). Only `ConversationScreen`'s
own ephemeral UI state (composer draft, sheet-open, unpair phase) resets on remount, same as any other
`useState`/`useReducer` component state — expected under ADR 0006, and not a regression (there was no
navigation, and hence no remount, before this ticket).

## Edge cases and limitations

- **No `conversationId` on the route today.** A bare `'list' | 'thread'` spine is sufficient because
  there is exactly one active conversation in `sessionStore`. When a future select-and-load ticket
  (or [#142](https://github.com/pyrycode/pyrycode-desktop/issues/142)) adds per-conversation selection, `{ type: 'open' }` grows a payload
  (`{ type: 'open'; conversationId }`) and `'thread'` may carry the id — an added field on the sealed
  event, caught by the same `assertNever` surface. Deliberately deferred, not an oversight.
- **The click-driven open→thread→back transition is not DOM-tested.** The codebase has no DOM harness
  (`renderToStaticMarkup` only); the wiring is proven by composing the tested `nextPairedRoute` reducer
  with the tested `PairedShellView` route→view mapping, the same gap `App.test.tsx` accepts for
  `onPaired`→`setRoute`.
- **Back-arrow vs. unpair-header coexistence** is transitional chrome, not the final top app bar — see
  above.
- **`settings`'s back is not stack-aware**, same as `thread`'s: it always lands on `list`, regardless of
  which route dispatched `back`. `current` stays unreferenced in `nextPairedRoute` for exactly the
  reason noted above.
- **`pairServer` sidesteps the stack-aware-back gap rather than closing it.** [#152](../codebase/152.md)
  gave its two exits their own explicit nav arms instead of extending `back` with stack awareness — a
  smaller, sufficient fix for this one sub-screen. A future sub-screen under Settings still can't lean on
  a general "return to origin" `back`; it would need the same one-arm-per-exit treatment, or a real stack,
  whichever comes first.
- **`pairServer`'s render test needs a `window` stub.** `PairingScreen` derefs `window.pyry` at render
  time; server-rendering `<PairedShellView route="pairServer" …/>` in the `node` vitest env throws
  without `globalThis.window = { pyry: {} }` (`beforeEach`/`afterEach`), the same stub `App.test.tsx`
  uses for its `pairing` route.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — the real `list` view, replacing the placeholder described above
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the third route, `settings`, and its entry button on the Channel List
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the fourth route, `pairServer` (#152), reuses this screen as-is
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the second `open` trigger, fired by a daemon-confirmed conversation create rather than a row click
- [Workspace chip](conversation-shell.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — untouched by this ticket; the store-backed messages that survive navigation
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule `PairedShell`'s `useReducer` follows
- [#140 codebase notes](../codebase/140.md) · Spec: `docs/specs/architecture/140-list-thread-navigation-shell.md`
- [#152 codebase notes](../codebase/152.md) · Spec: `docs/specs/architecture/152-pair-another-server-from-settings.md`
  — adds the `pairServer` route and its two dedicated exit arms.
