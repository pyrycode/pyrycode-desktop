// The model claude announced for the running turn, held PER CONVERSATION as one unidirectional source
// of truth for the run-configuration sheet (#560) and the composer's model menu (#1053). Pure renderer
// state — no IPC, no preload bridge, no transport. The data path (`announcedModelBridge`) observes each
// arriving `modelAnnounced` daemon event (#587 decodes claude's `system` / `init` line) and lands its
// `model`/`truncated` under the conversation the event names; both readers ask through
// `selectAnnouncedModelFor` for the conversation they have open.
//
// KEYED BY `conversationId` SINCE #1146, in the `modelListStore` posture — its structural twin in this
// family, read on the adjacent line by both of these same consumers. It was a single app-wide slot from
// #588 through #1141, keyed by neither server nor conversation, which was defensible only while the app
// held one daemon: with two servers paired the slot held whichever daemon spoke last, so opening a
// conversation on the other server attributed the previous daemon's identifier — and its `truncated` cut
// report — to it, under a header that carries no provenance marker. Nothing cleared it on a conversation
// switch, deliberately, on the argument that an announcement is daemon-scoped rather than
// conversation-scoped; keying the map is what retires that argument rather than patching around it.
// The defect predates #1141: it needs no pairing change to reproduce, only two servers and two chats.
//
// A dedicated store (the runConfigStore precedent, #187), NOT a
// runConfigStore facet, on four grounds. (a) Lifetime: runConfigStore's data path requests a fresh
// snapshot on sheet open (runConfigStore.ts:1-5), whereas this holder must be App-level
// always-listening — an announcement rides the turn's init line whether or not any sheet is open.
// (b) All three exhaustive bridges already name this as a distinct thing (daemonEventBridge.ts:150,
// modalBridge.ts:101, timelineBridge.ts:161). (c) The name collides and means the OPPOSITE:
// runConfigStore.ts:27 holds `model: string` meaning the per-session OVERRIDE (`''` = inherited
// default), while this one is what claude ANNOUNCED, and in the ordinary case the two disagree
// (events.ts:179-185). (d) runConfigStore's `snapshot: null` already spends the not-yet sentinel, so
// folding in would need a second one nested inside it. The two stores stay orthogonal and an
// announcement re-renders only components selecting this slice.
//
// Named setters rather than a reducer: the two mutations ("record the latest announcement" and, since
// #593, "clear when the pairing that scoped it ends") are independent whole-value writes — neither
// reads prior state and neither constrains the other's ordering — so there is no state machine for a
// discriminated-union action set to model; it would still be ceremony without benefit. Unidirectional
// is preserved: read-only selector, store-owned write paths, and both mutations are invoked only by
// wiring (the subscription for one, the pairing-ended helper for the other), never two-way-bound from a
// component.
//
// PAIRING-SCOPED, and IN clearPairingScopedState's set (#529, joined by #593). By that helper's own
// rule a pairing-scoped store that nothing re-asserts on the new pairing belongs there, and this one
// qualifies: nothing on a fresh pairing re-asserts an announcement — the next one arrives only with the
// next turn's init line, so a stale record would otherwise latch. Keying the map narrows what that
// clear is for without retiring it. The stale-across-servers case it used to be the only guard against
// is now answered by construction, because a record can only be read back under the conversation it was
// announced for; what remains is that the whole map describes a pairing that has ended, and dropping it
// there is what makes #1146's AC4 hold with no edit to that helper, to its dep set, or to `PairedShell`.
//
// NOT on the transport's `connected` edge, the other mechanism, which is mutually exclusive with this
// one by design — that helper's docstring excludes stores the `connected` edge already clears. The
// discriminator is one question: does a reconnect to the SAME daemon need to clear it? For
// `backgroundTaskRosterStore` yes, and its bridge branch is the sole enforcement of #573's AC5. Here NO:
// after a reconnect to the same daemon every held announcement still describes that daemon, and clearing
// them would blank correct values neither reader has any way to re-fetch — there is no request half on
// this path, only the unsolicited announcement.
//
// SECURITY: `conversationId` is a daemon-asserted routing key and, since #1146, a `Map` key in this
// store. `ReadonlyMap` is MANDATED and `Record<string, …>` FORBIDDEN, on `conversationActivityStore`'s
// rule: `Map.prototype.get('__proto__')` performs no prototype-chain lookup and `set` creates an
// ordinary own entry, so `__proto__`, `constructor` and `''` are three unremarkable keys by construction
// rather than by validation. Three consequences, none of them a type error: nothing is keyed into an
// object literal, the write path uses no computed object keys, and `Object.fromEntries`, spreading the
// map into an object and `JSON.stringify` of it are all out. A swap to `Record` would break no other
// assertion — only `announcedModelStore.test.ts`'s hostile-key reads fail, and the pre-write ones are
// the half that matters, since a `Record` hands a reader `Object.prototype` where `?? null` should have
// fired. The key STOPS at the map: it is never copied into a held record, never rendered, never a
// filename, a cache key, a lookup path, an attribute or a URL, and it reaches no log sink. Matching it
// wants plain `Map.get` and specifically NOT `crypto.timingSafeEqual` — nothing on this arm is
// unguessable and nothing is a secret, so a constant-time compare would claim a property it lacks.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The held announcement. `model` is claude's identifier held VERBATIM — never normalised, lowercased,
 *  allow-listed, date-stamped, family-mapped, or shape-checked. claude echoes an identifier at least as
 *  specific as the one it was given, so `claude-haiku-4-5` announces back undated and appears in no
 *  published model list: a MISS on #560's exact lookup is ORDINARY, not an error.
 *
 *  `truncated` is the daemon's cut report and is LOAD-BEARING: a consumer that ignores it presents
 *  claude's cut text as complete, and a cut identifier always misses #560's lookup and so always
 *  renders verbatim, looking exactly like a legitimate unrecognised model. `false` is a VALUE (nothing
 *  was cut), never an absence.
 *
 *  SECURITY: `model` is UNTRUSTED, model-influenced daemon-relayed text. The daemon BOUNDS it (256
 *  bytes) but does NOT SANITIZE it — nothing strips control characters or terminal escapes anywhere on
 *  this path — so #560's render surface must treat it as PLAIN TEXT ONLY, NEVER HTML (no innerHTML /
 *  dangerouslySetInnerHTML), never into an attribute or a URL. It is a REPORT, NEVER A CONTROL INPUT:
 *  no security-relevant behaviour may branch on it, and it is not a cache key, a filename, or a lookup
 *  path. This slice has no DOM sink, so the constraint is inherited here rather than discharged.
 *  Mirrors the `modelAnnounced` event shape (events.ts:174-211). */
export interface AnnouncedModel {
  model: string
  truncated: boolean
}

/** The write unit — one conversation's announcement = the `modelAnnounced` daemon-event arm minus its
 *  `type` tag.
 *
 *  It EXTENDS the record rather than restating its two fields, for `ModelListSnapshot`'s reason: the
 *  record is held verbatim, so the write unit is exactly the record plus the routing key, and `extends`
 *  is what makes a field added later land on both by construction instead of on whichever one someone
 *  remembered.
 *
 *  `conversationId` stays OFF `AnnouncedModel` deliberately, and that split is load-bearing twice over.
 *  The record is what the selector hands a reader that already knows which conversation it asked about,
 *  so carrying the key in the value would be a second copy to keep in agreement with the map key — and
 *  it would put a daemon-asserted string inside the very object both DOM sinks render from. */
export interface AnnouncedModelSnapshot extends AnnouncedModel {
  conversationId: string
}

/** The whole state: each conversation's announced model, keyed by `conversationId`. A key ABSENT from
 *  the map is the distinct "no announcement has arrived for that conversation" state — an announcement
 *  arrives once per turn, so a freshly launched app has none, a conversation nobody has sent to has
 *  none, and both readers must be able to say so explicitly rather than showing another chat's.
 *
 *  A present `{ model: '', truncated: false }` is a REAL (if degenerate) announcement the daemon
 *  emitted, held verbatim and NOT collapsed to an absent key — the sessionIdStore `null`-vs-`''`
 *  contract, and see `selectAnnouncedModelFor`, which preserves the distinction rather than collapsing
 *  it. That arm is reachable, not hypothetical: the daemon's producer suppresses an empty model so a
 *  conforming daemon never sends one, but #587 deliberately declined a second client-side suppression,
 *  so the decoder passes it through from a non-conforming or hostile daemon.
 *
 *  The two-field record as the map VALUE (rather than flattening into
 *  `{ model: string | null; truncated: boolean }` per key) is load-bearing rather than stylistic, for
 *  the reason the pre-#1146 nullable had: the flat shape would force `truncated` to carry a value where
 *  no announcement exists, contradicting "`false` is a VALUE, never an absence". Absence lives in the
 *  map's keyspace, so every field of a present record is a real daemon-delivered value by construction.
 *
 *  `ReadonlyMap` signals the setter REPLACES the map, never mutates it in place — and see the header for
 *  why `Record<string, …>` is forbidden outright. */
export interface AnnouncedModelState {
  announced: ReadonlyMap<string, AnnouncedModel>
}

/** Store shape = state + the two mutation entry points. The mutations live here and NOT on
 *  `AnnouncedModelState`, so the selector — typed against the state-only interface — cannot see them
 *  and `initialAnnouncedModelState` stays assignable. */
export type AnnouncedModelStore = AnnouncedModelState & {
  setAnnouncedModel: (snapshot: AnnouncedModelSnapshot) => void
  clearAnnouncedModel: () => void
}

export const initialAnnouncedModelState: AnnouncedModelState = { announced: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. `setAnnouncedModel` replaces ONE
 * conversation's record wholesale and touches no other key: no merge, no coercion, no validation, and
 * NO DEDUP OF A VERBATIM REPEAT. The repeat is not noise — the transport holds no state, so a consumer
 * sees exactly one event per daemon frame, and a repeat is the signal that the value is still current;
 * suppressing it would discard information. One consequence, stated rather than discovered: each write
 * produces a fresh record identity, so a verbatim repeat does re-notify a subscriber watching THAT
 * conversation (either reader memoises if it ever matters).
 *
 * Copy-on-write (the `modelListStore` idiom): clone the outer map, set the one key, return a fresh
 * state. Never mutate `s.announced` or a record in place — a write for one conversation leaves every
 * other record object identical, so a component watching a different id sees `Object.is` true and does
 * not re-render. The map is read INSIDE the `set` updater rather than through `getState()` outside it,
 * so two frames arriving back-to-back cannot interleave: zustand runs the updater synchronously against
 * current state, which closes the only check-then-act shape on this path.
 *
 * GROWTH, stated rather than defended, and CHANGED BY #1146 from the O(1) single slot this store used
 * to be: one entry per distinct `conversationId` seen since launch, each holding one two-field record.
 * Both halves are bounded per frame — `MAX_PLAINTEXT_BYTES` caps the decrypted envelope before any
 * parse, ahead of every narrower, and the daemon bounds `model` at 256 bytes — so a flooding hostile
 * relay costs one bounded entry per distinct id rather than an unbounded append per frame, and the clear
 * below returns that to zero at every pairing change. `modelListStore`, `slashCommandListStore`,
 * `conversationActivityStore` and `queueStore` all ship the identical posture. No speculative eviction
 * policy is built for a failure nobody has observed, and none may be: a second lifetime here would be
 * one more thing to keep in agreement with that clear.
 *
 * `clearAnnouncedModel` (#593) returns the state to `initialAnnouncedModelState` for when the pairing
 * that scoped the announcements ends — sourced from that exported constant rather than a fresh literal,
 * so it keeps resetting everything if the state ever gains a second field. Since #1146 that is a
 * WHOLE-MAP clear rather than a single reset, which is why it keeps its nullary signature and its name:
 * a pairing ending invalidates EVERY conversation's announcement at once, and renaming it to match
 * `clearAllModelLists` would churn the `ClearPairingScopedStateDeps` member, that helper's sorted-key
 * pin and the `PairedShell` wiring for nothing observable. It restores the absent-key state, never a
 * `{ model: '', truncated: false }` record under some id. It is unconditional and NEVER branches on held
 * content: a clear gated on an identifier (non-empty, catalog-matching, or otherwise) would let a
 * hostile daemon craft a value that survives a pairing switch and is then attributed to the next daemon.
 * Being unguarded is also what makes clearing an already-clear store a no-op by construction.
 *
 * Returning that constant BY REFERENCE is what makes the copy-on-write above load-bearing rather than
 * stylistic: the constant is module-shared, so a writer that ever mutated `s.announced` in place would
 * poison it and every instance that had cleared would then hand ONE PAIRING'S announcements to the next,
 * with no type error. Pinned by a test rather than by a guard.
 *
 * A `modelAnnounced` frame already queued on the IPC channel when the clear runs repopulates the map
 * afterwards, because every write here is unconditional and last-write-wins: `AnnouncedModelData` is an
 * App-level sibling of `AppView`, so the unpair route flip does not unmount its listener. That is the
 * window `sessionIdStore` documents and deliberately leaves alone, inherited for the same reason —
 * guarding it belongs with the pairing lifecycle that owns the clear, not in a store whose whole
 * contract is to record what it was told. Keying made that window STRICTLY NARROWER rather than wider:
 * the late record lands under a departed pairing's conversation id, which nothing can select any more,
 * where it used to land in the one slot every reader read.
 *
 * The stored value is the daemon's, as-is.
 */
export function createAnnouncedModelStore(
  init: AnnouncedModelState = initialAnnouncedModelState
) {
  return createStore<AnnouncedModelStore>((set) => ({
    ...init,
    setAnnouncedModel: (snapshot) =>
      set((s) => {
        const next = new Map(s.announced)
        // A fresh named-field record, so the routing key STOPS at the map key and never reaches what a
        // reader holds and renders. No computed object key anywhere on this path.
        next.set(snapshot.conversationId, {
          model: snapshot.model,
          truncated: snapshot.truncated
        })
        return { announced: next }
      }),
    clearAnnouncedModel: () => set(initialAnnouncedModelState)
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #560 / #1053 read. */
export const announcedModelStore = createAnnouncedModelStore()

/** Narrow-slice React binding for the two readers. Selecting one conversation's announcement avoids
 *  cross-facet re-renders. Exported SEPARATELY from `createAnnouncedModelStore` and
 *  `selectAnnouncedModelFor` on purpose, for `useModelListStore`'s reason: seeding a zustand singleton
 *  is invisible to `renderToStaticMarkup`, so a renderer spec below this slice has to `vi.mock` this
 *  module and override ONLY this binding onto a per-file instance, keeping `...importActual` for the
 *  selector — which is possible only because the three are separate exports. */
export function useAnnouncedModelStore<T>(selector: (s: AnnouncedModelStore) => T): T {
  return useStore(announcedModelStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one `conversationId`, and the mechanism by which
 * #1146's whole point reaches a consumer rather than living only in the map: a reader asks for the
 * conversation it has open and gets that conversation's announcement or nothing.
 *
 * `?? null` keeps the two states apart, and emphatically does not collapse them:
 *
 *   key absent                            → `null`       nothing has been announced for this chat
 *   `{ model: '', truncated: false }`     → that record  the daemon announced an empty identifier
 *
 * AC3 falls out of this by construction. A reader only ever asks for an id it can select, so an
 * announcement carrying an id that matches no such conversation is held under its own key and read by
 * NOTHING — there is no `?? activeConversation` fallback anywhere on this path, which is the rule the
 * `modelAnnounced` arm states, and no whole-map read surface through which a stray key could surface.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME record object → `Object.is` true → no re-render of a component
 * watching `openId`. It returns the HELD RECORD ITSELF, never a freshly built object, and `null` is a
 * stable reference, so no `EMPTY_*` module constant is needed. The nullable return also forces a
 * consumer to branch, so the distinction cannot be ignored accidentally.
 *
 * The exposed mutations are exactly `setAnnouncedModel` and `clearAnnouncedModel`; both are store-owned
 * and invoked only by wiring — the subscription for the first, `clearPairingScopedState` (its sole
 * caller) for the second — never two-way-bound from a component.
 */
export const selectAnnouncedModelFor =
  (conversationId: string) =>
  (s: AnnouncedModelState): AnnouncedModel | null =>
    s.announced.get(conversationId) ?? null
