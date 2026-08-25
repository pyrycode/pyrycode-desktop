# #747 — hold the four activity facts per conversation, keyed by conversation id

**Size:** S (confirmed, not overridden)
**Labels:** `enhancement`, `size:s`, `security-sensitive`
**Parent:** #674, split into #747 (this store) → #748 (the bridge that writes it) → #749 (the clears)

## Design source

N/A — pure renderer state with no writer and no reader in this slice. The ticket body carries no
`## Figma` section, correctly: nothing this ticket ships renders, and the sidebar surface that will
eventually draw from this store is a separate ticket on board #7. The visual-fidelity check is
intentionally skipped.

## Files to read first

- `src/renderer/src/store/backgroundTaskRosterStore.ts:31-39` — the header's argument for keying by
  `conversationId` instead of a flat slot, and its named-setters-not-a-reducer rationale. This spec
  reuses both verbatim; do not re-derive them.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:206-224` — `BackgroundTaskRosterState` +
  `initialBackgroundTaskRosterState`: the `ReadonlyMap` state shape and the absent-key-vs-present-empty
  distinction stated at the type. This is the shape to copy.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:304-341` — `createBackgroundTaskRosterStore` and
  the `setRoster` body: the exact copy-on-write idiom (clone the outer map, replace the key, return a
  fresh state object). Extract the mechanics, not the join logic — this store has no join.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:386-393` — singleton + `useStore`-backed hook.
  Four lines; copy the structure and the naming.
- `src/renderer/src/store/backgroundTaskRosterStore.ts:395-424` — `selectRosterFor`. **The single most
  important read.** Its docstring tabulates the three-way reading (absent → `null` vs observed-empty vs
  observed-live) at `:398-413` and states the reference-stability property that makes AC2 true at
  `:415-417`. AC2 and AC3 of this ticket are that docstring applied to a different payload.
- `src/renderer/src/store/relayLinkStore.ts:1-61` — the smallest complete instance of the house's
  four-part store structure (DI factory → singleton → hook → selector) and the "single setter, no
  reducer" posture the body points at. Read it for proportion: this ticket's store is closer in size
  to this file than to the roster.
- `src/renderer/src/store/backgroundTaskRosterStore.test.ts:1-30` and `:108-170` — the plain-function,
  React-free test idiom over isolated `create…Store()` instances, and how the `toBeNull()` /
  `not.toBeNull()` pairs assert the three-way distinction. Follow this file's shape.
- `src/shared/ipc/events.ts:125,145,172,199` — the four upstream arms (`turnState`, `stallDetected`,
  `apiRetry`, `compacting`), each now carrying a **required** `conversationId`. Read the comment blocks
  above them: they state that the id is a routing key, that repeats are not deduped, and that they push
  the hostile-id question down to *this* store.
- `src/renderer/src/store/threadTimeline.ts:184-224` — the four existing chrome scalars plus
  `localSendPending`. Read to know what this ticket must **not** touch: `ApiRetryStatus` stays where it
  is, `localSendPending` gets no fifth slot here, and nothing migrates.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:1335-1345` — `isTurnRunning`, the
  existing running-turn predicate. Read to confirm it lives inside a React screen module, which is why
  this store does **not** import it (see § The turn-running fact).
- `src/renderer/src/store/queueStore.ts:39` and `src/renderer/src/store/runSettingsWriteStore.ts:65` —
  the other two `ReadonlyMap<string, …>` stores. Confirm by inspection that no renderer store keys a
  daemon-supplied id into a `Record`; the house rule this ticket relies on already holds repo-wide.
- `vitest.config.ts:20-33` — the `@shared` / `@renderer` aliases and `environment: 'node'`. Node is
  already global, so this ticket chooses nothing here; do not add a per-file environment pragma.

## Context

The renderer holds turn phase, stall, retry and compaction as **single scalars belonging to whichever
conversation is open** (`threadTimeline.ts:189-224`). The sidebar needs the same four facts for every
conversation at once, so it can draw a dot on a row the user has never opened.

This slice ships the holder and nothing else: **no writer, no reader**. #748 wires the four daemon arms
into it; #749 adds the clears. That staging is what keeps this ticket at one production file.

The four upstream arms all now carry `conversationId` as a **required** field, deliberately, so nothing
downstream can reach for a `?? activeConversation` fallback. That decision pushed the hostile-id
question down here — which is why AC4 is load-bearing rather than defensive boilerplate.

## Size check

| Red line | Limit | This design | |
|---|---|---|---|
| New files | > 3 | 3 (store, test, this spec) | pass |
| Total written **code** lines | > ~600 | ~110 production + ~230 test ≈ 340 | pass |
| New exported types / interfaces | > 5 | 3 (`ConversationActivityEntry`, `ConversationActivityState`, `ConversationActivityStore`) | pass |
| Consumer call sites to update simultaneously | > 10 | 0 — a new file with no writer and no reader | pass |
| Acceptance criteria | > 5 | 4 | pass |
| Distinct error / reject branches | > ~10 | 0 — no state machine, no reject path, no log call | pass |

On the line count: the precedent `backgroundTaskRosterStore.ts` is 424 lines by `wc -l` but **118 code
/ 293 comment**, and it shipped `size:s` as #573. This house documents heavily; a ~300-line store file
with ~110 code lines is a normal S here. Size against code, not `wc -l`.

Branch-overlap check run against all `origin/feature/*` branches (`git fetch --prune` first, so
in-flight work with no PR yet is visible): **no branch touches
`src/renderer/src/store/conversationActivityStore*.ts`, and none touches
`src/renderer/src/store/` at all.** No `addBlockedBy` needed. Both files are new, so a merge conflict
is structurally impossible for this slice.

## Design

One new file: **`src/renderer/src/store/conversationActivityStore.ts`**, in the four-part house shape
(DI factory → app-wide singleton → `useStore` hook → selector factory bound to one id).

### The held value

```ts
export interface ConversationActivityEntry {
  turnRunning: boolean
  stalled: boolean
  apiRetrying: boolean
  compacting: boolean
}
```

Four plain booleans, not `boolean | null`. The "never observed" reading lives at the **entry** level
(`selectActivityFor` returns `null`), exactly as the precedent puts it there rather than inside the
payload — see `backgroundTaskRosterStore.ts:398-413`. Per-fact nullability would invent a third state
the sidebar cannot draw and would multiply the test matrix by four for no consumer.

Naming, deliberately diverging from the chrome scalars it sits beside:

- `apiRetrying`, **not** `apiRetry`. `threadTimeline.ts:184-199`'s `apiRetry` is
  `ApiRetryStatus | null` — a counter record. This is the liveness bool only, per the body. The
  different name is what stops a reader treating one as the other; a same-name-different-shape pair in
  the same package is the `model`-collision trap `announcedModelStore.ts:12-16` documents.
- `turnRunning`, **not** `phase`. This holds the derived boolean, never the `TurnPhase` wire enum.
- `stalled` / `compacting` match the scalars they mirror, because the shape matches too.

There is deliberately **no fifth fact**: `localSendPending` (`threadTimeline.ts:206-224`) is the one
renderer-sourced scalar, opened by the operator's own send, and only the open conversation has a
composer that can open it.

### State, store shape, and the default entry

```ts
export interface ConversationActivityState {
  entries: ReadonlyMap<string, ConversationActivityEntry>
}

export type ConversationActivityStore = ConversationActivityState & {
  setTurnRunning: (conversationId: string, turnRunning: boolean) => void
  setStalled: (conversationId: string, stalled: boolean) => void
  setApiRetrying: (conversationId: string, apiRetrying: boolean) => void
  setCompacting: (conversationId: string, compacting: boolean) => void
}

export const initialConversationActivityState: ConversationActivityState = { entries: new Map() }
```

A module-private `const idleActivity: ConversationActivityEntry` (all four `false`) seeds a
newly-created entry. **It must not be exported.** Exporting it invites a reader to write
`selectActivityFor(id) ?? idleActivity`, which collapses AC3's absent-vs-observed-idle distinction with
no type error and no failing test — the precise collapse `queueStore`'s `?? EMPTY_BACKLOG` makes and
that `backgroundTaskRosterStore.ts:398-405` warns against inheriting. Tests construct their own
literals.

Four **named setters**, not a reducer and not one generic `setFact(id, name, value)`. Four independent
whole-value writes model no state machine, so a discriminated-union action set is ceremony without
benefit (the `relayLinkStore.ts:15-17` / `announcedModelStore.ts:20-23` posture). A generic setter
would additionally reintroduce a stringly-typed key next to the one hostile string this ticket exists
to contain.

Each setter takes `boolean`, including `setStalled` — even though `stallDetected` is an onset-only
nullary arm. The store holds replacement truth; **the writer decides when a fact clears**. A nullary
`markStalled(id)` would leave the store with no way to clear the fact at all, and #748 needs one.

### The write path

Each setter is a same-value guard composed onto one shared private helper:

```ts
setCompacting: (conversationId, compacting) =>
  set((s) =>
    s.entries.get(conversationId)?.compacting === compacting
      ? s
      : writeEntry(s, conversationId, (held) => ({ ...held, compacting }))
  )
```

`writeEntry(s, conversationId, update)` — private, one expression: read the held entry or
`idleActivity`, apply `update`, clone the outer map, `set` the key, return a fresh
`ConversationActivityState`. Never mutates `s.entries` or an entry in place.

Three properties fall out, each of which is an AC:

1. **A first write creates the entry (AC1).** `?.` yields `undefined` on an absent key, and `undefined`
   is never `=== ` a boolean, so the create path always runs on a first write — *including a first
   write of `false`*. "Absent" and "observed idle" cannot be conflated by the guard. This is a real
   scenario, not a hypothetical: `apiRetry` and `compacting` both carry explicit falling edges, so
   `active: false` can be the first frame a conversation ever produces.
2. **A write for one conversation leaves every other entry referentially unchanged (AC2).**
   `new Map(s.entries)` copies *references*, so `nextMap.get(otherId)` is `Object.is`-identical to
   `previousMap.get(otherId)`. Combined with a selector that returns the held entry itself, a component
   watching another conversation does not re-render — `backgroundTaskRosterStore.ts:415-417` states
   exactly this property.
3. **A verbatim repeat churns no listener.** The upstream arms are explicitly *not* deduped —
   `events.ts:165-167` and `:195-197` both state the transport holds no state and a consumer sees one
   event per daemon frame including a verbatim repeat. The guard makes the store idempotent on that
   repeat at the cost of one comparison, so zustand's `Object.is` short-circuits and no subscriber
   wakes. This is the documented wire behaviour, not a speculative defence.

Writing each setter's guard against **its own named field** (rather than a shared 4-field
`entriesEqual` inside the helper) is deliberate: a shared exhaustive comparison silently stops writing
when a fifth fact is added, whereas a fifth fact here means a fifth setter carrying its own guard.

The write path performs **no computed object keys anywhere** — every fact is named by a property
shorthand at the call site. That keeps "this file constructs no object key from a variable" a
grep-checkable invariant, which matters for § Security review.

### The read path

```ts
export const selectActivityFor =
  (conversationId: string) =>
  (s: ConversationActivityState): ConversationActivityEntry | null =>
    s.entries.get(conversationId) ?? null
```

`?? null` — the `selectRosterFor` posture, adopted rather than re-derived. Three readings stay distinct
(AC3):

| map state | selector returns | meaning |
|---|---|---|
| key absent | `null` | no frame has ever arrived for this conversation |
| `{ …all false }` | that entry | observed; nothing is happening |
| `{ compacting: true, … }` | that entry | observed; compacting |

`null` is a stable reference by construction, so no hoisted `EMPTY_*` constant is needed and no fresh
object is built per selector call. The nullable return type forces the eventual reader to branch, so
the distinction cannot be ignored accidentally.

There is **no whole-map selector** and no `selectAllActivity`. Nothing in this slice or the next two
reads the map wholesale (#749 clears it, #748 writes it, the sidebar reads one row at a time), and
shipping one would ship an unread read surface — the `backgroundTaskRosterStore.ts:418-420` rule.

### The turn-running fact — where the derivation lives

The body asks that the running-turn fact reuse `isTurnRunning` rather than re-derive the phase test.
**That reuse belongs in #748, not here**, and this store's setter therefore takes a plain `boolean`.

`isTurnRunning` is exported from
`src/renderer/src/screens/conversation/ConversationScreen.tsx:1343` — a React screen module. Importing
it into a store would drag React, JSX and the screen's whole import graph into a store whose tests must
run with no React and no DOM. Moving the predicate to a React-free module is a rename-shaped refactor
with its own fan-out, and CLAUDE.md forbids doing it while passing through.

So this file carries a hard constraint, stated at the top of the module and checkable by grep:

> **This store imports nothing from `src/renderer/src/screens/`, and nothing from
> `activeConversationStore`.** Its only imports are `zustand/vanilla` and `zustand`.

The second half is AC3's teeth: with no reference to the open conversation in scope, a
`?? activeConversation` fallback is not something a developer must remember to avoid — it is
unavailable.

#748 inherits the note: it must derive `turnRunning` with `isTurnRunning(state)` rather than writing
its own `phase !== 'idle'`, and it owns whatever module move that needs.

### Explicitly out of scope

- **No clear / reset setter.** #749 owns both clears (per-conversation on delete, and every
  conversation when the pairing ends). Do not add `resetActivity`, and do not register this store in
  `clearPairingScopedState` — #749 makes that call, including the `connected`-edge vs
  pairing-scoped discriminator that `announcedModelStore.ts:29-45` documents.
- **No migration of the existing chrome scalars.** `threadTimeline.ts:189-224` keeps `phase`,
  `stalled`, `apiRetry`, `compacting` and `localSendPending` exactly as they are, and this store runs
  alongside them. Those scalars carry intricate per-fact clear semantics across 28 renderer references;
  unpicking them is its own piece of work and nothing needs it yet.
- **No bridge, no subscription, no `App.tsx` wiring.** #748.
- **No `ApiRetryStatus` counter.** The liveness fact only; the counter stays serving the open
  conversation's chrome.

## State + concurrency model

Pure renderer state. No IPC, no preload bridge, no transport, no async task, no timer, no
`AbortController`, no teardown. Every setter is a synchronous `set` under zustand's own store lock;
there is no `await` inside a write, so there is no check-then-act gap across a suspension point for a
concurrent handler to interleave into. Unidirectional is preserved: read-only selector, store-owned
write paths, and no setter is two-way-bound from a component.

Growth is bounded by the number of distinct `conversationId`s the daemon names since app start, at four
booleans plus one bounded id string per entry. In *this* slice growth is exactly zero — the store has
no writer. #749 adds the eviction paths; the bound is stated here so it is not silently inherited.

## Error handling

There are no failure modes to surface. Every write succeeds: a fact for an unknown id creates the
entry (AC1) rather than rejecting, so there is no miss branch, no `Result` type, and no UI surface.
Every read either finds an entry or reports `null`; `null` is a legitimate value, not an error.

The store is **log-free by construction** — no `console.*` on any path. This is not incidental: the
only value a log line could carry here is the daemon-supplied `conversationId`, and the content-free
diagnostics rule (#126) keeps it out of a file. There is nothing to log anyway; a silent no-match on a
read is the correct behaviour, not a swallowed error.

## Testing strategy

`src/renderer/src/store/conversationActivityStore.test.ts`, plain-function tests over isolated
`createConversationActivityStore()` instances — the `backgroundTaskRosterStore.test.ts` idiom. No
React, no DOM, no bridge, no render. `environment: 'node'` is already global at `vitest.config.ts:27`,
so the file adds no environment pragma.

Scenarios, as behaviour statements:

**AC1 — writes create**
- A fresh store reads `null` for every id.
- `setCompacting('c1', true)` on a fresh store creates `c1`'s entry with `compacting: true` and the
  other three facts `false`.
- **A first write of `false` still creates the entry** — after `setStalled('c1', false)`,
  `selectActivityFor('c1')` is not `null` and reads all-false. (This is the guard's `undefined !==
  false` property; it is the one behaviour a naive same-value guard silently breaks.)
- Each of the four setters writes only its own fact and leaves the other three untouched — one
  scenario per setter, so a copy-paste slip in `writeEntry`'s four call sites fails a named test.

**AC2 — cross-conversation reference stability**
- After writing to `c2`, `selectActivityFor('c1')(state)` returns the *same object reference* as before
  the write (`Object.is`), for a `c1` that already had an entry.
- Two conversations hold independent facts — a write to `c2` never changes what `c1` reads.
- A repeat write of an identical value returns the **same state object** (`Object.is` on the whole
  state), so no subscriber is notified.
- A changing write does produce a new state object and a new entry for that id — the negative control,
  so the same-value guard cannot pass by never writing at all.

**AC3 — the three-way read**
- An id never written reads `null`, and reads `null` even when *other* conversations hold live facts —
  it never returns another conversation's entry.
- An observed-idle entry (`setCompacting('c1', true)` then `setCompacting('c1', false)`) reads as a
  present all-false entry, `not.toBeNull()` — distinct from a never-written id's `null`, asserted
  through the read surface alone.

**AC4 — hostile keys**
- `'__proto__'`, `'constructor'` and `''` each: reading before any write returns `null`; writing
  creates an ordinary entry readable only under that exact key.
- After `setCompacting('__proto__', true)`, an unrelated never-written id still reads `null` — the
  pollution assertion. The write reached no other conversation's entry.
- After that same write, `({} as Record<string, unknown>).someKey` is still `undefined` and
  `Object.prototype` carries no `compacting` property — nothing escaped the store's own keyspace.
- `''` and `'__proto__'` hold *independent* entries and neither aliases the other.

**DI**
- Two stores created by the factory are independent.
- A store starts from an injected initial state.

Type-level coverage rides `npm run typecheck`. Run `npm test` and `npm run build` before handing off.

## Open questions

None blocking. Two decisions recorded so #748 and #749 do not relitigate them:

1. `turnRunning` is a `boolean` written by the bridge, not a `TurnPhase` written into the store —
   because the predicate that derives it lives in a React screen module (see § The turn-running fact).
   If #748 finds it must move `isTurnRunning` to a React-free module to honour that, the move is #748's
   scope, not a change to this store's interface.
2. The four `ConversationActivityEntry` fields are plain, not `readonly`, matching
   `HeldBackgroundTask` (`backgroundTaskRosterStore.ts:147-154`). Immutability is carried by the
   `ReadonlyMap` signal and the copy-on-write convention, as it already is repo-wide. Marking them
   `readonly` would be a lone divergence from three sibling stores for no behavioural gain.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. There is exactly one untrusted input to this module: the
  `conversationId` string, daemon-asserted and used **only** as a `Map` lookup key. The boundary is a
  single named type (`ReadonlyMap<string, ConversationActivityEntry>`) and a single write helper
  (`writeEntry`), not scattered parsing. The id crosses no further: it is never stored *inside* an
  entry (unlike `HeldBackgroundTask.taskId`, which is deliberately redundant for iteration — this store
  has no whole-map iteration, so the key stays in the key position only), never rendered, never
  concatenated, never compared to a secret. The four upstream arms already classify it as a routing
  key and not rendered text (`events.ts:119-124`, `:134-139`, `:157-163`, `:186-193`); this spec
  preserves that classification rather than widening it. Downstream, `selectActivityFor` hands back
  four booleans and no string at all, so the eventual sidebar reader cannot re-derive the untrusted
  text from this store's read surface.

- **[Prototype pollution — the ticket's stated security surface]** No findings; the property holds
  **by construction**, not by validation. `ReadonlyMap` is mandated, `Record<string, …>` and object
  literals keyed by the id are forbidden. `Map.prototype.get('__proto__')` performs no prototype-chain
  lookup and `Map.prototype.set('__proto__', v)` creates an ordinary own entry — so `__proto__`,
  `constructor` and `''` are three unremarkable keys that can neither read nor overwrite another
  conversation's entry nor reach `Object.prototype`. Three consequences are pinned in the spec rather
  than left to the developer's care: (a) the store keys nothing into an object literal; (b) the write
  path uses **no computed object keys at all** — every fact is a property shorthand at a named call
  site, so there is no `{ [x]: v }` construct whose key provenance a reviewer must trace; (c)
  `Object.fromEntries`, spreading the map into an object, and `JSON.stringify` of the map are all
  out — each would re-materialise the hazard the `Map` removes. AC4 also gets explicit tests
  (§ Testing strategy) because holding-by-construction is invisible to the type checker: a future
  developer swapping `Map` for `Record` produces no type error, and only those tests fail. The house
  rule already holds repo-wide — `queueStore.ts:39`, `runSettingsWriteStore.ts:65` and
  `backgroundTaskRosterStore.ts:212` are all `ReadonlyMap`, and no renderer store keys a daemon id into
  a `Record`.

- **[Misattribution / confused deputy]** No findings, and this is the category the upstream tickets
  deliberately deferred here. The threat is a hostile or buggy id causing one conversation's activity
  to be attributed to another — a dot on the wrong sidebar row, or a "thinking" badge on a chat that is
  idle. Two structural defences: the read is a bare `Map.get` with `?? null`, so an unknown id
  produces an explicit no-match and can never resolve to a neighbour's entry; and this module imports
  neither `activeConversationStore` nor anything from `src/renderer/src/screens/`, so the
  `?? activeConversation` fallback the four arms' required `conversationId` was designed to prevent has
  no reference available to write. Constraint stated in § The turn-running fact and asserted by the
  AC3 test that reads `null` for an unwritten id *while other conversations hold live facts*.

- **[Resource exhaustion]** No findings in this slice. An unbounded `Map` keyed on daemon-supplied ids
  is the shape worth naming, and the honest statement is that **this slice has no writer, so growth is
  exactly zero**. Under #748 the bound becomes: distinct ids named since app start × (four booleans +
  one id string bounded by the 65519-byte frame envelope). That is not a plausible exhaustion vector
  from a bounded-frame stream, and the precedent reaches the same conclusion for a much larger payload
  (`backgroundTaskRosterStore.ts:282-290`). No speculative eviction policy is built for a failure
  nobody has observed; the real eviction paths are #749's delete-scoped and pairing-scoped clears.

- **[Error messages, logs, telemetry]** No findings. The store is log-free by construction — no
  `console.*` on any path, and § Error handling states why: the only value a diagnostic could carry is
  the untrusted id, and the content-free diagnostics rule (#126) keeps it out of a file. Read misses
  are silent by design, matching `setUpdatedTask`'s documented silent-miss posture
  (`backgroundTaskRosterStore.ts:364-367`). No error object, no thrown message, no stack trace carries
  the id, because nothing throws.

- **[File / storage operations]** No findings. Nothing here touches disk, and nothing may: no
  `localStorage`, no `sessionStorage`, no IndexedDB, no `userData` file. That is a live rule rather
  than a vacuous one — `defaultWorkspaceStore` and `pushNotificationPrefStore` do persist to
  `localStorage`, so a developer has an in-repo pattern to copy from. Web storage would survive the
  pairing boundary that #749 exists to enforce, and the id is never used as a filename, a cache key or
  a lookup path (CLAUDE.md's rule).

- **[Inter-process / Electron attack surface]** No findings — the design adds none. No
  `contextBridge` API, no `ipcMain` channel, no `BrowserWindow` option, no protocol handler, no
  navigation. This module is pure renderer state and reaches no IPC; the four daemon arms already cross
  the boundary upstream, decoded fail-closed (a missing or non-string `conversation_id` fails the whole
  line — `events.ts:113-117`), so this store receives an already-typed `string` and performs no
  re-validation, correctly: re-checking a fail-closed decode here would be a second, weaker boundary
  competing with the real one.

- **[Cryptographic primitives]** Not applicable — no randomness, no hashing, no key material, no
  comparison against a secret. The one equality comparison in the file is `boolean === boolean` in the
  same-value guard, where constant-time comparison is meaningless: both operands are client-side
  booleans and neither is a secret.

- **[Network & I/O]** Not applicable — no socket, no fetch, no URL, no frame handling, no timeout to
  set. The relay and Noise layers are untouched; the transport stays in the main process
  (CLAUDE.md), and nothing in this ticket moves it.

- **[Concurrency]** No findings. No async task, no timer, no listener, no `AbortController`, nothing to
  cancel on teardown. Every write is a synchronous `set` with no `await` inside it, so there is no
  check-then-act race across a suspension point — the same-value guard reads and writes within one
  `set` callback under zustand's own store lock.

- **[Threat model alignment]** A hostile relay is on-path but content-blind and cannot reach this
  store's inputs except through the Noise session; a hostile daemon inside the session is the actor AC4
  models, and is addressed above. Renderer compromise reaching the transport is unchanged by this
  ticket — the store holds four booleans and no key, token or socket, so it widens no path from the
  renderer toward the main process. **Out of scope, named:** the pairing-boundary clear that stops one
  pairing's activity facts appearing under the next is **#749**; until it lands, this store is written
  by nobody (#748), so no stale-across-pairings state can exist.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
