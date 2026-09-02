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
[below](paired-shell-routing.md#the-two-pane-desktop-shell-pairedshellcss-srcmainindexts-670) for the layout and the
conversation-switch bug the change surfaced.

Introduced in [#140](../codebase/140.md). Renderer-only, pure view-state — no keys, sockets, tokens,
or frames, so not security-sensitive.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the link points at the right file.

- [Routing and layout](paired-shell-routing.md) — The route model and its transition, the pure view and its container, the two-pane desktop layout, the seams at either end, and the data flow between them.
- [The pair server route](paired-shell-pair-server-route.md) — The pairServer route: how the shell reaches the pairing surface and what it does while it is there.
- [Conversation exits and stamps](paired-shell-conversation-exits.md) — What happens to the open thread when its conversation is deleted or archived, and the last-read and view stamps written as the user moves between conversations.

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
  also snapshotted into the [active-conversation store](conversation-shell-workspace-and-run-config.md#workspace-chip-278) so
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
  new module-scope import, not a driven `onUnpaired`/`onPairServerPaired` call. The eight-clear logic
  (four since #531, joined by `clearAnnouncedModel` at #593, `clearAllTimelines` at
  [#757](../codebase/757.md), `clearAllSlashCommandLists` at
  [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955), and `clearAllLastRead` at
  [#779](conversation-last-read-store.md)) is unit-tested directly on the pure helper in
  `clearPairingScopedState.test.ts`, including a dedicated regression case pinning #779's one ordering
  constraint (`clearAllLastRead` after `clearAllTimelines`, and after #955 also after
  `clearAllSlashCommandLists`, pinned by `mock.invocationCallOrder` rather than trusted from a comment).
  One residual: the "clear runs before the route flips" ordering has no executable assertion after
  [#531](../codebase/531.md) removed the one `unpairAction.test.ts` case that pinned it — low-stakes
  today since all eight writes are synchronous and batched into the same commit as the route change,
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
- [Workspace chip](conversation-shell-workspace-and-run-config.md#workspace-chip-278) / [#278](../codebase/278.md) — the same `conversationCreated` payload the FAB's nav callback carries, now also snapshotted into `activeConversationStore` for the empty-thread workspace chip
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the thread view `PairedShellView` renders on `'thread'`, gaining `onBack` here
- [Session store](session-store.md) — its `reset` action is one of the eight clears from here ([#531](../codebase/531.md), widened by [#593](../codebase/593.md), [#757](../codebase/757.md), [#779](conversation-last-read-store.md) and [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955)); the store-backed messages otherwise survive plain navigation untouched
- [Announced-model store](announced-model-store.md) / [#593](../codebase/593.md) — `clearAnnouncedModel` is the fifth member of `clearPairingDeps`, added after the store shipped dormant at #588 and the deferred clear it flagged
- [Slash-command-list store](slash-command-list-store.md) / [#955](https://github.com/pyrycode/pyrycode-desktop/issues/955) — `clearAllSlashCommandLists` is the eighth store added to `clearPairingDeps`, after the store shipped dormant at #954 following the same #588 → #593 precedent as the announced model; nullary and whole-map, reached only through this helper and never from a bridge arm or either call site, and sequenced to run before `clearAllLastRead` despite arriving after it
- [Conversation timeline holder](conversation-timeline-holder.md) / [#757](../codebase/757.md) —
  `clearAllTimelines` (the sixth member of `clearPairingDeps`) and `clearTimelineFor` (the fourth clear in
  `exitConversationDeps`), the keyed holder's first clears, both wired here immediately after each
  helper's pre-existing flat-store `reset`
- [Conversation last-read store](conversation-last-read-store.md) / [#779](https://github.com/pyrycode/pyrycode-desktop/pull/798) —
  `clearAllLastRead` (the seventh store added, and always the last to execute), the only member that
  reaches `localStorage` and the only one with an ordering constraint (after `clearAllTimelines` and,
  since #955, after `clearAllSlashCommandLists` too — both strictly before `clearAllLastRead` runs,
  last overall);
  see [§ The pairServer route](paired-shell-pair-server-route.md#the-pairserver-route-152) and [§ The last-read
  stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) above
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
- [#670 codebase notes](../codebase/670.md) · Spec: `docs/specs/architecture/670-two-pane-desktop-shell.md`
  — merges the `list`/`thread` arms into the two-pane desktop shell, adds `pairedShell.css` and
  `minWidth: 800` on the `BrowserWindow`, and (in a rework after a round-1 code-review FAIL) adds the
  `paneKey` prop that re-keys `ConversationScreen` on a sidebar-driven conversation switch.
