# Paired shell (list ⇄ thread router)

The second-level router **under** the app shell's `conversation` route: a pure `list` / `thread`
view-state model plus a thin container, mirroring the `appRoute.ts` + `AppView` split the
[app shell](app-shell.md) shipped as. Before this, the `conversation` route dropped straight into a
single [conversation shell](conversation-shell.md) screen with no list and no way back; this is the
inner navigation spine for the paired region, extensible to the Settings and Archive screens that
attach to it later.

Introduced in [#140](../codebase/140.md). Renderer-only, pure view-state — no keys, sockets, tokens,
or frames, so not security-sensitive.

## What it does

- The paired region now enters at a **list** view (a throwaway placeholder, [#141](https://github.com/pyrycode/pyrycode-desktop/issues/141) replaces it) instead of the single conversation thread.
- The list view's one affordance (`Open conversation`) opens the active conversation into the **thread** view — the existing [conversation shell](conversation-shell.md), unchanged.
- The thread view shows a leading back affordance (Figma node 16-9's `arrow_back`) that returns to the list.
- Navigation is a two-state spine (`list ⇄ thread`) today; a future `settings`/`archive` view is an added `PairedRoute` member and an added `PairedShellView` case, not a rewrite (the ticket's extensibility requirement).

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
export type PairedRoute = 'list' | 'thread'
export type PairedNav = { type: 'open' } | { type: 'back' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open': return 'thread'
    case 'back': return 'list'
    default:     return assertNever(nav)
  }
}
```

The `(state, event) => state` shape `useReducer` wants directly. Both transitions are **absolute and
idempotent**: `open` from `thread` stays `thread`; `back` from `list` (home) stays `list` — there is no
stack today. `current` is unreferenced (both arms ignore it) but is kept in the signature deliberately:
a future stack-aware `back` (settings/archive → list vs. thread → list) becomes an added arm, not a
signature rewrite. `noUnusedParameters` is off in both tsconfigs, so this compiles clean; a one-line
comment in the source heads off a review flag. `assertNever(nav)` at the `switch`'s `default` — the
`pairingState.ts` idiom — makes a future nav event (e.g. `openSettings`) without a case a compile
error, satisfying AC1's "exhaustive/compile-checked transition surface."

### The pure view + container (`PairedShell.tsx`)

`PairedShellView` is `AppView`'s inner twin — hookless, effectless, a `switch (props.route)` with its
own `assertNever` default:

```ts
export function PairedShellView(props: {
  route: PairedRoute
  onOpen: () => void
  onBack: () => void
  onUnpaired: () => void
}): JSX.Element {
  switch (props.route) {
    case 'list':   return <PlaceholderList onOpen={props.onOpen} />
    case 'thread': return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    default:       return assertNever(props.route)
  }
}
```

Both routes render a real view (no `null` arm, unlike `AppView`'s `pending` case) — the paired region
always has *something* to show.

`PlaceholderList` is an **in-file, unexported, throwaway** stand-in: a `.paired-list-placeholder` div
holding a bare `<button onClick={onOpen}>Open conversation</button>`. No list visuals were built —
out of scope per the ticket; [#141](https://github.com/pyrycode/pyrycode-desktop/issues/141) replaces
the whole view. Its one affordance keeps today's send/stream round-trip reachable (AC2 — no regression
from the direct-to-thread landing the app had before this ticket), since the single active conversation
already lives in the [session store](session-store.md).

`PairedShell` is the container — the only new state owner:

```ts
export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  return (
    <PairedShellView
      route={route}
      onOpen={() => dispatch({ type: 'open' })}
      onBack={() => dispatch({ type: 'back' })}
      onUnpaired={onUnpaired}
    />
  )
}
```

`useReducer(nextPairedRoute, 'list')` is screen-local ephemeral state per
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — resets on remount, never
the session store (AC5). Enters at `'list'` (AC2). `onUnpaired` threads straight through to
`ConversationScreen` unchanged ([#166](../codebase/166.md)); `PairedShell` does not intercept it. No
effects, no `window` deref — server-renderable, so `App`'s `pending`/`pairing` neutral-first-paint
invariant is untouched (`PairedShell` only mounts once the app-level route is `conversation`).

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
       └─ PairedShellView   route='list'   → PlaceholderList — [Open conversation] → dispatch{open}
                            route='thread' → ConversationScreen (store-backed) + BackControl — [←] → dispatch{back}
```

`sessionStore` (module-singleton, app-lifetime) holds the messages, independent of this nav state.
Navigating list→thread→list→thread unmounts/remounts `ConversationScreen`, which re-reads the store on
each mount — so store-backed messages stay intact across navigation (AC4). Only `ConversationScreen`'s
own ephemeral UI state (composer draft, sheet-open, unpair phase) resets on remount, same as any other
`useState`/`useReducer` component state — expected under ADR 0006, and not a regression (there was no
navigation, and hence no remount, before this ticket).

## Edge cases and limitations

- **No `conversationId` on the route today.** A bare `'list' | 'thread'` spine is sufficient because
  there is exactly one active conversation in `sessionStore`. When [#141](https://github.com/pyrycode/pyrycode-desktop/issues/141)/[#142](https://github.com/pyrycode/pyrycode-desktop/issues/142) add per-conversation selection, `{ type: 'open' }` grows a payload
  (`{ type: 'open'; conversationId }`) and `'thread'` may carry the id — an added field on the sealed
  event, caught by the same `assertNever` surface. Deliberately deferred, not an oversight.
- **The click-driven open→thread→back transition is not DOM-tested.** The codebase has no DOM harness
  (`renderToStaticMarkup` only); the wiring is proven by composing the tested `nextPairedRoute` reducer
  with the tested `PairedShellView` route→view mapping, the same gap `App.test.tsx` accepts for
  `onPaired`→`setRoute`.
- **Back-arrow vs. unpair-header coexistence** is transitional chrome, not the final top app bar — see
  above.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — untouched by this ticket; the store-backed messages that survive navigation
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule `PairedShell`'s `useReducer` follows
- [#140 codebase notes](../codebase/140.md) · Spec: `docs/specs/architecture/140-list-thread-navigation-shell.md`
