// The relay-socket leg's current link status, kept live as one unidirectional source of truth for
// the two-dot connection indicator (#330, later): it reads this leg independently of the daemon
// session status (which lives in sessionStore's ConnectionStatus). Pure renderer state — no IPC, no
// preload bridge, no transport. The data path (relayLinkBridge.ts) observes the content-free
// `relayLinkChanged` daemon event (#328's transport half decodes it — no token, key, raw frame, or
// close code) and writes the arriving `status` here via the single setter; #330 reads it through the
// selector.
//
// A dedicated store (the sessionIdStore/conversationListStore precedent, #208), NOT a sessionStore
// facet: the daemon-session leg already lives in sessionStore's ConnectionStatus, and this leg is
// orthogonal — it must be App-level always-listening (a relay-link change can arrive at any time,
// including before #330 exists), and it holds a single closed category, not the session reducer's
// six-arm state. It mirrors sessionIdStore's DI-factory → singleton → hook → selector structure, but
// holds the wire-owned RelayLinkStatus (no camelCase remap — the arm carries the FINAL category). A
// single setter rather than a reducer: there is exactly one mutation ("record the latest status"),
// so a discriminated-union action set would be a one-member union — ceremony without benefit.
// Unidirectional is preserved: read-only selector, one write path, and `setRelayLinkStatus` is
// invoked only by the subscription wiring, never two-way-bound from a component.
//
// Since #1134 the status is KEYED BY SERVER: each DaemonConnection emits its own relayLinkChanged,
// and since #1117 the registry holds one per paired server, so a single cell reported whichever
// connection changed most recently and nothing about the others. An index sits BESIDE the app-wide
// cell rather than replacing it — same shape as sessionStore's since #1133, the daemon leg the same
// host row reads next to this one. The single-setter posture survives keying untouched: the setter
// gains the server the status belongs to, not a second mutation.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { RelayLinkStatus } from '@shared/ipc/events'

/**
 * Which slot a relay-link status is filed under (#1134). THREE kinds of key, kept apart rather than
 * coalesced — `ServerOrigin`'s header in `shared/ipc/events.ts` draws the distinction and the
 * per-server read is the one place it is observable:
 *
 *   - a `string` — one slot per paired server, which is the whole point of the keying;
 *   - `null` — a PRESENT null: a producer bound while no paired record was in hand. Live on this leg,
 *     not hypothetical: `connectionRegistry`'s not-paired stand-in is built with `serverId: null` and
 *     is dialled like any other, so its relay socket's up and down genuinely arrive stamped `null`;
 *   - `undefined` — no origin at all, meaning a producer that never went through a binding.
 *     Unreachable in production (every producer is bound exactly once), but reachable from the tests,
 *     which emit bare event literals. Filing it keeps the write TOTAL — an unbound producer's status
 *     is recorded rather than silently dropped.
 *
 * The same domain as `sessionStore`'s `StatusOrigin` and `liveWindow.ts`'s, and DELIBERATELY a third
 * declaration rather than an import of either. Importing sessionStore's would make the relay leg's
 * key domain a dependent of the daemon leg's store module, which is the coupling this store's header
 * above exists to prevent; and lifting all three into `src/shared/` cannot reach `liveWindow.ts`'s
 * without editing `src/main/`, which #1134 excludes — a lift reaching two of three would leave a
 * shared type with one unexplained holdout. The lift stays open for the first ticket that may touch
 * main; see `docs/specs/architecture/1134-per-server-relay-link-status.md` § Open questions. Named
 * for this store rather than `StatusOrigin` so a consumer reading both legs per row (#1070) can name
 * both key types without an import alias.
 */
export type RelayLinkOrigin = string | null | undefined

/** The whole relay-link state. `status: null` is the distinct initial "not-connected" state (AC1) —
 *  definitionally none of the three categories the arm delivers, and the same not-yet-arrived
 *  sentinel every sibling store uses (sessionIdStore, conversationListStore, queueStore, …). It keeps
 *  the stored domain identical to the wire's RelayLinkStatus — no invented category. */
export interface RelayLinkState {
  /**
   * The MOST RECENTLY WRITTEN status, across every connection — byte-for-byte what this cell has
   * always held, since it was already last-writer-wins the moment #1117 gave the registry one
   * connection per paired server. #1134 keeps it in place rather than re-shaping it into the index
   * below: `HostConnectionDotsControl` read it through `selectRelayLinkStatus`, and a field nothing
   * rewrote was the cheapest possible guarantee that the sidebar's relay dot rendered identically —
   * "Relay Unknown" on the first frame of every launch (#719), and no false green. A fold
   * ("connected if any server's link is") was considered and rejected for exactly that reason.
   *
   * #1199 MOVED that reader to `statuses` below, so this field now has no production reader at all —
   * see `selectRelayLinkStatus`'s header for what that means for its fate. The initial-frame guarantee
   * it was kept for survives the move unchanged, because the host row now collapses a silent server to
   * `initialRelayLinkState.status` — this same `null`, read as a constant rather than restated.
   */
  status: RelayLinkStatus | null
  /**
   * One slot per origin (#1134) — what makes one machine's relay socket dropping read as that
   * machine's link being down rather than as the whole app's. `status` alone reported whichever
   * connection changed most recently and nothing about the others, and on a healthy relay socket the
   * next status change is never, so another server's link could stay wrong for the life of the
   * window.
   *
   * A `Map`, NEVER a bare object. `ServerOrigin`'s docblock in `shared/ipc/events.ts` rules it for
   * any consumer that indexes by the id — a `__proto__` id would write through `Object.prototype` on
   * a `Record<string, …>` — and `sessionStore.ts`, `liveWindow.ts` and `queueStore.ts` are the
   * existing precedents.
   *
   * Growth is bounded by the distinct-origin count (one per paired server plus at most the two
   * non-server keys), and a daemon cannot influence which key its own event carries, so nothing it
   * sends can mint a slot. Nothing is evicted: a torn-down server's last relay status is `offline` or
   * `daemon-absent`, which is exactly what a per-server reader should be told.
   */
  statuses: ReadonlyMap<RelayLinkOrigin, RelayLinkStatus>
}

/** Store shape = state + the single mutation entry point. */
export type RelayLinkStore = RelayLinkState & {
  setRelayLinkStatus: (status: RelayLinkStatus, serverId?: string | null) => void
}

/**
 * The empty index every store starts from, so "before any event arrives" needs no special case: the
 * app-wide cell still reads `null` and every per-server read still answers "not heard from".
 */
export const initialRelayLinkState: RelayLinkState = { status: null, statuses: new Map() }

/**
 * The origin's slot, written copy-on-write — `new Map(held)` then `set`, never a mutation of the map
 * the store already handed out. That is what makes an untouched server's slot come back by reference,
 * so a component watching that server does not re-render when a different one changes.
 *
 * Returns the map rather than a whole `RelayLinkState`: this store has no exported reducer (unlike
 * `sessionStore`'s `reduceSession`, whose `withStatus` must return one), so the setter stays a
 * partial `set` and a future third field cannot be silently dropped by a whole-state literal here.
 */
function withSlot(
  statuses: ReadonlyMap<RelayLinkOrigin, RelayLinkStatus>,
  origin: RelayLinkOrigin,
  status: RelayLinkStatus
): ReadonlyMap<RelayLinkOrigin, RelayLinkStatus> {
  const next = new Map(statuses)
  next.set(origin, status)
  return next
}

/**
 * DI-friendly, React-free store — one isolated instance per test. `setRelayLinkStatus` replaces the
 * whole `status` unconditionally (most-recent category wins — no merge, no coercion, no validation;
 * the arm carries the final category, #328) AND files the same value in the origin's own slot
 * (#1134), in one `set`, so `selectRelayLinkStatus` and `selectRelayLinkStatusFor(origin)` can never
 * be caught disagreeing about the link that just moved.
 *
 * Still a SINGLE SETTER rather than a reducer: keying adds no second mutation, so the header's
 * one-member-union argument stands. `serverId` is OPTIONAL, and the optionality is load-bearing twice
 * over — it makes the absent case a genuine absent argument, matching `RelayLinkOrigin`'s three-case
 * domain with no sentinel value, and it leaves an origin-less call filing under the unstamped slot
 * rather than being dropped. It remains the sole write path, invoked only by the subscription wiring.
 */
export function createRelayLinkStore(init: RelayLinkState = initialRelayLinkState) {
  return createStore<RelayLinkStore>((set) => ({
    ...init,
    setRelayLinkStatus: (status, serverId) =>
      set((s) => ({ status, statuses: withSlot(s.statuses, serverId, status) }))
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #330 reads. */
export const relayLinkStore = createRelayLinkStore()

/** Narrow-slice React binding for #330. Selecting a single slice avoids cross-facet re-renders. */
export function useRelayLinkStore<T>(selector: (s: RelayLinkStore) => T): T {
  return useStore(relayLinkStore, selector)
}

/** Selectors — the only read surface. There is no exposed setter beyond `setRelayLinkStatus`; it is
 *  the sole mutation path and is invoked only by the subscription wiring, never two-way-bound from a
 *  component. */

/**
 * The APP-WIDE status: the most recently written one, across every connection. Unchanged in name,
 * signature and RETURN TYPE by #1134, which is what left `HostConnectionDotsControl` — then its one
 * production reader — working untouched. The `| null` is load-bearing rather than incidental:
 * `relayLeg` takes `RelayLinkStatus | null` and it is `null` that maps to "Relay Unknown" (#719).
 *
 * #1199 moved that reader onto `selectRelayLinkStatusFor`, so this selector now has ZERO production
 * readers — only `relayLinkStore.test.ts` and `relayLinkBridge.test.ts` reference it. Retiring it was
 * out of scope there and this header is not an argument for keeping it; whoever decides its fate should
 * know it survives on nothing but the export. The session store's app-wide twin is NOT in the same
 * position — `selectStatus` keeps four genuinely app-wide consumers — so do not retire the pair
 * together on the strength of this one.
 */
export const selectRelayLinkStatus = (s: RelayLinkState): RelayLinkStatus | null => s.status

/**
 * ONE SERVER's relay-link status (#1134) — a selector factory bound to one origin, the
 * `selectStatusFor` / `selectBacklogFor` / `selectTimelineFor` idiom already used across this
 * directory.
 *
 * Returns `undefined` for a server whose link has not reported yet, and DELIBERATELY does not default
 * to a category: telling "not heard from" apart from a link that has reported is the whole point of
 * the per-server read, and a default would erase it at the one place a caller could still see the
 * difference. A per-row consumer that wants `relayLeg`'s "Relay Unknown" writes the `?? null` itself,
 * which keeps that flattening visible where it happens.
 *
 * CALL IT WITH A CLIENT-HELD ID. The origin must come from this client's own paired-server list,
 * never from a daemon-supplied field: a wire-sourced lookup key would let a confused or hostile
 * daemon make one host row display another server's relay state — the read-side twin of the
 * write-side rule `relayLinkBridge`'s `originOf` enforces.
 *
 * Narrow-slice-correct: a status write for another server produces a new map, but `newMap.get(mine)`
 * returns the SAME value → `Object.is` true → no re-render.
 */
export const selectRelayLinkStatusFor =
  (origin: RelayLinkOrigin) =>
  (s: RelayLinkState): RelayLinkStatus | undefined =>
    s.statuses.get(origin)
