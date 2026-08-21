# #644 — a display shortener for tool subject paths

**Size:** XS (dropped from `size:s`; the ticket invites the override and the closest precedent, #600's `threadScrollPosition.ts`, is XS at the same shape) · **Security-sensitive:** no · **Ships dormant** — no consumer until #645.

Two new files, both co-located with the conversation screen. One pure function, one exported constant, no imports, no consumer. Nothing in the app renders differently after this lands.

## Design source

N/A — this slice renders nothing. #645 is the UI-visible consumer and carries Figma node `16-28`; code-review's visual-fidelity check belongs there, not here.

## Files to read first

Read the first two entries in full — together they are the whole template for this ticket. The rest are one-glance confirmations.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/threadScrollPosition.ts:1-64` | **The template, near-verbatim.** #600's helper is the same shape: a pure total function with no injected deps, co-located with the screen, exporting one constant beside the function so the test can pin the number the rule hinges on, shipping dormant ahead of its caller (#601). Its module header explains *why it ships unreferenced* — write the same paragraph here. |
| `src/renderer/src/screens/conversation/threadScrollPosition.test.ts:1-73` | The test idiom: a header comment establishing why the unit is testable at all, then one `it` per scenario with the AC number in the title and a comment naming the case. Plain `describe`/`it`/`expect` from `vitest`. Not `it.each` — only three files in the tree use it, and each has a genuinely uniform row shape; this table's rows each need their own sentence. |
| `src/renderer/src/screens/conversation/messageViewModel.ts:1-36` | The doc-comment density for a small pure module: a `//` module header stating what the file is and why it is framework-free, then a `/** */` on each export. ~33–38 non-blank lines total is the local norm. |
| `src/renderer/src/screens/conversation/sendInterrupt.ts:1-35` | Second sample of the same convention, so the two together fix the house voice rather than one file's accident. |
| `vitest.config.ts:24-33` | `environment: 'node'`, `include: ['src/**/*.{test,spec}.{ts,tsx}']`. Confirms a plain `.test.ts` beside the module is picked up with no registration step. |
| Issue #645's body | The consumer. It calls this "the path shortener" and restates no rule, so this spec is the sole definition. It shortens only `kind: read | edit` subjects — which is why this function must not decide what is or is not a path. |

Nothing else in the tree is relevant: there is no existing path helper to extend (`codegraph_context` on the tool-row surface returns only the transport-side `parseToolUsePayload`, and a repo-wide search for a shortening helper returns nothing), and no `node:path` import exists anywhere under `src/renderer/`.

## Context

The tool row draws `inputSummary` today — the daemon's whole tool input squeezed onto one line and cut at 200 characters. #642 and #643 carry the daemon's new `kind`/`subject` onto the timeline item; #645 draws it. This slice is the one piece of that work that has no daemon dependency and no UI: the pure display shortener #645 will call for the file-acting kinds.

It ships unimported on purpose. The same posture as #600 → #601: isolating the total function gives the feature a tested core before any of it touches a component, and it is the reason this piece could be dispatched while its three siblings wait on the daemon.

**The rule contradicted its own example, and PO resolved it.** #606 states the form as "the last three folders plus the file name" — four trailing segments — but illustrates it with `.../screens/conversation/ConversationScreen.tsx`, which keeps two. The example was written with no source path beside it, so nothing ever forced the two to agree. pyrycode#1678 refuses to specify ("shortening for display is the client's job and must not be done here") and mobile has no counterpart helper, so nothing upstream settles it. PO took the rule as written and corrected the example. **This spec implements the rule as written and makes the resolution a single exported number** — see § Design; if the operator meant three segments in total, `KEPT_SEGMENTS` goes from 4 to 3 and one test assertion changes, and nothing else in either file moves.

## Design

### Module

`src/renderer/src/screens/conversation/shortenPath.ts` — **zero imports.** Not React, not a store, not `node:path`. A file with no import statements is the whole of AC4's "no Node `path` import", checkable at a glance in review.

Two exports:

```ts
/** Trailing segments kept when a path is shortened: three folders plus the file name. */
export const KEPT_SEGMENTS = 4

/** Shorten a path to its last few segments for display. Total, pure, no filesystem. */
export function shortenPath(path: string): string
```

`KEPT_SEGMENTS` is exported rather than inlined for one reason: it is the entire content of the resolved ambiguity above, and exporting it lets the test pin the resolution as a named fact instead of leaving it implicit in a dozen expected strings. Same reason `threadScrollPosition.ts:43` exports `AT_BOTTOM_TOLERANCE_PX`.

The `...` prefix stays an inline literal — one occurrence, and AC1 pins its exact code points from the outside.

### The rule, in full

1. Split the input on `/`.
2. Drop every empty entry. This is the whole of the leading / trailing / repeated-separator handling — there is no separate case for any of them.
3. If four or fewer entries remain, **return the input string unchanged**. Not rejoined, not normalised — the original reference, byte for byte.
4. Otherwise return `'.../'` followed by the last four entries joined with a single `/`.

Four steps, no branches beyond the one comparison in step 3. Every ticket edge is a consequence of that shape rather than a case of its own — the same posture as `isAtBottom`'s single comparison. If a case turns up that needs a fifth step, that is a signal the criteria are wrong; route back rather than guard around them.

Two properties fall out of steps 3 and 4 and should be stated in the doc comment, because both are deliberate:

- **The passthrough is verbatim, the shortened form is not.** A path that fits is returned as-is, so `a//b/c.txt` keeps its doubled separator and `a/b/c/` keeps its trailing one — this is a display passthrough, not a normaliser. A path that is shortened is rebuilt from its kept segments, so any doubled separator inside the kept window collapses and a trailing separator is dropped. AC3 pins both halves.
- **The output of step 4 is display text, not a path.** `.../b/c/d/e.txt` does not resolve to anything and is never meant to. Nothing downstream may feed it back into a path operation.

`/` is the only separator, so a backslash is an ordinary character inside a segment: `C:\proj\src\app\main.ts` is one segment and returns verbatim. That is AC4's platform-independence, and it is what makes the result identical on every host — a `node:path` implementation would split there on Windows.

No normalisation of any kind. `.` and `..` are ordinary segments and count toward the budget, so `../a/b/c.txt` is four segments and returns verbatim rather than resolving away the `..`.

### Worked table

The developer should be able to check the implementation against this without running it. Every row is also a test scenario.

| Input | Output | Why |
|---|---|---|
| `a/b/c/d/e.txt` | `.../b/c/d/e.txt` | AC1's literal case. Five segments, four kept. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx` | `.../src/screens/conversation/ConversationScreen.tsx` | The ticket's corrected example. Six segments; pins the rule against #606's two-folder illustration. |
| `src/screens/conversation/X.tsx` | verbatim | Exactly four — the boundary between AC1 and AC2. No `...`. |
| `README.md` | verbatim | No separator at all (AC2). |
| the empty string | the empty string | The empty subject pyrycode#1678 sends for kinds with no meaningful one (AC2). |
| `a//b/c.txt` | verbatim, doubled separator intact | Repeated separator on a path that was not shortened (AC3). |
| `a/b/c/` | verbatim, trailing separator intact | Trailing separator on a path that was not shortened (AC3). |
| `/a/b/c/d/e.txt` | `.../b/c/d/e.txt` | Leading separator: the root is dropped like any other lost segment, and the `...` is honest about it. |
| `a/b//c/d/e.txt` | `.../b/c/d/e.txt` | Rejoined with a **single** `/` — AC3's second sentence. |
| `a/b/c/d/e/` | `.../b/c/d/e` | Trailing separator is **not** preserved once shortened. A consequence of step 2; called out because it is the one asymmetry with the passthrough. |
| `C:\proj\src\app\main.ts` | verbatim | Backslash is not a boundary — one segment (AC4). |
| `one/two/three/four/five\six.txt` | `.../two/three/four/five\six.txt` | Backslash rides inside a kept segment even when the path *is* shortened. |
| `../a/b/c.txt` | verbatim | `..` is an ordinary segment; no normalisation. |
| `/`, `//`, `////` | verbatim | Zero non-empty segments. Falls out of step 3, no guard. |

## State and concurrency model

None. No store slice, no async, no subscription, no teardown, no effect. A total synchronous function of one string. It is not called from anywhere in this slice, so there is nothing to unmount.

## Error handling

There is no failure mode to surface. Split, filter, slice and join cannot throw on a `string`, so the function is total over its declared input type — AC5. That totality is a property of the shape, not of a guard, so **do not add a defensive branch**: no `try`/`catch`, no length cap, no `typeof` check, no null guard. TypeScript's signature is the only contract, and `undefined` is the caller's problem — #645's AC3 already branches on whether a subject is present before calling.

No filesystem access, no `window`, no globals, no clock, no randomness.

## Testing strategy

`src/renderer/src/screens/conversation/shortenPath.test.ts`, beside the module. Plain `describe`/`it`/`expect` from `vitest`; the node environment is irrelevant here since nothing renders.

Open with a short header comment in the sibling's voice: this is a total function of one string, so the environment covers it completely, and it is isolated here precisely so it has a tested core before #645 gives it a caller.

Scenarios — one `it` per row of the worked table above, with the AC number in the title, plus these four:

- **`KEPT_SEGMENTS` is 4, and that is three folders plus the file name.** The pin for the resolved ambiguity. Assert the value, and in a comment name the revert: if the operator meant three segments in total, this number and this assertion are the only things that change.
- **The prefix is three ASCII periods, not `…`.** Assert the first four characters of a shortened result are exactly `.../`, and separately that the result does not contain `\u2026`. Two assertions because the first alone passes on a result that also contains an ellipsis character later.
- **The passthrough returns the input identity, not a rebuilt equal string.** For a path that fits, assert the result `toBe` the same string value — the point is that no rejoin happened. Pair it with the doubled-separator row, which is what would actually differ if a rebuild had run.
- **A sanity anchor against a degenerate implementation.** Without one, a function that returned its argument unchanged would pass every AC2/AC3/AC4 row above. The `a/b/c/d/e.txt` and `ConversationScreen.tsx` rows are that anchor — make sure at least one of them asserts the full expected string rather than a prefix.

No mocks, no spies, no fixtures — every input is a string literal in the assertion.

**What is not tested, and why.** AC4's "no Node `path` import" has no runtime detector on a POSIX CI host: `path.posix` and a hand-rolled `/` split behave identically there, so only a `path.win32` implementation would be caught (by the backslash rows). It is instead checked by inspection — the module has no import statements at all, which is a one-glance property of a 35-line file. Do not add a source-scanning test for it; that is a brittle meta-test for a property review reads for free.

## Scope

Two files, both new:

| File | Approx. size |
|---|---|
| `src/renderer/src/screens/conversation/shortenPath.ts` | ~35 non-blank lines — ~10 executable, the rest doc comment. Matches the 33–38 line norm of its siblings. |
| `src/renderer/src/screens/conversation/shortenPath.test.ts` | ~70 lines, one `it` per scenario. |

Zero existing files modified. **Do not wire a caller** — #645 owns that, and adding one here to "prove it works" duplicates what the sibling test already proves. Do not touch `ConversationScreen.tsx`, `threadTimeline.ts`, or `conversation.css`.

Gates: `npm test` and `npm run build`.

## Open questions

**One, for the operator, and it does not block the developer.** Three folders plus the file name (`KEPT_SEGMENTS = 4`, what this spec builds) or three segments in total (`KEPT_SEGMENTS = 3`, what #606's example showed)? PO resolved it to the rule as written and I agree — the words are stated precisely and twice, the example is introduced as an illustration, and #645 restates no rule so this is the only place it lives. Build 4. If the answer comes back 3, it is one constant and one test assertion, and the worked table's expected strings shift by one segment each.
