# Paired shell (list/thread two-pane desktop shell)

The second-level router **under** the app shell's `conversation` route: a pure `list` / `thread`
view-state model plus a thin container, mirroring the `appRoute.ts` + `AppView` split the
[app shell](app-shell.md) shipped as. Before this, the `conversation` route dropped straight into a
single [conversation shell](conversation-shell.md) screen with no list and no way back; this is the
inner navigation spine for the paired region. [#333](../codebase/333.md) added the third arm, a
[Settings screen](settings-screen.md); [#152](../codebase/152.md) added a fourth, `pairServer`, that
re-opens the existing [pairing screen](pairing-input-screen.md) to switch daemons; [#347](../codebase/347.md)
added a fifth, the [Archive screen](archive-screen.md) scaffold, a chrome-only view reachable from the
Channel List home whose tab bodies [#348](../codebase/348.md) still needs to fill.
[#670](../codebase/670.md) changed what `list` and `thread` mean: they stopped being mutually-exclusive
alternative screens (the mobile design widened to fill a window) and became the two arms of one
**two-pane desktop shell** — a fixed 400px sidebar, always mounted, beside a chat pane that holds the
thread or nothing. `settings`/`archive`/`pairServer` are unaffected: each already returned a full-screen
`<section>` that replaces the whole shell, so "still opens over both panes" cost no edit. See
[below](#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the layout and the
conversation-switch bug the change surfaced.

Introduced in [#140](../codebase/140.md). Renderer-only, pure view-state — no keys, sockets, tokens,
or frames, so not security-sensitive.

## What it does

- The paired region now enters at a **list** view — the [Channel List home screen](channel-list.md)
  (two-tier Channels/Chats, [#141](../codebase/141.md); the non-promoted tier read "Recent
  discussions" until the desktop-design relabel, [#709](../codebase/709.md)) — instead of the single
  conversation thread.
- Every row in the list view opens the active conversation into the **thread** view — the existing
  [conversation shell](conversation-shell.md), unchanged. (Per-row opening of a *specific* conversation
  is deferred — see the [Channel List doc](channel-list.md).)
- The thread view shows a leading back affordance (Figma node 16-9's `arrow_back`); since
  [#670](../codebase/670.md) this **deselects** rather than navigates away — both `list` and `thread`
  render the same sidebar, so `back` only empties the chat pane.
- **Since [#670](../codebase/670.md), `list` and `thread` are simultaneous, not exclusive.** The sidebar
  (the Channel List) is mounted on both routes; only the chat pane's content forks — `ConversationScreen`
  on `thread`, nothing on `list`. Selecting a conversation no longer hides the sidebar, and leaving one no
  longer hides the chat pane's layout slot (though its content does empty).
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
- [#652](../codebase/652.md) added a **fourth** trigger for `back` specifically, not `open`: deleting
  the discussion currently open in the thread now returns to `list` on the daemon's own confirmation.
  Unlike the three `open` triggers above, this reuses the existing absolute `back` transition — no new
  `PairedNav` arm, no `PairedRoute` member — via `useConversationDeletedExit` mounted beside
  `useConversationCreatedNav`. See [below](#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652).
- [#653](../codebase/653.md) added a **fifth** `back` trigger, the archive sibling of #652's delete
  trigger: the discussion currently open in the thread returning to `list` once the daemon's
  authoritative conversation list shows it archived. Same reused `back` transition, same
  `exitActiveConversation` decision, unmodified — only the trigger differs, and it is derived (a level
  predicate over `conversationsReceived`) rather than a dedicated wire event, since `conversationUpdated`
  as decoded cannot say *what* changed. See [below](#the-archive-exit-conversationarchivedbridgets-653).

## How it works

Two new files, peers of `appRoute.ts` / `App.tsx` (the second-level router, not a screen), plus
additive edits to `App.tsx` and `ConversationScreen.tsx`. [#670](../codebase/670.md) added a third,
co-located with `PairedShell.tsx` the way every screen's stylesheet already is:

```
src/renderer/src/
├── pairedRoute.ts          # PairedRoute + PairedNav + nextPairedRoute (pure, React-free)
├── pairedRoute.test.ts     # the four transition scenarios
├── PairedShell.tsx         # PairedShellView (pure view) + PairedShell (container)
├── PairedShell.test.tsx    # route→view + enters-at-list
└── pairedShell.css         # #670 — the two-pane layout (sidebar + chat pane)
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
own `assertNever` default. [#670](../codebase/670.md) merged the `list`/`thread` arms into the two-pane
shell and added a required `paneKey` prop (below):

```ts
export function PairedShellView(props: {
  route: PairedRoute
  paneKey: string | null   // #670 — ConversationScreen's `key`; see below
  onOpen: (conversation: ConversationSummary) => void
  onOpenSettings: () => void
  onOpenArchive: () => void
  onBack: () => void
  onUnpaired: () => void
  onOpenPairServer: () => void
  onPairServerPaired: () => void
  onPairServerCancelled: () => void
}): JSX.Element {
  switch (props.route) {
    // #670: list and thread stopped being alternative SCREENS and became one two-pane shell — the
    // sidebar is mounted in both; only the pane's content forks. Combining two case labels with no
    // statement between them is not a fallthrough, so assertNever still narrows to never.
    case 'list':
    case 'thread':
      return (
        <div className="paired-shell">
          <div className="paired-shell__sidebar">
            <ChannelList onOpen={props.onOpen} onOpenSettings={props.onOpenSettings} onOpenArchive={props.onOpenArchive} />
          </div>
          <div className="paired-shell__pane">
            {props.route === 'thread'
              ? <ConversationScreen key={props.paneKey} onUnpaired={props.onUnpaired} onBack={props.onBack} />
              : null}
          </div>
        </div>
      )
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
scaffolds they render, and both still replace the **whole** shell (sidebar included), which is what
makes "still open over both panes" (#670's AC5) cost zero lines in this file.

### The two-pane desktop shell (`pairedShell.css`, `src/main/index.ts`, #670)

Traced from Figma node 102-4: a 1280×1024 frame, one flex row, `Sidebar 103:736` (400px, fixed) beside
`Chat 103:2955` (absorbs the rest), 20px outer gutter, 20px gap. The geometry is self-checking:
`20 + 400 + 20 + 820 + 20 = 1280`.

```css
.paired-shell {
  display: flex;
  height: 100%;
  box-sizing: border-box;   /* index.css sets no global box-sizing */
  gap: var(--space-5);      /* 20px */
  padding: var(--space-5);
  background: var(--color-surface);
}
.paired-shell__sidebar { flex: 0 0 400px; min-width: 0; height: 100%; }  /* AC2 — fixed, never shrinks or grows */
.paired-shell__pane    { flex: 1 1 0; min-width: 0; height: 100%; }  /* absorbs the remaining width */
```

`min-width: 0` on the pane is load-bearing, not defensive: a flex item's default `min-width: auto`
floors it at its content width, so one unbreakable descendant (a long `<pre>`, a wide tool-result line)
would otherwise grow the pane past its share and squeeze the sidebar below 400px. `box-sizing:
border-box` is likewise load-bearing — `index.css` sets no global rule, so `content-box` would add the
20px padding on top of `height: 100%` and overflow the window by 40px vertically.

**The sidebar carries the symmetric `min-width: 0` too, added by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834).**
`flex: 0 0 400px` fixes the basis but, like the pane before this fix, leaves `min-width: auto` — which
floors a flex item at its *content's* min-content width regardless of the basis. It went unnoticed until
#834 gave the [sidebar's host row](channel-list.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834)
an operator-typed name up to `MAX_HOST_LABEL_LENGTH` (128) with `white-space: nowrap`: a nowrap string's
min-content size is the whole string, measured at ~1063px, which took the sidebar with it and left the
label unable to ellipsize no matter what `channels.css` said. `.channel-list`'s `overflow-x` (computed
`auto`, a side effect of its `overflow-y: auto`) does not save it — a scroll container's automatic
minimum size is 0 for *itself*, but its min-content *contribution* to an ancestor is still
content-derived. `.channel-list__title` and `.channel-list__workspace-label` are nowrap too and had the
same latent reach; this one declaration pins all three. Landed as its own commit (d6fdc3a) alongside
#834's `ChannelList.tsx`/`channels.css` changes, kept separable for review since it touches a different
file than the spec named. **Lesson for any future ellipsizing element:** `min-width: 0` on the
ellipsizing element is only half the fix when it is not the flex item being squeezed — check with
`getBoundingClientRect()` before trusting an ellipsize rule works, since the unit tier (no DOM) cannot
see this at all and the failure looks identical to "the CSS did not load."

**Neither screen stylesheet needed a layout edit.** `.channel-list` and `.conversation` were already
`height: 100%` with no width rule, so each fits a flex child of any width; `channels.css`'s header
comment was updated to say so (it used to assert the opposite — that the list was "NOT a flex item of a
paired-shell area," true before this ticket). The three pre-existing `position: fixed` overlay rules
(two in `channels.css`, one in `conversation.css`) are untouched and still cover the whole window, which
is still correct — `position: fixed` escapes its container regardless of the container's own layout.

**The pane card treatment (the Figma's `rgba(0,0,0,0.3)` wash + rounded corners) is deliberately not
built.** `.channel-list` and `.conversation` each paint `--color-surface` on themselves — the same
colour as this shell's own backdrop — so a wash applied to the wrapper `<div>`s would be painted over
and invisible; making it visible means editing both screen stylesheets, which would put the ticket over
its file-count scope. It lands with the sidebar-tree and composer tickets that own each pane's interior.

**The window floor.** `src/main/index.ts`'s `BrowserWindow` options gained `minWidth: 800` as a sibling
of `width`/`height`; `webPreferences` (`sandbox`, `contextIsolation`, `preload`) is byte-identical to
before (AC3). At the 800px floor the chat pane is 340px (`800 − 20 − 400 − 20 − 20`) — narrow but held up
by the composer's own `min-width: 0` and bubble `max-width` bounds; flagged in the spec as arithmetic to
watch, not a defect.

**Why the sidebar survives a `list`↔`thread` flip instead of remounting.** Both arms render
`ChannelList` at the same element position, so React preserves its subtree across the switch rather than
tearing it down — safe and desirable, since `ChannelList` is bound to the live
`useConversationListStore` and had no mount-time fetch a remount was refreshing. One side effect: the
list's scroll position now survives opening a conversation, which it didn't before (the list used to
unmount entirely on `thread`).

**Why the pane must render `null`, not a mounted-but-blank `ConversationScreen`, on `list`.** Four e2e
assertions use `expect(page.locator('.conversation')).toHaveCount(0)` as their "left the thread" proof
(`conversation-archive-lifecycle.spec.ts:112,174` and the real-daemon twin); a mounted-blank pane would
time out all four. Per the operator, the empty state is genuinely empty — no placeholder, illustration,
or call to action — the wrapper `<div class="paired-shell__pane">` survives only as the layout slot.

#### The conversation-switch remount bug and the `paneKey` fix

Mounting the sidebar beside the thread made a new transition reachable: clicking a *different*
conversation's row while a thread is already open. `nextPairedRoute('thread', 'open')` is absolute, so
the route stays `thread` — the ternary above keeps returning `<ConversationScreen>` at the same
position, and React **preserves that subtree** instead of remounting it. That path did not exist before
#670 (the sidebar was unmounted whenever a thread was up), and every piece of `ConversationScreen`'s
screen-local state written on the assumption that a remount always separates two conversations —
five in-file comments say so in as many words (the run-config sheet, Channel Info, the workspace picker,
the background-task panel, the scroll pin) — carried into the new conversation. The sharpest case: the
composer's draft text would follow the operator into the conversation they switched to and be **sent
there**. `activateConversation`'s store-side clear (timeline, session id) does not cover this — it
clears store state, not a component's own `useState`/`useRef`.

Code review caught this in round 1 (MUST FIX, not identified by the spec or the PR body); the fix,
shipped in a follow-up commit on the same PR:

- `PairedShellView` gained the required `paneKey: string | null` prop shown above, applied as
  `ConversationScreen`'s `key` — a React `key` change forces a remount, restoring the "resets on remount
  for free" invariant those five comments assume.
- `PairedShell` (the container) holds `paneKey` in a `useState` beside the nav `useReducer`, and records
  it at exactly the two production sites that change the active conversation:
  `useConversationCreatedNav`'s payload (the FAB's daemon-confirmed create) and `onOpen`'s argument (a
  sidebar row click) — see the container code below. It is **not** derived from
  `activeConversationStore`; doing that would make `PairedShellView` a store subscriber and give up the
  server-renderable invariant the file asserts twice.
- The nullary `open` (a push-notification click, [#393](../codebase/393.md)) deliberately does **not**
  touch `paneKey` — it carries no conversation payload and means "show the conversation that's already
  active," so the pane's identity hasn't moved.
- Nothing clears `paneKey` on exit. Delete, archive, unpair, and pair-another-server all land on a route
  where the pane renders `null`, so the subtree is destroyed regardless of what the key holds — a stale
  key cannot preserve a subtree that no longer exists.
- Making the prop **required**, not optional, turns "a future call site forgets to record the switch"
  into a compile error rather than a silent reintroduction of the bug.

Proven by a new e2e spec, `e2e/conversation-switch-remount.spec.ts`, using the composer draft as the
observable (plain `useState`, no store, no round trip — a surviving value can only mean a surviving
subtree): it drives both paths that leave the route on `thread` (FAB create → switch, sidebar row click
→ switch) in both directions, verified RED before the fix. See [#670 codebase notes](../codebase/670.md)
for the full round-1/round-2 review record, including a pre-existing cross-conversation modal-store leak
the overlay-scope change (below) made newly reachable, flagged as a follow-up rather than fixed here.

**A related, disclosed side effect: thread-scoped overlays now cover the pane, not the window.**
`.status-sheet-overlay` (Run configuration) and `.permission-modal-overlay` are `position: absolute;
inset: 0` inside `.conversation`, which used to fill the whole window and now fills only the chat pane —
so the sidebar stays clickable while one of those sheets or a permission prompt is open. The three
genuine `position: fixed` overlays (two dialogs in `channels.css`, one in `conversation.css`) are
untouched and still cover the window, as intended. Not a defect — every affected spec still passes and
the behaviour is defensible for a two-pane layout — but it's a visible change no AC named, recorded here
so a future ticket narrowing overlay scope has the context.

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
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  // #777 — restore point 1 of "the open conversation's mark equals its own held item count". Routed
  // through conversationLastReadBridge's own production wiring object rather than a fifth getState()
  // arrow here, so the sampling branch lives in one tested place. See below.
  stampLastRead: (conversationId) => stampLastReadFor(conversationLastReadDeps, conversationId),
  // #786 — the view stamp that arms conversationTimelineStore's ten-slice eviction bound. Unlike
  // stampLastRead above it reaches its store DIRECTLY, the clearTimelineFor/clearAllTimelines shape below:
  // there is no sampling branch to keep in one tested place. See below.
  markViewed: (conversationId) => conversationTimelineStore.getState().markViewed(conversationId)
}

// #531: the store wiring for the pairing-ended clear, module scope for the same reason as
// activateDeps above — each effect reaches its singleton through getState() inside the arrow body,
// so nothing is dereferenced at module load, nothing is read during render, and the object closes over
// no per-render value. sessionStore and announcedModelStore appear here and nowhere else in this
// file; PairedShell still subscribes to no store at all and stays server-renderable. #593 widened the
// set with the announced running model and #779 with the per-conversation read marks, and because both
// call sites below pass this one object, each was a single edit rather than two.
const clearPairingDeps: ClearPairingScopedStateDeps = {
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearAllTimelines: () => conversationTimelineStore.getState().clearAllTimelines(),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId(),
  clearAnnouncedModel: () => announcedModelStore.getState().clearAnnouncedModel(),
  dispatchSession: (action) => sessionStore.getState().dispatch(action),
  // #779: how far the operator read on the ended pairing's server — cleared in memory AND on disk, since
  // #776 persists the marks. It reaches its store DIRECTLY rather than through
  // conversationLastReadDeps, the stampLastRead argument above: the bridge's deps object exists so the
  // SAMPLING branch lives in one tested place, and there is no sampling branch here — the store method
  // takes nothing at all. Widening ConversationLastReadDeps with a member the stamp path never uses
  // would put an unused effect on a tested interface.
  clearAllLastRead: () => conversationLastReadStore.getState().clearAllLastRead()
}

export function PairedShell({ onUnpaired }: { onUnpaired: () => void }): JSX.Element {
  const [route, dispatch] = useReducer(nextPairedRoute, 'list')
  // #670 — the chat pane's identity (PairedShellView's `paneKey` prop). Screen-local, ADR 0006, beside
  // the nav reducer — deliberately NOT read from activeConversationStore, which would make this
  // container a store subscriber. Recorded at exactly the two sites that activate a conversation, each
  // already holding the conversation it's activating. The nullary `open` (below) records nothing on
  // purpose — it means "show the conversation that's already active." Nothing clears it on exit: every
  // exit lands on a route where the pane renders `null`, destroying the subtree regardless.
  const [paneKey, setPaneKey] = useState<string | null>(null)
  useConversationCreatedNav((created) => {   // #242, widened #278
    activateConversation(activateDeps, created)   // #530 — clear-then-set, see below
    setPaneKey(created.id)   // #670
    dispatch({ type: 'open' })
  })
  useNotificationActivatedNav(() => dispatch({ type: 'open' }))   // #393 — no setActiveConversation, no paneKey change
  return (
    <PairedShellView
      route={route}
      paneKey={paneKey}   // #670
      onOpen={(conversation) => {
        activateConversation(activateDeps, conversation)   // #530 — clear-then-set, see below
        setPaneKey(conversation.id)   // #670 — the sidebar switch the two-pane shell exists to enable
        dispatch({ type: 'open' })
      }}
      onOpenSettings={() => dispatch({ type: 'openSettings' })}
      onOpenArchive={() => dispatch({ type: 'openArchive' })}
      onBack={() => dispatch({ type: 'back' })}
      onUnpaired={() => {
        clearPairingScopedState(clearPairingDeps)   // #531 — the pairing that just ended
        onUnpaired()
      }}
      onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
      onPairServerPaired={() => {
        clearPairingScopedState(clearPairingDeps)   // #531 — same clear, the other path that ends one
        dispatch({ type: 'pairServerPaired' })
      }}
      onPairServerCancelled={() => dispatch({ type: 'pairServerCancelled' })}
    />
  )
}
```

`useReducer(nextPairedRoute, 'list')` is screen-local ephemeral state per
[ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — resets on remount, never
the session store (AC5). Enters at `'list'` (AC2). The `paneKey` `useState` added by
[#670](../codebase/670.md) sits beside it and follows the same rule. `onUnpaired` threaded straight through to
`ConversationScreen` unchanged from [#166](../codebase/166.md) until [#531](../codebase/531.md) wrapped
it (below); `PairedShell` still does not intercept the prop's *identity*, only wraps the callback it's
given. [`useConversationCreatedNav`](new-discussion-fab.md) (#242) is the one added line: it subscribes to
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

**[#531](../codebase/531.md) wrapped the two nav sites that *end* a pairing**, `onUnpaired` and
`onPairServerPaired`, in `clearPairingScopedState(clearPairingDeps)` — a fourth clear
([`sessionStore`'s `reset`](session-store.md), #166) alongside the timeline `reset` and the two #529
clears `activateConversation` already uses. Unlike `activateConversation`'s id-gated clear-on-switch,
this one is **unconditional**: the pairing itself is ending, so there is no state in which the thread
rows, the active conversation, or the daemon session id legitimately survive into the new pairing.
**[#593](../codebase/593.md) added a fifth**, [`announcedModelStore`'s `clearAnnouncedModel`](announced-model-store.md)
— claude's model announcement is pairing-scoped the same way (nothing on a fresh pairing re-asserts
it until the new daemon's first turn), so it belongs in this same shared set rather than at either
call site, and stays out of the transport's `connected` edge for the opposite reason
`backgroundTaskRosterStore` is on it: a reconnect to the *same* daemon leaves the held announcement
accurate.
[#757](../codebase/757.md) added a sixth, [conversation timeline holder](conversation-timeline-holder.md)'s
`clearAllTimelines` — every retained per-conversation thread, not just the flat store's.
**[#779](conversation-last-read-store.md) added a seventh and last**,
[`conversationLastReadStore`'s `clearAllLastRead`](conversation-last-read-store.md#how-it-works) — how far
the operator had read into each conversation, persisted to `localStorage` since #776 and therefore the one
member of this set that reaches disk. Its position is not interchangeable with the other six: it must run
**after** `clearAllTimelines`, because that clear synchronously notifies [#777's open-conversation
listener](#the-last-read-stamp-conversationlastreadbridgets-777), which at that instant still sees the ended
pairing's conversation as open, finds its timeline slice already gone, and re-mints a persisted `0` mark for
it — running the marks clear afterwards wipes that re-mint in memory and on disk before this function
returns. It must also run **last** among all seven, because it is the only one with an external side effect
(`localStorage.setItem`) and therefore the only one that can throw; placed earlier, a throw would abort
`clearSessionId` and leave server A's session id live and addressable while the operator is on server B.
The two paths are not symmetric and that's why both need their own wrap rather than one shared
remount-driven reset: unpair flips the app-level route to `pairing`, unmounting `PairedShell`
entirely, while pair-another-server transitions `pairServer` → `list` *inside* this shell
(`pairedRoute.ts:62-65`), so the shell never unmounts and nothing a remount would have cleared gets
cleared. `onPairServerCancelled` is deliberately **not** wrapped — cancelling ends no pairing, so it
clears nothing (AC4). Wrapping at this shared prop-handoff point, rather than threading a new
dependency through `runUnpair` and its two `ConversationScreen.tsx` call sites, keeps both wirings on
two adjacent lines in one file and inherits `runUnpair`'s existing ok-only fail-safe posture for free
— see [#531 codebase notes](../codebase/531.md) for the full rationale and the divergence trap it
closes (`sessionStore`'s reset used to live in `unpairAction.ts` alone; see [Session
store](session-store.md) and [Unpair channel](unpair-channel.md)).

**#777 widened `ActivateConversationDeps` with a fifth required member**,
`stampLastRead: (conversationId: string) => void`, called unconditionally at the end of
`activateConversation` (`activateConversation.ts:103`), **after** `setActiveConversation` and
**outside** the id-change gate. Outside the gate is deliberate: a re-click of the already-open row still
owes a fresh mark, the same reason `setActiveConversation` itself already runs unconditionally there. See
[The last-read stamp](#the-last-read-stamp-conversationlastreadbridgets-777) below for the write path
this calls into.

**[#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) widened `ActivateConversationDeps` with
a sixth required member**, `markViewed: (conversationId: string) => void`, called **last** — after
`stampLastRead` — also unconditionally and also **outside** the id-change gate. See
[The view stamp](#the-view-stamp-activateconversationts-786) below for the write path this calls into and
why the ordering relative to `stampLastRead` and `setActiveConversation` is the way it is.

### The delete exit (`exitActiveConversation.ts` + `conversationDeletedBridge.ts`, #652)

Before this, deleting the discussion currently open in the thread fired `delete_conversation`
([Conversation delete](conversation-delete.md)) and closed the Channel Info sheet — and nothing else
happened. The row left the Channel List (the existing re-list already worked), but the thread stayed
open, rendering rows for a discussion the daemon no longer held, and stayed recorded as the active
conversation — so the two thread actions that carry a conversation id (composer send, queued-message
drop) kept addressing an id the daemon would answer with `conversation.not_found`, silently, since the
app has no send-failure surface.

`exitActiveConversation` (`src/renderer/src/exitActiveConversation.ts`) is the pure decision, a third
sibling of `activateConversation` and `clearPairingScopedState`, co-located with them:

```ts
export interface ExitActiveConversationDeps {
  getActiveConversation: () => ConversationCreatedPayload | null
  dispatchTimeline: (event: ThreadEvent) => void
  clearTimelineFor: (conversationId: string) => void  // #757 — the keyed holder's single-key clear
  clearActiveConversation: () => void
  clearSessionId: () => void
  navigateToList: () => void
}

export function exitActiveConversation(deps: ExitActiveConversationDeps, conversationId: string): void {
  if (deps.getActiveConversation()?.id !== conversationId) return
  deps.dispatchTimeline({ type: 'reset' })
  deps.clearTimelineFor(conversationId)
  deps.clearActiveConversation()
  deps.clearSessionId()
  deps.navigateToList()
}
```

- **The gate is the id**, read through a getter at invocation time — `activateConversation`'s
  documented reason applies verbatim: the bridge callback is held in a ref refreshed by a bare
  (post-commit) effect, so a callback closing over a render-time value could compare against a stale
  previous. A mismatch — including no active conversation at all — is a total no-op. This is reachable,
  not theoretical: delete can only be fired from the Channel Info sheet, mounted inside the thread, so
  the two ids always agree at request time, but the operator can go back and open a *different*
  discussion while the confirmation is in flight.
- **What the gate means**, stated explicitly in the source so it isn't over-read: "this id names the
  conversation on screen," **not** "this reply answers a delete I issued." `daemonConnection.ts` emits
  `conversationDeleted` unconditionally on decode with no `in_reply_to` correlation state threaded
  (#375's deliberate decision — the bare `id` is self-sufficient). The fail-direction is safe: every
  move the gate triggers is a clear.
- **Clear, then navigate — four stores, not `clearPairingScopedState`'s seven.** `dispatchTimeline({
  type: 'reset' })` → `clearTimelineFor(conversationId)` ([#757](../codebase/757.md)) →
  `clearActiveConversation()` → `clearSessionId()`, then `navigateToList()` last, so no observer sees the
  Channel List rendered against the deleted discussion's thread state. The pairing has **not** ended here
  — the daemon connection is alive and the operator lands on a working Channel List — so `sessionStore`'s
  reset and `announcedModelStore`'s clear (both in `clearPairingScopedState`'s seven) are deliberately
  excluded: resetting the session store would blank a live connection status into a false disconnected
  state, and the announced model is daemon-scoped, not conversation-scoped. `clearAllTimelines` is
  excluded the same way — it is the pairing-boundary clear, and this helper drops one conversation's slice
  rather than every one. [`conversationLastReadStore`'s `clearAllLastRead`](conversation-last-read-store.md)
  (#779) is excluded for the identical reason: the marks are pairing-scoped, not conversation-scoped, so a
  conversation being deleted or archived leaves the operator's other chats live and their marks meaningful.
  `queueStore` is excluded too — the queued backlog is selected by matching the
  active conversation id, and a `null` active id yields the stable empty backlog via the existing `''`
  sentinel, so no stale queued row can render regardless.
- **Idempotent by construction.** After a successful exit `activeConversation` is `null`, so a second
  delivery of the same id fails the gate — no flag, no guard.
- **Total.** No return value, no throw path, no logging — a diagnostic here would want the conversation
  id, which ADR 0007's content-free rule forbids, and there's no observed failure to instrument.
- **The security payload**, the one `activateConversation` and `clearPairingScopedState` already
  document: clearing the session id makes `RunConfigSections`' `onChange` `undefined`, so the Run
  configuration controls render inert instead of addressing a YOLO / auto-approval write to a session
  that belonged to a conversation the daemon has just destroyed.

`conversationDeletedBridge.ts` is the event seam, the `conversationCreatedBridge` twin — three exports,
the same `translate* → subscribe* → use*` shape, and **strictly narrower**: it subscribes to the
daemon's `conversationDeleted` reply and sends nothing (the delete command itself is fired by the
Channel Info sheet's confirm). `translateConversationDeleted` returns the arm's bare `id` string
(`default: null` for everything else — the intended permanent filter, not `assertNever`, mirroring
`translateConversationCreated`). `subscribeConversationDeleted` guards on `!== null`, not truthiness —
here that distinction is materially load-bearing, not just idiom: a degenerate `''` id is falsy but is
still a real value the daemon could emit, and a truthiness check would silently drop the exit for it.
`useConversationDeletedExit` is the React glue, the `useConversationCreatedNav` shape verbatim
(ref-held latest callback, empty-dep subscribe effect, off-handle cleanup, `window.pyry` dereferenced
only inside the effect so `PairedShell` stays server-renderable).

**A second subscription on `conversationDeleted` is correct, not a duplicate.**
[Conversation list store](conversation-list-store.md)'s `conversationListBridge` already consumes this
same event app-level to re-request the list; that listener sends a command, this one does not, so a
delete still fires exactly one re-list. It's the arrangement `conversationListBridge.ts` already
documents for `conversationCreated`: the two listeners touch disjoint state (`conversationListStore` vs.
timeline / active conversation / session id), so their delivery order is irrelevant.

Wired in `PairedShell`, beside `useConversationCreatedNav`:

```ts
const exitConversationDeps: Omit<ExitActiveConversationDeps, 'navigateToList'> = {
  getActiveConversation: () => activeConversationStore.getState().activeConversation,
  dispatchTimeline: (event) => timelineStore.getState().dispatch(event),
  clearActiveConversation: () => activeConversationStore.getState().clearActiveConversation(),
  clearSessionId: () => sessionIdStore.getState().clearSessionId()
}

useConversationDeletedExit((conversationId) =>
  exitActiveConversation(
    { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
    conversationId
  )
)
```

`exitConversationDeps` sits at module scope, the `activateDeps`/`clearPairingDeps` idiom — each effect
reaches its singleton through `getState()` inside the arrow body, so nothing is dereferenced at module
load and nothing is read during render. `navigateToList` is the one effect that can't live at module
scope (it needs the container's `dispatch`), hence the `Omit` — it makes the missing field explicit
rather than leaving a partial object silently typed as complete. `{ type: 'back' }` reuses the existing
absolute `back` arm unchanged, which already lands on `list` — no new `PairedNav` arm, no `PairedRoute`
member, no reducer edit. `PairedShell` still subscribes to no store, so its "re-renders only on its own
nav dispatch" and server-renderable properties hold.

**Reachable edge case, not fixed:** `back` is absolute, so the exit navigates to `list` from wherever
the operator happens to be, not only from the thread. A delayed `conversationDeleted` confirmation
arriving after the operator left the thread *without* opening a different discussion (Delete → Back →
Settings, then the confirmation lands) still fires `dispatch({ type: 'back' })` and yanks them to the
Channel List from Settings/Archive/PairServer. The fail direction is benign — the three clears are
correct and wanted in that window, and `list` is a valid destination — so this was left as an
observation for [#653](../codebase/653.md)'s seam discussion rather than fixed here; the actual fix
would be route-aware navigation, not a wider gate. See [#652 codebase notes](../codebase/652.md) for
the full design rationale and code review.

### The archive exit (`conversationArchivedBridge.ts`, #653)

Before this, archiving the discussion currently open in the thread fired `archive_conversation` and
closed the Channel Info sheet — and nothing else happened. The row left the Channel List (#469's
`partitionActive` already filtered `is_archived` rows), but the thread stayed open, rendering rows for a
discussion filed away, still accepting input.

`exitActiveConversation` — #652's decision above — is reused **unmodified**. Only the trigger is new,
and it can't be a dedicated wire event the way #652's `conversationDeleted` is: the daemon's
`conversation_updated` reply, as desktop decodes it, carries no archive flag at all
(`ConversationUpdatedPayload` is five fields, and `inboundMessage.ts` names `is_archived` as a
tolerated-but-not-copied key), and it fires identically on rename, promote and change-workspace — three
of which are reachable on the open discussion from inside its own thread. Gating on the event's mere
*occurrence* would bounce the operator out on a rename or a workspace change, trading this bug for a
worse one.

The signal is instead **derived from the daemon's authoritative conversation list**, in a new module,
`conversationArchivedBridge.ts` — the `conversationCreatedBridge`/`conversationDeletedBridge` shape, and
the first of the three that **owns no wire arm**:

```ts
export function archivedActiveConversationId(
  conversations: readonly ConversationSummary[] | null,
  activeConversationId: string | null
): string | null {
  if (conversations === null || activeConversationId === null) return null
  const row = conversations.find((conversation) => conversation.id === activeConversationId)
  return row !== undefined && row.is_archived ? activeConversationId : null
}
```

- **A level predicate, not an edge** — evaluated against every `conversationsReceived`, with no notion of
  "the operator clicked Archive." This is what makes the AC "becomes archived ⇒ returns to the list"
  trigger-agnostic for free: any refresh that reveals the flag fires the exit, whoever caused it,
  including a **second client's** archive — pyrycode#881 delivers `conversation_updated` correlated to
  the requester via `c.Reply`, not broadcast, so another client's archive produces no event on this client
  at all; the flag only surfaces on this client's own next `list_conversations`, and the level predicate
  picks it up then (eventually, not live — a daemon fan-out gap, not a client design choice).
- **Four `null` arms, each required rather than defensive:** not-loaded (`conversations === null`), no
  thread open (`activeConversationId === null`), the row absent (a **delete**, owned by #652's bridge —
  this predicate must not double-claim it), and the row present but `is_archived: false` (the rename /
  change-workspace regression-pin arm).
- **Rows are read off the event, not `conversationListStore`.** Both are written by the same
  `conversationsReceived` delivery, so they can't disagree, but reading the event removes any dependence
  on whether `ConversationListData`'s app-level listener happened to run first — the same
  no-ordering-contract arrangement `conversationListBridge.ts` already documents for `conversationCreated`.
  In practice the store write does land first, which means this exit has **no stale-row window at all**:
  by the time it fires, `partitionActive` has already dropped the archived row from the Channel List —
  strictly better than #652's delete path, where the nav precedes the re-list by a round trip.
- **`translateConversationsEvent` is imported from `conversationListBridge`, not re-declared.** This
  bridge and the list bridge key off the same `conversationsReceived` arm — unlike the created/deleted
  bridges, which each own a distinct one — so the switch has exactly one place to update.

`subscribeArchivedActiveConversation` and `useArchivedActiveConversationExit` mirror
`conversationDeletedBridge`'s shape exactly (ref-held latest callback, empty-dep subscribe effect,
off-handle cleanup, `window.pyry` dereferenced only inside the effect).

Wired in `PairedShell`, directly beneath the #652 wiring, with **no new deps object**:

```ts
useArchivedActiveConversationExit(
  () => exitConversationDeps.getActiveConversation()?.id ?? null,
  (conversationId) =>
    exitActiveConversation(
      { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
      conversationId
    )
)
```

`exitConversationDeps` (#652's module-scope deps object) supplies both the bridge's id getter and the
helper's own gate from the same source, so the two structurally cannot disagree about which conversation
is on screen — a double gate (bridge decides, helper re-checks) kept deliberately redundant so
`exitActiveConversation` ships unmodified.

**Inherits #652's absolute-`back` limitation, and the window is wider here.** The confirmation this
trigger waits on costs two round trips (archive → `conversation_updated` → `list_conversations` →
`conversations`) rather than #652's one, and "archive, then go check the Archive screen" is a more
natural operator flow than its delete equivalent — so a delayed archive confirmation landing while the
operator has stepped into Settings, Archive or Pair-server is more likely to yank them there than the
delete case is. Unobserved, every move is a clear, and this was explicitly left unfixed — a route-aware
`back` is its own ticket covering both halves. See [#653 codebase notes](../codebase/653.md) for the full
design rationale, the security review, and code review.

### The last-read stamp (`conversationLastReadBridge.ts`, #777)

[Conversation last-read store](conversation-last-read-store.md) (#775) shipped with a write path and no
caller. #777 is that write path: **the open conversation's mark equals its own held timeline item
count**, restored at two points — opening (above) and, here, content landing while it stays open. Both
are the same write of the same quantity (`stampLastReadFor`), which is why this is one write function
called from two places rather than two.

`useConversationLastRead()` is mounted in `PairedShell`, beside its other headless hooks — deliberately
**not** app-level, the opposite of every other bridge under `store/`. Every existing app-level bridge
exists because it must observe a conversation the operator has *never opened* (`conversationActivityBridge.ts`
says so in as many words). This one only ever writes the **open** conversation, and "open" is a concept
that exists only inside the paired shell:

```ts
useConversationLastRead()   // #777 — restore point 2, subscribes to conversationTimelineStore
```

It subscribes to **`conversationTimelineStore`**, not `window.pyry.onDaemonEvent` — the repo's first
production store→store subscription. Two facts forced that: the composer's optimistic echo writes the
keyed timeline slice directly (`composerSend.ts:88`) with no IPC arm behind it, so a daemon-event listener
would miss the operator's own sent message and mark his own open chat unread; and a second
`onDaemonEvent` listener would race `useTimelineBridge`'s fan-out (`timelineBridge.ts:432`) on listener
registration order. Observing the store instead has no such race — zustand's `setState` reassigns state
and only then calls listeners, so a read inside one always sees the value just written.

The write itself is an **assignment of the sampled count, never an increment** — a fact about the
`threadTimeline` reducer, not a preference. A continuing `assistantDelta` coalesces into the tail bubble
and leaves `items.length` unchanged, `toolResult` fills a held row in place, and `turnState` /
`stallDetected` / `apiRetry` / `compacting` / `reconnected` never touch `items` at all — a counter bumped
on arrival would be wrong on most arms. The common case (an unchanged count) re-records an identical
mark and `recordLastRead`'s own `===` guard hands back the state object, so zustand's `Object.is`
short-circuit fires and nothing downstream wakes.

AC4 ("a conversation that is not open never acquires a mark") is **available by construction, not by a
guard**: the listener names exactly one id — `getOpenConversationId()`'s — on every path, so a
conversation that is not open is never an argument to `recordLastRead`. There is no filter to forget
because the wrong write is structurally unavailable, the same posture `conversationLastReadStore`'s hard
import constraint takes (see that doc). It re-stamps on **every** timeline emission, including a fold
into a background conversation's slice — filtering to "did the open conversation's slice change" would
need the previous state, which the deliberately nullary listener seam (`() => void`, not zustand's
`(state, prevState)`) rules out.

This bridge imports `activeConversationStore`, which every other bridge under `store/` bans importing for
itself (`timelineBridge.ts:236-240`, `conversationActivityBridge.ts:183-184`). That ban stops an
*arriving event that carries its own `conversationId`* from being misattributed to the conversation on
screen — the `?? activeConversation` fallback the #675 family removed. Here nothing arrives: there is no
event and no `conversationId` on the wire, so there is no attribution to get wrong. The open conversation
is the subject of the quantity being written, not a fallback for a missing id.

**Reachable edge case, first found by code review on PR #792 — resolved for the pairing-end path by #779,
still open for the delete/archive path.** Both teardown paths that end a pairing or an active conversation
clear the timeline store **before** they clear the active conversation: `clearPairingScopedState` calls
`clearAllTimelines()` ahead of `clearActiveConversation()`; `exitActiveConversation` calls
`clearTimelineFor(conversationId)` ahead of `clearActiveConversation()`. Either clear emits from
`conversationTimelineStore`, which this bridge is subscribed to for as long as `PairedShell` is mounted —
both teardown paths run *inside* that mounted window. The listener fires mid-teardown, reads
`getOpenConversationId()` (still the conversation being torn down — `activeConversationStore` hasn't
cleared yet), reads its now-absent timeline slice, and writes a **spurious `0`** over what may have been a
true, higher mark — persisted, since [#776](conversation-last-read-store.md). Concretely: archiving or
deleting the conversation you have 20 rows read into, or ending the pairing while it's open, drops its
last-read mark to `0` on the way out.

This is what falsified `clearPairingScopedState.ts`'s former claim that its clears are order-independent —
`clearAllTimelines` synchronously triggers a read of `activeConversationStore` and a write to
`conversationLastReadStore` through this listener, coupling two of the helper's effects through an observer
neither docstring used to account for. PR #792's own follow-up named two options: swap the clear order at
both sites, or state the coupling explicitly and pin it with a test. **[#779](conversation-last-read-store.md)
took the second option, for `clearPairingScopedState` only**: it added `clearAllLastRead()` as the helper's
seventh effect, placed **last** — after `clearAllTimelines()` — specifically so this re-mint is wiped, in
memory and on disk, before the helper returns, and the coupling is now pinned by a dedicated regression test
that wires the real `subscribeConversationLastRead` against isolated stores (the only way the hazard is
reachable under `environment: 'node'`). See [§ #779 above](#the-pairserver-route-152) for the ordering
argument and why it must also run **last** overall, not merely after `clearAllTimelines`.

**`exitActiveConversation` was out of #779's scope and still has the bare hazard.** Deleting or archiving
the open conversation still writes and persists the spurious `0` with no floor to wipe it — that helper has
no whole-map clear to place after `clearTimelineFor`, only per-conversation ones. No acceptance criterion of
#779 is violated (its ACs are pairing-boundary-scoped), and no acceptance criterion of #652/#653 is violated
either (the write still names only the open conversation, and `0` is its honest count at that instant), but
the hazard PR #792 first flagged is only half closed. A future ticket picking this up should start from the
code review on PR #792 and [#779's PR (#798)](https://github.com/pyrycode/pyrycode-desktop/pull/798) rather
than re-deriving either half.

### The view stamp (`activateConversation.ts`, #786)

[Conversation timeline holder](conversation-timeline-holder.md)'s `markViewed` — the store's only
tail-writer, and the whole enforcement of "least recently **viewed**" eviction — shipped with no
production caller (#755/#756/#757). Every retained slice was therefore never-viewed, and eviction silently
degraded to first-write order: exactly the failure the word "viewed" exists to prevent. #786 is that
caller, wired at the same seam as #777's last-read stamp — `ActivateConversationDeps` gains a sixth
required member, called unconditionally at the end of `activateConversation`, **after**
`stampLastRead` and **outside** the id-change gate:

```
previous = getActiveConversation()
if (previous?.id !== conversation.id) { dispatchTimeline({type:'reset'}); clearSessionId() }
setActiveConversation(conversation)
stampLastRead(conversation.id)      // #777, unchanged
markViewed(conversation.id)         // #786, new — outside the gate, last
```

**Outside the gate, not inside.** `markViewed`'s already-the-tail branch is documented on the holder as
the *common* case, justified by this very seam: `onOpen` fires on every row click, including a re-click of
the already-open row. Inside the gate that branch would be unreachable — after a real switch the tail is
always the *previous* conversation, never the one being opened — leaving a shipped, tested branch dead.
Outside the gate is also free: the store's no-churn guard hands back the state object unchanged, so no map
is cloned and no subscriber wakes.

**After `setActiveConversation`, and after `stampLastRead` — the ordering is load-bearing for the first,
free for the second.** `markViewed` can *create* a slice, and creating one notifies
`conversationTimelineStore`'s subscribers — among them #777's `useConversationLastRead`, which reads
`getOpenConversationId()` and re-stamps whatever conversation that names. Run before the set, that
listener would fire while the *previous* conversation is still open, writing an unrequested mark for it.
Run after, it re-records the mark `stampLastRead` just wrote a line earlier, so `recordLastRead`'s `===`
guard (see [Conversation last-read store](conversation-last-read-store.md)) returns the state object,
wakes nobody, and performs no `localStorage` write — the cascade terminates at depth 2, synchronously,
with no `await` anywhere. The order relative to `stampLastRead` itself is not forced by any of this: that
function never reads the open conversation, so either order records the same mark. Appending after it
was chosen because it leaves #777's line untouched.

**Cross-wire hazard, named rather than defended by type.** `markViewed` and `stampLastRead` now have
*identical* signatures — `(conversationId: string) => void` — so swapping them at a deps site compiles,
and every `toHaveBeenCalledWith(conversation.id)` spy assertion still passes for both. What catches a swap
is that the two land in *different* stores: with real stores wired, a swap leaves one store unmarked and
the other unpromoted, so #777's and #786's own tests fail together
(`activateConversation.test.ts`'s `realDeps` cases). At the one production site
(`activateDeps` above) the defence is that the two arrow bodies are visibly different and each member
name matches the store method it calls — no branded type for a two-member wiring object.

**Security consequence: the tail is no longer an operator-only region.** `activateConversation` is also
reached ungated from a daemon-confirmed create (`useConversationCreatedNav`, above) — the store's own
docstring used to claim only the operator's activation could promote a key to the tail; #786 falsifies
that claim, and the holder's docstring and package overview were corrected in the same change (see
[Conversation timeline holder § The eviction invariant](conversation-timeline-holder.md#how-it-works) for
the corrected reasoning and why it was accepted rather than gated — architect security review, PASS).

See [Conversation timeline holder](conversation-timeline-holder.md) for `markViewed`'s own branches
(already-tail no-churn, present-not-tail move, absent-creates-at-tail) and why creating on an absent key
is load-bearing: the operator opens a conversation before any event for it has arrived, so a no-op there
would let a later fold create the slice at the head, making the conversation on screen the next eviction
victim.

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
       │                    useState<string|null>(null)          ← paneKey, #670, ADR 0006
       │                    useConversationCreatedNav((created) => {
       │                      activateConversation(activateDeps, created)   ← #530, see below
       │                      setPaneKey(created.id)              ← #670
       │                      dispatch({type:'open'})              ← #242
       │                    })
       │                    useNotificationActivatedNav(() => dispatch({type:'open'}))  ← #393, no activateConversation, no paneKey
       │                    useConversationLastRead()  ← #777, subscribes to conversationTimelineStore, no render
       └─ PairedShellView   route='list'|'thread' → #670 two-pane shell, sidebar mounted on BOTH:
                                                .paired-shell__sidebar → ChannelList (store-backed) — any row → onOpen(conversation):
                                                  activateConversation(activateDeps, conversation) ← #530
                                                  setPaneKey(conversation.id)                       ← #670
                                                  dispatch{open}                                    ← #448
                                                new-discussion FAB → createConversation command (#242)
                                                SettingsButton → dispatch{openSettings} (#333)
                                                ArchiveButton → dispatch{openArchive} (#347)
                                                .paired-shell__pane → route==='thread' ?
                                                  ConversationScreen key={paneKey} (store-backed) + BackControl — [←] → dispatch{back}
                                                  → WorkspaceChip reads activeConversationStore (#278)
                                                  onUnpaired → clearPairingScopedState(clearPairingDeps)  ← #531
                                                                onUnpaired() → App sets route='pairing'
                                                  : null   ← #670, genuinely empty, no placeholder

  activateConversation(activateDeps, conversation):  ← #530 (src/renderer/src/activateConversation.ts)
    previous = activateDeps.getActiveConversation()
    if previous?.id !== conversation.id:
      activateDeps.dispatchTimeline({type:'reset'})   ← #528, clears timelineStore
      activateDeps.clearSessionId()                    ← #529, clears sessionIdStore
    activateDeps.setActiveConversation(conversation)    ← unconditional, both branches
    activateDeps.stampLastRead(conversation.id)          ← #777, unconditional, OUTSIDE the gate too
    activateDeps.markViewed(conversation.id)             ← #786, unconditional, OUTSIDE the gate, LAST
                            route='settings' → SettingsScreen (pure, no store) + BackControl — [←] → dispatch{back} (#333)
                                                PairAnotherServerRow → dispatch{openPairServer} (#152)
                            route='pairServer' → PairingScreen (window.pyry default) — (#152)
                                                onCancel → dispatch{pairServerCancelled} → 'settings'
                                                onPaired → clearPairingScopedState(clearPairingDeps)  ← #531
                                                            dispatch{pairServerPaired} → 'list'
                            route='archive'  → ArchiveScreen (pure, no store) + BackControl — [←] → dispatch{back} (#347)
                                                tabs: useState<ArchiveTab> screen-local, both bodies empty (#348 mount point)

  clearPairingScopedState(clearPairingDeps):  ← #531 (src/renderer/src/clearPairingScopedState.ts)
    clearPairingDeps.dispatchTimeline({type:'reset'})        ← #528, clears timelineStore
    clearPairingDeps.clearAllTimelines()                       ← #757, clears conversationTimelineStore (every slice)
    clearPairingDeps.clearActiveConversation()                 ← #529, clears activeConversationStore
    clearPairingDeps.clearSessionId()                          ← #529, clears sessionIdStore
    clearPairingDeps.clearAnnouncedModel()                     ← #593, clears announcedModelStore
    clearPairingDeps.dispatchSession({type:'reset'})           ← #166, clears sessionStore
    clearPairingDeps.clearAllLastRead()                        ← #779, LAST — clears conversationLastReadStore
                                                                   (in memory AND on disk), after clearAllTimelines
                                                                   so #777's re-mint of the open conversation's
                                                                   mark is wiped rather than persisted
    (unconditional — no id gate, unlike activateConversation above; the one ordering constraint among the
     seven is clearAllLastRead after clearAllTimelines and last overall — see #779 above)
```

A `conversationCreated` daemon event reaches `dispatch({ type: 'open' })` independently of any row
click — see [the new-discussion FAB](new-discussion-fab.md) for the bridge that fires it. A clicked
push notification reaches the same `dispatch({ type: 'open' })` the same way, independently of both —
see [Push notifications](push-notifications.md#clicking-the-notification-393) for that bridge.

`sessionStore` (module-singleton, app-lifetime) holds the messages, independent of this nav state.
Navigating list→thread→list→thread still unmounts/remounts `ConversationScreen` (the pane goes through
`null` on the way), which re-reads the store on each mount — so store-backed messages stay intact across
navigation (AC4). Only `ConversationScreen`'s own ephemeral UI state (composer draft, sheet-open, unpair
phase) resets on remount, same as any other `useState`/`useReducer` component state — expected under
ADR 0006, and not a regression (there was no navigation, and hence no remount, before this ticket).
**Since [#670](../codebase/670.md), a sidebar row click can also switch conversations without the route
ever leaving `thread`** — that path relies on `paneKey` changing to force the same remount-and-reset by
`key`, rather than on the route itself cycling through `list`; see [the two-pane
shell](#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) above for why that remount had to
be added explicitly. `sessionStore` is, however, explicitly reset —
along with the flat timeline, (since [#757](../codebase/757.md)) every retained per-conversation
timeline, the active conversation, the session id, and (since #593) the announced running model — when
the pairing itself ends; see [#531](../codebase/531.md) above.

## Edge cases and limitations

- **Thread-scoped overlays (Run configuration sheet, permission modal) cover the pane, not the window,
  since [#670](../codebase/670.md).** The sidebar stays clickable while one is open — see [the two-pane
  shell](#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) above. A pre-existing
  cross-conversation leak in `useModalStore`'s global (not per-conversation) outstanding-prompt slice
  became reachable by a sidebar switch rather than only by deliberately leaving the thread; flagged as a
  follow-up in code review, not fixed here (a store change, out of this ticket's scope).
- **The chat pane is an unlabelled region.** `.paired-shell__pane` wraps a bare `<div class="conversation">`
  with no `role`/`aria-label`, unlike the sidebar's `<section aria-label="Conversations">`. Cost nothing
  with one screen mounted at a time; with two simultaneous panes a screen-reader user gets one navigable
  region and an unnamed remainder. Noted in code review as a cheap fix for a later ticket, not gating.
- **Duplicate accessible names** (`Archive` — sidebar entry + thread Channel-info action; `Rename` — one
  per list row + the sheet pill) are now a live-UI a11y smell, not only an e2e strict-mode risk, since
  both are reachable simultaneously on `thread`. Routed to the sidebar-chrome ticket, which relocates the
  gear/archive glyphs per the Figma.
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
- **`PairedShell.test.tsx` cannot exercise `clearPairingScopedState`'s wiring either, for the same
  reason** — its coverage is `nextPairedRoute` reducer assertions and the `:114` SSR test guarding the
  new module-scope import, not a driven `onUnpaired`/`onPairServerPaired` call. The seven-clear logic
  (four since #531, joined by `clearAnnouncedModel` at #593, `clearAllTimelines` at
  [#757](../codebase/757.md), and `clearAllLastRead` at [#779](conversation-last-read-store.md)) is
  unit-tested directly on the pure helper in `clearPairingScopedState.test.ts`, including a dedicated
  regression case pinning #779's one ordering constraint (`clearAllLastRead` after `clearAllTimelines`).
  One residual: the "clear runs before the route flips" ordering has no executable assertion after
  [#531](../codebase/531.md) removed the one `unpairAction.test.ts` case that pinned it — low-stakes
  today since all seven writes are synchronous and batched into the same commit as the route change,
  but worth restoring the moment a jsdom harness lands (see [#531 codebase notes](../codebase/531.md)).

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — the real `list` view, replacing the placeholder described above; since [#670](../codebase/670.md) it is the shell's always-mounted sidebar rather than an alternative screen
- [Channel List § The host row](channel-list.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834) /
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) — added the sidebar's `min-width: 0`
  above, needed once the host row started carrying an operator-typed name long enough to reach the
  sidebar's own min-content floor
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the third route, `settings`, and its entry button on the Channel List
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the fourth route, `pairServer` (#152), reuses this screen as-is
- [Archive screen](archive-screen.md) / [#347](../codebase/347.md) — the fifth route, `archive`, and its entry button sharing the Channel List's actions cluster
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the second `open` trigger, fired by a daemon-confirmed conversation create rather than a row click
- [Push notifications](push-notifications.md) / [#393](../codebase/393.md) — the third `open` trigger, fired by clicking a push notification (main-local, not daemon-relayed)
- [Workspace chip](conversation-shell.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — its `reset` action is one of the seven clears from here ([#531](../codebase/531.md), widened by [#593](../codebase/593.md), [#757](../codebase/757.md) and [#779](conversation-last-read-store.md)); the store-backed messages otherwise survive plain navigation untouched
- [Announced-model store](announced-model-store.md) / [#593](../codebase/593.md) — `clearAnnouncedModel` is the fifth member of `clearPairingDeps`, added after the store shipped dormant at #588 and the deferred clear it flagged
- [Conversation timeline holder](conversation-timeline-holder.md) / [#757](../codebase/757.md) —
  `clearAllTimelines` (the sixth member of `clearPairingDeps`) and `clearTimelineFor` (the fourth clear in
  `exitConversationDeps`), the keyed holder's first clears, both wired here immediately after each
  helper's pre-existing flat-store `reset`
- [Conversation last-read store](conversation-last-read-store.md) / [#779](https://github.com/pyrycode/pyrycode-desktop/pull/798) —
  `clearAllLastRead` (the seventh and last member of `clearPairingDeps`), the only member that reaches
  `localStorage` and the only one with an ordering constraint (after `clearAllTimelines`, last overall);
  see [§ The pairServer route](#the-pairserver-route-152) and [§ The last-read
  stamp](#the-last-read-stamp-conversationlastreadbridgets-777) above
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the IPC boundary `onUnpaired` ultimately calls; [#531](../codebase/531.md) moved the session reset that used to run inside its first caller (`runUnpair`) to this file
- [Thread timeline (conversation model)](thread-timeline.md) / [#530](../codebase/530.md) / [#531](../codebase/531.md) — `timelineStore`'s `reset` arm ([#528](../codebase/528.md)) gets its first production dispatch site via `activateConversation` and its second via `clearPairingScopedState`
- [Session-id store](session-id-store.md) / [#530](../codebase/530.md) / [#531](../codebase/531.md) — `clearSessionId` ([#529](../codebase/529.md)) gets its first production caller via `activateConversation` and its second via `clearPairingScopedState`
- [Conversation delete (transport)](conversation-delete.md) / [#652](../codebase/652.md) — the
  `conversationDeleted` event this file's `conversationDeletedBridge` is a second, independent
  subscriber to, and the wiring gap it closes (the thread used to stay open on a deleted discussion)
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
- [#531 codebase notes](../codebase/531.md) · Spec: `docs/specs/architecture/531-clear-pairing-scoped-state.md`
  — wraps `onUnpaired`/`onPairServerPaired` in `clearPairingScopedState`, the unconditional four-store
  clear for when the pairing itself ends rather than the active conversation merely changing.
- [#593 codebase notes](../codebase/593.md) · Spec: `docs/specs/architecture/593-announced-model-pairing-clear.md`
  — widens `clearPairingScopedState` to a fifth store, `announcedModelStore`, closing the deferral
  #588 flagged and #560 made observable.
- [Conversation last-read store](conversation-last-read-store.md) / #777 — the store this shell's
  `activateDeps.stampLastRead` and `useConversationLastRead()` write; source of the "open conversation's
  mark equals its own held item count" invariant and its two restore points.
  Spec: `docs/specs/architecture/777-open-conversation-last-read-write-path.md`.
- [Conversation timeline holder](conversation-timeline-holder.md) /
  [#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) — the store this shell's
  `activateDeps.markViewed` writes: the eviction-ranking write path that arms the ten-slice retained-
  timelines bound. See [§ The view stamp](#the-view-stamp-activateconversationts-786) above for the
  ordering rationale and the cross-wire hazard with `stampLastRead`.
- [#652 codebase notes](../codebase/652.md) · Spec:
  `docs/specs/architecture/652-delete-open-conversation-returns-to-list.md` — adds
  `exitActiveConversation` + `conversationDeletedBridge.ts`, a third id-gated clear-and-move helper
  beside `activateConversation` and `clearPairingScopedState`, driven by the daemon's `conversationDeleted`
  confirmation rather than a click.
- [#757 codebase notes](../codebase/757.md) · Spec: `docs/specs/architecture/757-timeline-clears.md`
  — widens `clearPairingScopedState` to a sixth store and `exitActiveConversation` to a fourth clear,
  both wired to the [conversation timeline holder](conversation-timeline-holder.md)'s first two write
  paths that remove rather than add.
- [#779 PR #798](https://github.com/pyrycode/pyrycode-desktop/pull/798) · Spec:
  `docs/specs/architecture/779-clear-last-read-marks-at-pairing-end.md` — widens `clearPairingScopedState`
  to a seventh and last store, [`conversationLastReadStore`](conversation-last-read-store.md)'s
  `clearAllLastRead`, the pairing-boundary counterweight to #776 persisting the marks; the ordering
  constraint (after `clearAllTimelines`, last overall) resolves half of #792's re-mint follow-up — see
  [§ The last-read stamp](#the-last-read-stamp-conversationlastreadbridgets-777) above for the half that
  stays open (`exitActiveConversation`).
- [#670 codebase notes](../codebase/670.md) · Spec: `docs/specs/architecture/670-two-pane-desktop-shell.md`
  — merges the `list`/`thread` arms into the two-pane desktop shell, adds `pairedShell.css` and
  `minWidth: 800` on the `BrowserWindow`, and (in a rework after a round-1 code-review FAIL) adds the
  `paneKey` prop that re-keys `ConversationScreen` on a sidebar-driven conversation switch.
