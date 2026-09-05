# #1079 — a table in an assistant reply renders as a table

## Files read

Codegraph is unavailable in this worktree (every `mcp__codegraph__*` call returns "CodeGraph not
initialized"), so this list came from Grep/Read rather than `codegraph_context`. Noted as the gap the
brief asks to name, not as a shortcut.

- `src/renderer/src/screens/conversation/AssistantMarkdown.tsx` → the module header, `components`,
  `allowedLinkHref`, `fenceLanguage`, `AssistantMarkdown` — the whole file this ticket edits, and the
  security contract AC5 rewrites.
- `src/renderer/src/screens/conversation/AssistantMarkdown.test.tsx` → the `render` / `lines` helpers and
  the positive-with-every-negative convention every new case follows.
- `src/renderer/src/screens/conversation/conversation.css` → `.bubble`, `.bubble__markdown`,
  `.bubble__markdown > *`, `.code-block`, `.code-block__header`, `.code-block__body`,
  `.bubble__markdown code:not(.code-block__body code)`, `.bubble__markdown a` — the per-element shape
  AC3 requires the table rules to follow, and the token vocabulary they may draw from.
- `src/renderer/src/theme/tokens.css` → `--space-*`, `--radius-*`, `--color-primary-container`,
  `--color-surface`, `--text-title-small-weight-emphasized` — the whole of what AC3 admits. **Finding
  that shapes the design:** the scale carries no weight step above the bubble's own 600 emphasized, so
  a header row cannot be distinguished by a *token* weight.
- `e2e/assistant-whitespace.spec.ts` → `SETTLED_TEXTS`, `buildReplyFrames`, `assistantBubble`,
  `readCodeMetrics`, `readThreadWidths`, `SUBPIXEL_TOLERANCE_PX` — the detector AC2 says to copy, and
  the harness the new turn rides. Every `.bubble__markdown` locator in the file is bubble-index-scoped,
  so an appended turn disturbs none of them.
- `e2e/fixtures/bubbleText.ts` → `bubbleTextExactly` — why a whole-bubble `toHaveText` is anchored.
- `docs/knowledge/features/assistant-markdown-renderer.md` → § Edge cases, which records "GFM tables and
  bare-URL autolinking are out of scope by design" as one entailment of one decision. **This ticket
  falsifies half of that sentence and the documentation phase owns the correction**; the other half
  (autolinking) stays true and this plan proves it stays true.
  Also § Edge cases' `.code-block` note: a declaration that arrives by inheritance rather than being
  stated on the class may not reach a second call site — the argument that decides the `word-break`
  question below.
- `docs/knowledge/features/conversation-shell.md` → the `assistantText` fork; `.bubble__markdown` has
  exactly one call site, which bounds every selector written here.
- `CLAUDE.md` § Conventions → the daemon-text ruling (render, escape, bound; never a raw-markup sink).

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-43

**N/A for the table itself, and that is a settled situation in this file rather than a gap.** No node in
the Figma file draws a table inside a reply, so the table's treatment is a judgement call inside the
existing token set. `conversation.css`'s `.bubble__markdown a` rule records exactly the same for the
anchor ("Figma 16:43 contains no anchor, so both declarations are derived from the tokens rather than
read off the design"), and this ticket follows that precedent.

`get_screenshot` on 16:43 returns a **1×1 blank PNG** (natural size 330×260) — the node is the markdown
container, and it draws nothing of its own. That is consistent with the N/A above rather than a tooling
failure to work around: there is no image of a table to compare a render against, which is why AC2 is
written as a *measured box* and AC3 as a *token census* instead of a visual-fidelity read.

The nearest **drawn** precedent for the overflow question is the fenced code block (Figma 134:4809),
already translated into `.code-block` / `.code-block__body`: a bordered, rounded surface holding its own
content, `1px solid var(--color-primary-container)` on `var(--color-surface)` at `var(--radius-xs)`. The
table borrows its border colour and its gutter rhythm from there and **declines its radius**, for the
reason stated in § Design.

## Context

Three markdown constructs render as literal text in a settled assistant reply; this ticket is the table.
A table arrives as one `<p>` of raw pipes and dashes — not a cosmetic near-miss, but a paragraph that is
strictly less readable than the prose it replaced.

The cause is stated in `AssistantMarkdown.tsx`'s own header: no `remarkPlugins`, because `remark-gfm`
would manufacture anchors from bare URLs and the `a` override exists to prevent exactly that. That
reasoning is correct. The defect is that `remark-gfm` is a bundle of five unrelated extensions, so
declining the fourth silently declined the first three. The fix is to install the table extension alone —
capability-*absent* for autolink literals and footnotes, matching what the file already says about
`rehype-raw`, rather than capability-*disabled*.

**No ADR is warranted.** ADR 0010 already records the library choice and the capability-absent posture;
this ticket applies that posture rather than revising it. The documentation phase should instead correct
§ Edge cases' "GFM tables … are out of scope by design" bullet in
`docs/knowledge/features/assistant-markdown-renderer.md`, which this change falsifies for tables while
leaving it true for autolinking.

## Design

### 1. The plugin — `AssistantMarkdown.tsx`

Two new runtime dependencies, and the local attacher that registers them and nothing else:

```
micromark-extension-gfm-table@2.1.1    mdast-util-gfm-table@2.0.0
```

A module-local function, declared beside `components` because it is part of the security contract that
file's header describes (Technical Notes; splitting it would put half the contract somewhere nobody
reads):

```ts
function remarkGfmSubset(this: Processor): undefined
```

It appends `gfmTable()` to `this.data().micromarkExtensions` and `gfmTableFromMarkdown()` to
`this.data().fromMarkdownExtensions`, creating either array when absent, and returns no transformer.
**Both exports are functions and both must be called** — passing one called and the other uncalled fails
*silently*, eating the source markers and rendering neither syntax nor element. The code says so.

`AssistantMarkdown` then passes `remarkPlugins={[remarkGfmSubset]}` alongside the unchanged
`components`. No `rehypePlugins`, no `skipHtml`: both stay absent.

### 2. The `this`-typing decision — settled here, not discovered in Phase B

`strict: true` in `tsconfig.web.json` means `noImplicitThis` rejects the recipe as written. **Both
obvious routes were probed against this tree today and both fail**, which is why this section states a
third:

- `import type { Processor } from 'unified'` **alone is not enough.** `unified`'s own `Data` interface
  declares neither `micromarkExtensions` nor `fromMarkdownExtensions`; `remark-parse` contributes them
  by module augmentation, and react-markdown's types import `PluggableList` from `unified` directly, so
  that augmentation is never loaded into the program. Measured: four `TS2339 Property … does not exist
  on type 'Data'` errors.
- **A local structural `this` type fails contravariantly.** `Plugin`'s `this` is `Processor`, so
  assignability requires `Processor` to be assignable to the local type — and it is not: with `Data`
  unaugmented the two share no properties, and TypeScript's weak-type detection rejects it
  (`TS2322 … 'Data' has no properties in common`).

**The design therefore imports the augmentation from the package that owns it:**

```ts
import type {} from 'remark-parse'
import type { Processor } from 'unified'
```

Both are **type-only imports, erased at build**, and both are added to `devDependencies` — the honest
slot for a package nothing imports at runtime. Declaring them is the point rather than an accident:
leaning on a transitively-hoisted package for a type import is exactly what breaks on a differently
hoisted `npm ci`, and the Technical Notes call that out. AC4 forbids `rehype-raw` and `remark-gfm` and
deliberately says nothing about a type-only entry.

Measured: this route typechecks under `tsconfig.web.json` with **no cast anywhere** —
`micromarkExtensions` is `MicromarkExtension[]` and `gfmTable()` returns exactly that, so the push is
type-correct rather than asserted. That is the reason to prefer it over the two rejected routes, and it
is what goes in the code comment.

**Rejected: declaring the `unified.Data` augmentation ourselves.** It works today only because
`remark-parse`'s types are not in the program; the day anything pulls them in, two declarations of
`micromarkExtensions` with different types is a hard error. A latent trap, traded for nothing.

### 3. The header comment — AC5

The header's `• No remarkPlugins` bullet becomes false and is replaced by one that states three things:
what is registered (the GFM **table** extension pair, and nothing else), what is deliberately **not
installed** (autolink literals and footnotes — the two `remark-gfm` members this file's posture is
about), and that **absence rather than suppression** is what keeps autolinking impossible. The
`rehypePlugins` and `skipHtml` bullets are untouched. A short note records that the subset is installed
as two per-construct packages rather than the bundle, which is what makes "not installed" true.

### 4. The CSS — `conversation.css`

Per-element rules under the existing `> *` margin reset, in the shape `h1` / `blockquote` / `ul` / `a`
already follow. No new colour or length literal; every value is an existing custom property or a keyword.

- `.bubble__markdown table` — `display: block; overflow-x: auto; border-collapse: collapse;`
- `.bubble__markdown th, .bubble__markdown td` — a `--space-1`/`--space-3` gutter pair, a
  `1px solid var(--color-primary-container)` edge (the `.code-block` border, so the two chromes read as
  one family), `text-align: start`, and `word-break: normal`.

Four decisions the rule comments must state, because none of them is readable off a design:

**The overflow treatment is the table's own scroll box, not a wrapper element.** `display: block` makes
the `<table>` a block container that scrolls its own overflow, with an anonymous inner table box laying
the rows out. The alternative — a `table` component override wrapping it in a `div`, mirroring
`components.pre` → `.code-block` — was rejected: it would open the file that is the entire security
boundary for markdown rendering to add a purely visual container, and it buys nothing this does not
already give. AC2's detector reads `scrollWidth`/`clientWidth` on this same element either way.

**No `border-radius`, and that is the one place the `.code-block` precedent is declined.** Under
`border-collapse: collapse` the border-collapsing model does not round a table's outer edge, and
`overflow-x: auto` with a radius would need `overflow-y` clipping to come along with it — a vertical
scrollbar on a box that never overflows vertically. The cell borders carry the shape instead.

**`word-break: normal` on the cells is an override, not a restatement.** `.bubble`'s
`word-break: break-word` is the legacy keyword, which per CSS Text 3 behaves as `word-break: normal`
plus `overflow-wrap: anywhere` — and `anywhere`, unlike `break-word`, *does* lower a box's min-content
size. Inherited into table cells it lets every column shrink to nearly nothing, so a wide table would
silently squeeze into the bubble rather than overflow: unreadable, **and it would make AC2's detector
structurally unable to fire**. This is the mirror image of the argument § Edge cases makes about
`.code-block__body` — a value that arrives by inheritance is not necessarily right for the next element
that receives it. The comment says which value it displaces and why, so it is not mistaken for the
restatement `conversation.css`'s `a` rule warns against.

**`text-align: start` is a default the markers override, not a competing rule.** `mdast-util-to-hast`
emits a per-cell inline `style="text-align:…"` from the `:--` / `:-:` / `--:` delimiters, and an inline
style beats a stylesheet rule whatever the specificity — so AC1's per-column alignment comes from the
parser and this declaration only decides the *unmarked* column, where the UA would otherwise centre
`<th>` over left-aligned `<td>`.

**The header row's weight is deliberately left at the UA's `bold`.** The type scale tops out at
`--text-title-small-weight-emphasized` (600), which is the bubble's own weight — so a token-sourced
weight would erase the header distinction rather than state it, and any other value would be the new
literal AC3 forbids. Stating the omission is the point; a bespoke header treatment is a Figma-side
addition to 16:43 first, exactly as the `a` rule says of a bespoke link style.

## State + concurrency model

None. `AssistantMarkdown` is a pure function of `text` — no store slice, no effect, no subscription, no
async work, and therefore no cancellation path to define. The plugin is a module-level constant attacher
with no closure state; react-markdown re-runs it per render, appending to a fresh processor's data each
time, so there is no array that accumulates across renders. The `React.memo` seam #609 named and declined
stays declined and is not reopened here.

## Error handling

No new failure mode, and no new result type. Nothing in this change parses, fetches, or crosses a
process boundary; the only new code path is a parser extension applied to text the module already
received.

- **Malformed table syntax is not an error.** A delimiter row that does not match the header, a row with
  the wrong cell count, an unterminated table — GFM's table construct simply does not match, and the text
  falls through to CommonMark exactly as it does on `main` today. There is no reject branch to log.
- **Nothing is logged on any path**, matching `fenceLanguage` and `allowedLinkHref`: the values in reach
  are untrusted daemon text and the repo's diagnostics are content-free (#126).
- The `a` and `img` overrides keep their existing fail-closed behaviour unchanged, including for a link
  or an image that now appears **inside a table cell** — the overrides are keyed on element type, not on
  ancestry, so a cell is not a new enforcement gap. A unit case proves it rather than assuming it.

## Testing strategy

**Unit — `AssistantMarkdown.test.tsx` (`renderToStaticMarkup`, `environment: 'node'`).** Markup
properties only; this tier cannot see AC2 at all.

- A table renders `<table>` / `<thead>` / `<tbody>` / `<th>` / `<td>` with its cell text (AC1).
- Per-column alignment from `:--`, `:-:` and `--:` reaches the cells as `text-align` (AC1).
- A bare URL and a bare email address in prose still render as plain text with **no `<a` and no `href`**,
  each paired with a positive assertion on the visible text so the case cannot pass vacuously (AC4) —
  the criterion this ticket has to prove rather than assert.
- `<b>bold</b>` still renders as escaped visible characters, not an element (AC4).
- A link and an image inside a table cell still resolve through the `a` and `img` overrides (§ Error
  handling).
- A table whose cells contain markup-looking text renders it escaped, not interpreted.
- **The alignment attribute is a closed enum, proven rather than asserted** (§ Security review, finding
  1). A case feeding hostile delimiter-row content asserts that the emitted `style` is one of the three
  `text-align` values or absent — never daemon-derived text. This is the one new attribute this change
  lets react-markdown emit and the only place a table could reach a non-text sink.
- The existing suite stands unchanged; a red case there is a regression, not an expected edit.

**e2e — one appended turn in `e2e/assistant-whitespace.spec.ts` (fake-transport tier).** AC2's measured
box lives here. Appended rather than given its own spec: that file already owns the settled-reply
geometry harness, its own header blesses appending (it shifts exactly one constant, `TAIL`), and a new
spec would duplicate ~120 lines of frame builder. `SETTLED_TEXTS` drives `buildReplyFrames` and
`toHaveCount`, so the turn wires itself; `TAIL` moves 5 → 6 and a new `TABLE = 5` joins the index
constants.

- A `readTableMetrics` helper in `readCodeMetrics`'s exact shape — `{ scrollWidth, clientWidth }` off
  `.bubble__markdown table` inside the seeded bubble — reusing `SUBPIXEL_TOLERANCE_PX`.
- The seeded table is **deliberately wide**: several columns each holding an unbreakable long token, so
  its min-content width cannot fit the bubble under `word-break: normal`.
- **(a)** the table's own `scrollWidth > clientWidth` — the overflow is *contained* by the scroll box.
- **(b)** the bubble's and the thread's `scrollWidth <= clientWidth + SUBPIXEL_TOLERANCE_PX` — nothing
  escaped. Written with the tolerance, because a fractional box against rounded integers disagrees by 1
  on a box that does not overflow; a bare `<=` here is a flake, not a detector.
- **The redden-check is part of AC2, not a nicety.** Before the PR: delete `overflow-x: auto` from the
  table rule, run this spec, and confirm **(b)** goes red. Recorded in a `## Revisions` entry with what
  was observed. If it does not redden, the detector is wrong and the assertion — not the criterion — is
  what changes.

**Not touched: `interactiveRoundtrip.test.tsx`.** Its fixture pins the byte string
`data-thread-role="assistant"><div class="bubble__markdown"><p>`, and a table seeded there would render
`<table>` as the opening child and break it for no reason. Its seed is prose and stays prose.

## Open questions

1. **Does `display: block` on the table actually overflow rather than cap at the container?** CSS's auto
   table layout resolves a table's width as `max(MIN, min(GRIDMAX, available))`, so overflow depends on
   MIN exceeding the bubble — which is precisely what `word-break: normal` restores and what the wide
   seeded fixture forces. Resolved by AC2's assertion (a) passing; if it does not, the fallback is the
   rejected wrapper-div route via a `table` component override, and that reversal goes in `## Revisions`.
2. **Does `markdown-table` (the one genuinely new transitive) reach the renderer bundle?** It is
   `mdast-util-gfm-table`'s *serialiser* dependency and this path only ever parses. Worth confirming the
   `npm run build` output does not grow meaningfully; not a gate, and no action if it does — recorded so
   the answer is written down rather than wondered about later.

Each is resolved during Phase B and recorded in a `## Revisions` entry if it changed the design.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — the `style` prop path goes live on this file for the first time, and
  the plan asserted its safety instead of proving it.** The one untrusted-to-trusted boundary here is
  daemon reply text entering `AssistantMarkdown`, and this change widens what the parser may emit from
  it. `mdast-util-to-hast`'s table handler emits a per-cell inline `style="text-align:…"` from the
  delimiter row, and `hast-util-to-jsx-runtime` (already in the tree via react-markdown) parses that
  string into a React `style` object — so a construct on this path can now reach an attribute sink that
  no shipped construct reached before. The value is derived from `align`, which
  `mdast-util-gfm-table`'s fromMarkdown sets to `left` / `right` / `center` / `null` by matching the
  delimiter cell's shape, never by copying its text — a closed enum, not daemon text. **Mitigation,
  mandatory in Phase B:** read that mapping in the installed package to confirm it, and land the
  hostile-delimiter unit case named in § Testing strategy. Belt and suspenders of different fabric — a
  source read plus a deterministic assertion — because "the enum is closed" is exactly the kind of claim
  that is true until a dependency minor changes it. Not a MUST FIX: it is unproven, not exploitable as
  designed, and CSP with no `img-src` means even a `url()` in an injected declaration cannot fetch.
- **[Trust boundaries] No findings on the enforcement points themselves.** `allowedLinkHref` and the
  `img` override are keyed on element type, not on ancestry, so a link or an image inside a table cell
  resolves through the identical allowlist — a cell is not a new gap. `components` is unchanged by this
  ticket; a unit case covers the in-cell case rather than assuming it. The table constructs
  (`table`/`thead`/`tbody`/`tr`/`th`/`td`) carry no URL-bearing attribute at all.
- **[Trust boundaries] The subset is bounded by what is installed, and that is the criterion AC4 pins.**
  `gfmTable()` registers the table construct only; autolink literals, footnotes, task lists and
  strikethrough are separate packages that are not in `package.json`. There is nothing to suppress and
  nothing to re-check on a future react-markdown bump — the capability-absent property the file's header
  claims stays literally true rather than becoming a configuration promise.
- **[Tokens, secrets, credentials] No findings — not applicable by design.** This module holds no
  credential and reaches no storage: it is a pure function of one string prop, with no store access, no
  IPC and no disk. Nothing in the change can put a value anywhere a secret is kept.
- **[File / storage operations] No findings — no path is constructed.** Neither new package performs
  I/O; both are pure text transforms. See the supply-chain finding below for the install-time question,
  which is the only way these packages touch the filesystem.
- **[Inter-process / Electron attack surface] No findings — no capability crosses a process boundary.**
  Renderer-only change: no new `contextBridge` API, no `ipcMain` channel, no `webPreferences` edit, no
  protocol handler. `setWindowOpenHandler` and the `will-navigate` guard in `src/main/index.ts` are
  untouched, and the transport, keys and Noise session stay in the main process. A compromised renderer
  gains nothing it did not already have.
- **[Cryptographic primitives] No findings — not applicable.** No RNG, no comparison against a secret,
  no key or nonce in reach; the Noise variant constant is not touched.
- **[Network & I/O] No findings — no element this change enables can fetch.** The relevant question for
  a renderer change is subresource fetches, and `table`/`th`/`td` carry no fetching attribute; the `img`
  override still renders alt text only, and the CSP's absent `img-src` remains the independent second
  layer. No socket, no timeout and no frame cap is in scope.
- **[Error messages, logs, telemetry] No findings — the change adds no log call and no error path.** A
  malformed table is not an error: the GFM construct simply fails to match and the text falls through to
  CommonMark. That matches `fenceLanguage` and `allowedLinkHref`, which log nothing on their null paths
  because the value in reach is untrusted daemon text and this repo's diagnostics are content-free
  (#126).
- **[Concurrency] SHOULD FIX — this change adds a *width* dimension to the render-thread parse cost that
  § Edge cases already accepts, and AC2's containment is the mitigation.** The parse is synchronous on
  the render thread and re-runs per render; micromark is non-backtracking and the table construct is
  linear, so the parse itself is the same accepted class as a pathological list. What is new is the
  *layout* shape: a reply with very many columns produces a box far wider than the bubble, and
  `word-break: normal` on the cells deliberately stops them shrinking out of it. That is the layout-DoS
  shape `.code-block__header`'s `nowrap`+ellipsis exists for one construct over. **The overflow
  treatment is therefore a security control, not a cosmetic one** — which is precisely why AC2 demands
  a measured box and a redden-check rather than a markup read, and why the redden-check is not optional.
  No async task, timer, listener or cancellation path is introduced, so there is nothing to abort.
- **[Threat model alignment] SHOULD FIX — supply chain is the genuinely new exposure, and it is the
  reason this ticket carries the label.** Two new direct runtime dependencies plus one new transitive
  (`markdown-table`, pulled by `mdast-util-gfm-table`; its other four are already in the tree via
  react-markdown), and two type-only devDependencies that are already present transitively. Both new
  runtime packages come from the same `micromark` / `syntax-tree` maintainership as the react-markdown
  tree already installed, and `package-lock.json` pins them. **Mandatory in Phase B:** confirm neither
  adds an install/postinstall lifecycle script, and record the resolved versions. Deliberately *not*
  mitigated further: vendoring or pinning to an integrity hash beyond what the lockfile already does is
  a repo-wide policy question, not this ticket's.
- **[Threat model alignment] No findings on the hostile-daemon and hostile-relay cases.** A hostile
  daemon's best move on this path is a crafted reply, which is exactly the input the parser is
  capability-bounded against: no HTML interpretation (`rehype-raw` absent), no autolinking (the extension
  absent), no fetching element. A content-blind on-path relay can drop, delay or reorder frames but
  cannot see or alter reply text inside the Noise session, and nothing here changes that.
- **[Threat model alignment] OUT OF SCOPE — task lists and strikethrough**, the other two constructs the
  bundle-decline took with it, ride this ticket's plugin in **#1080**. Footnotes stay unavailable and
  that is unchanged behaviour rather than a regression: CommonMark reads `[^1]: note` as a link reference
  definition, so footnote syntax produces a link whose target `allowedLinkHref` rejects, rendering as
  plain text.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-05
