// The renderer archived-conversation exit bridge (#653) — the sibling of conversationCreatedBridge and
// conversationDeletedBridge, and one thing neither of them is: it OWNS NO WIRE ARM. There is no
// `conversationArchived` DaemonEvent to grep for, and none is added here. The signal is DERIVED from the
// daemon's authoritative conversation list — `conversationsReceived` — because the event that actually
// announces an archive, `conversationUpdated`, cannot say WHAT changed: its decoded payload is five fields
// with no archive flag (types.ts:1132; inboundMessage.ts:1073 names `is_archived` as a tolerated-but-not-
// copied key), and it fires identically on promote, rename, archive, unarchive and change-workspace — three
// of which are reachable on this very conversation from inside its own thread. Gating on its OCCURRENCE
// would bounce the operator out of the thread when they rename the open discussion or change its workspace,
// which is exactly what AC3 and AC4 exist to fail. `ConversationSummary.is_archived` (types.ts:892) is
// always present and `requireBoolean`-decoded in main, and `shouldRefreshList` already re-requests the list
// on every `conversationUpdated`, so the signal is already flowing and nothing new has to be plumbed.
//
// It SENDS NOTHING — the archive command is fired by the Channel Info sheet (ConversationScreen.tsx:1685),
// so there is no request half here. The two data-path helpers are React-free and injected, so the whole
// path is unit-testable with plain spies (the conversationDeletedBridge idiom);
// `useArchivedActiveConversationExit` is the thin React glue over them. Nothing here touches keys, sockets,
// ipcRenderer, or raw frames — it only subscribes through the preload bridge and consumes an already-typed
// event, and it MUST NOT log: the conversation `id` is the only field a diagnostic here would want, which
// ADR 0007's content-free rule forbids, and there is no observed failure to instrument.
import { useEffect, useRef } from 'react'
import type { DaemonEvent } from '@shared/ipc/events'
import type { ConversationSummary } from '@shared/wire/types'
import { translateConversationsEvent } from './conversationListBridge'

/**
 * The predicate: does the daemon's list say the conversation on screen is archived? Returns that id when
 * it does — rather than a boolean — so the call site has nothing to re-derive before handing it to
 * `exitActiveConversation`.
 *
 * A LEVEL, not an edge: "the active conversation's row is archived", evaluated on each list arrival with no
 * notion of "the operator clicked Archive". That is what makes AC1's trigger-agnostic phrasing hold for
 * free — any refresh that reveals the flag fires the exit, whoever caused it. It is also the only shape
 * that can ever pick up a SECOND client's archive: pyrycode#881 delivers `conversation_updated` by
 * `c.Reply`, correlated to the requester, with live fan-out explicitly out of scope, so another client's
 * archive produces no event here at all — the flag surfaces on this client's next `list_conversations`,
 * and a level predicate reads it then. (Eventually, not live; that is a daemon fan-out gap, not a client
 * design choice.)
 *
 * It reads exactly two fields, `id` and `is_archived`. The id is only ever COMPARED — never rendered,
 * logged, persisted or sent back — and `is_archived` is a decoded boolean used only as a branch condition.
 *
 * Four ways to get `null`, each a required behaviour rather than defensive padding:
 *  - `conversations === null` — NOT LOADED IS NOT ARCHIVED, the selectArchivedCount:71-72 posture.
 *  - `activeConversationId === null` — no conversation on screen, so nothing to exit.
 *  - no row carries the active id — an ABSENT conversation is a DELETE, not an archive; #652's bridge owns
 *    that case and this one must not double-claim it.
 *  - the row is present with `is_archived: false` — the AC3/AC4 arm: rename and change-workspace both fire
 *    a `conversation_updated` → re-list, and both leave the flag alone, so both must move nothing.
 *
 * Total — no throw path. It cannot thrash on a later re-list either: the first exit clears the active
 * conversation, so every subsequent evaluation reads a `null` id and short-circuits here. Nor can an
 * already-archived conversation be sitting open when it first runs — `partitionActive` filters archived
 * rows out of the Channel List (channelListViewModel.ts:44-49) and ArchiveScreen exposes only restore and
 * back (ArchiveScreen.tsx:55, 66), so no affordance opens one. Verified, not assumed; and were one ever to
 * be reachable, the predicate would evict it immediately, which is the safe direction anyway.
 *
 * What the `true` arm MEANS is precisely "the daemon's authoritative list says the conversation on screen
 * is archived" — NOT "my archive request succeeded". A daemon reporting the flag spuriously evicts the
 * thread, and that is bounded to availability: every move the exit performs is a clear, and the only actor
 * able to produce such a frame is the peer inside the Noise session, which can archive the conversation for
 * real anyway.
 */
export function archivedActiveConversationId(
  conversations: readonly ConversationSummary[] | null,
  activeConversationId: string | null
): string | null {
  if (conversations === null || activeConversationId === null) return null
  const row = conversations.find((conversation) => conversation.id === activeConversationId)
  return row !== undefined && row.is_archived ? activeConversationId : null
}

/**
 * Subscribe via the injected `onDaemonEvent`; each `conversationsReceived` whose rows show the conversation
 * on screen as archived invokes `onArchived` with its id; every other event, and every list that says
 * otherwise, no-ops. Returns the unsubscribe handle (the subscribeConversations off-handle idiom) so the
 * React binding can use it as its effect cleanup. The listener only invokes the callback — it never throws
 * into React, and it sends no command.
 *
 * `translateConversationsEvent` is IMPORTED from conversationListBridge rather than re-declared: this
 * bridge consumes the SAME arm as that one (unlike the created/deleted bridges, which each own a distinct
 * arm), so a second copy of that one `case` would be a second place to update. The `!== null` guards, not
 * truthiness checks, are the conversationListBridge.ts:82-84 doctrine — here they matter materially twice
 * over: an empty `conversations` array is a real loaded-zero list, and a degenerate `''` id is falsy but is
 * still a value the daemon emitted.
 *
 * Rows are read off the EVENT, not out of `conversationListStore`. Both are written by the same event so
 * they cannot disagree, but reading the event removes any dependence on whether `ConversationListData`'s
 * listener happened to run before this one — two independent subscriptions with no ordering contract
 * between them is exactly the arrangement conversationListBridge.ts:78-79 already documents. In practice
 * the store write lands first (that component mounts app-level, before the shell), which means the same
 * arrival that triggers the exit has already dropped the archived row from `partitionActive`: the operator
 * lands on a list that already excludes it, with no stale-row window at all.
 *
 * `getActiveConversationId` is a GETTER for the exitActiveConversation.ts:17-21 reason — the callback is
 * held in a ref refreshed by a bare (post-commit) effect, so closing over a render-time value could compare
 * against a stale previous. Injecting it (rather than importing the store) also keeps this module store-free
 * like its two siblings: bridges are event plumbing, PairedShell owns store wiring. PairedShell passes the
 * SAME getter that `exitConversationDeps` reads, so this gate and the helper's own id gate structurally
 * cannot disagree about which conversation is on screen.
 */
export function subscribeArchivedActiveConversation(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  getActiveConversationId: () => string | null,
  onArchived: (conversationId: string) => void
): () => void {
  return onDaemonEvent((event) => {
    const conversations = translateConversationsEvent(event)
    if (conversations === null) return
    const archivedId = archivedActiveConversationId(conversations, getActiveConversationId())
    if (archivedId !== null) onArchived(archivedId)
  })
}

/**
 * Wire the derived archive signal to a caller callback for the mounting component's lifetime — mounted in
 * PairedShell, so the subscription lives only while the paired shell is on screen (unpair unmounts it → the
 * off handle tears it down; re-pair mounts a fresh one). A list arriving while unmounted reaches no
 * listener, which is right: `clearPairingScopedState` has already cleared everything the exit would clear.
 * Subscribes exactly once (empty-dep effect, off-handle as cleanup — a StrictMode double-mount nets exactly
 * one live listener, the useDaemonEventBridge guarantee). The caller passes a fresh inline arrow each
 * render, so the latest `onArchived` is held in a ref and invoked from the listener; the subscription is
 * established once and never re-subscribes on PairedShell's route-flip re-renders. `getActiveConversationId`
 * is passed through inside that same effect and is deliberately NOT a dependency — it is a stable
 * module-scope-backed arrow at the only call site, and treating it as one would re-establish the
 * subscription on every render. `window.pyry` is dereferenced only inside the effect, so PairedShell stays
 * server-renderable.
 */
export function useArchivedActiveConversationExit(
  getActiveConversationId: () => string | null,
  onArchived: (conversationId: string) => void
): void {
  const onArchivedRef = useRef(onArchived)
  useEffect(() => {
    onArchivedRef.current = onArchived
  })
  useEffect(
    () =>
      subscribeArchivedActiveConversation(
        window.pyry.onDaemonEvent,
        getActiveConversationId,
        (conversationId) => onArchivedRef.current(conversationId)
      ),
    []
  )
}
