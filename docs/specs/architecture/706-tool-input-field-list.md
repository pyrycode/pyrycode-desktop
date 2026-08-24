# #706 — list the tool input fields in the expanded tool row

Ticket: https://github.com/pyrycode/pyrycode-desktop/issues/706
Size: **S** (2 production files + 1 test file, 0 new modules, 0 new exports, 0 consumer call sites)
Labels: `enhancement`, `size:s`, `security-sensitive`

---

## Files to read first

**Codegraph gap.** `mcp__codegraph__codegraph_status` errors with `CodeGraph not initialized for this
project` (re-verified this run, 2026-08-24) — `.codegraph/` holds only `.gitignore` + `config.json`, no
database. This reading list is hand-built from `grep -n` + `Read`, not skipped. Line refs were read this
run against `main` at `ac1f2f6`; re-Read before citing them in code, since refs in this file drift.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:685-767` | `ToolRow`. The `body` derived value (`:701`), `chipRuns` (`:703-713`), and the body block (`:740-761`) — the field list's insertion point is the first child of the body `<div>` at `:745`. |
| `…/ConversationScreen.tsx:602-684` | The accumulated comment + SAFETY block. `:683-684` explicitly reserves the input-**key** decision for this ticket. #706 **extends** this posture, it does not restate it. |
| `…/conversation.css:1041-1097` | `.tool-row__body` (column flex, `gap: --space-2`), `.tool-row__result` (the declaration set to reuse), the false comment at `:1081-1083`, `.tool-row__empty`. |
| `…/conversation.css:2632-2647` | `.unrecognized-row__raw` — the house style for a large untrusted payload that `.tool-row__result` copied. **Note the drift:** the tool-row comments cite it as `:2536`/`:2538`; it now lives at `:2635`. Do not "fix" those citations — out of scope. |
| `…/conversation.css:290-300` | `.bubble`'s `word-break: break-word` (`:298`) — the repo's house value for an unbounded string. `.tool-row` is **not** a `.bubble` descendant, so it inherits nothing and must state it. |
| `src/renderer/src/store/threadTimeline.ts:40-59` | `ThreadItem['toolCall']` and `input?: Readonly<Record<string, string>>`. The absent-vs-`{}` contract and the "iterate, never probe by key" rule. |
| `…/threadTimeline.ts:302-320` | The reducer carrying `input` onto the item **by reference** (never `{ ...event.input }`). Confirms the map the render reads is the one the wire sent. |
| `…/ConversationScreen.test.tsx:341-363` | The `toolItem(result, input?)` builder — **already takes `input`** (#705 extended it). Do not add a second builder. |
| `…/ConversationScreen.test.tsx:365-494` | Every `defaultExpanded` case. All omit `input`. |
| `…/ConversationScreen.test.tsx:520-603` | Every `input`-carrying case. All collapsed or pending. See § 6.1 — this split is the free baseline. |
| `…/toolHeadline.ts` (whole file) | Read it to **decline** it. See § 4. |
| `e2e/tool-row-toggle.spec.ts:84-135` | Locators-and-counts only; sends no `input` map. |
| `CLAUDE.md` § Conventions | The 2026-08-20 operator ruling on daemon text: renderable escaped and length-bounded, never into a raw-markup sink, an attribute, a URL, a filename/cache key/lookup path, or a log. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

Re-fetched this run: node `16-28` renders at **380×33** — `read_file` in mono tertiary followed by
`kitchenclaw/db/schema.ts · 184 lines` in muted sans, inside a dark rounded pill. A 33px single-line
frame with no room for, and no drawing of, an expanded state.

**N/A for the expanded state specifically** — the mock has no expanded tool row, the gap #230 recorded
when it declined to draw the result and #696 inherited when it drew one anyway. #696 answered it by
taking `.unrecognized-row__raw`'s visual language for the result block. **This ticket takes that same
language for the field values rather than inventing a third** — literally, by joining the existing
`.tool-row__result` selector (§ 5.2). The collapsed chip in the mock above is untouched.

---

## Context

`ToolRow`'s expanded body currently holds one thing: the tool's result. `.tool-row__body` was built as a
**container** rather than a lone text node precisely so this slice could land the input fields above it —
its comment at `conversation.css:1041-1044` says so, and `ConversationScreen.tsx:744` repeats the promise.

The `toolCall` item already carries the tool's own input fields (`input?: Readonly<Record<string, string>>`
— #642 decodes it off the wire, #643 carries it onto the item). Nothing renders them. #705 picks **one** of
them for the collapsed headline; this slice lists **all** of them, literally, in the expanded body.

The operator's report (2026-08-20): `inputSummary` is the daemon's whole tool input squeezed onto one line
and cut for length, so for an edit that is mostly replacement text the file path is buried inside it and
usually cut off entirely. The headline pick covers the common case; this list is the form that covers its
misses, so it has to be complete and literal.

---

## Design

### 1. Markup

The field list is rendered as the **first children of the existing body `<div>`**, above the
result/empty branch. Insert at `ConversationScreen.tsx:745`, immediately inside
`<div className={...tool-row__body...}>` and before the `body.resultSummary === ''` ternary:

```tsx
{Object.entries(item.input ?? NO_INPUT_FIELDS).map(([name, value]) => (
  <div className="tool-row__input" key={name}>
    <span className="tool-row__input-name">{name}</span>
    <pre className="tool-row__input-value">{value}</pre>
  </div>
))}
```

with one new module-level constant beside `TOOL_RESULT_EMPTY_COPY` (`:767`):

```ts
const NO_INPUT_FIELDS: Readonly<Record<string, string>> = {}
```

Five properties follow structurally, each carrying an AC:

**(a) There is NO list-wrapper element.** The per-field `<div>`s are direct children of the body. An
empty array renders literally nothing, so AC4 ("no field list, **no empty container**") is satisfied by
construction — there is no container element that could be left behind. This is why the design has no
`fields.length > 0` guard: a guard would be a second condition that could drift from the render.

**(b) Absent and `{}` collapse into one expression.** `item.input ?? NO_INPUT_FIELDS` yields `{}` for the
absent case; `Object.entries` yields `[]` for both. There is no branch on which the two could diverge, so
"a pre-pyrycode#1678 daemon is not a visible regression" is structural rather than asserted twice. The
distinction stays alive at the item, exactly where #643 put it — this slice's *display* decision is that
both draw nothing, and that decision lives in one place.

**Why the named constant rather than a bare `{}` literal.** `item.input ?? {}` has type
`Readonly<Record<string, string>> | {}`, and TypeScript resolves `Object.entries` on that union to the
`entries(o: {}): [string, any][]` overload — silently typing every **value** as `any` on a
security-sensitive render path. With `NO_INPUT_FIELDS` both branches carry the same type, `T` infers as
`string`, and no explicit type argument or annotation is needed. (`strict` is on; neither
`noUncheckedIndexedAccess` nor `exactOptionalPropertyTypes` is — see § 4 — so the compiler will not catch
the `any` for you.)

**(c) `Object.entries`, never `for...in`, never `input[key]`.** Own enumerable keys only, in insertion
order. `threadTimeline.ts:48-55` carries #642's rule forward: the map is an ordinary-prototype object, so
`input['toString']` returns an inherited function rather than data. `for...in` walks the prototype chain
and is **the one iteration form that breaks this**. There is no `.sort()`, no `.filter()`, no reordering
and no skipping anywhere in the expression — which is what AC1's "never re-sorted" pins (§ 6.2).

**(d) The value is a `<pre>`, not a styled `<div>`.** `#696`'s comment at `:402-404` of the test file
records why: the `<pre>` tag plus the surviving `\n` is what the server-render tier can assert, while the
`white-space: pre` declaration itself is invisible to it. A `<div>` would inherit `white-space: normal`
and collapse the daemon's newlines onto one line — the defect #607 fixed for assistant text and #696
fixed for the result block. AC3 is provable only because the element carries the semantics.

**(e) `key={name}` is correct and is not a new exposure.** Object keys are unique by construction, so a
duplicate-key collision is impossible. A React key is a reconciliation identity — it never reaches the
DOM, and it is not a "filename, cache key or lookup path" in CLAUDE.md's sense. Decisively: the same
string is rendered as a text child two lines below, so using it as a key adds no exposure that the render
does not already carry. The in-file note that `toolUseId` is "never a React key here" (`:603-604`) is
about `Timeline` keying by array index, not a prohibition. **Require a one-line comment stating this** so
review does not reopen it.

### 2. Where the expression is evaluated

Inline inside the `{body && (…)}` block — **not** hoisted to a `const` beside `body` (`:701`). Consumed
once, and inlining keeps "a collapsed row never computes the list" structural, the same property `body`
itself has. (`chipRuns` is a `const` because it is consumed **twice**, by both the `<button>` and `<div>`
branches; that reason does not apply here.)

A pending row is unreachable by construction: the list sits inside `{body && …}` and `body` is non-null
only when `expanded && result !== null`. Nothing new to guard.

### 3. Interaction with the empty-result state

When `resultSummary === ''` **and** the map has fields, the body draws the field list followed by the
"No output" note. That is correct and wanted — the input is what the tool was asked to do; the result
being empty does not make the request uninteresting. No new branch: the field list is a sibling of the
existing ternary, not inside either arm.

### 4. What this ticket explicitly does NOT reuse

By the time this is implemented, `toolHeadline.ts` and a now-live `shortenPath.ts` sit **in the same
directory** offering exactly the transformations this list must not apply. A sibling that landed first is
a source of plausible-looking wrong moves, not just of context. Each of the following is a defect, not an
improvement:

- **No path shortening.** `shortenPath` is #705's machinery. A value is rendered as it arrived.
- **No salience pick, no field ordering.** Every field, in arrival order.
- **No skipping the field #705 already promoted into the headline.** The list is complete. A reader who
  opened the row wants the whole input, and a field silently missing from a "full input" list is worse
  than a repeated one.
- **No client re-truncation and no stripping of a trailing `…`.** A value the daemon shortened at 4000
  runes arrives already ending in `…`. A value that legitimately ends in `…` is indistinguishable from a
  shortened one — an accepted cost the daemon already took, not a client problem to solve.
- **No collapsing of consecutive uses of the same tool.** Explicitly out of scope, deferred with the
  operator on 2026-08-20.
- **`inputSummary` is not retired.** The map may be incomplete — the daemon's 8500-rune total bound drops
  fields and names none of them — so `inputSummary` remains the whole-input fallback and stays the
  headline picker's rule 4.

**Two tsconfig strictness flags are OFF** (`tsconfig.web.json` / `tsconfig.node.json` set `strict: true`
and nothing else): `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Neither bites this design
— it never indexes by key and never re-assigns the optional property — but do not assume the compiler is
checking either one.

### 5. CSS

All in `src/renderer/src/screens/conversation/conversation.css`, inside the existing `.tool-row__*` block.

#### 5.1 Two new rules

| Selector | Declarations | Why |
|---|---|---|
| `.tool-row__input` | `display: flex; flex-direction: column; gap: var(--space-1); min-width: 0;` | The per-field group: name stacked above its value. `--space-1` (4px) is **tighter** than the body's own `--space-2` (8px) gap, so a name reads as belonging to the value beneath it rather than floating between two blocks — the grouping the design gets for free without a list wrapper. `min-width: 0` because this is itself a flex container holding a potentially very wide `<pre>`. |
| `.tool-row__input-name` | `word-break: break-word; font-family: var(--font-mono); color: var(--color-on-surface-variant); font-size: var(--text-body-small-size); line-height: var(--text-body-small-line); letter-spacing: var(--text-body-small-tracking); font-weight: var(--text-body-small-weight);` | Mono because a field name is an identifier (`file_path`, `command`) — `.tool-row__name`'s treatment. But `--color-on-surface-variant`, the muted **label** colour `.tool-row__summary` and `.tool-row__empty` use, **not** `--color-tertiary`: tertiary is reserved for the tool's own identity, and a field name is a label beside it. `word-break: break-word` is load-bearing, not cosmetic — see § 5.3. |

No new token. Every value above already exists in `src/renderer/src/theme/`.

#### 5.2 One selector addition — the value block

`.tool-row__input-value` joins the existing `.tool-row__result` rule (`:1067`) as a grouped selector:

```css
.tool-row__result,
.tool-row__input-value {
  /* …the ten existing declarations, byte-for-byte unchanged… */
}
```

This is how "take the result block's language rather than a third" becomes a **fact rather than a claim** —
identical by construction instead of by a copied declaration set that can drift. It is additive: the
declaration block's contents are untouched, so AC1's "that result block itself unchanged" is provable off
the diff (the only CSS deletion in this ticket is inside a comment, § 7).

That set already supplies everything the value needs: `white-space: pre` (line breaks kept, AC3),
`overflow: auto` (a long unwrapped line scrolls inside the block rather than widening the row),
`max-height: 240px`, the mono body-small type, the `--color-surface-container-high` fill and
`--radius-sm`. The 240px cap will rarely bite here — the daemon bounds the whole map at 8500 runes, far
under the 64KB a result can reach — but a 4000-rune `new_string` of short lines is ~200 lines, which is
exactly the "one row eats the thread viewport" case the cap exists for. Inherited, not re-argued.

#### 5.3 Width containment

The chain that keeps a 16000-character value scrolling inside its block instead of widening the row is
already shipped and was verified at #696's code review: `.tool-row--expanded` is a column flex with
`align-items: flex-start`, so `.tool-row__body` is content-sized and capped by its own `max-width: 100%`;
its children stretch to that resolved width; the `<pre>`'s `overflow: auto` supplies the x-axis. Nothing
new is needed for the **value**.

The **name** is the new case, and it is not covered by that chain: a field name is an identifier with no
spaces, so a hostile or merely absurd 4000-character name would not wrap and would push the row wider.
`word-break: break-word` is the repo's house value for exactly this (`.bubble:298`, cited at `:325`,
`:368`, `:522`, `:598`, `:670`, `:709`), and `.tool-row` is **not** a `.bubble` descendant, so it
inherits nothing and must state it. Wrapping, not ellipsis: a name is short in every real case, and
truncating one would hide which field a value belongs to.

### 6. The error treatment is declined — structurally

The failed-tool accent stays on the result alone. A failed tool's *input* is not itself an error, and
tinting it would say otherwise.

This costs nothing to enforce: `.tool-row__body--error .tool-row__result` (`:1084`) is a **descendant
selector naming `.tool-row__result` alone**. Adding `.tool-row__input-value` to the *base* rule (§ 5.2)
does not add it to the *error* rule. The field list is untinted by construction.

> **Do NOT extend the error selector** to reach `.tool-row__input-value` or `.tool-row__empty`. Changing
> what the error accent reaches is a separate behaviour change with its own visual-fidelity question, and
> it is not in this ticket's ACs. The comment above that selector is what this ticket fixes (§ 7).

---

## 6.1 The free regression baseline — and how it changed

AC5's second half ("no existing test in `ConversationScreen.test.tsx` and no existing e2e spec may need
editing to stay green") is a **mechanical check**, not a hope. But the mechanism is **not** the one the
ticket body describes, because #705 landed in between:

- **The ticket says** `ConversationScreen.test.tsx` sets `input:` on zero fixtures. **That is now stale.**
  #705 extended the `toolItem` builder with an `input` parameter (`:350-363`) and added six cases that
  pass one (`:533`, `:542`, `:557`, `:576`, `:585`, `:599`).
- **The invariant that actually holds** is a disjointness: **the intersection of {carries `input`} and
  {renders `defaultExpanded`} is empty.** Every `input`-carrying case at `:531-603` renders the row
  **collapsed or pending**, so no body exists there at all. Every `defaultExpanded` case at `:365-494`
  omits `input`, so `Object.entries` yields `[]` and the body is byte-identical to today's.

Both e2e specs still confirm the tier below: `tool-row-toggle.spec.ts` sends no `input`, and
`thread-scroll-pin.spec.ts:115` sends `input_summary` only. `grep -rn '"input"' e2e/` returns nothing.

**So: if any existing test needs editing to stay green, the render is conditioned wrongly rather than the
test being stale.** Treat an edit to `:365-603` as a stop signal.

> **One test will look like it contradicts this ticket. It does not.**
> `:596-603`, *"never draws the input KEY, only its value"*, renders `toolItem(null, { KEY_SENTINEL_zzz:
> 'the value' })` and asserts `not.toContain('KEY_SENTINEL_zzz')`. That is a **pending** row — `result` is
> `null`, so no body exists and no field list is reachable. The test stays green and stays correct: it
> now pins that the **collapsed chip** draws no key, which is still true. Its comment already says
> drawing keys is "#706's separately reviewed call". **Do not edit or delete it.** Add the positive case
> (§ 6.2, scenario 7) beside it instead.

## 6.2 Testing strategy

All in `src/renderer/src/screens/conversation/ConversationScreen.test.tsx`, in the `#705` block's wake.
Server-render only (`renderToStaticMarkup`, node environment — no DOM, no effects, no click handlers), so
every criterion below is a markup property and the expanded body is reached through `defaultExpanded`.
**Do not add a DOM environment** — #696 records why that constraint holds.

Use the existing `toolItem(result, input?)` builder unchanged. **No builder change is needed** — #705
already did it.

Two fixture traps, both already recorded in this file's own comments:

- `renderToStaticMarkup` escapes `'` → `&#x27;`. Keep apostrophes out of fixtures.
- `renderToStaticMarkup` prepends a newline inside `<pre>` when the child string **starts** with `\n`
  (HTML parsers eat a leading newline in `pre`). Never start a value fixture with `\n`.

Scenarios:

1. **Fields render above the result, and the result block is unchanged (AC1).** Expanded, two fields with
   sentinel values. Assert `tool-row__input`, `tool-row__input-name`, `tool-row__input-value` present;
   `tool-row__result` still present carrying its unchanged text; and
   `indexOf(<a field value>) < indexOf(<result text>)`.

2. **Arrival order is preserved, never re-sorted (AC1).** A fixture whose keys are inserted in
   **non-alphabetical** order — e.g. `zulu`, `alpha`, `mike`, with distinct sentinel values. Assert the
   rendered positions follow *insertion* order (`indexOf(zulu) < indexOf(alpha) < indexOf(mike)`), which a
   `.sort()` would invert. This is the testable half: alphabetical *arrival* is a daemon-side Go
   map-marshalling artefact that no renderer test can pin — what is pinnable is the **absence of a client
   transform**.

3. **A trailing `…` survives intact (AC2).** A value ending in `…` (U+2026 — React does not escape it).
   Assert the full value appears as an exact substring, marker included.

4. **Line breaks are preserved (AC3).** Value `'line one\nline two'` (not starting with `\n`). Assert the
   exact markup `<pre class="tool-row__input-value">line one\nline two</pre>`, mirroring the shape #696's
   own newline test uses at `:412`.

5. **`input: {}` draws no field list (AC4).** Expanded, `{}`. Assert `not.toContain('tool-row__input')`,
   and that the body still carries `tool-row__body` + `tool-row__result`.

6. **`input` absent renders identically to `{}` (AC4).** Render the expanded row three ways — no `input`
   argument, `{}`, and (as the contrast) one field — and assert the **first two markup strings are
   equal** (`toBe`), while the third differs. Equality is what the AC literally asks for ("an expanded
   body identical to the one #696 draws today"), and it is stronger than two independent
   `not.toContain`s.

7. **The field name IS drawn, in the expanded body (AC1).** The deliberate positive counterpart to
   `:596-603`. Same `KEY_SENTINEL_zzz` key, but a **resolved** item rendered `defaultExpanded`: assert the
   key *is* present. Comment it as the pair to the collapsed case so the two never read as contradictory.

8. **A collapsed row with `input` draws no field list (AC5).** Resolved item with fields, **no**
   `defaultExpanded`. Assert `not.toContain('tool-row__input')`. This pins mechanically that the list
   lives inside the body — the property the whole free baseline rests on.

9. **Names and values reach the DOM only as escaped children (AC5).** One fixture, hostile in **both**
   halves — a key like `<img src=x onerror=alert(1)>` and a value like `<i>v</i>` (no apostrophes).
   Assert the escaped forms present, the raw forms absent, and `not.toContain('title=')`,
   `not.toContain('aria-label')`, `not.toContain('dangerously')`. The name is as untrusted as the value:
   an MCP tool can name a field anything.

`npm test`, `npm run typecheck` and `npm run build` must all pass. No e2e change.

---

## 7. Comment corrections — exactly three sites, and no more

`#645` split into #705 and #706, so its forward-looking comments now name a closed parent. **Three sites
sit in files this ticket already opens** and are corrected in passing:

1. **`conversation.css:1042`** — *"A CONTAINER, not a lone text node: #645 lands its per-input-field list
   in here, above the result."* The promise is **kept** by this ticket; restate it in the past tense
   naming #706.

2. **`ConversationScreen.tsx:744`** — the same sentence. Same correction.

3. **`conversation.css:1081-1083`** — the **false** one. It reads: *"On the CONTAINER rather than the
   `<pre>` so it reaches the empty note too, and so #645's field list inherits it without a fourth
   class."* **Both halves are untrue of the selector beneath it.** `.tool-row__body--error
   .tool-row__result` (`:1084`) is a descendant selector that reaches neither `.tool-row__empty` nor
   `.tool-row__input-value`. Replace the comment with what the code actually does: the accent applies to
   the result block alone, `.tool-row__empty` and the field list are untinted, and for the field list
   that is **deliberate** (§ 6) rather than an oversight. **Fix the comment, not the selector.**

**Everything else stays.** `grep -rn "#645" src/` returns **seven files**; the five this ticket does not
open — `store/threadTimeline.ts` (4 refs), `store/timelineBridge.ts`, `shared/wire/types.ts`,
`shared/ipc/events.ts`, `main/transport/inboundMessage.ts` — are stale **attribution**, not false
**claims**. Leave every one of them alone. Chasing them turns a three-file slice into an eight-file one
against CLAUDE.md's "don't refactor adjacent code while you are there."

> **The ticket body's count is off by two, in your favour.** It says the references sit in "seven *other*
> files" and lists `shortenPath.ts` and `shortenPath.test.ts` among them. #705 rewrote those comments
> when it corrected their `kind`/`subject` vocabulary, and neither file contains `#645` any more. Your
> grep will return **five** other files, not seven. That is the expected result, not a discrepancy to
> investigate.

Also do not "fix" the drifted `.unrecognized-row__raw:2536` / `:2538` line citations in the tool-row CSS
comments (the block is now at `:2635`). Same rule: stale attribution, not a false claim.

---

## 8. State, concurrency, error handling

**State:** none added. `ToolRow` keeps its single component-local `useState<boolean>` from #697,
untouched. The field list is a pure function of `item.input`, which the reducer carries by reference and
never mutates (`threadTimeline.ts:314-318`). No store slice, no new prop, no signature change to
`ToolRow`, `Timeline` or `TimelineRow`.

**Concurrency:** none. No async, no subscription, no effect, no timer, nothing to cancel or tear down.
The row unmounts with the thread on reset, taking its boolean with it — #697's existing behaviour.

**Error handling:** there are no failure modes to surface. `input` is already a validated
`Readonly<Record<string, string>>` by the time it reaches the renderer — `parseToolUsePayload`
(`main/transport/inboundMessage.ts`) is the boundary that rejects anything else, and a rejected payload
never produces a `toolCall` item. Absent and `{}` are not errors; both draw nothing (§ 1b). An incomplete
map is not an error either — the daemon's 8500-rune bound drops fields silently and `inputSummary`
remains the whole-input fallback. The failed-tool accent is declined for the list, structurally (§ 6).

## 9. Open questions

- **A tool with many long fields makes a tall body.** Each value is independently capped at 240px, so
  five long fields could reach ~1200px of body. Not defended here: the daemon's 8500-rune total bound
  makes it unlikely, and no such row has been observed. Deliberately deferred rather than pre-solved with
  a third capping mechanism — raise it with the operator if a real row is unreadable.
- **No design exists for the expanded row.** § *Design source* records the gap. If the field list needs a
  visual decision beyond `.unrecognized-row__raw`'s language — a divider, a two-column name/value layout,
  a distinct name treatment — **flag it for the operator rather than inventing one**.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings.** The boundary is upstream and unchanged: `parseToolUsePayload`
  (`src/main/transport/inboundMessage.ts`) validates the wire `input` map in the **main** process, and the
  renderer receives an already-typed `Readonly<Record<string, string>>` over the IPC bridge. This ticket
  adds no parsing, no validation, and no new boundary. What it *does* change is the **classification of
  data already held**: field **names** become rendered display text for the first time. The design treats
  a name as exactly as untrusted as the value beside it (§ 6.2 scenario 9 pins both halves with one
  hostile fixture) — an MCP tool can name a field anything, so a name is daemon-chosen text, not a
  client-owned label.

- **[XSS / raw-markup sinks] No findings, and this is the category that matters here.** Both strings
  reach the DOM **only** as auto-escaped React children — the name as a `<span>`'s child, the value as a
  `<pre>`'s. No `dangerouslySetInnerHTML`, no `innerHTML`, no attribute of any kind (no `title`, no
  `aria-label`, no `data-*`, no `id`), no URL, no `<a href>`. Three concrete tempting sinks are declined
  on purpose, each a MUST FIX if it appears in the implementation:
  - **`AssistantMarkdown`** is imported into this same file (`:14`) and renders two arms up (`:544`).
    Rendering a value through it — reasonable-sounding for a `content` or `new_string` field — yields
    links and images, and an `<img src>` in daemon-relayed text is an **outbound request issued by a
    privileged renderer**, a beacon whose URL the daemon chose. A `<pre>` with text children cannot emit
    one.
  - **`title={value}`** is the natural next edit the instant someone notices the 240px cap clips a long
    value. The answer to a clipped block is its scroll container, never a tooltip carrying an untrusted
    string into an attribute — the same shape #696 and #705 both already declined.
  - **Linkifying a `url` field.** The map routinely carries a field literally named `url`, and it is now
    drawn in full rather than as a headline. Making it clickable is the `<img src>` beacon shape with an
    extra step.

- **[Injection via lookup path] No findings.** The field name is used as a React reconciliation key
  (§ 1e) and nowhere else — never as a filename, cache key, storage key, `id`, or index into any map.
  React keys are not serialised to the DOM. The name is already rendered as visible text, so the key use
  adds no exposure. `Object.entries` reads own enumerable properties only, so no prototype member
  (`toString`, `constructor`, `__proto__`) can be reached or invoked — and the design never does
  `input[key]`, which is the form that could return an inherited function.

- **[Electron attack surface] No findings.** Renderer-only change. No IPC channel added or widened, no
  `contextBridge` surface touched, no `webPreferences` change, no navigation or `window.open` path, no new
  main-process code. Nothing crosses a process boundary that did not already cross it under #643.

- **[Tokens / secrets / crypto / file & storage] Not applicable, by construction.** No key, token, socket,
  path, filesystem call, `safeStorage` use, randomness, or comparison of any kind appears in this design.
  The transport stays untouched in the background process.

- **[Logs / telemetry] No findings — and one active decline.** The design adds **no log line**. A log here
  would be the single most tempting one in the ticket ("which fields did we draw?"), and any useful
  version carries daemon-chosen names and values into a log file — forbidden by ADR 0007's content-free
  rule and by CLAUDE.md. #697's SAFETY block already declines a log line for the toggle; this extends the
  same decline to the list. MUST FIX if a log call appears.

- **[Resource exhaustion / DoS from a hostile daemon] No findings.** Three bounds hold, all inherited
  rather than invented: the daemon caps each value at 4000 runes and the whole map at 8500; the Noise
  envelope ceiling (65519 B) bounds the frame regardless; and each rendered value is capped at 240px with
  internal scroll by the shared `.tool-row__result` declaration set (§ 5.2). The one genuinely *new*
  layout vector is an unbroken multi-thousand-character **field name**, which has no spaces and would not
  wrap — `word-break: break-word` (§ 5.3) is the specific answer, and it is the repo's existing house
  value rather than a new mechanism. Worst case across all of it is an ugly row, never a hang or a leak.

- **[Concurrency] Not applicable.** No async work, no effect, no timer, no listener, no shared mutable
  state (§ 8). Nothing to cancel, nothing to race.

- **[Threat model alignment] Addressed.** The applicable desktop threat is **hostile daemon response** —
  something inside the Noise session returning crafted field names or values. This design's answer is that
  every such string is inert escaped text in a non-markup sink, bounded in size upstream and in height
  downstream. A **compromised relay** is content-blind and on-path only; it cannot reach this data.
  **Renderer compromise reaching the transport** is unchanged — no key, socket, or token is nearer the
  window than it was before this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-24
