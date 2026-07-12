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

/** Store shape = state + the single mutation entry point. */
export type QueueStore = QueueState & {
  setBacklog: (snapshot: QueueSnapshot) => void
}

export const initialQueueState: QueueState = { backlogs: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setBacklog` records the snapshot's
 * `queued` under its `conversationId` via copy-on-write (the runSettingsWriteStore idiom): clone the
 * map, set the key, replace. REPLACEMENT truth (AC2) — the held list for a key is always exactly the
 * latest snapshot's `queued`, no merge / append / dedupe. `queued` is stored VERBATIM by reference (no
 * coercion, no validation — #292 owns the fail-closed decode). The write is unconditional: an empty
 * `queued: []` sets that key to `[]` ("the daemon says this conversation's backlog is now empty" — the
 * AC2 clear case); it does NOT delete the key (stale-key eviction is #197's concern via selectBacklogs).
 */
export function createQueueStore(init: QueueState = initialQueueState) {
  return createStore<QueueStore>((set) => ({
    ...init,
    setBacklog: (snapshot) =>
      set((s) => {
        const next = new Map(s.backlogs)
        next.set(snapshot.conversationId, snapshot.queued)
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
