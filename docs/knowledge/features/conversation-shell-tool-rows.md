# Conversation shell — tool rows

How a tool call is painted from the moment it appears to the moment its result can be read: the pending and resolved rows, the expandable result, the collapsed headline and the input field list.

Part of [Conversation shell](conversation-shell.md); see that document for what the screen does, its edge cases and its links.

## Pending tool-call row (#218)

The render half of the `toolCall` `ThreadItem` (the transport half, [#217](../codebase/217.md), decodes
the daemon's `tool_use` stream into the item; this ticket only teaches `TimelineRow` to draw it).
Split from #205 alongside #217, mirroring the transport/render split every #199-family slice has taken.

`TimelineRow`'s `case 'toolCall'` (previously `return null`) now renders a compact bordered chip —
Figma node `16:28` — left-aligned in the thread, in the reducer's arrival order beside the
`assistantText` bubbles:

```html
<div class="tool-row">
  <div class="tool-row__chip" data-thread-role="tool">
    <span class="tool-row__name">{item.name}</span>
    <span class="tool-row__summary">{item.inputSummary}</span>
  </div>
</div>
```

(The second run's text source changed under [#705](#collapsed-tool-row-headline-705) — see below; the
element, classes and escaping posture described here are unchanged.)

`name` and `inputSummary` — the daemon's untrusted `tool_use` précis, flagged for plain-text-only
rendering back at the #217 decode boundary — are React children (auto-escaped), never
`dangerouslySetInnerHTML`, the identical posture to the `assistantText` arm one case up.
`data-thread-role="tool"` (not `"assistant"`) is the render's own test hook and deliberately keeps
`threadBubbleCount` (which matches only `"assistant"`) at 0 for tool rows — a tool row is not a
message bubble. `Timeline`'s array-index key strategy is untouched; `toolUseId` stays on the item,
unread here, reserved for [#206](https://github.com/pyrycode/pyrycode-desktop/issues/206)'s result
correlation.

This is the **pending** (`result: null`, no `denial`) treatment only — the whole `.tool-row`
sits at 50% opacity,
the unresolved-state dimming. #206 (later split into transport #229 + render #230) fills `result` and
owns lifting (or overriding) that dimming plus the success/error visual; this ticket's chip styling
stays untouched by that follow-up. Every value in the three new `.tool-row*` CSS rules is a token
(`--font-mono`, `--color-tertiary`, `--color-surface-container`, `--color-outline-variant`,
`--color-on-surface-variant`, `--text-body-small-*`, `--space-2`/`--space-3`, `--radius-sm`) — no
hex/rgb/px literal. Was dormant until [#179](../codebase/179.md) flipped `interactive` (no `tool_use`
frames arrived while it was off, the same posture as `Timeline`/`ThinkingIndicator`); now live. See
[#218 codebase notes](../codebase/218.md) for the full design and patterns established.

## Resolved tool-call row (#230)

The render half of the `toolResult`-fills-`toolCall` correlation (the transport half,
[#229](../codebase/229.md), decodes the daemon's `tool_result` stream and resolves the item's
`result` in place via `fillResult`, #121; this ticket only teaches `TimelineRow` to draw the filled
state). Split from #206 alongside #229, the vertical's **last** render slice — extends #218's pending
chip rather than adding a new component.

`TimelineRow`'s `case 'toolCall'` now reads `item.result` (`ToolResult | null`) and derives the
wrapper `className`; the chip's inner markup — the two spans — is **byte-identical** to #218:

```html
<!-- result === null (unchanged) -->
<div class="tool-row"> … </div>

<!-- result filled, isError: false -->
<div class="tool-row tool-row--resolved"> … </div>

<!-- result filled, isError: true -->
<div class="tool-row tool-row--resolved tool-row--error"> … </div>
```

`tool-row--resolved` lifts the pending 50% dimming (`opacity: 1`) for **both** outcomes — the
resolved-success treatment is exactly the mock's chip with the dimming lifted, no accent added.
`tool-row--error` layers on top only when `result.isError` and no explicit denial is attached,
retinting `.tool-row__chip`'s border from
the neutral `--color-outline-variant` to a new token, `--color-error` (`#ffb4ab` — M3 default dark
error role, tone 80; desktop's **first** error-family token, mirrored from the same M3 scheme
`tokens.css`'s header names as the palette's source, since no Figma node in this file references an
error scheme to copy from directly). `result.resultSummary` is **deliberately not rendered** — the
Figma mock has no result-text slot, and not-surfacing it (rather than surfacing-then-escaping) keeps
the untrusted-text surface at exactly `name` + `inputSummary`, unchanged from #218. `Timeline`'s
array-index key strategy is untouched: `fillResult` replaces the `toolCall` at its own index, so a
resolving row never remounts.

Was dormant until [#179](../codebase/179.md) flipped `interactive`, the same posture as every other
structured-stream render slice; now live. See [#230 codebase notes](../codebase/230.md) for the full
design, the token-provenance rationale, and patterns established.

## Expandable tool-call result (#696, toggle #697)

\#230 shipped resolved/error chip styling but deliberately did not surface `result.resultSummary` — no
result-text slot existed in the Figma mock. #696 reversed that: `ToolRow` was extracted out of
`TimelineRow`'s `toolCall` arm (`case 'toolCall': return <ToolRow item={item} />`, both signatures
otherwise untouched) and gained a body, a sibling of the chip rather than a child. At the time that was
because the chip was a single-line `inline-flex; overflow: hidden` pill — nesting a stacked body inside it
would have forced a new wrapper and broken the collapsed markup. That specific reason didn't survive
[#722](conversation-shell-tool-row-box.md#full-width-bordered-tool-row-722), which turned the chip into
a full-width bordered box, and it left the body's border closing *above* the content it should have
contained until [#1102](conversation-shell-tool-row-body.md#tool-row-box-moves-outward-1102) moved that
box treatment onto `.tool-row` itself. The sibling relationship never needed a different reason to hold:
the chip is a `<button>`, and a `<pre>` is not phrasing content, so nesting was never available in any of
the three designs.

```html
<div class="tool-row tool-row--resolved tool-row--expanded">
  <button type="button" class="tool-row__chip tool-row__chip--toggle" data-thread-role="tool"
          aria-expanded="true">
    <span class="tool-row__name">{item.name}</span>
    <span class="tool-row__summary">{item.inputSummary}</span>
  </button>
  <pre class="tool-row__result">{result.resultSummary}</pre>
</div>
```

(As above, the second run's text source is [#705](#collapsed-tool-row-headline-705)'s picker, not raw
`inputSummary`, as of that ticket.)

`expandable = result !== null || denial !== undefined` gates the disclosure button and
chevron; `expanded && expandable` gates the body and `tool-row--expanded` modifier.
A call with neither result nor denial cannot expand, even with `defaultExpanded`.
The result text's only sink is `<pre>` text children (`white-space: pre`, so
daemon-emitted newlines survive — the machine-output side of the same reflow-vs-preserve rule
`.unrecognized-row__raw` established), bounded to `max-height: 240px` + `overflow: auto` (that literal
copied from `.unrecognized-row__raw`, the file's only other `overflow: auto` result body — **neither has
a `tabindex`**, a known pre-existing gap in both, not yet fixed). An empty result
(`resultSummary === ''`, exact) renders the client-owned `TOOL_RESULT_EMPTY_COPY` ("No output") instead
of a blank gap; an error result without a denial gets its own `tool-row__body--error`
modifier on the body container,
independent of the pre-existing `tool-row--error` on the chip's wrapper.

The disclosure owns component-local `useState(defaultExpanded)`; the prop sets only
its mount-time initial value. A result or an explicit denial makes the header a real
`<button aria-expanded>`; a call awaiting both keeps its non-interactive `<div>`.
Static rendering can exercise the initial open state, but only Playwright can prove
that clicking toggles it.

**Where the boolean lives is the interesting design call**, and it's the same shape
the repo's other expand/collapse row, `UnrecognizedRow`, has shipped with since it landed —
component-local `useState`, not a hoisted `toolUseId`-keyed set on the screen container,
per [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)'s "lowest scope that
resets correctly." It resets for free rather than by explicit teardown: `Timeline`'s array-index key
strategy plus `fillResult`'s in-place `items.map` replacement (never insert, never reorder — [ADR
0008](../decisions/0008-thread-timeline-model.md)) keep a row's component instance — and its boolean —
bound to one logical tool call across its whole pending → resolved life, and a thread `reset` empties
`items` to `[]`, unmounting every row (including across the in-thread `conversation_created` reset path
that leaves the screen mounted, `activateConversation.ts:93`). No row can inherit another's expansion,
and none survives a reset, with nothing to clear explicitly.

One additive CSS rule, `.tool-row__chip--toggle` (appended after `.tool-row__chip`, which is not
edited), supplies only what a UA `<button>` would otherwise inject or override — `font-family:
var(--font-sans)` (load-bearing: `.tool-row__summary` inherits it from `.conversation` and a bare
`<button>` would silently re-parent that to the UA font), `color`, `text-align: left`, `box-sizing:
content-box` (a UA button defaults to border-box; holding content-box keeps both chip branches bounded
identically so a resolving row doesn't shift width), `cursor: pointer` and a hover tint lifted from
`.unrecognized-row__summary`. Deliberately silent on `border`, so `.tool-row--error .tool-row__chip`'s
higher-specificity border retint keeps winning on failed rows.

**Security posture (both tickets).** `name`, `inputSummary`, `toolUseId` and `resultSummary` are all
daemon-supplied and untrusted; the only sanctioned sink is React text children, never
`dangerouslySetInnerHTML`, never `AssistantMarkdown` (which would let a daemon-relayed result emit an
`<img src>` beacon from a privileged renderer), never an attribute, a log line, or a lookup key. #697's
control makes this posture load-bearing rather than belt-and-braces — it is the first ticket that makes
the result text reachable in the shipped product — and declines five specific attribute/log sinks a
disclosure control invites (`aria-label`, `aria-controls`/`id`, `title`, a toggle diagnostic, and
enriching the body through markdown); see the `SAFETY` comment block in `ConversationScreen.tsx` and
[#697 codebase notes](../codebase/697.md) for the full walk.

See [#696 codebase notes](../codebase/696.md) and [#697 codebase notes](../codebase/697.md) for the full
design, testing strategy, and patterns established.

## Permission-denied tool-call row

An explicit [timeline denial](thread-timeline.md#permission-denial-correlation) immediately
adds a literal **Denied** header tag and makes the row expandable, even before a result
arrives. `tool-row--denied` takes precedence over error styling on both wrapper and body;
the name, subject, tag and attribution use muted `--color-on-surface-variant` ink.
Ordinary successes and errors without a denial keep their existing presentation.
The header/body layout stays intact; this report adds no allow/retry action or policy change.

The expanded body places attribution above the result text, using exact source tokens:

| `decisionReasonType` | Attribution |
| --- | --- |
| `classifier` | Denied by the auto classifier |
| `rule` | Denied by a permission rule |
| `mode` | Denied by the permission mode |
| `asyncAgent` | Denied by an async agent |
| Empty or unknown | Denied by the permission gate |

Append `: <reason>` only when the original reason is nonempty. Never display an unknown
source token as attribution. While waiting for a result, the result block shows the
marker's rejection message; an arriving actual result replaces that provisional text,
while attribution remains. An empty displayed result uses the existing “No output” copy.
Report arrays are retained in state without becoming attribution or visible report labels.

`denialDisplayText` strips terminal escape sequences and non-layout control characters,
then takes at most 4096 JavaScript string units per field. Reason, provisional message,
and **actual result summary in a denied row** all take this path and render as escaped
React text; tabs and line breaks survive. Sanitizing only the provisional message leaves
the later result branch unbounded. The full actual result remains in state; ordinary
result rendering is unchanged. No denial prose enters HTML, attributes, URLs or logs.

`openToolName` immediately skips denied calls: another pending tool can still name the
working label, otherwise a responding turn shows “Working…”. Denial does not finish the
turn or alter the indicator's phase/priority rules. See [turn status](conversation-shell-turn-status.md).

The tag needs the complete body-medium typography quartet, even though the disclosure
button sets a font family: the browser otherwise supplies default button sizing.
`e2e/tool-denied.spec.ts` asserts computed 14px size, 20px line-height, 0.25px tracking
and 400 weight, alongside real IPC delivery, clicks and positive Running Bash → Running
Read → Working transitions. Static denial tests cover attribution, ordering and sanitized
text, but cannot prove typography or interaction. See the
[implementation spec](../../specs/architecture/1238-tool-denial.md).

## Collapsed tool-row headline (#705)

`inputSummary` was never designed as a headline — it's the daemon's whole tool input squeezed onto one
line and cut for length, so for an `Edit` that is mostly replacement text the file path was usually
truncated away entirely. #705 replaces the chip's second run with a headline picked from the tool's own
input fields (`item.input?: Readonly<Record<string, string>>`, carried onto the item since #642/#643),
falling back to `inputSummary` when nothing in `input` qualifies. No markup, class or CSS changed — only
the text of `.tool-row__summary`, in both the pending `<div>` and the resolved `<button>` (both read the
same `chipRuns` fragment, declared once in `ConversationScreen.tsx`), so this section supersedes the
`{item.inputSummary}` shown above wherever the second run's *content* is concerned.

`toolHeadline(source)` (`src/renderer/src/screens/conversation/toolHeadline.ts`) is one fallback chain,
deliberately dumb — the expanded body ([#696/#697](#expandable-tool-call-result-696-toggle-697), and
[#706's per-field list](#full-input-field-list-706)) is one click away, so a wrong guess costs almost
nothing, which is the argument against a smarter classifier here:

1. `name === 'Bash'` exactly → `description`, else `command`. The fallback is load-bearing: measured
   over 6459 real `Bash` calls, 1397 (22%) carry no `description` at all.
2. Otherwise the first present, non-empty match in a fixed order: `file_path`, `path`, `notebook_path`,
   `command`, `pattern`, `url`, `query`, `description`.
3. Otherwise the first non-empty entry of `input`, in iteration order, whose value contains no line
   break — this is what makes MCP tools work, since their input names (`symbol`, `fileKey`, `nodeId`, …)
   mostly aren't on any fixed list.
4. Otherwise `inputSummary`, exactly as before #705.

Rule 1 is a precedence *override* for one tool name, not a terminal branch — when it selects nothing the
chain falls through into rule 2, which is what makes "never blank" structural. Every rung requires a
value that is present and `!== ''` (never `.trim() !== ''` — a real but unobserved residual, left
unguarded per the ticket's own "don't improve the picker without new data" instruction). `input` absent
and `input: {}` read identically: rules 1–3 have nothing to look at either way, so both fall through to
rule 4 — the distinction between "pre-#642 daemon" and "daemon sent no fields" survives at the item but
is not surfaced in the row.

**Shortening is keyed on the field name the value came from, not on which rule fired.** [#644](../codebase/644.md)'s
`shortenPath` runs only when the key is `file_path`, `path` or `notebook_path`; a `Bash` command line, a
`pattern`, a `url`, a `query`, a `description` and a rule-3 catch-all all render unshortened — shortening
a command line or a search pattern would mangle it into something that reads like a path and is not one.
`shortenPath` itself stays a total function of one string that never decides *whether* its argument is a
path; #705 is its first caller, and the doc comment it shipped with (describing a `kind`/`subject` shape
that never made it onto the wire) was corrected in the same PR, comment-only.

**Security posture**, extending #697's SAFETY block rather than restating it: the headline reaches the
DOM only as auto-escaped React children of the same `.tool-row__summary` span that carried `inputSummary`
before it — never `title=` (a natural next edit once shortening visibly discards information, and
forbidden by CLAUDE.md's 2026-08-20 ruling), never linkified through `AssistantMarkdown` (rule 2 can
promote a field literally named `url` into the render path), and the picked *value* only — never the
input *key*, which is daemon-controlled display text too and drawing it is #706's separately reviewed
call. No log line names the picked field or its value (ADR 0007's content-free rule).

Wire facts this rests on ([#642](../codebase/642.md)'s spec, not the daemon ticket):
key order on the wire is alphabetical (a Go map-marshalling artefact, so rule 3's order is deterministic
per call); every value is already a string daemon-side, so `null`/`true`/`[1,2]` can arrive as those
literal strings and rule 3 can land on one (an accepted miss — #706's field list covers the rest); the
map may be incomplete (the daemon's 8500-rune total bound drops fields and names none), which is why rule
4 keeps `inputSummary` as the whole-input fallback rather than retiring it; and a daemon-truncated value
ends in `…` and renders that way.

See [#705 codebase notes](../codebase/705.md) for the full design, the `noUncheckedIndexedAccess` trap
(off in `tsconfig.web.json`, so `input[key]` types `string` while being `undefined` at runtime for an
absent key), and patterns established.

## Full input field list (#706)

The headline (#705) picks one field; this ticket lists all of them, literally, in the expanded body
([#696/#697](#expandable-tool-call-result-696-toggle-697)) — the form that covers the headline's misses.
Every entry of `item.input`, name above value, in arrival order, above the unchanged result block:

```html
<div class="tool-row__body">
  <div class="tool-row__input">
    <span class="tool-row__input-name">{name}</span>
    <pre class="tool-row__input-value">{value}</pre>
  </div>
  <!-- … one per entry … -->
  <pre class="tool-row__result">{result.resultSummary}</pre>
</div>
```

`listedInputFields(item)` — since [#780](conversation-shell-tool-row-code-block.md#shell-command-code-block-780) moved the entries call out of the
render tree and into `toolBody.ts` — is `Object.entries(item.input ?? NO_INPUT_FIELDS)`, filtered for a
`Bash` call only (below). No `.sort()`, no path shortening, no salience pick, and — for every tool but
`Bash` — no skipping the field #705's headline already promoted: literal is the whole point, since a field
silently missing from a "full input" list is worse than one repeated in both places. `NO_INPUT_FIELDS` is
a named `Readonly<Record<string, string>> = {}` module constant (now declared in `toolBody.ts`, moved with
the entries call it exists for), not a bare `{}` literal at the call site: the bare form widens the union
`Object.entries` sees and silently resolves it to the `any`-valued overload (neither
`noUncheckedIndexedAccess` nor `exactOptionalPropertyTypes` is on in this repo, so nothing else catches it).

**No list-wrapper element, no `.length > 0` guard.** The per-field `<div class="tool-row__input">`s are
direct children of the body; zero entries renders nothing. This is what makes "an absent, empty, or (since
\#780) fully carved-out `input` all render no field list and no empty container" structural rather than a
second condition that could drift from the render — #643's absent-vs-`{}` distinction survives only at the
item, and the *display* decision that all three draw nothing is made once, in `listedInputFields`.

**One carve-out, added by #780, that does not weaken the rule above.** A `Bash` call's list drops
`description` and `command` — see [Shell command code block (#780)](conversation-shell-tool-row-code-block.md#shell-command-code-block-780) for why
that is "promoted elsewhere in the body," not "silently missing from it," and why the carve-out is keyed
on the tool name and not on which field the headline happened to pick.

**The value is a `<pre>`** (line breaks preserved, the `.tool-row__result` newline-handling precedent);
**the name is a `<span>`**, mono but `--color-on-surface-variant` — the muted label colour
`.tool-row__summary`/`.tool-row__empty` use, not `--color-tertiary` (reserved for the tool's own
identity) — with `word-break: break-word` stated explicitly, since `.tool-row` is not a `.bubble`
descendant and a field name (no spaces, unlike a value) would otherwise widen the row unbounded. CSS-wise,
`.tool-row__input-value` **joins** the existing `.tool-row__result` selector rather than copying its ten
declarations, so "the field list takes the result block's visual language rather than inventing a third"
(the same answer #696 gave to the same "no expanded-state Figma frame" gap) is a fact by construction. The
failed-tool accent (`.tool-row__body--error .tool-row__result`, a descendant selector naming
`.tool-row__result` alone) gains nothing from that join — the field list stays untinted on a failed tool,
deliberately: a failed tool's *input* is not itself an error.

**Security posture**, extending #697's SAFETY block a second time: unlike #705, this ticket *does* draw
the input **key**, for the first time — a name is exactly as daemon-controlled as the value beside it (an
MCP tool can name a field anything), so both reach the DOM only as auto-escaped React children, never
`AssistantMarkdown`, never `title=`, never a linkified `url` field, never a log line. `key={name}` on the
wrapping `<div>` is a React reconciliation identity, never serialised to the DOM and not a new exposure —
the same string is already rendered as a visible text child beside it.

See [#706 codebase notes](../codebase/706.md) for the full design, the `Object.entries`-on-a-union
TypeScript trap, the arrival-order test lesson, and patterns established.
