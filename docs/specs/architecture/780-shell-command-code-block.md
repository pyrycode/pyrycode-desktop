# #780 — a shell call's command as a code block, and its description off the list

Ticket: https://github.com/pyrycode/pyrycode-desktop/issues/780
Size: **S** (3 production `.ts`/`.tsx` files — 1 new, 2 modified — plus `conversation.css` and 2 test
files; 3 new exports, 1 newly-exported existing constant, 1 consumer call site)
Labels: `enhancement`, `size:s`, `security-sensitive`

---

## Files to read first

**Codegraph gap, re-verified this run (2026-08-27).** `mcp__codegraph__codegraph_context` errors with
`CodeGraph not initialized for this project`; `.codegraph/` carries a config and no database. This reading
list is hand-built from `grep -n` + `Read` against `main` at `f25b936`, not skipped. Line refs drift —
re-Read before citing one in code.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:760-873` | `ToolRow`. `body` (`:776`), `chipRuns` (`:778-788`), and the body block (`:815-870`). The code block's insertion point is the first child of the body `<div>` at `:821`, above #706's field list. |
| `…/ConversationScreen.tsx:702-759` | The accumulated SAFETY block. #697, #705 and #706 each appended a paragraph; #780 appends the fourth. Read all of it — the declined sinks are cumulative, not superseded. |
| `…/ConversationScreen.tsx:821-848` | #706's in-render comment. **It contains the claim this ticket falsifies** — *"no skipping the field the headline already promoted"* / *"a field silently missing from it is worse than a repeated one"*. See § 6. |
| `…/ConversationScreen.tsx:875-888` | `TOOL_RESULT_EMPTY_COPY` and `NO_INPUT_FIELDS`. The second one **moves** to the new module (§ 1); its whole doc comment moves with it. |
| `…/toolHeadline.ts:83-86` | `BASH_FIELDS` and `BASH_TOOL_NAME`. The second is exported by this ticket (§ 2); the first is **not** and must not be reused (§ 1.3). |
| `…/toolHeadline.ts:96-113` | `firstNonEmpty`. The `const value: string | undefined = input[key]` annotation and why it is load-bearing with `noUncheckedIndexedAccess` off — the new module repeats exactly this shape. |
| `…/toolHeadline.ts:124-177` | `pick`'s four rules. Rule 1 is the `Bash` precedence override the carve-out's safety argument rests on: read it to confirm the headline for `Bash` is a fixed rule, not a guess. |
| `…/AssistantMarkdown.tsx:176-196` | The `pre` override. The exact element pair this ticket reuses — `div.code-block` > optional `div.code-block__header` + `pre.code-block__body` — and the `language !== null` guard whose shape § 3 clones. **No edit to this file.** |
| `…/conversation.css:365-380` | `.bubble__markdown pre`. The one-declaration rule this ticket **deletes**, and the comment that argues why `white-space` was deliberately not restated on the class. § 4 is that argument's condition changing. |
| `…/conversation.css:548-645` | `.code-block`, `.code-block__header`, `.code-block__body` and the `--font-mono` pair. Every declaration except the two added in § 4 stands verbatim — #721 owns these values. |
| `…/conversation.css:290-303` | `.bubble`'s `word-break: break-word` (`:298`), the value `.code-block__body` inherits today and must declare once it renders outside a bubble. |
| `…/conversation.css:1117-1125` | `.tool-row--expanded`. `align-items: flex-start` is what makes `.tool-row__body` content-sized; § 4.3's width chain rests on it. |
| `…/conversation.css:1211-1257` | `.tool-row__body` and the shared `.tool-row__result, .tool-row__input-value` set. Read the second to confirm you are **not** editing it: the field-value chrome is #706's and is untouched. |
| `…/ConversationScreen.test.tsx:352-374` | The `toolItem(result, input?)` builder. § 7.1 adds a third optional parameter; every existing caller stays unedited. |
| `…/ConversationScreen.test.tsx:616-777` | #706's whole block. `:675-688` and `:691-705` both pass a `command` field on a `read_file` item — the free regression baseline, § 7.2. |
| `e2e/assistant-whitespace.spec.ts:520-545` | `readInlineCodeMetrics`' thread-wide `querySelector('.code-block')`. Verified safe (§ 7.4); read it to see why the invariant matters. |
| `CLAUDE.md` § Conventions | The 2026-08-20 operator ruling on daemon text, and the renderer-tests-are-static-server-renders paragraph. |
| `docs/specs/architecture/706-tool-input-field-list.md` | The field list this carves two fields out of, and the rule that says not to. |
| `docs/specs/architecture/721-fenced-code-block-desktop-chrome.md` | The chrome being reused, and the divider-owner decision § 3.2 depends on. |

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-553 (component),
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=155-690 (shell call),
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=157-707 (non-shell call)

The `Tool row`'s `Body` is a column that leads with the input and puts the result under it, and its first
two parts are mutually exclusive switches: `Code` for a shell call, `Fields` for every other tool. The
`Code` part is an **instance of #721's code-block component with only its `Content` child on** — a 6px
`Schemes/Background` box inside a 1px `Schemes/Primary Container` border, 12/16 padding, Roboto Mono
12/20, `pre-wrap` + `break-word`, and **no header bar**. The two screenshots read together are what fixes
AC2: in `155-690` the shell call shows a headline sentence, the command in that box, and then the result —
with no `description` row and no `command` row beneath it, while `157-707`'s `Grep` row shows the full
`pattern` / `path` list in the grey `surface-container-high` value boxes #706 already ships.

One deliberate deviation, flagged rather than adopted — see § 5.4: the design nests the per-field groups
inside a `Fields` frame, giving 12px between the code block and the list and 8px between fields. The
shipped body is flat at 8px throughout, and adopting the nesting would reintroduce the list wrapper #706
declined on purpose.

---

## Context

`ToolRow`'s expanded body lists every input field by name, literally and completely — #706's decision, and
its reasoning is in the code: *"This list is what covers that pick's misses, so a field silently missing
from it is worse than a repeated one."* That rule is right for every tool whose headline is a **guess**.

`Bash` is the one tool whose headline is not a guess. `toolHeadline.ts:158-163` matches the name with
`===` and probes `description` then `command` in fixed order, so there is no miss for the list to catch.
The consequence, on the body 62.4% of all tool calls land in: opening a shell row shows you the
description sentence you just read on the row itself, one line below it, and shows you the command — the
thing you opened the row for — as a value in a name/value list rather than as code.

This ticket makes the command a code block above the list and drops both fields from the list, keyed on
the tool name being exactly `Bash` — the same condition the headline rule already uses, which is what
keeps `BashOutput` and every other tool on the general treatment without a second guard.

---

## Design

### 1. New module — `src/renderer/src/screens/conversation/toolBody.ts`

The expanded body's input treatment, as a pair of total functions of `{ name, input }`. Co-located,
React-free, framework-free, no injected deps — `toolHeadline.ts`'s own shape, and for its own reason: the
renderer test tier is `renderToStaticMarkup` string assertions in the `node` environment, so a rule
expressed inside the component could only ever be asserted through markup, while here each rule is a
value in and a value out. `toolHeadline.ts` is the collapsed row's run; this is the expanded row's input.

#### 1.1 The contract

```ts
export interface ToolBodySource {
  name: string
  input?: Readonly<Record<string, string>>
}

/** The command a shell call renders as a code block above its field list, or null when there is none. */
export function shellCommandBlock(source: ToolBodySource): string | null

/** The entries the expanded body's field list draws, in arrival order. */
export function listedInputFields(source: ToolBodySource): readonly (readonly [string, string])[]
```

`ToolBodySource` is deliberately not `ThreadItem`: the arm carries `kind`, `turnId`, `toolUseId`,
`inputSummary` and `result` besides, which would be noise in every fixture. The call site passes the whole
item — excess-property checking does not apply to a variable — so this narrows the contract without
narrowing the call. `toolHeadline.ts:37-45`'s `ToolHeadlineSource` is the precedent, and the two are
**separate interfaces**: this one has no `inputSummary` because the body has no rule-4 fallback.

`shellCommandBlock` returns null in four cases and there is no fifth: the name is not exactly `Bash`,
`input` is absent, `command` is absent, `command` is `''`. Each is "there is nothing to draw", so they
collapse into one return value rather than a status. **AC3's "no empty code block" is that null**, and the
`!== null` guard at the call site (§ 3.1) is where it becomes structural.

`listedInputFields` is `Object.entries(input ?? NO_INPUT_FIELDS)`, filtered by an exact-name test **only
when the tool is `Bash`**, and returned otherwise untouched. No `.sort()`, no re-ordering, no shortening,
no salience pick — everything #706 § 4 declines, still declined.

#### 1.2 Three module-private constants

| Constant | Value | Why it is what it is |
|---|---|---|
| `NO_INPUT_FIELDS` | `{}`, typed `Readonly<Record<string, string>>` | **Moved verbatim from `ConversationScreen.tsx:888`**, doc comment and all, because the `??` it exists for moves here. Delete it from the screen. The reason it is named rather than a bare `{}` literal is a real typing trap and is recorded in that comment — do not re-derive it, move it. |
| `COMMAND_FIELD` | `'command'` | The one field the code block promotes. |
| `OMITTED_SHELL_FIELDS` | `['description', 'command']`, `readonly string[]` | The two a shell call's list leaves out. Its doc must name where **each** goes instead — `description` onto the headline (`toolHeadline.ts` rule 1), `command` into the block above the list — because "promoted, not missing" is the entire argument for the carve-out being compatible with #706's rule. |

`OMITTED_SHELL_FIELDS` is declared independently and is **never** `BASH_FIELDS` imported from
`toolHeadline.ts`, though the two hold the same two strings today. A probe ORDER and an omission SET are
unrelated facts, and deriving one from the other would let a future reorder of the picker silently change
what the body draws. This is exactly the `PREFERRED_FIELDS` / `PATH_FIELDS` precedent one file over
(`toolHeadline.ts:66-73`), and the comment should say so.

`readonly string[]` and not `as const`, for the same reason that file records: an `as const` tuple narrows
the element type to a literal union, which makes `OMITTED_SHELL_FIELDS.includes(name)` a compile error.

**The membership test is `.includes(name)` on the whole name, never `startsWith` and never a prefix or
substring test.** A shell call carrying `command_timeout`, `commands` or `description_url` keeps that
field. Scenario 12 in § 7.3 is the guard.

#### 1.3 The tool-name test, and the one thing that IS shared

Both functions route their name test through a single module-private predicate — one `===` against
`BASH_TOOL_NAME`, in one place, so "the carve-out matches the tool name exactly" cannot drift between the
block and the filter.

`BASH_TOOL_NAME` is **imported from `toolHeadline.ts`**, which exports it for this (§ 2). Unlike the field
lists above, this is genuinely one fact — *which tool is the shell tool* — and the coupling is
load-bearing rather than incidental: the carve-out's whole safety argument is that **this same tool's**
headline is a fixed rule rather than a pick. If the name moved in one file and not the other, the body
would drop `description` from a list whose headline no longer promoted it — a silently missing field,
precisely what #706's rule exists to prevent. Sharing the constant makes that failure unreachable.

`===` and never `startsWith`: `BashOutput` is a real tool name, it is not a shell call, and it keeps the
general treatment. That is the "get it for free rather than as a second guard" the ticket's technical note
names, and § 7.3 scenarios 4 and 8 pin both halves of it.

#### 1.4 The index read, and why it is allowed here

`shellCommandBlock` reads `input[COMMAND_FIELD]` — the one form #706 § 1c forbids for a *daemon-chosen*
key. It is safe here for two reasons that must both be stated in the comment, because either alone is
insufficient: the key is a **client-owned constant**, and `command` collides with no `Object.prototype`
member, so no inherited value can be returned. `toolHeadline.ts:96-113`'s `firstNonEmpty` does the same
thing with `PREFERRED_FIELDS` and records the same argument. `listedInputFields` still uses
`Object.entries` and never indexes by a daemon key.

**The annotation is mandatory**, and it is the central trap in this module: `tsconfig.web.json` sets
`strict: true` and nothing else, so `noUncheckedIndexedAccess` is OFF and `input['command']` on a
`Record<string, string>` types as `string` while being `undefined` at runtime for an absent key. Write
`const command: string | undefined = input[COMMAND_FIELD]` and test `!== undefined && !== ''`. Testing
only `!== ''` would let `undefined` reach the render, where React draws nothing — an empty bordered box,
the exact shape AC3 forbids, arriving through the type system.

`!== ''` exactly, never `.trim() !== ''`. A whitespace-only command is a real residual left unguarded on
purpose: none appears in the measurement, and `=== ''`-never-`.trim()` is already the shipped decision two
elements away (`ConversationScreen.tsx:855-858`).

### 2. `toolHeadline.ts` — one word

`const BASH_TOOL_NAME` → `export const BASH_TOOL_NAME`, and its doc comment gains a sentence naming the
second consumer and § 1.3's reason. **Nothing else in that file changes** — not `BASH_FIELDS`, not `pick`,
not the rule order, not the headline's behaviour on any input. The collapsed row is untouched by this
ticket, which is what keeps the 11.2% of shell calls with no `description` still headlined by their
command (§ 5.1).

### 3. `ConversationScreen.tsx` — the render

#### 3.1 One new binding and one new element

Beside `const body = expanded ? result : null` (`:776`), add `const command = shellCommandBlock(item)`.
A `const` rather than an inline call because it is consumed **twice** — by the guard and by the child —
which is exactly the reason `chipRuns` is one (`:778`). The field list stays **inline** as
`listedInputFields(item).map(…)`: consumed once, and inlining keeps "a collapsed row never computes the
list" structural, the property #706 § 2 records.

Inside the `{body && (…)}` block, as the **first** child of the body `<div>` and above the field list:

```tsx
{command !== null && (
  <div className="code-block">
    <pre className="code-block__body">{command}</pre>
  </div>
)}
```

`command !== null`, never a bare `&&` on the string. The guard names the one falsy value the helper can
return, so an empty-string command can never render an empty bordered box — the shape AC3 forbids. This is
`AssistantMarkdown.tsx:187-192`'s argument for `language !== null`, applied to the same chrome.

Then `Object.entries(item.input ?? NO_INPUT_FIELDS)` at `:849` becomes `listedInputFields(item)`; the
`.map` body, its `key={name}`, its two child elements and their classes are **unchanged**. Delete
`NO_INPUT_FIELDS` (`:878-888`) — it now lives in `toolBody.ts`.

#### 3.2 No `<code>` child, and no header

The markdown fence renders `<pre class="code-block__body"><code>…</code></pre>` because react-markdown
puts the `<code>` there; this renders a bare `<pre>`. The `.code-block__body, .code-block__body code` pair
(`conversation.css:642-645`) applies `--font-mono` to both, so the bare form is visually identical, and
the row's own two payload elements (`.tool-row__result`, `.tool-row__input-value`) are bare `<pre>`s — this
is the row's idiom, not a shortcut.

No `.code-block__header` element, ever, and nothing that would produce one. AC1 says no language header,
the design's `Code` instance has its header off, and #721's divider decision means "no header" is also
"no stray rule": the divider is a `border-bottom` on the header rather than a `border-top` on the body
precisely so a headerless block draws no doubled edge. That behaviour is shipped, e2e-pinned, and reused
here for free.

#### 3.3 Comments — three sites, all in files this ticket already opens

These are **not** optional polish. Two of them are claims this ticket falsifies, and leaving a false
comment beside the code it describes is the defect #706 § 7 was written to fix.

1. **`ConversationScreen.tsx:821-848`** — #706's in-render comment. *"no skipping the field the headline
   already promoted"* and *"a field silently missing from it is worse than a repeated one"* are now true
   for every tool **except** `Bash`. Rewrite to state the rule and its one carve-out together, with the
   reason: `Bash`'s headline is a fixed rule rather than a guess, so there is no miss for the list to
   cover, and both dropped fields are promoted elsewhere in the same body rather than missing from it.
2. **`ConversationScreen.tsx:819`** and **`conversation.css:1212`** — both read *"A CONTAINER, not a lone
   text node: #706 landed its per-input-field list in here, above the result."* Still true; extend each
   with the code block now leading the column for a shell call.
3. **The SAFETY block (`:702-759`)** — append a `#780` paragraph. § 8 has its content.

Do not touch any other `#706` or `#705` reference. Stale attribution is not a false claim, and chasing it
turns a three-file slice into an eight-file one.

### 4. `conversation.css` — making the block portable

`.code-block` is about to render in a second place, and two of the declarations that make it work today
are **not on it**. This is the whole CSS change; every value #721 set stands.

#### 4.1 The two declarations that do not travel

| Property | Where it comes from today | What happens inside `.tool-row__body` |
|---|---|---|
| `white-space: pre-wrap` | `.bubble__markdown pre` (`:378-380`) — a descendant selector scoped to the markdown container | Does not match. The `<pre>` keeps the UA's `white-space: pre`, stops wrapping, and a long command paints past the row's measure. |
| `word-break: break-word` | inherited from `.bubble` (`:298`) | `.tool-row` is not a `.bubble` descendant, so nothing is inherited — the same gap #706 § 5.3 found for `.tool-row__input-name`. |

Everything else the block needs is already on `.code-block` / `.code-block__body` itself: the fill, border
and radius; `margin-block: 0`; the padding; `--color-on-surface`; the full type quartet; and `--font-mono`
on the `<pre>` and its `code` child alike. Nothing else is missing.

#### 4.2 Move, do not duplicate

Delete the `.bubble__markdown pre` rule and add both declarations to `.code-block__body`.

Adding them while leaving that rule in place would ship the same property twice on the same element and is
the drift AC5 exists to prevent — and the comment at `:374-377` already forbids it in as many words:
*"white-space is deliberately NOT restated on the new class: one subject, one rule, so a future reader
looking at two rules that both target this element knows which one owns the wrapping."* This ticket does
not overrule that comment; it changes its **condition**. The rule had one subject while the block rendered
only inside `.bubble__markdown`. It now has two, and `.code-block__body` is the selector that names both.

Deleting the rule is safe by construction, not by inspection: `AssistantMarkdown`'s `pre` override is
total over the `<pre>` element and always emits `pre.code-block__body`, and raw HTML is escaped rather
than parsed (no `rehype-raw`), so no other `<pre>` can exist under `.bubble__markdown`.

Neither computed value changes in the bubble — `pre-wrap` is the same value from a different selector, and
`break-word` is the same value declared instead of inherited — so `e2e/assistant-whitespace.spec.ts` stays
green untouched, including its explicit `whiteSpace === 'pre-wrap'` assertion on this element.

The comment at `:365-377` carries reasoning that must **survive the move, not die with the rule**: why
`<pre>`'s UA `white-space: pre` has to be overridden at all, Figma 16:49's pre-wrap + break-word pairing,
and the deliberate absence of `max-height` / `overflow` with `.unrecognized-row__raw` as the
anti-precedent. Fold it into `.code-block__body`'s comment and add why the block now states both values
itself. `.code-block`'s own comment (`:548`) gains one sentence: it renders in two places as of #780.

#### 4.3 Width and height containment — nothing new is needed

**Width.** `.tool-row--expanded` is a column flex with `align-items: flex-start`, so `.tool-row__body` is
content-sized and capped by its own `max-width: 100%`; `.code-block` is a stretched item of that column
and resolves to the same width; `pre-wrap` + `break-word` then wrap inside it. This is the chain #696
shipped and #706 reused, and it needs no `min-width: 0` on `.code-block`: `min-width: auto` is a
main-axis remedy and the main axis here is vertical.

**Height.** No `max-height` and no `overflow` — deliberately, and this is where the command block
diverges from `.tool-row__result`'s 240px cap. A result can reach 64KB; a command is bounded by the daemon
at 4000 runes and is one line in the overwhelming majority of calls. More decisively, the command is the
thing the reader opened the row to see, and the ticket is explicit that the body does not cut it short.
Capping it would be a defence for a failure mode no measurement has recorded. § 9 carries the residual.

### 5. What this ticket deliberately does NOT do

#### 5.1 It does not suppress the block when the headline already shows the command

On the 11.2% of shell calls with no `description`, `toolHeadline` rule 1 falls through to `command`, so
the row's headline and the body's code block carry the same text. **That repeat is wanted.** The header
ellipsises on one line; the block does not, and a command long enough to be cut is exactly the call the
row was opened for. `shellCommandBlock` never looks at what the headline picked, so the suppression is
unreachable rather than declined at a branch. **Adding a "skip the block when the headline already shows
it" guard is a defect, not an improvement.**

#### 5.2 It does not extend the carve-out to any other tool

Not to `BashOutput`, not to a tool whose headline happened to pick `command`, not to MCP tools with a
`command`-named field. The condition is the tool name and nothing else, and § 7.3 scenario 5 and § 7.2's
free baseline both fail loudly if it becomes field-keyed.

#### 5.3 It does not touch the result, the field-value chrome, or the headline

The result stays under the input, still `.tool-row__result`, still `white-space: pre` with its own scroll
and its own 240px cap. `.tool-row__input` / `-name` / `-value` keep every declaration #706 gave them —
including the `--radius-sm` and `--space-3 / --space-bubble-x` padding that read a few px off the design's
value box, which is #706's to revisit and not this ticket's. `toolHeadline`'s behaviour is unchanged on
every input.

#### 5.4 It does not adopt the design's `Fields` wrapper

The design nests the per-field groups in a `Fields` frame — 12px between the code block and the list, 8px
between fields. The shipped body is flat at 8px throughout. Adopting the nesting would reintroduce the
list-wrapper element #706 declined on purpose (its absence is what makes "an empty map draws no empty
container" structural) and would change #706's markup for every tool, which no AC here asks for. Left as
a flagged deviation for the operator — § 9.

#### 5.5 It does not extract a shared `CodeBlock` component

The ticket leaves the choice open and this takes the class-sharing half. AC5 asks that a later restyle of
one block land on both, and the chrome lives **entirely** in CSS keyed on `.code-block` /
`.code-block__body` — #721 was itself a pure restyle across two CSS files and zero TSX, so a repeat of it
reaches both call sites without touching either. § 7.3 scenario 5 makes the shared markup contract a
deterministic test rather than a claim. Extraction is the right move the day the block gains **structure**
a restyle cannot carry — a copy button, a filename bar, a collapse affordance — and that is the trigger to
name in a follow-up, not to pre-build here.

---

## State + concurrency model

None added. `ToolRow` keeps its single component-local `useState<boolean>` from #697, untouched. Both new
functions are pure and total over their argument type: every branch is a comparison, a property read, or a
loop over `Object.entries`, none of which throws. The code block is a pure function of `item.name` and
`item.input`, which the reducer carries onto the item by reference and never mutates
(`store/threadTimeline.ts`). No store slice, no new prop, no signature change to `ToolRow`, `Timeline` or
`TimelineRow`. No async, no subscription, no effect, no timer, nothing to cancel or tear down.

## Error handling

There are no failure modes to surface, and no error path is added. `input` is already a validated
`Readonly<Record<string, string>>` by the time it reaches the renderer — `parseToolUsePayload`
(`src/main/transport/inboundMessage.ts`) is the boundary that rejects anything else, and a rejected
payload never produces a `toolCall` item. Every "missing" case is a normal state with a defined render
rather than an error: no `command` draws no block and the list alone; no `description` draws the block and
the headline repeats it; an empty carve-out result draws no list and no empty container; absent `input`
draws neither. Nothing is logged on any of these paths — see § 8.

## Testing strategy

Unit tier only. `vitest.config.ts` sets `environment: 'node'` and every renderer spec is a
`renderToStaticMarkup` string, so there is no DOM, no effects and no clicks — and every criterion here is
a markup property, which is why the ticket correctly says none of this needs an e2e tier. **Do not add a
DOM environment.**

### 7.1 The one fixture change

`toolItem` (`ConversationScreen.test.tsx:361-374`) gains a **third optional parameter**,
`name = 'read_file'`, replacing the hard-coded literal at `:369`.

Third and positional, not an options object and not second, for one reason: every existing caller must
stay byte-identical. That is not tidiness — it is what makes § 7.2 a real regression check rather than a
hope. Extend the builder's existing comment with the same note #705 left when it added `input`.

### 7.2 The free regression baseline — sharper than #706's

#706's baseline was a disjointness (`input`-carrying and `defaultExpanded` never met). #780's is stronger
and directly proves AC4's central claim: **every existing fixture in the file has the name `read_file`**,
so the carve-out fires on none of them.

Two existing tests are the sharp edge, and both already pass a `command` field into an **expanded**
`read_file` row:

- `:675-688` — *"keeps a trailing ellipsis marker the daemon added"*, `{ command: 'SHORTENED_SENTINEL_zzz…' }`
- `:691-705` — *"preserves the line breaks inside a value"*, `{ command: 'line one\nline two' }`

Both assert that `command` renders as a `<pre class="tool-row__input-value">` list row. Under a
name-keyed carve-out they stay green **unedited**. Under a field-keyed one — the mistake AC4 exists to
forbid — they go red immediately.

**So: if either of those two tests needs editing to stay green, the carve-out was keyed on the field name
instead of the tool name. Treat an edit to `:616-777` as a stop signal, not as a stale fixture.**
`AssistantMarkdown.test.tsx` must likewise pass untouched — this ticket makes no TSX change there — and
`grep -rn '"input"' e2e/` still returns nothing.

### 7.3 `toolBody.test.ts` — new

Value in, value out; no rendering. Scenarios:

1. `shellCommandBlock` returns the command verbatim for a `Bash` call carrying `description` + `command`.
2. Returns null for a `Bash` call with no `command` key.
3. Returns null for a `Bash` call whose `command` is `''` — the empty-block guard, at the source.
4. Returns null for `BashOutput` carrying both fields. **The `===`-not-`startsWith` proof.**
5. Returns null for `Read`, `Edit` and an MCP-style name, each carrying a `command`.
6. Returns null when `input` is absent entirely.
7. `listedInputFields` on a `Bash` call with `description`, `command` and `timeout` returns `timeout`
   alone, and the returned pair carries the value unchanged.
8. `listedInputFields` on `BashOutput` with `description` + `command` returns **both**, in arrival order.
9. `listedInputFields` on a `Bash` call whose only fields are `description` + `command` returns `[]` —
   the design's `Fields`-off case.
10. `listedInputFields` returns `[]` for absent `input` and for `{}` alike, for a `Bash` name and a
    non-`Bash` name — #706's absent-vs-empty collapse, now owned here.
11. `listedInputFields` never re-sorts: a non-alphabetical fixture (`zulu`, `alpha`, `mike`) comes back in
    insertion order, which a `.sort()` would invert.
12. `listedInputFields` on a `Bash` call keeps `command_timeout`, `commands` and `description_url`. **The
    guard against a `startsWith` / substring membership test**, which would silently eat real fields.

### 7.4 `ConversationScreen.test.tsx` — new block after #706's

Two fixture traps, both already recorded in that file: `renderToStaticMarkup` escapes `'` → `&#x27;` (keep
apostrophes out of fixtures), and it prepends a newline inside `<pre>` when the child string **starts**
with `\n` (never start a value fixture with one).

1. **An expanded `Bash` row draws the command as a code block above a list carrying neither field
   (AC1, AC2).** `Bash` with `description`, `command` and `timeout`, `defaultExpanded`. Assert the exact
   markup `<div class="code-block"><pre class="code-block__body">CMD_SENTINEL_zzz</pre></div>`; assert
   `timeout` still renders as an `INPUT_NAME` + `tool-row__input-value` pair; assert
   `not.toContain(INPUT_NAME('description'))` and `not.toContain(INPUT_NAME('command'))`; assert
   `indexOf(CMD_SENTINEL) < indexOf(INPUT_NAME('timeout')) < indexOf(<result text>)`. Use the name-span
   helper for the two absence assertions — a bare `not.toContain('command')` would be satisfied by the
   class string and is vacuous.
2. **No `description` still draws the block, and the headline repeat is not suppressed (AC3, § 5.1).**
   `Bash` with `command` only. Assert the block renders, and that the command sentinel appears **twice** —
   once in `tool-row__summary`, once in `code-block__body`. Comment it as the wanted repeat so a later
   reader does not "fix" it.
3. **No `command` draws no block and the list renders alone (AC3).** `Bash` with `description` + `timeout`.
   Assert `not.toContain('code-block')`, `timeout` present, `description` absent from the list.
4. **A `Bash` call with only the two carved-out fields draws the block and no list at all (AC2).** Assert
   `not.toContain('tool-row__input')` — no empty container either — while `code-block` and
   `tool-row__result` are both present.
5. **The block and a message's fenced code block are one chrome (AC5).** Render a `Bash` row and
   `<AssistantMarkdown text={…a languageless fence…} />`, and assert **both** markups contain the exact
   substring `<div class="code-block"><pre class="code-block__body">`. One string, asserted from both
   sides, so a structural divergence in either fails here. Also assert the tool row's markup contains no
   `code-block__header`.
6. **No other tool's body changes (AC4).** `Read`, `Edit` and `BashOutput`, each carrying `description` +
   `command`, each `defaultExpanded`. For each: both names render as list rows, and
   `not.toContain('code-block')`. `BashOutput` is the load-bearing third — it is the name a `startsWith`
   test would wrongly catch.
7. **The command reaches the DOM as inert escaped text (AC5, security).** `Bash` with
   `command: '<img src=x onerror=alert(1)>'` (no apostrophes). Assert the escaped form present, `<img`
   absent, and `not.toContain('title=')`, `not.toContain('aria-label')`, `not.toContain('dangerously')`.
8. **A collapsed `Bash` row draws no block (AC1).** Resolved `Bash` item with a command, no
   `defaultExpanded`. Assert `not.toContain('code-block')` — the block lives inside the body, like the
   list.

**One e2e invariant to know but not act on.** `e2e/assistant-whitespace.spec.ts:539` reads
`.conversation__thread`'s **first** `.code-block` in document order to compare the inline-code fill
against it. That spec's thread contains no tool rows — verified this run — so this ticket cannot disturb
it. But a future spec that puts an expanded `Bash` row ahead of the `CODE` bubble in that same thread
would make that reader pick up the tool row's block instead. Not a change to make here; worth knowing
before writing one.

### 7.5 Commands

`npm test`, `npm run typecheck`, `npm run build`. No e2e change and no e2e run required by this ticket.

## Open questions

- **A very long command makes a tall body.** § 4.3 declines a `max-height`, against
  `.tool-row__result`'s 240px cap one element away. The daemon bounds a command at 4000 runes and the
  ticket is explicit that the body does not cut it short, so this is deferred rather than pre-solved.
  Raise it with the operator if a real row is unreadable — the same disposition #706 § 9 took for a body
  of many long fields.
- **The design's `Fields` wrapper is not adopted** (§ 5.4), so the gap between the code block and the
  first field is 8px where the design draws 12px. Flagged for the operator as a deliberate deviation, not
  an oversight: closing it means adding the wrapper element #706 declined and changing #706's markup for
  every tool. If the operator wants the design's rhythm, that is its own ticket over the whole body.
- **`command: ''` drops the field from the list as well as drawing no block.** The filter is name-keyed
  and unconditional, which is what AC2 asks for literally. An empty value would draw an empty `<pre>`
  under a `command` label and carries no information, and no such value appears in the 58199-call
  measurement — so this is left as a known residual rather than a second branch conditioned on whether the
  block rendered.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings; one classification change, and it is a narrowing.** The boundary is
  upstream and untouched: `parseToolUsePayload` (`src/main/transport/inboundMessage.ts`) validates the
  wire `input` map in the **main** process and the renderer receives an already-typed
  `Readonly<Record<string, string>>` over the IPC bridge. This ticket adds no parsing, no validation and
  no new boundary. Unlike #706 — which promoted field **names** to display text for the first time — this
  ticket promotes nothing new: `command` and `description` are already rendered by #705 (headline) and
  #706 (list). It moves one already-rendered string from a `<pre class="tool-row__input-value">` to a
  `<pre class="code-block__body">` and **removes** one occurrence of each from the DOM. The set of
  untrusted strings reaching the renderer is unchanged and the number of sinks they reach goes down.
- **[XSS / raw-markup sinks] No findings, and this is the category that matters.** The command reaches
  the DOM **only** as an auto-escaped React child of a `<pre>`. No `dangerouslySetInnerHTML`, no
  `innerHTML`, no attribute of any kind (no `title`, no `aria-label`, no `data-*`, no `id`, no `class`
  interpolation), no URL, no `<a href>`. Four sinks this specific ticket makes newly tempting are declined
  on purpose, each a **MUST FIX** if it appears in the implementation:
  - **`AssistantMarkdown` for the command.** It is imported into this same file, renders two arms up, and
    is now the *obvious* reach — the ticket literally asks for "the same chrome as a fenced code block in
    a message", and the shortest path to that sentence is `<AssistantMarkdown text={'```\n' + command +
    '\n```'} />`. That path yields links and images from daemon-relayed text, and an `<img src>` issued by
    a privileged renderer is a beacon whose URL the daemon chose; it would also re-interpret backticks in
    the command as markdown and could break out of the fence entirely. The design renders the raw string
    into the same two elements instead, and § 3.1's markup is the whole implementation.
  - **A `language-*` class on a `<code>` child**, to get "shell" syntax highlighting or a header label.
    AC1 forbids the header; the design's `Code` instance has it off; and #721's fail-closed
    `language !== null` path already renders exactly the headerless block wanted. No `<code>` child at all
    (§ 3.2).
  - **`title={command}`**, the natural next edit for anyone who notices the block is unbounded. Same
    forbidden shape #696, #705 and #706 each already declined; § 4.3's answer to a long command is that it
    wraps, not that it gets a tooltip.
  - **Linkifying a command that contains a URL.** `curl https://…` is a common shell command; wrapping the
    detected URL in an `<a href>` is the beacon shape with an extra step.
- **[Injection via lookup path] No findings.** One new index read exists — `input['command']` (§ 1.4) —
  and its key is a **client-owned constant**, never a daemon-chosen one; `command` collides with no
  `Object.prototype` member, so no inherited value is reachable, and the decoder has already stripped
  `__proto__` / `constructor` / `prototype` upstream (#642). `listedInputFields` iterates with
  `Object.entries` (own enumerable properties, insertion order) and never indexes by a daemon key.
  `.includes(name)` on `OMITTED_SHELL_FIELDS` is an array membership test, not a property access. The
  command string itself is used as a `<pre>`'s text child and nowhere else — never a filename, cache key,
  storage key, `id`, React key or index into any map.
- **[Electron attack surface] No findings.** Renderer-only change. No IPC channel added or widened, no
  `contextBridge` surface touched, no `webPreferences` change, no navigation or `window.open` path, no
  main-process code. Nothing crosses a process boundary that did not already cross it under #643.
- **[Tokens / secrets / crypto / file & storage] Not applicable, by construction.** No key, token, socket,
  path, filesystem call, `safeStorage` use, randomness, or comparison of any kind appears in this design.
  The transport stays untouched in the background process.
- **[Logs / telemetry] No findings — and one active decline.** The design adds **no log line**. The
  tempting one here is specific and worse than #706's: *"which shell command did we draw?"* would put a
  literal daemon-supplied command line into a log file — the highest-value string on the timeline for
  anyone reading that file. ADR 0007's content-free rule and CLAUDE.md both forbid it, #697 and #706
  already declined a log call for this component, and this extends the same decline. **MUST FIX** if a log
  call appears.
- **[Resource exhaustion / DoS from a hostile daemon] No findings; one accepted, bounded residual.** The
  daemon caps each input value at 4000 runes and the whole map at 8500, and the Noise envelope ceiling
  (65519 B) bounds the frame regardless. The block has no `max-height` (§ 4.3), so a maximal command draws
  a tall box — but `pre-wrap` + `word-break: break-word` (§ 4.1) guarantee it wraps rather than widening
  the row, `.conversation__thread` is its own scroll region with `.composer` as a sibling (so nothing can
  push the composer off screen), and the worst case is an ugly row, never a hang or a leak. Net exposure
  **decreases**: two occurrences of `command` become one. The one genuinely unbounded shape in this area —
  an absurd field *name* — is #706's `word-break` and is untouched.
- **[Concurrency] Not applicable.** No async work, no effect, no timer, no listener, no shared mutable
  state. Two pure total functions and one `useState<boolean>` that predates this ticket. Nothing to
  cancel, nothing to race.
- **[Threat model alignment] Addressed.** The applicable desktop threat is **hostile daemon response** —
  something inside the Noise session returning a crafted `command` value. The answer is that the string is
  inert escaped text in a non-markup sink, bounded in size upstream and wrapped rather than overflowing
  downstream, with the four markup-capable sinks above declined explicitly. A **compromised relay** is
  content-blind and on-path only and cannot reach this data. **Renderer compromise reaching the transport**
  is unchanged — no key, socket or token is nearer the window than before this ticket.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
