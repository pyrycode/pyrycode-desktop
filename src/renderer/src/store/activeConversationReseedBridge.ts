// The open chat's snapshot, kept in step with the daemon's list (#1184) — the second bridge to OWN NO
// WIRE ARM, and a near-copy of the first. `conversationArchivedBridge` derives the archived exit from
// `conversationsReceived` because the event that announces an archive cannot say what changed; this one
// derives a re-seed from the same arm for a plainer reason: nothing else ever writes
// `activeConversationStore` again. `activateConversation` records the payload at open time and the store
// then holds it untouched until another chat is opened, so a rename — from the sidebar today, and from
// the daemon's first-message auto-name once pyrycode#2159 lands — updates the sidebar row while the
// Channel info sheet, its rename prefill and the empty-thread workspace chip go on showing the name the
// chat had when it was opened.
//
// It SENDS NOTHING and NAVIGATES NOWHERE. The rename, archive, delete and change-workspace commands are
// fired by the Channel info sheet, `shouldRefreshList` already re-requests the list on every
// `conversation_updated`, and the reply already arrives — so the signal is flowing and nothing new is
// plumbed. Delete, archive and unpair keep owning their own transitions.
//
// The two data-path helpers are React-free and injected, so the whole path is unit-testable with plain
// spies (the conversationArchivedBridge idiom); `useActiveConversationReseed` is the thin React glue.
// Nothing here touches keys, sockets, ipcRenderer or raw frames — it subscribes through the preload
// bridge and consumes an already-typed event. It MUST NOT log: the only fields a diagnostic here would
// want are the conversation `id`, `name` and `cwd`, which ADR 0007's content-free rule forbids, and there
// is no observed failure to instrument.
import { useEffect } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationCreatedPayload, ConversationSummary } from '@shared/wire/types'
import { translateConversationsEvent } from './conversationListBridge'

/**
 * The whole decision: what should the open chat's snapshot become, given this list reply? The payload to
 * write, or `null` for "write nothing" — the `archivedActiveConversationId` shape, so the call site has
 * nothing to re-derive.
 *
 * A LEVEL, not an edge, for that predicate's reason: "the daemon's list describes the open chat
 * differently from the snapshot", evaluated on each arrival with no notion of who caused it. That is what
 * makes it cover a sidebar rename, a Save as channel, a change-workspace and pyrycode#2159's auto-name
 * with one rule and no trigger list.
 *
 * Five ways to get `null`, each a required behaviour rather than defensive padding:
 *  - `conversations === null` — not a list reply at all.
 *  - `active === null` — no chat open, so there is nothing to keep in step (AC3).
 *  - no row carries the open chat's id — a chat deleted elsewhere, or a reply from a paired server that
 *    does not list it. The snapshot is LEFT ALONE: this path never clears and never navigates, and
 *    `conversationDeletedBridge` / `conversationArchivedBridge` own those transitions (AC3).
 *  - two or more rows carry it — AMBIGUITY IS REFUSED, `filter` and a length check and never `find`.
 *    `serverIdForOpenConversation`'s shipped discipline, for its stated reason: the ids are the daemon's,
 *    so resolving to whichever row came first would let a confused or hostile daemon choose which name
 *    the sheet shows. An honest daemon pays nothing — it mints conversation ids as UUIDv4.
 *  - every field the payload holds is already equal (AC4). Not a micro-optimisation:
 *    `setActiveConversation` replaces the whole value, so an unconditional write on each routine refresh
 *    would hand every `activeConversation` subscriber a new object identity and re-render them all.
 *
 * `id` is deliberately absent from that comparison — it is the MATCH KEY, equal by construction — and its
 * invariance is the property that keeps this path non-destructive. The sheet sends `id` back with Archive
 * and Delete, and the only row this function can map is one already carrying the open chat's id, so no
 * re-seed can re-target those actions. The other five are compared with `===` because all five are
 * primitives (`string`, `boolean`, or `string | null`, where `null` is a distinct value and never an
 * absence).
 *
 * The result is a CLOSED SIX-FIELD RECONSTRUCTION, never the row passed through. `ConversationSummary` is
 * a structural superset of `ConversationCreatedPayload` — PairedShell's `onOpen` relies on exactly that
 * and hands a clicked row straight to the store — but a fresh literal cannot carry an unknown key from a
 * daemon row into the snapshot four surfaces read, which is `stampRows`' spread-order concern one layer
 * up and `parseConversationSummary`'s discipline one layer down. `is_archived` and `last_message_ts` have
 * no slot and are dropped; a reply moving only those is an unchanged refresh by the rule above.
 *
 * Total — no throw path, and it cannot thrash: an equal reply writes nothing, so a repeated refresh
 * settles after the first arrival.
 */
export function reseededActiveConversation(
  conversations: readonly ConversationSummary[] | null,
  active: ConversationCreatedPayload | null
): ConversationCreatedPayload | null {
  if (conversations === null || active === null) return null
  const matches = conversations.filter((conversation) => conversation.id === active.id)
  if (matches.length !== 1) return null
  const row = matches[0]
  if (
    row.is_promoted === active.is_promoted &&
    row.cwd === active.cwd &&
    row.name === active.name &&
    row.last_used_at === active.last_used_at &&
    row.workspace_label === active.workspace_label
  ) {
    return null
  }
  // Wire order (`ConversationCreatedPayload`'s own), so a reader can diff this literal against the type.
  return {
    id: row.id,
    is_promoted: row.is_promoted,
    cwd: row.cwd,
    name: row.name,
    last_used_at: row.last_used_at,
    workspace_label: row.workspace_label
  }
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `conversationsReceived` whose rows describe the open
 * chat differently re-seeds the snapshot through `setActiveConversation`. Every other event, and every
 * reply that says nothing new, no-ops. Returns the unsubscribe handle (the `subscribeConversations`
 * off-handle idiom) so the React binding can use it as its effect cleanup. The listener only dispatches —
 * it never throws into React, and it sends no command.
 *
 * `translateConversationsEvent` is IMPORTED from conversationListBridge rather than re-declared, for the
 * reason conversationArchivedBridge states: this bridge consumes the SAME arm as that one, so a second
 * copy of that one `case` would be a second place to update.
 *
 * IT IS NOT `activateConversation`. That helper resets the timeline, clears the session id and drops the
 * run configuration when the id differs — and here the id is the same by construction, so none of it is
 * owed; calling it would blank the thread the operator is reading. The only effect is this one store
 * write.
 *
 * THE `conversationUpdated` ARM IS DELIBERATELY NOT CONSUMED, though its payload carries every field the
 * snapshot holds and patching from it is one line away. That frame is the daemon announcing a change; the
 * `conversations` reply is the daemon's authoritative answer, and it is the one the main-side decode path
 * validates. Reading the announcement would put untrusted daemon text into the snapshot bypassing that
 * path — the security property `shouldRefreshList`'s docblock already states for the workspace arm.
 *
 * Rows are read off the EVENT, not out of `conversationListStore`. Both are written by the same event so
 * they cannot disagree, but reading the event removes any dependence on whether `ConversationListData`'s
 * listener happened to run before this one — two independent subscriptions with no ordering contract
 * between them, exactly as conversationArchivedBridge already documents. It is also what makes the reply
 * from ONE server the whole input: the app-wide union is never consulted, so a second paired server's
 * rows reach this decision only in that server's own reply (AC3).
 *
 * `getActiveConversation` is a GETTER, not a value threaded in, for `activateConversation`'s reason: the
 * open chat must be read at delivery time, so two replies arriving back to back each reconcile against
 * the snapshot as it stands. Injecting it (rather than importing the store) keeps this module store-free
 * like its siblings — bridges are event plumbing, PairedShell owns store wiring.
 *
 * CROSS-WIRE NOTE for a reviewer: `getActiveConversation` IS assignable to `setActiveConversation`'s slot
 * (TypeScript permits a function of fewer parameters, and a non-`void` return fits a `void` one), so a
 * swap compiles in that direction. The assertion that catches it is "the setter was called WITH the
 * mapped payload", never a bare `toHaveBeenCalled()`. The other direction does not compile: `void` is not
 * assignable to `ConversationCreatedPayload | null`.
 */
export function subscribeActiveConversationReseed(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  getActiveConversation: () => ConversationCreatedPayload | null,
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
): () => void {
  return onDaemonEvent((event) => {
    const conversations = translateConversationsEvent(event)
    if (conversations === null) return
    const reseeded = reseededActiveConversation(conversations, getActiveConversation())
    if (reseeded !== null) setActiveConversation(reseeded)
  })
}

/**
 * Wire the re-seed for the mounting component's lifetime — mounted in PairedShell, so the subscription
 * lives only while the paired shell is on screen (unpair unmounts it → the off handle tears it down;
 * re-pair mounts a fresh one). A list arriving while unmounted reaches no listener, which is right:
 * `clearPairingScopedState` has already cleared the very snapshot this would write.
 *
 * Subscribes exactly once (empty-dep effect, off handle as cleanup — a StrictMode double-mount nets
 * exactly one live listener, the useDaemonEventBridge guarantee). Both deps are passed through inside
 * that effect and are deliberately NOT dependencies: at the only call site they are `activateDeps`'
 * module-scope-backed arrows, stable for the app's lifetime, and treating them as dependencies would
 * re-establish the subscription on every one of PairedShell's route-flip re-renders. No ref indirection
 * is needed for the same reason — neither is a fresh inline arrow per render, which is what
 * `useArchivedActiveConversationExit` holds a ref for. `window.pyry` is dereferenced only inside the
 * effect, so PairedShell stays server-renderable.
 */
export function useActiveConversationReseed(
  getActiveConversation: () => ConversationCreatedPayload | null,
  setActiveConversation: (conversation: ConversationCreatedPayload) => void
): void {
  useEffect(
    () =>
      subscribeActiveConversationReseed(
        window.pyry.onDaemonEvent,
        getActiveConversation,
        setActiveConversation
      ),
    []
  )
}
