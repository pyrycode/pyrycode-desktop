# Paired shell — the pair server route

The pairServer route: how the shell reaches the pairing surface and what it does while it is there.

Part of [Paired shell (list/thread two-pane desktop shell)](paired-shell.md); see that document for what the package does, its edge cases and its links.

## The `pairServer` route (#152)

The `pairServer` case renders the pre-existing `PairingScreen` ([#55](../codebase/55.md)) with `presentation="modal"` over the mounted invoking view and **no**
`bridge` prop, so it falls back to its production `window.pyry` default — the same posture the app-shell
`pairing` route already uses. `PairingScreen` derefs `window.pyry` at render time (not in an effect), so
any test that server-renders the `pairServer` route needs a `globalThis.window = { pyry: {} }` stub, the
same one `App.test.tsx` already carries for its own `pairing` route. Unlike `thread`/`settings`, which
share `onBack`, `pairServer` binds to two distinct callbacks — `onPairServerPaired` and
`onPairServerCancelled` — because its two exits land on different routes (see above). `PairingScreen`
mounts fresh on every entry to `pairServer` (its own `useReducer(pairingReducer, initialPairingState)`)
and unmounts on every exit, so it always opens at an empty paste screen — no stale paste survives a route
change.

**Since [#1303](https://github.com/pyrycode/pyrycode-desktop/issues/1303), `pairServer` has a second
entry**: the plus on each [Channel List](channel-list.md) section header, wired to the identical
`onOpenPairServer` handler Settings' "Pair another server" row already used — see [Channel List — the
section header's pair-new-host control](channel-list-section-header-pair-control.md) for the control, and
[Paired shell — routing § The pair-new-host plus and origin-aware
cancel](paired-shell-routing.md#the-pair-new-host-plus-and-origin-aware-cancel-1303) for how a second
entry made `onPairServerCancelled`'s destination origin-dependent rather than the fixed `'settings'` it
used to resolve to. An active flow's successful confirmation goes home to `list`.

Host recovery uses this modal route with a saved-host target and retains the invoking view,
including its conversation draft and held history. The background remains inert until dismissal. It preserves the
same return origin when switching recovery hosts, and keys `PairingScreen` by the target so each
host gets a fresh form. Completion refreshes saved-host order, but a generation check allows only
its initiating flow to navigate: a confirmation finishing after asynchronous navigation still saves
credentials without replacing the newer pane. See [the current shell contract](paired-shell-routing.md#host-recovery-and-navigation-lifetime).

`case 'list'` originally rendered an in-file `PlaceholderList` throwaway (a bare `Open conversation`
button); [#141](../codebase/141.md) replaced it wholesale with the real
[Channel List home screen](channel-list.md) — see that doc for the store it reads and its row/section
behavior. Every row's `onClick` still opens the single active conversation (the placeholder's one
affordance, preserved), since per-conversation selection needs a transport path that doesn't exist yet.

`PairedShell` owns routing, pane identity and pairing lifetimes. See
[the current view/container contract](paired-shell-routing.md#the-pure-view--container-pairedshelltsx)
for its callbacks, recovery state and completion generation. `activateDeps` and `clearPairingDeps`
remain module-scoped effect wiring; `pairingChangeDeps` stays per-render because cancel captures
its origin. The helper decides whether to clear, while `clearPairingScopedState` owns what is cleared.

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
is a second, sibling hook mounted the same way, over a different main-local `notificationActivated`
event — nullary at #393, so its callback only ever dispatched `open`, with no `setActiveConversation`
call. [#1597](../codebase/1597.md) gave the event an optional opaque `token`; when it resolves to a
conversation still in the list, the callback opens that conversation through the shared
`openConversation` (see [Push notifications § Resolving the click to its own
conversation](push-notifications.md#resolving-the-click-to-its-own-conversation-1597)) instead of
plain `open`. `PairedShell`
itself still has no effects and no `window` deref — each hook's own effect is where `window.pyry` is
dereferenced — so the container stays server-renderable and `App`'s `pending`/`pairing`
neutral-first-paint invariant is untouched (`PairedShell` only mounts once the app-level route is
`conversation`).

**[#278](../codebase/278.md) widened the callback**, not the hook: `useConversationCreatedNav` already
delivered the decoded `created: ConversationCreatedPayload` argument, and the callback used to ignore
it (`() => dispatch(...)`). It now also records `created` before dispatching the same `open` transition.
No new subscription: this is the one existing `conversation_created` listener PairedShell already
mounted, doing one more thing on the event it already receives. See [Workspace
chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278) for the store and the render it feeds.

## Activation and pairing cleanup

`activateConversation` reads the current active record through a getter at invocation time, so
back-to-back created events cannot compare against stale render state. On an ID change it clears
the session and all four configuration/prompt stores, then records the payload. Every activation,
including same-ID reopening, requests fresh configuration; reopening preserves the held readings
and write state until replies arrive. See [activation and configuration](paired-shell-conversation-exits.md).
Creation opens the host-qualified thread runtime without `initializeCreatedTimeline`, `markViewed`,
flat timeline reset or local row-count stamping.

`applyPairingChange` invokes `clearPairingScopedState` only for `unpaired`. Pairing another host and
cancelling end no pairing, so they preserve existing hosts' state. The clear precedes navigation to
onboarding. Its module-scoped dependencies retain active conversation/session, announced model,
session facts, MCP status, command/model lists, conversation lists, queue backlogs, task rosters,
modal prompts and suppression/rejection state, activity, usage/context readings and session reset.
Legacy flat/keyed timeline reset/clear members were removed in #2028; the retained stores and
standalone producers are separately scoped for #2030.

`clearAllLastRead()` remains last. Although the removed count subscription can no longer re-mint
`0` during teardown, persisting local read-mark removal can still throw. Putting it earlier would
allow a storage failure to interrupt in-memory cleanup, leaving the ended pairing's state live.
Every newly added in-memory clear belongs before it. The analogous per-server helper samples
exclusive departed IDs before removing their list slot, exits a matching active chat and persists
only those IDs' local mark removal last. See [unpair cleanup](unpair-channel.md#the-three-renderer-callers).
Authoritative runtime and protected-storage removal keep their own host-qualified lifecycle/order.

Pure-helper tests retain real-store cleanup, idempotence and persistence-last assertions. Static
`PairedShell` renders do not execute its effects; mounted deletion/unpair and read-publication
coverage is recorded with [the #2028 suite counts](thread-runtime.md#navigation-retirement-validation).
