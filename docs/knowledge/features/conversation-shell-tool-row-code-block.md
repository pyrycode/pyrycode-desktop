# Conversation shell — tool row code block

Split out of [Conversation shell — tool row layout](conversation-shell-tool-row-layout.md) on 2026-09-05 to
keep every section under the size cap; see that document for the layout arc as a whole and
[Conversation shell](conversation-shell.md) for the screen itself.

## Shell command code block (#780)

The headline (#705) already reads a `Bash` call's `description` (or falls back to `command`), and the
field list (#706) already listed `command` a second time as a plain value beneath it — so opening a shell
call showed the sentence the headline already said, and showed its command, the thing the row was opened
for, as a name/value row rather than as code. #780 promotes the command into a code block leading the
body and drops both `description` and `command` from the list beneath it, keyed on the tool name being
exactly `Bash` — the same `===` test `toolHeadline.ts` rule 1 already uses for its `description`/`command`
precedence override.

**Why the carve-out doesn't break #706's rule.** #706's list exists to cover the headline's misses, so a
field silently missing from it is worse than one repeated. That's true for every tool whose headline is a
*guess* — but `Bash`'s headline is not a guess: `firstNonEmpty(input, BASH_FIELDS)` on `description` then
`command` never falls through past a non-empty `description`, so a non-empty `description` is *always* on
the headline and a non-empty `command` is *always* in the block. Neither carved-out field is ever silently
missing — both are promoted elsewhere in the same body. Every other tool, including `BashOutput` (a real,
distinct tool name), keeps the unfiltered list; the `===` test is what buys that for free instead of as a
second guard.

Two new pure, framework-free functions in `src/renderer/src/screens/conversation/toolBody.ts` — the
expanded body's counterpart to `toolHeadline.ts` (the collapsed row's), and for the same reason: the
renderer test tier is `renderToStaticMarkup` string assertions with no DOM, so a rule expressed inside the
component could only ever be asserted through markup, while here each rule is a value in and a value out:

```ts
export function shellCommandBlock(source: ToolBodySource): string | null
export function listedInputFields(source: ToolBodySource): readonly (readonly [string, string])[]
```

`shellCommandBlock` returns the command for a `Bash` call carrying a non-empty `command`, and `null` in
every other case — not-`Bash`, no `input`, no `command`, `command === ''` — collapsed into one value
rather than a status, so the render-site guard is `command !== null` and an empty bordered box is
structurally unreachable rather than conditionally avoided (`AssistantMarkdown.tsx`'s `language !== null`
guard is the precedent this borrows). `listedInputFields` is `Object.entries(input ?? NO_INPUT_FIELDS)`,
filtered by `.includes(name)` against `['description', 'command']` — an exact-name test, never
`startsWith`, so `command_timeout` / `commands` / `description_url` all survive — and only when the tool
is `Bash`; every other tool's entries pass through untouched. Both functions route their tool-name check
through one private predicate reading `BASH_TOOL_NAME`, **imported from `toolHeadline.ts`, never
re-declared**: which tool is the shell tool is genuinely one fact, and the coupling is load-bearing — the
carve-out's whole safety argument is that *this same tool's* headline is a fixed rule, so if the name ever
diverged between the two files the list would drop `description` from a call whose headline no longer
promoted it. The two-field omission list (`OMITTED_SHELL_FIELDS`) is declared independently of
`toolHeadline.ts`'s own `BASH_FIELDS`, even though both hold `['description', 'command']` today — a probe
*order* and an omission *set* are unrelated facts, and deriving one from the other would let a future
reorder of the picker silently change what the body draws (the `PREFERRED_FIELDS`/`PATH_FIELDS` precedent
one file over).

`ToolRow` renders the block as the body's first child, above the field list and the result:

```html
<div class="code-block">
  <pre class="code-block__body">{command}</pre>
</div>
```

The same two elements and the same two classes `AssistantMarkdown.tsx`'s `pre` override emits for a fenced
block in a message (see [Assistant markdown renderer](assistant-markdown-renderer.md)) — no
`.code-block__header` (AC1 forbids a language header, and #721's divider is a `border-bottom` on the
header specifically so a headerless block draws no doubled edge) and no `<code>` child (nothing here needs
a `language-*` class, and the `.code-block__body, .code-block__body code` font-mono pair already applies
to a bare `<pre>`). Sharing the classes rather than extracting a component is what makes "a later restyle
of one lands on both" a CSS-only fact — the same way #721 itself shipped as a pure CSS restyle across zero
TSX files.

**The chrome's wrapping pair didn't travel with the classes, and that was the one real trap.**
`white-space: pre-wrap` lived on `.bubble__markdown pre` — a descendant selector scoped to the markdown
container — and `word-break: break-word` was inherited from `.bubble`. Neither reaches `.tool-row__body`,
which is not a `.bubble` descendant, so reusing `.code-block`/`.code-block__body` outside a bubble would
silently have dropped both and let a long command overflow the row instead of wrapping. Both declarations
moved onto `.code-block__body` itself, and `.bubble__markdown pre` was deleted rather than left
duplicated — safe by construction, since `AssistantMarkdown`'s `pre` override is total over the `<pre>`
element and no `rehype-raw` means no other `<pre>` can exist under `.bubble__markdown`. Both computed
values inside a bubble are unchanged, so `e2e/assistant-whitespace.spec.ts` needed no assertion edits —
only a comment fix naming the rule that moved (three other CSS comments and one e2e comment cited
`.bubble__markdown pre` as a precedent and were corrected in the same commit; a deleted rule strands any
comment that cites it as one). No `max-height`/`overflow` on the block, in either location — it diverges
from `.tool-row__result`'s 240px cap on purpose: a result can reach 64KB, a command is bounded by the
daemon at 4000 runes, and the command is the thing the reader opened the row to see.

**What does not suppress the repeat.** On the 11.2% of shell calls with no `description`, the headline
falls through to `command`, so the header and the code block carry the same text. That repeat is
*wanted*, not a bug: the header ellipsises on one line, the block does not, and a command long enough to
be cut is exactly the call the row was opened for. `shellCommandBlock` never looks at what the headline
picked, so the repeat is unreachable-to-suppress rather than a declined branch — adding a "skip the block
when the headline already shows it" guard would be a regression, not a fix.

**Security posture**, extending #706's SAFETY block a third time: the command was already rendered twice
before this ticket (headline, list-row value); after it, the same set of untrusted strings reaches the DOM
through one fewer sink, not one more. Four sinks this ticket made newly tempting are declined and named in
`ToolRow`'s own comment as MUST-FIX-if-reintroduced: routing the command through `AssistantMarkdown` (the
ticket's own "same chrome as a fenced code block" phrasing makes this the obvious-looking shortcut, and it
would yield links/images from daemon text and let a crafted command break out of a synthesized fence), a
`language-*` class on a `<code>` child, `title={command}`, and linkifying a detected URL inside the
command. The one new index read, `input[COMMAND_FIELD]`, is safe for the same two reasons
`toolHeadline.ts`'s `firstNonEmpty` already documents: the key is a client-owned constant, and `'command'`
collides with no `Object.prototype` member.

**Testing**, unit tier only (no DOM, so no e2e tier is needed): `toolBody.test.ts` covers both functions as
values in/values out (12 scenarios, including the `startsWith`-would-wrongly-catch guard on
`command_timeout`/`commands`/`description_url`, and the `===`-not-`startsWith` proof against `BashOutput`).
The sharpest regression check is free rather than written: every fixture in `ConversationScreen.test.tsx`
before this ticket has the tool name `read_file`, and two of them (`:675-688`, `:691-705`) already pass a
`command` field into an *expanded* row and assert it renders as a `tool-row__input-value` list row. Both
stayed green **unedited** — if either had needed a change, the carve-out would have been keyed on the
field name instead of the tool name, which is exactly the mistake AC4 exists to forbid.

Code review: PASS, four non-blocking NITs (comment line-wrap and title-wording only). See the merged PR
(#844) for the full record; there is no `docs/knowledge/codebase/780.md` — that directory was frozen
2026-08-26, and this section is #780's only home.

