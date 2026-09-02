# Paired shell — the pair server route

The pairServer route: how the shell reaches the pairing surface and what it does while it is there.

Part of [Paired shell (list/thread two-pane desktop shell)](paired-shell.md); see that document for what the package does, its edge cases and its links.

## The `pairServer` route (#152)

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
chip](conversation-shell-workspace-and-run-config.md#workspace-chip-278) for the store and the render it feeds.

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
**[#779](conversation-last-read-store.md) added a seventh**,
[`conversationLastReadStore`'s `clearAllLastRead`](conversation-last-read-store.md#how-it-works) — how far
the operator had read into each conversation, persisted to `localStorage` since #776 and therefore the one
member of this set that reaches disk. Its position is not interchangeable with the rest: it must run
**after** `clearAllTimelines`, because that clear synchronously notifies [#777's open-conversation
listener](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777), which at that instant still sees the ended
pairing's conversation as open, finds its timeline slice already gone, and re-mints a persisted `0` mark for
it — running the marks clear afterwards wipes that re-mint in memory and on disk before this function
returns. It must also run **last** of all, because it is the only one with an external side effect
(`localStorage.setItem`) and therefore the only one that can throw; placed earlier, a throw would abort
`clearSessionId` and leave server A's session id live and addressable while the operator is on server B.
[#955](https://github.com/pyrycode/pyrycode-desktop/issues/955) later added an eighth,
[`slashCommandListStore`'s `clearAllSlashCommandLists`](slash-command-list-store.md) — every
conversation's published slash-command menu, nullary and whole-map like `clearAllTimelines`. Despite
arriving after `clearAllLastRead`, it is sequenced strictly *before* it: `clearAllLastRead`'s "last of
all" position is an execution constraint tied to its throw risk, not an arrival order, so every store
added after it — this one included — still has to land ahead of it in the call sequence. Skipping that
would let a `localStorage` throw from `clearAllLastRead` abort `clearAllSlashCommandLists`, leaving
server A's workspace-authored verb menu live for #681 to grey entries against.
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
[The last-read stamp](paired-shell-conversation-exits.md#the-last-read-stamp-conversationlastreadbridgets-777) below for the write path
this calls into.

**[#786](https://github.com/pyrycode/pyrycode-desktop/issues/786) widened `ActivateConversationDeps` with
a sixth required member**, `markViewed: (conversationId: string) => void`, called **last** — after
`stampLastRead` — also unconditionally and also **outside** the id-change gate. See
[The view stamp](paired-shell-conversation-exits.md#the-view-stamp-activateconversationts-786) below for the write path this calls into and
why the ordering relative to `stampLastRead` and `setActiveConversation` is the way it is.
