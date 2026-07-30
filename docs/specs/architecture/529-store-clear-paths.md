# #529 — `activeConversationStore` and `sessionIdStore`: add a clear path to each

**Size: XS** (PO's `size:xs` confirmed — see § Size check.)

## Design source

N/A — no `## Figma` section in the ticket body, and correctly so: this ticket adds a store mutation
with **no production caller** (AC5). Nothing renders differently after it lands. The visual
consequences belong to #530 (navigation) and #531 (unpair / pair-another-server), which own the call
sites. Visual-fidelity review is intentionally not applicable here.

## Files to read first

| Path | What to extract |
|---|---|
| `src/renderer/src/store/sessionIdStore.ts:1-58` | The full target shape. Note the four regions you will touch: header comment `:15-16` (the "exactly one mutation" claim), store type `:29-32`, factory `:41-46`, selector docstring `:56-57`. |
| `src/renderer/src/store/activeConversationStore.ts:1-61` | The sibling target, same four regions: header `:12-15`, store type `:26-29`, factory `:40-47`, selector docstring `:57-58`. |
| `src/renderer/src/store/sessionIdStore.test.ts:1-64` | The exact test idiom to extend — plain functions over `createSessionIdStore()`, no React, no bridge. Header comment `:8-11` also asserts "a single set-on-marker mutation" and goes stale. |
| `src/renderer/src/store/activeConversationStore.test.ts:1-75` | Sibling test file, same idiom + a local `payload()` fixture builder at `:15-24` — reuse it, don't write a new one. Header `:9-13` asserts "a single set-on-create mutation" and goes stale. |
| `src/renderer/src/store/runSettingsWriteStore.ts:10-12` | **The one cross-file comment edit.** Its reducer is justified "rather than `sessionIdStore`'s single setter" — a contrast that this ticket falsifies. Read only this clause; change nothing else in the file. |
| `src/renderer/src/store/newFolderStore.ts:38,83` | The `{ type: 'reset' }` reducer-arm precedent — read it to see **why it does not apply here** (§ Rejected alternatives). |
| `src/renderer/src/PairedShell.tsx:88` | Already holds `setActiveConversation`. The obvious-looking clear site that is **#530's, not yours** (AC5). Read it so you recognise it and leave it alone. |

## Context

Both stores are app-lifetime singletons holding per-context state — one conversation, one pairing —
behind a single non-nullable setter. Each already models "nothing seen yet" as `null` and already
exports the matching `initial*State` constant, so the destination exists; only the road to it is
missing. A value that outlives its context does not merely render stale: `activeConversation.id`
addresses outbound wire actions (composer send, both snapshot requests, archive, delete, workspace
change, queue dequeue) and `sessionId` gates and addresses the interactive Run configuration writes.

This ticket ships **only the capability**. #530 and #531 are native blockers on it and own every call
site.

## Design

### The mutation shape: a second named setter, not a widened setter, not a reducer

Add one function member to each store type and one corresponding entry in each factory:

```ts
// activeConversationStore.ts — added to ActiveConversationStore (NOT to ActiveConversationState)
clearActiveConversation: () => void

// sessionIdStore.ts — added to SessionIdStore (NOT to SessionIdState)
clearSessionId: () => void
```

Each implementation is a single unconditional `set(initial<X>State)` in the factory. Behaviour: return
the whole state to the exported initial constant; unconditional, so calling it from the initial state
is a no-op by construction rather than by a guard.

**Source the value from the exported `initial*State` constant, never from a fresh `{ … : null }`
literal.** Both states are single-field today so the two are equivalent right now — but AC3 is worded
"yields the store's exported initial state", and sourcing from the constant is what keeps that true if
either state ever gains a second field. (This is the #528 lesson: a literal silently stops resetting
everything the moment a field is added.) zustand shallow-merges a partial, so the function members
survive the `set` and both setters keep stable references.

**Do not add an early-return "already clear" guard.** AC3 asks for "a no-op rather than an error",
which the unconditional `set` already satisfies. No selector churn has been observed to motivate more:
the held value is `null` before and after, so every narrow-slice subscriber's selector returns an
identical `null` and zustand's `Object.is` bail-out means no subscriber re-renders regardless. A guard
would add a branch defending a failure mode nobody has seen.

### What must not change

`ActiveConversationState` and `SessionIdState` — the **state-only** interfaces — gain nothing. The new
member goes on the `*Store` type (state & mutations). This is what makes AC4 structural rather than a
promise: `selectActiveConversation` and `selectSessionId` are typed against the state-only interface,
so they cannot see the new member, and `initial*State` stays assignable. Both existing setters keep
their exact signatures and bodies — no widening to `string | null`.

### Comment sites: all seven, and the decision on the cross-file one

The stores' own prose asserts a one-mutation premise that this change falsifies. Update all of it —
leaving a comment that contradicts the code is the failure mode the ticket flags:

| Site | The stale claim |
|---|---|
| `activeConversationStore.ts:12-15` | "A single setter rather than a reducer: there is exactly one mutation" |
| `activeConversationStore.ts:57-58` | "`setActiveConversation` is the sole mutation path" |
| `sessionIdStore.ts:15-16` | "a single setter rather than a reducer: there is exactly one mutation" |
| `sessionIdStore.ts:56-57` | "There is no exposed setter beyond `setSessionId`" |
| `activeConversationStore.test.ts:9-13` | "with a single set-on-create mutation" |
| `sessionIdStore.test.ts:8-11` | "with a single set-on-marker mutation" |
| `runSettingsWriteStore.ts:11` | "rather than `sessionIdStore`'s single setter … not one 'record the latest value' mutation" |

The replacement reasoning, which each rewrite should carry in its own words: **two independent
whole-value writes, not a state machine.** `record` and `clear` neither read prior state nor constrain
each other's ordering, so a discriminated-union action set would still be ceremony — the original
conclusion survives, only its "exactly one" premise does not.

**Decision on `runSettingsWriteStore.ts:11` (the ticket left this to the architect): correct it here.**
It is one clause in a comment, in a file this ticket otherwise does not touch — no code change, no
test change. This is not "refactoring adjacent code": the clause becomes false *because of this
commit*, and the ticket that breaks a statement is the ticket that owes its repair. Deferring it means
the next reader of `runSettingsWriteStore` learns something untrue about a sibling store, with no
ticket on the board that would ever fix it. The rewrite is narrow — the reducer's justification still
holds and gets *stronger*, because the real contrast was never the count: `runSettingsWriteStore` has
three **correlated** transitions that each read prior state (a confirm/reject is a no-op without a
matching pending record), whereas these two stores now have two writes that read nothing. Re-point the
clause at that distinction; change nothing else in the file.

`sessionIdStore` is cited in eleven further places across `store/` (`serverInfoStore.ts:7,9,27`,
`relayLinkStore.ts:9,13,25`, `queueStore.ts:7,9`, `runSettingsWriteBridge.ts:62`, and three test-idiom
headers). **All of these are out of scope** — verified individually: each cites the *DI-factory →
singleton → hook → selector structure*, the `null` sentinel, or the bare-`string` value type. None
asserts the mutation count. `:11` in `runSettingsWriteStore` is the only one that does.

### State and concurrency model

Unchanged. Pure synchronous renderer state, no IPC, no preload bridge, no transport, no async. The
clear is a store-owned mutation invoked by wiring (in #530/#531), never two-way-bound from a
component — unidirectional state is preserved exactly as the existing setter preserves it.

### Error handling

None to add. Neither mutation can fail: no validation, no coercion, no I/O. "Clearing from the initial
state" is the only edge case and it is a no-op by construction (AC3).

## Rejected alternatives

**Widening the setter to `setSessionId(id: string | null)`.** Rejected on two counts. It changes the
existing setter's behaviour, which AC1/AC2 explicitly forbid. More substantively, it hands the *data
path* an un-set authority it must not have: `sessionIdBridge.ts:68` records decoded daemon ids, and
recording and clearing are different authorities with different callers — the bridge records, the
nav/unpair wiring clears. It would also collide with the store's documented sentinel discipline, where
`''` is a real degenerate id held verbatim and `null` means "no marker seen yet"; a nullable setter
makes those two reachable through the same door.

**A `{ type: 'reset' }` reducer arm**, matching `newFolderStore.ts:38,83`, `sessionStore.ts:55,125`,
and `threadTimeline.ts:138,435`. Rejected: every one of those precedents is a store that *already* had
a reducer, where `reset` is one arm among four to six. Converting a two-mutation store to a reducer to
host one nullary arm inverts the existing header comments' reasoning instead of amending it, and
rewrites both stores' public surface — turning a genuinely XS change into a consumer-facing one.

## Testing strategy

`npm test` (vitest) and `npm run typecheck`. Extend both existing test files in their established
idiom — plain functions over isolated `create*Store()` instances, no React, no bridge. Reuse
`activeConversationStore.test.ts`'s local `payload()` builder; do not add a new fixture.

Per store, four scenarios:

- **Clear after a set yields the exported initial state** (AC3). Set a value, clear, assert the state
  equals `initial*State` and the selector returns `null`. Assert against the **constant**, not a
  literal — that is what makes the test survive a future second field.
- **Clear from the initial state is a no-op** (AC3). Clear on a fresh store, assert no throw and the
  state still equals `initial*State`. A second consecutive clear likewise.
- **Set still works after a clear.** Set → clear → set, assert the latest value is held. Pins that the
  clear did not damage the setter's whole-value-replace behaviour (AC1/AC2).
- **The clear reference is stable across updates**, mirroring the existing
  "keeps the `setX` reference stable" test at `sessionIdStore.test.ts:58-63`.

Also assert **DI isolation** once (clearing store `a` leaves store `b` untouched) if it falls out
cheaply — the existing files already have that shape for the setter.

**AC5 is verified by a grep, and code review will run it.** After the change:

```bash
grep -rn "clearActiveConversation\|clearSessionId" src/ e2e/
```

Every hit must be in `activeConversationStore.ts`, `sessionIdStore.ts`, or their two `.test.ts` files.
A hit anywhere else — `PairedShell.tsx` above all — is an AC5 failure, not a helpful extra.

## Size check

**XS confirmed. No red line tripped.** Three production files (two with code, one comment-only), two
test files, ~10 lines of production code total plus comment rewrites, two new exported members, zero
new files, five ACs.

**Fan-out proof — zero, by construction rather than by inspection.** Grepping the exported store *type*
names is the decisive test, because an added member can only break a consumer that builds the object
literally or switches over it exhaustively:

- `ActiveConversationStore` — three hits, all inside its own file: the type declaration `:27`, the
  `createStore<…>` generic `:43`, the hook's selector parameter `:53`.
- `SessionIdStore` — three hits, identically confined: `:30`, `:42`, `:52`.
- `initial*State` — declaration, own-factory default parameter, and one test assertion each.

No consumer anywhere constructs either store shape as an object literal, and nothing switches over
either. Every consumer reads through a narrow selector or hook — `PairedShell.tsx:88`,
`ConversationScreen.tsx:125,895,991,1405`, `RunConfigData.tsx:20`, `RunConfigSections.tsx:322` — or
calls the existing setter (`sessionIdBridge.ts:68`). The `e2e/` references are comment-only (four
files). Adding a member therefore forces no edit outside the files listed above.

**File-overlap check: clean.** `git fetch origin --prune` then a diff of all eleven open
`origin/feature/*` branches against `main` shows none touching
`activeConversationStore.ts`, `sessionIdStore.ts`, either test file, or `runSettingsWriteStore.ts`.
#530 and #531 have no branches — they are blocked on this ticket. No `addBlockedBy` needed.

**On the "one sentence without 'and'" test**, PO's reasoning holds: "add a clear path to each of the
two single-setter per-context stores" enumerates one mechanical change across a homogeneous pair. The
red line targets a producer/consumer conjunction — two concerns welded together — not the same change
applied twice to sibling files. #508 already split on the real seam (mechanism): the timeline's clear
is a reducer arm (#528, landed), these two are not. Splitting this further yields two tickets of ~5
production lines each.

## Open questions

None blocking. One note for the developer: the exact comment wording is yours — the spec fixes *which*
seven sites must stop claiming "exactly one mutation" and *what* the replacement reasoning is (two
independent whole-value writes, not a state machine), not the prose.
