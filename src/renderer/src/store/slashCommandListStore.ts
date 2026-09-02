// The slash-command menu the daemon publishes for a conversation, kept per conversation as one
// unidirectional source of truth so that any surface offering commands reads one live holder rather
// than asking for the list itself. Pure renderer state — no IPC, no preload bridge, no transport.
// The data path (slashCommandListBridge.ts) observes the typed `slashCommandList` daemon event
// (#937 carries what #936 decoded fail-closed) and lands each frame here; #940's type-ahead and
// #681's Actions-menu grey-out read it through `selectSlashCommandListFor`.
//
// A dedicated keyed store in the `backgroundTaskRosterStore` posture (#573), which is this frame's
// structural relative on the wire too — one conversation id, a row list and a frame-level drop
// count. It mirrors that store's DI-factory → singleton → hook → selector structure and its
// copy-on-write `ReadonlyMap`. What it deliberately does NOT mirror is that store's LIFETIME: there
// is no `resetMenus`, no `connected` branch feeding one, and no entry in `clearPairingScopedState`.
// The roster's reset branch is the sole enforcement of ITS AC5, which is why it is absent from that
// helper; this store's lifetime question is a different one and belongs to #955, which follows the
// #588 → #593 precedent (ship the holder dormant, add the clear to `clearPairingScopedState`'s dep
// set rather than at a call site). Building a clear here is what would push this slice past three
// production files.
//
// A SNAPSHOT, NEVER A DELTA. Each arriving frame REPLACES that conversation's list wholesale —
// nothing merges, appends, or reconciles against the previous one — because the frame states what
// this session IN ITS WORKING DIRECTORY will accept right now. Nothing may be cached across working
// directories, and nothing may treat a small list as an error: the count is workspace- and
// version-dependent by design (51 entries measured against claude 2.1.239 in one repository, 74
// against 2.1.220 in a plainer one). No entry cap and no per-field byte bound is modelled here for
// `BackgroundTaskRosterPayload`'s reason — the enforcement is the daemon's, a second copy would be a
// second bound to keep in agreement, and the frame cannot arrive unbounded regardless
// (MAX_PLAINTEXT_BYTES caps the decrypted envelope before any parse).
//
// DELIVERY IS BEST-EFFORT AND THE STORE MUST BE CORRECT WHEN NOTHING ARRIVES. The daemon's published
// delivery window names three loss points — the bootstrap child's menu is dropped unconditionally, a
// busy session can refuse the frame at the fan-in, and a session rotation delivers no fresh menu —
// so a conversation with no list is a NORMAL, PERMANENT state, not an error, not a spinner, not a
// retry. The answer to it is `null` from the selector and nothing else. There is no request half on
// this path and there must never be one: the daemon pushes the list unsolicited from the
// `initialize` reply, and a client-side retry against a relay that withholds the frame would be a
// self-inflicted spin.
//
// GROWTH, stated rather than defended: one entry per distinct `conversationId` seen since launch,
// each holding one frame's rows, with no clear in this slice. Each frame is already capped upstream,
// so the bound is entries × frame cap — a flooding relay costs one bounded entry per distinct id
// rather than an unbounded append per frame. `conversationActivityStore` (#748) and `queueStore`
// ship the identical posture, and #955 lands the clear. No speculative eviction policy is built for
// a failure nobody has observed.
//
// SECURITY: `name`, `argument_hint`, `description` and EVERY STRING IN `aliases` are
// WORKSPACE-AUTHORED — whoever wrote the repository wrote them. That is a LOWER trust tier than the
// claude-authored text `announcedModelStore` and `questionBatchStore` hold, not a restatement of it,
// and the daemon BOUNDS them without SANITIZING them. Three obligations follow, and this store keeps
// all three: (a) they are held VERBATIM — never normalised, lowercased, trimmed, allow-listed or
// shape-checked; (b) `name` IS NOT AN IDENTIFIER (one measured name is `__remote-workflow`), so
// nothing here keys a cache, a memo or a lookup path by it — the map is keyed by `conversationId`
// and by nothing else, and the rows stay an array rather than an index built from workspace text;
// (c) NOTHING ON THIS PATH IS EVER LOGGED. That last clause binds HERE rather than being inherited:
// `0x0a` is the only sub-`0x20` byte across the capture's 51 entries' four string fields, so the
// control character that actually occurs is the one that splits a log line, and a logged
// `description` is a workspace author forging log records in a file readable by anything running as
// the user. There is deliberately no diagnostic anywhere in this store. This slice has no DOM sink,
// so the plain-text-never-HTML discipline is inherited and discharged by #940's render slice, which
// also owes a React `key` scheme that is not `name`. Nothing here is persisted, and nothing may be:
// web storage would outlive the pairing that scoped the menu and defeat #955's clear before it is
// written.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { WireSlashCommand } from '@shared/wire/types'

/** The held value for ONE conversation: the published rows and the frame's own drop count.
 *
 *  The rows are held VERBATIM AND BY REFERENCE — the array the frame carried, snake_case fields, row
 *  identity and row order preserved. That is the settled house rule for a nested array (four
 *  precedents: `queueState`, `conversationsReceived`, `backgroundTaskRoster`, `questionShown`), and
 *  #936's narrower already stripped each row to its five known fields, so there is nothing to drop
 *  and no mapping to write. Because NO PER-ROW MAPPING EXISTS, each of these holds by construction
 *  rather than by a guard: a row's `truncated_fields: null` ("nothing was cut for this row") is never
 *  collapsed into `[]`, no row's list is hoisted or flattened across rows into a single
 *  "something was truncated" flag, `aliases: []` is never normalised, and an empty `argument_hint`
 *  (33 of the capture's 51 entries) is never trimmed away. #573's overview records that such a
 *  by-construction claim stops holding the moment a mapping appears, so the defence against that
 *  regression is a test asserting the held rows are the SAME objects the frame carried.
 *
 *  `droppedCommands` IS THE FRAME'S ONLY TRUNCATION REPORT AT THE FRAME LEVEL, so THE MENU'S TRUE
 *  SIZE IS `commands.length + droppedCommands`. That sum belongs to the consumer: the store carries
 *  both numbers so a reader CAN compute it and never computes it itself, and nothing here recomputes
 *  the count from the number of rows carried or reconciles the two. `0` is a VALUE, never consulted
 *  for truthiness — the key is always written, so an absent one is a real defect rather than a valid
 *  zero. It is a strictly different report from a row's own `truncated_fields`, and neither may be
 *  collapsed into the other: a consumer that drops either presents a cut menu as complete.
 *
 *  `commands: []` is a POSITIVE STATEMENT that claude offered nothing, and it still carries this
 *  count — a frame with every row dropped is not an empty menu. Note the contrast with
 *  `questionShown`, whose empty array is out of contract and means a producer bug: the two read
 *  alike and say opposite things. */
export interface SlashCommandListEntry {
  commands: readonly WireSlashCommand[]
  droppedCommands: number
}

/** The write unit — one conversation's published menu = the `slashCommandList` daemon-event arm minus
 *  its `type` tag.
 *
 *  It EXTENDS the entry rather than restating its two fields, unlike `BackgroundTaskRosterSnapshot`,
 *  which could not: there the write unit carries wire rows while the entry carries a held map, so the
 *  two genuinely differ. Here the rows are held verbatim, so the write unit is exactly the entry plus
 *  the routing key, and `extends` is what makes a field added later land on both by construction
 *  instead of on whichever one someone remembered.
 *
 *  `conversationId` is an OUTBOUND routing/scoping key and NOT a nonce — nothing on this arm is
 *  unguessable and nothing is a secret, unlike `questionShown`'s batch id. It stays off
 *  `SlashCommandListEntry` deliberately: the entry is what the selector hands a consumer that already
 *  knows which conversation it asked about, so carrying the key in the value would be a second copy
 *  to keep in agreement with the map key. */
export interface SlashCommandListSnapshot extends SlashCommandListEntry {
  conversationId: string
}

/** The whole state: each conversation's published menu, keyed by `conversationId`. A key ABSENT from
 *  the map means "NO frame has arrived for that conversation" and is a DISTINCT state from a present
 *  entry holding `commands: []` ("claude published an empty menu") — see `selectSlashCommandListFor`,
 *  which preserves that distinction rather than collapsing it. `ReadonlyMap` signals the setter
 *  REPLACES the map, never mutates it in place. */
export interface SlashCommandListState {
  menus: ReadonlyMap<string, SlashCommandListEntry>
}

/** Store shape = state + the single mutation entry point. The mutation lives here and NOT on
 *  `SlashCommandListState`, so the selector — typed against the state-only interface — cannot see it
 *  and `initialSlashCommandListState` stays assignable. */
export type SlashCommandListStore = SlashCommandListState & {
  setSlashCommandList: (snapshot: SlashCommandListSnapshot) => void
}

export const initialSlashCommandListState: SlashCommandListState = { menus: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. One named setter rather than a
 * reducer: there is exactly one mutation, so a discriminated-union action set would be ceremony
 * without benefit. Unidirectional is preserved — read-only selector, one write path, and the setter
 * is invoked only by the subscription, never two-way-bound from a component.
 *
 * `setSlashCommandList` replaces ONE conversation's entry wholesale and touches no other key.
 * Copy-on-write (the `backgroundTaskRosterStore` idiom): clone the outer map, set the one key,
 * return a fresh state. Never mutate `s.menus` or an entry in place — a write for one conversation
 * leaves every other entry object identical, so a component watching a different id sees `Object.is`
 * true and does not re-render.
 *
 * The write is UNCONDITIONAL, and that is the point of this store: an empty `commands: []` sets that
 * key to an entry holding no commands ("claude offered nothing here"), it does NOT delete the key and
 * is never dropped, filtered, or coalesced as "no news". Because a present-but-empty entry and an
 * absent key are different map states, `selectSlashCommandListFor` can hand back `null` for the
 * latter and keep the two apart. `droppedCommands` is taken from the snapshot unconditionally,
 * including `0`.
 *
 * Nothing is validated, coerced, deduped or shape-checked on the way in. A malformed frame was
 * already rejected upstream by #936's fail-closed narrower inside `daemonConnection`'s decode guard,
 * so no event is emitted at all and nothing malformed reaches here; a second, weaker check in the
 * renderer would only invent a disagreement. A verbatim repeat is written like any other frame — the
 * transport holds no state, so a consumer sees exactly one event per daemon frame and a repeat is the
 * signal that the menu is still current. There is no reject branch, nothing throws, and NOTHING IS
 * LOGGED (see the header).
 */
export function createSlashCommandListStore(
  init: SlashCommandListState = initialSlashCommandListState
) {
  return createStore<SlashCommandListStore>((set) => ({
    ...init,
    setSlashCommandList: (snapshot) =>
      set((s) => {
        const next = new Map(s.menus)
        // The rows go in BY REFERENCE and the count straight across — no mapping, no `?? []`, no
        // recomputation of `droppedCommands` from `commands.length`.
        next.set(snapshot.conversationId, {
          commands: snapshot.commands,
          droppedCommands: snapshot.droppedCommands
        })
        return { menus: next }
      })
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #940 / #681 read. */
export const slashCommandListStore = createSlashCommandListStore()

/** Narrow-slice React binding for #940 / #681. Selecting a single conversation's menu avoids
 *  cross-facet re-renders. */
export function useSlashCommandListStore<T>(selector: (s: SlashCommandListStore) => T): T {
  return useStore(slashCommandListStore, selector)
}

/**
 * The primary read surface — a selector FACTORY bound to one `conversationId`, and the mechanism by
 * which AC2's distinction reaches a consumer rather than living only in the map.
 *
 * `?? null`, and emphatically NOT `?? EMPTY_MENU`: that collapse is correct for `queueStore` but
 * would make "no frame has arrived" and "claude published an empty menu" both read as a bare empty
 * list — with no type error and no failing test unless one is written for it. #681 needs exactly this
 * distinction, and gets the wrong answer from either collapse: greying out every fixed entry because
 * no list has arrived yet would be wrong, while greying them out because claude published an empty
 * list would be right. Three readings:
 *
 *   key absent                                  → `null`      no frame has arrived (UNKNOWN)
 *   `{ commands: [], droppedCommands: 0 }`      → that entry  claude offered nothing
 *   `{ commands: [c], droppedCommands: 2 }`     → that entry  1 row carried, 3 verbs in the true menu
 *
 * `null` is a STABLE reference by construction, which is the whole reason `queueStore` hoists an
 * `EMPTY_*` constant to module scope (a fresh `[]` per selector call churns re-renders) — so this
 * slice needs no such constant at all. It returns the HELD ENTRY ITSELF, never a freshly built object
 * or array. The nullable return type also forces a consumer to branch, so the distinction cannot be
 * ignored accidentally.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME entry object → `Object.is` true → no re-render of a component
 * watching `openId`. There is deliberately no whole-map read surface: nothing iterates every
 * conversation's menu, so shipping one would ship an unread read path. This is the sole read path and
 * is never two-way-bound from a component.
 */
export const selectSlashCommandListFor =
  (conversationId: string) =>
  (s: SlashCommandListState): SlashCommandListEntry | null =>
    s.menus.get(conversationId) ?? null
