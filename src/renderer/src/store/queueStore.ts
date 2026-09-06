// The daemon's queued-message backlog, kept live as one unidirectional source of truth for the queue
// render slice (#294) and the reconcile-on-connect slice (#197). Pure renderer state — no IPC, no
// preload bridge, no transport. The data path (queueBridge.ts) observes the typed `queueState` daemon
// event (#292 decodes the `queue_state` snapshot) and writes the arriving backlog here via the single
// setter; #294 reads it through the selector factory.
//
// A dedicated store (the sessionIdStore / conversationListStore precedent), NOT a session-store facet:
// queue_state is daemon STATE, not part of claude's turn stream (SSOT pyrycode #720), so it gets its
// own store and is never folded into the thread-timeline reducer. It mirrors sessionIdStore's
// DI-factory → singleton → hook → selector structure and runSettingsWriteStore's ReadonlyMap
// copy-on-write, but holds the wire QueuedItem[] backlog VERBATIM in snake_case — no parallel camelCase
// renderer type, no per-field remap (the conversationListStore posture) — so the slice stays drift-free
// against the mobile wire contract.
//
// Keyed by `conversationId`, NOT a single flat backlog: each queue_state is REPLACEMENT-truth for its
// OWN conversation only, and on (re)connect the daemon unicasts one queue_state per non-empty
// conversation (pyrycode #878/#879), so several snapshots for DIFFERENT conversations can arrive in
// sequence — a flat "hold the last snapshot" slot would let one clobber another. Keying holds each
// backlog independently. A single setter rather than a reducer: there is exactly one mutation ("record
// the latest snapshot for a conversation"), so a discriminated-union action set would be a one-member
// union — ceremony without benefit. Unidirectional is preserved: read-only selectors, one write path,
// and `setBacklog` is invoked only by the subscription wiring, never two-way-bound from a component.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { QueuedItem } from '@shared/wire/types'

/** The write unit — one conversation's queue_state snapshot = the `queueState` daemon-event arm minus
 *  its `type` tag. Imported by the bridge, which builds it from the event. `queued` is the wire backlog
 *  held by reference (enqueue-ordered, snake_case), never copied or coerced. */
export interface QueueSnapshot {
  conversationId: string
  queued: readonly QueuedItem[]
}

/** The whole queue state: each conversation's latest backlog, keyed by `conversationId`. A key absent
 *  from the map means "no snapshot seen for that conversation yet" (AC3, reads as empty via the
 *  selector). `ReadonlyMap` signals the setter REPLACES the map, never mutates it in place. */
export interface QueueState {
  backlogs: ReadonlyMap<string, readonly QueuedItem[]>
}

/** Store shape = state + the two mutation entry points: record one conversation's snapshot, and drop
 *  the reconnecting server's backlogs (#197, scoped by #1138). Still two named setters, not a
 *  discriminated-union action set — that would be ceremony for two operations. */
export type QueueStore = QueueState & {
  setBacklog: (snapshot: QueueSnapshot) => void
  resetBacklogsFor: (conversationIds: ReadonlySet<string>) => void
}

export const initialQueueState: QueueState = { backlogs: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setBacklog` records the snapshot's
 * `queued` under its `conversationId` via copy-on-write (the runSettingsWriteStore idiom): clone the
 * map, set the key, replace. REPLACEMENT truth (AC2) — the held list for a key is always exactly the
 * latest snapshot's `queued`, no merge / append / dedupe. `queued` is stored VERBATIM by reference (no
 * coercion, no validation — #292 owns the fail-closed decode). The write is unconditional: an empty
 * `queued: []` sets that key to `[]` ("the daemon says this conversation's backlog is now empty" — the
 * AC2 clear case); it does NOT delete the key (per-conversation stale-key clearing is a `setBacklog []`,
 * not `resetBacklogsFor`).
 *
 * `resetBacklogsFor` (#197, scoped by #1138) is the reconnect reconcile: the relay re-emits `connected`
 * on every (re)handshake, and the daemon re-sends one queue_state per NON-EMPTY conversation, so the
 * client drops that server's held backlogs and lets those re-sends repopulate via `setBacklog`.
 *
 * SCOPED, not wholesale. #197 shipped this as a nullary clear of the WHOLE map, which was right while
 * the app had one connection; since #1117 it holds one per paired server and `connected` means "THIS
 * server's connection came back", so a whole-map clear discarded the other server's backlogs and
 * nothing ever put them back — only the reconnecting server re-sends. The caller resolves which
 * conversations belong to the reconnecting server from the server-keyed conversation list (#1086's
 * `selectConversationIdsFor`) and hands the ids across; the ids are therefore CLIENT-HELD, never a
 * daemon-supplied field naming a server. A conversation this store holds a backlog for that appears in
 * no server's list is left alone — the accepted consequence of scoping by the list.
 *
 * Iterates the HELD keys, not the id set, so the work is bounded by what this store holds rather than
 * by the server's conversation count. Copy-on-write like `setBacklog` (never mutate `s.backlogs` in
 * place), and every surviving slot comes back BY REFERENCE, so a component watching another
 * conversation sees `Object.is` true and does not re-render. #197's `size === 0` short-circuit
 * generalises: when NO held key is listed the state object is handed straight back, so zustand's
 * `Object.is` fires and a first connect, an all-drained reconnect and a reconnect of a server holding
 * nothing here all wake no listener at all (the #415 empty-slice no-op twin).
 */
export function createQueueStore(init: QueueState = initialQueueState) {
  return createStore<QueueStore>((set) => ({
    ...init,
    setBacklog: (snapshot) =>
      set((s) => {
        const next = new Map(s.backlogs)
        next.set(snapshot.conversationId, snapshot.queued)
        return { backlogs: next }
      }),
    resetBacklogsFor: (conversationIds) =>
      set((s) => {
        const doomed = [...s.backlogs.keys()].filter((id) => conversationIds.has(id))
        if (doomed.length === 0) return s
        const next = new Map(s.backlogs)
        for (const id of doomed) next.delete(id)
        return { backlogs: next }
      })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #294 reads. */
export const queueStore = createQueueStore()

/** Narrow-slice React binding for #294. Selecting a single backlog slice avoids cross-facet re-renders. */
export function useQueueStore<T>(selector: (s: QueueStore) => T): T {
  return useStore(queueStore, selector)
}

/** A module-level stable reference for the empty default, so the AC3 "no snapshot yet" read never
 *  churns re-renders with a fresh `[]` on every selector call. */
export const EMPTY_BACKLOG: readonly QueuedItem[] = []

/**
 * The primary read surface (#294) and the AC3 empty-default — a selector FACTORY bound to one
 * `conversationId`. Narrow-slice-correct: a `setBacklog` for a DIFFERENT conversation produces a new
 * map, but `newMap.get(openId)` returns the SAME array reference → `Object.is` true → no re-render of
 * a component watching `openId`. There is no exposed setter beyond `setBacklog`; these selectors are
 * the sole read path, never two-way-bound from a component.
 */
export const selectBacklogFor =
  (conversationId: string) =>
  (s: QueueState): readonly QueuedItem[] =>
    s.backlogs.get(conversationId) ?? EMPTY_BACKLOG

/** The whole map read surface, for #197 (which iterates all held backlogs to clear stale ones on
 *  reconnect). Not used by #294. */
export const selectBacklogs = (
  s: QueueState
): ReadonlyMap<string, readonly QueuedItem[]> => s.backlogs
