# #749 — Activity-store eviction: one conversation on delete, all of them when the pairing ends

Child C of #674. Sibling of #747 (the holder) and #748 (the feed, merged as `a609f0d`).

## Files to read first

Codegraph is wired but holds no index for this repo (`.codegraph/` is `.gitignore` + `config.json`, no DB) — every
`codegraph_*` call errors "CodeGraph not initialized". Independently confirmed by #748's code-review ("Done with grep
rather than codegraph: `.codegraph/` holds only config for this repo, no index"). This list is grep/Read-derived.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationActivityStore.ts:84-130` | The state shape, `writeEntry`'s clone-the-outer-map discipline, and the `Object.is`-survivor property at `:118-121`. This is AC1's mechanism — your removal must obey the same rule. |
| `src/renderer/src/store/conversationActivityStore.ts:34-45` | The store's SECURITY header: why `ReadonlyMap` is mandated and `Record` forbidden, and the three hostile keys that follow. Your two new paths inherit it verbatim. |
| `src/renderer/src/store/conversationActivityStore.ts:132-165` | The same-value-guard doctrine on the four setters. AC2 is that doctrine applied to an absent key. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:382` | `resetRosters` — the repo's map-store clear, one line, with the `size === 0` guard. Copy this shape for `clearAllActivity`. |
| `src/renderer/src/store/conversationActivityBridge.ts:150-196` | `subscribeConversationActivity` as shipped, including `:161-164` reserving the `connected` branch for this ticket. |
| `src/renderer/src/store/conversationActivityBridge.ts:198-231` | `ConversationActivityData` — the App-level mount and its positional call site at `:221-227`, the one you convert to a deps object. |
| `src/renderer/src/store/backgroundTaskRosterBridge.ts:118-133`, `:151-155` | The precedent for both halves: a `connected` reset as an early-return subscriber branch, and the argument for why a removal must NOT be folded into a value-returning translator. |
| `src/renderer/src/clearPairingScopedState.ts:25-33` | The documented seam discriminator ("does a reconnect to the SAME daemon need to clear it?") and the list of stores excluded because the `connected` edge already covers them. |
| `src/renderer/src/clearPairingScopedState.test.ts:84-91` | The five-key pin. You do NOT extend it — read it to confirm why leaving it alone is the decision, not an omission. |
| `src/renderer/src/store/conversationDeletedBridge.ts:12-35` | The `conversationDeleted` arm's shape (a bare `string` id, `events.ts:517`) and the `!== null`-not-truthiness doctrine — `''` is a real id the daemon can emit. |
| `src/main/daemonConnection.ts:466-481` | The single site that emits the renderer's `connected`, on Noise `handshake-complete`. This is link 2 of AC3's chain. |
| `src/renderer/src/App.tsx:143-160` | The App-level mount of `ConversationActivityData` (leaf 8). Link 1 of AC3's chain. Not edited by this ticket. |
| `src/renderer/src/store/conversationActivityBridge.test.ts:140-160`, `:215-235` | The two existing `subscribeConversationActivity(...)` call sites you rewrite to the deps object. These are the only two. |
| `src/renderer/src/store/conversationActivityStore.test.ts:22-27`, `:81`, `:204-228` | The hostile-key doctrine, the shared `hostileKeys` constant to reuse, and the read-BEFORE-write assertion order. Your drop-path hostile-key test must keep that ordering. |
| `docs/knowledge/decisions/0007-content-free-diagnostics-by-construction.md` | Why neither new path logs. |

There is no `docs/lessons.md` in this repo, and QMD's `pyrycode-desktop-docs` collection is empty — the `pyrycode-docs`
fallback returns daemon-side Go and is not relevant here.

## Design source

N/A — pure renderer state. Nothing renders from this store yet; #676 owns the sidebar dot that will read it. No visual
surface changes, so the visual-fidelity check is intentionally skipped.

## Context

`conversationActivityStore` (#747) holds four liveness facts per conversation id and `conversationActivityBridge` (#748)
feeds it from four daemon arms. **Nothing removes from it.** Two lifecycle edges must:

- **A conversation the operator deletes.** Its entry outlives it, and since the sidebar draws per conversation, it could
  resurface against a recreated id.
- **The end of a pairing.** The previous server's activity is not a fact about the new one — the cross-pairing leak class
  `clearPairingScopedState` exists to close.

Both are stated as this ticket's in the shipped source: `conversationActivityStore.ts:93` ("No reset: #749 owns both
clears"), `:159` (growth is unbounded "until #749 adds the eviction paths"), and `conversationActivityBridge.ts:161-164`
(the `connected` branch is deliberately absent and reserved here).

## Design

Two production files, both modified, none created.

### 1. `conversationActivityStore.ts` — the eviction API

Two members added to `ConversationActivityStore`, beside the four existing setters:

```ts
dropConversation: (conversationId: string) => void
clearAllActivity: () => void
```

**`dropConversation(conversationId)`** — remove exactly one key.

- Guard first: if `s.entries.has(conversationId)` is `false`, return `s` itself. zustand's `setState` runs
  `Object.is(nextState, state)` before merging, so returning `s` wakes no subscriber. That is AC2, and it is the
  same-value-guard doctrine (`:140-151`) applied to an absent key.
- Otherwise clone the outer map, `delete` the key **on the clone**, return `{ entries: next }`. Never
  `s.entries.delete(...)`. `new Map(s.entries)` copies references, so every surviving entry object is
  `Object.is`-identical to the one held before — that is AC1, and it is exactly the property `writeEntry` already
  documents at `:118-121`.
- `has` rather than `get(...) !== undefined`: an entry is never `undefined`, so both work, and `has` states the intent.
- No `writeEntry` reuse: that helper's contract is "seed-or-read, apply, set". A removal is a different shape with one
  call site; sharing would force a sentinel through it for no gain.

**`clearAllActivity()`** — drop every key. One line, adopted from `backgroundTaskRosterStore.ts:382` verbatim in shape:
guard on `s.entries.size === 0` and return `s`, else return a fresh empty `Map`.

- It deliberately does **not** hand back `initialConversationActivityState`. That exported constant holds a
  module-shared mutable `Map`; returning it as live state would make every store instance that clears share one object.
  The size guard already buys the idempotence that returning a constant would, and the roster store is the precedent for
  choosing the guard.

Naming: `dropConversation` reads against the entry-per-conversation model; `clearAllActivity` carries `All` so the blast
radius is legible at the call site rather than only in the docstring.

Both paths inherit the store's `ReadonlyMap` security posture unchanged — `Map.prototype.has` and
`Map.prototype.delete` perform no prototype-chain lookup, so `'__proto__'`, `'constructor'` and `''` stay three
unremarkable keys by construction. Neither path logs (see § Error handling).

The header at `:159` claims growth is unbounded "until #749 adds the eviction paths" — update that sentence to state the
bound these two paths now establish rather than leaving a citation that says the work is pending.

### 2. `conversationActivityBridge.ts` — the two wirings

**Effects move from positional params to one named deps object.** This closes #748's code-review SHOULD FIX, which was
explicitly assigned forward: *"equally reasonable to carry into #749, which touches this subscriber anyway."* It is not
opportunistic refactoring — it is the function this ticket modifies, and the modification is what makes the positional
list unsafe. The four shipped setters already collapse to one signature `(string, boolean) => void`, so a positional
swap compiles and every test stays green; both members this ticket adds (`(string) => void` and `() => void`) are
*also* assignable into any of those four slots, because a function of fewer parameters is assignable to one of more. The
hazard grows with this ticket, and it is structurally uncoverable: `vitest.config.ts:26-27` is `environment: 'node'`
globally, so no test in this repo runs the effect that does the wiring. It has to be a type error instead, and a named
object makes each effect state its own name beside its own call.

```ts
export interface ConversationActivityDeps {
  setTurnRunning: (conversationId: string, turnRunning: boolean) => void
  setStalled: (conversationId: string, stalled: boolean) => void
  setApiRetrying: (conversationId: string, apiRetrying: boolean) => void
  setCompacting: (conversationId: string, compacting: boolean) => void
  dropConversation: (conversationId: string) => void
  clearAllActivity: () => void
}

export function subscribeConversationActivity(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  deps: ConversationActivityDeps
): () => void
```

`onDaemonEvent` stays positional and first: it is the subscription source rather than an effect, its type is distinct
from every member, and that is the shape of every sibling bridge.

Deliberately **no** `Object.keys(deps).sort()` pin like `clearPairingScopedState.test.ts:84-91`. That pin guards
divergence between two independent call sites, which was the bug that motivated it; there is one call site here, and the
observed failure this object closes is cross-wiring, which the named members close completely. Shipping the pin would be
a defence for a failure mode this seam cannot have.

**Both removals are early-return subscriber branches, ahead of the translator:**

- `event.type === 'connected'` → `deps.clearAllActivity()`, return.
- `event.type === 'conversationDeleted'` → `deps.dropConversation(event.id)`, return.

No truthiness guard on `event.id`. A degenerate `''` is a real value the daemon can emit and a real map key —
`conversationDeletedBridge.ts:32-34` makes exactly this point about the same arm. `dropConversation('')` must run.

The three discriminants are mutually exclusive, so branch order is a readability choice, not a correctness one
(`backgroundTaskRosterBridge.ts:139-140` states this for its own three).

`translateConversationActivity` is **unchanged**, `default: []` included. Neither removal becomes a member of
`ConversationActivityWrite`: every member of that union names a store field and carries its value, and an eviction names
neither. Folding one in would force the return type to describe two unrelated things and destroy the property that the
translator is a pure arm→fact filter — the `backgroundTaskRosterBridge.ts:128-133` argument, adopted rather than
re-derived. A test pins this (§ Testing strategy).

`ConversationActivityData`'s call site becomes a single object literal wiring all six effects to
`conversationActivityStore.getState()`. `App.tsx` is not touched: the component's name, props and mount are unchanged.

### Which seam clears the whole store

The codebase has a documented discriminator rather than a preference — `clearPairingScopedState.ts:30-33`: *"does a
reconnect to the SAME daemon need to clear it?"*

**Yes.** All four facts are liveness: a turn that was running when the socket dropped may have finished while it was
down, and a stall, an API retry or a compaction are equally stale across a gap. A reconnect to the same daemon must not
leave a working dot on a row that is idle. ⇒ **the `connected` edge**, not `clearPairingScopedState`.

That is the same answer, reached the same way, as the closest precedent: `backgroundTaskRosterBridge.ts:118-127` resets
there and records that its store is deliberately excluded from the pairing-scoped set for exactly this reason.

**Consequence:** `clearPairingScopedState.ts` and its five-key pin are untouched. The pin stays green and remains the
tripwire that would catch a future sixth member. Leaving it alone is the decision, not an omission.

### AC3's "covered by consequence" — the chain, demonstrated

Three links, each independently checkable:

1. **The subscriber survives both transitions.** `ConversationActivityData` is mounted app-level (`App.tsx:160`),
   outside `PairedShell`. Unpair flips the App route and unmounts the shell; pair-another-server transitions
   `pairServer` → `list` *inside* the shell and never unmounts it (`clearPairingScopedState.ts:48-51`). Neither
   unmounts an App-level leaf, so one live listener spans both. This link is carried by citation plus `App.tsx`'s
   existing static-render test — **not** by an effect test, because `environment: 'node'` means no test here can run
   that effect. Stated rather than papered over.
2. **Both transitions produce a fresh handshake.** The renderer's `connected` has exactly one emit site,
   `daemonConnection.ts:478`, on Noise `handshake-complete`. Every completed handshake produces it and nothing else
   does; a new pairing dials a new daemon, so it re-handshakes. Already covered transport-side
   (`daemonConnection.test.ts:488`, `:903`, `:964`, `:1111`).
3. **The branch is re-armable, not one-shot.** This is the renderer-side test: write facts → `connected` → assert
   empty → write facts again → `connected` → assert empty again.

#573's AC5 rests on this identical chain and shipped.

## State + concurrency model

One store slice (`conversationActivityStore`), one subscriber. No new async task, no timer, no `AbortController`, no
teardown beyond the existing off-handle that `ConversationActivityData` already returns as its effect cleanup.

Every write is a synchronous `set` under zustand's own store lock with no `await` inside it, so there is no
check-then-act gap across a suspension point — the property `conversationActivityStore.ts:161-164` already asserts,
extended to two more paths. `dropConversation`'s `has`-then-clone and `clearAllActivity`'s `size`-then-replace both run
inside the `set` updater, so the read and the write are one atomic step.

Unidirectional is preserved: read-only selector, one write path per effect, no setter two-way-bound from a component.

Ordering between the removals and the four feeds needs no reasoning: all six ride the one listener and are dispatched in
daemon arrival order. A `conversationDeleted` that arrives after a `turnState` for the same id evicts what the earlier
event wrote, which is the correct reading — the conversation is gone.

## Error handling

No new failure mode. Neither path parses, fetches, or persists; neither can throw. A `dropConversation` for a
conversation the store never held is a silent no-op **by design**, not a swallowed error — it is the expected case,
since the bridge fires for every deletion and most conversations have never produced an activity frame.

**Nothing is logged, on either path.** The only value a diagnostic here could carry is the untrusted `conversationId`,
which ADR 0007's content-free rule forbids, and there is no observed failure to instrument. This matches the store
(`conversationActivityStore.ts:47-49`), the bridge (`:36-39`) and `clearPairingScopedState.ts:77-83`. No `console.*` on
any new branch.

Nothing surfaces in the UI: no banner, no dialog. A row simply stops drawing a dot once #676 reads the store.

## Testing strategy

`npm test` (vitest, `environment: 'node'` globally) plus `npm run typecheck`. Fakes and plain spies, no mocks. Scenarios
as bullets — the developer writes them in the files' existing idiom.

**`conversationActivityStore.test.ts`:**

- Drop removes only the named entry — seed three conversations, drop one, assert the other two are read back
  `Object.is`-identical to the objects held before the drop (AC1).
- Drop does not mutate the previous map — capture `getState().entries` before the drop, and after it assert the captured
  map still `has` the dropped id and is not the same object as the new one. *This is the assertion that catches an
  in-place `s.entries.delete(...)`; the identity assertion above does not, because an in-place delete leaves survivors
  trivially identical.*
- Drop of an absent key notifies nobody — register a `store.subscribe` counter **before** the call and assert it stays
  at 0 (AC2). A negative control, per the store's own review history: a no-churn claim is unfalsifiable without one.
- Drop removes rather than zeroes — after dropping, `selectActivityFor(id)` is `null`, and a subsequent
  `setStalled(id, false)` re-creates the entry as a fresh all-false one.
- Drop of the hostile keys — reuse the file's existing `hostileKeys` constant (`:81`). **Read back first** to confirm
  the key reads as `null` before any write, then seed through a setter, then drop, then assert `null` again and that
  `Object.prototype` is unpolluted. The read-before-write ordering is load-bearing — it is the only thing that would
  distinguish the `Map` from a `Record` if someone later swapped them — and must match the existing block at
  `conversationActivityStore.test.ts:204-228`.
- `clearAllActivity` empties a populated store — `entries.size` is 0 and `selectActivityFor` is `null` for each
  previously held id.
- `clearAllActivity` on an already-empty store notifies nobody — same subscriber-counter negative control.
- The store is not latched after a clear — a setter called afterwards creates its entry normally.

**`conversationActivityBridge.test.ts`:**

- A `conversationDeleted` event calls `dropConversation` with the event's own `id` and calls no setter and no
  `clearAllActivity`.
- A `conversationDeleted` carrying `id: ''` still calls `dropConversation('')` — the falsy id is not skipped.
- A `connected` event calls `clearAllActivity` and calls nothing else.
- Neither removal comes from the translator — `translateConversationActivity` returns `[]` for both a `connected` and a
  `conversationDeleted` event. This pins the "removals are subscriber branches" decision so a later refactor into the
  write union fails a test rather than passing silently.
- Real-store seam (AC1 + AC3 together): drive the subscriber over a fresh store instance — feed arms for two
  conversations, deliver `conversationDeleted` for one, assert it is gone and the other's entry is `Object.is`-identical
  to before; then deliver `connected` and assert empty; then feed arms again, deliver a second `connected`, and assert
  empty again (the re-armable demonstration).
- The two existing call sites (`:148`, `:225`) are rewritten to the deps object; their assertions are unchanged.

**Mutation checks to run before opening the PR** (the #748 precedent — verify the load-bearing tests can fail):

- Replace `dropConversation`'s `has` guard with an unconditional clone ⇒ the absent-key no-churn test must fail.
- Replace the clone+delete with an in-place `s.entries.delete(id)` ⇒ the previous-map test must fail.
- Drop `clearAllActivity`'s `size === 0` guard ⇒ the empty-store no-churn test must fail.

Use a `cp` backup rather than `git checkout` for files that may be untracked.

## Open questions

None blocking. Two things recorded as decided rather than open:

- The delete seam is the bridge's own `conversationDeleted` branch, **not** `PairedShell.tsx:230-235`. The ticket names
  the existing `useConversationDeletedExit` subscription as context; it is the wrong home for this. Its callback runs
  `exitActiveConversation`, which gates on the id matching the open conversation — but eviction must be **ungated**,
  since the whole point is that a background conversation loses its dot. A developer adding the drop inside that gated
  helper would ship a version where only the open conversation is ever evicted, and no existing test would catch it.
  The bridge's branch is also App-lifetime, where `PairedShell`'s is shell-lifetime. A third listener on
  `conversationDeleted` is correct, not a duplicate — `conversationDeletedBridge.ts:37-42` documents exactly this
  arrangement for listeners touching disjoint state.
- The four-arm feed, `translateConversationActivity`, `clearPairingScopedState`, `PairedShell.tsx` and `App.tsx` are all
  out of scope and unmodified.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Both new paths take one already-typed field across an existing boundary:
  `conversationDeleted`'s `id` is decoded and narrowed upstream (`events.ts:517`) and reaches `dropConversation` as a
  `string` used **only** as a `Map` key — never stored inside an entry, never rendered, never concatenated, never a
  filename, a cache key, a URL or an attribute, and never compared against a secret. It is a *value* on the way to
  `Map.prototype.delete`, never a computed object key, so there is no `{ [x]: v }` whose provenance a reviewer must
  trace. `clearAllActivity` takes no argument at all and so crosses no boundary. The store's `ReadonlyMap` mandate
  (`conversationActivityStore.ts:34-45`) is what makes `'__proto__'`, `'constructor'` and `''` ordinary keys by
  construction rather than by validation: `Map.prototype.has`/`delete` perform no prototype-chain lookup. A future swap
  of `Map` for `Record` still produces no type error — the drop-path hostile-key test in § Testing strategy extends the
  existing tripwire to this ticket's paths, with the same read-before-write ordering that makes it actually
  discriminating.
- **[Tokens, secrets, credentials]** Not applicable, and by construction rather than by assertion: this ticket adds no
  storage, no persistence and no new state field. It only *removes* from an in-memory map holding four booleans per
  entry. `conversationActivityStore.ts:49-51` already forbids `localStorage` for this store precisely because web
  storage would survive the pairing boundary — this ticket enforces that boundary and must not weaken it. Reject any
  implementation that persists the eviction or the map.
- **[File / storage operations]** Not applicable — no filesystem path, no `fs` call, no temp file, no `safeStorage`, no
  web storage of any kind is reachable from either path. The untrusted `conversationId` never becomes a path segment;
  the store header pins that it never becomes a filename.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain` channel and no
  `webPreferences` are added or changed. Both new branches sit inside an existing renderer subscriber that consumes an
  already-typed `DaemonEvent` through the preload bridge; nothing here touches `ipcRenderer`, a socket, a key or a raw
  frame. Process placement is unchanged and correct — this is renderer-only state and holds nothing a renderer
  compromise could escalate with.
- **[Cryptographic primitives]** Not applicable — no RNG, no hashing, no key material, no comparison against a secret,
  no Noise code. The `connected` branch *reads only the discriminant* and deliberately ignores `event.ack`, so the
  hello-ack payload never enters this path (the `backgroundTaskRosterBridge.ts:125` posture).
- **[Network & I/O]** Not applicable — no socket, no frame, no timeout, no URL, no reconnect policy is introduced. The
  ticket consumes an existing event stream and adds no I/O. Worth naming: the `connected` branch fires on *every*
  handshake, and a hostile or flapping relay can therefore drive repeated clears. That is bounded work (one `size`
  check, at worst one empty-map allocation), it is idempotent, and it fails **safe** — the degenerate outcome is an
  empty activity map, which is the absence of a claim rather than a false one.
- **[Error messages, logs, telemetry]** No findings, and this is the one category with a live hazard: the only useful
  diagnostic on either path would carry the untrusted `conversationId`, and the renderer console is readable by anything
  that can open DevTools. Both paths are therefore log-free by construction — no `console.*` on any new branch, matching
  `conversationActivityStore.ts:47-49`, `conversationActivityBridge.ts:36-39` and `clearPairingScopedState.ts:77-83`,
  and honouring ADR 0007. **Specific instruction to the developer:** do not add a "dropped an unmatched delete" or
  "cleared N entries" line, however tempting the silent no-op makes it. The count is as disclosive as the id here,
  because it reveals how many conversations the previous pairing was running.
- **[Concurrency]** No findings. No long-lived async task, timer or `AbortController` is added; the one listener already
  has an owner and a cleanup (`ConversationActivityData`'s effect returns the off handle, so a StrictMode double-mount
  nets exactly one live listener). There is no check-then-act race: both guards run **inside** the zustand `set`
  updater, synchronously, with no `await` in the critical section, so no concurrent handler can interleave between the
  `has`/`size` read and the write. No duplicate subscription is created — the third `conversationDeleted` listener is a
  distinct subscriber on the same channel, not a second socket.
- **[Threat model alignment]** Addressed, and this ticket is a *net reduction* in exposure on two of the four named
  desktop threats. **Cross-pairing leak:** the `connected` clear is the enforcement, and § Design demonstrates rather
  than assumes that both pairing-change paths reach it. **Hostile daemon response:** a daemon that emits
  `conversationDeleted` for an id it never owned, or floods them, can at worst delete entries from a renderer-local
  liveness map — it can neither read state nor cause unbounded work, and the map is one the same daemon fed in the first
  place. **Unbounded growth:** `conversationActivityStore.ts:159` records the map as unbounded until this ticket; the
  two paths bound it, though not completely — a long-lived pairing that names many conversations without deleting them
  still accumulates entries between handshakes. That residue is four booleans plus one bounded id string per
  conversation named since the last handshake, it is explicitly **OUT OF SCOPE** here, and #676 (the sidebar reader) is
  the natural place to revisit it if a real ceiling is ever wanted. **Renderer compromise reaching the transport:**
  unchanged — nothing in this ticket moves toward the transport.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
