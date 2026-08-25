# #775 — Hold a last-read mark per conversation, keyed by conversation id

**Size:** S (PO's `size:s` held). One new production file, one new test file, no edits to existing files.

## Design source

N/A — this slice renders nothing. #676 owns the green "New messages" dot and carries the Figma reference.

## Files to read first

Codegraph is wired but **not indexed** for this repo (`.codegraph/` holds only `.gitignore` + `config.json`, no
DB; every `codegraph_*` call errors "CodeGraph not initialized", verified 2026-08-24). This list was built by
direct reads, not `codegraph_context`.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationActivityStore.ts` (whole file, 265 lines) | **The template.** Read it end to end — this ticket is the same shape with one write path instead of six. Structure (DI factory → singleton → hook → selector factory), the `ReadonlyMap` mandate and its security rationale (`:36-47`), the absent-vs-observed distinction (`:86-93`, `:238-265`), the "no whole-map selector" rule (`:258-260`), the growth-bound refusal (`:163-167`), and the first-write-of-`false` property (`:148-152`) — this spec's numeric analogue of that last one is AC3's whole mechanism. |
| `src/renderer/src/store/conversationActivityStore.test.ts` | The test-file shape to copy: isolated store per test via the factory, hostile-key round-trips, `Object.is` identity assertions on untouched entries. |
| `src/renderer/src/store/conversationTimelineStore.ts:113-123`, `:371-400` | The second keyed precedent (#755). `:115-120` is the absent-vs-present-empty paragraph; `:371-400` is `selectTimelineFor` with the `?? null` posture, the three-readings table and the "no whole-map read surface" refusal (`:392-395`). `:113` (`MAX_RETAINED_TIMELINES = 10`) is the bound this store deliberately does **not** copy — see § The bound question. |
| `src/renderer/src/store/backgroundTaskRosterStore.ts:282-289`, `:395-424` | The third keyed precedent and the origin of both rules the other two adopt: the growth-bound refusal (`:282-289`) and the three-readings selector doctrine (`:398-413`), narrow-slice re-render property (`:415-417`), unread-read-surface rule (`:418-419`). |
| `src/renderer/src/store/threadTimeline.ts:189-200`, `:289-300`, `:604-624` | `TimelineState.items` (`:191`) — the quantity a mark is a sample of. Confirm `reduceTimeline` only ever spreads into a fresh array and that `items` grows by append. |
| `src/shared/ipc/events.ts:130`, `:141` | The two turn-stream arms carrying `conversationId`. Read only to confirm **no time field exists on any arm** — that fact is why the mark is client-originated. Do not import anything from here; this store has no IPC. |
| `src/renderer/src/activateConversation.ts:60-80` | Where #777 will stamp. Note the id-change gate at `:74-77` — nothing to change here in this ticket, but it explains why `recordLastRead` takes an explicit value rather than deriving one. |
| `CLAUDE.md` § Conventions, § Don't | Test-first, unidirectional state, sealed shapes, no persistence in this slice, no adjacent refactoring. |
| `docs/knowledge/INDEX.md` | Locate the #747 / #755 knowledge notes if more background on the keyed-store family is wanted. Read-only. |

Do **not** read `src/main/` or `src/preload/` — this slice touches neither.

## Context

Nothing in this app tracks read state. `ConversationSummary` (`src/shared/wire/types.ts:917-925`) carries
`last_message_ts` and `last_used_at` but no read cursor, and the daemon has no concept of one. A last-read
mark is a client-side fiction, per-installation, and it is the missing half of the unread feature.

This ticket is the **holder only** — the in-memory slice and its read surface. It ships dormant, exactly as
#747 and #755 did before their feeds landed. #776 persists it, #777 writes it, #778 derives an unread
predicate from it, #779 clears it at the pairing boundary, and #676 draws the dot.

### The recorded value's shape — decided here

The ticket body rules out the daemon-timestamp framing and hands the choice to this spec. **The mark is a
count of timeline items seen: a plain `number`, client-originated, sampled from the conversation's own
timeline.** The reasoning, because #777 and #778 both inherit it and cannot revisit it cheaply:

- **A client clock reading is unusable.** #778 must decide "is there content newer than the mark?" for a
  conversation that is **not** open. That needs a live per-conversation *arrival* quantity to compare
  against. No timestamp exists anywhere the renderer can reach — not on any IPC arm, not in
  `ConversationActivityEntry` (four booleans), and `last_message_ts` does not move on message arrival. A
  clock-reading mark would force #778 to invent a second per-conversation holder, and #777's AC4 ("content
  arriving for a conversation that is not the open one leaves that conversation's mark untouched") forbids
  #777 from writing one. Dead end.
- **The comparand already exists.** `conversationTimelineStore`'s per-conversation `items`
  (`threadTimeline.ts:191`) has been fed per conversation since #756 merged. #778's own Technical Notes
  anticipate riding it. `items.length` is the only live per-conversation quantity in the renderer that
  moves on content arrival.
- **`items.length` is append-only per keyed slice.** `reduceTimeline`'s `reset` arm truncates to `[]`
  (`threadTimeline.ts:540-551`), but `reset` is dispatched **only** to the flat `timelineStore`, at
  `activateConversation.ts:75`. The bridge routes only the eight id-carrying arms into the keyed store via
  `dispatchFor` (`timelineBridge.ts:349`), and none of them is `reset`. So while a keyed slice is held, its
  count only grows. The one discontinuity is eviction — see § Open questions.
- **Item identity was considered and does not exist.** `ThreadItem` (`threadTimeline.ts:40-92`) has no
  stable per-item id across kinds: `userText` and `unrecognizedMessage` carry none, and `turnId` repeats
  across every item in a turn. A positional count is the only workable marker over `readonly ThreadItem[]`.

The value's meaning is carried by the parameter name (`itemsSeen`) and by `LastReadMark`'s docstring. It is
**not** enforced by the type system, and this spec does not ask for a branded type: the repo's posture is
plain primitives at named call sites (`setTurnRunning(id, boolean)`), and a brand would buy nothing here
because there is exactly one writer.

### Why AC3 gets sharper under a number, not softer

Under a timestamp, "never read is its own state" reads like boilerplate. Under a count it is the ticket's
one real trap: **`0` is a producible mark.** Opening a conversation whose timeline is empty stamps `0`. So
"absent" and "`0`" must stay distinct at the read boundary, and the mechanism is `??`, not `||`.

## Design

### Module structure

One new file, `src/renderer/src/store/conversationLastReadStore.ts`, following the #747 / #755 structure
verbatim: DI factory → app-wide singleton → React hook → selector factory. Framework-free, no React and no
DOM in the module, so it unit-tests under the `node` environment.

No existing file is modified. Nothing imports the new module yet.

### Types and store contract

Contract sketch — signatures only; the developer writes the bodies:

```ts
/** A count of timeline items the operator has seen in one conversation. Client-originated. */
export type LastReadMark = number

export interface ConversationLastReadState {
  marks: ReadonlyMap<string, LastReadMark>
}

export type ConversationLastReadStore = ConversationLastReadState & {
  recordLastRead: (conversationId: string, itemsSeen: LastReadMark) => void
}

export const initialConversationLastReadState: ConversationLastReadState
export function createConversationLastReadStore(init?: ConversationLastReadState): /* zustand vanilla store */
export const conversationLastReadStore: /* the singleton */
export function useConversationLastReadStore<T>(selector: (s: ConversationLastReadStore) => T): T
export const selectLastReadFor: (conversationId: string) => (s: ConversationLastReadState) => LastReadMark | null
```

Behaviour, one line each:

- `recordLastRead(conversationId, itemsSeen)` — replace that key's value, cloning the outer map. A key
  absent from the map is **created**, unconditionally, including a first record of `0` (AC1). Same-value
  guard: when the held value is already `===` the incoming one, return the state **object** so zustand's
  `Object.is` short-circuit fires and no subscriber wakes — the `conversationActivityStore.ts:148-157`
  doctrine.
- `selectLastReadFor(id)` — `s.marks.get(id) ?? null`. Two readings stay distinct: `null` = never read,
  a `number` (including `0`) = read up to that many items.

`ReadonlyMap` is **mandatory** and `Record<string, …>` is **forbidden**, for the reason
`conversationActivityStore.ts:36-47` and `conversationTimelineStore.ts:51-63` both state and this spec
adopts rather than re-derives: `Map.prototype.get('__proto__')` performs no prototype-chain lookup and
`Map.prototype.set('__proto__', v)` creates an ordinary own entry, so `__proto__`, `constructor` and `''`
are three unremarkable keys **by construction rather than by validation** (AC4). Three consequences, none
of which is a type error: nothing is keyed into an object literal, there are no computed object keys on the
write path, and `Object.fromEntries` / spreading the map into an object / `JSON.stringify` of the map are
all out — each re-materialises the hazard the `Map` removes. Note for #776: that last one constrains how
persistence encodes the map, and #776 owns solving it without reintroducing the hazard.

### The two traps this file has that the precedents do not

Both are specific to holding a **number** where the precedents hold objects, both compile clean, and neither
breaks any test unless one is written for it. They are the reason this spec exists.

1. **`||` in the selector collapses AC3.** `s.marks.get(id) || null` yields `null` for a real mark of `0`,
   with the same `LastReadMark | null` return type. The selector **must** use `??`. Assert it directly.
2. **A falsy-shaped write guard collapses AC1.** `!s.marks.get(id)`, or `(s.marks.get(id) ?? -1) === itemsSeen`,
   or any guard that treats `0` as "absent", drops a first record of `0`. The guard must be `===` against
   the raw `get` result, so `undefined === 0` is `false` and the create path runs — the exact property
   `conversationActivityStore.ts:148-152` documents for a first write of `false`.

### The bound question — deliberately no cap

`conversationTimelineStore.ts:93-111` imposes a ten-slice bound and states its two-part justification: what
an entry costs (a whole thread of assistant text, no wire-side ceiling) **and** what clears it (no periodic
floor, because a timeline must survive a reconnect). This store inherits the second half and not the first.

An entry here is **one number plus one bounded id string** — the cheapest entry in the family, below even
`conversationActivityStore`'s four booleans, which explicitly declines a cap (`:163-167`), and far below
`backgroundTaskRosterStore`'s ~5 KB, which also declines one (`:282-289`). "Not a plausible exhaustion
vector" is load-bearing for both those refusals and it is *more* true here. Per the evidence rule, no
speculative eviction policy is built for a failure nobody has observed: **no bound, no eviction, no LRU.**
The map is emptied wholesale at the pairing boundary by #779.

There is a real forward question about persisted size once #776 lands — flagged under § Open questions, not
pre-empted here.

### Deliberate omissions

- **No clears.** #779 owns the pairing-boundary clear. This mirrors the family: #747 shipped the holder,
  #749 added the eviction paths.
- **No persistence.** #776 owns it. This module must not touch `localStorage`; it stays a pure in-memory
  slice. `defaultWorkspaceStore` and `pushNotificationPrefStore` show the injected-port pattern #776 will
  follow, and #776 is where the port's DI seam belongs — adding one here would ship an unused seam.
- **No whole-map `selectAllLastRead`.** All three keyed precedents deliberately omit the whole-map analogue
  (`backgroundTaskRosterStore.ts:418-419`), and nothing downstream needs one: the sidebar reads one row at a
  time (`conversationActivityStore.ts:258-260`). Shipping one would ship an unread read surface.
- **No monotonic max-guard.** AC2 says re-recording *replaces*. `Math.max(held, incoming)` is not
  replacement and would make a legitimate lower mark unrecordable. Plain replacement.
- **No `?? initialTimelineState`-style fallback anywhere**, and no import of `threadTimeline`,
  `conversationTimelineStore`, `activeConversationStore` or anything under `src/renderer/src/screens/`.
  Sampling `items.length` is #777's job, at #777's call site. **Hard import constraint, checkable by grep:
  this module's only imports are `zustand/vanilla` and `zustand`.** With no reference to the open
  conversation or to any timeline in scope, the `?? activeConversation` fallback this family exists to
  prevent is not something a developer must remember to avoid — it is unavailable.

## State and concurrency model

One Zustand vanilla store, one state field (`marks`), one write path, one selector factory. Copy-on-write:
every write builds a fresh outer `Map` and replaces the state; `s.marks` is never mutated in place.
`new Map(s.marks)` copies by value for numbers, so an untouched key's reading is unchanged and a component
watching another conversation does not re-render — the `backgroundTaskRosterStore.ts:415-417` property.

No async task, no timer, no IPC, no preload bridge, no transport, no teardown. Every write is a synchronous
`set` under zustand's own store lock with no `await` inside it, so there is no check-then-act gap across a
suspension point. Unidirectional state is preserved: one read-only selector, one store-owned write path,
never two-way-bound from a component.

## Error handling

There are no failure modes in this slice. No parsing (nothing is decoded), no I/O (nothing is persisted or
sent), no network. A read miss is `null` **by design**, not a swallowed error, and the nullable return type
forces #778 to branch on it. There is no result type and nothing for the UI to surface.

**Log-free by construction** — no `console.*` on any path. The only value a diagnostic here could carry is
the untrusted conversation id, and the content-free diagnostics rule (ADR 0007, #126) keeps it out of a
file.

## Testing strategy

Test-first: the RED suite lands before the module. `src/renderer/src/store/conversationLastReadStore.test.ts`,
under `npm test` (vitest, `node` environment, no React, no DOM). Every test builds its own isolated store
through `createConversationLastReadStore(...)` — never the singleton. Tag each test with its AC, following
`#757`'s `(#757 AC1)` convention, because the precedent files' test names already carry other tickets' AC
numbers.

Scenarios, as bullets — the developer writes them in the repo's idiom:

**AC1 — keyed, creates on absent**
- Record for an id absent from an empty store → `selectLastReadFor(id)` reads the recorded number.
- Record `0` for an absent id → reads `0`, **not** `null`. The falsy-guard trap; this test is the one that
  fails if the write guard treats `0` as absent.
- Record for an absent id into a store seeded with other ids → the new entry exists and the seeded ones are
  unchanged.

**AC2 — isolation and replacement**
- Record for `a`, then for `b` → `a`'s reading is unchanged and its value is `===` what it was.
- Re-record a different value for the same id → the reading is the new value, not a sum, not an array,
  and `marks.size` is unchanged.
- Re-record the **same** value for the same id → `store.getState()` is `Object.is`-identical to the state
  object before the call (the same-value short-circuit).
- A write never mutates the previously held map: capture `s.marks` before, write, assert the captured map
  still reports the old reading and that it is not the same object as the new `s.marks`.

**AC3 — "never read" is its own state**
- An id never recorded reads `null`.
- An id recorded with `0` reads `0`, and `selectLastReadFor(neverRecorded)` reads `null` in the same
  store — assert both in one test so the distinction is what is being pinned.
- Assert `selectLastReadFor(id)(state) !== null` for a `0` mark. This is the `||`-vs-`??` trap; a selector
  written with `||` passes every other test in the file and fails only this one.

**AC4 — hostile keys**
- Round-trip record-then-read for each of `'__proto__'`, `'constructor'` and `''`, with distinct values,
  asserting each reads back exactly its own value.
- Read each of the three **before any write** on a fresh store → `null` for all three. This is the test
  that fails if `Map` is ever swapped for `Record`, and it is the only one that does — say so in a comment
  on the test, as `conversationTimelineStore.ts:62-63` does.
- After recording under `'__proto__'`, assert no prototype was reached or altered: a plain `{}` has no
  polluted property, and `Object.getPrototypeOf({})` is still `Object.prototype`.
- Assert `marks.size` counts all three hostile keys as ordinary entries.

Type-level coverage under `npm run typecheck`: `selectLastReadFor`'s return type is `LastReadMark | null`,
and `marks` is a `ReadonlyMap`, so an in-place `.set` on held state is a compile error.

## Open questions

1. **Evicted timeline slices, for #778.** `conversationTimelineStore` retains ten slices
   (`MAX_RETAINED_TIMELINES`). When a slice is evicted its key becomes **absent**, so `selectTimelineFor(id)`
   reads `null`, and if content later arrives the slice is recreated with `items.length` restarting near
   zero. A mark of, say, `47` against a recreated count of `1` compares as "read" and hides the dot. The
   failure direction matches what #778 AC4 already prefers (a missed mark over a stuck one), and the
   information needed to do better **is** available — `selectTimelineFor(id) === null` is distinguishable
   from a present empty slice. Nothing to build here; #778 should decide explicitly rather than inherit it
   by accident. Worth a line in #778's body.
2. **Persisted size, for #776.** This store is deliberately unbounded, which is right in memory. Once #776
   persists it, the map survives restarts while #779 only clears it at the pairing boundary, so a long-lived
   pairing accumulates one small entry per conversation ever opened. That is where a ceiling — or a prune on
   load — would be measurable and justified. Not pre-empted here.
3. **Naming.** `recordLastRead` is chosen over `markRead` to avoid colliding conceptually with
   `conversationTimelineStore`'s `markViewed`, which is nullary-valued and means something different
   (eviction ranking). If code-review prefers `markLastRead`, that is a rename, not a redesign.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** The one untrusted input is `conversationId`, daemon-asserted text arriving from the
  four turn-stream IPC arms (`src/shared/ipc/events.ts:130`, `:141`). This slice sits **downstream** of that
  boundary and adds none of its own: it performs no decode, no validation and no parse. The id is used
  **only** as a `Map` lookup key — never stored inside a value (a mark is a bare `number`, so there is
  structurally nowhere to put it), never rendered, never concatenated, never a filename, cache key or URL,
  and never compared against a secret. `LastReadMark = number` means the trusted/untrusted question does not
  arise for the value at all; the only string in the module is the key. The design decision that makes the
  category small is the `ReadonlyMap` mandate, which converts key-hostility from a validation problem into a
  non-problem (`Map.prototype.get('__proto__')` performs no prototype-chain lookup). AC4's
  reads-before-any-write test is the mechanical check that the mandate is still honoured.
- **[Tokens, secrets, credentials]** Not applicable by construction: this module holds one `Map<string,
  number>` and nothing else. No token is generated, stored, rotated, revoked or expired here; no credential
  is read or written; nothing reaches `safeStorage`, disk or `localStorage`. The persistence question is
  explicitly **deferred to #776**, and this spec forbids this module from touching web storage precisely so
  that decision is made once, in the ticket that owns it, rather than leaking in early.
- **[File / storage operations]** Not applicable — no filesystem path is constructed, joined, resolved or
  opened; no temp file, no rename, no `existsSync`-then-read. The untrusted id never reaches a path, which
  is the property that makes path traversal and TOCTOU both structurally unreachable rather than merely
  unexercised. **Forward note for #776 (SHOULD FIX, in #776's scope, not this one):** persistence will bring
  this category back, and the id must not become a `localStorage` key fragment — one whole-map value under a
  single fixed key, in the `pushNotificationPrefStore` / `defaultWorkspaceStore` style, keeps the untrusted
  string out of the key space. Recorded here so #776's architect inherits it.
- **[Inter-process / Electron attack surface]** No finding. This ticket adds **no** `contextBridge` API, no
  `ipcMain` channel, no `BrowserWindow`, no protocol handler, no navigation. It is renderer-local state with
  zero IPC surface, and the hard import constraint (only `zustand/vanilla` and `zustand`) is grep-checkable,
  so a developer cannot quietly acquire one. Process placement is correct and unchanged: no key, socket or
  Noise state is anywhere near this module, and none could be — a `Map<string, number>` cannot carry one.
- **[Cryptographic primitives]** Not applicable — no randomness (no id is minted; the caller supplies both
  key and value), no hashing, no key derivation, no comparison against a secret. `===` on a `number` in the
  same-value guard compares two client-originated counts, neither of which is attacker-chosen in any way
  that matters and neither of which is a secret, so `timingSafeEqual` is not indicated. Worth stating
  explicitly because the guard *is* a comparison and a reviewer will see it.
- **[Network & I/O]** Not applicable — no socket, no `ws`, no URL, no TLS decision, no timeout, no
  reconnect. Nothing in this module is reachable from the wire except through #777's future write, and the
  volume of that path is bounded by the arms the bridge already delivers.
- **[Error messages, logs, telemetry]** No finding, and this is a live constraint rather than a vacuous one:
  the module is **log-free by construction**, and the rule bites because a diagnostic on this path would
  carry the untrusted conversation id (ADR 0007 / #126, the content-free diagnostics rule). A read miss
  returning `null` and a same-value write returning early are both silent **by design**, not swallowed
  errors. There is no error object, so nothing reaches a crash reporter. No telemetry.
- **[Concurrency]** No finding. No async task is launched, so there is nothing to own or cancel: no
  `AbortController`, no `setTimeout`/`setInterval`, no event listener, no subscription, no teardown. Every
  write is a synchronous zustand `set` with no `await` inside it, so the check-then-act pattern in the
  same-value guard (`get` then `set`) has **no suspension point** for a concurrent handler to interleave
  into — the race this category asks about is unreachable rather than merely unlikely. Shutdown mid-write is
  a no-op: the state is in-memory only, so a killed process loses it entirely and the next start reads an
  empty map, which is the honest "never read" state for every conversation.
- **[Threat model alignment]** Two desktop threats apply and both are addressed rather than deferred.
  **Hostile daemon / on-path relay minting conversation ids:** a hostile actor inside the session can name
  arbitrary ids and, once #777 wires the write path, mint one entry per id. This slice's exposure to that is
  one number plus one bounded id string per entry — the smallest in the keyed-store family, below
  `conversationActivityStore`'s four booleans (`:163-167`) and far below `backgroundTaskRosterStore`'s ~5 KB
  (`:282-289`), both of which decline a cap on exactly this reasoning. The deliberate absence of a bound is
  therefore a *stated* accepted residual, not an oversight; it is re-examined in #776 when persistence makes
  the growth survive restarts. **Hostile ids as keys** is handled structurally by the `ReadonlyMap` mandate
  above, not by validation. **Renderer compromise reaching the transport** is unchanged by this ticket: the
  module holds nothing of value to an attacker who already has renderer script execution — a count of
  messages read is not a secret, and there is no capability here to pivot through. Out of scope and named:
  the pairing-boundary clear that stops one server's ids from being keyed alongside another's is **#779**.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
