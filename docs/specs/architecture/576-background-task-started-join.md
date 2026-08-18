# Spec #576 — Join the background-task started frame onto the held roster set

Store slice 2 of the background-task-panel vertical. #573 (`ca86ce2`) shipped the roster store and its
bridge; this ticket reshapes both so a `backgroundTaskStarted` event is held per task, keyed by
`conversationId` + `taskId`, carrying the `toolCallId` and the fuller label only that frame reports.

Size **S**, held. Zero new files, 2 production files, 2 new exported types, 5 ACs, zero reject branches,
zero production consumers of the read surface. The two test files migrate rather than append.

## Files to read first

Codegraph is not initialized for this repo (`codegraph init` never run), so this list is grep- and
Read-derived. Read in this order:

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/backgroundTaskRosterStore.ts` (whole file, 157 lines) | The store this slice reshapes. Note `:11-14` (the claim this slice falsifies), `:42-45` (`BackgroundTaskRosterEntry`), `:101-117` (the two setters), `:128-156` (`selectRosterFor` and why it is `?? null`). |
| `src/renderer/src/store/backgroundTaskRosterBridge.ts` (whole file, 118 lines) | The bridge. `:22-52` translator + its `default: null` rationale, `:78-91` the subscriber and its leading `connected` branch, `:104-118` the headless leaf. `:25` and `:37` are two of the four stale claims to correct. |
| `src/renderer/src/store/backgroundTaskRosterStore.test.ts` (206 lines) | The 16 tests that migrate. `:64` pins the entry's keys; `:51` pins verbatim-by-reference (this assertion dies); `:127-142` is the AC3 ancestor. |
| `src/renderer/src/store/backgroundTaskRosterBridge.test.ts` (271 lines) | `:45-109` translator tests (these survive nearly verbatim), `:111-256` subscriber + seam tests, `:57` and `:89` the other two stale claims. |
| `src/shared/ipc/events.ts:199-207` | The `backgroundTaskStarted` arm — the six fields this slice consumes. `:281-285` is the roster arm for contrast. |
| `src/shared/wire/types.ts:495-535` | `BackgroundTask` — the four snake_case roster-row fields, and the daemon's explicit statement that `tool_call_id` is absent **deliberately**. |
| `src/shared/wire/types.test.ts:318-336` | `expect(row).not.toHaveProperty('tool_call_id')` — the shipped test that closes the widen-the-wire-type path. Do not touch. |
| `src/renderer/src/store/queueStore.ts` | The structural precedent (DI factory → singleton → hook → selector, `ReadonlyMap` copy-on-write). Read for posture only — its `?? EMPTY_BACKLOG` collapse is the thing #573 deliberately did **not** clone. |
| `docs/knowledge/codebase/573.md` | The store this modifies. **§ "Open questions carried forward" is one of the four wrong predictions** — read it to know what to disbelieve, not what to build. |
| `src/renderer/src/App.tsx:113-121` | Confirms `BackgroundTaskRosterData` is mounted as the seventh headless leaf. **This file is not touched by this slice** — the component's name and props do not change. |
| `src/main/transport/inboundMessage.ts:288-295` | `requireString` admits `''`. This is why the provenance predicate below must be `!== null`, never truthiness. |

Out-of-repo, read only if you want the design's ground truth (the daemon source is checked out at
`~/Workspace/Projects/pyrycode/`):

- `internal/streamsup/parser.go:155` — `maxTaskRosterEntries = 8`.
- `internal/streamsup/parser.go:160-178` — `maxTaskRosterDescription = 512`, and the daemon's own
  statement that the roster label's *"authoritative full-length copy already crossed the wire on the
  BackgroundTaskStarted this entry's `task_id` joins back to"*, and that *"a cut here loses nothing a
  consumer holding that event cannot recover."* That paragraph is the SSOT for AC2 and for the
  started-wins-permanently rule below.

## Design source

N/A — no UI in this slice. #568 owns the panel and inherits the inert-plain-text obligation. The ticket
body carries no `## Figma` section and needs none; this is renderer state with no rendered surface.

## Context

The daemon reports claude's background-task lifecycle as three frames, all decoded and emitted as typed
`DaemonEvent` arms (#564 / #565 / #566). #573 shipped the store holding the **roster** — the aggregate
frame, keyed by `conversationId`, replaced per frame, cleared on the `connected` edge.

The roster row is four capped snake_case fields and carries **no `tool_call_id`**. The started frame
carries six camelCase fields including `toolCallId` and a description under a 32× larger cap. So a task
the app only ever learns about from a roster genuinely has no tool call to join against, and a task it
saw opened has a strictly better copy of the same label. Holding only the roster throws the better copy
away the moment the first roster lands, because the started frame never repeats.

This slice joins the two on `conversationId` + `taskId`, never on arrival order — a roster can arrive
before the `background_task_started` for a task it lists, or after.

### Two shapes are closed before design starts

Four places (#567's body, `docs/knowledge/codebase/573.md:74-78`, `backgroundTaskRosterBridge.ts:25`,
`backgroundTaskRosterBridge.test.ts:57`) predict "widen `BackgroundTaskRosterEntry` with optional
`toolCallId` / `patch`, roughly six executable lines". Both shapes that prediction implies are closed:

- `BackgroundTaskRosterEntry` is **per-conversation**. A single `toolCallId` on it would name one tool
  call for a whole conversation's roster.
- `BackgroundTask` is the **wire type**. Adding `tool_call_id` drifts it from the mobile contract
  (CLAUDE.md, ADR 0002) and fails a shipped test (`src/shared/wire/types.test.ts:318-336`).

The third shape — a per-task held type, mapped from either source — is what this spec builds. Correcting
the four claims in place is in scope; see § "The four stale claims".

## Design

### The per-task held shape

One new exported interface in `backgroundTaskRosterStore.ts`. Renderer-side camelCase, mapped from
either source:

```ts
export interface HeldBackgroundTask {
  taskId: string
  toolCallId: string | null
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}
```

Five decisions carried by that declaration:

1. **`toolCallId: string | null`, required — not `toolCallId?: string`.** The hazard AC4 names is a
   *fabricated identifier*: `''` is the same identifier `toolUse` / `toolResult` carry, so a placeholder
   would join wrongly against a real tool call. `null` is not in the identifier's domain and cannot
   collide. Required-and-nullable beats optional because the compiler then forces **every** construction
   site to state the value; an optional property lets a construction site silently omit it and still
   compile.
2. **camelCase, and the rows are no longer held verbatim.** #573 held the wire rows by reference in
   snake_case, which is the correct house rule for a nested array passed through untouched. It stops
   applying the moment a mapping exists, and the alternative — synthesising a `BackgroundTask` for a
   started-only task — would put a manufactured object into a type documented as mirroring the daemon
   field-for-field. The wire type is still imported and still referenced by the write unit below, so no
   drift is introduced.
3. **`truncatedFields` is assigned straight across (`row.truncated_fields`), never `?? []`.** This is
   the mapping #573's header said could not exist. See § "The null-preservation guarantee".
4. **`taskId` is carried in the value as well as being the map key.** Redundant by one field, and worth
   it: the reader (#568) iterates values and would otherwise have to thread entry keys alongside them.
5. **No terminal / finished / failed field.** The daemon reports no finish. Absence from a later roster
   is this family's only removal path, and modelling more would be a claim the wire cannot support.

### State shape

Only the entry's `tasks` field changes. The top-level map, its key, `droppedTasks`, `selectRosterFor`'s
`?? null` and `resetRosters` are all untouched — which is what keeps AC5's never-observed / observed-empty
distinction working for free rather than needing to be rebuilt.

```ts
export interface BackgroundTaskRosterEntry {
  tasks: ReadonlyMap<string, HeldBackgroundTask>   // keyed by taskId; insertion order = roster order
  droppedTasks: number
}
```

`ReadonlyMap` over an array: the join and the upsert are both one expression, duplicate `task_id` rows are
impossible by construction rather than by a scan, and JS `Map` preserves insertion order so display order
is still roster order. Build the map at **write** time; `selectRosterFor` keeps returning the held entry
object itself, so no fresh object or array is built per selector call (the reference-stability note in the
ticket, and the reason #573 needed no hoisted `EMPTY_*` constant).

### Write units

`BackgroundTaskRosterSnapshot` keeps its exact current field list — `{ conversationId, tasks: readonly
BackgroundTask[], droppedTasks }` — and stops extending `BackgroundTaskRosterEntry` (the entry's `tasks`
is now a Map; the snapshot's stays the wire rows). **The bridge still hands the store wire rows
verbatim**; the row → `HeldBackgroundTask` mapping happens inside `setRoster`, because that is where the
prior state needed for the join lives. Consequence worth stating plainly: `translateBackgroundTaskRoster`
is **behaviourally unchanged** and every one of its existing tests survives.

One new exported write unit — the started arm minus its `type` tag, with `toolCallId` non-nullable
because the frame always reports one:

```ts
export interface BackgroundTaskStartedSnapshot {
  conversationId: string
  taskId: string
  toolCallId: string
  taskType: string
  description: string
  truncatedFields: readonly string[] | null
}
```

Store surface becomes three named setters. Still no reducer — a discriminated action union for three
operations is still ceremony without benefit.

```ts
export type BackgroundTaskRosterStore = BackgroundTaskRosterState & {
  setRoster: (snapshot: BackgroundTaskRosterSnapshot) => void
  setStartedTask: (snapshot: BackgroundTaskStartedSnapshot) => void
  resetRosters: () => void
}
```

### The join rule

**Provenance is derived, not stored: a held task is started-sourced exactly when `toolCallId !== null`.**
Only the started frame reports `toolCallId`, and it always reports it, so the predicate is exact by the
wire's construction and needs no extra field.

**It must be `!== null`, never `if (task.toolCallId)`.** `requireString`
(`src/main/transport/inboundMessage.ts:288`) admits `''`, so a daemon-sent `tool_call_id: ''` decodes to
`''` — truthy-false, but still proof the started frame was seen. A truthiness check would silently
demote such a task to roster-sourced and let a later roster overwrite its fuller label. There is a test
for this (§ Testing, store #12).

Any field added to `HeldBackgroundTask` in future that a roster row cannot report must join this
predicate. That is a rule about this code, not a prediction about another ticket — do not write a
docstring forecasting what a sibling ticket will do, which is precisely how the four stale claims
happened.

**`setRoster(snapshot)`** — copy-on-write on the outer map; the entry is rebuilt as:

- `tasks`: a fresh `Map` built from `snapshot.tasks` **in row order**. For each row, if a task is held for
  that `task_id` **and is started-sourced**, keep the held record unchanged; otherwise build a fresh
  `HeldBackgroundTask` from the row with `toolCallId: null`. Rows not previously held are new; held tasks
  whose id is absent from `snapshot.tasks` are simply not carried over — that drop is AC5, and it applies
  to started-sourced tasks exactly as it does to roster-sourced ones.
- `droppedTasks`: `snapshot.droppedTasks`, unconditionally.

The write stays **unconditional**: `tasks: []` still writes an entry holding an empty map ("the daemon says
nothing is alive"), never deletes the key, never gets coalesced as "no news".

Why the started record wins rather than being refreshed from the row: the daemon's own cap comment
(`parser.go:160-178`) states the roster label is the same text under a tighter cap and that its
*authoritative full-length copy already crossed the wire on the `background_task_started` this row joins
back to*. Refreshing from the row would throw the better copy away at the first roster and never get it
back, which is the whole point of this ticket (AC2). Roster-sourced records **are** rebuilt from each new
row, so the roster remains replacement truth for everything it can actually report.

**`setStartedTask(snapshot)`** — copy-on-write; upsert into the conversation's entry, creating the entry
if the conversation has none:

- `tasks`: clone the held map, `set(taskId, record)` built from the snapshot with `toolCallId:
  snapshot.toolCallId`. `Map.set` keeps an existing key's position, so an upgrade-in-place preserves
  roster order; a genuinely new task appends.
- `droppedTasks`: **preserved** from the existing entry, or `0` when creating one. A started frame reports
  nothing about roster truncation and must not reset the count.

The started snapshot's `description` / `taskType` / `truncatedFields` **replace** whatever the task held
(AC2). `truncatedFields` in particular is replaced, never unioned: the two lists name different
vocabularies (started: `task_id` / `tool_call_id` / `description` / `task_type`; roster row: `task_id` /
`task_type` / `description`), and one flattened list per task would be a list no reader can attribute back
to a field.

**`resetRosters()`** — unchanged. Clears the whole map on the `connected` edge, returns the same state
reference when already empty. It now also clears started-sourced tasks, which is AC5's last clause and
needs no code change, only a test and a docstring line.

### The null-preservation guarantee

`backgroundTaskRosterStore.ts:11-14` currently claims the guarantee "holds BY CONSTRUCTION: there is no
per-row mapping in which a collapse could occur." **This slice introduces exactly that mapping, so the
claim becomes false and must be rewritten**, not left standing as a reassurance that no longer describes
the code. What defends it afterwards is (a) a straight assignment `truncatedFields: row.truncated_fields`
with no `??` on either path, and (b) two tests that fail if a collapse is introduced — one per path, per
AC3. `null` collapsing to `[]` is not a type error and breaks no other test; the tests are the whole
defence, and the rewritten header must say so in those terms.

### Bridge

Add a **sibling translator**, not a widened return type:

```ts
export function translateBackgroundTaskStarted(event: DaemonEvent): BackgroundTaskStartedSnapshot | null
```

Same posture as its neighbour: a fresh named-field literal (never `return event`, never a spread),
`default: null`, single owned arm, React-free. `translateBackgroundTaskRoster` keeps returning `null` for
the started arm, so its existing tests are untouched.

Rejected: one translator returning `{ kind: 'roster' | 'started', snapshot } | null`. It reshapes every
existing translator assertion and destroys the "each translator is a pure arm→snapshot filter" property
the file's docstring names — the same property that kept the `connected` reset out of the translator in
#573. Two small pure filters cost the same executable lines and preserve it.

`subscribeBackgroundTaskRoster` gains a fourth parameter, `setStartedTask`, and one branch. Order inside
the listener: the `connected` reset stays **first** and returns (it is the sole enforcement of AC5, which
is why the store is deliberately absent from `clearPairingScopedState`); then the roster translator, write
and return; then the started translator and write. Both writes stay guarded on `!== null`, never
truthiness — a snapshot object is truthy even when its `tasks` are empty.

`BackgroundTaskRosterData` passes `(snapshot) => backgroundTaskRosterStore.getState().setStartedTask(snapshot)`
as the new argument. Its name, its props, its headless-null return and its `window.pyry`-only-inside-the-
effect invariant are unchanged, so **`App.tsx` is not touched**.

### Names are deliberately not changed

`selectRosterFor`, `BackgroundTaskRosterEntry`, `setRoster`, `resetRosters`, `BackgroundTaskRosterData`,
both file names: all keep their current names even though the entry now holds a joined set rather than a
verbatim roster. The roster frame is still replacement truth for the set's membership, so "roster" is
still the right word; renaming would churn ~20 test call sites and `App.tsx` for no behavioural gain, and
CLAUDE.md's "don't refactor adjacent code while you are there" binds. Say this in the store header so the
next reader does not mistake the retained names for an oversight.

### The four stale claims

Correcting these is in scope because they sit in the docstrings this slice already rewrites, or become
false by this slice's own change:

| Site | Now says | Must say |
| --- | --- | --- |
| `backgroundTaskRosterStore.ts:11-14` | null-preservation "holds BY CONSTRUCTION: there is no per-row mapping" | There is now a per-row mapping; the guarantee is defended by the straight assignment and by the AC3 tests, named as such. |
| `backgroundTaskRosterBridge.ts:25` | "#574 WIDENS the held entry with the scalar arms' `toolCallId` / `patch`" | The fresh named-field literal's real reason: a spread would carry fields the write unit never agreed to hold. State it without forecasting any ticket. |
| `backgroundTaskRosterBridge.ts:37` | the two scalar siblings "are #574's" | #574 is closed and split. `backgroundTaskStarted` is handled here; `backgroundTaskUpdated` stays dormant and is #577's. |
| `backgroundTaskRosterBridge.test.ts:57` | restates the `:25` claim | Same correction as `:25`. |
| `backgroundTaskRosterBridge.test.ts:89` | restates the `:37` claim | Same correction as `:37`. |

**Not in scope, and must not be swept:** the ~40 other `#567` references across `src/shared/ipc/events.ts`,
`src/shared/wire/types.ts`, `src/main/transport/inboundMessage.ts`, `src/main/daemonConnection.ts`,
`daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts` and their tests. They are stale in the same
way, and fixing them is a documentation-phase or separate-ticket job — CLAUDE.md's rule binds everything
this reshape does not already touch.

## State + concurrency model

Unchanged from #573, and deliberately so. One Zustand vanilla store, one app-lifetime listener subscribed
in `BackgroundTaskRosterData`'s mount effect with the `off` handle as cleanup (StrictMode double-mount nets
one live listener). All three write paths ride that one listener and are dispatched **synchronously in
arrival order** — there is no `await` anywhere between reading `s.rosters` and returning the next state, so
the check-then-act shape has no gap a concurrent handler could interleave into. No timers, no
`AbortController`, no async iteration, no request half (the daemon pushes these frames unsolicited).

Copy-on-write throughout: clone the outer map, clone the inner map, replace. Never mutate `s.rosters`, an
entry, or an entry's `tasks` in place. Reference stability that #568 depends on: a write for conversation
`c2` leaves `c1`'s entry object identical (`Object.is` true → no re-render of a `c1` watcher), and
`selectRosterFor` returns the held entry rather than constructing one.

## Error handling

There are no failure modes in this slice and no new ones introduced. The store performs no validation,
no parsing, no I/O and throws nothing: #566 / #564 own the fail-closed decode upstream, and a frame that
fails to decode never reaches an event arm. The bridge listener only translates and dispatches — it never
throws into React. No user-facing error surface, no banner, no dialog.

The one shape a caller could get wrong is passing `toolCallId: ''` down the started path; that is a valid
wire value, not an error, and is handled by the `!== null` provenance rule rather than rejected.

## Growth bound and residual exposure

Stated deliberately per the ticket's technical note, and **not** defended with a speculative eviction
policy — no such failure has been observed.

Bounded by the daemon:

- A roster carries at most **8** rows (`maxTaskRosterEntries`, `parser.go:155`); overflow is reported via
  `droppedTasks`, never silent.
- Each roster row is ≤ 1024 bytes (`maxTaskFieldID` 256 × 2 + `maxTaskRosterDescription` 512).
- A started frame's `description` is ≤ 4 KiB (`maxTaskDescription`), its ids ≤ 256 bytes each, so a
  started-sourced held task is ≤ ~5 KB.
- The v2 application-envelope cap (65519 bytes) backstops every frame independently.

**The residual exposure this ticket introduces:** the daemon emits a roster only when claude emits one —
it synthesises none. So a `backgroundTaskStarted` for a conversation that never receives a subsequent
roster is held until the `connected` edge clears it, and the count of such tasks is bounded only by how
many started frames claude emits between rosters. Multiplied by the number of conversations seen since
connect, which is likewise cleared only on `connected`. At ~5 KB per held task this is not a plausible
memory-exhaustion vector from a bounded-frame stream, and the honest statement is the deliverable here.
The one user-visible consequence: a started-only task remains listed until a roster contradicts it or the
connection re-handshakes, so a panel may show a task that has since finished — which is already true of
every task in this family, because the wire reports no finish.

Not compensated for across a reconnect: the roster is not in the daemon's reconcile-on-connect set (that
set is exactly outstanding `modal_shown`, pyrycode#877, and `queue_state` per non-empty backlog,
pyrycode#878) and this app advertises no `last_event_id`, so nothing replays. The set reads `null` after a
reconnect until claude next emits a roster. Retaining the pre-disconnect set would present a stale list as
live. #569 owns closing that gap and needs a daemon-side change.

## Testing strategy

`npm test` (vitest) and `npm run build`. Plain-function store tests over isolated
`createBackgroundTaskRosterStore()` instances; framework-free bridge tests with injected spies plus the
existing real-store seam block. No new harness, no new fixture file, no DOM. Both test files **migrate**:
the element type changes on every roster assertion, and `backgroundTaskRosterStore.test.ts:51`'s
verbatim-by-reference assertion (`expect(held?.tasks).toBe(tasks)`) necessarily dies — replace it with a
field-by-field mapping assertion rather than deleting the coverage.

Store scenarios (existing 16 migrate; these are the ones this slice adds or must not lose):

1. A started event for a never-observed conversation creates the entry: the task is held under its
   `taskId`, `toolCallId` carried, `droppedTasks` is `0`, and `selectRosterFor` returns non-null.
2. A started event for a task already held from a roster replaces its `description` / `taskType` /
   `truncatedFields` and adds the `toolCallId` (AC2).
3. A roster arriving **after** a started for the same task keeps the started record intact — fuller
   description and `toolCallId` both survive the replacement (AC4).
4. A roster arriving **before** the started for a task it lists holds the row with `toolCallId: null`;
   the later started upgrades it in place, keeping its position in roster order.
5. A roster-sourced task's `toolCallId` is `null` and specifically not `''` — assert both.
6. A started-sourced task absent from a new roster is **dropped** (AC5), same as a roster-sourced one.
7. A roster-sourced task absent from a new roster is dropped (migrated from the existing test).
8. **AC3, roster path:** a row with `truncated_fields: null` is held as `truncatedFields: null`, never
   `[]`; a row with `[]` stays `[]`. Assert on the retrieved value, not the input.
9. **AC3, started path:** a started event with `truncatedFields: null` is held as `null`; `[]` stays `[]`.
10. A started event's `truncatedFields` **replaces** the task's roster-sourced list rather than unioning
    with it — seed a task from a roster row with `['description']`, then start it with `['task_type']`,
    and assert the held list is exactly `['task_type']`.
11. `droppedTasks` survives a started write on an existing entry (seed `droppedTasks: 3` from a roster,
    then start a task, then assert it is still `3`).
12. **The truthiness trap:** a started event with `toolCallId: ''` still marks the task started-sourced —
    drive it through a subsequent roster carrying the same task and assert the started description
    survives. This test fails if the provenance check is written as `if (task.toolCallId)`.
13. `resetRosters` clears started-sourced tasks too, returning every conversation to `null` (AC5).
14. Roster order is preserved on the held map's keys, including when a started-sourced record survives
    in place.
15. Reference stability: a started write for `c2` leaves `c1`'s entry `Object.is`-identical.
16. Migrated as-is: never-observed vs observed-empty read apart; entry keys are exactly
    `['droppedTasks', 'tasks']`; the two-store DI isolation and injected-initial-state cases.

Bridge scenarios:

- `translateBackgroundTaskStarted` maps the arm to a fresh literal — `not.toBe(event)`, all six fields
  present, `truncatedFields: null` passed through as `null`.
- It returns `null` for a sample of unrelated events including `backgroundTaskRoster` and
  `backgroundTaskUpdated` (the latter stays dormant; it is #577's).
- `translateBackgroundTaskRoster` still returns `null` for a started event — the existing test survives,
  only its `:89` comment changes.
- The subscriber calls `setStartedTask` and neither `setRoster` nor `resetRosters` on a started event, and
  the mirror assertion for a roster event.
- A `connected` event still resets and writes nothing, with a started event held beforehand.
- Seam (real store): started → roster (same task) keeps the fuller label end-to-end; roster → started
  upgrades in place; started-only → roster excluding it drops it; `connected` clears both kinds.

Type-level coverage rides `npm run typecheck` via `npm run build`: `HeldBackgroundTask.toolCallId` being
required-and-nullable makes an omitted `toolCallId` at any construction site a compile error, which is the
point of choosing it over an optional property.

## Non-goals — do not touch

- **`backgroundTaskUpdated` / `patch`** — #577's, and it builds on this shape. Leaving it unhandled
  compiles green because this bridge is `default: null`, not `assertNever`.
- **The three exhaustive bridges** (`daemonEventBridge.ts:150`, `timelineBridge.ts:158`,
  `modalBridge.ts:98`) — already correct, already satisfying their `assertNever`, each with a docstring
  explaining that this store is the consumer. This slice adds no case to any of them, which is what holds
  it to two production files.
- **`src/shared/wire/types.ts`, `src/shared/ipc/events.ts`, `src/main/**`** — no wire or transport change.
- **`App.tsx`** — the leaf component's signature does not change.
- **`clearPairingScopedState`** — the store stays deliberately absent from it; the `connected` branch is
  the sole enforcement of AC5.
- **No new files. No rendering. No terminal state. No cross-reconnect retention. No eviction policy.**

## Open questions

- **#568's iteration cost.** `ReadonlyMap` means the panel writes `[...entry.tasks.values()]` to render,
  which is a fresh array per render. That is #568's to memoize (or to render straight from, if it turns
  out not to matter) and is not worth pre-solving here — the store's own read surface stays
  reference-stable, which is what the ticket's note asks for.
- **Whether `taskId` on the value is redundant enough to drop** once #568 exists and we can see how it
  iterates. Carried for now.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The untrusted → typed crossing is upstream and unchanged:
  `parseBackgroundTaskStartedPayload` / `parseBackgroundTaskRosterPayload` in
  `src/main/transport/inboundMessage.ts` fail closed before an event arm exists. This slice consumes
  already-typed arms in the renderer and adds no parse, no `JSON.parse`, no coercion. One finding worth
  naming rather than waving past: **the mapping this slice introduces is the first place a background-task
  field is copied rather than passed by reference**, so a future field added to `HeldBackgroundTask`
  becomes a place a fail-closed decode could be silently bypassed by constructing a value locally. The
  design keeps every field a straight copy from the snapshot, with no defaulting, no `??`, and no
  derivation except the `toolCallId: null` for roster-sourced rows — that `null` is the one value in the
  held shape not sourced from the wire, and it is deliberately outside the identifier domain so it cannot
  be mistaken for one.
- **[Tokens, secrets, credentials]** Not applicable by construction. No token, key, or credential is
  reachable from the renderer store layer; the six fields on the started arm are bounded opaque strings
  plus a list of wire field names. Nothing here is logged — the store and bridge contain no `console.*`
  call and this spec adds none, so no field reaches a log, an error message, or a stack trace.
- **[File / storage operations]** Not applicable. Nothing is persisted. The store is in-memory renderer
  state, cleared on the `connected` edge; no `localStorage`, no `sessionStorage`, no IndexedDB, no disk.
  This matters more than it sounds: `description` is a literal command line, and persisting it to
  renderer web storage would survive the pairing boundary that `resetRosters` exists to enforce. **Do not
  persist this store.**
- **[Inter-process / Electron attack surface]** No IPC surface change. No new `contextBridge` API, no new
  `ipcMain` channel; the bridge subscribes through the existing `window.pyry.onDaemonEvent`. No window,
  no `webPreferences`, no navigation, no protocol handler. Nothing crosses back toward main.
- **[Cryptographic primitives]** Not applicable. No randomness, no hashing, no comparison against a
  secret. Note specifically: the `taskId` join is an equality compare on a **non-secret** identifier, so
  a plain `Map` lookup is correct and `timingSafeEqual` would be cargo cult.
- **[Network & I/O]** Not applicable. No socket, no fetch, no timer, no reconnect logic. Frame size is
  bounded upstream by the daemon's construction-time caps and by the 65519-byte envelope, twice
  independently; see § "Growth bound".
- **[Error messages, logs, telemetry]** No findings. Nothing logged, nothing surfaced to the user by this
  slice. The `description` field — the literal command line for `taskType: local_bash` — must not be
  added to any diagnostic log by the implementer; the content-free logging discipline (#126) already
  forbids it and this spec introduces no log call to violate it.
- **[Concurrency]** No findings. One app-lifetime listener, `off` handle returned as the effect cleanup,
  no timers, no `AbortController` needed because there is nothing cancellable. All state transitions are
  synchronous with no `await` in the read-then-write path, so there is no check-then-act gap. Duplicate
  subscription is prevented by the same StrictMode-safe cleanup #573 shipped.
- **[Threat model alignment]** Three desktop-specific threats apply:
  - **Hostile daemon / compromised session** sending a `background_task_started` with `toolCallId: ''`
    or an id chosen to collide with a real `toolUse` / `toolResult` id. The design does not defend
    against a *valid-looking* colliding id — nothing can, since the identifier space is the daemon's —
    but it does guarantee the app never **fabricates** one, which is the failure AC4 names. `null` for
    roster-sourced tasks is unforgeable as a tool-call id. Downstream joins in #568 must treat a
    `toolCallId` as a hint from an untrusted peer, not as proof.
  - **Roster flooding.** A hostile peer emitting many `background_task_started` frames for many
    conversation ids grows the map without a roster ever bounding it, until the `connected` edge. Named
    and accepted in § "Growth bound" — bounded per frame by the daemon's caps, not bounded in count. No
    eviction policy is built: the failure has not been observed, and a speculative one would need a
    policy for which task to drop that the wire cannot inform.
  - **Renderer compromise reaching the transport.** Unchanged: this slice adds no path from renderer state
    back toward keys, sockets, or main. The store is write-once-per-event and read-only downstream.
  - Out of scope, named: **stale-list-presented-as-live after a reconnect** is #569's, and needs a
    daemon-side change. **Rendering `description` as inert text** — never an HTML sink, an attribute, a
    URL, an executed or re-shelled string — is #568's, inherited; this slice ships no DOM sink and
    nothing iterates the held tasks.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-19
