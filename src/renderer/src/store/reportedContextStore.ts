// The latest context-window reading claude reported, held PER CONVERSATION so the footer (#1421), the
// gauge (#1421) and the breakdown popover (#1254) all read ONE figure per chat rather than each
// deriving its own (#1420). Pure renderer state — no IPC, no preload bridge, no transport. The data
// path (`reportedContextBridge`) observes each arriving `contextUsage` daemon event (#1454 decodes the
// reading, #1455 / #1459 / #1460 its three inventories, #1419 carries the frame across) and lands all
// ten fields under the conversation the event names.
//
// NAMED FOR THE READING AND FOR ITS PRODUCER, not for the frame, and that break with the family
// convention is deliberate for a CONCRETE reason rather than a stylistic one. Every sibling here takes
// its name from its event arm (`modelAnnounced` → `announcedModelStore`, `rateLimited` →
// `usageLimitStore`'s own documented break), which would have made this `contextUsageStore` — and
// `screens/conversation/contextUsage.ts` ALREADY EXISTS, exporting `contextUsagePercent` and
// `contextUsageStep`. That helper derives a percent from `runConfigStore`'s settings snapshot and keeps
// both its callers untouched; THIS store is the separate, pushed, per-conversation figure claude
// reports for ITSELF. They are two different facts, both live, and a module name that could be
// mistaken for the other on an import line is the whole hazard. `reportedContextStore` says the
// distinguishing fact — claude REPORTED this one. Grep discoverability is unaffected:
// `translateContextUsage` names the arm, and both module headers cite the frame.
//
// A DEDICATED STORE BESIDE A BRIDGE, in the `usageLimitStore` / `announcedModelStore` posture, and NOT
// a field on the thread-timeline record. A context window is CONVERSATION-scoped, not turn-scoped: it
// outlives a turn end, a `/clear` and a session transition. State a turn rebuilds would drop the
// reading at the wrong moment and would cost every reducer arm TEN extra fields to carry.
// `timelineBridge`'s `contextUsage` no-op recorded that choice as this ticket's to make and is marked
// PERMANENT now that the dedicated-subscriber route is taken; the other three exhaustive bridges said
// PERMANENT already.
//
// TWO MUTATIONS, NOT THREE, and the missing one is the point. #1320's per-key `clearUsageLimitFor`
// exists because its `rate_limited` arm carries a benign `allowed` status that ENDS a window. This arm
// has no such value: EVERY FRAME IS A READING, and a window that shrinks at a `/clear` or a compaction
// arrives as the NEXT FRAME rather than as an absence. A per-conversation clear would have no caller.
// `conversationDeleted` is not routed either, exactly as `usageLimitStore` declines to route it: a
// delete-time drop is a later ticket's question if it ever becomes one, and building an eviction policy
// for a failure nobody has observed is what that store's header forbids. So the lifecycle has ONE exit
// — the pairing ending — and until then the last frame stands.
//
// PAIRING-SCOPED, and IN clearPairingScopedState's set. Run against that helper's own discriminator —
// does a reconnect to the SAME daemon need to clear it? — the answer is NO: after a reconnect the
// window is whatever claude last reported, that conversation's next turn end re-reports it, and there
// is no request half to re-fetch a value blanked at the `connected` edge, so blanking there would blank
// a correct value with nothing to restore it. A pairing that has ENDED is the opposite case: nothing
// writes the map until the new daemon's next turn ends, and until then a surface would attribute a
// DEPARTED machine's window composition — its model identity, its MCP server names, its memory-file
// paths — to the new one. That is the `announcedModelStore` (#593) → `slashCommandListStore` (#955) →
// `modelListStore` (#977) → `usageLimitStore` (#1320) sequence, verb for verb. `clearServerScopedState`
// is deliberately NOT the join: its docblock parks the conversation-keyed stores out of its scope.
//
// SECURITY — THE UNTRUSTED CONTENT IS NESTED, which is the thing a reader of this store will miss.
// `model` is ONE untrusted string on the record; every other one is INSIDE a row of one of the three
// inventories, so a consumer that has internalised "the untrusted fields are the string-typed ones on
// the record" will handle exactly one of five. The daemon BOUNDS all of them at construction and
// SANITIZES none, so each stays untrusted, model- or workspace-authored text. All ten fields are held
// VERBATIM — nothing normalised, trimmed, lowercased, allow-listed, shape-checked, recomputed,
// re-sorted, de-duplicated or summed. The per-row prohibitions are restated on the fields below rather
// than delegated to `@shared/wire/types`, because THIS is the type #1421 and #1254 import.
//
// THIS SLICE HAS NO DOM SINK, so the inert-text rendering discipline is INHERITED here rather than
// discharged; #1421 and #1254 discharge it. NOTHING ON THIS PATH IS EVER LOGGED and there is
// deliberately no diagnostic seam anywhere in this module — not even a content-free count of what a
// clear dropped. The grounds ESCALATE across the frame: the integers disclose how much private work is
// in the window, a `server_name` is WORKSPACE CONFIGURATION disclosing what the operator wired up, and
// a `path` is the strongest on the frame because it discloses WHO THE USER IS AND WHERE THEY WORK — and
// it is an INTEGRITY rule as well as a privacy one, since a POSIX path may legitimately contain the
// newline that would forge a record in the line-delimited diagnostic stream.
//
// NO ZUSTAND MIDDLEWARE, and that is a security property rather than a style: `persist` would land
// every held `path` and `server_name` in renderer web storage, where they would outlive the pairing
// that scoped them and SURVIVE `clearAllReportedContext` with every in-memory assertion still green,
// and `devtools` would publish the whole state to any Redux DevTools session — a process outside this
// app's trust boundary. `systemPromptStore` and `systemPromptWriteStore` state the same rule.
// `createReportedContextStore` takes no storage port, unlike `createConversationLastReadStore`, so
// there is nothing else to reach.
//
// `conversationId` is a daemon-asserted routing key and a `Map` key here. `ReadonlyMap` is MANDATED and
// `Record<string, …>` FORBIDDEN, on `conversationActivityStore`'s rule: `Map.prototype.get('__proto__')`
// performs no prototype-chain lookup, and `set` / `delete` create and remove ordinary own entries, so
// `__proto__`, `constructor` and `''` are three unremarkable keys BY CONSTRUCTION rather than by
// validation. A swap to `Record` would break no other assertion — only this store's hostile-key reads
// fail, and the PRE-WRITE ones are the half that matters, since a `Record` hands a reader
// `Object.prototype` where `?? null` should have fired. The key STOPS at the map: it is never copied
// into a held record, never rendered, never a filename, a cache key, a lookup path, an attribute or a
// URL, and it reaches no log sink. Matching it wants plain `Map.get` and specifically NOT
// `crypto.timingSafeEqual` — nothing here is unguessable and nothing is a secret.
//
// THIS MODULE BUILDS NO INDEX OVER ANY INVENTORY AT ALL. The rows are held as arrays and read in
// order, which is a stronger compliance with the arm's `Map`-not-object rule than any index could be.
// A consumer that later wants one — a legend keyed by category name, a panel grouped by `server_name`,
// a list keyed by `path` — inherits the obligation whole: the index is a `Map`, never a plain object,
// and the same goes for a React `key`.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type {
  ContextUsageCategory,
  ContextUsageMCPTool,
  ContextUsageMemoryFile
} from '@shared/wire/types'

/** One conversation's held reading — the `contextUsage` daemon-event arm minus its `type` tag and its
 *  routing key, all ten fields verbatim.
 *
 *  `model` is CLAUDE-AUTHORED OPEN TEXT and NOT AN IDENTITY: `modelAnnounced` remains the authority on
 *  which model is running, and this is descriptive text beside a token count, never a key to match a
 *  model menu against. It is held verbatim and is never a lookup path, a cache key or an attribute.
 *
 *  THE SIX INTEGERS ARE FIGURES, NEVER SIZES. `totalTokens`, `maxTokens` and `percentage` are claude's
 *  own numbers, range-checked in NEITHER direction upstream nor here — a `percentage` over 100, a total
 *  exceeding the max and a negative are all representable and none is rejected, because rejecting one
 *  would be a validation rule with no captured case behind it. `percentage` is NOT derivable from the
 *  two totals and the categories NEED NOT SUM to either, so no consumer may read a gap as an error.
 *  Each `dropped*` count counts rows that are NOT present, which makes the obvious "…and N more"
 *  rendering an array sized by an unbounded daemon number: NEVER allocate, iterate or size anything
 *  from any of the six, here or downstream. The three are independent of each other.
 *
 *  THE THREE INVENTORIES ARE A PREFIX IN THE PRODUCER'S DESCENDING-TOKEN ORDER, which is the only
 *  ordering signal a consumer gets — re-sorting or de-duplicating destroys it. They are held BY
 *  REFERENCE, exactly as the decoder produced them: nothing on the write path slices, sorts, filters or
 *  copies one, and `readonly` at every hop is what keeps them unmutated.
 *
 *  THE PER-ROW PROHIBITIONS, restated here rather than delegated to `@shared/wire/types`, because this
 *  is the type #1421 and #1254 import and a reader standing here must not have to navigate to find
 *  them. All four are untrusted, model- or workspace-authored strings:
 *    - `categories[].name` is a category LABEL, never a handle to call anything by.
 *    - `mcpTools[].name` is a tool LABEL, the same rule one inventory over.
 *    - `mcpTools[].server_name` IS INERT DESPITE ITS NAME. It spells the same field as the daemon's
 *      `MCPReconnectPayload.ServerName`, which crosses an ACTUATION seam verbatim — and having the same
 *      spelling as a field that actuates is not having its meaning. It must NEVER be fed to an MCP verb
 *      (a reconnect, a tool invocation, a server lookup) or joined against `mcp_status` on the strength
 *      of having appeared here.
 *    - `memoryFiles[].path` IS NOT A FILE HANDLE. It is path-shaped descriptive text that nothing
 *      joins, cleans, resolves or opens — reporting what claude READ rather than granting access to
 *      anything — so it is never an `href`, a `shell.openExternal` target, a `path.join` argument, a
 *      filename or a cache key. A path-shaped string is not a path-constrained one: the daemon
 *      constrains neither scheme nor shape, so a `javascript:` URI, a `file://` URL and a UNC path all
 *      arrive as an ordinary `path`.
 *    - `memoryFiles[].type` is a LABEL, NEVER A DISCRIMINANT. A field spelled `type` in this repo
 *      invites `switch (row.type)`, which is exactly wrong: it is an OPEN set a claude release widens
 *      by definition, and it carries no authority, no trust level and no scope.
 *
 *  THE WHOLE RECORD IS A REPORT, NEVER A CONTROL INPUT: no security-relevant behaviour may branch on
 *  any field, here or in any consumer. */
export interface ReportedContextReading {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  categories: readonly ContextUsageCategory[]
  droppedCategories: number
  mcpTools: readonly ContextUsageMCPTool[]
  droppedMcpTools: number
  memoryFiles: readonly ContextUsageMemoryFile[]
  droppedMemoryFiles: number
}

/** The write unit — one conversation's reading plus the routing key that files it.
 *
 *  It EXTENDS the reading rather than restating its ten fields, for `UsageLimitSnapshot`'s reason: the
 *  reading is held verbatim, so the write unit is exactly the record plus the key, and `extends` is
 *  what makes a field added later land on both BY CONSTRUCTION instead of on whichever one someone
 *  remembered. At ten fields that is worth more than it was at three.
 *
 *  `conversationId` stays OFF `ReportedContextReading` deliberately, and that split is load-bearing
 *  twice over. The record is what the selector hands a reader that already knows which conversation it
 *  asked about, so carrying the key in the value would be a second copy to keep in agreement with the
 *  map key — and it would put a daemon-asserted string inside the very object #1421's and #1254's DOM
 *  sinks render from. */
export interface ReportedContextSnapshot extends ReportedContextReading {
  conversationId: string
}

/** The whole state: each conversation's latest reading, keyed by `conversationId`. A key ABSENT from
 *  the map is the distinct "no frame has arrived for that conversation" state — the daemon fans the
 *  frame out after a TURN END, so a freshly launched app has none and a conversation nobody has run
 *  never gets one. That absence is what lets #1421 fall back to the settings-derived figure, so it must
 *  be readable explicitly rather than inferred from a zero.
 *
 *  A present reading whose three inventories are EMPTY and whose three dropped counts are `0` is a REAL
 *  (if degenerate) reading the daemon emitted, held verbatim and NOT collapsed to an absent key — the
 *  `sessionIdStore` `null`-vs-`''` contract, and see `selectReportedContextFor`, which preserves the
 *  distinction rather than collapsing it.
 *
 *  `ReadonlyMap` signals the setters REPLACE the map, never mutate it in place — and see the header for
 *  why `Record<string, …>` is forbidden outright. */
export interface ReportedContextState {
  readings: ReadonlyMap<string, ReportedContextReading>
}

/** Store shape = state + the two mutation entry points. The mutations live here and NOT on
 *  `ReportedContextState`, so the selector — typed against the state-only interface — cannot see them
 *  and `initialReportedContextState` stays assignable.
 *
 *  `clearAllReportedContext` is NULLARY BY DESIGN, the `clearAllUsageLimits` property: a pairing ending
 *  invalidates EVERY conversation's reading at once, so "takes no conversation id at all" is a property
 *  of this signature that `tsc` enforces rather than a test, and no daemon-supplied id can steer which
 *  machine's paths and server names survive the boundary. It carries `All` so the blast radius is
 *  legible at the CALL SITE — among the keys of `ClearPairingScopedStateDeps`, its only entry point.
 *
 *  There is deliberately NO per-conversation clear beside it; see the header for why this arm has no
 *  benign value to exit on. */
export type ReportedContextStore = ReportedContextState & {
  setReportedContext: (snapshot: ReportedContextSnapshot) => void
  clearAllReportedContext: () => void
}

export const initialReportedContextState: ReportedContextState = { readings: new Map() }

/**
 * DI-friendly, React-free store — one isolated instance per test. Two named setters rather than a
 * reducer: each is a whole-key or whole-map write, neither is an arm of a state machine, and there is
 * no reject branch anywhere, so a discriminated-union action set would be ceremony without benefit.
 * Unidirectional is preserved — read-only selector, store-owned write paths, and every mutation is
 * invoked only by wiring (the subscription for one, the pairing-ended helper for the other), never
 * two-way-bound from a component.
 *
 * Nothing is validated, coerced, deduped or shape-checked on the way in. A malformed frame was already
 * rejected upstream by the fail-closed narrowers of #1454 / #1455 / #1459 / #1460 inside
 * `daemonConnection`'s decode guard, so no event is emitted at all and nothing malformed reaches here;
 * a second, weaker check in the renderer would only invent a disagreement. There is no reject branch,
 * nothing throws, and NOTHING IS LOGGED (see the header).
 *
 * GROWTH, stated rather than defended: one entry per distinct `conversationId` seen since launch, each
 * holding one ten-field record. The PER-FRAME half is bounded — `MAX_PLAINTEXT_BYTES` caps the
 * decrypted envelope in `parseInboundMessage` before any parse, ahead of every narrower — so a flooding
 * hostile relay costs one bounded entry per distinct id rather than an unbounded append per frame, and
 * `clearAllReportedContext` returns that to zero at every pairing change. `modelListStore`,
 * `slashCommandListStore`, `conversationActivityStore`, `queueStore` and `usageLimitStore` all ship the
 * identical posture. Honestly, an entry here is FATTER than any of theirs — ten fields including three
 * daemon-sized row arrays, against three scalars — so if a bound is ever warranted in this family it is
 * warranted here first. It is not built now: no such failure has been observed, and a second lifetime
 * would be one more thing to keep in agreement with the clear.
 *
 * Nothing here is persisted, and nothing may be — see the header's middleware prohibition, which is
 * what stops a held `path` from outliving the clear in web storage.
 */
export function createReportedContextStore(init: ReportedContextState = initialReportedContextState) {
  return createStore<ReportedContextStore>((set) => ({
    ...init,
    // Replaces ONE conversation's reading wholesale and touches no other key: no merge, no coercion, no
    // validation, and NO DEDUP OF A VERBATIM REPEAT. The repeat is not noise — the daemon fans this out
    // after EVERY turn end whatever the window is doing, and the transport holds no coalescing, timer
    // or per-conversation memo, so a consumer sees exactly one event per frame and a repeat is the
    // signal that the reading is still current; suppressing it would discard information. A FALL is
    // ordinary traffic for the same reason: a window shrinks at a `/clear` or a compaction, so a lower
    // reading than the one held is never treated as stale. One consequence, stated rather than
    // discovered: each write produces a fresh record identity, so a verbatim repeat does re-notify a
    // subscriber watching THAT conversation (#1421 memoises if it ever matters).
    //
    // Copy-on-write (the `usageLimitStore` idiom): clone the outer map, set the one key, return a fresh
    // state. Never mutate `s.readings` or a record in place — a write for one conversation leaves every
    // other record object identical, so a component watching a different id sees `Object.is` true and
    // does not re-render. The map is read INSIDE the `set` updater rather than through `getState()`
    // outside it, so two frames arriving back-to-back cannot interleave: zustand runs the updater
    // synchronously against current state, which closes the only check-then-act shape on this path.
    //
    // UNCONDITIONAL, and that is the point: this setter NEVER branches on held or arriving content.
    // Unlike `setUsageLimit` it has no sibling routing decision one layer up either — there is no
    // benign value on this arm, so the whole path is comparison-free and there is nothing for a hostile
    // string to steer.
    setReportedContext: (snapshot) =>
      set((s) => {
        const next = new Map(s.readings)
        // A fresh named-field record, so the routing key STOPS at the map key and never reaches what
        // #1421 and #1254 hold and render. No computed object key anywhere on this path, and no
        // property is copied out of a daemon-supplied row.
        //
        // The three inventories cross BY REFERENCE, as the decoder produced them. A defensive
        // `.slice()` would buy nothing — nothing retains the event once the listener returns, and
        // `readonly` is what stops a mutation at every hop — while adding an allocation sized by
        // daemon-supplied content on the write path.
        next.set(snapshot.conversationId, {
          model: snapshot.model,
          totalTokens: snapshot.totalTokens,
          maxTokens: snapshot.maxTokens,
          percentage: snapshot.percentage,
          categories: snapshot.categories,
          droppedCategories: snapshot.droppedCategories,
          mcpTools: snapshot.mcpTools,
          droppedMcpTools: snapshot.droppedMcpTools,
          memoryFiles: snapshot.memoryFiles,
          droppedMemoryFiles: snapshot.droppedMemoryFiles
        })
        return { readings: next }
      }),
    // THE ONLY EXIT — the pairing boundary, reached only through `clearPairingScopedState`'s injected
    // dep set and never from a call site or a bridge arm. Keeping it out of `reportedContextBridge` is
    // what makes it daemon-UNREACHABLE, so no arriving event can invoke it. Two halves, each doing
    // something the other cannot, both inherited verb for verb from `clearAllUsageLimits`:
    //
    //   - It returns `initialReportedContextState` BY REFERENCE rather than `{ readings: new Map() }`,
    //     so every cleared state holds the SAME `readings` object. That return makes the copy-on-write
    //     above LOAD-BEARING rather than stylistic: this constant is module-shared, so a writer that
    //     ever mutated `s.readings` in place would poison it and every instance that had cleared would
    //     then hand ONE PAIRING'S readings to the next, with no type error. Pinned by a test.
    //   - The `size === 0` guard is the `clearAllUsageLimits` guard and NOT the `clearAllLastRead` one:
    //     nothing here reaches disk, so there is no side effect to suppress. It buys the stronger half
    //     of idempotence — returning the state OBJECT makes zustand's `Object.is(next, state)`
    //     short-circuit fire, so a redundant clear wakes NO listener at all.
    //
    // Unconditional beyond that guard, and total: no id, no filter, and NO BRANCH ON HELD CONTENT that
    // could let one conversation's reading outlive the pairing that reported it. A clear gated on a
    // model name or a row count would let a hostile daemon craft a value that survives a pairing switch
    // and is then attributed to the next machine. Being unguarded is also what makes clearing an
    // already-clear store a no-op by construction. NOTHING IS LOGGED, not even a content-free count of
    // what was dropped (see the header).
    clearAllReportedContext: () =>
      set((s) => (s.readings.size === 0 ? s : initialReportedContextState))
  }))
}

/** App-wide singleton — the one source of truth the data path writes and #1421 / #1254 read. */
export const reportedContextStore = createReportedContextStore()

/** Narrow-slice React binding for #1421 and #1254. Selecting one conversation's reading avoids
 *  cross-facet re-renders.
 *
 *  Exported SEPARATELY from `createReportedContextStore` and `selectReportedContextFor` on purpose, for
 *  `useUsageLimitStore`'s reason: seeding a zustand singleton is INVISIBLE to `renderToStaticMarkup`,
 *  because the server renderer reads `getServerSnapshot()`, which zustand wires to the state captured
 *  at store creation — so a seed-then-render test passes against the initial cell no matter what was
 *  seeded. A renderer spec below this slice therefore has to `vi.mock` this module and override ONLY
 *  this binding onto a per-file `createReportedContextStore()` instance, keeping `...importActual` for
 *  the selector, which is possible only because the three are separate exports. */
export function useReportedContextStore<T>(selector: (s: ReportedContextStore) => T): T {
  return useStore(reportedContextStore, selector)
}

/**
 * The ONLY read surface — a selector FACTORY bound to one `conversationId`.
 *
 * IT TAKES NO SECOND ARGUMENT, and the contrast with `selectUsageLimitFor` is the design rather than an
 * omission. That selector takes `nowSeconds` because a usage-limit reading EXPIRES at an instant claude
 * supplied; a context reading does not expire at all. There is no time input here, no read-time rule
 * beyond presence, and nothing in this module schedules, allocates or iterates from any figure.
 *
 * The rule, in full:
 *
 *   key absent   → `null`      no frame has arrived for this conversation
 *   key present  → the record  claude's latest reading for it, held verbatim
 *
 * `?? null` keeps absence and a degenerate present record apart, and emphatically does not collapse
 * them: a present reading whose three inventories are empty and whose three dropped counts are `0` is a
 * real reading the daemon emitted, while an absent key is "nothing has been reported for this chat".
 * The nullable return forces #1421 to branch, which is what lets it fall back to the settings-derived
 * `contextUsagePercent` figure on absence ONLY — never on an empty-but-present reading.
 *
 * Narrow-slice-correct: a write for a DIFFERENT conversation produces a new map, but
 * `newMap.get(openId)` returns the SAME record object → `Object.is` true → no re-render of a component
 * watching `openId`. It returns the HELD RECORD ITSELF, never a freshly built object, and `null` is a
 * stable reference, so no `EMPTY_*` module constant is needed.
 *
 * THERE IS NO WHOLE-MAP READ SURFACE AND NO FALLBACK TO THE ACTIVE CONVERSATION. A reader only ever
 * asks for an id it can select, so a reading carrying an id that matches no such conversation is held
 * under its own key and read by NOTHING — which is a stronger no-match than a filter on the write path
 * could be. Do not add a `selectAll*`: it would surface exactly those stray keys, and their content is
 * the most disclosive this renderer holds.
 *
 * The exposed mutations are exactly `setReportedContext` and `clearAllReportedContext`; both are
 * store-owned and invoked only by wiring — the subscription for the first, `clearPairingScopedState`
 * (its sole caller) for the second — never two-way-bound from a component.
 */
export const selectReportedContextFor =
  (conversationId: string) =>
  (s: ReportedContextState): ReportedContextReading | null =>
    s.readings.get(conversationId) ?? null
