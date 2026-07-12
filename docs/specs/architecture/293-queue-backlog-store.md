# Spec #293 — Hold the queued backlog in app state (replacement-truth queue store)

Split from #145. Depends on #292 (merged): the `queueState` IPC daemon event arm carrying
`conversationId` + the ordered `readonly QueuedItem[]` backlog. This slice is the **renderer state
layer** the render slice (#294) reads and that #197 (reconcile-on-connect) builds on. No UI.

## Files to read first

- `src/renderer/src/store/sessionIdStore.ts` (whole, ~59 lines) — **the primary shape template**: a
  dedicated DI-factory → singleton → hook → selector store with a single set-on-value mutation and a
  `null`-vs-real-value initial state. The queue store is this, but keyed by `conversationId` and
  holding a `readonly QueuedItem[]` per key instead of a bare string.
- `src/renderer/src/store/sessionIdBridge.ts` (whole, ~73 lines) — **the bridge template**:
  reactive-only (no request half), one owned arm via `translateX`, `default: null` filter,
  `if (x !== null) setX(x)` subscribe, headless `XData` container mounted app-level. The queue bridge
  is a field-for-field analogue.
- `src/renderer/src/store/runSettingsWriteStore.ts:56-71, 118-122` — **the Map-in-Zustand copy-on-write
  idiom**: `pending: ReadonlyMap<...>` in state, `new Map()` initial, `const next = new Map(prev);
  next.set(...); return { ...state, pending: next }` on write. The queue store's `setBacklog` copies
  the same way. (This store uses a reducer for its three transitions — the queue store needs only a
  single setter, so mirror the *Map handling*, not the reducer.)
- `src/renderer/src/store/conversationListStore.ts:22-64` — the "hold wire rows verbatim, no camelCase
  remap, null-vs-`[]` distinction pushed to the read boundary" rationale. `QueuedItem` is held verbatim
  (snake_case) exactly as `ConversationSummary` is.
- `src/shared/ipc/events.ts:145-154` — the `queueState` DaemonEvent arm (`{ type: 'queueState';
  conversationId: string; queued: readonly QueuedItem[] }`) and its design commentary, including the
  authoritative directive **"the #293 store keys its backlog by it"** and the plain-text/no-HTML
  render constraint inherited by #294 (this slice has no DOM sink).
- `src/shared/wire/types.ts:325-356` — `QueuedItem` (`{ queued_msg_id: number; text: string; ts:
  string }`, all always present, `queued_msg_id` decodes as a NUMBER) and `QueueStatePayload`
  commentary: `queue_state` is an **UNSOLICITED REPLACEMENT-truth snapshot** (whole current backlog,
  `[]` when empty — never null/omitted), enqueue-ordered, **daemon STATE not turn-stream** (do not fold
  into the timeline reducer).
- `src/renderer/src/App.tsx:99-110` — the app-level headless-leaf mount block
  (`<ConversationListData /><SessionIdData /><RunSettingsWriteData />`). `<QueueData />` joins it as a
  fourth sibling.
- `src/renderer/src/store/sessionIdStore.test.ts` + `src/renderer/src/store/sessionIdBridge.test.ts`
  (whole) — the exact test idioms to mirror (plain-function store tests over `createX()` instances;
  framework-free bridge tests with an injected `fakeBridge()` spy; server-render-to-`''` container test).
- `src/renderer/src/store/daemonEventBridge.ts:98`, `timelineBridge.ts:103`, `modalBridge.ts:82` —
  confirm (read-only) that all three exhaustive bridges **already** `case 'queueState': return null`
  (landed in #292). **This ticket does NOT touch them.** The queue bridge is a fourth *independent*
  subscriber (the sessionIdBridge / conversationListBridge precedent), so it uses `default: null`, not
  the exhaustive-`assertNever` list.

## Context

Each `queue_state` event carries the **whole** current backlog for a conversation — a snapshot, not a
delta. This slice reflects that into renderer state so #294 can render it and #197 can reconcile it on
reconnect. `queue_state` is daemon **state** (SSOT pyrycode #720), not part of claude's turn stream, so
it gets its own store — never the thread-timeline reducer.

**Why keyed by `conversationId` (not a single flat backlog).** Two pieces of merged evidence force
keying:

1. `src/shared/ipc/events.ts:148-149` states the design intent directly: the arm carries
   `conversationId` *"because the snapshot is REPLACEMENT-truth and the #293 store keys its backlog by
   it."*
2. Daemon #878/#879 (reconcile-on-connect): on (re)connect the daemon **unicasts one `queue_state` per
   non-empty conversation, keyed by `conversation_id`** — so *multiple* `queue_state` events for
   *different* conversations can arrive in sequence. A flat "hold the last snapshot" store would let
   conversation B's snapshot clobber conversation A's. Keying holds each conversation's backlog
   independently; each `queue_state` is replacement-truth for *its own* key only.

This is not a speculative defense (Evidence-Based Fix Selection): the multi-key case is documented
merged daemon behavior and the wire deliberately carries the key. A flat store would be *incorrect*
against the contract, not merely less defensive. The ticket's technical note ("guard against / **key
by** it") authorizes exactly this.

## Design

Two new renderer files + a two-line mount edit. All under `src/renderer/src/store/` (pure renderer
state — no IPC, no preload, no transport, no crypto/sockets/tokens).

### `src/renderer/src/store/queueStore.ts` (new)

The keyed backlog holder. Mirrors `sessionIdStore`'s DI-factory → singleton → hook → selector
structure and `runSettingsWriteStore`'s `ReadonlyMap` copy-on-write, but with a single setter (there is
exactly one mutation — "record the latest snapshot for a conversation" — so a discriminated-union
action set would be a one-member union; ceremony without benefit, per the sessionIdStore rationale).

Contracts (define these; do **not** write full bodies):

- `QueueSnapshot` — the write unit = the `queueState` arm minus its `type` tag:
  `{ conversationId: string; queued: readonly QueuedItem[] }`. Imported from here by the bridge.
- `QueueState` — `{ backlogs: ReadonlyMap<string, readonly QueuedItem[]> }`. `ReadonlyMap` signals the
  setter replaces, never mutates in place.
- `QueueStore` = `QueueState & { setBacklog: (snapshot: QueueSnapshot) => void }`. `setBacklog` is the
  sole write path; the read surface is selectors only (unidirectional, AC4).
- `initialQueueState: QueueState = { backlogs: new Map() }`. An empty Map = "no snapshot seen for any
  conversation yet" (AC3).
- `createQueueStore(init = initialQueueState)` — DI-friendly, React-free `createStore`. `setBacklog`'s
  behavior: **copy-on-write** — `const next = new Map(s.backlogs); next.set(snapshot.conversationId,
  snapshot.queued); set({ backlogs: next })`. `queued` is stored **verbatim, by reference** (the wire
  array — enqueue order and identity preserved; no coercion, no validation, mirroring
  conversationListStore holding wire rows as-is). Unconditional: an empty `queued: []` sets that key to
  `[]` (replacement-truth "the daemon says this conversation's backlog is now empty" — AC2 clear case),
  it does **not** delete the key.
- `queueStore` — app-wide singleton the bridge writes and #294 reads.
- `useQueueStore<T>(selector)` — the narrow-slice React binding (the `useStore(store, selector)` idiom).
- Read surface (selectors — the only read path, never two-way-bound):
  - `EMPTY_BACKLOG: readonly QueuedItem[] = []` — a module-level constant (a *stable reference*, so the
    empty-default never churns re-renders).
  - `selectBacklogFor(conversationId: string) => (s: QueueState): readonly QueuedItem[]` — a **selector
    factory**: `s.backlogs.get(conversationId) ?? EMPTY_BACKLOG`. This is the primary read surface for
    #294 and the AC3 empty-default. Narrow-slice-correct: a `setBacklog` for a *different* conversation
    produces a new Map but `newMap.get(openId)` returns the *same* array reference → `Object.is` true →
    no re-render of the component watching `openId`.
  - `selectBacklogs(s: QueueState): ReadonlyMap<string, readonly QueuedItem[]>` — the whole map, for
    #197 (which will need to iterate all held backlogs to clear stale ones on reconnect). Not used by
    #294.

### `src/renderer/src/store/queueBridge.ts` (new)

The reactive-only renderer data path. Field-for-field analogue of `sessionIdBridge.ts`. Nothing here
touches keys, sockets, `ipcRenderer`, or raw frames — it subscribes through the preload bridge and
dispatches an already-typed event.

Contracts:

- `translateQueueState(event: DaemonEvent): QueueSnapshot | null` — `switch (event.type)`:
  `case 'queueState': return { conversationId: event.conversationId, queued: event.queued }`;
  `default: return null`. A **fresh named-field literal** (the modalBridge idiom — never `return
  event`, never a spread), so it stays immune to the `DaemonEvent` arm gaining an unrelated field
  later; `queued` passes through by reference. `default: null` (not the exhaustive `assertNever` list)
  because ignoring every other arm is this path's intended permanent behavior — it is the *fourth*
  independent subscriber, not one of the three typecheck-gating exhaustive bridges (the sessionIdBridge
  / conversationListBridge posture).
- `subscribeQueue(onDaemonEvent, setBacklog): () => void` — `onDaemonEvent((event) => { const snapshot
  = translateQueueState(event); if (snapshot !== null) setBacklog(snapshot) })`, returning the exact
  off-handle from `onDaemonEvent` as the cleanup. Injected `onDaemonEvent` + `setBacklog` keep it
  React-free and unit-testable with plain spies. The listener only translates + dispatches — it never
  throws into React.
- `QueueData(): null` — the headless container, mounted app-level. One subscribe effect on mount
  returning `subscribeQueue(window.pyry.onDaemonEvent, (s) => queueStore.getState().setBacklog(s))` as
  its cleanup (so a StrictMode double-mount nets exactly one live listener — the sessionIdBridge idiom).
  Reactive-only: **no** request effect, **no** `useState`/`useRef`/`useSessionStore` (queue_state is
  unsolicited; the connect-time snapshot is #197's concern, not this slice's). `window.pyry` is
  dereferenced only inside the effect, never during render, so it server-renders to `''` without a
  bridge mock. Renders nothing.

### `src/renderer/src/App.tsx` (modified — 2 lines)

Add `import { QueueData } from './store/queueBridge'` and mount `<QueueData />` as a fourth headless
sibling in the fragment alongside `<SessionIdData />` (App.tsx:100-103). Same app-level
always-listening rationale as SessionIdData: a `queue_state` marker can arrive before #294's render
slice is ever mounted, so the store must stay live regardless of route. No other change — the mount is
purely additive; App's server-render-to-`''` invariant is preserved (QueueData derefs `window.pyry`
only inside its effect).

## State + concurrency model

- **Single store slice**, orthogonal to `sessionStore` / `timelineStore` / `modalStore` /
  `conversationListStore` / `runConfigStore` / `sessionIdStore` / `runSettingsWriteStore` (Strangler
  Fig, ADR 0009). A `queue_state` arrival re-renders only components selecting a backlog slice.
- **One write path** (`setBacklog`), invoked only by the subscription wiring — never two-way-bound from
  a component (AC4). Read only through selectors.
- **Replacement truth, per key.** Each `queue_state` replaces *its conversation's* entry wholesale via
  copy-on-write. No merge, no append, no dedupe across events — the held list for a key is always
  exactly the latest snapshot's `queued` (AC2). Empty `[]` = that conversation's backlog is now empty.
- **Subscription lifecycle:** one app-lifetime listener via `QueueData`'s single effect; cleanup is the
  `onDaemonEvent` off-handle (StrictMode-safe, one net listener). No `AbortController` — teardown is the
  React effect cleanup, matching every sibling bridge.

## Error handling

No new failure modes. This slice consumes an already-decoded, already-typed `queueState` event (#292
owns the fail-closed decode at the transport). The store never validates or coerces — it holds the
daemon's `queued` verbatim (`queued_msg_id` is already a `number` per #292's decode; `text`/`ts` are
opaque strings). The bridge's `translateQueueState` cannot throw. There is no network / socket / parse
surface here. **Inherited constraint for #294 (not enforced here — no DOM sink):** `text` is untrusted,
client-originated transit content relayed by a content-blind relay — the render slice must render it as
**plain text, never HTML** (no `innerHTML` / `dangerouslySetInnerHTML`).

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Two new test files, mirroring the sessionId pair exactly.
Write scenarios as described; use the project's existing test idioms (plain-function store tests over
`createQueueStore()` instances; framework-free bridge tests with an injected `fakeBridge()` capturing
the listener and returning an `off` spy; `renderToStaticMarkup` for the container). A shared
`QueuedItem[]` fixture (e.g. `[{ queued_msg_id: 1, text: 'a', ts: '2026-07-10T00:00:00Z' }, ...]`)
keeps cases readable.

### `queueStore.test.ts` (plain-function, no React)

- **Initial-empty (AC3):** a fresh `createQueueStore()` has `backlogs.size === 0`;
  `selectBacklogFor('c1')(state)` deep-equals `[]` (and is the stable `EMPTY_BACKLOG` reference).
- **Records a snapshot (AC1):** `setBacklog({ conversationId: 'c1', queued: items })`;
  `selectBacklogFor('c1')` returns `items` verbatim (same reference, same order).
- **Replacement — most recent wins, whole-value replace (AC2):** set `c1 = [a, b]`, then `c1 = [b]`
  (item `a` removed); `selectBacklogFor('c1')` is `[b]` — the removed entry is gone, order follows the
  event, no merge.
- **Clear-on-empty (AC2 clear case):** set `c1 = [a, b]`, then `c1 = []`; `selectBacklogFor('c1')`
  deep-equals `[]`. Assert the key is still handled (reads empty) — not that it must be deleted.
- **Keyed independence — the #878 correctness proof (AC2 "for the same conversation"):** set `c1 = [a]`,
  then `c2 = [b]`; `selectBacklogFor('c1')` is still `[a]` and `selectBacklogFor('c2')` is `[b]` — a
  snapshot for one conversation never clobbers another's.
- **Narrow-slice reference stability:** capture `selectBacklogFor('c1')(state)`, then `setBacklog` for
  `c2`; the `c1` result is the *same* reference (`Object.is` true) — proves a foreign-key write won't
  re-render a `c1` watcher.
- **DI isolation:** two `createQueueStore()` instances are independent; one's write doesn't leak into
  the other. `initialQueueState` deep-equals `{ backlogs: new Map() }`. `setBacklog` reference is stable
  across updates.

### `queueBridge.test.ts` (framework-free + one server-render check)

- `translateQueueState` maps a `queueState` event to `{ conversationId, queued }` (deep-equal; `queued`
  is the same reference).
- `translateQueueState` returns `null` for a sample of unrelated events (`connecting`, `disconnected`,
  `messageReceived`, `snapshotReceived`, `conversationsReceived`, `sessionTransition`).
- `subscribeQueue` subscribes exactly once.
- On a `queueState` event, `setBacklog` is called once with the translated snapshot.
- On a second `queueState` for a **different** conversation, `setBacklog` is called again with that
  snapshot (last-write-does-not-clobber, verified end-to-end against a real `createQueueStore()` seam:
  both backlogs readable afterward).
- An **empty** `queued: []` event still calls `setBacklog` (the `!== null` guard, not truthiness — an
  empty snapshot is a real replacement).
- Does **not** call `setBacklog` for an unrelated event.
- Returns the `off` handle from `onDaemonEvent` as the cleanup (calling it invokes `off` once).
- Seam: drives a real `createQueueStore()` from empty → held on a `queueState` emit
  (`selectBacklogFor` reflects it).
- `QueueData` server-renders to empty markup without touching `window.pyry` (the SessionIdData idiom).

Type-level coverage (`npm run typecheck`): `ReadonlyMap` in `QueueState` rejects in-place mutation at
call sites; `QueueSnapshot` shared between store setter and bridge translate keeps the two in lockstep.

## Scope / size

Production source files (`.ts`/`.tsx`, excluding tests + the spec): **queueStore.ts (new),
queueBridge.ts (new), App.tsx (modified) = 3.** Under the §4 gate (≥5). New exported types:
`QueueSnapshot`, `QueueState`, `QueueStore` = 3. Under 5. Est. total written LOC (production + tests +
mount): ~350. Reactive-only, no request half, no state-machine reject branches, no edit fan-out (App.tsx
is the only existing file touched, additively; the three exhaustive bridges already handle `queueState`
from #292). Comfortably **size:s**. No split.

Not `security-sensitive` (pure renderer state; no crypto/sockets/tokens; the untrusted-input trust
boundary is #292's fail-closed decode, already merged) → no security-review pass. No `## Figma` section
and no UI surface (headless store + bridge, renders nothing) → no Design source section.

## Open questions

- **Who supplies the "open conversation id" to #294?** `selectBacklogFor(id)` is parameterized because
  this store deliberately does not own "which conversation is open" (nav/route concern). #294 must
  source that id (from the conversation route / nav state) when it reads the backlog. Out of scope for
  #293 — flagged so #294's architect resolves it, not this developer.
- **Stale-backlog eviction on reconnect** (a conversation that *became* empty won't get a fresh
  `queue_state` on reconnect, since the daemon unicasts only *non-empty* backlogs per #878/#879) is
  **#197's** job, built on `selectBacklogs` (the whole-map read surface provided here). This slice
  intentionally keeps every key it is told about; it does not prune.
