# #573 — Hold the background-task roster the daemon reports, per conversation

## Design source

N/A — data-layer slice. Nothing renders in this ticket (`No panel, no rendering` is an explicit non-goal;
#568 owns the UI). The visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` → *"CodeGraph not initialized"*), so this
list was built by reading the cited precedents directly. Read these before writing anything.

| File / range | What to extract |
| --- | --- |
| `src/renderer/src/store/queueStore.ts` (whole, 112 lines) | **The template for the store.** Copy the DI-factory → singleton → hook → selector structure, the `ReadonlyMap` copy-on-write setter, and the same-reference reset. **Do NOT copy `selectBacklogFor`'s `?? EMPTY_BACKLOG` (`:102-105`) or the `EMPTY_BACKLOG` constant (`:91-93`)** — see § The one thing that must not be cloned. |
| `src/renderer/src/store/queueBridge.ts` (whole, 89 lines) | **The template for the bridge.** The three idioms this spec reuses: the fresh named-field literal in the translator (`:27-28`), `default: null` and *why it is not an `assertNever`* (`:20-23`), and the `connected`-branch-before-translator posture with its stated rationale (`:55-59`). Also the `QueueData` headless-leaf shape (`:75-89`). |
| `src/shared/ipc/events.ts:243-285` | The `backgroundTaskRoster` arm this slice consumes, and the contract prose behind every AC (snapshot-not-delta, empty-`[]`-is-a-signal, `tasks.length + droppedTasks` is the true size, per-row `truncated_fields`). |
| `src/shared/wire/types.ts:495-533` | `BackgroundTask` — the row held verbatim. Four **snake_case** fields, no `tool_call_id`, no `patch`. `truncated_fields: null` is a valid value, distinct from `[]`. |
| `src/renderer/src/store/queueStore.test.ts` (whole, 145 lines) | The plain-function store-test idiom (isolated `createX()` per test, reference-identity assertions, DI cases). Your store test is this file's shape with the AC4 cases added and the `EMPTY_*` cases removed. |
| `src/renderer/src/store/queueBridge.test.ts` (whole, 263 lines) | The bridge-test idiom: `fakeBridge()` listener capture (`:72-90`), translator table of unrelated events (`:41-67`), real-store seam tests (`:168-196`), server-render container test (`:251-263`). **Skip the `reconnect reconcile` block (`:202-248`)** — that ordering matrix does not exist for this frame (see § Non-goals inherited). |
| `src/renderer/src/App.tsx:1-13, 90-126` | Import block and the six mounted headless leaves. Your leaf is the **seventh**. |
| `src/renderer/src/App.test.tsx:69-80` | The invariant your leaf must not break: `renderToStaticMarkup(<App/>)` with **no `window` stub** must not throw and must produce `''`. |
| `src/renderer/src/clearPairingScopedState.ts:19-27` | The membership rule that explains why this store is *deliberately not* added there. Read it so you don't "helpfully" add it. |
| `src/renderer/src/store/modalBridge.ts:61-65` | The rejected alternative for the `connected` edge (folded into the translator as a `reconnected` action). Read it to understand why this spec picks the other posture. |
| `docs/knowledge/codebase/566.md` § "Open questions carried forward" (`:117`) | The transport-side handoff restating these constraints. |

## Context

#564/#565/#566 landed the three `background_task_*` daemon-event arms, all **dormant** — the three
exhaustive renderer bridges deliberately no-op them. This ticket is the family's first consumer and takes
**the roster arm only**: the aggregate frame reporting the whole live set.

Roster-first bounds the held set from commit one. There is no terminal event in this family by design, so
absence from a *later* roster is the only removal path; a slice that held the scalar arms first would ship
a collection that only ever grows under ids claude chooses. Replacement truth caps the held set at one
roster's worth per conversation, and the daemon caps a roster at 8 rows, reporting the overflow in
`droppedTasks` rather than hiding it.

Ships **populated and unread**: nothing renders it (#568), and the scalar arms stay dormant (#574).

## Design

Two new files in `src/renderer/src/store/` (flat — this repo has no `stores/` or `bridges/` split), plus a
two-line mount in `App.tsx`. Structure is the `queueStore` + `queueBridge` pair, which is the exact
in-family precedent for "daemon-state snapshot, keyed by conversation, store + data path, render deferred".

```
daemonConnection (main)  ──IPC──▶  window.pyry.onDaemonEvent
                                        │
                        backgroundTaskRosterBridge.ts
                          ├─ 'connected'            → resetRosters()
                          ├─ 'backgroundTaskRoster' → setRoster(snapshot)
                          └─ everything else        → no-op
                                        │
                        backgroundTaskRosterStore.ts   (ReadonlyMap<conversationId, Entry>)
                                        │
                          selectRosterFor(id) → Entry | null      ← #568 reads this
```

### `backgroundTaskRosterStore.ts` — contract

```ts
/** The held value for one conversation. `tasks` holds the wire rows VERBATIM by reference. */
export interface BackgroundTaskRosterEntry {
  tasks: readonly BackgroundTask[]
  droppedTasks: number
}

/** The write unit: the held value plus the key it lands under. The bridge's translator returns this. */
export interface BackgroundTaskRosterSnapshot extends BackgroundTaskRosterEntry {
  conversationId: string
}

export interface BackgroundTaskRosterState {
  rosters: ReadonlyMap<string, BackgroundTaskRosterEntry>
}

export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  resetRosters: () => void
}
```

Also exported, mirroring `queueStore.ts` name-for-name: `initialBackgroundTaskRosterState`,
`createBackgroundTaskRosterStore(init?)`, the `backgroundTaskRosterStore` singleton,
`useBackgroundTaskRosterStore(selector)`, and `selectRosterFor(conversationId)`.

Behaviour, one line each:

- **`setRoster(snapshot)`** — copy-on-write: clone the map, set `snapshot.conversationId` to a **fresh
  named-field literal** `{ tasks, droppedTasks }`, replace the map. Replacement truth per key: no merge,
  no append, no dedupe. Unconditional — an empty `tasks: []` writes an entry, it does **not** delete the
  key (that difference is AC4 and is the whole point of this store).
- **`resetRosters()`** — replace with an empty map; return the **same state reference** when the map is
  already empty, so zustand's `Object.is` short-circuit fires and a first `connected` on an empty store
  causes no listener churn.
- **`selectRosterFor(id)`** — `s.rosters.get(id) ?? null`.

`tasks` is held **by reference, verbatim, snake_case** — no copy, no coercion, no per-row remap, no
validation (#566 owns the fail-closed decode). This is the `queueStore.ts:11-13` posture and it keeps the
slice drift-free against the mobile contract. It also means **AC2's "`truncated_fields: null` is never
collapsed into `[]`" is satisfied by construction**: there is no per-row mapping in which a collapse could
occur. The regression risk is a future remap, so the test pins the null-survives-the-whole-path invariant
rather than a branch.

### The one thing that must not be cloned

`queueStore.selectBacklogFor` returns `s.backlogs.get(id) ?? EMPTY_BACKLOG` and its state docstring says
outright that a key absent from the map "reads as empty via the selector" (`queueStore.ts:35-37`,
`:102-105`). For `queue_state` that collapse is correct. **Here it silently violates AC4** — "never
observed" and "observed, nothing alive" would both surface as a bare empty list, with **no type error and
no failing test** unless one is written for it. Cloning the precedent faithfully is how this ticket gets
broken.

The fix is one token: return `?? null` instead of `?? EMPTY_BACKLOG`, and type the selector
`BackgroundTaskRosterEntry | null`.

| store contents for `c1` | `selectRosterFor('c1')` | meaning |
| --- | --- | --- |
| key absent | `null` | no roster has ever arrived for this conversation |
| `{ tasks: [], droppedTasks: 0 }` | that entry | **observed, nothing alive** — the payoff signal |
| `{ tasks: [t], droppedTasks: 2 }` | that entry | 1 row carried, 3 truly alive |

Three consequences worth stating, because they are why this shape was chosen over a
`{ observed: boolean }` wrapper or a second `selectHasRosterFor` selector:

1. **`null` is a stable reference by construction.** The precedent hoists `EMPTY_BACKLOG` to module scope
   specifically so the absent case does not churn re-renders with a fresh `[]` per selector call
   (`queueStore.ts:91-93`). A primitive `null` gets that for free, so this slice needs **no `EMPTY_*`
   constant at all** — one fewer export and one fewer thing to get wrong.
2. **The nullable return type forces #568 to branch.** The distinction cannot be ignored accidentally; the
   compiler makes the reader handle it.
3. **AC4 and AC5 compose only because of this choice.** After `resetRosters()` every key is absent, so
   every conversation reads `null` — genuinely back to "no roster observed", which is exactly AC5's
   wording. Under the precedent's collapsing selector, post-reset and observed-empty would be
   indistinguishable and AC5 would be unverifiable.

`selectBacklogs`' whole-map analogue is **deliberately not ported**. The precedent exports it for #197,
which iterates every held backlog; this reset clears the map wholesale and nothing else reads the map.
Shipping an unread read surface is the failure mode this pipeline calls out — leave it out; #574 can add
it if it turns out to need one.

### `backgroundTaskRosterBridge.ts` — contract

```ts
export function translateBackgroundTaskRoster(
  event: DaemonEvent
): BackgroundTaskRosterSnapshot | null

export function subscribeBackgroundTaskRoster(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void,
  resetRosters: () => void
): () => void

export function BackgroundTaskRosterData(): null
```

- **`translateBackgroundTaskRoster`** — `case 'backgroundTaskRoster'` returns a **fresh named-field
  literal** `{ conversationId, tasks, droppedTasks }`; never `return event`, never a spread. That matters
  concretely here: **#574 widens this entry**, so a spread would silently start carrying fields this slice
  never agreed to hold. `tasks` passes through by reference. `default: null`.
- **`default: null` is not an `assertNever`.** This is an independent subscriber in the `queueBridge` /
  `sessionIdBridge` posture, not one of the three typecheck-gating exhaustive bridges — which already
  no-op this arm from #566. Ignoring every other arm is this path's intended, permanent behaviour.
- **`subscribeBackgroundTaskRoster`** — `if (event.type === 'connected') { resetRosters(); return }`, then
  `const snapshot = translate(event); if (snapshot !== null) setRoster(snapshot)`.

**The `connected` posture is a deliberate choice between two shipped ones.** `queueBridge.ts:55-59`
branches *before* the translator; `modalBridge.ts:61-65` folds it *into* the translator as a `reconnected`
action. This spec takes the `queueBridge` posture, and the reason is structural rather than a coin flip:
`modalBridge`'s translator returns members of an **action union**, so `{ type: 'reconnected' }` is a
natural additional member. This translator returns a **value** (a snapshot). Folding the reset in would
force the return type to something like `Snapshot | 'reset' | null` — strictly worse, and it would destroy
the property that the translator is a pure `backgroundTaskRoster` → snapshot filter.

**The `!== null` guard, stated precisely.** The precedent's docstring frames this as "not a truthiness
check", which is easy to mis-copy: a snapshot object is truthy even when `tasks` is empty. The real hazard
this guard institutionalises is **filtering at the translator** — an `if (event.tasks.length === 0) return
null` would drop the empty roster, which is the frame's payoff signal and a direct AC4 violation. Keep the
guard `!== null` and keep the translator unconditional; the bridge test pins both.

**`BackgroundTaskRosterData`** — headless leaf, one `useEffect` with `[]` deps returning the subscription's
off-handle as cleanup (so a StrictMode double-mount nets exactly one live listener), renders `null`.
`window.pyry` is dereferenced **only inside the effect**, never at module or render scope — `App.test.tsx:69-79`
server-renders `<App/>` with no `window` stub and asserts it neither throws nor emits markup, and that test
passes only because every leaf holds this invariant.

### `App.tsx` wiring

Import `BackgroundTaskRosterData` alongside the other nine store imports (`:1-13`) and mount it after
`<RelayLinkData />` (`:118`). It is the **seventh** headless leaf. Note the inline numbered comments stop
at "fifth" (`ScreenSnapshotData`, `:106`) because `RelayLinkData` landed without one — **count the JSX, not
the comments**, and do not renumber or backfill comments on existing leaves (adjacent-code refactoring).
Mount order is functionally irrelevant (all leaves are headless, independent subscribers); appending keeps
the diff to two lines.

### Explicitly not done

- **Do not add this store to `clearPairingScopedState.ts`.** Its docstring states the membership rule: a
  store that re-asserts itself on a new pairing "does not belong here at all", and it names `queueStore`
  and `modalStore` as already excluded *because* the `connected` edge clears them (`:22-26`). A new pairing
  always re-handshakes and the relay re-emits `connected` on every (re)handshake, so the `connected` edge
  subsumes the pairing-scoped clear.
- **Do not retain state across a reconnect.** Rosters are not in the daemon's reconcile-on-connect set
  (that set is outstanding `modal_shown` per pyrycode#877 and `queue_state` per non-empty backlog per
  pyrycode#878), and this app advertises no `last_event_id`, so no replay arrives. The set therefore reads
  `null` after a reconnect until claude next emits a roster. **That is the correct, honest behaviour** —
  retaining the pre-disconnect set would present a stale list as live. #569 owns closing that gap and needs
  a daemon-side change.
- **Do not model a terminal state.** No `completed` / `failed` / `finished` field, no derived "was here
  last roster, gone now" bookkeeping. The daemon reports no finish; absence from a later roster is the only
  removal path, and any "finished" conclusion is #568's to draw and own.
- **Do not blank-fill `toolCallId` / `patch`.** A roster row carries exactly four facts. #574 adds those two
  as optional and turns replacement into a carry-over rebuild for surviving rows — expect it, do not
  pre-build it.

## State + concurrency model

Single store, single write path, unidirectional. `setRoster` and `resetRosters` are invoked only from the
bridge's listener; no component two-way-binds into the store. Reads are through `selectRosterFor` only.

One app-lifetime listener on the single daemon-event channel, dispatched synchronously per event in
arrival order — so `connected` lands before anything that follows it with no renderer-side ordering logic.
No timers, no async work, no `AbortController`: every operation here is a synchronous map write. Teardown
is the effect cleanup returning `onDaemonEvent`'s off handle.

Re-render correctness: `setRoster` for `c2` clones the map but leaves `c1`'s entry object identical, so
`Object.is` holds for a component watching `c1` and it does not re-render. Entry objects are frozen-by-
convention (never mutated in place); every write replaces.

## Error handling

No new failure modes. #566 owns the fail-closed decode (a malformed frame never reaches the renderer as an
event), and this path performs no parsing, no I/O, and no validation. The listener only translates and
dispatches — it never throws into React. There is no user-visible error surface in this slice; a roster
that never arrives is indistinguishable from one that never existed, which is precisely what `null` means.

## Testing strategy

Vitest, plain functions and injected spies — no DOM, no Electron. Two new test files mirroring
`queueStore.test.ts` and `queueBridge.test.ts`. Fixtures: two `BackgroundTask` rows, one with
`truncated_fields: null` and one with a non-empty array, so the per-row distinction rides every test.

**`backgroundTaskRosterStore.test.ts`**

- A fresh store holds nothing; `selectRosterFor('c1')` returns `null` — never observed. *(AC4)*
- `setRoster` records the entry; `tasks` comes back **by reference**, rows unchanged and still snake_case. *(AC1, AC2)*
- A later roster replaces the held entry wholesale — a task present in the first and absent from the second is gone, with no merge. *(AC1)*
- A roster for `c2` leaves `c1`'s entry untouched and **reference-identical**. *(AC1, re-render correctness)*
- An empty roster writes an entry: the selector returns non-`null` with `tasks: []`. Assert **both** that it is not `null` and that `tasks` is empty — this is the pair the whole ticket turns on. *(AC4)*
- `droppedTasks` is held alongside: a `0` case and a non-zero cap case, both readable off the same entry. *(AC3)*
- A row's `truncated_fields: null` survives as `null`, and a row's `[]` survives as `[]` — assert on the retrieved rows, not the input. *(AC2)*
- `resetRosters` clears every conversation, and each then reads `null` again — back to never-observed, not observed-empty. *(AC5, AC4)*
- `resetRosters` on an empty store returns the **same state reference** (no listener churn on a first connect).
- Reset then a new roster repopulates one conversation; replacement truth unchanged. *(AC5)*
- DI: two `createBackgroundTaskRosterStore()` instances are independent; an injected initial state seeds correctly; `initialBackgroundTaskRosterState` is an empty map.
- Setter references stay stable across updates.

**`backgroundTaskRosterBridge.test.ts`**

- The translator maps the owned arm to a fresh `{ conversationId, tasks, droppedTasks }`; `tasks` is the same reference; the result is not the event object itself.
- The translator maps a roster with `tasks: []` to a **snapshot, not `null`** — the filter hazard, pinned. *(AC4)*
- The translator returns `null` for a sample of unrelated events, **including `connected`** (which stays a listener branch, not a translator mapping).
- `subscribeBackgroundTaskRoster` subscribes exactly once and returns the off handle as its cleanup.
- A roster event calls `setRoster` once with the snapshot and never `resetRosters`.
- A `connected` event calls `resetRosters` once and never `setRoster`.
- An unrelated event calls neither.
- **Seam, real store:** empty → held on one roster emit; a second roster for a different conversation does not clobber the first.
- **Seam, real store:** a `connected` after two conversations hold rosters returns both to `null`. *(AC5 end-to-end)*
- **Seam, real store — the highest-value test in this ticket:** drive one conversation to observed-empty (`tasks: []`) and another to never-observed, and assert they read differently (`{tasks: []}` vs `null`); then emit `connected` and assert the first has become `null` too. This is the single test that would fail if the `?? EMPTY_*` collapse were cloned. *(AC4, AC5)*
- `BackgroundTaskRosterData` server-renders to `''` without a `window` stub and does not throw.

**Not tested, deliberately:** the reset-then-repopulate **ordering matrix** from `queueBridge.test.ts:202-248`.
That block exists because the daemon re-sends `queue_state` on connect; rosters are not in the
reconcile-on-connect set, so there is nothing to order against and the cases would assert fiction.

Type-level coverage rides `npm run typecheck`; the gate is `npm run build` plus `npm test`.

## Size

3 production files (2 new, 1 modified two lines), 0 consumer fan-out, 0 reject branches, 5 ACs, 5 new
exported types/components. Projection ≈ 130 store + 92 bridge + 6 wiring + ~310 tests ≈ **540 lines**.

The ruler is the combined `queue_state` data path measured from what shipped — #293 (`9b48803`, store +
bridge, 443) **plus** #197 (`fe7871d`, the `connected` reset, 192) = **635**, because this slice carries
both at once (AC5 is not severable, see below). It lands below that ceiling for two structural reasons,
both falsifiable: the bulk of #197's test delta was the reconnect **ordering** matrix, which does not exist
for this frame; and this spec drops `selectBacklogs`' analogue and the `EMPTY_*` constant, which the
`?? null` selector makes unnecessary.

Both candidate splits were considered and rejected:

- **Store without its bridge** — yields a store nothing writes to, for ~25 executable lines of wiring.
  Ceremony, not a seam, and it raises total cost (two tickets, a dead-code child).
- **Reset as a follow-up** (the real #293 → #197 seam) — rejected on security, not size. It saves ~42
  production lines in files the developer already has open, adds no files and no fan-out, and moves the
  binding constraint (developer turns) barely at all — while shipping a store that holds a previous
  pairing's literal command lines and keeps them across a re-pairing. That is a deliberate defect for a
  rounding error in cost. The reset lands with the store.

## Open questions

- **Entry naming** (`BackgroundTaskRosterEntry`) sits next to the wire type `BackgroundTaskRosterPayload`.
  Different layers and different modules, but if the developer finds the pair genuinely confusing at the
  import site, renaming the held type is free — it has no consumers outside these two files. The one name
  that must not change is `selectRosterFor`'s **nullable return type**.
- **#574 will widen `BackgroundTaskRosterEntry`** with optional `toolCallId` / `patch` carried over for
  rows surviving a replacement. Nothing here should be built to accommodate that; it is noted so the fresh
  named-field literal in the translator is understood as load-bearing rather than stylistic.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The untrusted → typed crossing already happened upstream in
  `parseBackgroundTaskRosterPayload` (#566, fail-closed); this slice consumes an already-typed
  `DaemonEvent` arm and performs no parsing, coercion or validation. The renderer-side data stays
  untrusted **content** throughout — `description` is model-influenced text and for `task_type:
  local_bash` is the literal command line claude ran — and this spec keeps it untrusted by holding the
  wire rows verbatim rather than reshaping them into anything that reads as sanitised. Downstream signal
  to #568 is the type itself: `tasks` is `readonly BackgroundTask[]` in snake_case, visibly wire-shaped.
- **[Untrusted-content handling / injection]** **SHOULD FIX, inherited and out of this slice's reach.**
  `description` must be rendered as inert text — never `innerHTML` / `dangerouslySetInnerHTML`, never into
  an attribute or a URL, never executed or re-shelled. This slice ships **no DOM sink at all** (both files
  are React-free logic plus a `null`-rendering leaf), so it cannot violate the constraint; the obligation
  binds #568. Recorded here so it travels with the store rather than being rediscovered. The related trap
  is structural and worth repeating: `tasks` is a **display** list, and its list shape is not an invitation
  to iterate it as a work list something acts on. Nothing in this design iterates it.
- **[Data retention across a pairing — AC5]** This is the finding that shaped the ticket, and it is
  addressed, not deferred. A store holding a previous pairing's command lines and surfacing them after
  re-pairing is a real defect. The `connected` edge clears every conversation's entry, and because the
  relay re-emits `connected` on every (re)handshake and a new pairing always re-handshakes, the clear
  covers both reconnect and re-pair. `clearPairingScopedState` is correctly *not* used (its own docstring
  excludes stores the `connected` edge already clears, `:22-26`) — but note the consequence: **the
  `connected` branch in the bridge is the sole enforcement of AC5.** If a future refactor folds the reset
  into the translator or gates it behind a condition, the security property dies silently. The seam test
  driving a held roster through `connected` to `null` is the guard; it must not be deleted as redundant.
- **[Unbounded growth / resource exhaustion]** Bounded on both axes by construction. Per conversation, a
  roster **replaces** rather than accumulates, and the daemon caps rows at 8 (`maxTaskRosterEntries`),
  reporting overflow in `droppedTasks`. Across conversations, the map grows one entry per
  `conversationId` the daemon fans out — unbounded in principle, but each entry is at most 8 bounded rows
  (512 bytes per `description`), the ids come from the daemon inside the authenticated Noise session (not
  from an unauthenticated attacker), and the `connected` edge empties the map on every handshake. No
  eviction policy is warranted on evidence; this is noted, not fixed.
- **[Process placement / Electron surface]** No findings. Both files are pure renderer state and add no
  IPC channel, no `contextBridge` API, no `ipcMain` handler. They subscribe through the existing
  `window.pyry.onDaemonEvent` and touch no key, socket, token or raw frame. Nothing here moves anything
  toward the renderer that was not already emitted to it by #566.
- **[Logging / telemetry]** No findings — this slice logs nothing, deliberately. A diagnostic here would
  want `conversationId`, `task_id`, or `description` to be useful, and ADR 0007's content-free rule
  forbids all three (`description` most of all). There is no observed failure to instrument; the
  `clearPairingScopedState` precedent (`:64-67`) makes the same call for the same reason.
- **[Concurrency]** No findings. One app-lifetime listener, torn down by the effect cleanup returning the
  off handle; a StrictMode double-mount nets exactly one live listener. No timers, no promises, no
  `await`, so no check-then-act race across a suspension point — every mutation is a synchronous map
  replacement on the renderer's single thread, and no observer can see a half-applied roster.
- **[Threat model — hostile daemon / on-path relay]** A hostile-but-authenticated daemon can push rosters
  naming tasks that never ran, or churn them rapidly. The consequence is bounded to a wrong list in a
  panel that does not exist yet, and the honest-reporting posture (no invented terminal state, no
  retention across reconnect) means the app never claims more than the wire said. A content-blind relay
  can drop or reorder rosters; the resulting stale-or-empty read is exactly the state this design already
  treats as legitimate. Out of scope and named: repopulation after reconnect (#569, needs a daemon change).
- **[Tokens / crypto / file & storage / network I/O]** Not applicable, by design rather than by omission:
  this slice adds no secret, no randomness, no comparison against a secret, no filesystem path, no
  persistence of any kind (the store is in-memory only and never touches `localStorage`, IndexedDB or
  disk), and no socket, URL or timeout. Every one of those lives in the main process and is untouched here.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
