# #705 — Pick the collapsed tool-row headline from the tool input fields

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/705
**Size:** S (confirmed below) · **Labels:** `enhancement`, `size:s`, `security-sensitive`
**Split from:** #645 · **Sibling:** #706 (expanded per-field list)

---

## Files to read first

Codegraph is wired but **not indexed** for this repo (`.codegraph/` holds `.gitignore` + `config.json`,
no database — re-confirmed 2026-08-24), so every `codegraph_*` call errors "CodeGraph not initialized".
This list is hand-built from Read/grep. Do not spend a turn probing codegraph.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:668-742` | `ToolRow` — the whole component. `chipRuns` at `:686-691` is the **single swap point**; `:689` is the run this ticket replaces. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:641-667` | #697's SAFETY block. It already names `title={item.inputSummary}` as forbidden and lists the four declined sinks. § Security review extends it; **do not restate it, extend it.** |
| `src/renderer/src/screens/conversation/shortenPath.ts` (whole file, 65 lines) | The helper you are calling for the first time. `shortenPath(path: string): string`, `KEPT_SEGMENTS = 4`. **Its doc comment at `:5-9` and `:12-14` is wrong** — see § 5.5. |
| `src/renderer/src/screens/conversation/shortenPath.test.ts:1-16, :56-59` | The pure-function test idiom to copy for `toolHeadline.test.ts` (string literal in, string literal out, no mock/spy/fixture). `:57`'s comment is the third stale `subject` reference. |
| `src/renderer/src/store/threadTimeline.ts:40-59` | The `toolCall` arm of `ThreadItem`. `input?: Readonly<Record<string, string>>` with the absent-vs-`{}` contract spelled out at `:48-55`. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:183-230` | The two oldest tool-row markup tests (#218). Neither sets `input` — they are your regression baseline for AC4. `:214` carries the apostrophe-escaping warning. |
| `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:341-365` | #696's `toolItem(result)` fixture builder and the direct-`<ToolRow>` render idiom. Extend this builder (§ 7), do not invent a second one. |
| `src/renderer/src/screens/conversation/conversation.css:1026-1039` | `.tool-row__summary` — the run you are changing the text of. `white-space: nowrap` + `text-overflow: ellipsis` at `:1031-1033`. **No CSS change in this ticket.** |
| `docs/specs/architecture/642-tool-use-input-map.md:~60` | The wire facts: alphabetical key order, values are always strings, the map may be incomplete. |
| `tsconfig.web.json` | `strict: true` and **nothing else**. `noUncheckedIndexedAccess` is OFF — this is the central trap, see § 5.3. |

---

## Context

The collapsed tool row draws two runs: the tool `name`, then `inputSummary`. `inputSummary` is the
daemon's whole tool input squeezed onto one line and cut for length — it was never designed as a
headline, it is the raw input compacted. For an `Edit` that is mostly replacement text the file path is
buried inside it and usually truncated away entirely, so the operator cannot follow what the agent is
doing without expanding every row.

Everything below the render already shipped: #642 decodes `input` off the wire, #643 carries it onto the
timeline item, #644 landed `shortenPath` as a tested but **dormant** helper explicitly waiting for this
caller. This slice picks which input field becomes the second run. Listing the whole map in the expanded
body is #706.

---

## Size check

| Red line | Limit | This design |
|---|---|---|
| New files | ≤ 3 | **2** (`toolHeadline.ts`, `toolHeadline.test.ts`) |
| Total written LOC | ≤ ~600 | **~300** (~90 helper incl. doc comments, ~100 its tests, ~60 markup tests, ~10 call site, ~15 comment corrections) |
| New exported symbols | ≤ 5 | **4** (`toolHeadline`, `ToolHeadlineSource`, `PREFERRED_FIELDS`, `PATH_FIELDS`) |
| Consumer call sites | ≤ 10 | **1** (`ConversationScreen.tsx:689`) |
| Acceptance criteria | ≤ 5 | **5** |
| Reject/error branches | ≤ ~10 | **0** — a total function over `string`, no failure branch (§ 8) |

Production source files (`*.ts`/`*.tsx`, excluding tests and the spec): **3** — `toolHeadline.ts` (new),
`ConversationScreen.tsx` (one-line swap + comment), `shortenPath.ts` (comment-only). Under the 5-file
self-check. **No split.**

The edit fan-out check is the one that matters here and it comes out clean for a structural reason worth
stating: the headline is swapped inside `chipRuns`, a fragment declared **once** at `:686-691` and
consumed by both the resolved `<button>` (`:711`) and the pending `<div>` (`:715`). One run-swap reaches
both branches. Nothing else in `src/` or `e2e/` reads `inputSummary`.

**File-overlap check (2026-08-24):** `git fetch origin --prune` then a scan of all 13 remote
`origin/feature/<n>` branches against this ticket's file list found **no overlap**. #706 — the sibling
that also edits `ToolRow` — has no branch yet. The two touch disjoint regions (`chipRuns` at `:686-691`
vs the body at `:718-739`), which is why #645's split set no child→child blocker. If #706's architect run
starts while `feature/705` is live, **#706 blocks on #705**, not the other way round; that is the
overlap check working, not a defect.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

A single rounded pill (`16-28`) holding exactly two runs on one line: the tool name in the accent colour
(`16-30`) and the input summary in muted body-small (`16-31`). The mock's own second run reads
`kitchenclaw/db/schema.ts · 184 lines` — a **path-led string**, which is direct design corroboration that
a path-first headline is the intent, not a reinterpretation of the mock.

The collapsed visual does not change in this slice: same element, same two runs, same classes, same
single-line ellipsizing — only the *text* of the second run changes. The node ids are additionally
corroborated in-repo by the shipped CSS comments (`conversation.css:977` = `16-28`, `:1012` = `16-30`,
`:1026` = `16-31`), so the developer needs no Figma round-trip to place this work.

---

## Design

### 5.1 A new module beside `shortenPath.ts`

`src/renderer/src/screens/conversation/toolHeadline.ts` — framework-free, React-free, co-located with the
screen exactly like `shortenPath.ts` / `messageViewModel.ts` / `threadScrollPosition.ts`. It performs no
effects and takes no injected deps: a total function of its argument. Its **only** import is
`shortenPath` from the sibling module.

This placement is what makes the whole picker unit-testable in the `node` environment. The renderer test
tier is `renderToStaticMarkup` string assertions with no DOM (`vitest.config.ts:27`), so a rule expressed
inside the component could only ever be asserted through rendered markup; expressed here, each of the
four rules is a string in / string out.

### 5.2 The contract

```ts
/** Exactly the three `toolCall` fields the picker reads. Deliberately NOT `ThreadItem`. */
export interface ToolHeadlineSource {
  name: string
  inputSummary: string
  input?: Readonly<Record<string, string>>
}

/** Rule 2's probe order. */
export const PREFERRED_FIELDS: readonly string[]

/** The field names whose value is shortened for display. Membership IS the shortening decision. */
export const PATH_FIELDS: readonly string[]

/** The collapsed row's second run: the picked input value, shortened iff path-named, else `inputSummary`. */
export function toolHeadline(source: ToolHeadlineSource): string
```

Three decisions inside that shape:

- **It takes the three fields, not the item.** `ThreadItem`'s `toolCall` arm carries `kind`, `turnId`,
  `toolUseId` and `result` besides — noise in ~20 picker fixtures, and an import of a store type into a
  screen-local helper. Because `item` is a variable rather than a fresh object literal, TypeScript's
  excess-property check does not apply and the call site stays `toolHeadline(item)`. Tests pass bare
  three-field literals.
- **`readonly string[]`, not `as const`.** Both constants are consumed as `string` (`.includes(key)`
  where `key: string`, and `for` over the entries). An `as const` tuple narrows the element type to the
  literal union and makes `.includes(key)` a compile error — the standard friction, avoided by annotating
  the type rather than by casting at each use.
- **`PATH_FIELDS` is declared independently, never `PREFERRED_FIELDS.slice(0, 3)`.** They happen to
  coincide today. They are two unrelated facts — a *preference order* and a *path-ness* predicate — and
  deriving one from the other means a future reorder of the preference list silently changes what gets
  shortened.

### 5.3 The picker — one chain, four rules

The four rules are a **single fallback chain**, not four independent branches. Rule 1 is a precedence
*override* for one tool name; when it selects nothing the chain continues into rule 2. This is what
guarantees the headline is never blank.

| # | Condition | Candidates, in order |
|---|---|---|
| 1 | `name === 'Bash'` exactly | `description`, then `command` |
| 2 | always | `file_path`, `path`, `notebook_path`, `command`, `pattern`, `url`, `query`, `description` |
| 3 | always | every entry of `input`, in iteration order, whose value contains no line break |
| 4 | nothing selected | `inputSummary`, verbatim |

A candidate is selected iff its value is **present and `!== ''`**. Rules 1, 2 and 3 apply the same
predicate — the odd-one-out in the ticket's first draft (rule 3 testing only for line breaks) was a
blank-headline hole, since an empty value contains no line break and would have been selected, drawing
`name` beside a blank run.

**The central implementation trap.** `tsconfig.web.json` sets `strict: true` and nothing else;
`noUncheckedIndexedAccess` is **OFF**. So `input['file_path']` on a `Record<string, string>` is typed
`string` while being `undefined` at runtime for an absent key. The compiler will *not* force the check.
Rule 2 must read into a `string | undefined` and test **both** conditions:

```ts
const value = input[field]
if (value !== undefined && value !== '') return { key: field, value }
```

Testing only `!== ''` lets `undefined` through, React renders it as nothing, and the blank headline
returns through the type system. Rule 3 is immune (`Object.entries` yields only present keys).

Four further points, each already settled — do not relitigate:

- **`name === 'Bash'`, exact and case-sensitive.** Not `startsWith`: `BashOutput` is a real tool name and
  must take rule 2, where `command` still reaches it.
- **Rule 1's fallback is load-bearing.** Measured over 6459 real `Bash` calls, 1397 (22%) carry no
  `description`. A headline keyed on `description` alone renders blank on nearly a quarter of shell calls.
- **"Contains no line break" is `\n` or `\r`.** Nothing else. `.tool-row__summary` is `white-space:
  nowrap` (`conversation.css:1033`), so a newline could not break the layout even if it were selected —
  the rule is about headline *quality*, not layout safety. U+2028/U+2029 are an accepted miss, in the same
  class as the literal `null` / `true` / `[1,2]` strings below.
- **Non-empty is `!== ''`, never `.trim() !== ''`.** A whitespace-only value would draw a blank-looking
  headline, so this is a real residual. It stays unguarded on purpose: the rules come from a measurement
  over 11336 real tool calls in which no such value was observed, the ticket says not to improve the
  picker without new data, and `=== ''`-never-`.trim()` is already the shipped decision one element away
  (`ConversationScreen.tsx:724-727`). Adding the trim would be a defence for an unobserved failure mode.

Wire facts that bound rule 3, read off #642's spec rather than the daemon ticket:

- **Every value is already a string daemon-side.** A JSON string arrives decoded; every other JSON type
  arrives as its compact JSON form, so `null`, `true` and `[1,2]` arrive as those literal strings and
  rule 3 can legitimately land on one. An accepted miss — #706's field list covers the rest.
- **Key order is alphabetical**, a Go map-marshalling artefact, deterministic per call (`threadTimeline.ts:53`'s
  "meaningless" is the conservative paraphrase; #642's spec is the fact). Rule 3 therefore has a stable,
  testable order. One non-case, stated so nobody guards it: JS orders integer-like keys first regardless
  of insertion — no observed tool names a field `"0"`, and display order is the client's choice anyway.
- **The map may be incomplete** (the daemon's 8500-rune total bound drops fields and names none), which is
  precisely why rule 4 keeps `inputSummary` as the whole-input fallback rather than retiring it.
- **A value the daemon truncated at its 4000-rune bound ends in `…`** and renders that way.

### 5.4 The shortening decision

Shorten iff **the key the headline came from is in `PATH_FIELDS`** (`file_path`, `path`,
`notebook_path`). Everything else renders unshortened — a rule 1 pick, a `command` / `pattern` / `url` /
`query` / `description` pick, a rule 3 pick, and `inputSummary`.

The decision is keyed on the **field name**, not on which rule fired. Those are equivalent — rule 1 only
ever picks `description`/`command`, and rule 3 can never reach a non-empty `file_path`/`path`/
`notebook_path` because rule 2 would already have taken it — and the field-name form is the one that
stays true if the rules are ever reordered.

Path rules must not be applied to a command line, a search pattern or a URL: `shortenPath` splits on `/`
and prefixes `.../`, which would mangle `grep -r foo src/` into something that reads like a path and is
not one.

This is what makes `toolHeadline` the natural home for the call: `shortenPath` stays a total function of
one string that never decides *whether* its argument is a path, exactly as its own doc comment promises.

### 5.5 Correct `shortenPath.ts`'s doc comment — comment-only, no production lines

`shortenPath.ts` misdirects its own first caller, and the misdirection resolves to a real field, so it
fails silently rather than erroring:

- `:6` — "#642 and #643 carry the daemon's `kind`/`subject` onto the timeline item and #645 draws it."
- `:13-14` — "#645 makes that call from the tool `kind`, and shortens only the file-acting ones."
- `shortenPath.test.ts:57` — "pyrycode#1678 sends an empty **subject** for kinds with no meaningful one."

**Neither field ever shipped.** `parseToolUsePayload` takes `name`, `input_summary` and `input` and
nothing else (`inboundMessage.ts:968-978`), and `subject` appears nowhere in `src/` outside these
comments. The shape that shipped is the `Record<string, string>` input map. The trap is live because
`kind` **is the `ThreadItem` union discriminant** — a developer following the instruction finds a real
`kind` that reads `'toolCall'` on every single row, so the rule would silently shorten everything.

Rewrite all three to describe the shipped shape: the caller is #705, the input is the tool's input map,
and the shortening decision comes from the **field name** the headline was taken from. The `#645`
references die with it (that ticket no longer exists). `shortenPath.test.ts:57`'s assertion does not
change — only its comment, from "empty subject" to "an empty value".

**Out of scope, and deliberately left alone:** `ConversationScreen.tsx:722` and `conversation.css:1042`
also still say "#645 lands its per-input-field list in here". Both describe the expanded body — #706's
deliverable, in #706's region of the file. Leave them; editing them here manufactures the merge conflict
the overlap check just proved does not exist.

### 5.6 The call site

`ConversationScreen.tsx:689`, inside `chipRuns`:

```tsx
<span className="tool-row__summary">{toolHeadline(item)}</span>
```

Element, class and position unchanged; one import added. Because `chipRuns` is declared once and consumed
by both the `<button>` and `<div>` branches, this reaches the resolved and the pending row together.

Update the `#696`-era note at `:722`? No — see § 5.5. The comment that *does* need a line is #697's SAFETY
block at `:641-667`, extended per § Security review.

---

## State + concurrency model

None. `toolHeadline` is a pure function called during render; it holds no state, launches no async work,
subscribes to nothing and has no teardown. No store slice changes, no new IPC, no `useEffect`, no
`useMemo` — `React.memo` appears nowhere in `src/` and this file declines memoisation three times already
(`:376`, `:394`, `:536-541`); a picker over at most a handful of short strings is not the place to start.

`ToolRow`'s existing `useState` disclosure flag (#697) is untouched.

---

## Error handling

There is no failure mode to surface. `toolHeadline` is **total over its input type**: every branch is a
comparison, a property read or a `for` loop over `Object.entries`, none of which throw, and rule 4
guarantees a `string` return for every possible source. No try/catch, no length cap, no null guard — the
signature is the contract, matching `shortenPath`'s stated posture.

The one degenerate case worth naming: if `inputSummary` is itself `''` and no field is selectable, the
headline is `''` and the row draws the name alone. That is exactly today's behaviour for the same input,
so it is not a regression this slice introduces.

If a case turns up that genuinely needs a second branch, that is a signal the rules are wrong — route
back rather than guarding around them.

---

## Testing strategy

Two tiers, both under `npm test` (vitest, `node` environment). No DOM, no effects, no click handlers, so
every criterion is a **markup property** or a pure-function property. Do not add a DOM environment as a
side effect — #696 records why that constraint holds.

**Fixture trap:** `renderToStaticMarkup` escapes `'` → `&#x27;` (flagged in-file at `:214`). A command
line or description fixture containing an apostrophe fails its own assertion for a reason unrelated to
the rule under test. Keep apostrophes out of fixtures.

### `toolHeadline.test.ts` (new) — the picker, as scenarios

Copy `shortenPath.test.ts`'s shape: one `it` per case, a literal in and a literal out, no mock or spy.

*Rule 1 — Bash*
- `Bash` with a non-empty `description` and a `command` → the description.
- `Bash` with **no** `description` key at all → the command. (The 22% case; required by AC2.)
- `Bash` with `description: ''` → the command.
- `BashOutput` with a `description` and a `command` → rule 2 order applies, so the **command**. Pins the
  `===` over `startsWith`.

*Rule 2 — the fixed list*
- `file_path` wins over a `command` present in the same map.
- `path` chosen when `file_path` is absent; `notebook_path` when both are.
- A later name (`pattern`, `url`, `query`) chosen when no earlier one is present.
- `file_path: ''` with a non-empty `command` → the command. (Empty is skipped, not selected.)

*Rule 3 — the MCP catch-all*
- `{ symbol: 'RelayConnection' }` — none of the rule-2 names — → `RelayConnection`. Required by AC2.
- A first entry whose value contains `\n` is skipped for the next line-break-free one.
- A first entry whose value is `''` is skipped for the next non-empty one. (The blank-headline hole.)
- Every value multi-line → falls through to `inputSummary`.

*Rule 4 — the fallback*
- `input` **absent** (`undefined`) → `inputSummary`. Assert on the value, never `'input' in source`.
- `input` `{}` → `inputSummary`. Reads identically to absent, by design.

*Shortening (AC3)*
- A deep `file_path` → shortened, `.../` prefix. Same for `path` and `notebook_path`.
- A `Bash` `command` containing many `/` → **unshortened**, byte-identical to the input.
- A `pattern` and a `url` each containing many `/` → **unshortened**. Required by AC3.
- A rule-3 value containing many `/` → unshortened.
- `inputSummary` containing many `/` → unshortened.

*The constants*
- `PREFERRED_FIELDS` equals the exact eight-name order; `PATH_FIELDS` equals the exact three. These pin
  measured data, the `KEPT_SEGMENTS` precedent.

### `ConversationScreen.test.tsx` (extend) — the markup tier

Extend #696's `toolItem(result)` builder (`:345-354`) with an optional `input` parameter rather than
adding a second builder — the sibling-builder rule from #643 applies to *store* test files with opposite
idioms; this file has one builder and one idiom.

- A `toolCall` with `input: { file_path: <deep path> }` renders the **shortened** path inside
  `.tool-row__summary`, and the `inputSummary` sentinel does **not** appear. (AC1)
- The same row's chip markup is otherwise unchanged: `tool-row__chip`, `data-thread-role="tool"`,
  `tool-row__name` then `tool-row__summary`, no new element and no new class. (AC1)
- A **pending** row (`result: null`) with an `input` renders the headline too — pins that the swap inside
  `chipRuns` reaches the `<div>` branch as well as the `<button>`.
- `input` absent → `inputSummary` verbatim. (AC4)
- `input: {}` → `inputSummary` verbatim. (AC4)
- A headline value of `<i>path</i>` renders as `&lt;i&gt;path&lt;/i&gt;` and the raw form does not appear;
  the markup contains no `title=`. (AC5)

**Regression baseline, free of charge:** no existing fixture in `ConversationScreen.test.tsx` sets
`input` (verified — zero matches), and neither e2e spec that drives a tool row sends an `input` map
(`e2e/tool-row-toggle.spec.ts:48`, `e2e/thread-scroll-pin.spec.ts:115` send `input_summary` only, and
both locate by class, never by summary text). Every one of them therefore falls through to rule 4 and
must stay green **unchanged**. If any existing tool-row assertion needs editing, the picker is wrong —
stop and re-read § 5.3 rather than adjusting the test.

`npm run typecheck` covers the `ToolHeadlineSource`-accepts-`item` claim; `npm run build` is the gate.

---

## Open questions

None blocking. Two things deliberately settled rather than deferred, recorded so they are not reopened
downstream: the `.trim()` question (§ 5.3 — resolved as `!== ''`, evidence-based) and absent-vs-`{}`
(§ 5.3 rule 4 — they read identically; the distinction survives at the item, unsurfaced).

Explicitly **out of scope**: collapsing consecutive uses of the same tool into one entry (deferred with
the operator 2026-08-20 — a one-line row may remove the need entirely); any smarter classifier ("do not
improve the picker without new data"); the expanded per-field list (#706).

---

## Security review

**Verdict:** PASS

Walked adversarially against `architect/security-review.md`. This slice adds no process, socket, file or
IPC surface — it changes which untrusted string reaches an existing DOM sink — so the finding density is
concentrated in categories 1, 4 and 7, and the rest are recorded with the design fact that makes them
inapplicable rather than a bare "N/A".

**Findings:**

- **[Trust boundaries]** No findings. The boundary is upstream and unchanged: `parseToolUsePayload`
  (`inboundMessage.ts:968-978`) is the single parse point, and #642's decoder already stripped
  `__proto__`, `constructor` and `prototype` from the map keys. Everything this slice touches is on the
  untrusted side of that line and is typed `string`, which is the signal downstream readers get. Two
  consequences checked concretely: (a) none of `PREFERRED_FIELDS`' eight names collides with an
  `Object.prototype` member, so a bare `input[field]` read cannot return an inherited non-string value,
  and no `Object.hasOwn` guard is needed; (b) rule 3 uses `Object.entries`, which yields own enumerable
  properties only.

- **[Rendered sink — MUST-STATE, written into the code's SAFETY block at `:641-667`]** The headline is a
  *newly* untrusted string in an *existing* sink. It reaches the DOM only as auto-escaped React children
  of the same `<span>` that renders `inputSummary` today — never `dangerouslySetInnerHTML`, never an
  attribute, never a URL, never a filename / cache key / lookup path, never a log line. Three sinks this
  slice makes newly tempting, each a MUST FIX if it ever appears:
  - **NO `title=`.** Shortening visibly discards information, which makes `title={fullPath}` ("hover for
    the rest") the natural next edit. It is untrusted daemon text in an attribute — forbidden by
    CLAUDE.md 2026-08-20 and already declined twice in this component (`:664-665`, #696's 240px bound).
  - **NO linkification of a `url` headline.** Rule 2 promotes a field literally named `url` into the
    render path, and `AssistantMarkdown` is imported into this same file two arms up (`:542-543`).
    Rendering the headline through it — or wrapping it in an `<a href>` — would turn a daemon-chosen URL
    into a live outbound request from a privileged renderer, the exact `<img src>` beacon shape #696's
    review caught. A `<span>` with text children cannot emit one.
  - **NO input KEY reaches the DOM.** The picker returns the *value* only. Keys are daemon-controlled
    display text too, and drawing them is #706's deliberate, separately-reviewed decision.

- **[Electron attack surface]** No findings. No IPC channel, no `contextBridge` API, no `webPreferences`,
  no protocol handler and no navigation surface is added or changed. The data already crosses the bridge
  today via `emitDaemonEvent`; this slice reads a field the renderer already holds.

- **[Error messages, logs, telemetry]** No findings, one MUST-STATE. **No log line for the pick.** Any
  useful one would carry the tool `name`, the chosen field name or its value — daemon content in a log,
  forbidden by ADR 0007's content-free rule and by CLAUDE.md. This slice adds none, and the
  no-failure-branch design (§ Error handling) means there is no error path tempted to log one either.

- **[File / storage operations]** Not applicable, and the reason is load-bearing rather than incidental:
  `shortenPath` is **display formatting, never path resolution** — it never touches the filesystem, never
  normalises `.` or `..`, and its `.../a/b/c` output resolves to nothing. Path traversal needs a
  filesystem sink and this slice has none; nothing downstream may feed the shortened form back into a
  path operation, which is stated in the helper's own doc comment. No file is read, written or named.

- **[Tokens, secrets, credentials]** Not applicable. No token, key or credential is read, derived,
  compared, stored or rendered. The renderer holds none by design (CLAUDE.md: crypto, sockets and tokens
  never enter the renderer) and this slice does not change that.

- **[Cryptographic primitives]** Not applicable. No randomness, no hashing, no comparison against a
  secret, no Noise-adjacent code. The picker's comparisons are `===` against client-owned field-name
  constants and `''` — non-secret values on both sides, so constant-time comparison is not indicated.

- **[Network & I/O]** Not applicable. No socket, no fetch, no frame handling, no timeout, no reconnect.
  Inbound size bounds are enforced upstream and inherited: the daemon caps each value at 4000 runes and
  the whole map at 8500, and the Noise envelope ceiling (65519 B) bounds the frame. Rendering is bounded
  independently by `text-overflow: ellipsis` on a `nowrap` run, so even an unbounded string cannot
  overflow the row.

- **[Concurrency]** Not applicable. Synchronous pure function, no async task, no timer, no listener, no
  shared mutable state, therefore no ownership, cancellation, teardown or check-then-act question. See
  § "State + concurrency model".

- **[Threat model alignment]** The applicable desktop threat is **hostile daemon response** — a
  compromised or impersonating daemon choosing both the field names and the values that become the
  headline. It is addressed by the rendered-sink posture above: the worst outcome is a misleading or
  ugly *inert text* headline, one click from the truth in the expanded body. Explicitly out of scope and
  named: malicious relay (content-blind, and this slice adds no transport behaviour), token theft from
  disk (no storage), renderer compromise reaching the transport (unchanged process boundary — no
  transport reach is added here). A headline that misleads is a UX miss, not an escalation.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
