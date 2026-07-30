# Paired shell (list ⇄ thread router)

The second-level router **under** the app shell's `conversation` route: a pure `list` / `thread`
view-state model plus a thin container, mirroring the `appRoute.ts` + `AppView` split the
[app shell](app-shell.md) shipped as. Before this, the `conversation` route dropped straight into a
single [conversation shell](conversation-shell.md) screen with no list and no way back; this is the
inner navigation spine for the paired region. [#333](../codebase/333.md) added the third arm, a
[Settings screen](settings-screen.md); [#152](../codebase/152.md) added a fourth, `pairServer`, that
re-opens the existing [pairing screen](pairing-input-screen.md) to switch daemons; [#347](../codebase/347.md)
added a fifth, the [Archive screen](archive-screen.md) scaffold, a chrome-only view reachable from the
Channel List home whose tab bodies [#348](../codebase/348.md) still needs to fill.

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
- Navigation is a growing spine (`list ⇄ thread`, `list → settings`) since [#333](../codebase/333.md)
  added a `settings` view — a new entry button on the list opens it, and its own back affordance returns
  to `list` via the same absolute `back` transition `thread` already used.
- [#152](../codebase/152.md) added a fourth view, `pairServer` — reached from a "Pair another server" row
  inside `settings` — that re-opens the existing pairing screen from inside the paired app. Unlike
  `settings`'s single `back` exit, `pairServer` has **two** distinct exits with their own nav arms:
  cancelling returns to `settings` (the current server stays paired and connected); completing a new
  pairing goes to `list` (the freshly-paired server's channel home). See [Settings
  screen](settings-screen.md#the-pair-another-server-row-settingsscreentsx-152) for the entry row.
- [#347](../codebase/347.md) added a fifth view, `archive` — reached from a second entry button on the
  list, sharing the same top-right cluster as the Settings entry — that shows a back header plus a
  two-tab segmented header (Channels/Discussions) with both tab bodies still empty. Its back affordance
  reuses the existing absolute `back` transition unchanged, the same economy `settings` first proved:
  adding a route needs no matching new `back` case when `back` never inspects `current`. See the
  [Archive screen](archive-screen.md) doc for the scaffold's own contract.
- The `open` transition has a second trigger besides a list row click: the [new-discussion
  FAB](new-discussion-fab.md) (#242) fires it asynchronously when the daemon confirms a
  `conversationCreated` event, via `useConversationCreatedNav` mounted in the `PairedShell`
  container. No new route or nav arm — the existing `open` transition is reused as-is.
- [#393](../codebase/393.md) added a **third** trigger: clicking a fired [push
  notification](push-notifications.md) (main-process, not daemon-relayed). A sibling hook,
  `useNotificationActivatedNav`, is mounted beside `useConversationCreatedNav` and dispatches the same
  `open` transition on a nullary `notificationActivated` `DaemonEvent`. Because `open` is already
  absolute (any route → `thread`), this lands on the thread view regardless of which paired view —
  list, settings, or archive — was showing when the notification fired, with no new route or arm.
  Unlike the FAB trigger, it does **not** call `setActiveConversation` — the click carries no
  conversation payload, and in the single-active-conversation model "open" already means "show the
  existing active conversation's thread."
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
export type PairedRoute = 'list' | 'thread' | 'settings' | 'pairServer' | 'archive'
export type PairedNav =
  | { type: 'open' }
  | { type: 'openSettings' }
  | { type: 'openArchive' }
  | { type: 'back' }
  | { type: 'openPairServer' }
  | { type: 'pairServerCancelled' }
  | { type: 'pairServerPaired' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':                return 'thread'
    case 'openSettings':        return 'settings'
    case 'openArchive':         return 'archive'
    case 'back':                 return 'list'
    case 'openPairServer':      return 'pairServer'
    case 'pairServerCancelled': return 'settings'
    case 'pairServerPaired':    return 'list'
    default:                     return assertNever(nav)
  }
}
```

The `(state, event) => state` shape `useReducer` wants directly. Every transition is **absolute and
idempotent**: `open` from `thread` stays `thread`; `openSettings` from `settings` stays `settings`;
`back` from `list` (home) stays `list` — there is no stack today. `current` is unreferenced (every arm
ignores it) but is kept in the signature deliberately: a future stack-aware `back` (settings/archive →
list vs. thread → list) becomes an added arm, not a signature rewrite. [#333](../codebase/333.md)
proved this design bet — adding `openSettings` needed zero changes to the `back` arm, since `back` was
already `current`-independent; [#347](../codebase/347.md) cashed the same bet a second time for
`openArchive`. `noUnusedParameters` is off in both tsconfigs, so this compiles clean; a
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
  onOpenArchive: () => void
  onBack: () => void
  onUnpaired: () => void
  onOpenPairServer: () => void
  onPairServerPaired: () => void
  onPairServerCancelled: () => void
}): JSX.Element {
  switch (props.route) {
    case 'list':       return <ChannelList onOpen={props.onOpen} onOpenSettings={props.onOpenSettings} onOpenArchive={props.onOpenArchive} />
    case 'thread':     return <ConversationScreen onUnpaired={props.onUnpaired} onBack={props.onBack} />
    case 'settings':   return <SettingsScreen onBack={props.onBack} onPairAnother={props.onOpenPairServer} />
    case 'pairServer': return <PairingScreen onPaired={props.onPairServerPaired} onCancel={props.onPairServerCancelled} />
    case 'archive':    return <ArchiveScreen onBack={props.onBack} />
    default:           return assertNever(props.route)
  }
}
```

Every route renders a real view (no `null` arm, unlike `AppView`'s `pending` case) — the paired region
always has *something* to show. The `settings` and `archive` cases both reuse the shared `onBack`
unchanged — see [Settings screen](settings-screen.md) and [Archive screen](archive-screen.md) for the
scaffolds they render.

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
// #530: the store wiring for the conversation-switch clear, module-scope — each effect reaches its
// singleton via getState() inside the arrow body, so nothing is read during render.
const activateDeps: ActivateConversationDeps = {
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  setActiveConversation: (conversation) =>
    activeConversationStore.getState().setActiveConversation(conversation),
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearSessionId: () => sessionIdStore.getState().clearSessionId()
}

export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  useConversationCreatedNav((created) => {   // #242, widened #278
    activateConversation(activateDeps, created)   // #530 — clear-then-set, see below
    dispatch({ type: 'open' })
  })
  useNotificationActivatedNav(() => dispatch({ type: 'open' }))   // #393 — no setActiveConversation
  return (
    <PairedShellView
      route={route}
      onOpen={(conversation) => {
        activateConversation(activateDeps, conversation)   // #530 — clear-then-set, see below
        dispatch({ type: 'open' })
      }}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onOpenArchive={() => dispatch({ type: 'openArchive' })}
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
use, so a FAB-initiated create eventually opens the thread with no new route. `useNotificationActivatedNav`
([#393](../codebase/393.md), see [Push notifications](push-notifications.md#clicking-the-notification-393))
is a second, sibling hook mounted the same way, over a different (main-local, nullary)
`notificationActivated` event — its callback dispatches `open` only, with no
`setActiveConversation` call, since a notification click carries no conversation payload. `PairedShell`
itself still has no effects and no `window` deref — each hook's own effect is where `window.pyry` is
dereferenced — so the container stays server-renderable and `App`'s `pending`/`pairing`
neutral-first-paint invariant is untouched (`PairedShell` only mounts once the app-level route is
`conversation`).

**[#278](../codebase/278.md) widened the callback**, not the hook: `useConversationCreatedNav` already
delivered the decoded `created: ConversationCreatedPayload` argument, and the callback used to ignore
it (`() => dispatch(...)`). It now also records `created` before dispatching the same `open` transition.
No new subscription: this is the one existing `conversation_created` listener PairedShell already
mounted, doing one more thing on the event it already receives. See [Workspace
chip](conversation-shell.md#workspace-chip-278) for the store and the render it feeds.

**[#530](../codebase/530.md) replaced the direct `setActiveConversation(created)` call** — and the
matching one in `onOpen` above — with `activateConversation(activateDeps, …)`. Both nav sites used to
write `activeConversationStore` unconditionally and nothing else, so opening conversation B rendered
A's rows with B's stream appended, and a Run configuration write made while looking at B could still
address A's daemon session. `activateConversation` reads the previous active conversation through
`activateDeps.getActiveConversation` — a **getter**, not a value closed over at render time, because
`useConversationCreatedNav`'s callback ref only refreshes in a bare effect *after* commit, and two
`conversationCreated` events landing before that effect runs would otherwise both compare against the
same stale previous. Only when the id actually changes does it dispatch the timeline's `reset`
([#528](../codebase/528.md)) and `clearSessionId()` ([#529](../codebase/529.md)) before recording the
new conversation; a re-open of the already-active conversation (a re-click, or `onOpen` firing again for
a row that's already open) clears nothing. The notification-activated `open` (#393, below) still calls
neither `setActiveConversation` nor `activateConversation` — it carries no conversation, so there is no
call site to route through the helper. `activateDeps` is a module-scope object reaching each store via
`getState()` inside its arrow bodies (the `timelineBridge.ts`/`sessionIdBridge.ts` idiom), which is what
lets `PairedShell` drop `useActiveConversationStore` entirely — it now holds **zero** store
subscriptions and re-renders only on its own `useReducer` nav dispatch. See [#530 codebase
notes](../codebase/530.md) for the full design rationale (the getter, the id-not-event gate, why
`clearActiveConversation` stays out of this path).

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
       │                      activateConversation(activateDeps, created)   ← #530, see below
       │                      dispatch({type:'open'})              ← #242
       │                    })
       │                    useNotificationActivatedNav(() => dispatch({type:'open'}))  ← #393, no activateConversation
       └─ PairedShellView   route='list'     → ChannelList (store-backed) — any row → onOpen(conversation):
                                                  activateConversation(activateDeps, conversation) ← #530
                                                  dispatch{open}                                    ← #448
                                                new-discussion FAB → createConversation command (#242)
                                                SettingsButton → dispatch{openSettings} (#333)
                                                ArchiveButton → dispatch{openArchive} (#347)
                            route='thread'   → ConversationScreen (store-backed) + BackControl — [←] → dispatch{back}
                                                → WorkspaceChip reads activeConversationStore (#278)

  activateConversation(activateDeps, conversation):  ← #530 (src/renderer/src/activateConversation.ts)
    previous = activateDeps.getActiveConversation()
    if previous?.id !== conversation.id:
      activateDeps.dispatchTimeline({type:'reset'})   ← #528, clears timelineStore
      activateDeps.clearSessionId()                    ← #529, clears sessionIdStore
    activateDeps.setActiveConversation(conversation)    ← unconditional, both branches
                            route='settings' → SettingsScreen (pure, no store) + BackControl — [←] → dispatch{back} (#333)
                                                PairAnotherServerRow → dispatch{openPairServer} (#152)
                            route='pairServer' → PairingScreen (window.pyry default) — (#152)
                                                onCancel → dispatch{pairServerCancelled} → 'settings'
                                                onPaired → dispatch{pairServerPaired} → 'list'
                            route='archive'  → ArchiveScreen (pure, no store) + BackControl — [←] → dispatch{back} (#347)
                                                tabs: useState<ArchiveTab> screen-local, both bodies empty (#348 mount point)
```

A `conversationCreated` daemon event reaches `dispatch({ type: 'open' })` independently of any row
click — see [the new-discussion FAB](new-discussion-fab.md) for the bridge that fires it. A clicked
push notification reaches the same `dispatch({ type: 'open' })` the same way, independently of both —
see [Push notifications](push-notifications.md#clicking-the-notification-393) for that bridge.

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
- **`settings`'s and `archive`'s back are not stack-aware**, same as `thread`'s: each always lands on
  `list`, regardless of which route dispatched `back`. `current` stays unreferenced in
  `nextPairedRoute` for exactly the reason noted above.
- **`pairServer` sidesteps the stack-aware-back gap rather than closing it.** [#152](../codebase/152.md)
  gave its two exits their own explicit nav arms instead of extending `back` with stack awareness — a
  smaller, sufficient fix for this one sub-screen. A future sub-screen under Settings still can't lean on
  a general "return to origin" `back`; it would need the same one-arm-per-exit treatment, or a real stack,
  whichever comes first.
- **`pairServer`'s render test needs a `window` stub.** `PairingScreen` derefs `window.pyry` at render
  time; server-rendering `<PairedShellView route="pairServer" …/>` in the `node` vitest env throws
  without `globalThis.window = { pyry: {} }` (`beforeEach`/`afterEach`), the same stub `App.test.tsx`
  uses for its `pairing` route.
- **A late `sessionTransition` for the previous conversation can re-stale the session id after a switch**
  ([#530](../codebase/530.md)). `sessionIdBridge` is `conversation_id`-free per ADR 0004, so if
  conversation A is still streaming when the user switches to B, a marker meant for A that arrives after
  the switch is indistinguishable from B's first marker and gets written. `activateConversation` narrows
  this from "the entire time the user is in B" to "only if a late marker arrives" — it does not close it
  fully. Not fixable at this layer; needs either the daemon tagging `sessionTransition` with a
  conversation id, or main-process suppression of non-active-conversation events. Flagged by the
  architect's security review as a PO follow-up, not yet filed as its own ticket. The timeline has the
  identical exposure for A's still-streaming deltas (`ThreadEvent` is equally `conversation_id`-free).
- **`PairedShell.test.tsx` cannot exercise `activateConversation`'s branch behavior.** No jsdom harness
  (`renderToStaticMarkup` only), so its nav coverage is limited to `nextPairedRoute` reducer assertions.
  The branch logic (clear-iff-id-changed, clear-then-set ordering) is unit-tested directly on the pure
  helper in `activateConversation.test.ts` — see [#530 codebase notes](../codebase/530.md).

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — the real `list` view, replacing the placeholder described above
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the third route, `settings`, and its entry button on the Channel List
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the fourth route, `pairServer` (#152), reuses this screen as-is
- [Archive screen](archive-screen.md) / [#347](../codebase/347.md) — the fifth route, `archive`, and its entry button sharing the Channel List's actions cluster
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the second `open` trigger, fired by a daemon-confirmed conversation create rather than a row click
- [Push notifications](push-notifications.md) / [#393](../codebase/393.md) — the third `open` trigger, fired by clicking a push notification (main-local, not daemon-relayed)
- [Workspace chip](conversation-shell.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — untouched by this ticket; the store-backed messages that survive navigation
- [Thread timeline (conversation model)](thread-timeline.md) / [#530](../codebase/530.md) — `timelineStore`'s `reset` arm ([#528](../codebase/528.md)) gets its first production dispatch site here, via `activateConversation`
- [Session-id store](session-id-store.md) / [#530](../codebase/530.md) — `clearSessionId` ([#529](../codebase/529.md)) gets its first production caller here
- [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the single-active-conversation, `conversation_id`-free event model that is why `activateConversation` has to gate on the id rather than filter by conversation
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule `PairedShell`'s `useReducer` follows
- [#140 codebase notes](../codebase/140.md) · Spec: `docs/specs/architecture/140-list-thread-navigation-shell.md`
- [#152 codebase notes](../codebase/152.md) · Spec: `docs/specs/architecture/152-pair-another-server-from-settings.md`
  — adds the `pairServer` route and its two dedicated exit arms.
- [#347 codebase notes](../codebase/347.md) · Spec: `docs/specs/architecture/347-archive-screen-scaffold.md`
  — adds the `archive` route (chrome-only scaffold; tab bodies are #348's mount point).
- [#530 codebase notes](../codebase/530.md) · Spec: `docs/specs/architecture/530-clear-per-conversation-context-on-switch.md`
  — replaces both carrying nav sites' direct `setActiveConversation` with `activateConversation`, clearing
  the timeline and session id on an actual conversation switch.
