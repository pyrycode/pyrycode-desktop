# #643 — Carry the tool input fields onto the timeline tool-call item

Store slice. Widens the two renderer-local hops between the `toolUse` `DaemonEvent` and the
`toolCall` `ThreadItem` so the tool's input map (#642, `events.ts:390`) reaches the item. Interprets
it in neither hop — the headline pick, the shortening and the fallback are #645's decisions.

**Ships dormant.** No row reads the new field until #645 lands. `ConversationScreen.tsx:550` (the
`toolCall` render arm) and `:1053` are untouched.

**Size: XS.** Two production files, four production lines. Verified against the red lines: 2 new
production files (limit 3), ~4 production lines + doc comments + ~110 test lines (limit ~600 total),
0 new exported types (limit 5), 0 forced construction sites (limit 10), 5 acceptance criteria
(limit 5), 0 reject branches (limit 10). No split.

## Design source

N/A — store-only slice, ships dormant behind an unchanged render arm. The visual design of the tool
row is #645's, and its spec owns the Figma anchor. No pixel of this slice is user-visible.

## Files to read first

| Path | What to extract |
|---|---|
| `src/shared/ipc/events.ts:374-391` | The source arm. `input?: Readonly<Record<string, string>>` at `:390` is the **exact shape to mirror** at both targets. `:374-383` is the **correct** absence/emptiness doc comment — model the two renderer comments on this one. |
| `src/renderer/src/store/threadTimeline.ts:40-51` | `ThreadItem` union; the `toolCall` member is `:42-51`. **Target 1** (type). |
| `src/renderer/src/store/threadTimeline.ts:90-94` | `ThreadEvent` union; the `toolUse` arm is the single-line `:94`. **Target 2** (type). |
| `src/renderer/src/store/threadTimeline.ts:275-292` | The reducer's `toolUse` arm; the appended literal is `:281-286`. **Target 3** (assignment). |
| `src/renderer/src/store/threadTimeline.ts:232-247` | `fillResult`. The spread at `:243` is `{ ...item, result }` — preserves the map by construction. **No production change here**; AC4 is a regression pin. |
| `src/renderer/src/store/timelineBridge.ts:37-57` | `translateTimelineEvent`; the `toolUse` arm is `:47`, its fresh literal `:51-58`. **Target 4** (assignment). Read `:21-36` for the fresh-literal / filter-not-remap discipline the comment must stay consistent with. |
| `src/renderer/src/store/timelineBridge.test.ts:61-79` | The existing bridge `toolUse` test. Its `toEqual` literal carries no `input` and **still passes unchanged** — see § Why nothing else moves. |
| `src/renderer/src/store/threadTimeline.test.ts:17-83` | The fixture-builder block (`toolUse(...)` is `:22-24`) and the `run(...)` helper at `:81`. This file builds events **only** through builders — never inline literals. **Leave `toolUse(...)` untouched** and add a sibling; see § Testing strategy. |
| `src/renderer/src/store/timelineBridge.test.ts:461-495` | The inline `DaemonEvent[]` sequence idiom used by that file's store-drive tests — the shape the new bridge cases follow. |
| `docs/knowledge/codebase/642.md` | The upstream contract: why absent ≠ empty, and the narrower's guarantees (values already strings, reserved keys already stripped). |

## Context

pyrycode#1678 added a sixth `tool_use` field, `input` — the tool's own input fields as
name → value. #642 / PR #695 decoded it and carried it to the renderer's IPC boundary. Nothing
consumes it yet. This slice moves it the last two hops to the timeline item; #645 draws it.

Both hops are thin renames today: the bridge arm selects the `toolUse` arm and rebuilds it as a
fresh literal with named fields, and the reducer appends a `toolCall` item with `result: null`. This
slice widens both to carry one more field and changes the character of neither.

### The one hard fact

**Absence and emptiness are different facts.** The Go field carries no `omitempty` and normalises a
nil map to `{}`, so from a post-#1678 daemon `input` is *always present*: absent, empty, and
non-object inputs all arrive as `{}`. An **absent** map means exactly one thing — a **pre-#1678
daemon**. The operator builds daemon and client days apart, so collapsing the two breaks his
older-daemon days.

## Design

Four production edits. Nothing else.

### 1. `ThreadEvent` `toolUse` arm (`threadTimeline.ts:94`)

Add `input?: Readonly<Record<string, string>>`, matching `events.ts:390` character-for-character so
the bridge assigns with no cast.

The arm is currently a single-line union member with no doc comment. Expand it to the multi-line
object form used by the neighbouring arms (`apiRetry` `:107`, `unrecognizedMessage`) and give it a
comment — the field's contract has to travel with it, and there is nowhere else in this file to put
it.

`Readonly<Record<string, string>>` is built from TS built-ins only, so writing it inline preserves
this file's deliberate wire-free posture (the `SessionBoundaryReason` / `UnrecognizedSite`
re-declaration convention at `:14-27`). **Do not import the type from `@shared/ipc/events`.**

### 2. `ThreadItem` `toolCall` member (`threadTimeline.ts:42-51`)

The same field, the same shape, beside `inputSummary` at `:47`. Optional, so every existing
construction site keeps compiling untouched.

### 3. Bridge assignment (`timelineBridge.ts:51-58`)

Add `input: event.input` to the fresh literal. **Unconditional, by reference.**

Three things this must not be, each of which breaks a stated AC:

- `{ ...event.input }` — on an absent map this yields `{}`, converting *absent* into *empty* and
  breaking AC3. Structured clone already handed the renderer its own copy; there is nothing left to
  defend against.
- `...(event.input !== undefined && { input: event.input })` — a conditional spread reshapes the
  literal and breaks AC2's "stays a rename". It is also unnecessary: see § Why the unconditional
  assignment type-checks.
- Any filtering, sorting, or key probing — breaks AC5.

The existing comment at `:48-50` says the two shapes are "field-for-field identical, so this is a
filter + fresh copy (arm selection), not a field remap." That stays true and should stay written.
Extend it with the absence/emptiness contract and the untrusted-text warning.

### 4. Reducer assignment (`threadTimeline.ts:281-286`)

Add `input: event.input` to the appended `toolCall` literal, beside `inputSummary` at `:286`. Same
discipline, same three prohibitions.

### `fillResult` — no production change

`fillResult` (`:232`) resolves a call via `{ ...item, result }` at `:243`. The spread already
preserves any field the item gained, including this one. AC4 is a **regression pin against a future
edit**, not work: it costs a test and zero production lines. Do not "fix" `fillResult`.

### Why the unconditional assignment type-checks

`exactOptionalPropertyTypes` is **not** enabled — neither `tsconfig.node.json:14` nor
`tsconfig.web.json:11` sets it, and `strict: true` does not imply it. So assigning a
possibly-`undefined` value to an optional property is legal, and `input: event.input` compiles at
both hops with no cast and no guard. This is the fact that makes the conditional spread unnecessary
rather than merely undesirable.

### What the doc comments must and must not say

Model both on `events.ts:374-383`, which states the mechanism correctly.

Must carry forward: absent means a pre-#1678 daemon and is tested `=== undefined`, never
`'input' in …`; an empty map is a different fact and is never collapsed into absence; keys **and**
values are untrusted, model-influenced daemon text under the same plain-text-never-HTML constraint
as `name` / `inputSummary`, with #645 owning the DOM sink; key order is meaningless (a Go map
artefact) and the map may be incomplete, so a consumer iterates rather than probes by key.

**Must not** repeat the sentence at `daemonConnection.ts:829` or `inboundMessage.ts:965`. Both
state the mechanism wrongly — they say structured clone drops an `undefined`-valued property, which
is `JSON.stringify`'s behaviour, not structured clone's. That is #642's outstanding SHOULD FIX,
still unapplied on `main`, and **out of scope here**. Do not fix them either; do not copy them.

## State + concurrency model

Unchanged. `translateTimelineEvent` stays pure and synchronous; `reduceTimeline` stays a pure
reducer returning fresh state; the same-reference no-op contract on `fillResult` is untouched. No
new subscription, no new async work, no teardown change. `items` remains Mode A state (survives a
reconnect); the field rides inside an existing item and inherits that.

## Error handling

No new failure mode. The narrower (`inboundMessage.ts`) already threw on every malformed shape
before this hop, so by construction the renderer receives either `undefined` or an object whose
values are all strings with reserved keys stripped. There is nothing left for this slice to
validate, and validating anyway would be the defensive re-copy AC2 forbids.

The one behaviour worth naming: a pre-#1678 daemon produces `input === undefined` on the item, and
#645 must render that as "no fields known", never as "no fields sent".

## Testing strategy

Unit tests only (`npm test`, vitest). Two files, ~5 cases. No rendering assertions — this slice has
no render surface.

**Equality idiom is load-bearing.** Both files use `toEqual` (53× / 21×) and `toStrictEqual` **0×**,
and `toEqual` treats a present-but-`undefined` property as equal to a missing one. That is fine for
the unchanged-item half of AC3, but the absence half **must** assert `item.input === undefined`
directly. Do not reach for `toStrictEqual`, `'input' in item`, `Object.keys`, or `hasOwnProperty` —
each of them tests the property's presence, which is not the fact under test and which structured
clone does not preserve the way those checks assume.

**Fixture shape differs per file, and each follows its own local idiom.**

- `timelineBridge.test.ts` builds inline `DaemonEvent` literals (`:461-495`) — the new bridge cases
  do the same, adding `input` to the literal.
- `threadTimeline.test.ts` builds events **only** through the fixture builders at `:17-77` and never
  inline. Add a **sibling builder** beside `toolUse(...)` — one that takes the map — rather than
  widening `toolUse(...)` itself. Widening it would either reorder against its `name = 'Read'`
  default at position 3, or push a present-`undefined` `input` into all 20+ existing callers'
  fixtures. A sibling costs three lines and leaves every existing caller byte-identical.

**Key-order trap:** use non-numeric keys in the order test. JS reorders integer-like string keys
(`"1"`, `"2"`) ahead of the rest regardless of insertion order, so a fixture keyed that way would
make the assertion test the engine rather than the code.

### `timelineBridge.test.ts`

- A `toolUse` `DaemonEvent` carrying a several-field map translates to a `ThreadEvent` whose `input`
  holds the same keys, the same values, and the same key order. Assert the map is carried **by
  reference** (`toBe` against the source map) while the containing event stays a fresh literal
  (`not.toBe` against the source event) — the two halves of AC2 in one case.
- A `toolUse` event with `input` absent translates to a `ThreadEvent` whose `input === undefined`,
  and whose other five fields are unchanged.
- A `toolUse` event carrying `{}` translates to a `ThreadEvent` whose `input` is an empty map and is
  **not** `undefined` — the distinctness half of AC3 at this hop.

### `threadTimeline.test.ts`

- A `toolUse` `ThreadEvent` carrying a several-field map appends a `toolCall` item whose `input`
  holds the same keys, values and key order, carried by reference. Covers AC1/AC2 at the reducer.
- An event whose map is absent appends an item with `input === undefined`, otherwise equal to what
  the reducer produces today. An event carrying `{}` appends an item carrying `{}`. AC3 end to end.
- Resolving a call whose map is non-empty leaves the map intact on the replaced item — drive
  `toolUse` then a correlated `toolResult` and assert the map survives, still by reference. AC4's
  regression pin.

### AC5 has no positive test

"No store-level interpretation" is proved by the diff, not by an assertion — there is no code to
call. The by-reference and key-order assertions above are what would fail if interpretation crept
in. Code review reads the diff for it.

## Why nothing else moves

The field is optional at both new sites, so no existing construction site is forced to change:

- Six test files build `toolUse` events; none needs touching.
- Ten `toolCall` item literals in `ConversationScreen.test.tsx` (`:188`–`:1071`); none needs
  touching.
- `timelineBridge.test.ts:61-79`'s `toEqual` literal carries no `input`. After the change
  `translated.input` is a present-`undefined` property, which `toEqual` treats as equal to missing —
  **the test passes unchanged.** The same holds for every `toEqual` on items in
  `threadTimeline.test.ts`. If the developer sees one of these go red, the cause is a conditional
  spread or a re-copy, not a stale fixture.
- `ConversationScreen.tsx:550` / `:1053` read the item and are unaffected by a widened optional
  field. Nothing renders it this slice.

Gate: `npm run build` (typecheck + build) and `npm test`.

## Security

No `security-sensitive` label — correctly, by the parse-vs-carry line this project has held since
#204/#215. #642 owned the parse (the decoder, the reserved-key strip) and carried the label; #645
owns the DOM sink and will be assessed on its own. This slice neither parses nor renders; it moves
an already-narrowed value between two renderer-local types. The untrusted-text constraint travels
with the field in the doc comments rather than being enforced here, because there is no sink here to
enforce it at.

## Open questions

None blocking. One noted for #645: a pre-#1678 daemon (`input === undefined`) and a daemon that sent
no fields (`input` is `{}`) are distinct at the item, and #645 must decide whether they read
differently in the row. This slice's job is only to make sure the distinction survives long enough
for #645 to have that choice.
