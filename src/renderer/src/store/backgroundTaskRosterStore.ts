// The daemon's live background-task roster, kept per conversation as one unidirectional source of
// truth for the panel slice (#568). Pure renderer state — no IPC, no preload bridge, no transport.
// The data path (backgroundTaskRosterBridge.ts) observes the typed `backgroundTaskRoster` daemon
// event (#566 decodes the `background_task_roster` snapshot) and writes the arriving roster here via
// the single setter.
//
// A dedicated store in the queueStore posture: `background_task_roster` is daemon STATE, not part of
// claude's turn stream (it carries no turn_id and opens and closes no turn — the queue_state rule,
// SSOT pyrycode #720), so it gets its own store and is never folded into the thread-timeline reducer.
// It mirrors queueStore's DI-factory → singleton → hook → selector structure and its ReadonlyMap
// copy-on-write, and holds the wire BackgroundTask rows VERBATIM in snake_case — no parallel
// camelCase renderer type, no per-field remap — so the slice stays drift-free against the mobile wire
// contract. Holding the rows verbatim is also why AC2's "`truncated_fields: null` is never collapsed
// into `[]`" holds BY CONSTRUCTION: there is no per-row mapping in which a collapse could occur.
//
// Keyed by `conversationId`, NOT a flat slot: the daemon fans these frames out to every interactive
// connection and each carries `conversation_id`, so rosters for DIFFERENT conversations arrive in
// sequence and a single "hold the latest roster" slot would let one clobber another (the clobber
// queueStore documents and keys around). Two named setters rather than a reducer — record the latest
// roster for a conversation, and clear everything on the `connected` edge — because a
// discriminated-union action set for two operations is ceremony without benefit. Unidirectional is
// preserved: read-only selectors, one write path, and neither setter is two-way-bound from a
// component.
//
// SECURITY: a row's `description` is untrusted, model-influenced daemon-relayed text and for
// `task_type: local_bash` IS the literal command line claude ran. This store neither renders nor
// interprets it — #568 must render it as INERT PLAIN TEXT (never an HTML sink, an attribute, or a
// URL) and must never execute or re-shell it. `tasks` is a DISPLAY list; its list shape is not an
// invitation to iterate it as a work list something acts on. Nothing here iterates it.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { BackgroundTask } from '@shared/wire/types'

/** The held value for ONE conversation: the rows the daemon last reported alive, plus its own
 *  truncation report. `tasks` holds the wire rows by reference (roster order, snake_case), never
 *  copied or coerced. `droppedTasks` is this frame's ONLY truncation report — the daemon caps a
 *  roster at 8 rows — so THE TRUE ROSTER SIZE IS `tasks.length + droppedTasks`, and a reader that
 *  shows only the carried rows silently presents a capped roster as the whole one. `0` is a value,
 *  never consulted for truthiness. Deliberately carries NO terminal / finished / failed state: the
 *  daemon reports no finish, so absence from a LATER roster is the only removal path this family
 *  has, and modelling anything more would be a claim the wire cannot support. */
export interface BackgroundTaskRosterEntry {
  tasks: readonly BackgroundTask[]
  droppedTasks: number
}

/** The write unit — one conversation's roster snapshot = the `backgroundTaskRoster` daemon-event arm
 *  minus its `type` tag. Imported by the bridge, which builds it from the event. */
export interface BackgroundTaskRosterSnapshot extends BackgroundTaskRosterEntry {
  conversationId: string
}

/** The whole roster state: each conversation's latest roster, keyed by `conversationId`. A key ABSENT
 *  from the map means "NO roster has ever arrived for that conversation" and is a DISTINCT state from
 *  a present entry holding `tasks: []` ("observed, nothing alive") — see `selectRosterFor`, which
 *  preserves that distinction rather than collapsing it. `ReadonlyMap` signals the setters REPLACE the
 *  map, never mutate it in place. */
export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>
}

/** Store shape = state + the two mutation entry points: record one conversation's roster, and clear
 *  every roster on the `connected` edge (AC5). */
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  resetRosters: () => void
}

export const initialBackgroundTaskRosterState: BackgroundTaskRosterState = { rosters: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setRoster` records the snapshot's
 * rows and drop count under its `conversationId` via copy-on-write (the queueStore idiom): clone the
 * map, set the key to a FRESH named-field entry, replace. SNAPSHOT truth (AC1) — the held value for a
 * key is always exactly the latest roster, no merge / append / dedupe / carry-over, because each
 * roster frame REPLACES the reader's view of what is running rather than amending it. A task absent
 * from the new roster is simply no longer held; that absence is this family's only removal path. The
 * rows are stored VERBATIM by reference (no coercion, no validation — #566 owns the fail-closed
 * decode), which also means each row's `truncated_fields: null` survives as `null` and is never
 * collapsed into `[]` (AC2).
 *
 * The write is UNCONDITIONAL, and that is AC4 and the point of this store: an empty `tasks: []` sets
 * that key to an entry holding no rows ("the daemon says nothing is alive for this conversation" — the
 * payoff signal of pyrycode#1240), it does NOT delete the key and is never dropped, filtered, or
 * coalesced as "no news". Because a present-but-empty entry and an absent key are different map
 * states, `selectRosterFor` can hand back `null` for the latter and keep the two apart.
 *
 * `resetRosters` (AC5) is the `connected` edge: the relay re-emits `connected` on every (re)handshake
 * and a new pairing always re-handshakes, so clearing the WHOLE map here is what keeps a previous
 * connection's — or a previous PAIRING's — tasks from ever appearing. Clearing the map IS returning
 * every conversation to "no roster observed", so no per-key eviction loop is needed. Nothing
 * repopulates it: rosters are not in the daemon's reconcile-on-connect set (that set is outstanding
 * `modal_shown` per pyrycode#877 and `queue_state` per non-empty backlog per pyrycode#878) and this
 * app advertises no `last_event_id`, so the set reads `null` until claude next emits a roster. That is
 * the correct, honest behaviour — retaining the pre-disconnect set would present a stale list as live
 * (#569 owns closing that gap, and it needs a daemon-side change). Copy-on-write like `setRoster`
 * (never mutate `s.rosters` in place); returning the SAME state reference when the map is already
 * empty makes zustand's `Object.is` short-circuit fire — no listener churn on a first connect or a
 * reconnect that held nothing.
 */
export function createBackgroundTaskRosterStore(
  init: BackgroundTaskRosterState = initialBackgroundTaskRosterState
) {
  return createStore<BackgroundTaskRosterStore>((set) => ({
    ...init,
    setRoster: (snapshot) =>
      set((s) => {
        const next = new Map(s.rosters)
        next.set(snapshot.conversationId, {
          tasks: snapshot.tasks,
          droppedTasks: snapshot.droppedTasks
        })
        return { rosters: next }
      }),
    resetRosters: () => set((s) => (s.rosters.size === 0 ? s : { rosters: new Map() }))
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #568 reads. */
export const backgroundTaskRosterStore = createBackgroundTaskRosterStore()

/** Narrow-slice React binding for #568. Selecting a single conversation's roster avoids cross-facet
 *  re-renders. */
export function useBackgroundTaskRosterStore<T>(selector: (s: BackgroundTaskRosterStore) => T): T {
  return useStore(backgroundTaskRosterStore, selector)
}

/**
 * The primary read surface (#568) — a selector FACTORY bound to one `conversationId`.
 *
 * `?? null`, and NOT the queueStore precedent's `?? EMPTY_BACKLOG`: that collapse is correct for
 * `queue_state` but would silently violate AC4 here, because "no roster has ever arrived" and
 * "observed, nothing alive" would then both read as a bare empty list — with no type error and no
 * failing test unless one is written for it. The three readings are distinct:
 *
 *   key absent                      → `null`                    no roster has ever arrived
 *   `{ tasks: [], droppedTasks: 0 }`→ that entry                observed, nothing alive
 *   `{ tasks: [t], droppedTasks: 2 }`→ that entry               1 row carried, 3 truly alive
 *
 * `null` is a STABLE reference by construction, which is the whole reason queueStore hoists
 * `EMPTY_BACKLOG` to module scope (a fresh `[]` per selector call churns re-renders) — so this slice
 * needs no `EMPTY_*` constant at all. The nullable return type also forces #568 to branch, so the
 * distinction cannot be ignored accidentally. And it is what makes AC5 verifiable: after
 * `resetRosters` every key is absent, so every conversation reads `null` — genuinely back to "no
 * roster observed" rather than indistinguishable from observed-empty.
 *
 * Narrow-slice-correct: a `setRoster` for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME entry object → `Object.is` true → no re-render of a component
 * watching `openId`. These selectors are the sole read path, never two-way-bound from a component.
 * There is deliberately no whole-map analogue of `selectBacklogs`: the reset clears the map wholesale
 * and nothing else reads it, so shipping one would ship an unread read surface.
 */
export const selectRosterFor =
  (conversationId: string) =>
  (s: BackgroundTaskRosterState): BackgroundTaskRosterEntry | null =>
    s.rosters.get(conversationId) ?? null
