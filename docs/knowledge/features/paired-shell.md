# Paired shell (list ⇄ thread router)

The second-level router **under** the app shell's `conversation` route: a pure `list` / `thread`
view-state model plus a thin container, mirroring the `appRoute.ts` + `AppView` split the
[app shell](app-shell.md) shipped as. Before this, the `conversation` route dropped straight into a
single [conversation shell](conversation-shell.md) screen with no list and no way back; this is the
inner navigation spine for the paired region. [#333](../codebase/333.md) added the third arm, a
[Settings screen](settings-screen.md); an Archive screen remains a future added arm along the same
seam.

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
}): JSX.Element {
  switch (props.route) {
    case 'list':     return <ChannelList onOpen={props.onOpen} onOpenSettings={props.onOpenSettings} />
    case 'thread':   return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    case 'settings': return <SettingsScreen onBack={props.onBack} />
    default:         return assertNever(props.route)
  }
}
```

Every route renders a real view (no `null` arm, unlike `AppView`'s `pending` case) — the paired region
always has *something* to show. The `settings` case reuses the shared `onBack` unchanged — see
[Settings screen](settings-screen.md) for the scaffold it renders.

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
  reason noted above — a future sub-screen under Settings (e.g. [#152](../codebase/152.md)'s "pair
  another server") is the first candidate that would need a real stack.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — the real `list` view, replacing the placeholder described above
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the third route, `settings`, and its entry button on the Channel List
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the second `open` trigger, fired by a daemon-confirmed conversation create rather than a row click
- [Workspace chip](conversation-shell.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — untouched by this ticket; the store-backed messages that survive navigation
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule `PairedShell`'s `useReducer` follows
- [#140 codebase notes](../codebase/140.md) · Spec: `docs/specs/architecture/140-list-thread-navigation-shell.md`
