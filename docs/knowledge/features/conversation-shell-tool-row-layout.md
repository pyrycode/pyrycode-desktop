# Conversation shell — tool row layout

The later redraw of the tool row: the shell command code block, the full-width bordered row, and the header's groups and run routing.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

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

## Full-width bordered tool row (#722)

Restyles the chip from the mobile mock's hug-width pill to the desktop design's full-width bordered box
(Figma `134:4939`) — the same treatment `.code-block` (#721) already ships, adopted rather than invented.
CSS and one theme token only: the markup, the class names and the collapsed prefix are byte-stable, so
every existing tool-row assertion in `ConversationScreen.test.tsx` passed unedited. The third run (a
per-call count) and the chevron that the redrawn Figma component (`155-553`) also draws were held for
\#773/#774 at the time — the chevron shipped in [#854](#tool-row-header-groups-854) (split from #774), the
count is [#856](https://github.com/pyrycode/pyrycode-desktop/issues/856); the expanded body
(`.tool-row__result`, and the `.code-block` #780 puts inside it) is untouched and deliberately not redrawn
here.

**The width mechanic**, the one part with consequences. `.tool-row` was already a stretch item of
`.conversation__thread`'s flex column — the row was always full width, only the chip hugged.
`.tool-row__chip`'s `max-width: 100%` (a ceiling on a hug-width box) becomes `width: 100%`, with
`box-sizing: border-box` added alongside it (`index.css` sets no global box-sizing; `.paired-shell:20-22`
is the file-family precedent for stating it at the call site), and both land on the *base* rule so they
reach the `<button>` and the `<div>` branches identically — that's what makes a resolving row not shift,
pinned by three new width assertions in `e2e/tool-row-toggle.spec.ts` (pending vs. resolved vs. expanded,
each compared against the row's own width with a 0.5px float tolerance), since a rendered width is
invisible to the `renderToStaticMarkup` unit tier. `.tool-row__chip--toggle`'s `box-sizing: content-box` —
held there specifically so `max-width: 100%` bounded both branches alike — is deleted rather than flipped,
since under `width: 100%` it would be exactly backwards: the button would overflow its row by 2×12px
padding plus 2×1px border.

`width: 100%`, not a flex remedy: `.tool-row` flips `flex-direction` between collapsed (`row`) and
expanded (`column`), so `flex: 1` would fill the row collapsed but grow the chip *vertically* expanded,
and `align-self: stretch` would do the reverse. The direction-agnostic form is what `.status-row` and
`.unrecognized-row__summary` already use for the same job, and the e2e's expanded-state assertion is the
one that would go red under a flex-based remedy.

**`.tool-row--expanded`'s `align-items: flex-start` stays, its reason doesn't.** It used to be
load-bearing because `stretch` would blow the hug-width pill out to the full row — the thing this ticket
now wants, so that reason is dead. It survives for a different one: `.tool-row__body` is the column's
*other* child, and under `stretch` the body (and the `.code-block` #780 puts inside it) would go full
width too — a change to the expanded body, which stays #774's. The chip itself is unaffected either way,
since it now carries its own `width: 100%`. **The general lesson, not just this rule's:** three shipped
comments in this region argued *against* the box this ticket builds, and two of the declarations they
guarded still had to stay, for different reasons than the stale comment gave. Grep the region's comments
for the property being changed before changing it, rather than assuming a comment's presence still matches
its reasoning.

**The box treatment**, every value a token, read off the Figma variables rather than assumed: fill
`--color-surface` (the thread's own background — no separate fill step); border colour
`--color-outline-variant` → `--color-primary-container`; corner `--radius-sm` (12px) → `--radius-xs`
(6px); run gap `--space-2` → `--space-3` (8px → 12px, padding unchanged). Both type runs move onto
`--text-body-medium-*`; the headline's ink lifts `--color-on-surface-variant` → `--color-on-surface`. The
design's primary-container variable prints `#134a74`, which agrees with the dark token — no
light-scheme-fallback transposition to correct here, unlike the trap `--color-inverse-primary` and
`.code-block`'s own comment warn about elsewhere in this file.

**One new token**, `--text-tool-name-line: 16px` in `tokens.css`, immediately after `--text-code-body-line`
— the same shape for the same reason. The tool-name run's 14/16 is bound to no type style in Figma, and no
14px step in the scale carries a 16px line (`body-medium` and `label-large` both pair 14px with 20px; 16px
belongs only to a 12px or 11px step). Borrowing `--text-body-small-line` would couple a 14px run to a 12px
step's quartet for no reason beyond convenience. There is no `--text-tool-name-size`: the size is
`--text-body-medium-size`, the same step the sans sibling run takes whole.

**The hover fill moved with the resting one.** Resting dropped `--color-surface-container` →
`--color-surface`, so the outgoing hover value (`--color-surface-container-highest`, two rungs up the
ladder) would have become a three-rung jump. `.status-row:hover` had already answered this exact
question — a full-width `<button>` resting on `--color-surface` and hovering to
`--color-surface-container` — so that value is taken rather than picked fresh: one ladder rung, and still
a visible step over the now-unfilled resting background.

**What the ticket held, and how each survives untouched:** the pending row's 50% dimming
(`.tool-row { opacity: 0.5 }` / `.tool-row--resolved`, neither edited) and its `<div>` fork (TSX, not
edited); the error border (`.tool-row--error .tool-row__chip`, not edited, still outspecifying the base
rule at (0,2,0) against (0,1,0) — `.tool-row__chip--toggle` still declares no `border` in any form, which
is the one thing that would silently kill the error accent on every failed row if it ever did); the
headline's single-line ellipsis (`min-width: 0` + `overflow: hidden` + `text-overflow: ellipsis` +
`white-space: nowrap`, all unchanged — a wider box gives an untrusted string more room, it does not make
the geometric bound optional, and `nowrap` still collapses an embedded newline to a space so it cannot
break the row).

Code review: PASS, four non-blocking NITs. Two are worth carrying forward rather than re-discovering: the
new border's contrast against the surface fill, `--color-primary-container` on `--color-surface`, computes
to roughly 1.97:1 — under WCAG 1.4.11's 3:1 for a UI-component boundary. Not gating (the design binds the
value, the outgoing pairing was comparably low, and `.code-block`'s "decorative chrome, not a state-bearing
graphic" ruling from #721 already covers the identical case) — but this box goes from decorative to
interactive once resolved, unlike `.code-block`, so it was flagged for whoever adds the chevron. [#854](#tool-row-header-groups-854)
shipped the chevron without touching the border; the contrast question is still open.
The other: `.conversation__workspace-chip-pill`'s comment (`:159`, outside the edited region) still cites
"the `.tool-row__chip` idiom (inline-flex, `--space-2` gap, `--space-2`/`--space-3` padding,
max-width/min-width/overflow…)" — that idiom moved under this ticket (`--space-3` gap, `width: 100%`,
`--radius-xs`) and the chip is no longer a pill at all. Nothing regresses visually, since the two rules
hold independent declarations, but the citation now points at a shape the tool-row region no longer draws.

See PR #846 for the full record; there is no `docs/knowledge/codebase/722.md` — that directory was frozen
2026-08-26, and this section is #722's only home.

## Tool row header groups (#854)

Splits the tool-row chip's two packed runs into the redrawn Figma component's (`155-553`) two frames — a
`.tool-row__left` that fills the header and a `.tool-row__right` that hugs its content — and draws the
first thing to live in the right one: a right-pointing chevron, flush against the header's trailing edge.
Split from #774; #855 (which runs sit in the left group) and #856 (the result count, the right group's
other member) are the sibling slices this one sets up for. Markup-only change to `ToolRow`
(`ConversationScreen.tsx`) plus three additive CSS rules; no new file, no new token, no new export.

**The split, not the chevron, is the point.** `.tool-row__chip` keeps its existing `gap: var(--space-3)`
unedited — the gap's job changes from falling between the two runs to falling between Left and Right,
since the design gives both the same 12px, which is why the split needed no new spacing value.
`.tool-row__left` (`flex: 1 1 auto; min-width: 0; overflow: hidden`, its own `--space-3` gap) restores the
12px between the runs the chip's gap no longer supplies and holds `.tool-row__name`/`.tool-row__summary`
byte-unedited. It reuses the fill/hug idiom `.composer-status__activity` already ships one screen region
away (`flex: 1 1 auto` where Figma says `flex: 1 0 0` — equivalent once `min-width: 0` removes the
automatic minimum and the lone sibling never grows) rather than inventing a second one, and its
`overflow: hidden` is the design's own `overflow-clip`, now load-bearing where it used to be redundant: an
oversized daemon tool name overflowed `.tool-row__name`'s box before too, but the chip's own
`overflow: hidden` clipped it harmlessly; with a chevron now sitting to its right, an unclipped left group
would paint *over* the chevron before the chip-level clip ever ran. `.tool-row__right`
(`flex: 0 0 auto`, its own `--space-3` gap, inert with one child today) hugs so the trailing edge never
moves — without it the roles above invert and an oversized name squeezes the chevron instead of
ellipsizing the headline, the `.composer-status__error` reasoning with the names swapped.

**The right group is gated on `result !== null`** — the same binding that already forks `rowClass`, the
chip's `<button>`/`<div>` fork, and `body` — never a second predicate, never `expanded`. The whole group is
gated, not just the chevron: an always-rendered empty `.tool-row__right` would still take one side of the
chip's 12px gap and drag a pending row's trailing edge away from a resolved row's, which is exactly the "a
resolving row does not shift" property #722 shipped and pinned with three chip-width equalities in
`e2e/tool-row-toggle.spec.ts` — unedited by this ticket, and still green because the pending `<div>`
branch is `result === null` by construction, so it can never reach the group that renders inside the
shared `chipRuns` fragment both branches consume.

**The chevron** is a bare inline `<svg viewBox="0 0 4 8" width="4" height="8" fill="currentColor"
aria-hidden="true">`, the same idiom every chevron in this file already follows
(`.status-row__chevron`, `.composer__actions-icon`) — sized from its own attributes, no wrapper frame, no
extracted shared component (three call sites, three different glyphs). Its path is
`TOOL_ROW_CHEVRON_PATH`, a module-level `const` beside `ToolRow`, not exported (no second caller), the
right-pointing sibling of `ComposerActionsMenu.tsx`'s `CHEVRON_PATH` — same family, same construction,
same slight overflow past its nominal box, reproduced rather than corrected by leaving the `viewBox`
un-padded. Ink is `--color-primary` via `color:` + `currentColor`, an exact match to the Figma export
(`#9DCBFC`) — unlike `ComposerActionsMenu`'s export there is nothing to correct. **It points right and
does not turn.** Figma draws the collapsed state only (the Body frame is hidden in `155:553`), and
`ComposerActionsMenu.tsx:47-52` already declined a rotating chevron once for the same reason: `aria-expanded`
plus the body appearing below already carry the open state, so a turning glyph would be design invented
here rather than implemented. If one is ever wanted it's a one-rule follow-up keyed on the
`.tool-row--expanded` class that already ships — not read from `expanded` inside `ToolRow`. The chevron is
purely decorative: no `aria-label`, no `<title>`, no `role="img"`, no `aria-controls`/`id` pair — the
SAFETY block's existing clauses (`ConversationScreen.tsx:704-781`) apply verbatim since this adds one
element into the same chip and no untrusted string (the path is a client-owned constant, the two runs are
unedited) — so the resolved chip's accessible name stays exactly its two text runs (WCAG 2.5.3).

**Both groups are `<span>`, never `<div>`.** A resolved chip is a real `<button>`, which admits phrasing
content only; a `<div>` inside it is invalid HTML and a React DOM-nesting warning. `<svg>` is phrasing
content and is fine. Layout comes from `display: flex` in the CSS, not from the element choice.

**Tests.** Two byte-level assertions in `ConversationScreen.test.tsx` were updated in place (not
loosened) to expect the new wrapper spans and the chevron as the right group's last child; new cases pin
that a pending row draws neither `.tool-row__right` nor `.tool-row__chevron` nor a gap where either would
be, that the chevron carries `aria-hidden="true"` and nothing else exposes an accessible name, that an
error row still draws the chevron (it follows the body, never the outcome), and that an expanded row's
header markup is byte-identical to the collapsed row's (no rotation class, no `--expanded` variant). A new
sibling `test(...)` in `e2e/tool-row-toggle.spec.ts` (its own `launchPairedApp`, since a second row on the
page would make the existing bare `.tool-row` locators ambiguous) covers what `renderToStaticMarkup`
cannot see: the trailing edge sits flush against the chip's padding edge, a very long single-line headline
still ellipsises without pushing the group off it, chip height is unchanged from the pending measurement
(no second line), and the 12px gap between the two runs survived being re-homed from the chip onto
`.tool-row__left`.

**What this does not touch:** which runs sit in `.tool-row__left` (`toolHeadline.ts`/`shortenPath.ts`,
\#855's), the count node (`155:557`, #856's — the right group's first child, inserted *before* the
chevron), the expanded body (`.tool-row__body`, #706's field list, #780's command block,
`.tool-row__result`), and the chip's own width mechanic + #722's three e2e width equalities.

See commit `2c90c01` for the full record; there is no `docs/knowledge/codebase/854.md` — that directory
was frozen 2026-08-26, and this section is #854's only home.

## Tool row header run routing (#855)

Makes #854's Left group's two runs (`.tool-row__name` the lead, `.tool-row__summary` the subject)
independently switchable per call, instead of always both — the change that turns a thread of shell
calls from a wall of identical `Bash` chips into a scannable column. One row, two parts, either can be
off; never two row styles. `toolHeadline.ts` and `ConversationScreen.tsx` only; no new file, no CSS
change beyond one declaration (below), no new token.

**The routing, as three cases.** A `Bash` call carrying a `description` draws it in the subject with
**no lead at all** — the subject starts at the header's hard left, since `.tool-row__left`'s `gap`
only falls *between* children. A `Bash` call carrying a `command` but no `description` draws the raw
command in the lead — `.tool-row__name` verbatim, no modifier class — with **no subject at all**.
Every other call, including a `Bash` call whose input map is absent or carries neither field, keeps
today's shape unchanged: the tool name in the lead, `toolHeadline(item)`'s picked text in the subject.
That third case is not re-derived, it **is** the pre-#855 expression — `toolHeadlineRuns`'s fallback
arm literally returns `{ lead: source.name, subject: toolHeadline(source) }` — which is what makes "a
path tool, a search, a long-tail MCP call all render exactly as they did before" structural rather than
a third branch that could drift.

**Keyed on the TOOL, checked before the field.** `toolHeadlineRuns` first tests
`source.name === BASH_TOOL_NAME`, and only inside that branch probes which of `description`/`command`
the picker's rule 1 landed on. A router keyed on the picked *key* alone would have been wrong: measured
over the same 2026-08-24 corpus, subagent launches carry `description` on all 208 calls and task
creation on 97.5% of 121, and `description` sits last in `PREFERRED_FIELDS` — so a key-only rule would
silently strip the tool name off every one of those rows too. `===`, never `startsWith`: `BashOutput`
is a real tool name that carries its own `command` field and must keep the general treatment, the same
ruling `toolBody.ts`'s `isShellCall` (#780) already recorded for the identical reason.

**`toolHeadline` itself is untouched.** Its four-rule chain, `PREFERRED_FIELDS`, `PATH_FIELDS` and the
shortening decision are byte-identical, and its 299-line test file needed only an import-line edit —
that's the evidence AC4 rests on ("the picker's Bash-first rule and preferred-field order are
unchanged"). `toolHeadlineRuns` calls `toolHeadline` for the fallback case rather than reimplementing
rule 1, and re-probes with the same module-private `firstNonEmpty`/`BASH_FIELDS` a shell call already
failed — deliberate redundancy, not an oversight, since exporting `pick` and branching on its key would
let a future edit change rule 1's probe without changing the router's. `BASH_FIELDS` is now built from
two named constants (`BASH_DESCRIPTION_FIELD`, `BASH_COMMAND_FIELD`) rather than repeating the two
strings, so a third field added there without a matching switch clause fails loud rather than routing
silently to the lead.

**`ToolHeadlineRuns` is two independent nullable fields, not a discriminated union** — `{ lead: string |
null; subject: string | null }`. The three reachable shapes are the *product* of two independent
presence facts and `ToolRow` reads them independently, so CLAUDE.md's sealed-union convention (scoped to
daemon events and user actions crossing a boundary) doesn't reach a screen-local helper's return.
`null` means draw no element; `''` still means draw the element with no text — the pre-existing shape
for a call whose `inputSummary` is empty. `ToolRow` tests `!== null`, never a bare `&&`, for exactly
that reason: a truthiness test would silently drop the subject on that call too. Both switches live in
the shared `chipRuns` fragment `ToolRow`'s `<button>`/`<div>` fork both consume, so a still-running
(pending) shell call routes identically to a resolved one.

**The stale `BASH_FIELDS` figure is corrected in place.** The doc comment used to cite 1397 of 6459
`Bash` calls (22%) with no `description`; it now cites the 2026-08-24 measurement — 93227 calls across
4988 sessions, shell 62.4% of them, 6538 of 58199 shell calls (11.2%) with no `description` — matching
the figure `toolBody.ts` already carried. The comment's *argument* changed along with the number: the
fallback used to read as "keeps the row from going blank on a quarter of shell calls"; since #855 it's
stronger than that — on those 6538 calls the command is the row's **entire** visible content, not a
substitute for a headline.

**One CSS declaration, where the spec predicted zero.** `min-height: var(--text-body-medium-line)` on
`.tool-row__left`. Before #855 every row drew the subject, whose 20px line box set the header's height
unconditionally; an undescribed shell call now draws the mono lead alone, whose leading is 16px, so
without a floor that row rendered 4px shorter than its neighbours — the ragged-heights failure #854's
two groups exist to prevent, caught by the new e2e test before the rule was added. Stated as the *left
group's* floor rather than a height on the chip or a modifier on the lead, so it stays true for #856's
count node too. **The design and the shipped box differ by 2px and that's expected, not a bug**: Figma
draws every collapsed row at 36px, but the shipped row computes to 38px once `.tool-row__chip`'s
`--space-2` padding and 1px border are added on both sides — the file's own ±2px convention, not a
miss on the `min-height` value.

**Lesson for the next conditional-run ticket (#856's count node included): switching a run off can
silently change a row's height, not just its content.** A flex row's height tracks its tallest child's
line box; removing the run with the larger leading (body-medium's 20px) shrinks the row to the
survivor's (mono's 16px) unless something floors it. Neither the `renderToStaticMarkup` unit tier nor a
plain element-count assertion can see this — only geometry, so only e2e catches it.

**Tests.** A new `describe` block in `toolHeadline.test.ts` (10 cases) covers the description-wins,
command-only, empty-description-falls-through, absent-input-map, empty-input-map, neither-field,
`BashOutput`-keeps-general-treatment, non-shell-tool-with-description, path-tool and search/long-tail
shapes, plus a structural pair test that `toolHeadlineRuns` never returns both runs `null` and that its
`subject` equals `toolHeadline(source)` on every non-shell source. `ConversationScreen.test.tsx` gained
6 markup cases (no-lead-element, no-subject-element, both-reach-the-pending-row, absent-input-map is
today's shape, every-other-call byte-identical, the escaping posture on the new lead run) and one
existing assertion was **updated, not loosened** — #780's headline-repeat case (`:920`'s occurrence
count) now finds `CMD_SENTINEL_zzz` in the lead plus the code block, not the subject plus the block. A
new sibling `test(...)` in `e2e/tool-row-toggle.spec.ts` pins the subject's hard-left start (content-box
edge, not hardcoded), the lead's computed font/color/size/line-height matching a path row's lead
comparatively (never literal token values), and the height-parity fact above.

**What this does not touch:** `toolHeadline`'s rules (above); #780's shell command block and #706's
field list, both keyed on `BASH_TOOL_NAME` independently of where the headline lands, so neither moves
in either direction; #722's width mechanic and its three e2e width equalities; #854's chevron and right
group; the pending row's 50% dimming and the error row's border, neither drawn by the Figma source and
neither an instruction to drop.

See commit `b404285` for the full record; there is no `docs/knowledge/codebase/855.md` — that directory
was frozen 2026-08-26, and this section is #855's only home.
