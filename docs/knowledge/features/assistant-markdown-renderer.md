# Assistant markdown renderer

Converts assistant-reply markdown source into React elements — headings, emphasis, lists, code, blockquotes — with raw HTML incapable of interpretation on this path. Introduced in [#608](../codebase/608.md) shipped dormant, then wired into the thread by [#609](../codebase/609.md): at that time, only **settled** `assistantText` bubbles used it inside `.bubble__markdown`, while the growing tail stayed plain. [#623](../codebase/623.md) then gave a fenced code block its chrome — a bordered, rounded `.code-block` with an optional header bar naming the fence's language above a divider. [#721](https://github.com/pyrycode/pyrycode-desktop/issues/721) redrew that chrome to the desktop design: a tighter 6px corner and a `--color-primary-container` border in place of the mobile mock's 12px `--color-outline-variant`, wider 8/16 and 12/16 gutters, a label-medium-emphasized header inked `--color-on-surface` (was label-small on the muted `--color-on-surface-variant`), an `--color-on-primary-container` divider, and a 20px code line. The element tree, the language pick, the divider's placement on the header rather than the body, and the `--color-surface` fill all carried over unchanged — see § Edge cases. [#780](https://github.com/pyrycode/pyrycode-desktop/issues/780) later reused this exact chrome — the `div.code-block` > `pre.code-block__body` pair, headerless — for a second call site, an expanded `Bash` tool row's command (see [Conversation shell § Shell command code block](conversation-shell-tool-row-code-block.md#shell-command-code-block-780)); that is why `.code-block__body`'s `white-space: pre-wrap` and `word-break: break-word` now live on the class itself rather than on `.bubble__markdown pre` (deleted) and inherited from `.bubble` — neither reached the tool row, which is not a `.bubble` descendant. [#628](../codebase/628.md) then sized `h1`–`h6` from the type scale in place of the UA's `2em..0.67em`/`bold`. [#629](../codebase/629.md) then took over the last two UA-laid-out constructs — `ul`/`ol` indent and `blockquote` margin — replacing the UA's 40px with a `--space-4` indent (list) and a `--space-3` indent plus a 4px `--color-outline` leading bar (blockquote), and established the container's 8px block rhythm one level inside either, which `.bubble__markdown`'s own direct-child reset and flex `gap` never reached. [#630](../codebase/630.md) closed the #624 split: inline code now renders as a chip (mono token, `--color-surface` fill matching `.code-block`'s own, `--radius-xs`, `--space-1` inline padding), excluded from a fenced block's contents by ancestry (`code:not(.code-block__body code)`) rather than by class, since a languageless fence's `<code>` is attribute-identical to an inline one. [#721](https://github.com/pyrycode/pyrycode-desktop/issues/721)'s desktop redraw later moved `.code-block`'s own corner onto that same `--radius-xs` — a convergence the two rules arrived at independently, not a coupling one introduces on the other. Those four post-#609 tickets are CSS-only, hung under `.bubble__markdown`'s single call site — none of them touch `AssistantMarkdown.tsx`. [#610](../codebase/610.md) then reopened the file itself for the first time since #608: the deny-first link posture narrows to an allowlist of exactly `http:`/`https:`, enforced by a module-local `allowedLinkHref` predicate in the `a` override, with a matching `.bubble__markdown a` rule — the app's first anchor CSS — giving the anchor a token-derived colour and underline. [#1079](https://github.com/pyrycode/pyrycode-desktop/issues/1079) then reopened the file a second time to register a module-local GFM **table** extension pair (`micromark-extension-gfm-table` + `mdast-util-gfm-table`) as its first `remarkPlugin` — not the `remark-gfm` bundle — alongside a new `.bubble__markdown table`/`th`/`td` CSS block: a table now renders as a table, with per-column alignment from the `:--`/`:-:`/`--:` markers and a self-scrolling overflow box, while autolink literals, footnotes, task lists and strikethrough (the bundle's other four members) stay uninstalled, so bare-URL and bare-email autolinking stays impossible by absence rather than suppression. [#1080](https://github.com/pyrycode/pyrycode-desktop/issues/1080) then registered the remaining two `remarkGfmSubset` pairs — task list (`micromark-extension-gfm-task-list-item` + `mdast-util-gfm-task-list-item`) and strikethrough (`micromark-extension-gfm-strikethrough` + `mdast-util-gfm-strikethrough`) — so only autolink literals and footnotes remain uninstalled. It also added `components.input`, the first override this file needed for a construct it could otherwise have inherited unmediated from a package default, plus four `.bubble__markdown` CSS rules (`.task-list-item`, `.task-mark`, `.task-mark--checked::after`, `del`). Zero new transitive dependencies — all eleven were already in the tree via `react-markdown`. See [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) for the full library-choice rationale and security review, and [Conversation shell § assistantText](conversation-shell.md) for the fork itself.

[#1751](../../specs/architecture/1751-progressive-assistant-markdown.md) superseded that split: both branches now use this renderer, with parser-verified freezing and pending presentation on the streaming tail and original-source rendering on settlement.

## What it does

Takes untrusted assistant source from `TimelineRow` and turns markdown syntax into React elements. Settled replies use original `item.text`; streaming uses insertion-only virtual source through the same renderer (see [usage](#configuration-and-usage)). The renderer retains the original auto-escaping posture, while guaranteeing:

- Raw HTML in the source is never interpreted — it renders as literal, escaped text (`<script>` → `&lt;script&gt;`), never deleted, never parsed into a real element.
- Link syntax whose href is an absolute `http:`/`https:` URL carrying an authority renders as a real anchor, href and visible text unchanged, that opens in the OS browser on click ([#610](../codebase/610.md)). Without the markdown-reader opt-in described below, every other href — `javascript:`, `data:`, `file:`, `mailto:`, a custom scheme, a relative or protocol-relative href, an empty href, anything that doesn't parse as a URL — renders as its visible text only, with **no anchor element** and no `href` anywhere in the markup.
- Image syntax renders as its alt text only, with **no `<img>` element** — no element on this path can ever fetch a remote resource, independent of the CSP.

[#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) gave the component a second consumer beyond the live thread: [the markdown reader](conversation-shell-markdown-reader.md)'s Copy as HTML server-renders it via `renderToStaticMarkup(<AssistantMarkdown text={text} />)` (`react-dom/server`) to build a clipboard payload. Every guarantee above holds there by construction — the same component, the same props, no second sanitizer — rather than by re-implementing the rules against a clipboard-specific threat model.

## How it works

One file: `src/renderer/src/screens/conversation/AssistantMarkdown.tsx`.

```tsx
export const AssistantMarkdown = memo(function AssistantMarkdown({ text, onOpenMarkdownPath, allowElement }: {
  text: string
  onOpenMarkdownPath?: (path: string) => void
  allowElement?: AllowElement
}): JSX.Element {
  // Existing components table and Markdown render.
})
```

Ordinary shallow `React.memo` compares `text`, `onOpenMarkdownPath` and `allowElement`.
Equal inputs skip component execution and synchronous parsing, including when the
owning row changes metadata or action availability. Changed callbacks or predicates
must rerender: suppressing them would retain stale reader behavior or streaming
presentation. The stable reader callback and
[settled row boundary](conversation-shell-timeline-render.md#settled-row-reuse)
allow unchanged settled replies to reuse their render on new deltas. Memoization
changes no security rule below.

Rendering parses `text` synchronously without store access or effect hooks. The module-private `CodeBlock` holds a local DOM ref for user-activated copying; `AssistantMarkdown` emits no wrapper element of its own (`react-markdown` v10 emits block elements directly; the container and its class are [#609](../codebase/609.md)'s `.bubble__markdown`, a flex column with `gap: var(--space-2)` for Figma `16:43`'s 8px block rhythm). Built on `react-markdown@10.1.0` with:

- **No `rehypePlugins`.** No HTML parser exists in the dependency graph at all — interpreting HTML would require adding `rehype-raw` to `package.json`, a visible, reviewable act, not a config flip.
- **One `remarkPlugin`, `remarkGfmSubset`** ([#1079](https://github.com/pyrycode/pyrycode-desktop/issues/1079)/[#1080](https://github.com/pyrycode/pyrycode-desktop/issues/1080)), an exported function that pushes `gfmTable()`, `gfmTaskListItem()` and `gfmStrikethrough()` onto `this.data().micromarkExtensions` and the matching three `*FromMarkdown()` calls onto `this.data().fromMarkdownExtensions` (creating either array when absent) and registers nothing else. `remark-gfm` itself is still never added — it is a bundle of five unrelated extensions, and the two that matter here, autolink literals and footnotes, are separate packages that stay uninstalled. A bare URL and a bare email address in prose still render as plain text because there is no autolinking code in the dependency graph to suppress, not because a setting turns it off — the same capability-**absent** property the `rehypePlugins` bullet above claims for HTML, arrived at the same way. **All six extension-registration calls must actually be invoked**: passing one called and another uncalled fails silently — a function where an extension object is expected is accepted, the source markers are eaten, and the text loses its syntax while gaining no element. `gfmStrikethrough()`'s `singleTilde` option is left at its default (on), so `~struck~` strikes as well as `~~struck~~`; the one hazard that looked plausible — a pair of home-relative paths on one line — was measured and does not reproduce, because GFM's flanking rule means a path's tilde can only ever open a run, and a test pins that non-reproduction rather than disabling the option against no observed failure. `remarkPlugins` is a module constant (`[remarkGfmSubset]`), not an inline array literal at the call site, so react-markdown gets a stable prop identity across renders; its length is no longer the construct count (that's `remarkGfmSubset`'s body) but is still a security claim in its own right — a second plugin entry would put part of the parse configuration somewhere this file's own docstring can't vouch for. [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) exported `remarkGfmSubset` for a second caller, [the markdown reader](conversation-shell-markdown-reader.md)'s `markdownPlainText`: it parses a note with `unified().use(remarkParse).use(remarkGfmSubset)` — the exact plugin this module registers — so its structural mdast walk (for Copy as plain text) sees the same tree this module renders, rather than a second, independently-configured parse that could drift from it. The export adds a parser to the reader's module, not a renderer; the walk's output is plain text, and nothing it produces reaches a markup sink.
- **Typing `remarkGfmSubset`'s `this` needs the augmentation imported from its owner, not declared locally.** `tsconfig.web.json`'s `strict` rejects a bare `function` calling `this.data()` (`noImplicitThis`). `import type { Processor } from 'unified'` alone isn't enough — `unified`'s own `Data` interface declares neither extension array; `remark-parse` contributes both by module augmentation, and react-markdown's types import `Processor`/`PluggableList` from `unified` directly, so that augmentation never enters the program unless something imports it (four `TS2339`s otherwise). A local structural `this` type fails the other way, contravariantly: `Plugin`'s `this` is `Processor`, so `Processor` must satisfy the local type, and weak-type detection rejects it against an unaugmented `Data` (`TS2322`). The fix is `import type {} from 'remark-parse'` alongside the `unified` import, both type-only (erased at build) and both declared directly in `package.json`'s `devDependencies` rather than reached for transitively — leaning on a transitively-hoisted package for a type import is exactly what breaks on a differently-resolved `npm ci`. The payoff beyond compiling: `micromarkExtensions` is then typed `MicromarkExtension[]` and `gfmTable()` returns exactly that, so both pushes are type-checked rather than cast.
- **`skipHtml` left at its default (unset).** The tempting-looking `skipHtml: true` *deletes* HTML tags and promotes their inner text into the message; the default *escapes* them to visible characters instead, matching the bubble's pre-existing untrusted-text posture and preserving the `&lt;`/`&amp;` discriminator tests need.
- **`components.a`** ([#610](../codebase/610.md)) → a module-local, fail-closed predicate, `allowedLinkHref(href)`, decides *in the renderer, at render time, before any anchor element exists* — it does not lean on the main-process guards, because a `javascript:` href executes in the document rather than navigating it and so is never seen by `will-navigate`. It parses the href with `new URL(href)` and **no base argument** (so relative/protocol-relative/empty/unparseable hrefs are rejected without being resolved — a dev-server build and a packaged build can never disagree on the same reply), requires `protocol` to be `http:`/`https:`, and separately requires the *original* string to match `/^https?:\/\//i` (a scheme-with-no-authority like `http:example.com` would otherwise base-resolve to a different host in the two builds — this is what keeps the renderer's decision and `setWindowOpenHandler`'s independent one in agreement). An allowed href renders `<a href={allowed} target="_blank" rel="noreferrer">`, returning the **original** href string, never the parser's normalised form. `target="_blank"` is the click mechanism, not decoration — it is what routes the click to `setWindowOpenHandler` (`src/main/index.ts:56`, unchanged), which hands the URL to `shell.openExternal` and denies the in-app window on every path; a plain anchor would be a same-document navigation `will-navigate` cancels, so the link would look correct and silently do nothing. Everything else renders `children` only — no anchor, no `href`, byte-identical to the pre-#610 deny-first render. [#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627) pulled this entire branch out into module-scope `webLink(href, children)`, called from both the module-constant `a` override and the opt-in table below — one function owns "what a non-markdown-path link renders," so the two tables cannot answer that question differently.
- **`markdownLinkPath(href)`** ([#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627)) → a second, independent fail-closed predicate, checked *before* `webLink` in the opt-in table only: it strips a `#fragment`, then a trailing `:line`/`:line:column` suffix (in that order — checking for a URL scheme before removing the suffix would read `Plan.md:12` as the scheme `plan.md:`), rejects what remains if it now carries a URL scheme or does not end in `.md`/`.markdown` (case-insensitive), `decodeURIComponent`s it exactly once (matching micromark's own single percent-encoding of a link destination), and rejects both an undecodable escape and a decoded path longer than `MAX_WORKSPACE_FILE_PATH_LENGTH` — the last check exists because the main-side `isWorkspaceFileReadRequest` (`src/shared/ipc/workspaceFileRead.ts`) silently drops an over-length ask, which would otherwise leave [the reader](conversation-shell-markdown-reader.md) loading forever with no answer to correlate against. A non-null result is untrusted, unresolved, path text — it is never joined, normalised or checked against a local folder here; the daemon does all confinement on the other end of the [`readWorkspaceFile` bridge](attachment-retrieval.md).
- **`components.input`** ([#1080](https://github.com/pyrycode/pyrycode-desktop/issues/1080)) → the task-list extension's hast handler puts an `<input type="checkbox" disabled>`, plus `checked` when the item is checked, into the item's first paragraph — the first element type this file would otherwise have let a package default put across the boundary its own header describes. The override renders an inert `<span className="task-mark"|"task-mark task-mark--checked" role="img" aria-label="Not done"|"Done" />` instead: no `<input>` ever reaches the DOM, so source-authored task lists create no form control, submission target or autofill surface. The client-owned `Copy code` button below is an explicit exception to the former blanket prohibition on controls in Markdown. The source's entire influence is the one boolean `node.checked`, destructured behind its own `typeof` gate in the handler and compared with `=== true` here — it only ever selects between two client-owned class/label pairs, and no daemon substring is interpolated into either. `role="img"` plus the label keeps the state in the accessibility tree without a text node inside `.bubble`, which every whole-bubble text assertion in `e2e/` would otherwise have to admit; the mark itself is drawn as a CSS pseudo-element for the same reason (`.bubble__markdown .task-mark--checked::after`).
- **`components.img`** → renders `alt` only (no `<img>`, ever; `''` when alt is absent). Unaffected by #610 — the allowlist opened for links only.
- **`components.code`** → not overridden, and stays that way — [#630](../codebase/630.md) discriminates inline code from a fenced block's contents entirely in `conversation.css`, by ancestry (`code:not(.code-block__body code)`), specifically so this file never needs a `code` override. Its `class="language-*"` is React-escaped (inert) and structurally can't collide with an app CSS class (mandatory `language-` prefix) — and it's the sole carrier of the fenced-code language label Figma `16:47` specifies, read by `components.pre` below.
- **`components.pre: CodeBlock`** → a module-private component wraps each block in
  `<div className="code-block code-block--copyable">`, with an optional
  `.code-block__header`, the original children in `pre.code-block__body`, and a
  native `type="button"` named `Copy code`. The header and button are siblings of
  the pre, keeping chrome outside the copied text. `fenceLanguage(children)` still
  reads the code child's `language-*` class without reparsing the message, bounds
  the label to 20 characters, and returns `null` for headerless fences and indented
  blocks. Overriding `pre` leaves inline code unchanged. The copy button uses
  `BubbleMeta`'s exact 11×12 glyph, with client-owned label, classes and behavior.
- **Block-local clipboard copying** reads the ref's own `code.textContent`
  synchronously on activation, before awaiting
  [the existing `copyMessageText` helper](conversation-shell-message-bubble.md#copymessagetextts-new).
  It writes plain text through `navigator.clipboard.writeText`, preserving the
  helper's quiet `false` result for missing or refused clipboard access. No
  production clipboard reads or confirmation state are added. The
  `code-block-copy` diagnostic carries only static `copied`, `failed` or
  `missing-code` codes; neither code text, language nor caught errors are logged.
  The non-submitting client-owned button does not enable source-authored controls
  or change raw-HTML escaping.

Neither the `a` nor `img` override spreads `{...props}` — a spread would put `href`/`src` straight back (and, for `a`, `title` and anything else react-markdown supplies) while every visible-text test assertion kept passing, so the no-spread rule is enforced by construction (a code comment flags it), not by test coverage alone. `.bubble__markdown a { color: var(--color-primary); text-decoration: underline; }` in `conversation.css` ([#610](../codebase/610.md)) is the app's first anchor rule — the underline is load-bearing, not decorative: colour alone against the surrounding prose ink measures 1.31:1, well under WCAG G183's 3:1 floor for a colour-only link cue.

## Configuration and usage

`TimelineRow` uses `<StreamingAssistantMarkdown text={item.text}
onOpenMarkdownPath={onOpenMarkdownPath} />` while `inProgress` is true, and
`<AssistantMarkdown text={item.text} onOpenMarkdownPath={onOpenMarkdownPath} />`
on settlement. Both live inside `.bubble__markdown`, with direct block children,
reset margins and the existing 8px flex gap. Neither carries `bubble--assistant-text`;
markdown owns prose whitespace on both branches, and `.code-block__body` retains
`pre-wrap` for code. The decorative cursor is a sibling after the markdown container,
before `BubbleMeta`, and disappears on settlement. User messages do not use this renderer.

`onOpenMarkdownPath` remains optional, threaded through `ConversationScreen`,
`Timeline` and `TimelineRow`. [The reader](conversation-shell-markdown-reader.md)
renders fetched notes with `<AssistantMarkdown text={state.text} />`, without that
callback or streaming stabilization. `allowElement?: AllowElement` is the streaming
presentation seam: when supplied, react-markdown uses `unwrapDisallowed` so rejected
elements retain their text. Existing callers without it keep their rendering behavior.
The predicate only removes elements; `allowedLinkHref`, `markdownLinkPath`, HTML
escaping, alt-only images and the GFM subset remain the security boundary. No
`rehypePlugins`, `skipHtml`, raw markup sink or stored-source mutation is introduced.

### Streaming presentation

The local `StreamingAssistantMarkdown.tsx` helper derives partitions synchronously
using `unified().use(remarkParse).use(remarkGfmSubset)`. Each appended delta parses
from the first unfrozen block's line. A candidate freezes only after the following
top-level block's first two lines have ended and separately parsing the candidate
and remainder reproduces the tail tree at shifted absolute positions. A unit cannot
end in a list, blockquote or indented code block; failed verification grows it to the
next boundary. Frozen objects retain identity and `FrozenMarkdown` memoizes each
unit by its props, keyed by numeric source offset. The unfrozen tail uses one more
`AssistantMarkdown`, with no extra block wrappers.

Any reference definition, including nested definitions and next-line titles,
discards frozen units and switches permanently to whole-reply parsing/rendering
for that append-only stream: a later definition can change earlier link output.
Replacement source resets the partition; unmount releases it. Whole-reply mode
still applies pending presentation to its trailing leaf.

Only the trailing paragraph or heading leaf receives pending inline completion,
including inside a quote. The helper inserts closers innermost first and keeps them
only when the parser consumes them as markup; affected emphasis, strike, code and
link elements unwrap. Thus `**bold` and backtick code show plain `bold`/`code`, and
`[text](` or `[text](https://exa` shows untappable `text`, even with reader opt-in.
No synthetic syntax is visible. Completed constructs regain their normal treatment;
escaped markers, `2 * 3`, `snake_case_` and `see ~/path` stay literal. Single tildes
are not probed. Closers go before trailing whitespace, and headings use the last
inline child's parser position so closing hashes stay syntax.

A final pipe-containing header, alone or with a partial delimiter, gets the smallest
parser-accepted virtual delimiter, bounded by the header's pipe count plus one.
The pending table, rows, cells and inline formatting/link elements unwrap to cells
separated by spaces; partial separator characters stay hidden. Quote and indentation
prefixes are preserved. A complete separator establishes the table, accepting that
layout change; `left | right\n\nnext` is not a pending header. Fences need no virtual
completion: the parser renders an unclosed fence as code after its opening line ends,
and an end-of-input closing candidate growing into `` ```x `` stays code content.

Either `turn_end` or a following tool row unmounts the helper and renders original
`item.text` through full `AssistantMarkdown`. Without pending inline/header syntax,
streaming content matches settlement apart from whitespace between top-level blocks
(cursor and metadata excluded). Unfinished syntax may correct: final `**bold` becomes
literal `**bold`. [#1751](../../specs/architecture/1751-progressive-assistant-markdown.md)
supersedes the historical #607/#609 plain-tail policy;
[settled row reuse](../../specs/architecture/1886-settled-row-reuse.md) supersedes
the earlier memoization decline.

## Edge cases and limitations

- **Reference-style links and autolinks get the same treatment as inline links, allow or deny alike** — `[label][ref]` and `<https://example.com>` resolve through the same `allowedLinkHref` predicate as `[text](url)`, each verified as its own test case rather than assumed to fall out of the inline-link override.
- **A `javascript:` href never reaches the DOM**, because `allowedLinkHref` rejects it before any anchor is constructed — the module still doesn't rely on `react-markdown`'s built-in `urlTransform` as the safety mechanism, even after [#610](../codebase/610.md) opened the `http:`/`https:` allowlist. That decision was measured, not assumed: probed against the pinned `react-markdown@10.1.0`, `urlTransform` *blanks* a denied href (`javascript:`, `data:`, `file:`, a custom scheme, an empty href all arrive at the override as `href=""`) rather than removing the anchor, so leaning on it alone would emit `<a href="">` — an anchor, a click target, and the literal string `href` — for every one of those. `mailto:` and a relative href arrive **unblanked**. `urlTransform` is left at its default and runs as a prior, independent narrowing nothing here depends on; `allowedLinkHref` in the `a` override is the sole enforcement point.
- **`mailto:` is denied**, even though `react-markdown`'s default `urlTransform` permits it — `setWindowOpenHandler` (`src/main/index.ts:56`) denies it, and the renderer allowlist narrows to match the main-process handler rather than the other way round. A live `mailto:` link that silently did nothing on click would be worse than one that renders as text.
- **A scheme with no authority is denied even though its protocol is on the allowlist** — `http:example.com` parses absolutely and its `protocol` is `http:`, but the browser would resolve it against the document base on click (the dev server's host, or the packaged app's `file:` origin, depending on build), which could diverge from what the renderer checked. `allowedLinkHref`'s fourth condition (`/^https?:\/\//i` against the *original* string) closes this independently of the scheme check.
- **Empty-alt images (`![]()`) render nothing but leave sibling text intact** — no `<img>`, no placeholder, the empty string from `alt ?? ''`.
- **A GFM table renders as a table** ([#1079](https://github.com/pyrycode/pyrycode-desktop/issues/1079)) — header row, body rows, and per-column alignment taken from the `:--`/`:-:`/`--:` markers. That alignment reaches the cell as a per-cell inline `style="text-align:…"` rather than a legacy `align` attribute — `mdast-util-to-hast`'s `tableCellAlignToStyle` option is on by default and rewrites it — so the value worth bounding is a CSS sink, not a plain attribute. It is a closed enum (`'left' | 'center' | 'right' | 'none'`) inferred from micromark **event types**, never copied from the delimiter cell's text (`micromark-extension-gfm-table/lib/infer.js`), confirmed both at that source and by a hostile-delimiter unit case whose cell text carries a quote and a `url(...)` and produces no `style` at all. `allowedLinkHref` and the `img` override are keyed on element type, not ancestry, so a link or image inside a table cell resolves through the same allowlist as anywhere else. A table too wide for the bubble scrolls inside its own box (`.bubble__markdown table { display: block; overflow-x: auto; border-collapse: collapse }`) rather than pushing the bubble or the thread past their measure — the one CSS decision here with no drawn Figma precedent, borrowing `.code-block`'s border colour and gutter rhythm but declining its radius, since `border-collapse` doesn't round a table's outer edge and a radius would need `overflow-y` clipping dragged along with `overflow-x`. `word-break: normal` on `th`/`td` is a deliberate override of `.bubble`'s inherited `break-word` — the legacy keyword, which behaves as `normal` plus `overflow-wrap: anywhere`, and `anywhere` (unlike `break-word`) lowers a box's min-content size, which would otherwise let every column shrink to fit instead of overflowing and leave the overflow treatment with nothing to catch. Proven with a measured box, not a markup read: `e2e/assistant-whitespace.spec.ts`'s wide-table case, redden-checked by deleting `overflow-x` before shipping (the bubble's `scrollWidth` then measured 1778 against a `clientWidth` of 485).
- **A task list renders its checked and unchecked states as a drawn mark, not a checkbox** ([#1080](https://github.com/pyrycode/pyrycode-desktop/issues/1080)) — a 14px bordered box (`.task-mark`, borrowing `.question-panel__control--checkbox`'s 12px content-box geometry at Figma `347:6211` but not its `--color-tertiary` posture: the muted `--color-on-surface-variant` is used instead, since this mark must not read as interactive the way that control does) with a rotated two-border `::after` tick when checked. `.bubble__markdown .task-list-item { list-style: none }` suppresses the bullet the mark replaces, scoped to the **item**, not the enclosing `<ul>`'s own `contains-task-list` class — `mdast-util-to-hast`'s *list* handler emits that class, its separate *list-item* handler emits `task-list-item`, and a list may mix task items with plain ones, so suppressing at the list level would take the plain item's bullet with it too. Both test tiers render exactly that mixed list to pin the grain. A **tight** list unwraps the mark's wrapping paragraph so it lands as a direct `<li>` child and picks up the `li > *` margin-reset rhythm; a **loose** list (a blank line between items) keeps the `<p>`, and the rhythm reaches that instead — both nestings are asserted, not assumed. Figma `16:43` draws no task list, so the treatment is derived from tokens the way the anchor and table rules already are.
- **`~~struck~~` renders `<del>`, styled with a single colour rule** (`.bubble__markdown del { color: var(--color-on-surface-variant) }`) — the UA's own `line-through` carries the strike; restating it would repeat the same inherited-value mistake the anchor, list and table rules in this file already avoid making. `singleTilde` (micromark's option, default on) is left on, so `~struck~` also strikes; the one hazard that looked plausible — two home-relative paths on a line, `~/config` and `~/other` — does not reproduce, because GFM's flanking rule means a path's tilde can only ever open a run, never close one, and a test pins that non-reproduction rather than disabling the option against no observed failure.
- **Footnotes and autolink literals are the only two `remark-gfm` bundle members still uninstalled.** A footnote reference still renders as text and its definition as a link reference definition whose target `allowedLinkHref` rejects — CommonMark's own reading of `[^1]: note`, not a gap. A bare URL and a bare email address still render as plain text with no anchor, because there is no autolinking code in the dependency graph to suppress — the one member the file's link allowlist exists to keep impossible.
- **Task-list marks remain inert; code-copy buttons are client-owned controls.**
  The task-list fixture in `e2e/assistant-whitespace.spec.ts` still has zero
  controls inside `.bubble__markdown` and one meta-row button in the whole bubble.
  Those counts describe that fixture, not every reply: each rendered code block
  now adds its own `Copy code` button inside `.bubble__markdown`. Keep task-list
  inertness assertions separate from the expected code-copy controls.
- **The task-mark unit assertions count class occurrences rather than matching a whole `class="…"` run.** A later shared-treatment lift (`.button-small`'s precedent elsewhere in this codebase) could turn `class="task-mark"` into `class="shared task-mark"`; a whole-run match would then fail while proving nothing about the mark itself, so `AssistantMarkdown.test.tsx`'s local `count()` helper checks occurrences of `/\btask-mark\b/` and `/task-mark--checked/` instead. The two places that do assert a whole element run on purpose — the tight-list and loose-list nesting shape — are deliberate: there the nesting itself, not the class, is the claim under test.
- **A markdown-path link's path lives only in the `onClick` closure** ([#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627)) — the opt-in `a` override renders `<button type="button" className="markdown-link" onClick={() => onOpenMarkdownPath(path)}>{children}</button>`, so the path appears in no `href`, `title`, `data-*` or `aria-*` attribute, only in the visible link text the reply already carried; a unit test and the e2e spec both assert this by reading the rendered markup, not by reasoning about the code. A `<button>`, never an `<a>`, because the click must open an in-app view and must never become a navigation. **Order matters in the opt-in table**: `markdownLinkPath` is checked before falling through to `webLink`, so a link that is both syntactically a markdown path and, say, `javascript:`-schemed (impossible today, since a scheme fails `markdownLinkPath` first) would still need `webLink`'s own denial as the second gate — the two predicates are independent fail-closed checks stacked in series, not a single combined rule.
- **Parsing remains synchronous on the render thread.** Streaming reuses verified frozen
  units, but long unfrozen tails and reference-definition whole-reply mode still reparse.
  Pending inline probing bounds both accepted completion passes (32) and candidate
  parses (64); limiting passes alone leaves punctuation-only paragraphs able to trigger
  a parse per unpaired marker. Exhaustion keeps uncompleted original syntax. Accepted
  closers are checked against text/code-content positions too, since later re-pairing
  could otherwise expose an earlier synthetic delimiter.
- **Parser positions differ from container line starts.** Pending table detection must
  account for indentation after quote prefixes and a partial delimiter's own prefix.
  Heading completion must use the last inline child's end, before closing hashes;
  inserting at the trimmed source end would expose those hashes as content. Plain
  headings and unindented headers alone cannot cover either failure.
- **Backticks do not shield unescaped pipes in GFM headers.** `` | `A|B` | `` has
  two parser-derived cells; pending output preserves the literal backticks as
  `` `A B` ``. Count cells through the shared parser rather than splitting a presumed
  inline-code span independently.
- **Used by both reply branches.** Live since [#609](../codebase/609.md) for settled replies; progressive replies use the same renderer through `StreamingAssistantMarkdown`. The reader and its Copy as HTML path also retain this boundary.
- **A fence's language label is display-bounded, not just visually clipped.** `MAX_LANGUAGE_CHARS = 20` truncates in `fenceLanguage` itself (the layer the server-render unit tier can see); `.code-block__header`'s `nowrap`+`ellipsis`+`overflow:hidden` is a second, different-fabric bound for the narrow-window residual truncation alone can't cover. Neither is redundant with the other.
- **`.code-block`'s fill is a design invariant across restyles, not an oversight.** [#623](../codebase/623.md)'s mobile chrome and [#721](https://github.com/pyrycode/pyrycode-desktop/issues/721)'s desktop redraw both land on `--color-surface` — the Figma source resolves to the same value both times — and `e2e/assistant-whitespace.spec.ts` reads this element's computed `backgroundColor` to assert inline and fenced code are one code surface ([#630](../codebase/630.md)). A future restyle that changes the fill on purpose must update that assertion deliberately, not discover it as red.
- **Static renders cannot prove copying, keyboard activation or layout.**
  `AssistantMarkdown.test.tsx` checks native button markup and escaping;
  `e2e/assistant-whitespace.spec.ts` checks computed code chrome against its tokens.
  [`e2e/code-block-copy.spec.ts`](../../../e2e/code-block-copy.spec.ts) clicks multiple
  distinct headed, headerless, long and empty blocks in one reply, then compares OS
  clipboard contents with independently specified strings. It seeds a non-secret
  sentinel before each write, checks Tab navigation and Enter/Space activation,
  and measures visible focus, containment and text non-overlap at 1280px and 800px.
  On macOS, `clipboard.readHTML()` can return plain clipboard text even without an
  HTML format; assert that `clipboard.availableFormats()` excludes `text/html` to
  establish a plain-only write.
- **Copy preserves code text, including trailing newlines.** Reading the block's
  own `code.textContent` without trimming preserves indentation, tabs, blank lines
  and literal markup/entities. CSS wrapping adds no clipboard line breaks. Markdown
  fences, the language heading and surrounding prose never enter this value. An
  empty code element copies `''`; it is distinct from a missing code element,
  which reports `missing-code` without writing.
- **Empty fences need a minimum body height.** An empty pre has no line box, so a
  bottom-aligned button otherwise crosses into the language header. Copyable bodies
  use `min-height: calc(var(--text-code-body-line) + var(--space-3) * 2)` (44px): one
  code line plus the existing vertical padding. Their right padding is
  `calc(var(--space-4) + var(--space-7))` (44px), reserving space for the whole
  27×28px target even alongside wrapped code. The button sits `--space-1` (4px)
  from the bottom and right; keyboard focus uses a `--color-outline` outline.
- **The resting copy icon retains a measured contrast limitation.**
  `--color-inverse-primary` (`#32628d`) on `--color-surface` (`#101418`) measures
  2.878:1, below the 3:1 target for an icon identifying a control. This follows the
  requested design and the [meta row's accepted contrast consequence](conversation-shell-message-bubble.md#the-meta-row).
  Include code-copy controls in the eventual design/token correction; matching
  Figma and having visible focus do not establish full WCAG AA conformance. See
  [the review measurement](https://github.com/pyrycode/pyrycode-desktop/pull/1543#issuecomment-5744154928).
- **`.code-block` now renders in two places, and a declaration that isn't stated directly on `.code-block`/`.code-block__body` may not reach the second one.** Before [#780](https://github.com/pyrycode/pyrycode-desktop/issues/780), `white-space: pre-wrap` reached the block only via a `.bubble__markdown pre` descendant selector and `word-break: break-word` only by inheriting from `.bubble` — both silently absent the moment the same two classes render outside a bubble, which is exactly what the `Bash` tool-row command block does. The fix was to state both directly on `.code-block__body`, not to add a second copy of the old rule scoped to the new container. Copying is deliberately message-only: `.code-block--copyable` scopes the extra gutter and minimum height, and Bash commands keep the base classes without a copy button. `ConversationScreen.test.tsx` asserts that shared base chrome and the message-only additions separately; exact opening-markup equality would reject this intended difference. Before adding another call site or restyling the base chrome, check which declarations depend on ancestors.

## Verification

`StreamingAssistantMarkdown.test.tsx` replays every original prefix of the named
regression fixtures and deterministic seeded block-starter fuzz. It compares raw
partition trees at absolute offsets and rendered markup with the full parse/render,
ignoring only whitespace between blocks. Pending display has separate expected-output
cases because it intentionally differs from raw-prefix rendering. Existing
`AssistantMarkdown.test.tsx` security cases also cover callers without stabilization.

Static markup and unchanged DOM identity cannot prove a skipped render.
[`e2e/progressive-markdown.spec.ts`](../../../e2e/progressive-markdown.spec.ts) uses
mounted V8 function counters for frozen-render skips and bounded probing, plus a
scoped parser breakpoint to prove later inputs exclude frozen source. It also covers
definition invalidation, pending presentation and both raw-source settlement triggers.
[`e2e/assistant-whitespace.spec.ts`](../../../e2e/assistant-whitespace.spec.ts) checks
computed styles and geometry for markdown-owned whitespace and cursor placement.

Recorded evidence at `4d33723f` from the
[passing verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1832#issuecomment-6028909574):
the configured fake-transport run executed 321 tests, all passed, with 0 failed and
5 skipped. Both named progressive tests, “indented pending headers and heading closers
preserve streaming presentation” and “progressive presentation, parser/render reuse
and raw-source settlement”, were present and passed (2 executed, 0 failed/skipped).
All 13 assistant-whitespace tests executed and passed (0 failed/skipped). No live
Claude or real-daemon evidence is required for this renderer behavior.

The settled-row regression also counts `AssistantMarkdown` separately from
`TimelineRow`, `ToolRow`, `StreamingAssistantMarkdown` and `parseMarkdown`.
Establish positive counts before measuring skips and observe each delta before
delivering the next; batching can otherwise manufacture apparent reuse.
`StreamingAssistantMarkdown` may execute again for its own partition-state update,
so its positive counter must remain separate from the parent row count. See
[row reuse verification](conversation-shell-timeline-render.md#row-reuse-verification)
for the mounted regression and baseline/fixed evidence.

At `c0268369`, the 2026-10-08
[verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1889#issuecomment-6053401984)
and dispatcher gate report record 358 fake-transport tests executed/passed, 0 failed
and 4 skipped. Both “settled rows skip deltas and unrelated group toggles while the
active reply renders” and “progressive presentation, parser/render reuse and
raw-source settlement” were present and passed. This is counted mounted evidence
for settled reuse alongside the existing progressive proof.

## Related

- [ADR 0010](../decisions/0010-markdown-renderer-capability-absent-html.md) — the library choice (`react-markdown` over `markdown-to-jsx`/`marked-react`), the `skipHtml` trap, and the full security rationale.
- [#608 codebase notes](../codebase/608.md) — implementation summary, verified construct-coverage table, code-review record.
- [#609 codebase notes](../codebase/609.md) — the historical consumer: the `assistantText` fork, the `.bubble__markdown` container and its block-rhythm/code-wrap CSS, the conditional `bubble--assistant-text` modifier, and the `React.memo` decline.
- [#623 codebase notes](../codebase/623.md) — the `pre` override, `fenceLanguage`, and the original mobile-mock `.code-block`/`.code-block__header`/`.code-block__body` CSS.
- [#721](https://github.com/pyrycode/pyrycode-desktop/issues/721) — redrew that CSS to the desktop design (corner, border colour, gutters, header type, divider colour, body line height); no change to `AssistantMarkdown.tsx` or to `fenceLanguage`. Added the `--text-label-medium-*` quartet, `--text-label-medium-weight-emphasized`, and the bespoke `--text-code-body-line` to `theme/tokens.css`.
- [#780](https://github.com/pyrycode/pyrycode-desktop/issues/780) — reused `.code-block`/`.code-block__body` headerless for a second call site (an expanded `Bash` tool row's command), which moved `white-space: pre-wrap` and `word-break: break-word` onto `.code-block__body` itself in place of `.bubble__markdown pre` (deleted) and `.bubble` inheritance — neither reached the new site. No change to `AssistantMarkdown.tsx`. See [Conversation shell § Shell command code block](conversation-shell-tool-row-code-block.md#shell-command-code-block-780).
- [#628 codebase notes](../codebase/628.md) — the `h1`–`h6` type-scale CSS, and the type-role census that picked the four steps.
- [#629 codebase notes](../codebase/629.md) — the `ul`/`ol` indent, the blockquote's indent-plus-bar, and the nested block-rhythm CSS; the marker-overhang arithmetic that bounds the list indent.
- [#630 codebase notes](../codebase/630.md) — inline code's chip CSS and its ancestry-based exclusion from a fenced block's contents; closes the #624 split.
- [#610 codebase notes](../codebase/610.md) — the `http:`/`https:` link allowlist, `allowedLinkHref`, and the app's first anchor CSS.
- [#1079](https://github.com/pyrycode/pyrycode-desktop/issues/1079) — the GFM table subset (`remarkGfmSubset`, two per-construct packages instead of the `remark-gfm` bundle), the closed-enum alignment `style`, and the table's self-scrolling overflow box. Design and full security review: `docs/specs/architecture/1079-markdown-table.md`.
- [#1080](https://github.com/pyrycode/pyrycode-desktop/issues/1080) — rode the same `remarkGfmSubset` plugin for the remaining two bundle members it left open: task list and strikethrough. Added `components.input` (renders the task-list extension's `<input type="checkbox">` as an inert `<span>` instead, so task lists introduce no source-authored form control) and four `.bubble__markdown` CSS rules (`.task-list-item`, `.task-mark`, `.task-mark--checked::after`, `del`). Zero new transitive dependencies. Design and full security review: `docs/specs/architecture/1080-task-lists-and-strikethrough.md`.
- [#1627](https://github.com/pyrycode/pyrycode-desktop/issues/1627) — gave `AssistantMarkdown` its first caller-supplied rendering change since #609: an optional `onOpenMarkdownPath?: (path: string) => void` prop. Present, a `useMemo`-built components table swaps only the `a` override; absent, the module-constant `components` object renders byte-for-byte as before. The `a` override's non-markdown-link branch was pulled out of the module constant into a shared `webLink(href, children)` helper so the two tables enforce the exact same `allowedLinkHref` posture rather than risking drift between a "plain" and an "opt-in" copy of the same logic. See § How it works and § Edge cases below for `markdownLinkPath`, and [Conversation shell — markdown reader](conversation-shell-markdown-reader.md) for the consumer.
- [#1630](https://github.com/pyrycode/pyrycode-desktop/issues/1630) — exported `remarkGfmSubset` so [the markdown reader](conversation-shell-markdown-reader.md#note-actions-menu)'s Copy as plain text parses with the exact same plugin this module registers, and reused the whole component through `renderToStaticMarkup` for that reader's Copy as HTML — a second consumer of the render pipeline, not a second implementation of its rules. No change to `components`, `allowedLinkHref` or `remarkGfmSubset`'s body.
- [Conversation timeline render](conversation-shell-timeline-render.md#structured-stream-timeline-render-203) — current assistant-text usage, cursor placement and the inherited untrusted-text posture.
- [#607 codebase notes](../codebase/607.md) — historical assistant-tail `white-space: pre-wrap`, removed when both branches gained markdown-owned whitespace.
- [#1751 plan](../../specs/architecture/1751-progressive-assistant-markdown.md) — progressive partitions, pending presentation, original-source settlement and unchanged renderer security review.
