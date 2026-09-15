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
thread or nothing. `settings` and `archive` replace the whole shell. In-app pairing uses `pairServer`
to show a two-step modal over the mounted invoking view; explicit host recovery adds
a target server ID and rejection context inside that modal. Idle cancellation preserves
the conversation draft and held history. Onboarding keeps its full-page flow. See
[below](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the layout and the
conversation-switch bug the change surfaced.

Introduced in [#140](../codebase/140.md). Renderer-only, pure view-state — no keys, sockets, tokens,
or frames, so not security-sensitive.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Routing and layout](paired-shell-routing.md) — The route model and its transition, the pure view and its container, the two-pane desktop layout, the seams at either end, and the data flow between them.
- [The pair server route](paired-shell-pair-server-route.md) — The pairServer route: how the shell reaches the pairing surface and what it does while it is there.
- [Conversation exits and stamps](paired-shell-conversation-exits.md) — What happens to the open thread when its conversation is deleted or archived, the last-read and view stamps written as the user moves between conversations, and (#1166) the run-configuration and model-list requests fired on every activation.

## What it does

Conversation activation requests configuration only for a connected owner; it
never requests history. First and subsequent history pages require new
[upward thread input](chat-history.md#received-state-admission-and-ownership),
including after reconnect or reopening an evicted conversation.

The container mounts `createSavedListRestorer` for its lifetime, independently of
route changes. Saved identities can populate the sidebar without a connected host;
restoration never activates a conversation or dispatches navigation. Teardown
cancels pending admission handles. See [saved-list restoration and stale-read
admission](chat-history.md#received-state-admission-and-ownership).

Opening a host-stamped sidebar row invokes saved-timeline restoration regardless of
connection status. Explicit clicked coordinates survive active metadata refresh;
reconnect preserves restored rows and their recording ownership. See
[timeline admission and cancellation](chat-history.md#received-state-admission-and-ownership).

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
  cancelling returns to the captured origin; completing the active flow goes to `list` without clearing
  held conversations. Only explicit sidebar/composer repair opens recovery with a saved-host target;
  connection-status changes never open or reopen it or change the current view. Same-host confirmation
  replaces credentials and reconnects; a stale confirmation may finish
  saving but cannot navigate over a newer pane. See [recovery and navigation lifetime](paired-shell-routing.md#host-recovery-and-navigation-lifetime)
  and [Settings
  screen](settings-screen-how-it-works.md#the-pair-another-server-row-settingsscreentsx-152) for the entry row.
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
  also snapshotted into the [active-conversation store](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278) so
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
  as decoded cannot say *what* changed. See [below](paired-shell-conversation-exits.md#the-archive-exit-conversationarchivedbridgets-653).

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

## Edge cases and limitations

- **Thread-scoped overlays (Run configuration sheet, permission modal) cover the pane, not the window,
  since [#670](../codebase/670.md).** The sidebar stays clickable while one is open — see [the two-pane
  shell](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) above. A pre-existing
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
  new module-scope import, not a driven `onUnpaired`/`onPairServerPaired` call. The fourteen-store clear
  logic (four since #531, joined by `clearAnnouncedModel` at #593, `clearAllTimelines` at
  [#757](../codebase/757.md), `clearAllSlashCommandLists` at
  [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955), `clearAllModelLists` at
  [#977](https://github.com/pyrycode/pyrycode-desktop/issues/977), `clearAllLastRead` at
  [#779](conversation-last-read-store.md), `clearAllConversations` at
  [#1086](conversation-list-store.md#edge-cases-and-limitations) (§ AC5), `clearAllBacklogs` at
  [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138), `clearAllRosters` at
  [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139), `modalStore`'s `dispatch` at
  [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140), and `clearAllActivity` at
  [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145)) is unit-tested directly on the
  pure helper in `clearPairingScopedState.test.ts`, including dedicated regression cases pinning
  #779's and #977's ordering constraints (`clearAllLastRead` after `clearAllTimelines`, after
  `clearAllSlashCommandLists` since #955 and after `clearAllModelLists` since #977, each pinned by
  `mock.invocationCallOrder` rather than trusted from a comment). The helper itself still has exactly
  one caller as of [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) — unpair, via
  `applyPairingChange`'s `unpaired` arm — but its own test suite is unaffected, since it drives
  `clearPairingScopedState` directly rather than through a call site.
  The residual this bullet used to name — the "clear runs before the route flips" ordering had no
  executable assertion after [#531](../codebase/531.md) removed the one `unpairAction.test.ts` case that
  pinned it — is now closed, and not the way this bullet predicted. No jsdom harness landed; instead
  [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) lifted the three pairing-change
  callbacks out of `PairedShell`'s JSX into `applyPairingChange`
  (`src/renderer/src/applyPairingChange.ts`), a pure, React-free helper in the
  `activateConversation`/`exitActiveConversation`/`unpairAction` shape, and
  `applyPairingChange.test.ts` pins the unpair arm's clear-then-navigate order with
  `mock.invocationCallOrder` directly on the helper. The same lift is what makes AC1/AC3's negatives —
  "pairing another server clears nothing," "cancelling clears nothing" — assertable at all: before
  #1141 those were the absence of a call inside an inline arrow no test in this repo could invoke.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the outer router; `PairedShell` mounts under its `conversation` route
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — the real `list` view, replacing the placeholder described above; since [#670](../codebase/670.md) it is the shell's always-mounted sidebar rather than an alternative screen
- [Channel List § The host row](channel-list-host-row.md#the-host-row-channellisttsx-added-by-710-the-operators-label-by-834) /
  [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) — added the sidebar's `min-width: 0`
  above, needed once the host row started carrying an operator-typed name long enough to reach the
  sidebar's own min-content floor
- [Settings screen](settings-screen.md) / [#333](../codebase/333.md) — the third route, `settings`, and its entry button on the Channel List
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the fourth route, `pairServer` (#152), reuses this screen as-is
- [Archive screen](archive-screen.md) / [#347](../codebase/347.md) — the fifth route, `archive`, and its entry button sharing the Channel List's actions cluster
- [New-discussion FAB](new-discussion-fab.md) / [#242](../codebase/242.md) — the second `open` trigger, fired by a daemon-confirmed conversation create rather than a row click
- [Push notifications](push-notifications.md) / [#393](../codebase/393.md) — the third `open` trigger, fired by clicking a push notification (main-local, not daemon-relayed)
- [Workspace chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — its `reset` action is one of the fifteen clears from here ([#531](../codebase/531.md), widened by [#593](../codebase/593.md), [#757](../codebase/757.md), [#779](conversation-last-read-store.md), [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955), [#977](https://github.com/pyrycode/pyrycode-desktop/issues/977), [#1086](conversation-list-store.md), [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138), [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139), [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140), [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145) and [#1320](https://github.com/pyrycode/pyrycode-desktop/issues/1320)), run from unpair alone since [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) retired the pair-another-server caller; the store-backed messages otherwise survive plain navigation untouched
- [Announced-model store](announced-model-store.md) / [#593](../codebase/593.md) — `clearAnnouncedModel` is the fifth member of `clearPairingDeps`, added after the store shipped dormant at #588 and the deferred clear it flagged
- [Slash-command-list store](slash-command-list-store.md) / [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955) — `clearAllSlashCommandLists` is the eighth store added to `clearPairingDeps`, after the store shipped dormant at #954 following the same #588 → #593 precedent as the announced model; nullary and whole-map, reached only through this helper and never from a bridge arm or either call site, and sequenced to run before `clearAllLastRead` despite arriving after it
- [Model-list store](model-list-store.md) / [#977](https://github.com/pyrycode/pyrycode-desktop/issues/977) — `clearAllModelLists` is the ninth store added to `clearPairingDeps`, after the store shipped dormant at #974 repeating the #588 → #593 / #954 → #955 sequence a third time; nullary and whole-map like its slash-command twin, and sharper because the rows are claude-authored — a clear taking a conversation id would let a daemon-supplied id steer which machine's model identities survive the boundary. Reached only through this helper, never a bridge arm or either call site; sequenced to run before `clearAllLastRead` despite arriving after it
- [Conversation list store](conversation-list-store.md) / [#1086](https://github.com/pyrycode/pyrycode-desktop/issues/1086) — `clearAllConversations` is the tenth store added to `clearPairingDeps`, unlike its predecessors not because a dormant slice woke up but because keying `byServer` by paired server removed the self-heal that had excluded this store since #531 (a mount-time re-list used to overwrite the whole array regardless of which daemon answered; keying makes a departed server's slot latch instead). Nullary and whole-map like the clears above it; sequenced to run before `clearAllLastRead` despite arriving after it
- [Queue store](queue-store.md) / [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) — `clearAllBacklogs` is the eleventh store added to `clearPairingDeps`, for the same structural reason as #1086's: scoping the queue-backlog reconnect reset to the reconnecting server's own conversations retired the self-heal that had excluded `queueStore` since #531 (the reset used to clear the whole map on every `connected` edge, including a re-pairing's first one). `queueStore` was the first member of this set whose store the `connected` edge *also* clears — the reset covers a reconnect's listed conversations, this clear covers everything at a pairing change — a shape [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139)'s `backgroundTaskRosterStore`, [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)'s `modalStore` and [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145)'s `conversationActivityStore` each repeated. Nullary and whole-map; sequenced to run before `clearAllLastRead` despite arriving after it
- [Conversation activity store](conversation-activity-store.md) / [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145) — `clearAllActivity` is the fourteenth store added to `clearPairingDeps`, and the fifth name to move off the header's own self-healing list by the same argument (after queue, roster and modal): it never appeared in this set at all, on the ground that the `connected` edge's whole-map clear was the sole enforcement of the pairing boundary for it. Scoping that edge to the reconnecting server's own listed conversations (#1145) retired the self-heal identically to its three siblings — a new pairing's first `connected` resolves an empty conversation list, matches no held key, and hands the state back unchanged. Nullary and whole-map, placed beside `dispatchModal` so the four cross-server siblings stay adjacent; sequenced to run before `clearAllLastRead` despite arriving after it
- [Usage-limit store](usage-limit-store.md) / [#1320](https://github.com/pyrycode/pyrycode-desktop/issues/1320) — `clearAllUsageLimits` is the fifteenth store added to `clearPairingDeps`, and arrived by the original route rather than by a removed self-heal: it was pairing-scoped from the day it shipped, and its clear landed here alongside the store rather than in a later ticket, unlike every store above it back through `announcedModelStore`. Nullary and whole-map like its neighbours; latches for the roster's reason (no re-assertion mechanism exists at all, and the store's own two exits — the read-time expiry and the daemon-driven `allowed` clear — never reach a departed pairing's residue); sequenced to run before `clearAllLastRead` despite arriving after it
- [Reported-context store](reported-context-store.md) / [#1420](https://github.com/pyrycode/pyrycode-desktop/issues/1420) — `clearAllReportedContext` is the newest store added to `clearPairingDeps`, arriving by the same original route as its neighbour `usageLimitStore`: pairing-scoped from the day it shipped. Nullary and whole-map; latches for `usageLimitStore`'s reason with its one mitigation removed — this arm has no benign value to clear on at all, so the held reading has no exit but this one. The docblock's stated ordinal was dropped rather than corrected here — it had already rotted by one (`clearSessionFacts` was in the interface, missing from the list) — and the enumeration was completed instead of renumbered, so a future member cannot rot it a third time. Sequenced to run before `clearAllLastRead` despite arriving after it
- [Conversation timeline holder](conversation-timeline-holder.md) / [#757](../codebase/757.md) —
  `clearAllTimelines` (the sixth member of `clearPairingDeps`) and `clearTimelineFor` (the fourth clear in
  `exitConversationDeps`), the keyed holder's first clears, both wired here immediately after each
  helper's pre-existing flat-store `reset`
- [Conversation last-read store](conversation-last-read-store.md) / [#779](https://github.com/pyrycode/pyrycode-desktop/pull/798) —
  `clearAllLastRead` (the seventh store added, and always the last to execute), the only member that
  reaches `localStorage` and the only one with an ordering constraint (after `clearAllTimelines` and,
  since #955, after `clearAllSlashCommandLists`, and since #977 after `clearAllModelLists` too — all
  strictly before `clearAllLastRead` runs, last overall);
  see [§ The pairServer route](paired-shell-pair-server-route.md#the-pairserver-route-152) and [§ The last-read
  stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) above
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the IPC boundary `onUnpaired` ultimately calls; [#531](../codebase/531.md) moved the session reset that used to run inside its first caller (`runUnpair`) to this file; [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) gave `onUnpaired` a second caller — the Settings screen's per-server Unpair action, reaching this same callback only once no paired record remains; [#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163) put `runUnpair` on the identical condition, so both callers now reach `onUnpaired` only once nothing is left paired, and deleted the whole-collection channel the original unconditional flip used
- [Settings screen](settings-screen.md) / [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) — the `settings` case's third prop, `onUnpaired`, reused rather than given its own callback; see [Routing and layout § the pure view + container](paired-shell-routing.md#the-pure-view--container-pairedshelltsx) above
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
  timelines bound. See [§ The view stamp](paired-shell-conversation-exits.md#the-view-stamp-activateconversationts-786) above for the
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
  to a seventh store, [`conversationLastReadStore`](conversation-last-read-store.md)'s
  `clearAllLastRead`, the pairing-boundary counterweight to #776 persisting the marks, and always the
  last to execute; the ordering
  constraint (after `clearAllTimelines`, last overall) resolves half of #792's re-mint follow-up — see
  [§ The last-read stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) above for the half that
  stays open (`exitActiveConversation`).
- [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955) · Spec:
  `docs/specs/architecture/955-drop-slash-command-list-on-pairing-end.md` — widens
  `clearPairingScopedState` to an eighth store, [`slashCommandListStore`](slash-command-list-store.md)'s
  `clearAllSlashCommandLists`, closing the deferral #954 flagged and repeating the #588 → #593 precedent
  verb for verb; nullary and whole-map like `clearAllTimelines`, and — despite arriving after
  `clearAllLastRead` — sequenced strictly before it, since `clearAllLastRead`'s "last overall" position
  is an execution constraint, not an arrival order.
- [#977](https://github.com/pyrycode/pyrycode-desktop/issues/977) · Spec:
  `docs/specs/architecture/977-drop-model-list-on-pairing-end.md` — widens `clearPairingScopedState`
  to a ninth store, [`modelListStore`](model-list-store.md)'s `clearAllModelLists`, closing the
  deferral #974 flagged and repeating the #588 → #593 / #954 → #955 sequence a third time; nullary and
  whole-map, sharper than its slash-command twin because the rows are claude-authored rather than
  workspace-authored, and sequenced strictly before `clearAllLastRead` for the same reason.
- [#670 codebase notes](../codebase/670.md) · Spec: `docs/specs/architecture/670-two-pane-desktop-shell.md`
  — merges the `list`/`thread` arms into the two-pane desktop shell, adds `pairedShell.css` and
  `minWidth: 800` on the `BrowserWindow`, and (in a rework after a round-1 code-review FAIL) adds the
  `paneKey` prop that re-keys `ConversationScreen` on a sidebar-driven conversation switch.
- [#1139](https://github.com/pyrycode/pyrycode-desktop/issues/1139) · Spec:
  `docs/specs/architecture/1139-background-task-roster-reconnect-reset-scoped-to-server.md` — widens
  `clearPairingScopedState` to a twelfth store,
  [`backgroundTaskRosterStore`](background-task-roster-store.md)'s `clearAllRosters`. This store used to
  be the header's own named counter-example (a store the `connected` edge already cleared for its own
  reasons); [#1117](daemon-connection-routing.md) scoping that edge per server, then #1139 scoping this
  store's own reset to match, retired the self-heal that had kept it out — the same `queueStore` sequence
  [#1138](https://github.com/pyrycode/pyrycode-desktop/issues/1138) ran one week earlier, one notch
  harsher: this family has no re-assertion path of any kind, so every held roster (not merely a drained
  one) would otherwise latch across a pairing change. Nullary, whole-map, and sequenced strictly before
  `clearAllLastRead` for the same reason as its siblings.
- [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140) · Spec:
  `docs/specs/architecture/1140-scoped-modal-reconnect-clear.md` — widens `clearPairingScopedState` to a
  thirteenth store, [`modalStore`](modal-store-bridge.md)'s `dispatch`, carrying a new payload-free
  `reset` `ModalEvent`. The **fourth** name to move off the header's self-healing list by the same
  argument — `modalStore` had stood there longest, cited as "cleared by the `connected` edge, then
  repopulated." That claim died in both halves when [#1140](https://github.com/pyrycode/pyrycode-desktop/issues/1140)
  scoped the edge to the reconnecting server's own conversations ([modal-prompt
  model](modal-prompt-model.md)): a new pairing's first `connected` resolves an empty conversation list,
  matches no held prompt, and hands the state back unchanged. Unlike the roster this store *does* have a
  repopulation path (the daemon's connect-time reconcile re-sends still-outstanding prompts) — what it
  lacks is one that reaches a *departed* server's prompts, since the reconcile re-sends only the newly
  paired server's. A dispatched action rather than a `clearAll*` setter, because `dispatch` is
  `modalStore`'s only write path (the `dispatchTimeline`/`dispatchSession` shape, not the six nullary
  setters); the payload-free property is identical. Sequenced strictly before `clearAllLastRead` for the
  same reason as its siblings. Named the most ACTIONABLE residue in the set rather than the most
  sensitive: a retained permission prompt is a live control carrying a departed daemon's untrusted
  `title`/`prompt`/`options[].label`, answerable with a `modal_answer` the currently paired daemon never
  issued, and `selectHasOutstandingFor` lights the sidebar's input-required dot off the same slice — the
  phantom is visible before anyone clicks it.
- [Run configuration store](run-config-store.md) / [Model-list store](model-list-store.md) /
  [#1166](https://github.com/pyrycode/pyrycode-desktop/issues/1166) — `activateDeps` gains a seventh
  member, `requestConversationConfig`, firing `requestRunConfigSnapshot` and the new `requestModelList`
  on every activation so the composer footer is live from the moment a chat opens rather than only after
  a turn ends. See [§ The run-configuration and model-list
  ask](paired-shell-conversation-exits.md#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166).
- [#1141](https://github.com/pyrycode/pyrycode-desktop/issues/1141) · Spec:
  `docs/specs/architecture/1141-pairing-another-server-clears-nothing.md` — deletes the
  `clearPairingScopedState` call from the `pairedAnotherServer` path. Since #1117 and #1084 the
  background process holds one live connection per paired server, so adding a server does not end one —
  the docblock's stated rationale (a conversation id reused across servers) was false besides: the
  daemon mints conversation ids as UUIDv4. Lifts all three pairing-change callbacks
  (`onUnpaired`/`onPairServerPaired`/`onPairServerCancelled`) out of this file's JSX into
  [`applyPairingChange`](paired-shell-pair-server-route.md#the-pairserver-route-152)
  (`src/renderer/src/applyPairingChange.ts`), a pure helper in the `activateConversation` /
  `exitActiveConversation` / `unpairAction` shape, which is what makes the two negatives (pairing
  another server clears nothing; cancelling clears nothing) — and the unpair clear-then-navigate
  ordering — assertable at all in a repo with no DOM. `clearPairingScopedState` itself is unchanged
  beyond its prose; unpair still runs the full thirteen-store clear, in the same order. Carved out, at
  the time, `conversationActivityStore` (still blanked every server's turn state on any `connected` edge
  — filed as [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145), closed below) and flagged
  `announcedModelStore` (a single app-wide slot, left stale after a pair-another — filed as
  [#1146](https://github.com/pyrycode/pyrycode-desktop/issues/1146), closed below too) as known,
  deliberately unwidened residue.
- [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145) · Spec:
  `docs/specs/architecture/1145-scoped-activity-reset.md` — closes #1141's carve-out. Widens
  `clearPairingScopedState` to a fourteenth store,
  [`conversationActivityStore`](conversation-activity-store.md)'s `clearAllActivity`, and is the fifth
  name to move off the header's own self-healing list by the same argument #1138/#1139/#1140 each ran —
  the store never appeared in the set at all, since its own header called that the DECIDED answer on the
  ground that the `connected` edge's whole-map clear was the sole enforcement of the pairing boundary for
  it. Scoping that edge to the reconnecting server's own listed conversations (via the shared
  `selectConversationIdsFor`, its fourth consumer) retires the self-heal identically to the three
  siblings: a new pairing's first `connected` resolves an empty conversation list, matches no held key,
  and hands the state back unchanged — without the added pairing-boundary clear, a re-pair to the same
  box would show a finished turn's working dot indefinitely, with every other acceptance criterion green.
  Unlike its three siblings the new setter, `resetActivityFor`, was nearly free: `clearAllActivity`
  already existed in exactly the shape `clearPairingDeps` wanted, so this slice mints no new
  pairing-boundary clear — only the reconnect-side setter, the bridge's `originOf` copy, and the
  fourteenth dep-set member are new code, against four falsified docblocks to rewrite (this store's
  header, the bridge's `connected`-branch comment, the comment over `clearAllActivity` itself, and the
  re-armability test's comment) plus two more found outside that list by grepping the moved symbol
  (`runConfigLive.ts` and its test cited `clearAllActivity` as the reconnect discriminator; it is now
  `resetActivityFor`, the discriminator itself unchanged).
- [#1146](https://github.com/pyrycode/pyrycode-desktop/issues/1146) · Spec:
  `docs/specs/architecture/1146-scope-the-announced-model-store-by-conversation.md` — closes #1141's
  other carve-out, and does it differently from #1145's shape: rather than widening
  `clearPairingScopedState`'s reconnect-edge clear to a new store, it keys
  [`announcedModelStore`](announced-model-store.md) by `conversationId` so the stale-across-servers case
  is answered by construction — a record can only be read back under the conversation it was announced
  for. `clearAnnouncedModel` keeps its name, its nullary signature, and its place in this file's
  `ClearPairingScopedStateDeps` set entirely unchanged; only its body became a whole-map drop instead of a
  single-record reset, so this file and `PairedShell` needed no edit at all.
