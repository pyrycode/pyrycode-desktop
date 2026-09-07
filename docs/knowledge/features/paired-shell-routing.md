# Paired shell — routing and layout

The route model and its transition, the pure view and its container, the two-pane desktop layout, the seams at either end, and the data flow between them.

Part of [Paired shell (list/thread two-pane desktop shell)](paired-shell.md); see that document for what the package does, its edge cases and its links.

## The route model + transition (`pairedRoute.ts`)

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

## The pure view + container (`PairedShell.tsx`)

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
    case 'settings':
      return (
        <SettingsScreen
          onBack={props.onBack}
          onPairAnother={props.onOpenPairServer}
          onUnpaired={props.onUnpaired}   // #1162 — the SAME callback the thread case hands ConversationScreen
        />
      )
    case 'pairServer': return <PairingScreen onPaired={props.onPairServerPaired} onCancel={props.onPairServerCancelled} />
    case 'archive':    return <ArchiveScreen onBack={props.onBack} />
    default:           return assertNever(props.route)
  }
}
```

[#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) gave the `settings` case a third prop,
reusing `onUnpaired` rather than a callback of its own: the Settings screen's per-server Unpair action
([Settings screen § the per-row Unpair action](settings-screen-how-it-works.md#the-per-row-unpair-action-1162))
reaches it only when its own erase leaves no paired record behind, at which point the app's pairing has
genuinely ended and the existing `applyPairingChange(pairingChangeDeps, 'unpaired')` clear-then-navigate
below applies exactly as it does from `thread`. Forgetting one of several servers never reaches this
prop — it stays inside the shell. **[#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)
put the `thread` case's own Re-pair control on the identical condition**, so "exactly as it does from
`thread`" is no longer true only because the old whole-collection erase always ended the pairing — both
callers now reach `applyPairingChange('unpaired')` for the same reason, one copy of the remaining-count
rule (in `runUnpairServer`) that `runUnpair` delegates to rather than restates. See [Unpair
channel](unpair-channel.md).

Every route renders a real view (no `null` arm, unlike `AppView`'s `pending` case) — the paired region
always has *something* to show. The `settings` and `archive` cases both reuse the shared `onBack`
unchanged — see [Settings screen](settings-screen.md) and [Archive screen](archive-screen.md) for the
scaffolds they render, and both still replace the **whole** shell (sidebar included), which is what
makes "still open over both panes" (#670's AC5) cost zero lines in this file.

## The two-pane desktop shell (`pairedShell.css`, `src/main/index.ts`, #670)

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
  background-color: var(--color-surface);
  background-image: radial-gradient(ellipse 78.8% 117% at 47.6% 29.7%,
    var(--color-primary-container) 0%, transparent 70%);  /* the backdrop's glow, #1058 */
}
.paired-shell__sidebar,
.paired-shell__pane { position: relative; border-radius: var(--radius-xs); overflow: hidden; }  /* the card box, #1058 */
.paired-shell__sidebar::before,
.paired-shell__pane::before { content: ''; position: absolute; inset: 0; background: var(--color-scrim); opacity: 0.3; }  /* the wash, #1058 */
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
\#834 gave the [sidebar's host row](channel-list-host-row.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834)
an operator-typed name up to `MAX_HOST_LABEL_LENGTH` (128) with `white-space: nowrap`: a nowrap string's
min-content size is the whole string, measured at ~1063px, which took the sidebar with it and left the
label unable to ellipsize no matter what `channels.css` said. `.channel-list`'s `overflow-x` (computed
`auto`, a side effect of its `overflow-y: auto`) does not save it — a scroll container's automatic
minimum size is 0 for *itself*, but its min-content *contribution* to an ancestor is still
content-derived. `.channel-list__title` and `.channel-list__workspace-label` are nowrap too and had the
same latent reach; this one declaration pins all three. Landed as its own commit (d6fdc3a) alongside
\#834's `ChannelList.tsx`/`channels.css` changes, kept separable for review since it touches a different
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

**The pane card (#1058, [architecture spec](../../specs/architecture/1058-pane-cards-and-backdrop-glow.md)).** Both wrappers now draw the Figma's card: a
`--color-scrim` wash at 0.3 opacity on a `::before`, a `var(--radius-xs)` (6px) corner, and
`overflow: hidden` to clip content at that corner. `.channel-list` and `.conversation` used to each
paint `--color-surface` on themselves — the same colour as this shell's own backdrop — which is exactly
why a wash on the wrapper `<div>`s would have been painted over; both screens dropped that background
(one deletion each) so the wrapper's card shows through, and stayed otherwise unedited. This was #670's
own deferral, and its file header had named the successor that never came ("lands with the sidebar-tree
and composer tickets that own each pane's interior") — #1058 is that successor and retired the note.

`.channel-list` needed a second edit beyond the deletion: `position: relative`, a stacking fix rather
than decoration. An absolutely positioned `::before` at `z-index: auto` paints above every
non-positioned descendant, and `.channel-list__section-header`, `.channel-list__host` and the
workspace label were all unpositioned — left alone, the wash would have sat *over* them while the
already-`position: relative` `.channel-list__row`s stayed bright, a worse defect than the flat sheet it
replaced. `position: relative` lifts the whole subtree above the wrapper's `::before` in paint order,
the same idiom `.composer__input`/`.composer__row::before` and `.pairing-field__row` already use in this
file family; it does **not** add a `z-index`, so it doesn't turn `.channel-list` into a stacking context
and the sticky FAB/actions cluster (`z-index: 1`) are unaffected. `.conversation` needed nothing here —
it was already `position: relative` for the run-config sheet. Neither `position: relative` nor
`overflow: hidden` on the wrappers touches the containing block for `position: fixed` descendants, so
`.save-as-channel-overlay` and `.rename-conversation-overlay` (both genuinely `fixed`, on purpose) still
escape the sidebar and cover the window — `overflow: hidden` only clips a descendant whose containing
block is the clipping ancestor, and `fixed`'s containing block is the viewport regardless.

**A corrected claim about `.paired-shell` itself, from the same ticket's build.** The plan for #1058
reasoned that `filter`/`backdrop-filter`/`will-change`/`contain`/`clip-path` on `.paired-shell` would
make it the containing block for those two fixed overlays and break them — which is why the backdrop's
gradient is `background-image` rather than one of those. Measured during the build: that specific claim
is false for `.paired-shell`, because it already spans the whole window — `contain: paint` was tried
there and both overlays kept working, since making the containing block for a `fixed; inset: 0` box
equal to the box it already occupies changes nothing observable. The real hazard is one level down, on
`.paired-shell__sidebar`/`.paired-shell__pane` — a column-or-pane-sized element, where the same property
would resize a would-be-window-covering overlay down to one pane and then `overflow: hidden` would clip
it. `background-image` for the gradient is still the right call, but for that narrower reason; anyone
tempted to reach for `filter`/`contain`/etc. on the two pane wrappers should read this as the reason not
to. Detector: `e2e/paired-shell-card.spec.ts` hit-tests a point over the chat pane while
`.rename-conversation-overlay` is open, rather than trusting `boundingBox()` — a clipped element still
reports its full layout box, so only hit-testing (or an unclipped-position screenshot) can see the
failure `overflow: hidden` would cause here.

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

### The conversation-switch remount bug and the `paneKey` fix

Mounting the sidebar beside the thread made a new transition reachable: clicking a *different*
conversation's row while a thread is already open. `nextPairedRoute('thread', 'open')` is absolute, so
the route stays `thread` — the ternary above keeps returning `<ConversationScreen>` at the same
position, and React **preserves that subtree** instead of remounting it. That path did not exist before
\#670 (the sidebar was unmounted whenever a thread was up), and every piece of `ConversationScreen`'s
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

## The app-shell seam (`App.tsx`)

The `conversation` case in `AppView` swaps its direct `<ConversationScreen>` render for
`<PairedShell>` — see [App shell § the pure view](app-shell.md#the-pure-view-appview-exported-from-apptsx).
Everything else in the app shell (`pending`/`pairing`, the launch query, `onPaired`/`onUnpaired`) is
unchanged; `PairedShell` nests *under* the `conversation` route, not beside it.

## The thread's back affordance (`ConversationScreen.tsx`)

`ConversationScreenProps` gained `onBack?: () => void` — the exact `onUnpaired?` precedent
([#166](../codebase/166.md)): optional and gated, so a bare `<ConversationScreen />` (no shell, no
`onBack`) keeps today's DOM output identical, satisfying AC3 ("no behavioral change" to the existing
screen). An in-file `BackControl({ onBack })` mirrors the (then-live, since #1061-deleted)
`UnpairControl` idiom, returning `null` when `onBack` is absent and, when present, an icon-only 48px
`<button aria-label="Back">` holding a 24px inline `arrow_back` SVG glyph (Figma node 16-11,
`on-surface` color — the `.composer__send` inline-SVG precedent, no remote asset fetch). Rendered as the
**first child** of `.conversation` — at the time of this ticket, before the `UnpairControl` header row
that `UnpairControl` idiom implied. #1061 deleted that row outright (no header-row unpair entry point
exists today); the composer's Re-pair affordance now lives inside `ComposerErrorSlot`, an
already-terminal-error-only control (see [Unpair channel § The two renderer
callers](unpair-channel.md#the-two-renderer-callers)), not a persistent header row `BackControl` sits
beside.

## Data flow

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
                                                  ComposerErrorSlotControl Re-pair (#1163) → runUnpair(serverIdForOpenConversation(…)) → runUnpairServer → window.pyry.unpairServer(serverId)
                                                    ok + servers remain   → serverInfoStore re-read/written
                                                                             → clearServerScopedState(serverScopedClearDeps + navigateToList: onBack)  ← #1196
                                                                               departed rows + threads dropped; open chat (always this server's, per
                                                                               serverIdForOpenConversation) exited via exitActiveConversation → dispatch{back}
                                                    ok + servers empty    → onLastServerUnpaired() → applyPairingChange(deps,'unpaired')
                                                                             → clearPairingScopedState(clearPairingDeps)  ← same #531 clear as settings' unpair
                                                                               App sets route='pairing'
                                                    error/rejected/no resolvable server → dispatch{failed}, nothing cleared, nothing navigated
                                                  : null   ← #670, genuinely empty, no placeholder

  activateConversation(activateDeps, conversation):  ← #530 (src/renderer/src/activateConversation.ts)
    previous = activateDeps.getActiveConversation()
    if previous?.id !== conversation.id:
      activateDeps.dispatchTimeline({type:'reset'})   ← #528, clears timelineStore
      activateDeps.clearSessionId()                    ← #529, clears sessionIdStore
    activateDeps.setActiveConversation(conversation)    ← unconditional, both branches
    activateDeps.stampLastRead(conversation.id)          ← #777, unconditional, OUTSIDE the gate too
    activateDeps.markViewed(conversation.id)             ← #786, unconditional, OUTSIDE the gate
    activateDeps.requestConversationConfig(conversation.id)  ← #1166, unconditional, OUTSIDE the gate, LAST
                                                                  → requestRunConfigSnapshot + requestModelList,
                                                                    re-asking for what clearSessionId just wiped
                            route='settings' → SettingsScreen (pure, no store) + BackControl — [←] → dispatch{back} (#333)
                                                PairAnotherServerRow → dispatch{openPairServer} (#152)
                                                ServerRowControl per-row Unpair (#1162) → runUnpairServer → window.pyry.unpairServer(serverId)
                                                  ok + servers remain   → serverInfoStore re-read/written
                                                                           → clearServerScopedState(serverScopedClearDeps + navigateToList: no-op)  ← #1196
                                                                             departed rows + threads dropped; an open chat belonging to the departed
                                                                             server is exited (exitActiveConversation), but Settings stays on screen —
                                                                             `nextPairedRoute`'s only exit from 'settings' is the already-absolute 'back'
                                                                           shell stays on 'settings'
                                                  ok + servers empty    → onUnpaired() → applyPairingChange(deps,'unpaired')
                                                                           → clearPairingScopedState(clearPairingDeps)  ← same #531 clear as thread's unpair
                                                                             App sets route='pairing'
                                                  error/rejected        → row returns to idle, nothing cleared, nothing navigated
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
    clearPairingDeps.clearAllSlashCommandLists()                ← #955, clears slashCommandListStore (every menu)
    clearPairingDeps.dispatchSession({type:'reset'})           ← #166, clears sessionStore
    clearPairingDeps.clearAllLastRead()                        ← #779, LAST — clears conversationLastReadStore
                                                                   (in memory AND on disk), after clearAllTimelines
                                                                   so #777's re-mint of the open conversation's
                                                                   mark is wiped rather than persisted
    (unconditional — no id gate, unlike activateConversation above; the ordering constraints among the
     eight are clearAllLastRead after clearAllTimelines and after clearAllSlashCommandLists, and last
     overall — see #779 and #955 above)
```

A `conversationCreated` daemon event reaches `dispatch({ type: 'open' })` independently of any row
click — see [the new-discussion FAB](new-discussion-fab.md) for the bridge that fires it. A clicked
push notification reaches the same `dispatch({ type: 'open' })` the same way, independently of both —
see [Push notifications](push-notifications.md#clicking-the-notification-393) for that bridge.

See [Paired shell — conversation exits and stamps § The run-configuration and model-list
ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166)
for why `requestConversationConfig` is one member firing two requests, why it runs last, and the
late-reply attribution gap it widened per-occurrence — closed client-side by #1176, see [Run config
store § Conversation-attributed since #1176](run-config-store.md#conversation-attributed-since-1176).

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
