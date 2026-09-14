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
  | { type: 'pairServerCancelled'; returnTo: PairedRoute }
  | { type: 'pairServerPaired' }

export function nextPairedRoute(current: PairedRoute, nav: PairedNav): PairedRoute {
  switch (nav.type) {
    case 'open':                return 'thread'
    case 'openSettings':        return 'settings'
    case 'openArchive':         return 'archive'
    case 'back':                 return 'list'
    case 'openPairServer':      return 'pairServer'
    case 'pairServerCancelled': return nav.returnTo
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
`list` today: the two pairing exits carry distinct intents (cancel → return to wherever pairing was
launched from; a completed pair → go home to `list`, the new server's channel list), and only one of
those coincides with `back`'s current absolute resolution. Keeping them as their own arms is
forward-safe if `back` ever becomes stack-aware — a stack-aware `back` from `pairServer` would pop to
one fixed destination, which cannot be correct for both a cancel that must return to whichever surface
opened it and a completed pair that must always go home.

**[#1303](https://github.com/pyrycode/pyrycode-desktop/issues/1303) gave `pairServerCancelled` the
union's one payload**, `returnTo: PairedRoute`, and turned the arm's `'settings'` literal into
`nav.returnTo`. Until then the arm could return a literal because Settings' "Pair another server" row
was pairing's only entry, so "back to where it was launched from" and "back to `settings`" were the same
sentence. They stopped being the same sentence the moment the Channels/Chats section headers each grew a
plus that opens the identical flow (§ below) — cancel's destination became a function of *which surface*
was open when the flow started, and the reducer cannot answer that on its own: by the time
`pairServerCancelled` fires, `current` is always `'pairServer'`, which says nothing about where the
operator came from. The origin has to travel with the event, and the container is what records it — see
§ The pair-new-host plus and origin-aware cancel below. `returnTo` is typed as the whole `PairedRoute`
rather than a narrower origin union. The shell records an origin only when entering from a route
other than `pairServer`, so a replacement pairing interaction cannot overwrite
the original return destination with the pairing route itself.

## The pure view + container (`PairedShell.tsx`)

`PairedShellView` is hookless and effectless. It renders the existing screens according to the
route and optional `recoveryServerId`; recovery reuses `pairServer`, without a new route or store.

| Route | Sidebar | Main content |
| --- | --- | --- |
| `list` | Mounted | Empty pane |
| `thread` | Mounted | `ConversationScreen`, keyed by `paneKey` |
| `pairServer` | Preserved when present at origin; inert | Invoking view retained beneath `PairingScreen` in modal presentation |
| `settings` / `archive` | Replaced | The corresponding full-screen view |

The sidebar and composer both receive `onRepairHost(serverId)`. The shell checks that the target
is still saved, then opens recovery in the shared Pair modal over the invoking view. The composer resolves its conversation's
server from the stamped list; a sidebar repair needs no selected conversation. Both paths preserve
saved hosts, held timelines and conversation lists. The composer no longer calls `runUnpair`.
Explicit removal stays in [Settings](settings-screen-how-it-works.md#the-per-row-unpair-action-1162);
only removing the last server reaches `onUnpaired` and the app-level pairing clear.

`PairedShell` holds route, `paneKey`, pairing origin, recovery target and the `pairingGeneration` ref locally.
It subscribes to saved servers, the session status map and the recovery host's label. The view receives
only the derived target label and rejection flag. The modal rejection notice appears only for that target's
`pairing-rejected` code, using the fixed copy documented in
[Session store](session-store.md#one-slot-per-server-since-1133).

### The pair-new-host plus and origin-aware cancel (#1303)

The Channels/Chats header plus and Settings' Pair another server row share
`onOpenPairServer`. These entries and explicit host recovery use the same two-step
[Pair modal](pairing-input-screen.md#in-app-modal-presentation). Onboarding remains
owned by `App` and uses the default full-page presentation.

`pairServerReturn` records the current route when entering pairing from another route.
The view receives it as `pairingOrigin` and renders that background at the same element
position while `route === 'pairServer'`, with the modal as a sibling. Keeping both
position and `paneKey` stable preserves the actual conversation subtree, including
its unsent composer draft, rather than merely restoring its selected conversation ID.
The background remains mounted but native dialog inertness blocks pointer and keyboard
input, including sidebar navigation.

Cancel, header close and Escape before saving or during post-save pending/failure states send `pairServerCancelled` with
the captured `returnTo`. They preserve `activeConversationStore`, `paneKey`, held
history and the mounted invoking view; the modal restores focus to the invoker when
it remains available. Busy submission/confirmation rejects dismissal. Exiting unmounts
the pairing reducer, so reopening starts with empty fields. Recovery retains its target
identity and rejection explanation inside the modal; changing targets changes the
`PairingScreen` key. `pairingChangeDeps` stays a per-render object because its
`returnToPairingOrigin` callback must read the current captured origin.

An active flow returns to `list` only after fresh authentication of the saved host, without clearing held state. Existing
pairing confirmation saves by server ID; a same-server save replaces its credentials and moves that
record to the end of saved order. Registry reconciliation reconnects that changed record without an
app restart, leaving unchanged servers alone. The origin view remains mounted during pairing, so successful persistence
explicitly calls `loadServerInfo` to refresh saved order rather than relying on a sidebar remount.
That refresh does not dismiss pairing or indicate authenticated completion.

### Host recovery and navigation lifetime

Only explicit user actions open host repair: the sidebar's `Repair host` button or the composer's
Re-pair action. With saved hosts present, connection-status changes never open repair or change the
current view. This includes startup before any conversation list arrives, rejection of the last
connected host, repeated failures, and reconnection followed by another rejection. List and thread
views keep saved hosts and any held conversation rows visible even when none is connected.

Cancel returns to the captured origin, and later connection events never reopen repair. Likewise,
selecting a held thread while another host is connecting or unreported keeps that thread open when
the other host settles offline. Repair remains available through the explicit controls. Normal
connection retries, Pair new host and initial setup with no saved hosts retain their existing behavior.
The automatic-opening behavior introduced by [#1336](../../specs/architecture/1336-pairing-recovery.md)
is implementation history, superseded by [#1354](../../specs/architecture/1354-explicit-host-repair.md).

Onboarding, added-host pairing and manual repair share the
[pairing screen's authentication observer](pairing-input-screen.md#authentication-observation).
The main-retained identity returned by confirm selects a fresh per-host status; saving,
relay reachability, another host's connection or a pre-confirmation connected status
cannot complete the flow. The wait lasts at most 30 seconds after receiving save success
or Retry. Absence and timeout offer Retry on the same saved host through the existing
reconnect loop, without another save. Failures stay visible until user action; rejection
instructs Cancel and explicit manual pairing with a fresh code. No replacement
credentials are generated automatically.

Post-save Cancel, modal close and Escape retain the saved host and the invoking
conversation, draft and history. Unmount or a newer interaction disposes the observer's
subscriptions and timer. `PairingScreen` refreshes saved-host information after an
authorized save even if it has unmounted; this callback does not navigate. Only its
live observer's authenticated completion reaches the shell.

`pairingGeneration` fences completion navigation. Each initiating flow captures its generation;
starting another flow, leaving pairing or unmounting the shell invalidates it. `onPairServerPaired`
always refreshes saved hosts, but only a current generation may clear the recovery target and
navigate to `list`. The authorized credential save and registry reconciliation still finish after
navigation. React ignoring a child's state update after unmount is insufficient: its captured
completion callback can still navigate a mounted parent.

`e2e/pairing-recovery.spec.ts` covers unchanged startup/list/thread navigation after these status
changes, retained rows, timeline and current draft, keyboard and composer repair, cancel, same-host
replacement, healthy-host send/reply, and delayed confirmation after asynchronous navigation
and a subsequent switch to a healthy thread or another recovery host. A notification event
supersedes the modal in the late-result test; clicking the inert background cannot do so.
Tests that need Settings must first dismiss idle repair. Scope rejection-copy assertions
to the Pair dialog: the retained conversation can also display the same notice.
Before asserting that repair is absent or a draft is unchanged, wait for the delivered status or a following visible frame. Repeated failures may leave the status label unchanged;
a following frame proves delivery where an immediate absence assertion could pass too early.
The delayed-confirmation tests hold the real handler's reply, then wait for the screen's saved-order refresh
before checking the newer draft or pairing input. Connection success alone would not prove that the
late save response had been processed. Static renderer tests cover status labels, failed-row styling, the named
repair button and rejection notice; they cannot prove these effects or interleavings.

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
label unable to ellipsize no matter what `channels.css` said. The scroller's `overflow-x` (computed
`auto`, a side effect of its `overflow-y: auto` — that scroller is `.channel-list__tree` since
[#1443](https://github.com/pyrycode/pyrycode-desktop/issues/1443), `.channel-list` before it) does not
save it — a scroll container's automatic
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

Recovery now uses the native dialog's window-level top layer, rather than squeezing
pairing into the 340px chat pane. Its preferred 640px panel is constrained by viewport
margins and scrolls vertically on short windows. The focused modal/recovery specs
check overflow and scroll footer actions into view before clicking; static markup or
a bounding box alone cannot prove reachable controls.

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
  sidebar row click). It is recorded from the activation action rather than subscribed back from
  `activeConversationStore`; the shell's separate recovery subscriptions do not own pane identity.
- The nullary `open` (a push-notification click, [#393](../codebase/393.md)) deliberately does **not**
  touch `paneKey` — it carries no conversation payload and means "show the conversation that's already
  active," so the pane's identity hasn't moved.
- Nothing clears `paneKey` on exit. Delete, archive and unpair remove the conversation
  subtree through routing. In-app pairing preserves the thread at the same position
  and key beneath its modal, so idle cancellation preserves local state as well as
  the selected conversation. Successful pairing still goes to `list` and unmounts
  the thread; its held timeline survives. See § The pair-new-host plus and origin-aware cancel.
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
already-terminal-error-only control that opens [host recovery](#host-recovery-and-navigation-lifetime).
Explicit removal is in Settings.

## Data flow

```text
AppView (conversation)
  PairedShell
    per-host statuses -> status presentation + rejection notice for an already-open recovery modal
    sidebar Repair host / composer Re-pair -> openRecovery(saved server ID)
    sidebar conversation -> leaveRecovery -> activateConversation -> keyed thread
    Settings / Archive / Back -> leaveRecovery -> selected route
    pairing Cancel -> leaveRecovery -> captured origin
    pairing Confirm -> existing encrypted save -> registry reconciliation
      -> saved-host refresh (also after unmount)
      -> bounded selected-host authentication wait
      -> authenticated once -> generation check -> list if still the initiating flow
    verification failure -> sticky feedback -> Retry for absence/timeout, or Cancel
    post-save Cancel -> dispose wait -> captured origin; saved host retained
    Settings explicit Unpair -> unpairServer -> scoped clear
      -> app-level pairing clear and pairing screen only when no servers remain
```

Conversation activation and exits keep their existing ownership; see
[Conversation exits and stamps](paired-shell-conversation-exits.md). Recovery opening and cancellation
perform navigation only. They never erase a host or clear its held conversations.
