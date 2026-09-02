// The model list the daemon publishes for a conversation — the identities claude will accept — kept
// per conversation as one unidirectional source of truth, so the four surfaces offering models read one
// live holder rather than each subscribing to the daemon channel themselves. Pure renderer state — no
// IPC, no preload bridge, no transport. The data path (`modelListBridge.ts`) observes the typed
// `modelList` daemon event (#973 carries what #972 decoded fail-closed from #971's frame) and lands
// each frame here; the run-configuration sheet's model rows (#975) and effort segments (#976), the
// input footer's model and effort menus (#683), and the permission-mode menu (#682, which reads each
// row's `supports_auto_mode`) all read it through `selectModelListFor`.
//
// A dedicated keyed store in the `slashCommandListStore` posture (#954), which is this frame's
// structural twin on the wire too — one conversation id, a row list and a frame-level drop count, drawn
// from the SAME `initialize` control reply. This one inventories the IDENTITIES claude will run as,
// that one the VERBS the working directory will accept. It mirrors that store's DI-factory → singleton
// → hook → selector structure and its copy-on-write `ReadonlyMap`, and like it — and unlike
// `backgroundTaskRosterStore` — it has NO `connected`-edge reset and must never gain one: a reconnect
// to the same daemon does not invalidate a published list, and nothing on this path could re-fetch one.
// The pairing-scoped clear is #977's, landing in `clearPairingScopedState`'s injected dep set rather
// than at either call site (the #588 → #593 and #954 → #955 precedent); this slice ships the store
// shape that clear will attach to and none of the clear itself.
//
// A SNAPSHOT, NEVER A DELTA. Each arriving frame REPLACES that conversation's list wholesale — nothing
// merges, appends or reconciles against the previous one — because the frame states which models
// claude will accept for that conversation right now. There is nothing to join across frames.
//
// DELIVERY IS BEST-EFFORT AND THE STORE MUST BE CORRECT WHEN NOTHING ARRIVES. The daemon pushes the
// list unsolicited from a conversation's `initialize` reply, so a conversation with no list is a
// NORMAL, PERMANENT state — not an error, not a spinner, not a retry. The answer to it is `null` from
// the selector and nothing else. There is no request half on this path and there must never be one: a
// client-side retry against a relay that withholds the frame would be a self-inflicted spin, and a
// consumer must never BLOCK a model menu on this frame, whose delivery window is narrow and lossy.
//
// GROWTH, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
// holding one frame's rows. Each frame is already capped upstream by the daemon's producer cap, and the
// frame cannot arrive unbounded regardless (`MAX_PLAINTEXT_BYTES` caps the decrypted envelope before
// any parse, in `parseInboundMessage`, ahead of `decodeEnvelope` and ahead of every narrower), so the
// bound is distinct ids × frame cap — a flooding relay costs one bounded entry per distinct id rather
// than an unbounded append per frame, and #977's clear will return that to zero at every pairing
// change. `slashCommandListStore`, `conversationActivityStore` and `queueStore` ship the identical
// posture. No speculative eviction policy is built for a failure nobody has observed.
//
// SECURITY: `resolved_model`, `value`, `display_name` and EVERY STRING IN `effort_levels` are
// CLAUDE-AUTHORED text that crossed the subprocess trust boundary. That is a HIGHER trust tier than the
// workspace-authored strings `slashCommandListStore` holds, not a restatement of it, and DECODED IS NOT
// SANITIZED — #972 made the SHAPE trusted and nothing more, a `string` carries no signal for that, and
// the daemon BOUNDS these strings without SANITIZING them. Three obligations follow, and this store
// keeps all three: (a) they are held VERBATIM — never normalised, lowercased, trimmed, allow-listed or
// shape-checked; (b) NOTHING HERE IS A LOOKUP PATH — the map is keyed by `conversationId` and by
// nothing else, and the rows stay an ARRAY rather than an index built from row text, because
// `index[row.display_name] = row` with a `__proto__` label writes through to `Object.prototype`; if a
// later slice needs such an index, THE INDEX IS A `Map`; (c) NOTHING ON THIS PATH IS EVER LOGGED, and
// there is deliberately no diagnostic anywhere in this store. That last clause rests on the CONTRACT
// rather than on a measurement, unlike `slashCommandListStore`'s, which argues from a measured `0x0a`
// across 51 workspace-authored entries: no control byte is measured in these short labels, but the
// daemon does not sanitize, so one is PERMITTED rather than excluded. Do not transcribe the sibling's
// measurement here — it would be a false claim about this frame. `value` in particular IS NOT PARSEABLE
// (the measured entries are `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, `haiku`), so nothing
// may split it to derive a family or present it as a version. This slice has no DOM sink, so the
// inert-escaped-length-bounded render discipline is inherited and discharged by #975 and #976, which
// also owe a React `key` scheme that is not `display_name`. Nothing here is persisted, and nothing may
// be: web storage would outlive the pairing that scoped the list, so a persisted copy would survive
// #977's clear with every in-memory assertion still green. `createModelListStore` takes no storage
// port, unlike `createConversationLastReadStore`, so there is nothing else to reach.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { WireModelOption } from '@shared/wire/types'

/** The held value for ONE conversation: the published rows and the frame's own drop count.
 *
 *  The rows are held VERBATIM AND BY REFERENCE — the array the frame carried, snake_case fields, row
 *  identity and row order preserved. That is the settled house rule for a nested array (five
 *  precedents: `queueState`, `conversationsReceived`, `backgroundTaskRoster`, `questionShown`,
 *  `slashCommandList`), and it is the right call for this frame specifically because THIS FRAME JOINS
 *  NOTHING: `backgroundTaskRosterStore` holds a per-record renderer type because it joins three
 *  sources, while #972's narrower already rebuilt each row as a fresh six-field literal here, so there
 *  is nothing to drop and no mapping to write. Because NO PER-ROW MAPPING EXISTS, each of the
 *  following holds by construction rather than by a guard: a row's `truncated_fields: null` ("nothing
 *  was cut for this row") is never collapsed into `[]`, no row's list is hoisted or flattened across
 *  rows into a single "something was truncated" flag, `effort_levels: []` is never normalised away,
 *  and no string is trimmed or lowercased. Such a by-construction claim stops holding the moment a
 *  mapping appears, so the defence against that regression is a test asserting the held rows are the
 *  SAME objects the frame carried.
 *
 *  ONE FRAME STATES THREE DIFFERENT POSITIONS ON EMPTY and a reader who assumes one rule gets two of
 *  them wrong, which is why all three reach a consumer unchanged: `models: []` is a POSITIVE STATEMENT
 *  that claude offered nothing (the daemon normalises a nil slice, so it is never null); a row's
 *  `effort_levels: []` is a COLLAPSE of absent, null and empty rather than a statement; and a row's
 *  `truncated_fields` is EXEMPT FROM NORMALISATION ENTIRELY, so `null` and `[]` are distinct there.
 *  Carrying all three faithfully is what lets #976 build the effort segments without re-deriving them
 *  — and specifically what lets it read a `truncated_fields` naming `effort_levels` as UNKNOWN rather
 *  than as *none*, the only signal separating a cut list from a model that exposes no effort control.
 *
 *  `droppedModels` IS THE FRAME'S ONLY TRUNCATION REPORT AT THE FRAME LEVEL, so THE LIST'S TRUE SIZE
 *  IS `models.length + droppedModels`. That sum belongs to the consumer: the store carries both numbers
 *  so a reader CAN compute it and never computes it itself, and nothing here recomputes the count from
 *  the number of rows carried or reconciles the two. `0` is a VALUE, never consulted for truthiness —
 *  the key is always written, so an absent one is a real defect rather than a valid zero. THE PRODUCER'S
 *  TEN-ENTRY CAP IS A DAEMON-SIDE PRODUCER CAP, NOT A WIRE CONSTANT: nothing here hardcodes it, treats
 *  a list of exactly ten as a signal, or derives truncation from anything but this field — the
 *  committed upstream fixture does not even satisfy the producer's own invariant (five rows beside
 *  `dropped_models: 2`), because it pins shape rather than capturing live traffic. It is a strictly
 *  different report from a row's own `truncated_fields`, and neither may be collapsed into the other:
 *  a consumer that drops either presents a cut list as complete. */
export interface ModelListEntry {
  models: readonly WireModelOption[]
  droppedModels: number
}

/** The write unit — one conversation's published list = the `modelList` daemon-event arm minus its
 *  `type` tag.
 *
 *  It EXTENDS the entry rather than restating its two fields, for `SlashCommandListSnapshot`'s reason:
 *  the rows are held verbatim, so the write unit is exactly the entry plus the routing key, and
 *  `extends` is what makes a field added later land on both by construction instead of on whichever one
 *  someone remembered.
 *
 *  `conversationId` is an OUTBOUND routing/display-scoping key and NOT a nonce — nothing on this arm is
 *  unguessable and nothing is a secret, so matching it wants plain `Map.get` and specifically not
 *  `crypto.timingSafeEqual`. It stays off `ModelListEntry` deliberately: the entry is what the selector
 *  hands a consumer that already knows which conversation it asked about, so carrying the key in the
 *  value would be a second copy to keep in agreement with the map key. */
export interface ModelListSnapshot extends ModelListEntry {
  conversationId: string
}

/** The whole state: each conversation's published model list, keyed by `conversationId`. A key ABSENT
 *  from the map means "NO frame has arrived for that conversation" and is a DISTINCT state from a
 *  present entry holding `models: []` ("claude published an empty list") — see `selectModelListFor`,
 *  which preserves that distinction rather than collapsing it. `ReadonlyMap` signals the setter
 *  REPLACES the map, never mutates it in place. */
export interface ModelListState {
  lists: ReadonlyMap<string, ModelListEntry>
}

/** Store shape = state + the write path. The mutation lives here and NOT on `ModelListState`, so the
 *  selector — typed against the state-only interface — cannot see it and `initialModelListState` stays
 *  assignable.
 *
 *  There is deliberately NO clear here yet. #977 adds the pairing-boundary one, nullary and total in
 *  the `clearAllSlashCommandLists` / `clearAllTimelines` shape, reached only through
 *  `clearPairingScopedState`'s injected dep set — that is the entry point this shape exists to receive,
 *  and it is why the DI factory, the singleton and this type are three separate exports. There is
 *  likewise no per-conversation drop: nothing has asked for one, and a `conversationDeleted` arm here
 *  would be a second lifetime to keep in agreement with #977's. */
export type ModelListStore = ModelListState & {
  setModelList: (snapshot: ModelListSnapshot) => void
}

export const initialModelListState: ModelListState = { lists: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. One named setter rather than a
 * reducer: there is exactly one mutation, so a discriminated-union action set would be ceremony
 * without benefit. Unidirectional is preserved — read-only selector, one write path, and the setter is
 * invoked only by the subscription, never two-way-bound from a component.
 *
 * `setModelList` replaces ONE conversation's entry wholesale and touches no other key. Copy-on-write
 * (the `slashCommandListStore` idiom): clone the outer map, set the one key, return a fresh state.
 * Never mutate `s.lists` or an entry in place — a write for one conversation leaves every other entry
 * object identical, so a component watching a different id sees `Object.is` true and does not
 * re-render. The map is read INSIDE the `set` updater rather than through `getState()` outside it, so
 * two frames arriving back-to-back cannot interleave: zustand runs the updater synchronously against
 * current state, which closes the only check-then-act shape on this path.
 *
 * The write is UNCONDITIONAL, and that is the point of this store: an empty `models: []` sets that key
 * to an entry holding no rows ("claude offered nothing here"), it does NOT delete the key and is never
 * dropped, filtered or coalesced as "no news". Because a present-but-empty entry and an absent key are
 * different map states, `selectModelListFor` can hand back `null` for the latter and keep the two
 * apart. `droppedModels` is taken from the snapshot unconditionally, including `0`.
 *
 * Nothing is validated, coerced, deduped or shape-checked on the way in. A malformed frame was already
 * rejected upstream by #972's fail-closed narrower inside `daemonConnection`'s decode guard, so no
 * event is emitted at all and nothing malformed reaches here; a second, weaker check in the renderer
 * would only invent a disagreement. A verbatim repeat is written like any other frame. There is no
 * reject branch, nothing throws, and NOTHING IS LOGGED (see the header).
 */
export function createModelListStore(init: ModelListState = initialModelListState) {
  return createStore<ModelListStore>((set) => ({
    ...init,
    setModelList: (snapshot) =>
      set((s) => {
        const next = new Map(s.lists)
        // The rows go in BY REFERENCE and the count straight across — no mapping, no `?? []`, no
        // recomputation of `droppedModels` from `models.length`.
        next.set(snapshot.conversationId, {
          models: snapshot.models,
          droppedModels: snapshot.droppedModels
        })
        return { lists: next }
      })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #975 / #976 / #683 / #682
 *  read. */
export const modelListStore = createModelListStore()

/** Narrow-slice React binding for the four consumers. Selecting a single conversation's list avoids
 *  cross-facet re-renders.
 *
 *  Exported SEPARATELY from `createModelListStore` and `selectModelListFor` on purpose. Seeding a
 *  zustand singleton is INVISIBLE to `renderToStaticMarkup`: the server renderer reads
 *  `getServerSnapshot()`, which zustand wires to the state captured at store creation, so a
 *  seed-then-render test passes against the initial cell no matter what was seeded. A renderer spec
 *  below this slice therefore has to `vi.mock` this module and override ONLY this binding onto a
 *  per-file `createModelListStore()` instance, keeping `...importActual` for the selectors — which is
 *  possible only because the three are separate exports rather than one bundled hook. */
export function useModelListStore<T>(selector: (s: ModelListStore) => T): T {
  return useStore(modelListStore, selector)
}

/**
 * The primary read surface — a selector FACTORY bound to one `conversationId`, and the mechanism by
 * which AC1's distinction reaches a consumer rather than living only in the map.
 *
 * `?? null`, and emphatically NOT `?? EMPTY_LIST`: that collapse is correct for `queueStore` but would
 * make "no frame has arrived" and "claude published an empty list" both read as a bare empty list —
 * with no type error and no failing test unless one is written for it. Three readings:
 *
 *   key absent                              → `null`      no frame has arrived (UNKNOWN)
 *   `{ models: [], droppedModels: 0 }`      → that entry  claude offered nothing
 *   `{ models: [m], droppedModels: 2 }`     → that entry  1 row carried, 3 models in the true list
 *
 * The distinction is load-bearing for every consumer: a sheet that greys out or empties its model rows
 * because no frame has arrived would be wrong, while doing so because claude published an empty list
 * would be right — and #682 reads `supports_auto_mode` per row, so it must know whether it has any
 * rows to reason from at all. `null` is a STABLE reference by construction, which is the whole reason
 * `queueStore` hoists an `EMPTY_*` constant to module scope (a fresh `[]` per selector call churns
 * re-renders), so this slice needs no such constant. It returns the HELD ENTRY ITSELF, never a freshly
 * built object or array. The nullable return type also forces a consumer to branch, so the distinction
 * cannot be ignored accidentally.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME entry object → `Object.is` true → no re-render of a component
 * watching `openId`. There is deliberately no whole-map read surface: nothing iterates every
 * conversation's list, so shipping one would ship an unread read path. This is the sole read path and
 * is never two-way-bound from a component.
 */
export const selectModelListFor =
  (conversationId: string) =>
  (s: ModelListState): ModelListEntry | null =>
    s.lists.get(conversationId) ?? null
