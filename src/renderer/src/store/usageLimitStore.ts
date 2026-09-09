// The latest usage-limit reading claude reported, held PER CONVERSATION so a surface can draw it without
// re-deriving when it expires (#1320). Pure renderer state — no IPC, no preload bridge, no transport. The
// data path (`usageLimitBridge`) observes each arriving `rateLimited` daemon event (#1318 decodes the
// daemon's `rate_limited` frame, #1319 carries it across) and lands its `status` / `limitType` /
// `resetsAt` under the conversation the event names; #1321 reads it through `selectUsageLimitFor` for the
// composer status row.
//
// NAMED FOR THE READING, NOT FOR THE FRAME, and that break with the family convention is deliberate.
// Every sibling here takes its name from its event arm (`modelAnnounced` → `announcedModelStore`,
// `modelList` → `modelListStore`), which would have made this `rateLimitStore`. The arm's own docblock
// names "you are rate limited" as THE realistic client bug: the one non-benign status ever measured is
// `allowed_warning` (2026-08-22, claude 2.1.239, `limit_type: seven_day`), a weekly warning band in which
// EVERY TURN STILL RAN NORMALLY. A module called `rateLimitStore` would nudge every later reader —
// including the surface that writes the copy — toward exactly that overclaim. The frame's plain reading is
// "claude said something about the usage window worth repeating", and that is what this store is called.
// Grep discoverability is unaffected: `translateRateLimited` names the arm, and both headers cite the
// frame.
//
// A DEDICATED STORE BESIDE A BRIDGE, in the `announcedModelStore` posture, and NOT a field on the
// thread-timeline record. A usage-limit window is CONVERSATION-scoped, not turn-scoped: it outlives a
// turn end, a `/clear` and a session transition. State a turn rebuilds would drop the reading at the
// wrong moment and cost every reducer arm an extra field to carry. `timelineBridge`'s `rateLimited`
// no-op recorded that choice as this ticket's to make and is marked PERMANENT now that the
// dedicated-subscriber route is taken; the other three exhaustive bridges said PERMANENT already.
//
// THE UNDERLYING LIMIT IS ACCOUNT-WIDE, and this store keeps the DAEMON'S scoping rather than correcting
// it. The frame names whichever conversation observed the window, so one conversation can carry a reading
// while its siblings show nothing. There is deliberately no fan-out to the account's other conversations:
// the daemon scopes the report, and inventing a wider scope here would attribute to a conversation a
// reading nothing observed for it.
//
// THE LIFECYCLE HAS THREE EXITS AND ONE OF THEM IS "NEVER".
//   - An `allowed` reading clears that conversation's entry, through `clearUsageLimitFor`. The daemon is
//     silent on the benign status today, so this arm has no live producer yet; it is kept because it is
//     one string comparison in the bridge and is the only clean clear the wire will ever offer.
//   - Otherwise the entry stops being READABLE once `resetsAt` has passed — see `selectUsageLimitFor`,
//     which is where the whole expiry lives.
//   - `resetsAt: 0` means claude reported no reset, so there is no time to expire at and the entry stays
//     readable until an `allowed` arrives or the pairing ends.
//
// PAIRING-SCOPED, and IN clearPairingScopedState's set as its fifteenth member. Run against that
// helper's own discriminator — does a reconnect to the SAME daemon need to clear it? — the answer is NO:
// after a reconnect the account's quota window is exactly what it was, nothing on this path re-asserts a
// reading, and there is no request half to re-fetch one, so blanking on the `connected` edge would blank
// a correct value permanently. A pairing that has ENDED is the opposite case: nothing writes the map
// until the new daemon's next reading, and until then a surface would attribute the previous ACCOUNT's
// quota posture to the new one. That is the `announcedModelStore` (#593) → `slashCommandListStore` (#955)
// → `modelListStore` (#977) sequence, verb for verb. `clearServerScopedState` is deliberately NOT the
// join: its docblock parks the conversation-keyed stores out of its scope and closes with "Do NOT key a
// store here to make its clear scopeable." Scoping a DEPARTED SERVER's readings is a later ticket's
// question, exactly as it is for those three.
//
// SECURITY. `status` and `limitType` are CLAUDE-AUTHORED OPEN STRINGS that crossed the subprocess trust
// boundary; the daemon BOUNDS them at construction and does NOT SANITIZE them, so they stay untrusted,
// model-influenced text here. They are held VERBATIM — never normalised, lowercased, trimmed,
// allow-listed or shape-checked — and are usable ONLY AS LOOKUP KEYS FOR CLIENT-OWNED COPY: never
// rendered verbatim, never an authorization signal, never a filename, a cache key or a lookup path. This
// slice has NO DOM SINK, so that constraint is inherited here rather than discharged; #1321 discharges
// it. NOTHING ON THIS PATH IS EVER LOGGED and there is deliberately no diagnostic seam anywhere in this
// module — not even a content-free count of what a clear dropped, because the pair of strings discloses
// the ACCOUNT'S QUOTA POSTURE, a fact about the operator rather than about this frame, and a count is the
// first crack in a property that has to be total to be worth anything.
//
// `conversationId` is a daemon-asserted routing key and a `Map` key here. `ReadonlyMap` is MANDATED and
// `Record<string, …>` FORBIDDEN, on `conversationActivityStore`'s rule: `Map.prototype.get('__proto__')`
// performs no prototype-chain lookup, and `set` / `delete` create and remove ordinary own entries, so
// `__proto__`, `constructor` and `''` are three unremarkable keys BY CONSTRUCTION rather than by
// validation. Three consequences, none of them a type error: nothing is keyed into an object literal, no
// write path uses a computed object key, and `Object.fromEntries`, spreading the map into an object and
// `JSON.stringify` of it are all out. A swap to `Record` would break no other assertion — only
// `usageLimitStore.test.ts`'s hostile-key reads fail, and the PRE-WRITE ones are the half that matters,
// since a `Record` hands a reader `Object.prototype` where `?? null` should have fired. The key STOPS at
// the map: it is never copied into a held record, never rendered, never a filename, a cache key, a lookup
// path, an attribute or a URL, and it reaches no log sink. Matching it wants plain `Map.get` and
// specifically NOT `crypto.timingSafeEqual` — nothing here is unguessable and nothing is a secret, so a
// constant-time compare would claim a property it lacks.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** One conversation's held reading — the `rateLimited` daemon-event arm minus its `type` tag and its
 *  routing key.
 *
 *  `status` is claude's own status for the usage window and `limitType` is which limit the report
 *  concerns. BOTH ARE OPEN STRINGS, NEVER CLOSED ENUMS, and the daemon gives the reason: the value set
 *  beyond the benign one is UNMEASURED — no capture of a limit actually in force exists on any claude
 *  version — so a client that narrows either drops the first real limit that fires. `five_hour` and
 *  `seven_day` are the two observed `limitType` values and two observations do not earn an enum. Both are
 *  held verbatim, per the header's contract, and #1321 selects CLIENT-OWNED COPY by them with a generic
 *  fallback on a miss, so an unrecognised value is ORDINARY rather than an error.
 *
 *  `resetsAt` IS CLAUDE'S NUMBER, NOT THE DAEMON'S CLOCK, in UNIX SECONDS, unvalidated in both
 *  directions. `0` MEANS CLAUDE DID NOT REPORT ONE — emphatically NOT the epoch; see
 *  `selectUsageLimitFor`, which tests for it before it compares anything. Negative and year-40000 values
 *  are representable and neither is rejected, upstream or here, because rejecting one would be a
 *  validation rule with no captured case behind it. IT IS NEVER A SCHEDULING INPUT: a delay computed from
 *  it can be negative (fires immediately, and spins if the handler re-arms) or past `setTimeout`'s
 *  ~24.8-day clamp, which ALSO fires immediately rather than never. Nothing in this module schedules,
 *  allocates or iterates from it — the expiry is one comparison at read time — and #1321 must format it
 *  defensively rather than trusting its range.
 *
 *  `truncated_fields` does not reach here at all: #1319 declined to carry it, on the ground that #1321
 *  renders no daemon-authored string, so a cut value misses the copy lookup exactly as an unrecognised
 *  one does and there is nothing on screen for a truncation marker to qualify. */
export interface UsageLimitReading {
  status: string
  limitType: string
  resetsAt: number
}

/** The write unit — one conversation's reading plus the routing key that files it.
 *
 *  It EXTENDS the reading rather than restating its three fields, for `AnnouncedModelSnapshot`'s reason:
 *  the reading is held verbatim, so the write unit is exactly the record plus the key, and `extends` is
 *  what makes a field added later land on both by construction instead of on whichever one someone
 *  remembered.
 *
 *  `conversationId` stays OFF `UsageLimitReading` deliberately, and that split is load-bearing twice
 *  over. The record is what the selector hands a reader that already knows which conversation it asked
 *  about, so carrying the key in the value would be a second copy to keep in agreement with the map key
 *  — and it would put a daemon-asserted string inside the very object #1321's DOM sink renders from. */
export interface UsageLimitSnapshot extends UsageLimitReading {
  conversationId: string
}

/** The whole state: each conversation's latest reading, keyed by `conversationId`. A key ABSENT from the
 *  map is the distinct "no reading has arrived for that conversation" state — the daemon emits only on a
 *  non-benign window, so a freshly launched app has none and most conversations never have one, and
 *  #1321 must be able to say so explicitly rather than showing another chat's.
 *
 *  A present `{ status: '', limitType: '', resetsAt: 0 }` is a REAL (if degenerate) reading the daemon
 *  emitted, held verbatim and NOT collapsed to an absent key — the `sessionIdStore` `null`-vs-`''`
 *  contract, and see `selectUsageLimitFor`, which preserves the distinction rather than collapsing it.
 *  That arm is reachable, not hypothetical: the daemon's producer emits on any non-empty status, so a
 *  conforming daemon never sends an empty one, but #1318 deliberately declined a second client-side
 *  narrowing, so the decoder passes it through from a non-conforming or hostile daemon.
 *
 *  `ReadonlyMap` signals the setters REPLACE the map, never mutate it in place — and see the header for
 *  why `Record<string, …>` is forbidden outright. */
export interface UsageLimitState {
  readings: ReadonlyMap<string, UsageLimitReading>
}

/** Store shape = state + the three mutation entry points. The mutations live here and NOT on
 *  `UsageLimitState`, so the selector — typed against the state-only interface — cannot see them and
 *  `initialUsageLimitState` stays assignable.
 *
 *  `clearAllUsageLimits` is NULLARY BY DESIGN, the `clearAllModelLists` / `clearAllSlashCommandLists`
 *  property: a pairing ending invalidates EVERY conversation's reading at once, so "takes no conversation
 *  id at all" is a property of this signature that `tsc` enforces rather than a test, and no
 *  daemon-supplied id can steer which account's quota posture survives the boundary. It carries `All` so
 *  the blast radius is legible at the CALL SITE — among the fifteen keys of
 *  `ClearPairingScopedStateDeps`, its only entry point.
 *
 *  `clearUsageLimitFor` is its per-key sibling and the ONLY id-taking mutation here besides the write.
 *  The two are not redundant and neither subsumes the other: this one is the `allowed` reading's exit,
 *  reached from the bridge on an arriving event, while the nullary one is the pairing boundary's and is
 *  daemon-UNREACHABLE. */
export type UsageLimitStore = UsageLimitState & {
  setUsageLimit: (snapshot: UsageLimitSnapshot) => void
  clearUsageLimitFor: (conversationId: string) => void
  clearAllUsageLimits: () => void
}

export const initialUsageLimitState: UsageLimitState = { readings: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. Three named setters rather than a
 * reducer: each is a whole-key or whole-map write, none is an arm of a state machine, and there is no
 * reject branch anywhere, so a discriminated-union action set would be ceremony without benefit.
 * Unidirectional is preserved — read-only selector, store-owned write paths, and every mutation is
 * invoked only by wiring (the subscription for two of them, the pairing-ended helper for the third),
 * never two-way-bound from a component.
 *
 * Nothing is validated, coerced, deduped or shape-checked on the way in. A malformed frame was already
 * rejected upstream by #1318's fail-closed narrower inside `daemonConnection`'s decode guard, so no event
 * is emitted at all and nothing malformed reaches here; a second, weaker check in the renderer would only
 * invent a disagreement. There is no reject branch, nothing throws, and NOTHING IS LOGGED (see the
 * header).
 *
 * GROWTH, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
 * holding one three-field record. Both halves are bounded per frame — `MAX_PLAINTEXT_BYTES` caps the
 * decrypted envelope in `parseInboundMessage` before any parse, ahead of every narrower, and the daemon
 * bounds both strings at construction — so a flooding hostile relay costs one bounded entry per distinct
 * id rather than an unbounded append per frame, and `clearAllUsageLimits` returns that to zero at every
 * pairing change. `modelListStore`, `slashCommandListStore`, `conversationActivityStore` and `queueStore`
 * all ship the identical posture. No speculative eviction policy is built for a failure nobody has
 * observed, and none may be: a second lifetime here would be one more thing to keep in agreement with
 * that clear. In particular the EXPIRY IS NOT AN EVICTION — an expired entry stays in the map and merely
 * stops being readable, which is what keeps this store free of the timer it would otherwise need, and no
 * consumer can observe the difference because the selector is the only read surface.
 *
 * Nothing here is persisted, and nothing may be: web storage would outlive the pairing that scoped the
 * reading, so a persisted copy would survive the clear with every in-memory assertion still green.
 * `createUsageLimitStore` takes no storage port, unlike `createConversationLastReadStore`, so there is
 * nothing else to reach.
 */
export function createUsageLimitStore(init: UsageLimitState = initialUsageLimitState) {
  return createStore<UsageLimitStore>((set) => ({
    ...init,
    // Replaces ONE conversation's reading wholesale and touches no other key: no merge, no coercion, no
    // validation, and NO DEDUP OF A VERBATIM REPEAT. The repeat is not noise — the daemon re-reports the
    // window once per run whatever its state and the transport holds no coalescing, timer or
    // per-conversation memo, so a consumer sees exactly one event per frame and a repeat is the signal
    // that the reading is still current; suppressing it would discard information. One consequence,
    // stated rather than discovered: each write produces a fresh record identity, so a verbatim repeat
    // does re-notify a subscriber watching THAT conversation (#1321 memoises if it ever matters).
    //
    // Copy-on-write (the `announcedModelStore` idiom): clone the outer map, set the one key, return a
    // fresh state. Never mutate `s.readings` or a record in place — a write for one conversation leaves
    // every other record object identical, so a component watching a different id sees `Object.is` true
    // and does not re-render. The map is read INSIDE the `set` updater rather than through `getState()`
    // outside it, so two frames arriving back-to-back cannot interleave: zustand runs the updater
    // synchronously against current state, which closes the only check-then-act shape on this path.
    //
    // UNCONDITIONAL, and that is the point: this setter NEVER branches on held or arriving content. The
    // `allowed` decision lives one layer up in `subscribeUsageLimit`, which routes such a reading to
    // `clearUsageLimitFor` instead of here, so no content guard is needed and none may be added — a
    // write gated on a status would let a hostile daemon craft a value that survives a pairing switch.
    setUsageLimit: (snapshot) =>
      set((s) => {
        const next = new Map(s.readings)
        // A fresh named-field record, so the routing key STOPS at the map key and never reaches what
        // #1321 holds and renders. No computed object key anywhere on this path.
        next.set(snapshot.conversationId, {
          status: snapshot.status,
          limitType: snapshot.limitType,
          resetsAt: snapshot.resetsAt
        })
        return { readings: next }
      }),
    // THE `allowed` EXIT — one conversation's reading dropped because claude reported its window back to
    // the benign state. The `conversationActivityStore.dropConversation` shape adopted verbatim: CLONE
    // the outer map and delete on the clone, never `s.readings.delete(...)`, so every survivor stays
    // `Object.is`-identical to the object held before and a component watching another conversation does
    // not re-render.
    //
    // `has` rather than `get(...) !== undefined`: a held record is never `undefined`, so both work and
    // `has` states the intent. The absent-key guard returns the state OBJECT, so zustand's
    // `Object.is(next, state)` short-circuit fires and no subscriber wakes at all. That is the COMMON
    // case rather than an edge one — the bridge routes every `allowed` reading here and most
    // conversations have never held one — and it is a no-op BY DESIGN, not a swallowed error.
    //
    // It takes the id and NOTHING ELSE: the status that decided this is not carried in, so nothing here
    // can branch on daemon content, and this store keeps its "no mutation reads arriving content"
    // property whole. For an entry whose `resetsAt` is `0` — one that never expires — this and the
    // pairing clear are the only two exits that exist.
    clearUsageLimitFor: (conversationId) =>
      set((s) => {
        if (!s.readings.has(conversationId)) return s
        const next = new Map(s.readings)
        next.delete(conversationId)
        return { readings: next }
      }),
    // THE PAIRING BOUNDARY, reached only through `clearPairingScopedState`'s injected dep set and never
    // from a call site or a bridge arm — keeping it out of `usageLimitBridge` is what makes it
    // daemon-UNREACHABLE, so no arriving event can invoke it. Two halves, each doing something the other
    // cannot, both inherited verb for verb from `clearAllModelLists`:
    //
    //   - It returns `initialUsageLimitState` BY REFERENCE rather than `{ readings: new Map() }`, so
    //     every cleared state holds the SAME `readings` object. That return makes the copy-on-write
    //     above LOAD-BEARING rather than stylistic: this constant is module-shared, so a writer that
    //     ever mutated `s.readings` in place would poison it and every instance that had cleared would
    //     then hand ONE PAIRING'S readings to the next, with no type error. Pinned by a test.
    //   - The `size === 0` guard is the `clearAllModelLists` guard and NOT the `clearAllLastRead` one:
    //     nothing here reaches disk, so there is no side effect to suppress. It buys the stronger half
    //     of idempotence — returning the state OBJECT makes zustand's `Object.is(next, state)`
    //     short-circuit fire, so a redundant clear wakes NO listener at all. `set(initialUsageLimitState)`
    //     unguarded would still allocate a fresh state object and only the selectors would short-circuit.
    //
    // Unconditional beyond that guard, and total: no id, no filter, and NO BRANCH ON HELD CONTENT that
    // could let one conversation's reading outlive the pairing that reported it. A clear gated on a
    // status — recognised, non-empty, or otherwise — would let a hostile daemon craft a value that
    // survives a pairing switch and is then attributed to the next account. Being unguarded is also what
    // makes clearing an already-clear store a no-op by construction. NOTHING IS LOGGED, not even a
    // content-free count of what was dropped (see the header).
    clearAllUsageLimits: () => set((s) => (s.readings.size === 0 ? s : initialUsageLimitState))
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #1321 reads. */
export const usageLimitStore = createUsageLimitStore()

/** Narrow-slice React binding for #1321. Selecting one conversation's reading avoids cross-facet
 *  re-renders.
 *
 *  Exported SEPARATELY from `createUsageLimitStore` and `selectUsageLimitFor` on purpose, for
 *  `useModelListStore`'s reason: seeding a zustand singleton is INVISIBLE to `renderToStaticMarkup`,
 *  because the server renderer reads `getServerSnapshot()`, which zustand wires to the state captured at
 *  store creation — so a seed-then-render test passes against the initial cell no matter what was
 *  seeded. A renderer spec below this slice therefore has to `vi.mock` this module and override ONLY
 *  this binding onto a per-file `createUsageLimitStore()` instance, keeping `...importActual` for the
 *  selector, which is possible only because the three are separate exports. */
export function useUsageLimitStore<T>(selector: (s: UsageLimitStore) => T): T {
  return useStore(usageLimitStore, selector)
}

/**
 * The only read surface — a selector FACTORY bound to one `conversationId` AND one instant, and the
 * single place the expiry lives.
 *
 * TIME ENTERS AS A VALUE, NEVER AS A GLOBAL READ. That is what makes the rule unit-testable in this
 * repo's `node` environment, which has no timers and no DOM, and it is also what keeps the whole module
 * free of the hazard the arm names: nothing here schedules, allocates or iterates from `resetsAt`,
 * because expiry is one comparison performed when a reader asks. `nowSeconds` IS UNIX SECONDS and its
 * NAME IS THE DEFENCE — a caller passing a millisecond `Date.now()` supplies a value roughly a thousand
 * times larger than any real `resetsAt`, so every reading would expire the instant it landed, with no
 * type error and a symptom ("nothing ever shows") identical to the daemon having sent nothing. #1321
 * passes `Math.floor(Date.now() / 1000)`. Pinned by a test.
 *
 * The rule, in reading order, which is also precedence order:
 *
 *   key absent                        → `null`      no reading has arrived for this conversation
 *   `resetsAt === 0`                  → the record  claude reported NO reset — readable indefinitely
 *   `nowSeconds < resetsAt`           → the record  inside the window claude reported
 *   `nowSeconds >= resetsAt`          → `null`      the window claude reported has passed
 *
 * THE ZERO TEST COMES FIRST AND THAT ORDERING IS THE POINT. `0` means claude did not report a reset, not
 * the epoch; folded into the comparison it would read as "expired in 1970" and make every unreported
 * reading invisible the moment it lands, which is the failure this branch forecloses.
 *
 * The boundary is `>=`, so a reading is unreadable AT `resetsAt` as well as after it: the reset instant
 * is when the window is fresh again, not the last instant it was stale. A negative `resetsAt` is a past
 * instant and so expires immediately for any non-negative `nowSeconds` — the honest reading of an
 * unvalidated claude number rather than a rejection, since the wire rejects none either. `NaN` and
 * `Infinity` would fall through to "readable indefinitely" (every comparison against `NaN` is false),
 * and neither is expressible in JSON, so neither reaches here through the wire — `requireNumber`'s
 * type-only check is the upstream fact that rests on, and no guard is built for a failure that cannot
 * arrive.
 *
 * `?? null` keeps absence and a degenerate present record apart, and emphatically does not collapse
 * them: a present `{ status: '', limitType: '', resetsAt: 0 }` is a real reading the daemon emitted,
 * while an absent key is "nothing has been reported for this chat". The nullable return forces #1321 to
 * branch, so the distinction cannot be ignored accidentally.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME record object → `Object.is` true → no re-render of a component
 * watching `openId`. It returns the HELD RECORD ITSELF, never a freshly built object, and `null` is a
 * stable reference, so no `EMPTY_*` module constant is needed. A reader only ever asks for an id it can
 * select, so a reading carrying an id that matches no such conversation is held under its own key and
 * read by NOTHING — there is no `?? activeConversation` fallback anywhere on this path, and no whole-map
 * read surface through which a stray key could surface.
 *
 * The exposed mutations are exactly `setUsageLimit`, `clearUsageLimitFor` and `clearAllUsageLimits`; all
 * three are store-owned and invoked only by wiring — the subscription for the first two,
 * `clearPairingScopedState` (its sole caller) for the third — never two-way-bound from a component.
 */
export const selectUsageLimitFor =
  (conversationId: string, nowSeconds: number) =>
  (s: UsageLimitState): UsageLimitReading | null => {
    const held = s.readings.get(conversationId)
    if (held === undefined) return null
    if (held.resetsAt === 0) return held
    return nowSeconds < held.resetsAt ? held : null
  }
