// The daemon's conversation list, kept live as one unidirectional source of truth for the Channel
// List screen (#141), the create-discussion affordance (#142), and every future list / navigation /
// archive feature. Pure renderer state — no IPC, no preload bridge, no transport. The data path
// (conversationListBridge.ts) requests the list once the connection reaches `connected` and writes
// the arriving `conversationsReceived` rows here via the single setter; #141 reads them through the
// selector.
//
// A dedicated store (the runConfigStore precedent, #187), NOT a session-store facet: a conversation-
// list update never touches connection/messages state and vice versa, so the two stores stay
// orthogonal and a list arrival re-renders only components selecting this slice. It mirrors
// runConfigStore's DI-factory → singleton → hook → selector structure, but holds the wire
// ConversationSummary rows VERBATIM in snake_case — no parallel camelCase renderer type, no per-field
// remap (unlike runConfigSnapshot's used_tokens → usedTokens) — so the slice stays drift-free against
// the mobile wire contract. A single setter rather than a reducer: there is exactly one mutation
// ("record the latest list"), so a discriminated-union action set would be a one-member union —
// ceremony without benefit. Unidirectional is preserved: read-only selector, one write path, and
// `setConversations` is invoked only by the subscription wiring, never two-way-bound from a component.
//
// Since #1086 the list is KEYED BY SERVER: since #1117 the registry holds one connection per paired
// server, so with two connected daemons each answering the list request the second reply overwrote the
// first and the sidebar showed whichever server answered last. The third store in the family after
// #1085 (session) and #1134 (relay link) — but the ONE that could not copy their shape. Both siblings
// left their app-wide field as last-writer-wins and hung the per-server index beside it; here a list
// showing one server's rows IS the bug, so the app-wide read is a UNION across servers. A union reads
// every slot, so a stale slot becomes visible — which is why this store, alone in the family, also
// joins `clearPairingScopedState`'s dep set (see `clearAllConversations` below).
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { ConversationSummary } from '@shared/wire/types'

/**
 * Which slot a reply is filed under (#1086) — the same three-case domain as `relayLinkStore`'s
 * `RelayLinkOrigin`, whose docblock is the ruling: a `string` is one paired server; `null` is a
 * producer bound while no paired record was in hand; `undefined` is a producer that never went through
 * a binding — unreachable in production, reachable from the tests, and filing it is what keeps the
 * write TOTAL rather than silently dropping an unbound producer's rows.
 *
 * A FOURTH declaration rather than an import of `RelayLinkOrigin`, `sessionStore`'s `StatusOrigin` or
 * `liveWindow.ts`'s, for the reason `relayLinkStore` states: importing one would make this store's key
 * domain a dependent of that store's module, and lifting all four into `src/shared/` cannot reach
 * `liveWindow.ts`'s without editing `src/main/`, which this ticket excludes. The lift stays open for
 * the first ticket that may touch main; see
 * `docs/specs/architecture/1086-conversation-list-keyed-by-server.md` § Open questions.
 */
export type ConversationListOrigin = string | null | undefined

/**
 * One conversation row plus the server it came from (#1086, AC2). The origin rides BESIDE the wire
 * fields as an extra property, the same assignability trick #1068 used at the event level: this stays
 * assignable to `ConversationSummary`, so `partitionByPromotion`, `partitionArchived`,
 * `groupByWorkspace` and the three screen readers compile untouched and #1070 widens the parameter
 * where it actually needs the server. `ConversationSummary` itself is NOT edited.
 *
 * The stamp is the CLIENT's, taken from the event's `serverId` (bound main-side by `bindServerOrigin`
 * from a paired record this client holds) and never read off the daemon's reply — see the spread order
 * in `stampRows`.
 */
export interface ServerConversationSummary extends ConversationSummary {
  readonly serverId: ConversationListOrigin
}

/** The whole conversation-list state. `conversations: null` is the distinct "not yet loaded" state;
 *  a received `[]` is a real loaded "zero conversations" state, NOT null (#141 tells the two apart to
 *  choose between a loading affordance and an empty-state). Rows are held as the wire emits them —
 *  snake_case ConversationSummary field-for-field, no derivations: "unnamed" is the literal
 *  `name === null` and "discussion vs channel" derives from the raw `is_promoted` flag, both at #141's
 *  read boundary — with exactly one client-owned property added beside them (#1086). */
export interface ConversationListState {
  /**
   * The UNION across every server, in one array (#1086, AC3) — what the three existing readers see,
   * under the same selector name and the same `| null`. STORED rather than folded at read time, and
   * written in the same `set` as the map below (the `relayLinkStore` precedent): that is what makes
   * referential stability true by construction rather than aspirational, since these readers go
   * through `useConversationListStore`, which compares with `Object.is`. A selector that folded the
   * map on every call would hand back a fresh array each time and drive a re-render storm.
   */
  conversations: readonly ServerConversationSummary[] | null
  /**
   * One slot per origin (#1086) — what makes one daemon's reply replace only that daemon's rows. A
   * `Map`, NEVER a bare object: `ServerOrigin`'s docblock in `shared/ipc/events.ts` rules it for any
   * consumer that indexes by the id (a `__proto__` id would write through `Object.prototype` on a
   * `Record<string, …>`), and `relayLinkStore`, `sessionStore` and `queueStore` are the precedents.
   *
   * Growth is bounded by the distinct-origin count — one per paired server plus at most the two
   * non-server keys — and a daemon cannot influence which key its own event carries, so nothing it
   * sends can mint a slot. Unlike `relayLinkStore`'s index, this one IS emptied: at every pairing
   * change, by `clearAllConversations`.
   */
  byServer: ReadonlyMap<ConversationListOrigin, readonly ServerConversationSummary[]>
}

/** Store shape = state + its two mutation entry points. */
export type ConversationListStore = ConversationListState & {
  setConversations: (
    conversations: readonly ConversationSummary[],
    serverId?: string | null
  ) => void
  /**
   * The pairing-boundary drop (#1086, AC5) — NULLARY BY DESIGN, the `clearAllModelLists` /
   * `clearAllSlashCommandLists` property: a pairing ending invalidates every server's rows at once, so
   * "takes no id at all" is a property of this signature that `tsc` enforces rather than a test, and
   * no daemon-supplied id can steer which server's conversations survive the boundary. It carries
   * `All` so the blast radius is legible at the CALL SITE — among the ten keys of
   * `ClearPairingScopedStateDeps`, its only entry point.
   *
   * This store was deliberately EXCLUDED from that clear until now, on #531's argument that it
   * self-heals: the mount-time `list_conversations` request re-lists and the whole-array replace
   * overwrote everything. Keying REMOVES that self-heal — the new pairing's reply lands in the new
   * server's slot, the departed server's slot is never written again, and the union keeps rendering
   * its rows. That is the one regression keying introduces, and this is its fix.
   */
  clearAllConversations: () => void
  /**
   * ONE SERVER's rows, dropped (#1196) — the keyed sibling of the clear above, and the other half of
   * what keying by server owes: forgetting one of several paired machines must take that machine's rows
   * off the sidebar and leave every other machine's exactly where they were. Until now the per-server
   * unpair path reached no clear at all unless it happened to forget the LAST server, so a departed
   * machine's rows went on rendering out of the union — since #1070 under no host row at all, because
   * the sidebar draws its subtrees from `serverInfoStore`, which the unpair already refreshes.
   *
   * IT TAKES AN ID WHERE ITS SIBLING REFUSES ONE, and the two are the same rule at different
   * boundaries. `clearAllConversations` is nullary because a pairing ending invalidates EVERY server's
   * rows at once, so an id parameter could only ever let a daemon-supplied value steer which server
   * survives. Here the whole act is "one named server", so the id IS the argument — but typed `string`,
   * NARROWER than `ConversationListOrigin`, so the `null` (bound, no paired record) and `undefined`
   * (never bound) slots are unreachable from this entry point by the TYPE rather than by a rule. And it
   * must be called with a CLIENT-HELD id, exactly as `selectConversationsFor`'s docblock requires of
   * the read side: the only production caller passes the id `runUnpairServer` just erased, which comes
   * from this client's own paired collection and never from a wire field.
   *
   * Dropping the last held slot flattens to `conversations: null` — the not-loaded state, which is the
   * honest answer for a surviving server that has not replied yet, rather than a false loaded-empty.
   */
  clearConversationsFor: (serverId: string) => void
}

export const initialConversationListState: ConversationListState = {
  conversations: null,
  byServer: new Map()
}

/**
 * Stamp a reply's rows with the server they came from. **Spread first, stamp last** — the property
 * order is load-bearing, not stylistic: written the other way round, a daemon that returned a
 * `serverId` key on a row would overwrite the client's stamp and file its rows under another server's
 * slot, which is exactly the confusion the stamp exists to prevent. Today that is unreachable —
 * `parseConversationSummary` is a closed reconstruction, seven named fields into a fresh literal, and
 * does not copy unknown keys through — so the decoder is the deterministic guarantee and this ordering
 * is the free second fabric. Do not reorder it.
 *
 * A shallow copy per row: the FIELD VALUES are the daemon's, verbatim and uncoerced, but the object is
 * this store's, because the origin has nowhere else to live without editing the wire type (AC2).
 */
function stampRows(
  rows: readonly ConversationSummary[],
  serverId: ConversationListOrigin
): readonly ServerConversationSummary[] {
  return rows.map((row) => ({ ...row, serverId }))
}

/**
 * Total order over the three key kinds (#1086, AC3). Strings first, ascending by code unit — NOT
 * `localeCompare`, since an id is opaque and a locale-sensitive comparator would make the sidebar's
 * order depend on the machine's locale. Then `null`, then `undefined`: a real paired server's position
 * must not depend on whether an exceptional slot happens to exist, and both non-string slots are
 * diagnostic- or test-reachable rather than sidebar-facing, with `null` (bound, no paired record)
 * sitting closer to a server than `undefined` (never bound).
 *
 * Ranked rather than coerced, so the comparator stays total over the whole domain — the write is total,
 * so the order must be too.
 */
function rankOrigin(origin: ConversationListOrigin): number {
  if (typeof origin === 'string') return 0
  return origin === null ? 1 : 2
}

function compareOrigins(a: ConversationListOrigin, b: ConversationListOrigin): number {
  const byRank = rankOrigin(a) - rankOrigin(b)
  if (byRank !== 0) return byRank
  if (typeof a !== 'string' || typeof b !== 'string') return 0
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The union, recomputed from the map in the same `set` that writes it (AC3). An EMPTY map flattens to
 * `null`, any slot at all to a concatenation that may itself be `[]` — which is what keeps today's
 * `null` (not yet loaded) versus `[]` (loaded, zero conversations) distinction exactly: with one
 * server, before its reply the read is `null`, after a `[]` reply it is `[]`.
 *
 * Servers are ordered by `compareOrigins` and rows WITHIN a server keep wire order — the daemon is the
 * source of truth for ordering (`ConversationsPayload`), so nothing here re-sorts rows. With one
 * server the result is therefore exactly today's list, in today's order, plus the stamp.
 *
 * Sorting on every write is bounded by the distinct-origin count, a handful by construction.
 */
function flattenByServer(
  byServer: ReadonlyMap<ConversationListOrigin, readonly ServerConversationSummary[]>
): readonly ServerConversationSummary[] | null {
  if (byServer.size === 0) return null
  const origins = [...byServer.keys()].sort(compareOrigins)
  return origins.flatMap((origin) => byServer.get(origin) ?? [])
}

/**
 * DI-friendly, React-free store — one isolated instance per test.
 *
 * `setConversations` replaces ONE server's rows unconditionally (most recent list for that server wins
 * — no merge, no dedupe) and never coerces or validates them; every other server's slot comes back BY
 * REFERENCE, so a component watching a different server sees `Object.is` true and does not re-render.
 * Copy-on-write throughout — `new Map(held)` then `set`, never a mutation of the map the store already
 * handed out. The map is read INSIDE the `set` updater rather than through `getState()` outside it, so
 * two replies arriving back-to-back cannot interleave: zustand runs the updater synchronously against
 * current state, which closes the only check-then-act shape on this path.
 *
 * Still a SINGLE write path rather than a reducer: keying adds no second kind of write, so the
 * header's one-member-union argument stands. `serverId` is OPTIONAL, and the optionality is
 * load-bearing twice over (the `setRelayLinkStatus` property) — it makes the absent case a genuine
 * absent argument, matching the three-case domain with no sentinel value, and it leaves an origin-less
 * call filing under the unstamped slot rather than being dropped.
 */
export function createConversationListStore(
  init: ConversationListState = initialConversationListState
) {
  return createStore<ConversationListStore>((set) => ({
    ...init,
    setConversations: (conversations, serverId) =>
      set((s) => {
        const byServer = new Map(s.byServer)
        byServer.set(serverId, stampRows(conversations, serverId))
        return { conversations: flattenByServer(byServer), byServer }
      }),
    clearAllConversations: () =>
      set((s) =>
        // THE SUBSCRIBER SHORT-CIRCUIT (`clearPairingScopedState`'s docblock names the two different
        // jobs a guard like this can do; this store needs only the first). Handing the state OBJECT
        // straight back on an already-clear store makes zustand's `Object.is(next, state)` fire, so a
        // redundant clear wakes NO listener at all rather than only sparing the selectors. Both halves
        // are tested because the DI factory accepts an arbitrary injected state and it is only the
        // sole write path that keeps the two fields derived together. There is no side-effect guard to
        // want: nothing here reaches outside memory, so this clear cannot throw.
        s.conversations === null && s.byServer.size === 0 ? s : initialConversationListState
      ),
    clearConversationsFor: (serverId) =>
      set((s) => {
        // The same SUBSCRIBER SHORT-CIRCUIT its nullary sibling carries, against the condition that
        // matters here: an id naming no held slot hands the state OBJECT straight back, so zustand's
        // `Object.is(next, state)` fires and a redundant clear wakes NO listener. Reachable in
        // production whenever a server is forgotten before its list reply ever landed.
        if (!s.byServer.has(serverId)) return s
        // Copy-on-write, the discipline `setConversations` above documents: a new Map, never a mutation
        // of the one the store already handed out. Every surviving slot is carried across BY REFERENCE,
        // so a component watching another server sees `Object.is` true and does not re-render.
        const byServer = new Map(s.byServer)
        byServer.delete(serverId)
        // The union is recomputed in the SAME `set` that writes the map — what makes the two fields
        // derived together by construction rather than by convention, and what actually takes the
        // departed rows off the app-wide read.
        return { conversations: flattenByServer(byServer), byServer }
      })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #141 reads. */
export const conversationListStore = createConversationListStore()

/** Narrow-slice React binding for #141. Selecting a single slice avoids cross-facet re-renders. */
export function useConversationListStore<T>(selector: (s: ConversationListStore) => T): T {
  return useStore(conversationListStore, selector)
}

/** The read surface. There is no exposed setter beyond `setConversations` and the pairing-boundary
 *  `clearAllConversations`; both are invoked only by the subscription wiring and by
 *  `clearPairingScopedState`, never two-way-bound from a component. */

/**
 * EVERY server's rows, in one array (#1086, AC3). Unchanged in name and in its `| null`, and that is
 * what leaves `ChannelList`, `ArchiveScreen` and `ArchivedCountRow` working untouched: only the
 * element type narrows, and `ServerConversationSummary` is assignable to `ConversationSummary`.
 *
 * A plain field read, so two reads with no write between them are `Object.is`-equal by construction
 * (AC4) — the union is computed at write time, not here.
 */
export const selectConversations = (
  s: ConversationListState
): readonly ServerConversationSummary[] | null => s.conversations

/**
 * ONE SERVER's rows (#1086) — a selector factory bound to one origin, the `selectRelayLinkStatusFor` /
 * `selectModelListFor` idiom already used across this directory, and the observable form of AC4's
 * second clause: a write for another server produces a new map, but `newMap.get(mine)` returns the
 * SAME array → `Object.is` true → no re-render.
 *
 * It DOES default a missing slot to `null`, where `selectRelayLinkStatusFor` deliberately does not,
 * and the difference is not an inconsistency: that selector's `undefined` had to stay distinct from a
 * real link CATEGORY, whereas `null` is already this store's not-loaded sentinel and no loaded value
 * is ever `null` — a loaded-empty server is `[]`. The coalesce therefore erases nothing and lets a
 * per-server consumer reuse the same loading branch it already writes for the flat read. `null` is a
 * primitive, so it costs no referential stability.
 *
 * CALL IT WITH A CLIENT-HELD ID. The origin must come from this client's own paired-server list, never
 * from a daemon-supplied field: a wire-sourced lookup key would let a confused or hostile daemon make
 * one host row display another server's conversations — the read-side twin of the write-side rule
 * `stampRows`'s spread order enforces.
 */
export const selectConversationsFor =
  (origin: ConversationListOrigin) =>
  (s: ConversationListState): readonly ServerConversationSummary[] | null =>
    s.byServer.get(origin) ?? null

/** A module-level stable reference for the empty resolution below, so a not-loaded or loaded-empty
 *  server answers the same set every time (the `EMPTY_BACKLOG` idiom). `ReadonlySet` is the only guard
 *  on it — `Object.freeze` does not stop `Set.prototype.add` — so mutating it would take a cast past
 *  the type, and no consumer has cause to. */
export const EMPTY_CONVERSATION_IDS: ReadonlySet<string> = new Set()

/**
 * WHICH CONVERSATIONS BELONG TO THIS SERVER (#1138) — the renderer's shared answer, landed here once
 * rather than restated in the three bridges that scope a reconnect reset by it (#1138 queue backlogs,
 * #1139 background-task rosters, #1140 outstanding prompts). Since #1117 the app holds one live
 * connection per paired server and since #1068 every event carries the id of the server it came from,
 * so `connected` means "THIS server's connection came back" and a subscriber clearing its whole store
 * on that edge discards the other servers' state too.
 *
 * A projection of `selectConversationsFor`, deliberately, rather than a second read of `byServer`: the
 * "CALL IT WITH A CLIENT-HELD ID" rule that selector's docblock states is then carried forward by
 * construction. The origin must come from this client's own paired-server list — a wire-sourced lookup
 * key would let a confused or hostile daemon steer which server's state a reset spares.
 *
 * NOT-LOADED AND LOADED-EMPTY COLLAPSE. `selectConversationsFor` answers `null` for a slot holding no
 * list yet and `[]` for a server that reported zero conversations; for every consumer of this both mean
 * "drop nothing", so both give back the one `EMPTY_CONVERSATION_IDS` reference. Exposing the
 * distinction would be a three-state API with no reader.
 *
 * A `Set`, never a bare object keyed by id: `ServerOrigin`'s docblock in `shared/ipc/events.ts` rules
 * it for any consumer indexing by a daemon-adjacent id, and these ids ARE the daemon's (a `__proto__`
 * id would write through `Object.prototype` on a `Record<string, …>`). Membership is what the consumers
 * test, one lookup per key they hold.
 *
 * NOT A `useConversationListStore` READ SURFACE. A non-empty result is a fresh `Set` per call, so it has
 * no referential stability and subscribing to it would churn re-renders; the consumers call it once,
 * inside an event handler, against `getState()`.
 */
export const selectConversationIdsFor =
  (origin: ConversationListOrigin) =>
  (s: ConversationListState): ReadonlySet<string> => {
    const rows = selectConversationsFor(origin)(s)
    if (rows === null || rows.length === 0) return EMPTY_CONVERSATION_IDS
    return new Set(rows.map((row) => row.id))
  }

/**
 * THE DEPARTED SET, MINUS WHAT ANOTHER MACHINE CLAIMS (#1196) — the ids held for `origin` that appear
 * under NO other slot.
 *
 * WHY A STRICTER SIBLING EXISTS AT ALL. On the per-server unpair path the `serverId` is this client's
 * own (main stamps every event with it through `bindServerOrigin`, and `stampRows`' spread-first order
 * stops a daemon's own `serverId` field from overwriting the stamp), but the conversation IDS are the
 * departing daemon's: they are whatever it listed in its own `conversationsReceived` reply. Nothing
 * stops a confused or hostile paired daemon from listing ids belonging to ANOTHER paired machine, and
 * fed to a thread clear unfiltered that turns "forget machine A" into "destroy machine B's retained
 * threads and close the chat the operator is reading on B" — destructive with no way back, because
 * neither timeline store has any history backfill. Excluding a claimed id turns that into a no-op.
 *
 * It is `serverIdForOpenConversation`'s shipped discipline applied to a SET rather than to one id: that
 * function refuses an ambiguous match with `filter` and a length check rather than `find`, for this
 * exact reason, and its docblock records that two servers reporting the same conversation id "is a
 * condition the app does not otherwise prevent". Honest daemons pay nothing — the daemon mints
 * conversation ids as UUIDv4 from the system random source, so a real collision cannot occur and this
 * answers the same set `selectConversationIdsFor` does.
 *
 * A SIBLING OF `selectConversationIdsFor`, NOT A WIDENING OF IT. That selector is the shared answer the
 * three reconnect-reset bridges (#1138, #1139, #1140) ride, where an over-broad set costs a reset that
 * self-heals; here it costs destruction with no backfill, so this path buys the stricter answer for
 * itself rather than changing the meaning of a read three other consumers depend on.
 *
 * Same three properties as its sibling: a `Set` and never a bare object (these ids are the daemon's, and
 * a `__proto__` id would write through `Object.prototype` on a `Record<string, …>`); the one shared
 * `EMPTY_CONVERSATION_IDS` reference for a not-loaded, loaded-empty OR fully-claimed slot; and NOT a
 * `useConversationListStore` read surface, since a non-empty result is a fresh `Set` per call — the one
 * consumer calls it inside an event handler against `getState()`.
 */
export const selectExclusiveConversationIdsFor =
  (origin: ConversationListOrigin) =>
  (s: ConversationListState): ReadonlySet<string> => {
    const rows = selectConversationsFor(origin)(s)
    if (rows === null || rows.length === 0) return EMPTY_CONVERSATION_IDS
    const claimedElsewhere = new Set<string>()
    for (const [key, kept] of s.byServer) {
      // `!==` on the origin itself, so each of the three key kinds is compared as itself and a slot is
      // never treated as foreign to itself.
      if (key === origin) continue
      for (const kept_row of kept) claimedElsewhere.add(kept_row.id)
    }
    const exclusive = rows.filter((r) => !claimedElsewhere.has(r.id)).map((r) => r.id)
    return exclusive.length === 0 ? EMPTY_CONVERSATION_IDS : new Set(exclusive)
  }

/** The archived-conversation count for the Settings Storage row (#351). Passes `null` (not yet loaded)
 *  through as `null` so the row shows a neutral placeholder rather than a spurious "0 archived"; a loaded
 *  list — including `[]` — resolves to the count of `is_archived === true` rows. A primitive return means
 *  zustand's `Object.is` equality re-renders the row only when the count itself changes, not on every list
 *  replacement. Since #1086 it counts across EVERY server, which is what the row should show an operator
 *  running several daemons; a per-server form is not added until something reads one. */
export const selectArchivedCount = (s: ConversationListState): number | null =>
  s.conversations === null ? null : s.conversations.filter((c) => c.is_archived).length
