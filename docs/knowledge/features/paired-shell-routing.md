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
other than `pairServer`, so switching flows through the retained recovery sidebar cannot overwrite
the original return destination with the pairing route itself.

## The pure view + container (`PairedShell.tsx`)

`PairedShellView` is hookless and effectless. It renders the existing screens according to the
route and optional `recoveryServerId`; recovery reuses `pairServer`, without a new route or store.

| Route | Sidebar | Main content |
| --- | --- | --- |
| `list` | Mounted | Empty pane |
| `thread` | Mounted | `ConversationScreen`, keyed by `paneKey` |
| `pairServer` with a recovery target | Mounted | `Repair pairing` region containing `PairingScreen` |
| `pairServer` without a recovery target | Replaced | Full-screen `PairingScreen` |
| `settings` / `archive` | Replaced | The corresponding full-screen view |

The sidebar and composer both receive `onRepairHost(serverId)`. The shell checks that the target
is still saved, then opens recovery beside the sidebar. The composer resolves its conversation's
server from the stamped list; a sidebar repair needs no selected conversation. Both paths preserve
saved hosts, held timelines and conversation lists. The composer no longer calls `runUnpair`.
Explicit removal stays in [Settings](settings-screen-how-it-works.md#the-per-row-unpair-action-1162);
only removing the last server reaches `onUnpaired` and the app-level pairing clear.

`PairedShell` holds route, `paneKey`, pairing origin, recovery target and two lifetime refs locally.
It subscribes to saved servers, the session status map and the recovery host's label. The view receives
only the derived target label and rejection flag. The rejection notice appears only for that target's
`pairing-rejected` code, using the fixed copy documented in
[Session store](session-store.md#one-slot-per-server-since-1133).

### The pair-new-host plus and origin-aware cancel (#1303)

The Channels/Chats header plus and Settings' Pair another server row share `onOpenPairServer`.
These ordinary pairing entries still use the full-screen form. Host recovery uses the same pairing
input and fingerprint confirmation inside the main pane, with the sidebar available for navigation.

`pairServerReturn` records the current route when entering pairing from another route. Cancel sends
`pairServerCancelled` with that captured `returnTo`; switching recovery hosts or choosing the header
plus from recovery preserves the original return route instead of recording `pairServer` as its own
return destination. Re-entering recovery for the same host is a no-op. Switching hosts changes the
`PairingScreen` key and resets its form.

Cancel preserves `activeConversationStore` and `paneKey`, so it returns to the prior list or thread
(or Settings for an ordinary Settings entry). Held conversations survive. The thread itself remounts,
so screen-local composer drafts and scroll state are not part of that preservation guarantee.
`pairingChangeDeps` stays a per-render object because its `returnToPairingOrigin` callback must read
the current captured origin.

An active flow's successful confirmation returns to `list` without clearing held state. Existing
pairing confirmation saves by server ID; a same-server save replaces its credentials and moves that
record to the end of saved order. Registry reconciliation reconnects that changed record without an
app restart, leaving unchanged servers alone. Recovery keeps the sidebar mounted, so completion
explicitly calls `loadServerInfo` to refresh saved order rather than relying on a sidebar remount.

### Host recovery and navigation lifetime

Automatic opening considers only currently saved hosts, in saved order. As described in
[Session store](session-store.md#one-slot-per-server-since-1133), it waits for every host to settle,
requires at least one pairing rejection and no connected host, and picks the first rejected host.
The shell opens automatically only from `list` or `thread`; other routes defer the decision.

`recoveryConsumed` allows one automatic opening during an outage. Opening recovery consumes it;
leaving an actual recovery pane while no saved host is connected keeps it consumed. Repeated failure
events therefore cannot reopen a cancelled or navigated-away pane. Manual repair remains available.
Any connected saved host rearms automatic recovery, allowing a later rejection of the last usable
host to open it again.

Ordinary navigation while another host is connecting or unreported must not consume that first
opening. For example, selecting A's held thread while A is rejected and B is connecting leaves the
decision pending; if B settles offline, A's recovery still opens. This differs from dismissing an
already-open recovery pane, even though both paths can end on the same thread route.

`pairingGeneration` fences completion navigation. Each initiating flow captures its generation;
starting another flow, leaving pairing or unmounting the shell invalidates it. `onPairServerPaired`
always refreshes saved hosts, but only a current generation may clear the recovery target and
navigate to `list`. The authorized credential save and registry reconciliation still finish after
navigation. React ignoring a child's state update after unmount is insufficient: its captured
completion callback can still navigate a mounted parent.

`e2e/pairing-recovery.spec.ts` covers startup before any received list, keyboard reopening, cancel,
same-host replacement, healthy-host send/reply, suppression/rearm, deferred navigation with both
connecting and unreported hosts, and delayed confirmation after switching to a healthy thread or
another recovery host. The delayed-confirmation tests hold the real handler's reply, then wait for
the saved-order refresh before checking the newer draft or pairing input. Connection success alone
would not prove that the obsolete callback had run. Static renderer tests cover markup and the pure
selection helper; they cannot prove these effects or interleavings.

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

Recovery adapts `PairingScreen` to that 340px pane with reduced padding and hero inset, wrapping
notice/footer text and internal vertical scrolling. `.paired-shell__recovery` is positioned relative
to paint above the pane's wash. An unpositioned section looked visible and passed overflow checks,
but the wash intercepted Cancel; an actual click is required to verify this stacking behavior.
The focused recovery spec checks input and fingerprint confirmation at 800px, including overflow
and Cancel's viewport visibility.

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
- Nothing clears `paneKey` on exit. Delete, archive, and unpair all land on a route where the pane
  renders `null`, so the subtree is destroyed regardless of what the key holds — a stale key cannot
  preserve a subtree that no longer exists. **Since [#1303](https://github.com/pyrycode/pyrycode-desktop/issues/1303)
  this is no longer true of every exit**: cancelling a pairing flow opened from a section-header plus
  while a thread was open lands back on `thread`, so the pane comes back up on the same `paneKey` — which
  is correct, not stale, since the pairing route touches neither `activeConversationStore` nor this cell
  and cancel reaches no server. See § The pair-new-host plus and origin-aware cancel above.
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
    saved servers + per-host statuses -> automaticRecoveryTarget -> recovery pane
    sidebar Repair host / composer Re-pair -> openRecovery(saved server ID)
    sidebar conversation -> leaveRecovery -> activateConversation -> keyed thread
    Settings / Archive / Back -> leaveRecovery -> selected route
    pairing Cancel -> leaveRecovery -> captured origin
    pairing Confirm -> existing encrypted save -> registry reconciliation
      -> saved-host refresh -> generation check -> list if still the initiating flow
    Settings explicit Unpair -> unpairServer -> scoped clear
      -> app-level pairing clear and pairing screen only when no servers remain
```

Conversation activation and exits keep their existing ownership; see
[Conversation exits and stamps](paired-shell-conversation-exits.md). Recovery opening and cancellation
perform navigation only. They never erase a host or clear its held conversations.
