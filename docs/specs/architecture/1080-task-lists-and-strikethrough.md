# #1080 — task lists and strikethrough render as elements, not literal text

## Files read

Codegraph is not initialized in this repo (`codegraph_context` fails hard rather than returning empty),
so this list was built with Grep and Read. Noted as the gap the brief asks to record, not as a choice.

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → `remarkGfmSubset`, `remarkPlugins`,
  `components`, `allowedLinkHref`, `AssistantMarkdown` — the whole subject. The header comment is the
  security contract this ticket edits in four places.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx` → the case titled *"installs the
  table construct only — no strikethrough, task list or footnote"* — the guard this ticket inverts
  (AC5), and the `render` / `lines` helpers every new case reuses.
- `node_modules/mdast-util-to-hast/lib/handlers/list-item.js` → the `listItem` handler — read rather
  than assumed, per the ticket. Confirms the emitted shape exactly: `className: ['task-list-item']` on
  the `<li>`; an `<input>` with `{type: 'checkbox', checked: <boolean>, disabled: true}` unshifted into
  the item's first `<p>`, with a `' '` text node after it **only when that paragraph already had
  children**. A tight list then unwraps the paragraph, a loose list keeps it.
- `node_modules/react-markdown/lib/index.d.ts` → `Components` — `{[K in keyof JSX.IntrinsicElements]?:
  ComponentType<JSX.IntrinsicElements[K] & ExtraProps> | keyof JSX.IntrinsicElements}`. So an `input`
  key is type-checked and its `checked` prop arrives as `boolean | undefined`; no cast is needed.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble__markdown`, the
  `> *` margin reset, `.bubble__markdown ul`/`ol`, the `li > *` / `li > * + *` / `li + li` rhythm pair,
  `.bubble__markdown table` and `th`/`td` — the per-element shape AC4 names, and the source of the
  "restating an inherited value is how it gets lost" argument this plan follows twice.
- `src/renderer/src/screens/conversation/conversation.css` → `.question-panel__control`,
  `.question-panel__control--checkbox`, `.question-panel__control-tick`, `.question-panel__input` —
  the drawn precedent the ticket points at, and the *inverse* posture (a visually-hidden real `<input>`
  kept deliberately in the tab order). Geometry borrowed; posture explicitly not.
- `src/renderer/src/screens/conversation/QuestionPanel.tsx` → `QuestionTick` — module-private, with
  "promote on the second call site" in its own docstring. This ticket is that second site and declines
  it; see § Design.
- `src/renderer/src/theme/tokens.css` → `--color-on-surface-variant`, `--color-outline`, `--space-*`,
  `--radius-xs` — the token set the treatment is drawn from.
- `e2e/assistant-whitespace.spec.ts` → `SETTLED_TEXTS`, `REPLY_TEXTS`, the index constants,
  `buildReplyFrames`, `streamTheReplies`, `readThreadWidths` — the fixture this ticket appends one reply
  to. Every count in it is derived (`toHaveCount(REPLY_TEXTS.length)`) and every bubble is addressed by
  a named index, which is what makes appending safe; #1079 appended `TABLE_TEXT` the same way.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly` — why whole-bubble text assertions here are
  anchored regexes, and therefore what a new text-bearing child inside `.bubble` would cost.
- `docs/knowledge/features/assistant-markdown-renderer.md` — the package overview: the no-`remark-gfm`
  decision and its reasoning, which this ticket extends rather than reverses.
- `CLAUDE.md` § Conventions — the 2026-08-20 operator ruling on daemon text, and the renderer-test tier
  constraint that makes "not interactive" a structural claim in vitest and a behavioural one in e2e.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-43

Node 16:43 is the settled assistant bubble: a rounded surface holding a flex column, 8px gap, of a
body-medium paragraph, a bordered code block with its `typescript` header bar (16:45/16:46/16:47), and a
second paragraph. Its treatment is already fully transcribed into `.bubble__markdown` and `.code-block`,
each rule citing its own node.

**N/A for the two constructs themselves.** The node draws neither a task list nor struck text —
confirmed by reading it, not inherited from the ticket: its `get_design_context` output contains exactly
the three children above. Their treatment is therefore a judgement call inside the existing token set,
which is the established situation for this container: `conversation.css`'s anchor rule records the same
for links ("Figma 16:43 contains no anchor") and #1079's table rule did it again. This plan follows that
precedent and states each derivation beside its declaration.

For the checked/unchecked mark there **is** a drawn precedent in a different construct — the question
panel's checkbox, Figma 347:6211, at `.question-panel__control--checkbox`. Its geometry is borrowed and
its posture is deliberately not; see § Design.

*Recorded honestly:* `get_screenshot` on 16:43 returned a degenerate 1×1 PNG on 2026-09-05 at both the
default and an explicit `maxDimension`, twice. The visual reading above is from `get_design_context`'s
structured output plus the already-shipped CSS for the same node, not from a raster render.

## Context

`remark-gfm` is a bundle of five extensions. #608 declined it so that **autolinking is structurally
impossible** — the extension is not in the dependency graph, so there is nothing for `allowedLinkHref`
to suppress. Declining the bundle silently took tables, task lists and strikethrough with it. #1079
established the way out (per-construct packages registered in a local `remarkGfmSubset` plugin) and
shipped the table pair. This ticket registers the remaining two pairs into that same function.

Two things make it more than a two-line edit:

1. The task-list extension puts an `<input type="checkbox">` across a boundary the file's own header
   describes as the entire security boundary for markdown rendering. AC3 forbids inheriting that by
   default. § Design settles it.
2. The file states "one construct and nothing else" in three registers, all of which become false, and
   one of which (`remarkPlugins`' docstring) breaks *silently* because the array stays length-1.

No ADR is warranted: this is #608's decision applied a third time, not a new one.

## Design

### 1. Two extension pairs in `remarkGfmSubset`

Four new direct runtime dependencies, all `micromark`/`syntax-tree` maintainership, all already present
transitively-adjacent in the tree:

```
micromark-extension-gfm-task-list-item@^2.1.0   mdast-util-gfm-task-list-item@^2.0.0
micromark-extension-gfm-strikethrough@^2.1.0    mdast-util-gfm-strikethrough@^2.0.0
```

`remarkGfmSubset` gains two pushes per array, beside the table pair:

- `micromarkExtensions.push(gfmTaskListItem(), gfmStrikethrough())`
- `fromMarkdownExtensions.push(gfmTaskListItemFromMarkdown(), gfmStrikethroughFromMarkdown())`

**All four exports are functions and all four are called.** This is the trap the function's existing
docstring already names from #1079: a function where an extension object is expected is accepted, the
source markers are eaten, and the text loses its syntax while gaining no element — silently, with no
throw. The docstring's "if a *table* ever renders as neither a table nor visible pipes" now covers three
constructs and is reworded to say so.

`micromarkExtensions` is typed `MicromarkExtension[]` via the `remark-parse` augmentation #1079 already
declared, so all four pushes are type-**checked**. No casts, no new type-only devDependency.

`singleTilde` is left at its default (on). The ticket measured the obvious hazard —
`paths ~/config and ~/other are both real` — and it does not reproduce, because GFM requires the closing
run to match and forbids the flanking that a path produces. No observed failure, so no speculative
option; a test pins the non-reproduction so a later maintainer does not have to re-derive it.

### 2. The `<input>` question — settled by overriding it away (AC3)

**Decision: `components.input` renders a non-interactive `<span>`. No `<input>` ever reaches the DOM.**

```tsx
input: ({ checked }) => <span className={…} role="img" aria-label={…} />
```

- Class: `task-mark`, plus `task-mark--checked` when `checked === true`. `=== true`, not a truthy test:
  the handler only ever sets a boolean, and the strict compare denies a later reader the impression that
  a string or a number could arrive here.
- `role="img"` + a client-owned `aria-label` (`Done` / `Not done`) is what keeps the state in the
  accessibility tree. It is deliberately **not** visually-hidden text: an `aria-label` contributes
  nothing to `textContent`, and a text node would land inside `.bubble` — the 17-site whole-text
  assertion hazard the ticket's Technical Notes name. The CSS-drawn mark contributes no text either.
- Bound by the file's never-spread rule: only `checked` is destructured, so `type`, `disabled` and every
  other prop react-markdown supplies are dropped. The override is **total** — with no HTML parser in the
  graph, the task-list handler is the only producer of an `input` node, so this is the whole surface.

Why an override rather than accepting the package's `<input type="checkbox" disabled>`:

- A `disabled` checkbox already satisfies AC1's letter, but it *reads* as clickable and is not. The
  reply is a transcript, not a form.
- The file's posture is that reading it tells you exactly which elements can be emitted. Inheriting a
  form control from a package default is the opposite of that, and AC3 exists to forbid it.
- It removes the question rather than answering it: there is no `disabled` attribute to keep correct, no
  form-association to reason about, and nothing for a future `input`-shaped construct to inherit.

Why **not** reuse `QuestionTick` from `QuestionPanel.tsx`, whose docstring invites promotion on a second
call site: that control is a 20px interactive `--color-tertiary` affordance and this is a 14px inert
muted mark — same geometry family, opposite posture. Promoting it would put a shared component under two
consumers that agree on nothing but the path data, and would add an import indirection to the one file
whose value is that its emitted element set is readable in place. The mark is drawn by CSS instead.

### 3. Treatment (AC4) — four rules in `conversation.css`, in the per-element shape

Each derivation stated beside its declaration, and each restating nothing that already arrives by
inheritance (the argument the anchor, list and table rules in this file already make):

- `.bubble__markdown .task-list-item` — `list-style: none`. GFM's marker suppression, which the
  `task-list-item` class does **not** do on its own here: it is emitted purely as a hook for
  github-markdown-css, which this repo does not ship, so without this rule an item draws both a bullet
  and a mark. The `ul`'s `padding-inline-start` stays, so the item keeps its indent.
- `.bubble__markdown .task-mark` — a 14px box: `box-sizing: border-box`, `display: inline-flex` with
  centred items (the `.question-panel__control` idiom), a 1px `--color-on-surface-variant` border, a 3px
  radius, and a small negative `vertical-align` so it sits on the text's cap band rather than its
  baseline. 14px outer with a 1px border leaves a 12px content box — the question panel's own 12×12 tick
  frame, unchanged; only the ring around it shrinks from that control's 20px to the reply text's own
  14px size. **The colour is the muted `--color-on-surface-variant`, not the control's
  `--color-tertiary`**, and that is the "borrow the geometry, not the posture" line: the accent token is
  what the app uses to say *interactive*.
- `.bubble__markdown .task-mark--checked::after` — the tick, a rotated two-border box in the same muted
  ink. A pseudo-element and not a glyph character: `content: ''` contributes no text content, so no
  bubble-text assertion in either e2e tier can see it. Not an inline SVG either — that would be the
  `QuestionTick` promotion declined above; not a `background-image: url(data:…)`, which `PyryMark.tsx`
  already records as failing closed under this window's `default-src 'self'` CSP with no `img-src`.
- `.bubble__markdown del` — `color: var(--color-on-surface-variant)`. **One declaration, and the
  omission is the decision**: the UA's own `line-through` carries the strike, exactly as the table rule
  leaves `<th>`'s UA `bold` to distinguish the header row rather than restating a weight the scale
  cannot express. The muting is the derivation the design does not supply — struck text reads as removed
  rather than as equal-weight prose — and it comes from the token the file already uses for muted ink.

Both marks sit inside `.bubble__markdown`, whose `li > *` / `li > * + *` rhythm reaches the unwrapped
span in a **tight** list and the surviving `<p>` in a **loose** one. Neither is disturbed: `margin-block`
does not apply to an inline-level box, and the mark is always the item's first child so `+ *` never
selects it.

### 4. The three comment sites, plus a fourth (all in the edit region)

1. Header `• ONE remarkPlugin …` — the sentence extends from "the GFM TABLE construct and nothing else"
   to naming all three. The "bundle of five" framing and the autolink-literals/footnotes absence claim
   are both still true and both stay verbatim.
2. `remarkGfmSubset`'s docstring — "#1079 — registers the GFM table construct … and nothing else"
   becomes the three-construct statement, and the silent-failure paragraph stops naming only tables.
3. `remarkPlugins`' docstring — the subtle one. The array stays length-1, so nothing reddens while the
   claim "one entry, one construct" quietly becomes wrong. It is rewritten to say what it now guards:
   the entry count is no longer the construct count, and `remarkGfmSubset`'s body is the list.
4. `components`' docstring — gains the `input` rule beside the link, image and `pre` rules, stating that
   it exists to keep a form control off the boundary rather than to decorate one.

## State + concurrency model

None. `AssistantMarkdown` is a pure function of `text` with no state, no effects, no store access and no
async work. `remarkPlugins` and `components` stay module constants for prop identity, unchanged. Nothing
here has a lifecycle to cancel.

## Error handling

No new failure mode and no new result type. The two extensions are parser configuration: markdown that
does not match a construct is left as text, which is CommonMark's own behaviour and not an error path.
The `input` override has no null branch to speak of — `checked` is `boolean | undefined` and the
`=== true` test is total over both, with `undefined` rendering the unchecked mark. Nothing is logged:
the values in scope are untrusted daemon text and the repo's diagnostics are content-free (#126).

## Testing strategy

**vitest, `AssistantMarkdown.test.tsx`** (`renderToStaticMarkup`, `environment: 'node'` — no DOM, so
"not interactive" is a **structural** claim here):

- The existing case at *"installs the table construct only…"* is **inverted, not deleted** (AC5): its
  strikethrough and task-list arms become positive assertions, its footnote arm and its "only" claim
  stay true for what remains uninstalled, and its title moves to name the three installed constructs.
- A task list renders distinguishable checked and unchecked marks, and the `<li>` carries
  `task-list-item` — with the marks asserted as a **count of each class**, not as a single whole
  attribute run, so a later shared-treatment lift cannot make the assertion pass vacuously.
- Non-interactivity, structural: no `<input`, no `type="checkbox"`, no `disabled`, no `tabindex`, no
  `<button`, no `contenteditable` anywhere in the render.
- `~~struck~~` renders `<del>` and the tildes are gone; `~single~` too (the `singleTilde` default,
  pinned deliberately); and `paths ~/config and ~/other are both real` renders untouched with no `<del>`
  — the non-reproduction the ticket measured, pinned so it is not re-derived.
- Markup-looking text inside both new constructs survives as React-escaped characters and builds no
  element — the `&lt;` escaped-not-absent discriminator every anti-interpretation case here uses.
- The link and image overrides stay in force inside a task item and inside a `<del>` — keyed on element
  type, not ancestry, proven rather than assumed (the sibling of #1079's in-a-table-cell case).
- Unchanged behaviour, re-asserted where this ticket could plausibly have moved it: a bare URL and a
  bare email still render as plain text with no anchor (already covered at the sibling case), and
  `package.json` gains neither `remark-gfm` nor `rehype-raw`.

**Playwright, `e2e/assistant-whitespace.spec.ts`** (the only tier with a DOM, a stylesheet and layout —
one test, appending one reply to `SETTLED_TEXTS` the way #1079 appended the table):

- The bullet is suppressed: `list-style-type` computes `none` on the task item.
- Checked and unchecked are **visibly** distinct: the checked mark's `::after` computes a real box and
  the unchecked one's computes `content: none`. This is the assertion the static tier cannot make, and
  its own vacuity guard — both marks are read in one call so a render that produced neither fails.
- `del` computes `line-through` and the muted token — the treatment reaching the browser, not just the
  stylesheet.
- AC1's behavioural half: a real click on the mark leaves it unchanged and does not focus it. Only this
  tier can click; the static tier's version of this claim is structural.
- The thread's `scrollWidth <= clientWidth` over-correction guard every sibling assertion here carries.

Appending is safe by construction: the spec's bubble count is `REPLY_TEXTS.length` and every bubble is
addressed by a named index constant, so the new reply shifts `TAIL` by one and nothing else. No existing
bubble gains a child, so the whole-text assertion hazard is not engaged.

## Open questions

1. **Exact tick geometry** — the rotated-border box's width, height and border width inside the 12px
   content box are set by eye in Phase B against the question panel's drawn tick. The plan fixes the
   ring (14px, 1px, 3px radius, muted token); only the glyph's interior arithmetic is open.
2. **Whether `.task-mark` should be scoped to `.bubble__markdown`.** `.code-block` is the precedent for
   an unscoped class emitted by this module. Scoping is planned anyway, because `del` and
   `.task-list-item` must be scoped (an element selector and a package-owned class), and keeping the
   construct's four rules under one scope reads better than splitting them. Recorded as a judgement, and
   revisited only if the specificity interacts badly with the `li > *` rhythm.

Both are resolved in Phase B; anything that changes the contract above lands as a `## Revisions` entry.

## Security review

**Verdict:** PASS

Run because the ticket carries `security-sensitive`. The design under review is § Design above; the
posture inherited from #608/#610/#1079 is not re-litigated except where this ticket moves it.

**Findings:**

**1. Trust boundaries — the boundary moves, and the finding is where it does *not*.**
The boundary is `AssistantMarkdown` itself: daemon text in, React elements out. Two new parsers now run
on that untrusted string, so the question is what attacker-influenced value each can place in the output.

- Task list: the *only* value the source controls is `node.checked`, a **boolean** set by the handler
  (`typeof node.checked === 'boolean'` gates the whole branch). It selects between two client-owned
  constants for `className` and two for `aria-label`. **No daemon-supplied substring is interpolated
  into any attribute of the new element** — which is the operator ruling's actual line, and the shape a
  careless design would have crossed by labelling the mark with the item's own text.
- Strikethrough: `mdast-util-to-hast`'s `delete` handler was read, not assumed — it emits
  `{tagName: 'del', properties: {}}`. No attribute surface at all; children re-enter the same escaping
  path as every other inline.
- The set of daemon-influenced *class values* reaching the DOM is therefore unchanged: still exactly
  `language-*`, whose inertness argument the file already carries. `task-list-item` is a fixed literal
  in the handler, not derived from source, and CommonMark offers no attribute syntax to smuggle one in.

**2. Tokens, secrets, credentials — not applicable, by process placement.** This module is renderer-side
and pure `(string) => JSX`. It holds no credential, reads no store and reaches no IPC channel. Nothing
in the change alters that.

**3. File / storage operations — not applicable, with one near-miss named.** No path is constructed,
read or written. The near-miss is in the treatment rather than the logic: a tick drawn as
`background-image: url(data:…)` or as Figma's generated `https://www.figma.com/api/mcp/…` `<img>` would
have turned a stylesheet into a fetch from the privileged window. § Design rejects both explicitly and
draws the tick with a `content: ''` pseudo-element, which fetches nothing. The mark's state never
becomes a filename, a cache key or a lookup path.

**4. Inter-process / Electron surface — the change is net-negative surface, deliberately.** No IPC
channel, no `contextBridge` API, no `webPreferences` and no navigation guard is touched. The one
Electron-relevant question is whether the new markup creates a fetching element or a navigation target:
it does not — the emitted `<span>` carries no `src`, no `href` and no `style` attribute, and the `a` and
`img` overrides are untouched. Overriding `input` away means **no form control exists in the privileged
window at all**, so there is no submission target and no autofill surface where the package default
would have put one. That is the AC3 decision paying a security dividend, not merely a visual one.

**5. Cryptographic primitives — not applicable.** No RNG, no comparison against a secret, no handshake
code path is reachable from this module.

**6. Network & I/O — the one genuinely new exposure is supply chain, and it is a SHOULD FIX.**
Four new direct runtime dependencies. The ticket pre-answered the registry query, and an adversarial
read is that registry metadata pasted into an issue body is *not* evidence about this tree.
→ **SHOULD FIX:** in Phase B, verify in-tree rather than re-derive — the four resolve at the stated
versions, `npm install` runs no install-time lifecycle script, and the transitive set gains nothing.
Report the measured result, not the body's claim.

Algorithmic complexity on unbounded daemon text was the other candidate here and it does **not** produce
a finding: task-list-item is a fixed three-character prefix check, and strikethrough resolves through
micromark's existing attention machinery — the same resolver `*` and `_` emphasis already reach in every
reply today — so no new resolver class becomes reachable. Input length is additionally capped upstream
of the renderer by `MAX_FRAME_BYTES` / `MAX_PLAINTEXT_BYTES` in `codec.ts`.

**7. Error messages, logs, telemetry — not applicable, and nothing is added.** The module logs nothing
on any path (#126's content-free rule), the change introduces no error path, and the checked/unchecked
state — which is daemon-derived — reaches no diagnostic.

**8. Concurrency — not applicable.** Pure function, no state, no effect, no async work, nothing to
cancel. `remarkPlugins` and `components` stay module constants, so no per-render identity churn is
introduced either.

**9. Threat model alignment.**
- *Hostile daemon.* The realistic craft is markdown, and it is answered above: a boolean is the whole
  influence over the task mark, `<del>` has no attributes, and markup-looking text still escapes rather
  than building an element. Deep nesting adds no new recursion class — task lists nest through lists and
  strikethrough nests through inline attention, both of which are reachable today.
- *Renderer compromise reaching the transport.* Unchanged: process isolation is what stops it, and this
  change removes an element type from the renderer rather than adding one.
- *Malicious relay.* Content-blind and on-path; irrelevant to a renderer-side parser configuration.
- *Out of scope, named:* autolink literals and footnotes stay uninstalled and this ticket does not
  install them; whoever installs either owns the `allowedLinkHref` interaction that decision reopens.

→ **SHOULD FIX (second):** the "no daemon text in an attribute" property above is the one claim in this
review that a future edit could silently break. Phase B pins it with a test: a hostile task-list and
strikethrough fixture whose text is markup, asserting the `&lt;` escaped-not-absent discriminator *and*
that the render contains no `style=`, no `href` and no `<img` — the sweep shape #1079 used for cells.

**No MUST FIX.** Both SHOULD FIX items are Phase-B actions on a design that does not need to change.
