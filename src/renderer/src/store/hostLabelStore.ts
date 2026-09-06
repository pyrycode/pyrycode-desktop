// The operator-typed HOST LABEL held as read-only renderer state, so a sidebar host row (#834) can name
// the machine the conversations live on instead of showing a generic word — including while
// disconnected, because the label is at-rest state. Pure renderer state — no IPC, no preload bridge, no
// transport. The data path (hostLabelLoader.ts) fetches one label PER PAIRED SERVER via
// `window.pyry.hostLabelFor(serverId)` (#1157) and writes each mapped result here through the single
// setter; #1199's host row reads the one it names through the keyed selector.
//
// A dedicated store (the serverInfoStore precedent, #340), NOT a serverInfoStore facet: different
// channel, different outcome cardinality, different lifetime — the label is independent of session,
// timeline, run config and paired-server state. It mirrors serverInfoStore's DI-factory → singleton →
// hook → selector structure, but holds a FOUR-arm discriminated union instead of an object-or-null,
// because HostLabelResult keeps never-stored and unreadable apart (ADR 0005) where ServerInfo collapses
// them. A single setter rather than a reducer: there is exactly one mutation ("record what the loader
// mapped"), so a discriminated-union action set would be a one-member union — ceremony without benefit.
// The VALUE is a discriminated union; the MUTATION is not. Unidirectional is preserved: read-only
// selector, one write path, and `setHostLabelFor` is invoked only by the loader wiring, never
// two-way-bound from a component.
//
// #1199 RE-KEYED the single slot by server id, following this directory's keyed stores (`sessionStore`'s
// `statuses`, `conversationListStore`'s `byServer`). With two machines paired the unkeyed slot answered
// with whichever was named last, which is the whole defect. Three consequences worth stating up front:
//
//   - A `Map`, NOT a `Record`. The key is a string that crossed the IPC bridge, and a plain object keyed
//     by it makes `'__proto__'` a prototype-pollution sink. A `Map` has no such sink, and it is also what
//     the two status stores already use for the same id space.
//   - THE KEY IS THE SERVER ID AND THE VALUE IS THE LABEL — never the other way round. `HostRow`'s header
//     declines four sinks for the label; a keyed store adds a fifth temptation and gets the same answer.
//     The label never becomes a key, an object path, a class name or a lookup.
//   - CALL IT WITH A CLIENT-HELD ID, the rule `conversationListStore`'s `selectConversationsFor` and
//     `relayLinkStore`'s `selectRelayLinkStatusFor` both state for their own reads. The id must come from
//     this client's own paired-server list; a daemon-supplied key would let a confused or hostile server
//     put one machine's name on another machine's row.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/**
 * The held host-label outcome — HostLabelResult's three arms plus the pre-settle `loading`.
 *
 * Four arms, not three: the bridge union cannot represent "the query has not resolved yet," and that
 * state must be distinct from all three settled ones — reusing `not-stored` would make the row claim
 * absence during the round trip, and reusing `error` would flash a recovery affordance before anything
 * failed. `loading` is the created-in state; the loader leaves it exactly once per server and nothing
 * returns to it.
 *
 * The three settled arms stay mutually distinct, all the way from `hostLabelStore.loadFor()` main-side:
 *   - `stored`     → a label was read, held VERBATIM. `''` IS a stored label, not absence.
 *   - `not-stored` → never stored. The ONLY absence path — nothing else may land here (ADR 0005).
 *   - `error`      → unreadable: over-length, malformed, a decrypt failure, or a rejected invoke.
 *
 * `label` lives only on `stored`, so the other arms are value-free by construction, exactly as the
 * bridge union is.
 */
export type HostLabelValue =
  | { status: 'loading' }
  | { status: 'stored'; label: string }
  | { status: 'not-stored' }
  | { status: 'error' }

/** The whole host-label state — one union value per server id, the union NESTED under the map's value
 *  and never intersected flat. The nesting is load-bearing, and #1199 gave it a second machine to leak
 *  to: `stored` carries `label` and the other three arms do not, so a flat `{ status, label? }` value
 *  would leak a stale `label` across a `stored → not-stored` transition — one machine's name rendering
 *  on another's row. Swapping the whole union object per slot means no key survives a transition (the
 *  newFolderStore / serverInfoStore idiom).
 *
 *  A slot is ABSENT until that server has been read for; `selectHostLabelFor` defaults it to `loading`
 *  rather than the map carrying a pre-seeded entry, so the store never has to be told which servers
 *  exist. */
export interface HostLabelState {
  byServer: ReadonlyMap<string, HostLabelValue>
}

/** Store shape = state + the single mutation entry point. */
export type HostLabelStore = HostLabelState & {
  setHostLabelFor: (serverId: string, value: HostLabelValue) => void
}

export const initialHostLabelState: HostLabelState = { byServer: new Map() }

/**
 * The created-in arm, and the answer for a slot nothing has been read for yet — a MODULE-LEVEL SHARED
 * constant rather than a fresh literal per selector call. Reference stability is not cosmetic here: a
 * narrow-slice reader compares with `Object.is`, so a new object on each call would make every store
 * notification look like a change and re-render the row forever.
 *
 * `loading` needs no new arm to mean "not read for": `hostRowLabel` already collapses it to the fallback
 * word, which is exactly what a not-yet-read, absent, unreadable or blank label must show.
 */
const NOT_READ_FOR: HostLabelValue = { status: 'loading' }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setHostLabelFor` replaces ONE
 * server's whole value unconditionally ("record what the loader mapped" — no merge, no coercion, no
 * re-validation of the label), leaving every other slot untouched.
 *
 * COPY-ON-WRITE, inside zustand's FUNCTIONAL updater. Both halves are load-bearing:
 *   - Cloning rather than mutating is what makes "a write for one server leaves every other server's
 *     held value referentially identical" fall out of the shape instead of needing a test to police it —
 *     `newMap.get(otherId)` returns the same value reference, so a narrow slice does not re-render.
 *   - The functional form is what makes two per-server invokes resolving in the same tick safe. A setter
 *     that captured `byServer` outside the updater would read a stale map and silently drop the other
 *     server's slot.
 *
 * It accepts `loading` as a type because that arm is a member of `HostLabelValue`; nothing writes it —
 * the map never produces it. A narrower setter parameter would need a second type for no gain, and
 * `loading` is not a dangerous value to be able to write.
 */
export function createHostLabelStore(init: HostLabelState = initialHostLabelState) {
  return createStore<HostLabelStore>((set) => ({
    ...init,
    setHostLabelFor: (serverId, value) =>
      set((s) => {
        const byServer = new Map(s.byServer)
        byServer.set(serverId, value)
        return { byServer }
      })
  }))
}

/** App-wide singleton — the one source of truth the loader writes and the host row reads. */
export const hostLabelStore = createHostLabelStore()

/** Narrow-slice React binding for the host row. Selecting a single slice avoids cross-facet re-renders. */
export function useHostLabelStore<T>(selector: (s: HostLabelStore) => T): T {
  return useStore(hostLabelStore, selector)
}

/**
 * ONE SERVER's held label — the only read surface, a selector factory in the `selectStatusFor` /
 * `selectRelayLinkStatusFor` / `selectConversationsFor` idiom already used across this directory. There
 * is no exposed setter beyond `setHostLabelFor`; it is the sole mutation path and is invoked only by the
 * loader wiring, never two-way-bound from a component.
 *
 * `null` IS AN ACCEPTED ID, and it is not a map key. It is the frame the sidebar renders before the
 * paired-server one-shot resolves, when the row names nobody yet. It answers the same `loading` constant
 * a not-yet-read server does — deliberately, because `hostRowLabel` turns both into the fallback word and
 * that is precisely what the row shows at launch today. Reading `byServer.get(null)` instead would be
 * wrong twice over: `null` is a legitimate slot key in the two status stores (unstamped writes land
 * there), so a null id must never address a slot at all.
 *
 * DELIBERATELY DEFAULTED, unlike the two per-server status selectors, which answer `undefined` for a
 * silent server so that "not heard from" stays distinct from a reported state. There is no such
 * distinction to preserve here: every non-name outcome — not yet read, never stored, unreadable, blank —
 * already collapses to one word on the row, so a defaulted read loses nothing and spares every consumer
 * the same `?? loading`.
 */
export const selectHostLabelFor =
  (serverId: string | null) =>
  (s: HostLabelState): HostLabelValue =>
    serverId === null ? NOT_READ_FOR : (s.byServer.get(serverId) ?? NOT_READ_FOR)
