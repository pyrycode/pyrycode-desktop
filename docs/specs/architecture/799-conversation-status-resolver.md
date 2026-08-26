# #799 — Resolve a conversation's status from its activity and unread facts

**Size:** XS — one new production module (`conversationStatus.ts`), one new test file, zero call-site
changes. Purely additive: nothing imports it yet. #800 types the dot component's prop against the type
this ships; #801 calls the function.

## Design source

N/A — this ticket renders nothing. It ships a type and a pure function; there is no visual surface to
anchor. The Figma for the dot itself (`Status dot`, node `106-3051`) rides on #800, which is the ticket
that draws it. Code review's visual-fidelity check is intentionally skipped here.

## Files to read first

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/conversationUnread.ts:1-97` | **The template for this whole module.** Same shape: pure predicate over two stores' selector outputs, no store of its own, header comment carrying the constraints, `import type`-only imports. Copy its posture, not its logic. |
| `src/renderer/src/store/conversationUnread.test.ts:1-110` | The test idiom to follow — AC-tagged `it` names, a comment on each test naming which wrong implementation it catches. Scenarios 1–8 (direct calls, no store) are the model for this ticket's whole suite. |
| `src/renderer/src/store/conversationActivityStore.ts:57-93` | `ConversationActivityEntry` — the four boolean fields (`turnRunning`, `stalled`, `apiRetrying`, `compacting`) and why each is a plain `boolean` rather than `boolean \| null`. This is the only symbol this module imports. |
| `src/renderer/src/store/conversationActivityStore.ts:238-265` | `selectActivityFor` — why an absent key returns `null` and why that is deliberately distinct from a present all-false entry. Explains the shape of this module's first parameter; **do not import this function.** |
| `src/main/pairingPayload.ts:37-46` | Repo precedent for a client-owned, payload-free sealed union: a multi-line string-literal union with a trailing `//` comment per member, kebab-case members. `ConversationStatus` follows this shape exactly. |
| `docs/knowledge/features/conversation-activity-store.md` | The store's shipped contract and the absent-vs-all-false distinction in prose. |
| `docs/knowledge/features/conversation-unread.md` | The sibling predicate's shipped contract, including its mutation-check discipline. |
| `docs/knowledge/decisions/0009-modal-prompt-model.md` | Why **Input required** is not buildable: no `conversation_id` rides a modal frame, so an outstanding prompt cannot be attributed to a conversation. This is the justification for the reserved-slot comment, not for a branch. |

## Context

The sidebar of the new desktop layout draws one status dot per chat and channel row. Three states are
buildable today: empty (idle), green (new messages), blue slow-blink (assistant working). Both source
facts already ship — the activity store (#747/#748/#749) and the unread predicate (#778). Nothing joins
them, and each of the two consumers would otherwise join them itself, in two places, with two chances to
get the precedence backwards.

This ticket ships the join and nothing else: a sealed status type and a total function onto it. It
renders nothing, reads no store, and holds no state. The slice is separate from the component (#800) and
from the row wiring (#801) precisely because a pure function is directly unit-testable under this repo's
`environment: 'node'` vitest config, while a component under `renderToStaticMarkup` is not.

## Design

### Module

`src/renderer/src/store/conversationStatus.ts` — new file, beside `conversationUnread.ts`.

`store/` rather than a `screens/` directory, and **no `Store` suffix**, for the reason
`conversationUnread.ts:5-10` already records: its inputs are store slices rather than wire rows, its
consumer is the sidebar rather than any one screen, and it is not a store. `threadTimeline.ts` (pure)
sitting beside `timelineStore.ts` (a store) is the naming pair to follow.

Nothing else moves. `conversationUnread.ts` and `conversationActivityStore.ts` are read-only for this
ticket — no signature change, no re-export, no helper lifted out of either.

### The exported type

```ts
export type ConversationStatus =
  | 'working'       // the assistant is mid-work in this conversation
  | 'new-messages'  // content this client holds that the operator has not read
  | 'idle'          // nothing to report
```

Decisions inside that three-line block:

- **A string-literal union, not a discriminated union of objects.** None of the three carries a payload,
  and the repo's idiom for a payload-free closed set is a literal union — `PairingRejectReason`
  (`pairingPayload.ts:37`), `FingerprintRejectReason`, `WireModalClass`. CLAUDE.md's "discriminated
  unions on a `type` field" rule is scoped to *events and actions*; a status is a value, and wrapping it
  in `{ type: 'working' }` would be ceremony that buys #800's `switch` nothing it does not already get
  from a literal union.
- **Kebab-case members**, matching every client-owned union in the repo (`'not-base64url'`,
  `'pubkey-wrong-length'`). Snake_case in `src/shared/wire/` is a *wire* convention and does not apply —
  none of these three strings ever crosses the wire, and none is ever rendered: #800 maps them to
  client-owned display copy.
- **Declared in precedence order**, so the type reads as the rule.
- **Exported, and the function's return type is annotated with it.** AC1 fails if the function returns
  `string`. TypeScript would infer the correct union from the three literal returns even with no
  annotation, so the annotation is not load-bearing at compile time today — it is the guard against a
  fourth branch later widening the inferred type silently. Keep it.

### The exported function

```ts
export function resolveConversationStatus(
  activity: ConversationActivityEntry | null,
  unread: boolean
): ConversationStatus
```

Returns exactly one status. Total — every input is a defined reading, there is no throw path and no
failure mode.

**Parameter order is the precedence order.** `activity` first because working outranks new messages. A
reader who has the signature has the rule.

**Body shape: a flat sequence of early returns, one short line per precedence level.** Not a nested
ternary, not a `switch`, not a lookup table. The flat shape is what makes #802's insertion a one-line
edit at a marked slot, which AC's "state the order in the code" is asking for:

```
  0. INPUT REQUIRED — reserved, not buildable (ADR 0009). #802 inserts here, above working.
  1. WORKING       → any of the four activity facts
  2. NEW MESSAGES  → the unread boolean
  3. IDLE          → otherwise
```

That numbered list goes in the function's docstring, with slot 0 written out as a reserved comment.
**Do not add an unreachable branch for slot 0** — the reserved comment is the whole affordance.

**Working predicate: a module-private helper, not exported.**

```ts
function isWorking(entry: ConversationActivityEntry | null): boolean
```

Behaviour: `false` for `null`; otherwise the four-way disjunction of `turnRunning`, `stalled`,
`apiRetrying`, `compacting`, each named explicitly.

Four things this helper must not become, none of them a type error and only the first catchable by a
test:

- **A three-way disjunction.** A dropped clause typechecks clean. Caught by the four single-fact tests.
- **`Object.values(entry).some(Boolean)`.** Behaviourally identical *today* and therefore catchable by
  no test in this file, which is why it is banned in writing. It silently absorbs a fifth field the day
  `ConversationActivityEntry` grows one, and it truthy-reads a non-boolean. Four named reads make a
  fifth fact a deliberate edit here rather than an accident there.
- **Exported.** Nothing outside needs it; exporting it ships an unread read surface (the
  `backgroundTaskRosterStore.ts:418-420` rule this repo already applies to selectors).
- **Optional-chained into the caller** (`activity?.turnRunning === true || …`). Four `?.` reads restate
  the null case four times; the single `entry === null` guard states it once.

**On the `null` guard specifically.** Unlike `conversationUnread.ts`, where branch order resolves a real
disagreement between two absent-readings, the two not-working readings here *agree*: an absent key ("no
frame has ever arrived") and a present all-false entry ("observed; nothing is happening") both mean not
working. Say so in the comment, so a later reader does not hunt for a disagreement that is not there —
and note that `selectActivityFor` preserves the distinction upstream on purpose, for readers other than
this one. The guard is null-safety, not precedence.

### Imports — the whole import block is one line

```ts
import type { ConversationActivityEntry } from './conversationActivityStore'
```

That is the file's only import. AC4 is checkable by grep: no line in this file starts with `import`
without `type` immediately after it.

Why it matters, restated from `conversationUnread.ts:20-26`: dropping the `type` keyword is no type
error and breaks no test, but `conversationActivityStore.ts:231` constructs an app-wide singleton at
module load, so a value import would drag it into this module's runtime graph and into every test that
imports the resolver. Written as `import type`, the import is erased at compile time and this module has
**zero runtime dependencies**.

Two imports a developer might reach for and must not:

- **`isConversationUnread` from `./conversationUnread`.** Unread arrives as a parameter. This module does
  not re-derive it and never touches the timeline or last-read stores. (The import would not violate AC4
  — `conversationUnread.ts` is itself runtime-free — which is exactly why it needs stating separately.)
- **`selectActivityFor`.** That is the caller's (#801's) job; see Security below.

### Security

**No `conversationId` parameter, and one must not be added.** #801 resolves the id to an activity entry
and an unread boolean through the two source stores' selectors *before* calling in, so the untrusted
daemon-asserted string never enters this file and cannot be added without changing the signature. No
`Map` lookups here, no object literal keyed by an id, no computed keys, no `Object.fromEntries`.

Daemon text is likewise unreachable: the module reads four booleans and returns one of three
client-owned literals. Nothing untrusted has a path in.

**Log-free by construction** — no `console.*` on any path. There is no read miss to report: `null` is a
defined reading, not an error.

### State, concurrency, error handling

None of the three. No store, no subscription, no async, no teardown, no `useEffect`, no React import.
The function is synchronous and referentially transparent. There is no failure mode to surface, so
there is no result type and no UI error path.

The two-store read that feeds it happens at #801's call site, where the same non-torn-read argument
`conversationUnread.ts:78-84` records applies unchanged: back-to-back reads with no `await` between them
in a single-threaded renderer. Nothing here needs a merged snapshot, and #801 must not build one.

## Testing strategy

New file `src/renderer/src/store/conversationStatus.test.ts`. Every scenario calls the function directly
with literal inputs — no store, no port, no singleton in scope, which is only possible because the module
under test has zero runtime imports. `environment: 'node'` is already global at `vitest.config.ts`; add
no environment pragma.

Construct entries from a small local helper that spreads over an all-false base, so a fifth field added
to `ConversationActivityEntry` later breaks in one place rather than in every test.

Scenarios — each `it` name tagged with the AC it pins, each carrying a one-line comment naming the wrong
implementation it catches:

- **`turnRunning` alone, unread false → `'working'`** (AC3)
- **`stalled` alone, unread false → `'working'`** (AC3)
- **`apiRetrying` alone, unread false → `'working'`** (AC3)
- **`compacting` alone, unread false → `'working'`** (AC3) — these four are separate tests on purpose:
  a dropped clause in the disjunction fails exactly one of them and no other test in the file.
- **All four true, unread false → `'working'`** — pins that the disjunction is not an `&&` chain read
  backwards, and costs one line.
- **`null` entry, unread false → `'idle'`** (AC3) — the absent-key reading, its own test per AC3.
- **Present all-false entry, unread false → `'idle'`** (AC3) — the observed-nothing-happening reading,
  its own test per AC3. Together with the previous one this is the pair AC3 asks for by name.
- **`turnRunning` true AND unread true → `'working'`** (AC2) — **the precedence test.** A swapped-order
  implementation compiles clean, passes every other test in this file, and fails only here.
- **`null` entry, unread true → `'new-messages'`** (AC2)
- **Present all-false entry, unread true → `'new-messages'`** (AC2) — pins that the new-messages branch
  does not require an activity entry to exist.

### Mutation checks the developer must actually run

`conversationUnread.ts` was mutation-checked rather than only test-green, and the ticket asks for the
same here. Before opening the PR, apply each of these to the implementation, confirm it fails at least
one named test, and revert:

1. **Swap branches 1 and 2** (`if (unread) return 'new-messages'` first) → must fail the precedence test
   and only that one.
2. **Drop one clause from the disjunction** → must fail exactly one single-fact test.
3. **`&&` in place of one `||`** → must fail at least two single-fact tests.
4. **`>=`-shaped widening: annotate the return as `string`** → `npm run typecheck` still passes and no
   test fails. This is the one AC no test in this file can defend; it is defended by #800's prop type.
   Note it in the PR rather than inventing a type-level assertion idiom this repo does not use.

Mutation 4 is listed because it is honest about the gap, not because it is fixable here.

Gates: `npm test`, `npm run typecheck`, `npm run build`.

## Open questions

- **"Any of the four facts is working" is a ticket-level ruling, not an inherited fact**, and the ticket
  names it as the one decision worth overruling. The spec implements it as written: a stalled turn, an
  API retry and a compaction are all the assistant mid-work, and reading any of them as idle would be a
  false negative on the state the operator most wants to see. If the operator wants a narrower reading
  (`turnRunning` only, with the other three as some fourth colour), that is a change to `isWorking` and
  to three of this file's tests, and nothing else — the precedence structure is unaffected.
- **Slot 0's eventual shape is #802's**, not this ticket's. This spec reserves the position and states
  nothing about how an outstanding prompt will be attributed to a conversation; ADR 0009 is the live
  blocker and a wire change is what unblocks it.
