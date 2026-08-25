# #784 — carry the conversation id on the `unrecognizedMessage` IPC arm

The ninth arm of #675's widening family, and the last one whose id is on the wire. `assistantDelta`
(#751), `turnEnd` (#752), `toolUse` (#763), `toolResult` (#766) and the four sub-state arms
(`turnState` #724, `stallDetected` #732, `apiRetry` #737, `compacting` #742) already shipped it.
**This spec follows that shipped pattern rather than re-deriving it** — the sibling commits are the
authority on wording and shape.

One thing makes it not a copy of its siblings: it is the **first widening to land after
`timelineTargetFor` exists** (#756 built it once all eight prior widenings had merged), so it must
also move the arm between that function's two groups. That is the third production file, and it is
where this ticket's real work and its real traps are.

## Design source

N/A — a transport/IPC widening with no rendered surface. The ticket body has no `## Figma` section
and needs none: AC4 makes "nothing the operator sees changes" a criterion, and the eight shipped
sibling arms landed the same way. The visual-fidelity check is intentionally skipped.

## Base — verified, and it did not move

The body measured against `main` at **`a768795`**, which is still `HEAD` and still `origin/main`
(`git fetch origin --prune` run this pass). **Every line number in the body was re-checked against
the working tree and all of them are exact** — the first clean sweep of this family. Use the body's
citations as written; they are not stale.

## Files to read first

codegraph is wired but not indexed for this repo (`.codegraph/` holds config only, no DB) — every
`codegraph_*` call errors `CodeGraph not initialized`. This list was built by grep + read instead.

| Path | What to extract |
| --- | --- |
| `src/shared/ipc/events.ts:401-431` | The arm: its doc comment (the two false sentences at `:422-424`) and the braced union member that gains the field. |
| `src/shared/ipc/events.ts:105-129` | **The template.** #751's shipped `assistantDelta` prose — the "REQUIRED, never optional" paragraph and the "daemon-asserted ROUTING KEY, not rendered text" paragraph. Read before writing prose; the body points at `:119-125` for the security posture specifically. |
| `src/main/daemonConnection.ts:826-844` | The `case 'unrecognized-message':` emit — the comment block (two false claims) and the fresh literal that gains one line. |
| `src/main/daemonConnection.ts:886-924` | #763's / #766's shipped `tool-use` + `tool-result` emits. Byte-level template for the comment repair. |
| `src/renderer/src/store/timelineBridge.ts:124-137` | The translator arm. **Its comment is this ticket's to repair** (§ The load-bearing comment) — unlike the sibling widenings, where it belonged to the follow-up. The returned literal does **not** change. |
| `src/renderer/src/store/timelineBridge.ts:105-123` | The repaired `apiRetry` / `compacting` arm comments — the exact sentence shape the repair at `:125-130` should echo. |
| `src/renderer/src/store/timelineBridge.ts:228-291` | `timelineTargetFor` + its docblock. The two case groups, both censuses, and the `'conversationId' in event` ban. |
| `src/main/transport/inboundMessage.ts:851-869` | `parseUnrecognizedMessagePayload` — already `requireString`s `conversation_id` at `:855`. **Confirms the decode needs no change** (AC2). |
| `src/renderer/src/store/timelineBridge.test.ts:442-516` | `timelineTargetFor`'s tests: the `idCarrying` table, its `toHaveLength(8)`, the census comment at `:494-495`, and the standalone null test at `:507`. |
| `src/renderer/src/store/timelineBridge.test.ts:923-1084` | The dual-write block — `wired()`, `sliceOf`, `textOf`, and the AC1/AC2/AC3 tests. The new AC3 test belongs here and copies AC1's shape. |
| `src/main/daemonConnection.test.ts:2462-2556` | The four `unrecognized_message` tests: the `UNRECOGNIZED` constant, two `toEqual` fixtures, the `not.toContain` guard, the anti-smuggle `Object.keys` guard. |
| `docs/specs/architecture/766-toolresult-conversation-id-arm.md` | The immediately preceding widening's spec. Same shape, same rulings, same must-NOT-sweep discipline. |
| `CLAUDE.md` § Conventions | Sealed event shapes, transport-out-of-the-window, untrusted-daemon-text rules. |

## Context

`UnrecognizedMessagePayload` carries `conversation_id` first on the wire and the decoder already
requires it (`src/shared/wire/types.ts:638-644`, `inboundMessage.ts:855`). The emit throws it away
and documents that it does so. The renderer now holds a whole timeline per conversation, and
`timelineTargetFor` returns `null` for this arm, so the composition root's gate drops it from the
keyed path. Today that is invisible — the arm still reaches the flat store, which is what the screen
renders. Once the screen reads its own slice (#758), a parser-gap row stops appearing at all, and
this row exists precisely to make an otherwise-silent gap in the daemon's stream mapping visible.

## Design

Three production files. **Two executable production lines** (the emit, and the moved `case` label).
Everything else is comment repair.

### The type — `src/shared/ipc/events.ts:425-431`

The braced union member gains a required `conversationId: string`, placed **first**, matching
`toolUse` (`:498-506`) and `backgroundTaskRoster` (`:395-400`):

```ts
| {
    type: 'unrecognizedMessage'
    conversationId: string
    site: WireUnrecognizedSite
    …
  }
```

**Required, never optional.** An optional routing key invites the `?? activeConversation` fallback
that #675 exists to remove — stated in the body, in #675, and in all eight sibling arms.

### The emit — `src/main/daemonConnection.ts:838`

One line added to the existing fresh literal, copied **by name**:

```ts
conversationId: inbound.unrecognized.conversation_id,
```

Read **bare** — no `?? ''`, no default. `parseUnrecognizedMessagePayload` already requires the
field, so a missing or non-string id drops the whole line upstream. A fallback here would convert
that fail-closed drop into a silent misattribution.

Copied by name onto the existing literal, **never** by spreading `inbound.unrecognized`. That
discipline earns its keep on this arm more than any other: this is the arm whose payload is
unbounded daemon-relayed JSON, so the field list must be the one an operator agreed to render.
The anti-smuggle guard at `daemonConnection.test.ts:2538-2556` is what pins it.

### The routing switch — `src/renderer/src/store/timelineBridge.ts:262-291`

`case 'unrecognizedMessage':` moves from the id-less group (`:279`) into the id-carrying group,
joining the fall-through above `return event.conversationId`. TypeScript narrows across grouped
cases, so the field resolves with no cast and no probe. **This is the second executable line, and
it is a `case` label move — not an added branch.**

`'conversationId' in event` stays banned (`:245-249`): structured clone preserves an `undefined`
property across the IPC bridge, so `in` would be true for a future optional arm while
`Extract<DaemonEvent, { conversationId: string }>` would exclude it.

Both censuses in that function then need truing up — see § Sites that change. **A census claim in
this family always has a twin**; the `conversationTimelineStore.ts:10-12` twin is deliberately
**out of scope** and belongs to #787.

### The translator arm — no code change, one comment repair

`translateTimelineEvent`'s `case 'unrecognizedMessage':` (`:124-137`) rebuilds a fresh `ThreadEvent`
from named fields. It does not spread, so the new field is dropped there with **no code edit**, and
`ThreadEvent` must not gain one (AC4). This is measured, not asserted — see § Measured probe.

### The decode — no change

`parseUnrecognizedMessagePayload` already does `requireString(payload, 'conversation_id')` at
`:855`. Zero decode lines. Ninth arm running.

## The load-bearing comment — and why it is this ticket's, not #787's

`timelineBridge.ts:125-130` says the DaemonEvent and the ThreadEvent are "field-for-field identical"
and the translator is "a pure rename". After this ticket the DaemonEvent carries a field the
ThreadEvent deliberately drops, so it becomes a field-**dropping** filter. #764's spec is explicit
about why it matters: left stale it "invites the 'simplify this to a pass-through' edit that would
carry the id into the reducer silently while the comment still read as if that were safe."

**"Field-for-field identical" has two meanings one line apart in this repo — sort by WHICH TWO
SHAPES the sentence compares, never by the phrase** (~55 repo hits):

| Site | Compares | Verdict |
| --- | --- | --- |
| `timelineBridge.ts:125-130` | **DaemonEvent ↔ ThreadEvent** | **Goes FALSE. Repair it here.** |
| `threadTimeline.ts:151` | **ThreadEvent ↔ ThreadItem** (both renderer-local, both id-free) | Stays TRUE. Out of file set. #787's, and only to *add* a widening clause. |
| `src/shared/wire/types.ts:*` (`:616` included) | wire ↔ daemon | Stays TRUE. Never touch. |

Repair templates: the `apiRetry` (`:105-110`) and `compacting` (`:117-122`) arms in the same file,
both of which already read "The DaemonEvent carries `conversationId` (#…) beside the N render
fields; the ThreadEvent this returns does not, so the id STOPS here."

### Resolving one contradiction in the ticket body

The body lists `threadTimeline.ts:151-152` **both** under "Three further citations … belong to #787"
**and** under "Do not correct these — they stay true." Both are right, and #787's body settles it:
the claim itself stays true, and what #787 adds is the missing *widening clause* the four widened
siblings carry (`threadTimeline.ts:144-145` etc.). `git log -L` confirms the precedent — the
`compacting` widening clause was added by **`ecf2169` (#743, the retirement ticket)**, not by #742,
the widening. **For this ticket the ruling is simple: `threadTimeline.ts` is not in the file set and
is not touched.** Do not raise it as a miss.

## State + concurrency model

Unchanged. No store slice, no subscription, no async task, no teardown is touched. The field rides
an existing synchronous emit on an existing arm; `translateTimelineEvent` and `timelineTargetFor`
are both pure functions over one event; the fan-out at `timelineBridge.ts:346-351` is two synchronous
zustand `set`s with no `await` between them. `emitDaemonEvent` remains the single choke point.

The one behavioural delta: the arm now takes the **non-null branch** of the existing gate, so it
writes to the keyed holder as well as the flat store. Flat-first ordering is unchanged and is what
keeps AC4 true.

## Error handling

Unchanged, and deliberately so. The failure mode (missing / non-string `conversation_id`) is handled
one layer up, in the decoder, by dropping the whole line without emitting. No new result type, no
new UI surface, no banner, no dialog. The one thing this ticket must **not** do is add a recovery
path at the emit — see AC2.

## Measured probe — run live this pass on `a768795`

Applying only the three production edits above (no comments):

| Layer | Result |
| --- | --- |
| `tsc -p tsconfig.node.json` | **0 errors** with type + emit applied together. Applied alone, the type errors at the emit — so the emit **is** tsc-forced. Every fixture cascade is web-side. |
| `tsc -p tsconfig.web.json` | **7 errors across 3 test files** |
| `vitest run` | **6 failures in wave 1; a 7th only appears in wave 2** |
| `timelineBridge.test.ts` translator tests | The id demonstrably stops at the bridge — see below |

The 7 tsc-forced sites, **at the lines tsc reports** (the literal's opening line, one above the
`type:` line):

`daemonEventBridge.test.ts:388` · `modalBridge.test.ts:166` ·
`timelineBridge.test.ts:259, 279, 508, 1037, 1073`

### tsc points at 7 literals — but only 5 get the field

**This is the trap a mechanical "add `conversationId` to every tsc error" pass walks straight into.**

| Site | Action |
| --- | --- |
| `daemonEventBridge.test.ts:388`, `modalBridge.test.ts:166`, `timelineBridge.test.ts:259`, `:279` | **Widen** — add `conversationId: 'conv-1'`. |
| `timelineBridge.test.ts:508` | **Absorb** into the `idCarrying` table; the standalone test goes. See § Testing strategy. |
| `timelineBridge.test.ts:1037` | **Delete** — this is the `idLess` array entry, and the arm is no longer id-less. Widening it here leaves the test asserting the opposite of AC3. |
| `timelineBridge.test.ts:1073` | **Replace** — the no-fallback probe swaps to `sessionTransition`. |

### The ordering trap — budget seven failures, not six

`vitest` reports at the **call** line, and two assertions in one `it` mean the second is masked:

1. Run 1 shows **6** failures: `daemonConnection.test.ts:2486`, `:2513`, `:2548`;
   `timelineBridge.test.ts:515`, `:1055`, `:1082`.
2. Fixing the two `toEqual` fixtures exposes a **7th**: the `not.toContain('conv-1')` guard at
   `:2496`, which run 1 never reached because the `toEqual` above it failed first.

**Confirmed live in this pass** — wave 2 reported it at `:2497:40` (shifted one line by the fixture
add). **Never quote the failure count from a single run.**

Two probe results worth quoting directly:

- The anti-smuggle guard's actual output is `[ 'conversationId', …(5) ]` — **`conversationId` sorts
  first** among the six names.
- `timelineBridge.test.ts:515` fails as **`expected undefined to be null`**, not `expected 'conv-1'
  to be null` — because the fixture at `:508` is not yet widened. That message is the routing move
  working, not a bug.

## Sites that change — the census

Rebuilt by grepping the drop-predicate, the arm's comment blocks, and test **names** separately.
**The body's census is short by three**, all in `timelineBridge.test.ts` and all compiler- and
suite-blind: `:487`, `:488` and `:494-495` (marked ★ below).

### Production — 3 files

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `events.ts:425-431` | The arm type gains the field. | tsc | 1 |
| `events.ts:422-424` | "`conversation_id` is dropped at the emit (single active conversation)" **and** "Ships dormant: all three exhaustive bridges no-op it until the render slice". **Both halves false**; the second has been false since #756. Replace with the `assistantDelta` posture prose (`:109-125`). | nothing | 4 |
| `daemonConnection.ts:838` | The emit. | tsc (node) | 1 |
| `daemonConnection.ts:827` | "carrying the **four** display fields" → five. | nothing | 4 |
| `daemonConnection.ts:832-833` | "`conversation_id` is DROPPED (never referenced — single active conversation)". | nothing | 4 |
| `timelineBridge.ts:271-277` | The `case` label joins the id-carrying group; census "**Eight** of the eleven owned arms" → nine, and the ticket list gains **#784**. | vitest | 1, 3 |
| `timelineBridge.ts:279-286` | The `case` label leaves; census "**The other three** owned arms" → two, and the `unrecognizedMessage` clause goes. | vitest | 3 |
| `timelineBridge.ts:125-130` | **The load-bearing one.** "field-for-field identical" / "pure rename" → field-dropping filter. | nothing | 4 |

### Tests — 4 files

| Site | What changes | Enforced by | AC |
| --- | --- | --- | --- |
| `daemonEventBridge.test.ts:388` | `DaemonEvent` fixture. | tsc | 1 |
| `modalBridge.test.ts:166` | `DaemonEvent` fixture. Its two neighbours at `:161`, `:163` already carry the field — copy their shape. | tsc | 1 |
| `timelineBridge.test.ts:259`, `:279` | `DaemonEvent` fixtures. | tsc | 1 |
| `timelineBridge.test.ts:447-485` | **ADD** a ninth `idCarrying` row with a DISTINCT id (`'conv-unrecognized'` — the table's stated rule at `:444-445`). **Nothing forces this add.** | nothing | 3 |
| ★ `timelineBridge.test.ts:487` | Test **name**: "(all **eight**)" → nine. | nothing | 3 |
| ★ `timelineBridge.test.ts:488` | `toHaveLength(8)` → `9`. Fires **only if** the row above was added — it is the guard on the add, not a substitute for it. | vitest | 3 |
| ★ `timelineBridge.test.ts:494-495` | Census **comment**: "The **three** owned arms that carry no routing key" → two. | nothing | 3 |
| `timelineBridge.test.ts:507-516` | The standalone "returns null for unrecognizedMessage" test. **Absorbed into the table; delete.** | vitest | 3 |
| `timelineBridge.test.ts:1026` | Test **name** "the **three** id-less owned arms" → two. | nothing | 3 |
| `timelineBridge.test.ts:1029-1045` | Drop the arm from the `idLess` array. | tsc | 3 |
| `timelineBridge.test.ts:1050-1053` | Expected flat row list `['sessionBoundary', 'unrecognizedMessage']` → `['sessionBoundary']`. | vitest | 3 |
| `timelineBridge.test.ts:1058-1083` | **Swap the probe** to `sessionTransition`. Do NOT delete. | vitest | 3 |
| `timelineBridge.test.ts` dual-write block | **NEW test** — the arm lands in its own slice and no other, and still reaches flat. | — | 3, 4 |
| `daemonConnection.test.ts:2479` | Test **name**: "the **four** display fields, **dropping conversation_id**". Both halves. | nothing | 4 |
| `daemonConnection.test.ts:2486` | `toEqual` fixture. | vitest (wave 1) | 1 |
| `daemonConnection.test.ts:2495` | The **comment** above the guard. | nothing | 4 |
| `daemonConnection.test.ts:2496` | `not.toContain('conv-1')` → **inverts** to a positive `toContain`. | vitest (**wave 2 only**) | 1 |
| `daemonConnection.test.ts:2513` | `toEqual` fixture. | vitest (wave 1) | 1 |
| `daemonConnection.test.ts:2538` | Test **name**: "exactly the **four** modeled properties" → five. | nothing | 4 |
| `daemonConnection.test.ts:2548-2554` | `Object.keys().sort()` five names → six, `'conversationId'` **first**. The `must-not-cross` half is what it defends and stays. | vitest (wave 1) | 1 |

**Eleven sites are invisible to the compiler**, and eight of those are invisible to the suite as
well. Three of that eight (★) are absent from the ticket body.

### Cheap completeness check

There is **no contrast class** here — `rg -i "unlike unrecognized" src/ e2e/` returns **0** today
(verified this pass), unlike #766's three `unlike toolResult` sites. Nothing to sweep.

`rg -n "the other three|Eight of the|all eight|three id-less|three owned arms" src/` returns exactly
the five census sites tabled above (three of them ★). After the change none may still read "three"
or "eight" **about this function's groups** — but note `conversationTimelineStore.ts:10-12` also
matches and is deliberately **out of scope** (#787).

## Must-NOT-sweep — sites that look identical and must stay untouched

A grep for the drop-claim over-matches badly here.

| Site | Why it stays |
| --- | --- |
| `timelineBridge.test.ts:268`, `:287` | **`ThreadEvent` expectations**, sitting 8 lines below the `DaemonEvent` literals at `:259` / `:279` that *do* gain the field. tsc does not flag them, and that silence is the proof the id stops at the bridge. Adjacent, opposite requirements — classify by which union each is checked against, never by the spelling. |
| `threadTimeline.test.ts:92` | The `unrecognizedMessage()` fixture **helper** builds the **ThreadEvent** shape for `reduceTimeline`. tsc never flags it, so nothing forces it and nothing stops a sweep from "fixing" it. Editing it also breaks this ticket's no-helper-changes size claim. |
| `threadTimeline.ts:151-152`, `:96`, `:128-130` | Out of file set. `:151` compares ThreadEvent↔ThreadItem and stays true (#787 adds a clause); `:96` is union-wide and stays true; `:128-130`'s clause-less `sessionBoundary` is the **control**, not an omission — `sessionTransition` has no wire id to widen. |
| `inboundMessage.ts:189-192`, `conversationTimelineStore.ts:10-12` | Genuinely false after this ticket, and **#787's**, per the family's settled in-file/out-of-file convention (`docs/specs/architecture/764-…md`; six precedents). Pulling them in puts this ticket at five production files. Leaving them stale is correct, not a miss. |
| `timelineBridge.ts:26` | The docblock's "eleven timeline arms" list. The count is unchanged and every arm is still owned. |
| `timelineBridge.ts:308-309` | "`timelineTargetFor` is called only on the non-null path, so its `default` group is unreachable in production." Still true. |
| `timelineBridge.test.ts:39` | `describe('translateTimelineEvent — the two owned arms')` — already stale (there are eleven), **pre-existing and not this ticket's**. Do not fold in. |
| `events.ts:233`, `:249`, `:257`, `:310` | Four comments naming `unrecognizedMessage` as a comparison for *other* arms (identity-report contrast, truncation sharpness, untrusted-text warning). **None carries a drop-claim**; all stay true. Checked individually this pass. |
| `modalBridge.ts:100-113` | Scoped to the modal store. Unaffected. |
| `daemonConnection.ts:615, :634, :650, :668, :691` | Five sibling-arm "a missing or non-string `conversation_id` drops the whole line without emitting" comments. All still true, and the idiom to **copy**. |
| `daemonConnection.test.ts:2963`, `:3022` | `not.toContain('"input"')` (toolUse) and `toolResult`'s already-inverted guard. Different arms. **After this ticket, `not.toContain('conv-1')` in this file must return 0 hits.** |
| `e2e/thread-scroll-pin.spec.ts:304` | A comment about which **ThreadItem** kinds draw an element. No `DaemonEvent` literal exists anywhere under `e2e/` (verified this pass), and `e2e/` is in neither tsconfig. |

Blast radius confirmed by grep: **no consumer spreads a daemon event.**

## Testing strategy

**One new test.** Everything else is fixture widening, one deletion, one probe swap, and name/comment
repair.

### AC2 is already green — confirm, write nothing

`inboundMessage.ts:855` already `requireString`s the field, and `inboundMessage.test.ts` already
loops every required field through the missing and non-string cases. **Do not write an emit-layer
fail-closed test**: it would be *vacuous*, because `:855` throws first and the emit line is
unreachable on a bad id, so no mutation there can make such a test red. AC2's second half (the
`?? ''` ban) is an **inspection** criterion, not a testable one. #763 and #766 both added none and
both passed review.

### The `idCarrying` table is the home for AC3's routing half

The body suggests inverting the standalone test at `:507`. **Prefer moving the arm into the
`idCarrying` table instead**, and deleting the standalone. Three reasons:

1. All eight id-carrying arms already live in that table; a ninth kept outside it creates exactly
   the census the next widening gets wrong.
2. `toHaveLength(9)` makes the count a *checked* fact rather than a comment.
3. The table's own rule (`:444-445`) — every row uses a **distinct** id — turns a copy-paste that
   reads a neighbour's field into a failure instead of a pass.

Deleting `:507-516` is correct **because the table absorbs it**, and `toHaveLength(9)` is the guard
that the absorption actually happened. Deleting it without adding the row leaves the arm's positive
routing untested and nothing would catch that.

### The new test — AC3 end-to-end, in the dual-write block

Add one test beside `timelineBridge.test.ts:958`'s AC1, copying `wired()` / `sliceOf` / `textOf`:

- Emit an `unrecognizedMessage` for `conv-a`; assert its row lands in `conv-a`'s retained slice.
- Emit a second for `conv-b`; assert `conv-b` gets its own slice and `conv-a`'s is untouched **by
  reference** — the `:1023` idiom, not merely `toEqual`.
- Assert the flat store received both rows (AC4's half — the arm still reaches it exactly as today).

Row identity is `kind: 'unrecognizedMessage'`; `textOf` only reads `assistantText`, so assert on
`items.map(i => i.kind)` and length, following `:1050`'s shape.

### The probe swap at `:1058-1083` — and its shelf life

Swap the probe to **`sessionTransition`**, not `connected`: it tail-appends a real row, so it is the
stronger no-fallback probe (`connected` → `reconnected` adds no row). **Do not delete the test** — it
is AC3's only no-fallback proof, and its comment at `:1071-1072` explains why an empty map would pass
for the wrong reason.

**Forward note, not this ticket's problem:** #785 routes *both* remaining id-less arms to the
conversation on screen, which leaves `timelineTargetFor` with no id-less owned arm and no probe for
this test at all. That is #785's to resolve. Flagging it here so review does not treat the swap as
short-sighted, and so #785's architect finds it already named.

## Scope rulings — stated here so they are not re-litigated

**The >10-call-site red line is inapplicable**, on the same grounds as #763 and #766. Its prescribed
remedy is the Strangler Fig pattern, whose optional-first union is **banned by name in #675**
("required, never optional") — a red line whose escape hatch is forbidden upstream is not a split
signal. And it bounds *discovery* cost, which here is **zero**: all 28 sites are tabled with
file:line, 8 forced by tsc, 6 by vitest across two waves, and the compiler-blind remainder carries
its own acceptance criterion.

**A fixture-cascade split would be incoherent**, and is the reason this is not sliced further: the
type does not compile until the fixtures move, so a "type first, fixtures later" child leaves `main`
red. Same ruling as #784's PO pass.

**Size check: `size:s` holds.** 3 production files (below the ≥5 gate), 0 new files, 0 new exported
types, **2 executable production lines**, 4 test files, no fixture helpers, **1 new test**,
4 acceptance criteria, 0 reject branches. Size oracle by real diffstat: #763 `52dc0cc` is +98/−23
across 8 files, #752 `335e5ab` is +78/−13 across 8 files, both shipped S. This ticket adds one
production file and drops three test files relative to #763; the live probe reproduces that shape.
Projected total written work is well under 250 lines.

**Branch-overlap check: clean.** `git fetch origin --prune`, then all **18** `origin/feature/<N>`
branches diffed against `origin/main` — none touches any of the seven files this ticket edits. No
`blockedBy` needed. #784 has no open blocker; #787 is blocked by it, correctly.

## Open questions

None blocking. Three notes for the reviewer:

- **`inboundMessage.ts:189-192` and `conversationTimelineStore.ts:10-12` are deliberately left
  false.** They are #787's, on the family's settled convention. Flagging them here is a false finding.
- **The body's census is short by three** (`timelineBridge.test.ts:487`, `:488`, `:494-495`). They
  are in this spec's table and in scope.
- **One new test is deliberate**, and one is the right number: AC3's routing half is covered by the
  `idCarrying` table row, and only its end-to-end half needs new code.

## Security review

**Verdict:** PASS

**Findings:**

- **[1. Trust boundaries]** No findings — the boundary is explicit and single. The daemon is the
  untrusted source; `conversation_id` crosses into trusted territory at
  `parseUnrecognizedMessagePayload` (`inboundMessage.ts:851-869`) via
  `requireString(payload, 'conversation_id')` at `:855`, which fail-closes with a `WireDecodeError`
  and drops the whole line. Downstream holds the named `UnrecognizedMessagePayload` type, never raw
  `unknown`. **This ticket moves the boundary nowhere** — the field already crossed it and was
  merely discarded afterwards. The IPC hop it now rides is main → renderer, the *trusted*-to-
  untrusted direction, so it grants the renderer no capability; it hands it one already-validated
  short string.

- **[2. Tokens, secrets, credentials]** No findings — nothing is generated, stored, rotated or
  revoked. The emit copies **one named field** from an already-narrowed payload onto an existing
  fresh literal. `conversation_id` is a daemon-generated conversation identifier that already
  crosses this same channel on eleven other arms, so this introduces no new class of data. The
  arm's genuinely dangerous fields — `raw` (unbounded, model-adjacent) and `messageType` — are
  untouched by this ticket, and their plain-text-never-HTML warning at `events.ts:415-419` stays
  exactly as it is. **Do not weaken or reflow that paragraph while repairing the one below it.**

- **[3. File / storage operations]** Not applicable by design — no filesystem path, no persistence,
  no cache is added. The id is never used as a filename, cache key or lookup path here. It becomes a
  `Map` key in the renderer's in-memory `conversationTimelineStore`, which is the routing this
  ticket exists to enable and which #755/#756 already own. Two properties of that store were
  verified this pass rather than assumed: it is bounded at `MAX_RETAINED_TIMELINES = 10`
  (`conversationTimelineStore.ts:113`), and it holds a standing rule that **"Nothing is persisted
  either, and must not be"** (`:68`) — stated there precisely because `defaultWorkspaceStore` and
  `pushNotificationPrefStore` *do* use `localStorage`, so the pattern is in the tree. No renderer
  web storage is reached, and this ticket must not be the one that changes that.

- **[4. Inter-process / Electron attack surface]** No findings, and this is the category that most
  needed walking. No new `contextBridge` API, no new `ipcMain.handle` / `ipcMain.on` channel, no
  `webPreferences` change: one field is added to an existing `DaemonEvent` union member on the
  existing main → renderer broadcast. Process placement is preserved — no crypto, socket or key
  material moves toward the renderer. **The one degradation path worth naming:** replacing the
  by-name copy with a spread of `inbound.unrecognized` would make every field a future decoder grows
  cross IPC automatically. On *this* arm that is the sharpest version of the risk, because the
  payload is unbounded daemon JSON. The by-name idiom, AC4, and the anti-smuggle guard at
  `daemonConnection.test.ts:2538-2556` (which this ticket keeps, widening five names to six)
  together forbid it. Widening the literal does not weaken the guard.

- **[5. Cryptographic primitives]** Not applicable by design — the change sits entirely downstream
  of the Noise session, after decryption and after decode. No RNG, hashing, key derivation, nonce,
  or secret comparison is added or touched. `Noise_IK_25519_ChaChaPoly_BLAKE2s` is not on this diff.

- **[6. Network & I/O]** Not applicable by design — no socket option, frame-size cap, timeout, URL,
  TLS setting or reconnect policy is touched; the change is at the already-decoded IPC emit,
  downstream of `MAX_PLAINTEXT_BYTES` (65519) and the daemon's own 16 KiB `raw` cap. Adversarially:
  a hostile relay or daemon flooding `unrecognized_message` frames has a blast radius that grows by
  exactly one short string per frame, and the new accumulation path is already defended: the eviction
  policy makes the newest never-viewed slice the standing victim, so **an unbounded burst of unknown
  ids displaces at most ONE viewed thread** and thereafter evicts only its own predecessors
  (`conversationTimelineStore.ts:178-181`). That defence was designed for exactly this scenario and
  this ticket neither weakens nor depends on weakening it.
  The arm's deliberate no-dedup / no-coalescing contract (`daemonConnection.ts:833-835`, pinned by
  the test at `:2524`) is **unchanged** — a repeat is a real repeat, and that is the point of the
  diagnostic.

- **[7. Error messages, logs, telemetry]** No findings, verified rather than assumed.
  `emitDaemonEvent.ts` is **log-free by construction** and says so in its header ("a console.log of
  the event would leak MessagePayload.text to main-process stdout"); it was re-read this pass and
  contains no log call. `grep -n unrecognized src/main/daemonConnection.ts` shows no log call on
  this path. The decode-failure path cannot leak daemon-controlled text either: `requireString`
  throws ``missing required field: ${field}`` — the field **name**, a client-owned constant, never
  the offending value (`inboundMessage.ts:307-313`) — and the payload's own throw is the constant
  `'malformed unrecognized_message payload'`. `inboundMessage.ts:848-849` states the standing rule
  that this parser's messages name the failure CATEGORY only, "never the `raw` blob … and never the
  conversation-correlating id". **That rule now binds a field this arm actually carries onward, so
  it must survive intact.** No new error message, throw, or renderer-console path is added.

- **[8. Concurrency]** Not applicable by design — no async task, timer, listener, subscription or
  teardown is added. The emit is a synchronous field copy inside an existing message handler;
  `translateTimelineEvent` and `timelineTargetFor` are pure; the fan-out is two synchronous zustand
  `set`s with no `await` between them. No check-then-act across an `await`, no new shared mutable
  state, no cancellation or shutdown behaviour change.

- **[9. Threat model alignment]** No findings for this ticket; one item explicitly deferred.
  *Hostile daemon response* is addressed — the field is parsed defensively and fail-closed before the
  emit. *Malicious / compromised relay* is unchanged: the relay stays content-blind and on-path, and
  this diff adds neither plaintext exposure nor a new hang point. *Renderer compromise reaching the
  transport* is unchanged: the transport stays in the main process, and the IPC direction is
  outbound. *Token theft from disk* is not applicable — nothing is persisted.
  **OUT OF SCOPE, named:** the id is a *daemon-asserted* routing key, so a buggy or compromised
  daemon could file a parser-gap row against a conversation it did not come from. That trust
  assumption is pre-existing and uniform across all nine arms that now carry the field, and this
  ticket does not change who is trusted. Worst case is a diagnostic row on the wrong thread — the
  same class of misattribution the *current* behaviour already produces, and strictly less of it.
  Validating a received id against the client's known conversations is a cross-cutting decision that
  belongs to #758, the first ticket where the operator sees the routing.

**Non-finding stated explicitly to pre-empt it:** `conversationId` is **required, never optional**,
so there is no absent case. The structured-clone trap that bites *optional* IPC fields (an assigned
`undefined` survives `webContents.send` as a present own property) has no purchase here — and it is
the reason `'conversationId' in event` stays banned at `timelineBridge.ts:245-249`.

**The one real risk, and its control:** adding `?? ''` or any default at the emit would convert the
decoder's fail-closed drop into a silent misattribution — a parser-gap row filed against the wrong
thread, on the one arm whose whole purpose is making a silent gap visible. AC2 forbids it, #675
forbids the optional-typed variant that invites it, and the required type makes the fallback
unnecessary. It is **not** testable at the emit layer (`:855` throws first, so the line is
unreachable on a bad id), so it is enforced by the type plus inspection. Classified SHOULD
FIX-by-construction rather than MUST FIX: the design as specified cannot reach the failure, only a
deviation from it can.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-25
