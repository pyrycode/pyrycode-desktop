# Paired shell — conversation exits and stamps

What happens to the open thread when its conversation is deleted or archived, and the last-read and view stamps written as the user moves between conversations.

Part of [Paired shell (list/thread two-pane desktop shell)](paired-shell.md); see that document for what the package does, its edge cases and its links.

## The delete exit (`exitActiveConversation.ts` + `conversationDeletedBridge.ts`, #652)

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
- **Clear, then navigate — four stores, not `clearPairingScopedState`'s eight.** `dispatchTimeline({
  type: 'reset' })` → `clearTimelineFor(conversationId)` ([#757](../codebase/757.md)) →
  `clearActiveConversation()` → `clearSessionId()`, then `navigateToList()` last, so no observer sees the
  Channel List rendered against the deleted discussion's thread state. The pairing has **not** ended here
  — the daemon connection is alive and the operator lands on a working Channel List — so `sessionStore`'s
  reset and `announcedModelStore`'s clear (both in `clearPairingScopedState`'s eight) are deliberately
  excluded: resetting the session store would blank a live connection status into a false disconnected
  state, and the announced model is daemon-scoped, not conversation-scoped.
  [`slashCommandListStore`'s `clearAllSlashCommandLists`](slash-command-list-store.md) (#955) is excluded
  for the same reason again: a published menu is daemon-scoped, not conversation-scoped, and one
  conversation being deleted says nothing about whether the workspace's verb menu is still valid.
  `clearAllTimelines` is excluded the same way — it is the pairing-boundary clear, and this helper drops
  one conversation's slice rather than every one. [`conversationLastReadStore`'s
  `clearAllLastRead`](conversation-last-read-store.md) (#779) is excluded for the identical reason: the
  marks are pairing-scoped, not conversation-scoped, so a conversation being deleted or archived leaves
  the operator's other chats live and their marks meaningful. `queueStore` is excluded too — the queued
  backlog is selected by matching the active conversation id, and a `null` active id yields the stable
  empty backlog via the existing `''`
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

## The archive exit (`conversationArchivedBridge.ts`, #653)

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

## The last-read stamp (`conversationLastReadBridge.ts`, #777)

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
reachable under `environment: 'node'`). See [§ #779 above](paired-shell-pair-server-route.md#the-pairserver-route-152) for the ordering
argument and why it must also run **last** overall, not merely after `clearAllTimelines`.

**`exitActiveConversation` was out of #779's scope and still has the bare hazard.** Deleting or archiving
the open conversation still writes and persists the spurious `0` with no floor to wipe it — that helper has
no whole-map clear to place after `clearTimelineFor`, only per-conversation ones. No acceptance criterion of
\#779 is violated (its ACs are pairing-boundary-scoped), and no acceptance criterion of #652/#653 is violated
either (the write still names only the open conversation, and `0` is its honest count at that instant), but
the hazard PR #792 first flagged is only half closed. A future ticket picking this up should start from the
code review on PR #792 and [#779's PR (#798)](https://github.com/pyrycode/pyrycode-desktop/pull/798) rather
than re-deriving either half.

## The view stamp (`activateConversation.ts`, #786)

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
