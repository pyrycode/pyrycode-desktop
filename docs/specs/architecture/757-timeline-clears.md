# #757 — clear per-conversation timelines on the exit and pairing-end edges

Child G of #675. #755 shipped the keyed holder, #756 gave it its first writer, and this ticket gives it
its first *clears*. #758 cuts the reader over afterwards.

## Design source

N/A — no `## Figma` section in the ticket body, and none is owed. AC4 is "what the operator currently
sees is unchanged": every edit is renderer state and comments, the flat `timelineStore` keeps being
reset on both edges exactly as today, and nothing this ticket adds has a reader until #758. Code-review's
visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is wired but not indexed for this repo (`.codegraph/` holds only `.gitignore` + `config.json`),
so every `codegraph_*` call errors "CodeGraph not initialized". This list was built by grep + Read.

| Path | What to extract |
|---|---|
| `src/renderer/src/store/conversationTimelineStore.ts:1-71` | The header. The **line-neutral zone** (see § Hard constraints) and the SECURITY paragraph (`:51-63`) whose hostile-key argument both new methods inherit. |
| `src/renderer/src/store/conversationTimelineStore.ts:115-143` | `ConversationTimelineState`, the absent-vs-present-empty distinction, and the `ConversationTimelineStore` type the two new methods join. |
| `src/renderer/src/store/conversationTimelineStore.ts:147-229` | THE EVICTION INVARIANT docblock plus `withNewSliceAtHead` / `withSliceAtTail`. The rebuild idiom and the `!timelines.has(id)` guard shape are copied from here. |
| `src/renderer/src/store/conversationTimelineStore.ts:278-353` | `createConversationTimelineStore`'s existing two write paths (the `return s` short-circuit idiom at `:296` and the clone-then-`set` at `:297-298`), and `selectTimelineFor`. |
| `src/renderer/src/store/conversationActivityStore.ts:215-227` | **The direct precedent for both new methods.** `dropConversation`'s `has`-guard → clone → `delete` → return, and `clearAllActivity`'s `size === 0 ? s : { entries: new Map() }`, including the comment explaining why it must NOT hand back the exported initial constant. |
| `src/renderer/src/clearPairingScopedState.ts` (whole file, 97 lines) | The five-effect contract, the "does a reconnect to the SAME daemon need to clear it?" discriminator (`:32-33`), and the idempotence claim at `:65-70` that constrains the new store method. |
| `src/renderer/src/exitActiveConversation.ts` (whole file, 100 lines) | The id gate (`:94`), the clear-then-navigate ordering (`:53-56`), and the "THREE clears, not clearPairingScopedState's five" comparison at `:65`. |
| `src/renderer/src/PairedShell.tsx:43-81` | The two module-scope dep objects. `exitConversationDeps` at `:68-73`, `clearPairingDeps` at `:75-81`. Note the `getState()`-inside-the-arrow idiom; nothing is dereferenced at module load. |
| `src/renderer/src/clearPairingScopedState.test.ts:33-98` | `spyDeps()` and the `Object.keys(deps).sort()` tripwire at `:91-97` — the assertion that makes a new dep a *failing* test rather than a silently-declared field. |
| `src/renderer/src/exitActiveConversation.test.ts:31-55, :71-86, :159-172` | `spyDeps()`, the pinned call-order array, and `realDeps()`. |
| `src/renderer/src/store/conversationTimelineStore.test.ts:1-75` | The suite header, `timelineFor()`, `emptyTimeline`, `delta()`, `orphanResult`. New tests reuse these; do not add parallel helpers. |
| `src/renderer/src/screens/conversation/composerSend.ts:73-88` | The dual-write idiom — flat `dispatch(echo)` at `:82` immediately followed by keyed `dispatchFor` at `:88`. This is the precedent for where the new clear sits in both helpers. It is also the correct target of the `:53` cite re-pin. |
| `src/renderer/src/store/timelineBridge.ts:345-350` | The other dual-write site (`:347` flat, `:349` keyed) and the correct target of the second `:53` cite re-pin. |
| `docs/knowledge/codebase/756.md:95-101, :128` | #756's deferred SHOULD FIX naming the stale `composerSend.ts:67` cites. |
| `docs/knowledge/features/conversation-timeline-holder.md:130-140` | "Clears (not yet built)". Documentation-phase owned — read it, do not edit it. |

## Context

Two edges wipe the timeline today and both do it by resetting the one flat store:

- `clearPairingScopedState.ts:92` — the pairing ended (unpair, or pair another server).
- `exitActiveConversation.ts:96` — the conversation on screen was deleted or archived out from under
  the operator (#652 / #653).

Since #756 the keyed `conversationTimelineStore` is written on every routed event and by the composer's
optimistic echo, and neither edge touches it. It just accumulates: an unpair leaves every conversation's
thread from the previous pairing sitting in renderer memory, and conversation ids are scoped to the
server that issued them, so a thread from server A can be keyed under an id server B later reuses.
Nothing reads it yet — which is exactly why this lands *before* the reader cutover rather than after.
The leak must never exist in a merged state.

The store has no clear write path at all. #755 shipped `dispatchFor` and `markViewed` only, and its own
header at `:14-18` says the clears are #757's. This ticket authors them, then wires them.

The two edges want different clears and the difference is the whole ticket: a pairing ending invalidates
**every** conversation; a conversation being deleted invalidates **that one**, and the operator's other
threads are still live and still theirs.

## Design

### 1. Two new store write paths

Added to `ConversationTimelineStore` (`conversationTimelineStore.ts:140-143`). No new exported type; no
new file.

```ts
clearAllTimelines: () => void
clearTimelineFor: (conversationId: string) => void
```

**`clearAllTimelines()`** — drops every retained slice. Nullary by design: AC3's "takes no conversation
id at all" is a property of the *signature*, so it is enforced by `tsc` rather than by a test.

- Already-empty (`timelines.size === 0`) → return the state object itself, so zustand's `Object.is`
  short-circuit fires and no subscriber wakes.
- Otherwise → replace `timelines` with a fresh empty `Map`.

The `size === 0` short-circuit is **load-bearing, not an optimisation**:
`clearPairingScopedState.ts:65-70` claims "All five clears are idempotent by construction — … so
clearing an already-clear store is a no-op reference that churns no subscriber", and
`clearPairingScopedState.test.ts:136-156` asserts it. A clear that always built a fresh `Map` would make
that docstring false and force the test to be weakened. Copy `clearAllActivity`
(`conversationActivityStore.ts:226`) including its reason for **not** handing back
`initialConversationTimelineState.timelines`: that exported constant holds a module-shared mutable `Map`,
and returning it as live state would make every store instance that clears share one object.

**`clearTimelineFor(conversationId)`** — drops exactly one slice.

- Key absent (`!timelines.has(id)`) → return the state object itself. No clone, no churn.
- Key present → clone the map, `delete` the key, return it.

`Map.prototype.delete` preserves the iteration order of every remaining entry, so THE EVICTION INVARIANT
(`:147-176`) survives untouched — a removal re-orders nothing. Clone-then-mutate-the-clone is the
established idiom in this file (`dispatchFor` at `:297-298`) and does not violate the `ReadonlyMap`
contract, which is about never mutating the *held* map.

**Both methods must DELETE, never overwrite with an empty slice.** `set(id, initialTimelineState)`
type-checks identically and would pass any naive "is the thread empty?" assertion, but it collapses
"nothing is held" into "observed; nothing in the thread" — the exact distinction `:115-120` and
`selectTimelineFor`'s `?? null` exist to preserve. AC1's "reports no slice rather than an empty one" is
this, and it needs its own named test in each direction.

**Naming — a deliberate divergence from the twin, stated so review does not read it as drift.** The twin
calls its per-key removal `dropConversation` (`conversationActivityStore.ts:103`). This store uses
`clearTimelineFor` instead, because this file already has a `For` family (`dispatchFor`,
`selectTimelineFor`) whose suffix rationale is written down at `:127-130`; the twin has none. `All` is
kept from `clearAllActivity` for the reason its docstring gives — the blast radius should be legible at
the call site, not only in the docstring.

### 2. AC3 as a grep-checkable constraint

Neither new method body may contain any of: `.get(`, `.sort`, `localeCompare`, `<`, `>`, `toLowerCase`,
`toUpperCase`, `trim`, `.length`, `startsWith`, `endsWith`, `includes`, `items`, `phase`,
`reduceTimeline`, `initialTimelineState`. `has`, `delete`, `size` and `new Map(...)` are the whole
vocabulary.

`has` is not a shape derivation — it is the same presence lookup `withSliceAtTail` already performs at
`:218` — so it satisfies AC3's ban on "sorting, ordering comparison, normalising, lowercasing, trimming,
length or prefix check". The hostile-key property carries over unchanged from the header's SECURITY
paragraph: `Map.prototype.has('__proto__')` and `Map.prototype.delete('__proto__')` perform no
prototype-chain lookup, so `__proto__`, `constructor` and `''` stay three unremarkable keys by
construction.

### 3. Where the new effect sits in each helper

**One rule for both files: the keyed clear goes immediately after the flat `dispatchTimeline`.**

That is the dual-write idiom this codebase already writes twice — `composerSend.ts:82` then `:88`, and
`timelineBridge.ts:347` then `:349` — and the two clears are one fact expressed against two stores. It
also puts the keyed clear where the flat one stands today, so retiring the flat store later is a deletion
rather than a move.

`clearPairingScopedState` (`:91-97`) becomes six calls:

```
dispatchTimeline({ type: 'reset' })   // unchanged — AC4
clearAllTimelines()                   // NEW
clearActiveConversation()
clearSessionId()
clearAnnouncedModel()
dispatchSession({ type: 'reset' })
```

`exitActiveConversation` (`:90-100`) becomes five, with the nav still pinned last:

```
if (deps.getActiveConversation()?.id !== conversationId) return   // UNCHANGED — see below

dispatchTimeline({ type: 'reset' })   // unchanged — AC4
clearTimelineFor(conversationId)      // NEW
clearActiveConversation()
clearSessionId()
navigateToList()
```

`clearTimelineFor` takes `conversationId` — the helper's own **argument**, not
`deps.getActiveConversation()!.id`. Past the gate the two are the same string, the argument needs no
second getter call, and the non-null assertion is banned.

**The gate at `:94` does not change.** AC3 forbids the id's *value* steering behaviour; comparing the
incoming id against the active conversation's is the pre-existing equality check that makes the helper
correct. Equality is not ordering. The store-side anchor for AC3 is
`conversationTimelineStore.ts:172-176`, not this line.

**Why the pairing clear belongs in the shared helper and not at PairedShell's two call sites** — the
helper's own docstring rule (`:20-33`): a pairing-scoped store that nothing re-asserts on the new pairing
belongs *here*, because the bug the helper exists to fix was each path deciding its own clear set
independently. The discriminator ("does a reconnect to the SAME daemon need to clear it?") answers **no**
for the same reason it answers no for the flat timeline: a reconnect rejoins the same conversations and
there is no backfill, so wiping their threads would destroy rows that never come back. `:14-18` and
`:103-105` of the store already say this.

Two claims elsewhere stay TRUE and must not be edited — but only because `clearAllTimelines` drops
*every* slice rather than just the active one: `conversationDeletedBridge.ts:58` and
`conversationArchivedBridge.ts:119` both assert "`clearPairingScopedState` has already cleared everything
the exit would clear". The pairing clear must remain a strict superset of the exit clear.

### 4. Wiring

`PairedShell.tsx` — one import plus one line in each module-scope dep object. Both call sites already
spread one shared object apiece (`:231-232`, `:247-248`, `:295`, `:300`), so neither gains a branch and
no call site is edited.

- `exitConversationDeps` (`:68-73`) gains
  `clearTimelineFor: (id) => conversationTimelineStore.getState().clearTimelineFor(id)`
- `clearPairingDeps` (`:75-81`) gains
  `clearAllTimelines: () => conversationTimelineStore.getState().clearAllTimelines()`

Both reach the singleton through `getState()` inside the arrow body — the idiom the two docblocks above
them already state, so nothing is dereferenced at module load and PairedShell still subscribes to no
store.

## State + concurrency model

Pure renderer state. No IPC, no preload bridge, no transport, no async task, no timer, no teardown, no
new subscription.

Every write is a synchronous zustand `set` with no `await` inside it, so there is no check-then-act gap
across a suspension point — the `has` / `size` read and the map replacement are one uninterruptible step
on the renderer's single thread. Both helpers stay total, synchronous, injected-effect-only pure
functions; React batches all six (resp. five) effects into the commit that carries the route change, so
no observer sees a half-cleared set.

Unidirectional state is preserved: the store gains two more store-owned write paths and no new read
surface. Nothing is two-way-bound from a component.

## Error handling

No new failure modes. Neither method throws, returns a value, or has a partial-success arm; both are
total over every `string` key including hostile ones. A clear of an absent key and a clear of an empty
map are both silent no-ops **by design**, not swallowed errors.

Nothing is logged on either path, and that rule bites harder here than in the sibling stores: a
diagnostic would carry both the daemon-asserted untrusted `conversationId` and, if it named what it was
dropping, assistant message text. ADR 0007's content-free-diagnostics rule keeps both out of a file.
There is no observed failure to instrument.

Nothing reaches the UI. AC4 is that the operator sees no change at all.

## Hard constraints

1. **`conversationTimelineStore.ts:1-71` must stay exactly line-count-neutral.** The only header edit is
   the `:14-18` paragraph, which is five lines and must be re-filled as five lines.
   `timelineBridge.ts:234` cites `conversationTimelineStore.ts:38-42` (the HARD IMPORT CONSTRAINT
   paragraph); holding the header at its current length keeps that cite correct at zero cost. Verify with
   `git diff -U0` that no hunk in that range changes the line count.
2. **No new imports in `conversationTimelineStore.ts`.** The HARD IMPORT CONSTRAINT at `:38-42` says this
   module's only imports are the three below it. Both new methods need nothing beyond `Map`.
3. **No new file.** Four production files are edited and none is created.
4. **Do not edit** `docs/knowledge/` — documentation phase owns it, `conversation-timeline-holder.md:135`
   included.

## Comment true-ups — the complete census

Every one of these is a claim that goes **false** as this lands, in a file this ticket already edits.
Grep-invisible ones are marked; the count-phrases are the ones that silently survive because nothing
type-checks prose.

### `conversationTimelineStore.ts`

| Line | Currently says | Why it goes false |
|---|---|---|
| `:14-18` | "#757 owns the clears … Both ship UNWIRED here and that is correct" | The clears are now built **and wired**. Only `markViewed` still ships unwired. **Re-fill as exactly five lines** (constraint 1). |
| `:125` | "Store shape = state + the two write paths." | Four. |
| `:136-139` | "Two named write paths rather than a reducer over a keyed action union: a fold and a view-stamp are two independent operations…" | Four paths, and the argument now covers two clears as well. |
| `:149` | "Three rules maintain it and nothing else re-orders" | Still three rules, but "nothing else re-orders" is now a claim about two new methods. Add a short clause stating that a removal preserves the relative order of every survivor, so neither clear re-orders. Keep it to two lines. |

Leave alone: `:5-12` ("a WRITER and still no reader" — a clear is not a reader), `:7` ("the two writes run
side by side" — about the two event writers, not write paths), `:71`, `:103-105`, `:315`.

### `clearPairingScopedState.ts`

| Line | Currently says | Note |
|---|---|---|
| `:10` | "The five effects" + a five-bullet list | Six, plus a `clearAllTimelines` bullet placed second to match the call order. |
| `:44-45` | "the thread rows, the active conversation, the daemon session id, claude's announced running model, and the session store's…" | The enumeration gains the per-conversation threads. |
| `:51` | "Four of these five stores latch across either switch" | Five of six. |
| `:53` | "(its only production writers are the live stream, timelineBridge.ts:206, and the composer's optimistic echo, composerSend.ts:67)" | **Both cites are stale — re-pin both.** See § Cite re-pins. |
| `:58` | "The session store is the fifth and is IN the set rather than beside it" | It is now last of six. |
| `:59` | "would have degraded this into \"four clears plus a special case\"" | Five. **Grep-invisible: the number is inside a quoted phrase.** |
| `:65` | "All five clears are idempotent by construction" | Six — and this is precisely the claim the `size === 0` short-circuit exists to keep true. |
| `:72` | "No ordering constraint among the five" | Six. |
| `:74` | "React batches all five into the commit" | Six. |
| `:79` | "The announced model is worse than the other four on that axis" | Five. **Easy to miss** — it is a count of the *other* effects, not of the set. |

### `exitActiveConversation.ts`

| Line | Currently says | Note |
|---|---|---|
| `:10` | "The five effects" + a five-bullet list | Six, plus a `clearTimelineFor` bullet placed third to match the call order. |
| `:53` | "The three clears are independent whole-value writes" | Four. |
| `:54` | "All four are synchronous" | Five. |
| `:65` | "THREE clears, not clearPairingScopedState's five" | **Both numbers move**: four, not six. |
| `:70-72` | "The set here is activateConversation's clear branch (timeline `reset` + `clearSessionId`) PLUS `clearActiveConversation`" | Plus the keyed clear. |

`:45` ("The fail-direction is safe — every move below is a clear") stays true: the new move is also a
clear.

### Test-file headers

- `clearPairingScopedState.test.ts:15` — "its four effects are injected". **Already wrong today** (there
  are five). It is the same claim this ticket widens, on a factory this ticket edits, so it is corrected
  to six rather than left at a number that was never right.
- `clearPairingScopedState.test.ts:63` — the test name "performs all five clears exactly once".
- `clearPairingScopedState.test.ts:84` — "the pairing-scoped set is exactly these five stores".
- `exitActiveConversation.test.ts:10-11` — "its five effects — the active-conversation read, the three
  clears, and the nav".

### Cite re-pins at `clearPairingScopedState.ts:53`

Both cites on that one line are stale and both are re-pinned, because the line is being rewritten anyway
and neither costs an extra edit:

- `composerSend.ts:67` → **`composerSend.ts:82`**. #756 moved the flat-store echo; its code review
  deferred the re-pin explicitly (`docs/knowledge/codebase/756.md:95-101, :128`), and the ticket body
  puts it in scope here.
- `timelineBridge.ts:206` → **`timelineBridge.ts:347`**. The ticket body scopes this one out as "not in
  this ticket's file set" — that reason does not hold: the cite lives *on the line being rewritten* in a
  file this ticket edits. It has also degraded *sideways*, which is the worst kind: `:206` now lands
  inside a `modelAnnounced` comment block that still reads plausibly. `:347` is the flat store's write
  inside `useTimelineBridge`'s fan-out, which is what the sentence means. Included deliberately, at zero
  extra edits.

The identical stale `composerSend.ts:67` cite at `activateConversation.ts:44` stays — that file is not in
this ticket's set, and adding it would put the ticket at five production files.

## Measured cite drift handed to the sweep ticket

Editing the two dep lists shifts line numbers under four cites in files this ticket must **not** touch —
adding any of them would take the ticket to six production files, over the split gate. Each was measured,
not assumed. The developer records the post-edit anchors in the PR body so the sweep has them.

| Cite location | Target | Δ | Cause |
|---|---|---|---|
| `announcedModelStore.ts:28` | `clearPairingScopedState.ts:19-27` | +1 | the sixth dep bullet |
| `announcedModelStore.ts:35` | `clearPairingScopedState.ts:22-26` | +1 | same |
| `conversationArchivedBridge.ts:95` | `exitActiveConversation.ts:17-21` | +1 | the sixth dep bullet |
| `conversationActivityBridge.ts:162` | `clearPairingScopedState.test.ts:84-91` | ≈ +4 | the new spy in `spyDeps()` |
| `composerSend.ts:78`, `composerSend.test.ts:114` | `conversationTimelineStore.ts:268-270` | measure | the `:125-143` block grows by the two new type members and their prose |

`timelineBridge.ts:234` → `conversationTimelineStore.ts:38-42` drifts by **zero** provided constraint 1
holds. That is the one drift this ticket can prevent for free, which is why it is a hard constraint.

## Testing strategy

Vitest, `environment: 'node'` (already global at `vitest.config.ts:27`). No React, no DOM, no Electron.
Test-first: the RED comes before the implementation.

Tag new tests with the ticket — `(#757 AC1)` — because the existing names in
`conversationTimelineStore.test.ts` carry **#755's** AC numbers and a bare `(AC1)` would be ambiguous.
Reuse the file's existing `timelineFor()`, `emptyTimeline`, `delta()` and `orphanResult` helpers; add no
parallel ones.

### `conversationTimelineStore.test.ts`

- `clearAllTimelines` on a map holding several slices leaves every one of those ids reading `null`, not a
  present-empty slice — the delete-vs-overwrite property, asserted against `timelineFor`.
- `clearAllTimelines` drops never-viewed and viewed slices alike; no survivors.
- `clearAllTimelines` on an already-empty store returns the **same state object** — assert reference
  identity of `getState()` and a subscriber spy that never fires. This is what keeps
  `clearPairingScopedState.ts:65-70`'s idempotence claim true.
- `clearAllTimelines` on a non-empty store *does* build a new state object (the negative half, so the
  short-circuit cannot be over-applied).
- `clearTimelineFor` removes exactly the named key; every other conversation's slice is `Object.is`-
  identical to the object held before the call — AC2's "not merely equal but the same held object".
- `clearTimelineFor` leaves the cleared id reading `null`, not a present-empty slice.
- `clearTimelineFor` on an absent key returns the same state object and churns no subscriber.
- `clearTimelineFor` preserves eviction order: fill to the bound, remove a middle key, then create a new
  slice — the victim is the same head it would have been before the removal.
- Hostile keys (`'__proto__'`, `'constructor'`, `''`): `clearTimelineFor('__proto__')` against a map that
  holds a real conversation and no `'__proto__'` key removes **nothing**; against a map that holds a
  `'__proto__'` slice it removes exactly that one and leaves the neighbour. Extends the existing
  `:382-456` hostile-key block rather than opening a new one.
- The invariant survives a full clear: after `clearAllTimelines`, `markViewed(id)` creates at the tail and
  `dispatchFor(id, …)` creates at the head, exactly as on a fresh store.

### `clearPairingScopedState.test.ts`

- `spyDeps()` gains a `clearAllTimelines` spy; the existing "performs all N clears exactly once" test
  asserts it was called once and, per AC3, **with no arguments** — `toHaveBeenCalledWith()`.
- The `Object.keys(deps).sort()` tripwire at `:91-97` grows to six entries. This is the assertion that
  makes a declared-but-never-invoked dep a failing test; it must not be loosened.
- Real stores: seed the keyed store with two conversations' slices via `dispatchFor`, run the helper, and
  assert both ids read `null`. `realDeps()` gains one line and an isolated
  `createConversationTimelineStore()` parameter.
- Real stores, idempotence: extend the existing already-clear case so the keyed store's state object is
  reference-unchanged, alongside the flat store's `items` by-reference assertion.

### `exitActiveConversation.test.ts`

- `spyDeps()` gains a `clearTimelineFor` spy; the match case asserts it was called once **with the exact
  id passed to the helper**, not with the active conversation's.
- The pinned call-order array grows to five, with the keyed clear second.
- Both no-op arms (mismatched id, null active conversation) assert `clearTimelineFor` was **not** called.
- Real stores: seed slices for `'a'` and `'b'`; exit `'a'` and assert `'a'` reads `null` while `'b'`'s
  slice is the same object reference as before — the AC2 pair, end to end.
- The inline dep literal in the ordering test (`:75-81`) is a fourth construction site for
  `ExitActiveConversationDeps`; `tsc` will flag it.

### Gates

`npm run typecheck`, `npm test`, `npm run build`. No e2e change: nothing the operator sees moves, so the
existing fake-transport suite is the AC4 regression proof unchanged.

## Open questions

None blocking. Two things deliberately settled here rather than left to implementation:

- **Method naming** — `clearTimelineFor` over the twin's `dropConversation`, for the `For`-family reason
  in § 1. If code review prefers twin-parity, it is a rename, not a redesign.
- **Placement of the new call** — second in both helpers, per the dual-write precedent. Moving it changes
  which count-phrases need editing (`:58`'s "the fifth" in particular) but nothing about behaviour.

## Out of scope

- **A conversation deleted while the operator is reading a different one.** `exitActiveConversation`
  no-ops when the ids differ (`:94`), so that conversation's retained slice stays in the map. #756 made
  this reachable and it is a real staleness gap, but it is same-server, same-pairing, bounded at ten
  slices, and cleared at the pairing boundary by AC1. Widening the delete path needs its own trigger and
  its own argument about what the operator loses. **Needs an Inbox ticket** — it is not filed yet.
- **Retiring the flat `timelineStore`** once its last reader is gone. Both writes and both resets stand
  side by side until a ticket takes it on deliberately (AC4 depends on that).
- **The stale cite at `activateConversation.ts:44`**, and the four measured drifts in the table above —
  the citation sweep ticket #756's review deferred to.
- **Wiring `markViewed`** — #758's, at the `activateConversation.ts:74-77` switch seam.
- **A per-slice byte cap.** `MAX_RETAINED_TIMELINES` bounds the number of slices, not their bytes;
  `conversationTimelineStore.ts:107-111` already defers this and this ticket does not change it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. `conversationId` is daemon-asserted untrusted text that already
  crossed `contextBridge` and was parsed into `DaemonEvent` in the main process; this ticket consumes it
  one step further downstream as a `Map` key only. The design *narrows* the trust surface rather than
  widening it: AC3's ban on deriving anything from the id's shape is enforced by the nullary signature of
  `clearAllTimelines` (a `tsc` guarantee, not a test) and by § 2's grep-checkable vocabulary for
  `clearTimelineFor`. No new renderer→main message, no new `ipcMain` channel, no new preload API.
- **[Tokens, secrets, credentials]** Not applicable by design decision, not by absence: this store holds
  conversation *content* and never a token, key or credential, and constraint 2 forbids the new methods
  any import — so neither can reach `sessionIdStore`, `safeStorage`, or anything holding a secret.
- **[File / storage operations]** No path is constructed, no file is read or written, and nothing is
  persisted. `conversationTimelineStore.ts:68-71` bans `localStorage` for this store precisely because it
  would write conversation content to renderer-side web storage that **survives the pairing boundary this
  ticket exists to enforce** — that ban is now load-bearing rather than anticipatory, and constraint 2
  keeps it structurally enforced. A future `localStorage`-backed persistence of this store would silently
  defeat AC1; noted for #776, which adds the third `localStorage` key for unread marking and must not
  reach this store.
- **[Inter-process / Electron attack surface]** No finding. Nothing in this ticket touches
  `webPreferences`, registers a protocol handler, adds an IPC channel, or navigates. The four edited
  files are all renderer-side and framework-free; the transport is untouched.
- **[Cryptographic primitives]** Not applicable: no randomness, no comparison against a secret, no
  handshake. The one equality comparison in scope — `exitActiveConversation.ts:94`'s
  `getActiveConversation()?.id !== conversationId` — compares two daemon-supplied conversation ids, not a
  secret, so `timingSafeEqual` is neither required nor appropriate. It is also unchanged by this ticket.
- **[Network & I/O]** No finding. No socket, no frame, no timeout, no reconnect path is touched. The
  clears are synchronous local state writes.
- **[Errors, logs, telemetry]** No finding, enforced rather than hoped for: § Error handling states the
  log-free rule and the store header (`:65-71`) already bans `console.*` on every path in this file. A
  diagnostic on a clear path would carry the untrusted id and, if it named what it dropped, assistant
  message text — both barred by ADR 0007. A read miss and a no-op clear are silent by design.
- **[Concurrency]** No finding. No async task, timer, listener or `AbortController` is created, so
  nothing outlives the window. Each clear is a single synchronous zustand `set` with no `await` inside
  it, so the `has` / `size` read and the map replacement cannot be interleaved — no check-then-act gap
  exists to guard. Both helpers remain total and synchronous, so React commits the whole clear set in one
  batch and no observer can see a half-cleared state.
- **[Threat model alignment]** This ticket *closes* a threat rather than opening one, and the closure is
  the reason it lands before the reader cutover.
  - **Cross-pairing content leakage** — the ticket's own threat. Conversation ids are scoped to the
    issuing server, so a retained slice from server A can be keyed under an id server B later reuses;
    AC1's unconditional whole-map clear removes the possibility at the pairing boundary. Two existing
    comments (`conversationDeletedBridge.ts:58`, `conversationArchivedBridge.ts:119`) depend on the
    pairing clear being a strict superset of the exit clear, which § 3 pins.
  - **Malicious / compromised relay, hostile daemon** — a hostile actor inside the session can mint
    slices for ids the operator never opened. Unchanged by this ticket and already mitigated by #755's
    head-insert rule (`:160-171`), which caps the damage of an unbounded id burst at one displaced viewed
    slice. Neither new method promotes a key or re-orders survivors, so that mitigation is preserved —
    the "a removal re-orders nothing" clause added at `:149` is what makes that checkable rather than
    assumed.
  - **Hostile key injection** — `'__proto__'`, `'constructor'` and `''` reach `clearTimelineFor`
    unvalidated, by design. `Map.prototype.has` / `.delete` perform no prototype-chain lookup, so they
    are three ordinary keys by construction rather than by validation, and the named hostile-key tests in
    § Testing strategy are what fail if `ReadonlyMap` is ever swapped for `Record` — a swap that produces
    no type error and breaks no other assertion.
  - **Renderer compromise reaching the transport** — unchanged; nothing here crosses the process
    boundary.
  - **Out of scope, named:** a conversation deleted while a *different* one is on screen leaves its slice
    held until the pairing ends (§ Out of scope). It is same-server, same-pairing, bounded at ten slices,
    and cleared by AC1 — a staleness gap, not a cross-pairing leak. It needs an Inbox ticket and does not
    gate this one.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
